/**
 * EL RECORRIDO GUIADO.
 *
 * Un botón y Dr Electrum se presenta solo, en ocho capítulos y todo en 3D: Honduras desde el aire,
 * el potencial de cada concesión, lo que ve el satélite, la zona con más información del país (con
 * los mapas de JICA encima), el análisis completo de su mejor concesión, la geoquímica de campo,
 * los conflictos y lo que se le puede pedir. Con su voz, subtítulos y las cifras en pantalla.
 *
 * No pasa por el modelo: cada frase sale de datos reales (el tablero, las fichas, los mapas
 * escaneados, las muestras), así que no hay esperas ni riesgo de que improvise. La zona y la
 * concesión no están escritas a mano: las elige `guion.ts` con lo que haya en la base ese día.
 *
 * El cuadro vive dentro del mapa, abajo y apartado de la ficha; se arrastra, se achica y tiene
 * «Siguiente» para saltar de capítulo. Al terminar, todo vuelve a como estaba (el 3D se queda).
 */
import { useEffect, useRef, useState, type PointerEvent as EventoPuntero } from 'react';
import { headersElectrum } from '../acceso';
import { callar, desbloquear, escucharEscena, hablar, hablarDialogo, msDeLectura } from '../panel/voz';
import { fijarRecorrido } from '../personajes/mesa';
import type { CapaExtra, Fondo, Margen, OrdenMapa, RasterEncendido, RasterEscaneado, Tocado } from '../mapa/captura';
import { catastroGuardado } from '../mapa/captura';
import type { MuestrasEncendidas } from '../mapa/CapasControl';
import { Contador, pedirTablero, type DatosTablero } from '../mapa/Tablero';
import { analisisDeFicha, centroDe, concesionesEn, enOracion, focoDeOro, fold, nombreParaDecir, vencimientos, zonaMasRica, type Ficha } from './guion';
import { ALTURAS } from '../preferencias';

export { nombreParaDecir } from './guion';

const AMBAR = '#FFAE3B';
const HONDURAS: [number, number, number, number] = [-89.4, 12.9, -83.1, 16.6];
/** Durante el recorrido el mapa se lleva casi toda la pantalla: es la función. */
const ALTO_RECORRIDO = 0.12;

type Estado = { fondo: Fondo; alto: number; rasters: RasterEncendido[]; muestras: MuestrasEncendidas | null; extras: CapaExtra[]; prospectividad: boolean };

export type Controles = {
  orden: (o: OrdenMapa) => void;
  /** El 3D es de MapLibre: el recorrido lo pone antes de empezar, aunque estuvieran en Google. */
  maplibre: () => void;
  tresD: (v: boolean) => void;
  tocar: (t: Tocado | null) => void;
  capas: (f: (antes: CapaExtra[]) => CapaExtra[]) => void;
  cara: (f: 'IDLE' | 'SPEAKING' | 'THINKING') => void;
  rasters: (r: RasterEncendido[]) => void;
  muestras: (m: MuestrasEncendidas | null) => void;
  prospectividad: (v: boolean) => void;
  fondo: (f: Fondo) => void;
  alto: (a: number) => void;
  estado: () => Estado;
  /** Si la cara estaba en el centro, que ceda el paso al mapa. */
  trabajo: () => void;
  /** El visor del mapa: esquinas y nombre sobre lo que se está mostrando (null lo quita). */
  enfocar: (e: { encuadre: [number, number, number, number]; etiqueta?: string } | null) => void;
  /** Abre un mapa o PDF en el visor a pantalla completa (null lo cierra). */
  visor: (f: { tipo: 'imagen' | 'pdf'; nombre: string; url: string; titulo?: string } | null) => void;
};

export type ModoRecorrido = 'completo' | 'geologico' | 'legal' | 'herramientas';

type Cifra = { valor: number; etiqueta: string; d?: number };
type Capitulo = { titulo: string; cifras?: Cifra[]; chips?: string[] };

// Formato de España a propósito: esto se DICE en voz alta, y «46.839,5» la voz lo lee como número;
// «46,839.5» lo leería como «cuarenta y seis coma…».
const nf = (x: number, d = 0) => x.toLocaleString('es-ES', { maximumFractionDigits: d });
const plural = (n: number, uno: string, varios: string) => `${nf(n)} ${n === 1 ? uno : varios}`;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tres intentos ante una red que se corta o un servidor que tarda (5xx, 429). Sin esto, en un
 * teléfono con mala señal el recorrido se saltaba capítulos enteros sin decir nada: un pedido que
 * se pierde no puede costar la mitad de la presentación.
 */
async function reintentar<T>(pedir: () => Promise<T>, intentos = 3): Promise<T> {
  for (let k = 1; ; k++) {
    try {
      return await pedir();
    } catch (e: any) {
      if (k >= intentos || e?.definitivo) throw e;
      await espera(700 * k);
    }
  }
}

async function json<T>(url: string): Promise<T> {
  return reintentar(async () => {
    const r = await fetch(url, { headers: headersElectrum() });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const e: any = new Error(j?.error || `El servidor contestó ${r.status}.`);
      // Un 404 o un 403 no se arreglan insistiendo.
      e.definitivo = r.status < 500 && r.status !== 429;
      throw e;
    }
    return j as T;
  });
}

/** Lo que manda /api/electrum/cartera: el resumen para decidir, sin geometrías. */
type DatosCartera = {
  cartera: string;
  total: number;
  enCatastro: number;
  hectareas: number;
  porNivel: { rojo: number; ambar: number; verde: number; incompleto?: number };
  filas: Array<{ id: number; nombre: string; estado: string | null; hectareas: number; prospectividad: number | null; nivel: 'rojo' | 'ambar' | 'verde' | 'incompleto'; motivos: Array<{ tipo: string; nombre: string; zona: string | null; pct: number }> }>;
};
const ficha = (id: number) => json<Ficha & { encuadre: [number, number, number, number] | null }>(`/api/electrum/mapa/concesion/${id}`).catch(() => null);
const capa = (c: { id: number; nombre: string } | undefined) =>
  c ? json<{ rol: any; geojson: any }>(`/api/electrum/mapa/capa/${c.id}`).then((r) => ({ id: c.id, nombre: c.nombre, rol: r.rol, geojson: r.geojson }) as CapaExtra).catch(() => null) : Promise.resolve(null);

const soloConRasgos = (xs: Array<CapaExtra | null>) => xs.filter((x): x is CapaExtra => !!x && !!x.geojson?.features?.length);

/** El rectángulo que encierra unas capas, para volar a ellas. */
function cajaDe(xs: CapaExtra[]): [number, number, number, number] | null {
  const b = [180, 90, -180, -90];
  let hay = false;
  const ver = (c: any) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]);
      b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]);
      b[3] = Math.max(b[3], c[1]);
      hay = true;
    } else c.forEach(ver);
  };
  for (const x of xs) for (const f of (x.geojson as any)?.features || []) ver(f.geometry?.coordinates);
  return hay ? (b as [number, number, number, number]) : null;
}

const SIN_MARGEN: Margen = { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 };
/** Ancho que ocupa la ficha a la derecha en la computadora (372 px más su separación del borde). */
const ANCHO_FICHA = 440;

const enCompu = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

const CAPACIDADES = ['Pregunta con la voz', 'Manos libres', 'Web, app y Telegram', 'Ficha en PDF', 'Mapas geológicos', 'Timelapse satelital', 'KML · GeoJSON · DXF', 'Perfil del terreno', 'Pedir área nueva', 'Alertas'];

export function Recorrido({
  activo,
  onTerminar,
  controles,
  fichaAbierta = false,
  modo = 'completo',
}: {
  activo: boolean;
  /** `natural`: llegó al final (se ofrecen preguntas); false si alguien lo detuvo. */
  onTerminar: (natural: boolean) => void;
  controles: Controles;
  fichaAbierta?: boolean;
  modo?: ModoRecorrido;
}) {
  const [texto, setTexto] = useState('');
  const [n, setN] = useState(0);
  const [total, setTotal] = useState(8);
  const [cap, setCap] = useState<Capitulo>({ titulo: 'Preparando el recorrido' });
  const [chico, setChico] = useState(false);
  /** Dónde lo dejó quien lo arrastró (px dentro del mapa); null = su sitio de siempre. */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  /** El control de la pantalla que se está explicando (selector CSS), con un anillo alrededor. */
  const [foco, setFoco] = useState<string | null>(null);
  /** El título grande de cada capítulo, que aparece un momento al centro, como en una película. */
  const [titular, setTitular] = useState<{ n: number; titulo: string; clave: number } | null>(null);
  const restaurado = useRef(false);
  const caja = useRef<HTMLDivElement>(null);
  const vivo = useRef(0);
  /** El capítulo que se pidió saltar, y cómo despertar la espera en curso. */
  const saltado = useRef(-1);
  const despertar = useRef<(() => void) | null>(null);
  const c = useRef(controles);
  c.current = controles;
  const ficha$ = useRef(fichaAbierta);
  ficha$.current = fichaAbierta;

  /**
   * Lo que tapan el cuadro y la ficha, medido en pantalla en el momento de mover la cámara: así lo
   * que se muestra queda en la parte libre del mapa y no debajo del texto que lo explica.
   */
  const margenAhora = (): Margen => {
    const el = caja.current;
    const padre = el?.offsetParent as HTMLElement | null;
    if (!el || !padre) return SIN_MARGEN;
    const r = el.getBoundingClientRect();
    const p = padre.getBoundingClientRect();
    const compu = enCompu();
    const abajoDelMedio = r.top > p.top + p.height / 2;
    let arriba = abajoDelMedio ? 0 : Math.max(0, r.bottom - p.top + 12);
    let abajo = abajoDelMedio ? Math.max(0, p.bottom - r.top + 12) : 0;
    const derecha = ficha$.current && compu ? ANCHO_FICHA : 0;
    // En el teléfono la ficha sube desde abajo.
    if (ficha$.current && !compu) abajo = Math.max(abajo, p.height * 0.5);
    // Que siempre quede al menos el 40 % del alto para mirar.
    const tope = p.height * 0.6;
    if (arriba + abajo > tope) {
      const k = tope / (arriba + abajo);
      arriba *= k;
      abajo *= k;
    }
    return { arriba, abajo, izquierda: 0, derecha: Math.min(derecha, p.width * 0.5) };
  };
  const margen$ = useRef(margenAhora);
  margen$.current = margenAhora;

  const saltar = () => {
    saltado.current = nActual.current;
    callar();
    despertar.current?.();
  };
  const nActual = useRef(0);
  // «Siguiente» dicho en voz alta (el micrófono abierto lo manda como evento).
  const saltar$ = useRef(saltar);
  saltar$.current = saltar;
  useEffect(() => {
    if (!activo) return;
    const alPedir = (e: Event) => {
      if ((e as CustomEvent<string>).detail === 'siguiente') saltar$.current();
    };
    window.addEventListener('electrum:recorrido', alPedir);
    return () => window.removeEventListener('electrum:recorrido', alPedir);
  }, [activo]);

  useEffect(() => {
    if (!activo) return;
    const mio = ++vivo.current;
    const sigue = () => vivo.current === mio;
    const antes = c.current.estado();
    setPos(null);
    setChico(false);

    const capitulo = (i: number, k: Capitulo) => {
      nActual.current = i;
      setN(i);
      setCap(k);
      // Cada capítulo empieza limpio: el visor del anterior ya no señala nada de este.
      c.current.enfocar(null);
      if (i > 0) setTitular({ n: i, titulo: k.titulo, clave: Date.now() });
    };
    const saltoEste = () => saltado.current === nActual.current;
    /** Una espera que el botón «Siguiente» corta. */
    const pausa = (ms: number) =>
      new Promise<void>((r) => {
        if (saltoEste()) return r();
        const t = setTimeout(r, ms);
        despertar.current = () => {
          clearTimeout(t);
          r();
        };
      });
    /** Dice un texto con subtítulo; si la voz falla, espera lo que se tarda en leerlo. */
    const decir = async (t: string) => {
      if (!sigue() || saltoEste()) return;
      setTexto(t);
      const t0 = Date.now();
      c.current.cara('SPEAKING');
      await Promise.race([hablar(t, 'neutral', headersElectrum(), {}), new Promise<void>((r) => (despertar.current = r))]);
      if (!sigue()) return;
      const falta = Math.min(10_000, 1400 + t.length * 46) - (Date.now() - t0);
      if (falta > 0) await pausa(falta);
      if (sigue()) c.current.cara('IDLE');
    };
    /**
     * LA MESA CONVERSA. Un diálogo de los tres (una sola locución a varias voces, sin cortes entre
     * líneas) donde cada línea puede traer su gesto de cámara o de capa (`al`): se dispara cuando esa
     * línea EMPIEZA a sonar —lo dice la escena de voz.ts con los tiempos de ElevenLabs—. Así el mapa
     * se mueve con lo que se dice, no antes ni después. Sin voz (silencio o fallo), se lee al ritmo de
     * lectura con los mismos gestos.
     */
    type Linea = { quien: 'electrum' | 'tatiana' | 'chema'; texto: string; al?: () => void };
    const NOMBRES = { electrum: 'Dr Electrum', tatiana: 'Ing. Tatiana', chema: 'Don Chema' } as const;
    const limpio = (t: string) => t.replace(/\[[^\]]+\]\s*/g, '');
    const conversar = async (lineas: Linea[]) => {
      const ls = lineas.filter((l) => l.texto.trim());
      if (!sigue() || saltoEste() || !ls.length) return;
      let hechas = 0;
      const hasta = (k: number) => {
        for (; hechas <= k && hechas < ls.length; hechas++) {
          if (!sigue()) return;
          try {
            ls[hechas].al?.();
          } catch {
            /* un gesto que falla no para la conversación */
          }
        }
        setTexto(`${NOMBRES[ls[Math.min(k, ls.length - 1)].quien]}: ${limpio(ls[Math.min(k, ls.length - 1)].texto)}`);
      };
      hasta(0);
      const soltar = escucharEscena((e) => {
        if (!e.linea) return;
        const k = ls.findIndex((l, j) => j >= hechas - 1 && l.texto === e.linea);
        if (k >= 0) hasta(k);
      });
      c.current.cara('SPEAKING');
      let fallo = false;
      const t0 = Date.now();
      await Promise.race([
        hablarDialogo(
          ls.map((l) => ({ quien: l.quien, nombre: NOMBRES[l.quien], texto: l.texto })),
          headersElectrum(),
          { alFallar: () => (fallo = true) }
        ),
        new Promise<void>((r) => (despertar.current = r)),
      ]);
      soltar();
      if (saltoEste()) callar();
      // Sin voz: se lee, con los mismos gestos en su momento.
      if (fallo && sigue() && !saltoEste()) {
        for (let k = hechas; k < ls.length && sigue() && !saltoEste(); k++) {
          hasta(k);
          await pausa(msDeLectura(limpio(ls[k].texto)));
        }
      } else if (Date.now() - t0 < 800 && sigue() && !saltoEste()) await pausa(1200);
      if (sigue()) {
        hasta(ls.length - 1);
        c.current.cara('IDLE');
      }
    };
    /** Toda orden de cámara del recorrido lleva el margen de ese momento. */
    const mover = (o: OrdenMapa) => c.current.orden(o.accion === 'volar' || o.accion === 'camara' || o.accion === 'encuadrar' || o.accion === 'orbitar' ? ({ ...o, margen: margen$.current() } as OrdenMapa) : o);
    const orbitar = (grados: number, ms: number) => mover({ accion: 'orbitar', grados, ms });

    let natural = false;
    (async () => {
      try {
        fijarRecorrido(true);
        capitulo(0, { titulo: 'Preparando el recorrido' });
        setTexto('Juntando las cifras, los mapas y las fichas…');
        c.current.trabajo();
        c.current.maplibre();
        // En el de herramientas hace falta ver el chat y sus botones; en los demás, el mapa grande.
        c.current.alto(modo === 'herramientas' ? ALTURAS.dividido : ALTO_RECORRIDO);
        c.current.fondo('satelite');
        c.current.tocar(null);
        c.current.tresD(true);

        /*
         * Cada recorrido pide solo lo que va a contar: el de herramientas no necesita el tablero
         * nacional (lo más lento de armar) ni las fichas de los conflictos, y se notaba en la espera.
         */
        const completo = modo === 'completo';
        const [t, rasters, capas, perdidas, ranking, muestras] = await Promise.all([
          completo || modo === 'legal' ? reintentar(() => pedirTablero()).catch(() => null as DatosTablero | null) : Promise.resolve(null as DatosTablero | null),
          modo !== 'legal'
            ? json<{ rasters: RasterEscaneado[] }>('/api/electrum/mapa/rasters').then((j) => j.rasters || []).catch(() => [] as RasterEscaneado[])
            : Promise.resolve([] as RasterEscaneado[]),
          modo !== 'herramientas'
            ? json<{ capas: Array<{ id: number; nombre: string; rol: string; entidades?: number }> }>('/api/electrum/mapa/capas').then((j) => j.capas || []).catch(() => [])
            : Promise.resolve([] as Array<{ id: number; nombre: string; rol: string; entidades?: number }>),
          completo
            ? json<{ lista: Array<{ id: number; nombre: string; ha: number }> }>('/api/electrum/satelite/mayores').then((j) => j.lista || []).catch(() => [])
            : Promise.resolve([] as Array<{ id: number; nombre: string; ha: number }>),
          completo || modo === 'herramientas'
            ? json<{ ranking: Array<{ id: number; nombre: string; puntaje: number }> }>('/api/electrum/prospectividad').then((j) => j.ranking || []).catch(() => [])
            : Promise.resolve([] as Array<{ id: number; nombre: string; puntaje: number }>),
          completo || modo === 'geologico' ? json<any>('/api/electrum/mapa/muestras').catch(() => null) : Promise.resolve(null),
        ]);
        const cartera =
          completo || modo === 'legal'
            ? await json<{ analisis: DatosCartera | null }>('/api/electrum/cartera').then((j) => j.analisis).catch(() => null)
            : null;
        const catastro = catastroGuardado() ?? (await json<{ geojson: any }>('/api/electrum/catastro.geojson').then((j) => j.geojson).catch(() => null));
        if (!sigue()) return;

        const zona = zonaMasRica(rasters as any);
        const enZona = zona ? concesionesEn(catastro, zona.encuadre) : [];
        const oro = focoDeOro(muestras);
        const conflicto = t?.areasProtegidas?.lista[0];
        const s2 = (k: string) => rasters.find((r) => r.clave === k);
        const [fZona, fPerdida, fConflicto, fallas, protegidas] = await Promise.all([
          enZona[0] && modo !== 'herramientas' ? ficha(enZona[0].id) : Promise.resolve(null),
          perdidas[0] ? ficha(perdidas[0].id) : Promise.resolve(null),
          conflicto ? ficha(conflicto.id) : Promise.resolve(null),
          capa(zona ? capas.find((x) => x.rol === 'falla' && fold(x.nombre).includes(fold(zona.nombre))) : undefined),
          capa(capas.find((x) => x.rol === 'area_protegida')),
        ]);
        if (!sigue()) return;

        /*
         * LOS CAPÍTULOS. Cada uno sabe si tiene datos para contarse (`hay`) y cómo contarse. Cada modo
         * elige cuáles y en qué orden: el completo lo muestra todo, los otros van a su tema.
         */
        const venc = vencimientos(catastro);
        const traslapeMayor = t?.traslapes?.mayores?.[0];
        // De la cartera: la más prioritaria (verde) y la roja más grande, para mostrar las dos puntas.
        const cVerde = cartera?.filas.find((f) => f.nivel === 'verde');
        const cRoja = cartera?.filas.filter((f) => f.nivel === 'rojo').sort((a, b) => b.hectareas - a.hectareas)[0];
        const [fTraslape, fProspecta, fRoja] = await Promise.all([
          (modo === 'legal' || completo) && traslapeMayor ? ficha(traslapeMayor.aId) : Promise.resolve(null),
          modo === 'herramientas' && (enZona[0] || ranking[0]) ? ficha((enZona[0] || ranking[0]).id) : Promise.resolve(null),
          cRoja ? ficha(cRoja.id) : Promise.resolve(null),
        ]);
        const microcuencas = cartera ? await capa(capas.find((x) => x.rol === 'microcuenca')) : null;
        /*
         * LO HISTÓRICO (JICA y el catastro viejo): capas de referencia, rol `historico`. Se ven con su
         * propio estilo (punteado sepia) y NUNCA cuentan en las cifras del catastro vigente. Primero
         * las de JICA; como mucho dos, que el mapa no se vuelva un mantel.
         */
        const historicasCapas =
          completo || modo === 'geologico'
            ? (
                await Promise.all(
                  capas
                    .filter((x) => x.rol === 'historico')
                    .sort((a, b) => Number(/jica|mmaj/i.test(b.nombre)) - Number(/jica|mmaj/i.test(a.nombre)))
                    .slice(0, 2)
                    .map((x) => capa(x))
                )
              ).filter((x): x is CapaExtra => !!x && !!x.geojson?.features?.length)
            : [];
        /*
         * LO CARGADO (lote-1, 26 GB): la biblioteca, el mapa político, los yacimientos, los proyectos
         * de la casa con sus terrenos y vetas, y lo de campo. Cada cosa se pide una vez, aquí, y el
         * capítulo que no tenga datos no se cuenta.
         */
        const conLote = completo || modo === 'geologico';
        const [biblio, carpetas, politicas, yacimientos, terrenos, campo] = conLote
          ? await Promise.all([
              json<{ documentos: number; capas: number; fragmentos: number; carpetas: number }>('/api/electrum/biblioteca/resumen').catch(() => null),
              json<{ carpetas: Array<{ carpeta: string | null; documentos: number; capas: number }> }>('/api/electrum/biblioteca/arbol').then((j) => j.carpetas || []).catch(() => []),
              Promise.all(capas.filter((x) => x.rol === 'departamento' || x.rol === 'municipio').map((x) => capa(x))).then(soloConRasgos),
              Promise.all(
                capas
                  .filter((x) => x.rol === 'ocurrencia')
                  .sort((a, b) => (b.entidades ?? 0) - (a.entidades ?? 0))
                  .slice(0, 4)
                  .map((x) => capa(x))
              ).then(soloConRasgos),
              Promise.all(capas.filter((x) => x.rol === 'proyecto' && /terreno|vetas (recorridas|proyectadas)/i.test(x.nombre)).slice(0, 8).map((x) => capa(x))).then(soloConRasgos),
              Promise.all(capas.filter((x) => /videos? de campo|fotos? .*gps/i.test(x.nombre)).slice(0, 2).map((x) => capa(x))).then(soloConRasgos),
            ])
          : [null, [], [], [], [], []];
        /** Lo cargado por carpeta de arriba (INFORMACION ELECTRUM, INDEXSA SEP 2026…), de mayor a menor. */
        const porRaiz = new Map<string, number>();
        for (const k of carpetas) {
          const raiz = (k.carpeta || 'Sin carpeta').split('/')[0];
          porRaiz.set(raiz, (porRaiz.get(raiz) || 0) + k.documentos + k.capas);
        }
        const raices = [...porRaiz].sort((a, b) => b[1] - a[1]);
        const docsProyectos = carpetas.filter((k) => /PROYECTOS INDEXSA/i.test(k.carpeta || '')).reduce((s2, k) => s2 + k.documentos, 0);
        const ref = (k: string) => rasters.find((r) => r.clave === k);
        const rios = ref('referencia-rios-hn');
        const caserios = ref('referencia-caserios-hn');
        const fallas50 = ref('referencia-fallas-1-50000');
        const hojas = rasters.find((r) => /hojas/i.test(r.clave));
        const hoja1620 = rasters.find((r) => /1620/.test(r.clave));
        const cajaTerrenos = cajaDe(terrenos);
        const cajaCampo = cajaDe(campo);
        const nombresHistoricos = t?.fuente?.historicas ?? capas.filter((x) => x.rol === 'historico').map((x) => x.nombre);
        const hayCatastroViejo = nombresHistoricos.some((n) => !/jica|mmaj/i.test(n));
        /*
         * Qué catastro es, dicho desde el dato (no con una fecha escrita a mano): el nombre de la capa
         * vigente si está ordenado en una sola; si hay varias mezcladas, se dice así, sin elegir una.
         */
        const fuenteDicha = t?.fuente?.vigente
          ? `el catastro vigente de INHGEOMIN, «${enOracion(t.fuente.vigente)}»`
          : (t?.fuente?.capasVigentes ?? 0) > 1
            ? `el catastro cargado, todavía en ${t!.fuente!.capasVigentes} capas sin ordenar`
            : 'el catastro minero nacional vigente';
        if (!sigue()) return;
        const limpiar = () => {
          c.current.rasters([]);
          c.current.muestras(null);
          c.current.capas(() => []);
          c.current.prospectividad(false);
          c.current.tocar(null);
          c.current.enfocar(null);
          setFoco(null);
        };
        /**
         * Abre la ficha y vuela a la concesión, dejando libre el lado de la ficha (en el teléfono no
         * la abre). Al llegar, el visor la enmarca con su nombre: de lejos una concesión es una
         * mancha de color que se pierde entre las demás, y así se sabe exactamente cuál es.
         */
        const irConFicha = async (f: Ficha & { encuadre: [number, number, number, number] | null }, siempre = false) => {
          c.current.enfocar(null);
          if (enCompu() || siempre) {
            c.current.tocar({ tipo: 'concesion', id: f.id, nombre: f.nombre, lngLat: centroDe(f.encuadre!) });
            await pausa(350);
          }
          mover({ accion: 'volar', geojson: f.geojson, encuadre: f.encuadre! });
          await pausa(2600);
          if (sigue() && f.encuadre) c.current.enfocar({ encuadre: f.encuadre, etiqueta: nombreParaDecir(f.nombre) });
          await pausa(400);
        };
        /** La ficha que se usa para enseñar los botones: la de la zona más rica, o la más prometedora. */
        const fDemo = fProspecta?.geojson && fProspecta.encuadre ? fProspecta : fZona?.geojson && fZona.encuadre ? fZona : null;
        /** Espera a que aparezca un control (la ficha se abre con animación) y lo devuelve. */
        const esperarControl = async (selector: string, ms = 4000) => {
          for (let k = 0; k < ms / 200 && sigue(); k++) {
            const el = document.querySelector(selector) as HTMLElement | null;
            if (el) return el;
            await espera(200);
          }
          return null;
        };
        /** Enseña un control de la pantalla con un anillo, mientras lo explica. */
        const senalar = async (selector: string, titulo: string, textos: string[]) => {
          capitulo(++i, { titulo });
          c.current.tocar(null);
          // Algunos controles aparecen cuando el mapa termina de cargar: se los espera un poco.
          for (let k = 0; k < 20 && sigue() && !document.querySelector(selector); k++) await espera(200);
          setFoco(selector);
          for (const x of textos) await decir(x);
          setFoco(null);
        };
        let i = 0;

        type Cap = { hay: boolean; correr: () => Promise<void> };
        const C: Record<string, Cap> = {
          intro: {
            hay: true,
            correr: async () => {
              limpiar();
              capitulo(++i, {
                titulo: modo === 'legal' ? 'El catastro, con ojos legales' : modo === 'geologico' ? 'La geología de Honduras' : 'Honduras, en tres dimensiones',
                cifras: t
                  ? [
                      { valor: t.total.concesiones, etiqueta: 'concesiones' },
                      { valor: t.total.hectareas, etiqueta: 'hectáreas' },
                      { valor: t.traslapes.entreTitulares?.total ?? t.traslapes.total, etiqueta: 'traslapes a verificar' },
                      ...(t.poblados ? [{ valor: t.poblados.caserios, etiqueta: 'caseríos dentro' }] : []),
                    ]
                  : undefined,
              });
              mover({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 58, giro: -24, ms: 5000 });
              await pausa(1800);
              orbitar(26, 26_000);
              const cuantas = t ? `${plural(t.total.concesiones, 'concesión', 'concesiones')} y ${nf(t.total.hectareas)} hectáreas` : 'todo el catastro minero nacional';
              // Qué catastro es: el vigente, con su nombre, para que nadie crea que ve información vieja.
              const fuente = fuenteDicha;
              if (modo === 'legal') {
                await conversar([
                  { quien: 'tatiana', texto: `[serious] Hoy miramos ${fuente} con ojos legales: ${cuantas}, cada una cruzada con las áreas protegidas, el agua, las comunidades y los demás derechos.` },
                  { quien: 'electrum', texto: '[thoughtful] Y con sus fechas. Lo que un regulador o un abogado necesita saber antes de firmar nada.' },
                ]);
              } else if (modo === 'geologico') {
                await conversar([
                  { quien: 'electrum', texto: '[warmly] Hoy le muestro la geología: los mapas de JICA escaneados sobre el terreno real, las fallas, la geoquímica de campo y lo que ve el satélite.' },
                  { quien: 'chema', texto: '[curious] Y todo eso cruzado con las concesiones, doctor. Así sabemos qué roca le toca a cada quien.' },
                ]);
              } else {
                await conversar([
                  { quien: 'electrum', texto: '[warmly] Buenas. Soy Dr Electrum. Esto es Honduras, con su relieve real, en tres dimensiones.' },
                  { quien: 'tatiana', texto: '[curious] Doctor, ¿y todo eso que brilla encima del mapa?' },
                  { quien: 'electrum', texto: `Es ${fuente}: ${cuantas}. Y cada concesión cruzada con la geología, el satélite, las áreas protegidas, el agua y las comunidades.`, al: () => orbitar(30, 30_000) },
                  { quien: 'chema', texto: '[chuckles] O sea que antes de ir al monte ya sabemos qué nos vamos a encontrar.' },
                  { quien: 'electrum', texto: '[warmly] Exacto, Don Chema. Hoy les enseñamos cómo lo trabajamos los tres: yo la geología, usted la planta y la ingeniera Tatiana la obra y los permisos.' },
                ]);
              }
            },
          },
          potencial: {
            // Sin ranking no hay nada que contar: encender la capa vacía era mostrar un mapa en blanco.
            hay: ranking.length > 0,
            correr: async () => {
              capitulo(++i, { titulo: 'El potencial de cada concesión', chips: ranking.slice(0, 3).map((r) => `${nombreParaDecir(r.nombre)} · ${r.puntaje}`) });
              await conversar([
                {
                  quien: 'chema',
                  texto: '[curious] Doctor, de todas esas, ¿cuáles valen la pena de verdad?',
                  al: () => {
                    c.current.prospectividad(true);
                    mover({ accion: 'camara', centro: [-86.6, 14.6], zoom: 7.4, inclinacion: 62, giro: 12, ms: 5000 });
                  },
                },
                { quien: 'electrum', texto: '[thoughtful] A cada una le calculo un puntaje de prospectividad de cero a cien, con la geología, la geoquímica histórica de JICA y el satélite. En rojo, las más prometedoras.', al: () => orbitar(-22, 22_000) },
                ...(ranking.length >= 3 ? [{ quien: 'electrum' as const, texto: `Hoy encabezan ${nombreParaDecir(ranking[0].nombre)}, ${nombreParaDecir(ranking[1].nombre)} y ${nombreParaDecir(ranking[2].nombre)}.` }] : []),
                { quien: 'tatiana', texto: '[serious] Y las que laten son alertas: las que vencen pronto o las que perdieron vegetación. Esas me toca revisarlas a mí primero.' },
                { quien: 'chema', texto: 'Mientras nadie tenga que acordarse de memoria, doctor, vamos bien.' },
              ]);
            },
          },
          satelite: {
            hay: !!(fPerdida?.geojson && fPerdida.encuadre && s2('s2-veg')),
            correr: async () => {
              c.current.prospectividad(false);
              capitulo(++i, { titulo: 'Lo que ve el satélite', cifras: [{ valor: perdidas[0].ha, etiqueta: 'ha de vegetación perdida', d: 1 }] });
              await conversar([
                {
                  quien: 'tatiana',
                  texto: `[serious] Esta me preocupa. Es ${nombreParaDecir(fPerdida!.nombre)}: comparando las imágenes del satélite Sentinel-2 de cada temporada seca, perdió ${nf(perdidas[0].ha, 1)} hectáreas de vegetación de un año al otro.`,
                  al: () => {
                    c.current.rasters([{ ...s2('s2-veg')!, opacidad: 0.85 }]);
                    mover({ accion: 'volar', geojson: fPerdida!.geojson, encuadre: fPerdida!.encuadre! });
                  },
                },
                { quien: 'chema', texto: '[curious] ¿Y eso qué es, ingeniera? ¿Un tajo o una quema?', al: () => orbitar(40, 24_000) },
                { quien: 'tatiana', texto: '[thoughtful] Puede ser un tajo, un camino o una quema. Eso se confirma en campo, pero lo importante es que lo vemos antes de que llegue una denuncia.' },
                ...(s2('s2-arc')
                  ? [
                      {
                        quien: 'electrum' as const,
                        texto: 'Y con las mismas bandas yo busco alteración hidrotermal: arcillas y óxidos de hierro, la huella que dejan los fluidos que traen el oro y el cobre.',
                        al: () => c.current.rasters([{ ...s2('s2-arc')!, opacidad: 0.85 }]),
                      },
                    ]
                  : []),
              ]);
            },
          },
          alteracion: {
            hay: !!(zona && (s2('s2-arc') || s2('s2-fe'))),
            correr: async () => {
              capitulo(++i, { titulo: 'Alteración vista desde el satélite' });
              c.current.tocar(null);
              c.current.muestras(null);
              c.current.capas(() => []);
              c.current.rasters([{ ...(s2('s2-arc') || s2('s2-fe'))!, opacidad: 0.85 }]);
              mover({ accion: 'encuadrar', encuadre: zona!.encuadre, inclinacion: 60, giro: -20, ms: 5000 });
              await pausa(2000);
              orbitar(30, 26_000);
              await decir('Con las bandas del satélite Sentinel-2 busco alteración hidrotermal en todo el país: arcillas, que es lo que deja el fluido caliente en la roca.');
              if (s2('s2-fe') && s2('s2-arc')) {
                c.current.rasters([{ ...s2('s2-fe')!, opacidad: 0.85 }]);
                await decir('Y óxidos de hierro, que marcan sulfuros meteorizados. No es un hallazgo: es una guía para ordenar dónde ir a campo primero.');
              }
            },
          },
          biblioteca: {
            hay: !!biblio?.documentos,
            correr: async () => {
              limpiar();
              capitulo(++i, {
                titulo: 'Todo lo que leí',
                cifras: [
                  { valor: biblio!.documentos, etiqueta: 'documentos' },
                  { valor: biblio!.capas, etiqueta: 'capas del mapa' },
                  { valor: biblio!.fragmentos, etiqueta: 'fragmentos indexados' },
                ],
                chips: raices.slice(0, 5).map(([k, n]) => `${k} · ${nf(n)}`),
              });
              mover({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 30, giro: 0, ms: 4000 });
              await conversar([
                {
                  quien: 'electrum',
                  texto: `[warmly] Antes de seguir, lo que tengo leído. Son ${plural(biblio!.documentos, 'documento', 'documentos')} y ${plural(biblio!.capas, 'capa', 'capas')} de mapa: los veintiséis gigas que me subieron, con informes, leyes, planos, hojas de cálculo, fichas de ocurrencia, fotos y videos de campo.`,
                },
                {
                  quien: 'electrum',
                  texto: `Lo partí en ${nf(biblio!.fragmentos)} fragmentos que puedo buscar por significado, no solo por palabra. Cuando le contesto algo, le digo de qué documento y de qué página sale.`,
                },
                ...(docsProyectos ? [{ quien: 'tatiana' as const, texto: `[curious] ¿Y los proyectos de la casa también, doctor? Pantaleona, El Chaparro, Buena Vista, Minas de Oro…` }, { quien: 'electrum' as const, texto: `Todos. Solo de los proyectos son ${plural(docsProyectos, 'documento', 'documentos')}: lo legal, lo técnico, las finanzas y lo ambiental de cada uno.` }] : []),
              ]);
            },
          },
          politico: {
            hay: politicas.length > 0,
            correr: async () => {
              limpiar();
              capitulo(++i, { titulo: 'El mapa de Honduras, por capas', chips: ['Mapa político', 'Geología', 'Yacimientos', 'Ambiente', 'Ríos y poblados', 'Topográficos', 'Satélite', 'Proyectos'] });
              c.current.capas(() => politicas);
              mover({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 0, giro: 0, ms: 4500 });
              await pausa(1200);
              await conversar([
                { quien: 'electrum', texto: '[warmly] El mapa arranca limpio: el catastro sobre el mapa político, los dieciocho departamentos y sus municipios, con sus nombres.' },
                { quien: 'electrum', texto: 'Todo lo demás está ordenado por categorías y se enciende cuando usted lo pide: tocando la categoría en el botón de capas, o diciéndolo. «Muéstrame los ríos», «esconde la geología», «deja solo el mapa político».' },
                { quien: 'chema', texto: '[curious] ¿Así nomás, hablándole?' },
                { quien: 'electrum', texto: '[warmly] Así nomás. Y si me pregunta qué capas hay, se las listo con lo que tiene cada una.' },
              ]);
            },
          },
          yacimientos: {
            hay: yacimientos.length > 0,
            correr: async () => {
              limpiar();
              const n = yacimientos.reduce((s2, x) => s2 + ((x.geojson as any)?.features?.length || 0), 0);
              capitulo(++i, { titulo: 'Yacimientos y depósitos minerales', cifras: [{ valor: n, etiqueta: 'puntos de mineralización' }], chips: yacimientos.map((x) => x.nombre).slice(0, 4) });
              c.current.capas(() => [...politicas.filter((x) => x.rol === 'departamento'), ...yacimientos]);
              mover({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 40, giro: 12, ms: 5000 });
              await pausa(1500);
              await conversar([
                { quien: 'electrum', texto: `[thoughtful] Estos son los yacimientos, depósitos y ocurrencias minerales que tengo: ${plural(n, 'punto', 'puntos')} de varias fuentes, el servicio geológico de Estados Unidos, DEFOMIN y las fichas de ocurrencia minera de INHGEOMIN.`, al: () => orbitar(25, 22_000) },
                { quien: 'chema', texto: '[curious] ¿Y de cada punto sabe qué mineral es?' },
                { quien: 'electrum', texto: 'De la mayoría sí: oro, plata, antimonio, barita, cobre, hierro, mercurio. Toque cualquiera y le muestro su ficha. Y lo cruzo con cada concesión: una que tiene ocurrencias cerca sube en el puntaje de prospectividad.' },
              ]);
            },
          },
          referencia: {
            hay: !!(rios || caserios) && !!(cajaTerrenos || zona),
            correr: async () => {
              limpiar();
              capitulo(++i, { titulo: 'Ríos, caseríos y fallas, de cerca', chips: ['Red hídrica nacional', 'Caseríos', 'Fallas 1:50 000'] });
              const caja = cajaTerrenos || zona!.encuadre;
              mover({ accion: 'encuadrar', encuadre: caja, inclinacion: 55, giro: -15, ms: 6000 });
              await pausa(2000);
              c.current.rasters([rios, caserios, fallas50].filter((x): x is RasterEscaneado => !!x).map((x) => ({ ...x, opacidad: 0.9 })));
              await conversar([
                { quien: 'electrum', texto: '[warmly] De cerca aparece lo que importa en el campo: la red hídrica nacional completa, cada caserío con su nombre y las fallas del mapa uno a cincuenta mil.', al: () => orbitar(-20, 20_000) },
                { quien: 'tatiana', texto: '[serious] Eso es lo primero que miro yo: qué quebrada pasa por la concesión y qué comunidad queda cerca. Ahí se decide la licencia ambiental y la relación con la gente.' },
                { quien: 'electrum', texto: 'Por eso en cada ficha le digo cuántos kilómetros de río tiene dentro y qué caseríos quedan a menos de un kilómetro.' },
              ]);
            },
          },
          topografia: {
            hay: !!(hojas || hoja1620),
            correr: async () => {
              limpiar();
              const h = (hojas || hoja1620)!;
              capitulo(++i, { titulo: 'Las hojas cartográficas', chips: [h.nombre, ...(hoja1620 && hoja1620 !== h ? [hoja1620.nombre] : [])] });
              c.current.rasters([{ ...h, opacidad: 0.85 }]);
              mover({ accion: 'encuadrar', encuadre: h.encuadre, inclinacion: 35, giro: 0, ms: 5500 });
              await pausa(1500);
              await conversar([
                { quien: 'electrum', texto: '[thoughtful] Estas son las hojas topográficas del Instituto Geográfico, escaneadas y puestas en su lugar exacto sobre el terreno, con sus curvas, caminos y nombres.' },
                { quien: 'chema', texto: '[warmly] Con esto ya se puede planear un acceso o dónde va la planta sin salir de la oficina.' },
                ...(hoja1620 && hoja1620 !== h ? [{ quien: 'electrum' as const, texto: 'Y esta es la hoja de Minas de Oro en detalle, la que usamos para el proyecto.', al: () => { c.current.rasters([{ ...hoja1620, opacidad: 0.9 }]); mover({ accion: 'encuadrar', encuadre: hoja1620.encuadre, inclinacion: 45, giro: 15, ms: 5000 }); } }] : []),
              ]);
            },
          },
          proyectos: {
            hay: terrenos.length > 0 && !!cajaTerrenos,
            correr: async () => {
              limpiar();
              capitulo(++i, {
                titulo: 'Los proyectos de la casa',
                chips: terrenos.map((x) => x.nombre).slice(0, 5),
                cifras: [{ valor: terrenos.reduce((s2, x) => s2 + ((x.geojson as any)?.features?.length || 0), 0), etiqueta: 'polígonos y vetas' }, ...(docsProyectos ? [{ valor: docsProyectos, etiqueta: 'documentos de proyectos' }] : [])],
              });
              c.current.capas(() => terrenos);
              mover({ accion: 'encuadrar', encuadre: cajaTerrenos!, inclinacion: 60, giro: 20, ms: 6500 });
              await pausa(2000);
              await conversar([
                { quien: 'electrum', texto: '[warmly] Y estos son los proyectos propios: las concesiones, los terrenos y las vetas que se trazaron en el campo. No cuentan en el catastro oficial: son su información, encima de él.', al: () => orbitar(30, 26_000) },
                { quien: 'tatiana', texto: '[thoughtful] ¿Y sabe qué derechos oficiales quedan debajo de cada proyecto?' },
                { quien: 'electrum', texto: 'Sí. Los junté en carteras por proyecto, y para cada una le doy el semáforo: qué está limpio, qué pisa un área protegida o una microcuenca, y qué vence pronto.' },
                { quien: 'chema', texto: '[curious] ¿Y los informes de laboratorio de Pantaleona y El Chaparro?' },
                { quien: 'electrum', texto: '[warmly] Leídos, con sus certificados. Pregúnteme por una ley o un ensayo y le digo el valor y de qué página sale.' },
              ]);
            },
          },
          campo: {
            hay: campo.length > 0 && !!cajaCampo,
            correr: async () => {
              limpiar();
              capitulo(++i, { titulo: 'Lo que se vio en el campo', chips: campo.map((x) => x.nombre) });
              c.current.capas(() => campo);
              mover({ accion: 'encuadrar', encuadre: cajaCampo!, inclinacion: 55, giro: -25, ms: 6000 });
              await pausa(1800);
              await conversar([
                { quien: 'electrum', texto: '[warmly] Cada punto es un video o una foto de campo con su posición GPS. Los vi todos y anoté qué muestra cada uno: el afloramiento, la veta, el acceso, el río.' },
                { quien: 'tatiana', texto: '[curious] O sea, ¿puedo preguntarle qué se vio en tal lugar?' },
                { quien: 'electrum', texto: 'Exacto. Y le digo en qué video o foto está, y dónde se tomó.' },
              ]);
            },
          },
          historico: {
            // Hay algo que explicar si hay capas históricas, mapas de JICA o sus muestras.
            hay: historicasCapas.length > 0 || !!(zona && zona.mapas.length) || !!oro,
            correr: async () => {
              capitulo(++i, {
                titulo: 'Lo histórico: lo que se sabía antes',
                chips: ['Histórico · no es el catastro vigente'],
                cifras: [
                  ...(nombresHistoricos.length ? [{ valor: nombresHistoricos.length, etiqueta: 'capas históricas' }] : []),
                  ...(zona?.mapas.length ? [{ valor: zona.mapas.length, etiqueta: 'mapas JICA en la zona' }] : []),
                  ...(oro ? [{ valor: oro.total, etiqueta: 'muestras de JICA' }] : []),
                ],
              });
              c.current.tocar(null);
              c.current.rasters([]);
              c.current.muestras(null);
              c.current.prospectividad(false);
              c.current.capas(() => historicasCapas);
              mover({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 45, giro: -10, ms: 5000 });
              await pausa(1500);
              await conversar([
                {
                  quien: 'electrum',
                  texto: `[thoughtful] Antes de la geología, una aclaración importante. Lo que ve ${historicasCapas.length ? 'punteado en sepia' : 'en los mapas escaneados'} es histórico: los estudios de la agencia japonesa JICA, entre 1978 y 2003${hayCatastroViejo ? ', y el catastro de años anteriores' : ''}. No es el catastro vigente: las cifras salen solo de ${fuenteDicha}.`,
                  al: () => orbitar(20, 24_000),
                },
                { quien: 'tatiana', texto: '[curious] ¿Y entonces para qué nos sirve algo tan viejo, doctor?' },
                {
                  quien: 'electrum',
                  texto: 'Para tres cosas. Primero, dice dónde ya se encontró mineralización: JICA muestreó ríos y rocas y marcó anomalías de oro, plata y cobre. Eso ahorra años de exploración de base.',
                },
                {
                  quien: 'electrum',
                  texto: 'Segundo, cruzado con el catastro de hoy me dice qué concesiones vigentes tienen antecedentes favorables: por eso entra en el puntaje de prospectividad. Y tercero, sirve de antecedente técnico para sustentar una solicitud o presentarle un proyecto a un inversionista.',
                },
                ...(hayCatastroViejo
                  ? [{ quien: 'tatiana' as const, texto: '[thoughtful] Y el catastro viejo me sirve a mí: veo qué derechos existieron y ya no están. Un área que estuvo concesionada y quedó libre tiene historia, y conviene saberla antes de pedirla.' }]
                  : []),
                { quien: 'chema', texto: '[thoughtful] Y a mí me adelanta qué roca y qué mineral esperar, antes de pensar en planta.' },
                { quien: 'tatiana', texto: '[serious] Pero ojo con lo que NO es: no da derechos ni dice quién es dueño hoy, y una ley de oro de hace cuarenta años no es una reserva. Para un inversionista hay que muestrear de nuevo, con un estándar como NI 43-101 o JORC.' },
                { quien: 'electrum', texto: '[warmly] Exacto. Lo histórico dice dónde mirar; el catastro vigente, qué se puede pedir; y el muestreo nuevo, cuánto vale.' },
              ]);
              c.current.capas(() => []);
            },
          },
          zona: {
            hay: !!(zona && zona.mapas.length),
            correr: async () => {
              const mapas = zona!.mapas;
              capitulo(++i, {
                titulo: `La zona con más información: ${zona!.nombre}`,
                chips: ['Histórico · JICA 1978–2003'],
                cifras: [
                  { valor: mapas.length, etiqueta: 'mapas históricos' },
                  { valor: enZona.length, etiqueta: 'concesiones' },
                  { valor: enZona.reduce((s, x) => s + x.ha, 0), etiqueta: 'hectáreas' },
                ],
              });
              c.current.rasters([]);
              c.current.tocar(null);
              mover({ accion: 'encuadrar', encuadre: zona!.encuadre, inclinacion: 60, giro: 28, ms: 6500 });
              await pausa(1800);
              await conversar([
                {
                  quien: 'electrum',
                  texto: `[warmly] Ahora vamos a la zona donde más información tengo: ${zona!.nombre}. Aquí se juntan ${plural(mapas.length, 'mapa', 'mapas')} históricos de la agencia japonesa JICA, de 1978 a 2003, georreferenciados sobre el terreno real, las fallas y ${plural(enZona.length, 'concesión', 'concesiones')}.`,
                  al: () => {
                    c.current.rasters([{ ...(mapas[0] as RasterEscaneado), opacidad: 0.82 }]);
                    if (fallas) c.current.capas(() => [fallas]);
                    orbitar(-30, 30_000);
                  },
                },
                { quien: 'chema', texto: '[curious] ¿Y qué roca hay ahí, doctor? Eso me dice qué planta ocupamos.' },
                ...(mapas[1]
                  ? [{ quien: 'electrum' as const, texto: '[thoughtful] Mire el mapa estructural: las fallas y fracturas por donde subieron los fluidos que dejaron los metales.', al: () => c.current.rasters([{ ...(mapas[1] as RasterEscaneado), opacidad: 0.82 }]) }]
                  : []),
                ...(mapas[2]
                  ? [{ quien: 'electrum' as const, texto: 'Y estas son las anomalías geoquímicas que midió JICA en los ríos entre 1978 y 2003: son históricas, sirven para saber dónde mirar, no reemplazan el muestreo de hoy. Donde coinciden fallas, intrusivos y anomalías, ahí conviene explorar.', al: () => c.current.rasters([{ ...(mapas[2] as RasterEscaneado), opacidad: 0.8 }]) }]
                  : []),
                { quien: 'chema', texto: 'Si es veta de cuarzo con oro libre, gravimetría y una cianuración pequeña. Si viene amarrado en sulfuros, ya hablamos de flotación.' },
                { quien: 'tatiana', texto: '[thoughtful] Y cualquiera de las dos necesita agua y un sitio seguro para los relaves. Eso lo voy mirando desde ya.' },
              ]);
            },
          },
          analisis: {
            hay: !!(fZona?.geojson && fZona.encuadre),
            correr: async () => {
              const f = fZona!;
              capitulo(++i, {
                titulo: `Análisis completo: ${nombreParaDecir(f.nombre)}`,
                cifras: typeof f.prospectividad?.puntaje === 'number' ? [{ valor: f.prospectividad.puntaje, etiqueta: 'de 100 en prospectividad' }] : undefined,
              });
              if (zona?.mapas[0]) c.current.rasters([{ ...(zona.mapas[0] as RasterEscaneado), opacidad: 0.5 }]);
              await irConFicha(f);
              orbitar(120, 60_000);
              const frases = analisisDeFicha(f);
              // De a dos frases del doctor, con las preguntas y el oficio de los otros dos en medio.
              const bloques: string[] = [];
              for (let k = 0; k < frases.length; k += 2) bloques.push(frases.slice(k, k + 2).join(' '));
              await conversar([
                { quien: 'tatiana', texto: `[curious] Doctor, ¿qué tenemos en ${nombreParaDecir(f.nombre)}?` },
                ...(bloques[0] ? [{ quien: 'electrum' as const, texto: `[thoughtful] ${bloques[0]}` }] : []),
                ...(bloques[1] ? [{ quien: 'chema' as const, texto: '[curious] ¿Y la roca qué dice?' }, { quien: 'electrum' as const, texto: bloques[1] }] : []),
                ...bloques.slice(2).map((b) => ({ quien: 'electrum' as const, texto: b })),
                { quien: 'tatiana', texto: '[serious] Antes de mover tierra ahí, yo revisaría el agua y las comunidades del entorno: eso es lo que define la licencia ambiental.' },
                { quien: 'chema', texto: 'Y yo pediría pruebas metalúrgicas antes de hablar de planta. Sin eso, la recuperación es un supuesto.' },
                { quien: 'electrum', texto: '[warmly] Todo esto queda en su ficha: en un toque se lo entrego en PDF con su plano, o en KML para Google Earth y DXF para AutoCAD.' },
              ]);
            },
          },
          oro: {
            hay: !!oro,
            correr: async () => {
              capitulo(++i, {
                titulo: 'Geoquímica de campo',
                chips: ['Histórico · JICA 1978–2003'],
                cifras: [
                  { valor: oro!.total, etiqueta: 'muestras históricas' },
                  { valor: oro!.maxGt, etiqueta: 'g/t de oro, la más alta', d: 1 },
                  { valor: oro!.sobreUnGramo, etiqueta: 'sobre 1 g/t' },
                ],
              });
              c.current.tocar(null);
              c.current.rasters([]);
              c.current.capas(() => []);
              const [ox, oy] = oro!.centro;
              await conversar([
                {
                  quien: 'electrum',
                  texto: `[thoughtful] También tengo ${nf(oro!.total)} muestras de sedimentos y rocas que tomó JICA, con su ley de oro, plata, cobre y zinc. El calor muestra dónde se juntan las anomalías.`,
                  al: () => {
                    c.current.muestras({ elemento: 'au', geojson: muestras });
                    mover({ accion: 'camara', centro: oro!.centro, zoom: 9.8, inclinacion: 58, giro: -32, ms: 6500 });
                  },
                },
                { quien: 'chema', texto: '[surprised] ¿Y cuánto dio la mejor, doctor?' },
                {
                  quien: 'electrum',
                  texto: `${nf(oro!.maxGt, 1)} gramos por tonelada de oro. Y ${plural(oro!.sobreUnGramo, 'muestra pasa', 'muestras pasan')} de un gramo.`,
                  al: () => {
                    if (sigue()) c.current.enfocar({ encuadre: [ox - 0.06, oy - 0.05, ox + 0.06, oy + 0.05], etiqueta: `Foco de oro · hasta ${nf(oro!.maxGt, 1)} g/t` });
                    orbitar(40, 30_000);
                  },
                },
                { quien: 'chema', texto: '[laughs] Con eso ya me dan ganas de ir a tomar muestras yo mismo.' },
                { quien: 'electrum', texto: '[warmly] Toque cualquier punto y le digo qué es, cuánto dio y en qué concesión cae hoy.' },
              ]);
            },
          },
          conflictos: {
            hay: !!(fConflicto?.geojson && fConflicto.encuadre && conflicto),
            correr: async () => {
              const f = fConflicto!;
              capitulo(++i, {
                titulo: 'Dónde mirar primero',
                cifras: [
                  ...(t?.areasProtegidas ? [{ valor: t.areasProtegidas.concesiones, etiqueta: 'en áreas protegidas' }] : []),
                  ...(t?.microcuencas ? [{ valor: t.microcuencas.concesiones, etiqueta: 'en microcuencas' }] : []),
                  ...(t?.poblados ? [{ valor: t.poblados.concesiones, etiqueta: 'con caseríos dentro' }] : []),
                ],
              });
              c.current.muestras(null);
              c.current.rasters([]);
              c.current.prospectividad(false);
              if (protegidas) c.current.capas(() => [protegidas]);
              await irConFicha(f);
              orbitar(-60, 36_000);
              await conversar([
                {
                  quien: 'tatiana',
                  texto:
                    '[serious] Ahora lo que un regulador ve antes que nada: los conflictos. ' +
                    (t?.areasProtegidas ? `${plural(t.areasProtegidas.concesiones, 'concesión pisa', 'concesiones pisan')} áreas protegidas` : 'Hay concesiones sobre áreas protegidas') +
                    (t?.microcuencas ? `, ${nf(t.microcuencas.concesiones)} pisan microcuencas declaradas` : '') +
                    (t?.poblados ? ` y ${nf(t.poblados.concesiones)} tienen caseríos dentro` : '') +
                    '.',
                },
                { quien: 'electrum', texto: `[thoughtful] Esta es ${nombreParaDecir(conflicto!.concesion)}: pisa ${nf(conflicto!.ha, 1)} hectáreas de ${conflicto!.con}, el ${nf(conflicto!.pct)} por ciento de su superficie.` },
                { quien: 'chema', texto: '[concerned] Ahí no hay planta que valga si la comunidad y el agua no están de acuerdo.' },
                { quien: 'tatiana', texto: 'Por eso lo miramos primero. Esto, que antes eran semanas de escritorio, aquí lo tenemos al día en segundos, y es lo primero que va a preguntar MiAmbiente.' },
              ]);
            },
          },
          cartera: {
            hay: !!(cartera && cartera.filas.length && cRoja && fRoja?.geojson && fRoja.encuadre),
            correr: async () => {
              const k = cartera!;
              capitulo(++i, {
                titulo: `Su cartera: ${nombreParaDecir(k.cartera)}`,
                cifras: [
                  { valor: k.porNivel.verde, etiqueta: 'sin restricciones' },
                  { valor: k.porNivel.ambar, etiqueta: 'con condiciones' },
                  { valor: k.porNivel.rojo, etiqueta: 'en zona de exclusión' },
                ],
              });
              c.current.muestras(null);
              c.current.rasters([]);
              c.current.prospectividad(false);
              c.current.capas(() => [protegidas, microcuencas].filter((x): x is NonNullable<typeof x> => !!x));
              await irConFicha(fRoja!);
              orbitar(-40, 30_000);
              const motivo = cRoja!.motivos[0];
              await conversar([
                {
                  quien: 'tatiana',
                  texto: `[serious] Ahora sus zonas. De las ${nf(k.enCatastro)} de la cartera, ${plural(k.porNivel.verde, 'no tiene', 'no tienen')} ninguna restricción en las capas cargadas, ${nf(k.porNivel.ambar)} se pueden trabajar con condiciones y ${plural(k.porNivel.rojo, 'cae', 'caen')} en zona de exclusión.`,
                },
                {
                  quien: 'electrum',
                  texto: `[thoughtful] Esta es ${nombreParaDecir(cRoja!.nombre)}: ${
                    motivo
                      ? motivo.tipo === 'area_protegida'
                        ? `el ${nf(motivo.pct)} por ciento cae en el área protegida ${motivo.nombre}${motivo.zona ? `, zona de ${motivo.zona.toLowerCase()}` : ''}`
                        : motivo.tipo === 'microcuenca'
                          ? `el ${nf(motivo.pct)} por ciento cae en la microcuenca ${motivo.nombre}, que abastece de agua a una comunidad`
                          : `pisa ${motivo.nombre}`
                      : 'tiene restricciones'
                  }. La Ley General de Minería, en su artículo cuarenta y ocho, no permite derechos mineros ahí.`,
                },
                ...(cVerde
                  ? [
                      {
                        quien: 'electrum' as const,
                        texto: `[warmly] Y para empezar, la que yo priorizaría es ${nombreParaDecir(cVerde.nombre)}: ${nf(cVerde.hectareas)} hectáreas sin restricciones${cVerde.prospectividad != null ? ` y ${cVerde.prospectividad} puntos de prospectividad` : ''}.`,
                      },
                    ]
                  : []),
                { quien: 'chema', texto: '[chuckles] O sea que la plata se pone primero donde sí se puede trabajar.' },
                { quien: 'tatiana', texto: 'Exacto. Y cada ficha trae el semáforo con el decreto y el acuerdo que lo respaldan, listo para llevar al ICF y a INHGEOMIN.' },
              ]);
            },
          },
          traslapes: {
            hay: !!(t && fTraslape?.geojson && fTraslape.encuadre && traslapeMayor),
            correr: async () => {
              /*
               * Un traslape no es un pleito. La mayor parte de lo que marca el catastro es el mismo
               * derecho repetido en el padrón («Monte Redondo (Embargo)» tres veces, expediente 98) o
               * del mismo titular. Lo único a verificar es entre titulares distintos, y se cuenta así.
               */
              const tr = t!.traslapes;
              const aVerificar = tr.entreTitulares ?? { total: tr.total, hectareas: tr.hectareas };
              capitulo(++i, {
                titulo: 'Traslapes a verificar',
                cifras: [
                  { valor: aVerificar.total, etiqueta: 'entre titulares distintos' },
                  { valor: aVerificar.hectareas, etiqueta: 'hectáreas a verificar' },
                  ...(tr.mismoNombre?.total ? [{ valor: tr.mismoNombre.total, etiqueta: 'repetidos del padrón' }] : []),
                ],
              });
              c.current.capas(() => []);
              await irConFicha(fTraslape!);
              orbitar(50, 30_000);
              await conversar([
                { quien: 'electrum', texto: `[serious] Cruzo cada concesión con todas las demás. Entre titulares distintos hay ${plural(aVerificar.total, 'traslape', 'traslapes')}, ${nf(aVerificar.hectareas)} hectáreas. Ojo: eso no quiere decir que haya pleito. Es algo a verificar. En el mapa van rayados.` },
                { quien: 'tatiana', texto: '[curious] ¿Y cuál es el más grande, doctor?' },
                { quien: 'electrum', texto: `Entre ${nombreParaDecir(traslapeMayor!.a)} y ${nombreParaDecir(traslapeMayor!.b)}: ${nf(traslapeMayor!.ha, 1)} hectáreas. Puede ser un conflicto o un error de digitalización del padrón: se confirma con INHGEOMIN, y si es real se resuelve por la prelación de la solicitud.` },
                ...(tr.mismoNombre?.total
                  ? [{ quien: 'tatiana' as const, texto: `[thoughtful] Y ${nf(tr.mismoNombre.total)} cruces más son el mismo derecho repetido en el padrón oficial, con el mismo expediente o nombre${tr.mismoTitular?.total ? `, y ${nf(tr.mismoTitular.total)} son del mismo titular` : ''}. Eso no es pleito: se aclara con INHGEOMIN.` }]
                  : []),
              ]);
            },
          },
          vencimientos: {
            hay: !!catastro,
            correr: async () => {
              capitulo(++i, {
                titulo: 'Fechas que no se pueden pasar',
                cifras: [
                  { valor: venc.noventa, etiqueta: 'vencen en 90 días' },
                  { valor: venc.anio, etiqueta: 'vencen en el año' },
                  ...(venc.vencidas ? [{ valor: venc.vencidas, etiqueta: 'con la fecha ya pasada' }] : []),
                ],
              });
              c.current.tocar(null);
              c.current.capas(() => []);
              mover({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 50, giro: 10, ms: 5000 });
              await pausa(2000);
              orbitar(-20, 22_000);
              /*
               * Lo que dice sale de las fechas, sin adornar. El padrón cargado hoy trae fechas que
               * terminan en 2014: decir solo «ninguna vence este año» era cierto y engañoso a la vez.
               */
              const conFecha = venc.anio + venc.vencidas + venc.noventa;
              await conversar([{ quien: 'tatiana', texto: '[curious] ¿Y las fechas, doctor? Un plazo vencido nos puede costar la concesión.' }]);
              await decir(
                venc.anio
                  ? `Llevo las fechas de todas: ${plural(venc.anio, 'concesión vence', 'concesiones vencen')} en los próximos doce meses${venc.noventa ? `, ${nf(venc.noventa)} en los próximos noventa días` : ''}. Las que laten en el mapa son las más urgentes.`
                  : venc.vencidas
                    ? `Llevo las fechas del padrón: en los próximos doce meses no vence ninguna, pero ${plural(venc.vencidas, 'concesión tiene', 'concesiones tienen')} la fecha de vencimiento ya pasada. O están vencidas, o el padrón está desactualizado: vale la pena revisarlas con el expediente.`
                    : conFecha
                      ? 'Llevo las fechas de todas. En los próximos doce meses no vence ninguna; cuando se acerque una, late en el mapa.'
                      : 'El padrón cargado no trae fechas de vencimiento. En cuanto se carguen, llevo la cuenta y las más urgentes laten en el mapa.'
              );
              await decir('Y le aviso por Telegram antes de que se pase un plazo: la alerta le llega a usted, no hay que acordarse.');
            },
          },
          marco: {
            hay: true,
            correr: async () => {
              capitulo(++i, { titulo: 'El marco legal, a mano', chips: ['Ley 238-2012 y reformas', 'Fallo constitucional 2026', 'Formularios INHGEOMIN', 'Análisis legal por concesión'] });
              c.current.tocar(null);
              await conversar([
                { quien: 'electrum', texto: '[thoughtful] Tengo leídos los documentos legales: las reformas del Decreto 109-2019 a la Ley General de Minería y los formularios de INHGEOMIN, de exploración, explotación, beneficio, comercialización y declaración jurada.' },
                { quien: 'chema', texto: '[curious] ¿Y está al día, doctor? Que la ley ha cambiado.' },
                { quien: 'electrum', texto: '[serious] Al día. El Decreto 18-2024 prohibió concesiones en áreas protegidas y zonas de agua declaradas, y en junio de 2026 la Sala de lo Constitucional anuló en parte siete artículos, entre ellos los de plazos y consulta. Cuando le cito algo, le digo la fecha y la fuente.' },
                { quien: 'tatiana', texto: 'Y lo ambiental lo llevo yo: la licencia de MiAmbiente, la constancia del ICF sobre áreas protegidas y los plazos de cada trámite.' },
                { quien: 'electrum', texto: '[warmly] Pregúntenos qué pide un trámite o qué dice un artículo y le contestamos citando el documento. En cada ficha, «Analizar» le hace el análisis legal y ambiental completo.' },
              ]);
            },
          },
          barra: {
            hay: true,
            correr: () =>
              senalar('[data-tour="barra-mapa"]', 'Arriba del mapa', [
                'Arriba del mapa: el Tablero, con las cifras de todo el país y sus conflictos; el 3D, para ver el terreno real; y este Recorrido.',
              ]),
          },
          capasBoton: {
            hay: true,
            correr: () =>
              senalar('[data-tour="capas"]', 'Capas', [
                'Aquí enciende capas: geología, fallas, áreas protegidas, microcuencas, los mapas históricos de JICA, las muestras y el satélite. Cada una con su leyenda y su transparencia.',
              ]),
          },
          herramientasMapa: {
            hay: true,
            correr: () =>
              senalar('[data-tour="herramientas"]', 'Herramientas del mapa', [
                'Estas son las herramientas del mapa: medir distancias y áreas, el perfil topográfico, pedir un área nueva dibujándola, comparar con el satélite y la órbita de trescientos sesenta grados.',
              ]),
          },
          fichaBotones: {
            hay: !!fDemo,
            correr: async () => {
              capitulo(++i, { titulo: 'La ficha de cada concesión' });
              await irConFicha(fDemo!, true);
              await esperarControl('[data-tour="ficha"]');
              setFoco('[data-tour="ficha"]');
              await decir('Toque cualquier concesión y se abre su ficha: catastro, prospectividad, entorno, geología y satélite.');
              const botones: Array<[string, string]> = [
                ['[data-tour="btn-pdf"]', 'Ficha PDF le arma el informe completo de la concesión, con su plano, listo para mandar.'],
                ['[data-tour="btn-analizar"]', 'Analizar me pide el análisis legal, ambiental y geológico de esa concesión, con mi recomendación.'],
                ['[data-tour="exportes"]', 'Y aquí la baja en KML para Google Earth, DXF para AutoCAD, GeoJSON o los vértices en CSV.'],
              ];
              for (const [sel, frase] of botones) {
                if (!sigue() || saltoEste()) break;
                if (!(await esperarControl(sel, 1200))) continue;
                setFoco(sel);
                await decir(frase);
              }
              setFoco(null);
            },
          },
          geologicoVivo: {
            hay: !!fDemo,
            correr: async () => {
              const f = fDemo!;
              capitulo(++i, { titulo: 'Mapas geológicos al instante', chips: ['Litológico', 'Estructural', 'Geotectónico'] });
              if (!ficha$.current) await irConFicha(f, true);
              const boton = await esperarControl('[data-tour="btn-geologicos"]');
              if (boton) setFoco('[data-tour="btn-geologicos"]');
              // Se pide ya, y mientras se dibuja se explica: nunca un silencio esperando.
              const pedido = fetch('/api/electrum/mapa-geologico', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headersElectrum() },
                body: JSON.stringify({ concesion_id: f.id, tipo: 'litologico' }),
              })
                .then(async (r) => (r.ok ? ((await r.json()) as { url: string; nombre: string; titulo: string }) : null))
                .catch(() => null);
              await decir(`Con este botón le dibujo los mapas geológicos de la concesión: el litológico, el estructural con la roseta de rumbos y el geotectónico. Le dibujo el litológico de ${nombreParaDecir(f.nombre)} ahora mismo.`);
              const mapa = await pedido;
              setFoco(null);
              if (mapa && sigue() && !saltoEste()) {
                c.current.visor({ tipo: 'imagen', nombre: mapa.nombre, url: mapa.url, titulo: mapa.titulo });
                await decir('Aquí está. Las rocas por clase, los intrusivos, las fallas y los yacimientos cercanos, con la concesión marcada. Se abre a pantalla completa y se le puede hacer zoom.');
                await pausa(2500);
                c.current.visor(null);
              } else if (sigue()) {
                await decir('Ese mapa se lo dibujo cuando lo pida desde la ficha o con la voz: «hazme el mapa geológico de esta concesión».');
              }
            },
          },
          timelapse: {
            hay: !!fDemo?.geojson,
            correr: async () => {
              const f = fDemo!;
              capitulo(++i, { titulo: 'El satélite, año por año' });
              if (!ficha$.current) await irConFicha(f, true);
              const boton = await esperarControl('[data-tour="btn-timelapse"]');
              if (!boton) {
                await decir('Desde la ficha también se ve el timelapse del satélite: un cuadro por año, para ver cómo cambió el terreno.');
                return;
              }
              setFoco('[data-tour="btn-timelapse"]');
              await decir('Y el timelapse satelital: le junto una imagen de Sentinel-2 por cada temporada seca, con el lindero encima.');
              setFoco(null);
              if (!sigue() || saltoEste()) return;
              boton.click();
              await conversar([
                { quien: 'tatiana', texto: '[thoughtful] Aquí es donde yo me fijo. Año por año se ve si entró maquinaria, si abrieron un camino o si el bosque se perdió.' },
                { quien: 'chema', texto: '[curious] ¿Y se nota si ya están sacando material?' },
                { quien: 'tatiana', texto: 'Se nota el suelo desnudo que crece y los caminos nuevos. Si lo vemos a tiempo, se corrige antes de que sea una multa.' },
              ]);
              await pausa(2500);
              // Se cierra como lo cerraría una persona: con Escape.
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await pausa(400);
            },
          },
          manos: {
            hay: true,
            correr: async () => {
              capitulo(++i, { titulo: 'Manos libres', chips: ['«Siguiente»', '«Acércate»', '«Más mapa»', '«Cierra la ventana»', 'Air touch'] });
              c.current.tocar(null);
              if (document.querySelector('[data-tour="microfono"]')) setFoco('[data-tour="microfono"]');
              await decir('No hace falta tocar nada. Tengo el micrófono abierto: pregúnteme en voz alta, o dígame «siguiente», «acércate», «aléjate», «más mapa» o «cierra la ventana».');
              if (document.querySelector('[data-tour="manos"]')) setFoco('[data-tour="manos"]');
              await decir('Y con Air touch me maneja con la mano frente a la cámara: el cursor sigue su mano, pellizca para tocar, pellizca y arrastra para mover el mapa, dos manos para el zoom y el puño cierra la ventana.');
              setFoco(null);
            },
          },
          mapaVoz: {
            hay: true,
            correr: async () => {
              capitulo(++i, { titulo: 'El mapa, con palabras', chips: ['«Llévame a Juticalpa»', '«Solo las de oro»', '«Quita el filtro»'] });
              c.current.tocar(null);
              await decir('Al mapa también se le habla. Si me dice «llévame a Juticalpa», lo llevo y se lo dejo marcado.');
              try {
                const r = await fetch('/api/electrum/lugar?q=Juticalpa', { headers: headersElectrum() });
                const j: any = r.ok ? await r.json() : null;
                if (j?.ok && j.lugar && sigue()) {
                  c.current.orden({ accion: 'lugar', centro: j.lugar.centro, zoom: 11, nombre: j.lugar.nombre, detalle: [j.lugar.tipo, j.lugar.departamento].filter(Boolean).join(' · ') });
                  await espera(2600);
                }
              } catch {
                /* sin lugar: se sigue contando */
              }
              if (!sigue()) return;
              c.current.orden({ accion: 'filtrar', mineral: 'oro' });
              await decir('Y si me dice «muéstrame solo las de oro», dejo en el mapa las concesiones que tienen un yacimiento de oro registrado dentro o muy cerca. Lo mismo con plata, cobre, antimonio o las no metálicas.');
              c.current.orden({ accion: 'filtrar', mineral: null });
            },
          },
          mesa: {
            hay: true,
            correr: async () => {
              capitulo(++i, { titulo: 'La mesa de trabajo', chips: ['Don Chema · metalurgista', 'Ing. Tatiana · civil y ambiental', '«Mesa técnica»'] });
              c.current.tocar(null);
              if (document.querySelector('[data-tour="mesa"]')) setFoco('[data-tour="mesa"]');
              const lineas = [
                { quien: 'electrum', nombre: 'Dr Electrum', texto: '[warmly] Y no trabajo solo. Le presento a mi equipo.' },
                { quien: 'chema', nombre: 'Don Chema', texto: '[warmly] Buenas, soy Don Chema, metalurgista. Usted me dice qué mineral tiene y yo le digo qué planta ocupa: chancado, molienda, flotación o lixiviación, y cuántas toneladas al día aguanta.' },
                { quien: 'tatiana', nombre: 'Ing. Tatiana', texto: '[confident] Y yo soy la ingeniera Tatiana. Lo que Don Chema diseña, yo lo construyo: la obra, la presa de relaves, el agua, y los permisos ambientales.' },
                { quien: 'electrum', nombre: 'Dr Electrum', texto: '[thoughtful] Pregúntele a cualquiera por su nombre, o toque «Mesa» y lo discutimos entre los tres hasta llegar a una recomendación.' },
                { quien: 'chema', nombre: 'Don Chema', texto: '[chuckles] Como decimos en Olancho: tres cabezas piensan más que una.' },
              ];
              await conversar(lineas.map(({ quien, texto }) => ({ quien: quien as 'electrum' | 'tatiana' | 'chema', texto })));
              setFoco(null);
            },
          },
          chat: {
            hay: true,
            correr: () =>
              senalar('[data-tour="chat"]', 'Pregúnteme', ['Aquí me escribe con palabras normales, o simplemente me habla: le contesto con la voz, y mientras busco le voy diciendo qué estoy haciendo.']),
          },
          pestanas: {
            hay: true,
            correr: () =>
              senalar('[data-tour="pestanas"]', 'Expedientes e infraestructura', [
                'En Expedientes sube documentos y los busca por su contenido; en Infraestructura ve todo lo que sé y de dónde sale cada dato.',
              ]),
          },
          reparto: {
            hay: true,
            correr: () =>
              senalar('[data-tour="reparto"]', 'Más mapa o más chat', ['Y con estos botones reparte la pantalla: más mapa, mitad y mitad, o más conversación.']),
          },
          cierre: {
            hay: true,
            correr: async () => {
              capitulo(++i, { titulo: 'Pregúnteme lo que quiera', chips: CAPACIDADES });
              limpiar();
              c.current.prospectividad(modo !== 'legal');
              mover({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 55, giro: 16, ms: 6000 });
              await pausa(2400);
              orbitar(-24, 24_000);
              await decir(
                modo === 'herramientas'
                  ? 'Eso es todo lo que tiene a mano. Y si no encuentra un botón, pídamelo con palabras: yo lo hago.'
                  : 'Todo esto me lo pide cualquiera de su equipo con palabras normales o con la voz: desde la web, la aplicación del teléfono o Telegram.'
              );
              if (modo !== 'herramientas') await decir('Le armo la ficha en PDF, el plano profesional, el perfil del terreno, los archivos para Google Earth y AutoCAD, y le aviso cuando algo cambia.');
              /*
               * Dos voces: la ingeniera Tatiana entra a la conversación (Eleven v4, diálogo a varias
               * voces). Es lo mismo que hace el botón «Como conversación» con cualquier respuesta.
               */
              // El cierre lo hace la mesa entera: cada uno dice qué le toca y se despiden invitando a preguntar.
              await conversar([
                { quien: 'tatiana', texto: '[curious] Doctor, ¿y si alguien prefiere que se lo expliquemos conversando, como ahora?' },
                { quien: 'electrum', texto: '[warmly] Para eso están ustedes. [chuckles] Toquen «Mesa» arriba y cada pregunta la discutimos los tres, o pídanle a cualquiera por su nombre.' },
                { quien: 'chema', texto: '[warmly] Usted me dice el mineral y yo le armo la planta.' },
                { quien: 'tatiana', texto: 'Y yo le digo cómo se construye, cuánto cuesta y qué permisos ocupa.' },
                { quien: 'electrum', texto: '[warmly] Y yo le pongo la geología y los números en orden. Estamos a sus órdenes: pregúntenos lo que quiera.' },
              ]);
            },
          },
        };

        const ORDEN: Record<ModoRecorrido, string[]> = {
          // El completo lo cuenta todo: la geología, lo legal y las herramientas, en ese orden.
          // Primero qué hay (lo leído y el mapa por capas), después la geología y los proyectos, lo
          // legal y al final las herramientas.
          completo: ['intro', 'biblioteca', 'politico', 'potencial', 'yacimientos', 'satelite', 'historico', 'zona', 'analisis', 'oro', 'referencia', 'topografia', 'proyectos', 'campo', 'conflictos', 'cartera', 'traslapes', 'vencimientos', 'marco', 'fichaBotones', 'geologicoVivo', 'timelapse', 'mapaVoz', 'mesa', 'manos', 'cierre'],
          geologico: ['intro', 'yacimientos', 'historico', 'zona', 'analisis', 'oro', 'alteracion', 'topografia', 'geologicoVivo', 'mesa', 'cierre'],
          legal: ['intro', 'conflictos', 'cartera', 'traslapes', 'vencimientos', 'marco', 'mesa', 'cierre'],
          herramientas: ['barra', 'capasBoton', 'herramientasMapa', 'fichaBotones', 'geologicoVivo', 'timelapse', 'mapaVoz', 'chat', 'mesa', 'manos', 'pestanas', 'reparto', 'cierre'],
        };
        const lista = ORDEN[modo].filter((k) => C[k].hay);
        setTotal(lista.length);
        for (const k of lista) {
          if (!sigue()) return;
          await C[k].correr();
        }
        natural = sigue();
      } catch (e: any) {
        if (sigue()) setTexto(`No pude seguir el recorrido: ${String(e?.message || e)}`);
        await espera(3500);
      } finally {
        fijarRecorrido(false);
        if (sigue()) {
          // Todo vuelve a como estaba, menos el 3D y la cámara: quien lo vio sigue desde ahí.
          c.current.rasters(antes.rasters);
          c.current.muestras(antes.muestras);
          c.current.capas(() => antes.extras);
          c.current.prospectividad(antes.prospectividad);
          c.current.fondo(antes.fondo);
          c.current.alto(antes.alto);
          c.current.tocar(null);
          c.current.enfocar(null);
          c.current.visor(null);
          c.current.cara('IDLE');
          setFoco(null);
          // Sin el cuadro, el mapa vuelve a encuadrar en toda la pantalla.
          c.current.orden({ accion: 'orbitar', grados: 0, ms: 900, margen: SIN_MARGEN });
          setTexto('');
          // Ya quedó todo restaurado: que la limpieza del efecto no lo repita (eran dos órbitas seguidas).
          restaurado.current = true;
          onTerminar(natural);
        }
      }
    })();

    restaurado.current = false;
    return () => {
      vivo.current++;
      callar();
      despertar.current?.();
      setTitular(null);
      if (restaurado.current) return;
      // Detenido a mitad: también se deshace lo que el recorrido encendió.
      const c0 = c.current;
      c0.enfocar(null);
      c0.visor(null);
      c0.rasters(antes.rasters);
      c0.muestras(antes.muestras);
      c0.capas(() => antes.extras);
      c0.prospectividad(antes.prospectividad);
      c0.fondo(antes.fondo);
      c0.alto(antes.alto);
      c0.cara('IDLE');
      setFoco(null);
      // La ficha que abrió el recorrido se cierra con él (al empezar ya se había cerrado la que hubiera).
      c0.tocar(null);
      c0.orden({ accion: 'orbitar', grados: 0, ms: 900, margen: SIN_MARGEN });
    };
  }, [activo, onTerminar, modo]);

  /* ---------------------------------------------------------------- arrastrar */
  const arrastre = useRef<{ dx: number; dy: number } | null>(null);
  const empezar = (e: EventoPuntero<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = caja.current?.getBoundingClientRect();
    const padre = caja.current?.offsetParent?.getBoundingClientRect();
    if (!r || !padre) return;
    arrastre.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const mover = (e: EventoPuntero<HTMLDivElement>) => {
    if (!arrastre.current || !caja.current) return;
    const padre = caja.current.offsetParent?.getBoundingClientRect();
    if (!padre) return;
    const w = caja.current.offsetWidth;
    const h = caja.current.offsetHeight;
    setPos({
      x: Math.max(4, Math.min(padre.width - w - 4, e.clientX - padre.left - arrastre.current.dx)),
      y: Math.max(4, Math.min(padre.height - h - 4, e.clientY - padre.top - arrastre.current.dy)),
    });
  };
  const soltar = () => (arrastre.current = null);

  if (!activo) return null;
  const detener = () => {
    vivo.current++;
    callar();
    despertar.current?.();
    setTexto('');
    onTerminar(false);
  };

  /*
   * Dónde va: arrastrado, donde lo dejaron. Si no, abajo: en el teléfono de lado a lado (arriba
   * vive la cara) y en la computadora al centro, corrido a la izquierda cuando la ficha ocupa la derecha.
   */
  const lugar = pos
    ? { left: pos.x, top: pos.y }
    : undefined;
  const clasesLugar = pos
    ? ''
    : `left-2 right-2 bottom-2 md:bottom-3 md:right-auto md:left-1/2 md:-translate-x-1/2 ${fichaAbierta ? 'md:left-[calc(50%-212px)]' : ''}`;

  return (
    <>
    <Cine titular={titular} />
    {foco && <Foco selector={foco} />}
    <div
      ref={caja}
      style={lugar}
      className={`absolute ${foco ? 'z-[75]' : 'z-[30]'} md:w-[min(460px,calc(100%-460px))] ${pos ? 'w-[min(460px,calc(100%-16px))]' : ''} ${clasesLugar}`}
      role="region"
      aria-label="Recorrido guiado"
    >
      {chico ? (
        <button
          type="button"
          onClick={() => setChico(false)}
          className="flex w-full items-center gap-2 rounded-full border border-[#FFAE3B]/35 bg-black/80 px-3 py-1.5 text-left shadow-lg backdrop-blur-xl cursor-pointer"
          title="Abrir el cuadro del recorrido"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ background: AMBAR }} />
          <span className="truncate font-mono text-[10.5px] tracking-[0.12em] uppercase" style={{ color: AMBAR }}>
            {n > 0 ? `${n}/${total} · ` : ''}
            {cap.titulo}
          </span>
        </button>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#FFAE3B]/30 bg-black/82 shadow-[0_12px_40px_rgba(0,0,0,.6)] backdrop-blur-xl">
          {/* La barra de arriba es el asa: de ahí se arrastra. Doble toque, vuelve a su sitio. */}
          <div
            className="flex cursor-grab items-center gap-2 px-3.5 pt-2.5 active:cursor-grabbing touch-none select-none"
            onPointerDown={empezar}
            onPointerMove={mover}
            onPointerUp={soltar}
            onPointerCancel={soltar}
            onDoubleClick={() => setPos(null)}
            title="Arrastrá para moverlo · doble clic para devolverlo a su sitio"
          >
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ background: AMBAR }} />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: AMBAR }}>
              {n > 0 ? `Capítulo ${n} de ${total} · ` : ''}
              {cap.titulo}
            </span>
            <button type="button" onClick={alternarPantallaCompleta} className="shrink-0 rounded-md px-1.5 text-[13px] leading-none text-[#9FB0B8] hover:text-white cursor-pointer" aria-label="Pantalla completa" title="Pantalla completa">
              ⛶
            </button>
            <button type="button" onClick={saltar} disabled={n === 0} className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase text-[#DCE5EA] hover:border-white/35 disabled:opacity-40 cursor-pointer" title="Pasar al capítulo siguiente">
              Siguiente ▸
            </button>
            <button type="button" onClick={() => setChico(true)} className="shrink-0 rounded-md px-1.5 text-[14px] leading-none text-[#9FB0B8] hover:text-white cursor-pointer" aria-label="Achicar el cuadro" title="Achicar">
              –
            </button>
            <button type="button" onClick={detener} className="shrink-0 rounded-md px-1.5 text-[13px] leading-none text-[#9FB0B8] hover:text-white cursor-pointer" aria-label="Detener el recorrido" title="Detener">
              ■
            </button>
          </div>
          {/* El avance: un segmento por capítulo. */}
          <div className="mt-2 flex gap-1 px-3.5">
            {Array.from({ length: total }, (_, k) => (
              <span key={k} className="h-[3px] flex-1 rounded-full transition-colors duration-500" style={{ background: k < n ? AMBAR : 'rgba(255,255,255,.14)' }} />
            ))}
          </div>
          {cap.cifras?.length ? (
            <div className="mt-2.5 grid gap-2 px-3.5" style={{ gridTemplateColumns: `repeat(${Math.min(4, cap.cifras.length)}, minmax(0,1fr))` }}>
              {cap.cifras.map((x) => (
                <div key={`${n}-${x.etiqueta}`} className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5">
                  <div className="font-display text-[15px] font-bold leading-tight tabular-nums md:text-[17px]" style={{ color: '#F3F6F8' }}>
                    <Contador valor={x.valor} d={x.d} />
                  </div>
                  <div className="text-[10.5px] leading-tight text-[#8FA3B0]">{x.etiqueta}</div>
                </div>
              ))}
            </div>
          ) : null}
          {cap.chips?.length ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5 px-3.5">
              {cap.chips.map((x) => (
                <span key={`${n}-${x}`} className="rounded-full border border-[#FFAE3B]/30 bg-[#FFAE3B]/[0.07] px-2 py-0.5 text-[11px] text-[#FFD08A]">
                  {x}
                </span>
              ))}
            </div>
          ) : null}
          <p className="px-3.5 pb-3 pt-2 text-[13px] leading-snug text-[#F3F6F8] md:text-[14.5px] md:leading-relaxed" aria-live="polite">
            {texto}
          </p>
        </div>
      )}
    </div>
    </>
  );
}

/**
 * EL ANILLO: señala un control de la pantalla mientras Dr Electrum lo explica. Sigue al elemento
 * cuadro a cuadro (se mueve si el panel cambia de alto) y oscurece el resto sin bloquear nada.
 */
function Foco({ selector }: { selector: string }) {
  const [r, setR] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    let vivo = true;
    let antes = '';
    const paso = () => {
      if (!vivo) return;
      const el = document.querySelector(selector) as HTMLElement | null;
      const b = el?.getBoundingClientRect();
      const nuevo = b && b.width > 0 ? { x: b.left - 6, y: b.top - 6, w: b.width + 12, h: b.height + 12 } : null;
      const k = JSON.stringify(nuevo);
      if (k !== antes) {
        antes = k;
        setR(nuevo);
      }
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
    return () => {
      vivo = false;
    };
  }, [selector]);
  if (!r) return null;
  return (
    <div
      aria-hidden
      data-foco="" className="pointer-events-none fixed z-[70] rounded-xl transition-all duration-300"
      style={{
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        border: `2px solid ${AMBAR}`,
        // El oscurecido es quieto: animar una sombra de 9999 px repintaba la pantalla entera por cuadro.
        boxShadow: `0 0 0 9999px rgba(0,0,0,.42), 0 0 22px 4px ${AMBAR}88`,
      }}
    >
      {/* Lo que late es solo un borde encima del anillo: barato de dibujar. */}
      <span className="absolute -inset-[3px] rounded-[14px] border-2" style={{ borderColor: AMBAR, animation: 'electrum-foco 1.6s ease-in-out infinite' }} />
      <style>{'@keyframes electrum-foco{0%,100%{opacity:.15;transform:scale(1)}50%{opacity:.9;transform:scale(1.015)}}'}</style>
    </div>
  );
}

/*
 * LO CINEMATOGRÁFICO: barras de cine arriba y abajo mientras dura el recorrido, y el título de cada
 * capítulo que aparece grande al centro unos segundos y se desvanece. No tapan nada que se toque
 * (pointer-events: none) y las barras van justo encima del mapa pero debajo de todos sus controles:
 * en el recorrido de herramientas se señalan esos botones, y una barra encima los tapaba.
 */
function Cine({ titular }: { titular: { n: number; titulo: string; clave: number } | null }) {
  const [visible, setVisible] = useState<typeof titular>(null);
  useEffect(() => {
    if (!titular) return setVisible(null);
    setVisible(titular);
    const t = setTimeout(() => setVisible((v) => (v?.clave === titular.clave ? null : v)), 2600);
    return () => clearTimeout(t);
  }, [titular]);
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[1] bg-black" style={{ height: 'min(6vh, 46px)', animation: 'electrum-barra-arriba .9s ease-out both' }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] bg-black" style={{ height: 'min(6vh, 46px)', animation: 'electrum-barra-abajo .9s ease-out both' }} />
      {visible && (
        <div key={visible.clave} aria-hidden className="pointer-events-none fixed inset-x-0 top-[26%] z-[31] flex flex-col items-center px-6 text-center" style={{ animation: 'electrum-titular 2.6s ease-in-out both' }}>
          <span className="font-mono text-[11px] tracking-[0.4em] text-[#FFAE3B]/80 md:text-[12px]">{String(visible.n).padStart(2, '0')}</span>
          <span className="mt-1 font-display text-[26px] font-bold leading-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,.9)] md:text-[40px]">{visible.titulo}</span>
          <span className="mt-2 h-px w-24 bg-gradient-to-r from-transparent via-[#FFAE3B] to-transparent" />
        </div>
      )}
      <style>{`@keyframes electrum-barra-arriba{from{transform:translateY(-100%)}to{transform:none}}@keyframes electrum-barra-abajo{from{transform:translateY(100%)}to{transform:none}}@keyframes electrum-titular{0%{opacity:0;transform:translateY(10px) scale(.98);filter:blur(4px)}18%{opacity:1;transform:none;filter:none}78%{opacity:1}100%{opacity:0;transform:translateY(-6px)}}`}</style>
    </>
  );
}

/** Si el recorrido puso la pantalla completa (para quitarla al terminar, y solo en ese caso). */
let entramosAPantallaCompleta = false;

export function entrarPantallaCompleta() {
  try {
    if (document.fullscreenElement || !document.fullscreenEnabled) return;
    const p = document.documentElement.requestFullscreen?.();
    entramosAPantallaCompleta = true;
    p?.catch(() => {
      entramosAPantallaCompleta = false;
    });
  } catch {
    /* el navegador no deja: se sigue en la ventana */
  }
}

/** Sale de la pantalla completa solo si la puso el recorrido: si ya estaba así, se respeta. */
export function salirPantallaCompleta() {
  try {
    if (entramosAPantallaCompleta && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  } catch {
    /* nada que hacer */
  }
  entramosAPantallaCompleta = false;
}

function alternarPantallaCompleta() {
  try {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      entramosAPantallaCompleta = false;
    } else entrarPantallaCompleta();
  } catch {
    /* sin pantalla completa en este navegador */
  }
}

/**
 * Para arrancarlo desde un toque: desbloquea el audio y pone la pantalla completa en ese mismo
 * gesto (los navegadores solo dejan hacer las dos cosas dentro de un toque).
 */
export function prepararRecorrido() {
  desbloquear();
  entrarPantallaCompleta();
}
