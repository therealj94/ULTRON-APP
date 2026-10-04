/**
 * Pruebas en Node de la lógica de la compañera (sin teléfono):
 *   la máquina de la sesión (generaciones, silencio, segundo plano, llamadas, reintento), el permiso
 *   precalentado, el ánimo, los gestos, los bordes, el lector SSE, el puente de acciones contra un
 *   servidor HTTP falso (con un XMLHttpRequest hecho sobre http), el contexto y la emoción del texto.
 *
 *   cd mobile && npx tsx src/compa/pruebas/compa.prueba.mjs
 */
import assert from 'node:assert/strict';
import {
  avisoMesa,
  estadoEnPalabras,
  sondeoMs,
  tareaEnPalabras,
  trabajando as pcTrabajando,
  enMarcha as pcEnMarcha,
  quieta as pcQuieta,
  EJEMPLOS_PC,
  CompaneroPc,
  esAccionPc,
  PAUSA_TRAS_PERSONA_MS,
  MIN_ENTRE_FRASES_MS,
  FINAL_ESPERA_MAX_MS,
  TOPE_TRABAJO_MS,
  TOPE_QUIETA_MS,
  relojMision,
  marcaPlan,
  controlesPc,
  aCoordenadas,
  textoParaCompartir,
  finalEnPalabras,
  haceCuanto,
  VistaPc,
  nuevoPedidoPc,
  respuestaPc,
} from '../computadora.ts';
import http from 'node:http';
import { ABRIR_MAX_MS, CONECTAR_MAX_MS, ControlSesion, ESPERA_PERMISO_MS, PENSANDO_MAX_MS, PERMISO_MAX_MS, SIN_MUESTRAS_MS, SORDA_MS, TOPE_RECONEXIONES } from '../sesion.ts';
import {
  CicloLlamada,
  ESPERA_SIGUES_MS,
  FIN_VISIBLE_MS,
  FRASE_RECONECTA_MS,
  MENSAJE_LLAMAME,
  MENSAJE_RECONECTA,
  MENSAJE_SIGUES,
  mensajeReconecta,
  PREGUNTA_SIGUES_MS,
  SONAR_MS,
  avisoMinutos,
  diaHonduras,
  etiquetaCiclo,
  leyendaLlamada,
  llamadaActiva,
  llamadaTerminada,
  mesaCallada,
  relojLlamada,
  seguirVozMesa,
} from '../llamadaCiclo.ts';
import { Precalentador } from '../permiso.ts';
import { coordinarLlamadas } from '../llamada.ts';
import { ANIMO_INICIAL, GLOBO_PENSANDO_MS, expresion, puedeCaminar, reducir } from '../animo.ts';
import { Gestos } from '../gestos.ts';
import { pegarABorde, reubicar, yCarril, limitar, destinoPaseo, lugarGlobo } from '../borde.ts';
import { LectorSse } from '../sse.ts';
import { PuenteAcciones, ContextoApp, esAccionApp, accionesDelTurno, accionNueva, depurarContactos, VENTANA_MISMA_ACCION_MS, mensajeDeLectura, decirLectura, mensajeDeRecordatorio, decirRecordatorio, ambienteDe } from '../acciones.ts';
import { AmbienteConversacion, GRACIA_MS, AMBIENTE_MAX_MS, VOLUMEN_AMBIENTE } from '../ambiente.ts';
import * as REC from '../recordatorios.ts';
import { programarRecordatorio, _olvidarRecordatorios, CANAL_RECORDATORIOS } from '../recordatorios.ts';
// Del servidor (lib/manos-app.ts), con import dinámico: el typecheck de la app (mobile/tsconfig, que
// incluye estas pruebas) no debe seguir hasta el código del servidor y sus dependencias (undici).
const { RE_LECTURA, turnoDeRecordatorio } = await import(new URL('../../../../lib/manos-app.ts', import.meta.url).href);
import { MANOS_APP } from '../../nucleo/contrato.ts';
import { AudioVoz } from '../audioVoz.ts';
import { OidoMesa, VigilanteOido, TOPE_REINICIOS_OIDO, ESPERA_SORDO_MS, ESPERA_SORDO_MAX_MS, duenoAudio, motivoFalloVoz } from '../duenoAudio.ts';
import { FIGURAS, mezclarFigura, estiloDe } from '../figura.ts';
import { emocionDeTexto } from '../../lib/emocion.ts';
import { emitir, escuchar } from '../../nucleo/contrato.ts';
import { MemoriaEtiquetas, etiquetasDe } from '../etiquetasVoz.ts';
import { ESTADOS_FRASE, EMOCION_DE_ESTADO, MemoriaFrases, fraseDeEstado, frasesDe, esRelleno, quitarRellenoInicial, estadoDeEspera, empiezaConMuletilla, tareaDe, TAREAS, SONIDOS_AMBIENTE, vozDeEspera } from '../frasesEstado.ts';
import { EXPRESIONES_AVATAR } from '../../avatar3d/tipos.ts';
import { EMOCIONES } from '../../lib/emocion.ts';
import { AVATARES } from '../../avatares/catalogo.ts';
import { textoCompa } from '../frases.ts';
import { createRequire } from 'node:module';
// El idioma y el avatar de ahora son datos de módulo: se fijan en la MISMA copia que leen frases.ts y
// animo.ts (tsx las carga como CommonJS; un import de ESM aquí sería otra copia).
const { fijarAvatar } = createRequire(import.meta.url)('../../avatares/actual.ts');
const { fijarIdioma } = createRequire(import.meta.url)('../../i18n.ts');
const { detectarIdioma } = await import(new URL('../../../../lib/idioma-detectar.ts', import.meta.url).href);

let fallos = 0;
let n = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── la sesión ───────────────────────────────────────────────────────────────────────────── */

prueba('sesión: abrir es una generación nueva; lo de una generación vieja no cuenta (M4)', () => {
  const c = new ControlSesion('aura', 'es');
  assert.equal(c.iniciar(), true);
  const g1 = c.vista().gen;
  assert.equal(c.vista().estado, 'conectando');
  c.alEstado(g1, 'escuchando');
  assert.equal(c.vista().estado, 'escuchando');
  // Reabrir rápido: terminar y volver a iniciar → otra generación.
  c.terminar();
  c.iniciar();
  const g2 = c.vista().gen;
  assert.ok(g2 > g1);
  // La sesión vieja avisa tarde que se cerró / que conectó: no toca la nueva.
  c.alEstado(g1, 'cerrada');
  c.alEstado(g1, 'escuchando');
  assert.equal(c.vista().montada, true);
  assert.equal(c.vista().estado, 'conectando');
  c.alEstado(g2, 'hablando');
  assert.equal(c.vista().estado, 'hablando');
});

prueba('sesión: cambiar avatar o idioma con la sesión abierta la reabre con la voz nueva', () => {
  const c = new ControlSesion('aura', 'es');
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  const g = c.vista().gen;
  c.perfil('ojos', 'es');
  assert.equal(c.vista().gen, g + 1);
  assert.equal(c.vista().avatar, 'ojos');
  assert.equal(c.vista().estado, 'conectando');
  c.perfil('ojos', 'en');
  assert.equal(c.vista().gen, g + 2);
  // Cerrada: solo se anota.
  c.terminar();
  c.perfil('claudio', 'en');
  assert.equal(c.vista().montada, false);
  assert.equal(c.vista().avatar, 'claudio');
});

prueba('sesión: un error reintenta una vez con generación nueva y después se rinde', () => {
  const c = new ControlSesion('aura', 'es');
  c.iniciar();
  const g = c.vista().gen;
  c.alEstado(g, 'error', 'red');
  assert.equal(c.vista().gen, g + 1);
  assert.equal(c.vista().intento, 1);
  assert.equal(c.vista().montada, true);
  c.alEstado(g + 1, 'error', 'red');
  assert.equal(c.vista().montada, false);
  assert.equal(c.vista().estado, 'error');
  // Iniciar después de un error abre de nuevo.
  assert.equal(c.iniciar(), true);
  assert.equal(c.vista().montada, true);
});

prueba('sesión (1-oct): las reconexiones por error tienen tope por conversación; conectar NO lo vuelve a cero', () => {
  const c = new ControlSesion('claudio', 'es');
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  const g0 = c.vista().gen;
  // ElevenLabs corta («Server error») una y otra vez, cada vez DESPUÉS de conectar (antes: infinito).
  for (let i = 1; i <= TOPE_RECONEXIONES; i++) {
    c.alEstado(c.vista().gen, 'error', 'Server error');
    assert.equal(c.vista().montada, true, `reconexión ${i}`);
    assert.equal(c.vista().gen, g0 + i);
    c.alEstado(c.vista().gen, 'escuchando');
    assert.equal(c.vista().intento, 0, 'el intento sí vuelve a 0 al conectar');
  }
  c.alEstado(c.vista().gen, 'error', 'Server error');
  assert.equal(c.vista().montada, false, 'pasado el tope falla limpio: el audio vuelve a la mesa');
  assert.equal(c.vista().estado, 'error');
  assert.equal(c.vista().gen, g0 + TOPE_RECONEXIONES, 'no abrió otra');
  // Una conversación nueva (la persona vuelve a abrir) empieza con el tope entero.
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  const g1 = c.vista().gen;
  c.alEstado(g1, 'error', 'Server error');
  assert.equal(c.vista().montada, true);
  assert.equal(c.vista().gen, g1 + 1);
  // Con `reconexiones: 0` no se reconecta nunca (y el reintento al abrir tampoco).
  const d = new ControlSesion('aura', 'es', { reconexiones: 0 });
  d.iniciar();
  d.alEstado(d.vista().gen, 'error', 'red');
  assert.equal(d.vista().montada, false);
});

prueba('sesión: el doble toque silencia sin cerrar y otro la despierta al instante', () => {
  const c = new ControlSesion('aura', 'es');
  assert.equal(c.despertarOSilenciar(), 'despierta'); // sin sesión: la abre
  const g = c.vista().gen;
  c.alEstado(g, 'escuchando');
  assert.equal(c.despertarOSilenciar(), 'duerme');
  assert.equal(c.vista().silenciada, true);
  assert.equal(c.vista().montada, true);
  assert.equal(c.vista().gen, g, 'silenciar no reabre');
  assert.equal(c.despertarOSilenciar(), 'despierta');
  assert.equal(c.vista().silenciada, false);
  assert.equal(c.vista().gen, g, 'despertar con la sesión abierta no reconecta');
});

prueba('sesión: silenciada mucho rato se cierra (dormida) y despertarla la reabre', () => {
  let t = 0;
  const c = new ControlSesion('aura', 'es', { reloj: () => t, silencioCierraMs: 1000 });
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  c.silenciar(true);
  t = 500;
  c.tic();
  assert.equal(c.vista().montada, true);
  t = 1200;
  c.tic();
  assert.equal(c.vista().montada, false);
  assert.equal(c.vista().dormida, true);
  const g = c.vista().gen;
  c.silenciar(false);
  assert.equal(c.vista().montada, true);
  assert.equal(c.vista().gen, g + 1);
  assert.equal(c.vista().dormida, false);
});

prueba('sesión: al pasar a segundo plano se cierra (M5) y no se reabre sola', () => {
  const c = new ControlSesion('aura', 'es');
  c.iniciar();
  c.alEstado(c.vista().gen, 'hablando');
  c.segundoPlano();
  assert.equal(c.vista().montada, false);
  assert.equal(c.vista().estado, 'cerrada');
});

/* ── llamadas ────────────────────────────────────────────────────────────────────────────── */

prueba('llamada: AURA se apaga (sesión, voz, oído, efectos) y al colgar vuelve como estaba', async () => {
  const c = new ControlSesion('aura', 'es');
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  c.silenciar(true);
  const reg = [];
  const off = coordinarLlamadas({
    escuchar: (tipo, f) => escuchar(tipo, f),
    sesion: c,
    suspenderVoz: (on) => reg.push(`voz:${on}`),
    suspenderOido: async (on) => reg.push(`oido:${on}`),
    suspenderSfx: (on) => reg.push(`sfx:${on}`),
  });
  const g = c.vista().gen;
  emitir('llamada', { activa: true, video: true });
  assert.equal(c.vista().montada, false);
  assert.equal(c.vista().suspendida, true);
  assert.deepEqual(reg, ['voz:true', 'sfx:true', 'oido:true']);
  // Durante la llamada nada la abre ni el doble toque la despierta.
  assert.equal(c.iniciar(), false);
  assert.equal(c.despertarOSilenciar(), 'nada');
  assert.equal(c.vista().montada, false);
  emitir('llamada', { activa: true, video: true }); // repetido: no hace nada
  emitir('llamada', { activa: false, video: true });
  await dormir(1);
  assert.equal(c.vista().suspendida, false);
  assert.equal(c.vista().montada, true, 'estaba abierta: se reabre');
  assert.ok(c.vista().gen > g);
  // iniciar() durante la llamada dejó anotado «abierta y despierta».
  assert.equal(c.vista().silenciada, false);
  assert.deepEqual(reg.slice(3), ['sfx:false', 'voz:false', 'oido:false']);
  off();
});

prueba('llamada: si estaba cerrada, al colgar sigue cerrada; si estaba silenciada, vuelve silenciada', () => {
  const c = new ControlSesion('aura', 'es');
  const off = coordinarLlamadas({ escuchar: (t, f) => escuchar(t, f), sesion: c, suspenderVoz() {}, suspenderOido() {}, suspenderSfx() {} });
  emitir('llamada', { activa: true, video: false });
  emitir('llamada', { activa: false, video: false });
  assert.equal(c.vista().montada, false);
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  c.silenciar(true);
  emitir('llamada', { activa: true, video: false });
  emitir('llamada', { activa: false, video: false });
  assert.equal(c.vista().montada, true);
  assert.equal(c.vista().silenciada, true);
  off();
});

prueba('llamada: si termina con la app DETRÁS, la conversación no se reabre (revisión 5, B4)', () => {
  // Lo que reproducía fondo.mts: la persona se va al inicio en plena llamada y el otro cuelga.
  const c = new ControlSesion('aura', 'es');
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  let delante = true;
  const off = coordinarLlamadas({ escuchar: (t, f) => escuchar(t, f), sesion: c, enPrimerPlano: () => delante, suspenderVoz() {}, suspenderOido() {}, suspenderSfx() {} });
  emitir('llamada', { activa: true, video: false });
  delante = false;
  c.segundoPlano(); // en llamada no hace nada: la llamada manda
  emitir('llamada', { activa: false, video: false });
  assert.equal(c.vista().montada, false, 'ElevenLabs no se remonta en segundo plano');
  assert.equal(c.vista().suspendida, false);
  assert.equal(c.vista().estado, 'cerrada');
  // Al volver no se abre sola (como segundoPlano): la persona la despierta cuando quiera.
  delante = true;
  assert.equal(c.vista().montada, false);
  assert.equal(c.iniciar(), true);
  assert.equal(c.vista().montada, true);
  off();
});

prueba('silencio: el hecho dice lo que de verdad pasó (revisión 5, B12)', () => {
  const c = new ControlSesion('aura', 'es');
  assert.equal(c.aplicarSilencio(true).ok, false, 'sin conversación no hay qué silenciar');
  assert.match(c.aplicarSilencio(true).detalle, /No hay conversación/);
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  assert.deepEqual(c.aplicarSilencio(false), { ok: false, detalle: 'Ya estaba escuchando.' });
  assert.deepEqual(c.aplicarSilencio(true), { ok: true });
  assert.equal(c.vista().silenciada, true);
  assert.equal(c.aplicarSilencio(true).ok, false, 'ya estaba en silencio');
  assert.deepEqual(c.aplicarSilencio(false), { ok: true });
  assert.equal(c.vista().silenciada, false);
  c.terminar();
  assert.deepEqual(c.aplicarSilencio(false), { ok: true }, 'despertar sin sesión la abre');
  assert.equal(c.vista().montada, true);
  c.llamada(true);
  assert.equal(c.aplicarSilencio(false).ok, false, 'en llamada no vuelve');
  assert.equal(c.aplicarSilencio(true).ok, false, 'en llamada ya está apagada');
});

prueba('audio de la voz: libre al soltar de verdad; el cierre sin aviso se suelta al tope (revisión 5, B3)', () => {
  const avisos = [];
  const relojes = [];
  const a = new AudioVoz((l) => avisos.push(l), (f, ms) => {
    const r = { f, ms, vivo: true };
    relojes.push(r);
    return () => (r.vivo = false);
  });
  assert.equal(a.libre(), true);
  a.tomar(1);
  assert.deepEqual(avisos, [false]);
  // Se reabre (otra generación) antes de que la vieja termine de soltar: sigue ocupada.
  a.cerrando(1);
  a.tomar(2);
  a.soltar(1);
  assert.equal(a.libre(), false);
  assert.deepEqual(avisos, [false], 'no avisa libre mientras otra generación tiene el audio');
  assert.equal(relojes[0].vivo, false, 'el tope de la 1 se cancela al soltar');
  a.cerrando(2);
  assert.equal(relojes[1].ms, 4000);
  relojes[1].f(); // la 2 nunca avisó onDisconnect: se da por suelta al tope
  assert.equal(a.libre(), true);
  assert.deepEqual(avisos, [false, true]);
  a.soltar(2); // el onDisconnect tardío no avisa dos veces
  assert.deepEqual(avisos, [false, true]);
});

prueba('audio de la voz: esperarLibre resuelve al soltar de verdad o al tope (la mesa reabre su oído después, 1-oct)', async () => {
  const relojes = [];
  const a = new AudioVoz(() => {}, (f, ms) => {
    const r = { f, ms, vivo: true };
    relojes.push(r);
    return () => (r.vivo = false);
  });
  let listo = false;
  await a.esperarLibre();
  a.tomar(1);
  const p = a.esperarLibre().then(() => (listo = true));
  await dormir(1);
  assert.equal(listo, false, 'mientras la conversación tiene el audio, espera');
  a.soltar(1); // onDisconnect: el SDK ya paró su sesión de audio
  await p;
  assert.equal(relojes.at(-1).vivo, false, 'el tope de la espera se cancela');
  // Nadie avisa: al tope sigue igual.
  a.tomar(2);
  let listo2 = false;
  const p2 = a.esperarLibre(4000).then(() => (listo2 = true));
  await dormir(1);
  assert.equal(listo2, false);
  assert.equal(relojes.at(-1).ms, 4000);
  relojes.at(-1).f();
  await p2;
  assert.equal(a.libre(), false, 'el tope solo suelta la espera, no el audio');
});

/* ── generaciones contra un proveedor con candado (como el ConversationProvider del SDK) ─────── */

prueba('generaciones: con key={gen} un arranque pendiente no bloquea al siguiente', async () => {
  // Un «proveedor» igual al del SDK: mientras conecta guarda un candado y descarta otro startSession.
  class ProveedorFalso {
    lock = null;
    abiertas = 0;
    start(ms) {
      if (this.lock) return false;
      this.lock = dormir(ms).then(() => {
        this.lock = null;
        this.abiertas += 1;
      });
      return true;
    }
  }
  // Mismo proveedor reutilizado (lo de antes): el segundo arranque se pierde.
  const viejo = new ProveedorFalso();
  assert.equal(viejo.start(30), true);
  assert.equal(viejo.start(30), false, 'el SDK descarta en silencio');
  // Con generaciones: cada gen monta un proveedor nuevo.
  const c = new ControlSesion('aura', 'es');
  const montados = new Map();
  const montar = () => {
    const v = c.vista();
    if (v.montada && !montados.has(v.gen)) {
      const p = new ProveedorFalso();
      montados.set(v.gen, p);
      p.start(30);
    }
  };
  c.suscribir(montar);
  c.iniciar();
  c.perfil('ojos', 'es'); // reabrir antes de que conecte la primera
  await dormir(50);
  const ultimo = montados.get(c.vista().gen);
  assert.equal(ultimo.abiertas, 1, 'la generación vigente conectó');
  assert.equal(montados.size, 2);
});

/* ── permiso precalentado ────────────────────────────────────────────────────────────────── */

prueba('permiso: precalentado se usa una sola vez; vencido o de otro avatar se pide otro', async () => {
  let t = 0;
  let pedidos = 0;
  const p = new Precalentador(async (a, i) => ({ token: `tk${++pedidos}-${a}-${i}`, pase: 'p' }), 1000, () => t);
  await p.precalentar('aura', 'es');
  assert.equal(pedidos, 1);
  assert.equal(p.listo('aura', 'es'), true);
  const a = await p.tomar('aura', 'es');
  assert.equal(a.token, 'tk1-aura-es');
  assert.equal(p.listo('aura', 'es'), false, 'se gastó');
  const b = await p.tomar('aura', 'es');
  assert.equal(b.token, 'tk2-aura-es');
  await p.precalentar('aura', 'es');
  t = 2000;
  assert.equal(p.listo('aura', 'es'), false, 'vencido');
  await p.precalentar('ojos', 'en');
  assert.equal(p.listo('aura', 'es'), false);
  const c = await p.tomar('ojos', 'en');
  assert.match(c.token, /ojos-en/);
  // Dos pedidos a la vez comparten la misma petición.
  const antes = pedidos;
  await Promise.all([p.precalentar('claudio', 'es'), p.precalentar('claudio', 'es')]);
  assert.equal(pedidos, antes + 1);
  // «nuevo» (reintento) salta el guardado.
  const d = await p.tomar('claudio', 'es', true);
  assert.equal(d.token, `tk${antes + 2}-claudio-es`);
});

/* ── el ánimo ────────────────────────────────────────────────────────────────────────────── */

const tipos = (ef) => ef.map((e) => e.tipo);
const vozAbierta = { estado: 'escuchando', silenciada: false, dormida: false, suspendida: false };

prueba('ánimo: un toque le gusta; muchos seguidos la enojan y se le pasa sola', () => {
  let a = ANIMO_INICIAL;
  let r = reducir(a, { tipo: 'toque' }, 0, () => 0.1);
  a = r.animo;
  assert.equal(expresion(a, 10), 'contenta');
  assert.ok(tipos(r.efectos).includes('haptica') && tipos(r.efectos).includes('brinco'));
  assert.ok(tipos(r.efectos).includes('sonido'), 'risita sin conversación');
  r = reducir(a, { tipo: 'molestar' }, 100);
  a = r.animo;
  r = reducir(a, { tipo: 'molestar' }, 200);
  a = r.animo;
  assert.equal(expresion(a, 250), 'enojada');
  assert.ok(tipos(r.efectos).includes('sacudir'));
  assert.ok(r.efectos.some((e) => e.tipo === 'globo' && /oye|ya|marear|duele|hey|okay|dizzy|hurts/i.test(e.texto)));
  for (let t = 300; t < 6000; t += 500) a = reducir(a, { tipo: 'tic' }, t).animo;
  assert.equal(expresion(a, 6000), 'tranquila');
  assert.equal(a.irritacion, 0);
});

prueba('ánimo: con la conversación abierta no hace ruidos (el micrófono los oiría)', () => {
  const a = reducir(ANIMO_INICIAL, { tipo: 'voz', voz: vozAbierta }, 0).animo;
  const r = reducir(a, { tipo: 'toque' }, 10, () => 0);
  assert.ok(!tipos(r.efectos).includes('sonido'));
  const r2 = reducir(a, { tipo: 'caricia' }, 10);
  assert.ok(!tipos(r2.efectos).includes('sonido'));
  assert.equal(expresion(r2.animo, 20), 'encantada');
});

prueba('ánimo: doble toque con la sesión abierta la silencia; fuera de una llamada dice cómo llamarla (y nunca «te escucho» sin que nadie escuche)', () => {
  let a = reducir(ANIMO_INICIAL, { tipo: 'voz', voz: vozAbierta }, 0).animo;
  let r = reducir(a, { tipo: 'dobleToque' }, 10);
  assert.ok(tipos(r.efectos).includes('alternarVoz'));
  assert.ok(r.efectos.some((e) => e.tipo === 'globo' && /zzz/i.test(e.texto)));
  a = reducir(r.animo, { tipo: 'voz', voz: { ...vozAbierta, silenciada: true } }, 20).animo;
  assert.equal(expresion(a, 30), 'dormida');
  assert.equal(puedeCaminar(a, 30), false);
  // Sin llamada (la llamada del avatar se pide con «llámame»): no hay nada que despertar con dos toques.
  r = reducir(a, { tipo: 'dobleToque' }, 40);
  assert.ok(!tipos(r.efectos).includes('alternarVoz'));
  assert.ok(r.efectos.some((e) => e.tipo === 'globo' && /llámame/.test(e.texto)), 'reacciona al toque y dice cómo llamarla');
  // Al tocarla nadie escucha todavía: el globito no puede decir «te escucho» (José: «me dice
  // "estoy escuchando" pero nunca me escuchó»). Lo dice cuando la voz de verdad escucha.
  assert.ok(!r.efectos.some((e) => e.tipo === 'globo' && /escucho|listening|oídos|ears/i.test(e.texto)), JSON.stringify(r.efectos));
  const oye = reducir(r.animo, { tipo: 'voz', voz: vozAbierta }, 60);
  assert.ok(oye.efectos.some((e) => e.tipo === 'globo'), '«te escucho» cuando la voz escucha');
});

prueba('ánimo: con la mesa tapada, pone cara de escuchar solo si el oído del teléfono escucha de verdad', () => {
  let a = ANIMO_INICIAL;
  assert.equal(expresion(a, 0), 'tranquila', 'sin motor oyendo, nada de «escucha»');
  a = reducir(a, { tipo: 'oido', escuchando: true }, 10).animo;
  assert.equal(expresion(a, 20), 'escucha');
  a = reducir(a, { tipo: 'oido', escuchando: false }, 30).animo;
  assert.equal(expresion(a, 40), 'tranquila', 'el reconocedor se cayó: deja de «escuchar»');
  // Con la conversación silenciada (doble toque) duerme aunque el teléfono oyera.
  a = reducir(a, { tipo: 'oido', escuchando: true }, 50).animo;
  a = reducir(a, { tipo: 'voz', voz: { ...vozAbierta, silenciada: true } }, 60).animo;
  assert.equal(expresion(a, 70), 'dormida');
});

prueba('ánimo: le hablan encima → «¡uy!» y «¡Ah, perdón! Dime, te escucho…»', () => {
  const a = reducir(ANIMO_INICIAL, { tipo: 'voz', voz: { ...vozAbierta, estado: 'hablando' } }, 0).animo;
  const r = reducir(a, { tipo: 'interrupcion' }, 10);
  assert.equal(expresion(r.animo, 20), 'uy');
  assert.ok(r.efectos.some((e) => e.tipo === 'globo' && /perdón|sorry/i.test(e.texto)));
});

prueba('ánimo: habla con la emoción del turno', () => {
  let a = reducir(ANIMO_INICIAL, { tipo: 'voz', voz: { ...vozAbierta, estado: 'hablando' } }, 0).animo;
  a = reducir(a, { tipo: 'dijo', texto: '¡Qué bien, felicidades!', emocion: 'feliz', mostrar: true }, 10).animo;
  assert.equal(expresion(a, 20), 'contenta');
  a = reducir(a, { tipo: 'dijo', texto: 'Lo siento mucho', emocion: 'triste', mostrar: false }, 30).animo;
  assert.equal(expresion(a, 40), 'triste');
  a = reducir(a, { tipo: 'voz', voz: vozAbierta }, 50).animo;
  assert.equal(expresion(a, 60), 'escucha');
  const m = reducir(ANIMO_INICIAL, { tipo: 'mesa', hablando: false, pensando: true, emocion: 'neutral' }, 0).animo;
  assert.equal(expresion(m, 1), 'piensa');
});

prueba('ánimo: un envío da UNA palomita y «¡Listo!» aunque lleguen hecho y enviado', () => {
  let r = reducir(ANIMO_INICIAL, { tipo: 'hecho', ok: true, accion: { tipo: 'enviar', para: 'Mamá' } }, 1000);
  assert.ok(tipos(r.efectos).includes('palomita'));
  assert.ok(r.efectos.some((e) => e.tipo === 'confirmar' && e.ok));
  r = reducir(r.animo, { tipo: 'enviado', para: 'Mamá' }, 1200);
  assert.ok(!tipos(r.efectos).includes('palomita'));
  const mal = reducir(ANIMO_INICIAL, { tipo: 'hecho', ok: false, accion: { tipo: 'enviar' } }, 0);
  assert.ok(mal.efectos.some((e) => e.tipo === 'confirmar' && !e.ok));
  assert.equal(expresion(mal.animo, 10), 'triste');
});

prueba('ánimo: un mensaje escrito a mano pone la palomita pero AURA no dice «¡Listo!» (revisión 5, B5)', () => {
  const r = reducir(ANIMO_INICIAL, { tipo: 'enviado', para: 'beto@x.com', nombre: 'Beto Pérez' }, 1000);
  assert.ok(tipos(r.efectos).includes('palomita'));
  assert.ok(!tipos(r.efectos).includes('confirmar'), 'enviado solo: muda');
  assert.ok(r.efectos.some((e) => e.tipo === 'globo' && /Beto Pérez/.test(e.texto)), 'el globo lleva el nombre, no el correo');
  // Por voz: primero `enviado` (lo avisa el chat) y luego el `hecho` de enviar → UN «¡Listo!», sin otra palomita.
  const h = reducir(r.animo, { tipo: 'hecho', ok: true, accion: { tipo: 'enviar' } }, 1100);
  assert.ok(!tipos(h.efectos).includes('palomita'));
  assert.equal(h.efectos.filter((e) => e.tipo === 'confirmar' && e.ok).length, 1);
  // El mismo envío avisado dos veces (el hecho repetido de un doble «envíalo»): no lo dice dos veces.
  const h2 = reducir(h.animo, { tipo: 'hecho', ok: true, accion: { tipo: 'enviar' } }, 1300);
  assert.ok(!tipos(h2.efectos).includes('confirmar'));
});

prueba('ánimo: lo que no pudo hacer lo dice con el motivo (y el agente se entera) (revisión 5, B6)', () => {
  const r = reducir(ANIMO_INICIAL, { tipo: 'hecho', ok: false, accion: { tipo: 'redactar', para: 'Zacarías', texto: 'hola' }, detalle: 'No encuentro a «Zacarías» entre tus contactos.' }, 0);
  const c = r.efectos.find((e) => e.tipo === 'confirmar');
  assert.ok(c && c.ok === false && /Zacarías/.test(c.texto), JSON.stringify(r.efectos));
  const e = reducir(ANIMO_INICIAL, { tipo: 'hecho', ok: false, accion: { tipo: 'enviar' }, detalle: 'Hace falta que esa persona te acepte para escribirle.' }, 0);
  assert.ok(e.efectos.some((x) => x.tipo === 'confirmar' && !x.ok && /acepte/.test(x.texto)));
  const s = reducir(ANIMO_INICIAL, { tipo: 'hecho', ok: false, accion: { tipo: 'silencio', valor: true }, detalle: 'Ya estaba en silencio.' }, 0);
  assert.equal(s.efectos.length, 0, 'el silencio no se comenta');
});

prueba('ánimo: montada con la llamada ya en curso, se esconde al ver la voz suspendida (revisión 5, 13)', () => {
  const r = reducir(ANIMO_INICIAL, { tipo: 'voz', voz: { estado: 'cerrada', silenciada: false, dormida: false, suspendida: true } }, 0);
  assert.ok(tipos(r.efectos).includes('desaparecer'));
  assert.equal(r.animo.oculta, true);
  // El aviso `llamada` que llega después no la hace desaparecer dos veces; al colgar vuelve.
  assert.equal(reducir(r.animo, { tipo: 'llamada', activa: true }, 5).efectos.length, 0);
  assert.ok(tipos(reducir(r.animo, { tipo: 'llamada', activa: false }, 10).efectos).includes('aparecer'));
});

prueba('ánimo: en la llamada se va y al colgar vuelve contenta; levantarla y soltarla', () => {
  let r = reducir(ANIMO_INICIAL, { tipo: 'llamada', activa: true }, 0);
  assert.ok(tipos(r.efectos).includes('desaparecer'));
  assert.equal(reducir(r.animo, { tipo: 'toque' }, 5).efectos.length, 0, 'oculta no reacciona');
  r = reducir(r.animo, { tipo: 'llamada', activa: false }, 10);
  assert.ok(tipos(r.efectos).includes('aparecer'));
  assert.equal(expresion(r.animo, 20), 'contenta');
  r = reducir(ANIMO_INICIAL, { tipo: 'levantar' }, 0);
  assert.equal(expresion(r.animo, 1), 'levantada');
  assert.equal(puedeCaminar(r.animo, 1), false);
  r = reducir(r.animo, { tipo: 'soltar' }, 5, () => 0);
  assert.equal(expresion(r.animo, 6), 'contenta');
});

prueba('ánimo: pasea libre o escuchando en silencio; no mientras habla, piensa o conecta', () => {
  assert.equal(puedeCaminar(ANIMO_INICIAL, 0), true);
  const esc = reducir(ANIMO_INICIAL, { tipo: 'voz', voz: vozAbierta }, 0).animo;
  assert.equal(puedeCaminar(esc, 0), true);
  const habla = reducir(ANIMO_INICIAL, { tipo: 'voz', voz: { ...vozAbierta, estado: 'hablando' } }, 0).animo;
  assert.equal(puedeCaminar(habla, 0), false);
  const con = reducir(ANIMO_INICIAL, { tipo: 'voz', voz: { ...vozAbierta, estado: 'conectando' } }, 0).animo;
  assert.equal(puedeCaminar(con, 0), false);
});

/* ── los gestos ──────────────────────────────────────────────────────────────────────────── */

const gs = (sal) => sal.map((s) => s.gesto);

prueba('gestos: toque (esperando al posible doble), doble toque y «molestar»', () => {
  const g = new Gestos({ radio: 30 });
  assert.deepEqual(gs([...g.bajar(0, 50, 50), ...g.subir(80, 50, 50)]), []);
  assert.deepEqual(gs(g.vencer(200)), []);
  assert.deepEqual(gs(g.vencer(400)), ['toque']);
  const d = new Gestos({ radio: 30 });
  d.bajar(0, 50, 50);
  d.subir(60, 50, 50);
  d.bajar(150, 50, 50);
  d.subir(200, 50, 50);
  assert.deepEqual(gs(d.vencer(600)), ['dobleToque']);
  const m = new Gestos({ radio: 30 });
  const sal = [];
  for (let i = 0; i < 3; i++) {
    sal.push(...m.bajar(i * 150, 50, 50), ...m.subir(i * 150 + 50, 50, 50));
  }
  assert.deepEqual(gs(sal), ['molestar']);
  assert.deepEqual(gs(m.vencer(2000)), []);
});

prueba('gestos: mantener la levanta, el dedo la lleva y al soltar sale la velocidad', () => {
  const g = new Gestos({ radio: 30 });
  g.bajar(0, 50, 50);
  assert.equal(g.proximo(), 450);
  assert.deepEqual(gs(g.vencer(460)), ['levantar']);
  assert.deepEqual(gs(g.mover(480, 70, 50)), ['moverArrastre']);
  g.mover(500, 110, 50);
  const s = g.subir(510, 110, 50);
  assert.deepEqual(gs(s), ['soltar']);
  assert.ok(s[0].vx > 500, 'lanzada a la derecha');
});

prueba('gestos: ir y venir encima es caricia; alejarse la arrastra', () => {
  const g = new Gestos({ radio: 30 });
  g.bajar(0, 50, 50);
  const sal = [];
  let t = 0;
  for (let i = 0; i < 12; i++) sal.push(...g.mover((t += 30), 50 + (i % 2 ? 14 : -14), 50));
  assert.ok(gs(sal).includes('caricia'));
  assert.ok(!gs(sal).includes('arrastrar'));
  g.subir((t += 20), 50, 50);
  const h = new Gestos({ radio: 30 });
  h.bajar(0, 50, 50);
  assert.deepEqual(gs(h.mover(40, 100, 50)), ['arrastrar', 'moverArrastre']);
});

/* ── bordes ──────────────────────────────────────────────────────────────────────────────── */

prueba('bordes: se pega al borde más cercano, sube con el teclado y el globo no se sale', () => {
  const m = { ancho: 400, alto: 800, lado: 100, margen: 4, suelo: 90, techo: 28 };
  assert.equal(yCarril(m), 800 - 90 - 100 - 4);
  assert.equal(pegarABorde(m, 10, 400).borde, 'izquierda');
  assert.equal(pegarABorde(m, 290, 380).borde, 'derecha');
  assert.equal(pegarABorde(m, 150, 40).borde, 'arriba');
  const abajo = pegarABorde(m, 150, 600);
  assert.equal(abajo.borde, 'abajo');
  assert.equal(abajo.y, yCarril(m));
  // Lanzada hacia arriba desde abajo: la velocidad cuenta.
  assert.equal(pegarABorde(m, 150, 560, 0, -3000).borde, 'arriba');
  const conTeclado = { ...m, suelo: 90 + 300 };
  const p = reubicar(conTeclado, abajo);
  assert.equal(p.y, yCarril(conTeclado));
  assert.ok(p.y + 100 <= 800 - 390, 'no tapa la barra ni el teclado');
  const l = limitar(m, -50, 9999);
  assert.deepEqual(l, { x: 4, y: yCarril(m) });
  const d = destinoPaseo(m, 100, () => 0.9);
  assert.ok(Math.abs(d - 100) >= 60);
  const gl = lugarGlobo(m, { x: 0, y: 30 }, 200, 40);
  assert.equal(gl.abajo, true);
  assert.ok(gl.x >= 4);
});

/* ── SSE y el puente de acciones ─────────────────────────────────────────────────────────── */

prueba('SSE: bloques partidos a la mitad, comentarios y CRLF', () => {
  const l = new LectorSse();
  let t = ': ping\n\nid: 1\ndata: {"a":';
  assert.deepEqual(l.leer(t), []);
  t += '1}\n\nevent: accion\r\ndata: {"b":2}\r\n\r\ndata: x';
  const ev = l.leer(t);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].id, '1');
  assert.equal(ev[0].datos, '{"a":1}');
  assert.equal(ev[1].evento, 'accion');
  assert.deepEqual(l.leer(t), []);
});

prueba('acciones: validación, las del turno y sin repetir por id', () => {
  assert.equal(esAccionApp({ tipo: 'atras' }), true);
  assert.equal(esAccionApp({ tipo: 'abrir', pantalla: 'ajustes' }), true);
  assert.equal(esAccionApp({ tipo: 'abrir', pantalla: 'cocina' }), false);
  assert.equal(esAccionApp({ tipo: 'redactar', para: 'Mamá', texto: '' }), false);
  assert.equal(esAccionApp({ tipo: 'volar' }), false);
  const l = accionesDelTurno({ acciones: [{ id: 'x-1', accion: { tipo: 'atras' } }, { tipo: 'silencio', valor: true }, { tipo: 'nada' }, { id: 'x-1', accion: { tipo: 'atras' } }] });
  assert.deepEqual(l, [{ tipo: 'atras' }, { tipo: 'silencio', valor: true }]);
  assert.equal(accionNueva('x-1'), false, 'si luego llega por el SSE, no se repite');
  assert.deepEqual(accionesDelTurno({ reply: 'hola' }), []);
});

prueba('acciones: el formato nuevo {id, accion} y el viejo sin id no se hacen dos veces (revisión 5, C1)', () => {
  const t0 = 1_000_000;
  // 1) Llega por el SSE con id y el done del turno la trae pelada (servidor viejo): una sola vez.
  const env1 = { tipo: 'redactar', para: 'Beto', texto: 'uno' };
  assert.equal(accionNueva('sse-1', env1, t0), true);
  assert.deepEqual(accionesDelTurno({ acciones: [{ ...env1 }] }, t0 + 300), [], 'pelada tras el SSE: repetida');
  // 2) Al revés: el done (sin id) primero y el SSE (con id) después, dentro de 5 s; y ese id otra vez.
  const env2 = { tipo: 'redactar', para: 'Beto', texto: 'dos' };
  assert.equal(accionesDelTurno({ acciones: [env2] }, t0).length, 1);
  assert.equal(accionNueva('sse-2', env2, t0 + 4000), false, 'el SSE que llega después: repetido');
  assert.equal(accionNueva('sse-2', env2, t0 + 60_000), false, 'y ese id ya queda anotado');
  // 3) El formato nuevo: el done trae {id, accion} con el MISMO id del SSE.
  const env3 = { tipo: 'redactar', para: 'Beto', texto: 'tres' };
  assert.equal(accionNueva('sse-3', env3, t0), true);
  assert.deepEqual(accionesDelTurno({ acciones: [{ id: 'sse-3', accion: env3 }] }, t0 + 100), []);
  // 4) Sin id por los dos lados: una sola vez (antes el id vacío siempre era «nueva»).
  const env4 = { tipo: 'redactar', para: 'Beto', texto: 'cuatro' };
  assert.equal(accionNueva('', env4, t0), true);
  assert.equal(accionNueva('', { texto: 'cuatro', para: 'Beto ', tipo: 'redactar' }, t0 + 10), false, 'mismo contenido en otro orden: repetida');
  assert.equal(accionNueva(null, env4, t0 + VENTANA_MISMA_ACCION_MS + 1), true, 'pasados 5 s es otra');
  // 5) Dos iguales con ids DISTINTOS son dos (la persona lo pidió dos veces y el servidor lo distinguió).
  const env5 = { tipo: 'redactar', para: 'Beto', texto: 'cinco' };
  assert.equal(accionNueva('a-5', env5, t0), true);
  assert.equal(accionNueva('b-5', env5, t0 + 10), true);
});

prueba('puente + turno: el «enviar» del SSE y el del done no salen dos veces (doble.mts)', async () => {
  const ejecutadas = [];
  let xhr;
  const puente = new PuenteAcciones({
    base: 'http://x',
    token: async () => 't',
    cabeceras: async () => ({ 'x-aura-aparato': 'tel-1' }),
    xhr: () =>
      (xhr = {
        responseText: '',
        status: 200,
        readyState: 1,
        cab: {},
        onprogress: null,
        onreadystatechange: null,
        onerror: null,
        open() {},
        setRequestHeader(k, v) {
          this.cab[k] = v;
        },
        send() {},
        abort() {},
      }),
    alAccion: (a, id) => ejecutadas.push({ via: 'sse', a, id }),
    esperar: () => () => {},
  });
  puente.arrancar();
  await dormir(10);
  assert.equal(xhr.cab['x-aura-aparato'], 'tel-1', 'el SSE dice qué aparato escucha');
  const accion = { tipo: 'enviar', para: 'doble-mts' };
  xhr.responseText = 'id: Ab12Cd\ndata: ' + JSON.stringify({ id: 'Ab12Cd', accion }) + '\n\n';
  xhr.readyState = 3;
  xhr.onprogress();
  for (const a of accionesDelTurno({ reply: 'Listo, enviado', acciones: [accion] })) ejecutadas.push({ via: 'turno', a });
  // Y un SSE sin id con la misma acción otra vez (el id vacío no es «nueva» sin más).
  xhr.responseText += 'data: ' + JSON.stringify({ accion }) + '\n\n';
  xhr.onprogress();
  puente.parar();
  assert.equal(ejecutadas.length, 1, JSON.stringify(ejecutadas));
});

/* ── el sonido de fondo de la conversación (tecleo, papel, lápiz) ─────────────────────────── */

/** Un XHR falso para el puente: `llega(texto)` le suma texto al cuerpo como lo haría el SSE. */
function puenteConXhr(d) {
  let xhr;
  const puente = new PuenteAcciones({
    base: 'http://x',
    token: async () => 't',
    xhr: () =>
      (xhr = {
        responseText: '',
        status: 200,
        readyState: 1,
        cab: {},
        onprogress: null,
        onreadystatechange: null,
        onerror: null,
        open() {},
        setRequestHeader(k, v) {
          this.cab[k] = v;
        },
        send() {},
        abort() {},
      }),
    esperar: () => () => {},
    ...d,
  });
  return {
    puente,
    llega(t) {
      xhr.responseText += t;
      xhr.readyState = 3;
      xhr.onprogress();
    },
    xhr: () => xhr,
  };
}

/** Un reloj y un temporizador a mano para el controlador del sonido. */
function relojFalso() {
  let ahora = 0;
  const pendientes = [];
  return {
    reloj: () => ahora,
    esperar: (f, ms) => {
      const p = { f, en: ahora + ms, vivo: true };
      pendientes.push(p);
      return () => (p.vivo = false);
    },
    avanzar(ms) {
      ahora += ms;
      for (const p of pendientes) if (p.vivo && p.en <= ahora) {
        p.vivo = false;
        p.f();
      }
    },
  };
}

prueba('ambiente: `event: ambiente` llega por el canal de acciones, no es una acción ni mueve el Last-Event-ID', async () => {
  const acciones = [];
  const ambientes = [];
  const c = puenteConXhr({ alAccion: (a) => acciones.push(a), alAmbiente: (a) => ambientes.push(a) });
  c.puente.arrancar();
  await dormir(10);
  c.llega('id: acc-1\ndata: ' + JSON.stringify({ id: 'acc-1', accion: { tipo: 'atras' } }) + '\n\n');
  c.llega('event: ambiente\ndata: {"sonido":"teclado","on":true}\n\n');
  c.llega('event: ambiente\ndata: {"sonido":"papel","on":true}\n\n');
  c.llega('event: ambiente\ndata: {"sonido":"tambor","on":true}\n\n');
  c.llega('event: ambiente\ndata: {"sonido":null,"on":false}\n\n');
  c.llega('event: ambiente\ndata: no-es-json\n\n');
  assert.deepEqual(acciones, [{ tipo: 'atras' }], 'el ambiente no es una acción');
  assert.deepEqual(ambientes, [
    { sonido: 'teclado', on: true },
    { sonido: 'papel', on: true },
    { sonido: null, on: false },
    { sonido: null, on: false },
  ], 'un sonido que no conozco es «sin sonido»');
  // Al reconectar pide lo que vino después de la última ACCIÓN (el ambiente no lleva id).
  c.puente.parar();
  c.puente.arrancar();
  await dormir(10);
  assert.equal(c.xhr().cab['Last-Event-ID'], 'acc-1');
  c.puente.parar();
  // Un puente sin `alAmbiente` (una pieza vieja) lo salta sin romperse.
  const viejo = puenteConXhr({ alAccion: (a) => acciones.push(a) });
  viejo.puente.arrancar();
  await dormir(10);
  viejo.llega('event: ambiente\ndata: {"sonido":"teclado","on":true}\n\n');
  viejo.puente.parar();
  assert.equal(acciones.length, 1);
  assert.equal(ambienteDe({ on: true, sonido: 'lapiz' }).sonido, 'lapiz');
  assert.equal(ambienteDe({ sonido: 'lapiz' }), null);
  // Los mismos nombres en el servidor, el contrato y el banco de tareas.
  const { SONIDOS_AMBIENTE: delServidor } = await import(new URL('../../../../lib/acciones-app.ts', import.meta.url).href);
  assert.deepEqual([...delServidor], [...SONIDOS_AMBIENTE]);
  for (const t of Object.values(TAREAS)) assert.ok(t.sonido === null || SONIDOS_AMBIENTE.includes(t.sonido));
});

prueba('ambiente: suena al llegar, sigue con las frases de espera y se para cuando el avatar empieza a contestar', async () => {
  const r = relojFalso();
  const log = [];
  let puede = true;
  const amb = new AmbienteConversacion({
    reproductor: { poner: (s) => log.push(`poner ${s}`), quitar: () => log.push('quitar') },
    puede: () => puede,
    reloj: r.reloj,
    esperar: r.esperar,
  });
  const c = puenteConXhr({ alAccion: () => {}, alAmbiente: (a) => amb.alEvento(a) });
  c.puente.arrancar();
  await dormir(10);
  c.llega('event: ambiente\ndata: {"sonido":"teclado","on":true}\n\n');
  assert.equal(amb.actual, 'teclado');
  assert.deepEqual(log, ['poner teclado']);
  // La frase que lo acompaña, la del agente y una de seguimiento: no lo paran.
  amb.alHablaAvatar('Te lo busco en tus chats.');
  r.avanzar(GRACIA_MS + 100);
  amb.alHablaAvatar('[curious] Déjame buscarlo…');
  amb.alHablaAvatar('Mmm… a ver.');
  amb.alHablaAvatar(frasesDe('seguimiento', 'claudio', 'es')[0]);
  assert.equal(amb.actual, 'teclado', 'las frases de espera no cuentan como respuesta');
  // Otra ronda (ahora lee la página): cambia el sonido.
  c.llega('event: ambiente\ndata: {"sonido":"papel","on":true}\n\n');
  assert.deepEqual(log, ['poner teclado', 'poner papel']);
  // La respuesta de verdad: se para aunque el `off` del servidor no haya llegado.
  r.avanzar(GRACIA_MS + 100);
  amb.alHablaAvatar('El cobre está a cuatro dólares la libra.');
  assert.equal(amb.actual, null);
  assert.deepEqual(log, ['poner teclado', 'poner papel', 'quitar']);
  // El `off` que llega después no hace nada más.
  c.llega('event: ambiente\ndata: {"sonido":null,"on":false}\n\n');
  assert.deepEqual(log.slice(3), []);
  // Off del servidor, la persona que habla, el tope: siempre se para.
  amb.alEvento({ sonido: 'lapiz', on: true });
  amb.alEvento({ sonido: null, on: false });
  amb.alEvento({ sonido: 'lapiz', on: true });
  amb.parar('persona');
  amb.alEvento({ sonido: 'teclado', on: true });
  r.avanzar(AMBIENTE_MAX_MS + 1);
  assert.equal(amb.actual, null, 'un off perdido no deja tecleando para siempre');
  assert.deepEqual(log.slice(3), ['poner lapiz', 'quitar', 'poner lapiz', 'quitar', 'poner teclado', 'quitar']);
  // Silenciada, cerrada, la app detrás o los sonidos apagados: no suena.
  puede = false;
  amb.alEvento({ sonido: 'teclado', on: true });
  assert.equal(amb.actual, null);
  assert.ok(VOLUMEN_AMBIENTE > 0 && VOLUMEN_AMBIENTE <= 0.25, 'bajito, por debajo de la voz');
  c.puente.parar();
});

prueba('frases de estado: tareas → estado y sonido; muchas por avatar para esperar; sin muletilla tras el relleno; etiquetas v4 solo en la voz', () => {
  assert.deepEqual([tareaDe('web').estado, tareaDe('web').sonido, tareaDe('web').lenta], ['buscando', 'teclado', true]);
  assert.deepEqual([tareaDe('leer').estado, tareaDe('leer').sonido], ['leyendo', 'papel']);
  assert.deepEqual([tareaDe('pdf-leer').estado, tareaDe('pdf-leer').sonido], ['leyendo', 'papel']);
  assert.deepEqual([tareaDe('calculo-mina').estado, tareaDe('calculo-mina').sonido, tareaDe('calculo-mina').lenta], ['calculando', 'lapiz', false]);
  assert.deepEqual([tareaDe('vision').estado, tareaDe('vision').sonido], ['mirando', null]);
  assert.equal(tareaDe('rag'), null, 'lo que no es tarea no hace esperar');
  assert.equal(tareaDe('harness'), null);
  // «Muchísimas para que suene humano siempre»: de 15 a 45 por estado de tarea, avatar e idioma (José,
  // 1-oct: «no escuchemos siempre lo mismo»).
  for (const e of ['pensando', 'revisando', 'buscando', 'calculando', 'abriendo', 'leyendo', 'mirando', 'seguimiento'])
    for (const a of AVATARES_BANCO)
      for (const i of ['es', 'en']) {
        const n = frasesDe(e, a, i).length;
        assert.ok(n >= 15 && n <= 45, `${e}/${a}/${i}: ${n}`);
        // Siempre quedan de sobra sin muletilla para después del relleno del agente.
        assert.ok(frasesDe(e, a, i).filter((f) => !empiezaConMuletilla(f)).length >= 12, `${e}/${a}/${i} sin muletilla`);
      }
  const m = new MemoriaFrases();
  for (let k = 0; k < 30; k++) assert.ok(!empiezaConMuletilla(fraseDeEstado('pensando', 'aura', 'es', { memoria: m, sinMuletilla: true }).texto));
  const evitar = frasesDe('seguimiento', 'ojos', 'es').slice(0, -1);
  assert.equal(fraseDeEstado('seguimiento', 'ojos', 'es', { memoria: m, evitar }).texto, frasesDe('seguimiento', 'ojos', 'es').at(-1), 'no repite las ya dichas en la espera');
  // Las frases de espera son relleno: si el cerebro empieza con una, sobra.
  assert.equal(esRelleno('Ya casi lo tengo…'), true);
  assert.equal(esRelleno('Hojeando el documento…'), true);
  assert.equal(estadoDeEspera('léeme este pdf'), 'leyendo');
  assert.equal(estadoDeEspera('¿qué ves?'), 'mirando');
  // Las etiquetas v4 van en la voz, nunca en el banco (el globito).
  const me = new MemoriaEtiquetas();
  const dicha = vozDeEspera('Buscando…', 'buscando', 'aura', () => 0.1, me);
  assert.ok(etiquetasDe('buscando', 'aura').some((t) => dicha === `[${t}] Buscando…`), dicha);
  assert.equal(vozDeEspera('Buscando…', 'buscando', 'aura', () => 0.99, me), 'Buscando…');
});

prueba('puente: parado en segundo plano, al volver reconecta con Last-Event-ID (revisión 5, B11)', async () => {
  let conexiones = 0;
  const ultimos = [];
  const s = await servidorFalso((q, r) => {
    conexiones += 1;
    ultimos.push(q.headers['last-event-id'] || '');
    r.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (conexiones === 1) r.write('id: f-1\ndata: {"id":"f-1","accion":{"tipo":"abrir","pantalla":"perfil"}}\n\n');
    else r.write(': latido\n\n');
  });
  const recibidas = [];
  const puente = new PuenteAcciones({
    base: `http://127.0.0.1:${s.address().port}`,
    token: async () => 'tok',
    xhr: () => new XhrNode(),
    alAccion: (a) => recibidas.push(a),
    // Las esperas cortas, rápidas; el vigía de silencio (60 s), de verdad: aquí no debe saltar.
    esperar: (f, ms) => {
      const t = setTimeout(f, ms >= 60_000 ? ms : Math.min(ms, 30));
      return () => clearTimeout(t);
    },
    silencioMaxMs: 60_000,
  });
  puente.arrancar();
  await dormir(120);
  puente.parar(); // la app se fue a segundo plano
  const conectadas = conexiones;
  await dormir(150);
  assert.equal(conexiones, conectadas, 'detrás no se reconecta');
  assert.equal(puente.estado, 'parado');
  puente.arrancar(); // volvió
  await dormir(120);
  puente.parar();
  s.closeAllConnections?.();
  s.close();
  assert.equal(conexiones, conectadas + 1, JSON.stringify({ conectadas, conexiones, ultimos }));
  assert.equal(ultimos[ultimos.length - 1], 'f-1', 'retoma donde iba');
  assert.deepEqual(recibidas, [{ tipo: 'abrir', pantalla: 'perfil' }]);
});

/** Un XMLHttpRequest mínimo sobre http, con responseText que crece (como el de React Native). */
class XhrNode {
  responseText = '';
  status = 0;
  readyState = 0;
  onprogress = null;
  onreadystatechange = null;
  onerror = null;
  cabeceras = {};
  open(m, u) {
    this.m = m;
    this.u = new URL(u);
    this.readyState = 1;
  }
  setRequestHeader(k, v) {
    this.cabeceras[k] = v;
  }
  send() {
    this.req = http.request({ method: this.m, hostname: this.u.hostname, port: this.u.port, path: this.u.pathname, headers: this.cabeceras }, (res) => {
      this.status = res.statusCode;
      this.readyState = 2;
      this.onreadystatechange?.();
      res.setEncoding('utf8');
      res.on('data', (d) => {
        this.responseText += d;
        this.readyState = 3;
        this.onprogress?.();
      });
      res.on('end', () => {
        this.readyState = 4;
        this.onreadystatechange?.();
      });
    });
    this.req.on('error', () => {
      if (this.abortado) return;
      this.readyState = 4;
      this.onerror?.();
    });
    this.req.end();
  }
  abort() {
    this.abortado = true;
    this.req?.destroy();
  }
}

function servidorFalso(manejar) {
  return new Promise((ok) => {
    const s = http.createServer(manejar);
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

prueba('puente: recibe acciones por trozos, descarta las malas, reconecta con Last-Event-ID', async () => {
  let conexion = 0;
  const cabeceras = [];
  const s = await servidorFalso((q, r) => {
    conexion += 1;
    cabeceras.push({ sesion: q.headers['x-ultron-sesion'], ultimo: q.headers['last-event-id'] });
    r.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (conexion === 1) {
      r.write(': hola\n\n');
      r.write('id: p-1\ndata: {"id":"p-1","accion":{"tipo":"abrir","pant');
      setTimeout(() => r.write('alla":"ajustes"}}\n\n'), 20);
      setTimeout(() => r.write('id: p-2\ndata: {"id":"p-2","accion":{"tipo":"volar"}}\n\n'), 40);
      setTimeout(() => r.write('id: p-3\ndata: {"id":"p-3","accion":{"tipo":"redactar","para":"Mamá","texto":"Llego tarde"}}\n\n'), 60);
      setTimeout(() => r.write('id: p-3\ndata: {"id":"p-3","accion":{"tipo":"redactar","para":"Mamá","texto":"Llego tarde"}}\n\n'), 70);
      setTimeout(() => r.end(), 90); // el servidor recicla la conexión
    } else {
      r.write('id: p-4\ndata: {"id":"p-4","accion":{"tipo":"enviar"}}\n\n');
    }
  });
  const recibidas = [];
  const esperas = [];
  const puente = new PuenteAcciones({
    base: `http://127.0.0.1:${s.address().port}`,
    token: async () => 'tok',
    xhr: () => new XhrNode(),
    alAccion: (a) => recibidas.push(a),
    esperar: (f, ms) => {
      esperas.push(ms);
      const t = setTimeout(f, Math.min(ms, 30));
      return () => clearTimeout(t);
    },
  });
  puente.arrancar();
  await dormir(400);
  puente.parar();
  s.close();
  assert.deepEqual(recibidas, [{ tipo: 'abrir', pantalla: 'ajustes' }, { tipo: 'redactar', para: 'Mamá', texto: 'Llego tarde' }, { tipo: 'enviar' }]);
  assert.ok(conexion >= 2, 'reconectó');
  assert.equal(cabeceras[0].sesion, 'tok');
  assert.equal(cabeceras[1].ultimo, 'p-3');
  assert.ok(esperas.includes(1000), 'una conexión sana cerrada se reabre enseguida');
});

prueba('puente: 404 prueba cada minuto sin ruido; 500 espera cada vez más; sin sesión espera', async () => {
  let codigo = 404;
  const s = await servidorFalso((q, r) => {
    r.writeHead(codigo);
    r.end();
  });
  const esperas = [];
  const hacer = (token) =>
    new PuenteAcciones({
      base: `http://127.0.0.1:${s.address().port}`,
      token: async () => token,
      xhr: () => new XhrNode(),
      alAccion: () => {},
      esperar: (f, ms) => {
        esperas.push(ms);
        const t = setTimeout(f, 15);
        return () => clearTimeout(t);
      },
    });
  let p = hacer('tok');
  p.arrancar();
  await dormir(120);
  p.parar();
  assert.ok(esperas.filter((ms) => ms === 60_000).length >= 2, '404 → cada minuto');
  esperas.length = 0;
  codigo = 500;
  p = hacer('tok');
  p.arrancar();
  await dormir(200);
  p.parar();
  const reintentos = esperas.filter((ms) => ms !== 90_000);
  assert.deepEqual(reintentos.slice(0, 4), [1000, 2000, 4000, 8000]);
  esperas.length = 0;
  p = hacer(null);
  p.arrancar();
  await dormir(40);
  p.parar();
  assert.ok(esperas.every((ms) => ms === 15_000));
  s.close();
});

prueba('contexto: pantalla, borrador de AURA (solo con redactar ok) y contactos (solo nombre y correo), nunca mensajes', async () => {
  const enviados = [];
  const ctx = new ContextoApp({
    enviar: async (c) => enviados.push(JSON.parse(JSON.stringify(c))),
    contactos: async () => [
      { correo: 'Mama@X.com', nombre: 'Mamá', ultimo: { texto: 'secreto' } },
      { correo: 'mama@x.com', nombre: 'Otra' },
      { correo: 'sin-arroba', nombre: 'X' },
    ],
    escuchar: (t, f) => escuchar(t, f),
    esperar: (f, ms) => {
      const t = setTimeout(f, Math.min(ms, 5));
      return () => clearTimeout(t);
    },
  });
  ctx.arrancar();
  await dormir(20);
  emitir('pantalla', { pantalla: 'chats', chatAbierto: { correo: 'mama@x.com', nombre: 'Mamá' } });
  // Pedir `redactar` no basta: el borrador existe cuando salió bien (si no encontró a quién, no hay).
  const redactar = { tipo: 'redactar', para: 'Mamá', texto: 'Llego tarde' };
  emitir('accion', redactar);
  emitir('hecho', { accion: { ...redactar, para: 'Zacarías' }, ok: false, detalle: 'No encuentro a «Zacarías»' });
  await dormir(20);
  let u = enviados[enviados.length - 1];
  assert.equal(u.pantalla, 'chats');
  assert.equal(u.borrador, undefined, 'un redactar que falló no deja borrador en el contexto');
  emitir('hecho', { accion: redactar, ok: true, detalle: 'Borrador para Mamá.' });
  await dormir(20);
  u = enviados[enviados.length - 1];
  assert.equal(u.borrador, 'Llego tarde');
  assert.deepEqual(u.contactos, [{ correo: 'mama@x.com', nombre: 'Mamá' }]);
  assert.ok(!JSON.stringify(enviados).includes('secreto'));
  emitir('hecho', { accion: { tipo: 'enviar' }, ok: true });
  await dormir(20);
  u = enviados[enviados.length - 1];
  assert.equal(u.borrador, undefined);
  const cuantos = enviados.length;
  emitir('pantalla', { pantalla: 'chats', chatAbierto: { correo: 'mama@x.com', nombre: 'Mamá' } });
  await dormir(20);
  assert.equal(enviados.length, cuantos, 'lo mismo no se repite');
  ctx.parar();
  assert.deepEqual(depurarContactos([{ correo: ' A@B.C ', nombre: '' }]), [{ correo: 'a@b.c', nombre: 'a@b.c' }]);
});

/* ── figura y emoción del texto ──────────────────────────────────────────────────────────── */

prueba('figura: cada expresión se mezcla sin números raros; cada avatar tiene su estilo', () => {
  for (const [nombre, f] of Object.entries(FIGURAS)) {
    const m = mezclarFigura(FIGURAS.tranquila, f, 0.5);
    for (const [k, v] of Object.entries(m)) assert.ok(Number.isFinite(v), `${nombre}.${k}`);
  }
  assert.equal(estiloDe('aura').aura, true);
  assert.equal(estiloDe('claudio').retrato, true);
  assert.equal(estiloDe('ojos').main, '#5CE1FF');
});

prueba('manos: la app valida cada mano como el servidor; lo que no conoce se ignora', () => {
  assert.equal(esAccionApp({ tipo: 'llamar', con: 'Mamá', video: false }), true);
  assert.equal(esAccionApp({ tipo: 'llamar', con: 'Mamá' }), false, 'video tiene que venir');
  assert.equal(esAccionApp({ tipo: 'leer' }), true);
  assert.equal(esAccionApp({ tipo: 'leer', de: 'beto@x.com', boleto: 'AbCdEfGh12345678' }), true);
  assert.equal(esAccionApp({ tipo: 'leer', boleto: 'x y' }), false, 'un boleto sin forma no');
  assert.equal(esAccionApp({ tipo: 'buscar', q: 'dirección' }), true);
  assert.equal(esAccionApp({ tipo: 'buscar', q: 'd' }), false);
  assert.equal(esAccionApp({ tipo: 'idioma', valor: 'en' }), true);
  assert.equal(esAccionApp({ tipo: 'idioma', valor: 'fr' }), false);
  assert.equal(esAccionApp({ tipo: 'perfil', campo: 'vive', valor: 'San Pedro Sula' }), true);
  assert.equal(esAccionApp({ tipo: 'perfil', campo: 'clave', valor: 'x' }), false);
  assert.equal(esAccionApp({ tipo: 'recordatorio', texto: 'Llamar a mi mamá', cuando: Date.now() + 3600_000 }), true);
  assert.equal(esAccionApp({ tipo: 'recordatorio', texto: 'Llamar', cuando: 'a las 5' }), false);
  assert.equal(esAccionApp({ tipo: 'recordatorio', texto: 'Pastilla', cuando: Date.now() + 3600_000, llamada: true }), true);
  assert.equal(esAccionApp({ tipo: 'cancelar_recordatorio', id: 'aura-rec-abc-12' }), true);
  assert.equal(esAccionApp({ tipo: 'cancelar_recordatorio', id: '../../x' }), false);
  assert.equal(esAccionApp({ tipo: 'presentacion', valor: 'lado' }), false, 'es `presencia` (avatar 3D)');
  assert.equal(esAccionApp({ tipo: 'borrar_chat', con: 'Beto' }), false);
  assert.deepEqual(accionesDelTurno({ acciones: [{ id: 'm-1', accion: { tipo: 'volar_dron' } }, { id: 'm-2', accion: { tipo: 'idioma', valor: 'es' } }] }), [{ tipo: 'idioma', valor: 'es' }], 'una mano de un servidor más nuevo se ignora sin romper');
});

prueba('manos: el contexto le dice al servidor qué manos sabe hacer este teléfono', async () => {
  const enviados = [];
  const ctx = new ContextoApp({ enviar: async (c) => enviados.push(c), contactos: async () => [], escuchar: () => () => {}, esperar: (f) => (f(), () => {}) });
  const c = await ctx.enviarAhora(true);
  // `controles` (AUR10): los controles de voz separados (detener audio, colgar, la tarea).
  assert.deepEqual([...c.manos], ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada', 'llamame', 'cartera', 'pagar', 'controles', 'enviar_exacto'], 'enviar_exacto: comprueba el texto aprobado antes de mandar (permisos exactos)');
  assert.deepEqual([...c.manos], [...MANOS_APP]);
});

prueba('manos: la lectura viaja con la forma que el servidor reconoce', () => {
  const m = mensajeDeLectura('AbCdEfGh12345678', 'Beto te escribió\nhace un momento: «Ya voy».');
  const r = RE_LECTURA.exec(m);
  assert.ok(r, m);
  assert.equal(r[1], 'AbCdEfGh12345678');
  assert.equal(r[2], 'Beto te escribió hace un momento: «Ya voy».');
});

prueba('manos: decirLectura — en la conversación espera su «A ver…» y va con boleto; sin boleto no; sin conversación, la voz de la mesa en privado', async () => {
  const esperar = () => Promise.resolve();
  let estado = 'hablando';
  let vueltas = 0;
  const enviados = [];
  const base = { montada: true, silenciada: false, dormida: false, suspendida: false };
  const conv = {
    vista: () => {
      if (++vueltas > 3) estado = 'escuchando';
      return { ...base, estado };
    },
    enviarTexto: (t) => (enviados.push(t), true),
    hablarMesa: () => assert.fail('con conversación no habla la mesa'),
    mesaHablando: () => false,
    vozSuspendida: () => false,
    esperar,
  };
  assert.equal(await decirLectura({ texto: 'Beto: «hola»', boleto: 'AbCdEfGh12345678' }, conv), 'conversacion');
  assert.equal(enviados[0], '[[lectura:AbCdEfGh12345678]] Beto: «hola»');
  assert.ok(vueltas > 3, 'esperó a que terminara de hablar');
  assert.equal(await decirLectura({ texto: 'Beto: «hola»' }, conv), 'nada', 'sin boleto sería un turno normal: el cerebro leería el mensaje');
  const dichos = [];
  const mesa = { ...conv, vista: () => ({ ...base, montada: false, estado: 'cerrada' }), enviarTexto: () => assert.fail('sin conversación'), hablarMesa: (t) => dichos.push(t) };
  assert.equal(await decirLectura({ texto: 'No tienes mensajes nuevos.', boleto: 'AbCdEfGh12345678' }, mesa), 'mesa');
  assert.deepEqual(dichos, ['No tienes mensajes nuevos.']);
  for (const v of [{ suspendida: true }, { silenciada: true }, { dormida: true }]) {
    assert.equal(await decirLectura({ texto: 'x', boleto: 'AbCdEfGh12345678' }, { ...mesa, vista: () => ({ ...base, montada: false, estado: 'cerrada', ...v }) }), 'nada', JSON.stringify(v));
  }
});

prueba('manos: recordatorio — permiso de avisos, aviso programado una sola vez, y la hora que ya pasó no', async () => {
  _olvidarRecordatorios();
  const ahora = Date.UTC(2026, 8, 30, 20, 0);
  const K = { TriggerType: { TIMESTAMP: 0 }, AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 1 }, AuthorizationStatus: { DENIED: 0 }, AndroidImportance: { HIGH: 4 } };
  let permiso = 1;
  const puestos = [];
  const m = {
    requestPermission: async () => ({ authorizationStatus: permiso }),
    createChannel: async (c) => c.id,
    createTriggerNotification: async (n, t) => (puestos.push({ n, t }), n.id),
  };
  const d = { notifee: () => ({ m, k: K }), ahora: () => ahora, dueno: () => 'u-prueba' };
  const a = { texto: 'Llamar a mi mamá', cuando: ahora + 3 * 3600_000 };
  const r = await programarRecordatorio(a, d);
  assert.equal(r.ok, true, r.detalle);
  assert.equal(puestos.length, 1);
  assert.equal(puestos[0].n.body, 'Llamar a mi mamá');
  assert.equal(puestos[0].n.android.channelId, CANAL_RECORDATORIOS);
  assert.deepEqual(puestos[0].t, { type: 0, timestamp: a.cuando, alarmManager: { type: 1 } });
  assert.match(r.detalle, /^Te aviso hoy a las /);
  assert.deepEqual(await programarRecordatorio(a, d), r, 'la misma orden que vuelve no pone otro aviso');
  assert.equal(puestos.length, 1);
  assert.equal((await programarRecordatorio({ texto: 'Tarde', cuando: ahora + 5_000 }, d)).ok, false, 'ya casi pasó');
  permiso = 0;
  const negado = await programarRecordatorio({ texto: 'Otra cosa', cuando: ahora + 7200_000 }, d);
  assert.equal(negado.ok, false);
  assert.match(negado.detalle, /permiso de avisos/);
  assert.equal(puestos.length, 1);
  assert.equal((await programarRecordatorio({ texto: 'X', cuando: ahora + 7200_000 }, { notifee: () => null, ahora: () => ahora })).ok, false, 'sin notifee se dice');
});

prueba('recordatorio: con el permiso de avisos ya dado NO se vuelve a pedir (pedirlo pausa la app y colgaba la llamada)', async () => {
  _olvidarRecordatorios();
  const ahora = Date.UTC(2026, 8, 30, 20, 0);
  const K = { TriggerType: { TIMESTAMP: 0 }, AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 1 }, AuthorizationStatus: { DENIED: 0, AUTHORIZED: 1 }, AndroidImportance: { HIGH: 4 } };
  let pedidos = 0;
  let estado = 1;
  const m = {
    requestPermission: async () => (pedidos++, { authorizationStatus: 1 }),
    getNotificationSettings: async () => ({ authorizationStatus: estado, android: { alarm: 0 } }),
    createChannel: async (c) => c.id,
    createTriggerNotification: async (n) => n.id,
  };
  const d = { notifee: () => ({ m, k: K }), ahora: () => ahora, dueno: () => 'u-prueba' };
  assert.equal((await programarRecordatorio({ texto: 'Hacer una llamada', cuando: ahora + 3 * 60_000, llamada: true }, d)).ok, true);
  assert.equal(pedidos, 0, 'ya estaba dado: no se abre la ventana del permiso');
  // Sin el permiso todavía, sí se pide (la primera vez).
  estado = 0;
  assert.equal((await programarRecordatorio({ texto: 'Otra', cuando: ahora + 4 * 60_000 }, d)).ok, true);
  assert.equal(pedidos, 1);
});

/** Un notifee falso con lo que usan los recordatorios: guarda lo programado y lo mostrado. */
function notifeeFalso({ exacto = false, permiso = 1 } = {}) {
  const K = {
    TriggerType: { TIMESTAMP: 0 },
    AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 1, SET_EXACT_AND_ALLOW_WHILE_IDLE: 3 },
    AuthorizationStatus: { DENIED: 0 },
    AndroidImportance: { HIGH: 4 },
    AndroidCategory: { CALL: 'call' },
    AndroidVisibility: { PUBLIC: 1 },
    AndroidNotificationSetting: { ENABLED: 1 },
    EventType: { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 },
  };
  const f = { programados: [], canales: [], cancelados: [], quitados: [], mostrados: [] };
  f.m = {
    requestPermission: async () => ({ authorizationStatus: permiso }),
    getNotificationSettings: async () => ({ android: { alarm: exacto ? 1 : 0 } }),
    createChannel: async (c) => (f.canales.push(c), c.id),
    createTriggerNotification: async (n, t) => (f.programados.push({ n, t }), n.id),
    getTriggerNotifications: async () => f.programados.filter((p) => !f.cancelados.includes(p.n.id)).map((p) => ({ notification: p.n, trigger: p.t })),
    cancelTriggerNotifications: async (ids) => void f.cancelados.push(...ids),
    cancelNotification: async (id) => void f.quitados.push(id),
    displayNotification: async (n) => (f.mostrados.push(n), n.id),
  };
  f.k = K;
  f.deps = (ahora) => ({ notifee: () => ({ m: f.m, k: K }), ahora: () => ahora, dueno: () => 'u-prueba' });
  return f;
}

prueba('recordatorio con llamada: la llamada, el reintento a los 5 min y el aviso final, programados por adelantado; exacta solo si Android la deja', async () => {
  _olvidarRecordatorios();
  const ahora = Date.UTC(2026, 8, 30, 20, 0);
  const T = ahora + 3 * 3600_000;
  const f = notifeeFalso();
  const r = await programarRecordatorio({ texto: 'Tomar la pastilla', cuando: T, llamada: true }, f.deps(ahora));
  assert.equal(r.ok, true, r.detalle);
  assert.match(r.detalle, /^Te llamo hoy a las .*unos minutos de diferencia/, 'sin alarma exacta se dice que puede llegar tarde');
  const base = r.id;
  assert.deepEqual(f.programados.map((p) => [p.n.id, p.t.timestamp - T, p.t.alarmManager.type]), [
    [`${base}-l1`, 0, 1],
    [`${base}-l2`, REC.REINTENTO_MS, 1],
    [`${base}-final`, REC.AVISO_FINAL_MS, 1],
  ]);
  const l1 = f.programados[0].n;
  assert.equal(l1.android.category, 'call');
  assert.equal(l1.android.channelId, REC.CANAL_LLAMADA);
  assert.equal(l1.android.fullScreenAction.launchActivity, 'default', 'pantalla completa con el teléfono bloqueado');
  assert.deepEqual(l1.android.actions.map((a) => a.pressAction.id), [REC.ACCION_CONTESTAR, REC.ACCION_RECHAZAR]);
  assert.equal(l1.android.loopSound, true);
  assert.equal(l1.android.timeoutAfter, REC.SUENA_MS);
  assert.ok(f.canales.some((c) => c.id === REC.CANAL_LLAMADA && c.importance === 4 && c.sound), 'canal de alta importancia con timbre');
  // Con «Alarmas y recordatorios» permitido: exacta.
  const g = notifeeFalso({ exacto: true });
  const r2 = await programarRecordatorio({ texto: 'Otra', cuando: T + 60_000, llamada: true }, g.deps(ahora));
  assert.equal(r2.exacto, true);
  assert.ok(g.programados.every((p) => p.t.alarmManager.type === 3));
  assert.equal(r2.detalle, `Te llamo ${REC.horaCorta(T + 60_000, ahora)}.`);
});

prueba('recordatorios: se listan uno por recordatorio y se cancelan enteros (llamada, reintento y aviso final)', async () => {
  _olvidarRecordatorios();
  const ahora = Date.UTC(2026, 8, 30, 20, 0);
  const f = notifeeFalso();
  const a = await programarRecordatorio({ texto: 'Tomar la pastilla', cuando: ahora + 7200_000, llamada: true }, f.deps(ahora));
  const b = await programarRecordatorio({ texto: 'Ir al banco', cuando: ahora + 3600_000 }, f.deps(ahora));
  const lista = await REC.listarRecordatorios(f.deps(ahora));
  assert.deepEqual(lista, [
    { id: b.id, texto: 'Ir al banco', cuando: ahora + 3600_000, llamada: false },
    { id: a.id, texto: 'Tomar la pastilla', cuando: ahora + 7200_000, llamada: true },
  ]);
  const c = await REC.cancelarRecordatorio(a.id, f.deps(ahora));
  assert.equal(c.ok, true);
  assert.deepEqual(f.cancelados, REC.idsDe(a.id));
  assert.deepEqual((await REC.listarRecordatorios(f.deps(ahora))).map((x) => x.id), [b.id]);
  assert.equal((await REC.cancelarRecordatorio(a.id, f.deps(ahora))).ok, false, 'ya no está');
  assert.equal((await REC.cancelarRecordatorio('../../otra-cosa', f.deps(ahora))).ok, false);
});

prueba('la llamada de AURA: suena, contestar quita lo que faltaba y se dice UNA vez; rechazar deja el aviso escrito', async () => {
  _olvidarRecordatorios();
  const ahora = Date.UTC(2026, 8, 30, 20, 0);
  const f = notifeeFalso();
  const r = await programarRecordatorio({ texto: 'Tomar la pastilla', cuando: ahora + 3600_000, llamada: true }, f.deps(ahora));
  const n1 = f.programados[0].n;
  const K = f.k;
  assert.equal(REC.interpretarEvento({ type: K.EventType.DELIVERED, detail: { notification: n1 } }, K)?.que, 'suena');
  assert.equal(REC.interpretarEvento({ type: K.EventType.PRESS, detail: { notification: n1 } }, K)?.que, 'suena', 'tocar el aviso abre «AURA te llama»');
  const c = REC.interpretarEvento({ type: K.EventType.ACTION_PRESS, detail: { notification: n1, pressAction: { id: REC.ACCION_CONTESTAR } } }, K);
  assert.equal(c?.que, 'contestar');
  assert.deepEqual(c.llamada, { base: r.id, texto: 'Tomar la pastilla', cuando: ahora + 3600_000, paso: 'l1', dueno: 'u-prueba' });
  assert.equal(REC.interpretarEvento({ type: K.EventType.ACTION_PRESS, detail: { notification: n1, pressAction: { id: REC.ACCION_RECHAZAR } } }, K)?.que, 'rechazar');
  assert.equal(REC.interpretarEvento({ type: K.EventType.DELIVERED, detail: { notification: f.programados[2].n } }, K), null, 'el aviso final no suena como llamada');
  assert.equal(REC.interpretarEvento({ type: K.EventType.DELIVERED, detail: { notification: { id: 'pulse2chat-llamada' } } }, K), null, 'la de PULSE2CHAT no es de aquí');
  assert.equal(REC.interpretarApertura({ notification: n1, pressAction: { id: REC.ACCION_CONTESTAR } }, K)?.que, 'contestar', 'con la app cerrada, Contestar la abre y se contesta');
  assert.equal(REC.interpretarApertura({ notification: n1, pressAction: { id: REC.ACCION_PANTALLA } }, K)?.que, 'suena', 'la pantalla completa muestra «AURA te llama»');
  await REC.alContestar(r.id, f.deps(ahora));
  assert.deepEqual(f.cancelados, [`${r.id}-l2`, `${r.id}-final`]);
  assert.deepEqual(f.quitados, [`${r.id}-l1`, `${r.id}-l2`]);
  assert.equal(REC.anotarContestada(c.llamada, ahora), true);
  assert.equal(REC.anotarContestada(c.llamada, ahora + 1000), false, 'el evento de fondo y el de apertura: una sola vez');
  assert.equal(REC.tomarPorDecir()?.texto, 'Tomar la pastilla');
  assert.equal(REC.tomarPorDecir(), null);
  await REC.alRechazar(c.llamada, f.deps(ahora));
  assert.equal(f.mostrados.at(-1).id, `${r.id}-final`);
  assert.equal(f.mostrados.at(-1).body, 'Tomar la pastilla');
  // En plena llamada de PULSE2CHAT: se quita y se repone al colgar.
  await REC.aplazar(c.llamada, f.deps(ahora));
  assert.equal(f.quitados.at(-1), `${r.id}-l1`);
  await REC.reponer(c.llamada, f.deps(ahora));
  assert.equal(f.mostrados.at(-1).id, `${r.id}-l1`);
  assert.equal(f.mostrados.at(-1).android.category, 'call');
});

prueba('contestó: AURA se lo dice en la conversación (esperando a que termine una llamada de PULSE2CHAT); si no conecta, la voz de la mesa', async () => {
  assert.match(mensajeDeRecordatorio('Tomar la pastilla'), /^\[\[recordatorio\]\] Tomar la pastilla$/);
  assert.match(turnoDeRecordatorio(mensajeDeRecordatorio('Tomar la pastilla')), /llamas para recordarme: «Tomar la pastilla»/, 'el servidor lo entiende');
  let estado = { montada: false, estado: 'cerrada', silenciada: false, dormida: false, suspendida: true };
  const eventos = [];
  let terminaLlamada;
  const d = {
    vista: () => estado,
    despertar: () => {
      eventos.push('despertar');
      estado = { ...estado, montada: true, estado: 'conectando' };
      setTimeout(() => (estado = { ...estado, estado: 'escuchando' }), 5);
    },
    enviarTexto: (t) => (eventos.push(t), true),
    hablarMesa: () => assert.fail('conectó: no habla la mesa'),
    enLlamada: () => estado.suspendida,
    finDeLlamada: () => new Promise((r) => (terminaLlamada = r)),
    esperar: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2))),
  };
  const p = decirRecordatorio('Tomar la pastilla', d);
  await dormir(10);
  assert.deepEqual(eventos, [], 'en llamada no hace nada todavía');
  estado = { ...estado, suspendida: false };
  terminaLlamada();
  assert.equal(await p, 'conversacion');
  assert.deepEqual(eventos, ['despertar', '[[recordatorio]] Tomar la pastilla']);
  const dichos = [];
  const sinRed = { ...d, vista: () => ({ montada: true, estado: 'error', silenciada: false, dormida: false, suspendida: false }), despertar: () => {}, enLlamada: () => false, hablarMesa: (t) => dichos.push(t), topeMs: 20 };
  assert.equal(await decirRecordatorio('Ir al banco', sinRed), 'mesa');
  assert.deepEqual(dichos, ['Te llamo para recordarte: Ir al banco']);
});

prueba('el contexto lleva los recordatorios puestos (para decirlos y cancelarlos por voz)', async () => {
  const ctx = new ContextoApp({
    enviar: async () => {},
    contactos: async () => [],
    recordatorios: async () => [{ id: 'aura-rec-1-a', texto: 'Ir al banco', cuando: 5, llamada: false }],
    escuchar: () => () => {},
    esperar: (f) => (f(), () => {}),
  });
  const c = await ctx.enviarAhora(true);
  assert.deepEqual(c.recordatorios, [{ id: 'aura-rec-1-a', texto: 'Ir al banco', cuando: 5, llamada: false }]);
});

/* ── un solo dueño del audio (José, 4.7.0: «me dejó de escuchar», «se quedaron ambos hablando») ── */

/** El micrófono y la voz de la mesa, simulados como en lib/speech + lib/tts: quiere/pausado/hablando. */
function mesaSimulada() {
  const m = { quiere: true, pausado: false, hablando: false, turnos: 0, cortes: 0, log: [] };
  m.deps = {
    muteMic: () => void ((m.quiere = false), m.log.push('mute')),
    unmuteMic: () => void ((m.quiere = true), m.log.push('unmute')),
    pauseMicForTts: (p) => void ((m.pausado = p), m.log.push(`pausa:${p}`)),
    stopSpeaking: () => void ((m.hablando = false), m.cortes++),
    cancelarTurno: () => void m.turnos++,
    micQuerido: () => true,
  };
  /** ¿El reconocedor arrancaría? (speechNative.start sale si no se quiere o está pausado). */
  m.oye = () => m.quiere && !m.pausado;
  return m;
}

prueba('dueño del audio: la llamada manda, después la conversación; la mesa solo si se la ve y la app está delante', () => {
  const s = (o) => duenoAudio({ enLlamada: false, conversacion: false, mesaVisible: true, appActiva: true, ...o });
  assert.equal(s({}), 'mesa');
  assert.equal(s({ conversacion: true }), 'conversacion');
  assert.equal(s({ enLlamada: true, conversacion: true }), 'llamada');
  assert.equal(s({ mesaVisible: false, companeraVisible: true }), 'companera', 'la mesa tapada por los chats: atiende la compañera (antes «nadie»: sorda)');
  assert.equal(s({ mesaVisible: false, companeraVisible: true, conversacion: true }), 'conversacion');
  assert.equal(s({ mesaVisible: false, companeraVisible: true, enLlamada: true }), 'llamada');
  assert.equal(s({ mesaVisible: false, companeraVisible: false }), 'nadie');
  assert.equal(s({ appActiva: false }), 'nadie');
  assert.equal(s({ appActiva: false, mesaVisible: false, companeraVisible: true }), 'nadie', 'con la app detrás nadie oye');
});

prueba('la compañera en los chats (José 5.1: «lo hice pequeño en chat y me dejó de escuchar»): el MISMO oído sigue abierto', () => {
  const m = mesaSimulada();
  const reabiertos = [];
  m.deps.reabrirMic = () => void ((m.quiere = true), (m.pausado = false), reabiertos.push('reabre'), m.log.push('reabre'));
  const oido = new OidoMesa(m.deps);
  const sit = (o) => duenoAudio({ enLlamada: false, conversacion: false, mesaVisible: true, appActiva: true, companeraVisible: false, ...o });
  oido.fijar('mesa');
  m.log.length = 0;
  m.hablando = true; // contestaba en la mesa
  // Va a los chats: la mesa se encoge en la compañera. Nada se corta ni se cierra: el turno sigue y ella lo dice.
  assert.equal(oido.aplicar(sit({ mesaVisible: false, companeraVisible: true })), 'nada');
  assert.deepEqual(m.log, [], 'ni mute, ni pausa, ni reabrir: cambiar de pantalla no toca el micrófono');
  assert.equal(m.turnos, 0, 'el turno en curso NO se corta');
  assert.equal(m.hablando, true, 'la respuesta sigue sonando (la dice la compañera)');
  assert.ok(m.oye(), 'la compañera escucha');
  assert.equal(oido.puedeHablar(), true, 'y puede contestar con la voz');
  // Doble toque: la conversación en vivo toma el audio (una sola voz, un solo oído).
  assert.equal(oido.aplicar(sit({ mesaVisible: false, companeraVisible: true, conversacion: true })), 'suelta');
  assert.equal(m.quiere, false, 'el oído del teléfono suelta el micrófono para la conversación');
  assert.equal(oido.puedeHablar(), false);
  // La conversación no llega a escuchar (no conectó / sin audio) → el oído vuelve NUEVO, no el viejo.
  assert.equal(oido.aplicar(sit({ mesaVisible: false, companeraVisible: true })), 'toma');
  assert.deepEqual(reabiertos, ['reabre'], 'se reabre un reconocedor nuevo (antes: unmute del que quedó colgado)');
  assert.ok(m.oye());
  // Vuelve a la mesa grande: sigue el mismo oído (sin cortar nada).
  m.log.length = 0;
  assert.equal(oido.aplicar(sit({ mesaVisible: true })), 'nada');
  assert.deepEqual(m.log, []);
  assert.ok(m.oye());
});

prueba('vigilante del oído: sin señales de vida → reinicio duro; tras el tope → la nube; si tampoco, «sordo» (y sigue probando, espaciado)', async () => {
  const s = { nuestro: true, silenciado: false, hablando: false, pensando: false, pausado: false, vivo: false, reinicios: 0, nube: 0, soltadas: 0, enNube: false, t: 0 };
  const v = new VigilanteOido({
    reloj: () => s.t,
    esNuestro: () => s.nuestro,
    silenciado: () => s.silenciado,
    hablando: () => s.hablando,
    pensando: () => s.pensando,
    pausado: () => s.pausado,
    soltarPausa: () => void ((s.pausado = false), s.soltadas++),
    vivo: () => s.vivo,
    reiniciar: () => void s.reinicios++,
    caerANube: () => {
      s.nube++;
      if (s.enNube) return false;
      s.enNube = true;
      return true;
    },
  });
  // Vivo: nada.
  s.vivo = true;
  assert.equal(v.revisar(), 'nada');
  // Muerto (un bucle de error+end no es vida): reinicia hasta el tope.
  s.vivo = false;
  for (let i = 0; i < TOPE_REINICIOS_OIDO; i++) assert.equal(v.revisar(), 'reinicia');
  assert.equal(s.reinicios, TOPE_REINICIOS_OIDO);
  assert.equal(v.revisar(), 'nube');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.nube, 1);
  // Revive en la nube: vuelve a cero.
  s.vivo = true;
  assert.equal(v.revisar(), 'nada');
  // Muere otra vez y la nube ya no es opción: queda sordo y lo dice, sin reiniciar en bucle…
  s.vivo = false;
  for (let i = 0; i < TOPE_REINICIOS_OIDO; i++) v.revisar();
  assert.equal(v.revisar(), 'nube');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(v.estaSordo(), true);
  const antes = s.reinicios;
  assert.equal(v.revisar(), 'sordo');
  assert.equal(s.reinicios, antes, 'sordo no reinicia en bucle');
  // …pero ya no es para siempre (antes: «sordo» y nunca más se probaba): reinicio duro a los 15 s,
  // 30 s, 60 s… con tope de 2 min.
  const esperas = [];
  let desde = s.t;
  for (let n = 0; n < 6; n++) {
    let k = 0;
    while (v.revisar() === 'sordo') {
      s.t += 1000;
      if (++k > 1000) assert.fail('no volvió a probar');
    }
    esperas.push(s.t - desde);
    desde = s.t;
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.deepEqual(esperas, [ESPERA_SORDO_MS, 2 * ESPERA_SORDO_MS, 4 * ESPERA_SORDO_MS, ESPERA_SORDO_MAX_MS, ESPERA_SORDO_MAX_MS, ESPERA_SORDO_MAX_MS]);
  assert.equal(s.reinicios, antes + 6, 'cada intento es un reinicio duro');
  assert.equal(v.estaSordo(), true, 'la etiqueta sigue diciendo que no oye hasta que reviva');
  s.vivo = true;
  assert.equal(v.revisar(), 'nada');
  assert.equal(v.estaSordo(), false, 'en cuanto revive deja de estar sordo');
  // Pausa colgada «por la voz» sin voz: se suelta a la segunda vuelta; hablando o pensando, no.
  s.pausado = true;
  s.pensando = true;
  assert.equal(v.revisar(), 'nada');
  assert.equal(v.revisar(), 'nada');
  s.pensando = false;
  assert.equal(v.revisar(), 'nada');
  assert.equal(v.revisar(), 'pausa-suelta');
  assert.equal(s.soltadas, 1);
  // Si el oído no es nuestro (la conversación, una llamada) o la persona lo silenció, no se toca.
  s.vivo = false;
  s.nuestro = false;
  const r0 = s.reinicios;
  for (let i = 0; i < 5; i++) assert.equal(v.revisar(), 'nada');
  s.nuestro = true;
  s.silenciado = true;
  for (let i = 0; i < 5; i++) assert.equal(v.revisar(), 'nada');
  assert.equal(s.reinicios, r0);
});

prueba('vigilante del oído: las cuentas vuelven a cero cuando el oído vuelve a ser nuestro (tras una llamada); sano en la nube, prueba otra vez el del teléfono', async () => {
  const s = { nuestro: true, vivo: false, revivio: false, reinicios: 0, nativo: 0, cambia: false, t: 0 };
  const v = new VigilanteOido({
    reloj: () => s.t,
    esNuestro: () => s.nuestro,
    silenciado: () => false,
    hablando: () => false,
    pensando: () => false,
    pausado: () => false,
    soltarPausa: () => {},
    vivo: () => s.vivo,
    revivio: () => s.revivio,
    reiniciar: () => void s.reinicios++,
    caerANube: () => false, // ya en la nube
    volverANativo: () => (s.nativo++, s.cambia),
  });
  for (let i = 0; i < TOPE_REINICIOS_OIDO; i++) v.revisar();
  v.revisar();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(v.estaSordo(), true);
  // La llamada del avatar toma el audio y lo devuelve: dueño nuevo, cuentas en cero (sin esperar al tope).
  s.nuestro = false;
  assert.equal(v.revisar(), 'nada');
  s.nuestro = true;
  assert.equal(v.revisar(), 'reinicia', 'vuelve a empezar por un reinicio, no «sordo»');
  assert.equal(v.estaSordo(), false);
  // Estando sordo, el intento espaciado prueba primero el del teléfono; si cambió de motor, no reinicia.
  for (let i = 0; i < TOPE_REINICIOS_OIDO; i++) v.revisar();
  await new Promise((r) => setTimeout(r, 0));
  s.t += ESPERA_SORDO_MS;
  s.cambia = true;
  const r0 = s.reinicios;
  const n0 = s.nativo;
  assert.equal(v.revisar(), 'reinicia');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.nativo, n0 + 1);
  assert.equal(s.reinicios, r0, 'cambiar de motor ya lo arranca nuevo');
  // Revive de verdad: cuentas en cero y, sano y quieto, se le pregunta a speech si toca volver al del teléfono.
  s.vivo = true;
  s.revivio = true;
  assert.equal(v.revisar(), 'nada');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(v.estaSordo(), false);
  assert.equal(s.nativo, n0 + 2);
});

prueba('al colgar la llamada del avatar, la mesa reabre su oído cuando la voz soltó el audio (Android: el stop tardío lo mataba)', async () => {
  const m = mesaSimulada();
  const reabiertos = [];
  m.deps.reabrirMic = () => void ((m.quiere = true), (m.pausado = false), reabiertos.push('reabre'));
  const audio = new AudioVoz(() => {});
  m.deps.esperarAudioLibre = () => audio.esperarLibre(4000);
  const oido = new OidoMesa(m.deps);
  oido.fijar('mesa');
  assert.equal(oido.aplicar('conversacion'), 'suelta');
  audio.tomar(7);
  // Cuelga: el dueño vuelve a la mesa, pero el SDK todavía no paró su sesión de audio.
  assert.equal(oido.aplicar('mesa'), 'toma');
  await dormir(5);
  assert.deepEqual(reabiertos, [], 'no reabre mientras la conversación tiene el audio');
  audio.soltar(7); // onDisconnect: ya paró
  await dormir(1);
  assert.deepEqual(reabiertos, ['reabre'], 'reabre en cuanto queda libre');
  assert.ok(m.oye());
  // Si mientras esperaba el audio pasó a otro (otra llamada), no reabre.
  assert.equal(oido.aplicar('llamada'), 'suelta');
  audio.tomar(8);
  assert.equal(oido.aplicar('mesa'), 'toma');
  assert.equal(oido.aplicar('conversacion'), 'suelta');
  audio.soltar(8);
  await dormir(1);
  assert.deepEqual(reabiertos, ['reabre']);
  // Ir de la mesa a la compañera mientras espera no cancela el reabrir (es el mismo oído).
  audio.tomar(9);
  assert.equal(oido.aplicar('mesa'), 'toma');
  assert.equal(oido.aplicar('companera'), 'nada');
  audio.soltar(9);
  await dormir(1);
  assert.deepEqual(reabiertos, ['reabre', 'reabre']);
  // Sin aviso de la voz, reabre igual al tope (4 s; aquí con un reloj corto).
  const corto = new AudioVoz(() => {}, (f) => {
    const t = setTimeout(f, 5);
    return () => clearTimeout(t);
  });
  m.deps.esperarAudioLibre = () => corto.esperarLibre();
  const oido2 = new OidoMesa(m.deps);
  oido2.fijar('conversacion');
  corto.tomar(1);
  oido2.aplicar('mesa');
  await dormir(20);
  assert.deepEqual(reabiertos, ['reabre', 'reabre', 'reabre']);
});

prueba('conversación en vivo: «Conectando…» sin tope o abierta sin audio del micrófono ya no se quedan con el micrófono', () => {
  let ahora = 0;
  const c = new ControlSesion('claudio', 'es', { reloj: () => ahora, reintentos: 1 });
  // Doble toque en los chats: abre, llega el permiso y se queda «conectando» (el WebRTC no termina nunca).
  c.despertarOSilenciar();
  assert.equal(c.vista().estado, 'conectando');
  c.permisoListo(c.vista().gen);
  ahora += CONECTAR_MAX_MS - 1;
  assert.equal(c.revisar(), 'nada');
  ahora += 1;
  assert.equal(c.revisar(), 'no-conecto');
  assert.equal(c.vista().montada, true, 'primero el reintento (permiso nuevo)');
  assert.equal(c.vista().intento, 1);
  c.permisoListo(c.vista().gen);
  ahora += CONECTAR_MAX_MS;
  assert.equal(c.revisar(), 'no-conecto');
  assert.equal(c.vista().montada, false, 'tampoco: suelta el audio (el oído del teléfono vuelve)');
  assert.equal(c.vista().estado, 'error');
  assert.match(motivoFalloVoz(c.vista().detalle), /tardó demasiado en conectar/);
  // Conecta pero el micrófono de WebRTC no le llega nada (cero perfecto): sorda.
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  for (let t = 0; t < SORDA_MS; t += 500) {
    ahora += 500;
    c.entrada(0);
    if (t + 500 < SORDA_MS) assert.equal(c.revisar(), 'nada');
  }
  assert.equal(c.revisar(), 'sorda');
  assert.equal(c.vista().montada, false, 'sin reintento: la persona ya lleva un rato hablándole a nadie');
  assert.match(motivoFalloVoz(c.vista().detalle), /no me llegaba tu voz/);
  // Con el micrófono vivo (ruido de fondo, o una frase entendida) no es sorda por callada que esté.
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  c.entrada(0.01);
  ahora += SORDA_MS * 3;
  assert.equal(c.revisar(), 'nada');
  c.terminar();
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  c.oyoFrase();
  ahora += SORDA_MS * 3;
  assert.equal(c.revisar(), 'nada');
  // Silenciada a propósito no cuenta (el micrófono está cortado por ella).
  c.terminar();
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  c.silenciar(true);
  ahora += SORDA_MS * 3;
  assert.equal(c.revisar(), 'nada');
});

prueba('llamada: el micrófono deja de mandar muestras a media llamada → no sigue «escuchando», reconecta (Codex, 3-oct)', () => {
  let ahora = 1_000;
  const c = new ControlSesion('aura', 'es', { reloj: () => ahora });
  c.iniciar();
  c.alEstado(c.vista().gen, 'escuchando');
  // Vivo: el valor crudo cambia con cada cuadro (ruido de fondo), aunque la persona calle.
  for (let t = 0; t < SIN_MUESTRAS_MS * 2; t += 50) {
    ahora += 50;
    c.entrada(0.004, 0.002 + (t % 7) * 1e-5);
  }
  assert.equal(c.revisar(), 'nada', 'micrófono vivo y callado: no es fallo');
  // Supresión de ruido: en silencio da 0 exacto cuadro tras cuadro. Eso es silencio, no un micrófono parado (Codex en #138).
  for (let t = 0; t < SIN_MUESTRAS_MS * 2; t += 50) {
    ahora += 50;
    c.entrada(0, 0);
  }
  assert.equal(c.revisar(), 'nada', 'ceros exactos en silencio: no reconecta');
  // Se congela: el SDK repite el último valor (no cae a 0).
  const gen = c.vista().gen;
  for (let t = 0; t < SIN_MUESTRAS_MS - 500; t += 50) {
    ahora += 50;
    c.entrada(0.004, 0.00207);
  }
  assert.equal(c.revisar(), 'nada', 'todavía no');
  ahora += 600;
  c.entrada(0.004, 0.00207);
  assert.equal(c.revisar(), 'sin-muestras');
  assert.equal(c.vista().estado, 'conectando', 'ya no dice «escuchando»: reconecta');
  assert.equal(c.vista().gen, gen + 1);
  assert.equal(c.vista().montada, true);
  // Mientras el avatar habla no se juzga (el valor puede quedarse quieto con el eco cancelado).
  c.alEstado(c.vista().gen, 'escuchando');
  c.entrada(0.004, 0.001);
  c.alEstado(c.vista().gen, 'hablando');
  ahora += SIN_MUESTRAS_MS * 2;
  c.entrada(0.004, 0.001);
  assert.equal(c.revisar(), 'nada');
  // Silenciada a propósito: tampoco (el micrófono lo cortó ella).
  c.alEstado(c.vista().gen, 'escuchando');
  c.silenciar(true);
  ahora += SIN_MUESTRAS_MS * 2;
  assert.equal(c.revisar(), 'nada');
  // Sin valor crudo (quien abre no lo manda) no se puede juzgar: no se inventa un fallo.
  const d = new ControlSesion('aura', 'es', { reloj: () => ahora });
  d.iniciar();
  d.alEstado(d.vista().gen, 'escuchando');
  d.entrada(0.01);
  ahora += SIN_MUESTRAS_MS * 3;
  assert.equal(d.revisar(), 'nada');
  // Si tampoco vuelve tras reconectar, falla como siempre y se dice por qué (no «permiso»).
  assert.match(motivoFalloVoz('el micrófono dejó de mandar audio'), /dejó de mandarme audio/);
});

prueba('CALL01: silencio desde el inicio (lecturas frescas en cero) no es «sorda»; una pista congelada falla y se recupera con tope', () => {
  let ahora = 1_000;
  const c = new ControlSesion('aura', 'es', { reloj: () => ahora });
  c.iniciar();
  c.permisoListo(c.vista().gen);
  c.alEstado(c.vista().gen, 'escuchando');
  // 400 lecturas nuevas del SDK a 20 Hz (20 s), todas en 0 exacto: la persona no ha dicho nada todavía y la
  // supresión de ruido da cero. Antes, a los ~16 s: «sorda» (se adivinaba por la amplitud).
  for (let i = 0; i < 400; i++) {
    ahora += 50;
    c.entrada(0, 0);
    assert.equal(c.revisar(), 'nada', `lectura ${i}: un cero fresco es silencio, no un micrófono muerto`);
  }
  assert.equal(c.vista().montada, true);
  assert.equal(c.vista().estado, 'escuchando');
  // Congelada desde el principio: el SDK repite el mismo valor (distinto de 0) y la persona no ha hablado.
  // No es amplitud (es casi nada) sino que no llegan cuadros: falla y reconecta.
  const d = new ControlSesion('aura', 'es', { reloj: () => ahora });
  d.iniciar();
  d.permisoListo(d.vista().gen);
  d.alEstado(d.vista().gen, 'escuchando');
  const congelada = () => {
    let r = 'nada';
    for (let t = 0; t < SIN_MUESTRAS_MS + 2_000 && r === 'nada'; t += 50) {
      ahora += 50;
      d.entrada(0.0002, 0.0001);
      r = d.revisar();
    }
    return r;
  };
  const g0 = d.vista().gen;
  assert.equal(congelada(), 'sin-muestras');
  assert.equal(d.vista().gen, g0 + 1, 'se reconecta (una generación nueva)');
  assert.equal(d.vista().montada, true);
  assert.equal(d.vista().estado, 'conectando');
  // Se recupera con límites: reconecta hasta TOPE_RECONEXIONES y, si sigue congelada, suelta el micrófono.
  for (let k = 1; k <= TOPE_RECONEXIONES; k++) {
    d.permisoListo(d.vista().gen);
    d.alEstado(d.vista().gen, 'escuchando');
    assert.equal(congelada(), 'sin-muestras');
  }
  assert.equal(d.vista().montada, false, 'pasado el tope no reconecta más: el oído del teléfono vuelve');
  assert.equal(d.vista().estado, 'error');
  assert.match(motivoFalloVoz(d.vista().detalle), /dejó de mandarme audio/);
  // Y una pista que vuelve a mandar cuadros tras reconectar ya no falla.
  const e = new ControlSesion('aura', 'es', { reloj: () => ahora });
  e.iniciar();
  e.permisoListo(e.vista().gen);
  e.alEstado(e.vista().gen, 'escuchando');
  for (let t = 0; t < SIN_MUESTRAS_MS * 2; t += 50) {
    ahora += 50;
    e.entrada(0.004, 0.002 + ((t / 50) % 5) * 1e-5);
  }
  assert.equal(e.revisar(), 'nada');
});

prueba('CALL02: permiso y conexión con plazo por fase y tope total (permiso tardío válido, cancelado, red lenta, conexión colgada)', () => {
  let ahora = 0;
  const nueva = () => {
    const c = new ControlSesion('aura', 'es', { reloj: () => ahora, reintentos: 1 });
    c.iniciar();
    return c;
  };
  assert.ok(ESPERA_PERMISO_MS > PERMISO_MAX_MS, 'la petición del permiso avisa primero con su propio timeout');
  assert.ok(ABRIR_MAX_MS < ESPERA_PERMISO_MS + CONECTAR_MAX_MS, 'el tope total acota la suma de las fases');
  // 1) Permiso tardío pero válido (14 s: dentro de los 15 s de la petición). Antes el controlador lo daba
  //    por fallido a los 12 s y el permiso que llegaba se tiraba.
  let c = nueva();
  let g = c.vista().gen;
  ahora += 14_000;
  assert.equal(c.revisar(), 'nada', 'esperando el permiso cuenta su plazo, no los 12 s de conectar');
  c.permisoListo(g);
  ahora += 6_000;
  assert.equal(c.revisar(), 'nada', 'conectar tiene su propio plazo desde que llegó el permiso');
  c.alEstado(g, 'escuchando');
  assert.equal(c.vista().estado, 'escuchando');
  assert.equal(c.vista().gen, g, 'la misma generación: no se reintentó');
  // 2) Red lenta: el permiso a los 3 s y el WebRTC tarda casi todo su plazo.
  c = nueva();
  g = c.vista().gen;
  ahora += 3_000;
  c.permisoListo(g);
  ahora += CONECTAR_MAX_MS - 100;
  assert.equal(c.revisar(), 'nada');
  c.alEstado(g, 'escuchando');
  assert.equal(c.vista().estado, 'escuchando');
  // 3) Conexión colgada: con el permiso en la mano, el WebRTC no termina nunca.
  c = nueva();
  g = c.vista().gen;
  ahora += 1_000;
  c.permisoListo(g);
  ahora += CONECTAR_MAX_MS - 1;
  assert.equal(c.revisar(), 'nada');
  ahora += 1;
  assert.equal(c.revisar(), 'no-conecto');
  assert.equal(c.vista().gen, g + 1, 'reintento con permiso nuevo');
  assert.equal(c.vista().estado, 'conectando');
  // El permiso que la generación vieja recibe tarde no cambia la fase de la nueva.
  c.permisoListo(g);
  ahora += ESPERA_PERMISO_MS - 1;
  assert.equal(c.revisar(), 'nada', 'la nueva sigue esperando SU permiso');
  ahora += 1;
  assert.equal(c.revisar(), 'no-conecto');
  assert.equal(c.vista().montada, false, 'tampoco: suelta el audio');
  assert.match(motivoFalloVoz(c.vista().detalle), /tardó demasiado en conectar/, 'no se confunde con el permiso del micrófono');
  // 4) El permiso no llega nunca: la petición tiene su timeout (15 s); el controlador es el respaldo.
  c = nueva();
  ahora += PERMISO_MAX_MS;
  assert.equal(c.revisar(), 'nada', 'se le deja a la petición avisar con su propio error');
  ahora += ESPERA_PERMISO_MS - PERMISO_MAX_MS;
  assert.equal(c.revisar(), 'no-conecto');
  // 5) Tope total: el permiso al límite y la conexión colgada no suman 15 + 12 s.
  c = nueva();
  g = c.vista().gen;
  ahora += ESPERA_PERMISO_MS - 500;
  c.permisoListo(g);
  ahora += ABRIR_MAX_MS - (ESPERA_PERMISO_MS - 500) - 1;
  assert.equal(c.revisar(), 'nada');
  ahora += 1;
  assert.equal(c.revisar(), 'no-conecto', 'el plazo total manda aunque la fase de conectar no haya vencido');
  // 6) Cancelado: cuelga mientras espera el permiso; lo que llegue tarde no abre ni falla nada.
  c = nueva();
  g = c.vista().gen;
  ahora += 2_000;
  c.terminar();
  c.permisoListo(g);
  c.alEstado(g, 'escuchando');
  ahora += ABRIR_MAX_MS * 2;
  assert.equal(c.revisar(), 'nada');
  assert.equal(c.vista().montada, false);
  assert.equal(c.vista().estado, 'cerrada');
});

prueba('CALL04: transcripción aceptada y respuesta pendiente → «pensando» (con tope), sin tocar quién tiene el micrófono', () => {
  let ahora = 0;
  const c = new ControlSesion('aura', 'es', { reloj: () => ahora });
  c.iniciar();
  const g = c.vista().gen;
  c.permisoListo(g);
  c.alEstado(g, 'escuchando');
  assert.equal(c.vista().pensando, false);
  // ElevenLabs entregó lo que dijo la persona: hasta que el agente conteste, piensa.
  c.oyoFrase();
  assert.equal(c.vista().pensando, true);
  assert.equal(c.vista().estado, 'escuchando', 'el estado de la sesión (y con él el micrófono) no cambia');
  assert.equal(c.vista().montada, true);
  assert.equal(c.vista().montada && !c.vista().silenciada, true, 'el micrófono sigue siendo de la conversación (vozOcupaMicrofono)');
  c.alEstado(g, 'hablando');
  assert.equal(c.vista().pensando, false, 'empezó a hablar: ya no piensa');
  c.alEstado(g, 'escuchando');
  assert.equal(c.vista().pensando, false, 'terminar de hablar no es pensar');
  // Contestó con texto sin audio (o el modo «speaking» no llegó): su mensaje también cierra la espera.
  c.oyoFrase();
  c.respondio();
  assert.equal(c.vista().pensando, false);
  // Con tope: si nunca contesta, no se queda pensando para siempre.
  c.oyoFrase();
  ahora += PENSANDO_MAX_MS - 1;
  c.revisar();
  assert.equal(c.vista().pensando, true);
  ahora += 1;
  c.revisar();
  assert.equal(c.vista().pensando, false, 'pasado el tope vuelve a «escuchando»');
  assert.equal(c.vista().estado, 'escuchando');
  // Silenciar, colgar o reconectar la terminan.
  c.oyoFrase();
  c.silenciar(true);
  assert.equal(c.vista().pensando, false);
  c.silenciar(false);
  c.oyoFrase();
  c.alEstado(g, 'error', 'Server error');
  assert.equal(c.vista().pensando, false, 'reconectando no piensa');
  c.terminar();
  c.oyoFrase();
  assert.equal(c.vista().pensando, false, 'sin sesión no hay nada que pensar');
  // La compañera lo pinta: piensa (no «escucha») mientras espera la respuesta, y escucha cuando no.
  const vozDe = (pensando) => ({ estado: 'escuchando', silenciada: false, dormida: false, suspendida: false, pensando });
  assert.equal(expresion(reducir(ANIMO_INICIAL, { tipo: 'voz', voz: vozDe(true) }, 0).animo, 0), 'piensa');
  assert.equal(expresion(reducir(ANIMO_INICIAL, { tipo: 'voz', voz: vozDe(false) }, 0).animo, 0), 'escucha');
});

prueba('fallo de la conversación en vivo → el micrófono de la mesa vuelve de verdad (la pausa colgada se suelta)', () => {
  const m = mesaSimulada();
  const oido = new OidoMesa(m.deps);
  const c = new ControlSesion('claudio', 'es', { reintentos: 1 });
  const aplicar = () => oido.aplicar(duenoAudio({ enLlamada: false, conversacion: c.vista().montada || c.vista().dormida, mesaVisible: true, appActiva: true }));
  aplicar();
  // La mesa estaba hablando («¡Aquí estoy! Cuéntame.»): su voz pausó el micrófono.
  m.hablando = true;
  m.deps.pauseMicForTts(true);
  // Toca «Conversar»: la conversación toma el audio; la voz de la mesa se corta A LA MITAD (sin onEnd).
  c.iniciar();
  assert.equal(aplicar(), 'suelta');
  assert.equal(m.hablando, false, 'la mesa se calla: nunca dos voces');
  assert.equal(m.turnos, 1, 'el turno que pensaba se corta');
  assert.equal(m.pausado, false, 'la pausa de la voz cortada se suelta al soltar');
  // No abre (servidor sin la ruta, 404): reintento y error.
  c.alEstado(c.vista().gen, 'error', 'HTTP 404 · HTTP 404');
  c.alEstado(c.vista().gen, 'error', 'HTTP 404 · HTTP 404');
  assert.equal(c.vista().montada, false);
  assert.equal(c.vista().estado, 'error');
  assert.equal(aplicar(), 'toma');
  assert.ok(m.oye(), 'la mesa vuelve a oír (antes: quería oír pero seguía pausada → sorda)');
  assert.match(motivoFalloVoz(c.vista().detalle), /servidor todavía no tiene la conversación en vivo/);
});

prueba('sin el arreglo, el mismo camino deja a la mesa sorda (así fallaba 4.7.0)', () => {
  // Lo de antes: mute al abrir, unmute al fallar, y nadie soltaba la pausa de la voz cortada.
  const m = mesaSimulada();
  m.deps.pauseMicForTts(true);
  m.deps.stopSpeaking();
  m.deps.muteMic();
  m.deps.unmuteMic();
  assert.equal(m.oye(), false, 'quiere oír pero la pausa sigue puesta: el reconocedor no arranca');
});

prueba('dos voces nunca: la conversación desde la compañera calla a la mesa; con la app detrás nadie oye', () => {
  const m = mesaSimulada();
  const oido = new OidoMesa(m.deps);
  const sit = (o) => duenoAudio({ enLlamada: false, conversacion: false, mesaVisible: false, appActiva: true, companeraVisible: true, ...o });
  oido.aplicar('mesa');
  m.hablando = true;
  // En los chats con la conversación abierta desde la compañera: la voz de la mesa se calla y su oído se suelta.
  assert.equal(oido.aplicar(sit({ conversacion: true })), 'suelta');
  assert.equal(m.hablando, false);
  assert.equal(m.quiere, false, 'su oído no queda abierto debajo de la conversación');
  assert.equal(oido.puedeHablar(), false);
  // La app se va detrás: sigue suelto.
  assert.equal(oido.aplicar(sit({ appActiva: false })), 'suelta');
  assert.equal(m.quiere, false);
  // Vuelve a la app, ya sin conversación: la compañera oye (y una sola vez).
  assert.equal(oido.aplicar(sit({})), 'toma');
  assert.equal(oido.aplicar(sit({})), 'nada');
  assert.ok(m.oye());
});

prueba('al montarse la mesa no abre el micrófono antes del permiso (fijar no toca nada)', () => {
  const m = mesaSimulada();
  m.quiere = false;
  const oido = new OidoMesa(m.deps);
  oido.fijar('mesa');
  assert.deepEqual(m.log, [], 'ni unmute ni pausa: el oído lo abre el arranque con el permiso');
  assert.equal(oido.aplicar('mesa'), 'nada');
  assert.equal(oido.aplicar('conversacion'), 'suelta');
});

prueba('una llamada que falla (PULSE2CHAT «no pudo») devuelve el oído de la mesa sin pausa colgada', () => {
  const m = mesaSimulada();
  const oido = new OidoMesa(m.deps);
  oido.aplicar('mesa');
  m.deps.pauseMicForTts(true); // la mesa hablaba al empezar la llamada
  oido.aplicar(duenoAudio({ enLlamada: true, conversacion: false, mesaVisible: true, appActiva: true }));
  oido.aplicar(duenoAudio({ enLlamada: false, conversacion: false, mesaVisible: true, appActiva: true }));
  assert.ok(m.oye());
  // «Cállate» corta la voz: su onEnd no llega, la pausa se suelta igual.
  m.deps.pauseMicForTts(true);
  oido.vozCortada();
  assert.ok(m.oye());
});

prueba('por qué no abrió la conversación, dicho para la persona (sin detalles técnicos)', () => {
  assert.match(motivoFalloVoz('HTTP 401 · Entra de nuevo para hablar en conversación.'), /sesión venció/);
  assert.match(motivoFalloVoz('HTTP 404 · HTTP 404'), /se estaba actualizando/);
  assert.match(motivoFalloVoz('HTTP 429 · Se acabaron tus minutos'), /minutos de voz/);
  assert.match(motivoFalloVoz('HTTP 503 · La conversación fluida no está lista todavía.'), /no está disponible/);
  assert.match(motivoFalloVoz('HTTP 502 · No pude abrir la conversación ahora.'), /no respondió/);
  assert.match(motivoFalloVoz('Network request failed'), /conexión/);
  assert.match(motivoFalloVoz('Aborted'), /conexión/);
  assert.match(motivoFalloVoz(''), /no pude conectar/);
  assert.match(motivoFalloVoz('HTTP 404', true), /server/);
});

prueba('emoción del texto (conversación fluida)', () => {
  assert.equal(emocionDeTexto('¡Jajaja, qué bueno!'), 'risa');
  assert.equal(emocionDeTexto('Lo siento mucho, de verdad'), 'triste');
  assert.equal(emocionDeTexto('¡Listo! Ya se lo envié'), 'feliz');
  assert.equal(emocionDeTexto('¿A quién se lo mando?'), 'curioso');
  assert.equal(emocionDeTexto('Wow, no me digas'), 'sorpresa');
  assert.equal(emocionDeTexto('Son las tres'), 'neutral');
});

/* ── el banco de frases de estado (escuchando, pensando, revisando… por avatar e idioma) ───────── */

const AVATARES_BANCO = ['ojos', 'aura', 'claudio', 'antonio'];

prueba('frases de estado: cada estado, avatar e idioma tiene variedad (≥5) y frases cortas', () => {
  assert.deepEqual([...AVATARES.map((a) => a.id)].sort(), [...AVATARES_BANCO].sort(), 'los mismos avatares que el catálogo');
  let total = 0;
  for (const e of ESTADOS_FRASE) for (const a of AVATARES_BANCO) for (const i of ['es', 'en']) {
    const l = frasesDe(e, a, i);
    total += l.length;
    assert.ok(l.length >= 5, `${e}/${a}/${i}: ${l.length}`);
    assert.equal(new Set(l).size, l.length, `${e}/${a}/${i} sin repetidas`);
    for (const f of l) assert.ok(f.length <= 48 && f.split(' ').length <= 9, `larga: «${f}»`);
  }
  assert.ok(total >= 850, `total ${total}`);
});

prueba('frases de estado: no se repiten seguidas y recuerdan las últimas', () => {
  const m = new MemoriaFrases();
  let azar = 0.1;
  const paso = () => (azar = (azar * 9301 + 0.49297) % 1);
  for (const e of ESTADOS_FRASE) for (const a of AVATARES_BANCO) {
    const vistas = [];
    for (let k = 0; k < 40; k++) vistas.push(fraseDeEstado(e, a, 'es', { memoria: m, azar: paso }).texto);
    for (let k = 1; k < vistas.length; k++) assert.notEqual(vistas[k], vistas[k - 1], `${e}/${a}: repitió «${vistas[k]}»`);
    const n = frasesDe(e, a, 'es').length;
    const ventana = Math.min(4, n - 1);
    for (let k = ventana; k < vistas.length; k++) assert.ok(!vistas.slice(k - ventana, k).includes(vistas[k]), `${e}/${a}: «${vistas[k]}» dentro de las últimas ${ventana}`);
    assert.ok(new Set(vistas).size >= Math.min(n, 5), `${e}/${a}: poca variedad`);
  }
  // Aunque cambie el estado, la misma frase no sale dos veces seguidas.
  const otra = new MemoriaFrases();
  const a1 = fraseDeEstado('pensando', 'aura', 'es', { memoria: otra, azar: () => 0 }).texto;
  const a2 = fraseDeEstado('revisando', 'aura', 'es', { memoria: otra, azar: () => 0 }).texto;
  assert.notEqual(a1, a2);
});

prueba('frases de estado: cada idioma en su idioma; sin género; el Guardián sereno y breve', () => {
  for (const e of ESTADOS_FRASE) for (const a of AVATARES_BANCO) {
    for (const f of frasesDe(e, a, 'en')) {
      assert.ok(!/[ñ¿¡áéíóú]/i.test(f), `en con español: «${f}»`);
      assert.notEqual(detectarIdioma(f), 'es', `en detectada como español: «${f}»`);
    }
    for (const f of frasesDe(e, a, 'es')) assert.notEqual(detectarIdioma(f), 'en', `es detectada como inglés: «${f}»`);
    for (const f of [...frasesDe(e, a, 'es'), ...frasesDe(e, a, 'en')]) {
      assert.ok(!/\b(estoy|quedé|quede) (list[oa]|content[oa]|cansad[oa]|segur[oa])\b/i.test(f), `con género: «${f}»`);
      assert.ok(!/\[/.test(f), `sin etiquetas de expresión en el globito: «${f}»`);
    }
  }
  const largo = (a) => {
    const l = ESTADOS_FRASE.flatMap((e) => frasesDe(e, a, 'es'));
    return l.reduce((s, f) => s + f.length, 0) / l.length;
  };
  assert.ok(largo('ojos') < largo('claudio') && largo('ojos') < largo('antonio'), 'el Guardián habla más corto');
  assert.ok(!frasesDe('alegria', 'ojos', 'es').includes('¡Qué alegre!'), 'el Guardián no usa la calidez de las de base');
  assert.ok(frasesDe('pensando', 'antonio', 'es').some((f) => /cuatro/.test(f)), 'ANT-ONIO y sus cuatro brazos');
  assert.ok(frasesDe('buscando', 'claudio', 'es').some((f) => /olfate/i.test(f)), 'Claudio, el zorro, olfatea');
});

prueba('frases de estado: cada estado va a una cara, una emoción y una cara de mesa que YA existen', () => {
  const CARAS_MESA = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'HAPPY', 'CONCERNED', 'ANGRY', 'SLEEPING', 'STARTLE', 'WINK', 'CONFUSED', 'MUSIC', 'SCAN', 'YAWNING', 'LAUGH', 'SURPRISED', 'SAD', 'TIRED', 'SING', 'CURIOUS', 'PROUD', 'PRAY'];
  for (const e of ESTADOS_FRASE) {
    const m = EMOCION_DE_ESTADO[e];
    assert.ok(EXPRESIONES_AVATAR.includes(m.expresion), `${e}: ${m.expresion}`);
    assert.ok(EMOCIONES.includes(m.emocion), `${e}: ${m.emocion}`);
    assert.ok(CARAS_MESA.includes(m.cara), `${e}: ${m.cara}`);
    const f = fraseDeEstado(e, 'aura', 'es');
    assert.equal(f.expresion, m.expresion);
  }
  assert.equal(EMOCION_DE_ESTADO.escuchando.expresion, 'escucha');
  assert.equal(EMOCION_DE_ESTADO.pensando.expresion, 'piensa');
  assert.equal(EMOCION_DE_ESTADO.sorpresa.expresion, 'sorprendida');
});

prueba('frases de estado: la muletilla del cerebro sobra tras el puente; qué estado toca por la pregunta', () => {
  assert.equal(esRelleno('Mmm, déjame ver.'), true);
  assert.equal(esRelleno('Let me check…'), true);
  assert.equal(esRelleno('El oro está a tres mil.'), false);
  assert.equal(quitarRellenoInicial('Mmm, déjame ver. El oro subió.'), 'El oro subió.');
  assert.equal(quitarRellenoInicial('Un momento. Hmm, a ver, ya: son las tres.'), 'Ya: son las tres.');
  assert.equal(quitarRellenoInicial('Bienvenido de vuelta.'), 'Bienvenido de vuelta.');
  assert.equal(estadoDeEspera('busca el precio del oro'), 'buscando');
  assert.equal(estadoDeEspera('¿cuánto es 15 x 3?'), 'calculando');
  assert.equal(estadoDeEspera('revisa mis pendientes'), 'revisando');
  assert.equal(estadoDeEspera('¿qué opinas de la reunión?'), 'pensando');
});

prueba('frases de estado: la compañera las usa en su globito (con su avatar e idioma) y dice «pensando» al esperar', () => {
  fijarAvatar('claudio');
  fijarIdioma('en');
  try {
    const vistas = new Set();
    for (let k = 0; k < 12; k++) vistas.add(textoCompa.escuchando());
    assert.ok(vistas.size >= 4, 'varía');
    for (const f of vistas) assert.ok(frasesDe('escuchando', 'claudio', 'en').includes(f), f);
    const r0 = reducir(ANIMO_INICIAL, { tipo: 'mesa', hablando: false, pensando: true, emocion: 'neutral' }, 0);
    assert.ok(!r0.efectos.some((e) => e.tipo === 'globo'), 'al empezar a pensar todavía no: solo si tarda');
    // Si la espera pasa de GLOBO_PENSANDO_MS, el siguiente tic lo dice.
    const r = reducir(r0.animo, { tipo: 'tic' }, GLOBO_PENSANDO_MS + 10);
    const g = r.efectos.find((e) => e.tipo === 'globo');
    assert.ok(g && frasesDe('pensando', 'claudio', 'en').includes(g.texto), JSON.stringify(r.efectos));
    // Seguir pensando no repite el globito.
    const r2 = reducir(r.animo, { tipo: 'mesa', hablando: false, pensando: true, emocion: 'neutral' }, GLOBO_PENSANDO_MS + 20);
    const r3 = reducir(r2.animo, { tipo: 'tic' }, GLOBO_PENSANDO_MS + 600);
    assert.ok(!r2.efectos.some((e) => e.tipo === 'globo') && !r3.efectos.some((e) => e.tipo === 'globo'));
    assert.ok(frasesDe('disculpa', 'claudio', 'en').every((f) => /sorry/i.test(f)), 'el perdón de la interrupción dice «sorry»');
  } finally {
    fijarAvatar('aura');
    fijarIdioma('es');
  }
});

/* ── la llamada del avatar (José 30-sep: «le digo que me llame y hace la animación "te están llamando"») ── */

function cicloDePrueba(o = {}) {
  const r = { t: Date.UTC(2026, 8, 30, 20, 0) };
  const c = new CicloLlamada({ reloj: () => r.t, idioma: () => 'es', ...o });
  const tipos2 = (ef) => ef.map((e) => e.tipo);
  return { c, r, tipos2 };
}
const RECL = { tipo: 'recordatorio', texto: 'Llamar a Beto', base: 'aura-rec-x1', paso: 'l1', cuando: Date.UTC(2026, 8, 30, 20, 0), dueno: 'seu1' };

prueba('ciclo: la máquina entera — REPOSO → SONANDO → CONECTANDO → EN_LLAMADA ↔ SILENCIADO → COLGADA → REPOSO', () => {
  const { c, r, tipos2 } = cicloDePrueba();
  const vistos = [];
  c.suscribir((e) => vistos.push(e));
  assert.equal(c.estado(), 'reposo');
  assert.equal(c.sesionViva(), false, 'en reposo no hay sesión de ElevenLabs');
  assert.deepEqual(c.llamar({ tipo: 'llamame' }), [{ tipo: 'timbre', on: true }]);
  assert.equal(c.estado(), 'sonando');
  assert.equal(c.sesionViva(), false, 'sonando tampoco (no se cobra hasta contestar)');
  assert.deepEqual(tipos2(c.contestar()), ['timbre', 'contestada', 'abrir']);
  assert.equal(c.estado(), 'conectando');
  // El saludo es el first_message del agente: mandar [[llamada]] además hacía un saludo doble.
  assert.deepEqual(c.conectado(), [], '«llámame»: no se manda [[llamada]] (antes: «¡Aquí estoy! Cuéntame.» + «¡Hola! Aquí estoy…»)');
  assert.equal(MENSAJE_LLAMAME, '[[llamada]]', 'la marca sigue existiendo (el servidor la atiende para versiones viejas)');
  assert.equal(c.estado(), 'en_llamada');
  assert.deepEqual(c.dobleToque(), [{ tipo: 'silenciar', valor: true }]);
  assert.equal(c.estado(), 'silenciado');
  assert.deepEqual(c.dobleToque(), [{ tipo: 'silenciar', valor: false }]);
  assert.equal(c.estado(), 'en_llamada');
  r.t += 90_000;
  assert.deepEqual(c.colgar(), [{ tipo: 'cerrar', motivo: 'persona' }]);
  assert.equal(c.estado(), 'colgada');
  assert.equal(c.motivo(), 'persona');
  assert.deepEqual(c.cerrada(), [], 'el cierre que pedimos no cuenta como corte');
  r.t += FIN_VISIBLE_MS;
  c.tic();
  assert.equal(c.estado(), 'reposo', 'se ve «Llamada terminada» un momento y vuelve a reposo');
  assert.deepEqual(vistos, ['sonando', 'conectando', 'en_llamada', 'silenciado', 'en_llamada', 'colgada', 'reposo']);
  assert.equal(c.usadoMs(), 90_000, 'solo se cobra lo conectado');
});

prueba('ciclo: «Hablar» abre la conversación al instante — sin timbre ni pantalla entrante (José 1-oct)', () => {
  const { c, tipos2 } = cicloDePrueba();
  const vistos = [];
  c.suscribir((e) => vistos.push(e));
  assert.deepEqual(tipos2(c.hablarYa()), ['contestada', 'abrir'], 'nada de timbre');
  assert.equal(c.estado(), 'conectando');
  assert.deepEqual(vistos, ['conectando'], 'nunca pasa por «sonando»');
  assert.deepEqual(c.conectado(), [], 'el saludo es el first_message del agente');
  assert.equal(c.estado(), 'en_llamada');
  assert.deepEqual(c.hablarYa(), [], 'ya hablando, no abre otra');
  // Si algo ya sonaba (un recordatorio), «Hablar» lo contesta.
  const b = cicloDePrueba();
  b.c.llamar(RECL);
  assert.deepEqual(b.tipos2(b.c.hablarYa()), ['timbre', 'contestada', 'abrir']);
  assert.deepEqual(b.c.conectado(), [{ tipo: 'primerMensaje', texto: '[[recordatorio]] Llamar a Beto' }]);
  // Sin minutos de hoy: lo dice la mesa, no se abre nada.
  const d = cicloDePrueba();
  d.c.hablarYa();
  d.c.conectado();
  d.c.fallo('HTTP 429 · tope de voz');
  d.c.listo();
  assert.equal(d.c.llamadaDisponible(), false);
  assert.deepEqual(d.c.hablarYa(), [{ tipo: 'alNativo', texto: null, motivo: 'tope' }]);
  assert.equal(d.c.estado(), 'reposo');
});

prueba('ciclo: rechazar → RECHAZADA; no contestar en 60 s → PERDIDA; «llámame» en llamada no suena otra', () => {
  const a = cicloDePrueba();
  a.c.llamar({ tipo: 'llamame' });
  assert.deepEqual(a.tipos2(a.c.rechazar()), ['timbre', 'rechazada']);
  assert.equal(a.c.estado(), 'rechazada');
  const b = cicloDePrueba();
  b.c.llamar(RECL);
  b.r.t += SONAR_MS - 1000;
  assert.deepEqual(b.c.tic(), []);
  b.r.t += 1000;
  assert.deepEqual(b.c.tic(), [{ tipo: 'timbre', on: false }, { tipo: 'perdida', origen: RECL }]);
  assert.equal(b.c.estado(), 'perdida');
  assert.equal(b.c.contestar().length, 0, 'perdida ya no se contesta en la app (el reintento de notifee vuelve a llamar)');
  const d = cicloDePrueba();
  d.c.llamar({ tipo: 'llamame' });
  d.c.contestar();
  d.c.conectado();
  assert.deepEqual(d.c.llamar({ tipo: 'llamame' }), []);
  assert.equal(d.c.estado(), 'en_llamada');
  // Un recordatorio que llega en plena llamada se dice por la misma llamada (y se da por contestado).
  assert.deepEqual(d.tipos2(d.c.llamar(RECL)), ['contestada', 'decirEnLlamada']);
  assert.equal(d.c.llamar(RECL)[1].texto, '[[recordatorio]] Llamar a Beto');
});

prueba('ciclo: recordatorio → a la hora suena → contestar → el PRIMER MENSAJE es el recordatorio (y la charla sigue)', () => {
  const { c, tipos2 } = cicloDePrueba();
  assert.deepEqual(tipos2(c.llamar(RECL)), ['timbre']);
  assert.equal(c.origen().texto, 'Llamar a Beto');
  const ef = c.contestar();
  assert.deepEqual(tipos2(ef), ['timbre', 'contestada', 'abrir']);
  assert.deepEqual(ef[1].origen, RECL, 'contestada: se quitan el reintento y el aviso final (recordatoriosNativo)');
  assert.deepEqual(c.conectado(), [{ tipo: 'primerMensaje', texto: '[[recordatorio]] Llamar a Beto' }]);
  assert.equal(mensajeDeRecordatorio('Llamar a Beto'), '[[recordatorio]] Llamar a Beto', 'la misma forma que manda compa/acciones.ts');
  c.turnoUsuario('gracias, ¿y qué más tengo hoy?');
  assert.equal(c.estado(), 'en_llamada', 'sigue la conversación hasta que cuelgue');
});

prueba('ciclo: silencio 3 min → «¿sigues ahí?» → 20 s sin respuesta → cuelga; si contesta, sigue', () => {
  const { c, r } = cicloDePrueba();
  c.llamar({ tipo: 'llamame' });
  c.contestar();
  c.conectado();
  r.t += PREGUNTA_SIGUES_MS - 1000;
  assert.deepEqual(c.tic(), []);
  r.t += 1000;
  assert.deepEqual(c.tic(), [{ tipo: 'sigues' }]);
  assert.equal(MENSAJE_SIGUES, '[[sigues]]');
  // El avatar lo dice (2 s): su propio «¿sigues ahí?» no reinicia la cuenta; los 20 s cuentan desde que terminó.
  c.agente(true);
  r.t += 2000;
  c.agente(false);
  r.t += ESPERA_SIGUES_MS - 1000;
  assert.deepEqual(c.tic(), []);
  r.t += 1000;
  assert.deepEqual(c.tic(), [{ tipo: 'cerrar', motivo: 'silencio' }]);
  assert.equal(c.estado(), 'colgada');
  assert.equal(c.motivo(), 'silencio');
  // Si contesta a tiempo, la llamada sigue y la cuenta vuelve a empezar.
  const b = cicloDePrueba();
  b.c.llamar({ tipo: 'llamame' });
  b.c.contestar();
  b.c.conectado();
  b.r.t += PREGUNTA_SIGUES_MS;
  b.c.tic();
  b.r.t += 5000;
  b.c.turnoUsuario('sí, aquí estoy');
  b.r.t += ESPERA_SIGUES_MS * 2;
  assert.deepEqual(b.c.tic(), []);
  assert.equal(b.c.estado(), 'en_llamada');
  // Mientras hablan (el avatar contando algo largo) no pregunta nada.
  b.c.agente(true);
  b.r.t += PREGUNTA_SIGUES_MS * 2;
  assert.deepEqual(b.c.tic(), []);
  // Configurable.
  const corto = cicloDePrueba({ preguntaMs: 10_000, esperaSiguesMs: 5_000 });
  corto.c.llamar({ tipo: 'llamame' });
  corto.c.contestar();
  corto.c.conectado();
  corto.r.t += 10_000;
  assert.deepEqual(corto.c.tic(), [{ tipo: 'sigues' }]);
  corto.r.t += 5_000;
  assert.deepEqual(corto.c.tic(), [{ tipo: 'cerrar', motivo: 'silencio' }]);
  // Silenciada, cuelga pasado lo mismo (no puede preguntar).
  const mudo = cicloDePrueba();
  mudo.c.llamar({ tipo: 'llamame' });
  mudo.c.contestar();
  mudo.c.conectado();
  mudo.c.dobleToque();
  mudo.r.t += PREGUNTA_SIGUES_MS + ESPERA_SIGUES_MS;
  assert.deepEqual(mudo.c.tic(), [{ tipo: 'cerrar', motivo: 'silencio' }]);
});

prueba('ciclo (1-oct): la sesión se cae a mitad de llamada → reconecta con `[[reconecta]] <última frase>`, sin otro saludo; pasado el tope cuelga y el oído vuelve a la mesa', () => {
  const { c, r } = cicloDePrueba();
  const ctl = new ControlSesion('claudio', 'es', { reloj: () => r.t });
  const enviados = [];
  const efectos = [];
  const ejecutar = (ef) => {
    for (const e of ef) {
      efectos.push(e.tipo);
      if (e.tipo === 'abrir') ctl.iniciar();
      if (e.tipo === 'cerrar') ctl.terminar();
      if (e.tipo === 'primerMensaje') enviados.push(e.texto);
    }
  };
  // Lo mismo que el VozProvider: lo que pasa en la sesión, contado al ciclo.
  let antes = ctl.vista();
  ctl.suscribir((v) => {
    const a = antes;
    antes = v;
    const ef = [];
    if (v.montada && v.estado === 'conectando' && (!a.montada || a.gen !== v.gen)) ef.push(...c.sesionAbriendo());
    if (v.montada && (v.estado === 'escuchando' || v.estado === 'hablando') && a.estado === 'conectando') ef.push(...c.conectado());
    if (!v.montada && v.estado === 'error' && (a.montada || a.estado !== 'error')) ef.push(...c.fallo(v.detalle));
    else if (a.montada && !v.montada) ef.push(...c.cerrada('cortada'));
    ejecutar(ef);
  });
  const dueno = () => duenoAudio({ enLlamada: false, conversacion: ctl.vista().montada || ctl.vista().dormida || llamadaActiva(c.estado()), mesaVisible: true, appActiva: true });
  ejecutar(c.llamar({ tipo: 'llamame' }));
  ejecutar(c.contestar());
  ctl.alEstado(ctl.vista().gen, 'escuchando');
  assert.deepEqual(enviados, [], 'al contestar no se manda saludo (lo dice el agente)');
  // La persona pide algo; el cerebro tarda y ElevenLabs corta la sesión («Server error»).
  r.t += 2_000;
  c.turnoUsuario('pon una alarma en tres minutos');
  r.t += 5_000;
  ctl.alEstado(ctl.vista().gen, 'error', 'Server error');
  assert.equal(c.estado(), 'en_llamada', 'la llamada sigue (reconectando)');
  ctl.alEstado(ctl.vista().gen, 'escuchando');
  assert.deepEqual(enviados, ['[[reconecta]] pon una alarma en tres minutos'], 'la conversación nueva pide perdón y retoma lo que pidió');
  // Se cae otra vez sin que la persona dijera nada en esta sesión: solo el perdón (la frase ya se mandó).
  r.t += 3_000;
  ctl.alEstado(ctl.vista().gen, 'error', 'Server error');
  ctl.alEstado(ctl.vista().gen, 'escuchando');
  assert.deepEqual(enviados.slice(1), [MENSAJE_RECONECTA]);
  // Y otra: pasado el tope ya no reconecta: cuelga por fallo y el oído vuelve a la mesa.
  ctl.alEstado(ctl.vista().gen, 'error', 'Server error');
  assert.equal(ctl.vista().montada, false);
  assert.equal(c.estado(), 'colgada');
  assert.equal(c.motivo(), 'fallo');
  assert.ok(efectos.includes('alNativo'), 'lo dice la mesa');
  assert.equal(dueno(), 'mesa', 'el audio vuelve a la mesa');
  assert.ok(!enviados.some((t) => /\[\[llamada\]\]/.test(t)), 'nunca otro saludo');
});

prueba('ciclo: `[[reconecta]]` solo con una frase reciente y de la persona (no las marcas de la app); silenciada no se manda', () => {
  const { c, r } = cicloDePrueba();
  c.llamar(RECL);
  c.contestar();
  c.sesionAbriendo();
  assert.deepEqual(c.conectado(), [{ tipo: 'primerMensaje', texto: '[[recordatorio]] Llamar a Beto' }]);
  // Una frase vieja (ya contestada) no se vuelve a hacer.
  c.turnoUsuario('gracias');
  r.t += FRASE_RECONECTA_MS + 1;
  c.sesionAbriendo();
  assert.deepEqual(c.conectado(), [{ tipo: 'primerMensaje', texto: MENSAJE_RECONECTA }]);
  // Una marca que vuelve como «frase de la persona» (el eco del texto mandado) no cuenta.
  c.turnoUsuario('[[reconecta]] gracias');
  c.sesionAbriendo();
  assert.deepEqual(c.conectado(), [{ tipo: 'primerMensaje', texto: MENSAJE_RECONECTA }]);
  // Una frase YA CONTESTADA (el avatar habló de verdad después) no se vuelve a hacer al reconectar.
  c.turnoUsuario('pon una alarma en tres minutos');
  r.t += 500;
  c.agente(true);
  r.t += 3_000;
  c.agente(false);
  c.sesionAbriendo();
  assert.deepEqual(c.conectado(), [{ tipo: 'primerMensaje', texto: MENSAJE_RECONECTA }], 'contestada: no se repite (la alarma no se pone dos veces)');
  // Solo el relleno («Mmm… a ver.», corto) no la contesta: sí se retoma.
  c.turnoUsuario('¿cómo va el oro?');
  c.agente(true);
  r.t += 900;
  c.agente(false);
  c.sesionAbriendo();
  assert.deepEqual(c.conectado(), [{ tipo: 'primerMensaje', texto: '[[reconecta]] ¿cómo va el oro?' }]);
  // Solo la ÚLTIMA frase, limpia.
  c.turnoUsuario('hola');
  c.turnoUsuario('  ¿y   mañana qué tengo? ');
  c.sesionAbriendo();
  assert.deepEqual(c.conectado(), [{ tipo: 'primerMensaje', texto: '[[reconecta]] ¿y mañana qué tengo?' }]);
  // Silenciada: se reconecta callada (no se la oiría).
  c.turnoUsuario('una cosa');
  c.dobleToque();
  c.sesionAbriendo();
  assert.deepEqual(c.conectado(), []);
  assert.equal(c.estado(), 'silenciado');
  // Una llamada NUEVA no hereda nada de la anterior.
  c.colgar();
  c.listo();
  c.llamar({ tipo: 'llamame' });
  c.contestar();
  c.sesionAbriendo();
  assert.deepEqual(c.conectado(), []);
  assert.equal(mensajeReconecta(''), MENSAJE_RECONECTA);
  assert.equal(mensajeReconecta('x'.repeat(400)).length, MENSAJE_RECONECTA.length + 1 + 300);
});

prueba('ciclo: colgar corta la sesión y devuelve el oído de la mesa (con el ControlSesion y el dueño del audio reales)', () => {
  const { c } = cicloDePrueba();
  const ctl = new ControlSesion('aura', 'es');
  const ejecutar = (ef) => {
    for (const e of ef) {
      if (e.tipo === 'abrir') ctl.iniciar();
      if (e.tipo === 'cerrar') ctl.terminar();
      if (e.tipo === 'silenciar') ctl.silenciar(e.valor);
    }
  };
  // Lo que decide DeskScreen: la llamada (sonando o hablando) ocupa el micrófono; si no, la mesa.
  const dueno = () => duenoAudio({ enLlamada: false, conversacion: ctl.vista().montada || ctl.vista().dormida || llamadaActiva(c.estado()), mesaVisible: true, appActiva: true, companeraVisible: false });
  assert.equal(dueno(), 'mesa', 'en reposo, la mesa oye (su oído de siempre)');
  ejecutar(c.llamar({ tipo: 'llamame' }));
  assert.equal(dueno(), 'conversacion', 'sonando, la mesa suelta el oído (no transcribe el timbre)');
  ejecutar(c.contestar());
  ctl.alEstado(ctl.vista().gen, 'escuchando');
  ejecutar(c.conectado());
  assert.equal(ctl.vista().montada, true);
  assert.equal(dueno(), 'conversacion');
  ejecutar(c.colgar());
  assert.equal(ctl.vista().montada, false, 'la sesión de ElevenLabs se cerró');
  assert.equal(dueno(), 'mesa', 'y el oído vuelve a la mesa');
  ejecutar(c.cerrada());
  assert.equal(c.estado(), 'colgada');
});

prueba('ciclo: la app detrás cuelga; una llamada de PULSE2CHAT encima la corta; si no conecta, lo dice la mesa (con el recordatorio)', () => {
  const a = cicloDePrueba();
  a.c.llamar({ tipo: 'llamame' });
  a.c.contestar();
  a.c.conectado();
  assert.deepEqual(a.c.apagar(), [{ tipo: 'cerrar', motivo: 'segundo_plano' }]);
  assert.equal(a.c.estado(), 'colgada');
  // «Llámame» sonando con la app detrás: perdida. Un recordatorio lo sigue sonando notifee.
  const b = cicloDePrueba();
  b.c.llamar({ tipo: 'llamame' });
  assert.deepEqual(b.tipos2(b.c.apagar()), ['timbre', 'perdida']);
  const b2 = cicloDePrueba();
  b2.c.llamar(RECL);
  assert.deepEqual(b2.c.apagar(), [{ tipo: 'timbre', on: false }]);
  assert.equal(b2.c.estado(), 'sonando');
  // PULSE2CHAT: la sesión se cerró por su lado.
  const d = cicloDePrueba();
  d.c.llamar({ tipo: 'llamame' });
  d.c.contestar();
  d.c.conectado();
  assert.deepEqual(d.c.cerrada('otra_llamada'), [{ tipo: 'cerrar', motivo: 'otra_llamada' }], 'se avisa al control para que no la reabra al colgar la otra');
  assert.equal(d.c.motivo(), 'otra_llamada');
  // No conectó: la mesa dice el recordatorio con su voz.
  const e = cicloDePrueba();
  e.c.llamar(RECL);
  e.c.contestar();
  assert.deepEqual(e.c.fallo('no conectó a tiempo'), [{ tipo: 'alNativo', texto: 'Llamar a Beto', motivo: 'no conectó a tiempo' }]);
  assert.equal(e.c.estado(), 'colgada');
  assert.equal(e.c.motivo(), 'fallo');
});

prueba('ciclo: minutos — avisa antes de agotarlos, cuelga al agotarse; sin minutos «llámame» no suena y un recordatorio lo dice la mesa', () => {
  const { c, r, tipos2 } = cicloDePrueba();
  c.fijarTope(5 * 60_000);
  c.llamar({ tipo: 'llamame' });
  c.contestar();
  c.conectado();
  r.t += 3 * 60_000 - 1000;
  c.turnoUsuario('sigo');
  assert.deepEqual(c.tic(), []);
  r.t += 1000;
  assert.deepEqual(tipos2(c.tic()), ['avisoTope']);
  assert.match(avisoMinutos(2 * 60_000, 'es'), /2 minutos/);
  r.t += 2 * 60_000;
  assert.deepEqual(c.tic(), [{ tipo: 'cerrar', motivo: 'tope' }]);
  assert.equal(c.llamadaDisponible(), false);
  c.listo();
  assert.deepEqual(c.llamar({ tipo: 'llamame' }), [{ tipo: 'alNativo', texto: null, motivo: 'tope' }], 'sin minutos, «llámame» no suena');
  assert.equal(c.estado(), 'reposo');
  assert.deepEqual(tipos2(c.llamar(RECL)), ['timbre'], 'el recordatorio suena igual (tiene hora)');
  assert.deepEqual(c.contestar(), [{ tipo: 'timbre', on: false }, { tipo: 'contestada', origen: RECL }, { tipo: 'alNativo', texto: 'Llamar a Beto', motivo: 'tope' }], 'y al contestar lo dice la mesa');
  // Un 429 al abrir también cuenta.
  const b = cicloDePrueba();
  b.c.llamar({ tipo: 'llamame' });
  b.c.contestar();
  assert.equal(b.c.fallo('HTTP 429 · tope de voz')[0].motivo, 'tope');
  assert.equal(b.c.llamadaDisponible(), false);
});

prueba('ciclo (Codex P2): los minutos de «hoy» cuentan por el día de Honduras, igual que el servidor', async () => {
  const { diaHonduras: diaServidor } = await import(new URL('../../../../server/tope-voz.ts', import.meta.url).href);
  const noche = Date.UTC(2026, 8, 30, 5, 30); // 30-sep 05:30 UTC = 29-sep 23:30 en Tegucigalpa
  assert.equal(diaHonduras(noche), '2026-09-29');
  for (const t of [noche, Date.UTC(2026, 8, 30, 6, 0), Date.UTC(2026, 8, 30, 5, 59, 59), Date.UTC(2026, 11, 31, 23, 0), Date.UTC(2027, 0, 1, 6, 1), Date.UTC(2026, 2, 8, 12, 0)]) {
    assert.equal(diaHonduras(t), diaServidor(t), new Date(t).toISOString());
  }
});

prueba('ciclo (Codex P2): «sin minutos» no es para siempre — vuelve con el día nuevo de Honduras, tras la espera o con un permiso con cupo', () => {
  const agotado = (t0) => {
    const r = { t: t0 };
    const c = new CicloLlamada({ reloj: () => r.t });
    c.llamar({ tipo: 'llamame' });
    c.contestar();
    c.fallo('HTTP 429');
    assert.equal(c.llamadaDisponible(), false);
    return { c, r };
  };
  const a = agotado(Date.UTC(2026, 9, 1, 5, 50)); // 23:50 de Honduras
  a.r.t = Date.UTC(2026, 9, 1, 5, 59);
  assert.equal(a.c.llamadaDisponible(), false, '23:59 de Honduras: el mismo día, sin cupo');
  a.r.t = Date.UTC(2026, 9, 1, 6, 5);
  assert.equal(a.c.llamadaDisponible(), true, 'día nuevo de Honduras: cupo renovado');
  a.c.listo();
  assert.deepEqual(a.c.llamar({ tipo: 'llamame' }), [{ tipo: 'timbre', on: true }]);
  const b = agotado(Date.UTC(2026, 8, 30, 18, 0));
  b.r.t += 6 * 60 * 60_000;
  assert.equal(b.c.llamadaDisponible(), true);
  const d = agotado(Date.UTC(2026, 8, 30, 18, 0));
  d.c.fijarTope(4 * 60_000);
  assert.equal(d.c.llamadaDisponible(), true);
});

prueba('ciclo: lo que se ve — leyendas de la pantalla, la línea de la mesa (solo en llamada) y el cronómetro', () => {
  assert.equal(leyendaLlamada('sonando', { idioma: 'es', origen: { tipo: 'llamame' }, motivo: null, duracionMs: 0 }), 'te está llamando');
  assert.equal(leyendaLlamada('sonando', { idioma: 'es', origen: RECL, motivo: null, duracionMs: 0 }), 'Llamada de recordatorio');
  assert.equal(leyendaLlamada('en_llamada', { idioma: 'es', origen: null, motivo: null, duracionMs: 187_000 }), '3:07');
  assert.equal(leyendaLlamada('silenciado', { idioma: 'en', origen: null, motivo: null, duracionMs: 5_000 }), 'Muted · 0:05');
  assert.equal(leyendaLlamada('colgada', { idioma: 'es', origen: null, motivo: 'silencio', duracionMs: 200_000 }), 'Colgó: nadie hablaba · 3:20');
  assert.equal(leyendaLlamada('perdida', { idioma: 'es', origen: null, motivo: null, duracionMs: 0 }), 'Llamada perdida');
  assert.equal(relojLlamada(3_725_000), '1:02:05');
  assert.equal(etiquetaCiclo('reposo', 'AU-RA', 'es'), null, 'fuera de la llamada, la mesa dice lo de siempre');
  assert.deepEqual(etiquetaCiclo('en_llamada', 'AU-RA', 'es', 120_000), { texto: 'en llamada · 2 min hoy', tono: 'verde' });
  assert.equal(etiquetaCiclo('sonando', 'Claudio', 'es').texto, 'Claudio te llama…');
  assert.ok(llamadaActiva('sonando') && llamadaActiva('silenciado') && !llamadaActiva('colgada') && llamadaTerminada('perdida'));
});

prueba('ánimo: mientras hay llamada del avatar la compañera no se ve; al colgar entra CAMINANDO y saluda', () => {
  let a = ANIMO_INICIAL;
  let r = reducir(a, { tipo: 'ciclo', estado: 'sonando' }, 1000, () => 0.5);
  assert.deepEqual(r.efectos.map((e) => e.tipo), ['desaparecer']);
  assert.equal(r.animo.oculta, true);
  a = r.animo;
  for (const e of ['conectando', 'en_llamada', 'silenciado', 'en_llamada', 'colgada']) {
    r = reducir(a, { tipo: 'ciclo', estado: e }, 2000, () => 0.5);
    assert.deepEqual(r.efectos, [], `${e}: sigue sin verse (la llamada es su presencia)`);
    a = r.animo;
  }
  r = reducir(a, { tipo: 'ciclo', estado: 'reposo' }, 3000, () => 0.5);
  assert.equal(r.efectos[0].tipo, 'entrarCaminando');
  assert.equal(r.animo.oculta, false);
  // Fuera de una llamada, el doble toque dice cómo llamarla (no hay nada que silenciar).
  const d = reducir(r.animo, { tipo: 'dobleToque' }, 4000, () => 0.5);
  assert.ok(!d.efectos.some((e) => e.tipo === 'alternarVoz'));
  assert.ok(d.efectos.some((e) => e.tipo === 'globo' && /llámame|call me/i.test(e.texto)));
});

prueba('«llámame» en la mesa: lo reconoce el intérprete del teléfono (sin red), medido; «llámame Chepe» no', async () => {
  const { interpretar } = await import('../../lib/intenciones.ts');
  for (const f of ['llámame', 'Aura, llámame porfa', 'hazme una llamada', '¿me llamas?', 'call me', 'give me a call please']) {
    const t0 = performance.now();
    const i = interpretar(f);
    const ms = performance.now() - t0;
    assert.equal(i.tipo, 'llamame', f);
    assert.ok(ms < 5, `${f}: ${ms.toFixed(3)} ms`);
  }
  for (const f of ['llámame Chepe', 'llámame a Beto', 'llámame a las 5 para recordarme la pastilla', 'mi mamá me llamó ayer']) assert.notEqual(interpretar(f).tipo, 'llamame', f);
  // El teléfono le dice al servidor que sabe esta mano (así el camino rápido del servidor también la usa).
  assert.ok(MANOS_APP.includes('llamame'));
  assert.ok(esAccionApp({ tipo: 'llamame' }));
});

/* ── la voz de la mesa con la conversación en vivo (auditoría 1-oct, el mismo arreglo que la web) ── */

/** El ciclo y la sesión conectados como en el VozProvider: lo que pasa en la sesión se le cuenta al ciclo. */
function llamadaConVozMesa() {
  const { c: ciclo } = cicloDePrueba();
  const control = new ControlSesion('aura', 'es');
  const voz = { callada: false, cambios: [], alNativo: [] };
  const ejecutar = (efs) => {
    for (const ef of efs) {
      if (ef.tipo === 'abrir') control.iniciar();
      else if (ef.tipo === 'cerrar') control.terminar();
      // Lo que la mesa diría con su voz: se anota si en ese instante podía hablar.
      else if (ef.tipo === 'alNativo') voz.alNativo.push({ ...ef, mesaPodiaHablar: !voz.callada });
    }
  };
  let antes = control.vista();
  control.suscribir((v) => {
    const a = antes;
    antes = v;
    const ef = [];
    if (v.montada && v.estado === 'conectando' && (!a.montada || a.gen !== v.gen)) ef.push(...ciclo.sesionAbriendo());
    if (v.montada && (v.estado === 'escuchando' || v.estado === 'hablando') && a.estado === 'conectando') ef.push(...ciclo.conectado());
    if (!v.montada && v.estado === 'error' && (a.montada || a.estado !== 'error')) ef.push(...ciclo.fallo(v.detalle));
    else if (a.montada && !v.montada) ef.push(...ciclo.cerrada('cortada'));
    ejecutar(ef);
  });
  const off = seguirVozMesa(ciclo, control, (on) => {
    voz.callada = on;
    voz.cambios.push(on);
  });
  return { ciclo, control, voz, ejecutar, off };
}

prueba('voz de la mesa: con la conversación en vivo abierta calla (también lo que ya venía), y vuelve al colgar', () => {
  const { ciclo, control, voz, ejecutar, off } = llamadaConVozMesa();
  assert.equal(voz.callada, false, 'en reposo la mesa habla');
  assert.deepEqual(voz.cambios, [false]);
  // «Hablar»: la mesa calla en el MISMO instante en que el ciclo pasa a conectando, antes de abrir la
  // sesión (un turno en camino no alcanza a decir nada en medio).
  const ef = ciclo.hablarYa();
  assert.equal(voz.callada, true, 'conectando: la mesa ya no habla');
  ejecutar(ef);
  assert.equal(control.vista().montada, true);
  control.alEstado(control.vista().gen, 'escuchando');
  assert.equal(ciclo.estado(), 'en_llamada');
  control.alEstado(control.vista().gen, 'hablando');
  assert.equal(voz.callada, true, 'en llamada, hablando el agente: la mesa calla');
  ejecutar(ciclo.dobleToque());
  assert.equal(voz.callada, true, 'silenciada sigue siendo la llamada: la mesa no habla por su cuenta');
  ejecutar(ciclo.dobleToque());
  ejecutar(ciclo.colgar());
  assert.equal(control.vista().montada, false);
  assert.equal(voz.callada, false, 'colgó: la mesa vuelve a tener voz');
  assert.deepEqual(voz.cambios, [false, true, false], 'un solo aviso por cambio');
  // Sonando (el timbre de un recordatorio) tampoco habla encima; rechazada, vuelve.
  ciclo.tic();
  ciclo.listo();
  ciclo.llamar(RECL);
  assert.equal(voz.callada, true, 'sonando: la mesa calla');
  ciclo.rechazar();
  assert.equal(voz.callada, false, 'rechazada: la mesa vuelve');
  off();
  ciclo.llamar({ tipo: 'llamame' });
  assert.equal(voz.callada, false, 'sin seguirlos, ya no avisa');
});

prueba('voz de la mesa: una sesión montada por otro lado (sin llamada en el ciclo) también la calla', () => {
  assert.equal(mesaCallada('reposo', { montada: true }), true);
  assert.equal(mesaCallada('reposo', { montada: false }), false);
  assert.equal(mesaCallada('colgada', { montada: false }), false);
  for (const e of ['sonando', 'conectando', 'en_llamada', 'silenciado']) assert.equal(mesaCallada(e, { montada: false }), true, e);
  const { control, voz } = llamadaConVozMesa();
  control.iniciar();
  assert.equal(voz.callada, true);
});

prueba('voz de la mesa: si la conversación falla (también conectando) la mesa recupera la voz ANTES de decir por qué', () => {
  const { ciclo, control, voz, ejecutar } = llamadaConVozMesa();
  // Un recordatorio que llama: contesta y la sesión no llega a conectar (el reintento tampoco).
  ejecutar(ciclo.llamar(RECL));
  ejecutar(ciclo.contestar());
  assert.equal(voz.callada, true);
  control.alEstado(control.vista().gen, 'error', 'webrtc: ice failed');
  assert.equal(control.vista().montada, true, 'primero, un reintento: sigue siendo la llamada');
  assert.equal(voz.callada, true, 'en el reintento la mesa sigue callada');
  control.alEstado(control.vista().gen, 'error', 'webrtc: ice failed');
  assert.equal(control.vista().montada, false, 'el fallo desmonta la sesión (y con eso ModoConversacion la cuelga)');
  assert.equal(ciclo.estado(), 'colgada');
  assert.equal(voz.callada, false);
  assert.equal(voz.alNativo.length, 1, 'el recordatorio lo dice la mesa');
  assert.equal(voz.alNativo[0].texto, RECL.texto);
  assert.equal(voz.alNativo[0].mesaPodiaHablar, true, 'cuando lo pide el ciclo, la mesa ya tiene voz');
});

prueba('su computadora en la app: estado, pasos en palabras, sondeo y el aviso de la mesa (José, 2-oct)', () => {
  const base = { configurada: true, ok: true, motores: ['holo'], ocupada: false, ultima: null, actual: null };
  assert.equal(estadoEnPalabras(null).tono, 'espera');
  assert.match(estadoEnPalabras({ ...base, configurada: false }).texto, /no está conectada/);
  assert.match(estadoEnPalabras({ ...base, ok: false }).texto, /No contesta/);
  assert.equal(estadoEnPalabras(base).texto, 'Lista para trabajar');
  const trabajandoYa = { id: 't1', estado: 'trabajando', pasos: 3, instruccion: 'x', ultimo: 'Abrió es.wikipedia.org' };
  assert.equal(estadoEnPalabras({ ...base, actual: trabajandoYa }).tono, 'trabaja');
  assert.ok(pcTrabajando('en_cola') && pcTrabajando('trabajando') && !pcTrabajando('hecha'));
  assert.ok(sondeoMs('trabajando', true) < sondeoMs('hecha', true), 'mientras trabaja se renueva rápido');
  assert.ok(sondeoMs('hecha', false) >= 15000, 'sin trabajo, la mesa pregunta despacio');
  const pasos = [{ n: 1, t: 1, accion: 'escritorio_limpio', texto: 'Abrió un escritorio limpio' }, { n: 2, t: 5, accion: 'open_url', texto: 'Abrió es.wikipedia.org' }];
  assert.equal(tareaEnPalabras({ estado: 'trabajando', pasos, error: null }), 'Paso 1 · Abrió es.wikipedia.org');
  assert.equal(tareaEnPalabras({ estado: 'hecha', pasos: [...pasos, { n: 3, t: 9, accion: 'answer' }], error: null }), 'Lista en 1 pasos');
  assert.equal(tareaEnPalabras({ estado: 'fallo', pasos, error: 'sin red' }), 'Falló: sin red');
  // El aviso de la mesa: mientras trabaja dice en qué va; al terminar, «terminó» una vez; antes de nada, nada.
  assert.equal(avisoMesa(null, null), null);
  assert.deepEqual(avisoMesa(null, trabajandoYa), { texto: 'Su computadora · Abrió es.wikipedia.org', terminada: false });
  const hecha = { ...trabajandoYa, estado: 'hecha' };
  assert.deepEqual(avisoMesa(trabajandoYa, hecha), { texto: 'Su computadora terminó · ver el resultado', terminada: true });
  assert.equal(avisoMesa(hecha, hecha), null, 'no se repite');
  assert.equal(avisoMesa(null, hecha), null, 'una vieja al abrir la app no se anuncia');
  for (const e of EJEMPLOS_PC) assert.ok(e.es.length > 20 && e.en.length > 20 && /\.(org|hn|com)| Google/.test(e.es), 'cada ejemplo dice la página');
});

prueba('su computadora en vivo: se abre sola, teclea, cuenta avances sin hablar encima y dice el resultado (José, 2-oct)', () => {
  // Los avisos que manda el servidor (server/computadora.ts) los acepta el puente; lo mal formado, no.
  assert.ok(esAccionApp({ tipo: 'computadora', fase: 'empieza', id: 'g1' }));
  assert.ok(esAccionApp({ tipo: 'computadora', fase: 'termina', id: 'g1', ok: true, texto: 'Listo.', boleto: 'abcdEFGH1234' }));
  assert.ok(!esAccionApp({ tipo: 'computadora', fase: 'bailar', id: 'g1' }));
  assert.ok(!esAccionApp({ tipo: 'computadora', fase: 'paso', id: 'g 1' }));
  assert.ok(!esAccionPc({ tipo: 'computadora', fase: 'paso', id: 'g1', texto: '' }));
  // Las pantallas de más, desde cualquier pantalla.
  for (const p of ['computadora', 'whatsapp', 'correos']) assert.ok(esAccionApp({ tipo: 'abrir', pantalla: p }), p);
  assert.ok(!esAccionApp({ tipo: 'abrir', pantalla: 'banco' }));

  let ahora = 1_000_000;
  const relojes = [];
  const esperar = (f, ms) => {
    const r = { f, en: ahora + ms, vivo: true };
    relojes.push(r);
    return () => (r.vivo = false);
  };
  const avanzar = (ms) => {
    const fin = ahora + ms;
    for (;;) {
      const r = relojes.filter((x) => x.vivo && x.en <= fin).sort((a, b) => a.en - b.en)[0];
      if (!r) break;
      ahora = r.en;
      r.vivo = false;
      r.f();
    }
    ahora = fin;
  };
  const vistas = [];
  const dichos = [];
  const sonidos = [];
  let ocupado = false;
  let enLlamada = false;
  const c = new CompaneroPc({
    abrirVista: (id) => vistas.push(id),
    puedeAbrir: () => !enLlamada,
    decir: (texto, boleto) => dichos.push({ texto, boleto }),
    sonido: (on) => sonidos.push(on),
    ocupado: () => ocupado,
    esperar,
    reloj: () => ahora,
  });
  c.alAccion({ tipo: 'computadora', fase: 'empieza', id: 'g1' });
  assert.deepEqual(vistas, ['g1'], 'la vista en vivo se abre sola');
  assert.deepEqual(sonidos, [true], 'y suena el tecleo');
  assert.equal(c.trabajando, true);
  c.alAccion({ tipo: 'computadora', fase: 'paso', id: 'g1', texto: 'Ya entré a bch.hn.', boleto: 'b1b1b1b1b1' });
  assert.deepEqual(dichos, [{ texto: 'Ya entré a bch.hn.', boleto: 'b1b1b1b1b1' }]);
  // Otro avance enseguida: no (nunca dos seguidas).
  avanzar(MIN_ENTRE_FRASES_MS - 1000);
  c.alAccion({ tipo: 'computadora', fase: 'paso', id: 'g1', texto: 'Estoy leyendo la página.', boleto: 'b2b2b2b2b2' });
  assert.equal(dichos.length, 1);
  assert.equal(c.ultimaFrase, 'Estoy leyendo la página.', 'la vista la muestra igual');
  // La persona habla: los avances esperan.
  avanzar(5000);
  c.personaHablo();
  c.alAccion({ tipo: 'computadora', fase: 'paso', id: 'g1', texto: 'Analizando los resultados…', boleto: 'b3b3b3b3b3' });
  assert.equal(dichos.length, 1, 'no se le habla encima a la persona');
  avanzar(PAUSA_TRAS_PERSONA_MS);
  ocupado = true; // AURA está hablando de otra cosa
  c.alAccion({ tipo: 'computadora', fase: 'paso', id: 'g1', texto: 'Sigo navegando.', boleto: 'b4b4b4b4b4' });
  assert.equal(dichos.length, 1, 'ni encima de AURA');
  ocupado = false;
  c.alAccion({ tipo: 'computadora', fase: 'paso', id: 'g1', texto: 'Toqué «Tipo de cambio».', boleto: 'b5b5b5b5b5' });
  assert.equal(dichos.length, 2);
  // La persona cierra la vista; la misión sigue con otra tarea: no se la vuelve a abrir, pero se cuenta.
  c.vistaCerrada();
  avanzar(MIN_ENTRE_FRASES_MS);
  c.alAccion({ tipo: 'computadora', fase: 'sigue', id: 'g2', texto: 'Me falta un poco; sigo con la misión.', boleto: 'b6b6b6b6b6' });
  assert.deepEqual(vistas, ['g1'], 'cerró la vista: no se le abre otra vez');
  assert.equal(c.tareaId, 'g2');
  assert.equal(dichos.at(-1).texto, 'Me falta un poco; sigo con la misión.');
  // El resultado: espera a que haya silencio y lo dice; el tecleo se apaga.
  ocupado = true;
  c.alAccion({ tipo: 'computadora', fase: 'termina', id: 'g2', ok: true, texto: 'Listo, ya terminé en mi computadora. Compra 24.70.', boleto: 'b7b7b7b7b7' });
  assert.equal(c.trabajando, false);
  assert.equal(sonidos.at(-1), false, 'se apaga el tecleo');
  assert.equal(dichos.at(-1).texto, 'Me falta un poco; sigo con la misión.', 'todavía no: alguien habla');
  avanzar(2000);
  ocupado = false;
  avanzar(600);
  assert.deepEqual(dichos.at(-1), { texto: 'Listo, ya terminé en mi computadora. Compra 24.70.', boleto: 'b7b7b7b7b7' });
  // Aunque sigan hablando, al tope se dice igual.
  ocupado = true;
  c.alAccion({ tipo: 'computadora', fase: 'termina', id: 'g2', ok: false, texto: 'No alcancé a terminar.', boleto: 'b8b8b8b8b8' });
  avanzar(FINAL_ESPERA_MAX_MS + 600);
  assert.equal(dichos.at(-1).texto, 'No alcancé a terminar.');
  ocupado = false;
  // Una nueva tarea con una llamada de PULSE2CHAT: no se le abre nada encima.
  enLlamada = true;
  c.alAccion({ tipo: 'computadora', fase: 'empieza', id: 'g3' });
  assert.deepEqual(vistas, ['g1']);
  // Sin noticias: el tecleo no se queda sonando para siempre.
  avanzar(TOPE_TRABAJO_MS + 1);
  assert.equal(c.trabajando, false);
  assert.equal(sonidos.at(-1), false);
  // El sondeo ve que terminó aunque el aviso se perdiera; y la misión que siguió sin avisar.
  c.alAccion({ tipo: 'computadora', fase: 'empieza', id: 'g4' });
  c.alEstado('g5', true);
  assert.equal(c.tareaId, 'g5');
  c.alEstado('g5', false);
  assert.equal(c.trabajando, false);
});

prueba('su computadora: una respuesta vieja no vuelve a la tarea de antes, el sí nombra su pregunta y encargar lleva su id (auditoría 3-oct, PC05/PC01/PC04)', () => {
  const v = new VistaPc();
  // Mira la tarea t1; sale un GET de t1 (y uno del estado general).
  v.elegir('t1');
  const deT1 = v.boleto();
  const estadoViejo = v.boleto();
  // Mientras iban, encarga otra: la vista pasa a t2.
  assert.equal(v.elegir('t2'), true);
  assert.equal(v.acepta(deT1, 't1', 10), false, 'la respuesta de t1 ya no se pinta');
  assert.equal(v.puedeCambiar(estadoViejo), false, 'el estado viejo (ultima: t1) no cambia la tarea elegida');
  assert.equal(v.id, 't2');
  // Las de t2: la más nueva gana aunque llegue primero; la vieja que llega tarde no la pisa.
  const a = v.boleto();
  const b = v.boleto();
  assert.equal(v.acepta(b, 't2', 200), true);
  assert.equal(v.acepta(a, 't2', 100), false, 'versión menor: llegó tarde');
  assert.equal(v.acepta(v.boleto(), 't2', 300), true);
  assert.equal(v.acepta(v.boleto(), 't2'), true, 'un servidor sin versión: se pinta como antes');
  assert.equal(v.elegir('t2'), false, 'elegir la misma no cambia la época');
  // AUR04: un final no se reabre. Una respuesta con versión mayor pero estado vivo viejo (salió antes del final) no
  // vuelve a poner «pausada» sobre «hecha»; otra tarea no se contagia.
  assert.equal(v.acepta(v.boleto(), 't2', 400, 'hecha'), true);
  assert.equal(v.terminada('t2'), true);
  assert.equal(v.acepta(v.boleto(), 't2', 500, 'pausada'), false, 'hecha → pausada no');
  assert.equal(v.acepta(v.boleto(), 't2', 600, 'parada'), true, 'un final sí se pinta (el del servidor manda)');
  v.elegir('t3');
  assert.equal(v.acepta(v.boleto(), 't3', 700, 'trabajando'), true);
  assert.equal(v.terminada('t3'), false);
  // El estado general: también por versión.
  assert.equal(v.aceptaEstado(50), true);
  assert.equal(v.aceptaEstado(40), false);
  assert.equal(v.aceptaEstado(undefined), true);
  // El sí lleva la pregunta que vio (la de la misión; si no, la de la tarea).
  assert.deepEqual(respuestaPc(true, { preguntaId: 'p2' }, { pregunta_id: 'p1' }), { si: true, preguntaId: 'p2' });
  assert.deepEqual(respuestaPc(false, null, { pregunta_id: 'p1' }), { si: false, preguntaId: 'p1' });
  assert.deepEqual(respuestaPc(true, null, null), { si: true });
  // Revisión 4-oct: la huella de la propuesta va con su pregunta, de la misma fuente (nunca la de otra).
  assert.deepEqual(respuestaPc(true, { preguntaId: 'p2', propuesta: 'h2' }, { pregunta_id: 'p1', propuesta: 'h1' }), { si: true, preguntaId: 'p2', propuesta: 'h2' });
  assert.deepEqual(respuestaPc(true, { preguntaId: 'p2' }, { pregunta_id: 'p1', propuesta: 'h1' }), { si: true, preguntaId: 'p2' });
  assert.deepEqual(respuestaPc(true, null, { pregunta_id: 'p1', propuesta: 'h1' }), { si: true, preguntaId: 'p1', propuesta: 'h1' });
  // Cada encargo, su id (el servidor lo acepta: letras, números y . _ : -; de 8 a 80).
  const p1 = nuevoPedidoPc();
  assert.match(p1, /^[A-Za-z0-9._:-]{8,80}$/);
  assert.notEqual(nuevoPedidoPc(), p1);
});

prueba('su computadora como un agente: plan, tu sí antes de algo sensible, pausa y control, resultado para compartir (José, 2-oct: «como Grok, el agente de ChatGPT»)', () => {
  // Los avisos nuevos del servidor: bien formados pasan; lo raro, no.
  assert.ok(esAccionPc({ tipo: 'computadora', fase: 'empieza', id: 'g1', plan: ['Entrar a bch.hn', 'Darte el resultado'] }));
  assert.ok(esAccionPc({ tipo: 'computadora', fase: 'confirmar', id: 'g1', pregunta: '¿Envío el formulario?', texto: 'Antes de seguir necesito tu sí.', boleto: 'abcdEFGH1234' }));
  assert.ok(esAccionPc({ tipo: 'computadora', fase: 'pausa', id: 'g1', estado: 'control' }));
  assert.ok(esAccionPc({ tipo: 'computadora', fase: 'reanuda', id: 'g1' }));
  assert.ok(esAccionApp({ tipo: 'computadora', fase: 'confirmar', id: 'g1', pregunta: '¿Lo hago?' }), 'el puente de acciones también los deja pasar');
  assert.ok(!esAccionPc({ tipo: 'computadora', fase: 'empieza', id: 'g1', plan: [] }));
  assert.ok(!esAccionPc({ tipo: 'computadora', fase: 'empieza', id: 'g1', plan: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }));
  assert.ok(!esAccionPc({ tipo: 'computadora', fase: 'pausa', id: 'g1', estado: 'dormida' }));
  assert.ok(!esAccionPc({ tipo: 'computadora', fase: 'confirmar', id: 'g1', pregunta: '' }));
  // Vivas pero quietas: siguen vivas (la vista y la mesa las muestran), pero sin tecleo.
  for (const e of ['pausada', 'confirmar', 'control']) assert.ok(pcTrabajando(e) && pcQuieta(e) && !pcEnMarcha(e), e);
  assert.ok(pcEnMarcha('trabajando') && !pcQuieta('trabajando') && !pcTrabajando('parada'));
  const base = { configurada: true, ok: true, motores: ['holo'], ocupada: true, ultima: 'g1' };
  const actual = (estado) => ({ ...base, actual: { id: 'g1', estado, pasos: 2, instruccion: 'x', ultimo: null } });
  assert.equal(estadoEnPalabras(actual('confirmar')).texto, 'Espera tu sí');
  assert.equal(estadoEnPalabras(actual('pausada')).texto, 'En pausa');
  assert.equal(estadoEnPalabras(actual('control'), 'en').texto, 'You have control');
  assert.equal(tareaEnPalabras({ estado: 'confirmar', pasos: [], error: null }), 'Espera tu sí para seguir');
  assert.deepEqual(avisoMesa(null, actual('confirmar').actual), { texto: 'Su computadora espera tu sí · ver', terminada: false });
  // El reloj, las marcas del plan, el toque en la pantalla (en [0, 1000]) y cómo terminó.
  assert.deepEqual([0, 42, 725, 3729].map((x) => relojMision(x)), ['0:00', '0:42', '12:05', '1:02:09']);
  assert.deepEqual(['hecho', 'actual', 'espera', 'pendiente', 'fallo'].map(marcaPlan), ['✓', '●', 'Ⅱ', '○', '✕']);
  assert.deepEqual(aCoordenadas(160, 50, 320, 200), { x: 500, y: 250 });
  assert.deepEqual(aCoordenadas(-5, 999, 320, 200), { x: 0, y: 1000 });
  assert.equal(finalEnPalabras({ estado: 'hecha', ok: true }), 'Listo');
  assert.equal(finalEnPalabras({ estado: 'parada', ok: false }), 'Detenida');
  assert.equal(finalEnPalabras({ estado: 'sin_pasos', ok: false }), 'A medias');
  assert.equal(haceCuanto(1_000_000, 1_000_000 + 5 * 60_000), 'hace 5 min');
  // Los mandos: con el servicio nuevo, Pausar / Seguir / Tomar el control / Devolver; con el viejo solo Detener y se explica.
  const caps = ['pausar', 'confirmar', 'control'];
  assert.deepEqual(controlesPc(caps, 'trabajando'), { detener: true, pausar: true, seguir: false, tomar: true, devolver: false, contestar: false, faltaActualizar: false });
  assert.deepEqual(controlesPc(caps, 'pausada'), { detener: true, pausar: false, seguir: true, tomar: true, devolver: false, contestar: false, faltaActualizar: false });
  assert.deepEqual(controlesPc(caps, 'control'), { detener: true, pausar: false, seguir: false, tomar: false, devolver: true, contestar: false, faltaActualizar: false });
  assert.equal(controlesPc(caps, 'confirmar').contestar, true);
  assert.deepEqual(controlesPc([], 'trabajando'), { detener: true, pausar: false, seguir: false, tomar: false, devolver: false, contestar: false, faltaActualizar: true });
  assert.equal(controlesPc(caps, 'hecha').detener, false, 'terminada: no hay nada que detener');
  // Compartir: la misión, lo que encontró, los datos que no estaban en el texto y los enlaces.
  const compartido = textoParaCompartir('Entra a bch.hn y dime el dólar', { ok: true, respuesta: 'Compra: 24.70. Venta: 24.95.', error: null, datos: [{ clave: 'Compra', valor: '24.70' }, { clave: 'Fecha', valor: '2 de octubre' }], enlaces: ['https://www.bch.hn/tipo-de-cambio'] });
  assert.equal(compartido, '«Entra a bch.hn y dime el dólar»\n\nCompra: 24.70. Venta: 24.95.\n\nFecha: 2 de octubre\n\nhttps://www.bch.hn/tipo-de-cambio\n\n— desde la computadora de AU-RA');
  assert.match(textoParaCompartir('x', { ok: false, respuesta: null, error: 'sin red', datos: [], enlaces: [] }), /No terminó: sin red\./);

  // El compañero: el plan al empezar (encargada desde la app lo dice), la pregunta abre la vista y calla el
  // tecleo, el sí la reanuda, la pausa y el control también callan, y quieta no se apaga a los 6 minutos.
  let ahora = 1_000_000;
  const relojes = [];
  const esperar = (f, ms) => {
    const r = { f, en: ahora + ms, vivo: true };
    relojes.push(r);
    return () => (r.vivo = false);
  };
  const avanzar = (ms) => {
    const fin = ahora + ms;
    for (;;) {
      const r = relojes.filter((x) => x.vivo && x.en <= fin).sort((a, b) => a.en - b.en)[0];
      if (!r) break;
      ahora = r.en;
      r.vivo = false;
      r.f();
    }
    ahora = fin;
  };
  const vistas = [];
  const dichos = [];
  const sonidos = [];
  const c = new CompaneroPc({ abrirVista: (id) => vistas.push(id), puedeAbrir: () => true, decir: (texto, boleto) => dichos.push({ texto, boleto }), sonido: (on) => sonidos.push(on), ocupado: () => false, esperar, reloj: () => ahora });
  c.alAccion({ tipo: 'computadora', fase: 'empieza', id: 'm1', plan: ['Entrar a sar.gob.hn', 'Llenar el formulario', 'Darte el resultado'], texto: 'Va. Mi plan: entrar a sar.gob.hn, llenar el formulario y darte el resultado.', boleto: 'p1p1p1p1p1' });
  assert.deepEqual(c.plan, ['Entrar a sar.gob.hn', 'Llenar el formulario', 'Darte el resultado']);
  assert.deepEqual(dichos.at(-1), { texto: 'Va. Mi plan: entrar a sar.gob.hn, llenar el formulario y darte el resultado.', boleto: 'p1p1p1p1p1' });
  assert.deepEqual(sonidos, [true]);
  c.vistaCerrada(); // la cerró… pero una pregunta es para ella: se le abre otra vez
  c.alAccion({ tipo: 'computadora', fase: 'confirmar', id: 'm1', pregunta: 'Voy a tocar «Enviar». ¿Lo hago?', texto: 'Antes de seguir necesito tu sí. Voy a tocar «Enviar». ¿Lo hago? Dime sí o no.', boleto: 'q1q1q1q1q1' });
  assert.deepEqual(vistas, ['m1', 'm1'], 'se abre con los botones');
  assert.equal(c.quieta, 'confirmar');
  assert.equal(c.pregunta, 'Voy a tocar «Enviar». ¿Lo hago?');
  assert.equal(sonidos.at(-1), false, 'esperando su sí no suena el tecleo');
  assert.equal(dichos.at(-1).texto, 'Antes de seguir necesito tu sí. Voy a tocar «Enviar». ¿Lo hago? Dime sí o no.');
  avanzar(TOPE_TRABAJO_MS + 1000);
  assert.equal(c.trabajando, true, 'quieta esperando su sí no se da por muerta a los 6 minutos');
  c.alAccion({ tipo: 'computadora', fase: 'reanuda', id: 'm1' });
  assert.equal(c.quieta, null);
  assert.equal(c.pregunta, null, 'se quitan los botones');
  assert.equal(sonidos.at(-1), true, 'vuelve el tecleo');
  c.alAccion({ tipo: 'computadora', fase: 'pausa', id: 'm1', estado: 'control', texto: 'Listo, la computadora es tuya.', boleto: 'c1c1c1c1c1' });
  assert.equal(c.quieta, 'control');
  assert.equal(sonidos.at(-1), false);
  assert.equal(dichos.at(-1).texto, 'Listo, la computadora es tuya.', 'AURA lo dice aunque acabe de hablar: lo pidió la persona');
  c.alAccion({ tipo: 'computadora', fase: 'pausa', id: 'otra', estado: 'pausada' });
  assert.equal(c.quieta, 'control', 'el aviso de otra tarea no toca esta');
  // El sondeo ve que volvió a avanzar aunque el «reanuda» se perdiera.
  c.alEstado('m1', true, 'trabajando');
  assert.equal(c.quieta, null);
  assert.equal(sonidos.at(-1), true);
  c.alEstado('m1', true, 'pausada');
  assert.equal(c.quieta, 'pausada');
  avanzar(TOPE_QUIETA_MS + 1000);
  assert.equal(c.trabajando, false, 'tampoco para siempre: al tope de lo quieto se apaga');
  // Detener: termina sin texto (lo pidió la persona); todo limpio.
  c.alAccion({ tipo: 'computadora', fase: 'empieza', id: 'm2' });
  c.alAccion({ tipo: 'computadora', fase: 'termina', id: 'm2', ok: false });
  assert.deepEqual({ trabajando: c.trabajando, quieta: c.quieta, pregunta: c.pregunta }, { trabajando: false, quieta: null, pregunta: null });
});

for (const [nombre, f] of pruebas) {
  n += 1;
  try {
    await f();
    console.log(`ok    ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`FALLA ${nombre}\n      ${e?.message || e}`);
  }
}
console.log(`\n${n - fallos}/${n} pruebas bien`);
process.exit(fallos ? 1 : 0);
