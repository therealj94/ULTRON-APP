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
import { PuenteAcciones, ContextoApp, esAccionApp, accionesDelTurno, accionNueva, depurarContactos } from '../acciones.ts';
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

prueba('contexto: pantalla, borrador de AURA y contactos (solo nombre y correo), nunca mensajes', async () => {
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
  emitir('accion', { tipo: 'redactar', para: 'Mamá', texto: 'Llego tarde' });
  await dormir(20);
  let u = enviados[enviados.length - 1];
  assert.equal(u.pantalla, 'chats');
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
