/**
 * LLAMADAS DE VERDAD: «llama a don Carlos del banco», «márcale al 9876 5432», «llámale a Ana por WhatsApp» (auditoría
 * del 7-oct, A-4: AU-RA solo llamaba a gente de PULSE2CHAT).
 *
 * AU-RA no hace la llamada ni la oye: le ABRE el marcador del teléfono (`tel:`) con el número puesto, o el chat de
 * WhatsApp de esa persona para que toque el botón de llamar. Por eso:
 *   · SIEMPRE pregunta antes, con el nombre y el número exactos: «¿Le marco a Don Carlos al +504 9876-5432?». Lo que se
 *     abre al decir que sí es ESA propuesta (lib/acciones-app.ts), nunca lo que el modelo escriba en el turno del «sí»;
 *   · el recibo es «te abrí el marcador», nunca «ya hablé con él» (lib/honestidad.ts: el marcador no respalda que se
 *     habló);
 *   · sin permiso nuevo ni módulo nativo: `Linking.openURL('tel:…')` abre el marcador (ACTION_VIEW, no llama solo).
 *
 * Aquí lo puro: leer un número hondureño dicho o escrito («+504 9876-5432», «nueve ocho siete seis…», «98765432»), buscar
 * a quién se refiere entre sus contactos con número (los chats y contactos de su WhatsApp, su círculo y los de la app que
 * traigan teléfono) y lo que se dice. Lo que pide esos contactos al puente vive en server/marcar.ts.
 */

/** Por dónde se llama: el marcador del teléfono o WhatsApp. */
export type ViaMarcar = 'telefono' | 'whatsapp';
export const VIAS_MARCAR: readonly ViaMarcar[] = ['telefono', 'whatsapp'];

/** Un contacto con número: de dónde salió (para el registro; la persona no lo oye) y cómo más le dice («mi esposa»). */
export type ContactoTel = { nombre: string; numero: string; fuente: 'whatsapp' | 'app' | 'circulo'; alias?: string[] };

/**
 * Lo que espera su «sí»: a quién, a qué número y por dónde. `dicho`: cómo lo pidió (el modelo lo repite igual en el turno del
 * «sí»: se reconoce sin volver a buscar en el puente).
 */
export type PropuestaMarcar = { tipo: 'marcar'; numero: string; nombre: string; via: ViaMarcar; dicho?: string };

export type ResolucionMarcar =
  | { tipo: 'uno'; nombre: string; numero: string }
  | { tipo: 'varios'; opciones: ContactoTel[] }
  /** `sinNumero`: el nombre es de alguien de la app (PULSE2CHAT) que no trae número. */
  | { tipo: 'ninguno'; sinNumero?: string };

const plegar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/* ------------------------------------------------------------------ el número */

const DIGITOS: Record<string, string> = { cero: '0', uno: '1', un: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

/** Los primeros dígitos de un número de Honduras: 2 (fijo), 3, 7, 8 y 9 (celular). */
const INICIO_HN = /^[23789]/;

/**
 * El número en forma E.164 («+50498765432»), o null si lo dicho no es un número que se pueda marcar sin dudar.
 *  · Honduras: 8 dígitos que empiezan en 2, 3, 7, 8 o 9 («9876 5432», «9876-5432», «nueve ocho siete seis cinco cuatro
 *    tres dos»), o con el código del país («+504 9876 5432», «504 98765432», «00504…»).
 *  · Otro país: solo con «+» o «00» delante y de 8 a 15 dígitos («+1 305 555 1234»). Sin eso, un número de otro largo no
 *    se adivina: se pregunta.
 * Lo que trae letras además de los dígitos dichos («el 9876 5432 de Ana») vale si los dígitos van juntos.
 */
export function numeroDe(texto: unknown): string | null {
  let s = plegar(String(texto ?? ''));
  if (!s.trim()) return null;
  // «más 504…» / «plus 1…» es el «+»; los dígitos dichos en palabras pasan a cifras.
  s = s.replace(/\b(mas|plus)\b\s*(?=[0-9]|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)/g, '+');
  s = s.replace(/\b(cero|uno|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|zero|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => DIGITOS[w]);
  // El tramo más largo de dígitos con separadores (espacios, guiones, puntos, paréntesis), con su «+».
  const tramos = s.match(/\+?\s*\(?\d[\d\s().-]*\d/g) || [];
  let mejor = '';
  for (const t of tramos) if (t.replace(/\D/g, '').length > mejor.replace(/\D/g, '').length) mejor = t;
  if (!mejor) return null;
  const mas = /^\+/.test(mejor.trim());
  let d = mejor.replace(/\D/g, '');
  if (!mas && d.startsWith('00')) return internacional(d.slice(2));
  if (mas) return internacional(d);
  if (d.length === 11 && d.startsWith('504')) d = d.slice(3);
  if (d.length === 8 && INICIO_HN.test(d)) return `+504${d}`;
  return null;
}

function internacional(d: string): string | null {
  if (d.startsWith('504')) {
    const local = d.slice(3);
    return local.length === 8 && INICIO_HN.test(local) ? `+504${local}` : null;
  }
  return d.length >= 8 && d.length <= 15 && !d.startsWith('0') ? `+${d}` : null;
}

/** ¿Lo dicho es SOLO un número (con «al», «el», «número»…)? Entonces no se busca un nombre. */
export function esSoloNumero(texto: unknown): boolean {
  const s = plegar(String(texto ?? ''))
    .replace(/\b(al|el|a|numero|numeros|telefono|cel|celular|tel|por favor|porfa|marca|marcale|llama|llamale|whatsapp|por)\b/g, ' ')
    .replace(/\b(mas|plus|cero|uno|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, '0')
    .replace(/[\s+().-]+/g, '');
  return /^\d{7,16}$/.test(s) && numeroDe(texto) !== null;
}

/** Como se dice y se lee: «+504 9876-5432»; otro país, «+1 3055551234». */
export function numeroLegible(e164: string): string {
  const m = /^\+504(\d{4})(\d{4})$/.exec(String(e164 || ''));
  // Otro país: tal cual (el largo de su código no se adivina).
  return m ? `+504 ${m[1]}-${m[2]}` : String(e164 || '');
}

/** ¿Es un número que el teléfono puede marcar (lo que el servidor deja salir)? */
export function numeroValido(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/* ------------------------------------------------------------------ a quién */

/** Palabras que no identifican a nadie («a mi», «el de», «don», «del banco» sí cuenta «banco»). */
const VACIAS = new Set('a al el la los las lo le de del mi mis tu su con por para y o e un una que numero telefono celular cel whatsapp llama llamale marca marcale marcar llamar'.split(' '));
const TRATAMIENTO = new Set('don dona doña sr sra srta senor senora senorita lic licenciado licenciada ing ingeniero ingeniera doc doctor doctora dr dra profe profesor profesora'.split(' '));

function palabrasDe(s: string): string[] {
  return plegar(s)
    .replace(/[^a-z0-9ñ\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !VACIAS.has(w));
}

const coincide = (dicha: string, delNombre: string) => dicha === delNombre || (dicha.length >= 4 && delNombre.startsWith(dicha)) || (delNombre.length >= 4 && dicha.startsWith(delNombre));

/** Los que valen (con número y nombre), limpios. */
function validos(xs: readonly ContactoTel[]): ContactoTel[] {
  const out: ContactoTel[] = [];
  for (const c of xs) {
    const n = numeroValido(c.numero);
    if (!n || !String(c.nombre || '').trim()) continue;
    out.push({ nombre: String(c.nombre).trim().slice(0, 80), numero: n, fuente: c.fuente, ...(c.alias?.length ? { alias: c.alias.map((a) => String(a).slice(0, 80)) } : {}) });
  }
  return out;
}

/** Los mismos contactos sin repetir el número (el mismo de WhatsApp y del círculo es uno: el primero que salió). */
function sinRepetir(xs: ContactoTel[]): ContactoTel[] {
  return xs.filter((c, i) => xs.findIndex((o) => o.numero === c.numero) === i);
}

const plano = (s: string) => plegar(s).replace(/[^a-z0-9ñ\s]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A quién se refiere lo dicho («don Carlos del banco», «Ana», «mi compadre Beto», «9876 5432»):
 *  · un número: ese (con el nombre del contacto que lo tenga, si alguno);
 *  · el nombre completo de un solo contacto, o el que más palabras comparte con lo dicho: ese;
 *  · dos o más igual de buenos con números distintos: `varios` (se pregunta cuál, nunca se elige solo);
 *  · nada: `ninguno` (con `sinNumero` si es alguien de la app, de PULSE2CHAT, que no trae número).
 * Los tratamientos («don», «doctora») no hacen falta para encontrar a alguien.
 */
export function resolverParaMarcar(dicho: string, contactos: readonly ContactoTel[], o: { nombresApp?: readonly string[] } = {}): ResolucionMarcar {
  const lista = validos(contactos);
  const numero = esSoloNumero(dicho) ? numeroDe(dicho) : null;
  if (numero) {
    const de = lista.find((c) => c.numero === numero);
    return { tipo: 'uno', nombre: de?.nombre || numeroLegible(numero), numero };
  }
  const q = plano(dicho);
  if (!q) return { tipo: 'ninguno' };
  // El nombre tal cual de un contacto (o como más le dice: «mi esposa»).
  const sinArticulo = q.replace(/^(a|al|el|la) /, '');
  const exactos = sinRepetir(lista.filter((c) => [c.nombre, ...(c.alias || [])].some((n) => plano(n) === sinArticulo || plano(n) === sinArticulo.replace(/^mi /, ''))));
  if (exactos.length === 1) return { tipo: 'uno', nombre: exactos[0].nombre, numero: exactos[0].numero };
  if (exactos.length > 1) return { tipo: 'varios', opciones: exactos };
  const dichas = palabrasDe(q);
  const clave = dichas.filter((w) => !TRATAMIENTO.has(w));
  if (!clave.length) return { tipo: 'ninguno' };
  const puntos = lista.map((c) => {
    const del = palabrasDe([c.nombre, ...(c.alias || [])].join(' '));
    return { c, n: clave.filter((w) => del.some((d) => coincide(w, d))).length };
  });
  const max = Math.max(0, ...puntos.map((p) => p.n));
  // Al menos la mitad de lo que dijo (sin tratamientos) tiene que estar en el nombre: «Carlos del banco» no es «Carlos
  // Mejía» si hay un «Carlos Banco»; y con un solo Carlos, «Carlos» basta.
  if (!max || max * 2 < clave.length) {
    const app = (o.nombresApp || []).find((n) => {
      const del = palabrasDe(n);
      return clave.every((w) => del.some((d) => coincide(w, d)));
    });
    return app ? { tipo: 'ninguno', sinNumero: app } : { tipo: 'ninguno' };
  }
  const mejores = sinRepetir(puntos.filter((p) => p.n === max).map((p) => p.c));
  if (mejores.length === 1) return { tipo: 'uno', nombre: mejores[0].nombre, numero: mejores[0].numero };
  return { tipo: 'varios', opciones: mejores.slice(0, 4) };
}

/* ------------------------------------------------------------------ lo que se dice */

type Idioma = 'es' | 'en';

/** El nombre que se dice: si solo hay número, nada (ya va el número). */
const conNombre = (p: { nombre: string; numero: string }) => (p.nombre && p.nombre !== numeroLegible(p.numero) && !/^\+?\d[\d\s-]+$/.test(p.nombre) ? p.nombre : '');

/** «¿Le marco a Don Carlos al +504 9876-5432?» (siempre con el número: es lo que se va a marcar). */
export function preguntaDeMarcar(p: Pick<PropuestaMarcar, 'nombre' | 'numero' | 'via'>, idioma: Idioma = 'es'): string {
  const n = conNombre(p);
  const num = numeroLegible(p.numero);
  if (idioma === 'en') {
    const quien = n ? `${n} at ${num}` : num;
    return p.via === 'whatsapp' ? `Should I call ${quien} on WhatsApp?` : `Should I dial ${quien}?`;
  }
  if (p.via === 'whatsapp') return n ? `¿Le marco a ${n} por WhatsApp al ${num}?` : `¿Le marco por WhatsApp al ${num}?`;
  return n ? `¿Le marco a ${n} al ${num}?` : `¿Le marco al ${num}?`;
}

/**
 * El recibo de lo que pasó al decir que sí: se ABRIÓ el marcador (o WhatsApp) en su teléfono. Nunca «ya hablé con
 * él» ni «ya lo llamé»: la llamada la hace ella y nadie aquí sabe si contestó.
 */
export function dichoDeMarcar(p: Pick<PropuestaMarcar, 'nombre' | 'numero' | 'via'>, idioma: Idioma = 'es'): string {
  const n = conNombre(p);
  const num = numeroLegible(p.numero);
  if (idioma === 'en') {
    if (p.via === 'whatsapp') return `I opened WhatsApp with ${n || num}: tap the call button to call.`;
    return `I opened the dialer with ${n ? `${n}'s number, ${num}` : num}: tap call.`;
  }
  if (p.via === 'whatsapp') return `Te abrí WhatsApp con ${n || `el ${num}`}: tócale el botón de llamar.`;
  return n ? `Te abrí el marcador con el número de ${n}, ${num}: tócale llamar.` : `Te abrí el marcador con el ${num}: tócale llamar.`;
}

export function dichoNegadoMarcar(idioma: Idioma = 'es'): string {
  return idioma === 'en' ? "Okay, I won't dial." : 'Va, no marco.';
}

/** Dos o más contactos igual de buenos: cuál (con el número, que es lo que los distingue). */
export function preguntaCualMarcar(opciones: readonly ContactoTel[], idioma: Idioma = 'es'): string {
  const lista = opciones.slice(0, 4).map((c) => `${c.nombre} (${numeroLegible(c.numero)})`);
  const unidos = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} ${idioma === 'en' ? 'or' : 'o'} ${lista[lista.length - 1]}` : lista[0] || '';
  return idioma === 'en' ? `Which one should I dial: ${unidos}?` : `¿A cuál le marco: ${unidos}?`;
}

/** No está: se dice dónde se buscó y se pide el número (nunca se inventa uno). */
export function dichoSinContacto(dicho: string, idioma: Idioma = 'es', sinNumero?: string): string {
  const q = String(dicho || '').trim().slice(0, 60);
  if (sinNumero) {
    return idioma === 'en'
      ? `I have ${sinNumero} in your AU-RA chats, but without a phone number. Should I call them on AU-RA, or tell me the number?`
      : `A ${sinNumero} lo tengo en tus chats de AU-RA, pero sin número de teléfono. ¿Le llamo por AU-RA o me dices el número?`;
  }
  return idioma === 'en'
    ? `I can't find «${q}» in your WhatsApp chats or contacts. Tell me the number and I'll dial it.`
    : `No encuentro a «${q}» en tus chats de WhatsApp ni en tus contactos. Dime el número y te lo marco.`;
}

/** La línea del estado del turno (lo que espera su «sí»). */
export function esperaDeMarcar(p: PropuestaMarcar): string {
  return `ESPERA SU «SÍ»: abrir el marcador${p.via === 'whatsapp' ? ' de WhatsApp' : ''} para llamar a ${conNombre(p) || 'ese número'} (${numeroLegible(p.numero)}). Si dice que sí, vuelve a pedir la misma llamada; si dice que no, no. Tú no hablas con esa persona: solo le abres el marcador.`;
}
