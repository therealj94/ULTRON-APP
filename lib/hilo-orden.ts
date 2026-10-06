/**
 * EL HILO EN ORDEN Y SIN REPETIDOS (José, 6-oct, memoria de las 21:14–21:16 UTC): la misma frase suya quedó guardada cinco
 * veces («Vamos entonces, ¿ya lo guardaste?» y su variante «Estamos entonces…», turnos de voz que se cortaban y volvían a
 * empezar), y una respuesta quedó fuera de orden: «¡Listo! Hablamos después.» (que contestaba a su «bye») se guardó DESPUÉS
 * de «Mándele un mensaje a mi viejo», porque la memoria de un turno de voz se anota cuando se confirma (un rato después) y
 * se le ponía la hora de ese momento. Con el hilo así, el modelo contestaba a la frase de antes.
 *
 * Aquí, sin dependencias (lo usan lib/memoria.ts y lib/memoria-miembro.ts):
 *  · cada turno entra en su lugar por su hora (`t`: la de cuando se dijo, no la de cuando se anotó);
 *  · una frase de la persona igual a otra suya de hace menos de `VENTANA_REPETIDO_MS`, sin respuesta de AU-RA en medio, no
 *    se vuelve a guardar (el mismo pedido reintentado o la misma frase oída dos veces).
 */

export const VENTANA_REPETIDO_MS = 60_000;

type Turno = { rol: string; texto: string; t: number };

const plana = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();

/**
 * ¿Dos frases de la persona son la misma? La frase ENTERA, normalizada. Revisión del 6-oct (MENOR): antes bastaba con que
 * coincidiera todo menos la primera palabra, y «Sí, mándalo…» y «No, mándalo…» seguidas contaban como una (se perdía la
 * segunda, que dice lo contrario). La única palabra que puede variar es una primera mal oída que RIMA con la otra
 * («Vamos / Estamos entonces…»: las dos de 5 letras o más y con las mismas 3 últimas); un «sí», un «no» o un «ya» nunca.
 */
export function mismaFrase(a: string, b: string): boolean {
  const x = plana(a);
  const y = plana(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(' ');
  const ys = y.split(' ');
  if (xs.length < 4 || ys.length !== xs.length || xs.slice(1).join(' ') !== ys.slice(1).join(' ')) return false;
  const [p, q] = [xs[0], ys[0]];
  return p.length >= 5 && q.length >= 5 && p.slice(-3) === q.slice(-3);
}

/**
 * El hilo con el turno nuevo en su lugar (por su `t`), recortado a `max`; null si es una frase de la persona repetida (no
 * se guarda otra vez).
 */
export function insertarTurno<T extends Turno>(corta: readonly T[], nuevo: T, max: number): T[] | null {
  let i = corta.length;
  while (i > 0 && corta[i - 1].t > nuevo.t) i--;
  if (nuevo.rol === 'user') {
    // Hacia atrás desde donde entra, hasta la última respuesta de AU-RA: ¿la misma frase hace poco?
    for (let j = i - 1; j >= 0 && corta[j].rol === 'user'; j--) {
      if (nuevo.t - corta[j].t > VENTANA_REPETIDO_MS) break;
      if (mismaFrase(corta[j].texto, nuevo.texto)) return null;
    }
    // Y hacia adelante (una copia que se anotó antes con una hora posterior), sin respuesta en medio.
    for (let j = i; j < corta.length && corta[j].rol === 'user'; j++) {
      if (corta[j].t - nuevo.t > VENTANA_REPETIDO_MS) break;
      if (mismaFrase(corta[j].texto, nuevo.texto)) return null;
    }
  }
  return [...corta.slice(0, i), nuevo, ...corta.slice(i)].slice(-max);
}
