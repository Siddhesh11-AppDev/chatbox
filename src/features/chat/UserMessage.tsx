import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  FlatList,
  TouchableOpacity,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import AntDesign from 'react-native-vector-icons/AntDesign';
import Entypo from 'react-native-vector-icons/Entypo';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../core/navigation/AppNavigator';
import AppTextInput from '../../shared/components/AppTextInput';
import { useAuth } from '../../core/context/AuthContext';
import { chatService } from '../../core/services/chat.service';
import firestore, {
  getDocs,
  query,
  where,
} from '@react-native-firebase/firestore';
import { getUserAvatar } from '../../shared/utils/avatarUtils';
import {
  launchImageLibrary,
  launchCamera,
  MediaType,
} from 'react-native-image-picker';

type Props = NativeStackScreenProps<AppStackParamList, 'userMsg'>;

interface Message {
  id?: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: any;
  read: boolean;
}

const UserMessage = ({ route }: Props) => {
  const navigation = useNavigation();
  const { userData } = route.params;
  const { user } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  // Request camera permission on component mount
  useEffect(() => {
    requestCameraPermission();
  }, []);

  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'This app needs access to your camera to take photos',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('Camera permission granted');
          setHasCameraPermission(true);
        } else {
          console.log('Camera permission denied');
          Alert.alert(
            'Permission Denied',
            'Camera permission is required to take photos',
          );
        }
      } catch (err) {
        console.warn(err);
      }
    } else {
      // iOS handles permissions differently, usually granted during app installation
      setHasCameraPermission(true);
    }
  };

  // Listen to messages
  useEffect(() => {
    if (!user) return;

    const chatId = chatService.getChatId(user.uid, userData.uid);
    const unsubscribe = chatService.listenToMessages(chatId, newMessages => {
      setMessages(newMessages);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });

    return () => unsubscribe();
  }, [user, userData]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || !user) return;

    try {
      const messageText = inputText.trim();
      setInputText('');
      setIsFocused(false);
      
      // Get the chat ID before sending the message
      const chatId = chatService.getChatId(user.uid, userData.uid);
      
      // Remove current user from deleted_for_users array to "undelete" the conversation
      const chatDocRef = firestore().doc(`chats/${chatId}`);
      const chatDoc = await chatDocRef.get();
      
      if (chatDoc.exists) {
        const chatData = chatDoc.data();
        if (chatData?.deleted_for_users?.includes(user.uid)) {
          // Remove current user from the deleted array
          await chatDocRef.update({
            deleted_for_users: firestore.FieldValue.arrayRemove(user.uid)
          });
        }
      }
      
      // Send the message after potentially "undeleting" the conversation
      await chatService.sendMessage(user.uid, userData.uid, messageText);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      Alert.alert('Error', 'Failed to send message');
    }
  };

  const handleSendImage = async (imageUri: string) => {
    if (!user) return;

    try {
      // Get the chat ID before sending the message
      const chatId = chatService.getChatId(user.uid, userData.uid);
      
      // Remove current user from deleted_for_users array to "undelete" the conversation
      const chatDocRef = firestore().doc(`chats/${chatId}`);
      const chatDoc = await chatDocRef.get();
      
      if (chatDoc.exists) {
        const chatData = chatDoc.data();
        if (chatData?.deleted_for_users?.includes(user.uid)) {
          // Remove current user from the deleted array
          await chatDocRef.update({
            deleted_for_users: firestore.FieldValue.arrayRemove(user.uid)
          });
        }
      }
      
      // Send the image message after potentially "undeleting" the conversation
      await chatService.sendMessage(
        user.uid,
        userData.uid,
        `image:${imageUri}`,
      );
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      Alert.alert('Error', 'Failed to send image');
    }
  };

  const selectImageFromGallery = () => {
    const options = {
      mediaType: 'photo' as MediaType,
      quality: 0.8 as const,
      maxWidth: 1000,
      maxHeight: 1000,
    };

    launchImageLibrary(options, response => {
      if (response.didCancel || response.errorCode) {
        console.log('Image picker cancelled or error:', response.errorMessage);
        return;
      }

      const asset = response.assets?.[0];
      if (asset && asset.uri) {
        handleSendImage(asset.uri);
      }
    });
  };

  const captureImageFromCamera = async () => {
    // Check if we have permission first
    if (Platform.OS === 'android' && !hasCameraPermission) {
      const permissionResult = await requestCameraPermission();
      if (!permissionResult) {
        return;
      }
    }

    const options = {
      mediaType: 'photo' as MediaType,
      quality: 0.8 as const,
      maxWidth: 1000,
      maxHeight: 1000,
    };

    launchCamera(options, response => {
      if (response.didCancel || response.errorCode) {
        console.log('Camera cancelled or error:', response.errorMessage);
        Alert.alert(
          'Error',
          response.errorMessage || 'Failed to capture image',
        );
        return;
      }

      const asset = response.assets?.[0];
      if (asset && asset.uri) {
        handleSendImage(asset.uri);
      }
    });
  };

  const showImageOptions = () => {
    Alert.alert(
      'Send Image',
      ' would you like to add an image?',
      [
        // {
        //   text: 'Camera',
        //   onPress: captureImageFromCamera,
        // },
        {
          text: 'Gallery',
          onPress: selectImageFromGallery,
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ],
      { cancelable: true },
    );
  };

  const formatTime = (timestamp: any) => {
    if (!timestamp) return '';

    let date;

    // Handle different timestamp formats
    if (timestamp.toDate) {
      // Firestore Timestamp
      date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
      // JavaScript Date object
      date = timestamp;
    } else if (timestamp._seconds) {
      // Firestore timestamp object
      date = new Date(timestamp._seconds * 1000);
    } else {
      return '';
    }

    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return '';

    let date;

    // Handle different timestamp formats
    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else if (timestamp instanceof Date) {
      date = timestamp;
    } else if (timestamp._seconds) {
      date = new Date(timestamp._seconds * 1000);
    } else {
      return '';
    }

    const today = new Date();
    const messageDate = new Date(date);

    if (messageDate.toDateString() === today.toDateString()) {
      return 'Today';
    } else {
      return messageDate.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
      });
    }
  };

  // Mark messages as read when user opens the chat
  useEffect(() => {
    if (!user) return;

    const chatId = chatService.getChatId(user.uid, userData.uid);

    const markMessagesAsRead = async () => {
      try {
        console.log('Attempting to mark messages as read for chat:', chatId);
        console.log('Current user ID:', user.uid);
        console.log('Chat partner ID:', userData.uid);

        const messagesRef = firestore()
          .collection('chats')
          .doc(chatId)
          .collection('messages');

        const q = query(
          messagesRef,
          where('receiverId', '==', user.uid), // Messages sent to current user
          where('read', '==', false), // That are unread
        );

        const snapshot = await getDocs(q);
        console.log(`Found ${snapshot.size} unread messages to mark as read`);

        if (snapshot.empty) {
          console.log('No unread messages found');
          return;
        }

        const batch = firestore().batch();

        snapshot.forEach((doc: any) => {
          console.log('Marking message as read:', doc.id);
          batch.update(doc.ref, { read: true });
        });

        await batch.commit();
        console.log(`Successfully marked ${snapshot.size} messages as read`);
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    };

    // Mark messages as read when component mounts
    markMessagesAsRead();
  }, [user, userData.uid]);

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const isCurrentUser = user && item.senderId === user.uid;
    const showDateSeparator =
      index === 0 ||
      (index > 0 &&
        formatDate(messages[index - 1].timestamp) !==
          formatDate(item.timestamp));

    // Check if message is an image (starts with 'image:' prefix)
    const isImageMessage = item.text.startsWith('image:');
    const messageText = isImageMessage ? item.text.substring(6) : item.text; // Remove 'image:' prefix

    return (
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
              {isImageMessage ? (
                <Image
                  source={{ uri: messageText }}
                  style={styles.imageMessage}
                  onError={error => console.log('Image load error:', error)}
                  onLoad={success => console.log('Image loaded successfully')}
                />
              ) : (
                <Text style={styles.messageText}>{item.text}</Text>
              )}
            </View>
            {/* Timestamp for both sender and receiver messages */}
            <Text
              style={[
                styles.timestamp,
                !isCurrentUser && isCurrentUser
                  ? styles.rightTimestamp
                  : styles.leftTimestamp,
              ]}
            >
              {formatTime(item.timestamp)}
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
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar barStyle="dark-content" backgroundColor="#FFF" />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={22} color="#000" />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarText}>{userData.name[0]}</Text>
            </View>

            <TouchableOpacity
              style={{ width: '60%' }}
              onPress={() =>
                navigation.navigate(
                  'userProfile' as never,
                  { userData } as never,
                )
              }
            >
              <View>
                <Text style={styles.headerName}>{userData.name}</Text>
                <Text style={styles.headerStatus}>
                  {userData.online ? 'Online' : 'Offline'}
                </Text>
              </View>
            </TouchableOpacity>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                flex: 1,
                gap: 30,
              }}
            >
              <TouchableOpacity>
                <Feather name="phone" size={24} color="#000" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate(
                    'videoCall' as never,
                    { userData } as never,
                  )
                }
              >
                <Feather name="video" size={24} color="#000" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item, index) => (item.id ? item.id : `msg-${index}`)}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />

        {/* INPUT BAR */}
        <View style={styles.inputWrapper}>
          <TouchableOpacity onPress={showImageOptions}>
            <Entypo name="attachment" size={24} color="#000" />
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
          >
            <Feather name="camera" size={24} color="#666" />
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
            <TouchableOpacity style={styles.actionButton}>
              <MaterialIcons name="keyboard-voice" size={24} color="#666" />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default UserMessage;

const styles = StyleSheet.create({
  actionButton: {},
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

  /* ---------------- Header ---------------- */
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
  headerAvatarText: {
    fontSize: 26,
    color: '#fff',
    textAlign: 'center',
  },
  headerAvatarTextUser: {
    fontSize: 20,
    color: '#fff',
    textAlign: 'center',
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  headerStatus: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 2,
  },

  /* ---------------- Messages ---------------- */
  listContent: {
    paddingBottom: 20,
  },
  dateSeparator: {
    alignItems: 'center',
    marginVertical: 15,
  },
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
  leftAlign: {
    justifyContent: 'flex-start',
    marginLeft: 10,
  },
  rightAlign: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 15,
  },
  currentUserAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginLeft: 8,
    marginBottom: 15,
  },
  bubbleContainer: {
    maxWidth: '75%',
  },
  leftContainer: {
    alignItems: 'flex-start',
  },
  rightContainer: {
    alignItems: 'flex-end',
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    maxWidth: '100%',
    minWidth: 60,
  },
  leftBubble: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 4,
    elevation: 1,
  },
  rightBubble: {
    backgroundColor: '#18b3a4',
    borderBottomRightRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
    color: '#000',
  },
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
  timestamp: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
  },

  /* ---------------- Input Bar ---------------- */
  inputWrapper: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: '#fff',
    height: 70,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderColor: '#eee',
    marginBottom: 20,
  },

  leftIcon: {
    padding: 6,
  },

  rightIcon: {
    padding: 6,
  },

  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  textInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
    color: '#000',
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

  disabledSendButton: {
    backgroundColor: '#f0f0f0',
  },

  imageMessage: {
    width: 200,
    height: 200,
    borderRadius: 8,
  },
});
