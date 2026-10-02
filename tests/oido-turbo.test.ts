/**
 * Scribe v2 Realtime Turbo en el oído de AU-RA (José, 2-oct: «Turbo + confirmar dinero», «en todos menos
 * Dr Electrum»): solo para WAV PCM, lo de dinero se vuelve a oír con Scribe v2 y, si Turbo falla, sigue
 * Scribe v2 por lotes. El WebSocket y fetch son de mentira: aquí no sale nada a ElevenLabs.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { PROVEEDORES_OIDO, PROVEEDORES_OIDO_ELECTRUM, esFraseDeDinero, pcmDeWav, transcribirAudio } from '../lib/oido';

function wav(muestras: number, { frecuencia = 16000, canales = 1, bits = 16, tipo = 1, extra = false } = {}): Buffer {
  const datos = Buffer.alloc(muestras * canales * (bits / 8), 7);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(tipo, 8);
  fmt.writeUInt16LE(canales, 10);
  fmt.writeUInt32LE(frecuencia, 12);
  fmt.writeUInt32LE((frecuencia * canales * bits) / 8, 16);
  fmt.writeUInt16LE((canales * bits) / 8, 20);
  fmt.writeUInt16LE(bits, 22);
  // Un trozo LIST antes de los datos, como dejan algunas grabadoras: hay que saltarlo.
  const lista = extra ? Buffer.concat([Buffer.from('LIST', 'ascii'), Buffer.from([3, 0, 0, 0]), Buffer.from('abc\0', 'ascii')]) : Buffer.alloc(0);
  const cab = Buffer.alloc(8);
  cab.write('data', 0, 'ascii');
  cab.writeUInt32LE(datos.length, 4);
  const cuerpo = Buffer.concat([Buffer.from('WAVE', 'ascii'), fmt, lista, cab, datos]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([riff, cuerpo]);
}

/** Lo que el WebSocket de mentira contesta al commit, y lo que recibió. */
let dichoTurbo: string | null = 'abre Excel';
let turboRespondeError = false;
let urlsTurbo: string[] = [];
let trozos: any[] = [];
let llamadasLotes = 0;
let textoLotes = 'texto de lotes';

class WebSocketFalso {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  cerrado = false;
  constructor(url: string, opts: any) {
    urlsTurbo.push(url);
    assert.ok(opts?.headers?.['xi-api-key'], 'la llave va en la cabecera, no en la URL');
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ message_type: 'session_started' }) }), 1);
  }
  send(s: string) {
    const j = JSON.parse(s);
    trozos.push(j);
    if (!j.commit) return;
    setTimeout(() => {
      if (turboRespondeError) this.onmessage?.({ data: JSON.stringify({ message_type: 'quota_exceeded', error: 'sin saldo' }) });
      else if (dichoTurbo !== null) this.onmessage?.({ data: JSON.stringify({ message_type: 'committed_transcript', text: dichoTurbo }) });
    }, 1);
  }
  close() {
    if (this.cerrado) return;
    this.cerrado = true;
    setTimeout(() => this.onclose?.({ code: 1000 }), 1);
  }
}

const originales = { ws: (globalThis as any).WebSocket, fetch: globalThis.fetch, llave: process.env.ELEVENLABS_API_KEY, xi: process.env.XI_API_KEY };

beforeEach(() => {
  dichoTurbo = 'abre Excel';
  turboRespondeError = false;
  urlsTurbo = [];
  trozos = [];
  llamadasLotes = 0;
  textoLotes = 'texto de lotes';
  process.env.ELEVENLABS_API_KEY = 'prueba';
  (globalThis as any).WebSocket = WebSocketFalso;
  globalThis.fetch = (async (url: any) => {
    assert.match(String(url), /\/v1\/speech-to-text$/);
    llamadasLotes++;
    return new Response(JSON.stringify({ text: textoLotes, language_code: 'es' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  (globalThis as any).WebSocket = originales.ws;
  globalThis.fetch = originales.fetch;
  if (originales.llave === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originales.llave;
});

describe('Oído Turbo: el WAV', () => {
  it('saca las muestras del WAV de Windows (16 kHz mono 16 bits), saltando trozos extra', () => {
    const r = pcmDeWav(wav(1600, { extra: true }));
    assert.equal(r?.frecuencia, 16000);
    assert.equal(r?.pcm.length, 3200);
  });

  it('no acepta lo que el tiempo real no entiende', () => {
    assert.equal(pcmDeWav(wav(1600, { canales: 2 })), null, 'estéreo');
    assert.equal(pcmDeWav(wav(1600, { bits: 8 })), null, '8 bits');
    assert.equal(pcmDeWav(wav(1600, { tipo: 3, bits: 32 })), null, 'flotante');
    assert.equal(pcmDeWav(wav(1600, { frecuencia: 11025 })), null, 'frecuencia rara');
    assert.equal(pcmDeWav(Buffer.from('ftypM4A esto es un m4a del teléfono, no un wav'.padEnd(80))), null, 'm4a');
  });
});

describe('Oído Turbo: frases de dinero', () => {
  for (const f of ['Págale cien lempiras a Ana', 'envíale 5 ORIGEN a mi mamá', 'Mándale plata a Beto', 'transfiere 20 dólares', '¿Cuánto tengo en la cartera?', 'manda 3 AUKA', 'paga la luz', 'Send 10 USD', 'Remind me to pay the Orden Global invoice']) {
    it(`«${f}» se confirma`, () => assert.equal(esFraseDeDinero(f), true));
  }
  for (const f of ['abre Excel', 'pon The Verve en Spotify', 'apaga la música', 'abre la página de noticias', 'recuérdame llamar a mi hermana']) {
    it(`«${f}» no`, () => assert.equal(esFraseDeDinero(f), false));
  }
});

describe('Oído Turbo: la cadena', () => {
  it('AU-RA tiene Turbo primero y Dr Electrum no lo tiene', () => {
    assert.equal(PROVEEDORES_OIDO[0].nombre, 'elevenlabs-turbo');
    assert.equal(PROVEEDORES_OIDO[1].nombre, 'elevenlabs');
    assert.ok(!PROVEEDORES_OIDO_ELECTRUM.some((p) => /turbo/.test(p.nombre)), 'Electrum sigue sin Turbo');
  });

  it('un WAV va por Turbo, con el modelo, el formato, el idioma y las pistas de AU-RA', async () => {
    const r = await transcribirAudio({ audio: wav(16000), mime: 'audio/wav', language: 'es' });
    assert.equal(r.texto, 'abre Excel');
    assert.equal(r.via, 'elevenlabs:scribe-turbo');
    assert.equal(llamadasLotes, 0, 'sin dinero no se paga una segunda transcripción');
    const u = new URL(urlsTurbo[0]);
    assert.equal(u.searchParams.get('model_id'), 'scribe_v2_realtime_turbo');
    assert.equal(u.searchParams.get('audio_format'), 'pcm_16000');
    assert.equal(u.searchParams.get('language_code'), 'es');
    assert.equal(u.searchParams.get('commit_strategy'), 'manual');
    assert.ok(u.searchParams.getAll('keyterms').includes('Veta Wallet'));
    assert.ok(!u.searchParams.has('xi-api-key'));
    assert.equal(trozos.filter((t) => t.commit).length, 1, 'un solo commit, en el último trozo');
    assert.equal(trozos.at(-1).commit, true);
    assert.equal(Buffer.concat(trozos.map((t) => Buffer.from(t.audio_base_64, 'base64'))).length, 32000, 'todo el audio llega');
  });

  it('si Turbo oye dinero, manda lo que oye Scribe v2', async () => {
    dichoTurbo = 'págale 100 dólares a Ana';
    textoLotes = 'Págale cien lempiras a Ana.';
    const r = await transcribirAudio({ audio: wav(16000), mime: 'audio/wav', language: 'es' });
    assert.equal(llamadasLotes, 1);
    assert.equal(r.texto, 'Págale cien lempiras a Ana.');
    assert.equal(r.via, 'elevenlabs:scribe-turbo+confirmado');
  });

  it('si Turbo falla, Scribe v2 por lotes contesta', async () => {
    turboRespondeError = true;
    const r = await transcribirAudio({ audio: wav(16000), mime: 'audio/wav', language: 'es' });
    assert.equal(r.texto, 'texto de lotes');
    assert.equal(r.via, 'elevenlabs:scribe');
  });

  it('el m4a del teléfono no toca Turbo', async () => {
    const r = await transcribirAudio({ audio: Buffer.alloc(4000, 1), mime: 'audio/m4a', language: 'es' });
    assert.equal(urlsTurbo.length, 0);
    assert.equal(r.via, 'elevenlabs:scribe');
  });

  it('Dr Electrum con WAV sigue por Scribe v2 por lotes', async () => {
    const r = await transcribirAudio({ audio: wav(16000), mime: 'audio/wav', language: 'es', plataforma: 'electrum' });
    assert.equal(urlsTurbo.length, 0);
    assert.equal(r.via, 'elevenlabs:scribe');
  });

  it('Turbo sin voz es silencio, no un fallo: no se cobra otra transcripción', async () => {
    dichoTurbo = '';
    const r = await transcribirAudio({ audio: wav(16000), mime: 'audio/wav', language: 'es' });
    assert.equal(r.texto, '');
    assert.equal(llamadasLotes, 0);
  });
});

describe('Oído Turbo: limpieza', () => {
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = 'prueba';
    (globalThis as any).WebSocket = WebSocketFalso;
  });
  it('quita las comillas con que Turbo a veces envuelve la frase', async () => {
    dichoTurbo = '"Open Chrome and search YouTube".';
    const r = await transcribirAudio({ audio: wav(16000), mime: 'audio/wav', language: 'en' });
    assert.equal(r.texto, 'Open Chrome and search YouTube');
  });
});
