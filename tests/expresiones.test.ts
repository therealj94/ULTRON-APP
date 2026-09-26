/**
 * Expresiones de voz ([risa], [suspiro]…) y el banco de clips nuevo: canciones del estudio, frases
 * grabadas con Dora y reacciones al tacto.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXPRESIONES, ETIQUETAS_EXPRESION, MAX_EXPRESIONES, expresionDe, instruccionExpresiones, quitarExpresiones, trocearExpresiones } from '../lib/expresiones';
import * as movil from '../mobile/src/lib/expresiones';
import { DIR_EXPRESIONES, adaptarPcm, empalmar, escribirWav, pcmDeToma, tomaDeExpresion } from '../server/empalme';
import { cancionPorPedido, claveVoz, hablar, repertorio } from '../server/voz';
import { buildPersonality } from '../server/desk';
import { personalidadElectrum } from '../server/electrum/personalidad';
import { extraerEmocion, inferirEmocion } from '../lib/emocion';
import { CANCIONES } from '../lib/capacidades';
import { BANCO, cancionDeTexto, clipDeEmocion, clipDeTexto, clipPorId, saludoDe } from '../src/03-voz/banco';
import { duracionWav, leerWav, type Pcm } from '../lib/mp3';
import { voiceboxFalso, conVoicebox, CLAVE_FALSA, wavDePrueba } from './voicebox-falso';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PUBLICO = path.join(RAIZ, 'public');

describe('las etiquetas que escribe el cerebro', () => {
  it('parte el texto en habla y expresiones, en orden', () => {
    assert.deepEqual(trocearExpresiones('Ay, no me digas [risa] eso no me lo sabía.'), [
      { tipo: 'habla', texto: 'Ay, no me digas' },
      { tipo: 'expresion', etiqueta: 'risa' },
      { tipo: 'habla', texto: 'eso no me lo sabía.' },
    ]);
    assert.deepEqual(trocearExpresiones('[suspiro aliviado] Listo, quedó.'), [
      { tipo: 'expresion', etiqueta: 'suspiro aliviado' },
      { tipo: 'habla', texto: 'Listo, quedó.' },
    ]);
  });

  it('entiende mayúsculas, tildes y las otras formas de escribirla', () => {
    assert.equal(expresionDe('Suspiro  Soñador'), 'suspiro soñador');
    assert.equal(expresionDe('suspiro sonador'), 'suspiro soñador');
    assert.equal(expresionDe('AJA'), 'ajá');
    assert.equal(expresionDe('risa tierna'), 'risita');
    assert.equal(expresionDe('softly'), null);
    assert.equal(expresionDe('risas'), null, 'no se adivina: solo la lista');
  });

  it('lo que no es una expresión se queda en el trozo hablado (ahí la voz lo quita)', () => {
    assert.deepEqual(trocearExpresiones('[softly] Hola. [short pause] Soy yo.'), [{ tipo: 'habla', texto: '[softly] Hola. [short pause] Soy yo.' }]);
    assert.deepEqual(trocearExpresiones('Ver el anexo [1].'), [{ tipo: 'habla', texto: 'Ver el anexo [1].' }]);
  });

  it(`pasado el tope de ${MAX_EXPRESIONES}, las que sobran no suenan`, () => {
    const p = trocearExpresiones('a [risa] b [je] c [ups] d [beso] e [aww] f');
    assert.equal(p.filter((x) => x.tipo === 'expresion').length, MAX_EXPRESIONES);
    const dicho = p.filter((x) => x.tipo === 'habla').map((x: any) => x.texto).join(' ');
    assert.ok(!/\[/.test(dicho), dicho);
    assert.match(dicho, /d e f/);
  });

  it('cada etiqueta tiene sus tomas en disco: WAV 24 kHz mono para empalmar y MP3 para el tacto', () => {
    for (const [etiqueta, tomas] of Object.entries(EXPRESIONES)) {
      assert.ok(tomas.length > 0, etiqueta);
      for (const toma of tomas) {
        const pcm = pcmDeToma(toma);
        assert.ok(pcm, `${toma}.wav no se lee`);
        assert.equal(pcm!.hz, 24000, toma);
        assert.equal(pcm!.canales, 1, toma);
        const seg = pcm!.muestras.length / pcm!.hz;
        assert.ok(seg > 0.2 && seg < 3, `${toma}: ${seg} s`);
        assert.ok(fs.existsSync(path.join(PUBLICO, 'voz', 'expresiones', `${toma}.mp3`)), `${toma}.mp3`);
      }
    }
    // Lo que está en disco y nadie usa es peso muerto en el repo.
    const usadas = new Set(Object.values(EXPRESIONES).flat());
    for (const f of fs.readdirSync(DIR_EXPRESIONES)) assert.ok(usadas.has(f.replace(/\.wav$/, '')), `sobra ${f}`);
    for (const f of fs.readdirSync(path.join(PUBLICO, 'voz', 'expresiones'))) assert.ok(usadas.has(f.replace(/\.mp3$/, '')), `sobra ${f}`);
  });

  it('elige una toma al azar entre las de esa expresión', () => {
    assert.equal(tomaDeExpresion('suspiro', () => 0)?.toma, 'suspiro-cansado-1');
    assert.equal(tomaDeExpresion('suspiro', () => 0.99)?.toma, 'suspiro-cansado-2');
    assert.equal(tomaDeExpresion('nada-de-esto'), null);
  });

  it('una toma que falta no tumba la expresión: prueba la otra', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expr-'));
    try {
      fs.copyFileSync(path.join(DIR_EXPRESIONES, 'ups-2.wav'), path.join(dir, 'ups-2.wav'));
      assert.equal(tomaDeExpresion('ups', () => 0, dir)?.toma, 'ups-2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('lo que se lee nunca enseña las etiquetas', () => {
  it('quita expresiones y etiquetas de audio sin dejar espacios raros', () => {
    assert.equal(quitarExpresiones('Ay, no me digas [risa] eso no me lo sabía.'), 'Ay, no me digas eso no me lo sabía.');
    assert.equal(quitarExpresiones('Qué bueno [risa].').trim(), 'Qué bueno.');
    assert.equal(quitarExpresiones('¡[sorpresa] No me digas!'), '¡No me digas!');
    assert.equal(quitarExpresiones('[suspiro] Bueno, vamos.').trim(), 'Bueno, vamos.');
    assert.equal(quitarExpresiones('Hola [risa][je] qué tal'), 'Hola qué tal');
    assert.equal(quitarExpresiones('Una etiqueta vieja [softly, warm] no se lee.'), 'Una etiqueta vieja no se lee.');
    assert.equal(quitarExpresiones('Algo que el modelo inventó [risas] tampoco.'), 'Algo que el modelo inventó tampoco.');
  });

  it('no toca referencias, nombres entre corchetes ni enlaces', () => {
    for (const t of ['Ver el anexo [1].', 'Según [Anexo A], sí.', 'Mirá [la fuente](https://ejemplo.org).', 'Oro : 2300 sin etiquetas']) {
      assert.equal(quitarExpresiones(t), t);
    }
  });

  it('trozo a trozo (como el stream) queda igual que de una vez', () => {
    const entero = 'Ay, José. [risa] Esa no me la sabía. ¿En serio subió tanto? [asombro] Bueno, [suspiro] vamos por partes.';
    // El servidor suelta hasta la última frase cerrada: cortes después de «. », «? », «! ».
    const trozos = ['Ay, José.', ' [risa] Esa no me la sabía.', ' ¿En serio subió tanto?', ' [asombro] Bueno, [suspiro] vamos por partes.'];
    assert.equal(trozos.join(''), entero);
    const leido = trozos.map(quitarExpresiones).join('').trim();
    assert.equal(leido, quitarExpresiones(entero).trim());
    assert.equal(leido, 'Ay, José. Esa no me la sabía. ¿En serio subió tanto? Bueno, vamos por partes.');
  });

  it('una expresión al principio no se confunde con la etiqueta de emoción', () => {
    const e = extraerEmocion('[EMO:risa] [risa] Ay, no.');
    assert.equal(e.emocion, 'risa');
    assert.equal(e.texto, '[risa] Ay, no.', 'la expresión se queda para la voz');
    assert.equal(extraerEmocion('[risa] Ay, no.').texto, '[risa] Ay, no.');
    assert.equal(inferirEmocion('[risa] Ay, no.'), 'risa');
  });

  it('el teléfono lleva la misma lista y lee igual', () => {
    for (const e of ETIQUETAS_EXPRESION) assert.equal(movil.expresionDe(e), e, e);
    for (const e of ['risa tierna', 'suspiro cansado', 'aja', 'ay', 'Suspiro Soñador', 'softly', 'risas', '1']) assert.equal(movil.expresionDe(e), expresionDe(e), e);
    for (const t of ['Ay [risa] no.', '¡[sorpresa] Uy!', '[softly] Hola.', 'Ver [1].', 'Mirá [x](https://a.b).', ' [je] Listo.']) {
      assert.equal(movil.quitarExpresiones(t), quitarExpresiones(t), t);
    }
  });

  it('para decir, el teléfono deja las expresiones y quita lo demás', () => {
    assert.equal(movil.soloExpresiones('[softly] Ay [Risa] no [suspiro soñador].'), ' Ay [risa] no [suspiro soñador].');
  });
});

describe('el empalme', () => {
  const tono = (n: number, v = 8000): Pcm => ({ muestras: new Int16Array(n).fill(v), canales: 1, hz: 24000 });

  it('el largo es la suma de las partes', () => {
    const partes = [tono(12000), tono(7000), tono(5000)];
    const out = empalmar(partes);
    assert.equal(out.muestras.length, 24000);
    assert.equal(out.hz, 24000);
    assert.equal(out.canales, 1);
  });

  it('funde en las uniones y no en los bordes: sin clics', () => {
    const out = empalmar([tono(2400), tono(2400)], 8);
    const f = Math.round((24000 * 8) / 1000);
    assert.equal(out.muestras[0], 8000, 'el principio del todo no se toca');
    assert.equal(out.muestras[out.muestras.length - 1], 8000, 'el final del todo no se toca');
    assert.equal(out.muestras[2399], 0, 'la primera pieza baja a cero en la unión');
    assert.equal(out.muestras[2400], 0, 'la segunda sube desde cero');
    assert.ok(out.muestras[2400 + f] === 8000 && out.muestras[2399 - f] === 8000, 'solo unos milisegundos');
  });

  it('no pega piezas de formatos distintos: primero se adaptan', () => {
    assert.throws(() => empalmar([tono(100), { muestras: new Int16Array(100), canales: 1, hz: 44100 }]));
    const estereo44: Pcm = { muestras: new Int16Array(44100 * 2).fill(1000), canales: 2, hz: 44100 };
    const a = adaptarPcm(estereo44, 24000, 1);
    assert.equal(a.hz, 24000);
    assert.equal(a.canales, 1);
    assert.equal(a.muestras.length, 24000, 'un segundo sigue siendo un segundo');
    assert.equal(a.muestras[500], 1000);
  });

  it('el WAV que sale se vuelve a leer igual', () => {
    const pcm = tono(4800, -1234);
    const back = leerWav(escribirWav(pcm))!;
    assert.equal(back.hz, 24000);
    assert.equal(back.canales, 1);
    assert.deepEqual(Array.from(back.muestras.slice(0, 5)), [-1234, -1234, -1234, -1234, -1234]);
    assert.equal(duracionWav(escribirWav(pcm)), 0.2);
  });
});

describe('hablar con expresiones contra Voicebox', () => {
  const segBeso = () => pcmDeToma('beso-mua-1')!.muestras.length / 24000;

  it('AU-RA: un trozo por llamada, en orden, y la toma grabada en medio', async (t) => {
    const vb = await voiceboxFalso({ voz: () => ({ audio: wavDePrueba(0.5) }) });
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      const out = await hablar({ texto: 'Te mando uno [beso] y me voy.', plataforma: 'ultron', sinCache: true });
      assert.ok(out);
      assert.equal(out!.contentType, 'audio/wav');
      assert.equal(out!.motor, 'voicebox:kokoro+expresiones');
      assert.deepEqual(
        vb.pedidos.map((p) => p.cuerpo.text).sort(),
        ['Te mando uno', 'y me voy.'].sort(),
        'dos llamadas, sin corchetes'
      );
      const pcm = leerWav(out!.audio)!;
      assert.equal(pcm.hz, 24000);
      assert.equal(pcm.muestras.length, 12000 + 12000 + pcmDeToma('beso-mua-1')!.muestras.length, 'habla + beso + habla');
      assert.ok(Math.abs(duracionWav(out!.audio) - (1 + segBeso())) < 0.001);
    });
  });

  it('Dr Electrum: la etiqueta se quita y no suena (su voz no es la de Dora)', async (t) => {
    const vb = await voiceboxFalso({ voz: () => ({ audio: wavDePrueba(0.5) }) });
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      const out = await hablar({ texto: 'Te mando uno [beso] y me voy.', plataforma: 'electrum', sinCache: true });
      assert.ok(out);
      assert.equal(vb.pedidos.length, 1);
      assert.equal(vb.pedidos[0].cuerpo.text, 'Te mando uno y me voy.');
      assert.equal(vb.pedidos[0].cuerpo.profile_id, 'c4259ed3-f15c-4fe7-a20c-6c59c877cf5c');
      assert.equal(out!.motor, 'voicebox:kokoro');
      assert.equal(duracionWav(out!.audio), 0.5, 'solo habla');
    });
  });

  it('la clave de caché lleva las expresiones', async (t) => {
    assert.notEqual(claveVoz('p', [{ tipo: 'habla', texto: 'Hola.' }]), claveVoz('p', [{ tipo: 'habla', texto: 'Hola.' }, { tipo: 'expresion', etiqueta: 'risa' }]));
    const vb = await voiceboxFalso({ voz: () => ({ audio: wavDePrueba(0.5) }) });
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      const con = await hablar({ texto: 'Caché con expresión [ups] al final.', plataforma: 'ultron' });
      const sin = await hablar({ texto: 'Caché con expresión al final.', plataforma: 'ultron' });
      assert.equal(con?.cache, false);
      assert.equal(sin?.cache, false, 'sin la expresión es otro audio: no sale de la caché');
      const otra = await hablar({ texto: 'Caché con expresión [ups] al final.', plataforma: 'ultron' });
      assert.equal(otra?.cache, true);
      assert.deepEqual(otra!.audio, con!.audio);
    });
  });

  it('solo una expresión: suena la toma, sin pedir voz', async (t) => {
    const vb = await voiceboxFalso();
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      const out = await hablar({ texto: '[beso]', plataforma: 'ultron', sinCache: true });
      assert.ok(out);
      assert.equal(vb.pedidos.length, 0);
      assert.ok(Math.abs(duracionWav(out!.audio) - segBeso()) < 0.001);
    });
  });

  it('si falta un trozo hablado, calla (null): no dice la frase a medias', async (t) => {
    let n = 0;
    const vb = await voiceboxFalso({ voz: () => (++n === 2 ? { status: 500, texto: 'boom' } : { audio: wavDePrueba(0.3) }) });
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      assert.equal(await hablar({ texto: 'Uno [risa] dos.', plataforma: 'ultron', sinCache: true }), null);
    });
  });

  it('si Voicebox no da PCM, dice el texto de una vez sin expresiones en vez de pegar ruido', async (t) => {
    const mp3 = Buffer.alloc(600, 0x55);
    const vb = await voiceboxFalso({ voz: () => ({ audio: mp3, tipo: 'audio/mpeg' }) });
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      const out = await hablar({ texto: 'Uno [risa] dos.', plataforma: 'ultron', sinCache: true });
      assert.ok(out);
      assert.equal(out!.contentType, 'audio/mpeg');
      assert.equal(vb.pedidos.at(-1)!.cuerpo.text, 'Uno dos.');
    });
  });

  it('un trozo sin letras no se le pide a Voicebox', async (t) => {
    const vb = await voiceboxFalso({ voz: () => ({ audio: wavDePrueba(0.4) }) });
    t.after(() => vb.cerrar());
    await conVoicebox(vb.url, CLAVE_FALSA, async () => {
      const out = await hablar({ texto: '¡[sorpresa] No me digas!', plataforma: 'ultron', sinCache: true });
      assert.ok(out);
      assert.equal(vb.pedidos.length, 1);
      assert.equal(vb.pedidos[0].cuerpo.text, 'No me digas!');
    });
  });
});

describe('el cerebro aprende las expresiones: AU-RA sí, Dr Electrum no', () => {
  it('el prompt de AU-RA las lista con sus reglas', () => {
    const p = buildPersonality({ nombre: 'José', canal: 'mesa', modo: 'GUARDIAN', mando: true } as any);
    assert.ok(p.includes(instruccionExpresiones()));
    for (const e of ETIQUETAS_EXPRESION) assert.ok(p.includes(`[${e}]`), e);
    assert.match(p, /uno, como mucho dos por respuesta/);
    assert.match(p, /dinero|legales/);
    assert.match(p, /no inventes otros/);
  });

  it('al doctor no se le nombran', () => {
    const p = personalidadElectrum({ nombre: 'José', nivel: 'mando', canal: 'mesa' });
    assert.ok(!p.includes('EXPRESIONES DE VOZ'));
    for (const e of ['[risa]', '[suspiro]', '[beso]', '[bostezo]']) assert.ok(!p.includes(e), e);
  });
});

describe('las canciones del estudio', () => {
  it('cada canción del repertorio tiene su MP3', () => {
    for (const c of CANCIONES) assert.ok(fs.existsSync(path.join(PUBLICO, 'voz', `${c.id}.mp3`)), c.id);
    assert.equal(repertorio().length, 11);
  });

  it('las versiones no se hacen pasar por las grabaciones de sus autores', () => {
    for (const id of ['jesus', 'waymaker']) {
      const c = CANCIONES.find((x) => x.id === id)!;
      assert.match(c.artista, /versión de AU-RA/);
      assert.match(clipPorId(id)!.texto!, /versión de AU-RA/);
    }
  });

  it('se piden en lenguaje natural (servidor y web)', () => {
    const casos: Array<[string, string]> = [
      ['cantame la canción de bienvenida', 'bienvenida'],
      ['canta feliz cumpleaños', 'felizdia'],
      ['cántame feliz día', 'felizdia'],
      ['canta una bendición', 'bendicion'],
      ['bendíceme cantando', 'bendicion'],
      ['cántame una canción de cuna', 'cuna'],
      ['canta una nana', 'cuna'],
      ['cantame para dormir', 'cuna'],
      ['canta quiero conocer a Jesús', 'jesus'],
      ['canta way maker', 'waymaker'],
      ['canta 1', 'bohemian'],
    ];
    for (const [pedido, id] of casos) {
      assert.equal(cancionPorPedido(pedido)?.id, id, `servidor: ${pedido}`);
      assert.equal(cancionDeTexto(pedido)?.id, id, `web: ${pedido}`);
    }
    assert.equal(cancionPorPedido('canta una banana'), null);
  });

  it('lo que AU-RA DICE no dispara una canción', () => {
    for (const t of ['Que Jesús te bendiga.', 'Feliz día, José.', 'Te mando una bendición.', 'Buenas noches.', 'Esa canción de cuna es linda.']) {
      assert.notEqual(clipDeTexto(t)?.cara, 'SING', t);
    }
  });

  it('el teléfono tiene el mismo repertorio', () => {
    const api = fs.readFileSync(path.join(RAIZ, 'mobile', 'src', 'lib', 'api.ts'), 'utf8');
    const bloque = api.slice(api.indexOf('CANCIONES_LOCAL'), api.indexOf('];', api.indexOf('CANCIONES_LOCAL')));
    const ids = [...bloque.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(ids, CANCIONES.map((c) => c.id).sort());
  });
});

describe('el banco de la web', () => {
  it('cada clip apunta a un archivo que existe', () => {
    for (const c of BANCO) assert.ok(fs.existsSync(path.join(PUBLICO, c.file)), `${c.id} → ${c.file}`);
    for (const c of BANCO) if (c.respaldo) assert.ok(clipPorId(c.respaldo), `${c.id}: respaldo ${c.respaldo}`);
  });

  it('las frases nuevas suenan cuando la respuesta es exactamente esa frase', () => {
    const nuevas = ['bienvenido', 'vertejose', 'vertemedardo', 'vertecarlos', 'vertemayra', 'holadenuevo', 'mealegra', 'unmomento', 'dameunsegundo', 'claroquesi', 'congusto', 'perfecto', 'yaesta', 'aquilotenes', 'noentendi', 'sinconexion', 'denada', 'cuandoquieras', 'hastaluego', 'quedescanses'];
    for (const id of nuevas) {
      const c = clipPorId(id)!;
      assert.ok(c?.texto, id);
      assert.equal(clipDeTexto(c.texto!)?.id, id, `«${c.texto}»`);
      assert.equal(clipDeTexto(`${c.texto} Y algo más.`)?.id, undefined, `${id} no se come una frase más larga`);
    }
  });

  it('saluda por nombre a la junta y da la bienvenida a los demás', () => {
    assert.equal(saludoDe('José').id, 'vertejose');
    assert.equal(saludoDe('Medardo Ordóñez').id, 'vertemedardo');
    assert.equal(saludoDe('mayra').id, 'vertemayra');
    assert.equal(saludoDe('Invitado').id, 'bienvenido');
    assert.equal(saludoDe('').id, 'bienvenido');
  });

  it('las reacciones al tacto usan las tomas del estudio, con el clip viejo de respaldo', () => {
    const risas = new Set<string>();
    for (const r of [0, 0.4, 0.8]) risas.add(clipDeEmocion('risa', () => r)!.id);
    assert.deepEqual([...risas].sort(), ['ex-je-picara-1', 'ex-risa-corta-1', 'ex-risa-tierna-1']);
    assert.equal(clipDeEmocion('risa')!.respaldo, 'risa1');
    assert.match(clipDeEmocion('sorpresa')!.id, /^ex-(sorpresa-oh|asombro-gasp)-/);
    assert.match(clipDeEmocion('pensando')!.id, /^ex-(mmm-pensando|hmm-dudando)-/);
    assert.equal(clipDeEmocion('ternura')!.id, 'ex-aww-ternura-1');
    assert.equal(clipDeEmocion('carino')!.cara, 'PURR');
    assert.match(clipDeEmocion('sueno')!.id, /^ex-bostezo-/);
    assert.equal(clipDeEmocion('neutral'), null);
  });
});

describe('el banco del teléfono', () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'mobile', 'src', 'lib', 'voiceBank.ts'), 'utf8');

  it('todo lo empaquetado existe y el APK crece poco', () => {
    const requeridos = [...fuente.matchAll(/require\('\.\.\/\.\.\/assets\/voice\/([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(requeridos.length >= 24);
    let total = 0;
    for (const f of requeridos) {
      const p = path.join(RAIZ, 'mobile', 'assets', 'voice', f);
      assert.ok(fs.existsSync(p), f);
      total += fs.statSync(p).size;
    }
    assert.ok(total < 500 * 1024, `${Math.round(total / 1024)} KB`);
    for (const id of ['risacorta', 'jepicara', 'sorpresaoh', 'mmmpensando', 'aww', 'bostezo', 'bienvenido', 'vertejose', 'hastaluego']) {
      assert.ok(requeridos.includes(`${id}.mp3`), `${id} va en el APK`);
    }
    for (const id of CANCIONES.map((c) => c.id)) assert.ok(!requeridos.includes(`${id}.mp3`), `${id}: las canciones no van en el APK`);
  });

  it('cada ruta remota la sirve el servidor', () => {
    const bloque = fuente.slice(fuente.indexOf('REMOTE_CLIPS'), fuente.indexOf('};', fuente.indexOf('REMOTE_CLIPS')));
    const rutas = [...bloque.matchAll(/: '(\/voz\/[^']+)'/g)].map((m) => m[1]);
    assert.ok(rutas.length >= 70);
    for (const r of rutas) assert.ok(fs.existsSync(path.join(PUBLICO, r)), r);
  });

  it('la frase exacta lleva a su clip', () => {
    for (const [frase, id] of [
      ['quebuenovertejose', 'vertejose'],
      ['bienvenidoaauraenqueteayudo', 'bienvenido'],
      ['hastaluego', 'hastaluego'],
      ['estoysinconexionahoramismo', 'sinconexion'],
    ]) {
      assert.match(fuente, new RegExp(`"${frase}": '${id}'`), frase);
    }
  });
});
