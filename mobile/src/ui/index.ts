/**
 * EL SISTEMA DE DISEÑO DE LA 5.0. Todo toma los colores con `useTema()` y las medidas de `MEDIDA`
 * (src/nucleo/tema.ts), así que cambia de tema en el acto y se ve igual en todas las pantallas.
 *
 *   Texto, estiloLetra, fuente         la escala tipográfica (Manrope + Cormorant para títulos)
 *   Boton                              principal (oro con brillo), secundario, fantasma, peligro
 *   BotonCheck, Palomita               la ✔ animada con háptica (reutilizable por cualquier frente)
 *   Tarjeta, Chip, Campo               superficies y entradas
 *   PantallaConCabecera, BotonRedondo  cabecera grande que colapsa al desplazar
 *   Hoja                               hoja inferior que se arrastra
 *   Grupo, Fila, Segmentado, Interruptor  listas de ajustes
 *   BarraProgreso, Puntos              progreso de pasos y puntos de página
 *   Aparecer                           entrada con resorte (fundido + deslizamiento)
 *   Aura                               el anillo dorado que respira (Skia)
 *   Icono                              íconos de línea (PNG teñidos, sin parpadeo)
 *   vibrar                             la háptica de la app (se apaga en Ajustes)
 */
export { Texto } from './Texto';
export { estiloLetra, fuente, fuenteDisplay, cargarFuentes, useFuentes, ESCALA, type Variante, type Peso } from './tipografia';
export { Boton, oroDe, type VarianteBoton } from './Boton';
export { BotonCheck, Palomita } from './BotonCheck';
export { Tarjeta, sombraDe } from './Tarjeta';
export { Chip } from './Chip';
export { Campo } from './Campo';
export { PantallaConCabecera, BotonRedondo, ALTO_BARRA } from './Cabecera';
export { Hoja } from './Hoja';
export { Grupo, Fila, Segmentado, Interruptor, type OpcionSegmento } from './Lista';
export { BarraProgreso, Puntos } from './Progreso';
export { Aparecer } from './Aparecer';
export { Aura, conAlfa } from './Aura';
export { Icono, FUENTES_ICONOS, type NombreIcono } from './Icono';
export { SelectorIdioma, elegirIdioma } from './SelectorIdioma';
export { vibrar, fijarHapticos, cargarHapticos, useHapticos, hapticosActivos, type Toque } from './hapticos';
