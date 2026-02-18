import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView
} from 'react-native';
import { useAuth } from '../../core/context/AuthContext';
import { CallFlowDebugger, testFirestoreConnectivity } from '../../shared/utils/callFlowDebugger';
import firestore from '@react-native-firebase/firestore';

const SimpleCallTest = () => {
  const { userProfile } = useAuth();
  const [testStatus, setTestStatus] = useState<string>('Ready');
  const [testResults, setTestResults] = useState<string[]>([]);

  const addResult = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTestResults(prev => [...prev, `[${timestamp}] ${message}`]);
    console.log(message);
  };

  const clearResults = () => {
    setTestResults([]);
  };

  const testFirestore = async () => {
    setTestStatus('Testing Firestore...');
    addResult('Starting Firestore connectivity test...');
    
    try {
      const success = await testFirestoreConnectivity();
      if (success) {
        addResult('✅ Firestore connection: SUCCESS');
        setTestStatus('Firestore OK');
      } else {
        addResult('❌ Firestore connection: FAILED');
        setTestStatus('Firestore Error');
      }
    } catch (error) {
      addResult(`❌ Firestore test error: ${error}`);
      setTestStatus('Test Error');
    }
  };

  const testUserDocument = async () => {
    if (!userProfile?.uid) {
      Alert.alert('Error', 'Please log in first');
      return;
    }
    
    setTestStatus('Testing User Document...');
    addResult(`Testing user document for: ${userProfile.uid}`);
    
    try {
      const userDoc = await firestore().collection('users').doc(userProfile.uid).get();
      if (userDoc.exists()) {
        addResult('✅ User document exists');
        addResult(`User data: ${JSON.stringify(userDoc.data())}`);
        setTestStatus('User Document OK');
      } else {
        addResult('❌ User document not found');
        setTestStatus('User Document Missing');
      }
    } catch (error) {
      addResult(`❌ User document test failed: ${error}`);
      setTestStatus('Test Error');
    }
  };

  const testNotificationWrite = async () => {
    if (!userProfile?.uid) {
      Alert.alert('Error', 'Please log in first');
      return;
    }
    
    setTestStatus('Testing Notification Write...');
    addResult('Testing direct notification write to own document...');
    
    try {
      const testCallId = `self_test_${Date.now()}`;
      const notificationData = {
        callId: testCallId,
        callerId: userProfile.uid,
        callerName: 'Self Test',
        // callerAvatar omitted (undefined) since it's optional
        callType: 'video',
        timestamp: firestore.FieldValue.serverTimestamp()
      };
      
      addResult(`Writing notification: ${JSON.stringify(notificationData)}`);
      
      await firestore().collection('users').doc(userProfile.uid).set({
        incomingCall: notificationData
      }, { merge: true });
      
      addResult('✅ Notification written successfully');
      
      // Verify
      const doc = await firestore().collection('users').doc(userProfile.uid).get();
      const incomingCall = doc.data()?.incomingCall;
      
      if (incomingCall?.callId === testCallId) {
        addResult('✅ Verification successful - data matches');
        setTestStatus('Write Test OK');
      } else {
        addResult('❌ Verification failed - data mismatch');
        setTestStatus('Write Test Failed');
      }
      
      // Cleanup
      await firestore().collection('users').doc(userProfile.uid).update({
        incomingCall: null
      });
      addResult('✅ Cleanup completed');
      
    } catch (error) {
      addResult(`❌ Notification write test failed: ${error}`);
      setTestStatus('Test Error');
    }
  };

  const testFullCallFlow = async () => {
    if (!userProfile?.uid) {
      Alert.alert('Error', 'Please log in first');
      return;
    }
    
    setTestStatus('Testing Full Flow...');
    addResult('Testing complete call flow with yourself...');
    
    try {
      const success = await CallFlowDebugger.traceCallFlow(userProfile.uid, userProfile.uid);
      if (success) {
        addResult('✅ Full call flow test: SUCCESS');
        setTestStatus('Full Flow OK');
      } else {
        addResult('❌ Full call flow test: FAILED');
        setTestStatus('Full Flow Failed');
      }
    } catch (error) {
      addResult(`❌ Full flow test error: ${error}`);
      setTestStatus('Test Error');
    }
  };

  const startMonitoring = async () => {
    if (!userProfile?.uid) {
      Alert.alert('Error', 'Please log in first');
      return;
    }
    
    setTestStatus('Monitoring Active');
    addResult('Starting document monitoring for 30 seconds...');
    addResult('Try making a call to yourself during this time');
    
    CallFlowDebugger.monitorUserDocument(userProfile.uid, 30000);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Simple Call Test</Text>
      
      <View style={styles.statusContainer}>
        <Text style={styles.statusLabel}>Current Status:</Text>
        <Text style={styles.statusValue}>{testStatus}</Text>
      </View>

      <View style={styles.userInfo}>
        <Text style={styles.label}>Current User:</Text>
        <Text style={styles.value}>{userProfile?.name || 'Not logged in'}</Text>
        <Text style={styles.label}>User ID:</Text>
        <Text style={styles.value} selectable>{userProfile?.uid || 'N/A'}</Text>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={testFirestore}>
          <Text style={styles.buttonText}>Test Firestore</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={testUserDocument}>
          <Text style={styles.buttonText}>Test User Document</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={testNotificationWrite}>
          <Text style={styles.buttonText}>Test Notification Write</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.button} onPress={testFullCallFlow}>
          <Text style={styles.buttonText}>Test Full Call Flow</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.button, styles.monitorButton]} onPress={startMonitoring}>
          <Text style={styles.buttonText}>Start Monitoring (30s)</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.button, styles.clearButton]} onPress={clearResults}>
          <Text style={styles.buttonText}>Clear Results</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.resultsContainer}>
        <Text style={styles.resultsTitle}>Test Results:</Text>
        {testResults.length === 0 ? (
          <Text style={styles.noResults}>Run tests to see results here</Text>
        ) : (
          testResults.map((result, index) => (
            <Text key={index} style={styles.resultText} selectable>
              {result}
            </Text>
          ))
        )}
      </View>

      <View style={styles.instructions}>
        <Text style={styles.instructionTitle}>Testing Instructions:</Text>
        <Text style={styles.instructionText}>1. Run "Test Firestore" first to verify connection</Text>
        <Text style={styles.instructionText}>2. Run "Test User Document" to verify your account</Text>
        <Text style={styles.instructionText}>3. Run "Test Notification Write" to test basic functionality</Text>
        <Text style={styles.instructionText}>4. Run "Test Full Call Flow" for complete system test</Text>
        <Text style={styles.instructionText}>5. Use "Start Monitoring" to watch for real call attempts</Text>
        <Text style={styles.instructionText}>6. Check console logs for detailed information</Text>
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
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  statusContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    elevation: 2,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  statusValue: {
    fontSize: 18,
    color: '#333',
    fontWeight: 'bold',
    marginTop: 5,
  },
  userInfo: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    elevation: 2,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginTop: 10,
  },
  value: {
    fontSize: 18,
    color: '#333',
    marginBottom: 5,
  },
  buttonContainer: {
    gap: 10,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  monitorButton: {
    backgroundColor: '#4CAF50',
  },
  clearButton: {
    backgroundColor: '#ff9800',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  resultsContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    elevation: 2,
    maxHeight: 300,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
  },
  noResults: {
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 20,
  },
  resultText: {
    fontSize: 12,
    color: '#333',
    marginBottom: 5,
    fontFamily: 'monospace',
  },
  instructions: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    elevation: 2,
  },
  instructionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  instructionText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
    lineHeight: 20,
  },
});

export default SimpleCallTest;