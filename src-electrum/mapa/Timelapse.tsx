/**
 * El timelapse de una concesión: un cuadro de Sentinel-2 por temporada seca de cada año, con el
 * lindero encima. Lo arma el servidor (lee solo la ventana de cada escena); acá se reproduce.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { headersElectrum } from '../acceso';

type Cuadro = { fecha: string; nubes: number; escena: string; img: string };
type Datos = { cuadros: Cuadro[]; ancho: number; alto: number; contorno: number[][][]; fuente: string; faltan: number[] };

const AMBAR = '#FFAE3B';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (f: string) => {
  const [a, m, d] = f.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
};

export function Timelapse({ id, nombre, onCerrar }: { id: number; nombre: string; onCerrar: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [andando, setAndando] = useState(true);
  const [lindero, setLindero] = useState(true);
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const imagenes = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/electrum/concesion/${id}/timelapse`, { headers: headersElectrum() })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok) return setError(j?.error || `El servidor contestó ${r.status}.`);
        imagenes.current = (j as Datos).cuadros.map((c) => {
          const im = new Image();
          im.src = c.img;
          return im;
        });
        setDatos(j);
        setI(0);
      })
      .catch(() => vivo && setError('No alcancé el servidor.'));
    return () => {
      vivo = false;
    };
  }, [id]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
      if (e.key === ' ') {
        e.preventDefault();
        setAndando((v) => !v);
      }
      if (e.key === 'ArrowRight' && datos) setI((x) => (x + 1) % datos.cuadros.length);
      if (e.key === 'ArrowLeft' && datos) setI((x) => (x - 1 + datos.cuadros.length) % datos.cuadros.length);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [datos, onCerrar]);

  useEffect(() => {
    if (!datos || !andando || datos.cuadros.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % datos.cuadros.length), 1100);
    return () => clearInterval(t);
  }, [datos, andando]);

  useEffect(() => {
    const c = lienzo.current;
    const im = imagenes.current[i];
    if (!c || !datos || !im) return;
    const dibujar = () => {
      const ctx = c.getContext('2d')!;
      ctx.drawImage(im, 0, 0, c.width, c.height);
      if (lindero) {
        const sx = c.width / datos.ancho;
        const sy = c.height / datos.alto;
        ctx.save();
        ctx.lineJoin = 'round';
        for (const [ancho, color] of [
          [5, 'rgba(0,0,0,.55)'],
          [2.2, AMBAR],
        ] as const) {
          ctx.lineWidth = ancho;
          ctx.strokeStyle = color;
          for (const r of datos.contorno) {
            ctx.beginPath();
            r.forEach(([x, y], k) => (k ? ctx.lineTo(x * sx, y * sy) : ctx.moveTo(x * sx, y * sy)));
            ctx.closePath();
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    };
    if (im.complete) dibujar();
    else im.onload = dibujar;
  }, [i, datos, lindero]);

  const c = datos?.cuadros[i];
  // Por portal: la tarjeta tiene backdrop-filter, y dentro de ella «fixed» se mediría contra la tarjeta.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" role="dialog" aria-label={`Timelapse satelital de ${nombre}`} onClick={onCerrar}>
      <div className="w-full max-w-[560px] rounded-2xl border border-white/12 bg-[#0A0C0E] p-3 text-[12.5px] text-[#C9D5DB] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
              Timelapse satelital
            </div>
            <div className="text-[15px] font-semibold text-[#F3F6F8]">{nombre}</div>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-md px-2 py-1 text-[#9FB0B9] hover:bg-white/10 cursor-pointer">
            ✕
          </button>
        </div>
        {!datos && !error && <p className="py-16 text-center text-[#8FA3B0]">Leyendo una escena de Sentinel-2 por año desde 2018… (unos segundos)</p>}
        {error && <p className="py-10 text-center text-[#E8A08F]">{error}</p>}
        {datos && c && (
          <>
            <div className="relative overflow-hidden rounded-lg">
              <canvas ref={lienzo} width={datos.ancho} height={datos.alto} className="block aspect-square w-full" />
              <div className="absolute left-2 top-2 rounded-md bg-black/65 px-2 py-1 font-mono text-[18px] font-semibold text-white">{c.fecha.slice(0, 4)}</div>
              <div className="absolute bottom-2 left-2 rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] text-[#DCE5EA]">{fechaLarga(c.fecha)}</div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => setAndando((v) => !v)} className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-black cursor-pointer" style={{ background: AMBAR }}>
                {andando ? 'Pausa' : 'Reproducir'}
              </button>
              <input
                type="range"
                min={0}
                max={datos.cuadros.length - 1}
                value={i}
                onChange={(e) => {
                  setAndando(false);
                  setI(Number(e.target.value));
                }}
                aria-label="Año"
                className="flex-1 accent-[#FFAE3B]"
              />
              <label className="flex cursor-pointer items-center gap-1 text-[11px]">
                <input type="checkbox" checked={lindero} onChange={() => setLindero((v) => !v)} className="accent-[#FFAE3B]" />
                Lindero
              </label>
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-[#7F939D]">
              {datos.cuadros.map((q, k) => (
                <button key={q.fecha} type="button" onClick={() => { setAndando(false); setI(k); }} className={`cursor-pointer ${k === i ? 'text-[#FFAE3B]' : ''}`}>
                  {q.fecha.slice(2, 4)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-[#61717A]">
              Temporada seca (enero–abril) de cada año, la escena más limpia. {datos.faltan.length ? `Sin escena limpia: ${datos.faltan.join(', ')}. ` : ''}
              {datos.fuente}.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
