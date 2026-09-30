// A2 · Volver a primer plano (dejarDeEscuchar + escuchar con la petición larga aún en vuelo) no
// pierde señales, y la espera entre reintentos no queda colgada.
const { ok, fin, espera, arrancarRelevo, movil, entrarComo } = require('./comun.cjs');

(async () => {
  const R = await arrancarRelevo();
  const M = movil();
  console.log('A2 · señales al volver a primer plano\n');
  const T = Number(process.env.T || 8);
  let control = 0;
  let tras = 0;
  let dobles = 0;
  for (let i = 0; i < T; i++) {
    const c = await R.cuenta();
    await entrarComo(M, c);
    // Control: un solo bucle.
    let llego = 0;
    void M.RELEVO.escuchar((s) => s.tipo === 'escribe' && llego++);
    await espera(300);
    await R.post('/senal', { ...c, para: c.correo, tipo: 'escribe', datos: { i } });
    await espera(900);
    if (llego === 1) control++;
    M.RELEVO.dejarDeEscuchar();

    // Segundo plano → primer plano con la petición de antes todavía esperando en el relevo.
    const k = await R.cuenta();
    await entrarComo(M, k);
    let viejo = 0;
    let nuevo = 0;
    void M.RELEVO.escuchar((s) => s.tipo === 'escribe' && viejo++);
    await espera(300);
    M.RELEVO.dejarDeEscuchar();
    void M.RELEVO.escuchar((s) => s.tipo === 'escribe' && nuevo++);
    await espera(300);
    await R.post('/senal', { ...k, para: k.correo, tipo: 'escribe', datos: { i } });
    await espera(900);
    if (nuevo === 1) tras++;
    if (nuevo + viejo > 1) dobles++;
    M.RELEVO.dejarDeEscuchar();
  }
  ok(`control: ${control}/${T} señales entregadas`, control === T);
  ok(`tras dejar y volver a escuchar: ${tras}/${T} entregadas al oyente nuevo`, tras === T);
  ok('ninguna señal entregada dos veces', dobles === 0, `${dobles}`);

  // En segundo plano la señal que traiga la petición en vuelo se guarda y sale al volver.
  const z = await R.cuenta();
  await entrarComo(M, z);
  const vistas = [];
  void M.RELEVO.escuchar((s) => vistas.push(s.tipo));
  await espera(300);
  M.RELEVO.dejarDeEscuchar();
  await R.post('/senal', { ...z, para: z.correo, tipo: 'llamo', datos: { video: false } });
  await espera(600);
  ok('en segundo plano no se entrega a nadie', vistas.length === 0);
  void M.RELEVO.escuchar((s) => vistas.push(s.tipo));
  await espera(300);
  ok('al volver sale la señal que llegó mientras tanto', vistas.join() === 'llamo', vistas.join());
  M.RELEVO.dejarDeEscuchar();

  // La espera entre reintentos (relevo caído) se resuelve al dejar de escuchar: el bucle termina.
  process.env.MENSAJES_API = 'http://127.0.0.1:1';
  const caida = await R.cuenta();
  await entrarComo(M, caida);
  // Un relevo que no contesta: se fuerza el error de red cambiando fetch un momento.
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('sin red'); };
  let termino = false;
  const bucle = M.RELEVO.escuchar(() => {}).then(() => (termino = true));
  await espera(200);
  M.RELEVO.dejarDeEscuchar();
  await Promise.race([bucle, espera(500)]);
  globalThis.fetch = fetchReal;
  ok('dejarDeEscuchar despierta la espera de 2 s y el bucle termina', termino === true);
  await M.RELEVO.salir();
  fin();
})().catch((e) => { console.error(e); process.exit(1); });
