/**
 * EL FRENO DE GASTO DIARIO POR PROVEEDOR (auditoría del 7-oct, C-2).
 *
 * Las rutas que gastan dinero (voz, oído, ojos) ya piden sesión y tienen cupo por IP y por persona. Esto es la última
 * red: un tope GLOBAL por día y por proveedor, para todo el proceso, venga de donde venga el gasto (la mesa, la web,
 * Windows, Telegram, Dr Electrum). Si una cuenta robada o un error en un bucle se pone a gastar, el día se corta en el
 * tope y no en la factura.
 *
 *   AURA_TOPE_DIA_TTS_CARACTERES   caracteres de ElevenLabs TTS al día (por omisión 600 000, unas 11 h de habla).
 *   AURA_TOPE_DIA_STT_SEGUNDOS     segundos de audio oídos al día (por omisión 144 000 = 40 h; antes 36 000, que un día
 *                                  fuerte con el oído Turbo podía gastar: revisión de #157). Cada permiso del oído Turbo
 *                                  en vivo cuenta SEGUNDOS_POR_PERMISO_TURBO (no se sabe cuánto va a durar), pero el que
 *                                  el teléfono pide POR ADELANTADO (`anticipado`) no se cobra hasta que dice que lo usó
 *                                  (`usado`): los que vencen sin usarse no cuentan.
 *   AURA_TOPE_DIA_VISION_LLAMADAS  llamadas a los ojos al día (por omisión 5 000).
 *
 * Las cuentas de MANDO (lib/acceso.ts `puedeMandar`: José) no tienen tope de voz ni de oído: lo que gastan se anota
 * aparte (`exento` en estadoGasto, y una línea en el registro al pasar el tope), pero nunca se les dice que no. El
 * servidor abre ese ámbito por petición (`conPagadorGasto`, un AsyncLocalStorage): lo que corre fuera de una petición
 * (calentar la caché) cuenta como siempre.
 *
 * Un valor que no sea un número >= 0 se ignora (vale el de omisión); 0 apaga ese proveedor. El día es el de Honduras.
 * Al pasarse, una línea clara en el registro (una vez por día y proveedor) y el proveedor contesta «no» hasta
 * medianoche: la voz cae a Voicebox (sin créditos de ElevenLabs), el oído y los ojos dicen que no pueden.
 *
 * El contador vive en la memoria del proceso: un redespliegue lo pone en cero. Es un freno, no una factura.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { diaHonduras } from '../server/tope-voz';

export type ProveedorGasto = 'tts' | 'stt' | 'vision';

export const TOPES_GASTO_OMISION: Record<ProveedorGasto, number> = { tts: 600_000, stt: 144_000, vision: 5_000 };
export const ENV_TOPE_GASTO: Record<ProveedorGasto, string> = {
  tts: 'AURA_TOPE_DIA_TTS_CARACTERES',
  stt: 'AURA_TOPE_DIA_STT_SEGUNDOS',
  vision: 'AURA_TOPE_DIA_VISION_LLAMADAS',
};
const QUE: Record<ProveedorGasto, { nombre: string; unidad: string; luego: string }> = {
  tts: { nombre: 'ElevenLabs TTS', unidad: 'caracteres', luego: 'la voz pasa a Voicebox (sin créditos de ElevenLabs)' },
  stt: { nombre: 'el oído (STT)', unidad: 'segundos', luego: 'el oído contesta que no puede' },
  vision: { nombre: 'los ojos (visión)', unidad: 'llamadas', luego: 'los ojos contestan que no pueden' },
};
/** Lo que cuenta un permiso del oído Turbo en vivo: el teléfono puede tenerlo abierto un rato, no se sabe cuánto. */
export const SEGUNDOS_POR_PERMISO_TURBO = 60;

export function topeGasto(p: ProveedorGasto, env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env[ENV_TOPE_GASTO[p]] ?? '').trim();
  if (!raw) return TOPES_GASTO_OMISION[p];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : TOPES_GASTO_OMISION[p];
}

/** Los proveedores de los que una cuenta de mando no tiene tope (la voz y el oído; los ojos sí lo tienen). */
const SIN_TOPE_PARA_MANDO: ReadonlySet<ProveedorGasto> = new Set(['tts', 'stt']);

const usado = new Map<ProveedorGasto, { dia: string; cantidad: number; avisado: boolean; exento: number; avisadoExento: boolean }>();

function cuenta(p: ProveedorGasto, ahora: number) {
  const dia = diaHonduras(ahora);
  let c = usado.get(p);
  if (!c || c.dia !== dia) {
    c = { dia, cantidad: 0, avisado: false, exento: 0, avisadoExento: false };
    usado.set(p, c);
  }
  return c;
}

/* ── quién paga: las cuentas de mando no tienen tope de voz ni de oído ──────────────────────────────────────────── */

type Pagador = { esMando: () => boolean; sabido?: boolean };
const pagador = new AsyncLocalStorage<Pagador>();

/**
 * Corre `fn` (el resto de la petición) sabiendo quién paga. `esMando` se pregunta una sola vez y solo si algo gasta.
 * server.ts lo abre para cada petición, después de leer el cuerpo.
 */
export function conPagadorGasto<T>(esMando: () => boolean, fn: () => T): T {
  let sabido: boolean | undefined;
  return pagador.run(
    {
      esMando: () => {
        if (sabido === undefined) {
          try {
            sabido = !!esMando();
          } catch {
            sabido = false;
          }
        }
        return sabido;
      },
    },
    fn
  );
}

/** ¿Lo que se gasta ahora es de una cuenta de mando? (fuera de una petición: no) */
export function gastoDeMando(): boolean {
  return pagador.getStore()?.esMando() ?? false;
}

/** Lo que gasta una cuenta de mando: se anota aparte y nunca se niega. Una línea al día cuando pasa el tope. */
function anotarExento(p: ProveedorGasto, c: ReturnType<typeof cuenta>, n: number, tope: number) {
  c.exento += n;
  if (!c.avisadoExento && c.exento + c.cantidad > tope) {
    c.avisadoExento = true;
    const q = QUE[p];
    console.warn(
      `[freno-gasto] cuenta de mando por encima del tope: ${q.nombre} lleva ${Math.round(c.exento)} ${q.unidad} de mando y ` +
        `${Math.round(c.cantidad)} del resto hoy (${c.dia}, Honduras; tope ${tope}). A mando no se le corta; queda anotado.`
    );
  }
}

/**
 * Reserva `cantidad` del cupo del día de ese proveedor. true: hay cupo y ya quedó anotado (se cobra al pedir, aunque
 * el proveedor falle después: es un freno). false: el tope se alcanzó; no se anota nada y no se debe llamar al
 * proveedor.
 */
export function gastarCupoDiario(p: ProveedorGasto, cantidad: number, ahora = Date.now(), o: { mando?: boolean } = {}): boolean {
  const n = Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 0;
  const c = cuenta(p, ahora);
  const tope = topeGasto(p);
  // Una cuenta de mando no tiene tope de voz ni de oído (se anota aparte). Con el proveedor apagado (0), tampoco.
  if (tope > 0 && SIN_TOPE_PARA_MANDO.has(p) && (o.mando ?? gastoDeMando())) {
    anotarExento(p, c, n, tope);
    return true;
  }
  if (c.cantidad + n > tope || (tope === 0 && n === 0)) {
    if (!c.avisado) {
      c.avisado = true;
      const q = QUE[p];
      console.error(
        `[freno-gasto] TOPE DIARIO ALCANZADO: ${q.nombre} lleva ${Math.round(c.cantidad)} de ${tope} ${q.unidad} hoy (${c.dia}, Honduras). ` +
          `Hasta medianoche no se gasta más: ${q.luego}. Si el gasto es legítimo, sube ${ENV_TOPE_GASTO[p]} en Render.`
      );
    }
    return false;
  }
  c.cantidad += n;
  return true;
}

/** Lo gastado hoy por proveedor (para el estado del sistema). `exento`: lo de las cuentas de mando (sin tope). */
export function estadoGasto(ahora = Date.now()): Record<ProveedorGasto, { usado: number; tope: number; dia: string; exento: number }> {
  const out = {} as Record<ProveedorGasto, { usado: number; tope: number; dia: string; exento: number }>;
  for (const p of Object.keys(TOPES_GASTO_OMISION) as ProveedorGasto[]) {
    const c = cuenta(p, ahora);
    out[p] = { usado: Math.round(c.cantidad), tope: topeGasto(p), dia: c.dia, exento: Math.round(c.exento) };
  }
  return out;
}

/* ── el oído Turbo: lo que se pide por adelantado se cobra al usarlo ────────────────────────────────────────────── */

/** Cuántos permisos adelantados sin usar puede tener una cuenta: pasado eso, el más viejo se cobra como usado. */
export const MAX_PERMISOS_ANTICIPADOS = 3;
/** Un adelantado que no se usó en esto ya venció en ElevenLabs (15 min): se olvida sin cobrar. */
export const VIGENCIA_PERMISO_ANTICIPADO_MS = 20 * 60_000;

const anticipados = new Map<string, { quien: string; en: number; mando: boolean }>();

function olvidarVencidos(ahora: number) {
  for (const [id, a] of anticipados) if (ahora - a.en > VIGENCIA_PERMISO_ANTICIPADO_MS) anticipados.delete(id);
}

/** Un gasto que ya ocurrió (el permiso se usó): se anota siempre, aunque pase del tope. */
function anotarUsado(a: { mando: boolean }, ahora: number) {
  const c = cuenta('stt', ahora);
  if (a.mando && topeGasto('stt') > 0) anotarExento('stt', c, SEGUNDOS_POR_PERMISO_TURBO, topeGasto('stt'));
  else c.cantidad += SEGUNDOS_POR_PERMISO_TURBO;
}

/**
 * Un permiso del oído Turbo que el teléfono pide para tenerlo listo. No se cobra: se anota como pendiente de `quien`
 * (su correo) y devuelve su id. Si el tope ya no alcanza ni para uno, null (sin permiso). Si `quien` ya tiene
 * MAX_PERMISOS_ANTICIPADOS sin usar, el más viejo se cobra como usado (un teléfono que nunca avisa no oye gratis).
 */
export function reservarPermisoAnticipado(quien: string, ahora = Date.now()): string | null {
  olvidarVencidos(ahora);
  const mando = gastoDeMando();
  const tope = topeGasto('stt');
  const c = cuenta('stt', ahora);
  if (!(mando && tope > 0) && c.cantidad + SEGUNDOS_POR_PERMISO_TURBO > tope) {
    // Igual que gastarCupoDiario al pasarse: «no» y la línea del registro (sin anotar nada).
    gastarCupoDiario('stt', SEGUNDOS_POR_PERMISO_TURBO, ahora, { mando: false });
    return null;
  }
  const suyos = [...anticipados.entries()].filter(([, a]) => a.quien === quien).sort((x, y) => x[1].en - y[1].en);
  while (suyos.length >= MAX_PERMISOS_ANTICIPADOS) {
    const [id, a] = suyos.shift()!;
    anticipados.delete(id);
    anotarUsado(a, ahora);
  }
  const id = crypto.randomBytes(9).toString('base64url');
  anticipados.set(id, { quien, en: ahora, mando });
  return id;
}

/** El teléfono dice que usó el permiso adelantado `id`: ahí se cobra (una vez). false si no era suyo o ya venció. */
export function cobrarPermisoUsado(id: string, quien: string, ahora = Date.now()): boolean {
  olvidarVencidos(ahora);
  const a = anticipados.get(String(id || ''));
  if (!a || a.quien !== quien) return false;
  anticipados.delete(String(id));
  anotarUsado(a, ahora);
  return true;
}

/** El permiso adelantado no llegó a darse (ElevenLabs no contestó): se suelta sin cobrar. */
export function soltarPermisoAnticipado(id: string) {
  anticipados.delete(String(id || ''));
}

/** Solo pruebas: el contador en cero. */
export function _reiniciarFrenoGasto() {
  usado.clear();
  anticipados.clear();
}

/**
 * Cuántos segundos dura un audio, para el tope del oído. Un WAV dice su duración en la cabecera; lo demás (m4a, ogg,
 * webm del teléfono y Telegram) se estima por el peso a 32 kbps, que es lo que graban (de sobra para un freno). Al menos 1 s.
 */
export function segundosDeAudio(audio: Buffer, mime = ''): number {
  if (audio.length >= 44 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE') {
    const bytesPorSegundo = audio.readUInt32LE(28);
    if (bytesPorSegundo > 0) return Math.max(1, Math.ceil((audio.length - 44) / bytesPorSegundo));
  }
  if (/pcm|l16/i.test(mime)) return Math.max(1, Math.ceil(audio.length / 32_000));
  return Math.max(1, Math.ceil(audio.length / 4_000));
}
