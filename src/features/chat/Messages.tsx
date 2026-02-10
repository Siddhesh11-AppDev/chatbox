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
  Alert
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
  doc
} from '@react-native-firebase/firestore';
import Feather from 'react-native-vector-icons/Feather';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Swipeable } from 'react-native-gesture-handler';
import { useAuth } from '../../core/context/AuthContext';
import { AppStackParamList } from '../../core/navigation/TabNavigator';
import { chatService } from '../../core/services/chat.service';
import { contactData } from '../../core/services/JsonData';
import { getUserAvatar } from '../../shared/utils/avatarUtils';
import { SafeAreaView } from 'react-native-safe-area-context';

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

const Messages = () => {
  const scrollY = useRef(new Animated.Value(0)).current;
  const searchWidth = useRef(new Animated.Value(40)).current;
  const searchOpacity = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation<MessagesNavigationProp>();
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [conversationUsers, setConversationUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isSearching, setIsSearching] = useState(false); // New state for search mode
  const [unreadCounts, setUnreadCounts] = useState<{ [key: string]: number }>({});
  const [lastMessages, setLastMessages] = useState<{ [key: string]: string }>({});

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
          toValue: 350,
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
      
      if (chatDoc.exists) {
        const chatData = chatDoc.data();
        
        // If chat is not marked as deleted for current user, include in conversation list
        if (!chatData?.deleted_for_users?.includes(user.uid)) {
          // Also check if there are messages in this chat
          const messagesRef = collection(firestore(), `chats/${chatId}/messages`);
          const snapshot = await getDocs(messagesRef);
          
          if (!snapshot.empty) {
            usersWithConversations.push(targetUser);
          }
        }
      }
    } catch (error) {
      console.error(`Error checking conversation for user ${targetUser.uid}:`, error);
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
      profile_image: userData.profile_image || getUserAvatar({
        displayName: userData.name,
        photoURL: userData.profile_image,
      }),
      online: !!userData.online,
      last_message: typeof userData.last_message === 'string' ? userData.last_message : '',
      last_message_time: userData.last_message_time || null,
      unread_count: userData.unread_count || 0,
    });

    const fetchUsers = async () => {
      try {
        const snapshot = await getDocs(q);
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
    const usersToCheck = conversationUsers.length > 0 ? conversationUsers : users;
    
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
        const isInConversationList = conversationUsers.some(convUser => convUser.uid === u.uid);
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
  useEffect(() => {
    if (!user) return;

    // Use all users (not just conversationUsers) to detect when a deleted conversation gets new messages
    const usersToCheck = conversationUsers.length > 0 ? conversationUsers : users;
    
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
          
          // Check if this user should be in conversation list but isn't
          const isInConversationList = conversationUsers.some(convUser => convUser.uid === u.uid);
          if (!isInConversationList) {
            // Refresh the conversation list since a new message arrived
            checkConversationUsers(users);
          }
        } else {
          setLastMessages(prev => ({
            ...prev,
            [u.uid]: '',
          }));
        }
      });

      unsubs.push(unsubscribe);
    });

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [conversationUsers, user, users]);



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
            const messagesRef = collection(firestore(), `chats/${chatId}/messages`);
            const messagesSnapshot = await getDocs(messagesRef);
            
            // Delete each message document in a batch operation
            const batch = firestore().batch();
            messagesSnapshot.forEach((doc) => {
              batch.delete(doc.ref);
            });
            
            // Update the chat document to track that current user has deleted this conversation
            // This allows for a fresh start when creating a new conversation
            const chatDocRef = doc(firestore(), 'chats', chatId);
            await chatDocRef.update({
              deleted_for_users: firestore.FieldValue.arrayUnion(user.uid)
            });
            
            await batch.commit();
            
            // Update local state to remove the user from conversation list
            setConversationUsers(prev => prev.filter(u => u.uid !== targetUser.uid));
            
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
            
            console.log(`Conversation with ${targetUser.name} deleted for current user`);
          } catch (error) {
            console.error('Error deleting conversation:', error);
            Alert.alert('Error', 'Failed to delete conversation. Please try again.');
          }
        },
      },
    ]
  );
};





  const getUnreadCount = (userId: string) => {
    return unreadCounts[userId] || 0;
  };

  const getLastMessage = (userId: string) => {
    const lastMsg = lastMessages[userId];
    if (lastMsg) {
      return lastMsg;
    }
    const userObj = conversationUsers.find(u => u.uid === userId);
    return userObj?.last_message || 'Tap to start chatting';
  };

  const renderRightActions = (item: User) => (
    <View style={styles.swipeActions}>
      <TouchableOpacity style={styles.muteButton}>
        <Feather name="bell" size={22} color="#FFF" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.deleteButton}  onPress={() => deleteConversation(item)}>
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

  // Function to manually refresh conversation list
  const refreshConversationList = async () => {
    if (user && users.length > 0) {
      await checkConversationUsers(users);
    }
  };

  const ListHeader = () => (
    <>
      <View style={styles.fixedHeader}>
        <Animated.View
          style={[styles.animatedSearchContainer, { width: searchWidth }]}
        >
          <TouchableOpacity style={styles.searchIcon} onPress={toggleSearchBar}>
            <Animated.View style={{ opacity: isSearchActive ? 1 : 1 }}>
              <Feather name="search" size={22} color="#000"  />
            </Animated.View>
          </TouchableOpacity>

          <Animated.View style={{ opacity: searchOpacity, flex: 1 }}>
            <View style={styles.searchBarContainer}>
              {/* <Feather
                name="search"
                size={20}
                color="#000"
                style={styles.searchIconInBar}
              /> */}
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
          data={contactData}
          horizontal
          keyExtractor={item => item._id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.storyItem}>
              <View style={styles.storyRing}>
                <Image
                  source={{
                    uri: item.profile_image || getUserAvatar({
                      displayName: item.name,
                      photoURL: item.profile_image,
                    }),
                  }}
                  style={styles.storyImage}
                />
              </View>
              <Text style={styles.storyName} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
          )}
        />
      </View>

      <View style={styles.whiteCardTop} />
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
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
        renderItem={({ item }) => (
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
                <Text style={styles.lastMessage} numberOfLines={1}>
                  {getLastMessage(item.uid)?.startsWith('image:') ? 'IMG' : getLastMessage(item.uid) || 'Tap to start chatting'}
                </Text>
              </View>

              {getUnreadCount(item.uid) > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadCount}>
                    {getUnreadCount(item.uid) > 9 ? '9+' : getUnreadCount(item.uid)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </Swipeable>
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyListContainer}>
            <View style={styles.emptyUserIcon}>
              <Feather 
                name={isSearching ? "user" : "message-square"} 
                size={60} 
                color="#9E9E9E" 
              />
            </View>
            <Text style={styles.emptyTitle}>
              {isSearching ? "User Not Available" : "No Conversations Yet"}
            </Text>
            <Text style={styles.emptySubtitle}>
              {isSearching 
                ? "Find User By Search" 
                : "Find User By Search"
              }
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
};


export default Messages;

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
    // marginLeft: 10,
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
});