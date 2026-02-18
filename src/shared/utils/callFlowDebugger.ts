import firestore from '@react-native-firebase/firestore';
import { notificationService } from '../../core/services/notification.service';

// Simple call flow debugger to trace the exact issue
export class CallFlowDebugger {
  static async traceCallFlow(callerId: string, receiverId: string) {
    console.log('=== CALL FLOW DEBUGGER ===');
    console.log('Caller ID:', callerId);
    console.log('Receiver ID:', receiverId);
    console.log('Timestamp:', new Date().toISOString());
    
    try {
      // Step 1: Check if both users exist
      console.log('\n--- STEP 1: User Verification ---');
      const [callerDoc, receiverDoc] = await Promise.all([
        firestore().collection('users').doc(callerId).get(),
        firestore().collection('users').doc(receiverId).get()
      ]);
      
      console.log('Caller exists:', callerDoc.exists);
      console.log('Receiver exists:', receiverDoc.exists);
      
      if (!callerDoc.exists || !receiverDoc.exists) {
        console.log('❌ USER DOCUMENT MISSING');
        return false;
      }
      
      // Step 2: Test direct notification write
      console.log('\n--- STEP 2: Direct Notification Test ---');
      const testCallId = `test_call_${Date.now()}`;
      
      const notificationData = {
        callId: testCallId,
        callerId: callerId,
        callerName: 'Test Caller',
        // callerAvatar omitted (undefined) since it's optional
        callType: 'video',
        timestamp: firestore.FieldValue.serverTimestamp()
      };
      
      console.log('Writing notification data:', notificationData);
      
      await firestore().collection('users').doc(receiverId).set({
        incomingCall: notificationData
      }, { merge: true });
      
      console.log('✅ Notification written to Firestore');
      
      // Step 3: Verify the write
      console.log('\n--- STEP 3: Verification ---');
      const verificationDoc = await firestore().collection('users').doc(receiverId).get();
      const incomingCall = verificationDoc.data()?.incomingCall;
      
      console.log('Incoming call field exists:', !!incomingCall);
      console.log('Call ID matches:', incomingCall?.callId === testCallId);
      console.log('Full data:', incomingCall);
      
      // Step 4: Test clearing
      console.log('\n--- STEP 4: Cleanup Test ---');
      await firestore().collection('users').doc(receiverId).update({
        incomingCall: null
      });
      
      const finalDoc = await firestore().collection('users').doc(receiverId).get();
      console.log('Cleanup successful:', !finalDoc.data()?.incomingCall);
      
      console.log('\n=== DEBUG COMPLETE ===');
      console.log('If all steps show ✅, the Firestore notification system works');
      console.log('If you still cant receive calls, the issue is in the listener or UI layer');
      
      return true;
      
    } catch (error) {
      console.error('❌ DEBUG FAILED:', error);
      return false;
    }
  }
  
  static async monitorUserDocument(userId: string, durationMs: number = 30000) {
    console.log(`=== MONITORING USER DOCUMENT FOR ${durationMs/1000} SECONDS ===`);
    console.log('User ID:', userId);
    
    const unsubscribe = firestore()
      .collection('users')
      .doc(userId)
      .onSnapshot((doc) => {
        console.log('\n=== DOCUMENT CHANGE DETECTED ===');
        console.log('Timestamp:', new Date().toISOString());
        console.log('Document exists:', doc.exists);
        console.log('All data:', doc.data());
        console.log('incomingCall field:', doc.data()?.incomingCall);
        
        if (doc.data()?.incomingCall) {
          console.log('🎉 INCOMING CALL DETECTED!');
          console.log('Call data:', doc.data()?.incomingCall);
        }
      }, (error) => {
        console.error('❌ MONITORING ERROR:', error);
      });
    
    // Stop monitoring after duration
    setTimeout(() => {
      console.log('=== STOPPING MONITOR ===');
      unsubscribe();
    }, durationMs);
    
    console.log('Monitor active. Try making a call now.');
  }
  
  static async testNotificationService(callerId: string, receiverId: string) {
    console.log('=== TESTING NOTIFICATION SERVICE ===');
    
    try {
      await notificationService.sendCallNotification({
        receiverId,
        callerId,
        callerName: 'Service Test',
        // callerAvatar omitted (undefined) since it's optional
        callId: `service_test_${Date.now()}`,
        callType: 'video'
      });
      
      console.log('✅ Notification service test completed');
      return true;
    } catch (error) {
      console.error('❌ Notification service test failed:', error);
      return false;
    }
  }
}

// Simple function to test if Firestore is working
export const testFirestoreConnectivity = async () => {
  console.log('=== TESTING FIRESTORE CONNECTIVITY ===');
  
  try {
    const testDoc = await firestore().collection('test').doc('connectivity').get();
    console.log('✅ Firestore connection successful');
    console.log('Test document exists:', testDoc.exists);
    return true;
  } catch (error) {
    console.error('❌ Firestore connection failed:', error);
    return false;
  }
};