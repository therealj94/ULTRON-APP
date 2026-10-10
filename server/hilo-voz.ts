/**
 * EL HILO DE UN TURNO HABLADO (10-oct): qué voz llevó cada frase y con qué `request-id` de ElevenLabs.
 *
 * El teléfono, la web, Windows y Dr Electrum piden la voz FRASE POR FRASE y cada pedido llega solo, con el texto de la
 * frase de antes (`previo`). Con eso basta para reconocer el turno: la frase anterior se busca aquí por su texto. Sirve
 * para dos cosas:
 *
 *   · enlazar el audio: los `request-id` de las frases anteriores (≤3, del mismo modelo) van como
 *     `previous_request_ids` y ElevenLabs sigue la entonación de lo que ya sonó, no solo de su texto;
 *   · NO cambiar de voz a mitad del turno: si ElevenLabs falló en una frase, las que siguen se quedan con el mismo
 *     respaldo (el modelo rápido o Voicebox), y nunca se pegan tomas grabadas entre frases dichas en vivo.
 *
 * En memoria (se pierde al reiniciar, y no importa: un turno dura segundos), con tope y caducidad. Puro: se prueba sin red.
 */

/** Con qué se dijo una frase: el modelo expresivo, el rápido de respaldo o Voicebox. */
export type ModoTurno = 'v4' | 'rapido' | 'respaldo';

export type FraseHilo = {
  /** Quién habla (plataforma, avatar, idioma y voz propia): dos voces nunca comparten turno. */
  hablante: string;
  /** El texto de la frase, normalizado (sin marcas, sin puntuación, en minúsculas). */
  texto: string;
  modo: ModoTurno;
  /** El modelo de ElevenLabs con que se pidió (vacío si fue Voicebox). */
  modelo: string;
  /** El `request-id` de ESTA frase, cuando su audio llegó entero. */
  id?: string;
  /** Los ids de las anteriores del mismo modelo, seguidas y sin la propia, como mucho 2: con la propia, los 3 que acepta ElevenLabs. */
  antes: string[];
  /** El turno empezó con ElevenLabs: si cae a Voicebox, sin tomas grabadas (no se pegan entre frases en vivo). */
  empezoEnEleven: boolean;
  t: number;
};

/** Minúsculas, sin tildes, sin marcas ni puntuación: el texto del cliente y el del servidor se comparan así. */
export function normalizarFrase(texto: string): string {
  return String(texto || '')
    .replace(/\[[^\]\n]{1,80}\]/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

export class HiloVoz {
  private frases: FraseHilo[] = [];
  constructor(
    private readonly max = 400,
    private readonly ttlMs = 10 * 60_000
  ) {}

  /**
   * La frase dicha justo antes de esta: la última de este hablante cuyo texto termina como `previo` (el cliente manda
   * el final de la frase anterior, a veces recortado). null si no se reconoce (otro proceso, ya caducó, primera frase).
   */
  buscar(hablante: string, previo: string | undefined, ahora = Date.now()): FraseHilo | null {
    const p = normalizarFrase(previo || '');
    if (p.length < 6) return null;
    for (let i = this.frases.length - 1; i >= 0; i--) {
      const f = this.frases[i];
      if (ahora - f.t > this.ttlMs) break;
      if (f.hablante !== hablante || !f.texto) continue;
      if (f.texto === p || f.texto.endsWith(p) || p.endsWith(f.texto)) return f;
    }
    return null;
  }

  /** Los `request-id` para enlazar una frase nueva con modelo `modelo` detrás de `previa` (solo si la última ya tiene el suyo). */
  idsPara(previa: FraseHilo | null, modelo: string): string[] | undefined {
    if (!previa?.id || previa.modelo !== modelo) return undefined;
    return [...previa.antes, previa.id].slice(-3);
  }

  /**
   * Anota una frase (al pedirla: así la siguiente ya sabe con qué modo va el turno). Devuelve la entrada, para
   * corregirle el modo si falla o ponerle su id cuando el audio llega entero.
   */
  anotar(hablante: string, texto: string, modo: ModoTurno, modelo: string, previa: FraseHilo | null, ahora = Date.now()): FraseHilo {
    // Seguidos o nada: si la anterior aún no tiene su id, la cadena empieza aquí (nunca se salta una frase).
    const antes = previa?.id && previa.modelo === modelo ? [...previa.antes, previa.id].slice(-2) : [];
    const f: FraseHilo = { hablante, texto: normalizarFrase(texto), modo, modelo, antes, empezoEnEleven: previa ? previa.empezoEnEleven : modo !== 'respaldo', t: ahora };
    this.frases.push(f);
    // Lo caducado sale por delante; y nunca más de `max`.
    while (this.frases.length > this.max || (this.frases.length && ahora - this.frases[0].t > this.ttlMs)) this.frases.shift();
    return f;
  }

  /** Solo para pruebas. */
  vaciar() {
    this.frases = [];
  }
}
