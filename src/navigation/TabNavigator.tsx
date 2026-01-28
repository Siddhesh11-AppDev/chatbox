import { StyleSheet, Text, View } from 'react-native';
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Messages from '../screens/home/message/Messages';
import Calls from '../screens/home/calls/Calls';
import Contacts from '../screens/home/contacts/Contacts';
import Settings from '../screens/home/settings/Settings';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import AntDesign from 'react-native-vector-icons/AntDesign';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Feather from 'react-native-vector-icons/Feather';

// Extend the Tab navigator to include the userMsg route
export type AppStackParamList = {
  Messages: undefined;
  Calls: undefined;
  Contacts: undefined;
  Settings: undefined;
  userMsg: { userData: any };
};

const Tab = createBottomTabNavigator<AppStackParamList>();

/* ---------- Tab Icon Component ---------- */
const TabIcon = ({ IconComponent, iconName, label, focused }: any) => {
  const color = focused ? '#53B175' : '#797C7B';

  return (
    <View style={styles.iconContainer}>
      <IconComponent name={iconName} size={24} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
};

const TabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
      }}
    >
      <Tab.Screen
        name="Messages"
        component={Messages}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon
              label="Messages"
              IconComponent={AntDesign}
              iconName="message1"
              focused={focused}
            />
          ),
        }}
      />

      <Tab.Screen
        name="Calls"
        component={Calls}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon
              label="Calls"
              IconComponent={Feather}
              iconName="phone-call"
              focused={focused}
            />
          ),
        }}
      />

      <Tab.Screen
        name="Contacts"
        component={Contacts}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon
              label="Contacts"
              IconComponent={FontAwesome}
              iconName="user-circle-o"
              focused={focused}
            />
          ),
        }}
      />

      <Tab.Screen
        name="Settings"
        component={Settings}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon
              label="Settings"
              IconComponent={Ionicons}
              iconName="settings-outline"
              focused={focused}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default TabNavigator;

const styles = StyleSheet.create({
  tabBar: {
    height: 70,
    paddingTop: 20,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },

  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    // gap: 10,
  },

  icon: {
    width: 24,
    height: 24,
    marginBottom: 4,
    resizeMode: 'contain',
  },

  label: {
    fontSize: 12,
    fontWeight: '500',
  },
});