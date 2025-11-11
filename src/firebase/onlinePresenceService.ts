import { realtimeDb } from './config';
import { ref, onValue, push, onDisconnect, serverTimestamp, remove, set } from 'firebase/database';

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
      // Check if Realtime Database is available
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
      const schoolUsersRef = ref(realtimeDb, `schoolOnlineUsers/${schoolSlug}`);
      
      // Use the consistent user ID instead of auto-generated push ID
      this.userRef = ref(realtimeDb, `schoolOnlineUsers/${schoolSlug}/${userId}`);
      
      // Check if push was successful
      if (!this.userRef) {
        throw new Error('Failed to create user reference - check database connection');
      }
      
      // Set the user as online on this specific school
      await set(this.userRef, {
        timestamp: serverTimestamp(),
        online: true,
        school: schoolSlug
      });

      // Remove the user when they disconnect
      await onDisconnect(this.userRef).remove();

    } catch (error) {
      console.error('❌ Error initializing presence:', error);
      console.warn('💡 Make sure Firebase Realtime Database is enabled in Firebase Console');
    }
  }

  /**
   * Remove presence tracking when user leaves
   */
  async removePresence(): Promise<void> {
    if (this.userRef && this.currentSchool) {
      try {
        await remove(this.userRef);
        this.userRef = null;
        this.currentSchool = null;
      } catch (error) {
        console.error('❌ Error removing presence:', error);
        // Force cleanup even if removal failed
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
