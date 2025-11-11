import { useState, useEffect, useRef } from 'react';
import { 
  subscribeToActiveUsersCount, 
  startHeartbeat,
  getActiveUsersCount 
} from '../firebase/activeUserService';

export const useActiveUsers = (schoolSlug: string | null) => {
  const [activeUsersCount, setActiveUsersCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const cleanupRef = useRef<(() => void) | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!schoolSlug) {
      setActiveUsersCount(0);
      setIsLoading(false);
      return;
    }

    // Get initial count (will use cache if available)
    const getInitialCount = async () => {
      try {
        const count = await getActiveUsersCount(schoolSlug);
        setActiveUsersCount(count);
        setIsLoading(false);
      } catch (error) {
        console.error('Error getting initial active users count:', error);
        setIsLoading(false);
      }
    };

    // Only fetch initial count if we don't have recent cached data
    getInitialCount();

    // Start heartbeat to keep this user active
    cleanupRef.current = startHeartbeat(schoolSlug);

    // Subscribe to real-time updates
    unsubscribeRef.current = subscribeToActiveUsersCount(
      schoolSlug,
      (count) => {
        setActiveUsersCount(count);
        setIsLoading(false);
      }
    );

    // Cleanup function
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [schoolSlug]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  return {
    activeUsersCount,
    isLoading,
    schoolSlug
  };
};
