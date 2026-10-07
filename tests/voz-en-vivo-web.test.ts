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
  assert.equal(porQueNoAbre(401, null), 'Entra de nuevo para hablar en vivo.');
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
  assert.match(estados.at(-1)!, /Permite el micrófono/);
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

/*
 * A4 (auditoría del 4-oct, paquete P2): una desconexión NATURAL (la cortó el otro lado) dejaba la conversación
 * en «cerrada» pero sin invalidar sus callbacks: un `onModeChange({mode:'speaking'})` tardío la devolvía a
 * «hablando» y un `onMessage` tardío agregaba texto. Ahora toda terminación (desconexión natural, colgar, error,
 * plazo vencido) es UNA sola: invalida la generación, los callbacks y los plazos. Una sesión NUEVA sí funciona.
 */
type SesionFalsaA4 = { endSession: () => void; setMicMuted?: (m: boolean) => void; setVolume?: (o: { volume: number }) => void };
function armarA4(o: { sinMute?: boolean; sinVolumen?: boolean } = {}) {
  const pedidos: { ruta: string; cuerpo: any }[] = [];
  const estados: string[] = [];
  const mensajes: string[] = [];
  const avisos: Array<{ silenciable: boolean; silenciado: boolean }> = [];
  const sdks: OpcionesSesion[] = [];
  const sesiones: Array<{ fin: number; mic: boolean[]; volumen: number[] }> = [];
  let n = 0;
  const c = new ConversacionEnVivo({
    pedir: async (ruta, cuerpo: any) => {
      pedidos.push({ ruta, cuerpo });
      if (ruta.endsWith('/cerrar')) return { ok: true, status: 200, json: { ok: true } };
      n += 1;
      return { ok: true, status: 200, json: { token: `tok-${n}`, pase: `pase-${n}` } };
    },
    abrirSesion: async (x) => {
      sdks.push(x);
      const r = { fin: 0, mic: [] as boolean[], volumen: [] as number[] };
      sesiones.push(r);
      const s: SesionFalsaA4 = { endSession: () => void r.fin++ };
      if (!o.sinMute) s.setMicMuted = (m) => void r.mic.push(m);
      if (!o.sinVolumen) s.setVolume = ({ volume }) => void r.volumen.push(volume);
      return s;
    },
    onEstado: (e, d) => estados.push(d ? `${e}:${d}` : e),
    onMensaje: (q, t) => mensajes.push(`${q}:${t}`),
    onControles: (x) => avisos.push(x),
  });
  const cierres = () => pedidos.filter((p) => p.ruta.endsWith('/cerrar')).map((p) => p.cuerpo.pase);
  return { c, estados, mensajes, avisos, sdks, sesiones, cierres };
}

/** Todos los callbacks que el SDK de una sesión vieja puede seguir disparando. */
function inyectarViejos(s: OpcionesSesion) {
  s.onModeChange!({ mode: 'speaking' });
  s.onMessage!({ source: 'ai', message: 'tarde de la IA' });
  s.onMessage!({ source: 'user', message: 'tarde de la persona' });
  s.onConnect!();
  s.onModeChange!({ mode: 'listening' });
  s.onError!('tarde: error');
  s.onDisconnect!();
}

const TERMINAR_A4: Record<string, (a: ReturnType<typeof armarA4>) => void> = {
  'desconexión natural': (a) => a.sdks.at(-1)!.onDisconnect!(),
  'colgar (cerrar)': (a) => a.c.cerrar(),
  error: (a) => a.sdks.at(-1)!.onError!('ice failed'),
};

for (const [como, terminar] of Object.entries(TERMINAR_A4)) {
  test(`A4 web: tras ${como}, ningún callback viejo toca estado, mensajes ni audio; la sesión nueva sí funciona`, async () => {
    const a = armarA4();
    assert.equal(await a.c.abrir({ avatar: 'aura', idioma: 'es' }), true);
    const viejo = a.sdks[0];
    viejo.onConnect!();
    viejo.onModeChange!({ mode: 'speaking' });
    viejo.onMessage!({ source: 'ai', message: 'antes' });
    terminar(a);
    const final = a.c.estado();
    assert.ok(final === 'cerrada' || final === 'error', `terminal: ${final}`);
    assert.equal(a.c.ocupada(), false);
    const estadosAntes = a.estados.length;
    const mensajesAntes = a.mensajes.length;
    inyectarViejos(viejo);
    assert.equal(a.c.estado(), final, 'ningún callback viejo cambia el estado (ni lo devuelve a «hablando»)');
    assert.deepEqual(a.estados.slice(estadosAntes), [], 'ningún estado nuevo de la sesión terminada');
    assert.deepEqual(a.mensajes.slice(mensajesAntes), [], 'ningún mensaje de la sesión terminada');
    // Audio: nada de la sesión terminada se puede silenciar ni callar (no hay sesión), y su SDK no se toca.
    assert.equal(a.c.silenciarMic(true).ok, false);
    assert.equal(a.c.callarSalida().ok, true, 'sin llamada no hay nada que suene: callar es inofensivo');
    assert.deepEqual([a.sesiones[0].mic, a.sesiones[0].volumen], [[], []], 'el SDK de la sesión terminada no se toca');
    assert.ok(a.sesiones[0].fin <= 1, 'la sesión se cuelga a lo sumo una vez');
    assert.deepEqual(a.cierres(), ['pase-1'], 'el pase se suelta una sola vez');

    // Una sesión NUEVA: sus callbacks sí cuentan, y los de la vieja siguen sin contar con la nueva abierta.
    assert.equal(await a.c.abrir({ avatar: 'aura', idioma: 'es' }), true);
    const nuevo = a.sdks[1];
    nuevo.onConnect!();
    assert.equal(a.c.estado(), 'escuchando');
    inyectarViejos(viejo);
    assert.equal(a.c.estado(), 'escuchando', 'lo viejo no toca la sesión nueva');
    nuevo.onModeChange!({ mode: 'speaking' });
    nuevo.onMessage!({ source: 'ai', message: 'nueva' });
    assert.equal(a.c.estado(), 'hablando');
    assert.deepEqual(a.mensajes.slice(mensajesAntes), ['aura:nueva']);
    assert.equal(a.sesiones[1].fin, 0, 'la nueva sigue abierta');
    a.c.cerrar();
  });
}

test('A4 web: un plazo vencido también es la misma terminación (sus callbacks tardíos no reviven nada)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = armarLento();
  const abre = a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.permisos[0].resolver(a.permisoOk('p'));
  await vueltas();
  a.sesiones[0].resolver(a.sesionFalsa());
  await vueltas();
  await abre;
  t.mock.timers.tick(CONECTAR_MAX_MS);
  assert.equal(a.c.estado(), 'error');
  const antes = a.estados.length;
  a.opciones[0].onModeChange!({ mode: 'speaking' });
  a.opciones[0].onConnect!();
  a.opciones[0].onDisconnect!();
  assert.equal(a.c.estado(), 'error');
  assert.deepEqual(a.estados.slice(antes), []);
  assert.deepEqual(a.cierres(), ['p']);
});

test('A4 web: desconexión natural reproduciendo deja cero recursos propios y nada anunciado', async () => {
  const a = armarA4();
  await a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.sdks[0].onConnect!();
  a.sdks[0].onModeChange!({ mode: 'speaking' });
  assert.equal(a.c.callarSalida().ok, true);
  assert.deepEqual(a.sesiones[0].volumen, [0], 'reproduciendo: la salida de la llamada se calla');
  a.sdks[0].onDisconnect!();
  assert.equal(a.c.estado(), 'cerrada');
  assert.equal(a.sesiones[0].fin, 1, 'la sesión se da por terminada también de nuestro lado (endSession es idempotente en el SDK)');
  assert.equal(a.c.micSilenciado(), false);
  assert.equal(a.c.puedeSilenciar(), false, 'sin sesión no se anuncia silenciar');
  assert.deepEqual(a.avisos.at(-1), { silenciable: false, silenciado: false });
});

/* ── controles de la llamada: silenciar sin colgar, volver a escuchar y callar la salida ────────── */

test('silenciar el micrófono de la llamada no cuelga; volver a escuchar sí deja pasar lo que se dice', async () => {
  const a = armarA4();
  await a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.sdks[0].onConnect!();
  assert.equal(a.c.puedeSilenciar(), true, 'el SDK de la web sabe silenciar: se anuncia');
  assert.deepEqual(a.avisos.at(-1), { silenciable: true, silenciado: false });
  assert.deepEqual(a.c.silenciarMic(true), { ok: true });
  assert.deepEqual(a.sesiones[0].mic, [true]);
  assert.equal(a.c.micSilenciado(), true);
  assert.deepEqual(a.avisos.at(-1), { silenciable: true, silenciado: true }, 'la interfaz se entera');
  assert.equal(a.c.estado(), 'escuchando', 'silenciar no cuelga ni cambia el estado de la llamada');
  assert.equal(a.sesiones[0].fin, 0);
  assert.deepEqual(a.cierres(), []);
  assert.equal(a.c.silenciarMic(true).ok, false, 'ya estaba silenciado: no es un «listo» de más');
  assert.deepEqual(a.c.silenciarMic(false), { ok: true });
  assert.deepEqual(a.sesiones[0].mic, [true, false]);
  a.sdks[0].onMessage!({ source: 'user', message: 'ya me oyes' });
  assert.deepEqual(a.mensajes, ['persona:ya me oyes'], 'vuelve a escuchar en la misma sesión');
  assert.deepEqual(a.avisos.at(-1), { silenciable: true, silenciado: false });
  // Colgar con el micrófono silenciado: la próxima sesión empieza escuchando.
  a.c.silenciarMic(true);
  a.c.cerrar();
  assert.equal(a.c.micSilenciado(), false);
  assert.deepEqual(a.avisos.at(-1), { silenciable: false, silenciado: false });
  await a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.sdks[1].onConnect!();
  assert.equal(a.c.micSilenciado(), false);
  assert.deepEqual(a.sesiones[1].mic, []);
});

test('si el SDK no sabe silenciar, no se anuncia ni se finge', async () => {
  const a = armarA4({ sinMute: true });
  await a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.sdks[0].onConnect!();
  assert.equal(a.c.puedeSilenciar(), false);
  assert.ok(!a.avisos.some((x) => x.silenciable), 'nunca se anunció');
  const r = a.c.silenciarMic(true);
  assert.equal(r.ok, false);
  assert.match(r.detalle!, /micr/i);
  assert.equal(a.c.estado(), 'escuchando');
});

test('callar la salida de la llamada: calla lo que suena, no cuelga, y la primera frase siguiente se oye', async () => {
  const a = armarA4();
  await a.c.abrir({ avatar: 'aura', idioma: 'es' });
  const s = a.sdks[0];
  s.onConnect!();
  // Escuchando: no suena nada de la llamada, no hay nada que callar (no se baja el volumen de lo que venga).
  assert.deepEqual(a.c.callarSalida(), { ok: true });
  assert.deepEqual(a.sesiones[0].volumen, []);
  s.onModeChange!({ mode: 'speaking' });
  assert.deepEqual(a.c.callarSalida(), { ok: true });
  assert.deepEqual(a.sesiones[0].volumen, [0], 'lo que suena se calla');
  assert.equal(a.c.estado(), 'hablando');
  assert.equal(a.sesiones[0].fin, 0, 'callar no cuelga');
  // Terminó (o la interrumpieron): el volumen vuelve, así la próxima frase se oye.
  s.onModeChange!({ mode: 'listening' });
  assert.deepEqual(a.sesiones[0].volumen, [0, 1]);
  s.onModeChange!({ mode: 'speaking' });
  s.onMessage!({ source: 'ai', message: 'primera frase siguiente' });
  assert.deepEqual(a.sesiones[0].volumen, [0, 1], 'la frase siguiente suena con volumen');
  assert.deepEqual(a.mensajes, ['aura:primera frase siguiente']);
});

test('sin poder bajar la salida de la llamada, callar lo dice (no finge haber callado la llamada)', async () => {
  const a = armarA4({ sinVolumen: true });
  await a.c.abrir({ avatar: 'aura', idioma: 'es' });
  a.sdks[0].onConnect!();
  a.sdks[0].onModeChange!({ mode: 'speaking' });
  const r = a.c.callarSalida();
  assert.equal(r.ok, false);
  assert.equal(a.c.estado(), 'hablando');
});

test('un solo dueño del micrófono: abrir dos veces seguidas abre UNA sesión; reabrir tras un error que vuelve a fallar no deja nada', async () => {
  const a = armarA4();
  const [x, y] = await Promise.all([a.c.abrir({ avatar: 'aura', idioma: 'es' }), a.c.abrir({ avatar: 'aura', idioma: 'es' })]);
  assert.deepEqual([x, y], [true, true]);
  assert.equal(a.sdks.length, 1, 'una sola sesión del SDK');
  a.sdks[0].onConnect!();
  a.sdks[0].onError!('se cayó');
  assert.equal(a.sesiones[0].fin, 1);
  // Reconexión que vuelve a fallar (el navegador ya no da el micrófono), con un onError antes del throw.
  const rutas: string[] = [];
  const c2 = new ConversacionEnVivo({
    pedir: async (ruta) => (rutas.push(ruta), ruta.endsWith('/cerrar') ? { ok: true, status: 200, json: {} } : { ok: true, status: 200, json: { token: 't', pase: 'p' } }),
    abrirSesion: async (o) => {
      o.onError!('Permission denied');
      throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    },
    onEstado: () => undefined,
    onMensaje: () => undefined,
  });
  assert.equal(await c2.abrir({ avatar: 'aura', idioma: 'es' }), false);
  assert.equal(c2.estado(), 'error');
  assert.equal(c2.ocupada(), false);
  assert.equal(c2.puedeSilenciar(), false);
  assert.deepEqual(rutas, ['/api/voz/agente', '/api/voz/agente/cerrar'], 'permiso y un solo cierre del pase');
});
