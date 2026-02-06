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
  last_message?: string; // must always be string
  last_message_time?: any;
  unread_count?: number;
}

const Messages = () => {
  const scrollY = useRef(new Animated.Value(0)).current;
  const searchWidth = useRef(new Animated.Value(40)).current; // Start with small width (icon size)
  const searchOpacity = useRef(new Animated.Value(0)).current; // Start hidden
  const navigation = useNavigation<MessagesNavigationProp>();
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false); // Track search state
  const [unreadCounts, setUnreadCounts] = useState<{ [key: string]: number }>(
    {},
  );
  const [lastMessages, setLastMessages] = useState<{ [key: string]: string }>(
    {},
  );

  // Toggle search bar animation
  const toggleSearchBar = () => {
    if (isSearchActive) {
      // Close search bar
      Animated.parallel([
        Animated.timing(searchWidth, {
          toValue: 40, // Back to icon size
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(searchOpacity, {
          toValue: 0, // Fade out
          duration: 150,
          useNativeDriver: false,
        }),
      ]).start();
    } else {
      // Open search bar
      Animated.parallel([
        Animated.timing(searchWidth, {
          toValue: 350, // Expand to desired width
          duration: 250,
          useNativeDriver: false,
        }),
        Animated.timing(searchOpacity, {
          toValue: 1, // Fade in
          duration: 200,
          delay: 50, // Slight delay to show width expansion first
          useNativeDriver: false,
        }),
      ]).start();
    }
    setIsSearchActive(!isSearchActive);
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

    // Initial fetch
    const fetchUsers = async () => {
      try {
        const snapshot = await getDocs(q);
        const userList: User[] = [];
        snapshot.forEach((doc: any) => {
          userList.push(mapUser(doc.data()));
        });
        setUsers(userList);
      } catch (error) {
        console.error('Error fetching users:', error);
      }
    };

    fetchUsers();

    // Real-time listener
    const unsubscribe = onSnapshot(q, snapshot => {
      const userList: User[] = [];
      snapshot.forEach((doc: any) => {
        userList.push(mapUser(doc.data()));
      });
      setUsers(userList);
    });

    return () => unsubscribe();
  }, [user]);

  // Set up listeners for unread message counts
  useEffect(() => {
    if (!user || !users.length) return;

    const unsubs: any[] = [];

    users.forEach((u: User) => {
      const chatId = chatService.getChatId(user.uid, u.uid);
      const messagesRef = collection(
        firestore(),
        `chats/${chatId}/messages`,
      );

      const q = query(
        messagesRef,
        where('receiverId', '==', user.uid), // Messages sent to current user
        where('read', '==', false), // Only unread messages
      );

      const unsubscribe = onSnapshot(q, snapshot => {
        const count = snapshot?.size || 0; // Safely access the size property
        setUnreadCounts(prev => ({
          ...prev,
          [u.uid]: count,
        }));
      });

      unsubs.push(unsubscribe);
    });

    // Clean up all listeners when component unmounts or users list changes
    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [users, user]);

  // Set up listeners for last messages
  useEffect(() => {
    if (!user || !users.length) return;

    const unsubs: any[] = [];

    users.forEach((u: User) => {
      const chatId = chatService.getChatId(user.uid, u.uid);
      const messagesRef = collection(
        firestore(),
        `chats/${chatId}/messages`,
      );

      const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(1));

      const unsubscribe = onSnapshot(q, snapshot => {
        if (!snapshot.empty) {
          const lastMessageDoc = snapshot.docs[0];
          const messageData = lastMessageDoc.data();
          setLastMessages(prev => ({
            ...prev,
            [u.uid]: messageData.text || '',
          }));
        } else {
          // If no messages in the chat, set empty string
          setLastMessages(prev => ({
            ...prev,
            [u.uid]: '',
          }));
        }
      });

      unsubs.push(unsubscribe);
    });

    // Clean up all listeners when component unmounts or users list changes
    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [users, user]);

  // Function to get unread count for a specific user
  const getUnreadCount = (userId: string) => {
    return unreadCounts[userId] || 0;
  };

  // Function to get last message for a specific user
  const getLastMessage = (userId: string) => {
    const lastMsg = lastMessages[userId];
    if (lastMsg) {
      return lastMsg;
    }
    // Fallback to original last_message if no Firebase message exists
    const userObj = users.find(u => u.uid === userId);
    return userObj?.last_message || 'Tap to start chatting';
  };

  const renderRightActions = () => (
    <View style={styles.swipeActions}>
      <TouchableOpacity style={styles.muteButton}>
        <Feather name="bell" size={22} color="#FFF" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.deleteButton}>
        <Feather name="trash-2" size={22} color="#FFF" />
      </TouchableOpacity>
    </View>
  );

  const filteredUsers = users.filter(
    u =>
      u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleMessagePress = (item: User) => {
    navigation.navigate('userMsg', {
      userData: item,
    });
  };

  const ListHeader = () => (
    <>
      {/* Header */}
      <View style={styles.fixedHeader}>
        <Animated.View
          style={[styles.animatedSearchContainer, { width: searchWidth }]}
        >
          <TouchableOpacity style={styles.searchIcon} onPress={toggleSearchBar}>
            <Animated.View style={{ opacity: isSearchActive ? 0 : 1 }}>
              <Feather name="search" size={22} color="#000" />
            </Animated.View>
          </TouchableOpacity>

          <Animated.View style={{ opacity: searchOpacity, flex: 1 }}>
            <View style={styles.searchBarContainer}>
              <Feather
                name="search"
                size={20}
                color="#000"
                style={styles.searchIconInBar}
              />
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

      {/* Stories - Now showing users with unread messages */}
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
                    uri:
                      item.profile_image ||
                      getUserAvatar({
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
          <Swipeable renderRightActions={renderRightActions}>
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
             {/* 
              {item.online && (
                <View style={styles.onlineIndicator}>
                  <Text style={styles.onlineText}>ONLINE</Text>
                </View>
              )} */}

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
        )}
        ListEmptyComponent={() => (
          // Render empty state when no users are found
          <View style={styles.emptyListContainer}>
            <View style={styles.emptyUserIcon}>
              <Feather name="user" size={60} color="#9E9E9E" />
            </View>
            <Text style={styles.emptyTitle}>User Not Available</Text>
            <Text style={styles.emptySubtitle}>Find User By Search</Text>
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
    marginLeft: 10,
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
    // paddingVertical: 20,
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
    // backgroundColor:'grey'
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
  avatarText:{
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
