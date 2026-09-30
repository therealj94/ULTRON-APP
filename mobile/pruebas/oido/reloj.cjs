// Un reloj de mentira para el arnés del oído: setTimeout/setInterval/Date.now avanzan solo cuando la
// prueba lo pide (`avanzar(ms)`), en orden, dejando correr las promesas entre un temporizador y otro.
// Así «8 s sin señales de vida» o «12 s conectando» se prueban en milisegundos y siempre igual.
'use strict';

const real = { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, now: Date.now };
let ahora = 1_000_000;
let sec = 0;
/** id → { cuando, f, cada } */
const timers = new Map();

function poner(f, ms, cada) {
  const id = ++sec;
  timers.set(id, { cuando: ahora + Math.max(0, Number(ms) || 0), f, cada, orden: id });
  return { id, unref() { return this; }, ref() { return this; }, hasRef: () => true, [Symbol.toPrimitive]: () => id };
}
function quitar(t) {
  if (t == null) return;
  timers.delete(typeof t === 'object' ? t.id : Number(t));
}

globalThis.setTimeout = (f, ms, ...a) => poner(() => f(...a), ms, 0);
globalThis.clearTimeout = quitar;
globalThis.setInterval = (f, ms, ...a) => poner(() => f(...a), ms, Math.max(1, Number(ms) || 1));
globalThis.clearInterval = quitar;
Date.now = () => ahora;

/** Deja correr las promesas pendientes (varias vueltas: async/await encadena muchas). */
async function vaciar() {
  for (let i = 0; i < 20; i++) await new Promise((r) => real.setImmediate(r));
}

/** Avanza el reloj `ms`, disparando en orden todo lo que venza. */
async function avanzar(ms) {
  const fin = ahora + ms;
  await vaciar();
  for (;;) {
    let prox = null;
    for (const [id, t] of timers) if (t.cuando <= fin && (!prox || t.cuando < prox[1].cuando || (t.cuando === prox[1].cuando && t.orden < prox[1].orden))) prox = [id, t];
    if (!prox) break;
    const [id, t] = prox;
    ahora = Math.max(ahora, t.cuando);
    if (t.cada) {
      t.cuando = ahora + t.cada;
      t.orden = ++sec;
    } else timers.delete(id);
    try {
      t.f();
    } catch (e) {
      console.error('temporizador falló:', e);
    }
    await vaciar();
  }
  ahora = fin;
  await vaciar();
}

module.exports = { avanzar, vaciar, ahora: () => ahora, real };
