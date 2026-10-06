/**
 * LAS MULETILLAS EN LA MESA: une el oído Turbo (cada trozo de 0,1 s, lib/turboMotor.ts `InfoTrozo`), quien decide
 * (lib/asentir.ts `Asentidor`) y quien hace sonar el clip con la voz del avatar por el canal de efectos
 * (lib/muletillasAudio.ts + lib/sfx.ts). Las reglas y los riesgos están en la cabecera de lib/asentir.ts y en
 * docs/adr/ADR-muletillas.md.
 *
 * Lo que hace con cada «mjm»:
 *  1. Antes de que suene, le dice al oído que ignore el tramo (su clip + la cola): no es voz, no es ruido, a Turbo le
 *     llega silencio y el rato cuenta como silencio para cerrar la frase (no la alarga).
 *  2. Lo hace sonar por el canal de efectos, bajito. Nunca por la voz de AU-RA: no pausa el micrófono, no entra en
 *     «AU-RA hablando» (ni en lib/interrupcion.ts), no queda en lo dicho.
 *  3. Si el tramo se cortó (la persona retomó encima y su voz pasó con lo que quedaba del clip), la palabra queda
 *     anotada con lo que Turbo ya había escrito en ese momento, y `limpiarFinal` la saca del texto si Turbo la escribió
 *     justo detrás (lib/asentir.ts `quitarAsentimientos`); si sonó entero sin nadie encima, a Turbo le llegó silencio y
 *     no hay nada que quitar. Un «ya» de la persona no se toca.
 *  4. Si AU-RA empieza a hablar, el clip se calla (`callar`).
 *
 * Sin React Native: el reloj, el oído y el audio se inyectan (tests/muletillas.test.ts y mobile/pruebas/muletillas).
 */
import { Asentidor, AJUSTES_ASENTIR } from './asentir';
import type { InfoTrozo } from './turboMotor';

export type DepsMuletillas = {
  /** Encendidas (el ajuste, el servidor y el teléfono: lib/asentir.ts `decidirAsentir`). */
  activo: () => boolean;
  /** El micrófono de escucha graba con el cancelador de eco activo y el oído es Turbo (el que ignora el tramo). */
  ecoCancelado: () => boolean;
  /** AU-RA habla, va a hablar o el oído está en pausa por ella. */
  auraHablando: () => boolean;
  /** La mesa no está para muletillas: silenciada, en llamada, pensando un turno, tapada… */
  silencioso: () => boolean;
  idioma: () => 'es' | 'en';
  /** Cuánto dura el clip de esa palabra con la voz del avatar de ahora; null si no hay. */
  duracion: (frase: string) => number | null;
  /** Lo hace sonar por el canal de efectos; false si no pudo. */
  sonar: (frase: string) => boolean;
  /** Calla el clip si está sonando. */
  callar?: () => void;
  /** El oído ignora lo que entra durante `ms` (0 = suelta). */
  ignorarTramo: (ms: number) => void;
  miga?: (texto: string) => void;
};

/** Pasado este rato desde que se cerró una frase sin texto, lo anotado de ella ya no limpia la siguiente. */
const OLVIDO_MS = 3_000;

export class OrquestaMuletillas {
  private readonly a: Asentidor;
  private enFrase = false;
  private cerradaEn = -Infinity;
  /** La palabra cuyo tramo suena ahora (para saber si se coló). */
  private sonando: string | null = null;
  /** Cuántas sonaron (para las pruebas y las migas). */
  dichas = 0;

  constructor(
    private readonly d: DepsMuletillas,
    ajustes: Partial<typeof AJUSTES_ASENTIR> = {}
  ) {
    this.a = new Asentidor({ activo: false, ecoCancelado: false, ajustes, duracion: (f) => d.duracion(f) });
  }

  /** Cada trozo del oído mientras la persona tiene la palabra (turboMotor `setOyenteTrozo`). */
  alTrozo(i: InfoTrozo): void {
    if (i.tramo === 'cortado' || i.tramo === 'terminado') {
      const f = this.sonando;
      this.sonando = null;
      // Sonó entero sin nadie encima: a Turbo le llegó silencio en su lugar, no hay nada que quitar después.
      if (f && i.tramo === 'terminado') this.a.noSeColo(f);
      // La persona retomó encima: lo que Turbo escriba desde aquí puede traerla, y solo eso (lo de antes, no).
      if (f && i.tramo === 'cortado') this.a.seColo(f, i.parcial, !!i.deCero);
    }
    if (i.enVoz && !this.enFrase) {
      this.enFrase = true;
      // Lo anotado de una frase que se tiró sin texto no limpia esta.
      if (i.ahora - this.cerradaEn > OLVIDO_MS) this.a.olvidarDichas();
    } else if (!i.enVoz && this.enFrase) {
      this.enFrase = false;
      this.cerradaEn = i.ahora;
      this.a.finTurno();
    }
    if (!i.enVoz) return;
    this.a.configurar({ activo: this.d.activo(), ecoCancelado: this.d.ecoCancelado(), idioma: this.d.idioma() });
    this.a.auraHablando = this.d.auraHablando();
    this.a.silencioso = this.d.silencioso() || this.sonando !== null;
    this.a.oir(i.parcial);
    const frase = this.a.trozo(i.voz, i.ahora, { clase: i.clase, cierreMs: i.cierreMs });
    if (!frase) return;
    // Primero el oído deja de tomarlo por voz; recién después suena (ni un trozo del «mjm» entra como de la persona).
    this.d.ignorarTramo(this.a.ultimoTramoMs);
    if (!this.d.sonar(frase)) {
      this.d.ignorarTramo(0);
      this.a.noSeColo(frase);
      return;
    }
    this.sonando = frase;
    this.dichas++;
    this.d.miga?.(`muletilla: «${frase}» (${this.a.ultimoTramoMs} ms)`);
  }

  /** Lo que se ve mientras habla (un parcial de Turbo), sin las muletillas que se colaron. */
  limpiarParcial(texto: string): string {
    return this.a.limpiar(texto);
  }

  /** La frase especulada (entera hasta el sondeo), sin las muletillas que se colaron (sin olvidarlas). */
  limpiarEspeculada(texto: string): string {
    return this.a.limpiarEntera(texto);
  }

  /** La frase final: sin las muletillas que se colaron (y las olvida). */
  limpiarFinal(texto: string): string {
    return this.a.quitarDelFinal(texto);
  }

  /** AU-RA empieza a hablar: el clip que suene se calla. */
  callar(): void {
    if (!this.sonando) return;
    this.d.callar?.();
  }
}
