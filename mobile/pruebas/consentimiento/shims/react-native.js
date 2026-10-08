// react-native de mentira para montar la hoja «Por confirmar» en node: cada primitivo es una ETIQUETA (un nodo del árbol
// de montar.js con sus props). La prueba toca los mandos llamando a sus manejadores reales (onPress).
const rn = (globalThis.__rnConsentimiento = globalThis.__rnConsentimiento || { alertas: [] });

module.exports = {
  Modal: 'Modal',
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (o) => o, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 0.5, flatten: (s) => s },
  Platform: { OS: 'android', Version: 34, select: (o) => o.android ?? o.default },
  Alert: { alert: (titulo, mensaje, botones) => rn.alertas.push({ titulo, mensaje, botones }) },
};
