import firestore from '@react-native-firebase/firestore';

export interface Story {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption?: string;
  timestamp: FirebaseFirestoreTypes.Timestamp;
  viewers: string[];
  expiresAt: FirebaseFirestoreTypes.Timestamp;
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

  // Convert and compress media for Firestore storage
  async uploadStoryMedia(userId: string, mediaUri: string, mediaType: 'image' | 'video'): Promise<string> {
    try {
      console.log('Starting image processing for:', mediaUri);
      
      // For images, just return the URI directly (same as UserMessage approach)
      if (mediaType === 'image') {
        console.log('Storing image URI directly:', mediaUri);
        return mediaUri; // Return URI directly without processing
      }

      // For videos, handle separately if needed
      console.log('Video detected - returning original URI');
      return mediaUri;

    } catch (error) {
      console.error('Error processing story media:', error);
      return mediaUri; // Return original URI on error
    }
  }

  // Create a new story
  async createStory(
    userId: string,
    userName: string,
    userAvatar: string,
    mediaUrl: string,
    mediaType: 'image' | 'video',
    caption?: string
  ): Promise<string> {
    try {
      console.log('Creating story for user:', userId);
      // Add the story document with server timestamp
      const storyData = {
        userId,
        userName,
        userAvatar,
        mediaUrl,
        mediaType,
        caption,
        viewers: [],
        timestamp: firestore.FieldValue.serverTimestamp(),
        // expiresAt will be calculated on the client side as timestamp + 24 hours
      };

      const storyRef = await this.firestore.collection('stories').add(storyData);
      console.log('Story created with ID:', storyRef.id);

      return storyRef.id;
    } catch (error) {
      console.error('Error creating story:', error);
      throw error;
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

      if (!snapshot.empty) {
        const batch = this.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        console.log(`Cleaned up ${snapshot.size} expired stories`);
      }
    } catch (error) {
      console.error('Error cleaning up expired stories:', error);
    }
  }

  // Enhanced listenToStories with cleanup
  listenToStories(currentUserId: string, callback: (storyUsers: StoryUser[]) => void) {
    console.log('Listening to stories for user:', currentUserId);
    
    // Run cleanup once when listener starts
    this.cleanupExpiredStories();
    
    return this.firestore
      .collection('stories')
      .orderBy('timestamp', 'desc')
      .onSnapshot(async snapshot => {
        try {
          console.log('Stories snapshot received, docs count:', snapshot.docs.length);
          const storyUsers: StoryUser[] = [];

          // Group stories by user
          const storiesByUser: Record<string, Story[]> = {};

          snapshot.docs.forEach(doc => {
            console.log('Processing document:', doc.id, doc.data());
            const story = {
              id: doc.id,
              ...doc.data() as Omit<Story, 'id'>,
            };
            
            // Check if story is expired (older than 24 hours)
            try {
              const storyTimestamp = story.timestamp;
              if (storyTimestamp) {
                const storyTime = storyTimestamp.toDate().getTime();
                const currentTime = Date.now();
                const twentyFourHours = 24 * 60 * 60 * 1000;

                if ((currentTime - storyTime) <= twentyFourHours) {
                  if (!storiesByUser[story.userId]) {
                    storiesByUser[story.userId] = [];
                  }
                  storiesByUser[story.userId].push(story);
                }
              }
            } catch (error) {
              console.error('Error processing story timestamp:', error);
            }
          });

          // Get user details for each story user
          console.log('Processing stories for users:', Object.keys(storiesByUser));
          for (const [userId, stories] of Object.entries(storiesByUser)) {
            console.log(`Processing user ${userId} with ${stories.length} stories`);
            
            try {
              const userDoc = await this.firestore.collection('users').doc(userId).get();
              if (userDoc.exists) {
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
              console.error(`Error fetching user data for ${userId}:`, error);
            }
          }

          callback(storyUsers);
        } catch (error) {
          console.error('Error processing stories snapshot:', error);
        }
      });
  }

  // Get your own stories - FIXED VERSION
  async getMyStories(userId: string): Promise<Story[]> {
    try {
      console.log('=== GET MY STORIES DEBUG ===');
      console.log('Getting stories for user:', userId);
      
      // SIMPLIFIED QUERY - Remove the composite index requirement
      const snapshot = await this.firestore
        .collection('stories')
        .where('userId', '==', userId)
        // Removed orderBy to avoid composite index requirement
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

        // Check if story is expired (older than 24 hours)
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

      // Sort manually after filtering
      stories.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

      console.log('Found', stories.length, 'active stories for user');
      console.log('===========================');
      return stories;
    } catch (error) {
      console.error('Error getting my stories:', error);
      // Show the specific error message
      if (error.code === 'failed-precondition') {
        console.error('Firestore index error - this is expected and handled');
      }
      return [];
    }
  }

  // Delete a story
  async deleteStory(storyId: string): Promise<void> {
    try {
      console.log('Deleting story:', storyId);
      await this.firestore.collection('stories').doc(storyId).delete();
      console.log('Story deleted successfully');
    } catch (error) {
      console.error('Error deleting story:', error);
      throw error;
    }
  }

  // Mark story as viewed
  async markStoryAsViewed(storyId: string, userId: string): Promise<void> {
    try {
      await this.firestore
        .collection('stories')
        .doc(storyId)
        .update({
          viewers: firestore.FieldValue.arrayUnion(userId),
        });
    } catch (error) {
      console.error('Error marking story as viewed:', error);
      throw error;
    }
  }
}

// Export with error handling
let storiesServiceInstance: StoriesService | null = null;

try {
  storiesServiceInstance = new StoriesService();
} catch (error) {
  console.error('Failed to initialize stories service:', error);
  storiesServiceInstance = null;
}

export const storiesService = storiesServiceInstance;