import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useAuth } from '../../core/context/AuthContext';
import firestore from '@react-native-firebase/firestore';
import { notificationService } from '../../core/services/notification.service';

const VideoCallTest = () => {
  const { user } = useAuth();
  const [testUsers, setTestUsers] = useState<any[]>([]);
  const [callStatus, setCallStatus] = useState<string>('Ready');
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    loadTestUsers();
  }, []);

  const loadTestUsers = async () => {
    try {
      const usersRef = firestore().collection('users');
      const snapshot = await usersRef.get();
      const users: any[] = [];
      
      snapshot.forEach((doc: any) => {
        if (doc.id !== user?.uid) {
          users.push({
            uid: doc.id,
            ...doc.data()
          });
        }
      });
      
      setTestUsers(users);
      addLog(`Loaded ${users.length} test users`);
    } catch (error) {
      addLog(`Error loading users: ${error}`);
    }
  };

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    console.log(message);
  };

  const testCallNotification = async (targetUser: any) => {
    setCallStatus('Sending test notification...');
    addLog(`Testing call notification to ${targetUser.name} (${targetUser.uid})`);
    
    try {
      const callId = `test_call_${Date.now()}`;
      
      await notificationService.sendCallNotification({
        receiverId: targetUser.uid,
        callerId: user!.uid,
        callerName: user?.displayName || 'Test Caller',
        callerAvatar: user?.photoURL,
        callId: callId,
        callType: 'video'
      });
      
      addLog('✅ Test notification sent successfully');
      setCallStatus('Notification sent');
      
      // Auto-clear after 10 seconds
      setTimeout(async () => {
        try {
          await notificationService.clearIncomingCall(targetUser.uid);
          await notificationService.cancelCallNotification(callId, targetUser.uid);
          addLog('✅ Test notification auto-cleared');
          setCallStatus('Ready');
        } catch (error) {
          addLog(`Error clearing notification: ${error}`);
        }
      }, 10000);
      
    } catch (error) {
      addLog(`❌ Error sending test notification: ${error}`);
      setCallStatus('Error');
    }
  };

  const testFirestoreListener = async () => {
    addLog('Testing Firestore listener for current user...');
    
    const unsubscribe = notificationService.listenForIncomingCalls(
      user!.uid,
      (callData) => {
        addLog(`🔔 Incoming call detected: ${callData.callerName}`);
        Alert.alert(
          'Test Call Received',
          `Incoming call from ${callData.callerName}\nCall ID: ${callData.callId}`,
          [
            { text: 'OK', onPress: () => unsubscribe() }
          ]
        );
      }
    );
    
    addLog('✅ Listener started. Send a test notification to trigger it.');
    
    // Auto-unsubscribe after 30 seconds
    setTimeout(() => {
      unsubscribe();
      addLog('✅ Listener auto-unsubscribed after 30 seconds');
    }, 30000);
  };

  const clearAllNotifications = async () => {
    addLog('Clearing all test notifications...');
    try {
      await notificationService.clearIncomingCall(user!.uid);
      addLog('✅ All notifications cleared');
      setCallStatus('Ready');
    } catch (error) {
      addLog(`❌ Error clearing notifications: ${error}`);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Video Call Test</Text>
      
      <View style={styles.statusContainer}>
        <Text style={styles.statusLabel}>Status:</Text>
        <Text style={styles.statusValue}>{callStatus}</Text>
      </View>
      
      <View style={styles.buttonGroup}>
        <TouchableOpacity 
          style={styles.primaryButton} 
          onPress={testFirestoreListener}
        >
          <Text style={styles.buttonText}>Test Listener</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.secondaryButton} 
          onPress={clearAllNotifications}
        >
          <Text style={styles.buttonText}>Clear All</Text>
        </TouchableOpacity>
      </View>
      
      <Text style={styles.sectionTitle}>Test Users</Text>
      {testUsers.map((user, index) => (
        <View key={user.uid} style={styles.userCard}>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user.name}</Text>
            <Text style={styles.userUid}>{user.uid}</Text>
          </View>
          <TouchableOpacity 
            style={styles.callButton}
            onPress={() => testCallNotification(user)}
          >
            <Text style={styles.callButtonText}>Test Call</Text>
          </TouchableOpacity>
        </View>
      ))}
      
      <Text style={styles.sectionTitle}>Test Logs</Text>
      <View style={styles.logsContainer}>
        {logs.map((log, index) => (
          <Text key={index} style={styles.logText}>{log}</Text>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  statusContainer: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 10,
    color: '#666',
  },
  statusValue: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    flex: 0.48,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#FF3B30',
    padding: 15,
    borderRadius: 10,
    flex: 0.48,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  userCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  userUid: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  callButton: {
    backgroundColor: '#34C759',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  callButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  logsContainer: {
    backgroundColor: '#000',
    padding: 15,
    borderRadius: 10,
    maxHeight: 200,
  },
  logText: {
    color: '#00FF00',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
});

export default VideoCallTest;