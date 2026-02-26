import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  SectionList,
  Image,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../core/context/AuthContext';
import { callHistoryService } from '../../core/services/callHistory.service';
import { CallHistoryItem } from '../chat/UserMessage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../core/navigation/AppNavigator';

type CallsNavigationProp = NativeStackNavigationProp<
  AppStackParamList,
  'userMsg'
>;

// ─── Status display helpers ───────────────────────────────────────────────────
//
//  With the new ownerId architecture, each record already encodes the viewer's
//  perspective via callStatus. We only fall back to isCaller derivation for
//  legacy 'completed' records saved before the migration.
//
//  Status meanings:
//    'outgoing'  → viewer placed the call, it connected
//    'received'  → viewer received the call, it connected
//    'missed'    → caller: no answer / callee: missed incoming call
//    'rejected'  → callee deliberately tapped Decline
//    'completed' → legacy — direction inferred from callerId vs currentUser
//
// ─────────────────────────────────────────────────────────────────────────────

const GREEN = '#25D366';
const RED = '#FF3B30';
const GREY = '#8E8E93';

type StatusDisplay = { icon: string; color: string; label: string };

function getStatusDisplay(
  item: CallHistoryItem,
  currentUserId: string | undefined,
): StatusDisplay {
  const t = item.callType === 'video' ? 'video' : 'voice';
  const isCaller = item.callerId === currentUserId;

  switch (item.callStatus) {
    case 'outgoing':
      return {
        icon: 'arrow-up-right',
        color: GREEN,
        label: `Outgoing ${t} call`,
      };

    case 'received':
      return {
        icon: 'arrow-down-left',
        color: GREEN,
        label: `Incoming ${t} call`,
      };

    case 'missed':
      // isCaller=true  → they placed the call, other side never answered
      // isCaller=false → they received the call, caller hung up before they saw it
      return isCaller
        ? { icon: 'phone-missed', color: RED, label: `Missed ${t} call` }
        : { icon: 'phone-missed', color: RED, label: `Missed ${t} call` };

    case 'rejected':
      // Callee deliberately tapped Decline. From their own history it still
      // reads "Missed call" — same as WhatsApp.
      return { icon: 'phone-missed', color: RED, label: `Missed ${t} call` };

    // Legacy fallback for pre-migration 'completed' records
    case 'completed':
      return isCaller
        ? { icon: 'arrow-up-right', color: GREEN, label: `Outgoing ${t} call` }
        : {
            icon: 'arrow-down-left',
            color: GREEN,
            label: `Incoming ${t} call`,
          };

    default:
      return {
        icon: item.callType === 'video' ? 'video' : 'phone',
        color: GREY,
        label: `${t} call`,
      };
  }
}

const isMissed = (s: CallHistoryItem['callStatus']) =>
  s === 'missed' || s === 'rejected';

// ─── Timestamp helpers ────────────────────────────────────────────────────────

function toDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (ts._seconds) return new Date(ts._seconds * 1000);
  return null;
}

function fmtTime(ts: any): string {
  const d = toDate(ts);
  if (!d) return '';
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtDuration(secs: number): string {
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}

/**
 * Maps a Firestore timestamp to a human-readable section heading,
 * exactly like WhatsApp:
 *   same day      → "Today"
 *   yesterday     → "Yesterday"
 *   ≤7 days ago   → weekday name ("Tuesday")
 *   older         → "12 Jan 2025"
 */
function sectionKey(ts: any): string {
  const d = toDate(ts);
  if (!d) return 'Unknown';
  const today = new Date();
  const days = Math.floor((today.getTime() - d.getTime()) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Sorts section keys newest-first:
 *   Today > Yesterday > weekday names (by distance) > formatted dates (desc)
 *
 * The original code had `return 0` for non-Today/Yesterday keys, which left
 * older dates in arbitrary insertion order. This version sorts them properly.
 */
function sortKeys(keys: string[]): string[] {
  const FIXED: Record<string, number> = {
    Today: 0,
    Yesterday: 1,
    // Weekday names are 2–8; we keep them as-is and resolve below
  };
  const WEEKDAYS = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];

  return [...keys].sort((a, b) => {
    // Fixed labels first
    const oa = FIXED[a];
    const ob = FIXED[b];
    if (oa !== undefined && ob !== undefined) return oa - ob;
    if (oa !== undefined) return -1;
    if (ob !== undefined) return 1;

    // Weekday names second (closer day = smaller index = first)
    const wa = WEEKDAYS.indexOf(a);
    const wb = WEEKDAYS.indexOf(b);
    if (wa !== -1 && wb !== -1) return wa - wb;
    if (wa !== -1) return -1;
    if (wb !== -1) return 1;

    // Formatted date strings last, sorted descending (newer first)
    const da = new Date(a);
    const db = new Date(b);
    if (!isNaN(da.getTime()) && !isNaN(db.getTime()))
      return db.getTime() - da.getTime();
    return a.localeCompare(b);
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Calls() {
  const navigation = useNavigation<CallsNavigationProp>();
  const { user } = useAuth();
  const [calls, setCalls] = useState<CallHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Initial load + real-time subscription
    callHistoryService
      .getCallHistory(user.uid, 30)
      .then(setCalls)
      .catch(console.error);
    return callHistoryService.listenToCallHistory(user.uid, setCalls);
  }, [user]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openChat = useCallback(
    (item: CallHistoryItem) => {
      const isCaller = item.callerId === user?.uid;
      navigation.navigate('userMsg', {
        userData: {
          uid: isCaller ? item.calleeId : item.callerId,
          name: isCaller ? item.calleeName : item.callerName,
          profile_image: isCaller ? item.calleeAvatar : item.callerAvatar,
        },
      });
    },
    [user, navigation],
  );


const confirmDelete = useCallback(async (callId: string) => {
  Alert.alert('Delete record', 'Remove this call from your history?', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        try {
          await callHistoryService.deleteCallRecord(callId);
          // The real-time listener will automatically update the UI
          console.log('Call record deletion initiated for ID:', callId);
        } catch (error) {
          console.error('Failed to delete call record:', error);
          Alert.alert('Error', 'Failed to delete call record. Please try again.');
        }
      },
    },
  ]);
}, []);

  // ── Row renderer (memoised per uid to avoid re-renders) ───────────────────

  const renderRow = useCallback(
    ({ item }: { item: CallHistoryItem }) => {
      const isCaller = item.callerId === user?.uid;
      const name = isCaller ? item.calleeName : item.callerName;
      const avatar = isCaller ? item.calleeAvatar : item.callerAvatar;
      const display = getStatusDisplay(item, user?.uid);
      const missed = isMissed(item.callStatus);

      return (
        <TouchableOpacity
          style={styles.row}
          onPress={() => openChat(item)}
          onLongPress={() => confirmDelete(item.id)}
          activeOpacity={0.65}
        >
          {/* Avatar + call-type pip */}
          <View style={styles.avatarWrap}>
            
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>
                  {(name ?? '?')[0].toUpperCase()}
                </Text>
              </View>
           
            <View style={[styles.typePip, missed && styles.typePipMissed]}>
              <Feather
                name={item.callType === 'video' ? 'video' : 'phone'}
                size={9}
                color="#fff"
              />
            </View>
          </View>

          {/* Name + status label */}
          <View style={styles.info}>
            <Text
              style={[styles.name, missed && styles.nameMissed]}
              numberOfLines={1}
            >
              {name}
            </Text>
            <View style={styles.subRow}>
               {/* <View style={[styles.typePip, missed && styles.typePipMissed]}>
              <Feather
                name={item.callType === 'video' ? 'video' : 'phone'}
                size={9}
                color="#fff"
              />
            </View> */}
              <Text
                style={[styles.subText, missed && styles.subTextMissed]}
                numberOfLines={1}
              >
                {'  '}
                {display.label}
                {item.duration ? `  ·  ${fmtDuration(item.duration)}` : ''}
              </Text>
            </View>
          </View>

          {/* Time + info tap target */}
          <View style={styles.rightCol}>
            <Text style={[styles.time, missed && styles.timeMissed]}>
              {fmtTime(item.timestamp)}
            </Text>
            {/* <TouchableOpacity
              onPress={() => confirmDelete(item.id)}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 0 }}
            >
              <Feather name="trash-2" size={17} color="rgb(212, 9, 9)" />
            </TouchableOpacity> */}
          </View>
        </TouchableOpacity>
      );
    },
    [user, openChat, confirmDelete],
  );

  // ── Sections for history view ──────────────────────────────────────────────

  const sections = useMemo(() => {
    const grouped: Record<string, CallHistoryItem[]> = {};
    calls.forEach(c => {
      const key = sectionKey(c.timestamp);
      (grouped[key] = grouped[key] ?? []).push(c);
    });
    return sortKeys(Object.keys(grouped)).map(title => ({
      title,
      data: grouped[title],
    }));
  }, [calls]);

  const recentCalls = useMemo(() => calls.slice(0, 10), [calls]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* ── App bar ──────────────────────────────────────────────────── */}
        <View style={styles.appBar}>
          <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
            <Feather name="search" size={19} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.appBarTitle}>Calls</Text>

          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            onPress={() => setShowHistory(v => !v)}
          >
            {/* Clock = view full history; List = back to recent */}
            <Feather
              name={showHistory ? 'list' : 'clock'}
              size={19}
              color="#fff"
            />
          </TouchableOpacity>
        </View>

        {/* ── White sheet ──────────────────────────────────────────────── */}
        <View style={styles.sheet}>
          {showHistory ? (
            /* Full history grouped by date */
            calls.length === 0 ? (
              <EmptyState />
            ) : (
              <SectionList
                sections={sections}
                keyExtractor={item => item.id}
                renderItem={renderRow}
                renderSectionHeader={({ section }) => (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionHeaderText}>
                      {section.title}
                    </Text>
                  </View>
                )}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                stickySectionHeadersEnabled={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 32 }}
                ListHeaderComponent={
                  <View style={styles.sheetHeader}>
                    <Text style={styles.sheetTitle}>All Calls</Text>
                  
                  </View>
                }
              />
            )
          ) : (
            /* Recent calls — latest 10 */
            <FlatList
              data={recentCalls}
              keyExtractor={item => item.id}
              renderItem={renderRow}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 32 }}
              ListEmptyComponent={<EmptyState />}
              ListHeaderComponent={
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>Recent</Text>
                  {calls.length > 10 && (
                    <TouchableOpacity onPress={() => setShowHistory(true)}>
                      <Text style={styles.seeAll}>See all</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <Feather name="phone-off" size={32} color="#C7C7CC" />
      </View>
      <Text style={styles.emptyTitle}>No calls yet</Text>
      <Text style={styles.emptySub}>Your call history will appear here</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // App bar
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 100,
    backgroundColor: '#000',
  },
  appBarTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // White sheet
  sheet: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 10,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  sheetHint: { fontSize: 12, color: '#AEAEB2' },
  seeAll: { fontSize: 13, color: '#128C7E', fontWeight: '600' },

  // Section header
  sectionHeader: {
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 18,
    paddingVertical: 5,
    marginTop: 4,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6D6D72',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 11,
    backgroundColor: '#fff',
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E5EA',
    marginLeft: 84, // indent to avatar right edge
  },

  // Avatar + pip
  avatarWrap: { width: 52, height: 52, marginRight: 14, position: 'relative' },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: { fontSize: 22, color: '#fff', fontWeight: '700' },
  typePip: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  typePipMissed: { backgroundColor: RED },

  // Info column
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: '#111', marginBottom: 3 },
  nameMissed: { color: '#111' }, // name stays black even for missed — only icon+label go red
  subRow: { flexDirection: 'row', alignItems: 'center' },
  subText: { fontSize: 13, color: '#636366' },
  subTextMissed: { color: RED },

  // Right column
  rightCol: { alignItems: 'flex-end', gap: 6, minWidth: 56 },
  time: { fontSize: 12, color: GREY },
  timeMissed: { color: RED },

  // Empty state
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#3C3C43',
    marginBottom: 6,
  },
  emptySub: { fontSize: 14, color: '#AEAEB2' },
});
