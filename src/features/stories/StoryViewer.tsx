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
  Modal,
  TouchableWithoutFeedback,
  Animated,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from 'react-native-vector-icons/Feather';
import { storiesService } from '../../core/services/stories.service';
import { useAuth } from '../../core/context/AuthContext';
import { StoryUser } from '../../core/services/stories.service';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import ImageResizer from 'react-native-image-resizer';

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

  const [currentIndex, setCurrentIndex] = useState(
    Math.min(initialIndex, storyUsers.length - 1),
  );
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [localStoryUsers, setLocalStoryUsers] = useState<StoryUser[]>(storyUsers);
  const progressInterval = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Bottom sheet state ────────────────────────────────────────────────────
  const [storySheetVisible, setStorySheetVisible] = useState(false);
  const [isUploadingStory, setIsUploadingStory] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(280)).current;
  const sheetBackdropOpacity = useRef(new Animated.Value(0)).current;

  // Update local state when route params change
  useEffect(() => {
    const validStoryUsers = storyUsers.filter(u => {
      if (!u) return false;
      if (!u.stories || !Array.isArray(u.stories)) return false;
      if (u.stories.length === 0) return false;
      return true;
    });
    setLocalStoryUsers(validStoryUsers);
    setCurrentIndex(Math.min(initialIndex, validStoryUsers.length - 1));
    setCurrentStoryIndex(0);
  }, [storyUsers, initialIndex]);

  const currentStoryUser = localStoryUsers[currentIndex];
  const currentStory = currentStoryUser?.stories?.[currentStoryIndex];

  // ── Bottom sheet helpers ──────────────────────────────────────────────────
  const openStorySheet = () => {
    // Pause progress while sheet is open
    if (progressInterval.current) clearInterval(progressInterval.current);
    setStorySheetVisible(true);
    Animated.parallel([
      Animated.spring(sheetTranslateY, {
        toValue: 0,
        damping: 20,
        stiffness: 260,
        mass: 0.9,
        useNativeDriver: true,
      }),
      Animated.timing(sheetBackdropOpacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeStorySheet = (callback?: () => void) => {
    Animated.parallel([
      Animated.timing(sheetTranslateY, {
        toValue: 280,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(sheetBackdropOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setStorySheetVisible(false);
      if (callback) {
        callback();
      } else {
        // Resume progress when sheet dismissed without action
        startProgress();
      }
    });
  };

  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'App needs camera permission to take photos',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch {
        return false;
      }
    }
    return true;
  };

  const compressImage = async (uri: string): Promise<string> => {
    try {
      const result = await ImageResizer.createResizedImage(
        uri, 1000, 1000, 'JPEG', 85, 0, undefined, true,
      );
      return result.uri;
    } catch {
      return uri;
    }
  };

  const uploadStory = async (mediaUri: string, type: 'image' | 'video') => {
    if (!userProfile) return;
    setIsUploadingStory(true);
    try {
      const compressed = type === 'image' ? await compressImage(mediaUri) : mediaUri;
      await storiesService?.createStory(
        userProfile.uid,
        userProfile.name || 'User',
        userProfile.profile_image || '',
        compressed,
        type,
        '',
      );
      Alert.alert('Success', 'Story uploaded successfully!');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to upload story');
    } finally {
      setIsUploadingStory(false);
      startProgress();
    }
  };

  const handlePickFromGallery = () => {
    closeStorySheet(() => {
      launchImageLibrary(
        { mediaType: 'photo', quality: 0.8, selectionLimit: 1 },
        (response) => {
          if (response.assets && response.assets[0]?.uri) {
            uploadStory(response.assets[0].uri, 'image');
          } else {
            startProgress();
          }
        },
      );
    });
  };

  const handleTakePhoto = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Camera permission is required');
      startProgress();
      return;
    }
    closeStorySheet(() => {
      launchCamera(
        { mediaType: 'photo', quality: 0.8, saveToPhotos: true, cameraType: 'back' },
        (response) => {
          if (response.assets && response.assets[0]?.uri) {
            uploadStory(response.assets[0].uri, 'image');
          } else {
            startProgress();
          }
        },
      );
    });
  };

  // ── Story logic ───────────────────────────────────────────────────────────
  if (!localStoryUsers || localStoryUsers.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        <StatusBar hidden />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#FFF', fontSize: 18 }}>No stories available</Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ marginTop: 20, padding: 10, backgroundColor: '#4CAF50', borderRadius: 5 }}
          >
            <Text style={{ color: '#FFF' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!currentStoryUser || !currentStoryUser.stories || currentStoryUser.stories.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        <StatusBar hidden />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#FFF', fontSize: 18 }}>No stories available</Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ marginTop: 20, padding: 10, backgroundColor: '#4CAF50', borderRadius: 5 }}
          >
            <Text style={{ color: '#FFF' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const handleDeleteStory = async () => {
    if (!currentStory || !storiesService) return;

    Alert.alert('Delete Story', 'Are you sure you want to delete this story?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (progressInterval.current) clearInterval(progressInterval.current);
            await storiesService!.deleteStory(currentStory.id);

            const updatedStoryUsers = [...localStoryUsers];
            const currentUserStories = updatedStoryUsers[currentIndex].stories;
            const filteredStories = currentUserStories.filter(s => s.id !== currentStory.id);

            if (filteredStories.length > 0) {
              updatedStoryUsers[currentIndex] = {
                ...updatedStoryUsers[currentIndex],
                stories: filteredStories,
              };
              setLocalStoryUsers(updatedStoryUsers);
              setCurrentStoryIndex(prev => Math.max(0, prev));
            } else {
              const filteredUsers = updatedStoryUsers.filter((_, i) => i !== currentIndex);
              if (filteredUsers.length > 0) {
                setLocalStoryUsers(filteredUsers);
                setCurrentIndex(Math.min(currentIndex, filteredUsers.length - 1));
                setCurrentStoryIndex(0);
              } else {
                navigation.goBack();
              }
            }

            setTimeout(() => {
              if (progressInterval.current) clearInterval(progressInterval.current);
              startProgress();
            }, 100);
          } catch (error) {
            Alert.alert('Error', 'Failed to delete story');
            if (progressInterval.current) clearInterval(progressInterval.current);
            startProgress();
          }
        },
      },
    ]);
  };

  useEffect(() => {
    if (currentStory && storiesService) {
      startProgress();
      storiesService.markStoryAsViewed(currentStory.id, user?.uid || '');
    }
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current as any);
    };
  }, [currentStory, currentIndex, currentStoryIndex]);

  const startProgress = () => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    setProgress(0);
    progressInterval.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          handleNextStory();
          return 0;
        }
        return prev + 2;
      });
    }, 100);
  };

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

  if (!currentStory || !currentStoryUser || !storyUsers || storyUsers.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        <StatusBar hidden />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#FFF', fontSize: 18 }}>No stories available</Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ marginTop: 20, padding: 10, backgroundColor: '#4CAF50', borderRadius: 5 }}
          >
            <Text style={{ color: '#FFF' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isMyStory = currentStoryUser.userId === userProfile?.uid;

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

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <Image source={{ uri: currentStoryUser.userAvatar }} style={styles.userAvatar} />
          <Text style={styles.userName}>{currentStoryUser.userName}</Text>
        </View>
        <View style={styles.headerActions}>
          {isMyStory && (
            <TouchableOpacity onPress={handleDeleteStory} style={styles.deleteButton}>
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
        onPressIn={() => progressInterval.current && clearInterval(progressInterval.current)}
        onPressOut={startProgress}
      >
        {currentStory.mediaData ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${currentStory.mediaData}` }}
            style={styles.storyImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.storyImage}>
            <Text style={{ color: '#FFF' }}>Loading image...</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.touchArea, styles.leftArea]}
          onPress={handlePreviousStory}
          activeOpacity={1}
        />
        <TouchableOpacity
          style={[styles.touchArea, styles.rightArea]}
          onPress={handleNextStory}
          activeOpacity={1}
        />
      </TouchableOpacity>

      {/* Caption */}
      {currentStory.caption && (
        <View style={styles.captionContainer}>
          <Text style={styles.caption}>{currentStory.caption}</Text>
        </View>
      )}

      {/* Views count — own stories only */}
      {isMyStory && (
        <View style={styles.ViewsContainer}>
          <Feather name="eye" size={24} color="#FFF" />
          <Text style={styles.caption}>{currentStory.viewers.length}</Text>
        </View>
      )}

      {/* Add Story button — own stories only — now opens bottom sheet */}
      {isMyStory && (
        <View style={styles.addStoryContainer}>
          <TouchableOpacity style={styles.addStoryButton} onPress={openStorySheet}>
            <Feather name="plus" size={24} color="#FFF" />
            <Text style={styles.addStoryText}>Add Story</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Story Picker Bottom Sheet ── */}
      <Modal
        visible={storySheetVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => closeStorySheet()}
      >
        <TouchableWithoutFeedback onPress={() => closeStorySheet()}>
          <Animated.View style={[sheetStyles.backdrop, { opacity: sheetBackdropOpacity }]} />
        </TouchableWithoutFeedback>

        <Animated.View style={[sheetStyles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
          {/* Drag handle */}
          <View style={sheetStyles.handle} />

          {/* Title */}
          <Text style={sheetStyles.title}>Add to Story</Text>
          <View style={sheetStyles.divider} />

          {/* Options */}
          <View style={sheetStyles.optionsRow}>
            <TouchableOpacity
              style={sheetStyles.optionBtn}
              onPress={handleTakePhoto}
              activeOpacity={0.75}
              disabled={isUploadingStory}
            >
              <View style={[sheetStyles.iconCircle, { backgroundColor: '#E1306C' }]}>
                <Feather name="camera" size={26} color="#FFF" />
              </View>
              <Text style={sheetStyles.optionLabel}>Camera</Text>
            </TouchableOpacity>

            <View style={sheetStyles.optionDivider} />

            <TouchableOpacity
              style={sheetStyles.optionBtn}
              onPress={handlePickFromGallery}
              activeOpacity={0.75}
              disabled={isUploadingStory}
            >
              <View style={[sheetStyles.iconCircle, { backgroundColor: '#405DE6' }]}>
                <Feather name="image" size={26} color="#FFF" />
              </View>
              <Text style={sheetStyles.optionLabel}>Gallery</Text>
            </TouchableOpacity>
          </View>

          {isUploadingStory && (
            <Text style={sheetStyles.uploadingText}>Uploading story...</Text>
          )}

          {/* Cancel */}
          <TouchableOpacity
            style={sheetStyles.cancelBtn}
            onPress={() => closeStorySheet()}
            activeOpacity={0.7}
          >
            <Text style={sheetStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>

          <View style={{ height: Platform.OS === 'ios' ? 28 : 12 }} />
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
};

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
    backgroundColor: '#000',
  },
  storyImage: {
    width: width,
    flex: 1,
    resizeMode: 'cover',
  },
  touchArea: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: width / 2,
  },
  leftArea: { left: 0 },
  rightArea: { right: 0 },
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
    right: '45%',
    zIndex: 10,
    flexDirection: 'row',
    gap: 6,
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

const sheetStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 30,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#48484A',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 18,
    letterSpacing: -0.2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#38383A',
    marginHorizontal: -20,
    marginBottom: 28,
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    marginBottom: 28,
  },
  optionBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 12,
  },
  optionDivider: {
    width: StyleSheet.hairlineWidth,
    height: 70,
    backgroundColor: '#38383A',
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#EBEBF5',
    letterSpacing: 0.1,
  },
  uploadingText: {
    color: '#8E8E93',
    textAlign: 'center',
    fontSize: 13,
    marginBottom: 12,
  },
  cancelBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#38383A',
    marginHorizontal: -20,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#8E8E93',
  },
});

export default StoryViewer;