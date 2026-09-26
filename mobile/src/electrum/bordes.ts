/**
 * LOS BORDES DE LA PANTALLA QUE TAPA EL SISTEMA.
 *
 * Expo 54 dibuja la app de borde a borde en Android (edge-to-edge, sin opción de apagarlo): la
 * barra de estado y la de navegación quedan ENCIMA de la app. Sin márgenes, la marca y los botones
 * VOZ/SALIR caían bajo la hora y la batería, y la caja de la pregunta y el botón «Ir» bajo los tres
 * botones del sistema — donde no se ven ni se pueden tocar.
 *
 * El proyecto no trae `react-native-safe-area-context` (es de AU-RA y AU-RA esconde las barras), así
 * que esto se arregla con lo que React Native da:
 *
 *  · ARRIBA, `StatusBar.currentHeight`: React Native la lee de los insets reales de la ventana
 *    (barra de estado + recorte de la cámara), así que es exacta.
 *  · ABAJO y a los LADOS no hay API. Hasta Android 14 la ventana que informa React Native (las
 *    métricas de `Resources`) excluye la barra de navegación, así que `pantalla − ventana` la mide.
 *    Desde Android 15 las dos miden lo mismo y no queda nada que medir: se reserva lo que ocupa la
 *    barra de TRES BOTONES (48 dp), que es la de fábrica en los Samsung —los más comunes en el
 *    campo— y la más alta. Con navegación por gestos sobran unos 24 dp abajo, que es mejor que
 *    tapar el botón de mandar.
 *  · En HORIZONTAL la barra de tres botones se va a un costado y el recorte de la cámara al otro,
 *    y sin insets no se sabe cuál es cuál: se reserva lo mismo a los dos lados.
 *
 * Este archivo no importa React Native (se prueba con node:test); el gancho que lo lee está en
 * `useBordes.ts`.
 */

export type Bordes = { arriba: number; abajo: number; izquierda: number; derecha: number };

export type Medidas = {
  os: string;
  /** `StatusBar.currentHeight` (solo Android; `undefined` en el resto). */
  barraEstado?: number | null;
  ventana: { width: number; height: number };
  pantalla: { width: number; height: number };
};

/** Lo que mide la barra de navegación de tres botones (dp). */
export const BARRA_NAVEGACION = 48;
/** La barra de estado típica, si React Native no la informó. */
export const BARRA_ESTADO = 24;
/** En horizontal con gestos, la manija de abajo. */
const MANIJA = 16;

const SIN_BORDES: Bordes = { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 };

/** Lo que sobra entre pantalla y ventana, dentro de lo razonable (una barra, no media pantalla). */
function sobra(pantalla: number, ventana: number): number {
  const d = Math.round(pantalla - ventana);
  return d > 0 && d <= 2 * BARRA_NAVEGACION ? d : 0;
}

export function calcularBordes(m: Medidas): Bordes {
  // La app del doctor se publica solo como APK. En iOS (sin identificador en app.json, no se
  // construye) y en la web no se inventan márgenes.
  if (m.os !== 'android') return SIN_BORDES;

  const arriba = m.barraEstado && m.barraEstado > 0 ? Math.round(m.barraEstado) : BARRA_ESTADO;
  const apaisado = m.ventana.width > m.ventana.height;
  const bajo = sobra(m.pantalla.height, m.ventana.height);
  const lado = sobra(m.pantalla.width, m.ventana.width);
  // ¿Android informó una ventana más chica que la pantalla? Entonces la diferencia ES la barra.
  const medido = bajo > 0 || lado > 0;

  if (!apaisado) {
    return { arriba, abajo: medido ? bajo : BARRA_NAVEGACION, izquierda: 0, derecha: 0 };
  }
  // En horizontal el recorte de la cámara cae a un costado: como mínimo, lo que mide arriba.
  const costado = Math.max(medido ? lado : BARRA_NAVEGACION, arriba);
  return { arriba, abajo: medido ? bajo : MANIJA, izquierda: costado, derecha: costado };
}
