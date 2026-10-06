// Mensajes · sin aparatos del otro lado, el texto NO sale en claro (auditoría A06).
//
// Un relevo de mentira (fetch) que contesta el directorio de llaves VACÍO: antes el teléfono mandaba
// `{ para, texto }` legible y la burbuja decía «sin cifrar» después. Ahora no sale sin una decisión
// previa y explícita (`sinCifrar: true`), y el mensaje optimista del hilo no lleva candado antes de
// saber cómo salió. (Contra el relevo REAL, lo mismo en ../chat/cifrado.cjs.)
const { ok, fin } = require('../chat/comun.cjs');

(async () => {
  const M = require('./paquete.cjs')();
  const { RELEVO, CUENTA } = M;
  console.log('mensajes · sin llaves no hay envío en claro\n');
  const enviados = [];
  globalThis.fetch = async (url, init = {}) => {
    const ruta = new URL(String(url)).pathname;
    const cuerpo = init.body ? JSON.parse(init.body) : {};
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (ruta === '/llaves/de') return json({ llaves: {} });
    if (ruta === '/enviar') {
      enviados.push(cuerpo);
      return json({ id: 'm' + enviados.length });
    }
    return json({ ok: true });
  };
  CUENTA?.fijarCuenta('vera@prueba.local');
  globalThis.__ss.m.set('aura.p2c.cuenta', JSON.stringify({ correo: 'vera@prueba.local', llave: 'llave-vera' }));
  await RELEVO.recuperar();

  let motivo = '';
  try {
    await RELEVO.enviar('nadia@prueba.local', 'secreto para Nadia');
  } catch (e) {
    motivo = e.motivo || e.message;
  }
  ok('A06: directorio de llaves vacío → no sale, y dice por qué', motivo === 'sin-aparatos', motivo || 'salió');
  ok('A06: …y al relevo no llegó ningún texto legible', !enviados.some((b) => typeof b.texto === 'string'), JSON.stringify(enviados));
  const claro = await RELEVO.enviar('nadia@prueba.local', 'aviso sin cifrar', { sinCifrar: true }).catch((e) => e);
  ok('con decisión previa explícita, el envío en claro de siempre (contrato del relevo igual)', claro?.e2e === false && enviados.some((b) => b.texto === 'aviso sin cifrar' && b.para === 'nadia@prueba.local'), JSON.stringify(claro));
  fin();
})();
