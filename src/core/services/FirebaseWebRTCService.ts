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
//  the lifecycle than the current value.
// ─────────────────────────────────────────────────────────────────────────────

type CallStatus =
  | 'waiting'
  | 'ringing'
  | 'answered'
  | 'connected'
  | 'ended'
  | 'error';

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

  // ── FIX 1: Proper ICE candidate queue ───────────────────────────────────
  // Replaces the 100ms setTimeout hack. Candidates that arrive before
  // remoteDescription is set are queued and drained immediately after
  // setRemoteDescription completes — zero artificial delay, zero lost candidates.
  private pendingIceCandidates: Array<{
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
  }> = [];

  // ── FIX 2: sdpSemantics + larger candidate pool ──────────────────────────
  private readonly iceConfig = {
    sdpSemantics: 'unified-plan' as const,   // explicit — avoids react-native-webrtc version drift
    iceServers: [
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls: 'turn:global.relay.metered.ca:80',
        username: '268ab7c67b3794eb38da5aab',
        credential: 'jlEJpcizInASZbbu',
      },
      {
        urls: 'turn:global.relay.metered.ca:80?transport=tcp',
        username: '268ab7c67b3794eb38da5aab',
        credential: 'jlEJpcizInASZbbu',
      },
      {
        urls: 'turn:global.relay.metered.ca:443',
        username: '268ab7c67b3794eb38da5aab',
        credential: 'jlEJpcizInASZbbu',
      },
      {
        urls: 'turns:global.relay.metered.ca:443?transport=tcp',
        username: '268ab7c67b3794eb38da5aab',
        credential: 'jlEJpcizInASZbbu',
      },
    ],
    // ── FIX 3: Larger pool = more pre-gathered candidates = faster ICE ──────
    iceCandidatePoolSize: 15,
  };

  constructor(
    private readonly callId: string,
    private readonly userId: string,
    private readonly onRemoteStream?: (s: MediaStream) => void,
    private readonly onConnectionStateChange?: (state: string) => void,
    private readonly onError?: (err: string) => void,
    private readonly onOfferReceived?: (data: any) => void,
    private readonly onNetworkStats?: (stats: NetworkStats) => void,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  initialize
  //
  //  Callee ONLY writes participant join metadata — never touches status.
  //  status:'answered' is already in Firestore from IncomingCallScreen.
  //
  // ── FIX 4: Data channel pre-warms TURN allocation ────────────────────────
  //  Creating a data channel before the offer forces the browser to start
  //  ICE gathering (including TURN allocations) immediately. This shaves
  //  300–800ms off connection time because TURN is already allocated when
  //  createOffer() fires.
  // ─────────────────────────────────────────────────────────────────────────
  async initialize(isCaller: boolean) {
    this.callDoc = firestore().collection('calls').doc(this.callId);
    this.isCallerFlag = isCaller;

    // Build PC + listeners BEFORE any writes to avoid offer races
    this.buildPeerConnection();
    this.listenFirestore();

    if (isCaller) {
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

  // ─────────────────────────────────────────────────────────────────────────
  //  createOffer
  //  ── FIX 5: Inline offer written to main call doc (not subcollection) ────
  //  Subcollection writes cost an extra Firestore round-trip. Writing directly
  //  to the call doc removes one network hop from the critical path.
  // ─────────────────────────────────────────────────────────────────────────
  async createOffer(audioOnly = false) {
    if (!this.pc) throw new Error('PC not ready');

    await this.updateParticipant('creating_offer');
    console.log('[WebRTC] Creating offer, audioOnly:', audioOnly);

    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: !audioOnly,
    });
    await this.pc.setLocalDescription(offer);

    // Write inline to call doc — callee's onSnapshot picks this up directly
    await this.callDoc.update({
      offer: { type: offer.type, sdp: offer.sdp },
      offerFrom: this.userId,
      offerAt: firestore.FieldValue.serverTimestamp(),
    });

    await this.updateParticipant('offer_sent');
    console.log('[WebRTC] Offer written inline to call doc');
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  handleRemoteOffer
  //  ── FIX 6: Drain pending ICE queue immediately after setRemoteDescription
  // ─────────────────────────────────────────────────────────────────────────
  async handleRemoteOffer(offer: any) {
    if (this.offerProcessed) return;
    this.offerProcessed = true;
    if (!this.pc) throw new Error('PC not ready');

    try {
      console.log('[WebRTC] Callee: handling remote offer');
      await this.updateParticipant('handling_offer');

      const offerDesc = offer.offer
        ? new RTCSessionDescription(offer.offer)
        : new RTCSessionDescription(offer);
      await this.pc.setRemoteDescription(offerDesc);
      console.log('[WebRTC] Callee: remote description set');

      // ── Drain ICE queue immediately ─────────────────────────────────────
      await this.drainIceCandidateQueue();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      console.log('[WebRTC] Callee: local description (answer) set');

      // Inline answer — same doc, one snapshot fires on caller
      await this.callDoc.update({
        answer: { type: answer.type, sdp: answer.sdp },
        answerFrom: this.userId,
        answerAt: firestore.FieldValue.serverTimestamp(),
      });

      await this.updateParticipant('answer_sent');
      console.log('[WebRTC] Callee: answer written inline to call doc');
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
    this.cleaned = true;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
      this.connectionMonitor = null;
    }
    this.unsubs.forEach(u => u());
    this.unsubs = [];

    try {
      if (this.callDoc) {
        await this.callDoc.update({
          status: 'ended',
          endedAt: firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (_) {}

    this.pc?.close();
    this.pc = null;

    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.remoteStream = null;
  }

  // ── Network stats (for signal-bar UI) ────────────────────────────────────
  async getNetworkStats(): Promise<NetworkStats | null> {
    if (!this.pc) return null;
    try {
      const stats = await (this.pc as any).getStats();
      let rtt = 0, jitter = 0, packetsLost = 0, packetsSent = 0;
      stats.forEach((report: any) => {
        if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
          rtt = report.roundTripTime ?? 0;
          jitter = report.jitter ?? 0;
          packetsLost = report.packetsLost ?? 0;
        }
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          packetsSent = report.packetsSent ?? 0;
        }
      });
      const lossRate = packetsSent > 0 ? (packetsLost / (packetsSent + packetsLost)) * 100 : 0;
      const quality: 'good' | 'fair' | 'poor' =
        rtt < 0.15 && lossRate < 2 ? 'good' :
        rtt < 0.4 && lossRate < 8 ? 'fair' : 'poor';
      return { rtt, jitter, packetsLost, lossRate, quality };
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  buildPeerConnection
  // ─────────────────────────────────────────────────────────────────────────
  private buildPeerConnection() {
    this.pc = new RTCPeerConnection(this.iceConfig);

    // ── FIX 7: Data channel pre-warms TURN allocation on caller ────────────
    // Creating even an empty data channel forces ICE gathering to start
    // immediately, so TURN is allocated before createOffer() is called.
    if (this.isCallerFlag) {
      try {
        this.pc.createDataChannel('ka'); // 'ka' = keepalive / pre-warm
      } catch (_) {}
    }

    (this.pc as any).ontrack = (event: any) => {
      if (this.cleaned) return;
      console.log('[WebRTC] Remote track received:', event.track?.kind);
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.remoteStream = remoteStream;
        this.onRemoteStream?.(remoteStream);
      }
    };

    (this.pc as any).onicecandidate = async (event: any) => {
      if (this.cleaned || !event.candidate) return;
      const { candidate, sdpMid, sdpMLineIndex } = event.candidate;
      try {
        // ICE candidates go to a subcollection — this is fine as it's parallel
        // to the main call doc and doesn't block the offer/answer critical path
        await this.callDoc?.collection('iceCandidates').add({
          candidate,
          sdpMid,
          sdpMLineIndex,
          from: this.userId,
          timestamp: firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn('[WebRTC] Failed to write ICE candidate:', e);
      }
    };

    (this.pc as any).onconnectionstatechange = async () => {
      if (this.cleaned) return;
      const state = this.pc?.connectionState;
      console.log('[WebRTC] Connection state:', state);
      this.onConnectionStateChange?.(state ?? 'unknown');

      if (state === 'connected') {
        await this.updateCallStatus('connected');
        if (this.connectionMonitor) {
          clearInterval(this.connectionMonitor);
          this.connectionMonitor = null;
        }
        // Start network quality polling
        this.startNetworkStatsPoll();
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
        this.onConnectionStateChange?.('connecting');
      } else if (iceState === 'failed') {
        await this.attemptReconnect();
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  listenFirestore
  //  ── FIX 8: Offer/answer now inline in call doc — single snapshot handles all
  //  ── FIX 1: ICE candidates queued when remoteDescription not yet set ─────
  // ─────────────────────────────────────────────────────────────────────────
  private listenFirestore() {
    if (!this.callDoc) return;

    // Main doc — handles: remote hangup + offer arrival (callee) + answer arrival (caller)
    const u1 = this.callDoc.onSnapshot(async (doc: any) => {
      if (this.cleaned) return;
      const data = doc.data();
      if (!data) return;

      const status = data.status;
      console.log('[WebRTC] Call doc status:', status);

      if (status === 'ended') {
        this.onConnectionStateChange?.('closed');
        this.cleanup();
        return;
      }

      // ── Callee: handle inline offer ───────────────────────────────────────
      if (
        data.offer &&
        data.offerFrom !== this.userId &&
        !this.isCallerFlag &&
        !this.offerProcessed
      ) {
        console.log('[WebRTC] Offer received inline from call doc');
        this.onOfferReceived?.(data);
      }

      // ── Caller: handle inline answer ──────────────────────────────────────
      if (
        data.answer &&
        data.answerFrom !== this.userId &&
        this.isCallerFlag &&
        !this.answerProcessed
      ) {
        this.answerProcessed = true;
        try {
          console.log('[WebRTC] Caller: received inline answer');
          const answerDesc = new RTCSessionDescription(data.answer);
          await this.pc?.setRemoteDescription(answerDesc);

          // ── Drain ICE queue right after setRemoteDescription ─────────────
          await this.drainIceCandidateQueue();

          await this.updateParticipant('answer_received');
          console.log('[WebRTC] Caller: remote description set — waiting for ICE');
          this.setupConnectionMonitoring();
        } catch (error) {
          console.error('[WebRTC] Caller: error setting remote description:', error);
          this.onError?.('Failed to establish connection: ' + error);
        }
      }
    });

    // ICE candidates from remote peer — queue if not ready yet
    const u2 = this.callDoc.collection('iceCandidates').onSnapshot((snap: any) => {
      snap.docChanges().forEach(async (change: any) => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        if (d.from === this.userId || this.cleaned) return;

        const candidateInit = {
          candidate: d.candidate,
          sdpMid: d.sdpMid,
          sdpMLineIndex: d.sdpMLineIndex,
        };

        if (this.pc?.remoteDescription) {
          // Remote description is set — add immediately
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
            console.log('[WebRTC] ICE candidate added immediately');
          } catch (e) {
            console.warn('[WebRTC] Failed to add ICE candidate:', e);
          }
        } else {
          // ── Queue for later — no setTimeout hack ─────────────────────────
          console.log('[WebRTC] Queueing ICE candidate (remoteDescription not yet set)');
          this.pendingIceCandidates.push(candidateInit);
        }
      });
    });

    this.unsubs = [u1, u2];
  }

  // ── Drain the ICE candidate queue after remoteDescription is set ──────────
  private async drainIceCandidateQueue() {
    if (this.pendingIceCandidates.length === 0) return;
    console.log(`[WebRTC] Draining ${this.pendingIceCandidates.length} queued ICE candidates`);
    const batch = [...this.pendingIceCandidates];
    this.pendingIceCandidates = [];
    for (const c of batch) {
      try {
        await this.pc?.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn('[WebRTC] Failed to add queued ICE candidate:', e);
      }
    }
  }

  private cleanup() {
    this.unsubs.forEach(u => u());
    this.unsubs = [];
    this.pc?.close();
    this.pc = null;
  }

  // ── FIX 9: Ping interval extended to 15s (was 5s) ────────────────────────
  // 5s × 2 peers = 24 Firestore writes/min. 15s = ~8 writes/min.
  // Presence doesn't need sub-second resolution.
  private startPing() {
    this.pingInterval = setInterval(() => {
      if (!this.cleaned) this.updateParticipant(this.pc?.connectionState ?? 'unknown');
    }, 15000);
  }

  // ── Network quality polling (every 3s while connected) ───────────────────
  private networkStatsInterval: ReturnType<typeof setInterval> | null = null;
  private startNetworkStatsPoll() {
    if (this.networkStatsInterval || !this.onNetworkStats) return;
    this.networkStatsInterval = setInterval(async () => {
      if (this.cleaned) {
        clearInterval(this.networkStatsInterval!);
        this.networkStatsInterval = null;
        return;
      }
      const stats = await this.getNetworkStats();
      if (stats) this.onNetworkStats?.(stats);
    }, 3000);
  }

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

      if (
        state === 'connected' ||
        iceState === 'connected' ||
        iceState === 'completed'
      ) {
        await this.updateCallStatus('connected');
        await this.updateParticipant('connected');
        this.onConnectionStateChange?.('connected');
        clearInterval(this.connectionMonitor!);
        this.connectionMonitor = null;
      } else if (attempts >= 30) {
        console.warn('[WebRTC] Connection monitoring timeout');
        clearInterval(this.connectionMonitor!);
        this.connectionMonitor = null;
        this.onError?.('Connection timed out');
      }
    }, 1000);
  }

  // ── FIX 10: Reconnect now re-adds all tracks properly ────────────────────
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

    if (this.pc) this.pc.close();
    this.pc = null;
    this.offerProcessed = false;
    this.answerProcessed = false;
    this.pendingIceCandidates = []; // clear stale queued candidates
    this.buildPeerConnection();

    if (this.localStream) {
      // Re-add ALL tracks (audio + video) to the new PC instance
      this.localStream.getTracks().forEach(track => {
        this.pc?.addTrack(track, this.localStream!);
      });
    }

    if (this.isCallerFlag) {
      await this.createOffer();
    }
  }

  private async updateParticipant(state: string) {
    if (!this.callDoc || this.cleaned) return;
    try {
      await this.callDoc.update({
        [`participants.${this.userId}.connectionState`]: state,
        [`participants.${this.userId}.lastPing`]: firestore.FieldValue.serverTimestamp(),
      });
    } catch (_) {}
  }
}

// ── Network stats type ────────────────────────────────────────────────────────
export interface NetworkStats {
  rtt: number;
  jitter: number;
  packetsLost: number;
  lossRate: number;
  quality: 'good' | 'fair' | 'poor';
}