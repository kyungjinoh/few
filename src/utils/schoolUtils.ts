/**
 * Converts a school name to a URL-friendly slug
 * @param schoolName - The school name to convert
 * @returns A URL-friendly slug (e.g., "Stanford University" -> "stanforduniversity")
 */
export const schoolNameToSlug = (schoolName: string): string => {
  if (!schoolName) return '';
  return schoolName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, ''); // Remove spaces
};

/**
 * Finds a school name from Firebase data that matches the given slug
 * @param slug - The URL slug to match
 * @param firebaseSchools - Array of schools from Firebase
 * @returns The matching school name from Firebase, or null if not found
 */
export const findSchoolBySlug = (slug: string, firebaseSchools: any[]): string | null => {
  if (!slug || !firebaseSchools || firebaseSchools.length === 0) {
    return null;
  }

  const normalizedSlug = slug.toLowerCase();

  // Try to find a school where the generated slug matches the input slug
  for (const school of firebaseSchools) {
    if (school.schoolName) {
      const generatedSlug = schoolNameToSlug(school.schoolName);
      if (generatedSlug === normalizedSlug) {
        return school.schoolName;
      }
    }
  }

  return null;
};

/**
 * Converts a URL slug back to a readable school name using Firebase data
 * @param slug - The URL slug to convert
 * @param firebaseSchools - Array of schools from Firebase (optional, for dynamic lookup)
 * @returns A readable school name or fallback title case conversion
 */
export const slugToSchoolName = (slug: string, firebaseSchools?: any[]): string => {
  // If Firebase schools are provided, try dynamic lookup first
  if (firebaseSchools) {
    const matchedSchool = findSchoolBySlug(slug, firebaseSchools);
    if (matchedSchool) {
      return matchedSchool;
    }
  }

  // Fallback to title case conversion for backwards compatibility
  let result = slug.toLowerCase();
  
  // Handle common patterns
  result = result.replace(/university$/, ' University');
  result = result.replace(/college$/, ' College');
  result = result.replace(/institute$/, ' Institute');
  result = result.replace(/tech$/, ' Tech');
  result = result.replace(/hs$/, ' HS');
  
  // Handle common prefixes
  result = result.replace(/^uc/, 'UC ');
  result = result.replace(/^mit$/, 'MIT');
  result = result.replace(/^caltech$/, 'Caltech');
  
  // Convert to title case
  return result
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Generate all valid URL slugs for schools in Firebase database
 * @param firebaseSchools - Array of schools from Firebase
 * @returns Array of {schoolName, slug} objects
 */
export const generateAllValidSlugs = (firebaseSchools: any[]) => {
  return firebaseSchools.map(school => ({
    schoolName: school.schoolName,
    slug: schoolNameToSlug(school.schoolName),
    url: `/${schoolNameToSlug(school.schoolName)}`
  }));
};
