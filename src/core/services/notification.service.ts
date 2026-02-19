import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { Platform, Alert, Vibration } from 'react-native';
import { NavigationContainerRef } from '@react-navigation/native';
import firestore, { serverTimestamp } from '@react-native-firebase/firestore';
import { RootStackParamList } from '../../../App';

class NotificationService {
  private navigationRef: NavigationContainerRef<RootStackParamList> | null = null;
  private foregroundMessageListener: (() => void) | null = null;

  // ✅ Guards to prevent duplicate IncomingCall navigation
  private lastShownCallId: string | null = null;
  private isShowingCall = false;

  constructor() {}

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

  // ─────────────────────────────────────────────────────────────────────────
  //  FCM
  // ─────────────────────────────────────────────────────────────────────────

  onForegroundMessage(callback: (message: any) => void): (() => void) {
    this.foregroundMessageListener = messaging().onMessage(async (remoteMessage) => {
      console.log('Foreground message received:', remoteMessage);
      callback(remoteMessage);
    });
    return this.foregroundMessageListener;
  }

  setupBackgroundMessageHandler() {
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      console.log('Background message handled:', remoteMessage);
      if (remoteMessage.data?.type === 'incoming_call') {
        this.handleIncomingCall(remoteMessage);
      }
    });
  }

  private handleIncomingCall(remoteMessage: FirebaseMessagingTypes.RemoteMessage) {
    const callData = remoteMessage.data;
    if (callData?.type === 'incoming_call') {
      this.showIncomingCallNotification(callData);
    }
  }

  private showIncomingCallNotification(callData: any) {
    Vibration.vibrate([0, 500, 500, 500], true);
    // ✅ Navigate directly to root-level IncomingCall — not nested in Tab
    if (this.navigationRef?.isReady()) {
      this.navigationRef.navigate('IncomingCall' as any, {
        callId:      callData.callId,
        callerId:    callData.callerId,
        callerName:  callData.callerName,
        callerAvatar: callData.callerAvatar,
        type:        callData.type || 'video',
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  CALL SIGNALING
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Called by the caller to notify the callee.
   * Writes to TWO places:
   *   - calls/{callId}              — the call session document
   *   - users/{receiverId}.incomingCall — triggers callee's Firestore listener
   */
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

      // 1. Create / update call session document
      await firestore()
        .collection('calls')
        .doc(callId)
        .set(
          {
            callId,
            callerId,
            callerName,
            callerAvatar: callerAvatar ?? null,
            callType,
            status: 'ringing',
            receiverId,
            createdAt: serverTimestamp(),
          },
          { merge: true },
        );
      console.log('✅ Call document created');

      // 2. Signal the callee via their user document
      await firestore()
        .collection('users')
        .doc(receiverId)
        .set(
          {
            incomingCall: {
              callId,
              callerId,
              callerName,
              callerAvatar: callerAvatar ?? null,
              callType,
              timestamp: serverTimestamp(),
            },
          },
          { merge: true },
        );
      console.log('✅ User document updated with incoming call');

    } catch (error) {
      console.error('❌ Error sending call notification:', error);
      throw error;
    }
  }

  /**
   * Remove the incomingCall field from the user's document.
   * Uses FieldValue.delete() — safer than setting to null (null leaves the key).
   */
  async clearIncomingCall(userId: string) {
    try {
      console.log('=== CLEARING INCOMING CALL for', userId, '===');
      await firestore()
        .collection('users')
        .doc(userId)
        .update({
          incomingCall: firestore.FieldValue.delete(),
        });
      Vibration.cancel();
      // ✅ Reset guard so future calls on the same device show correctly
      this.isShowingCall = false;
      this.lastShownCallId = null;
      console.log('✅ Incoming call cleared');
    } catch (error) {
      console.error('❌ Error clearing incoming call:', error);
    }
  }

  async cancelCallNotification(callId: string, receiverId?: string) {
    try {
      console.log('=== CANCELING CALL NOTIFICATION ===', callId);
      Vibration.cancel();

      await firestore()
        .collection('calls')
        .doc(callId)
        .update({
          status: 'ended',
          endedAt: serverTimestamp(),
        });

      if (receiverId) {
        await this.clearIncomingCall(receiverId);
      }
      console.log('✅ Call notification cancelled');
    } catch (error) {
      console.error('❌ Error cancelling call notification:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  LISTENERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Listens on the callee's user document for an incomingCall field.
   *
   * Key behaviours:
   *  - Skips pending-write snapshots (hasPendingWrites && fromCache)
   *  - Deduplicates: same callId will not fire the callback twice
   *  - Guards isShowingCall so we don't show two call screens at once
   *  - Resets guards when the incomingCall field is cleared
   */
  listenForIncomingCalls(
    userId: string,
    onIncomingCall: (callData: any) => void,
  ): () => void {
    console.log(`[Notifications] 🔔 Setting up incoming-call listener for: ${userId}`);

    const unsubscribe = firestore()
      .collection('users')
      .doc(userId)
      .onSnapshot({ includeMetadataChanges: false }, doc => {

        // Only skip truly local writes that haven't hit the server yet
        if (doc.metadata.hasPendingWrites && doc.metadata.fromCache) {
          console.log('[Notifications] ⏭️ Skipping pending local write');
          return;
        }

        const data = doc.data();
        const callData = data?.incomingCall;

        if (!callData) {
          // Field was cleared — reset guard
          if (this.lastShownCallId) {
            console.log('[Notifications] 🧹 incomingCall cleared, resetting guard');
            this.lastShownCallId = null;
            this.isShowingCall = false;
          }
          return;
        }

        const { callId, callerId, callerName, callerAvatar, callType } = callData;

        // Validate required fields
        if (!callId || !callerId || !callerName) {
          console.warn('[Notifications] ⚠️ Incomplete call data — ignoring', callData);
          return;
        }

        // Deduplicate — same call must not navigate twice
        if (this.lastShownCallId === callId) {
          console.log('[Notifications] 🔄 Duplicate call — ignoring', callId);
          return;
        }

        console.log('[Notifications] ✅ New incoming call:', { callId, callerId, callerName });
        this.lastShownCallId = callId;
        this.isShowingCall = true;

        Vibration.vibrate([0, 500, 500, 500], true);

        onIncomingCall({
          callId,
          callerId,
          callerName,
          callerAvatar,
          type: callType || 'video',
        });

      }, error => {
        console.error('[Notifications] ❌ Incoming-call listener error:', error);
      });

    return () => {
      console.log('[Notifications] 🔕 Unsubscribing incoming-call listener for:', userId);
      unsubscribe();
    };
  }

  /**
   * ✅ NEW: Lets IncomingCallScreen watch calls/{callId} so it auto-dismisses
   * when the caller cancels before the callee answers.
   *
   * Usage:
   *   const unsub = notificationService.listenForCallCancellation(callId, () => navigation.goBack());
   *   return () => unsub();
   */
  listenForCallCancellation(callId: string, onCancelled: () => void): () => void {
    console.log('[Notifications] 👂 Watching call for cancellation:', callId);

    const unsubscribe = firestore()
      .collection('calls')
      .doc(callId)
      .onSnapshot(doc => {
        const status = doc.data()?.status;
        if (status === 'ended') {
          console.log('[Notifications] 📵 Call cancelled by caller:', callId);
          Vibration.cancel();
          onCancelled();
        }
      }, error => {
        console.error('[Notifications] ❌ Call cancellation listener error:', error);
      });

    return unsubscribe;
  }

  /**
   * Listen for chat / general notifications on the user document.
   */
  listenForNotifications(
    userId: string,
    onNotification: (notification: any) => void,
  ): () => void {
    return firestore()
      .collection('users')
      .doc(userId)
      .onSnapshot(doc => {
        const data = doc.data();
        if (data?.lastNotification && !data.lastNotification.read) {
          onNotification(data.lastNotification);
        }
      });
  }

  async markNotificationAsRead(userId: string) {
    try {
      await firestore()
        .collection('users')
        .doc(userId)
        .update({ 'lastNotification.read': true });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MISSED CALL & STATUS
  // ─────────────────────────────────────────────────────────────────────────

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
      await firestore()
        .collection('users')
        .doc(receiverId)
        .set(
          {
            missedCall: {
              type: 'missed_call',
              callerName,
              callId,
              timestamp: serverTimestamp(),
            },
          },
          { merge: true },
        );
      console.log('✅ Missed call notification sent to:', receiverId);
    } catch (error) {
      console.error('❌ Error sending missed call notification:', error);
      throw error;
    }
  }

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
      await firestore()
        .collection('users')
        .doc(receiverId)
        .set(
          {
            callStatus: {
              status,
              callId,
              timestamp: serverTimestamp(),
            },
          },
          { merge: true },
        );
      console.log('✅ Call status notification sent:', status);
    } catch (error) {
      console.error('❌ Error sending call status notification:', error);
      throw error;
    }
  }

  async sendNotificationToUser(
    receiverId: string,
    notification: { title: string; body: string; data?: Record<string, string> },
  ) {
    try {
      await firestore()
        .collection('users')
        .doc(receiverId)
        .set(
          {
            lastNotification: {
              title:     notification.title,
              body:      notification.body,
              data:      notification.data || {},
              timestamp: serverTimestamp(),
              read:      false,
            },
          },
          { merge: true },
        );
      console.log('Notification sent to user:', notification.title);
    } catch (error) {
      console.error('Error sending notification to user:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  CLEANUP
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * ✅ NEW: Reset the "showing call" guard.
   * Call this after navigating away from IncomingCallScreen for any reason
   * (accept, reject, auto-decline, caller cancelled).
   * Both VideoCall.tsx and VoiceCall.tsx call this in doCleanup().
   */
  resetCallState() {
    console.log('[Notifications] 🔄 Resetting call state guard');
    this.isShowingCall = false;
    this.lastShownCallId = null;
    Vibration.cancel();
  }

  cleanup() {
    if (this.foregroundMessageListener) {
      this.foregroundMessageListener();
      this.foregroundMessageListener = null;
    }
    this.resetCallState();
  }
}

export const notificationService = new NotificationService();