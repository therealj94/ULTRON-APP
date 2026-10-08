/**
 * La voz y el oído de la app de Dr Electrum, sin teléfono (mobile/src/electrum/turnoVivo.ts, colaVoz.ts y
 * manosLibres.ts; la segunda escucha del campo en lib/turboMotor.ts). Lo que se prueba es lo que siente quien está en
 * el cerro: que la respuesta empiece a sonar con la primera frase y no se repita al llegar el final; que una pregunta
 * no se conteste dos veces aunque la red se caiga al mandarla; que el eco del doctor y un «ajá» no lo corten y la
 * persona sí; que el micrófono tenga un solo dueño; que la basura del reconocedor no se mande.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RegistroVoz } from '../mobile/src/lib/interrupcion';
import { MotorTurbo, type TrozoAudio, type WsTurbo } from '../mobile/src/lib/turboMotor';
import type { EstadoSonido, Reproducible } from '../mobile/src/lib/sonidoVivo';
import { ColaVoz, GUARDIA_VOZ_CAMPO, guardiaVozAlAbrir, guardiaVozCampoValida, type PedidoVoz } from '../mobile/src/electrum/colaVoz';
import { ErrorHttp } from '../mobile/src/electrum/frases';
import {
  CLAVE_MANOS_LIBRES,
  SEGUNDA_ESCUCHA_CAMPO,
  cortaAlPensar,
  decidirEncima,
  duenoMic,
  esAlucinacion,
  fraseOida,
  manosLibresGuardado,
} from '../mobile/src/electrum/manosLibres';
import {
  CorteStream,
  TurnoCancelado,
  TurnoEnVivo,
  finValido,
  interrumpidoDe,
  nuevoIdTurno,
  partirEnFrases,
  pedirTurno,
  porDecirAlFin,
  type CuerpoTurno,
  type DepsPedirTurno,
} from '../mobile/src/electrum/turnoVivo';

const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ el turno en vivo */

describe('Dr Electrum móvil: el turno en vivo', () => {
  it('junta las frases en su orden, sin repetir, y tira lo raro', () => {
    const t = new TurnoEnVivo();
    assert.equal(t.evento('frase', { i: 1, texto: 'La segunda.', voz: '[calm] La segunda.' })?.tipo, 'frase');
    assert.equal(t.evento('frase', { i: 0, texto: 'La primera.' })?.tipo, 'frase');
    assert.equal(t.evento('frase', { i: 0, texto: 'Repetida.' }), null, 'una frase repetida no cuenta dos veces');
    assert.equal(t.evento('frase', { i: -1, texto: 'x' }), null);
    assert.equal(t.evento('frase', { i: 2, texto: '' }), null);
    assert.equal(t.evento('raro', { i: 3 }), null);
    assert.equal(t.textoVisible(), 'La primera. La segunda.');
    assert.equal(t.frases[0].voz, 'La primera.', 'sin `voz`, se dice el texto');
    assert.equal(t.frases[1].voz, '[calm] La segunda.');
    t.evento('herramienta', { herramienta: 'catastro_en_punto', ok: true, resumen: '2 concesiones', ms: 300 });
    t.evento('panel', { panel: 'Legal Minero' });
    t.evento('ui', { tipo: 'informe', id: 'a1' });
    assert.equal(t.traza.length, 1);
    assert.equal(t.panel, 'Legal Minero');
    assert.equal(t.ui.length, 1);
    t.evento('fin', { texto: 'La primera. La segunda. Y el final.', frases: 2, idioma: 'es' });
    assert.equal(t.textoVisible(), 'La primera. La segunda. Y el final.', 'el fin reemplaza lo crecido');
    assert.equal(t.fin?.frases, 2);
  });

  it('el fin de la mesa trae a cada uno con su personaje; uno desconocido se ignora', () => {
    const f = finValido({ texto: '', voces: [{ quien: 'chema', texto: 'Ahí hay veta.' }, { quien: 'pirata', texto: 'Arr.' }, { quien: 'tatiana', texto: 'Con permiso de SERNA.' }] });
    assert.deepEqual(
      f?.voces?.map((v) => v.quien),
      ['chema', 'tatiana']
    );
    assert.match(f!.texto, /veta/);
    assert.equal(finValido({ texto: '   ' }), null);
  });

  it('al llegar el fin no se repite lo que ya sonó', () => {
    const encoladas = ['Vencen tres este año.', 'La primera es Quebrada Seca.'];
    assert.deepEqual(porDecirAlFin({ texto: 'Vencen tres este año. La primera es Quebrada Seca.', frases: 2 }, encoladas), []);
    // Servidor sin el dato de cuántas mandó: se compara por el texto y se dice solo lo que falta.
    const resto = porDecirAlFin({ texto: 'Vencen tres este año. La primera es Quebrada Seca. Las otras dos en diciembre.' }, encoladas);
    assert.deepEqual(
      resto.map((f) => f.texto),
      ['Las otras dos en diciembre.']
    );
    // El final corrige lo dicho: la pantalla enseña lo bueno y la voz no vuelve a empezar.
    assert.deepEqual(porDecirAlFin({ texto: 'Vencen cuatro este año. Son estas.' }, encoladas), []);
  });

  it('sin frases del stream (servidor viejo, respuesta fija): se dice todo, por frases y en su idioma', () => {
    const r = porDecirAlFin({ texto: 'Buen día. Soy **Dr Electrum**, a sus órdenes.', idioma: 'en', emocion: 'calma' });
    assert.deepEqual(
      r.map((f) => f.texto),
      ['Buen día.', 'Soy Dr Electrum, a sus órdenes.']
    );
    assert.ok(r.every((f) => f.idioma === 'en' && f.emocion === 'calma'));
    // `voz` (con sus etiquetas de expresión) manda sobre el texto para lo que se dice.
    assert.deepEqual(
      porDecirAlFin({ texto: 'Hola.', voz: '[warmly] Hola, ingeniero.' }).map((f) => f.texto),
      ['[warmly] Hola, ingeniero.']
    );
  });

  it('la mesa: cada intervención con la voz de su personaje', () => {
    const r = porDecirAlFin({ texto: 'x', voces: [{ quien: 'chema', texto: 'Yo abriría un socavón.' }, { quien: 'electrum', texto: 'Primero el muestreo.' }] });
    assert.deepEqual(
      r.map((f) => [f.personaje, f.texto]),
      [
        ['chema', 'Yo abriría un socavón.'],
        ['electrum', 'Primero el muestreo.'],
      ]
    );
    assert.deepEqual(porDecirAlFin({ texto: 'x', voces: [{ quien: 'chema', texto: 'Ya sonó.' }] }, ['Ya sonó.']), []);
  });

  it('partir en frases respeta los títulos y las cifras, junta las colas cortas y no pasa del tope', () => {
    assert.deepEqual(partirEnFrases('El Dr. Gómez firmó 1.500 hectáreas. Sí. Luego vino INHGEOMIN.'), ['El Dr. Gómez firmó 1.500 hectáreas. Sí.', 'Luego vino INHGEOMIN.']);
    const largo = Array.from({ length: 60 }, (_, i) => `tramo ${i}`).join(', ') + '.';
    const partes = partirEnFrases(largo, 120);
    assert.ok(partes.length > 3);
    assert.ok(partes.every((p) => p.length <= 120));
    assert.equal(partes.join(' ').replace(/\s+/g, ' '), largo);
    assert.deepEqual(partirEnFrases('   '), []);
  });

  it('cada pregunta lleva un id distinto; lo oído al cortar viaja con tope', () => {
    const a = nuevoIdTurno(1000, () => 0.1);
    const b = nuevoIdTurno(1000, () => 0.2);
    assert.match(a, /^cm-[0-9a-z]+-[0-9a-z]{8}$/);
    assert.notEqual(a, b);
    assert.equal(interrumpidoDe(''), undefined);
    assert.deepEqual(interrumpidoDe('Vencen tres'), { oido: 'Vencen tres' });
    assert.ok(interrumpidoDe('x'.repeat(2000))!.oido.length <= 401);
  });
});

/* ------------------------------------------------------------------ pedir el turno: reintento y respaldo */

type Guion = Array<{ eventos?: Array<[string, unknown]>; error?: Error }>;

function transporte(o: { streams: Guion; json?: Array<unknown | Error> }) {
  const cuerpos: { via: string; cuerpo: CuerpoTurno }[] = [];
  let sinStream = false;
  let abortados = 0;
  const deps: DepsPedirTurno = {
    stream: (cuerpo, alEvento) => {
      cuerpos.push({ via: 'stream', cuerpo });
      const paso = o.streams.shift() || { error: new CorteStream('red') };
      let abortar = () => {};
      const promesa = new Promise<void>((resolver, rechazar) => {
        abortar = () => {
          abortados++;
          rechazar(new Error('abortado'));
        };
        setTimeout(() => {
          for (const [n, d] of paso.eventos || []) alEvento(n, d);
          if (paso.error) rechazar(paso.error);
          else resolver();
        }, 2);
      });
      return { promesa, abortar: () => abortar() };
    },
    json: async (cuerpo) => {
      cuerpos.push({ via: 'json', cuerpo });
      const r = (o.json || []).shift();
      if (r instanceof Error) throw r;
      return r;
    },
    sinStream: () => sinStream,
    alSinStream: () => {
      sinStream = true;
    },
  };
  return { deps, cuerpos, sinStream: () => sinStream, abortados: () => abortados };
}

const CUERPO: CuerpoTurno = { mensaje: '¿qué vence?', idTurno: 'cm-1-abc', hilo: [] };

describe('Dr Electrum móvil: pedir el turno', () => {
  it('por el stream: las frases llegan una a una y el fin cierra', async () => {
    const t = transporte({ streams: [{ eventos: [['frase', { i: 0, texto: 'Hola.' }], ['fin', { texto: 'Hola.', frases: 1 }]] }] });
    const vistos: string[] = [];
    const r = await pedirTurno(t.deps, CUERPO, new TurnoEnVivo(), (e) => vistos.push(e.tipo)).promesa;
    assert.equal(r.via, 'stream');
    assert.equal(r.fin.texto, 'Hola.');
    assert.deepEqual(vistos, ['frase', 'fin']);
  });

  it('servidor sin el stream (404): la ruta de siempre con el mismo cuerpo, y no se vuelve a probar', async () => {
    const t = transporte({ streams: [{ error: new CorteStream('sin-ruta', '404') }], json: [{ texto: 'De la ruta de siempre.' }, { texto: 'Otra.' }] });
    const r = await pedirTurno(t.deps, CUERPO, new TurnoEnVivo()).promesa;
    assert.equal(r.via, 'json');
    assert.equal(r.fin.texto, 'De la ruta de siempre.');
    assert.equal(t.sinStream(), true);
    await pedirTurno(t.deps, { ...CUERPO, idTurno: 'cm-2' }, new TurnoEnVivo()).promesa;
    assert.deepEqual(
      t.cuerpos.map((c) => c.via),
      ['stream', 'json', 'json']
    );
  });

  it('sin red al mandarla: se repite UNA vez el stream, con el mismo idTurno', async () => {
    const t = transporte({ streams: [{ error: new CorteStream('red') }, { eventos: [['fin', { texto: 'Llegó.' }]] }] });
    const r = await pedirTurno(t.deps, CUERPO, new TurnoEnVivo()).promesa;
    assert.equal(r.fin.texto, 'Llegó.');
    assert.equal(t.cuerpos.length, 2);
    assert.ok(t.cuerpos.every((c) => c.cuerpo.idTurno === 'cm-1-abc'), 'el mismo id: el servidor no la contesta dos veces');
  });

  it('sin red dos veces: se rinde con un error de red (la pantalla dice «sin señal»)', async () => {
    const t = transporte({ streams: [{ error: new CorteStream('red') }, { error: new CorteStream('red') }] });
    await assert.rejects(pedirTurno(t.deps, CUERPO, new TurnoEnVivo()).promesa, (e: any) => e instanceof CorteStream && /Network request failed/.test(e.message));
    assert.equal(t.cuerpos.length, 2, 'una sola repetición');
  });

  it('se cortó a medias (ya sonaban frases): la respuesta entera por la ruta de siempre, mismo id', async () => {
    const t = transporte({ streams: [{ eventos: [['frase', { i: 0, texto: 'Vencen tres.' }]], error: new CorteStream('red') }], json: [{ texto: 'Vencen tres. Son estas.' }] });
    const turno = new TurnoEnVivo();
    const r = await pedirTurno(t.deps, CUERPO, turno).promesa;
    assert.equal(r.via, 'json');
    assert.equal(r.fin.texto, 'Vencen tres. Son estas.');
    assert.equal(turno.frases.length, 1, 'lo que llegó se queda (ya sonó)');
    assert.deepEqual(
      t.cuerpos.map((c) => [c.via, c.cuerpo.idTurno]),
      [
        ['stream', 'cm-1-abc'],
        ['json', 'cm-1-abc'],
      ]
    );
    assert.deepEqual(porDecirAlFin(r.fin, ['Vencen tres.']).map((f) => f.texto), ['Son estas.']);
  });

  it('el stream se cerró sin decir nada (un proxy que no lo deja pasar): la ruta de siempre', async () => {
    const t = transporte({ streams: [{ eventos: [] }], json: [{ texto: 'Por JSON.' }] });
    const r = await pedirTurno(t.deps, CUERPO, new TurnoEnVivo()).promesa;
    assert.equal(r.fin.texto, 'Por JSON.');
  });

  it('la ruta de siempre sin red: una vez más con el mismo cuerpo', async () => {
    const t = transporte({ streams: [{ error: new CorteStream('sin-ruta') }], json: [new TypeError('Network request failed'), { texto: 'A la segunda.' }] });
    const r = await pedirTurno(t.deps, CUERPO, new TurnoEnVivo()).promesa;
    assert.equal(r.fin.texto, 'A la segunda.');
    assert.equal(t.cuerpos.filter((c) => c.via === 'json').length, 2);
  });

  it('el servidor cuenta que se le cayó el turno: un 500 con su frase, sin reintentar', async () => {
    const t = transporte({ streams: [{ eventos: [['error', { error: 'Se me cayó el turno. Volvé a preguntarme.' }]] }] });
    // Por el nombre: bajo tsx, frases.ts puede cargarse dos veces (ESM desde la prueba, CJS desde turnoVivo.ts).
    await assert.rejects(pedirTurno(t.deps, CUERPO, new TurnoEnVivo()).promesa, (e: any) => e?.name === ErrorHttp.name && e.status === 500 && /cayó el turno/.test(e.detalle));
    assert.equal(t.cuerpos.length, 1);
  });

  it('cancelar (le hablaron encima): corta la petición y rechaza con TurnoCancelado', async () => {
    const t = transporte({ streams: [{ eventos: [['frase', { i: 0, texto: 'Hola.' }]] }] });
    const p = pedirTurno(t.deps, CUERPO, new TurnoEnVivo());
    p.abortar();
    await assert.rejects(p.promesa, (e: any) => e instanceof TurnoCancelado);
    assert.equal(t.abortados(), 1);
  });
});

/* ------------------------------------------------------------------ la cola de voz */

class SonidoFalso implements Reproducible {
  cb: ((st: EstadoSonido) => void) | null = null;
  tocado = false;
  parado = false;
  soltado = false;
  constructor(readonly texto: string) {}
  setOnPlaybackStatusUpdate(cb: ((st: EstadoSonido) => void) | null) {
    this.cb = cb;
  }
  async playAsync() {
    this.tocado = true;
    this.cb?.({ isLoaded: true, isPlaying: true, positionMillis: 0, durationMillis: 1000 });
  }
  async stopAsync() {
    this.parado = true;
  }
  async unloadAsync() {
    this.soltado = true;
  }
  avanzar(ms: number) {
    this.cb?.({ isLoaded: true, isPlaying: true, positionMillis: ms, durationMillis: 1000 });
  }
  terminar() {
    this.cb?.({ isLoaded: true, isPlaying: false, positionMillis: 1000, durationMillis: 1000, didJustFinish: true });
  }
}

function colaDePrueba(o: { nulos?: string[] } = {}) {
  const pedidos: PedidoVoz[] = [];
  const sonidos: SonidoFalso[] = [];
  const encadenados: string[] = [];
  const avisos: string[] = [];
  const registro = new RegistroVoz(() => 0);
  const cola = new ColaVoz(
    {
      preparar: async (p) => {
        pedidos.push(p);
        if (o.nulos?.includes(p.texto)) return null;
        const s = new SonidoFalso(p.texto);
        sonidos.push(s);
        return s;
      },
      encadenar: (actual) => encadenados.push((actual as SonidoFalso).texto),
      registro,
    },
    {
      alEmpezar: () => avisos.push('empieza'),
      alSonar: (t) => avisos.push(`suena:${t}`),
      alTerminar: (c) => avisos.push(`fin:${c}`),
    }
  );
  const sonando = () => sonidos.find((s) => s.tocado && !s.soltado);
  return { cola, pedidos, sonidos, encadenados, avisos, registro, sonando };
}

describe('Dr Electrum móvil: la voz frase por frase', () => {
  it('dice en orden, la primera con el modelo rápido, la siguiente preparada y pegada detrás', async () => {
    const c = colaDePrueba();
    c.cola.decir({ texto: 'Vencen tres.' });
    await espera();
    c.cola.decir({ texto: 'La primera es Quebrada Seca.', personaje: 'chema' });
    await espera();
    assert.deepEqual(
      c.pedidos.map((p) => [p.texto, p.primera]),
      [
        ['Vencen tres.', true],
        ['La primera es Quebrada Seca.', false],
      ]
    );
    assert.equal(c.pedidos[1].personaje, 'chema');
    assert.deepEqual(c.encadenados, ['Vencen tres.'], 'la de detrás se pega a la que suena');
    assert.deepEqual(c.avisos, ['empieza', 'suena:Vencen tres.']);
    assert.deepEqual(c.registro.dichos(), ['Vencen tres.'], 'el registro sabe qué dice (eco)');
    c.sonando()!.terminar();
    await espera();
    assert.equal(c.sonando()?.texto, 'La primera es Quebrada Seca.');
    c.cola.cerrar();
    assert.equal(c.cola.termino, false, 'cerrada, pero todavía suena la última');
    c.sonando()!.terminar();
    await espera();
    assert.equal(c.cola.termino, true);
    assert.equal(c.avisos.at(-1), 'fin:terminado');
    assert.equal(c.pedidos.length, 2, 'nada se pidió dos veces');
  });

  it('callar corta ya: lo que suena se para, lo preparado se suelta y nada vuelve a sonar', async () => {
    const c = colaDePrueba();
    c.cola.decir({ texto: 'Una frase.' });
    c.cola.decir({ texto: 'Otra frase.' });
    await espera();
    const primera = c.sonando()!;
    primera.avanzar(500);
    assert.equal(c.cola.fraccion(), 0.5);
    assert.equal(c.registro.cortar(c.cola.fraccion()), 'Una…', 'lo que alcanzó a oír: media frase');
    c.cola.callar();
    c.cola.callar();
    await espera();
    assert.equal(primera.parado, true);
    assert.ok(c.sonidos.every((s) => s.soltado), 'todo soltado');
    assert.deepEqual(c.avisos.filter((a) => a.startsWith('fin')), ['fin:cancelado'], 'una sola vez');
    c.cola.decir({ texto: 'Tarde.' });
    await espera();
    assert.equal(c.pedidos.some((p) => p.texto === 'Tarde.'), false);
  });

  it('una frase sin voz (el servidor no la dio) se salta; lo de solo signos ni se pide', async () => {
    const c = colaDePrueba({ nulos: ['Sin voz.'] });
    c.cola.decir({ texto: 'Sin voz.' });
    c.cola.decir({ texto: '…' });
    c.cola.decir({ texto: 'Con voz.' });
    c.cola.cerrar();
    await espera();
    assert.deepEqual(
      c.pedidos.map((p) => p.texto),
      ['Sin voz.', 'Con voz.']
    );
    assert.equal(c.sonando()?.texto, 'Con voz.');
    c.sonando()!.terminar();
    await espera();
    assert.equal(c.avisos.at(-1), 'fin:terminado');
  });

  it('cerrada sin nada que decir: termina en el acto', () => {
    const c = colaDePrueba();
    c.cola.cerrar();
    assert.deepEqual(c.avisos, ['fin:terminado']);
  });

  it('la guardia del reproductor en streaming: una caída con la voz arrancando bloquea la sesión; dos, por días', () => {
    const ahora = 10 * GUARDIA_VOZ_CAMPO.ventanaMs;
    assert.deepEqual(guardiaVozAlAbrir({}, ahora), { estado: { golpes: [] }, bloqueada: false });
    const una = guardiaVozAlAbrir({ arrancando: ahora - 1000, golpes: [] }, ahora);
    assert.equal(una.bloqueada, true);
    assert.deepEqual(una.estado.golpes, [ahora - 1000]);
    // La sesión siguiente, sin marca nueva: un golpe solo no la bloquea.
    assert.equal(guardiaVozAlAbrir(una.estado, ahora + 1000).bloqueada, false);
    assert.equal(guardiaVozAlAbrir({ golpes: [ahora - 5000, ahora - 1000] }, ahora).bloqueada, true, 'dos golpes recientes');
    assert.equal(guardiaVozAlAbrir({ golpes: [1, 2] }, ahora).bloqueada, false, 'golpes viejos caducan');
    assert.deepEqual(guardiaVozCampoValida('basura'), {});
    assert.deepEqual(guardiaVozCampoValida({ arrancando: 'x', golpes: [1, 'y', 2] }), { golpes: [1, 2] });
  });
});

/* ------------------------------------------------------------------ manos libres */

describe('Dr Electrum móvil: manos libres', () => {
  it('apagado por omisión: solo «1» guardado lo enciende', () => {
    assert.equal(CLAVE_MANOS_LIBRES, 'electrum_manos_libres_v1');
    assert.equal(manosLibresGuardado(null), false);
    assert.equal(manosLibresGuardado('0'), false);
    assert.equal(manosLibresGuardado('true'), false);
    assert.equal(manosLibresGuardado('1'), true);
  });

  it('un solo dueño del micrófono', () => {
    const base = { manosLibres: true, posible: true, dictando: false, camara: false, appActiva: true };
    assert.equal(duenoMic(base), 'manos');
    assert.equal(duenoMic({ ...base, dictando: true }), 'dictado', 'el botón manda: manos libres suelta el micrófono');
    assert.equal(duenoMic({ ...base, camara: true }), 'nadie');
    assert.equal(duenoMic({ ...base, appActiva: false }), 'nadie');
    assert.equal(duenoMic({ ...base, posible: false }), 'nadie', 'sin el micrófono crudo (APK vieja, iOS) no hay manos libres');
    assert.equal(duenoMic({ ...base, manosLibres: false }), 'nadie');
    assert.equal(duenoMic({ ...base, manosLibres: false, dictando: true }), 'dictado');
  });

  it('la basura del reconocedor no se manda; las respuestas cortas de verdad, sí', () => {
    for (const b of ['Subtítulos realizados por la comunidad de Amara.org', 'Gracias por ver el video.', '[Música]', '(aplausos)', '♪ ♪', 'la la la la', 'eh... mmm', '...', 'Suscríbete al canal']) {
      assert.equal(esAlucinacion(b), true, b);
      assert.equal(fraseOida(b), null, b);
    }
    for (const v of ['sí', 'Gracias.', '¿Qué vence este año?', 'no no', 'arma el informe de Quebrada Seca']) assert.equal(esAlucinacion(v), false, v);
    assert.equal(fraseOida('"¿Y la segunda?"'), '¿Y la segunda?');
  });

  it('la frase de quien cortó al doctor sin el eco del doctor delante', () => {
    const dichos = ['La concesión Quebrada Seca vence en diciembre de este año'];
    assert.equal(fraseOida('vence en diciembre de este año espera mejor dime la de Danlí', { eco: dichos }), 'Espera mejor dime la de Danlí');
  });

  it('mientras habla: su eco y un «ajá» no lo cortan; «espera» o una pregunta nueva, sí', () => {
    const dichos = ['La concesión Quebrada Seca vence en diciembre'];
    assert.equal(decidirEncima('quebrada seca vence', dichos), 'seguir', 'su propio eco');
    assert.equal(decidirEncima('ajá', dichos), 'seguir');
    assert.equal(decidirEncima('ok sí', dichos), 'seguir');
    assert.equal(decidirEncima('espera', dichos), 'cortar');
    assert.equal(decidirEncima('y la de Danlí cuándo', dichos), 'cortar');
  });

  it('mientras piensa: un «ok» de quien espera no corta la pregunta; otra pregunta sí', () => {
    assert.equal(cortaAlPensar('ok'), false);
    assert.equal(cortaAlPensar('ajá sí'), false);
    assert.equal(cortaAlPensar('mejor dime la de Danlí'), true);
    assert.equal(cortaAlPensar('para'), true);
  });

  it('la segunda escucha del campo: las cifras y los montos; «veta» es geología, no la wallet', () => {
    assert.equal(SEGUNDA_ESCUCHA_CAMPO.confirmar('250.000 toneladas a 3,4 g/t'), true);
    assert.equal(SEGUNDA_ESCUCHA_CAMPO.confirmar('cuánto vale en lempiras'), true);
    assert.equal(SEGUNDA_ESCUCHA_CAMPO.confirmar('qué ley tiene la veta'), false);
    assert.equal(SEGUNDA_ESCUCHA_CAMPO.sinCorroborar('la veta de 3 metros'), 'la veta de 3 metros');
  });
});

/* ------------------------------------------------------------------ el motor de AU-RA con la segunda escucha del campo */

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

function oidoDePrueba(o: { confirmado: string; campo: boolean }) {
  let reloj = 1_000_000;
  const ws: WsFalso[] = [];
  const confirmaciones: boolean[] = [];
  const finales: string[] = [];
  let alTrozo: ((t: TrozoAudio) => void) | null = null;
  const motor = new MotorTurbo({
    ahora: () => reloj,
    abrirMic: async (cb) => {
      alTrozo = cb;
      return () => {
        alTrozo = null;
      };
    },
    permiso: async () => ({ url: 'wss://falso' }),
    crearWs: () => {
      const w = new WsFalso();
      ws.push(w);
      setTimeout(() => w.abrir(), 1);
      return w;
    },
    transcribirWav: async (_wav, confirmar) => {
      confirmaciones.push(confirmar);
      return confirmar ? o.confirmado : '';
    },
    tiempos: { esperaFinalMs: 60, confirmarMs: 200, sondeoMs: 0 },
    ...(o.campo ? { segundaEscucha: SEGUNDA_ESCUCHA_CAMPO } : {}),
  });
  motor.setCallbacks({ onFinal: (t) => finales.push(t) });
  const trozo = (voz: boolean) => {
    reloj += 100;
    alTrozo?.({ audio: Buffer.alloc(3200, 1).toString('base64'), db: voz ? -20 : -75 });
  };
  const frase = async (turbo: string) => {
    motor.activar();
    await espera();
    for (let i = 0; i < 10; i++) trozo(true);
    await espera();
    for (let i = 0; i < 8; i++) trozo(false);
    ws[0].decir({ message_type: 'committed_transcript', text: turbo });
    await espera(20);
    // Sin temporizadores colgados (el WebSocket inactivo): la prueba termina en cuanto acaba.
    motor.destruir();
  };
  return { frase, confirmaciones, finales };
}

describe('Dr Electrum móvil: el oído de AU-RA con la segunda escucha del campo', () => {
  it('sin `segundaEscucha` (AU-RA) todo sigue igual: el dinero se confirma y, sin corroborar, pide confirmación', async () => {
    const b = oidoDePrueba({ confirmado: '', campo: false });
    await b.frase('Mándale 5 ORIGEN a Ana');
    assert.deepEqual(b.confirmaciones, [true]);
    assert.match(b.finales[0], /sin verificar/);
  });

  it('con la del campo: «veta» no paga otra transcripción; una cifra sí, y sin corroborar sale como se oyó', async () => {
    const a = oidoDePrueba({ confirmado: 'no importa', campo: true });
    await a.frase('¿Qué ley tiene la veta?');
    assert.deepEqual(a.confirmaciones, []);
    assert.deepEqual(a.finales, ['¿Qué ley tiene la veta?']);
    const b = oidoDePrueba({ confirmado: '', campo: true });
    await b.frase('250000 toneladas a 3,4 gramos');
    assert.deepEqual(b.confirmaciones, [true]);
    assert.deepEqual(b.finales, ['250000 toneladas a 3,4 gramos'], 'sin el aviso de dinero de AU-RA');
    const c = oidoDePrueba({ confirmado: '250.000 toneladas a 3,4 gramos.', campo: true });
    await c.frase('250 mil toneladas a 34 gramos');
    assert.deepEqual(c.finales, ['250.000 toneladas a 3,4 gramos.'], 'corroborada: vale la de Scribe v2');
  });
});
