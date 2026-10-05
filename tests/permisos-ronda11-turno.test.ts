/**
 * PERMISOS EXACTOS, UNDÉCIMA RONDA (grave). Revisión 10: «sí, el de la computadora» con un WhatsApp esperando cuyo texto habla de «la computadora» y una
 * pregunta de su computadora (un pago). ¿Pregunta cuál, o ejecuta? Camino real: resolverDecisionesDelTurno (server.ts
 * prepararTurno), puente de WhatsApp y nodo de mentira con los «sí» aceptados contados. Datos sintéticos.
 * (Arnés del revisor; aquí importa el código de este repositorio.)
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rev10-canal-'));
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
const BRUNO = { jid: '50477773333@s.whatsapp.net', nombre: 'Bruno', grupo: false, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero: '+50477773333' };
const esperar = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function servidor(h: (req: http.IncomingMessage, cuerpo: any, json: (c: number, j: unknown) => void) => void) {
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => h(req, datos ? JSON.parse(datos) : null, (code, j) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)))));
  });
  return new Promise<{ url: string; cerrar: () => Promise<void> }>((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, cerrar: () => new Promise<void>((x) => (srv.closeAllConnections?.(), srv.close(() => x()))) })));
}

test('ronda 11 (grave, camino real): «sí, el de la computadora» con un WhatsApp a Bruno sobre «la computadora» y el pago en su computadora → pregunta, no confirma el pago', async () => {
  const D: any = await import('../lib/durable');
  const W: any = await import('../server/whatsapp');
  const T: any = await import('../server/decision-turno');
  const PC: any = await import('../server/computadora');
  const enviados: any[] = [];
  const puente = await servidor((req, c, json) => {
    if (req.headers.authorization !== `Bearer ${CLAVE_PUENTE}`) return json(401, {});
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/estado') return json(200, { vinculado: true, conectado: true, numero: '+50499998888', vinculando: false });
    if (u.pathname === '/chats') return json(200, { chats: [BRUNO] });
    if (u.pathname === '/contactos') return json(200, { contactos: [] });
    if (u.pathname === '/mensajes') return json(200, { chat: BRUNO, mensajes: [] });
    if (u.pathname === '/enviar') return (enviados.push(c), json(200, { mensaje: { id: 'E1', chat: c.chat, mio: true, texto: c.texto, tipo: 'texto', hora: Date.now() } }));
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
  D._usarAlmacenDurable(D.almacenEnMemoria());
  W._olvidarWhatsapp();
  PC._olvidarEncargos();
  Object.assign(PC.TIEMPOS_SEGUIR, { sondeoMs: 40, silencioTrasTurnoMs: 0, narrarCadaMs: 0, trabajandoCadaMs: 10_000, fallosAntesDeAvisar: 3, sinRespuestaMs: 3000, reintentoMs: 50 });
  const avisos: any[] = [];
  PC.alAvisarApp((_q: string, a: any) => (avisos.push(a), 1));
  try {
    const r = await PC.encargarTarea({ instruccion: 'Paga la factura de la ferretería', quien: JOSE, motor: 'holo', esperaMs: 0, ambito: 'tel' } as any);
    Object.assign(tareas.get(r.id!), { estado: 'confirmar', pregunta: 'Voy a pagar L 5,000 a Ferretería López. ¿Lo hago?', pregunta_id: 'p1', propuesta: 'hP' });
    for (let i = 0; i < 100 && !avisos.some((a) => a.fase === 'confirmar'); i++) await esperar();
    await W.correrWhatsapp(JOSE, 'responder Bruno | Ya arreglé la computadora, te la llevo mañana.', 'tel');
    console.log('pendientes:', JSON.stringify(T.pendientesDelTurno({ dueno: JOSE, ambito: 'tel', whatsapp: true }).map((p: any) => [p.tipo, p.destino || p.texto, p.tema])));
    const d = await T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: 'tel', mensaje: 'sí, el de la computadora', whatsapp: true, registrarEfecto: async () => true } as any);
    await esperar(200);
    console.log('ambiguo:', d.ambiguo, '| pagos confirmados en el nodo:', JSON.stringify(efectos), '| WhatsApp enviados:', enviados.length);
    console.log('hechos:', d.hechos.join(' || ').slice(0, 300));
    assert.equal(efectos.length, 0, 'con dos lecturas posibles debía preguntar cuál, no confirmar el pago');
  } finally {
    PC.alAvisarApp(null);
    PC._olvidarEncargos();
    W._olvidarWhatsapp();
    D._usarAlmacenDurable(null);
    await puente.cerrar();
    await nodo.cerrar();
  }
});
