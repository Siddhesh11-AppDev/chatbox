import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Vibration,
  Animated,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { FirebaseWebRTCService } from '../../core/services/FirebaseWebRTCService';
import { useAuth } from '../../core/context/AuthContext';
import firestore, { serverTimestamp } from '@react-native-firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';

interface CallData {
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  callId: string;
  type: 'video' | 'audio';
}

const IncomingCallScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { callData } = route.params as { callData: CallData };
  const { user } = useAuth();

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringtoneRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Start vibration pattern
    Vibration.vibrate([0, 500, 500, 500], true);

    // Start pulsing animation
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnimation.start();

    return () => {
      Vibration.cancel();
      pulseAnimation.stop();
      if (ringtoneRef.current) {
        clearInterval(ringtoneRef.current);
      }
    };
  }, []);

  const handleAccept = async () => {
    Vibration.cancel();
    
    try {
      // Navigate to VideoCall with the call data
      navigation.navigate('videoCall', {
        userData: {
          uid: callData.callerId,
          name: callData.callerName,
          profile_image: callData.callerAvatar,
        },
        callId: callData.callId,
        isIncoming: true,
      });
    } catch (error) {
      console.error('Error accepting call:', error);
      Vibration.cancel();
      navigation.goBack();
    }
  };

  const handleReject = async () => {
    Vibration.cancel();
    
    try {
      // Update call status in Firestore
      await firestore()
        .collection('calls')
        .doc(callData.callId)
        .update({
          status: 'rejected',
          rejectedAt: serverTimestamp(),
          [`participants.${user?.uid}.rejectedAt`]: serverTimestamp(),
        });
    } catch (error) {
      console.error('Error rejecting call:', error);
    }
    
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      <View style={styles.content}>
        {/* Caller Avatar */}
        <Animated.View
          style={[
            styles.avatarContainer,
            { transform: [{ scale: pulseAnim }] }
          ]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {callData.callerName?.charAt(0).toUpperCase() || 'U'}
            </Text>
          </View>
        </Animated.View>

        {/* Caller Info */}
        <Text style={styles.callerName}>{callData.callerName || 'Unknown'}</Text>
        <Text style={styles.callType}>
          {callData.type === 'video' ? 'Video Call' : 'Audio Call'} Incoming...
        </Text>

        {/* Call Actions */}
        <View style={styles.actionsContainer}>
          {/* Reject Button */}
          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton]}
            onPress={handleReject}
          >
            <MaterialIcons name="call-end" size={32} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Decline</Text>

          {/* Accept Button */}
          <TouchableOpacity
            style={[styles.actionButton, styles.acceptButton]}
            onPress={handleAccept}
          >
            <Feather name="video" size={32} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Accept</Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  avatarContainer: {
    marginBottom: 30,
  },
  avatar: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  avatarText: {
    fontSize: 60,
    color: '#fff',
    fontWeight: 'bold',
  },
  callerName: {
    fontSize: 28,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 10,
  },
  callType: {
    fontSize: 16,
    color: '#aaa',
    marginBottom: 50,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 60,
  },
  actionButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectButton: {
    backgroundColor: '#F44336',
  },
  acceptButton: {
    backgroundColor: '#4CAF50',
  },
  actionLabel: {
    color: '#fff',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },
});

export default IncomingCallScreen;