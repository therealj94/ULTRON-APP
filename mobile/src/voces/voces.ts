/**
 * RECONOCER QUIÉN HABLA, CON PERMISO: lo puro (se prueba en Node: tests/voces-movil.test.ts).
 *
 * Cómo funciona (el audio no se guarda en ningún lado):
 *  1. El oído Turbo (lib/turboMotor.ts) ya tiene el audio PCM de cada frase (trozos de 0,1 s, 16 kHz):
 *     es lo que manda a ElevenLabs para entenderla. Con las voces activadas, al entregar la frase también
 *     se la pasa a las voces (`setOyenteAudio`), recortada a `MAX_TROZOS_FRASE` (~8 s).
 *  2. El teléfono la manda al servidor (POST /api/voces/quien), que saca 192 números de esa voz
 *     (sherpa-onnx, lib/voces-motor.ts), los compara con las voces guardadas de ESTA cuenta y descarta
 *     el audio. Sin esperar: el turno sale igual, y el resultado sirve desde la frase siguiente.
 *  3. Si reconoce a alguien con seguridad (umbral + margen sobre la segunda), la escena del turno dice
 *     «Por la voz, habla Ana (esposa de José), no José» durante `FRESCO_MS`; el cerebro sabe entonces que
 *     lo privado de José no se le lee a Ana (server.ts, reglaQuienHabla).
 *
 * Solo con el oído Turbo: el del teléfono (Google) no entrega audio, y el de la nube graba m4a (AAC),
 * que habría que decodificar; la conversación en vivo (voz-agente) manda el micrófono por WebRTC a
 * ElevenLabs sin pasar por aquí. Con esos oídos las voces no aprenden ni reconocen (y se dice).
 *
 * Consentimiento (igual que las caras, src/caras/caras.ts):
 *  · la persona activa «reconocer voces» (Más → Voces) sabiendo qué se guarda;
 *  · «aprende mi voz» guarda la SUYA: tres frases (≥ 8 s en total);
 *  · «aprende la voz de Ana» pregunta EN VOZ ALTA «Ana, ¿puedo recordar tu voz?»; solo un «sí» dentro de
 *    `ESPERA_CONSENTIMIENTO_MS` empieza a oír sus frases (la frase del «sí» queda como constancia);
 *  · «olvida la voz de Ana», «olvida mi voz», «olvida todas las voces» borran de verdad en el servidor.
 */
import { wavDeTrozos } from '../lib/turboLogica';

/** Lo que vale lo reconocido para la escena del turno. */
export const FRESCO_MS = 45_000;
/** Lo que espera el «sí» de la persona presentada. */
export const ESPERA_CONSENTIMIENTO_MS = 30_000;
/** Lo que espera cada frase mientras aprende una voz. */
export const ESPERA_MUESTRA_MS = 45_000;
/** El audio de una frase sirve para lo que se diga justo después (el texto llega pegado al audio). */
export const AUDIO_VIGENTE_MS = 6_000;
/** Trozos de 0,1 s: el oído Turbo guarda 6 antes de que empiece la voz. */
export const SEG_TROZO = 0.1;
export const PREROLLO_TROZOS = 6;
/** Lo más que se manda de una frase (~8 s): basta para la huella y el cuerpo queda chico. */
export const MAX_TROZOS_FRASE = 80;
/** Menos que esto (con el prerollo) no alcanza para saber quién habla (el servidor pide 1,5 s de voz). */
export const MIN_TROZOS_QUIEN = 20;
/** Para aprender: hasta 3 frases; con 2 basta si ya suman `SEG_APRENDER`. */
export const FRASES_APRENDER = 3;
export const SEG_APRENDER = 8;

/* ── el audio de una frase ───────────────────────────────────────────────────────────────────── */

/** La frase recortada: sin casi todo el prerollo (silencio) y hasta ~8 s. */
export function recortarFrase(trozos: string[]): string[] {
  const desde = trozos.length > PREROLLO_TROZOS + 10 ? PREROLLO_TROZOS - 2 : 0;
  return trozos.slice(desde, desde + MAX_TROZOS_FRASE);
}

export function segundosDe(trozos: string[]): number {
  return Math.round(trozos.length * SEG_TROZO * 10) / 10;
}

/** El WAV (base64) que espera el servidor: el mismo que arma el oído Turbo para /api/stt. */
export const wavDeFrase = (trozos: string[]) => wavDeTrozos(trozos);

/* ── lo que se dice ──────────────────────────────────────────────────────────────────────────── */

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const PARENTESCOS =
  'esposa|esposo|mujer|marido|novia|novio|pareja|hija|hijo|mama|madre|papa|padre|hermana|hermano|abuela|abuelo|tia|tio|prima|primo|amiga|amigo|suegra|suegro|cunada|cunado|sobrina|sobrino|nieta|nieto|socia|socio|jefa|jefe|companera|companero|asistente|secretaria|secretario|vecina|vecino|nuera|yerno|madrina|padrino';
const RE_PARENTESCO = new RegExp(`^(?:mi|mis) (${PARENTESCOS})\\b`);

/**
 * Lo que sigue a «la voz de …» / «te presento a …»: el parentesco («mi esposa») y el nombre («Ana»),
 * como se dijeron. Solo el parentesco («mi mamá»): el nombre es el parentesco con mayúscula.
 */
export function quienDe(original: string): { nombre: string; parentesco?: string } | null {
  // El nombre va antes de la primera pausa: «mi esposa Ana, por favor» → «mi esposa Ana».
  const limpio = original
    .replace(/^[\s¿¡"«]+/, '')
    .split(/[.,;:!?"»]/)[0]
    .replace(/[¿¡«]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let resto = limpio;
  let parentesco: string | undefined;
  const m = RE_PARENTESCO.exec(sinTildes(limpio));
  if (m) {
    const palabras = limpio.split(' ');
    parentesco = palabras[1].toLowerCase();
    resto = palabras.slice(2).join(' ');
  }
  const nombre = resto
    .split(' ')
    .filter((w) => w && !/^(que|y|para|porque|por|mi|mis|ella|el|él|aqui|aquí|ahora|también|tambien|por favor)$/i.test(w))
    .slice(0, 3)
    .join(' ')
    .replace(/^(a|al|la|el)\s+/i, '')
    .slice(0, 60)
    .trim();
  if (nombre) return { nombre, ...(parentesco ? { parentesco } : {}) };
  if (parentesco) return { nombre: parentesco.charAt(0).toUpperCase() + parentesco.slice(1), parentesco };
  return null;
}

export type PedidoVoces =
  | { tipo: 'aprender_mia' }
  /** `debil`: «te presento a Ana» (sin decir «voz»): es de las caras si están activas. */
  | { tipo: 'presentar'; nombre: string; parentesco?: string; debil?: boolean }
  | { tipo: 'olvidar'; nombre: string }
  | { tipo: 'olvidar_mia' }
  | { tipo: 'olvidar_todas' }
  | { tipo: 'lista' }
  | { tipo: 'quien' };

export function pedidoDeVoces(texto: string): PedidoVoces | null {
  const original = String(texto || '').trim();
  const t = sinTildes(original);
  if (/\b(olvida|borra|olvidate de) (todas las voces|las voces)\b/.test(t)) return { tipo: 'olvidar_todas' };
  if (/\b(olvida|borra) mi voz\b|\bolvidate de mi voz\b/.test(t)) return { tipo: 'olvidar_mia' };
  let m = /\b(olvida|borra|olvidate de) la voz de /.exec(t);
  if (m) {
    const q = quienDe(original.slice(m.index + m[0].length));
    if (q) return { tipo: 'olvidar', nombre: q.nombre };
  }
  if (/\b(aprende(te)?|conoce|recuerda|guarda|memoriza|reconoce|graba(te)?) (bien )?mi voz\b/.test(t)) return { tipo: 'aprender_mia' };
  m = /\b(aprende(te)?|conoce|recuerda|guarda|memoriza|graba(te)?) la voz de |\bte presento la voz de /.exec(t);
  if (m) {
    const q = quienDe(original.slice(m.index + m[0].length));
    if (q) return { tipo: 'presentar', ...q };
  }
  m = /\b(te presento a |quiero que conozcas a )/.exec(t);
  if (m && !/\b(quien|que) es\b/.test(t)) {
    const q = quienDe(original.slice(m.index + m[0].length));
    if (q) return { tipo: 'presentar', ...q, debil: true };
  }
  if (/\b(de quien(es)? (voces )?conoces( la voz| las voces)?|que voces (conoces|tienes|guardaste|reconoces)|cuales voces conoces|a quien(es)? reconoces por la voz)\b/.test(t)) return { tipo: 'lista' };
  if (/\b(quien (esta hablando|habla|te habla|te esta hablando)|de quien es (esta|mi) voz|reconoces mi voz|sabes quien soy por la voz|por la voz sabes quien soy)\b/.test(t)) return { tipo: 'quien' };
  return null;
}

/** La respuesta a «¿puedo recordar tu voz?». null: no dijo ni sí ni no (se toma como no). */
export function respuestaSiNo(texto: string): 'si' | 'no' | null {
  const t = sinTildes(String(texto || '')).replace(/[.,;:!?¿¡"«»]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(no|nop|nel|mejor no|no gracias|prefiero que no|no quiero)\b/.test(t) || /\bno (me )?(recuerdes|guardes|grabes)\b/.test(t)) return 'no';
  if (/^(si|sip|claro|por supuesto|dale|va|ok|okay|de acuerdo|esta bien|acepto|puedes|adelante|yes|sure)\b/.test(t) || /\b(si,? (puedes|claro)|puedes recordar(me| mi voz)|recuerdame|recuerda mi voz)\b/.test(t)) return 'si';
  return null;
}

/** Parar a medias mientras aprende («cancela», «ya no», «olvídalo»). */
export function esCancelar(texto: string): boolean {
  return /^(cancela|cancelar|para|detente|ya no|olvidalo|dejalo|mejor no|no importa|stop|cancel)\b/.test(sinTildes(String(texto || '')).replace(/[.,;:!?¿¡]/g, '').trim());
}

/* ── aprender una voz: el permiso y las frases ───────────────────────────────────────────────── */

export type PasoInscripcion = {
  tipo: 'yo' | 'conocido';
  nombre: string;
  parentesco?: string;
  fase: 'permiso' | 'frases';
  /** La frase del «sí» (constancia del consentimiento de la persona presentada). */
  frase?: string;
  frases: string[][];
  hasta: number;
};

/**
 * La voz que se está aprendiendo: quién, en qué paso y las frases oídas. Un pedido nuevo reemplaza al
 * anterior; vencido el plazo de un paso, no vale.
 */
export class Inscripcion {
  private p: PasoInscripcion | null = null;
  constructor(private reloj: () => number = Date.now) {}

  empezarMia(nombre: string) {
    this.p = { tipo: 'yo', nombre, fase: 'frases', frases: [], hasta: this.reloj() + ESPERA_MUESTRA_MS };
  }

  empezarConocido(nombre: string, parentesco?: string) {
    this.p = { tipo: 'conocido', nombre, ...(parentesco ? { parentesco } : {}), fase: 'permiso', frases: [], hasta: this.reloj() + ESPERA_CONSENTIMIENTO_MS };
  }

  /** El paso que espera ahora (null si no hay o venció). */
  pendiente(): PasoInscripcion | null {
    if (!this.p) return null;
    if (this.reloj() > this.p.hasta) {
      this.p = null;
      return null;
    }
    return this.p;
  }

  /** La persona presentada dijo que sí: ahora se oyen sus frases. */
  consentir(frase: string) {
    if (!this.p || this.p.fase !== 'permiso') return;
    this.p = { ...this.p, fase: 'frases', frase: frase.trim().slice(0, 160), hasta: this.reloj() + ESPERA_MUESTRA_MS };
  }

  /** Una frase más. 'lista' cuando ya alcanza (3 frases, o 2 que sumen `SEG_APRENDER`). */
  agregar(trozos: string[]): 'otra' | 'lista' {
    if (!this.p || this.p.fase !== 'frases') return 'otra';
    const frases = [...this.p.frases, recortarFrase(trozos)];
    this.p = { ...this.p, frases, hasta: this.reloj() + ESPERA_MUESTRA_MS };
    const seg = frases.reduce((s, f) => s + segundosDe(f), 0);
    return frases.length >= FRASES_APRENDER || (frases.length >= 2 && seg >= SEG_APRENDER) ? 'lista' : 'otra';
  }

  terminar() {
    this.p = null;
  }
}

/* ── lo reconocido, para la escena del turno ─────────────────────────────────────────────────── */

export type PersonaVoz = { id: string; nombre: string; relacion: 'yo' | 'conocido'; parentesco?: string };

/** «Por la voz, habla Ana (esposa de José), no José». Para la dueña, sin el «no». */
export function fraseQuienHabla(p: PersonaVoz, duena: string, en = false): string {
  if (p.relacion === 'yo') return en ? `By voice, ${p.nombre} is speaking (the account owner).` : `Por la voz, habla ${p.nombre} (la persona dueña de la cuenta).`;
  const rel = p.parentesco ? (en ? ` (${duena}'s ${p.parentesco})` : ` (${p.parentesco} de ${duena})`) : '';
  return en ? `By voice, ${p.nombre} is speaking${rel}, not ${duena}.` : `Por la voz, habla ${p.nombre}${rel}, no ${duena}.`;
}

/** Cómo se nombra a alguien al hablar con la dueña: «Ana, tu esposa». */
export function nombreCon(p: PersonaVoz, en = false): string {
  if (p.relacion === 'yo') return p.nombre;
  if (!p.parentesco || sinTildes(p.parentesco) === sinTildes(p.nombre)) return p.nombre;
  return en ? `${p.nombre}, your ${p.parentesco}` : `${p.nombre}, tu ${p.parentesco}`;
}

/**
 * El último resultado de «¿quién habló?». Cada frase identificada lo reemplaza (también un «no sé»: si
 * habló alguien que no conozco, ya no vale lo de antes); solo vale `FRESCO_MS`.
 */
export class UltimaVoz {
  private r: { persona: PersonaVoz | null; t: number } | null = null;
  constructor(private reloj: () => number = Date.now) {}
  poner(persona: PersonaVoz | null) {
    this.r = { persona, t: this.reloj() };
  }
  /** Lo reconocido si es fresco (`undefined` si no hay nada fresco; null si fue «no sé»). */
  fresca(ms = FRESCO_MS): PersonaVoz | null | undefined {
    if (!this.r || this.reloj() - this.r.t > ms) return undefined;
    return this.r.persona;
  }
  olvidar() {
    this.r = null;
  }
  escena(duena: string, en = false): string {
    const p = this.fresca();
    return p ? fraseQuienHabla(p, duena, en) : '';
  }
}

/* ── ¿activó el reconocimiento? (por persona, en los ajustes del teléfono) ────────────────── */

const correoNormal = (c: string) => String(c || '').trim().toLowerCase();

export function vocesActivas(mapa: Record<string, number> | undefined, correo: string): boolean {
  return !!mapa?.[correoNormal(correo)];
}

export function conVocesActivas(mapa: Record<string, number> | undefined, correo: string, activas: boolean, ahora = Date.now()): Record<string, number> {
  const c = correoNormal(correo);
  const n = { ...(mapa || {}) };
  if (!c) return n;
  if (activas) n[c] = ahora;
  else delete n[c];
  return n;
}
