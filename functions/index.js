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
const HOURLY_LIMIT_PER_USER = 6000;
const SCHOOL_HOURLY_LIMIT_FALLBACK = 6000;
const SCHOOL_HOURLY_LIMIT_COLLECTION = "schoolHourlyLimits";

const realtimeDb = getDatabase();

const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;
const GA4_API_SECRET = process.env.GA4_API_SECRET;

/**
 * Get or generate identifiers for tracking (both Device ID and User-ID).
 * Uses GA4 approach: Device ID (client_id) + User-ID.
 * @param {string} clientId - Device ID from client cookie (GA4 Client ID)
 * @param {string} userId - User-ID from client (persistent user identifier)
 * @param {string} sessionToken - Session token (fallback)
 * @param {string} ip - IP address (fallback)
 * @param {string} userAgent - User agent string (fallback)
 * @return {{clientId: string, userId: (string|null)}} Both identifiers
 */
const getTrackingIdentifiers = (clientId, userId, sessionToken, ip, userAgent) => {
  let finalClientId = null;
  let finalUserId = null;

  // Validate and use clientId from client (Device ID - from cookie like GA4)
  if (clientId && typeof clientId === "string" && clientId !== "unknown") {
    const parts = clientId.split(".");
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      finalClientId = clientId;
    }
  }

  // Use userId from client if provided (User-ID - preferred for unique counting)
  if (userId && typeof userId === "string" && userId !== "unknown" && userId !== "null") {
    finalUserId = userId;
  }

  // Generate fallback Client ID if not provided
  if (!finalClientId) {
    if (sessionToken && typeof sessionToken === "string") {
      const hash = crypto.createHash("sha256").update(sessionToken).digest("hex");
      const firstSegment = parseInt(hash.slice(0, 10), 16) || Math.floor(Date.now() / 1000);
      const secondSegment = parseInt(hash.slice(10, 20), 16) ||
          Math.floor(Math.random() * 2147483647);
      finalClientId = `${Math.abs(firstSegment)}.${Math.abs(secondSegment)}`;
    } else {
      const combined = `${ip || "unknown"}_${userAgent || "unknown"}`;
      const hash = crypto.createHash("sha256").update(combined).digest("hex");
      const firstSegment = parseInt(hash.slice(0, 10), 16) || Math.floor(Date.now() / 1000);
      const secondSegment = parseInt(hash.slice(10, 20), 16) ||
          Math.floor(Math.random() * 2147483647);
      finalClientId = `${Math.abs(firstSegment)}.${Math.abs(secondSegment)}`;
    }
  }

  return {
    clientId: finalClientId,
    userId: finalUserId,
  };
};

/**
 * Get the current hour window start timestamp (hour aligned, minutes/seconds/ms = 0).
 * @return {Timestamp} Timestamp for the start of the current hour
 */
const getCurrentHourWindow = () => {
  const now = new Date();
  now.setMinutes(0, 0, 0); // Set minutes, seconds, and milliseconds to 0
  return Timestamp.fromDate(now);
};

/**
 * Record a user in the hourly cumulative tracker in RTDB.
 * This adds the user to schoolHourlyUsers which cumulates all users
 * who were online in the current hour (from schoolOnlineUsers).
 * @param {string} schoolSlug - School slug (URL-friendly name)
 * @param {string} userId - User-ID (from schoolOnlineUsers)
 * @return {Promise<void>}
 */
const recordUserInHourlyTracker = async (schoolSlug, userId) => {
  try {
    if (!realtimeDb) {
      logger.warn("Realtime Database not available for hourly tracking");
      return;
    }

    if (!schoolSlug || !userId) {
      logger.warn("Missing schoolSlug or userId for hourly tracking", {
        schoolSlug,
        userId,
        hasSchoolSlug: !!schoolSlug,
        hasUserId: !!userId,
      });
      return;
    }

    const hourWindowStart = getCurrentHourWindow();
    const hourWindowKey = hourWindowStart.toMillis().toString();

    // Add user to hourly cumulative tracker: schoolHourlyUsers/{schoolSlug}/{hourWindowKey}/{userId}
    // This cumulates all users who were online at any point in this hour
    const hourlyUserRef = realtimeDb.ref(
        `schoolHourlyUsers/${schoolSlug}/${hourWindowKey}/${userId}`,
    );

    // Set with timestamp - if user already exists, just update timestamp
    // Use transaction to preserve firstSeen if it already exists
    const currentData = await hourlyUserRef.once("value");
    const existingData = currentData.val();
    const firstSeen = existingData && existingData.firstSeen ?
        existingData.firstSeen : Date.now();

    await hourlyUserRef.set({
      timestamp: Date.now(),
      firstSeen: firstSeen, // Keep first seen time if exists
    });
  } catch (error) {
    logger.error("Failed to record user in hourly tracker", {
      schoolSlug,
      userId,
      error: error.message,
      stack: error.stack,
    });
    // Don't throw - this is tracking only, shouldn't block score updates
  }
};

/**
 * Get count of unique users who were online in the current hour window.
 * Uses RTDB: reads from schoolHourlyUsers which cumulates users from schoolOnlineUsers.
 * @param {string} schoolSlug - School slug (URL-friendly name)
 * @return {Promise<number>} Number of unique users in the current hour
 */
const getUniqueUsersInPastHour = async (schoolSlug) => {
  try {
    if (!realtimeDb) {
      logger.warn("Realtime Database not available for user count");
      return 0;
    }

    const hourWindowStart = getCurrentHourWindow();
    const hourWindowKey = hourWindowStart.toMillis().toString();

    // Read from RTDB: schoolHourlyUsers/{schoolSlug}/{hourWindowKey}
    // This contains all users who were online at any point in this hour
    const hourlyUsersRef = realtimeDb.ref(`schoolHourlyUsers/${schoolSlug}/${hourWindowKey}`);
    const snapshot = await hourlyUsersRef.once("value");
    const hourlyUsers = snapshot.val();

    if (!hourlyUsers || typeof hourlyUsers !== "object") {
      return 0;
    }

    // Count unique userIds (each userId is a key in the object)
    return Object.keys(hourlyUsers).length;
  } catch (error) {
    logger.error("Failed to get unique users in past hour from RTDB", {
      schoolSlug,
      error: error.message,
    });
    return 0;
  }
};

/**
 * Calculate the hourly limit for a school based on unique users in current hour window.
 * Uses RTDB: reads from schoolHourlyUsers which cumulates users from schoolOnlineUsers.
 * @param {string} schoolId - Firestore document ID
 * @return {Promise<{hourlyLimit: number, userCount: number, fallback: boolean, schoolSlug: string}>}
 */
const resolveSchoolHourlyLimit = async (schoolId) => {
  try {
    // Read school document to get schoolName, then convert to slug
    const schoolRef = firestore.collection("schools").doc(schoolId);
    const schoolSnap = await schoolRef.get();

    if (!schoolSnap.exists) {
      logger.warn("School not found when resolving hourly limit", {schoolId});
      return {
        hourlyLimit: SCHOOL_HOURLY_LIMIT_FALLBACK,
        userCount: 0,
        fallback: true,
        schoolSlug: "",
      };
    }

    const schoolData = schoolSnap.data() || {};
    const schoolName = schoolData.schoolName || "";
    const schoolSlug = schoolName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, "");

    if (!schoolSlug) {
      logger.warn("Unable to generate slug from school name", {
        schoolId,
        schoolName,
      });
      return {
        hourlyLimit: SCHOOL_HOURLY_LIMIT_FALLBACK,
        userCount: 0,
        fallback: true,
        schoolSlug: "",
      };
    }

    // Get count of unique users from RTDB hourly tracker
    const userCount = await getUniqueUsersInPastHour(schoolSlug);
    const hourlyLimit = userCount * HOURLY_LIMIT_PER_USER;

    if (hourlyLimit > 0) {
      return {
        hourlyLimit,
        userCount,
        fallback: false,
        schoolSlug,
      };
    }

    // Fallback if no users found
    return {
      hourlyLimit: SCHOOL_HOURLY_LIMIT_FALLBACK,
      userCount: 0,
      fallback: true,
      schoolSlug,
    };
  } catch (error) {
    logger.error("Error resolving school hourly limit", {
      schoolId,
      error: error.message,
    });
    return {
      hourlyLimit: SCHOOL_HOURLY_LIMIT_FALLBACK,
      userCount: 0,
      fallback: true,
      schoolSlug: "",
    };
  }
};

/**
 * Send an analytics event to GA4 for hourly limit calculations.
 * Uses both Device ID (client_id) and User-ID (GA4 approach).
 * @param {string} schoolId
 * @param {string} clientId - Device ID (GA4 Client ID - from cookie)
 * @param {string|null} userId - User-ID (persistent user identifier)
 * @param {number} userCount
 * @param {number} hourlyLimit
 * @return {Promise<void>}
 */
const sendGa4HourlyLimitEvent = async (schoolId, clientId, userId, userCount, hourlyLimit) => {
  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) {
    return;
  }

  try {
    const payload = {
      client_id: clientId, // Device ID (GA4 Client ID - from cookie, like _ga)
      events: [
        {
          name: "hourly_limit_calculated",
          params: {
            school_id: schoolId,
            user_count: userCount,
            hourly_limit: hourlyLimit,
          },
        },
      ],
    };

    // Add User-ID if available (GA4 best practice)
    if (userId) {
      payload.user_id = userId;
    }

    const response = await fetch(
        `https://www.google-analytics.com/mp/collect` +
        `?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
    );

    if (!response.ok) {
      const text = await response.text();
      logger.warn("Failed to send GA4 event for hourly limit", {
        schoolId,
        clientId,
        userId,
        status: response.status,
        body: text,
      });
    }
  } catch (error) {
    logger.error("GA4 hourly limit event failed", {
      schoolId,
      clientId,
      userId,
      error: error.message,
    });
  }
};

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
  const {ip, userAgent} = getRequestContext(request.rawRequest);
  const hasUserAgent = request.data && typeof request.data.userAgent === "string";
  const clientUserAgent = hasUserAgent ?
    request.data.userAgent.slice(0, 500) :
    null;
  const sessionToken = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("hex");

  logger.debug("Issued clicker session token", {
    ip,
  });

  try {
    await firestore.collection("sessionLogs").doc(sessionToken).set({
      ip,
      userAgent,
      clientUserAgent,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error("Failed to persist session log", {
      error: error.message,
    });
  }

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

  const {ip, userAgent} = getRequestContext(request.rawRequest);

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

  // Extract clientId, userId, and session token from request data (sent by client)
  // clientId is Device ID (from cookie, GA4-style, like _ga cookie)
  // userId is User-ID (from localStorage, persistent user identifier)
  const clientIdFromClient = data.clientId || null;
  const userIdFromClient = data.userId || null;
  const sessionToken = data.sessionToken || null;

  // Get both Device ID and User-ID (GA4 approach: use both identifiers)
  const {clientId, userId} = getTrackingIdentifiers(
      clientIdFromClient,
      userIdFromClient,
      sessionToken,
      ip,
      userAgent,
  );

  // Get school slug and initial hourly limit
  let {hourlyLimit, userCount, fallback, schoolSlug} =
    await resolveSchoolHourlyLimit(trimmedId);

  // Record user in RTDB hourly tracker (cumulative users from schoolOnlineUsers)
  // The userId from request should match the userId key in schoolOnlineUsers
  // (both use the same localStorage: 'schoolClicker_userId')
  // Use userId if available, otherwise fallback to clientId
  const trackingUserId = userId || clientId;

  // Add user to hourly tracker (backup - client also adds when user comes online)
  // This ensures the user is tracked even if client-side addition failed
  if (schoolSlug && trackingUserId) {
    await recordUserInHourlyTracker(schoolSlug, trackingUserId).catch((error) => {
      // Silently fail - hourly tracking is non-blocking
      // Continue even if tracking fails
    });

    // Recalculate user count after adding current user
    const updatedUserCount = await getUniqueUsersInPastHour(schoolSlug);
    const updatedHourlyLimit = updatedUserCount * HOURLY_LIMIT_PER_USER;

    // Use updated counts if they're higher (current user was added)
    if (updatedUserCount > userCount) {
      userCount = updatedUserCount;
      hourlyLimit = updatedHourlyLimit > 0 ? updatedHourlyLimit : SCHOOL_HOURLY_LIMIT_FALLBACK;
      fallback = updatedHourlyLimit === 0;
    }
  }

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

    const remaining = Math.max(0, hourlyLimit - usedPoints);
    const appliedDelta = Math.min(remaining, delta);

    // Always update hourlyLimit in document to reflect current unique user count
    // This ensures the document always has the latest limit calculation (userCount * 6000)
    if (appliedDelta <= 0) {
      tx.set(limitRef, {
        windowStart: Timestamp.fromMillis(currentWindowStartMs),
        points: usedPoints,
        hourlyLimit, // Updated from unique user count: userCount * HOURLY_LIMIT_PER_USER
        uniqueUsers: userCount, // Current unique users in this hour window
        fallbackInUse: fallback,
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

    // Update hourlyLimit in document to reflect current unique user count
    // This ensures the document always has the latest limit calculation (userCount * 6000)
    tx.set(limitRef, {
      windowStart: Timestamp.fromMillis(currentWindowStartMs),
      points: usedPoints + appliedDelta,
      hourlyLimit, // Updated from unique user count: userCount * HOURLY_LIMIT_PER_USER
      uniqueUsers: userCount, // Current unique users in this hour window
      fallbackInUse: fallback,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    return {
      appliedDelta,
      remaining: Math.max(0, hourlyLimit - (usedPoints + appliedDelta)),
      limitReached: usedPoints + appliedDelta >= hourlyLimit,
    };
  });

  await sendGa4HourlyLimitEvent(trimmedId, clientId, userId, userCount, hourlyLimit)
      .catch((error) => {
        logger.warn("Failed to dispatch GA4 hourly limit event", {
          schoolId: trimmedId,
          clientId,
          userId,
          error: error.message,
        });
      });

  // Update RTDB with hourly score increase and hourly limit for real-time display
  if (schoolSlug && realtimeDb) {
    try {
      // Recalculate user count right before writing to ensure we use the current hour's data
      const currentUserCount = await getUniqueUsersInPastHour(schoolSlug);
      const currentHourlyLimit = currentUserCount * HOURLY_LIMIT_PER_USER;
      const currentFallback = currentHourlyLimit === 0;

      // Calculate the score increase since the hour started
      // This is the same as usedPoints in the hourly limit document
      const now = new Date();
      now.setMinutes(0, 0, 0);
      const currentWindowStartMs = now.getTime();

      // Get the hourly limit document to find usedPoints (score increase this hour)
      const limitSnap = await limitRef.get();
      let hourlyScoreIncrease = 0;
      if (limitSnap.exists) {
        const limitData = limitSnap.data() || {};
        if (limitData.windowStart instanceof Timestamp &&
            limitData.windowStart.toMillis() === currentWindowStartMs) {
          hourlyScoreIncrease = Number(limitData.points) || 0;
        }
      }

      // Calculate remaining quota based on current hourly limit
      const currentRemainingQuota = Math.max(0, currentHourlyLimit - hourlyScoreIncrease);
      const currentLimitReached = hourlyScoreIncrease >= currentHourlyLimit;

      // Write to RTDB: schoolStats/{schoolSlug}/hourlyScoreIncrease and hourlyLimit
      const statsRef = realtimeDb.ref(`schoolStats/${schoolSlug}`);
      await statsRef.set({
        hourlyScoreIncrease: hourlyScoreIncrease, // Score increase since hour started
        hourlyLimit: currentHourlyLimit > 0 ? currentHourlyLimit : SCHOOL_HOURLY_LIMIT_FALLBACK,
        uniqueUsers: currentUserCount,
        remainingQuota: currentRemainingQuota,
        limitReached: currentLimitReached,
        fallbackInUse: currentFallback,
        updatedAt: Date.now(),
      });

      logger.debug("Updated school stats in RTDB", {
        schoolSlug,
        hourlyScoreIncrease,
        hourlyLimit,
        uniqueUsers: userCount,
      });
    } catch (rtdbError) {
      logger.warn("Failed to update school stats in RTDB (non-blocking)", {
        schoolId: trimmedId,
        schoolSlug,
        error: rtdbError.message,
      });
      // Don't throw - RTDB update is for real-time display only
    }
  }

  logger.debug("Score update applied", {
    schoolId: trimmedId,
    delta: transactionResult.appliedDelta,
    ip,
    clientId, // Device ID (GA4 Client ID - from cookie, identifies device/browser)
    userId, // User-ID (persistent user identifier - preferred for unique counting)
    remainingHourlyQuota: transactionResult.remaining,
    uniqueUsers: userCount,
    hourlyLimit,
    hourlyLimitFallbackApplied: fallback,
  });

  return {
    success: true,
    appliedDelta: transactionResult.appliedDelta,
    remainingHourlyQuota: transactionResult.remaining,
    hourlyLimitReached: transactionResult.limitReached,
    hourlyLimit,
    uniqueUsers: userCount,
    fallbackApplied: fallback,
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
