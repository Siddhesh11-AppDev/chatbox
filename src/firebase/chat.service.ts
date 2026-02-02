


// src/firebase/chat.service.ts
import firestore from '@react-native-firebase/firestore';
import { COLLECTIONS } from './collection';

interface Message {
  id?: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: FirebaseFirestoreTypes.Timestamp | any;
  read: boolean;
}

interface Chat {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastMessageTime?: FirebaseFirestoreTypes.Timestamp | any;
}

class ChatService {
  private firestore = firestore();

  // Create a unique chat ID for two users
  getChatId = (userId1: string, userId2: string): string => {
    const sortedIds = [userId1, userId2].sort();
    return `${sortedIds[0]}_${sortedIds[1]}`;
  };

  // Create a new chat room between two users if it doesn't exist
  async createChatIfNotExists(userId1: string, userId2: string) {
    const chatId = this.getChatId(userId1, userId2);
    const chatRef = this.firestore.collection(COLLECTIONS.CHATS).doc(chatId);

    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) {
      const chatData = {
        participants: [userId1, userId2].sort(),
        createdAt: firestore.FieldValue.serverTimestamp(),
        lastMessage: '',
        lastMessageTime: firestore.FieldValue.serverTimestamp(),
      };

      await chatRef.set(chatData);
    }

    return chatId;
  }

  // Send a message (Firestore only)
  async sendMessage(senderId: string, receiverId: string, text: string) {
    try {
      const chatId = this.getChatId(senderId, receiverId);
      await this.createChatIfNotExists(senderId, receiverId);

      const messagesRef = this.firestore
        .collection(COLLECTIONS.CHATS)
        .doc(chatId)
        .collection('messages');

      const messageData = {
        senderId,
        receiverId,
        text,
        timestamp: firestore.FieldValue.serverTimestamp(),
        read: false,
      };

      const messageDoc = await messagesRef.add(messageData);

      // Update last message
      await this.firestore
        .collection(COLLECTIONS.CHATS)
        .doc(chatId)
        .set(
          {
            lastMessage: text,
            lastMessageTime: firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

      return messageDoc.id;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  // Listen for real-time messages (Firestore only)
  listenToMessages(chatId: string, callback: (messages: Message[]) => void) {
    return this.firestore
      .collection(COLLECTIONS.CHATS)
      .doc(chatId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .onSnapshot(snapshot => {
        const messages: Message[] = snapshot.docs.map(doc => ({
          id: doc.id,
          ...(doc.data() as Omit<Message, 'id'>),
        }));
        callback(messages);
      });
  }

  // Get all chats for a user
  getUserChats(userId: string, callback: (chats: Chat[]) => void) {
    return this.firestore
      .collection(COLLECTIONS.CHATS)
      .where('participants', 'array-contains', userId)
      .orderBy('lastMessageTime', 'desc')
      .onSnapshot(snapshot => {
        const chats: Chat[] = snapshot.docs.map(doc => ({
          id: doc.id,
          ...(doc.data() as Omit<Chat, 'id'>),
        }));
        callback(chats);
      });
  }
}

export const chatService = new ChatService();
