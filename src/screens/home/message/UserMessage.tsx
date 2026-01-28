import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  FlatList,
  TouchableOpacity,
  StatusBar,
  Alert,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../../navigation/AppNavigator';
import AppTextInput from '../../../components/AppTextInput';
import { useAuth } from '../../../context/AuthContext';
import { chatService } from '../../../firebase/chat.service';

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

  useEffect(() => {
    if (!user) return;

    // Generate chat ID and listen to messages
    const chatId = chatService.getChatId(user.uid, userData.uid);
    const unsubscribe = chatService.listenToMessages(chatId, (newMessages) => {
      setMessages(newMessages);
    });

    return () => unsubscribe();
  }, [user, userData]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || !user) return;

    try {
      await chatService.sendMessage(user.uid, userData.uid, inputText);
      setInputText('');
    } catch (error) {
      Alert.alert('Error', 'Failed to send message');
    }
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isCurrentUser = user && item.senderId === user.uid;

    return (
      <View
        style={[
          styles.messageRow,
          isCurrentUser ? styles.rightAlign : styles.leftAlign,
        ]}
      >
        {!isCurrentUser && (
          <Image 
            source={{ uri: userData.profile_image || 'https://via.placeholder.com/150' }} 
            style={styles.avatar} 
          />
        )}

        <View
          style={[
            styles.bubble,
            isCurrentUser ? styles.rightBubble : styles.leftBubble,
          ]}
        >
          <Text style={styles.messageText}>
            {item.text}
          </Text>
          <Text style={styles.timestamp}>
            {item.timestamp?.toDate ? 
              item.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 
              ''}
          </Text>
        </View>

        {isCurrentUser && <View style={{ width: 40 }} />}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={24} color="#000" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Image 
            source={{ uri: userData.profile_image || 'https://via.placeholder.com/150' }} 
            style={styles.headerAvatar} 
          />
          <View>
            <Text style={styles.headerName}>{userData.name}</Text>
            <Text style={styles.headerStatus}>
              {userData.online ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.actionButton}>
            <Feather name="phone" size={20} color="#000" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton}>
            <Feather name="video" size={20} color="#000" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        data={messages}
        keyExtractor={(item, index) => item.id ? item.id : `msg-${index}`}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        inverted // Show newest messages at bottom
      />

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.iconButton}>
          <Feather name="paperclip" size={20} color="#666" />
        </TouchableOpacity>

        <View style={styles.inputContainer}>
          <AppTextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Write your message"
            style={styles.textInput}
          />
        </View>

        <TouchableOpacity style={styles.iconButton}>
          <Feather name="camera" size={20} color="#666" />
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.sendButton} 
          onPress={handleSendMessage}
        >
          <Feather name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default UserMessage;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    height: 70,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEE',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  headerAvatar: {
    width: 45,
    height: 45,
    borderRadius: 22,
    marginRight: 10,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerStatus: {
    fontSize: 12,
    color: '#4CAF50',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 15,
  },
  actionButton: {
    padding: 5,
  },

  /* Messages */
  listContent: {
    padding: 15,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 15,
    alignItems: 'flex-end',
  },
  leftAlign: {
    justifyContent: 'flex-start',
  },
  rightAlign: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 35,
    height: 35,
    borderRadius: 18,
    marginRight: 8,
  },
  bubble: {
    maxWidth: '70%',
    padding: 12,
    borderRadius: 12,
    position: 'relative',
  },
  leftBubble: {
    backgroundColor: '#EEF1F4',
    borderTopLeftRadius: 0,
  },
  rightBubble: {
    backgroundColor: '#1DAA8E',
    borderTopRightRadius: 0,
  },
  messageText: {
    fontSize: 14,
    color: '#fff',
  },
  timestamp: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'right',
    marginTop: 4,
  },

  /* Input */
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#EEE',
    gap: 10,
  },
  iconButton: {
    padding: 5,
  },
  inputContainer: {
    flex: 1,
    height: 40,
    backgroundColor: '#F2F2F2',
    borderRadius: 20,
    justifyContent: 'center',
    paddingHorizontal: 15,
  },
  textInput: {
    height: '100%',
    fontSize: 14,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1DAA8E',
    justifyContent: 'center',
    alignItems: 'center',
  },
});