// M2, B1, B2 · La vuelta de la wallet: enlaces malformados, el enlace inicial gastado al salir, y
// la espera que se suelta si no hay app.
const { ok, fin, espera, movil } = require('./comun.cjs');
const { GENESIS, RELEVO } = movil();
const rn = globalThis.__rn;
const ss = globalThis.__ss;

(async () => {
  console.log('M2 · enlace malformado\n');
  const casos = ['ultronfp://sso?pase=%E0%A4%A&estado=x', 'ultronfp://sso?estado=%', 'ultronfp://sso?pase=%ZZ'];
  for (const u of casos) {
    let r;
    let lanzo = false;
    try {
      r = GENESIS.leerVuelta(u);
    } catch {
      lanzo = true;
    }
    ok(`leerVuelta(${u}) no lanza`, !lanzo, JSON.stringify(r));
  }
  ok('el valor roto se descarta, el bueno queda', GENESIS.leerVuelta('ultronfp://sso?pase=%E0%A4%A&estado=x')?.estado === 'x' && !GENESIS.leerVuelta('ultronfp://sso?pase=%E0%A4%A&estado=x')?.pase);
  ok('prefijo exacto: ultronfp://ssoXYZ no es una vuelta', GENESIS.leerVuelta('ultronfp://ssoXYZ?pase=a&estado=b') === null);
  ok('ultronfp://sso?… sí', GENESIS.leerVuelta('ultronfp://sso?pase=a&estado=b')?.pase === 'a');
  ok('ultronfp://sso/?… sí', GENESIS.leerVuelta('ultronfp://sso/?pase=a&estado=b')?.pase === 'a');
  ok('ultronfp://sso a secas sí (sin datos)', JSON.stringify(GENESIS.leerVuelta('ultronfp://sso')) === '{}');

  // Con la espera de la app abierta, un enlace roto no tumba al oyente y la vuelta buena sigue sirviendo.
  rn.openURL = async () => {};
  const p = GENESIS.entrarConGenesis();
  await espera(50);
  let lanzo = false;
  try {
    rn.url[0]({ url: 'ultronfp://sso?pase=%E0%A4%A' });
  } catch {
    lanzo = true;
  }
  ok('el oyente de Linking no lanza con un enlace roto', !lanzo);
  const pend = JSON.parse(ss.m.get('aura.genesis.pendiente'));
  globalThis.__api = async (ruta) => (ruta === '/api/genesis/entrar' ? { token: 't', miembro: { nombre: 'Ana', correo: 'a@b.c', rol: 'x', gid: 'GEN-AAAA-BBBB-C' } } : {});
  rn.url[0]({ url: `ultronfp://sso?pase=PASE&estado=${pend.estado}` });
  const r = await p;
  ok('la vuelta buena entra igual', r.ok === true);

  console.log('\nB1 · al salir, el enlace inicial queda gastado\n');
  // Arranque en frío con la vuelta: se completa una vez.
  const { verificador } = GENESIS.nuevoReto();
  ss.m.set('aura.genesis.pendiente', JSON.stringify({ verificador, estado: 'EST1', en: Date.now() }));
  rn.inicial = 'ultronfp://sso?pase=PASE&estado=EST1';
  const r1 = await GENESIS.retomarSiVolvio();
  ok('el arranque en frío retoma la vuelta', r1 && r1.ok === true);
  // Sale; empieza otro pedido (queda pendiente) y vuelve a montarse la pantalla de entrada.
  await RELEVO.salir();
  ss.m.set('aura.genesis.pendiente', JSON.stringify({ verificador, estado: 'EST1', en: Date.now() }));
  const r2 = await GENESIS.retomarSiVolvio();
  ok('tras salir, el mismo enlace inicial NO se vuelve a canjear', r2 === null, JSON.stringify(r2));
  ok('salir borra el pedido pendiente', !ss.m.has('aura.genesis.pendiente'));

  console.log('\nB2 · sin app ni web: nada colgado\n');
  rn.openURL = async () => {
    throw new Error('no app');
  };
  globalThis.__wb = async () => ({ type: 'dismiss' });
  const antes = rn.url.length + rn.app.length;
  const r3 = await GENESIS.entrarConGenesis();
  ok('SIN_VUELTA', r3.codigo === 'SIN_VUELTA');
  ok('no quedan oyentes de Linking/AppState vivos', rn.url.length + rn.app.length - antes === 0, `${rn.url.length + rn.app.length - antes}`);
  ok('el pedido pendiente se borra tras SIN_VUELTA', !ss.m.has('aura.genesis.pendiente'));
  fin();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
