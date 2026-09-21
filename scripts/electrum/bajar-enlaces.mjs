/**
 * Baja los documentos que están detrás de los accesos directos de Windows (.url).
 *
 *   node scripts/electrum/bajar-enlaces.mjs <carpeta> [destino]
 *
 * Una carpeta de trabajo real no trae solo archivos: trae atajos. En el catastro que llegó, ochenta
 * de los ficheros eran .url de 100 bytes apuntando a Google Drive —reglamentos, formularios,
 * declaraciones juradas—, y el documento de verdad se había quedado del otro lado. Copiar la
 * carpeta no copia lo que importa, y el cerebro se quedaba sin un solo expediente que citar.
 *
 * No inventa nada: si el enlace no abre sin sesión, lo dice y sigue. Lo que baja se comprueba —un
 * PDF tiene que empezar por %PDF— porque Drive responde 200 con una página de error cuando el
 * archivo es privado, y guardar eso como si fuera un expediente es peor que no tenerlo.
 */
import fs from 'node:fs';
import path from 'node:path';

const carpeta = process.argv[2];
const destino = process.argv[3] || path.join(carpeta || '.', '_documentos');
if (!carpeta) {
  console.error('Decime qué carpeta mirar.\n  node scripts/electrum/bajar-enlaces.mjs <carpeta> [destino]');
  process.exit(1);
}

/** Convierte el enlace de un atajo en la dirección que devuelve el archivo. */
export function aDescarga(url) {
  let m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (m) return { url: `https://drive.google.com/uc?export=download&id=${m[1]}`, ext: null };
  m = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/);
  if (m) return { url: `https://docs.google.com/document/d/${m[1]}/export?format=pdf`, ext: '.pdf' };
  m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (m) return { url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`, ext: '.csv' };
  m = url.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/);
  if (m) return { url: `https://docs.google.com/presentation/d/${m[1]}/export/pdf`, ext: '.pdf' };
  m = url.match(/drive\.google\.com\/open\?id=([\w-]+)/);
  if (m) return { url: `https://drive.google.com/uc?export=download&id=${m[1]}`, ext: null };
  return null;
}

/** Qué es de verdad lo que llegó, mirando los primeros bytes y no la extensión prometida. */
export function queEs(buf) {
  const cab = buf.subarray(0, 8);
  if (cab.subarray(0, 4).toString('latin1') === '%PDF') return '.pdf';
  if (cab[0] === 0x50 && cab[1] === 0x4b) return '.docx'; // zip: docx, xlsx, pptx
  const t = buf.subarray(0, 600).toString('latin1').toLowerCase();
  if (t.includes('<html') || t.includes('<!doctype html')) return null; // página de error
  return '.bin';
}

const atajos = [];
(function caminar(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) caminar(p);
    else if (/\.url$/i.test(e.name)) atajos.push(p);
  }
})(carpeta);

console.log(`${atajos.length} accesos directos encontrados.`);
fs.mkdirSync(destino, { recursive: true });

let bien = 0, privados = 0, raros = 0;
for (const [i, a] of atajos.entries()) {
  const texto = fs.readFileSync(a, 'latin1');
  const m = texto.match(/^URL=(.+)$/m);
  const nombre = path.basename(a, '.url').replace(/ - (Google Drive|Documentos de Google|Hojas de cálculo de Google).*$/i, '').trim();
  process.stdout.write(`▸ [${i + 1}/${atajos.length}] ${nombre.slice(0, 54)} … `);
  if (!m) {
    console.log('sin dirección dentro');
    raros++;
    continue;
  }
  const d = aDescarga(m[1].trim());
  if (!d) {
    console.log('no sé bajar de ahí');
    raros++;
    continue;
  }
  try {
    const r = await fetch(d.url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    const buf = Buffer.from(await r.arrayBuffer());
    const tipo = queEs(buf);
    if (!r.ok || !tipo) {
      console.log('pide sesión o es privado');
      privados++;
      continue;
    }
    /*
     * La extensión la decide lo que LLEGÓ, no lo que prometía el nombre del atajo.
     *
     * Un atajo a un documento de Google se llama «Formulario-DAC.docx - Documentos de Google», pero
     * lo que se descarga es la exportación en PDF. Guardarlo como .docx hacía que el lector
     * intentara abrir un PDF como si fuera un zip y fallara con «can't find end of central
     * directory», que no le dice nada a nadie. Veintidós documentos se quedaron fuera por eso.
     */
    const real = d.ext || tipo;
    const base = nombre.replace(/\.(pdf|docx?|xlsx?|pptx?|csv)$/i, '');
    fs.writeFileSync(path.join(destino, base + real), buf);
    console.log(`${(buf.length / 1024).toFixed(0)} KB ${tipo}`);
    bien++;
  } catch (e) {
    console.log(String(e?.message || e).slice(0, 60));
    raros++;
  }
}

console.log(`\n${bien} bajados a ${destino}${privados ? `, ${privados} piden sesión` : ''}${raros ? `, ${raros} no se pudieron` : ''}.`);
