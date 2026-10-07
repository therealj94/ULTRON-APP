/**
 * REVISIÓN INDEPENDIENTE DE a000e04 (7-oct, «no publicable»), DE PUNTA A PUNTA: el server.ts de verdad contra un Bedrock
 * FALSO, un nodo falso y un puente de WhatsApp falso (tests/servidor-falso.ts). Frases, nombres y precios inventados.
 * Las piezas sueltas: tests/mesa-revision-g1g2.test.ts.
 *
 *  G1. La guarda de repetición no borra lo actualizado (el oro de 2.450 a 2.460 se dice, no «Eso ya te lo dije» ni una
 *      segunda vuelta), no toca un turno con acción para la app, y en el turno JSON nunca dice «ya te lo dije».
 *  G2. Un «¿me oyes?» mientras piensa no deja tardío al turno (contesta); un turno con un envío de WhatsApp en curso no
 *      se descarta al llegar otra frase (termina y lo dice); la frase cortada llega al modelo como parte del pedido nuevo
 *      (no «no lo contestes»), y una orden de cambio de avatar cortada no se retoma.
 *  M3. Un turno que contestó con una herramienta fallida (no va a la memoria, AUR07) no sale como «sin respuesta».
 *  MENOR. En el stream una frase repetida suelta no retiene el resto (lo nuevo sale a trozos, no todo al final).
 *
 * Con a000e04 falla cada prueba. Se corre con NODE_ENV=test y sin él (el servidor hijo lo hereda).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirTurno, esperarQue, levantarServidor, type RespuestaFalsa } from './servidor-falso';

const CORREO = 'jose.revision7oct@ordenglobal.org';
const alPuente: string[] = [];
let guion: (ultimo: string, body: any) => RespuestaFalsa = () => ({ texto: '[EMO: neutral] Va.' });
/** Lo que contesta el nodo al turno JSON (solo a los pedidos de esta prueba; lo demás, `{}`). */
let nodoJson: (ultimo: string) => string | null = () => null;
/** Si /mensajes del puente falla (para el turno con la herramienta fallida). */
let mensajesFallan = false;

const s = await levantarServidor({
  correo: CORREO,
  env: { AURA_SUSPENSIONES: 'ninguna' },
  contestar: (ultimo, _modelo, body) => {
    const r = guion(ultimo, body);
    if (process.env.DEPURAR_MESA) console.error('[bedrock falso]', JSON.stringify(ultimo.slice(-200)), '→', JSON.stringify(r).slice(0, 160));
    return r;
  },
  nodoJson: (cuerpo) => {
    const ultimo = String(cuerpo?.messages?.at(-1)?.content || '');
    return nodoJson(ultimo) ?? '{}';
  },
  puente: (u) => {
    if (u.pathname !== '/estado') alPuente.push(u.pathname);
    if (u.pathname === '/estado') return { status: 200, json: { vinculado: true, conectado: true, numero: '+50499990000', vinculando: false } };
    if (u.pathname === '/chats') return { status: 200, json: { chats: [{ jid: '50488887777@s.whatsapp.net', nombre: 'Marisol', grupo: false, noLeidos: 0, hora: Date.now() - 60_000, ultimo: 'hola', ultimoMio: false, numero: '+50488887777' }] } };
    if (u.pathname === '/contactos') return { status: 200, json: { contactos: [] } };
    if (u.pathname === '/mensajes') return mensajesFallan ? { status: 500, json: { error: 'falla de prueba' } } : { status: 200, json: { chat: { jid: '50488887777@s.whatsapp.net', nombre: 'Marisol' }, mensajes: [] } };
    return null;
  },
});
after(() => {
  if (process.env.DEPURAR_MESA) console.error(s.stdout().split('\n').filter((l) => /mesa|repetici|avatar|cerebro manos|promesas|harness/i.test(l)).join('\n'), '\nERR', s.errores());
  s.cerrar();
});

/** Un turno hablado por el stream, leído entero (con cuántos trozos `delta` salieron antes del `done`). */
async function turno(message: string, extra: Record<string, unknown> = {}) {
  const r = await fetch(`${s.BASE}/api/turno/stream`, { method: 'POST', headers: s.h, body: JSON.stringify({ message, hablado: true, idioma: 'es', avatar: 'aura', ...extra }) });
  const txt = await r.text();
  let dicho = '';
  let done: any = null;
  let deltas = 0;
  for (const b of txt.split('\n\n')) {
    const ev = /^event: (\w+)/m.exec(b)?.[1];
    const data = /^data: (.*)$/m.exec(b)?.[1];
    if (!ev || data === undefined) continue;
    const d = JSON.parse(data);
    if (ev === 'delta') {
      dicho += String(d.voz ?? d.text ?? '');
      deltas++;
    }
    if (ev === 'replace') dicho = String(d.voz ?? d.text ?? '');
    if (ev === 'done') done = d;
  }
  return { dicho: dicho.trim(), reply: String(done?.reply || ''), done, deltas };
}

const accionesDesde = (desde: number) =>
  s.acciones.slice(desde).map((b) => {
    try {
      return JSON.parse(/^data: (.*)$/m.exec(b)?.[1] || '{}').accion;
    } catch {
      return null;
    }
  });
const ultimoDe = (p: { body: any }) => String(p.body?.messages?.at(-1)?.content?.[0]?.text || '');
const todoDe = (p: { body: any }) => JSON.stringify(p.body?.messages || []);
/** La segunda vuelta de «no repitas» (con a000e04: «Acabas de repetir…»): contesta lo que a000e04 dejaba pasar. */
const SEGUNDA_VUELTA = (u: string) => /Acabas de repetir/.test(u);

test('el servidor levanta', () => {
  assert.ok(s.listo, `no levantó: ${s.errores()}`);
});

test('G1) el precio actualizado se dice entero: ni segunda vuelta ni «ya te lo dije»', { skip: !s.listo }, async () => {
  const VIEJO = '[EMO: neutral] El oro está a 2.450 dólares la onza ahora mismo, subió un uno por ciento desde ayer.';
  const NUEVO = '[EMO: neutral] El oro está a 2.460 dólares la onza ahora mismo, subió un uno por ciento desde ayer.';
  guion = (u) => (SEGUNDA_VUELTA(u) ? { texto: '[EMO: neutral] Eso ya te lo dije hace un momento.' } : u.endsWith('¿A cuánto está el oro hoy?') ? { texto: VIEJO } : u.endsWith('¿Y ahora en cuánto anda?') ? { texto: NUEVO } : { texto: '[EMO: neutral] Va.' });
  const r1 = await turno('¿A cuánto está el oro hoy?');
  assert.match(r1.reply, /2\.450/);
  const r2 = await turno('¿Y ahora en cuánto anda?');
  assert.equal(r2.reply, NUEVO.replace(/^\[EMO: \w+\] /, ''), 'antes: «Eso ya te lo dije» o la segunda vuelta');
  assert.match(r2.dicho, /2\.460/, 'y se oye');
  assert.ok(!s.pedidos.some((p) => SEGUNDA_VUELTA(ultimoDe(p))), 'sin segunda vuelta');
});

test('G1) un turno con una acción para la app no pasa por la guarda (lo dicho va entero)', { skip: !s.listo }, async () => {
  const P = '[EMO: neutral] Tienes la reunión con la cooperativa el jueves a las diez y faltaba revisar las cuentas del molino antes de esa fecha.';
  guion = (u) =>
    SEGUNDA_VUELTA(u)
      ? { texto: '[EMO: neutral] Va.' }
      : u.endsWith('¿Qué me queda de la cooperativa esta semana?')
        ? { texto: P }
        : u.endsWith('¿Me lo dejas con fondo negro mientras tanto?')
          ? { texto: P, herramienta: { nombre: 'ajustar_app', input: { cambio: 'tema_oscuro' } } }
          : { texto: '[EMO: neutral] Va.' };
  await turno('¿Qué me queda de la cooperativa esta semana?');
  const a0 = s.acciones.length;
  const r = await turno('¿Me lo dejas con fondo negro mientras tanto?');
  assert.equal(r.reply, P.replace(/^\[EMO: \w+\] /, ''), 'con ACCION_APP la guarda no toca nada');
  assert.ok(await esperarQue(() => accionesDesde(a0).some((a) => a?.tipo === 'tema')), 'y la acción sale');
});

test('G1) en el turno JSON la respuesta repetida va tal cual: nunca «Eso ya te lo dije»', { skip: !s.listo }, async () => {
  const LARGO = 'Hoy la planta de beneficio procesó cuarenta toneladas y el molino trabajó sin paradas durante todo el turno de la mañana.';
  nodoJson = (u) => (u.includes('¿Cómo va la planta de beneficio hoy?') || u.includes('¿Y el molino qué tal anda?') ? `[EMO: neutral] ${LARGO}` : null);
  const pedir = (message: string) => fetch(`${s.BASE}/api/turno`, { method: 'POST', headers: s.h, body: JSON.stringify({ message, idioma: 'es', avatar: 'aura' }) }).then((r) => r.json());
  const r1 = await pedir('¿Cómo va la planta de beneficio hoy?');
  assert.equal(r1.reply, LARGO);
  const r2 = await pedir('¿Y el molino qué tal anda?');
  assert.doesNotMatch(String(r2.reply), /ya te lo dije/i, 'antes: «Eso ya te lo dije hace un momento» (falso a veces, y nunca contesta)');
  assert.equal(r2.reply, LARGO);
  nodoJson = () => null;
});

test('G2) un «¿me oyes?» mientras piensa no deja tardío al turno: contesta igual', { skip: !s.listo }, async () => {
  guion = (u) => {
    if (u.endsWith('Cuéntame cómo va la cosecha de café.')) return { demoraMs: 1_500, texto: '[EMO: neutral] La cosecha de café va bien, ya llevan la mitad del lote.' };
    if (u.endsWith('¿Me oyes?')) return { texto: '[EMO: neutral] Sí, aquí estoy.' };
    return { texto: '[EMO: neutral] Va.' };
  };
  const pedidos0 = s.pedidos.length;
  const A = abrirTurno(s.BASE, s.h, { message: 'Cuéntame cómo va la cosecha de café.', hablado: true, idioma: 'es', avatar: 'aura', idTurno: `relleno-a-${Date.now()}` });
  assert.ok(await esperarQue(() => s.pedidos.length > pedidos0), 'A llegó al modelo');
  await new Promise((r) => setTimeout(r, 200));
  // Una app que manda el sondeo igual (la nueva lo suelta sin mandarlo: mobile/src/lib/fraseNueva.ts).
  await turno('¿Me oyes?');
  assert.ok(await esperarQue(() => A.hay('done'), 6_000), 'A cierra');
  await A.fin;
  const doneA = A.eventos.find((e) => e.ev === 'done')!.data;
  assert.notEqual(doneA.tardia, true, 'antes: el sondeo la dejaba tardía y la pregunta se perdía');
  assert.equal(doneA.reply, 'La cosecha de café va bien, ya llevan la mitad del lote.');
});

test('G2) con un envío de WhatsApp en curso, otra frase no descarta el turno: termina y lo dice', { skip: !s.listo }, async () => {
  // La primera vez pide la herramienta; la vuelta del harness (el mismo mensaje, con el resultado) tarda y la cuenta.
  let vecesA = 0;
  guion = (u) => {
    if (u.endsWith('Escríbele a Marisol por WhatsApp que llego a las cinco.'))
      return vecesA++ === 0
        ? { texto: '[EMO: neutral] Va.', herramienta: { nombre: 'whatsapp', input: { accion: 'responder', chat: 'Marisol', texto: 'Llego a las cinco' } } }
        : { demoraMs: 1_500, texto: '[EMO: neutral] Le escribo a Marisol: «Llego a las cinco». ¿Lo envío?' };
    if (u.endsWith('¿Qué hora es?')) return { texto: '[EMO: neutral] Son las tres.' };
    return { texto: '[EMO: neutral] Va.' };
  };
  const pedidos0 = s.pedidos.length;
  const A = abrirTurno(s.BASE, s.h, { message: 'Escríbele a Marisol por WhatsApp que llego a las cinco.', hablado: true, idioma: 'es', avatar: 'aura', idTurno: `efecto-a-${Date.now()}` });
  // La herramienta ya corrió (la vuelta que la cuenta tarda): llega otra frase.
  assert.ok(await esperarQue(() => s.pedidos.length >= pedidos0 + 2, 6_000), 'A pidió la herramienta y va en su vuelta');
  await new Promise((r) => setTimeout(r, 200));
  await turno('¿Qué hora es?');
  assert.ok(await esperarQue(() => A.hay('done'), 8_000), 'A cierra');
  await A.fin;
  const doneA = A.eventos.find((e) => e.ev === 'done')!.data;
  assert.notEqual(doneA.tardia, true, 'antes: se descartaba con el borrador hecho y sin decirlo');
  assert.match(String(doneA.reply), /Marisol/, 'dice lo que dejó listo');
});

test('G2) la frase cortada va como parte del pedido nuevo; la orden de avatar cortada no se retoma', { skip: !s.listo }, async () => {
  guion = (u) => {
    if (u.endsWith('¿Cómo va la planta de beneficio esta semana?') && !u.includes('Antes dijo')) return { demoraMs: 1_500, texto: '[EMO: neutral] Bien.' };
    if (u.endsWith('Oye, ¿me cambias al avatar de Claudio, porfa?') && !u.includes('Antes dijo') && !u.includes('cambiar de avatar')) return { demoraMs: 1_500, texto: '[EMO: neutral] Va.' };
    if (u.endsWith('¿Y las cuentas del molino?')) return { texto: '[EMO: neutral] La planta va bien y las cuentas del molino están al día.' };
    if (u.endsWith('¿Y el clima de hoy?')) return { texto: '[EMO: feliz] Ahí va, ya me pongo en Claudio. Hoy está despejado.', herramienta: { nombre: 'ajustar_app', input: { cambio: 'avatar_claudio' } } };
    return { texto: '[EMO: neutral] Va.' };
  };
  // (c) Una pregunta cortada por otra: el modelo recibe las dos, sin «no lo contestes».
  let pedidos0 = s.pedidos.length;
  const A = abrirTurno(s.BASE, s.h, { message: '¿Cómo va la planta de beneficio esta semana?', hablado: true, idioma: 'es', avatar: 'aura', idTurno: `corta-a-${Date.now()}` });
  assert.ok(await esperarQue(() => s.pedidos.length > pedidos0));
  await new Promise((r) => setTimeout(r, 200));
  A.cortar();
  const B = await turno('¿Y las cuentas del molino?');
  assert.equal(B.reply, 'La planta va bien y las cuentas del molino están al día.');
  const pedidoB = s.pedidos.filter((p) => ultimoDe(p).endsWith('¿Y las cuentas del molino?')).at(-1)!;
  assert.match(ultimoDe(pedidoB), /^\(Antes dijo esto y todavía no le contestaste: «¿Cómo va la planta de beneficio esta semana\?»/);
  assert.doesNotMatch(ultimoDe(pedidoB), /no lo contestes|Ya pasó/);
  // (d) La orden de cambiar de avatar cortada: el turno siguiente no la retoma (ni la pregunta ni la acción).
  pedidos0 = s.pedidos.length;
  const a0 = s.acciones.length;
  const C2 = abrirTurno(s.BASE, s.h, { message: 'Oye, ¿me cambias al avatar de Claudio, porfa?', hablado: true, idioma: 'es', avatar: 'aura', idTurno: `corta-avatar-${Date.now()}` });
  assert.ok(await esperarQue(() => s.pedidos.length > pedidos0));
  await new Promise((r) => setTimeout(r, 200));
  C2.cortar();
  const D = await turno('¿Y el clima de hoy?');
  const pedidoD = s.pedidos.filter((p) => ultimoDe(p).endsWith('¿Y el clima de hoy?')).at(-1)!;
  assert.match(ultimoDe(pedidoD), /Lo de cambiar de avatar \(«Oye, ¿me cambias al avatar de Claudio, porfa\?»\) quedó atrás/);
  assert.doesNotMatch(D.reply, /Claudio/, `ni «¿Te paso con Claudio?» ni «ya me pongo en Claudio»: ${D.reply}`);
  assert.match(D.reply, /despejado/);
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(accionesDesde(a0).filter((a) => a?.tipo === 'avatar'), []);
});

test('M3) el turno que contestó con una herramienta fallida no sale después como «sin respuesta»', { skip: !s.listo }, async () => {
  mensajesFallan = true;
  let vecesM = 0;
  guion = (u) => {
    if (u.endsWith('¿Qué me escribió Marisol por WhatsApp?'))
      return vecesM++ === 0 ? { texto: '[EMO: neutral] Déjame ver.', herramienta: { nombre: 'whatsapp', input: { accion: 'leer', chat: 'Marisol' } } } : { texto: '[EMO: neutral] No pude abrir el chat de Marisol ahora mismo.' };
    return { texto: '[EMO: neutral] Está despejado.' };
  };
  const r1 = await turno('¿Qué me escribió Marisol por WhatsApp?');
  mensajesFallan = false;
  assert.match(r1.reply, /No pude abrir el chat de Marisol/);
  await turno('¿Y del clima qué sabes?');
  const p = s.pedidos.filter((x) => ultimoDe(x).endsWith('¿Y del clima qué sabes?')).at(-1)!;
  assert.doesNotMatch(ultimoDe(p), /Antes dijo esto/, 'sí hubo respuesta: no va como «sin respuesta»');
  assert.match(todoDe(p), /No pude abrir el chat de Marisol/, 'y el modelo ve lo que contestó');
});

test('MENOR) una frase repetida suelta no retiene el resto del stream', { skip: !s.listo }, async () => {
  const V = 'Tienes la reunión con la cooperativa el jueves a las diez de la mañana en la planta.';
  guion = (u) =>
    u.endsWith('¿Cuándo es lo de la cooperativa?')
      ? { texto: `[EMO: neutral] ${V}` }
      : u.endsWith('¿Y qué más hay para esta semana?')
        ? { texto: `[EMO: neutral] ${V} El clima va a estar despejado. La factura llegó al correo. Ana confirmó el almuerzo. Beto manda saludos.` }
        : { texto: '[EMO: neutral] Va.' };
  await turno('¿Cuándo es lo de la cooperativa?');
  const r = await turno('¿Y qué más hay para esta semana?');
  assert.match(r.reply, /Beto manda saludos\.$/);
  assert.ok(r.deltas >= 2, `lo nuevo sale a trozos (antes todo se retenía hasta el final, en un solo trozo): ${r.deltas}`);
});
