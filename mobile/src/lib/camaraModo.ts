/**
 * LA CÁMARA DE LA MESA: APAGADA POR OMISIÓN, y se enciende cuando la persona quiere que la vea.
 *
 * Hasta 4.7.0 la cámara arrancaba encendida siempre: una foto cada ~330 ms con alguien delante (JPEG
 * + disco + ML Kit en el mismo teléfono que oye, piensa y dibuja al avatar en 3D) y, cada 20 s, esa
 * foto subida al servidor. José lo notó como «no es fluido». Ahora:
 *
 *  · apagada al entrar, siempre, salvo que la persona haya elegido «siempre» (se guarda por persona,
 *    por correo, y se puede quitar);
 *  · se enciende con el botón (hoja «Más» → Cámara) o por voz («puedes verme», «mírame», «enciende la
 *    cámara»), y se pregunta si es SOLO AHORA o SIEMPRE;
 *  · «solo ahora» se apaga sola a los `TEMPORAL_MS` o al salir de la mesa;
 *  · «apaga la cámara», «deja de verme», «ya no me veas» la apagan (y quitan el «siempre» si lo había,
 *    solo si lo pide: «no me veas nunca»).
 *
 * Sin React Native: se prueba en Node.
 */

export type ModoCamara = 'apagada' | 'temporal' | 'siempre';

/*
 * EL RITMO DE LA CÁMARA ENCENDIDA (lo usa components/CamaraVision.tsx; aquí para medirlo en Node).
 * Con ML Kit: una foto cada tanto según haya alguien delante, y de vez en cuando esa foto al servidor.
 */
/** Con ML Kit: cada cuánto se busca cara, según haya alguien, no haya nadie o esté dormida. */
export const LOCAL_CON_PERSONA_MS = 330;
export const LOCAL_SIN_PERSONA_MS = 1000;
export const LOCAL_DORMIDA_MS = 2500;
/**
 * José, 6-oct (Samsung SM-S942B): con la cámara y las caras «se queda atrasado con la voz». Mientras la mesa PIENSA o
 * HABLA (un turno en vuelo, su voz sonando) y la vista «Lo que veo» está cerrada, la cámara afloja: una foto cada
 * `LOCAL_OCUPADA_MS` (los ojos siguen a la persona, más tranquilos) y sin reconocer caras (salvo a quien llega:
 * caras/seguimiento.ts tocaReconocer). Con todos los de delante ya reconocidos y la vista cerrada, `LOCAL_IDENTIFICADA_MS`.
 * Con la vista abierta la persona está mirando los recuadros: el ritmo de siempre.
 */
export const LOCAL_OCUPADA_MS = 800;
export const LOCAL_IDENTIFICADA_MS = 500;

/** Cada cuánto una foto del bucle con ML Kit (components/CamaraVision.tsx). */
export function ritmoFotos(o: { dormida: boolean; conPersona: boolean; vista: boolean; ocupada: boolean; identificados: boolean }): number {
  if (o.dormida) return LOCAL_DORMIDA_MS;
  if (!o.conPersona) return LOCAL_SIN_PERSONA_MS;
  if (o.vista) return LOCAL_CON_PERSONA_MS;
  if (o.ocupada) return LOCAL_OCUPADA_MS;
  if (o.identificados) return LOCAL_IDENTIFICADA_MS;
  return LOCAL_CON_PERSONA_MS;
}
/**
 * Con ML Kit: cada cuánto se le pregunta al servidor qué hay en la mesa, como MÁXIMO. Desde la mejora de
 * la cámara la subida real la decide lib/vistaCamara.ts (intervaloServidor): ninguna sin «Comenta lo que
 * ve», y más espaciada si la escena no cambia. `trabajoPorMinuto` da el peor caso.
 */
export const SERVIDOR_CON_PERSONA_MS = 20_000;
export const SERVIDOR_SIN_PERSONA_MS = 60_000;

/** Lo que hace la cámara en un minuto: fotos tomadas en el teléfono y fotos subidas al servidor. */
export function trabajoPorMinuto(o: { encendida: boolean; conPersona: boolean }): { fotos: number; subidas: number } {
  if (!o.encendida) return { fotos: 0, subidas: 0 };
  const cada = o.conPersona ? LOCAL_CON_PERSONA_MS : LOCAL_SIN_PERSONA_MS;
  const subir = o.conPersona ? SERVIDOR_CON_PERSONA_MS : SERVIDOR_SIN_PERSONA_MS;
  return { fotos: Math.round((60_000 / cada) * 10) / 10, subidas: Math.round((60_000 / subir) * 10) / 10 };
}

/** «Solo ahora» dura esto (o hasta salir de la mesa). */
export const TEMPORAL_MS = 10 * 60_000;

export type EstadoCamara = { modo: ModoCamara; hasta: number };

const correoNormal = (c: string) => String(c || '').trim().toLowerCase();

/** ¿Esta persona eligió «siempre»? (el mapa guardado en los ajustes, por correo). */
export function prefiereSiempre(mapa: Record<string, boolean> | undefined, correo: string): boolean {
  return !!mapa?.[correoNormal(correo)];
}

/** El mapa con la preferencia de esta persona puesta o quitada (las de las demás, intactas). */
export function conPreferencia(mapa: Record<string, boolean> | undefined, correo: string, siempre: boolean): Record<string, boolean> {
  const c = correoNormal(correo);
  const n = { ...(mapa || {}) };
  if (!c) return n;
  if (siempre) n[c] = true;
  else delete n[c];
  return n;
}

export class ControlCamara {
  private e: EstadoCamara = { modo: 'apagada', hasta: 0 };
  private oyentes = new Set<(e: EstadoCamara) => void>();

  constructor(private reloj: () => number = Date.now, private temporalMs = TEMPORAL_MS) {}

  estado(): EstadoCamara {
    return this.e;
  }

  encendida(): boolean {
    return this.e.modo !== 'apagada';
  }

  suscribir(f: (e: EstadoCamara) => void): () => void {
    this.oyentes.add(f);
    return () => void this.oyentes.delete(f);
  }

  private poner(e: EstadoCamara) {
    if (e.modo === this.e.modo && e.hasta === this.e.hasta) return;
    this.e = e;
    for (const f of [...this.oyentes]) f(e);
  }

  /** Al entrar a la mesa: encendida solo si esta persona eligió «siempre». */
  arrancar(siempre: boolean) {
    this.poner(siempre ? { modo: 'siempre', hasta: 0 } : { modo: 'apagada', hasta: 0 });
  }

  encender(modo: 'temporal' | 'siempre') {
    this.poner(modo === 'siempre' ? { modo, hasta: 0 } : { modo, hasta: this.reloj() + this.temporalMs });
  }

  apagar() {
    this.poner({ modo: 'apagada', hasta: 0 });
  }

  /** El reloj: «solo ahora» vencido → apagada. Devuelve true si la apagó. */
  tic(): boolean {
    if (this.e.modo === 'temporal' && this.reloj() >= this.e.hasta) {
      this.apagar();
      return true;
    }
    return false;
  }

  /** Salió de la mesa (los chats, Ajustes encima): «solo ahora» se apaga; «siempre» se pausa solo mientras no se ve. */
  alSalirDeLaMesa(): boolean {
    if (this.e.modo !== 'temporal') return false;
    this.apagar();
    return true;
  }
}

/* ── por voz ─────────────────────────────────────────────────────────────────────────────── */

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * ¿Pide que la vea, o que deje de verla? null si no habla de la cámara. «Qué ves» no es encenderla:
 * ese camino ya existe (con la cámara apagada, dice que no ve y ofrece encenderla).
 */
export function pedidoDeCamara(texto: string): 'encender' | 'apagar' | 'apagar_siempre' | null {
  const t = sinTildes(texto);
  if (/\b(no me (veas|mires) (nunca|mas)|nunca (me )?(veas|mires)|quita(le)? (lo de )?siempre (a )?la camara)\b/.test(t)) return 'apagar_siempre';
  if (/\b(apaga|cierra|desactiva|quita) (la )?camara\b|\b(deja|dejes) de (verme|mirarme)\b|\bya no me (veas|mires)\b|\bno me (veas|mires)\b/.test(t)) return 'apagar';
  if (/\b(enciende|prende|abre|activa|pon) (la )?camara\b|\bpuedes verme\b|\bmirame\b|\bveme\b|\bmira(me)? (aqui|esto)\b|\bquiero que me veas\b|\bte dejo verme\b|\bpuedes mirarme\b/.test(t)) return 'encender';
  if (/\b(turn on|open) (the )?camera\b|\b(can you|you can) see me\b|\blook at me\b/.test(t)) return 'encender';
  if (/\b(turn off|close) (the )?camera\b|\bstop (looking at|watching) me\b/.test(t)) return 'apagar';
  return null;
}

/** La respuesta a «¿solo ahora o siempre?». null: no se entendió (se toma «solo ahora», lo prudente). */
export function respuestaModoCamara(texto: string): 'temporal' | 'siempre' | 'no' | null {
  const t = sinTildes(texto);
  if (/\b(siempre|todo el tiempo|cada vez|always)\b/.test(t)) return 'siempre';
  if (/\b(solo|nada mas|por ahora|ahorita|ahora|un rato|temporal|esta vez|just now|for now|only now)\b/.test(t)) return 'temporal';
  if (/^(no|nop|mejor no|cancela|dejalo|olvidalo|no gracias)\b/.test(t.trim())) return 'no';
  return null;
}
