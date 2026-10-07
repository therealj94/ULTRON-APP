/**
 * LA ENTRADA CON CLAVE DE AU-RA, GUARDADA SIN LA CLAVE A LA VISTA (auditoría del 7-oct, M-9). Antes la «huella» de la
 * entrada era solo una pantalla: la clave estaba en el llavero SIN `requireAuthentication` (lib/storage.ts) y la marca de
 * la huella en AsyncStorage, así que cualquiera que leyera el llavero (o una renovación sin preguntar) tenía la clave.
 *
 * Ahora (sin cambios nativos: expo-secure-store ya trae `requireAuthentication`, igual que veta/desbloqueo.ts):
 *  · lo que se guarda a la vista es correo, nombre, si hay clave detrás de la huella y una huella de la clave
 *    (PBKDF2, para comprobarla sin red), nunca la clave;
 *  · la clave, solo si la persona eligió entrar con huella, va en otra llave con `requireAuthentication`: el sistema
 *    pide la huella para guardarla y para sacarla (`claveConHuella`).
 *
 * LO QUE DEJÓ LA 5.6.0 (la clave en claro, `{ correo, clave, name }`) SE MIGRA SIN DEJAR A NADIE FUERA (revisión
 * previa a fusionar #157, bloqueante 1). Antes se borraba la clave al leerla y la renovación del token (14 días) se
 * quedaba sin clave: a las dos semanas la voz contestaba 401 y AU-RA se callaba. La máquina de estados:
 *   LEGADO   clave en claro (sin huella detrás). Se lee como `legado: true`, NO se reescribe al leer, y la renovación
 *            la usa sin preguntar, exactamente como antes de la OTA (`claveParaRenovar`).
 *   → la primera vez que la persona pone la huella para entrar (`desbloquear`, la entrada rápida): LocalAuthentication
 *            confirma, la clave se guarda con `requireAuthentication`, se anota `conHuella` y su PBKDF2, y SOLO ENTONCES
 *            se reescribe lo visible sin la clave (una sola escritura: la clave en claro y la marca no conviven a medias).
 *   HUELLA   clave detrás de la huella. La renovación la pide (solo cuando lib/permisoHuella.ts lo permite).
 *   Si la huella se cancela o el teléfono no deja guardar con huella, se queda en LEGADO (nada se borra) y entra igual.
 *   Quien nunca activó la huella (LEGADO sin la marca de huella) se queda en LEGADO: su clave renueva sin preguntar,
 *   como siempre (nota de privacidad: esa clave sigue en el llavero sin huella hasta que active la huella o salga).
 *
 * Puro (el llavero y la confirmación del sistema se inyectan): lo prueban pruebas/veta/veta.cjs y
 * pruebas/identidad/huella.cjs con un llavero de mentira que anota las opciones.
 */
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export type SavedCreds = {
  correo: string;
  name?: string;
  conHuella?: boolean;
  claveHuella?: string;
  /** Una versión anterior dejó la clave en el llavero sin huella y todavía no pasó detrás de ella (ver arriba). */
  legado?: boolean;
};
/** Lo que se guarda al entrar: con la clave escrita (y si va detrás de la huella). */
export type CredsNuevas = { correo: string; clave?: string; name?: string; conHuella?: boolean; claveHuella?: string };

export type OpcionesLlavero = { requireAuthentication?: boolean; keychainAccessible?: unknown; authenticationPrompt?: string };
export type Llavero = {
  get: (k: string, o?: OpcionesLlavero) => Promise<string | null>;
  set: (k: string, v: string, o?: OpcionesLlavero) => Promise<void>;
  del: (k: string) => Promise<void>;
  /** SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY */
  soloEsteTelefono?: unknown;
  /**
   * La huella (o el PIN) del sistema, sin llave detrás: LocalAuthentication.authenticateAsync. La migración la usa
   * para confirmar a la persona ANTES de mover la clave en claro detrás de la huella. Sin ella, no se migra.
   */
  autenticar?: (motivo: string) => Promise<boolean>;
};

export const LLAVES_CREDS = { creds: 'ultron_fp_creds_v2', clave: 'ultron_fp_clave_huella_v1' } as const;

/** Lo que dice el sistema al guardar la clave detrás de la huella. */
export const MOTIVO_GUARDAR_CLAVE = 'Guarda tu clave de AU-RA con tu huella';

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

const mismoCorreo = (a: unknown, b: unknown) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Lo que hay en la llave visible, tal cual (con la clave en claro si es de una versión anterior). */
type Crudo = { correo: string; name?: string; conHuella?: boolean; claveHuella?: string; clave?: unknown };

/** De dónde salió la clave para renovar: la de antes (sin preguntar), la de la huella, ninguna, o no se pudo preguntar. */
export type ClaveRenovar = { clave: string | null; via: 'legado' | 'huella' | 'ninguna' | 'sin_permiso' };

export function crearCreds(ll: Llavero) {
  const conHuellaOpc = (prompt: string): OpcionesLlavero => ({ requireAuthentication: true, keychainAccessible: ll.soloEsteTelefono, authenticationPrompt: prompt });
  const borrar = (k: string) => ll.del(k).catch(() => {});

  async function crudo(): Promise<Crudo | null> {
    try {
      const raw = await ll.get(LLAVES_CREDS.creds);
      if (!raw) return null;
      const o = JSON.parse(raw) as Crudo;
      return o && typeof o.correo === 'string' ? o : null;
    } catch {
      return null;
    }
  }
  const claveLegada = (o: Crudo | null): string | null => (o && typeof o.clave === 'string' && o.clave ? o.clave : null);

  /** La clave pasó detrás de la huella: lo visible se reescribe SIN la clave en claro, con la marca y su PBKDF2. */
  async function anotarConHuella(correo: string, name: string | undefined, clave: string) {
    await ll.set(LLAVES_CREDS.creds, JSON.stringify(credsVisibles({ correo, name, conHuella: true, claveHuella: huellaDeClave(correo, clave) })));
  }

  /**
   * Guarda la entrada. Sin `clave`: solo reescribe correo y nombre (lo de la huella, y una clave de antes del mismo
   * correo, como estaban). Con `clave` y `conHuella`, la clave va a su llave con `requireAuthentication`. Sin
   * `conHuella` (o si el sistema no la deja guardar), la clave NO se guarda, salvo que lo de antes fuera una clave en
   * claro de este mismo correo: ahí se queda como estaba (con la clave nueva), para no dejar sin renovación a quien
   * venía de la 5.6.0. Devuelve si la clave quedó detrás de la huella.
   */
  async function guardar(creds: CredsNuevas | null): Promise<boolean> {
    if (!creds) {
      await Promise.all([borrar(LLAVES_CREDS.creds), borrar(LLAVES_CREDS.clave)]);
      return false;
    }
    const antes = await crudo();
    const legada = mismoCorreo(antes?.correo, creds.correo) ? claveLegada(antes) : null;
    if (!creds.clave) {
      if (legada) {
        await ll.set(LLAVES_CREDS.creds, JSON.stringify({ correo: creds.correo, clave: legada, ...(creds.name ? { name: creds.name } : {}) }));
        return false;
      }
      await ll.set(LLAVES_CREDS.creds, JSON.stringify(credsVisibles(creds)));
      return !!creds.conHuella;
    }
    let conHuella = false;
    if (creds.conHuella) {
      try {
        await ll.set(LLAVES_CREDS.clave, creds.clave, conHuellaOpc(MOTIVO_GUARDAR_CLAVE));
        conHuella = true;
      } catch {
        // Sin bloqueo de pantalla seguro, o la persona canceló: la clave no se guarda detrás de la huella.
        await borrar(LLAVES_CREDS.clave);
      }
    } else await borrar(LLAVES_CREDS.clave);
    if (!conHuella && legada) {
      // Venía de la 5.6.0 con la clave en claro: se queda así (con la que acaba de aceptar el servidor), no sin nada.
      await ll.set(LLAVES_CREDS.creds, JSON.stringify({ correo: creds.correo, clave: creds.clave, ...(creds.name ? { name: creds.name } : {}) }));
      return false;
    }
    const claveHuella = conHuella ? huellaDeClave(creds.correo, creds.clave) : undefined;
    await ll.set(LLAVES_CREDS.creds, JSON.stringify(credsVisibles({ ...creds, conHuella, claveHuella })));
    return conHuella;
  }

  /** La entrada guardada, SIN clave. Lo de antes (con la clave en claro) se lee como `legado` y NO se toca. */
  async function leer(): Promise<SavedCreds | null> {
    const o = await crudo();
    if (!o) return null;
    if (claveLegada(o)) return { correo: o.correo, ...(o.name ? { name: o.name } : {}), legado: true };
    if (o.clave !== undefined) {
      // Una «clave» vacía o rara: no hay nada que conservar.
      const limpia = credsVisibles({ correo: o.correo, name: o.name });
      await ll.set(LLAVES_CREDS.creds, JSON.stringify(limpia)).catch(() => {});
      return limpia;
    }
    return credsVisibles({ correo: o.correo, name: o.name, conHuella: o.conHuella, claveHuella: o.claveHuella });
  }

  /** La clave detrás de la huella: el sistema la pide. null si se canceló, falló o no hay. */
  async function claveConHuella(motivo: string): Promise<string | null> {
    try {
      return (await ll.get(LLAVES_CREDS.clave, conHuellaOpc(motivo))) || null;
    } catch {
      return null;
    }
  }

  /**
   * La clave para renovar el token de `correo`. La de antes (LEGADO) sale sin preguntar, como en la 5.6.0. La de la
   * huella, solo si `puedePedir` (lib/permisoHuella.ts: delante, algo que la persona espera y sin pausa tras cancelar);
   * si no, `sin_permiso` y nada se pregunta.
   */
  async function claveParaRenovar(correo: string, motivo: string, puedePedir: boolean): Promise<ClaveRenovar> {
    const o = await crudo();
    if (!o || !mismoCorreo(o.correo, correo)) return { clave: null, via: 'ninguna' };
    const legada = claveLegada(o);
    if (legada) return { clave: legada, via: 'legado' };
    if (!o.conHuella) return { clave: null, via: 'ninguna' };
    if (!puedePedir) return { clave: null, via: 'sin_permiso' };
    return { clave: await claveConHuella(motivo), via: 'huella' };
  }

  /**
   * La entrada rápida con la huella. Con la clave detrás de la huella, la huella la suelta. Con la de antes (LEGADO),
   * es la migración perezosa: LocalAuthentication confirma a la persona; después la clave se guarda con
   * `requireAuthentication`, se anota `conHuella` (con su PBKDF2 para entrar sin red) y SOLO ENTONCES se quita la
   * clave en claro. Si guardarla detrás de la huella falla, LEGADO sigue intacto y la persona entra igual.
   * `migrar: false` (quien nunca activó la huella y solo confirma que es el dueño del teléfono): se confirma igual, pero
   * la clave se queda como estaba. null: canceló, o no hay clave guardada.
   */
  async function desbloquear(motivo: string, o: { migrar?: boolean } = {}): Promise<{ clave: string; migrada: boolean } | null> {
    const c = await crudo();
    if (!c) return null;
    const legada = claveLegada(c);
    if (!legada) {
      if (!c.conHuella) return null;
      const clave = await claveConHuella(motivo);
      return clave ? { clave, migrada: false } : null;
    }
    if (!ll.autenticar) return null;
    let confirmado = false;
    try {
      confirmado = await ll.autenticar(motivo);
    } catch {
      confirmado = false;
    }
    if (!confirmado) return null;
    if (o.migrar === false) return { clave: legada, migrada: false };
    return { clave: legada, migrada: await migrar(c, legada) };
  }

  /** LEGADO → HUELLA, con la persona ya confirmada. false si no se pudo (nada se borra). */
  async function migrar(o: Crudo, clave: string): Promise<boolean> {
    try {
      await ll.set(LLAVES_CREDS.clave, clave, conHuellaOpc(MOTIVO_GUARDAR_CLAVE));
    } catch {
      await borrar(LLAVES_CREDS.clave);
      return false;
    }
    try {
      // ¿Sigue siendo lo mismo? (otra entrada pudo escribir mientras el sistema preguntaba)
      const ahora = await crudo();
      if (!ahora || !mismoCorreo(ahora.correo, o.correo) || claveLegada(ahora) !== clave) return false;
      await anotarConHuella(o.correo, o.name, clave);
      return true;
    } catch {
      return false;
    }
  }

  /** Sin red: ¿esta clave es la guardada de `correo`? (la de antes se compara tal cual, como en la 5.6.0) */
  async function comprobarSinRed(correo: string, clave: string): Promise<boolean> {
    const o = await crudo();
    if (!o || !clave || !mismoCorreo(o.correo, correo)) return false;
    const legada = claveLegada(o);
    if (legada) return legada === clave;
    return claveCoincide({ correo: o.correo, claveHuella: o.conHuella ? o.claveHuella : undefined }, clave);
  }

  return { guardar, leer, claveConHuella, claveParaRenovar, desbloquear, comprobarSinRed };
}
