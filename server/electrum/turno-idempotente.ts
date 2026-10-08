/**
 * UNA PREGUNTA, UN TURNO — también en Dr Electrum (server/turno-unico.ts, el mismo cerrojo durable de AU-RA).
 *
 * La app reintenta un turno que se corta (el stream se cae en el campo → otra vez, o → el JSON). Sin esto, cada
 * reintento corría el turno entero otra vez: el panel, el catastro, el informe, el hilo con la pregunta repetida. Ahora
 * el cliente manda `idTurno` (el mismo en sus reintentos) y aquí se recuerda por QUIÉN pregunta (la persona o su
 * visitante opaco, nunca algo del cuerpo) + ese id:
 *   · si el turno sigue en curso, el reintento lo espera y recibe la misma respuesta;
 *   · si ya terminó, recibe la misma respuesta (`repetido: true`), sin volver a pensar;
 *   · si terminó sin respuesta (se fue quien preguntaba, se cayó), el reintento corre uno nuevo.
 * Las claves van en su propio espacio (`electrum:<quién>|<id>`): no chocan con las de AU-RA aunque coincidan el id y
 * el correo.
 */
import { claveTurno, type TurnoGuardado } from '../turno-unico';

/** La clave del turno, o null si no vino un id válido (cliente viejo: se corre como siempre). */
export function claveTurnoElectrum(quien: string | null | undefined, idTurno: unknown): string | null {
  const q = String(quien || '').trim();
  return q ? claveTurno(`electrum:${q}`, idTurno) : null;
}

/** Lo que se guarda de un turno de Electrum: lo que va en el JSON y en el `fin` del stream. */
export type RespuestaGuardable = {
  texto: string;
  voz?: string;
  emocion: string;
  fin: string;
  traza?: Array<{ herramienta: string }>;
  trazaId?: string;
  ui?: Array<Record<string, unknown>>;
  [k: string]: unknown;
};

/**
 * Las órdenes del mapa traen geometrías (una concesión, una capa entera): si pesan demasiado, no se guardan para el
 * reintento (el registro durable no es un depósito de mapas). El reintento repite el texto y la traza; el mapa ya se
 * movió la primera vez.
 */
export const MAX_UI_GUARDADA = 256 * 1024;

export function guardadoDeElectrum(r: RespuestaGuardable): TurnoGuardado {
  const { ui, ...resto } = r;
  const uiCabe = Array.isArray(ui) && JSON.stringify(ui).length <= MAX_UI_GUARDADA ? ui : undefined;
  return {
    reply: r.texto,
    voz: r.voz ?? r.texto,
    emocion: String(r.emocion || 'neutral'),
    via: `electrum:${r.fin}`,
    herramientas: (r.traza || []).map((t) => String(t.herramienta)),
    ...(r.trazaId ? { trazaId: r.trazaId } : {}),
    electrum: { ...resto, ...(uiCabe ? { ui: uiCabe } : {}) },
  };
}

/** La respuesta de Electrum de un turno guardado (si fuera de otro espacio, lo mínimo que se puede decir). */
export function electrumDeGuardado(g: TurnoGuardado): RespuestaGuardable {
  const e = g.electrum;
  if (e && typeof e === 'object' && typeof (e as any).texto === 'string') return e as RespuestaGuardable;
  return { texto: g.reply, voz: g.voz, emocion: g.emocion, fin: g.via, traza: [], ui: [] };
}

/** Una frase que salió por el stream (server/electrum/voz-frases.ts): se guarda para repetir las mismas. */
export type FraseGuardada = { i: number; texto: string; voz: string };
/** Tope de frases guardadas con un turno (una respuesta normal tiene decenas, no cientos). */
export const MAX_FRASES_GUARDADAS = 200;

/**
 * Las frases que salieron en vivo con este turno (`frasesDichas`, en orden y con su número), o null si no se guardaron
 * (turno de antes, del JSON, de la mesa) o no tienen forma: entonces el reintento las vuelve a cortar del texto.
 */
export function frasesGuardadas(g: RespuestaGuardable): FraseGuardada[] | null {
  const xs = g.frasesDichas;
  if (!Array.isArray(xs) || !xs.length || xs.length > MAX_FRASES_GUARDADAS) return null;
  const out: FraseGuardada[] = [];
  for (const [k, x] of xs.entries()) {
    const f = x as Partial<FraseGuardada> | null;
    if (!f || f.i !== k || typeof f.texto !== 'string' || typeof f.voz !== 'string') return null;
    out.push({ i: f.i, texto: f.texto, voz: f.voz });
  }
  return out;
}

/** Lo que se le dice a un reintento cuando el mismo turno sigue corriendo en otra petición y no terminó a tiempo. */
export function fraseEnCurso(idioma: unknown): string {
  return String(idioma || '').toLowerCase().startsWith('en')
    ? "I'm still working on that same question; give me a moment and ask again."
    : 'Todavía estoy con esa misma pregunta; dame un momento y volvé a pedírmela.';
}

/** Lo corría un proceso que se cayó después de dejar algo hecho: no se repite a ciegas. */
export function fraseDesconocido(idioma: unknown): string {
  return String(idioma || '').toLowerCase().startsWith('en')
    ? "That question was interrupted while I was working on it and I can't tell if it finished. Check the screen before asking again."
    : 'Esa pregunta se cortó mientras la trabajaba y no sé si llegó a terminar. Revisá la pantalla antes de pedírmela otra vez.';
}
