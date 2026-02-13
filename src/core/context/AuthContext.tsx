import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import messaging from '@react-native-firebase/messaging';

// Define the complete user profile interface
interface UserProfile {
  uid: string;
  name: string;
  email: string;
  profile_image?: string;
  online?: boolean;
  fcmToken?: string;
}

interface AuthContextType {
  user: import('firebase/auth').User | null;
  userProfile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<import('firebase/auth').User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const auth = getAuth();

  // Save FCM token to user profile
  const saveTokenToUserProfile = async (userId: string, token: string) => {
    try {
      await firestore()
        .collection('users')
        .doc(userId)
        .set(
          { fcmToken: token },
          { merge: true }
        );
      console.log('FCM token saved to user profile');
    } catch (error) {
      console.error('Error saving FCM token:', error);
    }
  };

  // Main auth effect
  useEffect(() => {
    let isMounted = true;
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) return;
      
      setUser(firebaseUser);
      
      if (firebaseUser) {
        // Initialize notifications for authenticated user
        try {
          // Request notification permissions
          const authStatus = await messaging().requestPermission();
          const enabled =
            authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
            authStatus === messaging.AuthorizationStatus.PROVISIONAL;
          
          if (enabled) {
            // Get FCM token
            const fcmToken = await messaging().getToken();
            
            if (fcmToken && isMounted) {
              // Save token to user profile
              await saveTokenToUserProfile(firebaseUser.uid, fcmToken);
            }
          }
        } catch (error) {
          console.error('Error initializing notifications:', error);
        }
        
        try {
          // Fetch user profile from Firestore
          const userDoc = await firestore().collection('users').doc(firebaseUser.uid).get();
          
          if (!isMounted) return;
          
          if (userDoc.exists) {
            const userData = userDoc.data();
            setUserProfile({
              uid: firebaseUser.uid,
              name: userData?.name || firebaseUser.displayName || 'User',
              email: userData?.email || firebaseUser.email || '',
              profile_image: userData?.profile_image || firebaseUser.photoURL || '',
              online: true,
              fcmToken: userData?.fcmToken,
            });
          } else {
            // If user document doesn't exist, create minimal profile
            setUserProfile({
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || 'User',
              email: firebaseUser.email || '',
              profile_image: firebaseUser.photoURL || '',
              online: true,
            });
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
          if (isMounted) {
            // Fallback to basic Firebase user data
            setUserProfile({
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || 'User',
              email: firebaseUser.email || '',
              profile_image: firebaseUser.photoURL || '',
              online: true,
            });
          }
        }
      } else {
        if (isMounted) {
          setUserProfile(null);
        }
      }
      
      if (isMounted) {
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, userProfile, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};