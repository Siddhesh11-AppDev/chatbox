import { StyleSheet, Text, View } from 'react-native';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './src/core/navigation/AppNavigator';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from './src/core/context/AuthContext';
import Toast from 'react-native-toast-message';
import CustomToast from './src/shared/components/CustomToast';
import NotificationHandler from './src/shared/components/NotificationHandler';


// Define the root stack parameter list
export type RootStackParamList = {
  AppNav: undefined;
};

const Stack = createNativeStackNavigator();

const App = () => {
  return (
    <AuthProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <NavigationContainer>
          <SafeAreaProvider>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="AppNav" component={AppNavigator} />
            </Stack.Navigator>
            <NotificationHandler />
          </SafeAreaProvider>
        </NavigationContainer>
        <Toast config={{
          success: (props) => <CustomToast {...props} type="success" />,
          error: (props) => <CustomToast {...props} type="error" />,
          info: (props) => <CustomToast {...props} type="info" />,
          warning: (props) => <CustomToast {...props} type="warning" />,
        }} />
      </GestureHandlerRootView>
    </AuthProvider>
  );
};

export default App;

const styles = StyleSheet.create({});
