// Identidad · el alta del chat que vuelve tarde (auditoría AUTH02).
//
// El alta de PULSE2CHAT (canjear el pase en el relevo) puede tardar más que la entrada: AU-RA entra sin
// esperarla. Si la persona sale mientras viaja —o sale y entra otra—, la respuesta de esa alta ya no es
// de nadie que esté aquí: antes volvía a poner la cuenta del chat en memoria y en SecureStore y avisaba
// a la pantalla, como si la persona siguiera dentro. Ahora no escribe ni avisa. Un alta más nueva vence a
// la anterior. Y el alta normal (sin salir) sigue entrando y avisando.
// El relevo es de mentira (fetch simulado): nada sale del proceso.
const { ok, fin } = require('../chat/comun.cjs');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const CAJON = 'aura.p2c.cuenta';

(async () => {
  const M = require(process.env.IDENTIDAD || './out/identidad.cjs');
  const { RELEVO, CUENTA } = M;
  const ss = globalThis.__ss;
  console.log('identidad · el alta del chat\n');

  let avisos = 0;
  RELEVO.escucharCuenta(() => avisos++);
  /** Altas en vuelo: cada una contesta cuando la prueba quiere, con la llave que se le dé. */
  const altas = [];
  globalThis.fetch = (url) => {
    const ruta = new URL(String(url)).pathname;
    if (ruta.endsWith('/alta')) return new Promise((r) => altas.push((llave) => r(new Response(JSON.stringify({ llave, correo: 'a@chat.local' }), { status: 200 }))));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  const guardada = () => {
    try {
      return JSON.parse(ss.m.get(CAJON) || 'null');
    } catch {
      return null;
    }
  };
  const limpio = async () => {
    await RELEVO.salir();
    ss.m.delete(CAJON);
    altas.length = 0;
  };
  const alta = (dueno) =>
    RELEVO.entrarConPase('PASE', 'v'.repeat(43), 'Ana', dueno).then(
      (c) => c,
      (e) => e
    );

  /* ── sale durante el alta ─────────────────────────────────────────────────────────────── */
  await limpio();
  CUENTA.fijarCuenta('a@prueba.local', { nueva: true });
  const p1 = alta('a@prueba.local');
  await espera(10);
  CUENTA.fijarCuenta(null);
  await RELEVO.salir();
  const antes = avisos;
  altas[0]('llave-a');
  const r1 = await p1;
  await espera(20);
  ok('AUTH02 · alta tardía tras salir: no guarda la llave en el teléfono', guardada() === null, JSON.stringify(guardada()));
  ok('…ni la deja en memoria', RELEVO.quien() === null, JSON.stringify(RELEVO.quien()));
  ok('…ni avisa a nadie de una cuenta', avisos === antes, `${avisos - antes} aviso(s)`);
  ok('…y el alta falla en vez de «entrar»', r1 instanceof Error, JSON.stringify(r1));

  /* ── sale y entra otra persona durante el alta ────────────────────────────────────────── */
  await limpio();
  CUENTA.fijarCuenta('a@prueba.local', { nueva: true });
  const p2 = alta('a@prueba.local');
  await espera(10);
  CUENTA.fijarCuenta(null);
  await RELEVO.salir();
  CUENTA.fijarCuenta('b@prueba.local');
  const antes2 = avisos;
  altas[0]('llave-a');
  await p2;
  await espera(20);
  ok('AUTH02 · con B ya dentro, el alta tardía de A no deja su chat', guardada() === null && RELEVO.quien() === null, JSON.stringify(guardada()));
  ok('…ni avisa', avisos === antes2);

  /* ── otra alta empieza antes de que vuelva la primera ─────────────────────────────────── */
  await limpio();
  CUENTA.fijarCuenta('a@prueba.local', { nueva: true });
  const p3 = alta('a@prueba.local');
  await espera(5);
  const p4 = alta('a@prueba.local');
  await espera(5);
  altas[1]('llave-nueva');
  await p4;
  altas[0]('llave-vieja');
  await p3;
  await espera(20);
  ok('AUTH02 · volver a entrar: el alta vieja que vuelve después no pisa la nueva', guardada()?.llave === 'llave-nueva' && RELEVO.quien()?.llave === 'llave-nueva', JSON.stringify(guardada()));

  /* ── sin salir, el alta entra (también si AU-RA fija a la persona mientras viaja) ─────── */
  await limpio();
  CUENTA.fijarCuenta(null, { nueva: true });
  const p5 = alta('a@prueba.local');
  await espera(5);
  // La entrada con Genesis no espera al chat: fija a la persona mientras el alta viaja.
  CUENTA.fijarCuenta('a@prueba.local');
  const antes5 = avisos;
  altas[0]('llave-a');
  const r5 = await p5;
  ok('el alta normal guarda la cuenta del chat de esa persona', guardada()?.llave === 'llave-a' && guardada()?.aura === 'a@prueba.local' && r5?.llave === 'llave-a', JSON.stringify(guardada()));
  ok('…y avisa', avisos > antes5);
  await limpio();

  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
