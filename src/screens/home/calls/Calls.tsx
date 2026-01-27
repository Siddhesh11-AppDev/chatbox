import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { CallsJson } from '../../../api/CallsJson';
import { SafeAreaView } from 'react-native-safe-area-context';



export default function Calls() {
  const renderItem = ({ item }) => {
    const callIconColor = item.callType === 'missed' ? '#FF3B30' : '#34C759';

    return (
      <View style={styles.row}>
        <Image source={{ uri: item.profileImage }} style={styles.avatar} />

        <View style={styles.info}>
          <Text style={styles.name}>{item.name}</Text>
          <View style={styles.subRow}>
            <Feather
              name={
                item.callType === 'incoming'
                  ? 'arrow-down-left'
                  : item.callType === 'outgoing'
                  ? 'arrow-up-right'
                  : 'phone-missed'
              }
              size={14}
              color={callIconColor}
            />
            <Text style={styles.subText}>
              {item.date}, {item.time}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity>
            <Feather name="phone" size={20} color="#8E8E93" />
          </TouchableOpacity>
          <TouchableOpacity style={{ marginLeft: 16 }}>
            <Feather name="video" size={20} color="#8E8E93" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.fixedHeader}>
        <TouchableOpacity style={styles.searchIcon}>
          <Feather name="search" size={22} color="#FFF" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Calls</Text>

        <TouchableOpacity>
          <Feather name="phone-call" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* List */}

      <View style={styles.sheet}>
        <Text style={styles.recent}>Recent</Text>
        <FlatList
          data={CallsJson}
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
    height: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
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
    paddingTop: 16,
  },
  recent: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  subText: {
    fontSize: 13,
    color: '#8E8E93',
    marginLeft: 6,
  },
  actions: {
    flexDirection: 'row',
  },
  fixedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 100,
    backgroundColor: '#000',
  },
  searchIcon: {
    height: 40,
    width: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
 
});
