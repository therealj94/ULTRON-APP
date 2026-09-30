// [minutos] CUÁNTO SE COBRA UNA SESIÓN TÍPICA CON EL CICLO DE LA LLAMADA (compa/llamadaCiclo.ts, el real).
//
// El uso de José: «hablamos bastante al principio y luego lo dejamos». Sesión simulada de 25 min:
//   · 0–5 min: charla intensa (una frase suya cada ~20 s, ella contesta ~6 s);
//   · 5–25 min: silencio, con dos órdenes sueltas («Aura, apaga la cámara» a los 12 min y «Aura, abre
//     mis chats» a los 19 min), que el camino rápido resuelve sin conectar la llamada.
// Se compara con «siempre conectado» (la sesión abierta todo el rato con la app delante) y con lo que
// costaría si cada orden suelta abriera la llamada y colgara por silencio.
'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const M = require(process.env.OIDO || path.join(__dirname, 'out/oido.cjs'));
if (!M.CICLO) {
  console.log('[minutos] este código no tiene el ciclo de la llamada (main): siempre conectado mientras se habla = 25 min en la sesión típica');
  process.exit(1);
}
const { CicloLlamada } = M.CICLO;

function simular({ ordenesAbrenLlamada = false } = {}) {
  let t = 0;
  const c = new CicloLlamada({ reloj: () => t, nombre: () => 'AU-RA', idioma: () => 'es' });
  const cola = [];
  const en = (ms, f) => cola.push({ ms, f });
  const ejecutar = (ef) => {
    for (const e of ef) {
      // La sesión: conecta ~1,2 s después de abrirla; al cerrar, se da por cerrada enseguida.
      if (e.tipo === 'abrir') en(t + 1200, () => ejecutar(c.conectado()));
      if (e.tipo === 'cerrar') en(t + 300, () => ejecutar(c.cerrada()));
    }
  };
  const decir = (frase, esOrden) => {
    if (c.estado() === 'en_llamada') {
      ejecutar(c.turnoUsuario(frase));
      en(t + 1000, () => ejecutar(c.agente(true)));
      en(t + 7000, () => ejecutar(c.agente(false)));
      return;
    }
    const d = c.frase(frase, { mesaVisible: true, ruido: 0.1 });
    if (d.tipo !== 'despertar') return;
    if (esOrden && !ordenesAbrenLlamada) return; // el camino rápido la resolvió: sin llamada
    ejecutar(c.despertar(d.resto));
    // Si abrió la llamada por una orden, ella contesta y queda en silencio.
    en(t + 2500, () => ejecutar(c.agente(true)));
    en(t + 5500, () => ejecutar(c.agente(false)));
  };
  c.encender();
  // 5 min de charla intensa.
  decir('Aura, hola, ¿cómo va todo?', false);
  for (let s = 20; s < 300; s += 20) en(s * 1000, () => decir('y entonces, ¿qué más me cuentas de eso?', false));
  en(12 * 60_000, () => decir('Aura, apaga la cámara', true));
  en(19 * 60_000, () => decir('Aura, abre mis chats', true));
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
  return { conectadoMs: c.usadoMs(), estados };
}

const min = (ms) => (ms / 60_000).toFixed(1);
const ciclo = simular();
const conOrdenes = simular({ ordenesAbrenLlamada: true });
const siempre = 25 * 60_000;
console.log(`[minutos] sesión típica de 25 min (5 min de charla intensa + 20 min de silencio con 2 órdenes sueltas):`);
console.log(`[minutos]   siempre conectado: ${min(siempre)} min de ElevenLabs`);
console.log(`[minutos]   ciclo de la llamada: ${min(ciclo.conectadoMs)} min (${Math.round((1 - ciclo.conectadoMs / siempre) * 100)} % menos) · en espera ${min(ciclo.estados.espera || 0)} min sin gastar`);
console.log(`[minutos]   (si cada orden suelta abriera la llamada: ${min(conOrdenes.conectadoMs)} min; el camino rápido las resuelve sin conectar)`);
assert.ok(ciclo.conectadoMs <= 7 * 60_000, `conectado ${min(ciclo.conectadoMs)} min`);
assert.ok(ciclo.conectadoMs >= 5 * 60_000, 'la charla de 5 min sí va en llamada');
assert.ok(conOrdenes.conectadoMs > ciclo.conectadoMs);
console.log('\nminutos bien');
