/**
 * Avisos web: un alta de A que sigue en vuelo cuando entra B (o sale A) no deja el navegador apuntando a A
 * (revisión independiente del 4-oct, punto 3). Navegador simulado: permiso, service worker, Cache Storage y red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const cache = new Map<string, string>();
/** Las altas que esperan al servidor: cada prueba decide cuándo contestan. */
const altas: Array<() => void> = [];
const soltarAltas = () => altas.splice(0).forEach((f) => f());
let desuscritas = 0;

function definir(nombre: string, valor: unknown) {
  Object.defineProperty(globalThis, nombre, { value: valor, configurable: true, writable: true });
}

definir('window', globalThis);
definir('isSecureContext', true);
definir('PushManager', class {});
definir('Notification', { permission: 'granted', requestPermission: async () => 'granted' });
definir('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
const suscripcion = { toJSON: () => ({ endpoint: 'https://push.ejemplo.test/x' }), unsubscribe: async () => (desuscritas++, true) };
const registro = { pushManager: { getSubscription: async () => suscripcion, subscribe: async () => suscripcion } };
definir('navigator', { serviceWorker: { ready: Promise.resolve(registro), getRegistration: async () => registro } });
definir('caches', {
  open: async () => ({
    put: async (k: string, r: Response) => void cache.set(k, await r.text()),
    delete: async (k: string) => cache.delete(k),
  }),
});
definir('fetch', async (url: string) => {
  if (String(url).includes('/clave')) return new Response(JSON.stringify({ publica: 'BAAA' }), { status: 200 });
  if (String(url).includes('/suscribir')) {
    await new Promise<void>((r) => altas.push(r));
    return new Response('{}', { status: 200 });
  }
  return new Response('{}', { status: 200 });
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Suelta las altas hasta que no quede ninguna esperando (una alta puede lanzar otra). */
async function soltarHastaVaciar() {
  for (let i = 0; i < 10; i++) {
    await espera(10);
    if (!altas.length) return;
    soltarAltas();
  }
}

test('un alta de avisos de A que termina con B dentro no deja el navegador apuntando a A', async () => {
  const A = await import('../src/10-infra/avisosWeb');
  const para = () => cache.get('/__aura_para') || '';
  // Ana entra con el permiso ya dado: su alta queda esperando al servidor.
  await A.cuentaDeAvisos('ana@ejemplo.test');
  await espera(10);
  assert.equal(altas.length, 1, 'el alta de Ana espera');
  // Entra Bea mientras el alta de Ana sigue en vuelo. El servidor contesta primero a Bea y AL FINAL a Ana: el
  // caso peligroso, en el que lo último que se escribía era el seudónimo de Ana.
  await A.cuentaDeAvisos('bea@ejemplo.test');
  await espera(10);
  assert.equal(altas.length, 2, 'las dos altas esperan');
  const [deAna, deBea] = altas.splice(0);
  deBea();
  await espera(20);
  deAna();
  await soltarHastaVaciar();
  assert.equal(para(), await A.seudonimoDe('bea@ejemplo.test'), 'el navegador queda de Bea, no de Ana');
});

test('si Ana sale mientras su alta sigue en vuelo, el navegador queda de nadie', async () => {
  const A = await import('../src/10-infra/avisosWeb');
  const para = () => cache.get('/__aura_para') || '';
  await A.cuentaDeAvisos('ana@ejemplo.test');
  await espera(10);
  const antes = desuscritas;
  await A.cuentaDeAvisos(null);
  await soltarHastaVaciar();
  assert.equal(para(), '', 'tras salir, ningún aviso se enseña a nombre de Ana');
  assert.ok(desuscritas > antes, 'y la suscripción se da de baja');
});
