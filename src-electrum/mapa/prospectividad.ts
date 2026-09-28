/**
 * Colores de la prospectividad (0–100): los mismos cortes que usa el servidor para el nivel. Sin
 * MapLibre: lo usan la tarjeta, la leyenda y el mapa.
 */
export const CORTES_PROSP = [15, 35, 55] as const;
export const COLORES_PROSP = ['#56636B', '#3B82F6', '#EAB308', '#EF4444'] as const;
export const NIVELES_PROSP = ['muy baja', 'baja', 'media', 'alta'] as const;

export const colorProsp = (p: number) => COLORES_PROSP[CORTES_PROSP.filter((c) => p >= c).length];

export function leyendaProsp(): Array<{ color: string; texto: string }> {
  return [
    { color: COLORES_PROSP[3], texto: `Alta (≥ ${CORTES_PROSP[2]})` },
    { color: COLORES_PROSP[2], texto: `Media (${CORTES_PROSP[1]}–${CORTES_PROSP[2] - 1})` },
    { color: COLORES_PROSP[1], texto: `Baja (${CORTES_PROSP[0]}–${CORTES_PROSP[1] - 1})` },
    { color: COLORES_PROSP[0], texto: `Muy baja (< ${CORTES_PROSP[0]})` },
  ];
}

/** Relleno de la concesión por puntaje; gris claro si todavía no se calculó. */
export function rellenoProsp(): unknown[] {
  return ['case', ['has', 'prosp'], ['step', ['to-number', ['get', 'prosp']], COLORES_PROSP[0], CORTES_PROSP[0], COLORES_PROSP[1], CORTES_PROSP[1], COLORES_PROSP[2], CORTES_PROSP[2], COLORES_PROSP[3]], 'rgba(160,170,176,0.35)'];
}
