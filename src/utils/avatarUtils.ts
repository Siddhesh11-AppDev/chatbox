import { Colors } from '../theme/Colors';

// Color palette for avatar backgrounds
const AVATAR_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Purple
  '#98D8C8', // Mint
  '#F7DC6F', // Gold
  '#BB8FCE', // Lavender
  '#85C1E9', // Sky Blue
  '#F8C471', // Orange
  '#82E0AA', // Light Green
];

/**
 * Generate a color based on the first letter of the name
 * @param name - User's name
 * @returns Hex color string
 */
export const getAvatarColor = (name: string | null | undefined): string => {
  if (!name || name.trim() === '') {
    return AVATAR_COLORS[0]; // Default color for empty names
  }
  
  const firstLetter = name.trim().charAt(0).toUpperCase();
  const charCode = firstLetter.charCodeAt(0);
  const colorIndex = charCode % AVATAR_COLORS.length;
  return AVATAR_COLORS[colorIndex];
};

/**
 * Generate an SVG avatar as data URL
 * @param name - User's name
 * @param size - Avatar size in pixels
 * @returns Data URL string for the SVG
 */
export const generateAvatarSvg = (name: string | null | undefined, size: number = 100): string => {
  const displayName = name && name.trim() !== '' ? name.trim() : '?';
  const firstLetter = displayName.charAt(0).toUpperCase();
  const backgroundColor = getAvatarColor(name);
  const textColor = '#FFFFFF';
  
  const svgContent = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${backgroundColor}" rx="${size / 2}"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.4}" 
            fill="${textColor}" text-anchor="middle" dominant-baseline="middle" font-weight="bold">
        ${firstLetter}
      </text>
    </svg>
  `;
  
  // Convert to base64 manually
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  
  while (i < svgContent.length) {
    const byte1 = svgContent.charCodeAt(i++);
    const byte2 = i < svgContent.length ? svgContent.charCodeAt(i++) : 0;
    const byte3 = i < svgContent.length ? svgContent.charCodeAt(i++) : 0;
    
    const enc1 = byte1 >> 2;
    const enc2 = ((byte1 & 3) << 4) | (byte2 >> 4);
    let enc3 = ((byte2 & 15) << 2) | (byte3 >> 6);
    let enc4 = byte3 & 63;
    
    if (i - 2 >= svgContent.length) {
      enc3 = 64;
      enc4 = 64;
    } else if (i - 1 >= svgContent.length) {
      enc4 = 64;
    }
    
    result += base64Chars.charAt(enc1) + base64Chars.charAt(enc2) + 
              base64Chars.charAt(enc3) + base64Chars.charAt(enc4);
  }
  
  return `data:image/svg+xml;base64,${result}`;
};

/**
 * Get user avatar - returns photoURL if available, otherwise generates avatar
 * @param user - User object with displayName/photoURL or name/profile_image properties
 * @returns Avatar URL string
 */
export const getUserAvatar = (user: { 
  displayName?: string | null; 
  photoURL?: string | null;
  name?: string | null;
  profile_image?: string | null;
} | null): string => {
  if (!user) {
    return generateAvatarSvg('?', 100);
  }
  
  // If user has uploaded a photo, use it (check both property names)
  const photoURL = user.photoURL || user.profile_image;
  if (photoURL) {
    return photoURL;
  }
  
  // Otherwise generate avatar based on display name (check both property names)
  const displayName = user.displayName || user.name;
  return generateAvatarSvg(displayName, 100);
};
