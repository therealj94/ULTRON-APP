/**
 * VOZ-02 (auditoría externa del 11-oct, P1): el oído del servidor no entrega cifras sin corroborar como si
 * estuvieran verificadas. Turbo oye «envía cien a Ana»; si la segunda escucha con Scribe v2 falla, no contesta a
 * tiempo, viene vacía o se corta la red, lo oído sale con `verificado: false`, el motivo y los campos dudosos
 * (monto, moneda, destinatario), y /api/stt lo lleva en la respuesta. Antes solo quedaba un aviso en el registro
 * («se usa la de Turbo») y el texto salía limpio. El WebSocket y fetch son de mentira.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { camposInciertosDe, necesitaCorroborar, transcribirAudio, verificacionParaCliente, type ProveedorOido } from '../lib/oido';
import { presupuesto, type Presupuesto } from '../lib/presupuesto';

function wav(muestras = 16000): Buffer {
  const datos = Buffer.alloc(muestras * 2, 7);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(16000, 12);
  fmt.writeUInt32LE(32000, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const cab = Buffer.alloc(8);
  cab.write('data', 0, 'ascii');
  cab.writeUInt32LE(datos.length, 4);
  const cuerpo = Buffer.concat([Buffer.from('WAVE', 'ascii'), fmt, cab, datos]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([riff, cuerpo]);
}

/** Lo que Turbo «oye» y cómo contesta la segunda escucha (Scribe v2 por lotes). */
let dichoTurbo = 'envía cien a Ana';
let lotes: 'bien' | 'error' | 'vacio' | 'red' | 'tiempo' | 'cuelga' = 'bien';
let textoLotes = 'Envía cien a Ana.';
let llamadasLotes = 0;

class WebSocketFalso {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  cerrado = false;
  constructor(_url: string, _opts: any) {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ message_type: 'session_started' }) }), 1);
  }
  send(s: string) {
    if (!JSON.parse(s).commit) return;
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ message_type: 'committed_transcript', text: dichoTurbo }) }), 1);
  }
  close() {
    if (this.cerrado) return;
    this.cerrado = true;
    setTimeout(() => this.onclose?.({ code: 1000 }), 1);
  }
}

const originales = { ws: (globalThis as any).WebSocket, fetch: globalThis.fetch, llave: process.env.ELEVENLABS_API_KEY };

beforeEach(() => {
  dichoTurbo = 'envía cien a Ana';
  lotes = 'bien';
  textoLotes = 'Envía cien a Ana.';
  llamadasLotes = 0;
  process.env.ELEVENLABS_API_KEY = 'prueba';
  (globalThis as any).WebSocket = WebSocketFalso;
  globalThis.fetch = (async (url: any, init?: any) => {
    assert.match(String(url), /\/v1\/speech-to-text$/);
    llamadasLotes++;
    if (lotes === 'red') throw new TypeError('fetch failed');
    if (lotes === 'tiempo') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    if (lotes === 'cuelga') {
      // No contesta: espera a que el presupuesto corte la llamada.
      return await new Promise<Response>((_, rechazar) => init?.signal?.addEventListener('abort', () => rechazar(init.signal.reason ?? new DOMException('abort', 'AbortError'))));
    }
    if (lotes === 'error') return new Response('caído', { status: 503 });
    const text = lotes === 'vacio' ? '' : textoLotes;
    return new Response(JSON.stringify({ text, language_code: 'es' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  (globalThis as any).WebSocket = originales.ws;
  globalThis.fetch = originales.fetch;
  if (originales.llave === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originales.llave;
});

const oir = (o: { presupuesto?: Presupuesto } = {}) => transcribirAudio({ audio: wav(), mime: 'audio/wav', language: 'es', ...o });

describe('VOZ-02: qué se vuelve a oír', () => {
  for (const f of ['envía cien a Ana', 'Envíale mil a Beto', 'manda quinientos a mi mamá', 'No le envíes cien a Ana', 'transfiere dos mil a Ana', 'send a hundred to Ana']) {
    it(`«${f}» se corrobora aunque Turbo no escriba cifras`, () => assert.equal(necesitaCorroborar(f), true));
  }
  for (const f of ['Mándale un mensaje a mi mamá', 'abre Excel', 'pon una alarma a las 5', 'mándame la foto', '¿Cuánto mide la Luna?']) {
    it(`«${f}» no (VOZ-05: sin dinero no se paga otra escucha)`, () => assert.equal(necesitaCorroborar(f), false));
  }
  it('los campos dudosos: monto, moneda y a quién', () => {
    assert.deepEqual(camposInciertosDe('envía cien a Ana'), ['monto', 'moneda', 'destinatario']);
    assert.deepEqual(camposInciertosDe('Págale 100 dólares a Beto'), ['monto', 'moneda', 'destinatario']);
    assert.deepEqual(camposInciertosDe('¿Cuánto tengo de saldo?'), []);
  });
});

describe('VOZ-02: la segunda escucha no corrobora → sin verificar', () => {
  const casos: { nombre: string; lotes: typeof lotes; motivo: string }[] = [
    { nombre: 'Scribe v2 falla (503)', lotes: 'error', motivo: 'corroboracion_fallida' },
    { nombre: 'se corta la red durante la corroboración', lotes: 'red', motivo: 'corroboracion_fallida' },
    { nombre: 'Scribe v2 no contesta a tiempo', lotes: 'tiempo', motivo: 'corroboracion_sin_respuesta' },
    { nombre: 'Scribe v2 contesta vacío', lotes: 'vacio', motivo: 'corroboracion_vacia' },
  ];
  for (const c of casos) {
    it(`«envía cien a Ana» y ${c.nombre}: verificado=false con motivo y campos; nada lo da por bueno`, async () => {
      lotes = c.lotes;
      const r = await oir();
      assert.equal(llamadasLotes, 1, 'se intentó corroborar');
      assert.equal(r.texto, 'envía cien a Ana', 'la frase no se pierde');
      assert.equal(r.verificado, false);
      assert.equal(r.motivo, c.motivo);
      assert.deepEqual(r.camposInciertos, ['monto', 'moneda', 'destinatario']);
      assert.equal(r.proveedor, 'elevenlabs:scribe-turbo');
      const http = verificacionParaCliente(r);
      assert.equal(http.verificado, false, '/api/stt lleva la marca');
      assert.equal(http.motivo, c.motivo);
      assert.deepEqual(http.camposInciertos, ['monto', 'moneda', 'destinatario']);
    });
  }

  it('la corroboración se cuelga hasta que corta el presupuesto: sin verificar', async () => {
    lotes = 'cuelga';
    // El corte del presupuesto no retiene el proceso (AbortSignal.timeout): este reloj lo mantiene vivo mientras espera.
    const vivo = setInterval(() => {}, 100);
    const r = await oir({ presupuesto: presupuesto(7000) }).finally(() => clearInterval(vivo));
    assert.equal(r.verificado, false);
    assert.equal(r.motivo, 'corroboracion_sin_respuesta');
  });

  it('variante «mil»: Envíale mil a Beto con Scribe v2 caído', async () => {
    dichoTurbo = 'Envíale mil a Beto';
    lotes = 'error';
    const r = await oir();
    assert.equal(r.verificado, false);
    assert.ok(r.camposInciertos?.includes('monto'));
  });

  it('negación: «No le envíes cien a Ana» sin corroborar sigue sin verificar (un «no» perdido es otra orden)', async () => {
    dichoTurbo = 'No le envíes cien a Ana';
    lotes = 'vacio';
    const r = await oir();
    assert.equal(r.texto, 'No le envíes cien a Ana');
    assert.equal(r.verificado, false);
  });

  it('sin tiempo para corroborar: tampoco cuenta como verificada', async () => {
    let llamadas = 0;
    const base = presupuesto(15_000);
    const casiSinTiempo: Presupuesto = { ...base, alcanza: () => llamadas++ < 1 };
    const r = await oir({ presupuesto: casiSinTiempo });
    assert.equal(llamadasLotes, 0);
    assert.equal(r.verificado, false);
    assert.equal(r.motivo, 'sin_tiempo');
  });

  it('un respaldo (Whisper o Gemini) que oyó dinero solo: sin corroborar', async () => {
    const gemini: ProveedorOido = { nombre: 'gemini', listo: () => true, oir: async () => ({ texto: 'Mándale mil lempiras a Ana', via: 'gemini:prueba' }) };
    const r = await transcribirAudio({ audio: wav(), mime: 'audio/wav', language: 'es', proveedores: [gemini] });
    assert.equal(r.verificado, false);
    assert.equal(r.motivo, 'sin_corroborar');
    assert.equal(r.proveedor, 'gemini:prueba');
  });
});

describe('VOZ-02: lo que sí queda verificado', () => {
  it('Scribe v2 corrobora: su texto, verificado', async () => {
    const r = await oir();
    assert.equal(r.texto, 'Envía cien a Ana.');
    assert.equal(r.via, 'elevenlabs:scribe-turbo+confirmado');
    assert.equal(r.verificado, true);
    assert.equal(r.motivo, undefined);
    assert.equal(r.camposInciertos, undefined);
    assert.deepEqual(verificacionParaCliente(r), { proveedor: 'elevenlabs:scribe-turbo+confirmado', verificado: true });
  });

  it('nombres parecidos: manda lo que oyó Scribe v2 («Anna»), no lo de Turbo', async () => {
    textoLotes = 'Envía cien a Anna.';
    const r = await oir();
    assert.equal(r.texto, 'Envía cien a Anna.');
    assert.equal(r.verificado, true);
  });

  it('negación que Turbo se comió y Scribe v2 oyó: sale la de Scribe v2', async () => {
    dichoTurbo = 'Envíes cien a Ana';
    textoLotes = 'No le envíes cien a Ana.';
    const r = await oir();
    assert.equal(r.texto, 'No le envíes cien a Ana.');
    assert.equal(r.verificado, true);
  });

  it('sin dinero no hay nada que verificar ni otra escucha', async () => {
    dichoTurbo = 'abre Excel';
    const r = await oir();
    assert.equal(llamadasLotes, 0);
    assert.equal(r.verificado, true);
    assert.equal(r.proveedor, 'elevenlabs:scribe-turbo');
  });

  it('Scribe v2 por lotes directo (m4a del teléfono) cuenta como la escucha buena', async () => {
    textoLotes = 'Envía cien lempiras a Ana.';
    const r = await transcribirAudio({ audio: Buffer.alloc(4000, 1), mime: 'audio/m4a', language: 'es' });
    assert.equal(r.via, 'elevenlabs:scribe');
    assert.equal(r.verificado, true);
  });
});
