/**
 * DE QUIÉN ES CADA COSA — aislamiento por organización (auditoría H14).
 *
 * Decidido por José (30-sep-2026): Dr Electrum va a recibir expedientes de clientes distintos, así
 * que lo de un cliente no lo ve otro. Hasta acá todo era un repositorio común: la búsqueda, la
 * lectura seguida y la lista de expedientes devolvían los documentos de todos.
 *
 * El reparto:
 *
 *  - **Documentos y carteras** son de una organización. Lo cargado antes de esto (sin organización)
 *    es de la casa, Orden Global: `coalesce(organizacion, CASA)`. Así no hace falta reescribir
 *    ninguna fila existente —solo se agrega una columna— y nada de lo de la casa queda a la vista
 *    de un cliente.
 *  - **Capas**: las de la casa son comunes (el catastro nacional, la geología, JICA, las áreas
 *    protegidas: `organizacion` nula). Lo que suba un cliente entra como capa de PROYECTO suya, no
 *    como catastro: si entrara como concesiones se mezclaría con el padrón nacional de todos.
 *  - **Informes, hilos y preferencias** ya son por persona (H05, H17).
 *
 * La organización de la petición vive en un `AsyncLocalStorage` que abre un middleware para todo
 * `/api/electrum`: las consultas la leen sin que haya que pasarla a mano por veinte funciones, y
 * una ruta nueva queda filtrada sin acordarse. Fuera de un ámbito (scripts, tareas internas) no se
 * filtra: son de la casa.
 *
 * Los invitados de la demo ven lo de la casa: José decidió que la demo muestra datos reales (H06).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Persona } from '../../lib/acceso';
import { esDominioDeLaCasa } from '../../lib/acceso';
import { consulta } from './db';

/** Solo letras, números, punto y guion: el valor se escribe en SQL como literal y tiene que ser inocuo. */
export function slugOrganizacion(x: unknown): string {
  return String(x ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const CASA = slugOrganizacion(process.env.ULTRON_ORGANIZACION_CASA) || 'orden-global';

/** Los proveedores de correo públicos no son una organización: dos cuentas de gmail no son colegas. */
const PUBLICOS = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|proton|protonmail|gmx|zoho|mail)\./;

/**
 * La organización de una persona:
 *  1. la que dice el padrón (`organizacion`), si la tiene;
 *  2. la casa, si José la puso a mano en el padrón: es su equipo, y hasta hoy veía todo. Separarla
 *     por su correo al desplegar la dejaría sin los expedientes de la casa de un día para otro;
 *  3. para una cuenta aprobada desde la página (`origen: 'web'`): la casa si su correo es de Orden
 *     Global; si no, el dominio de su correo (todos los de mina.hn juntos); con correo público
 *     (gmail…), ella sola.
 */
export function organizacionDePersona(p: (Pick<Persona, 'id' | 'correos'> & { organizacion?: string; origen?: 'web' }) | null | undefined): string {
  if (!p) return CASA;
  const dada = slugOrganizacion(p.organizacion);
  if (dada) return dada;
  if (p.origen !== 'web') return CASA;
  const correo = p.correos?.[0];
  if (!correo) return CASA;
  const dominio = correo.split('@')[1] || '';
  if (!dominio || p.correos.some((c) => esDominioDeLaCasa(c.split('@')[1]))) return CASA;
  if (PUBLICOS.test(dominio)) return slugOrganizacion(`persona-${p.id}`);
  return slugOrganizacion(dominio) || CASA;
}

/** A qué organización miran los invitados de la demo. La casa, salvo que se diga otra. */
export const ORGANIZACION_DEMO = slugOrganizacion(process.env.ELECTRUM_ORGANIZACION_DEMO) || CASA;

const ambito = new AsyncLocalStorage<string>();

export function conOrganizacion<T>(org: string, fn: () => T): T {
  return ambito.run(slugOrganizacion(org) || CASA, fn);
}

/** La de la petición en curso; null fuera de un ámbito (tareas internas, que son de la casa). */
export function organizacionActual(): string | null {
  return ambito.getStore() ?? null;
}

const lit = (s: string) => `'${slugOrganizacion(s) || CASA}'`;

/**
 * ¿Ya existen las columnas? Hasta que `asegurarOrganizacion` termine, la casa ve como siempre (sin
 * filtro, que es lo que había) y un cliente NO ve nada: si algo falla, falla cerrado para quien
 * no es de la casa, nunca abierto.
 */
let columnasListas = false;
function antesDeLasColumnas(org: string): string | null {
  if (columnasListas) return null;
  return org === CASA ? '' : ' AND false';
}

/** ` AND …` para documentos: lo sin organización es de la casa. Vacío fuera de un ámbito. */
export function sqlDocumentoVisible(alias = 'd'): string {
  const org = organizacionActual();
  if (org && antesDeLasColumnas(org) != null) return antesDeLasColumnas(org)!;
  return org ? ` AND coalesce(${alias}.organizacion, ${lit(CASA)}) = ${lit(org)}` : '';
}

/** ` AND …` para capas: las comunes (sin organización) las ve todo el mundo; las de un cliente, él. */
export function sqlCapaVisible(alias = 'k'): string {
  const org = organizacionActual();
  if (org && antesDeLasColumnas(org) != null) return antesDeLasColumnas(org)!;
  return org ? ` AND (${alias}.organizacion IS NULL OR ${alias}.organizacion = ${lit(org)})` : '';
}

/**
 * ` AND …` para CAMBIAR capas (mover, renombrar, borrar): la casa, las comunes y las suyas; un
 * cliente, solo las suyas. Ver una capa común no da derecho a borrarla.
 */
export function sqlCapaPropia(alias = 'k'): string {
  const org = organizacionActual();
  if (!org) return '';
  if (antesDeLasColumnas(org) != null) return antesDeLasColumnas(org)!;
  return org === CASA ? ` AND (${alias}.organizacion IS NULL OR ${alias}.organizacion = ${lit(CASA)})` : ` AND ${alias}.organizacion = ${lit(org)}`;
}

/** ` AND …` para carteras: como los documentos. */
export function sqlCarteraVisible(alias = 'c'): string {
  const org = organizacionActual();
  if (org && antesDeLasColumnas(org) != null) return antesDeLasColumnas(org)!;
  return org ? ` AND coalesce(${alias}.organizacion, ${lit(CASA)}) = ${lit(org)}` : '';
}

/** Con qué organización se guarda lo que se sube ahora. La casa guarda como siempre (sin marca). */
export function organizacionParaGuardar(): string | null {
  const org = organizacionActual();
  return org && org !== CASA ? org : null;
}

let asegurada: Promise<void> | null = null;
/**
 * Las columnas nuevas, si faltan. Solo AGREGA columnas nulas e índices: no reescribe ni borra
 * ninguna fila (es la misma migración que `scripts/electrum/esquema.sql` v11).
 */
export function asegurarOrganizacion(): Promise<void> {
  if (!asegurada) {
    asegurada = (async () => {
      // La bitácora la crea la biblioteca: tiene que existir antes de agregarle la columna.
      const { asegurarBiblioteca } = await import('./biblioteca');
      await asegurarBiblioteca();
      for (const t of ['documento', 'capa', 'cartera', 'biblioteca_bitacora']) {
        await consulta(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS organizacion text`);
        await consulta(`CREATE INDEX IF NOT EXISTS ${t}_organizacion_idx ON ${t} (organizacion)`);
      }
      /*
       * «Este archivo ya entró» es por organización: si un cliente sube el mismo PDF que ya tiene la
       * casa, entra como SUYO (si no, no lo vería nunca). Primero se crea el índice nuevo y solo
       * después se quita el viejo, así nunca queda la tabla sin protección contra duplicados. No
       * toca filas: lo sin organización cuenta como de la casa ('').
       */
      await consulta(
        `CREATE UNIQUE INDEX IF NOT EXISTS documento_huella_org_idx
           ON documento (huella, COALESCE(concesion_id, -1), COALESCE(organizacion, ''))
           WHERE huella IS NOT NULL`
      );
      await consulta(`DROP INDEX IF EXISTS documento_huella_idx`);
      const [f] = await consulta<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE column_name = 'organizacion' AND table_name IN ('documento', 'capa', 'cartera', 'biblioteca_bitacora')`
      );
      columnasListas = Number(f?.n) === 4;
      if (!columnasListas) throw new Error('faltan las columnas de organización');
    })().catch((e) => {
      asegurada = null;
      throw e;
    });
  }
  return asegurada;
}
