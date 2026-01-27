import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Image,
  TouchableOpacity,
  Modal,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { contactJson } from '../../../api/ContactJson';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../../navigation/AppNavigator';
import { SafeAreaView } from 'react-native-safe-area-context';

type ContactsNavigationProp = NativeStackNavigationProp<AppStackParamList, 'userMsg'>;

const contacts = Object.values(
  contactJson.reduce((acc, item) => {
    const key = item.name[0].toUpperCase();
    if (!acc[key]) acc[key] = { title: key, data: [] };
    acc[key].data.push(item);
    return acc;
  }, {})
).sort((a, b) => a.title.localeCompare(b.title));

export default function Contacts() {
  const navigation = useNavigation<ContactsNavigationProp>();
  const [selectedContact, setSelectedContact] = useState(null);

  const handleSendMessage = (contact) => {
    // Convert contact format to match Messages screen expectation
    const userData = {
      _id: contact.id || contact._id || 'unknown',
      name: contact.name,
      last_message: contact.status || '',
      time: '',
      unread_count: 0,
      online: contact.status === 'Online',
      profile_image: contact.profileImage || contact.profile_image,
    };
    
    navigation.navigate('userMsg', { userData });
    setSelectedContact(null); // Close modal after navigation
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => setSelectedContact(item)}
    >
      <Image source={{ uri: item.profileImage }} style={styles.avatar} />
      <View style={styles.info}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.status}>{item.status}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Feather name="search" size={20} color="#fff" />
        <Text style={styles.headerTitle}>Contacts</Text>
        <Feather name="user-plus" size={20} color="#fff" />
      </View>

      {/* List */}
      <View style={styles.sheet}>
        <Text style={styles.myContact}>My Contact</Text>
        <SectionList
          sections={contacts} // Fixed: Using the processed contacts array
          keyExtractor={(item) => item.id || item._id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* Bottom Sheet */}
      <Modal transparent visible={!!selectedContact} animationType="slide">
        <TouchableOpacity
          style={styles.overlay}
          onPress={() => setSelectedContact(null)}
        />
        <View style={styles.bottomSheet}>
          {selectedContact && (
            <>
              <Image
                source={{ uri: selectedContact.profileImage }}
                style={styles.sheetAvatar}
              />
              <Text style={styles.sheetName}>{selectedContact.name}</Text>
              <Text style={styles.sheetPhone}>{selectedContact.phone}</Text>

              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn}>
                  <Feather name="phone" size={22} color="#34C759" />
                  <Text>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.actionBtn}
                  onPress={() => handleSendMessage(selectedContact)}
                >
                  <Feather name="message-circle" size={22} color="#007AFF" />
                  <Text>Message</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
     flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 100,
    backgroundColor: '#000',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  sheet: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
  },
  myContact: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    fontWeight: '600',
    color: '#8E8E93',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  info: { marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600' },
  status: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  bottomSheet: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
  },
  sheetName: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
  sheetPhone: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 20,
  },
  actionBtn: { alignItems: 'center' },
});