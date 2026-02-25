import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  Vibration,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../../core/context/AuthContext';
import firestore from '@react-native-firebase/firestore';
import { notificationService } from '../../core/services/notification.service';
import Feather from 'react-native-vector-icons/Feather';

let InCallManager: any = null;
try {
  InCallManager = require('react-native-incall-manager').default;
} catch (_) {}

const { width } = Dimensions.get('window');
const AUTO_DECLINE_SEC = 60;

// ── Vibration pattern matching WhatsApp's incoming call pulse ─────────────────
const VIBRATION_PATTERN = [0, 400, 200, 400, 200, 400];

const IncomingCallScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { user } = useAuth();

  const {
    callId,
    callerId,
    callerName,
    callerAvatar,
    type = 'video',
  } = route.params as {
    callId: string;
    callerId: string;
    callerName: string;
    callerAvatar?: string;
    type?: 'video' | 'audio';
  };

  const [avatar, setAvatar] = useState<string | undefined>(callerAvatar);
  const [timeLeft, setTimeLeft] = useState(AUTO_DECLINE_SEC);
  const [accepting, setAccepting] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  // NEW: second outer ring for more WhatsApp-like pulse effect
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const pulseOpacity2 = useRef(new Animated.Value(0.6)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handledRef = useRef(false);
  const vibrationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // ── Start ringtone ─────────────────────────────────────────────────────
    if (InCallManager) InCallManager.startRingtone('_BUNDLE_');

    // ── NEW: Vibration pattern (repeating) ────────────────────────────────
    Vibration.vibrate(VIBRATION_PATTERN, true);

    // ── Inner pulse ────────────────────────────────────────────────────────
    const innerPulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.10, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );

    // ── NEW: Outer expanding ring (like WhatsApp) ──────────────────────────
    const outerPulse = Animated.loop(
      Animated.parallel([
        Animated.timing(pulseAnim2, { toValue: 1.35, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulseOpacity2, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );

    innerPulse.start();
    outerPulse.start();
    loadAvatar();

    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          rejectCall();
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => {
      innerPulse.stop();
      outerPulse.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      if (InCallManager) InCallManager.stopRingtone();
      Vibration.cancel();
    };
  }, []);

  const loadAvatar = async () => {
    if (callerAvatar) return;
    try {
      const doc = await firestore().collection('users').doc(callerId).get();
      if (doc.exists()) {
        const data = doc.data();
        if (data?.profile_image) setAvatar(data.profile_image);
      }
    } catch (_) {}
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  ACCEPT — order is critical:
  //  1. await write status='answered'  → unblocks caller's snapshot listener
  //  2. navigate immediately after the await
  //  3. clearIncomingCall AFTER navigation (fire-and-forget)
  // ─────────────────────────────────────────────────────────────────────────
  const acceptCall = async () => {
    if (handledRef.current) return;
    handledRef.current = true;
    setAccepting(true);

    if (timerRef.current) clearInterval(timerRef.current);
    if (InCallManager) InCallManager.stopRingtone();
    Vibration.cancel();

    try {
      // Step 1 — unlock the caller (MUST be awaited)
      await firestore()
        .collection('calls')
        .doc(callId)
        .update({
          status: 'answered',
          answeredAt: firestore.FieldValue.serverTimestamp(),
          [`participants.${user?.uid}.answeredAt`]: firestore.FieldValue.serverTimestamp(),
        });
      console.log('[IncomingCall] status=answered written to Firestore');
    } catch (err) {
      console.error('[IncomingCall] Failed to write answered status:', err);
      // Still navigate — call may recover on good network
    }

    // Step 2 — navigate into call screen
    const screen = type === 'video' ? 'videoCall' : 'voiceCall';
    navigation.replace(screen, {
      userData: { uid: callerId, name: callerName, profile_image: avatar },
      isIncomingCall: true,
      callId,
    });

    // Step 3 — clear notification badge AFTER navigation (non-blocking)
    if (user) {
      notificationService.clearIncomingCall(user.uid).catch(() => {});
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  REJECT
  // ─────────────────────────────────────────────────────────────────────────
  const rejectCall = async () => {
    if (handledRef.current) return;
    handledRef.current = true;

    if (timerRef.current) clearInterval(timerRef.current);
    if (InCallManager) InCallManager.stopRingtone();
    Vibration.cancel();

    try {
      await firestore()
        .collection('calls')
        .doc(callId)
        .update({
          status: 'ended',
          [`participants.${user?.uid}.rejectedAt`]: firestore.FieldValue.serverTimestamp(),
          endedAt: firestore.FieldValue.serverTimestamp(),
        });

      // Notify caller of missed call
      const callSnap = await firestore().collection('calls').doc(callId).get();
      const data = callSnap.data();
      const initiator = data?.callerId ?? data?.initiatedBy;
      if (initiator && initiator !== user?.uid) {
        await notificationService.sendMissedCallNotification({
          receiverId: initiator,
          callerName,
          callId,
        });
      }
      if (user) await notificationService.clearIncomingCall(user.uid);
    } catch (error) {
      console.error('[IncomingCall] Error rejecting call:', error);
    }

    navigation.goBack();
  };

  // ── Progress ring for auto-decline countdown ───────────────────────────────
  const progressRatio = timeLeft / AUTO_DECLINE_SEC;

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      <View style={styles.callerSection}>
        {/* Outer expanding pulse ring — WhatsApp style */}
        <Animated.View
          style={[
            styles.avatarRingOuter,
            {
              transform: [{ scale: pulseAnim2 }],
              opacity: pulseOpacity2,
            },
          ]}
        />

        {/* Inner pulsing ring */}
        <Animated.View
          style={[styles.avatarRing, { transform: [{ scale: pulseAnim }] }]}
        >
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarLetter}>
                {(callerName?.[0] ?? 'U').toUpperCase()}
              </Text>
            </View>
          )}
        </Animated.View>

        <Text style={styles.callerName}>{callerName ?? 'Unknown'}</Text>

        <View style={styles.badge}>
          <Feather name={type === 'video' ? 'video' : 'phone'} size={13} color="#fff" />
          <Text style={styles.badgeText}>
            Incoming {type === 'video' ? 'video' : 'voice'} call
          </Text>
        </View>

        {/* NEW: thin progress bar showing auto-decline countdown */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressRatio * 100}%` as any }]} />
        </View>
        <Text style={styles.autoDecline}>Auto-declining in {timeLeft}s</Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.actionItem}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.declineBtn]}
            onPress={rejectCall}
            activeOpacity={0.8}
            disabled={accepting}
          >
            <Feather name="phone-off" size={30} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Decline</Text>
        </View>

        <View style={styles.actionItem}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.acceptBtn, accepting && styles.acceptBtnBusy]}
            onPress={acceptCall}
            activeOpacity={0.8}
            disabled={accepting}
          >
            {accepting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name={type === 'video' ? 'video' : 'phone'} size={30} color="#fff" />
            )}
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Accept</Text>
        </View>
      </View>
    </View>
  );
};

export default IncomingCallScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0e1117',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 80,
  },
  callerSection: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },

  // NEW: outer expanding ring (WhatsApp-style)
  avatarRingOuter: {
    top:70,
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: '#4caf50',
    backgroundColor: 'rgba(76,175,80,0.08)',
  },

  avatarRing: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 3,
    borderColor: '#4caf50',
    marginBottom: 28,
    overflow: 'hidden',
  },
  avatar: { width: '100%', height: '100%' },
  avatarFallback: {
    flex: 1,
    backgroundColor: '#1e3a2f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: 64, color: '#4caf50', fontWeight: '700' },
  callerName: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(76,175,80,0.2)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.4)',
    marginBottom: 24,
  },
  badgeText: { color: '#aee6b0', fontSize: 14, fontWeight: '500' },

  // NEW: countdown progress bar
  progressTrack: {
    width: 180,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    marginBottom: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4caf50',
    borderRadius: 2,
  },
  autoDecline: { color: '#555', fontSize: 13 },

  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: width * 0.7,
    marginBottom: 20,
  },
  actionItem: { alignItems: 'center', gap: 10 },
  actionBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  declineBtn: { backgroundColor: '#e53935', shadowColor: '#e53935' },
  acceptBtn: { backgroundColor: '#43a047', shadowColor: '#43a047' },
  acceptBtnBusy: { backgroundColor: '#2e7d32', shadowColor: '#2e7d32' },
  actionLabel: { color: '#aaa', fontSize: 13, fontWeight: '500' },
});
