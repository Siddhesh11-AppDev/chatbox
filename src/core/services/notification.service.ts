import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { Platform, Alert, Vibration } from 'react-native';
import { NavigationContainerRef } from '@react-navigation/native';
import firestore, { serverTimestamp } from '@react-native-firebase/firestore';
import { RootStackParamList } from '../../../App';

class NotificationService {
  private navigationRef: NavigationContainerRef<RootStackParamList> | null = null;
  private foregroundMessageListener: (() => void) | null = null;

  constructor() {
    // Don't call async methods in constructor
  }

  setNavigationRef(ref: NavigationContainerRef<RootStackParamList>) {
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
      // Navigate through the correct navigation structure: AppNav -> Tab -> IncomingCall
      this.navigationRef.navigate('AppNav' as any, {
        screen: 'Tab',
        params: {
          screen: 'IncomingCall',
          params: {
            callId: callData.callId,
            callerId: callData.callerId,
            callerName: callData.callerName,
            callerAvatar: callData.callerAvatar,
            type: callData.type || 'video',
          }
        }
      } as any);
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
      console.log('=== SENDING CALL NOTIFICATION ===');
      console.log('Receiver ID:', receiverId);
      console.log('Caller ID:', callerId);
      console.log('Caller Name:', callerName);
      console.log('Call ID:', callId);
      console.log('Call Type:', callType);

      // First, update the calls collection
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

      console.log('✅ Call document created in calls collection');

      // Update receiver's user document with incoming call
      const incomingCallData = {
        callId,
        callerId,
        callerName,
        callerAvatar,
        callType,
        timestamp: serverTimestamp(),
      };

      console.log('Updating user document with incoming call data:', incomingCallData);

      await firestore()
        .collection('users')
        .doc(receiverId)
        .set({
          incomingCall: incomingCallData
        }, { merge: true });

      console.log('✅ User document updated with incoming call');
      console.log('Call notification sent via Firestore successfully');

      // Verify the data was written
      const userDoc = await firestore().collection('users').doc(receiverId).get();
      console.log('Verification - User document after update:', userDoc.data());

    } catch (error) {
      console.error('❌ Error sending call notification:', error);
      throw error;
    }
  }

  // Clear incoming call from user document
  async clearIncomingCall(userId: string) {
    try {
      console.log('=== CLEARING INCOMING CALL ===');
      console.log('User ID:', userId);
      
      await firestore()
        .collection('users')
        .doc(userId)
        .update({
          incomingCall: null,
        });
      
      Vibration.cancel();
      console.log('✅ Incoming call cleared successfully');
    } catch (error) {
      console.error('❌ Error clearing incoming call:', error);
    }
  }

  // Cancel/End call notification
  async cancelCallNotification(callId: string, receiverId?: string) {
    try {
      console.log('=== CANCELING CALL NOTIFICATION ===');
      console.log('Call ID:', callId);
      console.log('Receiver ID:', receiverId);
      
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
        await this.clearIncomingCall(receiverId);
      }

      console.log('✅ Call notification cancelled');
    } catch (error) {
      console.error('❌ Error cancelling call notification:', error);
    }
  }

  // NEW METHOD: Send missed call notification
  async sendMissedCallNotification({
    receiverId,
    callerName,
    callId,
  }: {
    receiverId: string;
    callerName: string;
    callId: string;
  }) {
    try {
      console.log('=== SENDING MISSED CALL NOTIFICATION ===');
      console.log('Receiver ID:', receiverId);
      console.log('Caller Name:', callerName);
      console.log('Call ID:', callId);

      // Update receiver's user document with missed call
      const missedCallData = {
        type: 'missed_call',
        callerName,
        callId,
        timestamp: serverTimestamp(),
      };

      console.log('Updating user document with missed call data:', missedCallData);

      await firestore()
        .collection('users')
        .doc(receiverId)
        .set({
          missedCall: missedCallData
        }, { merge: true });

      console.log('✅ Missed call notification sent successfully');

      // Verify the data was written
      const userDoc = await firestore().collection('users').doc(receiverId).get();
      console.log('Verification - User document after update:', userDoc.data());

    } catch (error) {
      console.error('❌ Error sending missed call notification:', error);
      throw error;
    }
  }

  // NEW METHOD: Send call status notification
  async sendCallStatusNotification({
    receiverId,
    status,
    callId,
  }: {
    receiverId: string;
    status: string;
    callId: string;
  }) {
    try {
      console.log('=== SENDING CALL STATUS NOTIFICATION ===');
      console.log('Receiver ID:', receiverId);
      console.log('Status:', status);
      console.log('Call ID:', callId);

      // Update receiver's user document with call status
      const callStatusData = {
        status,
        callId,
        timestamp: serverTimestamp(),
      };

      console.log('Updating user document with call status data:', callStatusData);

      await firestore()
        .collection('users')
        .doc(receiverId)
        .set({
          callStatus: callStatusData
        }, { merge: true });

      console.log('✅ Call status notification sent successfully');

      // Verify the data was written
      const userDoc = await firestore().collection('users').doc(receiverId).get();
      console.log('Verification - User document after update:', userDoc.data());

    } catch (error) {
      console.error('❌ Error sending call status notification:', error);
      throw error;
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
    console.log('=== LISTENING FOR INCOMING CALLS ===');
    console.log('User ID:', userId);
    console.log('Setting up Firestore listener for user:', userId);
    console.log('Current timestamp:', new Date().toISOString());
    
    const unsubscribe = firestore()
      .collection('users')
      .doc(userId)
      .onSnapshot({ includeMetadataChanges: true }, (doc) => {
        console.log('=== USER DOCUMENT SNAPSHOT ===');
        console.log('Document exists:', doc.exists);
        console.log('Document data:', doc.data());
        console.log('Metadata hasPendingWrites:', doc.metadata.hasPendingWrites);
        console.log('Metadata fromCache:', doc.metadata.fromCache);
        console.log('Snapshot received at:', new Date().toISOString());
        
        // Skip local changes that haven't been committed
        if (doc.metadata.hasPendingWrites) {
          console.log('Skipping local pending write');
          return;
        }
        
        const data = doc.data();
        console.log('Checking for incomingCall field:', data?.incomingCall);
        
        if (data?.incomingCall) {
          const callData = data.incomingCall;
          console.log('=== INCOMING CALL DATA DETECTED ===');
          console.log('Full call data:', callData);
          console.log('Call ID:', callData.callId);
          console.log('Caller ID:', callData.callerId);
          console.log('Caller Name:', callData.callerName);
          console.log('Timestamp:', callData.timestamp?.toDate?.() || callData.timestamp);
          
          // Validate required fields
          if (callData.callId && callData.callerId && callData.callerName) {
            console.log('=== VALID CALL DATA - TRIGGERING CALLBACK ===');
            Vibration.vibrate([0, 500, 500, 500], true);
            
            onIncomingCall({
              callId: callData.callId,
              callerId: callData.callerId,
              callerName: callData.callerName,
              callerAvatar: callData.callerAvatar,
              type: callData.callType || 'video',
            });
          } else {
            console.log('=== INVALID CALL DATA - MISSING REQUIRED FIELDS ===');
            console.log('Missing fields:', {
              callId: !callData.callId,
              callerId: !callData.callerId,
              callerName: !callData.callerName
            });
          }
        } else {
          console.log('No incoming call data found in document');
          if (data) {
            console.log('Available fields in user document:', Object.keys(data));
          }
        }
      }, (error) => {
        console.error('=== FIRESTORE LISTENER ERROR ===');
        console.error('Error listening for incoming calls:', error);
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

  // Clean up
  cleanup() {
    if (this.foregroundMessageListener) {
      this.foregroundMessageListener();
    }
  }
}

export const notificationService = new NotificationService();