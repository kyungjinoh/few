import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useCountdown } from "../hooks/useCountdown";
import { useParams, useNavigate } from "react-router-dom";
import { slugToSchoolName, findSchoolBySlug, schoolNameToSlug } from "../utils/schoolUtils";
import { updateSchoolScoreByName, School, submitShareProof, getShareCountsBySchool, ShareLeaderboardEntry } from "../firebase/schoolService";
import { useSchoolData } from "../contexts/SchoolDataContext";
import { useOnlinePresence } from "../hooks/useOnlinePresence";
import { ref, push, onValue, off, serverTimestamp, query, orderByChild, limitToLast, get, remove } from "firebase/database";
import { realtimeDb } from "../firebase/config";

interface SchoolSupportPageProps {
  isMuted: boolean;
  onToggleMute: () => void;
}

interface ChatMessage {
  id: string;
  text: string;
  timestamp: number;
  username: string;
  schoolName: string;
}

export const SchoolSupportPage: React.FC<SchoolSupportPageProps> = ({ isMuted, onToggleMute }) => {
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

  const { schoolName } = useParams<{ schoolName: string }>();
  const navigate = useNavigate();
  const { schools: firebaseSchools } = useSchoolData();
  const { totalOnline, isLoading: isOnlineLoading } = useOnlinePresence(schoolName || '');
  const [schoolDisplayName, setSchoolDisplayName] = useState("");
  
  
  const [score, setScore] = useState(() => {
    const savedScore = localStorage.getItem('individualScore');
    return savedScore ? parseInt(savedScore, 10) : 0;
  }); // Individual score - saved to local storage for persistence
  const [isMysteryBoxOpen, setIsMysteryBoxOpen] = useState(false);
  const [isSubmitProofOpen, setIsSubmitProofOpen] = useState(false);
  const [selectedProofSchool, setSelectedProofSchool] = useState<string>("");
  const [selectedShareMethod, setSelectedShareMethod] = useState<"Story" | "DM" | "ETC">("Story");
  const [sharedSchoolStudent, setSharedSchoolStudent] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [isSubmittingProof, setIsSubmittingProof] = useState(false);
  const [proofSubmissionError, setProofSubmissionError] = useState<string | null>(null);
  const [proofSubmissionMessage, setProofSubmissionMessage] = useState<string | null>(null);
  const [isShareLeaderboardOpen, setIsShareLeaderboardOpen] = useState(false);
  const [shareLeaderboard, setShareLeaderboard] = useState<ShareLeaderboardEntry[]>([]);
  const [shareLeaderboardError, setShareLeaderboardError] = useState<string | null>(null);
  const [isShareLeaderboardLoading, setIsShareLeaderboardLoading] = useState(false);

  const schoolOptions = useMemo(() => {
    return firebaseSchools
      .filter((school): school is School => Boolean(school && school.schoolName))
      .map((school) => school.schoolName)
      .filter((name, index, array) => array.indexOf(name) === index)
      .sort((a, b) => a.localeCompare(b));
  }, [firebaseSchools]);

  useEffect(() => {
    if (!selectedProofSchool && schoolOptions.length > 0) {
      setSelectedProofSchool(schoolOptions[0] ?? "");
    }
  }, [selectedProofSchool, schoolOptions]);

  useEffect(() => {
    if (selectedShareMethod === "Story") {
      setSharedSchoolStudent("");
    }
  }, [selectedShareMethod]);

  const fetchShareLeaderboard = useCallback(async () => {
    setIsShareLeaderboardLoading(true);
    setShareLeaderboardError(null);
    try {
      const entries = await getShareCountsBySchool();
      setShareLeaderboard(entries);
    } catch (error) {
      console.error('Error loading share leaderboard:', error);
      setShareLeaderboardError(
        error instanceof Error ? error.message : 'Failed to load share leaderboard.'
      );
    } finally {
      setIsShareLeaderboardLoading(false);
    }
  }, []);

  const resetProofForm = useCallback(() => {
    setIsSubmitProofOpen(false);
    setIsSubmittingProof(false);
    setProofSubmissionError(null);
    setSelectedShareMethod("Story");
    setSharedSchoolStudent("");
    setProofFile(null);
    if (schoolOptions.length > 0) {
      setSelectedProofSchool(schoolOptions[0] ?? "");
    } else {
      setSelectedProofSchool("");
    }
  }, [schoolOptions]);

  // Calculate current rank for a school based on locally stored data
  // const calculateCurrentRank = (schoolName: string, currentScore: number): number => {
  //   // Use locally stored values for all schools, with Firebase fallback
  //   const schoolsWithScores = firebaseSchools.map(school => ({
  //     name: school.schoolName,
  //     score: school.schoolName === schoolName ? currentScore : getSchoolScore(school.schoolName)
  //   }));

  //   // Sort by score descending
  //   schoolsWithScores.sort((a, b) => b.score - a.score);

  //   // Find the rank of the current school
  //   const schoolIndex = schoolsWithScores.findIndex(school => school.name === schoolName);
  //   return schoolIndex + 1; // Rank is 1-based
  // };


  // Calculate score difference to reach target rank
  const calculateScoreDifference = (schoolName: string, currentScore: number, targetRank: number): number => {
    // Force recalculation by using rankUpdateTrigger
    void rankUpdateTrigger;
    
    // Use locally stored values for all schools, ensuring consistency
    const schoolsWithScores = firebaseSchools.filter(school => school && school.schoolName).map(school => {
      const schoolNameForComparison = school.schoolName;
      
      // For the current school, use the provided currentScore
      if (schoolNameForComparison.toLowerCase() === schoolName.toLowerCase()) {
        return {
          name: schoolNameForComparison,
          score: currentScore
        };
      }
      
      // For other schools, get from localStorage first, then Firebase
      const localScore = localStorage.getItem(`schoolScore_${schoolNameForComparison}`);
      if (localScore) {
        return {
          name: schoolNameForComparison,
          score: parseInt(localScore, 10)
        };
      }
      
      // Fallback to Firebase score and save to localStorage for consistency
      const firebaseScore = school.score;
      localStorage.setItem(`schoolScore_${schoolNameForComparison}`, firebaseScore.toString());
      return {
        name: schoolNameForComparison,
        score: firebaseScore
      };
    });

    // Sort by score descending
    schoolsWithScores.sort((a, b) => b.score - a.score);

    // Calculate current rank dynamically with proper tie handling
    const schoolIndex = schoolsWithScores.findIndex(school => 
      school.name.toLowerCase() === schoolName.toLowerCase()
    );
    
    if (schoolIndex === -1) return 0;
    
    // Calculate unique rank (no ties allowed)
    // Since schools are sorted by score descending, the index + 1 gives us the unique rank
    const currentRank = schoolIndex + 1; // Rank is 1-based, no cap to show actual position

    // If target rank is invalid or same as current rank, return 0
    if (targetRank < 1 || targetRank > schoolsWithScores.length || targetRank === currentRank) {
      return 0;
    }

    // Find the target school at the target rank
    const targetSchool = schoolsWithScores[targetRank - 1];
    if (!targetSchool) return 0;

    // Calculate difference needed to reach target rank
    if (targetRank < currentRank) {
      // Trying to go up in rank (blue theme) - need more points than the school at target rank
      return Math.max(0, targetSchool.score - currentScore + 1);
    } else {
      // Trying to go down in rank (red theme) - need fewer points than the school at target rank
      // For going down, we need to be just below the target school's score
      return Math.max(0, currentScore - targetSchool.score + 1);
    }
  };


  // iOS detection
  const isIOS = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const audioBuffer = useRef<AudioBuffer | null>(null);
  const lastSoundTime = useRef(0);
  const soundQueue = useRef(0);
  const maxSoundQueue = useRef(3);
  
  // iOS performance optimizations
  // const scoreUpdateQueue = useRef(0);
  // const animationFrameId = useRef<number | null>(null);
  // const pendingScoreUpdate = useRef(false);

  // Initialize iOS detection and Web Audio API
  useEffect(() => {
    const userAgent = navigator.userAgent;
    // Improved iOS detection including modern iPads
    isIOS.current = (/iPad|iPhone|iPod/.test(userAgent) || 
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && 
                    !(window as any).MSStream;
    
    if (isIOS.current) {
      // Initialize Web Audio API for iOS
      try {
        audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Preload audio buffer
        fetch('/icons/popcat.mp3')
          .then(response => response.arrayBuffer())
          .then(data => audioContext.current?.decodeAudioData(data))
          .then(buffer => {
            audioBuffer.current = buffer || null;
          })
          .catch(error => {
            console.log('Audio preload failed:', error);
          });
      } catch (error) {
        console.log('Web Audio API initialization failed:', error);
      }
    }

    // Stop all audio immediately when browser is exited (mobile/tablet)
    const stopAllAudioImmediately = () => {
      console.log('🔊 [CLICK SOUNDS] Stopping immediately due to browser exit');
      
      // Stop Web Audio context
      if (audioContext.current) {
        audioContext.current.suspend();
      }
      
      // Stop any playing HTML audio elements
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach(audio => {
        audio.pause();
        audio.currentTime = 0;
      });
    };

    // Listen for browser exit events
    const handleBeforeUnload = () => {
      stopAllAudioImmediately();
    };

    const handlePageHide = () => {
      stopAllAudioImmediately();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopAllAudioImmediately();
      }
    };

    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Cleanup animation frame on unmount (currently disabled)
  // useEffect(() => {
  //   return () => {
  //     if (animationFrameId.current) {
  //       cancelAnimationFrame(animationFrameId.current);
  //     }
  //   };
  // }, []);

  // Batched score update for iOS performance (currently disabled for testing)
  // const processBatchedScoreUpdate = useCallback(() => {
  //   console.log(`📊 [DEBUG] Processing batched score update - queue: ${scoreUpdateQueue.current}`);
  //   
  //   if (scoreUpdateQueue.current > 0) {
  //     const multiplier = Math.min(scoreUpdateQueue.current, 10); // Cap at 10x multiplier
  //     console.log(`📊 [DEBUG] Adding ${multiplier} points to score`);
  //     
  //     // Reset queue and pending flag BEFORE processing to prevent double processing
  //     const currentQueue = scoreUpdateQueue.current;
  //     scoreUpdateQueue.current = 0;
  //     pendingScoreUpdate.current = false;
  //     
  //     setScore(prev => {
  //       const newScore = prev + currentQueue; // Use the captured value
  //       saveIndividualScore(newScore);
  //       
  //       // Check for milestone achievements
  //       checkMilestoneAchievement(newScore);
  //       
  //       return newScore;
  //     });
  //   }
  //   animationFrameId.current = null;
  // }, []);

  // Play popcat sound effect with iOS optimizations
  const playPopcatSound = () => {
    const now = Date.now();
    if (now - lastSoundTime.current < 50) { // 50ms throttle for sound
      return;
    }
    lastSoundTime.current = now;

    if (isIOS.current && audioContext.current && audioBuffer.current) {
      // Resume Web Audio context if suspended (required after user interaction)
      if (audioContext.current.state === 'suspended') {
        audioContext.current.resume();
      }
      
      // Use Web Audio API for iOS
      if (soundQueue.current < maxSoundQueue.current) {
        soundQueue.current++;
        const source = audioContext.current.createBufferSource();
        source.buffer = audioBuffer.current;
        source.connect(audioContext.current.destination);
        source.start(0);
        
        // Reset queue after sound duration
        setTimeout(() => {
          soundQueue.current = Math.max(0, soundQueue.current - 1);
        }, 200);
      }
    } else {
      // Fallback for non-iOS or if Web Audio fails
      try {
        const audio = new Audio('/icons/popcat.mp3');
        audio.volume = 0.3;
        audio.play().catch(error => {
          console.log('Audio play failed:', error);
        });
      } catch (error) {
        console.log('Audio creation failed:', error);
      }
    }
  };

  // Create floating number effect
  const createFloatingNumber = (value: number, event: React.MouseEvent) => {
    const id = Date.now() + Math.random();
    
    // Get mouse position relative to the school logo container
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    
    setFloatingNumbers(prev => [...prev, { id, value, x, y }]);
    
    // Remove the floating number after animation
    setTimeout(() => {
      setFloatingNumbers(prev => prev.filter(num => num.id !== id));
    }, 1000);
  };
  
  // Calculate multiplier based on score (capped to prevent overflow)
  const calculateMultiplier = (currentScore: number) => {
    if (currentScore < 10) return 1;
    if (currentScore < 100) return 2;
    return 4;
  };

  const multiplier = calculateMultiplier(score);
  
  // Calculate next goal milestone
  const getNextGoal = (currentScore: number): { target: number; multiplier: number } => {
    if (currentScore < 10) return { target: 10, multiplier: 2 };
    if (currentScore < 100) return { target: 100, multiplier: 4 };
    return { target: currentScore, multiplier: 4 };
  };
  
  const nextGoal = getNextGoal(score);
  const showNextGoal = score < 100;
  

  // Helper function to save individual score to localStorage
  const saveIndividualScore = (score: number): void => {
    localStorage.setItem('individualScore', score.toString());
  };

  // Helper function to clear school logo cache (for admin updates)
  // const _clearSchoolLogoCache = (schoolName: string): void => {
  //   const cacheKey = `schoolLogo_${schoolName.toLowerCase().replace(/\s+/g, '_')}`;
  //   localStorage.removeItem(cacheKey);
  //   console.log('🗑️ [SCHOOL LOGO] Cleared cache for:', schoolName);
  // };

  // Note: schoolScore is now managed locally for immediate UI updates
  // and synced with Firebase on page refresh/exit
  const [schoolScore, setSchoolScore] = useState(0); // Local score for immediate UI updates
  
  // Use shared school data from context
  const [isCopied, setIsCopied] = useState(false);
  const [challengeTextIndex, setChallengeTextIndex] = useState(0);
  const [rotatingTextIndex, setRotatingTextIndex] = useState(0);
  const [, setScoreChanges] = useState(0); // Track total score changes made during session
  const scoreChangesRef = useRef(0); // Ref to track score changes for cleanup function
  const [showChatTab, setShowChatTab] = useState(false); // Chat tab state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [chatPosition, setChatPosition] = useState({ x: -1, y: -1 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState('');
  const [chatSize, setChatSize] = useState({ width: -1, height: -1 });
  const [isMobile, setIsMobile] = useState(false); // Mobile detection
  const [isTablet, setIsTablet] = useState(false); // Tablet detection
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [anonymousUsername, setAnonymousUsername] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [newMessageNotification, setNewMessageNotification] = useState<{text: string, username: string} | null>(null);
  const [lastMessageCount, setLastMessageCount] = useState(0);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [hasOpenedChatOnce, setHasOpenedChatOnce] = useState(false);
  const [, setHasUnsavedChanges] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Mobile and tablet detection
  useEffect(() => {
    const checkDevice = () => {
      setIsMobile(window.innerWidth < 640); // Tailwind's 'sm' breakpoint
      setIsTablet(window.innerWidth >= 640 && window.innerWidth < 1024); // Tablet range
    };
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  // Load saved position and size on component mount
  useEffect(() => {
    const savedPosition = localStorage.getItem('chatPosition');
    const savedSize = localStorage.getItem('chatSize');
    
    if (savedPosition && savedSize) {
      try {
        const parsedPosition = JSON.parse(savedPosition);
        const parsedSize = JSON.parse(savedSize);
        
        console.log('Loading saved position on mount:', parsedPosition);
        console.log('Loading saved size on mount:', parsedSize);
        
        // Validate that the saved position is still within screen bounds
        const maxX = window.innerWidth - parsedSize.width;
        const maxY = window.innerHeight - parsedSize.height;
        
        if (parsedPosition.x >= 0 && parsedPosition.x <= maxX && 
            parsedPosition.y >= 0 && parsedPosition.y <= maxY) {
          setChatPosition(parsedPosition);
          setChatSize(parsedSize);
          return;
        }
      } catch (error) {
        console.log('Failed to parse saved chat position/size on mount:', error);
      }
    }
  }, []); // Only run on mount

  // Set initial chat position and size when tab opens (only if no saved data)
  useEffect(() => {
    if (showChatTab && chatPosition.x === -1 && chatPosition.y === -1) {
      console.log('Setting default position for first time');
      
      if (isMobile) {
        // Position at top for mobile
        setChatPosition({
          x: 16, // 16px padding from left
          y: 16 // 16px padding from top
        });
        setChatSize({
          width: window.innerWidth * 0.9, // 90% of screen width
          height: 200 // Fixed height for mobile
        });
      } else if (isTablet) {
        // Position at right side for tablet (smaller and more to the right)
        setChatPosition({
          x: window.innerWidth - 280 - 4, // 280px width + 4px padding from right
          y: 180 // 180px padding from top
        });
        setChatSize({
          width: 280,
          height: 350
        });
      } else {
        // Position at right side for desktop (more to the left and down)
        setChatPosition({
          x: window.innerWidth - 320 - 180, // 320px width + 180px padding from right
          y: 180 // 180px padding from top
        });
        setChatSize({
          width: 320,
          height: 400
        });
      }
    }
  }, [showChatTab, isMobile, isTablet, chatPosition.x, chatPosition.y]);

  // Update position and size when device type changes (only if no saved data)
  useEffect(() => {
    if (showChatTab && chatPosition.x === -1 && chatPosition.y === -1) {
      if (isMobile) {
        setChatPosition({
          x: 16,
          y: 16
        });
        setChatSize({
          width: window.innerWidth * 0.9,
          height: 200
        });
      } else if (isTablet) {
        setChatPosition({
          x: window.innerWidth - 280 - 4,
          y: 180
        });
        setChatSize({
          width: 280,
          height: 350
        });
      } else {
        setChatPosition({
          x: window.innerWidth - 320 - 180,
          y: 180
        });
        setChatSize({
          width: 320,
          height: 400
        });
      }
    }
  }, [isMobile, isTablet, showChatTab, chatPosition.x, chatPosition.y]);

  // Generate anonymous username
  useEffect(() => {
    if (!anonymousUsername) {
      const adjectives = ['Toxic', 'Rage', 'Grief', 'Sweat', 'Lag', 'Smurf', 'OP', 'Noob', 'AFK', 'Vape'];
      const nouns = ['Bot', 'Flame', 'Grind', 'Quest', 'Crit', 'Spawn', 'Hack', 'Shark', 'Fame', 'Clutch'];
      const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
      const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
      const randomNum = Math.floor(Math.random() * 999) + 1;
      setAnonymousUsername(`${randomAdj}${randomNoun}${randomNum}`);
    }
  }, [anonymousUsername]);

  // Function to clean up expired messages
  const cleanupExpiredMessages = async (schoolSlug: string) => {
    if (!realtimeDb) return;
    
    try {
      const chatRef = ref(realtimeDb, `schoolChats/${schoolSlug}`);
      const snapshot = await get(chatRef);
      
      if (snapshot.exists()) {
        const messagesData = snapshot.val();
        const now = Date.now();
        let hasExpiredMessages = false;
        
        // Check for expired messages and remove them
        for (const [messageId, messageData] of Object.entries(messagesData)) {
          const message = messageData as any;
          if (message.expiresAt && message.expiresAt <= now) {
            await remove(ref(realtimeDb, `schoolChats/${schoolSlug}/${messageId}`));
            hasExpiredMessages = true;
          }
        }
        
        if (hasExpiredMessages) {
          console.log('🧹 Cleaned up expired messages for', schoolSlug);
        }
      }
    } catch (error) {
      console.error('Error cleaning up expired messages:', error);
    }
  };

  // Load chat messages from Firebase
  useEffect(() => {
    if (showChatTab && schoolDisplayName) {
      const sanitizedSchoolName = sanitizeSchoolName(schoolDisplayName);
      
      // Clean up expired messages first
      cleanupExpiredMessages(sanitizedSchoolName);
      
      const chatRef = ref(realtimeDb, `schoolChats/${sanitizedSchoolName}`);
      const messagesQuery = query(chatRef, orderByChild('timestamp'), limitToLast(50));
      
      const unsubscribe = onValue(messagesQuery, (snapshot) => {
        const messagesData = snapshot.val();
        if (messagesData) {
          const now = Date.now();
          const messagesList = Object.entries(messagesData)
            .filter(([, message]: [string, any]) => {
              // Only show messages that haven't expired
              return !message.expiresAt || message.expiresAt > now;
            })
            .map(([id, message]: [string, any]) => ({
              id,
              text: message.text,
              timestamp: message.timestamp,
              username: message.username,
              schoolName: message.schoolName
            }));
          setMessages(messagesList);
        } else {
          setMessages([]);
        }
      });

      return () => off(chatRef, 'value', unsubscribe);
    }
  }, [showChatTab, schoolDisplayName]);

  // Periodic cleanup of expired messages (runs every 5 minutes)
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      if (schoolDisplayName && showChatTab) {
        const sanitizedSchoolName = sanitizeSchoolName(schoolDisplayName);
        cleanupExpiredMessages(sanitizedSchoolName);
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(cleanupInterval);
  }, [schoolDisplayName, showChatTab]);

  // Note: Message deletion is now handled by client-side expiration
  // Messages are automatically deleted after 24 hours when users visit the chat

  // Sanitize school name for Firebase path
  const sanitizeSchoolName = (schoolName: string) => {
    return schoolName
      .replace(/[.#$[\]]/g, '') // Remove invalid Firebase characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/[^\w\-_]/g, '') // Keep only word characters, hyphens, and underscores
      .toLowerCase(); // Convert to lowercase for consistency
  };

  // Send message function
  const sendMessage = async () => {
    if (!newMessage.trim() || isSending || !schoolDisplayName) return;

    console.log('🚀 [CHAT DEBUG] Attempting to send message:', {
      message: newMessage.trim(),
      schoolName: schoolDisplayName,
      username: anonymousUsername,
      realtimeDb: !!realtimeDb
    });

    setIsSending(true);
    try {
      const sanitizedSchoolName = sanitizeSchoolName(schoolDisplayName);
      const chatRef = ref(realtimeDb, `schoolChats/${sanitizedSchoolName}`);
      
      console.log('📡 [CHAT DEBUG] Firebase reference created:', {
        path: `schoolChats/${sanitizedSchoolName}`,
        sanitizedSchoolName
      });

      const messageData = {
        text: newMessage.trim(),
        timestamp: serverTimestamp(),
        username: anonymousUsername,
        schoolName: schoolDisplayName,
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours from now
      };

      console.log('💾 [CHAT DEBUG] Message data to be sent:', messageData);

      const result = await push(chatRef, messageData);
      
      console.log('✅ [CHAT DEBUG] Message sent successfully:', {
        messageId: result.key,
        path: result.toString()
      });

      setNewMessage("");
    } catch (error) {
      console.error('❌ [CHAT DEBUG] Error sending message:', error);
      console.error('❌ [CHAT DEBUG] Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: error instanceof Error && 'code' in error ? (error as any).code : 'Unknown code',
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
    } finally {
      setIsSending(false);
    }
  };

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Drag handlers for chat modal
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.chat-header')) {
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - chatPosition.x,
        y: e.clientY - chatPosition.y
      });
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.chat-header')) {
      setIsDragging(true);
      const touch = e.touches[0];
      setDragOffset({
        x: touch.clientX - chatPosition.x,
        y: touch.clientY - chatPosition.y
      });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setChatPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isDragging) {
      // Only prevent default if the event is cancelable
      if (e.cancelable) {
        e.preventDefault();
      }
      const touch = e.touches[0];
      setChatPosition({
        x: touch.clientX - dragOffset.x,
        y: touch.clientY - dragOffset.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  // Resize handlers for chat modal
  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    setDragOffset({
      x: e.clientX,
      y: e.clientY
    });
  };

  const handleResizeStartTouch = (e: React.TouchEvent, direction: string) => {
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    const touch = e.touches[0];
    setDragOffset({
      x: touch.clientX,
      y: touch.clientY
    });
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (isResizing) {
      const deltaX = e.clientX - dragOffset.x;
      const deltaY = e.clientY - dragOffset.y;
      
      let newWidth = chatSize.width;
      let newHeight = chatSize.height;
      let newX = chatPosition.x;
      let newY = chatPosition.y;

      if (resizeDirection.includes('right')) {
        newWidth = Math.max(200, chatSize.width + deltaX);
      }
      if (resizeDirection.includes('left')) {
        newWidth = Math.max(200, chatSize.width - deltaX);
        newX = chatPosition.x + deltaX;
      }
      if (resizeDirection.includes('bottom')) {
        newHeight = Math.max(150, chatSize.height + deltaY);
      }
      if (resizeDirection.includes('top')) {
        newHeight = Math.max(150, chatSize.height - deltaY);
        newY = chatPosition.y + deltaY;
      }

      setChatSize({ width: newWidth, height: newHeight });
      setChatPosition({ x: newX, y: newY });
      setDragOffset({ x: e.clientX, y: e.clientY });
    }
  };

  const handleResizeMoveTouch = (e: TouchEvent) => {
    if (isResizing) {
      // Only prevent default if the event is cancelable
      if (e.cancelable) {
        e.preventDefault();
      }
      const touch = e.touches[0];
      const deltaX = touch.clientX - dragOffset.x;
      const deltaY = touch.clientY - dragOffset.y;
      
      let newWidth = chatSize.width;
      let newHeight = chatSize.height;
      let newX = chatPosition.x;
      let newY = chatPosition.y;

      if (resizeDirection.includes('right')) {
        newWidth = Math.max(200, chatSize.width + deltaX);
      }
      if (resizeDirection.includes('left')) {
        newWidth = Math.max(200, chatSize.width - deltaX);
        newX = chatPosition.x + deltaX;
      }
      if (resizeDirection.includes('bottom')) {
        newHeight = Math.max(150, chatSize.height + deltaY);
      }
      if (resizeDirection.includes('top')) {
        newHeight = Math.max(150, chatSize.height - deltaY);
        newY = chatPosition.y + deltaY;
      }

      setChatSize({ width: newWidth, height: newHeight });
      setChatPosition({ x: newX, y: newY });
      setDragOffset({ x: touch.clientX, y: touch.clientY });
    }
  };

  const handleResizeEnd = () => {
    setIsResizing(false);
    setResizeDirection('');
  };

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Generate consistent color for username based on string hash
  const getUsernameColor = (username: string) => {
    const colors = [
      'text-red-400',    // Red
      'text-blue-400',   // Blue
      'text-green-400',  // Green
      'text-yellow-400', // Yellow
      'text-purple-400', // Purple
      'text-pink-400',   // Pink
      'text-indigo-400', // Indigo
      'text-cyan-400',   // Cyan
      'text-orange-400', // Orange
      'text-emerald-400', // Emerald
      'text-violet-400', // Violet
      'text-rose-400',   // Rose
    ];
    
    // Simple hash function to get consistent color
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      const char = username.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return colors[Math.abs(hash) % colors.length];
  };

  // Scroll to bottom when chat tab opens
  useEffect(() => {
    if (showChatTab) {
      // Clear notification when chat is opened
      setNewMessageNotification(null);
      // Clear unread count when chat is opened
      setUnreadMessageCount(0);
      // Mark that chat has been opened at least once
      setHasOpenedChatOnce(true);
      // Small delay to ensure the DOM is updated
      setTimeout(scrollToBottom, 100);
    }
  }, [showChatTab]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages]);

  // Show notification for new messages when chat is closed
  useEffect(() => {
    if (messages.length > lastMessageCount && messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      if (latestMessage.username !== anonymousUsername) {
        console.log('New message from:', latestMessage.username);
        
        if (!hasOpenedChatOnce) {
          // First time - show speech bubble
          setNewMessageNotification({
            text: latestMessage.text,
            username: latestMessage.username
          });
          
          // Auto-hide notification after 5 seconds
          setTimeout(() => {
            setNewMessageNotification(null);
          }, 5000);
        } else if (!showChatTab) {
          // After chat has been opened AND chat is currently closed - increment unread count
          setUnreadMessageCount(prev => prev + 1);
        }
      }
    }
    setLastMessageCount(messages.length);
  }, [messages, anonymousUsername, lastMessageCount, hasOpenedChatOnce, showChatTab]);

  // Save chat position to localStorage whenever it changes
  useEffect(() => {
    if (chatPosition.x >= 0 && chatPosition.y >= 0) {
      console.log('Saving chat position:', chatPosition);
      localStorage.setItem('chatPosition', JSON.stringify(chatPosition));
    }
  }, [chatPosition]);

  // Save chat size to localStorage whenever it changes
  useEffect(() => {
    if (chatSize.width > 0 && chatSize.height > 0) {
      console.log('Saving chat size:', chatSize);
      localStorage.setItem('chatSize', JSON.stringify(chatSize));
    }
  }, [chatSize]);

  // Add event listeners for dragging and resizing
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
    }
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.addEventListener('touchmove', handleResizeMoveTouch, { passive: false });
      document.addEventListener('touchend', handleResizeEnd);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.removeEventListener('touchmove', handleResizeMoveTouch);
      document.removeEventListener('touchend', handleResizeEnd);
    };
  }, [isDragging, isResizing, dragOffset, chatPosition, chatSize, resizeDirection]);

  // Get school logo from Firebase data with localStorage caching
  const schoolLogo = useMemo(() => {
    const targetSchoolName = schoolDisplayName || schoolName;
    if (!targetSchoolName || !firebaseSchools || !firebaseSchools.length) {
      return null;
    }

    // Create a consistent cache key
    const cacheKey = `schoolLogo_${targetSchoolName.toLowerCase().replace(/\s+/g, '_')}`;
    
    // Check localStorage first
    const cachedLogo = localStorage.getItem(cacheKey);
    if (cachedLogo) {
      return cachedLogo;
    }

    // Find school in Firebase data
    const firebaseSchool = firebaseSchools.find(school => 
      school && school.schoolName && school.schoolName.toLowerCase() === targetSchoolName.toLowerCase()
    );
    
    if (firebaseSchool?.schoolLogo) {
      // Cache the logo for future use
      localStorage.setItem(cacheKey, firebaseSchool.schoolLogo);
      return firebaseSchool.schoolLogo;
    }
    
    return null;
  }, [firebaseSchools.length, schoolDisplayName, schoolName]); // Only depend on length, not the entire array

  // Stable rotating messages array - doesn't change based on score
  const rotatingMessages = [
    "Your school's so slow, sloths are filing complaints.",
    "Click faster — or major in losing.",
    "They're winning because they don't have friends. Be like them.",
    "If clicking were a subject, you'd still get a C.",
    "Other schools are tapping like their crush is watching.",
    "Click like you're running from group project responsibilities.",
    "Your CPS is lower than your self-esteem during finals.",
    "Tap faster. Even your school mascot's embarrassed.",
    "You're losing to a school that thinks Wi-Fi is a snack.",
    "Other schools click like it's their PE class. And they're winning.",
    "You're getting outclicked by kids using trackpads.",
    "That leaderboard is looking like your report card: disappointing.",
    "Click harder — your rival school's moms are watching.",
    "Your school clicks like it still uses floppy disks.",
    "Other schools are clicking like they owe someone money.",
    "If you stopped to read this… you're already behind.",
    "Click like it's 3am and you remembered a deadline.",
    "You're losing to a school that thought 2 + 2 = 5.",
    "Click now, apologize to your thumbs later.",
    "Your CPS is slower than school Wi-Fi.",
    "This isn't recess. Start sweating.",
    "Other schools are click-farming. You're click-napping.",
    "Even your school's janitor clicks more during lunch.",
    "You're not clicking. You're casually throwing the game.",
    "Click like you're deleting your browser history.",
    "Your click game is weaker than your excuses.",
    "Click until you unlock carpal tunnel supremacy.",
    "You click like you just got grounded IRL.",
    "This is your school's legacy. Click like it matters.",
    "Even your grandma's in top 10. What's your excuse?",
    "Click like the vending machine finally worked.",
    "You're losing to kids still learning to spell 'click'.",
    "Tap now, flex later.",
    "If tapping was cardio, you'd be ripped.",
    "Other schools eat Ls for breakfast. Serve them more.",
    "Click like your group project partner just quit.",
    "You're being outclicked by a school with no roof.",
    "Clicking is cheaper than therapy — and way more fun.",
    "Click like your mom said 'I'm not mad, just disappointed'.",
    "Even the lunch lady's contributing more than you.",
    "If you stop now, your rival gets bragging rights. Forever.",
    "Tap like you're trying to skip Monday.",
    "You're getting cooked by a school with dial-up.",
    "Click harder — that leaderboard won't cry by itself.",
    "Even your school hamster is on the leaderboard.",
    "They're winning. Again. How's that feel?",
    "Click like you're smashing the skip ad button.",
    "The way you're clicking, your school might go extinct.",
    "Rival schools are sweating. Make them overheat.",
    "Your school motto is now 'At least we tried.'",
    "Click like it's Black Friday at the Wi-Fi store.",
    "You're losing to kids who click with their nose.",
    "This is a team sport. And you're benched.",
    "Click like it's your last brain cell trying to help.",
    "You're clicking like your phone's made of lava.",
    "Click like your school just made eye contact with failure.",
    "Your CPS is lower than your battery percentage.",
    "Click faster than your crush leaves you on read.",
    "Your rival school called — they said thanks for the free win.",
    "You're not losing. You're just... not winning. At all.",
    "Click like this is your villain origin story.",
    "This is how legends are made: one tap at a time.",
    "You're clicking like your screen's made of glass (it is, but still).",
    "Click like you've got something to prove. Because you do.",
    "The scoreboard is judging you. So is your school.",
    "You're losing to a school with 2 working computers.",
    "Click like your GPA's watching.",
    "Tap like you're defusing a bomb in gym class.",
    "They're not better. Just more desperate. Match the energy.",
    "Click like it's the final exam of swag.",
    "Your school anthem just turned into sad elevator music.",
    "Even your school's Wi-Fi gave up on you.",
    "Clicking = Winning. Math never lies.",
    "They're stacking points. You're stacking shame.",
    "Click so hard, your touchscreen files a complaint.",
    "Your rival school is screen recording your downfall.",
    "Click until the fire alarm goes off.",
    "You're not tired. You're just allergic to success.",
    "Click like you're fighting for your school's last shred of dignity.",
    "The scoreboard isn't lying. You just aren't clicking.",
    "Click like you found your ex's new partner on the leaderboard.",
    "They brought bots. You bring chaos.",
    "You're losing to kids on airplane mode.",
    "Click like your phone has feelings — and you hate it.",
    "This is your school's Super Bowl. Don't fumble.",
    "Your school spirit's on life support. Tap to revive.",
    "They're typing essays. You're tapping domination.",
    "Click until you hear voices cheering. Or crying.",
    "Your school's honor just hit single digits.",
    "Tap like you just saw your rival flex on TikTok.",
    "Clicking = cardio for your self-respect.",
    "Even the school goat is clicking harder than you.",
    "Click like your ex is winning for the other team.",
    "They're grinding 24/7. You're scrolling memes.",
    "You're not slow — you're just... inspirationally delayed.",
    "Click like your future college is watching. It might be.",
    "They're farming clout. You're farming Ls.",
    "This is what school rivalries were made for.",
    "Click like your pride's on fire. Because it is.",
    "You want glory? Click. You want excuses? Transfer."
  ];
  const [floatingNumbers, setFloatingNumbers] = useState<Array<{id: number, value: number, x: number, y: number}>>([]);
  const [, ] = useState(false);
  const [showChallengePage, setShowChallengePage] = useState(false);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);
  const [showShareMessage, setShowShareMessage] = useState(false);
  const [challengeModalTextIndex, setChallengeModalTextIndex] = useState(0);
  const [isShareMessageFading, setIsShareMessageFading] = useState(false);
  const [showMilestonePopup, setShowMilestonePopup] = useState(false);
  const [milestoneText, setMilestoneText] = useState("");
  const [showRankUpPopup, setShowRankUpPopup] = useState(false);
  const [rankUpText, setRankUpText] = useState("");
  const [dontShowRankUpToday, setDontShowRankUpToday] = useState(false);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [, ] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);
  const [rankUpdateTrigger, setRankUpdateTrigger] = useState(0);
  const [isScoreAnimating, setIsScoreAnimating] = useState(false);
  const [isLogoPressed, setIsLogoPressed] = useState(false);
  const lastInteractionTime = useRef(0);
  const isProcessingTouch = useRef(false);
  const lastTouchTime = useRef(0);
  
  // Calculate current rank based on localStorage
  const calculateCurrentRank = (schoolName: string, currentScore: number): number => {
    // Force recalculation by using rankUpdateTrigger
    void rankUpdateTrigger;
    
    // Return 1 if schoolName is empty or not provided
    if (!schoolName || schoolName.trim() === '') {
      return 1;
    }
    
    // Use locally stored values for all schools, ensuring consistency
    const schoolsWithScores = firebaseSchools.filter(school => school && school.schoolName).map(school => {
      const schoolNameForComparison = school.schoolName;
      
      // For the current school, use the provided currentScore
      if (schoolNameForComparison.toLowerCase() === schoolName.toLowerCase()) {
        return {
          name: schoolNameForComparison,
          score: currentScore
        };
      }
      
      // For other schools, get from localStorage first, then Firebase
      const localScore = localStorage.getItem(`schoolScore_${schoolNameForComparison}`);
      if (localScore) {
        return {
          name: schoolNameForComparison,
          score: parseInt(localScore, 10)
        };
      }
      
      // Fallback to Firebase score and save to localStorage for consistency
      const firebaseScore = school.score;
      localStorage.setItem(`schoolScore_${schoolNameForComparison}`, firebaseScore.toString());
      return {
        name: schoolNameForComparison,
        score: firebaseScore
      };
    });

    // Sort by score descending
    schoolsWithScores.sort((a, b) => b.score - a.score);

    // Find the rank of the current school with unique ranking (no ties)
    const schoolIndex = schoolsWithScores.findIndex(school => 
      school.name.toLowerCase() === schoolName.toLowerCase()
    );
    
    // If school not found, return the last rank as fallback
    if (schoolIndex === -1) {
      // School not found in ranking (logging removed to prevent data heavy console)
      return schoolsWithScores.length; // Return actual last rank, no cap
    }
    
    // Calculate unique rank (no ties allowed)
    // Since schools are sorted by score descending, the index + 1 gives us the unique rank
    const rank = schoolIndex + 1; // Rank is 1-based, no cap to show actual position
    
    return rank;
  };

  // Calculate current rank for display
  const currentRank = calculateCurrentRank(schoolDisplayName, schoolScore);

  // Calculate region-specific rank using the same logic as LeaderboardPage
  const calculateRegionRank = (schoolName: string, score: number) => {
    if (!schoolName || !firebaseSchools || firebaseSchools.length === 0) return 1;
    
    // Find the current school's region
    const currentSchool = firebaseSchools.find(school => 
      school && school.schoolName && school.schoolName.toLowerCase() === schoolName.toLowerCase()
    );
    
    if (!currentSchool || !currentSchool.region) return 1;
    
    const schoolRegion = currentSchool.region;
    
    // Create leaderboard data with local scores (same as LeaderboardPage)
    const leaderboardData = firebaseSchools
      .filter(school => school && school.schoolName)
      .map(school => {
        const localScore = parseInt(localStorage.getItem(`schoolScore_${schoolNameToSlug(school.schoolName)}`) || '0');
        return {
          school: school.schoolName,
          score: localScore > 0 ? localScore : (school.score || 0),
          region: school.region
        };
      });
    
    // Add current school if not in the list
    const schoolExists = leaderboardData.some(entry => 
      entry.school.toLowerCase() === schoolName.toLowerCase()
    );
    if (!schoolExists) {
      leaderboardData.push({
        school: schoolName,
        score: score,
        region: schoolRegion
      });
    } else {
      // Update the score for the current school
      const schoolIndex = leaderboardData.findIndex(entry => 
        entry.school.toLowerCase() === schoolName.toLowerCase()
      );
      if (schoolIndex !== -1) {
        leaderboardData[schoolIndex].score = score;
      }
    }
    
    // Sort by score descending (same as LeaderboardPage)
    const sortedLeaderboardData = leaderboardData.sort((a, b) => b.score - a.score);
    
    // Filter schools in the same region (same as LeaderboardPage)
    const schoolsInRegion = sortedLeaderboardData.filter(entry => entry.region === schoolRegion);
    
    // Find this school's position within the region (same as LeaderboardPage)
    const regionIndex = schoolsInRegion.findIndex(regionEntry => 
      regionEntry.school.toLowerCase() === schoolName.toLowerCase()
    );
    
    return regionIndex === -1 ? 1 : regionIndex + 1;
  };

  const regionRank = calculateRegionRank(schoolDisplayName, schoolScore);
  
  // Get the school's region name
  const getSchoolRegion = (schoolName: string) => {
    if (!schoolName || !firebaseSchools || firebaseSchools.length === 0) return 'ALL';
    
    const currentSchool = firebaseSchools.find(school => 
      school && school.schoolName && school.schoolName.toLowerCase() === schoolName.toLowerCase()
    );
    
    return currentSchool?.region || 'ALL';
  };
  
  const schoolRegion = getSchoolRegion(schoolDisplayName);

  // Trigger rank updates when score changes
  useEffect(() => {
    setRankUpdateTrigger(prev => prev + 1);
  }, [score, schoolScore]);
  
  // Challenge button texts - only the changing part
  const challengeTexts = [
    "Challenge your friend",
    "Join your friends in"
  ];

  // Challenge modal rotating messages
  const challengeModalMessages = [
    "Your schoolmates are in.\nShare so no one misses out!",
    "Share this to guy from other school\nto compete"
  ];
  
  // Text switching animation for challenge button
  useEffect(() => {
    const interval = setInterval(() => {
      setChallengeTextIndex((prevIndex) => (prevIndex + 1) % challengeTexts.length);
    }, 3000); // Switch every 3 seconds

    return () => clearInterval(interval);
  }, [challengeTexts.length]);
  
  // Text switching animation for challenge modal
  useEffect(() => {
    const interval = setInterval(() => {
      setChallengeModalTextIndex((prevIndex) => (prevIndex + 1) % challengeModalMessages.length);
    }, 3000); // Switch every 3 seconds

    return () => clearInterval(interval);
  }, [challengeModalMessages.length]);

  // Rotating text animation for motivational messages - time-based only
  useEffect(() => {
    const interval = setInterval(() => {
        setRotatingTextIndex((prevIndex) => {
          const newIndex = (prevIndex + 1) % rotatingMessages.length;
          return newIndex;
        });
    }, 4000); // Switch every 4 seconds

    return () => {
      clearInterval(interval);
    };
  }, []); // No dependencies - runs once on mount

  // No need to reset rotation index - let it continue naturally

  // Check if rank up popup should be shown today
  useEffect(() => {
    const today = new Date().toDateString();
    const lastDontShowDate = localStorage.getItem('dontShowRankUpDate');
    
    if (lastDontShowDate === today) {
      setDontShowRankUpToday(true);
      setCheckboxChecked(true); // Keep checkbox checked if user opted out today
    } else {
      setDontShowRankUpToday(false);
      setCheckboxChecked(false); // Reset checkbox for new day
    }
  }, []);

  // Reset "don't show today" flag at midnight
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const timeUntilMidnight = tomorrow.getTime() - now.getTime();
    
    const timeout = setTimeout(() => {
      setDontShowRankUpToday(false);
      localStorage.removeItem('dontShowRankUpDate');
    }, timeUntilMidnight);
    
    return () => clearTimeout(timeout);
  }, []);
  
  // Data is now provided by SchoolDataContext - no need to subscribe here

  // Periodic sync useEffect - sync localStorage with Firebase every 5 seconds
  useEffect(() => {
    // Add periodic save every 5 seconds - sync localStorage with Firebase
    const periodicSaveInterval = setInterval(() => {
      if (schoolDisplayName && !isSyncing) {
        // Validate school exists before syncing
        const schoolExists = firebaseSchools.some(school => 
          school && school.schoolName && school.schoolName.toLowerCase() === schoolDisplayName.toLowerCase()
        );
        
        if (!schoolExists) {
          console.error(`❌ [PERIODIC SYNC] School "${schoolDisplayName}" does not exist, skipping sync`);
          return;
        }
        
        // Only sync if there have been actual score changes during this session
        if (scoreChangesRef.current !== 0) {
          console.log(`⏰ [PERIODIC SYNC] Adding ${scoreChangesRef.current} points to Firebase for ${schoolDisplayName}`);
          setIsSyncing(true);
          
          // Add score changes to existing school score
          updateSchoolScoreByName(schoolDisplayName, scoreChangesRef.current).then(() => {
            console.log(`✅ [PERIODIC SYNC] Successfully added ${scoreChangesRef.current} points to Firebase for ${schoolDisplayName}`);
            // Reset score changes after successful sync
            setScoreChanges(0);
            scoreChangesRef.current = 0;
            setHasUnsavedChanges(false);
            setIsSyncing(false);
          }).catch((error) => {
            console.error('❌ [PERIODIC SYNC] Error syncing to Firebase:', error);
            // Don't reset isSyncing immediately on error - let it retry on next interval
            // This prevents rapid retries that could cause more connection issues
            setTimeout(() => {
              setIsSyncing(false);
            }, 10000); // Wait 10 seconds before allowing next sync attempt
          });
        } else {
          // No sync needed - no score changes made during this session
        }
      }
    }, 10000); // Every 10 seconds

    return () => {
      clearInterval(periodicSaveInterval);
    };
  }, [schoolDisplayName, isSyncing, firebaseSchools]);

  // DISABLED: Save to Firebase when component unmounts or page is refreshed - only using periodic sync
  // useEffect(() => {
  //   const saveToFirebase = async () => {
  //     const currentScoreChanges = scoreChangesRef.current;
  //     console.log(`🔍 [SAVE CHECK] Checking save conditions - schoolDisplayName: ${schoolDisplayName}, scoreChanges: ${currentScoreChanges}`);
  //     
  //     // Only save if there were actual score changes during this session
  //     if (schoolDisplayName && currentScoreChanges !== 0) {
  //       try {
  //         console.log(`💾 [SAVE ON EXIT] Saving ${currentScoreChanges} points for ${schoolDisplayName} to Firebase...`);
  //         
  //         // Get the current Firebase score directly from Firebase (not from local state)
  //         const schoolId = schoolDisplayName.toLowerCase().replace(/\s+/g, '_');
  //         const schoolRef = doc(db, SCHOOLS_COLLECTION, schoolId);
  //         const schoolSnap = await getDoc(schoolRef);
  //         
  //         // Calculate new total score: existing Firebase score + changes made this session
  //         const existingScore = schoolSnap.exists() ? schoolSnap.data().score : 0;
  //         const newTotalScore = existingScore + currentScoreChanges;
  //         
  //         console.log(`🔍 [SCORE CALCULATION] Existing Firebase score: ${existingScore}, Changes to add: ${currentScoreChanges}, New total: ${newTotalScore}`);
  //         
  //         await saveSchool({
  //           schoolName: schoolDisplayName,
  //           rank: 1, // Will be updated by the real-time listener
  //           score: newTotalScore
  //           // schoolLogo is read-only and only admin can change it
  //         });
  //         
  //         console.log(`✅ [SAVE ON EXIT] Successfully saved ${currentScoreChanges} points to ${schoolDisplayName}. New total: ${newTotalScore} (was ${existingScore})`);
  //         
  //                   // Reset score changes after successful save
  //                   setScoreChanges(0);
  //                   scoreChangesRef.current = 0;
  //                   setHasUnsavedChanges(false);
  //       } catch (error) {
  //         console.error('❌ [SAVE ON EXIT] Error saving school score changes to Firebase:', error);
  //       }
  //     } else {
  //       console.log(`🚫 [SAVE ON EXIT] No save needed - schoolDisplayName: ${schoolDisplayName}, scoreChanges: ${currentScoreChanges}`);
  //     }
  //   };
  // }, []); // Close the commented useEffect

    // Only save on page unload/refresh - no periodic or visibility saves
    // DISABLED: Save on exit functionality - only using periodic sync
    // const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    //   console.log(`🔄 [BEFORE UNLOAD] Page is being unloaded - schoolDisplayName: ${schoolDisplayName}, scoreChanges: ${scoreChangesRef.current}`);
    //   
    //   if (schoolDisplayName && scoreChangesRef.current !== 0) {
    //     // Store the data for potential recovery
    //     sessionStorage.setItem('pendingScoreSave', JSON.stringify({
    //       schoolName: schoolDisplayName,
    //       scoreChanges: scoreChangesRef.current,
    //       timestamp: Date.now()
    //     }));
    //     console.log(`💾 [BEFORE UNLOAD] Stored pending save data: ${scoreChangesRef.current} points for ${schoolDisplayName}`);
    //     
    //     // Try to save immediately (synchronous attempt)
    //     try {
    //       console.log(`🚀 [IMMEDIATE SAVE] Attempting immediate save before page unload...`);
    //       // Force immediate save
    //       saveToFirebase();
    //     } catch (error) {
    //       console.error('❌ [IMMEDIATE SAVE] Error in immediate save:', error);
    //     }
    //     
    //     // Show warning to user about unsaved changes
    //     event.preventDefault();
    //     event.returnValue = 'You have unsaved score changes. Are you sure you want to leave?';
    //     return 'You have unsaved score changes. Are you sure you want to leave?';
    //   }
    // };

    // DISABLED: Save on exit functionality - only using periodic sync
    // const handleVisibilityChange = () => {
    //   if (document.visibilityState === 'hidden') {
    //     console.log(`🔄 [VISIBILITY CHANGE] Page hidden - schoolDisplayName: ${schoolDisplayName}, scoreChanges: ${scoreChangesRef.current}`);
    //     saveToFirebase();
    //   }
    // };

    // const handlePageHide = () => {
    //   console.log(`🔄 [PAGE HIDE] Page hidden - schoolDisplayName: ${schoolDisplayName}, scoreChanges: ${scoreChangesRef.current}`);
    //   saveToFirebase();
    // };

    // const handleUnload = () => {
    //   console.log(`🔄 [UNLOAD] Page unloading - schoolDisplayName: ${schoolDisplayName}, scoreChanges: ${scoreChangesRef.current}`);
    //   saveToFirebase();
    // };

    // const handleWindowBlur = () => {
    //   console.log(`🔄 [WINDOW BLUR] Window lost focus - schoolDisplayName: ${schoolDisplayName}, scoreChanges: ${scoreChangesRef.current}`);
    //   if (scoreChangesRef.current !== 0) {
    //     saveToFirebase();
    //   }
    // };

    // DISABLED: Save on exit functionality - only using periodic sync
    // window.addEventListener('beforeunload', handleBeforeUnload);
    // window.addEventListener('unload', handleUnload);
    // window.addEventListener('pagehide', handlePageHide);
    // window.addEventListener('blur', handleWindowBlur);
    // document.addEventListener('visibilitychange', handleVisibilityChange);

  // Load initial school data only once when schoolName changes
  useEffect(() => {
    if (schoolName) {
      // Try dynamic lookup first using Firebase data
      const dynamicDisplayName = findSchoolBySlug(schoolName, firebaseSchools);
      
      if (dynamicDisplayName) {
        // Found exact match in Firebase
        setSchoolDisplayName(dynamicDisplayName);
        // Found exact match in Firebase
      } else {
        // Fallback to static conversion (for backwards compatibility)
        const fallbackDisplayName = slugToSchoolName(schoolName);
        setSchoolDisplayName(fallbackDisplayName);
        // No exact match found, using fallback conversion
      }
      
      // Always use the dynamically found name if available
      const displayName = dynamicDisplayName || slugToSchoolName(schoolName);
      
      // Update schoolDisplayName to use the correct Firebase name
      if (dynamicDisplayName) {
        setSchoolDisplayName(dynamicDisplayName);
      }
      if (firebaseSchools.length > 0) {
        const schoolExists = firebaseSchools.some(school => 
          school && school.schoolName && school.schoolName.toLowerCase() === displayName.toLowerCase()
        );
        
        if (!schoolExists) {
          // Prevent repeated logging for the same invalid school
          const errorKey = `invalid_school_${schoolName}`;
          const lastErrorTime = localStorage.getItem(errorKey);
          const now = Date.now();
          
          // Only log if it's been more than 5 minutes since last error for this school
          if (!lastErrorTime || now - parseInt(lastErrorTime) > 300000) {
          console.error(`❌ [SCHOOL VALIDATION] School "${displayName}" (from slug "${schoolName}") does not exist in Firebase data`);
            console.log('Available schools:', firebaseSchools.filter(s => s && s.schoolName).map(s => s.schoolName));
            
            // Check if this was found via dynamic lookup (meaning it's a valid slug format)
            if (dynamicDisplayName) {
              console.log(`ℹ️ [SCHOOL VALIDATION] "${displayName}" has a valid slug format but is not in Firebase. This might be a data sync issue.`);
            } else {
              console.log(`ℹ️ [SCHOOL VALIDATION] "${displayName}" (slug: "${schoolName}") does not match any school name pattern.`);
            }
            
            // Store the error time to prevent repeated logging
            localStorage.setItem(errorKey, now.toString());
          }
          
          // Redirect to home page with a more helpful message
          const errorMessage = dynamicDisplayName
            ? `School "${displayName}" is not available yet. Please check back later or contact support.`
            : `School "${displayName}" was not found. Please check the URL or visit our homepage to see available schools.`;
            
          navigate('/', { 
            state: { 
              error: errorMessage 
            } 
          });
          return;
        }
      }
      
      // Check if this is a new school (different from the one in sessionStorage)
      // Store the current school in sessionStorage for navigation tracking
        // Storing school support in sessionStorage
      sessionStorage.setItem('currentSchoolSupport', schoolName);
      
      // Theme toggling removed; default is increasing mode
    }
  }, [schoolName, firebaseSchools]);

  // Load school score from localStorage first, then sync with Firebase
  useEffect(() => {
    if (schoolDisplayName && firebaseSchools.length > 0) {
      // Always prioritize localStorage for immediate display
      const localScore = localStorage.getItem(`schoolScore_${schoolDisplayName}`);
      const localScoreValue = localScore ? parseInt(localScore, 10) : null;
      
      // Find the school in Firebase data
      const firebaseSchool = firebaseSchools.find(school => 
        school && school.schoolName && school.schoolName.toLowerCase() === schoolDisplayName.toLowerCase()
      );
      
        if (firebaseSchool) {
          // School exists in Firebase
          const firebaseScore = firebaseSchool.score;
          
          // Always use local score if it exists and is non-zero
          if (localScoreValue !== null && localScoreValue > 0) {
            // Prefer local score for display
            setSchoolScore(localScoreValue);
            
            // Don't set scoreChanges for existing localStorage scores
            // This prevents automatic syncing of old scores
            setScoreChanges(0);
            scoreChangesRef.current = 0;
            setHasUnsavedChanges(false);
          } else if (localScoreValue !== null && localScoreValue === 0 && firebaseScore === 0) {
            // Both are zero - this is normal
            setSchoolScore(0);
            setScoreChanges(0);
            scoreChangesRef.current = 0;
            setHasUnsavedChanges(false);
          } else {
            // No local score or local score is 0 - use Firebase score
            setSchoolScore(firebaseScore);
            setScoreChanges(0);
            scoreChangesRef.current = 0;
            setHasUnsavedChanges(false);
          }
        
        // Firebase school information available
      } else {
        // School doesn't exist in Firebase yet
        const fallbackScore = localScoreValue || 0;
        
        setSchoolScore(fallbackScore);
        setScoreChanges(0);
        scoreChangesRef.current = 0;
        setHasUnsavedChanges(false);
        console.log('School loaded from localStorage (no Firebase):', schoolDisplayName, 'Score:', fallbackScore);
      }
    }
  }, [schoolDisplayName, firebaseSchools.length]); // Remove currentSchool dependency to prevent reset on page switch

  useEffect(() => {
    // Clear stored school support data on page refresh
    const handleClearSessionData = () => {
      sessionStorage.removeItem('currentSchoolSupport');
    };

    window.addEventListener('beforeunload', handleClearSessionData);
    
    return () => {
      window.removeEventListener('beforeunload', handleClearSessionData);
    };
  }, []);

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

  // Handle challenge button click
  const handleChallengeClick = async () => {
    try {
      let currentUrl = 'https://schoolclicker.com';
      
      // Safely get current URL with validation
      if (typeof window !== 'undefined' && window.location) {
        try {
          const href = window.location.href;
          // More robust URL validation
          if (href && typeof href === 'string' && href.startsWith('http') && href.length > 10) {
            // Additional validation to ensure it's a proper URL
            try {
              new URL(href);
              currentUrl = href;
            } catch (urlValidationError) {
              console.warn('Invalid URL format, using fallback:', urlValidationError);
            }
          }
        } catch (urlError) {
          console.warn('Failed to get current URL, using fallback:', urlError);
        }
      }
      
      await navigator.clipboard.writeText(currentUrl);
      setShowChallengePage(true);
    } catch (error) {
      console.error('Failed to copy challenge link: ', error);
      // Fallback: still show the challenge page even if clipboard fails
      setShowChallengePage(true);
    }
  };

  // Check for milestone achievements
  const checkMilestoneAchievement = (newScore: number) => {
    const milestones = [100, 1000, 10000, 100000, 1000000];
    const achievedMilestone = milestones.find(milestone => 
      newScore >= milestone && (newScore - multiplier) < milestone
    );
    
    if (achievedMilestone) {
      setMilestoneText(`🎉 ${achievedMilestone.toLocaleString()} points achieved! 🎉`);
      setShowMilestonePopup(true);
    }
  };

  // Check for rank improvements
  const _checkRankImprovement = (oldSchoolScore: number, newSchoolScore: number) => {
    if (!schoolDisplayName) return;
    
    const currentRank = calculateCurrentRank(schoolDisplayName, newSchoolScore);
    const previousRank = calculateCurrentRank(schoolDisplayName, oldSchoolScore);
    
    // Rank check debug (removed for performance)
    
    // Check if rank improved (lower number = better rank)
    if (currentRank < previousRank && currentRank > 0 && !dontShowRankUpToday) {
      console.log('🎉 [RANK UP] Showing rank up popup!');
      setRankUpText(`🎉 School ranked up to #${currentRank}! 🎉`); // Updated text
      setShowRankUpPopup(true);
      // Don't reset checkbox - preserve user's previous choice for the day
    } else {
      // No rank up - conditions not met
      if (dontShowRankUpToday) {
        // Rank up popup disabled for today
      }
    }
  };

  // Handle milestone popup close
  const handleMilestoneClose = () => {
    setShowMilestonePopup(false);
  };

  // Handle rank up popup close
  const handleRankUpClose = () => {
    setShowRankUpPopup(false);
  };

  const handleDontShowRankUpToday = () => {
    console.log('Checkbox clicked!');
    setCheckboxChecked(true);
    const today = new Date().toDateString();
    localStorage.setItem('dontShowRankUpDate', today);
    setDontShowRankUpToday(true);
    setShowRankUpPopup(false);
  };

  const handleCopySchoolLink = async () => {
    console.log('Copy button clicked');
    console.log('schoolDisplayName:', schoolDisplayName);
    console.log('schoolName:', schoolName);
    
    const currentSchoolName = schoolDisplayName || schoolName || 'unknown-school';
    // Convert to lowercase and replace spaces with nothing for clean URL
    const cleanSchoolName = currentSchoolName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9-]/g, '');
    
    // Safe URL construction with fallback
    let origin = 'https://schoolclicker.com';
    
    if (typeof window !== 'undefined' && window.location) {
      try {
        const windowOrigin = window.location.origin;
        if (windowOrigin && typeof windowOrigin === 'string' && windowOrigin.startsWith('http') && windowOrigin.length > 10) {
          // Additional validation to ensure it's a proper URL
          try {
            new URL(windowOrigin);
            origin = windowOrigin;
          } catch (urlValidationError) {
            console.warn('Invalid origin URL format, using fallback:', urlValidationError);
          }
        }
      } catch (urlError) {
        console.warn('Failed to get window origin, using fallback:', urlError);
      }
    }
    
    const schoolLink = `${origin}/${cleanSchoolName}`;
    
    // Final validation of the constructed URL
    try {
      new URL(schoolLink);
    } catch (finalUrlError) {
      console.warn('Constructed school link is invalid, using fallback:', finalUrlError);
      return 'https://schoolclicker.com';
    }
    
    console.log('Generated link:', schoolLink);
    
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(schoolLink);
        console.log('Clipboard API success');
        setIsLinkCopied(true);
        setShowSharePopup(true);
        setTimeout(() => setIsLinkCopied(false), 5000);
        setTimeout(() => setShowSharePopup(false), 3000);
      } else {
        throw new Error('Clipboard API not available');
      }
    } catch (err) {
      console.error('Clipboard API failed:', err);
      // Fallback for older browsers or non-secure contexts
      try {
        const textArea = document.createElement('textarea');
        textArea.value = schoolLink;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
          console.log('Fallback copy success');
          setIsLinkCopied(true);
          setShowSharePopup(true);
          setTimeout(() => setIsLinkCopied(false), 5000);
          setTimeout(() => setShowSharePopup(false), 3000);
        } else {
          throw new Error('Fallback copy failed');
        }
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
        alert('Failed to copy link. Please copy manually: ' + schoolLink);
      }
    }
  };

  // Handle challenge tab close
  const handleChallengeClose = () => {
    setShowChallengePage(false);
    setShowCopiedMessage(true);
    setShowShareMessage(true);
    // Hide the message after 5 seconds
    setTimeout(() => {
      setShowCopiedMessage(false);
    }, 5000);
    // Start fade out after 2.5 seconds, then remove after 1 second fade
    setTimeout(() => {
      setIsShareMessageFading(true);
      setTimeout(() => {
        setShowShareMessage(false);
        setIsShareMessageFading(false);
      }, 1000);
    }, 2500);
  };

  // Manual save function - sync localStorage with Firebase
  // const _handleManualSave = async () => {
  //   if (schoolDisplayName) {
  //     console.log(`💾 [MANUAL SAVE] User manually syncing localStorage with Firebase for ${schoolDisplayName}`);
  //     try {
  //       // Get current score from localStorage
  //       const localScore = localStorage.getItem(`schoolScore_${schoolDisplayName}`);
  //       const localScoreValue = localScore ? parseInt(localScore, 10) : 0;
  //       
  //       console.log(`🔍 [MANUAL SAVE] Adding score changes: ${scoreChangesRef.current} to Firebase for ${schoolDisplayName}`);
  //       
  //       await updateSchoolScoreByName(schoolDisplayName, scoreChangesRef.current);
  //       
  //       console.log(`✅ [MANUAL SAVE] Successfully added ${scoreChangesRef.current} points to Firebase for ${schoolDisplayName}`);
  //       
  //       // Reset score changes after successful save
  //       setScoreChanges(0);
  //       scoreChangesRef.current = 0;
  //       setHasUnsavedChanges(false);
  //       
  //       // Show success message
  //       alert(`✅ Successfully synced ${localScoreValue} points to Firebase for ${schoolDisplayName}!`);
  //     } catch (error) {
  //       console.error('❌ [MANUAL SAVE] Error syncing to Firebase:', error);
  //       alert('❌ Failed to sync. Please try again.');
  //     }
  //   } else {
  //     alert('No school selected.');
  //   }
  // };

  // Unified handler for both click and touch events
  const handleSchoolLogoInteraction = (event: React.MouseEvent | React.TouchEvent) => {
    const now = Date.now();
    // Debug log to track event types
    console.log(`🎯 [DEBUG] Event type: ${event.type}, isProcessingTouch: ${isProcessingTouch.current}, isIOS: ${isIOS.current}, time since last touch: ${now - lastTouchTime.current}ms`);
    
    // Only prevent default for mouse events, not touch events (to avoid passive listener errors)
    if (event.type.startsWith('mouse')) {
      event.preventDefault();
    }
    
    // Prevent duplicate events on iOS (both mouse and touch events fire)
    if (now - lastInteractionTime.current < 100) { // Increased throttle to 100ms
      console.log(`⏰ [DEBUG] Throttled - too soon: ${now - lastInteractionTime.current}ms`);
      return;
    }
    lastInteractionTime.current = now;
    
    // Additional check: if this is a mouse event but we're processing touch, skip it
    if (event.type.startsWith('mouse') && (isProcessingTouch.current || (now - lastTouchTime.current) < 500)) {
      console.log(`🚫 [DEBUG] Skipping mouse event during touch processing`);
      return;
    }
    
    // Use immediate score update for all devices to test if batching is the issue
    console.log(`📊 [DEBUG] Immediate score update - adding ${multiplier} points`);
    setScore(prev => {
      const newScore = prev + multiplier;
      saveIndividualScore(newScore);
      
      // Check for milestone achievements
      checkMilestoneAchievement(newScore);
      
      return newScore;
    });
    
    // Create appropriate event for createFloatingNumber
    let mouseEvent: React.MouseEvent;
    if ('touches' in event) {
      // Touch event - create mock mouse event
      mouseEvent = {
        currentTarget: event.currentTarget,
        clientX: event.touches[0].clientX,
        clientY: event.touches[0].clientY
      } as React.MouseEvent;
    } else {
      // Mouse event - use as is
      mouseEvent = event as React.MouseEvent;
    }
    
    createFloatingNumber(multiplier, mouseEvent);
    
    // Increase school score (with overflow protection)
    setSchoolScore(prev => {
      const maxScore = 1000000000000;
      const newSchoolScore = Math.min(maxScore, prev + multiplier);
      
      localStorage.setItem(`schoolScore_${schoolDisplayName}`, newSchoolScore.toString());
      
      setIsScoreAnimating(true);
      setTimeout(() => setIsScoreAnimating(false), 300);
      
      _checkRankImprovement(prev, newSchoolScore);
      
      return newSchoolScore;
    });
    setScoreChanges(prev => {
      const newValue = prev + multiplier;
      scoreChangesRef.current = newValue;
      setHasUnsavedChanges(true);
      return newValue;
    });
  };


  const handleLogoMouseDown = useCallback((event: React.MouseEvent) => {
    const now = Date.now();
    console.log(`🖱️ [DEBUG] Mouse down - isIOS: ${isIOS.current}, isProcessingTouch: ${isProcessingTouch.current}, time since last touch: ${now - lastTouchTime.current}ms`);
    
    // Skip mouse events only if we're processing touch OR if touch happened recently
    // Don't block all touch devices - laptops with touch screens should still work
    if (isProcessingTouch.current || (now - lastTouchTime.current) < 500) {
      console.log(`🖱️ [DEBUG] Skipping mouse event - processing touch or recent touch`);
      return;
    }
    
    event.preventDefault();
    setIsLogoPressed(true);
    
    
    // Play sound on mouse down (both iOS and non-iOS)
    playPopcatSound();
    
    handleSchoolLogoInteraction(event);
  }, [handleSchoolLogoInteraction, playPopcatSound]);

  const handleLogoMouseUp = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    // Very short delay to ensure scaling is visible
    setTimeout(() => setIsLogoPressed(false), 10);
  }, []);

  const handleLogoTouchStart = useCallback((event: React.TouchEvent) => {
    const now = Date.now();
    console.log(`👆 [DEBUG] Touch start - isIOS: ${isIOS.current}, time since last touch: ${now - lastTouchTime.current}ms`);
    
    // Don't use preventDefault in touch events to avoid passive listener errors
    setIsLogoPressed(true);
    
    // Always set touch processing flag for touch events (works for all touch devices)
    console.log(`👆 [DEBUG] Setting isProcessingTouch = true for touch event`);
    isProcessingTouch.current = true;
    lastTouchTime.current = now;
    
    // Play sound on touch (both iOS and non-iOS)
    playPopcatSound();
    
    handleSchoolLogoInteraction(event);
    
    // Reset touch processing flag after a short delay (works for all touch devices)
    setTimeout(() => {
      console.log(`👆 [DEBUG] Touch processing timeout - setting isProcessingTouch = false`);
      isProcessingTouch.current = false;
    }, 300); // Increased timeout to be more reliable
  }, [handleSchoolLogoInteraction, playPopcatSound]);

  const handleLogoTouchEnd = useCallback((_event: React.TouchEvent) => {
    // Don't use preventDefault in touch events to avoid passive listener errors
    // Very short delay to ensure scaling is visible
    setTimeout(() => setIsLogoPressed(false), 10);
  }, []);

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };


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
  const countdownTarget = useMemo(() => {
    const now = new Date();
    const target = new Date(now);
    const day = now.getDay();
    let daysUntilMonday = (1 - day + 7) % 7;
    if (daysUntilMonday === 0) {
      daysUntilMonday = 7;
    }
    target.setDate(now.getDate() + daysUntilMonday);
    target.setHours(15, 0, 0, 0);
    return target;
  }, []);

  const virusCountdown = useCountdown(countdownTarget);
  const requiresSharedStudent = selectedShareMethod === "DM" || selectedShareMethod === "ETC";

  return (
    <>
    {isMysteryBoxOpen && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="relative bg-[#0b0b0b] border border-white/20 rounded-3xl px-6 py-8 w-[90vw] max-w-[360px] text-center shadow-[0_25px_40px_rgba(0,0,0,0.6)]">
          <button
            type="button"
            className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-black text-white border border-white/20 flex items-center justify-center text-2xl font-bold hover:bg-black/80 transition-colors"
            onClick={() => setIsMysteryBoxOpen(false)}
            aria-label="Close mystery box"
          >
            ×
          </button>
          <div className="w-16 h-16 mx-auto mb-4 rounded-3xl bg-black text-white flex items-center justify-center text-4xl font-pixelify border border-white/20">
            ?
          </div>
          <h2 className="font-pixelify text-white text-2xl mb-2">Virus Effect</h2>
          <p className="font-pingfang text-white/80 text-sm leading-relaxed">
            SchoolClicker is more than just a game. It’s a movement. A movement powered by students who believe their school deserves to stand above the rest. Spread it beyond your walls. Share it with friends from other schools and show proof through your DMs or stories.
            <span className="block mt-2 text-green-400">
              The school that spreads the movement the most will earn twice the points of the winning school.
            </span>
            <span className="block mt-2">
              Be the reason your school leads the movement.
            </span>
            <span className="block mt-1 text-red-400 font-pixelify text-sm">
              Story: +5 &nbsp;&nbsp; DM: +1
            </span>
          </p>
          {!virusCountdown.isExpired && (
            <div className="mt-5 flex items-center justify-center gap-3 text-white font-pixelify">
              <div className="flex flex-col items-center bg-white/10 rounded-2xl px-3 py-2 min-w-[70px]">
                <span className="text-2xl">{virusCountdown.days}</span>
                <span className="text-xs uppercase tracking-[0.3em] text-white/70">Days</span>
              </div>
              <div className="flex flex-col items-center bg-white/10 rounded-2xl px-3 py-2 min-w-[70px]">
                <span className="text-2xl">{virusCountdown.hours}</span>
                <span className="text-xs uppercase tracking-[0.3em] text-white/70">Hours</span>
              </div>
              <div className="flex flex-col items-center bg-white/10 rounded-2xl px-3 py-2 min-w-[70px]">
                <span className="text-2xl">{virusCountdown.minutes}</span>
                <span className="text-xs uppercase tracking-[0.3em] text-white/70">Mins</span>
              </div>
              <div className="flex flex-col items-center bg-white/10 rounded-2xl px-3 py-2 min-w-[70px]">
                <span className="text-2xl">{virusCountdown.seconds}</span>
                <span className="text-xs uppercase tracking-[0.3em] text-white/70">Secs</span>
              </div>
            </div>
          )}
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              className="w-full px-5 py-2 rounded-2xl bg-white text-black font-pixelify text-sm hover:bg-gray-200 transition-colors"
              onClick={() => {
                setIsMysteryBoxOpen(false);
                setProofSubmissionMessage(null);
                setShareLeaderboardError(null);
                setIsShareLeaderboardOpen(true);
                void fetchShareLeaderboard();
              }}
            >
              Leaderboard
            </button>
            <button
              type="button"
              className="w-full px-5 py-2 rounded-2xl bg-[#ff6e6e] text-white font-pixelify text-sm hover:bg-[#ff5555] transition-colors"
              onClick={() => {
                if (!selectedProofSchool && schoolOptions.length > 0) {
                  setSelectedProofSchool(schoolOptions[0] ?? "");
                }
                setProofSubmissionMessage(null);
                setProofSubmissionError(null);
                setIsSubmitProofOpen(true);
              }}
            >
              Fill in the form
            </button>
            {proofSubmissionMessage && (
              <p className="text-green-400 text-sm font-pingfang leading-relaxed">
                {proofSubmissionMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    )}
    {isSubmitProofOpen && (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <form
          className="relative bg-[#0b0b0b] border border-white/25 rounded-3xl px-6 py-8 w-[92vw] max-w-[420px] text-left shadow-[0_30px_50px_rgba(0,0,0,0.65)]"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!proofFile) {
              setProofSubmissionError("Please upload a proof image.");
              return;
            }
            if (!selectedProofSchool) {
              setProofSubmissionError("Please select your school.");
              return;
            }
            if (requiresSharedStudent && !sharedSchoolStudent.trim()) {
              setProofSubmissionError("Please enter the school or student you shared this with.");
              return;
            }

            setIsSubmittingProof(true);
            setProofSubmissionError(null);
            try {
              await submitShareProof({
                schoolName: selectedProofSchool,
                shareMethod: selectedShareMethod,
                sharedSchoolStudent: requiresSharedStudent ? sharedSchoolStudent.trim() : null,
                proofFile,
              });
              setProofSubmissionMessage("Proof submitted! Thanks for spreading the movement.");
              resetProofForm();
            } catch (error) {
              console.error('Error submitting proof:', error);
              setProofSubmissionError(
                error instanceof Error ? error.message : 'Something went wrong. Please try again.'
              );
            } finally {
              setIsSubmittingProof(false);
            }
          }}
        >
          <button
            type="button"
            className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-black text-white border border-white/20 flex items-center justify-center text-2xl font-bold hover:bg-black/80 transition-colors"
            onClick={resetProofForm}
            aria-label="Close proof submission"
          >
            ×
          </button>
          <h3 className="font-pixelify text-white text-2xl mb-4 text-center">Submit Your Proof</h3>
          {proofSubmissionError && (
            <p className="mb-4 text-sm font-pingfang text-red-400">
              {proofSubmissionError}
            </p>
          )}
          <p className="text-center text-red-400 text-sm font-pixelify uppercase tracking-[0.3em] mb-4">
            Story is five points · DM is one point
          </p>
          <div className="space-y-4">
            <label className="flex flex-col gap-2">
              <span className="font-pixelify text-white text-sm uppercase tracking-[0.3em]">What’s your school?</span>
              <select
                value={selectedProofSchool}
                onChange={(event) => setSelectedProofSchool(event.target.value)}
                className="bg-black border border-white/20 rounded-xl px-3 py-2 text-white font-pingfang text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6e6e]"
                required
              >
                <option value="" disabled hidden>Select your school</option>
                {schoolOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="font-pixelify text-white text-sm uppercase tracking-[0.3em]">How did you share?</span>
              <select
                value={selectedShareMethod}
                onChange={(event) => setSelectedShareMethod(event.target.value as "Story" | "DM" | "ETC")}
                className="bg-black border border-white/20 rounded-xl px-3 py-2 text-white font-pingfang text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6e6e]"
              >
                <option value="Story">Story</option>
                <option value="DM">DM</option>
                <option value="ETC">ETC</option>
              </select>
            </label>

            {requiresSharedStudent && (
              <label className="flex flex-col gap-2">
                <span className="font-pixelify text-white text-sm uppercase tracking-[0.3em]">What school student did you share this to?</span>
                <input
                  type="text"
                  value={sharedSchoolStudent}
                  onChange={(event) => setSharedSchoolStudent(event.target.value)}
                  placeholder="Enter school name. MUST."
                  className="bg-black border border-white/20 rounded-xl px-3 py-2 text-white font-pingfang text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6e6e]"
                  required
                />
              </label>
            )}

            <label className="flex flex-col gap-2">
              <span className="font-pixelify text-white text-sm uppercase tracking-[0.3em]">Upload screenshot of your DM or Story</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setProofFile(file);
                }}
                className="bg-black border border-dashed border-white/20 rounded-xl px-3 py-4 text-white text-sm font-pingfang focus:outline-none focus:ring-2 focus:ring-[#ff6e6e]"
                required
              />
              {proofFile && (
                <span className="text-white/70 text-xs font-pingfang truncate">{proofFile.name}</span>
              )}
            </label>
          </div>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              className="w-1/2 px-4 py-2 rounded-2xl border border-white/20 text-white font-pixelify text-sm hover:bg-white/10 transition-colors"
              onClick={() => {
                setProofSubmissionMessage(null);
                resetProofForm();
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-1/2 px-4 py-2 rounded-2xl bg-[#ff6e6e] text-white font-pixelify text-sm hover:bg-[#ff5555] transition-colors disabled:opacity-40"
              disabled={
                isSubmittingProof ||
                !selectedProofSchool ||
                !proofFile ||
                (requiresSharedStudent && !sharedSchoolStudent.trim())
              }
            >
              Submit proof
            </button>
          </div>
        </form>
      </div>
    )}
    {isShareLeaderboardOpen && (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
        <div className="relative bg-[#0b0b0b] border border-white/25 rounded-3xl px-6 py-8 w-[92vw] max-w-[420px] text-left shadow-[0_30px_50px_rgba(0,0,0,0.65)]">
          <button
            type="button"
            className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-black text-white border border-white/20 flex items-center justify-center text-2xl font-bold hover:bg-black/80 transition-colors"
            onClick={() => setIsShareLeaderboardOpen(false)}
            aria-label="Close share leaderboard"
          >
            ×
          </button>
          <h3 className="font-pixelify text-white text-2xl mb-4 text-center">Share Leaderboard</h3>
          {isShareLeaderboardLoading ? (
            <p className="text-white/70 text-sm font-pingfang text-center">Loading…</p>
          ) : shareLeaderboardError ? (
            <p className="text-red-400 text-sm font-pingfang text-center">{shareLeaderboardError}</p>
          ) : shareLeaderboard.length === 0 ? (
            <p className="text-white/70 text-sm font-pingfang text-center">
              No shares have been submitted yet. Be the first to spread the movement!
            </p>
          ) : (
            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
              {shareLeaderboard.map((entry, index) => (
                <div
                  key={entry.schoolName}
                  className="flex items-center justify-between bg-white/5 rounded-2xl px-4 py-3 border border-white/10"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/15 text-white font-pixelify text-lg flex items-center justify-center">
                      {index + 1}
                    </div>
                    <span className="font-pixelify text-white text-sm">{entry.schoolName}</span>
                  </div>
                  <span className="font-pixelify text-white text-xl">{entry.points}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )}
    <div className="w-full h-screen-dvh flex flex-col overflow-hidden select-none bg-[#006aff]">
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
          
               {/* Desktop: Active students counter - next to title */}
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
             
             {/* Mobile: Active students counter - below title */}
             <div className="lg:hidden flex items-center gap-2 -mt-0.5">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <div className="w-1 h-1 bg-green-300 rounded-full animate-ping delay-500"></div>
            </div>
            <span className="font-pixelify font-normal text-green-400 text-xs tracking-[0] leading-[normal]">
              10k+ active students
            </span>
          </div>
          
          {/* Mobile: Chat Button - top left corner below nav bar */}
          <div className="lg:hidden absolute top-[11vh] left-2 z-20">
            <div className="relative">
              <div 
                className="w-8 h-8 bg-gray-600 rounded-lg flex items-center justify-center cursor-pointer hover:bg-gray-500 transition-colors shadow-lg border border-gray-500"
                onClick={() => setShowChatTab(true)}
              >
                <svg className="w-4 h-4 text-white flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                </svg>
              </div>
              
              {/* Red notification number for mobile */}
              {unreadMessageCount > 0 && !showChatTab && (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-pixelify font-bold rounded-full w-5 h-5 flex items-center justify-center border-2 border-white shadow-lg">
                  {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                </div>
              )}
            </div>
          </div>

          {/* Mobile: Speech bubble notification - positioned separately */}
          {newMessageNotification && !showChatTab && (
            <div className="lg:hidden absolute top-[11vh] left-12 z-30">
              <div className="bg-gray-800 text-white rounded-lg p-2 shadow-lg border border-gray-600 max-w-[180px] animate-pulse">
                <div className="flex items-center gap-1 mb-1">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span className="text-xs font-pixelify text-green-400 font-semibold">
                    {newMessageNotification.username}
                  </span>
                </div>
                <div className="text-xs font-pixelify text-white">
                  {newMessageNotification.text.length > 40 
                    ? `${newMessageNotification.text.substring(0, 40)}...` 
                    : newMessageNotification.text
                  }
                </div>
                {/* Speech bubble tail */}
                <div className="absolute top-2 -left-2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-gray-800"></div>
              </div>
            </div>
          )}
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
               <div className="absolute top-12 left-1 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded-lg z-50 max-w-[180px] text-center">
                Copied. Share with screenshots on story and dm
                    <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-black rotate-45"></div>
                  </div>
                )}
              </div>
            </div>
          </div>

      {/* Main Content Area */}
      <div 
        className="flex-1 flex flex-col relative overflow-hidden px-4 lg:px-8 xl:px-12 py-4 lg:py-6 xl:py-8 pb-20 lg:pb-8 main-content-area"
        style={{
          paddingTop: isIPad ? 'calc(10vh + 20px)' : undefined,
          paddingBottom: isIPad ? 'calc(12vh + 20px)' : undefined
        }}
      >
          {/* Top Section - Score & Info (20-25% of screen) */}
         <div className="flex flex-col items-center justify-center h-[20vh] lg:h-[30vh] min-h-[100px] lg:min-h-[150px]">
             {/* Score and Multiplier Group - Desktop: Top-left, Mobile: Centered */}
            <div className="flex items-baseline mb-1 sm:mb-4 relative md:fixed md:top-[12vh] md:left-4 md:z-30 md:mb-1">
             {/* Glow effect background */}
             <div className="absolute inset-0 blur-3xl opacity-40 bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 rounded-full -z-10"></div>
             
            {/* Multiplier Display */}
             <div className="font-pixelify font-bold text-white text-2xl lg:text-4xl lg:text-4xl xl:text-4xl 2xl:text-4xl 3xl:text-4xl tracking-[0] leading-[normal] bg-gradient-to-br from-yellow-300 to-orange-400 bg-clip-text text-transparent drop-shadow-lg animate-pulse">
              x{multiplier}
            </div>
            {/* Main Score Display */}
              <div className="text-white text-5xl lg:text-6xl lg:text-6xl xl:text-6xl 2xl:text-6xl 3xl:text-6xl font-pixelify font-bold tracking-[0] leading-[normal]">
               <div className="bg-gradient-to-br from-white via-blue-100 to-blue-200 bg-clip-text text-transparent drop-shadow-2xl">
              {formatNumber(score)}
               </div>
            </div>
          </div>

            {/* Next Goal Text - Desktop: Top-left, Mobile: Centered */}
            {showNextGoal && (
              <p className="opacity-75 font-pingfang font-normal text-white text-sm lg:text-lg lg:text-lg xl:text-lg 2xl:text-lg 3xl:text-lg text-center tracking-[0] leading-[normal] px-2 -mt-1 lg:-mt-4 md:fixed md:top-[23vh] md:left-4 md:text-left md:px-0 md:z-30">
                Next goal: {formatNumber(nextGoal.target)} for {nextGoal.multiplier}x
              </p>
            )}


          {/* Rotating Motivational Text - Always Centered */}
          <div 
            className="flex items-center justify-center px-2 mt-1 lg:mt-4 md:-mt-32 lg:-mt-32 xl:-mt-32 2xl:-mt-32 3xl:-mt-32"
            style={{
              // iPad-specific: Move motivational text up more
              marginTop: isIPad ? '-80px' : undefined
            }}
          >
            <p className={`font-pixelify font-normal text-sm lg:text-lg lg:text-lg xl:text-lg 2xl:text-lg 3xl:text-lg text-center tracking-[0] leading-[normal] animate-pulse ${
            score === 0 ? 'text-green-400' : (rotatingMessages[rotatingTextIndex].startsWith('Ur among') ? 'text-green-400' : 'text-yellow-400')
          }`}>
             {score === 0 ? `Click to join ${isOnlineLoading ? '...' : totalOnline} other students in this school` : rotatingMessages[rotatingTextIndex]}
          </p>
          </div>
        </div>

        {/* Middle Section - School Logo (40-45% of screen) */}
        <div 
          className="flex-1 flex items-center justify-center -mt-0 md:-mt-32 lg:-mt-32 xl:-mt-32 2xl:-mt-32 3xl:-mt-32"
          style={{
            // iPad-specific: Move school logo up a bit more
            marginTop: isIPad ? '-100px' : undefined
          }}
        >
          {/* School Logo */}
          <div 
              className="w-52 h-52 xs:w-60 xs:h-60 sm:w-68 sm:h-68 md:w-80 md:h-80 lg:w-80 lg:h-80 xl:w-80 xl:h-80 2xl:w-80 2xl:h-80 3xl:w-80 3xl:h-80 flex items-center justify-center cursor-pointer"
              style={{ 
                // iPad-specific: Make school logo smaller
                width: isIPad ? '280px' : undefined,
                height: isIPad ? '280px' : undefined,
                willChange: 'transform',
                transform: isLogoPressed ? 'scale(1.1) translateZ(0)' : 'scale(1) translateZ(0)',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                touchAction: 'none',
                WebkitTouchCallout: 'none',
                WebkitTapHighlightColor: 'transparent'
              }}
              draggable={false}
              onMouseDown={handleLogoMouseDown}
              onMouseUp={handleLogoMouseUp}
              onMouseLeave={handleLogoMouseUp}
              onTouchStart={handleLogoTouchStart}
              onTouchEnd={handleLogoTouchEnd}
              onTouchMove={(_e) => {
                // Don't use preventDefault in touch events to avoid passive listener errors
                // Touch move handling without preventDefault
              }}
              onDragStart={(e) => e.preventDefault()}
              onDrag={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
          >
            {schoolLogo && (
            <img
              className="w-full h-full object-contain"
              alt="School Logo"
                src={schoolLogo}
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              onTouchMove={(e) => e.preventDefault()}
              style={{
                willChange: 'transform',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'translateZ(0)',
                pointerEvents: 'none'
              }}
            />
            )}
            
            {/* Hahaha Icon Overlay - Only show when score is 0 */}
            {score === 0 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-bounce">
                <img 
                  src="/icons/hahaha.webp" 
                  alt="Hahaha" 
                  className="w-16 h-16 transform -rotate-45 drop-shadow-lg" 
                  draggable={false}
                />
              </div>
            )}
            
            {/* Floating Numbers */}
            {floatingNumbers.map((floatingNum) => (
              <div
                key={floatingNum.id}
                className="absolute pointer-events-none animate-float-up"
                style={{
                  left: `${floatingNum.x}%`,
                  top: `${floatingNum.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <span className="text-3xl font-black drop-shadow-lg text-stroke text-blue-500">
                  +{floatingNum.value}
                </span>
              </div>
            ))}
          </div>
          </div>

        {/* Bottom Section - Action Buttons (25-30% of screen) */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <button
            type="button"
            onClick={() => setIsMysteryBoxOpen(true)}
            className="fixed left-4 bottom-[calc(12vh+120px)] z-20 w-16 h-16 rounded-3xl bg-black text-white font-pixelify font-bold text-3xl flex items-center justify-center select-none border border-white/20 shadow-[0_12px_25px_rgba(0,0,0,0.45)] transition-transform transition-colors duration-200 hover:bg-black/90 hover:scale-105 sm:left-6 sm:bottom-[calc(12vh+140px)]"
          >
            ?
          </button>

          {/* Challenge Friend Button */}
        <div 
            className={`w-48 sm:w-72 md:w-[280px] lg:w-[280px] xl:w-[320px] 2xl:w-[360px] h-10 sm:h-14 md:h-12 lg:h-12 xl:h-14 2xl:h-16 rounded-3xl flex items-center justify-center cursor-pointer transition-all duration-200 shadow-2xl border-2 active:scale-95 mb-2 sm:mb-4 mt-4 sm:mt-6 md:mt-0 fixed left-1/2 transform -translate-x-1/2 bottom-[21vh] z-20 sm:relative sm:left-auto sm:transform-none sm:bottom-auto md:fixed md:right-4 md:top-[12vh] md:transform-none md:bottom-auto lg:fixed lg:right-4 lg:top-[12vh] lg:transform-none lg:bottom-auto xl:fixed xl:right-4 xl:top-[12vh] xl:transform-none xl:bottom-auto 2xl:fixed 2xl:right-4 2xl:top-[12vh] 2xl:transform-none 2xl:bottom-auto 3xl:fixed 3xl:right-4 3xl:top-[12vh] 3xl:transform-none 3xl:bottom-auto ${
            showCopiedMessage 
              ? 'bg-white border-gray-300' 
              : 'bg-gradient-to-b from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 border-blue-400 hover:border-blue-300'
          }`}
          onClick={handleChallengeClick}>
            {showCopiedMessage ? (
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="font-pixelify font-bold text-black text-base tracking-[0] leading-[normal]">
                  Link copied!
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center w-full">
                <div className="relative overflow-hidden h-4 sm:h-5 lg:h-6 xl:h-7 2xl:h-8">
                  <div 
                    className="font-pixelify font-bold text-white text-sm sm:text-base lg:text-lg xl:text-xl 2xl:text-2xl tracking-[0] leading-[normal] transition-transform duration-500 ease-in-out text-center"
                    style={{ transform: `translateY(-${challengeTextIndex * (window.innerWidth < 640 ? 16 : window.innerWidth < 1024 ? 20 : window.innerWidth < 1280 ? 24 : 32)}px)` }}
                  >
                    {challengeTexts.map((text, index) => (
                      <div key={index} className="h-4 sm:h-5 lg:h-6 xl:h-7 2xl:h-8 flex items-center justify-center">
                        <span className="leading-none">{text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          </div>

          {/* Chat Button for iPad/Laptop - below challenge button */}
          <div 
            className="hidden sm:block fixed right-4 z-20"
            style={{
              top: isIPad ? 'calc(12vh + 60px)' : 'calc(12vh + 80px)', // Closer for iPad, normal for laptop
            }}
          >
            <div className="relative">
              <div 
                className="w-12 h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 xl:w-18 xl:h-18 2xl:w-20 2xl:h-20 bg-gray-600 rounded-lg flex items-center justify-center cursor-pointer hover:bg-gray-500 transition-colors shadow-lg border border-gray-500 relative"
                onClick={() => setShowChatTab(true)}
              >
                <div className="flex items-center justify-center w-full h-full">
                  <svg className="w-6 h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 xl:w-9 xl:h-9 2xl:w-10 2xl:h-10 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                  </svg>
                </div>
                
                {/* Red notification number for iPad/Laptop */}
                {unreadMessageCount > 0 && !showChatTab && (
                  <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-pixelify font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-white shadow-lg">
                    {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                  </div>
                )}
              </div>
              
              {/* Speech bubble notification for iPad/Laptop */}
              {newMessageNotification && !showChatTab && (
                <div className="absolute top-0 -left-[200px] bg-gray-800 text-white rounded-lg p-3 shadow-lg border border-gray-600 max-w-[180px] z-30 animate-pulse">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                    <span className="text-sm font-pixelify text-green-400 font-semibold">
                      {newMessageNotification.username}
                    </span>
                  </div>
                  <div className="text-sm font-pixelify text-white">
                    {newMessageNotification.text.length > 40 
                      ? `${newMessageNotification.text.substring(0, 40)}...` 
                      : newMessageNotification.text
                    }
                  </div>
                  {/* Speech bubble tail */}
                  <div className="absolute top-3 -right-2 w-0 h-0 border-t-4 border-b-4 border-l-4 border-transparent border-l-gray-800"></div>
                </div>
              )}
            </div>
          </div>

          {/* Share on story or dm message */}
          {showShareMessage && (
            <div className={`absolute top-[600px] sm:top-[740px] left-1/2 transform -translate-x-1/2 bg-black border-2 border-white rounded-lg px-3 sm:px-4 py-2 flex items-center z-50 transition-opacity duration-1000 ease-out ${
              isShareMessageFading ? 'opacity-0' : 'opacity-100'
            }`}>
              <span className="font-pixelify text-gray-300 text-xs sm:text-sm">Share on story or dm</span>
            </div>
          )}



          {/* Milestone Achievement Popup */}
          {showMilestonePopup && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
              <div className="relative w-full max-w-[320px] h-[70vh] max-h-[500px] md:max-h-[800px] lg:max-h-[900px] xl:max-h-[1000px] 2xl:max-h-[1100px] bg-black border-2 border-white rounded-lg overflow-hidden">
                {/* Close Button */}
                <button
                  onClick={handleMilestoneClose}
                  className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                {/* Content */}
                  <div className="flex flex-col items-center justify-center h-full p-4 sm:p-8 md:p-4 lg:p-6 xl:p-8 2xl:p-10 text-center pb-12 sm:pb-8 md:pb-4 lg:pb-6 xl:pb-8 2xl:pb-10">
                  {/* Message */}
                    <div className="mb-1 sm:mb-2 md:mb-1 lg:mb-1 xl:mb-2 2xl:mb-2">
                      <h2 className="font-pixelify font-bold text-white text-lg sm:text-2xl md:text-lg lg:text-xl xl:text-2xl 2xl:text-3xl mb-0 sm:mb-1 md:mb-0 lg:mb-0 xl:mb-1 2xl:mb-1">
                      {milestoneText}
                    </h2>
                    
                    {/* Next Goal */}
                      <div className="font-pixelify font-normal text-yellow-400 text-sm sm:text-lg md:text-sm lg:text-base xl:text-lg 2xl:text-xl text-center tracking-[0] leading-[normal]">
                      {showNextGoal && (
                        <span className="text-sm text-yellow-200">
                          Next Goal: {formatNumber(nextGoal.target)} points ({nextGoal.multiplier}x multiplier)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Scrolling Images */}
                  <div className="mb-0 sm:mb-1 md:mb-0 lg:mb-0 xl:mb-1 2xl:mb-1">
                    <div className="h-[250px] sm:h-[350px] md:h-[150px] lg:h-[180px] xl:h-[220px] 2xl:h-[250px] overflow-hidden flex items-center">
                      <div 
                        className="flex items-center"
                        style={{ animation: 'marquee 8s linear infinite', width: 'max-content' }}
                      >
                        <img src="/icons/1.jpeg" alt="Image 1" className="w-[150px] sm:w-[200px] md:w-[80px] lg:w-[100px] xl:w-[120px] 2xl:w-[140px] h-[230px] sm:h-[330px] md:h-[120px] lg:h-[150px] xl:h-[180px] 2xl:h-[210px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/2.png" alt="Image 2" className="w-[150px] sm:w-[200px] md:w-[80px] lg:w-[100px] xl:w-[120px] 2xl:w-[140px] h-[230px] sm:h-[330px] md:h-[120px] lg:h-[150px] xl:h-[180px] 2xl:h-[210px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/3.png" alt="Image 3" className="w-[150px] sm:w-[200px] md:w-[80px] lg:w-[100px] xl:w-[120px] 2xl:w-[140px] h-[230px] sm:h-[330px] md:h-[120px] lg:h-[150px] xl:h-[180px] 2xl:h-[210px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/4.png" alt="Image 4" className="w-[150px] sm:w-[200px] md:w-[80px] lg:w-[100px] xl:w-[120px] 2xl:w-[140px] h-[230px] sm:h-[330px] md:h-[120px] lg:h-[150px] xl:h-[180px] 2xl:h-[210px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-2 flex-shrink-0" draggable={false} />
                        {/* Duplicate for seamless loop */}
                        <img src="/icons/1.jpeg" alt="Image 1" className="w-[150px] sm:w-[200px] md:w-[80px] lg:w-[100px] xl:w-[120px] 2xl:w-[140px] h-[230px] sm:h-[330px] md:h-[120px] lg:h-[150px] xl:h-[180px] 2xl:h-[210px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/2.png" alt="Image 2" className="w-[150px] sm:w-[200px] md:w-[80px] lg:w-[100px] xl:w-[120px] 2xl:w-[140px] h-[230px] sm:h-[330px] md:h-[120px] lg:h-[150px] xl:h-[180px] 2xl:h-[210px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/3.png" alt="Image 3" className="w-[150px] sm:w-[200px] md:w-[80px] lg:w-[100px] xl:w-[120px] 2xl:w-[140px] h-[230px] sm:h-[330px] md:h-[120px] lg:h-[150px] xl:h-[180px] 2xl:h-[210px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/4.png" alt="Image 4" className="w-[150px] sm:w-[200px] md:w-[80px] lg:w-[100px] xl:w-[120px] 2xl:w-[140px] h-[230px] sm:h-[330px] md:h-[120px] lg:h-[150px] xl:h-[180px] 2xl:h-[210px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-2 flex-shrink-0" draggable={false} />
                      </div>
                    </div>
                  </div>

                  {/* Share Message */}
                  <p className="font-pixelify font-normal text-white text-sm sm:text-[16px] md:text-xs lg:text-xs xl:text-sm 2xl:text-base text-center tracking-[0] leading-[normal] mb-6 sm:mb-1 md:mb-0 lg:mb-0 xl:mb-0 2xl:mb-0">
                    Share your achievements with invitation link and screenshot
                  </p>

                  {/* Copy Link Button */}
                  <button
                    onClick={handleCopySchoolLink}
                    className={`w-[160px] sm:w-[200px] md:w-[120px] lg:w-[140px] xl:w-[160px] 2xl:w-[180px] h-[50px] sm:h-[40px] md:h-[28px] lg:h-[32px] xl:h-[36px] 2xl:h-[40px] ${isLinkCopied ? 'bg-white' : 'bg-green-500 hover:bg-green-600'} rounded-[21px] flex items-center justify-center mb-4 sm:mb-1 md:mb-0 lg:mb-0 xl:mb-1 2xl:mb-1 transition-colors relative z-10`}
                  >
                    <div className={`font-pixelify font-normal text-sm sm:text-[18px] md:text-xs lg:text-xs xl:text-sm 2xl:text-base text-center tracking-[0] leading-[normal] whitespace-nowrap ${isLinkCopied ? 'text-black' : 'text-white'}`}>
                      {isLinkCopied ? 'Link copied' : 'Copy invitation link'}
                    </div>
                  </button>

                  {/* Go Back Button */}
                  <button
                    onClick={handleMilestoneClose}
                    className="w-[160px] sm:w-[200px] md:w-[120px] lg:w-[140px] xl:w-[160px] 2xl:w-[180px] h-[50px] sm:h-[50px] md:h-[28px] lg:h-[32px] xl:h-[36px] 2xl:h-[40px] bg-[#97e6ff] rounded-[21px] flex items-center justify-center"
                  >
                    <div className="font-pixelify font-normal text-black text-lg sm:text-[22px] md:text-xs lg:text-sm xl:text-base 2xl:text-lg text-center tracking-[0] leading-[normal] whitespace-nowrap">
                      Go back
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mini Share Popup for Milestone */}
          {showSharePopup && showMilestonePopup && (
            <div className="fixed top-[calc(50%+180px)] sm:top-[calc(50%+240px)] left-1/2 transform -translate-x-1/2 z-[10000] pointer-events-none">
              <div className="bg-black border border-white rounded px-2 py-1">
                <div className="font-pixelify font-normal text-white text-xs text-center tracking-[0] leading-[normal]">
                  Share on story or dm
                </div>
              </div>
            </div>
          )}

          {/* Rank Up Popup */}
          {showRankUpPopup && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
              <div className="relative w-full max-w-[350px] h-[70vh] max-h-[500px] bg-black border-2 border-white rounded-lg overflow-hidden">
                {/* Celebration Background Decorations */}
                <div className="absolute inset-0 opacity-20">
                  <div className="absolute top-10 left-10 w-8 h-8 bg-yellow-400 rounded-full animate-ping"></div>
                  <div className="absolute top-20 right-12 w-6 h-6 bg-green-400 rounded-full animate-ping delay-500"></div>
                  <div className="absolute bottom-20 left-16 w-4 h-4 bg-blue-400 rounded-full animate-ping delay-1000"></div>
                  <div className="absolute bottom-32 right-8 w-5 h-5 bg-red-400 rounded-full animate-ping delay-700"></div>
                  <div className="absolute top-1/2 left-8 w-3 h-3 bg-purple-400 rounded-full animate-ping delay-300"></div>
                  <div className="absolute top-1/3 right-6 w-4 h-4 bg-pink-400 rounded-full animate-ping delay-1200"></div>
                </div>

                {/* Close Button */}
                <button
                  onClick={handleRankUpClose}
                  className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                {/* Content */}
                <div className="flex flex-col items-center justify-center h-full p-2 sm:p-4 text-center pb-16 sm:pb-8">
                  {/* Message */}
                  <div className="mb-2 sm:mb-3">
                    <h2 className="font-pixelify font-bold text-white text-base sm:text-lg mb-1 sm:mb-2">
                      {rankUpText}
                    </h2>
                  </div>

                  {/* Scrolling Images */}
                  <div className="mb-2 sm:mb-3">
                    <div className="h-[120px] sm:h-[180px] overflow-hidden flex items-center">
                      <div 
                        className="flex items-center"
                        style={{ animation: 'marquee 8s linear infinite', width: 'max-content' }}
                      >
                        <img src="/icons/1.jpeg" alt="Image 1" className="w-[100px] sm:w-[120px] h-[120px] sm:h-[150px] object-contain mx-1 sm:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/2.png" alt="Image 2" className="w-[100px] sm:w-[120px] h-[120px] sm:h-[150px] object-contain mx-1 sm:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/3.png" alt="Image 3" className="w-[100px] sm:w-[120px] h-[120px] sm:h-[150px] object-contain mx-1 sm:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/4.png" alt="Image 4" className="w-[100px] sm:w-[120px] h-[120px] sm:h-[150px] object-contain mx-1 sm:mx-2 flex-shrink-0" draggable={false} />
                        {/* Duplicate for seamless loop */}
                        <img src="/icons/1.jpeg" alt="Image 1" className="w-[100px] sm:w-[120px] h-[120px] sm:h-[150px] object-contain mx-1 sm:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/2.png" alt="Image 2" className="w-[100px] sm:w-[120px] h-[120px] sm:h-[150px] object-contain mx-1 sm:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/3.png" alt="Image 3" className="w-[100px] sm:w-[120px] h-[120px] sm:h-[150px] object-contain mx-1 sm:mx-2 flex-shrink-0" draggable={false} />
                        <img src="/icons/4.png" alt="Image 4" className="w-[100px] sm:w-[120px] h-[120px] sm:h-[150px] object-contain mx-1 sm:mx-2 flex-shrink-0" draggable={false} />
                      </div>
                    </div>
                  </div>

                  {/* Share Message */}
                  <p className="font-pixelify font-normal text-white text-sm sm:text-[16px] text-center tracking-[0] leading-[normal] mb-3 sm:mb-4">
                    Share your achievements with invitation link and screenshot
                  </p>

                  {/* Don't Show Again Checkbox */}
                  <div className="flex items-center justify-center mb-8 sm:mb-4 relative z-10">
                    <div
                      onClick={handleDontShowRankUpToday}
                      className="flex items-center gap-2 text-white hover:text-gray-300 transition-colors cursor-pointer relative z-10"
                    >
                      <div className={`w-4 h-4 border-2 border-white rounded flex items-center justify-center ${checkboxChecked ? 'bg-white' : 'bg-transparent'}`}>
                        {checkboxChecked && (
                          <svg className="w-3 h-3 text-black" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
                      <span className="font-pixelify font-normal text-xs sm:text-[14px]">
                        Don't show this again today
                      </span>
          </div>
        </div>

                  {/* Copy Link Button */}
                  <button
                    onClick={handleCopySchoolLink}
                    className={`w-[160px] sm:w-[200px] h-[35px] sm:h-[40px] ${isLinkCopied ? 'bg-white' : 'bg-green-500 hover:bg-green-600'} rounded-[21px] flex items-center justify-center mb-4 sm:mb-3 transition-colors relative z-10`}
                  >
                    <div className={`font-pixelify font-normal text-sm sm:text-[18px] text-center tracking-[0] leading-[normal] whitespace-nowrap ${isLinkCopied ? 'text-black' : 'text-white'}`}>
                      {isLinkCopied ? 'Link copied' : 'Copy invitation link'}
            </div>
                  </button>

                  {/* Go Back Button */}
                  <button
                    onClick={handleRankUpClose}
                    className="w-[160px] sm:w-[200px] h-[35px] sm:h-[40px] bg-[#97e6ff] rounded-[21px] flex items-center justify-center relative z-10 mt-2 sm:mt-0"
                  >
                    <div className="font-pixelify font-normal text-black text-sm sm:text-[18px] text-center tracking-[0] leading-[normal] whitespace-nowrap">
                      Go back
            </div>
                  </button>
        </div>
              </div>
            </div>
          )}

        {/* Mini Share Popup */}
        {showSharePopup && (
          <div className="fixed top-[calc(50%+180px)] sm:top-[calc(50%+240px)] left-1/2 transform -translate-x-1/2 z-[10000] pointer-events-none">
            <div className="bg-black border border-white rounded px-2 py-1">
              <div className="font-pixelify font-normal text-white text-xs text-center tracking-[0] leading-[normal]">
                Share on story or dm
          </div>
          </div>
          </div>
        )}

        </div>

      {/* Desktop: School Ranking Info - Fixed at top of bottom bar */}
      <div className="hidden md:block fixed left-0 right-0 bg-white border-b-4 border-solid border-[#5d5d5d] py-2 px-4 lg:py-3 lg:px-6 xl:py-4 xl:px-8 z-10 shadow-lg" style={{ bottom: '12vh' }}>
        <div className="max-w-[600px] lg:max-w-[700px] xl:max-w-[800px] 2xl:max-w-[900px] mx-auto">
          <div className="flex items-center justify-between gap-16 lg:gap-20 xl:gap-24 2xl:gap-28">
            {/* Left Section - Trophy and Rank */}
            <div className="flex items-center gap-6 lg:gap-8 xl:gap-10 flex-1 min-w-0">
              <img
                className="w-8 h-8 lg:w-10 lg:h-10 xl:w-12 xl:h-12 flex-shrink-0"
                alt="Trophy"
                src="/icons/trophy.svg"
                draggable={false}
              />
              <div className="text-black text-2xl lg:text-3xl xl:text-4xl whitespace-nowrap font-pixelify font-bold tracking-[0] leading-[normal]">
                #{currentRank}
              </div>
              <div className={`font-pixelify font-normal text-black tracking-[0] leading-[normal] whitespace-nowrap min-w-0 ${
                schoolDisplayName.length > 25 ? 'text-sm lg:text-base xl:text-lg' : 
                schoolDisplayName.length > 20 ? 'text-base lg:text-lg xl:text-xl' : 
                schoolDisplayName.length > 15 ? 'text-lg lg:text-xl xl:text-2xl' : 
                'text-lg lg:text-xl xl:text-2xl'
              }`}>
                <div className="flex items-center gap-2">
                  {schoolDisplayName}
                  <div className="flex items-center gap-1 bg-green-400/10 rounded-md px-2 py-1 border border-green-400/20">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-sm shadow-green-400/50"></div>
                    <span className="font-pixelify text-green-400 text-sm lg:text-base font-bold animate-pulse transition-all duration-300">
                      {isOnlineLoading ? (
                        <div className="flex items-center gap-1">
                          <div className="w-1 h-1 bg-green-400 rounded-full animate-bounce"></div>
                          <div className="w-1 h-1 bg-green-400 rounded-full animate-bounce delay-100"></div>
                          <div className="w-1 h-1 bg-green-400 rounded-full animate-bounce delay-200"></div>
                        </div>
                      ) : (
                        `${totalOnline} online`
                      )}
                    </span>
                  </div>
                </div>
                <div className="text-black text-sm lg:text-base font-pixelify font-normal tracking-[0] leading-[normal] opacity-70">
                  #{regionRank} in {schoolRegion}
                </div>
              </div>
            </div>

            {/* Right Section - Score and Progress */}
            <div className="flex flex-col items-end flex-shrink-0">
              <div className={`font-pixelify font-bold text-3xl lg:text-4xl xl:text-5xl tracking-[0] leading-[normal] text-center transition-all duration-300 ${isScoreAnimating ? 'scale-110 text-yellow-300' : ''} text-[#006aff]`}>
                {formatNumber(schoolScore)}
              </div>
              <div className="opacity-[0.63] font-pixelify font-normal text-black text-base lg:text-lg xl:text-xl tracking-[0] leading-[normal] text-center flex items-center justify-center">
                {currentRank === 1 
                  ? `${formatNumber(calculateScoreDifference(schoolDisplayName, schoolScore, 2))}+ ahead of #2`
                  : `${formatNumber(calculateScoreDifference(schoolDisplayName, schoolScore, currentRank - 1))}+ til #${currentRank - 1}`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: School Ranking Info - Fixed at top of bottom bar */}
      <div className="md:hidden fixed left-0 right-0 bg-white border-b-4 border-solid border-[#5d5d5d] p-2 z-10 shadow-lg" style={{ bottom: 'calc(12vh + env(safe-area-inset-bottom))' }}>
        <div className="flex items-center h-full">
          {/* Left Section - Trophy, Rank and School */}
          <div className="flex items-center flex-1 min-w-0 pr-2">
            <img
              className="w-4 h-4 flex-shrink-0"
              alt="Trophy"
              src="/icons/trophy.svg"
              draggable={false}
            />
            
            {/* Vertical Separator 1 */}
            <div className="w-px h-5 bg-gray-300 mx-1"></div>
            
            <div className="text-black text-sm font-pixelify font-bold tracking-[0] leading-[normal]">
              #{currentRank}
            </div>
            
            {/* Vertical Separator 2 */}
            <div className="w-px h-5 bg-gray-300 mx-1"></div>
            
            <div className={`font-pixelify font-normal text-black tracking-[0] leading-[normal] flex-1 min-w-0 ${
              schoolDisplayName.length > 20 ? 'text-[10px]' : 
              schoolDisplayName.length > 15 ? 'text-xs' : 
              'text-sm'
            }`}>
              <div className="flex items-center gap-1 whitespace-nowrap">
                {schoolDisplayName}
                <div className="flex items-center gap-1 bg-green-400/10 rounded px-1.5 py-0.5 border border-green-400/20">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse shadow-sm shadow-green-400/50"></div>
                  <span className="font-pixelify text-green-400 text-[10px] font-bold animate-pulse transition-all duration-300">
                    {isOnlineLoading ? (
                      <div className="flex items-center gap-0.5">
                        <div className="w-0.5 h-0.5 bg-green-400 rounded-full animate-bounce"></div>
                        <div className="w-0.5 h-0.5 bg-green-400 rounded-full animate-bounce delay-100"></div>
                        <div className="w-0.5 h-0.5 bg-green-400 rounded-full animate-bounce delay-200"></div>
                      </div>
                    ) : (
                      `${totalOnline} online`
                    )}
                  </span>
                </div>
              </div>
              <div className="text-black text-[10px] font-pixelify font-normal tracking-[0] leading-[normal] opacity-70">
                #{regionRank} in {schoolRegion}
              </div>
            </div>
          </div>

          {/* Right Section - Score and Progress */}
          <div className="flex items-center flex-shrink-0">
            <div className="flex flex-col items-center">
              <div className={`font-pixelify font-bold text-lg tracking-[0] leading-[normal] transition-all duration-300 ${isScoreAnimating ? 'scale-110 text-yellow-300' : ''} text-[#006aff]`}>
                {formatNumber(schoolScore)}
              </div>
              <div className="opacity-70 font-pixelify font-normal text-black text-[10px] tracking-[0] leading-[normal] text-center flex items-center justify-center">
                {currentRank === 1 
                  ? `${formatNumber(calculateScoreDifference(schoolDisplayName, schoolScore, 2))}+ ahead of #2`
                  : `${formatNumber(calculateScoreDifference(schoolDisplayName, schoolScore, currentRank - 1))}+ til #${currentRank - 1}`}
              </div>
            </div>
          </div>
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

      {/* Challenge Tab Overlay - Outside main container */}
      {showChallengePage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
          <div className="relative w-full max-w-[320px] md:max-w-[500px] lg:max-w-[600px] xl:max-w-[700px] 2xl:max-w-[800px] h-[70vh] max-h-[500px] md:max-h-[700px] lg:max-h-[800px] xl:max-h-[900px] 2xl:max-h-[1000px] bg-black border-2 border-white rounded-lg overflow-hidden">
            {/* Close Button */}
            <button
              onClick={handleChallengeClose}
              className="absolute top-2 right-2 w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-600 transition-colors z-10"
            >
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {/* Main Content */}
            <div className="flex flex-col items-center justify-center h-full px-2 sm:px-4 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-4 sm:py-8 md:py-10 lg:py-12 xl:py-14 2xl:py-16">
              {/* Main Message */}
              <div className="font-pixelify font-normal text-white text-2xl sm:text-[36px] md:text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl text-center tracking-[0] leading-[normal] mb-1 md:mb-1 lg:mb-2">
                Invitation Link Copied.
                </div>
              
              {/* Sub Message */}
              <div className="font-pixelify font-normal text-white text-sm sm:text-[18px] md:text-base lg:text-lg xl:text-xl 2xl:text-2xl text-center tracking-[0] leading-[normal] mb-1 sm:mb-2 md:mb-2 lg:mb-3">
                Share to your friends with screenshot
                  </div>

              {/* Scrolling Images */}
              <div className="w-full h-[250px] sm:h-[350px] md:h-[500px] lg:h-[550px] xl:h-[600px] 2xl:h-[650px] overflow-hidden mb-2 sm:mb-3 md:mb-4 lg:mb-5 flex items-center">
                <div 
                  className="flex items-center" 
                  style={{ 
                    animation: 'marquee 8s linear infinite',
                    width: 'max-content',
                    willChange: 'transform',
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'translateZ(0)',
                    WebkitTransform: 'translateZ(0)'
                  } as React.CSSProperties}
                >
                  <img src="/icons/1.jpeg" alt="Image 1" className="w-[150px] sm:w-[200px] md:w-[100px] lg:w-[120px] xl:w-[140px] 2xl:w-[160px] h-[230px] sm:h-[330px] md:h-[180px] lg:h-[220px] xl:h-[260px] 2xl:h-[300px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-3 flex-shrink-0" draggable={false} />
                  <img src="/icons/2.png" alt="Image 2" className="w-[150px] sm:w-[200px] md:w-[100px] lg:w-[120px] xl:w-[140px] 2xl:w-[160px] h-[230px] sm:h-[330px] md:h-[180px] lg:h-[220px] xl:h-[260px] 2xl:h-[300px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-3 flex-shrink-0" draggable={false} />
                  <img src="/icons/3.png" alt="Image 3" className="w-[150px] sm:w-[200px] md:w-[100px] lg:w-[120px] xl:w-[140px] 2xl:w-[160px] h-[230px] sm:h-[330px] md:h-[180px] lg:h-[220px] xl:h-[260px] 2xl:h-[300px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-3 flex-shrink-0" draggable={false} />
                  <img src="/icons/4.png" alt="Image 4" className="w-[150px] sm:w-[200px] md:w-[100px] lg:w-[120px] xl:w-[140px] 2xl:w-[160px] h-[230px] sm:h-[330px] md:h-[180px] lg:h-[220px] xl:h-[260px] 2xl:h-[300px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-3 flex-shrink-0" draggable={false} />
                  {/* Duplicate for seamless loop */}
                  <img src="/icons/1.jpeg" alt="Image 1" className="w-[150px] sm:w-[200px] md:w-[100px] lg:w-[120px] xl:w-[140px] 2xl:w-[160px] h-[230px] sm:h-[330px] md:h-[180px] lg:h-[220px] xl:h-[260px] 2xl:h-[300px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-3 flex-shrink-0" draggable={false} />
                  <img src="/icons/2.png" alt="Image 2" className="w-[150px] sm:w-[200px] md:w-[100px] lg:w-[120px] xl:w-[140px] 2xl:w-[160px] h-[230px] sm:h-[330px] md:h-[180px] lg:h-[220px] xl:h-[260px] 2xl:h-[300px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-3 flex-shrink-0" draggable={false} />
                  <img src="/icons/3.png" alt="Image 3" className="w-[150px] sm:w-[200px] md:w-[100px] lg:w-[120px] xl:w-[140px] 2xl:w-[160px] h-[230px] sm:h-[330px] md:h-[180px] lg:h-[220px] xl:h-[260px] 2xl:h-[300px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-3 flex-shrink-0" draggable={false} />
                  <img src="/icons/4.png" alt="Image 4" className="w-[150px] sm:w-[200px] md:w-[100px] lg:w-[120px] xl:w-[140px] 2xl:w-[160px] h-[230px] sm:h-[330px] md:h-[180px] lg:h-[220px] xl:h-[260px] 2xl:h-[300px] object-contain mx-1 sm:mx-2 md:mx-1 lg:mx-1 xl:mx-2 2xl:mx-3 flex-shrink-0" draggable={false} />
      </div>
    </div>

              {/* Call to Action Text */}
              <p className="font-pixelify font-normal text-white text-sm sm:text-[18px] md:text-sm lg:text-base xl:text-lg 2xl:text-xl text-center tracking-[0] leading-[normal] mb-6 sm:mb-8 md:mb-2 lg:mb-3 animate-pulse whitespace-pre-line">
                {challengeModalMessages[challengeModalTextIndex]}
              </p>

              {/* Go Back Button */}
              <button
                onClick={handleChallengeClose}
                className="w-[160px] sm:w-[200px] md:w-[180px] lg:w-[200px] xl:w-[220px] 2xl:w-[240px] h-[40px] sm:h-[50px] md:h-[45px] lg:h-[50px] xl:h-[55px] 2xl:h-[60px] bg-[#97e6ff] rounded-[21px] flex items-center justify-center"
              >
                <div className="font-pixelify font-normal text-black text-lg sm:text-[22px] md:text-lg lg:text-xl xl:text-2xl 2xl:text-3xl text-center tracking-[0] leading-[normal] whitespace-nowrap">
                  Go back
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Tab Modal - Roblox Style */}
      {showChatTab && (
          <div 
            className="bg-gray-800 rounded-lg flex flex-col shadow-2xl cursor-move select-none z-50 border border-gray-600 hover:shadow-3xl transition-shadow duration-200 relative"
            style={{
              position: 'fixed',
              left: chatPosition.x,
              top: chatPosition.y,
              width: chatSize.width,
              height: chatSize.height,
            }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          >
            {/* Chat Header - Roblox Style */}
            <div className="chat-header bg-gray-800 text-white p-2 sm:p-4 rounded-t-lg flex items-center justify-between border-b border-gray-600 cursor-move hover:bg-gray-750 transition-colors">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-gray-600 rounded-lg flex items-center justify-center">
                  <svg className="w-3 h-3 sm:w-5 sm:h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                  </svg>
                </div>
                 <div className="flex flex-col gap-1">
                   <p className="font-pixelify text-xs text-gray-300">Welcome to {schoolDisplayName} chat</p>
                 </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Drag handle indicator */}
                <div className="flex flex-col gap-1">
                  <div className="flex gap-1">
                    <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                    <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                  </div>
                  <div className="flex gap-1">
                    <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                    <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                  </div>
                </div>
                <button
                  onClick={() => setShowChatTab(false)}
                  className="w-6 h-6 sm:w-8 sm:h-8 bg-gray-600 rounded-lg flex items-center justify-center hover:bg-gray-500 transition-colors"
                >
                  <svg className="w-3 h-3 sm:w-4 sm:h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
            
            {/* Chat Messages Area - Roblox Style */}
              <div className="flex-1 overflow-y-auto bg-gray-800 relative">
                {/* Sticky 24-hour reminder */}
                <div className="sticky top-0 z-20 mb-2 pb-2 bg-gray-800 px-2 sm:px-4 pt-2 sm:pt-4">
                  <div className="flex items-center justify-center py-0.5">
                    <div className="bg-gray-700 rounded-lg px-3 py-2 shadow-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                        <span className="text-yellow-400 font-pixelify text-xs font-semibold">
                          ⏰ Message is anonymous and deleted after 24 hrs
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Fade effect below the banner */}
                  <div className="absolute top-full left-0 right-0 h-4 bg-gradient-to-b from-gray-800 to-transparent pointer-events-none z-10"></div>
                </div>
                <div className="space-y-1 sm:space-y-2 px-2 sm:px-4 pb-2 sm:pb-4">
                
                {/* Welcome message */}
                <div className="text-left">
                  <span className="text-pink-400 font-pixelify text-xs sm:text-sm font-semibold">System: </span>
                  <span className="text-white font-pixelify text-xs sm:text-sm">Welcome to {schoolDisplayName} chat! You're {anonymousUsername}</span>
                </div>
                
                {/* Real messages from Firebase */}
                {messages.map((message) => (
                  <div key={message.id} className="text-left">
                    <span className={`${getUsernameColor(message.username)} font-pixelify text-xs sm:text-sm font-semibold`}>
                      {message.username}
                      {message.username === anonymousUsername && (
                        <span className="text-gray-400 font-pixelify text-xs sm:text-sm font-normal ml-1">
                          (You)
                        </span>
                      )}
                      : 
                    </span>
                    <span className="text-white font-pixelify text-xs sm:text-sm ml-1">
                      {message.text}
                    </span>
                  </div>
                ))}
                
                {/* Loading indicator */}
                {isSending && (
                  <div className="text-left">
                    <span className="text-gray-400 font-pixelify text-xs sm:text-sm">Sending...</span>
                  </div>
                )}
                
                {/* Invisible element to scroll to */}
                <div ref={messagesEndRef} />
              </div>
            </div>
            
            {/* Chat Input Area - Roblox Style */}
            <div className="p-2 sm:p-4 bg-gray-800 border-t border-gray-600">
              <div className="flex items-center gap-1 sm:gap-2">
                <input
                  type="text"
                  placeholder="To chat click here or press / key"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={isSending}
                  className="flex-1 p-2 sm:p-3 bg-gray-700 text-white rounded-lg font-pixelify text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-600 placeholder-gray-400 disabled:opacity-50"
                />
                <button 
                  onClick={sendMessage}
                  disabled={isSending || !newMessage.trim()}
                  className="bg-gray-700 text-white p-2 sm:p-3 rounded-lg font-pixelify text-xs sm:text-sm hover:bg-gray-600 transition-colors border border-gray-600 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending ? (
                    <div className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-3 h-3 sm:w-4 sm:h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Resize Handles */}
            {/* Corner handles */}
            <div
              className="absolute -bottom-1 -right-1 w-3 h-3 bg-gray-600 rounded-br-lg cursor-se-resize hover:bg-gray-500"
              onMouseDown={(e) => handleResizeStart(e, 'bottom-right')}
              onTouchStart={(e) => handleResizeStartTouch(e, 'bottom-right')}
            />
            <div
              className="absolute -bottom-1 -left-1 w-3 h-3 bg-gray-600 rounded-bl-lg cursor-sw-resize hover:bg-gray-500"
              onMouseDown={(e) => handleResizeStart(e, 'bottom-left')}
              onTouchStart={(e) => handleResizeStartTouch(e, 'bottom-left')}
            />
            <div
              className="absolute -top-1 -right-1 w-3 h-3 bg-gray-600 rounded-tr-lg cursor-ne-resize hover:bg-gray-500"
              onMouseDown={(e) => handleResizeStart(e, 'top-right')}
              onTouchStart={(e) => handleResizeStartTouch(e, 'top-right')}
            />
            <div
              className="absolute -top-1 -left-1 w-3 h-3 bg-gray-600 rounded-tl-lg cursor-nw-resize hover:bg-gray-500"
              onMouseDown={(e) => handleResizeStart(e, 'top-left')}
              onTouchStart={(e) => handleResizeStartTouch(e, 'top-left')}
            />

            {/* Edge handles */}
            <div
              className="absolute -right-1 top-1/2 transform -translate-y-1/2 w-1 h-8 bg-gray-600 cursor-e-resize hover:bg-gray-500"
              onMouseDown={(e) => handleResizeStart(e, 'right')}
              onTouchStart={(e) => handleResizeStartTouch(e, 'right')}
            />
            <div
              className="absolute -left-1 top-1/2 transform -translate-y-1/2 w-1 h-8 bg-gray-600 cursor-w-resize hover:bg-gray-500"
              onMouseDown={(e) => handleResizeStart(e, 'left')}
              onTouchStart={(e) => handleResizeStartTouch(e, 'left')}
            />
            <div
              className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-8 h-1 bg-gray-600 cursor-s-resize hover:bg-gray-500"
              onMouseDown={(e) => handleResizeStart(e, 'bottom')}
              onTouchStart={(e) => handleResizeStartTouch(e, 'bottom')}
            />
            <div
              className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-8 h-1 bg-gray-600 cursor-n-resize hover:bg-gray-500"
              onMouseDown={(e) => handleResizeStart(e, 'top')}
              onTouchStart={(e) => handleResizeStartTouch(e, 'top')}
            />
          </div>
      )}
    </>
  );
};
