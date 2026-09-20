/**
 * EL MAPA DE ELECTRUM — dos motores con interruptor.
 *
 * **MapLibre** es el de trabajo: teselas vectoriales, aguanta miles de polígonos sin arrastrarse,
 * y las capas se estilan de verdad. Es lo que usa el software catastral serio.
 * **Google** es el de presentar: el satélite que todo el mundo reconoce. Solo se carga si hay clave,
 * y si no la hay el interruptor lo dice en vez de quedarse muerto.
 *
 * Lo importante no es que haya mapa, es que **el mapa se mueve solo cuando Dr Electrum habla**. Las
 * herramientas devuelven geometría y encuadre en `ui`, y esto vuela hacia ahí. El modelo nunca
 * escribe una coordenada: pide «mostrame Cerro Partido» y la concesión aparece resaltada.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapaLibre } from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';
import { ESTILO_SATELITE, ESTILO_CALLES, capasDeConcesiones, capasDeResaltado } from './capas';

export type Motor = 'maplibre' | 'google';
export type Fondo = 'satelite' | 'calles';

export type OrdenMapa =
  | { accion: 'volar'; geojson: Geometry; encuadre?: [number, number, number, number]; centro?: [number, number] }
  | { accion: 'capa'; geojson: FeatureCollection; encuadre?: [number, number, number, number] }
  | { accion: 'punto'; punto: [number, number] };

type Props = {
  /** La última orden que dio una herramienta. Cambiarla mueve el mapa. */
  orden?: OrdenMapa | null;
  motor: Motor;
  fondo: Fondo;
  /** Clave de Google Maps; sin ella el motor de Google no se puede encender. */
  claveGoogle?: string;
  onMotor?: (m: Motor) => void;
};

/** Honduras entera, que es donde se abre si nadie ha pedido nada todavía. */
const HONDURAS: [number, number, number, number] = [-89.4, 12.9, -83.1, 16.6];

export function Mapa({ orden, motor, fondo, claveGoogle }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLibre | null>(null);
  const [listo, setListo] = useState(false);
  const cajaGoogle = useRef<HTMLDivElement>(null);
  const google = useRef<any>(null);
  const [falloGoogle, setFalloGoogle] = useState<string | null>(null);

  /* ---------------------------------------------------------------- MapLibre */

  useEffect(() => {
    if (motor !== 'maplibre' || !caja.current || mapa.current) return;
    const m = new maplibregl.Map({
      container: caja.current,
      style: fondo === 'satelite' ? ESTILO_SATELITE : ESTILO_CALLES,
      bounds: HONDURAS,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
      /*
       * Conservar el búfer de dibujo. Sin esto, el lienzo de WebGL se vacía tras cada cuadro y
       * NO aparece en una captura: el mapa se ve perfecto en pantalla y sale negro en la foto.
       * Además es lo que permitirá meter el mapa en un informe PDF, que es a donde vamos.
       */
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.on('load', () => {
      // Las fuentes nacen vacías: el contenido llega cuando una herramienta lo manda.
      m.addSource('concesiones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('resaltada', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      for (const c of capasDeConcesiones()) m.addLayer(c as any);
      for (const c of capasDeResaltado()) m.addLayer(c as any);
      setListo(true);
    });
    mapa.current = m;
    // Asa para las capturas de QA (scripts/qa/electrum.mjs). No lo usa la aplicación.
    (window as any).__mapa = m;

    /*
     * MapLibre mide su contenedor UNA vez, al construirse, y después solo escucha a la ventana. Aquí
     * el contenedor cambia sin que la ventana se mueva —aparece el panel lateral, el escenario pasa
     * de la cara al trabajo— y el mapa se quedaba con el tamaño de arranque: lienzo de 300 px de
     * alto sobre una caja de 548, o sea negro. Hay que avisarle cuando la caja cambia.
     */
    const observador = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.resize()) : null;
    if (observador && caja.current) observador.observe(caja.current);

    return () => {
      observador?.disconnect();
      m.remove();
      mapa.current = null;
      setListo(false);
    };
  }, [motor, fondo]);

  /*
   * Cambiar de fondo conserva las capas: se vuelven a poner cuando el estilo termina de cargar.
   * Se salta la primera vez: el mapa ya nació con el estilo correcto, y volver a ponerlo nada más
   * cargar tira las fuentes recién creadas y deja el lienzo en negro.
   */
  const fondoPuesto = useRef<Fondo | null>(null);
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    if (fondoPuesto.current === null) {
      fondoPuesto.current = fondo;
      return;
    }
    if (fondoPuesto.current === fondo) return;
    fondoPuesto.current = fondo;
    const datos = {
      concesiones: (m.getSource('concesiones') as any)?._data,
      resaltada: (m.getSource('resaltada') as any)?._data,
    };
    m.once('styledata', () => {
      if (m.getSource('concesiones')) return;
      m.addSource('concesiones', { type: 'geojson', data: datos.concesiones || { type: 'FeatureCollection', features: [] } });
      m.addSource('resaltada', { type: 'geojson', data: datos.resaltada || { type: 'FeatureCollection', features: [] } });
      for (const c of capasDeConcesiones()) m.addLayer(c as any);
      for (const c of capasDeResaltado()) m.addLayer(c as any);
    });
    m.setStyle(fondo === 'satelite' ? ESTILO_SATELITE : ESTILO_CALLES);
  }, [fondo, listo]);

  /* ---------------------------------------------------------------- Google */

  useEffect(() => {
    if (motor !== 'google') return;
    if (!claveGoogle) {
      setFalloGoogle('Falta la clave de Google Maps. Ponela en GOOGLE_MAPS_API_KEY y volvé a desplegar.');
      return;
    }
    setFalloGoogle(null);
    const yaEsta = (window as any).google?.maps;
    const arrancar = () => {
      if (!cajaGoogle.current) return;
      google.current = new (window as any).google.maps.Map(cajaGoogle.current, {
        center: { lat: 14.75, lng: -86.25 },
        zoom: 7,
        mapTypeId: fondo === 'satelite' ? 'hybrid' : 'roadmap',
        streetViewControl: true,
        fullscreenControl: false,
      });
    };
    if (yaEsta) return arrancar();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(claveGoogle)}&libraries=geometry&language=es&region=HN`;
    s.async = true;
    s.onload = arrancar;
    s.onerror = () => setFalloGoogle('Google Maps no cargó. Revisá que la clave esté habilitada y con facturación activa.');
    document.head.appendChild(s);
  }, [motor, claveGoogle, fondo]);

  useEffect(() => {
    if (motor === 'google' && google.current) {
      google.current.setMapTypeId(fondo === 'satelite' ? 'hybrid' : 'roadmap');
    }
  }, [fondo, motor]);

  /* ---------------------------------------------------------------- órdenes */

  const obedecer = useCallback((o: OrdenMapa) => {
    const m = mapa.current;
    if (m && listo) {
      if (o.accion === 'volar') {
        (m.getSource('resaltada') as any)?.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: o.geojson, properties: {} }],
        });
        if (o.encuadre) m.fitBounds(o.encuadre, { padding: 80, duration: 1400, maxZoom: 15 });
        else if (o.centro) m.flyTo({ center: o.centro, zoom: 13, duration: 1400 });
      } else if (o.accion === 'capa') {
        (m.getSource('concesiones') as any)?.setData(o.geojson);
        if (o.encuadre) m.fitBounds(o.encuadre, { padding: 60, duration: 1400 });
      } else if (o.accion === 'punto') {
        m.flyTo({ center: o.punto, zoom: 14, duration: 1200 });
      }
    }
    const g = google.current;
    if (g && motor === 'google') {
      const G = (window as any).google.maps;
      if (o.accion === 'volar' && o.encuadre) {
        g.fitBounds(new G.LatLngBounds({ lat: o.encuadre[1], lng: o.encuadre[0] }, { lat: o.encuadre[3], lng: o.encuadre[2] }));
      } else if (o.accion === 'punto') {
        g.setCenter({ lat: o.punto[1], lng: o.punto[0] });
        g.setZoom(14);
      }
    }
  }, [listo, motor]);

  useEffect(() => {
    if (orden) obedecer(orden);
  }, [orden, obedecer]);

  return (
    <div className="absolute inset-0 bg-[#0B0D0F]">
      {/*
        Posición y tamaño EN LÍNEA, no por clase.
        MapLibre le pone al contenedor su clase `.maplibregl-map`, que trae `position: relative`, y
        como su hoja de estilos se carga después de la nuestra le gana al `absolute` de Tailwind:
        la caja pierde la posición absoluta, `inset-0` deja de significar nada y la altura colapsa a
        cero. El mapa se dibujaba —teselas cargadas, píxeles pintados— dentro de una caja de 0 px de
        alto con recorte, o sea invisible. Un estilo en línea gana siempre y cierra el asunto.
      */}
      <div ref={caja} style={{ position: 'absolute', inset: 0, display: motor === 'maplibre' ? 'block' : 'none' }} />
      <div ref={cajaGoogle} style={{ position: 'absolute', inset: 0, display: motor === 'google' ? 'block' : 'none' }} />
      {motor === 'google' && falloGoogle && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center">
          <p className="max-w-sm text-sm text-[#8FA3B0] leading-relaxed">{falloGoogle}</p>
        </div>
      )}
    </div>
  );
}
