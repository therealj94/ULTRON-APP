/**
 * AIR TOUCH: manejar Dr Electrum con la mano frente a la cámara, sin tocar la pantalla.
 *
 * El botón «Manos» enciende la cámara del frente y MediaPipe (el mismo paquete que ya usa la cara)
 * sigue hasta dos manos. `gestos.ts` convierte los puntos en gestos y aquí se vuelven acciones:
 *  · el cursor (un anillo ámbar) sigue la mano;
 *  · pellizco corto = tocar lo que está debajo (botón, concesión del mapa, pestaña…);
 *  · pellizco y mover = arrastrar: el mapa se desplaza, una lista se desplaza, una ventana se corre;
 *  · dos manos pellizcando = zoom del mapa (o del visor, si está abierto);
 *  · puño sostenido = cerrar la ventana; palma barriendo = siguiente capítulo del recorrido.
 *
 * La cámara no sale del navegador: los puntos de la mano se calculan en el equipo y no se manda
 * ninguna imagen a ningún lado.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MEDIAPIPE_WASM_URL_DEFAULT } from '../../src/02-cara/vision/mediapipe';
import { crearGestos, leerMano, type EventoGesto, type Punto } from './gestos';

const AMBAR = '#FFAE3B';
const MODELO_MANOS = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
/** Un identificador de puntero que ningún dedo real usa. */
const ID_AIRE = 7701;

export type EstadoManos = 'apagado' | 'cargando' | 'activo' | 'sin-permiso' | 'error';

type Arrastre =
  | { tipo: 'mapa' }
  | { tipo: 'lista'; el: HTMLElement }
  | { tipo: 'ventana'; el: HTMLElement; x: number; y: number }
  | { tipo: 'puntero'; el: Element }
  | null;

function enviarPuntero(tipo: 'down' | 'move' | 'up', el: Element, x: number, y: number) {
  const botones = tipo === 'up' ? 0 : 1;
  const comun = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: botones, view: window };
  try {
    el.dispatchEvent(new PointerEvent(`pointer${tipo}`, { ...comun, pointerId: ID_AIRE, pointerType: 'mouse', isPrimary: true }));
  } catch {
    /* navegador sin PointerEvent: quedan los de ratón */
  }
  el.dispatchEvent(new MouseEvent(`mouse${tipo}`, comun));
}

function tocar(el: Element, x: number, y: number) {
  enviarPuntero('down', el, x, y);
  enviarPuntero('up', el, x, y);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window }));
  // Un campo de texto, además, recibe el foco (como con un dedo).
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus();
}

/** El elemento que se puede desplazar debajo del punto, si lo hay. */
function desplazable(el: Element | null): HTMLElement | null {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    const st = getComputedStyle(n);
    if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 4) return n;
  }
  return null;
}

/**
 * `setPointerCapture` con un puntero inventado lanza «InvalidPointerId» y rompería el arrastre de
 * los componentes que lo usan (el asa del panel, el visor). Mientras Air touch está encendido, la
 * captura de NUESTRO puntero se ignora; la de los dedos reales sigue igual.
 */
function protegerCaptura(): () => void {
  const P = Element.prototype as any;
  const set = P.setPointerCapture;
  const rel = P.releasePointerCapture;
  const has = P.hasPointerCapture;
  P.setPointerCapture = function (id: number) {
    if (id === ID_AIRE) return;
    return set.call(this, id);
  };
  P.releasePointerCapture = function (id: number) {
    if (id === ID_AIRE) return;
    return rel.call(this, id);
  };
  P.hasPointerCapture = function (id: number) {
    if (id === ID_AIRE) return false;
    return has.call(this, id);
  };
  return () => {
    P.setPointerCapture = set;
    P.releasePointerCapture = rel;
    P.hasPointerCapture = has;
  };
}

export function AirTouch({ activo, onEstado }: { activo: boolean; onEstado: (e: EstadoManos) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const [aviso, setAviso] = useState('');
  const [manos, setManos] = useState(0);
  /** Qué gesto se está leyendo ahora, en palabras («Pellizco», «Arrastrando»…). */
  const [gesto, setGesto] = useState('');
  /** Ya vio una mano alguna vez desde que se encendió (para la guía de entrada). */
  const [vista, setVista] = useState(false);
  /** Lleva un rato sin ver ninguna mano: consejo de luz y distancia. */
  const [perdida, setPerdida] = useState(false);
  const onEstadoRef = useRef(onEstado);
  onEstadoRef.current = onEstado;
  // El estado también se muestra aquí: una guía que pide la mano no sirve si la cámara no abrió.
  const [estado, setEstado] = useState<EstadoManos>('apagado');
  const informar = useCallback((e: EstadoManos) => {
    setEstado(e);
    onEstadoRef.current(e);
  }, []);
  const vistaRef = useRef(false);
  useEffect(() => {
    if (!activo) {
      vistaRef.current = false;
      setVista(false);
    }
  }, [activo]);

  const avisar = useCallback((t: string) => {
    setAviso(t);
    window.setTimeout(() => setAviso((a) => (a === t ? '' : a)), 1400);
  }, []);

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    let flujo: MediaStream | null = null;
    let detector: any = null;
    let reloj = 0;
    let ultimoTiempo = -1;
    const gestos = crearGestos();
    const soltarCaptura = protegerCaptura();
    let arrastre: Arrastre = null;
    // Desde que se enciende: el consejo de luz sale a los 5 s SIN mano, no al abrir.
    let ultimaMano = performance.now();
    let gestoAhora = '';
    // El nombre del gesto se publica a lo sumo 8 veces por segundo (no un render por cuadro).
    const nombrar = (g: string) => {
      gestoAhora = g;
    };
    const publicar = window.setInterval(() => {
      setGesto((a) => (a === gestoAhora ? a : gestoAhora));
      const sinMano = performance.now() - ultimaMano > 5000;
      setPerdida((a) => (a === sinMano ? a : sinMano));
    }, 125);

    const debajo = (x: number, y: number): Element | null => {
      // El cursor no recibe eventos (pointer-events: none), así que no se tapa a sí mismo.
      return document.elementFromPoint(x, y);
    };

    const aplicar = (e: EventoGesto) => {
      const c = cursor.current;
      switch (e.tipo) {
        case 'cursor':
          ultimaMano = performance.now();
          nombrar(e.pinza ? (arrastre ? 'Arrastrando' : 'Pellizco') : e.manos === 2 ? 'Dos manos' : 'Señalando');
          if (c) {
            c.style.opacity = '1';
            c.style.transform = `translate(${e.x - 18}px, ${e.y - 18}px) scale(${e.pinza ? 0.72 : 1})`;
            c.style.background = e.pinza ? 'rgba(255,174,59,.35)' : 'transparent';
          }
          setManos((n) => (n === e.manos ? n : e.manos));
          break;
        case 'sin-manos':
          if (c) c.style.opacity = '0';
          setManos(0);
          break;
        case 'bajar': {
          const el = debajo(e.x, e.y);
          if (!el) break;
          const ventana = el.closest('[data-ventana]') as HTMLElement | null;
          const esBoton = !!el.closest('button, a, input, textarea, select, [role="button"], [role="switch"]');
          if (el.closest('.maplibregl-map') && !el.closest('[data-ventana]')) arrastre = { tipo: 'mapa' };
          else if (!esBoton && desplazable(el)) arrastre = { tipo: 'lista', el: desplazable(el)! };
          else if (!esBoton && ventana) {
            const [x = '0', y = '0'] = (ventana.style.translate || '0px 0px').split(' ');
            arrastre = { tipo: 'ventana', el: ventana, x: parseFloat(x) || 0, y: parseFloat(y) || 0 };
          } else {
            arrastre = { tipo: 'puntero', el };
            enviarPuntero('down', el, e.x, e.y);
          }
          break;
        }
        case 'arrastrar':
          if (!arrastre) break;
          if (arrastre.tipo === 'mapa') window.dispatchEvent(new CustomEvent('electrum:mapa', { detail: { accion: 'mover', centro: [-e.dx, -e.dy] } }));
          else if (arrastre.tipo === 'lista') arrastre.el.scrollTop -= e.dy;
          else if (arrastre.tipo === 'ventana') {
            arrastre.x += e.dx;
            arrastre.y += e.dy;
            arrastre.el.style.translate = `${Math.round(arrastre.x)}px ${Math.round(arrastre.y)}px`;
          } else enviarPuntero('move', arrastre.el, e.x, e.y);
          break;
        case 'soltar': {
          const a = arrastre;
          arrastre = null;
          if (a?.tipo === 'puntero') enviarPuntero('up', a.el, e.x, e.y);
          if (e.clic) {
            const el = debajo(e.x, e.y);
            if (el) {
              // Sobre el mapa, MapLibre necesita la secuencia completa sobre su lienzo para tomarlo como clic.
              if (a?.tipo === 'puntero') el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.x, clientY: e.y, view: window }));
              else tocar(el, e.x, e.y);
              if (c) {
                c.animate?.([{ boxShadow: `0 0 0 0 ${AMBAR}aa` }, { boxShadow: `0 0 0 18px ${AMBAR}00` }], { duration: 380 });
              }
            }
          }
          break;
        }
        case 'zoom': {
          nombrar(e.factor > 1 ? 'Zoom: acercando' : 'Zoom: alejando');
          const marco = document.querySelector('[data-visor-marco]');
          if (marco) {
            // El visor hace zoom con la rueda + Ctrl, como un pellizco de trackpad.
            marco.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: e.x, clientY: e.y, ctrlKey: true, deltaY: -Math.log(e.factor) / 0.006 }));
          } else window.dispatchEvent(new CustomEvent('electrum:mapa', { detail: { accion: 'zoom-libre', factor: e.factor } }));
          break;
        }
        case 'cerrar':
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          avisar('Cerrar');
          break;
        case 'deslizar':
          window.dispatchEvent(new CustomEvent('electrum:recorrido', { detail: 'siguiente' }));
          avisar(e.dir === 'izquierda' ? 'Siguiente ›' : '‹ Siguiente');
          break;
      }
    };

    // El esqueleto de la mano, del color del gesto: se ve de un vistazo si la está leyendo y qué hace.
    const HUESOS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
    const dibujar = (todas: Punto[][]) => {
      const cv = lienzo.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      // El lienzo va en espejo como el video, así que se dibuja en coordenadas del cuadro.
      for (const lm of todas) {
        const l = leerMano(lm);
        const color = l?.puno ? '#FF6B5A' : l?.pinza ? '#FFD34D' : l?.palma ? '#5CD6C4' : AMBAR;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const [a, b] of HUESOS) {
          ctx.moveTo(lm[a].x * cv.width, lm[a].y * cv.height);
          ctx.lineTo(lm[b].x * cv.width, lm[b].y * cv.height);
        }
        ctx.stroke();
        ctx.fillStyle = '#fff';
        for (const k of [4, 8]) {
          ctx.beginPath();
          ctx.arc(lm[k].x * cv.width, lm[k].y * cv.height, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (todas.length && !vistaRef.current) {
        vistaRef.current = true;
        setVista(true);
      }
    };

    const bucle = () => {
      if (!vivo) return;
      reloj = requestAnimationFrame(bucle);
      const v = video.current;
      if (!v || !detector || v.readyState < 2 || v.currentTime === ultimoTiempo) return;
      ultimoTiempo = v.currentTime;
      let res: any;
      try {
        res = detector.detectForVideo(v, performance.now());
      } catch {
        return;
      }
      const todas: Punto[][] = (res?.landmarks || []) as Punto[][];
      dibujar(todas);
      for (const e of gestos.procesar(todas, performance.now(), window.innerWidth, window.innerHeight)) aplicar(e);
    };

    (async () => {
      informar('cargando');
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      } catch {
        if (vivo) informar('sin-permiso');
        return;
      }
      if (!vivo) return flujo.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.srcObject = flujo;
      await v.play().catch(() => {});
      try {
        const mod = await import('@mediapipe/tasks-vision');
        const fileset = await mod.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL_DEFAULT);
        for (const delegate of ['GPU', 'CPU'] as const) {
          try {
            detector = await mod.HandLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: MODELO_MANOS, delegate },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            });
            break;
          } catch {
            /* sin GPU: se prueba en CPU */
          }
        }
        if (!detector) throw new Error('sin detector');
      } catch {
        // Sin detector Air touch no sirve: se suelta la cámara (y su luz de «grabando»).
        flujo?.getTracks().forEach((t) => t.stop());
        flujo = null;
        if (vivo) informar('error');
        return;
      }
      if (!vivo) return;
      informar('activo');
      bucle();
    })();

    return () => {
      vivo = false;
      clearInterval(publicar);
      cancelAnimationFrame(reloj);
      if (arrastre?.tipo === 'puntero') enviarPuntero('up', arrastre.el, 0, 0);
      soltarCaptura();
      gestos.reiniciar();
      flujo?.getTracks().forEach((t) => t.stop());
      try {
        detector?.close?.();
      } catch {
        /* ya cerrado */
      }
      if (cursor.current) cursor.current.style.opacity = '0';
      informar('apagado');
    };
  }, [activo, avisar, informar]);

  if (!activo) return null;
  // Al cuerpo de la página: un ancestro con transform dejaría el cursor «fijo» mal ubicado.
  return createPortal(
    <>
      {/* El cursor de la mano: encima de todo y sin recibir eventos. */}
      <div
        ref={cursor}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[80] h-9 w-9 rounded-full transition-[transform,opacity] duration-75 ease-out"
        style={{ opacity: 0, border: `2.5px solid ${AMBAR}`, boxShadow: `0 0 14px ${AMBAR}88, inset 0 0 8px ${AMBAR}55` }}
      >
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: AMBAR }} />
      </div>
      {/* La vista de la cámara, chica y en espejo, con los puntos de la mano. */}
      <div
        className="pointer-events-none fixed bottom-3 left-3 z-[70] overflow-hidden rounded-xl border bg-black/70 shadow-lg backdrop-blur transition-colors"
        style={{ width: 200, borderColor: manos ? `${AMBAR}aa` : 'rgba(255,255,255,.15)', boxShadow: manos ? `0 0 18px ${AMBAR}44` : undefined }}
        data-air-touch={manos ? 'mano' : 'sin-mano'}
      >
        <div className="relative" style={{ transform: 'scaleX(-1)' }}>
          <video ref={video} muted playsInline className="block h-[150px] w-[200px] object-cover opacity-70" />
          <canvas ref={lienzo} width={200} height={150} className="absolute inset-0 h-full w-full" />
        </div>
        <div className="px-2 py-1.5 font-mono text-[10px] leading-tight tracking-[0.08em] text-[#C9D5DB]">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: manos ? '#5CD6C4' : '#7F939D' }} aria-hidden />
            <span style={{ color: AMBAR }}>AIR TOUCH</span>
            <span>· {manos === 0 ? 'sin mano' : manos === 1 ? '1 mano' : '2 manos'}</span>
          </div>
          <div className="mt-0.5 min-h-[14px] text-[11px] font-semibold normal-case tracking-normal" style={{ color: manos ? '#FFE3A8' : '#8FA2AC' }} data-air-gesto>
            {manos ? gesto || 'Señalando' : perdida ? 'Acérquese a la luz, mano a medio metro' : 'Muestre la mano a la cámara'}
          </div>
          <div className="mt-0.5 text-[9px] normal-case tracking-normal text-[#8FA2AC]">Pellizque = tocar · pellizque y mueva = arrastrar · dos manos = zoom · puño = cerrar</div>
        </div>
      </div>
      {/* La guía de entrada: hasta que vea la mano por primera vez, se dice qué hacer; al verla, se confirma. */}
      {estado === 'error' || estado === 'sin-permiso' ? (
        <div className="pointer-events-none fixed left-1/2 top-1/3 z-[80] -translate-x-1/2 rounded-2xl border border-[#FF6B5A]/50 bg-black/80 px-5 py-4 text-center shadow-2xl backdrop-blur" role="alert">
          <div className="text-[14px] font-semibold text-[#FFB4A8]">{estado === 'sin-permiso' ? 'Air touch necesita la cámara' : 'No pude cargar el detector de manos'}</div>
          <div className="mt-1 text-[12px] text-[#9FB0B8]">{estado === 'sin-permiso' ? 'Permita la cámara en el candado de la barra del navegador y vuelva a tocar «Air touch».' : 'Revise la conexión y vuelva a tocar «Air touch».'}</div>
        </div>
      ) : estado === 'cargando' ? (
        <div className="pointer-events-none fixed left-1/2 top-1/3 z-[80] -translate-x-1/2 rounded-2xl border border-white/15 bg-black/80 px-5 py-3 text-center text-[13px] text-[#C9D5DB] shadow-2xl backdrop-blur" role="status">
          Preparando la cámara y el detector de manos…
        </div>
      ) : !vista ? (
        <div className="pointer-events-none fixed left-1/2 top-1/3 z-[80] -translate-x-1/2 rounded-2xl border border-white/15 bg-black/80 px-5 py-4 text-center shadow-2xl backdrop-blur" role="status">
          <div className="text-[34px] leading-none" aria-hidden>✋</div>
          <div className="mt-2 text-[14px] font-semibold text-[#FFE3A8]">Levante la mano frente a la cámara</div>
          <div className="mt-1 text-[12px] text-[#9FB0B8]">Palma hacia la pantalla, a medio metro y con luz de frente.</div>
        </div>
      ) : (
        <GuiaVista />
      )}
      {aviso && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-[80] -translate-x-1/2 rounded-full border border-[#FFAE3B]/40 bg-black/80 px-4 py-1.5 font-mono text-[12px] tracking-[0.12em] uppercase" style={{ color: AMBAR }}>
          {aviso}
        </div>
      )}
    </>,
    document.body
  );
}

/** El botón «Manos», al lado del micrófono. */
/** «✓ Mano detectada» un momento, la primera vez que la ve. */
function GuiaVista() {
  const [ver, setVer] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setVer(false), 1800);
    return () => clearTimeout(t);
  }, []);
  if (!ver) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-1/3 z-[80] -translate-x-1/2 rounded-2xl border border-[#5CD6C4]/50 bg-black/80 px-5 py-3 text-center shadow-2xl backdrop-blur" role="status">
      <div className="text-[14px] font-semibold text-[#5CD6C4]">✓ Mano detectada</div>
      <div className="mt-1 text-[12px] text-[#9FB0B8]">Mueva el cursor y pellizque para tocar.</div>
    </div>
  );
}

export function BotonManos({ activo, estado, onCambiar }: { activo: boolean; estado: EstadoManos; onCambiar: () => void }) {
  const etiqueta =
    estado === 'cargando' ? 'Cargando…' : estado === 'sin-permiso' ? 'Permitir cámara' : estado === 'error' ? 'Sin Air touch' : activo ? 'Manos activas' : 'Air touch';
  const color = estado === 'sin-permiso' || estado === 'error' ? '#7F939D' : activo ? AMBAR : '#9FB0B8';
  return (
    <button
      type="button"
      onClick={onCambiar}
      aria-pressed={activo}
      data-tour="manos"
      title="Manejar con la mano frente a la cámara: pellizcar para tocar, dos manos para zoom, puño para cerrar"
      className="pointer-events-auto flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/12 bg-black/55 py-1.5 pl-2.5 pr-3 backdrop-blur-md cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]"
      style={activo ? { borderColor: `${AMBAR}88` } : undefined}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </svg>
      <span className="font-mono text-[10.5px] tracking-[0.1em] uppercase" style={{ color }}>
        <span className="hidden lg:inline">{etiqueta}</span>
        <span className="lg:hidden">Manos</span>
      </span>
    </button>
  );
}
