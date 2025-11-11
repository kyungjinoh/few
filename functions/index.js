/**
 * Firebase Cloud Functions for School Clicker
 * Handles automatic deletion of all chat messages daily at 12:00 AM EST
 */

const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {getFirestore, FieldValue, Timestamp} = require("firebase-admin/firestore");
const {RateLimiterMemory} = require("rate-limiter-flexible");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");

const hasGlobalFetch = typeof global === "object" && typeof global.fetch === "function";
const fetchFn = hasGlobalFetch ? global.fetch.bind(global) : null;

// Initialize Firebase Admin SDK
initializeApp();

// Set global options for cost control
setGlobalOptions({maxInstances: 10});

const firestore = getFirestore();
const rateLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
});

const addSchoolRateLimiter = new RateLimiterMemory({
  points: 3,
  duration: 60 * 60, // 3 attempts per hour per IP
});

const sessionCreationLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
});

const sessionRateLimiter = new RateLimiterMemory({
  points: 20,
  duration: 60,
});

const SESSION_COLLECTION = "clickerSessions";
const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const SESSION_BLOCK_DURATION_MS = 1000 * 60 * 15; // 15 minutes
const SESSION_FRICTION_THRESHOLD = 3;
const CAPTCHA_PROVIDER_TURNSTILE = "turnstile";

const getRequestContext = (rawRequest) => {
  let ip = "unknown";
  let userAgent = "unknown";

  if (rawRequest) {
    const headers = rawRequest.headers || {};
    const forwarded = headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      ip = forwarded.split(",")[0].trim() || ip;
    } else if (rawRequest.ip) {
      ip = rawRequest.ip;
    }

    if (typeof headers["user-agent"] === "string") {
      userAgent = headers["user-agent"].slice(0, 500);
    } else if (typeof rawRequest.get === "function") {
      const ua = rawRequest.get("user-agent");
      if (typeof ua === "string") {
        userAgent = ua.slice(0, 500);
      }
    }
  }

  return {ip, userAgent};
};

const generateSessionToken = () => {
  return crypto.randomBytes(SESSION_TOKEN_BYTES).toString("hex");
};

const hashSessionToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

let turnstileSecret =
  process.env.CLOUDFLARE_TURNSTILE_SECRET ||
  process.env.TURNSTILE_SECRET ||
  process.env.TURNSTILE_API_SECRET ||
  null;

try {
  const config = require("firebase-functions").config();
  if (
    !turnstileSecret &&
    config &&
    typeof config === "object" &&
    config.turnstile &&
    config.turnstile.secret
  ) {
    turnstileSecret = config.turnstile.secret;
  }
} catch (error) {
  // config() throws in local environments when not initialized; ignore.
}

const verifyTurnstileCaptcha = async (token, ip) => {
  if (!token) {
    return false;
  }

  if (!turnstileSecret) {
    logger.warn("Turnstile secret is not configured; skipping CAPTCHA verification.");
    // Allow the request to continue to prevent hard lockouts.
    return true;
  }

  if (!fetchFn) {
    logger.error("Fetch API not available in this environment — cannot verify CAPTCHA.");
    return false;
  }

  try {
    const response = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        secret: turnstileSecret,
        response: token,
        remoteip: ip,
      }),
    });

    if (!response.ok) {
      logger.error("Failed to verify Turnstile CAPTCHA — non-OK response", {
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    const data = await response.json();
    if (!data.success) {
      logger.warn("Turnstile CAPTCHA verification failed", {
        errorCodes: data["error-codes"] || [],
      });
    }
    return !!data.success;
  } catch (error) {
    logger.error("Error verifying Turnstile CAPTCHA", {
      error: error.message,
    });
    return false;
  }
};

const getSessionDocRef = (hashedToken) => {
  return firestore.collection(SESSION_COLLECTION).doc(hashedToken);
};

const generateSchoolId = (schoolName) => {
  return schoolName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, "");
};

/**
 * Callable function to create a session token for click increments.
 */
exports.createClickerSession = onCall({
  memory: "256MiB",
  timeoutSeconds: 10,
}, async (request) => {
  const data = request.data || {};
  const providedUserAgent = typeof data.userAgent === "string" ? data.userAgent.slice(0, 500) : null;

  const {ip, userAgent: headerUserAgent} = getRequestContext(request.rawRequest);

  try {
    await sessionCreationLimiter.consume(ip);
  } catch (error) {
    logger.warn("Session creation rate limit exceeded", {
      ip,
      error: error.message,
    });
    throw new HttpsError("resource-exhausted", "Too many session requests — try again later.");
  }

  const sessionToken = generateSessionToken();
  const hashedToken = hashSessionToken(sessionToken);
  const now = Date.now();
  const expiresAtMs = now + SESSION_TTL_MS;

  const sessionDoc = {
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
    ipAddress: ip,
    userAgent: providedUserAgent || headerUserAgent,
    requestCount: 0,
    rateLimitedAt: null,
    frictionLevel: 0,
    captchaProvider: CAPTCHA_PROVIDER_TURNSTILE,
    blockedUntil: null,
    lastCaptchaSolvedAt: null,
    lastFrictionReason: null,
  };

  await getSessionDocRef(hashedToken).set(sessionDoc, {merge: true});

  logger.info("Issued new clicker session", {
    sessionId: hashedToken,
    ip,
  });

  return {
    sessionToken,
    expiresAt: new Date(expiresAtMs).toISOString(),
    captchaProvider: CAPTCHA_PROVIDER_TURNSTILE,
  };
});

/**
 * Callable function to add a new school directly to Firestore.
 */
exports.addSchool = onCall({
  memory: "256MiB",
  timeoutSeconds: 10,
}, async (request) => {
  const data = request.data || {};
  const {schoolName, region, logoUrl, requesterEmail} = data;

  let ip = "unknown";
  if (request.rawRequest) {
    const headers = request.rawRequest.headers || {};
    const forwarded = headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      ip = forwarded.split(",")[0].trim() || ip;
    } else if (request.rawRequest.ip) {
      ip = request.rawRequest.ip;
    }
  }

  try {
    await addSchoolRateLimiter.consume(ip);
  } catch (error) {
    throw new HttpsError("resource-exhausted", "Too many add-school requests — slow down.");
  }

  if (typeof schoolName !== "string" || !schoolName.trim()) {
    throw new HttpsError("invalid-argument", "School name is required.");
  }

  if (typeof region !== "string" || !region.trim()) {
    throw new HttpsError("invalid-argument", "Region is required.");
  }

  if (typeof requesterEmail !== "string" || !requesterEmail.trim()) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  const trimmedName = schoolName.trim();
  const trimmedRegion = region.trim();
  const trimmedLogo = typeof logoUrl === "string" ? logoUrl.trim() : "";
  const trimmedEmail = requesterEmail.trim();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    throw new HttpsError("invalid-argument", "Please provide a valid email address.");
  }

  const schoolId = generateSchoolId(trimmedName);
  if (!schoolId) {
    throw new HttpsError("invalid-argument", "Unable to generate school ID. Please use a different name.");
  }

  const schoolRef = firestore.collection("schools").doc(schoolId);
  const existingSchool = await schoolRef.get();
  if (existingSchool.exists) {
    throw new HttpsError("already-exists", "This school is already on the leaderboard.");
  }

  const newSchoolData = {
    schoolName: trimmedName,
    score: 0,
    rank: 0,
    region: trimmedRegion,
    createdAt: FieldValue.serverTimestamp(),
    requestedByEmail: trimmedEmail,
  };

  if (trimmedLogo) {
    newSchoolData.schoolLogo = trimmedLogo;
  }

  await schoolRef.set(newSchoolData);

  return {
    success: true,
    schoolId,
  };
});

/**
 * Callable function that safely updates a school's score by a bounded delta.
 */
exports.updateScore = onCall({
  memory: "256MiB",
  timeoutSeconds: 10,
}, async (request) => {
  const data = request.data || {};
  const {
    schoolId,
    delta,
    sessionToken,
    captchaToken,
    clientContext,
  } = data;

  const deltaErrorMessage = "Invalid delta — only values between -1000 and +500 (excluding 0) are allowed.";

  if (typeof schoolId !== "string" || !schoolId.trim()) {
    throw new HttpsError("invalid-argument", "Missing or invalid schoolId.");
  }

  const isDeltaValid =
    typeof delta === "number" &&
    Number.isFinite(delta) &&
    delta !== 0 &&
    ((delta > 0 && delta <= 500) || (delta < 0 && delta >= -1000));

  if (!isDeltaValid) {
    throw new HttpsError("invalid-argument", deltaErrorMessage);
  }

  if (typeof sessionToken !== "string" || sessionToken.length < SESSION_TOKEN_BYTES) {
    throw new HttpsError("unauthenticated", "Missing or invalid session token.");
  }

  const {ip, userAgent: headerUserAgent} = getRequestContext(request.rawRequest);

  try {
    await rateLimiter.consume(ip);
  } catch (error) {
    logger.warn("IP rate limit exceeded for updateScore", {
      ip,
      error: error.message,
    });
    throw new HttpsError("resource-exhausted", "Too many requests from this IP — slow down.");
  }

  const hashedToken = hashSessionToken(sessionToken);
  const sessionRef = getSessionDocRef(hashedToken);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    throw new HttpsError("unauthenticated", "Session expired or invalid. Refresh and try again.");
  }

  const sessionData = sessionSnap.data() || {};
  let currentFrictionLevel = sessionData.frictionLevel || 0;

  const nowMs = Date.now();

  if (sessionData.expiresAt instanceof Timestamp && sessionData.expiresAt.toMillis() < nowMs) {
    await sessionRef.delete().catch((error) => {
      logger.warn("Failed to delete expired session", {
        error: error.message,
        sessionId: hashedToken,
      });
    });
    throw new HttpsError("unauthenticated", "Session expired. Start a new session to continue.");
  }

  if (sessionData.blockedUntil instanceof Timestamp && sessionData.blockedUntil.toMillis() > nowMs) {
    const blockedUntilIso = sessionData.blockedUntil.toDate().toISOString();
    throw new HttpsError("resource-exhausted", "Session temporarily blocked due to excessive activity.", {
      code: "TEMP_BLOCK",
      blockedUntil: blockedUntilIso,
    });
  }

  if (currentFrictionLevel > 0) {
    if (typeof captchaToken !== "string" || captchaToken.length === 0) {
      throw new HttpsError("failed-precondition", "Additional verification required to continue.", {
        code: "CAPTCHA_REQUIRED",
        frictionLevel: currentFrictionLevel,
      });
    }

    const captchaValid = await verifyTurnstileCaptcha(captchaToken, ip);
    if (!captchaValid) {
      await sessionRef.set({
        lastFrictionReason: "captcha-invalid",
        lastFrictionAt: FieldValue.serverTimestamp(),
      }, {merge: true}).catch((error) => {
        logger.warn("Failed to log invalid captcha attempt", {
          error: error.message,
          sessionId: hashedToken,
        });
      });

      throw new HttpsError("permission-denied", "CAPTCHA verification failed. Try again.", {
        code: "CAPTCHA_INVALID",
      });
    }

    const frictionReduction = Math.min(1, currentFrictionLevel);
    const captchaUpdates = {
      lastCaptchaSolvedAt: FieldValue.serverTimestamp(),
      lastFrictionReason: null,
    };
    if (frictionReduction > 0) {
      captchaUpdates.frictionLevel = FieldValue.increment(-frictionReduction);
      currentFrictionLevel -= frictionReduction;
    }

    await sessionRef.set(captchaUpdates, {merge: true}).catch((error) => {
      logger.warn("Failed to update session after captcha verification", {
        error: error.message,
        sessionId: hashedToken,
      });
    });
  }

  try {
    await sessionRateLimiter.consume(hashedToken);
  } catch (error) {
    currentFrictionLevel += 1;
    const frictionUpdates = {
      frictionLevel: FieldValue.increment(1),
      rateLimitedAt: FieldValue.serverTimestamp(),
      lastFrictionReason: "session-rate-limit",
    };

    let message = "Too many requests from this session — solve the verification to continue.";
    const details = {
      code: "CAPTCHA_REQUIRED",
      frictionLevel: currentFrictionLevel,
    };

    if (currentFrictionLevel >= SESSION_FRICTION_THRESHOLD) {
      const blockedUntilMs = nowMs + SESSION_BLOCK_DURATION_MS;
      frictionUpdates.blockedUntil = Timestamp.fromMillis(blockedUntilMs);
      message = "Session temporarily blocked due to excessive activity.";
      details.code = "TEMP_BLOCK";
      details.blockedUntil = new Date(blockedUntilMs).toISOString();
    }

    await sessionRef.set(frictionUpdates, {merge: true}).catch((setError) => {
      logger.warn("Failed to record friction updates", {
        error: setError.message,
        sessionId: hashedToken,
      });
    });

    throw new HttpsError("resource-exhausted", message, details);
  }

  const trimmedId = schoolId.trim();
  const schoolRef = firestore.collection("schools").doc(trimmedId);
  const schoolSnap = await schoolRef.get();

  if (!schoolSnap.exists) {
    throw new HttpsError("not-found", `School with ID "${trimmedId}" does not exist.`);
  }

  const currentScore = schoolSnap.data().score || 0;
  const maxScore = 1000000000000;
  const minScore = -1000000000000;
  const projectedScore = currentScore + delta;

  if (projectedScore > maxScore || projectedScore < minScore) {
    throw new HttpsError("failed-precondition", "Score update would exceed allowed bounds.");
  }

  await schoolRef.update({
    score: FieldValue.increment(delta),
  });

  const clientUserAgent = (
    clientContext &&
    typeof clientContext === "object" &&
    typeof clientContext.userAgent === "string"
  ) ? clientContext.userAgent.slice(0, 500) : null;

  const sessionUpdates = {
    lastUsedAt: FieldValue.serverTimestamp(),
    requestCount: FieldValue.increment(1),
    lastIp: ip,
    expiresAt: Timestamp.fromMillis(nowMs + SESSION_TTL_MS),
  };

  if (!sessionData.ipAddress || sessionData.ipAddress !== ip) {
    sessionUpdates.ipAddress = ip;
  }

  if (clientUserAgent && clientUserAgent !== sessionData.userAgent) {
    sessionUpdates.userAgent = clientUserAgent;
  } else if (!sessionData.userAgent && headerUserAgent !== "unknown") {
    sessionUpdates.userAgent = headerUserAgent;
  }

  await sessionRef.set(sessionUpdates, {merge: true}).catch((error) => {
    logger.warn("Failed to update session metadata after score update", {
      error: error.message,
      sessionId: hashedToken,
    });
  });

  logger.debug("Score update applied", {
    schoolId: trimmedId,
    delta,
    sessionId: hashedToken,
    ip,
  });

  return {success: true};
});

/**
 * Scheduled function that runs daily at 12:00 AM EST to delete all chat messages
 * Clears all chat messages from Firebase Realtime Database
 */
exports.cleanupOldChatMessages = onSchedule({
  schedule: "0 0 * * *", // Run daily at midnight
  timeZone: "America/New_York", // EST timezone
  memory: "256MiB",
  timeoutSeconds: 300,
}, async (event) => {
  const db = getDatabase();
  const now = Date.now();

  logger.info("Starting daily chat message cleanup", {
    currentTime: new Date(now).toISOString(),
    timezone: "America/New_York",
  });

  try {
    // Get reference to all school chats
    const schoolChatsRef = db.ref("schoolChats");
    const snapshot = await schoolChatsRef.once("value");

    if (!snapshot.exists()) {
      logger.info("No school chats found - nothing to delete");
      return;
    }

    const schoolChats = snapshot.val();
    let totalDeleted = 0;
    let schoolsProcessed = 0;

    // Process each school's chat - delete ALL messages
    for (const [schoolName, messages] of Object.entries(schoolChats)) {
      if (!messages || typeof messages !== "object") continue;

      schoolsProcessed++;
      let schoolDeleted = 0;

      // Delete all messages in this school's chat
      for (const [messageId, messageData] of Object.entries(messages)) {
        if (!messageData || typeof messageData !== "object") continue;

        try {
          // Delete the message
          await db.ref(`schoolChats/${schoolName}/${messageId}`).remove();
          schoolDeleted++;
          totalDeleted++;

          logger.debug("Deleted message", {
            schoolName,
            messageId,
            timestamp: messageData.timestamp ? new Date(messageData.timestamp).toISOString() : "unknown",
          });
        } catch (error) {
          logger.error("Error deleting message", {
            schoolName,
            messageId,
            error: error.message,
          });
        }
      }

      if (schoolDeleted > 0) {
        logger.info(`Cleaned up ${schoolDeleted} messages for school: ${schoolName}`);
      }
    }

    logger.info("Daily chat message cleanup completed", {
      schoolsProcessed,
      totalMessagesDeleted: totalDeleted,
      duration: `${Date.now() - now}ms`,
      nextRun: "Tomorrow at 12:00 AM EST",
    });
  } catch (error) {
    logger.error("Error during daily chat message cleanup", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
});

/**
 * HTTP function to manually cleanup chat messages
 * Call this function to immediately delete all chat messages
 */
exports.cleanupChatMessagesNow = onRequest({
  memory: "256MiB",
  timeoutSeconds: 300,
}, async (req, res) => {
  const db = getDatabase();
  const now = Date.now();

  logger.info("Starting manual chat message cleanup", {
    currentTime: new Date(now).toISOString(),
  });

  try {
    // Get reference to all school chats
    const schoolChatsRef = db.ref("schoolChats");
    const snapshot = await schoolChatsRef.once("value");

    if (!snapshot.exists()) {
      logger.info("No school chats found - nothing to delete");
      res.status(200).json({
        success: true,
        message: "No chat messages found to delete",
        totalDeleted: 0,
      });
      return;
    }

    const schoolChats = snapshot.val();
    let totalDeleted = 0;
    let schoolsProcessed = 0;

    // Process each school's chat - delete ALL messages
    for (const [schoolName, messages] of Object.entries(schoolChats)) {
      if (!messages || typeof messages !== "object") continue;

      schoolsProcessed++;
      let schoolDeleted = 0;

      // Delete all messages in this school's chat
      for (const [messageId, messageData] of Object.entries(messages)) {
        if (!messageData || typeof messageData !== "object") continue;

        try {
          // Delete the message
          await db.ref(`schoolChats/${schoolName}/${messageId}`).remove();
          schoolDeleted++;
          totalDeleted++;
        } catch (error) {
          logger.error("Error deleting message", {
            schoolName,
            messageId,
            error: error.message,
          });
        }
      }

      if (schoolDeleted > 0) {
        logger.info(`Cleaned up ${schoolDeleted} messages for school: ${schoolName}`);
      }
    }

    logger.info("Manual chat message cleanup completed", {
      schoolsProcessed,
      totalMessagesDeleted: totalDeleted,
      duration: `${Date.now() - now}ms`,
    });

    res.status(200).json({
      success: true,
      message: "Chat messages cleaned up successfully",
      schoolsProcessed,
      totalMessagesDeleted: totalDeleted,
    });
  } catch (error) {
    logger.error("Error during manual chat message cleanup", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * HTTP function to reset The Quarry Lane School score
 * Call this function to fix the extremely high score issue
 */
exports.resetQuarryLaneScore = onRequest({
  memory: "256MiB",
  timeoutSeconds: 60,
}, async (req, res) => {
  const firestore = getFirestore();

  try {
    logger.info("Starting Quarry Lane School score reset");

    // Get the school document
    const schoolRef = firestore.collection("schools").doc("the_quarry_lane_school");
    const schoolDoc = await schoolRef.get();

    if (!schoolDoc.exists) {
      logger.error("The Quarry Lane School not found in Firestore");
      res.status(404).json({
        success: false,
        error: "The Quarry Lane School not found in Firestore",
      });
      return;
    }

    const currentData = schoolDoc.data();
    const currentScore = currentData.score;

    logger.info(`Current score: ${currentScore.toLocaleString()}`);

    // Reset to a reasonable score (1000 points)
    const newScore = 1000;

    await schoolRef.update({
      score: newScore,
    });

    logger.info(`Reset The Quarry Lane School score: ${currentScore.toLocaleString()} → ${newScore}`);

    // Check for other schools with extremely high scores
    const allSchoolsSnapshot = await firestore.collection("schools").get();

    const highScoreSchools = [];
    allSchoolsSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.score > 1000000) { // 1 million threshold
        highScoreSchools.push({
          name: data.schoolName,
          score: data.score,
          id: doc.id,
        });
      }
    });

    res.status(200).json({
      success: true,
      message: "The Quarry Lane School score reset successfully",
      oldScore: currentScore,
      newScore: newScore,
      highScoreSchools: highScoreSchools,
    });
  } catch (error) {
    logger.error("Error resetting Quarry Lane School score", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
