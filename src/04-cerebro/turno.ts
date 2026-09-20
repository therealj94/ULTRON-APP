/**
 * Cliente del cerebro. Un turno = POST /api/turno (JSON) o /api/turno/stream (SSE).
 * El servidor devuelve `emocion` (contrato en lib/emocion.ts) además del texto.
 */
import { leerLarga } from '../09-estado/memoria';
import { headersMesa } from '../10-infra/sesionCliente';
import type { Emocion } from '../../lib/emocion';

export type Turno = {
  reply?: string;
  emocion?: Emocion;
  error?: string;
  modelo?: string;
  via?: string;
  ms?: number;
  herramientas?: string[];
  foto?: string | null;
  honesto?: boolean;
};

export type PeticionTurno = {
  message: string;
  mode?: string;
  historial?: { rol: string; texto: string }[];
  image?: string | null;
  signal?: AbortSignal;
  usuario?: string;
  correo?: string;
  /** Descripción de la escena que ya interpretó la cámara local (quién está, qué hace). */
  escena?: string;
};

function cuerpo(opts: PeticionTurno) {
  return JSON.stringify({
    message: opts.message,
    mode: opts.mode || 'GUARDIAN',
    historial: opts.historial || [],
    image: opts.image || undefined,
    memoria: leerLarga(),
    usuario: opts.usuario,
    correo: opts.correo,
    escena: opts.escena || undefined,
  });
}

export async function pedirTurno(opts: PeticionTurno): Promise<Turno> {
  const r = await fetch('/api/turno', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headersMesa() },
    body: cuerpo(opts),
    signal: opts.signal,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    return { reply: '', honesto: true, ...data, error: 'sesión requerida' };
  }
  return data;
}

export type EventosTurno = {
  onTools?: (tools: string[]) => void;
  onEmocion?: (e: Emocion) => void;
  onDelta?: (texto: string) => void;
  onReplace?: (texto: string) => void;
};

/**
 * Turno en streaming. Emite emoción antes del primer texto, luego frases, luego `done`.
 * Si el servidor no soporta SSE (proxy viejo), cae a pedirTurno.
 */
export async function pedirTurnoStream(opts: PeticionTurno, ev: EventosTurno = {}): Promise<Turno> {
  let r: Response;
  try {
    r = await fetch('/api/turno/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headersMesa() },
      body: cuerpo(opts),
      signal: opts.signal,
    });
  } catch (e) {
    return pedirTurno(opts);
  }
  if (r.status === 401) return { reply: '', honesto: true, error: 'sesión requerida' };
  if (!r.ok || !r.body || !(r.headers.get('content-type') || '').includes('event-stream')) return pedirTurno(opts);

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let texto = '';
  let emocion: Emocion | undefined;
  let done: Turno | null = null;
  let error: string | undefined;
  const manejar = (evento: string, data: any) => {
    if (evento === 'tools') ev.onTools?.(Array.isArray(data?.tools) ? data.tools : []);
    else if (evento === 'emocion') {
      emocion = data?.emocion;
      if (emocion) ev.onEmocion?.(emocion);
    } else if (evento === 'delta') {
      const t = String(data?.text || '');
      texto += t;
      ev.onDelta?.(t);
    } else if (evento === 'replace') {
      texto = String(data?.text || '');
      ev.onReplace?.(texto);
    } else if (evento === 'done') {
      done = { reply: String(data?.reply ?? texto), emocion: data?.emocion || emocion, ms: data?.ms, via: data?.via, honesto: true };
    } else if (evento === 'error') {
      error = String(data?.error || data?.message || 'error');
    }
  };
  while (true) {
    const { done: fin, value } = await reader.read();
    if (fin) break;
    buf += dec.decode(value, { stream: true });
    const bloques = buf.split('\n\n');
    buf = bloques.pop() || '';
    for (const b of bloques) {
      let evento = 'message';
      let data = '';
      for (const linea of b.split('\n')) {
        if (linea.startsWith('event:')) evento = linea.slice(6).trim();
        else if (linea.startsWith('data:')) data += linea.slice(5).trim();
      }
      if (!data) continue;
      try {
        manejar(evento, JSON.parse(data));
      } catch {
        /* */
      }
    }
  }
  if (done) return done;
  if (texto) return { reply: texto, emocion, honesto: true };
  return { reply: '', emocion, error: error || 'sin respuesta', honesto: true };
}
