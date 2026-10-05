/**
 * EL SHA DEL BUILD WEB (P5, contrato de entrega): un plugin de Vite sin dependencias que emite `dist/aura-build.json`
 * con la revisión de la que salió este build y su hora. El servidor lo lee (lib/build.ts leerBuildWeb) y lo pone en
 * /api/build: así se sabe qué web se sirve, que no siempre es la del commit del servidor (un dist viejo, un despliegue a
 * medias). Nada secreto: solo el SHA y la hora.
 *
 * La revisión: RENDER_GIT_COMMIT (Render la pone en el build) o, en local, `git rev-parse HEAD`; si ninguna, no se
 * inventa: el archivo dice `desconocido` y el manifiesto también.
 */
import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';

export function revisionDelBuild(env: NodeJS.ProcessEnv = process.env, git: () => string = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })): string {
  const deEnv = String(env.RENDER_GIT_COMMIT || '').trim();
  if (/^[0-9a-f]{7,40}$/i.test(deEnv)) return deEnv;
  try {
    const s = git().trim();
    return /^[0-9a-f]{7,40}$/i.test(s) ? s : 'desconocido';
  } catch {
    return 'desconocido';
  }
}

/**
 * La meta con el SHA en el HTML del build (evidencia de operación, 5-oct): la página sabe de qué build salió y lo dice
 * al servidor en la comprobación de sesión (src/10-infra/recepcion.ts). Va en el HTML y no en el JS a propósito: con el
 * SHA dentro del JS, cada despliegue (aunque no tocara la web) cambiaría el paquete y la lista del service worker, y la
 * web pediría «Recargar» sin motivo. La navegación va primero a la red, así que el HTML y su JS son del mismo build.
 */
export function conMetaBuild(html: string, sha: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(sha) || html.includes('name="aura-build"')) return html;
  const meta = `<meta name="aura-build" content="${sha}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => `${h}\n    ${meta}`) : html;
}

export function infoBuildWeb(): Plugin {
  // Una revisión por build: la misma en aura-build.json y en la meta de cada página.
  let sha: string | null = null;
  const revision = () => (sha ??= revisionDelBuild());
  return {
    name: 'aura-build-info',
    apply: 'build',
    transformIndexHtml(html) {
      return conMetaBuild(html, revision());
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'aura-build.json', source: JSON.stringify({ sha: revision(), hora: new Date().toISOString() }) + '\n' });
    },
  };
}
