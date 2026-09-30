/**
 * Arnés de las llamadas: corre `src/pulse/llamada.ts` DE VERDAD en node, con los módulos nativos
 * simulados (WebRTC, audio, permisos, vibración, notifee) y un reloj falso para los plazos.
 *
 * `LLAMADA_SRC=/ruta/a/llamada.ts` corre otra versión (p. ej. la anterior, para ver qué fallaba).
 * Nació en la auditoría de la 5.0 (harness.js del bloc de notas) y se amplió para cada arreglo.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const MOVIL = path.resolve(__dirname, '../..');
const ts = require(path.join(MOVIL, 'node_modules/typescript'));
const SRC = process.env.LLAMADA_SRC || path.join(MOVIL, 'src/pulse/llamada.ts');
const CONTRATO = path.join(MOVIL, 'src/nucleo/contrato.ts');

// Los .ts se transpilan al vuelo (solo tipos fuera; nada de comprobar: eso lo hace tsc).
require.extensions['.ts'] = function (m, archivo) {
  const code = ts.transpileModule(fs.readFileSync(archivo, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    fileName: archivo,
  }).outputText;
  m._compile(code, archivo);
};

/* ── reloj falso ── */
let ahora = 0;
let timers = [];
let tid = 0;
global.setTimeout = (fn, ms = 0) => {
  const id = ++tid;
  timers.push({ id, at: ahora + ms, fn });
  return id;
};
global.clearTimeout = (id) => {
  timers = timers.filter((t) => t.id !== id);
};
const flush = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
async function tick(ms) {
  const fin = ahora + ms;
  await flush();
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > fin) break;
    timers.shift();
    ahora = t.at;
    t.fn();
    await flush();
  }
  ahora = fin;
  await flush();
}
/** Espera una promesa avanzando el reloj de 10 en 10 ms (los simulacros tardan en reloj falso). */
async function conReloj(p) {
  let hecho = false;
  p.then(
    () => (hecho = true),
    () => (hecho = true)
  );
  for (let i = 0; !hecho && i < 100000; i++) await tick(10);
  return p;
}

/* ── lo que se observa de los simulacros ── */
const obs = {};
function limpiarObs() {
  Object.assign(obs, {
    sonando: new Set(),
    vibrando: false,
    senales: [],
    audioSesion: 'parada',
    pcs: [],
    tracks: [],
    flujos: [],
    retrasoPermiso: 0,
    retrasoSonido: 50,
    permisoPedido: [],
    /** (permiso) => 'granted' | 'denied' | 'never_ask_again' */
    permiso: () => 'granted',
    servicio: { activo: false, notificaciones: [], paradas: 0 },
    notifee: { foreground: [], background: null, tarea: null },
    ajustesAbiertos: 0,
    /** AppState.currentState que ve llamada.ts ('active' | 'background'). */
    appState: 'active',
    /** Cuántas veces se arrancó la sesión de audio (la llamada la re-aplica al conectar). */
    audioArranques: 0,
  });
}
limpiarObs();
let nSonido = 0;

const RN = {
  Platform: { OS: 'android', Version: 34 },
  AppState: {
    get currentState() {
      return obs.appState;
    },
  },
  Vibration: {
    vibrate: (_p, rep) => {
      obs.vibrando = !!rep;
    },
    cancel: () => {
      obs.vibrando = false;
    },
  },
  Linking: { openSettings: async () => void obs.ajustesAbiertos++ },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: 'mic', CAMERA: 'cam', BLUETOOTH_CONNECT: 'bt', POST_NOTIFICATIONS: 'avisos' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
    requestMultiple: (q) =>
      new Promise((r) => {
        obs.permisoPedido.push([...q]);
        setTimeout(() => r(Object.fromEntries(q.map((p) => [p, obs.permiso(p)]))), obs.retrasoPermiso);
      }),
  },
};

const WEBRTC = (() => {
  class Track {
    constructor(kind) {
      this.kind = kind;
      this.enabled = true;
      this.parado = false;
      this.liberado = false;
      obs.tracks.push(this);
    }
    stop() {
      this.parado = true;
      this.enabled = false;
    }
    release() {
      this.liberado = true;
    }
  }
  class Stream {
    constructor(v, a = true) {
      this.t = (a ? [new Track('audio')] : []).concat(v ? [new Track('video')] : []);
      this.liberado = false;
      obs.flujos.push(this);
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
    toURL() {
      return 'x';
    }
    release(conPistas = true) {
      this.liberado = true;
      if (conPistas) this.t.forEach((x) => x.release());
    }
  }
  class PC {
    constructor(cfg) {
      this.cfg = cfg;
      this.l = {};
      this.signalingState = 'stable';
      this.cerrada = false;
      this.localDescription = null;
      this.remoteDescription = null;
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      this.iceAplicados = [];
      this.ofertas = [];
      obs.pcs.push(this);
    }
    addEventListener(n, f) {
      (this.l[n] = this.l[n] || []).push(f);
    }
    emit(n, e) {
      (this.l[n] || []).forEach((f) => f(e));
    }
    addTrack() {}
    async createOffer(o) {
      this.ofertas.push(o || {});
      return { type: 'offer', sdp: o && o.iceRestart ? 'o-reinicio' : 'o' };
    }
    async createAnswer() {
      return { type: 'answer', sdp: 'a' };
    }
    async setLocalDescription(d) {
      if (d.type === 'rollback') {
        this.localDescription = null;
        this.signalingState = 'stable';
        return;
      }
      this.localDescription = { ...d, toJSON: () => d };
      this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
    }
    async setRemoteDescription(d) {
      if (d.type === 'answer' && this.signalingState !== 'have-local-offer') throw new Error('InvalidStateError: Called in wrong state: ' + this.signalingState);
      if (d.type === 'offer' && this.signalingState === 'have-local-offer') throw new Error('InvalidStateError: glare');
      this.remoteDescription = d;
      this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    }
    async addIceCandidate(c) {
      this.iceAplicados.push(c);
    }
    close() {
      this.cerrada = true;
      this.connectionState = 'closed';
    }
    conectar() {
      this.iceConnectionState = 'connected';
      this.emit('iceconnectionstatechange');
      this.connectionState = 'connected';
      this.emit('connectionstatechange');
    }
    ice(st) {
      this.iceConnectionState = st;
      this.emit('iceconnectionstatechange');
      if (st === 'disconnected' || st === 'failed') {
        this.connectionState = st;
        this.emit('connectionstatechange');
      }
    }
    candidato(c) {
      this.emit('icecandidate', { candidate: { type: 'host', ...c, toJSON: () => c } });
    }
    llegaPista(conVideo) {
      const s = new Stream(conVideo, true);
      this.emit('track', { streams: [s] });
      return s;
    }
  }
  return {
    RTCPeerConnection: PC,
    RTCSessionDescription: function (d) {
      return d;
    },
    RTCIceCandidate: function (c) {
      return c;
    },
    mediaDevices: { getUserMedia: async (c) => new Stream(!!c.video) },
    Stream,
  };
})();

const NOTIFEE = {
  __esModule: true,
  default: {
    registerForegroundService: (f) => {
      obs.notifee.tarea = f;
    },
    onForegroundEvent: (f) => {
      obs.notifee.foreground.push(f);
      return () => {};
    },
    onBackgroundEvent: (f) => {
      obs.notifee.background = f;
    },
    createChannel: async () => 'canal',
    displayNotification: async (n) => {
      obs.servicio.notificaciones.push(n);
      if (n.android && n.android.asForegroundService) obs.servicio.activo = true;
      return n.id;
    },
    stopForegroundService: async () => {
      if (obs.servicio.activo) obs.servicio.paradas++;
      obs.servicio.activo = false;
    },
    cancelNotification: async () => {},
  },
  EventType: { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2 },
  AndroidImportance: { LOW: 2, DEFAULT: 3, HIGH: 4 },
  AndroidVisibility: { PUBLIC: 1 },
  AndroidCategory: { CALL: 'call' },
  AndroidForegroundServiceType: { FOREGROUND_SERVICE_TYPE_MICROPHONE: 128, FOREGROUND_SERVICE_TYPE_CAMERA: 64, FOREGROUND_SERVICE_TYPE_PHONE_CALL: 4 },
};

const mocks = {
  'react-native': RN,
  'expo-av': {
    Audio: {
      Sound: {
        createAsync: (src, o) =>
          new Promise((r) =>
            setTimeout(() => {
              const nombre = src + '#' + ++nSonido;
              if (o.shouldPlay) obs.sonando.add(nombre);
              r({ sound: { stopAsync: async () => obs.sonando.delete(nombre), unloadAsync: async () => obs.sonando.delete(nombre) } });
            }, obs.retrasoSonido)
          ),
      },
    },
  },
  '@livekit/react-native': {
    AudioSession: {
      configureAudio: async () => {},
      startAudioSession: async () => {
        obs.audioSesion = 'arrancada';
        obs.audioArranques++;
      },
      stopAudioSession: async () => {
        obs.audioSesion = 'parada';
      },
      selectAudioOutput: async (s) => {
        obs.salidaElegida = s;
      },
      // Lo que Android tiene conectado (la prueba pone `obs.salidasHay`; por omisión, solo el teléfono).
      getAudioOutputs: async () => obs.salidasHay || ['speaker', 'earpiece'],
    },
  },
  '@livekit/react-native-webrtc': WEBRTC,
  '@notifee/react-native': NOTIFEE,
  // relevo.ts trae SecureStore y el candado: en el arnés el correo propio se pasa en `arrancar`.
  './relevo': { quien: () => null },
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (mocks[req]) return mocks[req];
  if (req.endsWith('.wav')) return path.basename(req);
  return origLoad.apply(this, arguments);
};

/** Una llamada.ts recién cargada (estado de módulo en blanco). */
function cargar() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.dirname(SRC)) || k === SRC) delete require.cache[k];
  }
  return require(SRC);
}
const contrato = () => require(CONTRATO);

function reset() {
  ahora = 0;
  timers = [];
  limpiarObs();
}

/** Arranca una llamada.ts nueva, con `mandar` que anota cada señal. `opciones.mandar` la reemplaza. */
async function nuevo(opciones = {}) {
  reset();
  const L = cargar();
  const avisos = [];
  L.arrancar({
    mandar: (para, tipo, datos) => {
      obs.senales.push({ para, tipo, datos });
      return opciones.mandar ? opciones.mandar(para, tipo, datos) : undefined;
    },
    alCambiar: (c) => avisos.push(c),
    aparato: () => 'AURA1',
    correo: opciones.correo ? () => opciones.correo : undefined,
    traerTurno: opciones.traerTurno,
  });
  await flush();
  return { L, avisos, ultimo: () => avisos[avisos.length - 1] || {} };
}

const OFERTA = (sdp = 'o') => ({ type: 'offer', sdp });
const RESPUESTA = (sdp = 'a') => ({ type: 'answer', sdp });

/** La sesión de audio simulada: las pruebas la paran «como ElevenLabs» al cerrarse. */
const AUDIO = mocks['@livekit/react-native'].AudioSession;

module.exports = { cargar, contrato, obs, tick, flush, conReloj, reset, nuevo, OFERTA, RESPUESTA, WEBRTC, NOTIFEE, AUDIO, SRC };
