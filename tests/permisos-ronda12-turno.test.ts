/**
 * PERMISOS EXACTOS, DUODÉCIMA RONDA. Revisor (ronda 11): camino real (resolverDecisionesDelTurno + puente de WhatsApp de mentira + nodo de mentira).
 *  A) Carrera: dos «sí» del chat a la vez y el botón Aprobar del panel, sobre el MISMO borrador → un solo envío.
 *  B) «sí, el 4455» con un WhatsApp al Taller (…9999-4455) y su computadora preguntando «¿Pago L 4,455…?».
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rev11-carrera-'));
process.env.CORREO_CLAVE_CIFRADO ||= 'llave-de-prueba';
Object.assign(process.env, {
  ULTRON_CORREO_DIR: DIR, ULTRON_TAREA_CURSO_DIR: path.join(DIR, 't'), ULTRON_ABIERTOS_DIR: path.join(DIR, 'a'),
  ULTRON_DURABLE_DIR: path.join(DIR, 'd'), ULTRON_CIRCULO_DIR: path.join(DIR, 'c'), ULTRON_CONOCER_DIR: path.join(DIR, 'k'),
  ULTRON_EPISODIOS_DIR: path.join(DIR, 'e'), ULTRON_MEMORIA_BUCKET: '',
});
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
const JOSE = 'jose@example.test';
const CLAVE_PUENTE = 'clave-del-puente-de-prueba-123';
const CLAVE_NODO = 'clave-de-prueba';
const esperar = (ms = 40) => new Promise((r) => setTimeout(r, ms));
function servidor(h: (req: http.IncomingMessage, cuerpo: any, json: (c: number, j: unknown) => void) => void) {
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => h(req, datos ? JSON.parse(datos) : null, (code, j) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)))));
  });
  return new Promise<{ url: string; cerrar: () => Promise<void> }>((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, cerrar: () => new Promise<void>((x) => (srv.closeAllConnections?.(), srv.close(() => x()))) })));
}
async function montar(chat: any) {
  const enviados: any[] = [];
  const puente = await servidor((req, c, json) => {
    if (req.headers.authorization !== `Bearer ${CLAVE_PUENTE}`) return json(401, {});
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/estado') return json(200, { vinculado: true, conectado: true, numero: '+50499998888', vinculando: false });
    if (u.pathname === '/chats') return json(200, { chats: [chat] });
    if (u.pathname === '/contactos') return json(200, { contactos: [] });
    if (u.pathname === '/mensajes') return json(200, { chat, mensajes: [] });
    if (u.pathname === '/enviar') {
      enviados.push(c);
      return setTimeout(() => json(200, { mensaje: { id: 'E' + enviados.length, chat: c.chat, mio: true, texto: c.texto, tipo: 'texto', hora: Date.now() } }), 30);
    }
    return json(404, {});
  });
  const tareas = new Map<string, any>();
  const efectos: any[] = [];
  const nodo = await servidor((req, c, json) => {
    if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false, capacidades: ['pausar', 'confirmar', 'control'] });
    if (req.headers.authorization !== `Bearer ${CLAVE_NODO}`) return json(401, {});
    if (req.method === 'POST' && req.url === '/tareas') {
      const id = `a${tareas.size + 1}`;
      tareas.set(id, { id, instruccion: c.instruccion, estado: 'trabajando', pregunta: null, pregunta_id: null, propuesta: null });
      return json(200, { id, estado: 'en_cola' });
    }
    const m = req.url!.match(/^\/tareas\/(\w+)(?:\/(\w+))?/);
    const t = m && tareas.get(m[1]);
    if (!t) return json(404, {});
    if (req.method === 'GET' && !m![2]) return json(200, { ...t, motor: 'holo', pasos: [], respuesta: null, error: null, segundos: 1 });
    if (m![2] === 'confirmar') {
      if (t.estado !== 'confirmar' || c.pregunta_id !== t.pregunta_id || c.propuesta !== t.propuesta) return json(409, { detail: 'otra' });
      if (c.si) efectos.push({ tarea: t.id, propuesta: t.propuesta });
      Object.assign(t, { estado: 'trabajando', pregunta: null, pregunta_id: null, propuesta: null });
      return json(200, { id: t.id, si: !!c.si });
    }
    return json(200, { id: t.id, estado: t.estado });
  });
  Object.assign(process.env, { WHATSAPP_PUENTE_URL: puente.url, WHATSAPP_PUENTE_CLAVE: CLAVE_PUENTE, WHATSAPP_DUENOS: JOSE, COMPUTADORA_URL: nodo.url, COMPUTADORA_CLAVE: CLAVE_NODO });
  return { enviados, efectos, tareas, puente, nodo };
}

test('ronda 12 A) (guarda) carrera: dos «sí» a la vez y Aprobar del panel → un solo WhatsApp', async () => {
  const D: any = await import('../lib/durable');
  const W: any = await import('../server/whatsapp');
  const T: any = await import('../server/decision-turno');
  const BRUNO = { jid: '50477773333@s.whatsapp.net', nombre: 'Bruno', grupo: false, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero: '+50477773333' };
  const s = await montar(BRUNO);
  D._usarAlmacenDurable(D.almacenEnMemoria());
  W._olvidarWhatsapp();
  try {
    await W.correrWhatsapp(JOSE, 'responder Bruno | Llego a las 3.', 'tel');
    const b = W.borradorWhatsappDe(JOSE, 'tel');
    assert.ok(b, 'hay borrador');
    const turno = () => T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: 'tel', mensaje: 'sí', whatsapp: true, registrarEfecto: async () => true } as any);
    const r = await Promise.all([turno(), turno(), T.resolverBorradorDesdePanel(JOSE, 'whatsapp', 'tel', b.intento, 'sí', b.huella)]);
    await esperar(200);
    console.log('WhatsApp enviados:', s.enviados.length, '| resultados:', JSON.stringify(r.map((x: any) => (x.hechos ? x.hechos.join(' ').slice(0, 90) : x.estado))));
    assert.equal(s.enviados.length, 1);
  } finally {
    W._olvidarWhatsapp();
    D._usarAlmacenDurable(null);
    await s.puente.cerrar();
    await s.nodo.cerrar();
  }
});

test('ronda 12 B) «sí, el 4455» con WhatsApp al Taller …4455 y la pregunta «¿Pago L 4,455?» → ¿pregunta?', async () => {
  const D: any = await import('../lib/durable');
  const W: any = await import('../server/whatsapp');
  const T: any = await import('../server/decision-turno');
  const PC: any = await import('../server/computadora');
  const TALLER = { jid: '50499994455@s.whatsapp.net', nombre: 'Taller', grupo: false, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero: '+504 9999-4455' };
  const s = await montar(TALLER);
  D._usarAlmacenDurable(D.almacenEnMemoria());
  W._olvidarWhatsapp();
  PC._olvidarEncargos();
  Object.assign(PC.TIEMPOS_SEGUIR, { sondeoMs: 40, silencioTrasTurnoMs: 0, narrarCadaMs: 0, trabajandoCadaMs: 10_000, fallosAntesDeAvisar: 3, sinRespuestaMs: 3000, reintentoMs: 50 });
  const avisos: any[] = [];
  PC.alAvisarApp((_q: string, a: any) => (avisos.push(a), 1));
  try {
    const r = await PC.encargarTarea({ instruccion: 'Paga la factura del agua', quien: JOSE, motor: 'holo', esperaMs: 0, ambito: 'tel' } as any);
    Object.assign(s.tareas.get(r.id!), { estado: 'confirmar', pregunta: '¿Pago la factura del agua de L 4,455.00?', pregunta_id: 'p1', propuesta: 'hP' });
    for (let i = 0; i < 100 && !avisos.some((a) => a.fase === 'confirmar'); i++) await esperar();
    await W.correrWhatsapp(JOSE, 'responder Taller | ¿Ya está listo el carro?', 'tel');
    console.log('pendientes:', JSON.stringify(T.pendientesDelTurno({ dueno: JOSE, ambito: 'tel', whatsapp: true }).map((p: any) => [p.tipo, p.destino || p.texto])));
    const d = await T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: 'tel', mensaje: 'sí, el 4455', whatsapp: true, registrarEfecto: async () => true } as any);
    await esperar(200);
    console.log('ambiguo:', d.ambiguo, '| pagos:', s.efectos.length, '| WhatsApp enviados:', s.enviados.length, '|', d.hechos.join(' ').slice(0, 160));
    assert.equal(s.enviados.length + s.efectos.length, 0, '«4455» cuadra con el monto L 4,455 de la otra decisión: debía preguntar');
  } finally {
    PC.alAvisarApp(null);
    PC._olvidarEncargos();
    W._olvidarWhatsapp();
    D._usarAlmacenDurable(null);
    await s.puente.cerrar();
    await s.nodo.cerrar();
  }
});
