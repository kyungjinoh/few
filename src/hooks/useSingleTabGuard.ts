import { useEffect, useMemo, useState } from "react";

const ACTIVE_TAB_KEY = "schoolClicker_active_tab_id";
const HEARTBEAT_KEY = "schoolClicker_active_tab_heartbeat";
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 5000;

export const useSingleTabGuard = () => {
  const [isBlocked, setIsBlocked] = useState(false);
  const tabId = useMemo(
      () => `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const updateHeartbeat = () => {
      localStorage.setItem(HEARTBEAT_KEY, Date.now().toString());
    };

    const claimActiveTab = () => {
      localStorage.setItem(ACTIVE_TAB_KEY, tabId);
      updateHeartbeat();
      setIsBlocked(false);
    };

    const evaluate = () => {
      const activeTab = localStorage.getItem(ACTIVE_TAB_KEY);
      const heartbeatRaw = localStorage.getItem(HEARTBEAT_KEY);
      const heartbeat = heartbeatRaw ? parseInt(heartbeatRaw, 10) : 0;
      const heartbeatExpired = Date.now() - heartbeat > HEARTBEAT_TIMEOUT_MS;

      if (!activeTab || heartbeatExpired) {
        claimActiveTab();
        return;
      }

      if (activeTab === tabId) {
        setIsBlocked(false);
        updateHeartbeat();
      } else {
        setIsBlocked(true);
      }
    };

    evaluate();

    const intervalId = window.setInterval(() => {
      evaluate();
    }, HEARTBEAT_INTERVAL_MS);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === ACTIVE_TAB_KEY || event.key === HEARTBEAT_KEY) {
        evaluate();
      }
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        evaluate();
      }
    };

    const cleanup = () => {
      window.clearInterval(intervalId);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", cleanup);
      if (localStorage.getItem(ACTIVE_TAB_KEY) === tabId) {
        localStorage.removeItem(ACTIVE_TAB_KEY);
        localStorage.removeItem(HEARTBEAT_KEY);
      }
    };

    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", cleanup);

    return cleanup;
  }, [tabId]);

  return {isBlocked};
};

