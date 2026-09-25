/**
 * LAS RUTAS DE LA CAPA COGNITIVA — trazas, auditoría, aprobaciones, reglas y estado.
 *
 * Cada despliegue sirve SOLO lo de su plataforma: el de Dr Electrum no enseña las trazas de la
 * junta aunque las dos plataformas compartan base. La plataforma sale de `PLATAFORMA`, nunca de un
 * parámetro de la petición.
 *
 * Quién ve qué:
 *  · Mando de la plataforma: todo (trazas de todos, auditoría, cola de aprobaciones).
 *  · Quien preguntó: su propia traza, y dejar su opinión sobre la respuesta.
 *  · Nadie más: nada. Sin sesión firmada no hay mando, diga lo que diga el cuerpo de la petición.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import { identidadDe, limitar, plataformaAutorizada } from './seguridad';
import { nivelDe, type Nivel } from '../lib/acceso';
import { PLATAFORMA } from '../lib/plataforma';
import { darFeedback, listarTrazas, resumenTrazas, trazaPorId } from '../lib/cognitivo/traza';
import { leerAuditoria, verificarCadena } from '../lib/cognitivo/auditoria';
import { tipo as tipoAlmacen } from '../lib/cognitivo/base';
import { firmar, listarAprobaciones, type EstadoAprobacion } from '../lib/cognitivo/aprobaciones';
import { evaluar, listarReglas, type Efecto } from '../lib/cognitivo/politica';
import { estadoCognitivo } from '../lib/cognitivo/estado';

export function nivelEnEsta(req: Request): { quien: string | null; nivel: Nivel | null } {
  const id = identidadDe(req);
  return { quien: id?.persona.id || null, nivel: nivelDe(id, PLATAFORMA) };
}

export function exigirMandoAqui(req: Request, res: Response, next: NextFunction) {
  const { quien, nivel } = nivelEnEsta(req);
  if (nivel === 'mando') {
    (req as any).quien = quien;
    return next();
  }
  return res.status(403).json({ error: 'Esto lo ve solo quien tiene mando en esta plataforma, con su sesión.', code: 'requiere_mando', honesto: true });
}

function numero(v: unknown, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function montarRutasCognitivas(app: Express) {
  app.get('/api/cognitivo/trazas', exigirMandoAqui, limitar(60), async (req, res) => {
    try {
      const trazas = await listarTrazas({
        plataforma: PLATAFORMA,
        quien: req.query.quien ? String(req.query.quien) : undefined,
        limite: numero(req.query.limite, 50),
        soloErrores: req.query.errores === '1',
        conPolitica: req.query.politica === '1',
      });
      res.json({ trazas, almacen: tipoAlmacen(), honesto: true });
    } catch (e: any) {
      res.status(503).json({ error: `No pude leer las trazas: ${String(e?.message || e).slice(0, 120)}`, honesto: true });
    }
  });

  app.get('/api/cognitivo/trazas/:id', limitar(60), async (req, res) => {
    const t = await trazaPorId(String(req.params.id)).catch(() => null);
    const { quien, nivel } = nivelEnEsta(req);
    if (!t || t.plataforma !== PLATAFORMA || (nivel !== 'mando' && (!quien || t.quien !== quien))) {
      return res.status(404).json({ error: 'No existe o no es tuya.', honesto: true });
    }
    res.json({ traza: t, honesto: true });
  });

  /**
   * «Sirvió / no sirvió.» Es la señal más barata y más honesta que hay sobre la calidad: la deja la
   * persona que recibió la respuesta. El id de la traza es un UUID que solo le llegó a ella, así que
   * sin sesión también vale (la APK a veces no la tiene); con sesión, tiene que ser la suya.
   */
  app.post('/api/cognitivo/trazas/:id/opinion', limitar(30), async (req, res) => {
    const valor = Number(req.body?.valor);
    if (valor !== 1 && valor !== -1) return res.status(400).json({ error: 'valor tiene que ser 1 o -1', honesto: true });
    if (!plataformaAutorizada(req, PLATAFORMA)) return res.status(401).json({ error: 'sin acceso', honesto: true });
    const t = await trazaPorId(String(req.params.id)).catch(() => null);
    const { quien, nivel } = nivelEnEsta(req);
    if (!t || t.plataforma !== PLATAFORMA) return res.status(404).json({ error: 'No existe.', honesto: true });
    if (t.quien && quien && t.quien !== quien && nivel !== 'mando') return res.status(403).json({ error: 'No es tuya.', honesto: true });
    const ok = await darFeedback(t.id, valor as 1 | -1, req.body?.nota ? String(req.body.nota) : null, quien).catch(() => false);
    res.json({ ok, honesto: true });
  });

  app.get('/api/cognitivo/resumen', exigirMandoAqui, limitar(30), async (req, res) => {
    try {
      res.json({ resumen: await resumenTrazas(PLATAFORMA, numero(req.query.horas, 24 * 7)), almacen: tipoAlmacen(), honesto: true });
    } catch (e: any) {
      res.status(503).json({ error: String(e?.message || e).slice(0, 160), honesto: true });
    }
  });

  app.get('/api/cognitivo/auditoria', exigirMandoAqui, limitar(30), async (req, res) => {
    try {
      const registros = (await leerAuditoria({ limite: numero(req.query.limite, 100), tipo: req.query.tipo ? String(req.query.tipo) : undefined })).filter(
        (r) => !r.plataforma || r.plataforma === PLATAFORMA
      );
      res.json({ registros, honesto: true });
    } catch (e: any) {
      res.status(503).json({ error: String(e?.message || e).slice(0, 160), honesto: true });
    }
  });

  app.get('/api/cognitivo/aprobaciones', exigirMandoAqui, limitar(60), async (req, res) => {
    try {
      const estado = req.query.estado ? (String(req.query.estado) as EstadoAprobacion) : undefined;
      res.json({ aprobaciones: await listarAprobaciones({ plataforma: PLATAFORMA, estado, limite: numero(req.query.limite, 50) }), honesto: true });
    } catch (e: any) {
      res.status(503).json({ error: String(e?.message || e).slice(0, 160), honesto: true });
    }
  });

  /** Firmar desde la pantalla. Quien firma es la sesión, no un campo del cuerpo. */
  app.post('/api/cognitivo/aprobaciones/:id', exigirMandoAqui, limitar(20), async (req, res) => {
    const decision = req.body?.decision === 'rechazar' ? 'rechazar' : req.body?.decision === 'aprobar' ? 'aprobar' : null;
    if (!decision) return res.status(400).json({ error: 'decision tiene que ser aprobar o rechazar', honesto: true });
    const { quien, nivel } = nivelEnEsta(req);
    try {
      const r = await firmar({ id: String(req.params.id), quien, nivel, plataforma: PLATAFORMA, decision, nota: req.body?.nota ? String(req.body.nota).slice(0, 400) : null });
      res.status(r.ok ? 200 : 409).json({ ...r, honesto: true });
    } catch (e: any) {
      res.status(503).json({ error: String(e?.message || e).slice(0, 160), honesto: true });
    }
  });

  /** Las reglas vigentes, a la vista de cualquiera con acceso: nada de reglas secretas. */
  app.get('/api/cognitivo/reglas', limitar(30), (req, res) => {
    if (!plataformaAutorizada(req, PLATAFORMA)) return res.status(401).json({ error: 'sin acceso', honesto: true });
    res.json({ reglas: listarReglas(), honesto: true });
  });

  /** «¿Qué pasaría si…?» Evalúa una acción hipotética sin ejecutar ni encolar nada. */
  app.post('/api/cognitivo/reglas/probar', exigirMandoAqui, limitar(30), (req, res) => {
    const b = req.body || {};
    const EFECTOS: Efecto[] = ['lectura', 'escritura', 'externo', 'sistema', 'critico'];
    if (!EFECTOS.includes(b.efecto)) return res.status(400).json({ error: `efecto tiene que ser uno de ${EFECTOS.join(', ')}`, honesto: true });
    const decision = evaluar({
      herramienta: String(b.herramienta || 'prueba'),
      efecto: b.efecto,
      plataforma: PLATAFORMA,
      args: typeof b.args === 'object' && b.args ? b.args : {},
      quien: b.quien ? String(b.quien) : null,
      nivel: ['lee', 'escribe', 'mando'].includes(b.nivel) ? b.nivel : null,
      prueba: ['sesion', 'telegram', 'nombre'].includes(b.prueba) ? b.prueba : null,
      riesgo: Number.isFinite(Number(b.riesgo)) ? Number(b.riesgo) : null,
      destino: b.destino === 'tercero' ? 'tercero' : b.destino === 'junta' ? 'junta' : null,
      hechos: typeof b.hechos === 'object' && b.hechos ? b.hechos : undefined,
    });
    res.json({ decision, honesto: true });
  });

  // Qué está conectado de verdad (T4, pgvector, MCP), medido en el momento. Solo mando: dice qué
  // servicios hay y dónde fallan, y eso no es para cualquiera.
  app.get('/api/cognitivo/estado', exigirMandoAqui, limitar(20), async (_req, res) => {
    try {
      const { configMcp } = await import('./mcp');
      const vectores =
        PLATAFORMA === 'electrum'
          ? async () => {
              const { coberturaVectores } = await import('./electrum/vectores');
              return coberturaVectores();
            }
          : undefined;
      const estado = await estadoCognitivo(PLATAFORMA, { vectores, mcp: () => { const c = configMcp(PLATAFORMA); return c.ok ? { ok: true } : { ok: false, motivo: (c as { motivo: string }).motivo }; } });
      res.json({ ...estado, honesto: true });
    } catch (e: any) {
      res.status(503).json({ error: `No pude medir el estado: ${String(e?.message || e).slice(0, 120)}`, honesto: true });
    }
  });

  app.get('/api/cognitivo/auditoria/verificar', exigirMandoAqui, limitar(10), async (_req, res) => {
    try {
      res.json({ ...(await verificarCadena()), honesto: true });
    } catch (e: any) {
      res.status(503).json({ error: String(e?.message || e).slice(0, 160), honesto: true });
    }
  });
}
