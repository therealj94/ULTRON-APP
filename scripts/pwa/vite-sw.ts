/**
 * EL SERVICE WORKER DE AU-RA SALE DEL BUILD (auditoría del 3-oct, IOS02): un plugin de Vite sin dependencias.
 *
 * Al terminar el build busca la entrada de `index.html` (AU-RA), junta su JS, sus imports estáticos y su
 * CSS, y emite `sw.js` con esa lista exacta y una VERSIÓN que es la huella de la lista: cada build nuevo es
 * un worker nuevo, y el navegador lo descubre solo. Un build de Dr Electrum (sin index.html) no emite nada:
 * la PWA de AU-RA no se mezcla con la otra plataforma. La plantilla es scripts/pwa/sw-plantilla.js.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Lo fijo del shell (public/): el manifest y los iconos del icono instalado. */
const FIJOS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon.png', '/apple-touch-icon.png', '/favicon.png'];

type Trozo = { type: 'chunk' | 'asset'; fileName: string; isEntry?: boolean; facadeModuleId?: string | null; imports?: string[]; viteMetadata?: { importedCss?: Set<string> } };

/** La lista del shell de AU-RA en este bundle, o null si el build no trae index.html (Dr Electrum). */
export function listaPrecache(bundle: Record<string, Trozo>): string[] | null {
  const entrada = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry && /(^|[\\/])index\.html$/.test(String(c.facadeModuleId || '')));
  if (!entrada) return null;
  const archivos = new Set<string>();
  const visitar = (nombre: string) => {
    const c = bundle[nombre];
    if (!c || archivos.has(nombre)) return;
    archivos.add(nombre);
    if (c.type !== 'chunk') return;
    for (const css of c.viteMetadata?.importedCss || []) archivos.add(css);
    for (const i of c.imports || []) visitar(i);
  };
  visitar(entrada.fileName);
  return [...FIJOS, ...[...archivos].sort().map((f) => `/${f}`)];
}

/** El sw.js listo: la plantilla con su versión (huella de la lista) y la lista. */
export function armarSw(plantilla: string, precache: string[]): string {
  const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 16);
  return plantilla.replace("'__AURA_VERSION__'", JSON.stringify(version)).replace('__AURA_PRECACHE__', JSON.stringify(precache));
}

export function swAura(): Plugin {
  return {
    name: 'aura-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opciones, bundle) {
      const lista = listaPrecache(bundle as unknown as Record<string, Trozo>);
      if (!lista) return;
      const plantilla = fs.readFileSync(path.join(__dirname, 'sw-plantilla.js'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: armarSw(plantilla, lista) });
    },
  };
}
