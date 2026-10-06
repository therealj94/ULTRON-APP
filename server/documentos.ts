/**
 * LOS DOCUMENTOS DE OFICINA EN EL SERVIDOR (FILE-01/FILE-02): la herramienta del cerebro y la descarga.
 *
 *   PEDIR_HERRAMIENTA: documento {"archivos":[{tipo, nombre, spec}, …]}   (o la herramienta nativa crear_documento)
 *   GET /api/documentos/:id    → los bytes, solo con la sesión de su dueño
 *
 * La herramienta corre lib/oficina/entrega.ts (generar → validar → entregar con recibo) para el dueño VERIFICADO del
 * turno; sin sesión no hay de quién serían los archivos y no se hace nada. Un invitado (server/modo-invitado.ts) no la
 * tiene: el turno pierde la sesión y las manos privadas.
 *
 * La descarga: la persona sale SIEMPRE de la sesión firmada (nunca de la consulta ni del cuerpo); la ficha del archivo
 * está bajo la huella de su dueño, así que con la sesión de otra cuenta es 404 (igual que un id inventado). Se sirve
 * con el MIME real del tipo, el nombre saneado (también en UTF-8), `nosniff`, sin caché compartida, y solo si el
 * sha256 de los bytes es el que se comprobó al generarlo. Vencido (AURA_DOCUMENTOS_DIAS), 410.
 */
import type express from 'express';
import { abrirDescarga, disposicionDescarga } from '../lib/oficina/almacen';
import { crearDocumentos, type ReciboLote } from '../lib/oficina/entrega';
import { exito, fallo, type ResultadoHerramienta } from '../lib/recibo-herramienta';
import { anotarTareaDelTurno, duenoDeTareas, pedidoDeDocumentos } from './trabajos';

export type DepsDocumentos = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo?: string } | null;
};

export function montarRutasDocumentos(app: express.Express, d: DepsDocumentos) {
  app.get('/api/documentos/:id', d.exigirMesa, d.limitar(60), async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const sesion = d.sesionDe(req);
    const dueno = duenoDeTareas(String(sesion?.correo || ''));
    if (!dueno) return res.status(sesion ? 403 : 401).json({ error: sesion ? 'Tus documentos van con tu cuenta de correo.' : 'Entra con tu sesión.', code: sesion ? 'sin_correo' : 'sesion_requerida', honesto: true });
    const r = await abrirDescarga(dueno, String(req.params.id || '')).catch((e) => ({ estado: 'almacen' as const, detalle: String(e?.message || e) }));
    if (r.estado === 'no') return res.status(404).json({ error: 'No encuentro ese archivo en tu cuenta.', honesto: true });
    if (r.estado === 'vencido') return res.status(410).json({ error: `«${r.m.nombre}» ya venció (se guardan unos días). Pídemelo otra vez y lo hago de nuevo.`, honesto: true });
    if (r.estado === 'danado') return res.status(409).json({ error: `«${r.m.nombre}» no coincide con el que comprobé al hacerlo: no te lo doy así. Pídemelo otra vez.`, code: 'huella_distinta', honesto: true });
    if (r.estado === 'almacen') return res.status(503).json({ error: 'No pude leer tus documentos en este momento. Prueba otra vez en un rato.', code: 'almacen_no_disponible', honesto: true });
    res.setHeader('Content-Type', r.m.mime);
    res.setHeader('Content-Length', String(r.datos.length));
    res.setHeader('Content-Disposition', disposicionDescarga(r.m.nombre));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Documento-Sha256', r.m.sha256);
    return res.end(r.datos);
  });
}

/** El recibo del lote → lo que contesta la herramienta (texto para el modelo, estado y recibo para la traza). */
export function resultadoDeLote(r: ReciboLote): ResultadoHerramienta {
  const texto = `HARNESS documento: ${r.texto}`;
  if (r.estado === 'completo') return exito(texto, { efecto: 'guardado', durable: true, ...(r.tareaId ? { referencia: r.tareaId } : {}) });
  if (r.estado === 'parcial') return exito(texto, { efecto: 'guardado', durable: true, incompleto: true, ...(r.tareaId ? { referencia: r.tareaId } : {}) });
  return fallo(texto, r.errores.length ? 'falta-dato' : 'no-se-pudo');
}

/**
 * La herramienta `documento` del turno. `pedido`: lo que la persona dijo o escribió en ESTE turno (de ahí salen los
 * requisitos: «informe.docx, presupuesto.xlsx y carta.pdf» son tres, con esos nombres y tipos).
 */
export async function correrDocumento(o: { dueno: string; arg: string; pedido?: string; senal?: AbortSignal }): Promise<ResultadoHerramienta> {
  const dueno = duenoDeTareas(o.dueno);
  if (!dueno) return fallo('HARNESS documento: solo para alguien con sesión (los archivos quedan en su cuenta). No hice ningún archivo: pídele que entre con su cuenta.', 'sin-sesion');
  let entrada: unknown;
  try {
    entrada = JSON.parse(String(o.arg || ''));
  } catch {
    return fallo('HARNESS documento: la especificación no es JSON válido (una sola línea con {"archivos":[…]}). No hice ningún archivo.', 'falta-dato');
  }
  const { requestId } = pedidoDeDocumentos(o.arg);
  const r = await crearDocumentos({
    dueno,
    requestId,
    entrada,
    instruccion: o.pedido,
    senal: o.senal,
    // El render con LibreOffice (si lo hay) cuesta segundos por archivo: solo si se pidió en el entorno.
    renderizar: process.env.AURA_OFICINA_RENDER === '1',
    alTarea: anotarTareaDelTurno,
  });
  return resultadoDeLote(r);
}
