import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { schoolNameToSlug } from "../utils/schoolUtils";
import { useSchoolData } from "../contexts/SchoolDataContext";
import { submitSchoolRequest } from "../firebase/schoolService";
import { useCountdown } from "../hooks/useCountdown";

interface LeaderboardPageProps {
  isMuted: boolean;
  onToggleMute: () => void;
}

export const LeaderboardPage: React.FC<LeaderboardPageProps> = ({ isMuted, onToggleMute }) => {
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

  const [searchQuery, setSearchQuery] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [schoolLocation, setSchoolLocation] = useState("");
  const [schoolLogoUrl, setSchoolLogoUrl] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [forceUpdate, setForceUpdate] = useState(0);
  const [selectedRegion, setSelectedRegion] = useState<string>("ALL");
  
  // Countdown to December 3rd, 2025 at 3:00 PM EST
  const targetDate = useMemo(() => new Date('2025-12-03T15:00:00-05:00'), []);
  const countdown = useCountdown(targetDate);
  
  // Animated scores for top 3 schools (visual only, not stored)
  const [animatedScores, setAnimatedScores] = useState<{[key: string]: number}>({});
  
  // Random PPS (Points Per Second) values for visual effect
  const [ppsValues, setPpsValues] = useState<{[key: string]: {pps: number, multiplier: number}}>({});
  
  // Use shared school data from context (static data loaded during loading page)
  const { schools: allSchools, loading } = useSchoolData();
  const regionOptions = useMemo(() => {
    const regions = new Set<string>();
    allSchools.forEach(school => {
      const region = school.region?.trim();
      if (region) {
        regions.add(region);
      }
    });
    regions.add("UNI");
    return Array.from(regions).sort((a, b) => a.localeCompare(b));
  }, [allSchools]);

  const navigate = useNavigate();
  
  // Refs for scroll functionality
  const leaderboardContainerRef = useRef<HTMLDivElement>(null);
  const schoolRefs = useRef<{[key: string]: HTMLDivElement | null}>({});
  const hasAutoScrolledRef = useRef<boolean>(false);
  const userHasScrolledRef = useRef<boolean>(false);

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
    // Data is now provided by SchoolDataContext as static data (no live updates)

    // Check for current school in sessionStorage
    const currentSchool = sessionStorage.getItem('currentSchoolSupport');
    if (currentSchool) {
      setSelectedSchool(currentSchool);
    }

    // Clear stored school support data on page refresh
    const handleBeforeUnload = () => {
      sessionStorage.removeItem('currentSchoolSupport');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Listen for localStorage changes to update school scores
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Only trigger re-render if a school score changed
      if (e.key && e.key.startsWith('schoolScore_')) {
        console.log('📊 [LEADERBOARD] School score changed in localStorage:', e.key, e.newValue);
        setForceUpdate(prev => prev + 1);
      }
    };

    // Listen for storage events (when localStorage changes in other tabs)
    window.addEventListener('storage', handleStorageChange);

    // Also check periodically for changes within the same tab
    const interval = setInterval(() => {
      // Check if any school scores have changed in localStorage
      let hasChanges = false;
      allSchools.forEach(school => {
        const localScore = localStorage.getItem(`schoolScore_${school.schoolName}`);
        if (localScore && parseInt(localScore, 10) !== school.score) {
          hasChanges = true;
        }
      });
      
      if (hasChanges) {
        // Leaderboard update (logging removed for performance)
        setForceUpdate(prev => prev + 1);
      }
    }, 2000); // Check every 2 seconds to reduce excessive updates

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [allSchools]);

  // Animation effect for current top 3 schools (visual only)
  useEffect(() => {
    if (allSchools.length === 0) return;

    // Initialize animated scores with actual scores
    const initialScores: {[key: string]: number} = {};
    allSchools.forEach(school => {
      const localScore = getSchoolScore(school.schoolName);
      const displayScore = localScore > 0 ? localScore : school.score;
      initialScores[school.schoolName] = displayScore;
    });
    setAnimatedScores(initialScores);

    // Animation function for current top 3
    const animateCurrentTop3 = () => {
      // Get all schools with their current scores
      const allSchoolsWithScores = allSchools
        .map(school => {
          const localScore = getSchoolScore(school.schoolName);
          const currentScore = localScore > 0 ? localScore : school.score;
          return {
            schoolName: school.schoolName,
            score: currentScore,
            region: school.region
          };
        })
        .sort((a, b) => b.score - a.score);

      // Get top 3 schools based on current region selection
      let currentTop3;
      if (selectedRegion === "ALL") {
        // Global top 3
        currentTop3 = allSchoolsWithScores.slice(0, 3);
      } else if (selectedRegion === "ETC") {
        // ETC region - schools that don't match NY, CA, IL, or TOP
        const etcSchools = allSchoolsWithScores.filter(school => 
          school.region && 
          school.region !== "NY" && 
          school.region !== "CA" && 
          school.region !== "IL" && 
          school.region !== "UNI" &&
          school.region !== "TOP"
        );
        currentTop3 = etcSchools.slice(0, 3);
      } else {
        // Regional top 3
        const regionalSchools = allSchoolsWithScores.filter(school => school.region === selectedRegion);
        currentTop3 = regionalSchools.slice(0, 3);
      }

      // Clear existing intervals
      const intervals: NodeJS.Timeout[] = [];
      
      // 1st place: 1 point every 100ms (10 points per second)
      if (currentTop3[0]) {
        const interval1 = setInterval(() => {
          setAnimatedScores(prevScores => ({
            ...prevScores,
            [currentTop3[0].schoolName]: (prevScores[currentTop3[0].schoolName] || 0) + 1
          }));
        }, 100);
        intervals.push(interval1);
      }
      
      // 2nd place: 1 point every 130ms (~7.7 points per second)
      if (currentTop3[1]) {
        const interval2 = setInterval(() => {
          setAnimatedScores(prevScores => ({
            ...prevScores,
            [currentTop3[1].schoolName]: (prevScores[currentTop3[1].schoolName] || 0) + 1
          }));
        }, 130);
        intervals.push(interval2);
      }
      
      // 3rd place: 1 point every 200ms (5 points per second)
      if (currentTop3[2]) {
        const interval3 = setInterval(() => {
          setAnimatedScores(prevScores => ({
            ...prevScores,
            [currentTop3[2].schoolName]: (prevScores[currentTop3[2].schoolName] || 0) + 1
          }));
        }, 200);
        intervals.push(interval3);
      }

      return intervals;
    };

    // Start animation for current top 3
    let currentIntervals = animateCurrentTop3();

    // Update animation every 1 second to reflect current top 3
    const updateInterval = setInterval(() => {
      // Clear previous intervals
      currentIntervals.forEach(interval => clearInterval(interval));
      
      // Start new animation for current top 3
      currentIntervals = animateCurrentTop3();
    }, 1000);

    return () => {
      currentIntervals.forEach(interval => clearInterval(interval));
      clearInterval(updateInterval);
    };
  }, [allSchools, selectedRegion]);

  // PPS (Points Per Second) calculation for current top 3 schools based on actual score changes
  useEffect(() => {
    if (allSchools.length === 0) return;

    // Track previous scores to calculate PPS
    const previousScores: {[key: string]: number} = {};
    
    // Calculate PPS based on actual score changes for current top 3
    const calculatePPS = () => {
      // Get all schools with their current scores
      const allSchoolsWithScores = allSchools
        .map(school => {
          const localScore = getSchoolScore(school.schoolName);
          const currentScore = localScore > 0 ? localScore : school.score;
          return {
            schoolName: school.schoolName,
            score: currentScore,
            region: school.region
          };
        })
        .sort((a, b) => b.score - a.score);

      // Get top 3 schools based on current region selection
      let currentTop3;
      if (selectedRegion === "ALL") {
        // Global top 3
        currentTop3 = allSchoolsWithScores.slice(0, 3);
      } else if (selectedRegion === "ETC") {
        // ETC region - schools that don't match NY, CA, IL, or TOP
        const etcSchools = allSchoolsWithScores.filter(school => 
          school.region && 
          school.region !== "NY" && 
          school.region !== "CA" && 
          school.region !== "IL" && 
          school.region !== "UNI" &&
          school.region !== "TOP"
        );
        currentTop3 = etcSchools.slice(0, 3);
      } else {
        // Regional top 3
        const regionalSchools = allSchoolsWithScores.filter(school => school.region === selectedRegion);
        currentTop3 = regionalSchools.slice(0, 3);
      }

      setPpsValues(prevPps => {
        const newPps = {...prevPps};
        
        currentTop3.forEach((school, index) => {
          const currentScore = school.score;
          const previousScore = previousScores[school.schoolName] || currentScore;
          
          // Calculate PPS based on score difference over time
          const scoreDiff = currentScore - previousScore;
          const pps = Math.max(0, scoreDiff * 5); // Multiply by 5 to simulate per-second rate (increased from 2)
          
          // Update previous score
          previousScores[school.schoolName] = currentScore;
          
          // Set higher PPS ranges based on current rank for faster growth
          let minPps, maxPps;
          if (index === 0) {
            // 1st place: 30-100 PPS (increased from 10-50)
            minPps = 30;
            maxPps = 100;
          } else if (index === 1) {
            // 2nd place: 20-80 PPS (increased from 5-25)
            minPps = 20;
            maxPps = 80;
          } else {
            // 3rd place: 15-60 PPS (increased from 1-15)
            minPps = 15;
            maxPps = 60;
          }
          
          // Use calculated PPS if positive, otherwise use random within range
          newPps[school.schoolName] = {
            pps: pps > 0 ? Math.min(pps, maxPps) : Math.random() * (maxPps - minPps) + minPps,
            multiplier: Math.random() * 0.5 + 1.0 // 1.0 to 1.5 multiplier (increased for faster growth)
          };
        });
        
        return newPps;
      });
    };

    // Calculate PPS every 1 second
    const ppsInterval = setInterval(calculatePPS, 1000);
    
    // Initial calculation
    calculatePPS();

    return () => {
      clearInterval(ppsInterval);
    };
  }, [allSchools, selectedRegion]);

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
  // This will re-calculate whenever schoolScore changes (every 2 seconds)
  const leaderboardData = useMemo(() => {
    return allSchools.filter(school => school && school.schoolName).map((school) => {
      // Get local score if available, otherwise use Firebase score
      const localScore = getSchoolScore(school.schoolName);
      const baseScore = localScore > 0 ? localScore : (school.score || 0);
      
      // Use animated score for top 3 schools (visual only)
      const displayScore = animatedScores[school.schoolName] !== undefined 
        ? animatedScores[school.schoolName] 
        : baseScore;
      
      // Track when using local score (silent for performance)
      
      return {
        school: school.schoolName,
        score: displayScore, // Keep as number for sorting
        formattedScore: formatNumber(displayScore), // Formatted for display
        avatar: school.schoolLogo,
        isLocalScore: localScore > 0 && localScore !== school.score // Track if using local score
      };
    });
  }, [allSchools, animatedScores, forceUpdate]); // Re-calculate when these change

  // Sort leaderboard by actual score (including local changes) in descending order
  const sortedLeaderboardData = leaderboardData.filter(entry => entry && entry.school).sort((a, b) => b.score - a.score);

  // Update ranks based on sorted order with unique ranking (no ties) and add visual indicators for local changes
  const rankedLeaderboardData = sortedLeaderboardData.filter(entry => entry && entry.school).map((entry, index) => {
    // Calculate region-specific ranking
    let rank = index + 1; // Default to global rank
    
    if (selectedRegion !== "ALL") {
      // For specific regions, calculate rank within that region only
      const schoolsInRegion = sortedLeaderboardData.filter(regionEntry => {
        if (!regionEntry || !regionEntry.school) return false;
        const regionSchoolData = allSchools.find(school => school.schoolName === regionEntry.school);
        return regionSchoolData?.region === selectedRegion;
      });
      
      // Find this school's position within the region
      const regionIndex = schoolsInRegion.findIndex(regionEntry => regionEntry.school === entry.school);
      if (regionIndex !== -1) {
        rank = regionIndex + 1;
      }
    }
    
    return {
      ...entry,
      rank: rank, // Remove the cap - show actual ranks beyond 100
      score: entry.formattedScore, // Use formatted score for display
      isTop3: rank <= 3 // Add flag for top 3 schools
    };
  });

  // Filter leaderboard data based on search query and region
  const filteredLeaderboardData = rankedLeaderboardData.filter(entry => {
    if (!entry || !entry.school) return false;
    
    // If there's a search query, search universally across all regions
    if (searchQuery.trim()) {
      return entry.school.toLowerCase().includes(searchQuery.toLowerCase());
    }
    
    // If no search query, apply normal region filter
    if (selectedRegion === "ALL") {
      return true;
    }
    
    // Find the school in allSchools to get its region
    const schoolData = allSchools.find(school => school.schoolName === entry.school);
    
    // Handle ETC region - show schools that don't match NY, CA, IL, or TOP
    if (selectedRegion === "ETC") {
      return Boolean(schoolData && schoolData.region && 
                     schoolData.region !== "NY" && 
                     schoolData.region !== "CA" && 
                     schoolData.region !== "IL" && 
                     schoolData.region !== "UNI" &&
                     schoolData.region !== "TOP");
    }
    
    return Boolean(schoolData && schoolData.region === selectedRegion);
  });

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Handle region selection
  const handleRegionChange = (region: string) => {
    setSelectedRegion(region);
    // Don't clear search when changing regions - let universal search work
    
         // If there's a selected school, check if this region change should trigger auto-scroll
         if (selectedSchool) {
           const selectedSchoolData = allSchools.find(school => schoolNameToSlug(school.schoolName) === selectedSchool);
           const shouldAutoScroll = region === "ALL" || 
             (selectedSchoolData && (
               region === "ETC" 
                 ? (selectedSchoolData.region && 
                    selectedSchoolData.region !== "NY" && 
                    selectedSchoolData.region !== "CA" && 
                    selectedSchoolData.region !== "IL" && 
                    selectedSchoolData.region !== "UNI" &&
                    selectedSchoolData.region !== "TOP")
                 : selectedSchoolData.region === region
             ));
           
           if (shouldAutoScroll) {
             // Reset scroll flags when changing to ALL or the school's region to allow auto-scroll
             hasAutoScrolledRef.current = false;
             userHasScrolledRef.current = false;
           } else {
             // Selected school is not in this region, scroll to top instead
             setTimeout(() => {
               if (leaderboardContainerRef.current) {
                 leaderboardContainerRef.current.scrollTo({
                   top: 0,
                   behavior: 'auto'
                 });
               }
             }, 0);
           }
         } else {
           // No selected school, just reset flags for general region browsing
           hasAutoScrolledRef.current = false;
           userHasScrolledRef.current = false;
           
           // Scroll to top when no school is selected
           setTimeout(() => {
             if (leaderboardContainerRef.current) {
               leaderboardContainerRef.current.scrollTo({
                 top: 0,
                 behavior: 'auto'
               });
             }
           }, 0);
         }
  };

  // Handle request school button click
  const handleRequestSchool = () => {
    setShowRequestModal(true);
  };

  const handleSubmitRequest = async () => {
    if (schoolName.trim() && schoolLocation.trim() && userEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(userEmail.trim())) {
        alert("Please enter a valid email address.");
        return;
      }
      try {
        console.log("Submitting school request:", { 
          name: schoolName, 
          location: schoolLocation, 
          email: userEmail,
          logoUrl: schoolLogoUrl
        });
        
        // Submit to Firebase
        const requestId = await submitSchoolRequest(schoolName, schoolLocation, userEmail, schoolLogoUrl);
        
        console.log("School request submitted successfully with ID:", requestId);
        
        // Close modal and reset form
      setShowRequestModal(false);
      setSchoolName("");
      setSchoolLocation("");
      setSchoolLogoUrl("");
      setUserEmail("");
        
        alert("School is added. Refresh the page to check the school you added.");
      } catch (error) {
        console.error("Error submitting school request:", error);
        alert("Failed to submit school request. Please try again.");
      }
    } else {
      alert("Please fill in all required fields (school name, location, and email).");
    }
  };

  const handleCloseModal = () => {
    setShowRequestModal(false);
    setSchoolName("");
    setSchoolLocation("");
    setSchoolLogoUrl("");
    setUserEmail("");
  };

  // Handle school click to navigate to support page
  const handleSchoolClick = (schoolName: string) => {
    const schoolSlug = schoolNameToSlug(schoolName);
    setSelectedSchool(schoolSlug);
    navigate(`/${schoolSlug}`);
  };
  
  // Auto-scroll to selected school only once per selection, then allow free scrolling
  useEffect(() => {
    // Auto-scroll logic (logging removed for performance)
    
    // Always reset flags when selectedSchool changes to allow new scrolling
    if (selectedSchool) {
      hasAutoScrolledRef.current = false;
      userHasScrolledRef.current = false;
      console.log('Reset scroll flags for new school selection');
    }
    
    if (selectedSchool && leaderboardContainerRef.current && !hasAutoScrolledRef.current && !userHasScrolledRef.current) {
      // Use requestAnimationFrame to ensure DOM is fully ready, then setTimeout for additional safety
             const animationFrameId = requestAnimationFrame(() => {
               setTimeout(() => {
          // Check if container has proper dimensions before proceeding
          if (!leaderboardContainerRef.current || leaderboardContainerRef.current.clientHeight === 0) {
            // Container not ready, skipping scroll
            return;
          }
          
          // Container is ready, proceeding with scroll
        // Find the school name from the slug
        const selectedSchoolName = Object.keys(schoolRefs.current).find(schoolName => 
          schoolName && schoolNameToSlug(schoolName) === selectedSchool
        );
        
        // Auto-scroll debug (removed for performance)
        
        // Check if the school is actually in the filtered results
        const isSchoolInFilteredResults = filteredLeaderboardData.some(entry => 
          entry && entry.school && schoolNameToSlug(entry.school) === selectedSchool
        );
        
        console.log('School in filtered results:', isSchoolInFilteredResults);
        
        if (selectedSchoolName && schoolRefs.current[selectedSchoolName] && isSchoolInFilteredResults) {
          const schoolElement = schoolRefs.current[selectedSchoolName];
          const container = leaderboardContainerRef.current;
          
          if (schoolElement && container) {
            console.log('Container info:', {
              containerHeight: container.clientHeight,
              containerScrollHeight: container.scrollHeight,
              containerTagName: container.tagName,
              containerClassName: container.className
            });
            
            // Calculate optimal scroll position
            const containerHeight = container.clientHeight;
            const schoolTop = schoolElement.offsetTop;
            const schoolHeight = schoolElement.clientHeight;
            const currentScrollTop = container.scrollTop;
            
            // Check if school is visible in current viewport
            const isVisible = (
              schoolTop >= currentScrollTop &&
              schoolTop + schoolHeight <= currentScrollTop + containerHeight
            );
            
            console.log('Auto-scroll check for school:', selectedSchool, 'isVisible:', isVisible, 'schoolTop:', schoolTop, 'currentScrollTop:', currentScrollTop, 'containerHeight:', containerHeight);
            
            // Always scroll to ensure the selected school is positioned correctly
            console.log('Forcing scroll regardless of visibility check');
            if (true) { // Always scroll for selected school
              console.log('About to scroll to school:', selectedSchool, 'at position:', schoolTop);
              
              // Position the school near the top of the viewport (responsive for all devices)
              let scrollTop = schoolTop - (containerHeight * 0.15); // 15% of container height from top
              
              // Adjust if positioning would cut off the school
              const maxScroll = container.scrollHeight - containerHeight;
              scrollTop = Math.max(0, Math.min(scrollTop, maxScroll));
              
              // Ensure the school is at least fully visible (fallback)
              if (schoolTop < container.scrollTop) {
                scrollTop = schoolTop - 20; // Add small padding
              } else if (schoolTop + schoolHeight > container.scrollTop + containerHeight) {
                scrollTop = schoolTop + schoolHeight - containerHeight + 20; // Add small padding
              }
              
              console.log('Scrolling to position:', scrollTop, 'from current position:', currentScrollTop);
              
                      // Try multiple scroll methods to ensure it works
                      console.log('Attempting scroll with multiple methods...');
                      
                       // Method 1: Smooth scrollTo with enhanced timing
                       container.scrollTo({
                         top: Math.max(0, scrollTop),
                         behavior: 'auto'
                       });
                       
                       // Method 2: Enhanced scrollIntoView with better positioning
                       setTimeout(() => {
                         if (schoolElement) {
                           console.log('Trying enhanced scrollIntoView...');
                           schoolElement.scrollIntoView({ 
                             behavior: 'auto', 
                             block: 'center',
                             inline: 'nearest'
                           });
                         }
                       }, 50);
              
              // Verify scroll after a delay
              setTimeout(() => {
                console.log('Scroll verification - new position:', container.scrollTop, 'target was:', scrollTop);
              }, 1000);
            }
            
            // Mark as auto-scrolled to prevent further automatic scrolling
            hasAutoScrolledRef.current = true;
          }
          }
         }, 0); // Instant scrolling - no delay
      });
      
      return () => {
        cancelAnimationFrame(animationFrameId);
        // Note: scrollTimeout cleanup is handled inside the setTimeout
      };
    }
  }, [selectedSchool]); // Only when selectedSchool changes

  // Auto-scroll when region changes (for selected school)
  useEffect(() => {
    // Only auto-scroll if we have a selected school and the scroll flags were reset by handleRegionChange
    if (selectedSchool && leaderboardContainerRef.current && !hasAutoScrolledRef.current && !userHasScrolledRef.current) {
      // Use requestAnimationFrame to ensure DOM is fully ready, then setTimeout for additional safety
      const animationFrameId = requestAnimationFrame(() => {
        setTimeout(() => {
          // Check if container has proper dimensions before proceeding
          if (!leaderboardContainerRef.current || leaderboardContainerRef.current.clientHeight === 0) {
            console.log('Container not ready, skipping region scroll');
            return;
          }
          
          console.log('Container is ready, proceeding with region scroll...');
          // Find the school name from the slug
          const selectedSchoolName = Object.keys(schoolRefs.current).find(schoolName => 
            schoolName && schoolNameToSlug(schoolName) === selectedSchool
          );
          
          console.log('Region auto-scroll debug:', {
            selectedSchool,
            selectedSchoolName,
            selectedRegion,
            schoolRefsKeys: Object.keys(schoolRefs.current),
            filteredLeaderboardDataLength: filteredLeaderboardData.length
          });
          
          // Check if the school is actually in the filtered results
          const isSchoolInFilteredResults = filteredLeaderboardData.some(entry => 
            entry && entry.school && schoolNameToSlug(entry.school) === selectedSchool
          );
          
          console.log('School in filtered results for region:', isSchoolInFilteredResults);
          
          if (selectedSchoolName && schoolRefs.current[selectedSchoolName] && isSchoolInFilteredResults) {
            const schoolElement = schoolRefs.current[selectedSchoolName];
            const container = leaderboardContainerRef.current;
            
            if (schoolElement && container) {
              console.log('Container info for region scroll:', {
                containerHeight: container.clientHeight,
                containerScrollHeight: container.scrollHeight,
                containerTagName: container.tagName,
                containerClassName: container.className
              });
              
              // Calculate optimal scroll position
              const containerHeight = container.clientHeight;
              const schoolTop = schoolElement.offsetTop;
              const schoolHeight = schoolElement.clientHeight;
              const currentScrollTop = container.scrollTop;
              
              // Check if school is visible in current viewport
              const isVisible = (
                schoolTop >= currentScrollTop &&
                schoolTop + schoolHeight <= currentScrollTop + containerHeight
              );
              
              console.log('Region auto-scroll check for school:', selectedSchool, 'isVisible:', isVisible, 'schoolTop:', schoolTop, 'currentScrollTop:', currentScrollTop, 'containerHeight:', containerHeight);
              
              // Always scroll to ensure the selected school is positioned correctly
              console.log('Forcing region scroll regardless of visibility check');
              if (true) { // Always scroll for selected school
                console.log('About to region scroll to school:', selectedSchool, 'at position:', schoolTop);
                
                // Position the school near the top of the viewport (responsive for all devices)
                let scrollTop = schoolTop - (containerHeight * 0.15); // 15% of container height from top
                
                // Adjust if positioning would cut off the school
                const maxScroll = container.scrollHeight - containerHeight;
                scrollTop = Math.max(0, Math.min(scrollTop, maxScroll));
                
                // Ensure the school is at least fully visible (fallback)
                if (schoolTop < container.scrollTop) {
                  scrollTop = schoolTop - 20; // Add small padding
                } else if (schoolTop + schoolHeight > container.scrollTop + containerHeight) {
                  scrollTop = schoolTop + schoolHeight - containerHeight + 20; // Add small padding
                }
                
                console.log('Region scrolling to position:', scrollTop, 'from current position:', currentScrollTop);
                console.log('Attempting region scroll with multiple methods...');
                
                 // Method 1: Smooth scrollTo with enhanced timing
                 container.scrollTo({
                   top: Math.max(0, scrollTop),
                   behavior: 'auto'
                 });
                 
                 // Method 2: Enhanced scrollIntoView with better positioning
                 setTimeout(() => {
                   if (schoolElement) {
                     console.log('Trying enhanced scrollIntoView for region...');
                     schoolElement.scrollIntoView({ 
                             behavior: 'auto',
                       block: 'center',
                       inline: 'nearest'
                     });
                   }
                 }, 50);
                
                // Verify scroll after a delay
                setTimeout(() => {
                  console.log('Region scroll verification - new position:', container.scrollTop, 'target was:', scrollTop);
                }, 1000);
              }
              
              // Mark as auto-scrolled to prevent further automatic scrolling
              hasAutoScrolledRef.current = true;
            }
          }
         }, 0); // Instant scrolling - no delay
      });
      
      return () => {
        cancelAnimationFrame(animationFrameId);
        // Note: scrollTimeout cleanup is handled inside the setTimeout
      };
    }
  }, [selectedRegion, filteredLeaderboardData]); // When region or filtered data changes
  
  
  // Add scroll event listener to detect user scrolling
  useEffect(() => {
    const container = leaderboardContainerRef.current;
    if (container) {
      const handleUserScroll = () => {
        // Mark that user has manually scrolled
        userHasScrolledRef.current = true;
      };
      
      container.addEventListener('scroll', handleUserScroll, { passive: true });
      
      return () => {
        container.removeEventListener('scroll', handleUserScroll);
      };
    }
  }, []);
  
  // Check for pre-selected school from session storage or URL on component mount
  useEffect(() => {
    const lastSchoolSupport = sessionStorage.getItem('currentSchoolSupport');
    if (lastSchoolSupport && !selectedSchool) {
      // Reset both flags for initial positioning
      hasAutoScrolledRef.current = false;
      userHasScrolledRef.current = false;
      setSelectedSchool(lastSchoolSupport);
    }
  }, []); // Remove selectedSchool dependency to avoid circular dependency

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
      <div className="bg-black w-screen h-screen-dvh flex items-center justify-center">
        <div className="text-white text-xl">Loading schools...</div>
      </div>
    );
  }

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
                <path d="M10.23 1.75c-2.92-.91-6.24.29-8.33 3.32C.29 7.37.29 9.9 1.75 12.23l1.33-1.33c-.91-1.49-.91-3.61.29-5.1 1.2-1.49 3.32-2.12 5.1-1.21l1.76-2.84z"/>
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
      className="bg-black w-screen h-screen-dvh flex flex-col overflow-hidden select-none"
      style={{
        // iPad-specific: Prevent viewport height shifts during navigation
        position: isIPad ? 'fixed' : undefined,
        top: isIPad ? '0' : undefined,
        left: isIPad ? '0' : undefined,
        right: isIPad ? '0' : undefined,
        bottom: isIPad ? '0' : undefined
      }}
    >
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
              onClick={() => {
                // Clear selected school from storage when logo is clicked
                sessionStorage.removeItem('currentSchoolSupport');
                navigate('/');
              }}
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

      {/* Main Content Area */}
      <div 
        className="flex-1 bg-black flex flex-col items-center justify-start relative overflow-hidden overflow-x-hidden px-4 main-content-area"
        style={{
          paddingTop: isIPad ? 'calc(10vh + 20px)' : '16px',
          paddingBottom: isIPad ? 'calc(12vh + 20px)' : '32px',
          // iPad-specific: Ensure content stays in place during navigation
          position: isIPad ? 'relative' : undefined,
          top: isIPad ? '0' : undefined
        }}
      >
        {/* Leaderboard Title */}
        <div className="font-pixelify font-normal text-[#ffe100] text-4xl md:text-5xl lg:text-6xl xl:text-7xl text-center tracking-[0] leading-[normal] mb-2">
          Leaderboard
        </div>


        {/* Schools Competing Counter */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
            <div className="w-1 h-1 bg-blue-300 rounded-full animate-ping delay-500"></div>
          </div>
          <span className="font-pixelify font-normal text-blue-400 text-sm md:text-base tracking-[0] leading-[normal]">
            Join {allSchools.length} schools competing
          </span>
        </div>

        {/* Countdown Timer */}
        {!countdown.isExpired && (
          <div className="flex justify-center mb-2 px-2">
            <div className="bg-gradient-to-r from-purple-600/20 to-blue-600/20 backdrop-blur-sm border border-purple-500 rounded py-1 px-3">
              <div className="flex items-center gap-1 md:gap-1.5">
                <div className="flex items-baseline gap-0.5">
                  <span className="font-pixelify font-bold text-base md:text-xl text-white">{countdown.days}</span>
                  <span className="font-pixelify text-[10px] md:text-xs text-purple-300">d</span>
                </div>
                <span className="text-purple-400 text-sm">:</span>
                <div className="flex items-baseline gap-0.5">
                  <span className="font-pixelify font-bold text-base md:text-xl text-white">{countdown.hours}</span>
                  <span className="font-pixelify text-[10px] md:text-xs text-purple-300">h</span>
                </div>
                <span className="text-purple-400 text-sm">:</span>
                <div className="flex items-baseline gap-0.5">
                  <span className="font-pixelify font-bold text-base md:text-xl text-white">{countdown.minutes}</span>
                  <span className="font-pixelify text-[10px] md:text-xs text-purple-300">m</span>
                </div>
                <span className="text-purple-400 text-sm">:</span>
                <div className="flex items-baseline gap-0.5">
                  <span className="font-pixelify font-bold text-base md:text-xl text-white">{countdown.seconds}</span>
                  <span className="font-pixelify text-[10px] md:text-xs text-purple-300">s</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Leaderboard Content */}
        <div className="w-full max-w-4xl border-[3px] border-solid border-white bg-black flex-1 flex flex-col min-h-0">
          {/* Search Bar */}
          <div className="w-full p-3 border-b border-solid border-white/30 flex items-center opacity-80">
            <img
              className="w-4 h-4 ml-1 opacity-60"
              alt="Search"
              src="/icons/search.svg"
              draggable={false}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search school to support/attack"
              className="ml-2 bg-transparent border-none outline-none font-pingfang font-normal text-white text-sm md:text-base tracking-[0] leading-[normal] placeholder-white placeholder-opacity-40 flex-1"
            />
          </div>

         {/* Region Tabs */}
         <div className="w-full border-b-2 border-solid border-white overflow-x-auto md:overflow-visible">
           <div className="flex items-center gap-2 px-2 py-2 min-w-max md:min-w-0 md:flex-wrap md:justify-center">
            {["ALL", "UNI", "NY", "CA", "IL", "TOP", "ETC"].map((region) => {
               // Check if this region should trigger auto-scroll for selected school
               const selectedSchoolData = selectedSchool ? 
                 allSchools.find(school => schoolNameToSlug(school.schoolName) === selectedSchool) : null;
               const shouldTriggerAutoScroll = selectedSchool && (
                 region === "ALL" || 
                 (selectedSchoolData && (
               region === "ETC" 
                 ? (selectedSchoolData.region && 
                    selectedSchoolData.region !== "NY" && 
                    selectedSchoolData.region !== "CA" && 
                    selectedSchoolData.region !== "IL" && 
                    selectedSchoolData.region !== "UNI" &&
                    selectedSchoolData.region !== "TOP")
                     : selectedSchoolData.region === region
                 ))
               );
               
               
               return (
                 <button
                   key={region}
                   onClick={() => handleRegionChange(region)}
                   className={`px-3 py-2 font-pixelify text-sm md:text-base transition-all duration-200 ${
                     selectedRegion === region
                       ? 'bg-white text-black border-2 border-white'
                       : shouldTriggerAutoScroll
                       ? 'bg-transparent text-green-400 border-2 border-green-400 hover:border-green-300 hover:bg-green-900'
                       : 'bg-transparent text-white border-2 border-gray-600 hover:border-gray-400 hover:bg-gray-800'
                   }`}
                   title={shouldTriggerAutoScroll ? `Click to scroll to ${selectedSchool}` : undefined}
                 >
                   {region}
                   {shouldTriggerAutoScroll && <span className="ml-1 text-xs">📍</span>}
                 </button>
               );
             })}
           </div>
           </div>

          {/* Leaderboard Entries */}
           <div 
             ref={leaderboardContainerRef} 
             className="flex-1 overflow-y-auto overflow-x-hidden" 
             style={{ 
               scrollBehavior: 'auto',
               scrollbarWidth: 'thin',
               scrollbarColor: 'rgba(255, 255, 255, 0.3) transparent'
             }}
           >
            {filteredLeaderboardData.map((entry) => (
              <div 
                key={entry.school}
                ref={(el) => {
                  if (el) {
                    schoolRefs.current[entry.school] = el;
                  }
                }}
                className={`group flex items-center p-2 md:p-3 cursor-pointer transition-all duration-300 ease-in-out border-b border-gray-600 ${
                  isSchoolSelected(entry.school) 
                    ? 'bg-[#2600A3] border-2 border-white shadow-lg shadow-blue-500/20' 
                    : 'hover:bg-white hover:bg-opacity-10 hover:shadow-md'
                }`}
                onClick={() => handleSchoolClick(entry.school)}
              >
                {/* Rank */}
                <div className={`w-12 md:w-16 font-pixelify font-normal text-white tracking-[0] leading-[normal] whitespace-nowrap text-lg md:text-2xl lg:text-3xl ${isSchoolSelected(entry.school) ? 'opacity-100' : 'opacity-100'}`}>
                  #{entry.rank}
                </div>

                {/* School Name and Score */}
                <div className="flex-1 ml-2 md:ml-4">
                  <div className={`font-pixelify font-normal text-white text-xs md:text-sm lg:text-base tracking-[0] leading-[normal] ${isSchoolSelected(entry.school) ? 'opacity-100' : 'opacity-100'}`}>
                    {entry.school}
                  </div>
                  <div className={`font-pixelify font-normal text-[#ffe100] text-xs md:text-sm lg:text-base tracking-[0] leading-[normal] ${isSchoolSelected(entry.school) ? 'opacity-100' : 'opacity-100'}`}>
                    {entry.score}
                    {/* PPS Display for top 3 schools */}
                    {entry.isTop3 && ppsValues[entry.school] && (
                      <span className="ml-1 md:ml-2 font-pixelify font-bold text-green-400 text-xs opacity-100">
                        {ppsValues[entry.school].pps.toFixed(1)} PPS
                      </span>
                    )}
                  </div>
                </div>

                {/* Avatar */}
                <div className={`w-8 h-6 md:w-12 md:h-8 lg:w-16 lg:h-10 bg-[#2600A3] rounded-lg flex items-center justify-center ${selectedSchool ? '' : 'animate-bounce-button'} ${isSchoolSelected(entry.school) ? 'opacity-100' : selectedSchool ? 'opacity-50 group-hover:opacity-100' : 'opacity-100'}`}>
                  <img
                    className="w-4 h-4 md:w-5 md:h-5 lg:w-6 lg:h-6"
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
            className="w-full p-2 md:p-4 bg-[#2600A3] flex items-center justify-center gap-2 font-pingfang font-normal text-white text-xs md:text-sm lg:text-base tracking-[0] leading-[normal] hover:bg-[#1a0080] transition-colors"
          >
            <svg
              className="w-3 h-3 md:w-4 md:h-4 lg:w-5 lg:h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Add school</span>
          </button>
        </div>

        {/* Request School Modal */}
        {showRequestModal && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[100] overflow-y-auto">
            <div className="bg-black border-2 border-white rounded-lg p-6 w-[400px] max-w-[90vw] my-8">
              <h2 className="text-2xl font-pixelify font-normal text-white mb-6 text-center">Add School</h2>
              
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

              <div className="mb-4">
                <label className="block text-sm font-pingfang font-normal text-white mb-2">
                  School Logo
                </label>
                <input
                  type="url"
                  value={schoolLogoUrl}
                  onChange={(e) => setSchoolLogoUrl(e.target.value)}
                  placeholder="Copy and paste the link of the logo image"
                  className="w-full px-3 py-2 bg-transparent border-2 border-white text-white placeholder-white placeholder-opacity-60 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2600A3] focus:border-[#2600A3] font-pingfang"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-pingfang font-normal text-white mb-2">
                  School Region
                </label>
                <div className="relative">
                  <select
                    value={schoolLocation}
                    onChange={(e) => setSchoolLocation(e.target.value)}
                    className="w-full px-3 py-2 bg-black border-2 border-white text-white rounded-md focus:outline-none focus:ring-2 focus:ring-[#2600A3] focus:border-[#2600A3] font-pingfang appearance-none"
                  >
                    <option value="" disabled>Select a region</option>
                    {regionOptions.map((region) => (
                      <option key={region} value={region}>
                        {region}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-white/70">
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 10.879l3.71-3.648a.75.75 0 011.04 1.08l-4.24 4.17a.75.75 0 01-1.04 0l-4.24-4.17a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                {regionOptions.length === 0 && (
                  <p className="mt-2 text-xs text-white/60 font-pingfang">
                    No regions available yet. Please check back soon.
                  </p>
                )}
              </div>

              <div className="mb-4">
                <label className="block text-sm font-pingfang font-normal text-white mb-2">
                  Your Email
                </label>
                <input
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="Enter your email"
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
        {/* Left Section - Main Game */}
        <div 
          className="w-1/2 h-full bg-[#d5d5d5] flex items-center justify-center cursor-pointer hover:bg-gray-400 transition-colors"
          onClick={handleMainGameClick}
        >
          <img src="/icons/hand.svg" alt="Main Game" className="w-8 h-8 md:w-11 md:h-11" draggable={false} />
        </div>

        {/* Divider Line */}
        <div className="w-px h-full bg-gray-300"></div>

        {/* Right Section - Leaderboard (Active) */}
        <div className="w-1/2 h-full bg-white flex items-center justify-center">
          <img src="/icons/leaderboard.svg" alt="Leaderboard" className="w-12 h-12 md:w-[60px] md:h-[60px]" draggable={false} />
        </div>
      </div>

    </div>
  );
};
