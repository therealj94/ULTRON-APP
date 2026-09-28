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
import { analisisDeFicha, centroDe, concesionesEn, focoDeOro, fold, nombreParaDecir, zonaMasRica, type Ficha } from './guion';

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
};

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

const CAPACIDADES = ['Pregunta con la voz', 'Web, app y Telegram', 'Ficha en PDF', 'Plano profesional', 'KML · GeoJSON · DXF', 'Perfil del terreno', 'Pedir área nueva', 'Alertas', 'Desde Claude'];

export function Recorrido({ activo, onTerminar, controles, fichaAbierta = false }: { activo: boolean; onTerminar: () => void; controles: Controles; fichaAbierta?: boolean }) {
  const [texto, setTexto] = useState('');
  const [n, setN] = useState(0);
  const [total, setTotal] = useState(8);
  const [cap, setCap] = useState<Capitulo>({ titulo: 'Preparando el recorrido' });
  const [chico, setChico] = useState(false);
  /** Dónde lo dejó quien lo arrastró (px dentro del mapa); null = su sitio de siempre. */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
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

    (async () => {
      try {
        capitulo(0, { titulo: 'Preparando el recorrido' });
        setTexto('Juntando las cifras, los mapas y las fichas…');
        c.current.trabajo();
        c.current.maplibre();
        c.current.alto(ALTO_RECORRIDO);
        c.current.fondo('satelite');
        c.current.tocar(null);
        c.current.tresD(true);

        const [t, rasters, capas, perdidas, ranking, muestras] = await Promise.all([
          reintentar(() => pedirTablero()).catch(() => null as DatosTablero | null),
          json<{ rasters: RasterEscaneado[] }>('/api/electrum/mapa/rasters').then((j) => j.rasters || []).catch(() => [] as RasterEscaneado[]),
          json<{ capas: Array<{ id: number; nombre: string; rol: string }> }>('/api/electrum/mapa/capas').then((j) => j.capas || []).catch(() => []),
          json<{ lista: Array<{ id: number; nombre: string; ha: number }> }>('/api/electrum/satelite/mayores').then((j) => j.lista || []).catch(() => []),
          json<{ ranking: Array<{ id: number; nombre: string; puntaje: number }> }>('/api/electrum/prospectividad').then((j) => j.ranking || []).catch(() => []),
          json<any>('/api/electrum/mapa/muestras').catch(() => null),
        ]);
        const catastro = catastroGuardado() ?? (await json<{ geojson: any }>('/api/electrum/catastro.geojson').then((j) => j.geojson).catch(() => null));
        if (!sigue()) return;

        const zona = zonaMasRica(rasters as any);
        const enZona = zona ? concesionesEn(catastro, zona.encuadre) : [];
        const oro = focoDeOro(muestras);
        const conflicto = t?.areasProtegidas?.lista[0];
        const s2 = (k: string) => rasters.find((r) => r.clave === k);
        const [fZona, fPerdida, fConflicto, fallas, protegidas] = await Promise.all([
          enZona[0] ? ficha(enZona[0].id) : Promise.resolve(null),
          perdidas[0] ? ficha(perdidas[0].id) : Promise.resolve(null),
          conflicto ? ficha(conflicto.id) : Promise.resolve(null),
          capa(zona ? capas.find((x) => x.rol === 'falla' && fold(x.nombre).includes(fold(zona.nombre))) : undefined),
          capa(capas.find((x) => x.rol === 'area_protegida')),
        ]);
        if (!sigue()) return;

        const hay = {
          satelite: !!(fPerdida?.geojson && fPerdida.encuadre && s2('s2-veg')),
          zona: !!(zona && zona.mapas.length),
          analisis: !!(fZona?.geojson && fZona.encuadre),
          oro: !!oro,
          conflicto: !!(fConflicto?.geojson && fConflicto.encuadre && conflicto),
        };
        const cuantos = 3 + Number(hay.satelite) + Number(hay.zona) + Number(hay.analisis) + Number(hay.oro) + Number(hay.conflicto);
        setTotal(cuantos);
        let i = 0;
        const limpiar = () => {
          c.current.rasters([]);
          c.current.muestras(null);
          c.current.capas(() => []);
          c.current.prospectividad(false);
          c.current.tocar(null);
        };

        // 1. Honduras desde el aire.
        limpiar();
        capitulo(++i, {
          titulo: 'Honduras, en tres dimensiones',
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
        await decir('Buenas. Soy Dr Electrum, la plataforma de inteligencia minera de Orden Global. Esto es Honduras, con su relieve real, en tres dimensiones.');
        await decir(
          t
            ? `Encima tengo el catastro minero nacional completo: ${plural(t.total.concesiones, 'concesión', 'concesiones')} y ${nf(t.total.hectareas)} hectáreas, y cada una cruzada con la geología, el satélite, las áreas protegidas, el agua y las comunidades.`
            : 'Encima tengo el catastro minero nacional completo, y cada concesión cruzada con la geología, el satélite, las áreas protegidas, el agua y las comunidades.'
        );

        // 2. El potencial de cada concesión.
        if (!sigue()) return;
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

        // 3. Lo que ve el satélite.
        if (hay.satelite && sigue()) {
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
        }

        // 4. La zona con más información.
        if (hay.zona && sigue()) {
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
        }

        // 5. El análisis completo de la mejor concesión de la zona.
        if (hay.analisis && sigue()) {
          const f = fZona!;
          capitulo(++i, {
            titulo: `Análisis completo: ${nombreParaDecir(f.nombre)}`,
            cifras: typeof f.prospectividad?.puntaje === 'number' ? [{ valor: f.prospectividad.puntaje, etiqueta: 'de 100 en prospectividad' }] : undefined,
          });
          if (zona?.mapas[0]) c.current.rasters([{ ...(zona.mapas[0] as RasterEscaneado), opacidad: 0.5 }]);
          // La ficha se abre ANTES del vuelo: así el vuelo ya deja libre su lado. En el teléfono no:
          // ahí la ficha sube desde abajo y tapa el mapa entero, y la voz y el cuadro ya lo cuentan.
          if (enCompu()) {
            c.current.tocar({ tipo: 'concesion', id: f.id, nombre: f.nombre, lngLat: centroDe(f.encuadre!) });
            await pausa(350);
          }
          mover({ accion: 'volar', geojson: f.geojson, encuadre: f.encuadre! });
          await pausa(3000);
          orbitar(120, 60_000);
          const frases = analisisDeFicha(f);
          // De a dos frases: se oye como una explicación y no como una lista leída.
          for (let k = 0; k < frases.length && sigue() && !saltoEste(); k += 2) await decir(frases.slice(k, k + 2).join(' '));
          await decir('Todo esto está en su ficha, a la derecha, y en un toque se lo entrego en PDF con su plano, o en KML para Google Earth y DXF para AutoCAD.');
        }

        // 6. La geoquímica de campo.
        if (hay.oro && sigue()) {
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
          mover({ accion: 'camara', centro: oro!.centro, zoom: 9.4, inclinacion: 58, giro: -32, ms: 6500 });
          await pausa(3000);
          orbitar(40, 30_000);
          await decir(
            `También tengo ${nf(oro!.total)} muestras de sedimentos y rocas que tomó JICA, con su ley de oro, plata, cobre y zinc. El calor muestra dónde se juntan las anomalías: la más alta de oro llega a ${nf(oro!.maxGt, 1)} gramos por tonelada, y ${plural(oro!.sobreUnGramo, 'muestra pasa', 'muestras pasan')} de un gramo.`
          );
          await decir('Toque cualquier punto y le digo qué es, cuánto dio y en qué concesión cae hoy.');
        }

        // 7. Los conflictos.
        if (hay.conflicto && sigue()) {
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
          if (protegidas) c.current.capas(() => [protegidas]);
          // La ficha se abre ANTES del vuelo: así el vuelo ya deja libre su lado. En el teléfono no:
          // ahí la ficha sube desde abajo y tapa el mapa entero, y la voz y el cuadro ya lo cuentan.
          if (enCompu()) {
            c.current.tocar({ tipo: 'concesion', id: f.id, nombre: f.nombre, lngLat: centroDe(f.encuadre!) });
            await pausa(350);
          }
          mover({ accion: 'volar', geojson: f.geojson, encuadre: f.encuadre! });
          await pausa(3000);
          orbitar(-60, 36_000);
          await decir(
            `Y lo que un regulador o un inversionista tiene que ver antes que nada: los conflictos. ` +
              (t?.areasProtegidas ? `${plural(t.areasProtegidas.concesiones, 'concesión pisa', 'concesiones pisan')} áreas protegidas` : '') +
              (t?.microcuencas ? `, ${nf(t.microcuencas.concesiones)} pisan microcuencas declaradas` : '') +
              (t?.poblados ? ` y ${nf(t.poblados.concesiones)} tienen caseríos dentro` : '') +
              '.'
          );
          await decir(
            `Esta es ${nombreParaDecir(conflicto!.concesion)}: pisa ${nf(conflicto!.ha, 1)} hectáreas de ${conflicto!.con}, el ${nf(conflicto!.pct)} por ciento de su superficie. Esto, que antes tomaba semanas de escritorio, lo tengo al día en segundos.`
          );
        }

        // 8. Lo que se le puede pedir.
        if (!sigue()) return;
        capitulo(++i, { titulo: 'Pregúnteme lo que quiera', chips: CAPACIDADES });
        c.current.tocar(null);
        c.current.capas(() => []);
        c.current.rasters([]);
        c.current.muestras(null);
        c.current.prospectividad(true);
        mover({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 55, giro: 16, ms: 6000 });
        await pausa(2400);
        orbitar(-24, 24_000);
        await decir(
          'Todo esto me lo pide cualquiera de su equipo con palabras normales o con la voz: desde la web, la aplicación del teléfono, Telegram, y hasta desde su propio asistente Claude.'
        );
        await decir('Le armo la ficha en PDF, el plano profesional, el perfil del terreno, los archivos para Google Earth y AutoCAD, y le aviso cuando algo cambia. Pregúnteme lo que quiera.');
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
          c.current.cara('IDLE');
          // Sin el cuadro, el mapa vuelve a encuadrar en toda la pantalla.
          c.current.orden({ accion: 'orbitar', grados: 0, ms: 900, margen: SIN_MARGEN });
          setTexto('');
          onTerminar();
        }
      }
    })();

    return () => {
      vivo.current++;
      callar();
      despertar.current?.();
      // Detenido a mitad: también se deshace lo que el recorrido encendió.
      const c0 = c.current;
      c0.rasters(antes.rasters);
      c0.muestras(antes.muestras);
      c0.capas(() => antes.extras);
      c0.prospectividad(antes.prospectividad);
      c0.fondo(antes.fondo);
      c0.alto(antes.alto);
      c0.cara('IDLE');
      // La ficha que abrió el recorrido se cierra con él (al empezar ya se había cerrado la que hubiera).
      c0.tocar(null);
      c0.orden({ accion: 'orbitar', grados: 0, ms: 900, margen: SIN_MARGEN });
    };
  }, [activo, onTerminar]);

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
    onTerminar();
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
    <div
      ref={caja}
      style={lugar}
      className={`absolute z-[30] md:w-[min(460px,calc(100%-460px))] ${pos ? 'w-[min(460px,calc(100%-16px))]' : ''} ${clasesLugar}`}
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
  );
}

/** Para arrancarlo desde un toque: desbloquea el audio en ese mismo gesto. */
export function prepararRecorrido() {
  desbloquear();
}
