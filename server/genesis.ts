/**
 * ENTRAR A AU-RA CON GENESIS ID.
 *
 * El teléfono no manda contraseña: manda un PASE de Genesis ID que sacó la wallet de la persona
 * (la app Orden Global o la web de Veta Wallet) después de que ella tocara «Permitir». El pase:
 *
 *   · es para AU-RA y para el chat (`aud`), y cada uno lo gasta una sola vez;
 *   · lleva el `reto` que generó ESTE teléfono: solo él tiene el verificador. Si otra app se
 *     quedara con el enlace de vuelta (`ultronfp://sso?pase=…`), el pase no le serviría.
 *
 * Genesis dice de quién es (GID, correo de la identidad, nombre verificado). Eso PRUEBA quién es la
 * persona; no decide si entra. Entrar sigue siendo cosa del padrón, que decide José:
 *
 *   · está en el padrón con acceso a AU-RA → entra, sin contraseña;
 *   · no está → queda una solicitud de acceso con su GID verificado, para aprobar desde el panel
 *     de siempre. Aprobada, la próxima vez entra con el mismo botón;
 *   · AURA_GENESIS_ABIERTO=1 → cualquier identidad verificada entra (lo decide José, no el código).
 *     Quien entra así sin estar en el padrón es MIEMBRO de la comunidad, no junta (server/nivel.ts):
 *     rol «Miembro · Genesis ID», cerebro público, sin taller ni Telegram de la organización.
 *
 * La clave de la app `aura` en Genesis vive en GENESIS_API_KEY_AURA (o GENESIS_API_KEY) y no sale
 * de aquí: con ella solo se puede preguntar si un pase HECHO PARA AU-RA vale.
 */
import type { Express, RequestHandler } from 'express';

const RETO = /^[A-Za-z0-9_-]{43}$/;
const GID = /^GEN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]$/;

export const genesisUrl = () => (process.env.GENESIS_URL || 'https://genesis-id.onrender.com').replace(/\/+$/, '');
const clave = () => String(process.env.GENESIS_API_KEY_AURA || process.env.GENESIS_API_KEY || '').trim();
export const genesisConfigurado = () => Boolean(clave());
/** Dónde saca el pase quien no tiene la app Orden Global: la web de Veta Wallet. */
export const walletWeb = () => (process.env.AURA_WALLET_WEB || 'https://app.vetawallet.com').replace(/\/+$/, '');
export const genesisAbierto = () => process.env.AURA_GENESIS_ABIERTO === '1';

/**
 * `nombre` es el primer nombre para saludar; `nombreCompleto`, el legal tal cual lo dio Genesis; y
 * `cumple`, solo mes y día (MM-DD), que Genesis comparte con las apps que tienen el alcance
 * `gid.cumple`. Si no viene (la app no lo tiene, o la persona no lo dio), no pasa nada.
 */
export type PaseVerificado = { gid: string; correo: string; nombre: string; nombreCompleto: string; cumple: string | null };
export type FalloPase = { estado: 401 | 503; codigo: 'SIN_GENESIS' | 'GENESIS_CAIDO' | 'PASE_INVALIDO' | 'SIN_VERIFICAR' | 'MAL_CONFIGURADO'; detalle?: string };

/** El primer nombre para saludar; el nombre legal completo no hace falta en la mesa. */
function nombreCorto(legal: unknown): string {
  const n = String(legal || '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  const p = n.split(' ')[0];
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

/** El nombre completo con mayúscula inicial en cada palabra («ANA MARÍA LÓPEZ» → «Ana María López»). */
function nombreCompleto(legal: unknown): string {
  return String(legal || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, l: string) => sep + l.toUpperCase());
}

const DIAS_DEL_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** «MM-DD» válido, o null. Si Genesis mandara una fecha entera («1994-03-14»), se toma solo mes y día. */
export function cumpleDeGenesis(v: unknown): string | null {
  const s = String(v ?? '').trim();
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const mes = Number(m[1]);
  const dia = Number(m[2]);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= DIAS_DEL_MES[mes - 1] ? `${m[1]}-${m[2]}` : null;
}

/** Le pregunta a Genesis si el pase vale para AU-RA, con el verificador del reto. */
export async function verificarPase(pase: string, verificador: string, f: typeof fetch = fetch): Promise<PaseVerificado | FalloPase> {
  if (!genesisConfigurado()) return { estado: 503, codigo: 'SIN_GENESIS' };
  let r: Response;
  try {
    r = await f(`${genesisUrl()}/api/v1/sso/verificar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': clave() },
      body: JSON.stringify({ token: pase, verificador }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e: any) {
    return { estado: 503, codigo: 'GENESIS_CAIDO', detalle: String(e?.message || e).slice(0, 120) };
  }
  const j: any = await r.json().catch(() => ({}));
  if (r.status >= 500) return { estado: 503, codigo: 'GENESIS_CAIDO', detalle: `HTTP ${r.status}` };
  if (!r.ok || j?.valido !== true) return { estado: 401, codigo: 'PASE_INVALIDO', detalle: String(j?.codigo || j?.error || r.status) };
  /* Un pase sin destino es el de siempre: vale en cualquier casa y las veces que sea. Aquí no, o
     cualquier app del ecosistema que recibiera uno podría entrar a AU-RA con la identidad de otro. */
  if (!Array.isArray(j.aud) || !j.aud.includes('aura')) return { estado: 401, codigo: 'PASE_INVALIDO', detalle: 'sin destino aura' };
  const gid = String(j.gid || '').toUpperCase();
  const correo = String(j.correo || '').trim().toLowerCase();
  // Sin perfil o sin correo es la clave de AU-RA mal configurada en Genesis (le faltan
  // gid.perfil / gid.correo): es culpa nuestra y se dice como tal, no se deja entrar a ciegas.
  if (!j.perfil || typeof j.perfil !== 'object' || !correo.includes('@') || !GID.test(gid)) return { estado: 503, codigo: 'MAL_CONFIGURADO' };
  if (j.perfil.verificada !== true) return { estado: 401, codigo: 'SIN_VERIFICAR' };
  return { gid, correo, nombre: nombreCorto(j.perfil.nombre), nombreCompleto: nombreCompleto(j.perfil.nombre), cumple: cumpleDeGenesis(j.perfil.cumple) };
}

export type DepsGenesis = {
  limitar: (n: number, ventanaMs?: number, grupo?: string) => RequestHandler;
  normalizarCorreo: (c: unknown) => string;
  /** ¿Esta persona (por correo) tiene acceso a AU-RA en el padrón? */
  tieneAcceso: (correo: string) => boolean;
  nombreYRol: (correo: string, nombre?: string) => { nombre: string; rol: string };
  emitirSesion: (u: { correo: string; nombre: string; rol: string }) => { token: string };
  /** Deja la solicitud de acceso para que la apruebe José. Devuelve false si no se pudo guardar. */
  pedirAcceso: (s: { nombre: string; correo: string; motivo: string }) => Promise<boolean>;
  /**
   * Si la persona no tiene perfil todavía, se crea uno con lo que compartió Genesis (nombre completo
   * y cumple, completado: false); si ya tenía, solo se llenan los huecos. Un fallo aquí no impide entrar.
   */
  sembrarPerfil?: (correo: string, g: { nombreGenesis: string; cumple: string | null; apodo: string }) => Promise<unknown>;
  fetch?: typeof fetch;
  /** Lo más que la entrada espera a sembrar el perfil (ESPERA_SEMBRAR_MS; las pruebas lo acortan). */
  esperaSembrarMs?: number;
};

/**
 * Lo más que la entrada con Genesis espera a que se siembre el perfil. Sembrar lee y escribe S3 (hasta
 * 12 s cada paso si S3 anda mal) y la persona esperaba todo eso para entrar. Pasado el tope, entra y el
 * sembrado sigue en segundo plano.
 */
export const ESPERA_SEMBRAR_MS = 1500;

const MENSAJE: Record<FalloPase['codigo'], string> = {
  SIN_GENESIS: 'El ingreso con Genesis ID no está configurado en este servidor.',
  MAL_CONFIGURADO: 'El ingreso con Genesis ID no está bien configurado.',
  GENESIS_CAIDO: 'No se pudo comprobar tu Genesis ID. Probá de nuevo en un momento.',
  PASE_INVALIDO: 'El pase no es válido o ya se usó. Volvé a tocar «Entrar con Genesis ID».',
  SIN_VERIFICAR: 'Tu identidad todavía no está verificada en Genesis ID.',
};

export function montarRutasGenesis(app: Express, d: DepsGenesis) {
  /** Lo que la app necesita saber para ofrecer el botón (nada secreto). */
  app.get('/api/genesis/config', (_req, res) => {
    res.json({ disponible: genesisConfigurado(), walletWeb: `${walletWeb()}/#sso-aura`, abierto: genesisAbierto() });
  });

  app.post('/api/genesis/entrar', d.limitar(12, 15 * 60_000, 'genesis-entrar'), async (req, res) => {
    const pase = String(req.body?.pase || '');
    const verificador = String(req.body?.verificador || '');
    if (!pase || pase.length > 4096 || verificador.length < 43 || verificador.length > 128) {
      return res.status(400).json({ ok: false, error: 'Falta el pase de Genesis ID.', codigo: 'SIN_PASE' });
    }
    const v = await verificarPase(pase, verificador, d.fetch);
    if ('codigo' in v) {
      if (v.estado === 503) console.error(`[genesis] ${v.codigo}${v.detalle ? `: ${v.detalle}` : ''}`);
      return res.status(v.estado).json({ ok: false, error: MENSAJE[v.codigo], codigo: v.codigo });
    }
    const correo = d.normalizarCorreo(v.correo);
    if (!d.tieneAcceso(correo) && !genesisAbierto()) {
      const guardada = await d
        .pedirAcceso({
          nombre: v.nombre || correo.split('@')[0],
          correo,
          motivo: `Entró con Genesis ID verificado (${v.gid}) desde la app AU-RA FP.`,
        })
        .catch(() => false);
      console.warn(`[genesis] ${v.gid} verificado pero sin acceso a AU-RA; solicitud ${guardada ? 'guardada' : 'NO guardada'}`);
      return res.status(403).json({
        ok: false,
        codigo: 'PENDIENTE',
        gid: v.gid,
        error: guardada
          ? 'Tu Genesis ID es válido. Tu acceso a AU-RA quedó pedido: cuando lo aprueben, entrás con este mismo botón.'
          : 'Tu Genesis ID es válido, pero todavía no tenés acceso a AU-RA. Pedilo desde «Solicitar acceso».',
      });
    }
    const { nombre, rol } = d.nombreYRol(correo, v.nombre);
    const s = d.emitirSesion({ correo, nombre, rol });
    console.log(`[genesis] ${v.gid} entró a AU-RA`);
    if (d.sembrarPerfil) {
      const sembrado = Promise.resolve()
        .then(() => d.sembrarPerfil!(correo, { nombreGenesis: v.nombreCompleto, cumple: v.cumple, apodo: nombre }))
        .catch((e: any) => console.warn('[genesis] no pude sembrar el perfil', String(e?.message || e).slice(0, 120)));
      let reloj: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([sembrado, new Promise<void>((r) => (reloj = setTimeout(r, d.esperaSembrarMs ?? ESPERA_SEMBRAR_MS)))]);
      clearTimeout(reloj);
    }
    return res.json({
      ok: true,
      token: s.token,
      miembro: { nombre, correo, rol, gid: v.gid },
      genesis: { nombre: v.nombreCompleto || null, cumple: v.cumple },
      por: 'genesis',
    });
  });
}

/** Solo para pruebas: la forma que tiene que tener un reto. */
export const _retoValido = (r: string) => RETO.test(r);
