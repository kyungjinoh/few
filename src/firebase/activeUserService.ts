import { 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  getDocs, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy,
  serverTimestamp,
  Timestamp 
} from 'firebase/firestore';
import { db } from './config';

export interface ActiveUser {
  id: string;
  schoolSlug: string;
  userId: string;
  lastSeen: Timestamp;
  userAgent: string;
  isActive: boolean;
}

const ACTIVE_USERS_COLLECTION = 'activeUsers';
const SCHOOL_BONUSES_COLLECTION = 'schoolBonuses';
const HEARTBEAT_INTERVAL = 60000; // 60 seconds (reduced from 30s)
const USER_TIMEOUT = 120000; // 2 minutes (increased from 1 minute)
const CACHE_DURATION = 30000; // 30 seconds cache for counts
const SUBSCRIPTION_THROTTLE = 5000; // 5 seconds minimum between updates

// Cache for active user counts
const activeUserCache = new Map<string, { count: number; timestamp: number; bonus: number }>();
// Cache for school bonuses
const schoolBonusCache = new Map<string, { bonus: number; timestamp: number }>();

// Get or create a permanent bonus for a specific school with caching
const getSchoolBonus = async (schoolSlug: string): Promise<number> => {
  // Check cache first
  const cached = schoolBonusCache.get(schoolSlug);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION * 10) { // Cache bonuses for 5 minutes
    return cached.bonus;
  }

  try {
    const bonusDoc = doc(db, SCHOOL_BONUSES_COLLECTION, schoolSlug);
    const bonusSnapshot = await getDoc(bonusDoc);
    
    let bonus: number;
    if (bonusSnapshot.exists()) {
      bonus = bonusSnapshot.data().bonus || 0;
    } else {
      // Create a new permanent bonus for this school
      bonus = Math.floor(Math.random() * 16) + 30; // 30-45
      await setDoc(bonusDoc, {
        schoolSlug,
        bonus: bonus,
        createdAt: serverTimestamp()
      });
    }
    
    // Cache the result
    schoolBonusCache.set(schoolSlug, { bonus, timestamp: Date.now() });
    return bonus;
  } catch (error) {
    console.error('Error getting school bonus:', error);
    // Fallback to a consistent bonus based on school slug
    const hash = schoolSlug.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const fallbackBonus = (hash % 16) + 30; // 30-45 based on school name hash
    
    // Cache the fallback too
    schoolBonusCache.set(schoolSlug, { bonus: fallbackBonus, timestamp: Date.now() });
    return fallbackBonus;
  }
};

// Generate a unique user ID for this session
const generateUserId = (): string => {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Get or create user ID for this session
const getUserId = (): string => {
  let userId = sessionStorage.getItem('schoolClicker_userId');
  if (!userId) {
    userId = generateUserId();
    sessionStorage.setItem('schoolClicker_userId', userId);
  }
  return userId;
};

// Add or update active user
export const addActiveUser = async (schoolSlug: string): Promise<void> => {
  try {
    const userId = getUserId();
    const userDoc = {
      schoolSlug,
      userId,
      lastSeen: serverTimestamp(),
      userAgent: navigator.userAgent,
      isActive: true
    };

    const docRef = doc(collection(db, ACTIVE_USERS_COLLECTION), userId);
    await setDoc(docRef, userDoc, { merge: true });
  } catch (error: any) {
    // Handle permission errors gracefully - don't spam console
    if (error?.code === 'permission-denied') {
      console.warn('Active user tracking disabled - Firebase permissions not configured');
      return;
    }
    console.error('Error adding active user:', error);
  }
};

// Remove active user
export const removeActiveUser = async (): Promise<void> => {
  try {
    const userId = getUserId();
    const docRef = doc(db, ACTIVE_USERS_COLLECTION, userId);
    await deleteDoc(docRef);
  } catch (error: any) {
    // Handle permission errors gracefully
    if (error?.code === 'permission-denied') {
      return; // Silent fail for permission errors
    }
    console.error('Error removing active user:', error);
  }
};

// Get active users count for a specific school with caching
export const getActiveUsersCount = async (schoolSlug: string): Promise<number> => {
  // Check cache first
  const cached = activeUserCache.get(schoolSlug);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.count + cached.bonus;
  }

  try {
    const q = query(
      collection(db, ACTIVE_USERS_COLLECTION),
      where('schoolSlug', '==', schoolSlug),
      where('isActive', '==', true)
    );
    
    const querySnapshot = await getDocs(q);
    const actualCount = querySnapshot.size;
    const schoolBonus = await getSchoolBonus(schoolSlug);
    const totalCount = actualCount + schoolBonus;
    
    // Cache the result
    activeUserCache.set(schoolSlug, { 
      count: actualCount, 
      timestamp: Date.now(), 
      bonus: schoolBonus 
    });
    
    return totalCount;
  } catch (error: any) {
    // Handle permission errors gracefully - use localStorage fallback
    if (error?.code === 'permission-denied') {
      console.warn('Active user tracking disabled - Firebase permissions not configured');
      // Return a fallback count from localStorage
      const fallbackCount = localStorage.getItem(`fallback_active_users_${schoolSlug}`);
      const baseCount = fallbackCount ? parseInt(fallbackCount, 10) : Math.floor(Math.random() * 10) + 1;
      const schoolBonus = await getSchoolBonus(schoolSlug);
      const totalCount = baseCount + schoolBonus;
      
      // Cache the fallback result
      activeUserCache.set(schoolSlug, { 
        count: baseCount, 
        timestamp: Date.now(), 
        bonus: schoolBonus 
      });
      
      return totalCount;
    }
    console.error('Error getting active users count:', error);
    const schoolBonus = await getSchoolBonus(schoolSlug);
    return schoolBonus; // Even on error, return the bonus
  }
};

// Subscribe to active users count changes for a school with throttling
export const subscribeToActiveUsersCount = (
  schoolSlug: string,
  callback: (count: number) => void
): (() => void) => {
  // Use cached data if available and recent
  const cached = activeUserCache.get(schoolSlug);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    callback(cached.count + cached.bonus);
  }

  const q = query(
    collection(db, ACTIVE_USERS_COLLECTION),
    where('schoolSlug', '==', schoolSlug),
    where('isActive', '==', true)
  );

  // Get school bonus once and cache it for this subscription
  let schoolBonus: number | null = null;
  let lastUpdateTime = 0;
  
  const initializeBonus = async () => {
    schoolBonus = await getSchoolBonus(schoolSlug);
  };
  
  initializeBonus();

  return onSnapshot(q, async (snapshot) => {
    // Throttle updates to reduce Firebase costs
    const now = Date.now();
    if (now - lastUpdateTime < SUBSCRIPTION_THROTTLE) {
      return; // Skip this update
    }
    lastUpdateTime = now;

    const actualCount = snapshot.size;
    // Ensure we have the school bonus
    if (schoolBonus === null) {
      schoolBonus = await getSchoolBonus(schoolSlug);
    }
    
    const totalCount = actualCount + schoolBonus;
    
    // Update cache
    activeUserCache.set(schoolSlug, { 
      count: actualCount, 
      timestamp: now, 
      bonus: schoolBonus 
    });
    
    callback(totalCount);
  }, async (error: any) => {
    // Handle permission errors gracefully - use localStorage fallback
    if (error?.code === 'permission-denied') {
      console.warn('Active user tracking disabled - Firebase permissions not configured');
      // Use localStorage fallback with periodic updates
      const fallbackCount = localStorage.getItem(`fallback_active_users_${schoolSlug}`);
      const baseCount = fallbackCount ? parseInt(fallbackCount, 10) : Math.floor(Math.random() * 10) + 1;
      
      if (schoolBonus === null) {
        schoolBonus = await getSchoolBonus(schoolSlug);
      }
      callback(baseCount + schoolBonus);
      
      // Set up a fallback interval to simulate user count changes (less frequent)
      const interval = setInterval(async () => {
        const currentCount = parseInt(localStorage.getItem(`fallback_active_users_${schoolSlug}`) || '1', 10);
        const newCount = Math.max(1, currentCount + Math.floor(Math.random() * 3) - 1);
        localStorage.setItem(`fallback_active_users_${schoolSlug}`, newCount.toString());
        
        if (schoolBonus === null) {
          schoolBonus = await getSchoolBonus(schoolSlug);
        }
        
        const totalCount = newCount + schoolBonus;
        
        // Update cache
        activeUserCache.set(schoolSlug, { 
          count: newCount, 
          timestamp: Date.now(), 
          bonus: schoolBonus 
        });
        
        callback(totalCount);
      }, 30000); // Update every 30 seconds (reduced from 10s)
      
      // Return cleanup function
      return () => clearInterval(interval);
    }
    console.error('Error in active users subscription:', error);
    if (schoolBonus === null) {
      schoolBonus = await getSchoolBonus(schoolSlug);
    }
    callback(schoolBonus); // Even on error, return the bonus
  });
};

// Start heartbeat to keep user active
export const startHeartbeat = (schoolSlug: string): (() => void) => {
  // Add user immediately
  addActiveUser(schoolSlug);

  // Set up heartbeat interval
  const heartbeatInterval = setInterval(() => {
    addActiveUser(schoolSlug);
  }, HEARTBEAT_INTERVAL);

  // Clean up function
  return () => {
    clearInterval(heartbeatInterval);
    removeActiveUser();
  };
};

// Clean up inactive users (should be called periodically on server)
export const cleanupInactiveUsers = async (): Promise<void> => {
  try {
    const cutoffTime = new Date(Date.now() - USER_TIMEOUT);
    const q = query(
      collection(db, ACTIVE_USERS_COLLECTION),
      where('lastSeen', '<', Timestamp.fromDate(cutoffTime))
    );

    const querySnapshot = await getDocs(q);
    const deletePromises = querySnapshot.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(deletePromises);
  } catch (error) {
    console.error('Error cleaning up inactive users:', error);
  }
};

// Get all active users for all schools (for admin/debugging)
export const getAllActiveUsers = async (): Promise<ActiveUser[]> => {
  try {
    const q = query(
      collection(db, ACTIVE_USERS_COLLECTION),
      where('isActive', '==', true),
      orderBy('lastSeen', 'desc')
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as ActiveUser));
  } catch (error) {
    console.error('Error getting all active users:', error);
    return [];
  }
};
