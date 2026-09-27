/**
 * INFRAESTRUCTURA — lo que sabe Dr Electrum, a la vista y bajo control.
 *
 * Todo lo cargado (documentos y capas del mapa) en carpetas, con el ESTADO de cada pieza calculado
 * de lo que de verdad hay en la base: si no tiene texto, si quedó cortado, si está repetido. Desde
 * aquí se sube dentro de una carpeta, se mueve, se renombra, se relee desde el original, se borra
 * y se importa una carpeta entera del cubo. Cada cambio queda en la bitácora.
 *
 * Mirar es para todos; ordenar y releer, nivel de trabajo; borrar e importar, mando. La pantalla
 * esconde lo que no se puede hacer, pero quien decide es el servidor.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { headersElectrum, SIN_PUERTA } from '../acceso';

const AMBAR = '#FFAE3B';
const ROJO = '#E0765F';
const AZUL = '#7FB2FF';
const R = '/api/electrum/biblioteca';

type Nivel = 'lee' | 'escribe' | 'mando' | null;
type Estado = 'ok' | 'sin_texto' | 'cortado' | 'poco_texto' | 'repetido' | 'vacia';
type Item = {
  clase: 'documento' | 'capa';
  id: number;
  nombre: string;
  carpeta: string | null;
  subido: string;
  subido_por: string | null;
  detalle: string;
  cantidad: number;
  fragmentos: number;
  caracteres: number;
  sin_vector: number;
  original: boolean;
  releido: string | null;
  estado: Estado;
};
type Resumen = {
  documentos: number;
  capas: number;
  carpetas: number;
  sinCarpeta: number;
  atencion: number;
  conOriginal: number;
  fragmentos: number;
  caracteres: number;
  sinVector: number;
  porEstado: Record<Exclude<Estado, 'ok'>, number>;
  cubo: boolean;
  nivel: Nivel;
};
type Carpeta = { carpeta: string | null; documentos: number; capas: number; atencion: number };
type Importacion = {
  id: number;
  prefijo: string;
  carpeta: string | null;
  estado: string;
  total: number;
  hechos: number;
  nuevos: number;
  repetidos: number;
  fallos: number;
  omitidos: number;
  por: string | null;
  iniciada: string;
  actualizada: string;
  terminada: string | null;
  donde: string | null;
};

const ESTADO: Record<Estado, { txt: string; color: string; ayuda: string }> = {
  ok: { txt: 'bien', color: '#6C7F89', ayuda: 'Leído entero y citable.' },
  sin_texto: { txt: 'sin texto', color: ROJO, ayuda: 'No tiene ni un fragmento: Dr Electrum no sabe nada de él. Casi siempre es un escaneo que hay que pasar por OCR.' },
  cortado: { txt: 'cortado', color: AMBAR, ayuda: 'Quedó con ~8 000 caracteres por el tope viejo. Releerlo desde el original lo completa.' },
  poco_texto: { txt: 'poco texto', color: '#D7B06A', ayuda: 'Menos de 400 caracteres por página: formulario con mucha imagen o escaneo a medias.' },
  repetido: { txt: 'repetido', color: AZUL, ayuda: 'Hay otro documento con el mismo nombre: otra versión, o el mismo dos veces.' },
  vacia: { txt: 'vacía', color: ROJO, ayuda: 'Capa sin ninguna geometría.' },
};

const nf = (n: number) => new Intl.NumberFormat('es-HN').format(n || 0);
const fecha = (iso?: string | null) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
};
const hora = (iso?: string | null) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-HN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};
const clave = (i: { clase: string; id: number }) => `${i.clase}:${i.id}`;

async function pedir<T = any>(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; j: T & { error?: string } }> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...headersElectrum(), ...(init.headers || {}) },
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  } catch {
    return { ok: false, status: 0, j: { error: 'No alcancé el servidor.' } as any };
  }
}

/* ============================================================================== el panel */

export function Biblioteca() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [fallo, setFallo] = useState('');
  /** '' = todo, '~' = sin carpeta, '!' = necesitan atención, o una ruta. */
  const [lugar, setLugar] = useState('');
  const [escrito, setEscrito] = useState('');
  const [busca, setBusca] = useState('');
  const [estado, setEstado] = useState('');
  const [clase, setClase] = useState('');
  const [orden, setOrden] = useState('subido');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [trayendo, setTrayendo] = useState(false);
  const [elegidos, setElegidos] = useState<Map<string, Item>>(new Map());
  const [abierto, setAbierto] = useState<Item | null>(null);
  const [modal, setModal] = useState<'' | 'mover' | 'borrar' | 'importar' | 'bitacora' | 'carpeta'>('');
  const [aviso, setAviso] = useState<{ txt: string; malo?: boolean } | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const [releyendo, setReleyendo] = useState<{ hechos: number; total: number } | null>(null);
  const [verArbol, setVerArbol] = useState(false);

  const nivel = resumen?.nivel ?? null;
  const puedeOrdenar = nivel === 'escribe' || nivel === 'mando';
  const esMando = nivel === 'mando';

  const recargar = useCallback(() => setVuelta((v) => v + 1), []);
  const avisar = useCallback((txt: string, malo = false) => {
    setAviso({ txt, malo });
    window.setTimeout(() => setAviso((a) => (a?.txt === txt ? null : a)), 7000);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setBusca(escrito.trim()), 300);
    return () => clearTimeout(t);
  }, [escrito]);

  // Resumen y carpetas.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [a, b] = await Promise.all([pedir<Resumen>(`${R}/resumen`), pedir<{ carpetas: Carpeta[] }>(`${R}/arbol`)]);
      if (!vivo) return;
      if (a.status === 401) return setFallo(SIN_PUERTA);
      if (!a.ok) return setFallo(a.j.error || `El servidor contestó ${a.status}.`);
      setFallo('');
      setResumen(a.j);
      if (b.ok) setCarpetas(b.j.carpetas || []);
    })();
    return () => {
      vivo = false;
    };
  }, [vuelta]);

  const consultaItems = useCallback(
    (desde: number) => {
      const p = new URLSearchParams({ orden, limite: '100', desde: String(desde) });
      if (lugar === '~') p.set('carpeta', '~');
      else if (lugar === '!') p.set('estado', 'atencion');
      else if (lugar) {
        p.set('carpeta', lugar);
        p.set('subcarpetas', '1');
      }
      if (estado) p.set('estado', estado);
      if (clase) p.set('clase', clase);
      if (busca) p.set('q', busca);
      return `${R}/items?${p}`;
    },
    [lugar, estado, clase, busca, orden]
  );

  useEffect(() => {
    let vivo = true;
    setTrayendo(true);
    void pedir<{ items: Item[]; total: number }>(consultaItems(0)).then((r) => {
      if (!vivo) return;
      setTrayendo(false);
      if (!r.ok) return;
      setItems(r.j.items || []);
      setTotal(r.j.total || 0);
    });
    return () => {
      vivo = false;
    };
  }, [consultaItems, vuelta]);

  // Al cambiar de lugar o de filtro, la selección vieja ya no se ve: se suelta.
  useEffect(() => setElegidos(new Map()), [lugar, estado, clase, busca]);

  const traerMas = useCallback(async () => {
    setTrayendo(true);
    const r = await pedir<{ items: Item[]; total: number }>(consultaItems(items.length));
    setTrayendo(false);
    if (r.ok) setItems((v) => [...v, ...(r.j.items || [])]);
  }, [consultaItems, items.length]);

  const alternar = (i: Item) =>
    setElegidos((m) => {
      const n = new Map(m);
      if (n.has(clave(i))) n.delete(clave(i));
      else n.set(clave(i), i);
      return n;
    });
  const todosElegidos = items.length > 0 && items.every((i) => elegidos.has(clave(i)));
  const elegirTodos = () =>
    setElegidos((m) => {
      if (todosElegidos) return new Map();
      const n = new Map(m);
      for (const i of items) n.set(clave(i), i);
      return n;
    });

  const seleccion = [...elegidos.values()];
  const releibles = seleccion.filter((i) => i.clase === 'documento' && i.original);

  const releerElegidos = async (lista: Item[]) => {
    if (!lista.length) return;
    setReleyendo({ hechos: 0, total: lista.length });
    let bien = 0;
    let ultimoMal = '';
    for (let k = 0; k < lista.length; k++) {
      const r = await pedir<{ ok: boolean; dicho: string }>(`${R}/releer/${lista[k].id}`, { method: 'POST', body: '{}' });
      if (r.ok && r.j.ok) bien++;
      else ultimoMal = `«${lista[k].nombre}»: ${r.j.dicho || r.j.error || 'no se pudo'}`;
      setReleyendo({ hechos: k + 1, total: lista.length });
    }
    setReleyendo(null);
    avisar(bien === lista.length ? `Releídos ${bien} de ${lista.length}.` : `Releídos ${bien} de ${lista.length}. ${ultimoMal}`, bien < lista.length);
    recargar();
  };

  const arbolArmado = useMemo(() => armarArbol(carpetas), [carpetas]);
  const rutas = useMemo(() => arbolArmado.rutas, [arbolArmado]);

  if (fallo) {
    return (
      <div className="p-4 text-sm text-[#8FA3B0] leading-relaxed space-y-3" role="alert">
        <p>{fallo}</p>
        <Boton onClick={recargar}>Reintentar</Boton>
      </div>
    );
  }
  if (!resumen) return <div className="p-4 font-mono text-[11px] text-[#6C7F89]" role="status">cargando la infraestructura…</div>;

  const titulo = lugar === '' ? 'Todo' : lugar === '~' ? 'Sin carpeta' : lugar === '!' ? 'Necesitan atención' : lugar;

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full max-w-[1400px] mx-auto">
      {/* ------------------------------------------------ cifras */}
      <div className="shrink-0 px-4 pt-3 pb-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Cifra titulo="Documentos" valor={nf(resumen.documentos)} nota={`${nf(resumen.fragmentos)} fragmentos`} />
        <Cifra titulo="Capas del mapa" valor={nf(resumen.capas)} />
        <Cifra titulo="Texto indexado" valor={`${(resumen.caracteres / 1e6).toLocaleString('es-HN', { maximumFractionDigits: 1 })} M`} nota="caracteres" />
        <Cifra titulo="Carpetas" valor={nf(Math.max(0, resumen.carpetas))} nota={resumen.sinCarpeta ? `${nf(resumen.sinCarpeta)} sueltos` : 'todo ordenado'} onClick={() => setLugar('~')} />
        <Cifra
          titulo="Necesitan atención"
          valor={nf(resumen.atencion)}
          nota={resumen.atencion ? 'ver cuáles' : 'nada pendiente'}
          color={resumen.atencion ? AMBAR : undefined}
          onClick={() => setLugar('!')}
        />
        <Cifra titulo="Con original" valor={nf(resumen.conOriginal)} nota="se pueden releer" />
      </div>

      {/* ------------------------------------------------ acciones generales */}
      <div className="shrink-0 px-4 pb-2 flex flex-wrap items-center gap-1.5">
        {puedeOrdenar && <Subir carpeta={lugar && lugar !== '~' && lugar !== '!' ? lugar : null} alTerminar={recargar} avisar={avisar} />}
        {esMando && resumen.cubo && <Boton onClick={() => setModal('importar')}>Importar del cubo</Boton>}
        <Boton onClick={() => setModal('bitacora')}>Bitácora</Boton>
        <Boton className="md:hidden" onClick={() => setVerArbol((v) => !v)}>
          {verArbol ? 'Ocultar carpetas' : 'Carpetas'}
        </Boton>
        {aviso && (
          <span role="status" className="ml-1 text-[12px]" style={{ color: aviso.malo ? ROJO : '#9BE8B9' }}>
            {aviso.txt}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex border-t border-white/[0.07]">
        {/* ------------------------------------------------ carpetas */}
        <nav
          aria-label="Carpetas"
          className={`${verArbol ? 'block absolute inset-x-0 top-[170px] bottom-0 z-10 bg-[#0A0C0E]' : 'hidden'} md:static md:block w-full md:w-72 shrink-0 overflow-y-auto border-r border-white/[0.07] py-2`}
        >
          <Lugar activo={lugar === ''} onClick={() => (setLugar(''), setVerArbol(false))} texto="Todo" n={resumen.documentos + resumen.capas} />
          <Lugar activo={lugar === '!'} onClick={() => (setLugar('!'), setVerArbol(false))} texto="Necesitan atención" n={resumen.atencion} color={resumen.atencion ? AMBAR : undefined} />
          <Lugar activo={lugar === '~'} onClick={() => (setLugar('~'), setVerArbol(false))} texto="Sin carpeta" n={resumen.sinCarpeta} />
          <div className="mt-2 mb-1 px-4 font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: AMBAR }}>
            Carpetas
          </div>
          {arbolArmado.raiz.length === 0 && <p className="px-4 text-[12px] text-[#6C7F89]">Todavía no hay carpetas.</p>}
          <Ramas nodos={arbolArmado.raiz} lugar={lugar} onLugar={(c) => (setLugar(c), setVerArbol(false))} />
        </nav>

        {/* ------------------------------------------------ lista */}
        <section className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 px-4 py-2 flex flex-wrap items-center gap-2 border-b border-white/[0.05]">
            <h2 className="text-[14px] font-semibold text-[#F3F6F8] truncate max-w-full" title={titulo}>
              {titulo}
            </h2>
            <span className="font-mono text-[11px] text-[#6C7F89]">{nf(total)}</span>
            {puedeOrdenar && lugar && lugar !== '~' && lugar !== '!' && (
              <button type="button" onClick={() => setModal('carpeta')} className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8FA3B0] hover:text-white cursor-pointer">
                renombrar carpeta
              </button>
            )}
            <div className="basis-full h-0 lg:hidden" />
            <input
              value={escrito}
              onChange={(e) => setEscrito(e.target.value)}
              placeholder="Buscar por nombre…"
              aria-label="Buscar por nombre"
              className="flex-1 min-w-[160px] lg:ml-auto lg:max-w-[260px] rounded-lg bg-white/[0.06] border border-white/12 px-3 py-1.5 text-[13px] text-[#E7EEF2] placeholder:text-[#7D909A] focus:outline-none focus:border-[#FFAE3B]/60"
            />
            <Selector etiqueta="Estado" valor={estado} onCambio={setEstado} opciones={[['', 'Todos los estados'], ['atencion', 'Necesitan atención'], ...(Object.keys(ESTADO) as Estado[]).map((e) => [e, ESTADO[e].txt] as [string, string])]} />
            <Selector etiqueta="Tipo" valor={clase} onCambio={setClase} opciones={[['', 'Documentos y capas'], ['documento', 'Solo documentos'], ['capa', 'Solo capas']]} />
            <Selector
              etiqueta="Orden"
              valor={orden}
              onCambio={setOrden}
              opciones={[
                ['subido', 'Más recientes'],
                ['nombre', 'Nombre'],
                ['estado', 'Estado'],
                ['cantidad', 'Páginas / geometrías'],
                ['caracteres', 'Texto'],
                ['carpeta', 'Carpeta'],
              ]}
            />
          </div>

          {/* barra de selección */}
          {seleccion.length > 0 && (
            <div className="shrink-0 px-4 py-2 flex flex-wrap items-center gap-1.5 border-b border-white/[0.05]" style={{ background: 'rgba(255,174,59,0.06)' }}>
              <span className="text-[12px] text-[#E7EEF2] mr-1">{nf(seleccion.length)} elegidos</span>
              {puedeOrdenar && <Boton onClick={() => setModal('mover')}>Mover a…</Boton>}
              {puedeOrdenar && releibles.length > 0 && (
                <Boton onClick={() => void releerElegidos(releibles)} disabled={!!releyendo}>
                  {releyendo ? `Releyendo ${releyendo.hechos}/${releyendo.total}…` : `Releer (${nf(releibles.length)})`}
                </Boton>
              )}
              {esMando && (
                <Boton peligro onClick={() => setModal('borrar')}>
                  Eliminar
                </Boton>
              )}
              <Boton onClick={() => setElegidos(new Map())}>Soltar</Boton>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            {items.length === 0 && !trayendo && (
              <p className="p-4 text-sm text-[#8FA3B0]">
                {busca || estado || clase ? 'Nada con esos filtros aquí.' : lugar === '!' ? 'Nada necesita atención. Todo lo cargado está leído entero.' : 'Esta carpeta está vacía.'}
              </p>
            )}
            {items.length > 0 && (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-[1] bg-[#0B0E11]">
                  <tr className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6C7F89]">
                    <th className="w-8 pl-4 py-2">
                      <input type="checkbox" aria-label="Elegir todos los de la lista" checked={todosElegidos} onChange={elegirTodos} className="accent-[#FFAE3B] cursor-pointer" />
                    </th>
                    <th className="py-2 pr-2 font-normal">Nombre</th>
                    <th className="py-2 pr-2 font-normal hidden sm:table-cell">Estado</th>
                    <th className="py-2 pr-2 font-normal text-right hidden md:table-cell">Contenido</th>
                    <th className="py-2 pr-4 font-normal text-right hidden lg:table-cell">Subido</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <Fila key={clave(i)} i={i} elegido={elegidos.has(clave(i))} onElegir={() => alternar(i)} onAbrir={() => setAbierto(i)} mostrarCarpeta={lugar === '' || lugar === '!' || !!busca} />
                  ))}
                </tbody>
              </table>
            )}
            {items.length < total && (
              <div className="p-3">
                <Boton className="w-full" onClick={() => void traerMas()} disabled={trayendo}>
                  {trayendo ? 'trayendo…' : `Ver más (${nf(total - items.length)} quedan)`}
                </Boton>
              </div>
            )}
          </div>
        </section>
      </div>

      {abierto && (
        <Detalle
          ref_={abierto}
          nivel={nivel}
          onCerrar={() => setAbierto(null)}
          onCambio={(txt) => {
            avisar(txt);
            recargar();
          }}
          onReleer={(i) => void releerElegidos([i])}
          onBorrar={(i) => {
            setElegidos(new Map([[clave(i), i]]));
            setModal('borrar');
          }}
          onMover={(i) => {
            setElegidos(new Map([[clave(i), i]]));
            setModal('mover');
          }}
        />
      )}
      {modal === 'mover' && (
        <Mover
          cuantos={seleccion.length}
          rutas={rutas}
          sugerida={lugar && lugar !== '~' && lugar !== '!' ? lugar : ''}
          onCerrar={() => setModal('')}
          onMover={async (carpeta) => {
            const r = await pedir<{ movidos: number; carpeta: string | null }>(`${R}/mover`, {
              method: 'POST',
              body: JSON.stringify({ items: seleccion.map(({ clase, id }) => ({ clase, id })), carpeta }),
            });
            if (!r.ok) return r.j.error || 'No pude mover.';
            setModal('');
            setElegidos(new Map());
            setAbierto(null);
            avisar(`Movidos ${nf(r.j.movidos)} a «${r.j.carpeta || 'sin carpeta'}».`);
            recargar();
            return '';
          }}
        />
      )}
      {modal === 'borrar' && (
        <Borrar
          items={seleccion}
          onCerrar={() => setModal('')}
          onBorrar={async () => {
            const r = await pedir<{ eliminados: number }>(`${R}/eliminar`, {
              method: 'POST',
              body: JSON.stringify({ items: seleccion.map(({ clase, id }) => ({ clase, id })), confirmo: true }),
            });
            if (!r.ok) return r.j.error || 'No pude borrar.';
            setModal('');
            setElegidos(new Map());
            setAbierto(null);
            avisar(`Borrados ${nf(r.j.eliminados)}. Quedó anotado en la bitácora; los originales del cubo siguen ahí.`);
            recargar();
            return '';
          }}
        />
      )}
      {modal === 'carpeta' && lugar && (
        <RenombrarCarpeta
          de={lugar}
          rutas={rutas}
          onCerrar={() => setModal('')}
          onHecho={(a, n) => {
            setModal('');
            setLugar(a || '~');
            avisar(`Carpeta cambiada: ${nf(n)} piezas.`);
            recargar();
          }}
        />
      )}
      {modal === 'importar' && <Importar onCerrar={() => setModal('')} alCambio={recargar} />}
      {modal === 'bitacora' && <Bitacora onCerrar={() => setModal('')} />}
    </div>
  );
}

/* ============================================================================== piezas */

function Cifra({ titulo, valor, nota, color, onClick }: { titulo: string; valor: string; nota?: string; color?: string; onClick?: () => void }) {
  const cuerpo = (
    <>
      <div className="font-mono text-[9.5px] tracking-[0.16em] uppercase text-[#6C7F89]">{titulo}</div>
      <div className="text-[20px] font-semibold leading-tight" style={{ color: color || '#F3F6F8' }}>
        {valor}
      </div>
      {nota && <div className="text-[11px] text-[#8FA3B0] truncate">{nota}</div>}
    </>
  );
  const cls = 'rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} hover:border-white/25 cursor-pointer`}>
      {cuerpo}
    </button>
  ) : (
    <div className={cls}>{cuerpo}</div>
  );
}

function Boton({ children, onClick, disabled, peligro, className = '' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; peligro?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-2.5 py-1.5 font-mono text-[10.5px] tracking-[0.12em] uppercase transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        peligro ? 'border-[rgba(224,118,95,0.45)] text-[#F2A493] hover:bg-[rgba(224,118,95,0.12)]' : 'border-white/15 text-[#B9C7CE] hover:border-white/30 hover:text-white'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function Selector({ etiqueta, valor, onCambio, opciones }: { etiqueta: string; valor: string; onCambio: (v: string) => void; opciones: Array<[string, string]> }) {
  return (
    <select
      aria-label={etiqueta}
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      className="rounded-lg bg-[#12161A] border border-white/12 px-2 py-1.5 text-[12px] text-[#DDE7EC] focus:outline-none focus:border-[#FFAE3B]/60 cursor-pointer"
    >
      {opciones.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  );
}

function Etiqueta({ estado }: { estado: Estado }) {
  const e = ESTADO[estado] || ESTADO.ok;
  return (
    <span title={e.ayuda} className="inline-flex items-center gap-1 font-mono text-[10.5px] whitespace-nowrap" style={{ color: e.color }}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: e.color }} />
      {e.txt}
    </span>
  );
}

function Fila({ i, elegido, onElegir, onAbrir, mostrarCarpeta }: { i: Item; elegido: boolean; onElegir: () => void; onAbrir: () => void; mostrarCarpeta: boolean }) {
  const contenido =
    i.clase === 'documento'
      ? `${nf(i.cantidad)} pág · ${i.caracteres >= 1000 ? `${nf(Math.round(i.caracteres / 1000))} k` : nf(i.caracteres)} car`
      : `${nf(i.cantidad)} geometrías`;
  return (
    <tr className={`border-b border-white/[0.04] text-[13px] ${elegido ? 'bg-[rgba(255,174,59,0.07)]' : 'hover:bg-white/[0.03]'}`}>
      <td className="pl-4 py-1.5 align-top">
        <input type="checkbox" aria-label={`Elegir ${i.nombre}`} checked={elegido} onChange={onElegir} className="accent-[#FFAE3B] cursor-pointer mt-1" />
      </td>
      <td className="py-1.5 pr-2 min-w-0">
        <button type="button" onClick={onAbrir} className="block w-full text-left cursor-pointer group">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] shrink-0" style={{ color: i.clase === 'capa' ? AZUL : '#8FA3B0' }}>
              {i.clase === 'capa' ? 'capa' : i.detalle}
            </span>
            <span className="text-[#E7EEF2] group-hover:text-white break-words [overflow-wrap:anywhere]">{i.nombre}</span>
          </span>
          {mostrarCarpeta && i.carpeta && <span className="block font-mono text-[10.5px] text-[#6C7F89] truncate">{i.carpeta}</span>}
          <span className="sm:hidden">
            <Etiqueta estado={i.estado} />
          </span>
        </button>
      </td>
      <td className="py-1.5 pr-2 align-top hidden sm:table-cell">
        <Etiqueta estado={i.estado} />
      </td>
      <td className="py-1.5 pr-2 align-top text-right font-mono text-[11px] text-[#8FA3B0] whitespace-nowrap hidden md:table-cell">{contenido}</td>
      <td className="py-1.5 pr-4 align-top text-right font-mono text-[11px] text-[#6C7F89] whitespace-nowrap hidden lg:table-cell">{fecha(i.subido)}</td>
    </tr>
  );
}

function Lugar({ activo, onClick, texto, n, color }: { activo: boolean; onClick: () => void; texto: string; n: number; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activo ? 'true' : undefined}
      className={`w-full flex items-center gap-2 px-4 py-1.5 text-left text-[13px] cursor-pointer ${activo ? 'bg-[rgba(255,174,59,0.12)] text-white' : 'text-[#B9C7CE] hover:bg-white/[0.04]'}`}
    >
      <span className="truncate">{texto}</span>
      <span className="ml-auto font-mono text-[11px]" style={{ color: color || '#6C7F89' }}>
        {nf(n)}
      </span>
    </button>
  );
}

/* --------------------------------------------------------------------------- el árbol */

type Nodo = { nombre: string; ruta: string; propios: number; total: number; atencion: number; hijos: Nodo[] };

/** De la lista plana «A/B/C» al árbol, sumando hacia arriba lo que hay dentro. */
function armarArbol(carpetas: Carpeta[]): { raiz: Nodo[]; rutas: string[] } {
  const raiz: Nodo[] = [];
  const porRuta = new Map<string, Nodo>();
  const rutas = new Set<string>();
  for (const c of carpetas) {
    if (!c.carpeta) continue;
    const tramos = c.carpeta.split('/');
    let hermanos = raiz;
    let ruta = '';
    tramos.forEach((t, k) => {
      ruta = ruta ? `${ruta}/${t}` : t;
      rutas.add(ruta);
      let n = porRuta.get(ruta);
      if (!n) {
        n = { nombre: t, ruta, propios: 0, total: 0, atencion: 0, hijos: [] };
        porRuta.set(ruta, n);
        hermanos.push(n);
      }
      n.total += c.documentos + c.capas;
      n.atencion += c.atencion;
      if (k === tramos.length - 1) n.propios += c.documentos + c.capas;
      hermanos = n.hijos;
    });
  }
  const ordenar = (ns: Nodo[]) => {
    ns.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    ns.forEach((n) => ordenar(n.hijos));
  };
  ordenar(raiz);
  return { raiz, rutas: [...rutas].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })) };
}

function Ramas({ nodos, lugar, onLugar, nivel = 0 }: { nodos: Nodo[]; lugar: string; onLugar: (c: string) => void; nivel?: number }) {
  return (
    <ul>
      {nodos.map((n) => (
        <Rama key={n.ruta} n={n} lugar={lugar} onLugar={onLugar} nivel={nivel} />
      ))}
    </ul>
  );
}

function Rama({ n, lugar, onLugar, nivel }: { n: Nodo; lugar: string; onLugar: (c: string) => void; nivel: number }) {
  const dentro = lugar === n.ruta || lugar.startsWith(n.ruta + '/');
  const [abierta, setAbierta] = useState(dentro || nivel === 0);
  useEffect(() => {
    if (dentro) setAbierta(true);
  }, [dentro]);
  const activo = lugar === n.ruta;
  return (
    <li>
      <div className={`flex items-center text-[13px] ${activo ? 'bg-[rgba(255,174,59,0.12)] text-white' : 'text-[#B9C7CE] hover:bg-white/[0.04]'}`} style={{ paddingLeft: 8 + nivel * 12 }}>
        <button
          type="button"
          onClick={() => setAbierta((v) => !v)}
          aria-label={abierta ? `Cerrar ${n.nombre}` : `Abrir ${n.nombre}`}
          aria-expanded={n.hijos.length ? abierta : undefined}
          className={`w-5 h-6 shrink-0 text-[10px] text-[#6C7F89] cursor-pointer ${n.hijos.length ? '' : 'invisible'}`}
        >
          {abierta ? '▾' : '▸'}
        </button>
        <button type="button" onClick={() => onLugar(n.ruta)} className="flex-1 min-w-0 flex items-center gap-2 py-1 pr-4 text-left cursor-pointer" title={n.ruta}>
          <span className="truncate">{n.nombre}</span>
          {n.atencion > 0 && (
            <span className="font-mono text-[10px]" style={{ color: AMBAR }} title={`${n.atencion} necesitan atención`}>
              !{nf(n.atencion)}
            </span>
          )}
          <span className="ml-auto font-mono text-[11px] text-[#6C7F89]">{nf(n.total)}</span>
        </button>
      </div>
      {abierta && n.hijos.length > 0 && <Ramas nodos={n.hijos} lugar={lugar} onLugar={onLugar} nivel={nivel + 1} />}
    </li>
  );
}

/* --------------------------------------------------------------------------- subir */

/**
 * Subir archivos o una carpeta entera DENTRO de la carpeta que se está mirando. Con una carpeta, las
 * subcarpetas se conservan: «Estudios/Minas de Oro/informe.pdf» cae en «<aquí>/Estudios/Minas de Oro».
 */
function Subir({ carpeta, alTerminar, avisar }: { carpeta: string | null; alTerminar: () => void; avisar: (t: string, malo?: boolean) => void }) {
  const archivos = useRef<HTMLInputElement>(null);
  const directorio = useRef<HTMLInputElement>(null);
  const [cola, setCola] = useState<{ hechos: number; total: number; mal: number } | null>(null);

  const subir = async (lista: File[]) => {
    if (!lista.length) return;
    setCola({ hechos: 0, total: lista.length, mal: 0 });
    let mal = 0;
    let ultimo = '';
    for (let k = 0; k < lista.length; k++) {
      const f = lista[k];
      const rel = ((f as any).webkitRelativePath as string) || '';
      const dirs = rel.split('/').slice(0, -1).join('/');
      const destino = [carpeta || '', dirs].filter(Boolean).join('/');
      const q = new URLSearchParams({ nombre: f.name });
      if (destino) q.set('carpeta', destino);
      try {
        const r = await fetch(`/api/electrum/subir?${q}`, {
          method: 'POST',
          headers: { 'Content-Type': f.type || 'application/octet-stream', ...headersElectrum() },
          body: f,
        });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok || j.clase === 'nada') {
          mal++;
          ultimo = `«${f.name}»: ${j.error || j.dicho || r.status}`;
        }
      } catch {
        mal++;
        ultimo = `«${f.name}»: no alcancé el servidor`;
      }
      setCola({ hechos: k + 1, total: lista.length, mal });
    }
    setCola(null);
    avisar(mal ? `Subidos ${lista.length - mal} de ${lista.length}. ${ultimo}` : `Subidos ${lista.length}${carpeta ? ` a «${carpeta}»` : ''}.`, mal > 0);
    alTerminar();
  };

  return (
    <>
      <Boton onClick={() => archivos.current?.click()} disabled={!!cola}>
        {cola ? `Subiendo ${cola.hechos}/${cola.total}…` : carpeta ? 'Subir aquí' : 'Subir archivos'}
      </Boton>
      <Boton onClick={() => directorio.current?.click()} disabled={!!cola}>
        Subir carpeta
      </Boton>
      <input
        ref={archivos}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void subir([...(e.target.files || [])]);
          e.target.value = '';
        }}
      />
      <input
        ref={directorio}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={(e) => {
          void subir([...(e.target.files || [])]);
          e.target.value = '';
        }}
      />
    </>
  );
}

/* --------------------------------------------------------------------------- modales */

function Modal({ titulo, children, onCerrar, ancho = 520 }: { titulo: string; children: ReactNode; onCerrar: () => void; ancho?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm px-4 py-12" role="dialog" aria-label={titulo} onClick={onCerrar}>
      <div className="relative w-full rounded-2xl border border-white/10 bg-[#0b0e11] p-5 shadow-2xl" style={{ maxWidth: ancho }} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="absolute right-3 top-3 h-8 w-8 rounded-full text-[18px] text-[#8FA3B0] hover:bg-white/10 hover:text-white cursor-pointer">
          ×
        </button>
        <h3 className="pr-8 text-[16px] font-semibold text-[#F3F6F8] mb-3">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

function ElegirCarpeta({ rutas, valor, onValor }: { rutas: string[]; valor: string; onValor: (v: string) => void }) {
  return (
    <>
      <input
        list="biblioteca-rutas"
        value={valor}
        onChange={(e) => onValor(e.target.value)}
        placeholder="Carpeta/Subcarpeta (vacío = sin carpeta)"
        aria-label="Carpeta de destino"
        className="w-full rounded-lg bg-white/[0.06] border border-white/12 px-3 py-2 text-[14px] text-[#E7EEF2] placeholder:text-[#7D909A] focus:outline-none focus:border-[#FFAE3B]/60"
      />
      <datalist id="biblioteca-rutas">
        {rutas.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <p className="mt-1.5 text-[11.5px] text-[#8FA3B0]">Elegí una existente o escribí una nueva; las subcarpetas van separadas con «/».</p>
    </>
  );
}

function Mover({ cuantos, rutas, sugerida, onCerrar, onMover }: { cuantos: number; rutas: string[]; sugerida: string; onCerrar: () => void; onMover: (c: string) => Promise<string> }) {
  const [valor, setValor] = useState(sugerida);
  const [error, setError] = useState('');
  const [yendo, setYendo] = useState(false);
  return (
    <Modal titulo={`Mover ${nf(cuantos)} a una carpeta`} onCerrar={onCerrar}>
      <ElegirCarpeta rutas={rutas} valor={valor} onValor={setValor} />
      {error && <p className="mt-2 text-[12px]" style={{ color: ROJO }}>{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton
          disabled={yendo}
          onClick={async () => {
            setYendo(true);
            setError(await onMover(valor));
            setYendo(false);
          }}
        >
          {yendo ? 'moviendo…' : 'Mover'}
        </Boton>
      </div>
    </Modal>
  );
}

function RenombrarCarpeta({ de, rutas, onCerrar, onHecho }: { de: string; rutas: string[]; onCerrar: () => void; onHecho: (a: string | null, n: number) => void }) {
  const [valor, setValor] = useState(de);
  const [error, setError] = useState('');
  const [yendo, setYendo] = useState(false);
  return (
    <Modal titulo="Renombrar o mover la carpeta" onCerrar={onCerrar}>
      <p className="mb-2 text-[12.5px] text-[#9FB0B8]">
        «{de}» y todo lo que tiene dentro, subcarpetas incluidas, pasa a la ruta nueva.
      </p>
      <ElegirCarpeta rutas={rutas} valor={valor} onValor={setValor} />
      {error && <p className="mt-2 text-[12px]" style={{ color: ROJO }}>{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton
          disabled={yendo || valor.trim() === de}
          onClick={async () => {
            setYendo(true);
            const r = await pedir<{ piezas: number; carpeta: string | null }>(`${R}/carpeta`, { method: 'POST', body: JSON.stringify({ de, a: valor }) });
            setYendo(false);
            if (!r.ok) return setError(r.j.error || 'No pude.');
            onHecho(r.j.carpeta, r.j.piezas);
          }}
        >
          {yendo ? 'cambiando…' : 'Cambiar'}
        </Boton>
      </div>
    </Modal>
  );
}

function Borrar({ items, onCerrar, onBorrar }: { items: Item[]; onCerrar: () => void; onBorrar: () => Promise<string> }) {
  const capas = items.filter((i) => i.clase === 'capa');
  const exigeFrase = capas.length > 0 || items.length > 10;
  const [frase, setFrase] = useState('');
  const [error, setError] = useState('');
  const [yendo, setYendo] = useState(false);
  return (
    <Modal titulo={`Eliminar ${nf(items.length)} de Dr Electrum`} onCerrar={onCerrar}>
      <div className="space-y-2 text-[13px] text-[#C9D5DB] leading-relaxed">
        <p>Dr Electrum deja de saberlo: no aparece en respuestas, búsquedas ni informes. El original en el cubo no se toca, así que se puede volver a importar.</p>
        {capas.length > 0 && (
          <p className="rounded-lg border px-3 py-2" style={{ borderColor: 'rgba(224,118,95,0.4)', color: '#F2A493', background: 'rgba(224,118,95,0.07)' }}>
            Hay {nf(capas.length)} {capas.length === 1 ? 'capa' : 'capas'}: se borran con sus concesiones, geometrías y traslapes. Si es parte del catastro, el mapa y el tablero cambian.
          </p>
        )}
        <ul className="max-h-40 overflow-y-auto rounded-lg border border-white/10 px-3 py-2 text-[12px] text-[#9FB0B8]">
          {items.slice(0, 50).map((i) => (
            <li key={clave(i)} className="truncate">
              {i.clase === 'capa' ? '▣ ' : '▤ '}
              {i.nombre}
            </li>
          ))}
          {items.length > 50 && <li>… y {nf(items.length - 50)} más</li>}
        </ul>
        {exigeFrase && (
          <label className="block">
            <span className="text-[12px] text-[#9FB0B8]">Escribí BORRAR para confirmar</span>
            <input value={frase} onChange={(e) => setFrase(e.target.value)} className="mt-1 w-full rounded-lg bg-white/[0.06] border border-white/12 px-3 py-2 text-[14px] text-[#E7EEF2] focus:outline-none focus:border-[#E0765F]/70" />
          </label>
        )}
        {error && <p style={{ color: ROJO }}>{error}</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton
          peligro
          disabled={yendo || (exigeFrase && frase.trim().toUpperCase() !== 'BORRAR')}
          onClick={async () => {
            setYendo(true);
            setError(await onBorrar());
            setYendo(false);
          }}
        >
          {yendo ? 'borrando…' : 'Eliminar'}
        </Boton>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------------------- detalle */

function Detalle({
  ref_,
  nivel,
  onCerrar,
  onCambio,
  onReleer,
  onBorrar,
  onMover,
}: {
  ref_: Item;
  nivel: Nivel;
  onCerrar: () => void;
  onCambio: (txt: string) => void;
  onReleer: (i: Item) => void;
  onBorrar: (i: Item) => void;
  onMover: (i: Item) => void;
}) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [nombre, setNombre] = useState(ref_.nombre);
  const [editando, setEditando] = useState(false);
  const puede = nivel === 'escribe' || nivel === 'mando';

  useEffect(() => {
    let vivo = true;
    setD(null);
    setError('');
    setNombre(ref_.nombre);
    void pedir<{ item: any }>(`${R}/item/${ref_.clase}/${ref_.id}`).then((r) => {
      if (!vivo) return;
      if (!r.ok) setError(r.j.error || 'No pude traerlo.');
      else setD(r.j.item);
    });
    return () => {
      vivo = false;
    };
  }, [ref_]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);

  const guardarNombre = async () => {
    const r = await pedir(`${R}/renombrar`, { method: 'POST', body: JSON.stringify({ clase: ref_.clase, id: ref_.id, nombre }) });
    if (!r.ok) return setError(r.j.error || 'No pude renombrar.');
    setEditando(false);
    onCambio('Nombre cambiado.');
  };

  const i = d || ref_;
  const e = ESTADO[i.estado as Estado] || ESTADO.ok;
  return (
    <div className="fixed inset-0 z-[65] flex justify-end bg-black/50" onClick={onCerrar} role="dialog" aria-label={`Detalle de ${ref_.nombre}`}>
      <aside className="h-full w-full max-w-[480px] overflow-y-auto border-l border-white/10 bg-[#0b0e11] p-5 shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] mt-1" style={{ color: ref_.clase === 'capa' ? AZUL : AMBAR }}>
            {ref_.clase === 'capa' ? 'Capa del mapa' : `Documento · ${i.detalle}`}
          </span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="ml-auto h-8 w-8 rounded-full text-[18px] text-[#8FA3B0] hover:bg-white/10 hover:text-white cursor-pointer">
            ×
          </button>
        </div>
        {editando ? (
          <div className="mt-1 flex gap-2">
            <input value={nombre} onChange={(ev) => setNombre(ev.target.value)} aria-label="Nombre" className="flex-1 rounded-lg bg-white/[0.06] border border-white/12 px-3 py-2 text-[14px] text-[#E7EEF2] focus:outline-none focus:border-[#FFAE3B]/60" />
            <Boton onClick={() => void guardarNombre()}>Guardar</Boton>
          </div>
        ) : (
          <h3 className="mt-1 text-[17px] font-semibold text-[#F3F6F8] [overflow-wrap:anywhere]">{i.nombre}</h3>
        )}
        <div className="mt-1 text-[12px] text-[#8FA3B0]">{i.carpeta ? `en ${i.carpeta}` : 'sin carpeta'}</div>

        <div className="mt-3 rounded-xl border px-3 py-2" style={{ borderColor: `${e.color}55`, background: `${e.color}10` }}>
          <Etiqueta estado={i.estado} />
          <p className="mt-1 text-[12.5px] text-[#C9D5DB] leading-relaxed">{e.ayuda}</p>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
          {ref_.clase === 'documento' ? (
            <>
              <Dato t="Páginas" v={nf(i.cantidad)} />
              <Dato t="Con texto" v={d ? `${nf(d.paginasConTexto)} de ${nf(i.cantidad)}` : '…'} />
              <Dato t="Fragmentos" v={nf(i.fragmentos)} />
              <Dato t="Caracteres" v={nf(i.caracteres)} />
              <Dato t="Búsqueda por significado" v={i.sin_vector ? `${nf(i.fragmentos - i.sin_vector)} de ${nf(i.fragmentos)}` : 'completa'} />
              <Dato t="Tipo (Laya)" v={d?.laya ? `${d.laya.tipo} · ${Math.round((d.laya.certeza || 0) * 100)} %` : '—'} />
              {d?.concesion && <Dato t="Concesión" v={d.concesion} />}
            </>
          ) : (
            <>
              <Dato t="Geometrías" v={nf(i.cantidad)} />
              <Dato t="Concesiones" v={d ? nf(d.concesiones) : '…'} />
              <Dato t="Formato" v={i.detalle} />
              <Dato t="Rol" v={d?.rol || '—'} />
              <Dato t="Proyección de origen" v={d?.origenCrs || '—'} />
            </>
          )}
          <Dato t="Subido" v={`${fecha(i.subido)}${i.subido_por ? ` · ${i.subido_por}` : ''}`} />
          {i.releido && <Dato t="Releído" v={hora(i.releido)} />}
          <Dato t="Original" v={d?.archivo ? d.archivo : i.original ? 'guardado' : 'no guardado'} ancho />
        </dl>

        {d?.vistazo?.length > 0 && (
          <div className="mt-4">
            <div className="font-mono text-[10px] tracking-[0.16em] uppercase mb-1" style={{ color: AMBAR }}>
              Cómo lo leyó
            </div>
            {d.vistazo.map((f: any, k: number) => (
              <p key={k} className="mb-2 rounded-lg bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-[#B9C7CE] whitespace-pre-wrap">
                <span className="font-mono text-[10px] text-[#6C7F89]">p. {f.pagina} · </span>
                {f.texto}
              </p>
            ))}
          </div>
        )}
        {d?.avisos?.length > 0 && (
          <ul className="mt-3 space-y-1 text-[12px] text-[#D7B06A]">
            {d.avisos.map((a: any, k: number) => (
              <li key={k}>· {a?.texto || String(a)}</li>
            ))}
          </ul>
        )}
        {error && <p className="mt-3 text-[12px]" style={{ color: ROJO }}>{error}</p>}

        {puede && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {!editando && <Boton onClick={() => setEditando(true)}>Renombrar</Boton>}
            <Boton onClick={() => onMover(ref_)}>Mover</Boton>
            {ref_.clase === 'documento' && (
              <Boton onClick={() => onReleer(ref_)} disabled={!i.original}>
                {i.original ? 'Releer del original' : 'Sin original para releer'}
              </Boton>
            )}
            {nivel === 'mando' && (
              <Boton peligro onClick={() => onBorrar(ref_)}>
                Eliminar
              </Boton>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Dato({ t, v, ancho }: { t: string; v: ReactNode; ancho?: boolean }) {
  return (
    <div className={ancho ? 'col-span-2' : ''}>
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#6C7F89]">{t}</dt>
      <dd className="text-[#DDE7EC] [overflow-wrap:anywhere]">{v}</dd>
    </div>
  );
}

/* --------------------------------------------------------------------------- importar */

function Importar({ onCerrar, alCambio }: { onCerrar: () => void; alCambio: () => void }) {
  const [cubo, setCubo] = useState<Array<{ prefijo: string; nombre: string; ultima: any }> | null>(null);
  const [lista, setLista] = useState<Importacion[]>([]);
  const [error, setError] = useState('');
  const [elegida, setElegida] = useState('');
  const [destino, setDestino] = useState('');
  const [imagenes, setImagenes] = useState(false);
  const [yendo, setYendo] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const hechosAntes = useRef<Record<number, number>>({});

  const traer = useCallback(async () => {
    const r = await pedir<{ importaciones: Importacion[] }>(`${R}/importaciones`);
    if (r.ok) {
      setLista(r.j.importaciones || []);
      // Si alguna avanzó, lo de fuera (cifras, carpetas, lista) se pone al día.
      let cambio = false;
      for (const x of r.j.importaciones || []) {
        if (hechosAntes.current[x.id] !== undefined && hechosAntes.current[x.id] !== x.hechos) cambio = true;
        hechosAntes.current[x.id] = x.hechos;
      }
      if (cambio) alCambio();
    }
  }, [alCambio]);

  useEffect(() => {
    void pedir<{ carpetas: any[] }>(`${R}/cubo`).then((r) => {
      if (!r.ok) setError(r.j.error || 'No alcancé el cubo.');
      else setCubo(r.j.carpetas || []);
    });
    void traer();
  }, [traer]);

  const hayViva = lista.some((x) => x.estado === 'en_curso' || x.estado === 'parando');
  useEffect(() => {
    if (!hayViva) return;
    const t = window.setInterval(() => void traer(), 4000);
    return () => window.clearInterval(t);
  }, [hayViva, traer]);

  const empezar = async () => {
    setYendo(true);
    setError('');
    const r = await pedir(`${R}/importar`, { method: 'POST', body: JSON.stringify({ prefijo: elegida, carpeta: destino || undefined, imagenes }) });
    setYendo(false);
    if (!r.ok) return setError(r.j.error || 'No pude empezar.');
    setElegida('');
    await traer();
  };

  return (
    <Modal titulo="Importar una carpeta del cubo" onCerrar={onCerrar} ancho={760}>
      <p className="text-[12.5px] text-[#9FB0B8] leading-relaxed">
        Subí la carpeta al cubo con la página de carga y elegila aquí. Dr Electrum la lee en una máquina aparte —la conversación no se frena— y deja cada archivo en la carpeta que le corresponde. Lo que ya estaba no se duplica, y si se corta se retoma donde quedó.
      </p>
      {error && <p className="mt-2 text-[12.5px]" style={{ color: ROJO }}>{error}</p>}
      {!cubo && !error && <p className="mt-3 font-mono text-[11px] text-[#6C7F89]">mirando el cubo…</p>}
      {cubo && (
        <div className="mt-3 space-y-1.5">
          {cubo.map((c) => (
            <label key={c.prefijo} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${elegida === c.prefijo ? 'border-[#FFAE3B]/60 bg-[rgba(255,174,59,0.07)]' : 'border-white/10 hover:border-white/20'}`}>
              <input
                type="radio"
                name="cubo"
                checked={elegida === c.prefijo}
                onChange={() => {
                  setElegida(c.prefijo);
                  setDestino(c.nombre);
                }}
                className="accent-[#FFAE3B]"
              />
              <span className="text-[13.5px] text-[#E7EEF2] truncate">{c.nombre}</span>
              <span className="ml-auto font-mono text-[10.5px] text-[#6C7F89] whitespace-nowrap">
                {c.ultima ? `última: ${c.ultima.estado} · ${nf(c.ultima.nuevos)} nuevos` : 'nunca importada'}
              </span>
            </label>
          ))}
          {cubo.length === 0 && <p className="text-[12.5px] text-[#8FA3B0]">El cubo no tiene carpetas en «entrada/».</p>}
        </div>
      )}
      {elegida && (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[12px] text-[#9FB0B8]">Carpeta del panel donde queda</span>
            <input value={destino} onChange={(e) => setDestino(e.target.value)} className="mt-1 w-full rounded-lg bg-white/[0.06] border border-white/12 px-3 py-2 text-[14px] text-[#E7EEF2] focus:outline-none focus:border-[#FFAE3B]/60" />
          </label>
          <label className="flex items-start gap-2 text-[12.5px] text-[#C9D5DB]">
            <input type="checkbox" checked={imagenes} onChange={(e) => setImagenes(e.target.checked)} className="accent-[#FFAE3B] mt-0.5" />
            <span>
              Leer también las imágenes (JPG, PNG) con el ojo. Es lento y casi siempre son páginas escaneadas que ya vienen en un PDF: dejalo apagado salvo que sean fotos de papeles sueltos.
            </span>
          </label>
          <div className="flex justify-end">
            <Boton onClick={() => void empezar()} disabled={yendo || hayViva}>
              {yendo ? 'preparando…' : hayViva ? 'Hay una en marcha' : 'Importar'}
            </Boton>
          </div>
        </div>
      )}

      {lista.length > 0 && (
        <div className="mt-5">
          <div className="font-mono text-[10px] tracking-[0.16em] uppercase mb-1.5" style={{ color: AMBAR }}>
            Importaciones
          </div>
          <ul className="space-y-1.5">
            {lista.map((x) => (
              <li key={x.id} className="rounded-lg border border-white/10 px-3 py-2">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-[#E7EEF2] truncate">{x.carpeta || x.prefijo}</span>
                  <span className="font-mono text-[10.5px]" style={{ color: x.estado === 'terminada' ? '#9BE8B9' : x.estado === 'en_curso' ? AMBAR : x.estado === 'fallida' || x.estado === 'interrumpida' ? ROJO : '#8FA3B0' }}>
                    {x.estado.replace('_', ' ')}
                  </span>
                  <span className="ml-auto font-mono text-[10.5px] text-[#6C7F89]">{hora(x.iniciada)}</span>
                </div>
                <Barra hechos={x.hechos} total={x.total} />
                <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-[#8FA3B0]">
                  <span>
                    {nf(x.hechos)}/{nf(x.total)}
                  </span>
                  <span style={{ color: '#9BE8B9' }}>{nf(x.nuevos)} nuevos</span>
                  <span>{nf(x.repetidos)} ya estaban</span>
                  <span style={{ color: x.fallos ? ROJO : undefined }}>{nf(x.fallos)} no se pudieron leer</span>
                  <span>{nf(x.omitidos)} omitidos</span>
                  <button type="button" onClick={() => setAbierta((v) => (v === x.id ? null : x.id))} className="ml-auto text-[#B9C7CE] hover:text-white cursor-pointer">
                    {abierta === x.id ? 'ocultar' : 'ver detalle'}
                  </button>
                  {(x.estado === 'en_curso' || x.estado === 'interrumpida') && (
                    <button
                      type="button"
                      className="text-[#F2A493] hover:text-white cursor-pointer"
                      onClick={async () => {
                        if (x.estado === 'en_curso') await pedir(`${R}/importaciones/${x.id}/parar`, { method: 'POST', body: '{}' });
                        else {
                          const r = await pedir(`${R}/importar`, { method: 'POST', body: JSON.stringify({ prefijo: x.prefijo, carpeta: x.carpeta }) });
                          if (!r.ok) setError(r.j.error || 'No pude retomarla.');
                        }
                        await traer();
                      }}
                    >
                      {x.estado === 'en_curso' ? 'parar' : 'retomar'}
                    </button>
                  )}
                </div>
                {abierta === x.id && <DetalleImportacion id={x.id} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function Barra({ hechos, total }: { hechos: number; total: number }) {
  const p = total ? Math.min(100, (hechos / total) * 100) : 100;
  return (
    <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${p}%`, background: AMBAR }} />
    </div>
  );
}

function DetalleImportacion({ id }: { id: number }) {
  const [filtro, setFiltro] = useState('fallo');
  const [filas, setFilas] = useState<Array<{ key: string; r: string; d: string }> | null>(null);
  useEffect(() => {
    let vivo = true;
    setFilas(null);
    void pedir<{ importacion: any }>(`${R}/importaciones/${id}?resultado=${filtro}`).then((r) => vivo && setFilas(r.ok ? r.j.importacion.detalle || [] : []));
    return () => {
      vivo = false;
    };
  }, [id, filtro]);
  const porMotivo = useMemo(() => {
    if (filtro !== 'omitido' || !filas) return null;
    const m = new Map<string, number>();
    for (const f of filas) m.set(f.d, (m.get(f.d) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filas, filtro]);
  return (
    <div className="mt-2 border-t border-white/[0.06] pt-2">
      <div className="flex gap-1.5">
        {[
          ['fallo', 'No se pudieron leer'],
          ['nuevo', 'Nuevos'],
          ['repetido', 'Ya estaban'],
          ['omitido', 'Omitidos'],
        ].map(([v, t]) => (
          <button
            key={v}
            type="button"
            onClick={() => setFiltro(v)}
            className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] cursor-pointer ${filtro === v ? 'text-black' : 'text-[#9FB0B8] border border-white/10'}`}
            style={filtro === v ? { background: AMBAR } : undefined}
          >
            {t}
          </button>
        ))}
      </div>
      {!filas && <p className="mt-2 font-mono text-[11px] text-[#6C7F89]">cargando…</p>}
      {porMotivo && (
        <ul className="mt-2 text-[12px] text-[#B9C7CE]">
          {porMotivo.map(([m, n]) => (
            <li key={m}>
              <span className="font-mono text-[#8FA3B0]">{nf(n)}</span> · {m}
            </li>
          ))}
        </ul>
      )}
      {filas && !porMotivo && (
        <ul className="mt-2 max-h-64 overflow-y-auto space-y-1 text-[12px]">
          {filas.length === 0 && <li className="text-[#6C7F89]">Ninguno.</li>}
          {filas.slice(0, 400).map((f, k) => (
            <li key={k}>
              <div className="text-[#DDE7EC] [overflow-wrap:anywhere]">{f.key}</div>
              {f.d && <div className="text-[11px] text-[#8FA3B0]">{f.d}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------- bitácora */

const ACCION: Record<string, string> = {
  mover: 'movió',
  renombrar: 'renombró',
  carpeta: 'cambió la carpeta',
  eliminar: 'eliminó',
  releer: 'releyó',
  importar: 'importación',
};

function Bitacora({ onCerrar }: { onCerrar: () => void }) {
  const [filas, setFilas] = useState<any[] | null>(null);
  useEffect(() => {
    void pedir<{ entradas: any[] }>(`${R}/bitacora?limite=200`).then((r) => setFilas(r.ok ? r.j.entradas || [] : []));
  }, []);
  return (
    <Modal titulo="Bitácora de cambios" onCerrar={onCerrar} ancho={680}>
      {!filas && <p className="font-mono text-[11px] text-[#6C7F89]">cargando…</p>}
      {filas && filas.length === 0 && <p className="text-[13px] text-[#8FA3B0]">Todavía no hay cambios anotados.</p>}
      {filas && filas.length > 0 && (
        <ul className="space-y-1.5 text-[12.5px]">
          {filas.map((f) => (
            <li key={f.id} className="border-b border-white/[0.05] pb-1.5">
              <div className="flex gap-2">
                <span className="font-mono text-[10.5px] text-[#6C7F89] whitespace-nowrap">{hora(f.cuando)}</span>
                <span className="text-[#DDE7EC]">
                  <b className="font-semibold">{f.quien || 'alguien'}</b> {ACCION[f.accion] || f.accion} <span className="text-[#B9C7CE]">{f.detalle?.nombre ? `«${f.detalle.nombre}»` : f.objeto}</span>
                </span>
              </div>
              <div className="pl-[84px] font-mono text-[10.5px] text-[#8FA3B0] [overflow-wrap:anywhere]">{resumenDetalle(f)}</div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function resumenDetalle(f: any): string {
  const d = f.detalle || {};
  switch (f.accion) {
    case 'mover':
      return `${nf(d.movidos || 0)} piezas → ${f.objeto.replace(/^carpeta /, '')}`;
    case 'renombrar':
      return `«${d.de}» → «${d.a}»`;
    case 'carpeta':
      return `→ ${d.a || 'sin carpeta'} · ${nf(d.piezas || 0)} piezas`;
    case 'eliminar':
      return d.concesiones ? `con ${nf(d.concesiones)} concesiones` : '';
    case 'releer':
      return d.ok ? `${nf(d.antes || 0)} → ${nf(d.ahora || 0)} caracteres` : 'no cambió';
    case 'importar':
      return d.estado ? `${d.estado}${d.capasNuevas ? ` · ${nf(d.capasNuevas)} capas nuevas` : ''}` : `${d.prefijo || ''} · ${nf(d.total || 0)} archivos, ${nf(d.omitidos || 0)} omitidos`;
    default:
      return '';
  }
}
