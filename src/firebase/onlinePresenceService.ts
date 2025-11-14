import { realtimeDb } from './config';
import { ref, onValue } from 'firebase/database';
import { callRecordHourlyUser, callInitializeOnlinePresence, callRemoveOnlinePresence } from './functionsClient';

export interface OnlineUsersData {
  totalOnline: number;
  lastUpdated: number;
}

class OnlinePresenceService {
  private userRef: any = null;
  private currentSchool: string | null = null;
  private userId: string | null = null;

  /**
   * Generate or get existing user ID that persists across tabs/sessions
   */
  private getUserId(): string {
    if (this.userId) return this.userId;
    
    // Try to get existing user ID from localStorage
    let userId = localStorage.getItem('schoolClicker_userId');
    
    if (!userId) {
      // Generate a new unique user ID
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('schoolClicker_userId', userId);
      // User ID generated silently
    }
    
    this.userId = userId;
    return userId;
  }

  /**
   * Initialize presence tracking for a user on a specific school
   * This should be called when a user visits a school page
   */
  async initializePresence(schoolSlug: string): Promise<void> {
    try {
      // Check if Realtime Database is available (for reads/subscriptions)
      if (!realtimeDb) {
        console.warn('⚠️ Realtime Database not initialized - online presence disabled');
        return;
      }
      
      // Don't reinitialize if already on the same school
      if (this.currentSchool === schoolSlug && this.userRef) {
        return;
      }

      // If user is already on a different school, remove them first
      if (this.userRef && this.currentSchool && this.currentSchool !== schoolSlug) {
        await this.removePresence();
      }

      this.currentSchool = schoolSlug;
      const userId = this.getUserId();
      
      // Use secure Cloud Function instead of direct RTDB write to prevent abuse
      // This ensures all writes go through rate limiting and validation
      try {
        await callInitializeOnlinePresence(schoolSlug, userId);
      } catch (error: any) {
        // Log error but continue - presence is non-critical
        // Check if it's a rate limit error (expected) vs other errors
        const errorCode = error?.code || error?.details?.code;
        if (errorCode === 'functions/resource-exhausted' || errorCode === 'resource-exhausted') {
          // Rate limit exceeded - this is expected and non-critical
          console.debug('Rate limit reached for online presence (non-critical)');
        } else {
          // Other errors - log for debugging
          console.warn('⚠️ Failed to initialize online presence via Cloud Function', {
            error: error?.message || error,
            code: errorCode,
          });
        }
        // Still set userRef for cleanup even if initialization failed
      }

      // Create reference for reading/disconnect tracking (client can still read)
      this.userRef = ref(realtimeDb, `schoolOnlineUsers/${schoolSlug}/${userId}`);

      // Also add user to hourly cumulative tracker (schoolHourlyUsers)
      // This cumulates all users who were online at any point in the current hour
      // The hourly tracker persists even when user disconnects (unlike schoolOnlineUsers)
      // Use secure Cloud Function instead of direct RTDB write to prevent abuse
      try {
        await callRecordHourlyUser(schoolSlug, userId);
      } catch (hourlyError) {
        // Silently fail - hourly tracking is secondary to online presence
        // Don't log to reduce console noise
        // The server-side backup in updateScore will still record the user
      }

      // Note: onDisconnect is no longer needed since removal is handled by Cloud Function
      // But we keep userRef for tracking purposes

    } catch (error) {
      console.error('❌ Error initializing presence:', error);
      console.warn('💡 Make sure Firebase Cloud Functions are enabled and deployed');
    }
  }

  /**
   * Remove presence tracking when user leaves
   */
  async removePresence(): Promise<void> {
    if (this.currentSchool) {
      const userId = this.getUserId();
      try {
        // Use secure Cloud Function instead of direct RTDB write to prevent abuse
        await callRemoveOnlinePresence(this.currentSchool, userId);
      } catch (error: any) {
        // Silently handle - removal is cleanup operation
        // Only log non-rate-limit errors
        const errorCode = error?.code || error?.details?.code;
        if (errorCode !== 'functions/resource-exhausted' && errorCode !== 'resource-exhausted') {
          console.debug('Failed to remove online presence (cleanup operation)', {
            error: error?.message || error,
            code: errorCode,
          });
        }
      } finally {
        // Always cleanup local state
        this.userRef = null;
        this.currentSchool = null;
      }
    }
  }

  /**
   * Subscribe to online users count changes for a specific school
   * @param schoolSlug The school to monitor
   * @param callback Function to call when online count changes
   * @returns Unsubscribe function
   */
  subscribeToSchoolOnlineCount(schoolSlug: string, callback: (data: OnlineUsersData) => void): () => void {
    try {
      const schoolUsersRef = ref(realtimeDb, `schoolOnlineUsers/${schoolSlug}`);
      const unsubscribe = onValue(schoolUsersRef, (snapshot) => {
        const connectedUsers = snapshot.val();
        const count = connectedUsers ? Object.keys(connectedUsers).length : 0;
        
        // Online count updated (logging reduced for performance)
        
        callback({
          totalOnline: count,
          lastUpdated: Date.now()
        });
      }, (error) => {
        console.error('❌ Error subscribing to school online count:', error);
        console.warn('💡 Make sure Firebase Realtime Database is enabled and rules are set');
        // Provide fallback data on error
        callback({
          totalOnline: 0,
          lastUpdated: Date.now()
        });
      });

      return unsubscribe;
    } catch (error) {
      console.error('❌ Error creating school subscription:', error);
      // Return a no-op function if subscription fails
      return () => {};
    }
  }

  /**
   * Get current online count for a specific school (one-time read)
   */
  async getCurrentSchoolOnlineCount(schoolSlug: string): Promise<number> {
    return new Promise((resolve) => {
      const schoolUsersRef = ref(realtimeDb, `schoolOnlineUsers/${schoolSlug}`);
      onValue(schoolUsersRef, (snapshot) => {
        const connectedUsers = snapshot.val();
        const count = connectedUsers ? Object.keys(connectedUsers).length : 0;
        resolve(count);
      }, { onlyOnce: true });
    });
  }
}

// Export a singleton instance
export const onlinePresenceService = new OnlinePresenceService();
