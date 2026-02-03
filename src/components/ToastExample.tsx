import React from 'react';
import { View, StyleSheet } from 'react-native';
import AppButton from './AppButton';
import { ToastHelper } from '../utils/ToastHelper';

/**
 * Example component demonstrating toast usage
 * This shows how to use different types of toast messages
 */
const ToastExample = () => {
  const showSuccessToast = () => {
    ToastHelper.success('Success!', 'Your action was completed successfully.');
  };

  const showErrorToast = () => {
    ToastHelper.error('Error!', 'Something went wrong. Please try again.');
  };

  const showWarningToast = () => {
    ToastHelper.warning('Warning', 'Please check your input and try again.');
  };

  const showInfoToast = () => {
    ToastHelper.info('Information', 'This is an informational message.');
  };

  const showPredefinedMessages = () => {
    // Show a sequence of predefined messages
    ToastHelper.showSigninSuccess();
    setTimeout(() => ToastHelper.showSignupSuccess(), 1500);
    setTimeout(() => ToastHelper.showLogoutSuccess(), 3000);
  };

  const showCustomToast = () => {
    ToastHelper.show({
      type: 'success',
      text1: 'Custom Message',
      text2: 'This is a custom toast with extended configuration',
      visibilityTime: 4000,
      position: 'bottom',
    });
  };

  const showLoadingToast = () => {
    ToastHelper.showLoading('Processing your request...');
    // Simulate async operation
    setTimeout(() => {
      ToastHelper.success('Success!', 'Operation completed!');
    }, 2000);
  };

  return (
    <View style={styles.container}>
      <AppButton
        title="Show Success Toast"
        onPress={showSuccessToast}
        backgroundColor="#4CAF50"
        textColor="#FFFFFF"
        style={styles.button}
        textStyle={styles.buttonText}
      />
      
      <AppButton
        title="Show Error Toast"
        onPress={showErrorToast}
        backgroundColor="#F44336"
        textColor="#FFFFFF"
        style={styles.button}
        textStyle={styles.buttonText}
      />
      
      <AppButton
        title="Show Warning Toast"
        onPress={showWarningToast}
        backgroundColor="#FF9800"
        textColor="#FFFFFF"
        style={styles.button}
        textStyle={styles.buttonText}
      />
      
      <AppButton
        title="Show Info Toast"
        onPress={showInfoToast}
        backgroundColor="#2196F3"
        textColor="#FFFFFF"
        style={styles.button}
        textStyle={styles.buttonText}
      />
      
      <AppButton
        title="Show Predefined Messages"
        onPress={showPredefinedMessages}
        backgroundColor="#9C27B0"
        textColor="#FFFFFF"
        style={styles.button}
        textStyle={styles.buttonText}
      />
      
      <AppButton
        title="Show Custom Toast"
        onPress={showCustomToast}
        backgroundColor="#009688"
        textColor="#FFFFFF"
        style={styles.button}
        textStyle={styles.buttonText}
      />
      
      <AppButton
        title="Show Loading Toast"
        onPress={showLoadingToast}
        backgroundColor="#607D8B"
        textColor="#FFFFFF"
        style={styles.button}
        textStyle={styles.buttonText}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 10,
  },
  button: {
    marginVertical: 5,
  },
  buttonText: {},
});

export default ToastExample;