// Voz · cómo termina el turno en stream de la mesa (auditoría VOICE01 y VOICE02).
//
//  VOICE01  Un HTTP 200 con deltas que se cierra SIN `done` ni `error` no es una respuesta completa: antes
//           salía como éxito normal. Ahora sale con lo dicho, `parcial: true`, `cierre: 'eof'` y su idTurno
//           (para recuperarla sin correr otro turno). El `done` normal, el `done` con parcial, el `error` y
//           el `done` en el último bloque sin línea en blanco quedan cada uno con su cierre.
//  VOICE02  El servidor corrige lo dicho con `replace` (el texto entero hasta ahí). Antes el parser lo
//           ignoraba: la pantalla y la voz se quedaban con lo preliminar. Ahora avisa (`onReplace`) y la
//           respuesta sigue desde lo corregido.
// Con un XMLHttpRequest de mentira: nada sale del proceso.
const { ok, fin } = require('../chat/comun.cjs');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;

(async () => {
  const M = require('./paquete.cjs')();
  const { API, CUENTA } = M;
  const mesa = globalThis.__mesa;
  CUENTA.fijarCuenta('a@prueba.local', { nueva: true });
  mesa.token = 'tok-A';
  globalThis.fetch = async () => new Response('{}', { status: 200 });

  const xhrs = [];
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.cab = {};
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      xhrs.push(this);
    }
    open(_m, u) {
      this.u = u;
    }
    setRequestHeader(k, v) {
      this.cab[k] = v;
    }
    send(p) {
      this.payload = p;
    }
    abort() {}
    // Lo que maneja la prueba:
    llega(t) {
      this.status = 200;
      this.readyState = 3;
      this.responseText += t;
      this.onprogress?.();
    }
    cierra(status = 200) {
      this.status = status;
      this.readyState = 4;
      this.onreadystatechange?.();
    }
  };

  /** Un turno: `guion` escribe en el XHR (después de mandarlo); devuelve el resultado y lo que se avisó. */
  async function turno(guion) {
    const visto = { deltas: [], reemplazos: [] };
    const st = API.turnoStream(
      { message: 'hola', mode: 'conversar', userName: 'Ana', historial: [], idTurno: 'turno-0001' },
      { onDelta: (p) => visto.deltas.push(p), onReplace: (t) => visto.reemplazos.push(t) }
    );
    await espera(10);
    const x = xhrs[xhrs.length - 1];
    guion(x);
    const r = await Promise.race([st.promise.catch((e) => e), espera(500).then(() => 'colgado')]);
    return { r, ...visto };
  }

  console.log('VOICE01 · el cierre del turno\n');
  let t = await turno((x) => {
    x.llega(ev('emocion', { emocion: 'feliz' }) + ev('delta', { text: 'Hola. ', voz: 'Hola. ' }) + ev('delta', { text: 'Todo bien.', voz: 'Todo bien.' }));
    x.llega(ev('done', { reply: 'Hola. Todo bien.', via: 'prueba' }));
    x.cierra();
  });
  ok('done normal: completa, sin parcial', t.r.reply === 'Hola. Todo bien.' && !t.r.parcial && t.r.cierre === 'done', JSON.stringify(t.r));

  t = await turno((x) => {
    x.llega(ev('delta', { text: 'El oro', voz: 'El oro' }) + ev('done', { reply: 'El oro', parcial: true }));
    x.cierra();
  });
  ok('done con parcial del servidor: se conserva parcial', t.r.parcial === true && t.r.cierre === 'done', JSON.stringify(t.r));

  t = await turno((x) => {
    x.llega(ev('delta', { text: 'Déjame ver', voz: 'Déjame ver' }) + ev('error', { error: 'el nodo falló' }));
    x.cierra();
  });
  ok('error tras un delta: lo dicho queda, parcial y con el error', t.r.reply === 'Déjame ver' && t.r.parcial === true && t.r.error === 'el nodo falló' && t.r.cierre === 'error', JSON.stringify(t.r));

  t = await turno((x) => {
    x.llega(ev('delta', { text: 'El oro está a', voz: 'El oro está a' }));
    x.cierra();
  });
  ok('VOICE01 · 200 con deltas y cierre SIN done: no es completa (parcial)', t.r.parcial === true, JSON.stringify(t.r));
  ok('…conserva lo dicho', t.r.reply === 'El oro está a' && t.r.voz === 'El oro está a');
  ok('…dice cómo terminó (eof) y lleva un error que lo explica', t.r.cierre === 'eof' && !!t.r.error);
  ok('…y lleva el idTurno para recuperarla sin otro turno', t.r.idTurno === 'turno-0001');

  t = await turno((x) => x.cierra());
  ok('200 sin nada: falla (el llamador cae al JSON)', t.r instanceof Error, String(t.r));

  t = await turno((x) => {
    x.llega(ev('delta', { text: 'Listo.', voz: 'Listo.' }) + 'event: done\ndata: {"reply":"Listo.","via":"ultimo-bloque"}');
    x.cierra();
  });
  ok('un done en el último bloque sin línea en blanco cuenta como done', t.r.cierre === 'done' && t.r.via === 'ultimo-bloque' && !t.r.parcial, JSON.stringify(t.r));

  console.log('\nVOICE02 · el replace del servidor\n');
  t = await turno((x) => {
    x.llega(ev('delta', { text: 'Déjame ver. ', voz: 'Déjame ver. ' }) + ev('delta', { text: 'El oro está a 3 400.', voz: 'El oro está a 3 400.' }));
    x.llega(ev('replace', { text: 'Déjame ver. El oro está a 3 412 dólares.', voz: 'Déjame ver. El oro está a 3 412 dólares.' }));
    x.llega(ev('delta', { text: ' ¿Algo más?', voz: ' ¿Algo más?' }) + ev('done', { via: 'prueba' }));
    x.cierra();
  });
  ok('VOICE02 · replace avisa a quien habla con el texto corregido', t.reemplazos.length === 1 && t.reemplazos[0] === 'Déjame ver. El oro está a 3 412 dólares.', JSON.stringify(t.reemplazos));
  ok('…y la respuesta sigue desde lo corregido (sin lo preliminar)', t.r.reply === 'Déjame ver. El oro está a 3 412 dólares. ¿Algo más?' && !/3 400/.test(t.r.voz), JSON.stringify(t.r));

  t = await turno((x) => {
    x.llega(ev('delta', { text: 'Lo mandé.', voz: 'Lo mandé.' }) + ev('replace', { text: 'No pude mandarlo.', voz: 'No pude mandarlo.' }));
    x.cierra();
  });
  ok('replace y cierre sin done: parcial con lo corregido', t.r.parcial === true && t.r.reply === 'No pude mandarlo.', JSON.stringify(t.r));

  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
