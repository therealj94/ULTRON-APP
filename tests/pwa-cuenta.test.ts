/**
 * AUR14 · la PWA de AU-RA en el cliente: purga por logout y actualización en un punto seguro.
 *
 *   · al salir de la cuenta (guardarTokenMesa('')), la página borra lo suyo de la cuenta —el seudónimo de los
 *     avisos y cualquier caché de AU-RA que no sea un shell, la memoria local por cuenta, la conversación
 *     de la pestaña, una entrada con Genesis a medias, el correo recordado— y le pide al worker `purgar`
 *     (con respuesta, o con plazo si el worker no contesta);
 *   · «Recargar» con una llamada en vivo, una decisión abierta o el control de su computadora no recarga:
 *     espera a que termine y entonces aplica; `controllerchange` solo recarga si la persona lo pidió.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { purgarCuentaPwa } from '../src/10-infra/purgaPwa';
import { AplicadorVersion } from '../src/10-infra/pwa';
import { _olvidarTrabajos, alTerminarTrabajo, avisarTrabajoLibre, registrarTrabajoActivo, trabajoActivo } from '../src/10-infra/trabajoActivo';
import { hayDecisionAbierta, type Entrada } from '../src/13-trabajo/conversacion';

/** Un Storage de mentira. */
function almacen(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    claves: () => [...m.keys()].sort(),
  };
}

/** Cache Storage de mentira (solo nombres). */
function cajas(nombres: string[]) {
  const s = new Set(nombres);
  return { keys: async () => [...s], delete: async (n: string) => s.delete(n), nombres: () => [...s].sort() };
}

test('purga del cliente: lo de la cuenta se va, el shell queda para el worker y el worker confirma', async () => {
  const caches = cajas(['aura-cuenta', 'aura-shell-abc', 'aura-shell-viejo', 'aura-algo', 'otra-app']);
  const local = almacen({
    'ultron_memoria_larga:abc': '[]',
    ultron_memoria_larga: '[]',
    'aura.genesis.web': '{"verificador":"v"}',
    ultron_correo: 'jose@x.com',
    aura_tema: 'oscuro',
    ultron_sesion_token: 'tok',
  });
  const sesion = almacen({ 'aura_conversacion:jose@x.com': '[]', 'aura_conversacion:invitado': '[]', otra: '1' });
  const mensajes: any[] = [];
  const r = await purgarCuentaPwa({
    caches,
    local,
    sesion,
    worker: () => ({ postMessage: (m: any, puertos: any[]) => (mensajes.push(m), puertos[0].postMessage({ purgado: true })) }),
    canal: () => {
      let oyente: ((e: { data: any }) => void) | null = null;
      return { port1: { set onmessage(f: any) { oyente = f; }, close() {} }, port2: { postMessage: (d: any) => oyente?.({ data: d }) } } as any;
    },
  });
  assert.deepEqual(caches.nombres(), ['aura-shell-abc', 'aura-shell-viejo', 'otra-app'], 'lo de la cuenta fuera; los shells los ordena el worker; lo ajeno no se toca');
  assert.deepEqual(local.claves(), ['aura_tema', 'ultron_sesion_token'], 'memoria por cuenta, Genesis a medias y correo recordado fuera (el token lo borra quien sale)');
  assert.deepEqual(sesion.claves(), ['otra'], 'la conversación de la pestaña, fuera');
  assert.deepEqual(mensajes, [{ tipo: 'purgar' }]);
  assert.equal(r.worker, true);
});

test('purga del cliente: sin worker, o con uno que no contesta, igual limpia y no se cuelga', async () => {
  const caches = cajas(['aura-cuenta']);
  const r1 = await purgarCuentaPwa({ caches, local: almacen(), sesion: almacen(), worker: () => null });
  assert.deepEqual([caches.nombres(), r1.worker], [[], false]);
  const t0 = Date.now();
  const r2 = await purgarCuentaPwa({ caches: cajas([]), local: almacen(), sesion: almacen(), worker: () => ({ postMessage: () => undefined }), esperaMs: 50 });
  assert.equal(r2.worker, false);
  assert.ok(Date.now() - t0 < 1000);
  // Sin nada del navegador (Node, un navegador viejo): no lanza.
  await purgarCuentaPwa({});
});

test('salir de la cuenta (guardarTokenMesa vacío) purga; entrar no', async (t) => {
  const g = globalThis as any;
  const antes = { caches: g.caches, localStorage: g.localStorage, sessionStorage: g.sessionStorage, window: g.window };
  const caches = cajas(['aura-cuenta']);
  const local = almacen({ 'ultron_memoria_larga:x': '[]' });
  g.caches = caches;
  g.localStorage = local;
  g.sessionStorage = almacen();
  g.window = { localStorage: local, sessionStorage: g.sessionStorage, location: { protocol: 'http:' } };
  t.after(() => Object.assign(g, antes));
  const { guardarTokenMesa } = await import('../src/10-infra/sesionCliente');
  guardarTokenMesa('token-de-prueba-largo-123456');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(caches.nombres(), ['aura-cuenta'], 'entrar no purga');
  guardarTokenMesa('');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(caches.nombres(), [], 'salir purga');
  assert.equal(local.getItem('ultron_memoria_larga:x'), null);
});

/* ── actualización en un punto seguro ──────────────────────────────────────────────────────── */

function aplicador(ocupados: () => string[]) {
  const hechos: string[] = [];
  const relojes = new Map<number, () => void>();
  let n = 0;
  let esperando: { postMessage: (m: any) => void } | null = { postMessage: (m) => hechos.push(`worker:${m.tipo}`) };
  const a = new AplicadorVersion({
    esperando: () => esperando,
    recargar: () => hechos.push('recarga'),
    ocupado: ocupados,
    alLibre: alTerminarTrabajo,
    intervalo: (f) => (relojes.set(++n, f), n),
    limpiar: (id) => void relojes.delete(id as number),
  });
  return { a, hechos, latir: () => [...relojes.values()].forEach((f) => f()), relojes, sinWorker: () => (esperando = null) };
}

test('«Recargar» en medio de una llamada o una decisión espera; al terminar, aplica una sola vez', () => {
  _olvidarTrabajos();
  let llamada = true;
  const quitar = registrarTrabajoActivo('voz-en-vivo', () => llamada);
  const x = aplicador(trabajoActivo);
  assert.equal(x.a.aplicar(), 'esperando');
  assert.deepEqual(x.hechos, [], 'ni activa el worker ni recarga con la llamada abierta');
  x.latir();
  assert.deepEqual(x.hechos, []);
  llamada = false;
  avisarTrabajoLibre();
  assert.deepEqual(x.hechos, ['worker:activar'], 'colgó: ahora sí, el worker nuevo toma el control');
  // El worker tomó el control: la página recarga porque lo pidió la persona (y ya no hay nada en curso).
  x.a.alCambiarControlador();
  assert.deepEqual(x.hechos, ['worker:activar', 'recarga']);
  assert.equal(x.relojes.size, 0, 'no queda reloj esperando');
  avisarTrabajoLibre();
  assert.deepEqual(x.hechos, ['worker:activar', 'recarga'], 'una sola vez');
  quitar();
});

test('controllerchange sin pedido de la persona (otra pestaña, el primer worker) no recarga', () => {
  _olvidarTrabajos();
  const x = aplicador(() => []);
  x.a.alCambiarControlador();
  assert.deepEqual(x.hechos, []);
  // Pedido, pero mientras tanto empezó una llamada: la recarga espera a que termine.
  let ocupado = false;
  const y = aplicador(() => (ocupado ? ['voz-en-vivo'] : []));
  assert.equal(y.a.aplicar(), 'recargando');
  ocupado = true;
  y.a.alCambiarControlador();
  assert.deepEqual(y.hechos, ['worker:activar']);
  ocupado = false;
  y.latir();
  assert.deepEqual(y.hechos, ['worker:activar', 'recarga']);
  // Sin worker esperando (ya se activó en otra pestaña): recarga directo si no hay nada en curso.
  const z = aplicador(() => []);
  z.sinWorker();
  assert.equal(z.a.aplicar(), 'recargando');
  assert.deepEqual(z.hechos, ['recarga']);
});

test('una decisión abierta cuenta como trabajo activo', () => {
  const base = { id: 'a', tipo: 'accion', ts: 0, accion: { tipo: 'correo' } as any, pedido: 'manda' } as const;
  assert.equal(hayDecisionAbierta([{ ...base, estado: 'propuesta' }] as Entrada[]), true);
  assert.equal(hayDecisionAbierta([{ ...base, estado: 'enviando' }] as Entrada[]), true);
  assert.equal(hayDecisionAbierta([{ ...base, estado: 'hecha' }] as Entrada[]), false);
  assert.equal(hayDecisionAbierta([]), false);
});
