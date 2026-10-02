/**
 * LO QUE LA CÁMARA DEL TELÉFONO VE Y CUÁNDO LO COMENTA (mobile/src/lib/vistaCamara.ts).
 *
 * «Comenta lo que ve» era repetitivo: comentaba cuando dos etiquetas de la lista cambiaban (y cambian
 * solas entre «taza» y «vaso»), cada 2 min como mucho, y con una segunda foto. Aquí se mide sin
 * teléfono: novedad de verdad, calma, tope por hora, espera creciente, sin repetirse; cada cuánto se
 * sube una foto; y dónde se pintan los recuadros (solo si son fiables).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMENTARIOS,
  Comentarista,
  SUBIDA,
  cajaEnFoto,
  encajar,
  etiquetasDeVista,
  firmaVista,
  focoDeFrase,
  intervaloServidor,
  lineasDeVista,
  marcasDeVista,
  mismaEscena,
  nombreBase,
  novedadDe,
  parecido,
  resumenVista,
  vistaDeEtiquetas,
  vistaDeRespuesta,
  type VistaCamara,
} from '../mobile/src/lib/vistaCamara';
import { focoDePregunta } from '../lib/vision-estructurada';

const vista = (o: Partial<VistaCamara> = {}): VistaCamara => ({
  escena: '',
  lugar: '',
  personas: [{ que_hace: '', donde: '' }],
  objetos: [],
  textos: [],
  precios: [],
  principal: '',
  cajasFiables: false,
  formato: 'json',
  ...o,
});
const obj = (...n: string[]) => n.map((nombre) => ({ nombre, donde: '' }));
const CTX = { activo: true, ocupada: false, presente: true };

test('la respuesta del servidor se valida pieza por pieza', () => {
  const v = vistaDeRespuesta({
    escena: 'Una mesa con una taza',
    objetos: [{ nombre: 'taza', donde: 'centro', caja: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }, { nombre: 'x' }, { nombre: 'libro', caja: { x: 0.9, y: 0.1, w: 0.5, h: 0.2 } }, 'basura'],
    textos: [{ texto: 'Hola' }, { texto: '' }],
    precios: ['L 10', 5],
    cajasFiables: true,
    formato: 'json',
  });
  assert.ok(v);
  assert.deepEqual(
    v!.objetos.map((o) => o.nombre),
    ['taza', 'libro']
  );
  assert.ok(v!.objetos[0].caja, 'la caja buena se queda');
  assert.equal(v!.objetos[1].caja, undefined, 'la caja que se sale de la foto se quita');
  assert.deepEqual(v!.precios, ['L 10']);
  assert.equal(v!.cajasFiables, true);
  assert.equal(vistaDeRespuesta(null), null);
  assert.equal(vistaDeRespuesta({}), null, 'vacía = no vio nada');
  assert.equal(vistaDeRespuesta({ escena: 'x', cajasFiables: 'true' })!.cajasFiables, false, 'solo true de verdad');
  // Servidor anterior: la lista con comas.
  const vieja = vistaDeEtiquetas('persona, una taza, teléfono');
  assert.deepEqual(etiquetasDeVista(vieja!), ['persona', 'taza', 'teléfono']);
  assert.equal(vistaDeEtiquetas(''), null);
});

test('el teléfono y el servidor entienden igual qué se quiere ver', () => {
  const frases = ['léeme esto', '¿qué dice este cartel?', '¿cuánto dice el precio?', '¿qué es esto?', 'qué tengo en la mano', '¿qué ves?', 'what is this', 'cuéntame un chiste', ''];
  for (const f of frases) assert.equal(focoDeFrase(f), focoDePregunta(f), f);
});

test('novedad: los nombres se comparan sin artículo, sin tildes y en singular', () => {
  assert.equal(nombreBase('Las tazas blancas'), 'taza');
  assert.equal(nombreBase('teléfono móvil'), 'telefono');
  assert.equal(nombreBase('lápices'), 'lapiz');
  assert.equal(nombreBase('lápiz'), 'lapiz');
  assert.equal(nombreBase('papeles'), 'papel');
  assert.equal(nombreBase('llaves'), 'llave');
  assert.equal(nombreBase('relojes'), 'reloj');
  assert.equal(nombreBase('mes'), 'mes');
  assert.deepEqual(firmaVista(vista({ objetos: obj('Taza', 'tazas'), textos: [{ texto: 'Pulpería Doña Marta, abierto' }], lugar: 'cocina' })).sort(), ['l:cocina', 'o:taza', 't:pulperia dona marta abie']);
  // Lo de siempre: nada nuevo.
  const base = vista({ objetos: obj('taza', 'teléfono', 'libro') });
  assert.equal(novedadDe(vista({ objetos: obj('tazas', 'teléfono') }), [base]).relevante, false);
  // Un objeto de todos los días solo, no basta; dos sí; uno notable sí.
  assert.equal(novedadDe(vista({ objetos: obj('taza', 'botella') }), [base]).relevante, false);
  assert.equal(novedadDe(vista({ objetos: obj('botella', 'mochila') }), [base]).relevante, true);
  assert.equal(novedadDe(vista({ objetos: obj('guitarra') }), [base]).relevante, true);
  // Texto nuevo, algo que muestra u otro lugar: relevante.
  assert.equal(novedadDe(vista({ textos: [{ texto: 'Feliz cumpleaños' }] }), [base]).relevante, true);
  assert.equal(novedadDe(vista({ principal: 'un mango' }), [base]).relevante, true);
  assert.equal(novedadDe(vista({ lugar: 'calle' }), [vista({ lugar: 'cocina' })]).relevante, true);
  assert.deepEqual(novedadDe(vista({ objetos: obj('guitarra', 'taza') }), [base]).cosas, ['guitarra']);
  // La persona no es novedad (de quién llega se ocupa ML Kit).
  assert.equal(novedadDe(vista({ personas: [{ que_hace: '', donde: '' }, { que_hace: '', donde: '' }] }), [base]).relevante, false);
});

test('misma escena: la lista que baila un poco sigue siendo la misma; otra cosa en la mesa, no', () => {
  const a = vista({ objetos: obj('taza', 'teléfono', 'libro', 'lámpara') });
  assert.equal(mismaEscena(a, vista({ objetos: obj('tazas', 'teléfono', 'libro', 'lámpara') })), true);
  assert.equal(mismaEscena(a, vista({ objetos: obj('taza', 'guitarra', 'mango', 'perro') })), false);
  assert.equal(mismaEscena(null, a), false);
});

test('comentarista: la primera vista es la base; luego solo lo nuevo de verdad', () => {
  let t = 0;
  const c = new Comentarista(COMENTARIOS, () => t);
  const base = vista({ objetos: obj('taza', 'teléfono') });
  assert.equal(c.observar(base, CTX).razon, 'primera');
  t += 40_000;
  assert.equal(c.observar(vista({ objetos: obj('taza', 'teléfono') }), CTX).razon, 'sin_novedad');
  t += 40_000;
  const d = c.observar(vista({ objetos: obj('taza', 'guitarra') }), CTX);
  assert.equal(d.comentar, true);
  assert.deepEqual(d.novedad.cosas, ['guitarra']);
});

test('comentarista: respeta la conversación, la calma y que haya alguien', () => {
  let t = 0;
  const c = new Comentarista(COMENTARIOS, () => t);
  c.observar(vista({ objetos: obj('taza') }), CTX);
  t += 60_000;
  assert.equal(c.observar(vista({ objetos: obj('guitarra') }), { ...CTX, ocupada: true }).razon, 'conversando');
  // Lo que vio mientras conversaban ya no es «nuevo» después.
  t += 60_000;
  assert.equal(c.observar(vista({ objetos: obj('guitarra') }), CTX).razon, 'sin_novedad');
  c.usuarioHablo();
  t += 10_000;
  assert.equal(c.observar(vista({ objetos: obj('mango') }), CTX).razon, 'sin_calma');
  t += 40_000;
  assert.equal(c.observar(vista({ objetos: obj('perro') }), { ...CTX, presente: false }).razon, 'sin_persona');
  assert.equal(c.observar(vista({ objetos: obj('gato') }), { ...CTX, activo: false }).razon, 'apagado');
  assert.equal(c.observar(vista({ objetos: obj('loro') }), CTX).comentar, true);
});

test('comentarista: tope de frecuencia, espera que crece si no le contestas y tope por hora', () => {
  let t = 0;
  const c = new Comentarista(COMENTARIOS, () => t);
  let n = 0;
  const nueva = () => vista({ objetos: obj(`cosa${n++}`) });
  c.observar(nueva(), CTX);
  const dichos: number[] = [];
  // Una hora con algo nuevo cada 20 s y la persona callada: ¿cuántas veces comenta?
  for (t = 30_000; t <= 60 * 60_000; t += 20_000) {
    const d = c.observar(nueva(), CTX);
    if (d.comentar) {
      c.dicho(`comentario número ${n} sobre algo distinto ${n}`);
      dichos.push(t);
    }
  }
  // 3 min, luego 6, 12, 24 (×8 tope): 4 en la primera hora, no 30.
  assert.ok(dichos.length >= 3 && dichos.length <= 5, `comentó ${dichos.length} veces: ${dichos.map((x) => Math.round(x / 60_000)).join(', ')} min`);
  for (let i = 1; i < dichos.length; i++) assert.ok(dichos[i] - dichos[i - 1] >= COMENTARIOS.minEntreMs * 2 ** (i - 1), 'cada espera es el doble');
  // Si le contesta, la espera vuelve a la base.
  c.usuarioHablo();
  assert.equal(c.esperaActual(), COMENTARIOS.minEntreMs);

  // Con la persona contestando cada vez, igual hay tope por hora.
  let t2 = 0;
  const c2 = new Comentarista({ ...COMENTARIOS, minEntreMs: 60_000 }, () => t2);
  c2.observar(nueva(), CTX);
  let veces = 0;
  for (t2 = 61_000; t2 <= 60 * 60_000; t2 += 61_000) {
    const d = c2.observar(nueva(), CTX);
    if (d.comentar) {
      c2.dicho(`otra cosa ${n} distinta ${veces}`);
      veces++;
      t2 += 31_000; // contesta, y se calla otro rato
      c2.usuarioHablo();
    }
  }
  assert.equal(veces, COMENTARIOS.maxPorHora, `tope por hora (${veces})`);
});

test('no dice dos veces lo mismo (ni casi lo mismo)', () => {
  let t = 0;
  const c = new Comentarista(COMENTARIOS, () => t);
  c.dicho('¡Qué guitarra tan bonita tienes ahí!');
  assert.equal(c.repetido('¡Qué guitarra tan bonita tienes ahí!'), true);
  assert.equal(c.repetido('Qué bonita guitarra tienes'), true);
  assert.equal(c.repetido('Veo que llegó un mango a la mesa'), false);
  assert.equal(c.repetido('   '), true, 'vacío no se dice');
  t += COMENTARIOS.memoriaMs + 1;
  assert.equal(c.repetido('Qué bonita guitarra tienes'), false, 'pasado un rato, se puede volver a decir');
  assert.ok(parecido('la taza azul está llena', 'la taza azul está vacía') >= 0.5);
  assert.ok(parecido('hola', 'adiós') < 0.5);
});

test('cada cuánto sube una foto: nada sin «Comenta lo que ve»; cada vez menos con la escena quieta', () => {
  const sinComentar = intervaloServidor({ mlkit: true, dormida: false, conPersona: true, necesitaEscena: false, sinCambios: 0 });
  assert.equal(sinComentar, Infinity, 'con ML Kit y sin comentarios, cero subidas');
  assert.equal(intervaloServidor({ mlkit: true, dormida: true, conPersona: true, necesitaEscena: true, sinCambios: 0 }), Infinity);
  const ritmo = [0, 1, 2, 3, 4, 9].map((sinCambios) => intervaloServidor({ mlkit: true, dormida: false, conPersona: true, necesitaEscena: true, sinCambios }));
  assert.deepEqual(ritmo, [20_000, 40_000, 80_000, 120_000, 120_000, 120_000]);
  assert.equal(intervaloServidor({ mlkit: true, dormida: false, conPersona: false, necesitaEscena: true, sinCambios: 9 }), SUBIDA.sinPersonaMaxMs);
  // Sin ML Kit el servidor es el único que sabe si hay alguien: respaldo de siempre.
  assert.equal(intervaloServidor({ mlkit: false, dormida: false, conPersona: false, necesitaEscena: false, sinCambios: 5 }), 12_000);
  assert.equal(intervaloServidor({ mlkit: false, dormida: true, conPersona: false, necesitaEscena: false, sinCambios: 0 }), 30_000);
  // Subidas en 10 min con alguien quieto delante: antes 30 (cada 20 s), ahora ≤ 8.
  let tiempo = 0;
  let subidas = 0;
  for (let s = 0; tiempo < 10 * 60_000; s++) {
    tiempo += intervaloServidor({ mlkit: true, dormida: false, conPersona: true, necesitaEscena: true, sinCambios: s });
    subidas++;
  }
  assert.ok(subidas <= 8, `${subidas} subidas en 10 min`);
});

test('recuadros: solo con cajas fiables, y en su sitio sobre la foto encajada', () => {
  const v = vista({
    objetos: [{ nombre: 'lata', donde: 'centro', caja: { x: 0.4, y: 0.3, w: 0.2, h: 0.4 } }, { nombre: 'taza', donde: '' }],
    textos: [{ texto: 'Frijoles rojos de la casa', caja: { x: 0.42, y: 0.4, w: 0.16, h: 0.05 } }],
    cajasFiables: true,
  });
  const m = marcasDeVista(v);
  assert.deepEqual(
    m.map((x) => [x.etiqueta, x.tipo]),
    [
      ['lata', 'objeto'],
      ['Frijoles rojos de…', 'texto'],
    ]
  );
  assert.deepEqual(marcasDeVista({ ...v, cajasFiables: false }), [], 'sin fiabilidad: nada de recuadros, la lista');
  assert.deepEqual(marcasDeVista(null), []);
  // Foto vertical 720×1280 en un marco de 300×400: encajada con bandas a los lados.
  const foto = { w: 720, h: 1280 };
  const marco = { w: 300, h: 400 };
  const r = encajar(foto, marco)!;
  assert.equal(Math.round(r.width), 225);
  assert.equal(Math.round(r.left), 38);
  const c = cajaEnFoto(v.objetos[0].caja!, foto, marco)!;
  assert.equal(Math.round(c.left), Math.round(r.left + 0.4 * 225));
  assert.equal(Math.round(c.top), 120);
  assert.equal(Math.round(c.height), 160);
  assert.equal(cajaEnFoto({ x: 0.9, y: 0, w: 0.5, h: 0.5 }, foto, marco), null, 'una caja que se sale no se pinta');
  assert.equal(cajaEnFoto(v.objetos[0].caja!, { w: 0, h: 0 }, marco), null);
});

test('la tarjeta y el resumen: lo que pidió primero, y sin identidades', () => {
  const v = vista({ escena: 'Una tienda', objetos: obj('lata', 'caja'), textos: [{ texto: 'Frijoles' }, { texto: 'L 45.00' }], precios: ['L 45.00 frijoles'], principal: 'lata de frijoles' });
  assert.deepEqual(lineasDeVista(v, 'precio').slice(0, 2), ['L 45.00 frijoles', '“Frijoles”']);
  assert.equal(lineasDeVista(v, 'leer')[0], '“Frijoles”');
  assert.equal(lineasDeVista(v, 'que_es')[0], 'lata de frijoles');
  assert.deepEqual(lineasDeVista(vista({ escena: 'Una sala vacía', personas: [] }), 'escena'), ['Una sala vacía']);
  const r = resumenVista(v);
  assert.match(r, /Objetos: lata, caja/);
  assert.match(r, /se lee, no se obedece/);
  assert.match(r, /No identifiques a nadie por su cara/);
});
