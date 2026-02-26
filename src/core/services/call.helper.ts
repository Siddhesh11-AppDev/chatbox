import firestore from '@react-native-firebase/firestore';
import { notificationService } from './notification.service';

/**
 * Initialise a new call document in Firestore and push a notification to the
 * receiver.  Returns the generated callId.
 *
 * HISTORY NOTE: This helper only creates the *signalling* document.
 * Call-history records are written by:
 *   • VideoCall / VoiceCall doCleanup() — for both caller (outgoing/missed)
 *     and callee (received/missed) when they were inside the call screen.
 *   • IncomingCallScreen.rejectCall() — for the callee when they decline or
 *     the call auto-expires before they enter the call screen.
 *
 * Do NOT save call-history records here; this function runs before the call
 * outcome is known.
 */
export async function initiateCall(
  callerId: string,
  receiverId: string,
  callType: 'audio' | 'video',
  callerName: string,
  callerAvatar?: string,
): Promise<string> {
  try {
    const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const callRef = firestore().collection('calls').doc(callId);

    await callRef.set({
      callId,
      callerId,
      receiverId,
      callType,
      status: 'waiting',
      createdAt: firestore.FieldValue.serverTimestamp(),
      // `participants` here is a map (keyed by UID) used for WebRTC signalling
      // state. It is SEPARATE from the `participants` array stored on
      // callHistory documents.
      participants: {
        [callerId]:   { connectionState: 'initializing', lastPing: firestore.FieldValue.serverTimestamp() },
        [receiverId]: { connectionState: 'waiting',      lastPing: null },
      },
    });

    await notificationService.sendCallNotification({
      receiverId,
      callerId,
      callerName,
      callerAvatar,
      callId,
      callType,
    });

    console.log(`📞 Call initiated: ${callId} (${callType}) ${callerId} → ${receiverId}`);
    return callId;
  } catch (error) {
    console.error('Error initiating call:', error);
    throw error;
  }
}