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
import { notificationService } from '../../core/services/notification.service';



const { width, height } = Dimensions.get('window');

const VideoCall = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { userData } = route.params as { userData: any };
  const { user } = useAuth();

  // State management
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callActive, setCallActive] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  const [callStatus, setCallStatus] = useState('Initializing...');
  const [connectionState, setConnectionState] = useState('initializing');

  // Refs
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const webRTCServiceRef = useRef<FirebaseWebRTCService | null>(null);
  const callIdRef = useRef<string>('');
   const incomingCallListenerRef = useRef<(() => void) | null>(null);

  // Initialize call
  useEffect(() => {
    const initializeCall = async () => {
      try {
        setCallStatus('Requesting permissions...');
        await requestPermissions();

        setCallStatus('Setting up connection...');
        
        // Generate call ID based on both user IDs
        const callId = generateCallId();
        callIdRef.current = callId;

        // Check if we're the caller or callee
        const isCallerUser = await checkIfCaller(callId);
        setIsCaller(isCallerUser);
        
        setCallStatus(isCallerUser ? 'Calling...' : 'Waiting for caller...');

        // Create WebRTC service with callbacks
        const webRTCService = new FirebaseWebRTCService(
          callId,
          user!.uid,
          handleRemoteStream,
          handleConnectionStateChange,
          handleError
        );
        
        webRTCServiceRef.current = webRTCService;

        // Initialize service
        await webRTCService.initialize(isCallerUser);

        // Get local stream
        setCallStatus('Accessing camera...');
        const stream = await getLocalStream();
        setLocalStream(stream);
        await webRTCService.addLocalStream(stream);

        // If caller, create offer. If callee, wait for offer
        if (isCallerUser) {
          setCallStatus('Connecting...');
          await webRTCService.createOffer();
          await sendCallNotification();
        } else {
          // Set up listener for incoming offer
          setCallStatus('Waiting for call...');
          await setupIncomingCallListener(callId, webRTCService);
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
      // Cleanup incoming call listener
      if (incomingCallListenerRef.current) {
        incomingCallListenerRef.current();
      }
      cleanup();
    };
  }, []);


  // Set up listener for incoming calls (for callee)
  const setupIncomingCallListener = async (callId: string, webRTCService: FirebaseWebRTCService) => {
    try {
      const callDocRef = firestore().collection('calls').doc(callId);
      
      // Listen for offers
      const unsubscribe = callDocRef.collection('offers').onSnapshot((snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            if (data.from !== user!.uid && data.offer) {
              console.log('Received incoming call offer');
              setCallStatus('Connecting to call...');
              // The FirebaseWebRTCService should handle this automatically
              // through its internal listeners
            }
          }
        });
      });
      
      incomingCallListenerRef.current = unsubscribe;
    } catch (error) {
      console.error('Error setting up incoming call listener:', error);
    }
  };


  // Add this function to VideoCall to send notification to callee
  const sendCallNotification = async () => {
    try {
      await notificationService.sendCallNotification({
        receiverId: userData.uid,
        callerId: user!.uid,
        callerName: userProfile?.name || 'User',
        callerAvatar: userProfile?.profile_image,
        callId: callIdRef.current,
        callType: 'video',
      });
      console.log('Call notification sent to:', userData.name);
    } catch (error) {
      console.error('Error sending call notification:', error);
    }
  };

  // Handle remote stream
  const handleRemoteStream = (stream: MediaStream) => {
    console.log('Remote stream received');
    setRemoteStream(stream);
    setCallStatus('Connected');
  };

  // Handle connection state changes
  const handleConnectionStateChange = (state: string) => {
    console.log('Connection state changed:', state);
    setConnectionState(state);
    
    const statusMap: Record<string, string> = {
      'new': 'Initializing...',
      'connecting': 'Connecting...',
      'connected': 'Connected',
      'disconnected': 'Disconnected',
      'failed': 'Connection Failed',
      'closed': 'Call Ended',
      'checking': 'Checking Connection...',
      'completed': 'Connection Ready'
    };
    
    const mappedStatus = statusMap[state] || state;
    setCallStatus(mappedStatus);
  };

  // Handle errors
  const handleError = (error: string) => {
    console.error('WebRTC Error:', error);
    Alert.alert('Call Error', error, [
      {
        text: 'End Call',
        onPress: () => navigation.goBack()
      }
    ]);
  };

  // Cleanup function
  const cleanup = async () => {
    console.log('Cleaning up video call');
    
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
    }

    if (webRTCServiceRef.current) {
      await webRTCServiceRef.current.endCall();
    }

    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
  };

  // Request permissions
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);

      if (
        granted['android.permission.CAMERA'] !== PermissionsAndroid.RESULTS.GRANTED ||
        granted['android.permission.RECORD_AUDIO'] !== PermissionsAndroid.RESULTS.GRANTED
      ) {
        throw new Error('Camera and audio permissions required');
      }
    }
  };

  // Generate unique call ID
  const generateCallId = (): string => {
    const userIds = [user!.uid, userData.uid].sort();
    return `call_${userIds.join('_')}_${Date.now()}`;
  };

  // Check if current user is the caller
  const checkIfCaller = async (callId: string): Promise<boolean> => {
    try {
      const callDoc = await firestore().collection('calls').doc(callId).get();
      return !callDoc.exists;
    } catch (error) {
      console.error('Error checking caller status:', error);
      return true; // Default to caller if error
    }
  };

  // Get local media stream
  const getLocalStream = async (): Promise<MediaStream> => {
    const constraints = {
      audio: true,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
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

  // Timer for call duration
  useEffect(() => {
    if (callActive && connectionState === 'connected') {
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }

    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [callActive, connectionState]);

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Toggle mute
  const toggleMute = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
    }
    setIsMuted(!isMuted);
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
    }
    setIsVideoOff(!isVideoOff);
  };

  // End call
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

  // Switch camera
  const switchCamera = async () => {
    if (!localStream) return;

    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const track = videoTracks[0];
      const currentFacingMode = track.getSettings().facingMode;
      const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

      try {
        // Stop current track
        track.stop();

        // Get new stream
        const newStream = await mediaDevices.getUserMedia({
          audio: true,
          video: {
            facingMode: newFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
        });

        // Update WebRTC connection
        if (webRTCServiceRef.current) {
          await webRTCServiceRef.current.addLocalStream(newStream);
        }

        // Update local state
        setLocalStream(newStream);

      } catch (error) {
        console.error('Error switching camera:', error);
        Alert.alert('Error', 'Failed to switch camera');
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      {/* Remote video or placeholder */}
      {remoteStream ? (
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
          <Text style={styles.connectionText}>Connection: {connectionState}</Text>
        </View>
      )}

      {/* Local camera preview */}
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

      {/* Call information overlay */}
      <View style={styles.callInfoOverlay}>
        {connectionState === 'connected' && (
          <Text style={styles.callDuration}>{formatTime(callDuration)}</Text>
        )}
        <Text style={styles.callWithText}>
          {isCaller ? 'Calling' : 'Incoming call from'} {userData?.name || 'User'}
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
  callStatusText: {
    fontSize: 16,
    color: '#aaa',
    marginTop: 10,
  },
  connectionText: {
    fontSize: 14,
    color: '#888',
    marginTop: 5,
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
});