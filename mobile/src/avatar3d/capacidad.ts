/**
 * ¿ESTE TELÉFONO AGUANTA EL 3D? La decisión, pura.
 *
 * El 3D se intenta solo si hay modelo para el avatar y este teléfono no falló antes con ESE modelo
 * (misma huella). Falla si la WebView no tiene WebGL, si el modelo no carga, si no dice «listo» a
 * tiempo, si se cae el proceso de la WebView o si no pasa de ~24 cuadros por segundo ni bajando la
 * resolución. Entonces se anota y durante dos semanas ni se intenta: la persona ve la figurita de
 * siempre sin enterarse. Un modelo nuevo (otra huella) se vuelve a probar.
 *
 * Antes de caer, la escena se abarata sola (tipos.ts, Calidad: alta → media → baja). El nivel en
 * que se quedó bien se recuerda por modelo (la misma huella), así la próxima vez arranca ahí y no
 * vuelve a pasar tres segundos a saltos; también se olvida en dos semanas.
 *
 * Sin React Native: se prueba en Node (el almacenamiento está en almacen.ts).
 */
import { CALIDADES, type Calidad } from './tipos';

export type RegistroCapacidad = Record<string, { motivo: string; en: number }>;

/** Cuánto se recuerda un fallo antes de volver a intentar (el teléfono pudo actualizar su WebView). */
export const OLVIDO_MS = 14 * 24 * 60 * 60 * 1000;

/** Por debajo de esto, ni con la resolución al mínimo, el 3D se ve a saltos: mejor la figurita. */
export const FPS_MINIMO = 24;

/** Lo que tarda de sobra un teléfono modesto en arrancar la escena y cargar el modelo. */
export const ESPERA_LISTO_MS = 15_000;

export function puede3D(reg: RegistroCapacidad | null, huella: string | null | undefined, ahora: number): boolean {
  if (!huella) return false;
  const f = reg?.[huella];
  return !f || ahora - f.en > OLVIDO_MS;
}

/** El registro con este fallo anotado (y sin los que ya se olvidaron). */
export function anotarFallo(reg: RegistroCapacidad | null, huella: string, motivo: string, ahora: number): RegistroCapacidad {
  const r: RegistroCapacidad = {};
  for (const [k, v] of Object.entries(reg || {})) if (ahora - v.en <= OLVIDO_MS) r[k] = v;
  r[huella] = { motivo: String(motivo || '').slice(0, 120), en: ahora };
  return r;
}

/**
 * Qué cuerpo se dibuja (AvatarVivo):
 *  · «2d»       → solo la figurita, sin nada alrededor (sin modelo, el teléfono no lo aguanta o está escondida);
 *  · «probando» → la figurita a la vista y la escena 3D arrancando debajo, invisible;
 *  · «3d»       → la escena dijo «listo»: el 3D a la vista.
 */
export type CuerpoVisible = '2d' | 'probando' | '3d';

export function cuerpoQueToca(o: { hayModelo: boolean; puedeProbar: boolean; activo: boolean; listo: boolean }): CuerpoVisible {
  if (!o.hayModelo || !o.puedeProbar || !o.activo) return '2d';
  return o.listo ? '3d' : 'probando';
}

/**
 * Lo que dice la escena de su rendimiento → qué hacer. Primero baja la resolución ella sola; si ya
 * está en 1× y sigue lenta, avisa `lento` y aquí se da por perdido.
 */
export function veredictoRendimiento(r: { fps: number; dpr: number; lento: boolean }): 'bien' | 'caer' {
  return r.lento || (r.dpr <= 1 && r.fps < FPS_MINIMO) ? 'caer' : 'bien';
}

/* ── la calidad que aguantó, por modelo ──────────────────────────────────────────────────── */

export type RegistroCalidad = Record<string, { calidad: Calidad; en: number }>;

/** Con qué calidad arranca este modelo en este teléfono (la que aguantó la última vez, o «alta»). */
export function calidadInicial(reg: RegistroCalidad | null, huella: string | null | undefined, ahora: number): Calidad {
  const r = huella ? reg?.[huella] : undefined;
  return r && ahora - r.en <= OLVIDO_MS && CALIDADES.includes(r.calidad) ? r.calidad : 'alta';
}

/** El registro con la calidad que aguantó este modelo (y sin lo que ya se olvidó). */
export function anotarCalidad(reg: RegistroCalidad | null, huella: string, calidad: Calidad, ahora: number): RegistroCalidad {
  const r: RegistroCalidad = {};
  for (const [k, v] of Object.entries(reg || {})) if (ahora - v.en <= OLVIDO_MS) r[k] = v;
  if (CALIDADES.includes(calidad)) r[huella] = { calidad, en: ahora };
  return r;
}
