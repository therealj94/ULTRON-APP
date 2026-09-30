/**
 * Pruebas en Node de la lógica de la compañera (sin teléfono):
 *   la máquina de la sesión (generaciones, silencio, segundo plano, llamadas, reintento), el permiso
 *   precalentado, el ánimo, los gestos, los bordes, el lector SSE, el puente de acciones contra un
 *   servidor HTTP falso (con un XMLHttpRequest hecho sobre http), el contexto y la emoción del texto.
 *
 *   cd mobile && npx tsx src/compa/pruebas/compa.prueba.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { ControlSesion } from '../sesion.ts';
import { Precalentador } from '../permiso.ts';
import { coordinarLlamadas } from '../llamada.ts';
import { ANIMO_INICIAL, expresion, puedeCaminar, reducir } from '../animo.ts';
import { Gestos } from '../gestos.ts';
import { pegarABorde, reubicar, yCarril, limitar, destinoPaseo, lugarGlobo } from '../borde.ts';
import { LectorSse } from '../sse.ts';
import { PuenteAcciones, ContextoApp, esAccionApp, accionesDelTurno, accionNueva, depurarContactos, VENTANA_MISMA_ACCION_MS, mensajeDeLectura, decirLectura, mensajeDeRecordatorio, decirRecordatorio } from '../acciones.ts';
import * as REC from '../recordatorios.ts';
import { programarRecordatorio, _olvidarRecordatorios, CANAL_RECORDATORIOS } from '../recordatorios.ts';
// Del servidor (lib/manos-app.ts), con import dinámico: el typecheck de la app (mobile/tsconfig, que
// incluye estas pruebas) no debe seguir hasta el código del servidor y sus dependencias (undici).
const { RE_LECTURA, turnoDeRecordatorio } = await import(new URL('../../../../lib/manos-app.ts', import.meta.url).href);
import { MANOS_APP } from '../../nucleo/contrato.ts';
import { AudioVoz } from '../audioVoz.ts';
import { FIGURAS, mezclarFigura, estiloDe } from '../figura.ts';
import { emocionDeTexto } from '../../lib/emocion.ts';
import { emitir, escuchar } from '../../nucleo/contrato.ts';

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

prueba('ánimo: doble toque duerme (silencio de verdad) y otro la despierta', () => {
  let a = reducir(ANIMO_INICIAL, { tipo: 'voz', voz: vozAbierta }, 0).animo;
  let r = reducir(a, { tipo: 'dobleToque' }, 10);
  assert.ok(tipos(r.efectos).includes('alternarVoz'));
  assert.ok(r.efectos.some((e) => e.tipo === 'globo' && /zzz/i.test(e.texto)));
  a = reducir(r.animo, { tipo: 'voz', voz: { ...vozAbierta, silenciada: true } }, 20).animo;
  assert.equal(expresion(a, 30), 'dormida');
  assert.equal(puedeCaminar(a, 30), false);
  r = reducir(a, { tipo: 'dobleToque' }, 40);
  assert.ok(tipos(r.efectos).includes('alternarVoz'));
  assert.ok(r.efectos.some((e) => e.tipo === 'globo' && /escucho|listening/i.test(e.texto)));
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
  assert.deepEqual([...c.manos], ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada']);
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

prueba('emoción del texto (conversación fluida)', () => {
  assert.equal(emocionDeTexto('¡Jajaja, qué bueno!'), 'risa');
  assert.equal(emocionDeTexto('Lo siento mucho, de verdad'), 'triste');
  assert.equal(emocionDeTexto('¡Listo! Ya se lo envié'), 'feliz');
  assert.equal(emocionDeTexto('¿A quién se lo mando?'), 'curioso');
  assert.equal(emocionDeTexto('Wow, no me digas'), 'sorpresa');
  assert.equal(emocionDeTexto('Son las tres'), 'neutral');
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
