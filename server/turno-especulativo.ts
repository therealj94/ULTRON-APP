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

/*
 * Revisión 9 (MENOR 2): la carrera del «sí». El teléfono abre el stream y, al entregar el oído la frase, manda POST
 * /api/turno/confirmar por otra conexión. Si el confirmar llega ANTES de que el stream registre su turno (el cupo, la
 * sesión, reclamarTurno tardan), contestaba `no-existe`, el teléfono cortaba y la frase se perdía. Ahora la decisión que
 * llega antes se guarda unos segundos por clave (acotado) y se aplica cuando el turno se abre. Solo para una clave que
 * todavía no se vio: la de un turno que ya terminó (cortado, confirmado o vencido) sigue contestando `no-existe` y no
 * se guarda (un confirmar tardío nunca confirma otro turno que reuse la clave).
 */
export const ANTICIPADA_VIVE_MS = 8_000;
const MAX_ANTICIPADAS = 500;
const anticipadas = new Map<string, { que: 'confirmar' | 'cancelar'; t: number }>();
/** Las claves que ya cerraron (para no guardar decisiones tardías de un turno que ya no está). */
const cerrados = new Map<string, number>();
const CERRADO_VIVE_MS = 60_000;

function podarMapa(m: Map<string, unknown>, vive: number, max: number, edad: (v: any) => number, ahora: number) {
  for (const [k, v] of m) {
    if (m.size <= max && ahora - edad(v) <= vive) break;
    m.delete(k);
  }
}

function anticipar(clave: string, que: 'confirmar' | 'cancelar', ahora = Date.now()) {
  anticipadas.delete(clave);
  anticipadas.set(clave, { que, t: ahora });
  podarMapa(anticipadas, ANTICIPADA_VIVE_MS, MAX_ANTICIPADAS, (v) => v.t, ahora);
}

function yaCerro(clave: string, ahora = Date.now()): boolean {
  const t = cerrados.get(clave);
  return t !== undefined && ahora - t <= CERRADO_VIVE_MS;
}

export function abrirEspeculativo(clave: string, o: { plazoMs?: number } = {}): Especulativo {
  abiertos.get(clave)?.descartar('otro turno especulativo con la misma clave');
  cerrados.delete(clave);
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
    if (abiertos.get(clave) === interno) {
      abiertos.delete(clave);
      cerrados.delete(clave);
      cerrados.set(clave, Date.now());
      podarMapa(cerrados, CERRADO_VIVE_MS, 5_000, (t) => t, Date.now());
    }
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
  // Lo que el teléfono decidió antes de que este turno se registrara (y no venció): se aplica ya.
  const antes = anticipadas.get(clave);
  anticipadas.delete(clave);
  if (antes && Date.now() - antes.t <= ANTICIPADA_VIVE_MS) {
    if (antes.que === 'confirmar') interno.confirmar();
    else interno.descartar('el teléfono lo canceló antes de que llegara');
  }
  return interno;
}

/**
 * El teléfono confirmó (la frase final es la especulada). Si su turno todavía no se registró, la confirmación queda
 * guardada unos segundos y se aplica al abrirse (`confirmado`, con `anticipada`); si ya terminó, `no-existe`.
 */
export function confirmarEspeculativo(clave: string): EstadoEspeculativo | 'no-existe' {
  return confirmarEspeculativoConDetalle(clave).estado;
}

export function confirmarEspeculativoConDetalle(clave: string): { estado: EstadoEspeculativo | 'no-existe'; anticipada?: true } {
  const e = abiertos.get(clave);
  if (e) {
    e.confirmar();
    return { estado: e.estado() };
  }
  if (yaCerro(clave)) return { estado: 'no-existe' };
  anticipar(clave, 'confirmar');
  return { estado: 'confirmado', anticipada: true };
}

/** El teléfono lo tiró (siguió hablando) o el stream se cortó antes de confirmar. Antes de abrirse, también queda guardado. */
export function descartarEspeculativo(clave: string, motivo: string): void {
  const e = abiertos.get(clave);
  if (e) return e.descartar(motivo);
  if (!yaCerro(clave)) anticipar(clave, 'cancelar');
}

/** Solo pruebas. */
export function _olvidarEspeculativos() {
  for (const e of [...abiertos.values()]) e.descartar('prueba');
  abiertos.clear();
  anticipadas.clear();
  cerrados.clear();
}

/** Cuántos esperan confirmación (pruebas y diagnóstico). */
export function especulativosAbiertos(): number {
  return abiertos.size;
}
