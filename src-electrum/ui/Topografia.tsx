/**
 * EL FONDO VIVO: curvas de nivel que se mueven despacio, como un mapa topográfico respirando, con
 * polvo de oro que sube. Es el fondo de la carga y de la entrada: dice «minería y terreno» antes de
 * leer una sola palabra.
 *
 * Todo en un <canvas> con un solo requestAnimationFrame a ~24 cuadros: un campo de ruido suave que
 * cambia con el tiempo, cortado en niveles con «marching squares». Se detiene con la pestaña oculta
 * y, con «reducir movimiento», se dibuja una vez y queda quieto.
 */
import { useEffect, useRef } from 'react';

/** Ruido de valor 2D, suave y determinista (sin dependencias). */
function crearRuido(semilla = 7) {
  const p = new Uint8Array(512);
  let s = semilla;
  for (let i = 0; i < 256; i++) {
    s = (s * 16807) % 2147483647;
    p[i] = s & 255;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  const h = (x: number, y: number) => p[(p[x & 255] + y) & 511] / 255;
  const suave = (t: number) => t * t * (3 - 2 * t);
  const ruido = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const a = h(xi, yi);
    const b = h(xi + 1, yi);
    const c = h(xi, yi + 1);
    const d = h(xi + 1, yi + 1);
    const u = suave(xf);
    const v = suave(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // Tres octavas: relieve con forma, no manchas.
  return (x: number, y: number) => (ruido(x, y) * 0.6 + ruido(x * 2.1, y * 2.1) * 0.28 + ruido(x * 4.3, y * 4.3) * 0.12);
}

type Particula = { x: number; y: number; v: number; r: number; a: number; fase: number };

export function Topografia({ intensidad = 1, className = '' }: { intensidad?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const lienzo = ref.current;
    if (!lienzo) return;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return;
    const ruido = crearRuido(11);
    const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let particulas: Particula[] = [];
    const medir = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = lienzo.clientWidth;
      h = lienzo.clientHeight;
      lienzo.width = Math.max(1, Math.floor(w * dpr));
      lienzo.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(90, (w * h) / 16000) * intensidad);
      particulas = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, v: 0.08 + Math.random() * 0.35, r: 0.4 + Math.random() * 1.4, a: 0.15 + Math.random() * 0.55, fase: Math.random() * 6.28 }));
    };
    medir();
    const alCambiar = () => medir();
    window.addEventListener('resize', alCambiar);

    const NIVELES = 11;
    const CELDA = 16;
    let raf = 0;
    let ultimo = 0;
    const dibujar = (ms: number) => {
      const t = ms / 1000;
      ctx.clearRect(0, 0, w, h);
      // Las curvas de nivel.
      const cols = Math.ceil(w / CELDA) + 1;
      const filas = Math.ceil(h / CELDA) + 1;
      const campo = new Float32Array(cols * filas);
      const esc = 0.0042;
      for (let j = 0; j < filas; j++)
        for (let i = 0; i < cols; i++) campo[j * cols + i] = ruido(i * CELDA * esc + t * 0.018, j * CELDA * esc - t * 0.011);
      for (let k = 1; k < NIVELES; k++) {
        const nivel = 0.18 + (k / NIVELES) * 0.64;
        // Una curva «índice» cada cuatro, más marcada, como en una hoja topográfica.
        const indice = k % 4 === 0;
        const pulso = 0.5 + 0.5 * Math.sin(t * 0.6 + k * 0.7);
        ctx.strokeStyle = `rgba(255,174,59,${((indice ? 0.2 : 0.07) + pulso * 0.05) * intensidad})`;
        ctx.lineWidth = indice ? 1.1 : 0.7;
        ctx.beginPath();
        for (let j = 0; j < filas - 1; j++) {
          for (let i = 0; i < cols - 1; i++) {
            const a = campo[j * cols + i];
            const b = campo[j * cols + i + 1];
            const c = campo[(j + 1) * cols + i + 1];
            const d = campo[(j + 1) * cols + i];
            const caso = (a > nivel ? 8 : 0) | (b > nivel ? 4 : 0) | (c > nivel ? 2 : 0) | (d > nivel ? 1 : 0);
            if (caso === 0 || caso === 15) continue;
            const x = i * CELDA;
            const y = j * CELDA;
            const lerp = (p: number, q: number) => (nivel - p) / (q - p || 1e-6);
            const arriba = [x + CELDA * lerp(a, b), y] as const;
            const derecha = [x + CELDA, y + CELDA * lerp(b, c)] as const;
            const abajo = [x + CELDA * lerp(d, c), y + CELDA] as const;
            const izquierda = [x, y + CELDA * lerp(a, d)] as const;
            const seg = (p: readonly [number, number], q: readonly [number, number]) => {
              ctx.moveTo(p[0], p[1]);
              ctx.lineTo(q[0], q[1]);
            };
            switch (caso) {
              case 1: case 14: seg(izquierda, abajo); break;
              case 2: case 13: seg(abajo, derecha); break;
              case 3: case 12: seg(izquierda, derecha); break;
              case 4: case 11: seg(arriba, derecha); break;
              case 5: seg(izquierda, arriba); seg(abajo, derecha); break;
              case 6: case 9: seg(arriba, abajo); break;
              case 7: case 8: seg(izquierda, arriba); break;
              case 10: seg(izquierda, abajo); seg(arriba, derecha); break;
            }
          }
        }
        ctx.stroke();
      }
      // El polvo de oro, subiendo.
      for (const p of particulas) {
        p.y -= p.v;
        p.x += Math.sin(t * 0.8 + p.fase) * 0.15;
        if (p.y < -4) {
          p.y = h + 4;
          p.x = Math.random() * w;
        }
        const brillo = p.a * (0.6 + 0.4 * Math.sin(t * 2 + p.fase)) * intensidad;
        ctx.fillStyle = `rgba(255,214,140,${brillo})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const paso = (ms: number) => {
      raf = requestAnimationFrame(paso);
      if (document.hidden || ms - ultimo < 41) return; // ~24 cuadros por segundo
      ultimo = ms;
      dibujar(ms);
    };
    if (quieto) dibujar(0);
    else raf = requestAnimationFrame(paso);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', alCambiar);
    };
  }, [intensidad]);
  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}

/** El emblema: hexágono de oro con «Au», girando lento; el anillo marca el progreso si se le da. */
export function Emblema({ tam = 112, progreso }: { tam?: number; progreso?: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: tam, height: tam }}>
      <div className="absolute inset-[-40%] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,174,59,.28) 0%, transparent 62%)', animation: 'em-latir 3.2s ease-in-out infinite' }} />
      <svg viewBox="0 0 120 120" className="relative h-full w-full">
        <defs>
          <linearGradient id="em-oro" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#FFF1C9" />
            <stop offset=".45" stopColor="#FFC566" />
            <stop offset="1" stopColor="#B86B0C" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,174,59,.14)" strokeWidth="2" />
        {progreso != null ? (
          <circle cx="60" cy="60" r={r} fill="none" stroke="url(#em-oro)" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progreso)))} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)' }} />
        ) : (
          <circle cx="60" cy="60" r={r} fill="none" stroke="url(#em-oro)" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${c * 0.22} ${c}`} style={{ transformOrigin: '60px 60px', animation: 'em-girar 1.6s linear infinite' }} />
        )}
        <g style={{ transformOrigin: '60px 60px', animation: 'em-girar 28s linear infinite' }}>
          <polygon points="60,16 98,38 98,82 60,104 22,82 22,38" fill="rgba(255,174,59,.05)" stroke="url(#em-oro)" strokeWidth="1.6" />
          <polygon points="60,30 86,45 86,75 60,90 34,75 34,45" fill="none" stroke="url(#em-oro)" strokeWidth=".8" opacity=".55" />
        </g>
        <text x="60" y="71" textAnchor="middle" fontSize="30" fontWeight="700" fill="url(#em-oro)" fontFamily="Rajdhani, ui-sans-serif, system-ui">
          Au
        </text>
      </svg>
      <style>{'@keyframes em-girar{to{transform:rotate(360deg)}}@keyframes em-latir{0%,100%{opacity:.7;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}'}</style>
    </div>
  );
}
