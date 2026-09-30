/**
 * Llamadas de voz y video de PULSE2CHAT en el Centro (WebRTC del navegador de la WebView2).
 *
 * Portado de `mobile/src/pulse/llamada.ts`. EL PROTOCOLO ES EL MISMO, letra por letra, porque el
 * Centro tiene que poder llamar al teléfono, a la web y a la app Orden Global, y al revés:
 *
 *   llamo      { video, sdp }   quien llama, con su oferta dentro
 *   respuesta  { sdp }          quien contesta (y quien recibe un reinicio de ICE)
 *   oferta     { sdp }          reinicio de ICE en plena llamada
 *   ice        { candidato }    caminos de red
 *   rechazo    { motivo? }      no contestó; `motivo: 'sin-permiso'` = quiso y el equipo no le dejó
 *   ocupado · cuelgo  {}
 *   atendida   { como }         (la pone el relevo) otro aparato de ESTA cuenta contestó o rechazó
 *
 * Y los mismos plazos: 45 s de timbre, 20 s para tener camino después de contestar, 10 s de gracia
 * ante un corte (con reinicio de ICE que pide quien llamó, 1,5 s después), 2,5 s como mucho para el TURN.
 * Llamadas cruzadas: sigue como llamante el correo MENOR; el mayor suelta su intento y contesta.
 *
 * LA REGLA DE ESTE ARCHIVO: cada llamada tiene su FICHA. Todo lo que espera (el micrófono, el TURN,
 * la oferta) vuelve y pregunta si su ficha sigue siendo la vigente; si colgaron mientras tanto, suelta
 * lo que abrió y se va sin tocar nada.
 *
 * Es una FÁBRICA (`crearMotor`): el Centro arma uno con el WebRTC de verdad (index.ts) y las pruebas
 * arman dos, conectados por un bus de mentira. No sabe de pantallas ni de sonidos: los recibe.
 */

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
  | 'sin-microfono'
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
  /** Hay cámara PROPIA (aunque esté tapada). Decide los botones de cámara. */
  hayVideo: boolean;
  /** Llega video del OTRO: decide si su imagen ocupa la pantalla. */
  videoRemoto: boolean;
  /** La llamada se pidió (o se contestó) con video. */
  conVideo: boolean;
  micAbierto: boolean;
  camAbierta: boolean;
  /** Se cayó el camino en plena llamada y se está buscando otro (hasta 10 s). */
  reconectando: boolean;
  /** Cuándo quedó en pie la conexión (para el reloj de la llamada). */
  desde: number | null;
  motivo?: Motivo;
  hizoFaltaRelevo?: boolean;
};

export type Senal = { de: string; tipo: string; datos?: any; desde?: string };

export type Plazos = { conexion: number; timbre: number; corte: number; reinicio: number; turno: number; huerfano: number };
export const PLAZOS: Plazos = { conexion: 20_000, timbre: 45_000, corte: 10_000, reinicio: 1_500, turno: 2_500, huerfano: 10_000 };

export type Medios = { flujo: MediaStream; video: boolean };

export type OpcionesMotor = {
  /** Cómo mandar una señal. Puede devolver la promesa del relevo: el `llamo` se espera y su error se muestra. */
  mandar: (para: string, tipo: string, datos: unknown) => void | Promise<unknown>;
  alCambiar: (c: Cuento) => void;
  traerTurno?: () => Promise<any[]>;
  /** El id de ESTE aparato (para ignorar el `atendida` que causó este mismo). */
  aparato?: () => string;
  /** Quién soy (el desempate de llamadas cruzadas). */
  correo?: () => string;
  /** La conexión (por omisión, `new RTCPeerConnection`). */
  crearConexion?: (cfg: RTCConfiguration) => RTCPeerConnection;
  /** Abre micrófono (y cámara si se pide). LANZA con `motivo: 'sin-permiso' | 'sin-microfono'`. */
  abrirMedios?: (quiereVideo: boolean) => Promise<Medios>;
  /** Una pista nueva de otro dispositivo (cambiar de micrófono o de cámara en plena llamada). */
  abrirPista?: (tipo: 'audio' | 'video', dispositivo: string) => Promise<MediaStreamTrack>;
  /** El timbre (entrante), el tono (saliente) o silencio (`null`). */
  sonar?: (cual: 'timbre' | 'tono' | null) => void;
  plazos?: Partial<Plazos>;
};

const HIELO: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export const ES_DE_LLAMADA = (tipo: string) => ['llamo', 'respuesta', 'oferta', 'ice', 'cuelgo', 'rechazo', 'ocupado', 'atendida'].includes(tipo);

/** Los motivos con los que el otro sigue esperando algo de este lado: se le manda `cuelgo`. */
const AVISAN: Motivo[] = ['yo', 'corte', 'sin-camino', 'no-contesto', 'no-se-pudo'];

type Reloj = ReturnType<typeof setTimeout> | null;

/** Lo que no es un error de verdad: que la descripción venga como objeto plano o con `toJSON`. */
const descripcion = (d: RTCSessionDescription | null): RTCSessionDescriptionInit | null =>
  d ? ((typeof (d as any).toJSON === 'function' ? (d as any).toJSON() : { type: d.type, sdp: d.sdp }) as RTCSessionDescriptionInit) : null;

/** Micrófono con eco cancelado (y el elegido, si hay uno guardado). */
export const restriccionAudio = (mic?: string): MediaTrackConstraints => ({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  ...(mic ? { deviceId: { ideal: mic } } : {}),
});
export const restriccionVideo = (cam?: string): MediaTrackConstraints => ({
  width: { ideal: 1280 },
  height: { ideal: 720 },
  ...(cam ? { deviceId: { ideal: cam } } : { facingMode: 'user' }),
});

/** Por omisión: micrófono y, si se pide, cámara; sin cámara se sigue con voz. */
export async function abrirMediosNavegador(quiereVideo: boolean, pref: { mic?: string; cam?: string } = {}): Promise<Medios> {
  const md = (globalThis as any).navigator?.mediaDevices as MediaDevices | undefined;
  if (!md?.getUserMedia) throw Object.assign(new Error('sin-microfono'), { motivo: 'sin-microfono' });
  const audio = restriccionAudio(pref.mic);
  let error: any = null;
  if (quiereVideo) {
    try {
      const flujo = await md.getUserMedia({ audio, video: restriccionVideo(pref.cam) });
      return { flujo, video: true };
    } catch (e) {
      error = e;
    }
  }
  try {
    return { flujo: await md.getUserMedia({ audio, video: false }), video: false };
  } catch (e: any) {
    error = e || error;
  }
  const nombre = String(error?.name || '');
  const motivo = nombre === 'NotAllowedError' || nombre === 'SecurityError' ? 'sin-permiso' : 'sin-microfono';
  throw Object.assign(new Error(motivo), { motivo });
}

export type Motor = ReturnType<typeof crearMotor>;

export function crearMotor(o: OpcionesMotor) {
  const P: Plazos = { ...PLAZOS, ...(o.plazos || {}) };
  const crearConexion = o.crearConexion || ((cfg: RTCConfiguration) => new RTCPeerConnection(cfg));
  const abrirMedios = o.abrirMedios || ((v: boolean) => abrirMediosNavegador(v));
  const sonido = (cual: 'timbre' | 'tono' | null) => {
    try {
      o.sonar?.(cual);
    } catch {
      /* sin sonido la llamada funciona igual */
    }
  };
  const miAparato = o.aparato || (() => '');
  const miCorreo = () => String(o.correo?.() || '').toLowerCase();

  let pc: RTCPeerConnection | null = null;
  let miFlujo: MediaStream | null = null;
  let flujoRemoto: MediaStream | null = null;
  let estado: EstadoLlamada = 'libre';
  let conQuien: string | null = null;
  let soyQuienLlama = false;
  let entrante: { de: string; video: boolean; sdp: any } | null = null;
  let conVideo = false;
  let ficha = 0;
  let otroSabe = false;
  let yaConecto = false;
  let desde: number | null = null;
  let iceEnCola: any[] = [];
  let iceSaliente: any[] = [];
  const huerfanos = new Map<string, { cands: any[]; reloj: ReturnType<typeof setTimeout> }>();
  let relojConexion: Reloj = null;
  let relojTimbre: Reloj = null;
  let relojCorte: Reloj = null;
  let relojReinicio: Reloj = null;
  let tiposVistos = new Set<string>();

  const vigente = (mia: number) => mia === ficha;

  /* ── el TURN: con caché de 45 min y plazo corto ─────────────────────────────────────────── */

  let turno: any[] = [];
  let turnoHasta = 0;
  let turnoEnCamino: Promise<void> | null = null;
  function refrescarTurno(): Promise<void> {
    if (!o.traerTurno || Date.now() < turnoHasta) return Promise.resolve();
    if (!turnoEnCamino) {
      const traer = o.traerTurno;
      turnoEnCamino = (async () => {
        try {
          const s = await traer();
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
  async function turnoConPlazo() {
    let reloj: Reloj = null;
    await Promise.race([refrescarTurno(), new Promise<void>((r) => (reloj = setTimeout(r, P.turno)))]);
    if (reloj) clearTimeout(reloj);
  }
  const servidores = (): RTCIceServer[] => (turno.length ? [...HIELO, ...turno] : HIELO);

  /* ── lo que ve la pantalla ──────────────────────────────────────────────────────────────── */

  const cuento = (): Cuento => ({
    estado,
    conQuien,
    soyQuienLlama,
    entrante: entrante ? { de: entrante.de, video: entrante.video } : null,
    flujoLocal: miFlujo,
    flujoRemoto,
    hayVideo: !!miFlujo?.getVideoTracks?.().length,
    videoRemoto: !!flujoRemoto?.getVideoTracks?.().some((t) => t.readyState !== 'ended'),
    conVideo,
    micAbierto: !!miFlujo?.getAudioTracks?.()[0]?.enabled,
    camAbierta: !!miFlujo?.getVideoTracks?.()[0]?.enabled,
    reconectando: !!relojCorte,
    desde,
  });

  const anunciar = (extra?: Partial<Cuento>) => {
    try {
      o.alCambiar({ ...cuento(), ...(extra || {}) });
    } catch {
      /* la pantalla no tumba la llamada */
    }
  };

  function enviar(para: string, tipo: string, datos: unknown) {
    try {
      const r: any = o.mandar(para, tipo, datos);
      if (r && typeof r.then === 'function') r.then(undefined, () => {});
    } catch {
      /* el relevo no tumba la llamada */
    }
  }

  /** El `llamo` SÍ se espera: si no llegó, la persona tiene que saber por qué. */
  async function enviarLlamo(para: string, datos: unknown): Promise<Motivo | null> {
    try {
      const r = await o.mandar(para, 'llamo', datos);
      return r === null ? 'no-llego' : null;
    } catch (e: any) {
      const code = Number(e?.code || e?.status || 0);
      if (code === 403) return 'no-te-acepto';
      if (code === 413) return 'senal-grande';
      if (code === 429) return 'demasiadas';
      return code ? 'no-llego' : 'sin-red';
    }
  }

  /* ── relojes ────────────────────────────────────────────────────────────────────────────── */

  function parar(r: Reloj): null {
    if (r) clearTimeout(r);
    return null;
  }
  function pararRelojes() {
    relojConexion = parar(relojConexion);
    relojTimbre = parar(relojTimbre);
    relojCorte = parar(relojCorte);
    relojReinicio = parar(relojReinicio);
  }

  function armarConexion() {
    relojConexion = parar(relojConexion);
    relojConexion = setTimeout(() => {
      relojConexion = null;
      if (estado === 'conectando') colgar('sin-camino');
    }, P.conexion);
  }

  function armarTimbre() {
    relojTimbre = parar(relojTimbre);
    relojTimbre = setTimeout(() => {
      relojTimbre = null;
      if (estado === 'llamando') colgar('no-contesto');
      else if (estado === 'entrando') terminar('perdida', null);
    }, P.timbre);
  }

  /* ── los caminos (ICE) ──────────────────────────────────────────────────────────────────── */

  function guardarHuerfano(de: string, cand: any) {
    const g = huerfanos.get(de);
    if (g) clearTimeout(g.reloj);
    const cands = g ? [...g.cands, cand] : [cand];
    huerfanos.set(de, { cands, reloj: setTimeout(() => huerfanos.delete(de), P.huerfano) });
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
        await c.addIceCandidate(cand);
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

  /* ── la conexión ────────────────────────────────────────────────────────────────────────── */

  function nuevaConexion(): RTCPeerConnection {
    const c = crearConexion({ iceServers: servidores(), iceCandidatePoolSize: 4 });
    c.addEventListener('icecandidate', (e: RTCPeerConnectionIceEvent) => {
      if (pc !== c || !e.candidate || !conQuien) return;
      try {
        tiposVistos.add(e.candidate.type || '?');
      } catch {
        /* nada */
      }
      const candidato = typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate;
      if (!otroSabe) iceSaliente.push(candidato);
      else enviar(conQuien, 'ice', { candidato });
    });
    c.addEventListener('track', (e: RTCTrackEvent) => {
      if (pc !== c) return;
      if (e.streams && e.streams[0]) flujoRemoto = e.streams[0];
      else {
        // Sin flujo (hay navegadores que mandan la pista suelta): se arma uno.
        flujoRemoto ??= new MediaStream();
        flujoRemoto.addTrack(e.track);
      }
      e.track?.addEventListener?.('ended', () => pc === c && anunciar());
      anunciar();
    });
    c.addEventListener('iceconnectionstatechange', () => {
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
    c.addEventListener('connectionstatechange', () => {
      if (pc !== c) return;
      // «Hablando» SOLO con la conexión de verdad en pie, no cuando alguien contesta.
      if (c.connectionState === 'connected') {
        yaConecto = true;
        relojConexion = parar(relojConexion);
        relojCorte = parar(relojCorte);
        relojReinicio = parar(relojReinicio);
        sonido(null);
        if (estado !== 'hablando') {
          estado = 'hablando';
          desde = Date.now();
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

  /** Se perdió el camino en plena llamada: quien llamó pide reinicio de ICE; a los 10 s sin volver, se cuelga. */
  function caida(c: RTCPeerConnection) {
    if (!relojCorte) {
      relojCorte = setTimeout(() => {
        relojCorte = null;
        const st = c.iceConnectionState;
        if (pc === c && (st === 'disconnected' || st === 'failed' || st === 'checking')) colgar('corte');
      }, P.corte);
      anunciar();
    }
    if (soyQuienLlama && !relojReinicio) {
      relojReinicio = setTimeout(() => {
        relojReinicio = null;
        if (pc === c && c.signalingState === 'stable' && relojCorte) void reiniciarIce(c);
      }, P.reinicio);
    }
  }

  async function reiniciarIce(c: RTCPeerConnection) {
    try {
      const oferta = await c.createOffer({ iceRestart: true });
      if (pc !== c || c.signalingState !== 'stable') return;
      await c.setLocalDescription(oferta);
      if (pc !== c || !conQuien) return;
      enviar(conQuien, 'oferta', { sdp: descripcion(c.localDescription) });
    } catch {
      /* un reinicio fallido no tumba la llamada: el plazo de corte sí */
    }
  }

  /* ── medios ─────────────────────────────────────────────────────────────────────────────── */

  function soltarMedios(flujo: MediaStream | null, conexion: RTCPeerConnection | null) {
    try {
      flujo?.getTracks?.().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* nada */
        }
      });
    } catch {
      /* nada */
    }
    try {
      conexion?.close?.();
    } catch {
      /* nada */
    }
  }

  const abandonar = (flujo: MediaStream | null, conexion: RTCPeerConnection | null) => soltarMedios(flujo, conexion);

  /* ── llamar, contestar, rechazar, colgar ────────────────────────────────────────────────── */

  async function llamar(correo: string, quiereVideo: boolean) {
    if (estado !== 'libre') throw new Error('ya hay una llamada');
    const mia = ++ficha;
    conQuien = String(correo || '').toLowerCase();
    soyQuienLlama = true;
    estado = 'llamando';
    conVideo = !!quiereVideo;
    otroSabe = false;
    yaConecto = false;
    desde = null;
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
      conexion = pc = nuevaConexion();
      flujo.getTracks().forEach((t) => conexion!.addTrack(t, flujo!));
      const oferta = await conexion.createOffer();
      if (!vigente(mia)) return abandonar(flujo, conexion);
      await conexion.setLocalDescription(oferta);
      if (!vigente(mia)) return abandonar(flujo, conexion);
      sonido('tono');
      anunciar();
      const para = conQuien;
      const fallo = await enviarLlamo(para, { video: m.video, sdp: descripcion(conexion.localDescription) });
      // Si la ficha cambió, quien la cambió (colgar, o el desempate de llamadas cruzadas) ya soltó todo.
      if (!vigente(mia)) {
        // Se colgó MIENTRAS el `llamo` iba de camino: `colgar` no avisó (el otro «no sabía»), pero el
        // relevo sí lo entregó y allá suena. Se le manda el `cuelgo` que faltó para que deje de sonar
        // en el acto y no 45 s. No si la ficha cambió por el desempate (o por volver a llamarle): ahí
        // hay otra llamada viva con esa persona y un `cuelgo` la tumbaría.
        const ahora = estado as EstadoLlamada;
        if (!fallo && (ahora === 'libre' || conQuien !== para)) enviar(para, 'cuelgo', {});
        return;
      }
      if (fallo) return terminar(fallo, null);
      otroSabe = true;
      soltarIceSaliente();
      if (estado === 'llamando') armarTimbre();
    } catch (e: any) {
      if (!vigente(mia)) return abandonar(flujo, conexion);
      terminar(e?.motivo === 'sin-permiso' ? 'sin-permiso' : e?.motivo === 'sin-microfono' ? 'sin-microfono' : 'no-se-pudo', null);
      throw e;
    }
  }

  async function contestar(quiereVideo: boolean) {
    // Guardia SÍNCRONA: un doble clic en «Contestar» no abre dos conexiones.
    if (estado !== 'entrando' || !entrante) return;
    const mia = ++ficha;
    const de = entrante.de;
    conQuien = de;
    soyQuienLlama = false;
    otroSabe = true;
    estado = 'conectando';
    conVideo = !!quiereVideo && entrante.video;
    relojTimbre = parar(relojTimbre);
    sonido(null);
    anunciar();
    let flujo: MediaStream | null = null;
    let conexion: RTCPeerConnection | null = null;
    try {
      await turnoConPlazo();
      if (!vigente(mia)) return;
      let m: Medios;
      try {
        m = await abrirMedios(conVideo);
      } catch (e: any) {
        if (!vigente(mia)) return;
        if (e?.motivo !== 'sin-permiso' && e?.motivo !== 'sin-microfono') throw e;
        // Quien llama se entera de que quiso contestar y el equipo no le dejó.
        return terminar(e.motivo, 'rechazo', undefined, { motivo: 'sin-permiso' });
      }
      flujo = m.flujo;
      if (!vigente(mia)) return abandonar(flujo, null);
      miFlujo = flujo;
      conVideo = m.video;
      conexion = pc = nuevaConexion();
      flujo.getTracks().forEach((t) => conexion!.addTrack(t, flujo!));
      armarConexion();
      // La oferta más nueva: si quien llama la reemplazó mientras se abría el micrófono, vale la última.
      const oferta = entrante?.sdp;
      if (!oferta) throw new Error('sin oferta');
      await conexion.setRemoteDescription(oferta);
      if (!vigente(mia)) return abandonar(flujo, conexion);
      await vaciarCola(conexion);
      const resp = await conexion.createAnswer();
      if (!vigente(mia)) return abandonar(flujo, conexion);
      await conexion.setLocalDescription(resp);
      if (!vigente(mia)) return abandonar(flujo, conexion);
      enviar(de, 'respuesta', { sdp: descripcion(conexion.localDescription) });
      entrante = null;
      anunciar();
    } catch (e: any) {
      if (!vigente(mia)) return abandonar(flujo, conexion);
      terminar('no-se-pudo', 'cuelgo');
      throw e;
    }
  }

  function rechazar() {
    if (estado !== 'entrando' || !entrante) return;
    terminar('yo', 'rechazo');
  }

  /**
   * Todo termina aquí: cambia la ficha, para relojes, sonido, medios y conexión, avisa al otro si hace
   * falta y le dice a la pantalla por qué terminó.
   */
  function terminar(motivo: Motivo, senal: 'cuelgo' | 'rechazo' | null, extra?: Partial<Cuento>, datos: unknown = {}) {
    const otro = conQuien || entrante?.de || null;
    const hizoFaltaRelevo = motivo === 'sin-camino' && !tiposVistos.has('relay');
    ficha++;
    pararRelojes();
    tiposVistos = new Set();
    sonido(null);
    soltarMedios(miFlujo, pc);
    miFlujo = null;
    flujoRemoto = null;
    pc = null;
    iceEnCola = [];
    iceSaliente = [];
    const conQuienEra = otro;
    const desdeEra = desde;
    estado = 'libre';
    conQuien = null;
    soyQuienLlama = false;
    entrante = null;
    otroSabe = false;
    yaConecto = false;
    desde = null;
    if (senal && otro) enviar(otro, senal, datos);
    // `conQuien` y `desde` viajan en el aviso final: la pantalla dice con quién era y cuánto duró.
    anunciar({ motivo, hizoFaltaRelevo, conQuien: conQuienEra, desde: desdeEra, ...(extra || {}) });
    conVideo = false;
  }

  /** Cuelga. El motivo viaja a la pantalla: no es lo mismo «colgaste» que «no había camino». */
  function colgar(motivo: Motivo = 'yo') {
    if (estado === 'libre') return;
    if (estado === 'entrando' && motivo === 'yo') return rechazar();
    terminar(motivo, otroSabe && AVISAN.includes(motivo) ? 'cuelgo' : null);
  }

  function micro(encender?: boolean) {
    const t = miFlujo?.getAudioTracks?.()[0];
    if (!t) return;
    t.enabled = encender === undefined ? !t.enabled : !!encender;
    anunciar();
  }

  function camara(encender?: boolean) {
    const t = miFlujo?.getVideoTracks?.()[0];
    if (!t) return;
    t.enabled = encender === undefined ? !t.enabled : !!encender;
    anunciar();
  }

  /** Cambia de micrófono o de cámara en plena llamada, sin renegociar (reemplaza la pista enviada). */
  async function cambiarDispositivo(tipo: 'audio' | 'video', dispositivo: string) {
    if (!o.abrirPista || !miFlujo || !pc) return;
    const vieja = tipo === 'audio' ? miFlujo.getAudioTracks()[0] : miFlujo.getVideoTracks()[0];
    if (!vieja) return;
    const mia = ficha;
    const nueva = await o.abrirPista(tipo, dispositivo);
    if (!vigente(mia) || !miFlujo || !pc) {
      nueva.stop();
      return;
    }
    nueva.enabled = vieja.enabled;
    const emisor = pc.getSenders().find((s) => s.track === vieja || s.track?.kind === tipo);
    await emisor?.replaceTrack(nueva);
    miFlujo.removeTrack(vieja);
    miFlujo.addTrack(nueva);
    vieja.stop();
    anunciar();
  }

  /* ── lo que llega del otro lado ─────────────────────────────────────────────────────────── */

  function recibirLlamada(de: string, d: any) {
    entrante = { de, video: !!d.video, sdp: d.sdp };
    conQuien = de;
    soyQuienLlama = false;
    estado = 'entrando';
    conVideo = !!d.video;
    otroSabe = true;
    yaConecto = false;
    desde = null;
    iceEnCola = tomarHuerfanos(de);
    armarTimbre();
    sonido('timbre');
    anunciar();
  }

  /**
   * Llamadas cruzadas: sigue como llamante el correo MENOR; el mayor suelta su intento (sin avisar: el
   * otro ignora esa oferta por la misma regla) y contesta la del otro, con video si él lo quería.
   */
  function cederLlamada(de: string, d: any) {
    const queriaVideo = conVideo;
    ficha++;
    pararRelojes();
    sonido(null);
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

  async function recibir(s: Senal) {
    const de = String(s.de || '').toLowerCase();
    const d = s.datos || {};
    try {
      if (s.tipo === 'llamo') {
        if (estado === 'libre') return recibirLlamada(de, d);
        if (de === conQuien) {
          // El mismo contacto vuelve a llamar mientras suena: vale su oferta nueva, no «ocupado».
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
      // Contestó (o rechazó) OTRO aparato de esta misma cuenta: aquí se deja de sonar.
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
            await pc.addIceCandidate(cand);
          } catch {
            /* nada */
          }
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
          await c.setRemoteDescription(d.sdp);
        } catch (e) {
          if (inicial) throw e;
          return;
        }
        if (pc !== c) return;
        await vaciarCola(c);
        if (estado === 'llamando') {
          estado = 'conectando';
          otroSabe = true;
          relojTimbre = parar(relojTimbre);
          sonido(null);
          armarConexion();
        }
        anunciar();
        return;
      }
      if (s.tipo === 'oferta') {
        // Reinicio de ICE que pide el otro. Se contesta con `respuesta`.
        if (!pc || !pc.remoteDescription || (estado !== 'hablando' && estado !== 'conectando')) return;
        const c = pc;
        try {
          if (c.signalingState === 'have-local-offer') {
            // Los dos pidieron reinicio a la vez: cede este lado (la web no sabe ceder).
            await c.setLocalDescription({ type: 'rollback' });
          }
          await c.setRemoteDescription(d.sdp);
          if (pc !== c) return;
          await vaciarCola(c);
          const resp = await c.createAnswer();
          if (pc !== c) return;
          await c.setLocalDescription(resp);
          if (pc !== c) return;
          enviar(de, 'respuesta', { sdp: descripcion(c.localDescription) });
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

  void refrescarTurno();

  return {
    cuento,
    llamar,
    contestar,
    rechazar,
    colgar,
    micro,
    camara,
    cambiarDispositivo,
    recibir,
    enLlamada: () => estado !== 'libre',
  };
}
