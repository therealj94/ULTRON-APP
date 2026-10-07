/**
 * LA ENTRADA CON CLAVE DE AU-RA, GUARDADA SIN LA CLAVE (auditoría del 7-oct, M-9). Antes la «huella» de la entrada era
 * solo una pantalla: la clave estaba en el llavero SIN `requireAuthentication` (lib/storage.ts) y la marca de la huella
 * en AsyncStorage, así que cualquiera que leyera el llavero (o una renovación sin preguntar) tenía la clave.
 *
 * Ahora (sin cambios nativos: expo-secure-store ya trae `requireAuthentication`, igual que veta/desbloqueo.ts):
 *  · lo que se guarda a la vista es correo, nombre, si hay clave detrás de la huella y una huella de la clave
 *    (PBKDF2, para comprobarla sin red), nunca la clave;
 *  · la clave, solo si la persona eligió entrar con huella, va en otra llave con `requireAuthentication`: el sistema
 *    pide la huella para guardarla y para sacarla (`leerClaveConHuella`);
 *  · lo de las versiones de antes (la clave en claro) se reescribe sin la clave la primera vez que se lee. La sesión
 *    (el token) no se toca: nadie queda fuera; la huella vuelve a servir la próxima vez que se escriba la clave.
 *
 * Puro (el llavero se inyecta): lo prueba pruebas/veta/veta.cjs con el llavero de mentira que anota las opciones.
 */
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export type SavedCreds = { correo: string; name?: string; conHuella?: boolean; claveHuella?: string };
/** Lo que se guarda al entrar: con la clave escrita (y si va detrás de la huella). */
export type CredsNuevas = { correo: string; clave?: string; name?: string; conHuella?: boolean; claveHuella?: string };

export type OpcionesLlavero = { requireAuthentication?: boolean; keychainAccessible?: unknown; authenticationPrompt?: string };
export type Llavero = {
  get: (k: string, o?: OpcionesLlavero) => Promise<string | null>;
  set: (k: string, v: string, o?: OpcionesLlavero) => Promise<void>;
  del: (k: string) => Promise<void>;
  /** SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY */
  soloEsteTelefono?: unknown;
};

export const LLAVES_CREDS = { creds: 'ultron_fp_creds_v2', clave: 'ultron_fp_clave_huella_v1' } as const;

/** Cómo comprobar una clave sin red y sin guardarla: PBKDF2-SHA256 con sal propia («p1$sal$hash»). */
export function huellaDeClave(correo: string, clave: string, sal = Math.random().toString(36).slice(2, 12) + Date.now().toString(36)): string {
  const h = pbkdf2(sha256, utf8ToBytes(String(clave)), utf8ToBytes(`aura-clave|${String(correo).trim().toLowerCase()}|${sal}`), { c: 10_000, dkLen: 32 });
  return `p1$${sal}$${bytesToHex(h)}`;
}

/** ¿Esta clave es la última que el servidor aceptó en este teléfono? (para entrar sin red) */
export function claveCoincide(creds: Pick<SavedCreds, 'correo' | 'claveHuella'> | null | undefined, clave: string): boolean {
  const partes = String(creds?.claveHuella || '').split('$');
  if (!creds || partes.length !== 3 || partes[0] !== 'p1' || !clave) return false;
  return huellaDeClave(creds.correo, clave, partes[1]) === creds.claveHuella;
}

/** Lo que queda a la vista: nunca la clave. */
export function credsVisibles(c: CredsNuevas): SavedCreds {
  return {
    correo: c.correo,
    ...(c.name ? { name: c.name } : {}),
    ...(c.conHuella ? { conHuella: true } : {}),
    ...(c.conHuella && c.claveHuella ? { claveHuella: c.claveHuella } : {}),
  };
}

export function crearCreds(ll: Llavero) {
  const conHuellaOpc = (prompt: string): OpcionesLlavero => ({ requireAuthentication: true, keychainAccessible: ll.soloEsteTelefono, authenticationPrompt: prompt });
  const borrar = (k: string) => ll.del(k).catch(() => {});

  /**
   * Guarda la entrada. Sin `clave`: solo reescribe correo y nombre (lo de la huella, como estaba). Con `clave` y
   * `conHuella`, la clave va a su llave con `requireAuthentication`; sin `conHuella`, la clave NO se guarda.
   * Devuelve si la clave quedó detrás de la huella.
   */
  async function guardar(creds: CredsNuevas | null): Promise<boolean> {
    if (!creds) {
      await Promise.all([borrar(LLAVES_CREDS.creds), borrar(LLAVES_CREDS.clave)]);
      return false;
    }
    if (!creds.clave) {
      await ll.set(LLAVES_CREDS.creds, JSON.stringify(credsVisibles(creds)));
      return !!creds.conHuella;
    }
    let conHuella = false;
    if (creds.conHuella) {
      try {
        await ll.set(LLAVES_CREDS.clave, creds.clave, conHuellaOpc('Guarda tu clave de AU-RA con tu huella'));
        conHuella = true;
      } catch {
        // Sin bloqueo de pantalla seguro, o la persona canceló: la clave no se guarda (la próxima vez, escrita).
        await borrar(LLAVES_CREDS.clave);
      }
    } else await borrar(LLAVES_CREDS.clave);
    const claveHuella = conHuella ? huellaDeClave(creds.correo, creds.clave) : undefined;
    await ll.set(LLAVES_CREDS.creds, JSON.stringify(credsVisibles({ ...creds, conHuella, claveHuella })));
    return conHuella;
  }

  /** La entrada guardada, SIN clave. Lo de antes (con la clave en claro) se reescribe sin ella, una vez. */
  async function leer(): Promise<SavedCreds | null> {
    try {
      const raw = await ll.get(LLAVES_CREDS.creds);
      if (!raw) return null;
      const o = JSON.parse(raw) as SavedCreds & { clave?: unknown };
      if (!o || typeof o.correo !== 'string') return null;
      if (o.clave !== undefined) {
        const limpia = credsVisibles({ correo: o.correo, name: o.name });
        await ll.set(LLAVES_CREDS.creds, JSON.stringify(limpia)).catch(() => {});
        return limpia;
      }
      return credsVisibles({ correo: o.correo, name: o.name, conHuella: o.conHuella, claveHuella: o.claveHuella });
    } catch {
      return null;
    }
  }

  /** La clave detrás de la huella: el sistema la pide. null si se canceló, falló o no hay. */
  async function claveConHuella(motivo: string): Promise<string | null> {
    try {
      return (await ll.get(LLAVES_CREDS.clave, conHuellaOpc(motivo))) || null;
    } catch {
      return null;
    }
  }

  return { guardar, leer, claveConHuella };
}
