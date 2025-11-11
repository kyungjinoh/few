import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { schoolNameToSlug } from "../utils/schoolUtils";
import { useSchoolData } from "../contexts/SchoolDataContext";
import { submitSchoolRequest } from "../firebase/schoolService";

const DESIGN_WIDTH = 430;
const DESIGN_HEIGHT = 932;

interface LeaderboardPageProps {
  isMuted: boolean;
  onToggleMute: () => void;
}

export const LeaderboardPage: React.FC<LeaderboardPageProps> = ({ isMuted, onToggleMute }) => {
  const [scaleFactor, setScaleFactor] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [schoolLocation, setSchoolLocation] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [, setSchoolScore] = useState(() => {
    const savedScore = localStorage.getItem('schoolScore');
    return savedScore ? parseInt(savedScore, 10) : 11046042;
  });
  
  // Animated scores for top 3 schools (visual only, not stored)
  const [animatedScores, setAnimatedScores] = useState<{[key: string]: number}>({});
  
  // Random PPS (Points Per Second) values for visual effect
  const [ppsValues, setPpsValues] = useState<{[key: string]: {pps: number, multiplier: number}}>({});
  
  // Use shared school data from context (static data loaded during loading page)
  const { schools: allSchools, loading } = useSchoolData();
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

  useEffect(() => {
    // Data is now provided by SchoolDataContext as static data (no live updates)
    console.log('📊 [LEADERBOARD] Using static school data from context:', allSchools.length, 'schools');

    const checkIsMobile = () => {
      // Check if screen width is mobile-sized (typically < 768px)
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };

    const calculateScale = () => {
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      
      // For mobile devices, ensure we fill the entire screen
      if (window.innerWidth < 768) {
        // Use the larger scale to fill the screen completely
        const widthScale = screenWidth / DESIGN_WIDTH;
        const heightScale = screenHeight / DESIGN_HEIGHT;
        const scale = Math.max(widthScale, heightScale);
        setScaleFactor(scale);
      } else {
        // For desktop, maintain aspect ratio
        const widthScale = screenWidth / DESIGN_WIDTH;
        const heightScale = screenHeight / DESIGN_HEIGHT;
        const scale = Math.min(widthScale, heightScale);
        setScaleFactor(scale);
      }
    };

    // Initial calculations
    checkIsMobile();
    calculateScale();

    // Check for current school in sessionStorage
    const currentSchool = sessionStorage.getItem('currentSchoolSupport');
    if (currentSchool) {
      setSelectedSchool(currentSchool);
    }

    // Clear stored school support data on page refresh
    const handleBeforeUnload = () => {
      sessionStorage.removeItem('currentSchoolSupport');
    };

    // Recalculate on window resize
    const handleResize = () => {
      checkIsMobile();
      calculateScale();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Listen for localStorage changes to update school scores
  useEffect(() => {
    const handleStorageChange = () => {
      // Force re-render when any school score changes
      setSchoolScore(prev => prev + 1);
    };

    // Listen for storage events (when localStorage changes in other tabs)
    window.addEventListener('storage', handleStorageChange);

    // Also check periodically for changes within the same tab
    const interval = setInterval(() => {
      // Force re-render every second to catch any changes
      setSchoolScore(prev => prev + 1);
    }, 1000); // Check every second

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Animation effect for top 3 schools (visual only)
  useEffect(() => {
    if (allSchools.length === 0) return;

    // Initialize animated scores with actual scores
    const initialScores: {[key: string]: number} = {};
    allSchools.slice(0, 3).forEach(school => {
      const localScore = getSchoolScore(school.schoolName);
      const displayScore = localScore > 0 ? localScore : school.score;
      initialScores[school.schoolName] = displayScore;
    });
    setAnimatedScores(initialScores);

    // Different animation speeds for each rank
    const intervals: NodeJS.Timeout[] = [];
    
    // 1st place: 1 point every 100ms (10 points per second)
    if (allSchools[0]) {
      const interval1 = setInterval(() => {
        setAnimatedScores(prevScores => ({
          ...prevScores,
          [allSchools[0].schoolName]: (prevScores[allSchools[0].schoolName] || 0) + 1
        }));
      }, 100);
      intervals.push(interval1);
    }
    
    // 2nd place: 1 point every 130ms (~7.7 points per second)
    if (allSchools[1]) {
      const interval2 = setInterval(() => {
        setAnimatedScores(prevScores => ({
          ...prevScores,
          [allSchools[1].schoolName]: (prevScores[allSchools[1].schoolName] || 0) + 1
        }));
      }, 130);
      intervals.push(interval2);
    }
    
    // 3rd place: 1 point every 200ms (5 points per second)
    if (allSchools[2]) {
      const interval3 = setInterval(() => {
        setAnimatedScores(prevScores => ({
          ...prevScores,
          [allSchools[2].schoolName]: (prevScores[allSchools[2].schoolName] || 0) + 1
        }));
      }, 200);
      intervals.push(interval3);
    }

    return () => {
      intervals.forEach(interval => clearInterval(interval));
    };
  }, [allSchools]);

  // PPS (Points Per Second) animation for top 3 schools
  useEffect(() => {
    if (allSchools.length === 0) return;

    // Initialize PPS values for top 3 schools
    const initialPpsValues: {[key: string]: {pps: number, multiplier: number}} = {};
    allSchools.slice(0, 3).forEach((school, index) => {
      // Different PPS ranges for each rank
      let minPps, maxPps;
      if (index === 0) {
        // 1st place: 50-100 PPS
        minPps = 50;
        maxPps = 100;
      } else if (index === 1) {
        // 2nd place: 20-50 PPS
        minPps = 20;
        maxPps = 50;
      } else {
        // 3rd place: 5-20 PPS
        minPps = 5;
        maxPps = 20;
      }
      
      initialPpsValues[school.schoolName] = {
        pps: Math.random() * (maxPps - minPps) + minPps,
        multiplier: Math.random() * 0.5 + 0.5 // 0.5 to 1.0 multiplier
      };
    });
    setPpsValues(initialPpsValues);

    // Animate PPS values every 2-5 seconds
    const ppsInterval = setInterval(() => {
      setPpsValues(prevPps => {
        const newPps = {...prevPps};
        allSchools.slice(0, 3).forEach((school, index) => {
          if (newPps[school.schoolName]) {
            let minPps, maxPps;
            if (index === 0) {
              minPps = 50;
              maxPps = 100;
            } else if (index === 1) {
              minPps = 20;
              maxPps = 50;
            } else {
              minPps = 5;
              maxPps = 20;
            }
            
            newPps[school.schoolName] = {
              pps: Math.random() * (maxPps - minPps) + minPps,
              multiplier: Math.random() * 0.5 + 0.5
            };
          }
        });
        return newPps;
      });
    }, Math.random() * 3000 + 2000); // Random interval between 2-5 seconds

    return () => {
      clearInterval(ppsInterval);
    };
  }, [allSchools]);

  // Format number with commas
  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  // Get school score from localStorage or return 0
  const getSchoolScore = (schoolName: string): number => {
    // Check for school-specific saved score
    const savedScore = localStorage.getItem(`schoolScore_${schoolName}`);
    if (savedScore) {
      return parseInt(savedScore, 10);
    }
    
    // Return 0 as default score
    return 0;
  };

  // Reset all school scores to 0
  // const _resetAllSchoolScores = (): void => {
  //   const schools = ['columbiauniversity', 'harvarduniversity', 'yaleuniversity', 'stanforduniversity', 'mituniversity', 'princetonuniversity', 'upennuniversity', 'brownuniversity', 'dartmouthuniversity', 'cornelluniversity'];
  //   schools.forEach(school => {
  //     localStorage.setItem(`schoolScore_${school}`, '0');
  //   });
  // };

  // Create leaderboard data from Firebase schools, using local scores when available
  const leaderboardData = allSchools.map((school, index) => {
    // Get local score if available, otherwise use Firebase score
    const localScore = getSchoolScore(school.schoolName);
    const baseScore = localScore > 0 ? localScore : school.score;
    
    // Use animated score for top 3 schools (visual only)
    const displayScore = index < 3 && animatedScores[school.schoolName] !== undefined 
      ? animatedScores[school.schoolName] 
      : baseScore;
    
    // Log when using local score
    if (localScore > 0 && localScore !== school.score) {
      console.log(`📊 [LEADERBOARD] Using local score for ${school.schoolName}: ${localScore} (Firebase: ${school.score})`);
    }
    
    return {
      rank: school.rank,
      school: school.schoolName,
      score: displayScore, // Keep as number for sorting
      formattedScore: formatNumber(displayScore), // Formatted for display
      avatar: school.schoolLogo
    };
  });

  // Sort leaderboard by actual score (including local changes) in descending order
  const sortedLeaderboardData = leaderboardData.sort((a, b) => b.score - a.score);

  // Update ranks based on sorted order
  const rankedLeaderboardData = sortedLeaderboardData.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    score: entry.formattedScore // Use formatted score for display
  }));

  // Filter leaderboard data based on search query
  const filteredLeaderboardData = rankedLeaderboardData.filter(entry =>
    entry.school.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Handle request school button click
  const handleRequestSchool = () => {
    setShowRequestModal(true);
  };

  const handleSubmitRequest = async () => {
    if (schoolName.trim() && schoolLocation.trim()) {
      try {
        console.log("Submitting school request:", { name: schoolName, location: schoolLocation });
        
        // Submit to Firebase
        const requestId = await submitSchoolRequest(schoolName, schoolLocation);
        
        console.log("School request submitted successfully with ID:", requestId);
        
        // Close modal and reset form
        setShowRequestModal(false);
        setSchoolName("");
        setSchoolLocation("");
        
        alert("School request submitted successfully! We'll review it and add your school soon.");
      } catch (error) {
        console.error("Error submitting school request:", error);
        alert("Failed to submit school request. Please try again.");
      }
    } else {
      alert("Please fill in both school name and location.");
    }
  };

  const handleCloseModal = () => {
    setShowRequestModal(false);
    setSchoolName("");
    setSchoolLocation("");
  };

  // Handle school click to navigate to support page
  const handleSchoolClick = (schoolName: string) => {
    const schoolSlug = schoolNameToSlug(schoolName);
    setSelectedSchool(schoolSlug);
    navigate(`/${schoolSlug}`);
  };

  // Check if a school is currently selected
  const isSchoolSelected = (schoolName: string) => {
    const schoolSlug = schoolNameToSlug(schoolName);
    return selectedSchool === schoolSlug;
  };

  // Handle main game button click - navigate to last school support page or main page
  const handleMainGameClick = () => {
    const lastSchoolSupport = sessionStorage.getItem('currentSchoolSupport');
    console.log('Main game button clicked from leaderboard, lastSchoolSupport:', lastSchoolSupport);
    if (lastSchoolSupport) {
      console.log('Navigating to:', `/${lastSchoolSupport}`);
      navigate(`/${lastSchoolSupport}`);
    } else {
      console.log('No last school support, navigating to main page');
      navigate('/');
    }
  };

  // Show loading state while fetching data
  if (loading) {
    return (
      <div className="bg-black w-screen h-screen flex items-center justify-center">
        <div className="text-white text-xl">Loading schools...</div>
      </div>
    );
  }

  if (isMobile) {
    // Mobile: Use full viewport with responsive layout
    return (
      <div className="bg-black w-screen h-screen flex flex-col overflow-hidden select-none">
        {/* Header */}
        <div className="w-full px-4 py-3 flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="font-pixelify font-normal text-white text-2xl tracking-[0] leading-[normal]">
              SchoolClicker.com
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <div className="w-1 h-1 bg-green-300 rounded-full animate-ping delay-500"></div>
              </div>
              <span className="font-pixelify font-normal text-green-400 text-xs tracking-[0] leading-[normal]">
                10k+ active students
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div 
              className="w-9 h-9 bg-gray-700 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-600 transition-colors z-10"
              onClick={onToggleMute}
            >
              {isMuted ? (
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707A1 1 0 019.383 3.076zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707A1 1 0 019.383 3.076zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <a 
              href="https://discord.gg/schoolclicker" 
              target="_blank" 
              rel="noopener noreferrer"
              className="w-9 h-9 bg-[#6b3df5] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#5a2dd4] transition-colors"
            >
              <img src="/icons/discord.svg" alt="Discord" className="w-5 h-5" draggable={false} />
            </a>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col px-4 pb-4">
          {/* Title */}
          <div className="text-center mb-4">
            <h2 className="font-pixelify font-normal text-[#ffe100] text-4xl tracking-[0] leading-[normal] mb-2">
              Leaderboard
            </h2>
            <div className="flex items-center justify-center gap-1">
              <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
              <span className="font-pixelify font-normal text-blue-400 text-sm tracking-[0] leading-[normal]">
                Join {allSchools.length} schools competing
              </span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="mb-3 opacity-75">
            <div className="relative">
              <input
                type="text"
                placeholder="Search school to support/attack"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 pr-10 bg-transparent border border-white/40 rounded-md font-pixelify font-normal text-white text-xs placeholder-white placeholder-opacity-50 focus:outline-none focus:border-yellow-400/60"
              />
              <img 
                className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 opacity-60"
                alt="Search"
                src="/icons/search.svg"
                draggable={false}
              />
            </div>
          </div>

          {/* Leaderboard */}
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-2">
              {filteredLeaderboardData.map((entry, index) => (
                <div key={index} className="bg-gray-800 rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-pixelify font-bold text-white text-lg">
                      #{entry.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-pixelify font-normal text-white text-sm truncate">
                        {entry.school}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-pixelify font-bold text-sm ${entry.rank <= 3 ? 'text-yellow-400' : 'text-white'}`}>
                          {entry.score}
                        </span>
                        {entry.rank <= 3 && ppsValues[entry.school] && (
                          <span className="ml-2 font-pixelify font-bold text-green-400 text-[12px]">
                            {ppsValues[entry.school].pps.toFixed(1)} PPS
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSchoolClick(entry.school)}
                    className="w-8 h-8 bg-[#6b3df5] rounded flex items-center justify-center hover:bg-[#5a2dd4] transition-colors"
                  >
                    <img 
                      className="w-5 h-5"
                      alt="Click Icon"
                      src="/icons/click.svg"
                      style={{ filter: 'brightness(0) invert(1)' }}
                      draggable={false}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Navigation */}
          <div className="mt-4 flex gap-2">
            <div 
              className="flex-1 bg-white rounded-lg p-3 flex items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors"
              onClick={handleMainGameClick}
            >
              <img src="/icons/hand.svg" alt="Main Game" className="w-6 h-6" draggable={false} />
            </div>
            <div 
              className="flex-1 bg-[#d5d5d5] rounded-lg p-3 flex items-center justify-center cursor-pointer hover:bg-gray-400 transition-colors"
              onClick={() => navigate('/leaderboard')}
            >
              <img src="/icons/leaderboard.svg" alt="Leaderboard" className="w-8 h-8" draggable={false} />
            </div>
          </div>
        </div>

        {/* Request School Modal */}
        {showRequestModal && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[100]">
            <div className="bg-black border-2 border-white rounded-lg p-6 w-[350px] max-w-[90vw]">
              <h2 className="text-2xl font-pixelify font-normal text-white mb-6 text-center">Request School</h2>
              
              <div className="mb-4">
                <label className="block text-sm font-pingfang font-normal text-white mb-2">
                  School Name
                </label>
                <input
                  type="text"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  placeholder="Enter school name"
                  className="w-full px-3 py-2 bg-transparent border-2 border-white text-white placeholder-white placeholder-opacity-51 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2600A3] focus:border-[#2600A3] font-pingfang"
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-pingfang font-normal text-white mb-2">
                  School Location
                </label>
                <input
                  type="text"
                  value={schoolLocation}
                  onChange={(e) => setSchoolLocation(e.target.value)}
                  placeholder="Enter school location"
                  className="w-full px-3 py-2 bg-transparent border-2 border-white text-white placeholder-white placeholder-opacity-51 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2600A3] focus:border-[#2600A3] font-pingfang"
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 border-2 border-white text-white rounded-md hover:bg-white hover:text-black transition-colors font-pingfang"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitRequest}
                  className="flex-1 px-4 py-2 bg-[#2600A3] text-white rounded-md hover:bg-[#1a0080] transition-colors font-pingfang"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop: Scale to fit screen height while maintaining mobile proportions
  return (
    <div className="bg-black w-screen h-screen flex items-center justify-center overflow-hidden select-none">
      <div
        className="relative bg-black select-none"
        style={{
          width: `${DESIGN_WIDTH}px`,
          height: `${DESIGN_HEIGHT}px`,
          transform: `scale(${scaleFactor})`,
          transformOrigin: 'center center',
        }}
      >
        {/* Top Bar - Sticky */}
        <div className="absolute w-[430px] h-[118px] top-0 left-0 bg-black z-50">
          <div className="absolute w-full h-px bottom-0 bg-white"></div>
          
          <div 
            className="absolute w-[234px] top-[60px] left-3 font-pixelify font-normal text-white text-3xl tracking-[0] leading-[normal] whitespace-nowrap cursor-pointer hover:text-gray-300 transition-colors"
            onClick={() => {
              // Clear selected school from storage when logo is clicked
              sessionStorage.removeItem('currentSchoolSupport');
              navigate('/');
            }}
          >
            SchoolClicker.com
          </div>
          
          {/* Active clickers counter - below title */}
          <div className="absolute top-[95px] left-3 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <div className="w-1 h-1 bg-green-300 rounded-full animate-ping delay-500"></div>
            </div>
            <span className="font-pixelify font-normal text-green-400 text-xs tracking-[0] leading-[normal]">
              10k+ active students
            </span>
          </div>

          {/* Right side buttons container */}
          <div className="absolute top-[65px] right-3 flex items-center gap-3">
            {/* Mute Button */}
            <div 
              className="w-9 h-9 bg-gray-700 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-600 transition-colors z-10"
              onClick={onToggleMute}
            >
              {isMuted ? (
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.793L5.5 13.5H3a1 1 0 01-1-1V7.5a1 1 0 011-1h2.5l2.883-3.293a1 1 0 011-.231zM12.293 6.293a1 1 0 011.414 0L15 7.586l1.293-1.293a1 1 0 111.414 1.414L16.414 9l1.293 1.293a1 1 0 01-1.414 1.414L15 10.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 9l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.793L5.5 13.5H3a1 1 0 01-1-1V7.5a1 1 0 011-1h2.5l2.883-3.293a1 1 0 011-.231zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                </svg>
              )}
            </div>

            {/* Discord Button */}
            <a 
              href="https://discord.gg/gGqrFQRjmE" 
              target="_blank" 
              rel="noopener noreferrer"
              className="w-9 h-9 bg-[#6b3df5] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#5a2dd4] transition-colors"
            >
              <img src="/icons/discord.svg" alt="Discord" className="w-5 h-5" draggable={false} />
            </a>

            {/* Link Button */}
            <div className="relative">
              <div 
                className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 ${isCopied ? 'bg-green-500' : 'bg-gradient-to-b from-[#1500ff] to-[#120099] hover:from-[#1300e6] hover:to-[#0f0080]'}`}
                onClick={handleShare}
              >
                {isCopied ? (
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
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

        {/* Leaderboard Title */}
        <div className="absolute top-[137px] left-0 w-[430px] font-pixelify font-normal text-[#ffe100] text-5xl text-center tracking-[0] leading-[normal]">
          Leaderboard
        </div>

        {/* Schools Competing Counter */}
        <div className="absolute top-[190px] left-0 w-[430px] flex items-center justify-center gap-2">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
            <div className="w-1 h-1 bg-blue-300 rounded-full animate-ping delay-500"></div>
          </div>
          <span className="font-pixelify font-normal text-blue-400 text-sm tracking-[0] leading-[normal]">
            Join {allSchools.length} schools competing
          </span>
        </div>

        {/* Main Leaderboard Content */}
        <div className="absolute w-[393px] h-[591px] top-[212px] left-[18px] border-[3px] border-solid border-white">
          {/* Search Bar */}
          <div className="absolute w-[349px] h-[36px] top-[22px] left-[22px] border border-solid border-white/40 flex items-center opacity-75">
            <img
              className="w-[18px] h-[18px] ml-1 opacity-60"
              alt="Search"
              src="/icons/search.svg"
              draggable={false}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search school to support/attack"
              className="ml-2 bg-transparent border-none outline-none font-pingfang font-normal text-white text-sm tracking-[0] leading-[normal] placeholder-white placeholder-opacity-40 flex-1"
            />
          </div>

          {/* Leaderboard Entries */}
          <div className="absolute top-[90px] left-0 right-0 bottom-[40px] overflow-y-auto">
            {filteredLeaderboardData.map((entry) => (
              <div 
                key={entry.rank} 
                className={`group relative w-full mb-2 cursor-pointer transition-colors ${
                  isSchoolSelected(entry.school) 
                    ? 'h-[50px] bg-[#2600A3] bg-opacity-20 border-2 border-white' 
                    : 'h-[39px] hover:bg-white hover:bg-opacity-10'
                }`}
                onClick={() => handleSchoolClick(entry.school)}
              >
                {/* Rank */}
                <div className={`absolute w-[73px] ${isSchoolSelected(entry.school) ? 'top-[2px]' : 'top-[-2px]'} left-3.5 font-pixelify font-normal text-white tracking-[0] leading-[normal] whitespace-nowrap ${entry.rank >= 10 ? 'text-[28px]' : 'text-[32px]'} ${selectedSchool && !isSchoolSelected(entry.school) ? 'opacity-50 group-hover:opacity-100' : 'opacity-100'}`}>
                  #{entry.rank}
                </div>

                {/* School Name and Score */}
                <div className={`absolute w-[233px] h-[21px] ${isSchoolSelected(entry.school) ? 'top-[2px]' : 'top-[-1px]'} left-[65px] font-pixelify font-normal text-white text-[15px] tracking-[0] leading-[normal] ${selectedSchool && !isSchoolSelected(entry.school) ? 'opacity-50 group-hover:opacity-100' : 'opacity-100'}`}>
                  {entry.school}
                </div>
                <div className={`absolute ${isSchoolSelected(entry.school) ? 'top-[24px]' : 'top-[20px]'} left-[65px] font-pixelify font-normal text-[#ffe100] text-[15px] tracking-[0] leading-[normal] ${selectedSchool && !isSchoolSelected(entry.school) ? 'opacity-50 group-hover:opacity-100' : 'opacity-100'}`}>
                  {entry.score}
                  {/* PPS Display for top 3 schools */}
                  {entry.rank <= 3 && ppsValues[entry.school] && (
                    <span className="ml-2 font-pixelify font-bold text-green-400 text-[12px]">
                      {ppsValues[entry.school].pps.toFixed(1)} PPS
                    </span>
                  )}
                </div>

                {/* Avatar */}
                <div className={`absolute w-[65px] h-8 ${isSchoolSelected(entry.school) ? 'top-[5px]' : 'top-1'} right-3 bg-[#2600A3] rounded-lg flex items-center justify-center ${selectedSchool ? '' : 'animate-bounce-button'} ${selectedSchool && !isSchoolSelected(entry.school) ? 'opacity-50 group-hover:opacity-100' : 'opacity-100'}`}>
                  <img
                    className="w-5 h-5"
                    alt="Click Icon"
                    src="/icons/click.svg"
                    style={{ filter: 'brightness(0) invert(1)' }}
                    draggable={false}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Request School Button - Inside leaderboard container */}
          <button 
            onClick={handleRequestSchool}
            className="absolute w-[387px] h-[40px] bottom-[0px] left-[0px] bg-[#2600A3] flex items-center justify-center font-pingfang font-normal text-white text-sm tracking-[0] leading-[normal] hover:bg-[#1a0080] transition-colors z-50"
          >
            School is not here? Click to request school
          </button>

        </div>

        {/* Bottom Navigation Bar - Sticky */}
        <div className="absolute w-[430px] h-[98px] top-[834px] left-0 bg-white z-50 flex">
          {/* Left Section - Main Game */}
          <div 
            className="w-1/2 h-full bg-[#d5d5d5] flex items-center justify-center cursor-pointer hover:bg-gray-400 transition-colors"
            onClick={handleMainGameClick}
          >
            <img src="/icons/hand.svg" alt="Main Game" className="w-11 h-11" draggable={false} />
          </div>

          {/* Divider Line */}
          <div className="w-px h-full bg-gray-300"></div>

          {/* Right Section - Leaderboard (Active) */}
          <div className="w-1/2 h-full bg-white flex items-center justify-center">
            <img src="/icons/leaderboard.svg" alt="Leaderboard" className="w-[60px] h-[60px]" draggable={false} />
          </div>
        </div>

        {/* Request School Modal */}
        {showRequestModal && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[100]">
            <div className="bg-black border-2 border-white rounded-lg p-6 w-[350px] max-w-[90vw]">
              <h2 className="text-2xl font-pixelify font-normal text-white mb-6 text-center">Request School</h2>
              
              <div className="mb-4">
                <label className="block text-sm font-pingfang font-normal text-white mb-2">
                  School Name
                </label>
                <input
                  type="text"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  placeholder="Enter school name"
                  className="w-full px-3 py-2 bg-transparent border-2 border-white text-white placeholder-white placeholder-opacity-51 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2600A3] focus:border-[#2600A3] font-pingfang"
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-pingfang font-normal text-white mb-2">
                  School Location
                </label>
                <input
                  type="text"
                  value={schoolLocation}
                  onChange={(e) => setSchoolLocation(e.target.value)}
                  placeholder="Enter school location"
                  className="w-full px-3 py-2 bg-transparent border-2 border-white text-white placeholder-white placeholder-opacity-51 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2600A3] focus:border-[#2600A3] font-pingfang"
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 border-2 border-white text-white rounded-md hover:bg-white hover:text-black transition-colors font-pingfang"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitRequest}
                  className="flex-1 px-4 py-2 bg-[#2600A3] text-white rounded-md hover:bg-[#1a0080] transition-colors font-pingfang"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
