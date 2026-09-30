/**
 * Llamadas de voz y video de PULSE2CHAT, desde AU-RA.
 *
 * Portado de `orden-global-app/src/og/llamada.js`. EL PROTOCOLO ES EL MISMO, letra por letra, porque
 * AU-RA tiene que poder llamar a un navegador y a la app Orden Global y al revés:
 *
 *   llamo      { video, sdp }   quien llama, con su oferta dentro
 *   respuesta  { sdp }          quien contesta (y quien recibe un reinicio de ICE)
 *   oferta     { sdp }          reinicio de ICE en plena llamada (lo manda la web al perder el camino)
 *   ice        { candidato }    caminos de red
 *   rechazo    { motivo? }      no contestó; `motivo: 'sin-permiso'` = quiso y el teléfono no le dejó
 *   ocupado · cuelgo  {}
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
 * LA REGLA DE ESTE ARCHIVO: cada llamada tiene su FICHA (`ficha`, un número). Todo lo que espera
 * —un permiso, el TURN, la cámara, el relevo— vuelve y pregunta si su ficha sigue siendo la vigente;
 * si alguien colgó mientras tanto, suelta lo que abrió y se va sin tocar nada. Sin eso, colgar con el
 * diálogo de permisos abierto dejaba el tono sonando, el micrófono abierto y un `llamo` sin destino.
 *
 * EL AUDIO Y AURA: la conversación con ElevenLabs usa la MISMA sesión de audio de LiveKit, y al
 * cerrarse la para (después de desconectar). En Android ese `stop` anula incluso un `start` pendiente:
 * si la llamada arrancaba su audio mientras AURA todavía se cerraba, se quedaba sin audio. Por eso,
 * antes de arrancar el suyo, la llamada espera el aviso `voz {libre:true}` del bus (con tope de 2,5 s),
 * y al conectar de verdad lo vuelve a aplicar una vez (por si un cierre tardío se lo apagó igual).
 *
 * EL SERVICIO EN SEGUNDO PLANO: Android 14 no deja arrancar un servicio de micrófono con la app
 * detrás (lanza una excepción nativa). Con la app detrás solo se actualiza el texto de la
 * notificación del servicio que ya corre; nunca se vuelve a arrancar.
 *
 * Este archivo no sabe cómo se ve una llamada: entrega el estado y los flujos, la pantalla pinta.
 * Sí avisa en el bus del contrato (`llamada`) cuando empieza y cuando termina: AURA y la mesa se
 * apagan mientras tanto.
 */
import * as RN from 'react-native';
import { Linking, Platform, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import { RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, mediaDevices, type MediaStream } from '@livekit/react-native-webrtc';
import { AudioSession } from '@livekit/react-native';
import { emitir, escuchar } from '../nucleo/contrato';
import * as SERVICIO from './servicioLlamada';

const HIELO = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
/** Desde que hay respuesta hasta que la conexión está en pie. Sin plazo, «no pasa nada» se ve igual que «va a conectar». */
const PLAZO_CONEXION = 20_000;
/** Lo que suena una llamada sin contestar, de los dos lados. Después: «no contestó» / «llamada perdida». */
const PLAZO_TIMBRE = 45_000;
/** Un corte de red en plena llamada: se intenta un camino nuevo y se espera esto antes de colgar (igual que la web). */
const PLAZO_CORTE = 10_000;
/** Cuánto espera quien llamó antes de pedir él el reinicio de ICE: la web lo pide al instante, y dos a la vez chocan. */
const ESPERA_REINICIO = 1_500;
/** El TURN se pide con plazo corto: sin él la mayoría conecta por STUN, y 15 s de espera muda no se aguantan. */
const PLAZO_TURNO = 2_500;
/** Un `ice` que llega antes que su `llamo` (van en peticiones separadas, sin orden) se guarda este rato. */
const VIDA_HUERFANO = 10_000;
/** Lo más que se espera a que la conversación de AURA suelte el audio antes de arrancar el de la llamada. */
export const PLAZO_VOZ_LIBRE = 2_500;

export type EstadoLlamada = 'libre' | 'llamando' | 'entrando' | 'conectando' | 'hablando';
export type Motivo =
  | 'yo'
  | 'el-otro'
  | 'rechazada'
  | 'el-otro-sin-permiso'
  | 'ocupado'
  | 'no-contesto'
  | 'perdida'
  | 'sin-camino'
  | 'corte'
  | 'no-se-pudo'
  | 'sin-permiso'
  | 'en-otro-aparato'
  | 'rechazada-en-otro-aparato'
  | 'atendida-en-otro-aparato'
  | 'no-te-acepto'
  | 'senal-grande'
  | 'demasiadas'
  | 'sin-red'
  | 'no-llego';
export type Cuento = {
  estado: EstadoLlamada;
  conQuien: string | null;
  soyQuienLlama: boolean;
  entrante: { de: string; video: boolean } | null;
  flujoLocal: MediaStream | null;
  flujoRemoto: MediaStream | null;
  /** Hay cámara PROPIA (aunque esté tapada). Decide los botones de cámara, no la vista grande. */
  hayVideo: boolean;
  /** Llega video del OTRO: esto decide si su imagen ocupa la pantalla. */
  videoRemoto: boolean;
  /** La llamada se pidió (o se contestó) con video. */
  conVideo: boolean;
  micAbierto: boolean;
  camAbierta: boolean;
  porAltavoz: boolean;
  /** Se cayó el camino en plena llamada y se está buscando otro (hasta 10 s). */
  reconectando: boolean;
  motivo?: Motivo;
  hizoFaltaRelevo?: boolean;
  /** El permiso quedó en «no volver a preguntar»: la pantalla ofrece abrir los Ajustes del sistema. */
  abrirAjustes?: boolean;
};

let pc: RTCPeerConnection | null = null;
let miFlujo: MediaStream | null = null;
let flujoRemoto: MediaStream | null = null;
let estado: EstadoLlamada = 'libre';
let conQuien: string | null = null;
let soyQuienLlama = false;
let entrante: { de: string; video: boolean; sdp: any } | null = null;
let conVideo = false;
/** La ficha de la llamada vigente. Cambia al empezar una y al terminarla. */
let ficha = 0;
/** El otro ya sabe de esta llamada (le llegó el `llamo`, o es él quien llama): colgar le avisa. */
let otroSabe = false;
/** La conexión llegó a estar en pie alguna vez (un corte después se reintenta; antes, no hay camino). */
let yaConecto = false;
let iceEnCola: any[] = [];
/** Caminos propios que salen antes de que el `llamo` haya llegado: sin esto el otro los tira. */
let iceSaliente: any[] = [];
const huerfanos = new Map<string, { cands: any[]; reloj: ReturnType<typeof setTimeout> }>();
let relojConexion: ReturnType<typeof setTimeout> | null = null;
let relojTimbre: ReturnType<typeof setTimeout> | null = null;
let relojCorte: ReturnType<typeof setTimeout> | null = null;
let relojReinicio: ReturnType<typeof setTimeout> | null = null;
let tiposVistos = new Set<string>();
let porAltavoz = false;
/** Lo último que se avisó en el bus: para decir «terminó» una sola vez y con el mismo `video`. */
let activaAvisada: { video: boolean } | null = null;

let mandarSenal: (para: string, tipo: string, datos: unknown) => void | Promise<unknown> = () => {};
let avisar: (c: Cuento) => void = () => {};
let pedirTurno: (() => Promise<any[]>) | null = null;
let miAparato: () => string = () => '';
let miCorreo: () => string = correoDelRelevo;
let nombreDe: (correo: string) => string = (c) => String(c || '').split('@')[0];

/** Sin que la app lo diga, el correo propio sale de la cuenta del relevo (lo necesita el desempate). */
function correoDelRelevo(): string {
  try {
    return String(require('./relevo').quien()?.correo || '').toLowerCase();
  } catch {
    return '';
  }
}

const vigente = (mia: number) => mia === ficha;

/* ── el TURN: con caché de 45 min y plazo corto ───────────────────────────────────────────── */

let turno: any[] = [];
let turnoHasta = 0;
let turnoEnCamino: Promise<void> | null = null;
function refrescarTurno(): Promise<void> {
  if (!pedirTurno || Date.now() < turnoHasta) return Promise.resolve();
  if (!turnoEnCamino) {
    const pedir = pedirTurno;
    turnoEnCamino = (async () => {
      try {
        const s = await pedir();
        if (Array.isArray(s) && s.length) {
          turno = s;
          turnoHasta = Date.now() + 45 * 60 * 1000;
        }
      } catch {
        /* sin relevo se sigue: la mayoría conecta con STUN */
      } finally {
        turnoEnCamino = null;
      }
    })();
  }
  return turnoEnCamino;
}
/** Espera el TURN como mucho PLAZO_TURNO; si tarda más, sigue pidiéndose por detrás para la próxima. */
async function turnoConPlazo() {
  let reloj: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([refrescarTurno(), new Promise<void>((r) => (reloj = setTimeout(r, PLAZO_TURNO)))]);
  if (reloj) clearTimeout(reloj);
}
const servidores = () => (turno.length ? [...HIELO, ...turno] : HIELO);

/* ── lo que ve la pantalla ────────────────────────────────────────────────────────────────── */

export const cuento = (): Cuento => ({
  estado,
  conQuien,
  soyQuienLlama,
  entrante: entrante ? { de: entrante.de, video: entrante.video } : null,
  flujoLocal: miFlujo,
  flujoRemoto,
  hayVideo: !!miFlujo?.getVideoTracks?.().length,
  videoRemoto: !!flujoRemoto?.getVideoTracks?.().length,
  conVideo,
  micAbierto: !!miFlujo?.getAudioTracks?.()[0]?.enabled,
  camAbierta: !!miFlujo?.getVideoTracks?.()[0]?.enabled,
  porAltavoz,
  reconectando: !!relojCorte,
});

/** Avisa a la pantalla y, si cambió de «libre» a «en llamada» o al revés, al bus del contrato. */
const anunciar = (extra?: Partial<Cuento>) => {
  const activa = estado !== 'libre';
  if (activa && !activaAvisada) {
    activaAvisada = { video: conVideo };
    emitir('llamada', { activa: true, video: conVideo });
  } else if (!activa && activaAvisada) {
    const { video } = activaAvisada;
    activaAvisada = null;
    emitir('llamada', { activa: false, video });
  }
  try {
    avisar({ ...cuento(), ...(extra || {}) });
  } catch {
    /* la pantalla no tumba la llamada */
  }
};

/** Manda una señal sin esperar. Un fallo aquí lo cubren los plazos. */
function enviar(para: string, tipo: string, datos: unknown) {
  try {
    const r: any = mandarSenal(para, tipo, datos);
    if (r && typeof r.then === 'function') r.then(undefined, () => {});
  } catch {
    /* el relevo no tumba la llamada */
  }
}

/**
 * El `llamo` SÍ se espera: si no llegó, la persona tiene que saber por qué. El relevo lanza el error
 * con su `code` (403 no te aceptó, 413 señal grande, 429 demasiadas); sin código es que no hubo red.
 * `null` es lo que devuelve `relevo.senalar` cuando se tragó el error: no llegó, sin saber por qué.
 */
async function enviarLlamo(para: string, datos: unknown): Promise<Motivo | null> {
  try {
    const r = await mandarSenal(para, 'llamo', datos);
    return r === null ? 'no-llego' : null;
  } catch (e: any) {
    const code = Number(e?.code || e?.status || 0);
    if (code === 403) return 'no-te-acepto';
    if (code === 413) return 'senal-grande';
    if (code === 429) return 'demasiadas';
    return code ? 'no-llego' : 'sin-red';
  }
}

/* ── sonidos: el timbre de la llamada entrante y el tono de la que sale ───────────────────── */

let sonido: Audio.Sound | null = null;
/** Cada `sonar` y cada `callar` cambian la generación: un sonido que termina de cargar tarde se descarga solo. */
let genSonido = 0;
async function sonar(cual: 'timbre' | 'tono') {
  callar();
  const mia = genSonido;
  try {
    const { sound } = await Audio.Sound.createAsync(
      cual === 'timbre' ? require('../../assets/llamada/timbre.wav') : require('../../assets/llamada/tono.wav'),
      { isLooping: true, volume: cual === 'timbre' ? 1 : 0.6, shouldPlay: true }
    );
    if (mia !== genSonido) {
      // Se colgó (o se contestó) mientras cargaba: este sonido ya no tiene a quién sonarle.
      void descargar(sound);
      return;
    }
    sonido = sound;
  } catch {
    /* sin sonido la llamada funciona igual */
  }
  if (cual === 'timbre' && mia === genSonido) Vibration.vibrate([0, 700, 1300], true);
}
function callar() {
  genSonido++;
  Vibration.cancel();
  const s = sonido;
  sonido = null;
  if (s) void descargar(s);
}
async function descargar(s: Audio.Sound) {
  try {
    await s.stopAsync();
  } catch {}
  try {
    await s.unloadAsync();
  } catch {}
}

/* ── la voz de AURA suelta el audio ───────────────────────────────────────────────────────── */

/** La conversación con ElevenLabs no tiene tomado el audio (lo avisa el VozProvider por el bus). */
let vozLibre = true;
const esperanVoz = new Set<() => void>();
escuchar('voz', ({ libre }) => {
  vozLibre = !!libre;
  if (!vozLibre) return;
  for (const f of [...esperanVoz]) f();
});

/** Espera a que AURA suelte el audio, como mucho `tope` ms (si no avisa, la llamada sigue igual). */
export function esperarVozLibre(tope = PLAZO_VOZ_LIBRE): Promise<void> {
  if (vozLibre) return Promise.resolve();
  return new Promise<void>((listo) => {
    let reloj: ReturnType<typeof setTimeout> | null = null;
    const fin = () => {
      esperanVoz.delete(fin);
      if (reloj) clearTimeout(reloj);
      reloj = null;
      listo();
    };
    esperanVoz.add(fin);
    reloj = setTimeout(fin, tope);
  });
}

/** ¿La app está delante? (sin AppState, como en las pruebas viejas, se asume que sí). */
const delante = () => {
  const st = (RN as { AppState?: { currentState?: string | null } }).AppState?.currentState;
  return !st || st === 'active';
};

/* ── el audio de LLAMADA (no el de un video) ──────────────────────────────────────────────── */

/** `altavoz`: por dónde sale (por omisión, lo del tipo de llamada; al re-aplicar, lo que eligió la persona). */
async function audioArranca(video: boolean, altavoz = video) {
  porAltavoz = altavoz;
  try {
    // Voz: auricular primero (se lleva a la oreja). Video: altavoz (nadie mira pegado a la oreja).
    await AudioSession.configureAudio({
      android: {
        preferredOutputList: altavoz ? ['bluetooth', 'headset', 'speaker', 'earpiece'] : ['bluetooth', 'headset', 'earpiece', 'speaker'],
        audioTypeOptions: { audioMode: 'inCommunication', audioAttributesUsageType: 'voiceCommunication', audioAttributesContentType: 'speech', audioStreamType: 'voiceCall', manageAudioFocus: true },
      },
      ios: { defaultOutput: altavoz ? 'speaker' : 'earpiece' },
    });
    await AudioSession.startAudioSession();
  } catch {
    /* sin sesión de audio la llamada se oye igual, solo que peor */
  }
}
async function audioTermina() {
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

/* ── relojes ──────────────────────────────────────────────────────────────────────────────── */

function parar(r: ReturnType<typeof setTimeout> | null) {
  if (r) clearTimeout(r);
  return null;
}
function pararRelojes() {
  relojConexion = parar(relojConexion);
  relojTimbre = parar(relojTimbre);
  relojCorte = parar(relojCorte);
  relojReinicio = parar(relojReinicio);
}

/** Desde la respuesta (quien llama) o desde que se contesta (quien recibe): 20 s para tener camino. */
function armarConexion() {
  relojConexion = parar(relojConexion);
  relojConexion = setTimeout(() => {
    relojConexion = null;
    if (estado === 'conectando') colgar('sin-camino');
  }, PLAZO_CONEXION);
}

/** Lo que suena sin que nadie conteste. Quien llama cuelga (y avisa); quien recibe deja de sonar. */
function armarTimbre() {
  relojTimbre = parar(relojTimbre);
  relojTimbre = setTimeout(() => {
    relojTimbre = null;
    if (estado === 'llamando') colgar('no-contesto');
    else if (estado === 'entrando') terminar('perdida', null);
  }, PLAZO_TIMBRE);
}

/* ── los caminos (ICE) ────────────────────────────────────────────────────────────────────── */

/** Guarda un `ice` que llegó antes que su llamada. Se borra solo a los pocos segundos. */
function guardarHuerfano(de: string, cand: any) {
  const g = huerfanos.get(de);
  if (g) clearTimeout(g.reloj);
  const cands = g ? [...g.cands, cand] : [cand];
  huerfanos.set(de, { cands, reloj: setTimeout(() => huerfanos.delete(de), VIDA_HUERFANO) });
}
function tomarHuerfanos(de: string): any[] {
  const g = huerfanos.get(de);
  if (!g) return [];
  clearTimeout(g.reloj);
  huerfanos.delete(de);
  return g.cands;
}

async function vaciarCola(c: RTCPeerConnection) {
  const cola = iceEnCola;
  iceEnCola = [];
  for (const cand of cola) {
    try {
      await c.addIceCandidate(new RTCIceCandidate(cand));
    } catch {
      /* uno malo (o de una oferta vieja) no tumba la llamada */
    }
  }
}

function soltarIceSaliente() {
  const cola = iceSaliente;
  iceSaliente = [];
  if (conQuien) for (const candidato of cola) enviar(conQuien, 'ice', { candidato });
}

/* ── la conexión ──────────────────────────────────────────────────────────────────────────── */

function nuevaConexion(): RTCPeerConnection {
  const c = new RTCPeerConnection({ iceServers: servidores(), iceCandidatePoolSize: 4 });
  const cc = c as any;
  // Cada evento pregunta primero si esta conexión sigue siendo LA conexión: una cerrada no manda nada.
  cc.addEventListener('icecandidate', (e: any) => {
    if (pc !== c || !e.candidate || !conQuien) return;
    try {
      tiposVistos.add(e.candidate.type || '?');
    } catch {}
    const candidato = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
    if (!otroSabe) iceSaliente.push(candidato);
    else enviar(conQuien, 'ice', { candidato });
  });
  cc.addEventListener('track', (e: any) => {
    if (pc !== c) return;
    if (e.streams && e.streams[0]) {
      flujoRemoto = e.streams[0];
      anunciar();
    }
  });
  cc.addEventListener('iceconnectionstatechange', () => {
    if (pc !== c) return;
    const st = c.iceConnectionState;
    if (st === 'connected' || st === 'completed') {
      if (relojCorte) {
        relojCorte = parar(relojCorte);
        relojReinicio = parar(relojReinicio);
        anunciar();
      }
      return;
    }
    if (st === 'failed' && !yaConecto) return colgar('sin-camino');
    if ((st === 'disconnected' || st === 'failed') && yaConecto) caida(c);
  });
  cc.addEventListener('connectionstatechange', () => {
    if (pc !== c) return;
    // «Hablando» SOLO con la conexión de verdad en pie, no cuando alguien contesta.
    if (c.connectionState === 'connected') {
      yaConecto = true;
      relojConexion = parar(relojConexion);
      relojCorte = parar(relojCorte);
      relojReinicio = parar(relojReinicio);
      callar();
      if (estado !== 'hablando') {
        estado = 'hablando';
        arrancarServicio();
        // Una vez al conectar: si el cierre de AURA le apagó el audio igual (un `stop` tardío), vuelve.
        void audioArranca(conVideo, porAltavoz);
      }
      anunciar();
    }
    if (c.connectionState === 'failed') {
      if (yaConecto) caida(c);
      else colgar('sin-camino');
    }
  });
  return c;
}

/**
 * Se perdió el camino en plena llamada. Un túnel o un cambio de wifi a datos se recupera con un
 * camino nuevo: quien llamó pide el reinicio de ICE (si la web no lo pidió antes) y, si a los 10 s
 * sigue caído, ahí sí se cuelga.
 */
function caida(c: RTCPeerConnection) {
  if (!relojCorte) {
    relojCorte = setTimeout(() => {
      relojCorte = null;
      const st = c.iceConnectionState;
      if (pc === c && (st === 'disconnected' || st === 'failed' || st === 'checking')) colgar('corte');
    }, PLAZO_CORTE);
    anunciar();
  }
  if (soyQuienLlama && !relojReinicio) {
    relojReinicio = setTimeout(() => {
      relojReinicio = null;
      if (pc === c && c.signalingState === 'stable' && relojCorte) void reiniciarIce(c);
    }, ESPERA_REINICIO);
  }
}

async function reiniciarIce(c: RTCPeerConnection) {
  try {
    const oferta = await c.createOffer({ iceRestart: true } as any);
    if (pc !== c || c.signalingState !== 'stable') return;
    await c.setLocalDescription(oferta);
    if (pc !== c || !conQuien) return;
    enviar(conQuien, 'oferta', { sdp: (c.localDescription as any).toJSON() });
  } catch {
    /* un reinicio fallido no tumba la llamada: el plazo de corte sí */
  }
}

/* ── permisos y medios ────────────────────────────────────────────────────────────────────── */

type Permisos = { mic: boolean; cam: boolean; nunca: boolean };

/**
 * Los permisos se piden al llamar o contestar: un permiso que salta sin motivo se niega. Van juntos en
 * un solo diálogo: micrófono (obligatorio), cámara si es video (sin ella se sigue con voz), Bluetooth
 * (Android 12+: sin él los audífonos inalámbricos no se eligen) y avisos (Android 13+: la notificación
 * de la llamada en curso, con su botón de colgar).
 */
async function permisos(quiereVideo: boolean): Promise<Permisos> {
  if (Platform.OS !== 'android') return { mic: true, cam: quiereVideo, nunca: false };
  const PA = RN.PermissionsAndroid;
  const P = PA.PERMISSIONS as Record<string, string>;
  const version = Number(Platform.Version) || 0;
  const quiere: string[] = [P.RECORD_AUDIO];
  if (quiereVideo) quiere.push(P.CAMERA);
  if (version >= 31 && P.BLUETOOTH_CONNECT) quiere.push(P.BLUETOOTH_CONNECT);
  if (version >= 33 && P.POST_NOTIFICATIONS) quiere.push(P.POST_NOTIFICATIONS);
  try {
    const r = (await PA.requestMultiple(quiere as any)) as Record<string, string>;
    return {
      mic: r[P.RECORD_AUDIO] === PA.RESULTS.GRANTED,
      cam: quiereVideo && r[P.CAMERA] === PA.RESULTS.GRANTED,
      nunca: r[P.RECORD_AUDIO] === PA.RESULTS.NEVER_ASK_AGAIN,
    };
  } catch {
    return { mic: false, cam: false, nunca: false };
  }
}

async function abrirMedios(quiereVideo: boolean): Promise<{ flujo: MediaStream; video: boolean }> {
  const p = await permisos(quiereVideo);
  if (!p.mic) throw Object.assign(new Error('sin-permiso'), { motivo: 'sin-permiso', nunca: p.nunca });
  // Sin cámara pero con micrófono, la llamada sigue: de voz.
  const video = quiereVideo && p.cam;
  const flujo = (await mediaDevices.getUserMedia({
    audio: true,
    video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
  } as any)) as MediaStream;
  return { flujo, video };
}

/** Suelta DE VERDAD: parar cada pista no basta en 144.x, hay que liberar el flujo (si no, la cámara queda tomada). */
function soltarMedios(flujo: MediaStream | null, conexion: RTCPeerConnection | null) {
  try {
    flujo?.getTracks?.().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });
  } catch {}
  try {
    (flujo as any)?.release?.(true);
  } catch {}
  try {
    conexion?.close?.();
  } catch {}
}

/**
 * Arranca el servicio de la llamada o, si ya corre, le cambia el texto. Con la app DETRÁS nunca lo
 * arranca (Android 14 lanza una excepción nativa con un servicio de micrófono desde segundo plano):
 * solo actualiza la notificación del que ya está.
 */
function arrancarServicio() {
  if (!conQuien) return;
  const o = {
    nombre: nombreDe(conQuien),
    video: !!miFlujo?.getVideoTracks?.().length,
    estado: (estado === 'hablando' ? 'hablando' : estado === 'llamando' ? 'llamando' : 'conectando') as SERVICIO.EstadoServicio,
    alColgar: () => colgar('yo'),
  };
  if (delante()) void SERVICIO.arrancar(o);
  else void SERVICIO.actualizar(o);
}

/* ── llamar, contestar, rechazar, colgar ──────────────────────────────────────────────────── */

/**
 * Lo que abrió una llamada que ya no es la vigente (colgaron mientras esperaba) se suelta aquí. La
 * sesión de audio solo se cierra si no hay otra llamada en pie que la esté usando.
 */
function abandonar(flujo: MediaStream | null, conexion: RTCPeerConnection | null) {
  soltarMedios(flujo, conexion);
  if (estado === 'libre') void audioTermina();
}

export async function llamar(correo: string, quiereVideo: boolean) {
  if (estado !== 'libre') throw new Error('ya hay una llamada');
  const mia = ++ficha;
  conQuien = String(correo || '').toLowerCase();
  soyQuienLlama = true;
  estado = 'llamando';
  conVideo = !!quiereVideo;
  otroSabe = false;
  yaConecto = false;
  iceEnCola = [];
  iceSaliente = [];
  anunciar();
  let flujo: MediaStream | null = null;
  let conexion: RTCPeerConnection | null = null;
  try {
    await turnoConPlazo();
    if (!vigente(mia)) return;
    const m = await abrirMedios(!!quiereVideo);
    flujo = m.flujo;
    if (!vigente(mia)) return abandonar(flujo, null);
    miFlujo = flujo;
    conVideo = m.video;
    await esperarVozLibre();
    if (!vigente(mia)) return abandonar(flujo, null);
    await audioArranca(m.video);
    if (!vigente(mia)) return abandonar(flujo, null);
    // Aquí la app está delante (se acaba de tocar «llamar»): Android deja arrancar el servicio de micrófono.
    arrancarServicio();
    conexion = pc = nuevaConexion();
    flujo.getTracks().forEach((t) => conexion!.addTrack(t, flujo!));
    const oferta = await conexion.createOffer({});
    if (!vigente(mia)) return abandonar(flujo, conexion);
    await conexion.setLocalDescription(oferta);
    if (!vigente(mia)) return abandonar(flujo, conexion);
    void sonar('tono');
    anunciar();
    const fallo = await enviarLlamo(conQuien, { video: m.video, sdp: (conexion.localDescription as any).toJSON() });
    // Si la ficha cambió, quien la cambió (colgar, o el desempate de llamadas cruzadas) ya soltó todo.
    if (!vigente(mia)) return;
    if (fallo) return terminar(fallo, null);
    otroSabe = true;
    soltarIceSaliente();
    if (estado === 'llamando') armarTimbre();
  } catch (e: any) {
    if (!vigente(mia)) return abandonar(flujo, conexion);
    terminar(e?.motivo === 'sin-permiso' ? 'sin-permiso' : 'no-se-pudo', null, e?.nunca ? { abrirAjustes: true } : undefined);
    throw e;
  }
}

export async function contestar(quiereVideo: boolean) {
  // Guardia SÍNCRONA: un doble toque en «Contestar» no abre dos conexiones.
  if (estado !== 'entrando' || !entrante) return;
  const mia = ++ficha;
  const de = entrante.de;
  conQuien = de;
  soyQuienLlama = false;
  otroSabe = true;
  estado = 'conectando';
  conVideo = !!quiereVideo && entrante.video;
  relojTimbre = parar(relojTimbre);
  callar();
  anunciar();
  let flujo: MediaStream | null = null;
  let conexion: RTCPeerConnection | null = null;
  try {
    await turnoConPlazo();
    if (!vigente(mia)) return;
    let m: { flujo: MediaStream; video: boolean };
    try {
      m = await abrirMedios(conVideo);
    } catch (e: any) {
      if (!vigente(mia)) return;
      if (e?.motivo !== 'sin-permiso') throw e;
      // Quien llama se entera de que quiso contestar y el teléfono no le dejó (no un «no contestó» mudo).
      return terminar('sin-permiso', 'rechazo', e?.nunca ? { abrirAjustes: true } : undefined, { motivo: 'sin-permiso' });
    }
    flujo = m.flujo;
    if (!vigente(mia)) return abandonar(flujo, null);
    miFlujo = flujo;
    conVideo = m.video;
    await esperarVozLibre();
    if (!vigente(mia)) return abandonar(flujo, null);
    await audioArranca(m.video);
    if (!vigente(mia)) return abandonar(flujo, null);
    arrancarServicio();
    conexion = pc = nuevaConexion();
    flujo.getTracks().forEach((t) => conexion!.addTrack(t, flujo!));
    armarConexion();
    // La oferta más nueva: si quien llama la reemplazó mientras se abría el micrófono, vale la última.
    const oferta = entrante?.sdp;
    if (!oferta) throw new Error('sin oferta');
    await conexion.setRemoteDescription(new RTCSessionDescription(oferta));
    if (!vigente(mia)) return abandonar(flujo, conexion);
    await vaciarCola(conexion);
    const resp = await conexion.createAnswer();
    if (!vigente(mia)) return abandonar(flujo, conexion);
    await conexion.setLocalDescription(resp);
    if (!vigente(mia)) return abandonar(flujo, conexion);
    enviar(de, 'respuesta', { sdp: (conexion.localDescription as any).toJSON() });
    entrante = null;
    anunciar();
  } catch (e: any) {
    if (!vigente(mia)) return abandonar(flujo, conexion);
    terminar('no-se-pudo', 'cuelgo');
    throw e;
  }
}

export function rechazar() {
  if (estado !== 'entrando' || !entrante) return;
  terminar('yo', 'rechazo');
}

/**
 * Todo termina aquí: cambia la ficha (lo que esté esperando se entera y suelta lo suyo), para los
 * relojes, el sonido, los medios, la conexión, el audio y el servicio, avisa al otro si hace falta
 * y le dice a la pantalla por qué terminó.
 */
function terminar(motivo: Motivo, senal: 'cuelgo' | 'rechazo' | null, extra?: Partial<Cuento>, datos: unknown = {}) {
  const otro = conQuien || entrante?.de || null;
  const hizoFaltaRelevo = motivo === 'sin-camino' && !tiposVistos.has('relay');
  ficha++;
  pararRelojes();
  tiposVistos = new Set();
  callar();
  soltarMedios(miFlujo, pc);
  miFlujo = null;
  flujoRemoto = null;
  pc = null;
  iceEnCola = [];
  iceSaliente = [];
  void audioTermina();
  void SERVICIO.detener();
  estado = 'libre';
  conQuien = null;
  soyQuienLlama = false;
  entrante = null;
  otroSabe = false;
  yaConecto = false;
  if (senal && otro) enviar(otro, senal, datos);
  anunciar({ motivo, hizoFaltaRelevo, ...(extra || {}) });
  conVideo = false;
}

/** Los motivos con los que el otro sigue esperando algo de este lado: se le manda `cuelgo`. */
const AVISAN: Motivo[] = ['yo', 'corte', 'sin-camino', 'no-contesto', 'no-se-pudo'];

/** Cuelga. El motivo viaja a la pantalla: no es lo mismo «colgaste» que «no había camino». */
export function colgar(motivo: Motivo = 'yo') {
  if (estado === 'libre') return;
  if (estado === 'entrando' && motivo === 'yo') return rechazar();
  terminar(motivo, otroSabe && AVISAN.includes(motivo) ? 'cuelgo' : null);
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

/** Los Ajustes del sistema de esta app (para el permiso que quedó en «no volver a preguntar»). */
export function abrirAjustes() {
  void Linking.openSettings().catch(() => {});
}

/* ── lo que llega del otro lado ───────────────────────────────────────────────────────────── */

export const ES_DE_LLAMADA = (tipo: string) => ['llamo', 'respuesta', 'oferta', 'ice', 'cuelgo', 'rechazo', 'ocupado', 'atendida'].includes(tipo);

function recibirLlamada(de: string, d: any) {
  entrante = { de, video: !!d.video, sdp: d.sdp };
  conQuien = de;
  soyQuienLlama = false;
  estado = 'entrando';
  conVideo = !!d.video;
  otroSabe = true;
  yaConecto = false;
  iceEnCola = tomarHuerfanos(de);
  armarTimbre();
  void sonar('timbre');
  anunciar();
}

/**
 * Llamadas cruzadas: los dos se llamaron a la vez. Sigue como llamante el correo MENOR; el mayor
 * suelta su intento (sin avisar: el otro ignora esa oferta por la misma regla) y contesta la del otro,
 * con video si él también lo quería. Los `ice` que ya llegaron son de la oferta del otro: se quedan.
 */
function cederLlamada(de: string, d: any) {
  const queriaVideo = conVideo;
  ficha++;
  pararRelojes();
  callar();
  soltarMedios(miFlujo, pc);
  miFlujo = null;
  pc = null;
  flujoRemoto = null;
  iceSaliente = [];
  entrante = { de, video: !!d.video, sdp: d.sdp };
  iceEnCola = [...iceEnCola, ...tomarHuerfanos(de)];
  estado = 'entrando';
  soyQuienLlama = false;
  otroSabe = true;
  void contestar(queriaVideo).catch(() => {});
}

export async function recibir(s: { de: string; tipo: string; datos?: any; desde?: string }) {
  const de = String(s.de || '').toLowerCase();
  const d = s.datos || {};
  try {
    if (s.tipo === 'llamo') {
      if (estado === 'libre') return recibirLlamada(de, d);
      if (de === conQuien) {
        // El mismo contacto vuelve a llamar mientras suena (reintentó): vale su oferta nueva, no «ocupado».
        const sinContestar = estado === 'entrando' || (estado === 'conectando' && !soyQuienLlama && !pc?.remoteDescription);
        if (sinContestar && entrante) {
          entrante = { de, video: !!d.video, sdp: d.sdp };
          iceEnCola = [...iceEnCola, ...tomarHuerfanos(de)];
          if (estado === 'entrando') {
            conVideo = !!d.video;
            armarTimbre();
          }
          anunciar();
          return;
        }
        if (estado === 'llamando' && soyQuienLlama && !pc?.remoteDescription) {
          const yo = miCorreo();
          if (yo && yo < de) return; // sigo llamando: el otro contesta mi oferta
          if (yo && yo > de) return cederLlamada(de, d);
        }
      }
      enviar(de, 'ocupado', {});
      return;
    }
    // Contestó (o rechazó) OTRO aparato de esta misma cuenta: aquí se deja de sonar, y se dice cuál de las dos.
    if (s.tipo === 'atendida') {
      if (s.desde && s.desde === miAparato()) return;
      if (estado === 'entrando' && de === conQuien) {
        const como = String(d.como || '').toLowerCase();
        terminar(/rechaz|ocupad/.test(como) ? 'rechazada-en-otro-aparato' : /respu|contest/.test(como) ? 'en-otro-aparato' : 'atendida-en-otro-aparato', null);
      }
      return;
    }
    if (s.tipo === 'ice') {
      const cand = d.candidato;
      if (!cand) return;
      if (de !== conQuien || estado === 'libre') return guardarHuerfano(de, cand);
      if (pc?.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {}
      } else {
        iceEnCola.push(cand);
      }
      return;
    }
    if (de !== conQuien) return;
    if (s.tipo === 'respuesta') {
      // Solo con una oferta propia esperando: una segunda respuesta (dos aparatos del otro) no tumba nada.
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      const c = pc;
      const inicial = estado === 'llamando';
      try {
        await c.setRemoteDescription(new RTCSessionDescription(d.sdp));
      } catch (e) {
        if (inicial) throw e;
        return; // la respuesta a un reinicio de ICE que no cuajó: decide el plazo de corte
      }
      if (pc !== c) return;
      await vaciarCola(c);
      if (estado === 'llamando') {
        estado = 'conectando';
        otroSabe = true;
        relojTimbre = parar(relojTimbre);
        callar();
        armarConexion();
      }
      anunciar();
      return;
    }
    if (s.tipo === 'oferta') {
      // Reinicio de ICE que pide el otro (la web lo hace al perder el camino). Se contesta con `respuesta`.
      if (!pc || !pc.remoteDescription || (estado !== 'hablando' && estado !== 'conectando')) return;
      const c = pc;
      try {
        if (c.signalingState === 'have-local-offer') {
          // Los dos pidieron reinicio a la vez: cede este lado (la web no sabe ceder).
          await c.setLocalDescription({ type: 'rollback' } as any);
        }
        await c.setRemoteDescription(new RTCSessionDescription(d.sdp));
        if (pc !== c) return;
        await vaciarCola(c);
        const resp = await c.createAnswer();
        if (pc !== c) return;
        await c.setLocalDescription(resp);
        if (pc !== c) return;
        enviar(de, 'respuesta', { sdp: (c.localDescription as any).toJSON() });
      } catch {
        /* un reinicio fallido no tumba la llamada: el plazo de corte sí */
      }
      return;
    }
    if (s.tipo === 'cuelgo') return colgar(estado === 'entrando' ? 'perdida' : 'el-otro');
    if (s.tipo === 'rechazo' || s.tipo === 'ocupado') {
      // Un «rechazo» tardío de OTRO aparato del destinatario no tumba la llamada que ya contestó uno.
      if (!soyQuienLlama || pc?.remoteDescription || estado === 'conectando' || estado === 'hablando') return;
      if (s.tipo === 'ocupado') return colgar('ocupado');
      return colgar(d.motivo === 'sin-permiso' ? 'el-otro-sin-permiso' : 'rechazada');
    }
  } catch {
    colgar('no-se-pudo');
  }
}

/**
 * Lo enchufa la app: cómo mandar señales, a quién avisar, de dónde sale el TURN, qué aparato soy,
 * quién soy (para el desempate de llamadas cruzadas) y cómo se llama cada contacto (la notificación).
 *
 * `mandar` puede devolver la promesa del relevo: el `llamo` se espera y su error se muestra.
 */
export function arrancar(o: {
  mandar: (para: string, tipo: string, datos: unknown) => void | Promise<unknown>;
  alCambiar: (c: Cuento) => void;
  traerTurno?: () => Promise<any[]>;
  aparato?: () => string;
  correo?: () => string;
  nombre?: (correo: string) => string;
}) {
  mandarSenal = o.mandar;
  avisar = o.alCambiar;
  pedirTurno = o.traerTurno || null;
  miAparato = o.aparato || (() => '');
  miCorreo = o.correo ? () => String(o.correo!() || '').toLowerCase() : correoDelRelevo;
  if (o.nombre) nombreDe = o.nombre;
  void refrescarTurno();
}

export const enLlamada = () => estado !== 'libre';
