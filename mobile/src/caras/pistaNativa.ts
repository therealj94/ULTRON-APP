/**
 * RECONOCER CON LA CÁMARA EN VIVO: a quién mirar y cuándo (lo puro; pruebas/camara/nativa.prueba.mjs).
 *
 * Con la cámara de fotos, cada foto era una incógnita: había que volver a mirar seguido para que el nombre
 * no se perdiera. Con la cámara en vivo cada persona trae su `trackingId` (ML Kit, estable mientras se la
 * ve): la identidad se queda pegada a ESA pista mientras viva, y basta con mirar una vez por persona nueva.
 *
 *  · Persona nueva (sin votos): se la mira YA (un recorte de ~290 px de ese cuadro → el motor de caras, unos
 *    150-400 ms).
 *  · Un voto a favor y falta otro para confirmar (2 de 3, seguimiento.ts): otra vez enseguida, apenas
 *    termine el análisis anterior. Así el nombre sale tras dos análisis (~0,4-0,8 s) en vez de segundos.
 *  · «No sé quién es» (sin voto a favor): hasta `intentosRapidos` veces cada `reintentoMs` (la primera toma
 *    puede salir movida o de perfil), luego cada `desconocidoMs` (más seguido con «Lo que veo» abierto).
 *  · Ya confirmada: un repaso cada `confirmadaMs`, o cada `dudosaMs` si ganó por poco (distancia cerca del
 *    umbral). Un repaso «no sé» no le quita el nombre (seguimiento.ts decidirIdentidad).
 *  · Caras muy chicas (menos de `minPx` de alto en el cuadro) se esperan: el recorte saldría borroso.
 *  · De a una: el motor analiza un recorte a la vez (`ocupado`).
 */
import { UMBRAL } from './caras';
import type { Pista } from './seguimiento';

export const RECONOCER_VIVO = {
  /** Con un voto a favor, el siguiente recorte sale apenas pasa esto desde el anterior (y el motor está libre). */
  confirmarMs: 150,
  confirmarMax: 5,
  reintentoMs: 700,
  intentosRapidos: 3,
  desconocidoMs: 5000,
  desconocidoVistaMs: 2500,
  confirmadaMs: 12_000,
  dudosaMs: 5000,
  /** Distancia por encima de la cual una identidad confirmada se repasa más seguido. */
  dudosaDistancia: UMBRAL - 0.08,
  /** Alto mínimo de la cara en el cuadro nativo (px) para recortarla. */
  minPx: 36,
  /** Sin respuesta del motor en este tiempo, se da por perdido el pedido y se puede volver a pedir. */
  esperaMaxMs: 4000,
};

export type IntentoPista = { ultimo: number; n: number };

/** ¿Por qué toca mirar esta pista? (menor = antes) o null si no toca todavía. */
export function prioridadPista(p: Pick<Pista, 'votos' | 'identidad'>, i: IntentoPista | undefined, ahora: number, vistaAbierta: boolean): number | null {
  const ultimo = i?.ultimo ?? 0;
  const n = i?.n ?? 0;
  const desde = ahora - ultimo;
  const R = RECONOCER_VIVO;
  if (!p.identidad) {
    if (!p.votos.length && n === 0) return 0;
    // Un voto a favor: confirmar enseguida (con tope: si el motor no encuentra la cara en el recorte no hay
    // voto, y no se le puede pedir sin fin; pasado el tope, al ritmo de «no sé quién es»).
    if (p.votos.some((v) => v.id) && n < R.confirmarMax) return desde >= R.confirmarMs ? 1 : null;
    if (n < R.intentosRapidos) return desde >= R.reintentoMs ? 2 : null;
    return desde >= (vistaAbierta ? R.desconocidoVistaMs : R.desconocidoMs) ? 3 : null;
  }
  const cada = p.identidad.distancia > R.dudosaDistancia ? R.dudosaMs : R.confirmadaMs;
  return desde >= cada ? 4 : null;
}

/**
 * La pista a mirar ahora (su `id` en el Seguidor), o null. `alto(p)`: alto de su cara en px del cuadro.
 * Entre las que tocan: la de menor prioridad; a igualdad, la cara más grande.
 */
export function elegirPistaParaReconocer(
  pistas: Pista[],
  intentos: Map<number, IntentoPista>,
  ahora: number,
  o: { ocupado: boolean; reconoce: boolean; vistaAbierta: boolean; alto: (p: Pista) => number }
): Pista | null {
  if (o.ocupado || !o.reconoce) return null;
  let mejor: { p: Pista; pr: number; h: number } | null = null;
  for (const p of pistas) {
    const h = o.alto(p);
    if (!(h >= RECONOCER_VIVO.minPx)) continue;
    const pr = prioridadPista(p, intentos.get(p.id), ahora, o.vistaAbierta);
    if (pr === null) continue;
    if (!mejor || pr < mejor.pr || (pr === mejor.pr && h > mejor.h)) mejor = { p, pr, h };
  }
  return mejor?.p ?? null;
}

/** Las pistas que ya no existen se olvidan (sin esto el mapa crecería con cada persona que pasa). */
export function podarIntentos(intentos: Map<number, IntentoPista>, vivas: Pista[]) {
  const ids = new Set(vivas.map((p) => p.id));
  for (const k of [...intentos.keys()]) if (!ids.has(k)) intentos.delete(k);
}
