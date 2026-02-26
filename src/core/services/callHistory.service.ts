import firestore, { serverTimestamp } from '@react-native-firebase/firestore';
import { CallHistoryItem } from '../../features/chat/UserMessage';

// ─── Architecture note ────────────────────────────────────────────────────────
//
//  Each call produces TWO independent Firestore docs — one per participant —
//  each storing ONLY that user's perspective via `ownerId`.
//
//  Why? Because `participants array-contains` queries return records visible
//  to BOTH users, causing duplicates in each user's list. Querying by `ownerId`
//  (a single-field equality) requires no composite index and gives each user
//  exactly one record per call, with a status that reflects their role:
//
//   Caller  saves: { ownerId: callerUid, callStatus: 'outgoing' | 'missed' }
//   Callee  saves: { ownerId: calleeUid, callStatus: 'received' | 'missed' | 'rejected' }
//
//  Legacy records (pre-migration) are fetched via the old participants query
//  and de-duplicated before returning.
// ─────────────────────────────────────────────────────────────────────────────

export type CallHistoryRecord = CallHistoryItem & { ownerId: string };

class CallHistoryService {
  // ── Save ──────────────────────────────────────────────────────────────────

  /**
   * Persist a single call record for one participant.
   * Call this once per user side (caller and callee each call it independently).
   */
  async saveCallRecord(
    callRecord: Omit<CallHistoryItem, 'id' | 'timestamp'> & { ownerId?: string },
  ): Promise<string> {
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

      console.log('✅ Call record saved:', callId, callRecord.callStatus, '→', callRecord.ownerId);
      return callId;
    } catch (error) {
      console.error('❌ Error saving call record:', error);
      throw error;
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  private parseTimestamp(ts: any): Date {
    if (!ts) return new Date(0);
    if (ts.toDate) return ts.toDate();
    if (ts instanceof Date) return ts;
    if (ts._seconds) return new Date(ts._seconds * 1000);
    return new Date(0);
  }

  private sortDesc(calls: CallHistoryItem[]): CallHistoryItem[] {
    return calls.sort(
      (a, b) =>
        this.parseTimestamp(b.timestamp).getTime() -
        this.parseTimestamp(a.timestamp).getTime(),
    );
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  /**
   * One-shot fetch of a user's call history.
   * Merges new ownerId records with legacy participants records, de-duplicated.
   */
  async getCallHistory(userId: string, limit = 20): Promise<CallHistoryItem[]> {
    try {
      const [newSnap, legacySnap] = await Promise.all([
        // New-style: exact user records
        firestore()
          .collection('callHistory')
          .where('ownerId', '==', userId)
          .limit(limit * 2)
          .get(),
        // Legacy-style: pre-migration records (participants array)
        firestore()
          .collection('callHistory')
          .where('participants', 'array-contains', userId)
          .limit(limit * 2)
          .get(),
      ]);

      const seenIds = new Set<string>();
      const calls: CallHistoryItem[] = [];

      const addDoc = (doc: any) => {
        if (seenIds.has(doc.id)) return;
        seenIds.add(doc.id);
        calls.push({ id: doc.id, ...doc.data() } as CallHistoryItem);
      };

      newSnap.forEach(addDoc);
      legacySnap.forEach(addDoc);

      return this.sortDesc(calls).slice(0, limit);
    } catch (error) {
      console.error('❌ Error fetching call history:', error);
      return [];
    }
  }

  /**
   * Fetch calls from the last N hours for a user.
   */
  async getRecentCalls(userId: string, hours = 24): Promise<CallHistoryItem[]> {
    try {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

      const snap = await firestore()
        .collection('callHistory')
        .where('ownerId', '==', userId)
        .get();

      const calls: CallHistoryItem[] = [];
      snap.forEach(doc => {
        const data = { id: doc.id, ...doc.data() } as CallHistoryItem;
        if (this.parseTimestamp(data.timestamp) >= cutoff) calls.push(data);
      });

      return this.sortDesc(calls);
    } catch (error) {
      console.error('❌ Error fetching recent calls:', error);
      return [];
    }
  }

  // ── Real-time listener ────────────────────────────────────────────────────

  /**
   * Subscribe to real-time call history for a user.
   * Returns the unsubscribe function.
   */
  listenToCallHistory(
    userId: string,
    callback: (calls: CallHistoryItem[]) => void,
  ): () => void {
    return firestore()
      .collection('callHistory')
      .where('ownerId', '==', userId)
      .limit(50) // over-fetch so client-side sort covers all recent calls
      .onSnapshot(
        snap => {
          const calls: CallHistoryItem[] = [];
          snap.forEach(doc =>
            calls.push({ id: doc.id, ...doc.data() } as CallHistoryItem),
          );
          callback(this.sortDesc(calls).slice(0, 25));
        },
        error => console.error('❌ Call history listener error:', error),
      );
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async deleteCallRecord(callId: string): Promise<void> {
    try {
      await firestore().collection('callHistory').doc(callId).delete();
      console.log('✅ Call record deleted:', callId);
    } catch (error) {
      console.error('❌ Error deleting call record:', error);
      throw error;
    }
  }

  async clearCallHistory(userId: string): Promise<void> {
    try {
      const snap = await firestore()
        .collection('callHistory')
        .where('ownerId', '==', userId)
        .get();

      const batch = firestore().batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      console.log('✅ Call history cleared for user:', userId);
    } catch (error) {
      console.error('❌ Error clearing call history:', error);
      throw error;
    }
  }
}

export const callHistoryService = new CallHistoryService();