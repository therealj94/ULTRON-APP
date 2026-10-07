/**
 * LA MESA DEL 7-OCT, DE PUNTA A PUNTA (José, APK 5.6.0 con la OTA de 2cfc26f, 00:30–00:34 UTC: «está loco repitiendo las
 * cosas; me cambió de avatar Aura a Claudio de la nada»). El server.ts de verdad en proceso contra un Bedrock FALSO, un
 * nodo falso y un puente de WhatsApp falso que cuenta lo que se le pide (tests/servidor-falso.ts). Frases, nombres y
 * pendientes inventados (no son los del dueño).
 *
 *  1. Avatar: lo pide el modelo («Ahí va, ya me pongo en Claudio» + la herramienta) → nada cambia, se pregunta
 *     «¿Te paso con Claudio?»; el «sí» del turno siguiente lo cambia; «Me cambió a Claudio.» lo devuelve al instante.
 *     Una orden de cambio con otra frase en medio ya no se cumple con un «sí».
 *  2. Respuesta tardía: el turno A todavía piensa cuando llega la frase B. A no suena, no hace nada en el teléfono y no
 *     queda en su memoria; B manda. Con la app nueva (corta A) y con una vieja (lo deja abierto).
 *  3. La frase sin respuesta llega al modelo marcada como de antes (no pegada a la de ahora en un solo mensaje).
 *  4. Repetición: el mismo párrafo a otra frase → no se dice otra vez (segunda vuelta con la nota de no repetir).
 *  5. Pendiente insistente: «WhatsApp a Marisol» quedó a medias; en un turno que no habla de mensajes no se abre WhatsApp,
 *     se menciona una vez y no vuelve al turno siguiente, salvo que pregunte por sus pendientes.
 *
 * Con main (2cfc26f) falla: el avatar cambiaba sin preguntar, la acción del turno tardío llegaba al teléfono y su respuesta
 * quedaba en el hilo, la frase vieja iba pegada a la nueva, el párrafo se repetía entero y WhatsApp corría fuera de tema.
 * Se corre con NODE_ENV=test y sin él (el servidor hijo lo hereda).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { abrirTurno, esperarQue, levantarServidor, type RespuestaFalsa } from './servidor-falso';

const CORREO = 'jose.mesa7oct@ordenglobal.org';
const PARRAFO =
  '[EMO: feliz] Je, sí, me cambié de ropa. Era Aura, ahora soy Claudio, el mismo cerebro con otro traje. Y de lo que quedó: tienes la reunión con la cooperativa el jueves y faltaba revisar las cuentas del molino antes de esa fecha.';
const PARRAFO_LIMPIO = PARRAFO.replace(/^\[EMO: \w+\] /, '');

/** Lo que el puente falso recibió (para saber si la herramienta de WhatsApp corrió). */
const alPuente: string[] = [];
/** El guion del modelo falso: según lo último que vio y su system. */
let guion: (ultimo: string, body: any) => RespuestaFalsa = () => ({ texto: '[EMO: neutral] Va.' });

const s = await levantarServidor({
  correo: CORREO,
  env: { AURA_SUSPENSIONES: 'ninguna' },
  contestar: (ultimo, _modelo, body) => {
    const r = guion(ultimo, body);
    if (process.env.DEPURAR_MESA) console.error('[bedrock falso]', JSON.stringify(ultimo.slice(-160)), '→', JSON.stringify(r).slice(0, 160));
    return r;
  },
  puente: (u) => {
    if (u.pathname !== '/estado') alPuente.push(u.pathname);
    if (u.pathname === '/estado') return { status: 200, json: { vinculado: true, conectado: true, numero: '+50499990000', vinculando: false } };
    if (u.pathname === '/chats') return { status: 200, json: { chats: [{ jid: '50488887777@s.whatsapp.net', nombre: 'Marisol', grupo: false, noLeidos: 0, hora: Date.now() - 60_000, ultimo: 'hola', ultimoMio: false, numero: '+50488887777' }] } };
    if (u.pathname === '/contactos') return { status: 200, json: { contactos: [] } };
    if (u.pathname === '/mensajes') return { status: 200, json: { chat: { jid: '50488887777@s.whatsapp.net', nombre: 'Marisol' }, mensajes: [] } };
    return null;
  },
});
after(() => {
  if (process.env.DEPURAR_MESA) console.error(s.stdout().split('\n').filter((l) => /mesa|repetici|avatar|cerebro manos|promesas/i.test(l)).join('\n'), '\nERR', s.errores());
  s.cerrar();
});

/** Un turno hablado por el stream, leído entero. */
async function turno(message: string, extra: Record<string, unknown> = {}) {
  const r = await fetch(`${s.BASE}/api/turno/stream`, { method: 'POST', headers: s.h, body: JSON.stringify({ message, hablado: true, idioma: 'es', avatar: 'aura', ...extra }) });
  const txt = await r.text();
  let dicho = '';
  let done: any = null;
  for (const b of txt.split('\n\n')) {
    const ev = /^event: (\w+)/m.exec(b)?.[1];
    const data = /^data: (.*)$/m.exec(b)?.[1];
    if (!ev || data === undefined) continue;
    const d = JSON.parse(data);
    if (ev === 'delta') dicho += String(d.voz ?? d.text ?? '');
    if (ev === 'replace') dicho = String(d.voz ?? d.text ?? '');
    if (ev === 'done') done = d;
  }
  return { dicho: dicho.trim(), reply: String(done?.reply || ''), done };
}

/** Las acciones que llegaron por el canal del teléfono desde la posición `desde`. */
const accionesDesde = (desde: number) =>
  s.acciones.slice(desde).map((b) => {
    try {
      return JSON.parse(/^data: (.*)$/m.exec(b)?.[1] || '{}').accion;
    } catch {
      return null;
    }
  });
/** El texto del último mensaje de la persona en un pedido a Bedrock. */
const ultimoDe = (p: { body: any }) => String(p.body?.messages?.at(-1)?.content?.[0]?.text || '');
const todoDe = (p: { body: any }) => JSON.stringify(p.body?.messages || []);

test('el servidor levanta', () => {
  assert.ok(s.listo, `no levantó: ${s.errores()}`);
});

test('1) el modelo pide Claudio: nada cambia y se pregunta; el «sí» lo cambia; «Me cambió a Claudio.» lo devuelve al instante', { skip: !s.listo }, async () => {
  guion = (u) => (u.includes('el de lentes') ? { texto: '[EMO: feliz] Ahí va, ya me pongo en Claudio.', herramienta: { nombre: 'ajustar_app', input: { cambio: 'avatar_claudio' } } } : { texto: '[EMO: neutral] Va.' });
  let a0 = s.acciones.length;
  const pide = await turno('¿Me pasas con el de lentes un rato?');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(accionesDesde(a0).filter((a) => a?.tipo === 'avatar'), [], 'antes la app cambiaba de avatar sin preguntar');
  assert.deepEqual(pide.done.acciones, []);
  assert.match(pide.reply, /¿Te paso con Claudio\?$/);
  assert.doesNotMatch(pide.reply, /ya me pongo/i, 'no dice que cambió: no cambió');
  // «Sí.»: lo resuelve el servidor sin el modelo y la acción llega al teléfono.
  const pedidosAntes = s.pedidos.length;
  a0 = s.acciones.length;
  const si = await turno('Sí.');
  assert.equal(si.reply, '¡Va! Te paso con Claudio.');
  assert.ok(await esperarQue(() => accionesDesde(a0).some((a) => a?.tipo === 'avatar' && a.valor === 'claudio')), 'el «sí» lo cambia');
  // Ya con Claudio enfrente, la queja lo devuelve al instante, en una frase.
  a0 = s.acciones.length;
  const queja = await turno('Me cambió a Claudio.', { avatar: 'claudio' });
  assert.equal(queja.reply, 'Perdón, ya volví: soy AU-RA otra vez.');
  assert.ok(await esperarQue(() => accionesDesde(a0).some((a) => a?.tipo === 'avatar' && a.valor === 'aura')), 'vuelve a AU-RA');
  assert.equal(s.pedidos.length, pedidosAntes, 'ni el «sí» ni la queja esperan al modelo');
});

test('1b) «Necesito que cambies a Claudio» (mal oída) solo pregunta; con otra frase en medio, el «sí» ya no lo cumple', { skip: !s.listo }, async () => {
  guion = (u) => (u.includes('pendiente') ? { texto: '[EMO: neutral] Nada urgente por ahora.' } : { texto: '[EMO: neutral] Va.' });
  const a0 = s.acciones.length;
  const oida = await turno('Necesito que cambies a Claudio.');
  assert.equal(oida.reply, '¿Te paso con Claudio?');
  await turno('¿Qué tenemos pendiente?');
  await turno('Sí.');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(accionesDesde(a0).filter((a) => a?.tipo === 'avatar'), [], 'la orden que llega tarde se descarta');
});

test('2a) respuesta tardía con la app nueva: A todavía piensa, la persona dice B (la app corta A); A no hace nada ni queda en el hilo', { skip: !s.listo }, async () => {
  guion = (u) => {
    if (u.endsWith('Cuéntame cómo va la planta de beneficio.')) return { demoraMs: 1_500, texto: '[EMO: neutral] La planta va bien, terminamos la losa del molino.', herramienta: { nombre: 'ajustar_app', input: { cambio: 'tema_oscuro' } } };
    if (u.endsWith('¿Y las cuentas del molino?')) return { texto: '[EMO: neutral] Las cuentas del molino están al día.' };
    return { texto: '[EMO: neutral] Va.' };
  };
  const a0 = s.acciones.length;
  const pedidos0 = s.pedidos.length;
  const A = abrirTurno(s.BASE, s.h, { message: 'Cuéntame cómo va la planta de beneficio.', hablado: true, idioma: 'es', avatar: 'aura', idTurno: `tardia-a-${Date.now()}` });
  assert.ok(await esperarQue(() => s.pedidos.length > pedidos0), 'A llegó al modelo');
  await new Promise((r) => setTimeout(r, 200));
  // La frase nueva llega mientras A piensa: la app corta A (mobile/src/lib/fraseNueva.ts) y manda B.
  A.cortar();
  const B = await turno('¿Y las cuentas del molino?');
  assert.equal(B.reply, 'Las cuentas del molino están al día.');
  // B llegó al modelo con A marcada como de antes (sin respuesta), no pegada a la suya en un solo mensaje.
  const pedidoB = s.pedidos.filter((p) => ultimoDe(p).endsWith('¿Y las cuentas del molino?')).at(-1)!;
  assert.match(ultimoDe(pedidoB), /^\(Antes dijo esto y no quedó respuesta tuya: «Cuéntame cómo va la planta de beneficio\.»/);
  // Lo que A pedía (el tema oscuro) no llega nunca al teléfono.
  await new Promise((r) => setTimeout(r, 2_000));
  assert.deepEqual(accionesDesde(a0).filter((a) => a?.tipo === 'tema'), [], 'la acción del turno tardío no sale');
  // Y su respuesta no quedó en el hilo: el turno siguiente no la ve.
  guion = () => ({ texto: '[EMO: neutral] Va.' });
  await turno('Gracias, eso era todo por ahora.');
  assert.doesNotMatch(todoDe(s.pedidos.at(-1)!), /terminamos la losa/, 'la respuesta tardía no quedó en su memoria');
});

test('2b) respuesta tardía con una app vieja (no corta A): A deja de hablar al llegar B, cierra vacía y no hace nada', { skip: !s.listo }, async () => {
  guion = (u) => {
    if (u.endsWith('Háblame del precio del cobre esta semana.')) return { demoraMs: 1_500, texto: '[EMO: neutral] El cobre subió un poco esta semana en Londres.', herramienta: { nombre: 'ajustar_app', input: { cambio: 'tema_claro' } } };
    if (u.endsWith('Mejor dime la hora de la reunión.')) return { texto: '[EMO: neutral] La reunión es a las tres de la tarde.' };
    return { texto: '[EMO: neutral] Va.' };
  };
  const a0 = s.acciones.length;
  const pedidos0 = s.pedidos.length;
  const A = abrirTurno(s.BASE, s.h, { message: 'Háblame del precio del cobre esta semana.', hablado: true, idioma: 'es', avatar: 'aura', idTurno: `tardia-vieja-${Date.now()}` });
  assert.ok(await esperarQue(() => s.pedidos.length > pedidos0));
  await new Promise((r) => setTimeout(r, 200));
  const B = await turno('Mejor dime la hora de la reunión.');
  assert.equal(B.reply, 'La reunión es a las tres de la tarde.');
  assert.ok(await esperarQue(() => A.hay('done'), 6_000), 'A cierra');
  await A.fin;
  const doneA = A.eventos.find((e) => e.ev === 'done')!.data;
  assert.equal(doneA.tardia, true);
  assert.equal(doneA.reply, '', 'la respuesta a la frase vieja no se entrega');
  assert.deepEqual(doneA.acciones, []);
  assert.equal(A.eventos.filter((e) => e.ev === 'delta' || e.ev === 'replace').length, 0, 'ni un trozo de A suena después de B');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(accionesDesde(a0).filter((a) => a?.tipo === 'tema'), []);
});

test('4) el mismo párrafo a otra frase no se dice otra vez: segunda vuelta con la nota de no repetir', { skip: !s.listo }, async () => {
  guion = (u) => {
    if (/Acabas de repetir/.test(u)) return { texto: '[EMO: neutral] Perdón, me repetí. Dime qué necesitas ahora.' };
    if (u.endsWith('Cuéntame qué pasó con el avatar y lo que quedó.') || u.includes('del clima de hoy qué sabes')) return { texto: PARRAFO };
    return { texto: '[EMO: neutral] Va.' };
  };
  const r1 = await turno('Cuéntame qué pasó con el avatar y lo que quedó.');
  assert.equal(r1.reply, PARRAFO_LIMPIO);
  const r2 = await turno('Gracias, ¿y del clima de hoy qué sabes?');
  assert.notEqual(r2.reply, PARRAFO_LIMPIO, 'antes repetía el párrafo entero');
  assert.equal(r2.reply, 'Perdón, me repetí. Dime qué necesitas ahora.');
  assert.doesNotMatch(r2.dicho, /me cambié de ropa|cuentas del molino antes/, `lo repetido no suena: ${r2.dicho}`);
  assert.match(s.stdout(), /\[repetición\] repetía lo ya dicho/);
  // Si pide que lo repita, sí lo repite.
  guion = () => ({ texto: PARRAFO });
  const otra = await turno('¿Qué dijiste? No te oí bien.');
  assert.equal(otra.reply, PARRAFO_LIMPIO);
});

test('5) el WhatsApp pendiente no abre WhatsApp en un turno que no habla de mensajes, y se menciona una vez', { skip: !s.listo }, async () => {
  // Queda a medias por lo que dijo la persona (las reglas de lib/abiertos.ts lo anotan al guardar el turno).
  guion = () => ({ texto: '[EMO: neutral] Va, anotado.' });
  await turno('Mañana tengo que escribirle a Marisol por WhatsApp lo de la reunión, sin falta.');
  // El turno que no habla de mensajes: el modelo ve el pendiente y quiere abrir WhatsApp por su cuenta.
  let vioPendiente = false;
  guion = (u, body) => {
    const sistema = JSON.stringify(body?.system || '');
    if (u.endsWith('Cuéntame algo bonito del día.')) {
      vioPendiente = /Marisol/.test(sistema);
      return vioPendiente
        ? { texto: '[EMO: feliz] Hoy amaneció despejado. Y te quedó pendiente escribirle a Marisol por WhatsApp.', herramienta: { nombre: 'whatsapp', input: { accion: 'leer', chat: 'Marisol' } } }
        : { texto: '[EMO: feliz] Hoy amaneció despejado.' };
    }
    if (/HARNESS|WHATSAPP/.test(u)) return { texto: '[EMO: neutral] Listo.' };
    return { texto: '[EMO: neutral] Va.' };
  };
  assert.ok(await esperarQue(() => true));
  // El pendiente se anota en segundo plano: se espera a que el turno lo vea.
  for (let i = 0; i < 10 && !vioPendiente; i++) {
    alPuente.length = 0;
    await turno('Cuéntame algo bonito del día.');
    if (!vioPendiente) await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(vioPendiente, 'el pendiente llegó al turno (QUEDÓ A MEDIAS)');
  assert.deepEqual(alPuente.filter((p) => p === '/mensajes' || p === '/chats'), [], 'WhatsApp no corrió en un turno que no hablaba de mensajes');
  assert.match(s.stdout(), /whatsapp fuera de tema: no se corre/);
  // Ya lo mencionó: el turno siguiente no lo trae otra vez.
  let sistemaSiguiente = '';
  guion = (_u, body) => {
    sistemaSiguiente = JSON.stringify(body?.system || '');
    return { texto: '[EMO: neutral] Va.' };
  };
  await turno('¿Y qué más me cuentas del clima?');
  assert.doesNotMatch(sistemaSiguiente, /Marisol/, 'mencionado una vez por sesión');
  // Si pregunta por sus pendientes, ahí sí.
  await turno('¿Qué tenemos pendiente?');
  assert.match(sistemaSiguiente, /te pregunta por sus pendientes[\s\S]*Marisol/);
});
