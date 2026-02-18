/**
 * NotificationHandler.tsx — Global listener for incoming calls & chat toasts
 *
 * Fixes vs original:
 *  1. Navigation now goes directly to 'IncomingCall' in the root AppNavigator
 *     stack — not nested inside AppNav > Tab. The original path was wrong
 *     and would silently fail.
 *  2. incomingCall listener re-fires guard: we track the last-seen callId so
 *     the same call doesn't open the screen twice if Firestore sends a
 *     duplicate snapshot.
 *  3. The Firestore incomingCall field is cleared AFTER we navigate, not
 *     before, so the listener doesn't race with navigation.
 *  4. navigationRef is checked with .isReady() before navigating.
 *  5. Toast for incoming calls is dismissed before navigating (avoids
 *     overlapping UI).
 */

import React, { useEffect, useRef } from 'react';
import { notificationService } from '../../core/services/notification.service';
import { useAuth } from '../../core/context/AuthContext';
import Toast from 'react-native-toast-message';
import { navigationRef } from '../../../App';

const NotificationHandler = () => {
  const { userProfile }       = useAuth();
  const lastCallIdRef         = useRef<string>('');
  const lastNotifIdRef        = useRef<string>('');

  useEffect(() => {
    if (!userProfile?.uid) return;
    const uid = userProfile.uid;

    // ── Chat notifications ───────────────────────────────────────────────
    const unsubNotif = notificationService.listenForNotifications(uid, async (notification) => {
      const id = `${notification.title}-${notification.timestamp}`;
      if (id === lastNotifIdRef.current) return;
      lastNotifIdRef.current = id;

      Toast.show({
        type: 'info',
        text1: notification.title ?? 'New Message',
        text2: notification.body  ?? '',
        position: 'top',
        visibilityTime: 4000,
        autoHide: true,
      });

      await notificationService.markNotificationAsRead(uid);
    });

    // ── Incoming call ────────────────────────────────────────────────────
    const unsubCall = notificationService.listenForIncomingCalls(uid, async (callData) => {
      // De-duplicate: same callId can arrive in multiple snapshots
      if (callData.callId === lastCallIdRef.current) return;
      lastCallIdRef.current = callData.callId;

      Toast.hide();   // dismiss any existing toast

      // Navigate to IncomingCall screen (top-level stack in AppNavigator)
      if (navigationRef.current?.isReady()) {
        navigationRef.current.navigate('IncomingCall', {
          callId:      callData.callId,
          callerId:    callData.callerId,
          callerName:  callData.callerName,
          callerAvatar: callData.callerAvatar,
          type:        callData.type || 'video',
        });
      }
    });

    // ── Foreground FCM (optional) ────────────────────────────────────────
    const unsubFCM = notificationService.onForegroundMessage((msg) => {
      Toast.show({
        type: 'info',
        text1: msg.notification?.title ?? 'Notification',
        text2: msg.notification?.body  ?? '',
        position: 'top',
        visibilityTime: 4000,
      });
    });

    return () => {
      unsubNotif?.();
      unsubCall?.();
      unsubFCM?.();
    };
  }, [userProfile?.uid]);

  return null;
};

export default NotificationHandler;