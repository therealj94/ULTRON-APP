/**
 * LA ESCUELA — donde el equipo revisa lo que hizo la mesa para que Laya y Qwen aprendan de eso.
 *
 * Cada turno real de Dr Electrum deja su traza (pregunta, herramientas, respuesta). Aquí quien tiene
 * mando la mira y decide:
 *  · ✓ Sirve: la respuesta queda como ejemplo bueno para ajustar a Qwen.
 *  · ✗ No sirve: si además escribe la respuesta correcta, esa corrección es la que se enseña; sin
 *    corrección, el turno no entra al entrenamiento.
 *  · A quién debió convocar la mesa (0, 1 o 2 especialistas): una fila para Laya «electrum».
 *
 * Se guarda en la opinión que ya tiene la traza (lib/entrenamiento/revision.ts, sin tablas nuevas) y
 * lo exporta scripts/entrenamiento/exportar.ts. Los hechos no se enseñan: cargos, leyes y concesiones
 * salen de las herramientas con su fuente; lo que se enseña es el comportamiento.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { headersElectrum } from '../acceso';
import { ESPECIALISTAS, escribirRevision, leerRevision, type Especialista } from '../../lib/entrenamiento/revision';

const AMBAR = '#FFAE3B';

type Paso = { herramienta: string; ok: boolean; resumen?: string; args?: Record<string, unknown> };
type Traza = {
  id: string;
  t_inicio: string;
  canal: string | null;
  pregunta: string;
  via: string | null;
  pasos: Paso[];
  respuesta: string | null;
  error: string | null;
  feedback: number | null;
  feedback_nota: string | null;
};

const NOMBRE: Record<Especialista, string> = {
  geologo: 'Geólogo',
  minas: 'Minas',
  civil: 'Civil',
  metalurgista: 'Metalurgista',
  geomatica: 'Geomática',
  ambiental: 'Ambiental',
  legal: 'Legal',
  economista: 'Economista',
};

/** Metas orientativas: con menos, el ajuste no mueve la aguja (ver scripts/entrenamiento/README.md). */
const META_QWEN = 300;
const META_LAYA = 100;

/** Pasos del arnés que no son herramientas del modelo: no se muestran como tales. */
const INTERNOS = new Set(['laya_panel', 'mapa_garantia', 'mapas_geo_garantia']);

const esLlamadaDirecta = (t: Traza) => t.canal === 'mcp' || /^[a-z_]+\s*\{/.test(t.pregunta.trim());
const tieneProblema = (t: Traza) => !!t.error || t.via === 'sin rondas' || t.via === 'sin tiempo' || t.feedback === -1 || t.pasos.some((p) => p.herramienta === 'pedido_rechazado' || (!p.ok && !INTERNOS.has(p.herramienta)));

/** Lo que decidió el panel en ese turno («laya → nadie, tabla → legal (…)»), para empezar desde ahí. */
export function panelDelTurno(pasos: Paso[]): Especialista[] {
  const r = pasos.find((p) => p.herramienta === 'laya_panel')?.resumen || '';
  const de = (quien: string) =>
    (r.match(new RegExp(`${quien} → ([a-z, ]+?)(?=\\s*\\(|,\\s*\\w+ →|$)`))?.[1] || '')
      .split(',')
      .map((x) => x.trim())
      .filter((x): x is Especialista => (ESPECIALISTAS as readonly string[]).includes(x));
  const laya = de('laya');
  return (laya.length ? laya : de('tabla')).slice(0, 2);
}

type Filtro = 'sin-revisar' | 'problemas' | 'revisadas' | 'todas';

export function Escuela() {
  const [trazas, setTrazas] = useState<Traza[] | null>(null);
  const [fallo, setFallo] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('problemas');

  const cargar = useCallback(async () => {
    setFallo('');
    try {
      const r = await fetch('/api/cognitivo/trazas?limite=300', { headers: headersElectrum() });
      const j: any = await r.json().catch(() => ({}));
      if (r.status === 403) throw new Error('La Escuela la ve solo quien tiene mando en Dr Electrum.');
      if (!r.ok) throw new Error(j?.error || `El servidor contestó ${r.status}.`);
      setTrazas((j.trazas as Traza[]).filter((t) => !esLlamadaDirecta(t)));
    } catch (e: any) {
      setFallo(String(e?.message || e));
    }
  }, []);
  useEffect(() => void cargar(), [cargar]);

  const cuentas = useMemo(() => {
    const ts = trazas || [];
    return {
      total: ts.length,
      revisadas: ts.filter((t) => t.feedback != null).length,
      qwen: ts.filter((t) => t.feedback === 1 || (t.feedback === -1 && !!leerRevision(t.feedback_nota).corrige)).length,
      laya: ts.filter((t) => leerRevision(t.feedback_nota).panel !== null).length,
      problemas: ts.filter((t) => tieneProblema(t) && t.feedback == null).length,
    };
  }, [trazas]);

  const vistas = useMemo(() => {
    const ts = trazas || [];
    if (filtro === 'sin-revisar') return ts.filter((t) => t.feedback == null);
    if (filtro === 'problemas') return ts.filter((t) => tieneProblema(t) && t.feedback == null);
    if (filtro === 'revisadas') return ts.filter((t) => t.feedback != null);
    return ts;
  }, [trazas, filtro]);

  const guardada = (id: string, feedback: 1 | -1, nota: string) => setTrazas((ts) => (ts || []).map((t) => (t.id === id ? { ...t, feedback, feedback_nota: nota } : t)));

  return (
    <div className="h-full overflow-y-auto px-4 py-3" data-escuela>
      <div className="mb-3">
        <h2 className="font-display text-[15px] font-semibold tracking-wide text-[#E7EEF2]">Escuela del equipo</h2>
        <p className="mt-0.5 text-[12px] leading-snug text-[#8FA2AC]">
          Revisá lo que contestó la mesa. Lo que marques como bueno, o corrijas, es lo que aprende Qwen; a quién debió convocar, lo aprende Laya. Los datos
          personales se tapan al exportar y los hechos no se entrenan: salen siempre de las herramientas.
        </p>
      </div>

      {fallo && <div className="mb-3 rounded-lg border border-[#E98A7A]/40 bg-[#E98A7A]/10 px-3 py-2 text-[12.5px] text-[#F3C2B8]">{fallo}</div>}

      {trazas && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-escuela-cuentas>
            <Cifra etiqueta="revisadas" valor={`${cuentas.revisadas} / ${cuentas.total}`} />
            <Cifra etiqueta={`para Qwen (meta ~${META_QWEN})`} valor={String(cuentas.qwen)} progreso={cuentas.qwen / META_QWEN} />
            <Cifra etiqueta={`para Laya (meta ~${META_LAYA})`} valor={String(cuentas.laya)} progreso={cuentas.laya / META_LAYA} />
            <Cifra etiqueta="con problemas sin revisar" valor={String(cuentas.problemas)} alerta={cuentas.problemas > 0} />
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Qué turnos ver">
            {(
              [
                ['problemas', 'Con problemas'],
                ['sin-revisar', 'Sin revisar'],
                ['revisadas', 'Revisadas'],
                ['todas', 'Todas'],
              ] as const
            ).map(([k, t]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={filtro === k}
                onClick={() => setFiltro(k)}
                className="rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors cursor-pointer"
                style={filtro === k ? { borderColor: `${AMBAR}99`, color: AMBAR, background: `${AMBAR}14` } : { borderColor: 'rgba(255,255,255,.14)', color: '#9FB0B8' }}
              >
                {t}
              </button>
            ))}
            <button type="button" onClick={() => void cargar()} className="ml-auto rounded-full px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#7F939D] hover:text-white cursor-pointer">
              ↻ Actualizar
            </button>
          </div>
          {!vistas.length && <p className="py-6 text-center text-[12.5px] text-[#7F939D]">No hay turnos en esta vista.</p>}
          <div className="space-y-3">
            {vistas.slice(0, 60).map((t) => (
              <div key={t.id}>
                <Tarjeta t={t} onGuardada={guardada} />
              </div>
            ))}
          </div>
        </>
      )}
      {!trazas && !fallo && <p className="py-6 text-center text-[12.5px] text-[#7F939D]">Trayendo los turnos…</p>}
    </div>
  );
}

function Cifra({ etiqueta, valor, progreso, alerta }: { etiqueta: string; valor: string; progreso?: number; alerta?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
      <div className="font-mono text-[16px] tabular-nums" style={{ color: alerta ? '#F0A58F' : '#E7EEF2' }}>
        {valor}
      </div>
      <div className="text-[10.5px] leading-tight text-[#7F939D]">{etiqueta}</div>
      {progreso !== undefined && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(progreso * 100))}%`, background: AMBAR }} />
        </div>
      )}
    </div>
  );
}

function Tarjeta({ t, onGuardada }: { t: Traza; onGuardada: (id: string, v: 1 | -1, nota: string) => void }) {
  const previa = leerRevision(t.feedback_nota);
  const [panel, setPanel] = useState<Especialista[]>(previa.panel ?? panelDelTurno(t.pasos));
  const [panelTocado, setPanelTocado] = useState(previa.panel !== null);
  const [corrige, setCorrige] = useState(previa.corrige || '');
  const [nota, setNota] = useState(previa.nota || '');
  const [abierta, setAbierta] = useState(false);
  const [estado, setEstado] = useState<'' | 'guardando' | 'fallo'>('');

  const alternar = (e: Especialista) => {
    setPanelTocado(true);
    setPanel((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e].slice(-2)));
  };

  const guardar = async (valor: 1 | -1) => {
    setEstado('guardando');
    // El panel entra si la persona lo tocó o si confirma el turno como bueno (confirma lo que decidió).
    const texto = escribirRevision({ panel: panelTocado || valor === 1 ? panel : null, corrige: corrige || null, nota: nota || null });
    try {
      const r = await fetch(`/api/cognitivo/trazas/${encodeURIComponent(t.id)}/opinion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersElectrum() },
        body: JSON.stringify({ valor, nota: texto }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error();
      setEstado('');
      onGuardada(t.id, valor, texto);
    } catch {
      setEstado('fallo');
    }
  };

  const herramientas = t.pasos.filter((p) => !INTERNOS.has(p.herramienta));
  const respuesta = t.respuesta || t.error || '(sin respuesta)';
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-escuela-turno={t.id}>
      <header className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#7F939D]">
        <span>{new Date(t.t_inicio).toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <span>· {t.canal || '—'}</span>
        {t.via && t.via !== 'contestó' && <span className="rounded bg-[#E98A7A]/15 px-1.5 py-0.5 text-[#F0A58F]">{t.via}</span>}
        {t.feedback === 1 && <span className="rounded bg-[#5CD6C4]/15 px-1.5 py-0.5 text-[#5CD6C4]">✓ sirve</span>}
        {t.feedback === -1 && <span className="rounded bg-[#E98A7A]/15 px-1.5 py-0.5 text-[#F0A58F]">✗ no sirve</span>}
      </header>
      <p className="text-[13.5px] font-medium leading-snug text-[#E7EEF2]">{t.pregunta}</p>
      {herramientas.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {herramientas.map((p, k) => (
            <span
              key={k}
              title={p.resumen || ''}
              className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
              style={p.ok ? { borderColor: 'rgba(92,214,196,.35)', color: '#8FE0D3' } : { borderColor: 'rgba(233,138,122,.45)', color: '#F0A58F' }}
            >
              {p.herramienta === 'pedido_rechazado' ? 'llamada ilegible' : p.herramienta}
              {p.ok ? '' : ' ✗'}
            </span>
          ))}
        </div>
      )}
      <div className={`mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-[#C9D5DB] ${abierta ? '' : 'line-clamp-4'}`}>{respuesta}</div>
      {respuesta.length > 280 && (
        <button type="button" onClick={() => setAbierta(!abierta)} className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#8FA2AC] hover:text-white cursor-pointer">
          {abierta ? 'Ver menos' : 'Ver todo'}
        </button>
      )}

      <div className="mt-2.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[#7F939D]">¿A quién debió convocar la mesa? (hasta 2)</div>
        <div className="flex flex-wrap gap-1">
          {ESPECIALISTAS.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={panel.includes(e)}
              onClick={() => alternar(e)}
              className="rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer"
              style={panel.includes(e) ? { borderColor: `${AMBAR}aa`, color: AMBAR, background: `${AMBAR}14` } : { borderColor: 'rgba(255,255,255,.12)', color: '#9FB0B8' }}
            >
              {panel.includes(e) && panel[0] === e && panel.length > 1 ? '1 · ' : ''}
              {NOMBRE[e]}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={panel.length === 0 && panelTocado}
            onClick={() => {
              setPanelTocado(true);
              setPanel([]);
            }}
            className="rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer"
            style={panel.length === 0 && panelTocado ? { borderColor: `${AMBAR}aa`, color: AMBAR } : { borderColor: 'rgba(255,255,255,.12)', color: '#9FB0B8' }}
          >
            Nadie
          </button>
        </div>
      </div>

      <textarea
        value={corrige}
        onChange={(e) => setCorrige(e.target.value)}
        rows={2}
        maxLength={560}
        placeholder="Si no sirvió: la respuesta que debió dar (esta es la que se enseña)"
        aria-label="Respuesta corregida"
        className="mt-2 w-full resize-y rounded-md border border-white/12 bg-black/30 px-2 py-1.5 text-[12.5px] text-[#E7EEF2] placeholder:text-[#6F838D] focus:border-[#FFAE3B]/60 focus:outline-none"
      />
      <input
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        maxLength={160}
        placeholder="Nota breve (qué falló o qué hizo bien)"
        aria-label="Nota"
        className="mt-1.5 w-full rounded-md border border-white/12 bg-black/30 px-2 py-1 text-[12px] text-[#E7EEF2] placeholder:text-[#6F838D] focus:border-[#FFAE3B]/60 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={estado === 'guardando'}
          onClick={() => void guardar(1)}
          className="rounded-lg border border-[#5CD6C4]/50 px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#5CD6C4] transition-colors hover:bg-[#5CD6C4]/10 disabled:opacity-50 cursor-pointer"
        >
          ✓ Sirve
        </button>
        <button
          type="button"
          disabled={estado === 'guardando'}
          onClick={() => void guardar(-1)}
          className="rounded-lg border border-[#E98A7A]/50 px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#F0A58F] transition-colors hover:bg-[#E98A7A]/10 disabled:opacity-50 cursor-pointer"
        >
          ✗ No sirve
        </button>
        {estado === 'fallo' && <span className="text-[11px] text-[#E98A7A]">No se guardó; probá otra vez.</span>}
      </div>
    </article>
  );
}
