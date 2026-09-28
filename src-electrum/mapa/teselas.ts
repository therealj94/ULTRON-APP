/**
 * Las teselas propias en el mapa: el mapa base vectorial y los mapas escaneados de JICA, todos en
 * archivos PMTiles que el servidor lee del cubo por tramos (server/electrum/teselas.ts).
 *
 * MapLibre no sabe leer PMTiles solo: se le registra el protocolo `pmtiles://` una vez, y cada
 * archivo se da de alta con la sesión en las cabeceras (la ruta es privada, como el resto de Dr
 * Electrum). `transformRequest` no sirve aquí: las peticiones del protocolo no pasan por él.
 */
import * as maplibregl from 'maplibre-gl';
import { FetchSource, PMTiles, Protocol } from 'pmtiles';
import { headersElectrum } from '../acceso';

let protocolo: Protocol | null = null;

/** Lee con la sesión del momento: si alguien sale y vuelve a entrar sin recargar, no queda la vieja. */
class FuenteConSesion extends FetchSource {
  getBytes(...a: Parameters<FetchSource['getBytes']>) {
    this.setHeaders(new Headers(headersElectrum()));
    return super.getBytes(...a);
  }
}

/** El origen de la página: MapLibre exige URL absolutas para glifos, íconos y fuentes de teselas. */
export const ORIGEN = typeof window !== 'undefined' ? window.location.origin : '';

/** `pmtiles://…` de un archivo de teselas del servidor, dándolo de alta la primera vez. */
export function urlTeselas(nombre: string): string {
  const url = `${ORIGEN}/api/electrum/teselas/${nombre}.pmtiles`;
  if (!protocolo) {
    protocolo = new Protocol();
    maplibregl.addProtocol('pmtiles', protocolo.tile);
  }
  if (!protocolo.get(url)) protocolo.add(new PMTiles(new FuenteConSesion(url)));
  return `pmtiles://${url}`;
}

/** Glifos (letras) e íconos del mapa base, servidos por la propia aplicación (public/mapa-base). */
export const GLIFOS = `${ORIGEN}/mapa-base/fuentes/{fontstack}/{range}.pbf`;
export const ICONOS = `${ORIGEN}/mapa-base/sprites/dark`;
