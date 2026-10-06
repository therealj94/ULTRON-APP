/**
 * EL OÍDO TURBO CUANDO EL CANCELADOR DE ECO DE LAS MULETILLAS FALLA (José, 6-oct, APK 5.5.0: «a veces el micrófono
 * falla»). La 5.5.0 abre el micrófono de escucha con la fuente «reconocimiento_eco» (dictado + AcousticEchoCanceler,
 * modules/aura-mic) para que el «mjm» no se oiga a sí mismo. Si en un teléfono eso no abre, se cae o entrega solo ceros,
 * antes el oído reintentaba la MISMA fuente tres veces y se rendía (o se quedaba sordo sin saberlo). Ahora vuelve a abrir
 * al momento con la fuente de antes (sin cancelador: sin muletillas, pero oye) y lo deja en una miga. Y mientras suena un
 * sonido de trabajo de la mesa (compa/trabajoMesa.ts), el umbral de voz sube: lo que se cuela no abre frases.
 * Con lo nativo de mentira (mobile/src/lib/turboMotor.ts). El arreglo es solo de JS a propósito: el nativo de la 5.5.0
 * ya avisa `onFallo` cuando la grabación no arranca y `ecoActivo()` cuando el cancelador no quedó, y tocar
 * modules/aura-mic cambiaría la huella (runtimeVersion: fingerprint) y la OTA no llegaría a las APK instaladas.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MotorTurbo, type TrozoAudio, type WsTurbo } from '../mobile/src/lib/turboMotor';

const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));

class WsFalso implements WsTurbo {
  readyState = 0;
  enviados: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  onclose: ((e?: any) => void) | null = null;
  send(d: string) {
    this.enviados.push(JSON.parse(d));
  }
  close() {
    this.readyState = 3;
  }
}

type Apertura = { conEco: boolean; ecoEscucha: boolean };

/**
 * Un micrófono de mentira: `ecoNoAbre` (con el cancelador no abre), `ecoActivo` (lo que diría el nativo tras abrir) y
 * el reloj del motor. Cada apertura queda en `aperturas` con su fuente.
 */
function banco(o: { ecoNoAbre?: boolean; ecoActivo?: boolean } = {}) {
  let reloj = 1_000_000;
  const aperturas: Apertura[] = [];
  const avisos: string[] = [];
  const eventos: string[] = [];
  let alTrozo: ((t: TrozoAudio) => void) | null = null;
  let alFallo: ((m: string) => void) | null = null;
  let abierto: Apertura | null = null;
  const motor = new MotorTurbo({
    ahora: () => reloj,
    abrirMic: async (cb, fallo, conEco = false, ecoEscucha = false) => {
      aperturas.push({ conEco, ecoEscucha });
      if (ecoEscucha && o.ecoNoAbre) return null;
      alTrozo = cb;
      alFallo = fallo;
      abierto = { conEco, ecoEscucha };
      return () => {
        abierto = null;
        alTrozo = null;
      };
    },
    ecoActivo: () => !!abierto && (abierto.conEco || (abierto.ecoEscucha && o.ecoActivo !== false)),
    permiso: async () => ({ url: 'wss://falso/1' }),
    crearWs: () => {
      const w = new WsFalso();
      setTimeout(() => {
        w.readyState = 1;
        w.onopen?.();
      }, 1);
      return w;
    },
    transcribirWav: async () => '',
    tiempos: { esperaFinalMs: 60, sondeoMs: 0 },
  });
  motor.setCallbacks({
    onAviso: (t) => avisos.push(t),
    onUnavailable: (m) => eventos.push(`no:${m}`),
    onSpeechStart: () => eventos.push('voz'),
    onListeningChange: (on) => eventos.push(on ? 'oye' : 'no-oye'),
  });
  const trozoDb = (db: number) => {
    reloj += 100;
    alTrozo?.({ audio: Buffer.alloc(3200, 1).toString('base64'), db });
  };
  return { motor, aperturas, avisos, eventos, trozoDb, abierto: () => abierto, fallar: (m: string) => alFallo?.(m) };
}

describe('Oído Turbo: el respaldo cuando el cancelador de eco de las muletillas falla', () => {
  it('con el cancelador NO abre: al momento con la fuente de antes (sin gastar intentos ni rendirse) y una miga', async () => {
    const b = banco({ ecoNoAbre: true });
    b.motor.setEcoAlEscuchar(true);
    b.motor.activar();
    await espera(20);
    assert.deepEqual(b.aperturas, [
      { conEco: false, ecoEscucha: true },
      { conEco: false, ecoEscucha: false },
    ]);
    assert.deepEqual(b.abierto(), { conEco: false, ecoEscucha: false }, 'oye con la fuente de dictado de siempre');
    assert.ok(!b.eventos.some((e) => e.startsWith('no:')), 'Turbo no se rinde');
    assert.equal(b.avisos.length, 1);
    assert.match(b.avisos[0], /cancelador de eco no abrió; sigue con la fuente de antes/);
    // Y oye de verdad: una frase abre.
    for (let i = 0; i < 5; i++) b.trozoDb(-70);
    for (let i = 0; i < 3; i++) b.trozoDb(-20);
    assert.ok(b.eventos.includes('voz'));
  });

  it('el que llevaba el cancelador se cae leyendo: se vuelve a abrir ya sin él; las siguientes aperturas tampoco lo piden', async () => {
    const b = banco();
    b.motor.setEcoAlEscuchar(true);
    b.motor.activar();
    await espera(10);
    assert.deepEqual(b.abierto(), { conEco: false, ecoEscucha: true });
    b.fallar('el micrófono dejó de entregar audio (-6)');
    await espera(10);
    assert.deepEqual(b.abierto(), { conEco: false, ecoEscucha: false });
    assert.match(b.avisos.join(' | '), /se cayó/);
    b.motor.reiniciar();
    await espera(10);
    assert.deepEqual(b.aperturas.at(-1), { conEco: false, ecoEscucha: false }, 'ya no se vuelve a pegar en esta sesión del oído');
    // Volver a encender las muletillas es volver a probar.
    b.motor.setEcoAlEscuchar(false);
    b.motor.setEcoAlEscuchar(true);
    await espera(10);
    assert.deepEqual(b.aperturas.at(-1), { conEco: false, ecoEscucha: true });
  });

  it('con el cancelador abre pero solo entrega ceros (sordo): a los 2,5 s se abre con la fuente de antes', async () => {
    const b = banco();
    b.motor.setEcoAlEscuchar(true);
    b.motor.activar();
    await espera(10);
    for (let i = 0; i < 24; i++) b.trozoDb(-100);
    assert.equal(b.aperturas.length, 1, 'a los 2,4 s todavía no');
    b.trozoDb(-100);
    await espera(10);
    assert.deepEqual(b.abierto(), { conEco: false, ecoEscucha: false });
    assert.match(b.avisos.join(' | '), /quedó sordo/);
    // Un micrófono que entrega el ruido del cuarto (aunque sea bajito) no es sordo.
    const c = banco();
    c.motor.setEcoAlEscuchar(true);
    c.motor.activar();
    await espera(10);
    for (let i = 0; i < 60; i++) c.trozoDb(i % 7 === 0 ? -78 : -100);
    assert.equal(c.aperturas.length, 1);
    assert.deepEqual(c.avisos, []);
  });

  it('el nativo lo abrió sin el cancelador (su respaldo, ecoActivo false): queda así, con su miga y sin reabrir en bucle', async () => {
    const b = banco({ ecoActivo: false });
    b.motor.setEcoAlEscuchar(true);
    b.motor.activar();
    await espera(20);
    assert.equal(b.aperturas.length, 1, 'no reabre');
    assert.match(b.avisos.join(' | '), /no se dejó pegar/);
    for (let i = 0; i < 40; i++) b.trozoDb(-100);
    await espera(10);
    assert.equal(b.aperturas.length, 1, 'sin cancelador, los ceros no son «sordo por el cancelador»');
  });

  it('sin muletillas no cambia nada: la fuente de siempre, sin avisos', async () => {
    const b = banco({ ecoNoAbre: true });
    b.motor.activar();
    await espera(10);
    assert.deepEqual(b.aperturas, [{ conEco: false, ecoEscucha: false }]);
    assert.deepEqual(b.avisos, []);
  });
});

describe('Oído Turbo: el sonido de trabajo de la mesa no abre frases (setFondoPropio)', () => {
  it('lo que se cuela del tecleo (un poco sobre el ruido) no abre una frase con el fondo puesto; sin él, sí; la voz sí siempre', async () => {
    const b = banco();
    b.motor.activar();
    await espera(10);
    for (let i = 0; i < 30; i++) b.trozoDb(-70);
    b.motor.setFondoPropio(true);
    // El tecleo que se cuela: ~19 dB sobre el cuarto, a ratos (pasa el umbral de siempre, -55, no el del fondo, -49).
    for (let i = 0; i < 30; i++) b.trozoDb(i % 2 ? -51 : -70);
    assert.ok(!b.eventos.includes('voz'), 'con el fondo puesto, el tecleo no abre frase');
    // La persona habla encima: su voz pasa clara.
    for (let i = 0; i < 4; i++) b.trozoDb(-25);
    assert.ok(b.eventos.includes('voz'), 'la voz de la persona sí');
    const c = banco();
    c.motor.activar();
    await espera(10);
    for (let i = 0; i < 30; i++) c.trozoDb(-70);
    for (let i = 0; i < 30; i++) c.trozoDb(i % 2 ? -51 : -70);
    assert.ok(c.eventos.includes('voz'), 'sin el fondo, lo mismo sí abría frase (por eso el margen)');
  });

  it('escuchaConCancelador: sí con las muletillas (aunque el micrófono esté cerrado por su voz); no sin ellas ni si el cancelador falló', async () => {
    const b = banco();
    b.motor.activar();
    await espera(10);
    assert.equal(b.motor.escuchaConCancelador(), false, 'sin muletillas ni «interrumpir»: la fuente sin cancelador');
    b.motor.setEcoAlEscuchar(true);
    await espera(10);
    assert.equal(b.motor.escuchaConCancelador(), true);
    b.motor.pausar(true);
    assert.equal(b.motor.escuchaConCancelador(), true, 'cerrado por su voz: vale lo que tendrá al reabrir');
    b.motor.pausar(false);
    await espera(10);
    const f = banco({ ecoNoAbre: true });
    f.motor.setEcoAlEscuchar(true);
    f.motor.activar();
    await espera(20);
    assert.equal(f.motor.escuchaConCancelador(), false, 'el cancelador falló aquí: los sonidos de la mesa no suenan con el micrófono abierto');
    const o = banco();
    o.motor.setOirEncima(true);
    o.motor.activar();
    await espera(10);
    assert.equal(o.motor.escuchaConCancelador(), true, 'con «Interrumpir hablando» (fuente de llamada)');
  });
});
