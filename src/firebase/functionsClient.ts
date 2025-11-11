import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./config";

const functions = getFunctions(app);
const updateScoreCallable = httpsCallable(functions, "updateScore");
const addSchoolCallable = httpsCallable(functions, "addSchool");
const createSessionCallable = httpsCallable(functions, "createClickerSession");

const SESSION_STORAGE_KEY = "schoolClicker_sessionToken";

let pendingSessionPromise: Promise<string> | null = null;

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

  const payload: Record<string, unknown> = {
    schoolId,
    delta,
    sessionToken,
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
