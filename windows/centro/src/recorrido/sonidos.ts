/**
 * Los sonidos del recorrido: los mismos archivos del teléfono (mobile/assets/sfx, recorrido y llamada),
 * copiados por build.mjs a recorrido/sonidos. Cada uno con su volumen; se cargan al abrir el recorrido y
 * se sueltan al cerrarlo. El botón de sonido del recorrido apaga la voz y estos efectos juntos.
 */
import type { SonidoId } from './coreografia';

const FUENTES: Record<SonidoId, { archivo: string; volumen: number }> = {
  whoosh: { archivo: 'whoosh.mp3', volumen: 0.35 },
  tap: { archivo: 'tap.mp3', volumen: 0.45 },
  timbre: { archivo: 'timbre.wav', volumen: 0.4 },
  chispa: { archivo: 'chispa.wav', volumen: 0.4 },
  capitulo: { archivo: 'capitulo.wav', volumen: 0.5 },
  teclado: { archivo: 'teclado.mp3', volumen: 0.4 },
  papel: { archivo: 'papel.mp3', volumen: 0.45 },
};

export const archivoSonido = (s: SonidoId) => `recorrido/sonidos/${FUENTES[s].archivo}`;

export type Sonidos = { sonar(s: SonidoId): void; callar(): void; activos: boolean };

export function sonidosRecorrido(): Sonidos {
  const cargados = new Map<SonidoId, HTMLAudioElement>();
  for (const k of Object.keys(FUENTES) as SonidoId[]) {
    const a = new Audio(archivoSonido(k));
    a.preload = 'auto';
    a.volume = FUENTES[k].volumen;
    cargados.set(k, a);
  }
  const s: Sonidos = {
    activos: true,
    sonar(id) {
      if (!s.activos) return;
      const a = cargados.get(id);
      if (!a) return;
      try {
        a.currentTime = 0;
        void a.play().catch(() => {});
      } catch {
        /* sin ese sonido, la escena sigue igual */
      }
    },
    callar() {
      for (const a of cargados.values()) a.pause();
    },
  };
  return s;
}
