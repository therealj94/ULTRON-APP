// ../ui de mentira: el visor solo usa Texto (un Text con sus hijos) y vibrar (nada en node).
const React = require('react');

function Texto({ children, v, color, centro, style, ...rest }) {
  return React.createElement('Text', rest, children);
}

module.exports = { Texto, vibrar: () => {} };
