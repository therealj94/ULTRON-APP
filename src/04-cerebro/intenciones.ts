/**
 * Intenciones locales: lo que la mesa resuelve SIN cerebro (gags, canto, modos, memoria).
 * Una tabla, con límites de palabra y frases cortas: «para mañana necesito…» va al cerebro,
 * «para» solo, calla. Todo lo que no calce aquí es un turno del 27B.
 */

export type Intencion =
  | { tipo: 'callar' }
  | { tipo: 'cantar'; pedido: string }
  | { tipo: 'orar' }
  | { tipo: 'chiste' }
  | { tipo: 'emocion'; emocion: string; dicho: string }
  | { tipo: 'dormir' }
  | { tipo: 'despertar' }
  | { tipo: 'modo'; modo: string; dicho: string }
  | { tipo: 'foto' }
  | { tipo: 'recordar'; hecho: string }
  | { tipo: 'genesis' }
  | { tipo: 'capacidades' }
  | { tipo: 'cerebro'; texto: string };

const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const MODOS: Array<{ re: RegExp; modo: string; dicho: string }> = [
  { re: /^modo (explorador|explorer)$/, modo: 'EXPLORER', dicho: 'Modo explorador.' },
  { re: /^modo guardian$/, modo: 'GUARDIAN', dicho: 'Modo guardián.' },
  { re: /^modo mineria$/, modo: 'MINING', dicho: 'Modo minería.' },
  { re: /^modo (oro|gold)$/, modo: 'GOLD', dicho: 'Modo oro.' },
  { re: /^modo creativo$/, modo: 'CREATIVE', dicho: 'Modo creativo.' },
  { re: /^modo analitico$/, modo: 'ANALYTICAL', dicho: 'Modo analítico.' },
  { re: /^modo estrategico$/, modo: 'STRATEGIC', dicho: 'Modo estratégico.' },
];

const EMOCIONES: Array<{ re: RegExp; emocion: string; dicho: string }> = [
  { re: /^(ponete|ponte|estas|estate) (enojad[oa]|molest[oa])$|^enojate$|^enojado$/, emocion: 'molesto', dicho: 'molesto' },
  { re: /^(ponete|ponte|estate) (feliz|content[oa]|alegre)$|^feliz$/, emocion: 'feliz', dicho: 'orgullo' },
  { re: /^(ponete|ponte) triste$|^triste$/, emocion: 'triste', dicho: 'triste' },
  { re: /^(ponete|ponte) (curios[oa])$|^curioso$/, emocion: 'curioso', dicho: 'sorpresa' },
  { re: /^(sorprendete|sorpresa)$/, emocion: 'sorpresa', dicho: 'sorpresa' },
  { re: /^(reite|riete|risa|jaja|jeje)$/, emocion: 'risa', dicho: 'risa' },
  { re: /^(cansado|estas cansado)$/, emocion: 'cansado', dicho: 'cansado' },
  { re: /^(guino|guiname|guiname un ojo)$/, emocion: 'travieso', dicho: 'je' },
];

export function detectarIntencion(texto: string): Intencion {
  const q = fold(texto);
  const palabras = q.split(' ').filter(Boolean);
  const corto = palabras.length <= 6;

  if (/^(para|calla|callate|silencio|basta|shh|ya)$/.test(q)) return { tipo: 'callar' };

  const rec = texto.match(/^\s*(?:(?:ultron|aura|au-ra|au ra)[,\s]+)?(?:recuerda|record[aá]|acordate|guarda|anot[aá])(?: que)?\s+(.{6,})$/i);
  if (rec) return { tipo: 'recordar', hecho: rec[1].trim() };

  if (/^(si )?(actualiza|actualizar) (el )?cerebro$|^guardalo en genesis$|^aprende eso$|^metelo al cerebro$/.test(q)) return { tipo: 'genesis' };

  if (/^(canta|cantame|cantate|cantas)( .*)?$/.test(q) || /^(una|otra) cancion( .*)?$/.test(q) || /^way ?maker$/.test(q)) return { tipo: 'cantar', pedido: texto };
  if (
    /^(ora|orá|oremos|reza|rezá|rezemos)( .*)?$/.test(q) ||
    /^(hace|hacé|haz|hazme|haceme|dime|decime|hagamos|podes hacer|puedes hacer) (una )?oraci[oó]n( .*)?$/.test(q) ||
    /\b(oracion|oración) (del|por el|para el|de hoy|del dia|por hoy)\b/.test(q) ||
    /^(bendice|bendici|bendecí|bendiga|bendecinos|bendicion para) (el|nuestro|este|mi) ?dia( .*)?$/.test(q) ||
    /^(ora|orá|reza|rezá) por (el dia|hoy|nosotros|la junta|orden global)$/.test(q)
  )
    return { tipo: 'orar' };

  if (corto && /^(cuenta|contame|cuentame|dime|decime)( otro)? (un )?chiste$|^(otro )?chiste$|^hazme reir$|^haceme reir$/.test(q)) return { tipo: 'chiste' };

  if (corto && /^que (puedes|podes|sabes|haces|hace[s]?) ?(hacer)?( por mi)?$|^capacidades$|^que ofreces$/.test(q)) return { tipo: 'capacidades' };

  for (const e of EMOCIONES) if (corto && e.re.test(q)) return { tipo: 'emocion', emocion: e.emocion, dicho: e.dicho };
  for (const m of MODOS) if (m.re.test(q)) return { tipo: 'modo', modo: m.modo, dicho: m.dicho };

  if (corto && /^(dormi|dormite|duermete|a dormir|reposo|descansa)$/.test(q)) return { tipo: 'dormir' };
  if (corto && /^(desperta|despertate|despierta|arriba|buenos dias (?:ultron|aura))$/.test(q)) return { tipo: 'despertar' };
  if (corto && /^(toma|tomame|sacame|saca) (una )?(foto|selfie)$|^foto$|^selfie$/.test(q)) return { tipo: 'foto' };

  return { tipo: 'cerebro', texto };
}
