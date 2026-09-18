/** Qué va a largo plazo vs plática. */

const SEMILLA = [
  'Junta Directiva de Orden Global: José Ordóñez y Medardo Ordóñez.',
  'José Ordóñez: junta, fundador, habla con ULTRON en el escritorio.',
  'Medardo Ordóñez: junta. Canción favorita: The Verve — Bitter Sweet Symphony.',
];

export function semillaLarga() {
  return SEMILLA.map((hecho) => ({ hecho, t: 0 }));
}

export function esHechoLargo(texto: string): boolean {
  const t = texto.toLowerCase();
  if (t.length < 8) return false;
  if (/^(hola|hey|qué onda|como estas|gracias|ok|va|sí|no)\b/.test(t) && t.length < 24) return false;
  return /recuerda|guard[ae]|anot[ae]|junta|rol(es)?|se llama|mi hermano|medardo|jos[eé] ord|fund[eé]|soy el|soy la|nuestra empresa|orden global/.test(t);
}

export function fusionarLarga(existente: { hecho: string; t: number }[], extra: string[]) {
  const out = [...existente];
  const seen = new Set(out.map((x) => x.hecho.toLowerCase()));
  for (const hecho of [...SEMILLA, ...extra]) {
    const k = hecho.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.unshift({ hecho, t: Date.now() });
  }
  return out.slice(0, 80);
}
