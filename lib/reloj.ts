/** Reloj de junta: America/Tegucigalpa. Cero alucinación. */

export function ahoraHonduras(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Tegucigalpa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

export function lineaReloj(d = new Date()): string {
  return `AHORA Honduras: ${ahoraHonduras(d)} (America/Tegucigalpa).`;
}

export function preguntaHora(texto: string): boolean {
  return /\b(qu[eé] hora|que hora|hora es|hora ten[eé]s|hora tienes)\b/i.test(String(texto || ''));
}
