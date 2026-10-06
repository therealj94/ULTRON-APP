/**
 * EL INTERVALO QUE PIDE UNA FRASE DE CORREO (LANG-02) — «el último correo de AYER», «de esta tarde», «de la última
 * semana», "yesterday's latest email".
 *
 * El atajo de «el último correo» abría el más reciente de todas sus cuentas aunque la persona dijera «de ayer»: con uno
 * de hoy más nuevo, leía el de hoy. Aquí se saca el intervalo pedido, en hora de Honduras (America/Tegucigalpa: UTC−6
 * todo el año, sin horario de verano), para escoger DENTRO de él.
 *
 * Devuelve:
 *  · `{ desde, hasta, etiqueta }` (ms, `hasta` excluido) cuando la frase nombra un momento reconocible;
 *  · `{ futuro: true, etiqueta }` cuando nombra un momento que todavía no llega («de mañana», «de esta noche» a las
 *    10 a. m., «next week»): no puede haber correos de ahí y no se abre otro en su lugar;
 *  · null si no nombra ninguno (el atajo genérico de siempre).
 */

export const HN_OFFSET_MS = -6 * 3600_000;
const DIA = 24 * 3600_000;
const HORA = 3600_000;

export type Intervalo = { futuro?: false; desde: number; hasta: number; etiqueta: string } | { futuro: true; etiqueta: string };

/** Medianoche en Honduras del día de `t` (en ms UTC). */
export function medianocheHN(t: number): number {
  return Math.floor((t + HN_OFFSET_MS) / DIA) * DIA - HN_OFFSET_MS;
}

const plegar = (s: string) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Momentos que no han llegado. «mañana» sin artículo es el día de mañana; «la mañana», la parte del día. */
const FUTURO =
  /\b(pasado manana|day after tomorrow|tomorrow|next (?:week|month|year)|(?:la |el )?(?:proxima|siguiente) semana|(?:el )?(?:proximo|siguiente) mes|(?:el )?(?:proximo|siguiente) ano)\b|(?:^|\s)(?:de|del|para|el de) manana\b|^manana\b/;
const ANTEAYER = /\b(anteayer|antier|antes de ayer|antes de anoche|day before yesterday)\b/;
const AYER = /\b(ayer|yesterday)\b/;
const ANOCHE = /\b(anoche|last night)\b/;
const HOY = /\b(hoy|today|this morning|this afternoon|this evening|tonight|esta manana|esta tarde|esta noche|de la manana|de la tarde|de la noche|en la manana|en la tarde|en la noche|por la manana|por la tarde|por la noche|in the morning|in the afternoon|in the evening)\b/;
const PARTE: Array<[RegExp, number, number, string]> = [
  [/\b(?:(?:esta|en la|por la|de la) manana|(?:this|in the) morning)\b/, 0, 12, 'en la mañana'],
  [/\b(?:(?:esta|en la|por la|de la) tarde|(?:this|in the) afternoon)\b/, 12, 18, 'en la tarde'],
  [/\b(?:(?:esta|en la|por la|de la) noche|tonight|(?:this|in the) evening|at night)\b/, 18, 24, 'en la noche'],
];
const ULTIMOS_DIAS = /\b(?:(?:la|esta) ultima semana|los ultimos (?<n>\d{1,2}|siete|7) dias|(?:the )?past week|(?:the )?last (?<m>\d{1,2}|seven) days|this past week)\b/;
const ESTA_SEMANA = /\b(?:esta semana|this week|en la semana)\b/;
const SEMANA_PASADA = /\b(?:la semana pasada|la semana anterior|last week|previous week)\b/;
const ESTE_MES = /\b(?:este mes|this month)\b/;
const MES_PASADO = /\b(?:el mes pasado|el mes anterior|last month|previous month)\b/;
const ULTIMAS_HORAS = /\b(?:(?:las )?ultimas (?<n>\d{1,2}) horas|(?:the )?last (?<m>\d{1,2}) hours|la ultima hora|(?:the )?last hour)\b/;

/**
 * Todas las expresiones de tiempo de arriba, con su «de / del / from» delante: para quitarlas de la frase antes de mirar
 * si nombra un remitente («el último correo de AYER» no es de alguien llamado «ayer»).
 */
export const TIEMPO_EN_FRASE = new RegExp(
  String.raw`(?:\b(?:de|del|desde|en|por|from|of|in)\s+)?(?:` +
    [FUTURO, ANTEAYER, AYER, ANOCHE, HOY, ULTIMOS_DIAS, ESTA_SEMANA, SEMANA_PASADA, ESTE_MES, MES_PASADO, ULTIMAS_HORAS, ...PARTE.map((p) => p[0])]
      .map((r) => r.source.replace(/\(\?<\w+>/g, "(?:"))
      .join('|') +
    ')',
  'g'
);

/** La frase sin sus expresiones de tiempo (plegada). */
export function sinTiempo(texto: string): string {
  return plegar(texto).replace(TIEMPO_EN_FRASE, ' ').replace(/\s+/g, ' ').trim();
}

const NUM: Record<string, number> = { siete: 7, seven: 7 };

/**
 * El intervalo que pide la frase, en hora de Honduras. `ahora` es inyectable (las pruebas fijan el reloj).
 * `tolerancia`: cuánto en el futuro se acepta como «ahora» (relojes un poco adelantados).
 */
export function intervaloDeCorreo(texto: string, ahora = Date.now(), tolerancia = 10 * 60_000): Intervalo | null {
  const q = plegar(texto);
  if (!q) return null;
  const tope = ahora + tolerancia;
  const hoy0 = medianocheHN(ahora);
  const cerrar = (desde: number, hasta: number, etiqueta: string): Intervalo =>
    desde > tope ? { futuro: true, etiqueta } : { desde, hasta: Math.min(hasta, tope), etiqueta };

  if (FUTURO.test(q)) {
    const m = FUTURO.exec(q)!;
    return { futuro: true, etiqueta: m[0].trim() };
  }
  const horas = ULTIMAS_HORAS.exec(q);
  if (horas) {
    const n = Number(horas.groups?.n || horas.groups?.m || 1);
    return cerrar(ahora - n * HORA, tope, n === 1 ? 'de la última hora' : `de las últimas ${n} horas`);
  }
  const dias = ULTIMOS_DIAS.exec(q);
  if (dias) {
    const crudo = dias.groups?.n || dias.groups?.m || '7';
    const n = NUM[crudo] ?? Number(crudo);
    return cerrar(ahora - n * DIA, tope, n === 7 ? 'de la última semana' : `de los últimos ${n} días`);
  }
  // Semana de lunes a domingo, como se cuenta en Honduras.
  const diaSemana = (new Date(hoy0 - HN_OFFSET_MS).getUTCDay() + 6) % 7; // 0 = lunes
  const lunes = hoy0 - diaSemana * DIA;
  if (SEMANA_PASADA.test(q)) return cerrar(lunes - 7 * DIA, lunes, 'de la semana pasada');
  if (ESTA_SEMANA.test(q)) return cerrar(lunes, tope, 'de esta semana');
  const f = new Date(hoy0 - HN_OFFSET_MS);
  const primeroMes = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1) - HN_OFFSET_MS;
  if (MES_PASADO.test(q)) return cerrar(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, 1) - HN_OFFSET_MS, primeroMes, 'del mes pasado');
  if (ESTE_MES.test(q)) return cerrar(primeroMes, tope, 'de este mes');

  if (ANOCHE.test(q) && !ANTEAYER.test(q)) return cerrar(hoy0 - 6 * HORA, hoy0 + 6 * HORA, 'de anoche');
  let dia: number | null = null;
  let etiquetaDia = '';
  if (ANTEAYER.test(q)) {
    dia = hoy0 - 2 * DIA;
    etiquetaDia = 'de anteayer';
  } else if (AYER.test(q)) {
    dia = hoy0 - DIA;
    etiquetaDia = 'de ayer';
  } else if (HOY.test(q)) {
    dia = hoy0;
    etiquetaDia = 'de hoy';
  }
  if (dia === null) return null;
  const parte = PARTE.find(([re]) => re.test(q));
  if (parte) {
    const [, h0, h1, nombre] = parte;
    const etiqueta = dia === hoy0 ? (nombre === 'en la noche' ? 'de esta noche' : `de esta ${nombre.replace('en la ', '')}`) : `${etiquetaDia} ${nombre}`;
    return cerrar(dia + h0 * HORA, dia + h1 * HORA, etiqueta);
  }
  return cerrar(dia, dia + DIA, etiquetaDia);
}

/** ¿El instante `t` (ms) cae dentro del intervalo? */
export function dentroDe(i: Exclude<Intervalo, { futuro: true }>, t: number): boolean {
  return Number.isFinite(t) && t >= i.desde && t < i.hasta;
}
