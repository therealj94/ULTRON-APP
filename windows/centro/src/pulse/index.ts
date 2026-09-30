/**
 * PULSE2CHAT en el Centro: la cuenta del chat, el buzón de señales, las llamadas y el notch.
 *
 * Es el `PulseProvider` del teléfono sin React. Con la cuenta puesta, este equipo escucha SU buzón
 * (`/senales`, una petición larga por el puente) SIEMPRE, esté o no abierta la sección PULSE2CHAT: una
 * llamada entrante suena aquí y en el notch aunque la persona esté en Música. La pantalla de la llamada
 * se monta sobre `document.body` (pantallaLlamada.ts), encima de todo, como en el teléfono.
 *
 * El notch:
 *   · llamada entrante → `notch.timbre { de, nombre, video }` y el punto en «PULSE2CHAT» (evento de
 *     ventana `centro:marcar`, que escucha main.ts: importarlo desde aquí sería un ciclo);
 *   · deja de sonar (contestó, colgó, otro aparato) → `notch.timbreFin { motivo }`;
 *   · llamada perdida o mensaje nuevo que no se está viendo → `notch.aviso { titulo, cuerpo }`;
 *   · lo que se toca en el notch llega como `llamada.accion { accion: 'contestar'|'rechazar'|'colgar' }`.
 */
import { al, pedir } from '../puente';
import { estado } from '../estado';
import * as RELEVO from './relevo';
import * as CHATS from './chats';
import { crearMotor, ES_DE_LLAMADA, abrirMediosNavegador, restriccionAudio, restriccionVideo, type Cuento } from './llamada';
import { almacen } from './chats';
import { recortar } from './formato';
import { montarPantallaLlamada } from './pantallaLlamada';

export type { Cuenta, Conversacion, Persona, Mensaje } from './relevo';
export type { Cuento, Motivo, EstadoLlamada } from './llamada';

/* ── el punto del menú lateral ────────────────────────────────────────────────────────────── */

/** Pone o quita el punto en «PULSE2CHAT» (main.ts escucha `centro:marcar`). */
export function marcarPulse(si: boolean) {
  try {
    window.dispatchEvent(new CustomEvent('centro:marcar', { detail: { id: 'pulse', si } }));
  } catch {
    /* fuera del navegador no hay menú */
  }
}

/* ── los dispositivos elegidos (micrófono, cámara, salida) ────────────────────────────────── */

export type Dispositivos = { mic?: string; cam?: string; salida?: string };
const CLAVE_DISPOSITIVOS = 'pulse.dispositivos';

export function dispositivosElegidos(): Dispositivos {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_DISPOSITIVOS) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
export function elegirDispositivo(tipo: keyof Dispositivos, id: string) {
  const v = { ...dispositivosElegidos(), [tipo]: id };
  try {
    localStorage.setItem(CLAVE_DISPOSITIVOS, JSON.stringify(v));
  } catch {
    /* sin almacenamiento se usa el de siempre */
  }
}

/* ── sonidos: timbre y tono, hechos con WebAudio (sin archivos) ───────────────────────────── */

let ctxAudio: AudioContext | null = null;
let sonando: { parar: () => void } | null = null;

function contexto(): AudioContext | null {
  try {
    const C = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (!C) return null;
    ctxAudio ??= new C() as AudioContext;
    if (ctxAudio.state === 'suspended') void ctxAudio.resume().catch(() => {});
    return ctxAudio;
  } catch {
    return null;
  }
}

/** Una nota suave (sube y baja sin chasquido). */
function nota(ctx: AudioContext, frec: number, en: number, dura: number, vol: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frec;
  g.gain.setValueAtTime(0, en);
  g.gain.linearRampToValueAtTime(vol, en + 0.02);
  g.gain.setValueAtTime(vol, en + dura - 0.05);
  g.gain.linearRampToValueAtTime(0, en + dura);
  osc.connect(g).connect(ctx.destination);
  osc.start(en);
  osc.stop(en + dura + 0.02);
}

function sonar(cual: 'timbre' | 'tono' | null) {
  sonando?.parar();
  sonando = null;
  if (!cual) return;
  const ctx = contexto();
  if (!ctx) return;
  // Timbre: dos notas que suben, cada 2,6 s. Tono de «está sonando»: 425 Hz, 1 s sí y 3 s no.
  const vuelta = () => {
    const t = ctx.currentTime + 0.03;
    if (cual === 'timbre') {
      nota(ctx, 784, t, 0.22, 0.16);
      nota(ctx, 1047, t + 0.26, 0.34, 0.16);
      nota(ctx, 784, t + 0.8, 0.22, 0.12);
      nota(ctx, 1047, t + 1.06, 0.34, 0.12);
    } else {
      nota(ctx, 425, t, 1, 0.07);
    }
  };
  vuelta();
  const reloj = setInterval(vuelta, cual === 'timbre' ? 2600 : 4000);
  sonando = { parar: () => clearInterval(reloj) };
}

/* ── el motor de llamadas ─────────────────────────────────────────────────────────────────── */

/** Lo que ve la pantalla de la llamada: el cuento del motor y el nombre de la otra persona. */
export type Llamada = Cuento & { nombre: string };
export const llamada = almacen<Llamada | null>(null);

let estadoAntes: Cuento['estado'] = 'libre';

export const motor = crearMotor({
  mandar: (para, tipo, datos) => RELEVO.senalar(para, tipo, datos),
  alCambiar: (c) => {
    const quien = c.conQuien || c.entrante?.de || '';
    const nombre = quien ? RELEVO.nombreDeCorreo(quien) : '';
    const antes = estadoAntes;
    estadoAntes = c.estado;
    if (c.estado === 'entrando' && antes !== 'entrando' && c.entrante) {
      pedir('notch.timbre', { de: c.entrante.de, nombre, video: c.entrante.video }).catch(() => {});
      marcarPulse(true);
    }
    if (antes === 'entrando' && c.estado !== 'entrando') {
      pedir('notch.timbreFin', { motivo: c.motivo || c.estado }).catch(() => {});
      if (c.motivo === 'perdida') {
        pedir('notch.aviso', { titulo: 'Llamada perdida', cuerpo: nombre || quien }).catch(() => {});
        marcarPulse(true);
      }
    }
    // Un cuento «libre» sin motivo es el de reposo: no hay nada que mostrar.
    llamada.set(c.estado === 'libre' && !c.motivo ? null : { ...c, nombre });
  },
  traerTurno: RELEVO.turno,
  aparato: RELEVO.miId,
  correo: () => RELEVO.quien()?.correo || '',
  abrirMedios: (video) => abrirMediosNavegador(video, dispositivosElegidos()),
  abrirPista: async (tipo, id) => {
    const md = navigator.mediaDevices;
    const f = await md.getUserMedia(tipo === 'audio' ? { audio: restriccionAudio(id) } : { video: restriccionVideo(id) });
    return (tipo === 'audio' ? f.getAudioTracks() : f.getVideoTracks())[0];
  },
  sonar,
});

/** La pantalla terminó de mostrar cómo acabó la llamada: se quita. */
export function soltarLlamadaTerminada() {
  const v = llamada.get();
  if (v && v.estado === 'libre') llamada.set(null);
}

/** Llama a alguien (voz o video). Los errores ya los muestra la pantalla de la llamada. */
export function llamar(correo: string, video: boolean) {
  void motor.llamar(correo, video).catch(() => undefined);
}

/* ── la cuenta, el buzón y la lista ───────────────────────────────────────────────────────── */

export const cuenta = almacen<RELEVO.Cuenta | null>(null);
/** Recuperando la cuenta guardada al arrancar. */
export const recuperando = almacen<boolean>(false);

let pararLista: (() => void) | null = null;

function alLlegar(s: RELEVO.Senal) {
  if (ES_DE_LLAMADA(s.tipo)) {
    void motor.recibir(s);
    return;
  }
  if (s.tipo === 'escribe') CHATS.marcarEscribiendo(String(s.de));
}

function alCambiarCuenta() {
  const c = RELEVO.quien();
  cuenta.set(c);
  if (c) {
    void RELEVO.escuchar(alLlegar);
    pararLista ??= CHATS.sondearLista();
  } else {
    pararLista?.();
    pararLista = null;
  }
}

/** El hilo que la persona tiene a la vista (lo fija la vista): sus mensajes no avisan en el notch. */
let hiloVisible: string | null = null;
export function fijarHiloVisible(correo: string | null) {
  hiloVisible = correo ? correo.toLowerCase() : null;
}
let seccionVisible = false;
/** La vista avisa si la sección PULSE2CHAT está a la vista (para el punto del menú). */
export function fijarSeccionVisible(si: boolean) {
  seccionVisible = si;
  if (si && CHATS.totalSinLeer() === 0 && !llamada.get()) marcarPulse(false);
}

const ultimoAvisoDe = new Map<string, number>();
function avisarMensaje(n: CHATS.Novedad) {
  const aLaVista = seccionVisible && hiloVisible === n.correo && CHATS.ventanaVisible() && (typeof document === 'undefined' || document.hasFocus());
  if (aLaVista) return;
  marcarPulse(true);
  // Como mucho un aviso por persona cada 20 s: una ráfaga de mensajes no es una ráfaga de avisos.
  const ahora = Date.now();
  if (ahora - (ultimoAvisoDe.get(n.correo) || 0) < 20_000) return;
  ultimoAvisoDe.set(n.correo, ahora);
  const m = n.mensaje;
  // Corto y sin el texto entero si es largo: el notch se ve de lejos.
  const cuerpo = m.cerrado
    ? 'Mensaje cifrado nuevo'
    : m.tipo === 'imagen'
      ? '📷 Foto'
      : Array.from(m.texto || '').length <= 60
        ? recortar(m.texto, 60)
        : 'Te escribió un mensaje';
  pedir('notch.aviso', { titulo: n.nombre, cuerpo }).catch(() => {});
}

let iniciado = false;

/**
 * Arranca PULSE2CHAT en el Centro (idempotente): recupera la cuenta guardada de ESTA persona de AU-RA,
 * escucha el buzón y el notch. Llamarlo al arrancar, después de `cargar()`; la vista también lo llama.
 */
export async function iniciarPulse(correoAura?: string): Promise<RELEVO.Cuenta | null> {
  if (!iniciado) {
    iniciado = true;
    RELEVO.escucharCuenta(alCambiarCuenta);
    CHATS.escucharDesconexion(() => void RELEVO.salir());
    // Salir de la cuenta cuelga la llamada en curso ANTES de soltar la llave (el `cuelgo` sale firmado).
    RELEVO.antesDeSalir(() => {
      if (motor.enLlamada()) motor.colgar('yo');
    });
    CHATS.alMensajeNuevo(avisarMensaje);
    al<{ accion?: string }>('llamada.accion', (d) => {
      const c = motor.cuento();
      if (d?.accion === 'contestar' && c.estado === 'entrando') {
        void motor.contestar(!!c.entrante?.video).catch(() => undefined);
        pedir('ventana.mostrar', { seccion: 'pulse' }).catch(() => {});
      } else if (d?.accion === 'rechazar') motor.rechazar();
      else if (d?.accion === 'colgar') motor.colgar('yo');
    });
    if (typeof document !== 'undefined') {
      montarPantallaLlamada({ llamada, motor, soltar: soltarLlamadaTerminada, dispositivos: dispositivosElegidos, elegir: elegirDispositivo });
    }
  }
  if (RELEVO.quien()) return RELEVO.quien();
  const dueno = correoAura ?? estado()?.sesion?.correo;
  if (!dueno) return null;
  // main.ts y la vista llaman esto casi a la vez al arrancar: una sola recuperación en vuelo (dos
  // publicaban la llave dos veces y la primera en terminar apagaba «recuperando» con la otra andando).
  if (recuperandoEnVuelo) return recuperandoEnVuelo;
  recuperando.set(true);
  recuperandoEnVuelo = (async () => {
    try {
      return await RELEVO.recuperar(dueno);
    } catch {
      return null;
    } finally {
      recuperandoEnVuelo = null;
      recuperando.set(false);
    }
  })();
  return recuperandoEnVuelo;
}
let recuperandoEnVuelo: Promise<RELEVO.Cuenta | null> | null = null;

/**
 * Conecta PULSE2CHAT con el pase de Genesis (`entrar.genesis` devuelve `{ miembro, pase, verificador }`;
 * el mismo pase sirve una vez para AU-RA y una vez para el relevo). Publica la llave de este equipo.
 */
export async function conectarConPase(pase: string, verificador: string, nombre?: string, correoAura?: string): Promise<RELEVO.Cuenta> {
  await iniciarPulse(correoAura).catch(() => null);
  return RELEVO.entrarConPase(pase, verificador, nombre, correoAura ?? estado()?.sesion?.correo);
}

/** La cuenta que ya estaba guardada en este equipo, si es de esta persona de AU-RA. */
export function recuperar(correoAura?: string): Promise<RELEVO.Cuenta | null> {
  return iniciarPulse(correoAura);
}

/** Sale de PULSE2CHAT en este equipo (cuelga, deja de escuchar y borra la cuenta guardada). */
export async function salir(): Promise<void> {
  await RELEVO.salir();
  marcarPulse(false);
}

export const quien = RELEVO.quien;
export const enLlamada = () => motor.enLlamada();
