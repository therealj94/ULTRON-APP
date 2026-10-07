/**
 * Revisión de seguridad del 5-oct (WhatsApp para todos, server/whatsapp.ts) contra un puente de mentira:
 *  - MEDIO-1: el eco de la cuenta (X-Cuenta-Eco). Un puente sin eco (uno de antes, devuelto después de la migración)
 *    no le pasa a nadie que no sea «legado» ni un byte de lo que contestó; lo que tiene efecto ni siquiera sale.
 *  - MEDIO-2: /vincular por IP (cualquier identidad; IPv6 por su /64) y por cuenta; la prioridad de la junta la pone
 *    solo el servidor.
 *  - MENOR: sin WHATSAPP_ABIERTO=1 solo los dueños (cerrado por omisión), cuenta suspendida, sin la marca de comunidad no se da por buena, sin WHATSAPP_CUENTA_SECRETO solo los
 *    dueños, las fotos y archivos sin caché compartida y lo que no es imagen, audio o video como adjunto.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type RequestHandler } from 'express';

const DIR_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-seg-'));
process.env.ULTRON_TAREA_CURSO_DIR = path.join(DIR_DATOS, 'tarea-en-curso');
process.env.ULTRON_ABIERTOS_DIR = path.join(DIR_DATOS, 'abiertos');
process.env.ULTRON_DURABLE_DIR = path.join(DIR_DATOS, 'durable');
// De quién es cada cuenta del puente (A-6, lib/duenos-cuenta-wa.ts), también en el temporal.
process.env.ULTRON_WA_DUENOS_DIR = path.join(DIR_DATOS, 'wa-duenos');

const W = await import('../server/whatsapp');
const D = await import('../lib/durable');

const CLAVE = 'clave-del-puente-de-prueba-123';
const SECRETO = 'secreto-de-cuentas-de-prueba-de-24+';
const JOSE = 'j.herrera@ordenglobal.org'; // dueño: «legado»
const RAMIRO = 'r.herrera@ordenglobal.org'; // de la junta (en el padrón)
const ANA = 'ana.prueba@ejemplo.org'; // miembro de la comunidad (fuera del padrón, con la marca firmada)
const BETO = 'beto.prueba@ejemplo.org';

type Pedido = { metodo: string; ruta: string; cuenta: string; prioridad: string };

/**
 * Un puente nuevo (dice `maxCuentas` en /salud) que guarda lo de cada cuenta. `eco`: 'si' (como el puente nuevo),
 * 'no' (como uno de antes: ignora X-Cuenta y todo es el WhatsApp de José) u 'otra' (contesta con el eco de otra cuenta).
 */
async function puente() {
  const modo = { eco: 'si' as 'si' | 'no' | 'otra' };
  const pedidos: Pedido[] = [];
  const enviados: Array<{ cuenta: string; chat: string; texto: string }> = [];
  const vinculadas = new Set<string>(['legado']);
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x');
      const cuenta = String(req.headers['x-cuenta'] || '');
      if (u.pathname !== '/salud') pedidos.push({ metodo: req.method!, ruta: u.pathname, cuenta, prioridad: String(req.headers['x-cuenta-prioridad'] || '') });
      // Lo de José (lo que un puente de antes le daría a cualquiera).
      const deJose = modo.eco === 'no' || cuenta === 'legado';
      const cab = (extra: Record<string, string>) => {
        const h: Record<string, string> = { ...extra };
        if (modo.eco === 'si') h['x-cuenta-eco'] = cuenta;
        if (modo.eco === 'otra') h['x-cuenta-eco'] = 'legado';
        return h;
      };
      const json = (code: number, j: unknown) => (res.writeHead(code, cab({ 'content-type': 'application/json' })), res.end(JSON.stringify(j)));
      if (u.pathname === '/salud') return json(200, { ok: true, cuentas: vinculadas.size, maxCuentas: 25 });
      if (req.headers.authorization !== `Bearer ${CLAVE}`) return json(401, { error: 'clave' });
      if (u.pathname === '/estado') {
        const v = deJose || vinculadas.has(cuenta);
        return json(200, { vinculado: v, conectado: v, numero: v ? (deJose ? '+50499998888' : '+50477776666') : undefined, vinculando: false, registrada: v });
      }
      if (u.pathname === '/vincular') return json(200, JSON.parse(datos || '{}').telefono ? { codigo: 'SECR-ETO1' } : { qr: 'data:image/png;base64,QRSECRETO' });
      if (!deJose && !vinculadas.has(cuenta)) return json(412, { error: 'no hay un WhatsApp vinculado', codigo: 'SIN_VINCULAR' });
      if (u.pathname === '/chats') return json(200, { chats: deJose ? [{ jid: '50499990000@s.whatsapp.net', nombre: 'Beto de José', grupo: false, noLeidos: 1, hora: Date.now(), ultimo: 'secreto de José', ultimoMio: false }] : [] });
      if (u.pathname === '/enviar') {
        const c = JSON.parse(datos);
        enviados.push({ cuenta, chat: c.chat, texto: c.texto });
        return json(200, { mensaje: { id: c.id || 'E1', chat: c.chat, mio: true, texto: c.texto, tipo: 'texto', hora: Date.now() } });
      }
      if (u.pathname === '/mensaje') return json(404, { error: 'no está' });
      if (u.pathname === '/media') {
        const pdf = u.searchParams.get('id') === 'pdf';
        const cuerpo = pdf ? '%PDF-secreto' : 'JPG-secreto';
        res.writeHead(200, cab({ 'content-type': pdf ? 'application/pdf' : 'image/jpeg', 'content-length': String(cuerpo.length), 'cache-control': 'private, max-age=3600' }));
        return res.end(cuerpo);
      }
      if (u.pathname === '/foto') {
        res.writeHead(200, cab({ 'content-type': 'image/jpeg', 'content-length': '12', 'cache-control': 'private, max-age=3600' }));
        return res.end('FOTO-secreta');
      }
      return json(404, { error: 'no' });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, modo, pedidos, enviados, vinculadas, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

/**
 * El entorno de WhatsApp para una prueba (y lo de antes al terminar). `secreto: null`: sin WHATSAPP_CUENTA_SECRETO.
 * `abierto`: WHATSAPP_ABIERTO ('1' si no se dice; `null`, sin fijarla).
 */
async function con<T>(url: string, fn: () => Promise<T>, o: { secreto?: string | null; abierto?: string | null } = {}): Promise<T> {
  const nombres = ['WHATSAPP_PUENTE_URL', 'WHATSAPP_PUENTE_CLAVE', 'WHATSAPP_DUENOS', 'WHATSAPP_ABIERTO', 'WHATSAPP_CUENTA_SECRETO'] as const;
  const antes = Object.fromEntries(nombres.map((k) => [k, process.env[k]]));
  process.env.WHATSAPP_PUENTE_URL = url;
  process.env.WHATSAPP_PUENTE_CLAVE = CLAVE;
  process.env.WHATSAPP_DUENOS = JOSE;
  if (o.abierto === null) delete process.env.WHATSAPP_ABIERTO;
  else process.env.WHATSAPP_ABIERTO = o.abierto ?? '1';
  if (o.secreto === null) delete process.env.WHATSAPP_CUENTA_SECRETO;
  else process.env.WHATSAPP_CUENTA_SECRETO = o.secreto ?? SECRETO;
  W._olvidarWhatsapp();
  W._olvidarSesionesWhatsapp?.();
  try {
    return await fn();
  } finally {
    for (const k of nombres) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
    W._olvidarWhatsapp();
    W._olvidarSesionesWhatsapp?.();
  }
}

/** Las rutas como en server.ts (detrás de un proxy: la IP sale de X-Forwarded-For). */
async function app() {
  const a = express();
  a.set('trust proxy', true);
  a.use(express.json());
  const pasa: RequestHandler = (_q, _r, n) => n();
  W.montarRutasWhatsapp(a, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']), comunidad: req.headers['x-comunidad'] === '1' } : null) });
  const srv = a.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const como = (quien: string, ruta: string, o: { metodo?: string; cuerpo?: unknown; comunidad?: boolean; ip?: string; cabeceras?: Record<string, string> } = {}) =>
    fetch(`${base}${ruta}`, {
      method: o.metodo || 'GET',
      ...(o.cuerpo !== undefined ? { body: JSON.stringify(o.cuerpo) } : {}),
      headers: { 'content-type': 'application/json', 'x-quien': quien, ...(o.comunidad ? { 'x-comunidad': '1' } : {}), 'x-forwarded-for': o.ip || '203.0.113.7', ...(o.cabeceras || {}) },
    });
  return { como, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

test('MEDIO-1: un puente sin eco de la cuenta (devuelto a uno de antes) no le pasa nada a otra cuenta; lo que tiene efecto ni sale', async () => {
  const p = await puente();
  D._usarAlmacenDurable(D.almacenEnMemoria());
  try {
    await con(p.url, async () => {
      const { como, cerrar } = await app();
      try {
        // Con eco: Ana (comunidad) usa su WhatsApp. Esto deja recordado que el puente «separa cuentas».
        p.vinculadas.add(W.claveCuentaWhatsapp(ANA));
        assert.equal((await como(ANA, '/api/whatsapp/chats', { comunidad: true })).status, 200);

        // Se devuelve el puente a uno de antes: ignora X-Cuenta y no hace eco. El servidor todavía lo cree «nuevo» (lo
        // recordado de /salud), así que lo primero llega al puente.
        p.modo.eco = 'no';
        // Enviar ni siquiera llega: antes se comprueba el eco con una pregunta sin efecto (/estado).
        const env = await como(ANA, '/api/whatsapp/enviar', { metodo: 'POST', cuerpo: { chat: '50499990000@s.whatsapp.net', texto: 'hola' }, comunidad: true });
        assert.equal(env.status, 503);
        assert.match((await env.json()).error, /todavía es de una sola cuenta/);
        assert.deepEqual(p.enviados, [], 'no salió nada del WhatsApp de José');
        assert.ok(p.pedidos.some((x) => x.ruta === '/estado' && x.cuenta === W.claveCuentaWhatsapp(ANA)), 'la pregunta sin efecto sí llegó');
        assert.ok(!p.pedidos.some((x) => x.ruta === '/enviar'), 'el envío no llegó al puente');

        // Cada una de estas llega al puente (se olvida lo recordado) y vuelve sin eco: nada pasa a Ana.
        const llego = (ruta: string) => p.pedidos.some((x) => x.ruta === ruta && x.cuenta === W.claveCuentaWhatsapp(ANA));
        W._olvidarWhatsapp();
        const chats = await como(ANA, '/api/whatsapp/chats', { comunidad: true });
        assert.ok(llego('/chats'));
        assert.equal(chats.status, 503);
        const cuerpo = await chats.text();
        assert.match(cuerpo, /PUENTE_VIEJO/);
        assert.doesNotMatch(cuerpo, /José|secreto|Beto/, 'nada de lo que contestó el puente llega a Ana');
        for (const [ruta, aPuente] of [
          ['/api/whatsapp/media?chat=c&id=foto', '/media'],
          ['/api/whatsapp/foto?chat=50499990000@s.whatsapp.net', '/foto'],
        ] as const) {
          W._olvidarWhatsapp();
          const r = await como(ANA, ruta, { comunidad: true });
          assert.ok(llego(aPuente), aPuente);
          assert.equal(r.status, 503, ruta);
          assert.equal(r.headers.get('content-type')?.startsWith('application/json'), true, `${ruta}: sin la imagen`);
          assert.doesNotMatch(await r.text(), /secret/i);
        }
        W._olvidarWhatsapp();
        const vin = await como(ANA, '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: { telefono: '50477776666' }, comunidad: true });
        assert.equal(vin.status, 503);
        assert.doesNotMatch(await vin.text(), /SECR-ETO1|QRSECRETO/, 'ni el código ni el QR');
        assert.ok(!llego('/vincular'), 'vincular (con efecto) tampoco llega');
        W._olvidarWhatsapp();
        assert.equal((await como(ANA, '/api/whatsapp/leido', { metodo: 'POST', cuerpo: { chat: 'x' }, comunidad: true })).status, 503);
        assert.ok(!llego('/leido'));
        // Después de un rechazo, lo demás ni pregunta (hasta volver a mirar /salud).
        const n = p.pedidos.length;
        assert.equal((await como(ANA, '/api/whatsapp/contactos', { comunidad: true })).status, 503);
        assert.equal(p.pedidos.length, n);

        // El cerebro tampoco (la sesión de Ana, con su marca, acaba de pasar por la app).
        W._olvidarWhatsapp();
        assert.match(await W.correrWhatsapp(ANA, 'revisar'), /falló \(El puente de WhatsApp todavía es de una sola cuenta/);
        assert.equal(await W.whatsappOfrecido(ANA), false);

        // José (legado) sigue igual con el puente de antes.
        const cj = await como(JOSE, '/api/whatsapp/chats');
        assert.equal(cj.status, 200);
        assert.deepEqual((await cj.json()).chats.map((c: any) => c.nombre), ['Beto de José']);
        assert.equal((await como(JOSE, '/api/whatsapp/enviar', { metodo: 'POST', cuerpo: { chat: '50499990000@s.whatsapp.net', texto: 'de José' } })).status, 200);
        assert.deepEqual(p.enviados.map((e) => e.texto), ['de José']);

        // Un eco de OTRA cuenta tampoco vale.
        p.modo.eco = 'otra';
        W._olvidarWhatsapp();
        assert.equal((await como(ANA, '/api/whatsapp/chats', { comunidad: true })).status, 503);

        // Con el puente nuevo otra vez, vuelve solo (el «no» se vuelve a preguntar).
        p.modo.eco = 'si';
        W._olvidarWhatsapp();
        assert.equal((await como(ANA, '/api/whatsapp/chats', { comunidad: true })).status, 200);
        const foto = await como(ANA, '/api/whatsapp/foto?chat=50499990000@s.whatsapp.net', { comunidad: true });
        assert.equal(foto.status, 200, 'con el eco de SU cuenta, la foto pasa');
      } finally {
        await cerrar();
      }
    });
  } finally {
    D._usarAlmacenDurable(null);
    await p.cerrar();
  }
});

test('MEDIO-2: /vincular por IP (cualquier identidad; IPv6 por su /64) y por cuenta; la prioridad de la junta la pone solo el servidor', async () => {
  const p = await puente();
  try {
    await con(p.url, async () => {
      const { como, cerrar } = await app();
      try {
        // Cinco identidades distintas desde la misma IP: la sexta ya no (aunque sea otra cuenta).
        for (let i = 0; i < 5; i++) {
          const r = await como(`tirar${i}@ejemplo.org`, '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true, ip: '198.51.100.9' });
          assert.equal(r.status, 200, `intento ${i}`);
        }
        const tope = await como('tirar5@ejemplo.org', '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true, ip: '198.51.100.9' });
        assert.equal(tope.status, 429);
        assert.equal((await tope.json()).code, 'whatsapp_limite_vincular');
        assert.ok(tope.headers.get('retry-after'));
        assert.equal(p.pedidos.filter((x) => x.ruta === '/vincular').length, 5, 'el sexto no llegó al puente');
        // Otra IP, sí.
        assert.equal((await como('tirar5@ejemplo.org', '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true, ip: '198.51.100.10' })).status, 200);

        // IPv6: la misma /64 cuenta junta (rotar la parte baja no da más intentos).
        for (let i = 0; i < 5; i++) {
          assert.equal((await como(`seis${i}@ejemplo.org`, '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true, ip: `2001:db8:1:2:${i + 1}::7` })).status, 200);
        }
        assert.equal((await como('seis9@ejemplo.org', '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true, ip: '2001:db8:1:2:ffff::1' })).status, 429);
        assert.equal((await como('seis9@ejemplo.org', '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true, ip: '2001:db8:1:3::1' })).status, 200, 'otra /64');

        // Por cuenta, aunque cambie de IP.
        W._olvidarWhatsapp();
        for (let i = 0; i < 8; i++) assert.equal((await como(BETO, '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true, ip: `192.0.2.${i + 1}` })).status, 200);
        assert.equal((await como(BETO, '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true, ip: '192.0.2.99' })).status, 429);

        // La prioridad: la junta (padrón) la lleva; la comunidad no, ni aunque la mande en su pedido.
        W._olvidarWhatsapp();
        p.pedidos.length = 0;
        await como(RAMIRO, '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {} });
        await como(ANA, '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true, cabeceras: { 'x-cuenta-prioridad': 'junta' } });
        await como(JOSE, '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {} });
        const vin = p.pedidos.filter((x) => x.ruta === '/vincular');
        assert.deepEqual(
          vin.map((x) => [x.cuenta === W.claveCuentaWhatsapp(RAMIRO) ? 'ramiro' : x.cuenta === 'legado' ? 'legado' : 'ana', x.prioridad]),
          [
            ['ramiro', 'junta'],
            ['ana', ''],
            ['legado', 'junta'],
          ]
        );
        assert.ok(!p.pedidos.some((x) => x.ruta !== '/vincular' && x.prioridad), 'solo en /vincular');
      } finally {
        await cerrar();
      }
    });
  } finally {
    await p.cerrar();
  }
});

test('MENOR: una cuenta suspendida no usa WhatsApp (app, cerebro ni envío); sin la marca de comunidad no se da por buena', async () => {
  const p = await puente();
  D._usarAlmacenDurable(D.almacenEnMemoria());
  try {
    await con(p.url, async () => {
      // Sin la marca de comunidad (y sin una sesión firmada que la haya traído), fuera del padrón: no.
      assert.equal(await W.whatsappPermitido(ANA), false, 'sin la marca: no');
      assert.equal(await W.whatsappPermitido(ANA, { comunidad: false }), false);
      assert.equal(await W.whatsappPermitido(ANA, { comunidad: true }), true);
      // Los dueños y la junta (padrón con AU-RA) no la necesitan: el cerebro y Telegram siguen igual para ellos.
      assert.equal(await W.whatsappPermitido(JOSE), true);
      assert.equal(await W.whatsappPermitido(RAMIRO), true);
      assert.equal(await W.whatsappOfrecido(JOSE), true);
      assert.match(await W.correrWhatsapp(JOSE, 'revisar'), /Beto de José/);
      assert.equal(await W.whatsappPermitido('x@temporal.drelectrum', { comunidad: true }), false, 'un código temporal nunca');

      const { como, cerrar } = await app();
      try {
        p.vinculadas.add(W.claveCuentaWhatsapp(ANA));
        // La sesión de Ana (firmada, con la marca) pasó por la app: el cerebro de esa sesión ya la sabe de la comunidad.
        assert.equal((await como(ANA, '/api/whatsapp/chats', { comunidad: true })).status, 200);
        assert.equal(await W.whatsappPermitido(ANA), true, 'vista con la marca firmada');
        assert.match(await W.correrWhatsapp(ANA, 'responder 50455554444 | hola', 'tel'), /BORRADOR DE WHATSAPP/);

        // La suspenden: ni la app, ni el cerebro, ni el «sí» del borrador que ya tenía.
        W._suspensionWhatsappDePrueba(async (c) => c === ANA);
        const r = await como(ANA, '/api/whatsapp/chats', { comunidad: true });
        assert.equal(r.status, 403);
        assert.equal((await r.json()).code, 'whatsapp_no_permitido');
        const e = await (await como(ANA, '/api/whatsapp/estado', { comunidad: true })).json();
        assert.deepEqual([e.permitido, e.vinculado, e.numero], [false, false, undefined]);
        assert.equal(await W.whatsappPermitido(ANA, { comunidad: true }), false);
        assert.equal(await W.whatsappOfrecido(ANA), false);
        assert.match(await W.correrWhatsapp(ANA, 'revisar'), /no tiene WhatsApp conectado aquí/);
        assert.match((await W.resolverBorradorWhatsapp(ANA, 'tel', 'sí'))!, /esta cuenta ya no tiene su WhatsApp/);
        assert.deepEqual(p.enviados, [], 'no salió nada');
        // A los demás no les cambia nada.
        assert.equal((await como(JOSE, '/api/whatsapp/chats')).status, 200);
        // Si no se puede saber (la base no contesta): la comunidad no pasa; los dueños sí.
        W._suspensionWhatsappDePrueba(async () => {
          throw new Error('sin base');
        });
        assert.equal(await W.whatsappPermitido(BETO, { comunidad: true }), false);
        assert.equal(await W.whatsappPermitido(JOSE), true);
      } finally {
        W._suspensionWhatsappDePrueba(null);
        await cerrar();
      }
    });
  } finally {
    D._usarAlmacenDurable(null);
    await p.cerrar();
  }
});

test('MENOR: sin WHATSAPP_CUENTA_SECRETO no se firma con la clave del puente: solo los dueños, y a los demás un 503 claro', async () => {
  const p = await puente();
  try {
    await con(
      p.url,
      async () => {
        assert.equal(W.claveCuentaWhatsapp(ANA), '', 'sin secreto, sin clave (nunca la del puente)');
        assert.equal(W.claveCuentaWhatsapp(JOSE), 'legado');
        const { como, cerrar } = await app();
        try {
          for (const [ruta, metodo] of [
            ['/api/whatsapp/vincular', 'POST'],
            ['/api/whatsapp/chats', 'GET'],
            ['/api/whatsapp/foto?chat=x', 'GET'],
          ] as const) {
            const r = await como(ANA, ruta, { metodo, cuerpo: metodo === 'POST' ? {} : undefined, comunidad: true });
            assert.equal(r.status, 503, ruta);
            const j = await r.json();
            assert.equal(j.code, 'whatsapp_para_todos_sin_configurar');
            assert.match(j.error, /WhatsApp para todos no está configurado/);
          }
          const e = await (await como(ANA, '/api/whatsapp/estado', { comunidad: true })).json();
          assert.equal(e.vinculado, false);
          assert.match(e.error, /WhatsApp para todos no está configurado/);
          assert.ok(!p.pedidos.some((x) => x.cuenta !== 'legado'), 'ningún pedido de otra cuenta llegó al puente');
          assert.match(await W.correrWhatsapp(ANA, 'revisar'), /WhatsApp para todos no está configurado/);
          // José, como siempre.
          assert.equal((await como(JOSE, '/api/whatsapp/chats')).status, 200);
          assert.equal(await W.whatsappOfrecido(JOSE), true);
        } finally {
          await cerrar();
        }
      },
      { secreto: null }
    );
    // Uno corto (se podría adivinar desde los nombres de carpeta del puente) vale lo mismo que ninguno.
    await con(
      p.url,
      async () => {
        assert.equal(W.whatsappParaTodosConfigurado(), false);
        assert.equal(W.claveCuentaWhatsapp(ANA), '', 'con un secreto corto, sin clave');
        assert.equal(W.claveCuentaWhatsapp(JOSE), 'legado');
        const { como, cerrar } = await app();
        try {
          const r = await como(ANA, '/api/whatsapp/chats', { comunidad: true });
          assert.equal(r.status, 503);
          assert.equal((await r.json()).code, 'whatsapp_para_todos_sin_configurar');
        } finally {
          await cerrar();
        }
      },
      { secreto: 'corto-de-23-caracteres!' }
    );
    await con(p.url, async () => assert.equal(W.whatsappParaTodosConfigurado(), true), { secreto: 'x'.repeat(24) });
  } finally {
    await p.cerrar();
  }
});

test('MENOR: cerrado por omisión: sin WHATSAPP_ABIERTO=1 (sin fijarla, vacía, 0 u otra cosa) solo los dueños', async () => {
  const p = await puente();
  try {
    for (const abierto of [null, '', '0', 'no', 'abierto']) {
      await con(
        p.url,
        async () => {
          assert.equal(W.whatsappAbierto(), false, String(abierto));
          assert.equal(await W.whatsappPermitido(ANA, { comunidad: true }), false, `comunidad con ${abierto}`);
          assert.equal(await W.whatsappPermitido(RAMIRO), false, `junta con ${abierto}`);
          assert.equal(await W.whatsappPermitido(JOSE), true, 'los dueños siempre');
          const { como, cerrar } = await app();
          try {
            const e = await (await como(ANA, '/api/whatsapp/estado', { comunidad: true })).json();
            assert.equal(e.permitido, false);
            const v = await como(ANA, '/api/whatsapp/vincular', { metodo: 'POST', cuerpo: {}, comunidad: true });
            assert.equal(v.status, 403);
            assert.equal((await v.json()).code, 'whatsapp_no_permitido');
            assert.equal((await como(JOSE, '/api/whatsapp/chats')).status, 200);
            assert.ok(!p.pedidos.some((x) => x.cuenta !== 'legado'), 'ningún pedido de otra cuenta llegó al puente');
          } finally {
            await cerrar();
          }
        },
        { abierto }
      );
    }
    // Abierto de verdad: con 1 (o sí / true).
    for (const abierto of ['1', 'sí', 'TRUE']) {
      await con(p.url, async () => assert.equal(await W.whatsappPermitido(ANA, { comunidad: true }), true, abierto), { abierto });
    }
  } finally {
    await p.cerrar();
  }
});

test('MENOR: fotos y archivos sin caché compartida (private, no-store); lo que no es imagen, audio o video va como adjunto', async () => {
  const p = await puente();
  try {
    await con(p.url, async () => {
      const { como, cerrar } = await app();
      try {
        const img = await como(JOSE, '/api/whatsapp/media?chat=c&id=foto');
        assert.equal(img.status, 200);
        assert.equal(img.headers.get('cache-control'), 'private, no-store');
        assert.equal(img.headers.get('content-disposition'), null, 'una imagen se muestra');
        assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(await img.text(), 'JPG-secreto');
        const pdf = await como(JOSE, '/api/whatsapp/media?chat=c&id=pdf');
        assert.equal(pdf.headers.get('content-type'), 'application/pdf');
        assert.equal(pdf.headers.get('content-disposition'), 'attachment');
        assert.equal(pdf.headers.get('cache-control'), 'private, no-store');
        const foto = await como(JOSE, '/api/whatsapp/foto?chat=50499990000@s.whatsapp.net');
        assert.equal(foto.status, 200);
        assert.equal(foto.headers.get('cache-control'), 'private, no-store');
      } finally {
        await cerrar();
      }
    });
  } finally {
    await p.cerrar();
  }
});

test('6-oct: el turno no espera a la base de cuentas: lo sabido vale ya (y se refresca por detrás); mandar sigue esperando a la base', async () => {
  const p = await puente();
  try {
    await con(p.url, async () => {
      let consultas = 0;
      let suspendidas = new Set<string>();
      // Una base lenta, como la de Render en frío (hasta 721 ms de «preparado» el 6-oct).
      W._suspensionWhatsappDePrueba(async (c) => {
        consultas++;
        await new Promise((r) => setTimeout(r, 600));
        return suspendidas.has(c);
      });
      try {
        // Sin nada sabido: a lo más el tope (250 ms) y, sin respuesta, como si no se pudiera saber (los dueños sí).
        let t0 = Date.now();
        assert.equal(await W.whatsappPermitidoTurno(JOSE), true);
        assert.ok(Date.now() - t0 < 450, `esperó ${Date.now() - t0} ms`);
        t0 = Date.now();
        assert.equal(await W.whatsappPermitidoTurno(ANA, { comunidad: true }), false, 'sin saber, la comunidad no pasa');
        assert.ok(Date.now() - t0 < 450);
        // La consulta siguió por detrás y quedó sabida: el turno siguiente no espera nada.
        await new Promise((r) => setTimeout(r, 700));
        t0 = Date.now();
        assert.equal(await W.whatsappPermitidoTurno(ANA, { comunidad: true }), true);
        assert.ok(Date.now() - t0 < 50, `con lo sabido esperó ${Date.now() - t0} ms`);
        // Varias preguntas a la vez del mismo turno: una sola consulta a la base.
        W._suspensionWhatsappDePrueba(async (c) => {
          consultas++;
          await new Promise((r) => setTimeout(r, 100));
          return suspendidas.has(c);
        });
        consultas = 0;
        await Promise.all([W.whatsappPermitidoTurno(BETO, { comunidad: true }, 1000), W.whatsappPermitidoTurno(BETO, { comunidad: true }, 1000), W.whatsappOfrecido(BETO, 400, { comunidad: true })]);
        assert.equal(consultas, 1);
        // Mandar no usa esto: whatsappPermitido espera a la base si lo sabido tiene más de 30 s (la suspensión manda).
        suspendidas = new Set([BETO]);
        W._suspensionWhatsappDePrueba(async (c) => suspendidas.has(c));
        assert.equal(await W.whatsappPermitido(BETO, { comunidad: true }), false);
        // Bloqueante 3 (revisión del 6-oct): un permiso sabido NO sobrevive a una consulta fallida, ni a los 2 min.
        suspendidas = new Set();
        W._suspensionWhatsappDePrueba(async (c) => suspendidas.has(c));
        assert.equal(await W.whatsappPermitidoTurno(ANA, { comunidad: true }, 1000), true, 'sabido y fresco: pasa');
        W._envejecerSuspensionWhatsapp(60_000);
        let falla = true;
        W._suspensionWhatsappDePrueba(async () => {
          if (falla) throw new Error('base caída');
          return false;
        });
        // _suspensionWhatsappDePrueba borra lo sabido: se vuelve a sembrar «no suspendida» y luego falla la base.
        falla = false;
        assert.equal(await W.whatsappPermitidoTurno(ANA, { comunidad: true }, 1000), true);
        falla = true;
        W._envejecerSuspensionWhatsapp(31_000);
        assert.equal(await W.whatsappPermitidoTurno(ANA, { comunidad: true }, 1000), false, 'tras un fallo, la comunidad no pasa');
        assert.equal(await W.whatsappPermitidoTurno(ANA, { comunidad: true }, 1000), false, 'ni en el turno siguiente');
        assert.equal(await W.whatsappPermitidoTurno(JOSE, {}, 1000), true, 'el dueño sigue (por configuración)');
        // Más de 2 min sin consulta que conteste: no vale lo viejo.
        falla = false;
        assert.equal(await W.whatsappPermitidoTurno(ANA, { comunidad: true }, 1000), true);
        falla = true;
        W._envejecerSuspensionWhatsapp(130_000);
        assert.equal(await W.whatsappPermitidoTurno(ANA, { comunidad: true }, 1000), false, 'lo sabido de hace más de 2 min no vale');
      } finally {
        W._suspensionWhatsappDePrueba(null);
      }
    });
  } finally {
    await p.cerrar();
  }
});
