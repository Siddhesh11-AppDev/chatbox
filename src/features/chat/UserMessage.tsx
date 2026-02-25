import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  FlatList,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  PermissionsAndroid,
  Linking,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import Entypo from 'react-native-vector-icons/Entypo';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../core/navigation/AppNavigator';
import AppTextInput from '../../shared/components/AppTextInput';
import { useAuth } from '../../core/context/AuthContext';
import { chatService } from '../../core/services/chat.service';
import { notificationService } from '../../core/services/notification.service';
import { callHistoryService } from '../../core/services/callHistory.service';
import firestore, {
  getDocs,
  query,
  where,
} from '@react-native-firebase/firestore';
import {
  launchImageLibrary,
  launchCamera,
  MediaType,
} from 'react-native-image-picker';

import Sound from 'react-native-nitro-sound';
import RNFS from 'react-native-fs';

type Props = NativeStackScreenProps<AppStackParamList, 'userMsg'>;

interface Message {
  id?: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: any;
  read: boolean;
  type?: 'text' | 'image' | 'audio';
  imageData?: string;
  audioData?: string;
  audioDuration?: number;
  deleted?: boolean;
  deleted_for?: string[];
}

export interface CallHistoryItem {
  id: string;
  participants: string[];
  callerId: string;
  calleeId: string;
  callerName: string;
  calleeName: string;
  callerAvatar?: string;
  calleeAvatar?: string;
  callType: 'audio' | 'video';
  callStatus: 'missed' | 'received' | 'rejected' | 'completed' | 'outgoing';
  duration?: number; // in seconds
  timestamp: any;
}

const UserMessage = ({ route }: Props) => {
  const navigation =
    useNavigation<NativeStackScreenProps<AppStackParamList>['navigation']>();
  const { userData } = route.params;
  const { user, userProfile } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [isSendingImage, setIsSendingImage] = useState(false);
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [isSendingAudio, setIsSendingAudio] = useState(false);
  const recordingPath = useRef<string>('');
  const isLongPress = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  // Audio playback states
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState<
    Record<string, number>
  >({});

  // Selected message for delete
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    requestCameraPermission();
    return () => {
      Sound.stopRecorder().catch(() => {});
      Sound.stopPlayer().catch(() => {});
      Sound.removeRecordBackListener();
      Sound.removePlayBackListener();
    };
  }, []);

  // Load call history - show only recent items
  useEffect(() => {
    if (!user) return;
    
    const loadCallHistory = async () => {
      try {
        // Load only the 5 most recent call history items to avoid clutter
        const history = await callHistoryService.getCallHistory(user.uid, 5);
        setCallHistory(history);
      } catch (error) {
        console.error('Error loading call history:', error);
      }
    };
    
    loadCallHistory();
    
    // Listen for real-time updates
    const unsubscribe = callHistoryService.listenToCallHistory(user.uid, (newHistory) => {
      // Only keep the 5 most recent items
      const recentHistory = newHistory.slice(0, 5);
      setCallHistory(recentHistory);
    });
    
    return () => unsubscribe();
  }, [user]);

  // ─── Pulse animation for recording dot ───────────────────────────────────────
  const startPulse = () => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.current.start();
  };

  const stopPulse = () => {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  };

  // ─── Permissions ──────────────────────────────────────────────────────────────
  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'This app needs access to your camera to capture photos',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          setHasCameraPermission(true);
          return true;
        } else {
          Alert.alert(
            'Permission Required',
            'Camera permission is required. Please enable it in Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Go to Settings', onPress: () => Linking.openSettings() },
            ],
          );
          return false;
        }
      } catch (err) {
        return false;
      }
    } else {
      setHasCameraPermission(true);
      return true;
    }
  };

  const requestMicrophonePermission = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message:
              'This app needs microphone access to record voice messages',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          return true;
        } else {
          Alert.alert(
            'Permission Required',
            'Microphone permission is required to record voice messages.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Go to Settings', onPress: () => Linking.openSettings() },
            ],
          );
          return false;
        }
      } catch (err) {
        return false;
      }
    }
    return true;
  };

  // ─── Listen to messages ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const chatId = chatService.getChatId(user.uid, userData.uid);
    const unsubscribe = chatService.listenToMessages(chatId, newMessages => {
      setMessages(newMessages);
      setTimeout(
        () => flatListRef.current?.scrollToEnd({ animated: true }),
        100,
      );
    });
    return () => unsubscribe();
  }, [user, userData]);

  // ─── Mark messages as read ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const chatId = chatService.getChatId(user.uid, userData.uid);
    const markMessagesAsRead = async () => {
      try {
        const messagesRef = firestore()
          .collection('chats')
          .doc(chatId)
          .collection('messages');
        const q = query(
          messagesRef,
          where('receiverId', '==', user.uid),
          where('read', '==', false),
        );
        const snapshot = await getDocs(q);
        if (!snapshot || snapshot.empty) return;
        const batch = firestore().batch();
        snapshot.forEach((doc: any) => batch.update(doc.ref, { read: true }));
        await batch.commit();
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    };
    markMessagesAsRead();
  }, [user, userData.uid]);

  // ─── Voice recording ──────────────────────────────────────────────────────────
  const startRecording = async () => {
    const hasPermission = await requestMicrophonePermission();
    if (!hasPermission) return;

    try {
      const path =
        Platform.OS === 'android'
          ? `${RNFS.CachesDirectoryPath}/voice_${Date.now()}.mp4`
          : `${RNFS.CachesDirectoryPath}/voice_${Date.now()}.m4a`;

      recordingPath.current = path;

      // ✅ FIX 5: Sound.startRecorder
      await Sound.startRecorder(path);
      Sound.addRecordBackListener(e => {
        setRecordSecs(Math.floor(e.currentPosition / 1000));
      });

      setIsRecording(true);
      isLongPress.current = true;
      startPulse();
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopAndSendRecording = async () => {
    if (!isRecording) return;
    stopPulse();
    try {
      // ✅ FIX 6: Sound.stopRecorder
      const result = await Sound.stopRecorder();
      Sound.removeRecordBackListener();
      const currentSecs = recordSecs;
      setIsRecording(false);
      setRecordSecs(0);
      isLongPress.current = false;

      if (currentSecs < 1) {
        Alert.alert('Too short', 'Hold longer to record a voice message.');
        return;
      }

      await handleSendAudio(result, currentSecs);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setIsRecording(false);
      setRecordSecs(0);
    }
  };

  const cancelRecording = async () => {
    if (!isRecording) return;
    stopPulse();
    try {
      // ✅ FIX 7: Sound.stopRecorder
      await Sound.stopRecorder();
      Sound.removeRecordBackListener();
      setIsRecording(false);
      setRecordSecs(0);
      isLongPress.current = false;
    } catch (error) {
      console.error('Failed to cancel recording:', error);
      setIsRecording(false);
    }
  };

  const handleSendAudio = async (filePath: string, duration: number) => {
    if (!user || isSendingAudio) return;
    try {
      setIsSendingAudio(true);
      const base64Audio = await RNFS.readFile(filePath, 'base64');

      const chatId = chatService.getChatId(user.uid, userData.uid);
      const chatDocRef = firestore().doc(`chats/${chatId}`);
      const chatDoc = await chatDocRef.get();
      if (chatDoc && chatDoc.exists()) {
        const chatData = chatDoc.data();
        if (chatData?.deleted_for_users?.includes(user.uid)) {
          await chatDocRef.update({
            deleted_for_users: firestore.FieldValue.arrayRemove(user.uid),
          });
        }
      }

      await chatService.sendMessage(
        user.uid,
        userData.uid,
        'Voice Message',
        undefined,
        base64Audio,
        duration,
      );
      setTimeout(
        () => flatListRef.current?.scrollToEnd({ animated: true }),
        100,
      );
    } catch (error) {
      console.error('Error sending audio:', error);
      Alert.alert(
        'Error',
        'Failed to send voice message: ' + (error as Error).message,
      );
    } finally {
      setIsSendingAudio(false);
    }
  };

  // ─── Audio playback ───────────────────────────────────────────────────────────
  const handlePlayAudio = async (message: Message) => {
    if (!message.id || !message.audioData) return;

    try {
      if (playingMessageId === message.id) {
        // ✅ FIX 8: Sound.stopPlayer
        await Sound.stopPlayer();
        Sound.removePlayBackListener();
        setPlayingMessageId(null);
        return;
      }

      if (playingMessageId) {
        await Sound.stopPlayer();
        Sound.removePlayBackListener();
      }

      const tempPath =
        Platform.OS === 'android'
          ? `${RNFS.CachesDirectoryPath}/play_${message.id}.mp4`
          : `${RNFS.CachesDirectoryPath}/play_${message.id}.m4a`;

      await RNFS.writeFile(tempPath, message.audioData, 'base64');
      setPlayingMessageId(message.id);

      // ✅ FIX 9: Sound.startPlayer
      await Sound.startPlayer(tempPath);
      Sound.addPlayBackListener(e => {
        setPlaybackPosition(prev => ({
          ...prev,
          [message.id!]: e.currentPosition,
        }));
        if (e.currentPosition >= e.duration - 50) {
          Sound.stopPlayer();
          Sound.removePlayBackListener();
          setPlayingMessageId(null);
          setPlaybackPosition(prev => ({ ...prev, [message.id!]: 0 }));
        }
      });
    } catch (error) {
      console.error('Error playing audio:', error);
      setPlayingMessageId(null);
    }
  };

  // ─── Delete message ───────────────────────────────────────────────────────────
  const handleDeleteMessage = (messageId: string) => {
    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMessage(messageId),
        },
      ],
    );
    setSelectedMessageId(null);
  };

  const deleteMessage = async (messageId: string) => {
    if (!user) return;
    try {
      const chatId = chatService.getChatId(user.uid, userData.uid);
      await firestore()
        .collection('chats')
        .doc(chatId)
        .collection('messages')
        .doc(messageId)
        .delete(); // ← permanently deletes the Firestore document
    } catch (error) {
      console.error('Error deleting message:', error);
      Alert.alert('Error', 'Failed to delete message');
    }
  };
  // ─── Call handlers ────────────────────────────────────────────────────────────
  const handleVideoCall = async () => {
    try {
      const callId = `call_${[user!.uid, userData.uid]
        .sort()
        .join('_')}_${Date.now()}`;
      
    
      
      await notificationService.sendCallNotification({
        receiverId: userData.uid,
        callerId: user!.uid,
        callerName: user?.displayName || user?.email || 'User',
        callerAvatar: userProfile?.profile_image,
        callId,
        callType: 'video',
      });
      navigation.navigate('videoCall', {
        userData: {
          uid: userData.uid,
          name: userData.name,
          profile_image: userData.profile_image,
        },
        isIncomingCall: false,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to initiate call. Please try again.');
    }
  };

  const handleVoiceCall = async () => {
    try {
      const callId = `call_${[user!.uid, userData.uid]
        .sort()
        .join('_')}_${Date.now()}`;
      
    
      
      await notificationService.sendCallNotification({
        receiverId: userData.uid,
        callerId: user!.uid,
        callerName: user?.displayName || user?.email || 'User',
        callerAvatar: userProfile?.profile_image,
        callId,
        callType: 'audio',
      });
      navigation.navigate('voiceCall', {
        userData: {
          uid: userData.uid,
          name: userData.name,
          profile_image: userData.profile_image,
        },
        isIncomingCall: false,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to initiate voice call. Please try again.');
    }
  };

  // ─── Send text message ────────────────────────────────────────────────────────
  const handleSendMessage = async () => {
    if (!inputText.trim() || !user) return;
    try {
      const messageText = inputText.trim();
      setInputText('');
      setIsFocused(false);

      const chatId = chatService.getChatId(user.uid, userData.uid);
      const chatDocRef = firestore().doc(`chats/${chatId}`);
      const chatDoc = await chatDocRef.get();
      if (!chatDoc) return;
      if (chatDoc.exists()) {
        const chatData = chatDoc.data();
        if (chatData?.deleted_for_users?.includes(user.uid)) {
          await chatDocRef.update({
            deleted_for_users: firestore.FieldValue.arrayRemove(user.uid),
          });
        }
      }

      await chatService.sendMessage(user.uid, userData.uid, messageText);
      setTimeout(
        () => flatListRef.current?.scrollToEnd({ animated: true }),
        100,
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to send message');
    }
  };

  // ─── Send image ───────────────────────────────────────────────────────────────
  const handleSendImage = async (imageUri: string) => {
    if (!user || isSendingImage) return;
    try {
      setIsSendingImage(true);
      const chatId = chatService.getChatId(user.uid, userData.uid);
      const chatDocRef = firestore().doc(`chats/${chatId}`);
      const chatDoc = await chatDocRef.get();
      if (!chatDoc) return;
      if (chatDoc.exists()) {
        const chatData = chatDoc.data();
        if (chatData?.deleted_for_users?.includes(user.uid)) {
          await chatDocRef.update({
            deleted_for_users: firestore.FieldValue.arrayRemove(user.uid),
          });
        }
      }
      await chatService.sendMessage(user.uid, userData.uid, 'Image', imageUri);
      setTimeout(
        () => flatListRef.current?.scrollToEnd({ animated: true }),
        100,
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to send image: ' + (error as Error).message);
    } finally {
      setIsSendingImage(false);
    }
  };

  const selectImageFromGallery = () => {
    launchImageLibrary(
      {
        mediaType: 'photo' as MediaType,
        quality: 0.8,
        maxWidth: 1000,
        maxHeight: 1000,
      },
      response => {
        if (response.didCancel || response.errorCode) return;
        const asset = response.assets?.[0];
        if (asset?.uri) handleSendImage(asset.uri);
      },
    );
  };

  const captureImageFromCamera = async () => {
    if (Platform.OS === 'android' && !hasCameraPermission) {
      const ok = await requestCameraPermission();
      if (!ok) return;
    }
    launchCamera(
      {
        mediaType: 'photo' as MediaType,
        quality: 0.8,
        maxWidth: 1000,
        maxHeight: 1000,
      },
      response => {
        if (response.didCancel || response.errorCode) {
          Alert.alert(
            'Error',
            response.errorMessage || 'Failed to capture image',
          );
          return;
        }
        const asset = response.assets?.[0];
        if (asset?.uri) handleSendImage(asset.uri);
      },
    );
  };

  const showImageOptions = () => {
    if (isSendingImage) {
      Alert.alert('Please wait', 'Image is being uploaded...');
      return;
    }
    Alert.alert(
      'Send Image',
      'Choose source',
      [
        { text: 'Gallery', onPress: selectImageFromGallery },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  };

  // ─── Formatters ───────────────────────────────────────────────────────────────
  const formatTime = (timestamp: any) => {
    if (!timestamp) return '';
    let date: Date;
    if (timestamp.toDate) date = timestamp.toDate();
    else if (timestamp instanceof Date) date = timestamp;
    else if (timestamp._seconds) date = new Date(timestamp._seconds * 1000);
    else return '';
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '';
    let date: Date;
    if (timestamp.toDate) date = timestamp.toDate();
    else if (timestamp instanceof Date) date = timestamp;
    else if (timestamp._seconds) date = new Date(timestamp._seconds * 1000);
    else return '';
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return 'Today';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatRecordTime = (secs: number) => {
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatAudioDuration = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const m = Math.floor(totalSecs / 60)
      .toString()
      .padStart(2, '0');
    const s = (totalSecs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ─── Call History Helpers ──────────────────────────────────────────────────────
  const getCallIcon = (callType: 'audio' | 'video', callStatus: string) => {
    if (callStatus === 'missed') return 'phone-missed';
    if (callStatus === 'rejected') return 'phone-missed';
    if (callStatus === 'outgoing') {
      return callType === 'audio' ? 'arrow-up-right' : 'arrow-up-right';
    }
    return callType === 'audio' ? 'phone' : 'video';
  };

  const getCallIconColor = (callStatus: string) => {
    if (callStatus === 'missed' || callStatus === 'rejected') return '#FF3B30';
    if (callStatus === 'outgoing') return '#34C759';
    return '#34C759';
  };

  const formatCallTime = (timestamp: any) => {
    if (!timestamp) return '';
    let date: Date;
    if (timestamp.toDate) date = timestamp.toDate();
    else if (timestamp instanceof Date) date = timestamp;
    else if (timestamp._seconds) date = new Date(timestamp._seconds * 1000);
    else return '';
    
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatCallDate = (timestamp: any) => {
    if (!timestamp) return '';
    let date: Date;
    if (timestamp.toDate) date = timestamp.toDate();
    else if (timestamp instanceof Date) date = timestamp;
    else if (timestamp._seconds) date = new Date(timestamp._seconds * 1000);
    else return '';
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getCallStatusText = (callStatus: string, callType: string) => {
    if (callStatus === 'missed') return 'Missed call';
    if (callStatus === 'rejected') return 'Rejected call';
    if (callStatus === 'outgoing') return `Outgoing ${callType} call`;
    if (callStatus === 'received') return `Incoming ${callType} call`;
    return `${callType} call`;
  };

  const getChatCallStatusText = (callStatus: string, callType: string, isCurrentUserCaller: boolean) => {
    if (callStatus === 'missed') return 'Missed call';
    if (callStatus === 'rejected') return 'Rejected call';
    if (callStatus === 'outgoing') return isCurrentUserCaller ? `Outgoing ${callType} call` : `Incoming ${callType} call`;
    if (callStatus === 'received') return isCurrentUserCaller ? `Incoming ${callType} call` : `Outgoing ${callType} call`;
    // For completed calls, determine from current user's perspective
    return isCurrentUserCaller ? `Outgoing ${callType} call` : `Incoming ${callType} call`;
  };

  const handleCallHistoryItemPress = (callItem: CallHistoryItem) => {
    // You can implement actions like calling back or viewing call details
    console.log('Call history item pressed:', callItem);
  };

  const renderCallHistoryItem = (callItem: CallHistoryItem) => {
    const isCurrentUserCaller = (user && callItem.callerId === user.uid) ?? false;
    const otherUserName = isCurrentUserCaller ? callItem.calleeName : callItem.callerName;
    const otherUserAvatar = isCurrentUserCaller ? callItem.calleeAvatar : callItem.callerAvatar;
    
    // Only show call history items that involve the current chat user
    const involvesCurrentChatUser = 
      (callItem.callerId === userData.uid || callItem.calleeId === userData.uid) &&
      (callItem.callerId === user?.uid || callItem.calleeId === user?.uid);
    
    if (!involvesCurrentChatUser) {
      return null; // Don't render call history items that don't involve this chat
    }
    
    return (
      <View style={styles.callHistoryCombinedBox}>
        <Feather
          name={getCallIcon(callItem.callType, callItem.callStatus)}
          size={16}
          color={getCallIconColor(callItem.callStatus)}
        />
        <Text style={styles.callHistoryCombinedText}>
          {getChatCallStatusText(callItem.callStatus, callItem.callType, isCurrentUserCaller)}
          {callItem.duration ? ` • ${formatAudioDuration(callItem.duration * 1000)}` : ''}
        </Text>
        <Text style={styles.callHistoryMessageTime}>
          {formatCallTime(callItem.timestamp)}
        </Text>
      </View>
    );
  };

  // Combine messages and recent call history for single integrated display
  const getCombinedChatItems = () => {
    // If no call history, just return messages
    if (callHistory.length === 0) return messages;
    
    // Create a combined array with both messages and recent call history items
    const combinedItems: (Message | CallHistoryItem)[] = [...messages];
    
    // Add call history items with a special type identifier for rendering
    callHistory.forEach(call => {
      combinedItems.push({
        ...call,
        isCallHistory: true,
      } as Message & CallHistoryItem & { isCallHistory: true });
    });
    
    // Sort by timestamp chronologically (oldest first)
    combinedItems.sort((a: any, b: any) => {
      const timeA = a.timestamp?.toDate?.() || a.timestamp || new Date(0);
      const timeB = b.timestamp?.toDate?.() || b.timestamp || new Date(0);
      return new Date(timeA).getTime() - new Date(timeB).getTime();
    });
    
    return combinedItems;
  };

  // Cache combined messages and call history for better performance
  const combinedChatItems = useMemo(() => getCombinedChatItems(), [messages, callHistory]);
  
  // ─── Render message item ──────────────────────────────────────────────────────
  const renderItem = ({ item, index }: { item: Message | (CallHistoryItem & { isCallHistory?: boolean }); index: number }) => {
    // Handle call history items in the integrated display
    if ('isCallHistory' in item && item.isCallHistory) {
      const callItem = item as CallHistoryItem;
      return renderCallHistoryItem(callItem);
    }
    
    // Handle regular messages
    const message = item as Message;
    // ✅ FIX 10: deleted_for now in interface — no more TS error
    if (message.deleted_for && user && message.deleted_for.includes(user.uid)) {
      return null;
    }

    const isCurrentUser = user && message.senderId === user.uid;
    const isSelected = selectedMessageId === message.id;
    const showDateSeparator =
      index === 0 ||
      (index > 0 &&
        formatDate(combinedChatItems[index - 1].timestamp) !==
          formatDate(message.timestamp));

    const isImageMessage = message.type === 'image' && message.imageData;
    const isAudioMessage = message.type === 'audio' && message.audioData;
    const isDeleted = message.deleted === true;

    const isPlaying = playingMessageId === message.id;
    const position = playbackPosition[message.id!] || 0;
    const durationMs = (message.audioDuration || 0) * 1000;
    const progress = durationMs > 0 ? Math.min(position / durationMs, 1) : 0;

    return (
      <TouchableWithoutFeedback
        onLongPress={() => {
          if (!isDeleted) setSelectedMessageId(item.id || null);
        }}
        onPress={() => setSelectedMessageId(null)}
      >
        <View>
          {showDateSeparator && (
            <View style={styles.dateSeparator}>
              <Text style={styles.dateText}>{formatDate(item.timestamp)}</Text>
            </View>
          )}

          <View
            style={[
              styles.messageRow,
              isCurrentUser ? styles.rightAlign : styles.leftAlign,
            ]}
          >
            {!isCurrentUser && (
              <View style={styles.headerAvatarUser}>
                <Text style={styles.headerAvatarTextUser}>
                  {userData.name[0]}
                </Text>
              </View>
            )}

            <View
              style={[
                styles.bubbleContainer,
                isCurrentUser ? styles.rightContainer : styles.leftContainer,
              ]}
            >
              <View
                style={[
                  styles.bubble,
                  isCurrentUser ? styles.rightBubble : styles.leftBubble,
                ]}
              >
                {isDeleted ? (
                  <Text style={styles.deletedText}>
                    🚫 This message was deleted
                  </Text>
                ) : isImageMessage ? (
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${message.imageData}` }}
                    style={styles.imageMessage}
                  />
                ) : isAudioMessage ? (
                  /* ── Audio bubble ── */
                  <TouchableOpacity
                    style={styles.audioBubble}
                    onPress={() => handlePlayAudio(message)}
                  >
                    <View
                      style={[
                        styles.audioPlayBtn,
                        isCurrentUser
                          ? styles.audioPlayBtnRight
                          : styles.audioPlayBtnLeft,
                      ]}
                    >
                      <MaterialIcons
                        name={isPlaying ? 'pause' : 'play-arrow'}
                        size={22}
                        color="#fff"
                      />
                    </View>
                    <View style={styles.audioInfo}>
                      <View style={styles.progressBarBg}>
                        <View
                          style={[
                            styles.progressBarFill,
                            { width: `${progress * 100}%` },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.audioDuration,
                          isCurrentUser
                            ? styles.audioDurationRight
                            : styles.audioDurationLeft,
                        ]}
                      >
                        {isPlaying
                          ? formatAudioDuration(position)
                          : formatAudioDuration(
                              (message.audioDuration || 0) * 1000,
                            )}
                      </Text>
                    </View>
                    <MaterialIcons
                      name="keyboard-voice"
                      size={16}
                      color={isCurrentUser ? 'rgba(255,255,255,0.7)' : '#888'}
                      style={{ marginLeft: 4 }}
                    />
                  </TouchableOpacity>
                ) : (
                  <Text
                    style={[
                      styles.messageText,
                      isCurrentUser && { color: '#fff' },
                    ]}
                  >
                    {message.text}
                  </Text>
                )}
              </View>

              <Text
                style={[
                  styles.timestamp,
                  isCurrentUser ? styles.rightTimestamp : styles.leftTimestamp,
                ]}
              >
                {formatTime(message.timestamp)}
              </Text>
            </View>

            {isCurrentUser && (
              <View style={styles.headerAvatarUser}>
                <Text style={styles.headerAvatarTextUser}>
                  {user?.displayName?.charAt(0)}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableWithoutFeedback>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar barStyle="dark-content" backgroundColor="#FFF" />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => {
            // Navigate to the Tab navigator which contains the Messages screen
            navigation.navigate('Tab');
          }}>
            <Feather name="arrow-left" size={22} color="#000" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarText}>{userData.name[0]}</Text>
            </View>

            <TouchableOpacity
              style={{ width: '60%' }}
              onPress={() => navigation.navigate('userProfile', { userData })}
            >
              <Text style={styles.headerName}>{userData.name}</Text>
              <Text style={styles.headerStatus}>
                {userData.online ?? false ? 'Online' : 'Offline'}
              </Text>
            </TouchableOpacity>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                flex: 1,
                gap: 20,
              }}
            >
              <TouchableOpacity onPress={handleVoiceCall}>
                <Feather name="phone" size={24} color="#000" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleVideoCall}>
                <Feather name="video" size={24} color="#000" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Single integrated display for messages and recent call history */}
        <FlatList
          ref={flatListRef}
          data={combinedChatItems}
          keyExtractor={(item, index) => (item.id ? item.id : `item-${index}`)}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          onTouchStart={() => setSelectedMessageId(null)}
          onLayout={() => {
            // Scroll to bottom to show latest messages
            setTimeout(() => {
              flatListRef.current?.scrollToEnd({ animated: false });
            }, 100);
          }}
        />

        {/* INPUT BAR */}
        <View style={styles.inputWrapper}>
          {isRecording ? (
            /* ── Recording UI ── */
            <View style={styles.recordingRow}>
              <TouchableOpacity
                onPress={cancelRecording}
                style={styles.cancelRecordBtn}
              >
                <MaterialIcons name="delete" size={24} color="#ff4444" />
              </TouchableOpacity>

              <View style={styles.recordingCenter}>
                <Animated.View
                  style={[styles.recordingDot, { opacity: pulseAnim }]}
                />
                <Text style={styles.recordingTime}>
                  {formatRecordTime(recordSecs)}
                </Text>
                <Text style={styles.recordingHint}>Release ▲ to send</Text>
              </View>

              <TouchableOpacity
                style={styles.sendRecordBtn}
                onPress={stopAndSendRecording}
                disabled={isSendingAudio}
              >
                <Feather name="send" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            /* ── Normal input UI ── */
            <>
              <TouchableOpacity
                onPress={showImageOptions}
                disabled={isSendingImage}
              >
                <Entypo
                  name="attachment"
                  size={24}
                  color={isSendingImage ? '#ccc' : '#000'}
                />
              </TouchableOpacity>

              <View style={{ width: '66%', top: 10, left: 3 }}>
                <AppTextInput
                  style={{
                    backgroundColor: '#f0f0f0',
                    borderRadius: 14,
                    paddingRight: 40,
                  }}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Type a message..."
                  placeholderTextColor="#999"
                  multiline
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  label={null}
                  error={null}
                />
                <TouchableOpacity
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: 10,
                    backgroundColor: '#f0f0f0',
                  }}
                >
                  <Feather name="file" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={captureImageFromCamera}
                disabled={isSendingImage}
              >
                <Feather
                  name="camera"
                  size={24}
                  color={isSendingImage ? '#ccc' : '#666'}
                />
              </TouchableOpacity>

              {inputText.trim() ? (
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    !inputText.trim() && styles.disabledSendButton,
                  ]}
                  onPress={handleSendMessage}
                  disabled={!inputText.trim()}
                >
                  <Feather
                    name="send"
                    size={22}
                    color={inputText.trim() ? '#fff' : '#aaa'}
                  />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.actionButton}
                  disabled={isSendingImage || isSendingAudio}
                  onLongPress={startRecording}
                  onPressOut={() => {
                    if (isLongPress.current) stopAndSendRecording();
                  }}
                  delayLongPress={250}
                >
                  <MaterialIcons
                    name="keyboard-voice"
                    size={28}
                    color={isSendingAudio ? '#ccc' : '#18b3a4'}
                    // color="#999"
                  />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default UserMessage;

const styles = StyleSheet.create({
  actionButton: {},
  container: { flex: 1, backgroundColor: '#fff' },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 60,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginLeft: 10,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 21,
    marginRight: 10,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarUser: {
    width: 30,
    height: 30,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarText: { fontSize: 26, color: '#fff', textAlign: 'center' },
  headerAvatarTextUser: { fontSize: 20, color: '#fff', textAlign: 'center' },
  headerName: { fontSize: 16, fontWeight: '600', color: '#000' },
  headerStatus: { fontSize: 12, color: '#4CAF50', marginTop: 2 },

  /* Messages */
  listContent: { paddingBottom: 20 },
  dateSeparator: { alignItems: 'center', marginVertical: 15 },
  dateText: {
    fontSize: 12,
    color: '#666',
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  messageRow: {
    flexDirection: 'row',
    marginVertical: 4,
    alignItems: 'flex-end',
  },
  leftAlign: { justifyContent: 'flex-start', marginLeft: 10 },
  rightAlign: { justifyContent: 'flex-end' },
  bubbleContainer: { maxWidth: '75%' },
  leftContainer: { alignItems: 'flex-start' },
  rightContainer: { alignItems: 'flex-end' },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    maxWidth: '100%',
    minWidth: 60,
  },
  leftBubble: {
    backgroundColor: '#eee',
    borderBottomLeftRadius: 4,
    elevation: 1,
  },
  rightBubble: { backgroundColor: '#18b3a4', borderBottomRightRadius: 4 },
  messageText: { fontSize: 16, lineHeight: 20, color: '#000' },
  deletedText: { fontSize: 14, color: '#999', fontStyle: 'italic' },
  leftTimestamp: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  rightTimestamp: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timestamp: { fontSize: 11, color: '#888', marginTop: 4 },
  imageMessage: { width: 200, height: 200, borderRadius: 8 },

  /* Delete action bar */
  actionBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: '#fff3f3',
    borderRadius: 8,
    marginHorizontal: 16,
    marginBottom: 2,
  },
  actionBarLeft: { justifyContent: 'flex-start' },
  actionBarRight: { justifyContent: 'flex-end' },
  actionBarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionBarText: { color: '#ff4444', fontSize: 13, fontWeight: '600' },

  /* Audio bubble */
  audioBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 180,
    gap: 8,
  },
  audioPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioPlayBtnRight: { backgroundColor: 'rgba(255,255,255,0.3)' },
  audioPlayBtnLeft: { backgroundColor: '#18b3a4' },
  audioInfo: { flex: 1, gap: 4 },
  progressBarBg: {
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  audioDuration: { fontSize: 11 },
  audioDurationRight: { color: 'rgba(255,255,255,0.8)' },
  audioDurationLeft: { color: '#666' },

  /* Input bar */
  inputWrapper: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#fff',
    minHeight: 70,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderColor: '#eee',
    marginBottom: 20,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#18b3a4',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
    marginBottom: 2,
  },
  disabledSendButton: { backgroundColor: '#f0f0f0' },

  /* Recording UI */
  recordingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  cancelRecordBtn: { padding: 8 },
  recordingCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff4444',
  },
  recordingTime: { fontSize: 18, fontWeight: '700', color: '#333' },
  recordingHint: { fontSize: 11, color: '#888' },
  sendRecordBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#18b3a4',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Integrated Call History Message Styles
  callHistoryMessageAvatarContainer: {
    width: 32,
    height: 32,
    marginRight: 8,
  },
  callHistoryMessageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  callHistoryMessageAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callHistoryMessageAvatarText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  callHistoryMessageInfo: {
    flex: 1,
  },
  callHistoryMessageName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  callHistoryMessageSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  callHistoryMessageStatus: {
    fontSize: 12,
    color: '#666',
    marginLeft: 6,
  },
  callHistoryMessageTime: {
    fontSize: 11,
    color: '#888',
    marginLeft: 8,
  },
  
  // Combined call history box styles
  callHistoryCombinedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f4f8',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    alignSelf: 'center',
    maxWidth: '85%',
    minWidth: 260,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    marginBottom:10
  },
  callHistoryCombinedText: {
    fontSize: 15,
    color: '#333',
    marginLeft: 10,
    fontWeight: '500',
    flex: 1,
  },
});
