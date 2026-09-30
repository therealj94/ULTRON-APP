// A3 · Un bulto con forma rota no tumba la bandeja: ese mensaje sale «cerrado» y los demás se ven.
const { ok, fin, arrancarRelevo, movil, entrarComo } = require('./comun.cjs');

(async () => {
  const R = await arrancarRelevo();
  const M = movil();
  console.log('A3 · mensaje envenenado\n');
  const A = await R.cuenta('Ana');
  const B = await R.cuenta('Beto');
  await R.amigos(B, A);
  await entrarComo(M, A);
  await R.post('/enviar', { ...B, para: A.correo, texto: 'hola, soy B' });
  const venenos = [
    { v: 2, ct: 'x', s: [null] },
    { v: 2, ct: 'x', s: [{ a: 1, iv: {}, k: [] }] },
    { v: 2, de: 7, iv: 'AA', ct: 'x', s: [] },
    { v: 2, de: 'AA', iv: 'AA', ct: 'x', s: ['texto'] },
    { v: 2, de: 'AA', iv: 'AA', ct: 'x', s: [{ a: 'x', iv: 'AA', k: 'AA' }], f: 5, fir: 'AA' },
  ];
  for (const cif of venenos) await R.post('/enviar', { ...B, para: A.correo, cif });
  await R.post('/enviar', { ...B, para: A.correo, texto: 'sigo aquí' });
  let r = null;
  let lanzo = null;
  try {
    r = await M.RELEVO.bandeja(B.correo);
  } catch (e) {
    lanzo = e;
  }
  ok('la bandeja no lanza', !lanzo, lanzo ? String(lanzo) : '');
  const ms = r ? r.mensajes : [];
  ok('se ven los mensajes buenos', ms.some((m) => m.texto === 'hola, soy B') && ms.some((m) => m.texto === 'sigo aquí'));
  ok(`los ${venenos.length} malos salen cerrados`, ms.filter((m) => m.cerrado).length === venenos.length, `${ms.filter((m) => m.cerrado).length}`);
  // Y la lista de conversaciones (que abre el último) aguanta un último envenenado.
  await R.post('/enviar', { ...B, para: A.correo, cif: venenos[0] });
  let lista = null;
  try {
    lista = M.RELEVO.conversaciones ? await M.RELEVO.conversaciones() : null;
  } catch (e) {
    lanzo = e;
  }
  const fila = (lista || []).find((c) => c.correo === B.correo);
  ok('la lista de conversaciones aguanta un último mensaje envenenado', !!fila, lanzo ? String(lanzo) : '');
  const { CANDADO } = M;
  const esb = CANDADO.esBulto ? venenos.map((v) => CANDADO.esBulto(v)) : [];
  ok('esBulto rechaza todas las formas rotas', esb.length === venenos.length && esb.every((x) => x === false));
  await M.RELEVO.salir();
  fin();
})().catch((e) => { console.error(e); process.exit(1); });
