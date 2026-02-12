import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import firestore from '@react-native-firebase/firestore';

class NotificationService {
  // Request permission for iOS and Android
  async requestPermission() {
    try {
      if (Platform.OS === 'ios') {
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        console.log('iOS notification permission status:', authStatus);
        return enabled;
      } else {
        // Android automatically grants permission for notifications
        await messaging().requestPermission();
        console.log('Android notification permission granted');
        return true;
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  // Get FCM token
  async getToken() {
    try {
      const token = await messaging().getToken();
      console.log('FCM Token:', token);
      return token;
    } catch (error) {
      console.error('Error getting FCM token:', error);
      return null;
    }
  }

  // Subscribe to foreground messages
  onForegroundMessage(callback: (message: any) => void) {
    return messaging().onMessage(callback);
  }

  // Subscribe to background messages
  onBackgroundMessage(callback: (message: any) => Promise<any>) {
    return messaging().setBackgroundMessageHandler(callback);
  }

  // Save FCM token to user profile
  async saveTokenToUserProfile(userId: string, token: string) {
    try {
      await firestore()
        .collection('users')
        .doc(userId)
        .update({
          fcmToken: token,
        });
      console.log('FCM token saved to user profile');
    } catch (error) {
      console.error('Error saving FCM token:', error);
    }
  }

  // Send push notification to a user
  async sendNotificationToUser(userId: string, notificationData: any) {
    try {
      // Get user's FCM token from Firestore
      const userDoc = await firestore().collection('users').doc(userId).get();
      const userData = userDoc.data();
      const fcmToken = userData?.fcmToken;

      if (!fcmToken) {
        console.log('No FCM token found for user');
        return false;
      }

      // For demo purposes, we'll log the notification data
      // In production, you'd send this to your server which would use FCM HTTP API
      console.log('Would send notification to:', fcmToken);
      console.log('Notification data:', notificationData);

      // Simulate successful notification
      return true;
    } catch (error) {
      console.error('Error sending notification:', error);
      return false;
    }
  }

  // Handle notification when app is opened from background
  async handleNotificationOpenedApp(callback: (message: any) => void) {
    const unsubscribe = messaging().onNotificationOpenedApp(remoteMessage => {
      console.log('Notification caused app to open from background state:', remoteMessage);
      callback(remoteMessage);
    });

    // Check if app was opened from a notification when app was closed
    const initialNotification = await messaging().getInitialNotification();
    if (initialNotification) {
      console.log('App opened from notification when closed:', initialNotification);
      callback(initialNotification);
    }

    return unsubscribe;
  }

  // Delete FCM token when user logs out
  async deleteToken() {
    try {
      await messaging().deleteToken();
      console.log('FCM token deleted');
    } catch (error) {
      console.error('Error deleting FCM token:', error);
    }
  }
}

export const notificationService = new NotificationService();