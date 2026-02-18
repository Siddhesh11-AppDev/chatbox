import firestore, { serverTimestamp, Timestamp } from '@react-native-firebase/firestore';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';

export interface Story {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  mediaUrl?: string;
  mediaData?: string;
  mediaType: 'image' | 'video';
  caption?: string;
  timestamp: Timestamp;
  viewers: string[];
  expiresAt?: Timestamp;
}

export interface StoryUser {
  userId: string;
  userName: string;
  userAvatar: string;
  stories: Story[];
  hasUnviewed: boolean;
}

class StoriesService {
  private firestore = firestore();

  async convertMediaToBase64(mediaUri: string): Promise<string> {
    try {
      let processedUri = mediaUri;
      if (mediaUri.startsWith('content://')) {
        const tempPath = `${RNFS.CachesDirectoryPath}/temp_media_${Date.now()}.${mediaUri.split('.').pop() || 'jpg'}`;
        await RNFS.copyFile(mediaUri, tempPath);
        processedUri = tempPath;
      }
      
      const base64Data = await RNFS.readFile(processedUri, 'base64');
      
      if (processedUri.includes('/temp_media_')) {
        try {
          await RNFS.unlink(processedUri);
        } catch (cleanupError) {
          console.warn('Could not clean up temp file:', cleanupError);
        }
      }
      
      return base64Data;
    } catch (error) {
      console.error('Error converting media to base64:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async uploadStoryMedia(userId: string, mediaUri: string, mediaType: 'image' | 'video'): Promise<string> {
    try {
      console.log('Starting media processing for:', mediaUri);
      
      const base64Data = await this.convertMediaToBase64(mediaUri);
      
      const base64SizeKB = Math.ceil(base64Data.length / 1024);
      if (base64SizeKB > 900) {
        throw new Error(`Media too large (${base64SizeKB}KB) to upload. Maximum size is ~900KB.`);
      }
      
      console.log('Successfully converted media to base64, size:', base64SizeKB, 'KB');
      return base64Data;
    } catch (error) {
      console.error('Error processing story media:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async createStory(
    userId: string,
    userName: string,
    userAvatar: string,
    mediaUri: string,
    mediaType: 'image' | 'video',
    caption?: string
  ): Promise<string> {
    try {
      console.log('Creating story for user:', userId);
      
      const mediaData = await this.uploadStoryMedia(userId, mediaUri, mediaType);
      
      const storyData = {
        userId,
        userName,
        userAvatar,
        mediaData,
        mediaType,
        caption,
        viewers: [],
        timestamp: serverTimestamp(),
      };

      const storyRef = await this.firestore.collection('stories').add(storyData);
      console.log('Story created with ID:', storyRef.id);

      return storyRef.id;
    } catch (error) {
      console.error('Error creating story:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async cleanupExpiredStories(): Promise<void> {
    try {
      console.log('Cleaning up expired stories...');
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      
      const snapshot = await this.firestore
        .collection('stories')
        .where('timestamp', '<=', new Date(now - twentyFourHours))
        .get();
      
      // Check if snapshot is null (Firebase error)
      if (!snapshot) {
        console.log('❌ Firestore query returned null');
        return;
      }

      if (!snapshot.empty) {
        const batch = this.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        console.log(`Cleaned up ${snapshot.size} expired stories`);
      }
    } catch (error) {
      console.error('Error cleaning up expired stories:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async getChatPartners(userId: string): Promise<string[]> {
    try {
      // Get all chats and filter client-side (avoids index requirement)
      const chatsSnapshot = await this.firestore
        .collection('chats')
        .get();
      
      const partners = new Set<string>();
      chatsSnapshot.docs.forEach(doc => {
        const chat = doc.data();
        if (chat.participants && Array.isArray(chat.participants)) {
          chat.participants.forEach((participantId: string) => {
            if (participantId !== userId) {
              partners.add(participantId);
            }
          });
        }
      });
      
      console.log('Chat partners found:', Array.from(partners));
      return Array.from(partners);
    } catch (error) {
      console.error('Error getting chat partners:', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  async listenToStories(currentUserId: string, callback: (storyUsers: StoryUser[]) => void) {
    console.log('Listening to stories for user:', currentUserId);
    
    try {
      const chatPartners = await this.getChatPartners(currentUserId);
      console.log('Chat partners found:', chatPartners);
      
      this.cleanupExpiredStories();
      
      // Get all stories and filter client-side
      const unsubscribe = this.firestore
        .collection('stories')
        .orderBy('timestamp', 'desc')
        .onSnapshot(
          (snapshot) => {
            console.log('Stories snapshot received, docs count:', snapshot.docs.length);
            
            const storyUsers: StoryUser[] = [];
            const storiesByUser: Record<string, Story[]> = {};
            const now = Date.now();
            const twentyFourHours = 24 * 60 * 60 * 1000;

            snapshot.forEach((doc) => {
              const story = {
                id: doc.id,
                ...doc.data() as Omit<Story, 'id'>,
              };
              
              // TEMPORARY: Show ALL stories for testing
              // Remove this line to enable private stories
              const shouldShow = true;
                
              console.log(`Story: ${story.id}, userId: ${story.userId}, currentUser: ${currentUserId}`);
              
              if (!shouldShow) {
                return;
              }
                
              try {
                const storyTimestamp = story.timestamp;
                if (storyTimestamp) {
                  const storyTime = storyTimestamp.toDate().getTime();
                  if ((now - storyTime) <= twentyFourHours) {
                    if (!storiesByUser[story.userId]) {
                      storiesByUser[story.userId] = [];
                    }
                    storiesByUser[story.userId].push(story);
                  } else {
                    console.log('Story expired:', story.id);
                  }
                }
              } catch (error) {
                console.error('Error processing story:', error instanceof Error ? error : new Error(String(error)));
              }
            });

            console.log('Stories by user:', Object.keys(storiesByUser));
            
            const processUsers = async () => {
              for (const [userId, stories] of Object.entries(storiesByUser)) {
                console.log(`Processing user ${userId} with ${stories.length} stories`);
                
                try {
                  const userDoc = await this.firestore.collection('users').doc(userId).get();
                  if (userDoc.exists()) {
                    const userData = userDoc.data();
                    const hasUnviewed = stories.some(story => !story.viewers.includes(currentUserId));

                    storyUsers.push({
                      userId,
                      userName: userData?.name || '',
                      userAvatar: userData?.profile_image || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData?.name || 'U')}`,
                      stories: stories.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis()),
                      hasUnviewed,
                    });
                  }
                } catch (error) {
                  console.error(`Error fetching user data for ${userId}:`, error instanceof Error ? error : new Error(String(error)));
                }
              }
            };
            
            processUsers().then(() => {
              callback(storyUsers);
            }).catch((error) => {
              console.error('Error processing stories:', error instanceof Error ? error : new Error(String(error)));
              callback(storyUsers);
            });
          },
          (error) => {
            console.error('Firestore snapshot error:', error);
            callback([]);
          }
        );

      return unsubscribe;
    } catch (error) {
      console.error('Error setting up stories listener:', error instanceof Error ? error : new Error(String(error)));
      return () => {};
    }
  }

  async getMyStories(userId: string): Promise<Story[]> {
    try {
      console.log('=== GET MY STORIES DEBUG ===');
      console.log('Getting stories for user:', userId);
      
      const snapshot = await this.firestore
        .collection('stories')
        .where('userId', '==', userId)
        .get();

      console.log('Found', snapshot.size, 'story documents for user');
      
      const stories: Story[] = [];
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;

      snapshot.docs.forEach(doc => {
        const story = {
          id: doc.id,
          ...doc.data() as Omit<Story, 'id'>,
        };

        const storyTimestamp = story.timestamp;
        if (storyTimestamp) {
          const storyTime = storyTimestamp.toDate().getTime();
          
          if ((now - storyTime) <= twentyFourHours) {
            stories.push(story);
            console.log('Added valid story:', story.id, 'created at:', story.timestamp?.toDate());
          } else {
            console.log('Skipping expired story:', story.id, 'created at:', story.timestamp?.toDate());
          }
        }
      });

      stories.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

      console.log('Found', stories.length, 'active stories for user');
      console.log('===========================');
      return stories;
    } catch (error) {
      console.error('Error getting my stories:', error instanceof Error ? error : new Error(String(error)));
      if (error && typeof error === 'object' && 'code' in error && error.code === 'failed-precondition') {
        console.error('Firestore index error - this is expected and handled');
      }
      return [];
    }
  }

  async deleteStory(storyId: string): Promise<void> {
    try {
      console.log('Deleting story:', storyId);
      await this.firestore.collection('stories').doc(storyId).delete();
      console.log('Story deleted successfully');
    } catch (error) {
      console.error('Error deleting story:', error instanceof Error ? error : new Error(String(error)));
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async markStoryAsViewed(storyId: string, userId: string): Promise<void> {
    try {
      await this.firestore
        .collection('stories')
        .doc(storyId)
        .update({
          viewers: firestore.FieldValue.arrayUnion(userId),
        });
    } catch (error) {
      console.error('Error marking story as viewed:', error instanceof Error ? error : new Error(String(error)));
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

let storiesServiceInstance: StoriesService | null = null;

try {
  storiesServiceInstance = new StoriesService();
} catch (error) {
  console.error('Failed to initialize stories service:', error instanceof Error ? error : new Error(String(error)));
  storiesServiceInstance = null;
}

export const storiesService = storiesServiceInstance;