import React, { useEffect } from "react";
import { LoadingSpinner } from "./LoadingSpinner";
import { getAllSchools, populateSchoolNameCache } from "../firebase/schoolService";

interface LoadingPageProps {
  onFirebaseLoaded?: () => void;
}

export const LoadingPage: React.FC<LoadingPageProps> = ({ onFirebaseLoaded }) => {

  // Firebase initialization
  useEffect(() => {
    const initializeFirebase = async () => {
      try {
        // Get schools from Firebase
        const schools = await getAllSchools();
        
        // Only populate cache and store if we got fresh data from Firebase
        if (schools && schools.length > 0) {
          // Populate the school name cache for optimized updates
          populateSchoolNameCache(schools);
          
          // Store the school data in localStorage for static use
          localStorage.setItem('staticSchoolData', JSON.stringify(schools));
          console.log('💾 [LOADING PAGE] Stored school data in localStorage:', schools.length, 'schools');
        } else {
          console.log('📋 [LOADING PAGE] Using existing cached data, no new storage needed');
        }
        
        onFirebaseLoaded?.();
        
        // Dispatch custom event for App.tsx
        window.dispatchEvent(new Event('firebaseLoaded'));
      } catch (error) {
        console.error('Error initializing Firebase:', error);
        // Still proceed even if there's an error
        onFirebaseLoaded?.();
        window.dispatchEvent(new Event('firebaseLoaded'));
      }
    };

    initializeFirebase();
  }, [onFirebaseLoaded]);


  // Responsive design that fills the whole screen
  return (
    <div className="bg-black w-screen h-screen-dvh flex items-center justify-center overflow-hidden select-none">
      <div className="relative bg-black w-full h-full select-none overflow-hidden flex flex-col items-center justify-center">
        {/* Enhanced background decorations */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* Floating particles */}
          <div className="absolute top-16 left-16 w-3 h-3 bg-cyan-400 rounded-full animate-ping opacity-60"></div>
          <div className="absolute top-24 right-20 w-2 h-2 bg-purple-400 rounded-full animate-ping delay-1000 opacity-40"></div>
          <div className="absolute top-36 left-1/3 w-2.5 h-2.5 bg-pink-400 rounded-full animate-ping delay-2000 opacity-50"></div>
          <div className="absolute top-48 right-1/4 w-1.5 h-1.5 bg-yellow-400 rounded-full animate-ping delay-3000 opacity-30"></div>
          <div className="absolute top-64 left-1/2 w-3 h-3 bg-blue-400 rounded-full animate-ping delay-500 opacity-40"></div>
          
          {/* Bottom particles */}
          <div className="absolute bottom-24 left-20 w-2.5 h-2.5 bg-green-400 rounded-full animate-ping delay-700 opacity-50"></div>
          <div className="absolute bottom-36 right-24 w-2 h-2 bg-red-400 rounded-full animate-ping delay-1500 opacity-40"></div>
          <div className="absolute bottom-48 left-1/4 w-3 h-3 bg-orange-400 rounded-full animate-ping delay-2500 opacity-30"></div>
          <div className="absolute bottom-64 right-1/3 w-2 h-2 bg-indigo-400 rounded-full animate-ping delay-3500 opacity-45"></div>
          
          {/* Gradient orbs */}
          <div className="absolute top-1/3 left-1/6 w-40 h-40 bg-gradient-to-r from-cyan-500/15 to-blue-500/15 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-1/3 right-1/6 w-36 h-36 bg-gradient-to-r from-purple-500/15 to-pink-500/15 rounded-full blur-3xl animate-pulse delay-1000"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-gradient-to-r from-yellow-500/15 to-orange-500/15 rounded-full blur-2xl animate-pulse delay-2000"></div>
          
          {/* Subtle border circles */}
          <div className="absolute top-[10vh] left-[5vw] w-32 h-32 border border-white/20 rounded-full animate-pulse"></div>
          <div className="absolute top-[20vh] right-[5vw] w-24 h-24 border border-blue-400/30 rounded-full animate-pulse delay-1000"></div>
          <div className="absolute bottom-[20vh] left-[8vw] w-20 h-20 border border-red-400/30 rounded-full animate-pulse delay-500"></div>
          <div className="absolute bottom-[10vh] right-[8vw] w-16 h-16 border border-yellow-400/30 rounded-full animate-pulse delay-700"></div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-[15vh] left-[5vw] w-2 h-2 bg-blue-400 rounded-full animate-ping opacity-60"></div>
        <div className="absolute top-[25vh] right-[8vw] w-1.5 h-1.5 bg-yellow-400 rounded-full animate-ping delay-1000 opacity-60"></div>
        <div className="absolute bottom-[25vh] left-[8vw] w-1 h-1 bg-red-400 rounded-full animate-ping delay-500 opacity-60"></div>
        <div className="absolute bottom-[15vh] right-[5vw] w-2 h-2 bg-green-400 rounded-full animate-ping delay-700 opacity-60"></div>

        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.02]">
          <div className="w-full h-full" style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '20px 20px'
          }}></div>
        </div>
        
        {/* Title - centered vertically and horizontally */}
        <div className="font-pixelify font-normal text-white text-4xl md:text-5xl lg:text-6xl text-center tracking-[0] leading-[normal] mb-4">
          SchoolClicker.com
        </div>

        {/* Subtitle - positioned below title */}
        <div className="font-pixelify font-normal text-yellow-400 text-lg md:text-xl lg:text-2xl text-center tracking-[0] leading-[normal] mb-16">
          Your School. Your Clicks. Your Glory.
        </div>

        {/* Loading Spinner - positioned below subtitle */}
        <div className="mt-12">
          <LoadingSpinner />
        </div>
      </div>
    </div>
  );
};
