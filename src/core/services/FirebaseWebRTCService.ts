

import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
} from 'react-native-webrtc';
import firestore from '@react-native-firebase/firestore';
import { notificationService } from './notification.service';

type CallStatus = 'waiting' | 'ringing' | 'connected' | 'ended' | 'error';

export class FirebaseWebRTCService {
  private pc: RTCPeerConnection | null = null;
  private callDoc: any = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private unsubs: Array<() => void> = [];
  private cleaned = false;
  private offerProcessed = false;
  private answerProcessed = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  private iceConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // Public TURN — replace with your own for production
      { urls: 'turn:openrelay.metered.ca:80',              username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443',             username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
    iceCandidatePoolSize: 10,
  };

  constructor(
    private callId: string,
    private userId: string,
    private onRemoteStream?: (s: MediaStream) => void,
    private onConnectionStateChange?: (state: string) => void,
    private onError?: (err: string) => void,
    private onOfferReceived?: (data: any) => void,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  //  initialize — PC + listeners FIRST, Firestore write second
  // ────────────────────────────────────────────────────────────────────
  async initialize(isCaller: boolean) {
    this.callDoc = firestore().collection('calls').doc(this.callId);
    this.isCallerFlag = isCaller; // Set the caller flag

    // ✅ Build PC and start listening BEFORE the async set() write
    this.buildPeerConnection();
    this.listenFirestore();

    // Now do the Firestore write (slower)
    await this.callDoc.set(
      {
        callId:       this.callId,
        createdAt:    firestore.FieldValue.serverTimestamp(),
        initiatedBy:  isCaller ? this.userId : '',
        status:       isCaller ? 'waiting' : 'ringing',
        participants: {
          [this.userId]: {
            userId:          this.userId,
            joinedAt:        firestore.FieldValue.serverTimestamp(),
            connectionState: 'initializing',
            lastPing:        firestore.FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true },
    );

    this.startPing();
    await this.updateParticipant('initialized');
  }

  async addLocalStream(stream: MediaStream) {
    this.localStream = stream;
    if (!this.pc) return;
    stream.getTracks().forEach(track => this.pc!.addTrack(track, stream));
    await this.updateParticipant('stream_added');
  }

  async createOffer(audioOnly = false) {
    if (!this.pc) throw new Error('PC not ready');
    await this.updateCallStatus('ringing');
    await this.updateParticipant('creating_offer');

    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: !audioOnly,
    });
    await this.pc.setLocalDescription(offer);

    await this.callDoc.collection('offers').add({
      offer:     (offer as any).toJSON(),
      from:      this.userId,
      timestamp: firestore.FieldValue.serverTimestamp(),
    });
    await this.updateParticipant('offer_sent');
  }

  async handleRemoteOffer(offer: any) {
    if (this.offerProcessed) return;
    this.offerProcessed = true;
    if (!this.pc) throw new Error('PC not ready');

    try {
      console.log('Callee: Handling remote offer');
      await this.updateParticipant('handling_offer');
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('Callee: Remote description set');

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      console.log('Callee: Local description set');

      await this.callDoc.collection('answers').add({
        answer: (answer as any).toJSON(),
        from: this.userId,
        timestamp: firestore.FieldValue.serverTimestamp(),
      });

      await this.updateParticipant('answer_sent');
      await this.updateCallStatus('connected');
      console.log('Callee: Answer sent successfully');

      // Send notification to caller that callee has connected
      await this.notifyCallConnected();
      
      // Ensure media tracks are properly established
      setTimeout(() => {
        if (this.pc && this.localStream) {
          const senders = this.pc.getSenders();
          if (senders.length === 0) {
            this.localStream.getTracks().forEach(track => {
              this.pc!.addTrack(track, this.localStream!);
            });
            console.log('Callee: Added local tracks after answer');
          }
        }
      }, 100);
      
    } catch (error) {
      console.error('Error handling remote offer:', error);
      this.onError?.('Failed to handle remote offer: ' + error);
    }
  }

  getRemoteStream()    { return this.remoteStream; }
  getLocalStream()     { return this.localStream; }
  getConnectionState() { return this.pc?.connectionState ?? 'unknown'; }

  // Add method to notify both parties when call is connected
  private async notifyCallConnected() {
    try {
      // Find the other participant in the call
      const callDoc = await this.callDoc.get();
      const participants = callDoc.data()?.participants || {};
      const otherUserId = Object.keys(participants).find(id => id !== this.userId);

      if (otherUserId) {
        // Send notification that call is connected
        await notificationService.sendCallStatusNotification({
          receiverId: otherUserId,
          status: 'connected',
          callId: this.callId
        });
      }
    } catch (error) {
      console.error('Error sending call connected notification:', error);
    }
  }

  async endCall() {
    if (this.cleaned) return;
    try {
      await this.updateCallStatus('ended');
      if (this.callDoc) {
        await this.callDoc.update({
          [`participants.${this.userId}.leftAt`]: firestore.FieldValue.serverTimestamp(),
          endedAt: firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (_) {}
    this.cleanup();
  }

  cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;

    // Unsubscribe listeners BEFORE closing PC
    this.unsubs.forEach(u => u());
    this.unsubs = [];

    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    
    // Clear connection monitoring
    if (this.connectionMonitor) { 
      clearInterval(this.connectionMonitor); 
      this.connectionMonitor = null; 
    }

    if (this.pc) { this.pc.close(); this.pc = null; }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
  }

  // ── Private ────────────────────────────────────────────────────────

  private buildPeerConnection() {
    this.pc = new RTCPeerConnection(this.iceConfig);
    this.remoteStream = new MediaStream(undefined as any);

    (this.pc as any).onicecandidate = async (e: any) => {
      if (!e.candidate || !this.callDoc || this.cleaned) return;
      await this.callDoc.collection('iceCandidates').add({
        candidate:     e.candidate.candidate,
        sdpMid:        e.candidate.sdpMid,
        sdpMLineIndex: e.candidate.sdpMLineIndex,
        from:          this.userId,
        timestamp:     firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
    };

    (this.pc as any).ontrack = (e: any) => {
      console.log('Caller: Remote track received:', e.track?.kind);
      e.streams[0]?.getTracks().forEach((t: any) => {
        console.log('Caller: Adding remote track:', t.kind);
        this.remoteStream?.addTrack(t);
      });
      
      if (this.remoteStream) {
        this.onRemoteStream?.(this.remoteStream);
        console.log('Caller: Remote stream updated');
      }
      
      this.updateParticipant('receiving_media');
      // Ensure call status is updated when media starts flowing
      this.updateCallStatus('connected');
      console.log('Caller: Media connection established');
    };

    (this.pc as any).onconnectionstatechange = async () => {
      if (this.cleaned) return;
      const state = this.pc?.connectionState ?? 'unknown';
      console.log(`Connection state changed: ${state}`);
      this.onConnectionStateChange?.(state);
      await this.updateParticipant(state);
      if (state === 'connected') {
        await this.updateCallStatus('connected');
        // Send notification to other party that connection is established
        this.notifyCallConnected();
      }
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.onError?.(state);
        if (state === 'failed') {
          // Try to reconnect
          await this.attemptReconnect();
        } else {
          await this.endCall();
        }
      }
    };

    // Add ICE connection state change handler
    (this.pc as any).oniceconnectionstatechange = async () => {
      const iceState = this.pc?.iceConnectionState;
      console.log(`ICE connection state changed: ${iceState}`);
      
      if (iceState === 'connected' || iceState === 'completed') {
        await this.updateCallStatus('connected');
        await this.updateParticipant('connected');
        this.notifyCallConnected();
        console.log('ICE: Connection established successfully');
        
        // Clear any connection monitoring
        if (this.connectionMonitor) {
          clearInterval(this.connectionMonitor);
          this.connectionMonitor = null;
        }
      } else if (iceState === 'failed' || iceState === 'disconnected') {
        console.log(`ICE: Connection ${iceState}`);
        if (iceState === 'failed') {
          await this.attemptReconnect();
        }
      }
    };
  }

  private listenFirestore() {
    if (!this.callDoc) return;

    // Remote end / hangup
    const u1 = this.callDoc.onSnapshot((doc: any) => {
      if (this.cleaned) return;
      if (doc.data()?.status === 'ended') {
        this.onConnectionStateChange?.('closed');
        this.cleanup();
      }
    });

    // ICE candidates
    const u2 = this.callDoc.collection('iceCandidates').onSnapshot((snap: any) => {
      snap.docChanges().forEach(async (change: any) => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        if (d.from === this.userId || this.cleaned) return;
        try {
          await this.pc?.addIceCandidate(new RTCIceCandidate({
            candidate:     d.candidate,
            sdpMid:        d.sdpMid,
            sdpMLineIndex: d.sdpMLineIndex,
          }));
        } catch (_) {}
      });
    });

    // Offer (callee only)
    const u3 = this.callDoc.collection('offers').onSnapshot((snap: any) => {
      snap.docChanges().forEach(async (change: any) => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        if (d.from === this.userId || this.cleaned) return;
        this.onOfferReceived?.(d);
      });
    });

    // Answer (caller only) - Enhanced for proper connection establishment
    const u4 = this.callDoc.collection('answers').onSnapshot((snap: any) => {
      snap.docChanges().forEach(async (change: any) => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        if (d.from === this.userId || this.cleaned || this.answerProcessed) return;
        this.answerProcessed = true;
        
        try {
          console.log('Caller: Received answer from callee');
          await this.pc?.setRemoteDescription(new RTCSessionDescription(d.answer));
          await this.updateParticipant('answer_received');
          console.log('Caller: Answer set successfully');
          
          // Force connection state check and trigger media establishment
          setTimeout(async () => {
            const state = this.pc?.connectionState;
            const iceState = this.pc?.iceConnectionState;
            console.log('Caller: Connection state after answer:', state);
            console.log('Caller: ICE connection state:', iceState);
            
            // Trigger connection establishment
            if (this.pc && this.localStream) {
              // Add local tracks if not already added
              const senders = this.pc.getSenders();
              if (senders.length === 0 && this.localStream) {
                this.localStream.getTracks().forEach(track => {
                  this.pc!.addTrack(track, this.localStream!);
                });
                console.log('Caller: Added local tracks to connection');
              }
            }
            
            // Update connection status
            if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
              await this.updateCallStatus('connected');
              await this.updateParticipant('connected');
              this.notifyCallConnected();
              console.log('Caller: Connection established successfully');
            } else {
              // If not connected yet, set up additional monitoring
              this.setupConnectionMonitoring();
            }
          }, 500);
          
        } catch (error) {
          console.error('Caller: Error setting remote description:', error);
          this.onError?.('Failed to establish connection: ' + error);
        }
      });
    });

    this.unsubs = [u1, u2, u3, u4];
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (!this.cleaned) this.updateParticipant(this.pc?.connectionState ?? 'unknown');
    }, 5000);
  }

  private async updateCallStatus(status: CallStatus) {
    if (!this.callDoc || this.cleaned) return;
    try { 
      await this.callDoc.update({ 
        status, 
        lastUpdated: firestore.FieldValue.serverTimestamp() 
      }); 
      console.log(`Call status updated to: ${status}`);
    }
    catch (error) {
      console.error('Error updating call status:', error);
    }
  }

  private isCallerFlag: boolean = false;
  private connectionMonitor: ReturnType<typeof setInterval> | null = null;

  // Add connection monitoring for better connection establishment
  private setupConnectionMonitoring() {
    if (!this.pc) return;
    
    const monitorConnection = async () => {
      if (this.cleaned) return;
      
      const state = this.pc?.connectionState;
      const iceState = this.pc?.iceConnectionState;
      
      console.log('Caller: Monitoring connection - State:', state, 'ICE State:', iceState);
      
      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        await this.updateCallStatus('connected');
        await this.updateParticipant('connected');
        this.notifyCallConnected();
        console.log('Caller: Connection established through monitoring');
        
        // Clear the monitoring interval
        if (this.connectionMonitor) {
          clearInterval(this.connectionMonitor);
          this.connectionMonitor = null;
        }
      }
    };
    
    // Set up periodic monitoring
    this.connectionMonitor = setInterval(monitorConnection, 1000);
    
    // Set timeout to stop monitoring after 30 seconds
    setTimeout(() => {
      if (this.connectionMonitor) {
        clearInterval(this.connectionMonitor);
        this.connectionMonitor = null;
        console.log('Caller: Connection monitoring timeout');
      }
    }, 30000);
  }

  // Helper method to determine if this instance is the caller
  private isCaller(): boolean {
    // For immediate determination, we rely on the initialization parameter
    // The actual check would be async, so we'll use a flag set during initialization
    return this.isCallerFlag;
  }

  // Helper method to get the call initiator ID
  private async getInitiatorIdAsync(): Promise<string> {
    try {
      const callDocSnap = await this.callDoc.get();
      const callData = callDocSnap.data();
      return callData?.initiatedBy || '';
    } catch (error) {
      console.error('Error getting initiator ID:', error);
      return this.userId;
    }
  }

  // Add reconnection logic with exponential backoff
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  
  private async attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      this.onError?.('Connection failed after multiple attempts');
      await this.endCall();
      return;
    }
    
    try {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      // Wait before reconnecting (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 8000);
      await new Promise<void>(resolve => setTimeout(() => resolve(), delay));
      
      // Reset connection state
      if (this.pc) {
        this.pc.close();
      }
      this.pc = null;
      this.offerProcessed = false;
      this.answerProcessed = false;
      
      // Rebuild peer connection
      this.buildPeerConnection();
      
      // Re-add local stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          this.pc?.addTrack(track, this.localStream!);
        });
      }
      
      // Create a new offer to restart the connection
      if (this.isCaller()) {
        await this.createOffer();
      }
      
      console.log('Reconnection attempt completed');
    } catch (error) {
      console.error('Reconnection attempt failed:', error);
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.onError?.('Reconnection failed after multiple attempts');
        await this.endCall();
      }
    }
  }

  private async updateParticipant(state: string) {
    if (!this.callDoc || this.cleaned) return;
    try {
      await this.callDoc.update({
        [`participants.${this.userId}.connectionState`]: state,
        [`participants.${this.userId}.lastPing`]:        firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Participant ${this.userId} state updated to: ${state}`);
    } catch (error) {
      console.error('Error updating participant state:', error);
    }
  }
}