/**
 * IMPORTAR UNA CARPETA DEL CUBO — la forma fácil de meterle mucho a Dr Electrum.
 *
 * José sube carpetas enteras al cubo de expedientes con la página de carga (2 000 archivos, 1,6 GB
 * la de INDEXSA), y hasta hoy alguien tenía que bajarlas y pasarlas una por una. Esto las lee desde
 * el cubo, en el servidor, con el mismo `aprender` que la pantalla, y deja cada pieza en la carpeta
 * del panel que corresponde a su carpeta de origen.
 *
 * Lo que decide qué se hace con cada archivo es su EXTENSIÓN y sus vecinos:
 *
 *  - Un shapefile son cuatro o cinco archivos (.shp, .shx, .dbf, .prj, .cpg) que solo sirven juntos:
 *    se agrupan por nombre y entran como un .zip, igual que si se hubieran comprimido a mano.
 *  - Los acompañantes de un SIG (.sbn, .sbx, .lyr, .mxd, .qgz, .aux, .ovr, .pgw…) no son
 *    conocimiento: se cuentan como omitidos, con el motivo, para que nadie crea que se perdieron.
 *  - Las imágenes solo se leen si se pide (`imagenes`): cada una pasa por el modelo de visión, y en
 *    una carpeta de estudios escaneados son cientos de páginas que casi siempre existen también
 *    como PDF.
 *
 * Reanudable: lo que ya se importó queda con su original anotado (`archivo = s3://cubo/clave`), y
 * al relanzar la misma carpeta esas claves se saltan sin bajarlas. Un reinicio del servidor a mitad
 * de camino cuesta solo volver a pulsar «Importar».
 */
import JSZip from 'jszip';
import { aprender, huellaDe } from './aprender';
import { consulta, recalcularTraslapes } from './db';
import { organizacionParaGuardar } from './organizacion';
import { olvidarTablero } from './tablero';
import { anotar, anotarSinTexto, asegurarBiblioteca, normalizarCarpeta } from './biblioteca';
import { bajarExpediente, bucketExpedientes, carpetasExpedientes, listarExpedientes, type ObjetoS3 } from '../../lib/s3';

const MAX_BYTES = 64 * 1024 * 1024;

const DOC = /\.(pdf|docx|doc|rtf|pptx|xlsx|xlsm|txt|md|markdown)$/i;
const GEO_SUELTO = /\.(kml|kmz|geojson|json|csv|gpkg|dxf|zip)$/i;
const IMAGEN = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;
const PARTES_SHP = ['shp', 'shx', 'dbf', 'prj', 'cpg'];
/** Acompañantes de SIG y de oficina que no son conocimiento por sí mismos. */
const ACOMPANANTES = /\.(sbn|sbx|qpj|lyr|mxd|mxt|qgz|qgs|aux|ovr|pgw|pgwx|jgw|jgwx|tfw|tfwx|rmf|rmf~|sdw|sid|ecw|ico|ini|db|lock|atx|freelist|ixs|mxs|shp\.xml|aux\.xml|xml)$/i;

export type Unidad =
  | { tipo: 'documento' | 'geo' | 'imagen'; key: string; bytes: number; carpeta: string | null }
  | { tipo: 'shapefile'; key: string; partes: Record<string, ObjetoS3>; bytes: number; carpeta: string | null };

export type Plan = {
  unidades: Unidad[];
  omitidos: Array<{ key: string; motivo: string }>;
  resumen: Record<string, number>;
};

/** La carpeta del panel para una clave: la base más las subcarpetas que tenga dentro del prefijo. */
function carpetaDe(key: string, prefijo: string, base: string | null): string | null {
  const relativo = key.slice(prefijo.length);
  const dirs = relativo.split('/').slice(0, -1);
  return normalizarCarpeta([base || '', ...dirs].join('/'));
}

/** Qué se hace con cada archivo de la lista. Puro: no baja ni escribe nada. */
export function planear(objetos: ObjetoS3[], prefijo: string, base: string | null, opts: { imagenes?: boolean } = {}): Plan {
  const unidades: Unidad[] = [];
  const omitidos: Plan['omitidos'] = [];
  // Shapefiles: por carpeta + nombre sin extensión, sin distinguir mayúsculas (Geologia.SHP y .dbf).
  const grupos = new Map<string, Record<string, ObjetoS3>>();
  for (const o of objetos) {
    const m = /^(.*)\.(shp|shx|dbf|prj|cpg)$/i.exec(o.key);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const g = grupos.get(k) || {};
    g[m[2].toLowerCase()] = o;
    grupos.set(k, g);
  }
  const usados = new Set<string>();
  for (const g of grupos.values()) {
    if (!g.shp) continue;
    for (const p of Object.values(g)) usados.add(p.key);
    const bytes = Object.values(g).reduce((n, p) => n + p.bytes, 0);
    if (g.shp.bytes <= 100) {
      omitidos.push({ key: g.shp.key, motivo: 'shapefile vacío (sin geometrías)' });
      continue;
    }
    // El mismo tope que un archivo suelto, sobre el conjunto: se baja y se comprime entero en memoria.
    if (bytes > MAX_BYTES) {
      omitidos.push({ key: g.shp.key, motivo: `shapefile de más de ${MAX_BYTES / 1024 / 1024} MB entre todas sus partes` });
      continue;
    }
    unidades.push({ tipo: 'shapefile', key: g.shp.key, partes: g, bytes, carpeta: carpetaDe(g.shp.key, prefijo, base) });
  }
  for (const o of objetos) {
    if (usados.has(o.key)) continue;
    const nombre = o.key.split('/').pop() || o.key;
    const carpeta = carpetaDe(o.key, prefijo, base);
    if (nombre.startsWith('~$') || nombre.startsWith('.~lock')) omitidos.push({ key: o.key, motivo: 'archivo temporal de Office' });
    else if (!o.bytes) omitidos.push({ key: o.key, motivo: 'vacío' });
    else if (o.bytes > MAX_BYTES) omitidos.push({ key: o.key, motivo: `pesa más de ${MAX_BYTES / 1024 / 1024} MB` });
    else if (/\.dbf$/i.test(nombre)) omitidos.push({ key: o.key, motivo: 'tabla .dbf sin su .shp' });
    else if (/\.(shx|prj|cpg)$/i.test(nombre)) omitidos.push({ key: o.key, motivo: 'parte de un shapefile sin su .shp' });
    else if (ACOMPANANTES.test(nombre)) omitidos.push({ key: o.key, motivo: 'acompañante de SIG u oficina (no es un documento)' });
    else if (/\.rar$|\.7z$/i.test(nombre)) omitidos.push({ key: o.key, motivo: 'comprimido .rar/.7z: abrilo y subí lo de adentro' });
    else if (/\.(xls|ppt)$/i.test(nombre)) omitidos.push({ key: o.key, motivo: 'Office 97 (.xls/.ppt): guardalo como .xlsx/.pptx' });
    else if (DOC.test(nombre)) unidades.push({ tipo: 'documento', key: o.key, bytes: o.bytes, carpeta });
    else if (GEO_SUELTO.test(nombre)) unidades.push({ tipo: 'geo', key: o.key, bytes: o.bytes, carpeta });
    else if (IMAGEN.test(nombre)) {
      if (opts.imagenes) unidades.push({ tipo: 'imagen', key: o.key, bytes: o.bytes, carpeta });
      else omitidos.push({ key: o.key, motivo: 'imagen: no se pidió leer imágenes' });
    } else omitidos.push({ key: o.key, motivo: 'formato que no sé leer' });
  }
  const resumen: Record<string, number> = {};
  for (const u of unidades) resumen[u.tipo] = (resumen[u.tipo] || 0) + 1;
  resumen.omitidos = omitidos.length;
  return { unidades, omitidos, resumen };
}

/** Baja una unidad: un archivo, o las partes de un shapefile metidas en un .zip. */
async function bajarUnidad(u: Unidad): Promise<{ nombre: string; datos: Buffer } | { error: string }> {
  if (u.tipo !== 'shapefile') {
    const b = await bajarExpediente(u.key);
    if (!b.ok) return { error: b.detalle };
    return { nombre: u.key.split('/').pop() || u.key, datos: b.datos };
  }
  const zip = new JSZip();
  const base = (u.partes.shp.key.split('/').pop() || 'capa').replace(/\.shp$/i, '');
  for (const ext of PARTES_SHP) {
    const p = u.partes[ext];
    if (!p) continue;
    const b = await bajarExpediente(p.key);
    if (!b.ok) return { error: `${ext}: ${b.detalle}` };
    zip.file(`${base}.${ext}`, b.datos);
  }
  return { nombre: `${base}.zip`, datos: await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }) };
}

/* ------------------------------------------------------------------------------ en marcha */

/**
 * Dónde corre. El servicio web de Dr Electrum es un «starter» de Render: 512 MB y media CPU. Un PDF
 * escaneado de 25 MB pasado por pdf.js en el mismo proceso que contesta preguntas es pedir que se
 * caiga la conversación. Así que, si el servidor puede lanzar trabajos de Render (tiene su llave y
 * su id de servicio), la importación corre en un TRABAJO aparte —otra máquina, más grande, con las
 * mismas variables— y escribe su avance en la base, que es lo que mira el panel. Sin eso (en
 * desarrollo, en pruebas), corre en el mismo proceso.
 */
function puedeLanzarTrabajo(): boolean {
  return !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID) && process.env.ELECTRUM_IMPORTAR_EN_PROCESO !== '1';
}

/**
 * La API de trabajos de Render no acepta el nombre del plan («standard»): pide su id interno.
 * Medidos con trabajos de prueba el 27-09-2026 (límite del cgroup): 006 = starter (512 MB, ½ CPU),
 * 008 = standard (2 GB, 1 CPU), 010 = pro (4 GB, 2 CPU), 011 = pro plus (8 GB, 4 CPU).
 */
const PLANES_RENDER: Record<string, string> = {
  starter: 'plan-srv-006',
  standard: 'plan-srv-008',
  pro: 'plan-srv-010',
  pro_plus: 'plan-srv-011',
};

export function planDeTrabajo(valor = process.env.ELECTRUM_IMPORTAR_PLAN): string {
  const v = String(valor || 'standard').trim().toLowerCase();
  if (/^plan-srv-\d+$/.test(v)) return v;
  return PLANES_RENDER[v.replace(/[\s-]+/g, '_')] || PLANES_RENDER.standard;
}

async function lanzarTrabajo(id: number): Promise<{ ok: boolean; detalle: string }> {
  const plan = planDeTrabajo();
  try {
    const r = await fetch(`https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/jobs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RENDER_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ startCommand: `node build-server/importar-cubo.cjs ${id}`, planId: plan }),
      signal: AbortSignal.timeout(20_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, detalle: `Render ${r.status}: ${String(j?.message || '').slice(0, 160)}` };
    return { ok: true, detalle: String(j?.id || '') };
  } catch (e: any) {
    return { ok: false, detalle: String(e?.message || e).slice(0, 160) };
  }
}

/** Lo que corre en ESTE proceso (una a la vez). */
let enProceso: number | null = null;

/**
 * Empieza a importar un prefijo del cubo. Devuelve el id de la importación; su avance se lee con
 * `importaciones`. Una a la vez: dos cargas grandes juntas se estorban.
 */
export async function iniciarImportacion(p: {
  prefijo: string;
  carpeta?: string | null;
  imagenes?: boolean;
  /** Traer también lo que alguien borró en el panel. Sin esto, lo borrado no vuelve solo. */
  borrados?: boolean;
  por?: string | null;
}): Promise<{ ok: true; id: number; plan: Plan['resumen']; total: number; yaEstaban: number; borrados: number; donde: string } | { ok: false; error: string }> {
  if (!bucketExpedientes()) return { ok: false, error: 'Falta ELECTRUM_EXPEDIENTES_BUCKET en el servidor.' };
  await asegurarBiblioteca();
  const [viva] = await consulta<{ id: number }>(
    `SELECT id FROM importacion WHERE estado IN ('en_curso', 'parando') AND actualizada > now() - interval '15 minutes' LIMIT 1`
  );
  if (viva) return { ok: false, error: `Ya hay una importación en marcha (la ${viva.id}). Esperá a que termine o parala.` };
  const prefijo = String(p.prefijo || '');
  if (!prefijo.startsWith('entrada/') || prefijo.includes('..') || !prefijo.endsWith('/')) {
    return { ok: false, error: 'Solo se importan carpetas de «entrada/».' };
  }
  const preparado = await preparar(prefijo, p.carpeta ?? null, !!p.imagenes, !!p.borrados);
  if ('error' in preparado) return { ok: false, error: preparado.error };
  const { plan, pendientes, base, borrados } = preparado;
  const yaEstaban = plan.unidades.length - pendientes.length - borrados.length;
  const omitidos = [
    ...plan.omitidos.map((o) => ({ key: o.key.slice(prefijo.length), r: 'omitido', d: o.motivo })),
    ...borrados.map((u) => ({ key: u.key.slice(prefijo.length), r: 'omitido', d: BORRADO })),
  ];
  const trabajo = puedeLanzarTrabajo();
  const [fila] = await consulta<{ id: number }>(
    `INSERT INTO importacion (prefijo, carpeta, total, omitidos, repetidos, hechos, por, detalle, donde, opciones)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      prefijo,
      base,
      plan.unidades.length,
      omitidos.length,
      yaEstaban,
      plan.unidades.length - pendientes.length,
      p.por || null,
      JSON.stringify(omitidos.slice(0, 1500)),
      trabajo ? 'trabajo' : 'servidor',
      JSON.stringify({ imagenes: !!p.imagenes, borrados: !!p.borrados }),
    ]
  );
  const id = Number(fila.id);
  await anotar(p.por, 'importar', `importación ${id}`, { prefijo, carpeta: base, total: plan.unidades.length, omitidos: omitidos.length, ya: yaEstaban, borrados: borrados.length });
  if (!pendientes.length) {
    await consulta(`UPDATE importacion SET estado = 'terminada', terminada = now() WHERE id = $1`, [id]);
  } else if (trabajo) {
    const l = await lanzarTrabajo(id);
    if (!l.ok) {
      await consulta(`UPDATE importacion SET estado = 'fallida', terminada = now(), trabajo = $2 WHERE id = $1`, [id, `no se lanzó: ${l.detalle}`]);
      return { ok: false, error: `No pude lanzar el trabajo de importación: ${l.detalle}` };
    }
    await consulta(`UPDATE importacion SET trabajo = $2 WHERE id = $1`, [id, l.detalle]);
  } else {
    if (enProceso) return { ok: false, error: `Ya hay una importación en marcha (la ${enProceso}).` };
    enProceso = id;
    void correrImportacion(id).finally(() => {
      enProceso = null;
    });
  }
  return { ok: true, id, plan: plan.resumen, total: plan.unidades.length, yaEstaban, borrados: borrados.length, donde: trabajo ? 'trabajo' : 'servidor' };
}

export const BORRADO = 'Se borró en el panel (está en la bitácora): no se vuelve a traer solo. Para traerlo, importá con «traer también lo borrado».';

/**
 * Lista el prefijo, arma el plan y quita lo que ya se importó (su original ya está anotado) y lo que
 * alguien BORRÓ en el panel. Sin eso, cada reimportación revivía lo borrado: los 18 escaneos que
 * tenían ya su versión con OCR volvieron como «sin texto» la primera vez que se reimportó.
 */
async function preparar(prefijo: string, carpeta: string | null, imagenes: boolean, traerBorrados = false) {
  const lista = await listarExpedientes(prefijo);
  if (!lista.ok) return { error: `No pude listar el cubo: ${lista.detalle}` };
  if (!lista.objetos.length) return { error: 'Esa carpeta está vacía.' };
  const base = normalizarCarpeta(carpeta ?? prefijo.slice('entrada/'.length).split('/').filter(Boolean).pop());
  const plan = planear(lista.objetos, prefijo, base, { imagenes });
  const bucket = bucketExpedientes();
  const origenes = plan.unidades.map((u) => `s3://${bucket}/${u.key}`);
  const ya = new Set<string>();
  for (let i = 0; i < origenes.length; i += 1000) {
    const tramo = origenes.slice(i, i + 1000);
    for (const t of ['documento', 'capa']) {
      const r = await consulta<{ archivo: string }>(`SELECT archivo FROM ${t} WHERE archivo = ANY($1::text[])`, [tramo]);
      for (const x of r) ya.add(x.archivo);
    }
  }
  const faltan = plan.unidades.filter((u) => !ya.has(`s3://${bucket}/${u.key}`));
  const borrado = traerBorrados ? new Set<string>() : await borradosEnPanel(faltan.map((u) => `s3://${bucket}/${u.key}`));
  const esBorrado = (u: Unidad) => borrado.has(`s3://${bucket}/${u.key}`);
  return { plan, base, pendientes: faltan.filter((u) => !esBorrado(u)), borrados: faltan.filter(esBorrado) };
}

/** Si un documento con este contenido se borró en el panel (la bitácora guarda su huella). */
export async function huellaBorrada(huella: string): Promise<boolean> {
  // Solo lo que borró ESTA organización (la casa guarda sin marca): que un cliente borre su copia de
  // un formulario no puede impedir que otro, o la casa, cargue la suya.
  const r = await consulta(
    `SELECT 1 FROM biblioteca_bitacora WHERE accion = 'eliminar' AND detalle->>'huella' = $1 AND organizacion IS NOT DISTINCT FROM $2 LIMIT 1`,
    [huella, organizacionParaGuardar()]
  );
  return r.length > 0;
}

/** De estos originales («s3://cubo/clave»), los que alguien borró en el panel: la bitácora lo sabe. */
export async function borradosEnPanel(originales: string[]): Promise<Set<string>> {
  const borrado = new Set<string>();
  for (let i = 0; i < originales.length; i += 1000) {
    const r = await consulta<{ archivo: string }>(
      `SELECT DISTINCT detalle->>'archivo' AS archivo FROM biblioteca_bitacora WHERE accion = 'eliminar' AND detalle->>'archivo' = ANY($1::text[])`,
      [originales.slice(i, i + 1000)]
    );
    for (const x of r) borrado.add(x.archivo);
  }
  return borrado;
}

export async function pararImportacion(id: number): Promise<boolean> {
  const r = await consulta(`UPDATE importacion SET estado = 'parando', actualizada = now() WHERE id = $1 AND estado = 'en_curso' RETURNING id`, [id]);
  return r.length > 0;
}

/**
 * Corre una importación ya creada: la usa el trabajo de Render (`build-server/importar-cubo.cjs <id>`) y,
 * sin trabajos, el propio servidor. Vuelve a listar y a planear en vez de fiarse de una lista
 * guardada: si José subió algo más a la carpeta entre medio, entra también.
 */
export async function correrImportacion(id: number): Promise<string> {
  await asegurarBiblioteca();
  const [f] = await consulta<{ prefijo: string; carpeta: string | null; por: string | null; opciones: any; estado: string }>(
    `SELECT prefijo, carpeta, por, opciones, estado FROM importacion WHERE id = $1`,
    [id]
  );
  if (!f) return 'no existe';
  if (f.estado !== 'en_curso') return f.estado;
  const preparado = await preparar(f.prefijo, f.carpeta, !!f.opciones?.imagenes, !!f.opciones?.borrados);
  if ('error' in preparado) {
    await consulta(`UPDATE importacion SET estado = 'fallida', terminada = now() WHERE id = $1`, [id]);
    return 'fallida';
  }
  // Si entraron archivos nuevos a la carpeta desde que se creó, el total lo refleja.
  await consulta(`UPDATE importacion SET total = GREATEST(total, $2), omitidos = GREATEST(omitidos, $3) WHERE id = $1`, [
    id,
    preparado.plan.unidades.length,
    preparado.plan.omitidos.length,
  ]);
  return correr(id, f.prefijo, preparado.pendientes, f.por, !!f.opciones?.borrados);
}

async function correr(id: number, prefijo: string, unidades: Unidad[], por: string | null, traerBorrados = false): Promise<string> {
  const bucket = bucketExpedientes();
  let capasNuevas = 0;
  let estadoFinal = 'terminada';
  // Documentos primero, después lo geográfico: si se para a la mitad, lo que más se consulta ya está.
  const orden = { documento: 0, geo: 1, shapefile: 1, imagen: 2 } as const;
  unidades.sort((a, b) => orden[a.tipo] - orden[b.tipo] || a.key.localeCompare(b.key));
  try {
    for (const u of unidades) {
      const [e] = await consulta<{ estado: string }>(`SELECT estado FROM importacion WHERE id = $1`, [id]);
      if (e?.estado === 'parando') {
        estadoFinal = 'parada';
        break;
      }
      const rel = u.key.slice(prefijo.length);
      let r: 'nuevo' | 'repetido' | 'fallo' | 'omitido' = 'fallo';
      let dicho = '';
      try {
        const b = await bajarUnidad(u);
        if ('error' in b) dicho = `no pude bajarlo: ${b.error}`;
        else if (!traerBorrados && (u.tipo === 'documento' || u.tipo === 'imagen') && (await huellaBorrada(huellaDe(b.datos)))) {
          // El mismo archivo con otro nombre o en otra carpeta del cubo: lo que se borró fue su
          // CONTENIDO, y no vuelve por la puerta de al lado.
          r = 'omitido';
          dicho = BORRADO;
        } else {
          const a = await aprender(b.nombre, b.datos, {
            subidoPor: por || undefined,
            carpeta: u.carpeta,
            archivo: `s3://${bucket}/${u.key}`,
            sinTraslapes: true,
          });
          dicho = a.dicho;
          if (a.clase === 'nada' && (a.ui as any)?.escaneo) {
            const id2 = await anotarSinTexto({
              nombre: b.nombre,
              datos: b.datos,
              carpeta: u.carpeta,
              archivo: `s3://${bucket}/${u.key}`,
              por,
              motivo: a.dicho,
              paginas: (a.ui as any)?.paginas ?? null,
            }).catch(() => null);
            r = 'fallo';
            if (id2) dicho = `Escaneo sin texto: quedó en el panel como «sin texto» para pasarlo por OCR y releerlo.`;
          } else if (a.clase === 'nada') r = 'fallo';
          else if ((a.ui as any)?.repetido) r = 'repetido';
          else {
            r = 'nuevo';
            if (a.clase === 'catastro' && (a.ui as any)?.capa_id) capasNuevas++;
          }
        }
      } catch (err: any) {
        dicho = String(err?.message || err);
      }
      await consulta(
        `UPDATE importacion
            SET hechos = hechos + 1,
                nuevos = nuevos + $2, repetidos = repetidos + $3, fallos = fallos + $4, omitidos = omitidos + $6,
                actualizada = now(),
                detalle = CASE WHEN jsonb_array_length(detalle) < 4000 THEN detalle || $5::jsonb ELSE detalle END
          WHERE id = $1`,
        [id, r === 'nuevo' ? 1 : 0, r === 'repetido' ? 1 : 0, r === 'fallo' ? 1 : 0, JSON.stringify([{ key: rel, r, d: dicho.slice(0, 240) }]), r === 'omitido' ? 1 : 0]
      ).catch(() => {});
      // Que el proceso respire entre archivo y archivo.
      await new Promise((ok) => setImmediate(ok));
    }
    if (capasNuevas) {
      await recalcularTraslapes().catch((err) => console.error('[importar] traslapes:', String(err?.message || err).slice(0, 160)));
      olvidarTablero();
    }
  } catch (err: any) {
    estadoFinal = 'fallida';
    console.error('[importar] se cayó:', String(err?.message || err).slice(0, 200));
  }
  await consulta(`UPDATE importacion SET estado = $2, terminada = now(), actualizada = now() WHERE id = $1`, [id, estadoFinal]).catch(() => {});
  await anotar(por, 'importar', `importación ${id}`, { estado: estadoFinal, capasNuevas });
  return estadoFinal;
}

export async function importaciones(limite = 20) {
  await asegurarBiblioteca();
  return consulta<any>(
    `SELECT id, prefijo, carpeta, total, hechos, nuevos, repetidos, fallos, omitidos, por, iniciada, actualizada, terminada, donde, opciones,
            CASE WHEN estado IN ('en_curso', 'parando') AND actualizada < now() - interval '15 minutes' THEN 'interrumpida' ELSE estado END AS estado
       FROM importacion ORDER BY iniciada DESC LIMIT $1`,
    [Math.max(1, Math.min(100, limite))]
  );
}

/** Una importación con su detalle, filtrable por resultado (nuevo, repetido, fallo, omitido). */
export async function importacion(id: number, resultado?: string) {
  await asegurarBiblioteca();
  const [f] = await consulta<any>(`SELECT * FROM importacion WHERE id = $1`, [id]);
  if (!f) return null;
  const detalle = Array.isArray(f.detalle) ? f.detalle : [];
  return { ...f, detalle: resultado ? detalle.filter((x: any) => x.r === resultado) : detalle };
}

/** Las carpetas de primer nivel del cubo, con la última importación de cada una. */
export async function carpetasDelCubo() {
  await asegurarBiblioteca();
  const c = await carpetasExpedientes('entrada/');
  if (!c.ok) return { ok: false as const, error: c.detalle, carpetas: [] };
  const ultimas = await consulta<{ prefijo: string; id: number; estado: string; terminada: string | null; nuevos: number; fallos: number }>(
    `SELECT DISTINCT ON (prefijo) prefijo, id, estado, terminada, nuevos, fallos FROM importacion ORDER BY prefijo, iniciada DESC`
  );
  const por = new Map(ultimas.map((u) => [u.prefijo, u]));
  return {
    ok: true as const,
    carpetas: c.carpetas.map((prefijo) => ({
      prefijo,
      nombre: prefijo.slice('entrada/'.length).replace(/\/$/, ''),
      ultima: por.get(prefijo) || null,
    })),
  };
}
