/**
 * Router único de skills. Front y server importan las mismas reglas.
 * Acentos opcionales: se pliegan.
 */

export type Skill =
  | 'spot_oro'
  | 'spot_plata'
  | 'fx_hnl'
  | 'web'
  | 'pagina'
  | 'canto'
  | 'cerebro'
  | 'clima'
  | 'vision'
  | 'chat';

export type SkillPayload = {
  query?: string;
  url?: string;
  ciudad?: string;
  clip?: string;
  hecho?: string;
};

export type SkillRoute = { skill: Skill; payload: SkillPayload };

export function foldSkill(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const CLIPS: { id: string; re: RegExp }[] = [
  { id: 'bohemian', re: /\b(canta\s*1|bohemian|rhapsody|queen)\b/ },
  { id: 'ligera', re: /\b(canta\s*2|musica ligera|soda|cerati)\b/ },
  { id: 'bittersweet', re: /\b(canta\s*3|bitter\s*sweet|sinfonia|the verve)\b/ },
  { id: 'runaway', re: /\b(canta\s*4|runaway|kanye)\b/ },
  { id: 'bruno', re: /\b(canta\s*5|bruno|die with a smile)\b/ },
];

function extraerUrl(raw: string): string | undefined {
  const m = String(raw || '').match(/https?:\/\/[^\s]+/i);
  return m ? m[0].replace(/[.,;]+$/, '') : undefined;
}

function ciudadClima(q: string, raw: string): string {
  const m = raw.match(/\bclima(?:\s+en)?\s+([a-záéíóúñ\s]{2,40})$/i) || q.match(/\bclima(?: en)? ([a-z\s]{2,40})$/);
  const c = String(m?.[1] || '').replace(/\?+$/, '').trim();
  return c || 'Tegucigalpa';
}

/**
 * Una sola puerta. Orden: canto/cerebro locales → web/página si lo piden → spots → chat.
 * «busca tipo de cambio BCH» es web, no fx_hnl.
 */
export function enrutar(texto: string): SkillRoute {
  const raw = String(texto || '').trim();
  const q = foldSkill(raw);
  if (!q) return { skill: 'chat', payload: { query: '' } };

  for (const c of CLIPS) {
    if (c.re.test(q)) return { skill: 'canto', payload: { clip: c.id } };
  }
  if (/\bcanta\b/.test(q) && q.length < 48) {
    return { skill: 'canto', payload: { clip: 'bittersweet' } };
  }

  if (
    /actualiza(r)? (el )?cerebro|guarda(lo)? en genesis|si,? (actualiza|guarda|aprende)|aprende eso|metelo al cerebro/.test(q)
  ) {
    return { skill: 'cerebro', payload: { hecho: raw } };
  }

  const url = extraerUrl(raw);
  if (/\b(abre|playwright|screenshot|captura)\b/.test(q) && (url || /\bhttps?:\/\//i.test(raw))) {
    return { skill: 'pagina', payload: { url: url || raw, query: raw } };
  }
  if (/\b(busca|investiga|noticia|noticias)\b/.test(q) || url) {
    return { skill: 'web', payload: { query: raw, url } };
  }

  if (/\b(que ves|que hay aqui|lee la foto|lee esta imagen|lee la imagen)\b/.test(q)) {
    return { skill: 'vision', payload: { query: raw } };
  }

  if (/\bclima\b/.test(q)) {
    return { skill: 'clima', payload: { ciudad: ciudadClima(q, raw), query: raw } };
  }

  if (/\b(lempira|hnl|dolar a lempira|usd a hnl|tipo de cambio)\b/.test(q)) {
    return { skill: 'fx_hnl', payload: { query: raw } };
  }
  if (/\b(plata|silver|xag)\b/.test(q)) {
    return { skill: 'spot_plata', payload: { query: raw } };
  }
  if ((/\b(oro|gold|xau)\b/.test(q) && !/\bmodo (oro|gold)\b/.test(q)) || (/\bonza\b/.test(q) && !/\bplata\b/.test(q))) {
    return { skill: 'spot_oro', payload: { query: raw } };
  }

  return { skill: 'chat', payload: { query: raw } };
}
