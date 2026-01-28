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
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../../navigation/AuthNavigator';

type MessagesNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  'Messages'
>;

const Messages = () => {
  const scrollY = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation<MessagesNavigationProp>();

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

  const handleMessagePress = (item: (typeof contactData)[0]) => {
    navigation.navigate('userMsg', {
      userData: item,
    });
  };

  const ListHeader = () => (
    <>
      {/* Header */}
      <View style={styles.fixedHeader}>
        <TouchableOpacity style={styles.searchIcon}>
          <Feather name="search" size={22} color="#FFF" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Home</Text>

        <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
          <FontAwesome name="user-circle" size={34} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Stories */}
      <View style={styles.storiesContainer}>
        <FlatList
          data={contactData.filter(i => i.unread_count > 0)}
          horizontal
          keyExtractor={item => item._id.toString()}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.storyItem}>
              <View style={styles.storyRing}>
                <Image
                  source={{ uri: item.profile_image }}
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
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <Animated.FlatList
        data={contactData}
        keyExtractor={item => item._id.toString()}
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
                <Image
                  source={{ uri: item.profile_image }}
                  style={styles.avatar}
                />
                {item.unread_count > 0 && <View style={styles.greenDot} />}
              </View>

              <View style={styles.messageContent}>
                <Text style={styles.contactName}>{item.name}</Text>
                <Text style={styles.lastMessage} numberOfLines={1}>
                  {item.last_message}
                </Text>
              </View>

              {item.unread_count > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadCount}>{item.unread_count}</Text>
                </View>
              )}
            </TouchableOpacity>
          </Swipeable>
        )}
      />
    </View>
  );
};

export default Messages;

// ... rest of the styles remain the same

const styles = StyleSheet.create({
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
    borderWidth: 1,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
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
  },

  messageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEE',
  },
  avatarContainer: {
    marginRight: 15,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
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
});



// import {
//   Animated,
//   FlatList,
//   Image,
//   StatusBar,
//   StyleSheet,
//   Text,
//   TouchableOpacity,
//   View,
// } from 'react-native';
// import React, { useRef, useEffect, useState } from 'react';
// import { getFirestore, collection, getDocs, query, where } from '@react-native-firebase/firestore';
// import { COLLECTIONS } from '../../../firebase/collection';
// import Feather from 'react-native-vector-icons/Feather';
// import FontAwesome from 'react-native-vector-icons/FontAwesome';
// import Swipeable from 'react-native-gesture-handler/Swipeable';
// import { useNavigation } from '@react-navigation/native';
// import { NativeStackNavigationProp } from '@react-navigation/native-stack';
// import { AuthStackParamList } from '../../../navigation/AuthNavigator';
// import { useAuth } from '../../../context/AuthContext';

// type MessagesNavigationProp = NativeStackNavigationProp<
//   AuthStackParamList,
//   'userMsg'
// >;

// interface User {
//   uid: string;
//   name: string;
//   email: string;
//   profile_image?: string;
//   online?: boolean;
//   last_message?: string;
//   last_message_time?: any;
// }

// const Messages = () => {
//   const scrollY = useRef(new Animated.Value(0)).current;
//   const navigation = useNavigation<MessagesNavigationProp>();
//   const { user } = useAuth();
//   const [users, setUsers] = useState<User[]>([]);

//   useEffect(() => {
//     const fetchUsers = async () => {
//       if (!user) return;
      
//       try {
//         // Get all users except the current user
//         const usersRef = collection(getFirestore(), COLLECTIONS.USERS);
//         const q = query(usersRef, where('uid', '!=', user.uid));
//         const snapshot = await getDocs(q);
        
//         const userList: User[] = [];
//         snapshot.forEach((doc) => {
//           const userData = doc.data();
//           userList.push({
//             uid: userData.uid,
//             name: userData.name,
//             email: userData.email,
//             profile_image: userData.profile_image || 'https://via.placeholder.com/150',
//             online: userData.online || false,
//           });
//         });
        
//         setUsers(userList);
//       } catch (error) {
//         console.error('Error fetching users:', error);
//       }
//     };

//     fetchUsers();
//   }, [user]);

//   const handleMessagePress = (item: User) => {
//     navigation.navigate('userMsg', {
//       userData: item,
//     });
//   };

//   const renderRightActions = () => (
//     <View style={styles.swipeActions}>
//       <TouchableOpacity style={styles.muteButton}>
//         <Feather name="bell" size={22} color="#FFF" />
//       </TouchableOpacity>
//       <TouchableOpacity style={styles.deleteButton}>
//         <Feather name="trash-2" size={22} color="#FFF" />
//       </TouchableOpacity>
//     </View>
//   );

//   const ListHeader = () => (
//     <>
//       {/* Header */}
//       <View style={styles.fixedHeader}>
//         <TouchableOpacity style={styles.searchIcon}>
//           <Feather name="search" size={22} color="#FFF" />
//         </TouchableOpacity>

//         <Text style={styles.headerTitle}>Home</Text>

//         <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
//           <FontAwesome name="user-circle" size={34} color="#FFF" />
//         </TouchableOpacity>
//       </View>

//       {/* Stories */}
//       <View style={styles.storiesContainer}>
//         <FlatList
//           data={users.slice(0, 5)} // Show first 5 users as stories
//           horizontal
//           keyExtractor={item => item.uid}
//           showsHorizontalScrollIndicator={false}
//           renderItem={({ item }) => (
//             <View style={styles.storyItem}>
//               <View style={styles.storyRing}>
//                 <Image
//                   source={{ uri: item.profile_image || 'https://via.placeholder.com/150' }}
//                   style={styles.storyImage}
//                 />
//               </View>
//               <Text style={styles.storyName} numberOfLines={1}>
//                 {item.name}
//               </Text>
//             </View>
//           )}
//         />
//       </View>

//       <View style={styles.whiteCardTop} />
//     </>
//   );

//   return (
//     <View style={{ flex: 1, backgroundColor: '#000' }}>
//       <StatusBar barStyle="light-content" backgroundColor="#000" />

//       <Animated.FlatList
//         data={users}
//         keyExtractor={item => item.uid}
//         showsVerticalScrollIndicator={false}
//         ListHeaderComponent={ListHeader}
//         contentContainerStyle={styles.listContent}
//         onScroll={Animated.event(
//           [{ nativeEvent: { contentOffset: { y: scrollY } } }],
//           { useNativeDriver: true },
//         )}
//         renderItem={({ item }) => (
//           <Swipeable renderRightActions={renderRightActions}>
//             <TouchableOpacity
//               style={styles.messageItem}
//               onPress={() => handleMessagePress(item)}
//             >
//               <View style={styles.avatarContainer}>
//                 <Image
//                   source={{ uri: item.profile_image || 'https://via.placeholder.com/150' }}
//                   style={styles.avatar}
//                 />
//                 {item.online && <View style={styles.greenDot} />}
//               </View>

//               <View style={styles.messageContent}>
//                 <Text style={styles.contactName}>{item.name}</Text>
//                 <Text style={styles.lastMessage} numberOfLines={1}>
//                   {item.last_message || 'Tap to start chatting'}
//                 </Text>
//               </View>

//               {item.online && (
//                 <View style={styles.onlineIndicator}>
//                   <Text style={styles.onlineText}>ONLINE</Text>
//                 </View>
//               )}
//             </TouchableOpacity>
//           </Swipeable>
//         )}
//       />
//     </View>
//   );
// };

// export default Messages;

// // ... rest of the styles remain the same

// const styles = StyleSheet.create({
//   fixedHeader: {
//     flexDirection: 'row',
//     justifyContent: 'space-between',
//     alignItems: 'center',
//     paddingHorizontal: 20,
//     height: 80,
//     backgroundColor: '#000',
//   },
//   searchIcon: {
//     height: 40,
//     width: 40,
//     borderRadius: 20,
//     borderWidth: 1,
//     borderColor: '#FFF',
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   headerTitle: {
//     color: '#FFF',
//     fontSize: 20,
//     fontWeight: '600',
//   },

//   storiesContainer: {
//     // paddingVertical: 20,
//     height: 120,
//     paddingLeft: 10,
//     backgroundColor: '#000',
//     borderBottomLeftRadius: -50,
//   },
//   storyItem: {
//     alignItems: 'center',
//     marginHorizontal: 8,
//   },
//   storyRing: {
//     borderWidth: 3,
//     borderColor: '#FFD54F',
//     borderRadius: 40,
//     padding: 3,
//   },
//   storyImage: {
//     width: 60,
//     height: 60,
//     borderRadius: 30,
//   },
//   storyName: {
//     color: '#FFF',
//     fontSize: 12,
//     marginTop: 6,
//     maxWidth: 60,
//   },

//   whiteCardTop: {
//     height: 30,
//     backgroundColor: '#FFF',
//     position: 'relative',
//   },

//   listContent: {
//     backgroundColor: '#FFF',
//   },

//   messageItem: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     paddingHorizontal: 20,
//     paddingVertical: 14,
//     borderBottomWidth: 0.5,
//     borderBottomColor: '#EEE',
//   },
//   avatarContainer: {
//     marginRight: 15,
//   },
//   avatar: {
//     width: 50,
//     height: 50,
//     borderRadius: 25,
//   },
//   greenDot: {
//     position: 'absolute',
//     bottom: 2,
//     right: 2,
//     width: 10,
//     height: 10,
//     borderRadius: 5,
//     backgroundColor: '#0FE16D',
//   },
//   messageContent: {
//     flex: 1,
//   },
//   contactName: {
//     fontSize: 16,
//     fontWeight: '600',
//     color: '#000',
//   },
//   lastMessage: {
//     fontSize: 14,
//     color: '#666',
//   },
//   onlineIndicator: {
//     backgroundColor: '#4CAF50',
//     borderRadius: 10,
//     minWidth: 50,
//     height: 20,
//     justifyContent: 'center',
//     alignItems: 'center',
//   },
//   onlineText: {
//     color: '#FFF',
//     fontSize: 10,
//     fontWeight: 'bold',
//   },

//   swipeActions: {
//     flexDirection: 'row',
//     backgroundColor: '#EEE',
//     width: 100,
//     justifyContent: 'space-evenly',
//     alignItems: 'center',
//   },
//   muteButton: {
//     width: 40,
//     backgroundColor: '#000',
//     justifyContent: 'center',
//     alignItems: 'center',
//     height: 40,
//     borderRadius: 30,
//   },
//   deleteButton: {
//     width: 40,
//     backgroundColor: '#F04A4C',
//     justifyContent: 'center',
//     alignItems: 'center',
//     height: 40,
//     borderRadius: 30,
//   },
// });