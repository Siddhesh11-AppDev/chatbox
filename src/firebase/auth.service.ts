import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from '@react-native-firebase/auth';
import { getFirestore, doc, setDoc } from '@react-native-firebase/firestore';
import { COLLECTIONS } from './collection';

interface SignUpCredentials {
    name: string;
    email: string;
    password: string;
}

interface SignInCredentials {
    email: string;
    password: string;
}

interface UserResponse {
    uid: string;
    email: string | null;
    name: string | null;
}

class AuthService {
    private auth = getAuth();

    async signUp(credentials: SignUpCredentials): Promise<UserResponse> {
        try {
            // Create user with email and password
            const userCredential = await createUserWithEmailAndPassword(
                this.auth,
                credentials.email,
                credentials.password
            );

            const user = userCredential.user;

            // Update user profile with display name
            await updateProfile(user, {
                displayName: credentials.name,
            });

            // Store user data in Firestore
            const firestore = getFirestore();
            await setDoc(doc(firestore, COLLECTIONS.USERS, user.uid), {
                name: credentials.name,
                email: credentials.email,
                createdAt: new Date(),
                uid: user.uid,
            });

            return {
                uid: user.uid,
                email: user.email,
                name: user.displayName || credentials.name,
            };
        } catch (error: any) {
            throw new Error(this.getErrorMessage(error));
        }
    }

    async signIn(credentials: SignInCredentials): Promise<UserResponse> {
        try {
            const userCredential = await signInWithEmailAndPassword(
                this.auth,
                credentials.email,
                credentials.password
            );

            const user = userCredential.user;

            return {
                uid: user.uid,
                email: user.email,
                name: user.displayName || '',
            };
        } catch (error: any) {
            throw new Error(this.getErrorMessage(error));
        }
    }

    signOut(): Promise<void> {
        return this.auth.signOut();
    }

    getCurrentUser() {
        return this.auth.currentUser;
    }

    private getErrorMessage(error: any): string {
        switch (error.code) {
            case 'auth/email-already-in-use':
                return 'This email is already in use. Please use a different email.';
            case 'auth/invalid-email':
                return 'Please enter a valid email address.';
            case 'auth/weak-password':
                return 'Password is too weak. Please use at least 6 characters.';
            case 'auth/network-request-failed':
                return 'Network error. Please check your connection.';
            default:
                return error.message || 'An error occurred. Please try again.';
        }
    }
}

export const authService = new AuthService();