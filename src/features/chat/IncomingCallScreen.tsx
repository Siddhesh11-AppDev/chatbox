

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
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../../core/context/AuthContext';
import firestore from '@react-native-firebase/firestore';
import { notificationService } from '../../core/services/notification.service';
import Feather from 'react-native-vector-icons/Feather';

let InCallManager: any = null;
try { InCallManager = require('react-native-incall-manager').default; } catch (_) {}

const { width } = Dimensions.get('window');
const AUTO_DECLINE_SEC = 60;

const IncomingCallScreen = () => {
  const navigation = useNavigation<any>();
  const route      = useRoute();
  const { user }   = useAuth();

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

  const [avatar, setAvatar]     = useState<string | undefined>(callerAvatar);
  const [timeLeft, setTimeLeft] = useState(AUTO_DECLINE_SEC);
  const pulseAnim  = useRef(new Animated.Value(1)).current;
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (InCallManager) InCallManager.startRingtone('_BUNDLE_');

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.14, duration: 650, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 650, useNativeDriver: true }),
      ])
    );
    pulse.start();

    loadAvatar();

    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { rejectCall(); return 0; }
        return t - 1;
      });
    }, 1000);

    return () => {
      pulse.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      if (InCallManager) InCallManager.stopRingtone();
    };
  }, []);

  const loadAvatar = async () => {
    if (callerAvatar) return;
    try {
      const doc = await firestore().collection('users').doc(callerId).get();
      if (doc.exists()) {
        const data = doc.data();
        if (data && data.profile_image) {
          setAvatar(data.profile_image);
        }
      }
    } catch (_) {}
  };

  // ─────────────────────────────────────────────────────────────────────
  //  ACCEPT
  //  KEY FIX: navigate() is called SYNCHRONOUSLY (no await before it).
  //  clearIncomingCall runs in the background after navigation.
  // ─────────────────────────────────────────────────────────────────────
  const acceptCall = () => {
    if (handledRef.current) return;
    handledRef.current = true;

    if (timerRef.current) clearInterval(timerRef.current);
    if (InCallManager) InCallManager.stopRingtone();

    // Navigate FIRST — no await
    const screen = type === 'video' ? 'videoCall' : 'voiceCall';
    navigation.replace(screen, {
      userData: { uid: callerId, name: callerName, profile_image: avatar },
      isIncomingCall: true,
      callId,
    });

    // Clear Firestore field in background AFTER navigation
    if (user) {
      notificationService.clearIncomingCall(user.uid).catch(() => {});
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  //  REJECT - Enhanced to send proper notifications to both parties
  // ─────────────────────────────────────────────────────────────────────
  const rejectCall = async () => {
    if (handledRef.current) return;
    handledRef.current = true;

    if (timerRef.current) clearInterval(timerRef.current);
    if (InCallManager) InCallManager.stopRingtone();

    try {
      // Update call status to 'ended'
      await firestore().collection('calls').doc(callId).update({
        status: 'ended',
        [`participants.${user?.uid}.rejectedAt`]: firestore.FieldValue.serverTimestamp(),
        endedAt: firestore.FieldValue.serverTimestamp(),
      });

      // Send notification to caller that call was rejected
      const callDoc = await firestore().collection('calls').doc(callId).get();
      const participants = callDoc.data()?.participants || {};
      const callerId = Object.keys(participants).find(uid =>
        participants[uid].userId === callDoc.data()?.initiatedBy
      );

      if (callerId && callerId !== user?.uid) {
        await notificationService.sendMissedCallNotification({
          receiverId: callerId,
          callerName: callerName,
          callId: callId
        });
      }

      if (user) await notificationService.clearIncomingCall(user.uid);
    } catch (error) {
      console.error('Error rejecting call:', error);
    }

    navigation.goBack();
  };

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      <View style={styles.callerSection}>
        <Animated.View style={[styles.avatarRing, { transform: [{ scale: pulseAnim }] }]}>
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

        <Text style={styles.autoDecline}>Auto-declining in {timeLeft}s</Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.actionItem}>
          <TouchableOpacity style={[styles.actionBtn, styles.declineBtn]} onPress={rejectCall} activeOpacity={0.8}>
            <Feather name="phone-off" size={30} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Decline</Text>
        </View>

        <View style={styles.actionItem}>
          <TouchableOpacity style={[styles.actionBtn, styles.acceptBtn]} onPress={acceptCall} activeOpacity={0.8}>
            <Feather name={type === 'video' ? 'video' : 'phone'} size={30} color="#fff" />
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
    marginBottom: 20,
  },
  badgeText: { color: '#aee6b0', fontSize: 14, fontWeight: '500' },
  autoDecline: { color: '#555', fontSize: 13 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: width * 0.7,
    marginBottom: 20,
  },
  actionItem: { alignItems: 'center', gap: 10 },
  actionBtn: {
    width: 76, height: 76, borderRadius: 38,
    justifyContent: 'center', alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 8, elevation: 8,
  },
  declineBtn: { backgroundColor: '#e53935', shadowColor: '#e53935' },
  acceptBtn:  { backgroundColor: '#43a047', shadowColor: '#43a047' },
  actionLabel: { color: '#aaa', fontSize: 13, fontWeight: '500' },
});