/**
 * AUR10 · guards de generación y contador de recursos de la llamada del avatar (dobles deterministas).
 *
 * Huecos que quedaban tras los arreglos anteriores (y que estas pruebas reproducen):
 *   1. Los niveles del micrófono no llevaban generación: el intervalo de una sesión vieja que todavía
 *      latía mantenía «viva» la vigilancia de la nueva (ni «sorda» ni «sin muestras»).
 *   2. El reintento del primer mensaje (un recordatorio, «¿sigues ahí?», la reconexión) salía 600 ms
 *      después sin mirar de qué sesión era: si en medio se colgó y se abrió otra, el texto viejo entraba
 *      en la llamada nueva.
 *   3. Un `onConnect` que llega después de desmontarse la sesión no la vuelve a abrir (se cuelga).
 *
 * Y el contador: al colgar en CUALQUIER fase (esperando el permiso, conectando, conectada hablando, tras
 * un error) los timers, las conexiones, las pistas y los oyentes vuelven a cero; lo que llega tarde de
 * esa sesión no toca la UI, el audio ni el estado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlSesion } from '../mobile/src/compa/sesion';
import { mandarAlAgente } from '../mobile/src/compa/llamadaCiclo';
import { ContadorRecursos } from '../mobile/src/compa/recursos';
import { abrirSesionVoz, type ConvMin, type OpcionesConv } from '../mobile/src/compa/sesionVoz';

/* ── 1. los niveles de una sesión vieja no cuentan ─────────────────────────────────────────── */

test('niveles de una generación vieja no tapan la sordera de la nueva', () => {
  let ahora = 0;
  const c = new ControlSesion('aura', 'es', { reloj: () => ahora, sordaMs: 1_000 });
  c.iniciar();
  const g1 = c.vista().gen;
  c.alEstado(g1, 'escuchando');
  c.alEstado(g1, 'error', 'se cayó');
  const g2 = c.vista().gen;
  assert.equal(g2, g1 + 1, 'reconectó con otra generación');
  c.alEstado(g2, 'escuchando');
  // El intervalo de la sesión vieja sigue latiendo un rato con voz (sin lectura cruda).
  for (let t = 0; t <= 1_200; t += 100) {
    ahora = t;
    c.entrada(0.4, undefined, g1);
  }
  assert.equal(c.revisar(), 'sorda', 'la nueva no oyó nada: lo de la vieja no cuenta');
});

test('lecturas crudas de una generación vieja no mantienen viva la pista de la nueva', () => {
  let ahora = 0;
  const c = new ControlSesion('aura', 'es', { reloj: () => ahora, sinMuestrasMs: 1_000, reintentos: 0 });
  c.iniciar();
  const g1 = c.vista().gen;
  c.alEstado(g1, 'escuchando');
  c.entrada(0, 0.2, g1);
  // Se reabre (otra generación) y la nueva manda un valor congelado; la vieja sigue mandando valores que cambian.
  c.terminar();
  c.iniciar();
  const g2 = c.vista().gen;
  c.alEstado(g2, 'escuchando');
  c.entrada(0, 0.3, g2);
  for (let t = 0; t <= 1_200; t += 50) {
    ahora = t;
    c.entrada(0.1, 0.1 + t / 10_000, g1);
    c.entrada(0.1, 0.3, g2);
  }
  assert.equal(c.revisar(), 'sin-muestras', 'la pista nueva está congelada: la vieja no la disimula');
});

/* ── 2. el reintento del primer mensaje no cruza de sesión ─────────────────────────────────── */

function relojFalso() {
  let ahora = 0;
  let timers: Array<{ id: number; at: number; f: () => void }> = [];
  let n = 0;
  return {
    esperar: (f: () => void, ms: number) => {
      const id = ++n;
      timers.push({ id, at: ahora + ms, f });
      return () => void (timers = timers.filter((t) => t.id !== id));
    },
    avanzar(ms: number) {
      ahora += ms;
      for (const t of timers.filter((x) => x.at <= ahora)) {
        timers = timers.filter((x) => x.id !== t.id);
        t.f();
      }
    },
    vivos: () => timers.length,
  };
}

test('el reintento del primer mensaje no entra en otra sesión; colgar lo cancela', () => {
  const r = relojFalso();
  let sesion = 1;
  const enviados: Array<[number, string]> = [];
  const fallidos: string[] = [];
  let conectada = false;
  const enviar = (t: string) => (conectada ? (enviados.push([sesion, t]), true) : false);
  // Sesión 1: recién conectada, el control todavía no está: se reintenta.
  const deLa1 = 1;
  mandarAlAgente('[[recordatorio]] pastilla', { enviar, vigente: () => sesion === deLa1, esperar: r.esperar, alFallar: (t) => fallidos.push(t) });
  // En medio se colgó y se abrió otra llamada (sesión 2), ya conectada.
  sesion = 2;
  conectada = true;
  r.avanzar(600);
  assert.deepEqual(enviados, [], 'nada de la sesión 1 entra en la 2');
  assert.deepEqual(fallidos, ['[[recordatorio]] pastilla'], 'se cuenta como no entregado (la mesa lo dice si puede)');
  // Y si se cuelga antes del reintento, el reintento se cancela: cero timers.
  conectada = false;
  const cancelar = mandarAlAgente('[[sigues]]', { enviar, vigente: () => sesion === 2, esperar: r.esperar, alFallar: (t) => fallidos.push(t) });
  assert.equal(r.vivos(), 1);
  cancelar();
  assert.equal(r.vivos(), 0);
  r.avanzar(1_000);
  assert.deepEqual(enviados, []);
  // En la misma sesión, el reintento sí sale.
  mandarAlAgente('[[reconecta]]', { enviar, vigente: () => sesion === 2, esperar: r.esperar, alFallar: (t) => fallidos.push(t) });
  conectada = true;
  r.avanzar(600);
  assert.deepEqual(enviados, [[2, '[[reconecta]]']]);
});

/* ── 3. el contador de recursos de una sesión de voz ───────────────────────────────────────── */

/** El SDK de ElevenLabs de mentira: cuenta conexiones, pistas (micrófono y altavoz) y oyentes vivos. */
function sdkFalso(o: { conectaSolo?: boolean } = {}) {
  const r = { conexiones: 0, pistas: 0, oyentes: 0, finesPedidos: 0, volumen: [] as number[] };
  let ops: OpcionesConv | null = null;
  let estado: 'nada' | 'conectando' | 'conectada' | 'cerrada' = 'nada';
  const desconectar = () => {
    if (estado === 'conectada') r.pistas -= 2;
    if (estado === 'conectada' || estado === 'conectando') r.conexiones -= 1;
    const cb = ops;
    if (estado !== 'nada' && estado !== 'cerrada') r.oyentes -= 1;
    estado = 'cerrada';
    cb?.onDisconnect?.();
  };
  const conv: ConvMin = {
    startSession: (x) => {
      ops = x;
      estado = 'conectando';
      r.conexiones += 1;
      r.oyentes += 1;
      if (o.conectaSolo) sdk.conectar();
    },
    // Como el SDK de verdad: el fin se pide al momento y la desconexión (onDisconnect) llega después.
    endSession: () => {
      r.finesPedidos += 1;
      setImmediate(() => {
        if (estado === 'conectando' || estado === 'conectada') desconectar();
      });
    },
    setVolume: ({ volume }) => void r.volumen.push(volume),
    getOutputVolume: () => (estado === 'conectada' ? 0.5 : 0),
    getInputVolume: () => (estado === 'conectada' ? 0.2 : 0),
    getOutputByteFrequencyData: () => new Uint8Array(8),
  };
  const sdk = {
    conv,
    r,
    conectar() {
      if (estado !== 'conectando') return;
      estado = 'conectada';
      r.pistas += 2;
      ops?.onConnect?.();
    },
    /** Eventos que llegan cuando sea (también tarde). */
    ops: () => ops,
    error(m: string) {
      ops?.onError?.(m);
    },
  };
  return sdk;
}

/** Timers de mentira contados (setInterval/clearInterval). */
function timersFalsos() {
  const vivos = new Map<number, () => void>();
  let n = 0;
  return {
    intervalo: (f: () => void) => {
      const id = ++n;
      vivos.set(id, f);
      return id;
    },
    limpiar: (id: unknown) => void vivos.delete(id as number),
    latir: () => [...vivos.values()].forEach((f) => f()),
    vivos: () => vivos.size,
  };
}

function montar(o: { permiso?: Promise<{ token: string; pase: string }>; conectaSolo?: boolean } = {}) {
  const sdk = sdkFalso({ conectaSolo: o.conectaSolo });
  const t = timersFalsos();
  const recursos = new ContadorRecursos();
  const eventos: string[] = [];
  let resolverPermiso!: (v: { token: string; pase: string }) => void;
  const permiso = o.permiso || new Promise<{ token: string; pase: string }>((r) => (resolverPermiso = r));
  const cerrar = abrirSesionVoz({
    gen: 7,
    conv: () => sdk.conv,
    permiso: () => permiso,
    cbs: () => ({
      onEstado: (g, e) => eventos.push(`estado:${g}:${e}`),
      onMensaje: (g, rol, texto) => eventos.push(`mensaje:${g}:${rol}:${texto}`),
      onInterrupcion: (g) => eventos.push(`interrupcion:${g}`),
      onNiveles: (s, e, c, g) => eventos.push(`niveles:${g ?? '-'}`),
      onAudio: (g, que) => eventos.push(`audio:${g}:${que}`),
      onFin: (g, pase) => eventos.push(`fin:${g}:${pase}`),
      onPermiso: (g) => eventos.push(`permiso:${g}`),
    }),
    silenciada: () => false,
    abierta: { current: false },
    hablando: { current: false },
    reloj: () => 0,
    intervalo: t.intervalo,
    limpiarIntervalo: t.limpiar,
    boca: { seguir: (s) => s, cortar: () => undefined },
    envolventeLibre: () => () => 0,
    senal: { quiereForma: () => false, espectro: () => undefined, alineacion: () => undefined },
    miga: () => undefined,
    pasoMs: 33,
    recursos,
  });
  const ceros = () => ({ timers: t.vivos(), conexiones: sdk.r.conexiones, pistas: sdk.r.pistas, oyentes: sdk.r.oyentes, nuestros: recursos.cuenta() });
  return { sdk, t, recursos, eventos, cerrar, resolverPermiso: (v = { token: 'tok', pase: 'pase-1' }) => resolverPermiso(v), ceros };
}

const tic = () => new Promise((r) => setImmediate(r));
const CERO = { timers: 0, conexiones: 0, pistas: 0, oyentes: 0, nuestros: 0 };

test('colgar esperando el permiso: nada se abre aunque el permiso llegue después', async () => {
  const m = montar();
  m.cerrar();
  m.resolverPermiso();
  await tic();
  assert.deepEqual(m.ceros(), CERO);
  assert.ok(!m.eventos.some((e) => e.startsWith('audio:7:toma')), 'no tomó el audio');
  assert.ok(!m.eventos.some((e) => e.startsWith('permiso:')), 'el permiso tardío no avanza la fase');
});

test('colgar conectando: el SDK recibe el fin y un onConnect tardío no reabre nada', async () => {
  const m = montar();
  m.resolverPermiso();
  await tic();
  assert.equal(m.sdk.r.conexiones, 1);
  m.cerrar();
  m.sdk.ops()?.onConnect?.();
  m.t.latir();
  await tic();
  assert.deepEqual(m.ceros(), CERO);
  assert.ok(!m.eventos.includes('estado:7:escuchando'), 'el onConnect tardío no llegó a la UI');
  assert.deepEqual(m.eventos.filter((e) => e.startsWith('audio:')), ['audio:7:toma', 'audio:7:cerrando', 'audio:7:suelta']);
  assert.deepEqual(m.eventos.filter((e) => e.startsWith('fin:')), ['fin:7:pase-1'], 'el servidor se entera una vez');
});

test('colgar conectada y hablando: timers, conexión, pistas y oyentes a cero; lo tardío no toca nada', async () => {
  const m = montar({ conectaSolo: true });
  m.resolverPermiso();
  await tic();
  m.sdk.ops()?.onModeChange?.({ mode: 'speaking' });
  m.t.latir();
  assert.equal(m.t.vivos(), 1, 'el reloj de la boca late');
  assert.equal(m.sdk.r.pistas, 2);
  assert.ok(m.recursos.cuenta() > 0);
  assert.ok(m.eventos.includes('niveles:7'), 'los niveles llevan su generación');
  m.cerrar();
  const antes = m.eventos.length;
  m.sdk.ops()?.onMessage?.({ message: 'hola tarde', source: 'ai' });
  m.sdk.ops()?.onModeChange?.({ mode: 'listening' });
  m.sdk.ops()?.onInterruption?.();
  m.sdk.ops()?.onConnect?.();
  m.t.latir();
  await tic();
  assert.deepEqual(m.ceros(), CERO);
  const tarde = m.eventos.slice(antes).filter((e) => !/^audio:7:suelta$/.test(e) && !/^niveles/.test(e));
  assert.deepEqual(tarde, [], 'nada de esa sesión llega después de colgar (salvo soltar el audio)');
});

test('colgar después de un error al conectar: también a cero', async () => {
  const m = montar();
  m.resolverPermiso();
  await tic();
  m.sdk.error('Server error');
  m.cerrar();
  await tic();
  assert.deepEqual(m.ceros(), CERO);
  assert.ok(m.eventos.includes('estado:7:error'));
});

test('el permiso falla: sin conexión ni timers, y se dice por qué', async () => {
  const m = montar({ permiso: Promise.reject(Object.assign(new Error('sin minutos'), { status: 429 })) });
  await tic();
  m.cerrar();
  assert.deepEqual(m.ceros(), CERO);
  assert.ok(m.eventos.some((e) => /^estado:7:error/.test(e)));
});

test('el contador: tomar y soltar es idempotente y nombra lo que quedó vivo', () => {
  const r = new ContadorRecursos();
  const a = r.tomar('timer', 'boca');
  const b = r.tomar('conexion', 'sesión');
  assert.equal(r.cuenta(), 2);
  assert.equal(r.cuenta('timer'), 1);
  assert.deepEqual(r.lista(), ['timer:boca', 'conexion:sesión']);
  a();
  a();
  assert.equal(r.cuenta(), 1);
  b();
  assert.equal(r.cuenta(), 0);
});
