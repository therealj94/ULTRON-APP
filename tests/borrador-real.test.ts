/**
 * EL BORRADOR DE VERDAD, LA RUTA DEL «SÍ» Y LOS CONTACTOS (José, 6-oct, APK 5.6.0). Sin servidor entero:
 *  · lib/borrador-propuesto.ts: «¿Le escribo esto? "…"» en texto libre se reconoce (a quién y qué) para pedir la
 *    herramienta de WhatsApp en su lugar; sin texto citado o sin a quién, nada.
 *  · lib/cerebro-rapido.ts esCharlaParaRuta: un «sí / sale / envíalo» o lo que contesta a una propuesta de acción de AU-RA
 *    («Viejo.» tras «¿Le escribo esto?») nunca va por la charla.
 *  · lib/afirmacion.ts: «Sí, enviarlo.» aprueba el borrador que espera (solo un envío, nunca una llamada).
 *  · server/whatsapp.ts: «a mi compadre» con dos chats «Compadre» pregunta cuál; un nombre que no es exacto avisa a quién va
 *    de verdad. Contra un puente falso; contactos inventados.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { destinoPedido, mismoTextoBorrador, propuestaDeEnvio } from '../lib/borrador-propuesto';
import { anteriorOfreceAccion, esCharlaParaRuta } from '../lib/cerebro-rapido';
import { decidirPendiente } from '../lib/afirmacion';

describe('el borrador de verdad: lo que el modelo propuso en texto', () => {
  const hilo = [
    { role: 'user', content: 'Mándele, ah, un mensaje a mi compadre por WhatsApp.' },
    { role: 'assistant', content: '¿Qué le querés decir?' },
    { role: 'user', content: 'Preguntarle que qué tal todo.' },
  ];
  it('«¿Le escribo esto? "…"» (a quién sale de lo que pidió la persona)', () => {
    assert.deepEqual(propuestaDeEnvio('¿Le escribo esto?\n\n*"Compadre, ¿qué tal todo?"*', { mensaje: 'Compadre.', hilo }), { canal: 'whatsapp', destino: 'compadre', texto: 'Compadre, ¿qué tal todo?' });
  });
  it('«Listo, le escribo a X: "…" ¿Lo envío?» y «Le escribí a X: "…". ¿Lo mandamos?» (a quién, de la respuesta)', () => {
    assert.deepEqual(propuestaDeEnvio('Listo, le escribo a Rosa Mejía: "¿Cómo estás?"\n\n¿Lo envío?', { mensaje: 'que cómo está' }), { canal: 'whatsapp', destino: 'Rosa Mejía', texto: '¿Cómo estás?' });
    assert.deepEqual(propuestaDeEnvio('¡Va, mensaje listo! Le escribí a Rosa Mejía: "¿Cómo vamos?". ¿Lo mandamos?', { mensaje: 'Sí.' }), { canal: 'whatsapp', destino: 'Rosa Mejía', texto: '¿Cómo vamos?' });
  });
  it('nada que proponer: sin texto citado, una cita de otro, un correo (lo arma el modelo), o sin a quién', () => {
    assert.equal(propuestaDeEnvio('La reunión es a las 3.', { mensaje: 'hola' }), null);
    assert.equal(propuestaDeEnvio('Ana te escribió: "¿Vienes mañana?"', { mensaje: '¿qué dice Ana?' }), null);
    assert.equal(propuestaDeEnvio('¿Le escribo «Llego tarde» a Beto por correo?', { mensaje: 'dile a Beto que llego tarde' }), null);
    assert.equal(propuestaDeEnvio('¿Le escribo esto? "Hola"', { mensaje: 'hola' }), null);
  });
  it('a quién, en palabras de la persona (sin el posesivo), también en inglés', () => {
    assert.equal(destinoPedido('Okey, escríbele a mi compadre que cómo vamos.'), 'compadre');
    assert.equal(destinoPedido('Okey, ahora necesito que envíe a mi- Rosa, Mejía'), 'rosa mejia');
    assert.equal(destinoPedido('Mandale un whatsapp a Beto Pérez que ya llegué'), 'beto perez');
    assert.equal(destinoPedido('send a message to Ana'), 'ana');
    assert.equal(mismoTextoBorrador('Compadre, ¿qué tal todo?', 'compadre que tal todo'), true);
  });
});

describe('la ruta: lo que responde a una propuesta de acción va al de las manos', () => {
  it('lo que contesta a «¿Le escribo esto?», «¿Qué le querés decir?», «¿A cuál de los dos?»', () => {
    assert.equal(anteriorOfreceAccion('¿Le escribo esto?\n\n*"Compadre, ¿qué tal todo?"*'), true);
    assert.equal(anteriorOfreceAccion('¿Qué le querés decir?'), true);
    assert.equal(anteriorOfreceAccion('¿A cuál de los dos «Compadre» te refieres?'), true);
    assert.equal(anteriorOfreceAccion('¿Te lo agendo para mañana?'), true);
    assert.equal(anteriorOfreceAccion('Aquí estoy, lista. ¿Cómo te fue hoy?'), false);
    assert.equal(esCharlaParaRuta('Compadre.', '¿Le escribo esto? "Compadre, ¿qué tal todo?"'), false);
    assert.equal(esCharlaParaRuta('Bien, nada más.', '¿Lo envío?'), false);
    assert.equal(esCharlaParaRuta('Bien, nada más.', 'Qué bueno. ¿Cómo estuvo tu día?'), true);
  });
  it('un «sí» que confirma nunca es charla («sale», «simón», «de una», «envíalo»), un «va» dentro de una pregunta sí', () => {
    for (const t of ['Sale.', 'Simón.', 'De una.', 'Sí, enviarlo.', 'Envíalo.', 'Dale pues.']) assert.equal(esCharlaParaRuta(t), false, t);
    assert.equal(esCharlaParaRuta('Buenas, ¿cómo va todo por allá?'), true);
  });
  it('«Sí, enviarlo.» aprueba el borrador que espera; con una llamada propuesta, pregunta', () => {
    assert.equal(decidirPendiente('Sí, enviarlo.', [{ tipo: 'whatsapp', destino: 'Compadre' }]).tipo, 'ejecutar');
    assert.equal(decidirPendiente('Sí, enviarlo. Sí.', [{ tipo: 'whatsapp', destino: 'Compadre' }]).tipo, 'ejecutar');
    assert.equal(decidirPendiente('mandarlo', [{ tipo: 'correo', destino: 'ana@example.test' }]).tipo, 'ejecutar');
    assert.equal(decidirPendiente('Sí, enviarlo.', [{ tipo: 'llamar', destino: 'Compadre' }]).tipo, 'preguntar');
  });
});

/* ── los contactos, contra un puente falso ── */
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'borrador-real-'));
Object.assign(process.env, { ULTRON_CORREO_DIR: DIR, ULTRON_TAREA_CURSO_DIR: path.join(DIR, 'tarea'), ULTRON_DURABLE_DIR: path.join(DIR, 'durable'), ULTRON_MEMORIA_BUCKET: '' });
const CLAVE = 'clave-del-puente-de-prueba-borrador';
const JOSE = 'jose-borrador@example.test';
const sinT = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chat = (jid: string, nombre: string, numero: string) => ({ jid, nombre, grupo: false, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero });
const CHATS = [chat('50477771111@s.whatsapp.net', 'Compadre', '+50477771111'), chat('50477772222@s.whatsapp.net', 'Compadre Luis', '+50477772222'), chat('50477773333@s.whatsapp.net', 'Rosa Elena Mejía Paz', '+50477773333'), chat('50477774444@s.whatsapp.net', 'Bruno', '+50477774444')];
const puente = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
    if (req.headers.authorization !== `Bearer ${CLAVE}`) return json(401, { error: 'clave' });
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/estado') return json(200, { vinculado: true, conectado: true, numero: '+50499998888', vinculando: false });
    if (u.pathname === '/chats') {
      const b = sinT(u.searchParams.get('buscar') || '');
      return json(200, { chats: CHATS.filter((c) => !b || sinT(c.nombre).includes(b)) });
    }
    if (u.pathname === '/contactos') return json(200, { contactos: [] });
    return json(404, { error: 'no' });
  });
});
await new Promise<void>((r) => puente.listen(0, '127.0.0.1', r));
Object.assign(process.env, { WHATSAPP_PUENTE_URL: `http://127.0.0.1:${(puente.address() as AddressInfo).port}`, WHATSAPP_PUENTE_CLAVE: CLAVE, WHATSAPP_DUENOS: JOSE });
const W = await import('../server/whatsapp');
after(() => {
  puente.close();
  fs.rmSync(DIR, { recursive: true, force: true });
});

describe('los contactos: nunca elegir solo', () => {
  it('«mi compadre» con «Compadre» y «Compadre Luis»: pregunta cuál, con los dos, y no deja borrador', async () => {
    W._olvidarWhatsapp();
    const r = await W.correrWhatsappConEstado(JOSE, 'responder mi compadre | ¿Qué tal todo?', 'mesa');
    assert.equal(r.estado, 'failed');
    assert.match(r.texto, /hay 2 chats que encajan/);
    assert.match(r.texto, /Compadre Luis/);
    assert.equal(W.borradorWhatsappDe(JOSE, 'mesa'), null);
  });
  it('un nombre exacto y único («Bruno») va directo al borrador, sin aviso', async () => {
    W._olvidarWhatsapp();
    const r = await W.correrWhatsappConEstado(JOSE, 'responder Bruno | Ya voy', 'mesa');
    assert.equal(r.recibo?.efecto, 'borrador');
    assert.doesNotMatch(r.texto, /OJO: «/);
    assert.equal(W.borradorWhatsappDe(JOSE, 'mesa')?.chat, '50477774444@s.whatsapp.net');
  });
  it('lo dicho no es el nombre exacto («Rosa Elena»): el borrador avisa a quién va de verdad y que lo confirme', async () => {
    W._olvidarWhatsapp();
    const r = await W.correrWhatsappConEstado(JOSE, 'responder Rosa Elena | ¿Cómo vamos?', 'mesa');
    assert.equal(r.recibo?.efecto, 'borrador');
    assert.match(r.texto, /OJO: «Rosa Elena» no es exactamente el nombre de ningún chat; el único que encajó es «Rosa Elena Mejía Paz»/);
  });
});
