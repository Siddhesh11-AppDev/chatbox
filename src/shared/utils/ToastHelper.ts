import Toast from 'react-native-toast-message';

/**
 * Toast message types
 */
export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Toast configuration interface
 */
interface ToastConfig {
  type: ToastType;
  text1: string;
  text2?: string;
  visibilityTime?: number;
  autoHide?: boolean;
  position?: 'top' | 'bottom';
}

/**
 * Predefined toast messages for common actions
 */
export const ToastMessages = {
  // Authentication messages
  SIGNIN_SUCCESS: {
    type: 'success' as ToastType,
    text1: 'Success!',
    text2: 'You have been signed in successfully.',
  },
  SIGNUP_SUCCESS: {
    type: 'success' as ToastType,
    text1: 'Account Created!',
    text2: 'Your account has been created successfully.',
  },
  LOGOUT_SUCCESS: {
    type: 'success' as ToastType,
    text1: 'Logged Out',
    text2: 'You have been logged out successfully.',
  },
  AUTH_ERROR: {
    type: 'error' as ToastType,
    text1: 'Authentication Failed',
    text2: 'Please check your credentials and try again.',
  },
  EMAIL_EXISTS: {
    type: 'error' as ToastType,
    text1: 'Email Already Exists',
    text2: 'An account with this email already exists.',
  },
  INVALID_CREDENTIALS: {
    type: 'error' as ToastType,
    text1: 'Invalid Credentials',
    text2: 'Email or password is incorrect.',
  },
  WEAK_PASSWORD: {
    type: 'error' as ToastType,
    text1: 'Weak Password',
    text2: 'Password should be at least 6 characters.',
  },

  // General success messages
  SUCCESS: {
    type: 'success' as ToastType,
    text1: 'Success!',
    text2: 'Operation completed successfully.',
  },
  OPERATION_SUCCESS: {
    type: 'success' as ToastType,
    text1: 'Success!',
    text2: 'Your request was processed successfully.',
  },

  // Error messages
  ERROR: {
    type: 'error' as ToastType,
    text1: 'Error!',
    text2: 'Something went wrong. Please try again.',
  },
  NETWORK_ERROR: {
    type: 'error' as ToastType,
    text1: 'Network Error',
    text2: 'Please check your internet connection.',
  },
  SERVER_ERROR: {
    type: 'error' as ToastType,
    text1: 'Server Error',
    text2: 'Server is not responding. Please try again later.',
  },

  // Warning messages
  WARNING: {
    type: 'warning' as ToastType,
    text1: 'Warning',
    text2: 'Please check the information provided.',
  },
  VALIDATION_ERROR: {
    type: 'warning' as ToastType,
    text1: 'Validation Error',
    text2: 'Please fill all required fields correctly.',
  },

  // Info messages
  INFO: {
    type: 'info' as ToastType,
    text1: 'Information',
    text2: 'Please note the following information.',
  },
  LOADING: {
    type: 'info' as ToastType,
    text1: 'Processing',
    text2: 'Please wait...',
  },
  NO_INTERNET: {
    type: 'info' as ToastType,
    text1: 'No Internet',
    text2: 'You are currently offline.',
  },
};

/**
 * Toast helper class for showing different types of toast messages
 */
export class ToastHelper {
  /**
   * Show a custom toast message
   * @param config Toast configuration
   */
  static show(config: ToastConfig): void {
    Toast.show({
      type: config.type,
      text1: config.text1,
      text2: config.text2,
      visibilityTime: config.visibilityTime || 3000,
      autoHide: config.autoHide !== undefined ? config.autoHide : true,
      position: config.position || 'top',
      topOffset: 50,
      bottomOffset: 40,
    });
  }

  /**
   * Show success toast
   * @param title Main message title
   * @param message Optional detailed message
   */
  static success(title: string, message?: string): void {
    this.show({
      type: 'success',
      text1: title,
      text2: message,
      visibilityTime: 3000,
    });
  }

  /**
   * Show error toast
   * @param title Main message title
   * @param message Optional detailed message
   */
  static error(title: string, message?: string): void {
    this.show({
      type: 'error',
      text1: title,
      text2: message,
      visibilityTime: 4000,
    });
  }

  /**
   * Show warning toast
   * @param title Main message title
   * @param message Optional detailed message
   */
  static warning(title: string, message?: string): void {
    this.show({
      type: 'warning',
      text1: title,
      text2: message,
      visibilityTime: 3500,
    });
  }

  /**
   * Show info toast
   * @param title Main message title
   * @param message Optional detailed message
   */
  static info(title: string, message?: string): void {
    this.show({
      type: 'info',
      text1: title,
      text2: message,
      visibilityTime: 3000,
    });
  }

  /**
   * Show predefined authentication success message
   */
  static showSigninSuccess(): void {
    this.show(ToastMessages.SIGNIN_SUCCESS);
  }

  /**
   * Show predefined signup success message
   */
  static showSignupSuccess(): void {
    this.show(ToastMessages.SIGNUP_SUCCESS);
  }

  /**
   * Show predefined logout success message
   */
  static showLogoutSuccess(): void {
    this.show(ToastMessages.LOGOUT_SUCCESS);
  }

  /**
   * Show predefined authentication error message
   */
  static showAuthError(): void {
    this.show(ToastMessages.AUTH_ERROR);
  }

  /**
   * Show email already exists error
   */
  static showEmailExistsError(): void {
    this.show(ToastMessages.EMAIL_EXISTS);
  }

  /**
   * Show invalid credentials error
   */
  static showInvalidCredentialsError(): void {
    this.show(ToastMessages.INVALID_CREDENTIALS);
  }

  /**
   * Show weak password error
   */
  static showWeakPasswordError(): void {
    this.show(ToastMessages.WEAK_PASSWORD);
  }

  /**
   * Show network error message
   */
  static showNetworkError(): void {
    this.show(ToastMessages.NETWORK_ERROR);
  }

  /**
   * Show server error message
   */
  static showServerError(): void {
    this.show(ToastMessages.SERVER_ERROR);
  }

  /**
   * Show validation error message
   */
  static showValidationError(): void {
    this.show(ToastMessages.VALIDATION_ERROR);
  }

  /**
   * Show loading/info message
   */
  static showLoading(message: string = 'Processing...'): void {
    this.show({
      type: 'info',
      text1: 'Please Wait',
      text2: message,
      visibilityTime: 2000,
      autoHide: false,
    });
  }

  /**
   * Hide all toast messages
   */
  static hide(): void {
    Toast.hide();
  }
}

export default ToastHelper;