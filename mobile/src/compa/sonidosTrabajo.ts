/**
 * LOS SONIDOS DE TRABAJO (José, 6-oct, APK 5.5.0: «cuando está escribiendo se escucha teclado, y sería bueno que si
 * está haciendo o pensando algo se escucharan cosas como eso del teclado, tanto con el avatar como en la llamada»).
 *
 * Lo puro, compartido por la llamada (compa/ambiente.ts, lo manda el servidor) y la mesa (compa/trabajoMesa.ts, por el
 * turno en curso y su progreso real):
 *  · cada sonido: su archivo (assets/sfx), su volumen BAJITO (por el canal de efectos, nunca por la voz de AU-RA: así
 *    no cuenta como «AU-RA hablando», no mueve la boca, no pausa el oído ni dispara la interrupción) y lo más que suena
 *    seguido (un bucle no se queda sonando: el murmullo de «pensando» menos que el tecleo de una búsqueda);
 *  · la variación: cada vez empieza en otro punto del archivo (los archivos son largos y sin periodo), así dos esperas
 *    seguidas no suenan igual;
 *  · si puede sonar: el ajuste «Efectos de sonido», el suyo propio («Sonidos mientras trabaja», Ajustes) y el
 *    interruptor del servidor (AURA_AMBIENTE=0, server/movil-config.ts). Los tres tienen que dejarlo.
 *
 * Sin React Native (pruebas en Node: mobile/pruebas/sonidos).
 */
import type { SonidoAmbiente } from '../nucleo/contrato';

/** Por debajo de la voz (que va a volumen completo). El murmullo, más bajo todavía: es fondo, no un aviso. */
export const VOLUMEN_SONIDO: Record<SonidoAmbiente, number> = {
  teclado: 0.16,
  papel: 0.16,
  lapiz: 0.16,
  clics: 0.14,
  pensando: 0.1,
};

/** Lo más que suena un sonido seguido sin que algo lo renueve (después calla aunque siga la tarea). */
export const MAX_SONIDO_MS: Record<SonidoAmbiente, number> = {
  teclado: 25_000,
  papel: 25_000,
  lapiz: 25_000,
  clics: 25_000,
  pensando: 12_000,
};

/** Lo que dura cada archivo (para empezar en otro punto cada vez). teclado/papel/lapiz: 4 s; los sintetizados, ~12 s. */
export const DURACION_SONIDO_MS: Record<SonidoAmbiente, number> = {
  teclado: 4_000,
  papel: 4_000,
  lapiz: 4_000,
  clics: 12_500,
  pensando: 11_900,
};

/**
 * En la mesa, desde cuándo el turno en curso «piensa» sin decir nada (ni el relleno ni la respuesta): ahí entra el
 * murmullo. Lo rápido (la charla contesta en ~1 s) no lo oye nunca (José: «si es rápido contesta sin usar esto»).
 */
export const PENSANDO_DESDE_MS = 1_600;

/** Dónde empieza esta vez (ms dentro del archivo): al azar, dejando un segundo antes del final. */
export function inicioVariado(sonido: SonidoAmbiente, azar: () => number = Math.random): number {
  const d = DURACION_SONIDO_MS[sonido] ?? 0;
  const margen = Math.max(0, d - 1_000);
  return Math.floor(Math.max(0, Math.min(0.999, azar())) * margen);
}

/** Lo que dice GET /api/movil/config de los sonidos de trabajo. Sin dato o servidor viejo: permitidos. */
export function ambienteRemotoValido(r: unknown): boolean {
  const a = r && typeof r === 'object' ? (r as { ambiente?: unknown }).ambiente : undefined;
  return !(a && typeof a === 'object' && (a as { activo?: unknown }).activo === false);
}

/** El ajuste guardado ('1' / '0'); cualquier otra cosa es «sin elegir» (encendidos). */
export function ajusteAmbienteGuardado(v: string | null | undefined): boolean | null {
  return v === '1' ? true : v === '0' ? false : null;
}

export type MotivoAmbiente = 'encendidos' | 'apagados_por_la_persona' | 'apagados_por_el_servidor' | 'sin_efectos';

/** ¿Pueden sonar? Los tres tienen que dejarlo: los efectos de la app, su ajuste y el servidor. */
export function decidirAmbiente(o: { efectos: boolean; ajuste: boolean | null; remoto: boolean }): { encendidos: boolean; motivo: MotivoAmbiente } {
  if (!o.remoto) return { encendidos: false, motivo: 'apagados_por_el_servidor' };
  if (o.ajuste === false) return { encendidos: false, motivo: 'apagados_por_la_persona' };
  if (!o.efectos) return { encendidos: false, motivo: 'sin_efectos' };
  return { encendidos: true, motivo: 'encendidos' };
}
