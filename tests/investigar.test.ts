/**
 * Investigar en segundo plano (server/investigar.ts), sin red: búsquedas, páginas, cerebro y avisos falsos sobre
 * el almacén durable en memoria.
 *
 * Lo que tiene que ser verdad (José, 4-oct: «dijo que sí pero nunca empezó… y nada»):
 *   · la tarea durable existe ANTES del recibo, y el recibo solo dice «INVESTIGACIÓN EMPEZADA» si existe;
 *   · el trabajo no bloquea el turno: varias búsquedas, leer páginas, redactar con el cerebro, con tope duro;
 *   · al terminar: la tarea cerrada con el resumen y sus fuentes como evidencia (completed / partial / failed
 *     con honradez), un aviso para el turno siguiente y una notificación que abre sus Tareas;
 *   · cancelada desde el panel, no avisa; si el proceso se reinicia, la reconciliación la cierra con la verdad;
 *   · nunca promete PULSE2CHAT.
 */
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { almacenEnMemoria, _usarAlmacenDurable, type AlmacenDurable } from '../lib/durable';
import { cambiarTarea, leerTarea, reconciliarInvestigacion, registroNuevo, TOPE_INVESTIGACION_MS, MARGEN_INVESTIGACION_MS, ENTORNO_INVESTIGACION, vistaTarea } from '../lib/tareas-durables';
import { montarRutasTrabajos } from '../server/trabajos';
import {
  avisosInvestigacion,
  configurarInvestigacion,
  confirmarAvisosInvestigacion,
  empezarInvestigacion,
  pedidoDeInvestigacion,
  _esperarInvestigaciones,
  _olvidarInvestigaciones,
  type DepsInvestigacion,
} from '../server/investigar';
import { lineaDeHerramienta } from '../lib/cerebro-manos';
import { extraerPedidoHerramienta, resolverPedidoConEstado, EFECTO_HERRAMIENTA, herramientaQueSale } from '../lib/harness';

let n = 0;
const correo = () => `inv-${n++}@ejemplo.com`;

type Llamadas = { buscar: string[]; leer: string[]; redactar: string[]; avisos: { correo: string; titulo: string; texto: string; id: string; abrir: string }[] };

function falsos(o: Partial<DepsInvestigacion> & { sinResultados?: boolean } = {}): { deps: DepsInvestigacion; llamadas: Llamadas } {
  const llamadas: Llamadas = { buscar: [], leer: [], redactar: [], avisos: [] };
  const deps: DepsInvestigacion = {
    buscar: async (q) => {
      llamadas.buscar.push(q);
      if (o.sinResultados) return [];
      return [
        { title: `Copán — ${q}`, url: `https://ejemplo.test/${encodeURIComponent(q)}/copan`, snippet: 'Copán fue una gran ciudad maya del período clásico.' },
        { title: 'Independencia, 1821', url: 'https://ejemplo.test/1821', snippet: 'Honduras se independizó el 15 de septiembre de 1821.' },
      ];
    },
    leer: async (url) => {
      llamadas.leer.push(url);
      return `Texto de la página ${url}: Copán, Honduras, 1821.`;
    },
    redactar: async ({ prompt }) => {
      llamadas.redactar.push(prompt);
      return { ok: true, texto: '[EMO: neutral] 1. Copán fue una gran ciudad maya [1].\n2. Honduras se independizó en 1821 [2].', modelo: 'cerebro-falso' };
    },
    avisar: async (c, a) => {
      llamadas.avisos.push({ correo: c, ...a });
      return { enviados: 1, configurado: true };
    },
    ...o,
  };
  return { deps, llamadas };
}

let almacen: AlmacenDurable;
beforeEach(() => {
  almacen = almacenEnMemoria();
  _usarAlmacenDurable(almacen);
});
afterEach(() => {
  _olvidarInvestigaciones();
  configurarInvestigacion(null);
  _usarAlmacenDurable(null);
});

test('el pedido: el tema primero y varias búsquedas distintas (con una sola, otra de conjunto)', () => {
  assert.deepEqual(pedidoDeInvestigacion('historia de Honduras | hitos de Honduras | historia de Honduras'), { tema: 'historia de Honduras', consultas: ['historia de Honduras', 'hitos de Honduras'] });
  assert.deepEqual(pedidoDeInvestigacion('mayas de Copán'), { tema: 'mayas de Copán', consultas: ['mayas de Copán', 'mayas de Copán resumen'] });
  assert.deepEqual(pedidoDeInvestigacion('  '), { tema: '', consultas: [] });
});

test('la mano en el harness: la herramienta del cerebro se vuelve la línea de siempre y corre su runner', async () => {
  const linea = lineaDeHerramienta('investigar', { tema: 'historia de Honduras', consultas: ['mayas de Copán', 'independencia 1821', 'otra de más'] });
  assert.equal(linea, 'PEDIR_HERRAMIENTA: investigar historia de Honduras | mayas de Copán | independencia 1821');
  assert.equal(lineaDeHerramienta('investigar', {}), null);
  const ped = extraerPedidoHerramienta(`Va.\n${linea}`);
  assert.equal(ped?.herramienta, 'investigar');
  assert.equal(EFECTO_HERRAMIENTA.investigar, 'interno');
  assert.equal(herramientaQueSale('investigar'), true, 'sus consultas van al buscador: no después de leer un correo');
  const base = { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '' };
  const sin = await resolverPedidoConEstado(ped!, base);
  assert.equal(sin.estado, 'failed');
  assert.match(sin.texto, /no digas que lo estás investigando/);
  let arg = '';
  const con = await resolverPedidoConEstado(ped!, { ...base, investigar: async (a) => ((arg = a), 'ok') });
  assert.equal(con.estado, 'succeeded');
  assert.equal(arg, 'historia de Honduras | mayas de Copán | independencia 1821');
});

test('empieza: la tarea existe ANTES del recibo; el trabajo corre aparte y cierra completed con fuentes, aviso y notificación', async () => {
  const { deps, llamadas } = falsos();
  configurarInvestigacion(deps);
  const yo = correo();
  const r = await empezarInvestigacion({ dueno: yo, ambito: 'voz', arg: 'hitos de la historia de Honduras | mayas de Copán' });
  assert.equal(r.estado, 'succeeded');
  assert.match(r.texto, /^INVESTIGACIÓN EMPEZADA \(tarea tk_/);
  assert.match(r.texto, /notificación al teléfono/);
  assert.match(r.texto, /Nunca digas que se lo mandas por PULSE2CHAT/);
  assert.equal(r.recibo?.efecto, 'guardado');
  assert.equal(r.recibo?.durable, true);
  const id = r.recibo!.referencia!;
  // En el momento del recibo la tarea ya está en su panel, trabajando.
  const antes = await leerTarea(yo, id);
  assert.ok(antes.ok && antes.tarea);
  if (!antes.ok || !antes.tarea) return;
  assert.equal(antes.tarea.estado, 'running');
  assert.deepEqual(antes.tarea.entorno, ENTORNO_INVESTIGACION);
  // Mientras corre, AURA lo sabe (y no la empieza otra vez).
  const enCurso = avisosInvestigacion(yo);
  assert.ok(enCurso?.hechos.some((h) => /INVESTIGACIÓN EN CURSO/.test(h)));
  const otra = await empezarInvestigacion({ dueno: yo, ambito: 'voz', arg: 'Hitos de la historia de Honduras' });
  assert.equal(otra.recibo?.codigo, 'ya-en-curso');
  assert.equal(otra.recibo?.referencia, id, 'la misma tarea, no otra');

  await _esperarInvestigaciones();
  assert.deepEqual(llamadas.buscar, ['hitos de la historia de Honduras', 'mayas de Copán'], 'varias búsquedas');
  assert.ok(llamadas.leer.length >= 1 && llamadas.leer.length <= 3, 'lee las mejores páginas');
  assert.equal(llamadas.redactar.length, 1);
  assert.match(llamadas.redactar[0], /FUENTES:/);
  const fin = await leerTarea(yo, id);
  assert.ok(fin.ok && fin.tarea);
  if (!fin.ok || !fin.tarea) return;
  assert.equal(fin.tarea.estado, 'completed');
  assert.match(fin.tarea.resultado!.resumen, /Copán fue una gran ciudad maya/);
  assert.ok(!/\[EMO/.test(fin.tarea.resultado!.resumen), 'sin la etiqueta de ánimo');
  assert.ok(fin.tarea.resultado!.evidencias.length >= 2 && fin.tarea.resultado!.evidencias.every((e) => e.tipo === 'enlace' && /^https:\/\//.test(e.ref || '')));
  assert.equal(fin.tarea.criterios[0].estado, 'verified');
  const v = vistaTarea(fin.tarea);
  assert.equal(v.controls.pause, false, 'una investigación no se pausa');
  // La notificación: «Terminé de investigar», abre sus Tareas, sin PULSE2CHAT.
  assert.equal(llamadas.avisos.length, 1);
  assert.equal(llamadas.avisos[0].correo, yo);
  assert.equal(llamadas.avisos[0].titulo, 'Terminé de investigar');
  assert.equal(llamadas.avisos[0].abrir, 'tareas');
  assert.match(llamadas.avisos[0].texto, /Tareas/);
  assert.ok(!/PULSE2CHAT/i.test(llamadas.avisos[0].texto));
  // El aviso para el turno siguiente: una vez.
  const a = avisosInvestigacion(yo);
  assert.ok(a && a.ids.includes(id));
  assert.match(a!.hechos[0], /^INVESTIGACIÓN TERMINADA/);
  confirmarAvisosInvestigacion(yo, a!.ids);
  assert.equal(avisosInvestigacion(yo), null);
});

test('sin el cerebro a tiempo: partial con los extractos de las fuentes (no se finge un resumen)', async () => {
  const { deps, llamadas } = falsos({ redactar: async () => ({ ok: false, texto: '', error: 'Qwen no contestó' }) });
  configurarInvestigacion(deps);
  const yo = correo();
  const r = await empezarInvestigacion({ dueno: yo, ambito: 'telefono', arg: 'mayas de Copán' });
  await _esperarInvestigaciones();
  const t = await leerTarea(yo, r.recibo!.referencia!);
  assert.ok(t.ok && t.tarea);
  if (!t.ok || !t.tarea) return;
  assert.equal(t.tarea.estado, 'partial');
  assert.match(t.tarea.resultado!.resumen, /No pude redactar el resumen a tiempo\. Esto dicen las fuentes, sin resumir/);
  assert.equal(llamadas.avisos[0].titulo, 'Terminé de investigar (en parte)');
});

test('sin resultados: failed honesto, con su notificación', async () => {
  const { deps, llamadas } = falsos({ sinResultados: true });
  configurarInvestigacion(deps);
  const yo = correo();
  const r = await empezarInvestigacion({ dueno: yo, ambito: 'telefono', arg: 'algo que no existe xyzzy' });
  await _esperarInvestigaciones();
  const t = await leerTarea(yo, r.recibo!.referencia!);
  assert.ok(t.ok && t.tarea && t.tarea.estado === 'failed');
  if (!t.ok || !t.tarea) return;
  assert.match(t.tarea.resultado!.resumen, /No encontré nada en internet/);
  assert.equal(llamadas.redactar.length, 0, 'sin fuentes no se le pide al cerebro que invente');
  assert.equal(llamadas.avisos[0].titulo, 'No pude terminar la investigación');
});

test('tope duro: un buscador que no contesta no la deja colgada (se cierra con la verdad y a tiempo)', async () => {
  const { deps } = falsos({ buscar: () => new Promise(() => undefined), topeMs: 150 });
  configurarInvestigacion(deps);
  const yo = correo();
  const t0 = Date.now();
  const r = await empezarInvestigacion({ dueno: yo, ambito: 'telefono', arg: 'tema lento' });
  assert.ok(Date.now() - t0 < 1000, 'el turno no espera al trabajo');
  await _esperarInvestigaciones();
  assert.ok(Date.now() - t0 < 3000);
  const t = await leerTarea(yo, r.recibo!.referencia!);
  assert.ok(t.ok && t.tarea);
  if (!t.ok || !t.tarea) return;
  assert.equal(t.tarea.estado, 'failed');
  assert.match(t.tarea.resultado!.resumen, /Se acabó el tiempo/);
});

test('cancelada desde el panel a mitad: deja de trabajar y no avisa nada', async () => {
  let soltar: () => void = () => undefined;
  const yo = correo();
  const { deps, llamadas } = falsos({
    leer: (url) =>
      new Promise((ok) => {
        soltar = () => ok(`Texto de ${url}`);
      }),
  });
  configurarInvestigacion(deps);
  const r = await empezarInvestigacion({ dueno: yo, ambito: 'telefono', arg: 'tema cancelado' });
  const id = r.recibo!.referencia!;
  // Espera a que esté leyendo y la cancela como lo hace el panel (estado terminal).
  for (let i = 0; i < 50 && !llamadas.leer.length; i++) await new Promise((x) => setTimeout(x, 10));
  await cambiarTarea(yo, id, () => ({ estado: 'cancelled', pasoActual: null }));
  soltar();
  await _esperarInvestigaciones();
  const t = await leerTarea(yo, id);
  assert.ok(t.ok && t.tarea?.estado === 'cancelled', 'lo terminal no se toca');
  assert.equal(llamadas.avisos.length, 0, 'cancelada: sin notificación');
  assert.equal(avisosInvestigacion(yo), null);
});

test('si la tarea no se puede registrar, NO empieza y el recibo lo dice (nunca «empecé» sin tarea)', async () => {
  const { deps, llamadas } = falsos();
  configurarInvestigacion(deps);
  const caido: AlmacenDurable = {
    tipo: 'memoria',
    multiReplica: false,
    leer: async () => ({ ok: false, detalle: 'S3 caído' }),
    crear: async () => ({ ok: false, conflicto: false, detalle: 'S3 caído' }),
    cas: async () => ({ ok: false, conflicto: false, detalle: 'S3 caído' }),
  };
  _usarAlmacenDurable(caido);
  const r = await empezarInvestigacion({ dueno: correo(), ambito: 'voz', arg: 'historia de Honduras' });
  assert.equal(r.estado, 'failed');
  assert.match(r.texto, /NO la empecé/);
  await _esperarInvestigaciones();
  assert.equal(llamadas.buscar.length, 0, 'no corrió nada');
  assert.equal(llamadas.avisos.length, 0);
  // Sin sesión tampoco (no hay de quién sería la tarea ni a quién avisar).
  _usarAlmacenDurable(almacen);
  const sin = await empezarInvestigacion({ dueno: '', ambito: 'web', arg: 'historia de Honduras' });
  assert.equal(sin.estado, 'failed');
  assert.equal(sin.recibo?.codigo, 'sin-sesion');
  // Y sin el servidor configurado, tampoco.
  configurarInvestigacion(null);
  const nada = await empezarInvestigacion({ dueno: correo(), ambito: 'web', arg: 'historia' });
  assert.equal(nada.recibo?.codigo, 'no-disponible');
});

test('reinicio a mitad: sin latido pasado el tope, el panel la cierra failed con la verdad (no queda «running» para siempre)', async () => {
  const T0 = Date.parse('2026-10-04T01:00:00Z');
  const reg = registroNuevo('tk_reinicio1', { requestId: 'r1', titulo: 'Investigar: Honduras', entorno: ENTORNO_INVESTIGACION, origen: { kind: 'chat' }, estado: 'running', criterios: [{ id: 'fuentes', texto: 'Fuentes' }] }, T0);
  assert.equal(reconciliarInvestigacion(reg, T0 + TOPE_INVESTIGACION_MS), null, 'dentro del tope sigue viva');
  const c = reconciliarInvestigacion(reg, T0 + TOPE_INVESTIGACION_MS + MARGEN_INVESTIGACION_MS + 1);
  assert.equal(c?.estado, 'failed');
  assert.match(c!.resultado!.resumen, /el servidor se reinició mientras investigaba/);
  // Por las rutas del panel: la misma tarea, leída mucho después, sale cerrada.
  const yo = correo();
  const { crearTarea } = await import('../lib/tareas-durables');
  const cr = await crearTarea(yo, { requestId: 'reinicio-ruta', titulo: 'Investigar: Copán', entorno: ENTORNO_INVESTIGACION, origen: { kind: 'chat' }, estado: 'running', criterios: [{ id: 'fuentes', texto: 'Fuentes' }] }, { ahora: T0 });
  assert.ok(cr.ok);
  const app = express();
  app.use(express.json());
  montarRutasTrabajos(app, { exigirMesa: (_q, _r, next) => next(), limitar: () => (_q, _r, next) => next(), sesionDe: () => ({ correo: yo }), reloj: () => T0 + 10 * 60_000 });
  const srv = app.listen(0);
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const j: any = await (await fetch(`${base}/api/trabajos`)).json();
    const t = j.tareas.find((x: any) => x.title === 'Investigar: Copán');
    assert.equal(t.state, 'failed');
    assert.equal(t.terminal, true);
    assert.match(t.result.summary, /se reinició/);
    // Pausar una investigación no se finge.
    const otra = await crearTarea(yo, { requestId: 'pausa-ruta', titulo: 'Investigar: pausa', entorno: ENTORNO_INVESTIGACION, origen: { kind: 'chat' }, estado: 'running' }, { ahora: T0 + 10 * 60_000 });
    assert.ok(otra.ok);
    if (!otra.ok) return;
    const p = await fetch(`${base}/api/trabajos/${otra.tarea.id}/pausar`, { method: 'POST' });
    assert.equal(p.status, 409);
  } finally {
    srv.close();
  }
});

test('si el cierre no se pudo guardar (almacén caído dos veces), no se dice que está en Tareas (Codex, PR 142)', async () => {
  let romper = false;
  const base = almacenEnMemoria();
  const fragil: AlmacenDurable = {
    tipo: base.tipo,
    multiReplica: base.multiReplica,
    leer: (c) => base.leer(c),
    crear: (c, v) => base.crear(c, v),
    cas: (c, v, e) => (romper ? Promise.reject(new Error('S3 no contesta')) : base.cas(c, v, e)),
  };
  _usarAlmacenDurable(fragil);
  const { deps, llamadas } = falsos({
    redactar: async () => {
      romper = true; // de aquí en adelante, ninguna escritura entra: el cierre falla
      return { ok: true, texto: '1. Copán fue una gran ciudad maya [1].', modelo: 'cerebro-falso' };
    },
  });
  configurarInvestigacion(deps);
  const r = await empezarInvestigacion({ dueno: correo(), ambito: 'voz', arg: 'mayas de Copán' });
  assert.equal(r.estado, 'succeeded');
  await _esperarInvestigaciones();
  assert.equal(llamadas.avisos.length, 1);
  assert.doesNotMatch(llamadas.avisos[0].texto, /están en Tareas/);
  assert.match(llamadas.avisos[0].texto, /No pude guardarlo en Tareas/);
  assert.equal(llamadas.avisos[0].abrir, 'mesa', 'no abre un panel donde no está');
});
