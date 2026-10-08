// ../ui de mentira: la hoja usa Texto, Boton, Hoja y vibrar. Cada uno es una etiqueta con lo que la prueba necesita mirar o
// tocar: el texto, el título del botón (y su onPress / si está deshabilitado), y la hoja solo si está visible.
const React = require('react');
const h = React.createElement;

const vibraciones = (globalThis.__vibraciones = globalThis.__vibraciones || []);

function Texto({ children, v, color, centro, style, ...rest }) {
  return h('Text', { ...rest, v, color }, children);
}

function Boton({ titulo, onPress, variante = 'principal', cargando, deshabilitado, tam }) {
  return h('Boton', { titulo, variante, tam, cargando: !!cargando, deshabilitado: !!(deshabilitado || cargando), onPress: deshabilitado || cargando ? undefined : onPress }, h('Text', null, titulo));
}

function Hoja({ visible, onCerrar, titulo, subtitulo, children, pie }) {
  if (!visible) return null;
  return h('Hoja', { titulo, subtitulo, onCerrar }, titulo ? h('Text', { rol: 'titulo' }, titulo) : null, subtitulo ? h('Text', { rol: 'subtitulo' }, subtitulo) : null, children, pie || null);
}

module.exports = { Texto, Boton, Hoja, vibrar: (t) => vibraciones.push(t) };
