# Firebase Setup Instructions

## 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project"
3. Enter project name: "School Clicker"
4. Enable Google Analytics (optional)
5. Click "Create project"

## 2. Enable Firestore Database

1. In your Firebase project, go to "Firestore Database"
2. Click "Create database"
3. Choose "Start in test mode" (we'll update rules later)
4. Select a location for your database
5. Click "Done"

## 3. Get Firebase Configuration

1. Go to Project Settings (gear icon)
2. Scroll down to "Your apps"
3. Click "Web" icon (</>)
4. Register your app with nickname: "School Clicker Web"
5. Copy the Firebase configuration object

## 4. Update Firebase Config

Replace the placeholder values in `src/firebase/config.ts` with your actual Firebase config:

```typescript
const firebaseConfig = {
  apiKey: "your-actual-api-key",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-actual-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "your-actual-sender-id",
  appId: "your-actual-app-id"
};
```

## 5. Set Firestore Security Rules

1. Go to Firestore Database > Rules
2. Replace the default rules with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /schools/{schoolId} {
      allow read, write: if true;
      
      // Validate document structure
      allow create: if request.resource.data.keys().hasAll(['schoolName', 'rank', 'score', 'schoolLogo'])
        && request.resource.data.schoolName is string
        && request.resource.data.schoolName.size() > 0
        && request.resource.data.schoolName.size() <= 100
        && request.resource.data.rank is number
        && request.resource.data.rank > 0
        && request.resource.data.score is number
        && request.resource.data.score >= 0
        && request.resource.data.schoolLogo is string
        && request.resource.data.schoolLogo.size() > 0;
        
      allow update: if request.resource.data.keys().hasAll(['schoolName', 'rank', 'score', 'schoolLogo'])
        && request.resource.data.schoolName is string
        && request.resource.data.schoolName.size() > 0
        && request.resource.data.schoolName.size() <= 100
        && request.resource.data.rank is number
        && request.resource.data.rank > 0
        && request.resource.data.score is number
        && request.resource.data.score >= 0
        && request.resource.data.schoolLogo is string
        && request.resource.data.schoolLogo.size() > 0;
    }
  }
}
```

3. Click "Publish"

## 6. Test the Integration

1. Start your development server: `npm run dev`
2. Open the LeaderboardPage
3. Check the browser console for any Firebase errors
4. The page should show "Loading schools..." initially
5. If no schools exist, the leaderboard will be empty

## 7. Add Sample Data (Optional)

You can add sample schools directly in the Firebase Console:

1. Go to Firestore Database > Data
2. Click "Start collection"
3. Collection ID: "schools"
4. Add documents with these fields:
   - schoolName (string)
   - rank (number)
   - score (number)
   - schoolLogo (string)

## 8. Troubleshooting

- **Permission denied**: Check your Firestore rules
- **Network error**: Verify your Firebase config
- **No data**: Check if the collection name is "schools"
- **Console errors**: Check browser console for detailed error messages

## Next Steps

- Update SchoolSupportPage to save scores to Firebase
- Add real-time updates for score changes
- Implement user authentication if needed
- Add data validation on the frontend
