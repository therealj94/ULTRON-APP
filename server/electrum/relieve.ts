/**
 * EL RELIEVE DEL PLANO — sombreado del terreno calculado en el servidor.
 *
 * Del mismo modelo de elevación abierto que usa el mapa 3D (Terrarium, AWS Open Data, sin clave):
 * se bajan las teselas que cubren la vista del plano, se lee la elevación en cada píxel del marco
 * (en metros UTM, la cuadrícula del plano) y se sombrea con luz del noroeste, como un mapa
 * topográfico impreso. Sale un JPEG en escala de tonos cálidos que el plano pone debajo de todo.
 *
 * Si la red falla o tarda, no hay relieve y el plano sale igual: es fondo, no dato.
 */
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import proj4 from 'proj4';

const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const UTM16 = '+proj=utm +zone=16 +datum=WGS84 +units=m +no_defs';

type Tesela = { x: number; y: number; datos: Uint8Array | null };

async function bajarTesela(z: number, x: number, y: number, ms: number): Promise<Uint8Array | null> {
  try {
    const r = await fetch(`${DEM}/${z}/${x}/${y}.png`, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const png = PNG.sync.read(Buffer.from(await r.arrayBuffer()));
    return png.width === 256 && png.height === 256 ? new Uint8Array(png.data) : null;
  } catch {
    return null;
  }
}

const aTesela = (lon: number, lat: number, z: number) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n] as const;
};

/**
 * El sombreado de la vista [xmin, ymin, xmax, ymax] (metros UTM 16N) en `ancho`×`alto` píxeles,
 * como `data:image/jpeg;base64,…`, o null si no se pudo.
 */
export async function relieveUtm(vista: [number, number, number, number], ancho: number, alto: number, opts: { ms?: number } = {}): Promise<string | null> {
  const [x1, y1, x2, y2] = vista;
  const esquinas = [
    [x1, y2],
    [x2, y2],
    [x1, y1],
    [x2, y1],
  ].map((p) => proj4(UTM16, 'EPSG:4326', p) as [number, number]);
  const lons = esquinas.map((p) => p[0]);
  const lats = esquinas.map((p) => p[1]);
  const latMedia = (Math.min(...lats) + Math.max(...lats)) / 2;
  // El zoom cuyo píxel se parece al del plano (entre 8 y 13: más fino no aporta a esta escala).
  const mPorPx = (x2 - x1) / ancho;
  const z = Math.max(8, Math.min(13, Math.round(Math.log2((156543.03 * Math.cos((latMedia * Math.PI) / 180)) / mPorPx))));
  const [tx1, ty1] = aTesela(Math.min(...lons), Math.max(...lats), z).map(Math.floor);
  const [tx2, ty2] = aTesela(Math.max(...lons), Math.min(...lats), z).map(Math.floor);
  if ((tx2 - tx1 + 1) * (ty2 - ty1 + 1) > 64) return null;
  const ms = opts.ms ?? 6000;
  const teselas: Tesela[] = [];
  for (let x = tx1; x <= tx2; x++) for (let y = ty1; y <= ty2; y++) teselas.push({ x, y, datos: null });
  await Promise.all(teselas.map(async (t) => (t.datos = await bajarTesela(z, t.x, t.y, ms))));
  if (teselas.some((t) => !t.datos)) return null;
  const mapa = new Map(teselas.map((t) => [`${t.x}/${t.y}`, t.datos!]));
  // Lectura bilineal: el píxel del plano es más fino que el del modelo, y sin interpolar se ven escalones.
  const valor = (tx: number, ty: number, px: number, py: number): number | null => {
    let x = tx;
    let y = ty;
    if (px > 255) {
      x += 1;
      px -= 256;
    }
    if (py > 255) {
      y += 1;
      py -= 256;
    }
    const d = mapa.get(`${x}/${y}`);
    if (!d) return null;
    const o = (py * 256 + px) * 4;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };
  const elev = (fx: number, fy: number) => {
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    const gx = (fx - tx) * 256 - 0.5;
    const gy = (fy - ty) * 256 - 0.5;
    const i = Math.max(0, Math.floor(gx));
    const j = Math.max(0, Math.floor(gy));
    const u = Math.min(1, Math.max(0, gx - i));
    const v = Math.min(1, Math.max(0, gy - j));
    const a = valor(tx, ty, i, j) ?? 0;
    const b = valor(tx, ty, i + 1, j) ?? a;
    const c = valor(tx, ty, i, j + 1) ?? a;
    const e = valor(tx, ty, i + 1, j + 1) ?? a;
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + e * u * v;
  };

  // Elevación en cada píxel del marco: lon/lat por interpolación bilineal de las esquinas (el área
  // de un plano es chica: el error frente a la proyección exacta es de centímetros).
  const Z = new Float32Array(ancho * alto);
  for (let j = 0; j < alto; j++) {
    const v = j / (alto - 1);
    for (let i = 0; i < ancho; i++) {
      const u = i / (ancho - 1);
      const lon = (esquinas[0][0] * (1 - u) + esquinas[1][0] * u) * (1 - v) + (esquinas[2][0] * (1 - u) + esquinas[3][0] * u) * v;
      const lat = (esquinas[0][1] * (1 - u) + esquinas[1][1] * u) * (1 - v) + (esquinas[2][1] * (1 - u) + esquinas[3][1] * u) * v;
      const [fx, fy] = aTesela(lon, lat, z);
      Z[j * ancho + i] = elev(fx, fy);
    }
  }

  // Sombreado (Horn), luz del noroeste a 45°, un poco exagerado para que se lea impreso.
  const dx = (x2 - x1) / ancho;
  const dy = (y2 - y1) / alto;
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  const exag = 1.3;
  const px = new Uint8Array(ancho * alto * 4);
  const en = (i: number, j: number) => Z[Math.min(alto - 1, Math.max(0, j)) * ancho + Math.min(ancho - 1, Math.max(0, i))];
  for (let j = 0; j < alto; j++) {
    for (let i = 0; i < ancho; i++) {
      const dzdx = ((en(i + 1, j - 1) + 2 * en(i + 1, j) + en(i + 1, j + 1)) - (en(i - 1, j - 1) + 2 * en(i - 1, j) + en(i - 1, j + 1))) / (8 * dx);
      const dzdy = ((en(i - 1, j + 1) + 2 * en(i, j + 1) + en(i + 1, j + 1)) - (en(i - 1, j - 1) + 2 * en(i, j - 1) + en(i + 1, j - 1))) / (8 * dy);
      const pend = Math.atan(exag * Math.hypot(dzdx, dzdy));
      const aspecto = Math.atan2(dzdy, -dzdx);
      const luz = Math.max(0, Math.cos(alt) * Math.cos(pend) + Math.sin(alt) * Math.sin(pend) * Math.cos(az - aspecto));
      // De sombra cálida (#8c7a64) a papel (#fbfaf6).
      const t = Math.min(1, luz * 1.05);
      const o = (j * ancho + i) * 4;
      px[o] = 140 + (251 - 140) * t;
      px[o + 1] = 122 + (250 - 122) * t;
      px[o + 2] = 100 + (246 - 100) * t;
      px[o + 3] = 255;
    }
  }
  const salida = jpeg.encode({ data: px, width: ancho, height: alto }, 82);
  return `data:image/jpeg;base64,${Buffer.from(salida.data).toString('base64')}`;
}
