import {
  Animated,
  FlatList,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
  Modal,
  TouchableWithoutFeedback,
  Platform,
  PermissionsAndroid,
  Dimensions,
} from 'react-native';
import React, { useEffect, useRef, useState } from 'react';
import firestore, {
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  doc,
} from '@react-native-firebase/firestore';
// import { navigationRef } from '../../core/navigation/AppNavigator';
import { notificationService } from '../../core/services/notification.service';
import Feather from 'react-native-vector-icons/Feather';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Swipeable } from 'react-native-gesture-handler';
import { useAuth } from '../../core/context/AuthContext';
import { AppStackParamList } from '../../core/navigation/TabNavigator';
import { chatService } from '../../core/services/chat.service';
import { getUserAvatar } from '../../shared/utils/avatarUtils';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  storiesService,
  StoryUser,
  Story,
} from '../../core/services/stories.service';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import ImageResizer from 'react-native-image-resizer';
// ── Call history integration ──────────────────────────────────────────────────
import { callHistoryService } from '../../core/services/callHistory.service';
import { CallHistoryItem } from '../chat/UserMessage';

type MessagesNavigationProp = NativeStackNavigationProp<
  AppStackParamList,
  'Messages' | 'userMsg'
>;

interface User {
  uid: string;
  name: string;
  email: string;
  profile_image?: string;
  online?: boolean;
  last_message?: string;
  last_message_time?: any;
  unread_count?: number;
  deleted_for_user?: boolean;
}

// ─── Call-to-last-message formatting ─────────────────────────────────────────
//
//  Mirrors WhatsApp's conversation list preview for calls:
//    📞 Outgoing voice call · 0:42
//    📹 Incoming video call · 2:15
//    📞 Missed call              ← shown in red in the row (handled via isMissedCall)
//    📞 No answer
//
// ─────────────────────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Returns a formatted string for displaying a call as the "last message"
 * in the conversation list.
 *
 * The callStatus already encodes the viewer's perspective (outgoing/received/
 * missed/rejected) because we fixed the recording logic in VideoCall/VoiceCall.
 * We only fall back to callerId comparison for legacy 'completed' records.
 */
function formatCallPreview(call: CallHistoryItem, currentUserId: string): string {
  const isVideo = call.callType === 'video';
  const typeLabel = isVideo ? 'video' : 'voice';
  const dur = call.duration && call.duration > 0
    ? `  ·  ${fmtDuration(call.duration)}`
    : '';

  switch (call.callStatus) {
    case 'outgoing':
      return ` Outgoing ${typeLabel} call${dur}`;

    case 'received':
      return ` Incoming ${typeLabel} call${dur}`;

    case 'missed':
      // From the caller's POV: "No answer" (they called, no one picked up)
      // From the callee's POV: "Missed call" (they missed it)
      return call.callerId === currentUserId
        ? ` Missed Video call`
        : ` Missed Video call`;

    case 'rejected':
      // Callee deliberately declined — their history shows "Missed call"
      return ` Missed call`;

    // Legacy 'completed' records (pre-ownerId migration)
    case 'completed': {
      const isCaller = call.callerId === currentUserId;
      return isCaller
        ? ` Outgoing ${typeLabel} call${dur}`
        : ` Incoming ${typeLabel} call${dur}`;
    }

    default:
      return ` Call`;
  }
}

/** True when the call was a missed/rejected call from the viewer's perspective. */
function isMissedCall(call: CallHistoryItem, currentUserId: string): boolean {
  if (call.callStatus === 'rejected') return true;
  if (call.callStatus === 'missed') return true;
  return false;
}

/** Parse any Firestore-compatible timestamp into ms-since-epoch (or 0). */
function toMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (ts._seconds) return ts._seconds * 1000;
  return 0;
}

const Messages = () => {
  const scrollY = useRef(new Animated.Value(0)).current;
  const searchWidth = useRef(new Animated.Value(40)).current;
  const searchOpacity = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation<MessagesNavigationProp>();
  const { user, userProfile } = useAuth(); // Changed from just 'user'
  const [users, setUsers] = useState<User[]>([]);
  const [conversationUsers, setConversationUsers] = useState<User[]>([]);
  const [storyUsers, setStoryUsers] = useState<StoryUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isSearching, setIsSearching] = useState(false); // New state for search mode
  const [unreadCounts, setUnreadCounts] = useState<{ [key: string]: number }>(
    {},
  );
  const [lastMessages, setLastMessages] = useState<{ [key: string]: string }>(
    {},
  );
  // ── NEW: store chat message timestamps so we can rank against call timestamps
  const [lastMessageTimestamps, setLastMessageTimestamps] = useState<{ [key: string]: number }>({});
  // ── NEW: most-recent call record keyed by the OTHER user's uid
  const [lastCalls, setLastCalls] = useState<{ [key: string]: CallHistoryItem }>({});

  const [refreshing, setRefreshing] = useState(false);
  const [storySheetVisible, setStorySheetVisible] = useState(false);
  const [isUploadingStory, setIsUploadingStory] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(280)).current;
  const sheetBackdropOpacity = useRef(new Animated.Value(0)).current;

  // ── Full-screen story viewer modal ────────────────────────────────────────
  const [storyViewerVisible, setStoryViewerVisible] = useState(false);
  const [viewerStoryUsers, setViewerStoryUsers] = useState<StoryUser[]>([]);
  const [viewerInitialIndex, setViewerInitialIndex] = useState(0);
  const storyViewerSlide = useRef(new Animated.Value(Dimensions.get('window').height)).current;

  // Toggle search bar animation
  const toggleSearchBar = () => {
    if (isSearchActive) {
      Animated.parallel([
        Animated.timing(searchWidth, {
          toValue: 40,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(searchOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: false,
        }),
      ]).start();
      setIsSearching(false); // Exit search mode
    } else {
      Animated.parallel([
        Animated.timing(searchWidth, {
          toValue: 300,
          duration: 250,
          useNativeDriver: false,
        }),
        Animated.timing(searchOpacity, {
          toValue: 1,
          duration: 200,
          delay: 50,
          useNativeDriver: false,
        }),
      ]).start();
      setIsSearching(true); // Enter search mode
    }
    setIsSearchActive(!isSearchActive);
  };

  // Function to check which users have conversations with current user
  const checkConversationUsers = async (userList: User[]) => {
    if (!user) return;

    const usersWithConversations: User[] = [];

    for (const targetUser of userList) {
      const chatId = chatService.getChatId(user.uid, targetUser.uid);

      try {
        // Check if this conversation is marked as deleted for current user
        const chatDocRef = doc(firestore(), 'chats', chatId);
        const chatDoc = await chatDocRef.get();
        
        // Check if chatDoc is null (Firebase error)
        if (!chatDoc) {
          console.log('❌ Firestore document query returned null');
          return;
        }

        if (chatDoc.exists()) {
          const chatData = chatDoc.data();

          // If chat is not marked as deleted for current user, include in conversation list
          if (!chatData?.deleted_for_users?.includes(user.uid)) {
            // Also check if there are messages in this chat
            const messagesRef = collection(
              firestore(),
              `chats/${chatId}/messages`,
            );
            const snapshot = await getDocs(messagesRef);
            
            // Check if snapshot is null (Firebase error)
            if (!snapshot) {
              console.log('❌ Firestore query returned null');
              continue;
            }

            if (!snapshot.empty) {
              usersWithConversations.push(targetUser);
            }
          }
        }
      } catch (error) {
        console.error(
          `Error checking conversation for user ${targetUser.uid}:`,
          error,
        );
      }
    }

    setConversationUsers(usersWithConversations);
  };

  useEffect(() => {
    if (!user) return;

    const usersRef = collection(firestore(), 'users');
    const q = query(usersRef, where('uid', '!=', user.uid));

    const mapUser = (userData: any): User => ({
      uid: userData.uid,
      name: userData.name || '',
      email: userData.email || '',
      profile_image:
        userData.profile_image ||
        getUserAvatar({
          displayName: userData.name,
          photoURL: userData.profile_image,
        }),
      online: !!userData.online,
      last_message:
        typeof userData.last_message === 'string' ? userData.last_message : '',
      last_message_time: userData.last_message_time || null,
      unread_count: userData.unread_count || 0,
    });

    const fetchUsers = async () => {
      try {
        const snapshot = await getDocs(q);
        
        // Check if snapshot is null (Firebase error)
        if (!snapshot) {
          console.log('❌ Firestore query returned null');
          setUsers([]);
          return;
        }
        
        const userList: User[] = [];
        snapshot.forEach((doc: any) => {
          userList.push(mapUser(doc.data()));
        });
        setUsers(userList);
        await checkConversationUsers(userList);
      } catch (error) {
        console.error('Error fetching users:', error);
      }
    };

    fetchUsers();

    const unsubscribeUsers = onSnapshot(q, snapshot => {
      const userList: User[] = [];
      snapshot.forEach((doc: any) => {
        userList.push(mapUser(doc.data()));
      });
      setUsers(userList);
      checkConversationUsers(userList);
    });

    // Additionally subscribe to chat changes to detect when deleted conversations get new messages
    const unsubscribeChats = firestore()
      .collection('chats')
      .where('participants', 'array-contains', user.uid)
      .onSnapshot(chatSnapshot => {
        // Refresh conversation list when chat documents change
        checkConversationUsers(users);
      });

    return () => {
      unsubscribeUsers();
      unsubscribeChats(); // Clean up the chat listener as well
    };
  }, [user]);

  // Set up listeners for unread message counts
  useEffect(() => {
    if (!user) return;

    // Use all users (not just conversationUsers) to detect when a deleted conversation gets new messages
    const usersToCheck =
      conversationUsers.length > 0 ? conversationUsers : users;

    const unsubs: any[] = [];

    usersToCheck.forEach((u: User) => {
      const chatId = chatService.getChatId(user.uid, u.uid);
      const messagesRef = collection(firestore(), `chats/${chatId}/messages`);

      const q = query(
        messagesRef,
        where('receiverId', '==', user.uid),
        where('read', '==', false),
      );

      const unsubscribe = onSnapshot(q, snapshot => {
        const count = snapshot?.size || 0;
        setUnreadCounts(prev => ({
          ...prev,
          [u.uid]: count,
        }));

        // Check if this user should be in conversation list but isn't
        const isInConversationList = conversationUsers.some(
          convUser => convUser.uid === u.uid,
        );
        if (count > 0 && !isInConversationList) {
          // Refresh the conversation list since a new message arrived
          checkConversationUsers(users);
        }
      });

      unsubs.push(unsubscribe);
    });

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [conversationUsers, user, users]);

  // Set up listeners for last messages
  // ── PATCHED: also captures timestamp so we can compare with call records ──
  useEffect(() => {
    if (!user) return;

    // Use all users (not just conversationUsers) to detect when a deleted conversation gets new messages
    const usersToCheck =
      conversationUsers.length > 0 ? conversationUsers : users;

    const unsubs: any[] = [];

    usersToCheck.forEach((u: User) => {
      const chatId = chatService.getChatId(user.uid, u.uid);
      const messagesRef = collection(firestore(), `chats/${chatId}/messages`);

      const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(1));

      const unsubscribe = onSnapshot(q, snapshot => {
        if (!snapshot.empty) {
          const lastMessageDoc = snapshot.docs[0];
          const messageData = lastMessageDoc.data();

          setLastMessages(prev => ({
            ...prev,
            [u.uid]: messageData.text || '',
          }));

          // ── NEW: capture the timestamp for ranking against calls
          setLastMessageTimestamps(prev => ({
            ...prev,
            [u.uid]: toMs(messageData.timestamp),
          }));

          // Check if this user should be in conversation list but isn't
          const isInConversationList = conversationUsers.some(
            convUser => convUser.uid === u.uid,
          );
          if (!isInConversationList) {
            // Refresh the conversation list since a new message arrived
            checkConversationUsers(users);
          }
        } else {
          setLastMessages(prev => ({
            ...prev,
            [u.uid]: '',
          }));
          setLastMessageTimestamps(prev => ({
            ...prev,
            [u.uid]: 0,
          }));
        }
      });

      unsubs.push(unsubscribe);
    });

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [conversationUsers, user, users]);

  // ── NEW: Real-time listener for call history → populate lastCalls map ──────
  //
  //  We listen to the current user's own call history records (queried by
  //  ownerId). For each record we build a map: otherUserId → latestCallRecord.
  //  "Other user" is always the person on the opposite side of the call.
  //  Only the most-recent call per conversation partner is kept.
  //
  //  This runs independently of the chat listeners so calls appear even if
  //  there are no chat messages between the two users (pure-call conversations).
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const unsubscribe = callHistoryService.listenToCallHistory(
      user.uid,
      (calls: CallHistoryItem[]) => {
        // Build map: otherUserId → most recent call record
        // listenToCallHistory already returns records sorted newest-first,
        // so the first record for each partner wins.
        const callMap: { [otherId: string]: CallHistoryItem } = {};

        calls.forEach(call => {
          const otherId =
            call.callerId === user.uid ? call.calleeId : call.callerId;
          // Only store if not already set (first = most recent due to sort)
          if (!callMap[otherId]) {
            callMap[otherId] = call;
          }
        });

        setLastCalls(callMap);
      },
    );

    return unsubscribe;
  }, [user]);

  // Delete conversation function - unilateral deletion for current user
  // This removes all conversation data for the current user but keeps it for the other user
  // When starting a new conversation later, it will be fresh and empty
  const deleteConversation = async (targetUser: User) => {
    if (!user) return;

    Alert.alert(
      'Delete Conversation',
      `Are you sure you want to delete your conversation with ${targetUser.name}? This will remove all messages locally.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const chatId = chatService.getChatId(user.uid, targetUser.uid);

              // Delete all messages in the conversation for current user
              const messagesRef = collection(
                firestore(),
                `chats/${chatId}/messages`,
              );
              const messagesSnapshot = await getDocs(messagesRef);
              
              // Check if snapshot is null (Firebase error)
              if (!messagesSnapshot) {
                console.log('❌ Firestore query returned null for message deletion');
                return;
              }

              // Delete each message document in a batch operation
              const batch = firestore().batch();
              messagesSnapshot.forEach((doc: any) => {
                batch.delete(doc.ref);
              });

              // Update the chat document to track that current user has deleted this conversation
              // This allows for a fresh start when creating a new conversation
              const chatDocRef = doc(firestore(), 'chats', chatId);
              await chatDocRef.update({
                deleted_for_users: (firestore() as any).FieldValue.arrayUnion(user.uid),
              });

              await batch.commit();

              // Update local state to remove the user from conversation list
              setConversationUsers(prev =>
                prev.filter(u => u.uid !== targetUser.uid),
              );

              // Clear related state
              setUnreadCounts(prev => {
                const newCounts = { ...prev };
                delete newCounts[targetUser.uid];
                return newCounts;
              });

              setLastMessages(prev => {
                const newMessages = { ...prev };
                delete newMessages[targetUser.uid];
                return newMessages;
              });

              setLastMessageTimestamps(prev => {
                const next = { ...prev };
                delete next[targetUser.uid];
                return next;
              });

              // Also clear cached call preview for this user
              setLastCalls(prev => {
                const next = { ...prev };
                delete next[targetUser.uid];
                return next;
              });

              console.log(
                `Conversation with ${targetUser.name} deleted for current user`,
              );
            } catch (error) {
              console.error('Error deleting conversation:', error);
              Alert.alert(
                'Error',
                'Failed to delete conversation. Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  const getUnreadCount = (userId: string) => {
    return unreadCounts[userId] || 0;
  };

  // ── PATCHED: getLastMessage ───────────────────────────────────────────────
  //
  //  Now compares the timestamp of the most recent chat message against the
  //  most recent call for that conversation partner, and returns whichever is
  //  more recent.
  //
  //  Behaviour mirrors WhatsApp:
  //    • Text/image message more recent → show message preview
  //    • Call more recent               → show call preview (e.g. "📞 Missed call")
  //    • No message or call yet         → show "Tap to start chatting"
  //
  const getLastMessage = (userId: string): { text: string; isMissed: boolean } => {
    const chatText      = lastMessages[userId] || '';
    const chatTimestamp = lastMessageTimestamps[userId] || 0;
    const callRecord    = lastCalls[userId];
    const callTimestamp = callRecord ? toMs(callRecord.timestamp) : 0;

    // Call is more recent than the last chat message
    if (callRecord && callTimestamp >= chatTimestamp) {
      return {
        text: formatCallPreview(callRecord, user?.uid ?? ''),
        isMissed: isMissedCall(callRecord, user?.uid ?? ''),
      };
    }

    // Chat message is more recent (or no calls exist)
    if (chatText) {
      return { text: chatText, isMissed: false };
    }

    // Legacy fallback: Firestore user doc field
    const userObj = conversationUsers.find(u => u.uid === userId);
    const legacy  = userObj?.last_message;
    if (legacy) return { text: legacy, isMissed: false };

    return { text: 'Tap to start chatting', isMissed: false };
  };

  const renderRightActions = (item: User) => (
    <View style={styles.swipeActions}>
      <TouchableOpacity style={styles.muteButton}>
        <Feather name="bell" size={22} color="#FFF" />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => deleteConversation(item)}
      >
        <Feather name="trash-2" size={22} color="#FFF" />
      </TouchableOpacity>
    </View>
  );

  // Sort users to show those with unread messages at the top
  const getSortedUsers = () => {
    const baseUsers = isSearching ? users : conversationUsers;

    return [...baseUsers].sort((a, b) => {
      const aUnread = getUnreadCount(a.uid);
      const bUnread = getUnreadCount(b.uid);

      // Users with unread messages come first
      if (aUnread > 0 && bUnread === 0) return -1;
      if (bUnread > 0 && aUnread === 0) return 1;

      // Both have unread messages - sort by count (higher first)
      if (aUnread > 0 && bUnread > 0) {
        return bUnread - aUnread;
      }

      // No unread messages - sort alphabetically
      return a.name.localeCompare(b.name);
    });
  };

  const displayUsers = getSortedUsers();
  const filteredUsers = displayUsers.filter(
    u =>
      u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleMessagePress = (item: User) => {
    navigation.navigate('userMsg', {
      userData: item,
    });
  };

  const [myStories, setMyStories] = useState<any[]>([]);

  // Load your own stories with real-time updates
  useEffect(() => {
    if (!user) return;

    // Set up real-time listener for user's own stories
    const storiesRef = firestore()
      .collection('stories')
      .where('userId', '==', user.uid);

    const unsubscribe = onSnapshot(storiesRef, async snapshot => {
      const stories: any[] = [];
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;

      snapshot.forEach((doc: any) => {
        const story = {
          id: doc.id,
          ...doc.data(),
        };

        // Check if story is expired (older than 24 hours)
        const storyTimestamp = story.timestamp;
        if (storyTimestamp) {
          const storyTime = storyTimestamp.toDate().getTime();

          if (now - storyTime <= twentyFourHours) {
            stories.push(story);
          }
        }
      });

      // Sort stories by timestamp (newest first)
      stories.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
      setMyStories(stories);
    });

    // Cleanup function
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [user]);

  // ── Story picker bottom sheet ──────────────────────────────────────────────
  const openStorySheet = () => {
    setStorySheetVisible(true);
    Animated.parallel([
      Animated.spring(sheetTranslateY, {
        toValue: 0,
        damping: 20,
        stiffness: 260,
        mass: 0.9,
        useNativeDriver: true,
      }),
      Animated.timing(sheetBackdropOpacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeStorySheet = (callback?: () => void) => {
    Animated.parallel([
      Animated.timing(sheetTranslateY, {
        toValue: 280,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(sheetBackdropOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setStorySheetVisible(false);
      if (callback) callback();
    });
  };

  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'App needs camera permission to take photos',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch {
        return false;
      }
    }
    return true;
  };

  const compressStoryImage = async (uri: string): Promise<string> => {
    try {
      const result = await ImageResizer.createResizedImage(
        uri, 1000, 1000, 'JPEG', 85, 0, undefined, true,
      );
      return result.uri;
    } catch {
      return uri;
    }
  };

  const uploadStory = async (mediaUri: string, type: 'image' | 'video') => {
    if (!userProfile) return;
    setIsUploadingStory(true);
    try {
      const compressed = type === 'image' ? await compressStoryImage(mediaUri) : mediaUri;
      await storiesService?.createStory(
        userProfile.uid,
        userProfile.name || 'User',
        userProfile.profile_image || '',
        compressed,
        type,
        '',
      );
      Alert.alert('Success', 'Story uploaded successfully!');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to upload story');
    } finally {
      setIsUploadingStory(false);
    }
  };

  const handlePickFromGallery = () => {
    closeStorySheet(() => {
      launchImageLibrary(
        { mediaType: 'photo', quality: 0.8, selectionLimit: 1 },
        (response) => {
          if (response.assets && response.assets[0]?.uri) {
            uploadStory(response.assets[0].uri, 'image');
          }
        },
      );
    });
  };

  const handleTakePhoto = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Camera permission is required');
      return;
    }
    closeStorySheet(() => {
      launchCamera(
        { mediaType: 'photo', quality: 0.8, saveToPhotos: true, cameraType: 'back' },
        (response) => {
          if (response.assets && response.assets[0]?.uri) {
            uploadStory(response.assets[0].uri, 'image');
          }
        },
      );
    });
  };

  const handleAddStory = () => {
    openStorySheet();
  };

  const openStoryViewer = (stories: StoryUser[], initialIdx: number) => {
    setViewerStoryUsers(stories);
    setViewerInitialIndex(initialIdx);
    storyViewerSlide.setValue(Dimensions.get('window').height);
    setStoryViewerVisible(true);
    Animated.spring(storyViewerSlide, {
      toValue: 0,
      damping: 24,
      stiffness: 300,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  };

  const closeStoryViewer = () => {
    Animated.timing(storyViewerSlide, {
      toValue: Dimensions.get('window').height,
      duration: 280,
      useNativeDriver: true,
    }).start(() => setStoryViewerVisible(false));
  };

  const handleStoryPress = (stories: StoryUser[], index: number) => {
    openStoryViewer(stories, index);
  };

  const handleViewMyStories = () => {
    if (myStories.length === 0) return;
    const myStoryUser: StoryUser = {
      userId: user!.uid,
      userName: userProfile?.name || 'You',
      userAvatar: userProfile?.profile_image || '',
      stories: myStories,
      hasUnviewed: false,
    };
    const otherUsersStories = storyUsers.filter(s => s.userId !== user!.uid);
    openStoryViewer([myStoryUser, ...otherUsersStories], 0);
  };
  const refreshConversationList = async () => {
    if (user && users.length > 0) {
      await checkConversationUsers(users);
    }
  };

  // Function to handle pull-to-refresh
  const onRefresh = async () => {
    setRefreshing(true);

    try {
      // Refetch users and conversations
      const usersRef = collection(firestore(), 'users');
      const q = query(usersRef, where('uid', '!=', user?.uid));

      const snapshot = await getDocs(q);
      
      // Check if snapshot is null (Firebase error)
      if (!snapshot) {
        console.log('❌ Firestore query returned null during refresh');
        setUsers([]);
        return;
      }
      
      const userList: User[] = [];
      snapshot.forEach((doc: any) => {
        userList.push({
          uid: doc.data().uid,
          name: doc.data().name || '',
          email: doc.data().email || '',
          profile_image:
            doc.data().profile_image ||
            getUserAvatar({
              displayName: doc.data().name,
              photoURL: doc.data().profile_image,
            }),
          online: !!doc.data().online,
          last_message:
            typeof doc.data().last_message === 'string'
              ? doc.data().last_message
              : '',
          last_message_time: doc.data().last_message_time || null,
          unread_count: doc.data().unread_count || 0,
        });
      });

      setUsers(userList);
      await checkConversationUsers(userList);
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Listen to stories
  useEffect(() => {
    if (!userProfile) return; // Changed from !user

    console.log('=== STORIES SETUP DEBUG ===');
    console.log('Current user ID:', userProfile.uid);
    console.log('Current user name:', userProfile.name);
    console.log('==========================');

    console.log('Setting up stories listener for user:', userProfile.uid); // Changed from user.uid
    const unsubscribe = storiesService?.listenToStories(
      userProfile.uid,
      (stories: StoryUser[]) => {
        console.log('=== STORIES CALLBACK DEBUG ===');
        console.log('Received stories array:', stories);
        console.log('Stories count:', stories.length);
        stories.forEach((storyUser, index) => {
          console.log(`Story ${index}:`, {
            userId: storyUser.userId,
            userName: storyUser.userName,
            storiesCount: storyUser.stories.length,
            hasUnviewed: storyUser.hasUnviewed,
          });
        });
        console.log('=============================');
        setStoryUsers(stories);
      },
    ) || (() => {});

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [userProfile]); // Changed from [user]

  // Update other useEffects to use userProfile
  useEffect(() => {
    if (!userProfile) return; // Changed from !user
    // ... rest of the effect code remains the same but uses userProfile instead of user
  }, [userProfile]);

  // Load your own stories
  useEffect(() => {
    if (!user) return;

    const loadMyStories = async () => {
      const stories = await storiesService?.getMyStories(user.uid) || [];
      setMyStories(stories);
    };

    loadMyStories();
  }, [user]);

  // Load your own stories
  useEffect(() => {
    if (!user) return;

    const loadMyStories = async () => {
      const stories = await storiesService?.getMyStories(user.uid) || [];
      setMyStories(stories);
    };

    loadMyStories();
  }, [user]);

  const ListHeader = () => (
    <>
      <View style={styles.fixedHeader}>
        <Animated.View
          style={[styles.animatedSearchContainer, { width: searchWidth }]}
        >
          <TouchableOpacity style={styles.searchIcon} onPress={toggleSearchBar}>
            <Animated.View style={{ opacity: isSearchActive ? 1 : 1 }}>
              <Feather name="search" size={22} color="#000" />
            </Animated.View>
          </TouchableOpacity>

          <Animated.View style={{ opacity: searchOpacity, flex: 1 }}>
            <View style={styles.searchBarContainer}>
              <TextInput
                placeholder="Search users..."
                placeholderTextColor="#999"
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus={isSearchActive}
                onFocus={() => setIsSearchActive(true)}
              />
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery('');
                  if (isSearchActive) toggleSearchBar();
                }}
              >
                <Feather name="x" size={20} color="#999" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>

        {!isSearchActive && (
          <>
            <Text style={styles.headerTitle}>Home</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
              <FontAwesome name="user-circle" size={34} color="#FFF" />
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.storiesContainer}>
        <FlatList
          data={[
            { id: 'yours', isYourStory: true },
            // Show ALL story users including yourself (but handle duplicates in UI)
            ...storyUsers.map(storyUser => ({
              ...storyUser,
              isYourStory: false,
            })),
          ]}
          horizontal
          keyExtractor={(item: any, index) =>
            item.id || item.userId || `index-${index}`
          }
          showsHorizontalScrollIndicator={false}
          renderItem={({ item, index }) => {
            console.log(`Rendering item ${index}:`, item);

            // "Your Story" section
            if (item.isYourStory) {
              const hasActiveStories = myStories.length > 0; // Use myStories state instead of checking storyUsers

              console.log(
                'Rendering YOUR STORY section, hasActiveStories:',
                hasActiveStories,
              );

              return (
                <View style={styles.yourStoryContainer}>
                  <TouchableOpacity
                    onPress={hasActiveStories ? handleViewMyStories : handleAddStory}
                    activeOpacity={0.8}
                  >
                    <View
                      style={[
                        styles.yourStoryRing,
                        hasActiveStories && styles.activeYourStoryRing,
                      ]}
                    >
                      <View style={styles.yourStoryAvatar}>
                        {hasActiveStories ? (
                          <Image
                            source={{ uri: userProfile?.profile_image }}
                            style={styles.storyImage}
                          />
                        ) : (
                          <Feather name="plus" size={20} color="#FFF" />
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.storyName} numberOfLines={1}>
                    {hasActiveStories ? 'Your Story' : 'Add Story'}
                  </Text>
                </View>
              );
            }

            // Other users' stories (including yourself if you have stories)
            const storyUser = item as StoryUser;

            // Skip rendering your own stories in the main list to avoid duplicates
            if (storyUser.userId === userProfile?.uid) {
              return null; // Don't render your own stories here
            }

            console.log('Rendering OTHER USER story:', storyUser.userName);

            return (
              <TouchableOpacity
                style={styles.storyItem}
                onPress={() => {
                  console.log('Clicked on story user:', storyUser);
                  console.log('Stories count:', storyUser.stories?.length || 0);
                  console.log('Stories data:', storyUser.stories);

                  // Validate that we have stories before navigating
                  if (!storyUser.stories || storyUser.stories.length === 0) {
                    console.log(
                      'No stories found for this user, skipping navigation',
                    );
                    Alert.alert(
                      'No Stories',
                      `${storyUser.userName} doesn't have any stories right now.`,
                    );
                    return;
                  }

                  handleStoryPress([storyUser], 0);
                }}
              >
                <View
                  style={[
                    styles.storyRing,
                    storyUser.hasUnviewed && styles.unviewedStoryRing,
                  ]}
                >
                  <Image
                    source={{
                      uri:
                        storyUser.userAvatar ||
                        'https://ui-avatars.com/api/?userName=' +
                          encodeURIComponent(storyUser.userName),
                    }}
                    style={styles.storyImage}
                    onError={error => console.log('Image load error:', error)}
                  />
                </View>
                <Text style={styles.storyName} numberOfLines={1}>
                  {storyUser.userName}
                </Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={() => (
            <View
              style={{
                padding: 20,
                backgroundColor: '#333',
                margin: 10,
                borderRadius: 10,
                minWidth: 200,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#FFF', textAlign: 'center' }}>
                No friend stories yet
              </Text>
            </View>
          )}
          extraData={storyUsers}
        />
      </View>

      <View style={styles.whiteCardTop} />
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000', }} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      <Animated.FlatList
        data={filteredUsers}
        keyExtractor={(item, index) => item.uid || index.toString()}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.listContent}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        onRefresh={onRefresh}
        refreshing={refreshing}
        renderItem={({ item }) => {
          // ── PATCHED: destructure the new getLastMessage return value ──────
          const { text: lastMsgText, isMissed: lastMsgIsMissed } = getLastMessage(item.uid);

          // Determine the display text (image/audio preview takes priority)
          const displayText = lastMsgText.startsWith('image:')
            ? '📷 Image'
            : lastMsgText.includes('base64')
            ? '📷 Image'
            : lastMsgText;

          return (
            <Swipeable renderRightActions={() => renderRightActions(item)}>
              <TouchableOpacity
                style={styles.messageItem}
                onPress={() => handleMessagePress(item)}
              >
                <View style={styles.avatarContainer}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{item.name?.charAt(0)}</Text>
                  </View>
                  {item.online && <View style={styles.greenDot} />}
                </View>

                <View style={styles.messageContent}>
                  <Text style={styles.contactName}>{item.name}</Text>
                  {/* ── PATCHED: missed calls shown in red ── */}
                  <Text
                    style={[
                      styles.lastMessage,
                      lastMsgIsMissed && styles.lastMessageMissed,
                    ]}
                    numberOfLines={1}
                  >
                    {displayText}
                  </Text>
                </View>

                {getUnreadCount(item.uid) > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadCount}>
                      {getUnreadCount(item.uid) > 9
                        ? '9+'
                        : getUnreadCount(item.uid)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </Swipeable>
          );
        }}
        ListEmptyComponent={() => (
          <View style={styles.emptyListContainer}>
            <View style={styles.emptyUserIcon}>
              <Feather
                name={isSearching ? 'user' : 'message-square'}
                size={60}
                color="#9E9E9E"
              />
            </View>
            <Text style={styles.emptyTitle}>
              {isSearching ? 'User Not Available' : 'No Conversations Yet'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {isSearching ? 'Find User By Search' : 'Find User By Search'}
            </Text>
          </View>
        )}
      />

      {/* ── Story Picker Bottom Sheet ── */}
      <Modal
        visible={storySheetVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => closeStorySheet()}
      >
        {/* Blurred backdrop — tapping dismisses */}
        <TouchableWithoutFeedback onPress={() => closeStorySheet()}>
          <Animated.View style={[storySheetStyles.backdrop, { opacity: sheetBackdropOpacity }]} />
        </TouchableWithoutFeedback>

        {/* Sheet */}
        <Animated.View style={[storySheetStyles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
          {/* Drag handle */}
          <View style={storySheetStyles.handle} />

          {/* Title */}
          <Text style={storySheetStyles.title}>Add to Story</Text>
          <View style={storySheetStyles.divider} />

          {/* Options row */}
          <View style={storySheetStyles.optionsRow}>
            {/* Camera */}
            <TouchableOpacity
              style={storySheetStyles.optionBtn}
              onPress={handleTakePhoto}
              activeOpacity={0.75}
              disabled={isUploadingStory}
            >
              <View style={[storySheetStyles.iconCircle, { backgroundColor: '#E1306C' }]}>
                <Feather name="camera" size={26} color="#FFF" />
              </View>
              <Text style={storySheetStyles.optionLabel}>Camera</Text>
            </TouchableOpacity>

            <View style={storySheetStyles.optionDivider} />

            {/* Gallery */}
            <TouchableOpacity
              style={storySheetStyles.optionBtn}
              onPress={handlePickFromGallery}
              activeOpacity={0.75}
              disabled={isUploadingStory}
            >
              <View style={[storySheetStyles.iconCircle, { backgroundColor: '#405DE6' }]}>
                <Feather name="image" size={26} color="#FFF" />
              </View>
              <Text style={storySheetStyles.optionLabel}>Gallery</Text>
            </TouchableOpacity>
          </View>

          {isUploadingStory && (
            <Text style={storySheetStyles.uploadingText}>Uploading story...</Text>
          )}

          {/* Cancel */}
          <TouchableOpacity
            style={storySheetStyles.cancelBtn}
            onPress={() => closeStorySheet()}
            activeOpacity={0.7}
          >
            <Text style={storySheetStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>

          <View style={{ height: Platform.OS === 'ios' ? 28 : 12 }} />
        </Animated.View>
      </Modal>

      {/* ── Full-screen Story Viewer Modal ── */}
      <Modal
        visible={storyViewerVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeStoryViewer}
      >
        <Animated.View
          style={[
            storyViewerStyles.container,
            { transform: [{ translateY: storyViewerSlide }] },
          ]}
        >
          <StoryViewerContent
            storyUsers={viewerStoryUsers}
            initialIndex={viewerInitialIndex}
            onClose={closeStoryViewer}
            currentUserId={user?.uid || ''}
            currentUserProfile={userProfile}
            onAddStory={openStorySheet}
          />
        </Animated.View>
      </Modal>

    </SafeAreaView>
  );
};

export default Messages;

// ─────────────────────────────────────────────────────────────────────────────
// StoryViewerContent — self-contained inline story viewer
// ─────────────────────────────────────────────────────────────────────────────
interface StoryViewerContentProps {
  storyUsers: StoryUser[];
  initialIndex: number;
  onClose: () => void;
  currentUserId: string;
  currentUserProfile: any;
  onAddStory: () => void;
}

const StoryViewerContent = ({
  storyUsers,
  initialIndex,
  onClose,
  currentUserId,
  currentUserProfile,
  onAddStory,
}: StoryViewerContentProps) => {
  const { width: W, height: H } = Dimensions.get('window');

  const validUsers = storyUsers.filter(
    u => u && Array.isArray(u.stories) && u.stories.length > 0,
  );

  const [currentIndex, setCurrentIndex] = useState(
    Math.min(initialIndex, validUsers.length - 1),
  );
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [localUsers, setLocalUsers] = useState<StoryUser[]>(validUsers);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Add-story sheet inside viewer
  const [viewerSheetVisible, setViewerSheetVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const viewerSheetY = useRef(new Animated.Value(280)).current;
  const viewerSheetBg = useRef(new Animated.Value(0)).current;

  const currentUser = localUsers[currentIndex];
  const currentStory = currentUser?.stories?.[currentStoryIndex];
  const isMyStory = currentUser?.userId === currentUserId;

  const clearTimer = () => {
    if (progressInterval.current) clearInterval(progressInterval.current);
  };

  const startProgress = () => {
    clearTimer();
    setProgress(0);
    progressInterval.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          goNext();
          return 0;
        }
        return prev + 2;
      });
    }, 100);
  };

  const goNext = () => {
    const user = localUsers[currentIndex];
    if (!user) { onClose(); return; }
    if (currentStoryIndex < user.stories.length - 1) {
      setCurrentStoryIndex(p => p + 1);
    } else if (currentIndex < localUsers.length - 1) {
      setCurrentIndex(p => p + 1);
      setCurrentStoryIndex(0);
    } else {
      onClose();
    }
  };

  const goPrev = () => {
    if (currentStoryIndex > 0) {
      setCurrentStoryIndex(p => p - 1);
    } else if (currentIndex > 0) {
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);
      setCurrentStoryIndex(localUsers[prevIdx].stories.length - 1);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    if (currentStory && storiesService) {
      startProgress();
      storiesService.markStoryAsViewed(currentStory.id, currentUserId);
    }
    return clearTimer;
  }, [currentStory, currentIndex, currentStoryIndex]);

  const handleDelete = async () => {
    if (!currentStory || !storiesService) return;
    Alert.alert('Delete Story', 'Delete this story?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          clearTimer();
          try {
            await storiesService!.deleteStory(currentStory.id);
            const updated = [...localUsers];
            const filtered = updated[currentIndex].stories.filter(s => s.id !== currentStory.id);
            if (filtered.length > 0) {
              updated[currentIndex] = { ...updated[currentIndex], stories: filtered };
              setLocalUsers(updated);
              setCurrentStoryIndex(p => Math.max(0, p));
            } else {
              const newUsers = updated.filter((_, i) => i !== currentIndex);
              if (newUsers.length > 0) {
                setLocalUsers(newUsers);
                setCurrentIndex(Math.min(currentIndex, newUsers.length - 1));
                setCurrentStoryIndex(0);
              } else { onClose(); return; }
            }
          } catch { Alert.alert('Error', 'Failed to delete story'); }
          setTimeout(startProgress, 100);
        },
      },
    ]);
  };

  // Viewer-internal add story sheet
  const openViewerSheet = () => {
    clearTimer();
    setViewerSheetVisible(true);
    Animated.parallel([
      Animated.spring(viewerSheetY, { toValue: 0, damping: 20, stiffness: 260, mass: 0.9, useNativeDriver: true }),
      Animated.timing(viewerSheetBg, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  };

  const closeViewerSheet = (cb?: () => void) => {
    Animated.parallel([
      Animated.timing(viewerSheetY, { toValue: 280, duration: 250, useNativeDriver: true }),
      Animated.timing(viewerSheetBg, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setViewerSheetVisible(false);
      if (cb) cb(); else startProgress();
    });
  };

  const requestCam = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  };

  const doUpload = async (uri: string) => {
    if (!currentUserProfile) return;
    setIsUploading(true);
    try {
      let finalUri = uri;
      try {
        const r = await ImageResizer.createResizedImage(uri, 1000, 1000, 'JPEG', 85, 0, undefined, true);
        finalUri = r.uri;
      } catch {}
      await storiesService?.createStory(
        currentUserProfile.uid, currentUserProfile.name || 'User',
        currentUserProfile.profile_image || '', finalUri, 'image', '',
      );
      Alert.alert('Success', 'Story uploaded!');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Upload failed');
    } finally {
      setIsUploading(false);
      startProgress();
    }
  };

  const pickGallery = () => closeViewerSheet(() =>
    launchImageLibrary({ mediaType: 'photo', quality: 0.8, selectionLimit: 1 }, r => {
      if (r.assets?.[0]?.uri) doUpload(r.assets[0].uri!); else startProgress();
    }),
  );

  const takePhoto = async () => {
    const ok = await requestCam();
    if (!ok) { Alert.alert('Permission Denied', 'Camera permission required'); return; }
    closeViewerSheet(() =>
      launchCamera({ mediaType: 'photo', quality: 0.8, saveToPhotos: true, cameraType: 'back' }, r => {
        if (r.assets?.[0]?.uri) doUpload(r.assets[0].uri!); else startProgress();
      }),
    );
  };

  if (!localUsers.length || !currentUser || !currentStory) {
    return (
      <View style={storyViewerStyles.container}>
        <StatusBar hidden />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#FFF', fontSize: 18 }}>No stories available</Text>
          <TouchableOpacity onPress={onClose} style={{ marginTop: 20, padding: 12, backgroundColor: '#4CAF50', borderRadius: 8 }}>
            <Text style={{ color: '#FFF' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={storyViewerStyles.container}>
      <StatusBar hidden />

      {/* Progress bars */}
      <View style={storyViewerStyles.progressContainer}>
        {currentUser.stories.map((_, i) => (
          <View key={i} style={storyViewerStyles.progressBar}>
            <View
              style={[
                storyViewerStyles.progressFill,
                {
                  width: i < currentStoryIndex ? '100%'
                    : i === currentStoryIndex ? `${progress}%`
                    : '0%',
                },
              ]}
            />
          </View>
        ))}
      </View>

      {/* Header */}
      <View style={storyViewerStyles.header}>
        <View style={storyViewerStyles.userInfo}>
          <Image source={{ uri: currentUser.userAvatar }} style={storyViewerStyles.avatar} />
          <Text style={storyViewerStyles.userName}>{currentUser.userName}</Text>
        </View>
        <View style={storyViewerStyles.headerActions}>
          {isMyStory && (
            <TouchableOpacity onPress={handleDelete} style={{ padding: 5 }}>
              <Feather name="trash-2" size={20} color="#FFF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose}>
            <Feather name="x" size={26} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Story image */}
      <View style={{ flex: 1 }}>
        {currentStory.mediaData ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${currentStory.mediaData}` }}
            style={{ width: W, flex: 1 }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: '#FFF' }}>Loading...</Text>
          </View>
        )}

        {/* Tap zones */}
        <TouchableOpacity
          style={[storyViewerStyles.tapZone, { left: 0 }]}
          onPress={goPrev}
          onPressIn={clearTimer}
          onPressOut={startProgress}
          activeOpacity={1}
        />
        <TouchableOpacity
          style={[storyViewerStyles.tapZone, { right: 0 }]}
          onPress={goNext}
          onPressIn={clearTimer}
          onPressOut={startProgress}
          activeOpacity={1}
        />
      </View>

      {/* Caption */}
      {currentStory.caption ? (
        <View style={storyViewerStyles.captionBox}>
          <Text style={storyViewerStyles.captionText}>{currentStory.caption}</Text>
        </View>
      ) : null}

      {/* Views */}
      {isMyStory && (
        <View style={storyViewerStyles.viewsRow}>
          <Feather name="eye" size={20} color="#FFF" />
          <Text style={storyViewerStyles.viewsText}>{currentStory.viewers?.length ?? 0}</Text>
        </View>
      )}

      {/* Add Story button */}
      {isMyStory && (
        <TouchableOpacity style={storyViewerStyles.addBtn} onPress={openViewerSheet}>
          <Feather name="plus" size={20} color="#FFF" />
          <Text style={storyViewerStyles.addBtnText}>Add Story</Text>
        </TouchableOpacity>
      )}

      {/* Inner add-story sheet */}
      {viewerSheetVisible && (
        <>
          <TouchableWithoutFeedback onPress={() => closeViewerSheet()}>
            <Animated.View style={[storySheetStyles.backdrop, { opacity: viewerSheetBg }]} />
          </TouchableWithoutFeedback>
          <Animated.View style={[storySheetStyles.sheet, { transform: [{ translateY: viewerSheetY }] }]}>
            <View style={storySheetStyles.handle} />
            <Text style={storySheetStyles.title}>Add to Story</Text>
            <View style={storySheetStyles.divider} />
            <View style={storySheetStyles.optionsRow}>
              <TouchableOpacity style={storySheetStyles.optionBtn} onPress={takePhoto} activeOpacity={0.75} disabled={isUploading}>
                <View style={[storySheetStyles.iconCircle, { backgroundColor: '#E1306C' }]}>
                  <Feather name="camera" size={26} color="#FFF" />
                </View>
                <Text style={storySheetStyles.optionLabel}>Camera</Text>
              </TouchableOpacity>
              <View style={storySheetStyles.optionDivider} />
              <TouchableOpacity style={storySheetStyles.optionBtn} onPress={pickGallery} activeOpacity={0.75} disabled={isUploading}>
                <View style={[storySheetStyles.iconCircle, { backgroundColor: '#405DE6' }]}>
                  <Feather name="image" size={26} color="#FFF" />
                </View>
                <Text style={storySheetStyles.optionLabel}>Gallery</Text>
              </TouchableOpacity>
            </View>
            {isUploading && <Text style={storySheetStyles.uploadingText}>Uploading...</Text>}
            <TouchableOpacity style={storySheetStyles.cancelBtn} onPress={() => closeViewerSheet()}>
              <Text style={storySheetStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <View style={{ height: Platform.OS === 'ios' ? 28 : 12 }} />
          </Animated.View>
        </>
      )}
    </View>
  );
};

const storyViewerStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  progressContainer: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: Platform.OS === 'ios' ? 54 : 36,
    gap: 4,
  },
  progressBar: {
    flex: 1,
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFF',
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
  userName: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 15,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  tapZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
  },
  captionBox: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  captionText: {
    color: '#FFF',
    fontSize: 15,
  },
  viewsRow: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  viewsText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '500',
  },
  addBtn: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  addBtnText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },
});

const styles = StyleSheet.create({
  animatedSearchContainer: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 20,
    paddingHorizontal: 10,
    overflow: 'hidden',
    marginRight: 10,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    marginRight: 10,
    color: '#000',
    fontSize: 16,
  },
  searchIconInBar: {
    marginLeft: 5,
  },
  fixedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 80,
    backgroundColor: '#000',
  },
  searchIcon: {
    height: 40,
    width: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    left: -10,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '600',
  },
  storiesContainer: {
    height: 120,
    paddingLeft: 10,
    backgroundColor: '#000',
    borderBottomLeftRadius: -50,
    position: 'relative',
  },
  storyItem: {
    alignItems: 'center',
    marginHorizontal: 8,
  },
  storyRing: {
    borderWidth: 3,
    borderColor: '#FFD54F',
    borderRadius: 40,
    padding: 3,
  },
  storyImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  storyName: {
    color: '#FFF',
    fontSize: 12,
    marginTop: 6,
    maxWidth: 60,
  },
  whiteCardTop: {
    height: 30,
    backgroundColor: '#FFF',
    position: 'relative',
  },
  listContent: {
    backgroundColor: '#FFF',
    flex: 1,
  },
  messageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  avatarContainer: {
    marginRight: 15,
    backgroundColor: '#000',
    borderRadius: 25,
  },
  avatar: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 26,
    color: '#FFF',
  },
  greenDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0FE16D',
  },
  messageContent: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  lastMessage: {
    fontSize: 14,
    color: '#666',
  },
  // ── NEW: missed/rejected calls shown in red, matching WhatsApp ────────────
  lastMessageMissed: {
    color: '#FF3B30',
    fontWeight: '500',
  },
  unreadBadge: {
    backgroundColor: '#F04A4C',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadCount: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  swipeActions: {
    flexDirection: 'row',
    backgroundColor: '#EEE',
    width: 100,
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  muteButton: {
    width: 40,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    height: 40,
    borderRadius: 30,
  },
  deleteButton: {
    width: 40,
    backgroundColor: '#F04A4C',
    justifyContent: 'center',
    alignItems: 'center',
    height: 40,
    borderRadius: 30,
  },
  onlineIndicator: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    minWidth: 50,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  onlineText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  emptyListContainer: {
    flex: 1,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyUserIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
  },
  yourStoryContainer: {
    alignItems: 'center',
    marginHorizontal: 8,
    position: 'relative',
  },
  addStoryBadge: {
    position: 'absolute',
    bottom: 30,
    right: 24,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  yourStoryRing: {
    borderWidth: 3,
    borderColor: '#9E9E9E',
    borderRadius: 40,
    padding: 3,
  },
  activeYourStoryRing: {
    borderColor: '#4CAF50',
  },
  yourStoryAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  unviewedStoryRing: {
    borderColor: '#4CAF50',
  },
  addStoryButton: {
    position: 'absolute',
    bottom: 10,
    right: 20,
    backgroundColor: '#4CAF50',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
  },
  addStoryButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 5,
  },
});

// Story picker bottom sheet styles (separate StyleSheet for clarity)
const storySheetStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 30,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#48484A',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 18,
    letterSpacing: -0.2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#38383A',
    marginHorizontal: -20,
    marginBottom: 28,
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    marginBottom: 28,
  },
  optionBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 12,
  },
  optionDivider: {
    width: StyleSheet.hairlineWidth,
    height: 70,
    backgroundColor: '#38383A',
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#EBEBF5',
    letterSpacing: 0.1,
  },
  uploadingText: {
    color: '#8E8E93',
    textAlign: 'center',
    fontSize: 13,
    marginBottom: 12,
  },
  cancelBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#38383A',
    marginHorizontal: -20,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#8E8E93',
  },
});