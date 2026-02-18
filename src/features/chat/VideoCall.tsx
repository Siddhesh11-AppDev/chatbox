 

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

const PIP_W = 110;
const PIP_H = 150;
const PIP_MARGIN = 16;
const PIP_INIT_X = width - PIP_W - PIP_MARGIN;
const PIP_INIT_Y = 80;

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
  initializing: 'Initializing call…',
  new: 'Setting up connection…',
  checking: 'Checking connection…',
  connecting: 'Connecting to peer…',
  connected: '',
  disconnected: 'Reconnecting…',
  failed: 'Connection failed',
  closed: 'Call ended',
  calling: 'Calling…',
  receiving: 'Receiving call…',
  answer_sent: 'Answer sent, connecting…',
  answer_received: 'Answer received, connecting…',
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

  // Holds an offer that arrived before the PC + stream were ready (callee race)
  const pendingOfferRef = useRef<any>(null);
  const readyToAnswerRef = useRef(false); // true once addLocalStream() done

  // ── PiP drag ─────────────────────────────────────────────────────────
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
        const cx = (pipPan.x as any)._value;
        const cy = (pipPan.y as any)._value;
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

  // ── Controls visibility ───────────────────────────────────────────────
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

  // ── INIT ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        await requestPermissions();

        const callId =
          isIncomingCall && incomingCallId ? incomingCallId : generateCallId();
        callIdRef.current = callId;

        const isCaller = isIncomingCall ? false : await checkIfCaller(callId);
        isCallerRef.current = isCaller;

        // Build service — pass handleOfferReceived for callee, undefined for caller
        const service = new FirebaseWebRTCService(
          callId,
          user!.uid,
          (stream: MediaStream) => {
            if (!cancelled) {
              console.log('VideoCall: Remote stream received');
              console.log('VideoCall: Stream tracks:', stream.getTracks().map(t => t.kind));
              setRemoteStream(stream);
              console.log('VideoCall: Remote stream set successfully');
            }
          },
          (state: string) => {
            if (!cancelled) {
              console.log('VideoCall: Connection state changed to:', state);
              setConnectionState(state as ConnectionState);
              // Update call status based on connection state
              if (state === 'connected') {
                setCallStatus('connected');
                console.log('VideoCall: Call connected successfully');
              } else if (state === 'failed' || state === 'disconnected') {
                setCallStatus(state);
                console.log('VideoCall: Connection issue:', state);
              } else if (state === 'connecting' || state === 'checking') {
                setCallStatus('connecting');
              }
            }
          },
          (err: string) => {
            if (!cancelled) handleError(err);
          },
          isCaller ? undefined : handleOfferReceived,
        );
        webRTCServiceRef.current = service;

        // Initialize (builds PC + Firestore listeners)
        await service.initialize(isCaller);

        // Get camera/mic
        const stream = await getLocalStream();
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        await service.addLocalStream(stream);

        // ✅ Mark ready — if offer arrived while we were setting up, process it now
        readyToAnswerRef.current = true;
        if (!isCaller && pendingOfferRef.current) {
          console.log('Processing queued offer');
          await service.handleRemoteOffer(pendingOfferRef.current);
          pendingOfferRef.current = null;
        }

        if (InCallManager) {
          InCallManager.start({ media: 'video' });
          InCallManager.setForceSpeakerphoneOn(true);
        }

        if (isCaller) {
          setCallStatus('calling');
          await service.createOffer();
          await sendCallNotification(callId);
        } else {
          setCallStatus('receiving');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Call init error:', err);
          Alert.alert(
            'Error',
            'Could not start call: ' + (err as Error).message,
          );
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

  // ── Duration timer ────────────────────────────────────────────────────
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

  // ── Offer handler (callee) ────────────────────────────────────────────
  // ✅ KEY FIX: if called before PC + stream are ready, queue it.
  const handleOfferReceived = async (offerData: any) => {
    if (!readyToAnswerRef.current) {
      // PC or stream not ready yet — queue and process after addLocalStream()
      console.log('Offer arrived early — queuing');
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
        { text: 'End Call', onPress: () => navigation.goBack() },
      ]);
    }
  };

  // ── Cleanup ───────────────────────────────────────────────────────────
  const doCleanup = async () => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    if (InCallManager) InCallManager.stop();

    if (webRTCServiceRef.current) {
      await webRTCServiceRef.current.endCall();
      webRTCServiceRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (!isCallerRef.current && callIdRef.current && user) {
      try {
        await notificationService.clearIncomingCall(user.uid);
        await notificationService.cancelCallNotification(
          callIdRef.current,
          user.uid,
        );
      } catch (_) {}
    }
  };

  const endCall = async () => {
    await doCleanup();
    navigation.goBack();
  };

  // ── Controls ──────────────────────────────────────────────────────────
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
      const next = !isSpeaker;
      InCallManager.setForceSpeakerphoneOn(next);
      setIsSpeaker(next);
    }
  };

  const switchCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0] as any;
    if (track?._switchCamera) {
      track._switchCamera();
      setIsFrontCamera(f => !f);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────
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

  const generateCallId = () => {
    const ids = [user!.uid, userData.uid].sort();
    return `call_${ids.join('_')}_${Date.now()}`;
  };

  const checkIfCaller = async (callId: string): Promise<boolean> => {
    try {
      const d = await firestore().collection('calls').doc(callId).get();
      return !d.exists;
    } catch {
      return true;
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

  const sendCallNotification = async (callId: string) => {
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
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(
      2,
      '0',
    )}`;

  // ── Render ────────────────────────────────────────────────────────────
  const statusLabel = STATUS_LABEL[connectionState] ?? connectionState;
  const isConnected = connectionState === 'connected';

  return (
    <TouchableWithoutFeedback onPress={showControls}>
      <View style={styles.root}>
        <StatusBar hidden />

        {/* Remote */}
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
            <Text style={styles.statusLabel}>{statusLabel}</Text>
          </View>
        )}

        {/* Top bar */}
        <Animated.View style={[styles.topBar, { opacity: controlsOpacity }]}>
          <Text style={styles.remoteName}>{userData?.name ?? 'User'}</Text>
          <Text style={styles.duration}>
            {isConnected ? formatTime(callDuration) : statusLabel}
          </Text>
        </Animated.View>

        {/* PiP */}
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

        {/* Controls */}
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

// Small reusable button
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
