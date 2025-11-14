import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./config";

const functions = getFunctions(app);
const updateScoreCallable = httpsCallable(functions, "updateScore");
const addSchoolCallable = httpsCallable(functions, "addSchool");
const createSessionCallable = httpsCallable(functions, "createClickerSession");

const SESSION_STORAGE_KEY = "schoolClicker_sessionToken";
const CLIENT_ID_COOKIE_NAME = "_ga_school_clicker"; // Similar to GA4's _ga cookie (Device ID)
const CLIENT_ID_COOKIE_EXPIRY_DAYS = 730; // 2 years, same as GA4
const USER_ID_STORAGE_KEY = "schoolClicker_userId"; // User-ID (persistent user identifier)

let pendingSessionPromise: Promise<string> | null = null;

/**
 * Get or set a cookie value.
 * @param name Cookie name
 * @param value Cookie value
 * @param days Days until expiration
 */
const setCookie = (name: string, value: string, days: number): void => {
  if (typeof document === "undefined") return;

  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
};

/**
 * Get a cookie value by name.
 * @param name Cookie name
 * @returns Cookie value or null
 */
const getCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;

  const nameEQ = name + "=";
  const cookies = document.cookie.split(";");
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i];
    while (cookie.charAt(0) === " ") {
      cookie = cookie.substring(1, cookie.length);
    }
    if (cookie.indexOf(nameEQ) === 0) {
      return cookie.substring(nameEQ.length, cookie.length);
    }
  }
  return null;
};

/**
 * Generate a GA4-style Client ID.
 * Format: {timestamp}.{random} (same format as GA4's _ga cookie)
 * @returns Client ID string
 */
const generateClientId = (): string => {
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
  const random = Math.floor(Math.random() * 2147483647); // Random number (max 32-bit int)
  return `${timestamp}.${random}`;
};

/**
 * Get or create a GA4-style Client ID from cookie.
 * This mimics GA4's _ga cookie behavior - persists across sessions for 2 years.
 * This is the Device ID (client_id / app_instance_id) that identifies the device/browser.
 * @returns Client ID string in GA4 format (timestamp.random)
 */
const getClientId = (): string => {
  if (typeof window === "undefined") {
    return "unknown";
  }

  try {
    // Try to get existing Client ID from cookie (like GA4's _ga cookie)
    let clientId = getCookie(CLIENT_ID_COOKIE_NAME);

    if (!clientId) {
      // Generate a new GA4-style Client ID
      clientId = generateClientId();
      // Store in cookie with 2-year expiration (same as GA4)
      setCookie(CLIENT_ID_COOKIE_NAME, clientId, CLIENT_ID_COOKIE_EXPIRY_DAYS);
    }

    return clientId;
  } catch (error) {
    console.warn("Unable to read/write Client ID cookie", error);
    // Fallback: try localStorage if cookies are blocked
    try {
      const fallbackId = localStorage.getItem(CLIENT_ID_COOKIE_NAME);
      if (fallbackId) return fallbackId;
      const newId = generateClientId();
      localStorage.setItem(CLIENT_ID_COOKIE_NAME, newId);
      return newId;
    } catch (e) {
      return "unknown";
    }
  }
};

/**
 * Get or create a User-ID from localStorage.
 * This is a persistent user identifier (like GA4's User-ID).
 * Prefer User-ID over Client ID for unique user counting when available.
 * @returns User-ID string or null if unavailable
 */
const getUserId = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    let userId = localStorage.getItem(USER_ID_STORAGE_KEY);
    if (!userId) {
      // Generate a new unique user ID
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem(USER_ID_STORAGE_KEY, userId);
    }
    return userId;
  } catch (error) {
    console.warn("Unable to read/write User-ID from storage", error);
    return null;
  }
};

const getStoredSessionToken = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to read session token from storage", error);
    return null;
  }
};

const storeSessionToken = (token: string) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch (error) {
    console.warn("Unable to persist session token", error);
  }
};

const clearStoredSessionToken = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to clear session token", error);
  }
};

const requestNewSessionToken = async (): Promise<string> => {
  if (typeof window === "undefined") {
    throw new Error("Session tokens can only be issued in a browser environment.");
  }

  const response = await createSessionCallable({
    userAgent: navigator.userAgent,
  });

  const token = (response.data as any)?.sessionToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Failed to obtain session token from server.");
  }

  storeSessionToken(token);
  return token;
};

export const ensureSessionToken = async (): Promise<string> => {
  const existingToken = getStoredSessionToken();
  if (existingToken) {
    return existingToken;
  }

  if (!pendingSessionPromise) {
    pendingSessionPromise = requestNewSessionToken()
        .catch((error) => {
          clearStoredSessionToken();
          throw error;
        })
        .finally(() => {
          pendingSessionPromise = null;
        });
  }

  return pendingSessionPromise;
};

interface UpdateScoreOptions {
  captchaToken?: string;
  userAgentOverride?: string;
}

export const callUpdateScore = async (
  schoolId: string,
  delta: number,
  options: UpdateScoreOptions = {},
): Promise<void> => {
  const sessionToken = await ensureSessionToken();
  const clientId = getClientId(); // Device ID (GA4 Client ID / app_instance_id)
  const userId = getUserId(); // User-ID (persistent user identifier)

  const payload: Record<string, unknown> = {
    schoolId,
    delta,
    sessionToken,
    clientId, // Device ID (GA4 Client ID - identifies device/browser)
    userId, // User-ID (identifies the user - prefer this for unique counting)
    clientContext: {
      userAgent: options.userAgentOverride ?? (typeof navigator !== "undefined" ? navigator.userAgent : undefined),
    },
  };

  if (options.captchaToken) {
    payload.captchaToken = options.captchaToken;
  }

  try {
    await updateScoreCallable(payload);
  } catch (error: any) {
    const code: string | undefined = error?.code;
    const detailsCode: string | undefined = error?.details?.code;

    // Reset the session token if the backend says it is invalid or expired.
    if (code === "functions/unauthenticated" || detailsCode === "INVALID_SESSION") {
      clearStoredSessionToken();
    }

    // If the session was blocked we should avoid reusing the token.
    if (detailsCode === "TEMP_BLOCK") {
      clearStoredSessionToken();
    }

    throw error;
  }
};

export const resetSessionSecurityState = () => {
  clearStoredSessionToken();
  pendingSessionPromise = null;
};

interface AddSchoolPayload {
  schoolName: string;
  region: string;
  logoUrl?: string;
  requesterEmail: string;
}

interface AddSchoolResponse {
  schoolId: string;
}

export const callAddSchool = async (payload: AddSchoolPayload): Promise<AddSchoolResponse> => {
  const response = await addSchoolCallable(payload);
  return response.data as AddSchoolResponse;
};
