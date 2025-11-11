import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBro7XPwPZ2c0Aejoz9wNuPcnKTxWgQyOw",
  authDomain: "school-clicker-938c5.firebaseapp.com",
  databaseURL: "https://school-clicker-938c5-default-rtdb.firebaseio.com/",
  projectId: "school-clicker-938c5",
  storageBucket: "school-clicker-938c5.firebasestorage.app",
  messagingSenderId: "813386795404",
  appId: "1:813386795404:web:5aaba099581fd11a372ea9",
  measurementId: "G-C687RHWZ53"
};

// Initialize Firebase only if it hasn't been initialized already
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Firestore (for school data and persistent information)
export const db = getFirestore(app);

// Initialize Realtime Database (for online users only)
export const realtimeDb = getDatabase(app);

// Initialize Firebase Storage (for proof uploads)
export const storage = getStorage(app);

// Debug: Check if Realtime Database is properly initialized (development only)
if (import.meta.env.DEV) {
  console.log('🔧 Firebase Realtime Database initialized:', !!realtimeDb);
}

export default app;
