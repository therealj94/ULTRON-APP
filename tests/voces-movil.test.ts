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
  CAUTELA_VOZ_MS,
  ESPERA_VOZ_TURNO_MS,
  FRESCO_MS,
  TOPE_CONSULTA_VOZ_MS,
  campoQuienHabla,
  quienHablaDelTurno,
  IdentificadorVoz,
  Inscripcion,
  escenaDelTurno,
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

  it('la frase de quién habla va PRIMERO: una escena larga (cortada por el teléfono y el servidor) no la pierde', () => {
    const camara = 'Hay dos personas frente a la cámara, una sentada a la izquierda con una taza y otra de pie junto a la ventana; la luz es tenue y hay papeles sobre la mesa. '.repeat(4);
    const caras = 'Reconozco a Ana (tu esposa) y a alguien que no conozco.';
    const e = escenaDelTurno({ voz: fraseQuienHabla(ana, 'José'), camara, caras });
    assert.ok(e.startsWith('Por la voz, habla Ana'), e.slice(0, 60));
    // El teléfono corta a 300 (lib/api.ts turnoBody) y el servidor a 400 (server.ts): la regla sigue.
    assert.ok(reglaQuienHabla(e.slice(0, 300)), 'la regla sobrevive al corte');
    // Lo de antes (la voz al final) la perdía sin avisar.
    assert.equal(reglaQuienHabla([camara, caras, fraseQuienHabla(ana, 'José')].join(' ').slice(0, 300)), null);
    assert.equal(escenaDelTurno({}), undefined);
    assert.equal(escenaDelTurno({ camara: 'Una persona.' }), 'Una persona.');
  });

  it('activar es por persona', () => {
    let m = conVocesActivas({}, 'Jose@X.org', true, 5);
    assert.ok(vocesActivas(m, 'jose@x.org'));
    assert.ok(!vocesActivas(m, 'ana@x.org'));
    m = conVocesActivas(m, 'JOSE@x.org', false);
    assert.ok(!vocesActivas(m, 'jose@x.org'));
  });
});

describe('Voces (teléfono): quién dijo ESTA frase (revisión del 5-oct, M1)', () => {
  const ana = { id: 'a', nombre: 'Ana', relacion: 'conocido' as const, parentesco: 'esposa' };
  const jose = { id: 'j', nombre: 'José', relacion: 'yo' as const };
  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Un servidor de mentira: cada audio dice quién es y cuánto tarda en contestar. */
  function banco() {
    const llamadas: string[] = [];
    const pendientes = new Map<string, { quien: typeof ana | typeof jose | null; ms: number; motivo?: string }>();
    const id = new IdentificadorVoz(async (trozos) => {
      const k = trozos[0];
      llamadas.push(k);
      const p = pendientes.get(k)!;
      await dormir(p.ms);
      return { persona: p.quien, motivo: p.motivo || (p.quien ? 'reconocida' : 'nadie_cerca') };
    });
    let n = 0;
    /** Una frase: se cierra (empieza a reconocerse) y se entrega como turno `entregaTras` ms después. */
    const frase = async (quien: typeof ana | typeof jose | null, ms: number, o: { entregaTras?: number; motivo?: string } = {}) => {
      const k = `frase-${++n}`;
      pendientes.set(k, { quien, ms, motivo: o.motivo });
      const idFrase = n;
      id.oir(idFrase, [k]);
      if (o.entregaTras) await dormir(o.entregaTras);
      const oidaEn = Date.now();
      id.entregada(idFrase, oidaEn);
      return oidaEn;
    };
    return { id, llamadas, frase };
  }

  it('el primer pedido de Ana justo después de José es de Ana (espera lo de SU frase, con tope)', async () => {
    const b = banco();
    const t1 = await b.frase(jose, 10, { entregaTras: 30 });
    assert.deepEqual(await b.id.paraTurno(t1), jose);
    // Ana habla enseguida; su resultado tarda ~120 ms (servidor + red): el turno lo espera.
    const t2 = await b.frase(ana, 120);
    const t0 = Date.now();
    assert.deepEqual(await b.id.paraTurno(t2), ana, 'antes salía «José» (lo de la frase anterior)');
    assert.ok(Date.now() - t0 < ESPERA_VOZ_TURNO_MS + 50);
  });

  it('si no llega a tiempo, el turno NO dice quién habla (nunca lo de la frase anterior); lo tardío vale solo para SU frase', async () => {
    const b = banco();
    const t1 = await b.frase(jose, 5, { entregaTras: 20 });
    assert.deepEqual(await b.id.paraTurno(t1), jose);
    const t2 = await b.frase(ana, 600);
    const t0 = Date.now();
    assert.equal(await b.id.paraTurno(t2), undefined, 'sin dato: no se reusa «José»');
    const tardo = Date.now() - t0;
    assert.ok(tardo >= ESPERA_VOZ_TURNO_MS - 20 && tardo < ESPERA_VOZ_TURNO_MS + 80, `esperó ${tardo} ms (tope ${ESPERA_VOZ_TURNO_MS})`);
    await dormir(320);
    // La frase siguiente (de alguien que no se reconoce) no hereda lo de Ana que llegó tarde.
    const t3 = await b.frase(null, 5, { entregaTras: 20 });
    assert.equal(await b.id.paraTurno(t3), null);
    // Lo de Ana sí vale para SU frase (un reintento del mismo turno).
    assert.deepEqual(await b.id.paraTurno(t2, 0), ana);
    assert.deepEqual(b.id.ultima(), { persona: null, id: 3 });
  });

  it('nunca se pierde una frase: con una consulta en curso queda en fila la ÚLTIMA (reemplaza a la anterior)', async () => {
    const b = banco();
    await b.frase(jose, 80);
    const t2 = await b.frase(jose, 5);
    const t3 = await b.frase(ana, 5);
    assert.equal(b.llamadas.length, 1, 'una consulta a la vez');
    assert.equal(await b.id.paraTurno(t2, 10), undefined, 'la frase reemplazada no dice quién habla');
    assert.deepEqual(await b.id.paraTurno(t3), ana, 'la última se reconoce en cuanto termina la anterior');
    assert.deepEqual(b.llamadas, ['frase-1', 'frase-3']);
  });

  it('muy corta, silencio, error o sin audio: el turno no dice quién habla', async () => {
    const b = banco();
    const t1 = await b.frase(ana, 5, { motivo: 'muy_corta', entregaTras: 15 });
    assert.equal(await b.id.paraTurno(t1), undefined);
    b.id.sinDato(9);
    b.id.entregada(9, Date.now());
    assert.equal(await b.id.paraTurno(Date.now(), 10), undefined);
    const roto = new IdentificadorVoz(async () => {
      throw new Error('sin red');
    });
    roto.oir(1, ['x']);
    roto.entregada(1, Date.now());
    assert.equal(await roto.paraTurno(Date.now()), undefined);
    // Escrito (sin frase oída cerca): nada.
    assert.equal(await b.id.paraTurno(0), undefined);
    assert.equal(await b.id.paraTurno(Date.now() + 60_000, 0), undefined);
  });
});

describe('Voces (teléfono): un «sí» corto después de otra voz (revisión 7.5, M1′)', () => {
  const ana = { id: 'a', nombre: 'Ana', relacion: 'conocido' as const, parentesco: 'esposa' };
  const jose = { id: 'j', nombre: 'José', relacion: 'yo' as const };
  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Un banco con reloj propio (para las ventanas largas) y un servidor de mentira por frase. */
  function banco(o: { topeMs?: number } = {}) {
    let ahora = 1_000_000;
    const reloj = () => ahora;
    const respuestas = new Map<string, { quien: typeof ana | typeof jose | null; ms: number; motivo?: string; colgada?: boolean }>();
    const llamadas: string[] = [];
    const id = new IdentificadorVoz(
      async (trozos) => {
        const k = trozos[0];
        llamadas.push(k);
        const r = respuestas.get(k)!;
        if (r.colgada) return new Promise<never>(() => {});
        await dormir(r.ms);
        return { persona: r.quien, motivo: r.motivo || (r.quien ? 'reconocida' : 'nadie_cerca') };
      },
      undefined,
      { reloj, ...(o.topeMs ? { topeMs: o.topeMs } : {}) }
    );
    let n = 0;
    const frase = async (quien: typeof ana | typeof jose | null, ms: number, x: { motivo?: string; colgada?: boolean; antes?: number } = {}) => {
      if (x.antes) ahora += x.antes;
      const k = `f-${++n}`;
      respuestas.set(k, { quien, ms, motivo: x.motivo, colgada: x.colgada });
      id.oir(n, [k]);
      id.entregada(n, ahora);
      return ahora;
    };
    return { id, frase, llamadas, avanzar: (ms: number) => (ahora += ms) };
  }

  it('Ana habló hace 5 s y ahora un «sí» muy corto (sin dato): va su id como precaución (reciente), sin frase en la escena', async () => {
    const b = banco();
    const t1 = await b.frase(ana, 5);
    assert.deepEqual(await b.id.paraTurno(t1), ana);
    const t2 = await b.frase(ana, 5, { motivo: 'muy_corta', antes: 5_000 });
    const r = await quienHablaDelTurno(b.id, t2, 'José');
    assert.deepEqual(r, { frase: '', quienHabla: { id: 'a', reciente: true } }, 'antes salía vacío y el «sí» de Ana mandaba el borrador de José');
  });

  it('si después de Ana se reconoció a la dueña, no hay precaución (y nunca da permiso: solo bloquea)', async () => {
    const b = banco();
    await b.id.paraTurno(await b.frase(ana, 5));
    await b.id.paraTurno(await b.frase(jose, 5, { antes: 2_000 }));
    const t3 = await b.frase(null, 5, { motivo: 'muy_corta', antes: 2_000 });
    assert.deepEqual(await quienHablaDelTurno(b.id, t3, 'José'), { frase: '' });
  });

  it('lo de Ana de hace más de CAUTELA_VOZ_MS ya no cuenta', async () => {
    const b = banco();
    await b.id.paraTurno(await b.frase(ana, 5));
    const t2 = await b.frase(null, 5, { motivo: 'muy_corta', antes: CAUTELA_VOZ_MS + 1_000 });
    assert.deepEqual(await quienHablaDelTurno(b.id, t2, 'José'), { frase: '' });
  });

  it('la consulta tarda más que ESPERA_VOZ_TURNO_MS: también va la precaución (no queda abierto)', async () => {
    const b = banco();
    await b.id.paraTurno(await b.frase(ana, 5));
    const t2 = await b.frase(jose, ESPERA_VOZ_TURNO_MS + 300, { antes: 3_000 });
    assert.deepEqual(await quienHablaDelTurno(b.id, t2, 'José'), { frase: '', quienHabla: { id: 'a', reciente: true } });
  });

  it('una frase reconocida (aunque sea de Ana) va como siempre, sin la marca de precaución; una voz desconocida no hereda a Ana', async () => {
    const b = banco();
    const t1 = await b.frase(ana, 5);
    const r = await quienHablaDelTurno(b.id, t1, 'José');
    assert.deepEqual(r.quienHabla, { id: 'a' });
    assert.match(r.frase, /Por la voz, habla Ana \(esposa de José\), no José/);
    const t2 = await b.frase(null, 5, { antes: 1_000 });
    assert.deepEqual(await quienHablaDelTurno(b.id, t2, 'José'), { frase: '' }, '«no la conozco» es un resultado, no falta de dato');
  });

  it('una consulta colgada se suelta a los TOPE_CONSULTA_VOZ_MS: la fila sigue y la frase siguiente se reconoce', async () => {
    const b = banco({ topeMs: 60 });
    const t1 = await b.frase(ana, 0, { colgada: true });
    const t2 = await b.frase(ana, 5, { antes: 500 });
    assert.equal(await b.id.paraTurno(t1, 10), undefined);
    assert.deepEqual(await b.id.paraTurno(t2), ana, 'antes la fila quedaba atascada detrás de la colgada');
    assert.deepEqual(b.llamadas, ['f-1', 'f-2']);
    assert.ok(TOPE_CONSULTA_VOZ_MS >= 2_000 && TOPE_CONSULTA_VOZ_MS <= 6_000, `tope razonable: ${TOPE_CONSULTA_VOZ_MS}`);
  });

  it('el campo para el cuerpo del turno: solo {id, reciente?}; lo demás no viaja', () => {
    assert.deepEqual(campoQuienHabla({ id: 'a', reciente: true }), { id: 'a', reciente: true });
    assert.deepEqual(campoQuienHabla({ id: 'a' }), { id: 'a' });
    assert.deepEqual(campoQuienHabla({ id: 'a', reciente: 'sí', otra: 1 }), { id: 'a' });
    assert.equal(campoQuienHabla({ id: '' }), undefined);
    assert.equal(campoQuienHabla('Ana'), undefined);
    assert.equal(campoQuienHabla(undefined), undefined);
    assert.equal(campoQuienHabla({ id: 'x'.repeat(80) })!.id.length, 40);
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

  it('el audio sale al CERRARSE la frase (antes del texto de Turbo), con el mismo id que la frase entregada', async () => {
    const b = banco();
    const cierres: Array<{ id: number; n: number }> = [];
    b.motor.setOyenteCierre((id, trozos) => {
      cierres.push({ id, n: trozos.length });
      b.orden.push(`cierre:${id}`);
    });
    const ids: number[] = [];
    b.motor.setOyenteAudio((trozos, texto, id) => {
      ids.push(id!);
      b.orden.push(`audio:${texto}`);
    });
    b.motor.activar();
    await espera();
    b.silencio(10);
    b.voz(20);
    await espera();
    b.silencio(8);
    assert.deepEqual(b.orden, ['cierre:1'], 'el audio para reconocer la voz sale antes de que Turbo conteste');
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Léeme mis correos.' });
    await espera(20);
    assert.deepEqual(b.orden, ['cierre:1', 'audio:Léeme mis correos.', 'texto:Léeme mis correos.']);
    assert.deepEqual(ids, [1]);
    assert.ok(cierres[0].n >= 26);
    // Otra frase: otro id.
    b.voz(15);
    await espera();
    b.silencio(8);
    b.ws[0].decir({ message_type: 'committed_transcript', text: 'Gracias.' });
    await espera(20);
    assert.deepEqual(ids, [1, 2]);
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
