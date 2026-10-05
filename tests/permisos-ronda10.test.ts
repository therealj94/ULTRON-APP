/**
 * PERMISOS EXACTOS, DÉCIMA RONDA (novena revisión independiente sobre a034b60).
 *
 *  G1 (grave): si el turno de voz se descartaba DESPUÉS del botón «Seguir», se reponía «¿sigo?» y un «sí» escrito
 *     lanzaba una segunda continuación mientras la primera trabajaba. Ahora un descarte no repone lo que otro camino ya
 *     cumplió (la oferta, la pregunta), y no se sigue una misión con una ronda en vuelo.
 *  G2 (grave): el tema de OTRA decisión ignoraba las palabras cortas y las de números («Bo», «4455», «las 5»): ahora
 *     cuentan (sin artículos ni preposiciones) y se pregunta cuál. El canal dicho que cuadra con el texto de la otra
 *     («el correo» con «mail.google.com») también pregunta.
 *
 * Nodo de mentira con tareas y confirmaciones contadas. Datos sintéticos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestHandler } from 'express';
import { encargarTarea, _olvidarEncargos, alAvisarApp, TIEMPOS_SEGUIR, type AvisoApp } from '../server/computadora';
// Las tareas del nodo de mentira (lo que su guion ve y cambia).
type TareaFalsa = any;

const CLAVE = 'clave-de-prueba';

async function conNodo<T>(url: string | null, fn: () => Promise<T>): Promise<T> {
  const antes = { u: process.env.COMPUTADORA_URL, c: process.env.COMPUTADORA_CLAVE };
  if (url) {
    process.env.COMPUTADORA_URL = url;
    process.env.COMPUTADORA_CLAVE = CLAVE;
  } else {
    delete process.env.COMPUTADORA_URL;
    delete process.env.COMPUTADORA_CLAVE;
  }
  _olvidarEncargos();
  try {
    return await fn();
  } finally {
    for (const [k, v] of [['COMPUTADORA_URL', antes.u], ['COMPUTADORA_CLAVE', antes.c]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _olvidarEncargos();
  }
}

type AvisoVisto = { quien: string; aparato: string | null; aviso: AvisoApp };

/** Espía del canal de acciones del teléfono, con tiempos cortos; `llega` dice a cuántos teléfonos llegó. */
async function conAvisos<T>(fn: (vistos: AvisoVisto[]) => Promise<T>, llega: (a: AvisoApp) => number = () => 1): Promise<T> {
  const vistos: AvisoVisto[] = [];
  const antes = { ...TIEMPOS_SEGUIR };
  Object.assign(TIEMPOS_SEGUIR, { sondeoMs: 60, silencioTrasTurnoMs: 0, narrarCadaMs: 0, trabajandoCadaMs: 10_000, fallosAntesDeAvisar: 3, sinRespuestaMs: 1500, reintentoMs: 50 });
  alAvisarApp((quien, aviso, aparato) => {
    vistos.push({ quien, aparato, aviso });
    return llega(aviso);
  });
  try {
    return await fn(vistos);
  } finally {
    alAvisarApp(null);
    Object.assign(TIEMPOS_SEGUIR, antes);
  }
}

async function hasta(cond: () => boolean, ms = 8000) {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 30));
  assert.ok(cond(), 'no pasó a tiempo');
}

async function nodoAgente(o: {
  caps?: string[];
  guion: (t: TareaFalsa) => void;
  altasQueFallan?: number;
  altaCodigo?: number;
  respuestasPerdidas?: number;
  conPropuesta?: boolean;
  /** Un nodo de antes de AUR02: sus preguntas no traen la huella de la propuesta. */
  sinPropuesta?: boolean;
  sinRevisar?: boolean;
  parada?: 'quiescent' | 'draining';
  demora?: (t: TareaFalsa, url: string) => number;
}) {
  const tareas = new Map<string, TareaFalsa>();
  const porPedido = new Map<string, string>();
  const pedidos: Array<{ ruta: string; cuerpo: any }> = [];
  const estado = { caido: false, perdida: false, altasQueFallan: o.altasQueFallan ?? 0, respuestasPerdidas: o.respuestasPerdidas ?? 0 };
  let preguntas = 0;
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      const cuerpo = datos ? JSON.parse(datos) : null;
      pedidos.push({ ruta: `${req.method} ${req.url}`, cuerpo });
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false, ...(o.caps ? { capacidades: o.caps } : {}) });
      if (req.headers.authorization !== `Bearer ${CLAVE}`) return json(401, { detail: 'clave' });
      if (req.method === 'POST' && req.url === '/tareas') {
        if (estado.altasQueFallan > 0) {
          estado.altasQueFallan--;
          return json(o.altaCodigo ?? 503, { detail: 'ocupado arrancando' });
        }
        const llave = cuerpo.request_id ? `${cuerpo.dueno}|${cuerpo.request_id}` : '';
        if (llave && porPedido.has(llave)) return json(200, { id: porPedido.get(llave), estado: 'trabajando', repetida: true });
        const id = `a${tareas.size + 1}`;
        tareas.set(id, { id, n: tareas.size + 1, instruccion: cuerpo.instruccion, consultas: 0, estado: 'trabajando', pasos: [], respuesta: null, error: null, pregunta: null });
        if (llave) porPedido.set(llave, id);
        if (estado.respuestasPerdidas > 0) {
          estado.respuestasPerdidas--;
          return res.destroy();
        }
        return json(200, { id, estado: 'en_cola' });
      }
      const m = req.url!.match(/^\/tareas\/(\w+)(?:\/(\w+))?/);
      const t = m && tareas.get(m[1]);
      if (estado.caido) return res.destroy();
      if (!t || estado.perdida) return json(404, { detail: 'no existe' });
      const accion = m![2];
      const viva = !['hecha', 'parada', 'sin_pasos', 'fallo'].includes(t.estado);
      if (req.method === 'GET' && !accion) {
        t.consultas++;
        const antes = t.pregunta;
        o.guion(t);
        if (t.pregunta && (t.pregunta !== antes || !t.pregunta_id)) {
          t.pregunta_id = `p${++preguntas}`;
          if (!o.sinPropuesta) t.propuesta = `h${preguntas}`;
        }
        if (!t.pregunta) t.pregunta_id = t.propuesta = null;
        const foto = { id: t.id, motor: 'holo', instruccion: t.instruccion, estado: t.estado, pasos: [...t.pasos], respuesta: t.respuesta, error: t.error, segundos: 20, pregunta: t.pregunta, pregunta_id: t.pregunta_id ?? null, ...(o.sinPropuesta ? {} : { propuesta: t.propuesta ?? null }) };
        const ms = o.demora?.(t, req.url!) ?? 0;
        if (ms > 0) return void setTimeout(() => json(200, foto), ms);
        return json(200, foto);
      }
      if (!o.caps && accion !== 'parar') return json(404, { detail: 'Not Found' });
      if (accion === 'parar') {
        if (o.parada === 'draining') return json(200, { id: t.id, estado: t.estado, parada: { id: 'pd1', fase: 'draining', en_vuelo: { accion: 'click', estado: 'en_vuelo' } } });
        t.estado = 'parada';
        return json(200, { id: t.id, ...(o.parada ? { estado: 'parada', parada: { id: 'pd1', fase: 'quiescent', en_vuelo: null } } : {}) });
      }
      if (!viva) return json(409, { detail: 'la tarea ya terminó' });
      const conEntrada = !!o.caps?.includes('entrada');
      if (accion === 'pausar') t.estado = 'pausada';
      else if (accion === 'reanudar') t.estado = 'trabajando';
      else if (accion === 'control') {
        t.estado = cuerpo?.tomar ? 'control' : 'trabajando';
        // Como el agente.py de AUR09: el control queda ligado al cliente que lo tomó (otra sesión, otra época).
        if (conEntrada && cuerpo?.tomar) {
          if (cuerpo.clientId !== t.cliente) t.epoca = (t.epoca ?? 3) + (t.cliente ? 1 : 0);
          t.cliente = cuerpo.clientId ?? null;
        }
        if (conEntrada) return json(200, { id: t.id, estado: t.estado, fase: 'quiescent', epoca: t.epoca ?? 3 });
      } else if (accion === 'entrada' && conEntrada) {
        if (t.estado !== 'control') return json(409, { detail: 'sin_control: primero toma el control' });
        if (cuerpo.clientId !== t.cliente) return json(409, { detail: 'cliente: el control lo tiene otro dispositivo' });
        if (cuerpo.controlEpoch !== (t.epoca ?? 3)) return json(409, { detail: `epoca_revocada: el control cambió (época ${t.epoca ?? 3})` });
        return json(200, { id: t.id, ack: { secuencia: cuerpo.inputSequence, estado: 'hecha', ts: Date.now() / 1000, frame_seq: 7, epoca: cuerpo.controlEpoch } });
      } else if (accion === 'seguro' && o.caps?.includes('seguro')) {
        if (!cuerpo?.activar && !(cuerpo?.frameSeq > 7)) return json(409, { detail: 'frame_viejo: mira la pantalla de ahora antes de terminar la entrada segura' });
        t.seguro = !!cuerpo?.activar;
        return json(200, { id: t.id, seguro: t.seguro, epoca: t.epoca ?? 3, frame_seq: 8 });
      }
      else if (accion === 'confirmar') {
        if (t.estado !== 'confirmar') return json(409, { detail: 'no está esperando ningún sí' });
        if (!o.sinRevisar && (!cuerpo.pregunta_id || cuerpo.pregunta_id !== t.pregunta_id)) return json(409, { detail: 'esa respuesta era para otra pregunta; mira la de ahora' });
        if (!o.sinRevisar && cuerpo.propuesta && cuerpo.propuesta !== t.propuesta) return json(409, { detail: 'esa respuesta era para otra propuesta' });
        // Como el agente.py de la revisión 4-oct: un «sí» sin la propuesta exacta no contesta nada.
        if (!o.sinRevisar && !o.sinPropuesta && cuerpo.si && cuerpo.propuesta !== t.propuesta) return json(409, { detail: 'ese sí no nombra la propuesta de ahora' });
        t.si = !!cuerpo.si;
        t.estado = 'trabajando';
        t.pregunta = null;
        t.pregunta_id = null;
        t.pasos.push({ n: t.pasos.length + 1, t: 9, accion: 'confirmacion', args: { si: t.si } });
      } else if (accion === 'accion') {
        if (t.estado !== 'control') return json(409, { detail: 'primero toma el control' });
        t.pasos.push({ n: t.pasos.length + 1, t: 9, accion: 'persona', args: { tipo: cuerpo.tipo } });
      } else if (accion === 'pantalla') {
        const frame = conEntrada
          ? { 'X-Frame-Seq': '8', 'X-Frame-Ts': (Date.now() / 1000 - 0.4).toFixed(3), 'X-Frame-Ancho': '1280', 'X-Frame-Alto': '800', 'X-Viewport-Rev': '2', 'X-Control-Epoca': String(t.epoca ?? 3), 'X-Privado': t.seguro ? '1' : '0' }
          : {};
        res.writeHead(200, { 'content-type': 'image/jpeg', ...frame });
        return res.end(Buffer.from('JPEGDATA'));
      }
      return json(200, { id: t.id, estado: t.estado });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { url, pedidos, tareas, estado, cerrar: () => new Promise<void>((r) => (srv.closeAllConnections?.(), srv.close(() => r()))) };
}

/** Las rutas de la app sobre un express de prueba (cada quien por `x-quien`). */
async function conRutas<T>(fn: (como: (quien: string | null, ruta: string, init?: RequestInit) => Promise<{ code: number; j: any }>) => Promise<T>): Promise<T> {
  const express = (await import('express')).default;
  const { montarRutasComputadora } = await import('../server/computadora');
  const app = express();
  app.use(express.json());
  const pasa: RequestHandler = (_q, _r, n) => n();
  // La sesión: quién (x-quien) y su token (x-token; por omisión uno fijo), como sesionDe de server/seguridad.ts.
  montarRutasComputadora(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']), token: String(req.headers['x-token'] || 'token-de-prueba') } : null) });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const como = (quien: string | null, ruta: string, init: RequestInit = {}) =>
    fetch(`${base}${ruta}`, { ...init, headers: { 'content-type': 'application/json', ...((init.headers as Record<string, string>) || {}), ...(quien ? { 'x-quien': quien } : {}) } }).then(async (r) => ({ code: r.status, j: await r.json() }));
  try {
    return await fn(como);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
}

const CAPS = ['pausar', 'confirmar', 'control'];
const altas = (n: { pedidos: Array<{ ruta: string }> }) => n.pedidos.filter((p) => p.ruta === 'POST /tareas').length;

/** Las tareas terminan a medias hasta que la misión ofrece «¿sigo?»; las continuaciones de después se quedan trabajando. */
function nodoQueOfreceSeguir() {
  const congelar = { v: false };
  return {
    congelar,
    nodo: nodoAgente({
      caps: CAPS,
      guion: (t) => {
        if (!congelar.v || t.congelada === false) {
          if (t.congelada === undefined) t.congelada = false;
          t.estado = 'sin_pasos';
          t.error = 'Se acabaron los 25 pasos sin terminar.';
        } else {
          t.congelada = true;
          t.estado = 'trabajando';
        }
      },
    }),
  };
}

/* ------------------------------------------------------------------ G1: un descarte no repone lo que otro camino cumplió */

test('ronda 10 G1: «sí» de voz a «¿sigo?» + botón «Seguir» + la voz se descarta → no se vuelve a ofrecer, y un «sí» escrito no lanza una segunda continuación', async () => {
  const { resolverPreguntaComputadora, preguntasComputadora, comandoComputadora } = await import('../server/computadora');
  const { congelar, nodo: n } = nodoQueOfreceSeguir();
  const nodo = await n;
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) =>
        conRutas(async (como) => {
          const r = await encargarTarea({ instruccion: 'Compara vuelos a Miami', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0, ambito: 'tel' } as any);
          await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
          const [vista] = preguntasComputadora('jose@x.hn', 'tel');
          congelar.v = true;
          const descartes: Array<() => void> = [];
          const retener = { hacer: (_f: () => void) => undefined, alDescartar: (f: () => void) => void descartes.push(f) };
          const antes = altas(nodo);
          await resolverPreguntaComputadora('jose@x.hn', 'sí', retener as any, { ambito: 'tel', elegida: vista.tareaId, version: vista.version });
          const s = await como('jose@x.hn', `/api/computadora/misiones/${r.id}/seguir`, { method: 'POST', body: '{}' });
          assert.equal(s.code, 200);
          for (const f of descartes) f(); // la voz se descarta
          assert.deepEqual(preguntasComputadora('jose@x.hn', 'tel'), [], 'no se vuelve a ofrecer «¿sigo?» (la ronda 2 trabaja)');
          // Aunque llegara un «sí» escrito o «sigue» por voz: la ronda en vuelo no se sigue otra vez.
          await resolverPreguntaComputadora('jose@x.hn', 'sí', undefined, { ambito: 'tel', elegida: vista.tareaId, version: vista.version });
          await comandoComputadora('jose@x.hn', 'sigue');
          await new Promise((res) => setTimeout(res, 400));
          assert.equal(altas(nodo) - antes, 1, 'una sola continuación');
        })
      )
    );
  } finally {
    await nodo.cerrar();
  }
});

test('ronda 10 G1: «sí» de voz a la PREGUNTA + la app la contesta con su botón + la voz se descarta → la pregunta no se repone', async () => {
  const { resolverPreguntaComputadora, preguntasComputadora } = await import('../server/computadora');
  const nodo = await nodoAgente({
    caps: CAPS,
    guion: (t) => {
      if (t.si === undefined) {
        t.estado = 'confirmar';
        t.pregunta = 'Voy a tocar «Pagar 500». ¿Lo hago?';
        t.pasos = [{ n: 1, t: 3, accion: 'pedir_confirmacion', args: { pregunta: t.pregunta } }];
      }
    },
  });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) =>
        conRutas(async (como) => {
          const r = await encargarTarea({ instruccion: 'Entra al banco y paga la luz', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0, ambito: 'tel' } as any);
          await hasta(() => vistos.some((v) => v.aviso.fase === 'confirmar'));
          const [vista] = preguntasComputadora('jose@x.hn', 'tel');
          const [preguntaId, propuesta] = String(vista.version).split('|');
          const descartes: Array<() => void> = [];
          const retener = { hacer: (_f: () => void) => undefined, alDescartar: (f: () => void) => void descartes.push(f) };
          await resolverPreguntaComputadora('jose@x.hn', 'sí', retener as any, { ambito: 'tel', elegida: vista.tareaId, version: vista.version });
          const c = await como('jose@x.hn', `/api/computadora/tareas/${r.id}/confirmar`, { method: 'POST', body: JSON.stringify({ si: true, preguntaId, propuesta }) });
          assert.equal(c.code, 200, `la app contestó (${JSON.stringify(c.j)})`);
          for (const f of descartes) f();
          assert.deepEqual(preguntasComputadora('jose@x.hn', 'tel'), [], 'la pregunta ya contestada no vuelve');
          assert.equal(nodo.pedidos.filter((p) => /\/confirmar$/.test(p.ruta)).length, 1, 'una sola confirmación');
        })
      )
    );
  } finally {
    await nodo.cerrar();
  }
});

/* ------------------------------------------------------------------ G2: el tema ajeno, con palabras cortas y números */

test('ronda 10 G2 (función única): lo dicho que aparece en el tema de OTRA decisión pregunta, aunque sea corto o un número', async () => {
  const A = await import('../lib/afirmacion');
  const casos: Array<[string, any[], string]> = [
    ['sí, a Bo', [{ tipo: 'correo', destino: 'Bo bo@example.test', tema: 'Hola' }, { tipo: 'computadora', texto: '¿Le mando el archivo a Bo por Drive?' }], 'preguntar'],
    ['sí, a Li', [{ tipo: 'whatsapp', destino: 'Li Wei 50499990001@s.whatsapp.net', tema: 'Nos vemos' }, { tipo: 'computadora', texto: '¿Le escribo a Li por LinkedIn desde tu cuenta?' }], 'preguntar'],
    ['sí, el 4455', [{ tipo: 'whatsapp', destino: 'Taller 504 9999-4455', tema: 'Listo el carro' }, { tipo: 'computadora', texto: '¿Pago la factura 4455 en la página del banco?' }], 'preguntar'],
    ['sí, el de las 5', [{ tipo: 'recordatorio', destino: 'Llamar', texto: 'Llamar a mamá', cuando: Date.UTC(2026, 9, 5, 23, 0) }, { tipo: 'computadora', texto: '¿Reservo la mesa de las 5 en el restaurante?' }], 'preguntar'],
    ['sí, a Ana', [{ tipo: 'whatsapp', destino: 'Ana 50499990002@s.whatsapp.net', tema: 'Hola' }, { tipo: 'computadora', texto: '¿Le mando el archivo a Ana por Drive?' }], 'preguntar'],
    // El canal dicho cuadra con el texto de la otra (su computadora habla de correo/Gmail).
    ['sí, el correo', [{ tipo: 'correo', destino: 'Ana ana@example.test', desde: 'jose@gmail.com' }, { tipo: 'computadora', texto: '¿Entro a mail.google.com con tu cuenta?' }], 'preguntar'],
    ['sí, el email', [{ tipo: 'correo', destino: 'Ana ana@example.test', desde: 'jose@gmail.com' }, { tipo: 'computadora', texto: '¿Inicio sesión en Gmail con tu cuenta?' }], 'preguntar'],
    // Sin cruce: siguen ejecutando.
    ['sí, al 3333', [{ tipo: 'whatsapp', destino: 'Bruno (+50477773333)' }, { tipo: 'computadora', texto: '¿Reservo la mesa en el restaurante?' }], 'ejecutar'],
    ['sí, al 3333', [{ tipo: 'whatsapp', destino: 'Bruno (+50477773333)' }, { tipo: 'computadora', texto: '¿Pago la factura 3333 del agua?' }], 'preguntar'],
    ['sí, a Bo', [{ tipo: 'correo', destino: 'Bo bo@example.test', tema: 'Hola' }], 'ejecutar'],
    ['sí, el de las 5', [{ tipo: 'recordatorio', destino: 'Llamar', texto: 'Llamar a mamá', cuando: Date.UTC(2026, 9, 5, 23, 0) }], 'ejecutar'],
    ['sí', [{ tipo: 'correo', destino: 'Bo bo@example.test', tema: 'Hola' }], 'ejecutar'],
  ];
  const fallos: string[] = [];
  for (const [frase, ps, tipo] of casos) {
    const d: any = A.decidirPendiente(frase, ps);
    if (d.tipo !== tipo) fallos.push(`«${frase}» con [${ps.map((p) => p.tipo).join(', ')}]: esperaba ${tipo}, dio ${d.tipo}`);
  }
  assert.deepEqual(fallos, []);
});
