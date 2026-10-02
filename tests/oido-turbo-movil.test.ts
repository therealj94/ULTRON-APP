/**
 * El oído Turbo del teléfono (mobile/src/lib/turboMotor.ts y turboLogica.ts): micrófono, reloj,
 * WebSocket y servidor de mentira. Lo que se prueba es lo que siente la persona: que la frase llegue,
 * entera, en cuanto calla; que lo de dinero se confirme; que nunca se pierda aunque falle la red.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FRASE_DE_DINERO as DINERO_SERVIDOR, pcmDeWav } from '../lib/oido';
import {
  FRASE_DE_DINERO,
  SILENCIO_BASE_MS,
  SILENCIO_CORTO_MS,
  SILENCIO_LARGO_MS,
  aBase64,
  deBase64,
  esFraseDeDinero,
  limpiarFinal,
  silencioParaCerrar,
  wavDeTrozos,
} from '../mobile/src/lib/turboLogica';
import { MotorTurbo, type TrozoAudio, type WsTurbo } from '../mobile/src/lib/turboMotor';

const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('Oído Turbo (teléfono): lógica', () => {
  it('la expresión de dinero es la misma que la del servidor', () => {
    assert.equal(FRASE_DE_DINERO.source, DINERO_SERVIDOR.source);
    assert.equal(esFraseDeDinero('Mándale cinco origen a Ana'), true);
    assert.equal(esFraseDeDinero('abre Spotify'), false);
  });

  it('cierra rápido si terminó la idea y espera si se quedó a medias', () => {
    assert.equal(silencioParaCerrar('¿Qué hora es?'), SILENCIO_CORTO_MS);
    assert.equal(silencioParaCerrar('abre Excel'), SILENCIO_BASE_MS);
    assert.equal(silencioParaCerrar('ponme música y'), SILENCIO_LARGO_MS);
    assert.equal(silencioParaCerrar('mándale un mensaje a'), SILENCIO_LARGO_MS);
    assert.equal(silencioParaCerrar('busca el correo de,'), SILENCIO_LARGO_MS);
    assert.equal(silencioParaCerrar('revisa mi-'), SILENCIO_LARGO_MS);
    assert.ok(silencioParaCerrar('') > SILENCIO_BASE_MS, 'sin texto todavía espera un poco más');
  });

  it('base64 a mano igual que Buffer, y el WAV lo lee el servidor tal cual', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 320, 3200, 3201]) {
      const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255));
      assert.equal(aBase64(new Uint8Array(b)), b.toString('base64'), `codificar ${n}`);
      assert.deepEqual(Buffer.from(deBase64(b.toString('base64'))), b, `decodificar ${n}`);
    }
    const t1 = Buffer.alloc(3200, 1).toString('base64');
    const t2 = Buffer.alloc(3200, 2).toString('base64');
    const wav = Buffer.from(wavDeTrozos([t1, t2]), 'base64');
    const leido = pcmDeWav(wav);
    assert.equal(leido?.frecuencia, 16000);
    assert.equal(leido?.pcm.length, 6400);
    assert.equal(leido?.pcm[0], 1);
    assert.equal(leido?.pcm[6399], 2);
  });

  it('limpia comillas y basura', () => {
    assert.equal(limpiarFinal('"Open Chrome".'), 'Open Chrome');
    assert.equal(limpiarFinal('Gracias por ver el video'), '');
    assert.equal(limpiarFinal('a'), '');
  });
});

// ── el motor con todo de mentira ─────────────────────────────────────────────────────────────────
class WsFalso implements WsTurbo {
  readyState = 0;
  enviados: any[] = [];
  cerrado = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  onclose: ((e?: any) => void) | null = null;
  constructor(public url: string) {}
  abrir() {
    this.readyState = 1;
    this.onopen?.();
    this.decir({ message_type: 'session_started' });
  }
  decir(j: object) {
    this.onmessage?.({ data: JSON.stringify(j) });
  }
  send(d: string) {
    this.enviados.push(JSON.parse(d));
  }
  close() {
    this.cerrado = true;
    this.readyState = 3;
  }
  caer() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
  get commits() {
    return this.enviados.filter((m) => m.commit).length;
  }
}

function banco(opts: { permiso?: boolean; abreWs?: boolean; mic?: 'bien' | 'falla'; confirmado?: string; respaldo?: string } = {}) {
  let reloj = 1_000_000;
  const ws: WsFalso[] = [];
  const llamadasWav: { wav: string; confirmar: boolean }[] = [];
  const finales: string[] = [];
  const parciales: string[] = [];
  const eventos: string[] = [];
  let alTrozo: ((t: TrozoAudio) => void) | null = null;
  let micAbierto = false;
  let permisos = 0;
  const motor = new MotorTurbo({
    ahora: () => reloj,
    abrirMic: async (cb) => {
      if (opts.mic === 'falla') return null;
      alTrozo = cb;
      micAbierto = true;
      return () => {
        micAbierto = false;
        alTrozo = null;
      };
    },
    permiso: async () => {
      permisos++;
      return opts.permiso === false ? null : { url: `wss://falso/${permisos}` };
    },
    crearWs: (url) => {
      const w = new WsFalso(url);
      ws.push(w);
      if (opts.abreWs !== false) setTimeout(() => w.abrir(), 1);
      return w;
    },
    transcribirWav: async (wav, confirmar) => {
      llamadasWav.push({ wav, confirmar });
      return confirmar ? (opts.confirmado ?? '') : (opts.respaldo ?? 'texto del respaldo');
    },
    tiempos: { esperaFinalMs: 60, confirmarMs: 200, inactivoMs: 10_000 },
  });
  motor.setCallbacks({
    onFinal: (t) => finales.push(t),
    onPartial: (t) => parciales.push(t),
    onSpeechStart: () => eventos.push('voz'),
    onUnavailable: (m) => eventos.push(`no:${m}`),
    onListeningChange: (on) => eventos.push(on ? 'oye' : 'no-oye'),
  });
  /** Un trozo de 0,1 s: voz (-20 dBFS) o silencio (-75). Cada trozo trae su número en los bytes. */
  let n = 0;
  const trozo = (voz: boolean) => {
    reloj += 100;
    n++;
    alTrozo?.({ audio: Buffer.alloc(3200, n & 255).toString('base64'), db: voz ? -20 : -75 });
  };
  const silencio = (k: number) => {
    for (let i = 0; i < k; i++) trozo(false);
  };
  const voz = (k: number) => {
    for (let i = 0; i < k; i++) trozo(true);
  };
  return { motor, ws, llamadasWav, finales, parciales, eventos, trozo, silencio, voz, abierto: () => micAbierto, permisos: () => permisos, avanzar: (ms: number) => (reloj += ms) };
}

describe('Oído Turbo (teléfono): el motor', () => {
  it('frase normal: guarda lo de antes de la voz, la manda en vivo y entrega la frase al cerrar', async () => {
    const b = banco();
    b.motor.activar();
    await espera();
    assert.ok(b.abierto());
    b.silencio(10);
    b.voz(12);
    await espera();
    assert.deepEqual(b.eventos.filter((e) => e === 'voz'), ['voz']);
    assert.equal(b.ws.length, 1, 'un WebSocket con el token del servidor');
    const w = b.ws[0];
    assert.match(w.url, /^wss:\/\/falso\//);
    w.decir({ message_type: 'partial_transcript', text: 'abre' });
    w.decir({ message_type: 'partial_transcript', text: 'abre Excel' });
    assert.deepEqual(b.parciales, ['abre', 'abre Excel']);
    // Se manda lo de antes de la voz (0,6 s) + toda la voz.
    assert.equal(w.enviados.length, 6 + 12);
    b.silencio(4);
    assert.equal(w.commits, 0, 'a los 0,4 s de silencio todavía no cierra');
    b.silencio(1);
    assert.equal(w.commits, 1, 'a los 0,5 s cierra (terminó en una palabra completa)');
    assert.equal(w.enviados.at(-1).commit, true);
    w.decir({ message_type: 'committed_transcript', text: 'Abre Excel.' });
    await espera();
    assert.deepEqual(b.finales, ['Abre Excel.']);
    assert.equal(b.llamadasWav.length, 0, 'sin dinero no se paga otra transcripción');
  });

  it('frase de dinero: se confirma con Scribe v2 con el audio entero de la frase', async () => {
    const b = banco({ confirmado: 'Págale cien lempiras a Ana.' });
    b.motor.activar();
    await espera();
    b.silencio(8);
    b.voz(15);
    await espera();
    b.silencio(8);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Págale 100 dólares a Ana.' });
    await espera(20);
    assert.deepEqual(b.finales, ['Págale cien lempiras a Ana.']);
    assert.equal(b.llamadasWav.length, 1);
    assert.equal(b.llamadasWav[0].confirmar, true);
    const pcm = pcmDeWav(Buffer.from(b.llamadasWav[0].wav, 'base64'))!.pcm;
    // 6 de antes + 15 de voz + los de silencio hasta el cierre (sin parcial, 0,65 s: 7), de 3200 bytes cada uno.
    assert.equal(pcm.length, (6 + 15 + 7) * 3200);
  });

  it('si Scribe v2 no confirma a tiempo, va lo que oyó Turbo', async () => {
    const b = banco({ confirmado: '' });
    b.motor.activar();
    await espera();
    b.voz(10);
    await espera();
    b.silencio(8);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Mándale 5 ORIGEN a Ana' });
    await espera(20);
    assert.deepEqual(b.finales, ['Mándale 5 ORIGEN a Ana']);
  });

  it('se quedó en «y»: espera a que siga y no corta la frase', async () => {
    const b = banco();
    b.motor.activar();
    await espera();
    b.voz(10);
    await espera();
    b.ws[0].decir({ message_type: 'partial_transcript', text: 'ponme música y' });
    b.silencio(7);
    assert.equal(b.ws[0].commits, 0, 'a los 0,7 s no cierra: la frase sigue');
    b.voz(5);
    b.ws[0].decir({ message_type: 'partial_transcript', text: 'ponme música y baja las luces' });
    b.silencio(5);
    assert.equal(b.ws[0].commits, 1);
  });

  it('un golpe corto sin texto no es una frase', async () => {
    const b = banco();
    b.motor.activar();
    await espera();
    b.silencio(5);
    b.voz(1);
    await espera();
    b.silencio(8);
    assert.equal(b.ws[0].commits, 0);
    assert.equal(b.finales.length, 0);
  });

  it('un «sí» cortito con texto de Turbo sí cuenta', async () => {
    const b = banco();
    b.motor.activar();
    await espera();
    b.voz(1);
    await espera();
    b.ws[0].decir({ message_type: 'partial_transcript', text: 'Sí.' });
    b.silencio(4);
    assert.equal(b.ws[0].commits, 1);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Sí.' });
    await espera();
    assert.deepEqual(b.finales, ['Sí.']);
  });

  it('sin permiso del servidor la frase igual llega, entera, por /api/stt', async () => {
    const b = banco({ permiso: false, respaldo: 'Abre Excel' });
    b.motor.activar();
    await espera();
    b.silencio(3);
    b.voz(8);
    await espera();
    b.silencio(8);
    await espera(20);
    assert.equal(b.ws.length, 0);
    assert.deepEqual(b.finales, ['Abre Excel']);
    assert.equal(b.llamadasWav[0].confirmar, false);
  });

  it('si Turbo no contesta a tiempo, la frase va por /api/stt y esa conexión se cierra', async () => {
    const b = banco({ respaldo: 'Abre Excel' });
    b.motor.activar();
    await espera();
    b.voz(8);
    await espera();
    b.silencio(8);
    await espera(120);
    assert.deepEqual(b.finales, ['Abre Excel']);
    assert.equal(b.ws[0].cerrado, true);
  });

  it('se cae el WebSocket a media frase: reconecta y vuelve a mandar todo lo que iba', async () => {
    const b = banco();
    b.motor.activar();
    await espera();
    b.voz(6);
    await espera();
    b.ws[0].caer();
    await espera();
    assert.equal(b.ws.length, 2, 'otra conexión con otro token');
    b.voz(4);
    const reenviados = b.ws[1].enviados.length;
    assert.equal(reenviados, 6 + 4, 'reenvió los 6 trozos que iban de la frase y siguió con los nuevos');
    b.silencio(8);
    b.ws[1].decir({ message_type: 'committed_transcript', text: 'Abre WhatsApp' });
    await espera();
    assert.deepEqual(b.finales, ['Abre WhatsApp']);
  });

  it('tres fallos seguidos del en vivo: un rato solo por /api/stt (sin pedir más tokens)', async () => {
    const b = banco({ abreWs: false, respaldo: 'hola' });
    b.motor.activar();
    await espera();
    for (let i = 0; i < 3; i++) {
      b.voz(5);
      await espera();
      b.ws.at(-1)!.caer();
      b.silencio(8);
      await espera(10);
    }
    const ws = b.ws.length;
    const permisos = b.permisos();
    b.voz(5);
    await espera();
    b.silencio(8);
    await espera(20);
    assert.equal(b.ws.length, ws, 'no abre otro WebSocket');
    assert.equal(b.permisos(), permisos, 'no pide otro token');
    assert.ok(b.finales.includes('hola'));
  });

  it('mientras habla AU-RA el micrófono se cierra y la frase a medias se olvida', async () => {
    const b = banco();
    b.motor.activar();
    await espera();
    b.voz(6);
    await espera();
    b.motor.pausar(true);
    assert.equal(b.abierto(), false);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'eco de su propia voz' });
    await espera();
    assert.deepEqual(b.finales, []);
    b.motor.pausar(false);
    await espera();
    assert.equal(b.abierto(), true);
  });

  it('el micrófono crudo no abre: avisa para volver al reconocedor del teléfono', async () => {
    const b = banco({ mic: 'falla' });
    b.motor.activar();
    await espera(1600);
    assert.ok(b.eventos.some((e) => e.startsWith('no:')));
  });

  it('silenciar cierra todo', async () => {
    const b = banco();
    b.motor.activar();
    await espera();
    b.voz(6);
    await espera();
    b.motor.silenciar();
    assert.equal(b.abierto(), false);
    assert.equal(b.ws[0].cerrado, true);
    assert.equal(b.motor.escuchando(), false);
  });
});

// ── el dictado de campo de Dr Electrum (apretar, hablar, soltar) ────────────────────────────────
import { dictarTurbo } from '../mobile/src/lib/turboDictado';

function bancoDictado(opts: { permiso?: boolean; confirmado?: string; respaldo?: string; mic?: boolean } = {}) {
  const ws: WsFalso[] = [];
  const wavs: { wav: string; confirmar: boolean }[] = [];
  const finales: string[] = [];
  const parciales: string[] = [];
  let fines = 0;
  let alTrozo: ((t: TrozoAudio) => void) | null = null;
  let abierto = false;
  const deps = {
    abrirMic: async (cb: (t: TrozoAudio) => void) => {
      if (opts.mic === false) return null;
      alTrozo = cb;
      abierto = true;
      return () => {
        abierto = false;
        alTrozo = null;
      };
    },
    permiso: async () => (opts.permiso === false ? null : { url: 'wss://falso/electrum' }),
    crearWs: (url: string) => {
      const w = new WsFalso(url);
      ws.push(w);
      setTimeout(() => w.abrir(), 1);
      return w;
    },
    transcribirWav: async (wav: string, confirmar: boolean) => {
      wavs.push({ wav, confirmar });
      return confirmar ? (opts.confirmado ?? '') : (opts.respaldo ?? 'lo del respaldo');
    },
    esperaFinalMs: 60,
    confirmarMs: 200,
  };
  const cb = { onFinal: (t: string) => finales.push(t), onParcial: (t: string) => parciales.push(t), onFin: () => fines++ };
  const hablar = (k: number) => {
    for (let i = 0; i < k; i++) alTrozo?.({ audio: Buffer.alloc(3200, i + 1).toString('base64'), db: -20 });
  };
  return { deps, cb, ws, wavs, finales, parciales, fines: () => fines, hablar, abierto: () => abierto };
}

describe('Oído Turbo (teléfono): dictado de campo de Dr Electrum', () => {
  it('lo dicho va en vivo, los parciales caen en la caja y al soltar llega el texto final', async () => {
    const b = bancoDictado();
    const c = await dictarTurbo(b.deps, b.cb);
    assert.ok(c);
    b.hablar(8);
    await espera();
    assert.equal(b.ws[0].enviados.length, 8, 'lo dicho antes de conectar esperó en la cola');
    b.ws[0].decir({ message_type: 'partial_transcript', text: 'muéstrame la concesión' });
    assert.deepEqual(b.parciales, ['muéstrame la concesión']);
    c!.parar();
    assert.equal(b.abierto(), false, 'al soltar se cierra el micrófono');
    await espera();
    assert.equal(b.ws[0].commits, 1);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Muéstrame la concesión Quebrada Seca.' });
    await espera();
    assert.deepEqual(b.finales, ['Muéstrame la concesión Quebrada Seca.']);
    assert.equal(b.fines(), 1);
    assert.equal(b.wavs.length, 0);
  });

  it('con cifras se confirma con Scribe v2', async () => {
    const b = bancoDictado({ confirmado: '¿Qué traslapes tiene Concordia seis?' });
    const c = await dictarTurbo(b.deps, b.cb);
    b.hablar(10);
    await espera();
    c!.parar();
    await espera();
    b.ws[0].decir({ message_type: 'committed_transcript', text: '¿Qué traslapes tiene Concordia 6?' });
    await espera(20);
    assert.deepEqual(b.finales, ['¿Qué traslapes tiene Concordia seis?']);
    assert.equal(b.wavs[0].confirmar, true);
    assert.equal(pcmDeWav(Buffer.from(b.wavs[0].wav, 'base64'))!.pcm.length, 10 * 3200, 'la grabación entera');
  });

  it('sin token del servidor, la grabación entera va por /api/electrum/oir', async () => {
    const b = bancoDictado({ permiso: false, respaldo: 'Revisa el expediente' });
    const c = await dictarTurbo(b.deps, b.cb);
    b.hablar(10);
    await espera();
    c!.parar();
    await espera(20);
    assert.equal(b.ws.length, 0);
    assert.deepEqual(b.finales, ['Revisa el expediente']);
    assert.equal(b.wavs[0].confirmar, false);
  });

  it('Turbo no contesta al soltar: va por el servidor', async () => {
    const b = bancoDictado({ respaldo: 'Revisa el expediente' });
    const c = await dictarTurbo(b.deps, b.cb);
    b.hablar(10);
    await espera();
    c!.parar();
    await espera(120);
    assert.deepEqual(b.finales, ['Revisa el expediente']);
  });

  it('cancelar tira lo dicho; un toque sin hablar no manda nada', async () => {
    const b = bancoDictado();
    const c = await dictarTurbo(b.deps, b.cb);
    b.hablar(10);
    await espera();
    c!.cancelar();
    await espera(20);
    assert.deepEqual(b.finales, []);
    assert.equal(b.fines(), 1);
    const b2 = bancoDictado();
    const c2 = await dictarTurbo(b2.deps, b2.cb);
    b2.hablar(1);
    c2!.parar();
    await espera(20);
    assert.deepEqual(b2.finales, []);
    assert.equal(b2.wavs.length, 0);
    assert.equal(b2.fines(), 1);
  });

  it('sin micrófono crudo devuelve null (sigue el reconocedor del teléfono)', async () => {
    const b = bancoDictado({ mic: false });
    assert.equal(await dictarTurbo(b.deps, b.cb), null);
  });
});
