import firestore, { FirebaseFirestoreTypes, serverTimestamp } from '@react-native-firebase/firestore';
import { 
  RTCPeerConnection, 
  RTCSessionDescription, 
  RTCIceCandidate,
  MediaStream
} from 'react-native-webrtc';

interface CallParticipant {
  userId: string;
  joinedAt: FirebaseFirestoreTypes.Timestamp;
  connectionState: string;
  lastPing: FirebaseFirestoreTypes.Timestamp;
}

interface CallDocument {
  callId: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
  initiatedBy: string;
  status: 'waiting' | 'ringing' | 'connected' | 'ended' | 'error';
  participants: Record<string, CallParticipant>;
  endedAt?: FirebaseFirestoreTypes.Timestamp;
}

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
      { urls: 'stun:stun.stunprotocol.org:3478' },
    ]
  };

  constructor(
    private callId: string, 
    private currentUserId: string,
    private onRemoteStream?: (stream: MediaStream) => void,
    private onConnectionStateChange?: (state: string) => void,
    private onError?: (error: string) => void
  ) {}

  async initialize(isCaller: boolean = false) {
    try {
      console.log('Initializing WebRTC service for call:', this.callId);
      
      // Create or get call document in Firestore
      this.callDoc = firestore().collection('calls').doc(this.callId);
      
      // Initialize call document
      const callData: Partial<CallDocument> = {
        callId: this.callId,
        createdAt: serverTimestamp(),
        initiatedBy: isCaller ? this.currentUserId : '',
        status: isCaller ? 'waiting' : 'ringing',
        participants: {
          [this.currentUserId]: {
            userId: this.currentUserId,
            joinedAt: serverTimestamp(),
            connectionState: 'initializing',
            lastPing: serverTimestamp()
          }
        }
      };

      await this.callDoc.set(callData, { merge: true });
      
      // Create peer connection
      await this.createPeerConnection();
      
      // Set up Firestore listeners
      this.setupFirebaseListeners();
      
      // Update participant state
      await this.updateParticipantState('initialized');
      
      console.log('WebRTC service initialized successfully');
    } catch (error) {
      console.error('Error initializing WebRTC service:', error);
      this.onError?.('Failed to initialize call');
      throw error;
    }
  }

  private async createPeerConnection() {
    this.peerConnection = new RTCPeerConnection(this.configuration);

    // Initialize remote stream
    this.remoteStream = new MediaStream();

    // Handle ICE candidates
    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate && this.callDoc) {
        try {
          console.log('Sending ICE candidate');
          await this.callDoc.collection('iceCandidates').add({
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            from: this.currentUserId,
            timestamp: serverTimestamp()
          });
        } catch (error) {
          console.error('Error sending ICE candidate:', error);
        }
      }
    };

    // Handle remote tracks
    this.peerConnection.ontrack = (event) => {
      console.log('Remote track received:', event.track.kind);
      event.streams[0].getTracks().forEach(track => {
        this.remoteStream?.addTrack(track);
      });
      
      this.onRemoteStream?.(this.remoteStream);
      this.updateParticipantState('receiving_media');
    };

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = async () => {
      const state = this.peerConnection?.connectionState || 'unknown';
      console.log('Connection state changed:', state);
      
      this.onConnectionStateChange?.(state);
      await this.updateParticipantState(state);
      
      if (state === 'connected') {
        await this.updateCallStatus('connected');
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.onError?.(`Connection ${state}`);
        await this.endCall();
      }
    };

    // Handle ICE connection state
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      console.log('ICE connection state:', state);
    };

    // Handle signaling state
    this.peerConnection.onsignalingstatechange = () => {
      const state = this.peerConnection?.signalingState;
      console.log('Signaling state:', state);
    };
  }

  private async updateCallStatus(status: CallDocument['status']) {
    if (this.callDoc) {
      try {
        await this.callDoc.update({
          status,
          lastUpdated: serverTimestamp()
        });
      } catch (error) {
        console.error('Error updating call status:', error);
      }
    }
  }

  private async updateParticipantState(state: string) {
    if (this.callDoc) {
      try {
        await this.callDoc.update({
          [`participants.${this.currentUserId}.connectionState`]: state,
          [`participants.${this.currentUserId}.lastPing`]: serverTimestamp(),
          lastUpdated: serverTimestamp()
        });
      } catch (error) {
        console.error('Error updating participant state:', error);
      }
    }
  }

  private setupFirebaseListeners() {
    if (!this.callDoc) return;

    // Listen for call status changes
    const unsubscribeCallStatus = this.callDoc.onSnapshot((doc) => {
      const data = doc.data() as CallDocument | undefined;
      if (data?.status === 'ended') {
        console.log('Call ended by remote participant');
        this.endCall();
      }
    });

    // Listen for ICE candidates
    const unsubscribeIceCandidates = this.callDoc.collection('iceCandidates').onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.from !== this.currentUserId) {
            console.log('Received ICE candidate from:', data.from);
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

    // Listen for offers
    const unsubscribeOffers = this.callDoc.collection('offers').onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.from !== this.currentUserId) {
            console.log('Received offer from:', data.from);
            try {
              await this.handleRemoteOffer(data.offer);
            } catch (error) {
              console.error('Error handling offer:', error);
              this.onError?.('Failed to handle incoming call');
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
          if (data.from !== this.currentUserId) {
            console.log('Received answer from:', data.from);
            try {
              await this.handleRemoteAnswer(data.answer);
            } catch (error) {
              console.error('Error handling answer:', error);
              this.onError?.('Failed to establish connection');
            }
          }
        }
      });
    });

    this.unsubscribeListeners = [
      unsubscribeCallStatus,
      unsubscribeIceCandidates,
      unsubscribeOffers,
      unsubscribeAnswers
    ];
  }

  private async handleRemoteOffer(offer: any) {
    try {
      await this.updateCallStatus('ringing');
      await this.updateParticipantState('handling_offer');
      
      const offerDesc = new RTCSessionDescription(offer);
      await this.peerConnection?.setRemoteDescription(offerDesc);
      
      const answer = await this.peerConnection?.createAnswer();
      if (answer) {
        await this.peerConnection?.setLocalDescription(answer);
        
        // Send answer
        await this.callDoc?.collection('answers').add({
          answer: answer.toJSON(),
          from: this.currentUserId,
          timestamp: serverTimestamp()
        });
        
        await this.updateParticipantState('sent_answer');
      }
    } catch (error) {
      console.error('Error handling remote offer:', error);
      await this.updateParticipantState('offer_error');
      throw error;
    }
  }

  private async handleRemoteAnswer(answer: any) {
    try {
      const answerDesc = new RTCSessionDescription(answer);
      await this.peerConnection?.setRemoteDescription(answerDesc);
      await this.updateParticipantState('connected');
    } catch (error) {
      console.error('Error handling remote answer:', error);
      await this.updateParticipantState('answer_error');
      throw error;
    }
  }

  async createOffer() {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    try {
      await this.updateCallStatus('calling');
      await this.updateParticipantState('creating_offer');
      
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await this.peerConnection.setLocalDescription(offer);
      
      // Send offer via Firestore
      await this.callDoc?.collection('offers').add({
        offer: offer.toJSON(),
        from: this.currentUserId,
        timestamp: serverTimestamp()
      });
      
      await this.updateParticipantState('sent_offer');
      console.log('Offer created and sent successfully');
    } catch (error) {
      console.error('Error creating offer:', error);
      await this.updateParticipantState('offer_error');
      this.onError?.('Failed to initiate call');
      throw error;
    }
  }

  async addLocalStream(stream: MediaStream) {
    this.localStream = stream;
    if (this.peerConnection) {
      stream.getTracks().forEach(track => {
        this.peerConnection!.addTrack(track, stream);
      });
      await this.updateParticipantState('stream_added');
      console.log('Local stream added to peer connection');
    }
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getConnectionState(): string {
    return this.peerConnection?.connectionState || 'unknown';
  }

  async ping() {
    await this.updateParticipantState(this.getConnectionState());
  }

  private cleanup() {
    console.log('Cleaning up WebRTC service');
    
    // Unsubscribe all listeners
    this.unsubscribeListeners.forEach(unsubscribe => unsubscribe());
    this.unsubscribeListeners = [];

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Stop local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.remoteStream = null;
  }

  async endCall() {
    console.log('Ending call');
    
    try {
      await this.updateCallStatus('ended');
      
      // Update participant departure
      if (this.callDoc) {
        await this.callDoc.update({
          [`participants.${this.currentUserId}.leftAt`]: serverTimestamp(),
          endedAt: serverTimestamp()
        });
      }
    } catch (error) {
      console.error('Error ending call:', error);
    }
    
    this.cleanup();
  }
}