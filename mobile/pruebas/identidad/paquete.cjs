// El paquete de las pruebas de identidad (out/identidad.cjs), nunca viejo.
//
// todas.sh (y la CI, calidad-movil.yml) lo construye antes de correr; pero `node ota.cjs` a secas corría contra el que
// hubiera en out/ —que no se sube al repo (mobile/.gitignore)— y un paquete de antes daba fallos que no eran del código
// (revisión 7.5). Si falta o es más viejo que el código (mobile/src, los shims o construir.cjs), se reconstruye aquí.
// Con IDENTIDAD=/ruta/otro-paquete.cjs se usa ese tal cual (ver construir.cjs).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SALIDA = path.join(__dirname, 'out/identidad.cjs');
const FUENTES = [path.join(__dirname, '../../src'), path.join(__dirname, 'shims'), path.join(__dirname, '../chat/shims'), path.join(__dirname, 'construir.cjs')];

/** La fecha del archivo más nuevo de `p` (recorre carpetas; sin node_modules). */
function masNuevo(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.mtimeMs;
  let m = 0;
  for (const n of fs.readdirSync(p)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    m = Math.max(m, masNuevo(path.join(p, n)));
  }
  return m;
}

module.exports = function paquete() {
  if (process.env.IDENTIDAD) return require(process.env.IDENTIDAD);
  let hecho = 0;
  try {
    hecho = fs.statSync(SALIDA).mtimeMs;
  } catch {
    /* no está: se construye */
  }
  if (!hecho || FUENTES.some((f) => masNuevo(f) > hecho)) execFileSync(process.execPath, [path.join(__dirname, 'construir.cjs')], { stdio: 'inherit' });
  return require(SALIDA);
};
