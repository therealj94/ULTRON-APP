// react-native de mentira para montar las pestañas de los chats en node: cada primitivo es una ETIQUETA (un nodo del
// árbol de ../visor/montar.js). El deslizador (ScrollView) anota cada `scrollTo` que le piden, y el ancho de la
// ventana lo cambia la prueba (girar el teléfono) por globalThis.__rnChats.
const React = require('react');

const rn = (globalThis.__rnChats = globalThis.__rnChats || { ancho: 412, alto: 915, oyentes: new Set(), desplazamientos: [] });

const etiqueta = (nombre) => nombre;

/** El deslizador: una etiqueta con sus props, y un `scrollTo` que queda anotado (la última posición = lo que se ve). */
const ScrollView = React.forwardRef(function ScrollView(props, ref) {
  React.useImperativeHandle(ref, () => ({
    scrollTo: (o) => rn.desplazamientos.push({ x: o?.x ?? 0, animado: o?.animated !== false }),
  }));
  return React.createElement('ScrollView', props);
});

function useWindowDimensions() {
  const medir = () => `${rn.ancho}x${rn.alto}`;
  React.useSyncExternalStore(
    (f) => {
      rn.oyentes.add(f);
      return () => rn.oyentes.delete(f);
    },
    medir,
    medir
  );
  return { width: rn.ancho, height: rn.alto, scale: 2.625, fontScale: 1 };
}

module.exports = {
  View: etiqueta('View'),
  Text: etiqueta('Text'),
  Pressable: etiqueta('Pressable'),
  ScrollView,
  useWindowDimensions,
  StyleSheet: { create: (o) => o, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 0.5, flatten: (s) => s },
  Platform: { OS: 'android', Version: 34, select: (o) => o.android ?? o.default },
  Appearance: { getColorScheme: () => 'dark', addChangeListener: () => ({ remove() {} }) },
  useColorScheme: () => 'dark',
};
