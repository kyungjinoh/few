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

const SESSION_TOKEN_BYTES = 32;
const SCHOOL_HOURLY_LIMIT = 100000;
const SCHOOL_HOURLY_LIMIT_COLLECTION = "schoolHourlyLimits";

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
  const {ip} = getRequestContext(request.rawRequest);
  const sessionToken = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("hex");

  logger.debug("Issued clicker session token", {
    ip,
  });

  return {
    sessionToken,
    expiresAt: null,
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
  const {schoolId, delta} = data;

  const deltaErrorMessage = "Invalid delta — only values between 0 and +500 are allowed.";

  if (typeof schoolId !== "string" || !schoolId.trim()) {
    throw new HttpsError("invalid-argument", "Missing or invalid schoolId.");
  }

  const isDeltaValid =
    typeof delta === "number" &&
    Number.isFinite(delta) &&
    delta >= 0 &&
    delta <= 500;

  if (!isDeltaValid) {
    throw new HttpsError("invalid-argument", deltaErrorMessage);
  }

  const {ip} = getRequestContext(request.rawRequest);

  try {
    await rateLimiter.consume(ip);
  } catch (error) {
    logger.warn("IP rate limit exceeded for updateScore", {
      ip,
      error: error.message,
    });
    throw new HttpsError("resource-exhausted", "Too many requests from this IP — slow down.");
  }

  const trimmedId = schoolId.trim();
  const schoolRef = firestore.collection("schools").doc(trimmedId);
  const limitRef = firestore.collection(SCHOOL_HOURLY_LIMIT_COLLECTION).doc(trimmedId);

  const transactionResult = await firestore.runTransaction(async (tx) => {
    const schoolSnap = await tx.get(schoolRef);
    if (!schoolSnap.exists) {
      throw new HttpsError("not-found", `School with ID "${trimmedId}" does not exist.`);
    }

    const currentScore = schoolSnap.data().score || 0;
    const maxScore = 1000000000000;

    const limitSnap = await tx.get(limitRef);
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const currentWindowStartMs = now.getTime();

    let usedPoints = 0;
    if (limitSnap.exists) {
      const limitData = limitSnap.data() || {};
      if (limitData.windowStart instanceof Timestamp &&
        limitData.windowStart.toMillis() === currentWindowStartMs) {
        usedPoints = Number(limitData.points) || 0;
      }
    }

    const remaining = Math.max(0, SCHOOL_HOURLY_LIMIT - usedPoints);
    const appliedDelta = Math.min(remaining, delta);

    if (appliedDelta <= 0) {
      tx.set(limitRef, {
        windowStart: Timestamp.fromMillis(currentWindowStartMs),
        points: usedPoints,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});

      return {
        appliedDelta: 0,
        remaining,
        limitReached: true,
      };
    }

    const projectedScore = currentScore + appliedDelta;
    if (projectedScore > maxScore) {
      throw new HttpsError("failed-precondition", "Score update would exceed allowed bounds.");
    }

    tx.update(schoolRef, {
      score: FieldValue.increment(appliedDelta),
    });

    tx.set(limitRef, {
      windowStart: Timestamp.fromMillis(currentWindowStartMs),
      points: usedPoints + appliedDelta,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    return {
      appliedDelta,
      remaining: Math.max(0, SCHOOL_HOURLY_LIMIT - (usedPoints + appliedDelta)),
      limitReached: usedPoints + appliedDelta >= SCHOOL_HOURLY_LIMIT,
    };
  });

  logger.debug("Score update applied", {
    schoolId: trimmedId,
    delta: transactionResult.appliedDelta,
    ip,
    remainingHourlyQuota: transactionResult.remaining,
  });

  return {
    success: true,
    appliedDelta: transactionResult.appliedDelta,
    remainingHourlyQuota: transactionResult.remaining,
    hourlyLimitReached: transactionResult.limitReached,
  };
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
