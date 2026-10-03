/**
 * LAS RUTAS DEL CEREBRO CONTINUO: lo que la app y Windows muestran y dejan corregir.
 *
 *   GET    /api/cerebro/episodios               → los últimos resúmenes de conversación
 *   GET    /api/cerebro/abiertos                → lo que quedó a medias (y lo cerrado hace poco)
 *   POST   /api/cerebro/abiertos/:id/cerrar {estado?: 'hecho' | 'descartado'}
 *   GET    /api/cerebro/conocer                 → lo que AU-RA sabe de la persona, por categoría, y lo que falta
 *   POST   /api/cerebro/conocer {categoria, dato, clave?} → un dato que la persona contó a mano (las
 *                                                  preguntas de la primera vez en la app): agregarDato
 *   DELETE /api/cerebro/conocer/:id             → olvida un dato
 *   POST   /api/cerebro/conocer/olvidar {ids?, claves?: [{categoria, clave}]} → olvida por id y por clave
 *                                                  común (todas las copias); { borrados, durable }
 *   GET    /api/circulo                         → su círculo cercano y qué se puede desde el servidor
 *   POST   /api/circulo {id?, nombre, relacion, canales, permisos?} → agrega (o cambia, con id)
 *   DELETE /api/circulo/:id
 *   GET    /api/triaje?canal=todo|whatsapp|correo → solo el dueño del WhatsApp (WHATSAPP_DUENOS)
 *
 * TODO es de la persona de la SESIÓN (su correo firmado): nada del cuerpo ni de la URL dice de quién es. Un
 * S3 que no se dejó leer es un 503 (no se escribió nada encima); lo malo, un 400 con la frase.
 */
import type express from 'express';
import { abiertosDe, cerradosDe, cerrar } from '../lib/abiertos';
import { CajonNoDisponible, clavePersona } from '../lib/cerebro-comun';
import { actualizarPersona, agregarPersona, capacidadesCirculo, circuloDe, ErrorCirculo, quitarPersona } from '../lib/circulo';
import { agregarDato, CATEGORIAS, NOMBRE_CATEGORIA, olvidarDato, olvidarPorClaves, olvidarTodo, queNoSe, queSeDe } from '../lib/conocer-persona';
import { episodiosDe } from '../lib/episodios';
import { triar, type FuentesTriaje } from '../lib/triaje';
import { whatsappPermitido } from './whatsapp';

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo: string; nombre?: string } | null;
  /** Pruebas: las fuentes del triaje (sin red). */
  fuentesTriaje?: FuentesTriaje;
  /** Pruebas: quién es dueño del WhatsApp (por omisión server/whatsapp.ts whatsappPermitido). */
  esDuenoWhatsapp?: (correo: string) => boolean;
};

export function montarRutasCerebroContinuo(app: express.Express, d: Deps) {
  const correoDe = (req: express.Request) =>
    String(d.sesionDe(req)?.correo || '')
      .trim()
      .toLowerCase();
  /** El correo de la sesión, o contesta 401 y devuelve ''. */
  const quien = (req: express.Request, res: express.Response): string => {
    res.setHeader('Cache-Control', 'no-store');
    const c = correoDe(req);
    if (!c || !clavePersona(c)) {
      res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
      return '';
    }
    return c;
  };
  const fallo = (res: express.Response, e: unknown) => {
    if (e instanceof CajonNoDisponible) return res.status(503).json({ error: e.message, code: 'no_disponible', honesto: true });
    if (e instanceof ErrorCirculo) return res.status(400).json({ error: e.message, honesto: true });
    return res.status(500).json({ error: `Falló (${String((e as any)?.message || e).slice(0, 120)}).`, honesto: true });
  };

  app.get('/api/cerebro/episodios', d.exigirMesa, d.limitar(60), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      const n = Math.min(100, Math.max(1, Math.floor(Number(req.query.n)) || 30));
      return res.json({ episodios: await episodiosDe(c, n), honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.get('/api/cerebro/abiertos', d.exigirMesa, d.limitar(60), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      const [abiertos, cerrados] = await Promise.all([abiertosDe(c), cerradosDe(c)]);
      return res.json({ abiertos, cerrados: cerrados.slice(0, 20), honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.post('/api/cerebro/abiertos/:id/cerrar', d.exigirMesa, d.limitar(60), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    const estado = req.body?.estado === undefined ? 'hecho' : req.body.estado;
    if (estado !== 'hecho' && estado !== 'descartado') return res.status(400).json({ error: 'El estado es hecho o descartado.', honesto: true });
    try {
      const r = await cerrar(c, String(req.params.id || '').slice(0, 40), estado);
      if (!r.abierto) return res.status(404).json({ error: 'No encuentro ese pendiente.', honesto: true });
      return res.json({ abierto: r.abierto, durable: r.durable, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.get('/api/cerebro/conocer', d.exigirMesa, d.limitar(60), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      const s = await queSeDe(c);
      const categorias = CATEGORIAS.map((k) => ({ id: k, nombre: NOMBRE_CATEGORIA[k], datos: s.porCategoria[k] }));
      return res.json({ categorias, total: s.total, faltan: queNoSe(c), honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  // Lo que contó en las preguntas de la primera vez (mobile/src/primeravez): queda como dato «manual»
  // (el modelo ya no lo cambia) y la persona lo ve, corrige o borra en «Lo que sé de ti».
  app.post('/api/cerebro/conocer', d.exigirMesa, d.limitar(30), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    const categoria = String(req.body?.categoria || '');
    if (!(CATEGORIAS as readonly string[]).includes(categoria)) return res.status(400).json({ error: `La categoría es ${CATEGORIAS.join(', ')}.`, honesto: true });
    const dato = typeof req.body?.dato === 'string' ? req.body.dato.trim() : '';
    if (dato.length < 4 || dato.length > 240) return res.status(400).json({ error: 'El dato va en una frase corta (de 4 a 240 letras).', honesto: true });
    const clave = typeof req.body?.clave === 'string' && req.body.clave.trim() ? req.body.clave.trim().slice(0, 60) : undefined;
    try {
      const r = await agregarDato(c, categoria, dato, clave);
      return res.json({ dato: r.dato, durable: r.durable, honesto: true });
    } catch (e) {
      if (e instanceof CajonNoDisponible) return fallo(res, e);
      // Un secreto (clave, PIN) o un dato vacío: se dice, no se guarda.
      return res.status(400).json({ error: String((e as Error)?.message || e).slice(0, 160), honesto: true });
    }
  });

  // Todo lo aprendido de la persona, de una vez (el «Borrar todo lo que te conté» de la app).
  app.delete('/api/cerebro/conocer', d.exigirMesa, d.limitar(10), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      const r = await olvidarTodo(c);
      return res.json({ ok: true, borrados: r.borrados, durable: r.durable, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  // Olvidar por id y por clave común (PRIV01): la app borra a la vez la respuesta del perfil y su copia
  // aquí, y solo lo da por hecho con `durable: true`. Repetirlo no es un 404: vuelve a escribir y a dar recibo.
  app.post('/api/cerebro/conocer/olvidar', d.exigirMesa, d.limitar(60), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x: unknown) => typeof x === 'string' && x).slice(0, 50);
    const crudas = Array.isArray(req.body?.claves) ? req.body.claves.slice(0, 20) : [];
    const claves = crudas.filter((k: any) => k && typeof k.clave === 'string' && k.clave.trim() && (CATEGORIAS as readonly string[]).includes(k.categoria));
    if (claves.length !== crudas.length) return res.status(400).json({ error: `Cada clave lleva su categoría (${CATEGORIAS.join(', ')}) y su clave.`, honesto: true });
    if (!ids.length && !claves.length) return res.status(400).json({ error: 'No dijiste qué olvidar.', honesto: true });
    try {
      const r = await olvidarPorClaves(c, { ids, claves });
      return res.json({ ok: true, borrados: r.borrados, durable: r.durable, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.delete('/api/cerebro/conocer/:id', d.exigirMesa, d.limitar(60), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      const r = await olvidarDato(c, String(req.params.id || '').slice(0, 40));
      if (!r.borrado) return res.status(404).json({ error: 'No encuentro ese dato.', honesto: true });
      return res.json({ ok: true, durable: r.durable, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.get('/api/circulo', d.exigirMesa, d.limitar(60), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      return res.json({ personas: await circuloDe(c), puede: capacidadesCirculo(c), honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  // José en su app: aquí, y solo aquí, puede dar el permiso permanente para recordatorios.
  app.post('/api/circulo', d.exigirMesa, d.limitar(30), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      const id = req.body?.id ? String(req.body.id).slice(0, 40) : '';
      if (id) {
        const r = await actualizarPersona(c, id, { ...req.body, id: undefined }, { permitirPermisos: true });
        if (!r.persona) return res.status(404).json({ error: 'No encuentro a esa persona.', honesto: true });
        return res.json({ persona: r.persona, durable: r.durable, honesto: true });
      }
      const r = await agregarPersona(c, req.body, { permitirPermisos: true });
      return res.json({ persona: r.persona, durable: r.durable, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.delete('/api/circulo/:id', d.exigirMesa, d.limitar(30), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    try {
      const r = await quitarPersona(c, String(req.params.id || '').slice(0, 40));
      if (!r.quitada) return res.status(404).json({ error: 'No encuentro a esa persona.', honesto: true });
      return res.json({ ok: true, durable: r.durable, honesto: true });
    } catch (e) {
      return fallo(res, e);
    }
  });

  app.get('/api/triaje', d.exigirMesa, d.limitar(10), async (req, res) => {
    const c = quien(req, res);
    if (!c) return;
    const dueno = d.esDuenoWhatsapp || whatsappPermitido;
    if (!dueno(c)) return res.status(403).json({ error: 'El triaje de mensajes es solo para el dueño del WhatsApp conectado.', code: 'triaje_no_permitido', honesto: true });
    const q = String(req.query.canal || 'todo');
    const canal = q === 'whatsapp' || q === 'correo' ? q : 'todo';
    try {
      const r = await triar(c, { canal, fuentes: d.fuentesTriaje });
      return res.json({
        porImportancia: r.porImportancia,
        resumen: r.resumen,
        errores: r.errores,
        revisado: r.revisado,
        nota: 'Las respuestas sugeridas son borradores: nada se manda sin tu «sí».',
        honesto: true,
      });
    } catch (e) {
      return fallo(res, e);
    }
  });
}
