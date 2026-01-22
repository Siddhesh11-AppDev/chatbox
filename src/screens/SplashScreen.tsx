import { Image, StatusBar, StyleSheet, Text, View } from 'react-native';
import React, { useEffect } from 'react';
import { Images } from '../assets/images';
import { Colors } from '../theme/Colors';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppStackParamList } from '../navigation/AppNavigator';

type SplashScreenNavigationProp = NativeStackNavigationProp<
  AppStackParamList,
  'Splash'
>;

const SplashScreen = () => {
  const navigation = useNavigation<SplashScreenNavigationProp>();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('OnBoard' as never);
    }, 1500);

    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Colors.whiteFF,
      }}
    >
      <StatusBar barStyle="dark-content" backgroundColor={Colors.whiteFF} />
      <Image
        source={Images.Logo}
        style={{ width: 150, height: 150, resizeMode: 'contain' }}
      />
    </View>
  );
};

export default SplashScreen;

const styles = StyleSheet.create({});
