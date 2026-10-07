/**
 * CUÁNDO SE PUEDE PEDIR LA HUELLA PARA RENOVAR LA SESIÓN (revisión previa a fusionar #157). Con la clave detrás de la
 * huella (lib/credsSeguras.ts), cada 401 podía sacar el diálogo del sistema: también lo de fondo (las muletillas que se
 * precargan, un sondeo), y tras cancelar volvía a salir enseguida. Las reglas:
 *   · solo con la app DELANTE y para algo que la persona espera ahora: un turno, la voz de una respuesta, el oído;
 *   · lo de fondo o lo que se adelanta no pregunta: falla callado y espera (la próxima petición que sí cuenta pregunta);
 *   · si la persona cancela, no se vuelve a preguntar en 10 minutos (salvo que toque «Toca para desbloquear»);
 *   · un solo diálogo a la vez: los 401 que llegan juntos comparten el mismo (lib/api.ts renovarSesion).
 * Cuando hace falta la huella y no se pudo preguntar (o se canceló), queda `pendiente`: la app enseña «Toca para
 * desbloquear» (src/components/AvisoDesbloqueo.tsx) en vez de dejar a la persona con un token muerto sin decírselo.
 *
 * Sin nada nativo más que AppState: lo prueba pruebas/identidad/huella.cjs.
 */
import { AppState } from 'react-native';

/** Tras cancelar la huella, cuánto se espera antes de volver a pedirla sola. */
export const PAUSA_TRAS_CANCELAR_MS = 10 * 60_000;

/** Lo que la persona espera AHORA (un turno, el oído, la voz que se pide por api()): ahí sí se puede preguntar. */
const RUTAS_DE_LA_PERSONA = [/^\/api\/turno(\/|$|\?)/, /^\/api\/stt(\/|$|\?)/, /^\/api\/tts(\/|$|\?)/, /^\/api\/voz\/agente(\/|$|\?)/, /^\/api\/cantar(\/|$|\?)/, /^\/api\/orar(\/|$|\?)/];
/** Lo que se adelanta aunque la ruta sea de la persona (un permiso del oído para después, la confirmación de fondo). */
const RUTAS_DE_FONDO = [/^\/api\/turno\/confirmar/];

export function esRutaDeLaPersona(ruta: string): boolean {
  const r = String(ruta || '');
  return RUTAS_DE_LA_PERSONA.some((x) => x.test(r)) && !RUTAS_DE_FONDO.some((x) => x.test(r));
}

let primerPlano: () => boolean = () => AppState.currentState === 'active';
let pausaHasta = 0;
let pendiente = false;
const oyentes = new Set<(p: boolean) => void>();

/** Solo pruebas: otra forma de saber si la app está delante. */
export function _fijarPrimerPlano(f: (() => boolean) | null) {
  primerPlano = f || (() => AppState.currentState === 'active');
}

/** Solo pruebas: todo como al abrir. */
export function _reiniciarPermisoHuella() {
  pausaHasta = 0;
  fijarPendiente(false);
}

/** ¿Se puede sacar el diálogo de la huella para esta petición? (`forzar`: la persona tocó «Toca para desbloquear») */
export function puedePedirHuella(deLaPersona: boolean, o: { forzar?: boolean; ahora?: number } = {}): boolean {
  let delante = false;
  try {
    delante = primerPlano();
  } catch {
    delante = false;
  }
  if (!delante) return false;
  if (o.forzar) return true;
  return deLaPersona && (o.ahora ?? Date.now()) >= pausaHasta;
}

/** La persona canceló (o el sistema no soltó la clave): 10 minutos sin preguntar solo. */
export function huellaCancelada(ahora = Date.now()) {
  pausaHasta = ahora + PAUSA_TRAS_CANCELAR_MS;
  fijarPendiente(true);
}

/** La huella soltó la clave, o la sesión se renovó: se puede volver a preguntar y ya no hay nada pendiente. */
export function huellaResuelta() {
  pausaHasta = 0;
  fijarPendiente(false);
}

/** Hace falta la huella y no se pudo preguntar ahora (de fondo, o en pausa). */
export function faltaHuella() {
  fijarPendiente(true);
}

export function enPausaHasta(): number {
  return pausaHasta;
}

export function desbloqueoPendiente(): boolean {
  return pendiente;
}

export function escucharDesbloqueo(f: (pendiente: boolean) => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

function fijarPendiente(p: boolean) {
  if (pendiente === p) return;
  pendiente = p;
  for (const f of [...oyentes]) {
    try {
      f(p);
    } catch {
      /* un oyente roto no frena a los demás */
    }
  }
}
