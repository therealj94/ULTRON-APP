// Costura · «envíalo» de punta a punta: el puente de acciones (SSE) y el `done` del turno → el bus →
// los borradores → el relevo REAL → la compañera. Lo que el revisor reprodujo con doble.mts y
// doble-envio.cjs, más lo que AURA dice (y lo que no) cuando sale un mensaje.
const { ok, fin, espera, arrancarRelevo, entrarComo } = require('../chat/comun.cjs');
// El paquete se carga DESPUÉS de levantar el relevo: la dirección del relevo se lee al cargar.
let M, RELEVO, CHATS, BORRADORES, CONTRATO, ACCIONES, ANIMO;

/** La compañera de verdad (su máquina de ánimo) escuchando el bus, como Companera.tsx. */
function companera() {
  let animo = ANIMO.ANIMO_INICIAL;
  const efectos = [];
  const pasar = (ev) => {
    const r = ANIMO.reducir(animo, ev, Date.now());
    animo = r.animo;
    efectos.push(...r.efectos);
  };
  CONTRATO.escuchar('hecho', (h) => pasar({ tipo: 'hecho', ok: h.ok, accion: h.accion, detalle: h.detalle }));
  CONTRATO.escuchar('enviado', (e) => pasar({ tipo: 'enviado', para: e.para, nombre: e.nombre }));
  return {
    efectos,
    dichos: () => efectos.filter((e) => e.tipo === 'confirmar'),
    palomitas: () => efectos.filter((e) => e.tipo === 'palomita').length,
    limpiar: () => efectos.splice(0),
  };
}

/** Un XHR del SSE que la prueba alimenta a mano. */
function sseFalso() {
  const x = { responseText: '', status: 200, readyState: 1, cab: {}, onprogress: null, onreadystatechange: null, onerror: null };
  x.open = () => {};
  x.setRequestHeader = (k, v) => (x.cab[k] = v);
  x.send = () => {};
  x.abort = () => {};
  x.empujar = (id, accion) => {
    x.responseText += (id ? `id: ${id}\n` : '') + 'data: ' + JSON.stringify(id ? { id, accion } : { accion }) + '\n\n';
    x.readyState = 3;
    x.onprogress();
  };
  return x;
}

(async () => {
  const R = await arrancarRelevo();
  M = require(process.env.COSTURAS || './out/costuras.cjs');
  ({ RELEVO, CHATS, BORRADORES, CONTRATO, ACCIONES, ANIMO } = M);
  const A = await R.cuenta('José');
  const B = await R.cuenta('Beto Pérez');
  await R.amigos(A, B);
  await entrarComo(M, A);
  const compa = companera();
  const hechos = [];
  CONTRATO.escuchar('hecho', (h) => hechos.push(h));
  const esperarQue = async (f, ms = 6000) => {
    for (let i = 0; i < ms / 50 && !f(); i++) await espera(50);
    return f();
  };
  const bandejaDeBeto = async () => ((await R.post('/bandeja', { ...B, desde: A.correo })).mensajes || []);

  console.log('costura · el borrador de voz, en el hilo correcto\n');
  // AURA oye el correo como sea (mayúsculas): el borrador y el hilo que se abre usan la misma clave.
  const abiertos = [];
  CONTRATO.escuchar('accion', (a) => a.tipo === 'abrir_chat' && abiertos.push(a.con));
  CONTRATO.emitir('accion', { tipo: 'redactar', para: B.correo.toUpperCase(), texto: 'Llego tarde' });
  await esperarQue(() => hechos.some((h) => h.accion.tipo === 'redactar'));
  const clave = String(abiertos[0] || '').toLowerCase(); // lo que hace PantallaConversacion con `con`
  ok('abre el hilo de Beto (correo en minúsculas)', abiertos[0] === B.correo, abiertos[0]);
  ok('y el borrador está en ESE hilo, marcado como de voz', BORRADORES.borradorDe(clave)?.texto === 'Llego tarde' && BORRADORES.borradorDe(clave)?.deVoz === true);

  console.log('\ncostura · «envíalo» por el SSE y en el done del turno (doble.mts)\n');
  BORRADORES.fijarChatAbierto({ correo: B.correo, nombre: 'Beto Pérez' });
  let x;
  const puente = new ACCIONES.PuenteAcciones({
    base: 'http://x',
    token: async () => 'tok',
    cabeceras: async () => ({ 'x-aura-aparato': 'tel-prueba' }),
    xhr: () => (x = sseFalso()),
    alAccion: (a) => CONTRATO.emitir('accion', a),
    esperar: () => () => {},
  });
  puente.arrancar();
  await espera(20);
  compa.limpiar();
  x.empujar('srv-1', { tipo: 'enviar' });
  // El `done` del turno de un servidor viejo: la misma acción sin id.
  for (const a of ACCIONES.accionesDelTurno({ reply: 'Listo', acciones: [{ tipo: 'enviar' }] })) CONTRATO.emitir('accion', a);
  // El del servidor nuevo: {id, accion} con el mismo id del SSE.
  for (const a of ACCIONES.accionesDelTurno({ reply: 'Listo', acciones: [{ id: 'srv-1', accion: { tipo: 'enviar' } }] })) CONTRATO.emitir('accion', a);
  await esperarQue(() => hechos.some((h) => h.accion.tipo === 'enviar'));
  await espera(300);
  let llegaron = await bandejaDeBeto();
  ok('Beto recibe «Llego tarde» UNA vez', llegaron.length === 1, 'llegaron ' + llegaron.length);
  ok('el SSE dijo qué aparato escucha', x.cab['x-aura-aparato'] === 'tel-prueba');
  ok('AURA dice «¡Listo!» una vez', compa.dichos().filter((d) => d.ok).length === 1, JSON.stringify(compa.dichos()));
  ok('y pone una palomita', compa.palomitas() === 1);
  puente.parar();

  console.log('\ncostura · dos «envíalo» seguidos directo en el bus (doble-envio.cjs)\n');
  CONTRATO.emitir('accion', { tipo: 'redactar', para: 'beto', texto: 'Voy en camino' });
  await esperarQue(() => BORRADORES.borradorDe(B.correo)?.texto === 'Voy en camino');
  const antes = hechos.length;
  await espera(5100); // la compañera no repite «¡Listo!» dentro de 5 s (ni la palomita dentro de 2,5 s)
  compa.limpiar();
  CONTRATO.emitir('accion', { tipo: 'enviar' });
  await espera(5);
  CONTRATO.emitir('accion', { tipo: 'enviar' });
  await esperarQue(() => hechos.slice(antes).filter((h) => h.accion.tipo === 'enviar').length >= 2);
  await espera(300);
  llegaron = await bandejaDeBeto();
  const envios = hechos.slice(antes).filter((h) => h.accion.tipo === 'enviar');
  ok('«Voy en camino» llega UNA vez (dos mensajes en total en la bandeja)', llegaron.length === 2, 'en la bandeja ' + llegaron.length);
  ok('el segundo se sumó al primero: los dos hecho dicen lo mismo (ok)', envios.length === 2 && envios.every((h) => h.ok), JSON.stringify(envios.map((h) => [h.ok, h.detalle])));
  ok('AURA no dice «no pude» ni repite «¡Listo!»', compa.dichos().length === 1 && compa.dichos()[0].ok, JSON.stringify(compa.dichos()));
  ok('el borrador ya no está', BORRADORES.borradorDe(B.correo) === null);

  console.log('\ncostura · si el envío falla, el borrador vuelve y AURA lo dice\n');
  CONTRATO.emitir('accion', { tipo: 'redactar', para: 'beto', texto: 'Este no sale' });
  await esperarQue(() => BORRADORES.borradorDe(B.correo)?.texto === 'Este no sale');
  const fetchDeVerdad = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Network request failed');
  };
  compa.limpiar();
  const antes2 = hechos.length;
  CONTRATO.emitir('accion', { tipo: 'enviar' });
  await esperarQue(() => hechos.slice(antes2).some((h) => h.accion.tipo === 'enviar'));
  globalThis.fetch = fetchDeVerdad;
  const fallo = hechos.slice(antes2).find((h) => h.accion.tipo === 'enviar');
  const vuelto = BORRADORES.borradorDe(B.correo);
  ok('hecho ok:false con el motivo', fallo && fallo.ok === false && /conexión/.test(fallo.detalle), fallo && fallo.detalle);
  ok('el borrador vuelve tal cual (con su brillo de voz)', vuelto && vuelto.texto === 'Este no sale' && vuelto.deVoz === true);
  ok('AURA dice que no pudo, con el motivo (el agente se entera)', compa.dichos().some((d) => !d.ok && /conexión/.test(d.texto)), JSON.stringify(compa.dichos()));
  // Y reintentar con la red de vuelta lo manda.
  const antes3 = hechos.length;
  CONTRATO.emitir('accion', { tipo: 'enviar' });
  await esperarQue(() => hechos.slice(antes3).some((h) => h.accion.tipo === 'enviar'));
  const otra = hechos.slice(antes3).find((h) => h.accion.tipo === 'enviar');
  ok('con red, el mismo borrador sale', otra && otra.ok && BORRADORES.borradorDe(B.correo) === null && (await bandejaDeBeto()).length === 3);

  console.log('\ncostura · un mensaje escrito a mano no hace hablar a AURA\n');
  await espera(5100);
  compa.limpiar();
  const r = await CHATS.enviarTexto(B.correo, 'Esto lo escribí yo');
  await espera(50);
  ok('se envió', r.ok === true);
  ok('palomita ✔ con el nombre de Beto', compa.palomitas() === 1 && compa.efectos.some((e) => e.tipo === 'globo' && /Beto Pérez/.test(e.texto)), JSON.stringify(compa.efectos.filter((e) => e.tipo === 'globo')));
  ok('sin «¡Listo!» hablado', compa.dichos().length === 0, JSON.stringify(compa.dichos()));
  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
