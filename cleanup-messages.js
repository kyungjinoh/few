/**
 * Manual cleanup script for expired chat messages
 * Run this to immediately clean up all expired messages
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
const serviceAccount = require('./functions/serviceAccountKey.json'); // You'll need to add this
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://school-clicker-938c5-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function cleanupExpiredMessages() {
  console.log('🧹 Starting manual cleanup of expired messages...');
  
  try {
    const schoolChatsRef = db.ref('schoolChats');
    const snapshot = await schoolChatsRef.once('value');
    
    if (!snapshot.exists()) {
      console.log('✅ No chat messages found');
      return;
    }
    
    const schoolChats = snapshot.val();
    let totalDeleted = 0;
    let schoolsProcessed = 0;
    const now = Date.now();
    
    for (const [schoolName, messages] of Object.entries(schoolChats)) {
      if (!messages || typeof messages !== 'object') continue;
      
      schoolsProcessed++;
      let schoolDeleted = 0;
      
      for (const [messageId, messageData] of Object.entries(messages)) {
        if (!messageData || typeof messageData !== 'object') continue;
        
        // Check if message has expired (24 hours old or more)
        const messageAge = now - messageData.timestamp;
        const isExpired = messageAge > (24 * 60 * 60 * 1000); // 24 hours
        
        if (isExpired || (messageData.expiresAt && messageData.expiresAt <= now)) {
          try {
            await db.ref(`schoolChats/${schoolName}/${messageId}`).remove();
            schoolDeleted++;
            totalDeleted++;
            console.log(`🗑️ Deleted expired message from ${schoolName}: ${messageData.text?.substring(0, 50)}...`);
          } catch (error) {
            console.error(`❌ Error deleting message from ${schoolName}:`, error.message);
          }
        }
      }
      
      if (schoolDeleted > 0) {
        console.log(`✅ Cleaned ${schoolDeleted} messages from ${schoolName}`);
      }
    }
    
    console.log(`🎉 Cleanup completed!`);
    console.log(`📊 Schools processed: ${schoolsProcessed}`);
    console.log(`🗑️ Total messages deleted: ${totalDeleted}`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
  
  process.exit(0);
}

cleanupExpiredMessages();
