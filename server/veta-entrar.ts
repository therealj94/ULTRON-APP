/**
 * ENTRAR A AU-RA SOLO CON VETA WALLET, SIN GENESIS ID (docs/ENTRAR-GENESIS.md, caso f).
 *
 * José (5-oct): «Que entren solo con Veta Wallet, sin Genesis ID». El teléfono hace login en el backend de
 * la wallet (la contraseña va del teléfono a la wallet y a nadie más), intenta primero el pase de Genesis
 * ID (server/genesis.ts, que conserva los niveles del padrón) y, si la persona no tiene Genesis ID, lo tiene
 * en revisión o no confirmó su correo, manda aquí el TOKEN DE ACCESO de la wallet, UNA vez.
 *
 * Qué se hace con ese token, y nada más:
 *   1. `GET {AURA_WALLET_API}/users/userDate` con `Authorization: Bearer <token>` (10 s). La wallet comprueba
 *      la firma, que la cuenta exista y no esté borrada, la versión de sesión (revocación), que la dirección
 *      del token sea la de la cuenta y que Genesis no la tenga bloqueada. Solo un 200 con un correo dice que
 *      el token es auténtico.
 *   2. Se lee la carga del JWT (sin comprobar la firma: la acaba de comprobar la wallet) para sacar `address`
 *      —la dirección de la billetera, única— y `verify` (correo confirmado, solo informa).
 *   3. El token se SUELTA: no se guarda, no se registra (ni recortado), no se reenvía a ningún otro sitio y
 *      no se llama a `/auth/logout` (cerraría todas las sesiones de la persona en la wallet).
 *
 * La sesión es de MIEMBRO de la comunidad, como la de Genesis abierto (cerebro público, sin taller ni
 * Telegram de la organización), con rol «Miembro · Veta Wallet», y su identidad es `veta:<dirección>`,
 * NUNCA el correo: el correo de una wallet puede estar sin confirmar, y con él cualquiera que abriera una
 * wallet con el correo de otra persona se quedaría con su cuenta de AU-RA. Por eso tampoco da nunca nivel de
 * junta ni del padrón, aunque el correo coincida (la junta entra con «correo y clave», o con Genesis ID).
 *
 * AURA_VETA_ABIERTO=0 cierra este camino (por omisión, abierto). Una cuenta suspendida no entra. Topes: por
 * conexión (limitar) y por dirección (cupo, contado DESPUÉS de que la wallet confirme el token: contarlo
 * antes dejaría a cualquiera agotarle el cupo a otra dirección con un token inventado).
 *
 * El chat PULSE2CHAT no se conecta por aquí: su alta pide un pase de Genesis ID. La app entra igual y el
 * chat ofrece conectarse después.
 */
import type { Express, RequestHandler } from 'express';
import crypto from 'crypto';

export const WALLET_API_POR_OMISION = 'https://vetawallet-1a2e38ac52b1.herokuapp.com';
/** El backend de Veta Wallet al que se le pregunta si el token vale. */
export const walletApi = () => String(process.env.AURA_WALLET_API || WALLET_API_POR_OMISION).trim().replace(/\/+$/, '');
/** ¿Está abierto el camino sin Genesis ID? Sí, salvo AURA_VETA_ABIERTO = 0 / false / no / cerrado. */
export const vetaAbierto = () => !/^(0|false|no|cerrado)$/i.test(String(process.env.AURA_VETA_ABIERTO ?? '').trim());

/** El rol visible de quien entró solo con Veta Wallet. */
export const ROL_MIEMBRO_VETA = 'Miembro · Veta Wallet';
/** Prefijo de la identidad de estas sesiones (va donde las demás llevan el correo). */
export const PREFIJO_VETA = 'veta:';
/** Lo que espera la respuesta de la wallet. */
export const TOPE_WALLET_MS = 10_000;
/** Entradas por dirección (y por conexión) cada 15 minutos. */
export const MAX_ENTRADAS = 10;
export const VENTANA_MS = 15 * 60_000;
/** Lo más que la entrada espera a abrir la cuenta y sembrar el perfil (lo demás sigue solo). */
export const ESPERA_SEMBRAR_MS = 1500;

const JWT = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

/** ¿Es una identidad de Veta Wallet (`veta:<dirección>`)? */
export function esIdVeta(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(PREFIJO_VETA) && idVeta(id.slice(PREFIJO_VETA.length)) === id;
}

/**
 * La identidad de una dirección de billetera, o null si no es una. Veta Wallet crea direcciones EVM
 * (`0x` + 40 hex, en minúsculas: ethereumjs-wallet `getAddressString`); se pasan a minúsculas por si alguna
 * llega con la suma de control en mayúsculas, que no cambia la dirección.
 */
export function idVeta(address: unknown): string | null {
  const a = String(address ?? '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? PREFIJO_VETA + a.toLowerCase() : null;
}

/** La carga de un JWT, sin comprobar la firma (eso lo hace la wallet), o null. */
export function cargaJwt(token: string): Record<string, unknown> | null {
  try {
    const c = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
    return c && typeof c === 'object' && !Array.isArray(c) ? c : null;
  } catch {
    return null;
  }
}

/** El primer nombre para saludar. */
function nombreCorto(n: unknown): string {
  const s = String(n || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const p = s.split(' ')[0].slice(0, 40);
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

/** Una huella corta de la identidad para los registros (la dirección no es secreta, pero no hace falta). */
const huella = (id: string) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 10);

export type DepsVeta = {
  limitar: (n: number, ventanaMs?: number, grupo?: string) => RequestHandler;
  /** Un cupo con clave propia (seguridad.gastarCupo): true si todavía hay, y lo gasta. */
  cupo: (clave: string, max: number, ventanaMs: number) => boolean;
  emitirSesion: (u: { correo: string; nombre: string; rol: string }, o?: { comunidad?: boolean }) => { token: string };
  /** ¿La cuenta (por su identidad `veta:…`) está suspendida? */
  suspendida?: (id: string) => Promise<boolean>;
  /** Abre (o deja como está) la cuenta de miembro de esta identidad. Un fallo no impide entrar. */
  registrarMiembro?: (m: { id: string; nombre: string }) => Promise<unknown>;
  /** Siembra el perfil con el apodo (nada de «Genesis compartió»: el nombre de la wallet no está verificado). */
  sembrarPerfil?: (id: string, g: { apodo: string }) => Promise<unknown>;
  fetch?: typeof fetch;
  esperaSembrarMs?: number;
};

type Salida = { status: number; body: Record<string, unknown> };
const fallo = (status: number, codigo: string, error: string): Salida => ({ status, body: { ok: false, codigo, error } });

export function montarRutasVeta(app: Express, d: DepsVeta) {
  app.post('/api/veta/entrar', d.limitar(MAX_ENTRADAS, VENTANA_MS, 'veta-entrar'), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let token = typeof req.body?.token === 'string' ? req.body.token : '';
    // Que ningún middleware ni manejador de errores de después vea el token en el cuerpo.
    if (req.body && typeof req.body === 'object') delete req.body.token;
    const r = await entrar(token);
    token = '';
    return res.status(r.status).json(r.body);
  });

  async function entrar(token: string): Promise<Salida> {
    if (!vetaAbierto()) return fallo(403, 'VETA_CERRADO', 'La entrada solo con Veta Wallet está cerrada. Entra con tu Genesis ID.');
    if (!token || token.length > 4096 || !JWT.test(token)) return fallo(400, 'SIN_TOKEN', 'Falta la sesión de Veta Wallet.');
    const carga = cargaJwt(token);
    const id = idVeta(carga?.address);
    if (!id) return fallo(401, 'TOKEN_INVALIDO', 'Veta Wallet no confirmó tu sesión. Vuelve a entrar.');
    if (Number(carga?.exp) && Number(carga?.exp) * 1000 < Date.now()) return fallo(401, 'TOKEN_INVALIDO', 'Tu sesión de Veta Wallet venció. Vuelve a entrar.');

    // 1. ¿Es auténtico? Solo la wallet lo sabe.
    let r: Response;
    try {
      r = await (d.fetch ?? fetch)(`${walletApi()}/users/userDate`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TOPE_WALLET_MS),
      });
    } catch {
      // Sin el detalle del error: no hace falta y no se arriesga a que lleve la cabecera.
      console.error('[veta] la wallet no contestó a tiempo');
      return fallo(503, 'WALLET_CAIDA', 'Veta Wallet no respondió. Vuelve a intentar en un momento.');
    }
    // 2. El token ya no hace falta para nada más: se suelta aquí.
    token = '';
    if (r.status >= 500) {
      console.error(`[veta] la wallet contestó HTTP ${r.status}`);
      return fallo(503, 'WALLET_CAIDA', 'Veta Wallet no respondió. Vuelve a intentar en un momento.');
    }
    // 403: la wallet la tiene bloqueada (el bloqueo del ecosistema en Genesis). No es «vuelve a entrar».
    if (r.status === 403) return fallo(403, 'BLOQUEADA', 'Tu cuenta de Veta Wallet no puede usarse para entrar ahora.');
    const j: any = r.ok ? await r.json().catch(() => null) : null;
    const correoWallet = typeof j?.email === 'string' ? j.email.trim() : '';
    if (!r.ok || !correoWallet.includes('@')) return fallo(401, 'TOKEN_INVALIDO', 'Veta Wallet no confirmó tu sesión. Vuelve a entrar.');

    // 3. Suspendida, tope por dirección y la sesión de miembro.
    if (d.suspendida && (await d.suspendida(id).catch(() => false))) return fallo(403, 'SUSPENDIDA', 'Esta cuenta está suspendida.');
    if (!d.cupo(`veta-entrar:${id}`, MAX_ENTRADAS, VENTANA_MS)) return fallo(429, 'LIMITE', 'Demasiados intentos con esta cuenta. Espera 15 minutos.');
    // El nombre de la cuenta; si no puso ninguno, algo del correo para saludar (solo para saludar: el
    // correo no identifica a nadie aquí). `username` no sirve: la wallet le pone el correo entero.
    const nombre = nombreCorto(j.name) || nombreCorto(correoWallet.split('@')[0].replace(/[._+\-\d]+/g, ' ')) || 'Miembro';
    const completo = String(j.name || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    const s = d.emitirSesion({ correo: id, nombre, rol: ROL_MIEMBRO_VETA }, { comunidad: true });
    console.log(`[veta] ${huella(id)} entró a AU-RA como miembro (sin Genesis ID)`);

    const tareas: Promise<unknown>[] = [];
    if (d.registrarMiembro) {
      tareas.push(Promise.resolve().then(() => d.registrarMiembro!({ id, nombre: completo || nombre })).catch((e: any) => console.warn('[veta] no pude abrir la cuenta de miembro', String(e?.message || e).slice(0, 120))));
    }
    if (d.sembrarPerfil) {
      tareas.push(Promise.resolve().then(() => d.sembrarPerfil!(id, { apodo: nombre })).catch((e: any) => console.warn('[veta] no pude sembrar el perfil', String(e?.message || e).slice(0, 120))));
    }
    if (tareas.length) {
      let reloj: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.all(tareas), new Promise<void>((ok) => (reloj = setTimeout(ok, d.esperaSembrarMs ?? ESPERA_SEMBRAR_MS)))]);
      clearTimeout(reloj);
    }
    return {
      status: 200,
      body: {
        ok: true,
        token: s.token,
        miembro: { nombre, correo: id, rol: ROL_MIEMBRO_VETA, gid: '' },
        nivel: 'miembro',
        // Solo informa: la identidad es la dirección, no el correo.
        correoConfirmado: carga?.verify === true,
        por: 'veta',
      },
    };
  }
}
