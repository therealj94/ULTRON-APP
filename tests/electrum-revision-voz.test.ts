/**
 * LA REVISIÓN DE LA VOZ EN VIVO DE DR ELECTRUM (8-oct): lo que se encontró al portar el cerebro, la voz y el oído de AU-RA.
 *
 *  1. el final no repite lo que ya sonó aunque el pulidor quite «1.», «¡Excelente pregunta!» o «En resumen,» (se
 *     termina con el texto de autoridad, no con la voz pulida), y el número de una lista va con su frase;
 *  2. un reintento de la pantalla compara las frases por TEXTO: ni dos veces lo mismo ni media respuesta de cada intento;
 *     el turno repetido manda las MISMAS frases que salieron en vivo;
 *  3. la APK manda `previo` (la frase anterior de la misma voz): cada frase deja de sonar como el comienzo;
 *  4. Electrum usa sus propios tiempos de cobertura (prompt grande), sin tocar los de AU-RA;
 *  5. la APK manda su visitante (`x-electrum-visita`) y el tope de voz no se reinicia rotándolo;
 *  6. Don Chema y la Ing. Tatiana con su voz también por /api/electrum/voz;
 *  7. la primera frase no suelta en su coma media afirmación que la guarda de honestidad retendría entera;
 *  8. la APK dice la frase del servidor cuando la misma pregunta sigue en curso (`en-curso`).
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { CortadorFrases, esNumeroDeLista, partirEnFrases, puedeAfirmar, type Frase } from '../server/electrum/voz-frases';
import { pulirParaVoz } from '../lib/habla-natural';
import { FrasesDelTurno, huellaFrase } from '../src-electrum/panel/frasesTurno';
import { frasesGuardadas, guardadoDeElectrum, electrumDeGuardado, MAX_FRASES_GUARDADAS } from '../server/electrum/turno-idempotente';
import { ColaVoz, PREVIO_MAX, type PedidoVoz } from '../mobile/src/electrum/colaVoz';
import type { Reproducible, EstadoSonido } from '../mobile/src/lib/sonidoVivo';
import { ELECTRUM_LANZAMIENTOS_OMISION, ELECTRUM_PRIMERA_MS_OMISION, ELECTRUM_TOTAL_MS_OMISION, pensarElectrum, tiemposCerebroElectrum } from '../server/electrum/cerebro';
import { anotarVozElectrum, cuentaVozDe, restanteVozElectrum } from '../server/electrum/cuenta-voz';
import { quienDelHilo } from '../server/electrum/hilo';
import { FORMA_VISITA, TurnoEnVivo, pedirTurno, visitaDeBytes, visitaValida, type DepsPedirTurno } from '../mobile/src/electrum/turnoVivo';
import { CODIGO_EN_CURSO, ErrorHttp, fraseDeError } from '../mobile/src/electrum/frases';
import { PERSONAJES, vozDeLaMesa } from '../server/electrum/dialogo';
import { herramientasNativas } from '../lib/agente/protocolo';

const MENSAJE = '¿Qué concesiones vencen pronto?';
const LISTA =
  '¡Excelente pregunta! Hay dos concesiones que vencen pronto:\n1. Clavo Rico vence en diciembre.\n2. Los Chaguites vence en marzo.\nEn resumen, conviene renovar las dos.';

function cortador(o: { previas?: string[] } = {}) {
  const frases: Frase[] = [];
  const c = new CortadorFrases({ emitir: (f) => frases.push(f), idioma: 'es', mensaje: MENSAJE, previas: o.previas });
  return { c, frases };
}
/** Como lo manda el modelo: a trozos de pocas letras. */
function empujarATrozos(c: CortadorFrases, texto: string, n = 7) {
  for (let i = 0; i < texto.length; i += n) c.empujar(texto.slice(i, i + n));
}

describe('1 · el final no repite lo que ya sonó', () => {
  it('con la voz pulida la cuenta no calzaba (se repetía todo); con el texto de autoridad no sale nada de más', () => {
    // Así era: la voz pulida (sin «1.», sin «¡Excelente pregunta!», sin «En resumen,») contra lo dicho en crudo.
    const antes = cortador();
    empujarATrozos(antes.c, LISTA);
    antes.c.finDeRonda();
    const dichas = antes.frases.length;
    const extraConVoz = antes.c.finalizar(pulirParaVoz(LISTA, { idioma: 'es', mensaje: MENSAJE, avatar: 'electrum', maxEtiquetas: 1 }));
    assert.ok(extraConVoz > 0, 'la voz pulida no calza con lo dicho (por eso ya no se usa para finalizar)');

    const { c, frases } = cortador();
    empujarATrozos(c, LISTA);
    c.finDeRonda();
    assert.equal(frases.length, dichas);
    assert.equal(c.finalizar(LISTA), 0, 'nada se dice dos veces');
    assert.equal(c.cuantas, frases.length);
  });

  it('el número de una lista va con su frase: se ve en la pantalla y no se dice', () => {
    const { c, frases } = cortador();
    empujarATrozos(c, LISTA);
    c.finDeRonda();
    assert.ok(!frases.some((f) => esNumeroDeLista(f.texto)), JSON.stringify(frases.map((f) => f.texto)));
    const clavo = frases.find((f) => /Clavo Rico/.test(f.texto))!;
    assert.equal(clavo.texto, '1. Clavo Rico vence en diciembre.');
    assert.equal(clavo.voz, 'Clavo Rico vence en diciembre.');
    assert.ok(!frases.some((f) => /Excelente pregunta/.test(f.voz)), 'la fórmula de asistente no suena');
    // El texto entero se parte igual (el final y un reintento cuentan lo mismo).
    assert.ok(!partirEnFrases(LISTA).some((p) => esNumeroDeLista(p)));
    assert.equal(partirEnFrases('1.').length, 1, 'un número solo, al final, se queda (no se pierde texto)');
  });

  it('lo que el final cambia de verdad sí sale (solo lo nuevo)', () => {
    const { c, frases } = cortador();
    empujarATrozos(c, 'Hay dos concesiones que vencen pronto:\n1. Clavo Rico vence en diciembre.\n');
    c.finDeRonda();
    const n = frases.length;
    c.finalizar('Hay dos concesiones que vencen pronto:\n1. Clavo Rico vence en diciembre.\n2. Los Chaguites vence en marzo.');
    assert.deepEqual(
      frases.slice(n).map((f) => f.texto),
      ['2. Los Chaguites vence en marzo.']
    );
  });
});

describe('7 · la primera frase no suelta media afirmación en su coma', () => {
  it('«Te dejé…, marcadas en el mapa.»: ni la primera mitad sale antes de que la guarda la vea entera', () => {
    const { c, frases } = cortador();
    c.empujar('Te dejé las tres concesiones de Olancho, ');
    assert.equal(frases.length, 0, 'la cláusula puede estar afirmando algo: se espera al final de la frase');
    c.empujar('marcadas en el mapa. Revisalas con calma.');
    c.finDeRonda();
    assert.equal(frases.length, 0, 'la frase entera dice que está en el mapa: se retiene (lo decide la guarda del final)');
  });

  it('con la frase entera ya llegada, la guarda mira la frase y no el pedazo', () => {
    const { c, frases } = cortador();
    c.empujar('Te dejé las tres concesiones de Olancho, marcadas, en el mapa. Revisalas.');
    c.finDeRonda();
    assert.equal(frases.length, 0);
  });

  it('una primera frase que no afirma nada se sigue soltando en su coma (la voz empieza antes)', () => {
    const { c, frases } = cortador();
    c.empujar('Clavo Rico es la concesión más grande de Olancho, ');
    assert.deepEqual(
      frases.map((f) => f.texto),
      ['Clavo Rico es la concesión más grande de Olancho,']
    );
    assert.equal(puedeAfirmar('Clavo Rico es la concesión más grande de Olancho,'), false);
    assert.equal(puedeAfirmar('Ya generé el informe,'), true);
  });
});

describe('2 · el reintento de la pantalla compara por texto', () => {
  const f = (i: number, texto: string) => ({ i, texto, voz: texto });

  it('el turno repetido (las mismas frases): ninguna se dice dos veces; lo que faltaba sí', () => {
    const t = new FrasesDelTurno();
    assert.equal(t.llega(f(0, 'Vencen dos.')), 'nueva');
    assert.equal(t.llega(f(1, 'La primera es Clavo Rico.')), 'nueva');
    t.reintento();
    assert.equal(t.dijoAntes, true);
    assert.equal(t.llega(f(0, 'Vencen dos.')), 'dicha');
    assert.equal(t.llega(f(1, 'La primera es Clavo Rico.')), 'dicha');
    assert.equal(t.llega(f(2, 'La segunda, Los Chaguites.')), 'nueva');
    assert.equal(t.llega(f(2, 'La segunda, Los Chaguites.')), 'repetida');
    assert.equal(t.texto(), 'Vencen dos. La primera es Clavo Rico. La segunda, Los Chaguites.');
    assert.equal(t.decirFinEntero(), false);
  });

  it('el reintento trae OTRA respuesta (se volvió a pensar): se reinicia con la nueva, no se mezclan', () => {
    const t = new FrasesDelTurno();
    t.llega(f(0, 'Vencen dos.'));
    t.llega(f(1, 'La primera es Clavo Rico.'));
    t.reintento();
    // Por número sería «ya dicha»: por texto es otra cosa.
    assert.equal(t.llega(f(0, 'Este año vencen dos concesiones.')), 'reiniciar');
    assert.deepEqual(t.paraDecir(), ['Este año vencen dos concesiones.']);
    assert.equal(t.llega(f(1, 'Clavo Rico en diciembre.')), 'nueva');
  });

  it('coincide el comienzo y después cambia: se reinicia con la nueva entera', () => {
    const t = new FrasesDelTurno();
    t.llega(f(0, 'Vencen dos.'));
    t.llega(f(1, 'La primera es Clavo Rico.'));
    t.reintento();
    assert.equal(t.llega(f(0, 'Vencen dos.')), 'dicha');
    assert.equal(t.llega(f(1, 'La primera vence en diciembre.')), 'reiniciar');
    assert.deepEqual(t.paraDecir(), ['Vencen dos.', 'La primera vence en diciembre.']);
  });

  it('un `fin` repetido sin frases: solo lo que falta, por texto', () => {
    const t = new FrasesDelTurno();
    t.llega(f(0, 'Vencen dos.'));
    t.llega(f(1, 'La primera es Clavo Rico.'));
    t.reintento();
    assert.equal(t.decirFinEntero(), true);
    assert.equal(t.faltaDelFin('Vencen dos. La primera es **Clavo Rico**. La segunda, Los Chaguites.'), 'La segunda, Los Chaguites.');
    assert.equal(t.faltaDelFin('Otra respuesta distinta.'), 'Otra respuesta distinta.');
    assert.equal(huellaFrase('Él está ÁQUI, 1.500 ha'), 'elestaaqui1500ha');
  });

  it('el turno guardado lleva las frases que salieron en vivo, y el reintento manda esas mismas', () => {
    const dichas = [
      { i: 0, texto: 'Vencen dos.', voz: 'Vencen dos.' },
      { i: 1, texto: '1. Clavo Rico vence en diciembre.', voz: 'Clavo Rico vence en diciembre.' },
    ];
    const g = electrumDeGuardado(guardadoDeElectrum({ texto: 'Vencen dos. 1. Clavo Rico vence en diciembre.', emocion: 'neutral', fin: 'respondido', frasesDichas: dichas }));
    assert.deepEqual(frasesGuardadas(g), dichas);
    // Sin ellas (de antes, del JSON) o rotas: null, y el servidor vuelve a cortar el texto.
    assert.equal(frasesGuardadas({ texto: 'x', emocion: 'neutral', fin: 'x' }), null);
    assert.equal(frasesGuardadas({ texto: 'x', emocion: 'neutral', fin: 'x', frasesDichas: [{ i: 1, texto: 'a', voz: 'a' }] }), null, 'números en orden desde 0');
    assert.equal(frasesGuardadas({ texto: 'x', emocion: 'neutral', fin: 'x', frasesDichas: Array.from({ length: MAX_FRASES_GUARDADAS + 1 }, (_, i) => ({ i, texto: 'a', voz: 'a' })) }), null);
  });
});

/* ------------------------------------------------------------------ 3 · `previo` en la APK */

class Sonido implements Reproducible {
  private cb: ((s: EstadoSonido) => void) | null = null;
  constructor(readonly texto: string) {}
  setOnPlaybackStatusUpdate(cb: ((s: EstadoSonido) => void) | null) {
    this.cb = cb;
  }
  async playAsync() {
    setTimeout(() => this.cb?.({ isLoaded: true, isPlaying: false, positionMillis: 10, durationMillis: 10, didJustFinish: true }), 1);
  }
  async stopAsync() {}
  async unloadAsync() {}
}

describe('3 · la APK manda la frase anterior', () => {
  it('la primera sin `previo`; las siguientes con el final de la anterior de la MISMA voz', async () => {
    const pedidos: PedidoVoz[] = [];
    const cola = new ColaVoz({
      preparar: async (p) => {
        pedidos.push(p);
        return new Sonido(p.texto);
      },
    });
    const larga = `${'Clavo Rico tiene una historia larga. '.repeat(12)}Y sigue.`;
    cola.decir({ texto: 'Vencen dos.' });
    cola.decir({ texto: larga });
    cola.decir({ texto: 'Yo diría que hay que renovar.', personaje: 'chema' });
    cola.decir({ texto: 'Y pronto.', personaje: 'chema' });
    cola.cerrar();
    for (let i = 0; i < 50 && pedidos.length < 4; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(pedidos.length, 4);
    assert.equal(pedidos[0].previo, undefined, 'la primera es el comienzo');
    assert.equal(pedidos[1].previo, 'Vencen dos.');
    assert.equal(pedidos[2].previo, undefined, 'otra voz de la mesa: su primera frase');
    assert.equal(pedidos[3].previo, 'Yo diría que hay que renovar.');
    const cola2: PedidoVoz[] = [];
    const c2 = new ColaVoz({ preparar: async (p) => (cola2.push(p), new Sonido(p.texto)) });
    c2.decir({ texto: larga });
    c2.decir({ texto: 'Fin.' });
    for (let i = 0; i < 50 && cola2.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(cola2[1].previo!.length <= PREVIO_MAX, 'con tope (va en la dirección del GET)');
    assert.ok(larga.endsWith(cola2[1].previo!), 'el FINAL de la anterior');
  });
});

/* ------------------------------------------------------------------ 4 · los tiempos de Electrum */

describe('4 · la cobertura de Electrum con sus tiempos', () => {
  const ENV = ['ELECTRUM_CEREBRO_PRIMERA_MS', 'ELECTRUM_CEREBRO_TOTAL_MS', 'ELECTRUM_CEREBRO_LANZAMIENTOS'];
  beforeEach(() => {
    for (const k of ENV) delete process.env[k];
  });

  it('por omisión, los de un prompt grande; por variable, los que se pongan; nunca más de lo que le queda al turno', () => {
    assert.deepEqual(tiemposCerebroElectrum(45_000), { primeraMs: ELECTRUM_PRIMERA_MS_OMISION, totalMs: ELECTRUM_TOTAL_MS_OMISION, lanzamientos: ELECTRUM_LANZAMIENTOS_OMISION });
    assert.ok(ELECTRUM_PRIMERA_MS_OMISION > 2_000 && ELECTRUM_TOTAL_MS_OMISION > 7_000 && ELECTRUM_LANZAMIENTOS_OMISION < 3, 'más holgados que los de AU-RA');
    assert.deepEqual(tiemposCerebroElectrum(45_000, { ELECTRUM_CEREBRO_PRIMERA_MS: '4000', ELECTRUM_CEREBRO_TOTAL_MS: '15000', ELECTRUM_CEREBRO_LANZAMIENTOS: '3' }), { primeraMs: 4000, totalMs: 15000, lanzamientos: 3 });
    const poco = tiemposCerebroElectrum(9_000);
    assert.equal(poco.totalMs, 9_000, 'dentro de lo que le queda al turno');
    assert.equal(poco.primeraMs, 6_000);
    assert.equal(tiemposCerebroElectrum(4_000).primeraMs, 4_000, 'la espera no pasa del plazo');
    assert.deepEqual(tiemposCerebroElectrum(45_000, { ELECTRUM_CEREBRO_TOTAL_MS: 'x', ELECTRUM_CEREBRO_LANZAMIENTOS: '-1' }), { primeraMs: 6000, totalMs: 20000, lanzamientos: 2 });
  });

  it('pensarElectrum se los pasa a hablarConManos', async () => {
    let visto: any = null;
    await pensarElectrum(
      { mensajes: [{ role: 'user', content: 'hola' }], herramientas: herramientasNativas([]), msRestante: 12_000 },
      {
        hablar: async function* (_m, _t, _s, o) {
          visto = o;
          yield { modelo: 'zai.glm-5' };
          yield { texto: 'Hola.' };
        },
      }
    );
    assert.equal(visto.primeraMs, 6_000);
    assert.equal(visto.totalMs, 12_000);
    assert.equal(visto.lanzamientos, 2);
  });
});

describe('4 · hablarConManos: los tiempos de un pedido mandan sobre los de AU-RA (sin cambiar los de AU-RA)', () => {
  const original = BedrockRuntimeClient.prototype.send;
  const ENV = ['CEREBRO_VOZ_PRIMERA_MS', 'CEREBRO_VOZ_TOTAL_MS', 'CEREBRO_VOZ_LANZAMIENTOS', 'CEREBRO_VOZ_RESPALDO_PRIMERA_MS', 'CEREBRO_VOZ_EXTRA'];
  let lanzados: { modelo: string; en: number }[] = [];
  let t0 = 0;
  beforeEach(() => {
    for (const k of ENV) delete process.env[k];
    process.env.AWS_ACCESS_KEY_ID = 'AKIAPRUEBA';
    process.env.AWS_SECRET_ACCESS_KEY = 'prueba';
    process.env.AWS_REGION = 'us-west-2';
    lanzados = [];
    // GLM contesta a los 450 ms; los demás no dicen nada hasta que los corten.
    (BedrockRuntimeClient.prototype as any).send = async function (cmd: any, o: { abortSignal?: AbortSignal } = {}) {
      const modelo = String(cmd.input.modelId);
      lanzados.push({ modelo, en: Date.now() - t0 });
      const senal = o.abortSignal;
      const dormir = (ms: number) =>
        new Promise<void>((ok, no) => {
          const t = setTimeout(ok, ms);
          senal?.addEventListener('abort', () => (clearTimeout(t), no(Object.assign(new Error('aborted'), { name: 'AbortError' }))), { once: true });
        });
      return {
        stream: (async function* () {
          if (modelo !== 'zai.glm-5' || lanzados.filter((l) => l.modelo === modelo).length > 1) {
            await dormir(60_000);
            return;
          }
          await dormir(450);
          yield { contentBlockDelta: { delta: { text: 'Hola, aquí GLM.' } } };
          yield { contentBlockStop: {} };
          yield { messageStop: { stopReason: 'end_turn' } };
        })(),
      };
    };
  });
  afterEach(() => {
    (BedrockRuntimeClient.prototype as any).send = original;
  });

  async function correr(o: Record<string, unknown>) {
    const M = await import('../lib/cerebro-rapido');
    M.reiniciarSaludModelos();
    M.anotarExitoRapido(M.servicioDe('electrum'));
    M.anotarExitoRapido();
    t0 = Date.now();
    const piezas: any[] = [];
    let error: any = null;
    try {
      for await (const p of M.hablarConManos([{ role: 'user', content: 'hola' }], [], undefined, o)) piezas.push(p);
    } catch (e) {
      error = e;
    }
    return { piezas, error };
  }

  it('con los de AU-RA cortos (100 ms, 300 ms) se rendía; con los de Electrum contesta GLM y no lanza de más', async () => {
    process.env.CEREBRO_VOZ_PRIMERA_MS = '100';
    process.env.CEREBRO_VOZ_TOTAL_MS = '300';
    process.env.CEREBRO_VOZ_LANZAMIENTOS = '3';
    const aura = await correr({ espacio: 'electrum' });
    assert.ok(aura.error, 'con los de AU-RA: sin primera señal a tiempo');
    assert.ok(lanzados.length >= 2, `y lanzó coberturas (${lanzados.length} pedidos)`);

    lanzados = [];
    const propios = await correr({ espacio: 'electrum', primeraMs: 1_000, totalMs: 2_000, lanzamientos: 2 });
    assert.equal(propios.error, null);
    assert.equal(propios.piezas.find((p) => 'modelo' in p)?.modelo, 'zai.glm-5');
    assert.equal(lanzados.length, 1, 'contestó dentro de su espera: ninguna cobertura');
  });

  it('lanzamientos manda: con 1, nunca una cobertura', async () => {
    const r = await correr({ espacio: 'electrum', primeraMs: 100, totalMs: 1_000, lanzamientos: 1 });
    assert.equal(r.error, null);
    assert.equal(lanzados.length, 1);
  });
});

/* ------------------------------------------------------------------ 5 · el visitante de la APK y el tope de voz */

describe('5 · quién es quien no tiene sesión del padrón', () => {
  it('la APK genera un visitante con la forma que acepta el servidor, y el servidor lo usa', () => {
    const v = visitaDeBytes(Uint8Array.from({ length: 16 }, (_, i) => i * 17));
    assert.match(v, FORMA_VISITA);
    assert.equal(v.length, 22);
    assert.equal(visitaValida(v), v);
    assert.equal(visitaValida('corto'), null);
    assert.equal(visitaValida(null), null);
    const base = { ip: '10.0.0.1', headers: { 'user-agent': 'okhttp' } };
    const conVisita = quienDelHilo(null, { ...base, headers: { ...base.headers, 'x-electrum-visita': v } });
    // Otra red, el mismo teléfono: la misma «persona» (el reintento encuentra su turno).
    assert.equal(quienDelHilo(null, { ip: '172.16.4.9', headers: { 'user-agent': 'okhttp', 'x-electrum-visita': v } }), conVisita);
    assert.notEqual(quienDelHilo(null, base), quienDelHilo(null, { ip: '172.16.4.9', headers: { 'user-agent': 'okhttp' } }), 'sin él, cambiar de red era otra persona');
  });

  it('el tope: la junta sin tope; el código DE- a nombre de su persona; sin sesión, visitante E IP', () => {
    assert.equal(cuentaVozDe({ persona: { id: 'jose' }, correo: 'j.herrera@ordenglobal.org', visitante: 'visita:a', ip: '1.1.1.1' }), null);
    assert.equal(cuentaVozDe({ persona: { id: 't-7' }, correo: 'codigo-7@temporal.drelectrum', visitante: 'visita:a', ip: '1.1.1.1' }), 'electrum:persona:t-7');
    const sinSesion = cuentaVozDe({ persona: null, visitante: 'visita:a', ip: '1.1.1.1' })!;
    assert.equal(sinSesion, 'electrum:visita:a|electrum:ip:1.1.1.1');

    // Rotar el visitante no da minutos nuevos: la IP ya los gastó.
    const usados = new Map<string, number>();
    const tope = 60_000;
    const restante = (q: string) => Math.max(0, tope - (usados.get(q) || 0));
    const anotar = (q: string, ms: number) => usados.set(q, (usados.get(q) || 0) + ms);
    anotarVozElectrum(sinSesion, 60_000, anotar);
    assert.equal(restanteVozElectrum(sinSesion, restante), 0);
    const rotado = cuentaVozDe({ persona: null, visitante: 'visita:b', ip: '1.1.1.1' })!;
    assert.equal(restanteVozElectrum(rotado, restante), 0, 'otro visitante desde la misma IP: sin minutos');
    const otraRed = cuentaVozDe({ persona: null, visitante: 'visita:c', ip: '2.2.2.2' })!;
    assert.equal(restanteVozElectrum(otraRed, restante), tope);
  });
});

/* ------------------------------------------------------------------ 6 · la voz de la mesa por /api/electrum/voz */

describe('6 · la mesa con su voz', () => {
  it('Don Chema y la Ing. Tatiana con la suya; el doctor (o lo que no se conoce), la de la plataforma', () => {
    assert.equal(vozDeLaMesa('chema'), PERSONAJES.chema.voz);
    assert.equal(vozDeLaMesa('tatiana'), PERSONAJES.tatiana.voz);
    assert.equal(vozDeLaMesa('electrum'), undefined);
    assert.equal(vozDeLaMesa('narrador'), undefined);
    assert.equal(vozDeLaMesa({}), undefined);
  });
});

/* ------------------------------------------------------------------ 8 · `en-curso` en la APK */

describe('8 · la misma pregunta sigue en curso', () => {
  const FRASE = 'Todavía estoy con esa misma pregunta; dame un momento y volvé a pedírmela.';
  it('por el stream: un 409 con el código y la frase del servidor (no «se me cayó el turno»)', async () => {
    const deps: DepsPedirTurno = {
      stream: (_c, alEvento) => ({
        promesa: new Promise<void>((ok) =>
          setTimeout(() => {
            alEvento('error', { error: FRASE, codigo: 'en-curso', enCurso: true });
            ok();
          }, 1)
        ),
        abortar: () => {},
      }),
      json: async () => ({}),
    };
    await assert.rejects(pedirTurno(deps, { mensaje: 'x', idTurno: 'cm-1' }, new TurnoEnVivo()).promesa, (e: any) => {
      assert.equal(e?.name, 'ErrorHttp');
      assert.equal(e.status, 409);
      assert.equal(e.codigo, CODIGO_EN_CURSO);
      assert.equal(e.detalle, FRASE);
      return true;
    });
  });

  it('la pantalla dice la frase del servidor, tal cual (por el stream o por el JSON)', () => {
    assert.equal(fraseDeError(new ErrorHttp(409, FRASE, CODIGO_EN_CURSO)), FRASE);
    assert.match(fraseDeError(new ErrorHttp(409, '', CODIGO_EN_CURSO)), /misma pregunta/);
    // Un 500 sigue siendo un 500.
    assert.match(fraseDeError(new ErrorHttp(500, 'Se me cayó el turno.')), /problema de su lado/);
  });
});
