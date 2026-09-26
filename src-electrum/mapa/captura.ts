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

export type OrdenMapa =
  | { accion: 'volar'; geojson: Geometry; encuadre?: [number, number, number, number]; centro?: [number, number] }
  | { accion: 'capa'; geojson: FeatureCollection; encuadre?: [number, number, number, number] }
  | { accion: 'punto'; punto: [number, number] };

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
