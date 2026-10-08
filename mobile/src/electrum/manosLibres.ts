/**
 * MANOS LIBRES EN EL CAMPO, lo que decide sin micrófono ni pantalla (se prueba en Node: tests/electrum-movil-voz.test.ts).
 *
 * El dictado de botón (dictado.ts) sigue igual: se toca, se habla, se suelta y el texto cae en la caja SIN mandarse.
 * Manos libres es otra cosa y va APAGADO por omisión (en el campo un micrófono abierto es batería y frases ajenas):
 * con él encendido el teléfono oye como AU-RA —el oído Turbo en vivo (lib/turboMotor.ts) con el pre-rollo de 0,6 s,
 * el ruido del cuarto medido solo, el fin de turno por lo que se dijo (lib/finDeTurno.ts), tres reconexiones y el
 * respaldo por WAV— y cada frase que cierra se MANDA sola. Mientras el doctor habla, el micrófono sigue abierto con la
 * cancelación de eco del teléfono: su propia voz y un «ajá» no lo cortan; un «espera» o una pregunta nueva sí
 * (lib/interrupcion.ts, lo mismo que AU-RA).
 *
 * Aquí:
 *  · `duenoMic`: un solo dueño del micrófono (el dictado de botón, manos libres o nadie): nunca dos a la vez;
 *  · `esAlucinacion` / `fraseOida`: lo que el oído entrega y no es voz de nadie (créditos de subtítulos, «música»,
 *    una sílaba repetida) no se manda; lo que empieza con el eco del doctor se limpia;
 *  · `decidirEncima` / `cortaAlPensar`: ¿lo que se oye mientras habla (o piensa) es la persona cortándolo?
 *  · `SEGUNDA_ESCUCHA_CAMPO`: qué frases se vuelven a oír con Scribe v2 (las cifras, como el dictado de botón).
 */
import { esInterrupcionReal, palabras, quitarEco, soloEcoOMuletilla } from '../lib/interrupcion';
import { limpiarFinal } from '../lib/turboLogica';

/** Dónde se guarda, en este teléfono, si manos libres va encendido. */
export const CLAVE_MANOS_LIBRES = 'electrum_manos_libres_v1';

/** Lo guardado → encendido o no. Cualquier otra cosa (nada, basura): apagado. */
export function manosLibresGuardado(v: string | null | undefined): boolean {
  return v === '1';
}

export type DuenoMic = 'dictado' | 'manos' | 'nadie';

/**
 * Quién tiene el micrófono. El dictado de botón manda (se tocó a propósito); con la cámara abierta o la app al
 * fondo, nadie; si no, manos libres si está encendido y el teléfono lo puede hacer.
 */
export function duenoMic(s: { manosLibres: boolean; posible: boolean; dictando: boolean; camara: boolean; appActiva: boolean }): DuenoMic {
  if (!s.appActiva || s.camara) return 'nadie';
  if (s.dictando) return 'dictado';
  return s.manosLibres && s.posible ? 'manos' : 'nadie';
}

/** Muletillas de quien piensa en voz alta: solas no son una pregunta. */
const RELLENO = new Set('eh em ehm mmm mm hm hmm uh uhm ah aah oh um erm este'.split(' '));

/**
 * Lo que el reconocedor «oye» en el silencio o en el viento y no es voz de nadie: créditos de subtítulos con los
 * que se entrenaron los modelos, etiquetas de sonido, una sílaba repetida, solo muletillas. La primera capa es la de
 * AU-RA (lib/turboLogica.ts `limpiarFinal`, la misma regla del servidor en lib/oido.ts); esto agrega lo que se coló
 * en el campo con el micrófono abierto.
 */
export function esAlucinacion(texto: string): boolean {
  const t = limpiarFinal(texto);
  if (!t) return true;
  if (!/[\p{L}\p{N}]/u.test(t)) return true;
  const plano = t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/amara\.org|subtitulos (realizados|por)|subtitulado por|gracias por (ver|mirar)|suscribete|dale like|thanks for watching|please subscribe/.test(plano)) return true;
  if (/^[\s([{♪♫*-]*(musica|music|aplausos|applause|risas|laughter|silencio|silence|ruido|noise|inaudible)[\s)\]}♪♫*.!-]*$/.test(plano)) return true;
  if (/[♪♫]/.test(t) && !/[a-z]{3,}/.test(plano.replace(/[♪♫]/g, ''))) return true;
  const ps = palabras(t);
  if (!ps.length) return true;
  if (ps.every((p) => RELLENO.has(p))) return true;
  // «la la la la», «no no no no no»: una misma palabra cuatro veces o más y nada más.
  if (ps.length >= 4 && new Set(ps).size === 1) return true;
  return false;
}

/**
 * La frase que entrega el oído, lista para mandar, o null si no hay nada que mandar. `eco`: lo que el doctor decía
 * cuando lo cortaron (la frase de la persona puede empezar con ese eco: se quita).
 */
export function fraseOida(texto: string, o: { eco?: readonly string[] | null } = {}): string | null {
  let t = limpiarFinal(texto);
  if (!t || esAlucinacion(t)) return null;
  if (o.eco?.length) t = quitarEco(t, o.eco);
  t = t.trim();
  return t && !esAlucinacion(t) ? t : null;
}

/** Lo que se oye MIENTRAS el doctor habla: ¿es la persona cortándolo? (su eco y un «ajá» no). */
export function decidirEncima(parcial: string, dichos: readonly string[]): 'cortar' | 'seguir' {
  return esInterrupcionReal(parcial, dichos) ? 'cortar' : 'seguir';
}

/**
 * Una frase entera que llega mientras el doctor todavía PIENSA (sin voz): ¿es una pregunta nueva que corta la de
 * antes, o un «ajá», «ok», «sí» de quien espera? Lo segundo no corta nada (ni se manda).
 */
export function cortaAlPensar(texto: string, dichos: readonly string[] = []): boolean {
  return !soloEcoOMuletilla(texto, dichos);
}

/** Montos: la moneda dicha (el resto de las palabras de dinero de AU-RA —«veta», «plata», «saldo»— aquí son geología o charla). */
const MONEDA = /\$|\b(lempira\w*|d[oó]lar\w*|usd)\b/i;

/**
 * La segunda escucha del oído en manos libres (lib/turboMotor.ts `segundaEscucha`): como el dictado de botón, las
 * frases con CIFRAS (coordenadas, números de concesión, toneladas, leyes) o montos se vuelven a oír con Scribe v2
 * antes de mandarlas. Si no se pudo corroborar, sale como la oyó Turbo, sin el aviso de dinero de AU-RA: en el campo «veta» es
 * geología y una cifra dudosa se ve en el hilo, no mueve plata.
 */
export const SEGUNDA_ESCUCHA_CAMPO = {
  confirmar: (texto: string): boolean => /\d/.test(texto) || MONEDA.test(texto),
  sinCorroborar: (texto: string): string => texto,
};
