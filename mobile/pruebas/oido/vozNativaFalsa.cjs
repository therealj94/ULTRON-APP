// El reproductor en streaming (modules/aura-voz, AuraVozModule + Reproductor.kt) de mentira, con el reloj de la
// prueba: la misma cara para JS (encolar/soltar/cancelar/parar + `onVoz`) y las mismas reglas que el Kotlin:
//
//  · encolar(id, url, cabeceras, {esperar, prebufferMs}) empieza a «bajar» ya: a los `ttfbMs` llega el primer byte y
//    la voz llega `velocidad` veces más rápido que lo que dura. «listo» al juntar el prebúfer, «bajado» al final;
//  · suena la primera de la cola SOLTADA y con prebúfer; la que sigue, si ya está soltada y con prebúfer, empieza en el
//    mismo milisegundo en que termina la anterior (sin hueco), como en la pista de verdad;
//  · «sonando» al empezar, «posicion» cada 33 ms (con el volumen de `nivel(texto, ms)`), «termino» al final;
//  · cancelar la que suena la calla en el acto; la que estaba escrita detrás de otra que suena corta a esa
//    («termino» cortada, como cortarPista); parar() calla todo sin avisos;
//  · `falla(texto)` → { codigo, status, motivo } hace fallar esa frase ANTES de sonar (como falloAntes).
'use strict';

const textoDe = (u) => decodeURIComponent((/[?&]text=([^&]*)/.exec(u) || [])[1] || '');

function crear(o = {}) {
  const cfg = {
    ttfbMs: 250,
    velocidad: 4,
    msPorLetra: 20,
    nivel: () => 0.1,
    falla: () => null,
    encolarLanza: false,
    ...o,
  };
  const oyentes = new Set();
  const cola = [];
  /** Lo que sonó: { id, texto, inicio, fin, cortada } con la hora del reloj de la prueba. */
  const sonados = [];
  const llamadas = [];
  let sonando = null;
  let tic = null;

  const avisar = (e) => {
    for (const f of [...oyentes]) f(e);
  };
  const ahora = () => Date.now();

  function mirar() {
    if (sonando) return;
    const f = cola.find((x) => !x.cancelada && !x.terminada);
    if (!f || !f.soltada || !f.listo) return;
    empezar(f, ahora());
  }

  function empezar(f, t) {
    sonando = f;
    f.inicio = t;
    const reg = { id: f.id, texto: f.texto, inicio: t, fin: null, cortada: false };
    f.reg = reg;
    sonados.push(reg);
    avisar({ tipo: 'sonando', id: f.id });
    clearInterval(tic);
    tic = setInterval(() => {
      if (sonando !== f) return;
      const ms = ahora() - f.inicio;
      if (ms >= f.dur) return terminar(f);
      avisar({ tipo: 'posicion', id: f.id, ms, nivel: cfg.nivel(f.texto, ms) });
    }, 33);
    f.fin = setTimeout(() => terminar(f), f.dur);
  }

  function terminar(f, cortada = false) {
    if (f.terminada) return;
    f.terminada = true;
    clearTimeout(f.fin);
    if (sonando === f) {
      sonando = null;
      clearInterval(tic);
    }
    const ms = Math.min(f.dur, ahora() - f.inicio);
    if (f.reg) {
      f.reg.fin = ahora();
      f.reg.cortada = cortada;
    }
    const i = cola.indexOf(f);
    if (i >= 0) cola.splice(i, 1);
    avisar({ tipo: 'termino', id: f.id, ms, ...(cortada ? { cortada: true } : {}) });
    // Pegada: la siguiente ya soltada y con prebúfer arranca en este mismo milisegundo.
    const sig = cola.find((x) => !x.cancelada && !x.terminada);
    if (!cortada && sig && sig.soltada && sig.listo) empezar(sig, ahora());
    else mirar();
  }

  const modulo = {
    disponible: () => true,
    version: () => 1,
    encolar(id, url, cabeceras, opciones) {
      llamadas.push(['encolar', id, textoDe(url), { ...opciones }, { ...cabeceras }]);
      if (cfg.encolarLanza) throw new Error('el puente se cayó');
      const texto = textoDe(url);
      const dur = Math.max(300, texto.length * cfg.msPorLetra);
      const f = { id, url, texto, dur, soltada: !opciones?.esperar, listo: false, cancelada: false, terminada: false, timers: [] };
      cola.push(f);
      const fallo = cfg.falla(texto);
      if (fallo) {
        f.timers.push(
          setTimeout(() => {
            if (f.cancelada) return;
            f.cancelada = true;
            const i = cola.indexOf(f);
            if (i >= 0) cola.splice(i, 1);
            avisar({ tipo: 'error', id, ...fallo });
            mirar();
          }, cfg.ttfbMs)
        );
        return true;
      }
      const pre = Math.min(dur, opciones?.prebufferMs ?? 150);
      f.timers.push(
        setTimeout(() => {
          if (f.cancelada) return;
          f.listo = true;
          avisar({ tipo: 'listo', id, hz: 22050 });
          mirar();
        }, cfg.ttfbMs + pre / cfg.velocidad)
      );
      f.timers.push(setTimeout(() => !f.cancelada && avisar({ tipo: 'bajado', id, ms: dur }), cfg.ttfbMs + dur / cfg.velocidad));
      return true;
    },
    soltar(id) {
      llamadas.push(['soltar', id]);
      const f = cola.find((x) => x.id === id);
      if (f) f.soltada = true;
      mirar();
    },
    cancelar(id) {
      llamadas.push(['cancelar', id]);
      const f = cola.find((x) => x.id === id);
      if (!f) return;
      f.cancelada = true;
      for (const t of f.timers) clearTimeout(t);
      cola.splice(cola.indexOf(f), 1);
      if (sonando === f) {
        clearTimeout(f.fin);
        clearInterval(tic);
        sonando = null;
        f.reg.fin = ahora();
        f.reg.cortada = true;
        mirar();
      }
    },
    parar() {
      llamadas.push(['parar']);
      for (const f of cola) {
        f.cancelada = true;
        for (const t of f.timers) clearTimeout(t);
        clearTimeout(f.fin);
        if (f.reg && f.reg.fin === null) {
          f.reg.fin = ahora();
          f.reg.cortada = true;
        }
      }
      cola.length = 0;
      clearInterval(tic);
      sonando = null;
    },
    addListener(evento, cb) {
      if (evento !== 'onVoz') return { remove() {} };
      oyentes.add(cb);
      return { remove: () => oyentes.delete(cb) };
    },
  };
  return { modulo, cfg, cola, sonados, llamadas, sonandoAhora: () => sonando };
}

module.exports = { crear, textoDe };
