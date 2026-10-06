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
 *    puede salir movida o de perfil), luego hasta `intentosAtentos` cada `atentoMs` (el mismo ~2,5 s que la cámara
 *    de fotos da a «alguien sin nombre», seguimiento.ts RECONOCER.atentoMs) y después cada `desconocidoMs` (más
 *    seguido con «Lo que veo» abierto). José, 6-oct: «primer nombre 95376 ms después de ver la cara»; con 5 s entre
 *    tomas desde la cuarta, cada «no sé» (cara de lado, movida, lejos) costaba 5 s y hacen falta 2 votos iguales.
 *    Quien no está guardado pasa a la calma de 5 s tras ~30 s; `DiagnosticoReconocer` deja en las migas por qué no
 *    salía el nombre (sin cara en el recorte o «no sé» con qué distancia).
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
  atentoMs: 2500,
  intentosAtentos: 12,
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

/** `nVoto`: cuántos intentos llevaba cuando apareció el primer voto a favor (anotarVotos): el tope de confirmar cuenta desde ahí. */
export type IntentoPista = { ultimo: number; n: number; nVoto?: number };

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
    if (p.votos.some((v) => v.id) && n - (i?.nVoto ?? 0) < R.confirmarMax) return desde >= R.confirmarMs ? 1 : null;
    if (n < R.intentosRapidos) return desde >= R.reintentoMs ? 2 : null;
    if (n < R.intentosAtentos) return desde >= Math.min(R.atentoMs, R.desconocidoVistaMs) ? 3 : null;
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

/**
 * El tope de «confirmar enseguida» (`confirmarMax`) cuenta los intentos DESDE el primer voto a favor, no desde que
 * llegó la persona: antes, si las 4 primeras tomas salían sin cara o «no sé», el voto bueno de la 5.ª ya no tenía
 * confirmación rápida y el nombre esperaba otra toma a ritmo lento (José, 6-oct). Se llama antes de elegir.
 */
export function anotarVotos(intentos: Map<number, IntentoPista>, vivas: Pick<Pista, 'id' | 'votos'>[]) {
  for (const p of vivas) {
    const i = intentos.get(p.id);
    if (i && i.nVoto === undefined && p.votos.some((v) => v.id)) i.nVoto = Math.max(0, i.n - 1);
  }
}

/** Las pistas que ya no existen se olvidan (sin esto el mapa crecería con cada persona que pasa). */
export function podarIntentos(intentos: Map<number, IntentoPista>, vivas: Pista[]) {
  const ids = new Set(vivas.map((p) => p.id));
  for (const k of [...intentos.keys()]) if (!ids.has(k)) intentos.delete(k);
}

/** Lo que pasó con los recortes de UNA pista mientras no tuvo nombre (para la miga de «sin nombre»). */
type CuentaPista = { analizados: number; sinCara: number; noSe: number; mejorD: number; reconocidos: number; ajenos: number };

/**
 * Por qué no sale el nombre: cuántos recortes se analizaron de esa pista, en cuántos el motor no encontró la cara y
 * en cuántos dijo «no sé» y con qué distancia la más cercana (umbral caras.ts UMBRAL). Con esto la próxima miga dice
 * si era la toma (sin cara: lejos, de lado, oscuro) o el parecido (la distancia por encima del umbral).
 */
export class DiagnosticoReconocer {
  private cuentas = new Map<number, CuentaPista>();

  /** `ajeno`: el recorte salió con el nombre que ya tenía OTRA cara a la vista (seguimiento.ts votar: no se le dio). */
  analizado(pista: number, r: { cara: boolean; reconocida: boolean; distancia?: number; ajeno?: boolean }) {
    const c = this.cuentas.get(pista) || { analizados: 0, sinCara: 0, noSe: 0, mejorD: Infinity, reconocidos: 0, ajenos: 0 };
    c.analizados += 1;
    if (!r.cara) c.sinCara += 1;
    else if (!r.reconocida) {
      c.noSe += 1;
      if (typeof r.distancia === 'number' && r.distancia < c.mejorD) c.mejorD = r.distancia;
    } else {
      c.reconocidos += 1;
      if (r.ajeno) c.ajenos += 1;
    }
    this.cuentas.set(pista, c);
  }

  /**
   * José, 6-oct: «9 recortes: 4 sin cara, 0 "no sé"» no decía qué pasó con los otros 5 (con nombre, pero la pista seguía
   * sin él). Ahora la miga los cuenta, y cuántos daban el nombre de OTRA cara a la vista (dos personas, el mismo nombre).
   */
  linea(pista: number, umbral: number): string {
    const c = this.cuentas.get(pista);
    if (!c) return 'ningún recorte analizado';
    const d = Number.isFinite(c.mejorD) ? ` (la más parecida a ${c.mejorD.toFixed(2)}; umbral ${umbral.toFixed(2)})` : '';
    const ajenos = c.ajenos ? ` (${c.ajenos} con el nombre de otra cara a la vista)` : '';
    return `${c.analizados} recortes: ${c.sinCara} sin cara, ${c.noSe} «no sé»${d}, ${c.reconocidos} con nombre${ajenos}`;
  }

  /** Las pistas que ya no se ven se olvidan. */
  podar(vivas: { id: number }[]) {
    const ids = new Set(vivas.map((p) => p.id));
    for (const k of [...this.cuentas.keys()]) if (!ids.has(k)) this.cuentas.delete(k);
  }
}
