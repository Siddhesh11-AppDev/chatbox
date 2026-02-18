import { StyleSheet, Text, View } from 'react-native';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import AppNavigator from './src/core/navigation/AppNavigator';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from './src/core/context/AuthContext';
import Toast from 'react-native-toast-message';
import CustomToast from './src/shared/components/CustomToast';
import NotificationHandler from './src/shared/components/NotificationHandler';
import { notificationService } from './src/core/services/notification.service';

// Define the root stack parameter list
export type RootStackParamList = {
  AppNav: undefined;
  IncomingCall: { callId: string; callerId: string; callerName: string; callerAvatar?: string; type?: 'video' | 'audio' };
  VideoCall: { userData: { uid: string; name: string; profile_image?: string } };
};

export const navigationRef = React.createRef<NavigationContainerRef<RootStackParamList>>();

const Stack = createNativeStackNavigator();

const App = () => {
  useEffect(() => {
    // Set the navigation reference for the notification service
    if (navigationRef.current) {
      notificationService.setNavigationRef(navigationRef.current);
    }
  }, []);

  return (
    <AuthProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <NavigationContainer ref={navigationRef}>
          <SafeAreaProvider 
            initialMetrics={{
              frame: { x: 0, y: 0, width: 0, height: 0 },
              insets: { top: 0, left: 0, right: 0, bottom: 0 },
            }}
          >
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="AppNav" component={AppNavigator} />
            </Stack.Navigator>
          </SafeAreaProvider>
        </NavigationContainer>
        <NotificationHandler />
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
