/**
 * LAS MULETILLAS EN LA MESA (mobile/src/lib/muletillas.ts): el oído Turbo de verdad (turboMotor.ts) con el micrófono,
 * Turbo y la bocina simulados. Mientras suena el «mjm» por la bocina, el micrófono lo oye (el «sangrado»: más bajo que
 * la persona pero muy por encima del umbral de voz), como en un teléfono. Se comprueba:
 *  · cae en una pausa a media idea tras ≥ 7 s hablando; no tras un punto o una pregunta, ni con poco rato, ni en un tema
 *    delicado, ni con AU-RA hablando, ni sin cancelación de eco;
 *  · uno cada 10 s y dos por frase como mucho;
 *  · no abre la interrupción (ni pausa el oído, ni oye «encima»), y la frase se cierra EXACTAMENTE cuando se habría
 *    cerrado sin el «mjm» (sin el tramo ignorado, el sangrado la alargaba y llegaba a Turbo: se ve abajo);
 *  · el texto final sale limpio si se coló (la persona retomó encima) y un «ya» suyo no se toca si no se coló.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MotorTurbo, type TrozoAudio, type WsTurbo } from '../mobile/src/lib/turboMotor';
import { OrquestaMuletillas } from '../mobile/src/lib/muletillas';

const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** Los bytes de cada trozo dicen de quién es: la persona, la bocina (el «mjm») o el cuarto callado. */
const PERSONA = 0x50;
const BOCINA = 0x42;
const CUARTO = 0x07;

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
  /** ¿Le llegó a Turbo algún trozo con audio de la bocina (desde el mensaje `desde`)? */
  oyoLaBocina(desde = 0) {
    return this.enviados.slice(desde).some((m) => {
      const b = Buffer.from(m.audio_base_64, 'base64');
      return b.length > 100 && b[0] === BOCINA;
    });
  }
}

type Opciones = {
  activo?: boolean;
  eco?: boolean;
  /** Duración del clip de cada palabra (null = sin clip). */
  duracion?: (f: string) => number | null;
  /** false: el oído NO ignora el tramo (lo de antes): para ver qué pasaba sin él. */
  conTramo?: boolean;
  auraHablando?: () => boolean;
  oirEncima?: boolean;
  tiempos?: Record<string, number>;
};

function banco(o: Opciones = {}) {
  let reloj = 1_000_000;
  const ws: WsFalso[] = [];
  const finales: string[] = [];
  const encima: string[] = [];
  const cierres: number[] = [];
  const sonidos: { frase: string; en: number }[] = [];
  let callados = 0;
  let bocinaHasta = 0;
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
    transcribirWav: async () => '',
    tiempos: { esperaFinalMs: 60, confirmarMs: 200, inactivoMs: 60_000, maximoFraseMs: 60_000, ...(o.tiempos || {}) },
  });
  const orq = new OrquestaMuletillas({
    activo: () => o.activo ?? true,
    ecoCancelado: () => o.eco ?? true,
    auraHablando: () => motor.estaPausado() || !!o.auraHablando?.(),
    silencioso: () => false,
    idioma: () => 'es',
    duracion: o.duracion ?? (() => 400),
    sonar: (frase) => {
      sonidos.push({ frase, en: reloj });
      bocinaHasta = reloj + (o.duracion ?? (() => 400))(frase)!;
      return true;
    },
    callar: () => callados++,
    ignorarTramo: (ms) => (o.conTramo === false ? undefined : motor.ignorarTramo(ms)),
  });
  motor.setOyenteTrozo((i) => orq.alTrozo(i));
  motor.setOyenteCierre(() => cierres.push(reloj));  // Como lib/speech.ts: lo que llega a la mesa, sin lo que se coló.
  motor.setCallbacks({
    onFinal: (t) => finales.push(orq.limpiarFinal(t)),
    onPartialEncima: (t) => encima.push(t),
  });
  if (o.oirEncima) motor.setOirEncima(true);

  /** Lo que Turbo contesta al próximo commit (el sondeo del fin de turno). */
  let alCommit: string | null = null;
  let commitsVistos = 0;
  /** Lo último que Turbo entendió de la persona (si le llega el «mjm», lo escribe detrás, como haría). */
  let dicho = '';
  const trozo = (persona: boolean) => {
    reloj += 100;
    const bocina = !persona && reloj <= bocinaHasta;
    const byte = persona ? PERSONA : bocina ? BOCINA : CUARTO;
    const w = ws[ws.length - 1];
    const antes = w ? w.enviados.length : 0;
    alTrozo?.({ audio: Buffer.alloc(3200, byte).toString('base64'), db: persona ? -20 : bocina ? -30 : -75 });
    if (w && w.oyoLaBocina(antes) && !/mjm$/.test(dicho)) {
      dicho = `${dicho} mjm`;
      w.decir({ message_type: 'partial_transcript', text: dicho });
    }
    if (w && w.commits > commitsVistos) {
      commitsVistos = w.commits;
      if (alCommit !== null) {
        const t = alCommit;
        alCommit = null;
        w.decir({ message_type: 'committed_transcript', text: t });
      }
    }
  };
  const callar = (k: number) => {
    for (let i = 0; i < k; i++) trozo(false);
  };
  /**
   * Habla `ms` diciendo `texto` (un parcial por segundo, que crece, como Turbo). Con un respiro de 0,1 s entre palabras
   * cada medio segundo, como la voz de verdad (sin ellos el ruido de fondo subiría hasta la voz).
   */
  const hablar = (ms: number, texto: string) => {
    const palabras = texto.split(' ');
    for (let i = 0; i < ms; i += 100) {
      trozo(i % 500 !== 200);
      const w = ws[ws.length - 1];
      if (w && i % 1000 === 0) {
        const n = Math.max(1, Math.round((palabras.length * (i + 1000)) / ms));
        dicho = palabras.slice(0, n).join(' ');
        w.decir({ message_type: 'partial_transcript', text: dicho });
      }
    }
    dicho = texto;
    ws[ws.length - 1]?.decir({ message_type: 'partial_transcript', text: texto });
  };
  const contestar = (t: string) => (alCommit = t);
  const empezar = async () => {
    motor.activar();
    await espera();
    callar(10);
    trozo(true);
    await espera();
  };
  return { motor, orq, ws, finales, encima, cierres, sonidos, callar, hablar, contestar, empezar, reloj: () => reloj, callados: () => callados };
}

const MEDIA_IDEA = 'y entonces fuimos a ver lo del terreno con mi hermano y';

describe('Muletillas: cuándo sí', () => {
  it('tras ≥ 7 s hablando, en una pausa a media idea, un «mjm» por el canal de efectos (sin pausar el oído)', async () => {
    const b = banco();
    await b.empezar();
    b.hablar(8000, MEDIA_IDEA);
    b.contestar('Y entonces fuimos a ver lo del terreno con mi hermano y');
    b.callar(4);
    assert.equal(b.sonidos.length, 0, 'en un respiro todavía no');
    b.callar(1);
    assert.equal(b.sonidos.length, 1, 'a los 0,5 s de callar, a media idea');
    assert.equal(b.motor.estaPausado(), false, 'no es «AU-RA hablando»: el oído sigue oyendo');
    assert.equal(b.motor.escuchando(), true);
    assert.deepEqual(b.encima, []);
  });
});

describe('Muletillas: cuándo no', () => {
  it('tras un punto o una pregunta (quiere respuesta), con poco rato o en un tema delicado', async () => {
    for (const [ms, parcial, commit, motivo] of [
      [8000, 'y eso fue lo que pasó con el terreno de mi hermano.', 'Y eso fue lo que pasó con el terreno de mi hermano.', 'tras un punto'],
      [8000, '¿vos qué harías con el terreno de mi hermano?', '¿Vos qué harías con el terreno de mi hermano?', 'tras una pregunta'],
      [5000, MEDIA_IDEA, MEDIA_IDEA, 'poco rato'],
      [8000, 'es que mi abuelo murió la semana pasada y', 'Es que mi abuelo murió la semana pasada y', 'tema delicado'],
    ] as const) {
      const b = banco();
      await b.empezar();
      b.hablar(ms, parcial);
      b.contestar(commit);
      b.callar(12);
      assert.equal(b.sonidos.length, 0, motivo);
    }
  });

  it('con AU-RA hablando, sin cancelación de eco, apagadas o sin clip que quepa antes del cierre', async () => {
    for (const [o, motivo] of [
      [{ auraHablando: () => true }, 'AU-RA hablando'],
      [{ eco: false }, 'sin cancelación de eco'],
      [{ activo: false }, 'apagadas'],
      [{ duracion: () => null }, 'sin clips todavía'],
      [{ duracion: () => 900 }, 'un clip largo terminaría encima del cierre'],
    ] as const) {
      const b = banco(o);
      await b.empezar();
      b.hablar(8000, MEDIA_IDEA);
      b.contestar(MEDIA_IDEA);
      b.callar(12);
      assert.equal(b.sonidos.length, 0, motivo);
    }
  });

  it('uno cada 10 s y dos por frase como mucho, nunca dos iguales seguidos', async () => {
    const b = banco();
    await b.empezar();
    const pausa = () => {
      b.contestar(MEDIA_IDEA);
      b.callar(6);
    };
    b.hablar(8000, MEDIA_IDEA);
    pausa();
    assert.equal(b.sonidos.length, 1);
    b.hablar(3000, `${MEDIA_IDEA} luego le dije que`);
    pausa();
    assert.equal(b.sonidos.length, 1, 'a los 4 s del primero, no');
    b.hablar(8000, `${MEDIA_IDEA} y después de eso`);
    pausa();
    assert.equal(b.sonidos.length, 2, 'pasados 10 s, el segundo');
    assert.notEqual(b.sonidos[1].frase, b.sonidos[0].frase);
    b.hablar(12_000, `${MEDIA_IDEA} y al final de todo`);
    pausa();
    assert.equal(b.sonidos.length, 2, 'dos por frase');
    assert.equal(b.cierres.length, 0, 'todo en la misma frase (ninguna pausa la cerró)');
  });
});

describe('Muletillas: no rompen el oído', () => {
  it('con «Interrumpir hablando»: el «mjm» no abre la interrupción ni pausa el oído', async () => {
    const b = banco({ oirEncima: true });
    await b.empezar();
    b.hablar(8000, MEDIA_IDEA);
    b.contestar(MEDIA_IDEA);
    b.callar(8);
    assert.equal(b.sonidos.length, 1);
    assert.deepEqual(b.encima, [], 'nada se oyó «encima»');
    assert.equal(b.motor.oyendoEncima(), false);
    assert.equal(b.motor.estaPausado(), false);
  });

  it('la frase se cierra EXACTAMENTE cuando se habría cerrado sin el «mjm», y a Turbo no le llega la bocina', async () => {
    const cierre = async (o: Opciones) => {
      const b = banco(o);
      await b.empezar();
      const desde = b.reloj();
      b.hablar(8000, MEDIA_IDEA);
      b.contestar('Y entonces fuimos a ver lo del terreno con mi hermano y');
      b.callar(30);
      await espera();      return { b, ms: b.cierres[0] - desde };
    };
    const sin = await cierre({ activo: false });
    const con = await cierre({});
    assert.equal(con.b.sonidos.length, 1, 'sonó el «mjm»');
    assert.equal(con.ms, sin.ms, `con «mjm» se cierra a los ${con.ms} ms, igual que sin él (${sin.ms} ms)`);
    assert.equal(con.b.ws[0].oyoLaBocina(), false, 'Turbo recibió silencio en lugar del «mjm»');
    assert.deepEqual(con.b.finales, ['Y entonces fuimos a ver lo del terreno con mi hermano y']);
    // Lo de antes (sin ignorar el tramo): el sangrado de la bocina parecía voz.
    const viejo = await cierre({ conTramo: false });
    assert.ok(viejo.ms > sin.ms, `sin el tramo, la frase se cerraba ${viejo.ms - sin.ms} ms más tarde`);
    assert.equal(viejo.b.ws[0].oyoLaBocina(), true, 'sin el tramo, el «mjm» le llegaba a Turbo como de la persona');
  });

  it('si la persona retoma encima del «mjm» y Turbo lo escribe, el texto final sale limpio', async () => {
    const b = banco();
    await b.empezar();
    b.hablar(8000, MEDIA_IDEA);
    b.contestar('Y entonces fuimos a ver lo del terreno con mi hermano y');
    b.callar(5);
    assert.equal(b.sonidos.length, 1);
    const dicha = b.sonidos[0].frase;
    b.callar(1);
    // Retoma con el «mjm» todavía sonando: el tramo se corta y su voz (con lo que quedaba del clip) va a Turbo.
    b.hablar(1500, `${dicha} le dije que no`);
    b.contestar(`${dicha}, le dije que no.`);
    b.callar(8);
    await espera();
    assert.equal(b.finales.length, 1);
    assert.equal(b.finales[0], 'Y entonces fuimos a ver lo del terreno con mi hermano y le dije que no.');
  });

  it('si el «mjm» sonó entero sin nadie encima, un «ya» de la persona no se toca', async () => {
    const b = banco({ duracion: (f) => (f === 'ya' ? 300 : null) });
    await b.empezar();
    b.hablar(8000, MEDIA_IDEA);
    b.contestar(MEDIA_IDEA);
    b.callar(5);
    assert.deepEqual(b.sonidos.map((s) => s.frase), ['ya']);
    b.callar(5);
    b.hablar(1500, 'ya te dije que no');
    b.contestar('Ya te dije que no.');
    b.callar(8);
    await espera();
    assert.equal(b.finales.at(-1), `${MEDIA_IDEA} Ya te dije que no.`, 'lo suyo queda tal cual');
  });

  it('AU-RA empieza a hablar con el clip sonando: se calla', async () => {
    const b = banco();
    await b.empezar();
    b.hablar(8000, MEDIA_IDEA);
    b.contestar(MEDIA_IDEA);
    b.callar(5);
    assert.equal(b.sonidos.length, 1);
    b.orq.callar();
    assert.equal(b.callados(), 1);
  });
});

describe('Muletillas: el micrófono de escucha', () => {
  it('encendidas: la fuente de dictado con el cancelador de eco; con «Interrumpir hablando», la de llamada; apagadas, la de siempre', async () => {
    const aperturas: string[] = [];
    const motor = new MotorTurbo({
      abrirMic: async (_cb, _f, conEco, ecoAlEscuchar) => {
        aperturas.push(conEco ? 'llamada' : ecoAlEscuchar ? 'dictado+eco' : 'dictado');
        return () => {};
      },
      permiso: async () => null,
      crearWs: () => {
        throw new Error('sin red');
      },
      transcribirWav: async () => '',
    });
    motor.activar();
    await espera();
    motor.setEcoAlEscuchar(true);
    await espera();
    motor.setOirEncima(true);
    await espera();
    motor.setOirEncima(false);
    await espera();
    motor.setEcoAlEscuchar(false);
    await espera();
    motor.setEcoAlEscuchar(false);
    await espera();
    assert.deepEqual(aperturas, ['dictado', 'dictado+eco', 'llamada', 'dictado+eco', 'dictado'], 'se reabre solo cuando cambia la fuente');
    motor.destruir();
  });

  it('se encienden mientras el micrófono todavía abre (al arrancar la mesa): queda con el cancelador igual', async () => {
    const aperturas: string[] = [];
    const motor = new MotorTurbo({
      abrirMic: async (_cb, _f, conEco, ecoAlEscuchar) => {
        aperturas.push(conEco ? 'llamada' : ecoAlEscuchar ? 'dictado+eco' : 'dictado');
        await espera(20);
        return () => {};
      },
      permiso: async () => null,
      crearWs: () => {
        throw new Error('sin red');
      },
      transcribirWav: async () => '',
    });
    motor.activar();
    await espera(2);
    motor.setEcoAlEscuchar(true);
    await espera(60);
    assert.deepEqual(aperturas, ['dictado', 'dictado+eco']);
    motor.destruir();
  });
});
