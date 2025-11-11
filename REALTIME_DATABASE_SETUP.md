# Firebase Realtime Database Setup for Online Users

## Overview
This setup enables real-time tracking of online users using Firebase Realtime Database while keeping all persistent data (schools, scores) in Firestore for cost efficiency.

## 1. Enable Realtime Database

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **school-clicker-938c5**
3. In the left sidebar, click **"Realtime Database"**
4. Click **"Create Database"**
5. Choose **"Start in test mode"** (we'll update rules later)
6. Select your preferred location (same as Firestore if possible)
7. Click **"Done"**

## 2. Set Realtime Database Rules

1. In Firebase Console, go to **Realtime Database > Rules**
2. Replace the default rules with the contents of `firebase-realtime-db-rules.json`:

```json
{
  "rules": {
    "connectedUsers": {
      ".read": true,
      ".write": true,
      "$userId": {
        ".validate": "newData.hasChildren(['timestamp', 'online']) && newData.child('online').val() == true"
      }
    },
    "stats": {
      "onlineCount": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['count', 'lastUpdated']) && newData.child('count').isNumber() && newData.child('count').val() >= 0"
      }
    }
  }
}
```

3. Click **"Publish"**

## 3. Update Firebase Config (Already Done)

The `src/firebase/config.ts` file has already been updated with:
- ✅ `databaseURL` added to config
- ✅ Realtime Database initialized
- ✅ Both Firestore and Realtime DB exported

## 4. Database Structure

The Realtime Database will have this structure:

```
school-clicker-938c5-default-rtdb/
├── connectedUsers/
│   ├── [auto-generated-user-id-1]/
│   │   ├── timestamp: [server-timestamp]
│   │   └── online: true
│   ├── [auto-generated-user-id-2]/
│   │   ├── timestamp: [server-timestamp]
│   │   └── online: true
│   └── ...
└── stats/
    └── onlineCount/
        ├── count: [number]
        └── lastUpdated: [server-timestamp]
```

## 5. How It Works

### Automatic Presence Tracking
- When a user visits any page, they're automatically added to `connectedUsers`
- Each user gets a unique auto-generated ID
- When they leave/close the browser, they're automatically removed
- The system uses Firebase's built-in presence detection

### Real-time Online Count
- The `stats/onlineCount` node tracks the total number of online users
- Updates automatically when users join/leave
- Displayed in real-time on GamePage and LeaderboardPage

### Cost Efficiency
- Realtime DB only stores temporary presence data (automatically cleaned up)
- All persistent data (schools, scores, leaderboards) stays in Firestore
- Realtime DB usage is minimal and cost-effective

## 6. Components Using Online Users

### ✅ Components Updated:
- **GamePage**: Shows online count in header (desktop & mobile)
- **LeaderboardPage**: Shows online count below title
- **useOnlineUsers hook**: Manages presence and real-time updates

### Data Flow:
1. User visits page → `useOnlineUsers` hook activates
2. Hook calls `onlineUsersService.initializePresence()`
3. User added to `connectedUsers` in Realtime DB
4. `onlineCount` automatically updates
5. All connected users see updated count in real-time
6. User leaves → automatically removed from `connectedUsers`

## 7. Testing the Setup

### Test Steps:
1. **Enable Realtime Database** in Firebase Console
2. **Set the rules** from `firebase-realtime-db-rules.json`
3. **Open your website** at `http://localhost:3000`
4. **Check the online counter** - should show "1 online"
5. **Open in another browser/tab** - should show "2 online"
6. **Close one tab** - should show "1 online"

### Troubleshooting:
- **No online count showing**: Check Firebase Console > Realtime Database > Data
- **Permission denied**: Verify rules are published correctly
- **Connection issues**: Check browser console for Firebase errors
- **Count not updating**: Ensure `databaseURL` is correct in config

## 8. Security Notes

### Current Rules (Test Mode):
- ✅ Allow read/write for online presence tracking
- ✅ Validate data structure for user entries
- ✅ Validate online count data format

### Production Considerations:
- Rules are currently open for testing
- Consider adding rate limiting for production
- Monitor usage to ensure cost efficiency
- The current setup auto-cleans temporary data

## 9. Monitoring & Maintenance

### Firebase Console Monitoring:
- **Realtime Database > Usage**: Monitor read/write operations
- **Realtime Database > Data**: View current online users
- **Analytics**: Track user engagement

### Expected Usage:
- Very low cost (only presence data)
- Automatic cleanup (no manual maintenance needed)
- Real-time updates across all connected users

## 10. Next Steps

After setting up:
1. ✅ Test online user counting
2. ✅ Verify automatic cleanup when users leave
3. ✅ Monitor Firebase usage in console
4. Consider adding user authentication for enhanced features
5. Monitor costs and optimize if needed

---

**Status**: Ready to use! The code is already implemented and waiting for Realtime Database to be enabled in Firebase Console.
