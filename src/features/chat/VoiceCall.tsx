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
import { mediaDevices, MediaStream } from 'react-native-webrtc';
import Feather from 'react-native-vector-icons/Feather';
import { FirebaseWebRTCService } from '../../core/services/FirebaseWebRTCService';
import { useAuth } from '../../core/context/AuthContext';
import firestore from '@react-native-firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { notificationService } from '../../core/services/notification.service';

const { width, height } = Dimensions.get('window');

const VoiceCall = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { userData, isIncomingCall, callId: incomingCallId } = route.params as { 
    userData: any; 
    isIncomingCall?: boolean;
    callId?: string;
  };
  const { user } = useAuth();

  // State management
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callActive, setCallActive] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  const [callStatus, setCallStatus] = useState('Initializing...');
  const [connectionState, setConnectionState] = useState('initializing');

  // Refs
  const callTimerRef = useRef<number | null>(null);
  const webRTCServiceRef = useRef<FirebaseWebRTCService | null>(null);
  const callIdRef = useRef<string>('');

  // Initialize call
  useEffect(() => {
    const initializeCall = async () => {
      try {
        setCallStatus('Requesting permissions...');
        await requestPermissions();

        setCallStatus('Setting up connection...');
        
        // Use provided call ID for incoming calls, generate new one for outgoing
        const callId = isIncomingCall && incomingCallId 
          ? incomingCallId 
          : generateCallId();
        callIdRef.current = callId;

        // Check if we're the caller or callee
        const isCallerUser = isIncomingCall ? false : await checkIfCaller(callId);
        setIsCaller(isCallerUser);
        
        setCallStatus(isCallerUser ? 'Calling...' : 'Waiting for caller...');

        // Create WebRTC service with callbacks
        const webRTCService = new FirebaseWebRTCService(
          callId,
          user!.uid,
          handleRemoteStream,
          handleConnectionStateChange,
          handleError,
          handleOfferReceived
        );
        
        webRTCServiceRef.current = webRTCService;

        // Initialize service
        await webRTCService.initialize(isCallerUser);

        // Get local stream (audio only)
        setCallStatus('Accessing microphone...');
        const stream = await getLocalStream();
        setLocalStream(stream);
        await webRTCService.addLocalStream(stream);

        // If caller, create offer. If callee, wait for offer
        if (isCallerUser) {
          setCallStatus('Connecting...');
          console.log('=== VOICE CALL: Creating offer ===');
          await webRTCService.createOffer(true); // Audio only
          console.log('=== VOICE CALL: Offer created, sending notification ===');
          await sendCallNotification();
          console.log('=== VOICE CALL: Notification sent, waiting for answer ===');
        } else {
          setCallStatus('Waiting for call...');
          console.log('=== VOICE CALL: Waiting for incoming call ===');
        }

      } catch (error) {
        console.error('Error initializing voice call:', error);
        Alert.alert(
          'Error',
          'Failed to initialize voice call: ' + (error as Error).message,
        );
        navigation.goBack();
      }
    };

    initializeCall();

    return () => {
      cleanup();
    };
  }, []);

  // Handle offer received by callee
  const handleOfferReceived = async (offerData: any) => {
    console.log('=== VOICE CALL: Offer received ===');
    console.log('Offer from:', offerData.from);
    
    if (isCaller) {
      setCallStatus('Connecting to call...');
      try {
        if (webRTCServiceRef.current) {
          await webRTCServiceRef.current.handleRemoteOffer(offerData.offer);
          console.log('✅ Offer handled, answer sent');
        }
      } catch (error) {
        console.error('❌ Error handling offer:', error);
        handleError('Failed to connect to call');
      }
    }
  };

  // Send notification to callee
  const sendCallNotification = async () => {
    console.log('=== VOICE CALL: SENDING CALL NOTIFICATION ===');
    console.log('Receiver:', userData.uid);
    console.log('Caller:', user?.uid);
    console.log('Call ID:', callIdRef.current);
    
    try {
      const userDoc = await firestore().collection('users').doc(userData.uid).get();
      const userProfile = userDoc.exists() ? userDoc.data() : null;
      
      await notificationService.sendCallNotification({
        receiverId: userData.uid,
        callerId: user!.uid,
        callerName: user?.displayName || user?.email || 'User',
        callerAvatar: userProfile?.profile_image,
        callId: callIdRef.current,
        callType: 'audio', // Audio call type
      });
      console.log('✅ Voice call notification sent to:', userData.name);
    } catch (error) {
      console.error('❌ Error sending voice call notification:', error);
      throw error;
    }
  };

  // Handle remote stream
  const handleRemoteStream = (stream: MediaStream) => {
    console.log('Remote audio stream received');
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
    
    if (isCaller && state === 'connected') {
      console.log('=== VOICE CALL: Connection established ===');
    }
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
    console.log('=== CLEANING UP VOICE CALL ===');
    
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
    
    // Clear incoming call notification if we're the receiver
    if (!isCaller && callIdRef.current) {
      console.log('Clearing incoming call notification for receiver');
      try {
        await notificationService.clearIncomingCall(user!.uid);
        await notificationService.cancelCallNotification(callIdRef.current, user!.uid);
      } catch (error) {
        console.error('Error clearing incoming call notification:', error);
      }
    }
    
    console.log('✅ Voice call cleanup completed');
  };

  // Request permissions
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );

      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error('Audio permission required');
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
      return true;
    }
  };

  // Get local media stream (audio only)
  const getLocalStream = async (): Promise<MediaStream> => {
    console.log('=== VOICE CALL DEBUG ===');
    console.log('Getting local audio stream...');
    
    const constraints = {
      audio: true,
      video: false, // No video for voice calls
    };

    try {
      console.log('Requesting audio media with constraints:', constraints);
      const stream = await mediaDevices.getUserMedia(constraints);
      console.log('Audio stream obtained successfully!');
      console.log('Audio tracks:', stream.getAudioTracks());
      console.log('Video tracks:', stream.getVideoTracks()); // Should be empty
      console.log('=======================');
      return stream;
    } catch (error) {
      console.error('=== VOICE CALL ERROR ===');
      console.error('Error getting local audio stream:', error);
      console.error('Error name:', (error as Error).name);
      console.error('Error message:', (error as Error).message);
      console.error('========================');
      throw new Error('Failed to access microphone');
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      {/* Background with user info */}
      <View style={styles.background}>
        <View style={styles.userAvatarContainer}>
          <View style={styles.userAvatar}>
            <Text style={styles.userAvatarText}>{userData?.name?.[0] || 'U'}</Text>
          </View>
          <Text style={styles.userName}>{userData?.name || 'User'}</Text>
          <Text style={styles.callStatusText}>{callStatus}</Text>
          <Text style={styles.connectionText}>Connection: {connectionState}</Text>
          
          {connectionState === 'connected' && (
            <Text style={styles.callDuration}>{formatTime(callDuration)}</Text>
          )}
        </View>
      </View>

      {/* Control buttons */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={[styles.controlButton, isMuted && styles.activeControl]}
          onPress={toggleMute}
        >
          <Feather
            name={isMuted ? 'mic-off' : 'mic'}
            size={32}
            color={isMuted ? '#ff4444' : '#fff'}
          />
          <Text style={styles.controlText}>{isMuted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, styles.endCallButton]}
          onPress={endCall}
        >
          <Feather name="phone-off" size={32} color="#fff" />
          <Text style={styles.controlText}>End Call</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default VoiceCall;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  background: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  userAvatarContainer: {
    alignItems: 'center',
  },
  userAvatar: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
    borderWidth: 3,
    borderColor: '#fff',
  },
  userAvatarText: {
    fontSize: 60,
    color: '#fff',
    fontWeight: 'bold',
  },
  userName: {
    fontSize: 28,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 10,
  },
  callStatusText: {
    fontSize: 18,
    color: '#aaa',
    marginBottom: 5,
  },
  connectionText: {
    fontSize: 14,
    color: '#888',
    marginBottom: 20,
  },
  callDuration: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '600',
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 30,
  },
  controlButton: {
    alignItems: 'center',
  },
  controlText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 8,
  },
  activeControl: {
    opacity: 0.7,
  },
  endCallButton: {
    backgroundColor: '#ff4444',
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});