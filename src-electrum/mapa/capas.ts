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
 * El estado de cada concesión, en cuatro grupos que se leen de un vistazo. Los valores son los del
 * catastro de INHGEOMIN tal como llegan («S-Explotar» es una solicitud de explotación).
 */
export const GRUPOS_ESTADO = [
  { clave: 'otorgada', nombre: 'Otorgada', color: AMBAR, estados: ['Otorgada', 'Explotar', 'Explorar'] },
  { clave: 'tramite', nombre: 'En trámite (solicitud)', color: '#5CC8FF', estados: ['Solicitud', 'S-Explotar', 'S-Explorar'] },
  { clave: 'delimitada', nombre: 'Delimitada', color: '#B891FF', estados: ['Delimitada'] },
  { clave: 'suspendida', nombre: 'Suspendida', color: '#FF6B6B', estados: ['Suspenso', 'Suspendida', 'Suspendido'] },
] as const;
const COLOR_OTRO = '#C9D5DB';
const ESTADOS_TRAMITE = GRUPOS_ESTADO[1].estados as readonly string[];

/** Color por estado, como expresión de MapLibre. */
export function colorEstado(): unknown[] {
  const e: unknown[] = ['match', ['coalesce', ['get', 'estado'], '']];
  for (const g of GRUPOS_ESTADO) e.push([...g.estados], g.color);
  e.push(COLOR_OTRO);
  return e;
}

/**
 * Las concesiones cargadas. Relleno muy bajo para no tapar el terreno, borde nítido para que el
 * lindero se lea —punteado si todavía es una solicitud—, color por estado, y el nombre encima solo
 * cuando hay zoom suficiente para que no se amontonen.
 */
export function capasDeConcesiones() {
  const enTramite = ['in', ['coalesce', ['get', 'estado'], ''], ['literal', ESTADOS_TRAMITE]];
  return [
    {
      id: 'concesiones-relleno',
      type: 'fill',
      source: 'concesiones',
      paint: { 'fill-color': colorEstado(), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.18, 12, 0.1] },
    },
    {
      id: 'concesiones-borde',
      type: 'line',
      source: 'concesiones',
      filter: ['!', enTramite],
      paint: {
        'line-color': colorEstado(),
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 2.2],
        'line-opacity': 0.9,
      },
    },
    {
      // MapLibre no deja que el punteado dependa de cada rasgo: las solicitudes van en su propia capa.
      id: 'concesiones-borde-tramite',
      type: 'line',
      source: 'concesiones',
      filter: enTramite,
      paint: {
        'line-color': colorEstado(),
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 2.2],
        'line-opacity': 0.95,
        'line-dasharray': [2, 1.4],
      },
    },
    {
      id: 'concesiones-nombre',
      type: 'symbol',
      source: 'concesiones',
      minzoom: 10.5,
      layout: {
        'text-field': ['get', 'nombre'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 10.5, 14, 13],
        'text-font': ['Noto Sans Medium'],
        'text-max-width': 9,
        'text-allow-overlap': false,
        'text-padding': 6,
        'text-letter-spacing': 0.02,
      },
      paint: {
        'text-color': '#FFF6E8',
        'text-halo-color': 'rgba(0,0,0,0.9)',
        'text-halo-width': 1.6,
        'text-halo-blur': 0.4,
      },
    },
  ];
}

/** Las capas del catastro que se tocan con el dedo. */
export const CAPAS_TOCABLES_CONCESION = ['concesiones-relleno', 'concesiones-borde', 'concesiones-borde-tramite'];

/**
 * Donde dos concesiones se pisan: rayado rojo encima del catastro. El rayado es una imagen chica
 * que se registra en el mapa (`rayadoTraslape`), porque MapLibre rellena con patrones, no con trazos.
 */
export function capasDeTraslapes() {
  return [
    { id: 'traslapes-rayado', type: 'fill', source: 'traslapes', paint: { 'fill-pattern': 'rayado-traslape', 'fill-opacity': 0.85 } },
    {
      id: 'traslapes-borde',
      type: 'line',
      source: 'traslapes',
      paint: { 'line-color': '#FF5A5A', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 1.4], 'line-opacity': 0.9 },
    },
  ];
}

/** 12×12 px de rayas diagonales rojas semitransparentes, para `addImage`. */
export function rayadoTraslape(): { width: number; height: number; data: Uint8Array } {
  const n = 12;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = (x + y) % n;
      if (d < 2 || d > n - 1) {
        const i = (y * n + x) * 4;
        data.set([255, 80, 80, 200], i);
      }
    }
  }
  return { width: n, height: n, data };
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
    /*
     * Halo ancho y difuso debajo del borde: la concesión nombrada se lee sobre el satélite, sobre
     * el relleno de prospectividad y sobre las anomalías del satélite (rosadas), que antes la tapaban.
     */
    {
      id: 'resaltada-halo',
      type: 'line',
      source: 'resaltada',
      paint: { 'line-color': RESALTE, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 8, 14, 16], 'line-blur': 7, 'line-opacity': 0.55 },
    },
    {
      id: 'resaltada-borde',
      type: 'line',
      source: 'resaltada',
      paint: { 'line-color': RESALTE, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.5, 14, 4], 'line-opacity': 1 },
    },
    {
      id: 'resaltada-nucleo',
      type: 'line',
      source: 'resaltada',
      paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 14, 1.4], 'line-opacity': 0.95 },
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
  departamento: { color: '#FFFFFF', relleno: 0, ancho: 2.2, nombre: 'Departamentos' },
  municipio: { color: '#E6EDF1', relleno: 0, ancho: 0.8, guiones: [3, 2], nombre: 'Municipios' },
  proyecto: { color: '#FFB020', relleno: 0.12, ancho: 1.6, guiones: [2, 1], nombre: 'Proyectos propios' },
  historico: { color: '#B8A68A', relleno: 0.06, ancho: 1.2, guiones: [4, 3], nombre: 'Histórico (JICA y otros)' },
};

/** Las tres capas de dibujo de una capa encendida: relleno, trazo y puntos. */
/** El tipo de estilo del índice de una capa encendida (original del KML, por categorías, un color). */
export type TipoEstilo = 'original' | 'categorizado' | 'unico' | 'graduado' | 'imagen';

export function capasDeExtra(fuente: string, rol: string, o: { opacidad?: number; filtro?: unknown[] | null; color?: string; estilo?: TipoEstilo | null } = {}) {
  const base0: { color: string; relleno: number; ancho: number; guiones?: number[] } = ESTILO_ROL[rol] || { color: '#FFFFFF', relleno: 0.1, ancho: 1 };
  // Con estilo del índice, cada rasgo trae su color (`_c` relleno, `_b` borde, `_o` opacidad del KML),
  // calculado en el servidor con la regla de la leyenda (catalogo.ts → colorDeRasgo).
  const porRasgo = !!o.estilo && o.estilo !== 'imagen';
  const base = porRasgo ? { ...base0, guiones: o.estilo === 'original' ? undefined : base0.guiones, relleno: o.estilo === 'categorizado' ? Math.max(base0.relleno, 0.45) : o.estilo === 'original' ? 0.35 : base0.relleno } : base0;
  const e = o.color ? { ...base, color: o.color } : base;
  const op = o.opacidad ?? 1;
  /** El filtro del índice («solo Oro») se suma al de cada capa de dibujo (polígono, trazo, punto). */
  const con = (f: unknown[]) => (o.filtro ? ['all', f, o.filtro] : f);
  const relleno = porRasgo
    ? ['coalesce', ['get', '_c'], e.color]
    : rol === 'litologia'
      ? ['match', ['get', 'clase'], ...Object.entries(COLOR_ROCA).flat(), COLOR_ROCA.otra]
      : e.color;
  const borde = porRasgo ? ['coalesce', ['get', '_b'], e.color] : rol === 'litologia' ? 'rgba(0,0,0,0.45)' : e.color;
  // El KML dice cuánto se ve su relleno (0 = solo el contorno); igual queda algo tocable.
  const opRelleno = porRasgo && o.estilo === 'original' ? ['*', op, ['max', 0.01, ['to-number', ['coalesce', ['get', '_o'], e.relleno]]]] : e.relleno * op;
  const poligono = ['==', ['geometry-type'], 'Polygon'];
  return [
    ...(e.relleno > 0
      ? [{ id: `${fuente}-relleno`, type: 'fill', source: fuente, filter: con(poligono), paint: { 'fill-color': relleno, 'fill-opacity': opRelleno } }]
      : // Sin relleno visible igual hace falta algo tocable dentro del polígono.
        [{ id: `${fuente}-relleno`, type: 'fill', source: fuente, filter: con(poligono), paint: { 'fill-color': e.color, 'fill-opacity': 0.01 } }]),
    {
      id: `${fuente}-borde`,
      type: 'line',
      source: fuente,
      filter: con(['!=', ['geometry-type'], 'Point']),
      paint: {
        'line-opacity': op,
        'line-color': borde,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, e.ancho * 0.7, 13, e.ancho * 1.8],
        ...(e.guiones ? { 'line-dasharray': e.guiones } : {}),
      },
    },
    {
      id: `${fuente}-punto`,
      type: 'circle',
      source: fuente,
      filter: con(['==', ['geometry-type'], 'Point']),
      paint: {
        'circle-opacity': op,
        'circle-stroke-opacity': op,
        'circle-color': porRasgo ? ['coalesce', ['get', '_c'], e.color] : e.color,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 13, 6],
        'circle-stroke-color': '#000000',
        'circle-stroke-width': 1,
      },
    },
    // El mapa político se lee por sus nombres: el departamento de lejos, el municipio de cerca.
    ...(rol === 'departamento' || rol === 'municipio'
      ? [
          {
            id: `${fuente}-nombre`,
            type: 'symbol',
            source: fuente,
            ...(rol === 'municipio' ? { minzoom: 9 } : { maxzoom: 10 }),
            filter: con(['!=', ['geometry-type'], 'Point']),
            layout: {
              'text-field': ['get', 'nombre'],
              'text-font': ['Noto Sans Medium'],
              'text-size': rol === 'departamento' ? ['interpolate', ['linear'], ['zoom'], 6, 11, 9, 14] : 11,
              'text-transform': rol === 'departamento' ? 'uppercase' : 'none',
              'text-letter-spacing': rol === 'departamento' ? 0.12 : 0.02,
              'text-max-width': 8,
              'text-padding': 4,
            },
            paint: { 'text-color': rol === 'departamento' ? '#F4F7F9' : '#DCE5EA', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.4 },
          },
        ]
      : []),
  ];
}
