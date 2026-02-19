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
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { mediaDevices, MediaStream } from 'react-native-webrtc';
import Feather from 'react-native-vector-icons/Feather';
import { FirebaseWebRTCService } from '../../core/services/FirebaseWebRTCService';
import { useAuth } from '../../core/context/AuthContext';
import firestore from '@react-native-firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { notificationService } from '../../core/services/notification.service';

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

  // ── INIT ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        await requestPermissions();

        // ── Determine callId ──────────────────────────────────────────────
        // Callee always receives the callId from IncomingCallScreen params.
        // Caller generates a new Firestore doc ID (no timestamp, no race).
        const callId =
          isIncomingCall && incomingCallId
            ? incomingCallId
            : firestore().collection('calls').doc().id;
        callIdRef.current = callId;

        // Caller = not an incoming call. Simple, deterministic.
        const isCaller = !isIncomingCall;
        isCallerRef.current = isCaller;

        console.log(`[VoiceCall] init — isCaller:${isCaller} callId:${callId}`);

        // ── Build WebRTC service ──────────────────────────────────────────
        const service = new FirebaseWebRTCService(
          callId,
          user!.uid,
          (_stream: MediaStream) => {
            // Audio-only: remote stream exists but no video view needed
            console.log('[VoiceCall] Remote stream received');
          },
          (state: string) => {
            if (cancelled) return;
            console.log('[VoiceCall] Connection state →', state);
            setConnectionState(state as ConnectionState);
            if (state === 'connected') setCallStatus('connected');
            if (state === 'closed') doCleanup().then(() => navigation.goBack());
          },
          (err: string) => {
            if (!cancelled) handleError(err);
          },
          isCaller ? undefined : handleOfferReceived,
        );
        webRTCServiceRef.current = service;

        // ── CALLER FLOW ───────────────────────────────────────────────────
        if (isCaller) {
          setCallStatus('calling');

          // Step 1: Send call notification to callee.
          //         This writes the call doc (status:'ringing') AND signals
          //         the callee's user doc (incomingCall field).
          //         We do this BEFORE initialize() so the call doc exists
          //         when initialize() merges the participant data into it.
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

          if (cancelled) return;

          // Step 2: initialize() — builds PC, Firestore listeners, writes
          //         caller participant data into the EXISTING call doc.
          //         Because sendCallNotification already created the doc,
          //         this merge is guaranteed to preserve all fields.
          await service.initialize(true);
          console.log('[VoiceCall] Caller initialized');

          if (cancelled) return;

          // Step 3: Get microphone
          const stream = await getLocalStream();
          if (cancelled) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          localStreamRef.current = stream;
          await service.addLocalStream(stream);

          if (InCallManager) {
            InCallManager.start({ media: 'audio' });
            InCallManager.setForceSpeakerphoneOn(isSpeaker);
          }

          // Step 4: 60-second no-answer timeout
          callTimeoutRef.current = setTimeout(() => {
            if (cancelled) return;
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

          // Step 5: Watch for callee accepting (status='answered')
          //         ONLY then create the WebRTC offer.
          //         This is the gate that synchronises both peers.
          acceptListenerRef.current = firestore()
            .collection('calls')
            .doc(callId)
            .onSnapshot(doc => {
              if (cancelled) return;
              const status = doc.data()?.status;
              console.log('[VoiceCall] Call doc status →', status);

              if (status === 'answered') {
                // Stop the no-answer timer
                if (callTimeoutRef.current) {
                  clearTimeout(callTimeoutRef.current);
                  callTimeoutRef.current = null;
                }
                // Unsubscribe this listener — we only need the trigger once
                const unsub = acceptListenerRef.current;
                acceptListenerRef.current = null;
                unsub?.();

                setConnectionState('connecting');
                setCallStatus('connecting');

                // NOW create offer — callee is ready and waiting
                console.log('[VoiceCall] Callee answered — creating offer');
                service.createOffer(true).catch(err => {
                  if (!cancelled) {
                    console.error('[VoiceCall] createOffer failed:', err);
                    handleError('Failed to start call: ' + err.message);
                  }
                });
              } else if (status === 'ended') {
                if (callTimeoutRef.current) {
                  clearTimeout(callTimeoutRef.current);
                  callTimeoutRef.current = null;
                }
                const unsub = acceptListenerRef.current;
                acceptListenerRef.current = null;
                unsub?.();
                if (!cancelled) doCleanup().then(() => navigation.goBack());
              }
            });

          // ── CALLEE FLOW ───────────────────────────────────────────────────
        } else {
          setCallStatus('receiving');

          // Step 1: initialize() — callee only writes participant metadata,
          //         never touches status (it's already 'answered').
          await service.initialize(false);
          console.log('[VoiceCall] Callee initialized');

          if (cancelled) return;

          // Step 2: Get microphone
          const stream = await getLocalStream();
          if (cancelled) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          localStreamRef.current = stream;
          await service.addLocalStream(stream);

          // Step 3: Mark ready — process any offer that arrived while we were
          //         getting the microphone (race condition safety net)
          readyToAnswerRef.current = true;
          console.log(
            '[VoiceCall] Callee ready. Pending offer:',
            !!pendingOfferRef.current,
          );
          if (pendingOfferRef.current) {
            await service.handleRemoteOffer(pendingOfferRef.current);
            pendingOfferRef.current = null;
          }

          if (InCallManager) {
            InCallManager.start({ media: 'audio' });
            InCallManager.setForceSpeakerphoneOn(isSpeaker);
          }

          // Watch for caller cancelling before offer arrives
          const unsubCancel = notificationService.listenForCallCancellation(
            callId,
            () => {
              if (!cancelled) doCleanup().then(() => navigation.goBack());
            },
          );
          (callIdRef as any).cancelUnsub = unsubCancel;
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[VoiceCall] Init error:', err);
          Alert.alert('Error', 'Could not start call: ' + err.message);
          navigation.goBack();
        }
      }
    };

    init();
    return () => {
      cancelled = true;
      doCleanup();
    };
  }, []);

  // ── Duration timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (connectionState === 'connected') {
      callTimerRef.current = setInterval(
        () => setCallDuration(d => d + 1),
        1000,
      );
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

  // ── Offer handler (callee only) ───────────────────────────────────────────
  const handleOfferReceived = async (offerData: any) => {
    console.log(
      '[VoiceCall] Offer arrived. ready:',
      readyToAnswerRef.current,
      'has offer:',
      !!offerData?.offer,
    );
    if (!readyToAnswerRef.current) {
      pendingOfferRef.current = offerData.offer;
      return;
    }
    try {
      await webRTCServiceRef.current?.handleRemoteOffer(offerData.offer);
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

  // ── Cleanup ───────────────────────────────────────────────────────────────
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

    try {
      if (!isCallerRef.current && user) {
        await notificationService.clearIncomingCall(user.uid);
      } else if (isCallerRef.current && userData?.uid) {
        await notificationService.cancelCallNotification(
          callIdRef.current,
          userData.uid,
        );
      }
    } catch (_) {}

    notificationService.resetCallState();
  };

  const endCall = async () => {
    await doCleanup();
    navigation.goBack();
  };

  // ── Controls ──────────────────────────────────────────────────────────────
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

  // ── Helpers ───────────────────────────────────────────────────────────────
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const r = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      if (r['android.permission.RECORD_AUDIO'] !== 'granted')
        throw new Error('Microphone permission is required.');
    }
  };

  const getLocalStream = async (): Promise<MediaStream> => {
    const s = await mediaDevices.getUserMedia({ audio: true, video: false });
    return s as unknown as MediaStream;
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(
      2,
      '0',
    )}`;

  // ── Render ────────────────────────────────────────────────────────────────
  const isConnected = connectionState === 'connected';
  const statusLabel = isConnected
    ? formatTime(callDuration)
    : callStatus === 'calling'
    ? 'Ringing…'
    : STATUS_LABEL[connectionState] ?? connectionState;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar
        hidden={false}
        backgroundColor="#1a1a2e"
        barStyle="light-content"
      />

      <View style={styles.callInfo}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>
            {(userData?.name?.[0] ?? 'U').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{userData?.name ?? 'User'}</Text>
        <Text style={styles.status}>{statusLabel}</Text>
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
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2d2d4e',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#4a9fff',
    marginBottom: 18,
  },
  avatarLetter: { fontSize: 52, color: '#fff', fontWeight: '700' },
  name: { color: '#fff', fontSize: 28, fontWeight: '600', marginBottom: 8 },
  status: { color: '#8899bb', fontSize: 15 },
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
