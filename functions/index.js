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

// Per-user-ID rate limiter to prevent same user from being added multiple times
// Tracked by userId + schoolSlug combination (NOT IP-based)
const userHourlyRecordRateLimiter = new RateLimiterMemory({
  points: 5, // Maximum 5 records per hour per user per school
  duration: 60 * 60,
});

// Per-user presence rate limiter (prevent spam of presence updates)
// NOT IP-based - tracks by userId + schoolSlug combination
const userPresenceRateLimiter = new RateLimiterMemory({
  points: 10, // Maximum 10 presence updates per hour per user per school
  duration: 60 * 60,
});

const SESSION_TOKEN_BYTES = 32;
const HOURLY_LIMIT_PER_USER = 6000;
const SCHOOL_HOURLY_LIMIT_FALLBACK = 6000;
const SCHOOL_HOURLY_LIMIT_COLLECTION = "schoolHourlyLimits";

const realtimeDb = getDatabase();

/**
 * Validate school slug format (alphanumeric, lowercase, no special chars)
 * @param {string} schoolSlug - School slug to validate
 * @return {boolean} True if valid
 */
const isValidSchoolSlug = (schoolSlug) => {
  if (!schoolSlug || typeof schoolSlug !== "string") {
    return false;
  }
  // Allow alphanumeric characters only, 1-100 chars
  const slugRegex = /^[a-z0-9]{1,100}$/;
  return slugRegex.test(schoolSlug);
};

/**
 * Validate user ID format
 * @param {string} userId - User ID to validate
 * @return {boolean} True if valid
 */
const isValidUserId = (userId) => {
  if (!userId || typeof userId !== "string") {
    return false;
  }
  // Allow alphanumeric, underscore, hyphen, 1-100 chars
  const userIdRegex = /^[a-zA-Z0-9_-]{1,100}$/;
  return userIdRegex.test(userId);
};

/**
 * Validate timestamp (must be within reasonable range)
 * @param {number} timestamp - Timestamp to validate
 * @return {boolean} True if valid
 */
const isValidTimestamp = (timestamp) => {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return false;
  }
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  const oneDayFromNow = now + (60 * 60 * 1000); // Allow 1 hour in future for clock skew
  return timestamp >= oneDayAgo && timestamp <= oneDayFromNow;
};

/**
 * Validate request size (prevent DoS attacks)
 * @param {object} data - Request data
 * @param {number} maxSize - Maximum size in bytes (default: 10KB)
 * @return {boolean} True if valid
 */
const validateRequestSize = (data, maxSize = 10240) => {
  try {
    const jsonString = JSON.stringify(data);
    return jsonString.length <= maxSize;
  } catch (error) {
    return false;
  }
};

/**
 * Detect suspicious patterns in requests (abuse detection)
 * @param {string} ip - IP address
 * @param {string} userId - User ID
 * @param {string} schoolSlug - School slug
 * @return {Promise<{isSuspicious: boolean, reason: string}>}
 */
const detectSuspiciousActivity = async (ip, userId, schoolSlug) => {
  try {
    // Check for rapid requests from same IP with different user IDs (bot detection)
    // This is a simplified check - in production, use Cloud Security Command Center
    const suspiciousPatterns = [];

    // Pattern 1: User ID doesn't match expected format (potential injection)
    if (userId && !isValidUserId(userId)) {
      suspiciousPatterns.push("Invalid user ID format");
    }

    // Pattern 2: School slug doesn't match expected format
    if (schoolSlug && !isValidSchoolSlug(schoolSlug)) {
      suspiciousPatterns.push("Invalid school slug format");
    }

    // Pattern 3: Very long user IDs (potential buffer overflow attempt)
    if (userId && userId.length > 100) {
      suspiciousPatterns.push("User ID too long");
    }

    // Pattern 4: IP address patterns (check for known bad IPs)
    // In production, integrate with Google Cloud Armor or Cloud Security Command Center
    if (ip === "unknown" || !ip || ip.length > 45) {
      suspiciousPatterns.push("Invalid IP address");
    }

    if (suspiciousPatterns.length > 0) {
      logger.warn("Suspicious activity detected", {
        ip,
        userId,
        schoolSlug,
        patterns: suspiciousPatterns,
      });
      return {
        isSuspicious: true,
        reason: suspiciousPatterns.join(", "),
      };
    }

    return {
      isSuspicious: false,
      reason: "",
    };
  } catch (error) {
    logger.error("Error detecting suspicious activity", {
      error: error.message,
      ip,
      userId,
      schoolSlug,
    });
    // On error, assume not suspicious to avoid blocking legitimate users
    return {
      isSuspicious: false,
      reason: "",
    };
  }
};

/**
 * Log security event for audit trail
 * @param {string} eventType - Type of security event
 * @param {object} eventData - Event data
 * @return {Promise<void>}
 */
const logSecurityEvent = async (eventType, eventData) => {
  try {
    // Log to Firestore for audit trail
    await firestore.collection("securityEvents").add({
      eventType,
      ...eventData,
      timestamp: FieldValue.serverTimestamp(),
      severity: eventData.severity || "info",
    });
  } catch (error) {
    // Don't throw - logging failures shouldn't block operations
    logger.error("Failed to log security event", {
      eventType,
      error: error.message,
    });
  }
};

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
 * Verify that a user actually exists in schoolOnlineUsers.
 * This prevents fake users from being added to schoolHourlyUsers.
 * @param {string} schoolSlug - School slug
 * @param {string} userId - User ID to verify
 * @return {Promise<boolean>} True if user exists online, false otherwise
 */
const verifyUserExistsOnline = async (schoolSlug, userId) => {
  try {
    if (!realtimeDb) {
      return false;
    }

    const onlineUserRef = realtimeDb.ref(`schoolOnlineUsers/${schoolSlug}/${userId}`);
    const snapshot = await onlineUserRef.once("value");
    const userData = snapshot.val();

    if (!userData) {
      return false;
    }

    // Verify user data structure and that they're actually online
    if (userData.online === true && userData.school === schoolSlug) {
      return true;
    }

    return false;
  } catch (error) {
    logger.error("Failed to verify user exists online", {
      schoolSlug,
      userId,
      error: error.message,
    });
    return false;
  }
};

/**
 * Record a user in the hourly cumulative tracker in RTDB.
 * This adds the user to schoolHourlyUsers which cumulates all users
 * who were online in the current hour (from schoolOnlineUsers).
 * Includes security validation and rate limiting.
 * Now requires user to exist in schoolOnlineUsers first.
 * @param {string} schoolSlug - School slug (URL-friendly name)
 * @param {string} userId - User-ID (from schoolOnlineUsers)
 * @param {boolean} skipVerification - Skip online verification (only for server-side backup)
 * @return {Promise<void>}
 */
const recordUserInHourlyTracker = async (schoolSlug, userId, skipVerification = false) => {
  try {
    if (!realtimeDb) {
      logger.warn("Realtime Database not available for hourly tracking");
      return;
    }

    // Security: Validate inputs
    if (!schoolSlug || !userId) {
      logger.warn("Missing schoolSlug or userId for hourly tracking", {
        schoolSlug,
        userId,
        hasSchoolSlug: !!schoolSlug,
        hasUserId: !!userId,
      });
      return;
    }

    // Security: Validate school slug format
    if (!isValidSchoolSlug(schoolSlug)) {
      logger.warn("Invalid school slug format for hourly tracking", {
        schoolSlug,
        userId,
      });
      return;
    }

    // Security: Validate user ID format
    if (!isValidUserId(userId)) {
      logger.warn("Invalid user ID format for hourly tracking", {
        schoolSlug,
        userId,
      });
      return;
    }

    // Security: Verify user exists in schoolOnlineUsers before recording
    // This prevents fake users from being added to hourly tracker
    if (!skipVerification) {
      const userExists = await verifyUserExistsOnline(schoolSlug, userId);
      if (!userExists) {
        logger.warn("Attempted to record user who is not online", {
          schoolSlug,
          userId,
        });
        // Reject fake users
        return;
      }
    }


    const hourWindowStart = getCurrentHourWindow();
    const hourWindowKey = hourWindowStart.toMillis().toString();

    // Security: Validate hour window key (must be numeric timestamp)
    if (!/^\d+$/.test(hourWindowKey)) {
      logger.error("Invalid hour window key generated", {
        schoolSlug,
        userId,
        hourWindowKey,
      });
      return;
    }

    // Add user to hourly cumulative tracker: schoolHourlyUsers/{schoolSlug}/{hourWindowKey}/{userId}
    // This cumulates all users who were online at any point in this hour
    const hourlyUserRef = realtimeDb.ref(
        `schoolHourlyUsers/${schoolSlug}/${hourWindowKey}/${userId}`,
    );

    // Set with timestamp - if user already exists, just update timestamp
    // Use transaction to preserve firstSeen if it already exists
    const currentData = await hourlyUserRef.once("value");
    const existingData = currentData.val();
    const now = Date.now();
    const firstSeen = existingData && existingData.firstSeen &&
        isValidTimestamp(existingData.firstSeen) ?
        existingData.firstSeen : now;

    // Security: Validate timestamps before writing
    if (!isValidTimestamp(now) || !isValidTimestamp(firstSeen)) {
      logger.error("Invalid timestamp for hourly user tracking", {
        schoolSlug,
        userId,
        now,
        firstSeen,
      });
      return;
    }

    await hourlyUserRef.set({
      timestamp: now,
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
 * Includes security validation.
 * @param {string} schoolSlug - School slug (URL-friendly name)
 * @return {Promise<number>} Number of unique users in the current hour
 */
const getUniqueUsersInPastHour = async (schoolSlug) => {
  try {
    if (!realtimeDb) {
      logger.warn("Realtime Database not available for user count");
      return 0;
    }

    // Security: Validate school slug format
    if (!isValidSchoolSlug(schoolSlug)) {
      logger.warn("Invalid school slug format for user count", {
        schoolSlug,
      });
      return 0;
    }


    const hourWindowStart = getCurrentHourWindow();
    const hourWindowKey = hourWindowStart.toMillis().toString();

    // Security: Validate hour window key
    if (!/^\d+$/.test(hourWindowKey)) {
      logger.error("Invalid hour window key generated", {
        schoolSlug,
        hourWindowKey,
      });
      return 0;
    }

    // Read from RTDB: schoolHourlyUsers/{schoolSlug}/{hourWindowKey}
    // This contains all users who were online at any point in this hour
    const hourlyUsersRef = realtimeDb.ref(`schoolHourlyUsers/${schoolSlug}/${hourWindowKey}`);
    const snapshot = await hourlyUsersRef.once("value");
    const hourlyUsers = snapshot.val();

    if (!hourlyUsers || typeof hourlyUsers !== "object") {
      return 0;
    }

    // Security: Validate and count unique userIds
    // Filter out any invalid user IDs
    const validUserIds = Object.keys(hourlyUsers).filter((uid) => isValidUserId(uid));
    return validUserIds.length;
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
 * Callable function to record a user in the hourly tracker (schoolHourlyUsers).
 * Secured with rate limiting, session validation, and input validation.
 * Only this function can write to schoolHourlyUsers - direct client writes are blocked.
 */
exports.recordHourlyUser = onCall({
  memory: "256MiB",
  timeoutSeconds: 10,
  maxInstances: 10,
}, async (request) => {
  const startTime = Date.now();
  const data = request.data || {};
  const {schoolSlug, userId} = data;
  const {ip, userAgent} = getRequestContext(request.rawRequest);

  // Security: Validate request size (prevent DoS)
  if (!validateRequestSize(data, 10240)) {
    await logSecurityEvent("request_size_exceeded", {
      ip,
      function: "recordHourlyUser",
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Request payload too large.");
  }

  // Security: Detect suspicious activity
  const suspicionCheck = await detectSuspiciousActivity(ip, userId, schoolSlug);
  if (suspicionCheck.isSuspicious) {
    await logSecurityEvent("suspicious_activity", {
      ip,
      userId,
      schoolSlug,
      reason: suspicionCheck.reason,
      function: "recordHourlyUser",
      severity: "warning",
    });
    throw new HttpsError("permission-denied", "Suspicious activity detected.");
  }

  // Validate inputs first
  if (typeof schoolSlug !== "string" || !schoolSlug.trim()) {
    await logSecurityEvent("invalid_input", {
      ip,
      function: "recordHourlyUser",
      field: "schoolSlug",
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Missing or invalid schoolSlug.");
  }

  if (typeof userId !== "string" || !userId.trim()) {
    await logSecurityEvent("invalid_input", {
      ip,
      function: "recordHourlyUser",
      field: "userId",
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Missing or invalid userId.");
  }

  // Validate school slug format
  const trimmedSlug = schoolSlug.trim();
  if (!isValidSchoolSlug(trimmedSlug)) {
    await logSecurityEvent("invalid_format", {
      ip,
      function: "recordHourlyUser",
      field: "schoolSlug",
      value: trimmedSlug,
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Invalid school slug format.");
  }

  // Validate user ID format
  const trimmedUserId = userId.trim();
  if (!isValidUserId(trimmedUserId)) {
    await logSecurityEvent("invalid_format", {
      ip,
      function: "recordHourlyUser",
      field: "userId",
      value: trimmedUserId,
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Invalid user ID format.");
  }

  // Additional per-user-ID rate limiting to prevent same user spam
  // Generate key from schoolSlug + userId combination
  const userRateLimitKey = `${trimmedSlug}:${trimmedUserId}`;
  try {
    await userHourlyRecordRateLimiter.consume(userRateLimitKey);
  } catch (error) {
    await logSecurityEvent("user_rate_limit_exceeded", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      function: "recordHourlyUser",
      severity: "warning",
    });
    logger.warn("User rate limit exceeded for recordHourlyUser", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      error: error.message,
    });
    throw new HttpsError("resource-exhausted", "Too many requests for this user — slow down.");
  }

  // Security: Verify user exists in schoolOnlineUsers before recording
  // This is the key security check that prevents fake users
  const userExists = await verifyUserExistsOnline(trimmedSlug, trimmedUserId);
  if (!userExists) {
    await logSecurityEvent("fake_user_attempt", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      userAgent,
      function: "recordHourlyUser",
      severity: "error",
    });
    logger.warn("Attempted to record fake user in hourly tracker", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
    });
    throw new HttpsError("permission-denied", "User must be online to be recorded.");
  }

  // Record user in hourly tracker (server-side write with all validations)
  // Verification is already done above, so skip it in the helper function
  try {
    await recordUserInHourlyTracker(trimmedSlug, trimmedUserId, true);

    // Log successful operation
    const duration = Date.now() - startTime;
    await logSecurityEvent("hourly_user_recorded", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      duration,
      function: "recordHourlyUser",
      severity: "info",
    });

    return {
      success: true,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    await logSecurityEvent("operation_failed", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      error: error.message,
      duration,
      function: "recordHourlyUser",
      severity: "error",
    });
    logger.error("Failed to record hourly user via callable function", {
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      ip,
      error: error.message,
    });
    // Don't expose internal errors to client
    throw new HttpsError("internal", "Failed to record user. Please try again.");
  }
});

/**
 * Secure Cloud Function to initialize online presence for a user.
 * Replaces direct client writes to schoolOnlineUsers with server-side validation.
 * @param {object} request - Firebase callable request
 * @return {Promise<{success: boolean, schoolSlug: string, userId: string}>}
 */
exports.initializeOnlinePresence = onCall({
  memory: "256MiB",
  timeoutSeconds: 10,
  maxInstances: 10,
}, async (request) => {
  const startTime = Date.now();
  const data = request.data || {};
  const {schoolSlug, userId} = data;
  const {ip, userAgent} = getRequestContext(request.rawRequest);

  // Security: Validate request size (prevent DoS)
  if (!validateRequestSize(data, 10240)) {
    await logSecurityEvent("request_size_exceeded", {
      ip,
      function: "initializeOnlinePresence",
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Request payload too large.");
  }

  // Security: Detect suspicious activity
  const suspicionCheck = await detectSuspiciousActivity(ip, userId, schoolSlug);
  if (suspicionCheck.isSuspicious) {
    await logSecurityEvent("suspicious_activity", {
      ip,
      userId,
      schoolSlug,
      reason: suspicionCheck.reason,
      function: "initializeOnlinePresence",
      severity: "warning",
    });
    throw new HttpsError("permission-denied", "Suspicious activity detected.");
  }

  // Validate inputs
  if (typeof schoolSlug !== "string" || !schoolSlug.trim()) {
    await logSecurityEvent("invalid_input", {
      ip,
      function: "initializeOnlinePresence",
      field: "schoolSlug",
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Missing or invalid schoolSlug.");
  }

  if (typeof userId !== "string" || !userId.trim()) {
    await logSecurityEvent("invalid_input", {
      ip,
      function: "initializeOnlinePresence",
      field: "userId",
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Missing or invalid userId.");
  }

  // Validate school slug format
  const trimmedSlug = schoolSlug.trim();
  if (!isValidSchoolSlug(trimmedSlug)) {
    await logSecurityEvent("invalid_format", {
      ip,
      function: "initializeOnlinePresence",
      field: "schoolSlug",
      value: trimmedSlug,
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Invalid school slug format.");
  }

  // Validate user ID format
  const trimmedUserId = userId.trim();
  if (!isValidUserId(trimmedUserId)) {
    await logSecurityEvent("invalid_format", {
      ip,
      function: "initializeOnlinePresence",
      field: "userId",
      value: trimmedUserId,
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Invalid user ID format.");
  }

  // Per-user rate limiting
  const userPresenceKey = `${trimmedSlug}:${trimmedUserId}`;
  try {
    await userPresenceRateLimiter.consume(userPresenceKey);
  } catch (error) {
    await logSecurityEvent("user_rate_limit_exceeded", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      function: "initializeOnlinePresence",
      severity: "warning",
    });
    logger.warn("User rate limit exceeded for initializeOnlinePresence", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      error: error.message,
    });
    throw new HttpsError("resource-exhausted", "Too many presence updates for this user — slow down.");
  }

  // Write to RTDB: schoolOnlineUsers/{schoolSlug}/{userId}
  // Only server (Cloud Functions) can write - clients blocked by RTDB rules
  try {
    if (!realtimeDb) {
      throw new Error("Realtime Database not available");
    }

    const onlineUserRef = realtimeDb.ref(`schoolOnlineUsers/${trimmedSlug}/${trimmedUserId}`);
    const now = Date.now();

    // Validate timestamp before writing
    if (!isValidTimestamp(now)) {
      logger.error("Invalid timestamp for online presence", {
        schoolSlug: trimmedSlug,
        userId: trimmedUserId,
        now,
      });
      throw new HttpsError("internal", "Invalid timestamp.");
    }

    // Set user as online with validated data
    await onlineUserRef.set({
      timestamp: now,
      online: true,
      school: trimmedSlug,
    });

    // Log successful operation
    const duration = Date.now() - startTime;
    await logSecurityEvent("online_presence_initialized", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      userAgent,
      duration,
      function: "initializeOnlinePresence",
      severity: "info",
    });

    logger.debug("User initialized online presence", {
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      ip,
    });

    return {
      success: true,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    await logSecurityEvent("operation_failed", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      error: error.message,
      duration,
      function: "initializeOnlinePresence",
      severity: "error",
    });
    logger.error("Failed to initialize online presence", {
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      ip,
      error: error.message,
    });

    // Don't expose internal errors to client
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Failed to initialize presence. Please try again.");
  }
});

/**
 * Secure Cloud Function to remove online presence when user disconnects.
 * Replaces direct client writes to schoolOnlineUsers with server-side validation.
 * @param {object} request - Firebase callable request
 * @return {Promise<{success: boolean, schoolSlug: string, userId: string}>}
 */
exports.removeOnlinePresence = onCall({
  memory: "256MiB",
  timeoutSeconds: 10,
  maxInstances: 10,
}, async (request) => {
  const startTime = Date.now();
  const data = request.data || {};
  const {schoolSlug, userId} = data;
  const {ip, userAgent} = getRequestContext(request.rawRequest);

  // Security: Validate request size (prevent DoS)
  if (!validateRequestSize(data, 10240)) {
    await logSecurityEvent("request_size_exceeded", {
      ip,
      function: "removeOnlinePresence",
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Request payload too large.");
  }

  // Security: Detect suspicious activity
  const suspicionCheck = await detectSuspiciousActivity(ip, userId, schoolSlug);
  if (suspicionCheck.isSuspicious) {
    await logSecurityEvent("suspicious_activity", {
      ip,
      userId,
      schoolSlug,
      reason: suspicionCheck.reason,
      function: "removeOnlinePresence",
      severity: "warning",
    });
    throw new HttpsError("permission-denied", "Suspicious activity detected.");
  }

  // Validate inputs
  if (typeof schoolSlug !== "string" || !schoolSlug.trim()) {
    await logSecurityEvent("invalid_input", {
      ip,
      function: "removeOnlinePresence",
      field: "schoolSlug",
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Missing or invalid schoolSlug.");
  }

  if (typeof userId !== "string" || !userId.trim()) {
    await logSecurityEvent("invalid_input", {
      ip,
      function: "removeOnlinePresence",
      field: "userId",
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Missing or invalid userId.");
  }

  // Validate school slug format
  const trimmedSlug = schoolSlug.trim();
  if (!isValidSchoolSlug(trimmedSlug)) {
    await logSecurityEvent("invalid_format", {
      ip,
      function: "removeOnlinePresence",
      field: "schoolSlug",
      value: trimmedSlug,
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Invalid school slug format.");
  }

  // Validate user ID format
  const trimmedUserId = userId.trim();
  if (!isValidUserId(trimmedUserId)) {
    await logSecurityEvent("invalid_format", {
      ip,
      function: "removeOnlinePresence",
      field: "userId",
      value: trimmedUserId,
      severity: "warning",
    });
    throw new HttpsError("invalid-argument", "Invalid user ID format.");
  }

  // Remove from RTDB: schoolOnlineUsers/{schoolSlug}/{userId}
  // Only server (Cloud Functions) can write - clients blocked by RTDB rules
  try {
    if (!realtimeDb) {
      throw new Error("Realtime Database not available");
    }

    const onlineUserRef = realtimeDb.ref(`schoolOnlineUsers/${trimmedSlug}/${trimmedUserId}`);

    // Remove user from online users
    await onlineUserRef.remove();

    // Log successful operation
    const duration = Date.now() - startTime;
    await logSecurityEvent("online_presence_removed", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      userAgent,
      duration,
      function: "removeOnlinePresence",
      severity: "info",
    });

    logger.debug("User removed online presence", {
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      ip,
    });

    return {
      success: true,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    await logSecurityEvent("operation_failed", {
      ip,
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      error: error.message,
      duration,
      function: "removeOnlinePresence",
      severity: "error",
    });
    logger.error("Failed to remove online presence", {
      schoolSlug: trimmedSlug,
      userId: trimmedUserId,
      ip,
      error: error.message,
    });

    // Don't expose internal errors to client
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Failed to remove presence. Please try again.");
  }
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
  // Security: Only server (Cloud Functions) can write to schoolStats
  if (schoolSlug && realtimeDb) {
    try {
      // Security: Validate school slug before proceeding
      if (!isValidSchoolSlug(schoolSlug)) {
        logger.warn("Invalid school slug format for stats update", {
          schoolId: trimmedId,
          schoolSlug,
        });
        // Don't update stats if slug is invalid
      } else {
        // Recalculate user count right before writing to ensure we use the current hour's data
        const currentUserCount = await getUniqueUsersInPastHour(schoolSlug);

        // Security: Validate user count (reasonable bounds)
        const validUserCount = Math.max(0, Math.min(currentUserCount, 10000)); // Max 10k users per hour
        const currentHourlyLimit = validUserCount * HOURLY_LIMIT_PER_USER;
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
            // Security: Validate score increase (reasonable bounds)
            hourlyScoreIncrease = Math.max(0, Math.min(hourlyScoreIncrease, 100000000)); // Max 100M
          }
        }

        // Calculate remaining quota based on current hourly limit
        const currentRemainingQuota = Math.max(0, currentHourlyLimit - hourlyScoreIncrease);
        const currentLimitReached = hourlyScoreIncrease >= currentHourlyLimit;
        const updateTime = Date.now();

        // Security: Validate all values before writing
        if (!isValidTimestamp(updateTime)) {
          logger.error("Invalid timestamp for stats update", {
            schoolSlug,
            updateTime,
          });
          return;
        }

        // Write to RTDB: schoolStats/{schoolSlug}/hourlyScoreIncrease and hourlyLimit
        // Note: RTDB rules block client writes, only server (Cloud Functions) can write
        const statsRef = realtimeDb.ref(`schoolStats/${schoolSlug}`);
        await statsRef.set({
          hourlyScoreIncrease: hourlyScoreIncrease, // Score increase since hour started
          hourlyLimit: currentHourlyLimit > 0 ? currentHourlyLimit : SCHOOL_HOURLY_LIMIT_FALLBACK,
          uniqueUsers: validUserCount,
          remainingQuota: currentRemainingQuota,
          limitReached: currentLimitReached,
          fallbackInUse: currentFallback,
          updatedAt: updateTime,
        });

        logger.debug("Updated school stats in RTDB", {
          schoolSlug,
          hourlyScoreIncrease,
          hourlyLimit: currentHourlyLimit,
          uniqueUsers: validUserCount,
        });
      }
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
 * Scheduled function that runs every hour to clean up old schoolHourlyUsers data
 * Deletes hourly user tracking data older than 2 hours to prevent RTDB bloat
 */
exports.cleanupOldHourlyUsers = onSchedule({
  schedule: "0 * * * *", // Run every hour at minute 0
  timeZone: "UTC",
  memory: "256MiB",
  timeoutSeconds: 300,
}, async (event) => {
  const db = getDatabase();
  const startTime = Date.now();
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const currentHourMs = now.getTime();
  // Keep data from current hour and previous hour (2 hours total)
  const cutoffHourMs = currentHourMs - (2 * 60 * 60 * 1000);

  logger.info("Starting hourly users cleanup", {
    currentTime: now.toISOString(),
    currentHourMs,
    cutoffHourMs,
    cutoffTime: new Date(cutoffHourMs).toISOString(),
  });

  try {
    const schoolHourlyUsersRef = db.ref("schoolHourlyUsers");
    const snapshot = await schoolHourlyUsersRef.once("value");

    if (!snapshot.exists()) {
      logger.info("No schoolHourlyUsers data found - nothing to clean");
      return;
    }

    const schoolHourlyUsers = snapshot.val();
    let totalDeleted = 0;
    let schoolsProcessed = 0;

    // Process each school
    for (const [schoolSlug, hourWindows] of Object.entries(schoolHourlyUsers)) {
      if (!hourWindows || typeof hourWindows !== "object") continue;

      schoolsProcessed++;
      let schoolDeleted = 0;

      // Process each hour window
      for (const [hourWindowKey] of Object.entries(hourWindows)) {
        const hourWindowMs = parseInt(hourWindowKey, 10);

        // Delete if older than cutoff (more than 2 hours old)
        if (!isNaN(hourWindowMs) && hourWindowMs < cutoffHourMs) {
          try {
            await db.ref(`schoolHourlyUsers/${schoolSlug}/${hourWindowKey}`).remove();
            schoolDeleted++;
            totalDeleted++;

            logger.debug("Deleted old hourly window", {
              schoolSlug,
              hourWindowKey,
              hourWindowTime: new Date(hourWindowMs).toISOString(),
            });
          } catch (error) {
            logger.error("Error deleting hourly window", {
              schoolSlug,
              hourWindowKey,
              error: error.message,
            });
          }
        }
      }

      if (schoolDeleted > 0) {
        logger.info(`Cleaned up ${schoolDeleted} old hourly windows for school: ${schoolSlug}`);
      }
    }

    logger.info("Hourly users cleanup completed", {
      schoolsProcessed,
      totalWindowsDeleted: totalDeleted,
      duration: `${Date.now() - startTime}ms`,
    });
  } catch (error) {
    logger.error("Error during hourly users cleanup", {
      error: error.message,
      stack: error.stack,
    });
  }
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
