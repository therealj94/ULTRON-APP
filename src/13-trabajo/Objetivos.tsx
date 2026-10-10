/**
 * LOS OBJETIVOS CON ESTADO EN LA WEB (Fase 2): el botón «Objetivos» del encabezado y su panel —la lista y la hoja de cada
 * uno: meta, siguiente paso, criterios de cierre (✓ o pendiente), documentos vigentes con su versión, decisiones y lo que
 * pasó— con «qué cambió desde que te fuiste» POR NAVEGADOR (la última revisión vista se guarda aquí, no en el servidor).
 * La lógica es la del teléfono, tal cual (mobile/src/lib/objetivos.ts, como lib/trabajos.ts para las Tareas).
 *
 *  · El servidor es la fuente de verdad (GET /api/objetivos): se pregunta con la pestaña visible, despacio.
 *  · Decidir manda la opción con la revisión que se ve (`revisionVista`). Si cambió mientras tanto (409), se muestra el
 *    objetivo de ahora y se dice «Cambió mientras tanto»; nada se reintenta solo.
 *  · Las opciones no se arman hasta ARMADO_MS después de aparecer la pregunta; al habilitarse se anuncia (región viva).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialogo } from '../07-pantallas/Dialogo';
import { headersMesa } from '../10-infra/sesionCliente';
import { haceCuanto, type Pedir } from '../../mobile/src/lib/trabajos';
import {
  anotarVista,
  ARMADO_MS,
  controlesObjetivo,
  crearClienteObjetivos,
  criteriosVista,
  decisionesSinElegir,
  documentosVigentes,
  esTerminalObjetivo,
  etiquetaEstadoObjetivo,
  evidenciasParaCerrar,
  hayNovedad,
  lineaQueCambio,
  ultimaVista,
  type CambiosObjetivo,
  type DecisionObjetivo,
  type ResultadoObjetivo,
  type VistaObjetivo,
  type VistosObjetivos,
} from '../../mobile/src/lib/objetivos';

const pedir: Pedir = async (ruta, init) => {
  const r = await fetch(ruta, { method: init?.method || 'GET', body: init?.body, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headersMesa() } });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
export const clienteObjetivos = crearClienteObjetivos(pedir);

/* ------------------------------------------------------------------ lo visto en ESTE navegador */

const CLAVE_VISTOS = 'aura.objetivos.vistos.v1';
function leerVistos(): VistosObjetivos {
  try {
    const s = localStorage.getItem(CLAVE_VISTOS);
    const v = s ? JSON.parse(s) : {};
    return v && typeof v === 'object' ? (v as VistosObjetivos) : {};
  } catch {
    return {};
  }
}
function guardarVistos(v: VistosObjetivos) {
  try {
    localStorage.setItem(CLAVE_VISTOS, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: todo cuenta como nuevo, que es lo honesto */
  }
}

/** Cada cuánto se pregunta con la pestaña visible (los objetivos cambian poco). */
export const SONDEO_OBJETIVOS_WEB_MS = 45_000;

/** Los objetivos de la sesión: sondeo con la pestaña visible y lo visto por navegador. */
export function useObjetivosWeb(o: { conSesion: boolean; cuenta?: string | null; panelAbierto: boolean }) {
  const [objetivos, setObjetivos] = useState<VistaObjetivo[]>([]);
  const [vistos, setVistos] = useState<VistosObjetivos>(() => (typeof localStorage === 'undefined' ? {} : leerVistos()));
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const clave = o.conSesion ? String(o.cuenta || '') : '';
  const gen = useRef(0);
  useEffect(() => {
    gen.current++;
    setObjetivos([]);
  }, [clave]);
  useEffect(() => {
    const f = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  const refrescar = useCallback(async () => {
    const g = gen.current;
    const r = await clienteObjetivos.listar();
    if (g !== gen.current) return;
    if (r.ok === true) setObjetivos(r.objetivos);
    else if (r.sinSesion) setObjetivos([]);
  }, []);
  useEffect(() => {
    if (!o.conSesion || !visible) return;
    void refrescar();
    const t = setInterval(() => void refrescar(), o.panelAbierto ? 15_000 : SONDEO_OBJETIVOS_WEB_MS);
    return () => clearInterval(t);
  }, [o.conSesion, clave, visible, o.panelAbierto, refrescar]);
  /** Lo que contestó el servidor (o el objetivo de ahora de un 409) reemplaza lo que había, nunca hacia atrás. */
  const aplicar = useCallback((x: VistaObjetivo | null | undefined) => {
    if (!x || typeof x.id !== 'string') return;
    setObjetivos((xs) => {
      const previo = xs.find((y) => y.id === x.id);
      if (previo && previo.revision > x.revision) return xs;
      return [x, ...xs.filter((y) => y.id !== x.id)].sort((a, b) => (b.actualizado || 0) - (a.actualizado || 0));
    });
  }, []);
  const marcarVisto = useCallback((x: Pick<VistaObjetivo, 'id' | 'revision'>) => {
    setVistos((v) => {
      const n = anotarVista(v, x.id, x.revision, Date.now());
      if (JSON.stringify(n) !== JSON.stringify(v)) guardarVistos(n);
      return n;
    });
  }, []);
  const abiertos = useMemo(() => objetivos.filter((x) => !esTerminalObjetivo(x)), [objetivos]);
  const novedades = useMemo(() => abiertos.filter((x) => hayNovedad(x, vistos)).length, [abiertos, vistos]);
  return { objetivos, abiertos, novedades, vistos, refrescar, aplicar, marcarVisto };
}

/* ------------------------------------------------------------------ el botón del encabezado */

export function BotonObjetivos({ abiertos, novedades, decisiones, onAbrir }: { abiertos: number; novedades: number; decisiones: number; onAbrir: () => void }) {
  if (!abiertos) return null;
  const texto = decisiones > 0 ? `Objetivos · ${decisiones} por decidir` : `Objetivos · ${abiertos}`;
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-haspopup="dialog"
      aria-label={`${texto}${novedades ? `, ${novedades} con novedades desde que te fuiste` : ''}. Abrir tus objetivos`}
      className={`h-11 px-3 rounded-full aura-sombra flex items-center gap-2 text-[14px] font-semibold cursor-pointer max-w-[50vw] ${
        decisiones > 0 ? 'bg-(--aura-oro-suave) text-(--aura-oro-texto) border border-(--aura-oro)' : 'bg-(--aura-panel) text-(--aura-tinta) hover:bg-(--aura-oro-suave)'
      }`}
    >
      {novedades > 0 && <span className="w-2 h-2 rounded-full shrink-0 bg-(--aura-oro)" aria-hidden="true" />}
      <span className="truncate">{texto}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ el panel */

type PropsPanel = {
  abierto: boolean;
  onCerrar: () => void;
  objetivos: VistaObjetivo[];
  vistos: VistosObjetivos;
  onObjetivo: (o: VistaObjetivo | null | undefined) => void;
  marcarVisto: (o: Pick<VistaObjetivo, 'id' | 'revision'>) => void;
  onRefrescar: () => void;
};

export function PanelObjetivos({ abierto, onCerrar, objetivos, vistos, onObjetivo, marcarVisto, onRefrescar }: PropsPanel) {
  const cerrar = useRef<HTMLButtonElement | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const abiertos = objetivos.filter((o) => !esTerminalObjetivo(o));
  const terminados = objetivos.filter((o) => esTerminalObjetivo(o)).slice(0, 5);
  const actual = objetivos.find((o) => o.id === elegido) || abiertos[0] || null;
  useEffect(() => {
    if (!abierto) setElegido(null);
  }, [abierto]);
  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      idTitulo="aura-objetivos-titulo"
      id="aura-panel-objetivos"
      inicial={cerrar}
      claseCapa="items-stretch justify-end"
      clase="aura-hoja w-full max-w-md h-full sm:rounded-l-[24px] p-4 flex flex-col gap-3 overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="aura-objetivos-titulo" className="font-display font-semibold text-[20px] text-(--aura-tinta)">
            Objetivos
          </h2>
          <p className="text-[14px] text-(--aura-tinta-2)">Lo que estamos logrando juntos. Cerrar esto no cancela nada.</p>
        </div>
        <button ref={cerrar} type="button" onClick={onCerrar} className="aura-redondo plano" aria-label="Cerrar tus objetivos">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      {!objetivos.length && <p className="text-[15px] text-(--aura-tinta-2)">Todavía no hay objetivos. Cuando me pidas algo que lleve varios pasos, aparece aquí.</p>}
      {(abiertos.length > 1 || terminados.length > 0) && (
        <nav aria-label="Tus objetivos" className="flex flex-wrap gap-2">
          {[...abiertos, ...terminados].map((o) => (
            <button
              key={o.id}
              type="button"
              className={`aura-chip ${actual?.id === o.id ? 'activo' : ''}`}
              aria-pressed={actual?.id === o.id}
              onClick={() => setElegido(o.id)}
            >
              {hayNovedad(o, vistos) && !esTerminalObjetivo(o) ? '• ' : ''}
              {o.titulo}
              <span className="sr-only">{`, ${etiquetaEstadoObjetivo(o)}`}</span>
            </button>
          ))}
        </nav>
      )}
      {actual && abierto && <HojaObjetivoWeb key={actual.id} o={actual} desde={ultimaVista(vistos, actual.id)} onObjetivo={onObjetivo} marcarVisto={marcarVisto} onRefrescar={onRefrescar} />}
    </Dialogo>
  );
}

/* ------------------------------------------------------------------ la hoja */

function HojaObjetivoWeb({ o, desde, onObjetivo, marcarVisto, onRefrescar }: { key?: string; o: VistaObjetivo; desde: number; onObjetivo: PropsPanel['onObjetivo']; marcarVisto: PropsPanel['marcarVisto']; onRefrescar: () => void }) {
  // «Qué cambió desde que te fuiste»: se pide UNA vez al abrir, desde lo último visto en este navegador; después se anota
  // la revisión de ahora como vista (lo de arriba sigue a la vista mientras la hoja esté abierta).
  const desdeAlAbrir = useRef(desde);
  const [cambios, setCambios] = useState<CambiosObjetivo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  useEffect(() => {
    let vivo = true;
    void clienteObjetivos.cambios(o.id, desdeAlAbrir.current).then((c) => {
      if (vivo) setCambios(c);
    });
    return () => {
      vivo = false;
    };
  }, [o.id]);
  useEffect(() => {
    marcarVisto(o);
  }, [o.id, o.revision, marcarVisto]); // eslint-disable-line react-hooks/exhaustive-deps

  const tras = (r: ResultadoObjetivo) => {
    if (r.ok === true) {
      setAviso(null);
      onObjetivo(r.objetivo);
      if (!r.objetivo) onRefrescar();
    } else {
      setAviso(r.conflicto ? 'Cambió mientras tanto: te muestro la versión nueva. No apliqué nada.' : r.mensaje);
      if (r.objetivo) onObjetivo(r.objetivo);
      else onRefrescar();
    }
  };
  const control = async (c: 'pausar' | 'reanudar' | 'cancelar') => {
    setOcupado(c);
    try {
      tras(await clienteObjetivos[c](o.id, o.revision));
    } finally {
      setOcupado(null);
    }
  };
  const criterios = criteriosVista(o);
  const docs = documentosVigentes(o);
  const pendientes = decisionesSinElegir(o);
  const tomadas = o.decisiones.filter((d) => d.elegida);
  const ctl = controlesObjetivo(o);
  const evidencias = evidenciasParaCerrar(o, elegidos);
  const nuevos = cambios && !cambios.resync ? cambios.eventos.slice(-5).reverse() : [];
  const idTitulo = `objetivo-titulo-${o.id}`;
  return (
    <article aria-labelledby={idTitulo} className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <h3 id={idTitulo} className="flex-1 font-semibold text-[18px] leading-snug text-(--aura-tinta)">
          {o.titulo}
        </h3>
        <span role="status" className={`text-[13px] font-semibold ${o.estado === 'esperando-decision' ? 'text-(--aura-oro-texto)' : o.estado === 'fallido' || o.estado === 'incierto' ? 'text-(--aura-error-texto)' : o.estado === 'completado' ? 'text-(--aura-ok-texto)' : 'text-(--aura-tinta-2)'}`}>
          {etiquetaEstadoObjetivo(o)}
        </span>
      </div>
      {cambios && (
        <section aria-label="Qué cambió desde que te fuiste" className="rounded-[14px] border border-(--aura-borde) p-3 flex flex-col gap-1">
          <p className="aura-sobretitulo">Qué cambió desde que te fuiste</p>
          {nuevos.length > 1 ? (
            <ul className="text-[14px] text-(--aura-tinta) flex flex-col gap-0.5" role="list">
              {nuevos.map((e) => (
                <li key={e.revision}>
                  · {e.texto} <span className="text-(--aura-tinta-2)">({haceCuanto(new Date(e.t).toISOString())})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-(--aura-tinta)">{lineaQueCambio(cambios, 'es', o)}</p>
          )}
        </section>
      )}
      {aviso && (
        <p className="text-[14px] text-(--aura-error-texto)" role="alert">
          {aviso}
        </p>
      )}
      <section className="flex flex-col gap-1" aria-label="Meta">
        <p className="aura-sobretitulo">Meta</p>
        <p className="text-[15px] text-(--aura-tinta) aura-seleccionable [overflow-wrap:anywhere]">{o.meta}</p>
        {o.siguientePaso && (
          <p className="text-[14px] text-(--aura-tinta)">
            <strong>Siguiente:</strong> {o.siguientePaso}
          </p>
        )}
      </section>
      {pendientes.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Necesita tu decisión">
          <p className="aura-sobretitulo">Necesita tu decisión</p>
          {pendientes.map((d) => (
            <DecisionWeb key={d.id} o={o} d={d} onResultado={tras} />
          ))}
        </section>
      )}
      <section className="flex flex-col gap-1" aria-label="Cómo sabremos que está terminado">
        <p className="aura-sobretitulo">Cómo sabremos que está terminado</p>
        <ul className="flex flex-col gap-1 text-[14px]" role="list">
          {criterios.map((c) => (
            <li key={c.id} className="flex gap-2" aria-label={c.etiqueta}>
              <span className={`min-w-[72px] font-semibold ${c.cumplido ? 'text-(--aura-ok-texto)' : 'text-(--aura-tinta-2)'}`} aria-hidden="true">
                {c.marca}
              </span>
              <span className="text-(--aura-tinta) [overflow-wrap:anywhere]" aria-hidden="true">
                {c.texto}
              </span>
            </li>
          ))}
        </ul>
        {cerrando &&
          o.criterioCierre
            .filter((c) => !c.evidencias.length)
            .map((c) => (
              <label key={c.id} className="flex flex-col gap-1 text-[13px] text-(--aura-tinta-2)">
                Evidencia de «{c.texto}»
                <select className="aura-campo" value={elegidos[c.id] || ''} onChange={(e) => setElegidos((x) => ({ ...x, [c.id]: e.target.value }))}>
                  <option value="">Elige un documento vigente…</option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre} · v{d.version}
                    </option>
                  ))}
                </select>
              </label>
            ))}
      </section>
      <section className="flex flex-col gap-1" aria-label="Documentos vigentes">
        <p className="aura-sobretitulo">Documentos vigentes</p>
        {docs.length ? (
          <ul className="text-[14px] text-(--aura-tinta)" role="list">
            {docs.map((d) => (
              <li key={d.id} className="[overflow-wrap:anywhere]">
                · {d.nombre} <span className="text-(--aura-tinta-2)">v{d.version}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-(--aura-tinta-2)">Todavía ninguno.</p>
        )}
      </section>
      {tomadas.length > 0 && (
        <section className="flex flex-col gap-1" aria-label="Decisiones tomadas">
          <p className="aura-sobretitulo">Decisiones tomadas</p>
          <ul className="text-[14px] text-(--aura-tinta)" role="list">
            {tomadas.slice(-6).map((d) => (
              <li key={d.id}>
                {d.pregunta} <strong>→ {d.opciones.find((x) => x.id === d.elegida)?.etiqueta || d.elegida}</strong>
                {d.por === 'aura' ? ' (AURA, con tu permiso)' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-1" aria-label="Lo que pasó">
        <p className="aura-sobretitulo">Lo que pasó</p>
        <ul className="text-[13px] text-(--aura-tinta-2) flex flex-col gap-0.5" role="list">
          {[...o.eventos]
            .reverse()
            .slice(0, 10)
            .map((e) => (
              <li key={e.revision}>
                {haceCuanto(new Date(e.t).toISOString())} · {e.texto}
              </li>
            ))}
        </ul>
      </section>
      {!o.terminal && (
        <div className="flex flex-wrap gap-2 pt-1">
          {ctl.pausar && (
            <button type="button" className="aura-secundario" disabled={!!ocupado} onClick={() => void control('pausar')}>
              Pausar
            </button>
          )}
          {ctl.reanudar && (
            <button type="button" className="aura-secundario" disabled={!!ocupado} onClick={() => void control('reanudar')}>
              Reanudar
            </button>
          )}
          {ctl.cerrar && !cerrando && (
            <button type="button" className="aura-secundario" disabled={!!ocupado} onClick={() => setCerrando(true)}>
              Cerrar con evidencia
            </button>
          )}
          {cerrando && (
            <>
              <button
                type="button"
                className="aura-secundario"
                disabled={!!ocupado || !evidencias}
                onClick={async () => {
                  if (!evidencias) return;
                  setOcupado('cerrar');
                  try {
                    const r = await clienteObjetivos.cerrar(o.id, o.revision, evidencias);
                    tras(r);
                    if (r.ok === true) setCerrando(false);
                  } finally {
                    setOcupado(null);
                  }
                }}
              >
                {ocupado === 'cerrar' ? 'Un momento…' : 'Confirmar cierre'}
              </button>
              <button type="button" className="aura-chip" disabled={!!ocupado} onClick={() => setCerrando(false)}>
                No cerrar
              </button>
            </>
          )}
          {ctl.cancelar && (
            <button
              type="button"
              className="aura-secundario peligro"
              disabled={!!ocupado}
              onClick={() => {
                if (window.confirm('¿Cancelar este objetivo? No hago nada más con él y descarto los borradores que esperaban tu «sí». Lo que ya se hizo queda anotado.')) void control('cancelar');
              }}
            >
              Cancelar objetivo
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function DecisionWeb({ o, d, onResultado }: { key?: string; o: VistaObjetivo; d: DecisionObjetivo; onResultado: (r: ResultadoObjetivo) => void }) {
  const [armada, setArmada] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  useEffect(() => {
    setArmada(false);
    const t = setTimeout(() => setArmada(true), ARMADO_MS + 30);
    return () => clearTimeout(t);
  }, [d.id, o.revision]);
  const elegir = async (opcion: string) => {
    if (!armada || ocupado) return;
    setOcupado(opcion);
    try {
      onResultado(await clienteObjetivos.decidir(o.id, { decisionId: d.id, opcion, revisionVista: o.revision }));
    } finally {
      setOcupado(null);
    }
  };
  return (
    <div className="rounded-[14px] border border-(--aura-oro) bg-(--aura-oro-suave) p-3 flex flex-col gap-2" role="group" aria-label={`Decisión: ${d.pregunta}`}>
      <p className="font-semibold text-[15px] text-(--aura-oro-texto)">{d.pregunta}</p>
      {/* Al habilitarse las opciones se anuncia (un lector de pantalla no ve que el botón dejó de estar apagado). */}
      <p className="sr-only" aria-live="polite">
        {armada ? 'Ya puedes elegir una opción.' : ''}
      </p>
      <ul className="flex flex-col gap-2" role="list">
        {d.opciones.map((op) => (
          <li key={op.id} className="flex flex-col gap-0.5">
            <button type="button" className="aura-secundario self-start" disabled={!!ocupado || !armada} aria-describedby={`consecuencia-${d.id}-${op.id}`} onClick={() => void elegir(op.id)}>
              {ocupado === op.id ? 'Un momento…' : op.etiqueta}
            </button>
            <span id={`consecuencia-${d.id}-${op.id}`} className="text-[13px] text-(--aura-tinta-2) pl-1">
              {op.consecuencia}
              {!armada ? ' (se habilita en un instante, para que no se elija sin leer)' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
