/**
 * El prompt del turno: lo fijo arriba y lo del turno al final (server/prompt-turno.ts piezasDelTurno).
 *
 * llama.cpp reutiliza lo que ya leyó mientras el principio del prompt no cambie. 30-sep: la hora
 * («AHORA: …», cambia cada minuto) iba casi al principio y los HECHOS en medio, así que el nodo releía
 * ~4 000 fichas en cada turno y la primera palabra de la llamada tardaba 7–9 s (ElevenLabs corta a los 4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONGELAR_INACTIVA_MS, CONGELAR_MAX_MS, CONGELAR_MAX_NUEVOS, HILO_BASE, ventanaDelHilo, _olvidarFijos, fijoDeLaConversacion, piezasDelTurno, personalidadDelTurno, renovarFijo } from '../server/prompt-turno';
import { recordarTurno, resetMemoriaTest } from '../lib/memoria';
import { construirMensajes } from '../lib/qwen';

const base = {
  nivel: 'junta' as const,
  nombre: 'José',
  canal: 'mesa' as const,
  modo: 'CREATIVE',
  mando: false,
  quien: null,
  quienMem: null,
};

/** El system de dos turnos distintos de la misma persona. */
function dosTurnos() {
  const t1 = piezasDelTurno({ ...base, agente: null, bloqueApp: 'APP: pantalla mesa', hechos: ['SPOT XAU/USD = 3000'] }, new Date('2026-09-30T20:00:00Z'));
  const t2 = piezasDelTurno({ ...base, agente: 'investigador', bloqueApp: 'APP: pantalla chats', hechos: ['BÚSQUEDA WEB: algo'] }, new Date('2026-09-30T20:07:00Z'));
  const s1 = construirMensajes({ personalidad: t1.fijo, delTurno: t1.delTurno, user: 'Cuéntame un chiste', canal: 'mesa', nivel: 'junta' }).messages[0].content;
  const s2 = construirMensajes({ personalidad: t2.fijo, delTurno: t2.delTurno, user: 'Busca el precio del oro', canal: 'mesa', nivel: 'junta' }).messages[0].content;
  return { t1, t2, s1, s2 };
}

test('lo fijo es idéntico entre turnos aunque cambien la hora, la app, el agente y los HECHOS', () => {
  const { t1, t2 } = dosTurnos();
  assert.equal(t1.fijo, t2.fijo);
  assert.notEqual(t1.delTurno, t2.delTurno);
  assert.ok(!t1.fijo.includes('AHORA:'), 'la hora no va en lo fijo');
  assert.ok(!t1.fijo.includes('SPOT XAU'), 'los HECHOS no van en lo fijo');
  assert.ok(!t1.fijo.includes('APP: pantalla'), 'el estado de la app no va en lo fijo');
});

test('en el system, casi todo el principio es común entre turnos (lo que el nodo reutiliza)', () => {
  const { s1, s2 } = dosTurnos();
  let comun = 0;
  while (comun < s1.length && s1[comun] === s2[comun]) comun++;
  // Antes el prefijo común terminaba en la hora, a ~1 100 caracteres de ~13 500.
  assert.ok(comun / s1.length > 0.85, `prefijo común ${comun} de ${s1.length} caracteres`);
  // La hora empieza la parte que cambia: queda en el último tramo del system, no arriba.
  const i = s1.indexOf('AHORA:');
  assert.ok(i > s1.length * 0.85, `la hora va al final (posición ${i} de ${s1.length})`);
});

test('el prompt de una pieza sigue trayendo todo (la hora, el agente, la app y los HECHOS)', () => {
  const p = personalidadDelTurno({ ...base, agente: null, bloqueApp: 'APP: pantalla mesa', hechos: ['SPOT XAU/USD = 3000'] }, new Date('2026-09-30T20:00:00Z'));
  for (const trozo of ['AHORA:', 'APP: pantalla mesa', 'HECHOS:', 'SPOT XAU/USD = 3000', 'Modo de mesa pedido: CREATIVE']) assert.ok(p.includes(trozo), trozo);
});

test('el contexto del turno (para el mensaje de la persona) no trae los HECHOS ni cambia lo fijo', () => {
  const t1 = piezasDelTurno({ ...base, agente: null, bloqueApp: 'APP: pantalla mesa', hechos: ['SPOT XAU/USD = 3000'] }, new Date('2026-09-30T20:00:00Z'));
  assert.ok(t1.contexto.includes('AHORA:') && t1.contexto.includes('APP: pantalla mesa'));
  assert.ok(!t1.contexto.includes('SPOT XAU'), 'los HECHOS los pone el turno aparte (el harness les suma lo de cada herramienta)');
  assert.ok(!t1.fijo.includes(t1.contexto.slice(0, 20)));
});

/*
 * 1-oct, medido en producción después de #95: la llamada seguía releyendo 5 700 fichas por turno. La
 * memoria de la persona (hilo corto y conversación mediana) va dentro del system y cada turno la corre
 * un lugar. Durante la conversación, el fijo se congela si solo cambió la conversación.
 */
async function conversar(n: number, desde = 0) {
  for (let i = desde; i < desde + n; i++) {
    await recordarTurno({ quien: 'jose', rol: 'user', texto: `José: pregunta número ${i} sobre la mina`, canal: 'mesa' });
    await recordarTurno({ quien: 'jose', rol: 'ultron', texto: `Respuesta número ${i}, José.`, canal: 'mesa' });
  }
}
const deJose = (hiloEnMensajes = true) => piezasDelTurno({ ...base, quien: 'jose', quienMem: 'jose', agente: null, hechos: [], hiloEnMensajes });

test('con el hilo en los mensajes, la memoria del system no repite el hilo corto', async () => {
  resetMemoriaTest();
  await conversar(30);
  assert.ok(deJose(false).fijo.includes('HILO CORTO CON'), 'sin hilo en los mensajes, va como siempre');
  const p = deJose();
  assert.ok(!p.fijo.includes('HILO CORTO CON'), 'el hilo corto ya va como mensajes');
  assert.ok(p.fijo.includes('CONVERSACIÓN MEDIANA CON'), 'la mediana (lo de más atrás) sigue');
  assert.ok(!p.firma.includes('CONVERSACIÓN MEDIANA CON') && !p.firma.includes('pregunta número'), 'la firma no trae conversación');
  assert.ok(p.firma.includes('HABLAS CON: José') && p.firma.includes('ACCESO:'), 'la firma sí trae con quién habla y su acceso');
});

test('turno a turno cambia la conversación pero no la firma: se reutiliza el mismo fijo', async () => {
  resetMemoriaTest();
  _olvidarFijos();
  await conversar(30);
  const t = Date.parse('2026-10-01T01:00:00Z');
  const a = deJose();
  const f1 = fijoDeLaConversacion('j@x', a.fijo, a.firma, t);
  await conversar(1, 30);
  const b = deJose();
  assert.notEqual(a.fijo, b.fijo, 'la mediana se corrió un lugar (esto obligaba a releer)');
  assert.equal(a.firma, b.firma);
  assert.equal(fijoDeLaConversacion('j@x', b.fijo, b.firma, t + 60_000), f1, 'mismo fijo: el nodo no relee el system');
  // Otra persona no se lleva el de José.
  assert.equal(fijoDeLaConversacion('m@x', b.fijo, b.firma, t + 60_000), b.fijo);
});

test('un dato guardado no rehace el system a media conversación; otro avatar o el tiempo de vida sí', async () => {
  resetMemoriaTest();
  _olvidarFijos();
  await conversar(30);
  const t = Date.parse('2026-10-01T01:00:00Z');
  const a = deJose();
  const f1 = fijoDeLaConversacion('j@x', a.fijo, a.firma, t);
  // «… sobre la mina» se guarda solo como dato largo: antes eso rehacía el system casi cada turno.
  await recordarTurno({ quien: 'jose', rol: 'user', texto: 'José: la mina de Danlí ya tiene el permiso ambiental', canal: 'mesa' });
  const b = deJose();
  assert.ok(b.fijo.includes('permiso ambiental'), 'el fijo nuevo lo trae (entra al rehacerse)');
  assert.equal(a.firma, b.firma);
  assert.equal(fijoDeLaConversacion('j@x', b.fijo, b.firma, t + 1_000), f1);
  // Lo que pide recordar a propósito sí entra enseguida.
  await recordarTurno({ quien: 'jose', rol: 'user', texto: 'José: recuerda que mi hija se llama Ana', canal: 'mesa' });
  const pedido = deJose();
  assert.notEqual(pedido.firma, b.firma);
  assert.equal(fijoDeLaConversacion('j@x', pedido.fijo, pedido.firma, t + 1_500), pedido.fijo);
  assert.ok(pedido.fijo.includes('mi hija se llama Ana'));
  // Otro avatar u otro modo cambian la firma: se rehace enseguida.
  const otro = piezasDelTurno({ ...base, modo: 'GUARDIAN', quien: 'jose', quienMem: 'jose', agente: null, hechos: [], hiloEnMensajes: true });
  assert.notEqual(otro.firma, b.firma);
  assert.equal(fijoDeLaConversacion('j@x', otro.fijo, otro.firma, t + 2_000), otro.fijo);
  fijoDeLaConversacion('j@x', pedido.fijo, pedido.firma, t + 2_500);
  // Inactiva: se rehace.
  await conversar(1, 30);
  const c = deJose();
  assert.equal(fijoDeLaConversacion('j@x', c.fijo, c.firma, t + 2_500 + CONGELAR_INACTIVA_MS + 1), c.fijo);
  // Activa pero vieja: también se rehace al pasar el máximo.
  let ahora = t + 2_500 + CONGELAR_INACTIVA_MS + 1;
  const inicio = ahora;
  while (ahora + 5 * 60_000 - inicio < CONGELAR_MAX_MS) {
    ahora += 5 * 60_000;
    assert.equal(fijoDeLaConversacion('j@x', 'otro fijo', c.firma, ahora), c.fijo);
  }
  assert.equal(fijoDeLaConversacion('j@x', 'otro fijo', c.firma, inicio + CONGELAR_MAX_MS + 1), 'otro fijo');
});

test('el precalentamiento de la llamada renueva el fijo para que el primer turno use el mismo', () => {
  _olvidarFijos();
  const t = Date.parse('2026-10-01T01:00:00Z');
  fijoDeLaConversacion('j@x', 'fijo de la tarde', 'firma', t);
  const despues = t + 2 * 60 * 60_000;
  renovarFijo('j@x', despues);
  assert.equal(fijoDeLaConversacion('j@x', 'fijo nuevo', 'firma', despues + 5_000), 'fijo de la tarde');
  // Sin firma igual no hay renovación que valga.
  assert.equal(fijoDeLaConversacion('j@x', 'fijo nuevo', 'otra firma', despues + 6_000), 'fijo nuevo');
});

test('con el fijo congelado, la ventana del hilo crece desde el mismo principio y no pierde nada', async () => {
  // Codex en #98: con la ventana fija de 16 que se corre, lo dicho justo después de la foto se salía y
  // no estaba ni en la conversación mediana congelada ni en los mensajes.
  const { fusionarHilo } = await import('../lib/conversacion');
  _olvidarFijos();
  const t = Date.parse('2026-10-01T01:00:00Z');
  const memoria = Array.from({ length: 40 }, (_, i) => ({ rol: i % 2 ? 'ultron' : 'user', texto: `turno ${i}`, t: t - (40 - i) * 1_000 }));
  const desde = (foto: number) => memoria.filter((x) => x.t > foto).length;
  assert.equal(ventanaDelHilo('j@x', desde, t), HILO_BASE, 'sin foto, la de siempre');
  fijoDeLaConversacion('j@x', 'fijo de la foto', 'firma', t, desde);
  const principio = fusionarHilo({ durable: memoria, mensaje: '', max: ventanaDelHilo('j@x', desde, t) })[0].content;
  for (let i = 1; i <= CONGELAR_MAX_NUEVOS; i++) {
    memoria.push({ rol: i % 2 ? 'user' : 'ultron', texto: `nuevo ${i}`, t: t + i * 1_000 });
    const ahora = t + i * 1_000 + 1;
    const hilo = fusionarHilo({ durable: memoria, mensaje: '', max: ventanaDelHilo('j@x', desde, ahora) });
    assert.equal(hilo[0].content, principio, `con ${i} nuevos el principio no se mueve`);
    assert.ok(hilo.some((m) => m.content === 'nuevo 1'), `con ${i} nuevos, lo primero después de la foto sigue`);
    assert.equal(fijoDeLaConversacion('j@x', `fijo ${i}`, 'firma', ahora, desde), 'fijo de la foto');
  }
  // Pasado el tope, se rehace la foto y la ventana vuelve a la de siempre.
  memoria.push({ rol: 'user', texto: 'uno más', t: t + 100_000 });
  assert.equal(ventanaDelHilo('j@x', desde, t + 100_001), HILO_BASE);
  assert.equal(fijoDeLaConversacion('j@x', 'fijo nuevo', 'firma', t + 100_001, desde), 'fijo nuevo');
});

test('pasado el tope de turnos nuevos desde la foto, se rehace (la ventana no crece sin fin)', () => {
  _olvidarFijos();
  const t = Date.parse('2026-10-01T01:00:00Z');
  fijoDeLaConversacion('j@x', 'fijo de la foto', 'firma', t);
  const guardados: number[] = [];
  const desde = (foto: number) => guardados.filter((x) => x > foto).length;
  for (let i = 1; i <= CONGELAR_MAX_NUEVOS; i++) {
    guardados.push(t + i * 1_000);
    assert.equal(fijoDeLaConversacion('j@x', `fijo ${i}`, 'firma', t + i * 1_000 + 1, desde), 'fijo de la foto', `con ${i} turnos nuevos sigue`);
  }
  guardados.push(t + 500_000);
  assert.equal(fijoDeLaConversacion('j@x', 'fijo nuevo', 'firma', t + 500_001, desde), 'fijo nuevo', 'uno más del tope lo rehace');
  // La foto nueva cuenta desde cero.
  guardados.push(t + 501_000);
  assert.equal(fijoDeLaConversacion('j@x', 'otro', 'firma', t + 501_001, desde), 'fijo nuevo');
});
