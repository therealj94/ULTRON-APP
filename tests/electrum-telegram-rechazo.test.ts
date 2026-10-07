/**
 * Quien no está en el padrón recibe una respuesta amable (una vez por día) y quien manda se entera.
 * Antes el bot callaba y desde una cuenta nueva parecía caído.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import { avisarRechazo } from '../server/electrum/telegram';
import { reiniciarPadron } from '../lib/acceso';

test('rechazo: responde al desconocido una vez por día y avisa a quien manda', async (t) => {
  const antes = { ...process.env };
  process.env.ELECTRUM_BOT_TOKEN = 'token-de-prueba';
  process.env.TELEGRAM_JOSE_USER_ID = '111';
  process.env.TELEGRAM_RAMIRO_USER_ID = '222';
  reiniciarPadron();
  const enviados: Array<{ chat: string; text: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    assert.match(String(url), /api\.telegram\.org\/bottoken-de-prueba\/sendMessage/);
    const b = JSON.parse(init.body);
    enviados.push({ chat: String(b.chat_id), text: b.text });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
    for (const k of ['ELECTRUM_BOT_TOKEN', 'TELEGRAM_JOSE_USER_ID', 'TELEGRAM_RAMIRO_USER_ID']) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
    reiniciarPadron();
  });

  const ahora = 1_790_600_000_000;
  const r = await avisarRechazo('555', '555', 'Keidy', ahora);
  assert.deepEqual(r, { respondido: true, avisados: 2 });
  const alDesconocido = enviados.find((e) => e.chat === '555')!;
  assert.match(alDesconocido.text, /pedíselo a José/);
  assert.match(alDesconocido.text, /555/);
  const aJose = enviados.find((e) => e.chat === '111')!;
  assert.match(aJose.text, /«Keidy» \(Telegram 555\)/);
  assert.ok(enviados.some((e) => e.chat === '222'), 'Ramiro también manda');

  // El mismo día, nada más: ni al desconocido ni a José.
  enviados.length = 0;
  assert.deepEqual(await avisarRechazo('555', '555', 'Keidy', ahora + 3_600_000), { respondido: false, avisados: 0 });
  assert.equal(enviados.length, 0);

  // En un grupo no se le contesta al grupo, pero José se entera.
  const g = await avisarRechazo('-100999', '777', 'Alguien', ahora);
  assert.equal(g.respondido, false);
  assert.ok(!enviados.some((e) => e.chat === '-100999'));
  assert.match(enviados.find((e) => e.chat === '111')!.text, /en un grupo \(-100999\)/);

  // Si después abre el chat privado, igual se le contesta (lo del grupo no gastó la respuesta);
  // a José no se le repite el aviso.
  enviados.length = 0;
  const p = await avisarRechazo('777', '777', 'Alguien', ahora + 60_000);
  assert.deepEqual(p, { respondido: true, avisados: 0 });
  assert.ok(enviados.some((e) => e.chat === '777'));
  assert.ok(!enviados.some((e) => e.chat === '111'));
});
