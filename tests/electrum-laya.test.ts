/**
 * Laya decide el panel de Electrum cuando el nodo T4 contesta, y la tabla de siempre cuando no.
 *
 * Aquí no corre el modelo: un servidor falso hace de /decidir para comprobar lo que depende de
 * nosotros. Que un nodo lento o caído no retrasa ni rompe el turno, que los que el usuario nombró
 * van primero y que un id que no existe no se cuela en el panel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { decidirPanel, convocar } from '../server/electrum/especialistas';
import { _reiniciarLaya, consultarLaya, decidirLaya, estadoLaya, recortarParaLaya, saludLaya, urlSegura, CABEZA, COLA } from '../lib/laya';
import { enTurno, iniciarTraza } from '../lib/cognitivo/traza';

type Respuesta = { status?: number; cuerpo?: unknown; demoraMs?: number };
let siguiente: Respuesta = {};
let ultimo: { auth?: string; texto?: string; ruta?: string } = {};
let conexiones = 0;

const falso: Server = createServer((q, r) => {
  let datos = '';
  q.on('data', (c) => (datos += c));
  q.on('end', () => {
    ultimo = { auth: q.headers.authorization, texto: JSON.parse(datos || '{}').texto, ruta: q.url };
    setTimeout(() => {
      r.writeHead(siguiente.status || 200, { 'content-type': 'application/json' });
      r.end(JSON.stringify(siguiente.cuerpo ?? {}));
    }, siguiente.demoraMs || 0);
  });
});

falso.on('connection', () => conexiones++);

const ids = (p: { id: string }[]) => p.map((e) => e.id);

test('panel con Laya', async (t) => {
  await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok));
  const { port } = falso.address() as { port: number };
  process.env.ULTRON_LAYA_URL = `http://127.0.0.1:${port}/`;
  process.env.ULTRON_LAYA_CLAVE = 'secreto-de-prueba';
  process.env.ULTRON_LAYA_TIMEOUT_MS = '200';

  t.after(() => {
    falso.close();
    delete process.env.ULTRON_LAYA_URL;
    delete process.env.ULTRON_LAYA_CLAVE;
    delete process.env.ULTRON_LAYA_TIMEOUT_MS;
  });

  await t.test('usa lo que decide Laya y manda la clave', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['legal'], p: { legal: 0.97 }, umbral: 0.5, ms: 30 } };
    const r = await decidirPanel('¿Cuándo vence la concesión Quebrada Seca?');
    assert.equal(r.fuente, 'laya');
    assert.deepEqual(ids(r.panel), ['legal']);
    assert.equal(ultimo.auth, 'Bearer secreto-de-prueba');
    assert.equal(ultimo.texto, '¿Cuándo vence la concesión Quebrada Seca?');
  });

  await t.test('Laya puede decir que no hace falta nadie', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: [], p: {}, umbral: 0.5, ms: 20 } };
    const r = await decidirPanel('hola, ¿cómo va?');
    assert.equal(r.fuente, 'laya');
    assert.deepEqual(r.panel, []);
  });

  await t.test('si Laya no pone a nadie en una pregunta técnica, decide la tabla y se dice', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: [], p: { geologo: 0.12, minas: 0.03 }, umbral: 0.5, ms: 30 } };
    const q = '¿qué es un skarn?';
    const reg = iniciarTraza({ plataforma: 'electrum', pregunta: q });
    const r = await enTurno(reg, () => decidirPanel(q));
    assert.equal(r.fuente, 'laya+tabla');
    assert.deepEqual(ids(r.panel), ids(convocar(q)));
    assert.ok(r.panel.length > 0);
    assert.equal(reg.t.pasos[0].ok, true);
    assert.equal(reg.t.pasos[0].resumen, `laya → nadie, tabla → ${ids(r.panel).join(', ')} (geologo 0.12 · minas 0.03; modelo 30 ms)`);
  });

  await t.test('el que el usuario nombra va primero, aunque Laya no lo ponga', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['economista', 'minas'], p: {}, umbral: 0.5, ms: 20 } };
    const r = await decidirPanel('pásame al geólogo: ¿cuánto cuesta la tonelada?');
    assert.deepEqual(ids(r.panel), ['geologo', 'economista']);
  });

  await t.test('un id desconocido no entra al panel', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['astrologo', 'civil'], p: {}, umbral: 0.5, ms: 20 } };
    assert.deepEqual(ids((await decidirPanel('¿aguanta el puente con 30 toneladas?')).panel), ['civil']);
  });

  await t.test('si Laya tarda, la tabla, sin esperar de más', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['legal'] }, demoraMs: 1000 };
    const t0 = Date.now();
    const r = await decidirPanel('qué tipo de yacimiento es un pórfido');
    assert.equal(r.fuente, 'tabla');
    assert.deepEqual(ids(r.panel), ids(convocar('qué tipo de yacimiento es un pórfido')));
    assert.ok(Date.now() - t0 < 600, `tardó ${Date.now() - t0} ms`);
  });

  await t.test('tras un fallo no vuelve a llamar enseguida', async () => {
    // El caso anterior dejó a Laya en pausa: esta llamada ni siquiera sale.
    siguiente = { cuerpo: { panel: ['legal'] } };
    ultimo = {};
    assert.equal(await decidirLaya('¿cuándo vence la concesión?'), null);
    assert.deepEqual(ultimo, {});
  });

  await t.test('un error del nodo o una respuesta rara también caen a la tabla', async () => {
    _reiniciarLaya();
    siguiente = { status: 500, cuerpo: { error: 'x' } };
    assert.equal((await decidirPanel('cuándo vence la concesión')).fuente, 'tabla');
    _reiniciarLaya();
    siguiente = { cuerpo: { nada: true } };
    assert.equal((await decidirPanel('cuándo vence la concesión')).fuente, 'tabla');
  });

  await t.test('dice por qué no contestó y la pausa crece si sigue fallando', async () => {
    _reiniciarLaya();
    siguiente = { status: 500, cuerpo: { error: 'x' } };
    const a = await consultarLaya('cuándo vence la concesión');
    assert.equal(a.motivo, 'http 500');
    assert.equal(a.decision, null);
    const e1 = estadoLaya();
    assert.equal(e1.fallos, 1);
    assert.equal(e1.ultimoMotivo, 'http 500');
    const pausa1 = Date.parse(e1.enPausaHasta!) - Date.now();
    assert.ok(pausa1 > 4000 && pausa1 <= 5000, `primera pausa ${pausa1} ms`);
    assert.equal((await consultarLaya('cuándo vence la concesión')).motivo, 'en pausa');
    // Un panel con algo que no es un id tampoco se da por bueno.
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: [7, 'legal'] } };
    assert.equal((await consultarLaya('x')).motivo, 'respuesta rara');
  });

  await t.test('la pausa se duplica con cada fallo seguido y un acierto la borra', async (tt) => {
    _reiniciarLaya();
    tt.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    siguiente = { status: 503, cuerpo: {} };
    const pausas: number[] = [];
    for (let i = 0; i < 3; i++) {
      await consultarLaya('cuándo vence la concesión');
      pausas.push(Date.parse(estadoLaya().enPausaHasta!) - Date.now());
      tt.mock.timers.tick(pausas[i] + 1);
    }
    assert.deepEqual(pausas, [5000, 10000, 20000]);
    siguiente = { cuerpo: { panel: ['legal'], p: { legal: 0.9 }, umbral: 0.5, ms: 5 } };
    assert.equal((await consultarLaya('cuándo vence la concesión')).motivo, 'ok');
    const e = estadoLaya();
    assert.equal(e.fallosSeguidos, 0);
    assert.equal(e.enPausaHasta, null);
    assert.equal(e.vivo, true);
    assert.equal(e.decisiones, 1);
  });

  await t.test('un tiempo agotado se nombra como tal', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['legal'] }, demoraMs: 400 };
    const r = await consultarLaya('cuándo vence la concesión');
    assert.equal(r.motivo, 'tiempo agotado');
    assert.ok(r.ms >= 190 && r.ms < 400, `${r.ms} ms`);
  });

  await t.test('la traza del turno dice de dónde salió el panel', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['legal', 'geomatica'], p: { legal: 0.96, geomatica: 0.81, civil: 0.02 }, umbral: 0.5, ms: 41 } };
    const reg = iniciarTraza({ plataforma: 'electrum', pregunta: '¿se traslapa y quién tiene prelación?' });
    const r = await enTurno(reg, () => decidirPanel('¿se traslapa y quién tiene prelación?'));
    assert.equal(r.fuente, 'laya');
    assert.equal(r.motivo, 'ok');
    const [paso] = reg.t.pasos;
    assert.equal(paso.herramienta, 'laya_panel');
    assert.equal(paso.ok, true);
    assert.match(paso.resumen!, /^laya → legal, geomatica \(legal 0\.96 · geomatica 0\.81 · civil 0\.02; modelo 41 ms\)$/);

    // Cae a la tabla: el paso sale en rojo y con el motivo.
    _reiniciarLaya();
    siguiente = { status: 401, cuerpo: { error: 'clave' } };
    const reg2 = iniciarTraza({ plataforma: 'electrum', pregunta: 'qué tipo de yacimiento es un pórfido' });
    const r2 = await enTurno(reg2, () => decidirPanel('qué tipo de yacimiento es un pórfido'));
    assert.equal(r2.fuente, 'tabla');
    assert.equal(reg2.t.pasos[0].ok, false);
    assert.equal(reg2.t.pasos[0].resumen, `tabla → ${ids(r2.panel).join(', ')} (laya: http 401)`);
  });

  await t.test('los mensajes largos llegan recortados por los dos extremos', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['legal'], p: {}, umbral: 0.5, ms: 20 } };
    const largo = 'Le cuento la historia de la zona. '.repeat(120) + '¿Cuándo vence la concesión?';
    await decidirLaya(largo);
    assert.equal(ultimo.texto, recortarParaLaya(largo));
    assert.ok(ultimo.texto!.endsWith('¿Cuándo vence la concesión?'));
    assert.ok(ultimo.texto!.startsWith('Le cuento la historia'));
  });

  await t.test('reutiliza la conexión entre turnos', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: [], p: {}, umbral: 0.5, ms: 5 } };
    await decidirLaya('hola');
    const antes = conexiones;
    await new Promise((ok) => setTimeout(ok, 50));
    await decidirLaya('hola otra vez');
    await decidirLaya('y otra');
    assert.equal(conexiones, antes, 'abrió conexiones nuevas');
  });

  await t.test('la sonda de salud no lleva la clave ni toca la pausa', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { ok: true, umbral: 0.5, entrenado: '2026-09-26T15:32:00Z' } };
    const s = await saludLaya();
    assert.equal(s.ok, true);
    assert.equal(s.umbral, 0.5);
    assert.equal(ultimo.ruta, '/salud');
    assert.equal(ultimo.auth, undefined);
    siguiente = { status: 502, cuerpo: {} };
    assert.equal((await saludLaya()).ok, false);
    assert.equal(estadoLaya().enPausaHasta, null);
  });

  await t.test('sin URL configurada no se llama a nadie', async () => {
    _reiniciarLaya();
    const antes = process.env.ULTRON_LAYA_URL;
    delete process.env.ULTRON_LAYA_URL;
    ultimo = {};
    const reg = iniciarTraza({ plataforma: 'electrum', pregunta: 'cuándo vence la concesión' });
    const r = await enTurno(reg, () => decidirPanel('cuándo vence la concesión'));
    assert.equal(r.fuente, 'tabla');
    assert.equal(r.motivo, 'sin configurar');
    assert.deepEqual(ultimo, {});
    assert.deepEqual(reg.t.pasos, [], 'sin Laya no se anota nada');
    assert.equal(estadoLaya().configurado, false);
    process.env.ULTRON_LAYA_URL = antes;
  });
});

test('Laya solo por https, salvo hacia la propia máquina', () => {
  assert.equal(urlSegura('https://35-175-175-203.sslip.io/laya/'), 'https://35-175-175-203.sslip.io/laya');
  assert.equal(urlSegura('http://127.0.0.1:8792'), 'http://127.0.0.1:8792');
  assert.equal(urlSegura('http://localhost:8792/'), 'http://localhost:8792');
  assert.equal(urlSegura('http://35.175.175.203:8792'), '');
  assert.equal(urlSegura('ftp://x'), '');
  assert.equal(urlSegura('no es url'), '');
  assert.equal(urlSegura(''), '');
});

test('el recorte guarda principio y final, y nunca parte un carácter', () => {
  assert.equal(recortarParaLaya('  ¿cuándo vence?  '), '¿cuándo vence?');
  assert.equal(recortarParaLaya(''), '');
  const justo = 'a'.repeat(CABEZA + COLA);
  assert.equal(recortarParaLaya(justo), justo);
  const largo = 'x'.repeat(CABEZA) + 'MEDIO'.repeat(400) + 'y'.repeat(COLA);
  const r = recortarParaLaya(largo);
  assert.equal(r, `${'x'.repeat(CABEZA)} … ${'y'.repeat(COLA)}`);
  // Emojis justo en los bordes del corte: salen enteros.
  const emojis = '😀'.repeat(1500);
  const re = recortarParaLaya(emojis);
  assert.equal(re, `${'😀'.repeat(CABEZA)} … ${'😀'.repeat(COLA)}`);
  assert.doesNotMatch(re, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  // Un sustituto suelto que ya venía en el mensaje se cambia por �: el tokenizador del nodo no lo acepta.
  assert.equal(recortarParaLaya('hola \ud83d vence'), 'hola \uFFFD vence');
  assert.equal(JSON.stringify(recortarParaLaya('a\udc00')), '"a�"');
});
