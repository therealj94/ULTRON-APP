/**
 * LAS MANOS DE LA PC EN LA VOZ. En Windows el cerebro agrega «⟦hacer: cierra spotify⟧» cuando la persona
 * pide algo para la computadora (server/windows-rutas.ts, instruccionWindows). En el chat escrito la marca
 * llega al .exe y él la quita (Aura.Windows.Core/Acciones.cs, FiltroAcciones). En la conversación por voz
 * (agente de ElevenLabs) el texto va a la boca: la marca no puede sonar. Este filtro, igual al de C#, la
 * quita mientras llega por trozos y entrega la orden, que va al .exe por su canal (empujarOrdenPc).
 */

const ABRE = '⟦';
const CIERRA = '⟧';

/** «hacer: cierra spotify» → «cierra spotify». Solo órdenes cortas, de una línea. */
export function ordenDeMarca(marca: string): string | null {
  const m = /^(?:hacer|do)\s*:\s*([^\r\n]{2,160})$/i.exec(String(marca || '').trim());
  return m ? m[1].trim().replace(/[.!]+$/, '') : null;
}

export class FiltroOrdenes {
  private dentro = '';
  private abierto = false;
  readonly ordenes: string[] = [];

  /** Lo que se puede decir del trozo; las órdenes completas van a `alCompletar` (y a `ordenes`). */
  agregar(trozo: string, alCompletar?: (orden: string) => void): string {
    let visible = '';
    for (const c of String(trozo || '')) {
      if (!this.abierto) {
        if (c === ABRE) {
          this.abierto = true;
          this.dentro = '';
        } else visible += c;
        continue;
      }
      if (c === CIERRA) {
        this.abierto = false;
        const o = ordenDeMarca(this.dentro);
        if (o) {
          this.ordenes.push(o);
          alCompletar?.(o);
        }
        this.dentro = '';
      } else if (this.dentro.length < 300) this.dentro += c;
    }
    return visible;
  }
}

/** El texto sin ninguna marca (para el texto final del turno). */
export function quitarMarcas(texto: string): string {
  return String(texto || '')
    .replace(/⟦[^⟧]*⟧?/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}
