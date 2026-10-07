/**
 * WhatsApp con archivos y notas de voz (server/whatsapp.ts; auditoría del 7-oct, A-5 y M-12), contra un puente de mentira
 * que habla como servicios/whatsapp-puente (GET /media, POST /enviar-media) y archivos de verdad (tests/fixtures/adjuntos).
 *
 * Lo que tiene que ser verdad:
 *  · al leer un chat, cada archivo sale numerado y las notas de voz NUEVAS vienen transcritas (con el oído de siempre;
 *    leer otra vez no las vuelve a pagar);
 *  · `documento <n>` lee el PDF por los lectores de siempre, transcribe una nota, y dice la verdad de un video o de un
 *    archivo que WhatsApp ya borró;
 *  · `nota` y `archivo` dejan un BORRADOR que dice qué sale; nada sale sin su «sí»; con el «sí» sale UNA vez por
 *    /enviar-media (lib/envios.ts, con el id de la operación) y el recibo dice «aceptado»; un «no» no manda nada;
 *  · la huella incluye el archivo: aprobar un texto no es aprobar una nota, y se aprueba ESE archivo;
 *  · si la voz no da la nota (o no es Ogg/Opus), no sale nada y se dice.
 */
import './datos-prueba';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-medios-'));
process.env.ULTRON_TAREA_CURSO_DIR = path.join(DIR, 'tarea-en-curso');
process.env.ULTRON_ABIERTOS_DIR = path.join(DIR, 'abiertos');
process.env.ULTRON_DURABLE_DIR = path.join(DIR, 'durable');
process.env.ULTRON_WA_DUENOS_DIR = path.join(DIR, 'wa-duenos');
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const W = await import('../server/whatsapp');
const { _olvidarAdjuntosRecientes, adjuntoReciente } = await import('../lib/adjunto-reciente');
const { lineaDeHerramienta } = await import('../lib/cerebro-manos');
const { INSTRUCCION_WHATSAPP } = await import('../lib/harness');
const { herramientasSegunFrase } = await import('../lib/herramientas-turno');
const { esOggOpus } = await import('../server/eleven');

const F = (n: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'adjuntos', n));
const CLAVE = 'clave-del-puente-de-prueba-123';
const JOSE = 'j.herrera@ordenglobal.org';
const BETO = '50499990000@s.whatsapp.net';

/** Una nota de voz Ogg/Opus mínima (la cabecera que mira el servidor). */
function notaOgg(): Buffer {
  const cab = Buffer.concat([Buffer.from('OpusHead'), Buffer.from([1, 1, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0])]);
  const h = Buffer.alloc(27);
  h.write('OggS', 0, 'latin1');
  h[26] = 1;
  return Buffer.concat([h, Buffer.from([cab.length]), cab, Buffer.alloc(40, 1)]);
}

async function puente() {
  const ahora = Date.now();
  const medias: string[] = [];
  const enviados: any[] = [];
  const mensajes = [
    { id: 't1', chat: BETO, de: BETO, nombreDe: 'Beto', mio: false, hora: ahora - 50_000, tipo: 'texto', texto: 'Te mando la cotización' },
    { id: 'd1', chat: BETO, de: BETO, nombreDe: 'Beto', mio: false, hora: ahora - 40_000, tipo: 'documento', texto: '', archivo: 'cotizacion.pdf', conMedia: true },
    { id: 'v1', chat: BETO, de: BETO, nombreDe: 'Beto', mio: false, hora: ahora - 30_000, tipo: 'video', texto: '', duracion: 8, conMedia: true },
    { id: 'x1', chat: BETO, de: BETO, nombreDe: 'Beto', mio: false, hora: ahora - 20_000, tipo: 'documento', texto: '', archivo: 'viejo.pdf', conMedia: true },
    { id: 'a1', chat: BETO, de: BETO, nombreDe: 'Beto', mio: false, hora: ahora - 10_000, tipo: 'audio', texto: '', duracion: 12, conMedia: true },
  ];
  const chats = [{ jid: BETO, nombre: 'Beto', grupo: false, noLeidos: 1, hora: ahora, ultimo: '🎤 Nota de voz', ultimoMio: false, numero: '+50499990000' }];
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x');
      const eco = { 'x-cuenta-eco': String(req.headers['x-cuenta'] || '') };
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json', ...eco }), res.end(JSON.stringify(j)));
      if (u.pathname === '/salud') return json(200, { ok: true, maxCuentas: 25 });
      if (req.headers.authorization !== `Bearer ${CLAVE}` || req.headers['x-cuenta'] !== 'legado') return json(401, { error: 'clave' });
      if (u.pathname === '/estado') return json(200, { vinculado: true, conectado: true, numero: '+50499998888', vinculando: false, registrada: true });
      if (u.pathname === '/chats') return json(200, { chats });
      if (u.pathname === '/contactos') return json(200, { contactos: [] });
      if (u.pathname === '/mensajes') return json(200, { chat: chats[0], mensajes: mensajes.filter((m) => m.chat === u.searchParams.get('chat')) });
      if (u.pathname === '/mensaje') return json(404, { error: 'no' });
      if (u.pathname === '/media') {
        const id = String(u.searchParams.get('id'));
        medias.push(id);
        const archivo = (b: Buffer, tipo: string) => (res.writeHead(200, { 'content-type': tipo, 'content-length': String(b.length), ...eco }), res.end(b));
        if (id === 'd1') return archivo(F('cotizacion.pdf'), 'application/pdf');
        if (id === 'a1') return archivo(notaOgg(), 'audio/ogg; codecs=opus');
        if (id === 'x1') return json(410, { error: 'esa foto ya no está en WhatsApp; ábrela en tu teléfono' });
        return json(404, { error: 'ese mensaje no tiene archivo' });
      }
      if (u.pathname === '/enviar-media') {
        const c = JSON.parse(datos);
        enviados.push(c);
        return json(200, { mensaje: { id: c.id || 'M1', chat: c.chat, mio: true, tipo: c.tipo === 'nota' ? 'audio' : c.tipo, texto: c.pie || '', archivo: c.nombre || '', hora: Date.now() } });
      }
      return json(404, { error: 'no' });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, medias, enviados, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

type Oidos = { veces: number };
async function conPuente(f: (p: Awaited<ReturnType<typeof puente>>, oidos: Oidos) => Promise<void>, o: { nota?: Buffer | null } = {}) {
  const p = await puente();
  const antes = { u: process.env.WHATSAPP_PUENTE_URL, c: process.env.WHATSAPP_PUENTE_CLAVE, d: process.env.WHATSAPP_DUENOS };
  process.env.WHATSAPP_PUENTE_URL = p.url;
  process.env.WHATSAPP_PUENTE_CLAVE = CLAVE;
  process.env.WHATSAPP_DUENOS = JOSE;
  const oidos: Oidos = { veces: 0 };
  W._olvidarWhatsapp();
  _olvidarAdjuntosRecientes();
  W._mediosWhatsappDePrueba({
    oir: async () => ((oidos.veces += 1), { texto: 'Llego a las tres con los papeles', detalle: '' }),
    notaDeVoz: async () => (o.nota === undefined ? notaOgg() : o.nota),
    documento: async (_q, id) => (id === 'docABC12345' ? { nombre: 'informe.pdf', mime: 'application/pdf', datos: F('cotizacion.pdf') } : null),
  });
  try {
    await f(p, oidos);
  } finally {
    W._mediosWhatsappDePrueba(null);
    W._olvidarWhatsapp();
    for (const [k, v] of [['WHATSAPP_PUENTE_URL', antes.u], ['WHATSAPP_PUENTE_CLAVE', antes.c], ['WHATSAPP_DUENOS', antes.d]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await p.cerrar();
  }
}

test('leer un chat: archivos numerados y la nota de voz nueva transcrita (una sola vez); documento lee el PDF, la nota, y dice la verdad del resto', async () => {
  await conPuente(async (p, oidos) => {
    const l = await W.correrWhatsappConEstado(JOSE, 'leer Beto', 'tel');
    assert.equal(l.estado, 'succeeded');
    assert.match(l.texto, /\[documento cotizacion\.pdf — archivo 1\]/);
    assert.match(l.texto, /\[video 8 s — archivo 2\]/);
    assert.match(l.texto, /\[nota de voz 12 s — archivo 4\] \(lo que dice la nota, transcrito: «Llego a las tres con los papeles»\)/);
    assert.match(l.texto, /whatsapp documento <número del archivo>/);
    assert.equal(oidos.veces, 1);
    await W.correrWhatsappConEstado(JOSE, 'leer Beto', 'tel');
    assert.equal(oidos.veces, 1, 'leer otra vez no vuelve a pagar la transcripción');
    assert.deepEqual(p.medias, ['a1'], 'solo se bajó la nota (y una vez)');

    const pdf = await W.correrWhatsappConEstado(JOSE, 'documento 1', 'tel');
    assert.equal(pdf.estado, 'succeeded');
    assert.match(pdf.texto, /ARCHIVO «cotizacion\.pdf» \(PDF, \d+ KB\) de Beto/);
    assert.match(pdf.texto, /48,500\.00/);
    assert.equal(pdf.recibo?.efecto, 'ninguno');
    assert.equal(adjuntoReciente(JOSE, 'tel')?.nombre, 'cotizacion.pdf', 'queda a mano para reenviarlo');

    const video = await W.correrWhatsappConEstado(JOSE, 'documento 2', 'tel');
    assert.ok(video.estado === 'failed' && /es un video.*no lo puedo ver/.test(video.texto));
    const viejo = await W.correrWhatsappConEstado(JOSE, 'documento 3', 'tel');
    assert.ok(viejo.estado === 'failed' && /ya no está en el servidor de WhatsApp/.test(viejo.texto));
    const nota = await W.correrWhatsappConEstado(JOSE, 'documento 4', 'tel');
    assert.ok(nota.estado === 'succeeded' && /NOTA DE VOZ de Beto/.test(nota.texto) && /Llego a las tres/.test(nota.texto));
    assert.equal(oidos.veces, 1, 'la nota ya oída sale de lo guardado');
    const cual = await W.correrWhatsappConEstado(JOSE, 'documento 9', 'tel');
    assert.ok(cual.estado === 'failed' && /¿cuál archivo del chat con Beto\?/.test(cual.texto));
    // Sin haber leído el chat (otra conversación): primero leerlo.
    const sin = await W.correrWhatsappConEstado(JOSE, 'documento 1', 'otra');
    assert.ok(sin.estado === 'failed' && /primero léele el chat/.test(sin.texto));
  });
});

test('reenviar un archivo: borrador que dice qué sale, nada antes del «sí», UNA vez después, con los bytes aprobados', async () => {
  await conPuente(async (p) => {
    const sinNada = await W.correrWhatsappConEstado(JOSE, 'archivo Beto | adjunto', 'tel');
    assert.ok(sinNada.estado === 'failed' && /no tengo ningún archivo a mano/.test(sinNada.texto));
    await W.correrWhatsappConEstado(JOSE, 'leer Beto', 'tel');
    await W.correrWhatsappConEstado(JOSE, 'documento 1', 'tel');
    const b = await W.correrWhatsappConEstado(JOSE, 'archivo Beto | adjunto | Aquí va la cotización', 'tel');
    assert.equal(b.estado, 'succeeded');
    assert.equal(b.recibo?.efecto, 'borrador');
    assert.match(b.texto, /BORRADOR DE WHATSAPP CON ARCHIVO \(NO enviado\) para Beto \(\+50499990000\): el documento «cotizacion\.pdf»/);
    assert.match(b.texto, /Aquí va la cotización/);
    assert.equal(p.enviados.length, 0, 'nada sale sin su «sí»');
    const guardado = W.borradorWhatsappDe(JOSE, 'tel')!;
    assert.equal(guardado.media?.tipo, 'documento');
    const r = (await W.resolverBorradorWhatsappConEstado(JOSE, 'tel', 'sí'))!;
    assert.equal(r.estado, 'succeeded', r.texto);
    assert.match(r.texto, /WHATSAPP ENVIADO a Beto: el documento «cotizacion\.pdf»/);
    assert.equal(r.recibo?.efecto, 'confirmado');
    assert.equal(r.recibo?.entrega, 'aceptado');
    assert.ok(r.recibo?.operacion);
    assert.equal(p.enviados.length, 1);
    const e = p.enviados[0];
    assert.equal(e.tipo, 'documento');
    assert.equal(e.nombre, 'cotizacion.pdf');
    assert.equal(e.pie, 'Aquí va la cotización');
    assert.match(e.id, /^3EB0[0-9A-F]{16,}$/, 'con el id de la operación (el puente no lo manda dos veces)');
    assert.ok(Buffer.from(e.datos, 'base64').equals(F('cotizacion.pdf')), 'salen los bytes que se aprobaron');
    // El mismo borrador aprobado otra vez: no sale de nuevo.
    const otra = await W.enviarBorradorWhatsappAprobado(JOSE, guardado);
    assert.equal(otra.estado, 'succeeded');
    assert.equal(p.enviados.length, 1);
  });
});

test('nota de voz: el borrador dice que va con la voz de AURA; con el «sí» sale Ogg/Opus como nota; un «no» no manda nada', async () => {
  await conPuente(async (p) => {
    const b = await W.correrWhatsappConEstado(JOSE, 'nota Beto | Voy en camino', 'tel');
    assert.equal(b.recibo?.efecto, 'borrador');
    assert.match(b.texto, /BORRADOR DE NOTA DE VOZ \(NO enviada\) para Beto.*con la voz de AURA \(no la de la persona\)/s);
    const nota = W.borradorWhatsappDe(JOSE, 'tel')!;
    const huellaTexto = W.huellaWhatsapp({ chat: nota.chat, texto: nota.texto, cuenta: nota.cuenta });
    assert.equal(nota.huella, W.huellaWhatsapp(nota));
    assert.notEqual(nota.huella, huellaTexto, 'aprobar un texto no es aprobar una nota con el mismo texto');
    assert.equal(p.enviados.length, 0);
    const r = (await W.resolverBorradorWhatsappConEstado(JOSE, 'tel', 'sí'))!;
    assert.equal(r.estado, 'succeeded', r.texto);
    assert.match(r.texto, /WHATSAPP ENVIADO a Beto: una NOTA DE VOZ con la voz de AURA \(«Voy en camino»\)/);
    assert.equal(p.enviados.length, 1);
    assert.equal(p.enviados[0].tipo, 'nota');
    assert.ok(esOggOpus(Buffer.from(p.enviados[0].datos, 'base64')));
    assert.equal(p.enviados[0].pie, undefined, 'una nota no lleva pie');

    await W.correrWhatsappConEstado(JOSE, 'nota Beto | Otra cosa', 'tel');
    const no = (await W.resolverBorradorWhatsappConEstado(JOSE, 'tel', 'no'))!;
    assert.match(no.texto, /no se mandó|descart/i);
    assert.equal(p.enviados.length, 1);
  });
});

test('si la voz no da la nota (o no es Ogg/Opus) no sale nada y se dice; un documento de AURA por su id', async () => {
  await conPuente(
    async (p) => {
      await W.correrWhatsappConEstado(JOSE, 'nota Beto | Ya voy', 'tel');
      const r = (await W.resolverBorradorWhatsappConEstado(JOSE, 'tel', 'sí'))!;
      assert.equal(r.estado, 'failed');
      assert.match(r.texto, /NO se pudo mandar \(no pude hacer la nota de voz/);
      assert.equal(p.enviados.length, 0);
      const desconocido = await W.correrWhatsappConEstado(JOSE, 'archivo Beto | docNOEXISTE99', 'tel');
      assert.ok(desconocido.estado === 'failed' && /no encuentro un documento suyo/.test(desconocido.texto));
      const doc = await W.correrWhatsappConEstado(JOSE, 'archivo Beto | docABC12345', 'tel');
      assert.match(doc.texto, /el documento «informe\.pdf»/);
    },
    { nota: null }
  );
});

test('las herramientas y los grupos del turno conocen documento, nota, archivo y los VIP', () => {
  assert.equal(lineaDeHerramienta('whatsapp', { accion: 'documento', numero: 2 }), 'PEDIR_HERRAMIENTA: whatsapp documento 2');
  assert.equal(lineaDeHerramienta('whatsapp', { accion: 'nota', chat: 'Beto', texto: 'Voy en camino' }), 'PEDIR_HERRAMIENTA: whatsapp nota Beto | Voy en camino');
  assert.equal(lineaDeHerramienta('whatsapp', { accion: 'archivo', chat: 'Beto' }), 'PEDIR_HERRAMIENTA: whatsapp archivo Beto | adjunto');
  assert.equal(lineaDeHerramienta('whatsapp', { accion: 'seguir' }), 'PEDIR_HERRAMIENTA: whatsapp seguir');
  assert.equal(lineaDeHerramienta('contactos_vip', { accion: 'agregar', persona: 'Ana', numero: '+504 9999 1111' }), 'PEDIR_HERRAMIENTA: triaje vip agregar Ana | +504 9999 1111 | ');
  assert.equal(lineaDeHerramienta('contactos_vip', { accion: 'listar' }), 'PEDIR_HERRAMIENTA: triaje vip listar');
  assert.match(INSTRUCCION_WHATSAPP, /whatsapp nota <chat>/);
  const todas = ['buscar_web', 'whatsapp', 'correo', 'contactos_vip', 'ordenar_mensajes', 'recordatorio'].map((name) => ({ toolSpec: { name } })) as any;
  const pdf = herramientasSegunFrase(todas, { mensaje: '¿qué dice el pdf que me mandó Beto?' });
  assert.ok(pdf.grupos.includes('archivos') && pdf.herramientas.some((t: any) => t.toolSpec.name === 'whatsapp'));
  const vip = herramientasSegunFrase(todas, { mensaje: 'avísame cuando me escriba Ana' });
  assert.ok(vip.herramientas.some((t: any) => t.toolSpec.name === 'contactos_vip'), JSON.stringify(vip.grupos));
});
