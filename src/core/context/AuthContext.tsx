import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { notificationService } from '../services/notification.service';

// Define the complete user profile interface
interface UserProfile {
  uid: string;
  name: string;
  email: string;
  profile_image?: string;
  online?: boolean;
  // Add other fields as needed
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (firebaseUser) {
        // Initialize notifications for authenticated user
        try {
          // Request notification permissions
          const permissionGranted = await notificationService.requestPermission();
          
          if (permissionGranted) {
            // Get FCM token
            const fcmToken = await notificationService.getToken();
            
            if (fcmToken) {
              // Save token to user profile
              await notificationService.saveTokenToUserProfile(firebaseUser.uid, fcmToken);
            }
          }
        } catch (error) {
          console.error('Error initializing notifications:', error);
        }
        try {
          // Fetch user profile from Firestore
          const userDoc = await firestore().collection('users').doc(firebaseUser.uid).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            setUserProfile({
              uid: firebaseUser.uid,
              name: userData?.name || firebaseUser.displayName || 'User',
              email: userData?.email || firebaseUser.email || '',
              profile_image: userData?.profile_image || firebaseUser.photoURL || '',
              online: userData?.online || false,
            });
          } else {
            // If user document doesn't exist, create minimal profile
            setUserProfile({
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || 'User',
              email: firebaseUser.email || '',
              profile_image: firebaseUser.photoURL || '',
              online: false,
            });
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
          // Fallback to basic Firebase user data
          setUserProfile({
            uid: firebaseUser.uid,
            name: firebaseUser.displayName || 'User',
            email: firebaseUser.email || '',
            profile_image: firebaseUser.photoURL || '',
            online: false,
          });
        }
      } else {
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Handle foreground messages
  useEffect(() => {
    const unsubscribe = notificationService.onForegroundMessage(remoteMessage => {
      console.log('Foreground message received:', remoteMessage);
      // Handle incoming message - show in-app notification, update UI, etc.
      // You can use react-native-toast-message or custom notification component
    });

    return unsubscribe;
  }, []);

  // Handle background messages
  useEffect(() => {
    notificationService.onBackgroundMessage(async remoteMessage => {
      console.log('Background message received:', remoteMessage);
      // Handle background message processing
      // This runs when app is in background/killed
      return Promise.resolve();
    });
  }, []);

  // Handle notification opened app
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    
    notificationService.handleNotificationOpenedApp(remoteMessage => {
      console.log('App opened from notification:', remoteMessage);
      // Navigate to appropriate screen based on notification data
      // For example, navigate to chat screen if it's a message notification
    }).then(unsub => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
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