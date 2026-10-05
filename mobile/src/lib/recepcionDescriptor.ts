/**
 * LA DESCRIPCIÓN DEL BUILD QUE CORRE ESTE TELÉFONO, en la cabecera `x-aura-cliente` (evidencia de operación, 5-oct:
 * publicar una OTA no prueba que llegó). El servidor la valida y la guarda por cuenta (lib/recepcion-clientes.ts en la
 * raíz, donde está el formato) y GET /api/build la enseña al dueño.
 *
 * Puro, sin nada nativo: lo que dicen expo-updates, expo-constants y Platform se lo pasa quien llama (lib/ota.ts), y
 * así se prueba en node. Solo va lo del BUILD: plataforma, versión y número de build, runtimeVersion (la huella
 * nativa), la OTA (updateId, canal, si es el JS de fábrica, cuándo se publicó) y la versión mayor del sistema. Nada del
 * aparato (ni modelo, ni marca, ni serie), ni ubicación, ni contenido.
 */

export type DatosBuild = {
  plataforma: 'android' | 'ios';
  version?: string | null;
  build?: string | number | null;
  runtime?: string | null;
  updateId?: string | null;
  canal?: string | null;
  embebido?: boolean | null;
  creada?: Date | string | null;
  os?: string | number | null;
};

/** La forma de cada campo (la misma que exige el servidor): lo que no la cumple no se manda. */
const FORMAS = {
  i: /^[A-Za-z0-9-]{8,64}$/,
  v: /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/,
  b: /^[0-9]{1,10}$/,
  rt: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  u: /^[0-9A-Fa-f][0-9A-Fa-f-]{7,63}$/,
  c: /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/,
  os: /^[0-9]{1,3}$/,
} as const;

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** La cabecera armada. Sin un id de instalación válido, '' (no se manda nada). */
export function descriptorCliente(d: DatosBuild, instalacion: string): string {
  if (!FORMAS.i.test(instalacion) || (d.plataforma !== 'android' && d.plataforma !== 'ios')) return '';
  const pares = ['v1', `p=${d.plataforma}`];
  const poner = (k: keyof typeof FORMAS, v: unknown) => {
    const t = texto(v);
    if (t && FORMAS[k].test(t)) pares.push(`${k}=${t}`);
  };
  poner('v', d.version);
  poner('b', d.build);
  poner('rt', d.runtime);
  poner('u', d.updateId);
  poner('c', d.canal);
  if (typeof d.embebido === 'boolean') pares.push(`e=${d.embebido ? 1 : 0}`);
  const t = d.creada instanceof Date ? d.creada.getTime() : d.creada ? Date.parse(String(d.creada)) : NaN;
  if (Number.isFinite(t)) pares.push(`uc=${new Date(t).toISOString()}`);
  poner('os', d.os);
  pares.push(`i=${instalacion}`);
  return pares.join(';');
}

/** Lo que hace falta de cada módulo (tipos mínimos: las pruebas pasan dobles). */
export type ModulosBuild = {
  updates?: { isEnabled?: boolean; updateId?: string | null; runtimeVersion?: string | null; channel?: string | null; isEmbeddedLaunch?: boolean; createdAt?: Date | null } | null;
  constants?: { expoConfig?: { version?: string | null; android?: { versionCode?: number | null } | null; ios?: { buildNumber?: string | null } | null } | null } | null;
  platform: { OS: string; Version?: string | number; constants?: object | null };
};

/** La versión MAYOR del sistema: en Android la de la versión («14»), no el nivel de API; en iOS «17.4» → 17. */
export function sistemaMayor(p: ModulosBuild['platform']): string | null {
  const v = p.OS === 'android' ? texto((p.constants as { Release?: unknown } | null | undefined)?.Release) : texto(p.Version);
  const m = /^(\d{1,3})/.exec(v);
  return m ? m[1] : null;
}

/**
 * Los datos del build a partir de expo-updates, expo-constants y Platform. Sin expo-updates activo (desarrollo, un
 * build sin OTA) van solo la versión y el sistema. `version`/`build` son los de la configuración con la que se armó el
 * JS que corre (en una OTA, la de app.json al publicarla); la huella nativa real es `runtime`.
 */
export function datosDeExpo(m: ModulosBuild): DatosBuild | null {
  const plataforma = m.platform.OS === 'ios' ? 'ios' : m.platform.OS === 'android' ? 'android' : null;
  if (!plataforma) return null;
  const cfg = m.constants?.expoConfig || null;
  const u = m.updates && m.updates.isEnabled ? m.updates : null;
  return {
    plataforma,
    version: cfg?.version ?? null,
    build: plataforma === 'android' ? (cfg?.android?.versionCode ?? null) : (cfg?.ios?.buildNumber ?? null),
    runtime: u?.runtimeVersion ?? null,
    updateId: u?.updateId ?? null,
    canal: u?.channel ?? null,
    embebido: u ? !!u.isEmbeddedLaunch : null,
    creada: u?.createdAt ?? null,
    os: sistemaMayor(m.platform),
  };
}
