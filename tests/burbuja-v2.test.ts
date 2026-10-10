/**
 * LA BURBUJA v2 (José, 10-oct, con fotos de su S26: «mira el círculo de asistente, necesitamos mejorar eso, se vea
 * mejor»; «nos hace falta agregar más expresiones»; y al cerrarla la mesa quedó en «Micrófono apagado»). Lo puro:
 *
 *  · el orbe: por qué salía una esquina (la foto con su tamaño propio) y el encuadre «centro» del orbe de partículas;
 *  · las expresiones: emoción del turno → parámetros del orbe (color, movimiento, núcleo), distintas y pasajeras;
 *  · las medidas de la burbuja: el círculo ~46 % del ancho, centrado, nada encimado, zonas seguras, toques de 48 dp;
 *  · el micrófono de la mesa al cerrar la burbuja: vuelve EXACTAMENTE como estaba (la máquina de estados entera);
 *  · la sesión (revisión F06/§9): un solo turno vivo, la segunda pulsación corta, lo tardío se tira, estados con
 *    palabra, el indicador del micrófono que dice la verdad y las marcas de tiempo con p50/p95.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXPRESIONES, EXPRESION_PARAMS, expresionDeCara, expresionDeEmocion, mensajeExpresion, nombreExpresion, temperatura, tinteExpresion } from '../mobile/src/orbe/expresiones';
import { orbeConOpciones } from '../mobile/src/orbe/opciones';
import { ORBE_HTML } from '../mobile/src/orbe/orbeHtml';
import { CASCARA_SOBRE_DISCO, FRACCION_ORBE, LIENZO_SOBRE_DISCO, ORBE_MIN, TOQUE_MIN, medidasBurbuja } from '../mobile/src/burbuja/medidas';
import { AvisoBurbuja, VueltaDeLaApp } from '../mobile/src/burbuja/logica';
import { OidoMesa, duenoAudio, type DuenoAudio } from '../mobile/src/compa/duenoAudio';
import {
  DETENER_P95_MS,
  MARCAS,
  SesionBurbuja,
  TrazaBurbuja,
  faseBurbuja,
  hayQueDetener,
  indicadorMic,
  leerMarca,
  lineaDetener,
  margenTeclado,
  percentil,
  pideRevision,
  type EstadoSesion,
} from '../mobile/src/burbuja/sesionBurbuja';
import { EMOCIONES } from '../mobile/src/lib/emocion';

const MOVIL = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../mobile');
const leer = (r: string) => fs.readFileSync(path.join(MOVIL, r), 'utf8');

/* ── el orbe ─────────────────────────────────────────────────────────────────────────────────── */

test('la foto del orbe mide el disco (antes: absoluteFill sin tamaño → 512 dp pegada arriba a la izquierda, una esquina en el círculo)', () => {
  const mini = leer('src/avatar3d/OrbeMini.tsx');
  assert.doesNotMatch(mini, /<Animated\.Image source=\{ORBE\} style=\{StyleSheet\.absoluteFill\}/);
  assert.match(mini, /<Animated\.Image source=\{ORBE\} style=\{\{ position: 'absolute', left: 0, top: 0, width: d, height: d \}\}/);
});

test('la burbuja dibuja el orbe de partículas de la mesa en encuadre «centro», con la foto debajo para el primer cuadro', () => {
  const b = leer('src/burbuja/Burbuja.tsx');
  assert.match(b, /<OrbeBurbuja /);
  assert.doesNotMatch(b, /<OrbeMini /, 'la foto sola ya no es el orbe de la burbuja');
  const o = leer('src/burbuja/OrbeBurbuja.tsx');
  assert.match(o, /centro: \{ radio: radioOrbe, disco: radioDisco \}/);
  assert.match(o, /<OrbeMini/);
  assert.match(o, /tipo === 'pintado'/);
  assert.match(o, /isReduceMotionEnabled/);
  // La página: encuadre centro, transparente desde el primer cuadro, expresiones, movimiento y «pintado».
  assert.match(ORBE_HTML, /const CENTRO = OPC\.centro/);
  assert.match(ORBE_HTML, /premultipliedAlpha:!!CENTRO/);
  assert.match(ORBE_HTML, /case 'expresion': setExpresion\(d\)/);
  assert.match(ORBE_HTML, /case 'movimiento':/);
  assert.match(ORBE_HTML, /notify\(\{tipo:'pintado'\}\)/);
  const html = orbeConOpciones('<html><head></head></html>', { sonidos: false, centro: { radio: 0.28, disco: 0.37 } });
  assert.match(html, /color-scheme:normal/);
  assert.match(html, /"centro":\{"radio":0\.28,"disco":0\.37\}/);
  // La mesa: lo de siempre (sin centro, sin estilo transparente) y la firma vieja sigue valiendo.
  const mesa = orbeConOpciones('<html><head></head></html>', true, { arriba: 56, abajo: 100 });
  assert.doesNotMatch(mesa, /centro|color-scheme/);
  assert.match(mesa, /"sfx":true,"margen":\{"arriba":56,"abajo":100\}/);
});

/* ── las expresiones ─────────────────────────────────────────────────────────────────────────── */

test('las siete expresiones pedidas existen, cada una distinta (color, movimiento o núcleo) y pasajera', () => {
  assert.deepEqual([...EXPRESIONES].sort(), ['alegria', 'calma', 'duda', 'entusiasmo', 'preocupacion', 'sorpresa', 'ternura']);
  for (const e of EXPRESIONES) {
    const p = EXPRESION_PARAMS[e];
    assert.ok(p.ms >= 2000 && p.ms <= 8000, `${e}: dura poco y vuelve sola a lo neutro`);
    for (const c of [p.A, p.B, p.C]) for (const v of c) assert.ok(v >= 0 && v <= 1.2, `${e}: color en rango`);
    assert.ok(nombreExpresion(e) && nombreExpresion(e, true), `${e}: tiene palabra (no solo color)`);
  }
  // Dos a dos, distintas: por color o por la firma de movimiento.
  for (const a of EXPRESIONES)
    for (const b of EXPRESIONES) {
      if (a >= b) continue;
      const pa = EXPRESION_PARAMS[a];
      const pb = EXPRESION_PARAMS[b];
      const dc = [0, 1, 2].reduce((s, i) => s + Math.abs(pa.A[i] - pb.A[i]) + Math.abs(pa.C[i] - pb.C[i]), 0);
      const dm = Math.abs(pa.ruido - pb.ruido) + Math.abs(pa.giro - pb.giro) + Math.abs(pa.brillo - pb.brillo) + Math.abs(pa.pulso - pb.pulso);
      assert.ok(dc > 0.25 || dm > 0.4, `${a} y ${b} se parecen demasiado`);
    }
  // Temperatura: cálidas las de cariño y alegría; frías la calma, la sorpresa y la duda.
  for (const e of ['alegria', 'ternura', 'entusiasmo'] as const) assert.ok(temperatura(e) > 0.4, `${e} es cálida`);
  for (const e of ['calma', 'sorpresa', 'duda'] as const) assert.ok(temperatura(e) < 0, `${e} es fría`);
  // Movimiento: la sorpresa salta más que nadie; la calma es la más quieta; la preocupación se recoge.
  assert.equal(Math.max(...EXPRESIONES.map((e) => EXPRESION_PARAMS[e].pulso)), EXPRESION_PARAMS.sorpresa.pulso);
  assert.equal(Math.min(...EXPRESIONES.map((e) => EXPRESION_PARAMS[e].ruido)), EXPRESION_PARAMS.calma.ruido);
  assert.ok(EXPRESION_PARAMS.preocupacion.radio < 0 && EXPRESION_PARAMS.preocupacion.brillo < 1);
  assert.ok(EXPRESION_PARAMS.ternura.latido[0] > 0 && EXPRESION_PARAMS.entusiasmo.latido[1] > EXPRESION_PARAMS.ternura.latido[1]);
  assert.ok((EXPRESION_PARAMS.duda.estados.thinking ?? 0) > 0, 'la duda toma los remolinos de «piensa»');
});

test('emoción del turno → expresión (las del servidor y sus alias); neutral no pone nada', () => {
  const casos: Record<string, string | null> = {
    feliz: 'alegria',
    risa: 'alegria',
    carino: 'ternura',
    ternura: 'ternura',
    triste: 'ternura',
    sorpresa: 'sorpresa',
    asombro: 'sorpresa',
    pensando: 'duda',
    duda: 'duda',
    curioso: 'duda',
    preocupado: 'preocupacion',
    alerta: 'preocupacion',
    orgullo: 'entusiasmo',
    canto: 'entusiasmo',
    cansado: 'calma',
    calma: null, // el servidor dice «calma» = neutral: el orbe no cambia
    neutral: null,
    '': null,
  };
  for (const [e, x] of Object.entries(casos)) assert.equal(expresionDeEmocion(e), x, e);
  // Ninguna emoción del contrato se queda sin decidir (o expresión, o neutral a propósito).
  for (const e of EMOCIONES) if (e !== 'neutral') assert.ok(expresionDeEmocion(e), `${e} sin expresión`);
});

test('la cara de la mesa → expresión (el orbe de la mesa también las tiene); las caras que ya son estados no ponen nada', () => {
  assert.equal(expresionDeCara('HAPPY'), 'alegria');
  assert.equal(expresionDeCara('SAD'), 'ternura');
  assert.equal(expresionDeCara('SURPRISED'), 'sorpresa');
  assert.equal(expresionDeCara('CURIOUS'), 'duda');
  assert.equal(expresionDeCara('CONCERNED'), 'preocupacion');
  assert.equal(expresionDeCara('PROUD'), 'entusiasmo');
  assert.equal(expresionDeCara('TIRED'), 'calma');
  for (const f of ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'SCAN'] as const) assert.equal(expresionDeCara(f), null, f);
  assert.match(leer('src/components/OrbeAura.tsx'), /const expresion = expresionDeCara\(face\);/);
});

test('el mensaje al orbe: todos sus parámetros; con «reducir movimiento» sin golpe ni giro; neutral la suelta', () => {
  const m = mensajeExpresion('sorpresa');
  assert.equal(m.tipo, 'expresion');
  assert.equal(m.nombre, 'sorpresa');
  assert.equal(m.fuerza, 1);
  for (const k of ['A', 'B', 'C', 'ruido', 'brillo', 'giro', 'respiro', 'latido', 'radio', 'pulso', 'estados', 'ms'] as const) assert.ok(k in m, k);
  const q = mensajeExpresion('sorpresa', { quieto: true, fuerza: 3 });
  assert.equal(q.pulso, 0);
  assert.equal(q.giro, 0);
  assert.equal(q.fuerza, 1, 'la fuerza se acota a 0..1');
  assert.ok((q.respiro as readonly number[])[0] < EXPRESION_PARAMS.sorpresa.respiro[0] + 1e-9);
  assert.deepEqual(mensajeExpresion(null), { tipo: 'expresion', nombre: 'neutral' });
  // La página lee exactamente estos nombres.
  for (const k of ['ruido', 'brillo', 'giro', 'respiro', 'latido', 'radio', 'pulso', 'estados', 'fuerza']) assert.match(ORBE_HTML, new RegExp(`d\\.${k}`), k);
  assert.equal(tinteExpresion(null), null);
  assert.match(tinteExpresion('calma') || '', /^rgba\(\d+,\d+,\d+,0\.32\)$/);
});

/* ── las medidas ─────────────────────────────────────────────────────────────────────────────── */

const S26 = { ancho: 412, alto: 915, arriba: 32, abajo: 24 };

test('en el S26 (412 × 915): el círculo ~46 % del ancho, centrado, el lienzo centrado sobre él y el orbe dentro del disco', () => {
  const m = medidasBurbuja(S26);
  assert.ok(Math.abs(m.lado - 412 * FRACCION_ORBE) <= 2, `lado ${m.lado}`);
  assert.equal(m.orbe.x * 2 + m.lado, 412, 'centrado');
  assert.equal(m.lienzo, Math.round(m.lado * LIENZO_SOBRE_DISCO));
  assert.ok(Math.abs(m.lienzoXY.x + m.lienzo / 2 - (m.orbe.x + m.lado / 2)) <= 1, 'lienzo centrado en x');
  assert.ok(Math.abs(m.lienzoXY.y + m.lienzo / 2 - (m.orbe.y + m.lado / 2)) <= 1, 'lienzo centrado en y');
  assert.ok(m.radioOrbe < m.radioDisco && m.radioDisco < 0.5, 'la cáscara dentro del disco, el disco dentro del lienzo');
  assert.ok(Math.abs(m.radioOrbe / m.radioDisco - CASCARA_SOBRE_DISCO) < 1e-9);
  // Que se vea entero: el lienzo cabe en la pantalla.
  assert.ok(m.lienzoXY.x >= 0 && m.lienzoXY.x + m.lienzo <= 412);
  assert.ok(m.lienzoXY.y >= S26.arriba);
});

function sinEncimarse(m: ReturnType<typeof medidasBurbuja>, alto: number, arriba: number, abajo: number) {
  assert.ok(m.controles.abajo >= abajo, 'los controles sobre la zona de gestos');
  assert.ok(m.controles.boton >= TOQUE_MIN && m.abrir.alto >= TOQUE_MIN && m.campo.alto >= TOQUE_MIN, 'toques de 48 dp');
  assert.ok(m.abrir.abajo >= m.controles.abajo + m.controles.alto, '«Abrir» sobre los controles');
  assert.ok(m.estado.abajo >= m.abrir.abajo + m.abrir.alto, 'el estado sobre «Abrir»');
  const fondoOrbe = alto - (m.orbe.y + m.lado);
  assert.ok(fondoOrbe >= m.estado.abajo + m.estado.alto, 'el orbe sobre el estado (el estado nunca encima del orbe)');
  assert.ok(m.transcripcion.abajo >= fondoOrbe + m.lado, 'la transcripción sobre el orbe');
  assert.ok(m.transcripcion.abajo + m.transcripcion.altoMax <= alto - arriba, 'la transcripción bajo la barra de estado');
}

test('nada se encima: controles, «Abrir», estado, orbe y transcripción, en vertical, acostado y con letra grande', () => {
  sinEncimarse(medidasBurbuja(S26), 915, 32, 24);
  const acostado = medidasBurbuja({ ancho: 915, alto: 412, arriba: 0, abajo: 16 });
  sinEncimarse(acostado, 412, 0, 16);
  // Acostado el orbe cede (más chico, o entero si no cabe junto a la transcripción: tests/pulido-571-movil.test.ts).
  assert.ok(acostado.lado < 412 * 0.46 && (acostado.lado === 0 || acostado.lado >= ORBE_MIN), 'acostado el orbe cede');
  assert.ok(acostado.transcripcion.altoMax >= 48, 'acostado la transcripción se ve');
  const grande = medidasBurbuja({ ...S26, escalaTexto: 2 });
  sinEncimarse(grande, 915, 32, 24);
  assert.ok(grande.transcripcion.altoMax >= 150, 'con letra grande la transcripción tiene sitio');
  const chico = medidasBurbuja({ ancho: 360, alto: 640, arriba: 24, abajo: 0 });
  sinEncimarse(chico, 640, 24, 0);
  assert.ok(chico.transcripcion.altoMax >= 78);
});

test('al escribir el orbe se achica sobre el campo (y el campo sube con el teclado); con la cámara se esconde', () => {
  const n = medidasBurbuja(S26);
  const e = medidasBurbuja({ ...S26, modo: 'escribir', teclado: 300 });
  assert.ok(e.lado < n.lado / 1.5);
  assert.equal(e.campo.abajo, 24 + 12 + 300);
  assert.ok(915 - (e.orbe.y + e.lado) >= e.campo.abajo + e.campo.alto, 'el orbe sobre el campo');
  assert.equal(medidasBurbuja({ ...S26, modo: 'camara' }).lado, 0);
  // El teclado: con adjustResize de verdad la ventana se encoge (no se sube nada); de borde a borde, todo.
  assert.equal(margenTeclado({ alturaTeclado: 300, altoVentanaSinTeclado: 915, altoVentanaAhora: 615 }), 0);
  assert.equal(margenTeclado({ alturaTeclado: 300, altoVentanaSinTeclado: 915, altoVentanaAhora: 915 }), 300);
});

/* ── el micrófono de la mesa al cerrar la burbuja ────────────────────────────────────────────── */

/**
 * La mesa entera en pequeño: su OidoMesa con dependencias falsas, el aviso de la burbuja y la espera de la vuelta, como
 * los conectan DeskScreen (efecto del dueño) y Burbuja.tsx (soltarAvisoBurbuja).
 */
function mesaFalsa(o: { silenciadaPorPersona: boolean }) {
  const hechos: string[] = [];
  const aviso = new AvisoBurbuja();
  const vuelta = new VueltaDeLaApp();
  let microAbierto = !o.silenciadaPorPersona;
  const oido = new OidoMesa({
    muteMic: () => {
      microAbierto = false;
      hechos.push('mute');
    },
    unmuteMic: () => {
      microAbierto = true;
      hechos.push('unmute');
    },
    reabrirMic: () => {
      microAbierto = true;
      hechos.push('reabrir');
    },
    pauseMicForTts: () => undefined,
    stopSpeaking: () => undefined,
    cancelarTurno: () => undefined,
    micQuerido: () => !o.silenciadaPorPersona,
    silenciadoPorPersona: () => o.silenciadaPorPersona,
    acusarBurbuja: () => aviso.acusar(),
  });
  oido.fijar('mesa');
  let appActiva = true;
  let status = o.silenciadaPorPersona ? 'muted' : 'listening';
  // El efecto del dueño de DeskScreen.
  const efecto = () => {
    const d: DuenoAudio = duenoAudio({ enLlamada: false, conversacion: false, burbuja: aviso.abierta(), mesaVisible: true, appActiva });
    const hizo = oido.aplicar(d);
    if (hizo === 'suelta') status = 'muted';
    else if (hizo === 'toma') status = o.silenciadaPorPersona ? 'muted' : microAbierto ? 'listening' : 'reconnect';
  };
  aviso.suscribir(efecto);
  return {
    hechos,
    aviso,
    abrirBurbuja: () => aviso.fijar(true),
    /** Burbuja.tsx al cerrarse: suelta el micrófono prestado y espera (o no) la vuelta de la app. */
    cerrarBurbuja: (estadoAhora: string, motivo: 'fuera' | 'fondo' | 'abrir-app') => {
      if (microAbierto) {
        microAbierto = false;
        hechos.push('mute-burbuja');
      }
      if (vuelta.empezar(estadoAhora, motivo)) aviso.fijar(false);
    },
    appState: (s: string) => {
      appActiva = s === 'active' ? true : appActiva;
      if (vuelta.cambio(s)) aviso.fijar(false);
    },
    get status() {
      return status;
    },
    get microAbierto() {
      return microAbierto;
    },
  };
}

test('micrófono abierto → burbuja encima de AURA → tocar fuera: la mesa lo vuelve a abrir (ciclo fondo → activa)', () => {
  const m = mesaFalsa({ silenciadaPorPersona: false });
  m.abrirBurbuja();
  assert.equal(m.status, 'muted', 'con la burbuja delante el micrófono es suyo');
  m.cerrarBurbuja('active', 'fuera');
  assert.equal(m.aviso.abierta(), true, 'todavía delante la burbuja que se va');
  m.appState('background');
  m.appState('active');
  assert.equal(m.aviso.abierta(), false);
  assert.equal(m.microAbierto, true);
  assert.equal(m.status, 'listening');
  assert.deepEqual(m.hechos.slice(-1), ['reabrir']);
});

test('la burbuja se desmonta con la app YA delante (cerrada por el nativo): antes la mesa se quedaba en «Micrófono apagado»; ahora lo recupera', () => {
  // Lo de antes, para que quede escrito: sin el motivo, se esperaba un «fondo» que no llega hasta salir de la app.
  const vieja = new VueltaDeLaApp();
  assert.equal(vieja.empezar('active'), false);
  assert.equal(vieja.cambio('active'), false);
  assert.equal(vieja.esperando(), true, 'atascada: el aviso «abierta» no se soltaba');
  // Ahora.
  const m = mesaFalsa({ silenciadaPorPersona: false });
  m.abrirBurbuja();
  m.appState('background'); // la burbuja dejó de verse…
  m.appState('active'); // …y MainActivity volvió delante (todavía con el aviso puesto: nadie cerró la burbuja)
  assert.equal(m.aviso.abierta(), true);
  m.cerrarBurbuja('active', 'fondo'); // el nativo la termina: se desmonta con la app delante
  assert.equal(m.aviso.abierta(), false, 'se suelta en el acto');
  assert.equal(m.microAbierto, true);
  assert.equal(m.status, 'listening');
});

test('desmontada en el fondo (otra app delante): espera a que AURA vuelva; nunca abre el micrófono encima de otra app', () => {
  const m = mesaFalsa({ silenciadaPorPersona: false });
  m.abrirBurbuja();
  m.appState('background');
  m.cerrarBurbuja('background', 'fondo');
  assert.equal(m.aviso.abierta(), true);
  assert.equal(m.microAbierto, false);
  m.appState('active');
  assert.equal(m.aviso.abierta(), false);
  assert.equal(m.microAbierto, true);
});

test('si la persona lo había silenciado, sigue silenciado al cerrar la burbuja (sin reabrir nada)', () => {
  const m = mesaFalsa({ silenciadaPorPersona: true });
  m.abrirBurbuja();
  m.cerrarBurbuja('active', 'fuera');
  m.appState('background');
  m.appState('active');
  assert.equal(m.aviso.abierta(), false);
  assert.equal(m.microAbierto, false);
  assert.equal(m.status, 'muted');
  assert.ok(!m.hechos.includes('reabrir') && !m.hechos.includes('unmute'));
});

test('Burbuja.tsx pasa el motivo a la espera y solo la burbuja más nueva suelta el aviso', () => {
  const b = leer('src/burbuja/Burbuja.tsx');
  assert.match(b, /vuelta\.empezar\(AppState\.currentState, motivo\)/);
  assert.match(b, /if \(apertura !== aperturas\) return;/);
  assert.match(b, /soltarAvisoBurbuja\(motivo, apertura\.current\)/);
});

/* ── la sesión: un solo turno, cortes, estados, micrófono y marcas ───────────────────────────── */

test('un solo turno vivo: la segunda pulsación corta el turno y la voz; lo que llega tarde del turno cortado se tira', () => {
  const s = new SesionBurbuja();
  const cancelados: number[] = [];
  const g1 = s.empezarTurno(() => cancelados.push(1));
  assert.equal(s.vigente(g1), true);
  // Segunda pulsación del botón.
  assert.equal(s.cortar('reinvocacion'), true);
  assert.deepEqual(cancelados, [1]);
  assert.equal(s.vigente(g1), false, 'la frase, el audio o el resultado de g1 ya no cuentan');
  assert.equal(s.cortar('reinvocacion'), false, 'nada que cortar: no se cancela dos veces');
  // Un turno nuevo con otro vivo corta el anterior (nunca dos pedidos a la vez).
  const g2 = s.empezarTurno(() => cancelados.push(2));
  const g3 = s.empezarTurno(() => cancelados.push(3));
  assert.deepEqual(cancelados, [1, 2]);
  assert.equal(s.vigente(g2), false);
  assert.equal(s.vigente(g3), true);
  s.terminar(g2); // tarde: no toca al vigente
  assert.equal(s.enCurso(), true);
  s.terminar(g3);
  assert.equal(s.enCurso(), false);
  assert.deepEqual(s.historialCortes(), ['reinvocacion', 'nuevo-turno']);
  // Un cancelar que falla no rompe el corte.
  s.empezarTurno(() => {
    throw new Error('x');
  });
  assert.equal(s.cortar('detener'), true);
  // Burbuja.tsx: la reinvocación corta y mide; el turno descarta lo de una generación vieja.
  const b = leer('src/burbuja/Burbuja.tsx');
  assert.match(b, /cortar\('reinvocacion', true\)/);
  assert.match(b, /const vale = \(\) => sesion\.vigente\(gen\) && !control\.cerrada\(\);/);
  assert.match(b, /alFrase: \(f\) => vale\(\) && f && setRespuesta\(f\)/);
  assert.match(b, /if \(!vale\(\) \|\| r\.cortado\) return;/);
});

test('estados con palabra corta: iniciando, escuchando, procesando, hablando, esperando revisión, recuperando conexión, cerrada', () => {
  const esperado: [EstadoSesion, string][] = [
    ['arrancando', 'Iniciando…'],
    ['escuchando', 'Escuchando'],
    ['pensando', 'Procesando…'],
    ['hablando', 'Hablando'],
    ['revision', 'Esperando revisión'],
    ['reconectando', 'Recuperando conexión…'],
    ['cerrada', 'Cerrada'],
  ];
  for (const [e, t] of esperado) {
    assert.equal(faseBurbuja(e).texto, t);
    assert.ok(faseBurbuja(e, { en: true }).texto.length > 0);
    assert.ok(faseBurbuja(e).texto.length <= 24, `${e}: corto`);
  }
  // Mientras piensa y habla no oye, y se dice (honesto: sin «hablarle encima» en la burbuja).
  assert.match(faseBurbuja('pensando').detalle, /No te oigo/);
  assert.match(faseBurbuja('hablando').detalle, /Detener/);
  assert.equal(faseBurbuja('escuchando', { micSilenciado: true }).texto, 'Micrófono silenciado');
  assert.equal(faseBurbuja('escuchando', { capturando: false }).texto, 'Abriendo el micrófono…');
  for (const e of ['sin-sesion', 'sin-permiso', 'sin-oido', 'ocupada', 'error', 'escribiendo', 'camara'] as EstadoSesion[]) assert.ok(faseBurbuja(e).texto, e);
});

test('el indicador del micrófono dice la verdad: encendido solo si captura de verdad', () => {
  assert.equal(indicadorMic({ silenciadoPorPersona: false, capturando: true, pausado: false }).abierto, true);
  assert.equal(indicadorMic({ silenciadoPorPersona: false, capturando: false, pausado: false }).abierto, false, 'pedido ≠ capturando');
  const p = indicadorMic({ silenciadoPorPersona: false, capturando: true, pausado: true });
  assert.equal(p.abierto, false, 'en pausa mientras habla: no se pinta encendido');
  assert.match(p.etiqueta, /pausa/);
  const s = indicadorMic({ silenciadoPorPersona: true, capturando: true, pausado: false });
  assert.equal(s.abierto, false);
  assert.equal(s.texto, 'Activar');
  assert.equal(hayQueDetener('hablando'), true);
  assert.equal(hayQueDetener('pensando'), true);
  assert.equal(hayQueDetener('escuchando'), false);
  assert.equal(pideRevision({ acciones: [{ tipo: 'abrir' }] }), true);
  assert.equal(pideRevision({ tareas: [{}] }), true);
  assert.equal(pideRevision({ acciones: [], tareas: undefined }), false);
});

test('las marcas de tiempo: reloj monótono, desde la pulsación, una miga por turno y por sesión; p50/p95 desde las migas', () => {
  let t = 1000;
  const reloj = () => t;
  // Pulsación 120 ms antes de que React arrancara (reloj de pared).
  const tr = new TrazaBurbuja({ invocadaEnPared: 50_000 - 120, ahoraPared: 50_000, reloj, id: 'ab12' });
  assert.equal(tr.ahora(), 120);
  t += 60;
  tr.marcar('ui-lista');
  t += 200;
  tr.marcar('captura-inicio');
  t += 1500;
  tr.marcar('fin-voz');
  tr.marcar('captura-fin');
  tr.nuevoTurno();
  tr.marcar('peticion');
  t += 700;
  tr.marcar('primer-contenido');
  t += 10;
  tr.marcar('primer-contenido'); // la primera vale
  t += 300;
  tr.marcar('primer-audio');
  t += 2000;
  const linea = tr.finTurno();
  assert.match(linea, /^\[traza-burbuja\] s=ab12 t=1 /);
  assert.equal(leerMarca(linea, 'invocacion'), 0);
  assert.equal(leerMarca(linea, 'captura-inicio'), 380);
  assert.equal(leerMarca(linea, 'fin-voz'), 1880);
  assert.equal(leerMarca(linea, 'peticion'), 1880);
  assert.equal(leerMarca(linea, 'primer-contenido'), 2580);
  assert.equal(leerMarca(linea, 'primer-audio'), 2890);
  assert.equal(leerMarca(linea, 'fin-turno'), 4890);
  // El turno siguiente tiene su propio «fin de voz» (no hereda el de este).
  t += 1000;
  tr.marcar('fin-voz');
  tr.nuevoTurno();
  tr.marcar('peticion');
  const otra = tr.finTurno('cortado=detener');
  assert.match(otra, / t=2 /);
  assert.equal(leerMarca(otra, 'fin-voz'), 5890);
  assert.match(otra, /cortado=detener$/);
  tr.marcar('cierre');
  const ses = tr.lineaSesion('motivo=fuera');
  assert.equal(leerMarca(ses, 'ui-lista'), 180);
  assert.match(ses, /turnos=2 motivo=fuera$/);
  // Las marcas pedidas están todas.
  for (const k of ['invocacion', 'ui-lista', 'captura-inicio', 'captura-fin', 'fin-voz', 'peticion', 'primer-contenido', 'primer-audio', 'cierre']) assert.ok((MARCAS as readonly string[]).includes(k), k);
  // Una pulsación sin hora (o absurda) cuenta desde ahora.
  assert.equal(new TrazaBurbuja({ invocadaEnPared: null, ahoraPared: 1, reloj }).ahora(), 0);
  assert.equal(new TrazaBurbuja({ invocadaEnPared: 10, ahoraPared: 10_000_000, reloj }).ahora(), 0);
  // «detener»: de la orden al silencio, en su miga; y p50/p95 de varias.
  const medidas = [90, 110, 120, 130, 140, 150, 160, 180, 220, 400];
  const lineas = medidas.map((ms) => lineaDetener('ab12', ms, 'detener'));
  const leidas = lineas.map((l) => leerMarca(l, 'detener→silencio') as number);
  assert.deepEqual(leidas, medidas);
  assert.equal(percentil(leidas, 50), 140);
  assert.equal(percentil(leidas, 95), 400);
  assert.match(lineaDetener('x', DETENER_P95_MS + 1, 'detener'), /lento/);
  assert.ok(Number.isNaN(percentil([], 50)));
  // La burbuja deja las marcas en las migas.
  const b = leer('src/burbuja/Burbuja.tsx');
  for (const m of ['ui-lista', 'captura-inicio', 'fin-voz', 'peticion', 'primer-contenido', 'primer-audio', 'cierre']) assert.match(b, new RegExp(`traza\\.marcar\\('${m}'\\)`), m);
  assert.match(b, /miga\(traza\.finTurno\(/);
  assert.match(b, /miga\(traza\.lineaSesion\(/);
  assert.match(b, /miga\(lineaDetener\(/);
});

test('controles grandes y accesibles: escribir, cámara, micrófono, detener; subtítulos; «Abrir revisión»; nada solo por color', () => {
  const b = leer('src/burbuja/Burbuja.tsx');
  for (const i of ['lapiz', 'camara', 'detener', 'subtitulos']) assert.match(b, new RegExp(`icono="${i}"`), i);
  assert.match(b, /mic\.abierto \? 'microfono' : 'microfonoNo'/);
  assert.match(b, /accessibilityLiveRegion="polite"/);
  assert.match(b, /Abrir revisión/);
  assert.match(b, /maxFontSizeMultiplier=\{MAX_LETRA\}/);
  assert.doesNotMatch(b, /allowFontScaling=\{false\}/, 'la letra grande del sistema se respeta');
  // Cada control tiene su palabra visible además del ícono, y su etiqueta para el lector.
  assert.match(b, /<Text style=\{s\.controlTexto\}/);
  assert.match(b, /accessibilityLabel=\{etiqueta\}/);
  // Sin «hablarle encima» en la burbuja: mientras piensa y habla el micrófono se pausa.
  assert.match(b, /pauseMicForTts\(true\);/);
});
