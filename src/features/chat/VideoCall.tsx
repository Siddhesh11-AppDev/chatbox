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
  Linking,
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

  // FIX 1: Store URL strings, NOT MediaStream objects.
  // RTCView requires a stable string URL. Storing a MediaStream object in state
  // means React can't detect when it changes (object ref stays the same),
  // so RTCView never re-renders → blank video. toURL() gives a stable string.
  const [localStreamURL, setLocalStreamURL] = useState<string | null>(null);
  const [remoteStreamURL, setRemoteStreamURL] = useState<string | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('initializing');
  const [callStatus, setCallStatus] = useState('initializing');
  const [callDuration, setCallDuration] = useState(0);

  // FIX 2: Removed controlsVisible state.
  // Toggling controlsVisible unmounts/remounts the Animated.View while its
  // opacity animation is still running → flicker & RN warnings.
  // Solution: keep controls always mounted, control visibility via opacity only.

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
  // FIX 3: Use mountedRef instead of `cancelled` closure variable.
  // The `cancelled` pattern breaks when doCleanup() is called from outside
  // the init closure (e.g. endCall). mountedRef is always reachable.
  const mountedRef = useRef(true);
  const pendingOfferRef = useRef<any>(null);
  const readyToAnswerRef = useRef(false);
  // FIX 4: connectionStateRef so showControls() never captures stale state.
  const connectionStateRef = useRef<ConnectionState>('initializing');

  // FIX 5: PIP uses separate pipX / pipY Animated.Values applied as left/top.
  // The old code used pipPan.getTranslateTransform() on a position:absolute view.
  // transform:translate adds ON TOP of the view's existing position → double
  // offset, so PIP appeared at wrong coordinates and jumped around on drag.
  // Using left/top directly is the correct pattern for draggable absolute views.
  const pipX = useRef(new Animated.Value(PIP_INIT_X)).current;
  const pipY = useRef(new Animated.Value(PIP_INIT_Y)).current;

  const pipPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // extractOffset captures current value so dx/dy starts from 0
        pipX.extractOffset();
        pipY.extractOffset();
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pipX, dy: pipY }],
        { useNativeDriver: false },
      ),
      onPanResponderRelease: () => {
        pipX.flattenOffset();
        pipY.flattenOffset();
        const cx = (pipX as any)._value;
        const cy = (pipY as any)._value;
        // Snap PIP to nearest left/right edge
        const targetX =
          cx + PIP_W / 2 < width / 2 ? PIP_MARGIN : width - PIP_W - PIP_MARGIN;
        const targetY = Math.max(PIP_MARGIN, Math.min(cy, height - PIP_H - 120));
        Animated.spring(pipX, {
          toValue: targetX,
          useNativeDriver: false,
          tension: 80,
          friction: 8,
        }).start();
        Animated.spring(pipY, {
          toValue: targetY,
          useNativeDriver: false,
          tension: 80,
          friction: 8,
        }).start();
      },
    }),
  ).current;

  // FIX 6: showControls uses connectionStateRef (not connectionState closure).
  // useCallback with connectionState in deps still captures a stale value when
  // called from gesture handlers. Reading from a ref is always fresh.
  const showControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    Animated.timing(controlsOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    if (connectionStateRef.current === 'connected') {
      controlsTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        Animated.timing(controlsOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start();
      }, 4000);
    }
  }, []); // stable — only uses refs, no stale closures

  // Keep ref in sync with state, and reset auto-hide on state change
  useEffect(() => {
    connectionStateRef.current = connectionState;
    if (connectionState === 'connected') {
      showControls();
    } else {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      Animated.timing(controlsOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [connectionState]);

  // ── INIT ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Reset flags on every mount
    mountedRef.current = true;
    cleanedRef.current = false;

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

        console.log(`[VideoCall] init — isCaller:${isCaller} callId:${callId}`);

        const service = new FirebaseWebRTCService(
          callId,
          user!.uid,
          (stream: MediaStream) => {
            if (!mountedRef.current) return;
            console.log('[VideoCall] ✅ Remote stream received');
            // Store the URL string, not the object — RTCView renders immediately
            setRemoteStreamURL(stream.toURL());
          },
          (state: string) => {
            if (!mountedRef.current) return;
            console.log('[VideoCall] Connection state →', state);
            setConnectionState(state as ConnectionState);
            if (state === 'connected') setCallStatus('connected');
            if (state === 'closed')
              doCleanup().then(() => navigation.goBack());
          },
          (err: string) => {
            if (!mountedRef.current) return;
            handleError(err);
          },
          isCaller ? undefined : handleOfferReceived,
        );
        webRTCServiceRef.current = service;

        // FIX 7: Get local stream FIRST before any signaling.
        // Original code started the stream after initialize() and sendCallNotification(),
        // which could take 2–4 seconds. User saw a blank PIP the whole time.
        // Getting the stream first means your face appears immediately on screen.
        const stream = await getLocalStream();
        if (!mountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        localStreamRef.current = stream;
        // Set URL string — RTCView renders your face right now
        setLocalStreamURL(stream.toURL());
        console.log('[VideoCall] ✅ Local stream ready, face visible');

        // ── CALLER ─────────────────────────────────────────────────────────
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
            callType: 'video',
          });
          console.log('[VideoCall] Call notification sent');

          if (!mountedRef.current) return;

          await service.initialize(true);
          console.log('[VideoCall] Caller initialized');

          if (!mountedRef.current) return;

          await service.addLocalStream(stream);

          if (InCallManager) {
            InCallManager.start({ media: 'video' });
            InCallManager.setForceSpeakerphoneOn(true);
          }

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
                  if (!mountedRef.current) return;
                  console.error('[VideoCall] createOffer failed:', err);
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

          // ── CALLEE ─────────────────────────────────────────────────────────
        } else {
          setCallStatus('receiving');

          await service.initialize(false);
          console.log('[VideoCall] Callee initialized');

          if (!mountedRef.current) return;

          await service.addLocalStream(stream);

          // Mark ready, drain any pending offer that arrived early
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
              if (mountedRef.current)
                doCleanup().then(() => navigation.goBack());
            },
          );
          (callIdRef as any).cancelUnsub = unsubCancel;
        }
      } catch (err: any) {
        if (mountedRef.current) {
          console.error('[VideoCall] Init error:', err);
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
    navigation.navigate('userMsg', { userData });
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

  // Your original improved permission handler — kept as-is
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const cameraPermission = PermissionsAndroid.PERMISSIONS.CAMERA;
      const audioPermission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;

      const permissions = await PermissionsAndroid.requestMultiple([
        cameraPermission,
        audioPermission,
      ]);

      const cameraGranted = permissions[cameraPermission] === 'granted';
      const audioGranted = permissions[audioPermission] === 'granted';

      if (!cameraGranted || !audioGranted) {
        const deniedPermissions = [];
        if (!cameraGranted) deniedPermissions.push('camera');
        if (!audioGranted) deniedPermissions.push('microphone');

        Alert.alert(
          'Permissions Required',
          `The ${deniedPermissions.join(' and ')} permission${
            deniedPermissions.length > 1 ? 's are' : ' is'
          } required for video calls. Please enable it in Settings.`,
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => navigation.goBack(),
            },
            {
              text: 'Settings',
              onPress: async () => {
                Linking.openSettings();
                setTimeout(() => navigation.goBack(), 1000);
              },
            },
          ],
        );
        throw new Error('Camera and microphone permissions are required.');
      }
    }
    return true;
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

        {/*
          ══════════════════════════════════════════════════════════
          REMOTE VIDEO — full screen background
          zOrder={0}: Android SurfaceView renders below all RN views
          ══════════════════════════════════════════════════════════
        */}
        {remoteStreamURL ? (
          <RTCView
            key="remote-video"
            streamURL={remoteStreamURL}
            style={styles.remoteVideo}
            objectFit="cover"
            zOrder={0}
            mirror={false}
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

        {/* Top bar — name + timer */}
        <Animated.View
          style={[styles.topBar, { opacity: controlsOpacity }]}
          pointerEvents="none"
        >
          <Text style={styles.remoteName}>{userData?.name ?? 'User'}</Text>
          <Text style={styles.duration}>
            {isConnected
              ? formatTime(callDuration)
              : isRinging
              ? 'Ringing…'
              : statusLabel}
          </Text>
        </Animated.View>

        {/*
          ══════════════════════════════════════════════════════════
          LOCAL PIP — your face, draggable thumbnail

          FIX: left={pipX} top={pipY} instead of getTranslateTransform()
               transform:translate adds to existing position → double offset.
               left/top on position:absolute = correct pixel coordinates.

          FIX: zOrder={1} so Android SurfaceView renders ABOVE remote video.
               Without this, the PIP SurfaceView renders behind the remote
               RTCView regardless of JSX order.
          ══════════════════════════════════════════════════════════
        */}
        <Animated.View
          style={[styles.pipContainer, { left: pipX, top: pipY }]}
          {...pipPanResponder.panHandlers}
        >
          {localStreamURL && !isVideoOff ? (
            <RTCView
              key="local-video"
              streamURL={localStreamURL}
              style={StyleSheet.absoluteFill}
              objectFit="cover"
              zOrder={1}
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

        {/*
          ══════════════════════════════════════════════════════════
          CONTROLS — always mounted, fades via opacity only.
          Conditional rendering ({controlsVisible && ...}) caused
          flicker because the Animated.View was unmounted while its
          opacity animation was still running.
          ══════════════════════════════════════════════════════════
        */}
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

  // Remote video — full screen
  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
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

  // Top bar
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
    zIndex: 10,
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

  // PIP — your face
  // position:'absolute' required so left/top work as screen coordinates
  pipContainer: {
    position: 'absolute',
    width: PIP_W,
    height: PIP_H,
    borderRadius: 14,
    overflow: 'hidden',   // clips RTCView to rounded corners
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#1a1a1a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 10,
    zIndex: 100,
  },
  pipVideo: { flex: 1 },
  pipPlaceholder: {
    backgroundColor: '#2a2a3e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pipPlaceholderText: { fontSize: 28 },

  // Controls
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
    zIndex: 50,
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