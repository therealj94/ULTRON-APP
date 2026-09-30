// Costura · las manos de AURA en el chat (pulse/manos.ts) con el relevo REAL: el bus → leer, buscar y
// llamar → lo que AURA dice (`lectura`, con el boleto del servidor) y el `hecho`.
//
//  · leer: lo último de esa persona (no lo tuyo), hace cuánto, y los no leídos; o lo nuevo de todos.
//  · buscar: dice EN QUÉ chat está (nunca lo que decía) y abre ese hilo.
//  · llamar: el motor de llamadas de siempre marca; la misma orden repetida no marca dos veces; con
//    una llamada en curso, o a alguien que no está, se dice por qué no.
//  · la compañera no repite en voz el fallo de leer (ya lo dijo la lectura).
const { ok, fin, espera, arrancarRelevo, entrarComo } = require('../chat/comun.cjs');

(async () => {
  const R = await arrancarRelevo();
  const M = require(process.env.COSTURAS || './out/costuras.cjs');
  const { RELEVO, CHATS, LLAMADA, CONTRATO, MANOS, ANIMO } = M;
  if (!MANOS) {
    ok('el paquete trae las manos (pulse/manos.ts)', false);
    fin();
  }
  const A = await R.cuenta('José');
  const B = await R.cuenta('Beto Pérez');
  const C = await R.cuenta('María López');
  await R.amigos(A, B);
  await R.amigos(A, C);
  await entrarComo(M, A);
  await CHATS.refrescarLista();

  const lecturas = [];
  const hechos = [];
  const abiertos = [];
  CONTRATO.escuchar('lectura', (l) => lecturas.push(l));
  CONTRATO.escuchar('hecho', (h) => hechos.push(h));
  CONTRATO.escuchar('accion', (a) => a.tipo === 'abrir_chat' && abiertos.push(a.con));
  const esperarQue = async (f, ms = 8000) => {
    for (let i = 0; i < ms / 50 && !f(); i++) await espera(50);
    return f();
  };
  const ultimaLectura = async (n) => {
    await esperarQue(() => lecturas.length >= n);
    return lecturas[n - 1] || {};
  };

  console.log('costura · leer\n');
  await R.post('/enviar', { ...B, para: A.correo, texto: 'Ya voy saliendo' });
  await R.post('/enviar', { ...B, para: A.correo, texto: 'Llego en 20 minutos con la dirección nueva' });
  CONTRATO.emitir('accion', { tipo: 'leer', de: 'Beto', boleto: 'boleto-de-prueba-1' });
  let l = await ultimaLectura(1);
  ok('dice quién, cuántos y qué (los dos no leídos)', /^Beto Pérez te mandó 2 mensajes, el último hace un momento: «Ya voy saliendo», y luego «Llego en 20 minutos con la dirección nueva»\.$/.test(l.texto), l.texto);
  ok('con el boleto que puso el servidor', l.boleto === 'boleto-de-prueba-1');
  ok('y avisa hecho ok', hechos.some((h) => h.accion.tipo === 'leer' && h.ok));

  CONTRATO.emitir('accion', { tipo: 'leer', boleto: 'boleto-de-prueba-2' });
  l = await ultimaLectura(2);
  ok('lo nuevo de todos: quién te escribió y lo último', /^Tienes mensajes nuevos de una persona\. Beto Pérez, hace un momento: «Llego en 20 minutos/.test(l.texto), l.texto);

  CONTRATO.emitir('accion', { tipo: 'leer', de: 'María', boleto: 'boleto-de-prueba-3' });
  l = await ultimaLectura(3);
  ok('quien no te ha escrito', l.texto === 'María López no te ha escrito nada todavía.', l.texto);

  CONTRATO.emitir('accion', { tipo: 'leer', de: 'Pancho', boleto: 'boleto-de-prueba-4' });
  l = await ultimaLectura(4);
  ok('a alguien que no está: lo dice por la lectura', /No encuentro a «Pancho»/.test(l.texto), l.texto);
  ok('y el hecho sale con ok:false', hechos.some((h) => h.accion.tipo === 'leer' && h.accion.de === 'Pancho' && !h.ok));
  const r = ANIMO.reducir(ANIMO.ANIMO_INICIAL, { tipo: 'hecho', ok: false, accion: { tipo: 'leer', de: 'Pancho' }, detalle: 'No encuentro a «Pancho»' }, Date.now());
  ok('la compañera no lo repite en voz (ya lo dijo la lectura), solo el globito', !r.efectos.some((e) => e.tipo === 'confirmar') && r.efectos.some((e) => e.tipo === 'globo'));

  console.log('\ncostura · buscar\n');
  CONTRATO.emitir('accion', { tipo: 'buscar', q: 'direccion', boleto: 'boleto-de-prueba-5' });
  l = await ultimaLectura(5);
  ok('dice en qué chat está, sin acentos de por medio', l.texto === 'Lo encontré en el chat con Beto Pérez. Te lo abro.', l.texto);
  ok('y nunca lo que decía el mensaje', !/Llego|20 minutos/.test(l.texto));
  ok('abre ese hilo', abiertos.includes(B.correo), abiertos.join());
  CONTRATO.emitir('accion', { tipo: 'buscar', q: 'xyzzy', boleto: 'boleto-de-prueba-6' });
  l = await ultimaLectura(6);
  ok('si no está, lo dice', l.texto === 'No encontré «xyzzy» en tus chats recientes.', l.texto);

  console.log('\ncostura · llamar\n');
  LLAMADA.arrancar({ mandar: (para, tipo, datos) => RELEVO.senalar(para, tipo, datos), alCambiar: () => {}, aparato: RELEVO.miId, correo: () => RELEVO.quien()?.correo || '' });
  const deLlamar = () => hechos.filter((h) => h.accion.tipo === 'llamar');
  CONTRATO.emitir('accion', { tipo: 'llamar', con: 'Beto', video: false });
  await esperarQue(() => deLlamar().length >= 1);
  ok('el motor de llamadas marca a Beto', LLAMADA.enLlamada() && LLAMADA.cuento().conQuien === B.correo, JSON.stringify(LLAMADA.cuento().estado));
  ok('y el hecho dice a quién', deLlamar()[0]?.ok && deLlamar()[0]?.detalle === 'Llamando a Beto Pérez.', JSON.stringify(deLlamar()[0]));
  await espera(150);
  const llamos = async () => ((await R.post('/senales', { ...B, aparato: 'aparatoDeBeto' })).senales || []).filter((s) => s.de === A.correo && s.tipo === 'llamo').length;
  ok('Beto recibe UN «llamo»', (await llamos()) === 1);
  CONTRATO.emitir('accion', { tipo: 'llamar', con: 'Beto', video: false });
  await espera(300);
  ok('la misma orden repetida (SSE y turno) no marca otra vez ni dice «no pude»', deLlamar().length === 1 && (await llamos()) === 0);
  CONTRATO.emitir('accion', { tipo: 'llamar', con: 'María', video: true });
  await esperarQue(() => deLlamar().length >= 2);
  ok('con una llamada en curso, dice por qué no', deLlamar()[1] && !deLlamar()[1].ok && deLlamar()[1].detalle === 'Ya estás en una llamada.', JSON.stringify(deLlamar()[1]));
  LLAMADA.colgar('yo');
  await esperarQue(() => !LLAMADA.enLlamada());
  CONTRATO.emitir('accion', { tipo: 'llamar', con: 'Pancho', video: false });
  await esperarQue(() => deLlamar().length >= 3);
  ok('a alguien que no está: no marca', !deLlamar()[2].ok && /No encuentro a «Pancho»/.test(deLlamar()[2].detalle) && !LLAMADA.enLlamada());

  console.log('\ncostura · sin cuenta del chat\n');
  await RELEVO.salir();
  await espera(20);
  CONTRATO.emitir('accion', { tipo: 'leer', de: 'Beto', boleto: 'boleto-de-prueba-7' });
  l = await ultimaLectura(7);
  ok('leer dice que el chat no está conectado', l.texto === 'El chat no está conectado.', l.texto);
  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
