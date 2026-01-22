import {
  Animated,
  FlatList,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import React, { useRef } from 'react';
import { contactData } from '../../../api/JsonData';
import Feather from 'react-native-vector-icons/Feather';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import Swipeable from 'react-native-gesture-handler/Swipeable';

const Messages = () => {
  const scrollY = useRef(new Animated.Value(0)).current;

  /* Swipe right actions (Bell + Delete) */
  const renderRightActions = () => {
    return (
      <View style={styles.swipeActions}>
        <TouchableOpacity style={styles.muteButton}>
          <Feather name="bell-off" size={22} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteButton}>
          <Feather name="trash-2" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Header */}
      <Animated.View style={styles.fixedHeader}>
        <TouchableOpacity style={styles.searchIcon}>
          <Feather name="search" size={24} color="#FFF" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Home</Text>

        <TouchableOpacity>
          <FontAwesome name="user-circle" size={34} color="#FFF" />
        </TouchableOpacity>
      </Animated.View>

      {/* Scrollable Content */}
      <Animated.ScrollView
        style={{ flex: 1, marginTop: 80 }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {/* Stories */}
        {contactData?.length > 0 && (
          <View style={styles.storiesContainer}>
            <FlatList
              data={contactData.filter(item => item.unread_count > 0)}
              keyExtractor={item => item._id.toString()}
              horizontal
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <View style={styles.storyItem}>
                  <TouchableOpacity
                    style={[
                      styles.storyRing,
                      {
                        borderColor:
                          item.unread_count > 0 ? '#FFD54F' : '#555',
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: item.profile_image }}
                      style={styles.storyImage}
                    />
                  </TouchableOpacity>

                  <Text style={styles.storyName} numberOfLines={1}>
                    {item.name.length > 8
                      ? item.name.substring(0, 8) + '...'
                      : item.name}
                  </Text>
                </View>
              )}
            />
          </View>
        )}

        {/* Messages */}
        <View style={styles.messagesContainer}>
          <FlatList
            data={contactData}
            keyExtractor={item => item._id.toString()}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <Swipeable renderRightActions={renderRightActions}>
                <TouchableOpacity style={styles.messageItem}>
                  <View style={styles.avatarContainer}>
                    <Image
                      source={{ uri: item.profile_image }}
                      style={styles.avatar}
                    />
                    {item.unread_count > 0 && (
                      <View style={styles.blueDotAvatar} />
                    )}
                  </View>

                  <View style={styles.messageContent}>
                    <Text style={styles.contactName}>{item.name}</Text>
                    <Text style={styles.lastMessage} numberOfLines={1}>
                      {item.last_message}
                    </Text>
                  </View>

                  {item.unread_count > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadCount}>
                        {item.unread_count > 9 ? '9+' : item.unread_count}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </Swipeable>
            )}
          />
        </View>

        <View style={{ height: 50 }} />
      </Animated.ScrollView>
    </View>
  );
};

export default Messages;

const styles = StyleSheet.create({
  fixedHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    alignItems: 'center',
    height: 80,
    zIndex: 10,
  },
  searchIcon: {
    height: 40,
    width: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFF',
  },
  storiesContainer: {
    height: 100,
    paddingHorizontal: 10,
    backgroundColor: '#000',
    marginTop: 20,
  },
  storyItem: {
    alignItems: 'center',
    marginHorizontal: 8,
  },
  storyRing: {
    width: 77,
    height: 77,
    borderRadius: 38.5,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  storyImage: {
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  storyName: {
    color: '#FFF',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
    maxWidth: 70,
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 20,
    bottom: -50,
  },
  messageItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEE',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 15,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  blueDotAvatar: {
    position: 'absolute',
    top: 38,
    left: 36,
    width: 10,
    height: 10,
    borderRadius: 6,
    backgroundColor: '#0FE16D',
  },
  unreadBadge: {
    backgroundColor: '#F04A4C',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginLeft: 10,
  },
  unreadCount: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  messageContent: {
    flex: 1,
  },
  contactName: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
  lastMessage: {
    color: '#666',
    fontSize: 14,
  },

  /* Swipe buttons */
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  muteButton: {
    backgroundColor: '#EDEDED',
    width: 60,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    backgroundColor: '#F04A4C',
    width: 60,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
