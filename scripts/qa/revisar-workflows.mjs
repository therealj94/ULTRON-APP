#!/usr/bin/env node
/**
 * Valida los flujos de GitHub Actions ANTES de empujarlos.
 *
 * Existe por un fallo concreto: un parche dejó dos claves `env:` en el mismo paso. `yaml.safe_load`
 * y la mayoría de validadores se quedan con la última en silencio, así que la comprobación local
 * pasó; GitHub, en cambio, RECHAZA el fichero entero, y la ejecución murió en el mismo segundo en
 * que arrancó, sin un solo trabajo y sin un log que leer.
 *
 * O sea que el problema no era el YAML: era que mi validador era más permisivo que el de GitHub.
 * Este no lo es.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '.github/workflows';
let fallos = 0;

/** Claves duplicadas en un mismo mapa, por indentación. Es el caso que nos costó una ejecución. */
function duplicadas(texto, archivo) {
  const pila = new Map(); // indentación → Set de claves vistas en ese nivel
  let enBloque = 0; // dentro de un escalar literal (| o >) no hay claves que valgan
  texto.split('\n').forEach((linea, i) => {
    if (!linea.trim() || /^\s*#/.test(linea)) return;
    const sangria = linea.match(/^\s*/)[0].length;
    if (enBloque && sangria > enBloque) return;
    enBloque = 0;

    const m = linea.match(/^(\s*)(-\s+)?([A-Za-z_][\w.-]*):(\s|$)/);
    if (!m) return;
    const nivel = m[1].length + (m[2] ? m[2].length : 0);
    const clave = m[3];
    if (/:\s*[|>][-+0-9]*\s*$/.test(linea)) enBloque = sangria;

    for (const k of [...pila.keys()]) if (k > nivel) pila.delete(k);
    // Un guion abre un elemento nuevo de lista: lo que había en ese nivel ya no cuenta.
    if (m[2]) pila.delete(nivel);
    if (!pila.has(nivel)) pila.set(nivel, new Set());
    const vistas = pila.get(nivel);
    if (vistas.has(clave)) {
      console.error(`${archivo}:${i + 1}  clave repetida «${clave}» en el mismo nivel — GitHub rechaza el fichero entero`);
      fallos += 1;
    }
    vistas.add(clave);
  });
}

for (const f of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  const ruta = path.join(dir, f);
  const texto = fs.readFileSync(ruta, 'utf8');
  if (/\t/.test(texto)) {
    console.error(`${ruta}  contiene tabulaciones: YAML no las admite para sangrar`);
    fallos += 1;
  }
  duplicadas(texto, ruta);
  // Lo mínimo que GitHub exige para considerarlo un flujo.
  for (const clave of ['jobs:', 'on:']) {
    if (!new RegExp(`^${clave}`, 'm').test(texto) && !new RegExp(`^"?${clave.slice(0, -1)}"?:`, 'm').test(texto)) {
      console.error(`${ruta}  le falta «${clave}»`);
      fallos += 1;
    }
  }
  console.log(`${fallos ? '×' : '·'} ${ruta}`);
}

if (fallos) {
  console.error(`\n${fallos} problema(s). Estos flujos NO arrancan en GitHub.`);
  process.exit(1);
}
console.log('\nflujos válidos');
