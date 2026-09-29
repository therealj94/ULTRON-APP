/**
 * LAS ÓRDENES DE VOZ QUE LAS REGLAS NO RECONOCEN, POR LAYA.
 *
 * El navegador reconoce al instante las formas de siempre («acércate», «siguiente»). Lo que se dice
 * de otra manera («súbeme un poquito el mapa», «ponlo de ladito», «dale una vuelta entera») llega
 * aquí y lo decide el modelo «comando» de Laya (scripts/nodo-t4/laya/modelos/comando): una sola
 * orden del grupo `accion`, o `ninguna`, que es una pregunta para el cerebro.
 *
 * Se actúa solo con seguridad: una orden equivocada mueve la pantalla sin que nadie lo pidiera, y
 * una pregunta tratada como orden se pierde. Por eso la orden tiene que ganar claro Y «ninguna» no
 * tiene que discutirle; en la duda, la frase va al cerebro, que siempre contesta algo.
 */
import { consultarModelo, type RespuestaModelo } from '../../lib/laya';

export const P_MINIMA = 0.6;
export const P_NINGUNA_MAXIMA = 0.45;
/** Más de esto no es una orden de pantalla: es una pregunta o un dictado. */
export const PALABRAS_MAX = 14;

export type Interpretacion = { id: string | null; p: number; motivo: string; ms: number };

/** Lo que se hace con una respuesta del modelo. Función pura, para las pruebas. */
export function decidirComando(r: RespuestaModelo | null): { id: string | null; p: number } {
  if (!r) return { id: null, p: 0 };
  const id = r.grupos?.accion || null;
  const p = id ? Number(r.p?.[id] ?? 0) : 0;
  const pNinguna = Number(r.p?.ninguna ?? 0);
  if (!id || id === 'ninguna') return { id: 'ninguna', p: pNinguna };
  if (p < P_MINIMA || pNinguna > P_NINGUNA_MAXIMA) return { id: 'ninguna', p };
  return { id, p };
}

export async function interpretarComando(texto: string): Promise<Interpretacion> {
  const t = String(texto || '').trim();
  if (!t) return { id: null, p: 0, motivo: 'sin texto', ms: 0 };
  if (t.split(/\s+/).length > PALABRAS_MAX) return { id: 'ninguna', p: 0, motivo: 'largo', ms: 0 };
  // Una orden de voz no espera: si Laya tarda, la frase sigue como pregunta.
  const { resultado, motivo, ms } = await consultarModelo('comando', t, { esperaMs: 900 });
  const d = decidirComando(resultado);
  return { ...d, motivo, ms };
}
