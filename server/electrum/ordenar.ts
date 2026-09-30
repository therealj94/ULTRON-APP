/**
 * Ordenar el catastro: que haya UNO.
 *
 * Se habían ido subiendo varias versiones a la vez —el catastro nacional de junio de 2026, trece
 * capas «por estado» de otra exportación, los polígonos de los proyectos propios, zonas de estudio
 * de JICA— y todo lo que tenía titular entró como concesión. Resultado: 1782 «concesiones» donde el
 * catastro oficial trae 1080, y cada una traslapada con su propia copia (219 traslapes entre
 * concesiones del mismo nombre). Las cifras, los vencimientos y los conflictos salían de esa mezcla.
 *
 * Aquí se decide, capa por capa, qué es cada cosa:
 *
 *  - `oficial`   el catastro vigente. Se queda en `concesion`: es lo único que cuentan las
 *                herramientas, el tablero y el mapa principal.
 *  - `borrar`    una versión vieja del mismo catastro (casi todas sus concesiones caen dentro de
 *                una oficial). Se borra como en el panel: con bitácora, así una reimportación del
 *                cubo no la vuelve a traer. El original en el cubo no se toca.
 *  - `historico` estudios viejos (JICA…): pasan a entidades con rol `historico`. Se ven en el mapa
 *                como capa que se enciende a mano, no como catastro.
 *  - `proyecto`  polígonos propios: igual, con rol `proyecto`.
 *  - `dejar`     no se toca.
 *
 * Primero se PROPONE (nada cambia) y quien tiene mando revisa y aplica. La propuesta es una
 * sugerencia calculada en la base, no una decisión: quien conoce los datos corrige lo que haga falta.
 */
import { consulta, enTransaccion, hayBase, hayCarteras, recalcularTraslapes } from './db';
import { olvidarTablero } from './tablero';

export type Accion = 'oficial' | 'borrar' | 'historico' | 'proyecto' | 'dejar';
export const ACCIONES: Accion[] = ['oficial', 'borrar', 'historico', 'proyecto', 'dejar'];

export type FilaPropuesta = {
  capaId: number;
  nombre: string;
  carpeta: string | null;
  /** Concesiones que tiene hoy en `concesion`; 0 si es una capa de entidades (p. ej. zonas de JICA). */
  concesiones: number;
  /** De esas, cuántas caen casi enteras (≥ 80 % del área) dentro de una concesión oficial. */
  repetidas: number;
  rol: string | null;
  accion: Accion;
  motivo: string;
};

/** Una capa cuyas concesiones son, en su mayoría, copias de las oficiales es una versión vieja. */
const PARTE_REPETIDA = 0.6;
const ES_HISTORICO = /(^|[^a-z])(jica|mmaj)([^a-z]|$)|hist[oó]ric/i;

/**
 * La capa oficial por defecto: la de más concesiones cuyo nombre diga que es el catastro o los
 * derechos mineros; si ninguna lo dice, la de más concesiones.
 */
function elegirOficial(capas: Array<{ id: number; nombre: string; n: number; subido: string }>): number | null {
  if (!capas.length) return null;
  const porNombre = capas.filter((c) => /derechos mineros|catastro/i.test(c.nombre));
  const de = porNombre.length ? porNombre : capas;
  // El de más concesiones; a igualdad (el mismo catastro subido dos veces), el más reciente.
  return [...de].sort((a, b) => b.n - a.n || b.subido.localeCompare(a.subido))[0].id;
}

/**
 * Una capa con nombre de capa del catastro («CONCESIÓN METÁLICA OTORGADA PARA EXPLORAR»,
 * «ARTESANAL NO METÁLICA DELIMITADA»…) cuyas concesiones ya están en el oficial es una exportación
 * vieja del mismo padrón. Una capa chica con otro nombre («MINAS DE ORO I», «Monarka») que calza
 * con el oficial es un proyecto propio dibujado sobre su derecho: no se borra, pasa a proyecto.
 */
const ES_CAPA_CATASTRO = /concesi[oó]n|derechos? miner|catastro|artesanal|delimitad|otorgad|solicitud|explotar|explorar|suspenso|peque.a miner|banco de pr/i;

export async function proponer(oficialId?: number | null): Promise<{ oficial: number | null; filas: FilaPropuesta[] }> {
  if (!hayBase()) return { oficial: null, filas: [] };
  const conConcesiones = await consulta<{ id: string; nombre: string; carpeta: string | null; rol: string | null; n: number; subido: string }>(
    `SELECT k.id::text, k.nombre, k.carpeta, k.rol, count(c.id)::int AS n, k.subido::text AS subido
       FROM capa k JOIN concesion c ON c.capa_id = k.id
      GROUP BY k.id ORDER BY n DESC`
  );
  const capas = conConcesiones.map((c) => ({ ...c, id: Number(c.id) }));
  const oficial = oficialId && capas.some((c) => c.id === oficialId) ? oficialId : elegirOficial(capas);

  // Cuántas concesiones de cada capa caen casi enteras dentro de una oficial: la huella de una copia.
  const repetidas = oficial
    ? await consulta<{ capa_id: string; n: number }>(
        `SELECT c.capa_id::text, count(*)::int AS n
           FROM concesion c
          WHERE c.capa_id <> $1
            AND EXISTS (SELECT 1 FROM concesion o
                         WHERE o.capa_id = $1 AND o.geom && c.geom AND ST_Intersects(o.geom, c.geom)
                           AND ST_Area(ST_Intersection(o.geom, c.geom)) >= 0.8 * ST_Area(c.geom))
          GROUP BY c.capa_id`,
        [oficial]
      )
    : [];
  const rep = new Map(repetidas.map((r) => [Number(r.capa_id), r.n]));

  const filas: FilaPropuesta[] = capas.map((c) => {
    const r = rep.get(c.id) || 0;
    const base = { capaId: c.id, nombre: c.nombre, carpeta: c.carpeta, concesiones: c.n, repetidas: r, rol: c.rol };
    if (c.id === oficial) return { ...base, accion: 'oficial', motivo: 'Catastro vigente: el que cuentan las herramientas y el mapa.' };
    if (ES_HISTORICO.test(`${c.nombre} ${c.carpeta || ''}`)) return { ...base, accion: 'historico', motivo: 'Estudio viejo (JICA): contexto, no catastro.' };
    if (c.n > 0 && r / c.n >= PARTE_REPETIDA && (ES_CAPA_CATASTRO.test(c.nombre) || c.n > 5)) {
      return { ...base, accion: 'borrar', motivo: `${r} de ${c.n} ya están en el catastro oficial: es una versión vieja del mismo.` };
    }
    return {
      ...base,
      accion: 'proyecto',
      motivo: r
        ? `${r} de ${c.n} calzan con derechos del oficial: queda como proyecto y esos derechos entran a la cartera «${nombreCartera(c)}».`
        : 'Polígonos propios: se ven en el mapa, no cuentan como catastro.',
    };
  });

  // Las capas de entidades con nombre de JICA que todavía no tienen rol también se proponen.
  const jica = await consulta<{ id: string; nombre: string; carpeta: string | null; rol: string | null }>(
    `SELECT k.id::text, k.nombre, k.carpeta, k.rol FROM capa k
      WHERE (k.rol IS NULL OR k.rol NOT IN ('historico', 'litologia', 'falla', 'ocurrencia'))
        AND (k.nombre ~* '(^|[^a-z])(jica|mmaj)([^a-z]|$)' OR k.carpeta ~* '(^|[^a-z])(jica|mmaj)([^a-z]|$)')
        AND NOT EXISTS (SELECT 1 FROM concesion c WHERE c.capa_id = k.id)
        AND EXISTS (SELECT 1 FROM entidad_geo e WHERE e.capa_id = k.id)`
  );
  for (const k of jica) {
    filas.push({ capaId: Number(k.id), nombre: k.nombre, carpeta: k.carpeta, concesiones: 0, repetidas: 0, rol: k.rol, accion: 'historico', motivo: 'Capa de JICA: se muestra como histórico.' });
  }
  /*
   * Capas de geografía repetidas: las mismas áreas protegidas o microcuencas subidas dos veces
   * (mismo rol y mismo nombre, o la misma huella). La ficha las contaba dos veces y el tablero,
   * también. Se queda la más reciente.
   */
  const refs = await consulta<{ id: string; nombre: string; carpeta: string | null; rol: string | null; n: number; subido: string; huella: string | null }>(
    `SELECT k.id::text, k.nombre, k.carpeta, k.rol, (SELECT count(*)::int FROM entidad_geo e WHERE e.capa_id = k.id) AS n,
            k.subido::text AS subido, ${await conHuella() ? 'k.huella' : 'NULL::text AS huella'}
       FROM capa k
      WHERE k.rol IS NOT NULL AND NOT EXISTS (SELECT 1 FROM concesion c WHERE c.capa_id = k.id)`
  ).catch(() => []);
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const grupos = new Map<string, typeof refs>();
  for (const k of refs) {
    const clave = k.huella ? `h:${k.huella}` : `n:${k.rol}:${norm(k.nombre)}:${k.n}`;
    grupos.set(clave, [...(grupos.get(clave) || []), k]);
  }
  const yaEsta = new Set(filas.map((f) => f.capaId));
  for (const xs of grupos.values()) {
    if (xs.length < 2) continue;
    const [queda, ...viejas] = [...xs].sort((a, b) => b.subido.localeCompare(a.subido));
    for (const k of viejas) {
      if (yaEsta.has(Number(k.id))) continue;
      filas.push({
        capaId: Number(k.id), nombre: k.nombre, carpeta: k.carpeta, concesiones: 0, repetidas: 0, rol: k.rol, accion: 'borrar',
        motivo: `Copia de «${queda.nombre}» (misma capa, ${k.n} rasgos): se queda la más reciente.`,
      });
    }
  }
  return { oficial, filas };
}

let huellaCapa: Promise<boolean> | null = null;
function conHuella(): Promise<boolean> {
  huellaCapa ||= consulta<{ si: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'capa' AND column_name = 'huella') AS si`
  ).then((r) => !!r[0]?.si).catch(() => ((huellaCapa = null), false));
  return huellaCapa;
}

/** La cartera a la que van los derechos de una capa de proyecto: su carpeta, o «Proyectos propios». */
function nombreCartera(c: { carpeta: string | null }): string {
  const hoja = (c.carpeta || '').split('/').map((x) => x.trim()).filter(Boolean).pop();
  return hoja || 'Proyectos propios';
}

export type Resultado = {
  ok: boolean;
  dicho: string;
  borradas: number;
  aReferencia: number;
  concesionesAntes: number;
  concesionesDespues: number;
  traslapes: number | null;
};

/**
 * Aplica lo decidido. Todo en UNA transacción: un catastro a medio ordenar es peor que el desorden
 * de antes. Los traslapes se recalculan al final, fuera, porque son del padrón entero.
 */
export async function aplicar(decision: Array<{ capaId: number; accion: Accion }>, quien?: string | null): Promise<Resultado> {
  const nada = { borradas: 0, aReferencia: 0, concesionesAntes: 0, concesionesDespues: 0, traslapes: null };
  if (!hayBase()) return { ok: false, dicho: 'El catastro no está conectado.', ...nada };
  const limpia = decision.filter((d) => Number.isInteger(d.capaId) && d.capaId > 0 && ACCIONES.includes(d.accion));
  if (!limpia.some((d) => d.accion === 'oficial')) {
    return { ok: false, dicho: 'Falta decir cuál es el catastro oficial: sin él no se ordena nada.', ...nada };
  }
  const de = (a: Accion) => limpia.filter((d) => d.accion === a).map((d) => d.capaId);
  const [antes] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM concesion`);

  const carterasListas = await hayCarteras();
  const { borradas, aReferencia, enCarteras } = await enTransaccion(async (q) => {
    let borradas = 0;
    let aReferencia = 0;

    const borrar = de('borrar');
    if (borrar.length) {
      const conc = await q(`SELECT capa_id, count(*)::int AS n FROM concesion WHERE capa_id = ANY($1::bigint[]) GROUP BY capa_id`, [borrar]);
      const porCapa = new Map((conc as any[]).map((x) => [Number(x.capa_id), Number(x.n)]));
      const r = await q(`DELETE FROM capa WHERE id = ANY($1::bigint[]) RETURNING id, nombre, archivo`, [borrar]);
      // Misma anotación que el borrado del panel: con el original anotado, reimportar no lo revive.
      for (const x of r as any[]) {
        await q(`INSERT INTO biblioteca_bitacora (quien, accion, objeto, detalle) VALUES ($1, 'eliminar', $2, $3)`, [
          quien || null,
          `capa ${x.id}`,
          JSON.stringify({ nombre: x.nombre, archivo: x.archivo || null, concesiones: porCapa.get(Number(x.id)) || 0, por: 'ordenar catastro' }),
        ]);
      }
      borradas = r.length;
    }

    /*
     * Antes de mover los proyectos: los derechos del oficial sobre los que están dibujados (≥ 80 %
     * del polígono dentro) quedan en una cartera por carpeta, para poder analizarlos juntos.
     */
    const proyectos = de('proyecto');
    const oficial = de('oficial')[0];
    let enCarteras = 0;
    if (proyectos.length && oficial && carterasListas) {
      const pares = (await q(
        `SELECT DISTINCT ON (o.huella) k.carpeta, o.huella, o.expediente, o.nombre, o.atributos
           FROM concesion c
           JOIN capa k ON k.id = c.capa_id
           JOIN concesion o ON o.capa_id = $2 AND o.geom && c.geom AND ST_Intersects(o.geom, c.geom)
                            AND ST_Area(ST_Intersection(o.geom, c.geom)) >= 0.8 * ST_Area(c.geom)
          WHERE c.capa_id = ANY($1::bigint[])`,
        [proyectos, oficial]
      )) as Array<{ carpeta: string | null; huella: string; expediente: string | null; nombre: string; atributos: unknown }>;
      const porCartera = new Map<string, typeof pares>();
      for (const x of pares) {
        const n = nombreCartera(x);
        porCartera.set(n, [...(porCartera.get(n) || []), x]);
      }
      for (const [nombre, xs] of porCartera) {
        const [k] = (await q(
          `INSERT INTO cartera (nombre, origen, por) VALUES ($1, 'ordenar catastro', $2)
           ON CONFLICT (nombre) DO UPDATE SET actualizada = now() RETURNING id`,
          [nombre, quien || null]
        )) as Array<{ id: string }>;
        await q(
          `INSERT INTO cartera_concesion (cartera_id, huella, expediente, nombre, atributos)
           SELECT $1, x.huella, x.expediente, x.nombre, coalesce(x.atributos, '{}'::jsonb)
             FROM jsonb_to_recordset($2::jsonb) AS x(huella text, expediente text, nombre text, atributos jsonb)
           ON CONFLICT (cartera_id, huella) DO NOTHING`,
          [k.id, JSON.stringify(xs.map(({ huella, expediente, nombre, atributos }) => ({ huella, expediente, nombre, atributos })))]
        );
        enCarteras += xs.length;
      }
    }

    for (const rol of ['historico', 'proyecto'] as const) {
      const ids = de(rol);
      if (!ids.length) continue;
      // Las concesiones de esas capas pasan a ser entidades de referencia, con todo lo que traían.
      await q(
        `INSERT INTO entidad_geo (capa_id, nombre, clase, atributos, geom)
         SELECT capa_id, nombre, $2,
                atributos || jsonb_strip_nulls(jsonb_build_object('expediente', expediente, 'titular', titular,
                  'estado', estado, 'mineral', mineral, 'hectareas', hectareas)),
                geom
           FROM concesion WHERE capa_id = ANY($1::bigint[])`,
        [ids, rol]
      );
      await q(`DELETE FROM concesion WHERE capa_id = ANY($1::bigint[])`, [ids]);
      const r = await q(`UPDATE capa SET rol = $2 WHERE id = ANY($1::bigint[]) RETURNING id, nombre`, [ids, rol]);
      for (const x of r as any[]) {
        await q(`INSERT INTO biblioteca_bitacora (quien, accion, objeto, detalle) VALUES ($1, 'rol', $2, $3)`, [
          quien || null,
          `capa ${x.id}`,
          JSON.stringify({ nombre: x.nombre, rol, por: 'ordenar catastro' }),
        ]);
      }
      aReferencia += r.length;
    }
    return { borradas, aReferencia, enCarteras };
  });

  olvidarTablero();
  const traslapes = await recalcularTraslapes().catch((e) => {
    console.error('[ordenar] no pude recalcular los traslapes:', String(e?.message || e).slice(0, 200));
    return null;
  });
  const [despues] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM concesion`);
  return {
    ok: true,
    dicho:
      `Catastro ordenado: quedan ${despues.n} concesiones (antes ${antes.n}). ` +
      `${borradas} capa(s) borradas, ${aReferencia} pasadas a referencia (histórico o proyecto).` +
      (enCarteras ? ` ${enCarteras} derecho(s) del oficial bajo tus proyectos quedaron en carteras para analizarlos juntos.` : '') +
      (traslapes == null ? ' Los traslapes no se pudieron recalcular: hay que reintentarlo.' : ` Traslapes recalculados: ${traslapes}.`),
    borradas,
    aReferencia,
    concesionesAntes: antes.n,
    concesionesDespues: despues.n,
    traslapes,
  };
}

/**
 * De dónde sale el catastro que se está contando, para decirlo en cada resumen: con UNA capa, su
 * nombre es la fecha de corte; con varias, está sin ordenar y las cifras pueden contar copias.
 */
export async function fuenteCatastro(): Promise<{ capas: Array<{ nombre: string; n: number }>; historico: number; proyecto: number }> {
  const [capas, ref] = await Promise.all([
    consulta<{ nombre: string; n: number }>(
      `SELECT k.nombre, count(*)::int AS n FROM concesion c JOIN capa k ON k.id = c.capa_id GROUP BY k.id ORDER BY n DESC`
    ),
    consulta<{ rol: string; n: number }>(`SELECT rol, count(*)::int AS n FROM capa WHERE rol IN ('historico', 'proyecto') GROUP BY rol`).catch(() => []),
  ]);
  const de = (rol: string) => ref.find((r) => r.rol === rol)?.n || 0;
  return { capas, historico: de('historico'), proyecto: de('proyecto') };
}

/** La frase que va delante de las cifras del catastro. */
export function fraseFuente(f: Awaited<ReturnType<typeof fuenteCatastro>>): string {
  const ref = [f.proyecto ? `${f.proyecto} de proyectos propios` : '', f.historico ? `${f.historico} históricas (JICA y otras)` : ''].filter(Boolean).join(' y ');
  const aparte = ref ? ` Aparte, como referencia que no cuenta en las cifras: ${ref} capa(s).` : '';
  if (!f.capas.length) return '';
  if (f.capas.length === 1) return `Catastro vigente: «${f.capas[0].nombre}».${aparte}`;
  return (
    `OJO: el catastro está sin ordenar, hay ${f.capas.length} capas de concesiones mezcladas (${f.capas
      .slice(0, 4)
      .map((c) => `«${c.nombre}» ${c.n}`)
      .join(', ')}${f.capas.length > 4 ? '…' : ''}); las cifras pueden contar la misma concesión dos veces. Se ordena en Infraestructura → «Ordenar catastro».` + aparte
  );
}

/** ¿Este documento o capa es de un estudio viejo (JICA-MMAJ…)? Se cita como antecedente, no como hoy. */
export function esHistorico(nombre: string | null | undefined): boolean {
  return ES_HISTORICO.test(String(nombre || ''));
}
