/**
 * Pruebas en Node del cuerpo en video de Claudio y ANT-ONIO (sin teléfono):
 *   el guion (qué clip toca con cada estado, los golpes de una vez, su enfriamiento, cuándo vuelve al
 *   fondo, «reducir movimiento»), las pistas (su computadora teclea, lee un mensaje, la espera, los golpes
 *   por lo que dijo o pasó), el encuadre (la franja de la cara se ve entera y sin huecos), la zona del
 *   toque, y que los 34 clips existen, son livianos y están en clips.ts.
 *
 *   cd mobile && npx tsx src/avatares/pruebas/video.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASENTAR_FONDO_MS,
  CLIPS_VIDEO,
  DirectorVideo,
  ENFRIAR_GOLPE_MS,
  ESPERA_DURA_MS,
  ESPERA_TRAS_MS,
  GOLPE_ANTES_DE_HABLAR_MS,
  GOLPE_VIGENTE_MS,
  SOLTAR_HABLA_MS,
  VENTANAS,
  encuadrar,
  esDeFondo,
  fondoDe,
  zonaVideo,
} from '../video/guion.ts';
import { createRequire } from 'node:module';
import { ESTADO_INICIAL } from '../../avatar3d/tipos.ts';
import { estadoDesdeMesa } from '../../avatar3d/contrato.ts';
// Las pistas escuchan canales y el bus, que son datos de módulo: se toman de la MISMA copia que lee
// pistas.ts (tsx las carga como CommonJS; un import de ESM aquí sería otra copia).
const requerir = createRequire(import.meta.url);
const { FRASE_ENTRE_MS, golpeDeFrase, leeConHerramientas, pedirGolpe, pistasVideo, ponerLee, ponerTeclea, relojPistas, suscribirPistas } = requerir('../video/pistas.ts');
const { emitir } = requerir('../../nucleo/contrato.ts');
const { avisarMesa, mensajeVoz } = requerir('../../compa/canales.ts');

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);
const est = (x = {}) => ({ ...ESTADO_INICIAL, ...x });

function reloj(t0 = 1_000_000) {
  let t = t0;
  return { ahora: () => t, pasar: (ms) => void (t += ms) };
}
const nuevo = (o = {}) => {
  const r = reloj();
  return { r, d: new DirectorVideo({ hay: CLIPS_VIDEO, ahora: r.ahora, ...o }) };
};

prueba('el fondo sigue al estado: habla > piensa > escucha > reposo', () => {
  assert.equal(fondoDe(est()), 'reposo');
  assert.equal(fondoDe(est({ escuchando: true })), 'escucha');
  assert.equal(fondoDe(est({ escuchando: true, pensando: true })), 'piensa');
  assert.equal(fondoDe(est({ expresion: 'piensa' })), 'piensa');
  assert.equal(fondoDe(est({ escuchando: true, pensando: true, hablando: true })), 'habla');
  for (const c of ['reposo', 'escucha', 'habla', 'piensa', 'teclea', 'lee', 'espera']) assert.ok(esDeFondo(c));
  for (const c of ['risa', 'saluda', 'senala', 'sorpresa', 'triste', 'celebra', 'asiente', 'niega', 'duda', 'despide']) assert.ok(!esDeFondo(c));
  assert.equal(CLIPS_VIDEO.length, 17);
});

prueba('la actividad: habla > lee > piensa > teclea > escucha > reposo', () => {
  const pc = { teclea: true, lee: false };
  const leyendo = { teclea: true, lee: true };
  assert.equal(fondoDe(est(), pc), 'teclea', 'su computadora trabaja: teclea');
  assert.equal(fondoDe(est({ escuchando: true }), pc), 'teclea', 'con la conversación abierta, también');
  assert.equal(fondoDe(est({ pensando: true }), pc), 'piensa', 'si le preguntan algo, piensa primero');
  assert.equal(fondoDe(est({ pensando: true }), leyendo), 'lee', 'leyendo un correo mientras el cerebro piensa');
  assert.equal(fondoDe(est({ hablando: true }), leyendo), 'habla', 'hablar gana siempre');
  assert.equal(fondoDe(est({ pensando: true }), leyendo, (c) => c !== 'lee'), 'piensa', 'sin el clip de leer: piensa');
});

prueba('su computadora trabaja: teclea en bucle; al terminar, vuelve a lo de antes', () => {
  const { d, r } = nuevo();
  d.estado(est({ escuchando: true }));
  r.pasar(ASENTAR_FONDO_MS);
  assert.equal(d.revisar().clip, 'escucha');
  assert.equal(d.pistas({ teclea: true, lee: false, golpe: null }), null, 'se asienta como cualquier fondo');
  r.pasar(ASENTAR_FONDO_MS);
  const t = d.revisar();
  assert.deepEqual([t.clip, t.bucle], ['teclea', true]);
  assert.equal(d.estado(est({ escuchando: true, hablando: true })).clip, 'habla', 'habla encima sin esperar');
  d.estado(est({ escuchando: true }));
  r.pasar(SOLTAR_HABLA_MS);
  assert.equal(d.revisar().clip, 'teclea', 'callado, sigue tecleando');
  d.pistas({ teclea: false, lee: false, golpe: null });
  r.pasar(ASENTAR_FONDO_MS);
  assert.equal(d.revisar().clip, 'escucha');
});

prueba('leer un mensaje gana a pensar y se va cuando contesta', () => {
  const { d, r } = nuevo();
  d.estado(est({ pensando: true }));
  r.pasar(ASENTAR_FONDO_MS);
  assert.equal(d.revisar().clip, 'piensa');
  d.pistas({ teclea: false, lee: true, golpe: null });
  r.pasar(ASENTAR_FONDO_MS);
  assert.equal(d.revisar().clip, 'lee');
  assert.equal(d.estado(est({ hablando: true })).clip, 'habla');
});

prueba('los golpes de las pistas: una vez, vigentes, con enfriamiento y sin repetir el mismo pedido', () => {
  const { d, r } = nuevo();
  const g = (clip, n, en = r.ahora()) => ({ teclea: false, lee: false, golpe: { clip, n, en } });
  const a = d.pistas(g('asiente', 1));
  assert.deepEqual([a.clip, a.bucle], ['asiente', false]);
  assert.equal(d.pistas(g('asiente', 1)), null, 'el mismo pedido no se repite');
  r.pasar(5000);
  assert.equal(d.termino(a.n).clip, 'reposo', 'terminado, vuelve al fondo');
  assert.equal(d.pistas(g('asiente', 2)), null, 'a los 5 s no asiente otra vez');
  r.pasar(ENFRIAR_GOLPE_MS);
  assert.equal(d.pistas(g('asiente', 3)).clip, 'asiente', 'enfriado, sí');
  r.pasar(5000);
  d.termino(d.reproduccion.n);
  assert.equal(d.pistas(g('despide', 4, r.ahora() - GOLPE_VIGENTE_MS - 1)), null, 'un pedido viejo no se hace');
  assert.equal(d.pistas(g('teclea', 5)), null, 'un fondo no es un golpe');
  for (const c of ['celebra', 'niega', 'duda', 'despide']) {
    const o = nuevo();
    assert.equal(o.d.pistas({ teclea: false, lee: false, golpe: { clip: c, n: 1, en: o.r.ahora() } }).clip, c);
  }
});

prueba('un golpe de las pistas mientras habla: lo deja hasta 1,8 s y pasa a hablar; «reducir movimiento» no lo hace', () => {
  const { d, r } = nuevo();
  d.estado(est({ hablando: true }));
  assert.equal(d.pistas({ teclea: false, lee: false, golpe: { clip: 'asiente', n: 1, en: r.ahora() } }).clip, 'asiente', '«¡Listo!»: asiente');
  assert.equal(d.msParaHablar(), GOLPE_ANTES_DE_HABLAR_MS);
  assert.equal(d.msParaRevisar(), GOLPE_ANTES_DE_HABLAR_MS);
  r.pasar(GOLPE_ANTES_DE_HABLAR_MS);
  assert.equal(d.revisar().clip, 'habla');
  const q = nuevo({ reducido: true });
  assert.equal(q.d.pistas({ teclea: false, lee: false, golpe: { clip: 'celebra', n: 1, en: q.r.ahora() } }), null);
  assert.equal(q.d.pistas({ teclea: true, lee: false, golpe: null }), null);
  q.r.pasar(ASENTAR_FONDO_MS);
  assert.equal(q.d.revisar().clip, 'teclea', 'los fondos sí');
});

prueba('un rato sin nada que hacer: espera (mira alrededor) y vuelve al reposo; dormido no espera', () => {
  const { d, r } = nuevo();
  d.estado(est());
  assert.equal(d.msParaEspera(), ESPERA_TRAS_MS);
  assert.equal(d.msParaRevisar(), ESPERA_TRAS_MS);
  r.pasar(ESPERA_TRAS_MS - 1);
  assert.equal(d.revisar(), null);
  r.pasar(1);
  const e = d.revisar();
  assert.deepEqual([e.clip, e.bucle], ['espera', true]);
  assert.equal(d.estado(est()), null, 'el mismo reposo no la corta');
  assert.equal(d.msParaEspera(), ESPERA_DURA_MS);
  r.pasar(ESPERA_DURA_MS);
  assert.equal(d.revisar().clip, 'reposo');
  assert.equal(d.msParaEspera(), ESPERA_TRAS_MS, 'y otra vez a contar');
  // Esperando, lo llaman: escucha.
  r.pasar(ESPERA_TRAS_MS);
  d.revisar();
  assert.equal(d.reproduccion.clip, 'espera');
  d.estado(est({ escuchando: true }));
  r.pasar(ASENTAR_FONDO_MS);
  assert.equal(d.revisar().clip, 'escucha');
  assert.equal(d.msParaEspera(), null, 'escuchando no espera');
  // Dormido (silenciado): reposo quieto, sin espera; si estaba esperando, vuelve al reposo.
  const z = nuevo();
  z.d.estado(est({ silenciado: true }));
  assert.equal(z.d.msParaEspera(), null);
  const w = nuevo();
  w.d.estado(est());
  w.r.pasar(ESPERA_TRAS_MS);
  w.d.revisar();
  w.d.estado(est({ silenciado: true }));
  w.r.pasar(ASENTAR_FONDO_MS);
  assert.equal(w.d.revisar().clip, 'reposo', 'se durmió: deja de esperar');
  // Sin el clip, nunca.
  const sin = new DirectorVideo({ hay: ['reposo', 'habla'], ahora: reloj().ahora });
  sin.estado(est());
  assert.equal(sin.msParaEspera(), null);
});

prueba('lo que dijo → el golpe: despide, niega, duda, celebra, asiente (y casi siempre nada)', () => {
  const casos = {
    despide: ['¡Adiós, José!', 'Bueno, nos vemos.', 'Hasta luego.', 'Que descanses, José.', 'Ok, cuídate mucho.', 'Goodbye!'],
    niega: ['No puedo abrir eso desde aquí.', 'Lo siento, no tengo acceso a tu banco.', 'No.', 'Me temo que no.', 'Sorry, I can’t do that.', "I can't do that."],
    duda: ['No te entendí bien, ¿me lo repetís?', '¿Cuál de los dos?', '¿A qué te referís?', 'Which one?'],
    celebra: ['¡Lo logramos!', '¡Misión cumplida!', '¡Felicidades, José!', '¡Excelente noticia!'],
    asiente: ['¡Listo!', 'Sí, ya te lo mando.', 'Sí.', 'Claro que sí.', 'Ya lo envié.', 'Hecho, quedó anotado.', 'Perfecto.', 'Done.'],
  };
  for (const [clip, frases] of Object.entries(casos)) for (const f of frases) assert.equal(golpeDeFrase(f), clip, `«${f}»`);
  for (const f of ['Hoy hace calor en Tegucigalpa.', 'No te preocupes, ya lo reviso.', 'Siempre es bueno descansar.', 'Claro, te explico cómo funciona.', '', '[EMO:feliz]']) {
    assert.equal(golpeDeFrase(f), null, `«${f}» no pide golpe`);
  }
  assert.equal(golpeDeFrase('[EMO:feliz] ¡Listo!'), 'asiente', 'sin las etiquetas');
  assert.ok(leeConHerramientas(['rag', 'correo']) && leeConHerramientas(['WhatsApp']) && !leeConHerramientas(['web']) && !leeConHerramientas(null));
});

prueba('las pistas de la app: frases, «hecho», enviado, su computadora, el sonido de hojas y colgar', async () => {
  const r = reloj(5_000_000);
  relojPistas(r.ahora);
  const vistos = [];
  const off = suscribirPistas((p) => vistos.push(p));
  const ultimoGolpe = () => pistasVideo.ultimo().golpe?.clip;
  try {
    mensajeVoz.emitir({ rol: 'ultron', texto: '¡Listo! Ya quedó.', emocion: 'feliz', en: 1 });
    assert.equal(ultimoGolpe(), 'asiente', 'su frase en la conversación');
    const n = pistasVideo.ultimo().golpe.n;
    mensajeVoz.emitir({ rol: 'ultron', texto: 'Hasta luego.', emocion: 'neutral', en: 2 });
    assert.equal(pistasVideo.ultimo().golpe.n, n, 'otra frase enseguida no encadena otro golpe');
    mensajeVoz.emitir({ rol: 'usuario', texto: 'Adiós.', emocion: 'neutral', en: 3 });
    r.pasar(FRASE_ENTRE_MS);
    mensajeVoz.emitir({ rol: 'usuario', texto: 'Adiós.', emocion: 'neutral', en: 4 });
    assert.equal(pistasVideo.ultimo().golpe.n, n, 'lo que dice la persona no cuenta');
    avisarMesa({ texto: 'No puedo hacer eso, José.', emocion: 'preocupado' });
    assert.equal(ultimoGolpe(), 'niega', 'su frase en la mesa');
    r.pasar(FRASE_ENTRE_MS);
    avisarMesa({ emocion: 'orgullo' });
    assert.equal(ultimoGolpe(), 'celebra', 'la emoción «orgullo»');
    emitir('hecho', { accion: { tipo: 'atras' }, ok: true });
    assert.equal(ultimoGolpe(), 'asiente', '«hecho» bien: asiente');
    emitir('hecho', { accion: { tipo: 'atras' }, ok: false });
    assert.equal(ultimoGolpe(), 'niega', '«hecho» mal: niega');
    emitir('enviado', { para: 'beto@x.hn' });
    assert.equal(ultimoGolpe(), 'asiente');
    emitir('accion', { tipo: 'computadora', fase: 'termina', id: 't1', ok: true });
    assert.equal(ultimoGolpe(), 'celebra', 'su computadora terminó bien');
    emitir('accion', { tipo: 'computadora', fase: 'termina', id: 't2', ok: false });
    assert.equal(ultimoGolpe(), 'niega');
    pedirGolpe('despide');
    assert.equal(ultimoGolpe(), 'despide', 'colgó (VozProvider lo pide así)');
    emitir('ambiente', { sonido: 'papel', on: true });
    assert.equal(pistasVideo.ultimo().lee, true, 'hojas de papel: lee');
    emitir('ambiente', { sonido: null, on: false });
    assert.equal(pistasVideo.ultimo().lee, false);
    emitir('ambiente', { sonido: 'teclado', on: true });
    assert.equal(pistasVideo.ultimo().lee, false, 'el tecleo de buscar no es leer');
    ponerTeclea(true);
    assert.equal(pistasVideo.ultimo().teclea, true);
    ponerTeclea(false);
    ponerLee(true, 30);
    assert.equal(pistasVideo.ultimo().lee, true);
    await new Promise((f) => setTimeout(f, 60));
    assert.equal(pistasVideo.ultimo().lee, false, 'se apaga solo');
    assert.ok(vistos.length > 5, 'el cuerpo las recibe');
  } finally {
    off();
    relojPistas();
  }
  // Sin nadie escuchando, las fuentes se sueltan.
  const g = pistasVideo.ultimo().golpe.n;
  emitir('hecho', { accion: { tipo: 'atras' }, ok: true });
  assert.equal(pistasVideo.ultimo().golpe.n, g);
});

prueba('con la mesa de verdad: escucha, piensa y habla, en bucle', () => {
  const { d, r } = nuevo();
  assert.equal(d.estado(estadoDesdeMesa('IDLE', 'neutral')), null, 'empieza en reposo: nada que cambiar');
  assert.equal(d.estado(estadoDesdeMesa('LISTENING', 'neutral')), null, 'escuchar espera a asentarse');
  assert.equal(d.msParaFondo(), ASENTAR_FONDO_MS);
  r.pasar(ASENTAR_FONDO_MS);
  const e = d.revisar();
  assert.deepEqual([e.clip, e.bucle], ['escucha', true]);
  d.estado(estadoDesdeMesa('THINKING', 'neutral'));
  r.pasar(ASENTAR_FONDO_MS);
  assert.equal(d.revisar().clip, 'piensa');
  const h = d.estado(estadoDesdeMesa('SPEAKING', 'neutral'));
  assert.deepEqual([h.clip, h.bucle], ['habla', true], 'empezar a hablar no espera');
  assert.equal(d.estado(estadoDesdeMesa('SPEAKING', 'neutral')), null, 'el mismo estado no reinicia el clip');
  assert.equal(d.estado(estadoDesdeMesa('IDLE', 'neutral')), null, 'dejar de hablar espera más');
  r.pasar(SOLTAR_HABLA_MS);
  assert.equal(d.revisar().clip, 'reposo');
});

prueba('las pausas entre frases no cambian el clip (el parpadeo que vio José el 2-oct)', () => {
  const { d, r } = nuevo();
  assert.equal(d.estado(est({ hablando: true })).clip, 'habla');
  let cambios = 0;
  // 10 frases con pausas de 300 ms: «hablando» se apaga y se prende.
  for (let i = 0; i < 10; i++) {
    if (d.estado(est())) cambios++;
    r.pasar(300);
    if (d.revisar()) cambios++;
    if (d.estado(est({ hablando: true }))) cambios++;
    r.pasar(1200);
  }
  assert.equal(cambios, 0, 'sigue en «habla» toda la respuesta');
  assert.equal(d.reproduccion.clip, 'habla');
  d.estado(est());
  r.pasar(SOLTAR_HABLA_MS - 1);
  assert.equal(d.revisar(), null);
  r.pasar(1);
  assert.equal(d.revisar().clip, 'reposo', 'callado de verdad: vuelve al reposo');
});

prueba('las emociones del turno hacen su golpe una vez y vuelven al fondo', () => {
  const { d, r } = nuevo();
  const g = d.estado(estadoDesdeMesa('SPEAKING', 'risa'));
  assert.deepEqual([g.clip, g.bucle], ['risa', false], 'se ríe primero');
  assert.equal(d.estado(estadoDesdeMesa('SPEAKING', 'risa')), null, 'la misma emoción no repite el golpe');
  r.pasar(5000);
  const f = d.termino(g.n);
  assert.deepEqual([f.clip, f.bucle], ['habla', true], 'terminado el golpe, sigue hablando');
  assert.equal(d.termino(g.n), null, 'un aviso viejo no hace nada');
  assert.equal(d.estado(estadoDesdeMesa('IDLE', 'sorpresa')).clip, 'sorpresa');
  r.pasar(5000);
  assert.equal(d.termino(d.reproduccion.n).clip, 'reposo');
  assert.equal(d.estado(estadoDesdeMesa('IDLE', 'triste')).clip, 'triste');
  const otro = nuevo().d;
  assert.equal(otro.estado(estadoDesdeMesa('IDLE', 'preocupado')).clip, 'triste', '«uy» (preocupado) también entristece');
});

prueba('el mismo golpe no se repite antes de enfriarse', () => {
  const { d, r } = nuevo();
  const risa = est({ expresion: 'encantada' });
  assert.equal(d.estado(risa).clip, 'risa');
  r.pasar(5000);
  d.termino(d.reproduccion.n);
  d.estado(est());
  assert.equal(d.estado(risa), null, 'a los 5 s no se vuelve a reír');
  d.estado(est());
  r.pasar(ENFRIAR_GOLPE_MS);
  assert.equal(d.estado(risa).clip, 'risa', 'pasado el enfriamiento, sí');
});

prueba('los gestos de cuerpo: saluda, señala y el toque da risa; cada pedido nuevo cuenta', () => {
  const { d, r } = nuevo();
  assert.equal(d.estado(est({ gesto: { nombre: 'saludar', n: 1 } })).clip, 'saluda');
  r.pasar(5000);
  d.termino(d.reproduccion.n);
  assert.equal(d.estado(est({ gesto: { nombre: 'saludar', n: 1 } })), null, 'el mismo pedido no se repite');
  assert.equal(d.estado(est({ gesto: { nombre: 'senalar', n: 2 } })).clip, 'senala');
  assert.equal(d.estado(est({ gesto: { nombre: 'toque_panza', n: 3 } })).clip, 'risa', 'un golpe nuevo reemplaza al que está');
  assert.equal(d.estado(est({ gesto: { nombre: 'enojo', n: 4 } })), null, 'sin clip para el enojo: sigue lo que había');
});

prueba('si empieza a hablar en medio de un golpe, lo deja terminar su gesto y luego habla', () => {
  const { d, r } = nuevo();
  d.golpe('saluda');
  r.pasar(500);
  assert.equal(d.estado(est({ hablando: true })), null, 'recién empezó el saludo');
  r.pasar(GOLPE_ANTES_DE_HABLAR_MS);
  assert.equal(d.estado(est({ hablando: true })).clip, 'habla', 'ya saludó lo suficiente: habla');
  assert.equal(d.golpe('habla'), null, 'un clip de fondo no es un golpe');
  assert.equal(d.golpe('saluda'), null, 'acaba de saludar: no repite');
});

prueba('hablar a mitad de un golpe: dice cuánto falta y al cumplirse pasa a hablar sin otro estado (Codex en #106)', () => {
  const { d, r } = nuevo();
  d.golpe('saluda');
  r.pasar(400);
  assert.equal(d.estado(est({ hablando: true })), null);
  assert.equal(d.msParaHablar(), GOLPE_ANTES_DE_HABLAR_MS - 400, 'falta lo que le queda al saludo');
  assert.equal(d.revisar(), null, 'antes de tiempo no cambia');
  r.pasar(GOLPE_ANTES_DE_HABLAR_MS - 400);
  const h = d.revisar();
  assert.deepEqual([h.clip, h.bucle], ['habla', true], 'cumplido el tiempo, habla');
  assert.equal(d.msParaHablar(), null, 'hablando en bucle no hay reloj');
  // Si dejó de hablar antes, no hay nada que esperar.
  const otro = nuevo();
  otro.d.golpe('risa');
  otro.d.estado(est({ hablando: true }));
  otro.d.estado(est());
  assert.equal(otro.d.msParaHablar(), null);
});

prueba('«reducir movimiento»: sin golpes, solo los fondos', () => {
  const { d } = nuevo({ reducido: true });
  assert.equal(d.golpe('saluda'), null);
  assert.equal(d.estado(est({ expresion: 'encantada' })), null);
  assert.equal(d.estado(est({ hablando: true })).clip, 'habla');
});

prueba('si falta un clip: el fondo cae al reposo y el golpe no se hace', () => {
  const r = reloj();
  const d = new DirectorVideo({ hay: ['reposo', 'habla'], ahora: r.ahora });
  assert.equal(d.estado(est({ escuchando: true })), null, 'sin «escucha», sigue en reposo');
  assert.equal(d.estado(est({ expresion: 'encantada' })), null, 'sin «risa», nada');
  assert.equal(d.estado(est({ hablando: true })).clip, 'habla');
});

prueba('el encuadre llena el alto, no deforma y muestra la franja de la cara entera', () => {
  for (const avatar of ['claudio', 'antonio']) {
    for (const camara of ['retrato', 'cuerpo']) {
      const v = VENTANAS[avatar][camara];
      for (const [W, H] of [[300, 300], [390, 520], [844, 390], [390, 844], [120, 120]]) {
        const e = encuadrar(W, H, v);
        assert.ok(Math.abs(e.width / e.height - 9 / 16) < 1e-9, 'sin deformar');
        assert.ok(e.height >= H - 1e-6, `${avatar} ${camara} ${W}×${H}: cubre el alto`);
        if (W / H <= (9 / 16) / (v.y1 - v.y0)) assert.ok(e.width >= W - 1e-6, `${avatar} ${camara} ${W}×${H}: en una caja angosta cubre el ancho`);
        assert.ok(e.top <= 1e-6 && e.top + e.height >= H - 1e-6, 'sin huecos arriba ni abajo');
        assert.ok(Math.abs(e.left + e.width / 2 - W / 2) < 1e-6, 'centrado a lo ancho');
        if (camara === 'retrato') {
          // La cabeza (la parte de arriba de la franja) se ve siempre.
          const caraArriba = e.top + v.y0 * e.height;
          const caraAbajo = e.top + ((v.y0 + v.y1) / 2) * e.height;
          assert.ok(caraArriba >= -1e-6 && caraAbajo <= H + 1e-6, `${avatar} ${W}×${H}: la cara se ve`);
        }
      }
    }
  }
  // En el círculo de la llamada (300×300), la franja del retrato de Claudio (0,02–0,54) llena el alto justo.
  const e = encuadrar(300, 300, VENTANAS.claudio.retrato);
  assert.equal(Math.round(e.height), 577);
  assert.equal(Math.round(e.top), -12);
  // Acostado (844×390): el video no se estira a lo ancho; queda centrado con márgenes a los lados.
  const a = encuadrar(844, 390, VENTANAS.claudio.retrato);
  assert.ok(a.left > 0 && a.width < 844, 'márgenes a los lados');
  assert.equal(Math.round(a.height), 750);
});

prueba('el toque: arriba de la barbilla es la cabeza; abajo, el cuerpo', () => {
  const e = encuadrar(390, 844, VENTANAS.claudio.cuerpo);
  assert.equal(zonaVideo(e.top + 0.2 * e.height, e, 'claudio'), 'cabeza');
  assert.equal(zonaVideo(e.top + 0.6 * e.height, e, 'claudio'), 'panza');
  assert.equal(zonaVideo(e.top + 0.41 * e.height, e, 'antonio'), 'cabeza', 'la cabeza de ANT-ONIO es más grande');
});

prueba('los 34 clips existen, son livianos y clips.ts los pide todos', () => {
  const dir = path.resolve(AQUI, '../../../assets/avatares/video');
  const fuente = fs.readFileSync(path.resolve(AQUI, '../video/clips.ts'), 'utf8');
  let total = 0;
  for (const a of ['claudio', 'antonio']) {
    for (const c of CLIPS_VIDEO) {
      const f = path.join(dir, `${a}-${c}.mp4`);
      assert.ok(fs.existsSync(f), `falta ${a}-${c}.mp4`);
      const b = fs.statSync(f).size;
      assert.ok(b > 50_000 && b < 600_000, `${a}-${c}.mp4: ${b} bytes`);
      total += b;
      assert.ok(fuente.includes(`video/${a}-${c}.mp4`), `clips.ts no pide ${a}-${c}`);
      // MP4 con «faststart»: el índice (moov) antes de los datos (mdat).
      const cabeza = fs.readFileSync(f).subarray(0, 64 * 1024).toString('latin1');
      assert.ok(cabeza.indexOf('moov') > 0 && (cabeza.indexOf('mdat') < 0 || cabeza.indexOf('moov') < cabeza.indexOf('mdat')), `${a}-${c}: faststart`);
    }
  }
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).length, 34, 'ni uno de más');
  assert.ok(total < 12 * 1024 * 1024, `los 34 pesan ${(total / 1048576).toFixed(1)} MB`);
});

prueba('en la APK el clip se reproduce desde un archivo (expo-asset), nunca desde el require crudo', () => {
  // El 1-oct, en el Samsung de José, `source={require(clip)}` daba FileDataSourceException: en la APK
  // el require es el nombre de un recurso (res/raw), no un archivo. Se copia con expo-asset primero.
  const vista = fs.readFileSync(path.resolve(AQUI, '../video/CuerpoVideo.tsx'), 'utf8');
  assert.match(vista, /Asset\.fromModule\(mod\)/);
  assert.match(vista, /downloadAsync\(\)/);
  assert.match(vista, /source=\{\{ uri: uris\[/);
  assert.doesNotMatch(vista, /source=\{clips\[/, 'el require crudo no va al reproductor');
});

let fallas = 0;
for (const [nombre, f] of pruebas) {
  try {
    await f();
    console.log(`ok - ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`not ok - ${nombre}\n  ${e?.stack || e}`);
  }
}
console.log(`\n${pruebas.length - fallas}/${pruebas.length} pruebas del cuerpo en video`);
if (fallas) process.exit(1);
