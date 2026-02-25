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
  AppState,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { RTCView, mediaDevices, MediaStream } from 'react-native-webrtc';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import {
  FirebaseWebRTCService,
  NetworkStats,
} from '../../core/services/FirebaseWebRTCService';
import { useAuth } from '../../core/context/AuthContext';
import firestore from '@react-native-firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { notificationService } from '../../core/services/notification.service';
import { callHistoryService } from '../../core/services/callHistory.service';

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

const QUALITY_BARS: Record<string, number> = { good: 3, fair: 2, poor: 1 };

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
  const [networkQuality, setNetworkQuality] = useState<
    'good' | 'fair' | 'poor' | null
  >(null);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);

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
  const mountedRef = useRef(true);
  const pendingOfferRef = useRef<any>(null);
  const readyToAnswerRef = useRef(false);
  const connectionStateRef = useRef<ConnectionState>('initializing');
  const speakingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingPulse = useRef(new Animated.Value(1)).current;

  const pipX = useRef(new Animated.Value(PIP_INIT_X)).current;
  const pipY = useRef(new Animated.Value(PIP_INIT_Y)).current;

  const pipPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pipX.extractOffset();
        pipY.extractOffset();
      },
      onPanResponderMove: Animated.event([null, { dx: pipX, dy: pipY }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pipX.flattenOffset();
        pipY.flattenOffset();
        const cx = (pipX as any)._value;
        const cy = (pipY as any)._value;
        const targetX =
          cx + PIP_W / 2 < width / 2 ? PIP_MARGIN : width - PIP_W - PIP_MARGIN;
        const targetY = Math.max(
          PIP_MARGIN,
          Math.min(cy, height - PIP_H - 120),
        );
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
  }, []);

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

  useEffect(() => {
    if (remoteSpeaking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(speakingPulse, {
            toValue: 1.08,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(speakingPulse, {
            toValue: 1,
            duration: 400,
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

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (!mountedRef.current) return;
      if (nextState === 'background' && InCallManager) {
        InCallManager.setKeepScreenOn(false);
      } else if (nextState === 'active' && InCallManager) {
        InCallManager.setKeepScreenOn(true);
        if (connectionStateRef.current === 'connected') {
          InCallManager.setForceSpeakerphoneOn(isSpeaker);
        }
      }
    });
    return () => sub.remove();
  }, [isSpeaker]);

  useEffect(() => {
    mountedRef.current = true;
    cleanedRef.current = false;

    if (InCallManager) {
      InCallManager.start({ media: 'video' });
      InCallManager.setForceSpeakerphoneOn(true);
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

        const service = new FirebaseWebRTCService(
          callId,
          user!.uid,
          (stream: MediaStream) => {
            if (!mountedRef.current) return;
            setRemoteStreamURL(stream.toURL());
            startSpeakingDetection(stream);
          },
          (state: string) => {
            if (!mountedRef.current) return;
            setConnectionState(state as ConnectionState);
            if (state === 'connected') {
              setCallStatus('connected');
              if (InCallManager) InCallManager.setForceSpeakerphoneOn(true);
            }
            if (state === 'closed') doCleanup().then(() => navigation.goBack());
          },
          (err: string) => {
            if (!mountedRef.current) return;
            handleError(err);
          },
          isCaller ? undefined : handleOfferReceived,
          (stats: NetworkStats) => {
            if (!mountedRef.current) return;
            setNetworkQuality(stats.quality);
          },
        );
        webRTCServiceRef.current = service;

        const stream = await getLocalStream();
        if (!mountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStreamURL(stream.toURL());

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

          if (!mountedRef.current) return;

          await service.initialize(true);

          if (!mountedRef.current) return;
          await service.addLocalStream(stream);

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

          acceptListenerRef.current = firestore()
            .collection('calls')
            .doc(callId)
            .onSnapshot(doc => {
              if (!mountedRef.current) return;
              const status = doc.data()?.status;

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

                service.createOffer(false).catch(err => {
                  if (!mountedRef.current) return;
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
        } else {
          setCallStatus('receiving');

          await service.initialize(false);

          if (!mountedRef.current) return;
          await service.addLocalStream(stream);

          readyToAnswerRef.current = true;
          if (pendingOfferRef.current) {
            await service.handleRemoteOffer(pendingOfferRef.current);
            pendingOfferRef.current = null;
          }

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

  useEffect(() => {
    if (connectionState === 'connected') {
      callTimerRef.current = setInterval(
        () => setCallDuration(d => d + 1),
        1000,
      );
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

  const startSpeakingDetection = (stream: MediaStream) => {
    try {
      speakingTimerRef.current = setInterval(async () => {
        if (!mountedRef.current || !webRTCServiceRef.current) return;
        const stats = await webRTCServiceRef.current.getNetworkStats();
        if (!stats) return;
        setRemoteSpeaking(stats.jitter > 0.005);
      }, 600);
    } catch (_) {}
  };

  const handleOfferReceived = async (offerData: any) => {
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

    // Save call record
    try {
      const callStatus = connectionStateRef.current;
      let callRecordStatus: 'missed' | 'received' | 'rejected' | 'completed' | 'outgoing' = 'completed';
      
      if (callStatus === 'closed' || callStatus === 'disconnected') {
        callRecordStatus = callDuration > 0 ? 'completed' : 'missed';
      } else if (callStatus === 'failed') {
        callRecordStatus = 'rejected';
      }
      
      // Save call record to history
      if (user && userData) {
        await callHistoryService.saveCallRecord({
          participants: [user.uid, userData.uid],
          callerId: isCallerRef.current ? user.uid : userData.uid,
          calleeId: isCallerRef.current ? userData.uid : user.uid,
          callerName: isCallerRef.current ? (user?.displayName || user?.email || 'User') : userData.name,
          calleeName: isCallerRef.current ? userData.name : (user?.displayName || user?.email || 'User'),
          callerAvatar: isCallerRef.current ? userProfile?.profile_image : userData.profile_image,
          calleeAvatar: isCallerRef.current ? userData.profile_image : userProfile?.profile_image,
          callType: 'video',
          callStatus: callRecordStatus,
          duration: callDuration,
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
        const denied = [];
        if (!cameraGranted) denied.push('camera');
        if (!audioGranted) denied.push('microphone');
        Alert.alert(
          'Permissions Required',
          `The ${denied.join(' and ')} permission${
            denied.length > 1 ? 's are' : ' is'
          } required for video calls.`,
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
        throw new Error('Camera and microphone permissions are required.');
      }
    }
    return true;
  };

  const getLocalStream = async (): Promise<MediaStream> => {
    const s = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1,
      } as any,
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

  const isConnected = connectionState === 'connected';
  const isRinging = callStatus === 'calling';
  const statusLabel = STATUS_LABEL[connectionState] ?? connectionState;
  const qualityBars = networkQuality ? QUALITY_BARS[networkQuality] : null;

  return (
    <TouchableWithoutFeedback onPress={showControls}>
      <View style={styles.root}>
        <StatusBar hidden />

        {/* REMOTE VIDEO — full screen, no mirror */}
        {remoteStreamURL ? (
          <Animated.View style={StyleSheet.absoluteFill}>
            <RTCView
              key="remote-video"
              streamURL={remoteStreamURL}
              style={styles.remoteVideo}
              objectFit="cover"
              zOrder={0}
            />
          </Animated.View>
        ) : (
          <View style={styles.remotePlaceholder}>
            <View
              style={[
                styles.avatarCircle,
                remoteSpeaking && styles.avatarSpeaking,
              ]}
            >
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

        {/* TOP BAR */}
        <Animated.View
          style={[styles.topBar, { opacity: controlsOpacity }]}
          pointerEvents="none"
        >
          <View style={styles.topBarRow}>
            <Text style={styles.remoteName}>{userData?.name ?? 'User'}</Text>
            {qualityBars !== null && isConnected && (
              <View style={styles.qualityBars}>
                {[1, 2, 3].map(i => (
                  <View
                    key={i}
                    style={[
                      styles.qualityBar,
                      { height: 6 + i * 4 },
                      i <= qualityBars
                        ? networkQuality === 'good'
                          ? styles.qualityGood
                          : networkQuality === 'fair'
                          ? styles.qualityFair
                          : styles.qualityPoor
                        : styles.qualityInactive,
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
          <Text style={styles.duration}>
            {isConnected
              ? formatTime(callDuration)
              : isRinging
              ? 'Ringing…'
              : statusLabel}
          </Text>
        </Animated.View>

        {/* LOCAL PIP — no mirror prop */}
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
            />
          ) : (
            <View style={[styles.pipVideo, styles.pipPlaceholder]}>
              <Text style={styles.pipPlaceholderText}>
                {isVideoOff ? '📷' : '⏳'}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* CONTROLS */}
        <Animated.View style={[styles.controls, { opacity: controlsOpacity }]}>
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
  avatarSpeaking: { borderColor: '#43d16e', borderWidth: 4 },
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
    zIndex: 10,
  },
  topBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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

  qualityBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginLeft: 6,
  },
  qualityBar: { width: 4, borderRadius: 2 },
  qualityGood: { backgroundColor: '#43d16e' },
  qualityFair: { backgroundColor: '#f5a623' },
  qualityPoor: { backgroundColor: '#e53935' },
  qualityInactive: { backgroundColor: 'rgba(255,255,255,0.2)' },

  pipContainer: {
    position: 'absolute',
    width: PIP_W,
    height: PIP_H,
    borderRadius: 14,
    overflow: 'hidden',
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
