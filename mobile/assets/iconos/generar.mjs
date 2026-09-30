/**
 * Genera los íconos de la app en PNG (blanco sobre transparente, 144 × 144: nítidos hasta 48 pt en
 * pantallas 3x) a partir de los trazos de src/ui/iconos.ts, con CanvasKit (el Skia de la web, que ya
 * viene con @shopify/react-native-skia). La app los pinta del color del tema con `tintColor`.
 *
 * ¿Por qué PNG y no un Canvas de Skia por ícono? En Android cada Canvas es una TextureView: una
 * lista de Ajustes con veinte íconos eran veinte superficies que aparecen un cuadro tarde. Una
 * imagen es una vista nativa normal, se decodifica una vez (la intro las precarga) y no parpadea.
 *
 *   node mobile/assets/iconos/generar.mjs      (desde la raíz del repo, con node_modules instalado)
 * Vuelve a escribir los PNG y src/ui/iconosPng.ts. Correrlo después de agregar un trazo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const AQUI = path.dirname(new URL(import.meta.url).pathname);
const MOVIL = path.resolve(AQUI, '../..');
const require = createRequire(path.join(MOVIL, 'package.json'));
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit.js');

const fuente = fs.readFileSync(path.join(MOVIL, 'src/ui/iconos.ts'), 'utf8');
const TRAZOS = {};
for (const m of fuente.matchAll(/^\s+([a-zA-Z]+): "([^"]+)",?$/gm)) TRAZOS[m[1]] = m[2];

const LADO = 144;
const ESCALA = LADO / 24;
const GROSOR = 2;

const CK = await CanvasKitInit({ locateFile: (f) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
const lineas = [];
for (const [nombre, d] of Object.entries(TRAZOS)) {
  const sup = CK.MakeSurface(LADO, LADO);
  const lienzo = sup.getCanvas();
  lienzo.clear(CK.TRANSPARENT);
  const p = CK.Path.MakeFromSVGString(d);
  if (!p) throw new Error(`trazo roto: ${nombre}`);
  p.transform(CK.Matrix.scaled(ESCALA, ESCALA));
  const pincel = new CK.Paint();
  pincel.setAntiAlias(true);
  pincel.setStyle(CK.PaintStyle.Stroke);
  pincel.setStrokeWidth(GROSOR * ESCALA);
  pincel.setStrokeCap(CK.StrokeCap.Round);
  pincel.setStrokeJoin(CK.StrokeJoin.Round);
  pincel.setColor(CK.WHITE);
  lienzo.drawPath(p, pincel);
  const png = sup.makeImageSnapshot().encodeToBytes();
  fs.writeFileSync(path.join(AQUI, `${nombre}.png`), png);
  lineas.push(`  ${nombre}: require('../../assets/iconos/${nombre}.png'),`);
  p.delete();
  pincel.delete();
  sup.delete();
}

fs.writeFileSync(
  path.join(MOVIL, 'src/ui/iconosPng.ts'),
  `/**
 * Los íconos en PNG (generados por assets/iconos/generar.mjs desde los trazos de iconos.ts: no se
 * editan a mano). Blancos sobre transparente; el color lo pone \`tintColor\`.
 */
import type { NombreIcono } from './iconos';

export const IMAGENES_ICONOS: Record<NombreIcono, number> = {
${lineas.join('\n')}
};
`
);
console.log(`${lineas.length} íconos`);
