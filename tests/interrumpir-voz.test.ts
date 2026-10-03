/**
 * Hablarle encima como a una persona (José, 3-oct: «como ChatGPT con voz: si le interrumpo me escucha y
 * vuelve y me dice ok, está bien… que sienta que me escucha»).
 *
 * Lo que se prueba es lo que siente la persona:
 *  - su eco (la voz de AU-RA que entra al micrófono) y los «ajá», «sí», «ok» no la cortan;
 *  - un «espera», «oye» o dos palabras suyas la cortan al instante;
 *  - lo que dijo la persona llega limpio, sin el eco con que pudo empezar;
 *  - el cerebro sabe hasta dónde oyó y abre con un acuse corto, sin perdón y sin repetirse.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RegistroVoz, esInterrupcionReal, palabras, quitarEco, recortarFrase, soloEcoOMuletilla } from '../mobile/src/lib/interrupcion';
import { MotorTurbo, type TrozoAudio, type WsTurbo } from '../mobile/src/lib/turboMotor';
import { esInterrupcion } from '../src/03-voz/useOido';
import { conAcuse, hechoInterrumpida, oidoAlInterrumpir } from '../lib/interrumpida';
import { oidoDeLaAnterior, perdonEnVoz } from '../server/voz-agente';

const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const DICE = 'El clima en Tegucigalpa hoy es de veintiocho grados, con lluvias por la tarde.';

describe('Interrumpir: ¿es la persona, su eco o un «ajá»?', () => {
  it('su propio eco no la corta, aunque el oído lo entienda a medias', () => {
    assert.equal(esInterrupcionReal('el clima en Tegucigalpa', [DICE]), false);
    assert.equal(esInterrupcionReal('hoy es de veintiocho grado', [DICE]), false, 'una palabra cortada sigue siendo eco');
    assert.equal(esInterrupcionReal('con lluvia por la tard', [DICE]), false);
  });

  it('un «ajá», «sí», «ok» de quien escucha no la corta (como ChatGPT, que sigue)', () => {
    for (const m of ['ajá', 'sí', 'Ok.', 'mhm', 'sí, claro', 'ajá ajá', 'okay', 'ya']) assert.equal(esInterrupcionReal(m, [DICE]), false, m);
  });

  it('«espera», «para», «oye»… la cortan con una sola palabra', () => {
    for (const f of ['Espera.', 'para', 'Oye', '¡Alto!', 'momento', 'wait']) assert.equal(esInterrupcionReal(f, [DICE]), true, f);
  });

  it('dos palabras suyas la cortan; mezcladas con su eco también, si son la mitad', () => {
    assert.equal(esInterrupcionReal('mejor dime de San Pedro', [DICE]), true);
    assert.equal(esInterrupcionReal('grados mejor San Pedro', [DICE]), true);
    assert.equal(esInterrupcionReal('el clima en Tegucigalpa hoy es de mmm Pedro', [DICE]), false, 'una palabra rara entre mucho eco no basta');
  });

  it('sin saber qué dice (o en silencio): dos palabras que no sean muletilla, o un freno', () => {
    assert.equal(esInterrupcion('eh'), false);
    assert.equal(esInterrupcion('¿Me-'), false);
    assert.equal(esInterrupcion('Oye, Aura'), true);
    assert.equal(esInterrupcion('espera un momento'), true);
    assert.equal(esInterrupcion('Oye.'), true, '«oye» es de cortar');
    assert.equal(esInterrupcion('sí claro'), false, 'dos muletillas no son dos palabras suyas');
  });

  it('frase entera oída mientras hablaba: solo eco o muletilla no es pedido', () => {
    assert.equal(soloEcoOMuletilla('Ajá, sí.', [DICE]), true);
    assert.equal(soloEcoOMuletilla('con lluvias por la tarde', [DICE]), true);
    assert.equal(soloEcoOMuletilla('pon música', [DICE]), false);
  });

  it('la frase de quien cortó llega sin el eco con que empezó', () => {
    assert.equal(quitarEco('de veintiocho grados espera mejor dime de San Pedro', [DICE]), 'Espera mejor dime de San Pedro');
    assert.equal(quitarEco('el de San Pedro', [DICE]), 'el de San Pedro', 'una sola palabra al comienzo puede ser suya: no se toca');
    assert.equal(quitarEco('grados con lluvias', [DICE]), 'grados con lluvias', 'si no queda nada suyo, va como llegó');
    assert.equal(quitarEco('pon música', []), 'pon música');
  });

  it('palabras: sin tildes ni signos', () => {
    assert.deepEqual(palabras('¡Espérate, AURA!'), ['esperate', 'aura']);
  });
});

describe('Interrumpir: qué alcanzó a oír', () => {
  it('las frases que sonaron enteras y el trozo de la que cortó', () => {
    let reloj = 0;
    const r = new RegistroVoz(() => reloj);
    r.nuevoTurno();
    r.empezo('Hoy hace calor.');
    reloj += 1500;
    r.termino();
    r.empezo('Mañana llueve en toda la zona norte del país.');
    reloj += 800;
    assert.equal(r.hablando(), true);
    assert.deepEqual(r.dichos(), ['Hoy hace calor.', 'Mañana llueve en toda la zona norte del país.']);
    assert.equal(r.cortar(0.5), 'Hoy hace calor. Mañana llueve en toda la…');
    assert.equal(r.hablando(), false);
    assert.equal(r.tomarCortada(), 'Hoy hace calor. Mañana llueve en toda la…');
    assert.equal(r.tomarCortada(), null, 'una sola vez');
  });

  it('sin la posición del audio, lo estima por el tiempo', () => {
    let reloj = 0;
    const r = new RegistroVoz(() => reloj);
    r.empezo('Uno dos tres cuatro cinco seis siete ocho.'); // 42 letras ≈ 3 s
    reloj += 1500;
    assert.match(r.cortar(), /^Uno dos tres cuatro…$/);
  });

  it('el eco reciente se olvida a los pocos segundos; un pedido nuevo empieza de cero', () => {
    let reloj = 0;
    const r = new RegistroVoz(() => reloj, 6000);
    r.empezo('Primera frase.');
    reloj += 1000;
    r.termino();
    reloj += 7000;
    assert.deepEqual(r.dichos(), []);
    r.empezo('Otra.');
    r.callo();
    assert.equal(r.hablando(), false);
    assert.deepEqual(r.dichos(), ['Otra.'], 'lo que se calló por otra cosa queda como eco reciente');
    r.nuevoTurno();
    assert.equal(r.cortar(), '', 'sin nada sonando no hubo a quién cortar');
    assert.equal(r.tomarCortada(), null);
  });

  it('recortar una frase por la fracción oída', () => {
    assert.equal(recortarFrase('Uno dos tres cuatro.', 1), 'Uno dos tres cuatro.');
    assert.equal(recortarFrase('Uno, dos, tres, cuatro.', 0.5), 'Uno, dos…');
    assert.equal(recortarFrase('Uno dos', 0.1), '');
  });
});

// ── el motor Turbo oyendo encima de su voz ───────────────────────────────────────────────────────
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
  get commits() {
    return this.enviados.filter((m) => m.commit).length;
  }
}

function banco() {
  let reloj = 1_000_000;
  const ws: WsFalso[] = [];
  const finales: string[] = [];
  const parciales: string[] = [];
  const encima: string[] = [];
  const aperturas: boolean[] = [];
  let alTrozo: ((t: TrozoAudio) => void) | null = null;
  let abierto = false;
  const motor = new MotorTurbo({
    ahora: () => reloj,
    abrirMic: async (cb, _f, conEco) => {
      aperturas.push(!!conEco);
      alTrozo = cb;
      abierto = true;
      return () => {
        abierto = false;
        alTrozo = null;
      };
    },
    permiso: async () => ({ url: 'wss://falso/1' }),
    crearWs: (url) => {
      const w = new WsFalso(url);
      ws.push(w);
      setTimeout(() => w.abrir(), 1);
      return w;
    },
    transcribirWav: async () => '',
    tiempos: { esperaFinalMs: 60, confirmarMs: 200, inactivoMs: 10_000 },
  });
  motor.setCallbacks({
    onFinal: (t) => finales.push(t),
    onPartial: (t) => parciales.push(t),
    onPartialEncima: (t) => encima.push(t),
  });
  let n = 0;
  const trozoDb = (db: number) => {
    reloj += 100;
    n++;
    alTrozo?.({ audio: Buffer.alloc(3200, n & 255).toString('base64'), db });
  };
  const voz = (k: number, db = -20) => {
    for (let i = 0; i < k; i++) trozoDb(db);
  };
  const silencio = (k: number) => {
    for (let i = 0; i < k; i++) trozoDb(-75);
  };
  return { motor, ws, finales, parciales, encima, aperturas, voz, silencio, abierto: () => abierto };
}

describe('Interrumpir: el oído Turbo sigue abierto mientras AU-RA habla', () => {
  it('con «interrumpir hablando» el micrófono abre con cancelación de eco y no se cierra al hablar ella', async () => {
    const b = banco();
    b.motor.setOirEncima(true);
    b.motor.activar();
    await espera();
    assert.deepEqual(b.aperturas, [true], 'abre con la fuente de llamada (cancelación de eco)');
    b.motor.pausar(true);
    assert.equal(b.abierto(), true, 'sigue oyendo mientras ella habla');
    assert.equal(b.motor.oyendoEncima(), true);
    assert.equal(b.motor.escuchando(), true);
    b.motor.pausar(false);
    assert.equal(b.motor.oyendoEncima(), false);
    assert.equal(b.aperturas.length, 1, 'no se reabre nada');
  });

  it('su eco: los parciales van aparte y la frase se cierra sin entregarse; la siguiente sale limpia', async () => {
    const b = banco();
    b.motor.setOirEncima(true);
    b.motor.activar();
    await espera();
    b.silencio(10);
    b.motor.pausar(true);
    b.voz(8, -14); // su voz en el micrófono, por encima del margen
    await espera();
    const w = b.ws[0];
    w.decir({ message_type: 'partial_transcript', text: 'el clima en Tegucigalpa' });
    assert.deepEqual(b.encima, ['el clima en Tegucigalpa']);
    assert.deepEqual(b.parciales, [], 'no se enseña como si lo dijera la persona');
    b.silencio(7);
    assert.equal(w.commits, 1, 'cierra la frase del eco para que no quede pegada a la siguiente');
    w.decir({ message_type: 'committed_transcript', text: 'El clima en Tegucigalpa.' });
    await espera();
    assert.deepEqual(b.finales, [], 'el eco no es un pedido');
    // Terminó de hablar: la persona habla después, normal.
    b.motor.pausar(false);
    b.voz(8);
    await espera();
    w.decir({ message_type: 'partial_transcript', text: 'gracias' });
    b.silencio(6);
    w.decir({ message_type: 'committed_transcript', text: 'Gracias.' });
    await espera();
    assert.deepEqual(b.finales, ['Gracias.'], 'solo lo suyo, sin el eco de antes');
  });

  it('al terminar ella con un eco a medias: se cierra y se tira, sin pegarse a lo que siga', async () => {
    const b = banco();
    b.motor.setOirEncima(true);
    b.motor.activar();
    await espera();
    b.silencio(10);
    b.motor.pausar(true);
    b.voz(8, -14);
    await espera();
    const w = b.ws[0];
    b.motor.pausar(false);
    assert.equal(w.commits, 1);
    w.decir({ message_type: 'committed_transcript', text: 'por la tarde' });
    await espera();
    assert.deepEqual(b.finales, []);
  });

  it('su eco suave (lo que deja la cancelación) no abre frases: tiene que pasar el umbral por un margen', async () => {
    const b = banco();
    b.motor.setOirEncima(true);
    b.motor.activar();
    await espera();
    b.silencio(20); // ruido -75 → umbral de voz -55
    b.motor.pausar(true);
    b.voz(30, -52); // pasaría el umbral normal, no el de «hablando ella»
    await espera();
    assert.equal(b.ws.length, 0, 'ni se abre el WebSocket');
  });

  it('la persona la interrumpe: toma el turno y su frase llega entera', async () => {
    const b = banco();
    b.motor.setOirEncima(true);
    b.motor.activar();
    await espera();
    b.silencio(10);
    b.motor.pausar(true);
    b.voz(6, -14);
    await espera();
    const w = b.ws[0];
    w.decir({ message_type: 'partial_transcript', text: 'espera mejor' });
    assert.equal(b.motor.tomarTurno(), true);
    assert.equal(b.motor.oyendoEncima(), false);
    assert.equal(b.motor.estaPausado(), false);
    w.decir({ message_type: 'partial_transcript', text: 'espera mejor dime de San Pedro' });
    assert.deepEqual(b.parciales, ['espera mejor dime de San Pedro'], 'desde que tomó el turno, se enseña');
    b.voz(4);
    b.silencio(6);
    assert.equal(w.commits, 1);
    w.decir({ message_type: 'committed_transcript', text: 'Espera, mejor dime de San Pedro.' });
    await espera();
    assert.deepEqual(b.finales, ['Espera, mejor dime de San Pedro.']);
    // La voz cortada suelta la pausa: no cambia nada (ya no estaba en pausa).
    b.motor.pausar(false);
    assert.equal(b.abierto(), true);
  });

  it('el texto del eco tarda más que la espera: esa conexión se cierra y no se cuela en la frase siguiente', async () => {
    const b = banco();
    b.motor.setOirEncima(true);
    b.motor.activar();
    await espera();
    b.silencio(10);
    b.motor.pausar(true);
    b.voz(8, -14);
    await espera();
    const viejo = b.ws[0];
    b.motor.pausar(false);
    assert.equal(viejo.commits, 1);
    await espera(90); // pasa esperaFinalMs (60) sin respuesta de Turbo
    assert.equal(viejo.cerrado, true, 'la conexión con el eco pendiente se cierra');
    // Llega tarde el texto del eco por la conexión vieja: ya no la escucha nadie.
    viejo.decir({ message_type: 'committed_transcript', text: 'por la tarde' });
    b.voz(8);
    await espera();
    const nuevo = b.ws.at(-1)!;
    assert.notEqual(nuevo, viejo, 'la frase de la persona va por una conexión nueva');
    b.silencio(7);
    nuevo.decir({ message_type: 'committed_transcript', text: 'Pon música.' });
    await espera();
    assert.deepEqual(b.finales, ['Pon música.'], 'sin «por la tarde» delante');
  });

  it('sin «interrumpir hablando»: como antes, el micrófono se cierra mientras ella habla', async () => {
    const b = banco();
    b.motor.setOirEncima(false);
    b.motor.activar();
    await espera();
    assert.deepEqual(b.aperturas, [false], 'abre con la fuente de dictado');
    b.motor.pausar(true);
    assert.equal(b.abierto(), false);
    assert.equal(b.motor.tomarTurno(), false);
    b.motor.pausar(false);
    await espera();
    assert.equal(b.abierto(), true);
  });

  it('cambiar el ajuste con el micrófono abierto lo reabre con la fuente nueva', async () => {
    const b = banco();
    b.motor.activar();
    await espera();
    assert.deepEqual(b.aperturas, [false]);
    b.motor.setOirEncima(true);
    await espera();
    assert.deepEqual(b.aperturas, [false, true]);
  });
});

describe('Oído: cuánto tarda cada frase (para los logs)', () => {
  it('mide lo que habló y lo que tardó la frase en salir desde que calló', async () => {
    const b = banco();
    const medidas: any[] = [];
    b.motor.setCallbacks({ onFinal: (t) => b.finales.push(t), onMedida: (m) => medidas.push(m) });
    b.motor.activar();
    await espera();
    b.silencio(10);
    b.voz(12);
    await espera();
    const w = b.ws[0];
    w.decir({ message_type: 'partial_transcript', text: 'abre Excel' });
    b.silencio(5);
    w.decir({ message_type: 'committed_transcript', text: 'Abre Excel.' });
    await espera();
    assert.deepEqual(b.finales, ['Abre Excel.']);
    assert.equal(medidas.length, 1);
    assert.equal(medidas[0].via, 'vivo');
    assert.equal(medidas[0].vozMs, 1100, 'de la primera a la última voz: 12 trozos de 0,1 s');
    assert.equal(medidas[0].trasCallarMs, 500, 'los 0,5 s de silencio que cierran la frase');
  });
});

describe('Interrumpir: el cerebro sabe dónde quedó', () => {
  it('lee lo que oyó del cuerpo del turno (y no se lo cree entero)', () => {
    assert.equal(oidoAlInterrumpir({}), null);
    assert.equal(oidoAlInterrumpir({ interrumpido: true }), null);
    assert.equal(oidoAlInterrumpir({ interrumpido: { oido: '  Hoy hace «calor»  ' } }), 'Hoy hace calor');
    assert.equal(oidoAlInterrumpir({ interrumpido: {} }), '', 'cortada antes de la primera palabra');
    assert.equal(oidoAlInterrumpir({ interrumpido: { oido: 'x'.repeat(900) } })!.length, 400);
  });

  it('el hecho pide un acuse corto, sin perdón, y dice lo que no oyó', () => {
    const es = hechoInterrumpida('es', 'Hoy hace calor. Mañana…');
    assert.match(es, /TE INTERRUMPIÓ/);
    assert.match(es, /«Hoy hace calor\. Mañana…»/);
    assert.match(es, /NO lo oyó/);
    assert.match(es, /«Va\.»/);
    assert.match(es, /sin pedir perdón/);
    assert.match(hechoInterrumpida('es', ''), /antes de la primera palabra/);
    assert.match(hechoInterrumpida('en', 'It is hot'), /no apologies/);
  });

  it('lo que sale sin el modelo (cálculo, precio) también abre con el acuse, después de su etiqueta', () => {
    assert.equal(conAcuse('El oro está a 4 100 dólares.'), 'Va. El oro está a 4 100 dólares.');
    assert.equal(conAcuse('[feliz] Listo, son 30 gramos.'), '[feliz] Va. Listo, son 30 gramos.');
    assert.equal(conAcuse('It is 30 grams.', 'en'), 'Okay. It is 30 grams.');
    assert.equal(conAcuse(''), '');
  });

  it('la conversación en vivo: lo que oyó de la anterior, y el perdón solo si era larga', () => {
    const corta = [{ role: 'assistant', content: 'Hoy hace calor...' }, { role: 'user', content: 'espera' }];
    assert.equal(oidoDeLaAnterior(corta, ''), 'Hoy hace calor');
    assert.equal(perdonEnVoz(corta, ''), false);
    const larga = [{ role: 'assistant', content: 'a'.repeat(200) }, { role: 'user', content: 'espera' }];
    assert.equal(perdonEnVoz(larga, ''), true);
  });
});
