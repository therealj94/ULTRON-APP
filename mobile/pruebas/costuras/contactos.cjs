// Costura · a quién le puede escribir AURA: compañera (contactos.ts, ContextoApp) + chat (relevo REAL,
// chats). Lo que reproducía contactos/prueba.mts del revisor: `contactosConocidos()` es síncrona, el
// `.catch` de un arreglo lanzaba un TypeError tragado y al cerebro le llegaba `contactos: []`.
const { ok, fin, espera, arrancarRelevo, entrarComo } = require('../chat/comun.cjs');

(async () => {
  const R = await arrancarRelevo();
  const M = require(process.env.COSTURAS || './out/costuras.cjs');
  const { RELEVO, CONTACTOS, ACCIONES } = M;
  console.log('costura · los contactos que se le cuentan al cerebro\n');

  ok('sin cuenta del chat: nadie', (await CONTACTOS.contactosParaAura()).length === 0);

  const A = await R.cuenta('José');
  const B = await R.cuenta('Beto Pérez');
  const C = await R.cuenta('María José Núñez');
  await R.amigos(A, B);
  await R.amigos(A, C);
  await entrarComo(M, A);
  ok('recién entrado, la lista del relevo está vacía (nadie abrió los chats)', RELEVO.contactosConocidos().length === 0);

  // Lo que hace ContextoApp en la app: pide los contactos y los manda con el contexto.
  const enviados = [];
  const ctx = new ACCIONES.ContextoApp({
    enviar: async (c) => enviados.push(JSON.parse(JSON.stringify(c))),
    contactos: CONTACTOS.contactosParaAura,
    escuchar: () => () => {},
    esperar: (f) => {
      f();
      return () => {};
    },
  });
  const c = await ctx.enviarAhora(true);
  const correos = (c?.contactos || []).map((x) => x.correo).sort();
  ok('el contexto lleva a Beto y a María (se pidió la lista una vez)', correos.join() === [B.correo, C.correo].sort().join(), JSON.stringify(c && c.contactos));
  ok('solo nombre y correo de cada uno', (c?.contactos || []).every((x) => Object.keys(x).sort().join() === 'correo,nombre'));
  ok('con su nombre de la lista', (c?.contactos || []).some((x) => x.nombre === 'Beto Pérez'));

  // Una persona sin contactos: la lista se pide UNA vez, no en cada envío del contexto.
  const D = await R.cuenta('Solo');
  await entrarComo(M, D);
  let pedidas = 0;
  const fetchDeVerdad = globalThis.fetch;
  globalThis.fetch = (url, ...resto) => {
    if (/\/(conversaciones|circulo)/.test(String(url))) pedidas++;
    return fetchDeVerdad(url, ...resto);
  };
  await CONTACTOS.contactosParaAura();
  await CONTACTOS.contactosParaAura();
  await CONTACTOS.contactosParaAura();
  globalThis.fetch = fetchDeVerdad;
  ok('sin contactos, la lista se pidió una sola vez', pedidas > 0 && pedidas <= 2, 'peticiones ' + pedidas);

  await RELEVO.salir();
  await espera(10);
  ok('al salir, nadie', (await CONTACTOS.contactosParaAura()).length === 0);
  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
