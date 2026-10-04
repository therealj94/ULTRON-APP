/** La conversación en vivo de la web (src/03-voz/enVivo.ts), con un SDK y un servidor falsos. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ABRIR_MAX_MS, CONECTAR_MAX_MS, ConversacionEnVivo, PERMISO_MAX_MS, porQueNoAbre, type OpcionesSesion } from '../src/03-voz/enVivo';

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

test('un error con la sesión abierta la cuelga ya: la mesa vuelve a su micrófono sin dos abiertos', async () => {
  const a = armar();
  await a.c.abrir({ avatar: 'aura', idioma: 'es' });
  const viejo = a.sdk();
  viejo.onConnect!();
  viejo.onError!('ice failed');
  assert.equal(a.c.estado(), 'error');
  assert.equal(a.terminadas(), 1, 'la sesión del error se cuelga');
  assert.equal(a.pedidos.filter((p) => p.ruta.endsWith('/cerrar')).length, 1);
  viejo.onDisconnect!();
  viejo.onMessage!({ source: 'ai', message: 'tarde' });
  assert.equal(a.c.estado(), 'error', 'lo que llega tarde de la vieja no cambia nada');
  assert.deepEqual(a.mensajes, []);
  // Reabrir tras el error: una sola sesión viva.
  assert.equal(await a.c.abrir({ avatar: 'aura', idioma: 'es' }), true);
  assert.equal(a.terminadas(), 1);
});

test('un error mientras conecta (antes de tener la sesión) también la cuelga', async () => {
  let terminadas = 0;
  const c = new ConversacionEnVivo({
    pedir: async () => ({ ok: true, status: 200, json: { token: 't', pase: 'p' } }),
    abrirSesion: async (o) => {
      o.onError!('se cayó');
      return { endSession: () => void terminadas++ };
    },
    onEstado: () => {},
    onMensaje: () => {},
  });
  assert.equal(await c.abrir({ avatar: 'aura', idioma: 'es' }), false);
  assert.equal(terminadas, 1);
  assert.equal(c.estado(), 'error');
});

/*
 * CALL02 (auditoría del 3-oct): el inicio podía quedarse en «conectando» para siempre (un permiso que no
 * vuelve, un WebRTC que no termina). Ahora cada fase tiene su plazo y hay un tope total, con reloj de
 * mentira; lo que llegue tarde de una apertura vencida se cuelga y su pase se suelta.
 */
type Pendiente<T> = { promesa: Promise<T>; resolver: (v: T) => void };
function pendiente<T>(): Pendiente<T> {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => (resolver = r));
  return { promesa, resolver };
}
const vueltas = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function armarLento() {
  const pedidos: { ruta: string; cuerpo: any }[] = [];
  const estados: string[] = [];
  const permisos: Pendiente<{ ok: boolean; status: number; json: any }>[] = [];
  const sesiones: Pendiente<{ endSession: () => void }>[] = [];
  const opciones: OpcionesSesion[] = [];
  let terminadas = 0;
  const c = new ConversacionEnVivo({
    pedir: (ruta, cuerpo) => {
      pedidos.push({ ruta, cuerpo });
      if (ruta.endsWith('/cerrar')) return Promise.resolve({ ok: true, status: 200, json: { ok: true } });
      const p = pendiente<{ ok: boolean; status: number; json: any }>();
      permisos.push(p);
      return p.promesa;
    },
    abrirSesion: (o) => {
      opciones.push(o);
      const p = pendiente<{ endSession: () => void }>();
      sesiones.push(p);
      return p.promesa;
    },
    onEstado: (e, d) => estados.push(d ? `${e}:${d}` : e),
    onMensaje: () => {},
  });
  const sesionFalsa = () => ({ endSession: () => void terminadas++ });
  const permisoOk = (pase: string) => ({ ok: true, status: 200, json: { token: 'tok', pase } });
  const cierres = () => pedidos.filter((p) => p.ruta.endsWith('/cerrar')).map((p) => p.cuerpo.pase);
  return { c, pedidos, estados, permisos, sesiones, opciones, sesionFalsa, permisoOk, terminadas: () => terminadas, cierres };
}

test('CALL02 web: permiso tardío pero válido (dentro de su plazo) abre normal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = armarLento();
  const abre = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  t.mock.timers.tick(PERMISO_MAX_MS - 1_000);
  a.permisos[0].resolver(a.permisoOk('p1'));
  await vueltas();
  a.sesiones[0].resolver(a.sesionFalsa());
  await vueltas();
  a.opciones[0].onConnect!();
  assert.equal(await abre, true);
  t.mock.timers.tick(ABRIR_MAX_MS * 2);
  assert.equal(a.c.estado(), 'escuchando', 'conectada: ningún plazo la tumba después');
  assert.deepEqual(a.estados, ['conectando', 'escuchando']);
});

test('CALL02 web: el permiso no vuelve nunca → error recuperable a los PERMISO_MAX_MS; si llega tarde, su pase se suelta', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = armarLento();
  const abre = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  t.mock.timers.tick(PERMISO_MAX_MS - 1);
  assert.equal(a.c.estado(), 'conectando');
  t.mock.timers.tick(1);
  assert.equal(await abre, false, 'abrir() termina: no se queda esperando para siempre');
  assert.equal(a.c.estado(), 'error');
  assert.match(a.estados.at(-1)!, /micrófono de siempre/);
  // Llega tarde: no abre nada y el servidor se entera de que ese pase ya no es de nadie.
  a.permisos[0].resolver(a.permisoOk('tarde'));
  await vueltas();
  assert.equal(a.opciones.length, 0, 'no se abre una sesión con un permiso vencido');
  assert.deepEqual(a.cierres(), ['tarde']);
  assert.equal(a.c.estado(), 'error');
  // Y se puede volver a intentar.
  const otra = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.permisos[1].resolver(a.permisoOk('p2'));
  await vueltas();
  a.sesiones[0].resolver(a.sesionFalsa());
  await vueltas();
  a.opciones[0].onConnect!();
  assert.equal(await otra, true);
});

test('CALL02 web: red lenta dentro del plazo de conectar abre; conexión colgada → error, se cuelga y suelta el pase', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = armarLento();
  let abre = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.permisos[0].resolver(a.permisoOk('lenta'));
  await vueltas();
  t.mock.timers.tick(CONECTAR_MAX_MS - 100);
  a.sesiones[0].resolver(a.sesionFalsa());
  await vueltas();
  a.opciones[0].onConnect!();
  assert.equal(await abre, true);
  assert.equal(a.c.estado(), 'escuchando');
  a.c.cerrar();
  // Colgada: startSession no termina nunca.
  abre = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.permisos[1].resolver(a.permisoOk('colgada'));
  await vueltas();
  t.mock.timers.tick(CONECTAR_MAX_MS);
  assert.equal(await abre, false);
  assert.equal(a.c.estado(), 'error');
  assert.ok(a.cierres().includes('colgada'), 'el pase de la conexión colgada se suelta');
  // La sesión aparece tarde: se cuelga en el acto y no toca el estado.
  const antes = a.terminadas();
  a.sesiones[1].resolver(a.sesionFalsa());
  await vueltas();
  assert.equal(a.terminadas(), antes + 1, 'la sesión tardía se cuelga');
  a.opciones[1].onConnect!();
  assert.equal(a.c.estado(), 'error', 'su onConnect tardío no la revive');
});

test('CALL02 web: la sesión se crea pero onConnect no llega → también vence, sin quedar abierta', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = armarLento();
  const abre = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.permisos[0].resolver(a.permisoOk('p'));
  await vueltas();
  a.sesiones[0].resolver(a.sesionFalsa());
  await vueltas();
  await abre;
  assert.equal(a.c.estado(), 'conectando');
  t.mock.timers.tick(CONECTAR_MAX_MS);
  assert.equal(a.c.estado(), 'error');
  assert.equal(a.terminadas(), 1, 'la sesión a medio conectar se cuelga');
  assert.deepEqual(a.cierres(), ['p']);
});

test('CALL02 web: tope total: un permiso al límite no regala otro plazo entero para conectar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = armarLento();
  const abre = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  t.mock.timers.tick(PERMISO_MAX_MS - 100);
  a.permisos[0].resolver(a.permisoOk('p'));
  await vueltas();
  t.mock.timers.tick(ABRIR_MAX_MS - (PERMISO_MAX_MS - 100) - 1);
  assert.equal(a.c.estado(), 'conectando');
  t.mock.timers.tick(1);
  assert.equal(await abre, false);
  assert.equal(a.c.estado(), 'error');
});

test('CALL02 web: colgar mientras espera el permiso cancela; lo que llegue después no abre nada y el pase se suelta', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = armarLento();
  const abre = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.c.cerrar();
  assert.equal(await abre, false);
  a.permisos[0].resolver(a.permisoOk('cancelado'));
  await vueltas();
  assert.equal(a.opciones.length, 0);
  assert.deepEqual(a.cierres(), ['cancelado']);
  t.mock.timers.tick(ABRIR_MAX_MS * 2);
  assert.deepEqual(a.estados, ['conectando', 'cerrada'], 'ningún plazo vencido después de colgar');
});
