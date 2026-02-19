import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Alert,
  Dimensions,
  PermissionsAndroid,
  Platform,
  StatusBar,
  Animated,
  PanResponder,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { RTCView, mediaDevices, MediaStream } from 'react-native-webrtc';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { FirebaseWebRTCService } from '../../core/services/FirebaseWebRTCService';
import { useAuth } from '../../core/context/AuthContext';
import firestore from '@react-native-firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { notificationService } from '../../core/services/notification.service';

let InCallManager: any = null;
try {
  InCallManager = require('react-native-incall-manager').default;
} catch (_) {}

const { width, height } = Dimensions.get('window');
const PIP_W = 110,
  PIP_H = 150,
  PIP_MARGIN = 16;
const PIP_INIT_X = width - PIP_W - PIP_MARGIN,
  PIP_INIT_Y = 80;

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

const VideoCall = () => {
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

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('initializing');
  const [callStatus, setCallStatus] = useState('initializing');
  const [callDuration, setCallDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);

  const webRTCServiceRef = useRef<FirebaseWebRTCService | null>(null);
  const callIdRef = useRef('');
  const isCallerRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acceptListenerRef = useRef<(() => void) | null>(null);
  const cleanedRef = useRef(false);
  const pendingOfferRef = useRef<any>(null);
  const readyToAnswerRef = useRef(false);

  const pipPan = useRef(
    new Animated.ValueXY({ x: PIP_INIT_X, y: PIP_INIT_Y }),
  ).current;
  const pipPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pipPan.setOffset({
          x: (pipPan.x as any)._value,
          y: (pipPan.y as any)._value,
        });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pipPan.x, dy: pipPan.y }],
        { useNativeDriver: false },
      ),
      onPanResponderRelease: () => {
        pipPan.flattenOffset();
        const cx = (pipPan.x as any)._value,
          cy = (pipPan.y as any)._value;
        Animated.spring(pipPan, {
          toValue: {
            x: cx < width / 2 ? PIP_MARGIN : width - PIP_W - PIP_MARGIN,
            y: Math.max(PIP_MARGIN, Math.min(cy, height - PIP_H - 120)),
          },
          useNativeDriver: false,
          tension: 80,
          friction: 8,
        }).start();
      },
    }),
  ).current;

  const showControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    setControlsVisible(true);
    Animated.timing(controlsOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    if (connectionState === 'connected') {
      controlsTimerRef.current = setTimeout(() => {
        Animated.timing(controlsOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start(() => setControlsVisible(false));
      }, 4000);
    }
  }, [connectionState]);

  useEffect(() => {
    if (connectionState === 'connected') {
      showControls();
    } else {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      setControlsVisible(true);
      Animated.timing(controlsOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [connectionState]);

  // ── INIT ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        await requestPermissions();

        // Callee uses the callId passed from IncomingCallScreen.
        // Caller generates a fresh Firestore doc ID.
        const callId =
          isIncomingCall && incomingCallId
            ? incomingCallId
            : firestore().collection('calls').doc().id;
        callIdRef.current = callId;

        const isCaller = !isIncomingCall;
        isCallerRef.current = isCaller;

        console.log(`[VideoCall] init — isCaller:${isCaller} callId:${callId}`);

        const service = new FirebaseWebRTCService(
          callId,
          user!.uid,
          (stream: MediaStream) => {
            if (!cancelled) {
              console.log('[VideoCall] Remote stream received');
              setRemoteStream(stream);
            }
          },
          (state: string) => {
            if (!cancelled) {
              console.log('[VideoCall] Connection state →', state);
              setConnectionState(state as ConnectionState);
              if (state === 'connected') setCallStatus('connected');
              if (state === 'closed')
                doCleanup().then(() => navigation.goBack());
            }
          },
          (err: string) => {
            if (!cancelled) handleError(err);
          },
          isCaller ? undefined : handleOfferReceived,
        );
        webRTCServiceRef.current = service;

        // ── CALLER ─────────────────────────────────────────────────────────
        if (isCaller) {
          setCallStatus('calling');

          // Step 1: Create call doc + signal callee BEFORE initialize().
          //         This guarantees the doc exists when initialize() merges
          //         the caller participant entry into it.
          const callerName =
            userProfile?.name || user?.displayName || user?.email || 'User';
          await notificationService.sendCallNotification({
            receiverId: userData.uid,
            callerId: user!.uid,
            callerName,
            callerAvatar: userProfile?.profile_image,
            callId,
            callType: 'video',
          });
          console.log('[VideoCall] Call notification sent');

          if (cancelled) return;

          // Step 2: initialize() merges caller participant into the existing doc
          await service.initialize(true);
          console.log('[VideoCall] Caller initialized');

          if (cancelled) return;

          // Step 3: Camera + mic
          const stream = await getLocalStream();
          if (cancelled) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          localStreamRef.current = stream;
          setLocalStream(stream);
          await service.addLocalStream(stream);

          if (InCallManager) {
            InCallManager.start({ media: 'video' });
            InCallManager.setForceSpeakerphoneOn(true);
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

          // Step 5: Wait for callee to accept (status='answered'), then offer
          acceptListenerRef.current = firestore()
            .collection('calls')
            .doc(callId)
            .onSnapshot(doc => {
              if (cancelled) return;
              const status = doc.data()?.status;
              console.log('[VideoCall] Call doc status →', status);

              if (status === 'answered') {
                if (callTimeoutRef.current) {
                  clearTimeout(callTimeoutRef.current);
                  callTimeoutRef.current = null;
                }
                const unsub = acceptListenerRef.current;
                acceptListenerRef.current = null;
                unsub?.();

                setConnectionState('connecting');
                setCallStatus('connecting');

                console.log('[VideoCall] Callee answered — creating offer');
                service.createOffer(false).catch(err => {
                  if (!cancelled) {
                    console.error('[VideoCall] createOffer failed:', err);
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

          // ── CALLEE ─────────────────────────────────────────────────────────
        } else {
          setCallStatus('receiving');

          // Step 1: initialize() — only writes participant metadata, not status
          await service.initialize(false);
          console.log('[VideoCall] Callee initialized');

          if (cancelled) return;

          // Step 2: Camera + mic
          const stream = await getLocalStream();
          if (cancelled) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          localStreamRef.current = stream;
          setLocalStream(stream);
          await service.addLocalStream(stream);

          // Step 3: Mark ready, drain pending offer if already arrived
          readyToAnswerRef.current = true;
          console.log(
            '[VideoCall] Callee ready. Pending offer:',
            !!pendingOfferRef.current,
          );
          if (pendingOfferRef.current) {
            await service.handleRemoteOffer(pendingOfferRef.current);
            pendingOfferRef.current = null;
          }

          if (InCallManager) {
            InCallManager.start({ media: 'video' });
            InCallManager.setForceSpeakerphoneOn(true);
          }

          // Watch for caller cancelling
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
          console.error('[VideoCall] Init error:', err);
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
      if (InCallManager) InCallManager.setForceSpeakerphoneOn(true);
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
      '[VideoCall] Offer arrived. ready:',
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
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (callTimerRef.current) clearInterval(callTimerRef.current);
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
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => {
      t.enabled = !t.enabled;
    });
    setIsMuted(m => !m);
  };
  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => {
      t.enabled = !t.enabled;
    });
    setIsVideoOff(v => !v);
  };
  const toggleSpeaker = () => {
    if (InCallManager) {
      const n = !isSpeaker;
      InCallManager.setForceSpeakerphoneOn(n);
      setIsSpeaker(n);
    }
  };
  const switchCamera = () => {
    const t = localStreamRef.current?.getVideoTracks()[0] as any;
    if (t?._switchCamera) {
      t._switchCamera();
      setIsFrontCamera(f => !f);
    }
  };

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const r = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
      if (
        r['android.permission.CAMERA'] !== 'granted' ||
        r['android.permission.RECORD_AUDIO'] !== 'granted'
      )
        throw new Error('Camera and microphone permissions are required.');
    }
  };

  const getLocalStream = async (): Promise<MediaStream> => {
    const s = await mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
    return s as unknown as MediaStream;
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(
      2,
      '0',
    )}`;

  // ── Render ────────────────────────────────────────────────────────────────
  const isConnected = connectionState === 'connected';
  const isRinging = callStatus === 'calling';
  const statusLabel = STATUS_LABEL[connectionState] ?? connectionState;

  return (
    <TouchableWithoutFeedback onPress={showControls}>
      <View style={styles.root}>
        <StatusBar hidden />

        {remoteStream ? (
          <RTCView
            streamURL={remoteStream.toURL()}
            style={styles.remoteVideo}
            objectFit="cover"
          />
        ) : (
          <View style={styles.remotePlaceholder}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarLetter}>
                {(userData?.name?.[0] ?? 'U').toUpperCase()}
              </Text>
            </View>
            <Text style={styles.remoteNameText}>
              {userData?.name ?? 'User'}
            </Text>
            <Text style={styles.statusLabel}>
              {isRinging ? 'Ringing…' : statusLabel}
            </Text>
          </View>
        )}

        <Animated.View style={[styles.topBar, { opacity: controlsOpacity }]}>
          <Text style={styles.remoteName}>{userData?.name ?? 'User'}</Text>
          <Text style={styles.duration}>
            {isConnected
              ? formatTime(callDuration)
              : isRinging
              ? 'Ringing…'
              : statusLabel}
          </Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.pipContainer,
            { transform: pipPan.getTranslateTransform() },
          ]}
          {...pipPanResponder.panHandlers}
        >
          {localStream && !isVideoOff ? (
            <RTCView
              streamURL={localStream.toURL()}
              style={styles.pipVideo}
              objectFit="cover"
              mirror={isFrontCamera}
            />
          ) : (
            <View style={[styles.pipVideo, styles.pipPlaceholder]}>
              <Text style={styles.pipPlaceholderText}>
                {isVideoOff ? '📷' : '⏳'}
              </Text>
            </View>
          )}
        </Animated.View>

        {controlsVisible && (
          <Animated.View
            style={[styles.controls, { opacity: controlsOpacity }]}
          >
            <View style={styles.controlRow}>
              <ControlBtn
                icon={isSpeaker ? 'volume-2' : 'volume-x'}
                label={isSpeaker ? 'Speaker' : 'Earpiece'}
                onPress={toggleSpeaker}
                active={isSpeaker}
              />
              <ControlBtn
                icon={isVideoOff ? 'video-off' : 'video'}
                label={isVideoOff ? 'Start video' : 'Stop video'}
                onPress={toggleVideo}
                danger={isVideoOff}
              />
              <ControlBtn
                icon="repeat"
                label="Flip"
                onPress={switchCamera}
                iconComponent={MaterialIcons}
                iconName="flip-camera-android"
              />
            </View>
            <View style={styles.controlRow}>
              <ControlBtn
                icon={isMuted ? 'mic-off' : 'mic'}
                label={isMuted ? 'Unmute' : 'Mute'}
                onPress={toggleMute}
                danger={isMuted}
              />
              <TouchableOpacity
                style={styles.endCallBtn}
                onPress={endCall}
                activeOpacity={0.8}
              >
                <Feather name="phone-off" size={28} color="#fff" />
              </TouchableOpacity>
              <View style={styles.controlBtnPlaceholder} />
            </View>
          </Animated.View>
        )}
      </View>
    </TouchableWithoutFeedback>
  );
};

interface CBProps {
  icon: string;
  iconName?: string;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  iconComponent?: any;
}
const ControlBtn = ({
  icon,
  iconName,
  label,
  onPress,
  active,
  danger,
  iconComponent: Icon,
}: CBProps) => (
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
      {Icon ? (
        <Icon name={iconName ?? icon} size={22} color="#fff" />
      ) : (
        <Feather name={icon} size={22} color="#fff" />
      )}
    </View>
    <Text style={styles.controlBtnLabel}>{label}</Text>
  </TouchableOpacity>
);

export default VideoCall;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1a1a2e' },
  remoteVideo: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  remotePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  avatarCircle: {
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
  remoteNameText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  statusLabel: { color: '#8899bb', fontSize: 15 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 52,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
  },
  remoteName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  duration: {
    color: '#ccd9ff',
    fontSize: 13,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  pipContainer: {
    position: 'absolute',
    width: PIP_W,
    height: PIP_H,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 10,
  },
  pipVideo: { flex: 1 },
  pipPlaceholder: {
    backgroundColor: '#2a2a3e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pipPlaceholderText: { fontSize: 28 },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 48,
    paddingTop: 20,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 16,
  },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
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
  controlBtnPlaceholder: { width: 72 },
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
