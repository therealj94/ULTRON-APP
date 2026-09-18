export type Turno = {
  reply?: string;
  error?: string;
  modelo?: string;
  ms?: number;
  foto?: string | null;
  honesto?: boolean;
};

export async function pedirTurno(opts: {
  message: string;
  mode?: string;
  historial?: { rol: string; texto: string }[];
  image?: string | null;
  signal?: AbortSignal;
}): Promise<Turno> {
  const r = await fetch('/api/turno', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: opts.message,
      mode: opts.mode || 'GUARDIAN',
      historial: opts.historial || [],
      image: opts.image || undefined,
    }),
    signal: opts.signal,
  });
  return r.json();
}
