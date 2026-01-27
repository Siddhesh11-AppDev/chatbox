import {
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import React from 'react';
import { Images } from '../assets/images';
import AppButton from '../components/AppButton';
import { useNavigation } from '@react-navigation/native';

const OnBoarding = () => {
  const navigation = useNavigation();

  const handleSignUp = () => {
    navigation.navigate('Auth' as never);
  };

  const handleLogin = () => {
    navigation.navigate('Auth' as never, { screen: 'Signin' as never });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Background Image */}
      <Image source={Images.LinearImg} style={styles.bgImage} />

      {/* Overlay */}
      <View style={styles.overlay}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Image source={Images.LogoTop} style={styles.logo} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          <Text style={styles.title}>
            Connect friends
            <Text style={styles.titleBold}> easily & quickly</Text>
          </Text>

          <Text style={styles.subtitle}>
            Our chat app is the perfect way to stay connected with friends and
            family.
          </Text>

          {/* Social Buttons */}
          <View style={styles.socialRow}>
            <TouchableOpacity style={styles.socialIcon}>
              <Image source={Images.FacebookImg} style={styles.socialImage} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialIcon}>
              <Image source={Images.GoogleImg} style={styles.socialImage} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialIcon}>
              <Image source={Images.AppleImg} style={styles.socialImage} />
            </TouchableOpacity>
          </View>

          {/* OR Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.orText}>OR</Text>
            <View style={styles.divider} />
          </View>

          {/* Button */}
          <View style={styles.buttonWrapper}>
            <AppButton
              title="Sign up with mail"
              backgroundColor="#FFF"
              onPress={handleSignUp}
            />
          </View>

          {/* Login */}
          <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
            <Text style={styles.loginText}>Existing account? Log in</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default OnBoarding;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  bgImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },

  overlay: {
    zIndex: 1,
    position: 'absolute',
    marginTop: 20,
  },

  logoContainer: {
    height: '14%',
    justifyContent: 'center',
    alignItems: 'center',
  },

  logo: {
    width: '30%',
    height: '30%',
    resizeMode: 'contain',
  },

  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'flex-end',
    paddingBottom: 40,
  },

  title: {
    color: '#fff',
    fontSize: 68,
    fontWeight: '400',
    lineHeight: 70,
  },

  titleBold: {
    fontWeight: '600',
  },

  subtitle: {
    color: '#B9C1BE',
    fontSize: 18,
    lineHeight: 28,
    marginTop: 20,
  },

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
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },

  socialImage: {
    width: 24,
    height: 24,
    resizeMode: 'contain',
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 40,
  },

  divider: {
    flex: 1,
    height: 1,
    backgroundColor: '#CDD1D0',
  },

  orText: {
    color: '#D6E4E0',
    marginHorizontal: 12,
    fontSize: 18,
  },

  buttonWrapper: {
    marginTop: 30,
  },

  loginBtn: {
    alignItems: 'center',
    marginTop: 50,
  },

  loginText: {
    color: '#fff',
    fontSize: 18,
  },
});