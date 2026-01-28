// src/firebase/chat.service.ts
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, doc, Timestamp } from '@react-native-firebase/firestore';
import { COLLECTIONS } from './collection';

interface Message {
  id?: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: Timestamp;
  read: boolean;
}

interface Chat {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastMessageTime?: Timestamp;
}

class ChatService {
  private firestore = getFirestore();

  // Create a unique chat ID for two users
  getChatId = (userId1: string, userId2: string): string => {
    const sortedIds = [userId1, userId2].sort();
    return `${sortedIds[0]}_${sortedIds[1]}`;
  };

  // Create a new chat room between two users if it doesn't exist
  async createChatIfNotExists(userId1: string, userId2: string) {
    const chatId = this.getChatId(userId1, userId2);
    const chatRef = doc(this.firestore, `${COLLECTIONS.CHATS}/${chatId}`);
    
    // Check if chat exists, if not create it
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) {
      const chatData = {
        participants: [userId1, userId2].sort(),
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp()
      };
      
      await updateDoc(chatRef, chatData);
    }
    
    return chatId;
  }

  // Send a message
  async sendMessage(senderId: string, receiverId: string, text: string) {
    try {
      // Create chat if it doesn't exist
      const chatId = this.getChatId(senderId, receiverId);
      await this.createChatIfNotExists(senderId, receiverId);

      // Add message to the chat
      const messagesRef = collection(this.firestore, `${COLLECTIONS.CHATS}/${chatId}/messages`);
      const messageData = {
        senderId,
        receiverId,
        text,
        timestamp: serverTimestamp(),
        read: false
      };
      
      await addDoc(messagesRef, messageData);
      
      // Update the last message in the chat
      const chatRef = doc(this.firestore, `${COLLECTIONS.CHATS}/${chatId}`);
      await updateDoc(chatRef, {
        lastMessage: text,
        lastMessageTime: serverTimestamp()
      });
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  // Listen for real-time messages in a chat
  listenToMessages(chatId: string, callback: (messages: Message[]) => void) {
    const q = query(
      collection(this.firestore, `${COLLECTIONS.CHATS}/${chatId}/messages`),
      orderBy('timestamp', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
      const messages: Message[] = [];
      snapshot.forEach((doc) => {
        messages.push({
          id: doc.id,
          ...doc.data()
        } as Message);
      });
      callback(messages);
    });
  }

  // Get all chats for a user
  getUserChats(userId: string, callback: (chats: Chat[]) => void) {
    const q = query(
      collection(this.firestore, COLLECTIONS.CHATS),
      where('participants', 'array-contains', userId)
    );

    return onSnapshot(q, (snapshot) => {
      const chats: Chat[] = [];
      snapshot.forEach((doc) => {
        chats.push({
          id: doc.id,
          ...doc.data()
        } as Chat);
      });
      callback(chats);
    });
  }
}

export const chatService = new ChatService();