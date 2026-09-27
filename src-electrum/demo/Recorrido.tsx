/**
 * EL RECORRIDO GUIADO.
 *
 * Un botón y Dr Electrum se presenta solo: vuela sobre Honduras, abre el tablero nacional con sus
 * cifras, entra en 3D a la concesión que más área protegida pisa y la explica, enciende la geología,
 * abre su ficha, y termina en Vueltas del Río con lo que dicen los informes de JICA. Todo con su voz
 * y con subtítulos —en una sala sin parlantes la demo se entiende igual—.
 *
 * No pasa por el modelo: cada paso sale de datos reales (el tablero, las fichas, el cruce del
 * punto de JICA con el catastro), así que no hay 20 s de espera ni riesgo de que improvise. Las
 * cifras que dice son las que hay en la base en ese momento. Se puede parar en cualquier paso.
 */
import { useEffect, useRef, useState } from 'react';
import type { Geometry } from 'geojson';
import { headersElectrum } from '../acceso';
import { callar, desbloquear, hablar } from '../panel/voz';
import type { CapaExtra, OrdenMapa, Tocado } from '../mapa/captura';
import { pedirTablero } from '../mapa/Tablero';

const AMBAR = '#FFAE3B';
const HONDURAS: [number, number, number, number] = [-89.4, 12.9, -83.1, 16.6];
/** Vueltas del Río (antigua mina San Martín), UTM 16N E 333.5 / N 1682.5 km según JICA Vol. 6 p. 87. */
const VUELTAS_DEL_RIO: [number, number] = [-88.5501, 15.2132];

export type Controles = {
  orden: (o: OrdenMapa) => void;
  /** El 3D es de MapLibre: el recorrido lo pone antes de empezar, aunque estuvieran en Google. */
  maplibre: () => void;
  tresD: (v: boolean) => void;
  tablero: (v: boolean) => void;
  tocar: (t: Tocado | null) => void;
  capas: (f: (antes: CapaExtra[]) => CapaExtra[]) => void;
  cara: (f: 'IDLE' | 'SPEAKING' | 'THINKING') => void;
};

type Ficha = { id: number; nombre: string; encuadre: [number, number, number, number] | null; geojson: Geometry | null };

const nf = (x: number, d = 0) => x.toLocaleString('es-ES', { maximumFractionDigits: d });
const plural = (n: number, uno: string, varios: string) => `${nf(n)} ${n === 1 ? uno : varios}`;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: headersElectrum() });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `El servidor contestó ${r.status}.`);
  return j as T;
}

/** El nombre para decirlo en voz alta: sin notas del padrón como «(GRAVADO CON PRIMERA HIPOTECA)». */
export const nombreParaDecir = (n: string) => String(n || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[.\s]+$/, '').replace(/\s+/g, ' ').trim();

const centroDe = (e: [number, number, number, number]): [number, number] => [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];

export function Recorrido({ activo, onTerminar, controles }: { activo: boolean; onTerminar: () => void; controles: Controles }) {
  const [subtitulo, setSubtitulo] = useState('');
  const [paso, setPaso] = useState(0);
  const [total, setTotal] = useState(7);
  const vivo = useRef(0);
  const c = useRef(controles);
  c.current = controles;

  useEffect(() => {
    if (!activo) return;
    const mio = ++vivo.current;
    const sigue = () => vivo.current === mio;

    /** Dice un texto con subtítulo; si la voz falla, espera lo que se tarda en leerlo. */
    const decir = async (texto: string) => {
      if (!sigue()) return;
      setSubtitulo(texto);
      const t0 = Date.now();
      c.current.cara('SPEAKING');
      await hablar(texto, 'neutral', headersElectrum(), {});
      const minimo = Math.min(9000, 1200 + texto.length * 45);
      const falta = minimo - (Date.now() - t0);
      if (falta > 0 && sigue()) await espera(falta);
      if (sigue()) c.current.cara('IDLE');
    };

    (async () => {
      try {
        setPaso(1);
        setSubtitulo('Preparando el recorrido…');
        const t = await pedirTablero();
        if (!sigue()) return;
        const conflicto = t.areasProtegidas?.lista[0];
        const [fichaConflicto, aqui, capas] = await Promise.all([
          conflicto ? json<Ficha>(`/api/electrum/mapa/concesion/${conflicto.id}`).catch(() => null) : Promise.resolve(null),
          json<{ concesiones: { estado: string; lista?: Array<{ id: number; nombre: string; titular: string | null }> } }>(
            `/api/electrum/mapa/aqui?lon=${VUELTAS_DEL_RIO[0]}&lat=${VUELTAS_DEL_RIO[1]}`
          ).catch(() => null),
          json<{ capas: Array<{ id: number; nombre: string; rol: string }> }>('/api/electrum/mapa/capas').catch(() => ({ capas: [] })),
        ]);
        // Los pasos que de verdad se van a narrar: inicio, tablero y cierre siempre; el conflicto
        // suma dos (3D y geología con ficha) y Vueltas del Río uno.
        const pasos = 3 + (fichaConflicto?.encuadre && conflicto ? 2 : 0) + (aqui ? 1 : 0);
        setTotal(pasos);

        // 1. Honduras entera.
        c.current.maplibre();
        c.current.tocar(null);
        c.current.tablero(false);
        c.current.tresD(false);
        c.current.orden({ accion: 'encuadrar', encuadre: HONDURAS, ms: 2500 });
        await decir(
          'Buenas. Soy Dr Electrum, la plataforma de inteligencia minera de Orden Global. Trabajo sobre el catastro minero nacional, la geología y los expedientes, y contesto con fuentes.'
        );

        // 2. El tablero.
        if (!sigue()) return;
        setPaso(2);
        c.current.tablero(true);
        await decir(
          `Tengo cargadas ${plural(t.total.concesiones, 'concesión', 'concesiones')}, ${nf(t.total.hectareas)} hectáreas. ` +
            `Las cruzo todas con las capas del país: ${plural(t.traslapes.total, 'traslape', 'traslapes')} entre derechos` +
            (t.areasProtegidas ? `, ${plural(t.areasProtegidas.concesiones, 'concesión que pisa', 'concesiones que pisan')} áreas protegidas` : '') +
            (t.microcuencas ? ` y ${plural(t.microcuencas.concesiones, 'que pisa', 'que pisan')} microcuencas declaradas` : '') +
            '.' +
            (t.traslapes.mismoNombre?.total
              ? ` De esos traslapes, ${nf(t.traslapes.mismoNombre.total)} son entre concesiones con el mismo nombre: parecen registros duplicados en el padrón, y conviene depurarlos.`
              : '') +
            ' Esto, que antes tomaba semanas de trabajo en un escritorio, lo tengo al día en segundos.'
        );
        if (!sigue()) return;
        c.current.tablero(false);

        // 3. En 3D, al conflicto más grande.
        let n = 3;
        if (fichaConflicto?.encuadre && conflicto) {
          setPaso(n++);
          c.current.tresD(true);
          c.current.orden({ accion: 'camara', centro: centroDe(fichaConflicto.encuadre), zoom: 12.2, inclinacion: 64, giro: -25, ms: 6000 });
          if (fichaConflicto.geojson) {
            await espera(900);
            c.current.orden({ accion: 'volar', geojson: fichaConflicto.geojson, encuadre: fichaConflicto.encuadre });
            await espera(300);
            c.current.orden({ accion: 'camara', centro: centroDe(fichaConflicto.encuadre), zoom: 12.6, inclinacion: 64, giro: -25, ms: 2500 });
          }
          await decir(
            `Miremos el terreno real, en tres dimensiones. Esta es ${nombreParaDecir(conflicto.concesion)}. ` +
              `Pisa ${nf(conflicto.ha, 1)} hectáreas del área protegida ${conflicto.con}, el ${nf(conflicto.pct)} por ciento de la concesión. ` +
              'Es exactamente el tipo de caso que una fiscalización necesita ver primero.'
          );

          // 4. La geología y la ficha.
          if (!sigue()) return;
          setPaso(n++);
          const roca = capas.capas.find((x) => x.rol === 'litologia');
          const fallas = capas.capas.find((x) => x.rol === 'falla');
          const encender = await Promise.all(
            [roca, fallas].filter(Boolean).map((x) => json<{ rol: string; geojson: any }>(`/api/electrum/mapa/capa/${x!.id}`).then((r) => ({ id: x!.id, nombre: x!.nombre, rol: r.rol as any, geojson: r.geojson })).catch(() => null))
          );
          if (!sigue()) return;
          c.current.capas((antes) => [...antes.filter((a) => !encender.some((e) => e?.id === a.id)), ...(encender.filter(Boolean) as CapaExtra[])]);
          c.current.tocar({ tipo: 'concesion', id: fichaConflicto.id, nombre: fichaConflicto.nombre, lngLat: centroDe(fichaConflicto.encuadre) });
          await decir(
            'Enciendo la geología: cada color es un tipo de roca, y las líneas rojas son fallas. A la derecha está su ficha: catastro, alertas del entorno, geología, indicios de mineralización y los documentos que la mencionan. Todo sale de los datos, no de mi imaginación.'
          );
        }

        // 5. JICA: Vueltas del Río.
        if (!sigue()) return;
        const enVueltas = aqui?.concesiones?.estado === 'ok' ? aqui.concesiones.lista?.[0] : undefined;
        if (aqui) {
          setPaso(n++);
          c.current.tocar(null);
          c.current.orden({ accion: 'camara', centro: VUELTAS_DEL_RIO, zoom: 12.4, inclinacion: 60, giro: 20, ms: 6500 });
          await espera(1500);
          if (enVueltas) c.current.tocar({ tipo: 'concesion', id: enVueltas.id, nombre: enVueltas.nombre, lngLat: VUELTAS_DEL_RIO });
          await decir(
            'Ahora Santa Bárbara, Vueltas del Río. Leí completos los cinco volúmenes de la agencia japonesa JICA, de 1978 a 1980, escaneados y en inglés, y los resumí en español. ' +
              'Aquí están los mejores resultados de oro de todo el occidente: en superficie, de uno a diez gramos por tonelada.' +
              (enVueltas ? ` Y cruzo ese prospecto con el catastro de hoy: está dentro de la concesión ${nombreParaDecir(enVueltas.nombre)}${enVueltas.titular ? `, de ${enVueltas.titular}` : ''}.` : '')
          );
        }

        // 6. Cierre.
        if (!sigue()) return;
        setPaso(n++);
        c.current.tocar(null);
        c.current.capas((antes) => antes.filter((a) => a.rol !== 'litologia' && a.rol !== 'falla'));
        c.current.orden({ accion: 'encuadrar', encuadre: HONDURAS, inclinacion: 45, giro: -10, ms: 5000 });
        await decir(
          'Todo esto lo puede pedir cualquiera de su equipo con la voz, desde la computadora, la aplicación o Telegram, y yo armo la ficha en PDF, los mapas geológicos o el análisis legal y ambiental. Pregúnteme lo que quiera.'
        );
        if (!sigue()) return;
        c.current.tresD(false);
        c.current.orden({ accion: 'encuadrar', encuadre: HONDURAS, ms: 2500 });
      } catch (e: any) {
        if (sigue()) setSubtitulo(`No pude seguir el recorrido: ${String(e?.message || e)}`);
        await espera(3500);
      } finally {
        if (sigue()) {
          c.current.cara('IDLE');
          setSubtitulo('');
          onTerminar();
        }
      }
    })();

    return () => {
      vivo.current++;
      callar();
    };
  }, [activo, onTerminar]);

  if (!activo) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[40] flex justify-center px-3">
      <div className="pointer-events-auto flex w-full max-w-3xl items-start gap-3 rounded-2xl border border-[#FFAE3B]/30 bg-black/80 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,.6)] backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: AMBAR }} />
            <span className="font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
              Recorrido · {Math.min(paso, total)} de {total}
            </span>
          </div>
          <p className="text-[14px] leading-relaxed text-[#F3F6F8] md:text-[15px]">{subtitulo}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            vivo.current++;
            callar();
            c.current.cara('IDLE');
            setSubtitulo('');
            onTerminar();
          }}
          className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] uppercase text-[#DCE5EA] hover:border-white/30 cursor-pointer"
        >
          ■ Detener
        </button>
      </div>
    </div>
  );
}

/** Para arrancarlo desde un toque: desbloquea el audio en ese mismo gesto. */
export function prepararRecorrido() {
  desbloquear();
}
