/**
 * LO OPCIONAL DEL TURNO HABLADO, CON UN SOLO PLAZO (auditoría VOZ-04; José, 6-oct: «que sea tan rápido contestar una
 * conversación que nadie note que es una IA»).
 *
 * Antes cada paso que espera a la base o a la red para ENRIQUECER el turno (memoria, hilo, lo limitado, tarea en curso,
 * iniciativa, fichas, significado) tenía su propio tope de 300 ms (TOPE_PASO_VOZ_MS) y se esperaban uno detrás de otro:
 * cuatro sin resolver consumían 1,2 s antes de la primera palabra. Ahora hay UN plazo desde que empieza el turno
 * (TOPE_ENRIQUECER_VOZ_MS) y cada paso espera solo lo que queda; lo que ya llegó se usa aunque el plazo se haya acabado,
 * y lo que no, se deja con su respaldo (sigue en segundo plano y el turno siguiente lo encuentra en la caché: las
 * lecturas son las mismas, nada se pide dos veces en el mismo turno).
 *
 * Solo para lo OPCIONAL. Quién habla, los permisos, las decisiones («sí» a un borrador) y qué de lo suyo se puede
 * leer (lo limitado: sin saberlo a tiempo, lo suyo NO entra; server/contexto-turno.ts) no son enriquecimiento: fallan
 * cerrados por su cuenta. Y nada que escriba se corre en paralelo para ganar tiempo.
 */

/** El tope de antes, por paso (lo siguen usando los datos pedidos explícitamente: precios, taller). */
export const TOPE_PASO_VOZ_MS = 300;
/**
 * El plazo común para todo lo opcional del turno hablado, desde que empieza. Medido el 6-oct: «preparado» 9–24 ms de
 * mediana (máx. 721): casi siempre todo llega mucho antes; esto es el techo del peor caso. AURA_VOZ_ENRIQUECER_MS lo
 * cambia.
 */
export const TOPE_ENRIQUECER_VOZ_MS = 400;

type Reloj = { ahora: () => number; setTimeout: (f: () => void, ms: number) => unknown; clearTimeout: (t: any) => void };
const RELOJ: Reloj = { ahora: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };

export type PlazoEnriquecer = {
  /**
   * `p`, o `respaldo` si no llega en lo que queda del plazo (o falla). Escrito (no hablado): `p` tal cual, con sus
   * errores. `sinEspera`: solo si ya estaba listo (la iniciativa en una charla simple no hace esperar a nadie).
   */
  aTiempo<T, R = T>(paso: string, p: Promise<T>, respaldo: R, o?: { sinEspera?: boolean }): Promise<T | R>;
  /** Lo que queda del plazo, en ms. */
  restante(): number;
  /** Los pasos que no llegaron a tiempo (para una sola línea en el log). */
  vencidos(): string[];
};

export function plazoDeEnriquecer(voz: boolean, o: { totalMs?: number; reloj?: Reloj } = {}): PlazoEnriquecer {
  const reloj = o.reloj || RELOJ;
  const total = o.totalMs ?? Number(process.env.AURA_VOZ_ENRIQUECER_MS || TOPE_ENRIQUECER_VOZ_MS);
  const limite = reloj.ahora() + total;
  const vencidos: string[] = [];
  const restante = () => Math.max(0, limite - reloj.ahora());
  return {
    restante,
    vencidos: () => [...vencidos],
    aTiempo<T, R = T>(paso: string, p: Promise<T>, respaldo: R, op: { sinEspera?: boolean } = {}): Promise<T | R> {
      if (!voz) return p;
      let llego = false;
      const seguro = p.then(
        (v) => ((llego = true), v),
        () => ((llego = true), respaldo)
      );
      const ms = op.sinEspera ? 0 : restante();
      let t: unknown;
      // Con 0 ms: si `p` ya llegó gana igual (Promise.race toma al primero ya resuelto, en orden).
      const tope = new Promise<R>((r) => {
        const vence = () => {
          if (llego) return;
          vencidos.push(paso);
          r(respaldo);
        };
        if (ms <= 0) void Promise.resolve().then(() => Promise.resolve()).then(vence);
        else t = reloj.setTimeout(vence, ms);
      });
      return Promise.race<T | R>([seguro, tope]).finally(() => {
        if (t !== undefined) reloj.clearTimeout(t);
      });
    },
  };
}
