import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Alert,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useAuth } from '../../core/context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import firestore from '@react-native-firebase/firestore';
import { getAuth, updateProfile } from '@react-native-firebase/auth';
import { getUserAvatar } from '../../shared/utils/avatarUtils';
import { SafeAreaView } from 'react-native-safe-area-context';

const UserProfile = ({ route }: { route: { params: { userData: any } } }) => {
  const navigation = useNavigation();
  // const { user } = useAuth();
  const { userData } = route.params;
  const [profileImage, setProfileImage] = useState('');
  const [uploading, setUploading] = useState(false);


  return (
    <SafeAreaView  style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
        >
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity>
          <View style={styles.avatar}>
            <Text style={styles.profileImageText}>
              {userData?.name?.charAt(0)}
            </Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.name}>{userData?.name }</Text>
        <Text style={styles.username}>{userData?.email }</Text>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <ActionIcon icon="message-circle" />
          <ActionIcon icon="video" />
          <ActionIcon icon="phone" />
          <ActionIcon icon="more-horizontal" />
        </View>
      </View>

      {/* Bottom Sheet */}
      <View style={styles.sheet}>
        <View style={styles.dragHandle} />

        <ScrollView showsVerticalScrollIndicator={false}>
          <InfoRow
            label="Display Name"
            value={userData?.name }
          />
          <InfoRow
            label="Email Address"
            value={userData?.email }
          />
          <InfoRow label="Address" value="33 street west subidbazar, sylhet" />
          <InfoRow label="Phone Number" value="(320) 555-0104" />

          {/* Media */}
          <View style={styles.mediaHeader}>
            <Text style={styles.label}>Media Shared</Text>
            <Text style={styles.viewAll}>View All</Text>
          </View>

          <View style={styles.mediaRow}>
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1502741338009-cac2772e18bc',
              }}
              style={styles.mediaImg}
            />
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1518770660439-4636190af475',
              }}
              style={styles.mediaImg}
            />
            <View style={styles.mediaMore}>
              <Text style={styles.mediaMoreText}>255+</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView >
  );
};

/* Small Components */

const ActionIcon = ({ icon }: { icon: string }) => (
  <TouchableOpacity style={styles.actionBtn}>
    <Feather name={icon} size={20} color="#fff" />
  </TouchableOpacity>
);

const InfoRow = ({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) => (
  <View style={styles.infoBlock}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
  </View>
);

/* Styles */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1B14',
  },

  header: {
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 40,
  },

  backBtn: {
    position: 'absolute',
    left: 20,
    top: 50,
  },

  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    marginBottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImageText: {
    fontSize: 60,
    fontWeight: 'bold',
    color: '#fff',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
  },

  name: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },

  username: {
    color: '#9FAFA7',
    fontSize: 13,
    marginTop: 2,
  },

  actionRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 16,
  },

  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Bottom Sheet */

  sheet: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
  },

  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#DDD',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },

  infoBlock: {
    marginBottom: 18,
  },

  label: {
    color: '#999',
    fontSize: 12,
    marginBottom: 4,
  },

  value: {
    color: '#111',
    fontSize: 15,
    fontWeight: '500',
  },

  mediaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },

  viewAll: {
    color: '#00A884',
    fontSize: 13,
    fontWeight: '500',
  },

  mediaRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 10,
  },

  mediaImg: {
    width: 70,
    height: 70,
    borderRadius: 12,
  },

  mediaMore: {
    width: 70,
    height: 70,
    borderRadius: 12,
    backgroundColor: '#1E2A24',
    justifyContent: 'center',
    alignItems: 'center',
  },

  mediaMoreText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default UserProfile;
