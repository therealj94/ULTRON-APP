/**
 * LA BARRERA DE LA ACTUALIZACIÓN POR AIRE: cuándo NO recargar la app.
 *
 * La OTA descargada se aplica al volver a la app tras un rato fuera (lib/ota.ts). Recargar es tirar el
 * JS vivo: una llamada en curso se corta, un borrador del chat que solo vive en memoria se pierde, la
 * conversación con AURA se cae. Antes el único criterio era el tiempo fuera; ahora, además, que no
 * haya trabajo activo. Si lo hay, se pospone (la próxima vuelta, o el siguiente arranque en frío).
 *
 * Cada frente registra cómo saber si tiene algo entre manos (`registrarTrabajoActivo`): los borradores
 * del chat, la llamada de un recordatorio sonando. La llamada de PULSE2CHAT y la conversación con AURA
 * se saben por el bus del contrato. Un comprobador que falla cuenta como ocupado: ante la duda, no se
 * recarga.
 *
 * Sin React ni nada nativo: lo prueban las pruebas en node.
 */
import { escuchar } from '../nucleo/contrato';

/** Fuera al menos esto = «la volvió a abrir». Menos es mirar un mensaje y regresar. */
export const FUERA_PARA_APLICAR_MS = 10 * 60_000;

const trabajos = new Map<string, () => boolean>();
let llamadaActiva = false;
let vozOcupada = false;

escuchar('llamada', (e) => {
  llamadaActiva = !!e?.activa;
});
escuchar('voz', (e) => {
  vozOcupada = !e?.libre;
});

/** Un frente dice cómo saber si tiene trabajo activo. Devuelve cómo borrarse. */
export function registrarTrabajoActivo(nombre: string, activo: () => boolean): () => void {
  trabajos.set(nombre, activo);
  return () => {
    if (trabajos.get(nombre) === activo) trabajos.delete(nombre);
  };
}

/** Por qué no se debe recargar ahora (vacío = se puede). */
export function motivosParaNoRecargar(): string[] {
  const m: string[] = [];
  if (llamadaActiva) m.push('llamada');
  if (vozOcupada) m.push('voz');
  for (const [nombre, activo] of trabajos) {
    let ocupado = true;
    try {
      ocupado = !!activo();
    } catch {
      /* ante la duda, ocupado */
    }
    if (ocupado) m.push(nombre);
  }
  return m;
}

/**
 * Qué hacer al volver a la app: `aplicar` la OTA descargada, `posponer` (hay una, pero hay trabajo
 * activo) o `nada` (no hay, o volvió demasiado pronto).
 */
export function decidirAlVolver(o: { pendiente: boolean; fueraMs: number; motivos?: string[] }): 'aplicar' | 'posponer' | 'nada' {
  if (!o.pendiente || o.fueraMs < FUERA_PARA_APLICAR_MS) return 'nada';
  return (o.motivos ?? motivosParaNoRecargar()).length ? 'posponer' : 'aplicar';
}

/** Solo pruebas. */
export function _reiniciarBarreraOta() {
  trabajos.clear();
  llamadaActiva = false;
  vozOcupada = false;
}
