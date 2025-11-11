import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";

interface LandingPageProps {
  isMuted: boolean;
  onToggleMute: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ isMuted, onToggleMute }) => {
  // Stable iPad detection that won't change during navigation
  const isIPad = useMemo(() => {
    return /iPad/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }, []);

  // iPhone detection
  const isIPhone = useMemo(() => {
    return /iPhone/.test(navigator.userAgent);
  }, []);

  // Orientation detection state
  const [shouldShowRotateMessage, setShouldShowRotateMessage] = useState(false);

  // Check orientation and device to show rotate message
  useEffect(() => {
    const checkOrientation = () => {
      const isPortrait = window.innerHeight > window.innerWidth;
      const isLandscape = window.innerWidth > window.innerHeight;
      
      // Show message when:
      // - iPad is in vertical/portrait mode
      // - iPhone is in horizontal/landscape mode
      const shouldShow = (isIPad && isPortrait) || (isIPhone && isLandscape);
      setShouldShowRotateMessage(shouldShow);
    };

    // Check on mount
    checkOrientation();

    // Listen for orientation changes
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);

    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, [isIPad, isIPhone]);

  const [isCopied, setIsCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Countdown timer state
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  // Countdown timer effect
  useEffect(() => {
    const calculateCountdown = () => {
      // Target date: December 3rd, 2025, 3:00 PM EST (which is 8:00 PM UTC)
      const targetDate = new Date('2025-12-03T20:00:00Z').getTime();
      const now = new Date().getTime();
      const difference = targetDate - now;

      if (difference > 0) {
        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);

        setCountdown({ days, hours, minutes, seconds });
      } else {
        setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      }
    };

    // Calculate immediately
    calculateCountdown();

    // Update every second
    const timer = setInterval(calculateCountdown, 1000);

    return () => clearInterval(timer);
  }, []);

  // iPad-specific: Reset scroll position on component mount to prevent content drift
  useEffect(() => {
    if (isIPad) {
      // Reset window scroll position to prevent content drifting up
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      
      // Reset document scroll position
      if (document.documentElement) {
        document.documentElement.scrollTop = 0;
        document.documentElement.scrollLeft = 0;
      }
      
      // Reset body scroll position
      if (document.body) {
        document.body.scrollTop = 0;
        document.body.scrollLeft = 0;
      }
    }
  }, []); // Run only on mount

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText('schoolclicker.com');
      setIsCopied(true);
      setTimeout(() => {
        setIsCopied(false);
      }, 3000);
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  };

  useEffect(() => {
    // Clear stored school support data on page refresh
    const handleBeforeUnload = () => {
      sessionStorage.removeItem('currentSchoolSupport');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Check for error messages from navigation state
    if (location.state?.error) {
      setErrorMessage(location.state.error);
      // Clear the error from location state
      window.history.replaceState({}, document.title);
      // Auto-clear error after 10 seconds
      setTimeout(() => {
        setErrorMessage(null);
      }, 10000);
    }

    // Cleanup
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [location.state]);

  // Show rotation message when device is in wrong orientation
  if (shouldShowRotateMessage) {
    return (
      <div className="w-screen h-screen-dvh bg-black flex flex-col items-center justify-center overflow-hidden select-none">
        <div className="text-center px-8">
          {/* Rotation Icon */}
          <div className="mb-8 flex justify-center">
            <div className="w-16 h-16 border-4 border-white rounded-lg flex items-center justify-center animate-pulse">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
                <path d="M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 18.29 0 12 0l-.66.03 3.81 3.81 1.33-1.32z"/>
                <path d="M10.23 1.75c-2.92-.91-6.24.29-8.33 3.32C.29 7.37.29 9.9 1.75 12.23l1.33-1.33c-.91-1.49-.91-3.61.29-5.1 1.2-1.49 3.32-2.12 5.10-1.21l1.76-2.84z"/>
                <path d="M12 21c-3.5 0-6.58-1.8-8.24-4.48l1.33-1.33C6.42 17.97 9.02 19 12 19c2.97 0 5.58-1.03 6.91-2.81l1.33 1.33C18.58 19.2 15.5 21 12 21z"/>
              </svg>
            </div>
          </div>

          {/* Title */}
          <h1 className="font-pixelify font-bold text-white text-3xl md:text-4xl mb-4">
            {isIPad ? 'Please Rotate Your iPad' : 'Please Rotate Your Phone'}
          </h1>

          {/* Instructions */}
          <p className="font-pixelify font-normal text-white/80 text-lg md:text-xl">
            {isIPad 
              ? 'Turn your iPad to landscape mode for the best experience' 
              : 'Turn your phone to portrait mode for the best experience'
            }
          </p>
        </div>
      </div>
    );
  }

  // Responsive design that fills the whole screen
  return (
    <div 
      className="bg-black w-screen h-screen-dvh flex flex-col overflow-hidden select-none relative"
      style={{
        // iPad-specific: Prevent viewport height shifts during navigation
        position: isIPad ? 'fixed' : undefined,
        top: isIPad ? '0' : undefined,
        left: isIPad ? '0' : undefined,
        right: isIPad ? '0' : undefined,
        bottom: isIPad ? '0' : undefined
      }}
    >
      {/* Animated Background Decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Floating particles */}
        <div className="absolute top-10 left-10 w-2 h-2 bg-blue-400 rounded-full animate-ping opacity-60"></div>
        <div className="absolute top-20 right-16 w-1 h-1 bg-purple-400 rounded-full animate-ping delay-1000 opacity-40"></div>
        <div className="absolute top-32 left-1/4 w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping delay-2000 opacity-50"></div>
        <div className="absolute top-40 right-1/3 w-1 h-1 bg-pink-400 rounded-full animate-ping delay-3000 opacity-30"></div>
        <div className="absolute top-60 left-1/2 w-2 h-2 bg-yellow-400 rounded-full animate-ping delay-500 opacity-40"></div>
        
        {/* Bottom particles */}
        <div className="absolute bottom-20 left-12 w-1.5 h-1.5 bg-green-400 rounded-full animate-ping delay-700 opacity-50"></div>
        <div className="absolute bottom-32 right-20 w-1 h-1 bg-red-400 rounded-full animate-ping delay-1500 opacity-40"></div>
        <div className="absolute bottom-40 left-1/3 w-2 h-2 bg-indigo-400 rounded-full animate-ping delay-2500 opacity-30"></div>
        <div className="absolute bottom-60 right-1/4 w-1 h-1 bg-orange-400 rounded-full animate-ping delay-3500 opacity-45"></div>
        
        {/* Gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-40 h-40 bg-gradient-to-r from-pink-500/10 to-cyan-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-gradient-to-r from-yellow-500/10 to-orange-500/10 rounded-full blur-2xl animate-pulse delay-2000"></div>
      </div>
      {/* Top Bar with thin gradient line */}
      <div 
        className="w-full h-[10vh] min-h-[60px] lg:min-h-[80px] bg-black flex items-center justify-between px-4 lg:px-6 xl:px-8 top-navigation-bar" 
        style={{ 
          paddingTop: isIPad ? '0' : 'env(safe-area-inset-top)',
          position: isIPad ? 'absolute' : 'relative',
          top: isIPad ? '0' : undefined,
          left: isIPad ? '0' : undefined,
          right: isIPad ? '0' : undefined,
          zIndex: isIPad ? '50' : undefined
        }}
      >
        <div className="absolute w-full h-px bottom-0 bg-white left-0 right-0"></div>
        
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-1 lg:gap-6 flex-1 min-w-0">
          <div className="flex items-center gap-2 lg:gap-6 flex-1 min-w-0">
            <div 
              className="font-pixelify font-normal text-white text-2xl lg:text-4xl xl:text-5xl 2xl:text-6xl tracking-[0] leading-[normal] cursor-pointer hover:text-gray-300 transition-colors truncate"
              onClick={() => navigate('/')}
            >
              SchoolClicker.com
            </div>
            
            {/* Desktop: Total students counter - next to title */}
            <div className="hidden lg:flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-green-300 rounded-full animate-ping delay-500"></div>
              </div>
              <span className="font-pixelify font-normal text-green-400 text-sm xl:text-base tracking-[0] leading-[normal]">
                10k+ active students
              </span>
            </div>
          </div>
          
          {/* Mobile: Total students counter - below title */}
          <div className="lg:hidden flex items-center gap-2 -mt-0.5">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <div className="w-1 h-1 bg-green-300 rounded-full animate-ping delay-500"></div>
            </div>
            <span className="font-pixelify font-normal text-green-400 text-xs tracking-[0] leading-[normal]">
              10k+ active students
            </span>
          </div>
        </div>

        {/* Right side buttons container */}
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          {/* Mute Button */}
          <div 
            className="w-8 h-8 md:w-9 md:h-9 bg-gray-700 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-600 transition-colors z-10"
            onClick={onToggleMute}
          >
            {isMuted ? (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.793L5.5 13.5H3a1 1 0 01-1-1V7.5a1 1 0 011-1h2.5l2.883-3.293a1 1 0 011-.231zM12.293 6.293a1 1 0 011.414 0L15 7.586l1.293-1.293a1 1 0 111.414 1.414L16.414 9l1.293 1.293a1 1 0 01-1.414 1.414L15 10.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 9l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-4 h-4 md:w-5 md:h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.793L5.5 13.5H3a1 1 0 01-1-1V7.5a1 1 0 011-1h2.5l2.883-3.293a1 1 0 011-.231zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
              </svg>
            )}
          </div>

          {/* Discord Button */}
          <a 
            href="https://discord.gg/gGqrFQRjmE" 
            target="_blank" 
            rel="noopener noreferrer"
            className="w-8 h-8 md:w-9 md:h-9 bg-[#6b3df5] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#5a2dd4] transition-colors"
          >
            <img src="/icons/discord.svg" alt="Discord" className="w-4 h-4 md:w-5 md:h-5" draggable={false} />
          </a>

          {/* Link Button */}
          <div className="relative">
            <div 
              className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 ${isCopied ? 'bg-green-500' : 'bg-gradient-to-b from-[#1500ff] to-[#120099] hover:from-[#1300e6] hover:to-[#0f0080]'}`}
              onClick={handleShare}
            >
              {isCopied ? (
                <svg className="w-4 h-4 md:w-5 md:h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4 md:w-5 md:h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            {/* Speech Bubble */}
            {isCopied && (
              <div className="absolute top-12 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap z-50">
                Copied!
                <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-black rotate-45"></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="w-full bg-red-600 text-white px-4 py-3 text-center text-sm md:text-base relative z-20">
          <div className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{errorMessage}</span>
            <button 
              onClick={() => setErrorMessage(null)}
              className="ml-4 hover:text-gray-300 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div 
        className="flex-1 bg-black flex flex-col items-center justify-center relative overflow-hidden main-content-area"
        style={{
          paddingTop: isIPad ? 'calc(10vh + 20px)' : undefined,
          paddingBottom: isIPad ? 'calc(12vh + 20px)' : undefined,
          // iPad-specific: Ensure content stays in place during navigation
          position: isIPad ? 'relative' : undefined,
          top: isIPad ? '0' : undefined
        }}
      >
        {/* Subtle background pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-[10vh] left-[5vw] w-32 h-32 border border-white rounded-full animate-pulse"></div>
          <div className="absolute top-[20vh] right-[5vw] w-24 h-24 border border-blue-400 rounded-full animate-pulse delay-1000"></div>
          <div className="absolute bottom-[20vh] left-[8vw] w-20 h-20 border border-red-400 rounded-full animate-pulse delay-500"></div>
          <div className="absolute bottom-[10vh] right-[8vw] w-16 h-16 border border-yellow-400 rounded-full animate-pulse delay-700"></div>
        </div>

        {/* Main Title with enhanced styling */}
        <div className="relative z-10 mb-8 px-4">
          <h1 className="font-pixelify font-bold text-4xl md:text-5xl lg:text-6xl xl:text-7xl text-center tracking-[0] leading-[normal] text-white relative max-w-4xl">
            <span className="relative z-10">Your School<br /><span className="text-[#ffe100] font-black text-5xl md:text-6xl lg:text-7xl xl:text-8xl animate-pulse drop-shadow-[0_0_20px_rgba(255,225,0,0.8)]">VS</span><br />100+ Schools</span>
            {/* Subtle glow effect */}
            <div className="absolute inset-0 text-white/20 blur-sm animate-pulse">
              Your School<br />VS<br />100+ Schools
            </div>
          </h1>
        </div>
        
        {/* Instructional Text with enhanced styling */}
        <div className="relative z-10 mb-8 px-4">
          <div className="font-pixelify font-normal text-lg md:text-xl lg:text-2xl text-center tracking-[0] leading-[normal] max-w-4xl">
            <span className="text-white">
              Choose your school to <span className="text-[#00aaff] font-semibold relative">
                support
                <div className="absolute -bottom-1 left-0 w-full h-0.5 bg-[#00aaff] opacity-50"></div>
              </span>! <br />
            </span>
            <span className="text-white">Or go <span className="text-[#ff0000] font-semibold relative">
              destroy
              <div className="absolute -bottom-1 left-0 w-full h-0.5 bg-[#ff0000] opacity-50"></div>
            </span> the others!</span>
          </div>
        </div>

        {/* Countdown Timer */}
        <div className="relative z-10 mb-12 px-4">
          <div className="bg-gradient-to-r from-purple-600/20 via-pink-600/20 to-purple-600/20 backdrop-blur-sm border-2 border-purple-500/50 rounded-2xl p-4 md:p-6 max-w-2xl mx-auto shadow-2xl">
            <div className="flex flex-col items-center gap-3">
              <div className="font-pixelify font-bold text-sm md:text-base text-purple-300 uppercase tracking-wider">
                Season Ends In
              </div>
              <div className="flex items-center justify-center gap-2 md:gap-4 flex-wrap">
                {/* Days */}
                <div className="flex flex-col items-center bg-black/40 rounded-lg px-3 py-2 md:px-4 md:py-3 min-w-[70px] md:min-w-[90px]">
                  <div className="font-pixelify font-bold text-3xl md:text-4xl lg:text-5xl text-white">
                    {countdown.days.toString().padStart(2, '0')}
                  </div>
                  <div className="font-pixelify font-normal text-xs md:text-sm text-purple-300 uppercase mt-1">
                    Days
                  </div>
                </div>

                <div className="font-pixelify font-bold text-2xl md:text-3xl text-purple-400">:</div>

                {/* Hours */}
                <div className="flex flex-col items-center bg-black/40 rounded-lg px-3 py-2 md:px-4 md:py-3 min-w-[70px] md:min-w-[90px]">
                  <div className="font-pixelify font-bold text-3xl md:text-4xl lg:text-5xl text-white">
                    {countdown.hours.toString().padStart(2, '0')}
                  </div>
                  <div className="font-pixelify font-normal text-xs md:text-sm text-purple-300 uppercase mt-1">
                    Hours
                  </div>
                </div>

                <div className="font-pixelify font-bold text-2xl md:text-3xl text-purple-400">:</div>

                {/* Minutes */}
                <div className="flex flex-col items-center bg-black/40 rounded-lg px-3 py-2 md:px-4 md:py-3 min-w-[70px] md:min-w-[90px]">
                  <div className="font-pixelify font-bold text-3xl md:text-4xl lg:text-5xl text-white">
                    {countdown.minutes.toString().padStart(2, '0')}
                  </div>
                  <div className="font-pixelify font-normal text-xs md:text-sm text-purple-300 uppercase mt-1">
                    Min
                  </div>
                </div>

                <div className="font-pixelify font-bold text-2xl md:text-3xl text-purple-400">:</div>

                {/* Seconds */}
                <div className="flex flex-col items-center bg-black/40 rounded-lg px-3 py-2 md:px-4 md:py-3 min-w-[70px] md:min-w-[90px]">
                  <div className="font-pixelify font-bold text-3xl md:text-4xl lg:text-5xl text-white animate-pulse">
                    {countdown.seconds.toString().padStart(2, '0')}
                  </div>
                  <div className="font-pixelify font-normal text-xs md:text-sm text-purple-300 uppercase mt-1">
                    Sec
                  </div>
                </div>
              </div>
            </div>
          </div>
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

      </div>

      {/* Bottom Navigation Bar */}
      <div 
        className="w-full h-[12vh] min-h-[80px] bg-white flex bottom-navigation-bar" 
        style={{ 
          paddingBottom: isIPad ? '0' : 'env(safe-area-inset-bottom)',
          position: isIPad ? 'absolute' : 'relative',
          bottom: isIPad ? '0' : undefined,
          left: isIPad ? '0' : undefined,
          right: isIPad ? '0' : undefined,
          zIndex: isIPad ? '50' : undefined
        }}
      >
        {/* Downward Arrow - positioned above leaderboard button */}
        <div className="absolute top-0 left-3/4 transform -translate-x-1/2 -translate-y-[150%] flex justify-center">
          <div className="w-0 h-0 border-l-[16px] border-r-[16px] border-t-[24px] border-l-transparent border-r-transparent border-t-red-500 animate-bounce-arrow"></div>
        </div>
        {/* Left Section - Main Game (Active) */}
        <div className="w-1/2 h-full bg-white flex items-center justify-center">
          <img src="/icons/hand.svg" alt="Main Game" className="w-8 h-8 md:w-11 md:h-11" draggable={false} />
        </div>

        {/* Divider Line */}
        <div className="w-px h-full bg-gray-300"></div>

        {/* Right Section - Leaderboard */}
        <div 
          className="w-1/2 h-full bg-[#d5d5d5] flex items-center justify-center cursor-pointer hover:bg-gray-400 transition-colors"
          onClick={() => navigate('/leaderboard')}
        >
          <img src="/icons/leaderboard.svg" alt="Leaderboard" className="w-12 h-12 md:w-[60px] md:h-[60px]" draggable={false} />
        </div>
      </div>

    </div>
  );
};
