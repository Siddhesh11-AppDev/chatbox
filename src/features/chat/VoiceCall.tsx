import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  PermissionsAndroid,
  Platform,
  StatusBar,
  Animated,
  AppState,
  Linking,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { mediaDevices, MediaStream } from 'react-native-webrtc';
import Feather from 'react-native-vector-icons/Feather';
import {
  FirebaseWebRTCService,
  NetworkStats,
} from '../../core/services/FirebaseWebRTCService';
import { useAuth } from '../../core/context/AuthContext';
import firestore from '@react-native-firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { notificationService } from '../../core/services/notification.service';
import { callHistoryService } from '../../core/services/callHistory.service';
import type { CallHistoryItem } from '../chat/UserMessage';

let InCallManager: any = null;
try {
  InCallManager = require('react-native-incall-manager').default;
} catch (_) {}

type ConnectionState =
  | 'initializing'
  | 'new'
  | 'checking'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

const STATUS_LABEL: Record<string, string> = {
  initializing: 'Initializing…',
  new: 'Setting up…',
  checking: 'Checking connection…',
  connecting: 'Connecting to peer…',
  connected: '',
  disconnected: 'Reconnecting…',
  failed: 'Connection failed',
  closed: 'Call ended',
};

const QUALITY_BARS: Record<string, number> = { good: 3, fair: 2, poor: 1 };
const QUALITY_COLORS: Record<string, string> = {
  good: '#43d16e',
  fair: '#f5a623',
  poor: '#e53935',
};

const VoiceCall = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const {
    userData,
    isIncomingCall,
    callId: incomingCallId,
  } = route.params as {
    userData: { uid: string; name: string; profile_image?: string };
    isIncomingCall?: boolean;
    callId?: string;
  };
  const { user, userProfile } = useAuth();

  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('initializing');
  const [callDuration, setCallDuration] = useState(0);
  const [callStatus, setCallStatus] = useState('initializing');
  // ── NEW: network quality + speaking indicator ─────────────────────────────
  const [networkQuality, setNetworkQuality] = useState<
    'good' | 'fair' | 'poor' | null
  >(null);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);

  const webRTCServiceRef = useRef<FirebaseWebRTCService | null>(null);
  const callIdRef = useRef('');
  const isCallerRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acceptListenerRef = useRef<(() => void) | null>(null);
  const cleanedRef = useRef(false);
  const pendingOfferRef = useRef<any>(null);
  const readyToAnswerRef = useRef(false);
  // ── FIX: Use mountedRef instead of closure `cancelled` variable ───────────
  // The `cancelled` closure pattern breaks when doCleanup() is called from
  // outside the init closure. mountedRef is always reachable via the ref.
  const mountedRef = useRef(true);
  // ── NEW: speaking detection + pulse animation ─────────────────────────────
  const speakingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingPulse = useRef(new Animated.Value(1)).current;
  const connectionStateRef = useRef<ConnectionState>('initializing');
  // ── Call-history tracking refs ────────────────────────────────────────────
  const callWasAnsweredRef = useRef(false);
  const callDurationRef = useRef(0);

  // ── NEW: Speaking pulse animation ─────────────────────────────────────────
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    if (remoteSpeaking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(speakingPulse, {
            toValue: 1.12,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(speakingPulse, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      speakingPulse.stopAnimation();
      Animated.spring(speakingPulse, {
        toValue: 1,
        useNativeDriver: true,
      }).start();
    }
  }, [remoteSpeaking]);

  // ── NEW: AppState — keep audio session alive in background ────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (!mountedRef.current) return;
      if (nextState === 'active' && InCallManager) {
        // Re-apply audio routing when app comes back to foreground
        InCallManager.setForceSpeakerphoneOn(isSpeaker);
      }
    });
    return () => sub.remove();
  }, [isSpeaker]);

  // ── INIT ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    cleanedRef.current = false;

    // ── FIX: Start InCallManager audio session IMMEDIATELY on mount ──────────
    // iOS requires the audio session to be configured before any stream or
    // peer connection work. Starting it here (not after stream setup) ensures
    // correct routing from the first media packet.
    if (InCallManager) {
      InCallManager.start({ media: 'audio' });
      InCallManager.setForceSpeakerphoneOn(false); // earpiece default for voice
    }

    const init = async () => {
      try {
        await requestPermissions();

        const callId =
          isIncomingCall && incomingCallId
            ? incomingCallId
            : firestore().collection('calls').doc().id;
        callIdRef.current = callId;

        const isCaller = !isIncomingCall;
        isCallerRef.current = isCaller;
        console.log(`[VoiceCall] init — isCaller:${isCaller} callId:${callId}`);

        const service = new FirebaseWebRTCService(
          callId,
          user!.uid,
          // onRemoteStream — audio only, no RTCView needed
          (_stream: MediaStream) => {
            console.log('[VoiceCall] Remote stream received');
            // ── NEW: start speaking detection ─────────────────────────────
            startSpeakingDetection();
          },
          // onConnectionStateChange
          (state: string) => {
            if (!mountedRef.current) return;
            console.log('[VoiceCall] Connection state →', state);
            setConnectionState(state as ConnectionState);
            if (state === 'connected') {
              setCallStatus('connected');
              if (InCallManager)
                InCallManager.setForceSpeakerphoneOn(isSpeaker);
            }
            if (state === 'closed') doCleanup().then(() => navigation.goBack());
          },
          // onError
          (err: string) => {
            if (!mountedRef.current) return;
            handleError(err);
          },
          // onOfferReceived (callee only)
          isCaller ? undefined : handleOfferReceived,
          // ── NEW: onNetworkStats ──────────────────────────────────────────
          (stats: NetworkStats) => {
            if (!mountedRef.current) return;
            setNetworkQuality(stats.quality);
          },
        );
        webRTCServiceRef.current = service;

        // ── CALLER FLOW ───────────────────────────────────────────────────
        if (isCaller) {
          setCallStatus('calling');

          const callerName =
            userProfile?.name || user?.displayName || user?.email || 'User';
          await notificationService.sendCallNotification({
            receiverId: userData.uid,
            callerId: user!.uid,
            callerName,
            callerAvatar: userProfile?.profile_image,
            callId,
            callType: 'audio',
          });
          console.log('[VoiceCall] Call notification sent');

          if (!mountedRef.current) return;

          await service.initialize(true);
          console.log('[VoiceCall] Caller initialized');

          if (!mountedRef.current) return;

          // ── FIX: Get local stream with proper audio constraints ────────────
          const stream = await getLocalStream();
          if (!mountedRef.current) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          localStreamRef.current = stream;
          await service.addLocalStream(stream);

          // 60-second no-answer timeout
          callTimeoutRef.current = setTimeout(() => {
            if (!mountedRef.current) return;
            Alert.alert('No Answer', 'The call was not answered.', [
              {
                text: 'OK',
                onPress: () => {
                  doCleanup();
                  navigation.goBack();
                },
              },
            ]);
          }, 60000);

          // Wait for callee to accept (status='answered'), then create offer
          acceptListenerRef.current = firestore()
            .collection('calls')
            .doc(callId)
            .onSnapshot(doc => {
              if (!mountedRef.current) return;
              const status = doc.data()?.status;
              console.log('[VoiceCall] Call doc status →', status);

              if (status === 'answered') {
                callWasAnsweredRef.current = true; // ← definitive "call connected" signal
                if (callTimeoutRef.current) {
                  clearTimeout(callTimeoutRef.current);
                  callTimeoutRef.current = null;
                }
                const unsub = acceptListenerRef.current;
                acceptListenerRef.current = null;
                unsub?.();

                setConnectionState('connecting');
                setCallStatus('connecting');

                console.log('[VoiceCall] Callee answered — creating offer');
                service.createOffer(true).catch(err => {
                  if (!mountedRef.current) return;
                  console.error('[VoiceCall] createOffer failed:', err);
                  handleError('Failed to start call: ' + err.message);
                });
              } else if (status === 'ended') {
                if (callTimeoutRef.current) {
                  clearTimeout(callTimeoutRef.current);
                  callTimeoutRef.current = null;
                }
                const unsub = acceptListenerRef.current;
                acceptListenerRef.current = null;
                unsub?.();
                if (mountedRef.current)
                  doCleanup().then(() => navigation.goBack());
              }
            });

          // ── CALLEE FLOW ───────────────────────────────────────────────────
        } else {
          setCallStatus('receiving');

          await service.initialize(false);
          console.log('[VoiceCall] Callee initialized');

          if (!mountedRef.current) return;

          const stream = await getLocalStream();
          if (!mountedRef.current) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          localStreamRef.current = stream;
          await service.addLocalStream(stream);

          readyToAnswerRef.current = true;
          console.log(
            '[VoiceCall] Callee ready. Pending offer:',
            !!pendingOfferRef.current,
          );
          if (pendingOfferRef.current) {
            await service.handleRemoteOffer(pendingOfferRef.current);
            pendingOfferRef.current = null;
          }

          // Watch for caller cancelling
          const unsubCancel = notificationService.listenForCallCancellation(
            callId,
            () => {
              if (mountedRef.current)
                doCleanup().then(() => navigation.goBack());
            },
          );
          (callIdRef as any).cancelUnsub = unsubCancel;
        }
      } catch (err: any) {
        if (mountedRef.current) {
          console.error('[VoiceCall] Init error:', err);
          Alert.alert('Error', 'Could not start call: ' + err.message);
          navigation.goBack();
        }
      }
    };

    init();
    return () => {
      mountedRef.current = false;
      doCleanup();
    };
  }, []);

  // ── Duration timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (connectionState === 'connected') {
      callTimerRef.current = setInterval(() => {
        setCallDuration(d => {
          const next = d + 1;
          callDurationRef.current = next;
          return next;
        });
      }, 1000);
      if (InCallManager) InCallManager.setForceSpeakerphoneOn(isSpeaker);
    } else {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    }
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, [connectionState]);

  // ── NEW: Speaking detection via network stats proxy ───────────────────────
  const startSpeakingDetection = () => {
    speakingTimerRef.current = setInterval(async () => {
      if (!mountedRef.current || !webRTCServiceRef.current) return;
      try {
        const stats = await webRTCServiceRef.current.getNetworkStats();
        if (!stats) return;
        setRemoteSpeaking(stats.jitter > 0.005);
      } catch (_) {}
    }, 600);
  };

  // ── Offer handler (callee only) ────────────────────────────────────────────
  const handleOfferReceived = async (offerData: any) => {
    console.log(
      '[VoiceCall] Offer arrived. ready:',
      readyToAnswerRef.current,
      'has offer:',
      !!offerData?.offer,
    );
    if (!readyToAnswerRef.current) {
      pendingOfferRef.current = offerData.offer ?? offerData;
      return;
    }
    try {
      await webRTCServiceRef.current?.handleRemoteOffer(
        offerData.offer ?? offerData,
      );
    } catch (err) {
      handleError('Failed to connect to call');
    }
  };

  const handleError = (error: string) => {
    if (!error.includes('disconnected') && !error.includes('closed')) {
      Alert.alert('Call Error', error, [
        {
          text: 'End Call',
          onPress: () => doCleanup().then(() => navigation.goBack()),
        },
      ]);
    }
  };

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const doCleanup = async () => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    if (acceptListenerRef.current) {
      acceptListenerRef.current();
      acceptListenerRef.current = null;
    }
    if (speakingTimerRef.current) {
      clearInterval(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }

    const cancelUnsub = (callIdRef as any).cancelUnsub;
    if (cancelUnsub) {
      cancelUnsub();
      (callIdRef as any).cancelUnsub = null;
    }

    if (InCallManager) InCallManager.stop();

    if (webRTCServiceRef.current) {
      await webRTCServiceRef.current.endCall();
      webRTCServiceRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    // ── Save this user's call history record ──────────────────────────────
    try {
      if (user && userData) {
        const isCaller = isCallerRef.current;
        const answered = callWasAnsweredRef.current;
        const duration = callDurationRef.current;
        const myName = userProfile?.name || user?.displayName || user?.email || 'User';

        const callRecordStatus: 'outgoing' | 'received' | 'missed' = isCaller
          ? answered ? 'outgoing' : 'missed'
          : answered ? 'received' : 'missed';

        await callHistoryService.saveCallRecord({
          ownerId: user.uid,
          participants: [user.uid, userData.uid],
          callerId: isCaller ? user.uid : userData.uid,
          calleeId: isCaller ? userData.uid : user.uid,
          callerName: isCaller ? myName : userData.name,
          calleeName: isCaller ? userData.name : myName,
          callerAvatar: isCaller ? userProfile?.profile_image : userData.profile_image,
          calleeAvatar: isCaller ? userData.profile_image : userProfile?.profile_image,
          callType: 'audio',
          callStatus: callRecordStatus,
          duration,
        });
      }
    } catch (error) {
      console.error('Error saving call record:', error);
    }

    try {
      if (!isCallerRef.current && user)
        await notificationService.clearIncomingCall(user.uid);
      else if (isCallerRef.current && userData?.uid)
        await notificationService.cancelCallNotification(
          callIdRef.current,
          userData.uid,
        );
    } catch (_) {}

    notificationService.resetCallState();
  };

  const endCall = async () => {
    await doCleanup();
    navigation.goBack();
    navigation.navigate('userMsg', { userData });
  };

  // ── Controls ───────────────────────────────────────────────────────────────
  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => {
      t.enabled = !t.enabled;
    });
    setIsMuted(m => !m);
  };

  const toggleSpeaker = () => {
    if (InCallManager) {
      const next = !isSpeaker;
      InCallManager.setForceSpeakerphoneOn(next);
      setIsSpeaker(next);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const audioPermission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
      const result = await PermissionsAndroid.request(audioPermission);
      if (result !== 'granted') {
        Alert.alert(
          'Microphone Permission Required',
          'The microphone permission is required for voice calls.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => navigation.goBack(),
            },
            {
              text: 'Settings',
              onPress: () => {
                Linking.openSettings();
                setTimeout(() => navigation.goBack(), 1000);
              },
            },
          ],
        );
        throw new Error('Microphone permission is required.');
      }
    }
    return true;
  };

  // ── FIX: Audio constraints — echoCancellation + noiseSuppression ──────────
  // This is the most impactful audio quality change. Without these constraints,
  // getUserMedia returns a raw audio track with no DSP — echo, noise, and
  // volume fluctuations are all unmanaged. These match WhatsApp's profile.
  const getLocalStream = async (): Promise<MediaStream> => {
    const s = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1, // mono — halves bitrate, no quality loss for voice
      } as any,
      video: false,
    });
    return s as unknown as MediaStream;
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(
      2,
      '0',
    )}`;

  // ── Render ─────────────────────────────────────────────────────────────────
  const isConnected = connectionState === 'connected';
  const statusLabel = isConnected
    ? formatTime(callDuration)
    : callStatus === 'calling'
    ? 'Ringing…'
    : STATUS_LABEL[connectionState] ?? connectionState;

  const qualityBars = networkQuality ? QUALITY_BARS[networkQuality] : null;
  const qualityColor = networkQuality ? QUALITY_COLORS[networkQuality] : '#fff';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar
        hidden={false}
        backgroundColor="#1a1a2e"
        barStyle="light-content"
      />

      <View style={styles.callInfo}>
        {/* NEW: speaking pulse ring around avatar */}
        <Animated.View
          style={[
            styles.avatarRingOuter,
            // remoteSpeaking && { transform: [{ scale: speakingPulse }] },
            // remoteSpeaking ? styles.avatarRingActive : styles.avatarRingIdle,
          ]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>
              {(userData?.name?.[0] ?? 'U').toUpperCase()}
            </Text>
          </View>
        </Animated.View>

        <Text style={styles.name}>{userData?.name ?? 'User'}</Text>
        <Text style={styles.status}>{statusLabel}</Text>

        {/* NEW: network quality signal bars */}
        {isConnected && qualityBars !== null && (
          <View style={styles.qualityRow}>
            {[1, 2, 3].map(i => (
              <View
                key={i}
                style={[
                  styles.qualityBar,
                  { height: 6 + i * 5 },
                  {
                    backgroundColor:
                      i <= qualityBars ? qualityColor : 'rgba(255,255,255,0.2)',
                  },
                ]}
              />
            ))}
            <Text style={[styles.qualityLabel, { color: qualityColor }]}>
              {networkQuality === 'good'
                ? 'Excellent'
                : networkQuality === 'fair'
                ? 'Fair'
                : 'Poor'}
            </Text>
          </View>
        )}

      
      </View>

      <View style={styles.controls}>
        <View style={styles.controlRow}>
          <ControlBtn
            icon={isMuted ? 'mic-off' : 'mic'}
            label={isMuted ? 'Unmute' : 'Mute'}
            onPress={toggleMute}
            danger={isMuted}
          />
          <ControlBtn
            icon={isSpeaker ? 'volume-2' : 'volume-x'}
            label={isSpeaker ? 'Speaker' : 'Earpiece'}
            onPress={toggleSpeaker}
            active={isSpeaker}
          />
        </View>
        <View style={styles.centerButton}>
          <TouchableOpacity
            style={styles.endCallBtn}
            onPress={endCall}
            activeOpacity={0.8}
          >
            <Feather name="phone-off" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

interface CBProps {
  icon: string;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
}
const ControlBtn = ({ icon, label, onPress, active, danger }: CBProps) => (
  <TouchableOpacity
    style={styles.controlBtnWrapper}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View
      style={[
        styles.controlBtnCircle,
        active && styles.controlBtnActive,
        danger && styles.controlBtnDanger,
      ]}
    >
      <Feather name={icon} size={22} color="#fff" />
    </View>
    <Text style={styles.controlBtnLabel}>{label}</Text>
  </TouchableOpacity>
);

export default VoiceCall;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1a1a2e' },
  callInfo: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },

  // NEW: outer animated ring for speaking indicator
  avatarRingOuter: {
    padding: 6,
    borderRadius: 70,
    // borderWidth: 3,
    marginBottom: 18,
  },
  // avatarRingIdle: { borderColor: 'transparent' },
  // avatarRingActive: { borderColor: '#43d16e' },

  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2d2d4e',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#4a9fff',
  },
  avatarLetter: { fontSize: 52, color: '#fff', fontWeight: '700' },
  name: { color: '#fff', fontSize: 28, fontWeight: '600', marginBottom: 8 },
  status: { color: '#8899bb', fontSize: 15, marginBottom: 16 },

  // NEW: quality bars
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    marginTop: 8,
  },
  qualityBar: { width: 5, borderRadius: 3 },
  qualityLabel: { fontSize: 12, marginLeft: 6, fontWeight: '500' },

  // NEW: speaking badge
  speakingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    backgroundColor: 'rgba(67,209,110,0.15)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(67,209,110,0.4)',
    gap: 6,
  },
  speakingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#43d16e',
  },
  speakingText: { color: '#43d16e', fontSize: 13, fontWeight: '500' },

  controls: { paddingBottom: 48, paddingTop: 20, paddingHorizontal: 24 },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 30,
  },
  centerButton: { alignItems: 'center', marginBottom: 30 },
  controlBtnWrapper: { alignItems: 'center', width: 72 },
  controlBtnCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  controlBtnActive: {
    backgroundColor: 'rgba(74,159,255,0.45)',
    borderWidth: 1,
    borderColor: '#4a9fff',
  },
  controlBtnDanger: {
    backgroundColor: 'rgba(255,60,60,0.45)',
    borderWidth: 1,
    borderColor: '#ff3c3c',
  },
  controlBtnLabel: {
    color: '#dde5ff',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
  },
  endCallBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#e53935',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#e53935',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 8,
  },
});