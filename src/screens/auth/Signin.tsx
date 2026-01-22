import {
  Image,
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
import { Images } from '../../assets/images';

const Signin = () => {
  const navigation = useNavigation();

  const handleLogin=()=>{
    navigation.navigate('Tab' as never)
  }

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
            marginHorizontal: 10,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '600' }}>
            Log in to <Text>Chatbox</Text>
          </Text>
          <Text style={{ fontSize: 16, color: '#797C7B', textAlign: 'center' }}>
            Welcome back! Sign in using your social account or email to continue
            us
          </Text>
        </View>
        <View style={styles.socialRow}>
          <TouchableOpacity style={styles.socialIcon}>
            <Image source={Images.FacebookImg} style={styles.socialImage} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.socialIcon}>
            <Image source={Images.GoogleImg} style={styles.socialImage} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.socialIcon}>
            <Image source={Images.AppleBlack} style={styles.socialImage} />
          </TouchableOpacity>
        </View>

        <View style={{ marginVertical: '20%' }}>
          <Text style={{ color: '#24786D', fontWeight: 500 }}>Your Email</Text>
          <AppTextInput />
          <Text style={{ color: '#24786D', fontWeight: 500 }}>Password</Text>
          <AppTextInput />
        </View>
        <View style={{ position: 'absolute', bottom: 50, width: '100%' }}>
          <AppButton
            title="Log in"
            onPress={() => {handleLogin()}}
            backgroundColor="#24786D"
            textColor="#FFF"
          />
          <TouchableOpacity
            style={{
              marginTop: 20,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontWeight: 600, color: '#24786D' }}>
              Forgot Password?
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default Signin;

const styles = StyleSheet.create({
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 30,
    marginTop: 40,
  },

  socialIcon: {
    height: 50,
    width: 50,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  socialImage: {
    width: 24,
    height: 24,
    resizeMode: 'contain',
  },
});
