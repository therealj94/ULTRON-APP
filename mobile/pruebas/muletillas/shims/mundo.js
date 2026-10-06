// El mundo de mentira de las muletillas: el micrófono crudo (modules/aura-mic) con su cancelador de eco, la bocina
// (lo que suena se cuela al micrófono mientras dura), /api/tts con la voz de cada avatar, el disco y la red.
'use strict';

const m = (globalThis.__mul = globalThis.__mul || {});
/** El micrófono: con qué fuentes se abrió, cuál graba ahora y a quién le entrega los trozos. */
m.fuentes = [];
m.grabando = null;
m.alTrozo = null;
/** ¿El teléfono tiene cancelador de eco? ¿Se deja pegar a la fuente de dictado? */
m.ecoDisponible = true;
m.ecoPegaEnDictado = true;
/** /api/tts: lo pedido (texto, avatar, idioma) y con qué voz contesta el servidor. */
m.tts = [];
m.motorTts = 'elevenlabs-v3';
/** Cuánto dura cada palabra dicha (ms): un «Mjm.» bien dicho, cortito. */
m.duracionDe = (texto) => ({ 'Mjm.': 380, 'Ajá.': 420, 'Ya.': 300, 'Okey.': 400, 'Mm-hmm.': 400, 'Yeah.': 330, 'Right.': 350, 'Okay.': 420 })[texto] || 900;
/** El disco: ruta → lo que hay (el texto dicho y con qué voz). */
m.archivos = new Map();
/** Lo que sonó por el canal de efectos (los clips) y hasta cuándo suena la bocina. */
m.sonidos = [];
m.bocinaHasta = 0;
m.callados = 0;
/** GET /api/movil/config. */
m.config = { camaraRapida: { activa: true }, asentir: { activo: true }, honesto: true };
m.pedidosConfig = 0;
/** AsyncStorage en memoria. */
m.disco = new Map();

module.exports = m;
