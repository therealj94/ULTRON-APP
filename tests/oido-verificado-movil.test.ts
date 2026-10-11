/**
 * VOZ-02 (auditoría externa del 11-oct, P1) en el teléfono (mobile/src/lib/turboMotor.ts): el respaldo por /api/stt
 * entregaba la frase tal cual llegaba, aunque el servidor no hubiera podido corroborar el monto o a quién. Ahora la
 * marca del servidor (`verificado: false`) sale igual que en el camino normal: `fraseSinVerificar`, que pide confirmar
 * monto y destinatario antes de hacer nada. Y una «confirmación» que el servidor marca sin verificar (la dio un
 * respaldo, no Scribe v2) tampoco corrobora. Micrófono, reloj, WebSocket y servidor de mentira.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENVIO_CON_CANTIDAD as ENVIO_SERVIDOR } from '../lib/oido';
import { fraseSinVerificar } from '../mobile/src/lib/turboLogica';
import { ENVIO_CON_CANTIDAD, MotorTurbo, oidoDelServidor, textoConMarca, type OidoServidor, type TrozoAudio, type WsTurbo } from '../mobile/src/lib/turboMotor';

const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));

class WsFalso implements WsTurbo {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  onclose: ((e?: any) => void) | null = null;
  abrir() {
    this.readyState = 1;
    this.onopen?.();
    this.decir({ message_type: 'session_started' });
  }
  decir(j: object) {
    this.onmessage?.({ data: JSON.stringify(j) });
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}

type Respuesta = string | OidoServidor | Error;

function banco(o: { permiso?: boolean; respaldo?: Respuesta; confirmado?: Respuesta; segunda?: { confirmar(t: string): boolean; sinCorroborar?(t: string): string } }) {
  let reloj = 1_000_000;
  const ws: WsFalso[] = [];
  const finales: string[] = [];
  const vias: string[] = [];
  const llamadas: boolean[] = [];
  let alTrozo: ((t: TrozoAudio) => void) | null = null;
  const motor = new MotorTurbo({
    ahora: () => reloj,
    abrirMic: async (cb) => {
      alTrozo = cb;
      return () => {
        alTrozo = null;
      };
    },
    permiso: async () => (o.permiso === false ? null : { url: 'wss://falso/1' }),
    crearWs: () => {
      const w = new WsFalso();
      ws.push(w);
      setTimeout(() => w.abrir(), 1);
      return w;
    },
    transcribirWav: async (_wav, confirmar) => {
      llamadas.push(confirmar);
      const r = confirmar ? o.confirmado ?? '' : o.respaldo ?? '';
      if (r instanceof Error) throw r;
      return r;
    },
    tiempos: { esperaFinalMs: 60, confirmarMs: 200, inactivoMs: 10_000, sondeoMs: 0 },
    ...(o.segunda ? { segundaEscucha: o.segunda } : {}),
  });
  motor.setCallbacks({ onFinal: (t) => finales.push(t), onMedida: (m) => vias.push(m.via) });
  const trozo = (voz: boolean) => {
    reloj += 100;
    alTrozo?.({ audio: Buffer.alloc(3200, 3).toString('base64'), db: voz ? -20 : -75 });
  };
  /** Una frase entera: activar, hablar, callar. Con el en vivo, Turbo entrega `turbo` al cerrar. */
  const frase = async (turbo?: string) => {
    motor.activar();
    await espera();
    for (let i = 0; i < 3; i++) trozo(false);
    for (let i = 0; i < 10; i++) trozo(true);
    await espera();
    for (let i = 0; i < 8; i++) trozo(false);
    if (turbo !== undefined) ws[0].decir({ message_type: 'committed_transcript', text: turbo });
    await espera(30);
  };
  return { motor, finales, vias, llamadas, frase };
}

describe('VOZ-02 (teléfono): la respuesta del servidor', () => {
  it('la expresión de envío con cantidad es la misma que la del servidor', () => {
    assert.equal(ENVIO_CON_CANTIDAD.source, ENVIO_SERVIDOR.source);
  });

  it('lee la marca de /api/stt; sin marca (servidor anterior), `verificado` queda sin decir', () => {
    assert.deepEqual(oidoDelServidor({ text: ' Envía cien a Ana ', verificado: false, motivo: 'corroboracion_fallida', camposInciertos: ['monto', 'x'] }), {
      texto: 'Envía cien a Ana',
      verificado: false,
      motivo: 'corroboracion_fallida',
      camposInciertos: ['monto'],
    });
    assert.deepEqual(oidoDelServidor({ text: 'abre Excel' }), { texto: 'abre Excel' });
    assert.deepEqual(oidoDelServidor(null), { texto: '' });
  });

  it('textoConMarca: sin verificar y con monto o destinatario → fraseSinVerificar; si no, tal cual', () => {
    assert.equal(textoConMarca({ texto: 'Envía cien a Ana', verificado: false }), fraseSinVerificar('Envía cien a Ana'));
    assert.equal(textoConMarca({ texto: 'Envía cien a Ana', verificado: true }), 'Envía cien a Ana');
    assert.equal(textoConMarca({ texto: '¿Cuánto tengo de saldo?', verificado: false }), '¿Cuánto tengo de saldo?');
    // Sin marca (servidor anterior, o un oído que no la lleva, como el de Dr Electrum): lo de siempre.
    assert.equal(textoConMarca({ texto: 'Mándale 5 ORIGEN a Ana' }), 'Mándale 5 ORIGEN a Ana');
    assert.equal(textoConMarca({ texto: 'abre Excel' }), 'abre Excel');
  });
});

describe('VOZ-02 (teléfono): el respaldo por /api/stt', () => {
  for (const motivo of ['corroboracion_fallida', 'corroboracion_sin_respuesta', 'corroboracion_vacia']) {
    it(`«Envía cien a Ana» sin verificar (${motivo}): sale pidiendo confirmar, nunca como orden`, async () => {
      const b = banco({ permiso: false, respaldo: { texto: 'Envía cien a Ana', verificado: false, motivo, camposInciertos: ['monto', 'moneda', 'destinatario'] } });
      await b.frase();
      assert.deepEqual(b.llamadas, [false]);
      assert.deepEqual(b.finales, [fraseSinVerificar('Envía cien a Ana')]);
      assert.deepEqual(b.vias, ['respaldo']);
    });
  }

  it('variantes «mil», negación y nombre parecido: todas pidiendo confirmar', async () => {
    for (const t of ['Envíale mil a Beto', 'No le envíes cien a Ana', 'Mándale cien a Anna']) {
      const b = banco({ permiso: false, respaldo: { texto: t, verificado: false, motivo: 'corroboracion_fallida' } });
      await b.frase();
      assert.deepEqual(b.finales, [fraseSinVerificar(t)], t);
    }
  });

  it('verificado por el servidor: tal cual', async () => {
    const b = banco({ permiso: false, respaldo: { texto: 'Envía cien lempiras a Ana.', verificado: true } });
    await b.frase();
    assert.deepEqual(b.finales, ['Envía cien lempiras a Ana.']);
  });

  it('un oído que solo devuelve texto (servidor anterior, Dr Electrum): como siempre, sin inventar una marca', async () => {
    const b = banco({ permiso: false, respaldo: 'Mándale 5 ORIGEN a Ana' });
    await b.frase();
    assert.deepEqual(b.finales, ['Mándale 5 ORIGEN a Ana']);
  });

  it('servidor anterior con una frase sin dinero: tal cual', async () => {
    const b = banco({ permiso: false, respaldo: 'Abre Excel' });
    await b.frase();
    assert.deepEqual(b.finales, ['Abre Excel']);
  });

  it('se corta la red en el respaldo: no sale nada (ninguna orden sin oír)', async () => {
    const b = banco({ permiso: false, respaldo: new Error('Network request failed') });
    await b.frase();
    assert.deepEqual(b.finales, []);
  });

  it('Dr Electrum: lo sin verificar sigue su propia regla (sinCorroborar), igual que en el camino normal', async () => {
    const b = banco({ permiso: false, respaldo: { texto: 'La veta 12 en Olancho', verificado: false }, segunda: { confirmar: (t) => /\d/.test(t), sinCorroborar: (t) => `${t} (?)` } });
    await b.frase();
    assert.deepEqual(b.finales, ['La veta 12 en Olancho (?)']);
  });
});

describe('VOZ-02 (teléfono): el camino normal', () => {
  it('Turbo escribe «cien» con letras: igual se vuelve a oír, y sin corroborar pide confirmar', async () => {
    const b = banco({ confirmado: '' });
    await b.frase('Envía cien a Ana');
    assert.deepEqual(b.llamadas, [true], 'se pidió la segunda escucha');
    assert.deepEqual(b.vias, ['no_corroborada']);
    assert.deepEqual(b.finales, [fraseSinVerificar('Envía cien a Ana')]);
  });

  it('una «confirmación» que el servidor marca sin verificar (la dio un respaldo) no corrobora', async () => {
    const b = banco({ confirmado: { texto: 'Envía mil a Ana', verificado: false, motivo: 'sin_corroborar' } });
    await b.frase('Envía cien a Ana');
    assert.deepEqual(b.vias, ['no_corroborada']);
    assert.deepEqual(b.finales, [fraseSinVerificar('Envía cien a Ana')]);
  });

  it('confirmación verificada: la de Scribe v2', async () => {
    const b = banco({ confirmado: { texto: 'Envía cien lempiras a Ana.', verificado: true } });
    await b.frase('Envía 100 dólares a Ana');
    assert.deepEqual(b.vias, ['corroborada']);
    assert.deepEqual(b.finales, ['Envía cien lempiras a Ana.']);
  });

  it('se corta la red durante la corroboración: timeout y pide confirmar', async () => {
    const b = banco({ confirmado: new Error('Network request failed') });
    await b.frase('Envía cien a Ana');
    assert.deepEqual(b.vias, ['timeout']);
    assert.deepEqual(b.finales, [fraseSinVerificar('Envía cien a Ana')]);
  });
});
