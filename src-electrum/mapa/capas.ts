/**
 * Estilos de las capas del mapa. Los fondos (satélite y calles) viven en `estilos.ts`, que trae
 * MapLibre y Protomaps: este archivo lo importa también el control de capas, que va en el paquete
 * de entrada.
 *
 * **Relleno tenue, borde firme.** Una concesión no es un botón: lo que importa es dónde está su
 * lindero. Un relleno opaco tapa el terreno, que es justo lo que la gente quiere ver debajo.
 */

/** Acento del Cerebro de Minas: ámbar de mineral. Se lee sobre satélite y sobre calles. */
export const AMBAR = '#FFAE3B';
/** Lo resaltado cuando Dr Electrum nombra una concesión. */
export const RESALTE = '#FFD98A';

/**
 * Las concesiones cargadas. Relleno muy bajo para no tapar el terreno, borde nítido para que el
 * lindero se lea, y el nombre encima solo cuando hay zoom suficiente para que no se amontonen.
 */
export function capasDeConcesiones() {
  return [
    {
      id: 'concesiones-relleno',
      type: 'fill',
      source: 'concesiones',
      paint: { 'fill-color': AMBAR, 'fill-opacity': 0.12 },
    },
    {
      id: 'concesiones-borde',
      type: 'line',
      source: 'concesiones',
      paint: {
        'line-color': AMBAR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 2.2],
        'line-opacity': 0.9,
      },
    },
    {
      id: 'concesiones-nombre',
      type: 'symbol',
      source: 'concesiones',
      minzoom: 11,
      layout: {
        'text-field': ['get', 'nombre'],
        'text-size': 12,
        'text-font': ['Noto Sans Regular'],
        'text-allow-overlap': false,
        'text-padding': 6,
      },
      paint: {
        'text-color': '#FFF3DF',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 1.4,
      },
    },
  ];
}

/** La que Dr Electrum está nombrando ahora mismo: más clara, más gruesa, imposible de perder. */
export function capasDeResaltado() {
  return [
    {
      id: 'resaltada-relleno',
      type: 'fill',
      source: 'resaltada',
      paint: { 'fill-color': RESALTE, 'fill-opacity': 0.22 },
    },
    {
      id: 'resaltada-borde',
      type: 'line',
      source: 'resaltada',
      paint: { 'line-color': RESALTE, 'line-width': 3, 'line-opacity': 1 },
    },
  ];
}

/**
 * La concesión tocada: borde blanco grueso encima de todo, para que se vea cuál es la de la
 * tarjeta. Se filtra por id sobre la misma fuente del catastro, sin pedir su geometría otra vez.
 */
export function capasDeSeleccion() {
  return [
    {
      id: 'concesiones-sel',
      type: 'line',
      source: 'concesiones',
      filter: ['==', ['to-number', ['get', 'id']], -1],
      paint: { 'line-color': '#FFFFFF', 'line-width': 3.2, 'line-opacity': 0.95 },
    },
    {
      id: 'concesiones-hover',
      type: 'fill',
      source: 'concesiones',
      filter: ['==', ['to-number', ['get', 'id']], -1],
      paint: { 'fill-color': AMBAR, 'fill-opacity': 0.28 },
    },
  ];
}

/* ------------------------------------------------------------------ capas que se encienden */

/** Colores por clase de roca, los de siempre en un mapa geológico: rojo intrusivo, amarillo sedimento… */
export const COLOR_ROCA: Record<string, string> = {
  intrusiva: '#E4572E',
  volcanica: '#F29E4C',
  sedimentaria: '#E9D18B',
  metamorfica: '#9B7EDE',
  ultramafica: '#3FA34D',
  aluvial: '#D9D4C7',
  otra: '#8FA3B0',
};
export const NOMBRE_ROCA: Record<string, string> = {
  intrusiva: 'Intrusiva',
  volcanica: 'Volcánica',
  sedimentaria: 'Sedimentaria',
  metamorfica: 'Metamórfica',
  ultramafica: 'Ultramáfica',
  aluvial: 'Aluvial',
  otra: 'Otra',
};

/** Color y trazo de cada tipo de capa. */
export const ESTILO_ROL: Record<string, { color: string; relleno: number; ancho: number; guiones?: number[]; nombre: string }> = {
  litologia: { color: '#E9D18B', relleno: 0.38, ancho: 0.5, nombre: 'Geología (roca)' },
  falla: { color: '#FF4D4D', relleno: 0, ancho: 1.8, nombre: 'Fallas' },
  placa: { color: '#FF2E93', relleno: 0, ancho: 2.6, guiones: [3, 2], nombre: 'Límites de placa' },
  tracto_permisivo: { color: '#7CFFB2', relleno: 0.07, ancho: 1.6, guiones: [2, 1.5], nombre: 'Tractos permisivos' },
  ocurrencia: { color: '#FFE066', relleno: 0, ancho: 1, nombre: 'Yacimientos y ocurrencias' },
  area_protegida: { color: '#2ECC71', relleno: 0.2, ancho: 1.4, nombre: 'Áreas protegidas' },
  microcuenca: { color: '#4DA3FF', relleno: 0.16, ancho: 1.2, nombre: 'Microcuencas' },
  zona_informal: { color: '#FF7A00', relleno: 0.25, ancho: 1.4, nombre: 'Minería informal' },
  forestal: { color: '#1B9E5A', relleno: 0.16, ancho: 1, nombre: 'Patrimonio forestal' },
  provincia_geologica: { color: '#C9A0FF', relleno: 0, ancho: 1.4, guiones: [4, 2], nombre: 'Provincias geológicas' },
  municipio: { color: '#FFFFFF', relleno: 0, ancho: 0.8, nombre: 'Municipios' },
};

/** Las tres capas de dibujo de una capa encendida: relleno, trazo y puntos. */
export function capasDeExtra(fuente: string, rol: string) {
  const e: { color: string; relleno: number; ancho: number; guiones?: number[] } = ESTILO_ROL[rol] || { color: '#FFFFFF', relleno: 0.1, ancho: 1 };
  const relleno =
    rol === 'litologia'
      ? ['match', ['get', 'clase'], ...Object.entries(COLOR_ROCA).flat(), COLOR_ROCA.otra]
      : e.color;
  const poligono = ['==', ['geometry-type'], 'Polygon'];
  return [
    ...(e.relleno > 0
      ? [{ id: `${fuente}-relleno`, type: 'fill', source: fuente, filter: poligono, paint: { 'fill-color': relleno, 'fill-opacity': e.relleno } }]
      : // Sin relleno visible igual hace falta algo tocable dentro del polígono.
        [{ id: `${fuente}-relleno`, type: 'fill', source: fuente, filter: poligono, paint: { 'fill-color': e.color, 'fill-opacity': 0.01 } }]),
    {
      id: `${fuente}-borde`,
      type: 'line',
      source: fuente,
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: {
        'line-color': rol === 'litologia' ? 'rgba(0,0,0,0.45)' : e.color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, e.ancho * 0.7, 13, e.ancho * 1.8],
        ...(e.guiones ? { 'line-dasharray': e.guiones } : {}),
      },
    },
    {
      id: `${fuente}-punto`,
      type: 'circle',
      source: fuente,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': e.color,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 13, 6],
        'circle-stroke-color': '#000000',
        'circle-stroke-width': 1,
      },
    },
  ];
}
