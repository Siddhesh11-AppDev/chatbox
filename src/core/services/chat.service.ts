import firestore, { serverTimestamp } from '@react-native-firebase/firestore';
import { COLLECTIONS } from './collection';
import { notificationService } from './notification.service';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';

interface Message {
  id?: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: any;
  read: boolean;
  type?: 'text' | 'image';
  imageData?: string;
}

interface Chat {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastMessageTime?: any;
}

class ChatService {
  private firestore = firestore();

  getChatId = (userId1: string, userId2: string): string => {
    const sortedIds = [userId1, userId2].sort();
    return `${sortedIds[0]}_${sortedIds[1]}`;
  };

  async createChatIfNotExists(userId1: string, userId2: string) {
    const chatId = this.getChatId(userId1, userId2);
    const chatRef = this.firestore.collection(COLLECTIONS.CHATS).doc(chatId);

    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) {
      const chatData = {
        participants: [userId1, userId2].sort(),
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp(),
      };

      await chatRef.set(chatData);
    }

    return chatId;
  }

  async convertImageToBase64(imageUri: string): Promise<string> {
    try {
      let processedUri = imageUri;
      if (imageUri.startsWith('content://')) {
        const tempPath = `${RNFS.CachesDirectoryPath}/temp_image_${Date.now()}.jpg`;
        await RNFS.copyFile(imageUri, tempPath);
        processedUri = tempPath;
      }
      
      const base64Data = await RNFS.readFile(processedUri, 'base64');
      
      if (processedUri.includes('/temp_image_')) {
        try {
          await RNFS.unlink(processedUri);
        } catch (cleanupError) {
          console.warn('Could not clean up temp file:', cleanupError);
        }
      }
      
      return base64Data;
    } catch (error) {
      console.error('Error converting image to base64:', error);
      throw error;
    }
  }

  async sendMessage(senderId: string, receiverId: string, text: string, imageUri?: string) {
    try {
      const chatId = this.getChatId(senderId, receiverId);
      await this.createChatIfNotExists(senderId, receiverId);

      const messagesRef = this.firestore
        .collection(COLLECTIONS.CHATS)
        .doc(chatId)
        .collection('messages');

      let messageData: Partial<Message> = {
        senderId,
        receiverId,
        text,
        timestamp: serverTimestamp(),
        read: false,
      };

      if (imageUri) {
        const base64Data = await this.convertImageToBase64(imageUri);
        
        const base64SizeKB = Math.ceil(base64Data.length / 1024);
        if (base64SizeKB > 900) {
          throw new Error(`Image too large (${base64SizeKB}KB) to send. Maximum size is ~900KB.`);
        }
        
        messageData.type = 'image';
        messageData.imageData = base64Data;
        messageData.text = 'Image';
        
        const messageDoc = await messagesRef.add(messageData);

        await this.firestore
          .collection(COLLECTIONS.CHATS)
          .doc(chatId)
          .set(
            {
              lastMessage: '📷 Image',
              lastMessageTime: serverTimestamp(),
            },
            { merge: true },
          );
      } else {
        messageData.type = 'text';
        
        const messageDoc = await messagesRef.add(messageData);

        await this.firestore
          .collection(COLLECTIONS.CHATS)
          .doc(chatId)
          .set(
            {
              lastMessage: text,
              lastMessageTime: serverTimestamp(),
            },
            { merge: true },
          );
      }

      const finalMessageDoc = await messagesRef.orderBy('timestamp', 'desc').limit(1).get();
      const latestMessage = finalMessageDoc.docs[0];
      
      try {
        const senderDoc = await this.firestore.collection('users').doc(senderId).get();
        const senderName = senderDoc.exists() ? senderDoc.data()?.name || 'Someone' : 'Someone';
        
        await notificationService.sendNotificationToUser(receiverId, {
          title: 'New Message',
          body: `${senderName}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
          data: {
            type: 'chat',
            senderId: senderId,
            receiverId: receiverId,
            chatId: chatId,
            messageId: latestMessage.id,
          }
        });
      } catch (notificationError) {
        console.error('Error sending notification:', notificationError);
      }

      return latestMessage.id;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

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