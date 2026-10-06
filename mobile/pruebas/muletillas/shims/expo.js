// `expo` simulado: solo el micrófono crudo de AU-RA (modules/aura-mic), con la misma forma que el módulo de Kotlin:
// empezar/parar, los eventos onTrozo/onFallo y, desde la APK de las muletillas, ecoDisponible/ecoActivo.
'use strict';
const m = require('./mundo.js');

const oyentes = { onTrozo: new Set(), onFallo: new Set() };
m.alTrozo = (t) => {
  for (const f of oyentes.onTrozo) f(t);
};

const AuraMic = {
  disponible: () => true,
  ecoDisponible: () => m.ecoDisponible,
  // Como AcousticEchoCanceler.getEnabled(): con la fuente de llamada siempre; con la de dictado, si el teléfono deja.
  ecoActivo: () => m.ecoDisponible && (m.grabando === 'llamada' || (m.grabando === 'reconocimiento_eco' && m.ecoPegaEnDictado)),
  empezar: async (_frecuencia, _trozoMs, fuente) => {
    m.fuentes.push(fuente);
    m.grabando = fuente;
    return true;
  },
  parar: () => {
    m.grabando = null;
  },
  addListener: (evento, cb) => {
    oyentes[evento].add(cb);
    return { remove: () => oyentes[evento].delete(cb) };
  },
};

module.exports = { requireOptionalNativeModule: (nombre) => (nombre === 'AuraMic' ? AuraMic : null) };
