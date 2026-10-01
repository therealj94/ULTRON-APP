/** La conversación en vivo de la web (src/03-voz/enVivo.ts), con un SDK y un servidor falsos. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversacionEnVivo, porQueNoAbre, type OpcionesSesion } from '../src/03-voz/enVivo';

function armar(respuesta: { ok: boolean; status: number; json: any } = { ok: true, status: 200, json: { token: 'tok', pase: 'pase-1' } }) {
  const pedidos: { ruta: string; cuerpo: any }[] = [];
  const estados: string[] = [];
  const mensajes: string[] = [];
  let opciones: OpcionesSesion | null = null;
  let terminadas = 0;
  const c = new ConversacionEnVivo({
    pedir: async (ruta, cuerpo) => {
      pedidos.push({ ruta, cuerpo });
      return ruta.endsWith('/cerrar') ? { ok: true, status: 200, json: { ok: true } } : respuesta;
    },
    abrirSesion: async (o) => {
      opciones = o;
      return { endSession: () => void terminadas++ };
    },
    onEstado: (e, d) => estados.push(d ? `${e}:${d}` : e),
    onMensaje: (q, t) => mensajes.push(`${q}:${t}`),
  });
  return { c, pedidos, estados, mensajes, sdk: () => opciones!, terminadas: () => terminadas };
}

test('abre con el permiso del servidor: token por WebRTC y el pase como variable (nunca la llave)', async () => {
  const a = armar();
  assert.equal(await a.c.abrir({ avatar: 'aura', idioma: 'es' }), true);
  assert.deepEqual(a.pedidos[0], { ruta: '/api/voz/agente', cuerpo: { avatar: 'aura', idioma: 'es' } });
  assert.equal(a.sdk().conversationToken, 'tok');
  assert.equal(a.sdk().connectionType, 'webrtc');
  assert.deepEqual(a.sdk().dynamicVariables, { pase: 'pase-1' });
  a.sdk().onConnect!();
  a.sdk().onModeChange!({ mode: 'speaking' });
  a.sdk().onMessage!({ source: 'user', message: ' ¿cómo va el oro? ' });
  a.sdk().onMessage!({ source: 'ai', message: 'A tres mil.' });
  a.sdk().onModeChange!({ mode: 'listening' });
  assert.deepEqual(a.estados, ['conectando', 'escuchando', 'hablando', 'escuchando']);
  assert.deepEqual(a.mensajes, ['persona:¿cómo va el oro?', 'aura:A tres mil.']);
});

test('colgar termina la sesión, avisa al servidor una vez y lo que llegue tarde no cuenta', async () => {
  const a = armar();
  await a.c.abrir({ avatar: 'aura', idioma: 'es' });
  const viejo = a.sdk();
  a.c.cerrar();
  assert.equal(a.terminadas(), 1);
  assert.deepEqual(a.pedidos.at(-1), { ruta: '/api/voz/agente/cerrar', cuerpo: { pase: 'pase-1' } });
  viejo.onDisconnect!();
  viejo.onMessage!({ source: 'ai', message: 'tarde' });
  assert.equal(a.pedidos.filter((p) => p.ruta.endsWith('/cerrar')).length, 1, 'el cierre se avisa una sola vez');
  assert.deepEqual(a.mensajes, []);
  assert.equal(a.c.estado(), 'cerrada');
});

test('si se corta sola (onDisconnect), también se avisa el cierre', async () => {
  const a = armar();
  await a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.sdk().onDisconnect!();
  assert.equal(a.c.estado(), 'cerrada');
  assert.deepEqual(a.pedidos.at(-1), { ruta: '/api/voz/agente/cerrar', cuerpo: { pase: 'pase-1' } });
});

test('sin permiso del servidor no abre nada y dice por qué (el micrófono de siempre sigue)', async () => {
  const a = armar({ ok: false, status: 429, json: { codigo: 'TOPE_VOZ', error: 'Ya usaste tus minutos de voz de hoy.', honesto: true } });
  assert.equal(await a.c.abrir({ avatar: 'aura', idioma: 'es' }), false);
  assert.deepEqual(a.estados, ['conectando', 'error:Ya usaste tus minutos de voz de hoy.']);
  assert.equal(porQueNoAbre(401, null), 'Entrá de nuevo para hablar en vivo.');
  assert.match(porQueNoAbre(500, null), /micrófono de siempre/);
});

test('si el navegador niega el micrófono, lo dice y suelta el pase', async () => {
  const pedidos: string[] = [];
  const estados: string[] = [];
  const c = new ConversacionEnVivo({
    pedir: async (ruta) => {
      pedidos.push(ruta);
      return { ok: true, status: 200, json: { token: 't', pase: 'p' } };
    },
    abrirSesion: async () => {
      throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    },
    onEstado: (e, d) => estados.push(d ? `${e}:${d}` : e),
    onMensaje: () => {},
  });
  assert.equal(await c.abrir({ avatar: 'aura', idioma: 'es' }), false);
  assert.match(estados.at(-1)!, /Permití el micrófono/);
  assert.deepEqual(pedidos, ['/api/voz/agente', '/api/voz/agente/cerrar']);
});
