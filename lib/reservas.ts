/**
 * LO LIMITADO, RECONOCIDO EN UN TEXTO (revisión del 5-oct, ronda 10): la única regla que decide si una frase de
 * lo suyo (un hecho de su memoria, una frase de un resumen, un turno del hilo, una respuesta del perfil, un dato
 * aprendido) repite algo que la persona marcó «No usarlo» (alcance `limitado` en lib/conocer-persona.ts).
 *
 * Antes se tapaban PALABRAS sueltas sacadas del dato, y se escapaba por todos lados: la clave del dato
 * («hija:valentina») se descartaba entera y «Su hija se llama Valentina» no dejaba nada que tapar; «soy
 * diabético» no casaba con «diabetes»; «PuertoSintetico» junto tampoco; y limitar «diabetes tipo 2» tapaba
 * cualquier «tipo» de cualquier conversación.
 *
 * Ahora, por cada dato limitado, una RESERVA:
 *   · fuertes: lo que solo ya lo nombra: el valor de la clave (lo que va tras «:»; lo de antes es la
 *     categoría), los nombres propios que no son palabra común («Sintetico», «Valentina») y los números largos
 *     (una cédula, un teléfono). Si el dato no tiene nada de eso y le queda UNA sola palabra propia
 *     («diabetes»), esa.
 *   · terminos: las palabras propias del dato (sin vacías, sin las de plantilla, sin las comunes), más los
 *     nombres propios comunes («Puerto»), los nombres de pila muy comunes («María») y los números de menos de
 *     seis cifras (un día, un año, una dosis): hacen falta DOS de la misma reserva, o uno con su etiqueta.
 *   · juntas: el nombre de varias palabras escrito junto («puertosintetico», «minerasintetica»).
 * Todo sin tildes ni mayúsculas, y por raíz: dos palabras casan si son iguales sin el plural o comparten un
 * principio de 5 letras o más que cubre casi toda la más corta («diabetes»/«diabético»/«diabética»).
 *
 * Y se decide por FRASE (o línea, o turno, o dato), nunca por palabra: una frase que toca una reserva sale
 * entera y en su lugar queda «[dato reservado]»; una palabra común sola nunca dispara.
 *
 * Y lo que solo no identifica a nadie (revisión 11, MENOR-G): un nombre de pila MUY común («María», «José», «Juan»…,
 * `NOMBRES_COMUNES`) o una fecha o un número corto no son fuertes: limitar «esposa: María» tapaba «Envíale el contrato
 * a Maria» o «La santa María», y limitar el cumpleaños «12 de marzo» tapaba «La reunión es el 12 de marzo». Ahora
 * cuentan como un término propio y piden otro: otra palabra del dato o lo que ES el dato (`etiquetas`: «esposa», «mi
 * mujer», «hija», «cumple», «nació»…). Una fecha («12 de marzo») cuenta como UN término (`compuestos`), no dos. Los
 * nombres menos comunes («Valentina») y lo escrito junto siguen fuertes: ante la duda, se reserva.
 *
 * Límite honesto: casa por palabras compartidas. Una paráfrasis sin ninguna palabra del dato («su niña está
 * malita» para «Su hija se llama Valentina») no se reconoce. Y con un nombre muy común limitado, «María me llamó»
 * (sin decir que es su esposa) ya no se reserva.
 */
import { plegar } from './cerebro-comun';

export type Reserva = {
  readonly fuertes: readonly string[];
  readonly terminos: readonly string[];
  readonly juntas: readonly string[];
  /** Fechas del dato («12 de marzo», «marzo 12»), plegadas: cada una cuenta como UN término (revisión 11, MENOR-G). */
  readonly compuestos?: readonly string[];
  /** Lo que ES el dato («esposa», «mujer», «cumple», «nació»…): con un término propio, lo nombra; solas, no. */
  readonly etiquetas?: readonly string[];
};

/**
 * Lo que se pasa de mano en mano (la vista del turno, el perfil de uso, la iniciativa). Un arreglo de palabras
 * (la forma vieja, la de las pruebas) vale como términos: dos de ellas, o la única si es una.
 */
export type Reservas = readonly (Reserva | readonly string[])[];

/** Vacías (español e inglés): no dicen nada de nadie. */
const VACIAS = new Set(
  (
    'a al algo algun alguna alguno algunos algunas alli alla ante antes aqui asi aun aunque bien cada casi como con contra cual cuales cuando cuanto ' +
    'de del desde donde dos durante e el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta estaba estado estan estar estas ' +
    'este esto estos estoy fue fueron ha habia han has hasta hay he la las le les lo los mas me mi mis mio mia mucho muchos muy nada ni no nos ' +
    'nosotros nuestra nuestro o os otra otras otro otros para pero poco por porque que quien quienes se sea segun ser si sido sin sino sobre solo ' +
    'son su sus tal tambien tan tanto te tenia tengo tiene tienen todo todos toda todas tu tus tuyo un una uno unos unas usted ustedes y ya yo vos ' +
    'ademas entonces luego despues ahora hoy ayer manana siempre nunca hace hizo dijo dice sr sra don dona ' +
    'the an and or of to in on at for with by from is are was were be been being it its this that these those i you he she we they my your his ' +
    'her our their not yes as but if so do does did have had will would can could should about into over than then there here what which who ' +
    'whom when where why how all any some aura ultron'
  ).split(' ')
);

/** Las de las plantillas de cada dato y de cada categoría: el «qué es», nunca el «quién» ni el «dónde». */
const PLANTILLA = new Set(
  (
    'vive vivo vivia viven vivir dedica dedico llama llamo llaman gusta gustan gusto encanta encantan fascina favorita favorito comida musica ' +
    'familia familiar quiere quiero ayude ayuda trabaja trabajo trabajaba trabajar oficio pasatiempo cumple cumplo cumplen cumpleano cumpleanos ' +
    'ano anos edad esposa esposo mujer marido novia novio pareja hija hijo madre padre mama papa hermana hermano abuela abuelo suegra suegro ' +
    'nieta nieto tia tio prima primo cunada cunado sobrina sobrino suya suyo tener tuvo tiene estudia estudio estudiar juega jugar sale salir ' +
    'mudo mudanza mudarse propio propia aniversario dato persona nacio naci llamada llamado'
  ).split(' ')
);

/** Comunes: solas no identifican nada (limitar «Puerto Sintetico» no puede tapar el «puerto de Cortés»). */
const COMUNES = new Set(
  (
    'tipo clase cosa parte vez veces forma manera caso grupo gente casa hogar empresa compania negocio mina minas minera minero mineria mineral ' +
    'oro plata cobre proyecto concesion vida salud problema tiempo mundo pais lugar nombre numero momento grande pequeno bueno buena malo mala ' +
    'mejor peor primero primera segundo segunda ultimo ultima nuevo nueva viejo vieja alto alta mismo misma dia dias semana mes meses hora horas ' +
    'enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre lunes martes miercoles jueves viernes ' +
    'sabado domingo puerto ciudad pueblo aldea barrio colonia calle avenida rio san santa santo villa valle monte playa isla lago cerro costa ' +
    'norte sur este oeste centro departamento municipio capital zona sector escuela colegio universidad hospital clinica iglesia banco tienda ' +
    'oficina carro auto perro perra gato gata agua plan meta metas dinero cuenta reunion junta orden global cliente equipo area informe contrato ' +
    'pago precio poco hace mucho todavia cerca lejos algun gran work home city port house company type day week month year time people'
  ).split(' ')
);

/**
 * Nombres de pila MUY comunes: solos no dicen de quién se habla (hay una María en cada conversación). Del dato limitado
 * cuentan como término (piden otra palabra o la etiqueta: «mi esposa María»). La lista es corta a propósito: un nombre
 * que no está aquí («Valentina») sigue nombrando el dato él solo.
 */
const NOMBRES_COMUNES = new Set(
  (
    'maria jose juan ana luis carlos pedro manuel antonio francisco jesus miguel jorge david daniel pablo javier ' +
    'rosa carmen elena laura marta lucia isabel sara'
  ).split(' ')
);

const MESES = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
const MES_NUM = MESES.split('|').filter((m) => m !== 'setiembre');

/**
 * Lo que ES cada clase de dato y cómo se dice («mi mujer» es la esposa; «cumple», «nació» el cumpleaños). Sale de la
 * categoría de la clave («esposa:maría», «cumpleanos propio») y de las palabras del dato («Su esposa se llama María»).
 */
const ETIQUETAS: Record<string, readonly string[]> = (() => {
  const g: string[][] = [
    ['esposa', 'mujer', 'senora', 'conyuge', 'pareja'],
    ['esposo', 'marido', 'conyuge', 'pareja'],
    ['pareja', 'novia', 'novio', 'esposa', 'esposo'],
    ['novia', 'pareja'],
    ['novio', 'pareja'],
    ['hija', 'hijita', 'nena'],
    ['hijo', 'hijito', 'nene'],
    ['madre', 'mama', 'mami', 'mamita'],
    ['mama', 'madre', 'mami', 'mamita'],
    ['padre', 'papa', 'papi', 'papito'],
    ['papa', 'padre', 'papi', 'papito'],
    ['hermana', 'hermanita'],
    ['hermano', 'hermanito'],
    ['abuela', 'abuelita'],
    ['abuelo', 'abuelito'],
    ['nieta', 'nietecita'],
    ['nieto', 'nietecito'],
    ['tia'],
    ['tio'],
    ['prima'],
    ['primo'],
    ['suegra'],
    ['suegro'],
    ['cunada'],
    ['cunado'],
    ['sobrina'],
    ['sobrino'],
    ['cumpleanos', 'cumple', 'cumpleano', 'cumplo', 'cumplir', 'nacio', 'naci', 'nacimiento'],
    ['cumple', 'cumpleanos', 'cumpleano', 'cumplo', 'cumplir', 'nacio', 'naci', 'nacimiento'],
    ['nacio', 'cumple', 'cumpleanos', 'cumpleano', 'cumplo', 'cumplir', 'naci', 'nacimiento'],
  ];
  return Object.fromEntries(g.map((x) => [x[0], x]));
})();

/** La raíz simple (sin el plural): «telas» → «tela», «diabetes» → «diabet». */
function raiz(w: string): string {
  return w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
}

/** ¿Dos palabras (plegadas) son la misma por su raíz? */
function casa(w: string, t: string): boolean {
  if (w === t) return true;
  const a = raiz(w);
  const b = raiz(t);
  if (a === b) return true;
  const corta = Math.min(a.length, b.length);
  if (corta < 5) return false;
  let p = 0;
  while (p < corta && a[p] === b[p]) p++;
  return p >= Math.max(5, Math.ceil(corta * 0.75));
}

type Ficha = { orig: string; w: string; inicio: boolean };

/** Las palabras de un texto, con su forma original (para ver la mayúscula) y si abren frase. */
function fichas(texto: string): Ficha[] {
  const out: Ficha[] = [];
  const re = /[\p{L}\p{N}]+|[.!?¿¡:;]/gu;
  let inicio = true;
  for (let m = re.exec(String(texto || '')); m; m = re.exec(String(texto || ''))) {
    const s = m[0];
    if (/^[.!?¿¡:;]$/.test(s)) {
      inicio = true;
      continue;
    }
    out.push({ orig: s, w: plegar(s), inicio });
    inicio = false;
  }
  return out;
}

const esNumero = (w: string) => /^\d+$/.test(w);
const juntar = (s: string) => plegar(s).replace(/[^a-z0-9]+/g, '');
/** Un texto plegado con un solo espacio entre palabras y uno a cada lado (para buscar una fecha entera). */
const espaciado = (s: string) => ` ${plegar(s).replace(/[^a-z0-9]+/g, ' ').trim()} `;
/** Un número largo (una cédula, un teléfono) sí nombra solo; uno corto (un día, un año, una dosis) no. */
const NUMERO_FUERTE = 6;

/**
 * Las fechas de un texto plegado («12 de marzo», «marzo 12», «03-12» en la clave), cada una en sus dos formas
 * escritas, y las palabras que las forman (para no contarlas además como términos sueltos).
 */
function fechasDe(texto: string): { formas: string[]; palabras: Set<string> } {
  const t = espaciado(texto);
  const formas = new Set<string>();
  const palabras = new Set<string>();
  const anotar = (dia: string, mes: string) => {
    const d = String(Number(dia));
    formas.add(`${d} de ${mes}`);
    formas.add(`${mes} ${d}`);
    palabras.add(dia).add(d).add(mes);
  };
  for (const m of t.matchAll(new RegExp(`(?<= )(\\d{1,2}) (?:de )?(${MESES})(?= )`, 'g'))) anotar(m[1], m[2] === 'setiembre' ? 'septiembre' : m[2]);
  for (const m of t.matchAll(new RegExp(`(?<= )(${MESES}) (\\d{1,2})(?= )`, 'g'))) anotar(m[2], m[1] === 'setiembre' ? 'septiembre' : m[1]);
  // «03-14» (MM-DD, como guarda el perfil el cumpleaños).
  for (const m of String(texto || '').matchAll(/\b(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])\b/g)) {
    anotar(m[2], MES_NUM[Number(m[1]) - 1]);
    palabras.add(m[1]);
  }
  return { formas: [...formas], palabras };
}

/** La reserva de un dato limitado. Null si no tiene nada que lo identifique (todo plantilla). */
export function reservaDe(texto: string, clave?: string): Reserva | null {
  const fuertes = new Set<string>();
  const terminos = new Set<string>();
  const debiles = new Set<string>();
  const comunes = new Set<string>();
  const juntas = new Set<string>();
  const etiquetas = new Set<string>();
  const anotarJunta = (ws: string[]) => {
    const j = ws.join('');
    if (ws.length >= 2 && j.length >= 8) juntas.add(j);
  };
  const anotarEtiquetas = (w: string) => {
    for (const e of ETIQUETAS[w] || []) etiquetas.add(e);
  };
  // Lo que solo no nombra a nadie: un nombre de pila muy común o un número corto (revisión 11, MENOR-G).
  const flojo = (w: string) => NOMBRES_COMUNES.has(w) || (esNumero(w) && w.length < NUMERO_FUERTE);
  // El valor de la clave («hija:valentina» → «valentina»; «empresa:minera sintetica»): lo de antes de «:» es la
  // categoría. Una clave sin «:» («vive», «cumpleanos propio», «esposa») es solo la categoría, y dice qué ES el dato.
  const k = String(clave || '');
  const dos = k.indexOf(':');
  const categoria = fichas(dos >= 0 ? k.slice(0, dos) : k)[0]?.w || '';
  anotarEtiquetas(categoria);
  // Las fechas del dato y de la clave: cada una, UN término.
  const fechas = fechasDe(`${texto} ${dos >= 0 ? k.slice(dos + 1) : ''}`);
  if (dos >= 0) {
    const ws = fichas(k.slice(dos + 1))
      .map((f) => f.w)
      .filter((w) => w.length >= 2 && !VACIAS.has(w));
    for (const w of ws) {
      if (fechas.palabras.has(w)) continue;
      (COMUNES.has(w) || PLANTILLA.has(w) || flojo(w) ? terminos : fuertes).add(w);
    }
    anotarJunta(ws.filter((w) => !esNumero(w)));
  }
  let corrida: string[] = [];
  const cerrar = () => {
    anotarJunta(corrida);
    corrida = [];
  };
  /** Las palabras de plantilla del dato («aniversario», «cumple»): con una fecha, dicen qué es esa fecha. */
  const deLaPlantilla = new Set<string>();
  for (const f of fichas(texto)) {
    const w = f.w;
    anotarEtiquetas(w);
    if (PLANTILLA.has(w)) deLaPlantilla.add(w);
    if (fechas.palabras.has(w)) {
      cerrar();
      continue;
    }
    if (esNumero(w)) {
      cerrar();
      (w.length >= NUMERO_FUERTE ? fuertes : debiles).add(w);
      continue;
    }
    if (VACIAS.has(w) || w.length < 2) {
      cerrar();
      continue;
    }
    // Un nombre propio: con mayúscula y no abriendo la frase («Vive en Puerto Sintetico»).
    if (!f.inicio && /^\p{Lu}/u.test(f.orig)) {
      corrida.push(w);
      (COMUNES.has(w) || PLANTILLA.has(w) || flojo(w) ? terminos : fuertes).add(w);
      continue;
    }
    cerrar();
    if (PLANTILLA.has(w)) continue;
    if (COMUNES.has(w)) comunes.add(w);
    else if (w.length >= 4) terminos.add(w);
  }
  cerrar();
  // Una fecha sin etiqueta conocida («Su aniversario es el 5 de junio»): lo que dice el dato de ella hace de etiqueta.
  if (fechas.formas.length && !etiquetas.size) for (const w of deLaPlantilla) etiquetas.add(w);
  // Una etiqueta no es además un término (la palabra «esposa» sola no nombra a la esposa).
  for (const e of etiquetas) terminos.delete(e);
  // Sin nada propio: lo común del dato, y entonces hacen falta dos.
  const soloComunes = !fuertes.size && !terminos.size && !fechas.formas.length;
  if (soloComunes) for (const w of comunes) terminos.add(w);
  // Una sola palabra que lo identifica («Tiene diabetes tipo 2» → «diabetes»): sola ya lo nombra. Si es común y va con
  // un número corto, o es un nombre muy común o un número («esposa: María»), no: pide otra palabra o la etiqueta.
  const unica = terminos.size === 1 ? [...terminos][0] : '';
  if (!fuertes.size && unica && !fechas.formas.length && !flojo(unica) && !(soloComunes && debiles.size)) fuertes.add(unica);
  for (const w of debiles) terminos.add(w);
  const compuestos = fechas.formas;
  // Lo que puede llegar a nombrarlo: un fuerte, lo escrito junto, dos términos (una fecha cuenta uno) o uno con su etiqueta.
  const propios = terminos.size + (compuestos.length ? 1 : 0);
  if (!fuertes.size && !juntas.size && propios < 2 && !(propios >= 1 && etiquetas.size)) return null;
  return { fuertes: [...fuertes], terminos: [...terminos], juntas: [...juntas], compuestos, etiquetas: [...etiquetas] };
}

function comoReserva(r: Reserva | readonly string[]): Reserva {
  if (!Array.isArray(r)) return r as Reserva;
  const ws = (r as readonly string[]).map((w) => plegar(String(w))).filter(Boolean);
  return { fuertes: ws.length === 1 ? ws : [], terminos: ws, juntas: ws.length >= 2 ? [ws.join('')] : [] };
}

/** Una etiqueta al principio («José: …», «Miembro: …», «Otros: …»): no es parte de lo dicho. */
const ETIQUETA = /^\s*(?:[-*•·]\s+)?(?:[\p{L}][\p{L}\p{N} ]{0,28}:\s+)?/u;

/**
 * LA DECISIÓN: ¿este texto (una frase, un dato, un turno) repite algo limitado? Sí si nombra el valor de la
 * clave, un nombre propio poco común o un número largo de un dato limitado, si lo escribe junto, si trae dos de
 * sus palabras propias (una fecha entera cuenta una), o una de ellas con lo que ES el dato («mi esposa María»,
 * «mi cumple es el 12 de marzo»).
 */
export function tocaReserva(texto: string, reservas: Reservas): boolean {
  if (!reservas.length) return false;
  const s = String(texto || '').replace(ETIQUETA, '');
  const ws = [...new Set(fichas(s).map((f) => f.w))];
  if (!ws.length) return false;
  const junto = juntar(s);
  const esp = espaciado(s);
  let todas: string[] | null = null;
  for (const x of reservas) {
    const r = comoReserva(x);
    if (r.juntas.some((j) => junto.includes(j))) return true;
    if (r.fuertes.some((t) => ws.some((w) => casa(w, t)))) return true;
    let n = r.compuestos?.some((c) => esp.includes(` ${c} `)) ? 1 : 0;
    for (const t of r.terminos) if (ws.some((w) => casa(w, t))) n++;
    if (n >= 2) return true;
    // La etiqueta cuenta también en el rótulo del principio («Cumple años: 14 de marzo»).
    if (n >= 1 && r.etiquetas?.some((e) => (todas ||= [...new Set(fichas(String(texto || '')).map((f) => f.w))]).some((w) => w === e || raiz(w) === raiz(e)))) return true;
  }
  return false;
}

/**
 * Las frases de una línea. Corta tras «.», «!», «?», «;» o «…» seguidos de espacio, salvo tras una abreviatura
 * corta («Pto.», «Sr.», «Av.»): juntar de más solo reserva de más. « · » separa campos (una misión: su título,
 * su objetivo, su próximo paso): cada uno cuenta como frase.
 */
function frases(linea: string): string[] {
  const partes = linea.split(/((?<=[.!?;…])\s+|\s+·\s+)/);
  const out: string[] = [];
  for (let i = 0; i < partes.length; i += 2) {
    const frase = partes[i];
    const sep = partes[i + 1] ?? '';
    const prev = out.length ? out[out.length - 1] : null;
    if (prev !== null && /(?:^|[^\p{L}])\p{L}{1,3}\.\s*$/u.test(prev)) out[out.length - 1] = prev + frase + sep;
    else out.push(frase + sep);
  }
  return out.filter((f) => f !== '');
}

/**
 * Un texto de lo suyo como puede ir al modelo: cada línea por frases, y la frase que toca una reserva sale
 * entera; en su lugar, `marca` (seguidas, una sola). La etiqueta del principio («José: », «- ») se queda.
 */
export function textoReservado(texto: string, reservas: Reservas, marca: string): string {
  if (!texto || !reservas.length) return texto;
  return String(texto)
    .split('\n')
    .map((linea) => {
      if (!linea.trim()) return linea;
      let salio = false;
      const r = frases(linea).map((f, i) => {
        if (!tocaReserva(f, reservas)) return f;
        salio = true;
        const pre = i === 0 ? (f.match(ETIQUETA)?.[0] ?? '') : '';
        const fin = f.match(/\s*$/)?.[0] ?? '';
        return `${pre}${marca}${fin}`;
      });
      if (!salio) return linea;
      const m = marca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return r.join('').replace(new RegExp(`${m}(?:\\s+(?:·\\s+)?${m})+`, 'g'), marca);
    })
    .join('\n');
}
