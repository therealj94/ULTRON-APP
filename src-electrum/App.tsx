/**
 * DR ELECTRUM FP — la estación de trabajo.
 *
 * El movimiento central de la interfaz es **la cara que cede el paso**:
 *
 *  - Arranca como AU-RA: cara completa, centrada, sin nada más. Es quien te recibe.
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
import { hayCredencial, headersElectrum, porQueNoAbre, puertaAbierta, salir, type Puerta } from './acceso';
import {
  ALTO_MAX,
  ALTO_MIN,
  ALTURAS,
  guardarPreferencia,
  leerPreferencia,
  repartoDe,
  siguienteReparto,
} from './preferencias';

/** Dónde está la atención: en quien habla, o en lo que hay que mirar. */
export type Escenario = 'cara' | 'trabajo';

export default function App() {
  /**
   * La puerta se comprueba ANTES de montar la estación.
   *
   * Antes no se comprobaba: se montaba todo y el primer mensaje contestaba que no había acceso, con
   * el mapa y los ocho especialistas ya delante. Eso es peor que una puerta cerrada, porque parece
   * que entraste. Y se pregunta al servidor en vez de mirar si hay un token guardado: un token
   * caducado, o el de alguien que entró a AU-RA pero no está en el padrón de Electrum, se ve igual
   * desde aquí.
   */
  const [puerta, setPuerta] = useState<'probando' | 'cerrada' | 'abierta' | 'plataforma'>(() =>
    hayCredencial() ? 'probando' : 'cerrada'
  );
  /** El porqué exacto, cuando el problema NO es la credencial. */
  const [porque, setPorque] = useState('');
  useEffect(() => {
    if (puerta !== 'probando') return;
    let vivo = true;
    puertaAbierta().then((p: Puerta) => {
      if (!vivo) return;
      if (p.estado === 'abierta') return setPuerta('abierta');
      /*
       * Solo `sin-permiso` manda a la pantalla de entrada. Las otras tres —sin red, servicio caído,
       * tardó demasiado— no se arreglan volviendo a escribir la credencial, y enseñar el formulario
       * ahí es mandar a la persona a pelearse con su contraseña por culpa del wifi.
       */
      if (p.estado === 'sin-permiso') return setPuerta('cerrada');
      setPorque(porQueNoAbre(p, 'sesion'));
      setPuerta('plataforma');
    });
    return () => {
      vivo = false;
    };
  }, [puerta]);

  const [escenario, setEscenario] = useState<Escenario>('cara');

  /*
   * CUÁNTO SE LLEVA CADA COSA.
   *
   * Era un 42 % fijo, igual en un monitor de veintisiete pulgadas que en un teléfono. Y los dos
   * usos de esta pantalla piden repartos opuestos: mirar dónde cae una concesión quiere mapa, y
   * leer los noventa y seis traslapes quiere texto. Un número fijo hace las dos cosas a medias.
   *
   * Se recuerda entre sesiones: una preferencia que hay que volver a poner cada vez no es una
   * preferencia.
   */
  const [alto, setAlto] = useState(() =>
    leerPreferencia('alto', ALTURAS.dividido, (v) => typeof v === 'number' && v >= ALTO_MIN && v <= ALTO_MAX)
  );
  const cambiarAlto = useCallback((v: number) => {
    const a = Math.min(ALTO_MAX, Math.max(ALTO_MIN, v));
    setAlto(a);
    guardarPreferencia('alto', a);
  }, []);

  /*
   * LA CARA, PLEGABLE.
   *
   * Ocupa 132 px de esquina sobre el mapa. Es identidad, no adorno —una herramienta sin nadie del
   * otro lado es otra cosa— pero cuando alguien está comparando linderos, 132 px de mapa tapados
   * son 132 px de mapa tapados. Que se pueda apartar no le quita identidad a la plataforma; se la
   * quitaría no poder.
   */
  const [caraPlegada, setCaraPlegada] = useState(() => leerPreferencia('caraPlegada', false, (v) => typeof v === 'boolean'));
  const plegarCara = useCallback((v: boolean) => {
    setCaraPlegada(v);
    guardarPreferencia('caraPlegada', v);
  }, []);
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
  if (puerta === 'plataforma') {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center px-6">
        <div className="max-w-[360px] text-center">
          <div className="font-display font-bold tracking-[0.34em] text-lg" style={{ color: '#FFAE3B' }}>
            DR ELECTRUM FP
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-[#B9C7CE]">{porque}</p>
          <button
            type="button"
            onClick={() => {
              setPorque('');
              setPuerta('probando');
            }}
            className="mt-5 rounded-lg px-4 py-2 text-[14px] font-semibold text-black"
            style={{ background: '#FFAE3B' }}
          >
            Reintentar
          </button>
          <button
            type="button"
            onClick={() => setPuerta('cerrada')}
            className="mt-3 block w-full text-[12px] text-[#8FA3B0] hover:text-[#E7EEF2] transition-colors"
          >
            Entrar con otra credencial
          </button>
        </div>
      </div>
    );
  }
  if (puerta === 'cerrada') return <Entrar onAbierta={() => setPuerta('abierta')} />;

  return (
    <div className="fixed inset-0 bg-black text-[#E7EEF2] overflow-hidden">
      <Barra
        escenario={escenario}
        motor={motor}
        fondo={fondo}
        hayGoogle={!!claveGoogle}
        onEscenario={setEscenario}
        onMotor={setMotor}
        onFondo={setFondo}
        onSalir={() => {
          // El hilo también se va: en una computadora compartida, salir tiene que llevarse lo que
          // se habló, no solo la credencial.
          try {
            sessionStorage.removeItem('electrum.hilo');
          } catch {
            /* sin almacenamiento no hay nada que quitar */
          }
          void fetch('/api/electrum/hilo', { method: 'DELETE', headers: headersElectrum() }).catch(() => {});
          salir();
          setPuerta('cerrada');
          setEscenario('cara');
        }}
      />

      {/* El trabajo: ocupa todo el escenario y se desvanece cuando la cara vuelve al centro. */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{ opacity: enTrabajo ? 1 : 0, pointerEvents: enTrabajo ? 'auto' : 'none' }}
        aria-hidden={!enTrabajo}
        /*
         * `inert` además de `aria-hidden`. Son cosas distintas y hace falta la segunda: `aria-hidden`
         * lo esconde del lector de pantalla pero NO saca a sus hijos del recorrido del tabulador, y
         * `pointer-events: none` solo detiene el ratón. Sin `inert`, quien navega con teclado caía
         * dentro de un panel invisible y se quedaba pulsando botones que no veía.
         */
        inert={!enTrabajo}
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
        <div
          className="absolute top-[52px] left-0 right-0 sin-seleccion"
          style={{ bottom: `${alto * 100}%` }}
        >
          <Mapa orden={orden} motor={motor} fondo={fondo} claveGoogle={claveGoogle} />
        </div>
        <Panel
          abierto={enTrabajo}
          onVista={elegirPanel}
          vista={panel}
          alto={alto}
          onAlto={cambiarAlto}
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
      {/*
        Plegada: una insignia con el estado, en el mismo sitio donde estaba la cara. Sigue diciendo
        que hay alguien del otro lado —y qué está haciendo— en una línea en vez de en un cuadrado.
      */}
      {enTrabajo && caraPlegada && panel !== 'expedientes' && (
        <button
          type="button"
          onClick={() => plegarCara(false)}
          className="absolute z-30 flex items-center gap-2 rounded-full border border-white/12 bg-black/70 px-3 py-1.5 backdrop-blur-md cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]"
          style={ancho ? { left: 16, top: 64 } : { left: 12, top: 60 }}
          aria-label="Volver a enseñar la cara de Dr Electrum"
          title="Volver a enseñar la cara"
        >
          <span
            className="h-2 w-2 rounded-full transition-colors"
            style={{ background: face === 'THINKING' ? '#8FA3B0' : face === 'CONCERNED' ? '#D9705A' : '#FFAE3B' }}
          />
          <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-[#9FB0B8]">
            {face === 'THINKING' ? 'pensando' : face === 'SPEAKING' ? 'hablando' : face === 'CONCERNED' ? 'algo falló' : 'Dr Electrum'}
          </span>
        </button>
      )}

      <div
        className="absolute transition-all duration-[650ms] ease-[cubic-bezier(.22,.61,.36,1)]"
        /*
         * Invisible es invisible también para el tabulador. Con la cara apagada —plegada o en
         * Expedientes— su botón de plegar seguía siendo enfocable: quien navega con teclado se
         * topaba con un control de algo que no está en pantalla. Mismo caso que el panel oculto.
         */
        inert={enTrabajo && (panel === 'expedientes' || caraPlegada)}
        style={{
          /*
            En Expedientes el panel ocupa toda la altura y la cara se quedaba encima de la pestaña
            «Consulta», tapando justo el botón para volver. La cara se apoya en el mapa; cuando no
            hay mapa a la vista, no tiene dónde apoyarse y sobra. Se aparta en lugar de estorbar.
          */
          opacity: enTrabajo && (panel === 'expedientes' || caraPlegada) ? 0 : 1,
          pointerEvents: enTrabajo && (panel === 'expedientes' || caraPlegada) ? 'none' : 'auto',
          ...(enTrabajo
            ? /*
               * Arriba a la izquierda, SOBRE EL MAPA — no abajo.
               *
               * Con el reparto en columnas, abajo a la izquierda caía sobre el mapa y quedaba
               * bien. Al apilar la web en vertical, ese mismo sitio pasó a ser la conversación:
               * la cara se plantaba encima del hilo y de los ejemplos. La cara vive sobre el
               * escenario que cede, y desde que la web es vertical ese escenario está arriba.
               */
              /*
               * Encoge cuando el mapa se queda en una franja. Con el panel en lectura, al mapa le
               * quedan un par de centímetros de alto y una cara de 132 px se come la mitad de lo
               * poco que hay. No se pliega sola —eso sería pelearse con lo que el usuario pidió—
               * pero ocupa lo que corresponde a lo que queda.
               */
              ancho && alto <= 0.6
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
        {/* Apartarla. Solo sobre el mapa: en el centro ella ES la pantalla y no hay nada que tapar. */}
        {enTrabajo && (
          <button
            type="button"
            onClick={() => plegarCara(true)}
            className="absolute -right-1.5 -top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/80 text-[11px] leading-none text-[#9FB0B8] backdrop-blur-md transition-colors hover:text-white cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFAE3B]"
            aria-label="Plegar la cara y dejar el mapa libre"
            title="Plegar la cara"
          >
            −
          </button>
        )}
        {/* Encogida sobre el mapa, la cara necesita marco: si no, es un rectángulo negro pegado. */}
        {/*
          `relative` no es decorativo: el lienzo de la cara es `absolute inset-0` y sin esto se
          posicionaba contra el div de FUERA, que no tiene el borde. La cara quedaba un píxel
          arriba y a la izquierda de su propio marco.
        */}
        <div
          className="relative w-full h-full pointer-events-none overflow-hidden transition-all duration-500 sin-seleccion"
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
