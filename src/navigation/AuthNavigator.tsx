import { StyleSheet, Text, View } from 'react-native';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Signin from '../screens/auth/Signin';
import Signup from '../screens/auth/Signup';
import TabNavigator from './TabNavigator';

export type AuthStackParamList = {
  Signin: undefined;
  Signup: undefined;
};

const Stack = createNativeStackNavigator();

const AuthNavigator = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Tab">
      {/* <Stack.Screen name="Signup" component={Signup} /> */}
      {/* <Stack.Screen name="Signin" component={Signin} /> */}
      <Stack.Screen name="Tab" component={TabNavigator} />
    </Stack.Navigator>
  );
};

export default AuthNavigator;

const styles = StyleSheet.create({});