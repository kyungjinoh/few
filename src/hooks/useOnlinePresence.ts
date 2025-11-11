import { useState, useEffect, useMemo } from 'react';
import { onlinePresenceService, OnlineUsersData } from '../firebase/onlinePresenceService';

export const useOnlinePresence = (schoolSlug: string) => {
  const [onlineData, setOnlineData] = useState<OnlineUsersData>({
    totalOnline: 0,
    lastUpdated: Date.now()
  });
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!schoolSlug) {
      console.log('⚠️ No school slug provided, skipping online presence');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let unsubscribe: (() => void) | null = null;

    const initializeOnlineTracking = async () => {
      try {
        // Reduced logging for production performance
        
        // Initialize presence tracking for this specific school
        await onlinePresenceService.initializePresence(schoolSlug);

        // Small delay to ensure data is written before subscribing
        await new Promise(resolve => setTimeout(resolve, 200));

        // Subscribe to online count changes for this school
        unsubscribe = onlinePresenceService.subscribeToSchoolOnlineCount(schoolSlug, (data) => {
          setOnlineData(data);
          setIsConnected(true); // Only set connected when we successfully get data
          setIsLoading(false); // Stop loading when we get data
        });
      } catch (error) {
        console.error('❌ Error initializing school online tracking:', error);
        setIsConnected(false);
        setIsLoading(false); // Stop loading on error
        // Set fallback data when offline
        setOnlineData({
          totalOnline: 0,
          lastUpdated: Date.now()
        });
      }
    };

    initializeOnlineTracking();

    // Cleanup function - this runs when schoolSlug changes or component unmounts
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      setIsConnected(false);
      setIsLoading(true); // Reset loading state for next school
      // Note: Don't call removePresence() here - let the service handle school switching
    };
  }, [schoolSlug]);

  // Handle cleanup when user actually leaves the website
  useEffect(() => {
    const handleBeforeUnload = () => {
      onlinePresenceService.removePresence();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Add a display boost (25-35) to make it look more active
  const displayBoost = useMemo(() => {
    // Generate a consistent boost based on school slug to avoid changing numbers
    const hash = schoolSlug.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return (hash % 11) + 25; // 25-35
  }, [schoolSlug]);

  return {
    totalOnline: onlineData.totalOnline + displayBoost,
    lastUpdated: onlineData.lastUpdated,
    isConnected,
    isLoading
  };
};
