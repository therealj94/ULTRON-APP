import React, { useCallback, useEffect, useState } from 'react';
import { Check, X, RefreshCw, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { headersMesa } from '../10-infra/sesionCliente';

/**
 * CONTROL — lo que la capa cognitiva deja ver a quien tiene mando.
 *
 *  · Solicitudes esperando firma, con Aprobar y Rechazar. Firmar desde aquí es lo mismo que
 *    `/aprobar` en Telegram: el servidor comprueba la sesión, nadie firma lo suyo, y lo aprobado se
 *    ejecuta tal cual se pidió.
 *  · La semana en números: turnos, errores, bloqueos, latencia, lo que la gente marcó como útil.
 *  · Los últimos turnos con su traza: qué herramientas corrieron, qué reglas intervinieron.
 *  · Si la cadena de auditoría sigue íntegra.
 *  · Qué servicios de la T4 responden ahora mismo, y cuánto tardan.
 *  · Las reglas vigentes, en castellano.
 *
 * Sin mando, el servidor contesta 403 y aquí se dice eso, sin enseñar nada.
 */

type Aprobacion = {
  id: string;
  herramienta: string;
  pedida_por: string | null;
  motivo: string;
  regla: string;
  argumentos: Record<string, unknown>;
  necesarias: number;
  firmas: Array<{ quien: string; decision: string }>;
  creada: string;
  vence: string;
};
type Paso = { herramienta: string; ok: boolean; ms?: number; resumen?: string };
type Traza = {
  id: string;
  t_inicio: string;
  quien: string | null;
  canal: string | null;
  pregunta: string;
  respuesta: string | null;
  agente: string | null;
  ms: number | null;
  error: string | null;
  pasos: Paso[];
  politica: Array<{ herramienta: string; veredicto: string; regla: string }>;
  feedback: number | null;
};
type Sonda = { servicio: string; configurado: boolean; ok: boolean; ms: number | null; detalle: string };
type EstadoCog = {
  clasificador: { modo: string };
  servicios: Sonda[];
  vectores: { columna: boolean; con: number; sin: number } | null;
  mcp: { activo: boolean; motivo: string | null };
};
const NOMBRE_SERVICIO: Record<string, string> = {
  laya: 'Clasificador rápido (Laya)',
  embeddings: 'Búsqueda por significado (BGE-M3)',
  modelo_chico: 'Modelo chico',
  docling: 'Lectura de escaneos (Docling)',
};
const MODO_CLASIFICADOR: Record<string, string> = {
  reglas: 'reglas (sin Laya)',
  sombra: 'Laya en sombra: decide con reglas y compara',
  laya: 'Laya decide; las reglas vigilan el riesgo',
};

type Resumen = {
  turnos: number;
  errores: number;
  bloqueos: number;
  revisiones: number;
  msP50: number | null;
  msP95: number | null;
  tokensIn: number;
  tokensOut: number;
  utiles: number;
  noUtiles: number;
};

async function pedir<T>(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: T | null }> {
  try {
    const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...headersMesa(), ...(init.headers || {}) } });
    return { ok: r.ok, status: r.status, json: (await r.json().catch(() => null)) as T | null };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

const hora = (iso: string) => new Date(iso).toLocaleString('es-HN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const Control: React.FC = () => {
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'sin-mando' | 'error'>('cargando');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [solicitudes, setSolicitudes] = useState<Aprobacion[]>([]);
  const [trazas, setTrazas] = useState<Traza[]>([]);
  const [cadena, setCadena] = useState<{ ok: boolean; revisados: number; roto?: { seq: number; motivo: string } } | null>(null);
  const [reglas, setReglas] = useState<Array<{ id: string; descripcion: string }>>([]);
  const [cog, setCog] = useState<EstadoCog | null>(null);
  const [aviso, setAviso] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [firmando, setFirmando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setEstado('cargando');
    const [r, s, t, c, g, e] = await Promise.all([
      pedir<{ resumen: Resumen }>('/api/cognitivo/resumen'),
      pedir<{ aprobaciones: Aprobacion[] }>('/api/cognitivo/aprobaciones?estado=pendiente'),
      pedir<{ trazas: Traza[] }>('/api/cognitivo/trazas?limite=25'),
      pedir<{ ok: boolean; revisados: number; roto?: { seq: number; motivo: string } }>('/api/cognitivo/auditoria/verificar'),
      pedir<{ reglas: Array<{ id: string; descripcion: string }> }>('/api/cognitivo/reglas'),
      pedir<EstadoCog>('/api/cognitivo/estado'),
    ]);
    setReglas(g.ok && Array.isArray(g.json?.reglas) ? g.json!.reglas : []);
    if (r.status === 403 || r.status === 401) return setEstado('sin-mando');
    if (!r.ok) return setEstado('error');
    setResumen(r.json?.resumen || null);
    setSolicitudes(s.ok && Array.isArray(s.json?.aprobaciones) ? s.json!.aprobaciones : []);
    setTrazas(t.ok && Array.isArray(t.json?.trazas) ? t.json!.trazas.map((x) => ({ ...x, pasos: x.pasos || [], politica: x.politica || [] })) : []);
    setCadena(c.ok && c.json ? c.json : null);
    setCog(e.ok && e.json && Array.isArray(e.json.servicios) ? e.json : null);
    setEstado('listo');
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const firmar = async (id: string, decision: 'aprobar' | 'rechazar') => {
    setFirmando(id);
    const r = await pedir<{ ok: boolean; motivo: string }>(`/api/cognitivo/aprobaciones/${id}`, { method: 'POST', body: JSON.stringify({ decision }) });
    setFirmando(null);
    setAviso(r.json?.motivo || (r.ok ? 'Hecho.' : 'No se pudo firmar.'));
    void cargar();
  };

  const tarjeta = 'rounded-2xl border border-[#46484D] bg-[#34363A] p-3';
  const titulo = 'text-[12px] font-semibold uppercase tracking-[0.08em] text-[#B9B2A8] mb-2 flex items-center justify-between';

  return (
    <div id="ultron-control" className="flex flex-col gap-4">
      {estado === 'sin-mando' && (
        <div className={`${tarjeta} text-[14px] text-[#B9B2A8]`}>
          El control (trazas, aprobaciones, auditoría) lo ve solo quien tiene mando en esta plataforma. Entra con tu sesión.
        </div>
      )}
      {estado === 'error' && <div className={`${tarjeta} text-[14px] text-[#E39A7A]`}>No pude leer el control ahora. Vuelve a intentarlo en un momento.</div>}

      {aviso && (
        <div role="status" className="rounded-2xl bg-[#3D3829] text-[#E0C27F] text-[14px] px-3 py-2 flex items-center justify-between gap-2">
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso('')} aria-label="Cerrar aviso" className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {estado === 'listo' && (
        <>
          <section>
            <div className={titulo}>
              <span>Solicitudes esperando firma</span>
              <button type="button" onClick={() => void cargar()} className="flex items-center gap-1 text-[#E0C27F] normal-case tracking-normal cursor-pointer" aria-label="Actualizar">
                <RefreshCw className="w-3.5 h-3.5" /> Actualizar
              </button>
            </div>
            {!solicitudes.length && <div className={`${tarjeta} text-[14px] text-[#8A847C]`}>Nada esperando. Lo que una regla mande a revisión aparece aquí y en el Telegram de la junta.</div>}
            <div className="flex flex-col gap-2">
              {solicitudes.map((a) => {
                const firmas = a.firmas || [];
                const positivas = firmas.filter((f) => f.decision === 'aprobar').length;
                return (
                  <div key={a.id} className={tarjeta}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-[#ECE8E2]">
                          {a.herramienta} <span className="text-[12px] font-normal text-[#8A847C]">· {a.id.slice(0, 8)}</span>
                        </div>
                        <div className="text-[13px] text-[#B9B2A8]">
                          Pedida por {a.pedida_por || 'alguien sin identificar'} · {hora(a.creada)} · vence {hora(a.vence)}
                        </div>
                        <div className="text-[13px] text-[#ECE8E2] mt-1">{a.motivo}</div>
                        <pre className="mt-1 text-[12px] text-[#B9B2A8] whitespace-pre-wrap break-all">{JSON.stringify(a.argumentos, null, 1).slice(0, 400)}</pre>
                        <div className="text-[12px] text-[#8A847C] mt-1">
                          Firmas: {positivas}/{a.necesarias}
                          {firmas.length ? ` (${firmas.map((f) => f.quien).join(', ')})` : ''}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={firmando === a.id}
                          onClick={() => void firmar(a.id, 'aprobar')}
                          className="px-3 py-2 rounded-full bg-[#D6B56C] text-[#232528] text-[13px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-4 h-4" /> Aprobar
                        </button>
                        <button
                          type="button"
                          disabled={firmando === a.id}
                          onClick={() => void firmar(a.id, 'rechazar')}
                          className="px-3 py-2 rounded-full bg-[#3F2E28] text-[#E39A7A] text-[13px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <X className="w-4 h-4" /> Rechazar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {resumen && (
            <section>
              <div className={titulo}>
                <span>Última semana</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ['Turnos', resumen.turnos],
                  ['Con error', resumen.errores],
                  ['Bloqueos', resumen.bloqueos],
                  ['A revisión', resumen.revisiones],
                  ['Respuesta típica', resumen.msP50 != null ? `${(resumen.msP50 / 1000).toFixed(1)} s` : '—'],
                  ['Las más lentas', resumen.msP95 != null ? `${(resumen.msP95 / 1000).toFixed(1)} s` : '—'],
                  ['Tokens', `${Math.round((resumen.tokensIn + resumen.tokensOut) / 1000)} k`],
                  ['Sirvió / no', `${resumen.utiles} / ${resumen.noUtiles}`],
                ].map(([k, v]) => (
                  <div key={String(k)} className={tarjeta}>
                    <div className="text-[12px] text-[#8A847C]">{k}</div>
                    <div className="text-[20px] font-semibold text-[#ECE8E2]">{v}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {cadena && (
            <section className={`${tarjeta} flex items-center gap-2 text-[14px]`}>
              {cadena.ok ? <ShieldCheck className="w-5 h-5 text-[#A9C3A4]" /> : <ShieldAlert className="w-5 h-5 text-[#E39A7A]" />}
              <span className={cadena.ok ? 'text-[#ECE8E2]' : 'text-[#E39A7A]'}>
                {cadena.ok
                  ? `Cadena de auditoría íntegra: ${cadena.revisados} registros verificados.`
                  : `La cadena de auditoría está rota en el registro ${cadena.roto?.seq}: ${cadena.roto?.motivo}.`}
              </span>
            </section>
          )}

          {cog && (
            <section>
              <div className={titulo}>
                <span>Servicios</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {cog.servicios.map((sv) => (
                  <div key={sv.servicio} className={`${tarjeta} flex items-center justify-between gap-2`}>
                    <div className="min-w-0">
                      <div className="text-[14px] text-[#ECE8E2]">{NOMBRE_SERVICIO[sv.servicio] || sv.servicio}</div>
                      <div className="text-[12px] text-[#8A847C]">{sv.configurado ? sv.detalle : 'sin configurar: se usa lo de siempre'}</div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] shrink-0 ${
                        !sv.configurado ? 'bg-[#3A3C40] text-[#8A847C]' : sv.ok ? 'bg-[#2F3A30] text-[#A9C3A4]' : 'bg-[#3F2E28] text-[#E39A7A]'
                      }`}
                    >
                      {!sv.configurado ? 'apagado' : sv.ok ? `${sv.ms} ms` : 'caído'}
                    </span>
                  </div>
                ))}
                <div className={`${tarjeta} text-[13px] text-[#B9B2A8] flex flex-col gap-0.5`}>
                  <span>Clasificador: {MODO_CLASIFICADOR[cog.clasificador.modo] || cog.clasificador.modo}</span>
                  {cog.vectores && (
                    <span>
                      {cog.vectores.columna
                        ? `Fragmentos con vector: ${cog.vectores.con}${cog.vectores.sin ? ` · faltan ${cog.vectores.sin}` : ''}`
                        : 'La base no tiene pgvector: los expedientes se buscan solo por palabras.'}
                    </span>
                  )}
                  <span>MCP: {cog.mcp.activo ? 'activo en /mcp (solo lectura)' : `apagado${cog.mcp.motivo ? ` (${cog.mcp.motivo})` : ''}`}</span>
                </div>
              </div>
            </section>
          )}

          <section>
            <div className={titulo}>
              <span>Últimos turnos</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {trazas.map((t) => {
                const abierto = abierta === t.id;
                return (
                  <div key={t.id} className={tarjeta}>
                    <button type="button" onClick={() => setAbierta(abierto ? null : t.id)} className="w-full text-left flex items-start justify-between gap-2 cursor-pointer" aria-expanded={abierto}>
                      <div className="min-w-0">
                        <div className="text-[14px] text-[#ECE8E2] truncate">{t.pregunta || '(sin texto)'}</div>
                        <div className="text-[12px] text-[#8A847C]">
                          {hora(t.t_inicio)} · {t.quien || 'sin identificar'} · {t.canal} {t.agente ? `· ${t.agente}` : ''} · {t.ms != null ? `${(t.ms / 1000).toFixed(1)} s` : ''}
                          {t.feedback === 1 ? ' · 👍' : t.feedback === -1 ? ' · 👎' : ''}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {t.pasos.map((p, i) => (
                            <span key={i} className={`px-2 py-0.5 rounded-full text-[11px] ${p.ok ? 'bg-[#2F3A30] text-[#A9C3A4]' : 'bg-[#3F2E28] text-[#E39A7A]'}`}>
                              {p.herramienta}
                            </span>
                          ))}
                          {t.politica.map((d, i) => (
                            <span key={`p${i}`} className={`px-2 py-0.5 rounded-full text-[11px] ${d.veredicto === 'bloquear' ? 'bg-[#3F2E28] text-[#E39A7A]' : 'bg-[#3D3829] text-[#E0C27F]'}`}>
                              {d.veredicto}: {d.regla}
                            </span>
                          ))}
                          {t.error && <span className="px-2 py-0.5 rounded-full text-[11px] bg-[#3F2E28] text-[#E39A7A]">error</span>}
                        </div>
                      </div>
                      {abierto ? <ChevronUp className="w-4 h-4 text-[#8A847C] shrink-0" /> : <ChevronDown className="w-4 h-4 text-[#8A847C] shrink-0" />}
                    </button>
                    {abierto && (
                      <div className="mt-2 text-[13px] text-[#B9B2A8] whitespace-pre-wrap">
                        {t.respuesta || t.error || '(sin respuesta)'}
                        {t.pasos
                          .filter((p) => p.resumen)
                          .map((p, i) => (
                            <div key={i} className="mt-1 text-[12px] text-[#8A847C]">
                              {p.herramienta}
                              {p.ms != null ? ` (${p.ms} ms)` : ''}: {p.resumen}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!trazas.length && <div className={`${tarjeta} text-[14px] text-[#8A847C]`}>Todavía no hay turnos registrados.</div>}
            </div>
          </section>
        </>
      )}

      {!!reglas.length && (
        <section>
          <div className={titulo}>
            <span>Reglas vigentes</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {reglas.map((r) => (
              <li key={r.id} className={`${tarjeta} text-[13px] text-[#B9B2A8]`}>
                <span className="text-[#ECE8E2] font-semibold">{r.id}</span> — {r.descripcion}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
