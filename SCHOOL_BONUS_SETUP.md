# School Bonus System Setup Guide

## Overview
The system now stores a permanent random bonus (30-45) for each school in Firebase, ensuring each school has a consistent, persistent bonus that doesn't change between visits.

## What Changed

### 1. New Firebase Collection: `schoolBonuses`
- Each document uses the school slug as the document ID
- Structure:
  ```javascript
  {
    schoolSlug: "harvard-university",
    bonus: 37, // Random number between 30-45
    createdAt: "2024-01-01T00:00:00Z"
  }
  ```

### 2. Updated Active User Service
- `getSchoolBonus(schoolSlug)`: Gets or creates a permanent bonus for a school
- All active user counts now include the school's permanent bonus
- Fallback system uses school name hash if Firebase fails

## Firebase Rules Setup

### Step 1: Update Firestore Rules
1. Go to Firebase Console → Firestore Database → Rules
2. Add the following rules to your existing rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Your existing rules for schools and activeUsers...
    
    // NEW: Rules for schoolBonuses collection
    match /schoolBonuses/{schoolSlug} {
      // Allow anyone to read school bonuses
      allow read: if true;
      
      // Allow creation of new school bonuses
      allow create: if true;
      
      // Prevent modification once created (optional)
      allow update: if false;
      
      // Prevent deletion (optional)
      allow delete: if false;
    }
  }
}
```

### Step 2: Alternative Restrictive Rules (Optional)
If you want more security:

```javascript
match /schoolBonuses/{schoolSlug} {
  allow read: if true;
  allow create: if request.auth != null; // Only authenticated users
  allow update, delete: if false; // No modifications allowed
}
```

## How It Works

### First Visit to a School
1. User visits a school page (e.g., `/harvard-university`)
2. `getSchoolBonus("harvard-university")` is called
3. No document exists, so a new one is created with a random bonus (30-45)
4. Active user count = actual count + permanent bonus

### Subsequent Visits
1. User visits the same school page
2. `getSchoolBonus("harvard-university")` retrieves the existing bonus
3. Same bonus is always used for that school
4. Active user count remains consistent

### Error Handling
- If Firebase is unavailable, uses a hash-based fallback
- Hash ensures same school always gets same fallback bonus
- System remains functional even during Firebase outages

## Benefits

1. **Permanent**: Each school's bonus never changes
2. **Unique**: Each school gets a different bonus (30-45 range)
3. **Consistent**: All users see the same enhanced count for each school
4. **Reliable**: Fallback system ensures it works even offline
5. **Scalable**: Automatically creates bonuses for new schools

## Testing

Visit different school pages and verify:
1. Each school shows an enhanced active user count
2. The same school always shows the same bonus
3. Different schools have different bonuses
4. Bonuses persist across browser refreshes and sessions

## Database Structure Preview

After visiting a few schools, your `schoolBonuses` collection will look like:

```
schoolBonuses/
├── harvard-university/
│   ├── schoolSlug: "harvard-university"
│   ├── bonus: 42
│   └── createdAt: "2024-01-01T10:30:00Z"
├── stanford-university/
│   ├── schoolSlug: "stanford-university" 
│   ├── bonus: 35
│   └── createdAt: "2024-01-01T11:15:00Z"
└── mit/
    ├── schoolSlug: "mit"
    ├── bonus: 44
    └── createdAt: "2024-01-01T12:00:00Z"
```

## Implementation Complete ✅
The code changes are complete and ready to use once you update your Firebase rules!
