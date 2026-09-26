/**
 * La cara de anillos, pintada con Skia de verdad (CanvasKit) fuera del teléfono.
 *
 * Usa el MISMO `pintar` que corre en la APK (mobile/src/cara/pintar.ts), así que lo que sale aquí es
 * lo que se ve allá. Pinta los 10 estados y algunas variantes, guarda un PNG por caso y una hoja con
 * todos, y además comprueba píxeles concretos: que la pupila sea cian en reposo, gris sin red, que el
 * párpado la tape dormida, etc. Sale con 1 si algo no cuadra.
 *
 *   npx tsx scripts/qa/cara-skia.ts [dirSalida]
 *
 * Necesita mobile/node_modules instalado (CanvasKit viene con @shopify/react-native-skia).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  OBJETIVOS,
  ESTADOS,
  VIVO_QUIETO,
  TEMAS,
  disposicion,
  geometria,
  mezclar,
  type EstadoCara,
  type Parametros,
  type Tema,
  type Vivo,
} from '../../mobile/src/cara/estados';
import { pintar } from '../../mobile/src/cara/pintar';

const requireMovil = createRequire(path.resolve('mobile/package.json'));
const CanvasKitInit = requireMovil('canvaskit-wasm/bin/full/canvaskit.js');
const { JsiSkApi } = requireMovil('@shopify/react-native-skia/lib/commonjs/skia/web');

const out = process.argv[2] || path.resolve('qa-cara-skia');
fs.mkdirSync(out, { recursive: true });

const W = 844;
const H = 390;

type Caso = { nombre: string; estado: EstadoCara; vivo?: Partial<Vivo>; params?: Partial<Parametros>; tema?: Tema; tam?: number; w?: number; h?: number };

const CASOS: Caso[] = [
  ...ESTADOS.map((e) => ({ nombre: e, estado: e })),
  { nombre: 'habla-voz-alta', estado: 'habla', vivo: { voz: 0.9 } },
  { nombre: 'trabaja-64', estado: 'trabaja', params: { indeterminado: 0, progreso: 0.64 } },
  { nombre: 'mira-dedo', estado: 'escucha', vivo: { fueraX: -0.9, fueraY: 0.6, fuera: 1 } },
  { nombre: 'parpadeo', estado: 'espera', vivo: { parpadeo: 0.3 } },
  { nombre: 'inclinado', estado: 'espera', vivo: { inclinX: 1, inclinY: -1 } },
  { nombre: 'lee-fase', estado: 'lee', vivo: { fase: 1 } },
  { nombre: 'tema-ambar', estado: 'espera', tema: TEMAS.ambar },
  { nombre: 'tema-hielo', estado: 'escucha', tema: TEMAS.hielo, vivo: { latido: 1 } },
  { nombre: 'telefono-vertical', estado: 'espera', w: 390, h: 844 },
];

type Img = { w: number; h: number; px: Uint8Array };

function pixel(img: Img, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * img.w + Math.round(x)) * 4;
  return [img.px[i], img.px[i + 1], img.px[i + 2]];
}
const brillo = ([r, g, b]: [number, number, number]) => (r + g + b) / 3;
const saturacion = ([r, g, b]: [number, number, number]) => Math.max(r, g, b) - Math.min(r, g, b);

const CanvasKit = await CanvasKitInit({ locateFile: (f: string) => requireMovil.resolve('canvaskit-wasm/bin/full/' + f) });
const Sk = JsiSkApi(CanvasKit);

function render(c: Caso) {
  const w = c.w ?? W;
  const h = c.h ?? H;
  const L = disposicion(w, h, c.tam);
  const p = { ...mezclar(OBJETIVOS[c.estado], OBJETIVOS[c.estado], 1), ...(c.params || {}) };
  const g = geometria(p, { ...VIVO_QUIETO, ...(c.vivo || {}) }, L);
  const surface = Sk.Surface.MakeOffscreen(w, h);
  if (!surface) throw new Error('sin superficie');
  const canvas = surface.getCanvas();
  pintar(Sk, canvas, g, c.tema ?? TEMAS.cian);
  surface.flush();
  const image = surface.makeImageSnapshot();
  const png = image.encodeToBytes();
  fs.writeFileSync(path.join(out, c.nombre + '.png'), png);
  const px = image.readPixels(0, 0, { width: w, height: h, colorType: 4, alphaType: 1 }) as Uint8Array;
  return { img: { w, h, px }, g, L };
}

const fallos: string[] = [];
const verificar = (ok: boolean, msg: string) => {
  if (!ok) fallos.push(msg);
  console.log(`${ok ? 'ok ' : 'MAL'} ${msg}`);
};

const res: Record<string, ReturnType<typeof render>> = {};
for (const c of CASOS) res[c.nombre] = render(c);

// --- comprobaciones de píxeles
const pupila = (n: string) => pixel(res[n].img, res[n].g.izq.px, res[n].g.izq.py);
const cianPupila = pupila('espera');
verificar(cianPupila[2] > 180 && cianPupila[1] > 150 && cianPupila[0] < cianPupila[2], `en espera la pupila es cian (${cianPupila})`);
verificar(saturacion(pupila('sinred')) < saturacion(cianPupila) / 2, `sin red la pupila pierde el color (${pupila('sinred')} vs ${cianPupila})`);
{
  const r = res['duerme'];
  const p = pixel(r.img, r.g.izq.x, r.g.izq.y);
  verificar(brillo(p) < 40, `dormida el párpado tapa el ojo (${p})`);
}
{
  const r = res['listo'];
  const abajo = pixel(r.img, r.g.izq.x, r.g.izq.y + r.L.d * 0.3);
  const arriba = pixel(r.img, r.g.izq.x, r.g.izq.y - (r.L.d / 2 - r.L.anillo / 2));
  verificar(brillo(abajo) < 30 && brillo(arriba) > 90, `listo: la mitad de abajo se esconde y el anillo de arriba se ve (${abajo} / ${arriba})`);
}
{
  const r = res['trabaja-64'];
  const rr = r.L.d / 2 - r.L.anillo / 2;
  // 64 % desde arriba en sentido horario: a las 3 (25 %) hay anillo; a las 11 (≈92 %) solo pista.
  const tres = pixel(r.img, r.g.izq.x + rr, r.g.izq.y);
  const once = pixel(r.img, r.g.izq.x + rr * Math.cos((-90 + 330) * Math.PI / 180), r.g.izq.y + rr * Math.sin((-90 + 330) * Math.PI / 180));
  verificar(brillo(tres) > 120 && brillo(once) < brillo(tres) / 2, `trabajando: el anillo es barra de avance (${tres} / ${once})`);
}
{
  const r = res['mira-dedo'];
  verificar(r.g.izq.px < r.L.exL && r.g.izq.py > r.L.ey, 'con el dedo abajo a la izquierda, las pupilas van abajo a la izquierda');
}
{
  const a = res['habla-voz-alta'];
  const bocaCentro = pixel(a.img, a.L.cx, a.L.bocaY);
  verificar(brillo(bocaCentro) > 120, `hablando con voz, la boca se abre (${bocaCentro})`);
}
{
  const r = res['necesita'];
  const o = r.g.der;
  const p = pixel(r.img, o.x + r.L.d * 0.38, o.y - r.L.d * 0.38);
  verificar(p[0] > 200 && p[2] < 160, `te necesita: punto ámbar sobre el ojo derecho (${p})`);
}
{
  const r = res['tema-ambar'];
  const p = pixel(r.img, r.g.izq.px, r.g.izq.py);
  verificar(p[0] > p[2], `tema ámbar: la pupila es cálida (${p})`);
}
{
  const r = res['parpadeo'];
  const arriba = pixel(r.img, r.g.izq.x, r.g.izq.y - r.L.d * 0.42);
  verificar(brillo(arriba) < 60, `a media parpadeada el borde de arriba del anillo ya no está (${arriba})`);
}
{
  const r = res['telefono-vertical'];
  verificar(r.L.exR + r.L.d / 2 < r.L.W && r.L.exL - r.L.d / 2 > 0, 'en vertical los dos ojos caben en la pantalla');
}

// --- hoja con todos los casos (3 columnas, a mitad de tamaño, en el orden de CASOS)
{
  const nombres = CASOS.filter((c) => !c.w).map((c) => c.nombre);
  const cols = 3;
  const sw = W / 2;
  const sh = H / 2;
  const filas = Math.ceil(nombres.length / cols);
  const hoja = Sk.Surface.MakeOffscreen(cols * sw, filas * (sh + 22));
  if (!hoja) throw new Error('sin hoja');
  const c = hoja.getCanvas();
  c.clear(Sk.Color('#202428'));
  nombres.forEach((n, i) => {
    const x = (i % cols) * sw;
    const y = Math.floor(i / cols) * (sh + 22);
    const img = Sk.Image.MakeImageFromEncoded(Sk.Data.fromBytes(fs.readFileSync(path.join(out, n + '.png'))));
    if (img) c.drawImageRect(img, Sk.XYWHRect(0, 0, W, H), Sk.XYWHRect(x, y + 22, sw, sh), Sk.Paint());
  });
  hoja.flush();
  fs.writeFileSync(path.join(out, '_hoja.png'), hoja.makeImageSnapshot().encodeToBytes());
}

console.log(`\n${CASOS.length} casos en ${out}`);
if (fallos.length) {
  console.error(`\n${fallos.length} comprobaciones fallaron`);
  process.exit(1);
}
