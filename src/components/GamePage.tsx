import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

interface GamePageProps {
  isMuted: boolean;
  onToggleMute: () => void;
}

export const GamePage: React.FC<GamePageProps> = ({ isMuted, onToggleMute }) => {
  // Stable iPad detection that won't change during navigation
  const isIPad = useMemo(() => {
    return /iPad/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }, []);

  const [isCopied, setIsCopied] = useState(false);
  const navigate = useNavigate();
  

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

  return (
    <div className="bg-black w-screen h-screen-dvh flex flex-col overflow-hidden select-none relative">
      {/* Animated Background Decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Floating particles */}
        <div className="absolute top-12 left-12 w-2 h-2 bg-red-400 rounded-full animate-ping opacity-60"></div>
        <div className="absolute top-20 right-14 w-1 h-1 bg-orange-400 rounded-full animate-ping delay-1000 opacity-40"></div>
        <div className="absolute top-32 left-1/4 w-1.5 h-1.5 bg-yellow-400 rounded-full animate-ping delay-2000 opacity-50"></div>
        <div className="absolute top-44 right-1/3 w-1 h-1 bg-green-400 rounded-full animate-ping delay-3000 opacity-30"></div>
        <div className="absolute top-56 left-1/2 w-2 h-2 bg-blue-400 rounded-full animate-ping delay-500 opacity-40"></div>
        
        {/* Bottom particles */}
        <div className="absolute bottom-20 left-14 w-1.5 h-1.5 bg-purple-400 rounded-full animate-ping delay-700 opacity-50"></div>
        <div className="absolute bottom-32 right-18 w-1 h-1 bg-pink-400 rounded-full animate-ping delay-1500 opacity-40"></div>
        <div className="absolute bottom-44 left-1/3 w-2 h-2 bg-cyan-400 rounded-full animate-ping delay-2500 opacity-30"></div>
        <div className="absolute bottom-56 right-1/4 w-1 h-1 bg-indigo-400 rounded-full animate-ping delay-3500 opacity-45"></div>
        
        {/* Gradient orbs */}
        <div className="absolute top-1/4 right-1/4 w-28 h-28 bg-gradient-to-r from-red-500/10 to-orange-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 left-1/4 w-32 h-32 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-gradient-to-r from-green-500/10 to-yellow-500/10 rounded-full blur-2xl animate-pulse delay-2000"></div>
      </div>
      {/* Top Bar with thin gradient line */}
      <div 
        className="w-full h-[10vh] min-h-[60px] bg-black flex items-center justify-between px-2 md:px-4 top-navigation-bar" 
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
        
        <div className="flex flex-col items-start gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-1 md:gap-4 flex-1 min-w-0">
            <div 
              className="font-pixelify font-normal text-white text-2xl md:text-4xl lg:text-5xl tracking-[0] leading-[normal] cursor-pointer hover:text-gray-300 transition-colors truncate ml-2 md:ml-4 mt-1 md:mt-0"
              onClick={() => navigate('/')}
            >
              SchoolClicker.com
            </div>
            
            {/* Desktop: Total students counter - next to title */}
            <div className="hidden md:flex items-center gap-2">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <div className="w-1 h-1 bg-green-300 rounded-full animate-ping delay-500"></div>
              </div>
              <span className="font-pixelify font-normal text-green-400 text-xs tracking-[0] leading-[normal]">
                40k+ active students
              </span>
            </div>
          </div>
          
          {/* Mobile: Total students counter - below title */}
          <div className="md:hidden flex items-center gap-2 ml-2 md:ml-4 -mt-0.5">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <div className="w-1 h-1 bg-green-300 rounded-full animate-ping delay-500"></div>
            </div>
            <span className="font-pixelify font-normal text-green-400 text-xs tracking-[0] leading-[normal]">
              40k+ active students
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
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.793L5.5 13.5H3a1 1 0 01-1-1V7.5a1 1 0 011-1h2.5l2.883-3.293a1 1 0 011-.231zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.984 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
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

      {/* Main Content Area */}
      <div 
        className="flex-1 bg-black flex items-center justify-center relative overflow-hidden main-content-area"
        style={{
          paddingTop: isIPad ? 'calc(10vh + 20px)' : undefined,
          paddingBottom: isIPad ? 'calc(12vh + 20px)' : undefined
        }}
      >
      <div className="text-white text-4xl font-pixelify select-none">
        Game Page
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
