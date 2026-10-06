// Identidad · la cuenta del chat es de quien está dentro de AU-RA (auditoría A07).
//
// Antes, con la sesión de AU-RA vencida (o con otra persona dentro), el proveedor del chat recuperaba
// igual la cuenta guardada del relevo y se ponía a escuchar. Ahora: sin nadie dentro, nada; con otra
// persona, nada (y no se le borra a su dueño); con la misma, sí. Las cuentas viejas (sin `aura`) valen
// solo si el correo del chat es el de la sesión.
const { ok, fin } = require('../chat/comun.cjs');

(async () => {
  const M = require('./paquete.cjs')();
  const { RELEVO, CUENTA } = M;
  const ss = globalThis.__ss;
  console.log('identidad · la cuenta del chat\n');
  // El relevo no está (127.0.0.1:1): publicar la llave falla por red, que no es un «no vale».
  const cajon = 'aura.p2c.cuenta';

  ss.m.set(cajon, JSON.stringify({ correo: 'a@chat.local', llave: 'llave-a', aura: 'a@prueba.local' }));
  CUENTA?.fijarCuenta(null);
  ok('A07: sin nadie dentro de AU-RA, el chat NO se recupera', (await RELEVO.recuperar()) === null && RELEVO.quien() === null);
  CUENTA?.fijarCuenta('b@prueba.local');
  ok('A07: con otra persona dentro, tampoco', (await RELEVO.recuperar()) === null && RELEVO.quien() === null);
  ok('…y la cuenta de A sigue guardada para A (no se borra lo ajeno)', !!ss.m.get(cajon));
  CUENTA?.fijarCuenta('a@prueba.local');
  const deA = await RELEVO.recuperar();
  ok('con A dentro, su chat vuelve', deA?.correo === 'a@chat.local', JSON.stringify(deA));
  // En memoria quedó el de A y entra B: se suelta.
  CUENTA?.fijarCuenta('b@prueba.local');
  ok('si en memoria quedó el chat de A y está B, se suelta', (await RELEVO.recuperar()) === null && RELEVO.quien() === null);

  // Una cuenta vieja (sin `aura`): solo si el correo del chat es el de la sesión.
  await RELEVO.salir();
  ss.m.set(cajon, JSON.stringify({ correo: 'c@prueba.local', llave: 'llave-c' }));
  CUENTA?.fijarCuenta('d@prueba.local');
  ok('cuenta vieja de otro correo: no se recupera', (await RELEVO.recuperar()) === null);
  CUENTA?.fijarCuenta('c@prueba.local');
  ok('cuenta vieja del mismo correo: sí', (await RELEVO.recuperar())?.correo === 'c@prueba.local');
  await RELEVO.salir();

  fin();
})();
