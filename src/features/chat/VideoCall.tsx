import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  PermissionsAndroid,
  Platform,
  StatusBar,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { RTCView, mediaDevices, MediaStream } from 'react-native-webrtc';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { FirebaseWebRTCService } from '../../core/services/FirebaseWebRTCService';
import { useAuth } from '../../core/context/AuthContext';
import firestore from '@react-native-firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');

const VideoCall = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { userData } = route.params as { userData: any };
  const { user } = useAuth();

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callActive, setCallActive] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  const [callStatus, setCallStatus] = useState('Initializing...');

  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const webRTCServiceRef = useRef<FirebaseWebRTCService | null>(null);
  const callIdRef = useRef<string>('');
  const remoteStreamListenerRef = useRef<(() => void) | null>(null);

  // Initialize call
  useEffect(() => {
    const initializeCall = async () => {
      try {
        setCallStatus('Requesting permissions...');
        await requestPermissions();

        setCallStatus('Setting up connection...');
        const callId = generateCallId();
        callIdRef.current = callId;

        const isCaller = await checkIfCaller(callId);
        setIsCaller(isCaller);
        setCallStatus(isCaller ? 'Calling...' : 'Incoming call...');

        const webRTCService = new FirebaseWebRTCService(callId, user!.uid);
        webRTCServiceRef.current = webRTCService;

        await webRTCService.initialize();

        setCallStatus('Accessing camera...');
        const stream = await getLocalStream();
        setLocalStream(stream);
        await webRTCService.addLocalStream(stream);

        // Set up remote stream listener
        setupRemoteStreamListener(webRTCService);

        if (isCaller) {
          setCallStatus('Connecting...');
          await webRTCService.createOffer();
        } else {
          listenForOffer(callId, webRTCService);
        }
      } catch (error) {
        console.error('Error initializing call:', error);
        Alert.alert(
          'Error',
          'Failed to initialize video call: ' + (error as Error).message,
        );
        navigation.goBack();
      }
    };

    initializeCall();

    return () => {
      cleanup();
    };
  }, []);

  const setupRemoteStreamListener = (webRTCService: FirebaseWebRTCService) => {
    const interval = setInterval(() => {
      const remoteStream = webRTCService.getRemoteStream();
      if (remoteStream && remoteStream.getTracks().length > 0) {
        setRemoteStream(remoteStream);
        setCallStatus('Connected');
        clearInterval(interval);
      }
    }, 1000);

    // Cleanup function
    remoteStreamListenerRef.current = () => clearInterval(interval);
  };

  const cleanup = async () => {
    if (remoteStreamListenerRef.current) {
      remoteStreamListenerRef.current();
    }

    if (webRTCServiceRef.current) {
      await webRTCServiceRef.current.endCall();
    }

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
    }

    // Stop local stream tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
  };

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);

      if (
        granted['android.permission.CAMERA'] !==
          PermissionsAndroid.RESULTS.GRANTED ||
        granted['android.permission.RECORD_AUDIO'] !==
          PermissionsAndroid.RESULTS.GRANTED
      ) {
        throw new Error('Camera and audio permissions required');
      }
    }
  };

  const generateCallId = (): string => {
    const userIds = [user!.uid, userData.uid].sort();
    return `call_${userIds.join('_')}_${Date.now()}`;
  };

  const checkIfCaller = async (callId: string): Promise<boolean> => {
    const callDoc = await firestore().collection('calls').doc(callId).get();
    return !callDoc.exists;
  };

  const listenForOffer = (
    callId: string,
    webRTCService: FirebaseWebRTCService,
  ) => {
    const callDoc = firestore().collection('calls').doc(callId);

    const unsubscribe = callDoc.collection('offers').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.offer && data.from !== user!.uid) {
            setCallStatus('Answering call...');
            await webRTCService.createAnswer(data.offer);
          }
        }
      });
    });

    // Store unsubscribe for cleanup
    remoteStreamListenerRef.current = unsubscribe;
  };

  const getLocalStream = async () => {
    const constraints = {
      audio: true,
      video: {
        facingMode: 'user',
        width: 640,
        height: 480,
        frameRate: 30,
      },
    };

    try {
      const stream = await mediaDevices.getUserMedia(constraints);
      return stream;
    } catch (error) {
      console.error('Error getting local stream:', error);
      throw new Error('Failed to access camera and microphone');
    }
  };

  // Start call timer
  useEffect(() => {
    if (callActive && callStatus === 'Connected') {
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }

    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [callActive, callStatus]);

  // Format call duration
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
    }
    setIsMuted(!isMuted);
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
    }
    setIsVideoOff(!isVideoOff);
  };

  const endCall = async () => {
    Alert.alert('End Call', 'Are you sure you want to end this call?', [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'End Call',
        style: 'destructive',
        onPress: async () => {
          setCallActive(false);
          await cleanup();
          navigation.goBack();
        },
      },
    ]);
  };

  const switchCamera = async () => {
    if (!localStream) return;

    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const track = videoTracks[0];
      const currentFacingMode = track.getSettings().facingMode;
      const newFacingMode =
        currentFacingMode === 'user' ? 'environment' : 'user';

      track.stop();

      try {
        const newStream = await mediaDevices.getUserMedia({
          audio: true,
          video: {
            facingMode: newFacingMode,
            width: 640,
            height: 480,
            frameRate: 30,
          },
        });

        if (webRTCServiceRef.current) {
          await webRTCServiceRef.current.addLocalStream(newStream);
        }
        setLocalStream(newStream);
      } catch (error) {
        console.error('Error switching camera:', error);
        Alert.alert('Error', 'Failed to switch camera');
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Remote video display */}
      <StatusBar barStyle="dark-content" backgroundColor="#000" />
      {
        remoteStream ? (
          <RTCView
            streamURL={remoteStream.toURL()}
            style={styles.remoteVideo}
            objectFit="cover"
          />
        ) : (
          <View style={styles.remoteVideoPlaceholder}>
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{userData?.name?.[0] || 'U'}</Text>
            </View>
            <Text style={styles.remoteUserName}>{userData?.name || 'User'}</Text>
            <Text style={styles.callStatusText}>{callStatus}</Text>
          </View>
        )}

      {/* Local camera view */}
      <View style={styles.localCameraContainer}>
        {localStream && !isVideoOff ? (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localCamera}
            objectFit="cover"
            mirror={true}
          />
        ) : (
          <View style={[styles.localCamera, styles.videoOffPlaceholder]}>
            <View style={styles.localAvatar}>
              <Text style={styles.localAvatarText}>You</Text>
            </View>
          </View>
        )}
      </View>

      {/* Call info overlay */}
      <View style={styles.callInfoOverlay}>
        {callStatus === 'Connected' && (
          <Text style={styles.callDuration}>{formatTime(callDuration)}</Text>
        )}
        <Text style={styles.callWithText}>
          {isCaller ? 'Calling' : 'Incoming call from'}{' '}
          {userData?.name || 'User'}
        </Text>
      </View>

      {/* Control buttons */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={[styles.controlButton, isMuted && styles.activeControl]}
          onPress={toggleMute}
        >
          <Feather
            name={isMuted ? 'mic-off' : 'mic'}
            size={24}
            color={isMuted ? '#ff4444' : '#fff'}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, isVideoOff && styles.activeControl]}
          onPress={toggleVideo}
        >
          <Feather
            name={isVideoOff ? 'video-off' : 'video'}
            size={24}
            color={isVideoOff ? '#ff4444' : '#fff'}
          />
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={switchCamera}>
          <MaterialIcons name="flip-camera-android" size={24} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, styles.endCallButton]}
          onPress={endCall}
        >
          <Feather name="phone-off" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default VideoCall;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  remoteVideo: {
    flex: 1,
    backgroundColor: '#000',
  },
  remoteVideoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarText: {
    fontSize: 48,
    color: '#fff',
    fontWeight: 'bold',
  },
  remoteUserName: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 8,
  },

  localCameraContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 120,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
  },
  localCamera: {
    flex: 1,
  },
  videoOffPlaceholder: {
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  localAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#555',
    justifyContent: 'center',
    alignItems: 'center',
  },
  localAvatarText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold',
  },
  callInfoOverlay: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  callDuration: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 4,
  },
  callWithText: {
    fontSize: 14,
    color: '#aaa',
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeControl: {
    backgroundColor: 'rgba(255,68,68,0.3)',
    borderWidth: 1,
    borderColor: '#ff4444',
  },
  endCallButton: {
    backgroundColor: '#ff4444',
  },
  callStatusText: {
    fontSize: 16,
    color: '#aaa',
    marginTop: 10,
  },
});
