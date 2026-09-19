/** Clima público. Default Tegucigalpa. Citar fuente. Cero invención. */

export type ClimaHecho = { hecho: string; fuente: string };

const CIUDADES: Record<string, { lat: number; lon: number }> = {
  tegucigalpa: { lat: 14.0723, lon: -87.1921 },
  'san pedro sula': { lat: 15.5, lon: -88.0333 },
  'la ceiba': { lat: 15.7597, lon: -86.7822 },
  comayagua: { lat: 14.45, lon: -87.64 },
  choluteca: { lat: 13.3, lon: -87.19 },
  danli: { lat: 14.0333, lon: -86.5833 },
};

function norm(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export async function consultarClima(ciudadRaw = 'Tegucigalpa'): Promise<ClimaHecho> {
  const key = norm(ciudadRaw) || 'tegucigalpa';
  const geo = CIUDADES[key] || CIUDADES.tegucigalpa;
  const nombre = CIUDADES[key] ? ciudadRaw.trim() : 'Tegucigalpa';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&timezone=America%2FTegucigalpa`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const j: any = await r.json();
    const c = j?.current || {};
    const t = c.temperature_2m;
    if (t === undefined || t === null) {
      return { hecho: `CLIMA ${nombre}: la fuente no trajo temperatura. No invento.`, fuente: 'open-meteo.com' };
    }
    return {
      hecho: `CLIMA ${nombre}: ${t} °C, humedad ${c.relative_humidity_2m ?? '?'} %, viento ${c.wind_speed_10m ?? '?'} km/h (código ${c.weather_code ?? '?'}). Fuente Open-Meteo.`,
      fuente: 'open-meteo.com',
    };
  } catch (e: any) {
    return {
      hecho: `CLIMA ${nombre}: no alcancé Open-Meteo (${String(e?.message || e).slice(0, 80)}). No invento el tiempo.`,
      fuente: 'open-meteo.com',
    };
  }
}
