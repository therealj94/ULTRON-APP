/**
 * DR ELECTRUM FP — la estación de trabajo.
 *
 * El movimiento central de la interfaz es **la cara que cede el paso**:
 *
 *  - Arranca como ULTRON: cara completa, centrada, sin nada más. Es quien te recibe.
 *  - En cuanto hay algo que mirar —un mapa, un expediente— la cara se encoge a la esquina y le deja
 *    el escenario al trabajo, pero sigue ahí, mirando y reaccionando.
 *  - Si el trabajo se cierra, vuelve a ocupar el centro.
 *
 * No es adorno. Una cara a pantalla completa mientras alguien intenta leer un lindero es un estorbo;
 * un mapa sin cara es una herramienta más, sin nadie del otro lado. La transición entre los dos
 * estados es lo que hace que se sienta que hay alguien trabajando con vos.
 *
 * El mapa lo mueven las herramientas, no el usuario: cada respuesta del cerebro puede traer órdenes
 * en `ui` (volar a una concesión, pintar una capa) y la escena obedece mientras él habla.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaceCanvas } from '../src/02-cara';
import type { FaceState, Mode } from '../src/types';
import type { Emocion } from '../lib/emocion';
import { Mapa, type Fondo, type Motor, type OrdenMapa } from './mapa/Mapa';
import { Panel } from './panel/Panel';
import { Barra } from './panel/Barra';
import { Entrar } from './Entrar';
import { hayCredencial, headersElectrum, puertaAbierta } from './acceso';

/** Dónde está la atención: en quien habla, o en lo que hay que mirar. */
export type Escenario = 'cara' | 'trabajo';

export default function App() {
  /**
   * La puerta se comprueba ANTES de montar la estación.
   *
   * Antes no se comprobaba: se montaba todo y el primer mensaje contestaba que no había acceso, con
   * el mapa y los ocho especialistas ya delante. Eso es peor que una puerta cerrada, porque parece
   * que entraste. Y se pregunta al servidor en vez de mirar si hay un token guardado: un token
   * caducado, o el de alguien que entró a ULTRON pero no está en el padrón de Electrum, se ve igual
   * desde aquí.
   */
  const [puerta, setPuerta] = useState<'probando' | 'cerrada' | 'abierta'>(() =>
    hayCredencial() ? 'probando' : 'cerrada'
  );
  useEffect(() => {
    if (puerta !== 'probando') return;
    let vivo = true;
    puertaAbierta().then((ok) => vivo && setPuerta(ok ? 'abierta' : 'cerrada'));
    return () => {
      vivo = false;
    };
  }, [puerta]);

  const [escenario, setEscenario] = useState<Escenario>('cara');
  const [face, setFace] = useState<FaceState>('IDLE');
  const [emocion, setEmocion] = useState<Emocion>('neutral');
  const [mode, setMode] = useState<Mode>('MINING');
  const [motor, setMotor] = useState<Motor>('maplibre');
  const [fondo, setFondo] = useState<Fondo>('satelite');
  const [orden, setOrden] = useState<OrdenMapa | null>(null);
  const [panel, setPanel] = useState<'chat' | 'expedientes'>('chat');
  const claveGoogle = (import.meta as any).env?.VITE_GOOGLE_MAPS_KEY || '';

  /**
   * En teléfono el panel ocupa la mitad de abajo, así que la cara no puede ir en esa esquina: tapaba
   * el campo de escribir. Se va arriba del mapa, donde no estorba a nada.
   */
  const [ancho, setAncho] = useState(typeof window === 'undefined' ? true : window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const alCambiar = (e: MediaQueryListEvent) => setAncho(e.matches);
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, []);

  /**
   * La cara cede el paso sola. La primera orden del mapa es la que abre el escenario de trabajo:
   * nadie tiene que tocar un botón para que la interfaz haga lo evidente.
   */
  const alTrabajo = useCallback(() => setEscenario('trabajo'), []);

  /**
   * Elegir pestaña también abre el panel.
   *
   * Antes solo cambiaba cuál de las dos vistas estaba puesta, y el panel sigue fuera de pantalla
   * mientras la cara está en el centro: desde la pantalla de inicio se tocaba EXPEDIENTES y no
   * pasaba absolutamente nada. Un botón que no hace nada visible es un botón roto, y este era el
   * que llevaba a subir archivos.
   */
  const elegirPanel = useCallback((p: 'chat' | 'expedientes') => {
    setPanel(p);
    setEscenario('trabajo');
  }, []);
  useEffect(() => {
    if (orden) alTrabajo();
  }, [orden, alTrabajo]);

  /** Las herramientas devuelven `ui`; aquí se traduce a órdenes para el mapa. */
  const alUi = useCallback((datos: Array<Record<string, unknown>>) => {
    for (const d of datos) {
      if (d.accion === 'volar' && d.geojson) {
        setOrden({ accion: 'volar', geojson: d.geojson as any, encuadre: d.encuadre as any, centro: d.centro as any });
      } else if (d.accion === 'capa' && d.geojson) {
        setOrden({ accion: 'capa', geojson: d.geojson as any, encuadre: d.encuadre as any });
      } else if (Array.isArray(d.punto)) {
        setOrden({ accion: 'punto', punto: d.punto as [number, number] });
      }
    }
  }, []);

  // Con la cara en la esquina no hay sitio para los juguetes: se apagan solos.
  const cara = useMemo(
    () => (
      <FaceCanvas
        face={face}
        mode={mode}
        energy={escenario === 'cara' ? 1 : 0.7}
        soundFxEnabled={false}
        emocion={emocion}
        funMode={false}
        onFaceChange={(f) => setFace(f)}
        onModeChange={(m) => setMode(m)}
      />
    ),
    [face, mode, emocion, escenario]
  );

  const enTrabajo = escenario === 'trabajo';

  /*
   * Al abrir el mapa, pintar lo que hay cargado.
   *
   * Antes el mapa salía vacío con mil concesiones dentro y solo aparecía algo cuando alguien
   * nombraba una. Un catastro que no se ve no sirve para lo que sirve un catastro, que es mirar
   * dónde está cada cosa respecto de las demás. Se pide una sola vez, la primera vez que se entra.
   */
  const pedido = useRef(false);
  useEffect(() => {
    if (!enTrabajo || pedido.current || puerta !== 'abierta') return;
    pedido.current = true;
    (async () => {
      try {
        const r = await fetch('/api/electrum/catastro.geojson', { headers: headersElectrum() });
        if (!r.ok) return;
        const j = await r.json();
        if (j?.geojson?.features?.length) setOrden({ accion: 'capa', geojson: j.geojson, encuadre: j.encuadre || undefined });
      } catch {
        /* sin catastro que pintar: el mapa se queda con su fondo, que es la verdad */
      }
    })();
  }, [enTrabajo, puerta]);

  if (puerta === 'probando') {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#FFAE3B]/50">comprobando acceso…</div>
      </div>
    );
  }
  if (puerta === 'cerrada') return <Entrar onAbierta={() => setPuerta('abierta')} />;

  return (
    <div className="fixed inset-0 bg-black text-[#E7EEF2] overflow-hidden select-none">
      <Barra
        escenario={escenario}
        motor={motor}
        fondo={fondo}
        hayGoogle={!!claveGoogle}
        onEscenario={setEscenario}
        onMotor={setMotor}
        onFondo={setFondo}
      />

      {/* El trabajo: ocupa todo el escenario y se desvanece cuando la cara vuelve al centro. */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{ opacity: enTrabajo ? 1 : 0, pointerEvents: enTrabajo ? 'auto' : 'none' }}
        aria-hidden={!enTrabajo}
      >
        {/*
          Posición explícita, no `inset-0` con relleno y `h-full` dentro: esa cadena de alturas al
          cien por cien resolvía a CERO y MapLibre nacía con un lienzo de 300 px sobre una caja
          vacía, o sea mapa negro. Con los cuatro lados fijados no hay nada que resolver.
        */}
        {/*
          VERTICAL, y en toda pantalla. La web se apila —mapa arriba, conversación debajo— y la app
          se reparte en columnas. Son dos formas distintas a propósito: la web se lee de arriba
          abajo como un expediente, la app se sostiene con las dos manos como una herramienta.

          El mapa se lleva el 58 %: menos y una concesión no se distingue; más y la conversación
          queda en una rendija.
        */}
        <div className="absolute top-[52px] left-0 right-0 bottom-[42%]">
          <Mapa orden={orden} motor={motor} fondo={fondo} claveGoogle={claveGoogle} />
        </div>
        <Panel
          abierto={enTrabajo}
          onVista={elegirPanel}
          vista={panel}
          onFace={setFace}
          onEmocion={setEmocion}
          onUi={alUi}
          onTrabajo={alTrabajo}
        />
      </div>

      {/*
        La cara. Un solo elemento que se mueve entre dos sitios: centro del escenario, o esquina.
        Mover el mismo nodo en vez de montar dos caras distintas es lo que hace que la transición
        se lea como que ELLA se aparta, y no como que una desaparece y otra aparece.
      */}
      <div
        className="absolute transition-all duration-[650ms] ease-[cubic-bezier(.22,.61,.36,1)]"
        style={{
          /*
            En Expedientes el panel ocupa toda la altura y la cara se quedaba encima de la pestaña
            «Consulta», tapando justo el botón para volver. La cara se apoya en el mapa; cuando no
            hay mapa a la vista, no tiene dónde apoyarse y sobra. Se aparta en lugar de estorbar.
          */
          opacity: enTrabajo && panel === 'expedientes' ? 0 : 1,
          pointerEvents: enTrabajo && panel === 'expedientes' ? 'none' : 'auto',
          ...(enTrabajo
            ? /*
               * Arriba a la izquierda, SOBRE EL MAPA — no abajo.
               *
               * Con el reparto en columnas, abajo a la izquierda caía sobre el mapa y quedaba
               * bien. Al apilar la web en vertical, ese mismo sitio pasó a ser la conversación:
               * la cara se plantaba encima del hilo y de los ejemplos. La cara vive sobre el
               * escenario que cede, y desde que la web es vertical ese escenario está arriba.
               */
              ancho
              ? { left: 16, top: 64, width: 132, height: 132, zIndex: 30 }
              : { left: 12, top: 60, width: 96, height: 96, zIndex: 30 }
            : { left: '50%', top: '50%', width: 'min(76vmin, 560px)', height: 'min(76vmin, 560px)', transform: 'translate(-50%,-50%)', zIndex: 30 }),
        }}
      >
        <button
          type="button"
          onClick={() => setEscenario(enTrabajo ? 'cara' : 'trabajo')}
          className="absolute inset-0 w-full h-full cursor-pointer rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]"
          aria-label={enTrabajo ? 'Traer la cara al centro' : 'Ir al mapa'}
        >
          <span className="sr-only">{enTrabajo ? 'Traer la cara al centro' : 'Ir al mapa'}</span>
        </button>
        {/* Encogida sobre el mapa, la cara necesita marco: si no, es un rectángulo negro pegado. */}
        {/*
          `relative` no es decorativo: el lienzo de la cara es `absolute inset-0` y sin esto se
          posicionaba contra el div de FUERA, que no tiene el borde. La cara quedaba un píxel
          arriba y a la izquierda de su propio marco.
        */}
        <div
          className="relative w-full h-full pointer-events-none overflow-hidden transition-all duration-500"
          style={
            enTrabajo
              ? { borderRadius: 18, border: '1px solid rgba(255,174,59,.28)', boxShadow: '0 8px 30px rgba(0,0,0,.55)' }
              : { borderRadius: 0, border: '1px solid transparent' }
          }
        >
          {cara}
        </div>
      </div>

      {/* Presentación, solo mientras la cara manda. */}
      <div
        className="absolute left-0 right-0 bottom-10 text-center transition-opacity duration-500 px-6"
        style={{ opacity: enTrabajo ? 0 : 1, pointerEvents: 'none' }}
      >
        <div className="font-display font-bold tracking-[0.34em] text-[#FFAE3B] text-lg">DR ELECTRUM FP</div>
        <div className="mt-1 font-mono text-[11px] tracking-[0.22em] uppercase text-[#FFAE3B]/50">
          geología · minas · civil · metalurgia · gis · ambiental · legal · economía
        </div>
      </div>
    </div>
  );
}
