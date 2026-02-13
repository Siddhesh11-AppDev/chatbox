import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { Platform, Alert, Vibration } from 'react-native';
import { NavigationContainerRef } from '@react-navigation/native';
import firestore, { serverTimestamp } from '@react-native-firebase/firestore';

class NotificationService {
  private navigationRef: NavigationContainerRef | null = null;
  private foregroundMessageListener: (() => void) | null = null;

  constructor() {
    // Don't call async methods in constructor
  }

  setNavigationRef(ref: NavigationContainerRef) {
    this.navigationRef = ref;
  }

  async requestPermission(): Promise<boolean> {
    try {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled) {
        console.log('Notification permission authorized');
        return true;
      } else {
        console.log('Notification permission denied');
        return false;
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  async getToken(): Promise<string | null> {
    try {
      const token = await messaging().getToken();
      console.log('FCM Token:', token);
      return token;
    } catch (error) {
      console.error('Error getting FCM token:', error);
      return null;
    }
  }

  // Handle incoming foreground messages
  onForegroundMessage(callback: (message: any) => void): (() => void) {
    this.foregroundMessageListener = messaging().onMessage(async (remoteMessage) => {
      console.log('Foreground message received:', remoteMessage);
      callback(remoteMessage);
    });

    return this.foregroundMessageListener;
  }

  // Handle notification when app is in background
  setupBackgroundMessageHandler() {
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      console.log('Background message handled:', remoteMessage);
      
      if (remoteMessage.data?.type === 'incoming_call') {
        this.handleIncomingCall(remoteMessage);
      }
    });
  }

  // Handle incoming call notification
  private handleIncomingCall(remoteMessage: FirebaseMessagingTypes.RemoteMessage) {
    const callData = remoteMessage.data;
    
    if (callData?.type === 'incoming_call') {
      this.showIncomingCallNotification(callData);
    }
  }

  // Show local notification for incoming call
  private showIncomingCallNotification(callData: any) {
    Vibration.vibrate([0, 500, 500, 500], true);

    if (this.navigationRef) {
      this.navigationRef.navigate('IncomingCall' as never, {
        screen: 'IncomingCall',
        params: {
          callData: {
            callerId: callData.callerId,
            callerName: callData.callerName,
            callerAvatar: callData.callerAvatar,
            callId: callData.callId,
            type: callData.callType || 'video',
          },
        },
      } as never);
    }
  }

  // Send call notification via Firestore
  async sendCallNotification({
    receiverId,
    callerId,
    callerName,
    callerAvatar,
    callId,
    callType = 'video',
  }: {
    receiverId: string;
    callerId: string;
    callerName: string;
    callerAvatar?: string;
    callId: string;
    callType?: 'video' | 'audio';
  }) {
    try {
      await firestore()
        .collection('calls')
        .doc(callId)
        .set({
          callId,
          callerId,
          callerName,
          callerAvatar,
          callType,
          status: 'ringing',
          receiverId,
          createdAt: serverTimestamp(),
        }, { merge: true });

      // Update receiver's user document with incoming call
      await firestore()
        .collection('users')
        .doc(receiverId)
        .set({
          incomingCall: {
            callId,
            callerId,
            callerName,
            callerAvatar,
            callType,
            timestamp: serverTimestamp(),
          }
        }, { merge: true });

      console.log('Call notification sent via Firestore');
    } catch (error) {
      console.error('Error sending call notification:', error);
    }
  }

  // Cancel/End call notification
  async cancelCallNotification(callId: string, receiverId?: string) {
    try {
      Vibration.cancel();
      
      await firestore()
        .collection('calls')
        .doc(callId)
        .update({
          status: 'ended',
          endedAt: serverTimestamp(),
        });

      // Clear receiver's incoming call if provided
      if (receiverId) {
        await firestore()
          .collection('users')
          .doc(receiverId)
          .update({
            incomingCall: null,
          });
      }

      console.log('Call notification cancelled');
    } catch (error) {
      console.error('Error cancelling call notification:', error);
    }
  }

  // NEW METHOD: Send notification to user (for chat messages)
  async sendNotificationToUser(receiverId: string, notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }) {
    try {
      // Update receiver's user document with notification
      await firestore()
        .collection('users')
        .doc(receiverId)
        .set({
          lastNotification: {
            title: notification.title,
            body: notification.body,
            data: notification.data || {},
            timestamp: serverTimestamp(),
            read: false,
          }
        }, { merge: true });

      console.log('Notification sent to user via Firestore:', notification.title);
    } catch (error) {
      console.error('Error sending notification to user:', error);
    }
  }

  // Listen for incoming calls
  listenForIncomingCalls(userId: string, onIncomingCall: (callData: any) => void): () => void {
    const unsubscribe = firestore()
      .collection('users')
      .doc(userId)
      .onSnapshot((doc) => {
        const data = doc.data();
        if (data?.incomingCall) {
          const callData = data.incomingCall;
          
          if (callData.callId) {
            Vibration.vibrate([0, 500, 500, 500], true);
            
            onIncomingCall({
              callId: callData.callId,
              callerId: callData.callerId,
              callerName: callData.callerName,
              callerAvatar: callData.callerAvatar,
              type: callData.callType || 'video',
            });
          }
        }
      });

    return unsubscribe;
  }

  // Listen for chat notifications
  listenForNotifications(userId: string, onNotification: (notification: any) => void): () => void {
    const unsubscribe = firestore()
      .collection('users')
      .doc(userId)
      .onSnapshot((doc) => {
        const data = doc.data();
        if (data?.lastNotification && !data.lastNotification.read) {
          onNotification(data.lastNotification);
        }
      });

    return unsubscribe;
  }

  // Mark notification as read
  async markNotificationAsRead(userId: string) {
    try {
      await firestore()
        .collection('users')
        .doc(userId)
        .update({
          'lastNotification.read': true,
        });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }

  // Clear incoming call from user document
  async clearIncomingCall(userId: string) {
    try {
      await firestore()
        .collection('users')
        .doc(userId)
        .update({
          incomingCall: null,
        });
      Vibration.cancel();
    } catch (error) {
      console.error('Error clearing incoming call:', error);
    }
  }

  // Clean up
  cleanup() {
    if (this.foregroundMessageListener) {
      this.foregroundMessageListener();
    }
  }
}

export const notificationService = new NotificationService();