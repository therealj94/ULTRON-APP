/**
 * EL CONTRATO DE LA APP 5.0: lo que comparten las piezas sin conocerse.
 *
 * Seis partes de la app se escriben por separado (llamadas, chat, servidor, la carcasa con la
 * entrada y la primera vez, la compañera AURA, y Genesis/wallet). Se encuentran solo aquí:
 *   · el PERFIL de la persona (lo que contó la primera vez: cómo le decimos, avatar, tema, encuesta);
 *   · las ACCIONES que AURA puede pedirle a la app («vete atrás», «abre ajustes», «escríbele a Beto…»);
 *   · los EVENTOS que se avisan entre piezas (empezó una llamada, se envió un mensaje, cambió la pantalla).
 *
 * Nada de React aquí: lo importan la voz, el relevo y las pantallas por igual.
 */
import type { AvatarId } from '../avatares/catalogo';
import type { ModoPresencia } from '../avatar3d/tipos';
import type { Idioma } from '../i18n';

/* ── el perfil ───────────────────────────────────────────────────────────────────────────── */

export type Tema = 'oscuro' | 'claro' | 'sistema';

/** Lo que la persona contó en la primera vez. Todo opcional salvo lo que la app necesita para arrancar. */
export type Encuesta = {
  /** Ciudad o país donde vive. */
  vive?: string;
  comida?: string;
  musica?: string;
  /** Pareja, hijos, familia: texto libre («casado, dos hijas: Ana y Sofía»). */
  familia?: string;
  /** A qué se dedica. */
  trabajo?: string;
  /** Pasatiempos, deportes, lo que le gusta. */
  gustos?: string;
  /** Lo que quiere que AURA haga por él (la primera vez lo elige o lo escribe). */
  ayuda?: string;
  /** Lo que quiera que AURA sepa y no cupo arriba. */
  otros?: string;
};

export type MotorComputadora = 'gratis' | 'pago';

/**
 * Cuánta iniciativa quiere de AURA (server/iniciativa.ts, lib/perfil-persona.ts): con qué frecuencia le
 * propone cosas sin que se lo pida. alta: cada 2 h (hasta 6 al día) · media: cada 4 h (hasta 3) · baja: 1
 * al día · apagada: nunca. Sin valor, media.
 */
export type NivelIniciativa = 'alta' | 'media' | 'baja' | 'apagada';
export const NIVELES_INICIATIVA: readonly NivelIniciativa[] = ['alta', 'media', 'baja', 'apagada'];

export type Perfil = {
  /** Cómo quiere que le digan («José», «Jefe», «Pepe»). */
  apodo: string;
  avatar: AvatarId;
  tema: Tema;
  idioma: Idioma;
  /** Lo que compartió Genesis ID con permiso de la persona. */
  nombreGenesis?: string;
  /** Solo mes y día («03-14»): el año no hace falta para felicitar. */
  cumple?: string;
  encuesta: Encuesta;
  /** true cuando terminó la primera vez (o la saltó a propósito). */
  completado: boolean;
  /**
   * Cómo quiere tener a AURA mientras usa la app: caminando chiquita (paseo, la de siempre), al lado
   * de los chats (lado) o a pantalla completa (completa). Sin valor, paseo. Ver avatar3d/presencia.ts.
   */
  presencia?: ModoPresencia;
  /**
   * Quién maneja su computadora en la nube (server/computadora.ts): el modelo propio (gratis) o Claude
   * (de pago). Sin valor, gratis.
   */
  motorComputadora?: MotorComputadora;
  /** Cuánto le propone AURA por su cuenta (NivelIniciativa). Sin valor, media. */
  iniciativa?: NivelIniciativa;
  /** Milisegundos. */
  actualizado: number;
};

/**
 * Servidor (aura-fp), con la sesión de la mesa:
 *   GET  /api/perfil            → { perfil: Perfil | null }
 *   PUT  /api/perfil  Partial<Perfil>  → { perfil: Perfil }
 * El cerebro lo lee en cada turno (todos los avatares) para llamar a la persona por su apodo y
 * acordarse de lo que contó.
 */
export const RUTA_PERFIL = '/api/perfil';

/* ── lo que AURA le puede pedir a la app ─────────────────────────────────────────────────── */

export type Pantalla = 'mesa' | 'chats' | 'ajustes' | 'perfil';

export type AccionApp =
  | { tipo: 'atras' }
  | { tipo: 'abrir'; pantalla: Pantalla }
  | { tipo: 'tema'; valor: Tema }
  | { tipo: 'avatar'; valor: AvatarId }
  /** Abre la conversación con alguien (correo exacto o nombre como sale en la lista). */
  | { tipo: 'abrir_chat'; con: string }
  /** Deja el borrador escrito en el chat con esa persona, sin enviarlo. AURA lo lee en voz alta. */
  | { tipo: 'redactar'; para: string; texto: string }
  /** Envía el borrador que está escrito (en el chat abierto o el de `para`). */
  /** `texto`: el que la persona aprobó (lo pone el servidor). Si el borrador ya dice otra cosa, no se manda. */
  | { tipo: 'enviar'; para?: string; texto?: string }
  /** Borra el borrador sin enviarlo. */
  | { tipo: 'descartar' }
  /** true = AURA se calla y deja de escuchar; false = vuelve. */
  | { tipo: 'silencio'; valor: boolean }
  /** «Ponte a pantalla completa» / «ponte al lado» / «ponte chiquita»: cómo se presenta (se guarda en el perfil). */
  | { tipo: 'presencia'; valor: ModoPresencia }
  /*
   * LAS MANOS (lib/manos-app.ts en el servidor). Solo llegan si este teléfono las declaró en su
   * contexto (`manos`); un APK viejo no las declara y, si le llegara una, su puente la ignora.
   */
  /** Llama o videollama a un contacto. El servidor la manda SOLO tras el «sí» de la persona. */
  | { tipo: 'llamar'; con: string; video: boolean }
  /** Lee lo último de `de` (o lo no leído de todos) con la voz de AURA. `boleto`: lo pone el servidor. */
  | { tipo: 'leer'; de?: string; boleto?: string }
  /** Busca palabras en los chats; dice en qué chat está (sin leer el contenido) y lo abre. */
  | { tipo: 'buscar'; q: string; boleto?: string }
  | { tipo: 'idioma'; valor: Idioma }
  /** Un dato de «lo que sabe de mí»: apodo, cumple (MM-DD) o un campo de la encuesta. */
  | { tipo: 'perfil'; campo: CampoPerfil; valor: string }
  /**
   * Aviso local a esa hora (epoch ms). Con `llamada`, a esa hora AURA «te llama» (aviso de llamada
   * entrante a pantalla completa; al contestar, te lo dice con su voz). Solo tras el «sí» de la persona.
   */
  | { tipo: 'recordatorio'; texto: string; cuando: number; llamada?: boolean }
  /** Quita un recordatorio (por el id que el teléfono contó en su contexto). Solo tras el «sí». */
  | { tipo: 'cancelar_recordatorio'; id: string }
  /** «Llámame»: el avatar llama a la persona, ya (la pantalla «te está llamando»; compa/llamadaCiclo.ts). */
  | { tipo: 'llamame' }
  /** «¿Cuánto tengo en mi wallet?»: abre la hoja Cartera (cartera/HojasCartera.tsx). Solo lectura. */
  | { tipo: 'cartera' }
  /**
   * «Mándale 5 ORIGEN a Ana»: abre su chat y la hoja de enviar, LLENADA. La persona revisa, confirma y firma
   * en Veta Wallet con su contraseña: AURA nunca paga sola (cartera/HojaPagar.tsx).
   */
  | { tipo: 'pagar'; con: string; monto?: string; moneda?: string }
  /*
   * LOS CONTROLES DE VOZ SEPARADOS (AUR10, lib/controlesVoz.ts; mano `controles`), cada uno con UN efecto.
   * Los decide el servidor con lo que dijo la persona (el modelo no los puede pedir):
   */
  /** «Cállate», «para de hablar»: para lo que suena y su cola. No silencia el micrófono ni cancela la tarea. */
  | { tipo: 'detener_audio' }
  /** «Cuelga»: cierra la llamada del avatar y sus recursos. La tarea de su computadora sigue como estaba. */
  | { tipo: 'colgar' }
  /** «Cancela / pausa / sigue con la tarea», «tomo el control»: su computadora. No cuelga. */
  | { tipo: 'tarea'; que: 'pausar' | 'reanudar' | 'cancelar' | 'tomar' };

export type CampoPerfil = 'apodo' | 'cumple' | keyof Encuesta;

/**
 * Las manos que este teléfono sabe hacer: van en el contexto para que el servidor las ofrezca. `enviar_exacto` (permisos
 * exactos, 4-oct): este teléfono comprueba que su borrador sea el texto aprobado (`enviar.texto`) antes de mandarlo; sin
 * ella el servidor no le da ningún `enviar`.
 */
export const MANOS_APP = ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada', 'llamame', 'cartera', 'pagar', 'controles', 'enviar_exacto'] as const;
export type Mano = (typeof MANOS_APP)[number];

/** Un recordatorio puesto en el teléfono (lo cuenta en el contexto para decirlo y cancelarlo por voz). */
export type RecordatorioPuesto = { id: string; texto: string; cuando: number; llamada: boolean };

/**
 * Servidor → teléfono (con la sesión de la mesa):
 *   GET  /api/app/acciones   (text/event-stream)  cada evento: data: {"id":"…","accion":AccionApp}
 *   POST /api/app/contexto   { pantalla, chatAbierto?: {correo,nombre}, contactos: {correo,nombre}[], borrador?: string }
 * El contexto le dice al cerebro dónde está la persona y a quién puede escribirle, para que «escríbele
 * a mi mamá» encuentre a quién. Nunca viaja el contenido de los chats, solo nombres.
 */
export const RUTA_ACCIONES = '/api/app/acciones';
export const RUTA_CONTEXTO = '/api/app/contexto';

/**
 * Por el MISMO canal de acciones, durante la conversación: `event: ambiente` + `data: {"sonido","on"}`.
 * Es el sonido de fondo mientras AURA hace una tarea lenta (tecleo al buscar, hojas al leer, lápiz al
 * calcular); `on: false` lo quita. No es una acción (no lleva id, no se deduplica ni se repite al
 * reconectar) y solo llega al aparato de la conversación. Un teléfono que no lo conoce lo salta.
 * Los mismos nombres que compa/frasesEstado.ts (SONIDOS_AMBIENTE) y lib/acciones-app.ts.
 */
export const EVENTO_AMBIENTE = 'ambiente';
export type SonidoAmbiente = 'teclado' | 'papel' | 'lapiz';
export type Ambiente = { sonido: SonidoAmbiente | null; on: boolean };

export type Contexto = {
  pantalla: Pantalla;
  chatAbierto?: { correo: string; nombre: string } | null;
  contactos: { correo: string; nombre: string }[];
  borrador?: string;
  /** Las manos que sabe hacer (MANOS_APP). Un servidor viejo la ignora. */
  manos?: readonly Mano[];
  /** Los recordatorios puestos (para «¿qué recordatorios tengo?» y «cancela el de las 5»). */
  recordatorios?: RecordatorioPuesto[];
};

/* ── eventos entre piezas ────────────────────────────────────────────────────────────────── */

export type Eventos = {
  /** Una acción que hay que hacer (venga de la voz, de un atajo o de la compañera). */
  accion: AccionApp;
  /** Resultado de una acción, para que AURA diga «listo» o «no pude». */
  hecho: { accion: AccionApp; ok: boolean; detalle?: string };
  /** La llamada (voz o video) empezó o terminó: AURA se apaga y vuelve. */
  llamada: { activa: boolean; video: boolean };
  /** Cambió la pantalla visible. */
  pantalla: { pantalla: Pantalla; chatAbierto?: { correo: string; nombre: string } | null };
  /**
   * Se envió un mensaje de chat, a mano o por voz: SOLO la palomita ✔ y el globito «Enviado a …»
   * (`nombre`, como sale en la lista; si no se sabe, el correo). El «¡Listo!» hablado sale del `hecho`
   * de la acción `enviar`: un mensaje escrito a mano no hace hablar a AURA.
   */
  enviado: { para: string; id?: string; nombre?: string };
  /**
   * La conversación con ElevenLabs soltó (libre: true) o tomó (libre: false) el audio del teléfono.
   * Al cerrarse, el SDK para la sesión de audio DESPUÉS de desconectar (`AudioSession.stopAudioSession`);
   * en Android ese `stop` anula también un `start` pendiente de otro. La llamada espera `libre: true`
   * (con tope) antes de arrancar su audio, para que el cierre de AURA no le apague el suyo.
   */
  voz: { libre: boolean };
  /** El perfil cambió (tema, apodo, avatar…). */
  perfil: Perfil;
  /**
   * Lo que AURA tiene que decir con su voz y que sale del TELÉFONO, no del cerebro: la lectura de un
   * mensaje cifrado («¿qué me dijo Beto?») o el resultado de una búsqueda. `boleto` es el de la acción
   * (el servidor lo reconoce y lo dice tal cual, sin cerebro ni memoria). La voz lo pone (VozProvider).
   */
  lectura: { texto: string; boleto?: string };
  /**
   * La persona CONTESTÓ la llamada de un recordatorio («llámame a las 5 para recordarme…»): la voz
   * abre la conversación y AURA se lo dice (VozProvider). Si la app se abrió por el toque, lo mismo
   * queda guardado en compa/recordatorios.ts (`tomarPorDecir`) hasta que la voz se monte.
   */
  recordatorio: { texto: string; base: string };
  /** El sonido de fondo de una tarea lenta en la conversación (llega por el canal de acciones). */
  ambiente: Ambiente;
};

type Oyente<K extends keyof Eventos> = (dato: Eventos[K]) => void;
const oyentes = new Map<keyof Eventos, Set<(dato: any) => void>>();

/** Avisa a todos los que escuchan `tipo`. Un oyente que falla no tumba a los demás. */
export function emitir<K extends keyof Eventos>(tipo: K, dato: Eventos[K]) {
  const s = oyentes.get(tipo);
  if (!s) return;
  for (const f of [...s]) {
    try {
      f(dato);
    } catch {
      /* un oyente roto no rompe el bus */
    }
  }
}

/** Escucha `tipo`; devuelve la función para dejar de escuchar. */
export function escuchar<K extends keyof Eventos>(tipo: K, f: Oyente<K>): () => void {
  let s = oyentes.get(tipo);
  if (!s) oyentes.set(tipo, (s = new Set()));
  s.add(f);
  return () => {
    s.delete(f);
  };
}

/* ── permisos que pide la app (la pantalla de permisos de la primera vez los muestra todos) ── */

export const PERMISOS_ANDROID = [
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.POST_NOTIFICATIONS',
] as const;
/* La ubicación NO: AU-RA la bloquea a propósito en app.config.js (ninguna función la usa). */
