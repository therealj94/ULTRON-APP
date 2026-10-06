/**
 * RECONOCER QUIÉN HABLA, CON PERMISO: lo puro (se prueba en Node: tests/voces-movil.test.ts).
 *
 * Cómo funciona (el audio no se guarda en ningún lado):
 *  1. El oído Turbo (lib/turboMotor.ts) ya tiene el audio PCM de cada frase (trozos de 0,1 s, 16 kHz):
 *     es lo que manda a ElevenLabs para entenderla. Con las voces activadas, en cuanto la frase se CIERRA
 *     (al callar, antes de que Turbo devuelva el texto) se la pasa a las voces (`setOyenteCierre`, con su
 *     id), recortada a `MAX_TROZOS_FRASE` (~8 s); al entregarla, otra vez con el mismo id (`setOyenteAudio`).
 *  2. El teléfono la manda al servidor (POST /api/voces/quien), que saca 192 números de esa voz
 *     (sherpa-onnx, lib/voces-motor.ts), los compara con las voces guardadas de ESTA cuenta y descarta
 *     el audio (`IdentificadorVoz`: una consulta a la vez; en fila, la última frase, nunca se tira).
 *  3. El turno de ESA frase espera su resultado hasta `ESPERA_VOZ_TURNO_MS` (350 ms). Si reconoce a alguien
 *     con seguridad (umbral + margen sobre la segunda), la escena del turno EMPIEZA por «Por la voz, habla
 *     Ana (esposa de José), no José» y el id de Ana viaja aparte (`quienHabla`); el cerebro sabe entonces que
 *     lo privado de José no se le lee a Ana (lib/voces-miembro.ts, reglaQuienHablaDeTurno). Si no llegó a
 *     tiempo, ese turno no dice quién habla: nunca lo de la frase anterior (revisión del 5-oct, M1).
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
 * habló alguien que no conozco, ya no vale lo de antes); solo vale `FRESCO_MS`. Solo para contestar
 * «¿quién está hablando?»: la escena de un turno usa lo de SU frase (`IdentificadorVoz`).
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

/* ── quién dijo ESTA frase, para su turno (revisión del 5-oct, M1) ───────────────────────────── */

/**
 * Lo más que el turno espera lo de su frase. El servidor saca la huella en ~50-120 ms; con la red del
 * teléfono, la respuesta suele llegar antes de que el turno se arme, porque la consulta sale al CERRARSE la
 * frase (lib/turboMotor.ts `setOyenteCierre`), mientras Turbo todavía devuelve el texto. Si no llegó en
 * esto, el turno sale sin decir quién habla: nunca con lo de la frase anterior. Sin voces activas (o sin
 * voces conocidas) no se espera nada.
 */
export const ESPERA_VOZ_TURNO_MS = 350;
/** Una frase entregada a menos de esto de cuando se oyó el turno es la de ese turno. */
export const CASA_FRASE_MS = 1_500;
/** Las frases que se recuerdan (las de los últimos turnos). */
const FRASES_RECORDADAS = 6;

/**
 * Lo más que espera UNA consulta a /api/voces/quien (revisión 7.5, M1′). Las consultas van de a una: una que se cuelga
 * (el servidor cargando el modelo, la red que no contesta) atascaba la fila hasta 25 s y ninguna frase de después se
 * reconocía. A los 4 s se suelta: esa frase queda «sin dato» y sigue la de la fila.
 */
export const TOPE_CONSULTA_VOZ_MS = 4_000;
/**
 * Solo para FRENAR, nunca para dar permiso (revisión 7.5, M1′): si de una frase no se supo quién la dijo (muy corta
 * —un «sí» dura menos que los 1,5 s que pide el servidor—, la consulta tardó o falló) y hace menos de esto se reconoció a
 * alguien que NO es la dueña (sin que después se reconociera a la dueña), el turno lleva su id con la marca `reciente`:
 * el servidor no manda ni descarta nada de la cuenta con ese «sí» y le pide la confirmación a la dueña.
 */
export const CAUTELA_VOZ_MS = 15_000;
/**
 * Revisión 7 (G2): con la voz de la dueña guardada (reconocer voces activo), una frase de la que no se supo la voz (un
 * «sí» corto, la consulta tardó o falló) cuenta como de ella SOLO si su voz se reconoció hace menos de esto y desde
 * entonces no se oyó ninguna otra voz (conocida o no): así su «dale» corto sigue sirviendo.
 */
export const CONTINUIDAD_VOZ_MS = 20_000;
/** Su cara (relación «yo», confirmada por votos) vista hace menos de esto también cuenta como presencia, sin otra voz. */
export const CONTINUIDAD_CARA_MS = 10_000;

export type RespuestaQuienHabla = { persona: PersonaVoz | null; motivo?: string };
/**
 * Lo que viaja aparte en el turno (lib/api.ts turnoBody): el id de la voz y, si es solo precaución, `reciente`. O,
 * revisión del 6-oct (bloqueante 2), `desconocida`: la dueña tiene su voz guardada y esta frase, lo bastante larga, NO
 * fue de ella ni de nadie conocido: el servidor contesta en modo invitado (server/modo-invitado.ts). Solo quita acceso.
 */
export type QuienHablaTurno = { id: string; reciente?: true } | { desconocida: true } | { incierta: true };
/**
 * Lo sabido de una frase: la persona, null («no la conozco»), o undefined (no se pudo saber). `desconocida`: el servidor
 * comparó una frase de largo suficiente y no se parece a nadie guardado (`nadie_cerca`).
 */
type SabidoFrase = { persona: PersonaVoz | null | undefined; desconocida?: true };
type EstadoFrase = { id: number; trozos?: string[]; enCurso?: boolean; sabido?: SabidoFrase; entregadaEn?: number; oidaEn: number; esperas: Array<() => void> };

/**
 * Quién dijo cada frase, por su id (el del oído Turbo). Antes el reconocimiento iba sin esperar y el turno
 * leía «lo último reconocido» (45 s): casi siempre era lo de la frase ANTERIOR, así que el primer pedido de
 * Ana justo después de José salía como de José. Y mientras había una consulta en curso, las frases
 * nuevas se tiraban.
 *
 *  · `oir`: el audio de una frase (al cerrarse). Se consulta YA; con una consulta en curso queda en fila la
 *    ÚLTIMA (la que esperaba antes queda «sin dato»): nunca se tira la frase nueva.
 *  · `entregada`: la frase llegó como turno (cuándo).
 *  · `paraTurno(oidaEn)`: lo de la frase de ESE turno, esperando hasta `ESPERA_VOZ_TURNO_MS`. undefined si
 *    no hay frase, no se pudo o no llegó a tiempo: el turno no dice quién habla. Un resultado tardío queda
 *    para SU frase (un reintento del mismo turno), nunca para la siguiente.
 */
export class IdentificadorVoz {
  private frases: EstadoFrase[] = [];
  private consultando = false;
  private enFila: EstadoFrase | null = null;
  /** La última frase reconocida de alguien que no es la dueña, y cuándo se dijo (para la precaución). */
  private otra: { persona: PersonaVoz; t: number } | null = null;
  /** Cuándo se dijo la última frase reconocida de la dueña. */
  private duenaEn = 0;
  /** Cuándo se dijo la última frase que se comparó y NO es de nadie seguro (`nadie_cerca` o `dudosa`). */
  private extranaEn = 0;
  private reloj: () => number;
  private topeMs: number;
  constructor(
    private consultar: (trozos: string[]) => Promise<RespuestaQuienHabla>,
    private alSaber?: (id: number, persona: PersonaVoz | null | undefined) => void,
    o: { reloj?: () => number; topeMs?: number } = {}
  ) {
    this.reloj = o.reloj || Date.now;
    this.topeMs = o.topeMs ?? TOPE_CONSULTA_VOZ_MS;
  }

  private de(id: number, crear = false): EstadoFrase | null {
    let f = this.frases.find((x) => x.id === id) || null;
    if (!f && crear) {
      f = { id, oidaEn: this.reloj(), esperas: [] };
      this.frases = [...this.frases, f].slice(-FRASES_RECORDADAS);
    }
    return f;
  }

  private saber(f: EstadoFrase, persona: PersonaVoz | null | undefined, desconocida = false) {
    if (f.sabido) return;
    f.sabido = { persona, ...(persona === null && desconocida ? { desconocida: true as const } : {}) };
    // Quién habló hace poco, por cuándo se DIJO cada frase (un resultado tardío de una frase vieja no pisa a uno nuevo).
    if (persona?.relacion === 'yo') this.duenaEn = Math.max(this.duenaEn, f.oidaEn);
    else if (persona && (!this.otra || f.oidaEn >= this.otra.t)) this.otra = { persona, t: f.oidaEn };
    else if (persona === null) this.extranaEn = Math.max(this.extranaEn, f.oidaEn);
    for (const r of f.esperas.splice(0)) r();
    try {
      this.alSaber?.(f.id, persona);
    } catch {
      /* quien escucha nunca rompe el reconocimiento */
    }
  }

  private lanzar(f: EstadoFrase) {
    const trozos = f.trozos || [];
    f.trozos = undefined;
    f.enCurso = true;
    this.consultando = true;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    // Con tope: una consulta colgada no atasca la fila (queda «sin dato»).
    const tope = new Promise<never>((_, no) => (reloj = setTimeout(() => no(new Error('tope')), this.topeMs)));
    void Promise.race([Promise.resolve().then(() => this.consultar(trozos)), tope])
      .finally(() => clearTimeout(reloj))
      .then(
        (r) => ({ p: r?.motivo === 'muy_corta' || r?.motivo === 'silencio' ? undefined : r?.persona ?? null, desconocida: !r?.persona && r?.motivo === 'nadie_cerca' }),
        () => ({ p: undefined, desconocida: false })
      )
      .then(({ p, desconocida }) => {
        f.enCurso = false;
        this.saber(f, p, desconocida);
        this.consultando = false;
        const sigue = this.enFila;
        this.enFila = null;
        if (sigue) this.lanzar(sigue);
      });
  }

  /** El audio de la frase `id`: se reconoce ya, o queda en fila (solo la última). */
  oir(id: number, trozos: string[]) {
    const f = this.de(id, true)!;
    if (f.sabido || f.trozos || f.enCurso) return;
    f.trozos = trozos;
    if (!this.consultando) return this.lanzar(f);
    if (this.enFila) {
      this.enFila.trozos = undefined;
      this.saber(this.enFila, undefined);
    }
    this.enFila = f;
  }

  /** Una frase que no se reconoce (muy corta, aprendiendo una voz): su turno no dice quién habla. */
  sinDato(id: number) {
    const f = this.de(id, true)!;
    if (this.enFila === f) this.enFila = null;
    f.trozos = undefined;
    this.saber(f, undefined);
  }

  /** La frase `id` llegó como turno. */
  entregada(id: number, en: number) {
    this.de(id, true)!.entregadaEn = en;
  }

  /** ¿Ya se oyó (o se sabe) esta frase? */
  conocida(id: number): boolean {
    const f = this.de(id);
    return !!f && (!!f.sabido || !!f.trozos || !!f.enCurso);
  }

  /** La frase del turno oído en `oidaEn` (la entregada más cerca, a menos de `CASA_FRASE_MS`). */
  private delTurno(oidaEn: number): EstadoFrase | null {
    if (!(oidaEn > 0)) return null;
    let mejor: EstadoFrase | null = null;
    for (const f of this.frases) {
      if (f.entregadaEn === undefined || Math.abs(f.entregadaEn - oidaEn) > CASA_FRASE_MS) continue;
      if (!mejor || Math.abs(f.entregadaEn - oidaEn) <= Math.abs(mejor.entregadaEn! - oidaEn)) mejor = f;
    }
    return mejor;
  }

  /** Lo de la frase del turno oído en `oidaEn`, esperando hasta `ms`. */
  async paraTurno(oidaEn: number, ms = ESPERA_VOZ_TURNO_MS): Promise<PersonaVoz | null | undefined> {
    const f = this.delTurno(oidaEn);
    if (!f) return undefined;
    if (!f.sabido && ms > 0) {
      let reloj: ReturnType<typeof setTimeout> | undefined;
      await new Promise<void>((r) => {
        f.esperas.push(r);
        reloj = setTimeout(r, ms);
      });
      clearTimeout(reloj);
    }
    return f.sabido?.persona;
  }

  /** ¿La frase del turno oído en `oidaEn` se comparó y no es de nadie guardado (`nadie_cerca`)? */
  desconocida(oidaEn: number): boolean {
    return this.delTurno(oidaEn)?.sabido?.desconocida === true;
  }

  /**
   * La precaución para el turno oído en `oidaEn` cuyo resultado no se supo: la última voz reconocida que NO es la dueña,
   * si se dijo hace menos de `ms` y la dueña no se reconoció después. null si no hay. Solo sirve para frenar.
   */
  cautela(oidaEn: number, ms = CAUTELA_VOZ_MS): PersonaVoz | null {
    const o = this.otra;
    if (!o || !(oidaEn > 0) || oidaEn - o.t > ms || o.t > oidaEn) return null;
    return this.duenaEn > o.t ? null : o.persona;
  }

  /**
   * Revisión 7 (G2): ¿la frase sin dato del turno oído en `oidaEn` sigue siendo de la dueña? Sí si su voz se reconoció hace
   * menos de `CONTINUIDAD_VOZ_MS` y ninguna otra voz (conocida o no) se oyó después; o si su cara (confirmada por votos)
   * se vio hace menos de `CONTINUIDAD_CARA_MS` y no se oyó ninguna otra voz en `CONTINUIDAD_VOZ_MS`. Si no, no se sabe.
   */
  continuidad(oidaEn: number, o: { caraDuenaEn?: number } = {}): boolean {
    if (!(oidaEn > 0)) return false;
    const ajena = Math.max(this.otra?.t ?? 0, this.extranaEn);
    const porVoz = this.duenaEn > 0 && this.duenaEn <= oidaEn && oidaEn - this.duenaEn <= CONTINUIDAD_VOZ_MS && ajena < this.duenaEn;
    if (porVoz) return true;
    const cara = o.caraDuenaEn || 0;
    const porCara = cara > 0 && Math.abs(oidaEn - cara) <= CONTINUIDAD_CARA_MS && (ajena === 0 || oidaEn - ajena > CONTINUIDAD_VOZ_MS);
    return porCara;
  }

  /** Lo sabido de la frase más nueva que ya se sabe (para «¿quién habla?»). */
  ultima(): { id: number; persona: PersonaVoz | null } | null {
    for (let i = this.frases.length - 1; i >= 0; i--) {
      const f = this.frases[i];
      if (f.sabido && f.sabido.persona !== undefined) return { persona: f.sabido.persona, id: f.id };
    }
    return null;
  }

  /** Espera (hasta `ms`) a saber la frase entregada más nueva. */
  async esperarUltima(ms: number): Promise<void> {
    const f = [...this.frases].reverse().find((x) => x.entregadaEn !== undefined);
    if (!f || f.sabido) return;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    await new Promise<void>((r) => {
      f.esperas.push(r);
      reloj = setTimeout(r, ms);
    });
    clearTimeout(reloj);
  }

  olvidar() {
    this.frases = [];
    this.enFila = null;
    this.otra = null;
    this.duenaEn = 0;
    this.extranaEn = 0;
  }
}

/**
 * Lo de las voces para el turno de la frase oída en `oidaEn` (useVoces.paraTurno): «Por la voz, habla Ana…» y su id si la
 * reconoció y no es la dueña. Si de ESA frase no se supo nada (muy corta, tardó, falló), la precaución (revisión 7.5,
 * M1′): el id de la última voz que no es la dueña, con `reciente`, sin frase en la escena (no se sabe que hable ella).
 *
 * Revisión 7 (G2, «ningún dato privado para invitados»): con la voz de la dueña guardada (`duenaInscrita`), lo privado
 * solo va si la dueña quedó identificada en ESA frase, o por continuidad (`IdentificadorVoz.continuidad`: su voz hace
 * menos de 20 s sin otra voz después, o su cara confirmada hace menos de 10 s). Todo lo demás —una frase dudosa, un
 * «sí» corto sin continuidad, la consulta que tardó más de 350 ms o falló (503)— va como `{ incierta: true }` y el
 * servidor arma el turno en modo invitado. Sin su voz guardada, la sesión es la dueña como siempre (solo frena lo que
 * se sabe de otra voz). Una frase escrita (`oidaEn` 0) no lleva señal de voz.
 */
export async function quienHablaDelTurno(
  ident: IdentificadorVoz,
  oidaEn: number,
  duena: string,
  en = false,
  duenaInscrita = false,
  o: { caraDuenaEn?: number } = {}
): Promise<{ frase: string; quienHabla?: QuienHablaTurno }> {
  if (!(oidaEn > 0)) return { frase: '' };
  const p = await ident.paraTurno(oidaEn);
  if (p) return { frase: fraseQuienHabla(p, duena, en), ...(p.relacion === 'conocido' ? { quienHabla: { id: p.id } } : {}) };
  if (!duenaInscrita) {
    // Sin su voz guardada no se puede saber si es ella: solo frena lo que se sabe de otra voz.
    if (p === null) return { frase: '' };
    const c = ident.cautela(oidaEn);
    return c ? { frase: '', quienHabla: { id: c.id, reciente: true } } : { frase: '' };
  }
  // Se comparó y no es de nadie seguro: una frase larga que no se parece a nadie (desconocida) o una dudosa (incierta).
  if (p === null) return { frase: '', quienHabla: ident.desconocida(oidaEn) ? { desconocida: true } : { incierta: true } };
  // Sin dato de esta frase: la precaución por otra voz reciente, la continuidad de la dueña, o no se sabe.
  const c = ident.cautela(oidaEn);
  if (c) return { frase: '', quienHabla: { id: c.id, reciente: true } };
  if (ident.continuidad(oidaEn, o)) return { frase: '' };
  return { frase: '', quienHabla: { incierta: true } };
}

/** La frase breve cuando algo privado necesitaba confirmar que es ella y la voz no lo confirmó (revisión 7, G2). */
export function fraseVozNoConfirmada(en = false): string {
  return en ? "I didn't recognize your voice; tell me with a slightly longer sentence." : 'No reconocí tu voz; dímelo con una frase un poco más larga.';
}

/**
 * ¿Este turno puede usar lo privado de la dueña? (lo que decide el teléfono para lo que resuelve solo, sin el servidor:
 * «¿qué sabes de mí?», «recuerda que…»). Igual que el servidor (server/modo-invitado.ts): con cualquier señal de que no
 * es ella o de que no se sabe (`quienHabla` presente: otra voz, precaución, desconocida, incierta), no.
 */
export function privadoPermitido(q: QuienHablaTurno | undefined | null): boolean {
  return !q;
}

/** El campo `quienHabla` tal como viaja en el cuerpo del turno: el id (hasta 40) y `reciente` solo si es `true`. */
export function campoQuienHabla(q: unknown): QuienHablaTurno | undefined {
  const o = (q || {}) as { id?: unknown; reciente?: unknown; desconocida?: unknown; incierta?: unknown };
  const id = typeof o.id === 'string' ? o.id.slice(0, 40) : '';
  if (!id) return o.desconocida === true ? { desconocida: true } : o.incierta === true ? { incierta: true } : undefined;
  return o.reciente === true ? { id, reciente: true } : { id };
}

/**
 * La escena del turno: quién habla por la voz PRIMERO. El teléfono corta la escena a 300 letras y el
 * servidor a 400; con la voz al final, una descripción larga de la cámara se comía la frase y la regla
 * «no le leas lo privado de José» desaparecía sin aviso. Además viaja aparte (`quienHabla`, lib/api.ts).
 */
export function escenaDelTurno(o: { voz?: string; camara?: string; caras?: string }): string | undefined {
  return [o.voz, o.caras, o.camara].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || undefined;
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
