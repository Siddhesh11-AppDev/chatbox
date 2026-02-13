import React, { useEffect, useState } from 'react';
import { notificationService } from '../../core/services/notification.service';
import { useAuth } from '../../core/context/AuthContext';
import Toast from 'react-native-toast-message';
import { navigationRef } from '../../../App';

const NotificationHandler = () => {
  const { userProfile } = useAuth();
  const [lastNotificationId, setLastNotificationId] = useState<string>('');

  useEffect(() => {
    if (!userProfile?.uid) return;

    // Listen for Firestore-based message notifications
    const unsubscribeNotification = notificationService.listenForNotifications(
      userProfile.uid,
      async (notification) => {
        // Prevent duplicate notifications
        const notificationId = `${notification.title}-${notification.timestamp}`;
        if (notificationId === lastNotificationId) return;
        
        setLastNotificationId(notificationId);

        console.log('New notification received:', notification);

        // Show toast notification
        Toast.show({
          type: 'info',
          text1: notification.title || 'New Message',
          text2: notification.body || 'You have a new message',
          position: 'top',
          visibilityTime: 4000,
          autoHide: true,
          onPress: () => {
            // Navigate to chat if notification is clicked
            if (notification.data?.chatId && navigationRef.current) {
              notificationService.markNotificationAsRead(userProfile.uid);
              // Navigate to the chat
            }
          }
        });

        // Mark notification as read
        await notificationService.markNotificationAsRead(userProfile.uid);
      }
    );

    // Handle foreground FCM messages (if receiving from FCM)
    const unsubscribeFCM = notificationService.onForegroundMessage((remoteMessage) => {
      console.log('FCM Foreground notification received:', remoteMessage);
      
      Toast.show({
        type: 'success',
        text1: remoteMessage.notification?.title || 'New Notification',
        text2: remoteMessage.notification?.body || 'You have a new message',
        position: 'top',
        visibilityTime: 4000,
      });
    });

    return () => {
      if (unsubscribeNotification && typeof unsubscribeNotification === 'function') {
        unsubscribeNotification();
      }
      if (unsubscribeFCM && typeof unsubscribeFCM === 'function') {
        unsubscribeFCM();
      }
    };
  }, [userProfile?.uid, lastNotificationId]);

  return null;
};

export default NotificationHandler;