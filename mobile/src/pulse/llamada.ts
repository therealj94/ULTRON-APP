/**
 * Llamadas de voz y video de PULSE2CHAT, desde AU-RA.
 *
 * Portado de `orden-global-app/src/og/llamada.js`. EL PROTOCOLO ES EL MISMO, letra por letra, porque
 * AU-RA tiene que poder llamar a un navegador y a la app Orden Global y al revés:
 *
 *   llamo      { video, sdp }   quien llama, con su oferta dentro
 *   respuesta  { sdp }          quien contesta
 *   ice        { candidato }    caminos de red
 *   rechazo · ocupado · cuelgo  {}
 *
 * Y una señal nueva que pone el relevo: `atendida` { como }. La misma cuenta puede tener la llamada
 * sonando en AU-RA y en la app Orden Global; cuando uno contesta, al otro le llega `atendida` y deja
 * de sonar. `desde` dice qué aparato contestó: el que contestó la ignora.
 *
 * Dos diferencias con la app Orden Global, las dos por la misma razón (no sumar módulos nativos que
 * choquen con los de la conversación fluida):
 *   · WebRTC es `@livekit/react-native-webrtc`, el que ya trae la conversación con ElevenLabs. Es un
 *     derivado de `react-native-webrtc` con la misma API; los dos a la vez chocarían en el APK.
 *   · El audio de llamada (modo comunicación, altavoz/auricular, audífonos) lo maneja `AudioSession`
 *     de LiveKit, no `react-native-incall-manager`. El timbre y el tono son sonidos propios.
 *
 * Este archivo no sabe cómo se ve una llamada: entrega el estado y los flujos, la pantalla pinta.
 */
import * as RN from 'react-native';
import { Platform, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import { RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, mediaDevices, type MediaStream } from '@livekit/react-native-webrtc';
import { AudioSession } from '@livekit/react-native';

const HIELO = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
/** Sin plazo, «no pasa nada» se ve igual que «va a conectar en un segundo». */
const PLAZO_CONEXION = 20_000;

export type EstadoLlamada = 'libre' | 'llamando' | 'entrando' | 'conectando' | 'hablando';
export type Motivo = 'yo' | 'el-otro' | 'rechazada' | 'ocupado' | 'sin-camino' | 'corte' | 'no-se-pudo' | 'sin-permiso' | 'en-otro-aparato';
export type Cuento = {
  estado: EstadoLlamada;
  conQuien: string | null;
  soyQuienLlama: boolean;
  entrante: { de: string; video: boolean } | null;
  flujoLocal: MediaStream | null;
  flujoRemoto: MediaStream | null;
  hayVideo: boolean;
  micAbierto: boolean;
  camAbierta: boolean;
  porAltavoz: boolean;
  motivo?: Motivo;
  hizoFaltaRelevo?: boolean;
};

let pc: RTCPeerConnection | null = null;
let miFlujo: MediaStream | null = null;
let flujoRemoto: MediaStream | null = null;
let estado: EstadoLlamada = 'libre';
let conQuien: string | null = null;
let soyQuienLlama = false;
let entrante: { de: string; video: boolean; sdp: any } | null = null;
let iceEnCola: any[] = [];
let relojConexion: ReturnType<typeof setTimeout> | null = null;
let tiposVistos = new Set<string>();
let porAltavoz = false;

let mandarSenal: (para: string, tipo: string, datos: unknown) => void = () => {};
let avisar: (c: Cuento) => void = () => {};
let pedirTurno: (() => Promise<any[]>) | null = null;
let miAparato: () => string = () => '';

let turno: any[] = [];
let turnoHasta = 0;
async function refrescarTurno() {
  if (!pedirTurno || Date.now() < turnoHasta) return;
  try {
    const s = await pedirTurno();
    if (Array.isArray(s) && s.length) {
      turno = s;
      turnoHasta = Date.now() + 45 * 60 * 1000;
    }
  } catch {
    /* sin relevo se sigue: la mayoría conecta con STUN */
  }
}
const servidores = () => (turno.length ? [...HIELO, ...turno] : HIELO);

export const cuento = (): Cuento => ({
  estado,
  conQuien,
  soyQuienLlama,
  entrante: entrante ? { de: entrante.de, video: entrante.video } : null,
  flujoLocal: miFlujo,
  flujoRemoto,
  hayVideo: !!miFlujo?.getVideoTracks?.().length,
  micAbierto: !!miFlujo?.getAudioTracks?.()[0]?.enabled,
  camAbierta: !!miFlujo?.getVideoTracks?.()[0]?.enabled,
  porAltavoz,
});

const anunciar = (extra?: Partial<Cuento>) => {
  try {
    avisar({ ...cuento(), ...(extra || {}) });
  } catch {
    /* la pantalla no tumba la llamada */
  }
};

/* ── sonidos: el timbre de la llamada entrante y el tono de la que sale ───────────────────── */

let sonido: Audio.Sound | null = null;
async function sonar(cual: 'timbre' | 'tono') {
  await callar();
  try {
    const { sound } = await Audio.Sound.createAsync(
      cual === 'timbre' ? require('../../assets/llamada/timbre.wav') : require('../../assets/llamada/tono.wav'),
      { isLooping: true, volume: cual === 'timbre' ? 1 : 0.6, shouldPlay: true }
    );
    sonido = sound;
  } catch {
    /* sin sonido la llamada funciona igual */
  }
  if (cual === 'timbre') Vibration.vibrate([0, 700, 1300], true);
}
async function callar() {
  Vibration.cancel();
  const s = sonido;
  sonido = null;
  if (s) {
    try {
      await s.stopAsync();
    } catch {}
    try {
      await s.unloadAsync();
    } catch {}
  }
}

/* ── el audio de LLAMADA (no el de un video) ──────────────────────────────────────────────── */

async function audioArranca(conVideo: boolean) {
  porAltavoz = conVideo;
  try {
    // Voz: auricular primero (se lleva a la oreja). Video: altavoz (nadie mira pegado a la oreja).
    await AudioSession.configureAudio({
      android: {
        preferredOutputList: conVideo ? ['bluetooth', 'headset', 'speaker', 'earpiece'] : ['bluetooth', 'headset', 'earpiece', 'speaker'],
        audioTypeOptions: { audioMode: 'inCommunication', audioAttributesUsageType: 'voiceCommunication', audioAttributesContentType: 'speech', audioStreamType: 'voiceCall', manageAudioFocus: true },
      },
      ios: { defaultOutput: conVideo ? 'speaker' : 'earpiece' },
    });
    await AudioSession.startAudioSession();
  } catch {
    /* sin sesión de audio la llamada se oye igual, solo que peor */
  }
}
async function audioTermina() {
  await callar();
  try {
    await AudioSession.stopAudioSession();
  } catch {}
  porAltavoz = false;
}

/** Manos libres. `undefined` alterna. */
export async function altavoz(encender?: boolean) {
  porAltavoz = encender === undefined ? !porAltavoz : !!encender;
  try {
    if (Platform.OS === 'ios') await AudioSession.selectAudioOutput(porAltavoz ? 'force_speaker' : 'default');
    else await AudioSession.selectAudioOutput(porAltavoz ? 'speaker' : 'earpiece');
  } catch {}
  anunciar();
}

/* ── la conexión ──────────────────────────────────────────────────────────────────────────── */

function armarPlazo() {
  if (relojConexion) clearTimeout(relojConexion);
  relojConexion = setTimeout(() => {
    if (estado !== 'hablando') colgar('sin-camino');
  }, PLAZO_CONEXION);
}

function nuevaConexion(): RTCPeerConnection {
  const c = new RTCPeerConnection({ iceServers: servidores(), iceCandidatePoolSize: 4 });
  const cc = c as any;
  cc.addEventListener('icecandidate', (e: any) => {
    if (!e.candidate || !conQuien) return;
    try {
      tiposVistos.add(e.candidate.type || '?');
    } catch {}
    mandarSenal(conQuien, 'ice', { candidato: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
  });
  cc.addEventListener('track', (e: any) => {
    if (e.streams && e.streams[0]) {
      flujoRemoto = e.streams[0];
      anunciar();
    }
  });
  cc.addEventListener('iceconnectionstatechange', () => {
    if (c.iceConnectionState === 'failed') colgar('sin-camino');
    if (c.iceConnectionState === 'disconnected') {
      // Un corte de un segundo se recupera solo; sin margen, cada túnel tira la llamada.
      setTimeout(() => {
        if (pc === c && c.iceConnectionState === 'disconnected') colgar('corte');
      }, 6000);
    }
  });
  cc.addEventListener('connectionstatechange', () => {
    // «Hablando» SOLO con la conexión de verdad en pie, no cuando alguien contesta.
    if (c.connectionState === 'connected') {
      if (relojConexion) clearTimeout(relojConexion);
      relojConexion = null;
      void callar();
      if (estado !== 'hablando') {
        estado = 'hablando';
        anunciar();
      }
    }
    if (c.connectionState === 'failed') colgar('sin-camino');
  });
  return c;
}

/** Los permisos se piden al llamar o contestar: un permiso que salta sin motivo se niega. */
async function permisos(conVideo: boolean) {
  if (Platform.OS !== 'android') return true;
  const PA = RN.PermissionsAndroid;
  const quiere = [PA.PERMISSIONS.RECORD_AUDIO];
  if (conVideo) quiere.push(PA.PERMISSIONS.CAMERA);
  try {
    const r = await PA.requestMultiple(quiere);
    return quiere.every((p) => r[p] === PA.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

async function abrirMedios(conVideo: boolean): Promise<MediaStream> {
  if (!(await permisos(conVideo))) throw Object.assign(new Error('sin-permiso'), { motivo: 'sin-permiso' });
  return (await mediaDevices.getUserMedia({
    audio: true,
    video: conVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
  } as any)) as MediaStream;
}

async function vaciarCola() {
  const cola = iceEnCola;
  iceEnCola = [];
  for (const cand of cola) {
    try {
      await pc?.addIceCandidate(new RTCIceCandidate(cand));
    } catch {
      /* uno malo no tumba la llamada */
    }
  }
}

/* ── llamar, contestar, rechazar, colgar ──────────────────────────────────────────────────── */

export async function llamar(correo: string, conVideo: boolean) {
  if (estado !== 'libre') throw new Error('ya hay una llamada');
  conQuien = String(correo || '').toLowerCase();
  soyQuienLlama = true;
  estado = 'llamando';
  iceEnCola = [];
  anunciar();
  try {
    await refrescarTurno();
    miFlujo = await abrirMedios(conVideo);
    await audioArranca(conVideo);
    pc = nuevaConexion();
    miFlujo.getTracks().forEach((t) => pc!.addTrack(t, miFlujo!));
    armarPlazo();
    const oferta = await pc.createOffer({});
    await pc.setLocalDescription(oferta);
    mandarSenal(conQuien, 'llamo', { video: !!conVideo, sdp: (pc.localDescription as any).toJSON() });
    void sonar('tono');
    anunciar();
  } catch (e: any) {
    colgar(e?.motivo === 'sin-permiso' ? 'sin-permiso' : 'no-se-pudo');
    throw e;
  }
}

export async function contestar(conVideo: boolean) {
  if (!entrante) return;
  const { de, sdp } = entrante;
  await callar();
  conQuien = de;
  soyQuienLlama = false;
  estado = 'conectando';
  anunciar();
  try {
    await refrescarTurno();
    miFlujo = await abrirMedios(conVideo);
    await audioArranca(conVideo);
    pc = nuevaConexion();
    miFlujo.getTracks().forEach((t) => pc!.addTrack(t, miFlujo!));
    armarPlazo();
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await vaciarCola();
    const resp = await pc.createAnswer();
    await pc.setLocalDescription(resp);
    mandarSenal(conQuien, 'respuesta', { sdp: (pc.localDescription as any).toJSON() });
    entrante = null;
    anunciar();
  } catch (e: any) {
    colgar(e?.motivo === 'sin-permiso' ? 'sin-permiso' : 'no-se-pudo');
    throw e;
  }
}

export function rechazar() {
  if (!entrante) return;
  mandarSenal(entrante.de, 'rechazo', {});
  entrante = null;
  estado = 'libre';
  conQuien = null;
  void audioTermina();
  anunciar({ motivo: 'yo' });
}

function soltarTodo() {
  void audioTermina();
  try {
    miFlujo?.getTracks?.().forEach((t) => t.stop());
  } catch {}
  try {
    pc?.close?.();
  } catch {}
  miFlujo = null;
  flujoRemoto = null;
  pc = null;
  iceEnCola = [];
}

/** Cuelga. El motivo viaja a la pantalla: no es lo mismo «colgaste» que «no había camino». */
export function colgar(motivo: Motivo = 'yo') {
  const otro = conQuien;
  const avisarAlOtro = !!otro && (motivo === 'yo' || motivo === 'corte') && estado !== 'libre';
  const hizoFaltaRelevo = motivo === 'sin-camino' && !tiposVistos.has('relay');
  if (relojConexion) clearTimeout(relojConexion);
  relojConexion = null;
  tiposVistos = new Set();
  soltarTodo();
  estado = 'libre';
  conQuien = null;
  soyQuienLlama = false;
  entrante = null;
  if (avisarAlOtro && otro) {
    try {
      mandarSenal(otro, 'cuelgo', {});
    } catch {}
  }
  anunciar({ motivo, hizoFaltaRelevo });
}

export function micro(encender?: boolean) {
  const t = miFlujo?.getAudioTracks?.()[0];
  if (!t) return;
  t.enabled = encender === undefined ? !t.enabled : !!encender;
  anunciar();
}

export function camara(encender?: boolean) {
  const t = miFlujo?.getVideoTracks?.()[0];
  if (!t) return;
  t.enabled = encender === undefined ? !t.enabled : !!encender;
  anunciar();
}

export function voltear() {
  const t: any = miFlujo?.getVideoTracks?.()[0];
  try {
    t?._switchCamera?.();
  } catch {}
}

/* ── lo que llega del otro lado ───────────────────────────────────────────────────────────── */

export const ES_DE_LLAMADA = (tipo: string) => ['llamo', 'respuesta', 'ice', 'cuelgo', 'rechazo', 'ocupado', 'atendida'].includes(tipo);

export async function recibir(s: { de: string; tipo: string; datos?: any; desde?: string }) {
  const de = String(s.de || '').toLowerCase();
  const d = s.datos || {};
  try {
    if (s.tipo === 'llamo') {
      if (estado !== 'libre') {
        mandarSenal(de, 'ocupado', {});
        return;
      }
      entrante = { de, video: !!d.video, sdp: d.sdp };
      conQuien = de;
      estado = 'entrando';
      void sonar('timbre');
      anunciar();
      return;
    }
    // Contestó (o rechazó) OTRO aparato de esta misma cuenta: aquí se deja de sonar.
    if (s.tipo === 'atendida') {
      if (s.desde && s.desde === miAparato()) return;
      if (estado === 'entrando' && de === conQuien) {
        entrante = null;
        estado = 'libre';
        conQuien = null;
        void audioTermina();
        anunciar({ motivo: 'en-otro-aparato' });
      }
      return;
    }
    if (de !== conQuien) return;
    if (s.tipo === 'respuesta' && pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      await vaciarCola();
      anunciar();
      return;
    }
    if (s.tipo === 'ice') {
      const cand = d.candidato;
      if (!cand) return;
      if (pc?.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {}
      } else {
        iceEnCola.push(cand);
      }
      return;
    }
    if (s.tipo === 'cuelgo') return colgar('el-otro');
    if (s.tipo === 'rechazo') return colgar('rechazada');
    if (s.tipo === 'ocupado') return colgar('ocupado');
  } catch {
    colgar('no-se-pudo');
  }
}

/** Lo enchufa la app: cómo mandar señales, a quién avisar, de dónde sale el TURN y qué aparato soy. */
export function arrancar(o: {
  mandar: (para: string, tipo: string, datos: unknown) => void;
  alCambiar: (c: Cuento) => void;
  traerTurno?: () => Promise<any[]>;
  aparato?: () => string;
}) {
  mandarSenal = o.mandar;
  avisar = o.alCambiar;
  pedirTurno = o.traerTurno || null;
  miAparato = o.aparato || (() => '');
  void refrescarTurno();
}

export const enLlamada = () => estado !== 'libre';
