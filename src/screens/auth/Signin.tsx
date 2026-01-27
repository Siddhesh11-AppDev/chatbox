import {
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import AppTextInput from '../../components/AppTextInput';
import AppButton from '../../components/AppButton';
import { Images } from '../../assets/images';
import { authService } from '../../firebase/auth.service';

const Signin = () => {
  const navigation = useNavigation();

  // State for form fields
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  // State for errors
  const [errors, setErrors] = useState({
    email: '',
    password: '',
  });

  // Loading state
  const [loading, setLoading] = useState(false);

  // Handle input changes
  const handleInputChange = (field: keyof typeof formData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));

    // Clear error when user starts typing
    if (errors[field as keyof typeof errors]) {
      setErrors(prev => ({
        ...prev,
        [field]: '',
      }));
    }
  };

  // Validate email format
  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Validate form
  const validateForm = () => {
    let isValid = true;
    const newErrors = {
      email: '',
      password: '',
    };

    // Validate email
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
      isValid = false;
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
      isValid = false;
    }

    // Validate password
    if (!formData.password) {
      newErrors.password = 'Password is required';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  // Handle login
  const handleLogin = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      // Call Firebase login service
      await authService.signIn({
        email: formData.email,
        password: formData.password,
      });

      // Navigation is handled automatically by the AuthContext
      // The user will be redirected to TabNavigator
    } catch (error: any) {
      console.error('Login Error:', error);
      Alert.alert(
        'Error',
        error.message || 'An error occurred during login. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoToSignup = () => {
    navigation.navigate('Signup' as never);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#FFF' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, flex: 1 }}>
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
            onPress={() => navigation.goBack()}
          >
            <Icon name="arrow-left" size={28} />
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
              <AppTextInput
                value={formData.email}
                onChangeText={(text) => handleInputChange('email', text)}
                placeholder="Enter your email"
                keyboardType="email-address"
                autoCapitalize="none"
                error={errors.email}
              />
              <Text style={{ color: '#24786D', fontWeight: 500 }}>Password</Text>
              <AppTextInput
                value={formData.password}
                onChangeText={(text) => handleInputChange('password', text)}
                placeholder="Enter your password"
                secureTextEntry
                error={errors.password}
              />
            </View>
            
            <View style={{ marginBottom: 20 }}>
              <AppButton
                title={loading ? "Logging In..." : "Log in"}
                onPress={handleLogin}
                backgroundColor="#24786D"
                textColor="#FFF"
                disabled={loading}
              />
              <TouchableOpacity
                style={{
                  marginTop: 20,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
                onPress={handleGoToSignup}
              >
                <Text style={{ fontWeight: 600, color: '#24786D' }}>
                  Don't have an account? Sign up
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  marginTop: 10,
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
      </ScrollView>
    </KeyboardAvoidingView>
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