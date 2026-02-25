import firestore from '@react-native-firebase/firestore';
import { COLLECTIONS } from './collection';

export interface Contact {
  uid: string;
  name: string;
  email: string;
  profile_image?: string;
  online?: boolean;
  status?: string;
  phone?: string;
}

class ContactService {
  private firestore = firestore();

  /**
   * Fetch all users except the current user
   * @param currentUserId - The ID of the currently logged in user
   * @returns Promise<Contact[]> - Array of contact objects
   */
  async getAllContacts(currentUserId: string): Promise<Contact[]> {
    try {
      const usersRef = this.firestore.collection(COLLECTIONS.USERS);
      const snapshot = await usersRef.get();
      
      if (snapshot.empty) {
        return [];
      }

      const contacts: Contact[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        // Exclude current user
        if (data.uid !== currentUserId) {
          contacts.push({
            uid: data.uid,
            name: data.name || '',
            email: data.email || '',
            profile_image: data.profile_image || '',
            online: !!data.online,
            status: data.status || 'Available',
            phone: data.phone || '',
          });
        }
      });

      return contacts.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error('Error fetching contacts:', error);
      throw error;
    }
  }

  /**
   * Listen to real-time updates for all contacts
   * @param currentUserId - The ID of the currently logged in user
   * @param callback - Function to call when contacts update
   * @returns Unsubscribe function
   */
  listenToContacts(currentUserId: string, callback: (contacts: Contact[]) => void) {
    try {
      return this.firestore
        .collection(COLLECTIONS.USERS)
        .onSnapshot(
          (snapshot) => {
            const contacts: Contact[] = [];
            snapshot.forEach((doc) => {
              const data = doc.data();
              if (data.uid !== currentUserId) {
                contacts.push({
                  uid: data.uid,
                  name: data.name || '',
                  email: data.email || '',
                  profile_image: data.profile_image || '',
                  online: !!data.online,
                  status: data.status || 'Available',
                  phone: data.phone || '',
                });
              }
            });
            
            // Sort contacts alphabetically
            const sortedContacts = contacts.sort((a, b) => a.name.localeCompare(b.name));
            callback(sortedContacts);
          },
          (error) => {
            console.error('Error listening to contacts:', error);
            callback([]); // Return empty array on error
          }
        );
    } catch (error) {
      console.error('Error setting up contacts listener:', error);
      return () => {}; // Return empty unsubscribe function
    }
  }

  /**
   * Search contacts by name
   * @param currentUserId - The ID of the currently logged in user
   * @param searchTerm - The search term to filter contacts
   * @returns Promise<Contact[]> - Array of filtered contacts
   */
  async searchContacts(currentUserId: string, searchTerm: string): Promise<Contact[]> {
    try {
      const contacts = await this.getAllContacts(currentUserId);
      if (!searchTerm) return contacts;
      
      const term = searchTerm.toLowerCase();
      return contacts.filter(contact => 
        contact.name.toLowerCase().includes(term) ||
        contact.email.toLowerCase().includes(term)
      );
    } catch (error) {
      console.error('Error searching contacts:', error);
      throw error;
    }
  }

  /**
   * Update user status
   * @param userId - The ID of the user to update
   * @param status - The new status message
   */
  async updateUserStatus(userId: string, status: string): Promise<void> {
    try {
      await this.firestore
        .collection(COLLECTIONS.USERS)
        .doc(userId)
        .update({
          status: status,
        });
    } catch (error) {
      console.error('Error updating user status:', error);
      throw error;
    }
  }

  /**
   * Group contacts by first letter of name for section list
   * @param contacts - Array of contacts to group
   * @returns Grouped contacts object
   */
  groupContactsByAlphabet(contacts: Contact[]): Array<{ title: string; data: Contact[] }> {
    const grouped: Record<string, Contact[]> = {};
    
    contacts.forEach(contact => {
      const firstLetter = contact.name.charAt(0).toUpperCase();
      if (!grouped[firstLetter]) {
        grouped[firstLetter] = [];
      }
      grouped[firstLetter].push(contact);
    });

    return Object.entries(grouped)
      .map(([title, data]) => ({ title, data }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }
}

export const contactService = new ContactService();