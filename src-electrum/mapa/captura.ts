/**
 * Lo que el resto de la pantalla necesita saber del mapa SIN cargar el mapa.
 *
 * MapLibre pesa unos 800 KB de JavaScript —tres cuartas partes del paquete entero de Electrum— y
 * vivía en el paquete de entrada: la pantalla de «entrá con tu correo» y la cara bajaban el motor
 * de mapas completo antes de enseñarse, en un teléfono en el campo. Ahora el motor va en su propio
 * trozo y se pide al montar el mapa (App.tsx, `lazy`).
 *
 * Para eso, lo que Panel y Barra importaban de `Mapa.tsx` —los tipos y la foto para el informe—
 * vive aquí, que no toca `maplibre-gl`. Si Panel siguiera importando de `Mapa.tsx`, Vite volvería a
 * meter MapLibre en el paquete de entrada y la separación no serviría de nada.
 */
import type { Geometry, FeatureCollection } from 'geojson';

export type Motor = 'maplibre' | 'google';
export type Fondo = 'satelite' | 'calles';

/**
 * Lo que tapa el mapa por cada lado (px): el cuadro del recorrido, la ficha. Con margen, la cámara
 * encuadra en lo que queda libre en vez de en el centro de la pantalla. Sin margen, no lo toca.
 */
export type Margen = { arriba: number; abajo: number; izquierda: number; derecha: number };

export type OrdenMapa =
  | { accion: 'volar'; geojson: Geometry; encuadre?: [number, number, number, number]; centro?: [number, number]; margen?: Margen }
  | { accion: 'capa'; geojson: FeatureCollection; encuadre?: [number, number, number, number] }
  /** Varias concesiones resaltadas a la vez (una búsqueda con varios resultados); el catastro sigue debajo. */
  | { accion: 'candidatas'; geojson: FeatureCollection; encuadre?: [number, number, number, number] }
  | { accion: 'punto'; punto: [number, number] }
  /** Un movimiento de cámara de presentación: centro, zoom, inclinación y giro, a la velocidad pedida. */
  | { accion: 'camara'; centro: [number, number]; zoom: number; inclinacion?: number; giro?: number; ms?: number; margen?: Margen }
  /** Encuadrar un rectángulo (Honduras entera, una región), con inclinación opcional. */
  | { accion: 'encuadrar'; encuadre: [number, number, number, number]; inclinacion?: number; giro?: number; ms?: number; margen?: Margen }
  /** Girar la cámara alrededor de donde mira (o de `centro`), a velocidad pareja: la toma de dron. */
  | { accion: 'orbitar'; grados: number; ms: number; centro?: [number, number]; zoom?: number; inclinacion?: number; margen?: Margen }
  /** Ir a un lugar de Honduras («llévame a Juticalpa») y dejarlo marcado con su nombre. */
  | { accion: 'lugar'; centro: [number, number]; zoom: number; nombre: string; detalle?: string }
  /** Dejar en el mapa solo las concesiones de un mineral o una clase (null: todas otra vez). */
  | { accion: 'filtrar'; mineral: string | null };

/** Lo que se tocó en el mapa: una concesión, un rasgo de una capa encendida, o un punto cualquiera. */
export type Tocado =
  | { tipo: 'concesion'; id: number; nombre?: string; lngLat: [number, number] }
  | { tipo: 'rasgo'; eid: number; nombre?: string; lngLat: [number, number] }
  | { tipo: 'muestra'; id: number; nombre?: string; lngLat: [number, number] }
  | { tipo: 'punto'; lngLat: [number, number] };

export type RolVisible =
  | 'departamento'
  | 'litologia'
  | 'falla'
  | 'tracto_permisivo'
  | 'ocurrencia'
  | 'area_protegida'
  | 'microcuenca'
  | 'zona_informal'
  | 'forestal'
  | 'provincia_geologica'
  | 'placa'
  | 'municipio'
  | 'proyecto'
  | 'historico';

/** Una capa encendida encima del catastro (geología, fallas, áreas protegidas…). */
export type CapaExtra = { id: number; nombre: string; rol: RolVisible; geojson: FeatureCollection };

/** Un mapa escaneado y georreferenciado (JICA…), servido en teselas raster desde el cubo. */
export type RasterEscaneado = {
  clave: string;
  nombre: string;
  fuente?: string;
  escala?: string;
  encuadre: [number, number, number, number];
  zoomMax?: number;
  notas?: string;
  /** Sección del control de capas («Mapas escaneados» si no dice). */
  grupo?: string;
  /** Qué quiere decir cada color, para las capas calculadas (Sentinel-2). */
  leyenda?: Array<{ color: string; texto: string }>;
  /** Teselas vectoriales (curvas de nivel, ríos, fallas, caseríos): capa, color, rótulo, maestras, líneas o puntos y desde qué zoom. */
  vector?: { capa: string; color?: string; etiqueta?: string; maestra?: string; tipo?: 'linea' | 'punto'; desde?: number };
};
/** Un mapa escaneado encendido, con la transparencia que se le dio. */
export type RasterEncendido = RasterEscaneado & { opacidad: number };

/** Lo mínimo del mapa de MapLibre que usa la captura. */
type MapaVivo = {
  getCanvas: () => HTMLCanvasElement;
  once: (evento: 'idle', fn: () => void) => unknown;
  triggerRepaint?: () => void;
};

/** El mapa que está en pantalla ahora mismo, y con qué motor. Null cuando no hay ninguno montado. */
let vivo: { m: MapaVivo | null; motor: Motor } | null = null;

/** Lo llama `Mapa.tsx` al montar y al desmontar cada motor. */
export function fijarMapaVivo(v: { m: MapaVivo | null; motor: Motor } | null) {
  vivo = v;
}

/** ¿Es este el mapa registrado? Para no borrar el de otro motor al desmontar uno viejo. */
export function esMapaVivo(m: unknown): boolean {
  return !!vivo && vivo.m === m;
}

export type Captura = { imagen: string } | { falta: string };

/**
 * La foto del mapa para el informe.
 *
 * El servidor no puede hacer esta captura: el encuadre, el zoom y las capas encendidas son de quien
 * está mirando, no del servidor. Por eso el lienzo se crea con `preserveDrawingBuffer` — sin eso,
 * WebGL descarta el búfer tras pintar y `toDataURL` devuelve un rectángulo negro.
 *
 * JPEG y no PNG porque el PDF incrusta los datos de un JPEG tal cual, sin recodificar nada.
 *
 * Es asíncrona, y no por capricho. Antes se llamaba a `triggerRepaint()` y se leía el lienzo **en
 * la línea siguiente**: `triggerRepaint` solo PIDE un cuadro nuevo, no lo dibuja, así que lo que se
 * leía era el cuadro anterior. Con el mapa quieto no se nota; justo después de volar a una
 * concesión —que es cuando alguien pide el informe— se llevaba la vista de antes. Ahora se espera
 * a que el mapa diga que terminó (`idle`), con un tope por si las teselas no paran de reintentar.
 *
 * Y cuando no se puede, se dice cuál es el motivo en vez de devolver un hueco. Un informe sin mapa
 * y sin explicación parece un informe roto; uno que dice «el mapa no entró porque estás en Google»
 * es un informe honesto.
 */
export async function capturaDelMapa(): Promise<Captura> {
  if (!vivo) return { falta: 'No había mapa montado cuando pedí la foto.' };
  if (vivo.motor !== 'maplibre') {
    /*
     * Google Maps se compone en el DOM con teselas de otro dominio: su lienzo no se puede leer
     * desde la página, y forzarlo daría una imagen en blanco o una excepción de seguridad. No hay
     * arreglo desde aquí, así que se dice — antes, simplemente, salía el informe sin mapa.
     */
    return { falta: 'Con el mapa de Google no puedo sacar la foto: sus teselas vienen de otro dominio y el navegador no me deja leer el lienzo. Cambiá a MapLibre y te lo armo con mapa.' };
  }
  const m = vivo.m;
  const lienzo = m?.getCanvas?.();
  if (!lienzo || !lienzo.width || !lienzo.height) return { falta: 'El mapa todavía no tenía nada dibujado.' };

  // Esperar un cuadro DE VERDAD. `idle` llega cuando no queda nada por cargar ni por pintar.
  await new Promise<void>((resolver) => {
    let hecho = false;
    if (!m) return resolver();
    const fin = () => {
      if (hecho) return;
      hecho = true;
      resolver();
    };
    m.once('idle', fin);
    m.triggerRepaint?.();
    // Si una tesela falla y se reintenta sola, `idle` puede no llegar nunca.
    setTimeout(fin, 1500);
  });

  try {
    const url = lienzo.toDataURL('image/jpeg', 0.82);
    if (!url.startsWith('data:image/jpeg') || url.length < 2000) {
      return { falta: 'La foto del mapa salió vacía. Probá otra vez cuando termine de cargar.' };
    }
    return { imagen: url };
  } catch (e: any) {
    return { falta: `No pude leer el lienzo del mapa (${String(e?.message || e).slice(0, 80)}).` };
  }
}

/**
 * El catastro que está pintado, para quien necesita mirarlo entero sin volver a bajarlo (el
 * recorrido busca en él la zona con más información). Lo guarda `App` al recibirlo.
 */
let catastro: { type: 'FeatureCollection'; features: Array<{ geometry: any; properties: Record<string, any> }> } | null = null;
export function guardarCatastro(fc: unknown) {
  catastro = fc && typeof fc === 'object' && Array.isArray((fc as any).features) ? (fc as any) : null;
}
export function catastroGuardado() {
  return catastro;
}
