import firestore from '@react-native-firebase/firestore';
import { notificationService } from '../../core/services/notification.service';

// Debug utility to test notification system
export const debugNotificationSystem = async (userId: string) => {
  console.log('=== DEBUGGING NOTIFICATION SYSTEM ===');
  console.log('Testing for user ID:', userId);
  
  try {
    // 1. Check current user document
    console.log('\n1. Checking current user document...');
    const userDoc = await firestore().collection('users').doc(userId).get();
    console.log('Document exists:', userDoc.exists);
    console.log('Document data:', userDoc.data());
    
    if (userDoc.exists()) {
      const data = userDoc.data();
      console.log('incomingCall field:', data?.incomingCall);
      console.log('All fields:', Object.keys(data || {}));
    }
    
    // 2. Test writing a dummy notification
    console.log('\n2. Testing notification write...');
    const testCallId = `test_call_${Date.now()}`;
    const testNotification = {
      callId: testCallId,
      callerId: 'test_caller_id',
      callerName: 'Test Caller',
      // callerAvatar omitted (undefined) since it's optional
      callType: 'video',
      timestamp: firestore.FieldValue.serverTimestamp(),
    };
    
    console.log('Writing test notification:', testNotification);
    
    await firestore()
      .collection('users')
      .doc(userId)
      .set({
        incomingCall: testNotification
      }, { merge: true });
    
    console.log('✅ Test notification written');
    
    // 3. Verify the write
    console.log('\n3. Verifying write...');
    const updatedDoc = await firestore().collection('users').doc(userId).get();
    console.log('Updated document data:', updatedDoc.data());
    console.log('incomingCall field after write:', updatedDoc.data()?.incomingCall);
    
    // 4. Test clearing
    console.log('\n4. Testing notification clear...');
    await firestore()
      .collection('users')
      .doc(userId)
      .update({
        incomingCall: null,
      });
    
    console.log('✅ Test notification cleared');
    
    // 5. Final verification
    console.log('\n5. Final verification...');
    const finalDoc = await firestore().collection('users').doc(userId).get();
    console.log('Final document data:', finalDoc.data());
    console.log('incomingCall field after clear:', finalDoc.data()?.incomingCall);
    
    console.log('\n=== DEBUG COMPLETE ===');
    
  } catch (error) {
    console.error('❌ Debug error:', error);
  }
};

// Test function to manually trigger notification
export const sendTestNotification = async (receiverId: string) => {
  console.log('=== SENDING TEST NOTIFICATION ===');
  console.log('Receiver ID:', receiverId);
  
  try {
    await notificationService.sendCallNotification({
      receiverId,
      callerId: 'test_user_id',
      callerName: 'Test User',
      // callerAvatar omitted (undefined) since it's optional
      callId: `test_call_${Date.now()}`,
      callType: 'video',
    });
    
    console.log('✅ Test notification sent successfully');
  } catch (error) {
    console.error('❌ Error sending test notification:', error);
  }
};