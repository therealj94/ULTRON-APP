/**
 * Pruebas en Node del avatar (sin teléfono):
 *   el contrato (del ánimo de la compañera al estado de cualquier cuerpo, los gestos de cuerpo, los
 *   toques con zona), el mapeo estado → blendshapes y animaciones (con y sin visemas, con nombres
 *   propios de un modelo), las zonas, los visemas en español y las tres fuentes de la boca, la señal
 *   de voz, la caída al 2D (capacidad y qué cuerpo se dibuja), los modos de presencia y su lugar en el
 *   perfil, la acción `presencia` que llega por voz, y el revisor de modelos (con un .glb armado aquí).
 *
 *   cd mobile && npx tsx src/avatar3d/pruebas/avatar3d.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ANIMO_INICIAL, reducir, EXPRESIONES } from '../../compa/animo.ts';
import { FIGURAS } from '../../compa/figura.ts';
import { esAccionApp } from '../../compa/acciones.ts';
import { estadoAvatar, estadoDesdeAnimo, estadoDesdeMesa, gestoDeEvento, mismoEstado } from '../contrato.ts';
import { ESTADO_INICIAL, EXPRESIONES_AVATAR, VISEMAS, GESTOS_AVATAR } from '../tipos.ts';
import { ARKIT_52, BYTES_MAX_NODOS, MAPEO_BASE, PERFIL_NODOS, buscarNombre, claveBase, clipBase, clipGesto, combinarMapeo, nombreVisema, pesosObjetivo, zona2D, zonaDeNodo, zonaPorPosicion } from '../mapeo.ts';
import { LineaVisemas, componerBoca, visemaDeEspectro, visemaDeLetra, visemasDeTexto, HZ_MIN, HZ_MAX } from '../visemas.ts';
import { SenalVoz } from '../senalVoz.ts';
import { ANCHO_PARA_PANEL, disposicionDock, modoEfectivo, normalizarPresencia, siguienteModo } from '../presencia.ts';
import { FPS_MINIMO, OLVIDO_MS, anotarCalidad, anotarFallo, calidadInicial, cuerpoQueToca, puede3D, veredictoRendimiento } from '../capacidad.ts';

// modelo.ts pide los .glb con `require` (Metro los empaqueta); en Node, un .glb es su ruta.
createRequire(import.meta.url)('node:module').Module._extensions['.glb'] = (m, archivo) => {
  m.exports = archivo;
};
const { MODELOS_3D } = await import('../modelo.ts');

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOVIL = path.resolve(AQUI, '../../..');

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

const conAnimo = (cambios) => ({ ...ANIMO_INICIAL, ...cambios, voz: { ...ANIMO_INICIAL.voz, ...(cambios.voz || {}) }, mesa: { ...ANIMO_INICIAL.mesa, ...(cambios.mesa || {}) } });
const estado = (cambios = {}) => ({ ...ESTADO_INICIAL, ...cambios });
const todo = () => true;
const soloEstos = (lista) => (n) => lista.includes(n);

/* ── el contrato ─────────────────────────────────────────────────────────────────────────── */

prueba('contrato: las caras de la compañera y las del avatar son las mismas (y cada una tiene figura 2D y pesos 3D)', () => {
  assert.deepEqual([...EXPRESIONES].sort(), [...EXPRESIONES_AVATAR].sort());
  for (const e of EXPRESIONES_AVATAR) {
    assert.ok(FIGURAS[e], `figura 2D de ${e}`);
    assert.ok(MAPEO_BASE.expresiones[e], `pesos 3D de ${e}`);
  }
  assert.equal(VISEMAS.length, 15);
  assert.equal(ARKIT_52.length, 52);
  assert.equal(new Set(ARKIT_52).size, 52);
});

prueba('contrato: del ánimo al estado del cuerpo (escucha, habla, piensa, dormida, reacción)', () => {
  const t = 1_000;
  let e = estadoDesdeAnimo(conAnimo({ voz: { estado: 'escuchando' } }), t);
  assert.equal(e.expresion, 'escucha');
  assert.equal(e.escuchando, true);
  assert.equal(e.hablando, false);
  e = estadoDesdeAnimo(conAnimo({ voz: { estado: 'hablando' }, sentir: 'feliz' }), t);
  assert.equal(e.hablando, true);
  assert.equal(e.expresion, 'contenta');
  e = estadoDesdeAnimo(conAnimo({ voz: { estado: 'conectando' } }), t);
  assert.equal(e.pensando, true);
  assert.equal(e.expresion, 'piensa');
  e = estadoDesdeAnimo(conAnimo({ voz: { estado: 'escuchando', silenciada: true } }), t);
  assert.equal(e.silenciado, true);
  assert.equal(e.escuchando, false, 'dormida no escucha');
  assert.equal(e.expresion, 'dormida');
  e = estadoDesdeAnimo(conAnimo({ reaccion: { exp: 'timida', hasta: t + 500 } }), t, { caminando: true, dir: -1, globo: '¡Hola!' });
  assert.equal(e.expresion, 'timida');
  assert.equal(e.caminando, true);
  assert.equal(e.dir, -1);
  assert.equal(e.globo, '¡Hola!');
  assert.equal(estadoDesdeAnimo(conAnimo({ reaccion: { exp: 'timida', hasta: t - 1 } }), t).expresion, 'tranquila', 'la reacción vence');
});

prueba('contrato: tocarle la mejilla la pone tímida, la panza risueña, la cabeza contenta; cada una con su gesto de cuerpo', () => {
  const t = 10_000;
  const casos = [
    ['mejilla', 'timida', 'toque_mejilla'],
    ['panza', 'encantada', 'toque_panza'],
    ['cabeza', 'contenta', 'toque_cabeza'],
    [undefined, 'contenta', 'toque_cabeza'],
    ['mano', 'contenta', null],
  ];
  for (const [zona, cara, gesto] of casos) {
    const ev = zona ? { tipo: 'toque', zona } : { tipo: 'toque' };
    const r = reducir(ANIMO_INICIAL, ev, t, () => 0.99);
    assert.equal(r.animo.reaccion?.exp, cara, `cara con ${zona}`);
    assert.equal(gestoDeEvento(ev, ANIMO_INICIAL, r.animo, r.efectos), gesto, `gesto con ${zona}`);
  }
  // La panza da risa más seguido que la cabeza (0,8 contra 0,45).
  const risa = (zona) => reducir(ANIMO_INICIAL, { tipo: 'toque', zona }, t, () => 0.6).efectos.some((e) => e.tipo === 'sonido');
  assert.equal(risa('panza'), true);
  assert.equal(risa('cabeza'), false);
});

prueba('contrato: enojo, gusto, saludar al conectar, señalar el borrador, entrar y salir con la llamada', () => {
  const t = 5_000;
  let a = ANIMO_INICIAL;
  let r = reducir(a, { tipo: 'molestar' }, t);
  assert.equal(gestoDeEvento({ tipo: 'molestar' }, a, r.animo, r.efectos), 'enojo');
  r = reducir(a, { tipo: 'caricia' }, t);
  assert.equal(gestoDeEvento({ tipo: 'caricia' }, a, r.animo, r.efectos), 'gusto');
  a = conAnimo({ voz: { estado: 'conectando' } });
  const ev = { tipo: 'voz', voz: { estado: 'escuchando', silenciada: false, dormida: false, suspendida: false } };
  r = reducir(a, ev, t);
  assert.equal(gestoDeEvento(ev, a, r.animo, r.efectos), 'saludar');
  const red = { tipo: 'accion', accion: { tipo: 'redactar', para: 'Beto', texto: 'Llego tarde' } };
  r = reducir(ANIMO_INICIAL, red, t);
  assert.equal(gestoDeEvento(red, ANIMO_INICIAL, r.animo, r.efectos), 'senalar');
  r = reducir(ANIMO_INICIAL, { tipo: 'llamada', activa: true }, t);
  assert.equal(gestoDeEvento({ tipo: 'llamada', activa: true }, ANIMO_INICIAL, r.animo, r.efectos), 'salir');
  const oculta = r.animo;
  r = reducir(oculta, { tipo: 'llamada', activa: false }, t + 1);
  assert.equal(gestoDeEvento({ tipo: 'llamada', activa: false }, oculta, r.animo, r.efectos), 'entrar');
  // Todo gesto que sale del contrato es uno que el mapeo conoce.
  for (const g of GESTOS_AVATAR) assert.ok(MAPEO_BASE.animaciones.gestos[g]?.length, g);
});

prueba('contrato: mismoEstado ignora lo que no se ve y nota lo que sí', () => {
  const a = estado();
  assert.equal(mismoEstado(a, { ...a, mirar: { x: 0.02, y: 0, activa: false } }), true);
  assert.equal(mismoEstado(a, { ...a, expresion: 'contenta' }), false);
  assert.equal(mismoEstado(a, { ...a, gesto: { nombre: 'gusto', n: 1 } }), false);
  assert.equal(mismoEstado(a, { ...a, globo: 'hola' }), false);
  assert.deepEqual(estadoAvatar.ultimo(), ESTADO_INICIAL);
});

/* ── el mapeo estado → blendshapes / animaciones ─────────────────────────────────────────── */

prueba('mapeo: cada expresión mueve lo suyo y solo lo que el modelo tiene', () => {
  const p = pesosObjetivo(estado({ expresion: 'enojada' }), { nivel: 0, visema: 'sil', peso: 1 }, MAPEO_BASE, todo);
  assert.ok(p.browDownLeft > 0.8 && p.browDownRight > 0.8);
  assert.ok(p.mouthFrownLeft > 0.4);
  const poco = pesosObjetivo(estado({ expresion: 'enojada' }), { nivel: 0, visema: 'sil', peso: 1 }, MAPEO_BASE, soloEstos(['browDownLeft']));
  assert.deepEqual(Object.keys(poco), ['browDownLeft']);
  const dormida = pesosObjetivo(estado({ expresion: 'tranquila', silenciado: true }), { nivel: 0.9, visema: 'aa', peso: 1 }, MAPEO_BASE, todo);
  assert.equal(dormida.eyeBlinkLeft, 1, 'en silencio, ojos cerrados');
  assert.equal(dormida.viseme_aa, undefined, 'en silencio, la boca no habla');
  const timida = pesosObjetivo(estado({ expresion: 'timida' }), { nivel: 0, visema: 'sil', peso: 1 }, MAPEO_BASE, todo);
  assert.equal(timida.rubor, 1);
  assert.ok(timida.eyeLookDownLeft > 0.3);
});

prueba('mapeo: hablando, el visema va encima de la cara (y la sonrisa se suelta un poco)', () => {
  const e = estado({ expresion: 'contenta', hablando: true });
  const quieta = pesosObjetivo(e, { nivel: 0, visema: 'sil', peso: 1 }, MAPEO_BASE, todo);
  const habla = pesosObjetivo(e, { nivel: 0.6, visema: 'O', peso: 1 }, MAPEO_BASE, todo);
  assert.ok(habla.viseme_O > 0.7, `viseme_O=${habla.viseme_O}`);
  assert.ok(!habla.viseme_aa, 'con confianza 1 no hay «a» de relleno');
  assert.ok(habla.mouthSmileLeft < quieta.mouthSmileLeft, 'la sonrisa baja mientras habla');
  assert.equal(habla.cheekSquintLeft, quieta.cheekSquintLeft, 'lo que no es boca no cambia');
  // Con poca confianza, parte de la forma es una «a».
  const dudosa = pesosObjetivo(e, { nivel: 0.6, visema: 'SS', peso: 0.5 }, MAPEO_BASE, todo);
  assert.ok(dudosa.viseme_SS > 0.3 && dudosa.viseme_aa > 0.3);
  // Más volumen, más abre.
  const bajo = pesosObjetivo(e, { nivel: 0.2, visema: 'aa', peso: 1 }, MAPEO_BASE, todo);
  const alto = pesosObjetivo(e, { nivel: 0.7, visema: 'aa', peso: 1 }, MAPEO_BASE, todo);
  assert.ok(alto.viseme_aa > bajo.viseme_aa);
});

prueba('mapeo: sin visemas en el modelo, la boca sale de ARKit (mandíbula y labios)', () => {
  const sinVisemas = (n) => !n.startsWith('viseme_');
  const o = pesosObjetivo(estado({ hablando: true }), { nivel: 0.7, visema: 'O', peso: 1 }, MAPEO_BASE, sinVisemas);
  assert.ok(o.jawOpen > 0.3 && o.mouthFunnel > 0.4);
  const u = pesosObjetivo(estado({ hablando: true }), { nivel: 0.7, visema: 'U', peso: 1 }, MAPEO_BASE, sinVisemas);
  assert.ok(u.mouthPucker > o.mouthPucker, 'la «u» redondea más que la «o»');
  const pp = pesosObjetivo(estado({ hablando: true }), { nivel: 0.7, visema: 'PP', peso: 1 }, MAPEO_BASE, sinVisemas);
  assert.ok(pp.mouthClose > 0.3);
});

prueba('mapeo: la animación de fondo según el estado, con respaldos hasta el reposo', () => {
  assert.equal(claveBase(estado()), 'idle');
  assert.equal(claveBase(estado({ escuchando: true })), 'escuchar');
  assert.equal(claveBase(estado({ escuchando: true, hablando: true })), 'hablar');
  assert.equal(claveBase(estado({ pensando: true })), 'pensar');
  assert.equal(claveBase(estado({ caminando: true, escuchando: true })), 'caminar');
  assert.equal(claveBase(estado({ silenciado: true, caminando: true })), 'dormir');
  assert.equal(claveBase(estado({ expresion: 'levantada' })), 'levantada');
  const completo = ['idle', 'escuchar', 'hablar', 'pensar', 'caminar', 'dormir'];
  assert.equal(clipBase(estado({ hablando: true }), MAPEO_BASE, completo), 'hablar');
  // Sin «hablar» ni «escuchar», hablando se queda en reposo.
  assert.equal(clipBase(estado({ hablando: true }), MAPEO_BASE, ['idle', 'caminar']), 'idle');
  assert.equal(clipBase(estado({ hablando: true }), MAPEO_BASE, ['idle', 'escuchar']), 'escuchar');
  assert.equal(clipBase(estado(), MAPEO_BASE, []), null);
  assert.equal(clipGesto('saludar', MAPEO_BASE, ['idle', 'saludar']), 'saludar');
  assert.equal(clipGesto('saludar', MAPEO_BASE, ['idle']), null);
});

prueba('mapeo: nombres de otro modelo (Mixamo, mayúsculas, un .mapeo.json) se encuentran', () => {
  assert.equal(buscarNombre(['head'], ['mixamorig:Head', 'Neck']), 'mixamorig:Head');
  assert.equal(buscarNombre(['caminar', 'walk'], ['Armature|Walk_Cycle']), 'Armature|Walk_Cycle');
  assert.equal(buscarNombre(['senalar'], ['Señalar']), 'Señalar');
  assert.equal(buscarNombre(['idle'], ['Dance']), null);
  const m = combinarMapeo(MAPEO_BASE, { expresiones: { enojada: { Angry: 1 } }, animaciones: { gestos: { saludar: ['Wave'] } }, camaras: { retrato: 'Cam_Cara' } });
  assert.deepEqual(m.expresiones.enojada, { Angry: 1 });
  assert.deepEqual(m.expresiones.contenta, MAPEO_BASE.expresiones.contenta, 'lo no mencionado queda igual');
  assert.equal(clipGesto('saludar', m, ['Idle', 'Wave']), 'Wave');
  assert.equal(m.camaras.retrato, 'Cam_Cara');
  assert.equal(m.camaras.cuerpo, 'camara_cuerpo');
  const p = pesosObjetivo(estado({ expresion: 'enojada' }), { nivel: 0, visema: 'sil', peso: 1 }, m, soloEstos(['Angry']));
  assert.deepEqual(p, { Angry: 1 });
  assert.equal(combinarMapeo(MAPEO_BASE, null), MAPEO_BASE);
});

/* ── el perfil «nodos» (los avatares de Codex) ────────────────────────────────────────────── */

const CLIPS_CODEX = ['neutral', 'feliz', 'risa', 'sorpresa', 'curioso', 'pensando', 'preocupado', 'triste', 'molesto', 'cansado', 'carino', 'orgullo', 'travieso', 'canto', 'oracion', 'escepticismo', 'alarma', 'firme', 'seco', 'escuchando', 'dormido', 'saludar', 'lentes', 'asentir', 'negar', 'explicar', 'celebrar', 'corazon', 'senalar', 'caminar'];
const BOCA_CODEX = ['open', 'laugh', 'round', 'wide', 'frown', 'closed'];

prueba('nodos: el perfil traduce el vocabulario de Codex; la cara de cada expresión es su clip', () => {
  const m = combinarMapeo(MAPEO_BASE, { perfil: 'nodos' });
  assert.equal(m.rig, 'nodos');
  assert.equal(MAPEO_BASE.rig, 'humanoide', 'el perfil no ensucia el mapeo base');
  // Cada expresión de AURA tiene su emoción de Codex, y todas existen en los clips.
  for (const e of EXPRESIONES_AVATAR) assert.ok(buscarNombre(m.animaciones.expresiones[e], CLIPS_CODEX), e);
  for (const g of GESTOS_AVATAR) assert.ok(clipGesto(g, m, CLIPS_CODEX), g);
  assert.equal(clipBase(estado(), m, CLIPS_CODEX), 'neutral');
  assert.equal(clipBase(estado({ expresion: 'contenta' }), m, CLIPS_CODEX), 'feliz');
  assert.equal(clipBase(estado({ expresion: 'timida' }), m, CLIPS_CODEX), 'carino');
  assert.equal(clipBase(estado({ expresion: 'enojada', hablando: true }), m, CLIPS_CODEX), 'molesto', 'hablando enojada: la cara enojada, la boca con la voz');
  assert.equal(clipBase(estado({ hablando: true }), m, CLIPS_CODEX), 'neutral');
  assert.equal(clipBase(estado({ escuchando: true }), m, CLIPS_CODEX), 'escuchando');
  assert.equal(clipBase(estado({ silenciado: true }), m, CLIPS_CODEX), 'dormido');
  assert.equal(clipBase(estado({ caminando: true, expresion: 'contenta' }), m, CLIPS_CODEX), 'caminar', 'paseando, camina aunque esté contenta');
  assert.equal(clipBase(estado({ pensando: true }), m, CLIPS_CODEX), 'pensando');
  // Tocarla: cabeza asiente (le gusta), mejilla se lleva la mano al pecho (tímida), enojo niega.
  assert.equal(clipGesto('toque_cabeza', m, CLIPS_CODEX), 'asentir');
  assert.equal(clipGesto('toque_mejilla', m, CLIPS_CODEX), 'corazon');
  assert.equal(clipGesto('enojo', m, CLIPS_CODEX), 'negar');
  // El ojo izquierdo del personaje es su lado +1 (mira hacia +Z); AU-RA tiene un solo `gaze`.
  assert.equal(buscarNombre(m.huesos.ojoIzq, ['head', 'gaze_-1', 'gaze_1']), 'gaze_1');
  assert.equal(buscarNombre(m.huesos.ojoDer, ['head', 'gaze_-1', 'gaze_1']), 'gaze_-1');
  assert.equal(buscarNombre(m.huesos.ojoDer, ['head', 'gaze']), null, 'AU-RA: el único ojo no se gira dos veces');
  // Un humanoide sigue igual: sin clips de cara, la expresión no elige el fondo.
  assert.equal(clipBase(estado({ expresion: 'contenta' }), MAPEO_BASE, ['idle', 'feliz']), 'idle');
});

prueba('nodos: la boca de la voz sale de sus seis formas (O/U redonda, E/I ancha, P cerrada), sin ARKit', () => {
  const m = combinarMapeo(MAPEO_BASE, { perfil: 'nodos' });
  const hay = soloEstos(BOCA_CODEX);
  const o = pesosObjetivo(estado({ hablando: true, expresion: 'contenta' }), { nivel: 0.7, visema: 'O', peso: 1 }, m, hay);
  assert.ok(o.round > 0.8, JSON.stringify(o));
  assert.equal(Object.keys(o).filter((k) => !BOCA_CODEX.includes(k)).length, 0, 'solo formas que el modelo tiene');
  assert.ok(pesosObjetivo(estado({ hablando: true }), { nivel: 0.7, visema: 'I', peso: 1 }, m, hay).wide > 0.8);
  assert.equal(pesosObjetivo(estado({ hablando: true }), { nivel: 0.7, visema: 'PP', peso: 1 }, m, hay).closed, 0.945);
  assert.ok(pesosObjetivo(estado({ hablando: true }), { nivel: 0.7, visema: 'aa', peso: 1 }, m, hay).open > 0.9);
  assert.deepEqual(pesosObjetivo(estado({ expresion: 'contenta' }), { nivel: 0, visema: 'sil', peso: 0 }, m, hay), {}, 'callada: la cara es del clip');
  assert.deepEqual(pesosObjetivo(estado({ silenciado: true }), { nivel: 0.9, visema: 'aa', peso: 1 }, m, hay), {}, 'en silencio no mueve la boca');
  // Todos los visemas nombran solo formas de Codex.
  for (const v of VISEMAS) for (const k of Object.keys(PERFIL_NODOS.visemas[v])) assert.ok(BOCA_CODEX.includes(k), `${v}: ${k}`);
});

prueba('mesa: la cara de la mesa (FaceState + emoción del turno) → el estado del cuerpo 3D', () => {
  assert.equal(estadoDesdeMesa('IDLE', 'neutral').expresion, 'tranquila');
  assert.equal(estadoDesdeMesa('IDLE', 'feliz').expresion, 'contenta', 'en reposo, la emoción del turno afina la cara');
  const habla = estadoDesdeMesa('SPEAKING', 'molesto');
  assert.equal(habla.hablando, true);
  assert.equal(habla.expresion, 'enojada');
  assert.equal(estadoDesdeMesa('LAUGH', 'triste').expresion, 'encantada', 'una cara explícita de la mesa manda sobre la emoción');
  assert.equal(estadoDesdeMesa('SLEEPING', 'neutral').silenciado, true);
  assert.equal(estadoDesdeMesa('LISTENING', 'neutral').escuchando, true);
  assert.equal(estadoDesdeMesa('THINKING', 'neutral').pensando, true);
  assert.equal(estadoDesdeMesa('RARO', 'raro').expresion, 'tranquila');
  const mira = estadoDesdeMesa('IDLE', 'neutral', { mirar: { x: 0.4, y: -0.2, activa: true }, gesto: { nombre: 'toque_cabeza', n: 3 } });
  assert.deepEqual(mira.mirar, { x: 0.4, y: -0.2, activa: true });
  assert.deepEqual(mira.gesto, { nombre: 'toque_cabeza', n: 3 });
});

prueba('mapeo: zonas por nombre de nodo, por posición (3D sin colisionadores) y en la figurita 2D', () => {
  assert.equal(zonaDeNodo('zona_mejilla_izq', MAPEO_BASE), 'mejilla');
  assert.equal(zonaDeNodo('Zona_Cabeza', MAPEO_BASE), 'cabeza');
  assert.equal(zonaDeNodo('zona_panza.001', MAPEO_BASE), 'panza');
  assert.equal(zonaDeNodo('Body', MAPEO_BASE), null);
  assert.equal(zonaPorPosicion({ dx: 0, dy: -0.5, alto: 0.95 }), 'cabeza');
  assert.equal(zonaPorPosicion({ dx: 0.7, dy: 0.3, alto: 0.9 }), 'mejilla');
  assert.equal(zonaPorPosicion({ dx: 0, dy: 6, alto: 0.55 }), 'panza');
  assert.equal(zonaPorPosicion({ dx: 3, dy: 9, alto: 0.2 }), 'cuerpo');
  assert.equal(zona2D(50, 20, 50, 50, 28), 'cabeza');
  assert.equal(zona2D(75, 52, 50, 50, 28), 'mejilla');
  assert.equal(zona2D(50, 70, 50, 50, 28), 'panza');
});

/* ── los visemas y la boca ───────────────────────────────────────────────────────────────── */

prueba('visemas: letras del español con sus vecinas (ch, ll, qu, gue, ce/ci, h muda, y final, rr)', () => {
  const v = (t) => visemasDeTexto(t);
  assert.deepEqual(v('mamá'), ['PP', 'aa', 'PP', 'aa']);
  assert.deepEqual(v('chico'), ['CH', null, 'I', 'kk', 'O']);
  assert.deepEqual(v('calle'), ['kk', 'aa', 'CH', null, 'E']);
  assert.deepEqual(v('queso'), ['kk', null, 'E', 'SS', 'O']);
  assert.deepEqual(v('guitarra'), ['kk', null, 'I', 'DD', 'aa', 'RR', null, 'aa']);
  assert.deepEqual(v('cena'), ['SS', 'E', 'nn', 'aa']);
  assert.deepEqual(v('hola'), [null, 'O', 'nn', 'aa']);
  assert.deepEqual(v('hoy'), [null, 'O', 'I']);
  assert.deepEqual(v('yo'), ['CH', 'O']);
  assert.deepEqual(v('fe, ¿ya?'), ['FF', 'E', 'sil', 'sil', 'sil', 'CH', 'aa', 'sil']);
  assert.equal(visemaDeLetra(['ñ'], 0), 'nn');
  assert.equal(visemaDeLetra(['u'], 0), 'U');
});

prueba('visemas: la alineación de ElevenLabs se vuelve una línea de tiempo; los pedazos van seguidos y se cortan', () => {
  const l = new LineaVisemas(100);
  l.agregar({ chars: ['s', 'í'], char_start_times_ms: [0, 80], char_durations_ms: [80, 120] }, 1000);
  assert.equal(l.en(1050), null, 'antes de la demora no suena');
  assert.equal(l.en(1120), 'SS');
  assert.equal(l.en(1200), 'I');
  // El segundo pedazo empieza donde terminó el primero (1300), aunque llegue antes.
  l.agregar({ chars: ['o'], char_start_times_ms: [0], char_durations_ms: [100] }, 1010);
  assert.equal(l.en(1350), 'O');
  assert.equal(l.activa(1350), true);
  l.cortar();
  assert.equal(l.en(1350), null);
  assert.equal(l.activa(1350), false);
  l.agregar({ chars: [], char_start_times_ms: [], char_durations_ms: [] }, 0);
  l.agregar(null, 0);
  assert.equal(l.en(0), null);
});

prueba('visemas: el espectro distingue la «s», la «i», la «u» y la «a»', () => {
  const bandas = (f) => Array.from({ length: 64 }, (_, i) => f(HZ_MIN + (i + 0.5) * ((HZ_MAX - HZ_MIN) / 64)));
  assert.equal(visemaDeEspectro(bandas((hz) => (hz > 4000 ? 200 : 10)), 0.5).visema, 'SS');
  assert.equal(visemaDeEspectro(bandas((hz) => (hz > 1800 && hz < 2600 ? 220 : hz < 800 ? 40 : 10)), 0.5).visema, 'E');
  assert.equal(visemaDeEspectro(bandas((hz) => (hz < 600 ? 240 : 5)), 0.2).visema, 'U');
  assert.equal(visemaDeEspectro(bandas((hz) => (hz < 600 ? 240 : 5)), 0.6).visema, 'O');
  assert.equal(visemaDeEspectro(bandas((hz) => (hz < 800 ? 220 : hz < 1500 ? 150 : 10)), 0.6).visema, 'aa');
  assert.equal(visemaDeEspectro(bandas(() => 100), 0.01).visema, 'sil');
});

prueba('boca: la alineación manda, después el espectro, después solo el volumen', () => {
  const esp = Array.from({ length: 32 }, (_, i) => (i > 20 ? 250 : 5));
  assert.deepEqual(componerBoca(0.5, { alineado: 'O', espectro: esp }), { nivel: 0.5, visema: 'O', peso: 1 });
  assert.equal(componerBoca(0.5, { espectro: esp }).visema, 'SS');
  assert.deepEqual(componerBoca(0.5), { nivel: 0.5, visema: 'aa', peso: 0.4 });
  assert.equal(componerBoca(0.01).visema, 'sil');
  // Una letra alineada abre aunque el volumen venga bajo (el volumen llega tarde).
  assert.ok(componerBoca(0.05, { alineado: 'aa' }).nivel >= 0.25);
  assert.equal(componerBoca(2).nivel, 1);
});

prueba('señal de voz: el nivel publica la boca; el espectro vale 200 ms; la alineación y el corte', () => {
  let t = 0;
  const s = new SenalVoz(() => t, 0);
  const vistas = [];
  s.boca.escuchar((b) => vistas.push(b));
  s.nivel(0.5);
  assert.deepEqual(s.boca.ultimo(), { nivel: 0.5, visema: 'aa', peso: 0.4 });
  s.nivel(0.5);
  assert.equal(vistas.length, 1, 'sin cambios no se repite');
  s.espectro(new Uint8Array(32).map((_, i) => (i > 20 ? 250 : 5)));
  s.nivel(0.5);
  assert.equal(s.boca.ultimo().visema, 'SS');
  t = 500;
  s.nivel(0.5);
  assert.equal(s.boca.ultimo().visema, 'aa', 'un espectro viejo ya no cuenta');
  s.alineacion({ chars: ['u'], char_start_times_ms: [0], char_durations_ms: [300] });
  t = 600;
  s.nivel(0.4);
  assert.equal(s.boca.ultimo().visema, 'U');
  s.cortar();
  assert.deepEqual(s.boca.ultimo(), { nivel: 0, visema: 'sil', peso: 0 });
  assert.equal(s.quiereForma(), false);
  const a = s.pedirForma();
  const b = s.pedirForma();
  assert.equal(s.quiereForma(), true);
  a();
  a();
  assert.equal(s.quiereForma(), true, 'desanotarse dos veces no descuenta a otro');
  b();
  assert.equal(s.quiereForma(), false);
});

/* ── la caída al 2D ──────────────────────────────────────────────────────────────────────── */

prueba('2D: un avatar sin modelo registrado (el Guardián) se dibuja con la figurita, tal cual; los demás traen el suyo', () => {
  assert.equal(MODELOS_3D.ojos, undefined, 'el Guardián no tiene cuerpo 3D');
  for (const avatar of ['aura', 'claudio', 'antonio']) assert.ok(MODELOS_3D[avatar], `${avatar}: modelo registrado`);
  for (const avatar of ['ojos', 'aura', 'claudio', 'antonio']) {
    if (MODELOS_3D[avatar]) continue;
    assert.equal(cuerpoQueToca({ hayModelo: false, puedeProbar: true, activo: true, listo: false }), '2d', avatar);
  }
  for (const [avatar, m] of Object.entries(MODELOS_3D)) {
    assert.match(m.huella, /^[0-9a-f]{16}$/, `${avatar}: huella`);
    assert.ok(m.bytes > 0, `${avatar}: bytes`);
  }
});

prueba('2D: el 3D se intenta solo si el teléfono no falló con ESE modelo; se olvida en dos semanas', () => {
  const t = 1_000_000;
  assert.equal(puede3D(null, 'abc', t), true);
  assert.equal(puede3D(null, '', t), false, 'sin huella (sin modelo) no hay 3D');
  const r = anotarFallo(null, 'abc', 'la escena 3D no arrancó a tiempo', t);
  assert.equal(puede3D(r, 'abc', t + 1000), false);
  assert.equal(puede3D(r, 'otro', t + 1000), true, 'un modelo nuevo se vuelve a probar');
  assert.equal(puede3D(r, 'abc', t + OLVIDO_MS + 1), true);
  const r2 = anotarFallo(r, 'nuevo', 'x'.repeat(500), t + OLVIDO_MS + 5);
  assert.equal(r2.abc, undefined, 'lo viejo se limpia');
  assert.equal(r2.nuevo.motivo.length, 120);
});

prueba('calidad: arranca en la que aguantó ESE modelo; se olvida en dos semanas; un modelo nuevo arranca en alta', () => {
  const t = 5_000_000;
  assert.equal(calidadInicial(null, 'abc', t), 'alta');
  const r = anotarCalidad(null, 'abc', 'media', t);
  assert.equal(calidadInicial(r, 'abc', t + 1000), 'media');
  assert.equal(calidadInicial(r, 'otro', t + 1000), 'alta');
  assert.equal(calidadInicial(r, 'abc', t + OLVIDO_MS + 1), 'alta');
  assert.equal(calidadInicial({ abc: { calidad: 'ultra', en: t } }, 'abc', t), 'alta', 'lo raro no vale');
  const r2 = anotarCalidad(r, 'nuevo', 'baja', t + OLVIDO_MS + 5);
  assert.equal(r2.abc, undefined, 'lo viejo se limpia');
  assert.equal(r2.nuevo.calidad, 'baja');
});

prueba('2D: qué cuerpo se ve en cada momento (y el rendimiento que hace caer)', () => {
  const base = { hayModelo: true, puedeProbar: true, activo: true, listo: false };
  assert.equal(cuerpoQueToca(base), 'probando', 'arrancando: la figurita a la vista y el 3D debajo');
  assert.equal(cuerpoQueToca({ ...base, listo: true }), '3d');
  assert.equal(cuerpoQueToca({ ...base, listo: true, activo: false }), '2d', 'escondida (llamada, en otro lado): sin escena');
  assert.equal(cuerpoQueToca({ ...base, puedeProbar: false }), '2d', 'falló antes en este teléfono');
  assert.equal(veredictoRendimiento({ fps: 58, dpr: 2, lento: false }), 'bien');
  assert.equal(veredictoRendimiento({ fps: 40, dpr: 1, lento: true }), 'caer');
  assert.equal(veredictoRendimiento({ fps: FPS_MINIMO - 1, dpr: 1, lento: false }), 'caer');
  assert.equal(veredictoRendimiento({ fps: FPS_MINIMO - 1, dpr: 1.5, lento: false }), 'bien', 'con más resolución todavía puede bajar');
});

/* ── los modos de presencia ──────────────────────────────────────────────────────────────── */

prueba('presencia: el modo que se ve según la preferencia, la pantalla y la llamada', () => {
  const m = (preferencia, pantalla, enLlamada = false) => modoEfectivo({ preferencia, pantalla, enLlamada });
  assert.equal(m(undefined, 'chats'), 'paseo', 'sin preferencia, la de siempre');
  assert.equal(m('lado', 'chats'), 'lado');
  assert.equal(m('lado', 'ajustes'), 'paseo', 'al lado solo en los chats');
  assert.equal(m('completa', 'chats'), 'completa');
  assert.equal(m('completa', 'perfil'), 'completa');
  assert.equal(m('completa', 'mesa'), 'paseo', 'la mesa ya es AURA de frente');
  assert.equal(m('lado', 'chats', true), 'oculta', 'en llamada se apaga como siempre');
  assert.equal(m('completa', null), 'oculta', 'fuera de la sesión no está');
  assert.equal(normalizarPresencia('lado'), 'lado');
  assert.equal(normalizarPresencia('flotando'), undefined);
});

prueba('presencia: en vertical una franja que no pasa de un sexto; acostado o tableta, un panel de un tercio', () => {
  const v = disposicionDock(360, 780);
  assert.equal(v.tipo, 'franja');
  assert.ok(v.alto >= 96 && v.alto <= 132 && v.alto <= 780 / 5);
  const chico = disposicionDock(320, 560);
  assert.equal(chico.alto, 96);
  const h = disposicionDock(800, 380);
  assert.equal(h.tipo, 'panel');
  assert.ok(h.ancho >= 260 && h.ancho <= 420);
  assert.equal(disposicionDock(1280, 800).ancho, 420);
  assert.equal(disposicionDock(ANCHO_PARA_PANEL - 1, 300).tipo, 'franja', 'un teléfono angosto acostado no divide');
  assert.equal(disposicionDock(900, 1200).tipo, 'franja', 'tableta en vertical: franja');
});

prueba('presencia: los botones y el «atrás» llevan al modo que dicen', () => {
  assert.equal(siguienteModo('lado', 'agrandar'), 'completa');
  assert.equal(siguienteModo('completa', 'acoplar'), 'lado');
  assert.equal(siguienteModo('completa', 'achicar'), 'paseo');
  assert.equal(siguienteModo('completa', 'atras'), 'lado');
  assert.equal(siguienteModo('lado', 'atras'), 'paseo');
});

prueba('presencia: la acción de voz `presencia` es del contrato; un valor raro se descarta', () => {
  assert.equal(esAccionApp({ tipo: 'presencia', valor: 'completa' }), true);
  assert.equal(esAccionApp({ tipo: 'presencia', valor: 'lado' }), true);
  assert.equal(esAccionApp({ tipo: 'presencia', valor: 'volando' }), false);
  assert.equal(esAccionApp({ tipo: 'presencia' }), false);
});

prueba('presencia: se guarda en el perfil; un servidor que todavía no la conoce no la borra ni la pide para siempre', async () => {
  const P = await perfilEnNode();
  const base = P.perfilInicial({ apodo: 'José', ahora: 1 });
  assert.equal(base.presencia, undefined);
  const con = P.aplicarCambios(base, { presencia: 'lado' }, 2);
  assert.equal(con.presencia, 'lado');
  assert.equal(P.aplicarCambios(con, { presencia: 'volando' }, 3).presencia, 'lado', 'un valor raro no pisa');
  assert.deepEqual(P.cuerpoPut(con, { presencia: 'lado' }), { presencia: 'lado' });
  assert.equal(P.normalizarPerfil({ ...con, presencia: 'completa' }).presencia, 'completa');
  assert.equal(P.normalizarPerfil({ ...con, presencia: 'x' }).presencia, undefined);
  // El servidor viejo contesta sin el campo: se conserva el de aquí y no queda como hueco a reenviar.
  const servidor = { ...con, presencia: undefined, actualizado: 5 };
  delete servidor.presencia;
  assert.equal(P.fusionar(con, servidor, null).presencia, 'lado');
  assert.deepEqual(P.huecosDelServidor(con, servidor), {});
  // El servidor nuevo manda (lo cambiaron desde otro teléfono).
  assert.equal(P.fusionar(con, { ...con, presencia: 'completa' }, null).presencia, 'completa');
  // Lo pendiente de este teléfono va encima.
  assert.equal(P.fusionar(con, { ...con, presencia: 'completa' }, { presencia: 'paseo' }).presencia, 'paseo');
});

/* ── el revisor de modelos ───────────────────────────────────────────────────────────────── */

/** Un .glb armado a mano (solo el JSON, sin geometría): basta para lo que revisa el revisor. */
function glbDePrueba(json) {
  const datos = Buffer.from(JSON.stringify(json));
  const relleno = (4 - (datos.length % 4)) % 4;
  const js = Buffer.concat([datos, Buffer.alloc(relleno, 0x20)]);
  const cab = Buffer.alloc(12);
  cab.writeUInt32LE(0x46546c67, 0);
  cab.writeUInt32LE(2, 4);
  cab.writeUInt32LE(12 + 8 + js.length, 8);
  const trozo = Buffer.alloc(8);
  trozo.writeUInt32LE(js.length, 0);
  trozo.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([cab, trozo, js]);
}

function modeloQueCumple() {
  const huesos = [
    ['hips', [0, 1.0, 0]], ['spine', [0, 0.1, 0]], ['chest', [0, 0.15, 0]], ['upperChest', [0, 0.1, 0]], ['neck', [0, 0.12, 0]], ['head', [0, 0.1, 0]],
    ['leftEye', [0.03, 0.06, 0.08]], ['rightEye', [-0.03, 0.06, 0.08]], ['jaw', [0, -0.03, 0.02]],
    ['leftShoulder', [0.05, 0.1, 0]], ['leftUpperArm', [0.12, 0, 0]], ['leftLowerArm', [0.25, 0, 0]], ['leftHand', [0.24, 0, 0]],
    ['rightShoulder', [-0.05, 0.1, 0]], ['rightUpperArm', [-0.12, 0, 0]], ['rightLowerArm', [-0.25, 0, 0]], ['rightHand', [-0.24, 0, 0]],
    ['leftUpperLeg', [0.09, -0.05, 0]], ['leftLowerLeg', [0, -0.42, 0]], ['leftFoot', [0, -0.42, 0]], ['leftToes', [0, -0.05, 0.1]],
    ['rightUpperLeg', [-0.09, -0.05, 0]], ['rightLowerLeg', [0, -0.42, 0]], ['rightFoot', [0, -0.42, 0]], ['rightToes', [0, -0.05, 0.1]],
  ];
  const padre = { spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck', leftEye: 'head', rightEye: 'head', jaw: 'head', leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm', rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm', leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot', rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot' };
  const nodos = huesos.map(([name, translation]) => ({ name, translation }));
  const idx = (n) => nodos.findIndex((x) => x.name === n);
  for (const [hijo, p] of Object.entries(padre)) (nodos[idx(p)].children ||= []).push(idx(hijo));
  for (const z of ['zona_cabeza', 'zona_mejilla_izq', 'zona_mejilla_der', 'zona_panza', 'camara_retrato', 'camara_cuerpo']) nodos.push({ name: z });
  nodos.push({ name: 'cuerpo', mesh: 0, skin: 0 });
  const nombres = [...ARKIT_52, ...VISEMAS.map(nombreVisema), 'rubor'];
  const clips = ['idle', 'caminar', 'escuchar', 'hablar', 'pensar', 'dormir', 'levantada', ...GESTOS_AVATAR];
  return {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    nodes: nodos,
    skins: [{ joints: huesos.map(([n]) => idx(n)) }],
    meshes: [{ name: 'cuerpo', extras: { targetNames: nombres }, primitives: [{ attributes: { POSITION: 0 }, indices: 1, targets: nombres.map(() => ({ POSITION: 0 })) }] }],
    accessors: [{ count: 12000 }, { count: 90000 }, { count: 30, max: [2.5] }],
    materials: [{}, {}],
    animations: clips.map((name) => ({ name, samplers: [{ input: 2 }], channels: [] })),
  };
}

prueba('revisor: un modelo que cumple la especificación pasa sin errores', async () => {
  const R = await import('../../../scripts/avatar3d-modelo.mjs');
  const r = R.revisarGlb(glbDePrueba(modeloQueCumple()));
  assert.deepEqual(r.errores, [], r.errores.join('\n'));
  assert.equal(r.resumen.triangulos, 30000);
  assert.equal(r.resumen.alturaCabeza, 1.57);
  assert.equal(r.resumen.blendshapes, 68);
});

prueba('revisor: dice qué falta (visemas, huesos, zonas, animaciones), lo que no se permite, el tamaño y la escala', async () => {
  const R = await import('../../../scripts/avatar3d-modelo.mjs');
  const m = modeloQueCumple();
  m.meshes[0].extras.targetNames = m.meshes[0].extras.targetNames.filter((n) => n !== 'viseme_aa' && n !== 'jawOpen');
  m.nodes = m.nodes.filter((n) => n.name !== 'zona_panza');
  m.animations = m.animations.filter((a) => a.name !== 'saludar');
  m.extensionsUsed.push('KHR_draco_mesh_compression');
  m.accessors[1].count = 300000;
  const r = R.revisarGlb(glbDePrueba(m));
  const todoJunto = r.errores.join('\n');
  for (const falta of ['viseme_aa', 'jawOpen', 'zona_panza', 'saludar', 'KHR_draco_mesh_compression', '100000 triángulos']) assert.match(todoJunto, new RegExp(falta), falta);
  // En centímetros (la cabeza a 157 m) o mirando hacia atrás, no.
  const cm = modeloQueCumple();
  cm.nodes[0].translation = [0, 100, 0];
  assert.match(R.revisarGlb(glbDePrueba(cm)).errores.join('\n'), /escala/);
  const atras = modeloQueCumple();
  for (const nd of atras.nodes) if (nd.translation) nd.translation = [-nd.translation[0], nd.translation[1], -nd.translation[2]];
  assert.match(R.revisarGlb(glbDePrueba(atras)).errores.join('\n'), /\+Z/);
  assert.match(R.revisarGlb(Buffer.from('no soy un glb, soy un texto largo')).errores[0], /firma/);
});

prueba('revisor: con un .mapeo.json, los nombres propios del modelo cuentan', async () => {
  const R = await import('../../../scripts/avatar3d-modelo.mjs');
  const m = modeloQueCumple();
  m.nodes.find((x) => x.name === 'hips').name = 'Pelvis';
  m.animations.find((a) => a.name === 'caminar').name = 'Andar';
  const sin = R.revisarGlb(glbDePrueba(m));
  assert.match(sin.errores.join('\n'), /hips/);
  assert.match(sin.errores.join('\n'), /caminar/);
  const con = R.revisarGlb(glbDePrueba(m), { humanoide: { hips: 'Pelvis' }, animaciones: { base: { caminar: ['Andar'] } } });
  assert.deepEqual(con.errores, []);
});

prueba('revisor nodos: los tres modelos de Codex cumplen (≤ 3 MB, triángulos, clips y formas de boca del perfil)', async () => {
  const R = await import('../../../scripts/avatar3d-modelo.mjs');
  const modelos = R.modelosEnCarpeta();
  assert.deepEqual(modelos.map((m) => m.avatar), ['aura', 'claudio', 'antonio']);
  for (const m of modelos) {
    assert.deepEqual(m.errores, [], `${m.avatar}: ${m.errores.join('; ')}`);
    assert.equal(m.resumen.rig, 'nodos');
    assert.ok(m.bytes <= BYTES_MAX_NODOS, `${m.avatar}: ${m.bytes} bytes`);
    assert.ok(m.resumen.triangulos <= R.LIMITES_NODOS.triangulosMax, `${m.avatar}: ${m.resumen.triangulos} triángulos`);
    assert.equal(m.resumen.animaciones.length, 30);
    assert.deepEqual(m.mapeo, { perfil: 'nodos' });
  }
});

prueba('revisor nodos: dice qué falta (una forma de boca, un clip, la cabeza) y lo que se pasa (peso, Draco)', async () => {
  const R = await import('../../../scripts/avatar3d-modelo.mjs');
  const bueno = () => ({
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    nodes: [{ name: 'body', children: [1] }, { name: 'head', children: [2] }, { name: 'mouth', mesh: 0 }],
    meshes: [{ extras: { targetNames: BOCA_CODEX }, primitives: [{ attributes: { POSITION: 0 }, indices: 1, targets: BOCA_CODEX.map(() => ({ POSITION: 0 })) }] }],
    accessors: [{ count: 900 }, { count: 3000 }, { count: 10, max: [4.7] }],
    animations: CLIPS_CODEX.map((name) => ({ name, samplers: [{ input: 2 }], channels: [] })),
  });
  const mapeo = { perfil: 'nodos' };
  assert.deepEqual(R.revisarGlb(glbDePrueba(bueno()), mapeo).errores, []);
  const m = bueno();
  m.meshes[0].extras.targetNames = BOCA_CODEX.filter((n) => n !== 'round');
  m.animations = m.animations.filter((a) => a.name !== 'carino');
  m.nodes[1].name = 'cabeza_rara';
  m.extensionsUsed.push('KHR_draco_mesh_compression');
  m.accessors[1].count = 300000;
  const todo = R.revisarGlb(glbDePrueba(m), mapeo).errores.join('\n');
  for (const falta of ['round', 'carino', 'cabeza', 'KHR_draco_mesh_compression', '100000 triángulos']) assert.match(todo, new RegExp(falta), falta);
  const pesado = Buffer.concat([glbDePrueba(bueno()), Buffer.alloc(BYTES_MAX_NODOS)]);
  pesado.writeUInt32LE(pesado.length, 8);
  assert.match(R.revisarGlb(pesado, mapeo).errores.join('\n'), /el máximo es 3 MB/);
});

prueba('revisor: el registro de la app coincide con assets/avatar3d (AU-RA, Claudio y ANT-ONIO; el Guardián en 2D)', async () => {
  const R = await import('../../../scripts/avatar3d-modelo.mjs');
  const modelos = R.modelosEnCarpeta();
  assert.equal(fs.readFileSync(R.REGISTRO, 'utf8'), R.generarRegistro(modelos), 'corre `npx tsx scripts/avatar3d-modelo.mjs registrar`');
  const uno = R.generarRegistro([{ avatar: 'aura', bytes: 10, huella: 'abcd', mapeo: { camaras: { retrato: 'x' } } }]);
  assert.match(uno, /aura: \{\n {4}fuente: require\('\.\.\/\.\.\/assets\/avatar3d\/aura\.glb'\)/);
  assert.match(uno, /mapeo: \{"camaras":\{"retrato":"x"\}\}/);
});

/* ── el perfil en node (empaquetado con lo nativo de mentira) ─────────────────────────────── */

let perfilCache = null;
async function perfilEnNode() {
  if (perfilCache) return perfilCache;
  const req = createRequire(path.join(MOVIL, 'package.json'));
  const esbuild = req(fs.existsSync(path.join(MOVIL, '../node_modules/esbuild')) ? path.join(MOVIL, '../node_modules/esbuild') : 'esbuild');
  const shim = path.join(MOVIL, 'pruebas/avatar3d/shims/nativo.js');
  const salida = path.join(MOVIL, 'pruebas/avatar3d/out/perfil.cjs');
  await esbuild.build({
    entryPoints: [path.join(MOVIL, 'src/lib/perfil.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: salida,
    logLevel: 'silent',
    external: ['react'],
    plugins: [
      {
        name: 'nativo',
        setup(b) {
          b.onResolve({ filter: /^(react-native|@react-native-async-storage\/async-storage|\.\/api|\.\/storage|\.\/tts)$/ }, () => ({ path: shim }));
        },
      },
    ],
  });
  perfilCache = req(salida);
  return perfilCache;
}

/* ── correr ──────────────────────────────────────────────────────────────────────────────── */

for (const [nombre, f] of pruebas) {
  n++;
  try {
    await f();
    console.log(`  ok    ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`  FALLA ${nombre}\n        ${String(e?.stack || e).split('\n').slice(0, 4).join('\n        ')}`);
  }
}
console.log(`\n${n - fallos}/${n} pruebas bien`);
process.exit(fallos ? 1 : 0);
