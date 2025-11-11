// Reset The Quarry Lane School score using Firebase Admin SDK
// This script requires a service account key file

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// You need to download the service account key from Firebase Console
// Go to Project Settings > Service Accounts > Generate New Private Key
// Save it as 'firebase-service-account.json' in this directory

try {
  // Initialize Firebase Admin SDK
  const serviceAccount = JSON.parse(readFileSync('./firebase-service-account.json', 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://school-clicker-938c5-default-rtdb.firebaseio.com'
  });

  const db = admin.firestore();

  async function resetQuarryLaneScore() {
    try {
      console.log('🔧 Resetting The Quarry Lane School score in Firebase...');
      
      // Get the school document
      const schoolRef = db.collection('schools').doc('the_quarry_lane_school');
      const schoolDoc = await schoolRef.get();
      
      if (!schoolDoc.exists) {
        console.log('❌ The Quarry Lane School not found in Firestore');
        return;
      }
      
      const currentData = schoolDoc.data();
      const currentScore = currentData.score;
      
      console.log(`📊 Current score: ${currentScore.toLocaleString()}`);
      
      // Reset to a reasonable score (1000 points)
      const newScore = 1000;
      
      await schoolRef.update({
        score: newScore
      });
      
      console.log(`✅ Reset The Quarry Lane School score: ${currentScore.toLocaleString()} → ${newScore}`);
      console.log('💡 Score has been reset to a reasonable value in Firebase backend');
      
      // Check for other schools with extremely high scores
      console.log('\n🔍 Checking for other schools with high scores...');
      const allSchoolsSnapshot = await db.collection('schools').get();
      
      const highScoreSchools = [];
      allSchoolsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.score > 1000000) { // 1 million threshold
          highScoreSchools.push({
            name: data.schoolName,
            score: data.score,
            id: doc.id,
          });
        }
      });
      
      if (highScoreSchools.length > 0) {
        console.log(`⚠️  Found ${highScoreSchools.length} schools with scores over 1 million:`);
        highScoreSchools.forEach(school => {
          console.log(`  - ${school.name}: ${school.score.toLocaleString()} points`);
        });
      } else {
        console.log('✅ No other schools have extremely high scores');
      }
      
    } catch (error) {
      console.error('❌ Error resetting score:', error);
    }
  }

  resetQuarryLaneScore().then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
  console.log('\n💡 To fix this:');
  console.log('1. Go to Firebase Console > Project Settings > Service Accounts');
  console.log('2. Click "Generate New Private Key"');
  console.log('3. Save the file as "firebase-service-account.json" in this directory');
  console.log('4. Run this script again');
  process.exit(1);
}
