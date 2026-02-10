

import { StyleSheet } from 'react-native';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SplashScreen from '../SplashScreen';
import OnBoarding from '../../features/auth/OnBoarding';
import AuthNavigator from './AuthNavigator';
import TabNavigator from './TabNavigator';
import { useAuth } from '../context/AuthContext';
import UserMessage from '../../features/chat/UserMessage';
import UserProfile from '../../features/user/UserProfile';
import VideoCall from '../../features/chat/VideoCall';

export type AppStackParamList = {
  Splash: undefined;
  OnBoard: undefined;
  Auth: undefined;
  Tab: undefined;
  userMsg: { userData: any }; // Add this line for user message navigation
  userProfile:  { userData: any };
  videoCall: { userData: any }
};

const Stack = createNativeStackNavigator<AppStackParamList>();

const AppNavigator = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="Tab" component={TabNavigator} />
          <Stack.Screen name="userMsg" component={UserMessage} />
          <Stack.Screen name="userProfile" component={UserProfile} />
          <Stack.Screen name="videoCall" component={VideoCall} />
        </>
      ) : (
        <>
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="OnBoard" component={OnBoarding} />
          <Stack.Screen name="Auth" component={AuthNavigator} />
        </>
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;

const styles = StyleSheet.create({});
