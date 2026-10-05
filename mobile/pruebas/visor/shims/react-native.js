// react-native de mentira para montar el visor en node: cada primitivo es una ETIQUETA (un nodo del árbol de
// montar.js con sus props). Lo que el visor escucha del sistema (AppState, Alert, el teclado) se dispara a mano
// desde la prueba por globalThis.__rnVisor.
const rn = (globalThis.__rnVisor = globalThis.__rnVisor || { estado: 'active', oyentesApp: new Set(), alertas: [] });

const etiqueta = (nombre) => nombre;

module.exports = {
  Modal: etiqueta('Modal'),
  KeyboardAvoidingView: etiqueta('KeyboardAvoidingView'),
  View: etiqueta('View'),
  Text: etiqueta('Text'),
  Image: etiqueta('Image'),
  Pressable: etiqueta('Pressable'),
  TextInput: etiqueta('TextInput'),
  StyleSheet: { create: (o) => o, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 0.5, flatten: (s) => s },
  Platform: { OS: 'android', Version: 34, select: (o) => o.android ?? o.default },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Keyboard: { addListener: () => ({ remove() {} }), dismiss() {} },
  AppState: {
    get currentState() {
      return rn.estado;
    },
    addEventListener: (_tipo, f) => {
      rn.oyentesApp.add(f);
      return { remove: () => rn.oyentesApp.delete(f) };
    },
  },
  // Lo que pregunta el visor (¿cancelar la tarea?) queda anotado; la prueba decide si toca algún botón.
  Alert: { alert: (titulo, mensaje, botones) => rn.alertas.push({ titulo, mensaje, botones }) },
};
