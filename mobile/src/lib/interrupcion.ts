/**
 * HABLARLE ENCIMA COMO A UNA PERSONA (José, 3-oct: «piensa cómo funciona ChatGPT con voz: si le
 * interrumpo me escucha y vuelve y me dice ok, está bien… que sienta que me escucha»).
 *
 * Lo que decide, sin micrófono ni red (se prueba en Node; lo usan el teléfono y la web):
 *  - ¿Lo que el oído entiende mientras AU-RA habla es la persona interrumpiendo, o es el eco de la
 *    propia voz de AU-RA que se coló al micrófono, o un «ajá», «sí», «ok» de quien la escucha?
 *    El eco se reconoce por el TEXTO: lo que dice el oído se compara con las frases que AU-RA está
 *    diciendo. Un «ajá» no la corta (como ChatGPT, que sigue hablando si uno asiente); un «espera»,
 *    «para», «oye» sí, aunque sea una sola palabra; y dos palabras que no son eco ni muletilla, también.
 *  - Qué alcanzó a oír la persona antes de cortarla (las frases que sonaron y el trozo de la última):
 *    eso viaja al cerebro para que sepa dónde quedó y conteste «Va, dime» en vez de repetirse.
 */

/** Minúsculas, sin tildes ni signos: las palabras para comparar. */
export function palabras(texto: string): string[] {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean);
}

/** Lo que dice quien escucha para que sepas que sigue ahí (no es interrumpir). */
const MULETILLAS = new Set(
  'aja aha aham aja mhm mmm mm hmm hm uhum umju si sip ok okay oki okey claro ya exacto exactamente vale ah eh uh oh bien bueno orale va dale cierto correcto entiendo yes yeah yep right sure uhhuh huh'.split(' ')
);

/** Palabras con las que uno corta a quien habla: una sola basta. */
const FRENOS = new Set(
  'espera esperate espere esperame para parale pare paremos alto basta stop wait hold callate calla silencio momento oye oiga aura perdon disculpa disculpe pausa'.split(' ')
);

/** ¿Esta palabra salió de lo que AU-RA está diciendo? (el oído a veces corta o cambia el final). */
function esEco(p: string, eco: Set<string>): boolean {
  if (eco.has(p)) return true;
  if (p.length < 4) return false;
  for (const e of eco) {
    if (e.length >= 4 && Math.abs(e.length - p.length) <= 3 && e.slice(0, 4) === p.slice(0, 4)) return true;
  }
  return false;
}

function ecoDe(dichos: readonly string[]): Set<string> {
  const s = new Set<string>();
  for (const d of dichos) for (const p of palabras(d)) s.add(p);
  return s;
}

/**
 * ¿La persona le está hablando encima? `dichos`: lo que AU-RA dice ahora (y lo de hace un momento).
 * Sin `dichos` (no se sabe qué dice), basta con dos palabras que no sean muletillas.
 */
export function esInterrupcionReal(parcial: string, dichos: readonly string[] = []): boolean {
  const ps = palabras(parcial);
  if (!ps.length) return false;
  const eco = ecoDe(dichos);
  const nuevas = ps.filter((p) => !esEco(p, eco));
  if (nuevas.some((p) => FRENOS.has(p))) return true;
  const propias = nuevas.filter((p) => !MULETILLAS.has(p));
  // Dos palabras suyas y que sean al menos la mitad de lo oído: un par de palabras mal oídas del eco
  // en medio de una frase larga de AU-RA no la cortan.
  return propias.length >= 2 && propias.length * 2 >= ps.length;
}

/**
 * Para los logs, sin el texto (lo dicho puede ser privado: salud, dinero…): cuántas palabras oyó el oído,
 * cuántas no eran eco de AU-RA y si había un freno («espera», «para»).
 */
export function cuentaInterrupcion(parcial: string, dichos: readonly string[] = []): { palabras: number; nuevas: number; freno: boolean } {
  const ps = palabras(parcial);
  const eco = ecoDe(dichos);
  const nuevas = ps.filter((p) => !esEco(p, eco));
  return { palabras: ps.length, nuevas: nuevas.length, freno: nuevas.some((p) => FRENOS.has(p)) };
}

/** ¿Es solo eco o solo muletillas? (una frase así, oída mientras AU-RA hablaba, no es un pedido). */
export function soloEcoOMuletilla(texto: string, dichos: readonly string[] = []): boolean {
  const ps = palabras(texto);
  if (!ps.length) return true;
  const eco = ecoDe(dichos);
  return ps.every((p) => MULETILLAS.has(p) || esEco(p, eco)) && !ps.some((p) => FRENOS.has(p) && !eco.has(p));
}

/**
 * La frase de quien interrumpió puede empezar con el eco de AU-RA (el oído ya iba oyendo su voz cuando
 * la persona entró): «…de 28 grados espera mejor dime de San Pedro». Se quita ese comienzo si trae dos
 * palabras llenas o más y queda algo de dos palabras o más; si no, la frase va como llegó.
 */
export function quitarEco(texto: string, dichos: readonly string[] = []): string {
  const t = String(texto || '').trim();
  if (!t || !dichos.length) return t;
  const eco = ecoDe(dichos);
  const trozos = t.split(/\s+/);
  let i = 0;
  while (i < trozos.length) {
    const ps = palabras(trozos[i]);
    if (!ps.length || ps.every((p) => esEco(p, eco) && !FRENOS.has(p))) i++;
    else break;
  }
  // «el de», «y la»: palabras cortas que la persona también dice. Solo se quita si el comienzo trae al
  // menos dos palabras de verdad (de cuatro letras o más) que AU-RA estaba diciendo.
  const llenas = trozos.slice(0, i).filter((x) => palabras(x).some((p) => p.length >= 4)).length;
  if (i < 2 || llenas < 2 || trozos.length - i < 2) return t;
  const resto = trozos.slice(i).join(' ');
  return resto.charAt(0).toUpperCase() + resto.slice(1);
}

/**
 * Lo que va diciendo la voz, frase por frase, para saber qué es eco y qué alcanzó a oír la persona.
 * El reloj se inyecta (pruebas).
 */
export class RegistroVoz {
  /** Frases del turno de ahora que ya sonaron enteras. */
  private oidas: string[] = [];
  /** La que suena ahora. */
  private sonando: { texto: string; desde: number } | null = null;
  /** Lo que sonó hace poco (eco que todavía puede llegar al oído). */
  private recientes: { texto: string; hasta: number }[] = [];
  /** Lo que la persona alcanzó a oír cuando cortó a AU-RA (null: no la cortó). */
  private cortada: string | null = null;

  constructor(private readonly ahora: () => number = Date.now, private readonly ventanaEcoMs = 6_000) {}

  /** Empieza la respuesta a un pedido nuevo: lo oído antes ya no cuenta. */
  nuevoTurno() {
    this.oidas = [];
    this.sonando = null;
  }

  empezo(texto: string) {
    const t = String(texto || '').trim();
    if (!t) return;
    if (this.sonando) this.termino();
    this.sonando = { texto: t, desde: this.ahora() };
  }

  /** La frase que sonaba terminó entera. */
  termino() {
    const s = this.sonando;
    if (!s) return;
    this.sonando = null;
    this.oidas.push(s.texto);
    if (this.oidas.length > 12) this.oidas.shift();
    this.recientes.push({ texto: s.texto, hasta: this.ahora() });
    if (this.recientes.length > 6) this.recientes.shift();
  }

  /** La voz se calló por otra cosa (un pedido nuevo, «callar»): la frase que sonaba queda como eco reciente. */
  callo() {
    const s = this.sonando;
    if (!s) return;
    this.sonando = null;
    this.recientes.push({ texto: s.texto, hasta: this.ahora() });
    if (this.recientes.length > 6) this.recientes.shift();
  }

  /** ¿Está sonando la voz? */
  hablando() {
    return !!this.sonando;
  }

  /** Las frases que pueden volver como eco: la que suena y las que acaban de sonar. */
  dichos(): string[] {
    const ahora = this.ahora();
    this.recientes = this.recientes.filter((r) => ahora - r.hasta <= this.ventanaEcoMs);
    return [...this.recientes.map((r) => r.texto), ...(this.sonando ? [this.sonando.texto] : [])];
  }

  /**
   * La persona cortó a AU-RA. `fraccion`: cuánto de la frase que sonaba se oyó (0..1, por la posición
   * del audio); sin ella, se estima por el tiempo (~14 letras por segundo). Devuelve lo que oyó.
   */
  cortar(fraccion?: number): string {
    const s = this.sonando;
    // No sonaba nada ni había sonado nada de este turno: no hubo a quién cortar.
    if (!s && !this.oidas.length) return '';
    let trozo = '';
    if (s) {
      const f = typeof fraccion === 'number' && Number.isFinite(fraccion) ? fraccion : (this.ahora() - s.desde) / 1000 / (s.texto.length / 14);
      trozo = recortarFrase(s.texto, Math.max(0, Math.min(1, f)));
      this.recientes.push({ texto: s.texto, hasta: this.ahora() });
      this.sonando = null;
    }
    const oido = [...this.oidas, trozo].filter(Boolean).join(' ').trim();
    this.cortada = oido;
    this.oidas = [];
    return oido;
  }

  /** Lo que oyó la persona la última vez que cortó a AU-RA, una sola vez (para el próximo turno). */
  tomarCortada(): string | null {
    const c = this.cortada;
    this.cortada = null;
    return c;
  }
}

/** Las palabras de `texto` hasta la fracción `f`, con «…» si quedó a medias. */
export function recortarFrase(texto: string, f: number): string {
  const ps = String(texto || '').trim().split(/\s+/).filter(Boolean);
  if (!ps.length) return '';
  if (f >= 0.97) return ps.join(' ');
  const n = Math.round(ps.length * f);
  if (n <= 0) return '';
  return `${ps.slice(0, n).join(' ').replace(/[,;:.]+$/, '')}…`;
}

/** Tope de lo que viaja al servidor como «lo que alcanzó a oír». */
export const TOPE_CORTADA = 400;
