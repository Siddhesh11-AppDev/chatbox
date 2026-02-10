import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { 
  RTCPeerConnection, 
  RTCSessionDescription, 
  RTCIceCandidate,
  MediaStream
} from 'react-native-webrtc';

export class FirebaseWebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private callDoc: FirebaseFirestoreTypes.DocumentReference | null = null;
  
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private unsubscribeListeners: Array<() => void> = [];
  
  private configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  };

  constructor(private callId: string, private currentUserId: string) {}

  async initialize() {
    // Create call document in Firestore
    this.callDoc = firestore().collection('calls').doc(this.callId);
    
    await this.callDoc.set({ 
      createdAt: firestore.FieldValue.serverTimestamp(),
      initiatedBy: this.currentUserId
    });
    
    await this.createPeerConnection();
    this.setupFirebaseListeners();
  }

  private async createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.configuration);

    // Initialize remote stream
    this.remoteStream = new MediaStream();

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.callDoc) {
        // Add ICE candidate to Firestore
        // We'll save all candidates to a unified collection since we can distinguish by sender
        this.callDoc.collection('iceCandidates').add({
          ...event.candidate.toJSON(),
          from: this.currentUserId,
          timestamp: firestore.FieldValue.serverTimestamp()
        }).catch(error => {
          console.error('Error adding ICE candidate to Firestore:', error);
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => {
        this.remoteStream?.addTrack(track);
      });
      console.log('Remote track added');
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection?.connectionState);
      if (this.peerConnection?.connectionState === 'disconnected' || 
          this.peerConnection?.connectionState === 'failed') {
        this.cleanup();
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.peerConnection?.iceConnectionState);
    };
  }

  private setupFirebaseListeners() {
    if (!this.callDoc) return;

    // Listen for all ICE candidates
    const unsubscribeIceCandidates = this.callDoc.collection('iceCandidates').onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.from !== this.currentUserId) {
            try {
              const candidate = new RTCIceCandidate({
                candidate: data.candidate,
                sdpMid: data.sdpMid,
                sdpMLineIndex: data.sdpMLineIndex
              });
              await this.peerConnection?.addIceCandidate(candidate);
            } catch (error) {
              console.error('Error adding ICE candidate:', error);
            }
          }
        }
      });
    });

    // Listen for offer
    const unsubscribeOffers = this.callDoc.collection('offers').onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.offer && data.from !== this.currentUserId) {
            try {
              const offer = new RTCSessionDescription(data.offer);
              console.log('Received offer from:', data.from);
              await this.peerConnection?.setRemoteDescription(offer);
              
              // Create answer
              const answer = await this.peerConnection?.createAnswer();
              if (answer) {
                await this.peerConnection?.setLocalDescription(answer);
                
                // Save answer to Firestore
                await this.callDoc?.collection('answers').add({
                  answer: answer.toJSON(),
                  from: this.currentUserId,
                  timestamp: firestore.FieldValue.serverTimestamp()
                }).catch(error => {
                  console.error('Error saving answer to Firestore:', error);
                });
              }
            } catch (error) {
              console.error('Error handling offer:', error);
            }
          }
        }
      });
    });

    // Listen for answers
    const unsubscribeAnswers = this.callDoc.collection('answers').onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.answer && data.from !== this.currentUserId) {
            try {
              const answer = new RTCSessionDescription(data.answer);
              await this.peerConnection?.setRemoteDescription(answer);
              console.log('Remote description set (answer)');
            } catch (error) {
              console.error('Error setting remote description:', error);
            }
          }
        }
      });
    });

    // Store unsubscribe functions for cleanup
    this.unsubscribeListeners = [
      unsubscribeIceCandidates,
      unsubscribeOffers,
      unsubscribeAnswers
    ];
  }

  async createOffer() {
    if (!this.peerConnection) return;

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      // Save offer to Firestore
      await this.callDoc?.collection('offers').add({
        offer: offer.toJSON(),
        from: this.currentUserId,
        timestamp: firestore.FieldValue.serverTimestamp()
      }).catch(error => {
        console.error('Error saving offer to Firestore:', error);
        throw error;
      });
      
      console.log('Offer created and sent');
    } catch (error) {
      console.error('Error creating offer:', error);
      throw error;
    }
  }

  // No need for createAnswer method since we handle it in the offer listener
  // The receiver automatically creates and sends answer when receiving an offer

  async addLocalStream(stream: MediaStream) {
    this.localStream = stream;
    if (this.peerConnection) {
      stream.getTracks().forEach(track => {
        this.peerConnection!.addTrack(track, stream);
      });
    }
  }

  getRemoteStream() {
    return this.remoteStream;
  }

  getLocalStream() {
    return this.localStream;
  }

  private cleanup() {
    // Unsubscribe all listeners
    this.unsubscribeListeners.forEach(unsubscribe => unsubscribe());
    this.unsubscribeListeners = [];

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }

  async endCall() {
    this.cleanup();
    
    // Clean up Firestore documents
    if (this.callDoc) {
      try {
        // Delete all subcollections first
        const collections = ['offers', 'answers', 'iceCandidates'];
        for (const collection of collections) {
          const docsQuery = await this.callDoc.collection(collection).get();
          const deletePromises = docsQuery.docs.map(doc => doc.ref.delete());
          await Promise.all(deletePromises);
        }
        // Then delete the main document
        await this.callDoc.delete();
      } catch (error) {
        console.error('Error cleaning up call document:', error);
      }
    }
  }
}