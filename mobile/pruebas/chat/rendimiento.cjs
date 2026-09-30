// A6 · El hilo abierto no vuelve a descifrar lo que ya abrió, no solapa peticiones y no sondea en
// segundo plano.
const { ok, fin, espera, arrancarRelevo, movil, entrarComo } = require('./comun.cjs');
const vm = require('vm');
const fs = require('fs');

const WEB = '/home/user/express-js-on-vercel/apps-web/veta-wallet/candado.js';

(async () => {
  const R = await arrancarRelevo();
  const M = movil();
  console.log('A6 · rendimiento del hilo\n');
  const A = await R.cuenta('Ana');
  const B = await R.cuenta('Beto');
  await R.amigos(B, A);
  await entrarComo(M, A);
  // B manda 120 mensajes CIFRADOS de verdad para el aparato de A (con el candado de la web si está;
  // si no, con el mismo candado del teléfono haciéndose pasar por otro aparato).
  const llA = (await R.post('/llaves/de', { ...B, correos: [A.correo] })).llaves[A.correo];
  let cerrar;
  if (fs.existsSync(WEB)) {
    const caja = { crypto: globalThis.crypto, btoa, atob, TextEncoder, TextDecoder, console, indexedDB: { open() { throw new Error('x'); } } };
    caja.globalThis = caja;
    caja.window = caja;
    vm.createContext(caja);
    vm.runInContext(fs.readFileSync(WEB, 'utf8'), caja);
    const k = await caja.CANDADO.miLlave();
    await R.post('/llaves/publicar', { ...B, id: k.id, pub: k.pub, fir: k.fir });
    cerrar = (t) => caja.CANDADO.cerrar(t, llA);
  } else {
    cerrar = (t) => M.CANDADO.cerrar(t, llA);
  }
  const N = 120;
  for (let i = 0; i < N; i++) await R.post('/enviar', { ...B, para: A.correo, cif: await cerrar('mensaje ' + i) });

  const cuenta = () => (M.RELEVO._abiertosDeVerdad ? M.RELEVO._abiertosDeVerdad() : NaN);
  const t0 = Date.now();
  const b1 = await M.RELEVO.bandeja(B.correo);
  const t1 = Date.now();
  const antes = cuenta();
  const b2 = await M.RELEVO.bandeja(B.correo);
  const t2 = Date.now();
  ok(`primera vuelta abre los ${N}`, b1.mensajes.filter((m) => m.texto.startsWith('mensaje ')).length === N);
  ok('segunda vuelta: los mismos textos', b2.mensajes.map((m) => m.texto).join() === b1.mensajes.map((m) => m.texto).join());
  ok('segunda vuelta: 0 mensajes descifrados de nuevo', cuenta() - antes === 0, `primera ${t1 - t0} ms · segunda ${t2 - t1} ms`);
  await R.post('/enviar', { ...B, para: A.correo, cif: await cerrar('uno nuevo') });
  const antes2 = cuenta();
  const b3 = await M.RELEVO.bandeja(B.correo);
  ok('llega uno nuevo: se abre solo ese', cuenta() - antes2 === 1 && b3.mensajes.at(-1).texto === 'uno nuevo');

  // El almacén: dos refrescos a la vez hacen UNA petición.
  let peticiones = 0;
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (u, i) => {
    if (String(u).endsWith('/bandeja')) peticiones++;
    return fetchReal(u, i);
  };
  if (M.CHATS) {
    await Promise.all([M.CHATS.refrescarHilo(B.correo), M.CHATS.refrescarHilo(B.correo), M.CHATS.refrescarHilo(B.correo)]);
    ok('tres refrescos a la vez = una sola petición', peticiones === 1, `${peticiones}`);
  } else {
    ok('tres refrescos a la vez = una sola petición', false, 'no hay almacén (chats.ts)');
  }
  globalThis.fetch = fetchReal;

  // El sondeo: sin solaparse aunque la tarea tarde más que la espera, y quieto en segundo plano.
  if (M.CHATS && M.CHATS._sondearParaPruebas) {
    let enCurso = 0;
    let maxA = 0;
    let vueltas = 0;
    const parar = M.CHATS._sondearParaPruebas(async () => {
      enCurso++;
      maxA = Math.max(maxA, enCurso);
      vueltas++;
      await espera(120);
      enCurso--;
    }, () => 30);
    await espera(600);
    ok('una tarea lenta nunca se solapa consigo misma', maxA === 1 && vueltas >= 3, `máx a la vez ${maxA}, vueltas ${vueltas}`);
    const rn = globalThis.__rn;
    rn.app.forEach((f) => f('background'));
    await espera(200);
    const quieto = vueltas;
    await espera(600);
    ok('en segundo plano no sondea', vueltas === quieto, `${vueltas - quieto} vueltas de más`);
    rn.app.forEach((f) => f('active'));
    await espera(60);
    ok('al volver a primer plano pregunta en el acto', vueltas === quieto + 1, `${vueltas - quieto}`);
    parar();
  } else {
    ok('sondeo pausado en segundo plano', false, 'no hay almacén (chats.ts)');
  }
  await M.RELEVO.salir();
  fin();
})().catch((e) => { console.error(e); process.exit(1); });
