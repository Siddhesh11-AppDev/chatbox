// import { StyleSheet, Text, View } from 'react-native';
// import React from 'react';
// import { createNativeStackNavigator } from '@react-navigation/native-stack';
// import SplashScreen from '../screens/SplashScreen';
// import OnBoarding from '../screens/OnBoarding';
// import AuthNavigator from './AuthNavigator';
// import UserMessage from '../screens/home/message/UserMessage';

// export type AppStackParamList = {
//   Splash: undefined;
//   onBoard: undefined;
// };

// const Stack = createNativeStackNavigator();

// const AppNavigator = () => {
//   return (
//     <Stack.Navigator screenOptions={{ headerShown: false }}>
//       <Stack.Screen name="Splash" component={SplashScreen} />
//       <Stack.Screen name="OnBoard" component={OnBoarding} />
//       <Stack.Screen name="Auth" component={AuthNavigator} />
//       <Stack.Screen name='userMsg' component={UserMessage} />
//     </Stack.Navigator>
//   );
// };

// export default AppNavigator;

// const styles = StyleSheet.create({});


import { StyleSheet } from 'react-native';
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
// import { useAuth } from '../context/AuthContext';
import SplashScreen from '../screens/SplashScreen';
import OnBoarding from '../screens/OnBoarding';
import AuthNavigator from './AuthNavigator';
import TabNavigator from './TabNavigator';
import { useAuth } from '../context/AuthContext';

export type AppStackParamList = {
  Splash: undefined;
  OnBoard: undefined;
  Auth: undefined;
  Tab: undefined;
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
        <Stack.Screen name="Tab" component={TabNavigator} />
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