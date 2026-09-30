// RELEVO.senalar · Las señales de llamada dicen POR QUÉ no salieron (403/413/429/400/red) en vez de
// tragárselo, salen en orden por destinatario y una promesa ignorada no deja un rechazo suelto.
const { ok, fin, arrancarRelevo, movil, entrarComo } = require('./comun.cjs');

let sueltos = 0;
process.on('unhandledRejection', () => sueltos++);

async function motivo(p) {
  try {
    await p;
    return { ok: true };
  } catch (e) {
    return { code: e.code, motivoSenal: e.motivoSenal, tipoSenal: e.tipoSenal };
  }
}

(async () => {
  const R = await arrancarRelevo();
  const M = movil();
  const { RELEVO } = M;
  console.log('senalar · el error real\n');
  const A = await R.cuenta('Ana');
  const B = await R.cuenta('Beto');
  const C = await R.cuenta('Ciro');
  await R.amigos(A, B);
  await entrarComo(M, A);

  const bien = await RELEVO.senalar(B.correo, 'llamo', { video: false });
  ok('aceptada: { ok: true }', bien && bien.ok === true);
  const r403 = await motivo(RELEVO.senalar(C.correo, 'llamo', {}));
  ok('a quien no te aceptó: 403 · no-te-acepta', r403.code === 403 && r403.motivoSenal === 'no-te-acepta' && r403.tipoSenal === 'llamo', JSON.stringify(r403));
  const r413 = await motivo(RELEVO.senalar(B.correo, 'oferta', { sdp: 'x'.repeat(13_000) }));
  ok('demasiado grande: 413 · muy-grande', r413.code === 413 && r413.motivoSenal === 'muy-grande', JSON.stringify(r413));
  const r400 = await motivo(RELEVO.senalar(B.correo, 'inventada', {}));
  ok('tipo que el relevo no conoce: 400 · tipo-invalido', r400.code === 400 && r400.motivoSenal === 'tipo-invalido', JSON.stringify(r400));

  // Orden: una oferta y sus ICE a la misma persona, pedidas de golpe.
  const tipos = ['oferta', 'ice', 'ice', 'ice', 'ice', 'ice'];
  await Promise.all(tipos.map((t, i) => RELEVO.senalar(B.correo, t, { n: i })));
  const llegan = (await R.post('/senales', { ...B, aparato: 'pruebaOrden' })).senales || [];
  const deA = llegan.filter((s) => s.de === A.correo && s.tipo !== 'llamo');
  ok('salen en el orden en que se pidieron', deA.map((s) => s.datos.n).join() === '0,1,2,3,4,5', deA.map((s) => s.tipo + s.datos.n).join(' '));

  // Buzón lleno: el relevo guarda 60 por buzón.
  let r429 = null;
  for (let i = 0; i < 70 && !r429; i++) {
    const r = await motivo(RELEVO.senalar(B.correo, 'ice', { i }));
    if (r.code) r429 = r;
  }
  ok('buzón lleno: 429 · buzon-lleno', r429 && r429.code === 429 && r429.motivoSenal === 'buzon-lleno', JSON.stringify(r429));

  // Sin red: la petición ni sale.
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Network request failed');
  };
  const rRed = await motivo(RELEVO.senalar(B.correo, 'cuelgo', {}));
  globalThis.fetch = fetchReal;
  ok('sin red: sin code · sin-red', rRed.code === undefined && rRed.motivoSenal === 'sin-red', JSON.stringify(rRed));

  // Una señal que falla y nadie espera no deja un rechazo suelto.
  RELEVO.senalar(C.correo, 'llamo', {});
  await new Promise((r) => setTimeout(r, 400));
  ok('ignorar la promesa no deja un unhandledRejection', sueltos === 0, String(sueltos));

  // Sin cuenta: 401 sin-cuenta, sin ir al relevo.
  await RELEVO.salir();
  const r401 = await motivo(RELEVO.senalar(B.correo, 'llamo', {}));
  ok('sin cuenta: 401 · sin-cuenta', r401.code === 401 && r401.motivoSenal === 'sin-cuenta', JSON.stringify(r401));
  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
