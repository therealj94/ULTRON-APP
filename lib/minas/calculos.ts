/**
 * CÁLCULOS DE MINERÍA — aritmética del oficio, sin modelo de por medio.
 *
 * Un 27B sabe hablar de leyes y tonelajes pero no es una calculadora: si le pedís las onzas de
 * 250.000 toneladas a 3,4 g/t te da un número creíble y, a veces, equivocado. Aquí las cuentas se
 * hacen en código, con la fórmula a la vista, y el modelo solo las cuenta. Ese es el trato.
 *
 * Todas las funciones son puras y están probadas en tests/minas.test.ts con números verificables
 * a mano. La entrada en lenguaje natural vive abajo, en `resolverCalculoMina`.
 */

/** Onza troy en gramos. Constante exacta por definición. */
export const GRAMOS_POR_ONZA_TROY = 31.1034768;
/** Tonelada corta (short ton) en kilogramos. */
export const KG_POR_TONELADA_CORTA = 907.18474;
/** Libras por tonelada métrica. */
export const LIBRAS_POR_TONELADA = 2204.62262;

export type Calculo = {
  /** Qué se calculó, para que AU-RA lo nombre. */
  tipo: string;
  /** El resultado ya redactado, en español y con unidades. Esto es lo que se dice en voz alta. */
  texto: string;
  /** La fórmula usada, para poder auditarla. */
  formula: string;
  /** Valores crudos, por si hace falta encadenar. */
  valores: Record<string, number>;
};

/* ------------------------------------------------------------------ conversiones */

/** g/t a onzas troy por tonelada corta. */
export const gtAOzPorToneladaCorta = (gt: number) => (gt * KG_POR_TONELADA_CORTA) / 1000 / GRAMOS_POR_ONZA_TROY;
/** Onzas troy por tonelada corta a g/t. 1 oz/st = 34,2857 g/t. */
export const ozPorToneladaCortaAGt = (oz: number) => (oz * GRAMOS_POR_ONZA_TROY * 1000) / KG_POR_TONELADA_CORTA;
/** Porcentaje a g/t. 1% = 10.000 g/t. */
export const porcentajeAGt = (pct: number) => pct * 10_000;
/** g/t a porcentaje. */
export const gtAPorcentaje = (gt: number) => gt / 10_000;
/** Volumen y densidad aparente a tonelaje. */
export const tonelajeDesdeVolumen = (metrosCubicos: number, densidad: number) => metrosCubicos * densidad;

/* ------------------------------------------------------------------ contenido metálico */

/** Onzas troy contenidas en un tonelaje a una ley dada. No descuenta recuperación. */
export function onzasContenidas(toneladas: number, leyGramosPorTonelada: number): number {
  return (toneladas * leyGramosPorTonelada) / GRAMOS_POR_ONZA_TROY;
}

/** Libras de metal base contenidas, a partir de una ley en porcentaje. */
export function librasContenidas(toneladas: number, leyPorcentaje: number): number {
  return ((toneladas * leyPorcentaje) / 100) * LIBRAS_POR_TONELADA;
}

/** Lo que de verdad sale de la planta: contenido por recuperación metalúrgica. */
export function recuperable(contenido: number, recuperacionPorcentaje: number): number {
  return contenido * (recuperacionPorcentaje / 100);
}

/**
 * Ley diluida: el estéril que entra con el mineral baja la ley que llega a planta.
 * dilución del 15% significa que 15 de cada 115 toneladas enviadas son estéril.
 */
export function leyDiluida(leyGramosPorTonelada: number, dilucionPorcentaje: number): number {
  return leyGramosPorTonelada / (1 + dilucionPorcentaje / 100);
}

/* ------------------------------------------------------------------ mina */

/** Relación de descapote: toneladas de estéril por tonelada de mineral. */
export function stripRatio(toneladasEsteril: number, toneladasMineral: number): number {
  if (toneladasMineral <= 0) return NaN;
  return toneladasEsteril / toneladasMineral;
}

/** Vida de mina en años: reservas sobre ritmo anual de tratamiento. */
export function vidaDeMina(reservasToneladas: number, toneladasPorAno: number): number {
  if (toneladasPorAno <= 0) return NaN;
  return reservasToneladas / toneladasPorAno;
}

/**
 * Ley de corte marginal en g/t: la ley a la que una tonelada apenas paga su propio proceso.
 * costo por tonelada / (precio por onza / gramos por onza x recuperación).
 */
export function leyDeCorte(opts: { costoPorTonelada: number; precioPorOnza: number; recuperacionPorcentaje: number }): number {
  const valorPorGramo = (opts.precioPorOnza / GRAMOS_POR_ONZA_TROY) * (opts.recuperacionPorcentaje / 100);
  if (valorPorGramo <= 0) return NaN;
  return opts.costoPorTonelada / valorPorGramo;
}

/** Costo todo incluido por onza vendida (AISC). */
export function aisc(costoTotalUsd: number, onzasVendidas: number): number {
  if (onzasVendidas <= 0) return NaN;
  return costoTotalUsd / onzasVendidas;
}

/* ------------------------------------------------------------------ redacción */

/**
 * Miles con punto y decimales con coma, que es como está escrito el resto del cerebro
 * («55.000.000», «31,1035»). Da igual para la voz, pero en Telegram se lee y tiene que ser uno solo.
 */
const nf = (n: number, dec = 0) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);

/** Número redondeado con criterio: mucho es entero, poco lleva decimales. */
function bonito(n: number): string {
  if (!isFinite(n)) return 'sin dato';
  const a = Math.abs(n);
  if (a >= 1000) return nf(n, 0);
  if (a >= 10) return nf(n, 1);
  if (a >= 1) return nf(n, 2);
  return nf(n, 3);
}

/* ------------------------------------------------------------------ lenguaje natural */

/**
 * Número escrito como lo escribe la gente: «250.000», «250,5», «1,5 millones», «3.4».
 * En español el punto separa miles y la coma decimales, pero medio mundo escribe al revés,
 * así que se decide por la forma y no por la fe.
 */
export function leerNumero(crudo: string): number {
  let s = String(crudo).trim().replace(/\s/g, '');
  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');
  if (tieneComa && tienePunto) {
    // El que aparece más a la derecha es el decimal.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (tieneComa) {
    // Una sola coma con uno o dos decimales es decimal; tres dígitos detrás son miles.
    s = /,\d{3}(\D|$)/.test(s) && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (tienePunto) {
    // Igual con el punto: «250.000» son miles, «3.4» es decimal.
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  return Number(s);
}

const MULTIPLO: Array<[RegExp, number]> = [
  [/\bmillones?\b|\bmill[oó]n\b|\bmm\b/, 1e6],
  [/\bmil\b|\bmiles\b/, 1e3],
];

/** Número con su multiplicador pegado: «1,5 millones de toneladas» → 1.500.000. */
function numeroConEscala(texto: string, numero: string, resto: string): number {
  const base = leerNumero(numero);
  for (const [re, mult] of MULTIPLO) if (re.test(resto.slice(0, 14))) return base * mult;
  return base;
}

function buscarTonelaje(q: string): number | null {
  const re = /(\d[\d.,]*)\s*((?:millones?|mill[oó]n|mil|miles)?\s*(?:de\s+)?(?:toneladas?|tons?|tm|t)\b)/i;
  const m = q.match(re);
  if (!m) return null;
  const v = numeroConEscala(q, m[1], m[2]);
  return isFinite(v) && v > 0 ? v : null;
}

function buscarLeyGt(q: string): number | null {
  const m = q.match(/(\d[\d.,]*)\s*(?:g\s*\/\s*t|gramos?\s*(?:por|\/)\s*tonelada|gr?\s*\/\s*t|ppm|g\s+por\s+tonelada)\b/i);
  if (m) return leerNumero(m[1]);
  // «a 3,4 gramos» dicho en corto, solo si ya hay tonelaje en la frase.
  const corto = q.match(/\ba\s+(\d[\d.,]*)\s*gramos?\b/i);
  return corto ? leerNumero(corto[1]) : null;
}

function buscarPorcentaje(q: string, etiqueta: RegExp): number | null {
  const re = new RegExp(`(?:${etiqueta.source})[^\\d%]{0,18}(\\d[\\d.,]*)\\s*%|(\\d[\\d.,]*)\\s*%[^\\d]{0,18}(?:${etiqueta.source})`, 'i');
  const m = q.match(re);
  if (!m) return null;
  return leerNumero(m[1] || m[2]);
}

function buscarPrecioOnza(q: string): number | null {
  const m = q.match(/(\d[\d.,]*)\s*(?:usd|d[oó]lares|dolares|\$)?\s*(?:la|por|\/)\s*onza|\$\s*(\d[\d.,]*)\s*(?:\/|por\s+)?oz/i);
  if (m) return leerNumero(m[1] || m[2]);
  const m2 = q.match(/(?:oro|precio)\D{0,20}(\d[\d.,]{3,})/i);
  return m2 ? leerNumero(m2[1]) : null;
}

/**
 * Traduce una pregunta de mina a un cálculo hecho. Devuelve null si la frase no pide una cuenta:
 * en ese caso contesta el cerebro y no se le mete un número a la fuerza.
 *
 * `precioOnza` lo pone quien llama (el spot en vivo de la mesa) para no tener que decirlo cada vez.
 */
export function resolverCalculoMina(mensaje: string, opts?: { precioOnza?: number }): Calculo | null {
  const q = String(mensaje || '').toLowerCase();
  if (!q) return null;

  // --- ley de corte
  if (/ley\s+de\s+corte|cut\s*-?\s*off|cutoff/.test(q)) {
    const costo = (() => {
      const m = q.match(/(\d[\d.,]*)\s*(?:usd|d[oó]lares|dolares|\$)?\s*(?:por|\/|la)\s*tonelada/i);
      return m ? leerNumero(m[1]) : null;
    })();
    const rec = buscarPorcentaje(q, /recuperaci[oó]n|recovery/) ?? 90;
    const precio = buscarPrecioOnza(q) ?? opts?.precioOnza ?? null;
    if (costo == null || precio == null) {
      return {
        tipo: 'ley-de-corte-incompleta',
        texto: `Para la ley de corte me falta ${costo == null ? 'el costo por tonelada' : 'el precio de la onza'}. Dámelo y te la saco.`,
        formula: 'ley de corte = costo por tonelada / (precio por onza / 31,1035 x recuperación)',
        valores: {},
      };
    }
    const corte = leyDeCorte({ costoPorTonelada: costo, precioPorOnza: precio, recuperacionPorcentaje: rec });
    return {
      tipo: 'ley-de-corte',
      texto: `Con un costo de ${bonito(costo)} dólares por tonelada, el oro a ${bonito(precio)} la onza y ${bonito(rec)} por ciento de recuperación, la ley de corte es de ${bonito(corte)} gramos por tonelada. Por debajo de eso la tonelada no paga su propio proceso.`,
      formula: `${costo} / ((${precio} / ${GRAMOS_POR_ONZA_TROY}) x ${rec / 100}) = ${corte.toFixed(3)} g/t`,
      valores: { costoPorTonelada: costo, precioPorOnza: precio, recuperacion: rec, leyDeCorte: corte },
    };
  }

  // --- relación de descapote
  if (/strip\s*ratio|relaci[oó]n\s+de\s+descapote|descapote/.test(q)) {
    const nums = [...q.matchAll(/(\d[\d.,]*)\s*((?:millones?|mill[oó]n|mil|miles)?\s*(?:de\s+)?(?:toneladas?|tons?|tm|t)\b)/gi)].map((m) => numeroConEscala(q, m[1], m[2]));
    if (nums.length >= 2) {
      const esteril = /est[eé]ril[^.]{0,40}?\d/.test(q) && !/\d[^.]{0,20}est[eé]ril/.test(q) ? nums[1] : nums[0];
      const mineral = esteril === nums[0] ? nums[1] : nums[0];
      const r = stripRatio(esteril, mineral);
      return {
        tipo: 'strip-ratio',
        texto: `La relación de descapote es de ${bonito(r)} a uno: ${bonito(r)} toneladas de estéril por cada tonelada de mineral. ${r > 8 ? 'Es alta; solo aguanta con ley buena.' : r > 3 ? 'A ese nivel el estéril ya manda en el costo.' : 'Es una relación cómoda.'}`,
        formula: `${esteril} / ${mineral} = ${r.toFixed(2)}`,
        valores: { esteril, mineral, stripRatio: r },
      };
    }
  }

  // --- conversión de unidades suelta
  const conv = q.match(/(\d[\d.,]*)\s*(?:onzas?\s*(?:por|\/)\s*(?:tonelada\s+corta|short\s*ton|st))\b/i);
  if (conv) {
    const oz = leerNumero(conv[1]);
    const gt = ozPorToneladaCortaAGt(oz);
    return {
      tipo: 'conversion',
      texto: `${bonito(oz)} onzas por tonelada corta son ${bonito(gt)} gramos por tonelada.`,
      formula: `${oz} x 31,1035 x 1000 / 907,185 = ${gt.toFixed(3)} g/t`,
      valores: { ozPorToneladaCorta: oz, gramosPorTonelada: gt },
    };
  }

  // --- contenido metálico: tonelaje + ley (lo que más se pregunta)
  const toneladas = buscarTonelaje(q);
  const ley = buscarLeyGt(q);
  if (toneladas != null && ley != null) {
    const dilucion = buscarPorcentaje(q, /diluci[oó]n|dilution/);
    const leyUsada = dilucion != null ? leyDiluida(ley, dilucion) : ley;
    const onzas = onzasContenidas(toneladas, leyUsada);
    const rec = buscarPorcentaje(q, /recuperaci[oó]n|recovery/);
    const precio = buscarPrecioOnza(q) ?? opts?.precioOnza ?? null;
    const partes = [
      `${nf(toneladas)} toneladas a ${bonito(leyUsada)} gramos por tonelada dan ${nf(onzas)} onzas contenidas.`,
    ];
    const valores: Record<string, number> = { toneladas, ley, leyUsada, onzasContenidas: onzas };
    if (dilucion != null) {
      partes.unshift(`Con ${bonito(dilucion)} por ciento de dilución la ley baja de ${bonito(ley)} a ${bonito(leyUsada)} gramos.`);
      valores.dilucion = dilucion;
    }
    let paraValor = onzas;
    if (rec != null) {
      paraValor = recuperable(onzas, rec);
      partes.push(`Con ${bonito(rec)} por ciento de recuperación salen ${nf(paraValor)} onzas recuperables.`);
      valores.recuperacion = rec;
      valores.onzasRecuperables = paraValor;
    }
    if (precio != null) {
      const valor = paraValor * precio;
      partes.push(`A ${bonito(precio)} dólares la onza son ${nf(valor)} dólares${rec == null ? ' en metal contenido, sin descontar recuperación' : ''}. Ojo: es valor bruto, no ganancia; falta costo de mina, proceso y tiempo.`);
      valores.precioPorOnza = precio;
      valores.valorBruto = valor;
    }
    return {
      tipo: 'contenido-metalico',
      texto: partes.join(' '),
      formula: `${toneladas} t x ${leyUsada.toFixed(3)} g/t / 31,1035 = ${onzas.toFixed(1)} oz`,
      valores,
    };
  }

  return null;
}
