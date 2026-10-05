/**
 * Las voces en el teléfono (mobile/src/voces/voces.ts) y su fuente de audio (el oído Turbo,
 * mobile/src/lib/turboMotor.ts), sin teléfono:
 *
 *  · entender lo que se dice: «aprende mi voz», «aprende la voz de mi esposa Ana», «te presento a…»
 *    (débil: de las caras si están activas), «olvida la voz de…», «olvida mi voz», «olvida todas las
 *    voces», «¿de quién conoces la voz?», «¿quién está hablando?»; y lo que NO es de voces;
 *  · el «sí» de la persona presentada (con plazo) y las frases para aprender (3, o 2 que sumen 8 s);
 *  · lo reconocido vale un rato y un «no sé» posterior lo reemplaza; la frase de la escena es la que
 *    el servidor entiende para no leerle lo privado de la dueña a otra persona;
 *  · el audio: recortado a ~8 s y en el WAV que el servidor oye;
 *  · el oído Turbo entrega el audio de la frase justo antes de su texto, solo de las frases entregadas.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ESPERA_CONSENTIMIENTO_MS,
  ESPERA_MUESTRA_MS,
  FRESCO_MS,
  Inscripcion,
  MAX_TROZOS_FRASE,
  UltimaVoz,
  conVocesActivas,
  esCancelar,
  fraseQuienHabla,
  nombreCon,
  pedidoDeVoces,
  quienDe,
  recortarFrase,
  respuestaSiNo,
  vocesActivas,
  wavDeFrase,
} from '../mobile/src/voces/voces';
import { MotorTurbo, type TrozoAudio, type WsTurbo } from '../mobile/src/lib/turboMotor';
import { reglaQuienHabla } from '../lib/voces-miembro';
import { muestrasDeAudio } from '../lib/voces-motor';

describe('Voces (teléfono): lo que se dice', () => {
  it('aprender la propia y la de alguien del círculo, con parentesco', () => {
    for (const t of ['Aprende mi voz', 'aura, conoce mi voz por favor', 'recuerda mi voz', 'apréndete mi voz']) assert.deepEqual(pedidoDeVoces(t), { tipo: 'aprender_mia' }, t);
    assert.deepEqual(pedidoDeVoces('Aprende la voz de Ana'), { tipo: 'presentar', nombre: 'Ana' });
    assert.deepEqual(pedidoDeVoces('aprende la voz de mi esposa Ana'), { tipo: 'presentar', nombre: 'Ana', parentesco: 'esposa' });
    assert.deepEqual(pedidoDeVoces('Conoce la voz de mi mamá.'), { tipo: 'presentar', nombre: 'Mamá', parentesco: 'mamá' });
    assert.deepEqual(pedidoDeVoces('te presento la voz de mi hermano Luis Pérez'), { tipo: 'presentar', nombre: 'Luis Pérez', parentesco: 'hermano' });
    // «Te presento a…» sin decir «voz»: débil (si las caras están activas, es de ellas).
    assert.deepEqual(pedidoDeVoces('Te presento a mi esposa Ana'), { tipo: 'presentar', nombre: 'Ana', parentesco: 'esposa', debil: true });
    assert.equal(pedidoDeVoces('te presento a quien es el jefe')?.tipo, undefined);
  });

  it('olvidar, la lista y «¿quién habla?»', () => {
    assert.deepEqual(pedidoDeVoces('olvida la voz de Ana'), { tipo: 'olvidar', nombre: 'Ana' });
    assert.deepEqual(pedidoDeVoces('Borra la voz de mi esposa Ana'), { tipo: 'olvidar', nombre: 'Ana' });
    assert.deepEqual(pedidoDeVoces('olvida mi voz'), { tipo: 'olvidar_mia' });
    assert.deepEqual(pedidoDeVoces('Olvida todas las voces'), { tipo: 'olvidar_todas' });
    for (const t of ['¿De quién voces conoces?', '¿qué voces conoces?', '¿De quién conoces la voz?', 'cuáles voces conoces']) assert.deepEqual(pedidoDeVoces(t), { tipo: 'lista' }, t);
    for (const t of ['¿Quién está hablando?', 'quién habla', '¿De quién es esta voz?', '¿reconoces mi voz?']) assert.deepEqual(pedidoDeVoces(t), { tipo: 'quien' }, t);
  });

  it('lo que no es de voces no se toca (ni lo de las caras)', () => {
    for (const t of ['olvida a Ana', 'olvida mi cara', 'conóceme', '¿quién soy?', 'baja la voz', 'sube el volumen de la voz', 'pon la voz de Morgan Freeman', 'aprende a cocinar', 'mi voz suena rara hoy', '']) assert.equal(pedidoDeVoces(t), null, t);
  });

  it('el nombre y el parentesco como se dijeron', () => {
    assert.deepEqual(quienDe('mi esposa Ana, por favor'), { nombre: 'Ana', parentesco: 'esposa' });
    assert.deepEqual(quienDe('Don Juan'), { nombre: 'Don Juan' });
    assert.deepEqual(quienDe('mi papá'), { nombre: 'Papá', parentesco: 'papá' });
    assert.equal(quienDe('  ...  '), null);
    assert.equal(nombreCon({ id: '1', nombre: 'Ana', relacion: 'conocido', parentesco: 'esposa' }), 'Ana, tu esposa');
    assert.equal(nombreCon({ id: '1', nombre: 'Mamá', relacion: 'conocido', parentesco: 'mamá' }), 'Mamá');
  });

  it('el «sí» de la persona presentada; un «no», cualquier otra cosa o silencio no guardan nada', () => {
    for (const t of ['Sí', 'sí, claro', 'Claro que sí', 'Dale', 'puedes recordar mi voz', 'Sí, puedes']) assert.equal(respuestaSiNo(t), 'si', t);
    for (const t of ['No', 'no gracias', 'mejor no', 'no me grabes']) assert.equal(respuestaSiNo(t), 'no', t);
    for (const t of ['¿qué?', 'hola', '']) assert.equal(respuestaSiNo(t), null, t);
    assert.ok(esCancelar('Cancela'));
    assert.ok(esCancelar('ya no, déjalo'));
    assert.ok(!esCancelar('hoy fue un buen día'));
  });
});

describe('Voces (teléfono): aprender', () => {
  const frase = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

  it('la dueña: tres frases, o dos que ya sumen 8 s', () => {
    let reloj = 0;
    const i = new Inscripcion(() => reloj);
    i.empezarMia('José');
    assert.equal(i.pendiente()?.fase, 'frases');
    assert.equal(i.agregar(frase(30)), 'otra');
    assert.equal(i.agregar(frase(30)), 'otra');
    assert.equal(i.agregar(frase(25)), 'lista');
    assert.equal(i.pendiente()?.frases.length, 3);
    i.empezarMia('José');
    assert.equal(i.agregar(frase(60)), 'otra');
    assert.equal(i.agregar(frase(60)), 'lista', 'dos frases largas bastan');
    // Una frase de más de 8 s se recorta.
    i.empezarMia('José');
    i.agregar(frase(200));
    assert.equal(i.pendiente()!.frases[0].length, MAX_TROZOS_FRASE);
    // Sin frases en el plazo, se acaba.
    reloj += ESPERA_MUESTRA_MS + 1;
    assert.equal(i.pendiente(), null);
  });

  it('alguien del círculo: primero su «sí» (con plazo); la frase queda como constancia', () => {
    let reloj = 0;
    const i = new Inscripcion(() => reloj);
    i.empezarConocido('Ana', 'esposa');
    assert.deepEqual([i.pendiente()?.fase, i.pendiente()?.parentesco], ['permiso', 'esposa']);
    assert.equal(i.agregar(frase(30)), 'otra', 'sin su «sí», sus frases no cuentan');
    assert.equal(i.pendiente()!.frases.length, 0);
    i.consentir('Sí, puedes recordar mi voz');
    assert.deepEqual([i.pendiente()?.fase, i.pendiente()?.frase], ['frases', 'Sí, puedes recordar mi voz']);
    // El plazo del «sí» vence solo.
    i.empezarConocido('Beto');
    reloj += ESPERA_CONSENTIMIENTO_MS + 1;
    assert.equal(i.pendiente(), null);
  });
});

describe('Voces (teléfono): lo reconocido y la escena', () => {
  const ana = { id: 'a', nombre: 'Ana', relacion: 'conocido' as const, parentesco: 'esposa' };
  const jose = { id: 'j', nombre: 'José', relacion: 'yo' as const };

  it('vale un rato, y un «no sé» posterior lo reemplaza', () => {
    let reloj = 0;
    const u = new UltimaVoz(() => reloj);
    assert.equal(u.escena('José'), '');
    u.poner(ana);
    assert.equal(u.escena('José'), 'Por la voz, habla Ana (esposa de José), no José.');
    reloj += FRESCO_MS + 1;
    assert.equal(u.escena('José'), '', 'pasado el rato ya no vale');
    u.poner(ana);
    u.poner(null);
    assert.equal(u.escena('José'), '', 'habló alguien que no conozco: lo de antes ya no vale');
    assert.equal(u.fresca(), null);
    u.poner(jose);
    assert.equal(u.escena('José'), 'Por la voz, habla José (la persona dueña de la cuenta).');
  });

  it('la frase de la escena es la que el servidor entiende (y la de la dueña no dispara la regla)', () => {
    assert.ok(reglaQuienHabla(fraseQuienHabla(ana, 'José')));
    assert.ok(reglaQuienHabla(fraseQuienHabla({ ...ana, parentesco: undefined }, 'José')));
    assert.ok(reglaQuienHabla(fraseQuienHabla(ana, 'José', true)));
    assert.match(reglaQuienHabla(`Hay una persona frente a la cámara. Reconozco a Ana ${fraseQuienHabla(ana, 'José')}`)!, /te habla Ana, no José/);
    assert.equal(reglaQuienHabla(fraseQuienHabla(jose, 'José')), null);
    assert.equal(reglaQuienHabla(fraseQuienHabla(jose, 'José', true)), null);
  });

  it('activar es por persona', () => {
    let m = conVocesActivas({}, 'Jose@X.org', true, 5);
    assert.ok(vocesActivas(m, 'jose@x.org'));
    assert.ok(!vocesActivas(m, 'ana@x.org'));
    m = conVocesActivas(m, 'JOSE@x.org', false);
    assert.ok(!vocesActivas(m, 'jose@x.org'));
  });
});

describe('Voces (teléfono): el audio', () => {
  it('recortado: sin casi todo el prerollo, hasta ~8 s; en el WAV que oye el servidor', () => {
    const trozos = Array.from({ length: 120 }, (_, i) => Buffer.alloc(3200, i & 255).toString('base64'));
    const r = recortarFrase(trozos);
    assert.equal(r.length, MAX_TROZOS_FRASE);
    assert.equal(r[0], trozos[4], 'se quedan 2 trozos del prerollo (la primera sílaba)');
    assert.deepEqual(recortarFrase(trozos.slice(0, 10)), trozos.slice(0, 10), 'una frase corta va entera');
    const m = muestrasDeAudio(wavDeFrase(r));
    assert.equal(m?.length, MAX_TROZOS_FRASE * 1600);
  });
});

// ── el oído Turbo entrega el audio de cada frase ────────────────────────────────────────────────
class WsFalso implements WsTurbo {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  onclose: ((e?: any) => void) | null = null;
  abrir() {
    this.readyState = 1;
    this.onopen?.();
  }
  decir(j: object) {
    this.onmessage?.({ data: JSON.stringify(j) });
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}
const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('Voces (teléfono): el oído Turbo pasa el audio', () => {
  function banco(opts: { abreWs?: boolean } = {}) {
    let reloj = 1_000_000;
    const ws: WsFalso[] = [];
    let alTrozo: ((t: TrozoAudio) => void) | null = null;
    const orden: string[] = [];
    const audios: string[][] = [];
    const motor = new MotorTurbo({
      ahora: () => reloj,
      abrirMic: async (cb) => {
        alTrozo = cb;
        return () => (alTrozo = null);
      },
      permiso: async () => (opts.abreWs === false ? null : { url: 'wss://falso' }),
      crearWs: () => {
        const w = new WsFalso();
        ws.push(w);
        setTimeout(() => w.abrir(), 1);
        return w;
      },
      transcribirWav: async () => 'lo que dijo por el respaldo',
      tiempos: { esperaFinalMs: 60, confirmarMs: 200, inactivoMs: 10_000 },
    });
    motor.setCallbacks({ onFinal: (t) => orden.push(`texto:${t}`) });
    motor.setOyenteAudio((trozos, texto) => {
      audios.push(trozos);
      orden.push(`audio:${texto}`);
    });
    let n = 0;
    const trozo = (voz: boolean) => {
      reloj += 100;
      n++;
      alTrozo?.({ audio: Buffer.alloc(3200, n & 255).toString('base64'), db: voz ? -20 : -75 });
    };
    return { motor, ws, orden, audios, silencio: (k: number) => Array.from({ length: k }, () => trozo(false)), voz: (k: number) => Array.from({ length: k }, () => trozo(true)) };
  }

  it('en vivo: el audio de la frase llega justo antes de su texto, con el prerollo y la voz', async () => {
    const b = banco();
    b.motor.activar();
    await espera();
    b.silencio(10);
    b.voz(20);
    await espera();
    b.silencio(8);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Hoy fue un buen día.' });
    await espera(20);
    assert.deepEqual(b.orden, ['audio:Hoy fue un buen día.', 'texto:Hoy fue un buen día.']);
    assert.ok(b.audios[0].length >= 6 + 20, 'prerollo + voz (+ el silencio hasta cerrar)');
  });

  it('por el respaldo (/api/stt) también; y sin oyente nada cambia', async () => {
    const b = banco({ abreWs: false });
    b.motor.activar();
    await espera();
    b.silencio(8);
    b.voz(15);
    await espera();
    b.silencio(10);
    await espera(30);
    assert.deepEqual(b.orden, ['audio:lo que dijo por el respaldo', 'texto:lo que dijo por el respaldo']);
    b.motor.setOyenteAudio(null);
    b.voz(15);
    await espera();
    b.silencio(10);
    await espera(30);
    assert.equal(b.audios.length, 1);
    assert.equal(b.orden.at(-1), 'texto:lo que dijo por el respaldo');
  });

  it('un oyente que falla no rompe la frase', async () => {
    const b = banco();
    b.motor.setOyenteAudio(() => {
      throw new Error('boom');
    });
    b.motor.activar();
    await espera();
    b.voz(12);
    await espera();
    b.silencio(8);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Abre Excel.' });
    await espera(20);
    assert.deepEqual(b.orden, ['texto:Abre Excel.']);
  });
});
