import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import AppTextInput from '../../shared/components/AppTextInput';
import AppButton from '../../shared/components/AppButton';
import { authService } from '../../core/services/auth.service';
import { ToastHelper } from '../../shared/utils/ToastHelper';
import { SafeAreaView } from 'react-native-safe-area-context';

const Signup = () => {
  const navigation = useNavigation();

  // State for form fields
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  // State for errors
  const [errors, setErrors] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
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

  // Validate password strength
  const validatePassword = (password: string) => {
    // Minimum 6 characters, at least one letter and one number
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{6,}$/;
    return passwordRegex.test(password);
  };

  // Validate form
  const validateForm = () => {
    let isValid = true;
    const newErrors = {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    };

    // Validate name
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
      isValid = false;
    }

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
    } else if (!validatePassword(formData.password)) {
      newErrors.password = 'Password must be at least 6 characters with letters and numbers';
      isValid = false;
    }

    // Validate confirm password
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
      isValid = false;
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  // Handle signup
  const handleSignup = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      // Call Firebase signup service
      const userData = await authService.signUp({
        name: formData.name,
        email: formData.email,
        password: formData.password,
      });

      ToastHelper.showSignupSuccess();

      // Navigate directly to Signin page after successful signup
      navigation.navigate('Signin' as never);
    } catch (error: any) {
      console.error('Signup Error:', error);
      
      // Show appropriate error message based on error code
      if (error.code === 'auth/email-already-in-use') {
        ToastHelper.showEmailExistsError();
      } else if (error.code === 'auth/invalid-email') {
        ToastHelper.error('Invalid Email', 'Please enter a valid email address.');
      } else if (error.code === 'auth/weak-password') {
        ToastHelper.showWeakPasswordError();
      } else if (error.code === 'auth/operation-not-allowed') {
        ToastHelper.error('Operation Not Allowed', 'Email/password accounts are not enabled.');
      } else {
        ToastHelper.error('Signup Failed', error.message || 'An error occurred during signup. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoToLogin = () => {
    navigation.navigate('Signin' as never);
  };

  return (
    <SafeAreaView  style={{ flex: 1, backgroundColor: '#FFF' }}>

   
    <KeyboardAvoidingView
      style={{ flex: 1,}}
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
              <AppTextInput
                value={formData.name}
                onChangeText={(text: string) => handleInputChange('name', text)}
                placeholder="Enter your name"
                error={errors.name}
                style={styles.inputStyle}
                autoCapitalize="words"
              />
              
              <Text style={{ color: '#24786D', fontWeight: 500 }}>Your Email</Text>
              <AppTextInput
                value={formData.email}
                onChangeText={(text: string) => handleInputChange('email', text)}
                placeholder="Enter your email"
                keyboardType="email-address"
                autoCapitalize="none"
                error={errors.email}
                style={styles.inputStyle}
              />
              
              <Text style={{ color: '#24786D', fontWeight: 500 }}>Password</Text>
              <AppTextInput
                value={formData.password}
                onChangeText={(text: string) => handleInputChange('password', text)}
                placeholder="Enter your password"
                secureTextEntry
                error={errors.password}
                style={styles.inputStyle}
              />
              
              <Text style={{ color: '#24786D', fontWeight: 500 }}>
                Confirm Password
              </Text>
              <AppTextInput
                value={formData.confirmPassword}
                onChangeText={(text: string) => handleInputChange('confirmPassword', text)}
                placeholder="Confirm your password"
                secureTextEntry
                error={errors.confirmPassword}
                style={styles.inputStyle}
              />
            </View>

            <AppButton
              title={loading ? "Creating Account..." : "Create an account"}
              onPress={handleSignup}
              backgroundColor={loading ? '#9E9E9E' : '#24786D'}
              textColor="#FFF"
              style={styles.buttonStyle}
              textStyle={styles.buttonText}
            />

            <TouchableOpacity
              style={{
                marginTop: 20,
                justifyContent: 'center',
                alignItems: 'center',
              }}
              onPress={handleGoToLogin}
            >
              <Text style={{ fontWeight: 600, color: '#24786D' }}>
                Already have an account? Log in
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
     </SafeAreaView>
  );
};

export default Signup;

const styles = StyleSheet.create({
  inputStyle: {},
  buttonStyle: {},
  buttonText: {},
});