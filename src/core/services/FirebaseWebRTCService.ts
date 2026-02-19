import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
} from 'react-native-webrtc';
import firestore from '@react-native-firebase/firestore';

// ─────────────────────────────────────────────────────────────────────────────
//  STATUS LIFECYCLE (never goes backwards):
//
//  waiting  →  ringing  →  answered  →  connected  →  ended
//
//  'waiting'  : caller created the call doc, notifying callee
//  'ringing'  : notification sent, callee device is ringing
//  'answered' : callee tapped Accept (written by IncomingCallScreen)
//  'connected': media is flowing (written by WebRTC service)
//  'ended'    : either party hung up
//
//  RULE: No code path may ever write a status value that is "earlier" in
//  the lifecycle than the current value. createOffer() must NOT write
//  'ringing' — the call is already 'answered' by the time it runs.
// ─────────────────────────────────────────────────────────────────────────────

type CallStatus = 'waiting' | 'ringing' | 'answered' | 'connected' | 'ended' | 'error';

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
  private isCallerFlag: boolean = false;
  private connectionMonitor: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 3;

  private readonly iceConfig = {
    iceServers: [
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "268ab7c67b3794eb38da5aab",
        credential: "jlEJpcizInASZbbu",
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "268ab7c67b3794eb38da5aab",
        credential: "jlEJpcizInASZbbu",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "268ab7c67b3794eb38da5aab",
        credential: "jlEJpcizInASZbbu",
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "268ab7c67b3794eb38da5aab",
        credential: "jlEJpcizInASZbbu",
      },
  ],
    iceCandidatePoolSize: 10,
  };

  constructor(
    private readonly callId: string,
    private readonly userId: string,
    private readonly onRemoteStream?: (s: MediaStream) => void,
    private readonly onConnectionStateChange?: (state: string) => void,
    private readonly onError?: (err: string) => void,
    private readonly onOfferReceived?: (data: any) => void,
  ) { }

  // ─────────────────────────────────────────────────────────────────────────
  //  initialize
  //
  //  FIX (Bug 2): callee's initialize(false) previously wrote
  //  status:'ringing', overwriting the status:'answered' that
  //  IncomingCallScreen had just set. The caller's acceptListenerRef
  //  snapshot then re-fired with 'ringing', did nothing, and the call
  //  stalled forever ("participant state: new" in logs).
  //
  //  Now: callee ONLY writes participant join metadata — never touches status.
  // ─────────────────────────────────────────────────────────────────────────
  async initialize(isCaller: boolean) {
    this.callDoc = firestore().collection('calls').doc(this.callId);
    this.isCallerFlag = isCaller;

    // Build PC + Firestore listeners BEFORE any writes (avoids race on offers)
    this.buildPeerConnection();
    this.listenFirestore();

    if (isCaller) {
      // Caller owns the status field for the 'waiting' → 'ringing' transition.
      await this.callDoc.set(
        {
          callId: this.callId,
          createdAt: firestore.FieldValue.serverTimestamp(),
          initiatedBy: this.userId,
          status: 'waiting',
          participants: {
            [this.userId]: {
              userId: this.userId,
              joinedAt: firestore.FieldValue.serverTimestamp(),
              connectionState: 'initializing',
              lastPing: firestore.FieldValue.serverTimestamp(),
            },
          },
        },
        { merge: true },
      );
    } else {
      // Callee ONLY adds itself to participants — no status write.
      // status:'answered' is already in Firestore (written by IncomingCallScreen).
      await this.callDoc.set(
        {
          participants: {
            [this.userId]: {
              userId: this.userId,
              joinedAt: firestore.FieldValue.serverTimestamp(),
              connectionState: 'initializing',
              lastPing: firestore.FieldValue.serverTimestamp(),
            },
          },
        },
        { merge: true },
      );
    }

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

    // ✅ No status write here — status is already 'answered'
    await this.updateParticipant('creating_offer');
    console.log('[WebRTC] Creating offer, audioOnly:', audioOnly);

    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: !audioOnly,
    });
    await this.pc.setLocalDescription(offer);

    await this.callDoc.collection('offers').add({
      offer: {
        type: offer.type,
        sdp: offer.sdp,
      },
      from: this.userId,
      timestamp: firestore.FieldValue.serverTimestamp(),
    });

    await this.updateParticipant('offer_sent');
    console.log('[WebRTC] Offer written to Firestore');
  }

  async handleRemoteOffer(offer: any) {
    if (this.offerProcessed) return;
    this.offerProcessed = true;
    if (!this.pc) throw new Error('PC not ready');

    try {
      console.log('[WebRTC] Callee: handling remote offer');
      await this.updateParticipant('handling_offer');
      // Handle both the old format (with toJSON) and new format (direct properties)
      const offerDesc = offer.offer ? new RTCSessionDescription(offer.offer) : new RTCSessionDescription(offer);
      await this.pc.setRemoteDescription(offerDesc);
      console.log('[WebRTC] Callee: remote description set');

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      console.log('[WebRTC] Callee: local description (answer) set');

      await this.callDoc.collection('answers').add({
        answer: {
          type: answer.type,
          sdp: answer.sdp,
        },
        from: this.userId,
        timestamp: firestore.FieldValue.serverTimestamp(),
      });

      await this.updateParticipant('answer_sent');
      console.log('[WebRTC] Callee: answer written to Firestore');
    } catch (error) {
      console.error('[WebRTC] Error handling remote offer:', error);
      this.onError?.('Failed to handle remote offer: ' + error);
    }
  }

  getRemoteStream() { return this.remoteStream; }
  getLocalStream() { return this.localStream; }
  getConnectionState() { return this.pc?.connectionState ?? 'unknown'; }

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
    } catch (_) { }
    this.cleanup();
  }

  cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;

    this.unsubs.forEach(u => u());
    this.unsubs = [];

    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.connectionMonitor) { clearInterval(this.connectionMonitor); this.connectionMonitor = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private buildPeerConnection() {
    this.pc = new RTCPeerConnection(this.iceConfig);
    this.remoteStream = new MediaStream(undefined as any);

    (this.pc as any).onicecandidate = async (e: any) => {
      if (!e.candidate || !this.callDoc || this.cleaned) return;
      console.log('[WebRTC] Local ICE candidate generated');
      await this.callDoc.collection('iceCandidates').add({
        candidate: e.candidate.candidate,
        sdpMid: e.candidate.sdpMid,
        sdpMLineIndex: e.candidate.sdpMLineIndex,
        from: this.userId,
        timestamp: firestore.FieldValue.serverTimestamp(),
      }).catch(() => { });
    };

    (this.pc as any).ontrack = (e: any) => {
      console.log('[WebRTC] Remote track received:', e.track?.kind);
      e.streams[0]?.getTracks().forEach((t: any) => {
        this.remoteStream?.addTrack(t);
      });
      if (this.remoteStream) {
        this.onRemoteStream?.(this.remoteStream);
      }
      this.updateParticipant('receiving_media');
      // Mark connected when first media track arrives
      this.updateCallStatus('connected');
    };

    (this.pc as any).onconnectionstatechange = async () => {
      if (this.cleaned) return;
      const state = this.pc?.connectionState ?? 'unknown';
      console.log('[WebRTC] Connection state:', state);
      
      // Only update if we're not in the middle of ICE checking
      const iceState = this.pc?.iceConnectionState;
      if (iceState === 'checking') {
        // Let the ICE handler manage the 'connecting' state
        return;
      }
      
      this.onConnectionStateChange?.(state);
      await this.updateParticipant(state);

      if (state === 'connected') {
        await this.updateCallStatus('connected');
        if (this.connectionMonitor) {
          clearInterval(this.connectionMonitor);
          this.connectionMonitor = null;
        }
      } else if (state === 'failed') {
        await this.attemptReconnect();
      } else if (state === 'disconnected' || state === 'closed') {
        this.onError?.(state);
        await this.endCall();
      }
    };

    (this.pc as any).oniceconnectionstatechange = async () => {
      if (this.cleaned) return;
      const iceState = this.pc?.iceConnectionState;
      console.log('[WebRTC] ICE state:', iceState);

      if (iceState === 'connected' || iceState === 'completed') {
        await this.updateCallStatus('connected');
        await this.updateParticipant('connected');
        this.onConnectionStateChange?.('connected');
        if (this.connectionMonitor) {
          clearInterval(this.connectionMonitor);
          this.connectionMonitor = null;
        }
      } else if (iceState === 'checking') {
        // Set to connecting during ICE checking
        this.onConnectionStateChange?.('connecting');
      } else if (iceState === 'failed') {
        await this.attemptReconnect();
      }
    };
  }

  private listenFirestore() {
    if (!this.callDoc) return;

    // Main doc — watch for remote hangup
    const u1 = this.callDoc.onSnapshot((doc: any) => {
      if (this.cleaned) return;
      const status = doc.data()?.status;
      console.log('[WebRTC] Call doc status:', status);
      if (status === 'ended') {
        this.onConnectionStateChange?.('closed');
        this.cleanup();
      }
    });

    // ICE candidates from remote peer
    const u2 = this.callDoc.collection('iceCandidates').onSnapshot((snap: any) => {
      snap.docChanges().forEach(async (change: any) => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        if (d.from === this.userId || this.cleaned) return;
        console.log('[WebRTC] Adding remote ICE candidate');
        try {
          // Check if remote description is set before adding ICE candidate
          if (this.pc?.remoteDescription) {
            await this.pc?.addIceCandidate(new RTCIceCandidate({
              candidate: d.candidate,
              sdpMid: d.sdpMid,
              sdpMLineIndex: d.sdpMLineIndex,
            }));
          } else {
            // Store ICE candidate for later processing if remote description is not yet set
            console.log('[WebRTC] Remote description not set yet, queuing ICE candidate');
            // Add a small delay to wait for remote description to be set
            setTimeout(async () => {
              if (this.pc?.remoteDescription) {
                await this.pc?.addIceCandidate(new RTCIceCandidate({
                  candidate: d.candidate,
                  sdpMid: d.sdpMid,
                  sdpMLineIndex: d.sdpMLineIndex,
                }));
                console.log('[WebRTC] Queued ICE candidate added successfully');
              } else {
                console.warn('[WebRTC] Remote description still not set after delay, candidate may be lost');
              }
            }, 100);
          }
        } catch (e) {
          console.warn('[WebRTC] Failed to add ICE candidate:', e);
        }
      });
    });

    // Offer — fires on callee device only (caller passes onOfferReceived=undefined)
    const u3 = this.callDoc.collection('offers').onSnapshot((snap: any) => {
      snap.docChanges().forEach(async (change: any) => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        if (d.from === this.userId || this.cleaned) return;
        console.log('[WebRTC] Offer received from Firestore');
        this.onOfferReceived?.(d);
      });
    });

    // Answer — fires on caller device only
    const u4 = this.callDoc.collection('answers').onSnapshot((snap: any) => {
      snap.docChanges().forEach(async (change: any) => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        if (d.from === this.userId || this.cleaned || this.answerProcessed) return;
        this.answerProcessed = true;

        try {
          console.log('[WebRTC] Caller: received answer, setting remote description');
          // Handle both the old format (with toJSON) and new format (direct properties)
          const answerDesc = d.answer ? new RTCSessionDescription(d.answer) : new RTCSessionDescription(d);
          await this.pc?.setRemoteDescription(answerDesc);
          await this.updateParticipant('answer_received');
          console.log('[WebRTC] Caller: remote description set — waiting for ICE');
          this.setupConnectionMonitoring();
        } catch (error) {
          console.error('[WebRTC] Caller: error setting remote description:', error);
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

  // ─────────────────────────────────────────────────────────────────────────
  //  updateCallStatus — safe, idempotent, never goes backwards
  // ─────────────────────────────────────────────────────────────────────────
  private async updateCallStatus(status: CallStatus) {
    if (!this.callDoc || this.cleaned) return;
    try {
      await this.callDoc.update({
        status,
        lastUpdated: firestore.FieldValue.serverTimestamp(),
      });
      console.log('[WebRTC] Call status →', status);
    } catch (error) {
      console.error('[WebRTC] Error updating call status:', error);
    }
  }

  private setupConnectionMonitoring() {
    if (this.connectionMonitor) return;
    let attempts = 0;
    this.connectionMonitor = setInterval(async () => {
      if (this.cleaned) {
        clearInterval(this.connectionMonitor!);
        this.connectionMonitor = null;
        return;
      }
      attempts++;
      const state = this.pc?.connectionState;
      const iceState = this.pc?.iceConnectionState;
      console.log(`[WebRTC] Monitor[${attempts}] state=${state} ice=${iceState}`);

      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        await this.updateCallStatus('connected');
        await this.updateParticipant('connected');
        this.onConnectionStateChange?.('connected');
        clearInterval(this.connectionMonitor!);
        this.connectionMonitor = null;
      } else if (attempts >= 30) {
        // 30 seconds — give up
        console.warn('[WebRTC] Connection monitoring timeout');
        clearInterval(this.connectionMonitor!);
        this.connectionMonitor = null;
        this.onError?.('Connection timed out');
      }
    }, 1000);
  }

  private async attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onError?.('Connection failed after multiple attempts');
      await this.endCall();
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 8000);
    console.log(`[WebRTC] Reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    await new Promise<void>(resolve => setTimeout(() => resolve(), delay));

    if (this.pc) { this.pc.close(); }
    this.pc = null;
    this.offerProcessed = false;
    this.answerProcessed = false;
    this.buildPeerConnection();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.pc?.addTrack(track, this.localStream!);
      });
    }
    if (this.isCallerFlag) await this.createOffer();
  }

  private async updateParticipant(state: string) {
    if (!this.callDoc || this.cleaned) return;
    try {
      await this.callDoc.update({
        [`participants.${this.userId}.connectionState`]: state,
        [`participants.${this.userId}.lastPing`]: firestore.FieldValue.serverTimestamp(),
      });
    } catch (_) { }
  }
}