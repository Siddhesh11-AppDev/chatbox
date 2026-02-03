import { StyleSheet, Text, View } from 'react-native';
import React from 'react';
import SplashScreen from './src/screens/SplashScreen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './src/navigation/AppNavigator';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from './src/context/AuthContext';
import Toast from 'react-native-toast-message';
import CustomToast from './src/components/CustomToast';


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
