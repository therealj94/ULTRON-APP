/**
 * Lo que puede y no puede decidir el CUERPO de un turno que llega por HTTP (server/seguridad.ts).
 *
 * `/api/turno` está abierta sin sesión (la APK habla aunque su token muera). Por eso el cuerpo no puede
 * traer identidad: con `telegramUserId` de José, cualquiera hablaba con mando (redespliegue, ejecutor)
 * y leía su memoria privada. La identidad de Telegram solo la pone el webhook, dentro del servidor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cuerpoHttp, limitar } from '../server/seguridad';
import { quienVerificado } from '../lib/memoria';

test('el cuerpo HTTP pierde la identidad de Telegram, el canal y la sesión; lo demás queda igual', () => {
  const body = { message: 'redespliega la mesa', telegramUserId: '111', telegramChatId: '-100', canal: 'telegram', sesion: { nombre: 'José' }, historial: [1], usuario: 'José' };
  const limpio = cuerpoHttp(body);
  assert.deepEqual(limpio, { message: 'redespliega la mesa', historial: [1], usuario: 'José' });
  // Con el cuerpo limpio y sin sesión, nadie queda verificado (antes: el id 111 daba a José con mando).
  assert.equal(quienVerificado(limpio, null), null);
  // Entradas raras no rompen.
  assert.deepEqual(cuerpoHttp(null), {});
  assert.deepEqual(cuerpoHttp('texto'), {});
  assert.deepEqual(cuerpoHttp([1, 2]), {});
});

function correr(mw: ReturnType<typeof limitar>, path: string, ip = '9.9.9.9') {
  let codigo = 200;
  let paso = false;
  const req = { ip, path, socket: { remoteAddress: ip } } as any;
  const res = { status: (c: number) => ((codigo = c), res), json: () => res } as any;
  mw(req, res, () => {
    paso = true;
  });
  return paso ? 200 : codigo;
}

test('las rutas de voz comparten un cupo; sin grupo, cada ruta tiene el suyo', () => {
  const voz = limitar(3, 60_000, 'voz-test');
  const r = ['/api/tts', '/api/tts/stream', '/api/voz', '/api/tts'].map((p) => correr(voz, p, '1.1.1.1'));
  assert.deepEqual(r, [200, 200, 200, 429], 'la cuarta, por la ruta que sea, ya no pasa');
  const suelto = limitar(1);
  assert.equal(correr(suelto, '/api/a', '2.2.2.2'), 200);
  assert.equal(correr(suelto, '/api/b', '2.2.2.2'), 200, 'sin grupo, otra ruta es otro cupo');
  assert.equal(correr(suelto, '/api/a', '2.2.2.2'), 429);
});
