/**
 * Las rutas del panel de infraestructura (`/api/electrum/biblioteca/...`).
 *
 * Quién puede qué:
 *  - Mirar (resumen, carpetas, lista, detalle, bitácora, importaciones): cualquiera que entre a Dr
 *    Electrum. Saber qué sabe el sistema es parte de poder creerle.
 *  - Ordenar (mover, renombrar, carpetas) y releer: nivel de TRABAJO.
 *  - Borrar e importar desde el cubo: solo MANDO. Borrar una capa se lleva sus concesiones, y una
 *    importación son horas de máquina.
 */
import type { Express, Request, Response } from 'express';
import { exigirPlataforma, identidadDe, limitar } from '../seguridad';
import { nivelDe } from '../../lib/acceso';
import { hayBase } from './db';
import {
  arbol,
  bitacora,
  detalle,
  eliminar,
  listar,
  mover,
  refsValidas,
  releer,
  renombrarCarpeta,
  renombrarItem,
  resumen,
} from './biblioteca';
import { carpetasDelCubo, importacion, importaciones, iniciarImportacion, pararImportacion } from './importar';

function nivel(req: Request) {
  return nivelDe(identidadDe(req), 'electrum');
}
function quien(req: Request) {
  return identidadDe(req)?.persona?.nombre || null;
}
function exigir(req: Request, res: Response, minimo: 'escribe' | 'mando'): boolean {
  const n = nivel(req);
  const ok = minimo === 'mando' ? n === 'mando' : n === 'escribe' || n === 'mando';
  if (!ok) {
    res.status(403).json({
      error: minimo === 'mando' ? 'Esto lo hace solo quien tiene nivel de mando (José).' : 'Tu acceso es de consulta: podés mirar, pero no cambiar nada.',
      code: 'nivel_insuficiente',
      honesto: true,
    });
  }
  return ok;
}
function sinBase(res: Response) {
  return res.status(503).json({ error: 'El catastro no está conectado en este servidor.', code: 'sin_base', honesto: true });
}
function fallo(res: Response, e: any, que: string) {
  console.error(`[biblioteca] ${que}:`, String(e?.message || e).slice(0, 200));
  return res.status(500).json({ error: `No pude ${que}. Probá de nuevo en un momento.`, honesto: true });
}

export function montarRutasBiblioteca(app: Express) {
  const E = exigirPlataforma('electrum');
  const R = '/api/electrum/biblioteca';

  app.get(`${R}/resumen`, E, limitar(120), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    try {
      return res.json({ ...(await resumen()), nivel: nivel(req), honesto: true });
    } catch (e) {
      return fallo(res, e, 'contar lo que hay');
    }
  });

  app.get(`${R}/arbol`, E, limitar(120), async (_req, res) => {
    if (!hayBase()) return sinBase(res);
    try {
      return res.json({ carpetas: await arbol(), honesto: true });
    } catch (e) {
      return fallo(res, e, 'armar las carpetas');
    }
  });

  app.get(`${R}/items`, E, limitar(240), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    const q = req.query as Record<string, string>;
    try {
      const r = await listar({
        carpeta: q.carpeta,
        subcarpetas: q.subcarpetas === '1',
        q: q.q ? String(q.q).trim() : undefined,
        estado: q.estado,
        clase: q.clase,
        orden: q.orden,
        dir: q.dir,
        desde: Number(q.desde) || 0,
        limite: Number(q.limite) || 100,
      });
      return res.json({ ...r, honesto: true });
    } catch (e) {
      return fallo(res, e, 'traer la lista');
    }
  });

  app.get(`${R}/item/:clase/:id`, E, limitar(240), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    const clase = req.params.clase;
    const id = Math.floor(Number(req.params.id));
    if ((clase !== 'documento' && clase !== 'capa') || !(id > 0)) return res.status(400).json({ error: 'Pieza inválida.', honesto: true });
    try {
      const d = await detalle(clase, id);
      if (!d) return res.status(404).json({ error: 'Ya no existe.', honesto: true });
      return res.json({ item: d, honesto: true });
    } catch (e) {
      return fallo(res, e, 'traer el detalle');
    }
  });

  app.post(`${R}/mover`, E, limitar(60), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    if (!exigir(req, res, 'escribe')) return;
    const refs = refsValidas(req.body?.items);
    if (!refs.length) return res.status(400).json({ error: 'No elegiste nada para mover.', honesto: true });
    try {
      return res.json({ ok: true, ...(await mover(refs, req.body?.carpeta, quien(req))), honesto: true });
    } catch (e) {
      return fallo(res, e, 'mover');
    }
  });

  app.post(`${R}/renombrar`, E, limitar(60), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    if (!exigir(req, res, 'escribe')) return;
    const [ref] = refsValidas([req.body]);
    if (!ref) return res.status(400).json({ error: 'Pieza inválida.', honesto: true });
    try {
      const r = await renombrarItem(ref, req.body?.nombre, quien(req));
      return r.ok === false ? res.status(400).json({ error: r.error, honesto: true }) : res.json({ ...r, honesto: true });
    } catch (e) {
      return fallo(res, e, 'renombrar');
    }
  });

  app.post(`${R}/carpeta`, E, limitar(60), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    if (!exigir(req, res, 'escribe')) return;
    try {
      const r = await renombrarCarpeta(req.body?.de, req.body?.a, quien(req));
      return r.ok === false ? res.status(400).json({ error: r.error, honesto: true }) : res.json({ ...r, honesto: true });
    } catch (e) {
      return fallo(res, e, 'cambiar la carpeta');
    }
  });

  app.post(`${R}/eliminar`, E, limitar(30), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    if (!exigir(req, res, 'mando')) return;
    const refs = refsValidas(req.body?.items);
    if (!refs.length) return res.status(400).json({ error: 'No elegiste nada para borrar.', honesto: true });
    // Una confirmación que el cliente tiene que mandar a propósito: un POST suelto no borra nada.
    if (req.body?.confirmo !== true) return res.status(400).json({ error: 'Falta confirmar el borrado.', code: 'sin_confirmar', honesto: true });
    try {
      return res.json({ ok: true, ...(await eliminar(refs, quien(req))), honesto: true });
    } catch (e) {
      return fallo(res, e, 'borrar');
    }
  });

  app.post(`${R}/releer/:id`, E, limitar(120), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    if (!exigir(req, res, 'escribe')) return;
    const id = Math.floor(Number(req.params.id));
    if (!(id > 0)) return res.status(400).json({ error: 'Documento inválido.', honesto: true });
    try {
      return res.json({ ...(await releer(id, quien(req))), honesto: true });
    } catch (e) {
      return fallo(res, e, 'releer');
    }
  });

  app.get(`${R}/bitacora`, E, limitar(60), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    try {
      return res.json({ entradas: await bitacora(Number(req.query.limite) || 100), honesto: true });
    } catch (e) {
      return fallo(res, e, 'leer la bitácora');
    }
  });

  app.get(`${R}/cubo`, E, limitar(30), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    if (!exigir(req, res, 'mando')) return;
    try {
      const r = await carpetasDelCubo();
      return r.ok === false ? res.status(502).json({ error: `No alcancé el cubo: ${r.error}`, honesto: true }) : res.json({ ...r, honesto: true });
    } catch (e) {
      return fallo(res, e, 'mirar el cubo');
    }
  });

  app.post(`${R}/importar`, E, limitar(10), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    if (!exigir(req, res, 'mando')) return;
    try {
      const r = await iniciarImportacion({
        prefijo: String(req.body?.prefijo || ''),
        carpeta: req.body?.carpeta ? String(req.body.carpeta) : null,
        imagenes: req.body?.imagenes === true,
        borrados: req.body?.borrados === true,
        por: quien(req),
      });
      return r.ok === false ? res.status(409).json({ error: r.error, honesto: true }) : res.json({ ...r, honesto: true });
    } catch (e) {
      return fallo(res, e, 'empezar la importación');
    }
  });

  app.get(`${R}/importaciones`, E, limitar(240), async (_req, res) => {
    if (!hayBase()) return sinBase(res);
    try {
      return res.json({ importaciones: await importaciones(), honesto: true });
    } catch (e) {
      return fallo(res, e, 'leer las importaciones');
    }
  });

  app.get(`${R}/importaciones/:id`, E, limitar(120), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    const id = Math.floor(Number(req.params.id));
    try {
      const r = await importacion(id, req.query.resultado ? String(req.query.resultado) : undefined);
      if (!r) return res.status(404).json({ error: 'No existe.', honesto: true });
      return res.json({ importacion: r, honesto: true });
    } catch (e) {
      return fallo(res, e, 'leer la importación');
    }
  });

  app.post(`${R}/importaciones/:id/parar`, E, limitar(30), async (req, res) => {
    if (!hayBase()) return sinBase(res);
    if (!exigir(req, res, 'mando')) return;
    try {
      const ok = await pararImportacion(Math.floor(Number(req.params.id)));
      return res.json({ ok, honesto: true });
    } catch (e) {
      return fallo(res, e, 'parar la importación');
    }
  });
}
