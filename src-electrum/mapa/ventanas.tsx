/**
 * LAS VENTANAS SOBRE EL MAPA, ORDENADAS.
 *
 * Lo que flota encima del mapa —la leyenda, la ficha de una concesión, la herramienta de medir, el
 * cuadro del recorrido, el rótulo del mapa, el timelapse, el «¿alguna pregunta?»— se fue sumando
 * pieza por pieza, y en el teléfono terminaba tapándolo todo: con seis capas encendidas, la leyenda
 * sola llenaba la franja del mapa y no había forma de esconderla.
 *
 * Desde aquí cada ventana sigue las mismas tres reglas:
 *
 *  1. Se esconde y se vuelve a abrir. Su botón «esconder» está en la cabecera; escondida, queda
 *     como una pastilla en la bandeja de abajo a la izquierda, junto a «Índice de capas», y un toque
 *     la trae de vuelta igual que estaba. Lo que la persona escondió se recuerda en el navegador
 *     (aparte en el teléfono y en la computadora: son pantallas distintas).
 *  2. No se apilan. Si dos ocuparían el mismo sitio, abrir una aparta a la otra a su pastilla; y al
 *     cerrar o esconder la primera, la apartada vuelve sola.
 *  3. Siempre se ve el mapa. Cada ventana tiene un alto (o un ancho, en una franja baja) máximo y se
 *     desplaza por dentro.
 *
 * Cómo se reparten depende del tamaño del MAPA, no de la pantalla: el mismo monitor con «más chat»
 * deja una franja baja, y el teléfono acostado otra todavía más baja.
 *  · «franja»: mapa angosto (teléfono de pie). Una ventana a la vez, apoyada abajo.
 *  · «baja»: mapa ancho y bajo (teléfono acostado, «más chat»). Una ventana a la vez, de costado.
 *  · «amplia»: computadora. Cada una en su rincón; solo se apartan las del mismo rincón.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

const AMBAR = '#FFAE3B';
const CAJON = 'electrum:ventanas:v1';

export type ModoMapa = 'franja' | 'baja' | 'amplia';
export type Rincon = 'izq' | 'der' | 'centro';

type Registro = {
  clave: string;
  /** «la leyenda», «la ficha»…: para «Esconder …» y «Mostrar …». */
  nombre: string;
  /** El texto de su pastilla. */
  etiqueta: string;
  /** Más chico, más prioridad: al volver y al abrirse sola no aparta a una de más prioridad. */
  prioridad: number;
  rincon: Rincon | null;
  /** Sin pastilla propia (el índice de capas ya tiene su botón). */
  sinPastilla: boolean;
  activa: boolean;
  /** La escondió la persona (se recuerda). */
  escondida: boolean;
  /** La apartó otra ventana que se abrió en su sitio (no se recuerda: vuelve sola). */
  apartadaPor: string | null;
  /** Con qué clase de pantalla se leyó `escondida` («movil» o «compu»). */
  pantalla: string;
};

/* --------------------------------------------------------------- el almacén */

const registros = new Map<string, Registro>();
const oyentes = new Set<() => void>();
let version = 0;
let medida = { ancho: 0, alto: 0 };

function avisar() {
  version++;
  oyentes.forEach((f) => f());
}
function suscribir(f: () => void) {
  oyentes.add(f);
  return () => oyentes.delete(f);
}
const leerVersion = () => version;

function leerCajon(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(CAJON) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function guardarEscondida(clave: string, pantalla: string, escondida: boolean) {
  try {
    const c = leerCajon();
    c[`${clave}:${pantalla}`] = escondida;
    localStorage.setItem(CAJON, JSON.stringify(c));
  } catch {
    /* sin almacenamiento: no se recuerda, y ya */
  }
}
function leerEscondida(clave: string, pantalla: string, porDefecto: boolean): boolean {
  const v = leerCajon()[`${clave}:${pantalla}`];
  return typeof v === 'boolean' ? v : porDefecto;
}

/** Teléfono o computadora, para recordar por separado (y para el arranque en el teléfono). */
function pantallaActual(): 'movil' | 'compu' {
  try {
    return window.matchMedia('(max-width: 767px), (max-height: 500px)').matches ? 'movil' : 'compu';
  } catch {
    return 'compu';
  }
}

export function modoDe(m: { ancho: number; alto: number }): ModoMapa {
  // Sin medir todavía: por el tamaño de la ventana del navegador.
  const ancho = m.ancho || (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const alto = m.alto || (typeof window !== 'undefined' ? window.innerHeight * 0.5 : 400);
  if (ancho < 640) return 'franja';
  if (alto < 330) return 'baja';
  return 'amplia';
}

const visible = (r: Registro) => r.activa && !r.escondida && !r.apartadaPor;

/** ¿Ocuparían el mismo sitio? En franja y baja, siempre: cabe una sola. */
function chocan(a: Registro, b: Registro): boolean {
  if (a.clave === b.clave || !a.rincon || !b.rincon) return false;
  if (modoDe(medida) !== 'amplia') return true;
  return a.rincon === b.rincon;
}

/** La que se abrió aparta a las visibles que chocan con ella. */
function apartarPor(r: Registro, respetarPrioridad: boolean) {
  for (const o of registros.values()) {
    if (!visible(o) || !chocan(r, o)) continue;
    if (respetarPrioridad && o.prioridad < r.prioridad) {
      // Se abrió sola (no la pidió la persona) y la otra manda: la que espera es esta.
      r.apartadaPor = o.clave;
      return;
    }
    o.apartadaPor = r.clave;
  }
}

/** Las que había apartado `clave` vuelven, de la más importante a la menos, si caben. */
function devolverDe(clave: string) {
  const esperan = [...registros.values()].filter((r) => r.apartadaPor === clave).sort((a, b) => a.prioridad - b.prioridad);
  for (const r of esperan) {
    r.apartadaPor = null;
    const otra = [...registros.values()].find((o) => visible(o) && chocan(r, o));
    if (otra) r.apartadaPor = otra.clave;
  }
}

/** Mostrar una ventana (la pastilla, o algo que la necesita a la vista: el recorrido, una orden). */
export function mostrarVentana(clave: string) {
  const r = registros.get(clave);
  if (!r) return;
  if (r.escondida) {
    r.escondida = false;
    guardarEscondida(clave, r.pantalla, false);
  }
  r.apartadaPor = null;
  if (r.activa) apartarPor(r, false);
  avisar();
}

export function esconderVentana(clave: string) {
  const r = registros.get(clave);
  if (!r) return;
  r.escondida = true;
  guardarEscondida(clave, r.pantalla, true);
  devolverDe(clave);
  avisar();
}

/**
 * Si el control está dentro de una ventana escondida o apartada, la abre. Lo usa el recorrido
 * antes de señalar un botón (la ficha escondida no puede enseñar «Ficha PDF») y las órdenes de voz.
 */
export function asegurarVisible(el: Element | null) {
  const v = el?.closest('[data-ventana-clave]')?.getAttribute('data-ventana-clave');
  const r = v ? registros.get(v) : null;
  if (r && r.activa && !visible(r)) mostrarVentana(r.clave);
}

/* --------------------------------------------------------------- medir el mapa */

/** Va dentro de la caja del mapa: mide su tamaño para que las ventanas sepan cómo repartirse. */
export function MedidorMapa() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const antes = modoDe(medida);
      medida = { ancho: r.width, alto: r.height };
      // Cambió el reparto (de pie a acostado, más chat): lo que ahora choca, se aparta.
      if (modoDe(medida) !== antes) {
        const vis = [...registros.values()].filter(visible).sort((a, b) => a.prioridad - b.prioridad);
        for (const r2 of vis) if (visible(r2)) apartarPor(r2, false);
      }
      avisar();
    };
    medir();
    const o = new ResizeObserver(medir);
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 -z-10" />;
}

export function useModoMapa(): ModoMapa {
  useSyncExternalStore(suscribir, leerVersion, leerVersion);
  return modoDe(medida);
}

/* --------------------------------------------------------------- el gancho de cada ventana */

type Opciones = {
  nombre: string;
  etiqueta: string;
  /** ¿Existe ahora? (la ficha, solo con algo tocado; la leyenda, con capas encendidas). */
  activa: boolean;
  prioridad: number;
  /** Su rincón en la computadora; en franja y baja cabe una sola. `null`: no aparta a nadie (un modal). */
  rincon: Rincon | null;
  /** Cómo arranca la primera vez en el teléfono y en la computadora (después, como la dejaron). */
  escondidaAlEmpezar?: { movil: boolean; compu: boolean };
  sinPastilla?: boolean;
};

export function useVentana(clave: string, o: Opciones) {
  useSyncExternalStore(suscribir, leerVersion, leerVersion);
  const pantalla = pantallaActual();
  const escondidaAlEmpezar = o.escondidaAlEmpezar?.[pantalla] ?? false;

  // El registro se arma al primer render, para que la ventana nazca ya escondida si toca (sin un
  // cuadro abierto que se vea un instante).
  let r = registros.get(clave);
  if (!r) {
    r = {
      clave,
      nombre: o.nombre,
      etiqueta: o.etiqueta,
      prioridad: o.prioridad,
      rincon: o.rincon,
      sinPastilla: !!o.sinPastilla,
      activa: false,
      escondida: leerEscondida(clave, pantalla, escondidaAlEmpezar),
      apartadaPor: null,
      pantalla,
    };
    registros.set(clave, r);
  }

  useEffect(() => {
    const x = registros.get(clave)!;
    let cambio = false;
    if (x.pantalla !== pantalla) {
      x.pantalla = pantalla;
      x.escondida = leerEscondida(clave, pantalla, escondidaAlEmpezar);
      cambio = true;
    }
    if (x.etiqueta !== o.etiqueta || x.nombre !== o.nombre || x.rincon !== o.rincon) {
      Object.assign(x, { etiqueta: o.etiqueta, nombre: o.nombre, rincon: o.rincon });
      cambio = true;
    }
    if (o.activa && !x.activa) {
      x.activa = true;
      x.apartadaPor = null;
      if (!x.escondida) apartarPor(x, true);
      cambio = true;
    } else if (!o.activa && x.activa) {
      x.activa = false;
      x.apartadaPor = null;
      devolverDe(clave);
      cambio = true;
    }
    if (cambio) avisar();
  });

  // Al desmontar, deja de existir (y devuelve lo que había apartado).
  useEffect(
    () => () => {
      const x = registros.get(clave);
      if (x?.activa) {
        x.activa = false;
        x.apartadaPor = null;
        devolverDe(clave);
        avisar();
      }
    },
    [clave]
  );

  const plegada = !!(r.escondida || r.apartadaPor);
  const esconder = useCallback(() => esconderVentana(clave), [clave]);
  const mostrar = useCallback(() => mostrarVentana(clave), [clave]);
  return { plegada, esconder, mostrar, modo: modoDe(medida) };
}

/* --------------------------------------------------------------- piezas comunes */

/**
 * El botón «esconder» de la cabecera de cada ventana. En pantalla táctil, 40 px de lado: es lo
 * mínimo que se acierta con el dedo sin tocar el mapa de al lado.
 */
export function BotonEsconder({ nombre, onClick, className = '' }: { nombre: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Esconder ${nombre}`}
      title={`Esconder ${nombre}`}
      className={`pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#9FB0B8] hover:bg-white/10 hover:text-white pointer-coarse:h-10 pointer-coarse:w-10 cursor-pointer ${className}`}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 6.5 8 10.5 12 6.5" />
      </svg>
    </button>
  );
}

/** Las pastillas de las ventanas escondidas o apartadas. Va en la fila de «Índice de capas». */
export function BandejaVentanas() {
  useSyncExternalStore(suscribir, leerVersion, leerVersion);
  const plegadas = [...registros.values()].filter((r) => r.activa && !r.sinPastilla && (r.escondida || r.apartadaPor)).sort((a, b) => b.prioridad - a.prioridad);
  if (!plegadas.length) return null;
  return (
    <>
      {plegadas.map((r) => (
        <button
          key={r.clave}
          type="button"
          onClick={() => mostrarVentana(r.clave)}
          aria-label={`Mostrar ${r.nombre}`}
          title={`Mostrar ${r.nombre}`}
          data-pastilla={r.clave}
          className="flex h-8 max-w-[170px] shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-black/80 px-2.5 font-mono text-[10.5px] tracking-[0.06em] uppercase sm:tracking-[0.1em] text-[#DCE5EA] shadow-lg backdrop-blur-md hover:border-white/30 pointer-coarse:h-10 cursor-pointer"
          style={r.clave === 'recorrido' ? { borderColor: `${AMBAR}66`, color: AMBAR } : undefined}
        >
          <span className="truncate">{r.etiqueta}</span>
          <span aria-hidden className="shrink-0 text-[9px]" style={{ color: AMBAR }}>
            ▴
          </span>
        </button>
      ))}
    </>
  );
}
