import { StyleSheet, Text, View } from 'react-native';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SplashScreen from '../screens/SplashScreen';
import OnBoarding from '../screens/OnBoarding';
import AuthNavigator from './AuthNavigator';

export type AppStackParamList = {
  Splash: undefined;
  onBoard: undefined;
};

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {/* <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="OnBoard" component={OnBoarding} /> */}
      <Stack.Screen name="Auth" component={AuthNavigator} />
    </Stack.Navigator>
  );
};

export default AppNavigator;

const styles = StyleSheet.create({});
