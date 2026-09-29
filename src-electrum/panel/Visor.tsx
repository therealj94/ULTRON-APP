/**
 * EL VISOR: un mapa o un PDF a pantalla completa, con zoom de verdad.
 *
 * Antes un mapa geológico quedaba del ancho del chat y no había forma de mirarle una falla de
 * cerca; el PDF solo se podía bajar. Acá se abre encima de todo: rueda o pellizco para acercar
 * (hacia donde apunta el dedo o el ratón), arrastrar para moverse, doble toque para acercar o
 * volver, y botones + / − / ajustar para quien no quiere gestos.
 *
 * El PDF se dibuja página por página con pdf.js (se carga solo cuando alguien abre uno, no pesa en
 * la entrada). En el PDF la rueda recorre las páginas y Ctrl+rueda —o el pellizco del trackpad—
 * acerca; en una imagen la rueda acerca directo.
 *
 * «Bajar» solo aparece para quien tiene usuario. Un invitado (código temporal) mira todo y no se
 * lleva el archivo; el servidor tampoco le manda la orden de guardarlo.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { headersElectrum } from '../acceso';

export type Fuente = { tipo: 'imagen' | 'pdf'; nombre: string; url: string; titulo?: string };

const AMBAR = '#FFAE3B';
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const HUECO = 16; // entre páginas del PDF y contra los bordes

type Vista = { z: number; x: number; y: number };
/** Lo que se usa de un evento de puntero (sin depender de los tipos de React, que el CI no instala). */
type Puntero = { pointerId: number; clientX: number; clientY: number; target: EventTarget | null };
type Pagina = { ancho: number; alto: number; lienzo: HTMLCanvasElement; pag: PDFPageProxy };

/** Lo que mide el contenido a zoom 1: la imagen ajustada a la pantalla, o la columna de páginas. */
function tamanoBase(caja: { w: number; h: number }, fuente: 'imagen' | 'pdf', natural: { w: number; h: number } | null, paginas: Pagina[]) {
  if (fuente === 'imagen') {
    if (!natural) return { w: 0, h: 0 };
    const f = Math.min((caja.w - HUECO * 2) / natural.w, (caja.h - HUECO * 2) / natural.h, 4);
    return { w: natural.w * f, h: natural.h * f };
  }
  const w = Math.min(caja.w - HUECO * 2, 980);
  const h = paginas.reduce((s, p) => s + (w * p.alto) / p.ancho, 0) + HUECO * Math.max(0, paginas.length - 1);
  return { w, h };
}

/** Que no se pierda: si cabe se centra en ese eje, si no, no se despega de los bordes. */
function encajar(v: Vista, caja: { w: number; h: number }, base: { w: number; h: number }, pdf: boolean): Vista {
  const w = base.w * v.z;
  const h = base.h * v.z;
  const x = w + HUECO * 2 <= caja.w ? (caja.w - w) / 2 : Math.min(HUECO, Math.max(caja.w - w - HUECO, v.x));
  // Un PDF corto arranca arriba, como una hoja; una imagen se centra.
  const y = h + HUECO * 2 <= caja.h ? (pdf ? HUECO : (caja.h - h) / 2) : Math.min(HUECO, Math.max(caja.h - h - HUECO, v.y));
  return { z: v.z, x, y };
}

export async function pedirArchivo(url: string): Promise<Blob> {
  const r = await fetch(url, { headers: headersElectrum() });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}) as any);
    throw new Error(j?.error || (r.status === 404 ? 'Ya caducó (se guardan media hora); pedímelo otra vez.' : `El servidor contestó ${r.status}.`));
  }
  return r.blob();
}

/**
 * Las páginas del PDF, dibujadas una vez a buena resolución para verlas enteras. Al acercarse, lo
 * que queda a la vista se vuelve a dibujar nítido encima (ver `Nitido`).
 */
async function dibujarPdf(datos: ArrayBuffer, anchoPantalla: number, vivo: () => boolean): Promise<{ doc: PDFDocumentProxy; paginas: Pagina[] }> {
  // La versión «legacy» trae los rellenos que piden los navegadores de hace un par de años: la
  // moderna usa funciones de JavaScript tan nuevas que en muchos teléfonos el PDF no abría.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const trabajador = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = trabajador;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(datos) }).promise;
  const paginas: Pagina[] = [];
  // ~1,5× el ancho en pantalla, con tope: se ve bien entero sin comerse la memoria del teléfono.
  const objetivo = Math.min(1800, Math.max(900, anchoPantalla * (window.devicePixelRatio || 1) * 1.5));
  const n = Math.min(doc.numPages, 60);
  for (let i = 1; i <= n && vivo(); i++) {
    const pag = await doc.getPage(i);
    const v1 = pag.getViewport({ scale: 1 });
    const vp = pag.getViewport({ scale: objetivo / v1.width });
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.floor(vp.width);
    lienzo.height = Math.floor(vp.height);
    await pag.render({ canvas: lienzo, viewport: vp }).promise;
    paginas.push({ ancho: v1.width, alto: v1.height, lienzo, pag });
  }
  return { doc, paginas };
}

/**
 * Nitidez al acercarse. Las páginas enteras están dibujadas a un tamaño fijo, y a 400 % las letras
 * se ven de a cuadritos. Cuando el zoom se queda quieto un momento, se dibuja de nuevo SOLO el
 * pedazo de cada página que está a la vista, a la resolución exacta de la pantalla, y se pone
 * encima. Al mover o acercar otra vez se esconde hasta que vuelve a quedarse quieto.
 */
function Nitido({ paginas, base, vista, caja }: { paginas: Pagina[]; base: { w: number; h: number }; vista: Vista; caja: { w: number; h: number } }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [listo, setListo] = useState<string | null>(null);
  const clave = `${vista.z.toFixed(4)}|${vista.x.toFixed(1)}|${vista.y.toFixed(1)}|${caja.w}x${caja.h}`;
  useEffect(() => {
    setListo(null);
    if (vista.z < 1.3 || !paginas.length || !caja.w) return;
    let vivo = true;
    const tareas: RenderTask[] = [];
    const t = setTimeout(async () => {
      const c = lienzo.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(caja.w * dpr);
      c.height = Math.round(caja.h * dpr);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      let arriba = 0;
      for (const p of paginas) {
        const altoBase = (base.w * p.alto) / p.ancho;
        const r = { x: vista.x, y: vista.y + arriba * vista.z, w: base.w * vista.z, h: altoBase * vista.z };
        arriba += altoBase + HUECO;
        const ix = Math.max(0, r.x);
        const iy = Math.max(0, r.y);
        const fx = Math.min(caja.w, r.x + r.w);
        const fy = Math.min(caja.h, r.y + r.h);
        if (fx <= ix || fy <= iy) continue;
        const trozo = document.createElement('canvas');
        trozo.width = Math.ceil((fx - ix) * dpr);
        trozo.height = Math.ceil((fy - iy) * dpr);
        const vp = p.pag.getViewport({ scale: (r.w * dpr) / p.ancho });
        const tarea = p.pag.render({ canvas: trozo, viewport: vp, transform: [1, 0, 0, 1, -(ix - r.x) * dpr, -(iy - r.y) * dpr] });
        tareas.push(tarea);
        try {
          await tarea.promise;
        } catch {
          return; // cancelada: ya se movió
        }
        if (!vivo) return;
        ctx.drawImage(trozo, Math.round(ix * dpr), Math.round(iy * dpr));
      }
      if (vivo) setListo(clave);
    }, 220);
    return () => {
      vivo = false;
      clearTimeout(t);
      for (const x of tareas) x.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, paginas, base.w]);
  return <canvas ref={lienzo} className="pointer-events-none absolute inset-0 h-full w-full" style={{ opacity: listo === clave ? 1 : 0 }} aria-hidden="true" />;
}

export function Visor({ fuente, puedeBajar, onCerrar, onBajar }: { fuente: Fuente; puedeBajar: boolean; onCerrar: () => void; onBajar: () => void }) {
  const marco = useRef<HTMLDivElement>(null);
  const caja = useRef({ w: 0, h: 0 });
  const [, setMedida] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [paginas, setPaginas] = useState<Pagina[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState<Vista>({ z: 1, x: 0, y: 0 });
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const pdf = fuente.tipo === 'pdf';
  // La ayuda de gestos dice lo que sirve en ESTE aparato, y se va sola a los pocos segundos.
  const tactil = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  const [ayuda, setAyuda] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setAyuda(false), 6000);
    return () => clearTimeout(t);
  }, []);

  const base = tamanoBase(caja.current, fuente.tipo, natural, paginas);
  const baseRef = useRef(base);
  baseRef.current = base;

  const poner = useCallback((v: Vista) => setVista(encajar({ ...v, z: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z)) }, caja.current, baseRef.current, pdf)), [pdf]);

  /** Acercar o alejar dejando quieto el punto (px, py) de la pantalla: donde está el dedo o el ratón. */
  const zoomEn = useCallback(
    (factor: number, px?: number, py?: number) => {
      const v = vistaRef.current;
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z * factor));
      const cx = px ?? caja.current.w / 2;
      const cy = py ?? caja.current.h / 2;
      poner({ z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z });
    },
    [poner]
  );
  const ajustar = useCallback(() => poner({ z: 1, x: 0, y: HUECO }), [poner]);

  // Medir el marco y volver a encajar si cambia (girar el teléfono, salir de pantalla completa).
  useLayoutEffect(() => {
    const el = marco.current;
    if (!el) return;
    const medir = () => {
      caja.current = { w: el.clientWidth, h: el.clientHeight };
      setMedida((n) => n + 1);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setVista((v) => encajar(v, caja.current, base, pdf));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.w, base.h, pdf]);

  // Traer el archivo (la ruta exige credencial: fetch con cabecera, no un src directo).
  useEffect(() => {
    let vivo = true;
    let url: string | null = null;
    let doc: PDFDocumentProxy | null = null;
    setCargando(true);
    setError(null);
    pedirArchivo(fuente.url)
      .then(async (b) => {
        if (!pdf) {
          url = URL.createObjectURL(b);
          if (vivo) setSrc(url);
          return;
        }
        const { doc: d, paginas: pags } = await dibujarPdf(await b.arrayBuffer(), marco.current?.clientWidth || 800, () => vivo);
        doc = d;
        if (vivo) {
          setPaginas(pags);
          setCargando(false);
        } else void d.destroy();
      })
      .catch((e) => {
        if (!vivo) return;
        setError(String(e?.message || e));
        setCargando(false);
      });
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
      if (doc) void doc.destroy();
    };
  }, [fuente.url, pdf]);

  // Teclado: Esc cierra, + y − acercan, 0 ajusta.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
      else if (e.key === '+' || e.key === '=') zoomEn(1.4);
      else if (e.key === '-') zoomEn(1 / 1.4);
      else if (e.key === '0') ajustar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar, zoomEn, ajustar]);

  // Rueda: en la imagen acerca; en el PDF recorre, y con Ctrl (o el pellizco del trackpad) acerca.
  useEffect(() => {
    const el = marco.current;
    if (!el) return;
    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (!pdf || e.ctrlKey) {
        zoomEn(Math.exp(-e.deltaY * (e.ctrlKey ? 0.006 : 0.0012)), e.clientX - r.left, e.clientY - r.top);
      } else {
        const v = vistaRef.current;
        poner({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', rueda, { passive: false });
    return () => el.removeEventListener('wheel', rueda);
  }, [pdf, zoomEn, poner]);

  // Arrastrar con un dedo, pellizcar con dos, doble toque para acercar o volver.
  const dedos = useRef(new Map<number, { x: number; y: number }>());
  const pellizco = useRef<{ d: number; z: number } | null>(null);
  const ultimoToque = useRef(0);
  const local = (e: Puntero) => {
    const r = marco.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const bajo = (e: Puntero) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dedos.current.set(e.pointerId, local(e));
    if (dedos.current.size === 2) {
      const [a, b] = [...dedos.current.values()];
      pellizco.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: vistaRef.current.z };
    } else if (dedos.current.size === 1) {
      const ahora = Date.now();
      if (ahora - ultimoToque.current < 300) {
        const p = local(e);
        if (vistaRef.current.z > 1.05) ajustar();
        else zoomEn(2.5, p.x, p.y);
        ultimoToque.current = 0;
      } else ultimoToque.current = ahora;
    }
  };
  const mueve = (e: Puntero) => {
    const antes = dedos.current.get(e.pointerId);
    if (!antes) return;
    const p = local(e);
    dedos.current.set(e.pointerId, p);
    if (dedos.current.size >= 2 && pellizco.current) {
      const [a, b] = [...dedos.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const factor = (pellizco.current.z * (d / Math.max(1, pellizco.current.d))) / vistaRef.current.z;
      zoomEn(factor, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (dedos.current.size === 1) {
      const v = vistaRef.current;
      poner({ ...v, x: v.x + p.x - antes.x, y: v.y + p.y - antes.y });
    }
  };
  const sube = (e: Puntero) => {
    dedos.current.delete(e.pointerId);
    if (dedos.current.size < 2) pellizco.current = null;
  };

  // Pantalla completa de verdad (sin barras del navegador), donde el navegador lo permite.
  const raiz = useRef<HTMLDivElement>(null);
  const [completa, setCompleta] = useState(false);
  useEffect(() => {
    const cambio = () => setCompleta(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', cambio);
    return () => {
      document.removeEventListener('fullscreenchange', cambio);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const alternarCompleta = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void raiz.current?.requestFullscreen?.().catch(() => {});
  };
  const hayCompleta = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  const boton =
    'flex h-9 min-w-9 items-center justify-center rounded-lg border border-white/15 bg-black/60 px-2.5 font-mono text-[12px] text-[#DCE5EA] backdrop-blur transition-colors hover:border-white/35 hover:text-white cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]';

  return (
    <div ref={raiz} className="fixed inset-0 z-[90] flex flex-col" style={{ background: '#05080A' }} role="dialog" aria-modal="true" aria-label={`Visor: ${fuente.titulo || fuente.nombre}`}>
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: AMBAR }}>
          {pdf ? 'PDF' : 'Mapa'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-[#E7EEF2]">{fuente.titulo || fuente.nombre}</span>
        <span className="hidden font-mono text-[11px] text-[#7F939D] sm:inline">{Math.round(vista.z * 100)}%</span>
        <button type="button" className={boton} onClick={() => zoomEn(1 / 1.4)} aria-label="Alejar" title="Alejar (−)">
          −
        </button>
        <button type="button" className={boton} onClick={() => zoomEn(1.4)} aria-label="Acercar" title="Acercar (+)">
          +
        </button>
        <button type="button" className={boton} onClick={ajustar} aria-label="Ajustar a la pantalla" title="Ajustar (0)">
          Ajustar
        </button>
        {hayCompleta && (
          <button type="button" className={`${boton} hidden sm:flex`} onClick={alternarCompleta} aria-label={completa ? 'Salir de pantalla completa' : 'Pantalla completa'} title={completa ? 'Salir de pantalla completa' : 'Pantalla completa'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {completa ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" />}
            </svg>
          </button>
        )}
        {puedeBajar && (
          <button type="button" className={boton} onClick={onBajar} aria-label="Bajar el archivo" title="Bajar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
            <span className="ml-1.5 hidden sm:inline">Bajar</span>
          </button>
        )}
        <button type="button" className={boton} onClick={onCerrar} aria-label="Cerrar el visor" title="Cerrar (Esc)">
          ✕
        </button>
      </div>
      <div
        ref={marco}
        className="relative flex-1 touch-none select-none overflow-hidden"
        style={{ cursor: dedos.current.size ? 'grabbing' : 'grab' }}
        onPointerDown={bajo}
        onPointerMove={mueve}
        onPointerUp={sube}
        onPointerCancel={sube}
      >
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[14px] text-[#C9D6DC]">{error}</div>
        ) : (
          <div
            className="absolute left-0 top-0 origin-top-left will-change-transform"
            style={{ width: base.w, height: base.h, transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.z})` }}
          >
            {!pdf && src && (
              <img
                src={src}
                alt={fuente.titulo || fuente.nombre}
                draggable={false}
                onLoad={(e) => {
                  setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
                  setCargando(false);
                }}
                className="block h-full w-full bg-white shadow-[0_10px_40px_rgba(0,0,0,.6)]"
              />
            )}
            {pdf &&
              paginas.map((p, i) => (
                <div key={i}>
                  <LienzoPagina pagina={p} ancho={base.w} />
                </div>
              ))}
          </div>
        )}
        {pdf && !error && <Nitido paginas={paginas} base={base} vista={vista} caja={caja.current} />}
        {cargando && !error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[12px] tracking-[0.12em] uppercase text-[#7F939D]">
            {pdf ? 'Abriendo el PDF…' : 'Cargando el mapa…'}
          </div>
        )}
        {ayuda && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[92%] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-center font-mono text-[10.5px] text-[#8FA3B0] backdrop-blur">
            {tactil
              ? pdf
                ? 'Deslizá para recorrer · pellizcá para acercar'
                : 'Pellizcá para acercar · doble toque para volver'
              : pdf
                ? 'Rueda para recorrer · Ctrl+rueda o pellizco para acercar'
                : 'Rueda para acercar · arrastrá para moverte · doble clic para volver'}
          </div>
        )}
      </div>
    </div>
  );
}

/** Una página del PDF: el lienzo ya dibujado se pone en su lugar, escalado al ancho de la columna. */
function LienzoPagina({ pagina, ancho }: { pagina: Pagina; ancho: number }) {
  const hueco = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = hueco.current;
    if (!el) return;
    pagina.lienzo.style.width = '100%';
    pagina.lienzo.style.height = '100%';
    pagina.lienzo.style.display = 'block';
    el.appendChild(pagina.lienzo);
    return () => {
      if (pagina.lienzo.parentNode === el) el.removeChild(pagina.lienzo);
    };
  }, [pagina]);
  return <div ref={hueco} className="bg-white shadow-[0_10px_40px_rgba(0,0,0,.6)]" style={{ width: ancho, height: (ancho * pagina.alto) / pagina.ancho, marginBottom: HUECO }} />;
}
