import {
  Dimensions,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import React from 'react';
import { Images } from '../../shared/assets/images';
import AppButton from '../../shared/components/AppButton';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

const OnBoarding = () => {
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();

  const handleSignUp = () => {
    navigation.navigate('Auth' as never);
  };

  const handleLogin = () => {
    navigation.navigate('Auth' as never, { screen: 'Signin' as never });
  };

  // Responsive calculations
  const isSmallDevice = height < 800;
  const isLargeDevice = height > 650;
  
  const logoSize = isSmallDevice ? width * 0.25 : isLargeDevice ? width * 0.35 : width * 0.3;
  const titleSize = isSmallDevice ? 48 : isLargeDevice ? 60 : 58;
  const subtitleSize = isSmallDevice ? 18 : 16;
  const buttonMarginTop = isSmallDevice ? 20 : 40;
  const socialGap = isSmallDevice ? 20 : 30;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Background Image */}
      <Image 
        source={Images.LinearImg} 
        style={[styles.bgImage, { height: height }]} 
      />

      {/* Overlay */}
      <View style={styles.overlay}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Image 
            source={Images.LogoTop} 
            style={[styles.logo, { width: logoSize, height: logoSize }]} 
          />
        </View>

        {/* Content */}
        <View style={styles.content}>
          <Text style={[styles.title, { fontSize: titleSize }]}>
            Connect friends
            <Text style={styles.titleBold}> easily & quickly</Text>
          </Text>

          <Text style={[styles.subtitle, { fontSize: subtitleSize }]}>
            Our chat app is the perfect way to stay connected with friends and
            family.
          </Text>

          {/* Social Buttons */}
          <View style={[styles.socialRow, { gap: socialGap }]}>
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

          {/* Login */}
          <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
            <Text style={styles.loginText}>Existing account? Log in</Text>
          </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView >
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
    position: 'absolute',
    resizeMode: 'cover',
  },

  overlay: {
    flex: 1,
    zIndex: 1,
  },

  logoContainer: {
    alignItems: 'center',
    marginTop: 20,
  },

  logo: {
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
    fontWeight: '400',
    lineHeight: 65,
  },

  titleBold: {
    fontWeight: '600',
  },

  subtitle: {
    color: '#B9C1BE',
    lineHeight: 24,
    marginTop: 20,
  },

  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
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
    fontSize: 14,
  },

  buttonWrapper: {
    marginTop: 30,
  },

  loginBtn: {
    alignItems: 'center',
    marginTop: 30,
  },

  loginText: {
    color: '#fff',
    fontSize: 16,
  },
});