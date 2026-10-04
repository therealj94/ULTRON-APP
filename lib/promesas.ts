/**
 * PROMETER SIN HACER (José, 4-oct, conversación de voz de las 00:55 UTC: «lo puse a investigar algo, dijo que
 * sí pero nunca empezó, y le pedí que me enviara por PULSE2CHAT lo que investigó y me avisara, y nada»).
 *
 * Lo que pasó, turno por turno (registros durables del turno):
 *  · «Ya está encendida. ¿Qué necesitás que haga?» — sin ninguna herramienta: su computadora no se tocó.
 *  · Buscó dos veces en internet y contestó «¿Querés que busque los hitos…? Puedo traerte datos concretos».
 *  · Buscó y contestó «Voy a buscar los hitos clave de Honduras» (dos veces): prometió lo que ya había hecho.
 *  · «Va, te aviso por PULSE2CHAT cuando termine. HARNESS web …»: el volcado crudo de la herramienta en la voz,
 *    y una promesa imposible (el servidor no escribe en PULSE2CHAT: es cifrado de punta a punta por un relevo
 *    de afuera y ahí no hay un chat de AURA) que además nadie empezó.
 *
 * Aquí, sin red y sin dependencias (lo usan lib/harness.ts y server.ts):
 *  · `clasificarFrase` / `clasificarPromesas`: ¿la respuesta promete trabajo futuro o en curso («voy a buscar»,
 *    «ya lo busco», «te aviso», «ahí voy», «empiezo», «lo estoy haciendo»), dice un estado de su computadora
 *    («ya está encendida»), promete escribir por PULSE2CHAT, u ofrece buscar («¿quieres que busque…?»)?
 *    Conservador: una oferta en pregunta no es promesa, una negación tampoco, y una respuesta normal no se toca.
 *  · `vigilarPromesas`: la guarda del final del turno. Lo que promete y ninguna herramienta de ESTE turno
 *    respalda no se entrega: se quita y se dice con honradez («Todavía no lo empecé…»). Si en el turno ya hubo
 *    resultados de una búsqueda, la respuesta los usa (un resumen corto hecho con ellos) en vez de prometer o
 *    preguntar si busca.
 *  · `resumenDeResultados` / `lineaDeResultado`: lo que trajo una búsqueda dicho como persona, nunca el volcado
 *    `HARNESS web …` (eso es para el modelo).
 *  · `quitarVolcados`: el volcado `HARNESS <herramienta> …` nunca llega a lo que se lee ni a lo que se dice.
 */

/* ------------------------------------------------------------------ normalizar */

/** Sin tildes, en minúsculas, sin etiquetas de ánimo ni de voz ([EMO: x], [risa]). */
export function plano(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[[^\]]{0,30}\]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Las frases de un texto (lo que va entre puntos, signos o saltos), con su puntuación y sus espacios: unidas
 * con '' devuelven el texto exacto. Una pregunta abre con «¿»: lo de antes es otra frase («Ya está encendida
 * ¿qué hago?»). Un punto entre cifras («4.163») no corta.
 */
export function frases(texto: string): string[] {
  const t = String(texto || '');
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if ((ch === '¿' || ch === '¡') && cur.trim()) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
    if (ch === '\n') {
      out.push(cur);
      cur = '';
      continue;
    }
    if (/[.!?…]/.test(ch) && !/[.!?…]/.test(t[i + 1] || '') && !(ch === '.' && /\d/.test(t[i - 1] || '') && /\d/.test(t[i + 1] || ''))) {
      while (t[i + 1] === ' ' || t[i + 1] === '\t') cur += t[++i];
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ------------------------------------------------------------------ las clases */

/** Qué promete una frase. `trabajo`: algo que hace o va a hacer; `aviso`: avisar después; `computadora`: un estado de su computadora. */
export type TipoPromesa = 'trabajo' | 'aviso' | 'computadora' | 'pulse' | 'oferta';

// Trabajo futuro o en curso (se compara en `plano`: sin tildes y en minúsculas).
const VERBOS_TRABAJO = 'buscar|investigar|revisar|averiguar|consultar|checar|chequear|indagar|rastrear|recopilar|ponerme|empezar|comenzar|encender|prender';
const TRABAJO = new RegExp(
  [
    // «voy a buscar», «voy a ponerme con eso», «ya voy a investigarlo»
    `\\bvoy a (${VERBOS_TRABAJO})`,
    // «ya lo busco», «ahora lo reviso», «ahorita te lo investigo», «enseguida lo averiguo»
    '\\b(ya|ahora|ahorita|enseguida|en seguida|al tiro|de una) (mismo )?(te |se )?(lo |la |los |las )?(busco|investigo|reviso|averiguo|consulto|checo|chequeo|hago|empiezo|abro|enciendo|prendo)\\b',
    // «te lo busco», «te investigo eso» (sin «¿»: la oferta en pregunta se quitó antes)
    '\\bte (lo |la |los |las )?(busco|investigo|averiguo|reviso|consulto)\\b',
    // «déjame buscarlo», «déjame investigar» (no «déjame ver»: es muletilla de una respuesta normal)
    '\\bdejame (buscar|investigar|revisar|averiguar|consultar|checar|chequear|indagar)',
    // «ahí voy», «allá voy», «manos a la obra», «en eso estoy», «ya estoy en eso»
    '\\b(ahi|alla) voy\\b',
    '\\bmanos a la obra\\b',
    '\\b(en eso|en ello) (estoy|ando)\\b',
    '\\b(ya )?(estoy|ando) (en eso|en ello|trabajando en)',
    // «empiezo ya», «ya empecé», «comienzo a buscar», «arranco con eso»
    '\\b(empiezo|comienzo|arranco) (ya|ahora|ahorita|de una|a (buscar|investigar|revisar|averiguar|trabajar)|con (eso|ello|la investigacion|la busqueda))\\b',
    '\\bya (empece|comence|arranque)\\b',
    // «lo estoy haciendo», «estoy buscando eso», «ya lo estoy investigando»
    '\\b(lo|la|los|las) estoy (haciendo|buscando|investigando|revisando|averiguando|preparando|consultando|leyendo)\\b',
    '\\b(ya )?estoy (buscando|investigando|revisando|averiguando|consultando|recopilando|indagando)\\b',
    // inglés
    "\\b(i'?ll|i will|let me) (search|look (it )?up|look into|research|check|find out|dig)\\b",
    "\\b(i'?m|i am) (searching|looking (it )?up|looking into|researching|checking|on it|working on it)\\b",
  ].join('|')
);

// Avisar después: «te aviso», «te cuento cuando termine», «te mando el resultado».
const AVISO = new RegExp(
  [
    '\\bte (lo |la )?(aviso|avisare|notifico|notificare)\\b(?! (que|de que)\\b)',
    '\\b(ya |luego |despues |mas tarde )?te (cuento|digo|mando|envio|paso|escribo) (cuando|en cuanto|apenas|al terminar|lo que encuentre|el resultado|los resultados|lo que investigue)',
    '\\b(cuando|en cuanto|apenas) (termine|tenga|acabe|lo tenga|tenga algo)[^.?!]{0,40}\\bte (aviso|cuento|digo|mando|envio|escribo)',
    "\\b(i'?ll|i will) (let you know|get back to you|notify you|text you|message you)\\b",
  ].join('|')
);

// Un estado de su computadora: «ya está encendida», «ya la prendí», «la computadora ya está lista».
const COMPUTADORA = new RegExp(
  [
    '\\bya (esta|quedo) (encendid|prendid)[oa]\\b',
    '\\bya (la |lo )?(encendi|prendi)\\b',
    '\\b(mi|la|tu) (computadora|compu|pc|maquina) (ya )?(esta|quedo) (encendida|prendida|lista|abierta|corriendo|funcionando)\\b',
    '\\b(encendi|prendi) (la |mi |tu )?(computadora|compu|pc|maquina)\\b',
  ].join('|')
);

// Escribirle a la persona por PULSE2CHAT: el servidor no puede (cifrado de punta a punta, sin chat de AURA).
const PULSE = /\bpulse ?2 ?chat\b/;
const PULSE_A_ELLA = /\b(te|te lo|te la|te los) (aviso|avisare|mando|envio|escribo|notifico|cuento)\b|\b(avisarte|mandarte|enviarte|escribirte|notificarte|mandartelo|enviartelo)\b|\b(i'?ll|i will) (send|text|message|notify) you\b/;

// Ofrecer buscar (en pregunta o «puedo traerte…»): con resultados ya en el turno, eso es no contestar.
const OFERTA_BUSCAR = new RegExp(
  [
    '\\b(quieres|queres|quiere|te gustaria|gustas|deseas) que (te |le )?(lo |la |los |las )?(busque|investigue|averigue|revise|consulte|traiga|indague|mire|cheque)',
    '\\b(te|le) (lo |la |los |las )?(busco|investigo|averiguo|reviso|traigo)\\b',
    '^\\s*¿?\\s*(busco|investigo|averiguo|reviso)\\b',
    '\\bpuedo (buscar|investigar|averiguar|revisar|traerte|traer|buscarte|investigarte|conseguirte|darte datos)',
    "\\b(do you want|would you like|want) me to (search|look|find|check|research)\\b",
    "\\bi can (search|look (it )?up|find|research)\\b",
  ].join('|')
);

/** Una frase que niega lo que haría («no voy a buscar eso», «todavía no lo empecé»). */
const NIEGA = /\b(no|nunca|todavia no|aun no|tampoco|jamas|not|never|haven'?t|didn'?t)\b[^.?!]{0,24}$/;

/** Una oferta condicional: «si quieres, te aviso…», «cuando quieras lo busco». No es promesa: espera su sí. */
const CONDICIONAL = /^\s*(y\s+)?(si (quieres|queres|gustas|te parece|prefieres|me dices|lo necesitas)|cuando (quieras|me digas)|if you (want|like))\b/;

/**
 * Las clases de UNA frase (puede ser varias: «Va, te aviso por PULSE2CHAT cuando termine» es aviso y pulse).
 * Una pregunta («¿Te lo busco?») solo puede ser oferta; una oferta condicional o una negación, nada.
 */
export function clasificarFrase(frase: string): TipoPromesa[] {
  const p = plano(frase);
  if (!p) return [];
  const tipos: TipoPromesa[] = [];
  const pregunta = /[¿?]/.test(frase);
  if (OFERTA_BUSCAR.test(p) && (pregunta || /\bpuedo |\bi can /.test(p))) tipos.push('oferta');
  if (pregunta || CONDICIONAL.test(p)) return tipos;
  const sinNegar = (re: RegExp) => {
    const m = re.exec(p);
    return !!m && !NIEGA.test(p.slice(0, m.index));
  };
  if (PULSE.test(p) && PULSE_A_ELLA.test(p)) tipos.push('pulse');
  if (sinNegar(COMPUTADORA)) tipos.push('computadora');
  if (sinNegar(TRABAJO)) tipos.push('trabajo');
  if (sinNegar(AVISO)) tipos.push('aviso');
  return tipos;
}

export type Clasificacion = { promete: boolean; tipos: TipoPromesa[]; frases: { frase: string; tipos: TipoPromesa[] }[] };

/** Las clases de un texto entero (las líneas ACCION_APP / PEDIR_HERRAMIENTA no cuentan). */
export function clasificarPromesas(texto: string): Clasificacion {
  const lista = frases(sinLineasDeMaquina(texto)).map((frase) => ({ frase, tipos: clasificarFrase(frase) }));
  const tipos = [...new Set(lista.flatMap((x) => x.tipos))];
  return { promete: tipos.some((t) => t !== 'oferta'), tipos, frases: lista.filter((x) => x.tipos.length) };
}

/** ¿Este trozo (lo que el streaming está por soltar) promete trabajo, un aviso o un estado de su computadora? */
export function trozoPromete(trozo: string): boolean {
  return frases(trozo).some((f) => clasificarFrase(f).some((t) => t !== 'oferta'));
}

/** ¿Promete, o (con resultados ya en el turno) ofrece buscar? Para retener la frase en una vuelta del harness. */
export function trozoPrometeUOfrece(trozo: string): boolean {
  return frases(trozo).some((f) => clasificarFrase(f).length > 0);
}

const LINEA_MAQUINA = /^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:.*$/gim;
const sinLineasDeMaquina = (t: string) => String(t || '').replace(LINEA_MAQUINA, '');

/* ------------------------------------------------------------------ los volcados */

/**
 * El volcado de una herramienta (`HARNESS web "…": 1. …`, `HARNESS leer (…): …`, `PRIMERA FUENTE (…): …`) es
 * para el modelo: nunca va a lo que se lee ni a lo que se dice. Se quita desde la marca hasta el final del
 * bloque (la línea vacía siguiente o el final).
 */
const VOLCADO = /(^|\n|\s)(HARNESS\s+[a-z]+\b|PRIMERA FUENTE \()[\s\S]*?(?=\n\s*\n|$)/g;
export function quitarVolcados(texto: string): string {
  return String(texto || '')
    .replace(VOLCADO, (_m, antes: string) => (antes === '\n' ? '\n' : antes ? ' ' : ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
export const tieneVolcado = (t: string) => /\bHARNESS\s+[a-z]+\b/.test(String(t || ''));

/* ------------------------------------------------------------------ lo que trajo una búsqueda, dicho como persona */

export type Hallazgo = { titulo: string; resumen: string; url: string };

/** Los resultados de un volcado `HARNESS web "q":\n1. Título — resumen [url]`. Vacío si no es eso. */
export function hallazgosDeWeb(texto: string): { consulta: string; hallazgos: Hallazgo[]; pagina: string } {
  const t = String(texto || '');
  const consulta = /HARNESS web "([^"]*)"/.exec(t)?.[1] || '';
  const hallazgos: Hallazgo[] = [];
  for (const m of t.matchAll(/^\s*\d+\.\s+(.+?)\s+—\s+([\s\S]*?)\s*\[(https?:\/\/[^\]\s]+)\]\s*$/gm)) {
    hallazgos.push({ titulo: m[1].trim(), resumen: m[2].replace(/\s+/g, ' ').trim(), url: m[3] });
  }
  const pagina = /PRIMERA FUENTE \([^)]*\):\s*([\s\S]*)$/.exec(t)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  return { consulta, hallazgos, pagina };
}

const corto = (s: string, max: number) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const fin = Math.max(c.lastIndexOf('. '), c.lastIndexOf('; '));
  return (fin > max * 0.5 ? c.slice(0, fin + 1) : c.replace(/\s+\S*$/, '') + '…').trim();
};
const conPunto = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/**
 * Un resumen corto (se dice en voz: sin direcciones ni listas largas) hecho SOLO con lo que trajeron las
 * búsquedas del turno. '' si no hay nada que contar.
 */
export function resumenDeResultados(textos: string[], idioma: 'es' | 'en' = 'es', max = 3): string {
  const vistos = new Set<string>();
  const items: Hallazgo[] = [];
  let pagina = '';
  for (const t of textos) {
    if (/^\s*HARNESS leer \(/.test(t)) {
      pagina ||= String(t).replace(/^\s*HARNESS leer \([^)]*\):\s*/, '').replace(/\s+/g, ' ').trim();
      continue;
    }
    const h = hallazgosDeWeb(t);
    for (const x of h.hallazgos) {
      if (vistos.has(x.url) || items.length >= max) continue;
      vistos.add(x.url);
      items.push(x);
    }
    pagina ||= h.pagina;
  }
  if (!items.length && !pagina) return '';
  if (!items.length) return idioma === 'en' ? `Here's what the page says: ${conPunto(corto(pagina, 260))}` : `Esto dice la página: ${conPunto(corto(pagina, 260))}`;
  const partes = items.map((x) => conPunto(`${corto(x.titulo.replace(/\s*[|·-]\s*[^|·-]{2,40}$/, ''), 70)}: ${corto(x.resumen, 130)}`));
  return `${idioma === 'en' ? "Here's what I found." : 'Esto encontré.'} ${partes.join(' ')}`.trim();
}

/** Los textos de búsquedas que sí trajeron algo, de los pasos del turno. */
export function textosConResultados(pasos: PasoVigilado[]): string[] {
  return pasos.filter((p) => (p.herramienta === 'web' || p.herramienta === 'leer') && p.estado === 'succeeded' && /HARNESS (web|leer)/.test(p.resumen || '')).map((p) => p.resumen!);
}

/**
 * La línea honrada que va cuando una herramienta corrió y ninguna vuelta del modelo alcanzó a contarlo (el
 * `harness-parcial`): de una búsqueda, lo que trajo; de lo demás, lo que se sabe de su estado. Nunca el volcado.
 */
export function lineaDeResultado(herramienta: string, r: { texto: string; estado: string }, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  if ((herramienta === 'web' || herramienta === 'leer') && r.estado === 'succeeded') {
    const s = resumenDeResultados([r.texto], idioma);
    if (s) return s;
  }
  if (!tieneVolcado(r.texto)) return quitarVolcados(r.texto);
  if (herramienta === 'web' || herramienta === 'leer')
    return en ? "I searched, but I couldn't get anything useful to tell you." : 'Lo busqué, pero no alcancé a sacar nada útil para contarte.';
  if (r.estado === 'succeeded') return en ? 'It ran, but I got cut off before telling you how it went. Ask me and I’ll tell you.' : 'Ya lo hice, pero se me cortó antes de contártelo. Pregúntame y te lo cuento.';
  if (r.estado === 'unknown') return en ? "I'm not sure it went through: check before asking me again." : 'No sé si quedó hecho: revísalo antes de pedírmelo otra vez.';
  return en ? "I couldn't do it." : 'No pude hacerlo.';
}

/* ------------------------------------------------------------------ la guarda del final del turno */

/** Lo que se sabe de cada herramienta del turno (los pasos del harness). */
export type PasoVigilado = { herramienta: string; estado: string; resumen?: string };

export type ContextoVigilancia = {
  pasos: PasoVigilado[];
  /** Acciones de la app que salen con esta respuesta (un recordatorio, una llamada): respaldan «te aviso». */
  acciones?: number;
  idioma?: 'es' | 'en';
};

/**
 * Las herramientas que solo LEEN y terminan en el turno: no respaldan una promesa de trabajo que sigue. Cualquier
 * otra que corrió (investigar, su computadora, una misión, una tarea, un borrador de correo o WhatsApp…) sí: la
 * guarda es conservadora y no corrige lo que una herramienta de verdad empezó.
 */
const SOLO_LEEN = new Set(['web', 'leer', 'sistema', 'cartera']);
/**
 * Lo que de verdad respalda «voy a investigar» o «te aviso cuando termine»: trabajo que sigue después del turno
 * y avisa (la investigación, su computadora, una misión, una tarea en curso). Abrir Ajustes o armar un borrador
 * en el mismo turno no respalda una investigación que nadie empezó (Codex, PR 142).
 */
const RESPALDAN_INVESTIGAR = new Set(['investigar', 'computadora', 'mision', 'tarea']);

export type Vigilada = { texto: string; cambiada: boolean; motivos: string[] };

const VERBO_INVESTIGAR = /\b(busc|investig|averig|consult|indag|rastre|recopil|search|research|look)/;
/** Menos que esto, sin las frases quitadas, no es una respuesta (una muletilla, «Mira,»): una frase con un dato sí. */
const SUSTANCIA_MIN = 25;
const MULETILLA = /^(va|claro|listo|ok|okay|perfecto|bueno|dale|sure|alright|de una|con gusto)\b[,.!\s]*/;
const esMaquina = (l: string) => /^\s*(ACCION_APP|PEDIR_HERRAMIENTA)\s*:/i.test(l);

/**
 * La guarda del final del turno. Quita lo que la respuesta promete y ninguna herramienta de ESTE turno
 * respalda, y lo dice con honradez; con resultados de una búsqueda en el turno, contesta con ellos.
 *  · «ya está encendida» sin su computadora en el turno → fuera: «Todavía no he hecho nada en mi computadora».
 *  · «te lo mando por PULSE2CHAT» → siempre fuera (el servidor no puede escribir ahí): lo dice, y si una
 *    investigación sí empezó, que le llega una notificación y queda en Tareas.
 *  · «voy a buscar», «te aviso», «ahí voy» sin una herramienta que haya empezado algo (ni una acción de la app,
 *    como un recordatorio) → fuera: «Todavía no lo empecé. ¿Lo investigo ahora y te aviso…?».
 *  · «¿quieres que busque…?» o «voy a buscar…» con resultados de una búsqueda ya en el turno y nada más que
 *    decir → un resumen corto hecho con esos resultados.
 *  · el volcado `HARNESS …` → fuera siempre.
 * Lo demás queda tal cual (las líneas ACCION_APP incluidas). Sin nada que corregir, el mismo texto.
 */
export function vigilarPromesas(texto: string, ctx: ContextoVigilancia): Vigilada {
  const original = String(texto || '');
  const en = ctx.idioma === 'en';
  const motivos = new Set<string>();
  let base = original;
  if (tieneVolcado(base)) {
    base = quitarVolcados(base);
    motivos.add('volcado');
  }
  const vivos = ctx.pasos.filter((p) => p.estado !== 'failed');
  const empezo = vivos.some((p) => !SOLO_LEEN.has(p.herramienta)) || (ctx.acciones || 0) > 0;
  // Cada clase de promesa pide lo suyo: investigar, una herramienta de trabajo largo; «te aviso», eso o una
  // acción de la app que avisa (un recordatorio, una llamada); otro trabajo, cualquier herramienta que actúe.
  const respaldaInvestigar = vivos.some((p) => RESPALDAN_INVESTIGAR.has(p.herramienta));
  const respaldaAviso = respaldaInvestigar || (ctx.acciones || 0) > 0;
  const tocoComputadora = vivos.some((p) => p.herramienta === 'computadora');
  const investigo = ctx.pasos.some((p) => p.herramienta === 'investigar' && p.estado === 'succeeded');
  const resultados = textosConResultados(ctx.pasos);
  /** Qué se quitó: investigar/buscar, otro trabajo, o solo un «te aviso». */
  let busco = false;
  let otroTrabajo = false;

  // La etiqueta de ánimo del principio se respeta; las líneas de la máquina no se tocan.
  const emo = /^\s*\[[^\]]{0,30}\]\s*/.exec(base)?.[0] || '';
  const lineas = base.slice(emo.length).split('\n');
  const maquina = lineas.filter(esMaquina);
  const dichas = lineas.filter((l) => !esMaquina(l)).map((linea) =>
    frases(linea)
      .filter((f) => {
        const tipos = clasificarFrase(f);
        let fuera = false;
        if (tipos.includes('pulse')) {
          motivos.add('pulse');
          fuera = true;
        }
        if (tipos.includes('computadora') && !tocoComputadora) {
          motivos.add('computadora');
          fuera = true;
        }
        const investigaF = VERBO_INVESTIGAR.test(plano(f));
        const sinRespaldo =
          (tipos.includes('trabajo') && !(investigaF ? respaldaInvestigar : empezo)) || (tipos.includes('aviso') && !respaldaAviso);
        if ((tipos.includes('trabajo') || tipos.includes('aviso')) && sinRespaldo) {
          const investiga = investigaF;
          busco ||= investiga;
          otroTrabajo ||= tipos.includes('trabajo') && !investiga;
          // Con resultados ya en el turno, «voy a buscar» es prometer lo que ya hizo.
          motivos.add(resultados.length && investiga ? 'ya-busco' : 'promesa');
          fuera = true;
        }
        if (tipos.includes('oferta') && resultados.length) {
          motivos.add('oferta');
          fuera = true;
        }
        return !fuera;
      })
      .join('')
      .trim()
  );
  if (!motivos.size) return { texto: original, cambiada: false, motivos: [] };
  const resto = dichas.filter(Boolean).join('\n').replace(/[ \t]{2,}/g, ' ').trim();
  // Lo que queda sin las frases quitadas: una muletilla sola («Va,», «Claro.») no cuenta como respuesta.
  const sustancia = plano(resto).replace(MULETILLA, '');
  const conResumen = resultados.length > 0 && sustancia.length < SUSTANCIA_MIN && ['oferta', 'ya-busco', 'promesa', 'volcado', 'pulse'].some((m) => motivos.has(m));
  const quedaPregunta = /\?/.test(resto) && !conResumen && !!sustancia;
  // Lo que corrige un dicho falso va antes del resto; lo que dice qué falta por hacer, después.
  const antes: string[] = [];
  const despues: string[] = [];
  if (motivos.has('computadora')) {
    antes.push(en ? "I haven't done anything on my computer yet." : 'Todavía no he hecho nada en mi computadora.');
    if (!sustancia && !motivos.has('promesa')) despues.push(en ? 'What do you want me to do on it?' : '¿Qué quieres que haga en ella?');
  }
  if (conResumen) antes.push(resumenDeResultados(resultados, ctx.idioma || 'es'));
  if (motivos.has('pulse')) {
    despues.push(
      investigo
        ? en
          ? "I can't write to you on PULSE2CHAT yet: when it's done you'll get a notification on your phone and the result stays in Tasks."
          : 'Todavía no puedo escribirte por PULSE2CHAT: cuando termine te llega una notificación al teléfono y el resultado queda en Tareas.'
        : en
          ? "I can't write to you on PULSE2CHAT yet."
          : 'Todavía no puedo escribirte por PULSE2CHAT.'
    );
  }
  const falta = !empezo && (motivos.has('promesa') || (motivos.has('pulse') && !investigo));
  if (falta && conResumen) {
    // Ya contestó con lo que trajo la búsqueda; lo de «te aviso cuando termine» no empezó: se ofrece de verdad.
    despues.push(en ? 'If you want, I can research it in depth and notify you on your phone when it’s done.' : 'Si quieres, lo investigo más a fondo y te aviso con una notificación cuando termine.');
  } else if (falta && (busco || motivos.has('pulse'))) {
    despues.push(`${en ? "I haven't started it yet." : 'Todavía no lo empecé.'}${quedaPregunta ? '' : en ? ' Shall I research it now and notify you on your phone when it’s done?' : ' ¿Lo investigo ahora y te aviso con una notificación cuando termine?'}`);
  } else if (falta && otroTrabajo) {
    despues.push(`${en ? "I haven't started it yet." : 'Todavía no lo empecé.'}${quedaPregunta ? '' : en ? ' Do you want me to do it now?' : ' ¿Quieres que lo haga ahora?'}`);
  } else if (falta) {
    // Solo un «te aviso» sin nada que avise: se dice que no quedó puesto.
    despues.push(en ? "I haven't set anything up to let you know yet." : 'Todavía no dejé nada puesto para avisarte.');
  }
  const dicho = [...antes, conResumen || !sustancia ? '' : resto, ...despues].filter((x) => x.trim()).join(' ').trim();
  const final = `${emo}${dicho}${maquina.length ? `\n${maquina.join('\n')}` : ''}`.trim();
  return { texto: final || original, cambiada: (final || original) !== original, motivos: [...motivos] };
}

/**
 * ¿La respuesta de una vuelta, con resultados ya en los HECHOS, no los usa? (promete buscar o pregunta si
 * busca y no dice nada más). Para la vuelta correctora del harness.
 */
export function noUsaResultados(reply: string): boolean {
  const c = clasificarPromesas(reply);
  if (!c.tipos.some((t) => t === 'oferta' || t === 'trabajo' || t === 'aviso')) return false;
  const marcadas = new Set(c.frases.map((x) => x.frase));
  const resto = frases(sinLineasDeMaquina(reply))
    .filter((f) => !marcadas.has(f))
    .join(' ');
  return plano(resto).replace(MULETILLA, '').length < SUSTANCIA_MIN;
}

/** La nota de la vuelta correctora (no se dice en voz alta). */
export function notaUsaResultados(idioma: 'es' | 'en' = 'es'): string {
  return idioma === 'en'
    ? 'SYSTEM NOTE: you ALREADY searched; the results are in the FACTS above. Answer NOW with those results, in your own words, short. Do not say you will search, and do not ask whether to search.'
    : 'NOTA DEL SISTEMA: YA buscaste y los resultados están en los HECHOS de arriba. Contesta AHORA con esos resultados, en tus palabras y corto. No digas que vas a buscar ni preguntes si buscas.';
}
