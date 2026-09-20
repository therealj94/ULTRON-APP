/**
 * Recuperación dirigida del cerebro de Orden Global.
 * El texto completo (src/05-cerebro-og/conocimiento.ts) va en el system; pero un 27B con un
 * prompt largo a veces «no encuentra» el dato. Aquí se eligen las líneas que hablan de lo que
 * preguntó la junta y se ponen como HECHO del turno, pegadas a la pregunta.
 */
import { CONOCIMIENTO_OG } from '../src/05-cerebro-og/conocimiento';

const fold = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Sinónimos: lo que dice la junta → palabras que aparecen en el cerebro. */
const ALIAS: Array<[RegExp, string[]]> = [
  [/\b5550\b|\bcadena\b|\bblockchain\b|\bbesu\b|\bqbft\b|\bvalidador/, ['5550', 'besu', 'qbft', 'validadores', 'rpc', 'ordenscan', 'gas', 'bloque', 'chain']],
  [/\borigen\b|\bgramin\b|\bogn\b/, ['origen', 'gramin', 'nativa', 'mytokenpay']],
  [/\bauka\b|\bonza\b|\bgold kapital\b/, ['auka', 'onza', 'kapital', '55.000.000']],
  [/\bagka\b|\bplata\b/, ['agka', 'plata']],
  [/\bondk\b|\bgobernanza\b/, ['ondk', 'gobernanza', 'rwa']],
  [/\bmina|\bminer|\bdanli\b|\bcholuteca\b|\bconcesi|\bkiri\b|\binhgeomin\b/, ['mina', 'minas', 'danli', 'choluteca', 'concesion', 'kiri', 'inhgeomin', 'metal', 'boveda', '43-101']],
  [/\bprospera\b|\broatan\b|\bzede\b|\bciadi\b|\brfsa\b/, ['prospera', 'roatan', 'zede', 'ciadi', 'rfsa', 'brimen', 'cafta']],
  [/\bjunta\b|\bfundador|\bcofundador|\bmedardo\b|\bjose\b|\bmelany\b|\bpaguada\b|\bleonardo\b|\bmayra\b|\bcarlos\b|\bjackson\b/, ['fundador', 'cofundador', 'medardo', 'jose', 'melany', 'paguada', 'mayra', 'carlos', 'jackson', 'junta']],
  [/\bveta\b|\bwallet\b|\bbilletera\b/, ['veta', 'wallet']],
  [/\bgenesis id\b|\bidentidad\b/, ['genesis id', 'identidad']],
  [/\bordenex\b|\bcasa de cambio\b/, ['ordenex', 'cambio']],
  [/\baucorp\b|\bau corp\b|\brampa\b/, ['aucorp', 'au corp', 'rampa', 'fiat']],
  [/\blei\b|\bsociedad|\bcorp\b/, ['lei', 'corp', 'sociedad']],
  [/\bremesa/, ['remesa', 'licencia']],
  [/\bultron\b|\bgenesis core\b|\baura\b|\bau-ra\b/, ['ultron', 'genesis core', 'au-ra', 'asistente']],
  [/\btoken/, ['token', 'origen', 'auka', 'agka', 'ondk', 'mnka', 'sectoriales']],
];

const LINEAS = CONOCIMIENTO_OG.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('-'));

/** Líneas del cerebro OG relevantes para el mensaje. Vacío si el tema no es de Orden Global. */
export function hechosOG(message: string, max = 14): string[] {
  const q = fold(message);
  if (!q) return [];
  const claves = new Set<string>();
  for (const [re, palabras] of ALIAS) if (re.test(q)) palabras.forEach((p) => claves.add(p));
  for (const w of q.split(/[^a-z0-9.-]+/)) if (w.length >= 5) claves.add(w);
  if (!claves.size) return [];
  const puntuadas = LINEAS.map((l, i) => {
    const f = fold(l);
    let score = 0;
    for (const c of claves) if (f.includes(c)) score += c.length >= 5 ? 2 : 1;
    return { l, i, score };
  }).filter((x) => x.score >= 2);
  puntuadas.sort((a, b) => b.score - a.score || a.i - b.i);
  return puntuadas
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.l);
}

export function hechoCerebroOG(message: string): string | null {
  const lineas = hechosOG(message);
  if (!lineas.length) return null;
  return `CEREBRO ORDEN GLOBAL (esto lo sabés de verdad; responde con esto y sin decir «no tengo acceso»):\n${lineas.join('\n')}`;
}
