/**
 * LO QUE DICE MIENTRAS TRABAJA. Una pregunta que tarda diez segundos en silencio parece una
 * pregunta que no se oyó. Dr Electrum avisa en voz alta qué está haciendo apenas se le pide algo
 * («estoy dibujando el mapa geológico para usted…») y, si la cosa se alarga, vuelve a decir en qué
 * va según la herramienta que acaba de usar.
 *
 * Las frases rotan: la misma muletilla dos veces seguidas suena a grabadora.
 */
import { normalizarDicho } from './comandos';

/** Las de siempre, para cuando la pregunta no deja adivinar qué va a hacer. */
export const FRASES_GENERALES = [
  'Déjeme revisar…',
  'Un momento, lo estoy buscando…',
  'Estoy viendo…',
  'A ver, déjeme ver…',
  'Ya lo busco…',
  'Estoy revisando la información…',
  'Mmm, déjeme pensarlo un segundo…',
  'Estoy consultando mis fuentes…',
  'Deme un segundito…',
  'Estoy juntando los datos…',
  'Estoy mirando en las carpetas…',
  'Déjeme revisar con calma…',
  'Buena pregunta, déjeme ver…',
  'Estoy repasando los registros…',
  'Voy a buscarlo, un momento…',
  'Déjeme confirmarlo…',
  'Lo estoy revisando ahora mismo…',
  'Eh… ya le digo, déjeme ver…',
];

type Tema = { si: RegExp; frases: string[] };

/** De lo más concreto a lo más general: gana el primero que calza. */
const TEMAS: Tema[] = [
  {
    si: /mapa (geologico|litologico|estructural|geotectonico)|geologico|litolog|geotecton|estructural/,
    frases: ['Estoy dibujando el mapa geológico para usted…', 'Déjeme trazarle las unidades geológicas…', 'Le estoy armando el mapa geológico, un momento…'],
  },
  {
    si: /\b(pdf|informe|reporte|imprimir|documento para)\b/,
    frases: ['Estoy armando el informe en PDF…', 'Voy maquetando el documento, un momento…', 'Le preparo el informe…'],
  },
  {
    si: /timelapse|time lapse|satelit|sentinel|vegetacion|deforest/,
    frases: ['Estoy juntando las imágenes satelitales…', 'Déjeme revisar lo que ve el satélite…'],
  },
  {
    si: /\b(expediente|expedientes|carpeta|carpetas|archivo|archivos|resolucion|contrato|escritura|jica)\b/,
    frases: ['Estoy buscando en las carpetas de expedientes…', 'Déjeme revisar los expedientes…', 'Estoy leyendo los documentos…'],
  },
  {
    si: /precio|cotiza|onza|spot|mercado/,
    frases: ['Estoy viendo el precio del metal ahora mismo…', 'Déjeme consultar el mercado…'],
  },
  {
    si: /internet|noticia|en la web|busca en|google/,
    frases: ['Estoy buscando en internet…', 'Déjeme ver qué dicen en la web…'],
  },
  {
    si: /traslap|conflicto|encima|superpon/,
    frases: ['Estoy cruzando las geometrías para ver los traslapes…', 'Déjeme medir dónde se enciman…'],
  },
  {
    si: /vence|vencimiento|caduc|renovar|plazo/,
    frases: ['Estoy revisando los vencimientos…', 'Déjeme ver las fechas en el catastro…'],
  },
  {
    si: /geolog|muestra|muestreo|ley de|oro|plata|cobre|alteracion|prospect|veta|falla/,
    frases: ['Estoy revisando la geología de la zona…', 'Déjeme ver las muestras y la geología…'],
  },
  {
    si: /calcul|cuanto (vale|sale|cuesta|da)|tonelaje|recuperacion|costo/,
    frases: ['Estoy haciendo los cálculos…', 'Déjeme sacar las cuentas…'],
  },
  {
    si: /concesion|catastro|titular|empresa|hectarea|municipio|departamento/,
    frases: ['Estoy revisando el catastro minero…', 'Déjeme buscarla en el catastro…', 'Estoy consultando el catastro…'],
  },
  {
    si: /mapa|muestrame|llevame|vuela|donde (queda|esta)|ubica/,
    frases: ['Le llevo el mapa hasta allá…', 'Estoy moviendo el mapa…'],
  },
];

let vuelta = 0;

/** Lo primero que dice al recibir una pregunta. `azar` solo existe para las pruebas. */
export function fraseDeTrabajo(pregunta: string, azar: () => number = Math.random): string {
  const t = normalizarDicho(pregunta);
  const tema = TEMAS.find((x) => x.si.test(t));
  // Una de cada tres veces, aunque haya tema, una general: que no suene a menú.
  if (tema && azar() > 0.25) return tema.frases[vuelta++ % tema.frases.length];
  vuelta++;
  return FRASES_GENERALES[Math.floor(azar() * FRASES_GENERALES.length) % FRASES_GENERALES.length];
}

/** Lo que dice acabada cada herramienta, si la espera se alarga. */
const TRAS_HERRAMIENTA: Record<string, string> = {
  catastro_buscar: 'Ya la encontré en el catastro, ahora lo reviso…',
  catastro_en_punto: 'Ya vi qué hay en ese punto…',
  catastro_resumen: 'Ya tengo las cifras del catastro, las ordeno…',
  catastro_vencimientos: 'Ya tengo los vencimientos, los estoy ordenando…',
  concesion_entorno: 'Ya revisé el entorno, sigo con lo demás…',
  expediente_buscar: 'Encontré algo en los expedientes, lo estoy leyendo…',
  expediente_leer: 'Estoy leyendo el expediente…',
  expediente_listar: 'Ya vi las carpetas, sigo…',
  geologia_zona: 'Ya tengo la geología, la estoy interpretando…',
  mapa_geologico: 'El mapa ya casi está…',
  gis_traslapes: 'Ya medí los traslapes, sigo…',
  gis_medir: 'Ya lo medí…',
  web_buscar: 'Ya encontré algunas fuentes, las estoy leyendo…',
  web_leer: 'Estoy leyendo la página…',
  metales_spot: 'Ya tengo el precio…',
  informe_pdf: 'El informe ya casi está…',
  calculo_mina: 'Ya hice las cuentas, se las explico…',
};

const SIGUE = ['Sigo en eso, ya casi…', 'Esto lleva un poquito más, ya casi termino…', 'Estoy terminando de redactarlo…', 'Ya casi lo tengo…'];

/** La frase de «sigo en eso». `n` es cuántas van en este turno. */
export function fraseDeEspera(herramienta: string | null, n: number): string {
  return (herramienta && TRAS_HERRAMIENTA[herramienta]) || SIGUE[n % SIGUE.length];
}
