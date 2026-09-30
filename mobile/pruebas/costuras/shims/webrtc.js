// @livekit/react-native-webrtc de mentira: lo justo para que el motor de llamadas llame, conteste y
// cuelgue en node. Las conexiones creadas quedan en globalThis.__rtc.pcs (las pruebas las «conectan»).
const rtc = globalThis.__rtc || (globalThis.__rtc = { pcs: [], pistas: [] });

class Pista {
  constructor(kind) {
    this.kind = kind;
    this.enabled = true;
    this.parada = false;
    rtc.pistas.push(this);
  }
  stop() {
    this.parada = true;
    this.enabled = false;
  }
}
class Flujo {
  constructor(video) {
    this.t = [new Pista('audio')].concat(video ? [new Pista('video')] : []);
  }
  getTracks() {
    return this.t;
  }
  getAudioTracks() {
    return this.t.filter((x) => x.kind === 'audio');
  }
  getVideoTracks() {
    return this.t.filter((x) => x.kind === 'video');
  }
  release() {}
  toURL() {
    return 'flujo';
  }
}
class RTCPeerConnection {
  constructor(cfg) {
    this.cfg = cfg;
    this.l = {};
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.cerrada = false;
    rtc.pcs.push(this);
  }
  addEventListener(n, f) {
    (this.l[n] = this.l[n] || []).push(f);
  }
  emitir(n, e) {
    (this.l[n] || []).forEach((f) => f(e));
  }
  addTrack() {}
  async createOffer() {
    return { type: 'offer', sdp: 'oferta' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'respuesta' };
  }
  async setLocalDescription(d) {
    this.localDescription = { ...d, toJSON: () => d };
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(d) {
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate() {}
  close() {
    this.cerrada = true;
    this.connectionState = 'closed';
  }
  conectar() {
    this.iceConnectionState = 'connected';
    this.emitir('iceconnectionstatechange');
    this.connectionState = 'connected';
    this.emitir('connectionstatechange');
  }
}

module.exports = {
  RTCPeerConnection,
  RTCSessionDescription: function (d) {
    return d;
  },
  RTCIceCandidate: function (c) {
    return c;
  },
  mediaDevices: { getUserMedia: async (c) => new Flujo(!!c.video) },
};
