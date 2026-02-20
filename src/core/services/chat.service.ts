import firestore, { serverTimestamp } from '@react-native-firebase/firestore';
import { COLLECTIONS } from './collection';
import { notificationService } from './notification.service';
import RNFS from 'react-native-fs';

interface Message {
  id?: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: any;
  read: boolean;
  type?: 'text' | 'image' | 'audio';
  imageData?: string;
  audioData?: string;
  audioDuration?: number; 
  deleted?: boolean;
  deleted_for?: string[];
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
      await chatRef.set({
        participants: [userId1, userId2].sort(),
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp(),
      });
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
        RNFS.unlink(processedUri).catch(() => {});
      }
      return base64Data;
    } catch (error) {
      console.error('Error converting image to base64:', error);
      throw error;
    }
  }

  /**
   * Unified sendMessage that handles text, image, and audio.
   *
   * @param audioData  - base64-encoded audio string (for voice messages)
   * @param audioDuration - duration in seconds
   */
  async sendMessage(
    senderId: string,
    receiverId: string,
    text: string,
    imageUri?: string,
    audioData?: string,
    audioDuration?: number,
  ) {
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
        deleted: false,
        deleted_for: [],
      };

      let lastMessagePreview = text;

      // ── Audio message ──────────────────────────────────────────────────────────
      if (audioData) {
        const audioSizeKB = Math.ceil(audioData.length / 1024);
        if (audioSizeKB > 900) {
          throw new Error(`Voice message too large (${audioSizeKB}KB). Maximum size is ~900KB.`);
        }
        messageData.type = 'audio';
        messageData.audioData = audioData;
        messageData.audioDuration = audioDuration ?? 0;
        messageData.text = 'Voice Message';
        lastMessagePreview = '🎤 Voice Message';

      // ── Image message ──────────────────────────────────────────────────────────
      } else if (imageUri) {
        const base64Data = await this.convertImageToBase64(imageUri);
        const base64SizeKB = Math.ceil(base64Data.length / 1024);
        if (base64SizeKB > 900) {
          throw new Error(`Image too large (${base64SizeKB}KB). Maximum size is ~900KB.`);
        }
        messageData.type = 'image';
        messageData.imageData = base64Data;
        messageData.text = 'Image';
        lastMessagePreview = '📷 Image';

      // ── Text message ───────────────────────────────────────────────────────────
      } else {
        messageData.type = 'text';
      }

      // Save to Firestore
      await messagesRef.add(messageData);

      // Update chat's lastMessage
      await this.firestore
        .collection(COLLECTIONS.CHATS)
        .doc(chatId)
        .set({ lastMessage: lastMessagePreview, lastMessageTime: serverTimestamp() }, { merge: true });

      // Send push notification
      try {
        const senderDoc = await this.firestore.collection('users').doc(senderId).get();
        const senderName = senderDoc.exists() ? senderDoc.data()?.name || 'Someone' : 'Someone';

        await notificationService.sendNotificationToUser(receiverId, {
          title: 'New Message',
          body: `${senderName}: ${lastMessagePreview.substring(0, 50)}`,
          data: { type: 'chat', senderId, receiverId, chatId },
        });
      } catch (notificationError) {
        console.error('Error sending notification:', notificationError);
      }
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