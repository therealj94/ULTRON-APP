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

/**
 * Pone las fuentes y las capas si no están, y no hace nada si ya están.
 *
 * Antes se añadían una sola vez, al evento `load`. Bastaba que el estilo se recargara después
 * —cambiar de fondo, un estilo que termina de llegar tarde— para que se las llevara por delante, y
 * a partir de ahí `setData` escribía en una fuente que ya no existía: sin error, sin aviso, y con
 * el catastro entero invisible. El mapa respondía al encuadre, así que parecía que funcionaba.
 *
 * Llamarla es barato y se puede hacer siempre: antes de pintar, al cargar y cada vez que el estilo
 * cambia. Una operación idempotente elimina la clase entera de fallo en vez de tapar un caso.
 */
/**
 * Lo último que se mandó pintar. Vive fuera del ciclo de React a propósito.
 *
 * MapLibre borra fuentes y capas cuando recarga el estilo, y aquí el estilo se recarga solo: al
 * cambiar de fondo, y también cuando las teselas del satélite fallan y la librería reintenta. Si
 * los datos solo viven dentro del mapa, cada una de esas recargas los tira y el catastro
 * desaparece sin un solo error: `setData` sigue existiendo, `getLayer` sigue encontrando la capa, y
 * la pantalla se queda en blanco con mil polígonos cargados.
 *
 * Guardarlos aparte y reponerlos al recrear convierte eso en un no-problema, en vez de perseguir
 * cuál de los caminos fue el que borró.
 */
const pintado: { concesiones: unknown; resaltada: unknown } = { concesiones: null, resaltada: null };

/** Pone fuentes y capas si faltan, y les devuelve los datos que tenían. Idempotente y barata. */
function asegurarCapas(m: maplibregl.Map) {
  for (const [nombre, capas] of [
    ['concesiones', capasDeConcesiones()],
    ['resaltada', capasDeResaltado()],
  ] as const) {
    if (!m.getSource(nombre)) {
      /*
       * Si hubo que rehacer la fuente, hay que rehacer TAMBIÉN sus capas: una capa se ata al objeto
       * fuente que existía cuando se añadió, y si la fuente se recrea, la capa sigue en el estilo
       * —`getLayer` la encuentra, parece sana— pero apunta a la vieja y no dibuja nada.
       */
      for (const c of capas) if (m.getLayer((c as any).id)) m.removeLayer((c as any).id);
      m.addSource(nombre, {
        type: 'geojson',
        data: (pintado[nombre] as any) || { type: 'FeatureCollection', features: [] },
      });
    }
    for (const c of capas) if (!m.getLayer((c as any).id)) m.addLayer(c as any);
  }
}

/** Pinta y recuerda: lo que se recuerda es lo que se repone si el estilo se recarga. */
function pintar(m: maplibregl.Map, cual: 'concesiones' | 'resaltada', datos: unknown) {
  pintado[cual] = datos;
  asegurarCapas(m);
  (m.getSource(cual) as any)?.setData(datos);
}

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
    // A la derecha, no a la izquierda: abajo a la izquierda vive la cara cuando cede el paso, y la
    // escala le asomaba por detrás como un recorte de papel blanco.
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    m.on('load', () => {
      // Las fuentes nacen vacías: el contenido llega cuando una herramienta lo manda.
      asegurarCapas(m);
      // Cada vez que el estilo cambia, no solo la primera: las teselas que fallan lo recargan solas.
      m.on('styledata', () => asegurarCapas(m));
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
    m.once('styledata', () => asegurarCapas(m));
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
        pintar(m, 'resaltada', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: o.geojson, properties: {} }] });
        if (o.encuadre) m.fitBounds(o.encuadre, { padding: 80, duration: 1400, maxZoom: 15 });
        else if (o.centro) m.flyTo({ center: o.centro, zoom: 13, duration: 1400 });
      } else if (o.accion === 'capa') {
        pintar(m, 'concesiones', o.geojson);
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

/**
 * El mapa tal como se está viendo, en JPEG, para meterlo en el informe.
 *
 * El servidor no puede hacer esta captura: el encuadre, el zoom y las capas encendidas son de quien
 * está mirando, no del servidor. Por eso el lienzo se crea con `preserveDrawingBuffer` — sin eso,
 * WebGL descarta el búfer tras pintar y `toDataURL` devuelve un rectángulo negro. Esa bandera
 * existía ya «por si acaso»; este es el caso.
 *
 * JPEG y no PNG porque el PDF incrusta los datos de un JPEG tal cual, sin recodificar nada.
 */
export function capturaDelMapa(): string | null {
  const m = (window as any).__mapa;
  const lienzo: HTMLCanvasElement | undefined = m?.getCanvas?.();
  if (!lienzo || !lienzo.width || !lienzo.height) return null;
  try {
    // Repintar antes de leer: si el último cuadro es viejo, se captura lo que ya no se ve.
    m.triggerRepaint?.();
    const url = lienzo.toDataURL('image/jpeg', 0.82);
    return url.startsWith('data:image/jpeg') && url.length > 2000 ? url : null;
  } catch {
    return null;
  }
}
