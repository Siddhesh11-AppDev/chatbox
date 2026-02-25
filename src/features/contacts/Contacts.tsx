import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Image,
  TouchableOpacity,
  Modal,
  RefreshControl,
  TextInput,
  Alert,
  Animated,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../core/navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../core/context/AuthContext';
import { contactService, Contact } from '../../core/services/contact.service';
import { initiateCall } from '../../core/services/call.helper';

type ContactsNavigationProp = NativeStackNavigationProp<
  AppStackParamList,
  'userMsg'
>;

export default function Contacts() {
  const navigation = useNavigation<ContactsNavigationProp>();
  const { user, userProfile } = useAuth();
  const [contacts, setContacts] = useState<
    Array<{ title: string; data: Contact[] }>
  >([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredContacts, setFilteredContacts] = useState<
    Array<{ title: string; data: Contact[] }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [isSearchActive, setIsSearchActive] = useState(false);
  
  // Animated values for search bar
  const searchWidth = useRef(new Animated.Value(40)).current;
  const searchOpacity = useRef(new Animated.Value(0)).current;

  // Fetch contacts on component mount
  useEffect(() => {
    if (!user || !userProfile) return;

    const unsubscribe = contactService.listenToContacts(
      user.uid,
      contactsList => {
        const groupedContacts =
          contactService.groupContactsByAlphabet(contactsList);
        setContacts(groupedContacts);
        setFilteredContacts(groupedContacts);
        setLoading(false);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [user, userProfile]);

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
    }
    setIsSearchActive(!isSearchActive);
  };

  // Handle search filtering
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredContacts(contacts);
      return;
    }

    const performSearch = async () => {
      if (!user) return;

      try {
        const searchResults = await contactService.searchContacts(
          user.uid,
          searchQuery,
        );
        const groupedResults =
          contactService.groupContactsByAlphabet(searchResults);
        setFilteredContacts(groupedResults);
      } catch (error) {
        console.error('Error searching contacts:', error);
      }
    };

    performSearch();
  }, [searchQuery, contacts, user]);

  const handleSendMessage = (contact: Contact) => {
    // Convert contact format to match Messages screen expectation
    const userData = {
      _id: contact.uid,
      uid: contact.uid,
      name: contact.name,
      email: contact.email,
      last_message: contact.status || '',
      time: '',
      unread_count: 0,
      online: contact.online || false,
      profile_image: contact.profile_image,
    };

    navigation.navigate('userMsg', { userData });
    setSelectedContact(null); // Close modal after navigation
  };

  const handleVoiceCall = async (contact: Contact) => {
    if (!user || !userProfile) return;

    try {
      const callId = await initiateCall(
        user.uid,
        contact.uid,
        'audio',
        userProfile.name || 'Unknown',
        userProfile.profile_image,
      );

      navigation.navigate('voiceCall', {
        userData: {
          uid: contact.uid,
          name: contact.name,
          profile_image: contact.profile_image,
        },
        isIncomingCall: false,
        callId: callId,
        callType: 'audio',
      });

      setSelectedContact(null);
    } catch (error) {
      console.error('Error initiating voice call:', error);
      Alert.alert('Error', 'Failed to initiate call. Please try again.');
    }
  };

  const handleVideoCall = async (contact: Contact) => {
    if (!user || !userProfile) return;

    try {
      const callId = await initiateCall(
        user.uid,
        contact.uid,
        'video',
        userProfile.name || 'Unknown',
        userProfile.profile_image,
      );

      navigation.navigate('videoCall', {
        userData: {
          uid: contact.uid,
          name: contact.name,
          profile_image: contact.profile_image,
        },
        isIncomingCall: false,
        callId: callId,
        callType: 'video',
      });

      setSelectedContact(null);
    } catch (error) {
      console.error('Error initiating video call:', error);
      Alert.alert('Error', 'Failed to initiate call. Please try again.');
    }
  };

  const onRefresh = useCallback(async () => {
    if (!user) return;

    setRefreshing(true);
    try {
      const contactsList = await contactService.getAllContacts(user.uid);
      const groupedContacts =
        contactService.groupContactsByAlphabet(contactsList);
      setContacts(groupedContacts);
      setFilteredContacts(groupedContacts);
    } catch (error) {
      console.error('Error refreshing contacts:', error);
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  const renderItem = ({ item }: { item: Contact }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => setSelectedContact(item)}
    >
      <View style={styles.callHistoryAvatar}>
        <Text style={styles.callHistoryAvatarText}>
          {item.name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.status}>
          {item.online ? 'Online' : 'Offline'} • {item.status || 'Available'}
        </Text>
      </View>
      <View style={styles.onlineIndicator}>
        {item.online && <View style={styles.onlineDot} />}
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Feather name="search" size={20} color="#fff" />
          <Text style={styles.headerTitle}>Contacts</Text>
          <Feather name="user-plus" size={20} color="#fff" />
        </View>
        <View style={styles.sheet}>
          <Text style={styles.myContact}>My Contact</Text>
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading contacts...</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
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
                placeholder="Search contacts..."
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
            <Text style={styles.headerTitle}>Contacts</Text>
            <Feather name="user-plus" size={20} color="#fff" />
          </>
        )}
      </View>

      {/* List */}
      <View style={styles.sheet}>
        <Text style={styles.myContact}>My Contact</Text>
        <SectionList
          sections={filteredContacts}
          keyExtractor={item => item.uid}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather name="users" size={48} color="#8E8E93" />
              <Text style={styles.emptyText}>
                {searchQuery ? 'No contacts found' : 'No contacts available'}
              </Text>
              <Text style={styles.emptySubtext}>
                {searchQuery
                  ? 'Try a different search term'
                  : 'Contacts will appear here once you have connections'}
              </Text>
            </View>
          }
        />
      </View>

      {/* Bottom Sheet */}
      <Modal transparent visible={!!selectedContact} animationType="slide">
        <TouchableOpacity
          style={styles.overlay}
          onPress={() => setSelectedContact(null)}
        />
        <View style={styles.bottomSheet}>
          {selectedContact && (
            <>
              <View style={styles.callHistoryAvatarPlaceholder}>
                <Text style={styles.callHistoryAvatarText}>
                  {selectedContact.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.sheetName}>{selectedContact.name}</Text>
              <Text style={styles.sheetPhone}>
                {selectedContact.phone || selectedContact.email}
              </Text>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleVoiceCall(selectedContact)}
                >
                  <Feather name="phone" size={22} color="#34C759" />
                  <Text style={styles.actionText}>Voice Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleVideoCall(selectedContact)}
                >
                  <Feather name="video" size={22} color="#FF9500" />
                  <Text style={styles.actionText}>Video Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleSendMessage(selectedContact)}
                >
                  <Feather name="message-circle" size={22} color="#007AFF" />
                  <Text style={styles.actionText}>Message</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 100,
    backgroundColor: '#000',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
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
  searchIcon: {
    height: 40,
    width: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    left: -10,
  },
  sheet: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
  },
  myContact: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginBottom: 28,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    fontWeight: '600',
    color: '#8E8E93',
    backgroundColor: '#f2f2f7',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  status: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  onlineIndicator: {
    width: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  bottomSheet: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
  },
  sheetName: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
  sheetPhone: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 20,
  },
  actionBtn: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  actionText: {
    fontSize: 12,
    marginTop: 4,
    color: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 50,
  },
  loadingText: {
    fontSize: 16,
    color: '#8E8E93',
    marginTop: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 8,
    textAlign: 'center',
  },
  callHistoryAvatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  callHistoryAvatar: {
     width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callHistoryAvatarText: {
    fontSize: 20,
    color: '#fff',
    fontWeight: '600',
  },
});
