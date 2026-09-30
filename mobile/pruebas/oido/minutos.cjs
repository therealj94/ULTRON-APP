// [minutos] CUÁNTO SE COBRA LA LLAMADA DEL AVATAR (compa/llamadaCiclo.ts, el real).
//
// El uso de José: «hablamos bastante al principio y luego lo dejamos». Sesión simulada de 25 min:
//   · 0 s: «llámame» → suena 4 s → contesta;
//   · 0–5 min: charla intensa (una frase suya cada ~20 s, el avatar contesta ~6 s);
//   · 5–25 min: deja el teléfono SIN COLGAR (el peor caso), con dos órdenes sueltas a la mesa a los 12 y
//     19 min (ya colgó sola: las resuelve el camino rápido de la mesa, sin llamada).
// Se compara con «sin protección» (la sesión abierta hasta el final) y con colgar a mano a los 5 min.
// Fuera de la llamada no hay sesión de ElevenLabs (ni escucha para despertar): cero minutos.
'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const M = require(process.env.OIDO || path.join(__dirname, 'out/oido.cjs'));
if (!M.CICLO || typeof M.CICLO.CicloLlamada.prototype.llamar !== 'function') {
  console.log('[minutos] este código no tiene la llamada del avatar («llámame»): falla');
  process.exit(1);
}
const { CicloLlamada } = M.CICLO;

function simular({ cuelgaA = null, sinProteccion = false } = {}) {
  let t = 0;
  const c = new CicloLlamada({ reloj: () => t, idioma: () => 'es', ...(sinProteccion ? { preguntaMs: 1e12 } : {}) });
  const cola = [];
  const en = (ms, f) => cola.push({ ms, f });
  const efectos = [];
  const ejecutar = (ef) => {
    for (const e of ef) {
      efectos.push(e.tipo);
      // La sesión: conecta ~1,2 s después de abrirla; al cerrar, se da por cerrada enseguida.
      if (e.tipo === 'abrir') en(t + 1200, () => ejecutar(c.conectado()));
      if (e.tipo === 'cerrar') en(t + 300, () => ejecutar(c.cerrada()));
      // «¿Sigues ahí?»: el avatar lo dice (~1,5 s); nadie contesta (el teléfono quedó en la mesa).
      if (e.tipo === 'sigues') {
        en(t + 800, () => ejecutar(c.agente(true)));
        en(t + 2300, () => ejecutar(c.agente(false)));
      }
    }
  };
  const decir = (frase) => {
    if (c.estado() !== 'en_llamada') return;
    ejecutar(c.turnoUsuario(frase));
    en(t + 1000, () => ejecutar(c.agente(true)));
    en(t + 7000, () => ejecutar(c.agente(false)));
  };
  ejecutar(c.llamar({ tipo: 'llamame' }));
  en(4000, () => ejecutar(c.contestar()));
  for (let s = 20; s < 300; s += 20) en(s * 1000, () => decir('y entonces, ¿qué más me cuentas de eso?'));
  if (cuelgaA) en(cuelgaA, () => ejecutar(c.colgar()));
  const FIN = 25 * 60_000;
  const estados = {};
  let antes = c.estado();
  let desde = 0;
  while (t < FIN) {
    cola.sort((a, b) => a.ms - b.ms);
    while (cola.length && cola[0].ms <= t) cola.shift().f();
    ejecutar(c.tic());
    if (c.estado() !== antes) {
      estados[antes] = (estados[antes] || 0) + (t - desde);
      antes = c.estado();
      desde = t;
    }
    t += 250;
  }
  estados[antes] = (estados[antes] || 0) + (t - desde);
  return { conectadoMs: c.usadoMs(), estados, efectos, motivo: c.motivo() };
}

const min = (ms) => (ms / 60_000).toFixed(1);
const olvida = simular();
const aMano = simular({ cuelgaA: 5 * 60_000 + 10_000 });
const sin = simular({ sinProteccion: true });
console.log('[minutos] «llámame» + 5 min de charla intensa, y el teléfono queda SIN COLGAR 20 min:');
console.log(`[minutos]   sin protección: ${min(sin.conectadoMs)} min de ElevenLabs`);
console.log(`[minutos]   con «¿sigues ahí?» (3 min + 20 s): ${min(olvida.conectadoMs)} min (${Math.round((1 - olvida.conectadoMs / sin.conectadoMs) * 100)} % menos) · colgó por ${olvida.motivo}`);
console.log(`[minutos]   si cuelga a mano a los 5:10: ${min(aMano.conectadoMs)} min · en reposo ${min(aMano.estados.reposo || 0)} min sin gastar (sin sesión ni escucha)`);
assert.equal(olvida.motivo, 'silencio');
assert.ok(olvida.efectos.includes('sigues'), 'preguntó «¿sigues ahí?» antes de colgar');
assert.ok(olvida.conectadoMs <= 9 * 60_000, `conectado ${min(olvida.conectadoMs)} min`);
assert.ok(olvida.conectadoMs >= 8 * 60_000, 'la charla de 5 min y los 3 min de gracia sí van en llamada');
assert.ok(aMano.conectadoMs <= 5.3 * 60_000);
assert.ok(sin.conectadoMs > 24 * 60_000);
console.log('\nminutos bien');
