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
import { duracion, sinMovimiento } from '../movimiento';
import { esMapaVivo, fijarMapaVivo, type CapaExtra, type Fondo, type Margen, type Motor, type OrdenMapa, type RasterEncendido, type RasterEscaneado, type Tocado } from './captura';
import { AMBAR, RESALTE, ESTILO_ROL, COLOR_ROCA, CAPAS_TOCABLES_CONCESION, colorEstado, capasDeConcesiones, capasDeExtra, capasDeResaltado, capasDeSeleccion, capasDeTraslapes, rayadoTraslape } from './capas';
import { estiloCalles, estiloSatelite } from './estilos';
import { urlTeselas } from './teselas';
import { colorMuestra, pesoMuestra, radioMuestra, type ElementoMuestra } from './muestras';
import { rellenoProsp } from './prospectividad';
import mlcontour from 'maplibre-contour';
import { Herramientas, herramientaEnUso } from './herramientas';
import urlDelWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

/*
 * EL WORKER DE MAPLIBRE, DECLARADO.
 *
 * MapLibre 6 busca su worker en un archivo aparte, `maplibre-gl-worker.mjs`, al lado de su propio
 * módulo. Empaquetado por Vite ese «al lado» es `/assets/maplibre-gl-worker.mjs`, que la
 * compilación nunca emitía: el servidor contestaba con la página HTML, el worker moría en silencio
 * y toda fuente GeoJSON quedaba sin procesar. El satélite se veía —las teselas raster no pasan por
 * el worker— y encima de él no se dibujaba NADA: ni las 1079 concesiones, ni la resaltada, ni el
 * encuadre. Sin un solo error en consola. Importarlo con `?worker&url` hace que Vite lo compile y
 * lo emita, y `setWorkerUrl` le dice a MapLibre dónde quedó.
 */
maplibregl.setWorkerUrl(urlDelWorker);

export type { Fondo, Motor, OrdenMapa } from './captura';

type Props = {
  /** La última orden que dio una herramienta. Cambiarla mueve el mapa. */
  orden?: OrdenMapa | null;
  motor: Motor;
  fondo: Fondo;
  /** Clave de Google Maps; sin ella el motor de Google no se puede encender. */
  claveGoogle?: string;
  onMotor?: (m: Motor) => void;
  /** Capas encendidas encima del catastro (geología, fallas, áreas protegidas…). */
  extras?: CapaExtra[];
  /** La concesión de la tarjeta abierta: se marca con borde blanco. */
  seleccion?: number | null;
  /** Tocar el mapa: una concesión, un rasgo de una capa encendida o un punto. */
  onTocar?: (t: Tocado) => void;
  /** Terreno en 3D: relieve real, sombreado y cielo, con la cámara inclinada. */
  tresD?: boolean;
  /** Mapas escaneados encendidos (JICA…), con su transparencia. Van debajo de todo lo vectorial. */
  rasters?: RasterEncendido[];
  /** Muestras geoquímicas de JICA y el elemento que las colorea; null las apaga. */
  muestras?: { elemento: ElementoMuestra; geojson: unknown } | null;
  /** Zonas donde dos concesiones se pisan, para rayarlas. */
  traslapes?: unknown | null;
  /** Curvas de nivel (y sombreado suave en «calles»). */
  curvas?: boolean;
  /** Relleno de las concesiones por puntaje de prospectividad en vez de por estado. */
  prospectividad?: boolean;
  /** ¿Se está viendo? El mapa se monta detrás de la cara: la entrada se hace cuando aparece. */
  visible?: boolean;
  /**
   * El visor: un recuadro con esquinas y el nombre de lo que se está mostrando, pegado al terreno
   * (sigue la cámara). Lo usa el recorrido para que se sepa exactamente qué mirar.
   */
  enfoque?: { encuadre: [number, number, number, number]; etiqueta?: string } | null;
  /** Dónde está quien usa la app (lon, lat), si dio permiso de ubicación: un punto azul que respira. */
  yo?: [number, number] | null;
};

/** Honduras entera, que es donde se abre si nadie ha pedido nada todavía. */
const HONDURAS: [number, number, number, number] = [-89.4, 12.9, -83.1, 16.6];

/**
 * LA ENTRADA: la primera vez de la sesión, la Tierra en globo sobre Centroamérica y el descenso
 * hasta Honduras. Después, la proyección de siempre (las medidas y los planos son en Mercator/UTM).
 * Si alguien pidió menos movimiento, o ya la vio en esta pestaña, se abre directo en Honduras.
 *
 * El mapa NACE en el globo (se decide al crearlo) y baja cuando se deja ver: si esperara al
 * evento `load` —que espera las teselas— se vería Honduras un instante y después el salto al espacio.
 */
let introPendiente = false;
/** Hasta cuándo dura la entrada: el encuadre del catastro que llega en medio no la corta. */
let introHasta = 0;
const introEnCurso = () => introPendiente || Date.now() < introHasta;

function quiereIntro(): boolean {
  try {
    return !sinMovimiento() && !sessionStorage.getItem('electrum:intro');
  } catch {
    return false;
  }
}

function prepararGlobo(m: maplibregl.Map) {
  try {
    /*
     * Globo de lejos y plano de cerca, en UNA sola proyección que se interpola con el zoom. Antes
     * se cambiaba a Mercator al terminar el descenso, y si algo lo interrumpía (el recorrido, un
     * toque) el cambio llegaba a mitad de vuelo: MapLibre recargaba todas las teselas y el mapa
     * entero parpadeaba. Desde zoom 7 ya es Mercator puro.
     */
    m.setProjection({ type: ['interpolate', ['linear'], ['zoom'], 5, 'vertical-perspective', 7, 'mercator'] } as any);
    // El halo de la atmósfera alrededor del globo; se apaga solo al acercarse (zoom 7).
    m.setSky({ 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] } as any);
  } catch {
    introPendiente = false;
  }
}

function introDesdeElEspacio(m: maplibregl.Map) {
  if (!introPendiente) return;
  introPendiente = false;
  try {
    sessionStorage.setItem('electrum:intro', '1');
  } catch {
    /* sin almacenamiento: la volverá a ver la próxima vez, nada más */
  }
  introHasta = Date.now() + 300 + duracion(4800) + 400;
  setTimeout(() => {
    // Si algo más mueve el mapa antes (una orden de Dr Electrum, un toque), el descenso se corta y
    // no pasa nada raro: la proyección ya es plana en cuanto hay zoom.
    m.fitBounds(HONDURAS, { padding: 40, duration: duracion(4800), curve: 1.5, essential: true });
  }, 300);
}

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
/** Las capas encendidas, por el mismo motivo: si el estilo se recarga, se reponen desde aquí. */
const pintadoExtra = new Map<string, { rol: string; geojson: unknown }>();
const fuenteExtra = (id: number) => `extra-${id}`;
/** Los mapas escaneados encendidos, clave → transparencia. Fuera de React por lo mismo que `pintado`. */
const pintadoRaster = new Map<string, { opacidad: number; zoomMax?: number; vector?: RasterEscaneado['vector'] }>();
const fuenteRaster = (clave: string) => `raster-${clave}`;
/** Las muestras geoquímicas encendidas: el elemento que colorea y sus puntos. Fuera de React por lo mismo. */
let pintadoMuestras: { elemento: ElementoMuestra; geojson: unknown } | null = null;
/** Las capas de dibujo tocables de las capas encendidas, para saber qué se tocó. */
const capasTocablesExtra = () => [...pintadoExtra.keys()].flatMap((f) => [`${f}-punto`, `${f}-borde`, `${f}-relleno`]);

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
  // La tocada y la de bajo el dedo: encima del catastro, debajo del resaltado de Dr Electrum.
  for (const c of capasDeSeleccion()) if (!m.getLayer(c.id)) m.addLayer(c as any, m.getLayer('resaltada-relleno') ? 'resaltada-relleno' : undefined);
  // Concesiones con algo que atender: por vencer (≤ 90 días) o con pérdida de vegetación fuerte.
  if (!m.getLayer('concesiones-alerta') && m.getSource('concesiones')) {
    m.addLayer(
      {
        id: 'concesiones-alerta',
        type: 'line',
        source: 'concesiones',
        filter: filtroAlerta(),
        paint: {
          'line-color': ['case', ['>=', ['coalesce', ['get', 'perdida_ha'], 0], 5], '#FF4FD8', '#FF7A45'],
          'line-width': 3,
          'line-blur': 2,
          'line-opacity': 0.7,
        },
      } as any,
      m.getLayer('concesiones-sel') ? 'concesiones-sel' : undefined
    );
  }
  // Los traslapes, rayados encima del catastro y debajo de la concesión tocada.
  if (pintadoTraslapes) {
    if (!m.hasImage('rayado-traslape')) m.addImage('rayado-traslape', rayadoTraslape());
    if (!m.getSource('traslapes')) {
      for (const c of capasDeTraslapes()) if (m.getLayer(c.id)) m.removeLayer(c.id);
      m.addSource('traslapes', { type: 'geojson', data: pintadoTraslapes as any });
    }
    for (const c of capasDeTraslapes()) if (!m.getLayer(c.id)) m.addLayer(c as any, m.getLayer('concesiones-sel') ? 'concesiones-sel' : undefined);
  }
  aplicarCurvas(m);
  aplicarRelleno(m);
  // Las capas encendidas van DEBAJO del catastro: la concesión se sigue leyendo encima de la roca.
  for (const [fuente, { rol, geojson }] of pintadoExtra) {
    if (!m.getSource(fuente)) {
      for (const c of capasDeExtra(fuente, rol)) if (m.getLayer(c.id)) m.removeLayer(c.id);
      m.addSource(fuente, { type: 'geojson', data: geojson as any });
    }
    for (const c of capasDeExtra(fuente, rol)) if (!m.getLayer(c.id)) m.addLayer(c as any, 'concesiones-relleno');
  }
  /*
   * Los mapas escaneados, DEBAJO de todo lo vectorial: un mapa geológico de 1980 es papel, y encima
   * tienen que seguir leyéndose las capas encendidas y el catastro de hoy.
   */
  for (const [clave, { opacidad, zoomMax, vector }] of pintadoRaster) {
    const f = fuenteRaster(clave);
    if (vector) {
      pintarVectorIndice(m, f, clave, vector, opacidad, zoomMax);
      continue;
    }
    if (!m.getSource(f)) {
      if (m.getLayer(f)) m.removeLayer(f);
      m.addSource(f, { type: 'raster', url: urlTeselas(clave), tileSize: 256, ...(zoomMax ? { maxzoom: zoomMax } : {}) } as any);
    }
    if (!m.getLayer(f)) {
      const primeraVectorial = m.getStyle().layers.find((l) => l.id.startsWith('extra-') || l.id === 'sombreado' || l.id === 'concesiones-relleno');
      m.addLayer({ id: f, type: 'raster', source: f, paint: { 'raster-opacity': opacidad, 'raster-fade-duration': 150 } } as any, primeraVectorial?.id);
    } else {
      m.setPaintProperty(f, 'raster-opacity', opacidad);
      if (m.getLayoutProperty(f, 'visibility') === 'none') m.setLayoutProperty(f, 'visibility', 'visible');
    }
  }
  // Las muestras, ENCIMA de todo: son puntos chicos, y un punto debajo de un polígono no se toca.
  if (pintadoMuestras) {
    const { elemento, geojson } = pintadoMuestras;
    if (!m.getSource('muestras')) {
      for (const id of ['muestras-punto', 'muestras-calor']) if (m.getLayer(id)) m.removeLayer(id);
      m.addSource('muestras', { type: 'geojson', data: geojson as any });
    }
    /*
     * De lejos, un mapa de calor pesado por la ley (dónde se juntan las anomalías); al acercarse se
     * desvanece y quedan los puntos, que son los que se tocan.
     */
    if (!m.getLayer('muestras-calor')) {
      m.addLayer({
        id: 'muestras-calor',
        type: 'heatmap',
        source: 'muestras',
        maxzoom: 11,
        paint: {
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 6, 10, 10, 26],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.85, 10.5, 0],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, 'rgba(59,130,246,0.45)', 0.45, 'rgba(34,197,94,0.6)', 0.65, 'rgba(234,179,8,0.75)', 0.85, 'rgba(249,115,22,0.85)', 1, 'rgba(239,68,68,0.95)'],
        },
      } as any);
    }
    if (!m.getLayer('muestras-punto')) {
      m.addLayer({
        id: 'muestras-punto',
        type: 'circle',
        source: 'muestras',
        minzoom: 7.5,
        paint: {
          'circle-stroke-color': '#0B0D0F',
          'circle-stroke-width': 0.8,
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0, 9, 0.92],
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0, 9, 1],
        },
      } as any);
    }
    m.setFilter('muestras-calor', ['has', elemento]);
    m.setPaintProperty('muestras-calor', 'heatmap-weight', pesoMuestra(elemento) as any);
    // Solo las que midieron ese elemento, y las de más ley dibujadas encima.
    m.setFilter('muestras-punto', ['has', elemento]);
    m.setLayoutProperty('muestras-punto', 'circle-sort-key', ['to-number', ['get', elemento]]);
    m.setPaintProperty('muestras-punto', 'circle-color', colorMuestra(elemento) as any);
    m.setPaintProperty('muestras-punto', 'circle-radius', radioMuestra(elemento) as any);
  }
  aplicarTerreno(m);
}

/** Apaga las muestras. */
function quitarMuestras(m: maplibregl.Map) {
  for (const id of ['muestras-punto', 'muestras-calor']) if (m.getLayer(id)) m.removeLayer(id);
  if (m.getSource('muestras')) m.removeSource('muestras');
}

/**
 * Una capa de LÍNEAS del índice de teselas (las curvas de nivel oficiales): finas y del color de la
 * entrada, las maestras más gruesas, y la cota rotulada sobre la línea cuando hay zoom para leerla.
 * Van con los mapas escaneados, debajo del catastro: son el terreno, no una capa más.
 */
function pintarVectorIndice(
  m: maplibregl.Map,
  f: string,
  clave: string,
  v: NonNullable<RasterEscaneado['vector']>,
  opacidad: number,
  zoomMax?: number
) {
  const color = v.color || '#E8C38A';
  const maestra = v.maestra ? ['==', ['to-number', ['get', v.maestra], 0], 1] : false;
  if (!m.getSource(f)) {
    for (const id of [f, `${f}-cota`]) if (m.getLayer(id)) m.removeLayer(id);
    m.addSource(f, { type: 'vector', url: urlTeselas(clave), ...(zoomMax ? { maxzoom: zoomMax } : {}) } as any);
  }
  const debajo = m.getStyle().layers.find((l) => l.id.startsWith('extra-') || l.id === 'concesiones-relleno')?.id;
  const punto = v.tipo === 'punto';
  if (!m.getLayer(f)) {
    m.addLayer(
      punto
        ? ({
            // Puntos (caseríos): chicos de lejos, que no tapen el catastro; más grandes de cerca.
            id: f,
            type: 'circle',
            source: f,
            'source-layer': v.capa,
            ...(v.desde != null ? { minzoom: v.desde } : {}),
            paint: {
              'circle-color': color,
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 12, 2.6, 15, 4.5],
              'circle-stroke-color': 'rgba(0,0,0,0.6)',
              'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0, 13, 0.8],
              'circle-opacity': opacidad,
            },
          } as any)
        : ({
            id: f,
            type: 'line',
            source: f,
            'source-layer': v.capa,
            ...(v.desde != null ? { minzoom: v.desde } : {}),
            paint: {
              'line-color': color,
              'line-width': ['case', maestra, ['interpolate', ['linear'], ['zoom'], 10, 0.9, 15, 1.8], ['interpolate', ['linear'], ['zoom'], 6, 0.3, 12, 0.6, 15, 1.1]],
              'line-opacity': opacidad,
            },
          } as any),
      debajo
    );
  } else {
    m.setPaintProperty(f, punto ? 'circle-opacity' : 'line-opacity', opacidad);
    if (m.getLayoutProperty(f, 'visibility') === 'none') m.setLayoutProperty(f, 'visibility', 'visible');
  }
  if (v.etiqueta) {
    const id = `${f}-cota`;
    if (!m.getLayer(id)) {
      m.addLayer(
        {
          id,
          type: 'symbol',
          source: f,
          'source-layer': v.capa,
          // De cerca todas; antes, solo las maestras, para que no se amontonen los números.
          minzoom: 12,
          filter: maestra ? ['any', ['>=', ['zoom'], 14], maestra] : true,
          layout: {
            'symbol-placement': punto ? 'point' : 'line',
            'text-field': punto ? ['to-string', ['get', v.etiqueta]] : ['concat', ['to-string', ['get', v.etiqueta]], ' m'],
            ...(punto ? { 'text-offset': [0, 0.9], 'text-anchor': 'top' } : {}),
            'text-size': 10,
            'text-font': ['Noto Sans Medium'],
            'symbol-spacing': 320,
          },
          paint: { 'text-color': color, 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.2, 'text-opacity': opacidad },
        } as any,
        debajo
      );
    } else {
      m.setPaintProperty(id, 'text-opacity', opacidad);
      if (m.getLayoutProperty(id, 'visibility') === 'none') m.setLayoutProperty(id, 'visibility', 'visible');
    }
  }
}

/**
 * Esconde un mapa escaneado que se apagó, sin borrarlo: volver a encenderlo (el recorrido los va
 * alternando) no descarga todo de nuevo ni deja el terreno pelado mientras llega. Borrar y crear la
 * fuente en cada cambio era otro parpadeo.
 */
function quitarRaster(m: maplibregl.Map, clave: string) {
  const f = fuenteRaster(clave);
  for (const id of [f, `${f}-cota`]) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none');
}

/*
 * EL TERRENO EN 3D.
 *
 * Relieve de los mosaicos abiertos de elevación de AWS (Terrarium, sin clave), exagerado un poco
 * para que la sierra de Honduras se lea, con sombreado y cielo. Se pone y se quita sin tocar el
 * catastro, y se repone si el estilo se recarga (cambiar de fondo): `terreno3D` vive fuera de React
 * por lo mismo que `pintado`.
 */
let terreno3D = false;
/** Cuántas órdenes de cámara llevan dadas: una órbita en espera sabe si ya la reemplazó otra. */
let ordenesDadas = 0;

/**
 * El margen de la orden, puesto en el mapa antes de moverse: MapLibre encuadra y centra dentro de
 * lo que queda libre (fitBounds lo suma a su propio relleno, flyTo y easeTo lo conservan). Poner el
 * margen es un salto, así que se hace solo si cambió y justo antes de empezar un movimiento nuevo.
 */
/**
 * El margen en píxeles, achicado si no cabe: con «más chat» el mapa queda de doscientos píxeles de
 * alto y un margen pensado para la pantalla entera lo dejaba sin sitio. MapLibre calculaba la
 * cámara con un área negativa, daba NaN y tumbaba el mapa entero («No pude cargar el mapa»).
 */
function rellenoDe(margen: Margen | undefined, m?: maplibregl.Map, extra = 0) {
  if (!margen) return undefined;
  let r = { top: Math.max(0, margen.arriba), bottom: Math.max(0, margen.abajo), left: Math.max(0, margen.izquierda), right: Math.max(0, margen.derecha) };
  const cont = m?.getContainer();
  if (cont) {
    const libreV = cont.clientHeight - 2 * extra - 40;
    const libreH = cont.clientWidth - 2 * extra - 40;
    const kv = r.top + r.bottom > libreV ? Math.max(0, libreV) / Math.max(1, r.top + r.bottom) : 1;
    const kh = r.left + r.right > libreH ? Math.max(0, libreH) / Math.max(1, r.left + r.right) : 1;
    r = { top: r.top * kv, bottom: r.bottom * kv, left: r.left * kh, right: r.right * kh };
  }
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
}

/**
 * El margen va DENTRO del movimiento (flyTo/easeTo lo animan junto con la cámara). Antes se ponía
 * con `setPadding`, que es un salto instantáneo y además corta el movimiento en curso: cada capítulo
 * del recorrido empezaba con un tirón. Para encuadrar algo con el margen nuevo se calcula la cámara
 * como si ya estuviera puesto (sin dibujar nada) y se vuela hasta ahí con el margen animado.
 */
function camaraConMargen(
  m: maplibregl.Map,
  encuadre: [number, number, number, number],
  margen: Margen | undefined,
  opts: { relleno: number; maxZoom?: number; giro?: number }
): { center: maplibregl.LngLat; zoom: number } | null {
  const tr = (m as any).transform;
  const cont = m.getContainer();
  // El relleno propio tampoco puede comerse el mapa entero.
  const relleno = Math.max(0, Math.min(opts.relleno, (Math.min(cont.clientWidth, cont.clientHeight) - 60) / 2));
  const nuevo = rellenoDe(margen, m, relleno);
  const antes = { ...m.getPadding() };
  try {
    if (nuevo && typeof tr?.setPadding === 'function') tr.setPadding(nuevo);
    const cam = m.cameraForBounds(encuadre, { padding: relleno, maxZoom: opts.maxZoom, bearing: opts.giro ?? m.getBearing() });
    if (!cam?.center || cam.zoom === undefined || !Number.isFinite(cam.zoom)) return null;
    const c = maplibregl.LngLat.convert(cam.center as maplibregl.LngLatLike);
    return Number.isFinite(c.lng) && Number.isFinite(c.lat) ? { center: c, zoom: cam.zoom } : null;
  } catch {
    // Un mapa sin sitio (plegado, a medio redimensionar): no se encuadra, pero tampoco se cae.
    return null;
  } finally {
    if (nuevo && typeof tr?.setPadding === 'function') tr.setPadding(antes);
  }
}

/** Por vencer en 90 días (fechas ISO se comparan como texto) o con ≥ 5 ha de pérdida fuerte de vegetación. */
function filtroAlerta(): unknown[] {
  const hoy = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const limite = new Date(hoy.getTime() + 90 * 86_400_000);
  return [
    'any',
    ['all', ['has', 'vence'], ['>=', ['get', 'vence'], iso(hoy)], ['<=', ['get', 'vence'], iso(limite)]],
    ['>=', ['coalesce', ['get', 'perdida_ha'], 0], 5],
  ];
}
/** Relieve sombreado y curvas de nivel en el mapa plano; el fondo del momento decide cuánto sombreado. */
const relieve = { curvas: true, fondo: 'satelite' as Fondo };
/** Los traslapes con su geometría, para rayarlos. Fuera de React por lo mismo que `pintado`. */
let pintadoTraslapes: unknown = null;
const TESELAS_RELIEVE = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];

/**
 * Las curvas de nivel se calculan EN EL NAVEGADOR a partir del mismo modelo de elevación del 3D
 * (Terrarium, abierto): `maplibre-contour` registra un protocolo que convierte cada tesela de
 * elevación en líneas vectoriales, en un worker para no trabar el mapa. Nada que servir ni pagar.
 */
let dem: any = null;
function fuenteCurvas(): string {
  if (!dem) {
    dem = new (mlcontour as any).DemSource({ url: TESELAS_RELIEVE[0], encoding: 'terrarium', maxzoom: 12, worker: true, cacheSize: 80, timeoutMs: 15_000 });
    dem.setupMaplibre(maplibregl);
  }
  // Metros: [menor, maestra] por zoom.
  // Espaciadas para que el terreno se lea sin tapar el mapa: la maestra cada 5 menores.
  return dem.contourProtocolUrl({ thresholds: { 10: [200, 1000], 11: [100, 500], 12: [50, 250], 13: [20, 100], 14: [10, 50] }, contourLayer: 'curvas', elevationKey: 'cota', levelKey: 'nivel' });
}

/** Relleno de las concesiones: por estado (lo normal) o por prospectividad, más opaco para que se lea. */
let rellenoPorProsp = false;
function aplicarRelleno(m: maplibregl.Map) {
  if (!m.getLayer('concesiones-relleno')) return;
  m.setPaintProperty('concesiones-relleno', 'fill-color', (rellenoPorProsp ? rellenoProsp() : colorEstado()) as any);
  m.setPaintProperty('concesiones-relleno', 'fill-opacity', (rellenoPorProsp ? ['interpolate', ['linear'], ['zoom'], 6, 0.55, 12, 0.35] : ['interpolate', ['linear'], ['zoom'], 6, 0.18, 12, 0.1]) as any);
}

function aplicarCurvas(m: maplibregl.Map) {
  const ids = ['curvas-linea', 'curvas-cota'];
  if (!relieve.curvas) {
    for (const id of ids) if (m.getLayer(id)) m.removeLayer(id);
    if (m.getSource('curvas')) m.removeSource('curvas');
    return;
  }
  if (!m.getSource('curvas')) {
    for (const id of ids) if (m.getLayer(id)) m.removeLayer(id);
    m.addSource('curvas', { type: 'vector', tiles: [fuenteCurvas()], minzoom: 10, maxzoom: 14 } as any);
  }
  const sobreSatelite = relieve.fondo === 'satelite';
  // Debajo de todo lo vectorial del catastro: las curvas son el terreno, no una capa más.
  // (Se mira el orden solo si hay que añadir algo: `getStyle()` copia el estilo entero.)
  const faltan = !m.getLayer('curvas-linea') || !m.getLayer('curvas-cota');
  const antes = faltan ? m.getStyle().layers.find((l) => l.id.startsWith('extra-') || l.id === 'concesiones-relleno')?.id : undefined;
  if (!m.getLayer('curvas-linea')) {
    m.addLayer(
      {
        id: 'curvas-linea',
        type: 'line',
        source: 'curvas',
        'source-layer': 'curvas',
        minzoom: 10,
        paint: {
          'line-color': sobreSatelite ? 'rgba(255,238,210,0.55)' : 'rgba(255,226,180,0.30)',
          'line-width': ['match', ['get', 'nivel'], 1, 1.1, 0.5],
          'line-opacity': ['match', ['get', 'nivel'], 1, 1, 0.55],
        },
      } as any,
      antes
    );
  }
  if (!m.getLayer('curvas-cota')) {
    m.addLayer(
      {
        id: 'curvas-cota',
        type: 'symbol',
        source: 'curvas',
        'source-layer': 'curvas',
        minzoom: 12,
        filter: ['>', ['get', 'nivel'], 0],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['concat', ['number-format', ['get', 'cota'], {}], ' m'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-padding': 20,
        },
        paint: { 'text-color': 'rgba(255,236,205,0.85)', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.2 },
      } as any,
      antes
    );
  }
  m.setPaintProperty('curvas-linea', 'line-color', sobreSatelite ? 'rgba(255,238,210,0.55)' : 'rgba(255,226,180,0.30)');
}

/*
 * EL TERRENO: en 3D, relieve real con sombreado y cielo; en el plano, un sombreado suave sobre el
 * fondo «calles» (junto con las curvas) para que la sierra se lea sin inclinar la cámara.
 */
function aplicarTerreno(m: maplibregl.Map) {
  const sombrear = terreno3D || (relieve.curvas && relieve.fondo === 'calles');
  if (sombrear && !m.getSource('relieve-sombra')) {
    m.addSource('relieve-sombra', { type: 'raster-dem', tiles: TESELAS_RELIEVE, encoding: 'terrarium', tileSize: 256, maxzoom: 14 } as any);
  }
  if (sombrear && !m.getLayer('sombreado')) {
    const antes = m.getStyle().layers.find((l) => l.id.startsWith('raster-') || l.id.startsWith('curvas-') || l.id.startsWith('extra-') || l.id === 'concesiones-relleno')?.id;
    m.addLayer(
      {
        id: 'sombreado',
        type: 'hillshade',
        source: 'relieve-sombra',
        /*
         * Luz desde cuatro direcciones (oeste, noroeste, norte, noreste) en vez de una: con una sola
         * fuente las fallas y crestas paralelas a la luz desaparecen, y un geólogo lee lineamientos
         * justamente por esas estructuras.
         */
        paint: {
          'hillshade-method': 'multidirectional',
          'hillshade-illumination-direction': [270, 315, 0, 45],
          'hillshade-illumination-altitude': [35, 35, 35, 35],
          'hillshade-shadow-color': ['#1b1308', '#1b1308', '#1b1308', '#1b1308'],
          'hillshade-highlight-color': ['#fff4dc', '#fff4dc', '#fff4dc', '#fff4dc'],
        },
      } as any,
      antes
    );
  }
  if (sombrear) m.setPaintProperty('sombreado', 'hillshade-exaggeration', terreno3D ? 0.45 : 0.28);
  if (!sombrear) {
    if (m.getLayer('sombreado')) m.removeLayer('sombreado');
  }
  /*
   * En «calles» (sin satélite) un tinte hipsométrico suave: los valles verdes, la sierra ocre, las
   * cumbres claras. Se calcula en la tarjeta de video desde el mismo modelo de elevación y va debajo
   * del sombreado; sobre el satélite no se pone porque taparía la imagen.
   */
  const tintar = sombrear && relieve.fondo === 'calles';
  if (tintar && !m.getLayer('hipsometria')) {
    m.addLayer(
      {
        id: 'hipsometria',
        type: 'color-relief',
        source: 'relieve-sombra',
        paint: {
          'color-relief-opacity': 0.32,
          'color-relief-color': ['interpolate', ['linear'], ['elevation'], -1, 'rgba(0,0,0,0)', 0, '#1d3a2b', 250, '#34563a', 700, '#6b7442', 1300, '#94784c', 2000, '#b39f86', 2800, '#e6ded2'],
        },
      } as any,
      'sombreado'
    );
  }
  if (!tintar && m.getLayer('hipsometria')) m.removeLayer('hipsometria');
  if (terreno3D) {
    if (!m.getSource('relieve')) {
      m.addSource('relieve', { type: 'raster-dem', tiles: TESELAS_RELIEVE, encoding: 'terrarium', tileSize: 256, maxzoom: 14 } as any);
    }
    if (!m.getTerrain()) m.setTerrain({ source: 'relieve', exaggeration: 1.6 });
    try {
      (m as any).setSky?.({ 'sky-color': '#0d1a2b', 'horizon-color': '#c98a3a', 'fog-color': '#0b0d0f', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.4, 'fog-ground-blend': 0.2 });
    } catch {
      /* cielo opcional */
    }
  } else {
    if (m.getTerrain()) m.setTerrain(null);
    if (m.getSource('relieve')) m.removeSource('relieve');
    if (!sombrear && m.getSource('relieve-sombra')) m.removeSource('relieve-sombra');
  }
}

/** Quita del mapa las capas encendidas que ya no están en la lista. */
function quitarExtra(m: maplibregl.Map, fuente: string, rol: string) {
  for (const c of capasDeExtra(fuente, rol)) if (m.getLayer(c.id)) m.removeLayer(c.id);
  if (m.getSource(fuente)) m.removeSource(fuente);
}

/**
 * LAS MISMAS CONCESIONES, EN GOOGLE.
 *
 * Esto faltaba entero. El motor de Google solo hacía `fitBounds` y `setCenter`: volaba al sitio
 * correcto y allí no había nada dibujado. O sea que cambiar de MapLibre a Google hacía desaparecer
 * el catastro —que es lo único que esta plataforma existe para enseñar— y la pantalla no lo decía.
 * Quien probaba los dos botones concluía, con razón, que uno de los dos estaba roto.
 *
 * Se usa `google.maps.Data`, que come GeoJSON tal cual. Una capa por cosa, para poder reemplazar
 * el resaltado sin tocar el catastro.
 */
const capasGoogle: Record<'concesiones' | 'resaltada', any> = { concesiones: null, resaltada: null };
const ESTILO_CONCESIONES_GOOGLE = { fillColor: AMBAR, fillOpacity: 0.12, strokeColor: AMBAR, strokeWeight: 1.6, strokeOpacity: 0.9 };
const extrasGoogle = new Map<string, any>();
/** A quién avisar cuando se toca el mapa de Google: se fija desde el componente. */
let tocarGoogle: ((t: Tocado) => void) | null = null;

function pintarGoogle(g: any, cual: 'concesiones' | 'resaltada', datos: unknown) {
  const G = (window as any).google?.maps;
  if (!G || !g) return;
  let capa = capasGoogle[cual];
  if (!capa) {
    capa = new G.Data();
    capa.setStyle(cual === 'concesiones' ? ESTILO_CONCESIONES_GOOGLE : { fillColor: RESALTE, fillOpacity: 0.22, strokeColor: RESALTE, strokeWeight: 3, strokeOpacity: 1 });
    capasGoogle[cual] = capa;
    if (cual === 'concesiones' && filtroGoogle) filtrarGoogle(filtroGoogle);
    if (cual === 'concesiones') {
      capa.addListener('click', (ev: any) => {
        const id = Number(ev.feature?.getProperty('id'));
        if (Number.isFinite(id)) tocarGoogle?.({ tipo: 'concesion', id, nombre: ev.feature.getProperty('nombre'), lngLat: [ev.latLng.lng(), ev.latLng.lat()] });
      });
    }
  }
  // Vaciar antes de poner: `addGeoJson` acumula, y sin esto cada vuelo añadiría otro polígono
  // encima del anterior hasta dejar el mapa lleno de siluetas viejas.
  capa.forEach((f: any) => capa.remove(f));
  try {
    capa.addGeoJson(datos as any);
  } catch {
    /* geometría que Google no entiende: mejor sin ella que con el mapa reventado */
  }
  capa.setMap(g);
}

/** Pinta y recuerda: lo que se recuerda es lo que se repone si el estilo se recarga. */
function pintar(m: maplibregl.Map, cual: 'concesiones' | 'resaltada', datos: unknown) {
  pintado[cual] = datos;
  asegurarCapas(m);
  (m.getSource(cual) as any)?.setData(datos);
}

/** Pinta en Google las capas encendidas y quita las que se apagaron. */
function pintarExtrasGoogle(g: any, extras: CapaExtra[]) {
  const G = (window as any).google?.maps;
  if (!G || !g) return;
  const quedan = new Set(extras.map((x) => fuenteExtra(x.id)));
  for (const [f, capa] of extrasGoogle) {
    if (!quedan.has(f)) {
      capa.setMap(null);
      extrasGoogle.delete(f);
    }
  }
  for (const x of extras) {
    const f = fuenteExtra(x.id);
    if (extrasGoogle.has(f)) continue;
    const e = ESTILO_ROL[x.rol] || { color: '#FFFFFF', relleno: 0.1, ancho: 1 };
    const capa = new G.Data();
    capa.setStyle((feat: any) => ({
      fillColor: x.rol === 'litologia' ? COLOR_ROCA[feat.getProperty('clase')] || COLOR_ROCA.otra : e.color,
      fillOpacity: e.relleno,
      strokeColor: x.rol === 'litologia' ? '#000000' : e.color,
      strokeOpacity: x.rol === 'litologia' ? 0.4 : 0.95,
      strokeWeight: Math.max(1, e.ancho),
      zIndex: 0,
      icon: { path: G.SymbolPath.CIRCLE, scale: 4, fillColor: e.color, fillOpacity: 1, strokeColor: '#000', strokeWeight: 1 },
    }));
    try {
      capa.addGeoJson(x.geojson as any);
    } catch {
      /* geometría que Google no entiende: se queda sin esa capa */
    }
    capa.addListener('click', (ev: any) => {
      const eid = Number(ev.feature?.getProperty('eid'));
      if (Number.isFinite(eid)) tocarGoogle?.({ tipo: 'rasgo', eid, nombre: ev.feature.getProperty('nombre'), lngLat: [ev.latLng.lng(), ev.latLng.lat()] });
    });
    capa.setMap(g);
    extrasGoogle.set(f, capa);
  }
}

/* ---------------------------------------------------------------- filtro por mineral y lugar */

/** Lo que se muestra encima del mapa mientras hay un filtro puesto. */
export function etiquetaFiltro(mineral: string): string {
  if (mineral === 'metalicas') return 'Concesiones metálicas';
  if (mineral === 'no metalicas') return 'Concesiones no metálicas';
  return `Con indicios de ${mineral}`;
}

/** La condición del filtro, en el lenguaje de expresiones de MapLibre. */
function condicionFiltro(mineral: string): any {
  // En minúsculas: la clase llega «Pequeña Minería No Metálica» del padrón o «No metálica» por la capa.
  const clase = ['downcase', ['coalesce', ['get', 'clase'], '']];
  if (mineral === 'metalicas') return ['all', ['in', 'metálica', clase], ['!', ['in', 'no metálica', clase]]];
  if (mineral === 'no metalicas') return ['any', ['in', 'no metálica', clase], ['in', 'banco', clase]];
  return ['in', mineral, ['coalesce', ['get', 'minerales'], '']];
}

/** La misma condición en JavaScript, para contar y encuadrar lo que quedó. */
export function cumpleFiltro(props: Record<string, unknown> | null | undefined, mineral: string): boolean {
  const clase = String(props?.clase || '').toLowerCase();
  if (mineral === 'metalicas') return clase.includes('metálica') && !clase.includes('no metálica');
  if (mineral === 'no metalicas') return clase.includes('no metálica') || clase.includes('banco');
  return String(props?.minerales || '').split(',').includes(mineral);
}

/** El filtro puesto ahora (para el mapa de Google, que no tiene expresiones). */
let filtroGoogle: string | null = null;

/** En Google el filtro es de estilo: las que no cumplen se esconden (el catastro sigue cargado). */
function filtrarGoogle(mineral: string | null) {
  filtroGoogle = mineral;
  const capa = capasGoogle.concesiones;
  if (!capa) return;
  capa.setStyle((f: any) => ({
    ...ESTILO_CONCESIONES_GOOGLE,
    visible: !filtroGoogle || cumpleFiltro({ clase: f.getProperty('clase'), minerales: f.getProperty('minerales') }, filtroGoogle),
  }));
}

/** Los filtros originales de cada capa del catastro, para poder quitar el nuestro sin romper los suyos. */
const filtrosOriginales = new Map<string, any>();

function aplicarFiltro(m: maplibregl.Map, mineral: string | null) {
  const capas = (m.getStyle()?.layers || []).filter((l: any) => l.source === 'concesiones').map((l) => l.id);
  for (const id of capas) {
    if (!filtrosOriginales.has(id)) filtrosOriginales.set(id, m.getFilter(id) ?? null);
    const orig = filtrosOriginales.get(id);
    const f = mineral ? (orig ? ['all', orig, condicionFiltro(mineral)] : condicionFiltro(mineral)) : orig;
    // Solo si cambia: poner el mismo filtro dispara `styledata`, y el efecto que lo repone escucha eso.
    if (JSON.stringify(m.getFilter(id) ?? null) !== JSON.stringify(f ?? null)) m.setFilter(id, f ?? null);
  }
}

/** Cuántas quedaron y el rectángulo que las encierra. */
function resumenFiltro(mineral: string): { n: number; encuadre: [number, number, number, number] | null } {
  const fc = pintado.concesiones as { features?: Array<{ properties?: Record<string, unknown>; geometry?: any }> } | null;
  let n = 0;
  let caja: [number, number, number, number] | null = null;
  const tocar = (c: any) => {
    if (typeof c?.[0] === 'number') {
      caja = caja ? [Math.min(caja[0], c[0]), Math.min(caja[1], c[1]), Math.max(caja[2], c[0]), Math.max(caja[3], c[1])] : [c[0], c[1], c[0], c[1]];
    } else if (Array.isArray(c)) c.forEach(tocar);
  };
  for (const f of fc?.features || []) {
    if (!cumpleFiltro(f.properties, mineral)) continue;
    n++;
    tocar(f.geometry?.coordinates);
  }
  return { n, encuadre: caja };
}

/** El alfiler del lugar pedido, con su nombre. */
function alfiler(nombre: string, detalle?: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${nombre}${detalle ? `, ${detalle}` : ''}`);
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;transform:translateY(-6px)';
  const etiqueta = document.createElement('div');
  etiqueta.style.cssText = 'background:rgba(8,12,16,.86);border:1px solid rgba(255,174,59,.55);color:#FFE3A8;font:600 12px/1.25 ui-sans-serif,system-ui;padding:5px 9px;border-radius:9px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.5);text-align:center';
  etiqueta.textContent = nombre;
  if (detalle) {
    const d = document.createElement('div');
    d.style.cssText = 'font:500 10px/1.2 ui-monospace,monospace;color:#9FB2BC;letter-spacing:.04em;margin-top:2px';
    d.textContent = detalle;
    etiqueta.appendChild(d);
  }
  const punta = document.createElement('div');
  punta.style.cssText = 'width:14px;height:14px;margin-top:4px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#FF5A3C;border:2px solid #fff;box-shadow:0 0 0 6px rgba(255,90,60,.25),0 2px 6px rgba(0,0,0,.5);animation:electrum-alfiler 1.6s ease-in-out infinite';
  el.append(etiqueta, punta);
  return el;
}

export function Mapa({ orden, motor, fondo, claveGoogle, extras = [], seleccion = null, onTocar, tresD = false, rasters = [], muestras = null, traslapes = null, curvas = true, prospectividad = false, visible = true, enfoque = null, yo = null }: Props) {
  /** El último `onTocar`, para los manejadores que se atan una sola vez al crear el mapa. */
  const tocarRef = useRef(onTocar);
  tocarRef.current = onTocar;
  /** Las capas encendidas de ahora, para reponerlas cuando Google termina de cargar (asíncrono). */
  const extrasRef = useRef(extras);
  extrasRef.current = extras;
  useEffect(() => {
    tocarGoogle = (t) => tocarRef.current?.(t);
    return () => {
      tocarGoogle = null;
    };
  }, []);
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLibre | null>(null);
  const [listo, setListo] = useState(false);
  /** El filtro por mineral puesto ahora (y cuántas quedaron), para la etiqueta de encima del mapa. */
  const [filtro, setFiltro] = useState<{ mineral: string; n: number } | null>(null);
  const marcaLugar = useRef<maplibregl.Marker | null>(null);
  const cajaGoogle = useRef<HTMLDivElement>(null);
  const google = useRef<any>(null);
  const [falloGoogle, setFalloGoogle] = useState<string | null>(null);
  /*
   * El fondo del momento, SIN que construir el mapa dependa de él.
   *
   * Tenerlo en las dependencias del efecto que crea el mapa hacía que cambiar de satélite a calles
   * destruyera el mapa entero y montara uno nuevo: se perdía dónde estabas mirando, el zoom, y las
   * concesiones pintadas. Y lo irónico es que justo debajo vive un efecto escrito para conservar
   * las capas al cambiar de estilo —con su `setStyle` y su comentario— que NUNCA llegaba a
   * ejecutarse, porque para cuando corría el mapa ya era otro y su `fondoPuesto` volvía a empezar.
   */
  const fondoRef = useRef(fondo);
  fondoRef.current = fondo;

  /* ---------------------------------------------------------------- MapLibre */

  useEffect(() => {
    if (motor !== 'maplibre' || !caja.current || mapa.current) return;
    introPendiente = quiereIntro();
    const m = new maplibregl.Map({
      container: caja.current,
      style: fondoRef.current === 'satelite' ? estiloSatelite() : estiloCalles(),
      ...(introPendiente ? { center: [-86.8, 14.6] as [number, number], zoom: 1.4 } : { bounds: HONDURAS, fitBoundsOptions: { padding: 40 } }),
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
    if (introPendiente) m.once('style.load', () => prepararGlobo(m));
    m.on('load', () => {
      // Las fuentes nacen vacías: el contenido llega cuando una herramienta lo manda.
      asegurarCapas(m);
      // Cada vez que el estilo cambia, no solo la primera: las teselas que fallan lo recargan solas.
      // Juntado en un solo pase por cuadro: un cambio de estilo dispara varios `styledata` seguidos.
      let pendiente = false;
      m.on('styledata', () => {
        if (pendiente) return;
        pendiente = true;
        requestAnimationFrame(() => {
          pendiente = false;
          asegurarCapas(m);
        });
      });
      setListo(true);
    });

    /*
     * TOCAR. Primero la concesión (lo que esta plataforma existe para enseñar), después un rasgo de
     * una capa encendida, y si no hay nada, el punto: «¿qué hay aquí?». Una caja de unos píxeles
     * alrededor del dedo, porque en un teléfono nadie acierta a una línea de falla de un píxel.
     */
    const bajoElDedo = (p: maplibregl.Point, holgura: number) => {
      const caja: [maplibregl.PointLike, maplibregl.PointLike] = [
        [p.x - holgura, p.y - holgura],
        [p.x + holgura, p.y + holgura],
      ];
      const existentes = (ids: string[]) => ids.filter((id) => m.getLayer(id));
      // Una muestra gana a todo: es un punto encima de la concesión donde se tomó.
      const muestra = m.queryRenderedFeatures(caja, { layers: existentes(['muestras-punto']) });
      const conc = muestra.length ? [] : m.queryRenderedFeatures(caja, { layers: existentes(CAPAS_TOCABLES_CONCESION) });
      const extra = conc.length || muestra.length ? [] : m.queryRenderedFeatures(caja, { layers: existentes(capasTocablesExtra()) });
      return { muestra, conc, extra };
    };
    m.on('click', (e) => {
      // Midiendo o trazando un perfil, el toque es un vértice, no una pregunta.
      if (herramientaEnUso()) return;
      const { muestra, conc, extra } = bajoElDedo(e.point, 6);
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const mu = muestra.find((f) => Number.isFinite(Number(f.properties?.id)));
      if (mu) return tocarRef.current?.({ tipo: 'muestra', id: Number(mu.properties!.id), nombre: mu.properties?.c, lngLat });
      const c = conc.find((f) => Number.isFinite(Number(f.properties?.id)));
      if (c) return tocarRef.current?.({ tipo: 'concesion', id: Number(c.properties!.id), nombre: c.properties?.nombre, lngLat });
      // Entre varias capas encendidas gana la de arriba: puntos, luego líneas, luego polígonos.
      const orden = (id: string) => (id.endsWith('-punto') ? 0 : id.endsWith('-borde') ? 1 : 2);
      const r = extra.filter((f) => Number.isFinite(Number(f.properties?.eid))).sort((a, b) => orden(a.layer.id) - orden(b.layer.id))[0];
      if (r) return tocarRef.current?.({ tipo: 'rasgo', eid: Number(r.properties!.eid), nombre: r.properties?.nombre, lngLat });
      tocarRef.current?.({ tipo: 'punto', lngLat });
    });
    let bajo: number | null = null;
    m.on('mousemove', (e) => {
      // Con una herramienta en uso el cursor es la cruz de la herramienta, no la manito del catastro.
      if (herramientaEnUso()) return;
      const { muestra, conc, extra } = bajoElDedo(e.point, 3);
      const id = conc.length ? Number(conc[0].properties?.id) : null;
      m.getCanvas().style.cursor = muestra.length || conc.length || extra.length ? 'pointer' : '';
      if (id !== bajo && m.getLayer('concesiones-hover')) {
        bajo = id;
        m.setFilter('concesiones-hover', ['==', ['to-number', ['get', 'id']], id ?? -1]);
      }
    });
    mapa.current = m;
    /*
     * El mapa vivo, para la captura del informe.
     *
     * Antes esto era SOLO `window.__mapa`, con un comentario que decía «no lo usa la aplicación» —
     * y la aplicación sí lo usaba: es de donde `capturaDelMapa` saca el lienzo. Peor: no se
     * limpiaba al destruir el mapa, así que tras cambiar de motor la referencia seguía apuntando a
     * una instancia muerta y el informe se llevaba una foto vieja o vacía sin decir nada.
     */
    fijarMapaVivo({ m, motor: 'maplibre' });
    // Asa para las capturas de QA (scripts/qa/electrum.mjs).
    (window as any).__mapa = m;

    /*
     * El tamaño lo sigue MapLibre solo (trae su propio ResizeObserver, que además redibuja en el
     * acto). Había un segundo observador nuestro que llamaba a `resize()` sin redibujar: cada vez
     * que el panel cambiaba de alto el lienzo quedaba un cuadro en negro —parpadeo al arrastrar—.
     */
    return () => {
      m.remove();
      mapa.current = null;
      if (esMapaVivo(m)) fijarMapaVivo(null);
      if ((window as any).__mapa === m) delete (window as any).__mapa;
      setListo(false);
    };
  }, [motor]);

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
    m.setStyle(fondo === 'satelite' ? estiloSatelite() : estiloCalles());
  }, [fondo, listo]);

  /* ---------------------------------------------------------------- Google */

  useEffect(() => {
    if (motor !== 'google') return;
    if (!claveGoogle) {
      setFalloGoogle('Falta la clave de Google Maps. Ponela en VITE_GOOGLE_MAPS_KEY y volvé a compilar: va dentro del paquete de la web.');
      return;
    }
    setFalloGoogle(null);
    const yaEsta = (window as any).google?.maps;
    const arrancar = () => {
      if (!cajaGoogle.current) return;
      // Que la captura sepa que el mapa de la pantalla es el de Google, para poder explicar por qué
      // no entra en el informe en vez de armarlo sin mapa y en silencio.
      fijarMapaVivo({ m: null, motor: 'google' });
      google.current = new (window as any).google.maps.Map(cajaGoogle.current, {
        center: { lat: 14.75, lng: -86.25 },
        zoom: 7,
        mapTypeId: fondoRef.current === 'satelite' ? 'hybrid' : 'roadmap',
        streetViewControl: true,
        fullscreenControl: false,
      });
      // Lo que ya se había pintado en MapLibre se repone acá: cambiar de motor no puede vaciar el
      // catastro de la pantalla.
      capasGoogle.concesiones = null;
      capasGoogle.resaltada = null;
      extrasGoogle.clear();
      google.current.addListener('click', (ev: any) => {
        tocarGoogle?.({ tipo: 'punto', lngLat: [ev.latLng.lng(), ev.latLng.lat()] });
      });
      for (const cual of ['concesiones', 'resaltada'] as const) {
        if (pintado[cual]) pintarGoogle(google.current, cual, pintado[cual]);
      }
      // Y las capas encendidas: el efecto que las pinta corrió antes de que existiera el mapa.
      pintarExtrasGoogle(google.current, extrasRef.current);
    };
    if (yaEsta) return arrancar();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(claveGoogle)}&libraries=geometry&language=es&region=HN`;
    s.async = true;
    s.onload = arrancar;
    s.onerror = () => setFalloGoogle('Google Maps no cargó. Revisá que la clave esté habilitada y con facturación activa.');
    document.head.appendChild(s);
    // `fondo` NO va aquí: cambiarlo recargaría el mapa de Google entero. Lo lleva `setMapTypeId`.
  }, [motor, claveGoogle]);

  useEffect(() => {
    if (motor === 'google' && google.current) {
      google.current.setMapTypeId(fondo === 'satelite' ? 'hybrid' : 'roadmap');
    }
  }, [fondo, motor]);

  /* ---------------------------------------------------------------- capas encendidas y tocada */

  useEffect(() => {
    const quedan = new Map(extras.map((x) => [fuenteExtra(x.id), x]));
    const m = mapa.current;
    for (const [f, v] of [...pintadoExtra]) {
      if (!quedan.has(f)) {
        pintadoExtra.delete(f);
        if (m && listo) quitarExtra(m, f, v.rol);
      }
    }
    for (const [f, x] of quedan) pintadoExtra.set(f, { rol: x.rol, geojson: x.geojson });
    if (m && listo) asegurarCapas(m);
    if (google.current && motor === 'google') pintarExtrasGoogle(google.current, extras);
  }, [extras, listo, motor]);

  useEffect(() => {
    const quedan = new Map(rasters.map((r) => [r.clave, r]));
    const m = mapa.current;
    for (const clave of [...pintadoRaster.keys()]) {
      if (!quedan.has(clave)) {
        pintadoRaster.delete(clave);
        if (m && listo) quitarRaster(m, clave);
      }
    }
    for (const [clave, r] of quedan) pintadoRaster.set(clave, { opacidad: Math.max(0.1, Math.min(1, r.opacidad)), zoomMax: r.zoomMax, vector: r.vector });
    if (m && listo) asegurarCapas(m);
  }, [rasters, listo]);

  useEffect(() => {
    const m = mapa.current;
    const antes = pintadoMuestras;
    pintadoMuestras = muestras;
    if (!m || !listo) return;
    // Otros puntos (se recargaron): la fuente se rehace con ellos; otro elemento solo repinta.
    if (!muestras || (antes && antes.geojson !== muestras.geojson)) quitarMuestras(m);
    if (muestras) asegurarCapas(m);
  }, [muestras, listo]);

  useEffect(() => {
    const m = mapa.current;
    const antes = pintadoTraslapes;
    pintadoTraslapes = traslapes;
    if (!m || !listo) return;
    if (antes !== traslapes) for (const id of ['traslapes-rayado', 'traslapes-borde']) if (m.getLayer(id)) m.removeLayer(id);
    if (antes !== traslapes && m.getSource('traslapes')) m.removeSource('traslapes');
    if (traslapes) asegurarCapas(m);
  }, [traslapes, listo]);

  /*
   * Las alertas ya NO laten. El pulso cambiaba el estilo 30 veces por segundo: cada cambio
   * disparaba `styledata` (y con él toda la reposición de capas) y, con el terreno 3D, obligaba a
   * MapLibre a tirar y rehacer las texturas del relieve —eso era el parpadeo—. Quedan con un halo
   * quieto (`line-blur`), que se ve igual de bien y no cuesta nada.
   */

  // Curvas y sombreado: dependen de si están pedidas y del fondo (más marcadas sobre el satélite).
  useEffect(() => {
    relieve.curvas = curvas;
    relieve.fondo = fondo;
    const m = mapa.current;
    if (!m || !listo) return;
    // Sin quitar y volver a poner las capas (eso las hacía parpadear): `aplicarCurvas` actualiza el color.
    aplicarCurvas(m);
    aplicarTerreno(m);
  }, [curvas, fondo, listo]);

  // La entrada desde el espacio, la primera vez que el mapa se deja ver en la sesión.
  useEffect(() => {
    const m = mapa.current;
    if (m && listo && visible) introDesdeElEspacio(m);
  }, [listo, visible]);

  // Un puntaje calculado al abrir una ficha entra al dato del catastro pintado (si cambió).
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    const alRecibir = (e: Event) => {
      // `puntaje` null = sin datos para evaluar: se marca aparte, no como «muy baja» (H07).
      const { id, puntaje } = (e as CustomEvent<{ id: number; puntaje: number | null }>).detail || ({} as any);
      const fc = pintado.concesiones as { features?: Array<{ properties?: Record<string, unknown> }> } | null;
      const f = fc?.features?.find((x) => Number(x.properties?.id) === Number(id));
      if (!f?.properties) return;
      if (puntaje == null) {
        if (f.properties.prosp_sin === 1 && !('prosp' in f.properties)) return;
        delete f.properties.prosp;
        f.properties.prosp_sin = 1;
      } else {
        if (f.properties.prosp === puntaje) return;
        f.properties.prosp = puntaje;
        delete f.properties.prosp_sin;
      }
      /*
       * Volver a mandar el catastro entero (mil polígonos) rehace todas sus teselas y los nombres
       * parpadean. Solo hace falta si el relleno por prospectividad se está viendo; si no, el dato
       * queda guardado y entra la próxima vez que se pinte.
       */
      if (rellenoPorProsp) pintar(m, 'concesiones', fc);
    };
    window.addEventListener('electrum:prospectividad', alRecibir);
    return () => window.removeEventListener('electrum:prospectividad', alRecibir);
  }, [listo]);

  useEffect(() => {
    const antes = rellenoPorProsp;
    rellenoPorProsp = prospectividad;
    const m = mapa.current;
    if (!m || !listo) return;
    // Los puntajes que llegaron mientras el relleno estaba apagado entran ahora, de una vez.
    if (prospectividad && !antes && pintado.concesiones) pintar(m, 'concesiones', pintado.concesiones);
    aplicarRelleno(m);
  }, [prospectividad, listo]);

  useEffect(() => {
    const m = mapa.current;
    if (m && listo && m.getLayer('concesiones-sel')) m.setFilter('concesiones-sel', ['==', ['to-number', ['get', 'id']], seleccion ?? -1]);
  }, [seleccion, listo]);

  /* ---------------------------------------------------------------- 3D */

  useEffect(() => {
    terreno3D = tresD;
    const m = mapa.current;
    if (!m || !listo) return;
    aplicarTerreno(m);
    // La cámara acompaña: se inclina al entrar en 3D y vuelve a plano al salir.
    if (tresD) m.easeTo({ pitch: Math.max(m.getPitch(), 62), bearing: m.getBearing() || -18, duration: duracion(1800) });
    else m.easeTo({ pitch: 0, bearing: 0, duration: duracion(1200) });
  }, [tresD, listo]);

  /* ---------------------------------------------------------------- visor */

  /*
   * Se mueve con la cámara escribiendo el estilo directo, sin pasar por React: a 60 cuadros por
   * segundo un setState por cuadro volvería a dibujar todo el mapa, que es justo lo que parpadea.
   */
  const visor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const m = mapa.current;
    const el = visor.current;
    if (!el) return;
    if (!m || !listo || !enfoque || motor !== 'maplibre') {
      el.style.opacity = '0';
      return;
    }
    const [a, b, c, d] = enfoque.encuadre;
    const poner = () => {
      const pts = [
        [a, b],
        [c, b],
        [c, d],
        [a, d],
      ].map((p) => m.project(p as [number, number]));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      // Nunca más chico que un dedo, para que se vea aunque la concesión sea diminuta a ese zoom.
      const w = Math.max(96, Math.max(...xs) - Math.min(...xs) + 36);
      const h = Math.max(72, Math.max(...ys) - Math.min(...ys) + 36);
      el.style.transform = `translate(${Math.round(cx - w / 2)}px, ${Math.round(cy - h / 2)}px)`;
      el.style.width = `${Math.round(w)}px`;
      el.style.height = `${Math.round(h)}px`;
      el.style.opacity = '1';
    };
    poner();
    m.on('move', poner);
    m.on('resize', poner);
    return () => {
      m.off('move', poner);
      m.off('resize', poner);
    };
  }, [enfoque, listo, motor]);

  /* ---------------------------------------------------------------- manos libres */

  // Las órdenes de voz («acércate», «aléjate», «dónde estoy») llegan como eventos de la ventana.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    const alPedir = (e: Event) => {
      const d = (e as CustomEvent<{ accion: string; dir?: number | string; grados?: number; centro?: [number, number]; zoom?: number; factor?: number }>).detail || ({} as any);
      const cont = m.getContainer();
      if (d.accion === 'mover') {
        // Un tercio de la pantalla por orden: se nota, y no se pierde de vista lo que se miraba.
        const dx = cont.clientWidth * 0.33;
        const dy = cont.clientHeight * 0.33;
        const paso: Record<string, [number, number]> = { arriba: [0, -dy], abajo: [0, dy], izquierda: [-dx, 0], derecha: [dx, 0] };
        const v = paso[String(d.dir)];
        if (v) m.panBy(v, { duration: duracion(700) });
      } else if (d.accion === 'rotar') {
        m.easeTo({ bearing: m.getBearing() + (Number(d.grados) || 30), duration: duracion(900), essential: true });
      } else if (d.accion === 'norte') {
        m.easeTo({ bearing: 0, duration: duracion(900), essential: true });
      } else if (d.accion === 'inclinar') {
        m.easeTo({ pitch: Math.min(m.getMaxPitch(), m.getPitch() < 40 ? 55 : m.getPitch() + 15), duration: duracion(900), essential: true });
      } else if (d.accion === 'cenital') {
        m.easeTo({ pitch: 0, duration: duracion(900), essential: true });
      } else if (d.accion === 'orbitar') {
        // Toma de dron: una vuelta entera a velocidad pareja, con la cámara inclinada para leer el relieve.
        m.easeTo({ bearing: m.getBearing() + 359, pitch: Math.max(m.getPitch(), 50), duration: duracion(16000), easing: (t: number) => t, essential: true });
      } else if (d.accion === 'pais') {
        m.fitBounds(HONDURAS, { padding: 40, pitch: 0, bearing: 0, duration: duracion(2200), essential: true });
      } else if (d.accion === 'zoom') {
        if (Number(d.dir ?? 1) > 0) m.zoomIn({ duration: duracion(700) });
        else m.zoomOut({ duration: duracion(700) });
      } else if (d.accion === 'zoom-libre' && typeof d.factor === 'number') {
        // El pellizco de Air touch: zoom continuo, sin animación (lo anima la mano).
        m.setZoom(Math.max(2, Math.min(18, m.getZoom() + Math.log2(d.factor))));
      } else if (d.accion === 'mover' && Array.isArray(d.centro)) {
        m.panBy(d.centro as [number, number], { duration: 0 });
      } else if (d.accion === 'ir' && Array.isArray(d.centro)) {
        m.flyTo({ center: d.centro, zoom: d.zoom ?? 12, duration: duracion(1600), essential: true });
      }
    };
    window.addEventListener('electrum:mapa', alPedir);
    return () => window.removeEventListener('electrum:mapa', alPedir);
  }, [listo]);

  // Cambiar el fondo rehace las capas: el filtro por mineral se vuelve a poner encima.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo || !filtro) return;
    const poner = () => {
      try {
        aplicarFiltro(m, filtro.mineral);
      } catch {
        /* las capas todavía no están: el próximo styledata lo pone */
      }
    };
    poner();
    m.on('styledata', poner);
    return () => {
      m.off('styledata', poner);
    };
  }, [filtro, listo, fondo]);

  // «Usted está aquí»: un punto azul con halo, como en cualquier mapa del teléfono.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo || !yo || motor !== 'maplibre') return;
    const el = document.createElement('div');
    el.setAttribute('aria-label', 'Usted está aquí');
    el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.28),0 2px 8px rgba(0,0,0,.5)';
    const marca = new maplibregl.Marker({ element: el }).setLngLat(yo).addTo(m);
    return () => {
      marca.remove();
    };
  }, [yo, listo, motor]);

  /* ---------------------------------------------------------------- órdenes */

  const obedecer = useCallback((o: OrdenMapa) => {
    const m = mapa.current;
    const mia = ++ordenesDadas;
    if (m && listo) {
      const relleno = 'margen' in o ? rellenoDe(o.margen, m) : undefined;
      if (o.accion === 'volar') {
        pintar(m, 'resaltada', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: o.geojson, properties: {} }] });
        /*
         * Vuelo de presentación: sube, cruza y baja inclinándose y girando un poco al llegar, para
         * que se lea el relieve alrededor de la concesión. Con «menos movimiento» pedido, salto directo.
         */
        const cam = o.encuadre ? camaraConMargen(m, o.encuadre, o.margen, { relleno: 70, maxZoom: 15, giro: -14 }) : null;
        const centro = cam?.center ?? o.centro;
        const zoom = cam?.zoom ?? (o.centro ? 13 : undefined);
        if (centro && zoom !== undefined) {
          m.flyTo({ center: centro as any, zoom, pitch: terreno3D ? 60 : 38, bearing: -14, curve: 1.6, speed: 0.9, duration: duracion(2800), essential: true, ...(relleno ? { padding: relleno } : {}) });
        }
      } else if (o.accion === 'capa') {
        pintar(m, 'concesiones', o.geojson);
        // Durante la entrada desde el espacio, el descenso ya termina sobre el país.
        if (o.encuadre && !introEnCurso()) m.fitBounds(o.encuadre, { padding: 60, duration: duracion(1400) });
      } else if (o.accion === 'candidatas') {
        pintar(m, 'resaltada', o.geojson);
        if (o.encuadre) m.fitBounds(o.encuadre, { padding: 80, duration: duracion(1400), maxZoom: 14 });
      } else if (o.accion === 'punto') {
        m.flyTo({ center: o.punto, zoom: 14, duration: duracion(1200) });
      } else if (o.accion === 'camara') {
        m.flyTo({ center: o.centro, zoom: o.zoom, pitch: o.inclinacion ?? m.getPitch(), bearing: o.giro ?? m.getBearing(), duration: duracion(o.ms ?? 4000), essential: true, ...(relleno ? { padding: relleno } : {}) });
      } else if (o.accion === 'encuadrar') {
        const cam = camaraConMargen(m, o.encuadre, o.margen, { relleno: 40, giro: o.giro ?? 0 });
        if (cam) m.flyTo({ center: cam.center, zoom: cam.zoom, pitch: o.inclinacion ?? 0, bearing: o.giro ?? 0, curve: 1.3, duration: duracion(o.ms ?? 3000), essential: true, ...(relleno ? { padding: relleno } : {}) });
        else m.fitBounds(o.encuadre, { padding: 40, pitch: o.inclinacion ?? 0, bearing: o.giro ?? 0, duration: duracion(o.ms ?? 3000) } as any);
      } else if (o.accion === 'orbitar') {
        // Velocidad pareja, sin acelerar ni frenar: así se lee como una toma de dron y no como un salto.
        const girar = () => {
          // Si mientras tanto llegó otra orden, esta ya no corre: cortaría el vuelo nuevo.
          if (mia !== ordenesDadas) return;
          m.easeTo({
            ...(relleno ? { padding: relleno } : {}),
            ...(o.centro ? { center: o.centro } : {}),
            ...(o.zoom !== undefined ? { zoom: o.zoom } : {}),
            pitch: o.inclinacion ?? Math.max(m.getPitch(), terreno3D ? 60 : 45),
            bearing: m.getBearing() + (sinMovimiento() ? 0 : o.grados),
            duration: duracion(o.ms),
            easing: (t: number) => t,
            essential: true,
          });
        };
        // Espera a que termine el vuelo en curso: girar encima lo dejaba a medio camino.
        if (m.isMoving()) m.once('moveend', girar);
        else girar();
      } else if (o.accion === 'lugar') {
        marcaLugar.current?.remove();
        marcaLugar.current = new maplibregl.Marker({ element: alfiler(o.nombre, o.detalle), anchor: 'bottom' }).setLngLat(o.centro).addTo(m);
        m.flyTo({ center: o.centro, zoom: o.zoom, pitch: terreno3D ? 50 : m.getPitch(), curve: 1.5, duration: duracion(2600), essential: true });
      } else if (o.accion === 'filtrar') {
        aplicarFiltro(m, o.mineral);
        filtroGoogle = o.mineral; // si se cambia a Google, sigue filtrado
        if (o.mineral) {
          const r = resumenFiltro(o.mineral);
          setFiltro({ mineral: o.mineral, n: r.n });
          window.dispatchEvent(new CustomEvent('electrum:filtrado', { detail: { mineral: o.mineral, n: r.n, etiqueta: etiquetaFiltro(o.mineral) } }));
          if (r.encuadre && r.n) m.fitBounds(r.encuadre, { padding: 60, maxZoom: 11, duration: duracion(1600) });
        } else {
          setFiltro(null);
          window.dispatchEvent(new CustomEvent('electrum:filtrado', { detail: { mineral: null, n: 0 } }));
        }
      }
    }
    const g = google.current;
    if (g && motor === 'google') {
      const G = (window as any).google.maps;
      if (o.accion === 'volar') {
        pintado.resaltada = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: o.geojson, properties: {} }] };
        pintarGoogle(g, 'resaltada', pintado.resaltada);
        if (o.encuadre) {
          g.fitBounds(new G.LatLngBounds({ lat: o.encuadre[1], lng: o.encuadre[0] }, { lat: o.encuadre[3], lng: o.encuadre[2] }));
        } else if (o.centro) {
          g.setCenter({ lat: o.centro[1], lng: o.centro[0] });
          g.setZoom(13);
        }
      } else if (o.accion === 'capa') {
        pintado.concesiones = o.geojson;
        pintarGoogle(g, 'concesiones', o.geojson);
        if (o.encuadre) {
          g.fitBounds(new G.LatLngBounds({ lat: o.encuadre[1], lng: o.encuadre[0] }, { lat: o.encuadre[3], lng: o.encuadre[2] }));
        }
      } else if (o.accion === 'candidatas') {
        pintado.resaltada = o.geojson;
        pintarGoogle(g, 'resaltada', o.geojson);
        if (o.encuadre) {
          g.fitBounds(new G.LatLngBounds({ lat: o.encuadre[1], lng: o.encuadre[0] }, { lat: o.encuadre[3], lng: o.encuadre[2] }));
        }
      } else if (o.accion === 'punto') {
        g.setCenter({ lat: o.punto[1], lng: o.punto[0] });
        g.setZoom(14);
      } else if (o.accion === 'camara') {
        g.setCenter({ lat: o.centro[1], lng: o.centro[0] });
        g.setZoom(Math.round(o.zoom));
      } else if (o.accion === 'encuadrar') {
        g.fitBounds(new G.LatLngBounds({ lat: o.encuadre[1], lng: o.encuadre[0] }, { lat: o.encuadre[3], lng: o.encuadre[2] }));
      } else if (o.accion === 'orbitar' && o.centro) {
        g.setCenter({ lat: o.centro[1], lng: o.centro[0] });
      } else if (o.accion === 'lugar') {
        g.setCenter({ lat: o.centro[1], lng: o.centro[0] });
        g.setZoom(Math.round(o.zoom));
      } else if (o.accion === 'filtrar') {
        // Lo mismo que en MapLibre: esconder las que no cumplen, contar, encuadrar y avisar (la
        // confirmación hablada espera este aviso).
        filtrarGoogle(o.mineral);
        if (o.mineral) {
          const r = resumenFiltro(o.mineral);
          setFiltro({ mineral: o.mineral, n: r.n });
          window.dispatchEvent(new CustomEvent('electrum:filtrado', { detail: { mineral: o.mineral, n: r.n, etiqueta: etiquetaFiltro(o.mineral) } }));
          if (r.encuadre && r.n) g.fitBounds(new G.LatLngBounds({ lat: r.encuadre[1], lng: r.encuadre[0] }, { lat: r.encuadre[3], lng: r.encuadre[2] }));
        } else {
          setFiltro(null);
          window.dispatchEvent(new CustomEvent('electrum:filtrado', { detail: { mineral: null, n: 0 } }));
        }
      }
    }
  }, [listo, motor]);

  useEffect(() => {
    if (!orden) return;
    try {
      obedecer(orden);
    } catch (e) {
      // Una cámara imposible (mapa plegado a mitad de un vuelo) se descarta; el mapa sigue en pie.
      console.warn('[mapa] orden descartada:', (e as Error)?.message || e);
    }
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
      {motor === 'maplibre' && listo && mapa.current && <Herramientas mapa={mapa.current} tresD={tresD} fondo={fondo} />}
      {filtro && (
        <div className="absolute bottom-4 left-1/2 z-[6] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#FFAE3B]/50 bg-black/75 py-1 pl-3 pr-1 text-[12px] text-[#FFE3A8] shadow-lg backdrop-blur" role="status" data-filtro-mapa>
          <span className="h-2 w-2 rounded-full bg-[#FFAE3B]" aria-hidden />
          <span>
            {etiquetaFiltro(filtro.mineral)} · <b>{filtro.n}</b>
          </span>
          <button
            type="button"
            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#C9D6DC] hover:bg-white/10 cursor-pointer"
            onClick={() => obedecer({ accion: 'filtrar', mineral: null })}
            title="Volver a ver todas las concesiones"
          >
            Todas ✕
          </button>
        </div>
      )}
      <style>{'@keyframes electrum-alfiler{0%,100%{transform:rotate(-45deg) translate(0,0)}50%{transform:rotate(-45deg) translate(2px,-2px)}}'}</style>
      {/* El visor del recorrido: cuatro esquinas y el nombre, como el cuadro de una cámara. */}
      <div ref={visor} aria-hidden className="pointer-events-none absolute left-0 top-0 z-[4]" style={{ opacity: 0, transition: 'opacity .5s' }}>
        {(['left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-lg', 'right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-lg', 'left-0 bottom-0 border-l-[3px] border-b-[3px] rounded-bl-lg', 'right-0 bottom-0 border-r-[3px] border-b-[3px] rounded-br-lg'] as const).map((k) => (
          <span key={k} className={`absolute h-5 w-5 ${k}`} style={{ borderColor: '#FFD98A', filter: 'drop-shadow(0 0 6px rgba(255,217,138,.8))' }} />
        ))}
        {enfoque?.etiqueta && (
          <span className="absolute -top-7 left-0 whitespace-nowrap rounded-md bg-black/75 px-2 py-0.5 font-mono text-[11px] tracking-[0.08em] text-[#FFE3A8] shadow-lg backdrop-blur">
            {enfoque.etiqueta}
          </span>
        )}
      </div>
      {motor === 'google' && falloGoogle && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center">
          <p className="max-w-sm text-sm text-[#8FA3B0] leading-relaxed">{falloGoogle}</p>
        </div>
      )}
    </div>
  );
}

/** La foto para el informe vive en `captura.ts`, que no carga MapLibre. Se reexporta por compatibilidad. */
export { capturaDelMapa, type Captura } from './captura';
