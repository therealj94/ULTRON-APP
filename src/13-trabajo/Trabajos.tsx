/**
 * LAS TAREAS DURABLES EN LA WEB (AUR08, sección 6): el indicador mínimo del encabezado, el panel de tareas
 * (pendientes de decisión, las que esperan que sigas, en marcha y recientes), la tarjeta de decisión exacta, la de resultado con
 * evidencia y el enlace compacto que deja la burbuja del chat. La lógica es la del teléfono, tal cual
 * (mobile/src/lib/trabajos.ts, como ya se hace con mobile/src/lib/interrupcion).
 *
 *  · El servidor es la fuente de verdad (GET /api/trabajos): se pregunta con la pestaña visible, rápido si
 *    hay trabajo vivo; cerrar el panel o la pestaña no cancela nada y al volver la misma tarea sigue ahí.
 *  · La opción con efecto va al final, sin estilo principal ni foco inicial, no se arma hasta ARMADO_MS
 *    después de aparecer, no responde a Enter y no se activa si se acaba de escribir en otro campo.
 *  · Con «reducir movimiento», nada gira ni late.
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Dialogo } from '../07-pantallas/Dialogo';
import { headersMesa } from '../10-infra/sesionCliente';
import {
  ARMADO_MS,
  criteriosEnPalabras,
  crearClienteTrabajos,
  estadoInicial,
  etiquetaBoton,
  etiquetaEstado,
  etiquetaTarea,
  giraTarea,
  grupos,
  haceCuanto,
  indicadorEstable,
  lista,
  MINIMO_INDICADOR_MS,
  movimientoIndicador,
  opcionesTarjeta,
  puedeActivar,
  reducir,
  resumen,
  sondeoTrabajosMs,
  textoIndicador,
  textoProgreso,
  ultimaSenal,
  type Indicador,
  type Pedir,
  type RefTarea,
  type ResultadoAccion,
  type TareaVista,
} from '../../mobile/src/lib/trabajos';
import { cuerpoEdicion, empezarEdicion, MAX_EDITAR, puedeGuardar, type Edicion } from '../../mobile/src/lib/decisionesMesa';

const pedir: Pedir = async (ruta, init) => {
  const r = await fetch(ruta, { method: init?.method || 'GET', body: init?.body, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headersMesa() } });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
export const clienteTrabajos = crearClienteTrabajos(pedir);

/**
 * El aviso de la última lista PARCIAL (revisión 9, MEDIO-1): lo publica `useTrabajosWeb` y lo lee `PanelTrabajos` aunque
 * quien los une (App.tsx) no lo pase como prop. null si la última lista vino completa (o no hay sesión).
 */
let avisoLista: string | null = null;
const oyentesAviso = new Set<() => void>();
function ponerAvisoLista(a: string | null) {
  if (a === avisoLista) return;
  avisoLista = a;
  for (const f of oyentesAviso) f();
}
function useAvisoLista(): string | null {
  return useSyncExternalStore(
    (f) => {
      oyentesAviso.add(f);
      return () => oyentesAviso.delete(f);
    },
    () => avisoLista,
    () => null
  );
}

/** La última vez que se escribió en un campo de la página (para no aceptar una tarjeta que apareció mientras tanto). */
let ultimaTecla = 0;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) ultimaTecla = Date.now();
    },
    true
  );
}

function useReducirMovimiento(): boolean {
  const [r, setR] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => setR(m.matches);
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, []);
  return r;
}

/** Las tareas de la sesión: sondeo con la pestaña visible, reductor puro e indicador estable. */
export function useTrabajosWeb(o: { conSesion: boolean; cuenta?: string | null; panelAbierto: boolean }) {
  const [s, despachar] = useReducer(reducir, undefined, estadoInicial);
  // De qué cuenta es lo que se pide (punto 3, revisión del 4-oct): si cambia mientras una lista viene en camino, esa
  // lista era de la otra persona y no se aplica.
  const clave = o.conSesion ? String(o.cuenta || '') : '';
  const gen = useRef(0);
  const claveVista = useRef(clave);
  if (claveVista.current !== clave) {
    claveVista.current = clave;
    gen.current++;
  }
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [ind, setInd] = useState<Indicador | null>(null);
  const reducido = useReducirMovimiento();
  const tareas = useMemo(() => lista(s), [s]);
  const res = useMemo(() => resumen(tareas), [tareas]);
  const resRef = useRef(res);
  resRef.current = res;
  const ya = useRef<() => void>(() => undefined);

  useEffect(() => {
    const f = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  const claveEfecto = useRef(clave);

  const refrescar = useCallback(async () => {
    const g = gen.current;
    const r = await clienteTrabajos.listar();
    if (g !== gen.current) return;
    // Una lista parcial (`completo: false`) no borra las que no se pudieron leer: quedan «sin confirmar» y el aviso se ve.
    if (r.ok === true) despachar({ tipo: 'lista', tareas: r.tareas, en: Date.now(), completo: r.completo, aviso: r.aviso });
    else if (r.sinSesion) despachar({ tipo: 'sin-sesion' });
    else despachar({ tipo: 'error', mensaje: r.mensaje, en: Date.now() });
  }, []);

  useEffect(() => {
    // Sin sesión no hay tareas de nadie: se vacía (no quedan las de la cuenta anterior). Otra cuenta empieza vacía también.
    if (claveEfecto.current !== clave || !o.conSesion) {
      claveEfecto.current = clave;
      despachar({ tipo: 'sin-sesion' });
    }
    if (!o.conSesion) return;
    if (!visible) return;
    let vivo = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    let enVuelo = false;
    const vuelta = async () => {
      if (enVuelo) return;
      enVuelo = true;
      clearTimeout(t);
      try {
        await refrescar();
      } finally {
        enVuelo = false;
      }
      if (vivo) t = setTimeout(vuelta, sondeoTrabajosMs(resRef.current, o.panelAbierto));
    };
    ya.current = () => void vuelta();
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(t);
      ya.current = () => undefined;
    };
  }, [o.conSesion, clave, o.panelAbierto, visible, refrescar]);

  const avisoVista = s.aviso ?? null;
  useEffect(() => ponerAvisoLista(avisoVista), [avisoVista]);

  const texto = textoIndicador(res);
  useEffect(() => {
    setInd((prev) => indicadorEstable(prev, texto, Date.now()));
    const t = setTimeout(() => setInd((prev) => indicadorEstable(prev, texto, Date.now())), MINIMO_INDICADOR_MS + 50);
    return () => clearTimeout(t);
  }, [texto]);

  // Cada cuenta tiene su propio `aplicar`: un botón (Aprobar, Pausar…) que se pulsó con A guarda el de A, y si su respuesta
  // llega cuando ya está B, la tarea de A no entra al panel de B (revisión independiente del 4-oct).
  const genVista = gen.current;
  const aplicar = useCallback(
    (t: TareaVista | null | undefined) => {
      if (genVista !== gen.current) return;
      if (t) despachar({ tipo: 'una', tarea: t, en: Date.now() });
    },
    [genVista]
  );

  return { tareas, resumen: res, indicador: ind?.texto ?? null, reducido, refrescar, ahora: () => ya.current(), aplicar, error: s.error, aviso: avisoVista };
}

/* ------------------------------------------------------------------ el indicador */

export function IndicadorTrabajos({ texto, res, reducido, onAbrir }: { texto: string | null; res: { trabajando: number; decisiones: number }; reducido: boolean; onAbrir: () => void }) {
  if (!texto) return null;
  const decision = res.decisiones > 0;
  const late = movimientoIndicador(res, reducido);
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-haspopup="dialog"
      aria-label={`${texto}. Abrir el panel de tareas`}
      className={`h-11 px-3 rounded-full aura-sombra flex items-center gap-2 text-[14px] font-semibold cursor-pointer max-w-[60vw] ${
        decision ? 'bg-(--aura-oro-suave) text-(--aura-oro-texto) border border-(--aura-oro)' : 'bg-(--aura-panel) text-(--aura-tinta) hover:bg-(--aura-oro-suave)'
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${decision ? 'bg-(--aura-oro)' : 'bg-(--aura-salvia)'} ${late ? 'animate-pulse' : ''}`} aria-hidden="true" />
      <span className="truncate">{texto}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ el enlace de la burbuja */

/** La tarjeta compacta que deja la respuesta del chat: título, estado de ahora, última actualización y «Ver». */
export function EnlacesTareas({ refs, porId, onAbrir }: { refs: RefTarea[]; porId: Record<string, TareaVista>; onAbrir: (id: string) => void }) {
  if (!refs.length) return null;
  return (
    <div className="flex flex-col gap-1.5 pl-1 w-full sm:max-w-[560px]">
      {refs.map((r) => {
        const t = porId[r.id];
        const estado = t?.state || r.state;
        return (
          <div key={r.id} className="aura-tarjeta px-3 py-2 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-(--aura-tinta) truncate">{t?.title || r.title}</p>
              <p className="text-[13px] text-(--aura-tinta-2)">
                {t ? etiquetaTarea(t) : etiquetaEstado(estado)}
                {t?.updatedAt || r.updatedAt ? ` · ${haceCuanto(t?.updatedAt || r.updatedAt)}` : ''}
              </p>
            </div>
            <button type="button" className="aura-secundario !min-h-[44px]" onClick={() => onAbrir(r.id)}>
              Ver tarea
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ el panel */

type PropsPanel = {
  abierto: boolean;
  onCerrar: () => void;
  tareas: TareaVista[];
  /** La última lista vino parcial: lo que dijo el servidor. Sin pasarla, se usa la que publicó `useTrabajosWeb`. */
  aviso?: string | null;
  reducido: boolean;
  enfoque: string | null;
  onTarea: (t: TareaVista | null | undefined) => void;
  onRefrescar: () => void;
  onEditar: (sugerencia: string) => void;
  /** «Abrir el escritorio» de una tarea de su computadora (13-trabajo/VisorEscritorio.tsx). */
  onAbrirEscritorio?: (t: TareaVista) => void;
};

/** ¿Esta tarea tiene un escritorio que abrir? La de su computadora, mientras sigue. */
export const tieneEscritorio = (t: Pick<TareaVista, 'terminal' | 'controls' | 'environment'>) => !t.terminal && (t.controls.open === 'computadora' || t.environment?.kind === 'computadora');

export function PanelTrabajos({ abierto, onCerrar, tareas, aviso: avisoProp, reducido, enfoque, onTarea, onRefrescar, onEditar, onAbrirEscritorio }: PropsPanel) {
  const cerrar = useRef<HTMLButtonElement | null>(null);
  const avisoPublicado = useAvisoLista();
  const aviso = avisoProp !== undefined ? avisoProp : avisoPublicado;
  const g = useMemo(() => grupos(tareas), [tareas]);
  const vacio = !g.decisiones.length && !g.esperan.length && !g.activas.length && !g.recientes.length;
  useEffect(() => {
    if (!abierto || !enfoque) return;
    const r = requestAnimationFrame(() => document.getElementById(`tarea-${enfoque}`)?.scrollIntoView({ block: 'nearest', behavior: reducido ? 'auto' : 'smooth' }));
    return () => cancelAnimationFrame(r);
  }, [abierto, enfoque, reducido]);
  const comun = { reducido, onTarea, onRefrescar, onEditar, onAbrirEscritorio, varias: g.decisiones.length > 1 };
  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      idTitulo="aura-tareas-titulo"
      id="aura-panel-tareas"
      inicial={cerrar}
      claseCapa="items-stretch justify-end"
      clase="aura-hoja w-full max-w-md h-full sm:rounded-l-[24px] p-4 flex flex-col gap-3 overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="aura-tareas-titulo" className="font-display font-semibold text-[20px] text-(--aura-tinta)">
            Tareas
          </h2>
          <p className="text-[14px] text-(--aura-tinta-2)">Cerrar esto no cancela nada: siguen en marcha.</p>
        </div>
        <button ref={cerrar} type="button" onClick={onCerrar} className="aura-redondo plano" aria-label="Cerrar el panel de tareas">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      {aviso && (
        <p id="aura-tareas-aviso" className="text-[14px] text-(--aura-error-texto)" role="status">
          {aviso}
        </p>
      )}
      {vacio && !aviso && <p className="text-[15px] text-(--aura-tinta-2)">No hay tareas en marcha. Cuando me pidas algo que tarde o necesite tu decisión, aparece aquí.</p>}
      {g.decisiones.length > 0 && <Seccion titulo="Necesitan tu decisión" tareas={g.decisiones} {...comun} />}
      {/* La tarea en curso de la conversación: espera que sigas; no va en «En marcha» (eso es trabajo de fondo). */}
      {g.esperan.length > 0 && <Seccion titulo="Esperan que sigas" tareas={g.esperan} {...comun} />}
      {g.activas.length > 0 && <Seccion titulo="En marcha" tareas={g.activas} {...comun} />}
      {g.recientes.length > 0 && <Seccion titulo="Recientes" tareas={g.recientes} {...comun} />}
    </Dialogo>
  );
}

type Comun = { reducido: boolean; onTarea: PropsPanel['onTarea']; onRefrescar: () => void; onEditar: (s: string) => void; onAbrirEscritorio?: (t: TareaVista) => void; varias: boolean };

function Seccion({ titulo, tareas, ...c }: Comun & { titulo: string; tareas: TareaVista[] }) {
  return (
    <section className="flex flex-col gap-2" aria-label={titulo}>
      <h3 className="aura-sobretitulo">{titulo}</h3>
      <ul className="flex flex-col gap-2" role="list">
        {tareas.map((t) => (
          <li key={t.id} id={`tarea-${t.id}`}>
            <TarjetaTarea t={t} {...c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TarjetaTarea({ t, reducido, onTarea, onRefrescar, onEditar, onAbrirEscritorio, varias }: Comun & { t: TareaVista }) {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const prog = textoProgreso(t.progress);
  const senal = ultimaSenal(t);
  const tras = (r: ResultadoAccion) => {
    if (r.ok === true) {
      setAviso(null);
      onTarea(r.tarea);
      if (!r.tarea) onRefrescar();
    } else {
      setAviso(r.mensaje);
      if (r.tarea) onTarea(r.tarea);
      else onRefrescar();
    }
  };
  const control = async (f: () => Promise<ResultadoAccion>) => {
    setOcupado(true);
    try {
      tras(await f());
    } finally {
      setOcupado(false);
    }
  };
  const idTitulo = `tarea-titulo-${t.id}`;
  return (
    <article aria-labelledby={idTitulo} className="aura-tarjeta p-3 flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <h4 id={idTitulo} className="flex-1 font-semibold text-[16px] leading-snug text-(--aura-tinta)">
          {t.title}
        </h4>
        <span className={`text-[13px] font-semibold flex items-center gap-1.5 ${t.state === 'failed' || t.state === 'blocked' ? 'text-(--aura-error-texto)' : t.state === 'completed' ? 'text-(--aura-ok-texto)' : 'text-(--aura-tinta-2)'}`}>
          {giraTarea(t) && !t.sinConfirmar && !reducido && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />}
          {etiquetaTarea(t)}
        </span>
      </div>
      {t.objective && t.objective !== t.title && <p className="text-[14px] text-(--aura-tinta-2)">{t.objective}</p>}
      <p className="text-[13px] text-(--aura-tinta-2)">{[t.environment.displayName, prog, senal ? `última señal ${senal}` : ''].filter(Boolean).join(' · ')}</p>
      {t.sinConfirmar && <p className="text-[13px] font-semibold text-(--aura-error-texto)">Sin confirmar: no pude leerla ahora; es lo último que supe, no es que ya no exista.</p>}
      {t.currentStep && !t.terminal && <p className="text-[14px] text-(--aura-tinta)">{t.currentStep}</p>}
      {t.decision && !t.terminal && <TarjetaDecision t={t} varias={varias} onResultado={tras} onEditar={onEditar} />}
      {t.result && <TarjetaResultado t={t} />}
      {aviso && (
        <p className="text-[14px] text-(--aura-error-texto)" role="status">
          {aviso}
        </p>
      )}
      {!t.terminal && (
        <div className="flex flex-wrap gap-2 pt-1">
          {onAbrirEscritorio && tieneEscritorio(t) && (
            <button type="button" className="aura-secundario" onClick={() => onAbrirEscritorio(t)} aria-label={`Abrir el escritorio de tu computadora: ${t.title}`}>
              Abrir el escritorio
            </button>
          )}
          {t.controls.pause && (
            <button type="button" className="aura-secundario" disabled={ocupado} onClick={() => void control(() => clienteTrabajos.pausar(t.id))}>
              Pausar
            </button>
          )}
          {t.controls.resume && (
            <button type="button" className="aura-secundario" disabled={ocupado} onClick={() => void control(() => clienteTrabajos.reanudar(t.id))}>
              Reanudar
            </button>
          )}
          {t.controls.cancel && (
            <button
              type="button"
              className="aura-secundario peligro"
              disabled={ocupado}
              onClick={() => {
                if (window.confirm('¿Cancelar esta tarea? No hago nada más con ella; lo que ya se hizo queda anotado.')) void control(() => clienteTrabajos.cancelar(t.id));
              }}
            >
              Cancelar tarea
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function TarjetaDecision({ t, varias, onResultado, onEditar }: { t: TareaVista; varias: boolean; onResultado: (r: ResultadoAccion) => void; onEditar: (s: string) => void }) {
  const d = t.decision!;
  const aparecio = useRef(Date.now());
  const idVisto = useRef(d.id);
  if (idVisto.current !== d.id) {
    idVisto.current = d.id;
    aparecio.current = Date.now();
  }
  const [armada, setArmada] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  /** El último botón activado con Enter o espacio (un clic de teclado no aprueba). */
  const porTeclado = useRef<string | null>(null);
  useEffect(() => {
    setArmada(false);
    const r = setTimeout(() => setArmada(true), ARMADO_MS + 30);
    return () => clearTimeout(r);
  }, [d.id]);
  const ops = opcionesTarjeta(d);
  // José (5-oct): «Editar» cambia el texto aquí mismo (si el servidor manda el texto entero del borrador). Al guardar
  // vuelve otra decisión para ESE texto: hay que volver a aprobarla. Nada sale al editar. Sin texto entero, como antes.
  const item = { tipo: 'tarea' as const, clave: `${t.id}:${d.id}`, id: t.id, tarea: t, creada: 0 };
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [avisoEdicion, setAvisoEdicion] = useState<string | null>(null);
  useEffect(() => {
    setEdicion(null);
    setAvisoEdicion(null);
  }, [d.id]);
  const guardar = async () => {
    if (!edicion || !puedeGuardar(edicion) || ocupado) return;
    setOcupado('guardar');
    try {
      const r = await clienteTrabajos.editar(t, cuerpoEdicion(edicion));
      if (r.ok === true) setEdicion(null);
      else setAvisoEdicion(r.mensaje);
      onResultado(r);
    } finally {
      setOcupado(null);
    }
  };
  const elegir = async (id: string, conEfecto: boolean) => {
    const via = porTeclado.current === id ? 'enter' : 'toque';
    porTeclado.current = null;
    if (!puedeActivar({ conEfecto }, { aparecio: aparecio.current, ahora: Date.now(), via, escribioHace: Date.now() - ultimaTecla })) return;
    if (id === 'editar') {
      const e = empezarEdicion(item);
      if (e) {
        setEdicion(e);
        return;
      }
    }
    setOcupado(id);
    try {
      const r = await clienteTrabajos.decidir(t, id);
      onResultado(r);
      if (r.ok && id === 'editar' && r.sugerencia) onEditar(r.sugerencia);
    } finally {
      setOcupado(null);
    }
  };
  const filas: [string, string | undefined][] = [
    ['Acción', d.proposal.action],
    ['Desde', d.proposal.account],
    ['Para', d.proposal.recipient],
    ['Importe', d.proposal.amount],
    ['Se repite', d.proposal.recurrence],
    ['Alcance', d.proposal.scope],
    [d.expired ? 'Caducó' : 'Caduca', d.expiresAt ? new Date(d.expiresAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : undefined],
  ];
  return (
    <div className="rounded-[14px] border border-(--aura-oro) bg-(--aura-oro-suave) p-3 flex flex-col gap-2" role="group" aria-label={`Decisión: ${d.question}`}>
      <p className="font-semibold text-[15px] text-(--aura-oro-texto)">{d.question}</p>
      <p className="text-[14px] text-(--aura-tinta-2)">{d.why}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
        {filas
          .filter(([, v]) => !!v)
          .map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-(--aura-tinta-2)">{k}</dt>
              <dd className="text-(--aura-tinta) min-w-0 [overflow-wrap:anywhere]">{v}</dd>
            </React.Fragment>
          ))}
      </dl>
      {d.proposal.data.map((x, i) => (
        <p key={i} className="text-[14px] text-(--aura-tinta) aura-seleccionable whitespace-pre-wrap [overflow-wrap:anywhere]">
          {x}
        </p>
      ))}
      {d.postponed && <p className="text-[13px] text-(--aura-tinta-2)">Pospuesta: sigue esperando, sin aprobar.</p>}
      {edicion && (
        <div className="flex flex-col gap-2">
          {edicion.asunto !== undefined && (
            <label className="flex flex-col gap-1 text-[14px] text-(--aura-tinta-2)">
              Asunto
              <input className="aura-campo" value={edicion.asunto} maxLength={200} onChange={(e) => setEdicion({ ...edicion, asunto: e.target.value })} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-[14px] text-(--aura-tinta-2)">
            Texto (lo que se va a enviar)
            <textarea className="aura-campo min-h-[120px]" value={edicion.texto} maxLength={MAX_EDITAR} onChange={(e) => setEdicion({ ...edicion, texto: e.target.value })} autoFocus />
          </label>
          <p className="text-[13px] text-(--aura-tinta-2)">No se envía al guardar: te lo vuelvo a mostrar para que lo apruebes.</p>
          {avisoEdicion && (
            <p className="text-[13px] text-(--aura-alerta,#b45309)" role="alert">
              {avisoEdicion}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="aura-secundario" disabled={!puedeGuardar(edicion) || !!ocupado} onClick={() => void guardar()}>
              {ocupado === 'guardar' ? 'Un momento…' : 'Guardar y revisar'}
            </button>
            <button type="button" className="aura-chip" disabled={!!ocupado} onClick={() => setEdicion(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      <ul className={edicion ? 'hidden' : 'flex flex-col gap-2 pt-1'} role="list">
        {ops.map((o) => (
          <li key={o.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              className={o.conEfecto ? 'aura-secundario self-start' : 'aura-chip self-start'}
              disabled={!!ocupado || (o.conEfecto && !armada)}
              aria-describedby={`efecto-${t.id}-${o.id}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') porTeclado.current = o.id;
              }}
              onClick={() => void elegir(o.id, o.conEfecto)}
            >
              {ocupado === o.id ? 'Un momento…' : etiquetaBoton(o, t, varias)}
            </button>
            <span id={`efecto-${t.id}-${o.id}`} className="text-[13px] text-(--aura-tinta-2) pl-1">
              {o.effect}
              {o.conEfecto && !armada ? ' (se habilita en un instante, para que no se apruebe sin leer)' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TarjetaResultado({ t }: { t: TareaVista }) {
  const r = t.result!;
  const pedidos = criteriosEnPalabras(t.acceptance);
  return (
    <div className="rounded-[14px] border border-(--aura-borde) p-3 flex flex-col gap-1.5">
      <p className="aura-sobretitulo">Resultado</p>
      <p className="text-[15px] text-(--aura-tinta) aura-seleccionable [overflow-wrap:anywhere]">{r.summary}</p>
      {pedidos.length > 0 && (
        <>
          <p className="text-[13px] font-semibold text-(--aura-tinta-2)">Lo que pediste, uno por uno</p>
          <ul className="flex flex-col gap-1 text-[14px]" role="list">
            {pedidos.map((c) => (
              <li key={c.id} className={`[overflow-wrap:anywhere] ${c.estado === 'verified' ? 'text-(--aura-tinta)' : 'text-(--aura-error-texto)'}`}>
                {c.texto}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.evidence.length > 0 && (
        <>
          <p className="text-[13px] font-semibold text-(--aura-tinta-2)">Lo que lo acredita</p>
          <ul className="flex flex-col gap-1 text-[14px]" role="list">
            {r.evidence.map((e) => (
              <li key={e.id} className="[overflow-wrap:anywhere]">
                {e.ref && /^https:\/\//i.test(e.ref) ? (
                  <a href={e.ref} target="_blank" rel="noopener noreferrer" className="text-(--aura-oro-texto) underline">
                    {e.etiqueta}
                  </a>
                ) : (
                  <span className="text-(--aura-tinta)">· {e.etiqueta}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.partial.length > 0 && (
        <>
          <p className="text-[13px] font-semibold text-(--aura-error-texto)">Quedó parcial</p>
          <ul className="text-[14px] text-(--aura-tinta)" role="list">
            {r.partial.map((p, i) => (
              <li key={i}>· {p}</li>
            ))}
          </ul>
        </>
      )}
      {r.pending.length > 0 && (
        <>
          <p className="text-[13px] font-semibold text-(--aura-tinta-2)">Requiere tu decisión</p>
          <ul className="text-[14px] text-(--aura-tinta)" role="list">
            {r.pending.map((p, i) => (
              <li key={i}>· {p}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
