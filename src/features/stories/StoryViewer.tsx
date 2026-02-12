import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from 'react-native-vector-icons/Feather';
import { storiesService } from '../../core/services/stories.service';
import { useAuth } from '../../core/context/AuthContext';
import { StoryUser } from '../../core/services/stories.service';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');

interface StoryViewerRouteParams {
  storyUsers: StoryUser[];
  initialIndex: number;
}

type StoryViewerNavigationProp = NativeStackNavigationProp<any>;

const StoryViewer = () => {
  const navigation = useNavigation<StoryViewerNavigationProp>();
  const route = useRoute();
  const { storyUsers = [], initialIndex = 0 } =
    (route.params as Partial<StoryViewerRouteParams>) || {};
  const { user, userProfile } = useAuth();

  // Debug logs
  console.log('=== STORY VIEWER DEBUG ===');
  console.log('Received storyUsers:', storyUsers);
  console.log('Initial index:', initialIndex);
  console.log('StoryUsers length:', storyUsers.length);
  if (storyUsers.length > 0) {
    console.log(
      'First user stories count:',
      storyUsers[0].stories?.length || 0,
    );
    console.log('First user data:', storyUsers[0]);
  }
  console.log('=========================');

  const [currentIndex, setCurrentIndex] = useState(
    Math.min(initialIndex, storyUsers.length - 1),
  );
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [localStoryUsers, setLocalStoryUsers] =
    useState<StoryUser[]>(storyUsers); // Add local state
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  // Update local state when route params change
  useEffect(() => {
    console.log('Updating local state with storyUsers:', storyUsers);
    console.log('StoryUsers length:', storyUsers.length);

    // Validate and clean the data
    const validStoryUsers = storyUsers.filter(user => {
      if (!user) return false;
      if (!user.stories || !Array.isArray(user.stories)) {
        console.log('Invalid stories array for user:', user.userId);
        return false;
      }
      if (user.stories.length === 0) {
        console.log('Empty stories array for user:', user.userId);
        return false;
      }
      return true;
    });

    console.log('Valid story users:', validStoryUsers);

    setLocalStoryUsers(validStoryUsers);
    setCurrentIndex(Math.min(initialIndex, validStoryUsers.length - 1));
    setCurrentStoryIndex(0);
  }, [storyUsers, initialIndex]);

  const currentStoryUser = localStoryUsers[currentIndex];
  const currentStory = currentStoryUser?.stories?.[currentStoryIndex];

  // Debug the current story data
  console.log('=== CURRENT STORY DEBUG ===');
  console.log('Current story:', currentStory);
  console.log('Media URL:', currentStory?.mediaUrl);
  console.log('Media URL type:', typeof currentStory?.mediaUrl);
  console.log('Is base64:', currentStory?.mediaUrl?.startsWith('data:image'));
  console.log('==========================');

  // Safety checks
  if (!localStoryUsers || localStoryUsers.length === 0) {
    console.log('No story users provided');
    console.log('localStoryUsers:', localStoryUsers);
    console.log('Original storyUsers from params:', storyUsers);
    return (
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        <StatusBar hidden />
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ color: '#FFF', fontSize: 18 }}>
            No stories available
          </Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{
              marginTop: 20,
              padding: 10,
              backgroundColor: '#4CAF50',
              borderRadius: 5,
            }}
          >
            <Text style={{ color: '#FFF' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (
    !currentStoryUser ||
    !currentStoryUser.stories ||
    currentStoryUser.stories.length === 0
  ) {
    console.log('Invalid story user or no stories');
    console.log('currentStoryUser:', currentStoryUser);
    console.log('currentStoryUser.stories:', currentStoryUser?.stories);
    console.log('stories length:', currentStoryUser?.stories?.length);
    return (
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        <StatusBar hidden />
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ color: '#FFF', fontSize: 18 }}>
            No stories available
          </Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{
              marginTop: 20,
              padding: 10,
              backgroundColor: '#4CAF50',
              borderRadius: 5,
            }}
          >
            <Text style={{ color: '#FFF' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const handleDeleteStory = async () => {
    if (!currentStory) return;

    Alert.alert('Delete Story', 'Are you sure you want to delete this story?', [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (!storiesService) {
              Alert.alert('Error', 'Stories service not available');
              return;
            }

            // Stop progress timer
            if (progressInterval.current) {
              clearInterval(progressInterval.current);
            }

            await storiesService.deleteStory(currentStory.id);

            // Update local state immediately
            const updatedStoryUsers = [...localStoryUsers];
            const currentUserStories = updatedStoryUsers[currentIndex].stories;

            // Remove the deleted story
            const filteredStories = currentUserStories.filter(
              story => story.id !== currentStory.id,
            );

            if (filteredStories.length > 0) {
              // Update the stories array for this user
              updatedStoryUsers[currentIndex] = {
                ...updatedStoryUsers[currentIndex],
                stories: filteredStories,
              };

              setLocalStoryUsers(updatedStoryUsers);

              // Move to next story or next user
              if (currentStoryIndex < filteredStories.length) {
                // Stay on same index since we removed an item
                setCurrentStoryIndex(prev => Math.max(0, prev));
              } else if (currentIndex < updatedStoryUsers.length - 1) {
                // Move to next user
                setCurrentIndex(prev => prev + 1);
                setCurrentStoryIndex(0);
              } else {
                // No more stories, go back
                navigation.goBack();
              }
            } else {
              // No more stories for this user, remove the user
              const filteredUsers = updatedStoryUsers.filter(
                (_, index) => index !== currentIndex,
              );

              if (filteredUsers.length > 0) {
                setLocalStoryUsers(filteredUsers);
                // Adjust current index if needed
                const newCurrentIndex = Math.min(
                  currentIndex,
                  filteredUsers.length - 1,
                );
                setCurrentIndex(newCurrentIndex);
                setCurrentStoryIndex(0);
              } else {
                // No more users, go back
                navigation.goBack();
              }
            }

            // Restart progress for new story
            setTimeout(() => {
              if (progressInterval.current) {
                clearInterval(progressInterval.current);
              }
              startProgress();
            }, 100);
          } catch (error) {
            console.error('Error deleting story:', error);
            Alert.alert('Error', 'Failed to delete story');

            // Restart progress if there was an error
            if (progressInterval.current) {
              clearInterval(progressInterval.current);
            }
            startProgress();
          }
        },
      },
    ]);
  };

  // Handle adding more stories
  const handleAddMoreStories = () => {
    navigation.navigate('StoryCreator' as any);
  };

  // Start progress bar animation
  useEffect(() => {
    if (currentStory) {
      startProgress();

      // Mark story as viewed
      storiesService.markStoryAsViewed(currentStory.id, user?.uid || '');
    }

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current as any);
      }
    };
  }, [currentStory, currentIndex, currentStoryIndex]);

  const startProgress = () => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
    }

    setProgress(0);
    progressInterval.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          handleNextStory();
          return 0;
        }
        return prev + 2; // Adjust speed as needed
      });
    }, 100);
  };

  // Update the story navigation functions to use local state
  const handleNextStory = () => {
    const currentUser = localStoryUsers[currentIndex];
    if (currentStoryIndex < currentUser.stories.length - 1) {
      setCurrentStoryIndex(prev => prev + 1);
    } else if (currentIndex < localStoryUsers.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setCurrentStoryIndex(0);
    } else {
      navigation.goBack();
    }
  };

  const handlePreviousStory = () => {
    if (currentStoryIndex > 0) {
      setCurrentStoryIndex(prev => prev - 1);
    } else if (currentIndex > 0) {
      const prevUserIndex = currentIndex - 1;
      setCurrentIndex(prevUserIndex);
      setCurrentStoryIndex(localStoryUsers[prevUserIndex].stories.length - 1);
    } else {
      navigation.goBack();
    }
  };

  const handlePressLeft = () => {
    handlePreviousStory();
  };

  const handlePressRight = () => {
    handleNextStory();
  };

  // Safety check for missing data
  if (
    !currentStory ||
    !currentStoryUser ||
    !storyUsers ||
    storyUsers.length === 0
  ) {
    console.log('Missing story data:', {
      currentStory,
      currentStoryUser,
      storyUsers,
    });
    return (
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        <StatusBar hidden />
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ color: '#FFF', fontSize: 18 }}>
            No stories available
          </Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{
              marginTop: 20,
              padding: 10,
              backgroundColor: '#4CAF50',
              borderRadius: 5,
            }}
          >
            <Text style={{ color: '#FFF' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden />

      {/* Progress bars */}
      <View style={styles.progressContainer}>
        {currentStoryUser.stories.map((_, index) => (
          <View key={index} style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width:
                    index < currentStoryIndex
                      ? '100%'
                      : index === currentStoryIndex
                      ? `${progress}%`
                      : '0%',
                },
              ]}
            />
          </View>
        ))}
      </View>

      {/* User info */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <Image
            source={{ uri: currentStoryUser.userAvatar }}
            style={styles.userAvatar}
          />
          <Text style={styles.userName}>{currentStoryUser.userName}</Text>
        </View>
        <View style={styles.headerActions}>
          {/* Delete button - only show for your own stories */}
          {currentStoryUser.userId === userProfile?.uid && (
            <TouchableOpacity
              onPress={handleDeleteStory}
              style={styles.deleteButton}
            >
              <Feather name="trash-2" size={20} color="#FFF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Feather name="x" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Story content */}
      <TouchableOpacity
        style={styles.storyContainer}
        activeOpacity={1}
        onPressIn={() =>
          progressInterval.current && clearInterval(progressInterval.current)
        }
        onPressOut={startProgress}
      >
        {/* Debug logging */}
        {console.log('Rendering image with mediaUrl:', currentStory.mediaUrl)}

        {/* Handle image display - same approach as UserMessage */}
        <Image
          source={{ uri: currentStory.mediaUrl }}
          style={styles.storyImage}
          resizeMode="cover"
          onError={error => {
            console.log('Image load error:', error.nativeEvent.error);
            console.log('Failed URI:', currentStory.mediaUrl);
          }}
          onLoad={() => {
            console.log('Image loaded successfully');
          }}
        />

        {/* Left touch area */}
        <TouchableOpacity
          style={[styles.touchArea, styles.leftArea]}
          onPress={handlePressLeft}
          activeOpacity={1}
        />

        {/* Right touch area */}
        <TouchableOpacity
          style={[styles.touchArea, styles.rightArea]}
          onPress={handlePressRight}
          activeOpacity={1}
        />
      </TouchableOpacity>

      {/* Caption */}
      {currentStory.caption && (
        <View style={styles.captionContainer}>
          <Text style={styles.caption}>{currentStory.caption}</Text>
        </View>
      )}
      {currentStory.viewers && (
        <View style={styles.ViewsContainer}>
            <Feather name="eye" size={24} color="#FFF" />
          <Text style={styles.caption}>{currentStory.viewers.length}</Text>
        </View>
      )}

      {/* Add Story Button - only show for your own stories */}
      {currentStoryUser.userId === userProfile?.uid && (
        <View style={styles.addStoryContainer}>
          <TouchableOpacity
            style={styles.addStoryButton}
            onPress={handleAddMoreStories}
          >
            <Feather name="plus" size={24} color="#FFF" />
            <Text style={styles.addStoryText}>Add Story</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

// Add new styles for the add story button
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  progressContainer: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 50,
    gap: 5,
  },
  progressBar: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 1,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFF',
    borderRadius: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 10,
  },
  userName: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 16,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  deleteButton: {
    padding: 5,
  },
  storyContainer: {
    flex: 1,
    width: width,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000', // Black background for better contrast
  },
  // ... existing code ...

  storyImage: {
    width: width,
    flex: 1,
    resizeMode: 'cover', // This will show the full image without cropping
  },
  touchArea: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: width / 2,
  },
  leftArea: {
    left: 0,
  },
  rightArea: {
    right: 0,
  },
  captionContainer: {
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  caption: {
    color: '#FFF',
    fontSize: 16,
  },
  addStoryContainer: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    zIndex: 10,
  },
  ViewsContainer: {
    position: 'absolute',
    bottom: 50,
    right: "45%",
    zIndex: 10,
    flexDirection: 'row',
    gap:6
  },

  addStoryButton: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 25,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },

  addStoryText: {
    color: '#FFF',
    marginLeft: 8,
    fontWeight: '600',
    fontSize: 14,
  },
});

export default StoryViewer;
