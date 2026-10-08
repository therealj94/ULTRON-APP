/**
 * LO QUE SALIÓ EN UN TURNO QUE LA PERSONA NO VIO (tanda F1). Un turno JSON o con foto (/api/turno, el respaldo de la mesa
 * y la cámara) que el teléfono corta (se calla, entra una llamada, la mesa se va) sigue en el servidor hasta el final:
 * si en él salió algo afuera (el «sí» a un WhatsApp, un correo, un evento, una herramienta con efecto), el envío y su
 * recibo quedan (server/turno-unico.ts, lib/envios.ts), pero la respuesta que lo decía ya no llega a nadie. Antes la
 * persona no se enteraba: «¿se mandó o no?», y lo pedía otra vez.
 *
 * Ahora:
 *  · `efectosDelTurno`: lo que el turno de verdad hizo afuera, con su recibo: lo que el proveedor confirmó (`salio`) y lo
 *    que se despachó sin saberse el final (`incierto`). Un borrador que espera su «sí» o algo solo guardado en AURA no
 *    cuenta (no salió nada; la tarjeta y el panel ya lo enseñan).
 *  · `anotarEfectosNoVistos`: la ruta lo anota cuando la respuesta no se entregó (la conexión se cortó). Si el teléfono
 *    reintenta ese mismo idTurno y SÍ recibe la respuesta guardada (`repetido`), `turnoVisto` lo quita: ya lo leyó.
 *  · `avisoEfectosNoVistos`: el turno siguiente de esa persona (JSON o stream) lo dice UNA vez, al empezar y con palabras
 *    fijas que salen del recibo (nunca del modelo): «Lo de antes sí salió: le mandé el WhatsApp a Ana.» o «Lo de antes: no
 *    sé si salió el WhatsApp a Ana; revísalo antes de pedirlo otra vez.» (lib/honestidad.ts: nada se da por hecho sin
 *    recibo; lo incierto se dice incierto). `confirmarEfectosNoVistos`, cuando esa respuesta se entregó.
 *
 * En el proceso (como lib/conversacion.ts respuestasSinMemoria): solo canal, destino y estado; nunca el texto del mensaje.
 */
import type { CanalEfecto } from './honestidad';

export type EfectoNoVisto = { canal: CanalEfecto; final: 'salio' | 'incierto'; destino?: string };

/** Cuánto espera un aviso a que la persona vuelva a hablar (después ya no es «lo de antes»). */
export const NO_VISTOS_VIVEN_MS = 6 * 3600_000;
const TOPE_POR_PERSONA = 5;
const TOPE_PERSONAS = 5_000;

type Pendiente = { id: string; efectos: EfectoNoVisto[]; t: number };
const PENDIENTES = new Map<string, Pendiente[]>();
const llave = (dueno: string) => String(dueno || '').trim().toLowerCase();

/** El nombre de un destino, sin el número ni la dirección («Ana +50499991111» → «Ana»). */
function soloNombre(d: unknown): string {
  return String(d || '')
    .replace(/[+\d][\d\s()\-]{5,}/g, ' ')
    .replace(/\S*@\S+/g, ' ')
    .replace(/[()[\]{}<>«»"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

type ResultadoConRecibo = { estado?: string; recibo?: { efecto?: string; entrega?: string } } | null | undefined;

/** Lo que dice el recibo de un resultado: salió, incierto o nada que contar. */
function finalDe(r: ResultadoConRecibo): EfectoNoVisto['final'] | null {
  if (!r) return null;
  const ef = r.recibo?.efecto;
  if (r.estado === 'unknown' || ef === 'posible' || r.recibo?.entrega === 'incierto') return 'incierto';
  if (r.estado === 'succeeded' && ef === 'confirmado' && r.recibo?.entrega !== 'fallido') return 'salio';
  return null;
}

/**
 * El canal de una herramienta que deja algo AFUERA (correo, WhatsApp, el círculo que escribe por WhatsApp, su calendario).
 * Las demás solo guardan dentro de AURA (una misión, la memoria, un documento, su perfil): no son «Lo de antes sí salió»
 * (null: no cuentan, aunque su recibo diga confirmado o incierto).
 */
const canalDeHerramienta = (h: string): CanalEfecto | null => (h === 'correo' ? 'correo' : h === 'whatsapp' || h === 'circulo' ? 'whatsapp' : h === 'calendario' ? 'calendario' : null);
/** Lo que se cuenta como salido afuera (lo guardado en AURA, no). */
const esDeAfuera = (c: CanalEfecto) => c !== 'guardado';

/**
 * Lo que el turno hizo afuera, con recibo. `decisiones`: el «sí» que resolvió el servidor (server/decision-turno.ts), con su
 * destino; `pasos`: las herramientas del harness (lib/harness.ts PasoHarness).
 */
export function efectosDelTurno(o: {
  decisiones?: ReadonlyArray<{ canal: CanalEfecto; r: ResultadoConRecibo; destino?: string }>;
  pasos?: ReadonlyArray<{ herramienta?: string; estado?: string; recibo?: { efecto?: string; entrega?: string } }>;
}): EfectoNoVisto[] {
  const out: EfectoNoVisto[] = [];
  for (const d of o.decisiones || []) {
    const final = finalDe(d.r);
    const destino = soloNombre(d.destino);
    if (final && esDeAfuera(d.canal)) out.push({ canal: d.canal, final, ...(destino ? { destino } : {}) });
  }
  for (const p of o.pasos || []) {
    const final = finalDe(p);
    const canal = canalDeHerramienta(String(p.herramienta || ''));
    if (final && canal) out.push({ canal, final });
  }
  return out;
}

/** El efecto en palabras: lo que salió («le mandé el WhatsApp a Ana») o lo que no se sabe («el WhatsApp a Ana»). */
function enPalabras(e: EfectoNoVisto, en: boolean): string {
  const a = e.destino ? (en ? ` to ${e.destino}` : ` a ${e.destino}`) : '';
  if (e.final === 'salio') {
    if (e.canal === 'whatsapp') return en ? `I sent the WhatsApp${a}` : `${e.destino ? 'le ' : ''}mandé el WhatsApp${a}`;
    if (e.canal === 'correo') return en ? `I sent the email${a}` : `${e.destino ? 'le ' : ''}mandé el correo${a}`;
    if (e.canal === 'chat') return en ? `I sent the message${a}` : `${e.destino ? 'le ' : ''}mandé el mensaje${a}`;
    if (e.canal === 'calendario') return en ? `it's on your calendar${e.destino ? ` («${e.destino}»)` : ''}` : `quedó en tu calendario${e.destino ? ` («${e.destino}»)` : ''}`;
    return en ? 'it got done' : 'quedó hecho';
  }
  if (e.canal === 'whatsapp') return en ? `the WhatsApp${a}` : `el WhatsApp${a}`;
  if (e.canal === 'correo') return en ? `the email${a}` : `el correo${a}`;
  if (e.canal === 'chat') return en ? `the message${a}` : `el mensaje${a}`;
  if (e.canal === 'calendario') return en ? `the calendar event${e.destino ? ` («${e.destino}»)` : ''}` : `el evento${e.destino ? ` («${e.destino}»)` : ''}`;
  return en ? 'what you asked for' : 'lo que pediste';
}

const unir = (xs: string[], en: boolean) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')}${en ? ' and ' : ' y '}${xs[xs.length - 1]}`);

/** La frase fija del aviso (sale del recibo, nunca del modelo). '' si no hay nada que contar. */
export function fraseEfectosNoVistos(efectos: ReadonlyArray<EfectoNoVisto>, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  const vistos = new Set<string>();
  const unicos = efectos.filter((e) => {
    const k = `${e.final}|${e.canal}|${e.destino || ''}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  const salio = unicos.filter((e) => e.final === 'salio').map((e) => enPalabras(e, en));
  const incierto = unicos.filter((e) => e.final === 'incierto').map((e) => enPalabras(e, en));
  if (!salio.length && !incierto.length) return '';
  const partes: string[] = [];
  if (salio.length) partes.push(en ? `About before: it did go out: ${unir(salio, en)}.` : `Lo de antes sí salió: ${unir(salio, en)}.`);
  if (incierto.length) {
    const que = unir(incierto, en);
    partes.push(
      salio.length
        ? en
          ? `I don't know if ${que} went out; check before asking again.`
          : `No sé si salió ${que}; revísalo antes de pedirlo otra vez.`
        : en
          ? `About before: I don't know if ${que} went out; check before asking again.`
          : `Lo de antes: no sé si salió ${que}; revísalo antes de pedirlo otra vez.`
    );
  }
  return partes.join(' ');
}

/** La respuesta de un turno con efectos no se entregó (la conexión se cortó): el turno siguiente lo dice. */
export function anotarEfectosNoVistos(dueno: string, idTurno: string | null | undefined, efectos: ReadonlyArray<EfectoNoVisto>, ahora = Date.now()): void {
  const k = llave(dueno);
  if (!k || !efectos.length) return;
  const id = String(idTurno || `sin-id-${ahora}-${Math.random().toString(36).slice(2, 8)}`);
  const xs = (PENDIENTES.get(k) || []).filter((p) => ahora - p.t <= NO_VISTOS_VIVEN_MS && p.id !== id);
  xs.push({ id, efectos: efectos.map((e) => ({ ...e })), t: ahora });
  PENDIENTES.delete(k);
  PENDIENTES.set(k, xs.slice(-TOPE_POR_PERSONA));
  while (PENDIENTES.size > TOPE_PERSONAS) PENDIENTES.delete(PENDIENTES.keys().next().value as string);
}

/** El teléfono reintentó ese idTurno y recibió la respuesta guardada (que ya lo decía): no hay nada que avisar. */
export function turnoVisto(dueno: string, idTurno: string | null | undefined): void {
  const k = llave(dueno);
  if (!k || !idTurno) return;
  const xs = (PENDIENTES.get(k) || []).filter((p) => p.id !== idTurno);
  if (xs.length) PENDIENTES.set(k, xs);
  else PENDIENTES.delete(k);
}

/**
 * Lo que hay que decirle al empezar el turno (sin quitarlo todavía: `confirmarEfectosNoVistos` cuando la respuesta se
 * entregue). null si no hay nada vigente.
 */
export function avisoEfectosNoVistos(dueno: string, idioma: 'es' | 'en' = 'es', ahora = Date.now()): { ids: string[]; frase: string; hecho: string } | null {
  const k = llave(dueno);
  if (!k) return null;
  const xs = (PENDIENTES.get(k) || []).filter((p) => ahora - p.t <= NO_VISTOS_VIVEN_MS);
  if (!xs.length) {
    PENDIENTES.delete(k);
    return null;
  }
  const frase = fraseEfectosNoVistos(
    xs.flatMap((p) => p.efectos),
    idioma
  );
  if (!frase) return null;
  return {
    ids: xs.map((p) => p.id),
    frase,
    hecho: `EFECTO DE ANTES (su turno anterior se cortó en el teléfono antes de que viera tu respuesta): tu respuesta YA empieza con «${frase}» (lo pone el servidor, con el recibo). No lo repitas ni lo contradigas; contesta lo de ahora.`,
  };
}

/** Ya se le dijo (la respuesta que lo llevaba se entregó): no se repite. */
export function confirmarEfectosNoVistos(dueno: string, ids: readonly string[]): void {
  const k = llave(dueno);
  if (!k || !ids.length) return;
  const xs = (PENDIENTES.get(k) || []).filter((p) => !ids.includes(p.id));
  if (xs.length) PENDIENTES.set(k, xs);
  else PENDIENTES.delete(k);
}

/** La respuesta con el aviso delante (después de la etiqueta de ánimo, si la hay). */
export function conAvisoDeAntes(texto: string, frase: string): string {
  if (!frase) return texto;
  const t = String(texto || '');
  const marca = /^\s*\[[^\]]{1,40}\]\s*/.exec(t)?.[0] || '';
  const resto = t.slice(marca.length).trim();
  return `${marca}${frase}${resto ? ` ${resto}` : ''}`;
}

/** Solo pruebas. */
export function _olvidarEfectosNoVistos() {
  PENDIENTES.clear();
}
