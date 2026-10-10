/**
 * «LLÁMAME» DESDE LA BURBUJA (APK 5.7.1): la llamada suena en la APP, también si la app no se había abierto.
 *
 * La llamada del avatar vive en la app entera (compa/VozProvider.tsx: el ciclo de la llamada, el timbre, la sesión de
 * ElevenLabs); la burbuja no la tiene. Con la app abierta detrás, el «llámame» que resolvió el servidor llegaba por el
 * canal de acciones (SSE) a su VozProvider, que la hacía sonar y traía la app delante (compa/fondoLlamada.ts
 * `comoAtenderLlamame`, «sonar-y-traer»). Con la app NUNCA abierta (la burbuja arrancó el motor de JS ella sola) no hay
 * VozProvider ni canal: el «llámame» no hacía nada.
 *
 * Ahora la burbuja lo atiende ella misma cuando llega en las acciones de SU turno:
 *  · lo deja en este buzón (el motor de JS es el mismo para la burbuja y la app: BurbujaActivity y MainActivity
 *    comparten el ReactHost), abre la app con el enlace de siempre (`ultronfp://hablar?origen=burbuja`, el de
 *    «Abrir en AURA») y se cierra;
 *  · el VozProvider de la app lo toma al montarse (en frío: la app se acaba de abrir por ese enlace) o en el acto (en
 *    caliente) y la llamada SUENA en la app, con la ventana propia de la guardia del segundo plano;
 *  · las dos vías no se pisan: la acción lleva su id y `accionNueva` (compa/acciones.ts) la deja pasar UNA vez, por la
 *    que llegue primero (el turno de la burbuja o el SSE de la app de atrás).
 *
 * Puro (sin React Native): se prueba en Node (tests/pulido-571-movil.test.ts).
 */

/** Un «llámame» que espera a la app deja de valer pasado esto (no suena una llamada minutos después). */
export const VIGENCIA_LLAMAME_MS = 60_000;

export class BuzonLlamame {
  private desde = 0;
  private oyentes = new Set<() => void>();

  pedir(ahora: number): void {
    this.desde = ahora;
    for (const f of [...this.oyentes]) f();
  }

  /** ¿Hay uno vigente? No lo consume. */
  pendiente(ahora: number): boolean {
    if (this.desde && ahora - this.desde > VIGENCIA_LLAMAME_MS) this.desde = 0;
    return this.desde > 0;
  }

  /** Lo consume quien lo atiende (el VozProvider de la app). */
  tomar(ahora: number): boolean {
    const hay = this.pendiente(ahora);
    this.desde = 0;
    return hay;
  }

  escuchar(f: () => void): () => void {
    this.oyentes.add(f);
    return () => {
      this.oyentes.delete(f);
    };
  }
}

/** El de la app (un solo motor de JS: lo comparten la burbuja y el VozProvider). */
export const buzonLlamame = new BuzonLlamame();

/** ¿Es un «llámame»? (la acción sola o `{ id, accion }`). */
export function esLlamame(x: unknown): boolean {
  const a = x && typeof x === 'object' && 'accion' in x ? (x as { accion: unknown }).accion : x;
  return !!a && typeof a === 'object' && (a as { tipo?: unknown }).tipo === 'llamame';
}

/**
 * ¿Las acciones del turno traen un «llámame» NUEVO? (`nueva` es compa/acciones.ts `accionNueva`: si la app de atrás ya
 * lo atendió por su canal con el mismo id, no se atiende otra vez).
 */
export function llamameDelTurno(lista: unknown, nueva: (id: string | null, accion: unknown) => boolean): boolean {
  if (!Array.isArray(lista)) return false;
  let hay = false;
  for (const x of lista) {
    if (!esLlamame(x)) continue;
    const envuelta = !!x && typeof x === 'object' && 'accion' in (x as object);
    const accion = envuelta ? (x as { accion: unknown }).accion : x;
    const id = envuelta ? String((x as { id?: unknown }).id || '') || null : null;
    if (nueva(id, accion)) hay = true;
  }
  return hay;
}
