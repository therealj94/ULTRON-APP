/**
 * BORRAR LO QUE LA PERSONA CONTÓ, DE VERDAD (auditoría del 3-oct, PRIV01).
 *
 * Un mismo dato vive en dos sitios: la respuesta del perfil («Dónde vives», `PUT /api/perfil`) y su copia
 * en «lo que sé de ti» («Vive en Tela», `/api/cerebro/conocer`). Antes:
 *   · «Borrar esta respuesta» (Lo que AURA sabe de ti) vaciaba el perfil y dejaba la copia;
 *   · «Olvidar» (Lo que sé de ti) escondía el dato aunque el servidor contestara `durable: false`;
 *   · «Borrar todo» mandaba el PUT del perfil sin esperar su recibo.
 *
 * Ahora cada borrado es una SUPRESIÓN con estado —pendiente (en camino), confirmado (todas las copias con
 * recibo durable) o error (alguna sin recibo: red caída, `durable: false` o ausente, un servidor viejo sin
 * la ruta)—, y las dos copias se encuentran por su CLAVE COMÚN (primeravez/flujo.ts, CLAVE_CONOCER). La
 * pantalla nunca dice «borrado» sin «confirmado».
 *
 * Sin React Native: lo prueban las pruebas en node (tests/supresion-movil.test.ts).
 */
import type { Encuesta } from '../nucleo/contrato';
import { CLAVE_CONOCER, type CampoPregunta } from '../primeravez/flujo';

export type EstadoSupresion = 'pendiente' | 'confirmado' | 'error';
export type ClaveDato = { categoria: string; clave: string };
export type CampoConClave = CampoPregunta;

/** Como `plegar` del servidor (lib/cerebro-comun.ts): así guarda él las claves. */
export function plegarClave(s: string | undefined): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** La clave común de una respuesta del perfil; null si no tiene copia con clave («Algo más»). */
export function claveComunDeCampo(campo: keyof Encuesta): ClaveDato | null {
  if (campo === 'otros') return null;
  const k = CLAVE_CONOCER[campo as CampoPregunta];
  return k ? { categoria: k.categoria, clave: k.clave } : null;
}

/** De un dato de «lo que sé de ti» (lo anotara la primera vez o lo oyera AURA), su respuesta del perfil. */
export function campoDeDato(d: { categoria?: string; clave?: string }): CampoConClave | null {
  const clave = plegarClave(d?.clave);
  if (!clave) return null;
  for (const [campo, k] of Object.entries(CLAVE_CONOCER)) {
    if (campo === 'apodo') continue;
    if (k.categoria === d.categoria && plegarClave(k.clave) === clave) return campo as CampoConClave;
  }
  return null;
}

/** ¿Es un recibo de borrado durable? Solo `durable: true`: false, ausente o basura no confirman nada. */
export function reciboDurable(r: unknown): boolean {
  return !!r && typeof r === 'object' && (r as { durable?: unknown }).durable === true;
}

/** Una copia por borrar: `borrar` devuelve true solo con recibo durable (y puede lanzar: red, 404, 5xx). */
export type Copia = { nombre: string; borrar: () => Promise<boolean> };

/**
 * Borra todas las copias (todas se intentan, aunque una falle) y dice si quedó CONFIRMADO: cada una con
 * recibo durable. Nunca lanza: un error es una copia sin recibo, no un éxito.
 */
export async function suprimirCopias(copias: Copia[]): Promise<{ estado: 'confirmado' | 'error'; sinRecibo: string[] }> {
  const sinRecibo: string[] = [];
  for (const c of copias) {
    let ok = false;
    try {
      ok = (await c.borrar()) === true;
    } catch {
      ok = false;
    }
    if (!ok) sinRecibo.push(c.nombre);
  }
  return { estado: copias.length && !sinRecibo.length ? 'confirmado' : 'error', sinRecibo };
}

type Api = <T>(ruta: string, init?: { method?: string; body?: string }, ms?: number) => Promise<T>;

/** La copia de «lo que sé de ti», por id y por clave común (`POST /api/cerebro/conocer/olvidar`). */
export function copiaConocer(api: Api, o: { ids?: string[]; claves?: ClaveDato[] }): Copia {
  return {
    nombre: 'conocer',
    borrar: async () => reciboDurable(await api('/api/cerebro/conocer/olvidar', { method: 'POST', body: JSON.stringify({ ids: o.ids || [], claves: o.claves || [] }) }, 15_000)),
  };
}
