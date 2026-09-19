import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textoAPdf } from '../lib/pdf';
import { despacharTaller, parsePedido } from '../lib/taller';
import { agregarTarea, listarTareas, marcarTarea } from '../lib/tareas';
import { catalogoCanales } from '../lib/sistema';

describe('Taller ULTRON', () => {
  it('parsea pedidos de sistema, envío y pendientes', () => {
    assert.equal(parsePedido('cómo está el sistema').accion, 'sistema');
    assert.equal(parsePedido('mantenimiento').accion, 'mantenimiento');
    assert.equal(parsePedido('anota que mañana hay junta').accion, 'tarea');
    assert.equal(parsePedido('pendientes').accion, 'listar');
    assert.equal(parsePedido('envía por telegram el resumen').canal, 'telegram');
    assert.equal(parsePedido('mándame un pdf por whatsapp').canal, 'whatsapp');
    assert.equal(parsePedido('llámame y dime hola').accion, 'llamar');
    assert.equal(parsePedido('hola jefe').accion, null);
  });

  it('genera un PDF que empieza por %PDF', () => {
    const buf = textoAPdf({ titulo: 'Junta', cuerpo: 'Precio del oro pendiente.\nCafé vs cafe.' });
    assert.ok(buf.slice(0, 5).toString() === '%PDF-');
    assert.ok(buf.length > 400);
  });

  it('anota y cierra una tarea', () => {
    const t = agregarTarea('prueba taller ' + Date.now());
    assert.ok(listarTareas().some((x) => x.id === t.id));
    const c = marcarTarea(t.id, true);
    assert.equal(c?.hecha, true);
  });

  it('no finge Telegram: decir admite la falta de clave', async () => {
    const prevT = process.env.TELEGRAM_BOT_TOKEN;
    const prevC = process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const r = await despacharTaller('envía por telegram hola jefe');
    assert.ok(r.tools.includes('telegram'));
    assert.match(r.decir || '', /Falta TELEGRAM/);
    if (prevT !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevT;
    if (prevC !== undefined) process.env.TELEGRAM_CHAT_ID = prevC;
  });

  it('el catálogo no marca Telegram listo sin token', () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const tg = catalogoCanales().find((c) => c.id === 'telegram');
    assert.equal(tg?.listo, false);
    if (prev !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev;
  });
});
