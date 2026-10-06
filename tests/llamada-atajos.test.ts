/**
 * LANG-03 · Los atajos (reglas, Laya ligera, Laya del nodo) no convierten una negación, una cita, un
 * discurso referido o un apodo en «que el avatar me llame».
 *
 * Reproducción de la auditoría sobre 5754c78: «no me llames» salía `app_llamame` con p≈0,902 de Laya
 * ligera y ordenRapida devolvía { tipo: 'llamame' } (el teléfono de la persona sonaba); «call me Alex»
 * (un apodo en inglés) también llamaba. Contrato: frase completa y condiciones estrictas; ante la duda,
 * el camino seguro (null: contesta el cerebro, nadie recibe una llamada).
 *
 * Corpus contrastivo: «llámame», «no me llames», «dijo que me llames», «llámame José», «call me Alex»,
 * «no, llama a…», «¿puedes llamar?» y cancelar durante una llamada; más variantes en inglés, con
 * comillas y con algo esperando su «sí».
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ordenRapida, ordenPorLigera, ordenPorReglas, type ContextoApp } from '../lib/acciones-app';
import { predecirApp } from '../lib/laya-ligera';
import { clasificarConReglas } from '../lib/cognitivo/clasificador';
import { motivoParaNoLlamar } from '../lib/cognitivo/intencion-llamada';
import { _reiniciarLaya } from '../lib/laya';

delete process.env.ULTRON_LAYA_URL;
delete process.env.ULTRON_LAYA_LIGERA;

const contexto: ContextoApp = {
  pantalla: 'mesa',
  contactos: [
    { correo: 'beto@x.hn', nombre: 'Beto' },
    { correo: 'mama@x.hn', nombre: 'Mamá' },
  ],
  manos: ['llamar', 'llamame', 'leer', 'perfil', 'idioma', 'recordatorio', 'controles'],
};
const esLlamame = (r: any) => r?.accion?.tipo === 'llamame' || (r?.mas || []).some((a: any) => a?.tipo === 'llamame');

const NEGATIVOS = [
  'no me llames',
  'no, no me llames',
  'ya no me llames',
  'mejor no me llames',
  'no quiero que me llames',
  'dijo que me llames',
  'me dijo que me llames',
  'llámame José',
  'call me Alex',
  'Call me Alex',
  'call me later',
  'call me maybe',
  "please don't call me",
  'do not call me',
  'never call me',
  '"llámame" dijo ella',
  '«llámame»',
  '¿puedes llamar?',
];
const POSITIVOS = ['llámame', 'llámame ya', 'oye llámame un ratito que quiero platicar', 'call me', 'can you call me', 'puedes llamarme', '¿me llamas?'];

test('LANG-03: la reproducción exacta — Laya ligera ve app_llamame en «no me llames», pero el atajo NO llama', () => {
  const p = predecirApp('no me llames');
  assert.equal(p.etiqueta, 'app_llamame', 'el modelo sigue equivocándose (por eso hace falta la condición estricta)');
  assert.ok(p.p > 0.85, `p=${p.p}`);
  const l = ordenPorLigera('no me llames', { contexto });
  assert.ok(l === null || l === 'ninguna' || !esLlamame(l), `ordenPorLigera: ${JSON.stringify(l)}`);
});

test('LANG-03: corpus negativo — ningún atajo convierte esto en una llamada del avatar', async () => {
  for (const t of NEGATIVOS) {
    const r = await ordenRapida(t, { contexto, esperaLayaMs: 50 });
    assert.ok(!esLlamame(r), `${t} → ${JSON.stringify(r)}`);
    const l = ordenPorLigera(t, { contexto });
    assert.ok(!(l && l !== 'ninguna' && esLlamame(l)), `ligera ${t} → ${JSON.stringify(l)}`);
    assert.notEqual(motivoParaNoLlamar(t), null, t);
  }
});

test('LANG-03: los motivos son los correctos (negación, cita, referido, apodo, sin pedido)', () => {
  assert.equal(motivoParaNoLlamar('no me llames'), 'negacion');
  assert.equal(motivoParaNoLlamar("please don't call me"), 'negacion');
  assert.equal(motivoParaNoLlamar('never call me'), 'negacion');
  assert.equal(motivoParaNoLlamar('"llámame" dijo ella'), 'cita');
  assert.equal(motivoParaNoLlamar('dijo que me llames'), 'referido');
  assert.equal(motivoParaNoLlamar('she said call me'), 'referido');
  assert.equal(motivoParaNoLlamar('llámame José'), 'apodo');
  assert.equal(motivoParaNoLlamar('call me Alex'), 'apodo');
  assert.equal(motivoParaNoLlamar('¿puedes llamar?'), 'sin_pedido');
  assert.equal(motivoParaNoLlamar('no, llama a Beto'), 'sin_pedido');
  // «no,» separado es una corrección, no niega lo que sigue.
  assert.equal(motivoParaNoLlamar('no, llámame'), null);
  for (const t of POSITIVOS) assert.equal(motivoParaNoLlamar(t), null, t);
});

test('LANG-03: los apodos se guardan como apodo, no como llamada («llámame José», «call me Alex»)', () => {
  assert.deepEqual(ordenPorReglas('llámame José', { contexto })?.accion, { tipo: 'perfil', campo: 'apodo', valor: 'José' });
  assert.deepEqual(ordenPorReglas('call me Alex', { contexto, idioma: 'en' })?.accion, { tipo: 'perfil', campo: 'apodo', valor: 'Alex' });
  // Una cita no es un apodo: «"llámame" dijo ella» no guarda «Dijo Ella».
  assert.equal(ordenPorReglas('"llámame" dijo ella', { contexto }), null);
});

test('LANG-03: «no, llama a Beto» es una corrección: propuesta de llamar a Beto (espera el «sí»), nunca «llámame»', async () => {
  const r = await ordenRapida('no, llama a Beto', { contexto, esperaLayaMs: 50 });
  assert.ok(!esLlamame(r));
  if (r) {
    assert.equal(r.accion, null, 'llamar a otro nunca sale directo');
    assert.equal(r.propuesta?.tipo, 'llamar');
    assert.equal((r.propuesta as any).con, 'beto@x.hn');
  }
});

test('LANG-03: con algo esperando su «sí» o una llamada viva, un «llámame» de atajo pasa al turno completo', async () => {
  const pendiente = { para: 'beto@x.hn', texto: 'Hola Beto' };
  for (const t of ['oye llámame un ratito', 'llámame ya']) {
    assert.ok(!esLlamame(await ordenRapida(t, { contexto, pendiente, esperaLayaMs: 50 })), `${t} con borrador esperando`);
    assert.ok(!esLlamame(await ordenRapida(t, { contexto, estadoControles: { llamada: true }, esperaLayaMs: 50 })), `${t} en llamada`);
  }
  // Cancelar durante una llamada: cuelga (o pregunta), nunca abre otra llamada.
  const colgar = await ordenRapida('cuelga', { contexto, estadoControles: { llamada: true }, esperaLayaMs: 50 });
  assert.deepEqual(colgar?.accion, { tipo: 'colgar' });
  for (const t of ['cancela', 'no me llames', 'cancela la llamada']) {
    assert.ok(!esLlamame(await ordenRapida(t, { contexto, estadoControles: { llamada: true }, esperaLayaMs: 50 })), t);
  }
});

test('LANG-03: control positivo — «llámame» claro sigue sonando al instante, por reglas o por Laya ligera', async () => {
  for (const t of POSITIVOS) {
    const r = await ordenRapida(t, { contexto, esperaLayaMs: 50 });
    assert.ok(esLlamame(r), `${t} → ${JSON.stringify(r)}`);
  }
});

test('LANG-03: el clasificador de tareas no cuenta como acción una negación, una cita o un apodo', () => {
  for (const t of ['no me llames', '"llámame" dijo ella', 'llámame José', 'call me Alex']) assert.equal(clasificarConReglas(t, 'ultron').tarea, 'conversacion', t);
  assert.equal(clasificarConReglas('llámame', 'ultron').tarea, 'accion_taller');
  assert.equal(clasificarConReglas('call me', 'ultron').tarea, 'accion_taller');
});

/* ---- el Laya del NODO dice app_llamame con 0,902 a todo: la condición estricta lo frena igual ---- */

const laya = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ p: { app_llamame: 0.902, app_ninguna: 0.05 }, etiquetas: [], grupos: { app: 'app_llamame' } }));
  });
});
await new Promise<void>((r) => laya.listen(0, '127.0.0.1', r));
after(() => laya.close());

test('LANG-03: Laya «comando» del nodo con app_llamame 0,902 no llama ante negación, apodo o cita', async () => {
  process.env.ULTRON_LAYA_URL = `http://127.0.0.1:${(laya.address() as AddressInfo).port}`;
  process.env.ULTRON_LAYA_LIGERA = '0';
  try {
    _reiniciarLaya();
    for (const t of ['call me Alex', 'call me later', 'never call me', "don't call me", 'no me llames', '"call me"']) {
      const r = await ordenRapida(t, { contexto, esperaLayaMs: 500 });
      assert.ok(!esLlamame(r), `${t} → ${JSON.stringify(r)}`);
    }
    // Control: el mismo nodo con «hazme una llamadita ahorita» (que las reglas no tienen igual) sí llama.
    const ok = await ordenRapida('call me real quick', { contexto, esperaLayaMs: 500 });
    assert.ok(esLlamame(ok), JSON.stringify(ok));
  } finally {
    delete process.env.ULTRON_LAYA_URL;
    delete process.env.ULTRON_LAYA_LIGERA;
    _reiniciarLaya();
  }
});
