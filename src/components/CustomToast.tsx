import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Colors } from '../theme/Colors';

/**
 * Custom Toast Component
 * Provides styled toast messages with icons
 */

interface ToastProps {
  type: 'success' | 'error' | 'info' | 'warning';
  text1?: string;
  text2?: string;
  onPress?: () => void;
  hide?: () => void;
  props?: any;
}

const CustomToast: React.FC<ToastProps> = ({ type, text1 = '', text2 = '', onPress, hide, props }) => {
  const getToastStyle = () => {
    switch (type) {
      case 'success':
        return {
          container: styles.successContainer,
          icon: 'check-circle',
          iconColor: Colors.success,
          titleColor: Colors.success,
        };
      case 'error':
        return {
          container: styles.errorContainer,
          icon: 'error',
          iconColor: Colors.error,
          titleColor: Colors.error,
        };
      case 'warning':
        return {
          container: styles.warningContainer,
          icon: 'warning',
          iconColor: Colors.warning,
          titleColor: Colors.warning,
        };
      case 'info':
      default:
        return {
          container: styles.infoContainer,
          icon: 'info',
          iconColor: Colors.primary,
          titleColor: Colors.primary,
        };
    }
  };

  const toastStyle = getToastStyle();

  return (
    <TouchableOpacity 
      style={[styles.container, toastStyle.container]} 
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.content}>
        <Icon 
          name={toastStyle.icon} 
          size={24} 
          color={toastStyle.iconColor} 
          style={styles.icon}
        />
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: toastStyle.titleColor }]} numberOfLines={1}>
            {text1}
          </Text>
          {text2 ? (
            <Text style={styles.message} numberOfLines={2}>
              {text2}
            </Text>
          ) : null}
        </View>
      </View>
      {hide && (
        <TouchableOpacity onPress={hide} style={styles.closeButton}>
          <Icon name="close" size={18} color="#666" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    // marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
    minWidth: 380,
    maxWidth: '100%',
  },
  content: {
    flexDirection: 'row',
    flex: 1,
    alignItems: 'center',
  },
  icon: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  message: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  closeButton: {
    padding: 4,
    marginLeft: 8,
  },
  // Type-specific styles
  successContainer: {
    backgroundColor: '#E8F5E9',
    borderLeftWidth: 4,
    borderLeftColor: Colors.success,
  },
  errorContainer: {
    backgroundColor: '#FFEBEE',
    borderLeftWidth: 4,
    borderLeftColor: Colors.error,
  },
  warningContainer: {
    backgroundColor: '#FFF8E1',
    borderLeftWidth: 4,
    borderLeftColor: Colors.warning,
  },
  infoContainer: {
    backgroundColor: '#E3F2FD',
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
});

export default CustomToast;