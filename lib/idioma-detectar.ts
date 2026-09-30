/**
 * ¿En qué idioma habla quien pregunta? Español o inglés, por las palabras que usa.
 *
 * Dr Electrum contesta en español salvo que le hablen en inglés. El transcriptor a veces dice el
 * idioma (Scribe) y a veces no (Whisper, Gemini, y todo lo escrito a mano), así que hace falta una
 * lectura propia del texto. Es deliberadamente conservadora: solo dice «en» cuando el inglés es
 * claro, porque contestar en inglés a quien habló en español es peor que lo contrario.
 *
 * `null` = no se puede saber (una sigla, un nombre propio, «ok»): quien llama decide con otra pista.
 */
export type IdiomaTurno = 'es' | 'en';

// Palabras frecuentes que en el otro idioma no existen o casi no se usan. Nada ambiguo: fuera
// «no», «me», «a», «ok», «mapa/map» quedan porque son distintos.
const INGLES = new Set(
  'the is are was were be been what which who whom where when how why do does did can could would should will shall show tell give list find please about this that these those there here it its of in on at for with and or to an from near into by my your our their his her we they i you he she have has had not yes thanks thank hello hi hey okay map maps many much any some all each every mining mine mines concession concessions gold silver copper license licenses permit permits area areas owner owners holder near nearby latest new old what\'s where\'s how\'s i\'m don\'t can\'t let check see look looking give get got going still almost just moment second question good done nearly finishing'.split(' ')
);
const ESPANOL = new Set(
  'el la los las del de que qué en y es son era fue por para con una uno unos unas cuál cuáles cual dónde donde cómo como cuánto cuánta cuántos cuántas cuando cuándo quién quien quiénes muestra muéstrame mostrame mostrá dame decime dime hay está están esta este esto estos estas eso esa ese mi mis tu tus su sus al lo le les se sí si pero más muy también hola gracias quiero necesito puedes podés ver mapa mapas concesión concesiones oro plata cobre titular titulares cerca nuevo nueva viejo vos usted ustedes nos hacé haz busca buscá cuáles estoy voy vamos un ya deme déjeme momento ahora sobre entre tiene tienen'.split(' ')
);

export function detectarIdioma(texto: string): IdiomaTurno | null {
  const original = String(texto || '');
  if (!original.trim()) return null;
  const t = original.toLowerCase();
  let es = /[ñ¿¡]/.test(t) ? 2 : 0;
  let en = 0;
  const palabras = original.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ']+/g) || [];
  const mayuscula = (w: string | undefined) => !!w && /^[A-ZÁÉÍÓÚÑ]/.test(w);
  palabras.forEach((w, i) => {
    const p = w.toLowerCase();
    // Nombres propios: «Minas de Oro», «El Corpus», «Santa Bárbara» no dicen en qué idioma se
    // pregunta. Se salta la palabra con mayúscula que no abre la frase, y el «de/del/la» entre dos.
    const nombre = i > 0 && mayuscula(w);
    const enlace = /^(de|del|la|las|el|los|y)$/.test(p) && mayuscula(palabras[i - 1]) && mayuscula(palabras[i + 1]) && i > 0;
    if (nombre || enlace) return;
    if (INGLES.has(p)) en++;
    if (ESPANOL.has(p)) es++;
    // Las tildes son del español (y no de los nombres propios, ya saltados).
    else if (/[áéíóú]/.test(p)) es++;
  });
  if (en === 0 && es === 0) return null;
  // Frases cortas («hi», «show gold»): basta una palabra inglesa sin ninguna española.
  if (es === 0 && (en >= 2 || palabras.length <= 3)) return 'en';
  if (en >= 2 && en >= 2 * es) return 'en';
  if (es >= en) return 'es';
  return null;
}

/** Lo que devuelve un transcriptor («en», «eng», «es», «spa», «English»…) llevado a es/en; otro, null. */
export function idiomaDeCodigo(codigo: unknown): IdiomaTurno | null {
  const c = String(codigo || '').trim().toLowerCase();
  if (/^en/.test(c)) return 'en';
  if (/^(es|spa)/.test(c)) return 'es';
  return null;
}

/**
 * El idioma de un turno. Primero lo que dice el propio mensaje; si no se puede saber, la pista
 * (lo que oyó el micrófono, o cómo venía hablando); si tampoco, español.
 */
export function idiomaDelTurno(mensaje: string, ...pistas: unknown[]): IdiomaTurno {
  const delTexto = detectarIdioma(mensaje);
  if (delTexto) return delTexto;
  for (const p of pistas) {
    const i = idiomaDeCodigo(p);
    if (i) return i;
  }
  return 'es';
}
