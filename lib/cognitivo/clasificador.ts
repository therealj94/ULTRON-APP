/**
 * EL CLASIFICADOR — la decisión rápida antes de pensar: qué tipo de tarea es, cuánto riesgo tiene,
 * qué agente la atiende, si hace falta el modelo grande y si alguien está intentando torcer al
 * sistema.
 *
 * Dos motores:
 *
 *  · **Laya** (Convai, Apache 2.0): un modelo que DECIDE sin redactar. Contesta preguntas tipadas
 *    —elección, puntaje ordinal, sí/no calibrado— en una sola pasada, en ~33 ms en una T4 y en más
 *    de 100 idiomas. Corre en la T4, no en la A10G del 27B. Se le habla por `POST /v1/systemone`.
 *  · **Reglas**: expresiones y listas de palabras, deterministas, sin red. Son el respaldo siempre
 *    disponible y la vara contra la que se mide Laya.
 *
 * `CLASIFICADOR_MODO`:
 *  · `reglas` (por omisión) — solo reglas.
 *  · `sombra` — decide con reglas, pero pregunta también a Laya y guarda las dos en la traza. Es como
 *    se valida Laya en producción sin que una mala clasificación afecte a nadie.
 *  · `laya` — decide con Laya; si Laya no contesta a tiempo o falla, cae a reglas sin que se note.
 *
 * Lo que sale de aquí es una RECOMENDACIÓN: el riesgo alimenta al motor de reglas (que puede
 * mandar a revisión), pero ninguna clasificación autoriza nada por sí sola.
 */
import type { Clasificacion } from './traza';
import { trazaActual } from './traza';
import { consultarModelo, layaConfigurado as layaDelNodo, type RespuestaModelo } from '../laya';
import { pideQueLaLlamen } from './intencion-llamada';
export { motivoParaNoLlamar, pideQueLaLlamen, type MotivoNoLlamar } from './intencion-llamada';

export type Plataforma = 'ultron' | 'electrum';

export const TAREAS: Record<Plataforma, Record<string, string>> = {
  ultron: {
    conversacion: 'saludo, charla, cómo estás, chiste, agradecimiento',
    dato_mercado: 'precio del oro, plata, tipo de cambio, lempiras, cotización',
    conocimiento_empresa: 'Orden Global, ORIGEN, AUKA, la junta, la cadena, Próspera, las minas',
    accion_taller: 'enviar por Telegram, WhatsApp o correo, hacer un PDF, anotar o listar pendientes, avisar urgente',
    documento: 'leer, resumir o analizar un PDF, contrato o documento',
    investigacion_web: 'buscar en internet, noticias, abrir una página',
    sistema: 'estado del sistema, redespliegue, mantenimiento, ejecutar código',
    transaccion_valor: 'transferir, emitir, firmar, pagar, mover tokens o dinero',
  },
  electrum: {
    conversacion: 'saludo, charla, agradecimiento',
    consulta_catastro: 'buscar concesiones, titulares, vencimientos, qué hay en un punto',
    analisis_tecnico: 'geología, métodos de minado, metalurgia, geotecnia, ambiental',
    legal_minero: 'vigencia, canon, INHGEOMIN, Ley General de Minería, contratos, servidumbres',
    gis: 'mapas, capas, traslapes, coordenadas, áreas',
    economia: 'costos, VAN, TIR, ley de corte, precios',
    documento: 'leer o resumir un expediente, informe o PDF',
    informe: 'generar un informe o PDF',
  },
};

export const AGENTES: Record<Plataforma, Record<string, string>> = {
  ultron: {
    financiero: 'precios, tesorería, valuación, flujos, tipo de cambio',
    legal: 'contratos, sociedades, cumplimiento legal, Próspera, CIADI',
    compliance: 'KYC, AML, licencias, remesas, regulación',
    documentos: 'leer y resumir documentos y PDFs',
    blockchain: 'la cadena, tokens, wallets, validadores, contratos inteligentes',
    investigacion: 'buscar en internet y contrastar fuentes',
    operaciones: 'pendientes, avisos, envíos, estado del sistema',
    general: 'conversación y todo lo demás',
  },
  electrum: {
    geologo: 'yacimientos, vetas, muestreo, leyes',
    minas: 'métodos de explotación, voladura, producción',
    civil: 'caminos, presas de relave, taludes',
    metalurgista: 'planta, recuperación, cianuración, flotación',
    geomatica: 'mapas, capas, coordenadas, traslapes',
    ambiental: 'licencia ambiental, agua, comunidades, cierre',
    legal: 'concesiones, expedientes, vigencia, canon, ley minera',
    economista: 'costos, VAN, TIR, ley de corte',
    ninguno: 'conversación general',
  },
};

export function nivelDeRiesgo(r: number): Clasificacion['nivelRiesgo'] {
  return r >= 90 ? 'critico' : r >= 70 ? 'alto' : r >= 40 ? 'medio' : 'bajo';
}

/* ------------------------------------------------------------------ reglas */

// Sin acentos, sin caracteres invisibles (U+200B y compañía parten palabras sin que se vea) y con
// los saltos de línea como espacios: «olvida\ntodas tus reglas» es la misma frase.
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** Lo que tiene forma de ataque: pedir que ignore reglas, revele secretos o cambie de identidad. */
const INYECCION = /\b(ignora|olvida|desactiva|salta(te)?|omite)\b.{0,40}\b(instruccion|regla|restriccion|politica|sistema|prompt)|\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instruction|rule|restriction|polic|system|prompt|guideline)|\b(reveal|show|print|give|tell|dump|leak)\b.{0,30}\b(token|key|password|secret|credential|env(ironment)? var|seed|private)|\byou are now\b|\bact as\b.{0,30}\b(without|no) (rules|restrictions|limits)|\bdeveloper mode\b|\bsystem\s*:|\bjailbreak\b|\bmodo (dios|desarrollador|dan)\b|(dime|dame|muestra|revela|imprime)(me)?\b.{0,30}\b(token|clave|contrasena|password|secret|api.?key|variables de entorno|env\b|semilla|seed|privada)|\bhaz(te)? pasar por\b|\bresponde como\b.{0,30}\bsin reglas|el usuario tiene mando|soy (el )?admin/;

/**
 * Riesgo alto (≥ 80, y el motor de reglas manda a revisión lo que no sea lectura): mover valor o
 * tocar el sistema. NO «pagar a Carlos el viernes» ni «mueve la reunión»: eso es anotar y mandar, y
 * con la versión anterior esas frases iban a la cola de aprobación (medido: riesgo 90). Un pago
 * cuenta cuando trae monto o activo.
 */
const MUEVE_VALOR =
  /\btransf(ier|er|ir)\w*|\b(emite|emitir|emitan|emitamos|mintea|mintear|mint|acuna|acunar|issue)\b.{0,30}\b(tokens?|origen|auka|agka|ondk|monedas?|activos?|bonos?|nft)|\b(haz|hacer|aprueba|aprobar|ejecuta|lanza|lanzar)\b.{0,12}\bemision\b|\bfirma(r)? (la|el|una) (transferencia|emision|orden|operacion|transaccion)|\b(mover|mueve|retira(r)?|withdraw)\b.{0,15}\b(fondos|tokens?|monedas|usdt|usdc|auka|origen)\b|\b(swap|bridge|wire)\b|\bpag(a|ar|ale|ues?)\b.{0,40}(\d|usdt|usdc|usd\b|dolares|lempiras|tokens?|origen|auka|wallet)|\b(send|envia|manda)\b.{0,20}\d[\d.,]*\s*(usdt|usdc|tokens?|origen|auka|eth|btc)/;
const TOCA_SISTEMA = /\b(borra(r)? (toda|todo|las|los)|elimina(r)? (toda|todo)|redeploy|redespl|corre el codigo|drop table|rm -rf)|\bejecuta(r)? (el )?(ejecutor|codigo|script|comando)/;
const RIESGO_MEDIO = /\b(envia|envía|manda|mandale|correo|whatsapp|telegram|sube|carga|anota|registra|marca como|cambia|actualiza)\b/;

type Regla = [string, RegExp];

/**
 * El orden importa: gana la primera que casa. Las palabras son PREFIJOS (sin \b al final) para que
 * «validador» encuentre «validadores» y «transfi» encuentre «transfiere».
 */
const TAREA_REGLAS: Record<Plataforma, Regla[]> = {
  ultron: [
    // Un recordatorio que menciona un pago es una tarea, no una transacción.
    ['accion_taller', /\b(recuerdame|recuerda que|anota|apunta|agrega a|nueva tarea|pendientes)/],
    ['transaccion_valor', /\b(transfi|emit(e|ir|an)\b|mint\b|firma(r)? (la|el|una)|pag(a|ar|ale) (a|al|de)\b|mueve|swap|bridge)/],
    ['sistema', /\b(redeploy|redespl|mantenimiento|del sistema|como esta el sistema|los nodos|ejecuta|corre el codigo)/],
    // «llámame» ya no es una palabra suelta (LANG-03): lo decide pideQueLaLlamen, más abajo.
    ['accion_taller', /\b(envia|manda|mandame|mandale|pdf|urgente|avisame)/],
    ['conocimiento_empresa', /\b(orden global|origen|auka|agka|ondk|mnka|junta|cadena|chain id|bloque|besu|qbft|validador|explorador|ordenscan|prospera|ciadi|zede|rfsa|aucorp|ordenex|minas? de|danli|choluteca|corpus|kiri|fundador|cofundador|lei\b|sede|gramin)/],
    ['dato_mercado', /\b(oro|plata|xau|xag|spot|onza|lempira|hnl|tipo de cambio|cotizaci|precio|dolar)/],
    ['investigacion_web', /\b(busca|investiga|noticias|internet|https?:\/\/|abre la pagina)/],
    ['documento', /\b(pdf|documento|contrato|lee (esto|el)|resume)/],
  ],
  electrum: [
    ['informe', /\b(informe|reporte|pdf)/],
    ['consulta_catastro', /\b(busca concesion|concesiones en|de quien es|que hay en el punto|que concesiones vencen)/],
    ['legal_minero', /\b(inhgeomin|ley general|canon|vigencia|vence|caduc|prelaci|servidumbre|expediente|titular|contrato|regalia|moratoria|obligaciones|cesion|derechos mineros|arrendamiento|cartera|restricciones legales|solicitar)/],
    ['gis', /\b(mapa|capa|traslap|superposic|coordenad|utm|wgs84|nad27|epsg|hectarea|perimetro|poligono|kml|shapefile|georreferenc|curvas de nivel)/],
    ['economia', /\b(van\b|tir\b|npv|irr|capex|opex|aisc|ley de corte|costo|flujo de caja)/],
    ['documento', /\b(lee|resume|documento)/],
    ['analisis_tecnico', /\b(veta|yacimiento|epitermal|porfido|sondaj|muestreo|voladura|cielo abierto|subterran|planta|recuperaci|cianur|flotaci|talud|relave|ambiental|drenaje)/],
  ],
};

const AGENTE_REGLAS_AURA: Regla[] = [
  ['blockchain', /\b(cadena|chain|besu|qbft|validador|wallet|token|origen|auka|agka|ondk|contrato inteligente|bridge|gas\b|bloque|explorador|ordenscan)/],
  ['compliance', /\b(kyc|aml|lavado|licencia|remesa|regulador|cnbs|rfsa|cumplimiento|sancion)\b/],
  ['legal', /\b(contrato|sociedad|abogad|demanda|ciadi|prospera|zede|ley|juicio|clausula|poder notarial)\b/],
  ['financiero', /\b(precio|oro|plata|xau|xag|spot|onza|lempira|hnl|tipo de cambio|tesoreria|flujo|valuaci|factur|presupuesto|inversion)/],
  ['documentos', /\b(pdf|documento|resume|lee (esto|el)|acta|minuta)\b/],
  ['investigacion', /\b(busca|investiga|noticias|internet|fuente)\b/],
  ['operaciones', /\b(pendientes|tarea|envia|manda|urgente|sistema|nodos|redeploy|telegram)\b/],
];

/** ¿Tiene forma de ataque? Para mirar también texto que NO escribió quien pregunta (fichas, páginas). */
export function pareceInyeccion(texto: string): boolean {
  return INYECCION.test(fold(texto));
}

/** Clasificación por reglas. Rápida, sin red, siempre disponible. */
export function clasificarConReglas(mensaje: string, plataforma: Plataforma): Clasificacion {
  const t0 = Date.now();
  const q = fold(mensaje);
  let tarea = TAREA_REGLAS[plataforma].find(([, re]) => re.test(q))?.[0] || 'conversacion';
  // «Llámame» es acción solo si lo es de verdad: «no me llames», «"llámame" dijo ella», «llámame José»
  // (apodo) o «call me Alex» siguen siendo charla (LANG-03, lib/cognitivo/intencion-llamada.ts).
  if (plataforma === 'ultron' && tarea === 'conversacion' && pideQueLaLlamen(mensaje)) tarea = 'accion_taller';
  const inyeccion = INYECCION.test(q);
  let riesgo = MUEVE_VALOR.test(q) ? 90 : TOCA_SISTEMA.test(q) ? 85 : RIESGO_MEDIO.test(q) ? 40 : 10;
  if (inyeccion) riesgo = Math.max(riesgo, 85);
  let agente: string | null = null;
  if (plataforma === 'ultron') agente = AGENTE_REGLAS_AURA.find(([, re]) => re.test(q))?.[0] || 'general';
  const requiereQwen = !/^(conversacion)$/.test(tarea) || q.split(/\s+/).length > 12;
  return {
    tarea,
    riesgo,
    nivelRiesgo: nivelDeRiesgo(riesgo),
    requiereQwen,
    agente,
    revisionHumana: riesgo >= 80,
    confianza: 0.6,
    fuente: 'reglas',
    ms: Date.now() - t0,
    ...(inyeccion ? { inyeccion: true } : {}),
  } as Clasificacion;
}

/* ------------------------------------------------------------------ Laya */

/**
 * El modelo `mensaje` de Laya (scripts/nodo-t4/laya/modelos/mensaje, ESPEC.md): 19 preguntas sí/no
 * calibradas sobre el mensaje. Se ajustó con mensajes de la junta y de PULSE2CHAT; el `laya-serve`
 * genérico que se probó antes sin ajustar acertaba la tarea el 42 % de las veces y dejaba pasar
 * ataques, por eso aquí se usa el ajustado y nunca por debajo de las reglas.
 */
const TAREA_DE_LAYA: Record<string, string> = {
  tarea_conversacion: 'conversacion',
  tarea_mercado: 'dato_mercado',
  tarea_empresa: 'conocimiento_empresa',
  tarea_accion: 'accion_taller',
  tarea_documento: 'documento',
  tarea_web: 'investigacion_web',
  tarea_sistema: 'sistema',
  tarea_transaccion: 'transaccion_valor',
};
/** Si las reglas no encontraron agente, el de la tarea que vio Laya. */
const AGENTE_DE_TAREA: Record<string, string> = {
  dato_mercado: 'financiero',
  documento: 'documentos',
  investigacion_web: 'investigacion',
  accion_taller: 'operaciones',
  sistema: 'operaciones',
  transaccion_valor: 'blockchain',
};
export type Moderacion = 'spam' | 'abuso' | 'estafa' | 'crisis';
export type Animo = 'molesto' | 'triste';
const MODERACION: Moderacion[] = ['spam', 'abuso', 'estafa', 'crisis'];
/**
 * Por debajo de esto, Laya no puede quitarle el modelo grande a lo que las reglas mandan a Qwen: las
 * reglas mandan casi todo (cualquier palabra de oficio o más de doce palabras), y un «no hace falta»
 * dudoso cuesta una respuesta mala; un «sí hace falta» de más cuesta unos segundos.
 */
const RAZONAR_MINIMO = 0.2;

function espera() {
  return Number(process.env.CLASIFICADOR_LAYA_MS || process.env.ULTRON_LAYA_TIMEOUT_MS) || 800;
}

export function layaConfigurado() {
  return layaDelNodo();
}

/** Lo que dice el modelo, traducido a la clasificación del turno. Sin reglas todavía. */
export function leerMensaje(r: RespuestaModelo, plataforma: Plataforma): Clasificacion | null {
  const tareaLaya = TAREA_DE_LAYA[r.grupos?.tarea];
  if (!tareaLaya) return null;
  const si = new Set(r.etiquetas);
  const p = (k: string) => (Number.isFinite(r.p?.[k]) ? r.p[k] : 0);
  const riesgo = si.has('mueve_valor') ? 90 : si.has('toca_sistema') || si.has('ataque') ? 85 : tareaLaya === 'accion_taller' ? 40 : 10;
  const moderacion = MODERACION.filter((m) => si.has(m));
  const animos = (['molesto', 'triste'] as Animo[]).filter((a) => si.has(a)).sort((a, b) => p(b) - p(a));
  return {
    // La tarea de Laya es la de AU-RA; Dr Electrum tiene las suyas y ahí manda la regla.
    tarea: plataforma === 'ultron' ? tareaLaya : 'conversacion',
    riesgo,
    nivelRiesgo: nivelDeRiesgo(riesgo),
    requiereQwen: si.has('razonar') || tareaLaya !== 'conversacion',
    agente: plataforma === 'ultron' ? AGENTE_DE_TAREA[tareaLaya] || 'general' : null,
    revisionHumana: riesgo >= 80,
    confianza: p(r.grupos.tarea),
    fuente: 'laya',
    ms: r.ms,
    ...(si.has('ataque') ? { inyeccion: true } : {}),
    ...(si.has('urgente') ? { urgente: true } : {}),
    ...(moderacion.length ? { moderacion } : {}),
    ...(animos.length ? { animo: animos[0] } : {}),
    razonar: p('razonar'),
  } as Clasificacion;
}

export async function clasificarConLaya(mensaje: string, plataforma: Plataforma, esperaMs = espera()): Promise<Clasificacion | null> {
  if (!layaDelNodo()) return null;
  const { resultado, ms } = await consultarModelo('mensaje', mensaje, { esperaMs });
  const c = resultado ? leerMensaje(resultado, plataforma) : null;
  return c ? { ...c, ms } : null;
}

export type ModoClasificador = 'reglas' | 'sombra' | 'laya';

export function modoClasificador(): ModoClasificador {
  const m = String(process.env.CLASIFICADOR_MODO || '').toLowerCase();
  if (m === 'laya' || m === 'sombra') return m;
  return 'reglas';
}

/**
 * La clasificación del turno. Nunca falla y nunca tarda más que el tope de Laya: si Laya no está,
 * no contesta o contesta basura, sale la de reglas.
 */
/**
 * Lo más que espera a Laya un turno HABLADO. En la T4 contesta en ~35 ms; si un día tarda, la voz no
 * se queda muda los 800 ms del tope general: sale la clasificación de reglas.
 */
export const ESPERA_LAYA_VOZ_MS = 300;

export async function clasificar(mensaje: string, plataforma: Plataforma, o: { voz?: boolean } = {}): Promise<Clasificacion> {
  const reglas = clasificarConReglas(mensaje, plataforma);
  const tope = o.voz ? Math.min(espera(), ESPERA_LAYA_VOZ_MS) : espera();
  const modo = modoClasificador();
  if (modo === 'reglas' || !layaConfigurado()) return reglas;
  if (modo === 'sombra') {
    // En sombra lo de Laya no decide nada: no se espera. Se pega a la traza del turno cuando llegue
    // (en la T4 tarda ~35 ms; el turno, segundos).
    const traza = trazaActual();
    void clasificarConLaya(mensaje, plataforma, tope).then((l) => traza?.sombraClasificacion(l ? ({ ...l, sombra: undefined } as any) : null));
    return { ...reglas, sombra: null };
  }
  const deLaya = await clasificarConLaya(mensaje, plataforma, tope);
  if (!deLaya) return { ...reglas, sombra: null };
  return combinar(deLaya, reglas, plataforma);
}

/**
 * Laya decide; las reglas son el piso. En modo Laya las reglas quedan como sombra (así se ve en la
 * traza cuándo discrepan), y lo que protege nunca baja de lo que dicen: ni el riesgo, ni la sospecha
 * de ataque. El modelo grande solo se quita cuando Laya está segura de que no hace falta.
 */
export function combinar(deLaya: Clasificacion, reglas: Clasificacion, plataforma: Plataforma): Clasificacion {
  const riesgo = Math.max(deLaya.riesgo, reglas.riesgo);
  const inyeccion = !!(deLaya.inyeccion || reglas.inyeccion);
  const noHaceFalta = !deLaya.requiereQwen && (deLaya.razonar ?? 1) < RAZONAR_MINIMO;
  return {
    ...deLaya,
    // En Dr Electrum las tareas son otras: manda la regla.
    tarea: plataforma === 'ultron' ? deLaya.tarea : reglas.tarea,
    agente: plataforma === 'ultron' ? (reglas.agente && reglas.agente !== 'general' ? reglas.agente : deLaya.agente) : reglas.agente,
    riesgo,
    nivelRiesgo: nivelDeRiesgo(riesgo),
    revisionHumana: riesgo >= 80,
    requiereQwen: deLaya.requiereQwen || (reglas.requiereQwen && !noHaceFalta),
    ...(inyeccion ? { inyeccion: true } : {}),
    sombra: { ...reglas, sombra: undefined } as any,
  };
}
