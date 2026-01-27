import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  FlatList,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../../navigation/AppNavigator';
import AppTextInput from '../../../components/AppTextInput';

type Props = NativeStackScreenProps<AppStackParamList, 'userMsg'>;

const UserMessage = ({ route }: Props) => {
  const navigation = useNavigation();
  const { userData } = route.params;

  const SKELETON_DATA = Array.from({ length: 10 });

  const renderItem = ({ index }) => {
    const isRight = index % 2 === 0;

    return (
      <View
        style={[
          styles.messageRow,
          isRight ? styles.rightAlign : styles.leftAlign,
        ]}
      >
        {!isRight && (
          <Image 
            source={{ uri: userData.profile_image }} 
            style={styles.avatar} 
          />
        )}

        <View
          style={[
            styles.bubble,
            isRight ? styles.rightBubble : styles.leftBubble,
            index === 8 && styles.audioBubble,
          ]}
        >
          <Text style={styles.messageText}>
            {index === 8 ? '🎤 Audio message' : `Message ${index + 1}`}
          </Text>
        </View>

        {isRight && <View style={{ width: 40 }} />}
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
            source={{ uri: userData.profile_image }} 
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
        data={SKELETON_DATA}
        keyExtractor={(_, i) => i.toString()}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.iconButton}>
          <Feather name="paperclip" size={20} color="#666" />
        </TouchableOpacity>

        <View style={styles.inputContainer}>
          {/* <Text style={styles.inputPlaceholder}>Write your message</Text> */}
          <AppTextInput/>
        </View>

        <TouchableOpacity style={styles.iconButton}>
          <Feather name="camera" size={20} color="#666" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.iconButton}>
          <Feather name="mic" size={20} color="#666" />
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
  },
  audioBubble: {
    height: 45,
    justifyContent: 'center',
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
  inputPlaceholder: {
    color: '#AAA',
    fontSize: 14,
  },
});