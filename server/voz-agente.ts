/**
 * CONVERSACIÓN FLUIDA (como el modo voz de ChatGPT): ElevenLabs Agents con NUESTRO cerebro.
 *
 * Lo que hace ElevenLabs: el audio del teléfono va por WebRTC (con cancelación de eco), su servidor
 * reconoce la voz, decide cuándo terminó el turno, corta al avatar si la persona le habla encima y
 * dice la respuesta con la voz v4 del avatar. Lo que NO hace: pensar. Cada turno nos lo pide como
 * «LLM propio» (formato OpenAI /chat/completions en streaming), y aquí se contesta con el mismo
 * cerebro de la mesa (/api/turno/stream): mismas herramientas, misma memoria, mismo avatar e idioma.
 *
 * Seguridad, en dos llaves:
 *  1. ElevenLabs manda `Authorization: Bearer <secreto>` en cada petición. El secreto está guardado
 *     en ElevenLabs (secretos del agente) y aquí se deriva del de las sesiones (secretoDerivado).
 *  2. Quién habla viaja en un PASE firmado (firmarDato('voz', …)) que el teléfono recibe al abrir la
 *     conversación y ElevenLabs reenvía en la cabecera `X-Pase` (variable dinámica `pase`). Vale 30
 *     minutos, solo aquí (una sesión de la app no sirve y un pase no abre la app), y dice correo,
 *     nombre, avatar e idioma.
 */
import crypto from 'crypto';
import type express from 'express';
import { clave } from '../lib/boveda';
import { quitarExpresiones } from '../lib/expresiones';
import { emitirSesion, firmarDato, leerDato, mismoSecreto, secretoDerivado, type Sesion } from './seguridad';
import { normalizarAvatar, normalizarIdioma, type AvatarVoz, type Idioma } from './eleven';

/** La etiqueta del secreto que ElevenLabs manda como Bearer. Cambiarla invalida el guardado allá. */
export const ETIQUETA_SECRETO_LLM = 'elevenlabs-llm-v1';
const PASE_TTL_MS = 30 * 60_000;

/**
 * Un agente de ElevenLabs por avatar e idioma (voz, idioma del reconocimiento y del turno). Los crea
 * scripts/elevenlabs-agentes.ts; se cambian sin tocar código con ELEVENLABS_AGENTE_<AVATAR>_<IDIOMA>.
 */
export const AGENTES: Record<AvatarVoz, Record<Idioma, string>> = {
  ojos: { es: 'agent_3401m3qbvq59eqcv17ecpxxdp7en', en: 'agent_1801m3qbvrrye0zbpgxawy3cqfqt' },
  aura: { es: 'agent_6801m3qbvv83fzgvg42eev85m8m5', en: 'agent_3301m3qbvws7ez6rajshn8akxjbs' },
  claudio: { es: 'agent_3501m3qbvyc5e9b946hm5byv3c7g', en: 'agent_4901m3qbw01me4kt40nqkgy60ykm' },
};

export function agenteDe(avatar: AvatarVoz, idioma: Idioma): string {
  const env = String(process.env[`ELEVENLABS_AGENTE_${avatar.toUpperCase()}_${idioma.toUpperCase()}`] || '').trim();
  return env || AGENTES[avatar][idioma];
}

export type Pase = { correo: string; nombre: string; rol: string; avatar: AvatarVoz; idioma: Idioma; exp: number };

export function emitirPase(s: { correo: string; nombre: string; rol: string }, avatar: AvatarVoz, idioma: Idioma, ahora = Date.now()): string {
  return firmarDato('voz', { correo: s.correo, nombre: s.nombre, rol: s.rol, avatar, idioma, exp: ahora + PASE_TTL_MS });
}

export function leerPase(token: string, ahora = Date.now()): Pase | null {
  const d = leerDato('voz', token);
  if (!d?.correo || !d?.nombre || !Number(d.exp) || ahora > Number(d.exp)) return null;
  return { correo: String(d.correo), nombre: String(d.nombre), rol: String(d.rol || 'Junta'), avatar: normalizarAvatar(d.avatar), idioma: normalizarIdioma(d.idioma), exp: Number(d.exp) };
}

/** El último mensaje de la persona en el formato de OpenAI (texto o partes con texto). */
export function ultimoDeLaPersona(messages: unknown): string {
  const lista = Array.isArray(messages) ? messages : [];
  for (let i = lista.length - 1; i >= 0; i--) {
    const m: any = lista[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content.trim();
    if (Array.isArray(m.content)) return m.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join(' ').trim();
  }
  return '';
}

/** Un trozo SSE con la forma de OpenAI. */
export function trozoOpenAI(id: string, modelo: string, contenido: string | null, fin: string | null = null, rol = false): string {
  const delta: Record<string, string> = {};
  if (rol) delta.role = 'assistant';
  if (contenido) delta.content = contenido;
  const c = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: modelo, choices: [{ index: 0, delta, finish_reason: fin }] };
  return `data: ${JSON.stringify(c)}\n\n`;
}

/** Lee eventos SSE (`event:` + `data:`) de un cuerpo que llega a trozos. */
export async function* eventosSSE(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<{ evento: string; datos: any }> {
  const lector = cuerpo.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let corte: number;
    while ((corte = buf.indexOf('\n\n')) >= 0) {
      const bloque = buf.slice(0, corte);
      buf = buf.slice(corte + 2);
      let evento = 'message';
      const datos: string[] = [];
      for (const linea of bloque.split('\n')) {
        if (linea.startsWith('event:')) evento = linea.slice(6).trim();
        else if (linea.startsWith('data:')) datos.push(linea.slice(5).trimStart());
      }
      if (!datos.length) continue;
      try {
        yield { evento, datos: JSON.parse(datos.join('\n')) };
      } catch {
        /* un trozo que no es JSON no es nuestro */
      }
    }
  }
}

type Deps = {
  exigirMesaODesk: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => Sesion | null;
  /** Dónde escucha este mismo servidor (para pedirle el turno al cerebro de siempre). */
  puerto: number;
};

export function montarVozAgente(app: express.Express, d: Deps) {
  /**
   * Abrir una conversación fluida: el teléfono pide, con su sesión, el permiso de un solo uso de
   * ElevenLabs para el agente de su avatar e idioma, y el pase que dirá quién habla.
   */
  app.post('/api/voz/agente', d.exigirMesaODesk, d.limitar(20, 60_000, 'voz-agente'), async (req, res) => {
    const s = d.sesionDe(req);
    if (!s) return res.status(401).json({ error: 'Entra de nuevo para hablar en conversación.', honesto: true });
    const avatar = normalizarAvatar(req.body?.avatar);
    const idioma = normalizarIdioma(req.body?.idioma);
    const agente = agenteDe(avatar, idioma);
    const key = clave('elevenlabs');
    if (!agente || !key) return res.status(503).json({ error: 'La conversación fluida no está lista todavía.', honesto: true });
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agente)}`, {
        headers: { 'xi-api-key': key },
        signal: AbortSignal.timeout(10_000),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.token) {
        console.warn('[voz agente] token', r.status, JSON.stringify(j).slice(0, 160));
        return res.status(502).json({ error: 'No pude abrir la conversación ahora. Intenta en un momento.', honesto: true });
      }
      return res.json({ token: j.token, agente, avatar, idioma, pase: emitirPase(s, avatar, idioma), honesto: true });
    } catch (e: any) {
      console.warn('[voz agente] token', String(e?.message || e).slice(0, 120));
      return res.status(502).json({ error: 'No pude abrir la conversación ahora. Intenta en un momento.', honesto: true });
    }
  });

  /**
   * El «LLM propio» de los agentes. ElevenLabs lo llama en cada turno con el historial en formato
   * OpenAI; aquí solo se toma lo último que dijo la persona (la memoria y el hilo los tiene el
   * cerebro) y se contesta en streaming con los trozos de /api/turno/stream.
   *
   * Si la persona interrumpe, ElevenLabs cierra la petición: se aborta el turno de adentro para no
   * seguir pensando algo que ya nadie va a oír.
   */
  const llm: express.RequestHandler = async (req, res) => {
    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!bearer || !mismoSecreto(secretoDerivado(ETIQUETA_SECRETO_LLM), bearer)) {
      return res.status(401).json({ error: { message: 'unauthorized' } });
    }
    const pase = leerPase(String(req.headers['x-pase'] || ''));
    if (!pase) return res.status(401).json({ error: { message: 'pase vencido o inválido' } });
    const mensaje = ultimoDeLaPersona(req.body?.messages);
    const id = `chatcmpl-${crypto.randomBytes(8).toString('hex')}`;
    const modelo = String(req.body?.model || 'aura');

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const escribir = (t: string) => {
      if (!res.writableEnded) res.write(t);
    };
    const cerrar = () => {
      escribir('data: [DONE]\n\n');
      if (!res.writableEnded) res.end();
    };
    escribir(trozoOpenAI(id, modelo, null, null, true));
    if (!mensaje) {
      escribir(trozoOpenAI(id, modelo, null, 'stop'));
      return cerrar();
    }

    const corte = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) corte.abort();
    });
    // Una sesión corta de ESTE servidor para pedirle el turno al cerebro con el nombre de quien habla.
    const sesion = emitirSesion({ correo: pase.correo, nombre: pase.nombre, rol: pase.rol }, { vence: Date.now() + 5 * 60_000 });
    let algo = false;
    try {
      const r = await fetch(`http://127.0.0.1:${d.puerto}/api/turno/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ultron-sesion': sesion.token },
        body: JSON.stringify({ message: mensaje, mode: 'GUARDIAN', usuario: pase.nombre, correo: pase.correo, avatar: pase.avatar, idioma: pase.idioma, canal: 'mesa' }),
        signal: corte.signal,
      });
      if (!r.ok || !r.body) throw new Error(`turno ${r.status}`);
      for await (const { evento, datos } of eventosSSE(r.body)) {
        if (evento === 'delta') {
          // La voz del agente lee el texto tal cual: sin las marcas de expresión de la mesa.
          const crudo = quitarExpresiones(String(datos?.voz ?? datos?.text ?? ''));
          // Al quitar una marca del principio queda un espacio: el primer trozo empieza limpio.
          const t = algo ? crudo : crudo.replace(/^\s+/, '');
          if (t) {
            algo = true;
            escribir(trozoOpenAI(id, modelo, t));
          }
        } else if (evento === 'done') {
          if (!algo) {
            const t = quitarExpresiones(String(datos?.voz ?? datos?.reply ?? ''));
            if (t) escribir(trozoOpenAI(id, modelo, t));
          }
          break;
        } else if (evento === 'error') {
          if (!algo) escribir(trozoOpenAI(id, modelo, String(datos?.error || (pase.idioma === 'en' ? 'I lost my train of thought. Can you say it again?' : 'Se me fue el hilo. ¿Me lo repites?'))));
          break;
        }
      }
    } catch (e: any) {
      if (corte.signal.aborted) return; // la persona interrumpió: nadie espera esto
      console.warn('[voz agente] turno', String(e?.message || e).slice(0, 160));
      if (!algo) escribir(trozoOpenAI(id, modelo, pase.idioma === 'en' ? 'Sorry, I lost the connection for a second. Can you repeat that?' : 'Perdón, se me cortó un segundo. ¿Me lo repites?'));
    }
    escribir(trozoOpenAI(id, modelo, null, 'stop'));
    cerrar();
  };
  // ElevenLabs puede añadir /chat/completions a la URL o usarla tal cual: se aceptan las formas.
  app.post('/api/voz/llm', llm);
  app.post('/api/voz/llm/chat/completions', llm);
  app.post('/api/voz/llm/v1/chat/completions', llm);
}
