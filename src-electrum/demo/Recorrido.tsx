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
import { callar, desbloquear, hablar } from '../panel/voz';
import type { CapaExtra, Fondo, Margen, OrdenMapa, RasterEncendido, RasterEscaneado, Tocado } from '../mapa/captura';
import { catastroGuardado } from '../mapa/captura';
import type { MuestrasEncendidas } from '../mapa/CapasControl';
import { Contador, pedirTablero, type DatosTablero } from '../mapa/Tablero';
import { analisisDeFicha, centroDe, concesionesEn, focoDeOro, fold, nombreParaDecir, vencimientos, zonaMasRica, type Ficha } from './guion';
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

const ficha = (id: number) => json<Ficha & { encuadre: [number, number, number, number] | null }>(`/api/electrum/mapa/concesion/${id}`).catch(() => null);
const capa = (c: { id: number; nombre: string } | undefined) =>
  c ? json<{ rol: any; geojson: any }>(`/api/electrum/mapa/capa/${c.id}`).then((r) => ({ id: c.id, nombre: c.nombre, rol: r.rol, geojson: r.geojson }) as CapaExtra).catch(() => null) : Promise.resolve(null);

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
    /** Toda orden de cámara del recorrido lleva el margen de ese momento. */
    const mover = (o: OrdenMapa) => c.current.orden(o.accion === 'volar' || o.accion === 'camara' || o.accion === 'encuadrar' || o.accion === 'orbitar' ? ({ ...o, margen: margen$.current() } as OrdenMapa) : o);
    const orbitar = (grados: number, ms: number) => mover({ accion: 'orbitar', grados, ms });

    let natural = false;
    (async () => {
      try {
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
            ? json<{ capas: Array<{ id: number; nombre: string; rol: string }> }>('/api/electrum/mapa/capas').then((j) => j.capas || []).catch(() => [])
            : Promise.resolve([] as Array<{ id: number; nombre: string; rol: string }>),
          completo
            ? json<{ lista: Array<{ id: number; nombre: string; ha: number }> }>('/api/electrum/satelite/mayores').then((j) => j.lista || []).catch(() => [])
            : Promise.resolve([] as Array<{ id: number; nombre: string; ha: number }>),
          completo || modo === 'herramientas'
            ? json<{ ranking: Array<{ id: number; nombre: string; puntaje: number }> }>('/api/electrum/prospectividad').then((j) => j.ranking || []).catch(() => [])
            : Promise.resolve([] as Array<{ id: number; nombre: string; puntaje: number }>),
          completo || modo === 'geologico' ? json<any>('/api/electrum/mapa/muestras').catch(() => null) : Promise.resolve(null),
        ]);
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
        const [fTraslape, fProspecta] = await Promise.all([
          (modo === 'legal' || completo) && traslapeMayor ? ficha(traslapeMayor.aId) : Promise.resolve(null),
          modo === 'herramientas' && (enZona[0] || ranking[0]) ? ficha((enZona[0] || ranking[0]).id) : Promise.resolve(null),
        ]);
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
                      { valor: t.traslapes.total, etiqueta: 'traslapes' },
                      ...(t.poblados ? [{ valor: t.poblados.caserios, etiqueta: 'caseríos dentro' }] : []),
                    ]
                  : undefined,
              });
              mover({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 58, giro: -24, ms: 5000 });
              await pausa(1800);
              orbitar(26, 26_000);
              if (modo === 'legal') {
                await decir(`Le muestro el catastro como lo mira un abogado o un regulador: ${t ? `${plural(t.total.concesiones, 'concesión', 'concesiones')}, ` : ''}cada una cruzada con las áreas protegidas, el agua, las comunidades, los demás derechos y sus fechas.`);
              } else if (modo === 'geologico') {
                await decir('Le muestro la geología: los mapas de JICA escaneados sobre el terreno real, las fallas, la geoquímica de campo y lo que ve el satélite, todo cruzado con las concesiones.');
              } else {
                await decir('Buenas. Soy Dr Electrum, la plataforma de inteligencia minera de Orden Global. Esto es Honduras, con su relieve real, en tres dimensiones.');
                await decir(
                  t
                    ? `Encima tengo el catastro minero nacional completo: ${plural(t.total.concesiones, 'concesión', 'concesiones')} y ${nf(t.total.hectareas)} hectáreas, y cada una cruzada con la geología, el satélite, las áreas protegidas, el agua y las comunidades.`
                    : 'Encima tengo el catastro minero nacional completo, y cada concesión cruzada con la geología, el satélite, las áreas protegidas, el agua y las comunidades.'
                );
              }
            },
          },
          potencial: {
            hay: true,
            correr: async () => {
              capitulo(++i, { titulo: 'El potencial de cada concesión', chips: ranking.slice(0, 3).map((r) => `${nombreParaDecir(r.nombre)} · ${r.puntaje}`) });
              c.current.prospectividad(true);
              mover({ accion: 'camara', centro: [-86.6, 14.6], zoom: 7.4, inclinacion: 62, giro: 12, ms: 5000 });
              await pausa(1500);
              orbitar(-22, 22_000);
              await decir(
                'Así se ve el país con los ojos de un inversionista. A cada concesión le calculo un puntaje de prospectividad de cero a cien, con la geología, la geoquímica de JICA y el satélite. En rojo, las más prometedoras.' +
                  (ranking.length >= 3 ? ` Hoy las primeras son ${nombreParaDecir(ranking[0].nombre)}, ${nombreParaDecir(ranking[1].nombre)} y ${nombreParaDecir(ranking[2].nombre)}.` : '')
              );
              await decir('Y las que laten son alertas: concesiones que vencen pronto o que perdieron vegetación. Nadie tiene que acordarse: yo aviso.');
            },
          },
          satelite: {
            hay: !!(fPerdida?.geojson && fPerdida.encuadre && s2('s2-veg')),
            correr: async () => {
              c.current.prospectividad(false);
              capitulo(++i, { titulo: 'Lo que ve el satélite', cifras: [{ valor: perdidas[0].ha, etiqueta: 'ha de vegetación perdida', d: 1 }] });
              c.current.rasters([{ ...s2('s2-veg')!, opacidad: 0.85 }]);
              mover({ accion: 'volar', geojson: fPerdida!.geojson, encuadre: fPerdida!.encuadre! });
              await pausa(3200);
              orbitar(40, 24_000);
              await decir(
                `Cada año comparo las imágenes del satélite europeo Sentinel-2 de la temporada seca. Esta es ${nombreParaDecir(fPerdida!.nombre)}: perdió ${nf(perdidas[0].ha, 1)} hectáreas de vegetación de un año al otro. Puede ser un tajo, un camino o una quema; yo lo detecto y lo marco para confirmarlo en campo.`
              );
              if (s2('s2-arc')) {
                c.current.rasters([{ ...s2('s2-arc')!, opacidad: 0.85 }]);
                await decir('Con las mismas imágenes busco alteración hidrotermal: arcillas y óxidos de hierro, la huella que dejan los fluidos que traen el oro y el cobre.');
              }
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
          zona: {
            hay: !!(zona && zona.mapas.length),
            correr: async () => {
              const mapas = zona!.mapas;
              capitulo(++i, {
                titulo: `La zona con más información: ${zona!.nombre}`,
                cifras: [
                  { valor: mapas.length, etiqueta: 'mapas de JICA' },
                  { valor: enZona.length, etiqueta: 'concesiones' },
                  { valor: enZona.reduce((s, x) => s + x.ha, 0), etiqueta: 'hectáreas' },
                ],
              });
              c.current.rasters([]);
              c.current.tocar(null);
              mover({ accion: 'encuadrar', encuadre: zona!.encuadre, inclinacion: 60, giro: 28, ms: 6500 });
              await pausa(2600);
              c.current.rasters([{ ...(mapas[0] as RasterEscaneado), opacidad: 0.82 }]);
              if (fallas) c.current.capas(() => [fallas]);
              orbitar(-30, 30_000);
              await decir(
                `Ahora vamos a la zona de Honduras donde más información tengo: ${zona!.nombre}. Aquí se juntan ${plural(mapas.length, 'mapa', 'mapas')} de la agencia japonesa JICA, que escaneé y georreferencié sobre el terreno real, las fallas, el satélite y ${plural(enZona.length, 'concesión', 'concesiones')}.`
              );
              if (mapas[1]) {
                c.current.rasters([{ ...(mapas[1] as RasterEscaneado), opacidad: 0.82 }]);
                await decir('Este es el mapa estructural: las fallas y fracturas por donde subieron los fluidos que dejaron los metales.');
              }
              if (mapas[2]) {
                c.current.rasters([{ ...(mapas[2] as RasterEscaneado), opacidad: 0.8 }]);
                await decir('Y estas son las anomalías geoquímicas que midió JICA en los ríos. Donde coinciden las fallas, los intrusivos y las anomalías, ahí conviene mirar.');
              }
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
              // De a dos frases: se oye como una explicación y no como una lista leída.
              for (let k = 0; k < frases.length && sigue() && !saltoEste(); k += 2) await decir(frases.slice(k, k + 2).join(' '));
              await decir('Todo esto está en su ficha, y en un toque se lo entrego en PDF con su plano, o en KML para Google Earth y DXF para AutoCAD.');
            },
          },
          oro: {
            hay: !!oro,
            correr: async () => {
              capitulo(++i, {
                titulo: 'Geoquímica de campo',
                cifras: [
                  { valor: oro!.total, etiqueta: 'muestras de JICA' },
                  { valor: oro!.maxGt, etiqueta: 'g/t de oro, la más alta', d: 1 },
                  { valor: oro!.sobreUnGramo, etiqueta: 'sobre 1 g/t' },
                ],
              });
              c.current.tocar(null);
              c.current.rasters([]);
              c.current.capas(() => []);
              c.current.muestras({ elemento: 'au', geojson: muestras });
              mover({ accion: 'camara', centro: oro!.centro, zoom: 9.8, inclinacion: 58, giro: -32, ms: 6500 });
              await pausa(3000);
              const [ox, oy] = oro!.centro;
              if (sigue()) c.current.enfocar({ encuadre: [ox - 0.06, oy - 0.05, ox + 0.06, oy + 0.05], etiqueta: `Foco de oro · hasta ${nf(oro!.maxGt, 1)} g/t` });
              orbitar(40, 30_000);
              await decir(
                `También tengo ${nf(oro!.total)} muestras de sedimentos y rocas que tomó JICA, con su ley de oro, plata, cobre y zinc. El calor muestra dónde se juntan las anomalías: la más alta de oro llega a ${nf(oro!.maxGt, 1)} gramos por tonelada, y ${plural(oro!.sobreUnGramo, 'muestra pasa', 'muestras pasan')} de un gramo.`
              );
              await decir('Toque cualquier punto y le digo qué es, cuánto dio y en qué concesión cae hoy.');
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
              await decir(
                `Lo que un regulador o un inversionista tiene que ver antes que nada: los conflictos. ` +
                  (t?.areasProtegidas ? `${plural(t.areasProtegidas.concesiones, 'concesión pisa', 'concesiones pisan')} áreas protegidas` : '') +
                  (t?.microcuencas ? `, ${nf(t.microcuencas.concesiones)} pisan microcuencas declaradas` : '') +
                  (t?.poblados ? ` y ${nf(t.poblados.concesiones)} tienen caseríos dentro` : '') +
                  '.'
              );
              await decir(
                `Esta es ${nombreParaDecir(conflicto!.concesion)}: pisa ${nf(conflicto!.ha, 1)} hectáreas de ${conflicto!.con}, el ${nf(conflicto!.pct)} por ciento de su superficie. Esto, que antes tomaba semanas de escritorio, lo tengo al día en segundos.`
              );
            },
          },
          traslapes: {
            hay: !!(t && fTraslape?.geojson && fTraslape.encuadre && traslapeMayor),
            correr: async () => {
              capitulo(++i, {
                titulo: 'Derechos que se pisan',
                cifras: [
                  { valor: t!.traslapes.total, etiqueta: 'traslapes' },
                  { valor: t!.traslapes.hectareas, etiqueta: 'hectáreas en disputa' },
                  ...(t!.traslapes.mismoNombre ? [{ valor: t!.traslapes.mismoNombre.total, etiqueta: 'con el mismo nombre' }] : []),
                ],
              });
              c.current.capas(() => []);
              await irConFicha(fTraslape!);
              orbitar(50, 30_000);
              await decir(
                `Cruzo cada concesión con todas las demás: hay ${plural(t!.traslapes.total, 'traslape', 'traslapes')} entre derechos, ${nf(t!.traslapes.hectareas)} hectáreas que dos titulares reclaman a la vez. En el mapa van rayados.`
              );
              await decir(
                `El más grande es entre ${nombreParaDecir(traslapeMayor!.a)} y ${nombreParaDecir(traslapeMayor!.b)}: ${nf(traslapeMayor!.ha, 1)} hectáreas.` +
                  (t!.traslapes.mismoNombre?.total ? ` Y ${nf(t!.traslapes.mismoNombre.total)} son entre concesiones con el mismo nombre: parecen registros duplicados que conviene depurar.` : '')
              );
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
              capitulo(++i, { titulo: 'El marco legal, a mano', chips: ['Reformas Decreto 109-2019', 'Formularios INHGEOMIN', 'Análisis legal por concesión', 'Expedientes con búsqueda'] });
              c.current.tocar(null);
              await decir(
                'Tengo leídos los documentos legales: las reformas del Decreto 109-2019 a la Ley General de Minería y los formularios de INHGEOMIN, de exploración, explotación, beneficio, comercialización y declaración jurada.'
              );
              await decir('Pregúnteme qué pide un trámite o qué dice un artículo y le contesto citando el documento. Y en la ficha de cada concesión, «Analizar» le hace el análisis legal y ambiental.');
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
                'Aquí enciende capas: geología, fallas, áreas protegidas, microcuencas, los mapas de JICA, las muestras y el satélite. Cada una con su leyenda y su transparencia.',
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
              await decir('Así se ve si entró maquinaria, si abrieron un camino o si el bosque se perdió. Año por año, sin salir de la oficina.');
              await pausa(4500);
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
            },
          },
        };

        const ORDEN: Record<ModoRecorrido, string[]> = {
          // El completo lo cuenta todo: la geología, lo legal y las herramientas, en ese orden.
          completo: ['intro', 'potencial', 'satelite', 'zona', 'analisis', 'oro', 'conflictos', 'traslapes', 'vencimientos', 'marco', 'fichaBotones', 'geologicoVivo', 'timelapse', 'manos', 'cierre'],
          geologico: ['intro', 'zona', 'analisis', 'oro', 'alteracion', 'geologicoVivo', 'cierre'],
          legal: ['intro', 'conflictos', 'traslapes', 'vencimientos', 'marco', 'cierre'],
          herramientas: ['barra', 'capasBoton', 'herramientasMapa', 'fichaBotones', 'geologicoVivo', 'timelapse', 'chat', 'manos', 'pestanas', 'reparto', 'cierre'],
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
