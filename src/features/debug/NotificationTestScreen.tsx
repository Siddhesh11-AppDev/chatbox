import React from 'react';
import { View, Text, Button, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../../core/context/AuthContext';
import { debugNotificationSystem, sendTestNotification } from '../../shared/utils/debugNotification';

const NotificationTestScreen = () => {
  const { userProfile } = useAuth();

  const handleTestNotificationSystem = async () => {
    if (!userProfile?.uid) {
      Alert.alert('Error', 'User not logged in');
      return;
    }
    
    try {
      await debugNotificationSystem(userProfile.uid);
      Alert.alert('Success', 'Notification system test completed. Check console logs.');
    } catch (error) {
      console.error('Test failed:', error);
      Alert.alert('Error', 'Test failed. Check console for details.');
    }
  };

  const handleSendTestNotification = async () => {
    if (!userProfile?.uid) {
      Alert.alert('Error', 'User not logged in');
      return;
    }
    
    try {
      await sendTestNotification(userProfile.uid);
      Alert.alert('Success', 'Test notification sent. Check if you receive it.');
    } catch (error) {
      console.error('Send test failed:', error);
      Alert.alert('Error', 'Failed to send test notification.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Notification System Test</Text>
      
      <View style={styles.userInfo}>
        <Text style={styles.label}>Current User:</Text>
        <Text style={styles.value}>{userProfile?.name || 'Not logged in'}</Text>
        <Text style={styles.label}>User ID:</Text>
        <Text style={styles.value}>{userProfile?.uid || 'N/A'}</Text>
      </View>

      <View style={styles.buttonContainer}>
        <Button 
          title="Test Notification System" 
          onPress={handleTestNotificationSystem}
          color="#2196F3"
        />
        <Button 
          title="Send Test Notification to Self" 
          onPress={handleSendTestNotification}
          color="#4CAF50"
        />
      </View>

      <View style={styles.instructions}>
        <Text style={styles.instructionTitle}>Instructions:</Text>
        <Text style={styles.instructionText}>1. Make sure you're logged in</Text>
        <Text style={styles.instructionText}>2. Run "Test Notification System" to verify setup</Text>
        <Text style={styles.instructionText}>3. Run "Send Test Notification to Self" to test receiving</Text>
        <Text style={styles.instructionText}>4. Check console logs for detailed information</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#333',
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
    gap: 15,
    marginBottom: 30,
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

export default NotificationTestScreen;