import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../core/context/AuthContext';
import { callHistoryService } from '../../core/services/callHistory.service';
import { CallHistoryItem } from '../chat/UserMessage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../core/navigation/AppNavigator';

type CallsNavigationProp = NativeStackNavigationProp<
  AppStackParamList,
  'userMsg'
>;

export default function Calls() {
  const navigation = useNavigation<CallsNavigationProp>();
  const { user } = useAuth();
  const [callHistory, setCallHistory] = useState<CallHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load call history
  useEffect(() => {
    if (!user) return;

    const loadCallHistory = async () => {
      try {
        const history = await callHistoryService.getCallHistory(user.uid, 30);
        setCallHistory(history);
      } catch (error) {
        console.error('Error loading call history:', error);
      }
    };

    loadCallHistory();

    // Listen for real-time updates
    const unsubscribe = callHistoryService.listenToCallHistory(
      user.uid,
      setCallHistory,
    );

    return () => unsubscribe();
  }, [user]);

  // Call History Helpers
  const getCallIcon = (callType: 'audio' | 'video', callStatus: string, isCurrentUserCaller?: boolean) => {
    if (callStatus === 'missed') return 'phone-missed';
    if (callStatus === 'rejected') return 'phone-missed';
    if (callStatus === 'outgoing' || (callStatus === 'completed' && isCurrentUserCaller === true)) {
      return callType === 'audio' ? 'arrow-up-right' : 'arrow-up-right';
    }
    if (callStatus === 'received' || (callStatus === 'completed' && (isCurrentUserCaller === false || isCurrentUserCaller === undefined))) {
      return callType === 'audio' ? 'arrow-down-left' : 'arrow-down-left';
    }
    return callType === 'audio' ? 'phone' : 'video';
  };

  const getCallIconColor = (callStatus: string, isCurrentUserCaller?: boolean) => {
    if (callStatus === 'missed' || callStatus === 'rejected') return '#FF3B30';
    if (callStatus === 'outgoing' || (callStatus === 'completed' && isCurrentUserCaller === true)) return '#34C759';
    return '#34C759';
  };

  const formatCallTime = (timestamp: any) => {
    if (!timestamp) return '';
    let date: Date;
    if (timestamp.toDate) date = timestamp.toDate();
    else if (timestamp instanceof Date) date = timestamp;
    else if (timestamp._seconds) date = new Date(timestamp._seconds * 1000);
    else return '';

    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatCallDate = (timestamp: any) => {
    if (!timestamp) return '';
    let date: Date;
    if (timestamp.toDate) date = timestamp.toDate();
    else if (timestamp instanceof Date) date = timestamp;
    else if (timestamp._seconds) date = new Date(timestamp._seconds * 1000);
    else return '';

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getCallStatusText = (callStatus: string, callType: string, isCurrentUserCaller?: boolean) => {
    if (callStatus === 'missed') return 'Missed call';
    if (callStatus === 'rejected') return 'Rejected call';
    if (callStatus === 'outgoing' || (callStatus === 'completed' && isCurrentUserCaller === true)) return `Outgoing ${callType} call`;
    if (callStatus === 'received' || (callStatus === 'completed' && (isCurrentUserCaller === false || isCurrentUserCaller === undefined))) return `Incoming ${callType} call`;
    return `${callType} call`;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  };

  const handleCallHistoryItemPress = (callItem: CallHistoryItem) => {
    // Navigate to chat with this user
    const otherUserId =
      callItem.callerId === user?.uid ? callItem.calleeId : callItem.callerId;
    const otherUserName =
      callItem.callerId === user?.uid
        ? callItem.calleeName
        : callItem.callerName;
    const otherUserAvatar =
      callItem.callerId === user?.uid
        ? callItem.calleeAvatar
        : callItem.callerAvatar;

    const userData = {
      uid: otherUserId,
      name: otherUserName,
      profile_image: otherUserAvatar,
    };

    navigation.navigate('userMsg', { userData });
  };

  const handleDeleteCall = (callId: string) => {
    Alert.alert(
      'Delete Call',
      'Are you sure you want to delete this call record?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await callHistoryService.deleteCallRecord(callId);
            } catch (error) {
              Alert.alert('Error', 'Failed to delete call record');
            }
          },
        },
      ],
    );
  };

  const renderCallHistoryItem = ({ item }: { item: CallHistoryItem }) => {
    const isCurrentUserCaller = user ? item.callerId === user.uid : undefined;
    const otherUserName = isCurrentUserCaller
      ? item.calleeName
      : item.callerName;
    const otherUserAvatar = isCurrentUserCaller
      ? item.calleeAvatar
      : item.callerAvatar;

    return (
      <TouchableOpacity
        style={styles.callHistoryRow}
        onPress={() => handleCallHistoryItemPress(item)}
        onLongPress={() => handleDeleteCall(item.id)}
      >
        <View style={styles.callHistoryAvatarContainer}>
          {otherUserAvatar ? (
            <Image source={{ uri: otherUserAvatar }} style={styles.callHistoryAvatar} />
          ) : (
            <View style={styles.callHistoryAvatarPlaceholder}>
              <Text style={styles.callHistoryAvatarText}>
                {otherUserName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.callHistoryInfo}>
          <Text style={styles.callHistoryName}>{otherUserName}</Text>
          <View style={styles.callHistorySubRow}>
            <Feather
              name={getCallIcon(item.callType, item.callStatus, isCurrentUserCaller)}
              size={14}
              color={getCallIconColor(item.callStatus, isCurrentUserCaller)}
            />
            <Text style={styles.callHistoryStatus}>
              {getCallStatusText(item.callStatus, item.callType, isCurrentUserCaller)}
              {item.duration ? ` • ${formatDuration(item.duration)}` : ''}
            </Text>
          </View>
        </View>

        <View style={styles.callHistoryActions}>
          <Text style={styles.callHistoryTime}>
            {formatCallTime(item.timestamp)}
          </Text>
          <TouchableOpacity
            style={styles.callHistoryActionBtn}
            onPress={() => handleDeleteCall(item.id)}
          >
            <Feather name="trash-2" size={16} color="#888" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderCallHistory = () => {
    if (!showHistory || callHistory.length === 0) {
      return (
        <View style={styles.emptyHistory}>
          <Feather name="phone-off" size={48} color="#ccc" />
          <Text style={styles.emptyHistoryText}>No call history yet</Text>
          <Text style={styles.emptyHistorySubtext}>
            Your call records will appear here
          </Text>
        </View>
      );
    }

    // Group calls by date
    const groupedCalls: Record<string, CallHistoryItem[]> = {};
    callHistory.forEach(call => {
      const dateKey = formatCallDate(call.timestamp);
      if (!groupedCalls[dateKey]) {
        groupedCalls[dateKey] = [];
      }
      groupedCalls[dateKey].push(call);
    });

    const sortedDates = Object.keys(groupedCalls).sort((a, b) => {
      if (a === 'Today') return -1;
      if (b === 'Today') return 1;
      if (a === 'Yesterday') return -1;
      if (b === 'Yesterday') return 1;
      return 0;
    });

    return (
      <View style={styles.callHistoryContainer}>
        {sortedDates.map(date => (
          <View key={date}>
            <Text style={styles.callHistoryDateHeader}>{date}</Text>
            {groupedCalls[date].map(call => (
              <View key={call.id}>{renderCallHistoryItem({ item: call })}</View>
            ))}
          </View>
        ))}
      </View>
    );
  };

  const renderCallsList = () => {
    if (showHistory) return null;

    // Show the first 10 recent calls from the call history
    const recentCalls = callHistory.slice(0, 10);

    return (
      <FlatList
        data={recentCalls}
        keyExtractor={item => item.id}
        renderItem={({ item }) => renderCallHistoryItem({ item })}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.fixedHeader}>
          <TouchableOpacity style={styles.searchIcon}>
            <Feather name="search" size={22} color="#FFF" />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Calls</Text>

          <TouchableOpacity onPress={() => setShowHistory(!showHistory)}>
            <Feather
              name={showHistory ? 'clock' : 'phone-call'}
              size={20}
              color="#fff"
            />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.sheet}>
          {showHistory ? (
            renderCallHistory()
          ) : (
            <>
              <Text style={styles.recent}>Recent</Text>
              {renderCallsList()}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
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

  // Toggle Styles
  toggleContainer: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
  },
  toggleButtonActive: {
    backgroundColor: '#18b3a4',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#18b3a4',
    marginLeft: 8,
  },
  toggleTextActive: {
    color: '#fff',
  },

  // Call History Styles
  callHistoryContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  callHistoryDateHeader: {
    fontSize: 13,
    color: '#666',
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    fontWeight: '600',
  },
  callHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  callHistoryAvatarContainer: {
    width: 48,
    height: 48,
    marginRight: 12,
  },
  callHistoryAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  callHistoryAvatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callHistoryAvatarText: {
    fontSize: 20,
    color: '#fff',
    fontWeight: '600',
  },
  callHistoryInfo: {
    flex: 1,
  },
  callHistoryName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  callHistorySubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  callHistoryStatus: {
    fontSize: 13,
    color: '#666',
    marginLeft: 6,
  },
  callHistoryActions: {
    alignItems: 'flex-end',
  },
  callHistoryTime: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  callHistoryActionBtn: {
    padding: 4,
  },
  emptyHistory: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyHistoryText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
    fontWeight: '600',
  },
  emptyHistorySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
  },
});
