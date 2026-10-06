/**
 * El oído Turbo con FIN DE TURNO SEMÁNTICO (mobile/src/lib/turboMotor.ts + finDeTurno.ts). A los SONDEO_MS de silencio
 * se le pide a Turbo el texto exacto (un commit) y se decide con él: una idea cerrada sale ya, una dudosa empieza el
 * turno especulativo y sale con el silencio de siempre, una que quedó colgando espera más. Lo de siempre no cambia: la
 * frase llega entera, en orden, y si la persona sigue hablando lo dicho antes del sondeo va delante (nunca se pierde).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MotorTurbo, type TrozoAudio, type WsTurbo } from '../mobile/src/lib/turboMotor';
import { fraseSinVerificar } from '../mobile/src/lib/turboLogica';

const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));

class WsFalso implements WsTurbo {
  readyState = 0;
  enviados: any[] = [];
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
    this.readyState = 3;
  }
  get commits() {
    return this.enviados.filter((m) => m.commit).length;
  }
  /** Lo que se mandó después del último commit (audio que Turbo todavía no cerró). */
  get trasUltimoCommit() {
    const i = this.enviados.map((m) => !!m.commit).lastIndexOf(true);
    return this.enviados.slice(i + 1).length;
  }
}

function banco(o: { confirmado?: string; tiempos?: Record<string, number> } = {}) {
  let reloj = 1_000_000;
  const ws: WsFalso[] = [];
  const finales: string[] = [];
  const especuladas: string[] = [];
  const eventos: string[] = [];
  const medidas: number[] = [];
  const wav: boolean[] = [];
  let alTrozo: ((t: TrozoAudio) => void) | null = null;
  const motor = new MotorTurbo({
    ahora: () => reloj,
    abrirMic: async (cb) => {
      alTrozo = cb;
      return () => (alTrozo = null);
    },
    permiso: async () => ({ url: 'wss://falso/1' }),
    crearWs: (url) => {
      const w = new WsFalso(url);
      ws.push(w);
      setTimeout(() => w.abrir(), 1);
      return w;
    },
    transcribirWav: async (_w, confirmar) => {
      wav.push(confirmar);
      return confirmar ? (o.confirmado ?? '') : 'texto del respaldo';
    },
    tiempos: { esperaFinalMs: 60, confirmarMs: 200, inactivoMs: 10_000, ...(o.tiempos || {}) },
  });
  motor.setCallbacks({
    onFinal: (t) => finales.push(t),
    onEspeculativa: (t) => especuladas.push(t),
    onEspeculativaCancelada: () => eventos.push('cancelada'),
    onMedida: (m) => medidas.push(m.trasCallarMs),
  });
  const trozo = (voz: boolean) => {
    reloj += 100;
    alTrozo?.({ audio: Buffer.alloc(3200, 7).toString('base64'), db: voz ? -20 : -75 });
  };
  const silencio = (k: number) => {
    for (let i = 0; i < k; i++) trozo(false);
  };
  const voz = (k: number) => {
    for (let i = 0; i < k; i++) trozo(true);
  };
  return { motor, ws, finales, especuladas, eventos, medidas, wav, silencio, voz };
}

async function empezar(b: ReturnType<typeof banco>, parcial: string) {
  b.motor.activar();
  await espera();
  b.silencio(5);
  b.voz(10);
  await espera();
  b.ws[0].decir({ message_type: 'partial_transcript', text: parcial });
}

describe('Oído Turbo: fin de turno semántico', () => {
  it('idea cerrada: el sondeo trae el texto y la frase sale a los ~0,3 s, sin un segundo commit', async () => {
    const b = banco();
    await empezar(b, 'qué hora');
    b.silencio(2);
    assert.equal(b.ws[0].commits, 0, 'a los 0,2 s todavía no sondea');
    b.silencio(1);
    assert.equal(b.ws[0].commits, 1, 'a los 0,3 s (≥ SONDEO_MS) pide el texto exacto');
    b.ws[0].decir({ message_type: 'committed_transcript', text: '¿Qué hora es?' });
    await espera();
    assert.deepEqual(b.finales, ['¿Qué hora es?'], 'completa: sale ya');
    assert.ok(b.medidas[0] <= 320, `lista ${b.medidas[0]} ms tras callar (antes ~550)`);
    b.silencio(10);
    await espera();
    assert.equal(b.ws[0].commits, 1, 'no hace falta otro commit');
    assert.equal(b.finales.length, 1);
  });

  it('dudosa: empieza el turno especulativo con el texto exacto y la frase sale con el silencio de siempre', async () => {
    const b = banco();
    await empezar(b, 'hoy fui al')
    b.ws[0].decir({ message_type: 'partial_transcript', text: 'hoy fui al centro' });
    b.silencio(3);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Hoy fui al centro.' });
    await espera();
    assert.deepEqual(b.especuladas, ['Hoy fui al centro.'], 'el turno puede empezar ya');
    assert.deepEqual(b.finales, [], 'pero la frase todavía no se da por terminada');
    b.silencio(1);
    await espera();
    assert.deepEqual(b.finales, [], 'a los 0,4 s sigue esperando');
    b.silencio(1);
    await espera();
    assert.deepEqual(b.finales, ['Hoy fui al centro.'], 'a los 0,5 s sale, igual a la especulada');
    assert.equal(b.ws[0].commits, 1);
    assert.deepEqual(b.eventos, []);
  });

  it('dudosa y sigue hablando: se cancela lo especulado y lo dicho antes del sondeo va delante (nada se pierde)', async () => {
    const b = banco();
    await empezar(b, 'hoy fui al centro');
    b.silencio(3);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Hoy fui al centro.' });
    await espera();
    assert.deepEqual(b.especuladas, ['Hoy fui al centro.']);
    b.voz(8);
    assert.deepEqual(b.eventos, ['cancelada'], 'siguió hablando: el turno especulativo se tira');
    b.ws[0].decir({ message_type: 'partial_transcript', text: 'y compré pan' });
    b.silencio(3);
    assert.equal(b.ws[0].commits, 2, 'otro sondeo para lo nuevo');
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Y compré pan para la cena.' });
    await espera();
    b.silencio(3);
    await espera();
    assert.deepEqual(b.finales, ['Hoy fui al centro. Y compré pan para la cena.']);
    assert.deepEqual(b.especuladas, ['Hoy fui al centro.', 'Hoy fui al centro. Y compré pan para la cena.']);
  });

  it('colgando («mándale un mensaje a»): ni especula ni cierra con el silencio de siempre; espera más', async () => {
    const b = banco();
    await empezar(b, 'mándale un mensaje a');
    b.silencio(3);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Mándale un mensaje a.' });
    await espera();
    b.silencio(5);
    await espera();
    assert.deepEqual(b.finales, [], 'a los 0,8 s todavía la deja terminar');
    assert.deepEqual(b.especuladas, []);
    b.voz(6);
    b.ws[0].decir({ message_type: 'partial_transcript', text: 'Beto' });
    b.silencio(3);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Beto que ya voy.' });
    await espera();
    b.silencio(3);
    await espera();
    assert.deepEqual(b.finales, ['Mándale un mensaje a. Beto que ya voy.']);
  });

  it('colgando y no sigue: sale sola pasado el silencio largo, sin otro commit', async () => {
    const b = banco();
    await empezar(b, 'y luego');
    b.silencio(3);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Y luego…' });
    await espera();
    b.silencio(8);
    await espera();
    assert.deepEqual(b.finales, ['Y luego…']);
    assert.equal(b.ws[0].commits, 1);
  });

  it('el texto del sondeo tarda: la frase se cierra igual y sale cuando llega (una sola vez)', async () => {
    const b = banco({ tiempos: { esperaFinalMs: 2_000 } });
    await empezar(b, 'cuéntame del oro');
    b.silencio(8);
    await espera();
    assert.equal(b.ws[0].commits, 1, 'no manda otro commit por cerrar');
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Cuéntame del oro.' });
    await espera();
    assert.deepEqual(b.finales, ['Cuéntame del oro.']);
  });

  it('el texto del sondeo nunca llega: la frase entera va por el respaldo (sin duplicar nada)', async () => {
    const b = banco();
    await empezar(b, 'cuéntame del oro');
    b.silencio(3);
    await espera(100);
    b.silencio(6);
    await espera(150);
    assert.deepEqual(b.finales, ['texto del respaldo']);
  });

  it('dinero por el sondeo: se sigue confirmando con Scribe v2 antes de entregar', async () => {
    const b = banco({ confirmado: '' });
    await empezar(b, 'mándale cinco origen a Ana');
    b.silencio(3);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Mándale 5 ORIGEN a Ana.' });
    await espera(20);
    b.silencio(5);
    await espera(20);
    assert.deepEqual(b.wav, [true]);
    assert.deepEqual(b.finales, [fraseSinVerificar('Mándale 5 ORIGEN a Ana.')]);
  });

  it('con el sondeo apagado (sondeoMs 0), lo de antes: un solo commit a los 0,5 s', async () => {
    const b = banco({ tiempos: { sondeoMs: 0 } });
    await empezar(b, 'abre Excel');
    b.silencio(4);
    assert.equal(b.ws[0].commits, 0);
    b.silencio(1);
    assert.equal(b.ws[0].commits, 1);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Abre Excel.' });
    await espera();
    assert.deepEqual(b.finales, ['Abre Excel.']);
    assert.deepEqual(b.especuladas, []);
  });

  it('silenciar con algo especulado: se cancela', async () => {
    const b = banco();
    await empezar(b, 'hoy fui al centro');
    b.silencio(3);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Hoy fui al centro.' });
    await espera();
    b.motor.silenciar();
    assert.deepEqual(b.eventos, ['cancelada']);
  });
});
