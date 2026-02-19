
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
import VoiceCall from '../../features/chat/VoiceCall';
import StoryViewer from '../../features/stories/StoryViewer';
import StoryCreator from '../../features/stories/StoryCreator';
import IncomingCallScreen from '../../features/chat/IncomingCallScreen';

export type AppStackParamList = {
  Splash: undefined;
  OnBoard: undefined;
  Auth: undefined;
  Tab: undefined;
  userMsg: { userData: any };
  userProfile: { userData: any };
  // ↓ lowercase — must match navigation.navigate('videoCall', ...) calls
  videoCall: {
    userData: { uid: string; name: string; profile_image?: string };
    isIncomingCall?: boolean;
    callId?: string;
    callType?: 'video' | 'audio';
  };
  voiceCall: {
    userData: { uid: string; name: string; profile_image?: string };
    isIncomingCall?: boolean;
    callId?: string;
    callType?: 'video' | 'audio';
  };
  // IncomingCall at top level so it can be reached from anywhere
  IncomingCall: {
    callId: string;
    callerId: string;
    callerName: string;
    callerAvatar?: string;
    type?: 'video' | 'audio';
  };
  StoryViewer: {
    storyUsers: import('../services/stories.service').StoryUser[];
    initialIndex: number;
  };
  StoryCreator: undefined;
  Settings: undefined;
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
          <Stack.Screen name="Tab"         component={TabNavigator} />
          <Stack.Screen name="userMsg"     component={UserMessage} />
          <Stack.Screen name="userProfile" component={UserProfile} />

          <Stack.Screen
            name="videoCall"
            component={VideoCall}
            options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
          />
          <Stack.Screen
            name="voiceCall"
            component={VoiceCall}
            options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
          />
          <Stack.Screen
            name="IncomingCall"
            component={IncomingCallScreen}
            options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
          />
          <Stack.Screen
            name="StoryViewer"
            component={StoryViewer}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="StoryCreator"
            component={StoryCreator}
            options={{ headerShown: false }}
          />
        </>
      ) : (
        <>
          <Stack.Screen name="Splash"  component={SplashScreen} />
          <Stack.Screen name="OnBoard" component={OnBoarding} />
          <Stack.Screen name="Auth"    component={AuthNavigator} />
        </>
      )}
    </Stack.Navigator>
  );
};

export default AppNavigator;