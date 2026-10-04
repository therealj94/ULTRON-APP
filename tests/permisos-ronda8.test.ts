/**
 * PERMISOS EXACTOS, OCTAVA RONDA (séptima revisión independiente sobre ac8efd2).
 *
 *  GRAVE: un «sí» decidido para la PREGUNTA de su computadora terminaba SIGUIENDO la misión (una tarea nueva en el
 *  nodo) si, entre decidir y resolver, la pregunta se fue (la misión terminó a medias). Ahora, si lo decidido ya no está,
 *  no se hace NADA y se pregunta de nuevo; nunca se cae a «ofrece seguir» ni a otra acción. Lo mismo al revés: un «sí» a
 *  «¿sigo?» que ya no es el de ahora (el botón «Seguir» ya la siguió) no sigue otra vez.
 *
 * Nodo de mentira (como agente.py) con efectos contados: cada tarea nueva es un POST /tareas.
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

/** Una misión que se detiene a preguntar; con `terminar.v` puesto, termina a medias (fallo). */
async function misionQuePregunta(terminar: { v: boolean }) {
  return nodoAgente({
    caps: CAPS,
    guion: (t) => {
      if (!terminar.v && t.si === undefined) {
        t.estado = 'confirmar';
        t.pregunta = 'Voy a tocar «Pagar 500». ¿Lo hago?';
        t.pasos = [{ n: 1, t: 3, accion: 'pedir_confirmacion', args: { pregunta: t.pregunta } }];
      } else if (terminar.v) {
        t.estado = 'fallo';
        t.error = 'se cerró la ventana del banco';
      }
    },
  });
}

test('ronda 8 (grave): el «sí» decidido para la PREGUNTA de su computadora no sigue la misión si la pregunta se fue mientras tanto', async () => {
  const { resolverPreguntaComputadora, preguntasComputadora } = await import('../server/computadora');
  const terminar = { v: false };
  const nodo = await misionQuePregunta(terminar);
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) => {
        await encargarTarea({ instruccion: 'Entra al banco y paga la luz', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0, ambito: 'tel' } as any);
        await hasta(() => vistos.some((v) => v.aviso.fase === 'confirmar'));
        // Lo que vio la regla única al decidir: ESTA pregunta, con su versión.
        const [vista] = preguntasComputadora('jose@x.hn', 'tel');
        // En la ventana entre decidir y resolver (registrarEfecto), la misión termina a medias.
        terminar.v = true;
        await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
        const antes = altas(nodo);
        for (const respuesta of ['sí', 'no']) {
          const h = await resolverPreguntaComputadora('jose@x.hn', respuesta, undefined, { ambito: 'tel', elegida: vista.tareaId, version: vista.version });
          assert.equal(altas(nodo), antes, `«${respuesta}»: ninguna tarea nueva en el nodo`);
          assert.match(String(h), /NO hice nada|pregúntale de nuevo/i, `«${respuesta}»: se dice que cambió`);
        }
        assert.ok(!vistos.some((v) => v.aviso.fase === 'sigue'), 'la misión no se siguió');
      })
    );
  } finally {
    await nodo.cerrar();
  }
});

test('ronda 8: sin cambio, el «sí» decidido para la pregunta la contesta una vez (y no lanza tareas)', async () => {
  const { resolverPreguntaComputadora, preguntasComputadora } = await import('../server/computadora');
  const nodo = await misionQuePregunta({ v: false });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) => {
        await encargarTarea({ instruccion: 'Entra al banco y paga la luz', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0, ambito: 'tel' } as any);
        await hasta(() => vistos.some((v) => v.aviso.fase === 'confirmar'));
        const [vista] = preguntasComputadora('jose@x.hn', 'tel');
        const antes = altas(nodo);
        const h = await resolverPreguntaComputadora('jose@x.hn', 'sí', undefined, { ambito: 'tel', elegida: vista.tareaId, version: vista.version });
        assert.match(String(h), /dijo que sí/);
        assert.equal(nodo.pedidos.filter((p) => /\/confirmar$/.test(p.ruta)).length, 1, 'una confirmación');
        assert.equal(altas(nodo), antes, 'ninguna tarea nueva');
      })
    );
  } finally {
    await nodo.cerrar();
  }
});

test('ronda 8: el «sí» decidido para «¿sigo?» no sigue OTRA vez si el botón «Seguir» ya la siguió mientras tanto; sin cambio, sigue una vez', async () => {
  const { resolverPreguntaComputadora, preguntasComputadora } = await import('../server/computadora');
  const nodo = await nodoAgente({ caps: CAPS, guion: (t) => void ((t.estado = 'sin_pasos'), (t.error = 'Se acabaron los 25 pasos sin terminar.')) });
  try {
    await conNodo(nodo.url, () =>
      conAvisos(async (vistos) =>
        conRutas(async (como) => {
          const r = await encargarTarea({ instruccion: 'Compara vuelos a Miami', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0, ambito: 'tel' } as any);
          await hasta(() => vistos.some((v) => v.aviso.fase === 'termina'));
          const [vista] = preguntasComputadora('jose@x.hn', 'tel');
          assert.match(vista.texto, /^¿sigo con/);
          // Mientras se decidía, la persona tocó «Seguir» en la app.
          const s = await como('jose@x.hn', `/api/computadora/misiones/${r.id}/seguir`, { method: 'POST', body: '{}' });
          assert.equal(s.code, 200);
          const antes = altas(nodo);
          const h = await resolverPreguntaComputadora('jose@x.hn', 'sí', undefined, { ambito: 'tel', elegida: vista.tareaId, version: vista.version });
          assert.equal(altas(nodo), antes, 'no se sigue dos veces');
          assert.match(String(h), /NO hice nada/);
          // Cuando vuelve a ofrecer seguir, un «sí» decidido para ESE ofrecimiento sigue una vez.
          await hasta(() => vistos.filter((v) => v.aviso.fase === 'termina').length >= 2);
          const [otra] = preguntasComputadora('jose@x.hn', 'tel');
          const antes2 = altas(nodo);
          const h2 = await resolverPreguntaComputadora('jose@x.hn', 'sí', undefined, { ambito: 'tel', elegida: otra.tareaId, version: otra.version });
          assert.match(String(h2), /dijo que sí; tu computadora sigue/);
          assert.equal(altas(nodo), antes2 + 1, 'una tarea nueva, una vez');
        })
      )
    );
  } finally {
    await nodo.cerrar();
  }
});

test('ronda 8: lo que esperaba la app ya no está → no es lo mismo (sus acciones no se cumplen con ese «sí»)', async () => {
  const APP = await import('../lib/acciones-app');
  APP._reiniciarAccionesApp();
  const amb = APP.ambitoApp('jose@x.hn', 'tel');
  APP.abrirTurnoApp(amb);
  APP.anotarPropuesta(amb, { tipo: 'llamar', con: 'ana@example.test', nombre: 'Ana', video: false });
  APP.abrirTurnoApp(amb);
  const visto = APP.appEsperandoDe(amb);
  assert.ok(visto, 'esperaba la llamada');
  APP.soltarPropuesta(amb);
  assert.equal(APP.mismaEsperaApp(visto, APP.appEsperandoDe(amb)), false, 'se fue: no es lo que se decidió');
});


