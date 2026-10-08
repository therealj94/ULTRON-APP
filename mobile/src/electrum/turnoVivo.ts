/**
 * EL TURNO EN VIVO DEL CAMPO, sin pantalla ni red (José, 8-oct: «la misma voz y el mismo oído que AU-RA»).
 *
 * Antes el teléfono pedía `/api/electrum/turno` y esperaba la respuesta ENTERA (diez, veinte segundos con el
 * catastro de por medio), y después bajaba el audio entero de esa respuesta para empezar a hablar. Ahora pide
 * `/api/electrum/turno/stream` (SSE) y el servidor manda cada frase en cuanto la tiene (`frase` {i, texto, voz}):
 * el texto crece en la pantalla y la voz empieza con la primera frase, mientras el doctor sigue pensando el resto.
 * Al final llega `fin` con el texto entero (y `frases`: cuántas mandó): la pantalla lo pone tal cual y la voz NO
 * repite lo que ya dijo.
 *
 * Lo que vive aquí (se prueba en Node, tests/electrum-movil-voz.test.ts):
 *  · `TurnoEnVivo`: junta lo que llega (frases, herramientas, órdenes del mapa, el panel, el fin), revisado;
 *  · `porDecirAlFin`: qué falta decir cuando llega el fin (nada si ya se dijo todo; la mesa por personaje);
 *  · `pedirTurno`: el stream con su reintento (una vez, con el MISMO `idTurno`: el servidor no lo contesta dos
 *    veces) y el respaldo por la ruta de siempre si el servidor no trae el stream (404) o se cortó a medias;
 *  · `partirEnFrases` y `limpiarParaVoz`: para lo que llega sin frases (un servidor viejo, una respuesta fija).
 */
import { cortesDe, letras, tienePalabras } from '../lib/cortesVoz';
import { soloExpresiones } from '../lib/expresiones';
import { TOPE_CORTADA } from '../lib/interrupcion';
import { faltaDecir } from '../lib/reemplazoVoz';
import type { Traza } from './campo';
import { CODIGO_EN_CURSO, ErrorHttp } from './frases';

/** Quién habla en la mesa (server/electrum/personajes.ts `Experto`). */
export type Personaje = 'electrum' | 'chema' | 'tatiana';
const PERSONAJES: readonly Personaje[] = ['electrum', 'chema', 'tatiana'];

/** Una frase del stream: lo que se lee (`texto`) y lo que se dice (`voz`, con las etiquetas de expresión). */
export type FraseVivo = { i: number; texto: string; voz: string; idioma?: 'es' | 'en' };

/** Una intervención de la mesa (Don Chema, la Ing. Tatiana…): suena con la voz de su personaje. */
export type VozMesa = { quien: Personaje; texto: string };

/** El `fin` del stream (o la respuesta de la ruta de siempre, con la misma forma). */
export type FinVivo = {
  texto: string;
  voz?: string;
  voces?: VozMesa[];
  emocion?: string;
  panel?: string;
  traza?: Traza[];
  ui?: Array<Record<string, unknown>>;
  idioma?: 'es' | 'en';
  /** Cuántas frases mandó el stream (servidor nuevo). Sin el dato: no se sabe, se compara por el texto. */
  frases?: number;
};

/** Una frase para la voz: el texto, lo que se dice y, en la mesa, quién lo dice. */
export type FraseVoz = { texto: string; voz?: string; personaje?: Personaje; idioma?: 'es' | 'en'; emocion?: string };

const idiomaDe = (v: unknown): 'es' | 'en' | undefined => (v === 'en' ? 'en' : v === 'es' ? 'es' : undefined);
const texto = (v: unknown, tope: number): string => (typeof v === 'string' ? v.slice(0, tope).trim() : '');

/** Un id por pregunta, para que el servidor no la conteste dos veces si el teléfono la repite (red de campo). */
export function nuevoIdTurno(ahora: number = Date.now(), azar: () => number = Math.random): string {
  const a = Math.floor(azar() * 36 ** 8)
    .toString(36)
    .padStart(8, '0');
  return `cm-${ahora.toString(36)}-${a}`;
}

/**
 * EL VISITANTE DE ESTE TELÉFONO (`x-electrum-visita`, como la web: src-electrum/acceso.ts). Sin él, quien no tiene
 * sesión del padrón era para el servidor una huella de IP y navegador (server/electrum/hilo.ts quienDelHilo): cambiar
 * de red (wifi → datos) cambiaba de «persona» (el reintento de una pregunta no la encontraba y se pensaba dos veces) y,
 * detrás del NAT de la operadora, muchos teléfonos eran la misma. Un id al azar por instalación, que se guarda.
 */
export const FORMA_VISITA = /^[A-Za-z0-9_-]{22,64}$/;

/** 16 bytes al azar → 22 caracteres base64url (la forma que acepta el servidor). */
export function visitaDeBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Lo guardado, si tiene la forma que acepta el servidor; null si no. */
export function visitaValida(v: unknown): string | null {
  return typeof v === 'string' && FORMA_VISITA.test(v) ? v : null;
}

/** Lo que manda `frase`, revisado: basura → null. */
export function fraseValida(d: unknown): FraseVivo | null {
  const o = d as any;
  if (!o || typeof o !== 'object') return null;
  const i = typeof o.i === 'number' && Number.isInteger(o.i) && o.i >= 0 && o.i < 10_000 ? o.i : null;
  const t = texto(o.texto, 2000);
  if (i === null || !t) return null;
  const v = texto(o.voz, 2000) || t;
  const idioma = idiomaDe(o.idioma);
  return { i, texto: t, voz: v, ...(idioma ? { idioma } : {}) };
}

/** Lo que manda `herramienta` (o un paso de la traza), revisado. */
export function herramientaValida(d: unknown): Traza | null {
  const o = d as any;
  if (!o || typeof o !== 'object' || typeof o.herramienta !== 'string' || !o.herramienta.trim()) return null;
  return {
    herramienta: o.herramienta.slice(0, 80),
    ok: o.ok !== false,
    resumen: typeof o.resumen === 'string' ? o.resumen.slice(0, 400) : '',
    ...(typeof o.ms === 'number' && Number.isFinite(o.ms) ? { ms: o.ms } : {}),
  };
}

/** Las intervenciones de la mesa, revisadas (un personaje que no se conoce, fuera). */
export function vocesValidas(v: unknown): VozMesa[] {
  if (!Array.isArray(v)) return [];
  const out: VozMesa[] = [];
  for (const x of v) {
    const quien = PERSONAJES.find((p) => p === (x as any)?.quien);
    const t = texto((x as any)?.texto, 2000);
    if (quien && t) out.push({ quien, texto: t });
  }
  return out;
}

/** El `fin` (o la respuesta JSON de `/api/electrum/turno`), revisado. null si no trae texto. */
export function finValido(d: unknown): FinVivo | null {
  const o = d as any;
  if (!o || typeof o !== 'object') return null;
  const t = texto(o.texto, 20_000);
  const voces = vocesValidas(o.voces);
  if (!t && !voces.length) return null;
  const idioma = idiomaDe(o.idioma);
  const traza = Array.isArray(o.traza) ? (o.traza.map(herramientaValida).filter(Boolean) as Traza[]) : undefined;
  const ui = Array.isArray(o.ui) ? o.ui.filter((u: unknown) => u && typeof u === 'object') : undefined;
  return {
    texto: t || voces.map((v) => v.texto).join('\n\n'),
    ...(typeof o.voz === 'string' && o.voz.trim() ? { voz: o.voz.trim() } : {}),
    ...(voces.length ? { voces } : {}),
    ...(typeof o.emocion === 'string' ? { emocion: o.emocion } : {}),
    ...(typeof o.panel === 'string' ? { panel: o.panel } : {}),
    ...(traza ? { traza } : {}),
    ...(ui ? { ui } : {}),
    ...(idioma ? { idioma } : {}),
    ...(typeof o.frases === 'number' && Number.isInteger(o.frases) && o.frases >= 0 ? { frases: o.frases } : {}),
  };
}

export type EventoTurno = 'frase' | 'panel' | 'herramienta' | 'ui' | 'fin' | 'error';

/**
 * Lo que va llegando de un turno. Cada evento se revisa; uno raro no rompe nada. Las frases van por su número
 * (`i`): una repetida no se cuenta dos veces y una que llega desordenada se pone en su sitio.
 */
export class TurnoEnVivo {
  readonly frases: FraseVivo[] = [];
  readonly traza: Traza[] = [];
  readonly ui: Array<Record<string, unknown>> = [];
  panel = '';
  fin: FinVivo | null = null;
  error: string | null = null;
  /** El `codigo` del error, si el servidor lo mandó (`en-curso`: la misma pregunta todavía se está pensando). */
  codigoError: string | null = null;
  /** ¿Llegó algo del servidor? (un reintento ya no es gratis: puede repetir lo dicho). */
  recibio = false;

  /** Un evento SSE. Devuelve qué fue (null si no se entendió); `frase`, la nueva si lo es. */
  evento(nombre: string, datos: unknown): { tipo: EventoTurno; frase?: FraseVivo } | null {
    switch (nombre) {
      case 'frase': {
        const f = fraseValida(datos);
        if (!f || this.frases.some((x) => x.i === f.i)) return null;
        this.recibio = true;
        const k = this.frases.findIndex((x) => x.i > f.i);
        if (k < 0) this.frases.push(f);
        else this.frases.splice(k, 0, f);
        return { tipo: 'frase', frase: f };
      }
      case 'panel': {
        const p = texto((datos as any)?.panel, 200);
        if (!p) return null;
        this.recibio = true;
        this.panel = p;
        return { tipo: 'panel' };
      }
      case 'herramienta': {
        const h = herramientaValida(datos);
        if (!h) return null;
        this.recibio = true;
        this.traza.push(h);
        return { tipo: 'herramienta' };
      }
      case 'ui': {
        if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return null;
        this.recibio = true;
        this.ui.push(datos as Record<string, unknown>);
        return { tipo: 'ui' };
      }
      case 'fin': {
        const f = finValido(datos);
        if (!f) return null;
        this.recibio = true;
        this.fin = f;
        return { tipo: 'fin' };
      }
      case 'error': {
        this.recibio = true;
        this.error = texto((datos as any)?.error, 300) || 'Se me cayó el turno.';
        this.codigoError = texto((datos as any)?.codigo, 40) || null;
        return { tipo: 'error' };
      }
      default:
        return null;
    }
  }

  /** Lo que se enseña mientras llega: las frases en orden (el fin lo reemplaza entero). */
  textoVisible(): string {
    if (this.fin) return this.fin.texto;
    return this.frases.map((f) => f.texto).join(' ');
  }
}

/** Texto para pedir voz: sin markdown ni emojis; las expresiones conocidas se quedan (como `cleanForSpeech` de AU-RA). */
export function limpiarParaVoz(t: string): string {
  return soloExpresiones(String(t || ''))
    .replace(/\*+/g, '')
    .replace(/#+\s?/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lo más largo que se le pide a la voz de una vez (server.ts corta `/api/electrum/voz` en 1200). */
export const TOPE_FRASE_VOZ = 600;

/**
 * Un texto entero en frases para ir diciéndolo (con el contrato de cortes de lib/cortesVoz.ts: «Dr. Gómez» o
 * «1.500» no se parten). Las colas muy cortas («Sí.») van con la anterior; una frase larguísima se parte en sus
 * comas para no pasar de `TOPE_FRASE_VOZ`.
 */
export function partirEnFrases(t: string, tope = TOPE_FRASE_VOZ): string[] {
  const limpio = String(t || '').trim();
  if (!limpio) return [];
  const partes: string[] = [];
  let desde = 0;
  for (const c of cortesDe(limpio, { comas: false })) {
    partes.push(limpio.slice(desde, c.fin).trim());
    desde = c.fin;
  }
  partes.push(limpio.slice(desde).trim());
  const out: string[] = [];
  for (const p of partes) {
    if (!p || !tienePalabras(p)) {
      if (p && out.length) out[out.length - 1] += ` ${p}`;
      continue;
    }
    if (p.length <= tope) {
      out.push(p);
      continue;
    }
    let buf = '';
    for (const s of p.split(/(?<=[,;:])\s+/)) {
      if (buf && (buf + ' ' + s).length > tope) {
        out.push(buf);
        buf = s;
      } else buf = buf ? `${buf} ${s}` : s;
    }
    while (buf.length > tope) {
      const corte = buf.lastIndexOf(' ', tope);
      const en = corte > tope / 2 ? corte : tope;
      out.push(buf.slice(0, en).trim());
      buf = buf.slice(en).trim();
    }
    if (buf) out.push(buf);
  }
  const juntas: string[] = [];
  for (const s of out) {
    if (juntas.length && letras(s) < 6) juntas[juntas.length - 1] += ` ${s}`;
    else juntas.push(s);
  }
  return juntas;
}

/**
 * QUÉ FALTA DECIR AL LLEGAR EL FIN. `encoladas`: las frases del stream que ya se mandaron a la voz (su texto).
 *  · La mesa (`voces`): cada intervención con su personaje — salvo que el stream ya hubiera mandado frases (no
 *    debería: el servidor no las manda en la mesa), que entonces ya sonaron y no se repiten.
 *  · Sin frases del stream (servidor viejo, respuesta fija, la ruta de siempre): el texto entero, por frases.
 *  · Con frases: nada si el servidor dice que mandó esas mismas (o menos); si no, lo que falta según el texto
 *    (lib/reemplazoVoz.ts `faltaDecir`). Si el final CORRIGE lo dicho, no se repite nada: la pantalla ya enseña
 *    el texto bueno y la voz no vuelve a empezar.
 */
export function porDecirAlFin(fin: FinVivo, encoladas: readonly string[] = []): FraseVoz[] {
  const idioma = fin.idioma;
  const con = (o: FraseVoz): FraseVoz => ({ ...o, ...(idioma ? { idioma } : {}), ...(fin.emocion ? { emocion: fin.emocion } : {}) });
  if (fin.voces?.length) {
    if (encoladas.length) return [];
    const out: FraseVoz[] = [];
    for (const v of fin.voces) for (const p of partirEnFrases(limpiarParaVoz(v.texto))) out.push(con({ texto: p, personaje: v.quien }));
    return out;
  }
  if (!encoladas.length) {
    return partirEnFrases(limpiarParaVoz(fin.voz || fin.texto)).map((p) => con({ texto: p }));
  }
  if (typeof fin.frases === 'number' && fin.frases <= encoladas.length) return [];
  const { decir, corrige } = faltaDecir(encoladas.join(' '), fin.texto);
  if (!decir || corrige) return [];
  return partirEnFrases(limpiarParaVoz(decir)).map((p) => con({ texto: p }));
}

/** Lo que alcanzó a oír la persona al cortar al doctor, para `interrumpido.oido` (con su tope, lo último). */
export function interrumpidoDe(oido: string | null | undefined): { oido: string } | undefined {
  const t = String(oido || '').trim();
  if (!t) return undefined;
  return { oido: t.length > TOPE_CORTADA ? `…${t.slice(-TOPE_CORTADA)}` : t };
}

/* ------------------------------------------------------------------ pedir el turno, con su respaldo */

/** Por qué se cayó el stream: sin la ruta (servidor viejo), sin red, por tiempo o cortado sin `fin`. */
export type MotivoCorte = 'sin-ruta' | 'red' | 'tiempo' | 'cortado';

export class CorteStream extends Error {
  constructor(readonly motivo: MotivoCorte, detalle = '') {
    // «Network request failed» / «timeout» en el mensaje: `fraseDeError` (frases.ts) los lee así.
    super(motivo === 'red' ? `Network request failed ${detalle}`.trim() : motivo === 'tiempo' ? `timeout ${detalle}`.trim() : `stream ${motivo} ${detalle}`.trim());
    this.name = 'CorteStream';
  }
}

/** Se canceló a propósito (la persona le habló encima, salió de la pantalla): nadie avisa nada. */
export class TurnoCancelado extends Error {
  constructor() {
    super('turno cancelado');
    this.name = 'TurnoCancelado';
  }
}

export type CuerpoTurno = { mensaje: string; idTurno: string; interrumpido?: { oido: string } } & Record<string, unknown>;

export type DepsPedirTurno = {
  /** El stream: llama `alEvento` con cada evento y termina cuando se cierra (rechaza con CorteStream, ErrorHttp…). */
  stream(cuerpo: CuerpoTurno, alEvento: (nombre: string, datos: unknown) => void): { promesa: Promise<void>; abortar(): void };
  /** La ruta de siempre (`/api/electrum/turno`, JSON entero), con el mismo cuerpo. */
  json(cuerpo: CuerpoTurno): Promise<unknown>;
  /** ¿Se sabe ya que este servidor no tiene el stream? (para no pedirlo en cada pregunta). */
  sinStream?(): boolean;
  /** El servidor contestó 404/405 al stream: es uno de antes. */
  alSinStream?(): void;
};

/** ¿Es un fallo de red de la ruta de siempre? (`fetch` de React Native: TypeError «Network request failed»). */
export function esFalloDeRed(e: unknown): boolean {
  if (e instanceof CorteStream) return e.motivo === 'red';
  const m = String((e as any)?.message || '');
  return (e as any)?.name !== 'AbortError' && /network request failed|failed to fetch|network ?error/i.test(m);
}

/**
 * Pide el turno. Por el stream si el servidor lo tiene; si no (404) o se cortó a medias, por la ruta de siempre con
 * el MISMO `idTurno` (el servidor no vuelve a pensar una pregunta que ya contestó). Reintenta una sola vez y solo si
 * no llegó nada (sin red al empezar): con frases ya dichas, repetir el stream repetiría la voz.
 *
 * `turno` junta lo que llega; al terminar, `turno.fin` es la respuesta (también si vino por la ruta de siempre).
 */
export function pedirTurno(
  deps: DepsPedirTurno,
  cuerpo: CuerpoTurno,
  turno: TurnoEnVivo,
  alEvento?: (r: { tipo: EventoTurno; frase?: FraseVivo }) => void
): { promesa: Promise<{ fin: FinVivo; via: 'stream' | 'json' }>; abortar(): void } {
  let cancelado = false;
  let abortarActual: (() => void) | null = null;
  let rechazarCancelado: ((e: Error) => void) | null = null;
  const cancelada = new Promise<never>((_, rechazar) => (rechazarCancelado = rechazar));
  cancelada.catch(() => {});

  const porJson = async (): Promise<{ fin: FinVivo; via: 'json' }> => {
    let j: unknown;
    try {
      j = await Promise.race([deps.json(cuerpo), cancelada]);
    } catch (e) {
      if (cancelado || !esFalloDeRed(e)) throw e;
      // Sin red al primer intento: una vez más, con el mismo id.
      j = await Promise.race([deps.json(cuerpo), cancelada]);
    }
    if (cancelado) throw new TurnoCancelado();
    const fin = finValido(j);
    if (!fin) throw new Error('respuesta vacía');
    turno.fin = fin;
    return { fin, via: 'json' };
  };

  const unStream = async (): Promise<FinVivo> => {
    const s = deps.stream(cuerpo, (nombre, datos) => {
      if (cancelado) return;
      const r = turno.evento(nombre, datos);
      if (r) alEvento?.(r);
    });
    abortarActual = s.abortar;
    await Promise.race([s.promesa, cancelada]);
    abortarActual = null;
    if (turno.fin) return turno.fin;
    // El servidor contó que se le cayó el turno: un 500 con su frase (frases.ts `fraseDeError`). Si la misma pregunta
    // sigue pensándose en otra petición (`en-curso`), un 409 con SU frase, como el JSON.
    if (turno.error) throw turno.codigoError === CODIGO_EN_CURSO ? new ErrorHttp(409, turno.error, CODIGO_EN_CURSO) : new ErrorHttp(500, turno.error, turno.codigoError || '');
    throw new CorteStream('cortado');
  };

  const promesa = (async () => {
    if (deps.sinStream?.()) return porJson();
    try {
      return { fin: await unStream(), via: 'stream' as const };
    } catch (e) {
      if (cancelado) throw new TurnoCancelado();
      if (!(e instanceof CorteStream)) throw e;
      if (e.motivo === 'sin-ruta') {
        deps.alSinStream?.();
        return porJson();
      }
      if (!turno.recibio && e.motivo === 'red') {
        // No llegó nada: se repite el stream, con el mismo id.
        try {
          return { fin: await unStream(), via: 'stream' as const };
        } catch (e2) {
          if (cancelado) throw new TurnoCancelado();
          if (e2 instanceof CorteStream && turno.recibio) return porJson();
          throw e2;
        }
      }
      // Se cortó a medias (o tardó demasiado con algo ya dicho), o se cerró sin decir nada (un proxy que no deja
      // pasar el stream): la respuesta entera por la ruta de siempre.
      if (turno.recibio || e.motivo === 'cortado') return porJson();
      throw e;
    }
  })();

  return {
    promesa,
    abortar: () => {
      if (cancelado) return;
      cancelado = true;
      try {
        abortarActual?.();
      } catch {
        /* */
      }
      rechazarCancelado?.(new TurnoCancelado());
    },
  };
}
