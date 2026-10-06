/**
 * NUNCA «LISTO, MENSAJE ENVIADO» SIN ENVÍO (José, 6-oct, APK 5.6.0, mesa del teléfono 21:14–21:24 UTC). Las situaciones de
 * ese día, con el server.ts DE VERDAD en proceso (tsx, carpeta temporal) contra un Bedrock FALSO, un nodo falso y un puente
 * de WhatsApp falso que cuenta lo que se manda. Contactos y textos inventados.
 *
 *  1. «¿Le escribo esto? "…"» en texto libre (por la charla, sin herramienta) → ahora es un BORRADOR de verdad (la
 *     herramienta de WhatsApp, destinatario resuelto); el «Sí, enviarlo.» siguiente lo manda el servidor UNA vez, con el
 *     texto exacto, y entonces sí se puede decir «enviado».
 *  2. «Listo, mensaje enviado. ¿Algo más?» sin borrador ni herramienta (por la charla y por las manos) → se dice la verdad.
 *  3. Con un borrador esperando su «sí», «Listo, mensaje enviado a … por WhatsApp» → «Todavía no lo envié: … espera tu
 *     aprobación en la tarjeta», y no sale nada.
 *  4. Bedrock no contesta y el respaldo (el Qwen del nodo) dice «¡Listo! Mensaje enviado…» → la misma guarda.
 *  5. «a mi compadre» con dos chats «Compadre» → la herramienta pregunta cuál (nunca elige sola) y no queda borrador.
 *
 * Con main (1db49e3) fallan: no había borrador, «enviado» pasaba tal cual y «mi compadre» no se resolvía. Se corre con
 * NODE_ENV=test y sin él (el servidor hijo lo hereda: tests/servidor-falso.ts).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, type RespuestaFalsa } from './servidor-falso';

const CORREO = 'jose.honestidad@ordenglobal.org';
const sinT = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chat = (jid: string, nombre: string, numero: string) => ({ jid, nombre, grupo: false, noLeidos: 0, hora: Date.now() - 60_000, ultimo: 'hola', ultimoMio: false, numero });
const CHATS = [
  chat('50488881111@s.whatsapp.net', 'Padrino', '+50488881111'),
  chat('50488882222@s.whatsapp.net', 'Rosa Elena Mejía Paz', '+50488882222'),
  chat('50488883333@s.whatsapp.net', 'Compadre', '+50488883333'),
  chat('50488884444@s.whatsapp.net', 'Compadre Luis', '+50488884444'),
];
/** Lo que el puente falso mandó de verdad. */
const enviados: Array<{ chat: string; texto: string }> = [];

/** El guion del modelo falso: según lo último que vio (el mensaje de la persona y los HECHOS del turno). */
let guion: (ultimo: string, body: any) => RespuestaFalsa & { fallaBedrock?: boolean } = () => ({ texto: '[EMO: neutral] Aquí estoy.' });
let delNodo = '[EMO: neutral] Hola desde el nodo.';

const s = await levantarServidor({
  correo: CORREO,
  env: { AURA_SUSPENSIONES: 'ninguna' },
  contestar: (ultimo, modelo, body) => {
    if (process.env.DEPURAR_HONESTIDAD) console.error('[bedrock falso]', modelo, JSON.stringify(ultimo.slice(-300)));
    return guion(`${ultimo}\n${JSON.stringify(body?.system || '')}\n${JSON.stringify(body?.messages?.at(-1) || '')}`, body);
  },
  nodo: () => delNodo,
  puente: (u, cuerpo) => {
    if (u.pathname === '/estado') return { status: 200, json: { vinculado: true, conectado: true, numero: '+50499990000', vinculando: false } };
    if (u.pathname === '/chats') {
      const b = sinT(u.searchParams.get('buscar') || '');
      return { status: 200, json: { chats: CHATS.filter((c) => !b || sinT(c.nombre).includes(b) || c.numero.replace(/\D/g, '').endsWith(b.replace(/\D/g, '') || 'x')) } };
    }
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
after(() => {
  if (process.env.DEPURAR_HONESTIDAD) console.error(s.stdout().split('\n').filter((l) => /honestidad|promesas|cerebro manos|whatsapp|decisi|\[mesa\]/i.test(l)).join('\n'), '\nERR', s.errores());
  s.cerrar();
});

/** Un turno por el stream, leído entero: lo que se dijo (delta/replace) y el `done`. */
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
  if (process.env.DEPURAR_HONESTIDAD) console.error('[turno]', JSON.stringify(message), '→', done?.via, JSON.stringify(done?.reply));
  return { dicho: dicho.trim(), reply: String(done?.reply || ''), done };
}

/** Las frases que dan por hecho un envío (lo que nunca puede salir sin recibo). */
const AFIRMA_ENVIO = /\b(mensaje enviado|enviado a|ya (se )?lo (mand|envi)[eé]|le escrib[ií]|message sent)\b/i;

test('el servidor levanta', () => {
  assert.ok(s.listo, `no levantó: ${s.errores()}`);
});

test('2) «Listo, mensaje enviado» sin borrador ni herramienta → la verdad (por la charla y por las manos)', { skip: !s.listo }, async () => {
  enviados.length = 0;
  guion = () => ({ texto: '[EMO: feliz] Listo, mensaje enviado. ¿Algo más?' });
  const charla = await turno('Bien, nada más.');
  assert.doesNotMatch(charla.reply, AFIRMA_ENVIO, charla.reply);
  assert.doesNotMatch(charla.dicho, AFIRMA_ENVIO, `sonó: ${charla.dicho}`);
  assert.match(charla.reply, /Todav[ií]a no lo envi[eé]/);
  guion = () => ({ texto: '[EMO: feliz] ¡Listo! Ya se lo mandé a tu compadre por WhatsApp.' });
  const manos = await turno('Sí, enviarlo. Sí.');
  assert.doesNotMatch(manos.reply, AFIRMA_ENVIO, manos.reply);
  assert.doesNotMatch(manos.dicho, AFIRMA_ENVIO, `sonó: ${manos.dicho}`);
  assert.match(manos.reply, /Todav[ií]a no lo envi[eé]/);
  assert.equal(enviados.length, 0);
});

test('4) Bedrock no contesta y el respaldo del nodo dice «¡Listo! Mensaje enviado…» → la misma guarda', { skip: !s.listo }, async () => {
  enviados.length = 0;
  guion = () => ({ fallaBedrock: true });
  delNodo = '[EMO: feliz] ¡Listo! Mensaje enviado a Rosa por WhatsApp: "¿Cómo vamos?".';
  const r = await turno('Sí, envíelo.', { hablado: false });
  assert.doesNotMatch(r.reply, AFIRMA_ENVIO, r.reply);
  assert.match(r.reply, /Todav[ií]a no lo envi[eé]/);
  delNodo = '[EMO: neutral] Hola desde el nodo.';
});

test('3) con un borrador esperando su «sí», «enviado a … por WhatsApp» → espera en la tarjeta; no sale nada', { skip: !s.listo }, async () => {
  enviados.length = 0;
  // Un borrador real para Rosa (la herramienta, como lo pide el modelo).
  guion = (u) => {
    if (u.includes('BORRADOR DE WHATSAPP')) return { texto: '[EMO: neutral] Para Rosa Elena Mejía Paz: «¿Cómo vamos?». ¿Lo mando?' };
    if (u.includes('escríbele a Rosa Elena')) return { herramienta: { nombre: 'whatsapp', input: { accion: 'responder', chat: 'Rosa Elena Mejía Paz', texto: '¿Cómo vamos?' } } };
    return { texto: '[EMO: feliz] Listo, mensaje enviado a Rosa Elena Mejía Paz por WhatsApp. ¿Algo más?' };
  };
  const b = await turno('Okey, escríbele a Rosa Elena por WhatsApp que cómo vamos.');
  assert.match(b.reply, /Rosa/);
  // «¿Lo mandas por WhatsApp, verdad?»: una pregunta no aprueba nada; el modelo inventa que salió.
  const r = await turno('Lo envías, pero por WhatsApp, ¿verdad?');
  assert.equal(enviados.length, 0, 'una pregunta no manda');
  assert.doesNotMatch(r.reply, AFIRMA_ENVIO, r.reply);
  assert.match(r.reply, /Todav[ií]a no lo envi[eé]: el mensaje para .*Rosa.* tarjeta de confirmaci[oó]n/);
});

test('1) «¿Le escribo esto? "…"» sin herramienta → borrador de verdad; «Sí, enviarlo.» lo manda una vez, exacto', { skip: !s.listo }, async () => {
  enviados.length = 0;
  guion = (u) => {
    if (u.includes('BORRADOR DE WHATSAPP')) return { texto: '[EMO: neutral] Te dejé listo para Padrino: «Padrino, ¿qué tal todo?». ¿Lo mando?' };
    if (u.includes('WHATSAPP ENVIADO')) return { texto: '[EMO: feliz] Listo, mensaje enviado a Padrino.' };
    if (u.includes('Quiero escribirle a mi padrino')) return { texto: '[EMO: neutral] ¿Qué le querés decir?' };
    if (u.includes('Preguntarle qué tal todo')) return { texto: '[EMO: neutral] ¿Le escribo esto?\n\n*"Padrino, ¿qué tal todo?"*' };
    return { texto: '[EMO: neutral] Va.' };
  };
  await turno('Quiero escribirle a mi padrino.');
  const propuesta = await turno('Preguntarle qué tal todo.');
  // La tarjeta: un borrador de verdad para el chat resuelto, y nada salió todavía.
  assert.equal(enviados.length, 0, 'nada sale sin su «sí»');
  assert.match(propuesta.reply, /Padrino/);
  assert.doesNotMatch(propuesta.reply, AFIRMA_ENVIO);
  // Su «sí» (escrito, atado a lo último presentado): lo manda el servidor, una vez, con el texto exacto.
  const si = await turno('Sí, enviarlo.', { hablado: false });
  assert.equal(enviados.length, 1, `salió ${enviados.length} veces: ${si.reply}`);
  assert.equal(enviados[0].chat, '50488881111@s.whatsapp.net');
  assert.equal(enviados[0].texto, 'Padrino, ¿qué tal todo?');
  // Con el recibo del puente, decir «enviado» es verdad y queda.
  assert.match(si.reply, /enviado a Padrino/);
  // Y en el turno siguiente, si solo pregunta, lo que de verdad salió no se desmiente (el registro de efectos).
  guion = () => ({ texto: '[EMO: neutral] Sí, ya se lo mandé a Padrino.' });
  const pregunta = await turno('¿Ya se lo mandaste?');
  assert.match(pregunta.reply, /ya se lo mand[eé] a Padrino/);
  assert.equal(enviados.length, 1);
});

test('5) «a mi compadre» con dos chats «Compadre» → pregunta cuál; nunca elige sola ni deja borrador', { skip: !s.listo }, async () => {
  enviados.length = 0;
  let vioVarios = '';
  guion = (u) => {
    if (u.includes('chats que encajan')) {
      vioVarios = u;
      return { texto: '[EMO: neutral] ¿A cuál Compadre: a «Compadre» o a «Compadre Luis»?' };
    }
    if (u.includes('BORRADOR DE WHATSAPP')) return { texto: '[EMO: neutral] Listo el borrador. ¿Lo mando?' };
    if (u.includes('escríbele a mi compadre')) return { herramienta: { nombre: 'whatsapp', input: { accion: 'responder', chat: 'mi compadre', texto: '¿Qué tal todo?' } } };
    return { texto: '[EMO: neutral] Va.' };
  };
  const r = await turno('Okey, escríbele a mi compadre que qué tal todo.');
  assert.ok(vioVarios, `la herramienta no preguntó cuál: ${r.reply}`);
  assert.match(vioVarios, /Compadre Luis/);
  assert.match(r.reply, /cu[aá]l/i);
  // Un «sí» después no tiene nada que mandar.
  guion = () => ({ texto: '[EMO: neutral] ¿A cuál de los dos?' });
  await turno('Sí, enviarlo.', { hablado: false });
  assert.equal(enviados.length, 0);
});
