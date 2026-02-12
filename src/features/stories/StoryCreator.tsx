import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  TextInput,
  PermissionsAndroid,
  Platform,
  StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Feather from 'react-native-vector-icons/Feather';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import ImageResizer from 'react-native-image-resizer';
import { useAuth } from '../../core/context/AuthContext';
import { storiesService } from '../../core/services/stories.service';
import { SafeAreaView } from 'react-native-safe-area-context';

type StoryCreatorNavigationProp = NativeStackNavigationProp<any>;

const StoryCreator = () => {
  const navigation = useNavigation<StoryCreatorNavigationProp>();
  const { user, userProfile } = useAuth();
  const [selectedMedia, setSelectedMedia] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [caption, setCaption] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Function to request camera permission
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
      } catch (err) {
        console.warn(err);
        return false;
      }
    }
    return true; // iOS handles permissions differently
  };

  const handleSelectFromGallery = () => {
    const options = {
      mediaType: 'photo' as const,
      quality: 0.8,
      selectionLimit: 1,
    };

    launchImageLibrary(options, (response) => {
      console.log('ImagePicker Response:', response);
      
      if (response.didCancel) {
        console.log('User cancelled image picker');
        Alert.alert('Cancelled', 'Image selection was cancelled');
      } else if (response.errorCode) {
        console.log('ImagePicker Error: ', response.errorMessage);
        Alert.alert('Error', `Failed to select image: ${response.errorMessage}`);
      } else if (response.assets && response.assets[0]) {
        console.log('Selected image URI:', response.assets[0].uri);
        setSelectedMedia(response.assets[0].uri || null);
        setMediaType('image');
      } else {
        Alert.alert('Error', 'No image was selected');
      }
    });
  };

  const handleTakePhoto = async () => {
    // Request camera permission first
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Camera permission is required to take photos');
      return;
    }

    const options = {
      mediaType: 'photo' as const,
      quality: 0.8,
      saveToPhotos: true,
      cameraType: 'back', // Use back camera
    };

    console.log('Launching camera with options:', options);

    launchCamera(options, (response) => {
      console.log('Camera Response:', response);
      
      if (response.didCancel) {
        console.log('User cancelled camera');
        Alert.alert('Cancelled', 'Photo capture was cancelled');
      } else if (response.errorCode) {
        console.log('Camera Error: ', response.errorMessage);
        Alert.alert('Camera Error', `Failed to take photo: ${response.errorMessage}`);
      } else if (response.assets && response.assets[0]) {
        console.log('Captured photo URI:', response.assets[0].uri);
        setSelectedMedia(response.assets[0].uri || null);
        setMediaType('image');
      } else {
        Alert.alert('Error', 'No photo was captured');
      }
    });
  };

  const handleUploadStory = async () => {
    if (!selectedMedia || !userProfile) {
      Alert.alert('Error', 'Please select a photo first');
      return;
    }

    if (!storiesService) {
      Alert.alert('Error', 'Stories service is not available. RNFS may not be properly linked.');
      return;
    }

    setIsUploading(true);
    try {
      // Compress image if it's too large using base64
      let compressedMediaUri = selectedMedia;
      
      if (mediaType === 'image') {
        compressedMediaUri = await compressImage(selectedMedia);
      }
      
      // Upload media to Firestore as base64
      const mediaUrl = await storiesService.uploadStoryMedia(
        userProfile.uid,
        compressedMediaUri,
        mediaType
      );

      // Create story in Firestore
      await storiesService.createStory(
        userProfile.uid,
        userProfile.name || 'User',
        userProfile.profile_image || '',
        mediaUrl,
        mediaType,
        caption
      );

      Alert.alert('Success', 'Story uploaded successfully!');
      navigation.goBack();
    } catch (error: any) {
      console.error('Error uploading story:', error);
      console.error('Error details:', error.message || error);
      
      let errorMessage = 'Failed to upload story. Please try again.';
      if (error.code) {
        errorMessage += `\nError code: ${error.code}`;
      }
      if (error.message) {
        errorMessage += `\n${error.message}`;
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsUploading(false);
    }
  };
  
  const compressImage = async (imageUri: string): Promise<string> => {
    try {
      // Use react-native-image-resizer for proper image compression
      const response = await ImageResizer.createResizedImage(
        imageUri,
        1000, // maxWidth
        1000, // maxHeight  
        'JPEG', // format
        85, // quality (0-100)
        0, // rotation
        undefined, // outputPath
        true // keep metadata
      );
      
      console.log('Image compressed successfully:', response);
      return response.uri;
    } catch (error) {
      console.error('Error compressing image:', error);
      // Return original URI if compression fails
      return imageUri;
    }
  };

  if (selectedMedia) {
    return (
      <View style={styles.previewContainer}>
        <View style={styles.previewHeader}>
          <TouchableOpacity onPress={() => setSelectedMedia(null)}>
            <Feather name="arrow-left" size={24} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.previewTitle}>Preview Story</Text>
          <TouchableOpacity 
            onPress={handleUploadStory} 
            disabled={isUploading}
            style={styles.postButton}
          >
            <Text style={[styles.postButtonText, isUploading && styles.disabledText]}>
              {isUploading ? 'Posting...' : 'Post'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.imagePreviewContainer}>
          <Image source={{ uri: selectedMedia }} style={styles.imagePreview} resizeMode="contain" />
        </View>

        <View style={styles.captionContainer}>
          <TextInput
            style={styles.captionInput}
            placeholder="Add a caption..."
            value={caption}
            onChangeText={setCaption}
            multiline
            maxLength={150}
          />
          <Text style={styles.captionLength}>{caption.length}/150</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Feather name="x" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Create Story</Text>
        <View style={{ width: 24 }} /> {/* Spacer */}
      </View>

      <View style={styles.optionsContainer}>
        <TouchableOpacity style={styles.optionButton} onPress={handleTakePhoto}>
          <View style={styles.optionIcon}>
            <Feather name="camera" size={32} color="#FFF" />
          </View>
          <Text style={styles.optionText}>Take Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.optionButton} onPress={handleSelectFromGallery}>
          <View style={styles.optionIcon}>
            <Feather name="image" size={32} color="#FFF" />
          </View>
          <Text style={styles.optionText}>Choose from Gallery</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  optionsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  optionButton: {
    alignItems: 'center',
    marginBottom: 40,
  },
  optionIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  optionText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
  },
  postButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  postButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 16,
  },
  disabledText: {
    opacity: 0.6,
  },
  imagePreviewContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreview: {
    width: '100%',
    height: '80%',
  },
  captionContainer: {
    padding: 20,
    backgroundColor: '#FFF',
  },
  captionInput: {
    fontSize: 16,
    color: '#000',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  captionLength: {
    textAlign: 'right',
    color: '#999',
    fontSize: 12,
    marginTop: 5,
  },
});

export default StoryCreator;