/**
 * Cómo se pintan las muestras geoquímicas de JICA: un punto por muestra, coloreado por la ley del
 * elemento elegido, en clases fijas (no cuantiles: un color quiere decir lo mismo en todo el país).
 *
 * No importa MapLibre: lo usan también el control de capas (la leyenda) y la tarjeta, que viven en
 * el paquete de entrada.
 */
export const ELEMENTOS_MUESTRA = ['au', 'ag', 'cu', 'pb', 'zn', 'as', 'sb', 'hg', 'mo'] as const;
export type ElementoMuestra = (typeof ELEMENTOS_MUESTRA)[number];

export const NOMBRE_ELEMENTO: Record<ElementoMuestra, string> = {
  au: 'Oro (Au)',
  ag: 'Plata (Ag)',
  cu: 'Cobre (Cu)',
  pb: 'Plomo (Pb)',
  zn: 'Zinc (Zn)',
  as: 'Arsénico (As)',
  sb: 'Antimonio (Sb)',
  hg: 'Mercurio (Hg)',
  mo: 'Molibdeno (Mo)',
};

export const UNIDAD_ELEMENTO: Record<ElementoMuestra, string> = { au: 'ppb', ag: 'ppm', cu: 'ppm', pb: 'ppm', zn: 'ppm', as: 'ppm', sb: 'ppm', hg: 'ppm', mo: 'ppm' };

/** Cortes de cada clase: de fondo regional a anomalía fuerte. */
export const CORTES: Record<ElementoMuestra, [number, number, number, number, number]> = {
  au: [5, 20, 100, 500, 1000],
  ag: [0.5, 1, 5, 20, 100],
  cu: [50, 100, 300, 1000, 5000],
  pb: [30, 100, 300, 1000, 5000],
  zn: [100, 200, 500, 1000, 5000],
  as: [10, 50, 200, 1000, 5000],
  sb: [2, 5, 20, 100, 500],
  hg: [1, 2, 5, 10, 50],
  mo: [2, 5, 10, 50, 200],
};

/** Bajo el primer corte (o bajo el límite de detección), y luego las cinco clases. */
export const COLORES_MUESTRA = ['#5E6A72', '#3B82F6', '#22C55E', '#EAB308', '#F97316', '#EF4444'] as const;

/** Los renglones de la leyenda: color y rango. */
export function leyendaMuestras(e: ElementoMuestra): Array<{ color: string; texto: string }> {
  const c = CORTES[e];
  const u = UNIDAD_ELEMENTO[e];
  return [
    { color: COLORES_MUESTRA[0], texto: `< ${c[0]} ${u}` },
    ...c.map((v, i) => ({ color: COLORES_MUESTRA[i + 1], texto: i + 1 < c.length ? `${v} – ${c[i + 1]} ${u}` : `≥ ${v} ${u}` })),
  ];
}

/** El color del punto: una expresión `step` sobre la ley del elemento. */
export function colorMuestra(e: ElementoMuestra): unknown[] {
  const c = CORTES[e];
  return ['step', ['to-number', ['get', e]], COLORES_MUESTRA[0], c[0], COLORES_MUESTRA[1], c[1], COLORES_MUESTRA[2], c[2], COLORES_MUESTRA[3], c[3], COLORES_MUESTRA[4], c[4], COLORES_MUESTRA[5]];
}

/** Más grande cuanto más ley, y con el zoom: una anomalía se ve desde lejos, el fondo no estorba. */
export function radioMuestra(e: ElementoMuestra): unknown[] {
  const c = CORTES[e];
  const porLey = (k: number) => ['step', ['to-number', ['get', e]], 2 * k, c[1], 3 * k, c[2], 4 * k, c[3], 5.5 * k];
  return ['interpolate', ['linear'], ['zoom'], 6, porLey(1), 12, porLey(1.8)];
}
