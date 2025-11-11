# School Clicker

A mobile-first clicker game where players can attack or support different schools with a competitive leaderboard system.

## Features

- **Loading Screen** - Pixel art styled splash screen
- **Main Game** - Clicker mechanics with school selection
- **Leaderboard** - Ranked schools with search functionality
- **Mobile-First Design** - Optimized for mobile devices

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS
- Framer Motion
- Pixelify Sans font for retro aesthetic

## Security & Anti-Abuse

- Session-based click authentication ensures that score updates are only accepted from valid client sessions tied to recent activity.
- Per-session and per-IP rate limiting protects the backend from scripted abuse and throttles bursty traffic.
- Progressive friction introduces CAPTCHA challenges and temporary session blocks once abuse thresholds are hit (Cloudflare Turnstile supported).
- Configure a WAF (e.g., Cloudflare) in front of the deployment to filter malicious traffic before it reaches Firebase.
- Set the `CLOUDFLARE_TURNSTILE_SECRET` environment variable (or `firebase functions:config:set turnstile.secret=...`) so the backend can validate CAPTCHA tokens.
- Rotate Firebase API keys that have ever been public and keep the replacements in environment variables instead of committing them to source control.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Copy `env.example` to `.env` (or `.env.local`) and fill in your Firebase values.
4. Open http://localhost:3000 in your browser

## Project Structure

```
src/
├── components/
│   ├── LoadingPage.tsx      # Loading screen component
│   ├── HomeIndicator.tsx    # Mobile home indicator
│   ├── StatusbarTime.tsx    # Status bar time display
│   └── LoadingSpinner.tsx   # Custom loading animation
├── App.tsx                  # Main app component
├── main.tsx                 # App entry point
└── index.css               # Global styles and animations
```

## Development Status

- ✅ Project setup
- ✅ Loading page implementation
- 🚧 Main game screen (next)
- 🚧 Leaderboard functionality
- 🚧 Game logic and state management
# school-clicker

A competitive school clicking game built with React, TypeScript, and Firebase.
