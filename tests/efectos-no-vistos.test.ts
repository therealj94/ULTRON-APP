/**
 * LO QUE SALIÓ EN UN TURNO QUE LA PERSONA NO VIO (tanda F1, lib/efectos-no-vistos.ts). Un turno JSON (el respaldo de la mesa,
 * la foto) que el teléfono corta después de que algo salió afuera sigue en el servidor y deja su recibo, pero la respuesta
 * no llega a nadie. Ahora el turno siguiente lo dice UNA vez, al empezar, con la frase fija del recibo: «Lo de antes sí
 * salió: le mandé el WhatsApp a Padrino.» (o «no sé si salió…» si quedó incierto). Si el teléfono reintenta ese idTurno y
 * recibe la respuesta guardada, ya lo vio: no se dice otra vez.
 *
 * Primero lo puro; después con el server.ts DE VERDAD (tests/servidor-falso.ts: Bedrock, nodo y puente de WhatsApp
 * falsos). Se corre con NODE_ENV=test y sin él.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { esperarQue, levantarServidor } from './servidor-falso';

const E = await import('../lib/efectos-no-vistos');

/* ── lo puro ─────────────────────────────────────────────────────────────────────────────── */

test('efectosDelTurno: lo que el proveedor confirmó salió; lo despachado sin final, incierto; un borrador o lo guardado no cuentan', () => {
  const ef = E.efectosDelTurno({
    decisiones: [
      { canal: 'whatsapp', r: { estado: 'succeeded', recibo: { efecto: 'confirmado', entrega: 'aceptado' } }, destino: 'Padrino (+50488881111)' },
      { canal: 'correo', r: { estado: 'unknown', recibo: { efecto: 'posible' } }, destino: 'bea@ejemplo.org' },
      { canal: 'calendario', r: null },
      { canal: 'whatsapp', r: { estado: 'succeeded', recibo: { efecto: 'borrador' } } },
      { canal: 'correo', r: { estado: 'failed', recibo: { efecto: 'ninguno' } } },
    ],
    pasos: [
      { herramienta: 'circulo', estado: 'succeeded', recibo: { efecto: 'confirmado' } },
      { herramienta: 'mision', estado: 'succeeded', recibo: { efecto: 'guardado' } },
      { herramienta: 'web', estado: 'succeeded', recibo: { efecto: 'ninguno' } },
      { herramienta: 'whatsapp', estado: 'succeeded', recibo: { efecto: 'confirmado', entrega: 'fallido' } },
    ],
  });
  assert.deepEqual(ef, [
    { canal: 'whatsapp', final: 'salio', destino: 'Padrino' },
    { canal: 'correo', final: 'incierto' },
    { canal: 'whatsapp', final: 'salio' },
  ]);
});

test('la frase: sale del recibo, honesta con lo incierto, en los dos idiomas', () => {
  assert.equal(E.fraseEfectosNoVistos([{ canal: 'whatsapp', final: 'salio', destino: 'Ana' }]), 'Lo de antes sí salió: le mandé el WhatsApp a Ana.');
  assert.equal(E.fraseEfectosNoVistos([{ canal: 'whatsapp', final: 'incierto', destino: 'Ana' }]), 'Lo de antes: no sé si salió el WhatsApp a Ana; revísalo antes de pedirlo otra vez.');
  assert.equal(
    E.fraseEfectosNoVistos([
      { canal: 'correo', final: 'salio', destino: 'Bea' },
      { canal: 'whatsapp', final: 'incierto', destino: 'Ana' },
      { canal: 'correo', final: 'salio', destino: 'Bea' },
    ]),
    'Lo de antes sí salió: le mandé el correo a Bea. No sé si salió el WhatsApp a Ana; revísalo antes de pedirlo otra vez.'
  );
  assert.equal(E.fraseEfectosNoVistos([{ canal: 'whatsapp', final: 'salio' }]), 'Lo de antes sí salió: mandé el WhatsApp.');
  assert.equal(E.fraseEfectosNoVistos([{ canal: 'whatsapp', final: 'salio', destino: 'Ana' }], 'en'), 'About before: it did go out: I sent the WhatsApp to Ana.');
  assert.equal(E.fraseEfectosNoVistos([]), '');
  // Delante de la respuesta, después de la etiqueta de ánimo.
  assert.equal(E.conAvisoDeAntes('[EMO: feliz] Claro, ¿qué más?', 'Lo de antes sí salió: le mandé el WhatsApp a Ana.'), '[EMO: feliz] Lo de antes sí salió: le mandé el WhatsApp a Ana. Claro, ¿qué más?');
  assert.equal(E.conAvisoDeAntes('Hola', ''), 'Hola');
});

test('una vez: anotar → avisar (sin quitar) → confirmar; el reintento entregado lo quita; vence; por persona', () => {
  E._olvidarEfectosNoVistos();
  const T = 1_800_000_000_000;
  E.anotarEfectosNoVistos('Jose@X.org', 'turno-aaaa1111', [{ canal: 'whatsapp', final: 'salio', destino: 'Ana' }], T);
  assert.equal(E.avisoEfectosNoVistos('otra@x.org', 'es', T), null, 'de otra persona, nada');
  const a = E.avisoEfectosNoVistos('jose@x.org', 'es', T + 1000)!;
  assert.equal(a.frase, 'Lo de antes sí salió: le mandé el WhatsApp a Ana.');
  assert.match(a.hecho, /YA empieza con «Lo de antes sí salió/);
  assert.ok(E.avisoEfectosNoVistos('jose@x.org', 'es', T + 2000), 'hasta que se entregue, sigue');
  E.confirmarEfectosNoVistos('jose@x.org', a.ids);
  assert.equal(E.avisoEfectosNoVistos('jose@x.org', 'es', T + 3000), null, 'dicho una vez');
  // El reintento del mismo idTurno recibió la respuesta guardada.
  E.anotarEfectosNoVistos('jose@x.org', 'turno-bbbb2222', [{ canal: 'correo', final: 'salio', destino: 'Bea' }], T);
  E.turnoVisto('jose@x.org', 'turno-bbbb2222');
  assert.equal(E.avisoEfectosNoVistos('jose@x.org', 'es', T), null);
  // Pasado su tiempo ya no es «lo de antes».
  E.anotarEfectosNoVistos('jose@x.org', 'turno-cccc3333', [{ canal: 'correo', final: 'salio' }], T);
  assert.equal(E.avisoEfectosNoVistos('jose@x.org', 'es', T + E.NO_VISTOS_VIVEN_MS + 1), null);
  // Sin efectos, nada que anotar.
  E.anotarEfectosNoVistos('jose@x.org', 'turno-dddd4444', [], T);
  assert.equal(E.avisoEfectosNoVistos('jose@x.org', 'es', T), null);
});

/* ── con el servidor de verdad ───────────────────────────────────────────────────────────── */

const CORREO = 'jose.efectos@ordenglobal.org';
const CHATS = [{ jid: '50488881111@s.whatsapp.net', nombre: 'Padrino', grupo: false, noLeidos: 0, hora: Date.now() - 60_000, ultimo: 'hola', ultimoMio: false, numero: '+50488881111' }];
const enviados: Array<{ chat: string; texto: string }> = [];
let demoraNodo = 0;
let guion: (u: string, ultimo: string) => { texto: string } = () => ({ texto: '[EMO: neutral] Va.' });

const s = await levantarServidor({
  correo: CORREO,
  env: { AURA_SUSPENSIONES: 'ninguna' },
  contestar: (ultimo, _modelo, body) => guion(`${ultimo}\n${JSON.stringify(body?.system || '')}\n${JSON.stringify(body?.messages?.at(-1) || '')}`, ultimo),
  nodoJson: () => '[EMO: feliz] Listo, mensaje enviado a Padrino.',
  nodoJsonDemoraMs: () => demoraNodo,
  puente: (u, cuerpo) => {
    if (u.pathname === '/estado') return { status: 200, json: { vinculado: true, conectado: true, numero: '+50499990000', vinculando: false } };
    if (u.pathname === '/chats') return { status: 200, json: { chats: CHATS } };
    if (u.pathname === '/contactos') return { status: 200, json: { contactos: [] } };
    if (u.pathname === '/mensajes') return { status: 200, json: { chat: CHATS[0], mensajes: [] } };
    if (u.pathname === '/mensaje') return { status: 404, json: { error: 'no está' } };
    if (u.pathname === '/enviar') {
      const c = JSON.parse(cuerpo || '{}');
      enviados.push({ chat: c.chat, texto: c.texto });
      return { status: 200, json: { mensaje: { id: c.id || 'E1', chat: c.chat, mio: true, texto: c.texto, tipo: 'texto', hora: Date.now() } } };
    }
    return null;
  },
});
after(() => s.cerrar());

/** Un turno por el stream, leído entero: lo que se dijo y el `done`. */
async function turno(message: string, extra: Record<string, unknown> = {}) {
  const r = await fetch(`${s.BASE}/api/turno/stream`, { method: 'POST', headers: s.h, body: JSON.stringify({ message, hablado: false, idioma: 'es', avatar: 'aura', ...extra }) });
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

/** Un borrador de WhatsApp para Padrino, presentado en la mesa (como tests/honestidad-servidor.test.ts, caso 1). */
async function borradorParaPadrino(texto: string) {
  guion = (u, ultimo) => {
    if (u.includes('BORRADOR DE WHATSAPP')) return { texto: `[EMO: neutral] Te dejé listo para Padrino: «${texto}». ¿Lo mando?` };
    if (ultimo.includes('Preguntarle')) return { texto: `[EMO: neutral] ¿Le escribo esto?\n\n*"${texto}"*` };
    if (ultimo.includes('Quiero escribirle a mi padrino')) return { texto: '[EMO: neutral] ¿Qué le querés decir?' };
    return { texto: '[EMO: neutral] Va, ¿qué más?' };
  };
  await turno('Quiero escribirle a mi padrino.');
  const p = await turno(`Preguntarle ${texto.toLowerCase()}`);
  assert.match(p.reply, /Padrino/, p.reply);
}

/** El «sí» por el turno JSON, cortado por el teléfono en cuanto el mensaje sale (antes de que llegue la respuesta). */
async function siCortado(idTurno: string) {
  demoraNodo = 1500;
  const antes = enviados.length;
  const anotados = () => (s.stdout().match(/respuesta no entregada con 1 efecto/g) || []).length;
  const yaAnotados = anotados();
  const corte = new AbortController();
  const pedido = fetch(`${s.BASE}/api/turno`, { method: 'POST', headers: s.h, body: JSON.stringify({ message: 'Sí, enviarlo.', idTurno, idioma: 'es', avatar: 'aura' }), signal: corte.signal }).catch((e) => e);
  assert.ok(await esperarQue(() => enviados.length === antes + 1, 8_000), `el «sí» no mandó nada: ${s.errores()}`);
  corte.abort();
  await pedido;
  // El servidor termina el turno solo (el nodo tarda) y anota que la respuesta no se entregó.
  assert.ok(await esperarQue(() => anotados() > yaAnotados, 8_000), 'el servidor no anotó el efecto no visto');
  demoraNodo = 0;
}

test('el servidor levanta', () => {
  assert.ok(s.listo, `no levantó: ${s.errores()}`);
});

test('un «sí» por JSON cortado después de mandar el WhatsApp: el turno siguiente lo dice, una vez, con su recibo', { skip: !s.listo }, async () => {
  await borradorParaPadrino('Padrino, ¿qué tal todo?');
  await siCortado('turno-cortado-0001');
  assert.equal(enviados.length, 1, 'salió una vez');
  guion = () => ({ texto: '[EMO: neutral] Claro, dime.' });
  const sigue = await turno('Oye, otra cosa.');
  assert.match(sigue.reply, /^Lo de antes sí salió: le mandé el WhatsApp a Padrino\. Claro, dime\./, sigue.reply);
  assert.match(sigue.dicho, /^Lo de antes sí salió: le mandé el WhatsApp a Padrino\./, `sonó: ${sigue.dicho}`);
  const otra = await turno('¿Y el clima?');
  assert.doesNotMatch(otra.reply, /Lo de antes/, 'una sola vez');
  assert.equal(enviados.length, 1, 'nada salió dos veces');
});

test('el turno siguiente HABLADO también lo dice primero (el pulidor de la voz no se lo come)', { skip: !s.listo }, async () => {
  await borradorParaPadrino('Padrino, ¿vamos el sábado?');
  await siCortado('turno-cortado-0003');
  guion = () => ({ texto: '[EMO: neutral] Claro, te escucho.' });
  const sigue = await turno('Oye, una pregunta.', { hablado: true });
  assert.match(sigue.dicho, /^Lo de antes sí salió: le mandé el WhatsApp a Padrino\./, `sonó: ${sigue.dicho}`);
  assert.match(sigue.reply, /^Lo de antes sí salió: le mandé el WhatsApp a Padrino\./, sigue.reply);
  assert.match(String(sigue.done?.voz || ''), /^Lo de antes sí salió/);
});

test('si el teléfono reintenta ese idTurno y recibe la respuesta guardada, ya lo vio: no se repite', { skip: !s.listo }, async () => {
  await borradorParaPadrino('Padrino, ¿cuándo nos vemos?');
  await siCortado('turno-cortado-0002');
  const r = await fetch(`${s.BASE}/api/turno`, { method: 'POST', headers: s.h, body: JSON.stringify({ message: 'Sí, enviarlo.', idTurno: 'turno-cortado-0002', idioma: 'es', avatar: 'aura' }) });
  const j = (await r.json()) as any;
  assert.equal(j.repetido, true);
  assert.match(j.reply, /Padrino/);
  assert.equal(enviados.length, 3, 'el reintento no manda otra vez');
  guion = () => ({ texto: '[EMO: neutral] Va.' });
  const sigue = await turno('Gracias.');
  assert.doesNotMatch(sigue.reply, /Lo de antes/, sigue.reply);
});
