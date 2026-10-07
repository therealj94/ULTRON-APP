/**
 * LAS HOJAS QUE SE ABREN DESDE CUALQUIER PANTALLA: la vista en vivo de su computadora y sus correos. Las
 * dibuja una sola vez la raíz (app/ComputadoraEnVivo.tsx, dentro de AppAura) encima de la pantalla que
 * esté (son Modal): así «abre tu computadora» dicho en Ajustes, en los chats o en la mesa la abre igual,
 * y una tarea que empieza la abre sola (José, 2-oct).
 *
 * También lo de AURA (José, 2-oct: «que me proponga, que quiera cumplir misiones, que me conozca»): sus
 * misiones, lo que sabe de ti (con lo que quedó a medias) y tu círculo. Las dibuja app/HojasCerebro.tsx,
 * dentro de la misma raíz; se abren desde el menú de la mesa, desde Ajustes o con «abrir».
 *
 * Sin React Native: un dato de módulo con oyentes (useSyncExternalStore en la vista).
 */
/** `agenda`: «Hoy», su calendario (agenda/HojaHoy.tsx). */
export type HojaGlobal = 'computadora' | 'correos' | 'misiones' | 'conocer' | 'circulo' | 'agenda';
type EstadoHojas = { abierta: HojaGlobal | null; tareaId: string | null };

let estado: EstadoHojas = { abierta: null, tareaId: null };
const oyentes = new Set<() => void>();
let anfitriones = 0;

function fijar(e: EstadoHojas) {
  estado = e;
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* un oyente roto no rompe nada */
    }
  }
}

/** Abre una hoja; con `tareaId`, la vista de la computadora sigue esa tarea. */
export function abrirHoja(h: HojaGlobal, o: { tareaId?: string | null } = {}) {
  fijar({ abierta: h, tareaId: o.tareaId ?? (h === 'computadora' ? estado.tareaId : null) });
}

export function cerrarHoja() {
  if (estado.abierta) fijar({ ...estado, abierta: null });
}

export function hojasAhora(): EstadoHojas {
  return estado;
}

export function suscribirHojas(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** La raíz que las dibuja se anuncia; sin ella (una pantalla suelta), cada pantalla dibuja la suya. */
export function anunciarAnfitrion(): () => void {
  anfitriones++;
  return () => {
    anfitriones = Math.max(0, anfitriones - 1);
  };
}

export function hayAnfitrion(): boolean {
  return anfitriones > 0;
}
