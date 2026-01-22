import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import React from 'react';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import AppTextInput from '../../components/AppTextInput';
import AppButton from '../../components/AppButton';

const Signup = () => {
  const navigation = useNavigation();

  return (
    <View style={{ flex: 1, backgroundColor: '#FFF', paddingHorizontal: 20 }}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
      <TouchableOpacity
        style={{
          marginTop: 40,
          width: '12%',
          height: '5%',
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="arrow-left" size={28} onPress={() => navigation.goBack()} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <View
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            gap: 10,
            marginTop: 50,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '600' }}>
            Sign up with <Text>Email</Text>
          </Text>
          <Text style={{ fontSize: 16, color: '#797C7B', textAlign: 'center' }}>
            Get chatting with friends and family today by signing up for our
            chat app!
          </Text>
        </View>

        <View style={{ marginVertical: '20%' }}>
          <Text style={{ color: '#24786D', fontWeight: 500 }}>Your Name</Text>
          <AppTextInput />
          <Text style={{ color: '#24786D', fontWeight: 500 }}>Your Email</Text>
          <AppTextInput />
          <Text style={{ color: '#24786D', fontWeight: 500 }}>Password</Text>
          <AppTextInput />
          <Text style={{ color: '#24786D', fontWeight: 500 }}>
            Confirm Password
          </Text>
          <AppTextInput />
        </View>

        <AppButton
          title="Create an account"
          onPress={() => {}}
          backgroundColor="#24786D"
          textColor="#FFF"
        />
      </View>
    </View>
  );
};

export default Signup;

const styles = StyleSheet.create({});
