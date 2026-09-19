import { leerLarga } from '../09-estado/memoria';
import { headersMesa } from '../10-infra/sesionCliente';

export type Turno = {
  reply?: string;
  error?: string;
  modelo?: string;
  via?: string;
  ms?: number;
  foto?: string | null;
  honesto?: boolean;
  herramientas?: string[];
};

export async function pedirTurno(opts: {
  message: string;
  mode?: string;
  historial?: { rol: string; texto: string }[];
  image?: string | null;
  signal?: AbortSignal;
  usuario?: string;
  correo?: string;
}): Promise<Turno> {
  const r = await fetch('/api/turno', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headersMesa() },
    body: JSON.stringify({
      message: opts.message,
      mode: opts.mode || 'GUARDIAN',
      historial: opts.historial || [],
      image: opts.image || undefined,
      memoria: leerLarga(),
      usuario: opts.usuario,
      correo: opts.correo,
    }),
    signal: opts.signal,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    return { reply: '', honesto: true, ...data, error: 'sesión requerida' };
  }
  return data;
}
