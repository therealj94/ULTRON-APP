/**
 * Pruebas en Node del cuerpo en video de Claudio y ANT-ONIO (sin teléfono):
 *   el guion (qué clip toca con cada estado, los golpes de una vez, su enfriamiento, cuándo vuelve al
 *   fondo, «reducir movimiento»), las pistas (su computadora teclea, lee un mensaje, la espera, los golpes
 *   por lo que dijo o pasó), el encuadre (la franja de la cara se ve entera y sin huecos), la zona del
 *   toque, y que los 34 clips existen, son livianos y están en clips.ts. La mezcla de capas (transicion.ts)
 *   con un teléfono de mentira, la mano del sable (manos.ts, `manoLibreMs`), el guion que se queda con su
 *   clip mientras el sable está en la mano (`sostener`) y ráfagas de toques de punta a punta.
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
  GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS,
  GOLPE_VIGENTE_MS,
  SOLTAR_HABLA_MS,
  VENTANAS,
  encuadrar,
  esDeFondo,
  fondoDe,
  zonaVideo,
} from '../video/guion.ts';
import {
  ANTES_DEL_FIN_MS,
  DIBUJANDO_MS,
  ESPERA_MAX_MS,
  FUNDIDO_FORZADO_MS,
  FUNDIDO_MS,
  LLEGAR_MS,
  MezclaCapas,
  RITMO_MAX,
  manoLibre,
  faltaReposo,
  planear,
  restanteReposo,
  tramos,
} from '../video/transicion.ts';
import { FPS_VIDEO, REPOSOS } from '../video/reposos.ts';
import { MANO_FUERA } from '../video/manos.ts';
import { MotorToques } from '../video/efectos/toques.ts';
import { Agenda, ESPERA_MANO_MS, GolpesDeToque, sacarSable } from '../video/efectos/agenda.ts';
import { CORTE_MS } from '../video/efectos/escena.ts';
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

prueba('en el teléfono (sin cortar el gesto) el golpe pide «habla» al segundo; Windows sigue con 1,8 s', () => {
  const { d, r } = nuevo({ golpeAntesDeHablarMs: GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS });
  d.golpe('asiente');
  assert.equal(d.estado(est({ hablando: true })), null);
  assert.equal(d.msParaHablar(), GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS);
  r.pasar(GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS);
  assert.equal(d.revisar().clip, 'habla');
  const w = nuevo();
  w.d.golpe('asiente');
  w.d.estado(est({ hablando: true }));
  assert.equal(w.d.msParaHablar(), GOLPE_ANTES_DE_HABLAR_MS, 'sin la opción, lo de siempre');
  const vista = fs.readFileSync(path.resolve(AQUI, '../video/CuerpoVideo.tsx'), 'utf8');
  assert.match(vista, /golpeAntesDeHablarMs: GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS/);
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

/* ── el cambio de clip (transicion.ts) ───────────────────────────────────────────────────── */

const T = (clip, bucle = esDeFondo(clip), avatar = 'claudio') => tramos(avatar, clip, bucle);

prueba('reposos.ts: los 34 clips, con su reposo al principio y al final, y duran lo que dice la tabla', () => {
  const dir = path.resolve(AQUI, '../../../assets/avatares/video');
  for (const a of ['claudio', 'antonio']) {
    for (const c of CLIPS_VIDEO) {
      const [n, hasta, desde] = REPOSOS[a][c];
      assert.ok(n >= 96 && n <= 144, `${a}-${c}: ${n} cuadros`);
      assert.ok(hasta >= 5, `${a}-${c}: arranca en reposo por lo menos 5 cuadros (${hasta})`);
      assert.ok(desde > hasta && desde <= n - 6, `${a}-${c}: termina en reposo por lo menos 6 cuadros (${desde}/${n})`);
      // La duración del MP4 (mvhd, que con faststart está al principio) es la de la tabla.
      const b = fs.readFileSync(path.join(dir, `${a}-${c}.mp4`)).subarray(0, 64 * 1024);
      const i = b.indexOf('mvhd');
      assert.ok(i > 0, `${a}-${c}: sin mvhd`);
      const v1 = b[i + 4] === 1;
      const escala = b.readUInt32BE(i + (v1 ? 24 : 16));
      const dura = v1 ? Number(b.readBigUInt64BE(i + 28)) : b.readUInt32BE(i + 20);
      assert.ok(Math.abs(dura / escala - n / FPS_VIDEO) < 0.06, `${a}-${c}: dura ${(dura / escala).toFixed(3)} s y la tabla dice ${n} cuadros`);
    }
  }
});

prueba('el reposo de un clip: al principio y al final; un golpe terminado se queda quieto; un bucle sigue', () => {
  const t = T('piensa');
  assert.ok(restanteReposo(t, 0) > 0, 'arranca en reposo');
  assert.equal(restanteReposo(t, 2000), 0, 'a los 2 s tiene la mano en el mentón');
  assert.ok(restanteReposo(t, t.desdeMs + 10) > t.hastaMs, 'el final sigue con el principio de la vuelta siguiente');
  assert.equal(faltaReposo(t, 2000), t.desdeMs - 2000);
  const g = T('saluda');
  assert.equal(restanteReposo(g, g.durMs), Infinity, 'un golpe terminado se queda en su último cuadro: reposo');
  assert.equal(faltaReposo(g, g.durMs), 0);
});

prueba('planear: en reposo entra ya; si no, termina el gesto (más rápido si empezó a hablar); «reducir movimiento» no acelera', () => {
  const t = T('piensa');
  assert.deepEqual(planear(null, 0, 'reposo', false).modo, 'ya', 'nada en pantalla: ya');
  assert.equal(planear(t, 100, 'habla', false).modo, 'ya', 'recién empieza: todavía en reposo');
  const h = planear(t, 2000, 'habla', false);
  assert.equal(h.modo, 'volver');
  assert.ok(h.ritmo > 1 && h.ritmo <= RITMO_MAX.habla, `acelera para hablar (${h.ritmo}×)`);
  assert.ok(h.esperaMs <= (t.desdeMs - 2000) / 2.4 + 1, `llega rápido (${Math.round(h.esperaMs)} ms)`);
  const f = planear(t, t.desdeMs - 600, 'escucha', false);
  assert.deepEqual([f.modo, f.ritmo], ['volver', 1], 'un fondo nuevo, cerca del reposo: a su ritmo');
  const lejos = planear(t, 800, 'reposo', false);
  assert.ok(lejos.ritmo <= RITMO_MAX.fondo && lejos.esperaMs <= LLEGAR_MS.fondo + 1, `un fondo lejos: hasta ${RITMO_MAX.fondo}×, en ~2 s (${lejos.ritmo}×)`);
  // «Reducir movimiento»: nunca acelera; si empezó a hablar y el reposo está lejos, funde despacio sin esperar.
  const rh = planear(t, 1000, 'habla', true);
  assert.deepEqual([rh.modo, rh.ritmo, rh.fundidoMs], ['fundir', 1, FUNDIDO_FORZADO_MS]);
  const rc = planear(t, t.desdeMs - 1000, 'habla', true);
  assert.deepEqual([rc.modo, rc.ritmo], ['volver', 1], 'si el reposo está cerca, lo espera');
  const rf = planear(t, 1000, 'escucha', true);
  assert.deepEqual([rf.modo, rf.ritmo], ['volver', 1]);
});

/**
 * Un teléfono de mentira para la mezcla: dos reproductores que cargan en `cargaMs`, avanzan a su ritmo,
 * cuentan su posición cada 100 ms (como expo-av) y se quedan quietos al final de un golpe. Revisa en
 * cada orden lo que se vería en pantalla.
 */
function telefono({ avatar = 'claudio', reducido = false, cargaMs = 180, noCarga = () => false } = {}) {
  const r = reloj(0);
  const jug = [null, null];
  const ordenes = [];
  const problemas = [];
  const trabados = [];
  let fundido = null; // el que está en curso
  const historial = [];
  let visible = null; // la capa que se ve entera
  let prox = null;
  let m;
  const posReal = (j) => j.pos;
  const ordenar = (o) => {
    const t = r.ahora();
    ordenes.push({ t, ...o });
    const j = jug[o.capa];
    switch (o.tipo) {
      case 'montar':
        if (o.capa === visible) problemas.push(`${t}: montó encima de la capa que se ve`);
        if (fundido && fundido.capa === o.capa) problemas.push(`${t}: montó en la capa que se está fundiendo`);
        jug[o.capa] = { clave: o.clave, r: o.r, cargaEn: noCarga(o.r) ? Infinity : t + cargaMs, cargado: false, enMarcha: false, pos: 0, ritmo: 1, ultimo: t, dur: tramos(avatar, o.r.clip, o.r.bucle).durMs };
        break;
      case 'quitar':
        if (o.capa === visible) problemas.push(`${t}: quitó la capa que se ve`);
        if (fundido && fundido.capa === o.capa) problemas.push(`${t}: quitó la capa a mitad del fundido`);
        jug[o.capa] = null;
        break;
      case 'tocar':
        if (!j?.cargado) problemas.push(`${t}: tocó un clip sin cargar`);
        j.enMarcha = true;
        break;
      case 'ritmo':
        if (j) j.ritmo = o.ritmo;
        if (reducido && o.ritmo > 1) problemas.push(`${t}: aceleró con «reducir movimiento»`);
        break;
      case 'fundir': {
        if (fundido) problemas.push(`${t}: un fundido encima de otro`);
        if (!j?.enMarcha || j.pos < DIBUJANDO_MS) problemas.push(`${t}: fundió un clip que todavía no dibuja`);
        const otra = o.capa === 0 ? 1 : 0;
        if (o.sobre === 'capa') {
          const a = jug[otra];
          if (!a) problemas.push(`${t}: fundió sobre una capa vacía`);
          else if (o.ms !== FUNDIDO_FORZADO_MS && restanteReposo(tramos(avatar, a.r.clip, a.r.bucle), posReal(a)) <= 0)
            problemas.push(`${t}: cambió de ${a.r.clip} (en ${Math.round(a.pos)} ms, fuera del reposo) a ${j.r.clip}`);
          if (j.pos > tramos(avatar, j.r.clip, j.r.bucle).hastaMs) problemas.push(`${t}: el nuevo ya salió de su reposo al fundirse`);
        }
        fundido = { t, capa: o.capa, hasta: t + o.ms, ms: o.ms, sobre: o.sobre, de: o.sobre === 'capa' ? jug[otra]?.r.clip : null, a: j.r.clip, posVieja: jug[otra]?.pos };
        historial.push(fundido);
        break;
      }
      case 'listo':
        visible = o.capa;
        fundido = null;
        break;
    }
  };
  m = new MezclaCapas({ avatar, reducido: () => reducido, ahora: r.ahora, ordenar, trabado: (clip, definitivo) => trabados.push([clip, definitivo]) });
  const reprogramar = () => {
    const ms = m.msParaRevisar();
    prox = ms === null ? null : r.ahora() + ms;
  };
  const tic = () => {
    const t = r.ahora();
    jug.forEach((j, i) => {
      if (!j) return;
      if (!j.cargado && t >= j.cargaEn) {
        j.cargado = true;
        m.cargado(i, j.clave);
        reprogramar();
      }
      if (j.enMarcha) {
        j.pos += 10 * j.ritmo;
        if (j.r.bucle) j.pos %= j.dur;
        else if (j.pos >= j.dur) {
          j.pos = j.dur;
          j.enMarcha = false;
        }
      }
      if (j.cargado && t - j.ultimo >= 100) {
        j.ultimo = t;
        m.estado(i, j.clave, j.pos, j.enMarcha);
        reprogramar();
      }
    });
    if (prox !== null && t >= prox) {
      m.revisar();
      reprogramar();
    }
  };
  const pasar = (ms) => {
    for (let k = 0; k < ms; k += 10) {
      r.pasar(10);
      tic();
    }
  };
  const pedir = (clip, n) => {
    m.pedir({ clip, bucle: esDeFondo(clip), n });
    reprogramar();
  };
  const fundidos = () => historial;
  return { m, r, jug, pasar, pedir, ordenes, fundidos, problemas, trabados, get visible() { return visible; } };
}

/** Pone un clip en pantalla y lo deja llegar a `pos` ms. */
function conClip(clip, pos, o) {
  const tel = telefono(o);
  tel.pedir(clip, 1);
  tel.pasar(600);
  assert.equal(tel.m.actual?.clip, clip);
  const j = tel.jug[tel.visible];
  tel.pasar(Math.max(0, Math.round((pos - j.pos) / 10) * 10));
  return tel;
}

prueba('la mezcla: el primero aparece sobre las fotos recién cuando dibuja', () => {
  const tel = telefono();
  tel.pedir('reposo', 1);
  assert.deepEqual(tel.ordenes.map((o) => o.tipo), ['montar'], 'se monta quieto');
  tel.pasar(150);
  assert.ok(!tel.ordenes.some((o) => o.tipo === 'tocar'), 'todavía cargando');
  tel.pasar(400);
  const f = tel.fundidos();
  assert.equal(f.length, 1);
  assert.equal(f[0].sobre, 'respaldo');
  assert.equal(tel.visible, 0);
  assert.deepEqual(tel.problemas, []);
});

prueba('la mezcla: de un fondo a la mitad a otro fondo, termina su gesto y cambia en el reposo', () => {
  const tel = conClip('piensa', 2000);
  tel.pedir('escucha', 2);
  const plan = tel.m.plan;
  assert.equal(plan.modo, 'volver');
  tel.pasar(300);
  assert.ok(!tel.ordenes.some((o) => o.tipo === 'tocar' && o.capa === 1), 'el nuevo ya cargó pero espera, quieto');
  tel.pasar(3000);
  const f = tel.fundidos().at(-1);
  assert.equal(f.a, 'escucha');
  assert.ok(f.posVieja >= T('piensa').desdeMs, `cambió con piensa en reposo (${f.posVieja} ms)`);
  assert.equal(tel.m.actual.clip, 'escucha');
  assert.deepEqual(tel.problemas, []);
});

prueba('la mezcla: empezó a hablar con piensa a la mitad: lo termina rápido (≤2,5×) y habla en ~1 s', () => {
  const tel = conClip('piensa', 1500);
  const t0 = tel.r.ahora();
  tel.pedir('habla', 2);
  const ritmo = tel.ordenes.find((o) => o.tipo === 'ritmo' && o.capa === tel.visible);
  assert.ok(ritmo && ritmo.ritmo > 1 && ritmo.ritmo <= RITMO_MAX.habla, 'acelera el gesto que está haciendo');
  tel.pasar(2500);
  const f = tel.fundidos().at(-1);
  assert.equal(f.a, 'habla');
  assert.ok(f.t - t0 <= 1500, `habla a los ${f.t - t0} ms`);
  assert.ok(tel.ordenes.some((o) => o.tipo === 'ritmo' && o.ritmo === 1 && o.t <= f.t), 'al llegar al reposo vuelve a su ritmo');
  assert.deepEqual(tel.problemas, []);
});

prueba('la mezcla: golpe → habla: no se corta el gesto; lo termina y pasa a hablar en el reposo', () => {
  for (const golpe of ['saluda', 'celebra', 'asiente', 'duda']) {
    const tel = conClip(golpe, GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS);
    const t0 = tel.r.ahora();
    tel.pedir('habla', 2);
    tel.pasar(3000);
    const f = tel.fundidos().at(-1);
    assert.equal(f.a, 'habla', golpe);
    assert.ok(f.posVieja >= T(golpe).desdeMs, `${golpe}: cambió en el reposo (${f.posVieja} ms ≥ ${Math.round(T(golpe).desdeMs)})`);
    const tope = (T(golpe).desdeMs - GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS) / RITMO_MAX.habla + 300;
    assert.ok(f.t - t0 <= tope, `${golpe}: habla a los ${f.t - t0} ms (tope ${Math.round(tope)})`);
    assert.deepEqual(tel.problemas, [], golpe);
  }
});

prueba('la mezcla: el golpe que avisa antes de terminar se queda quieto en su último cuadro hasta el cambio', () => {
  const tel = conClip('risa', 5000 - ANTES_DEL_FIN_MS);
  tel.pedir('reposo', 2);
  tel.pasar(1500);
  const f = tel.fundidos().at(-1);
  assert.equal(f.a, 'reposo');
  assert.ok(f.posVieja >= T('risa').desdeMs);
  assert.deepEqual(tel.problemas, []);
});

prueba('la mezcla: cambios rápidos A→B→C mientras B carga: B nunca se ve, queda C', () => {
  const tel = conClip('reposo', 4700);
  tel.pedir('escucha', 2);
  tel.pasar(50);
  tel.pedir('piensa', 3);
  tel.pasar(30);
  tel.pedir('habla', 4);
  tel.pasar(1500);
  assert.deepEqual(tel.fundidos().map((f) => f.a), ['reposo', 'habla'], 'ni escucha ni piensa llegaron a verse');
  assert.equal(tel.m.actual.n, 4);
  assert.deepEqual(tel.problemas, []);
});

prueba('la mezcla: un pedido en medio de un fundido espera a que termine (sin apagar la capa vieja de golpe)', () => {
  const tel = conClip('reposo', 4700);
  tel.pedir('escucha', 2);
  // Hasta que arranque el fundido de escucha…
  for (let k = 0; k < 100 && !tel.m.fundiendo; k++) tel.pasar(10);
  assert.ok(tel.m.fundiendo);
  tel.pedir('piensa', 3);
  assert.equal(tel.m.destino.clip, 'piensa');
  tel.pasar(100);
  assert.ok(!tel.ordenes.some((o) => o.tipo === 'quitar' && o.t <= tel.r.ahora() && tel.m.fundiendo), 'nada se quita a mitad');
  tel.pasar(6000);
  assert.equal(tel.m.actual.clip, 'piensa');
  assert.deepEqual(tel.problemas, []);
});

prueba('la mezcla: lo que ya se ve no se vuelve a montar; el mismo fondo otra vez no hace nada', () => {
  const tel = conClip('escucha', 2000);
  const antes = tel.ordenes.length;
  tel.pedir('escucha', 7);
  tel.pedir('escucha', 8);
  assert.equal(tel.ordenes.length, antes);
  // Pedir algo y arrepentirse antes de que entre: el entrante se descarta y el de ahora vuelve a su ritmo.
  tel.pedir('habla', 9);
  tel.pedir('escucha', 10);
  assert.equal(tel.m.destino.clip, 'escucha');
  assert.equal(tel.jug[tel.visible].ritmo, 1);
  tel.pasar(3000);
  assert.equal(tel.fundidos().length, 1, 'no hubo cambio');
  assert.deepEqual(tel.problemas, []);
});

prueba('la mezcla: «reducir movimiento» nunca acelera; para hablar lejos del reposo funde despacio, ya', () => {
  const tel = conClip('piensa', 1500, { reducido: true });
  const t0 = tel.r.ahora();
  tel.pedir('habla', 2);
  tel.pasar(800);
  const f = tel.fundidos().at(-1);
  assert.equal(f.a, 'habla');
  assert.equal(f.ms, FUNDIDO_FORZADO_MS);
  assert.ok(f.t - t0 < 600);
  // Un fondo sí espera al reposo, a su ritmo.
  const q = conClip('piensa', 1500, { reducido: true });
  q.pedir('escucha', 2);
  q.pasar(4000);
  const g = q.fundidos().at(-1);
  assert.equal(g.ms, FUNDIDO_MS);
  assert.ok(g.posVieja >= T('piensa').desdeMs);
  assert.deepEqual([...tel.problemas, ...q.problemas], []);
});

prueba('la mezcla: un clip que no carga se monta otra vez y, si tampoco, se queda el de antes (sin hueco)', () => {
  const tel = conClip('reposo', 4700, { noCarga: (r) => r.clip === 'risa' });
  tel.pedir('risa', 2);
  tel.pasar(ESPERA_MAX_MS * 2 + 500);
  assert.deepEqual(tel.trabados, [['risa', false], ['risa', true]]);
  assert.equal(tel.m.actual.clip, 'reposo', 'sigue el reposo, entero');
  assert.equal(tel.m.destino.clip, 'reposo');
  assert.equal(tel.jug[1], null, 'la capa del que no cargó quedó libre');
  tel.pedir('escucha', 3);
  tel.pasar(6000);
  assert.equal(tel.m.actual.clip, 'escucha', 'lo siguiente entra normal');
  assert.deepEqual(tel.problemas, []);
});

prueba('la mezcla: 3 minutos de pedidos al azar (también a mitad de fundidos y cargas): nunca un hueco ni un salto de pose', () => {
  for (const reducido of [false, true]) {
    for (const avatar of ['claudio', 'antonio']) {
      let semilla = 7;
      const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
      const tel = telefono({ avatar, reducido, cargaMs: 120 + Math.floor(azar() * 250) });
      let n = 1;
      tel.pedir('reposo', n);
      for (let t = 0; t < 180_000; ) {
        const paso = Math.floor(azar() * 3000) + 10;
        tel.pasar(paso);
        t += paso;
        const clip = CLIPS_VIDEO[Math.floor(azar() * CLIPS_VIDEO.length)];
        tel.pedir(clip, ++n);
      }
      tel.pasar(8000);
      assert.deepEqual(tel.problemas, [], `${avatar}${reducido ? ' (reducido)' : ''}`);
      assert.equal(tel.m.actual.n, n, 'queda el último pedido');
      if (reducido) assert.ok(!tel.ordenes.some((o) => o.tipo === 'ritmo' && o.ritmo > 1));
      const forzados = tel.fundidos().filter((f) => f.ms === FUNDIDO_FORZADO_MS).length;
      if (!reducido) assert.equal(forzados, 0, 'sin «reducir movimiento» todos los cambios son en el reposo');
    }
  }
});

prueba('guion + mezcla: una conversación entera (escucha, piensa, «¡Listo!» con asiente, habla, escucha) sin saltos de pose', () => {
  for (const avatar of ['claudio', 'antonio']) {
    const tel = telefono({ avatar });
    const d = new DirectorVideo({ hay: CLIPS_VIDEO, ahora: tel.r.ahora, golpeAntesDeHablarMs: GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS });
    let avisado = -1;
    const decidir = (rep) => rep && tel.pedir(rep.clip, rep.n);
    // Lo que hace CuerpoVideo: los relojes del guion y el aviso del golpe antes de terminar.
    const correr = (ms) => {
      for (let k = 0; k < ms; k += 10) {
        tel.pasar(10);
        if (d.msParaRevisar() === 0) decidir(d.revisar());
        const a = tel.m.actual;
        const j = tel.visible === null ? null : tel.jug[tel.visible];
        if (a && !a.bucle && j && avisado !== a.n && j.pos >= j.dur - ANTES_DEL_FIN_MS) {
          avisado = a.n;
          decidir(d.termino(a.n));
        }
      }
    };
    decidir(d.estado(est()));
    tel.pedir(d.reproduccion.clip, d.reproduccion.n);
    correr(3000);
    decidir(d.estado(est({ escuchando: true })));
    correr(2300);
    decidir(d.estado(est({ escuchando: true, pensando: true })));
    correr(1700);
    const habla = tel.r.ahora();
    decidir(d.estado(est({ hablando: true })));
    decidir(d.pistas({ teclea: false, lee: false, golpe: { clip: 'asiente', n: 1, en: tel.r.ahora() } }));
    correr(6000);
    decidir(d.estado(est({ escuchando: true })));
    correr(6000);
    const vistos = tel.fundidos().map((f) => f.a);
    // LINEA=1: la línea de tiempo (cuándo, desde qué clip y en qué ms de él, a cuál; los cambios de ritmo).
    if (process.env.LINEA)
      console.log(avatar, `habla en ${habla}:`, tel.fundidos().map((f) => `${f.t} ${f.de ?? 'fotos'}@${Math.round(f.posVieja ?? 0)}→${f.a}`).join(' | '), '· ritmo', tel.ordenes.filter((o) => o.tipo === 'ritmo').map((o) => `${o.t}:×${o.ritmo}`).join(' '));
    assert.deepEqual(tel.problemas, [], avatar);
    for (const c of ['escucha', 'habla']) assert.ok(vistos.includes(c), `${avatar}: se vio ${c} (${vistos.join(' → ')})`);
    assert.equal(tel.m.actual.clip, 'escucha');
    // Escucha iba por la mitad: tarda ~1 s en volver al reposo y para entonces ya toca hablar. El asiente
    // no llegó a verse y se salta: la boca primero.
    assert.ok(!vistos.includes('asiente'), `${avatar}: ${vistos.join(' → ')}`);
    const h = tel.fundidos().find((f) => f.a === 'habla');
    assert.ok(h.t - habla <= 1500, `${avatar}: habla a los ${h.t - habla} ms de la frase`);
  }
});

prueba('guion + mezcla: «¡Listo!» con el clip de antes en reposo: asiente se ve entero y después habla', () => {
  const tel = conClip('piensa', 4500);
  const d = new DirectorVideo({ hay: CLIPS_VIDEO, ahora: tel.r.ahora, golpeAntesDeHablarMs: GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS });
  d.estado(est({ pensando: true }));
  const t0 = tel.r.ahora();
  let rep = d.estado(est({ hablando: true }));
  rep = d.pistas({ teclea: false, lee: false, golpe: { clip: 'asiente', n: 1, en: t0 } }) || rep;
  tel.pedir(rep.clip, rep.n);
  for (let k = 0; k < 4000; k += 10) {
    tel.pasar(10);
    if (d.msParaRevisar() === 0) {
      const x = d.revisar();
      if (x) tel.pedir(x.clip, x.n);
    }
  }
  const [a, h] = tel.fundidos().slice(-2);
  assert.deepEqual([a.a, h.a], ['asiente', 'habla']);
  assert.ok(a.t - t0 <= 400, `asiente a los ${a.t - t0} ms`);
  assert.ok(h.posVieja >= T('asiente').desdeMs, 'el asiente terminó su gesto (acelerado) antes de hablar');
  assert.ok(h.t - t0 <= 2800, `habla a los ${h.t - t0} ms`);
  assert.deepEqual(tel.problemas, []);
});

/* ── la mano del sable ───────────────────────────────────────────────────────────────────── */

/**
 * ¿La mano del sable está fuera de su lugar en este clip, en `pos` ms? (lo que mide manos.py). `holgura`:
 * los cuadros de más que manos.py suma a cada lado (HOLGURA); sin ellos, lo medido de verdad.
 */
const manoFuera = (avatar, clip, pos, holgura = true) => {
  const f = MANO_FUERA[avatar][clip];
  const k = Math.floor((pos * FPS_VIDEO) / 1000);
  const h = holgura ? 0 : 2;
  return !!f && k >= f[0] + h && k <= f[1] - h;
};

prueba('manos.ts: cada tramo cabe en su clip; niega, reposo y escucha no mueven la mano; la risa, celebrar y hablar sí', () => {
  for (const a of ['claudio', 'antonio']) {
    for (const [c, f] of Object.entries(MANO_FUERA[a])) {
      assert.ok(CLIPS_VIDEO.includes(c), `${a}: ${c} no es un clip`);
      assert.ok(f[0] >= 0 && f[1] >= f[0] && f[1] < REPOSOS[a][c][0], `${a}-${c}: [${f}]`);
      // En el reposo del principio (la foto base) la mano está en su lugar.
      assert.ok(f[0] >= Math.min(REPOSOS[a][c][1], 6) - 1, `${a}-${c}: la mano se va antes de salir del reposo (${f[0]})`);
    }
    for (const c of ['niega', 'reposo', 'escucha']) assert.equal(MANO_FUERA[a][c], undefined, `${a}-${c} mueve la mano`);
    for (const c of ['risa', 'celebra', 'habla', 'piensa', 'teclea']) assert.ok(MANO_FUERA[a][c], `${a}-${c} no mueve la mano`);
  }
});

prueba('manoLibre: antes del gesto, durante (0), después; un bucle vuelve a empezar; un golpe terminado cuenta poco', () => {
  const [a, b] = MANO_FUERA.claudio.risa.map((k) => (k * 1000) / FPS_VIDEO);
  assert.equal(manoLibre('claudio', 'risa', false, 0), a);
  assert.equal(manoLibre('claudio', 'risa', false, (a + b) / 2), 0);
  const final = manoLibre('claudio', 'risa', false, 4900);
  assert.ok(final > 0 && final < 1000, `al final del golpe viene un fondo que no se sabe (${final})`);
  assert.equal(manoLibre('claudio', 'niega', true, 1234), Infinity, 'niega en bucle: nunca se va');
  assert.ok(manoLibre('claudio', 'niega', false, 0) >= 5000, 'niega entero');
  const [ha] = MANO_FUERA.claudio.habla.map((k) => (k * 1000) / FPS_VIDEO);
  assert.ok(Math.abs(manoLibre('claudio', 'habla', true, 4990) - (10 + ha)) < 1, 'el bucle de habla vuelve a su principio');
});

prueba('manoLibreMs: con lo que se ve y lo que entra (en el reposo); la risa a la mitad no; sin video, 0', () => {
  assert.equal(telefono().m.manoLibreMs(), 0, 'todavía las fotos');
  assert.equal(conClip('reposo', 2000).m.manoLibreMs(), Infinity, 'el reposo no mueve la mano');
  assert.equal(conClip('risa', 2000).m.manoLibreMs(), 0, 'la risa tiene la mano en la panza');
  // La risa casi al final de su reposo del principio, con niega pedido: niega todavía tiene que cargar y no
  // llega al reposo de ahora: el cambio es al final de la risa, y la mano se va antes.
  const tel = conClip('risa', 400);
  tel.pedir('niega', 9);
  assert.ok(tel.m.manoLibreMs() < 1000, `no promete la mano (${tel.m.manoLibreMs()})`);
  // El reposo con niega pedido: la mano aguanta hasta el cambio y niega no la mueve.
  const r = conClip('reposo', 2000);
  r.pedir('niega', 9);
  assert.ok(r.m.manoLibreMs() >= 5000, `${r.m.manoLibreMs()}`);
  // Y después del cambio, sigue.
  r.pasar(3000);
  assert.equal(r.m.actual.clip, 'niega');
  assert.ok(r.m.manoLibreMs() > 1500);
  assert.deepEqual(r.problemas, []);
});

prueba('sostener: mientras el sable está en la mano, ni golpes, ni «habla», ni otro fondo; al soltar vuelve a mirar', () => {
  const { r, d } = nuevo({ golpeAntesDeHablarMs: GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS });
  d.estado(est());
  assert.equal(d.pistas({ teclea: false, lee: false, golpe: { clip: 'niega', n: 1, en: r.ahora() } }).clip, 'niega');
  assert.equal(d.sostener(3000), null);
  assert.equal(d.pistas({ teclea: false, lee: false, golpe: { clip: 'asiente', n: 2, en: r.ahora() } }), null, 'otro golpe no le saca la mano');
  assert.equal(d.estado(est({ hablando: true })), null, 'la frase de molesto no lo pasa a «habla»');
  r.pasar(1500);
  assert.equal(d.revisar(), null);
  assert.equal(d.msParaRevisar(), 1500, 'el reloj de soltar');
  r.pasar(1500);
  const x = d.revisar();
  assert.deepEqual([x?.clip, x?.bucle], ['habla', true], 'soltó: sigue hablando, ahora sí «habla»');
  // Soltar antes (la capa se tapó): vuelve a mirar ya.
  const n = nuevo();
  n.d.estado(est());
  n.d.sostener(5000);
  n.d.estado(est({ escuchando: true }));
  n.r.pasar(ASENTAR_FONDO_MS + 10);
  assert.equal(n.d.revisar(), null);
  assert.equal(n.d.sostener(0), null, 'el fondo nuevo empieza a asentarse');
  n.r.pasar(ASENTAR_FONDO_MS + 10);
  assert.equal(n.d.revisar()?.clip, 'escucha');
  // Un golpe que termina durante lo sostenido vuelve a su fondo (el sable ya contaba con eso).
  const g = nuevo();
  g.d.estado(est());
  const golpe = g.d.pistas({ teclea: false, lee: false, golpe: { clip: 'niega', n: 1, en: g.r.ahora() } });
  g.d.sostener(3000);
  assert.equal(g.d.termino(golpe.n)?.clip, 'reposo');
});

/**
 * Una ráfaga de cuatro toques de punta a punta, con el guion, la mezcla, el motor de los toques y la agenda
 * del sable, armados como en CuerpoVideo + CapaEfectos. Devuelve cuándo y cómo salió el sable y cada
 * instante en que, con el sable en la mano, la mano del clip que se veía estaba en otro lado.
 */
function rafagaDePuntaAPunta(avatar, semilla) {
  let s = semilla;
  const azar = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const tel = telefono({ avatar, cargaMs: 120 + Math.floor(azar() * 250) });
  const d = new DirectorVideo({ hay: CLIPS_VIDEO, ahora: tel.r.ahora, golpeAntesDeHablarMs: GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS });
  let avisado = -1;
  let golpes = 0;
  const decidir = (rep) => rep && tel.pedir(rep.clip, rep.n);
  // La agenda, con el reloj de la prueba.
  const pendientes = [];
  const agenda = new Agenda({
    poner: (ms, f) => {
      const x = { t: tel.r.ahora() + ms, f };
      pendientes.push(x);
      return x;
    },
    quitar: (x) => {
      const i = pendientes.indexOf(x);
      if (i >= 0) pendientes.splice(i, 1);
    },
  });
  const cuerpo = { manoLibreMs: () => tel.m.manoLibreMs(), sostener: (ms) => decidir(d.sostener(ms)) };
  const motor = new MotorToques({ avatar, rng: azar });
  const golpesToque = new GolpesDeToque(agenda, (clip) => decidir(d.pistas({ ...actividad, golpe: { clip, n: ++golpes, en: tel.r.ahora() } })));
  let sable = null;
  let cortes = 0;
  const malas = [];
  const correr = (ms) => {
    for (let k = 0; k < ms; k += 10) {
      tel.pasar(10);
      for (const x of pendientes.filter((p) => p.t <= tel.r.ahora())) {
        pendientes.splice(pendientes.indexOf(x), 1);
        x.f();
      }
      if (d.msParaRevisar() === 0) decidir(d.revisar());
      const a = tel.m.actual;
      const j = tel.visible === null ? null : tel.jug[tel.visible];
      if (a && !a.bucle && j && avisado !== a.n && j.pos >= j.dur - ANTES_DEL_FIN_MS) {
        avisado = a.n;
        decidir(d.termino(a.n));
      }
      // Con el sable en la mano: la mano del clip que se ve (y del que se funde encima) en su lugar.
      if (sable && sable.anclaje === 'mano' && tel.r.ahora() < sable.hasta) {
        for (const c of [0, 1]) {
          const jj = tel.jug[c];
          // La que se ve entera, con la holgura; la de abajo de un fundido (se va apagando), lo medido.
          const arriba = c === tel.visible && !(tel.m.fundiendo && tel.jug[1 - c]?.enMarcha);
          const seVe = c === tel.visible || (tel.m.fundiendo && jj?.enMarcha);
          if (jj && seVe && manoFuera(avatar, jj.r.clip, jj.pos, arriba || c !== tel.visible)) malas.push(`${tel.r.ahora() - sable.desde} ms: ${jj.r.clip} en ${Math.round(jj.pos)}`);
        }
      }
    }
  };
  const fondos = ['reposo', 'reposo', 'escucha', 'teclea', 'lee', 'espera'];
  const fondo = fondos[Math.floor(azar() * fondos.length)];
  const actividad = { teclea: fondo === 'teclea', lee: fondo === 'lee' };
  // Antes de la ráfaga, a veces, un toque suelto con su golpe (que puede seguir a la vista).
  const antes = azar() < 0.5;
  decidir(d.estado(est({ escuchando: fondo === 'escucha' })));
  decidir(d.pistas({ ...actividad, golpe: null }));
  if (fondo === 'espera') {
    tel.r.pasar(ESPERA_TRAS_MS);
    decidir(d.revisar());
  }
  tel.pedir(d.reproduccion.clip, d.reproduccion.n);
  correr(600 + Math.floor(azar() * 5000));
  if (antes) {
    golpesToque.toque(motor.tocar(tel.r.ahora(), {}, 'cabeza', 100, 100));
    correr(2300 + Math.floor(azar() * 2000));
  }
  // Cuatro toques con el ritmo de un dedo (150-550 ms entre uno y otro), como lo hace CapaEfectos.
  const paso = 150 + Math.floor(azar() * 400);
  let r = null;
  for (let i = 0; i < 4; i++) {
    r = motor.tocar(tel.r.ahora(), {}, azar() < 0.5 ? 'cabeza' : 'panza', 100, 100);
    golpesToque.toque(r);
    if (i < 3) correr(paso);
  }
  if (r.tipo !== 'secuencia' || r.efecto !== 'espada') return null;
  const t4 = tel.r.ahora();
  sacarSable(agenda, {
    ahora: tel.r.ahora,
    lugar: 'cuerpo',
    sutil: false,
    externo: false,
    necesitaMs: 3200,
    cuerpo,
    arrancar: (a) => (sable = { ...a, desde: tel.r.ahora(), hasta: tel.r.ahora() + 3200 }),
    // Se desvanece en CORTE_MS: hasta ahí se sigue viendo.
    cortar: () => {
      cortes++;
      sable.hasta = Math.min(sable.hasta, tel.r.ahora() + CORTE_MS);
    },
  });
  // La frase de molesto: empieza enseguida y dura ~1,4 s.
  correr(300);
  decidir(d.estado(est({ hablando: true })));
  correr(1400);
  decidir(d.estado(est()));
  correr(6000);
  return { tel, sable, malas, esperoMs: sable ? sable.desde - t4 : Infinity, pendientes, fondo, cortes };
}

prueba('ráfagas de punta a punta: el sable en la mano solo con la mano en su lugar, sin saltos de pose y sin esperar de más', () => {
  const esperas = [];
  let enMano = 0;
  let n = 0;
  let cortados = 0;
  for (const avatar of ['claudio', 'antonio'])
    for (let k = 1; k <= 120; k++) {
      const x = rafagaDePuntaAPunta(avatar, k * 7919);
      if (!x) continue; // salieron los blasters (o el descanso): no esperan la mano
      n++;
      assert.ok(x.sable, `${avatar} #${k}: el sable no salió`);
      assert.deepEqual(x.malas, [], `${avatar} #${k} (${x.fondo}): el sable quedó en el aire`);
      assert.deepEqual(x.tel.problemas, [], `${avatar} #${k}`);
      assert.ok(x.esperoMs <= ESPERA_MANO_MS + 10, `${avatar} #${k}: esperó ${x.esperoMs} ms`);
      assert.equal(x.pendientes.length, 0, 'ningún reloj de la agenda quedó colgado');
      esperas.push(x.esperoMs);
      if (x.sable.anclaje === 'mano') enMano++;
      cortados += x.cortes;
    }
  esperas.sort((a, b) => a - b);
  const mediana = esperas[Math.floor(esperas.length / 2)];
  if (process.env.LINEA) console.log(`en la mano ${enMano}/${n} (cortados antes ${cortados}); espera mediana ${mediana} ms, p90 ${esperas[Math.floor(esperas.length * 0.9)]} ms, máx ${esperas[esperas.length - 1]} ms`);
  assert.ok(enMano >= n * 0.85, `casi siempre en la mano (${enMano}/${n})`);
  assert.ok(cortados <= n * 0.05, `el corte de emergencia es raro (${cortados}/${n})`);
  assert.ok(mediana <= 900, `la espera típica es corta (${mediana} ms)`);
});

prueba('la vista: monta quieto, sin positionMillis ni props que cambien, y no funde con onReadyForDisplay', () => {
  const vista = fs.readFileSync(path.resolve(AQUI, '../video/CuerpoVideo.tsx'), 'utf8');
  assert.match(vista, /shouldPlay=\{false\}/);
  assert.doesNotMatch(vista, /positionMillis=\{/);
  assert.doesNotMatch(vista, /\brate=\{/);
  assert.doesNotMatch(vista, /onReadyForDisplay=/, 'en Android llega antes del primer cuadro');
  assert.match(vista, /playAsync\(\)/);
  assert.match(vista, /setRateAsync\(/);
  assert.match(vista, /new MezclaCapas\(/);
  // Al terminar el fundido la capa nueva queda entera ANTES de quitar la de abajo (sin un cuadro con fondo).
  assert.match(vista, /case 'listo':[\s\S]{0,200}?op\[o\.capa\]\.value = 1;/);
  // Desmontado, lo que llegue tarde del reproductor no programa nada.
  assert.match(vista, /if \(!montado\.current\) return;\s*const ms = mezcla\.current!\.msParaRevisar\(\);/);
  assert.match(vista, /if \(!s\.isLoaded \|\| !montado\.current\) return;/);
  assert.match(vista, /useEffect\(\(\) => \(\) => void \(reloj\.current && clearTimeout\(reloj\.current\)\), \[\]\)/);
  assert.match(vista, /useEffect\(\(\) => \(\) => void \(relojGuion\.current && clearTimeout\(relojGuion\.current\)\), \[\]\)/);
  // La capa de efectos pregunta por la mano y pide quedarse con el clip.
  assert.match(vista, /manoLibreMs: \(\) => \(enVivoRef\.current \? mezcla\.current!\.manoLibreMs\(\) : 0\)/);
  assert.match(vista, /sostener: \(ms: number\) => decidirRef\.current\(director\.current!\.sostener\(ms\)\)/);
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
