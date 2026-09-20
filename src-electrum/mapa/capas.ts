/**
 * Estilos del mapa y de las capas de concesiones.
 *
 * Dos decisiones que importan:
 *
 *  - **Teselas de fuentes abiertas.** Satélite de Esri y calles de OpenStreetMap: sin clave, sin
 *    facturación y sin que un contador corra mientras alguien mira el mapa. La atribución va puesta
 *    donde toca, que no es un detalle legal menor sino la condición de uso.
 *  - **Relleno tenue, borde firme.** Una concesión no es un botón: lo que importa es dónde está su
 *    lindero. Un relleno opaco tapa el terreno, que es justo lo que la gente quiere ver debajo.
 */

const ATRIB_ESRI = 'Imagen: Esri, Maxar, Earthstar Geographics';
const ATRIB_OSM = '© OpenStreetMap';

/** Acento del Cerebro de Minas: ámbar de mineral. Se lee sobre satélite y sobre calles. */
export const AMBAR = '#FFAE3B';
/** Lo resaltado cuando Dr Electrum nombra una concesión. */
export const RESALTE = '#FFD98A';

export const ESTILO_SATELITE: any = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: ATRIB_ESRI,
    },
  },
  layers: [
    { id: 'fondo', type: 'background', paint: { 'background-color': '#0B0D0F' } },
    { id: 'esri', type: 'raster', source: 'esri' },
  ],
};

export const ESTILO_CALLES: any = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: ATRIB_OSM,
    },
  },
  layers: [
    { id: 'fondo', type: 'background', paint: { 'background-color': '#0B0D0F' } },
    { id: 'osm', type: 'raster', source: 'osm' },
  ],
};

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
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
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
