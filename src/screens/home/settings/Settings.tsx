import { useNavigation } from '@react-navigation/native';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialDesignIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const settingsOptions = [
  {
    id: '1',
    title: 'Account',
    subtitle: 'Privacy, security, change number',
    icon: 'key',
  },
  {
    id: '2',
    title: 'Chat',
    subtitle: 'Chat history, theme, wallpapers',
    icon: 'message-circle',
  },
  {
    id: '3',
    title: 'Notifications',
    subtitle: 'Messages, group and others',
    icon: 'bell',
  },
  {
    id: '4',
    title: 'Help',
    subtitle: 'Help center, contact us, privacy policy',
    icon: 'help-circle',
  },
  {
    id: '5',
    title: 'Storage and data',
    subtitle: 'Network usage, storage usage',
    icon: 'arrow-down-up',
  },
  {
    id: '6',
    title: 'Invite a friend',
    subtitle: '',
    icon: 'users',
  },
];

export default function Settings() {
  const navigation = useNavigation();
  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.row} activeOpacity={0.7}>
      <View style={styles.iconWrapper}>
        <Feather name={item.icon} size={20} color="#5F9EA0" />
      </View>
      <View style={styles.textWrapper}>
        <Text style={styles.title}>{item.title}</Text>
        {item.subtitle ? (
          <Text style={styles.subtitle}>{item.subtitle}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* White Sheet */}
      <View style={styles.sheet}>
        {/* Profile */}
        <View style={styles.profileRow}>
          <Image
            source={{ uri: 'https://randomuser.me/api/portraits/men/45.jpg' }}
            style={styles.profileImage}
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.profileName}>Nazrul Islam</Text>
            <Text style={styles.profileStatus}>Never give up 💪</Text>
          </View>
          <MaterialDesignIcons name="qrcode-scan" size={22} color="#5F9EA0" />
        </View>

        {/* Options */}
        <FlatList
          data={settingsOptions}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 100,
    backgroundColor: '#000',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  sheet: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    paddingVertical: 16,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  profileImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '600',
  },
  profileStatus: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrapper: {
    marginLeft: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
  },
  subtitle: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
});
