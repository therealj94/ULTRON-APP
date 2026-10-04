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

export function infoBuildWeb(): Plugin {
  return {
    name: 'aura-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'aura-build.json', source: JSON.stringify({ sha: revisionDelBuild(), hora: new Date().toISOString() }) + '\n' });
    },
  };
}
