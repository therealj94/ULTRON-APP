/**
 * Los dos fondos del mapa. Va aparte de `capas.ts` a propósito: `capas.ts` lo importa también el
 * control de capas, que vive en el paquete de entrada, y esto trae MapLibre y los estilos de
 * Protomaps, que solo tienen que bajar cuando se abre el mapa.
 *
 *  - **Satélite**: Esri World Imagery, como siempre.
 *  - **Calles**: el mapa base vectorial PROPIO — Protomaps (datos de OpenStreetMap) de Honduras,
 *    servido desde el cubo. Antes eran las teselas raster de openstreetmap.org, que contestaban 403
 *    a esta aplicación: el fondo «calles» quedaba negro.
 *
 * Los dos llevan glifos propios: sin ellos, los nombres de las concesiones (una capa de texto) no se
 * dibujaban en ningún fondo.
 */
import { layers, namedFlavor } from '@protomaps/basemaps';
import { GLIFOS, ICONOS, urlTeselas } from './teselas';

const ATRIB_ESRI = 'Imagen: Esri, Maxar, Earthstar Geographics';
const ATRIB_OSM = '<a href="https://protomaps.com">Protomaps</a> · © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';

export function estiloSatelite(): any {
  return {
    version: 8,
    glyphs: GLIFOS,
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
}

export function estiloCalles(): any {
  return {
    version: 8,
    glyphs: GLIFOS,
    sprite: ICONOS,
    sources: {
      protomaps: {
        type: 'vector',
        url: urlTeselas('honduras'),
        attribution: ATRIB_OSM,
      },
    },
    // Oscuro, como el resto de la pantalla, y con los nombres en español donde OpenStreetMap los tiene.
    layers: layers('protomaps', namedFlavor('dark'), { lang: 'es' }),
  };
}
