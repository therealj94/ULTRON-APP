/**
 * Solo pruebas (tests/taller-aprobacion.test.ts): se carga con `--import` en el proceso del servidor de verdad y espía
 * su `fetch` hacia los canales externos (Telegram, Twilio, Resend). Cada salida queda como una línea en
 * ESPIA_CANALES_ARCHIVO y contesta como el canal (aceptado), sin tocar la red. Lo demás pasa tal cual.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const archivo = process.env.ESPIA_CANALES_ARCHIVO;
const real = globalThis.fetch;
const CANALES = /^https:\/\/(api\.telegram\.org|api\.twilio\.com|api\.resend\.com)\//;

globalThis.fetch = async (u, init) => {
  const url = String(u?.url || u);
  if (archivo && CANALES.test(url)) {
    let cuerpo = '';
    if (typeof init?.body === 'string') cuerpo = init.body.slice(0, 400);
    else if (init?.body instanceof URLSearchParams) cuerpo = init.body.toString().slice(0, 400);
    // Una foto o un PDF (FormData): a qué chat iba y el sha256 de lo que llevaba, sin copiar los bytes.
    else if (init?.body instanceof FormData) {
      const partes = [];
      for (const [k, v] of init.body.entries()) {
        if (typeof v === 'string') partes.push(`${k}=${v.slice(0, 120)}`);
        else partes.push(`${k}=sha256:${crypto.createHash('sha256').update(Buffer.from(await v.arrayBuffer())).digest('hex')}`);
      }
      cuerpo = partes.join('&').slice(0, 400);
    }
    fs.appendFileSync(archivo, JSON.stringify({ url: url.replace(/bot[^/]+/, 'bot***'), cuerpo, t: Date.now() }) + '\n');
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 }, sid: 'SM_PRUEBA', id: 'r_prueba' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return real(u, init);
};
