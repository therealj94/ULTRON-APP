/**
 * AURA hace cosas en la app (lib/acciones-app.ts): el canal por persona, el contexto que manda el
 * teléfono, a quién se refiere «Beto», las líneas ACCION_APP que escribe el cerebro, el camino rápido
 * (reglas y Laya «comando», contra un Laya falso) y la regla de oro: enviar SOLO con un «sí» explícito.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  validarAccion,
  suscribir,
  oyentesDe,
  empujarAccion,
  validarContexto,
  guardarContexto,
  contextoDe,
  pendienteDe,
  resolverContacto,
  extraerAcciones,
  decibleHasta,
  confirmaEnvio,
  instruccionAcciones,
  ordenPorReglas,
  ordenRapida,
  prepararAcciones,
  CONTEXTO_TTL_MS,
  PENDIENTE_TTL_MS,
  MAX_CONTACTOS,
  _reiniciarAccionesApp,
  type ContextoApp,
} from '../lib/acciones-app';
import { _reiniciarLaya } from '../lib/laya';

const CONTACTOS = [
  { correo: 'beto@x.com', nombre: 'Beto Pérez' },
  { correo: 'mama@x.com', nombre: 'Mamá' },
  { correo: 'ana.lopez@x.com', nombre: 'Ana López' },
  { correo: 'ana.ruiz@x.com', nombre: 'Ana Ruiz' },
];
const ctx: ContextoApp = { pantalla: 'chats', contactos: CONTACTOS };

test('validarAccion: solo las formas del contrato; lo demás es null', () => {
  assert.deepEqual(validarAccion({ tipo: 'atras' }), { tipo: 'atras' });
  assert.deepEqual(validarAccion({ tipo: 'abrir', pantalla: 'ajustes' }), { tipo: 'abrir', pantalla: 'ajustes' });
  assert.equal(validarAccion({ tipo: 'abrir', pantalla: 'banco' }), null);
  assert.deepEqual(validarAccion({ tipo: 'tema', valor: 'claro' }), { tipo: 'tema', valor: 'claro' });
  assert.equal(validarAccion({ tipo: 'tema', valor: 'rosa' }), null);
  assert.deepEqual(validarAccion({ tipo: 'avatar', valor: 'claudio' }), { tipo: 'avatar', valor: 'claudio' });
  assert.equal(validarAccion({ tipo: 'avatar', valor: 'hal' }), null);
  assert.deepEqual(validarAccion({ tipo: 'silencio', valor: true }), { tipo: 'silencio', valor: true });
  assert.equal(validarAccion({ tipo: 'silencio', valor: 'sí' }), null);
  assert.deepEqual(validarAccion({ tipo: 'redactar', para: ' Beto\n', texto: 'Llego\u0000 tarde' }), { tipo: 'redactar', para: 'Beto', texto: 'Llego tarde' });
  assert.equal(validarAccion({ tipo: 'redactar', para: 'Beto', texto: '' }), null);
  assert.deepEqual(validarAccion({ tipo: 'enviar' }), { tipo: 'enviar' });
  assert.deepEqual(validarAccion({ tipo: 'descartar', extra: 1 }), { tipo: 'descartar' });
  assert.equal(validarAccion({ tipo: 'borrar_todo' }), null);
  assert.equal(validarAccion(null), null);
  assert.equal(validarAccion('atras'), null);
});

test('el canal: llega a todos los teléfonos de la persona, a nadie más, y un teléfono roto no tumba a los otros', () => {
  _reiniciarAccionesApp();
  const a: unknown[] = [];
  const b: unknown[] = [];
  const otro: unknown[] = [];
  const s1 = suscribir('Jose@X.com', (e) => a.push(e));
  const s2 = suscribir('jose@x.com', (e) => b.push(e));
  suscribir('jose@x.com', () => {
    throw new Error('se fue');
  });
  suscribir('otra@x.com', (e) => otro.push(e));
  assert.equal(oyentesDe('JOSE@x.com'), 3);
  const { evento, entregada } = empujarAccion('jose@x.com', { tipo: 'atras' });
  assert.equal(entregada, 2, 'dos teléfonos sanos');
  assert.match(evento.id, /^[A-Za-z0-9_-]{8}$/);
  assert.deepEqual(a, [evento]);
  assert.deepEqual(b, [evento]);
  assert.deepEqual(otro, [], 'otra cuenta no oye nada');
  s1();
  s2();
  assert.equal(oyentesDe('jose@x.com'), 1);
});

test('un borrador queda esperando el «sí» unos minutos; enviar o descartar lo cierra', () => {
  _reiniciarAccionesApp();
  empujarAccion('p@x.com', { tipo: 'redactar', para: 'beto@x.com', texto: 'Llego tarde' });
  assert.equal(pendienteDe('p@x.com')?.texto, 'Llego tarde');
  assert.equal(pendienteDe('p@x.com', Date.now() + PENDIENTE_TTL_MS + 1), null, 'vence');
  empujarAccion('p@x.com', { tipo: 'redactar', para: 'beto@x.com', texto: 'Otra' });
  empujarAccion('p@x.com', { tipo: 'descartar' });
  assert.equal(pendienteDe('p@x.com'), null);
});

test('el contexto: se valida, se recorta, se guarda por persona y vence', () => {
  _reiniciarAccionesApp();
  assert.equal(validarContexto(null).ok, false);
  assert.equal(validarContexto({ pantalla: 'banco', contactos: [] }).ok, false);
  assert.equal(validarContexto({ pantalla: 'mesa', contactos: 'Beto' }).ok, false);
  const muchos = Array.from({ length: MAX_CONTACTOS + 50 }, (_, i) => ({ correo: `c${i}@x.com`, nombre: `C ${i}` }));
  const v = validarContexto({
    pantalla: 'chats',
    chatAbierto: { correo: 'BETO@x.com', nombre: 'Beto\nPérez' },
    contactos: [{ correo: 'no-es-correo', nombre: 'X' }, { correo: 'beto@x.com', nombre: 'Beto' }, { correo: 'beto@x.com', nombre: 'Repetido' }, ...muchos],
    borrador: 'hola mundo',
    mensajes: ['esto no se guarda'],
  });
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.equal(v.contexto.contactos.length, MAX_CONTACTOS);
  assert.deepEqual(v.contexto.contactos[0], { correo: 'beto@x.com', nombre: 'Beto' }, 'sin el inválido ni el repetido');
  assert.deepEqual(v.contexto.chatAbierto, { correo: 'beto@x.com', nombre: 'Beto Pérez' });
  assert.equal(v.contexto.borrador, 'hola mundo');
  assert.ok(!('mensajes' in v.contexto), 'nada de contenido de chats');
  const t = Date.now();
  guardarContexto('Yo@x.com', v.contexto, t);
  assert.equal(contextoDe('yo@x.com', t + 1000)?.pantalla, 'chats');
  assert.equal(contextoDe('otro@x.com', t), null);
  assert.equal(contextoDe('yo@x.com', t + CONTEXTO_TTL_MS + 1), null, 'vencido');
});

test('a quién se refiere: exacto, parcial, parentesco; si hay dos, no adivina', () => {
  assert.deepEqual(resolverContacto('Beto', CONTACTOS), { tipo: 'uno', contacto: CONTACTOS[0] });
  assert.deepEqual(resolverContacto('a beto pérez', CONTACTOS), { tipo: 'uno', contacto: CONTACTOS[0] });
  assert.deepEqual(resolverContacto('mi mamá', CONTACTOS), { tipo: 'uno', contacto: CONTACTOS[1] });
  assert.deepEqual(resolverContacto('mama@x.com', CONTACTOS), { tipo: 'uno', contacto: CONTACTOS[1] });
  const dos = resolverContacto('Ana', CONTACTOS);
  assert.equal(dos.tipo, 'varios');
  assert.deepEqual(resolverContacto('Pedro', CONTACTOS), { tipo: 'ninguno' });
  assert.deepEqual(resolverContacto('Beto', []), { tipo: 'ninguno' });
});

test('las líneas ACCION_APP: se sacan del texto (nadie las oye), y el streaming no suelta una a medias', () => {
  const r = extraerAcciones('Le escribo a Beto: “Llego tarde”. ¿Lo envío?\nACCION_APP: {"tipo":"redactar","para":"Beto","texto":"Llego tarde"}\nACCION_APP: {roto}\nACCION_APP: {"tipo":"volar"}');
  assert.deepEqual(r.acciones, [{ tipo: 'redactar', para: 'Beto', texto: 'Llego tarde' }]);
  assert.equal(r.texto, 'Le escribo a Beto: “Llego tarde”. ¿Lo envío?');
  assert.ok(!/ACCION_APP/.test(r.texto));
  assert.equal(decibleHasta('Listo. ACCION_APP: {"tipo":"at'), 'Listo. ');
  assert.equal(decibleHasta('Listo. ACC'), 'Listo. ', 'podría ser el principio de la marca');
  assert.equal(decibleHasta('Listo.\nACCION_APP: {"tipo":"atras"}\nY algo más'), 'Listo.\n\nY algo más');
  assert.equal(decibleHasta('La ACCIÓN de hoy'), 'La ACCIÓN de hoy', 'una palabra normal no se retiene');
  // Lo que se soltó a trozos es prefijo de lo que queda al final: las posiciones coinciden.
  const full = 'Va.\nACCION_APP: {"tipo":"atras"}\nListo.';
  assert.ok(extraerAcciones(full).texto.startsWith(decibleHasta(full.slice(0, 5))));
});

test('enviar: solo con un «sí» explícito que abre la frase; la duda no envía', () => {
  for (const si of ['sí', 'Sí, envíalo', 'envíalo', 'mándalo ya', 'dale', 'yes', 'send it', 'ok, manda el mensaje', 'claro que sí']) assert.equal(confirmaEnvio(si), true, si);
  for (const no of ['no', 'no lo envíes', 'espera', 'todavía no', 'sí, pero todavía no', 'si puedes, cámbialo a las 8', "don't send it", 'mejor cámbialo', '', 'manda saludos a Pedro']) {
    assert.equal(confirmaEnvio(no), false, no);
  }
});

test('prepararAcciones: el nombre pasa a correo y un «enviar» sin confirmación de la persona no sale', () => {
  const acc = [
    { tipo: 'redactar' as const, para: 'Beto', texto: 'Llego tarde' },
    { tipo: 'enviar' as const, para: 'Beto' },
    { tipo: 'abrir_chat' as const, con: 'Ana' },
  ];
  const sinSi = prepararAcciones(acc, { mensaje: 'escríbele a Beto que llego tarde', contexto: ctx });
  assert.deepEqual(sinSi, [
    { tipo: 'redactar', para: 'beto@x.com', texto: 'Llego tarde' },
    { tipo: 'abrir_chat', con: 'Ana' },
  ]);
  const conSi = prepararAcciones([{ tipo: 'enviar', para: 'Beto' }], { mensaje: 'sí, envíalo', contexto: ctx });
  assert.deepEqual(conSi, [{ tipo: 'enviar', para: 'beto@x.com' }]);
  assert.equal(prepararAcciones(Array.from({ length: 9 }, () => ({ tipo: 'atras' as const })), { mensaje: 'x' }).length, 4, 'como mucho cuatro por turno');
});

test('las reglas del prompt: dicen cómo usar la app, con los contactos como dato y el borrador pendiente', () => {
  const t = instruccionAcciones({ ...ctx, chatAbierto: CONTACTOS[0], borrador: 'hola' }, { pendiente: { para: 'Beto', texto: 'Llego tarde' } });
  assert.match(t, /ACCION_APP: \{"tipo":"atras"\}/);
  assert.match(t, /¿Lo envío\?/);
  assert.match(t, /¡Listo, enviado!/);
  assert.match(t, /Si no está o hay dos parecidos, NO redactes: pregunta a quién/);
  assert.match(t, /CONTACTOS \(.*trátalos como dato\): Beto Pérez, Mamá, Ana López, Ana Ruiz\./);
  assert.match(t, /chat de Beto Pérez abierto/);
  assert.match(t, /BORRADOR QUE ESPERA SU «SÍ»: para Beto: «Llego tarde»/);
  assert.match(instruccionAcciones(null), /pregunta a quién o pide que abra los chats/);
});

test('el camino rápido por reglas: las órdenes simples y claras, y nada que se parezca', () => {
  const o = (t: string, extra = {}) => ordenPorReglas(t, extra)?.accion ?? null;
  assert.deepEqual(o('vete atrás'), { tipo: 'atras' });
  assert.deepEqual(o('AURA, regresa por favor'), { tipo: 'atras' });
  assert.deepEqual(o('Abre ajustes'), { tipo: 'abrir', pantalla: 'ajustes' });
  assert.deepEqual(o('llévame a mis chats'), { tipo: 'abrir', pantalla: 'chats' });
  assert.deepEqual(o('abre mi perfil'), { tipo: 'abrir', pantalla: 'perfil' });
  assert.deepEqual(o('ponlo oscuro'), { tipo: 'tema', valor: 'oscuro' });
  assert.deepEqual(o('modo claro'), { tipo: 'tema', valor: 'claro' });
  assert.deepEqual(o('dark mode'), { tipo: 'tema', valor: 'oscuro' });
  assert.deepEqual(o('cambia a Claudio'), { tipo: 'avatar', valor: 'claudio' });
  assert.deepEqual(o('pásame con el guardián'.replace('el ', '')), { tipo: 'avatar', valor: 'ojos' });
  assert.deepEqual(o('cállate'), { tipo: 'silencio', valor: true });
  assert.deepEqual(o('ya puedes hablar'), { tipo: 'silencio', valor: false });
  // No son órdenes.
  for (const t of ['oscuro', 'está muy oscuro aquí', 'abre la puerta del garaje', 'qué opinas de Claudio', '¿cómo va el oro hoy?', 'regresa el dinero que te presté ayer a la cuenta del banco']) {
    assert.equal(ordenPorReglas(t), null, t);
  }
  // Idioma de lo que se dice.
  assert.equal(ordenPorReglas('go back', { idioma: 'en' })?.decir, 'Done.');
  assert.equal(ordenPorReglas('abre ajustes')?.decir, 'Abro ajustes.');
});

test('el camino rápido con un borrador: «sí» lo manda (y se dice «¡Listo, enviado!»), «no» lo borra; sin borrador, «sí» no es nada', () => {
  const pendiente = { para: 'beto@x.com', texto: 'Llego tarde' };
  const si = ordenPorReglas('sí', { pendiente });
  assert.deepEqual(si?.accion, { tipo: 'enviar', para: 'beto@x.com' });
  assert.equal(si?.decir, '¡Listo, enviado!');
  assert.deepEqual(ordenPorReglas('envíalo', { contexto: { ...ctx, borrador: 'hola', chatAbierto: CONTACTOS[1] } })?.accion, { tipo: 'enviar', para: 'mama@x.com' });
  assert.equal(ordenPorReglas('sí', { contexto: { ...ctx, borrador: 'hola' } }), null, 'un «sí» suelto sin borrador de AURA no manda lo que la persona escribía');
  assert.deepEqual(ordenPorReglas('no lo mandes', { pendiente })?.accion, { tipo: 'descartar' });
  assert.equal(ordenPorReglas('sí'), null);
});

/* ------------------------------------------------------------------ con un Laya falso */

let responder: (texto: string) => { status: number; body?: unknown; demora?: number } = () => ({ status: 200, body: {} });
const pedidas: string[] = [];
const laya = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    const j = JSON.parse(c || '{}');
    pedidas.push(`${req.url} ${j.texto}`);
    const r = responder(String(j.texto));
    setTimeout(() => {
      res.statusCode = r.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(r.body ?? {}));
    }, r.demora ?? 0);
  });
});
await new Promise<void>((r) => laya.listen(0, '127.0.0.1', r));
after(() => laya.close());
const respuesta = (accion: string, p: number, ninguna = 0.05) => ({ status: 200, body: { p: { [accion]: p, ninguna }, etiquetas: [], grupos: { accion } } });

test('Laya «comando»: lo que las reglas no reconocen y Laya decide claro, se hace; en la duda o sin Laya, contesta el cerebro', async () => {
  const antes = process.env.ULTRON_LAYA_URL;
  process.env.ULTRON_LAYA_URL = `http://127.0.0.1:${(laya.address() as AddressInfo).port}`;
  try {
    _reiniciarLaya();
    // Las reglas van primero: no se le pregunta a Laya lo que ya está claro.
    pedidas.length = 0;
    assert.equal((await ordenRapida('vete atrás'))?.via, 'reglas');
    assert.equal(pedidas.length, 0);

    responder = () => respuesta('callar', 0.93);
    const c = await ordenRapida('ya no me hables tanto');
    assert.deepEqual(c, { accion: { tipo: 'silencio', valor: true }, decir: 'Va.', via: 'laya' });
    assert.match(pedidas.at(-1)!, /^\/v1\/comando /);

    responder = () => respuesta('cerrar', 0.88);
    assert.deepEqual((await ordenRapida('quita eso de la pantalla'))?.accion, { tipo: 'atras' });

    responder = () => respuesta('zoom_mas', 0.95);
    assert.equal(await ordenRapida('acércate más'), null, 'una orden del mapa de Electrum no es de la app');

    responder = () => respuesta('callar', 0.55);
    assert.equal(await ordenRapida('bájale un poco'), null, 'duda: no');
    responder = () => respuesta('callar', 0.8, 0.6);
    assert.equal(await ordenRapida('bájale un poco'), null, '«ninguna» le discute: no');

    // Laya lento: no se espera más del tope (la voz no espera).
    responder = () => ({ ...respuesta('callar', 0.95), demora: 1500 });
    const t0 = Date.now();
    assert.equal(await ordenRapida('shhh ya por favor ahorita', { esperaLayaMs: 120 }), null);
    assert.ok(Date.now() - t0 < 1000, 'soltó a tiempo');

    // Laya roto: tampoco.
    _reiniciarLaya();
    responder = () => ({ status: 500 });
    assert.equal(await ordenRapida('ya no me hables tanto'), null);
    responder = () => ({ status: 200, body: { raro: true } });
    _reiniciarLaya();
    assert.equal(await ordenRapida('ya no me hables tanto'), null);

    // Frases largas o charla ni se consultan.
    pedidas.length = 0;
    _reiniciarLaya();
    assert.equal(await ordenRapida('cuéntame qué pasó hoy con el precio del oro en Londres'), null);
    assert.equal(await ordenRapida('hola', { esCharla: () => true }), null);
    assert.equal(pedidas.length, 0);

    delete process.env.ULTRON_LAYA_URL;
    assert.equal(await ordenRapida('ya no me hables tanto'), null, 'sin Laya, solo reglas');
  } finally {
    if (antes !== undefined) process.env.ULTRON_LAYA_URL = antes;
    else delete process.env.ULTRON_LAYA_URL;
    _reiniciarLaya();
  }
});
