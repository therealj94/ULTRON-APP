/**
 * LAS PISTAS DEL VIDEO: lo que Claudio y ANT-ONIO hacen en video y que el estado del contrato
 * (EstadoAvatar, el mismo del 3D) no cuenta. El guion (guion.ts, `DirectorVideo.pistas`) las mezcla con
 * el estado; aquí solo se juntan, de las señales que la app ya tiene:
 *
 *  · teclea  — su computadora en la nube está trabajando (compa/computadora.ts, CompaneroPc: de «empieza»
 *              o el primer «paso» hasta «termina»; lo pone app/ComputadoraEnVivo.tsx);
 *  · lee     — está leyendo un mensaje: en la mesa, el turno usó la herramienta de correo, WhatsApp,
 *              Telegram o «leer-chat» (DeskScreen, `onTools`); en la conversación, el servidor puso el
 *              sonido de hojas (`ambiente` con «papel»: una página, un PDF, un mensaje). Se apaga al
 *              terminar el turno o al quitarse el sonido, y siempre a los LEE_MAX_MS;
 *  · golpes  — celebra, asiente, niega, duda y despide, por lo que pasó:
 *      · lo que DIJO (cada frase suya, de la mesa o de la conversación): `golpeDeFrase`, abajo;
 *      · la emoción «orgullo» del turno → celebra;
 *      · el resultado de una acción de la app (`hecho`): bien → asiente («listo»), mal → niega («no pude»);
 *        un mensaje enviado (`enviado`) → asiente;
 *      · su computadora terminó: bien → celebra, mal → niega;
 *      · colgó la llamada del avatar (compa/VozProvider.tsx) → despide.
 *    Los de una frase van de a uno: otro golpe por lo que dijo no antes de FRASE_ENTRE_MS (una respuesta
 *    larga no encadena asiente, celebra y despide).
 *
 * «Reducir movimiento» y el enfriamiento de cada golpe los pone el guion, no esto.
 *
 * Las fuentes se conectan con el primer cuerpo en video que escucha y se sueltan con el último: sin
 * Claudio ni ANT-ONIO en pantalla no hay nada escuchando.
 *
 * Sin React Native: lo prueban en Node (pruebas/video.prueba.mjs).
 */
import { canal, ecoMesa, mensajeVoz } from '../../compa/canales';
import { esAccionPc } from '../../compa/computadora';
import { escuchar } from '../../nucleo/contrato';
import type { ClipVideo, PistasVideo } from './guion';

export const pistasVideo = canal<PistasVideo>({ teclea: false, lee: false, golpe: null });

/** Lo más que se queda leyendo sin que nadie lo apague (un «terminó» perdido no lo deja leyendo para siempre). */
export const LEE_MAX_MS = 25_000;
/** Entre un golpe por lo que dijo y el siguiente, por lo menos esto. */
export const FRASE_ENTRE_MS = 8_000;

type Reloj = () => number;
let reloj: Reloj = Date.now;
/** Solo las pruebas: un reloj falso. */
export function relojPistas(r: Reloj = Date.now) {
  reloj = r;
}

const cambiar = (c: Partial<PistasVideo>) => pistasVideo.emitir({ ...pistasVideo.ultimo(), ...c });

/** Su computadora empezó o dejó de trabajar. */
export function ponerTeclea(on: boolean) {
  if (pistasVideo.ultimo().teclea !== on) cambiar({ teclea: on });
}

let topeLee: ReturnType<typeof setTimeout> | null = null;
/** Empezó o terminó de leer un mensaje (se apaga solo a los `maxMs`). */
export function ponerLee(on: boolean, maxMs = LEE_MAX_MS) {
  if (topeLee) clearTimeout(topeLee);
  topeLee = on ? setTimeout(() => ponerLee(false), maxMs) : null;
  if (pistasVideo.ultimo().lee !== on) cambiar({ lee: on });
}

let golpes = 0;
let ultimoDeFrase = -Infinity;
/** Pide un golpe. `deFrase`: viene de lo que dijo (van de a uno, ver FRASE_ENTRE_MS). */
export function pedirGolpe(clip: ClipVideo, deFrase = false) {
  const t = reloj();
  if (deFrase) {
    if (t - ultimoDeFrase < FRASE_ENTRE_MS) return;
    ultimoDeFrase = t;
  }
  cambiar({ golpe: { clip, n: ++golpes, en: t } });
}

/** Las herramientas del turno que son leer un mensaje (las mismas de lib/tareas.ts, sin las de enviar a secas). */
export const leeConHerramientas = (tools: readonly string[] | null | undefined) =>
  (tools || []).some((t) => /^(correo|whatsapp|telegram|leer-chat)$/.test(String(t || '').trim().toLowerCase()));

/* ── lo que dijo → un golpe ──────────────────────────────────────────────────────────────── */

const limpiar = (t: string) =>
  String(t || '')
    .replace(/\[[^\]]{0,40}\]/g, ' ') // [EMO:feliz], [laughs]…
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** La despedida cuenta al empezar o al cerrar la frase («¡Adiós, José!», «Bueno, nos vemos.»), no en medio. */
const DESPEDIDA = '(adi[oó]s|hasta (luego|pronto|ma[nñ]ana|la pr[oó]xima|otra)|nos (vemos|hablamos)|chao|chau|cu[ií]date|que descanses|que te vaya bien|bye|goodbye|see you|talk (to you )?(later|soon)|take care)';

/** En orden: lo primero que calza gana (despedirse pesa más que el «sí» con que empieza). */
const FRASES: [ClipVideo, RegExp][] = [
  ['despide', new RegExp(`(^¡?${DESPEDIDA}|\\b${DESPEDIDA}(,? [^ ]+){0,2}[.!…]*$)`)],
  [
    'niega',
    /^(no[.!]?$|no,? no\b|no (puedo|pude|logr[eé]|me (es posible|deja)|se puede|tengo (acceso|forma|permiso|c[oó]mo))|lo siento,? (pero )?no\b|perd[oó]n,? (pero )?no\b|me temo que no|lamentablemente,? no|desafortunadamente,? no|eso no (lo )?puedo|(i'?m )?sorry,? (but )?i can'?t|i can'?t|i couldn'?t|unfortunately)/,
  ],
  [
    'duda',
    /(no (te )?(entend[ií]|escuch[eé] bien|o[ií] bien)|no te (entend|escuch)|(me )?(lo )?(pod[eé]s|puedes|podr[ií]as) repetir|¿c[oó]mo (dijiste|as[ií])\??|¿a qu[eé] te refer[ií]s|¿a qu[eé] te refieres|¿cu[aá]l(es)?( de| prefer| quer| te)?\b.*\?|didn'?t (catch|understand)|which one|what do you mean)/,
  ],
  ['celebra', /(misi[oó]n cumplida|lo (logr(amos|aste|[eé])|conseguimos|hicimos)!|¡lo (logr|consegu|hicimos)|felicidades|felicitaciones|¡qu[eé] (bien|alegr[ií]a|buena noticia)|¡(excelente|genial|bravo|yupi|viva)|we did it|congrat|mission accomplished)/],
  [
    'asiente',
    /^(¡?s[ií](?![a-zñáéíóú])|¡?claro que s[ií]|¡?listo\b|¡?hecho\b|¡?perfecto\b|¡?entendido\b|¡?de acuerdo\b|¡?dale\b|¡?con gusto\b|¡?ok(ay)?\b|¡?va,|ya (est[aá]|qued[oó]|lo (envi[eé]|mand[eé]|hice|anot[eé]))|(mensaje |correo |borrador )?enviado\b|yes\b|sure\b|done\b|got it\b|of course\b)/,
  ],
];

/** El golpe que pide una frase suya, o null (la mayoría no pide ninguno: habla y ya). */
export function golpeDeFrase(texto: string): ClipVideo | null {
  const t = limpiar(texto);
  if (!t) return null;
  for (const [clip, re] of FRASES) if (re.test(t)) return clip;
  return null;
}

/* ── las fuentes ─────────────────────────────────────────────────────────────────────────── */

function deLoQueDijo(texto: string, emocion?: string) {
  const g = golpeDeFrase(texto) || (emocion === 'orgullo' ? 'celebra' : null);
  if (g) pedirGolpe(g, true);
}

function conectar(): () => void {
  let textoMesa = ecoMesa.ultimo().texto;
  let emocionMesa = ecoMesa.ultimo().emocion;
  const offs = [
    // Cada frase de la mesa (la voz propia, fuera de la conversación) y su emoción.
    ecoMesa.escuchar((m) => {
      const nuevaFrase = !!m.texto && m.texto !== textoMesa;
      const orgullo = m.emocion === 'orgullo' && emocionMesa !== 'orgullo';
      textoMesa = m.texto;
      emocionMesa = m.emocion;
      if (nuevaFrase) deLoQueDijo(m.texto, m.emocion);
      else if (orgullo) pedirGolpe('celebra', true);
    }),
    // Cada frase suya en la conversación (las de la persona no).
    mensajeVoz.escuchar((m) => {
      if (m?.rol === 'ultron') deLoQueDijo(m.texto, m.emocion);
    }),
    escuchar('hecho', (h) => {
      if ((h.accion as { tipo?: string } | undefined)?.tipo === 'computadora') return;
      pedirGolpe(h.ok ? 'asiente' : 'niega');
    }),
    escuchar('enviado', () => pedirGolpe('asiente')),
    escuchar('accion', (accion) => {
      const a: unknown = accion; // los avisos de su computadora van por el mismo canal (no son AccionApp)
      if (!esAccionPc(a) || a.fase !== 'termina' || a.ok === undefined) return;
      pedirGolpe(a.ok ? 'celebra' : 'niega');
    }),
    escuchar('ambiente', (a) => {
      if (a.sonido === 'papel' || !a.on) ponerLee(!!a.on && a.sonido === 'papel');
    }),
  ];
  return () => offs.forEach((f) => f());
}

let suscritos = 0;
let soltar: (() => void) | null = null;

/** Un cuerpo en video escucha las pistas; la primera vez se conectan las fuentes. Devuelve cómo dejar de escuchar. */
export function suscribirPistas(f: (p: PistasVideo) => void): () => void {
  if (suscritos++ === 0) soltar = conectar();
  const off = pistasVideo.escuchar(f);
  let suelto = false;
  return () => {
    if (suelto) return;
    suelto = true;
    off();
    if (--suscritos === 0) {
      soltar?.();
      soltar = null;
    }
  };
}
