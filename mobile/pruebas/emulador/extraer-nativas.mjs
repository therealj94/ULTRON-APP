#!/usr/bin/env node
/**
 * PARA EL EMULADOR x86_64: el AndroidManifest.xml (binario) de la APK con android:extractNativeLibs="true".
 *
 * La APK publicada trae el nativo solo para ARM (arm64-v8a, armeabi-v7a) y sin extraer (extractNativeLibs="false",
 * lo de siempre en AGP: las .so se cargan directo desde la APK). En la imagen x86_64 el ARM se traduce, pero SoLoader
 * busca entonces `base.apk!/lib/x86_64` (no existe) y la carpeta lib/arm64 está vacía: la app se cerraba al abrir con
 * «SoLoaderDSONotFoundError: couldn't find DSO to load: libreactnative.so», antes de llegar al JS (primera ejecución
 * de esta prueba, 7-oct). Con las .so extraídas a lib/arm64, SoLoader las encuentra y la traducción hace lo demás.
 *
 * SOLO para la copia de la APK que se instala en el emulador (el flujo la vuelve a firmar con una llave desechable);
 * la APK publicada no se toca. Cambia el valor en su sitio (mismo tamaño): no reconstruye nada más.
 *
 *   node extraer-nativas.mjs <AndroidManifest.xml> <salida.xml>   → imprime «cambiado», «ya-estaba» o falla (código 1)
 */
import fs from 'node:fs';

/** android.R.attr.extractNativeLibs */
export const ATTR_EXTRACT_NATIVE_LIBS = 0x010104ea;
const RES_XML_TYPE = 0x0003;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const TYPE_INT_BOOLEAN = 0x12;

/** Devuelve { buffer, estado } con extractNativeLibs=true en <application>. Lanza si la forma no es la esperada. */
export function extraerNativas(entrada) {
  const b = Buffer.from(entrada);
  if (b.readUInt16LE(0) !== RES_XML_TYPE) throw new Error('no es un XML binario de Android');
  const total = b.readUInt32LE(4);
  let ids = [];
  let encontrados = 0;
  let cambiados = 0;
  for (let p = b.readUInt16LE(2); p + 8 <= total; ) {
    const tipo = b.readUInt16LE(p);
    const cabecera = b.readUInt16LE(p + 2);
    const tam = b.readUInt32LE(p + 4);
    if (tam < 8 || p + tam > b.length) throw new Error(`trozo roto en ${p}`);
    if (tipo === RES_XML_RESOURCE_MAP_TYPE) {
      ids = [];
      for (let q = p + cabecera; q + 4 <= p + tam; q += 4) ids.push(b.readUInt32LE(q));
    } else if (tipo === RES_XML_START_ELEMENT_TYPE) {
      const ext = p + cabecera; // ResXMLTree_attrExt
      const inicio = b.readUInt16LE(ext + 8);
      const tamAttr = b.readUInt16LE(ext + 10);
      const n = b.readUInt16LE(ext + 12);
      for (let i = 0; i < n; i++) {
        const a = ext + inicio + i * tamAttr;
        const nombre = b.readUInt32LE(a + 4);
        if (ids[nombre] !== ATTR_EXTRACT_NATIVE_LIBS) continue;
        encontrados++;
        const tipoDato = b.readUInt8(a + 15);
        const dato = b.readUInt32LE(a + 16);
        if (tipoDato === TYPE_INT_BOOLEAN && dato !== 0) continue;
        b.writeUInt32LE(0xffffffff, a + 8); // rawValue: ninguno
        b.writeUInt8(TYPE_INT_BOOLEAN, a + 15);
        b.writeUInt32LE(0xffffffff, a + 16); // true
        cambiados++;
      }
    }
    p += tam;
  }
  if (!encontrados) throw new Error('el manifiesto no declara android:extractNativeLibs (ya se extraen, o no es la forma esperada)');
  return { buffer: b, estado: cambiados ? 'cambiado' : 'ya-estaba' };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [entrada, salida] = process.argv.slice(2);
  try {
    const r = extraerNativas(fs.readFileSync(entrada));
    fs.writeFileSync(salida, r.buffer);
    console.log(r.estado);
  } catch (e) {
    console.error(`extraer-nativas: ${e.message}`);
    process.exit(1);
  }
}
