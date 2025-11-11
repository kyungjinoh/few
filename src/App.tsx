import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { LoadingPage } from './components/LoadingPage';
import { LandingPage } from './components/LandingPage';
import { LeaderboardPage } from './components/LeaderboardPage';
import { GamePage } from './components/GamePage';
import { SchoolSupportPage } from './components/SchoolSupportPage';
import { SchoolDataProvider } from './contexts/SchoolDataContext';
import { useSingleTabGuard } from './hooks/useSingleTabGuard';
import './index.css';

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [firebaseLoaded, setFirebaseLoaded] = useState(false);
  const [backgroundMusic, setBackgroundMusic] = useState<HTMLAudioElement | null>(null);
  const [musicStarted, setMusicStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(() => {
    // Force default to muted (true) - clear any existing localStorage value
    localStorage.removeItem('isMuted');
    localStorage.setItem('isMuted', 'true');
    
    console.log('🔊 [MUTE STATE] Forced to muted (true) - cleared existing localStorage');
    return true;
  });

  useEffect(() => {
    // Clear static data cache on page refresh to ensure fresh data
    const handlePageRefresh = () => {
      localStorage.removeItem('staticSchoolData');
      // Clear all school-related cache to force fresh data retrieval
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('schoolScore_') ||
          key.startsWith('schoolLogo_') ||
          key.startsWith('theme_') ||
          key.startsWith('invalid_school_') ||
          key === 'dontShowRankUpDate'
        )) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      console.log('🧹 [APP] Cleared school cache:', keysToRemove.length, 'keys');
    };

    // Check for score reset scenario and clear all school scores
    const checkForScoreReset = () => {
      const hasOldScores = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
        .some(key => key && key.startsWith('schoolScore_') && parseInt(localStorage.getItem(key) || '0') > 0);
      
      if (hasOldScores) {
        console.log('🔄 [APP] Detected old scores in localStorage - clearing all school scores');
        const scoreKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
          .filter(key => key && key.startsWith('schoolScore_'));
        scoreKeys.forEach(key => key && localStorage.removeItem(key));
        console.log('✅ [APP] Cleared', scoreKeys.length, 'old school scores');
      }
    };

    // Run cleanup immediately on page load
    handlePageRefresh();
    checkForScoreReset();

    // Initial loading timer
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Listen for Firebase loading completion
  useEffect(() => {
    const handleFirebaseLoaded = () => {
      setFirebaseLoaded(true);
    };

    // Listen for custom event from LoadingPage
    window.addEventListener('firebaseLoaded', handleFirebaseLoaded);
    
    return () => {
      window.removeEventListener('firebaseLoaded', handleFirebaseLoaded);
    };
  }, []);

  // Background music effect
  useEffect(() => {
    if (!isLoading) {
      const music = new Audio('/icons/background music.mp3');
      music.loop = true;
      music.volume = 0.3; // Set volume to 30%
      music.muted = true; // Always start muted
      setBackgroundMusic(music);
      
      console.log('🔊 [BACKGROUND MUSIC] Created with muted=true');
      
      // Immediate music stopping for mobile/tablet when browser is exited
      const stopMusicImmediately = () => {
        console.log('🔊 [BACKGROUND MUSIC] Stopping immediately due to browser exit');
        music.pause();
        music.currentTime = 0;
      };

      // Listen for various browser exit events
      const handleBeforeUnload = () => {
        stopMusicImmediately();
      };

      const handlePageHide = () => {
        stopMusicImmediately();
      };

      const handleVisibilityChange = () => {
        if (document.hidden) {
          stopMusicImmediately();
        }
      };

      // Add event listeners for immediate music stopping
      window.addEventListener('beforeunload', handleBeforeUnload);
      window.addEventListener('pagehide', handlePageHide);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      // Don't try to play music initially - it will be controlled by user interaction
      // Cleanup function
      return () => {
        music.pause();
        music.currentTime = 0;
        window.removeEventListener('beforeunload', handleBeforeUnload);
        window.removeEventListener('pagehide', handlePageHide);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [isLoading]);

  // Handle mute state changes
  useEffect(() => {
    if (backgroundMusic) {
      backgroundMusic.muted = isMuted;
    }
  }, [backgroundMusic, isMuted]);

  // Start music on user interaction
  const startMusic = async () => {
    if (backgroundMusic && !musicStarted) {
      try {
        await backgroundMusic.play();
        setMusicStarted(true);
      } catch (error) {
        console.log('Failed to start background music:', error);
      }
    }
  };

  // Toggle mute function
  const toggleMute = () => {
    const newMuteState = !isMuted;
    setIsMuted(newMuteState);
    localStorage.setItem('isMuted', newMuteState.toString());
    console.log('🔊 [MUTE TOGGLE] Changed to:', newMuteState);
  };

  const { isBlocked } = useSingleTabGuard();

  if (isBlocked) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white px-6">
          <h1 className="font-pixelify text-3xl md:text-4xl mb-4">Multiple Tabs Detected</h1>
          <p className="text-base md:text-lg text-gray-300">
            You already have School Clicker open in another tab. Please return to the original tab to continue playing.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !firebaseLoaded) {
    return <LoadingPage onFirebaseLoaded={() => setFirebaseLoaded(true)} />;
  }

  return (
    <SchoolDataProvider>
      <Router>
        <div className="App" onClick={startMusic}>
          <Routes>
            <Route path="/" element={<LandingPage isMuted={isMuted} onToggleMute={toggleMute} />} />
            <Route path="/leaderboard" element={<LeaderboardPage isMuted={isMuted} onToggleMute={toggleMute} />} />
            <Route path="/game" element={<GamePage isMuted={isMuted} onToggleMute={toggleMute} />} />
            <Route path="/:schoolName" element={<SchoolSupportPage isMuted={isMuted} onToggleMute={toggleMute} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </Router>
    </SchoolDataProvider>
  );
}

export default App;
