import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './config';
import { callUpdateScore, callAddSchool } from './functionsClient';

export interface School {
  id: string;
  schoolName: string;
  rank: number;
  score: number;
  schoolLogo: string;
  region?: string;
}

const SCHOOLS_COLLECTION = 'schools';
const SHARER_COLLECTION = 'sharer';
const SCORE_UPDATE_MAX_DELTA = 5000;

// Cache for school name to document ID mapping (to avoid queries)
const schoolNameToIdCache = new Map<string, string>();

// Prevent multiple simultaneous calls to getAllSchools
let isLoadingSchools = false;
let schoolsPromise: Promise<School[]> | null = null;

// Populate cache with school name to ID mapping
export const populateSchoolNameCache = (schools: School[]): void => {
  schoolNameToIdCache.clear();
  schools.forEach(school => {
    schoolNameToIdCache.set(school.schoolName, school.id);
  });
  console.log(`📋 [FIREBASE DEBUG] Populated school name cache with ${schoolNameToIdCache.size} schools`);
  console.log(`🗂️ [FIREBASE DEBUG] Cache contents:`, Array.from(schoolNameToIdCache.entries()).slice(0, 5), '...');
};

// Get all schools ordered by score (descending)
export const getAllSchools = async (): Promise<School[]> => {
  // Prevent multiple simultaneous calls (React.StrictMode protection)
  if (isLoadingSchools && schoolsPromise) {
    console.log('🔄 [FIREBASE DEBUG] getAllSchools already in progress, returning existing promise');
    return schoolsPromise;
  }

  if (schoolNameToIdCache.size > 0) {
    console.log('📋 [FIREBASE DEBUG] Schools already loaded from cache, skipping Firebase query (0 reads)');
    // Return cached data if available (convert cache back to School array)
    const cachedData = localStorage.getItem('staticSchoolData');
    if (cachedData) {
      return JSON.parse(cachedData);
    }
  }

  isLoadingSchools = true;

  schoolsPromise = (async () => {
    try {
      console.log('🔍 [FIREBASE DEBUG] Starting getAllSchools query...');
      const schoolsRef = collection(db, SCHOOLS_COLLECTION);
      const q = query(schoolsRef, orderBy('score', 'desc'));

      // Add timeout to prevent hanging connections
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Firestore query timeout')), 10000);
      });

      console.log('📡 [FIREBASE DEBUG] Executing getDocs query...');
      const querySnapshot = await Promise.race([getDocs(q), timeoutPromise]);
      console.log(`📊 [FIREBASE DEBUG] Query completed. Documents returned: ${querySnapshot.size}`);

    const schools: School[] = [];
    let currentRank = 1;

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      schools.push({
        id: doc.id,
        schoolName: data.schoolName,
        rank: currentRank,
        score: data.score,
        schoolLogo: data.schoolLogo,
        region: data.region
      });
      currentRank++;
    });

    // Populate the cache after loading schools
    populateSchoolNameCache(schools);

      console.log(`✅ [FIREBASE DEBUG] getAllSchools completed successfully. Total schools: ${schools.length}`);
      return schools;
    } catch (error) {
      console.error('❌ [FIREBASE DEBUG] Error getting schools:', error);
      // Return empty array to prevent app crashes
      return [];
    } finally {
      isLoadingSchools = false;
      schoolsPromise = null;
    }
  })();

  return schoolsPromise;
};

// Get a specific school by ID
export const getSchoolById = async (schoolId: string): Promise<School | null> => {
  try {
    const schoolRef = doc(db, SCHOOLS_COLLECTION, schoolId);
    const schoolSnap = await getDoc(schoolRef);

    if (schoolSnap.exists()) {
      const data = schoolSnap.data();
      return {
        id: schoolSnap.id,
        schoolName: data.schoolName,
        rank: data.rank,
        score: data.score,
        schoolLogo: data.schoolLogo,
        region: data.region
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting school:', error);
    return null;
  }
};

// Create or update a school
export const saveSchool = async (school: Partial<Omit<School, 'id'>>): Promise<string> => {
  try {
    // Generate a unique ID based on school name
    const schoolId = school.schoolName!.toLowerCase().replace(/\s+/g, '_');
    const schoolRef = doc(db, SCHOOLS_COLLECTION, schoolId);

    // Check if school already exists
    const existingSchool = await getDoc(schoolRef);

    if (existingSchool.exists()) {
      // Update existing school, preserve schoolLogo
      // const existingData = existingSchool.data();
      await updateDoc(schoolRef, {
        schoolName: school.schoolName,
        rank: school.rank,
        score: school.score
        // schoolLogo is preserved from existing data
      });
    } else {
      // Create new school without logo (admin must set logo)
      await setDoc(schoolRef, {
        schoolName: school.schoolName,
        rank: school.rank,
        score: school.score
        // schoolLogo will be set by admin
      });
    }

    return schoolId;
  } catch (error) {
    console.error('Error saving school:', error);
    throw error;
  }
};

// Update school score
export const updateSchoolScore = async (schoolId: string, newScore: number): Promise<void> => {
  try {
    // Cap score at 1 trillion to prevent overflow
    const maxScore = 1000000000000;
    const cappedScore = Math.min(maxScore, Math.max(0, newScore));

    const schoolRef = doc(db, SCHOOLS_COLLECTION, schoolId);
    await updateDoc(schoolRef, {
      score: cappedScore
    });
  } catch (error) {
    console.error('Error updating school score:', error);
    throw error;
  }
};

const getSchoolIdByName = async (schoolName: string): Promise<string | null> => {
  if (!schoolName) {
    return null;
  }

  if (schoolNameToIdCache.has(schoolName)) {
    return schoolNameToIdCache.get(schoolName) ?? null;
  }

  const cachedMatch = Array.from(schoolNameToIdCache.entries()).find(([name]) =>
    name.toLowerCase() === schoolName.toLowerCase()
  );

  if (cachedMatch) {
    const [, cachedId] = cachedMatch;
    return cachedId;
  }

  try {
    const schoolsRef = collection(db, SCHOOLS_COLLECTION);
    const q = query(schoolsRef, where('schoolName', '==', schoolName));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      schoolNameToIdCache.set(schoolName, docSnap.id);
      return docSnap.id;
    }
  } catch (error) {
    console.error('❌ [FIREBASE DEBUG] Error looking up school ID:', error);
  }

  return null;
};

export const updateSchoolScoreByName = async (schoolName: string, scoreChanges: number): Promise<void> => {
  if (!schoolName || !Number.isFinite(scoreChanges) || scoreChanges === 0) {
    return;
  }

  const schoolId = await getSchoolIdByName(schoolName);

  if (!schoolId) {
    console.warn(`⚠️ [FIREBASE DEBUG] Unable to find school ID for "${schoolName}". Skipping score update.`);
    return;
  }

  const clampedDelta = Math.max(-SCORE_UPDATE_MAX_DELTA, Math.min(SCORE_UPDATE_MAX_DELTA, Math.round(scoreChanges)));

  if (clampedDelta === 0) {
    console.warn(`⚠️ [FIREBASE DEBUG] Delta for ${schoolName} clamped to 0. Skipping score update.`);
    return;
  }

  try {
    console.log(`📞 [FIREBASE DEBUG] Calling updateScore function for ${schoolName} (${schoolId}) with delta ${clampedDelta}`);
    await callUpdateScore(schoolId, clampedDelta);
    console.log(`✅ [FIREBASE DEBUG] Cloud Function score update succeeded for ${schoolName}`);
  } catch (error) {
    console.error('❌ [FIREBASE DEBUG] Cloud Function score update failed:', error);
    throw error;
  }
};

// ADMIN ONLY: Update school logo (only admin can use this)
export const updateSchoolLogo = async (schoolId: string, newLogoUrl: string): Promise<void> => {
  try {
    const schoolRef = doc(db, SCHOOLS_COLLECTION, schoolId);
    await updateDoc(schoolRef, {
      schoolLogo: newLogoUrl
    });
    console.log(`Admin updated school logo for ${schoolId} to: ${newLogoUrl}`);
  } catch (error) {
    console.error('Error updating school logo:', error);
    throw error;
  }
};

// Delete a school
export const deleteSchool = async (schoolId: string): Promise<void> => {
  try {
    const schoolRef = doc(db, SCHOOLS_COLLECTION, schoolId);
    await deleteDoc(schoolRef);
  } catch (error) {
    console.error('Error deleting school:', error);
    throw error;
  }
};

// Listen to real-time updates
export const subscribeToSchools = (callback: (schools: School[]) => void) => {
  const schoolsRef = collection(db, SCHOOLS_COLLECTION);
  const q = query(schoolsRef, orderBy('score', 'desc'));

  return onSnapshot(q, (querySnapshot) => {
    const schools: School[] = [];
    let currentRank = 1;

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      schools.push({
        id: doc.id,
        schoolName: data.schoolName,
        rank: currentRank,
        score: data.score,
        schoolLogo: data.schoolLogo,
        region: data.region
      });
      currentRank++;
    });

    callback(schools);
  });
};

// Submit a school add request
export const submitSchoolRequest = async (
  schoolName: string,
  schoolLocation: string,
  userEmail: string,
  schoolLogoUrl?: string
): Promise<string> => {
  try {
    const trimmedName = schoolName.trim();
    const trimmedRegion = schoolLocation.trim();
    const trimmedEmail = userEmail.trim();
    const trimmedLogo = schoolLogoUrl?.trim() ?? '';

    if (!trimmedName || !trimmedRegion || !trimmedEmail) {
      throw new Error('Missing required fields for school creation.');
    }

    const response = await callAddSchool({
      schoolName: trimmedName,
      region: trimmedRegion,
      logoUrl: trimmedLogo,
      requesterEmail: trimmedEmail,
    });

    const schoolId = response.schoolId;

    try {
      const cachedData = localStorage.getItem('staticSchoolData');
      if (cachedData) {
        const parsedSchools: School[] = JSON.parse(cachedData);
        const updatedSchools = [
          ...parsedSchools,
          {
            id: schoolId,
            schoolName: trimmedName,
            rank: 0,
            score: 0,
            schoolLogo: trimmedLogo,
            region: trimmedRegion,
          },
        ]
          .sort((a, b) => b.score - a.score)
          .map((school, index) => ({
            ...school,
            rank: index + 1,
          }));

        localStorage.setItem('staticSchoolData', JSON.stringify(updatedSchools));
      }
    } catch (cacheError) {
      console.warn('Failed to update local cache with new school:', cacheError);
    }

    console.log('✅ School created with ID via Cloud Function:', schoolId);
    return schoolId;
  } catch (error) {
    console.error('❌ Error submitting school request:', error);
    throw error;
  }
};

interface SubmitShareProofPayload {
  schoolName: string;
  shareMethod: 'Story' | 'DM' | 'ETC';
  sharedSchoolStudent?: string | null;
  proofFile: File;
}

export const submitShareProof = async ({
  schoolName,
  shareMethod,
  sharedSchoolStudent,
  proofFile,
}: SubmitShareProofPayload): Promise<void> => {
  if (!schoolName || !shareMethod || !proofFile) {
    throw new Error('Missing required proof submission fields.');
  }

  try {
    const extension = proofFile.name.split('.').pop() ?? 'jpg';
    const safeSchoolName = schoolName.toLowerCase().replace(/\s+/g, '_');
    const proofPath = `shareProofs/${safeSchoolName}/${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;
    const fileRef = storageRef(storage, proofPath);

    await uploadBytes(fileRef, proofFile);
    const downloadUrl = await getDownloadURL(fileRef);

    await addDoc(collection(db, SHARER_COLLECTION), {
      schoolName,
      shareMethod,
      sharedSchoolStudent: sharedSchoolStudent?.trim() || null,
      proofUrl: downloadUrl,
      proofPath,
      submittedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error submitting share proof:', error);
    throw error instanceof Error ? error : new Error('Failed to submit proof.');
  }
};

export interface ShareLeaderboardEntry {
  schoolName: string;
  shareCount: number;
  points: number;
}

export const getShareCountsBySchool = async (): Promise<ShareLeaderboardEntry[]> => {
  const snapshot = await getDocs(collection(db, SHARER_COLLECTION));
  const aggregates = new Map<string, { shareCount: number; points: number }>();

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const name =
      typeof data.schoolName === 'string' && data.schoolName.trim().length > 0
        ? data.schoolName.trim()
        : 'Unknown School';

    const shareMethod = typeof data.shareMethod === 'string' ? data.shareMethod : 'ETC';
    const methodPoints = shareMethod === 'Story' ? 5 : 1;

    const current = aggregates.get(name) ?? { shareCount: 0, points: 0 };
    current.shareCount += 1;
    current.points += methodPoints;
    aggregates.set(name, current);
  });

  return Array.from(aggregates.entries())
    .map(([schoolName, value]) => ({
      schoolName,
      shareCount: value.shareCount,
      points: value.points,
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.shareCount - a.shareCount ||
        a.schoolName.localeCompare(b.schoolName)
    );
};
