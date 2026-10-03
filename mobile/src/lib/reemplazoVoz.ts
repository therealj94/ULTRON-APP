/**
 * EL `replace` DEL TURNO, EN LA VOZ (auditoría del 3-oct, VOICE02).
 *
 * El servidor a veces corrige lo dicho a media respuesta: después de una herramienta, la vuelta del
 * harness no empieza como lo que ya había salido, y manda `replace` con el texto ENTERO hasta ahí
 * (server.ts, turnoEnVivo). La pantalla se corrige sin más; la voz no se puede desoír. Lo que todavía no
 * sonó del texto viejo se tira, y de lo corregido se dice solo lo que falta:
 *   · si lo que ya sonó es el comienzo de lo corregido, se sigue donde iba (nada se repite);
 *   · si lo que sonó era otra cosa, se dice desde la FRASE donde difiere, marcado como corrección (la
 *     mesa le antepone un «Corrijo:»). Si difiere ya en la primera, va lo corregido entero.
 * Nunca la respuesta entera otra vez si su comienzo ya sonó igual.
 *
 * Puro, sin nada nativo (tests/voz-reemplazo.test.ts). Los textos llegan ya limpios para la voz.
 */

const normal = (t: string) => String(t || '').replace(/\s+/g, ' ').trim();

/**
 * Dónde empieza la frase de `texto` que contiene la posición `i`: justo después del último fin de frase
 * (`.`, `!`, `?`, `…` seguido de espacio) antes de `i`; 0 si no hay.
 */
function inicioDeFrase(texto: string, i: number): number {
  for (let k = Math.min(i, texto.length) - 1; k > 0; k--) {
    if (texto[k] === ' ' && /[.!?…]/.test(texto[k - 1])) return k + 1;
  }
  return 0;
}

/**
 * `oido`: lo que ya empezó a sonar (las frases que salieron, en orden). `nuevo`: el texto corregido
 * entero. Devuelve qué falta decir y si eso corrige algo que ya se oyó.
 */
export function faltaDecir(oido: string, nuevo: string): { decir: string; corrige: boolean } {
  const o = normal(oido);
  const n = normal(nuevo);
  if (!o) return { decir: n, corrige: false };
  if (n.startsWith(o)) return { decir: n.slice(o.length).trim(), corrige: false };
  let comun = 0;
  while (comun < o.length && comun < n.length && o[comun] === n[comun]) comun++;
  return { decir: n.slice(inicioDeFrase(n, comun)).trim(), corrige: true };
}
