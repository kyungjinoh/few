import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { School } from '../firebase/schoolService';

interface SchoolDataContextType {
  schools: School[];
  loading: boolean;
  error: string | null;
  refreshData: () => Promise<void>;
}

const SchoolDataContext = createContext<SchoolDataContextType | undefined>(undefined);

interface SchoolDataProviderProps {
  children: ReactNode;
}

export const SchoolDataProvider: React.FC<SchoolDataProviderProps> = ({ children }) => {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStaticSchoolData = async () => {
    try {
      // First try to load from localStorage (cached data from loading page)
      const cachedData = localStorage.getItem('staticSchoolData');
      if (cachedData) {
        const parsedSchools = JSON.parse(cachedData);
        console.log('📊 [SCHOOL DATA CONTEXT] Using cached school data:', parsedSchools.length, 'schools');
        setSchools(parsedSchools);
        setLoading(false);
        setError(null);
        return;
      }

      // If no cached data, wait for LoadingPage to populate it
      console.log('⚠️ [SCHOOL DATA CONTEXT] No cached data found - LoadingPage should have populated this');
      setError('School data not loaded properly from LoadingPage');
      setLoading(false);
    } catch (err) {
      console.error('❌ [SCHOOL DATA CONTEXT] Error loading school data:', err);
      setError('Failed to load school data');
      setLoading(false);
    }
  };

  const refreshData = async () => {
    console.log('🔄 [SCHOOL DATA CONTEXT] Clearing cached data - LoadingPage will repopulate');
    // Clear cached data - user will need to refresh page to reload from LoadingPage
    localStorage.removeItem('staticSchoolData');
    setSchools([]);
    setLoading(true);
    setError('Please refresh the page to reload school data');
  };

  useEffect(() => {
    console.log('🔄 [SCHOOL DATA CONTEXT] Loading static school data from localStorage or Firebase');
    loadStaticSchoolData();
  }, []);

  const value: SchoolDataContextType = {
    schools,
    loading,
    error,
    refreshData
  };

  return (
    <SchoolDataContext.Provider value={value}>
      {children}
    </SchoolDataContext.Provider>
  );
};

export const useSchoolData = (): SchoolDataContextType => {
  const context = useContext(SchoolDataContext);
  if (context === undefined) {
    throw new Error('useSchoolData must be used within a SchoolDataProvider');
  }
  return context;
};
