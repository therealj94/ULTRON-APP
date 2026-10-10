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
 * persona. Quién entra y con qué nivel lo decide José, y decidió que AU-RA es de la comunidad:
 *
 *   · está en el padrón con acceso a AU-RA → entra como siempre (junta o aprobado), sin contraseña;
 *   · no está en el padrón → entra como MIEMBRO de la comunidad, nunca como junta (server/nivel.ts):
 *     rol «Miembro · Genesis ID», cerebro público, sin taller ni Telegram de la organización. La
 *     primera vez se le abre su cuenta de miembro (sin acceso en el padrón, con el nombre que dio
 *     Genesis) y su perfil con el apodo del primer nombre;
 *   · el padrón lo conoce pero lo deja fuera de AU-RA (p. ej. solo tiene Dr Electrum) → no entra:
 *     queda una solicitud de acceso con su GID verificado, como antes. Una sesión de miembro no le
 *     abriría la mesa (seguridad.sesionAbreAura), así que no se le emite una que no sirve;
 *   · AURA_GENESIS_ABIERTO=0 → vuelve la puerta cerrada de antes: fuera del padrón solo se deja la
 *     solicitud para aprobar desde el panel.
 *
 * La clave de la app `aura` en Genesis vive en GENESIS_API_KEY_AURA (o GENESIS_API_KEY) y no sale
 * de aquí: con ella solo se puede preguntar si un pase HECHO PARA AU-RA vale.
 */
import type { Express, RequestHandler } from 'express';
import { recogerVuelta, registrarIntentoWeb, VIDA_INTENTO_MS } from './sso-web';
import { comprobarSuspension, TOPE_SUSPENSION_MS } from './veta-entrar';
import { anotarDetalle, montarVigilancia } from './registro-entrada';

const RETO = /^[A-Za-z0-9_-]{43}$/;
const GID = /^GEN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]$/;

export const genesisUrl = () => (process.env.GENESIS_URL || 'https://genesis-id.onrender.com').replace(/\/+$/, '');
const clave = () => String(process.env.GENESIS_API_KEY_AURA || process.env.GENESIS_API_KEY || '').trim();
export const genesisConfigurado = () => Boolean(clave());
/** Dónde saca el pase quien no tiene la app Orden Global: la web de Veta Wallet. */
export const walletWeb = () => (process.env.AURA_WALLET_WEB || 'https://app.vetawallet.com').replace(/\/+$/, '');
/**
 * ¿Entra como miembro cualquier Genesis ID verificado que no está en el padrón? Sí, salvo que
 * AURA_GENESIS_ABIERTO diga que no (`0`, `false`, `no`). Antes era al revés (había que poner `1`), y
 * quien no estaba en el padrón se quedaba en «tu acceso está en revisión» aunque su identidad fuera
 * buena: la prueba de la comunidad no pasaba de la puerta.
 */
export const genesisAbierto = () => !/^(0|false|no|cerrado)$/i.test(String(process.env.AURA_GENESIS_ABIERTO ?? '').trim());

/**
 * `nombre` es el primer nombre para saludar; `nombreCompleto`, el legal tal cual lo dio Genesis; y
 * `cumple`, solo mes y día (MM-DD), que Genesis comparte con las apps que tienen el alcance
 * `gid.cumple`. Si no viene (la app no lo tiene, o la persona no lo dio), no pasa nada.
 */
export type PaseVerificado = { gid: string; correo: string; nombre: string; nombreCompleto: string; cumple: string | null };
export type FalloPase = { estado: 401 | 403 | 503; codigo: 'SIN_GENESIS' | 'GENESIS_CAIDO' | 'PASE_INVALIDO' | 'SIN_VERIFICAR' | 'MAL_CONFIGURADO' | 'BLOQUEADA'; detalle?: string };

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
  /* Genesis dice por qué (10-oct: antes todo era «pase no válido» y no quedaba rastro del motivo). Una identidad
     bloqueada no es «vuelve a tocar el botón»: es BLOQUEADA, y la app no busca otra puerta. La que dejó de estar
     verificada es SIN_VERIFICAR. La clave de AU-RA rechazada (401 sin `valido`) es culpa nuestra: MAL_CONFIGURADO. */
  if (r.status === 403 && j?.codigo === 'IDENTIDAD_BLOQUEADA') return { estado: 403, codigo: 'BLOQUEADA', detalle: 'IDENTIDAD_BLOQUEADA' };
  if (r.status === 403 && j?.valido === false) return { estado: 401, codigo: 'SIN_VERIFICAR', detalle: `HTTP 403 ${String(j?.error || '').slice(0, 60)}`.trim() };
  if ((r.status === 401 || r.status === 403) && j?.valido === undefined) return { estado: 503, codigo: 'MAL_CONFIGURADO', detalle: `clave de aura rechazada (HTTP ${r.status})` };
  if (!r.ok || j?.valido !== true) return { estado: 401, codigo: 'PASE_INVALIDO', detalle: String(j?.codigo || j?.error || `HTTP ${r.status}`).slice(0, 80) };
  /* Un pase sin destino es el de siempre: vale en cualquier casa y las veces que sea. Aquí no, o
     cualquier app del ecosistema que recibiera uno podría entrar a AU-RA con la identidad de otro. */
  if (!Array.isArray(j.aud) || !j.aud.includes('aura')) return { estado: 401, codigo: 'PASE_INVALIDO', detalle: 'sin destino aura' };
  const gid = String(j.gid || '').toUpperCase();
  const correo = String(j.correo || '').trim().toLowerCase();
  // Sin perfil o sin correo es la clave de AU-RA mal configurada en Genesis (le faltan
  // gid.perfil / gid.correo): es culpa nuestra y se dice como tal, no se deja entrar a ciegas.
  if (!j.perfil || typeof j.perfil !== 'object' || !correo.includes('@') || !GID.test(gid)) {
    return { estado: 503, codigo: 'MAL_CONFIGURADO', detalle: !j.perfil || typeof j.perfil !== 'object' ? 'sin perfil (falta gid.perfil)' : !correo.includes('@') ? 'sin correo (falta gid.correo)' : 'gid con otra forma' };
  }
  if (j.perfil.verificada !== true) return { estado: 401, codigo: 'SIN_VERIFICAR', detalle: 'perfil sin verificar' };
  return { gid, correo, nombre: nombreCorto(j.perfil.nombre), nombreCompleto: nombreCompleto(j.perfil.nombre), cumple: cumpleDeGenesis(j.perfil.cumple) };
}

export type DepsGenesis = {
  limitar: (n: number, ventanaMs?: number, grupo?: string) => RequestHandler;
  normalizarCorreo: (c: unknown) => string;
  /** ¿Esta persona (por correo) tiene acceso a AU-RA en el padrón? */
  tieneAcceso: (correo: string) => boolean;
  nombreYRol: (correo: string, nombre?: string) => { nombre: string; rol: string };
  emitirSesion: (u: { correo: string; nombre: string; rol: string }, o?: { comunidad?: boolean }) => { token: string };
  /**
   * ¿Puede entrar como miembro de la comunidad? Sí cuando el padrón NO lo conoce (seguridad.esDeComunidad);
   * quien el padrón conoce y deja fuera de AU-RA, no. Su sesión lo lleva firmado (seguridad.sesionAbreAura).
   */
  deComunidad?: (correo: string) => boolean;
  /**
   * Abre (o deja como está) la cuenta de miembro: correo, nombre de Genesis y el GID de donde salió, sin
   * acceso en el padrón —así sigue siendo miembro—. Si la cuenta ya existía no se toca nada. Un fallo
   * aquí no impide entrar: la sesión de miembro no depende de la fila.
   */
  registrarMiembro?: (m: { correo: string; nombre: string; gid: string }) => Promise<unknown>;
  /** ¿La cuenta está suspendida? Una suspendida no entra por Genesis; si la consulta falla o tarda, tampoco (503). */
  suspendida?: (correo: string) => Promise<boolean>;
  /** Lo más que se espera la consulta de suspensión (TOPE_SUSPENSION_MS; las pruebas lo acortan). */
  topeSuspensionMs?: number;
  /**
   * Genesis acaba de probar que esta persona es la dueña del correo. Si alguien había creado una cuenta propia
   * con ese correo SIN confirmarlo (server/registro-cuentas.ts), su contraseña deja de valer aquí, ANTES de
   * emitir la sesión: quien se adelantó a registrar el correo de otro no se queda con la cuenta. Un fallo no
   * impide entrar.
   */
  reclamarCorreo?: (correo: string) => Promise<unknown>;
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
  BLOQUEADA: 'El acceso de tu Genesis ID está bloqueado.',
};

export function montarRutasGenesis(app: Express, d: DepsGenesis) {
  // Una línea por intento en el registro (server/registro-entrada.ts): antes un pase rechazado no dejaba rastro.
  montarVigilancia(app, ['/api/genesis/entrar', '/api/genesis/web/recoger']);
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
    const r = await entrarConPase(pase, verificador, 'desde la app AU-RA FP');
    if (r.detalle) anotarDetalle(res, r.detalle);
    if (r.quien) res.locals.quienEntrada = r.quien;
    return res.status(r.status).json(r.body);
  });

  /*
   * ENTRAR DESDE LA WEB (Safari, el icono del iPhone, escritorio; auditoría del 3-oct, IOS01). La web
   * registra su intento (estado + huella del verificador) antes de ir a la wallet; la vuelta a /sso queda
   * depositada en el servidor (server/sso-web.ts) y la web la recoge aquí con su verificador: un canje, con
   * plazo, atado al intento. Nunca hay un token de sesión en una URL.
   */
  app.post('/api/genesis/web/intento', d.limitar(20, 15 * 60_000, 'genesis-web'), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const estado = String(req.body?.estado || '');
    const reto = String(req.body?.reto || '');
    if (!registrarIntentoWeb(estado, reto)) return res.status(400).json({ ok: false, error: 'El pedido de entrada no es válido. Probá otra vez.', codigo: 'INTENTO_INVALIDO' });
    return res.json({ ok: true, venceEn: Math.round(VIDA_INTENTO_MS / 1000) });
  });

  // La web pregunta cada pocos segundos mientras espera: el tope es amplio, el canje sigue siendo uno.
  app.post('/api/genesis/web/recoger', d.limitar(240, 15 * 60_000, 'genesis-web-recoger'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const estado = String(req.body?.estado || '');
    const verificador = String(req.body?.verificador || '');
    if (verificador.length < 43 || verificador.length > 128) return res.status(400).json({ ok: false, error: 'Falta el verificador.', codigo: 'SIN_VERIFICADOR' });
    const r = recogerVuelta(estado, verificador);
    if (r.estado === 'pendiente') return res.status(202).json({ ok: false, estado: 'pendiente' });
    if (r.estado === 'desconocido') return res.status(410).json({ ok: false, estado: 'vencido', codigo: 'VENCIDO', error: 'Esta entrada venció o ya se usó. Tocá «Entrar con Genesis ID» otra vez.' });
    if (r.estado === 'reto') return res.status(403).json({ ok: false, estado: 'error', codigo: 'RETO', error: 'Esta entrada no la empezó este navegador.' });
    if (r.estado === 'error') return res.status(400).json({ ok: false, estado: 'error', codigo: r.error, error: 'Tu wallet no completó la entrada.' });
    const e = await entrarConPase(r.pase, verificador, 'desde la web de AU-RA FP');
    if (e.detalle) anotarDetalle(res, e.detalle);
    if (e.quien) res.locals.quienEntrada = e.quien;
    return res.status(e.status).json(e.body);
  });

  /** El canje del pase (la app y la web): la misma decisión de siempre, con su estado HTTP y su cuerpo. */
  async function entrarConPase(pase: string, verificador: string, desde: string): Promise<{ status: number; body: Record<string, unknown>; detalle?: string; quien?: string }> {
    const v = await verificarPase(pase, verificador, d.fetch);
    if ('codigo' in v) {
      if (v.estado === 503) console.error(`[genesis] ${v.codigo}${v.detalle ? `: ${v.detalle}` : ''}`);
      return { status: v.estado, body: { ok: false, error: MENSAJE[v.codigo], codigo: v.codigo }, detalle: v.detalle };
    }
    const correo = d.normalizarCorreo(v.correo);
    const r = await decidir(v, correo, desde);
    return { ...r, quien: correo };
  }

  async function decidir(v: PaseVerificado, correo: string, desde: string): Promise<{ status: number; body: Record<string, unknown>; detalle?: string }> {
    // Una cuenta suspendida no entra por Genesis (con Genesis abierto entraba como miembro).
    // Revisión 7 (G3): si la consulta falla o tarda NO se entra (antes un error contaba como «no suspendida»).
    if (d.suspendida) {
      const comprobado = await comprobarSuspension(d.suspendida, [correo], d.topeSuspensionMs ?? TOPE_SUSPENSION_MS);
      if (comprobado === 'sin_comprobar') {
        console.error('[genesis] no pude comprobar si la cuenta está suspendida: no entra');
        return { status: 503, body: { ok: false, codigo: 'CUENTA_SIN_COMPROBAR', error: 'No pude comprobar tu cuenta. Intenta de nuevo.' } };
      }
      if (comprobado === 'suspendida') return { status: 403, body: { ok: false, codigo: 'SUSPENDIDA', error: 'Esta cuenta está suspendida.' } };
    }
    const enPadron = d.tieneAcceso(correo);
    // Miembro: fuera del padrón, con la puerta abierta, y que el padrón no lo tenga apartado de AU-RA.
    const comoMiembro = !enPadron && genesisAbierto() && (d.deComunidad ? d.deComunidad(correo) : true);
    if (!enPadron && !comoMiembro) {
      const guardada = await d
        .pedirAcceso({
          nombre: v.nombre || correo.split('@')[0],
          correo,
          motivo: `Entró con Genesis ID verificado (${v.gid}) ${desde}.`,
        })
        .catch(() => false);
      console.warn(`[genesis] ${v.gid} verificado pero sin acceso a AU-RA; solicitud ${guardada ? 'guardada' : 'NO guardada'}`);
      return {
        status: 403,
        body: {
          ok: false,
          codigo: 'PENDIENTE',
          gid: v.gid,
          error: guardada
            ? 'Tu Genesis ID es válido. Tu acceso a AU-RA quedó pedido: cuando lo aprueben, entrás con este mismo botón.'
            : 'Tu Genesis ID es válido, pero todavía no tenés acceso a AU-RA. Pedilo desde «Solicitar acceso».',
        },
      };
    }
    // Antes de la sesión: una contraseña puesta por otro en una cuenta sin confirmar con este correo deja de valer
    // (y con ella sus sesiones), y la sesión que se emite abajo ya es posterior.
    if (d.reclamarCorreo) await Promise.resolve().then(() => d.reclamarCorreo!(correo)).catch((e: any) => console.warn('[genesis] no pude reclamar el correo', String(e?.message || e).slice(0, 120)));
    const { nombre, rol } = d.nombreYRol(correo, v.nombre);
    const s = d.emitirSesion({ correo, nombre, rol }, { comunidad: comoMiembro });
    console.log(`[genesis] ${v.gid} entró a AU-RA${comoMiembro ? ' como miembro' : ''}`);
    /* La cuenta de miembro y el perfil, a la vez y con el mismo tope: los dos escriben fuera (Postgres y
       S3) y la persona no espera a ninguno más de ESPERA_SEMBRAR_MS. Lo que no termine sigue solo. */
    const tareas: Promise<unknown>[] = [];
    if (comoMiembro && d.registrarMiembro) {
      tareas.push(
        Promise.resolve()
          .then(() => d.registrarMiembro!({ correo, nombre: v.nombreCompleto || nombre, gid: v.gid }))
          .catch((e: any) => console.warn('[genesis] no pude abrir la cuenta de miembro', String(e?.message || e).slice(0, 120)))
      );
    }
    if (d.sembrarPerfil) {
      tareas.push(
        Promise.resolve()
          .then(() => d.sembrarPerfil!(correo, { nombreGenesis: v.nombreCompleto, cumple: v.cumple, apodo: nombre }))
          .catch((e: any) => console.warn('[genesis] no pude sembrar el perfil', String(e?.message || e).slice(0, 120)))
      );
    }
    if (tareas.length) {
      let reloj: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.all(tareas), new Promise<void>((r) => (reloj = setTimeout(r, d.esperaSembrarMs ?? ESPERA_SEMBRAR_MS)))]);
      clearTimeout(reloj);
    }
    return {
      status: 200,
      body: {
        ok: true,
        token: s.token,
        miembro: { nombre, correo, rol, gid: v.gid },
        // Solo informa a la pantalla; el servidor recalcula el nivel en cada petición (server/nivel.ts).
        nivel: comoMiembro ? 'miembro' : 'junta',
        genesis: { nombre: v.nombreCompleto || null, cumple: v.cumple },
        por: 'genesis',
      },
    };
  }
}

/** Solo para pruebas: la forma que tiene que tener un reto. */
export const _retoValido = (r: string) => RETO.test(r);
