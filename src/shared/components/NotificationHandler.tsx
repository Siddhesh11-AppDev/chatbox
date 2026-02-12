import React, { useEffect } from 'react';
import { notificationService } from '../../core/services/notification.service';
import Toast from 'react-native-toast-message';

const NotificationHandler = () => {
  useEffect(() => {
    // Handle foreground messages
    const unsubscribe = notificationService.onForegroundMessage(remoteMessage => {
      console.log('Foreground notification received:', remoteMessage);
      
      // Show in-app notification using Toast
      Toast.show({
        type: 'success',
        text1: remoteMessage.notification?.title || 'New Notification',
        text2: remoteMessage.notification?.body || 'You have a new message',
        position: 'top',
        visibilityTime: 4000,
      });
    });

    return unsubscribe;
  }, []);

  return null;
};

export default NotificationHandler;