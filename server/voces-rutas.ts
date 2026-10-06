/**
 * LAS VOCES CONOCIDAS (reconocer quién habla, con permiso; lo guarda lib/voces-miembro.ts y el motor es
 * lib/voces-motor.ts).
 *
 *   GET    /api/voces          → { personas: [{ id, nombre, relacion, parentesco?, muestras, creado }], motor }
 *   POST   /api/voces/aprender { nombre, relacion: 'yo'|'conocido', parentesco?, audios: base64[] (o audio),
 *                                consentimiento: { como, frase? } } → { persona }
 *   POST   /api/voces/quien    { audio } → { persona: { id, nombre, relacion, parentesco? } | null, similitud, motivo }
 *   DELETE /api/voces/:id      → { ok, nombre } (404 si no estaba)
 *   DELETE /api/voces          → { ok, borradas }
 *
 * Todo con la sesión de la mesa: las voces son del CORREO de la sesión firmada, nunca del cuerpo. El
 * audio (WAV PCM 16 bits mono 16 kHz, o PCM crudo, en base64) se convierte en números en memoria y se
 * descarta: no se guarda ni se escribe en ningún log. La identificación se hace aquí, así las huellas
 * nunca salen del servidor (el listado no las trae).
 *
 * Si el motor no está (sin red para bajar el modelo, sin el binario, ULTRON_VOCES=0), aprender y
 * reconocer contestan 503 `voces_no_disponible` y lo demás sigue igual.
 */
import type express from 'express';
import {
  agregarVoz,
  cargarVoces,
  identificarVoz,
  olvidarTodasLasVoces,
  olvidarVoz,
  parecidoA,
  UMBRAL_VOZ,
  validarAltaVoz,
  VocesNoDisponibles,
  VocesNoGuardadas,
  type PersonaVoz,
} from '../lib/voces-miembro';
import { estadoMotorVoces, huellaDeVoz, MIN_VOZ_SEG, muestrasDeAudio, precalentarMotorVoces, soloVoz, VozNoDisponible } from '../lib/voces-motor';
import type { Sesion } from './seguridad';
import { BorradoDegradado } from '../lib/biometria-durable';

type Deps = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => Sesion | null;
};

/** Para aprender: hasta 4 frases y, sumadas, al menos esto de voz. */
export const MAX_AUDIOS_APRENDER = 4;
export const MIN_VOZ_APRENDER_SEG = 4;

const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
const noGuardado = (res: express.Response) =>
  res.status(503).json({ error: 'No pude guardar el cambio de forma segura; intenta otra vez en un momento.', code: 'voces_no_guardadas', honesto: true });
const noLeido = (res: express.Response) => res.status(503).json({ error: 'Ahora mismo no pude leer las voces guardadas; intenta en un momento.', code: 'voces_no_leidas', honesto: true });
const sinMotor = (res: express.Response) =>
  res.status(503).json({ error: 'El reconocimiento de voz no está disponible ahora mismo.', code: 'voces_no_disponible', motor: estadoMotorVoces().estado, honesto: true });

const publica = (p: PersonaVoz) => ({ id: p.id, nombre: p.nombre, relacion: p.relacion, ...(p.parentesco ? { parentesco: p.parentesco } : {}) });

/**
 * SEC-03: S3 ya no la tiene, pero la copia local vieja no se pudo reescribir ni quitar. No es «borrada del todo»: 202
 * con `completo: false` y el porqué. AURA no la usa (la caché y S3 están al día y la lectura aplica las lápidas).
 */
const borradoDegradado = (res: express.Response, extra: Record<string, unknown>) =>
  res.status(202).json({
    ok: true,
    completo: false,
    pendiente: 'copia_local',
    ...extra,
    aviso: 'La borré de la copia principal, pero una copia local vieja no se pudo quitar todavía. No la uso; vuelve a pedirlo en un momento para terminar.',
    honesto: true,
  });

function errorComun(res: express.Response, e: unknown) {
  if (e instanceof VozNoDisponible) return sinMotor(res);
  if (e instanceof VocesNoDisponibles) return noLeido(res);
  if (e instanceof VocesNoGuardadas) return noGuardado(res);
  if (e instanceof RangeError) return res.status(409).json({ error: e.message, honesto: true });
  throw e;
}

export function montarRutasVoces(app: express.Express, d: Deps) {
  app.get('/api/voces', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { personas } = await cargarVoces(s.correo);
      // Quien tiene voces guardadas va a hablar pronto: que el motor empiece a cargar ya, sin esperar.
      if (personas.length) precalentarMotorVoces();
      return res.json({ personas: personas.map((p) => ({ ...publica(p), muestras: p.vectores.length, creado: p.creado })), motor: estadoMotorVoces().estado, honesto: true });
    } catch (e) {
      return errorComun(res, e);
    }
  });

  app.post('/api/voces/aprender', d.exigirMesa, d.limitar(12), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const b = req.body || {};
    const v = validarAltaVoz(b, s.nombre);
    if (v.ok === false) return res.status(400).json({ error: v.error, honesto: true });
    const crudos: unknown[] = Array.isArray(b.audios) ? b.audios : b.audio != null ? [b.audio] : [];
    if (!crudos.length || crudos.length > MAX_AUDIOS_APRENDER) return res.status(400).json({ error: `Manda de 1 a ${MAX_AUDIOS_APRENDER} frases de audio.`, honesto: true });
    const frases: Float32Array[] = [];
    let voz = 0;
    for (const a of crudos) {
      const m = muestrasDeAudio(a);
      if (!m) return res.status(400).json({ error: 'Eso no es un audio que pueda oír (WAV de 16 kHz, mono, 16 bits, de hasta 12 s).', honesto: true });
      const sv = soloVoz(m);
      // Una frase muy corta o callada no ayuda: se deja fuera (las otras sí cuentan).
      if (sv.vozSeg >= MIN_VOZ_SEG * 0.6) {
        frases.push(sv.muestras);
        voz += sv.vozSeg;
      }
    }
    if (voz < MIN_VOZ_APRENDER_SEG) return res.status(400).json({ error: 'Necesito oír un poco más de voz para aprenderla: unas frases más.', code: 'poca_voz', vozSeg: Math.round(voz * 10) / 10, honesto: true });
    try {
      const cajon = await cargarVoces(s.correo);
      // Una huella por frase, y una de todas juntas (la más estable).
      const vectores: number[][] = [];
      for (const f of frases) vectores.push(await huellaDeVoz(f));
      if (frases.length > 1) {
        const todas = new Float32Array(frases.reduce((n, f) => n + f.length, 0));
        let o = 0;
        for (const f of frases) {
          todas.set(f, o);
          o += f.length;
        }
        vectores.push(await huellaDeVoz(todas));
      }
      // ¿Es la voz de la dueña con el nombre de otra persona? (Ana no habló y habló ella.) No se guarda.
      if (v.relacion === 'conocido') {
        const yo = cajon.personas.find((p) => p.relacion === 'yo');
        const ultima = vectores[vectores.length - 1];
        if (yo && parecidoA(ultima, yo) >= UMBRAL_VOZ) return res.status(409).json({ error: `Esa voz se parece a la tuya, no a la de ${v.nombre}. Que hable ${v.nombre}.`, code: 'voz_de_la_duena', honesto: true });
      }
      const p = await agregarVoz(s.correo, v, vectores);
      return res.json({ persona: { ...publica(p), muestras: p.vectores.length }, vozSeg: Math.round(voz * 10) / 10, honesto: true });
    } catch (e) {
      return errorComun(res, e);
    }
  });

  app.post('/api/voces/quien', d.exigirMesa, d.limitar(40), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    const m = muestrasDeAudio(req.body?.audio);
    if (!m) return res.status(400).json({ error: 'Eso no es un audio que pueda oír (WAV de 16 kHz, mono, 16 bits, de hasta 12 s).', honesto: true });
    try {
      const { personas } = await cargarVoces(s.correo);
      if (!personas.length) return res.json({ persona: null, similitud: 0, motivo: 'sin_voces', honesto: true });
      const sv = soloVoz(m);
      if (sv.vozSeg < MIN_VOZ_SEG) return res.json({ persona: null, similitud: 0, motivo: sv.vozSeg < 0.2 ? 'silencio' : 'muy_corta', honesto: true });
      const r = identificarVoz(await huellaDeVoz(sv.muestras, 20_000), personas);
      return res.json({ persona: r.persona ? publica(r.persona) : null, similitud: r.similitud, motivo: r.motivo, honesto: true });
    } catch (e) {
      return errorComun(res, e);
    }
  });

  app.delete('/api/voces/:id', d.exigirMesa, d.limitar(30), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    try {
      const p = await olvidarVoz(s.correo, String(req.params.id || '').slice(0, 40));
      if (!p) return res.status(404).json({ error: 'No conozco esa voz.', honesto: true });
      return res.json({ ok: true, nombre: p.nombre, honesto: true });
    } catch (e) {
      if (e instanceof BorradoDegradado) return borradoDegradado(res, { nombre: (e.resultado as { nombre?: string })?.nombre });
      return errorComun(res, e);
    }
  });

  app.delete('/api/voces', d.exigirMesa, d.limitar(10), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return sinSesion(res);
    try {
      const borradas = await olvidarTodasLasVoces(s.correo);
      return res.json({ ok: true, borradas, honesto: true });
    } catch (e) {
      if (e instanceof BorradoDegradado) return borradoDegradado(res, { borradas: e.resultado });
      return errorComun(res, e);
    }
  });
}
