/**
 * EL MANIFIESTO DE ESTA COMPILACIÓN (documento maestro del 3-oct, AUR16 / gate G0): qué revisión corre, en qué
 * servicio, con qué contratos y con qué banderas, para que una prueba o un reporte se pueda atribuir a un build
 * concreto. El /api/health público solo dice el commit corto; esto va detrás de la sesión de mesa.
 *
 * Nada secreto: ni llaves, ni direcciones de nodos, ni cuántas personas hay. Solo nombres, versiones y si una
 * capacidad está configurada (configurada ≠ verificada de punta a punta: eso lo acreditan las pruebas).
 */
import { almacenDurable } from './durable';
import { pushConfigurado } from './push';
import { pushWebConfigurado } from './push-web';

/** Versiones de los contratos entre piezas; se suben cuando cambia la forma de lo que viaja. */
export const CONTRATOS = {
  /** Entradas al escritorio remoto: secuencia, época, viewport, ACK (AUR09). */
  entradaRemota: 1,
  /** Permiso ligado a la operación exacta y parada en tres estados (AUR02/AUR03). */
  computadora: 3,
  /** Turnos y operaciones durables con lease y fencing (AUR06). */
  durable: 1,
  /** Recibos tipados de herramientas (AUR07). */
  recibos: 1,
} as const;

export type ManifiestoBuild = {
  commit: string | null;
  servicio: string | null;
  plataforma: 'aura' | 'electrum';
  arrancoEn: string;
  node: string;
  contratos: typeof CONTRATOS;
  durable: { tipo: string; multiReplica: boolean };
  banderas: Record<string, boolean>;
};

const ARRANQUE = new Date().toISOString();

export function manifiestoBuild(o: { plataforma: 'aura' | 'electrum'; banderas?: Record<string, boolean> }, env: NodeJS.ProcessEnv = process.env): ManifiestoBuild {
  const a = almacenDurable();
  return {
    commit: String(env.RENDER_GIT_COMMIT || '').trim() || null,
    servicio: String(env.RENDER_SERVICE_NAME || '').trim() || null,
    plataforma: o.plataforma,
    arrancoEn: ARRANQUE,
    node: process.version,
    contratos: CONTRATOS,
    durable: { tipo: a.tipo, multiReplica: a.multiReplica },
    banderas: {
      push: pushConfigurado(),
      pushWeb: pushWebConfigurado(),
      serviceWorker: String(env.AURA_SW ?? '1').trim() !== '0',
      ...(o.banderas || {}),
    },
  };
}
