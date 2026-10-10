/**
 * LLAMADAS DE VERDAD (auditoría del 7-oct, A-4; lib/marcar.ts, server/marcar.ts y el camino de la propuesta en
 * lib/acciones-app.ts):
 *
 *  · los números de Honduras dichos o escritos (+504, 504, 8 dígitos, en palabras), y lo que NO se adivina;
 *  · a quién se refiere: el nombre de un contacto (WhatsApp, su círculo, la app), con tratamientos («don»); dos parecidos
 *    → se pregunta cuál, nunca se elige solo; nadie → se pide el número;
 *  · SIEMPRE se pregunta «¿Le marco a X al +504…?» y solo el «sí» a ESA propuesta abre el marcador, con el número que la
 *    persona oyó (nunca uno que el modelo escriba en el turno del «sí»);
 *  · el recibo es «te abrí el marcador», nunca «ya hablé con él»; y la guarda de honestidad no deja pasar «ya hablé con
 *    él» ni «ya lo llamé» con solo el marcador abierto;
 *  · la herramienta llamar_numero va en el turno hablado solo cuando la frase pide llamar.
 */
import './datos-prueba';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dichoDeMarcar, esSoloNumero, numeroDe, numeroLegible, preguntaCualMarcar, preguntaDeMarcar, resolverParaMarcar, type ContactoTel } from '../lib/marcar';
import { decidirEnApp, ordenPorReglas, prepararAcciones, validarAccion, type ContextoApp, type Propuesta } from '../lib/acciones-app';
import { herramientasDelTurno, lineaDeHerramienta, type ManosDelTurno } from '../lib/cerebro-manos';
import { herramientasSegunFrase } from '../lib/herramientas-turno';
import { afirmacionesDeHecho, guardaDeHonestidad, recibosDeAcciones } from '../lib/honestidad';
import { MANOS } from '../lib/manos-app';
import { resolverMarcar } from '../server/marcar';

const AHORA = Date.UTC(2026, 9, 7, 18, 0);

/* ── los números ─────────────────────────────────────────────────────────────────────────── */

test('números de Honduras: +504, 504, 00504, 8 dígitos con o sin guion, dichos en palabras', () => {
  const casos: Array<[string, string]> = [
    ['+504 9876-5432', '+50498765432'],
    ['+50498765432', '+50498765432'],
    ['504 9876 5432', '+50498765432'],
    ['00504 98765432', '+50498765432'],
    ['9876-5432', '+50498765432'],
    ['98765432', '+50498765432'],
    ['(504) 3322-1100', '+50433221100'],
    ['2234 5678', '+50422345678'],
    ['nueve ocho siete seis cinco cuatro tres dos', '+50498765432'],
    ['más quinientos', ''],
    ['el 8899 0011 de Ana', '+50488990011'],
    ['+1 305 555 1234', '+13055551234'],
  ];
  for (const [dicho, esperado] of casos) assert.equal(numeroDe(dicho) ?? '', esperado, dicho);
});

test('lo que no se adivina: un fijo que no empieza en 2/3/7/8/9, 7 o 10 dígitos sin país, texto sin número', () => {
  for (const dicho of ['1234 5678', '0987 6543', '987 6543', '305 555 1234', 'don Carlos', '', '911', '+504 1234 5678']) assert.equal(numeroDe(dicho), null, dicho);
  assert.equal(esSoloNumero('al 9876 5432'), true);
  assert.equal(esSoloNumero('don Carlos del banco'), false);
  assert.equal(esSoloNumero('Carlos 9876 5432 del banco'), false, 'un nombre con un número no es «solo un número»');
  assert.equal(numeroLegible('+50498765432'), '+504 9876-5432');
  assert.equal(numeroLegible('+13055551234'), '+13055551234', 'otro país, tal cual');
});

/* ── a quién ─────────────────────────────────────────────────────────────────────────────── */

const AGENDA: ContactoTel[] = [
  { nombre: 'Carlos Banco Atlántida', numero: '+50498765432', fuente: 'whatsapp' },
  { nombre: 'Carlos Mejía', numero: '+50433221100', fuente: 'whatsapp' },
  { nombre: 'Ana Ruiz', numero: '+50488990011', fuente: 'circulo' },
  { nombre: 'Ana Ruiz', numero: '+50488990011', fuente: 'whatsapp' },
  { nombre: 'Doña Marta', numero: '+50422345678', fuente: 'whatsapp' },
];

test('a quién: el nombre, con «don/doña», y el que más palabras comparte; el mismo número de dos fuentes es uno', () => {
  assert.deepEqual(resolverParaMarcar('don Carlos del banco', AGENDA), { tipo: 'uno', nombre: 'Carlos Banco Atlántida', numero: '+50498765432' });
  assert.deepEqual(resolverParaMarcar('Ana', AGENDA), { tipo: 'uno', nombre: 'Ana Ruiz', numero: '+50488990011' }, 'Ana del círculo y de WhatsApp es la misma');
  assert.deepEqual(resolverParaMarcar('Marta', AGENDA), { tipo: 'uno', nombre: 'Doña Marta', numero: '+50422345678' });
  assert.deepEqual(resolverParaMarcar('9876 5432', AGENDA), { tipo: 'uno', nombre: 'Carlos Banco Atlántida', numero: '+50498765432' }, 'un número conocido lleva su nombre');
  assert.deepEqual(resolverParaMarcar('3344 5566', AGENDA), { tipo: 'uno', nombre: '+504 3344-5566', numero: '+50433445566' }, 'uno desconocido, el número');
});

test('contactos ambiguos: dos Carlos → se pregunta cuál con sus números; nadie → se pide el número', () => {
  const r = resolverParaMarcar('Carlos', AGENDA);
  assert.equal(r.tipo, 'varios');
  assert.equal(r.tipo === 'varios' && r.opciones.length, 2);
  if (r.tipo === 'varios') assert.equal(preguntaCualMarcar(r.opciones), '¿A cuál le marco: Carlos Banco Atlántida (+504 9876-5432) o Carlos Mejía (+504 3322-1100)?');
  assert.deepEqual(resolverParaMarcar('Pedro Pérez', AGENDA), { tipo: 'ninguno' });
  assert.deepEqual(resolverParaMarcar('Beto', AGENDA, { nombresApp: ['Beto Paz'] }), { tipo: 'ninguno', sinNumero: 'Beto Paz' }, 'de la app, pero sin número');
});

test('server/marcar: busca en su WhatsApp, su círculo y la app (con tope), sin expo-contacts', async () => {
  const pedidos: string[] = [];
  const deps = {
    whatsapp: async (_q: string, buscar: string) => {
      pedidos.push(buscar);
      return [{ nombre: 'Carlos Banco Atlántida', numero: '+50498765432' }];
    },
    circulo: async () => [{ nombre: 'Ana Ruiz', alias: ['mi esposa'], canales: { whatsapp: '50488990011@s.whatsapp.net' } }],
  };
  const ctx: ContextoApp = { pantalla: 'mesa', contactos: [{ correo: 'beto@x.com', nombre: 'Beto Paz', telefono: '+50431112222' }] };
  assert.deepEqual(await resolverMarcar({ dueno: 'jose@x.com', dicho: 'don Carlos del banco', contexto: ctx }, deps), { tipo: 'uno', nombre: 'Carlos Banco Atlántida', numero: '+50498765432' });
  assert.equal(pedidos[0], 'Carlos del banco', 'al puente va lo que identifica, sin «don»');
  assert.deepEqual(await resolverMarcar({ dueno: 'jose@x.com', dicho: 'mi esposa', contexto: ctx }, deps), { tipo: 'uno', nombre: 'Ana Ruiz', numero: '+50488990011' });
  assert.deepEqual(await resolverMarcar({ dueno: 'jose@x.com', dicho: 'Beto', contexto: ctx }, deps), { tipo: 'uno', nombre: 'Beto Paz', numero: '+50431112222' });
  // El puente que no contesta no deja colgado el turno.
  const lento = { whatsapp: () => new Promise<never>(() => {}), circulo: async () => [] };
  const t0 = Date.now();
  assert.equal((await resolverMarcar({ dueno: 'jose@x.com', dicho: 'Carlos', ms: 150 }, lento)).tipo, 'ninguno');
  assert.ok(Date.now() - t0 < 1500);
});

/* ── la confirmación ─────────────────────────────────────────────────────────────────────── */

const CTX: ContextoApp = { pantalla: 'mesa', contactos: [], manos: [...MANOS] };
const marcables = new Map([
  ['don Carlos del banco', { tipo: 'uno' as const, nombre: 'Carlos Banco Atlántida', numero: '+50498765432' }],
  ['Carlos', { tipo: 'varios' as const, opciones: AGENDA.slice(0, 2) }],
  ['Pedro', { tipo: 'ninguno' as const }],
  ['mi compadre', { tipo: 'uno' as const, nombre: 'Compadre Luis', numero: '+50431110000' }],
]);

test('SIEMPRE se pregunta primero: el turno que lo pide no marca, propone «¿Le marco a X al +504…?»', () => {
  const propuestas: Propuesta[] = [];
  const out = prepararAcciones([{ tipo: 'marcar', a: 'don Carlos del banco', via: 'telefono' }], { mensaje: 'llama a don Carlos del banco', contexto: CTX, marcables, alProponer: (p) => propuestas.push(p), ahora: AHORA });
  assert.deepEqual(out, [], 'nada sale al teléfono en el turno del pedido');
  assert.deepEqual(propuestas, [{ tipo: 'marcar', numero: '+50498765432', nombre: 'Carlos Banco Atlántida', via: 'telefono', dicho: 'don Carlos del banco' }]);
  assert.equal(preguntaDeMarcar(propuestas[0] as any), '¿Le marco a Carlos Banco Atlántida al +504 9876-5432?');
  assert.equal(preguntaDeMarcar({ nombre: '', numero: '+50433445566', via: 'telefono' }), '¿Le marco al +504 3344-5566?');
  assert.equal(preguntaDeMarcar({ nombre: 'Ana Ruiz', numero: '+50488990011', via: 'whatsapp' }), '¿Le marco a Ana Ruiz por WhatsApp al +504 8899-0011?');
});

test('el «sí» abre ESA propuesta (número y vía que oyó); otro número en el turno del «sí» no se marca: se vuelve a preguntar', () => {
  const p: Propuesta = { tipo: 'marcar', numero: '+50498765432', nombre: 'Carlos Banco Atlántida', via: 'telefono' };
  const si = prepararAcciones([{ tipo: 'marcar', a: 'don Carlos del banco', via: 'telefono', numero: '+50411111111' }], { mensaje: 'sí', contexto: CTX, marcables, propuesta: p, ahora: AHORA });
  assert.deepEqual(si, [{ tipo: 'marcar', a: 'Carlos Banco Atlántida', via: 'telefono', numero: '+50498765432', nombre: 'Carlos Banco Atlántida' }], 'el número del modelo no cuenta');
  const nuevas: Propuesta[] = [];
  const otro = prepararAcciones([{ tipo: 'marcar', a: 'mi compadre', via: 'telefono' }], { mensaje: 'sí', contexto: CTX, marcables, propuesta: p, alProponer: (x) => nuevas.push(x), ahora: AHORA });
  assert.deepEqual(otro, [], 'otra persona con el «sí» de Carlos: no se marca');
  assert.equal(nuevas[0]?.tipo === 'marcar' && nuevas[0].numero, '+50431110000');
  // Sin propuesta de antes, un «sí» no marca nada.
  assert.deepEqual(prepararAcciones([{ tipo: 'marcar', a: 'don Carlos del banco', via: 'telefono' }], { mensaje: 'sí', contexto: CTX, marcables, alProponer: () => {}, ahora: AHORA }), []);
  // «por WhatsApp» con el «sí» de la llamada normal: es otra cosa y se pregunta.
  assert.deepEqual(prepararAcciones([{ tipo: 'marcar', a: 'don Carlos del banco', via: 'whatsapp' }], { mensaje: 'sí', contexto: CTX, marcables, propuesta: p, alProponer: () => {}, ahora: AHORA }), []);
});

test('se decide como una llamada: «sí», «dale», «sí, márcale» cumplen; «no» la suelta («Va, no marco»)', () => {
  const p: Propuesta = { tipo: 'marcar', numero: '+50498765432', nombre: 'Carlos Banco Atlántida', via: 'telefono' };
  for (const m of ['sí', 'dale', 'sí, márcale', 'okey']) assert.equal(decidirEnApp(m, { contexto: CTX, propuesta: p }).tipo, 'ejecutar', m);
  const r = ordenPorReglas('sí', { contexto: CTX, propuesta: p, ahora: AHORA });
  assert.deepEqual(r?.accion, { tipo: 'marcar', a: 'Carlos Banco Atlántida', via: 'telefono', numero: '+50498765432', nombre: 'Carlos Banco Atlántida' });
  assert.equal(r?.decir, 'Te abrí el marcador con el número de Carlos Banco Atlántida, +504 9876-5432: tócale llamar.');
  const no = ordenPorReglas('no', { contexto: CTX, propuesta: p, ahora: AHORA });
  assert.equal(no?.accion, null);
  assert.equal(no?.soltarPropuesta, true);
  assert.equal(no?.decir, 'Va, no marco.');
});

test('ambiguo o desconocido: no se propone nada; quien llama pregunta cuál o el número', () => {
  const dudas: string[] = [];
  const propuestas: Propuesta[] = [];
  const o = { contexto: CTX, marcables, alProponer: (p: Propuesta) => propuestas.push(p), alDudaMarcar: (d: string) => dudas.push(d), ahora: AHORA };
  assert.deepEqual(prepararAcciones([{ tipo: 'marcar', a: 'Carlos', via: 'telefono' }], { ...o, mensaje: 'llama a Carlos' }), []);
  assert.deepEqual(prepararAcciones([{ tipo: 'marcar', a: 'Pedro', via: 'telefono' }], { ...o, mensaje: 'llama a Pedro' }), []);
  assert.deepEqual(dudas, ['Carlos', 'Pedro']);
  assert.equal(propuestas.length, 0);
});

test('el camino rápido: «márcale al 9876 5432» propone sin cerebro; un teléfono sin la mano `marcar` no', () => {
  const r = ordenPorReglas('márcale al 9876 5432', { contexto: CTX, ahora: AHORA });
  assert.deepEqual(r?.propuesta, { tipo: 'marcar', numero: '+50498765432', nombre: '', via: 'telefono' });
  assert.equal(r?.decir, '¿Le marco al +504 9876-5432?');
  assert.equal(r?.accion, null, 'nunca sale en el turno del pedido');
  const wa = ordenPorReglas('llama al +504 8899-0011 por WhatsApp', { contexto: CTX, ahora: AHORA });
  assert.equal(wa?.propuesta?.tipo === 'marcar' && wa.propuesta.via, 'whatsapp');
  const viejo = ordenPorReglas('márcale al 9876 5432', { contexto: { ...CTX, manos: MANOS.filter((m) => m !== 'marcar') }, ahora: AHORA });
  assert.notEqual(viejo?.propuesta?.tipo, 'marcar');
});

test('la línea de la herramienta y su validación: del modelo solo «a quién» y la vía', () => {
  assert.equal(lineaDeHerramienta('llamar_numero', { a: 'don Carlos del banco' }), 'ACCION_APP: {"tipo":"marcar","a":"don Carlos del banco","via":"telefono"}');
  assert.equal(lineaDeHerramienta('llamar_numero', { a: '9876 5432', por: 'whatsapp' }), 'ACCION_APP: {"tipo":"marcar","a":"9876 5432","via":"whatsapp"}');
  assert.equal(lineaDeHerramienta('llamar_numero', {}), null);
  assert.deepEqual(validarAccion({ tipo: 'marcar', a: 'Ana', via: 'satelite' }), { tipo: 'marcar', a: 'Ana', via: 'telefono' });
  assert.deepEqual(validarAccion({ tipo: 'marcar', numero: 'ACCION_APP' }), null);
});

/* ── la honestidad ───────────────────────────────────────────────────────────────────────── */

test('el recibo es «te abrí el marcador», nunca «ya hablé con él» ni «ya lo llamé»', () => {
  const p = { nombre: 'Carlos Banco Atlántida', numero: '+50498765432', via: 'telefono' as const };
  for (const idioma of ['es', 'en'] as const) {
    const dicho = dichoDeMarcar(p, idioma);
    assert.match(dicho, idioma === 'es' ? /abrí el marcador/ : /opened the dialer/);
    assert.doesNotMatch(dicho, /habl[eé]|llam[eé]\b|contest|talked|spoke|called/i, dicho);
    assert.deepEqual(afirmacionesDeHecho(dicho), [], 'el recibo no afirma ningún efecto que no pasó');
  }
  assert.match(dichoDeMarcar({ ...p, via: 'whatsapp' }), /Te abrí WhatsApp con Carlos Banco Atlántida: tócale el botón de llamar\./);
});

test('la guarda: con solo el marcador abierto, «ya hablé con él» y «ya lo llamé» se dicen como son', () => {
  const recibos = recibosDeAcciones([{ tipo: 'marcar' }]);
  assert.deepEqual(recibos, [{ canal: 'marcador', estado: 'confirmado' }]);
  const a = guardaDeHonestidad('Listo, ya hablé con él.', { recibos, mensaje: 'sí' });
  assert.equal(a.cambiada, true);
  assert.equal(a.texto, 'Solo te abrí el marcador: la llamada la haces tú, y no sé si contestó.');
  const b = guardaDeHonestidad('Ya le llamé a Carlos.', { recibos, mensaje: 'sí' });
  assert.equal(b.cambiada, true);
  assert.match(b.texto, /Solo te abrí el marcador/);
  // Una llamada de PULSE2CHAT de verdad sí respalda «le llamé».
  assert.equal(guardaDeHonestidad('Ya le llamé a Carlos.', { recibos: recibosDeAcciones([{ tipo: 'llamar', con: 'carlos@x.com' }]), mensaje: 'sí' }).cambiada, false);
  // Sin nada, la verdad de siempre.
  assert.equal(guardaDeHonestidad('Ya hablé con él.', { recibos: [], mensaje: 'sí' }).texto, 'Todavía no hice esa llamada.');
});

/* ── la herramienta en el turno hablado ──────────────────────────────────────────────────── */

const MANOS_TURNO: ManosDelTurno = { app: true, manos: [...MANOS], sistema: false, computadora: false, correo: false, whatsapp: true, sesion: true, triaje: false };
const nombres = (msg: string, anterior?: string) => herramientasSegunFrase(herramientasDelTurno(MANOS_TURNO), { mensaje: msg, anterior }).herramientas.map((t) => t.toolSpec?.name);

test('llamar_numero va solo cuando la frase pide llamar (o es un número)', () => {
  assert.ok(herramientasDelTurno(MANOS_TURNO).some((t) => t.toolSpec?.name === 'llamar_numero'));
  assert.ok(!herramientasDelTurno({ ...MANOS_TURNO, manos: MANOS.filter((m) => m !== 'marcar') }).some((t) => t.toolSpec?.name === 'llamar_numero'), 'sin la mano, no está');
  for (const m of ['llama a don Carlos del banco', 'márcale al 9876 5432', 'llámale a mi compadre por WhatsApp', 'el 9876 5432']) assert.ok(nombres(m).includes('llamar_numero'), m);
  // Auditoría del 10-oct: llamar_numero va en el núcleo (siempre); la charla no pide el GRUPO de llamada.
  for (const m of ['¿cómo estás?', 'cuéntame un chiste', '¿cuánto está el dólar hoy?']) assert.ok(!herramientasSegunFrase(herramientasDelTurno(MANOS_TURNO), { mensaje: m }).grupos.includes('llamada'), m);
});
