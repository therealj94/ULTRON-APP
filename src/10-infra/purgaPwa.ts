/**
 * PURGA POR LOGOUT EN EL NAVEGADOR (AUR14; documento maestro, sección 16): al salir de la cuenta no queda en
 * este navegador nada que sea de ella, ni en la página ni en el service worker.
 *
 *  · Cache Storage: el seudónimo de los avisos (`aura-cuenta`) y cualquier caché `aura-*` que no sea un shell
 *    (los shells son públicos y por versión; de ellos se ocupa el worker, que sabe cuál es el suyo);
 *  · localStorage: la memoria larga por cuenta (`ultron_memoria_larga:*`), una entrada con Genesis a medias
 *    (`aura.genesis.web`) y el correo recordado del formulario (`ultron_correo`). El token lo borra quien sale
 *    (10-infra/sesionCliente.ts, también su cookie espejo de iOS);
 *  · sessionStorage: la conversación de la pestaña (`aura_conversacion:*`);
 *  · el worker: mensaje `purgar` (scripts/pwa/sw-plantilla.js) con respuesta por un MessageChannel; si no
 *    contesta en `esperaMs`, se sigue igual (lo de la página ya se limpió).
 *
 * Nunca lanza. Todo lo del navegador entra por parámetros (con los del navegador por omisión), así se prueba
 * en Node con dobles (tests/pwa-cuenta.test.ts). Lo que queda en el servidor (la memoria de su dueño allá)
 * no se toca desde aquí: eso es del borrado de la cuenta, no de salir.
 */
type CachesMin = { keys: () => Promise<string[]>; delete: (n: string) => Promise<boolean> };
type AlmacenMin = { readonly length: number; key: (i: number) => string | null; removeItem: (k: string) => void };
type WorkerMin = { postMessage: (m: unknown, transfer: any[]) => void };
type CanalMin = { port1: { onmessage: ((e: { data: any }) => void) | null; close?: () => void }; port2: unknown };

export type DepsPurga = {
  caches?: CachesMin | null;
  local?: AlmacenMin | null;
  sesion?: AlmacenMin | null;
  /** El worker que controla la página (o el activo). */
  worker?: () => WorkerMin | null | undefined;
  canal?: () => CanalMin;
  esperaMs?: number;
};

const LOCAL_DE_CUENTA = [/^ultron_memoria_larga(:|$)/, /^aura\.genesis\.web$/, /^ultron_correo$/];
const SESION_DE_CUENTA = [/^aura_conversacion:/];

function delNavegador(): DepsPurga {
  const g = globalThis as any;
  const seguro = <T>(f: () => T): T | null => {
    try {
      return f() ?? null;
    } catch {
      return null;
    }
  };
  return {
    caches: seguro(() => g.caches),
    local: seguro(() => g.localStorage),
    sesion: seguro(() => g.sessionStorage),
    worker: () => seguro(() => g.navigator?.serviceWorker?.controller),
    canal: typeof g.MessageChannel === 'function' ? () => new g.MessageChannel() : undefined,
  };
}

function limpiar(a: AlmacenMin | null | undefined, patrones: RegExp[]) {
  if (!a) return;
  try {
    const claves: string[] = [];
    for (let i = 0; i < a.length; i++) {
      const k = a.key(i);
      if (k && patrones.some((p) => p.test(k))) claves.push(k);
    }
    for (const k of claves) a.removeItem(k);
  } catch {
    /* sin almacenamiento */
  }
}

/** Le pide al worker que purgue y espera su respuesta (o el plazo). true: confirmó. */
function pedirAlWorker(w: WorkerMin, canal: (() => CanalMin) | undefined, esperaMs: number): Promise<boolean> {
  return new Promise((resolver) => {
    let listo = false;
    const fin = (ok: boolean) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      resolver(ok);
    };
    const reloj = setTimeout(() => fin(false), esperaMs);
    try {
      if (!canal) {
        w.postMessage({ tipo: 'purgar' }, []);
        return fin(false);
      }
      const c = canal();
      c.port1.onmessage = (e) => {
        try {
          c.port1.close?.();
        } catch {
          /* */
        }
        fin(!!e?.data?.purgado);
      };
      w.postMessage({ tipo: 'purgar' }, [c.port2]);
    } catch {
      fin(false);
    }
  });
}

export async function purgarCuentaPwa(dep?: DepsPurga): Promise<{ caches: string[]; worker: boolean }> {
  const d = dep ?? delNavegador();
  const borrados: string[] = [];
  try {
    const nombres = (await d.caches?.keys()) || [];
    for (const n of nombres) {
      if (n.startsWith('aura-') && !n.startsWith('aura-shell-')) {
        await d.caches!.delete(n);
        borrados.push(n);
      }
    }
  } catch {
    /* sin Cache Storage */
  }
  limpiar(d.local, LOCAL_DE_CUENTA);
  limpiar(d.sesion, SESION_DE_CUENTA);
  let worker = false;
  try {
    const w = d.worker?.();
    if (w) worker = await pedirAlWorker(w, d.canal, d.esperaMs ?? 1_500);
  } catch {
    worker = false;
  }
  return { caches: borrados, worker };
}
