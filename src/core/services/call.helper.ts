import firestore from '@react-native-firebase/firestore';
import { notificationService } from './notification.service';

/**
 * Helper function to initiate a call
 * @param callerId - The ID of the user initiating the call
 * @param receiverId - The ID of the user receiving the call
 * @param callType - Type of call ('audio' or 'video')
 * @param callerName - Name of the caller
 * @param callerAvatar - Avatar URL of the caller (optional)
 * @returns Promise<string> - The call ID
 */
export async function initiateCall(
  callerId: string,
  receiverId: string,
  callType: 'audio' | 'video',
  callerName: string,
  callerAvatar?: string
): Promise<string> {
  try {
    // Create a new call document
    const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const callRef = firestore().collection('calls').doc(callId);
    
    // Create the call document with initial data
    await callRef.set({
      callId: callId,
      callerId: callerId,
      receiverId: receiverId,
      callType: callType,
      status: 'waiting', // Initial status
      createdAt: firestore.FieldValue.serverTimestamp(),
      participants: {
        [callerId]: {
          connectionState: 'initializing',
          lastPing: firestore.FieldValue.serverTimestamp(),
        },
        [receiverId]: {
          connectionState: 'waiting',
          lastPing: null,
        },
      },
    });

    // Send notification to receiver
    await notificationService.sendCallNotification({
      receiverId: receiverId,
      callerId: callerId,
      callerName: callerName,
      callerAvatar: callerAvatar,
      callId: callId,
      callType: callType,
    });

    console.log(`Call initiated: ${callId} (${callType}) from ${callerId} to ${receiverId}`);
    return callId;
  } catch (error) {
    console.error('Error initiating call:', error);
    throw error;
  }
}