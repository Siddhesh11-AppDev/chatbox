import firestore, { serverTimestamp } from '@react-native-firebase/firestore';
import { CallHistoryItem } from '../../features/chat/UserMessage';

class CallHistoryService {
  /**
   * Save a call record to Firestore
   */
  async saveCallRecord(callRecord: Omit<CallHistoryItem, 'id' | 'timestamp'>) {
    try {
      const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await firestore()
        .collection('callHistory')
        .doc(callId)
        .set({
          ...callRecord,
          id: callId,
          timestamp: serverTimestamp(),
        });
      
      console.log('✅ Call record saved:', callId);
      return callId;
    } catch (error) {
      console.error('❌ Error saving call record:', error);
      throw error;
    }
  }

  /**
   * Get call history for a specific user
   * Using collection group query to avoid composite index requirement
   */
  async getCallHistory(userId: string, limit: number = 20): Promise<CallHistoryItem[]> {
    try {
      // First, get all call records (without ordering)
      const snapshot = await firestore()
        .collection('callHistory')
        .where('participants', 'array-contains', userId)
        .limit(limit * 2) // Get more to account for sorting
        .get();

      const calls: CallHistoryItem[] = [];
      snapshot.forEach(doc => {
        calls.push({
          id: doc.id,
          ...doc.data(),
        } as CallHistoryItem);
      });

      // Sort by timestamp manually
      calls.sort((a, b) => {
        const timeA = a.timestamp?.toDate?.() || a.timestamp || new Date(0);
        const timeB = b.timestamp?.toDate?.() || b.timestamp || new Date(0);
        return new Date(timeB).getTime() - new Date(timeA).getTime();
      });

      // Return only the requested limit
      return calls.slice(0, limit);
    } catch (error) {
      console.error('❌ Error fetching call history:', error);
      return [];
    }
  }

  /**
   * Get recent calls (last 24 hours) for a user
   * Using client-side filtering to avoid composite index requirement
   */
  async getRecentCalls(userId: string, hours: number = 24): Promise<CallHistoryItem[]> {
    try {
      const cutoff = new Date();
      cutoff.setHours(cutoff.getHours() - hours);

      // Get all calls for user (without timestamp filter)
      const snapshot = await firestore()
        .collection('callHistory')
        .where('participants', 'array-contains', userId)
        .get();

      const calls: CallHistoryItem[] = [];
      snapshot.forEach(doc => {
        const callData = {
          id: doc.id,
          ...doc.data(),
        } as CallHistoryItem;
        
        // Filter by timestamp on client side
        const callTime = callData.timestamp?.toDate?.() || callData.timestamp;
        if (callTime && new Date(callTime) >= cutoff) {
          calls.push(callData);
        }
      });

      // Sort by timestamp
      calls.sort((a, b) => {
        const timeA = a.timestamp?.toDate?.() || a.timestamp || new Date(0);
        const timeB = b.timestamp?.toDate?.() || b.timestamp || new Date(0);
        return new Date(timeB).getTime() - new Date(timeA).getTime();
      });

      return calls;
    } catch (error) {
      console.error('❌ Error fetching recent calls:', error);
      return [];
    }
  }

  /**
   * Listen to real-time call history updates
   * Using manual sorting to avoid composite index requirement
   */
  listenToCallHistory(userId: string, callback: (calls: CallHistoryItem[]) => void) {
    return firestore()
      .collection('callHistory')
      .where('participants', 'array-contains', userId)
      .limit(40) // Get more to account for sorting
      .onSnapshot(snapshot => {
        const calls: CallHistoryItem[] = [];
        snapshot.forEach(doc => {
          calls.push({
            id: doc.id,
            ...doc.data(),
          } as CallHistoryItem);
        });
        
        // Sort by timestamp manually
        calls.sort((a, b) => {
          const timeA = a.timestamp?.toDate?.() || a.timestamp || new Date(0);
          const timeB = b.timestamp?.toDate?.() || b.timestamp || new Date(0);
          return new Date(timeB).getTime() - new Date(timeA).getTime();
        });
        
        // Return only first 20 items
        callback(calls.slice(0, 20));
      }, error => {
        console.error('❌ Call history listener error:', error);
      });
  }

  /**
   * Delete a call record
   */
  async deleteCallRecord(callId: string) {
    try {
      await firestore()
        .collection('callHistory')
        .doc(callId)
        .delete();
      console.log('✅ Call record deleted:', callId);
    } catch (error) {
      console.error('❌ Error deleting call record:', error);
      throw error;
    }
  }

  /**
   * Clear all call history for a user
   */
  async clearCallHistory(userId: string) {
    try {
      const snapshot = await firestore()
        .collection('callHistory')
        .where('participants', 'array-contains', userId)
        .get();

      const batch = firestore().batch();
      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log('✅ Call history cleared for user:', userId);
    } catch (error) {
      console.error('❌ Error clearing call history:', error);
      throw error;
    }
  }
}

export const callHistoryService = new CallHistoryService();