/**
 * ETAPA 1 — EL RECORRIDO: lo que se dice y se muestra sale de aquí, como funciones puras.
 *
 * El documento «Doctor Electrum — Etapa 1: El Recorrido» (v1.0, octubre 2026) fija tres cosas que
 * no se pueden cambiar: el orden de los 12 pasos, los seis mensajes clave y las reglas de conducta.
 * Aquí están los pasos y los mensajes tal cual, y las lecturas de cada mapa armadas con el target
 * de ejemplo que manda el servidor (/api/electrum/recorrido/target, datos reales de la base). Si un
 * dato no está, la frase lo dice en vez de inventarlo (reglas 2 y 3); el target siempre se presenta
 * como EJEMPLO ILUSTRATIVO y como «probable proyecto», nunca como recurso (regla 1).
 */

/** Lo que manda el servidor (server/electrum/recorrido-target.ts → TargetEjemplo). */
export type Cercana = { nombre: string; km: number; rumbo: string | null };
export type TargetEjemplo = {
  nombre: string;
  ejemplo: true;
  ficha: { nombre: string; capa: string };
  mineral: string;
  centro: [number, number];
  utm?: { este: number; norte: number; zona: '16N' };
  poligono: { type: 'Polygon'; coordinates: number[][][] };
  caja: [number, number, number, number];
  ha: number;
  perimetroKm: number;
  libreHa: number;
  departamento: string | null;
  municipio: string | null;
  aldeas: string[];
  caserios: string[];
  pobladosCerca: number;
  poblacionDentro: number | null;
  protegida: Cercana | null;
  microcuenca: Cercana | null;
  rios: { kmDentro: number; masCercano: { nombre: string; km: number } | null };
  carreteraKm: number | null;
  ocurrencias: Array<{ nombre: string; km: number; detalle: string | null }>;
  ocurrenciasTotal?: number;
  ocurrenciasTope?: boolean;
  jica?: { muestras: number; mejorAu: { codigo: string; tipo: string; ppb: number; sobreTope: boolean; km: number } | null } | null;
  geologia: {
    unidad: string | null;
    descripcion: string | null;
    edad: string | null;
    fallasDentro: number;
    fallaCercana: { nombre: string; km: number } | null;
    rumbo: string | null;
    tracto: string | null;
    modelos: string[];
    indicios: string;
    yacimientos: Array<{ nombre: string; mineral: string; km: number }>;
  } | null;
  concesionCercana: (Cercana & { estado: string | null; tipo: string | null }) | null;
  fuentes: string[];
  alertas: string[];
  calculado: string;
};

/** Los 12 pasos, en el orden del documento (sección 3). No se reordenan. */
export const PASOS = [
  { n: 1, corto: 'Premisas geológicas', titulo: 'Premisas geológicas' },
  { n: 2, corto: 'Indicios', titulo: 'Indicios' },
  { n: 3, corto: 'Hallazgos', titulo: 'Hallazgos' },
  { n: 4, corto: 'Tipo de target', titulo: 'Tipo de target' },
  { n: 5, corto: 'Restricciones', titulo: 'Restricciones' },
  { n: 6, corto: 'División política', titulo: 'División política' },
  { n: 7, corto: 'Agua, vías y suelos', titulo: 'Red hídrica, vías y suelos' },
  { n: 8, corto: 'Catastro minero', titulo: 'Catastro minero' },
  { n: 9, corto: 'Marco legal', titulo: 'Marco legal y solicitud' },
  { n: 10, corto: 'Carpeta y exploración', titulo: 'Carpeta del proyecto y plan de exploración' },
  { n: 11, corto: 'Perforación y recurso', titulo: 'Perforación, logueo, modelado y recurso' },
  { n: 12, corto: 'Decisión', titulo: 'Decisión del inversionista' },
] as const;

/** Los seis mensajes clave (sección 2): todos se dicen y se ven en el recorrido. */
export const MENSAJES = [
  { titulo: 'Alta rentabilidad, alto riesgo', texto: 'A mayor riesgo, mayor utilidad.' },
  { titulo: 'A mayor información, menor riesgo', texto: 'Somos administradores del riesgo.' },
  { titulo: 'Honduras: alto potencial minero', texto: 'Desde la Colonia, un país de oro y plata.' },
  { titulo: 'La mejor información, integrada', texto: 'JICA, Naciones Unidas, USGS, mapas y catastro.' },
  { titulo: 'Todo el ciclo', texto: 'Del target al recurso, la planta, la mina y la bolsa.' },
  { titulo: 'Aprendemos contigo', texto: 'Cada consulta mejora el sistema.' },
] as const;

/** Cuántas ocurrencias a 5 km (el total, no la lista que se muestra), y cómo decirlo. */
export function ocurrenciasCerca(t: TargetEjemplo): { n: number; dicho: string } {
  const n = t.ocurrenciasTotal ?? t.ocurrencias.length;
  return { n, dicho: t.ocurrenciasTope ? `al menos ${n}` : String(n) };
}

/** Lo que se le puede pedir después (sección 7), para ofrecerlo al cerrar. */
export const PREGUNTAS_DESPUES = [
  'Muéstrame los targets de oro libres en El Paraíso',
  '¿Este punto cae en un área protegida?',
  'Prepárame la solicitud de exploración para este polígono',
  'Chema, ¿qué pruebas metalúrgicas necesito para un óxido de oro?',
  'Tatiana, ¿cómo sería el plan de minado para una veta de 2 m?',
  '¿Qué necesito para cumplir NI 43-101?',
];

// Se DICE en voz alta: coma decimal, como se lee en español.
export const km = (x: number) => `${x.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;
const n0 = (x: number) => Math.round(x).toLocaleString('es-ES');
const al = (r: string | null) => (r ? ` al ${r}` : '');

/** «Río Verdugo – El Naranjo» a partir de «D M RIO VERDUGO EL NARANJO FOM 150 2757-IV …». */
export function nombreFicha(t: string): string {
  const limpio = t
    .replace(/\b(FOM|FON|FOMS)\b.*$/i, '')
    .replace(/^\s*(D\s*M|DM|MINA|PROSPECTO)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = limpio || t.trim();
  return base
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
    .replace(/\b(De|Del|Y)\b/g, (x, _1, i) => (i === 0 ? x : x.toLowerCase()))
    .replace(/^(Rio|Río) /, 'Río ');
}

/** Dónde queda, dicho para la voz: «municipio de Reitoca, Francisco Morazán». */
export function ubicacion(t: TargetEjemplo): string {
  const partes = [t.municipio ? `el municipio de ${t.municipio}` : null, t.departamento ? `departamento de ${t.departamento}` : null].filter(Boolean);
  return partes.length ? partes.join(', ') : 'una zona que la base todavía no ubica en la división política';
}

/** Paso 1: la lectura de las premisas (geología y fallas). */
export function lecturaPremisas(t: TargetEjemplo): string {
  const g = t.geologia;
  if (!g) return 'Para esta zona la base no tiene la geología cargada: es lo primero que habría que levantar.';
  const roca = g.unidad ? `sobre la unidad ${g.unidad}${g.edad ? `, del ${g.edad}` : ''}` : 'en una unidad que el mapa geológico no nombra';
  const falla = g.fallaCercana
    ? g.fallasDentro > 0
      ? `con ${g.fallasDentro === 1 ? 'una falla' : `${g.fallasDentro} fallas`} cruzando el área${g.rumbo ? `, de rumbo ${g.rumbo}` : ''}`
      : `a ${km(g.fallaCercana.km)} de una falla${g.rumbo ? ` de rumbo ${g.rumbo}` : ''}`
    : 'sin fallas cartografiadas cerca';
  const tracto = g.tracto ? ` Y cae en el tracto permisivo «${g.tracto}» del USGS.` : '';
  return `El target está ${roca}, ${falla}.${tracto}`;
}

/** Paso 2: los indicios (ocurrencias registradas cerca). */
export function lecturaIndicios(t: TargetEjemplo): string {
  const o = ocurrenciasCerca(t);
  const ocurr = o.n ? `En un radio de cinco kilómetros hay ${o.dicho} ocurrencias minerales registradas en los inventarios históricos.` : 'Ocurrencias registradas alrededor, la base no tiene.';
  const j = t.jica;
  if (!j) return ocurr;
  const mejor = j.mejorAu ? ` La de más oro, la ${deletrear(j.mejorAu.codigo)}, dio ${leyOroDicha(j.mejorAu.ppb, j.mejorAu.sobreTope)}: es una muestra puntual, no la ley de un depósito.` : '';
  return `${ocurr} Y JICA tomó aquí ${j.muestras} muestras geoquímicas.${mejor}`;
}

/** «más de diez gramos por tonelada»: las partes por billón de oro, dichas como se entienden. */
export function leyOroDicha(ppb: number, sobreTope = false): string {
  const gt = ppb / 1000;
  const v = gt >= 1 ? `${gt.toLocaleString('es-ES', { maximumFractionDigits: 1 })} gramos por tonelada` : `${Math.round(ppb).toLocaleString('es-ES')} partes por billón`;
  return sobreTope ? `más de ${v}, el tope del laboratorio` : v;
}

/** Un código de muestra para la voz: «Z054GO» → «Z 054 GO». */
const deletrear = (c: string) => c.replace(/(\d+)/g, ' $1 ').replace(/\s+/g, ' ').trim();

/** Paso 3: los hallazgos (yacimientos y labores registradas). Si no hay, se dice qué falta. */
export function lecturaHallazgos(t: TargetEjemplo): string {
  const ys = t.geologia?.yacimientos || [];
  if (!ys.length) return 'Labores mineras registradas cerca, la base no tiene: ese hallazgo es lo primero que se verifica en campo.';
  const y = ys[0];
  return `Y hay ${ys.length === 1 ? 'un yacimiento registrado' : `${ys.length} yacimientos registrados`} cerca; el más próximo, ${y.nombre}, a ${km(y.km)}.`;
}

/** Paso 4: el tipo de depósito probable, solo si la base trae modelos para la zona. */
export function tipoProbable(t: TargetEjemplo): string | null {
  const ms = (t.geologia?.modelos || []).map((x) => x.replace(/\s*\([^)]*\)/g, '').trim()).filter(Boolean);
  if (!ms.length) return null;
  // Para oro y plata, lo propio del mineral primero (epitermal, orogénico, vetas); un pórfido es de cobre.
  const preciosos = /^(oro|plata)$/i.test(t.mineral);
  const orden = preciosos ? [/epiterm/i, /orog|mesoterm/i, /veta|vein/i, /skarn/i, /p[oó]rfid/i, /placer/i] : [/p[oó]rfid/i, /skarn/i, /epiterm/i, /veta|vein/i, /orog|mesoterm/i, /placer/i];
  for (const r of orden) {
    const m = ms.find((x) => r.test(x));
    if (m) return m;
  }
  return ms[0];
}

/** Paso 5: restricciones, con la distancia y el rumbo a la más cercana (lo pide el documento). */
export function lecturaRestricciones(t: TargetEjemplo): string {
  const p = t.protegida ? `El área protegida más cercana, ${t.protegida.nombre}, está a ${km(t.protegida.km)}${al(t.protegida.rumbo)}` : 'No hay áreas protegidas cargadas cerca';
  const m = t.microcuenca ? `y la microcuenca declarada más cercana${t.microcuenca.nombre ? `, ${t.microcuenca.nombre},` : ''} a ${km(t.microcuenca.km)}${al(t.microcuenca.rumbo)}` : 'y no hay microcuencas declaradas cerca';
  return `El área propuesta de ${n0(t.ha)} hectáreas no se superpone con ninguna restricción. ${p}, ${m}.`;
}

/** Paso 6: división política y comunidades (licencia social). */
export function lecturaPolitica(t: TargetEjemplo): string {
  const aldeas = t.aldeas.length ? ` Las aldeas más cercanas: ${lista(t.aldeas)}.` : '';
  const gente = t.poblacionDentro ? ` Dentro del área viven unas ${n0(t.poblacionDentro)} personas según el censo de caseríos.` : '';
  return `Está en ${ubicacion(t)}.${aldeas}${gente}`;
}

/** Paso 7: agua y vías. */
export function lecturaAguaYVias(t: TargetEjemplo): { agua: string; vias: string } {
  const agua =
    t.rios.kmDentro > 0
      ? `Hay ${km(t.rios.kmDentro)} de ríos y quebradas dentro del área: agua para el proceso, y también el primer cuidado ambiental.`
      : t.rios.masCercano
        ? `El cauce más cercano está a ${km(t.rios.masCercano.km)}.`
        : 'La red hídrica cargada no marca cauces cerca: hay que verificarlo en campo.';
  const vias =
    t.carreteraKm != null
      ? `La carretera primaria más cercana está a ${km(t.carreteraKm)}; el acceso final por terracería se confirma en campo.`
      : 'La base no trae carreteras cerca: el acceso se levanta en campo.';
  return { agua, vias };
}

/** Paso 8: el catastro. */
export function lecturaCatastro(t: TargetEjemplo): string {
  const c = t.concesionCercana;
  const cerca = c ? ` El derecho minero más cercano es «${c.nombre}»${c.estado ? `, en estado ${estadoDicho(c.estado)}` : ''}, a ${km(c.km)}${al(c.rumbo)}.` : '';
  return `Las ${n0(t.ha)} hectáreas están libres: ninguna concesión ni solicitud las cubre.${cerca}`;
}

/** Los estados del catastro de INHGEOMIN, dichos en palabras. */
export function estadoDicho(e: string): string {
  const k = e.trim().toLowerCase();
  return (
    {
      's-explorar': 'solicitud de exploración',
      's-explotar': 'solicitud de explotación',
      explorar: 'exploración',
      explotar: 'explotación',
      otorgada: 'otorgada',
      solicitud: 'solicitud',
      suspenso: 'suspenso',
      delimitada: 'delimitada',
    } as Record<string, string>
  )[k] || e;
}

export type FilaFicha = { criterio: string; resultado: string; marca: 'ok' | 'aviso' | 'info' };

/** Mapa 5: la ficha de factibilidad del target, armada con los datos (no con los del ejemplo). */
export function fichaFactibilidad(t: TargetEjemplo): { filas: FilaFicha[]; dictamen: string; factible: boolean } {
  const g = t.geologia;
  const modelo = tipoProbable(t);
  const oc = ocurrenciasCerca(t);
  const ocurr = oc.n;
  const ys = g?.yacimientos.length || 0;
  const libre = t.ha > 0 && t.ha - t.libreHa <= 0.01;
  const masCerca = [t.protegida, t.microcuenca].filter((x): x is Cercana => !!x).sort((a, b) => a.km - b.km)[0];
  const { agua } = lecturaAguaYVias(t);
  const filas: FilaFicha[] = [
    {
      criterio: 'Premisas geológicas',
      resultado: g?.unidad ? `${g.unidad}${g.fallasDentro ? ` · ${g.fallasDentro} ${g.fallasDentro === 1 ? 'falla' : 'fallas'} dentro` : g.fallaCercana ? ` · falla a ${km(g.fallaCercana.km)}` : ''}` : 'Sin geología cargada',
      marca: g?.unidad ? 'ok' : 'aviso',
    },
    {
      criterio: 'Indicios',
      resultado: [ocurr ? `${oc.dicho} ocurrencias en 5 km` : null, t.jica ? `${t.jica.muestras} muestras JICA` : null].filter(Boolean).join(' · ') || 'Sin ocurrencias registradas',
      marca: ocurr || t.jica ? 'ok' : 'aviso',
    },
    { criterio: 'Hallazgos', resultado: ys ? `${ys} yacimientos registrados cerca` : 'Por verificar en campo', marca: ys ? 'ok' : 'aviso' },
    { criterio: 'Tipo de target', resultado: `Metálico – ${t.mineral}${modelo ? ` · ${modelo}` : ''} (probable)`, marca: 'info' },
    { criterio: 'Restricciones', resultado: masCerca ? `Libre · la más cercana a ${km(masCerca.km)}` : 'Libre', marca: 'ok' },
    { criterio: 'División política', resultado: [t.departamento, t.municipio, t.aldeas[0]].filter(Boolean).join(' / ') || 'Sin ubicar', marca: 'info' },
    {
      criterio: 'Comunidades',
      resultado: t.poblacionDentro ? `${n0(t.poblacionDentro)} personas dentro · licencia social` : t.pobladosCerca ? `${t.pobladosCerca} poblados cerca` : 'Sin poblados registrados',
      marca: t.poblacionDentro || t.pobladosCerca ? 'aviso' : 'ok',
    },
    { criterio: 'Agua', resultado: t.rios.kmDentro > 0 ? `${km(t.rios.kmDentro)} de cauces dentro` : agua.replace(/\.$/, ''), marca: t.rios.kmDentro > 0 || t.rios.masCercano ? 'ok' : 'aviso' },
    {
      criterio: 'Vías',
      resultado: t.carreteraKm != null ? `Carretera primaria a ${km(t.carreteraKm)}` : 'Por levantar',
      marca: t.carreteraKm != null && t.carreteraKm <= 10 ? 'ok' : 'aviso',
    },
    { criterio: 'Catastro', resultado: libre ? 'Área libre' : 'Ocupada', marca: libre ? 'ok' : 'aviso' },
  ];
  const factible = libre;
  return { filas, dictamen: factible ? 'Factible para solicitud' : 'Reubicar el área', factible };
}

function lista(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`;
}

/** La fecha del mapa, como va en el rótulo: «10/10/2026». */
export function fechaMapa(d = new Date()): string {
  return d.toLocaleDateString('es-HN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
