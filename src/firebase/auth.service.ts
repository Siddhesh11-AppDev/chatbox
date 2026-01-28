import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut } from '@react-native-firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc } from '@react-native-firebase/firestore';
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

    constructor() {
        
    }

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
                online: true, // Set user as online when they register
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

            // Update user status to online
            const firestore = getFirestore();
            await updateDoc(doc(firestore, COLLECTIONS.USERS, user.uid), {
                online: true,
            });

            return {
                uid: user.uid,
                email: user.email,
                name: user.displayName || '',
            };
        } catch (error: any) {
            throw new Error(this.getErrorMessage(error));
        }
    }

    async signOut(): Promise<void> {
        try {
            // Update user status to offline before signing out
            const user = this.getCurrentUser();
            if (user) {
                const firestore = getFirestore();
                await updateDoc(doc(firestore, COLLECTIONS.USERS, user.uid), {
                    online: false,
                });
            }
            
            await signOut(this.auth);
        } catch (error) {
            console.error('Sign out error:', error);
            await signOut(this.auth); // Try to sign out anyway
        }
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
            case 'auth/user-not-found':
                return 'No user found with this email.';
            case 'auth/wrong-password':
                return 'Incorrect password.';
            default:
                return error.message || 'An error occurred. Please try again.';
        }
    }
}

export const authService = new AuthService();