/**
 * Los efectos de los toques de Claudio y ANT-ONIO (el sable de luz, los blasters y las ondas), pintados con
 * Skia de verdad (CanvasKit) fuera del teléfono, ENCIMA de un cuadro real de sus clips.
 *
 * Usa el MISMO dibujo que corre en la APK (mobile/src/avatares/video/efectos/pintar.ts) y el mismo
 * encuadre del video (guion.ts, `encuadrar`), así que la posición del sable en la mano y el tamaño de todo
 * es lo que se ve allá. Pinta cada caso en varios instantes, una hoja con todos y, para la mesa vertical,
 * los cuadros de una animación entera (para armar un GIF). Además comprueba píxeles: el núcleo de la hoja
 * casi blanco, el resplandor del color de cada uno, la empuñadura en la mano, el disparo rojo, y que con
 * «reducir movimiento» no haya estela. Sale con 1 si algo no cuadra.
 *
 *   npx tsx scripts/qa/efectos-avatar.ts [dirSalida] [dirCuadros]
 *
 * `dirCuadros`: PNG de 720×1280 llamados `<avatar>-<clip>.png` (claudio-niega.png…), sacados de los clips
 * (por ejemplo con cv2 o ffmpeg). Sin ellos se pinta sobre el fondo liso del avatar.
 * Necesita mobile/node_modules instalado (CanvasKit viene con @shopify/react-native-skia).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { planBlasters, planEspada, planOnda, encuadreDe, estadoEspada, puntasEspada, sacudida, AGARRES, aCaja, type PlanBlasters, type PlanEspada, type Onda, type LugarEfectos } from '../../mobile/src/avatares/video/efectos/escena';
import { pintarEscena } from '../../mobile/src/avatares/video/efectos/pintar';
import { avatarPorId } from '../../mobile/src/avatares/catalogo';
import type { AvatarVideo } from '../../mobile/src/avatares/video/efectos/toques';
import type { Camara } from '../../mobile/src/avatar3d/tipos';

const requireMovil = createRequire(path.resolve('mobile/package.json'));
const CanvasKitInit = requireMovil('canvaskit-wasm/bin/full/canvaskit.js');
const { JsiSkApi } = requireMovil('@shopify/react-native-skia/lib/commonjs/skia/web');

const out = process.argv[2] || path.resolve('qa-efectos-avatar');
const dirCuadros = process.argv[3] || '';
fs.mkdirSync(out, { recursive: true });

const CanvasKit = await CanvasKitInit({ locateFile: (f: string) => requireMovil.resolve('canvaskit-wasm/bin/full/' + f) });
const Sk = JsiSkApi(CanvasKit);

/** Un azar con semilla: los mismos disparos en cada corrida. */
function semilla(s: number) {
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

type Lugar = { nombre: string; camara: Camara; lugar: LugarEfectos; W: number; H: number; circulo?: boolean };
/** La mesa vertical (cuerpo entero), la mesa acostada (retrato) y el círculo de la llamada. */
const LUGARES: Lugar[] = [
  { nombre: 'mesa-vertical', camara: 'cuerpo', lugar: 'cuerpo', W: 390, H: 620 },
  { nombre: 'mesa-acostada', camara: 'retrato', lugar: 'retrato', W: 560, H: 330 },
  { nombre: 'llamada', camara: 'retrato', lugar: 'llamada', W: 142, H: 142, circulo: true },
];

const imagenes = new Map<string, unknown>();
function cuadro(avatar: AvatarVideo, clip: string) {
  const k = `${avatar}-${clip}`;
  if (imagenes.has(k)) return imagenes.get(k);
  const f = dirCuadros && path.join(dirCuadros, `${k}.png`);
  const img = f && fs.existsSync(f) ? Sk.Image.MakeImageFromEncoded(Sk.Data.fromBytes(fs.readFileSync(f))) : null;
  imagenes.set(k, img);
  return img;
}

type Img = { w: number; h: number; px: Uint8Array };

/** Pinta el avatar como CuerpoVideo (el clip encuadrado, los bordes fundidos con su fondo) y encima la escena. */
function render(avatar: AvatarVideo, clip: string, L: Lugar, plan: PlanEspada | PlanBlasters | null, t: number, ondas: { o: Onda; t: number }[] = [], sinVideo = false): { png: Uint8Array; img: Img } {
  const { W, H } = L;
  const surface = Sk.Surface.MakeOffscreen(W, H)!;
  const c = surface.getCanvas();
  const fondo = avatarPorId(avatar).tema.fondo;
  c.save();
  if (L.circulo) c.clipRRect(Sk.RRectXY(Sk.XYWHRect(0, 0, W, H), W / 2, H / 2), 1, true);
  c.drawColor(Sk.Color(fondo));
  const e = encuadreDe(avatar, L.camara, W, H);
  // La sacudida de la pantalla mueve el video (CapaEfectos, `sacudida`), no los efectos.
  const img = sinVideo ? null : (cuadro(avatar, clip) as { width: () => number; height: () => number } | null);
  const sac = sacudida(plan, t);
  c.save();
  c.translate(W / 2 + sac.x, H / 2 + sac.y);
  c.scale(sac.k, sac.k);
  c.translate(-W / 2, -H / 2);
  if (img) c.drawImageRect(img, Sk.XYWHRect(0, 0, img.width(), img.height()), Sk.XYWHRect(e.left, e.top, e.width, e.height), Sk.Paint());
  c.restore();
  // Los bordes de arriba y abajo se funden con el fondo, como en CuerpoVideo (9 % de alto).
  const lleno = Sk.Color(fondo);
  const vacio = Sk.Color(fondo);
  vacio[3] = 0;
  const borde = (y0: number, y1: number, colores: Float32Array[]) => {
    const p = Sk.Paint();
    p.setShader(Sk.Shader.MakeLinearGradient(Sk.Point(0, y0), Sk.Point(0, y1), colores, [0, 1], 0));
    c.drawRect(Sk.XYWHRect(0, y0, W, y1 - y0), p);
  };
  borde(0, H * 0.09, [lleno, vacio]);
  borde(H * 0.91, H, [vacio, lleno]);
  pintarEscena(Sk, c, { plan, t, ondas: ondas.map((x) => x.o), tOndas: ondas.map((x) => x.t) });
  c.restore();
  surface.flush();
  const snap = surface.makeImageSnapshot();
  const png = snap.encodeToBytes();
  const px = snap.readPixels(0, 0, { width: W, height: H, colorType: 4, alphaType: 1 }) as Uint8Array;
  surface.dispose?.();
  return { png, img: { w: W, h: H, px } };
}

function pixel(img: Img, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * img.w + Math.round(x)) * 4;
  return [img.px[i], img.px[i + 1], img.px[i + 2]];
}

const fallas: string[] = [];
const comprobar = (ok: boolean, que: string) => {
  if (!ok) fallas.push(que);
  console.log(`${ok ? 'ok' : 'NO'} - ${que}`);
};

const guardados: { archivo: string; titulo: string; w: number; h: number }[] = [];
function guardar(nombre: string, titulo: string, r: { png: Uint8Array; img: Img }) {
  const archivo = path.join(out, nombre + '.png');
  fs.writeFileSync(archivo, r.png);
  guardados.push({ archivo, titulo, w: r.img.w, h: r.img.h });
}

const AVATARES: AvatarVideo[] = ['claudio', 'antonio'];
const INSTANTES_ESPADA = [250, 1000, 1330, 1650, 2300];
const INSTANTES_BLASTERS = [180, 520, 900, 1400];

for (const avatar of AVATARES) {
  for (const L of LUGARES) {
    const sutil = !!L.circulo; // en la llamada siempre es la versión sutil
    const pe = planEspada(avatar, L.lugar, L.W, L.H, sutil, false);
    for (const t of sutil ? [300, 800, 1000] : INSTANTES_ESPADA) guardar(`${avatar}-${L.nombre}-espada-${t}`, `${avatar} ${L.nombre} sable${sutil ? ' (sutil)' : ''} t=${t}`, render(avatar, 'niega', L, pe, t));
    const pb = planBlasters(L.W, L.H, sutil, false, semilla(avatar === 'claudio' ? 7 : 11));
    for (const t of sutil ? [300, 600, 900] : INSTANTES_BLASTERS) guardar(`${avatar}-${L.nombre}-blasters-${t}`, `${avatar} ${L.nombre} blasters${sutil ? ' (sutil)' : ''} t=${t}`, render(avatar, 'sorpresa', L, pb, t));
  }
  // «Reducir movimiento»: el sable quieto y los disparos quietos.
  const L = LUGARES[0];
  guardar(`${avatar}-reducido-espada`, `${avatar} reducir movimiento: sable`, render(avatar, 'niega', L, planEspada(avatar, L.lugar, L.W, L.H, false, true), 900));
  guardar(`${avatar}-reducido-blasters`, `${avatar} reducir movimiento: blasters`, render(avatar, 'reposo', L, planBlasters(L.W, L.H, false, true, semilla(3)), 400));
  // Las ondas de un toque: normal, sutil y molesto.
  const ondas = [
    { o: planOnda(avatar, L.W, L.H, L.W * 0.5, L.H * 0.22, { sutil: false, reducido: false }), t: 160 },
    { o: planOnda(avatar, L.W, L.H, L.W * 0.35, L.H * 0.5, { sutil: true, reducido: false }), t: 220 },
    { o: planOnda(avatar, L.W, L.H, L.W * 0.62, L.H * 0.62, { sutil: false, reducido: false, molesto: true }), t: 200 },
  ];
  guardar(`${avatar}-ondas`, `${avatar} toques: normal, sutil, molesto`, render(avatar, 'risa', L, null, 0, ondas));
}

/* ── comprobaciones de píxeles ─────────────────────────────────────────────────────────────── */
for (const avatar of AVATARES) {
  const L = LUGARES[0];
  const p = planEspada(avatar, L.lugar, L.W, L.H, false, false);
  const t = 2300; // sostenido, quieto: sin estela
  const s = estadoEspada(p, t);
  const q = puntasEspada(p, s.ang, s.hoja);
  const r = render(avatar, 'niega', L, p, t, [], true);
  const mx = (q.bx + q.px) / 2;
  const my = (q.by + q.py) / 2;
  const nucleo = pixel(r.img, mx, my);
  comprobar(Math.min(...nucleo) > 215, `${avatar}: el núcleo de la hoja es casi blanco (${nucleo.join(',')})`);
  // A un costado de la hoja, el resplandor tiene el color del avatar.
  const off = p.grosor * 2.6;
  const halo = pixel(r.img, mx - q.dy * off, my + q.dx * off);
  const verde = halo[1] > halo[0] + 40 && halo[1] > 90;
  const azul = halo[2] > halo[0] + 40 && halo[2] > 90;
  comprobar(avatar === 'claudio' ? verde : azul, `${avatar}: el resplandor es ${avatar === 'claudio' ? 'verde' : 'azul'} (${halo.join(',')})`);
  // La empuñadura está donde está la mano en el clip (AGARRES llevado a la caja).
  const mano = aCaja(AGARRES[avatar].cuerpo.mano, encuadreDe(avatar, 'cuerpo', L.W, L.H));
  comprobar(Math.hypot(mano.x - p.pivote.x, mano.y - p.pivote.y) < 0.5, `${avatar}: la empuñadura va en la mano (${p.pivote.x.toFixed(0)}, ${p.pivote.y.toFixed(0)})`);
  const metal = pixel(r.img, p.pivote.x, p.pivote.y);
  comprobar(metal.some((v, i) => Math.abs(v - [0x23, 0x25, 0x28][i]) > 20), `${avatar}: la empuñadura se ve sobre el fondo (${metal.join(',')})`);
  // Con «reducir movimiento» no hay estela aunque esté en medio del tajo.
  comprobar(estadoEspada(planEspada(avatar, 'cuerpo', L.W, L.H, false, true), 1330).fuerzaEstela === 0, `${avatar}: reducir movimiento, sin estela`);
  comprobar(estadoEspada(p, 1330).fuerzaEstela > 0.5, `${avatar}: en el tajo grande hay estela`);
}
{
  const L = LUGARES[0];
  const p = planBlasters(L.W, L.H, false, false, semilla(7));
  const ray = p.rayos[2];
  const t = (ray.t0 + ray.t1) / 2;
  const r = render('claudio', 'sorpresa', L, p, t, [], true);
  const hx = ray.x0 + (ray.x1 - ray.x0) * 0.5;
  const hy = ray.y0 + (ray.y1 - ray.y0) * 0.5;
  const ux = (ray.x1 - ray.x0) / Math.hypot(ray.x1 - ray.x0, ray.y1 - ray.y0);
  const uy = (ray.y1 - ray.y0) / Math.hypot(ray.x1 - ray.x0, ray.y1 - ray.y0);
  const nuc = pixel(r.img, hx - ux * p.largo * 0.3, hy - uy * p.largo * 0.3);
  comprobar(nuc[0] > 230 && nuc[1] > 180, `blasters: el núcleo del disparo es claro (${nuc.join(',')})`);
  const off = p.grosor * 2;
  const brillo = pixel(r.img, hx - ux * p.largo * 0.3 - uy * off, hy - uy * p.largo * 0.3 + ux * off);
  comprobar(brillo[0] > brillo[1] + 60 && brillo[0] > brillo[2] + 60, `blasters: el brillo es rojo (${brillo.join(',')})`);
}

/* ── la animación (mesa vertical): cuadros cada 40 ms ──────────────────────────────────────── */
const dirAnim = path.join(out, 'animacion');
fs.mkdirSync(dirAnim, { recursive: true });
for (const avatar of AVATARES) {
  const L = LUGARES[0];
  const pe = planEspada(avatar, L.lugar, L.W, L.H, false, false);
  const pb = planBlasters(L.W, L.H, false, false, semilla(avatar === 'claudio' ? 7 : 11));
  let i = 0;
  for (let t = 0; t <= pe.dur; t += 40) fs.writeFileSync(path.join(dirAnim, `${avatar}-espada-${String(i++).padStart(3, '0')}.png`), render(avatar, 'niega', L, pe, t).png);
  i = 0;
  for (let t = 0; t <= pb.dur; t += 40) fs.writeFileSync(path.join(dirAnim, `${avatar}-blasters-${String(i++).padStart(3, '0')}.png`), render(avatar, 'sorpresa', L, pb, t).png);
}

/* ── la hoja con todo ──────────────────────────────────────────────────────────────────────── */
{
  const col = 5;
  const celda = 300;
  const filas = Math.ceil(guardados.length / col);
  const hoja = Sk.Surface.MakeOffscreen(col * celda, filas * (celda + 26))!;
  const c = hoja.getCanvas();
  c.drawColor(Sk.Color('#0B0C0E'));
  const fuente = CanvasKit.Font ? null : null;
  void fuente;
  guardados.forEach((g, i) => {
    const img = Sk.Image.MakeImageFromEncoded(Sk.Data.fromBytes(fs.readFileSync(g.archivo)))!;
    const k = Math.min((celda - 10) / g.w, (celda - 10) / g.h);
    const x = (i % col) * celda + (celda - g.w * k) / 2;
    const y = Math.floor(i / col) * (celda + 26) + (celda - g.h * k) / 2;
    c.drawImageRect(img, Sk.XYWHRect(0, 0, g.w, g.h), Sk.XYWHRect(x, y, g.w * k, g.h * k), Sk.Paint());
  });
  hoja.flush();
  fs.writeFileSync(path.join(out, '_hoja.png'), hoja.makeImageSnapshot().encodeToBytes());
  fs.writeFileSync(path.join(out, '_hoja.txt'), guardados.map((g, i) => `${i + 1}. ${g.titulo}`).join('\n') + '\n');
}

console.log(`\n${guardados.length} casos en ${out}${fallas.length ? `\n${fallas.length} comprobaciones fallaron` : ''}`);
if (fallas.length) process.exit(1);
