/**
 * CÓMO TERMINÓ LA APP LAS VECES ANTERIORES, SEGÚN ANDROID (modules/aura-camara `salidas()`, ApplicationExitInfo).
 *
 * José, 6-oct: «se traba… y hasta tocar la pantalla se cierra». En los logs no había `crash-previo`: un cierre así no
 * es un error de JS, y la marca de «viva» de lib/reporte.ts no distingue un «no responde» (ANR) de un cierre por
 * memoria o de un crash nativo. Android sí lo sabe: al arrancar se leen sus últimas salidas y las que no se contaron
 * todavía van a las migas («salida previa: anr hace 3 min, en primer plano · Input dispatching timed out…»).
 *
 * Puro (sin React Native): lo prueba tests/latencia-movil.test.ts.
 */

export type Salida = { motivo: string; ts: number; descripcion?: string; importancia?: number; rssKb?: number };

/** Los motivos que dicen que algo anduvo mal (no «la persona la cerró» ni «se actualizó»). */
const PROBLEMAS = /^(anr|crash|crash-nativo|memoria|exceso-de-recursos|congelada|senal|fallo-al-iniciar|otro|desconocido-\d+)$/;

/** La primera vez (sin nada contado) solo se cuentan las de este rato: la de hoy importa, la del mes pasado no. */
export const PRIMERA_VEZ_MS = 48 * 3600_000;

/**
 * Las salidas con problema que no se contaron (más nuevas que `contadoHasta`; 0 = nunca se contó nada), la más nueva
 * primero, como mucho `max`. `hasta`: lo que hay que guardar como contado (la más nueva vista, con problema o sin él).
 */
export function salidasNuevas(lista: Salida[], contadoHasta: number, ahora: number, max = 3): { nuevas: Salida[]; hasta: number } {
  const validas = lista.filter((s) => s && typeof s.ts === 'number' && s.ts > 0).sort((a, b) => b.ts - a.ts);
  const desde = contadoHasta > 0 ? contadoHasta : ahora - PRIMERA_VEZ_MS;
  const nuevas = validas.filter((s) => s.ts > desde && PROBLEMAS.test(s.motivo)).slice(0, max);
  const hasta = Math.max(contadoHasta, validas[0]?.ts ?? 0);
  return { nuevas, hasta };
}

/** «salida previa: anr hace 12 min, en primer plano, 410 MB · Input dispatching timed out…» */
export function lineaSalida(s: Salida, ahora: number): string {
  const min = Math.max(0, Math.round((ahora - s.ts) / 60_000));
  const hace = min < 1 ? 'hace menos de un minuto' : min < 120 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`;
  // ActivityManager.RunningAppProcessInfo: 100 primer plano, 125 servicio en primer plano, 200/230 visible, ≥ 300 detrás.
  const plano = typeof s.importancia === 'number' ? (s.importancia <= 125 ? ', en primer plano' : s.importancia <= 230 ? ', visible' : ', en segundo plano') : '';
  const mem = typeof s.rssKb === 'number' && s.rssKb > 0 ? `, ${Math.round(s.rssKb / 1024)} MB` : '';
  const desc = s.descripcion ? ` · ${String(s.descripcion).replace(/\s+/g, ' ').slice(0, 120)}` : '';
  return `salida previa: ${s.motivo} ${hace}${plano}${mem}${desc}`;
}
