/** Qué va a largo plazo vs plática. */

const SEMILLA = [
  'Junta: Medardo Ordóñez fundador; José, Melany Ordóñez y Leonardo Paguada cofundadores. Mayra Enamorado también junta.',
  'José Ordóñez: cofundador, junta, habla con AU-RA. Acceso mando: puede cambiar el sistema.',
  'Medardo José Ordóñez Enamorado: fundador. The Verve — Bitter Sweet Symphony. Acceso mando.',
  'José Ordóñez: Kanye West — Runaway (el brindis).',
  'Carlos Paguada: junta. Acceso consulta a AU-RA. Cerebro propio. No cambia el sistema.',
  'Mayra Enamorado: junta. Acceso consulta a AU-RA. Cerebro propio. No cambia el sistema.',
];

export function semillaLarga() {
  return SEMILLA.map((hecho) => ({ hecho, t: 0 }));
}

export function esHechoLargo(texto: string): boolean {
  const t = texto.toLowerCase();
  if (t.length < 8) return false;
  if (/^(hola|hey|qué onda|como estas|gracias|ok|va|sí|no)\b/.test(t) && t.length < 24) return false;
  return /recuerda|guard[ae]|anot[ae]|junta|rol(es)?|se llama|mi hermano|medardo|jos[eé] ord|melany|paguada|fund[eé]|cofund|soy el|soy la|nuestra empresa|orden global|prospera|aucorp|ordenex|mina|concesi[oó]n/.test(t);
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
