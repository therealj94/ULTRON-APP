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
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FaceCanvas } from '../src/02-cara';
import type { FaceState, Mode } from '../src/types';
import type { Emocion } from '../lib/emocion';
import { guardarCatastro, type CapaExtra, type Fondo, type Motor, type OrdenMapa, type RasterEncendido, type Tocado } from './mapa/captura';
import { Tarjeta } from './mapa/Tarjeta';
import { IndiceCapas, type OrdenIndice } from './mapa/IndiceCapas';

/** Lo que Dr Electrum puede accionar en pantalla (server/electrum/manos-pantalla.ts). Ni salir ni el micrófono. */
const COMANDOS_DEL_CEREBRO = new Set(['fondo', 'tresD', 'pais', 'norte', 'cenital', 'inclinar', 'orbitar', 'ubicacion', 'zoom', 'rotar', 'mover', 'abrir', 'ficha', 'mesa', 'silencio', 'reparto', 'pantalla', 'cerrar']);
import type { MuestrasEncendidas, PedidoCapas } from './mapa/captura';
import { Tablero } from './mapa/Tablero';
import { Recorrido, prepararRecorrido, salirPantallaCompleta, entrarPantallaCompleta, type Controles, type ModoRecorrido } from './demo/Recorrido';
import { Preguntas } from './demo/Preguntas';
import { BotonOido, type ModoOido } from './panel/BotonOido';
import { AirTouch, BotonManos, type EstadoManos } from './manos/AirTouch';
import { capturaActiva, type EstadoOido } from './panel/oido';
import { crearOidoElectrum } from './panel/oidoTurbo';
import { comandoDe, comandoDeLaya, nombreDeComando, type Comando } from './panel/comandos';
import { bajarParaOir, callar, dichosVoz, escucharEscena, hablandoVoz, hablanteActual, hablar, interrumpirVoz, nivelVoz, pausarParaOir, reanudarVoz, seguirTrasOir, silenciar, suena } from './panel/voz';
import { Retratos } from './personajes/Retratos';
import { BotonInterrumpir, BotonMesa, BotonVoces } from './panel/BotonesVoz';
import { abrirMesa } from './personajes/mesa';
import { pedidoDeFiltro, pedidoDeLugar } from '../lib/pedidos-mapa';
import { EMOCION_DE, expresionDeLinea, reaccionA } from './personajes/expresion';

/** La boca de la cara principal: en un diálogo, solo cuando habla Dr Electrum (los demás tienen su cara). */
const labioDeElectrum = () => {
  const h = hablanteActual();
  return h && h !== 'electrum' ? 0 : nivelVoz();
};
import { Bienvenida, bienvenidaApagada } from './demo/Bienvenida';
import type { PedidoPanel, VistaPanel } from './panel/Panel';
import { Panel } from './panel/Panel';
import { Barra } from './panel/Barra';
import { Entrar } from './Entrar';
import { guardarSesion, hayCredencial, headersElectrum, porQueNoAbre, puertaAbierta, salir, type Puerta } from './acceso';
import { AVISO_ENTRADA, fijarInvitado } from './sesion-invitado';
import { PonerClave, enlaceEnLaUrl, faltaPara, quitarEnlaceDeLaUrl, solicitudesPendientes, type EnlaceUrl } from '../src/cuentas/Cuentas';
import { Cuenta, TEMA_ELECTRUM } from './Cuenta';
import {
  ALTO_COMPACTO_PX,
  ALTO_MAX,
  ALTO_MIN,
  ALTURAS,
  guardarPreferencia,
  leerPreferencia,
  repartoDe,
  siguienteReparto,
} from './preferencias';

/*
 * EL MAPA, EN SU PROPIO TROZO.
 *
 * MapLibre son tres cuartas partes del JavaScript de Electrum. Cargado con todo lo demás, la
 * pantalla de entrada y la cara esperaban a que bajara el motor de mapas entero antes de enseñarse.
 * Ahora se pide cuando se monta la estación, en paralelo con la cara, y la pantalla de entrada ni
 * lo toca. La foto para el informe y los tipos viven en `mapa/captura.ts` para no arrastrarlo.
 */
const Mapa = lazy(() => import('./mapa/Mapa').then((m) => ({ default: m.Mapa })));

/**
 * Si el trozo del mapa no baja —el wifi se cae justo al entrar, o un redespliegue cambió los nombres
 * de los archivos mientras la pestaña estaba abierta—, `lazy` lanza y, sin esto, React desmonta la
 * estación entera: pantalla negra. Se queda sin mapa, lo dice, y la conversación sigue funcionando.
 */
class SinMapa extends React.Component<{ children: ReactNode }, { fallo: boolean }> {
  // El proyecto no trae @types/react (igual que la sala de AU-RA): se declara a mano lo que se usa.
  declare readonly props: { children: ReactNode };
  state = { fallo: false };
  static getDerivedStateFromError() {
    return { fallo: true };
  }
  render() {
    if (!this.state.fallo) return this.props.children;
    return (
      <div className="absolute inset-0 grid place-items-center bg-[#0B0D0F] p-6 text-center" role="alert">
        <div className="max-w-sm space-y-3">
          <p className="text-sm leading-relaxed text-[#8FA3B0]">No pude cargar el mapa. La conversación sigue funcionando; para el mapa, recargá la página.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-white/15 px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase text-[#9FB0B8] hover:border-white/30 hover:text-white cursor-pointer"
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}

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
  /**
   * Lo que trae la dirección desde un correo (poner clave, activar la cuenta, revisar solicitudes).
   * Se lee una vez y se borra de la barra enseguida: el enlace no se queda en el historial.
   */
  const [enlace, setEnlace] = useState<EnlaceUrl>(() => {
    const e = enlaceEnLaUrl();
    if (e) quitarEnlaceDeLaUrl();
    return e;
  });
  const [modoEntrada, setModoEntrada] = useState<'correo' | 'olvide'>('correo');
  /** Solicitudes de acceso esperando; null si esta sesión no es la de quien aprueba. */
  const [pendientes, setPendientes] = useState<number | null>(null);
  const [cuenta, setCuenta] = useState<null | 'clave' | 'solicitudes'>(null);
  /**
   * Acceso temporal (código): cuándo vence. La pantalla cuenta hacia atrás y, al llegar, cierra la
   * sesión y vuelve a la entrada con el aviso. El servidor ya lo rechaza desde ese segundo; esto es
   * para que la persona lo vea en vez de encontrarse errores.
   */
  const [vence, setVence] = useState<string | null>(null);
  /** Quién entró: para saludarlo por su nombre y recordar sus preferencias de bienvenida. */
  const [usuario, setUsuario] = useState<{ nombre: string; correo: string; invitado: boolean } | null>(null);
  // El aviso de «tu acceso temporal terminó» llega después de recargar la página (ver `cerrar`, abajo).
  const [avisoEntrada, setAvisoEntrada] = useState(() => {
    try {
      const a = sessionStorage.getItem(AVISO_ENTRADA) || '';
      sessionStorage.removeItem(AVISO_ENTRADA);
      return a;
    } catch {
      return '';
    }
  });
  const [, setTic] = useState(0);
  useEffect(() => {
    if (puerta !== 'abierta') {
      setUsuario(null);
      return setVence(null);
    }
    let vivo = true;
    fetch('/api/ultron/sesion', { headers: headersElectrum() })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        setVence(j?.user?.vence || null);
        fijarInvitado(j?.user?.invitado === true);
        setUsuario(j?.user?.correo ? { nombre: String(j.user.nombre || ''), correo: String(j.user.correo), invitado: j.user.invitado === true } : null);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [puerta]);
  useEffect(() => {
    if (!vence) return;
    const fin = new Date(vence).getTime();
    let cerrado = false;
    /*
     * Al vencer, el acceso se termina del todo: el servidor ya rechaza el token (y el mismo código no
     * vuelve a entrar), y aquí se borra lo que quedó en este aparato —la conversación, la credencial—
     * y se recarga la página, para que no quede en memoria nada de lo que se vio (mapas, fichas,
     * informes). El aviso se muestra en la entrada después de recargar.
     */
    const cerrar = () => {
      if (cerrado) return;
      cerrado = true;
      const aviso = 'Tu acceso temporal terminó y se cerró en este aparato. El mismo código ya no vale: para seguir, pida un código nuevo o solicite una cuenta.';
      try {
        sessionStorage.removeItem('electrum.hilo');
        sessionStorage.setItem(AVISO_ENTRADA, aviso);
      } catch {
        /* sin almacenamiento no hay nada que quitar */
      }
      void fetch('/api/electrum/hilo', { method: 'DELETE', headers: headersElectrum(), keepalive: true }).catch(() => {});
      salir();
      setVence(null);
      setAvisoEntrada(aviso);
      setPuerta('cerrada');
      try {
        window.location.reload();
      } catch {
        /* sin recarga, al menos la puerta ya está cerrada */
      }
    };
    if (fin <= Date.now()) return cerrar();
    // Un temporizador se atrasa con la pestaña de fondo o el equipo dormido: se mira también el reloj
    // cada 30 s y al volver a la pestaña.
    const mirar = () => {
      if (Date.now() >= fin) cerrar();
    };
    const t = setTimeout(cerrar, Math.min(fin - Date.now(), 2_147_000_000));
    const tic = setInterval(() => {
      setTic((n) => n + 1);
      mirar();
    }, 30_000);
    document.addEventListener('visibilitychange', mirar);
    window.addEventListener('focus', mirar);
    return () => {
      clearTimeout(t);
      clearInterval(tic);
      document.removeEventListener('visibilitychange', mirar);
      window.removeEventListener('focus', mirar);
    };
  }, [vence]);
  useEffect(() => {
    if (puerta !== 'abierta') return setPendientes(null);
    let vivo = true;
    void solicitudesPendientes(headersElectrum()).then((n) => {
      if (!vivo) return;
      setPendientes(n);
      if (n !== null && enlace?.tipo === 'solicitudes') {
        setCuenta('solicitudes');
        setEnlace(null);
      }
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puerta]);
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
  /** El índice de capas abierto ocupa la esquina de la cara: mientras está abierto, la cara se aparta. */
  const [indiceAbierto, setIndiceAbierto] = useState(false);
  useEffect(() => {
    const f = (e: Event) => setIndiceAbierto(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener('electrum:indice-abierto', f);
    return () => window.removeEventListener('electrum:indice-abierto', f);
  }, []);
  const plegarCara = useCallback((v: boolean) => {
    setCaraPlegada(v);
    guardarPreferencia('caraPlegada', v);
  }, []);
  const [face, setFace] = useState<FaceState>('IDLE');
  const [emocion, setEmocion] = useState<Emocion>('neutral');
  // Lo que dejó el filtro por mineral, dicho en voz cuando lo pidió la persona (no el cerebro).
  useEffect(() => {
    const alFiltrar = (e: Event) => {
      const d = (e as CustomEvent<{ mineral: string | null; n: number; etiqueta?: string }>).detail;
      if (!filtroHablado.current || !d) return;
      filtroHablado.current = false;
      if (!d.mineral) return void hablar('Listo, otra vez todas las concesiones.', 'neutral', headersElectrum());
      const clase = d.mineral === 'metalicas' || d.mineral === 'no metalicas';
      void hablar(
        d.n
          ? `Marqué ${d.n} ${clase ? `concesiones ${d.mineral.replace('metalicas', 'metálicas')}` : `concesiones con indicios de ${d.mineral}`}.${clase ? '' : ' El catastro no guarda el mineral: son las que tienen un yacimiento u ocurrencia registrada dentro o a menos de un kilómetro.'}`
          : `No encontré concesiones con indicios de ${d.mineral} registrados.`,
        'neutral',
        headersElectrum()
      );
    };
    window.addEventListener('electrum:filtrado', alFiltrar);
    return () => window.removeEventListener('electrum:filtrado', alFiltrar);
  }, []);
  // En un diálogo la cara principal también actúa: pone la expresión de la línea que dice Dr
  // Electrum y, mientras otro habla, le devuelve la emoción a medias (como los retratos).
  useEffect(
    () =>
      escucharEscena((e) => {
        if (!e.participantes || !e.hablante) return;
        const x = expresionDeLinea(e.linea);
        setEmocion(EMOCION_DE[e.hablante === 'electrum' ? x : reaccionA(x)]);
      }),
    []
  );
  const [mode, setMode] = useState<Mode>('MINING');
  const [motor, setMotor] = useState<Motor>('maplibre');
  const [fondo, setFondo] = useState<Fondo>('satelite');
  const [orden, setOrden] = useState<OrdenMapa | null>(null);
  const [panel, setPanel] = useState<VistaPanel>('chat');
  /*
   * EL MAPA SE TOCA. Lo tocado abre su tarjeta; las capas encendidas se pintan debajo del catastro;
   * y desde la tarjeta se le puede pedir algo a Dr Electrum, que llega al panel como si se hubiera
   * escrito ahí.
   */
  const [tocado, setTocado] = useState<Tocado | null>(null);
  const [extras, setExtras] = useState<CapaExtra[]>([]);
  /** Mapas escaneados encendidos (JICA…), con su transparencia. */
  const [rasters, setRasters] = useState<RasterEncendido[]>([]);
  const [muestras, setMuestras] = useState<MuestrasEncendidas | null>(null);
  const [traslapes, setTraslapes] = useState<unknown | null>(null);
  /** Apagadas al abrir: el mapa arranca solo con el perímetro de Honduras, y lo demás se pide en el índice. */
  const [curvas, setCurvas] = useState(false);
  /** Lo último que se pidió de palabra sobre las capas («muéstrame los ríos»); lo resuelve el índice de capas. */
  const [pedidoCapas, setPedidoCapas] = useState<PedidoCapas | null>(null);
  const pedirCapas = useCallback((p: Omit<PedidoCapas, 'n'>) => setPedidoCapas({ ...p, n: Date.now() + Math.random() }), []);
  /** Lo que mandó Dr Electrum al índice de capas (encender, filtrar, apagar…): lo hace el índice con sus casillas. */
  const [ordenesIndice, setOrdenesIndice] = useState<{ n: number; lista: OrdenIndice[] } | null>(null);
  // Solo se dice en voz alta cuando no se pudo: lo que sí se hizo se ve en el mapa.
  const alResponderCapas = useCallback((texto: string, ok: boolean) => {
    if (!ok) void hablar(texto, 'neutral', headersElectrum());
  }, []);
  const [prospectividad, setProspectividad] = useState(false);
  /** El índice de capas: al abrir solo se ve el perímetro de Honduras; el catastro es la capa 104001 y se enciende. */
  const [perimetro, setPerimetro] = useState<unknown | null>(null);
  const [catastroVista, setCatastroVista] = useState<{ visible: boolean; filtro: unknown[] | null }>({ visible: false, filtro: null });
  /** El recorrido enseña el catastro aunque esté apagado en el índice; al terminar vuelve como estaba. */
  const [catastroRecorrido, setCatastroRecorrido] = useState<boolean | null>(null);
  const encuadrarRaster = useCallback((encuadre: [number, number, number, number]) => setOrden({ accion: 'encuadrar', encuadre, ms: 1600 }), []);
  const [pedidoPanel, setPedidoPanel] = useState<PedidoPanel | null>(null);
  const nPedido = useRef(0);
  const cerrarTarjeta = useCallback(() => setTocado(null), []);
  // Una herramienta del mapa (medir, perfil, área) ocupa el rincón de la ficha: la cierra al empezar.
  useEffect(() => {
    const cerrar = () => setTocado(null);
    window.addEventListener('electrum:herramienta', cerrar);
    return () => window.removeEventListener('electrum:herramienta', cerrar);
  }, []);
  /*
   * LO QUE SE ENSEÑA EN UNA DEMO: el tablero nacional, el terreno en 3D y el recorrido guiado.
   */
  const [tresD, setTresD] = useState(false);
  const [tableroAbierto, setTableroAbierto] = useState(false);
  const [recorrido, setRecorrido] = useState(false);
  const [modoRecorrido, setModoRecorrido] = useState<ModoRecorrido>('etapa1');
  /**
   * La bienvenida sale una vez por visita, con la cara en el centro, salvo que esa persona haya
   * pedido no verla más. Se cierra al elegir, al saltar, o si alguien se pone a trabajar antes.
   */
  const [bienvenidaVista, setBienvenidaVista] = useState(false);
  const cerrarTablero = useCallback(() => setTableroAbierto(false), []);
  /** Al terminar el recorrido por sí solo: «¿Tiene alguna pregunta?». */
  const [preguntas, setPreguntas] = useState(false);
  const terminarRecorrido = useCallback((natural: boolean) => {
    setRecorrido(false);
    if (natural) setPreguntas(true);
    else salirPantallaCompleta();
  }, []);
  /** El visor del mapa durante el recorrido: esquinas y nombre sobre lo que se muestra. */
  const [enfoque, setEnfoque] = useState<{ encuadre: [number, number, number, number]; etiqueta?: string } | null>(null);
  /** Dónde está quien usa la app (si dio permiso): un punto en el mapa y «¿dónde estoy?». */
  const [yo, setYo] = useState<[number, number] | null>(null);
  /** Ir a una concesión desde el tablero: se cierra, el mapa vuela y se abre su ficha. */
  const irAConcesion = useCallback(async (id: number) => {
    setTableroAbierto(false);
    try {
      const r = await fetch(`/api/electrum/mapa/concesion/${id}`, { headers: headersElectrum() });
      const f = await r.json().catch(() => null);
      if (r.ok && f?.geojson && f?.encuadre) {
        setOrden({ accion: 'volar', geojson: f.geojson, encuadre: f.encuadre });
        setTocado({ tipo: 'concesion', id, nombre: f.nombre, lngLat: [(f.encuadre[0] + f.encuadre[2]) / 2, (f.encuadre[1] + f.encuadre[3]) / 2] });
      }
    } catch {
      /* sin red: el tablero ya se cerró y el mapa se queda donde estaba */
    }
  }, []);
  /*
   * Lo que el recorrido maneja, y cómo estaba todo antes de empezar: al terminar deja las capas, el
   * fondo y el reparto de la pantalla como los tenía quien lo lanzó (el 3D se queda puesto).
   * `alto` va con `setAlto` y no con `cambiarAlto`: agrandar el mapa para la demo no es una preferencia.
   */
  const estadoRef = useRef({ fondo, alto, rasters, muestras, extras, prospectividad, catastro: false });
  estadoRef.current = { fondo, alto, rasters, muestras, extras, prospectividad, catastro: catastroVista.visible };
  const controlesRecorrido = useMemo<Controles>(
    () => ({
      orden: setOrden,
      maplibre: () => setMotor('maplibre'),
      tresD: setTresD,
      tocar: setTocado,
      capas: setExtras,
      cara: (f) => setFace(f),
      rasters: setRasters,
      muestras: setMuestras,
      prospectividad: setProspectividad,
      catastro: (v: boolean) => setCatastroRecorrido(v === estadoRef.current.catastro ? null : v),
      fondo: setFondo,
      alto: setAlto,
      estado: () => estadoRef.current,
      trabajo: () => setEscenario('trabajo'),
      enfocar: setEnfoque,
      visor: (f) => window.dispatchEvent(new CustomEvent('electrum:visor', { detail: f })),
      indice: (lista) => setOrdenesIndice({ n: Date.now() + Math.random(), lista }),
    }),
    []
  );
  const pedirAlPanel = useCallback((p: Omit<PedidoPanel, 'n'>) => {
    nPedido.current += 1;
    setPanel('chat');
    setPedidoPanel({ ...p, n: nPedido.current } as PedidoPanel);
  }, []);
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
  const elegirPanel = useCallback((p: VistaPanel) => {
    setPanel(p);
    setEscenario('trabajo');
  }, []);
  useEffect(() => {
    if (orden) alTrabajo();
  }, [orden, alTrabajo]);

  /*
   * EL OÍDO SIEMPRE ABIERTO Y LOS COMANDOS DE VOZ.
   *
   * Al entrar se piden el micrófono y la ubicación (el navegador pregunta una vez). Con el
   * micrófono abierto, cada frase se pasa a texto y se decide qué es: un comando para la pantalla
   * («acércate», «siguiente», «cierra la ventana») se hace en el acto; si alguien tiene la palabra
   * (el cierre del recorrido preguntando) le llega a él; lo demás es una pregunta para Dr Electrum.
   */
  /** Air touch: se enciende a pedido (la cámara no se pide sola) y se recuerda para la próxima vez. */
  const [manos, setManosCrudo] = useState<boolean>(() => leerPreferencia<boolean>('manos', false, (v) => typeof v === 'boolean'));
  const [estadoManos, setEstadoManos] = useState<EstadoManos>('apagado');
  const setManos = useCallback((v: boolean) => {
    setManosCrudo(v);
    guardarPreferencia('manos', v);
  }, []);
  const [modoOido, setModoOido] = useState<ModoOido>(() => leerPreferencia<ModoOido>('oido', 'siempre', (v) => v === 'siempre' || v === 'tocar'));
  // Hablarle encima lo interrumpe (como en una llamada). Se puede apagar: entonces termina lo que dice.
  const [interrumpible, setInterrumpibleCrudo] = useState<boolean>(() => leerPreferencia<boolean>('interrumpir', true, (v) => typeof v === 'boolean'));
  const interrumpibleRef = useRef(interrumpible);
  interrumpibleRef.current = interrumpible;
  const setInterrumpible = useCallback((v: boolean) => {
    setInterrumpibleCrudo(v);
    guardarPreferencia('interrumpir', v);
  }, []);
  /** El filtro por mineral lo pidió la persona con un comando (no el cerebro): se confirma en voz. */
  const filtroHablado = useRef(false);
  const [estadoOido, setEstadoOido] = useState<EstadoOido>('apagado');
  const [oidoUltimo, setOidoUltimo] = useState('');
  const unaFrase = useRef(false);
  const recorridoRef = useRef(recorrido);
  recorridoRef.current = recorrido;
  const yoRef = useRef(yo);
  yoRef.current = yo;

  const ejecutarComando = useCallback(
    (cmd: Comando) => {
      const mapa = (detalle: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('electrum:mapa', { detail: detalle }));
      switch (cmd.accion) {
        case 'siguiente':
          window.dispatchEvent(new CustomEvent('electrum:recorrido', { detail: 'siguiente' }));
          break;
        case 'detener':
          if (recorridoRef.current) terminarRecorrido(false);
          setPreguntas(false);
          callar();
          break;
        case 'callar':
          callar();
          break;
        case 'mesa':
          abrirMesa(cmd.abrir);
          if (cmd.abrir) void hablar('[warmly] La mesa está lista: Don Chema, la ingeniera Tatiana y yo. ¿Qué analizamos?', 'neutral', headersElectrum());
          break;
        case 'silencio':
          silenciar(cmd.activar);
          break;
        case 'interrumpir':
          setInterrumpible(cmd.activar);
          break;
        case 'cerrar':
          // Como lo cerraría una persona: Escape cierra el visor, el timelapse y la ficha.
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          setTocado(null);
          setTableroAbierto(false);
          break;
        case 'zoom':
          setEscenario('trabajo');
          mapa({ accion: 'zoom', dir: cmd.dir });
          break;
        case 'reparto':
          setEscenario('trabajo');
          cambiarAlto(cmd.alto === 'mapa' ? ALTURAS.mapa : cmd.alto === 'chat' ? ALTURAS.lectura : ALTURAS.dividido);
          break;
        case 'pantalla':
          if (cmd.entrar) entrarPantallaCompleta();
          else salirPantallaCompleta();
          break;
        case 'abrir':
          if (cmd.que === 'tablero') setTableroAbierto(true);
          else if (cmd.que === 'capas') {
            setEscenario('trabajo');
            (document.querySelector('[data-tour="capas"]') as HTMLElement | null)?.click();
          } else if (cmd.que === 'recorrido') {
            setModoRecorrido('etapa1');
            setEscenario('trabajo');
            setRecorrido(true);
          } else elegirPanel(cmd.que === 'consulta' ? 'chat' : cmd.que === 'expedientes' ? 'expedientes' : 'infra');
          break;
        case 'tresD':
          setEscenario('trabajo');
          setTresD(cmd.activar);
          break;
        case 'manos':
          setManos(cmd.activar);
          break;
        case 'ubicacion':
          setEscenario('trabajo');
          if (yoRef.current) mapa({ accion: 'ir', centro: yoRef.current, zoom: 12 });
          else pedirUbicacion(true);
          break;
        case 'mover':
          setEscenario('trabajo');
          mapa({ accion: 'mover', dir: cmd.dir });
          break;
        case 'rotar':
          setEscenario('trabajo');
          mapa({ accion: 'rotar', grados: 30 * cmd.dir });
          break;
        case 'norte':
        case 'inclinar':
        case 'cenital':
        case 'orbitar':
        case 'pais':
          setEscenario('trabajo');
          mapa({ accion: cmd.accion });
          break;
        case 'fondo':
          setFondo(cmd.cual);
          break;
        case 'capas':
          setEscenario('trabajo');
          pedirCapas({ mostrar: cmd.mostrar, que: cmd.que, solo: cmd.solo });
          break;
        case 'dialogo':
          window.dispatchEvent(new Event('electrum:dialogo'));
          break;
        case 'ficha': {
          // Lo mismo que tocar el botón de la ficha abierta. Sin ficha abierta, se dice qué hacer.
          const boton = { pdf: 'btn-pdf', geologico: 'btn-geologicos', timelapse: 'btn-timelapse', analizar: 'btn-analizar' }[cmd.que];
          const el = document.querySelector(`[data-tour="${boton}"]`) as HTMLElement | null;
          if (el) el.click();
          else void hablar('Primero abra una concesión: tóquela en el mapa o dígame su nombre, y lo hago.', 'neutral', headersElectrum());
          break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terminarRecorrido, cambiarAlto, elegirPanel]
  );

  // alUi se arma una sola vez: llega a ejecutarComando por una referencia.
  const ejecutarRef = useRef(ejecutarComando);
  ejecutarRef.current = ejecutarComando;

  const enrutarDicho = useCallback(
    async (texto: string) => {
      setOidoUltimo(texto);
      const hacer = (c: Comando) => {
        // Lo que entendió, a la vista: «súbeme el mapa → Moviendo al norte».
        setOidoUltimo(`${texto} → ${nombreDeComando(c)}`);
        ejecutarComando(c);
      };
      const cmd = comandoDe(texto);
      if (cmd) return hacer(cmd);
      const captura = capturaActiva();
      if (captura && captura(texto) !== false) return;
      // «Muéstrame solo las de oro»: el mapa se queda con esas en el acto.
      const filtro = pedidoDeFiltro(texto);
      if (filtro) {
        filtroHablado.current = true;
        setOidoUltimo(`${texto} → ${filtro === 'quitar' ? 'Todas las concesiones' : `Solo ${filtro}`}`);
        setOrden({ accion: 'filtrar', mineral: filtro === 'quitar' ? null : filtro });
        return;
      }
      // «Llévame a Juticalpa»: el lugar (o la concesión con ese nombre), marcado en el mapa.
      const lugar = pedidoDeLugar(texto);
      if (lugar) {
        try {
          const r = await fetch(`/api/electrum/lugar?q=${encodeURIComponent(lugar)}`, { headers: headersElectrum(), signal: AbortSignal.timeout(5000) });
          const j: any = r.ok ? await r.json() : null;
          if (j?.ok && j.tipo === 'lugar' && j.lugar) {
            const l = j.lugar;
            setOidoUltimo(`${texto} → ${l.nombre}`);
            setOrden({ accion: 'lugar', centro: l.centro, zoom: l.zoom, nombre: l.nombre, detalle: [l.tipo, l.departamento].filter(Boolean).join(' · ') || undefined });
            const de = l.departamento && !String(l.nombre).includes(l.departamento) ? ` de ${l.departamento}` : '';
            void hablar(`Aquí está ${l.nombre}${l.tipo ? `, ${l.tipo}${de}` : ''}.`, 'neutral', headersElectrum());
            return;
          }
          if (j?.ok && j.tipo === 'concesion' && j.ui?.geojson) {
            setOidoUltimo(`${texto} → ${j.ui.nombre}`);
            setOrden({ accion: 'volar', geojson: j.ui.geojson, encuadre: j.ui.encuadre, centro: j.ui.centro });
            setTocado({ tipo: 'concesion', id: Number(j.ui.concesion_id), nombre: j.ui.nombre, lngLat: j.ui.centro });
            return;
          }
        } catch {
          /* sin respuesta: sigue como pregunta */
        }
      }
      const palabras = texto.trim().split(/\s+/).length;
      /*
       * LAYA: la orden dicha de otra manera («súbeme un poquito el mapa», «ponlo de ladito»). Las
       * reglas de arriba son instantáneas pero rígidas; el modelo «comando» del nodo entiende la
       * intención en ~100 ms. Si no está, tarda o duda, la frase sigue como pregunta.
       */
      if (palabras <= 14) {
        try {
          const r = await fetch('/api/electrum/comando', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headersElectrum() },
            body: JSON.stringify({ texto }),
            signal: AbortSignal.timeout(1800),
          });
          const j = r.ok ? await r.json() : null;
          const c2 = comandoDeLaya(j?.id);
          if (c2) return hacer(c2);
        } catch {
          /* sin Laya: sigue como pregunta */
        }
      }
      // En pleno recorrido solo mandan los comandos: una charla de fondo no lo interrumpe.
      if (recorridoRef.current) return;
      // Menos de dos palabras sueltas no es una pregunta (un «eh», un «ajá» de otra conversación).
      if (palabras < 2) return;
      setEscenario('trabajo');
      pedirAlPanel({ tipo: 'pregunta', texto });
    },
    [ejecutarComando, pedirAlPanel]
  );
  const enrutarRef = useRef(enrutarDicho);
  enrutarRef.current = enrutarDicho;

  /*
   * EL OÍDO, COMO EL DE AU-RA (panel/oidoTurbo.ts): en vivo con Turbo si se puede, y si no el de siempre
   * (una frase en WAV por vez). Hablarle encima ya no lo corta por la energía sola: la voz se pausa (o baja)
   * enseguida y lo que se oyó decide. Su eco o un «ajá» → sigue donde estaba; la persona → se calla,
   * anota lo que ella alcanzó a oír (va con la pregunta siguiente) y lo dicho entra como siempre.
   */
  const oido = useMemo(
    () =>
      crearOidoElectrum({
        alTexto: (t) => {
          if (unaFrase.current) {
            unaFrase.current = false;
            oidoRef.current?.detener();
          }
          void enrutarRef.current(t);
        },
        alEstado: setEstadoOido,
        suena,
        hablando: hablandoVoz,
        dichos: dichosVoz,
        nivelSalida: nivelVoz,
        interrumpible: () => interrumpibleRef.current,
        alDudar: (como) => {
          if (como === 'pausa') pausarParaOir();
          else bajarParaOir();
        },
        alSeguir: seguirTrasOir,
        // Hablarle encima lo calla (bajando) y lo pone a escuchar, como en una conversación de verdad.
        alInterrumpir: () => {
          interrumpirVoz();
          window.dispatchEvent(new Event('electrum:interrumpido'));
        },
        // Una orden de pantalla dicha encima («siguiente», «para») corta aunque sea una sola palabra.
        esOrden: (t) => !!comandoDe(t),
      }),
    []
  );
  const oidoRef = useRef(oido);

  const pedirUbicacion = useCallback((volar = false) => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const punto: [number, number] = [p.coords.longitude, p.coords.latitude];
        setYo(punto);
        if (volar) window.dispatchEvent(new CustomEvent('electrum:mapa', { detail: { accion: 'ir', centro: punto, zoom: 12 } }));
      },
      () => undefined,
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 10 * 60_000 }
    );
  }, []);

  // Al entrar: micrófono (si está en «siempre») y ubicación. El navegador pregunta una sola vez.
  useEffect(() => {
    if (puerta !== 'abierta' || !usuario) return;
    if (modoOido === 'siempre') void oido.iniciar();
    pedirUbicacion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puerta, usuario]);
  // Apagar al salir.
  useEffect(() => () => oido.detener(), [oido]);
  // Salir no desmonta la app (vuelve la pantalla de entrada): el micrófono se apaga igual.
  useEffect(() => {
    if (puerta !== 'abierta') oido.detener();
  }, [puerta, oido]);
  // Un toque en cualquier lado despierta el audio que el navegador dejó en pausa.
  useEffect(() => {
    const t = () => {
      oido.reanudar();
      reanudarVoz();
    };
    window.addEventListener('pointerdown', t);
    return () => window.removeEventListener('pointerdown', t);
  }, [oido]);

  const cambiarModoOido = useCallback(
    (m: ModoOido) => {
      setModoOido(m);
      guardarPreferencia('oido', m);
      unaFrase.current = false;
      if (m === 'siempre') void oido.iniciar();
      else oido.detener();
    },
    [oido]
  );
  const tocarOido = useCallback(() => {
    if (modoOido === 'siempre') {
      // Sin permiso todavía: volver a pedirlo con el toque.
      if (oido.estado() === 'sin-permiso' || oido.estado() === 'apagado') void oido.iniciar();
      return;
    }
    unaFrase.current = true;
    void oido.iniciar();
  }, [modoOido, oido]);


  /** Las herramientas devuelven `ui`; aquí se traduce a órdenes para el mapa. */
  const alUi = useCallback((datos: Array<Record<string, unknown>>) => {
    for (const d of datos) {
      if (d.accion === 'volar' && d.geojson) {
        setOrden({ accion: 'volar', geojson: d.geojson as any, encuadre: d.encuadre as any, centro: d.centro as any });
        // De la que se habla, su ficha abierta: lo que tiene y lo que se puede hacer con ella.
        const id = Number(d.concesion_id);
        if (Number.isSafeInteger(id) && id > 0) {
          const c = (d.centro as [number, number] | undefined) || [0, 0];
          setTocado({ tipo: 'concesion', id, nombre: typeof d.nombre === 'string' ? d.nombre : undefined, lngLat: c });
        }
      } else if (d.accion === 'lugar' && Array.isArray(d.centro)) {
        setOrden({ accion: 'lugar', centro: d.centro as [number, number], zoom: Number(d.zoom) || 12, nombre: String(d.nombre || ''), detalle: [d.tipo, d.departamento].filter(Boolean).join(' · ') || undefined });
      } else if (d.accion === 'filtrar') {
        setOrden({ accion: 'filtrar', mineral: typeof d.mineral === 'string' ? d.mineral : null });
        // Filtrar el catastro con el catastro apagado no muestra nada: se enciende en el índice.
        if (d.mineral) pedirCapas({ mostrar: true, que: 'catastro' });
      } else if (d.accion === 'capa' && d.geojson) {
        setOrden({ accion: 'capa', geojson: d.geojson as any, encuadre: d.encuadre as any });
      } else if (d.accion === 'comando' && d.comando && typeof d.comando === 'object') {
        // La mano «pantalla» de Dr Electrum: los mismos controles que la voz (fondo, 3D, paneles, ficha…).
        const c = d.comando as Comando;
        if (COMANDOS_DEL_CEREBRO.has(c.accion)) ejecutarRef.current?.(c);
      } else if (d.accion === 'indice' && Array.isArray(d.ordenes)) {
        setOrdenesIndice({ n: Date.now() + Math.random(), lista: d.ordenes as OrdenIndice[] });
      } else if (d.accion === 'capas' && typeof d.que === 'string') {
        pedirCapas({ mostrar: d.mostrar !== false, que: d.que, solo: d.solo === true });
      } else if (d.accion === 'candidatas' && d.geojson) {
        setOrden({ accion: 'candidatas', geojson: d.geojson as any, encuadre: d.encuadre as any });
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
        casco
        leerLabio={labioDeElectrum}
        onFaceChange={(f) => setFace(f)}
        onModeChange={(m) => setMode(m)}
      />
    ),
    [face, mode, emocion, escenario]
  );

  const enTrabajo = escenario === 'trabajo';
  /** Sin usuario propio (código temporal, o la llave de la demo) se mira todo pero no se baja nada. */
  const invitado = !usuario || usuario.invitado;
  const mostrarBienvenida = !enTrabajo && !bienvenidaVista && !recorrido && !!usuario && !bienvenidaApagada(usuario.correo);
  // Si se pone a trabajar por su cuenta (toca la cara, pregunta), la bienvenida ya no sale.
  useEffect(() => {
    if (enTrabajo) setBienvenidaVista(true);
  }, [enTrabajo]);

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
        if (j?.geojson?.features?.length) {
          guardarCatastro(j.geojson);
          setOrden({ accion: 'capa', geojson: j.geojson, encuadre: j.encuadre || undefined });
        }
        if (j?.traslapes?.features?.length) setTraslapes(j.traslapes);
      } catch {
        /* sin catastro que pintar: el mapa se queda con su fondo, que es la verdad */
      }
    })();
  }, [enTrabajo, puerta]);

  if (enlace && enlace.tipo !== 'solicitudes') {
    return (
      <div className="fixed inset-0 bg-black text-[#E7EEF2] overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-[340px]">
            <div className="text-center mb-8 font-display font-bold tracking-[0.34em] text-lg" style={{ color: '#FFAE3B' }}>
              DR ELECTRUM FP
            </div>
            <PonerClave
              tema={TEMA_ELECTRUM}
              tipo={enlace.tipo}
              token={enlace.token}
              onListo={(t) => {
                guardarSesion(t);
                setEnlace(null);
                setPuerta('probando');
              }}
              onPedirOtro={() => {
                setEnlace(null);
                setModoEntrada('olvide');
                setPuerta('cerrada');
              }}
            />
          </div>
        </div>
      </div>
    );
  }

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
  if (puerta === 'cerrada') return <Entrar modoInicial={modoEntrada} aviso={avisoEntrada} onAbierta={() => { setAvisoEntrada(''); setPuerta('abierta'); }} />;

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
        onCuenta={() => setCuenta('clave')}
        pendientes={pendientes}
        extra={
          <>
            <BotonOido modo={modoOido} estado={estadoOido} nivel={oido.nivel} oido={oidoUltimo} onModo={cambiarModoOido} onTocar={tocarOido} />
            <BotonManos activo={manos} estado={estadoManos} onCambiar={() => setManos(!manos)} />
            <BotonVoces />
            {modoOido === 'siempre' && <BotonInterrumpir activo={interrumpible} onCambiar={setInterrumpible} />}
            <BotonMesa />
          </>
        }
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
          // El mapa termina donde empieza el panel, que nunca baja de ALTO_COMPACTO_PX.
          style={{ bottom: `max(${alto * 100}%, ${ALTO_COMPACTO_PX}px)` }}
        >
          <SinMapa>
          <Suspense
            fallback={
              <div className="absolute inset-0 grid place-items-center bg-[#0B0D0F]" role="status">
                <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#6C7F89]">cargando el mapa…</span>
              </div>
            }
          >
            <Mapa
              orden={orden}
              motor={motor}
              fondo={fondo}
              claveGoogle={claveGoogle}
              extras={extras}
              seleccion={tocado?.tipo === 'concesion' ? tocado.id : null}
              onTocar={setTocado}
              tresD={tresD && motor === 'maplibre'}
              rasters={motor === 'maplibre' ? rasters : []}
              muestras={motor === 'maplibre' ? muestras : null}
              traslapes={traslapes}
              curvas={curvas}
              perimetro={perimetro}
              catastro={catastroRecorrido == null ? catastroVista : { visible: catastroRecorrido, filtro: catastroVista.filtro }}
              prospectividad={prospectividad}
              visible={enTrabajo}
              enfoque={enfoque}
              yo={yo}
            />
          </Suspense>
          </SinMapa>
          <IndiceCapas
            onExtras={setExtras}
            onRasters={setRasters}
            onCatastro={setCatastroVista}
            onMuestras={setMuestras}
            onPerimetro={setPerimetro}
            onEncuadrar={encuadrarRaster}
            prospectividad={prospectividad}
            onProspectividad={setProspectividad}
            pedido={pedidoCapas}
            onRespuesta={alResponderCapas}
            ordenes={ordenesIndice}
          />
          {/* Arriba al centro del mapa: entre la cara (izquierda) y el control de zoom (derecha). */}
          <div className="absolute left-1/2 top-2.5 z-10 flex -translate-x-1/2 gap-1 rounded-full border border-white/12 bg-black/70 p-1 shadow-lg backdrop-blur-md" data-tour="barra-mapa">
            {[
              { k: 'tablero', icono: '▦', texto: 'Tablero', activo: tableroAbierto, alTocar: () => setTableroAbierto((v) => !v), titulo: 'Cifras del catastro nacional y conflictos con áreas protegidas, microcuencas y caseríos' },
              {
                k: '3d',
                icono: '⛰',
                texto: '3D',
                activo: tresD && motor === 'maplibre',
                alTocar: () => (motor === 'maplibre' ? setTresD((v) => !v) : setMotor('maplibre')),
                titulo: motor === 'maplibre' ? 'Terreno real en tres dimensiones' : 'El 3D es del motor MapLibre: toque para cambiar',
              },
              {
                k: 'recorrido',
                icono: recorrido ? '■' : '▶',
                texto: recorrido ? 'Detener' : 'Recorrido',
                activo: recorrido,
                alTocar: () => {
                  if (recorrido) return terminarRecorrido(false);
                  prepararRecorrido();
                  setPreguntas(false);
                  setModoRecorrido('etapa1');
                  setRecorrido(true);
                },
                titulo: 'Dr Electrum presenta la plataforma solo, con su voz',
              },
            ].map((b) => (
              <button
                key={b.k}
                type="button"
                onClick={b.alTocar}
                aria-pressed={b.activo}
                title={b.titulo}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] tracking-[0.1em] uppercase transition-colors cursor-pointer"
                style={b.activo ? { background: '#FFAE3B', color: '#000' } : { color: '#DCE5EA' }}
              >
                <span aria-hidden>{b.icono}</span>
                <span className="hidden sm:inline">{b.texto}</span>
              </button>
            ))}
          </div>

          <Tarjeta
            tocado={tocado}
            onCerrar={cerrarTarjeta}
            onVolar={setOrden}
            onTocar={setTocado}
            onPreguntar={(texto) => pedirAlPanel({ tipo: 'pregunta', texto })}
            onFicha={(id, presentarA) => pedirAlPanel({ tipo: 'ficha', id, presentarA })}
            invitado={invitado}
          />
          {/* El cuadro del recorrido vive DENTRO del mapa: se acomoda a él y no tapa la conversación. */}
          <Recorrido activo={recorrido} onTerminar={terminarRecorrido} controles={controlesRecorrido} fichaAbierta={!!tocado} modo={modoRecorrido} />
          <AirTouch activo={manos && puerta === 'abierta'} onEstado={setEstadoManos} />
          <Retratos enRecorrido={recorrido} />
          {preguntas && !recorrido && (
            <Preguntas
              cara={(f) => setFace(f)}
              onPreguntar={(texto) => pedirAlPanel({ tipo: 'pregunta', texto })}
              onOtro={(m) => {
                setPreguntas(false);
                setModoRecorrido(m);
                setRecorrido(true);
              }}
              onCerrar={() => {
                setPreguntas(false);
                salirPantallaCompleta();
              }}
            />
          )}
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
          pedido={pedidoPanel}
          invitado={invitado}
        />
      </div>

      {/* El tablero, a pantalla completa y por encima de todo. */}
      <Tablero abierto={tableroAbierto} onCerrar={cerrarTablero} onIr={irAConcesion} />

      {/*
        La cara. Un solo elemento que se mueve entre dos sitios: centro del escenario, o esquina.
        Mover el mismo nodo en vez de montar dos caras distintas es lo que hace que la transición
        se lea como que ELLA se aparta, y no como que una desaparece y otra aparece.
      */}
      {/*
        Plegada: una insignia con el estado, en el mismo sitio donde estaba la cara. Sigue diciendo
        que hay alguien del otro lado —y qué está haciendo— en una línea en vez de en un cuadrado.
      */}
      {enTrabajo && caraPlegada && panel === 'chat' && (
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
        inert={enTrabajo && (panel !== 'chat' || caraPlegada || indiceAbierto)}
        style={{
          /*
            En Expedientes el panel ocupa toda la altura y la cara se quedaba encima de la pestaña
            «Consulta», tapando justo el botón para volver. La cara se apoya en el mapa; cuando no
            hay mapa a la vista, no tiene dónde apoyarse y sobra. Se aparta en lugar de estorbar.
          */
          opacity: enTrabajo && (panel !== 'chat' || caraPlegada || indiceAbierto) ? 0 : 1,
          pointerEvents: enTrabajo && (panel !== 'chat' || caraPlegada || indiceAbierto) ? 'none' : 'auto',
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
            : mostrarBienvenida
              ? // Con la bienvenida abajo, la cara sube y se achica un poco: las opciones no la tapan.
                { left: '50%', top: '33%', width: 'min(64vmin, 440px)', height: 'min(64vmin, 440px)', transform: 'translate(-50%,-50%)', zIndex: 30 }
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

      {vence && (
        // En el teléfono va debajo de las pestañas del panel y a la derecha: centrado arriba tapaba
        // «Expedientes» e «Infra», y quien entra con un código no podía cambiar de pestaña.
        // En la barra de arriba, al medio (vacía en escritorio): más abajo tapaba Tablero/3D/Recorrido,
        // y en el teléfono el botón de alejar.
        <div className="pointer-events-none absolute right-[48px] top-[104px] sm:right-auto sm:left-1/2 sm:top-[14px] z-[45] sm:-translate-x-1/2 rounded-full border border-[#FFAE3B]/40 bg-black/75 px-2.5 py-0.5 sm:px-3 sm:py-1 font-mono text-[10px] sm:text-[11px] tracking-[0.1em] text-[#FFD08A] backdrop-blur" role="status">
          <span className="hidden sm:inline">ACCESO TEMPORAL · </span>VENCE EN {faltaPara(vence).toUpperCase()}
        </div>
      )}

      <Cuenta abierta={!!cuenta} inicio={cuenta || 'clave'} pendientes={pendientes} onPendientes={setPendientes} onCerrar={() => setCuenta(null)} />

      {mostrarBienvenida && usuario && (
        <Bienvenida
          usuario={usuario}
          cara={(f) => setFace(f)}
          onElegir={(m) => {
            setBienvenidaVista(true);
            prepararRecorrido();
            setModoRecorrido(m);
            setEscenario('trabajo');
            setRecorrido(true);
          }}
          onSaltar={() => {
            setBienvenidaVista(true);
            setEscenario('trabajo');
          }}
        />
      )}

      {/* Presentación, solo mientras la cara manda. */}
      <div
        className="absolute left-0 right-0 bottom-10 text-center transition-opacity duration-500 px-6"
        style={{ opacity: enTrabajo || mostrarBienvenida ? 0 : 1, pointerEvents: 'none' }}
      >
        <div className="font-display font-bold tracking-[0.34em] text-[#FFAE3B] text-lg">DR ELECTRUM FP</div>
        <div className="mt-1 font-mono text-[11px] tracking-[0.22em] uppercase text-[#FFAE3B]/50">
          geología · minas · civil · metalurgia · gis · ambiental · legal · economía
        </div>
      </div>
    </div>
  );
}
