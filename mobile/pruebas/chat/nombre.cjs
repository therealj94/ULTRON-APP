// M1 · Entrar con Genesis no pisa el nombre con el que la persona sale en el chat.
const { ok, fin, arrancarRelevo, movil, paseDe } = require('./comun.cjs');

(async () => {
  const R = await arrancarRelevo();
  const M = movil();
  console.log('M1 · el nombre del chat\n');
  const correo = `eva${Date.now().toString(36)}@prueba.test`;
  const a = await R.post('/alta', { correo, nombre: 'Ana María López' });
  const c = await M.RELEVO.entrarConPase(paseDe(correo, 'v'.repeat(43)), 'v'.repeat(43), 'Ana');
  const despues = await R.post('/ficha', { correo, llave: a.llave, de: correo });
  ok('misma llave de cuenta devuelta', c.llave === a.llave);
  ok('el nombre del chat sigue siendo el suyo', despues.nombre === 'Ana María López', JSON.stringify(despues.nombre));

  // Cuenta NUEVA por Genesis: ahí sí se pone el nombre (no había ninguno).
  await M.RELEVO.salir();
  const nuevo = `nuevo${Date.now().toString(36)}@prueba.test`;
  const c2 = await M.RELEVO.entrarConPase(paseDe(nuevo, 'v'.repeat(43)), 'v'.repeat(43), 'Eva Nueva');
  const f2 = await R.post('/ficha', { correo: nuevo, llave: c2.llave, de: nuevo });
  ok('cuenta nueva: toma el nombre de Genesis', f2.nombre === 'Eva Nueva', JSON.stringify(f2.nombre));
  await M.RELEVO.salir();

  // Un pase interceptado no sirve con otro verificador: el reto de adentro es la huella del de ESTE teléfono.
  const robado = `robado${Date.now().toString(36)}@prueba.test`;
  let rechazo = null;
  try {
    await M.RELEVO.entrarConPase(paseDe(robado, 'v'.repeat(43)), 'w'.repeat(43), 'Intruso');
  } catch (e) {
    rechazo = e;
  }
  ok('con otro verificador el relevo no abre la cuenta', !!rechazo && !M.RELEVO.quien(), String(rechazo?.message || 'entró'));
  fin();
})().catch((e) => { console.error('ERR', e.message, e.code, e.motivo); process.exit(1); });
