/**
 * EL TURNO ESPECULATIVO DE LA MESA DEL TELÉFONO (José, 6-oct: «que sea tan rápido contestar una conversación que nadie
 * note que es una IA»). El oído del teléfono decide a los ~0,3 s de silencio que la idea parece cerrada
 * (mobile/src/lib/finDeTurno.ts) pero todavía espera su silencio por si la persona sigue. En ese rato el turno ya puede
 * empezar aquí (`especulativo: true` en /api/turno/stream): preparar, pensar y escribir el texto, que el teléfono guarda
 * sin sonarlo. Lo que el turno HACE —acciones para el teléfono, memoria, herramientas, el turno de la cuenta— espera a que
 * el teléfono confirme (POST /api/turno/confirmar, con el mismo idTurno) que la frase final es esa. Si la persona siguió
 * hablando, el teléfono corta el stream: se descarta y lo retenido no corre nunca (lo anotado se deshace).
 *
 * Es la misma idea de la conversación de voz (server/voz-agente.ts, RetencionAcciones del speculative_turn de
 * ElevenLabs), con el mismo contrato para el turno: `retener`.
 */
import type { RetencionAcciones } from './voz-agente';

export type EstadoEspeculativo = 'espera' | 'confirmado' | 'descartado';

export type Especulativo = {
  /** true cuando el teléfono confirma; false si se descarta (corte, plazo vencido, otro turno con la misma clave). */
  confirmado: Promise<boolean>;
  /** Para el turno: lo que hace, guarda o deshace, según termine la especulación. */
  retener: RetencionAcciones;
  estado: () => EstadoEspeculativo;
};

/** Sin confirmación en este rato, se descarta (el oído confirma en ≤1,1 s; esto es holgura de red). */
export const PLAZO_ESPECULATIVO_MS = 8_000;
/** Tope de especulaciones abiertas a la vez en el proceso (cada una es un turno corriendo). */
const MAXIMO = 200;

type Interno = Especulativo & { confirmar: () => void; descartar: (motivo: string) => void };
const abiertos = new Map<string, Interno>();

export function abrirEspeculativo(clave: string, o: { plazoMs?: number } = {}): Especulativo {
  abiertos.get(clave)?.descartar('otro turno especulativo con la misma clave');
  if (abiertos.size >= MAXIMO) abiertos.values().next().value?.descartar('demasiados abiertos');
  let estado: EstadoEspeculativo = 'espera';
  let resolver!: (ok: boolean) => void;
  const confirmado = new Promise<boolean>((r) => (resolver = r));
  const retenidas: (() => void)[] = [];
  const deshacer: (() => void)[] = [];
  const correr = (fs: (() => void)[]) => {
    for (const f of fs.splice(0)) {
      try {
        f();
      } catch (e: any) {
        console.warn('[turno especulativo]', String(e?.message || e).slice(0, 160));
      }
    }
  };
  const plazo = setTimeout(() => interno.descartar('sin confirmación a tiempo'), o.plazoMs ?? PLAZO_ESPECULATIVO_MS);
  const cerrar = () => {
    clearTimeout(plazo);
    if (abiertos.get(clave) === interno) abiertos.delete(clave);
  };
  const interno: Interno = {
    confirmado,
    estado: () => estado,
    retener: {
      hacer: (f) => {
        if (estado === 'confirmado') correr([f]);
        else if (estado === 'espera') retenidas.push(f);
      },
      alDescartar: (f) => {
        if (estado === 'espera') deshacer.push(f);
      },
      recordar: (f) => {
        if (estado === 'confirmado') correr([f]);
        else if (estado === 'espera') retenidas.push(f);
      },
    },
    confirmar: () => {
      if (estado !== 'espera') return;
      estado = 'confirmado';
      cerrar();
      deshacer.length = 0;
      correr(retenidas);
      resolver(true);
    },
    descartar: (_motivo: string) => {
      if (estado !== 'espera') return;
      estado = 'descartado';
      cerrar();
      retenidas.length = 0;
      correr(deshacer);
      resolver(false);
    },
  };
  abiertos.set(clave, interno);
  return interno;
}

/** El teléfono confirmó (la frase final es la especulada). */
export function confirmarEspeculativo(clave: string): EstadoEspeculativo | 'no-existe' {
  const e = abiertos.get(clave);
  if (!e) return 'no-existe';
  e.confirmar();
  return e.estado();
}

/** El teléfono lo tiró (siguió hablando) o el stream se cortó antes de confirmar. */
export function descartarEspeculativo(clave: string, motivo: string): void {
  abiertos.get(clave)?.descartar(motivo);
}

/** Cuántos esperan confirmación (pruebas y diagnóstico). */
export function especulativosAbiertos(): number {
  return abiertos.size;
}
