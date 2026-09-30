// A1 · El llavero que no se deja LEER no es un teléfono nuevo: no se genera ni se pisa nada.
const { ok, fin, movil } = require('./comun.cjs');
const { CANDADO: M } = movil();
const ss = globalThis.__ss;

(async () => {
  console.log('A1 · llavero\n');
  const a = await M.miLlave();
  const guardada = ss.m.get('aura.p2c.candado.priv');
  const firma = ss.m.get('aura.p2c.candado.firma');
  ok('arranque normal: guarda el par y no es volátil', !!guardada && !!firma && a.volatil === false);

  // Reinicio con UNA lectura que falla (Keystore que no descifra justo después de encender).
  M._olvidarParaPruebas();
  ss.fallarLectura = 1;
  const b = await M.miLlave();
  ok('lectura que falla: par volátil en memoria', b.volatil === true, `volatil=${b.volatil}`);
  ok('lectura que falla: NO pisa la llave guardada', ss.m.get('aura.p2c.candado.priv') === guardada && ss.m.get('aura.p2c.candado.firma') === firma);

  M._olvidarParaPruebas();
  const c = await M.miLlave();
  ok('llavero sano otra vez: vuelve el aparato de siempre', c.id === a.id && c.volatil === false);

  // Teléfono nuevo cuya escritura falla: volátil (no se publicará).
  ss.m.clear();
  M._olvidarParaPruebas();
  ss.fallarEscritura = 2;
  const d = await M.miLlave();
  ok('escritura que falla: se marca volátil', d.volatil === true && !ss.m.has('aura.p2c.candado.priv'), `volatil=${d.volatil}`);
  ss.fallarEscritura = 0;

  // Solo falla la lectura de la llave de FIRMA.
  M._olvidarParaPruebas();
  const e = await M.miLlave(); // teléfono nuevo, guarda bien
  const firmaE = ss.m.get('aura.p2c.candado.firma');
  M._olvidarParaPruebas();
  const real = ss.m.get.bind(ss.m);
  let veces = 0;
  ss.m.get = (k) => {
    if (k === 'aura.p2c.candado.firma' && veces++ === 0) throw new Error('keystore');
    return real(k);
  };
  const f = await M.miLlave();
  ss.m.get = real;
  ok('falla la lectura de la firma: la firma guardada queda intacta', ss.m.get('aura.p2c.candado.firma') === firmaE);
  ok('…mismo aparato, sin firma y sin publicar (volátil)', f.id === e.id && f.fir === null && f.volatil === true, `fir=${f.fir} volatil=${f.volatil}`);

  // Reintento: el Keystore vuelve a responder a los 15 s y el par de memoria se cambia por el guardado.
  M._olvidarParaPruebas();
  ss.fallarLectura = 1;
  const g1 = await M.miLlave();
  const ahora = Date.now;
  Date.now = () => ahora() + 16_000;
  const g2 = await M.miLlave();
  Date.now = ahora;
  ok('reintento a los 15 s: recupera el aparato guardado sin reiniciar', g1.volatil === true && g2.id === e.id && g2.volatil === false);
  fin();
})().catch((e) => { console.error(e); process.exit(1); });
