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
import { crearGestos, type EventoGesto, type Punto } from './gestos';

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
  const onEstadoRef = useRef(onEstado);
  onEstadoRef.current = onEstado;

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

    const debajo = (x: number, y: number): Element | null => {
      // El cursor no recibe eventos (pointer-events: none), así que no se tapa a sí mismo.
      return document.elementFromPoint(x, y);
    };

    const aplicar = (e: EventoGesto) => {
      const c = cursor.current;
      switch (e.tipo) {
        case 'cursor':
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

    const dibujar = (todas: Punto[][]) => {
      const cv = lienzo.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = AMBAR;
      for (const lm of todas) {
        for (const p of lm) {
          ctx.beginPath();
          // El lienzo va en espejo como el video, así que se dibuja en coordenadas del cuadro.
          ctx.arc(p.x * cv.width, p.y * cv.height, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
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
      onEstadoRef.current('cargando');
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      } catch {
        if (vivo) onEstadoRef.current('sin-permiso');
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
              minHandDetectionConfidence: 0.6,
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
        if (vivo) onEstadoRef.current('error');
        return;
      }
      if (!vivo) return;
      onEstadoRef.current('activo');
      bucle();
    })();

    return () => {
      vivo = false;
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
      onEstadoRef.current('apagado');
    };
  }, [activo, avisar]);

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
      <div className="pointer-events-none fixed bottom-3 left-3 z-[70] overflow-hidden rounded-xl border border-white/15 bg-black/70 shadow-lg backdrop-blur" style={{ width: 150 }}>
        <div className="relative" style={{ transform: 'scaleX(-1)' }}>
          <video ref={video} muted playsInline className="block h-[112px] w-[150px] object-cover opacity-70" />
          <canvas ref={lienzo} width={150} height={112} className="absolute inset-0 h-full w-full" />
        </div>
        <div className="px-2 py-1 font-mono text-[9.5px] leading-tight tracking-[0.08em] text-[#C9D5DB]">
          <span style={{ color: AMBAR }}>AIR TOUCH</span> · {manos === 0 ? 'muestre la mano' : manos === 1 ? '1 mano' : '2 manos'}
          <div className="mt-0.5 text-[9px] normal-case tracking-normal text-[#8FA2AC]">Pellizque = tocar · pellizque y mueva = arrastrar · dos manos = zoom · puño = cerrar</div>
        </div>
      </div>
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
