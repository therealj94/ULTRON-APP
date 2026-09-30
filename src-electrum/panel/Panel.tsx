/**
 * El panel lateral: la consulta y los expedientes.
 *
 * Va al costado del mapa, no encima: lo que se pregunta y lo que se mira tienen que verse a la vez.
 * En teléfono se convierte en una lámina de abajo, porque a 400 px de ancho no caben dos columnas y
 * fingir que sí es peor que elegir.
 *
 * La traza de herramientas se muestra mientras trabaja. No es depuración: es lo que un ingeniero va
 * a exigir para creerle. «Consultó el catastro, midió sobre el elipsoide, encontró el traslape» vale
 * más que la respuesta sola.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  // Con alias: `PointerEvent` a secas taparía el del navegador, y el oyente que se cuelga de
  // `window` recibe el nativo, no el sintético de React. Dos tipos con el mismo nombre y distinta
  // forma es justo el enredo que se arregla nombrándolos.
  type KeyboardEvent as TeclaReact,
  type PointerEvent as PunteroReact,
} from 'react';
import { createPortal } from 'react-dom';
import type { FaceState } from '../../src/types';
import type { Emocion } from '../../lib/emocion';
import { capturaDelMapa } from '../mapa/captura';
import { sinMovimiento } from '../movimiento';
import { ALTURAS, guardarPreferencia, leerPreferencia, repartoDe, siguienteReparto } from '../preferencias';
import { callar, desbloquear, escucharMudo, estaMudo, hablar, hablarDialogo, prepararRelleno, rellenar, silenciar, suena, type LineaDialogo } from './voz';
import { FRASES_GENERALES, FRASES_GENERALES_EN, fraseDeEspera, fraseDeTrabajo } from './trabajando';
import { RETRATOS } from '../personajes/Retratos';
import { EMOCION_DE, expresionDeLinea } from '../personajes/expresion';
import { comentar, mesaAbierta, type TemaComentario } from '../personajes/mesa';
import { pedidoDeFiltro, pedidoDeLugar } from '../../lib/pedidos-mapa';
import { headersElectrum, SIN_PUERTA } from '../acceso';
import { fijarIdioma, idiomaActual } from './idioma';
import { idiomaDelTurno } from '../../lib/idioma-detectar';
import { Opinion } from './Opinion';
import { Escuela } from '../escuela/Escuela';
import { Biblioteca } from '../biblioteca/Biblioteca';
import { pedirArchivo, Visor, type Fuente } from './Visor';

/** Las tres pestañas del panel. */
export type VistaPanel = 'chat' | 'expedientes' | 'infra';

/** Lo que se le pide al panel desde fuera (la tarjeta del mapa). `n` distingue dos pedidos iguales. */
export type PedidoPanel = { tipo: 'pregunta'; texto: string; n: number } | { tipo: 'ficha'; id: number; n: number; presentarA?: 'INHGEOMIN' | 'ICF' | 'SERNA' };

type Props = {
  /** Un pedido de la tarjeta del mapa: una pregunta para Dr Electrum, o la ficha en PDF de una concesión. */
  pedido?: PedidoPanel | null;
  abierto: boolean;
  vista: VistaPanel;
  onFace: (f: FaceState) => void;
  onEmocion: (e: Emocion) => void;
  onUi: (datos: Array<Record<string, unknown>>) => void;
  onTrabajo: () => void;
  onVista: (v: VistaPanel) => void;
  /** Fracción de la pantalla que ocupa el panel. */
  alto: number;
  onAlto: (v: number) => void;
  /** Entró con un código temporal: ve mapas y PDF a pantalla completa, pero no los baja. */
  invitado?: boolean;
};

type Turno = {
  de: 'persona' | 'electrum';
  texto: string;
  panel?: string;
  traza?: Array<{ herramienta: string; ok: boolean; resumen: string; ms?: number }>;
  /** Si el turno produjo un informe, queda a mano para bajarlo. */
  informe?: { nombre: string; url: string; bytes: number; compartido?: boolean };
  /** Los mapas geológicos que armó el turno: se ven aquí mismo y se pueden bajar. */
  imagenes?: Array<{ nombre: string; url: string; bytes: number; titulo?: string }>;
  /**
   * La búsqueda no fue precisa y trajo varias parecidas: se ofrecen como botones para elegir, en
   * vez de que el doctor adivine cuál era.
   */
  opciones?: Array<{ id: number; nombre: string; detalle: string }>;
  /** La respuesta dicha como conversación entre personajes (Dr Electrum, la ingeniera Tatiana…). */
  dialogo?: Array<LineaDialogo & { nombre: string }>;
  /**
   * La pregunta que habría que repetir. Solo la llevan los turnos que NO terminaron bien: un corte
   * o un fallo. Guardarla es lo que separa «se rompió» de «se rompió y aquí está el botón».
   */
  reintentar?: string;
  /**
   * Es un aviso de la pantalla, no algo que dijo el Doctor.
   *
   * «Lo dejé ahí, como pediste» o «se me cortó la respuesta» se ven en el hilo porque el usuario
   * necesita verlos, pero NO son turnos de la conversación: mandárselos al modelo como respuestas
   * suyas le enseña un pasado que no ocurrió, y la pregunta siguiente se contesta sobre eso.
   */
  local?: boolean;
  /** La traza de este turno en el servidor: a ella va la opinión «¿sirvió?». */
  trazaId?: string;
  /** Lo que opinó la persona (👍 1 / 👎 -1), para no volver a preguntarle. */
  opinion?: 1 | -1;
};

const AMBAR = '#FFAE3B';

/**
 * Que el Doctor se escuche.
 *
 * Un solo elemento de audio, reusado: crear uno por respuesta deja al navegador con una pila de
 * reproductores y, si alguien pregunta dos veces seguidas, las dos voces se pisan. Al pedir una
 * nueva se corta la anterior, que es lo que hace una persona cuando la interrumpen.
 */
/**
 * Hablarle. El navegador graba en webm/opus, que es lo que da `MediaRecorder` en Chrome y Firefox;
 * Safari da mp4. Se manda el mime tal cual en vez de suponerlo: el transcriptor lo necesita para
 * saber qué está abriendo, y adivinarlo mal devuelve una transcripción vacía sin decir por qué.
 */
async function grabar(
  alTexto: (t: string) => void,
  alEstado: (s: 'grabando' | 'oyendo' | '') => void,
  alFallo: (motivo: string) => void
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const trozos: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && trozos.push(e.data);
  /*
   * CORTAR SOLO. Antes había que volver a tocar «Parar» al terminar de hablar: con las manos
   * ocupadas, o en una conversación, eso es un botón de más. Se escucha el nivel del micrófono y,
   * cuando ya se habló y hay 1,3 s de silencio, se manda solo. Tope de 45 s por si hay ruido.
   */
  let vigilante: number | undefined;
  let contexto: AudioContext | null = null;
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AC) {
      contexto = new AC() as AudioContext;
      const fuente = contexto.createMediaStreamSource(stream);
      const analizador = contexto.createAnalyser();
      analizador.fftSize = 1024;
      fuente.connect(analizador);
      const muestras = new Uint8Array(analizador.fftSize);
      const inicio = Date.now();
      let hablo = false;
      let ultimoSonido = Date.now();
      let piso = 0.01;
      vigilante = window.setInterval(() => {
        analizador.getByteTimeDomainData(muestras);
        let suma = 0;
        for (const m of muestras) suma += ((m - 128) / 128) ** 2;
        const nivel = Math.sqrt(suma / muestras.length);
        // El piso de ruido se aprende en el primer medio segundo: una oficina no es un cerro.
        if (Date.now() - inicio < 500) piso = Math.max(piso, nivel * 1.5);
        else if (nivel > Math.max(0.025, piso * 2)) {
          hablo = true;
          ultimoSonido = Date.now();
        }
        const t = Date.now();
        if ((hablo && t - ultimoSonido > 1300) || (!hablo && t - inicio > 9000) || t - inicio > 45000) {
          if (rec.state !== 'inactive') rec.stop();
        }
      }, 100);
    }
  } catch {
    /* sin analizador: se corta con el botón, como antes */
  }
  rec.onstop = async () => {
    if (vigilante) clearInterval(vigilante);
    void contexto?.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop());
    alEstado('oyendo');
    try {
      const blob = new Blob(trozos, { type: mime || 'audio/webm' });
      const base64 = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(blob);
      });
      const r = await fetch('/api/electrum/oir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersElectrum() },
        body: JSON.stringify({ audio: base64, mime: blob.type }),
      });
      const j = await r.json().catch(() => ({}) as any);
      /*
       * Antes solo se miraba si llegó texto: si el oído fallaba, o si no entendió nada, la pantalla
       * pasaba de «pasando a texto…» a nada. Quien dictó con las manos sucias no sabía si tenía que
       * repetirlo o esperar.
       */
      if (j?.texto) {
        // Español o inglés, según lo que se dictó: la respuesta y su voz siguen ese idioma.
        fijarIdioma(j.idioma);
        alTexto(j.texto);
      } else if (r.status === 401) alFallo(SIN_PUERTA);
      else if (!r.ok) alFallo(j?.error ? `No te pude oír: ${j.error}` : `No te pude oír: el servidor contestó ${r.status}.`);
      else alFallo('No te entendí nada. Probá otra vez, más cerca del micrófono.');
    } catch {
      alFallo('No alcancé el servidor para pasar tu voz a texto. Revisá la conexión y volvé a dictármelo.');
    } finally {
      alEstado('');
    }
  };
  rec.start();
  alEstado('grabando');
  return () => rec.state !== 'inactive' && rec.stop();
}

/**
 * Bajar el PDF.
 *
 * Un `<a download>` no lleva cabeceras, y la ruta del informe exige credencial como todo lo demás
 * de esta plataforma. Así que se pide por fetch con la cabecera puesta y el navegador recibe un
 * blob. La alternativa —una URL firmada que valga por sí sola— sería un enlace compartible a un
 * documento del catastro, y eso es justo lo que no queremos que exista.
 */
/**
 * Bajar el informe. Devuelve el motivo si no se pudo — antes devolvía nada.
 *
 * El servidor guarda los informes **media hora**, porque describen el catastro de ese momento.
 * Pasado ese rato el botón seguía ahí y al tocarlo no ocurría absolutamente nada: ni descarga, ni
 * mensaje. El `if (!r.ok) return` se tragaba la explicación que el servidor sí manda, y el `catch`
 * vacío llevaba escrito «el navegador dirá lo suyo», que es justo lo que el navegador no hace.
 */
async function bajarInforme(informe: { nombre: string; url: string }): Promise<string | null> {
  try {
    const r = await fetch(informe.url, { headers: headersElectrum() });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}) as any);
      if (j?.error) return String(j.error);
      return r.status === 404
        ? 'Ese informe ya caducó. Se guardan media hora porque describen el catastro del momento; pedime otro.'
        : `No pude bajarlo: el servidor contestó ${r.status}.`;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = informe.nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return null;
  } catch (e: any) {
    return `No alcancé el servidor para bajar el informe (${String(e?.message || e).slice(0, 80)}).`;
  }
}

/**
 * Un mapa geológico del turno, visto en el hilo. La ruta exige credencial, así que no sirve un
 * `<img src>` directo: se pide por fetch con la cabecera y se muestra el blob. Si ya caducó (media
 * hora, como los informes) se dice, en vez de dejar una imagen rota.
 */
function MapaDelTurno({
  imagen,
  puedeBajar,
  onAviso,
  onAbrir,
}: {
  imagen: { nombre: string; url: string; bytes: number; titulo?: string };
  puedeBajar: boolean;
  onAviso: (m: string) => void;
  onAbrir: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    let url: string | null = null;
    pedirArchivo(imagen.url)
      .then((b) => {
        url = URL.createObjectURL(b);
        if (vivo) setSrc(url);
      })
      .catch((e) => vivo && setError(String(e?.message || e)));
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [imagen.url]);
  const chico =
    'flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase text-[#9FB0B8] hover:border-white/30 hover:text-white cursor-pointer';
  return (
    <figure className="mt-2 overflow-hidden rounded-lg border" style={{ borderColor: 'rgba(255,174,59,.35)' }}>
      {src ? (
        // Tocar el mapa lo abre en grande, con zoom.
        <button type="button" onClick={onAbrir} className="group relative block w-full cursor-zoom-in" aria-label={`Ver en grande: ${imagen.titulo || imagen.nombre}`}>
          <img src={src} alt={imagen.titulo || imagen.nombre} className="block w-full bg-white" />
          <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/70 px-2 py-1 font-mono text-[10px] tracking-[0.12em] uppercase text-white opacity-80 transition-opacity group-hover:opacity-100">
            ⤢ Ver en grande
          </span>
        </button>
      ) : (
        <div className="px-3 py-6 text-center font-mono text-[11px] text-[#6C7F89]">{error || 'Cargando el mapa…'}</div>
      )}
      <figcaption className="flex items-center gap-2 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] text-[#C9D6DC]">{imagen.titulo || imagen.nombre}</span>
        {src && (
          <button type="button" onClick={onAbrir} className={chico}>
            Abrir
          </button>
        )}
        {puedeBajar && (
          <button type="button" onClick={() => void bajarInforme(imagen).then((m) => m && onAviso(m))} className={chico}>
            Bajar
          </button>
        )}
      </figcaption>
    </figure>
  );
}

const EJEMPLOS = [
  '¿se traslapa algo en el catastro?',
  'mostrame Cerro Partido',
  '250.000 toneladas a 3,4 g/t, ¿cuántas onzas?',
  '¿qué concesiones vencen este año?',
];

/**
 * La conversación sobrevive a un F5.
 *
 * Va en `sessionStorage` y no en `localStorage` a propósito: acá se nombran concesionarios reales,
 * y una pestaña cerrada tiene que llevarse el rastro. Sobrevive a recargar, no a irse.
 */
const CAJON_HILO = 'electrum.hilo';


/*
 * Por qué los cortes llevan motivo.
 *
 * `abort()` a secas deja en `signal.reason` un DOMException genérico, indistinguible del que pone
 * el navegador cuando se cae la red. Sin motivo propio, pararlo a mano se le contaba al usuario
 * como «no alcancé el servidor» — acusar a la conexión de algo que hizo él.
 */
const MOTIVO_PARADO = new Error('parado por quien pregunta');
const MOTIVO_TARDE = new Error('tardó demasiado');
const MOTIVO_IRSE = new Error('se cerró la pantalla');

function hiloGuardado(): Turno[] {
  try {
    const crudo = sessionStorage.getItem(CAJON_HILO);
    if (!crudo) return [];
    const v = JSON.parse(crudo);
    return Array.isArray(v) ? v.filter((t) => t && typeof t.texto === 'string') : [];
  } catch {
    // Navegación privada, almacenamiento bloqueado, JSON de otra versión: se arranca en blanco.
    return [];
  }
}

export function Panel({ abierto, vista, alto, onAlto, onFace, onEmocion, onUi, onTrabajo, onVista, pedido, invitado = false }: Props) {
  /** Lo que está abierto en el visor a pantalla completa (un mapa del hilo o un PDF). */
  const [visor, setVisor] = useState<Fuente | null>(null);
  // El recorrido (y los comandos de voz) abren y cierran el visor desde fuera.
  useEffect(() => {
    const alPedir = (e: Event) => setVisor(((e as CustomEvent<Fuente | null>).detail as Fuente | null) || null);
    window.addEventListener('electrum:visor', alPedir);
    return () => window.removeEventListener('electrum:visor', alPedir);
  }, []);
  const [turnos, setTurnos] = useState<Turno[]>(hiloGuardado);
  /*
   * `preguntar` no puede depender de `turnos` —se reharía en cada mensaje y con él todo lo que
   * cuelga— pero necesita el hilo del momento para mandarlo. Una ref siempre tiene el de ahora.
   */
  const turnosRef = useRef<Turno[]>(turnos);
  turnosRef.current = turnos;
  /*
   * La pestaña se cerró o es otro aparato: lo que se venía hablando se retoma del servidor, que lo
   * guarda por persona (auditoría H17). Solo si la pantalla arrancó en blanco y nadie escribió aún.
   */
  useEffect(() => {
    if (turnosRef.current.length) return;
    let vivo = true;
    void fetch('/api/electrum/hilo', { headers: headersElectrum() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const del: Array<{ rol: string; texto: string }> = Array.isArray(j?.turnos) ? j.turnos : [];
        if (!vivo || !del.length || turnosRef.current.length) return;
        setTurnos(del.map((t) => ({ de: t.rol === 'electrum' ? ('electrum' as const) : ('persona' as const), texto: String(t.texto || '') })));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  /*
   * La concesión que se está mirando: la última a la que voló el mapa por una herramienta.
   *
   * Sin esto el botón PDF armaba siempre el informe de la cartera entera, aunque la conversación
   * fuera sobre una concesión y Dr Electrum acabara de ofrecer «¿te armo la ficha en PDF?». Tocar
   * PDF en ese momento tiene que dar la ficha de ESA concesión.
   */
  const [enFoco, setEnFoco] = useState<number | null>(null);
  /** El turno en vuelo, para poder pararlo desde el botón o al irse de la pantalla. */
  const abortoRef = useRef<AbortController | null>(null);
  /** Mientras se arrastra el asa, la altura no se anima: la transición la haría ir a rastras. */
  const [arrastrando, setArrastrando] = useState(false);
  /** El menú de «⋯» en pantalla estrecha. */
  const [masAbierto, setMasAbierto] = useState(false);
  /** «Internet»: la próxima pregunta se contesta buscando en la web, con las fuentes citadas. */
  const [internet, setInternet] = useState(false);
  const internetRef = useRef(internet);
  internetRef.current = internet;

  useEffect(() => {
    try {
      // Solo el texto y de quién es: la traza y los enlaces de informe no son contexto y ocupan.
      sessionStorage.setItem(
        CAJON_HILO,
        JSON.stringify(
          turnos
            .filter((t) => !t.local)
            .slice(-24)
            .map((t) => ({ de: t.de, texto: t.texto }))
        )
      );
    } catch {
      /* si no deja guardar, el hilo vive solo en memoria y ya está */
    }
  }, [turnos]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  /*
   * Arranca ENCENDIDA y se recuerda. Apagada por defecto y escondida en un menú, nadie la
   * encontraba y el doctor parecía mudo. El navegador igual no deja sonar nada hasta el primer
   * toque: por eso cada toque (enviar, dictar, «Voz») desbloquea el reproductor (voz.ts).
   */
  // La misma llave que el botón «Voces» de arriba (voz.ts): apagar una apaga las dos.
  const [vozActiva, setVozActivaCruda] = useState<boolean>(() => !estaMudo());
  useEffect(() => escucharMudo((m) => setVozActivaCruda(!m)), []);
  const setVozActiva = useCallback((f: (v: boolean) => boolean) => {
    silenciar(!f(!estaMudo()));
  }, []);
  /** Está sonando la voz ahora mismo: el botón pasa a «Callar». */
  const [hablando, setHablando] = useState(false);
  /** Un fallo de voz se avisa una vez por sesión de pantalla, no en cada respuesta. */
  const vozAvisada = useRef(false);
  /*
   * `preguntar` usaba `vozActiva` sin declararlo en sus dependencias, así que podía quedarse con la
   * preferencia de hace dos turnos: silenciabas y la respuesta siguiente hablaba igual. Una ref
   * siempre tiene el valor de ahora, y así no hay que rehacer `preguntar` en cada cambio.
   */
  const vozActivaRef = useRef(vozActiva);
  vozActivaRef.current = vozActiva;

  // Al desmontar, silencio y corte: un panel que se va no puede dejar una voz sonando detrás ni
  // un turno leyendo un flujo contra un componente que ya no existe.
  useEffect(
    () => () => {
      callar();
      abortoRef.current?.abort(MOTIVO_IRSE);
    },
    []
  );
  const [oyendo, setOyendo] = useState<'grabando' | 'oyendo' | ''>('');
  const pararGrabacion = useRef<(() => void) | null>(null);
  /** Lo que está pasando AHORA. Se vacía al terminar, cuando pasa a ser parte del turno. */
  const [enVivo, setEnVivo] = useState<{ panel: string; traza: Array<{ herramienta: string; ok: boolean; resumen: string }> }>({ panel: '', traza: [] });
  const hilo = useRef<HTMLDivElement>(null);

  /**
   * SEGUIR EL FINAL, PERO SOLO SI YA ESTABAS ALLÍ.
   *
   * Antes bajaba al final en cada cambio, sin mirar. Quien estaba releyendo una respuesta de hace
   * tres turnos —comprobando un número de expediente, que es exactamente lo que se hace con esto—
   * salía disparado al fondo en cuanto llegaba una línea nueva. Ahora, si te has apartado del
   * final, te quedas donde estás y aparece un aviso de que hay algo nuevo.
   */
  const [hayNuevo, setHayNuevo] = useState(false);
  const alFinal = useRef(true);

  /*
   * Cuándo empezó el último desplazamiento que hizo la PANTALLA, no la persona.
   *
   * El desplazamiento suave dispara `scroll` a mitad de camino, y en cada uno de esos eventos la
   * posición todavía no está al final: `mirarPosicion` concluía que la persona se había ido hacia
   * arriba. Resultado medido en el navegador: se hacía una pregunta, la respuesta llegaba debajo
   * del borde, no se bajaba sola y aparecía «hay respuesta nueva» a alguien que no se había movido.
   * Mientras dura la animación propia, esos eventos no cuentan como decisión de nadie.
   */
  const desplazandoSolo = useRef(0);

  const mirarPosicion = useCallback(() => {
    const el = hilo.current;
    if (!el) return;
    if (Date.now() - desplazandoSolo.current < 900) return;
    // 40 px de margen: nadie deja el desplazamiento clavado al píxel.
    alFinal.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (alFinal.current) setHayNuevo(false);
  }, []);

  const bajarDeltodo = useCallback(() => {
    const el = hilo.current;
    if (!el) return;
    desplazandoSolo.current = Date.now();
    el.scrollTo({ top: el.scrollHeight, behavior: sinMovimiento() ? 'auto' : 'smooth' });
    alFinal.current = true;
    setHayNuevo(false);
  }, []);

  useEffect(() => {
    if (alFinal.current) bajarDeltodo();
    else if (turnos.length) setHayNuevo(true);
  }, [turnos, pensando, enVivo, bajarDeltodo]);

  /**
   * Un aviso de la pantalla, no una frase del Doctor.
   *
   * Marca también la pregunta que se quedó sin contestar. Si no, el hilo que sale hacia el modelo
   * queda con dos mensajes de usuario seguidos y una pregunta colgando sin respuesta: «¿y la
   * segunda?» se contestaría sobre una lista que nunca llegó a existir.
   */
  const avisar = useCallback((texto: string, reintentar?: string) => {
    setTurnos((t) => {
      const copia = [...t];
      for (let i = copia.length - 1; i >= 0; i--) {
        if (copia[i].de === 'persona') {
          copia[i] = { ...copia[i], local: true };
          break;
        }
      }
      return [...copia, { de: 'electrum', texto, reintentar, local: true }];
    });
  }, []);

  /**
   * Un aviso de la pantalla que NO cuelga de una pregunta: el micrófono sin permiso, un PDF que no
   * bajó, un informe que no se pudo compartir. `avisar` marca además la última pregunta como no
   * contestada, y usarlo acá sacaba del hilo una pregunta que sí tuvo su respuesta. Tampoco va al
   * modelo: es de la pantalla.
   */
  const avisoSuelto = useCallback((texto: string) => {
    setTurnos((t) => [...t, { de: 'electrum', texto, local: true }]);
  }, []);

  /** Lo que se dijo mientras el doctor pensaba: se pregunta en cuanto termine (ver más abajo). */
  const enCola = useRef<string | null>(null);
  const preguntar = useCallback(
    async (pregunta: string) => {
      const q = pregunta.trim();
      if (!q || pensando) return;
      // Una pregunta nueva deja sin efecto la que estaba anotada.
      enCola.current = null;
      // Una pregunta nueva corta la respuesta anterior que todavía suena.
      callar();
      setHablando(false);
      if (vozActivaRef.current) desbloquear();
      setTexto('');
      setTurnos((t) => [...t, { de: 'persona', texto: q }]);
      setEnVivo({ panel: '', traza: [] });
      // Lo que es para el mapa no espera al cerebro: «solo las de oro», «llévame a Juticalpa».
      const filtro = pedidoDeFiltro(q);
      if (filtro) onUi([{ accion: 'filtrar', mineral: filtro === 'quitar' ? null : filtro }]);
      const lugar = pedidoDeLugar(q);
      if (lugar) {
        void fetch(`/api/electrum/lugar?q=${encodeURIComponent(lugar)}`, { headers: headersElectrum() })
          .then((r) => (r.ok ? r.json() : null))
          .then((j: any) => {
            if (j?.ok && j.tipo === 'lugar' && j.lugar) onUi([{ accion: 'lugar', ...j.lugar }]);
            else if (j?.ok && j.tipo === 'concesion' && j.ui) onUi([j.ui]);
          })
          .catch(() => {});
      }
      setPensando(true);
      onFace('THINKING');
      onTrabajo();

      /*
       * NUNCA EN SILENCIO. Apenas se pide algo, dice en voz alta qué va a hacer («estoy dibujando el
       * mapa geológico para usted…»); si la espera se alarga, vuelve a decir en qué va según la
       * última herramienta. La respuesta espera a que termine la frase en curso (voz.ts).
       */
      let respondiendo = false;
      let ultimaHerramienta: string | null = null;
      let ultimaFrase = Date.now();
      let esperas = 0;
      const dichas = new Set<string>();
      // Las muletillas van en el idioma de la pregunta (el mismo criterio que usa el servidor).
      const idiomaPregunta = idiomaDelTurno(q, idiomaActual());
      const decirTrabajo = (frase: string) => {
        dichas.add(frase);
        ultimaFrase = Date.now();
        void rellenar(frase, headersElectrum(), {
          alEmpezar: () => !respondiendo && onFace('SPEAKING'),
          alTerminar: () => !respondiendo && onFace('THINKING'),
        });
      };
      if (vozActivaRef.current) {
        decirTrabajo(fraseDeTrabajo(q, Math.random, idiomaPregunta));
        // La próxima general queda lista para que salga sin espera.
        const generales = idiomaPregunta === 'en' ? FRASES_GENERALES_EN : FRASES_GENERALES;
        prepararRelleno(generales[Math.floor(Math.random() * generales.length)], headersElectrum());
      }
      const relojEspera = window.setInterval(() => {
        if (respondiendo || !vozActivaRef.current || suena() || esperas >= 4) return;
        if (Date.now() - ultimaFrase < 9000) return;
        let frase = fraseDeEspera(ultimaHerramienta, esperas, idiomaPregunta);
        if (dichas.has(frase)) frase = fraseDeEspera(null, esperas, idiomaPregunta);
        esperas++;
        decirTrabajo(frase);
      }, 1000);
      const avisarRespondido = () => window.dispatchEvent(new Event('electrum:respondido'));

      /*
       * Un turno se puede cortar por fuera: se va la señal, Render recicla el proceso, el usuario
       * toca «parar». El navegador necesita poder abandonar la lectura, y el corte de tiempo tiene
       * que ser MAYOR que el presupuesto del turno en el servidor (50 s) para no abandonar una
       * respuesta que venía en camino.
       */
      const abortar = new AbortController();
      abortoRef.current = abortar;
      const reloj = setTimeout(() => abortar.abort(MOTIVO_TARDE), 75_000);
      /** ¿Llegó a cerrar el servidor? Si no, esto NO se puede presentar como una respuesta. */
      let cerrado = false;
      /** ¿Llegamos a leer algo del flujo? Separa «no conecté» de «conecté y se cayó a la mitad». */
      let empezado = false;
      /*
       * El informe que armó el turno. Llega por `ui` —la herramienta `informe_pdf` deja ahí su
       * enlace— y hasta ahora se perdía: Dr Electrum decía «ya está listo para descargar» y en la
       * pantalla no había nada que descargar. Se engancha a la respuesta cuando llega el `fin`.
       */
      let informeDelTurno: Turno['informe'] | undefined;
      /** Si la respuesta se va a decir en voz alta, la cara la maneja la voz, no el reloj de abajo. */
      let vozEnCamino = false;
      const imagenesDelTurno: NonNullable<Turno['imagenes']> = [];
      let opcionesDelTurno: Turno['opciones'];

      try {
        /*
         * Se lee el flujo a mano en vez de usar EventSource porque EventSource solo hace GET, y la
         * pregunta va en el cuerpo de un POST — meterla en la URL la dejaría en los registros del
         * servidor y en el historial del navegador.
         */
        const r = await fetch('/api/electrum/turno/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headersElectrum() },
          signal: abortar.signal,
          /*
           * El hilo viaja con la pregunta. El servidor guarda el suyo y prefiere ése, pero Render
           * reinicia el proceso cuando quiere y ahí la única copia que queda es la de esta pantalla.
           */
          body: JSON.stringify({
            mensaje: q,
            internet: internetRef.current,
            // Con la mesa abierta, contestan los tres discutiendo.
            mesa: mesaAbierta(),
            // Pista por si la pregunta sola no dice el idioma («Olancho», «ok»).
            idioma: idiomaActual(),
            hilo: turnosRef.current
              .filter((t) => !t.local)
              .slice(-24)
              .map((t) => ({ rol: t.de, texto: t.texto })),
          }),
        });
        if (r.status === 401) {
          cerrado = true;
          onFace('CONCERNED');
          avisar(SIN_PUERTA);
          return;
        }
        /*
         * Antes solo se miraba el 401 y todo lo demás entraba al lector como si fuera un flujo.
         * Un 500 o un 503 —que es lo que devuelve Render mientras redespliega— trae una página de
         * error, no eventos: el lector no encontraba ninguno, salía en silencio y la pantalla se
         * quedaba como si el Doctor hubiera decidido no contestar.
         */
        if (!r.ok) {
          cerrado = true;
          const detalle = await r.text().catch(() => '');
          let dicho = `El servidor contestó ${r.status}.`;
          try {
            const j = JSON.parse(detalle);
            if (j?.error) dicho = String(j.error);
          } catch {
            /* no era JSON: se queda el código, que ya dice algo */
          }
          onFace('CONCERNED');
          avisar(dicho, q);
          return;
        }
        if (!r.body) throw new Error('sin flujo');

        const lector = r.body.getReader();
        const dec = new TextDecoder();
        let resto = '';
        let evento = '';
        let terminado = false;

        /*
         * Se lee HASTA EL FINAL aunque ya llegó el `fin`: el servidor cierra justo después, y dejar el
         * flujo a medio leer hacía que el navegador lo diera por abortado (ERR_ABORTED en la consola
         * en cada pregunta) y que la conexión quedara colgada hasta recargar.
         */
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          if (terminado) continue;
          empezado = true;
          resto += dec.decode(value, { stream: true });
          // SSE separa los mensajes con una línea en blanco; lo que quede a medias espera.
          const trozos = resto.split('\n\n');
          resto = trozos.pop() || '';
          for (const trozo of trozos) {
            for (const linea of trozo.split('\n')) {
              if (linea.startsWith('event: ')) evento = linea.slice(7).trim();
              else if (linea.startsWith('data: ')) {
                const d = JSON.parse(linea.slice(6));
                if (evento === 'panel') setEnVivo((v) => ({ ...v, panel: d.panel }));
                else if (evento === 'herramienta') {
                  ultimaHerramienta = String(d?.herramienta || '') || null;
                  setEnVivo((v) => ({ ...v, traza: [...v.traza, d] }));
                }
                else if (evento === 'ui') {
                  onUi([d]); // el mapa se mueve YA, no al final
                  if (d?.accion === 'volar' && Number.isFinite(Number(d.concesion_id))) setEnFoco(Number(d.concesion_id));
                  // Varias parecidas: botones para elegir. Una sola (o la exacta) no pide elección.
                  if (d?.accion === 'candidatas' && Array.isArray(d.filas) && d.filas.length > 1) {
                    opcionesDelTurno = d.filas.slice(0, 6).map((f: any) => ({
                      id: Number(f.id),
                      nombre: String(f.nombre || `id ${f.id}`),
                      detalle: [f.municipio, f.titular, f.expediente].filter(Boolean).map(String).join(' · '),
                    }));
                  }
                  // Un mapa (image/jpeg) se ve en el hilo; un PDF queda como tarjeta para bajar.
                  const armados: any[] = Array.isArray(d?.informes) ? d.informes : d?.informe ? [d.informe] : [];
                  for (const x of armados) {
                    if (!x?.url) continue;
                    if (x.tipo === 'image/jpeg') {
                      if (!imagenesDelTurno.some((y) => y.url === x.url)) imagenesDelTurno.push({ nombre: String(x.nombre || 'mapa.jpg'), url: String(x.url), bytes: Number(x.bytes) || 0, titulo: x.titulo ? String(x.titulo) : undefined });
                    } else informeDelTurno = { nombre: String(x.nombre || 'informe.pdf'), url: String(x.url), bytes: Number(x.bytes) || 0 };
                  }
                }
                else if (evento === 'error') {
                  cerrado = true;
                  avisar(d.error, q);
                  onFace('CONCERNED');
                  terminado = true;
                } else if (evento === 'fin') {
                  cerrado = true;
                  respondiendo = true;
                  // La voz lee en el idioma en que contestó (español si no lo dice).
                  fijarIdioma(d.idioma);
                  onFace('SPEAKING');
                  // La etiqueta con la que se va a DECIR (v4) manda sobre un «neutral» del cerebro.
                  const deVoz = typeof d.voz === 'string' ? expresionDeLinea(d.voz, true) : 'neutral';
                  if (deVoz !== 'neutral' && (!d.emocion || d.emocion === 'neutral')) onEmocion(EMOCION_DE[deVoz]);
                  else if (d.emocion) onEmocion(d.emocion);
                  // Contestó la mesa (Don Chema, la Ing. Tatiana…): cada uno con su voz y su cara.
                  const voces: Array<LineaDialogo & { nombre: string }> = Array.isArray(d.voces)
                    ? d.voces
                        .filter((v: any) => v && RETRATOS[v.quien] && typeof v.texto === 'string' && v.texto.trim())
                        .map((v: any) => ({ quien: String(v.quien), texto: String(v.texto), nombre: RETRATOS[v.quien].nombre }))
                    : [];
                  // En silencio la mesa igual se «dice»: hablarDialogo la lee al ritmo de lectura con
                  // sus caras y subtítulos (voz.ts), sin sonido. Una respuesta de uno solo, no.
                  if ((vozActivaRef.current || voces.length) && d.texto) {
                    vozEnCamino = true;
                    // `voz` trae las etiquetas de expresión de v4 que la pantalla no enseña.
                    const avisosVoz: Parameters<typeof hablar>[3] = {
                      alEmpezar: () => {
                        setHablando(true);
                        onFace('SPEAKING');
                      },
                      alTerminar: () => {
                        setHablando(false);
                        onFace('IDLE');
                        avisarRespondido();
                      },
                      alFallar: (motivo) => {
                        setHablando(false);
                        onFace('IDLE');
                        avisarRespondido();
                        if (!vozAvisada.current) {
                          vozAvisada.current = true;
                          avisoSuelto(`No pude decírtelo en voz alta: ${motivo}. La respuesta está escrita arriba.`);
                        }
                      },
                    };
                    if (voces.length) void hablarDialogo(voces, headersElectrum(), avisosVoz);
                    else void hablar(typeof d.voz === 'string' && d.voz ? d.voz : d.texto, d.emocion, headersElectrum(), avisosVoz);
                  }
                  setTurnos((t) => [...t, { de: 'electrum', texto: d.texto || 'No pude contestar.', panel: d.panel, traza: d.traza, informe: informeDelTurno, imagenes: imagenesDelTurno.length ? imagenesDelTurno : undefined, opciones: opcionesDelTurno, dialogo: voces.length ? voces : undefined, trazaId: typeof d.trazaId === 'string' ? d.trazaId : undefined }]);
                  terminado = true;
                }
              }
            }
          }
        }
      } catch {
        cerrado = true;
        const motivo = abortar.signal.reason;
        // Irse de la pantalla no es un fallo que contarle a nadie: ya no hay nadie mirando.
        if (motivo !== MOTIVO_IRSE) {
          onFace('CONCERNED');
          const parado = motivo === MOTIVO_PARADO;
          const tarde = motivo === MOTIVO_TARDE;
          avisar(
            parado
              ? 'Lo dejé ahí, como pediste.'
              : tarde
                ? 'Pasé de los setenta y cinco segundos sin cerrar la respuesta y corté. Puede ser el cerebro tardando o la conexión. Volvé a pedírmelo.'
                : empezado
                  ? 'Se cayó la conexión con la respuesta a medio venir. Alcancé a empezar pero no a terminar, así que no te enseño un pedazo como si fuera la respuesta.'
                  : 'No alcancé el servidor. Revisá la conexión y volvé a preguntarme.',
            parado ? undefined : q
          );
        }
      } finally {
        clearTimeout(reloj);
        clearInterval(relojEspera);
        respondiendo = true;
        abortoRef.current = null;
        /*
         * EL PUNTO DE F05. El lector sale cuando el flujo termina, y eso pasa también cuando el
         * flujo se CORTA: se fue la red, Render recicló el proceso, un proxy cerró la conexión. Sin
         * esta comprobación la pantalla se limpiaba y quedaba como si el Doctor hubiera decidido no
         * contestar — indistinguible de una respuesta vacía, y sin nada que tocar para reintentar.
         *
         * Un turno solo cuenta como terminado si el servidor mandó su `fin` o su `error`. Cualquier
         * otra salida es un corte, y se dice que lo es.
         */
        if (!cerrado) {
          onFace('CONCERNED');
          avisar(
            'Se me cortó la respuesta a la mitad. No sé si alcancé a terminar de pensarla, así que no te voy a enseñar un pedazo como si fuera la respuesta.',
            q
          );
        }
        setPensando(false);
        setEnVivo({ panel: '', traza: [] });
        if (!vozEnCamino) {
          // Sin respuesta hablada, lo que quedara del «estoy revisando…» se corta: ya no hay nada que esperar.
          if (vozActivaRef.current) callar();
          setTimeout(() => onFace('IDLE'), 1200);
          avisarRespondido();
        }
      }
    },
    [pensando, onFace, onEmocion, onUi, onTrabajo, avisar, avisoSuelto]
  );

  /** Abrir un informe al resto del equipo. Solo puede hacerlo quien lo pidió; el servidor lo comprueba. */
  /*
   * «EXPLÍCAMELO COMO CONVERSACIÓN». La respuesta se vuelve un diálogo a varias voces (Eleven v4):
   * el doctor explica y la ingeniera Tatiana pregunta lo que preguntaría quien escucha. El guion lo
   * escribe el servidor; aquí se enseña con el nombre de cada uno y suena con la voz de cada uno.
   */
  const [conversando, setConversando] = useState(false);
  const conversar = useCallback(
    async (texto: string) => {
      if (!texto.trim() || conversando) return;
      setConversando(true);
      desbloquear();
      onFace('THINKING');
      if (vozActivaRef.current) void rellenar('Déjeme armarlo como conversación con la ingeniera Tatiana…', headersElectrum());
      try {
        const r = await fetch('/api/electrum/dialogo/guion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headersElectrum() },
          body: JSON.stringify({ texto }),
        });
        const j: any = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(j?.lineas)) {
          avisoSuelto(j?.error || `No pude armar la conversación: el servidor contestó ${r.status}.`);
          return;
        }
        const lineas = j.lineas as Array<LineaDialogo & { nombre: string }>;
        setTurnos((t) => [...t, { de: 'electrum', texto: lineas.map((l) => `${l.nombre}: ${l.texto}`).join('\n'), dialogo: lineas, panel: 'En conversación', local: true }]);
        await hablarDialogo(lineas, headersElectrum(), {
          alEmpezar: () => {
            setHablando(true);
            onFace('SPEAKING');
          },
          alTerminar: () => {
            setHablando(false);
            onFace('IDLE');
          },
          alFallar: (m) => {
            setHablando(false);
            onFace('IDLE');
            avisoSuelto(`La conversación está escrita arriba; no pude decirla en voz alta: ${m}.`);
          },
        });
      } catch {
        avisoSuelto('No alcancé el servidor para armar la conversación.');
      } finally {
        setConversando(false);
      }
    },
    [conversando, onFace, avisoSuelto]
  );
  // «Explícamelo como conversación» dicho en voz alta: la última respuesta del doctor.
  useEffect(() => {
    const alPedir = () => {
      const ultima = [...turnosRef.current].reverse().find((t) => t.de === 'electrum' && !t.local && t.texto);
      if (ultima) void conversar(ultima.texto);
      else avisoSuelto('Primero pregúnteme algo, y después se lo explico como conversación.');
    };
    window.addEventListener('electrum:dialogo', alPedir);
    return () => window.removeEventListener('electrum:dialogo', alPedir);
  }, [conversar, avisoSuelto]);

  /*
   * EL EQUIPO COMENTA lo que se abre en pantalla (mesa.ts → `comentar`): el timelapse, un documento,
   * un perfil del terreno. Quien sabe de eso lo mira, otro le agrega y al final le preguntan si
   * quiere profundizar. Si ya se está contestando o hablando otra cosa, no se encima.
   */
  const ocupadoRef = useRef(false);
  ocupadoRef.current = pensando || conversando || hablando;
  useEffect(() => {
    let ultimo = 0;
    const alComentar = async (e: Event) => {
      const d = (e as CustomEvent<{ tema: TemaComentario; contexto: string }>).detail;
      if (!d || ocupadoRef.current || Date.now() - ultimo < 4000) return;
      ultimo = Date.now();
      try {
        const r = await fetch('/api/electrum/mesa/comentar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headersElectrum() },
          body: JSON.stringify(d),
        });
        const j: any = await r.json().catch(() => null);
        const lineas = (Array.isArray(j?.lineas) ? j.lineas : []).filter((l: any) => l && RETRATOS[l.quien] && typeof l.texto === 'string') as Array<LineaDialogo & { nombre: string }>;
        if (!lineas.length || ocupadoRef.current) return;
        setTurnos((t) => [...t, { de: 'electrum', texto: lineas.map((l) => `${l.nombre}: ${l.texto.replace(/\[[^\]\n]{1,40}\]\s*/g, '')}`).join('\n'), dialogo: lineas, panel: 'El equipo comenta' }]);
        await hablarDialogo(lineas, headersElectrum(), {
          alEmpezar: () => {
            setHablando(true);
            onFace('SPEAKING');
          },
          alTerminar: () => {
            setHablando(false);
            onFace('IDLE');
          },
          alFallar: () => {
            setHablando(false);
            onFace('IDLE');
          },
        });
      } catch {
        /* sin comentario: la pantalla sigue igual */
      }
    };
    window.addEventListener('electrum:comentario', alComentar);
    return () => window.removeEventListener('electrum:comentario', alComentar);
  }, [onFace]);

  const compartir = useCallback(
    async (indice: number, informe: { url: string }) => {
      try {
        const r = await fetch(`${informe.url}/compartir`, { method: 'POST', headers: headersElectrum() });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}) as any);
          avisoSuelto(j?.error || `No pude compartirlo: el servidor contestó ${r.status}.`);
          return;
        }
        setTurnos((t) =>
          t.map((x, j) => (j === indice && x.informe ? { ...x, informe: { ...x.informe, compartido: true } } : x))
        );
      } catch {
        avisoSuelto('No alcancé el servidor para compartir el informe.');
      }
    },
    [avisoSuelto]
  );

  /** Borra el hilo de las dos puntas. Si el servidor no contesta, al menos la pantalla queda limpia. */
  const olvidar = useCallback(() => {
    setTurnos([]);
    setEnFoco(null);
    try {
      sessionStorage.removeItem(CAJON_HILO);
    } catch {
      /* sin almacenamiento no hay nada que quitar */
    }
    void fetch('/api/electrum/hilo', { method: 'DELETE', headers: headersElectrum() }).catch(() => {});
  }, []);

  /**
   * Pedir el informe de la cartera desde la pantalla, con el mapa tal como se está viendo. Va por
   * su propia ruta y no por el turno: no hace falta molestar al modelo para armar un documento cuyo
   * contenido sale entero del catastro.
   */
  const pedirInforme = useCallback(async (idForzado?: number, presentarA?: string) => {
    if (pensando) return;
    const idFicha = typeof idForzado === 'number' ? idForzado : enFoco;
    setPensando(true);
    onFace('THINKING');
    onTrabajo();
    try {
      /*
       * La foto se espera. `capturaDelMapa` ahora aguarda a que el mapa termine de dibujar: antes
       * leía el cuadro anterior, así que un informe pedido justo después de volar a una concesión
       * se llevaba la vista de antes — y nadie lo notaba hasta abrir el PDF.
       */
      const foto = await capturaDelMapa();
      const r = await fetch('/api/electrum/informe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersElectrum() },
        body: JSON.stringify(
          idFicha != null
            ? { tipo: 'concesion', concesion_id: idFicha, mapa: 'imagen' in foto ? foto.imagen : null, presentar_a: presentarA || undefined }
            : { tipo: 'cartera', mapa: 'imagen' in foto ? foto.imagen : null }
        ),
      });
      /*
       * Un 502 de Render trae HTML, no JSON: `r.json()` lanzaba y el catch contaba «no alcancé el
       * servidor» cuando el servidor sí contestó. Y un 401 se enseñaba como un fallo del informe en
       * vez de como lo que es, la puerta.
       */
      const j: any = await r.json().catch(() => null);
      if (r.status === 401) {
        avisoSuelto(SIN_PUERTA);
      } else if (!r.ok || !j?.url) {
        avisoSuelto(j?.error || `No pude armar el informe: el servidor contestó ${r.status}.`);
      } else {
        // Si el mapa no entró, se dice EN la misma respuesta. Un informe sin mapa y sin explicación
        // parece roto; uno que dice por qué es un informe honesto.
        const texto = 'falta' in foto ? `${j.dicho}\n\nVa sin mapa: ${foto.falta}` : j.dicho;
        setTurnos((t) => [...t, { de: 'electrum', texto, informe: { nombre: j.nombre, url: j.url, bytes: j.bytes } }]);
      }
    } catch {
      avisoSuelto('No alcancé el servidor para armar el informe. Revisá la conexión y volvé a pedírmelo.');
    } finally {
      setPensando(false);
      setTimeout(() => onFace('IDLE'), 900);
    }
  }, [pensando, onFace, onTrabajo, enFoco, avisoSuelto]);

  /*
   * Lo que pide la tarjeta del mapa: una pregunta va al turno como si se hubiera escrito aquí; la
   * ficha en PDF va por su ruta, igual que el botón del panel. Si Dr Electrum está contestando otra
   * cosa se dice, en vez de tragarse el pedido.
   */
  const ultimoPedido = useRef(0);
  /*
   * EN UNA CONVERSACIÓN NADA SE PIERDE. Lo que se dice mientras el doctor todavía piensa queda
   * anotado y se pregunta en cuanto termina de contestar (la última gana: si se corrigió, vale la
   * corrección). Antes se tiraba en silencio y parecía que no había oído.
   */
  const preguntarRef = useRef(preguntar);
  preguntarRef.current = preguntar;
  const pensandoRef = useRef(pensando);
  pensandoRef.current = pensando;
  useEffect(() => {
    // Terminó de contestar, o le cortaron la respuesta hablándole encima: va la anotada.
    const alTerminar = () => {
      const q = enCola.current;
      if (!q) return;
      // Un respiro para que la pantalla suelte el «pensando» antes de la siguiente.
      window.setTimeout(() => {
        if (enCola.current !== q || pensandoRef.current) return;
        enCola.current = null;
        void preguntarRef.current(q);
      }, 120);
    };
    window.addEventListener('electrum:respondido', alTerminar);
    window.addEventListener('electrum:interrumpido', alTerminar);
    return () => {
      window.removeEventListener('electrum:respondido', alTerminar);
      window.removeEventListener('electrum:interrumpido', alTerminar);
    };
  }, []);
  useEffect(() => {
    if (!pedido || pedido.n === ultimoPedido.current) return;
    ultimoPedido.current = pedido.n;
    if (pensando) {
      if (pedido.tipo === 'pregunta') {
        enCola.current = pedido.texto;
        avisoSuelto(`Anotado: «${pedido.texto.slice(0, 80)}». Se lo contesto apenas termine esta respuesta.`);
      } else avisoSuelto('Estoy terminando otra respuesta: volvé a tocar el botón cuando acabe.');
      return;
    }
    if (pedido.tipo === 'pregunta') void preguntar(pedido.texto);
    else void pedirInforme(pedido.id, pedido.presentarA);
  }, [pedido, pensando, preguntar, pedirInforme, avisoSuelto]);

  /*
    La conversación comparte la pantalla con el mapa —42 % abajo— porque las dos cosas se miran a la
    vez: preguntás y el mapa se mueve. Los expedientes no: ahí se viene a meter archivos y a leer el
    índice, y el mapa no pinta nada. En 42 % de una pantalla vertical la zona de subida quedaba
    reducida a una franja donde no cabe ni la lista de lo que se está subiendo. Esa pestaña toma
    toda la altura.
  */
  const completo = vista !== 'chat';

  return (
    <aside
      className={`absolute z-20 flex flex-col border-white/10 bg-[#0A0C0E]/92 backdrop-blur-xl inset-x-0 bottom-0 border-t ${
        completo ? 'top-[52px]' : ''
      }`}
      style={{
        // En Expedientes manda la clase (toda la altura); en Consulta manda la preferencia.
        height: completo ? undefined : `${alto * 100}%`,
        transition: `transform .4s ease${arrastrando ? '' : ', height .25s ease'}`,
        transform: abierto ? 'none' : 'translateY(100%)',
      }}
    >
      {/* El asa de repartir. En Expedientes no: ahí el panel se lleva la pantalla entera. */}
      {!completo && <Asa alto={alto} onAlto={onAlto} onArrastrar={setArrastrando} />}
      {/* La cabecera: siempre visible, nunca fuera de pantalla, y dice por dónde se sube. */}
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-2 border-b border-white/[0.07] shrink-0" data-tour="pestanas">
        {(['chat', 'expedientes', 'infra'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onVista(v)}
            aria-pressed={vista === v}
            className="px-3 py-1.5 rounded-lg font-mono text-[11px] tracking-[0.14em] uppercase transition-colors cursor-pointer"
            style={
              vista === v
                ? { background: 'rgba(255,174,59,0.14)', color: AMBAR }
                : { color: '#8FA3B0' }
            }
          >
            {v === 'chat' ? (
              'Consulta'
            ) : v === 'expedientes' ? (
              'Expedientes'
            ) : (
              // En un teléfono de 360 px no caben las tres pestañas con el nombre entero.
              <>
                <span className="sm:hidden">Infra</span>
                <span className="hidden sm:inline">Infraestructura</span>
              </>
            )}
          </button>
        ))}
        {/*
         * Borrar la conversación. Hace falta desde que el hilo sobrevive a recargar: quien acaba de
         * consultar el expediente de un concesionario tiene que poder dejar la pantalla limpia antes
         * de que se siente otro. Borra las dos copias, la de la pantalla y la del servidor.
         */}
        {/*
         * EL REPARTO, CON BOTONES. El asa se arrastra, pero no todo el mundo la encuentra ni la puede
         * arrastrar con precisión en un teléfono: tres botones visibles dicen qué se puede hacer.
         */}
        {!completo && (
          <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-white/10 p-0.5" role="group" aria-label="Repartir la pantalla" data-tour="reparto">
            {(
              [
                ['mapa', ALTURAS.mapa, 'Más mapa', 'M3 4h18v12H3z M3 19h18'],
                ['dividido', ALTURAS.dividido, 'Mitad y mitad', 'M3 4h18v7H3z M3 14h18v6H3z'],
                ['lectura', ALTURAS.lectura, 'Más chat', 'M3 4h18v3H3z M3 10h18v10H3z'],
              ] as const
            ).map(([k, v, t, d]) => {
              const activo = repartoDe(alto) === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => onAlto(v)}
                  aria-pressed={activo}
                  title={t}
                  aria-label={t}
                  className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors cursor-pointer"
                  style={activo ? { background: 'rgba(255,174,59,0.16)', color: AMBAR } : { color: '#8FA3B0' }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
                    <path d={d} />
                  </svg>
                  <span className="hidden lg:inline font-mono uppercase tracking-[0.1em]">{t}</span>
                </button>
              );
            })}
          </div>
        )}
        {vista === 'chat' && turnos.length > 0 && (
          <button
            type="button"
            onClick={olvidar}
            disabled={pensando}
            className={`${completo ? 'ml-auto ' : ''}px-2.5 py-1.5 rounded-lg font-mono text-[11px] tracking-[0.14em] uppercase text-[#8FA3B0] hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
            title="Borrar esta conversación, acá y en el servidor"
          >
            Borrar
          </button>
        )}
      </div>

      {vista === 'chat' ? (
        <>
          <div
            ref={hilo}
            onScroll={mirarPosicion}
            className="relative flex-1 overflow-y-auto px-4 py-4 space-y-4 w-full max-w-4xl mx-auto"
          >
            {!turnos.length && (
              <div className="space-y-3">
                <p className="text-sm text-[#8FA3B0] leading-relaxed">
                  Preguntame de minería, o del catastro que tengas cargado. Si nombrás una concesión, el mapa va sola.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {EJEMPLOS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => preguntar(e)}
                      className="px-2.5 py-1 rounded-full border border-white/12 text-[11px] text-[#9FB0B8] hover:text-white hover:border-white/25 transition-colors cursor-pointer text-left"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turnos.map((t, i) => (
              <div key={i} className={t.de === 'persona' ? 'text-right' : ''}>
                {t.de === 'electrum' && t.panel && (
                  <div className="font-mono text-[10px] tracking-[0.16em] uppercase mb-1" style={{ color: AMBAR }}>
                    {t.panel}
                  </div>
                )}
                <div
                  className={`inline-block max-w-[92%] rounded-xl px-3 py-2 text-sm leading-relaxed text-left whitespace-pre-line break-words ${
                    t.de === 'persona' ? 'bg-white/10 text-[#E7EEF2]' : 'bg-white/[0.045] text-[#DDE7EC]'
                  }`}
                >
                  {t.dialogo ? (
                    <div className="space-y-1.5">
                      {t.dialogo.map((l, k) => (
                        <p key={k}>
                          <span className="font-mono text-[10.5px] tracking-[0.08em] uppercase" style={{ color: RETRATOS[l.quien]?.color || AMBAR }}>
                            {l.nombre}
                          </span>{' '}
                          {l.texto.replace(/\[[^\]\n]{1,40}\]\s*/g, '')}
                        </p>
                      ))}
                    </div>
                  ) : (
                    t.texto
                  )}
                </div>
                {t.de === 'electrum' && !t.local && t.trazaId && (
                  <Opinion trazaId={t.trazaId} valor={t.opinion} onValor={(v) => setTurnos((ts) => ts.map((x, k) => (k === i ? { ...x, opinion: v } : x)))} />
                )}
                {t.de === 'electrum' && !t.local && !t.dialogo && t.texto.length > 140 && (
                  <button
                    type="button"
                    disabled={conversando || pensando}
                    onClick={() => void conversar(t.texto)}
                    className="mt-1 block rounded-md px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase text-[#8FA2AC] transition-colors hover:text-[#FFAE3B] disabled:opacity-40 cursor-pointer"
                    title="Dr Electrum y la ingeniera Tatiana se lo explican conversando, cada uno con su voz"
                  >
                    ▶ Como conversación
                  </button>
                )}
                {/*
                  * Un turno que se cortó lleva su pregunta encima, y el botón la repite tal cual.
                  * Sin esto, recuperarse de un corte obliga a volver a escribirla — y si era larga,
                  * a reconstruirla de memoria.
                  */}
                {t.reintentar && (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => preguntar(t.reintentar!)}
                      disabled={pensando}
                      className="rounded-lg border border-white/15 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] uppercase text-[#9FB0B8] transition-colors hover:border-white/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      Volver a preguntar
                    </button>
                  </div>
                )}
                {/* La búsqueda trajo varias: se elige tocando (o diciendo «la segunda»). */}
                {t.opciones && t.opciones.length > 1 && (
                  <div className="mt-1.5 flex max-w-[92%] flex-col gap-1" role="group" aria-label="¿Cuál de estas?">
                    <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-[#7F939D]">¿Cuál de estas?</span>
                    {t.opciones.map((o, k) => (
                      <button
                        key={o.id}
                        type="button"
                        disabled={pensando}
                        onClick={() => void preguntar(`La ${k + 1}: ${o.nombre} (id ${o.id}).`)}
                        className="flex items-baseline gap-2 rounded-lg border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-left transition-colors hover:border-[#FFAE3B]/55 hover:bg-[#FFAE3B]/[0.07] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <span className="font-mono text-[10px] text-[#FFAE3B]">{k + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-[#E7EEF2]">{o.nombre}</span>
                          {o.detalle && <span className="block truncate text-[11px] text-[#7F939D]">{o.detalle}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {t.imagenes?.map((im) => (
                  <div key={im.url}>
                    <MapaDelTurno imagen={im} puedeBajar={!invitado} onAviso={avisoSuelto} onAbrir={() => setVisor({ tipo: 'imagen', nombre: im.nombre, url: im.url, titulo: im.titulo })} />
                  </div>
                ))}
                {t.informe && (
                  // Tocar el PDF lo abre a pantalla completa; bajarlo es aparte, y solo con usuario.
                  <div className="mt-2 flex items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={() => setVisor({ tipo: 'pdf', nombre: t.informe!.nombre, url: t.informe!.url })}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-white/[0.06] cursor-pointer"
                      style={{ borderColor: 'rgba(255,174,59,.35)' }}
                      aria-label={`Abrir ${t.informe.nombre}`}
                    >
                      <span className="font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: AMBAR }}>
                        PDF
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-[#E7EEF2]">{t.informe.nombre}</span>
                        <span className="block font-mono text-[10px] text-[#6C7F89]">
                          {Math.round(t.informe.bytes / 1024)} KB · se guarda media hora · {t.informe.compartido ? 'compartido con el equipo' : 'solo vos'}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-[#9FB0B8]">Abrir ⤢</span>
                    </button>
                    {!invitado && (
                      <button
                        type="button"
                        onClick={() => void bajarInforme(t.informe!).then((m) => m && avisoSuelto(m))}
                        className="flex items-center rounded-lg border border-white/15 px-2.5 font-mono text-[10px] tracking-[0.12em] uppercase text-[#9FB0B8] transition-colors hover:border-white/30 hover:text-white cursor-pointer"
                        aria-label={`Bajar ${t.informe.nombre}`}
                      >
                        Bajar
                      </button>
                    )}
                  </div>
                )}
                {/*
                  * Compartirlo es un ACTO, no el estado por defecto. Un informe de cartera lleva
                  * nombres de concesionarios y hectáreas, así que nace privado de quien lo pidió y
                  * sale de ahí solo si él decide que salga.
                  */}
                {t.informe && !t.informe.compartido && (
                  <button
                    type="button"
                    onClick={() => void compartir(i, t.informe!)}
                    className="mt-1.5 rounded-lg border border-white/15 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] uppercase text-[#9FB0B8] transition-colors hover:border-white/30 hover:text-white cursor-pointer"
                  >
                    Compartir con el equipo
                  </button>
                )}
                {t.traza?.length ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {t.traza.map((h, j) => (
                      <li key={j} className="font-mono text-[10px] text-[#6C7F89]">
                        <Rastro h={h} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}

            {oyendo === 'grabando' && <div className="font-mono text-[11px] text-[#D9705A]">te escucho… tocá «Parar» cuando termines</div>}
            {oyendo === 'oyendo' && <div className="font-mono text-[11px] text-[#6C7F89]">pasando a texto…</div>}
            {pensando && (
              <div className="space-y-1">
                {enVivo.panel && (
                  <div className="font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: AMBAR }}>
                    {enVivo.panel}
                  </div>
                )}
                {enVivo.traza.map((h, i) => (
                  <div key={i} className="font-mono text-[10px] text-[#6C7F89] flex gap-1.5">
                    <span style={{ color: h.ok ? AMBAR : '#D9705A' }}>{h.ok ? '·' : '×'}</span>
                    <span className="truncate">
                      {h.herramienta} — {h.resumen}
                    </span>
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-[#6C7F89]">
                    {enVivo.traza.length ? 'redactando…' : 'pensando…'}
                  </span>
                  {/*
                    * Poder pararlo. Un turno con tres rondas de herramientas puede tardar cincuenta
                    * segundos, y a veces a los cinco ya se sabe que la pregunta estaba mal hecha.
                    * Quedarse mirando «pensando…» sin poder hacer nada es lo que hace que una
                    * pantalla se sienta rota aunque esté trabajando.
                    */}
                  <button
                    type="button"
                    onClick={() => abortoRef.current?.abort(MOTIVO_PARADO)}
                    className="rounded-lg border border-white/15 px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase text-[#9FB0B8] transition-colors hover:border-white/30 hover:text-white cursor-pointer"
                  >
                    Parar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Hay algo nuevo y no estás mirando el final: se avisa, no se te arrastra. */}
          {hayNuevo && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[68px] flex justify-center">
              <button
                type="button"
                onClick={bajarDeltodo}
                className="pointer-events-auto rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.14em] uppercase text-black cursor-pointer"
                style={{ background: AMBAR, borderColor: AMBAR }}
              >
                ↓ Hay respuesta nueva
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              preguntar(texto);
            }}
            className="flex gap-2 p-3 border-t border-white/10 w-full max-w-4xl mx-auto"
          >
            <input
              id="electrum-pregunta"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Preguntale a Dr Electrum…"
              aria-label="Tu pregunta para Dr Electrum"
              data-tour="chat"
              autoComplete="off"
              className="flex-1 min-w-0 bg-white/[0.06] border border-white/12 rounded-lg px-3 py-2 text-sm text-[#E7EEF2] placeholder:text-[#7D909A] focus:outline-none focus:border-[#FFAE3B]/60"
            />
            <button
              type="button"
              onClick={async () => {
                if (pararGrabacion.current) {
                  pararGrabacion.current();
                  pararGrabacion.current = null;
                  return;
                }
                // Si le hablás, te contesta hablando; y si estaba hablando, se calla para escucharte.
                callar();
                setHablando(false);
                if (!vozActivaRef.current) setVozActiva(() => true);
                desbloquear();
                try {
                  pararGrabacion.current = await grabar(
                    (t) => {
                      pararGrabacion.current = null;
                      void preguntar(t);
                    },
                    setOyendo,
                    (m) => {
                      pararGrabacion.current = null;
                      avisoSuelto(m);
                    }
                  );
                } catch {
                  setOyendo('');
                  avisoSuelto('No me dejaron usar el micrófono. Revisá el permiso del navegador.');
                }
              }}
              disabled={pensando || oyendo === 'oyendo'}
              title={oyendo === 'grabando' ? 'Te escucho: cuando te calles lo mando solo (o tocá para mandarlo ya)' : 'Hablale: te contesta en voz alta'}
              aria-label={oyendo === 'grabando' ? 'Parar y mandarme lo que dijiste' : 'Dictarle la pregunta a Dr Electrum'}
              className="shrink-0 rounded-lg border px-2.5 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={
                oyendo === 'grabando'
                  ? { borderColor: '#D9705A', color: '#D9705A' }
                  : { borderColor: 'rgba(255,255,255,.12)', color: '#9FB0B8' }
              }
            >
              {oyendo === 'grabando' ? (
                <>
                  ●<span className="hidden sm:inline"> Escuchando</span>
                </>
              ) : oyendo === 'oyendo' ? (
                '…'
              ) : (
                <>
                  🎙<span className="hidden sm:inline"> Hablar</span>
                </>
              )}
            </button>
            {/*
              * VOZ y PDF se esconden en un menú cuando no hay ancho.
              *
              * En un teléfono de 390 px, cinco controles en fila dejaban el campo de escribir en
              * una rendija: la pregunta, que es lo que se viene a hacer, competía por el ancho con
              * un botón de informe que se usa una vez cada tanto. Escribir, dictar y enviar se
              * quedan siempre; lo demás está a un toque.
              *
              * Dictar NO se esconde: es la razón de que alguien use esto con las manos sucias.
              */}
            <button
              type="button"
              onClick={() => setInternet((v) => !v)}
              aria-pressed={internet}
              title={internet ? 'Buscando en internet: la respuesta cita sus fuentes. Tocá para apagarlo.' : 'Contestar buscando en internet, con las fuentes citadas'}
              aria-label={internet ? 'Apagar la búsqueda en internet' : 'Buscar en internet para contestar'}
              className="shrink-0 rounded-lg border px-2.5 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors cursor-pointer"
              style={internet ? { borderColor: AMBAR, color: '#000', background: AMBAR } : { borderColor: 'rgba(255,255,255,.12)', color: '#9FB0B8' }}
            >
              🌐<span className="hidden sm:inline"> Internet</span>
            </button>
            {/* La voz no se esconde: es lo que hace que el doctor hable. */}
            <BotonVoz
              vozActiva={vozActiva}
              setVozActiva={setVozActiva}
              hablando={hablando}
              onCallar={() => {
                callar();
                setHablando(false);
                onFace('IDLE');
              }}
            />
            <div className="hidden sm:contents">
              <BotonPdf pedirInforme={pedirInforme} pensando={pensando} ficha={enFoco != null} />
            </div>
            <div className="relative shrink-0 sm:hidden">
              <button
                type="button"
                onClick={() => setMasAbierto((v) => !v)}
                aria-expanded={masAbierto}
                aria-label="Más opciones: informe"
                className="h-full rounded-lg border border-white/12 px-2.5 font-mono text-[13px] leading-none text-[#9FB0B8] transition-colors hover:border-white/25 hover:text-white cursor-pointer"
              >
                ⋯
              </button>
              {masAbierto && (
                <div
                  className="absolute bottom-[calc(100%+6px)] right-0 z-40 flex flex-col gap-1.5 rounded-lg border border-white/12 bg-[#0A0C0E] p-1.5 shadow-lg"
                  onClick={() => setMasAbierto(false)}
                >
                  <BotonPdf pedirInforme={pedirInforme} pensando={pensando} ficha={enFoco != null} />
                </div>
              )}
            </div>
            <button
              type="submit"
              aria-label="Preguntar"
              disabled={pensando || !texto.trim()}
              className="px-3.5 rounded-lg text-black text-[12px] font-semibold disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              style={{ background: AMBAR }}
            >
              Ir
            </button>
          </form>
        </>
      ) : vista === 'expedientes' ? (
        <Expedientes onUi={onUi} />
      ) : (
        <InfraYEscuela />
      )}
      {/* Al cuerpo del documento: el panel tiene desenfoque de fondo, y eso encierra lo `fixed` dentro de él. */}
      {visor &&
        createPortal(
          <Visor
            fuente={visor}
            puedeBajar={!invitado}
            onCerrar={() => setVisor(null)}
            onBajar={() => void bajarInforme(visor).then((m) => m && avisoSuelto(m))}
          />,
          document.body
        )}
    </aside>
  );
}

/**
 * El cargador: arrastrar aquí, o elegir.
 *
 * Se sube de uno en uno y en serie, no todos a la vez. Un shapefile de un departamento tarda, y
 * lanzar seis en paralelo contra el mismo PostGIS hace que el recálculo de traslapes se pise
 * consigo mismo. En serie tarda lo mismo y se ve qué está pasando.
 */
function Cargador({
  alCargar,
  alCatastro,
  nivel,
}: {
  alCargar: () => void;
  /** Entró geometría nueva: el mapa tiene que volver a pintar el catastro. */
  alCatastro: () => void;
  nivel: string | null | undefined;
}) {
  /*
   * El servidor ya rechaza las cargas sin permiso —esa es la defensa de verdad y se queda— pero la
   * pantalla ofrecía igualmente arrastrar archivos a quien tiene acceso de consulta. Soltar una
   * carpeta de expedientes, ver cómo suben y que cada uno conteste «tu acceso es de consulta» es
   * una pérdida de tiempo que la interfaz podía haberle ahorrado.
   */
  /*
   * Mientras no se sepa el nivel, se OFRECE.
   *
   * `salud` tarda en contestar porque antes le pregunta al nodo —hasta cuatro segundos, más si el
   * nodo está dormido— y esconder el cargador durante esa espera se lo quita a quien sí puede
   * subir. El error barato es enseñárselo un segundo a quien no puede y que el servidor lo
   * rechace con una frase clara; el caro es que quien viene a cargar el catastro no encuentre
   * dónde hacerlo.
   */
  const puedeCargar = nivel === undefined || nivel === 'escribe' || nivel === 'mando';
  const [encima, setEncima] = useState(false);
  const [cola, setCola] = useState<Array<{ id: number; nombre: string; estado: 'espera' | 'subiendo' | 'ok' | 'falló'; dicho?: string }>>([]);
  const entrada = useRef<HTMLInputElement>(null);

  /*
   * Una cola de verdad, con un solo consumidor.
   *
   * Antes el segundo lote se añadía a la lista visible y después la función se iba porque ya había
   * una carga en marcha; el bucle activo solo recorría SU propio argumento, así que esos archivos
   * se quedaban en «espera» para siempre. Quien suelta una carpeta, ve que tarda y suelta otra
   * —que es lo normal— perdía la segunda sin un solo aviso.
   *
   * Y el estado se casaba por NOMBRE: dos archivos distintos llamados igual —«Area Principal.kml»
   * en dos carpetas de proyecto, que es justo lo que trae un catastro— se pisaban el resultado.
   * Ahora cada trabajo lleva su identificador.
   */
  const pendientes = useRef<Array<{ id: number; archivo: File }>>([]);
  const ocupado = useRef(false);
  const siguienteId = useRef(1);

  const marcar = useCallback((id: number, estado: 'subiendo' | 'ok' | 'falló', dicho?: string) => {
    setCola((c) => c.map((x) => (x.id === id ? { ...x, estado, dicho } : x)));
  }, []);

  const consumir = useCallback(async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    try {
      // Mientras queden: lo que entre a mitad de la carga se recoge en la misma vuelta.
      for (;;) {
        const trabajo = pendientes.current.shift();
        if (!trabajo) break;
        const { id, archivo } = trabajo;
        marcar(id, 'subiendo');
        try {
          const r = await fetch(`/api/electrum/subir?nombre=${encodeURIComponent(archivo.name)}`, {
            method: 'POST',
            // El tipo del navegador si lo sabe: una foto arrastrada desde el móvil puede llegar sin
            // extensión, y por el nombre solo se perdería que era una imagen que hay que leer.
            headers: { 'Content-Type': archivo.type || 'application/octet-stream', ...headersElectrum() },
            body: archivo,
          });
          const j: any = await r.json().catch(() => ({}));
          if (r.status === 401) marcar(id, 'falló', SIN_PUERTA);
          else if (!r.ok) marcar(id, 'falló', j.error || `El servidor contestó ${r.status}.`);
          // `clase: 'nada'` es un 200 que NO guardó nada (formato que no se lee, metros sin .prj):
          // se marca como fallo para que no parezca cargado.
          else if (j.clase === 'nada') marcar(id, 'falló', j.dicho || 'No pude leerlo.');
          else {
            marcar(id, 'ok', j.dicho);
            alCargar();
            // El equipo lo mira: qué es, qué trae y si quiere que lo trabajen.
            comentar(j.clase === 'catastro' || j.clase === 'capa' ? 'general' : 'documento', `Archivo «${archivo.name}». ${String(j.dicho || '')}`);
            if (j.clase === 'catastro' && (j.ui?.concesiones || j.ui?.capa_id)) alCatastro();
          }
        } catch {
          marcar(id, 'falló', 'No alcancé el servidor.');
        }
      }
    } finally {
      ocupado.current = false;
    }
  }, [alCargar, alCatastro, marcar]);

  const subir = useCallback(
    async (archivos: File[]) => {
      if (!archivos.length) return;
      const trabajos = archivos.map((archivo) => ({ id: siguienteId.current++, archivo }));
      pendientes.current.push(...trabajos);
      setCola((c) => [...c, ...trabajos.map((t) => ({ id: t.id, nombre: t.archivo.name, estado: 'espera' as const }))]);
      await consumir();
    },
    [consumir]
  );

  if (!puedeCargar) {
    return (
      <div className="px-4 pb-3">
        <div
          className="rounded-xl border border-dashed px-3 py-3 text-center"
          style={{ borderColor: 'rgba(255,255,255,.10)' }}
        >
          <span className="block text-[12px] leading-relaxed text-[#8FA3B0]">
            Tu acceso es de consulta: podés mirarlo todo y preguntar lo que quieras, pero no cargarle
            nada al cerebro. Pedile a José nivel de trabajo.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-3">
      {/*
        * Un BOTÓN de verdad, no un div clicable.
        *
        * Era un `div` con un `onClick` y un `input` escondido: con el ratón funcionaba y con el
        * teclado no existía — no recibe foco, no se activa con Intro ni con espacio, y un lector de
        * pantalla no tiene forma de anunciar que ahí se suben archivos. Arrastrar y soltar sigue
        * funcionando igual; lo que cambia es que ahora también hay una manera de usarlo sin ratón.
        */}
      <button
        type="button"
        onDragOver={(e) => {
          e.preventDefault();
          setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          void subir([...e.dataTransfer.files]);
        }}
        onClick={() => entrada.current?.click()}
        aria-label="Subir archivos al cerebro: catastro, expedientes o la foto de un papel"
        className="w-full rounded-xl border border-dashed px-3 py-4 text-center cursor-pointer transition-colors focus:outline-none focus-visible:border-[#FFAE3B] focus-visible:ring-2 focus-visible:ring-[#FFAE3B]/40"
        style={{ borderColor: encima ? AMBAR : 'rgba(255,255,255,.16)', background: encima ? 'rgba(255,174,59,.07)' : 'transparent' }}
      >
        <span className="block text-[13px] text-[#B9C7CE]">Arrastrá acá el catastro, un expediente o la foto de un papel</span>
        <span className="mt-0.5 block font-mono text-[10px] text-[#6C7F89]">
          .zip de shapefile · KML · KMZ · GeoJSON · CSV · PDF · JPG · PNG
        </span>
      </button>
      {/* Fuera del botón: un control dentro de otro control no es HTML válido y los clics chocan. */}
      <input
        ref={entrada}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          void subir([...(e.target.files || [])]);
          e.target.value = '';
        }}
      />

      {cola.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {cola.map((x, i) => (
            <li key={x.id} className="text-[12px] leading-snug">
              <div className="flex items-center gap-1.5">
                <span
                  className="font-mono text-[10px]"
                  style={{ color: x.estado === 'ok' ? AMBAR : x.estado === 'falló' ? '#D9705A' : '#6C7F89' }}
                >
                  {x.estado === 'ok' ? '·' : x.estado === 'falló' ? '×' : '…'}
                </span>
                <span className="truncate text-[#DDE7EC]">{x.nombre}</span>
              </div>
              {x.dicho && <div className="pl-4 text-[11px] text-[#8FA3B0]">{x.dicho}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lo que se ha subido y quedó indexado. Sin nada cargado, dice cómo cargarlo. */
/**
 * El estado, en una línea por pieza.
 *
 * Cuando algo falla, lo que se ve es al doctor diciendo que no alcanza su cerebro — y eso no
 * distingue entre el nodo caído, la llave de voz sin poner y el catastro desconectado. Aquí cada
 * pieza responde por sí misma.
 */
function Estado() {
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    fetch('/api/electrum/salud', { headers: headersElectrum() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => setS(null));
  }, []);
  if (!s) return null;

  const filas: Array<[string, boolean, string]> = [
    ['Cerebro', !!s.cerebro?.vivo, s.cerebro?.vivo ? (s.cerebro.modelo ? String(s.cerebro.modelo).split('/').pop() : 'en línea') : s.cerebro?.configurado ? 'no responde' : 'sin configurar'],
    ['Voz', !!s.voz?.llave, s.voz?.llave ? 'servidor propio' : 'sin llave'],
    ['Catastro', !!s.catastro?.viva, s.catastro?.viva ? `${s.catastro.concesiones} concesiones` : s.catastro?.motivo || 'fuera de línea'],
    ['Telegram', !!s.bot, s.bot ? 'escuchando' : 'apagado'],
  ];
  // El vigía del nodo: se levanta solo y aprende de cada caída. Solo si está reportando.
  const cura = s.cerebro?.autocura;
  if (cura?.activa) {
    const hoy = cura.resueltas24h + cura.prevenidas24h;
    filas.push([
      'Autocura',
      cura.sano,
      cura.necesitaPersona
        ? 'no pudo levantarlo solo: necesita una persona'
        : !cura.sano
          ? 'algo no contesta: intentando levantarlo'
          : hoy
        ? `${hoy} ${hoy === 1 ? 'caída resuelta' : 'caídas resueltas'} sola${hoy === 1 ? '' : 's'} hoy${cura.ultima ? ` · la última en ${cura.ultima.duro_s} s` : ''}`
        : `vigilando · ${cura.aprendidas ? `${cura.aprendidas} ${cura.aprendidas === 1 ? 'remedio aprendido' : 'remedios aprendidos'}` : 'sin caídas'}`,
    ]);
  }

  return (
    <section>
      <h3 className="font-mono text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: AMBAR }}>
        Estado
      </h3>
      <ul className="space-y-1">
        {filas.map(([que, ok, detalle]) => (
          <li key={que} className="flex items-baseline gap-2 text-[12px]">
            <span className="font-mono" style={{ color: ok ? AMBAR : '#6C7F89' }}>
              {ok ? '·' : '×'}
            </span>
            <span className="w-[68px] shrink-0 text-[#B9C7CE]">{que}</span>
            <span className="font-mono text-[11px] text-[#6C7F89] truncate">{detalle}</span>
          </li>
        ))}
        <li className="flex items-baseline gap-2 text-[12px] pt-1">
          <span className="font-mono text-[#6C7F89]">·</span>
          <span className="w-[68px] shrink-0 text-[#B9C7CE]">Vos</span>
          <span className="font-mono text-[11px] text-[#6C7F89]">
            {s.quien || 'invitado'} · {s.nivel === 'mando' ? 'mando' : s.nivel === 'escribe' ? 'trabajo' : 'consulta'} · {s.herramientas} herramientas
          </span>
        </li>
      </ul>
    </section>
  );
}

/** Cuántos se piden por página. No es un tope escondido: la pantalla dice cuántos hay en total. */
const PAGINA = 60;

type Indice = {
  capas: Array<{ id: number; nombre: string; formato: string; origen_crs: string; entidades: number; subido?: string }>;
  documentos: Array<{ id: number; nombre: string; tipo: string; paginas: number; subido?: string; subido_por?: string }>;
  totales: { capas: number; documentos: number };
  /** Cuántos hay en total, al margen de la búsqueda. */
  existentes: { capas: number; documentos: number };
  /** Qué puede hacer aquí quien pregunta. Viene con la lista porque `salud` tarda. */
  nivel: string | null;
};

function Expedientes({ onUi }: { onUi: (datos: Array<Record<string, unknown>>) => void }) {
  const [datos, setDatos] = useState<Indice | null>(null);
  /** Por qué no hay lista: la puerta, el servidor (con su código) o la red. */
  const [fallo, setFallo] = useState<'' | 'puerta' | { codigo: number }>('');
  const [vuelta, setVuelta] = useState(0);
  /** Lo que se está buscando. Vacío es «todo». */
  const [busca, setBusca] = useState('');
  /** Lo que se escribe, antes de que pare de escribir. */
  const [escrito, setEscrito] = useState('');
  const [trayendo, setTrayendo] = useState(false);
  /*
   * Tres estados, no dos. `undefined` es «todavía no lo sé» y `null` es «ya pregunté y no tiene
   * nivel» —una llave de demostración—. Colapsarlos en un solo null hacía que el cargador se le
   * ofreciera para siempre a quien solo puede consultar, porque su nivel es null de verdad.
   */
  const [nivel, setNivel] = useState<string | null | undefined>(undefined);

  // No una consulta por tecla: se espera a que termine de escribir.
  useEffect(() => {
    const t = setTimeout(() => setBusca(escrito.trim()), 300);
    return () => clearTimeout(t);
  }, [escrito]);

  useEffect(() => {
    const q = busca ? `&q=${encodeURIComponent(busca)}` : '';
    let vivo = true;
    // Cada intento empieza limpio: un fallo viejo no puede quedarse pegado a la búsqueda de ahora.
    setFallo('');
    fetch(`/api/electrum/expedientes?limite=${PAGINA}${q}`, { headers: headersElectrum() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: Indice) => {
        if (!vivo) return;
        setDatos(j);
        setNivel(j.nivel ?? null);
      })
      .catch((e) => vivo && setFallo(e === 401 ? 'puerta' : { codigo: typeof e === 'number' ? e : 0 }));
    return () => {
      vivo = false;
    };
  }, [vuelta, busca]);

  const recargar = useCallback(() => setVuelta((v) => v + 1), []);

  /**
   * Volver a pintar el catastro después de una carga.
   *
   * El mapa pedía el catastro UNA vez, al abrirse. Quien subía un shapefile veía «quedaron 40 en el
   * catastro» y el mapa seguía igual hasta recargar la página: parecía que no había entrado. Se pide
   * sin caché —la ruta se guarda un minuto en el navegador— y se le pasa al mapa como una capa más.
   */
  const repintar = useCallback(async () => {
    try {
      const r = await fetch('/api/electrum/catastro.geojson', { headers: headersElectrum(), cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      // Sin encuadre: se repinta donde esté mirando; que el mapa salte a todo el país cada vez que
      // alguien sube un archivo le haría perder la concesión que estaba revisando.
      if (j?.geojson?.features?.length) onUi([{ accion: 'capa', geojson: j.geojson }]);
    } catch {
      /* el índice ya dice lo que entró; el mapa se pondrá al día al recargar */
    }
  }, [onUi]);

  /** Traer la página siguiente y pegarla a lo que ya hay. */
  const traerMas = useCallback(async () => {
    if (!datos || trayendo) return;
    setTrayendo(true);
    try {
      const desde = Math.max(datos.capas.length, datos.documentos.length);
      const q = busca ? `&q=${encodeURIComponent(busca)}` : '';
      const r = await fetch(`/api/electrum/expedientes?limite=${PAGINA}&desde=${desde}${q}`, {
        headers: headersElectrum(),
      });
      if (!r.ok) return;
      const j: Indice = await r.json();
      setDatos((d) =>
        d
          ? { ...j, capas: [...d.capas, ...j.capas], documentos: [...d.documentos, ...j.documentos] }
          : j
      );
    } finally {
      setTrayendo(false);
    }
  }, [datos, busca, trayendo]);

  if (fallo === 'puerta') return <div className="p-4 text-sm text-[#8FA3B0] leading-relaxed">{SIN_PUERTA}</div>;
  if (fallo) {
    /*
     * Antes cualquier fallo se contaba como «falta ELECTRUM_DB_URL»: un 503 porque la base se
     * reinicia, o el wifi del hotel, se le explicaban a quien miraba como una variable sin poner.
     * Sin catastro conectado la ruta contesta 200 con `catastro: false`, y eso se dice abajo.
     */
    return (
      <div className="p-4 text-sm text-[#8FA3B0] leading-relaxed space-y-3" role="alert">
        <p>
          {fallo.codigo
            ? `No alcancé el catastro: el servidor contestó ${fallo.codigo}. No es tu acceso; probá de nuevo en un momento.`
            : 'No alcancé el servidor. Revisá la conexión y volvé a intentarlo.'}
        </p>
        <button
          type="button"
          onClick={recargar}
          className="rounded-lg border border-white/15 px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase text-[#9FB0B8] hover:border-white/30 hover:text-white cursor-pointer"
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (!datos) return <div className="p-4 font-mono text-[11px] text-[#6C7F89]" role="status">cargando…</div>;
  if ((datos as any).catastro === false) {
    return (
      <div className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto">
        <div className="p-4 pb-1">
          <Estado />
        </div>
        <p className="p-4 pt-2 text-sm text-[#8FA3B0] leading-relaxed">
          El catastro no está conectado en este servidor, así que no hay capas ni expedientes que mostrar ni dónde guardar lo que subas.
        </p>
      </div>
    );
  }

  const vacio = !datos.capas.length && !datos.documentos.length;
  const total = (datos.totales?.capas || 0) + (datos.totales?.documentos || 0);
  /*
   * «No existe» y «no está en esta búsqueda» no se pueden ver igual en un registro: quien busca
   * «Quebrada Seca» y ve la pantalla de «todavía no hay nada cargado» concluye que el catastro está
   * vacío. Con una búsqueda en curso, el vacío se cuenta como lo que es.
   */
  if (vacio && busca) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4 w-full max-w-4xl mx-auto">
        <Buscador escrito={escrito} setEscrito={setEscrito} />
        <p className="text-sm text-[#8FA3B0] leading-relaxed">
          Nada que se llame «{busca}». Hay {datos.existentes?.capas ?? 0} capas y{' '}
          {datos.existentes?.documentos ?? 0} expedientes cargados en total; borrá la búsqueda para verlos.
        </p>
      </div>
    );
  }
  if (vacio) {
    return (
      <div className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto">
        <div className="p-4 pb-1">
          <Estado />
        </div>
        <div className="p-4 pt-2 pb-2 space-y-2 text-sm text-[#8FA3B0] leading-relaxed">
          <p>Todavía no hay nada cargado.</p>
          <p>Lo geográfico se vuelve mapa, medido sobre el elipsoide. Los documentos quedan citables con su página.</p>
        </div>
        <Cargador alCargar={recargar} alCatastro={repintar} nivel={nivel} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 pt-4 space-y-5 w-full max-w-4xl mx-auto">
      <Estado />
      {/*
        El cargador va ARRIBA, no al final. Estaba debajo de las dos listas, y en la web vertical
        —donde el panel es el 42 % de la pantalla— eso significa bajar hasta el fondo para
        encontrarlo. Quien abre esta pestaña casi siempre viene a añadir algo, no a leer el índice:
        lo primero que se ve tiene que ser por dónde se mete.
      */}
      <Cargador alCargar={recargar} alCatastro={repintar} nivel={nivel} />
      <Buscador escrito={escrito} setEscrito={setEscrito} />
      {datos.capas.length > 0 && (
        <section>
          <h3 className="font-mono text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: AMBAR }}>
            Capas del mapa <Cuenta hay={datos.capas.length} de={datos.totales?.capas} />
          </h3>
          <ul className="space-y-1.5">
            {datos.capas.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="text-[#E7EEF2]">{c.nombre}</div>
                <div className="font-mono text-[11px] text-[#6C7F89]">
                  {c.entidades} entidades · {c.formato} · {c.origen_crs}
                  {c.subido ? ` · ${fecha(c.subido)}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {datos.documentos.length > 0 && (
        <section>
          <h3 className="font-mono text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: AMBAR }}>
            Expedientes <Cuenta hay={datos.documentos.length} de={datos.totales?.documentos} />
          </h3>
          <ul className="space-y-1.5">
            {datos.documentos.map((d) => (
              <li key={d.id} className="text-sm">
                <div className="text-[#E7EEF2]">{d.nombre}</div>
                <div className="font-mono text-[11px] text-[#6C7F89]">
                  {d.tipo} · {d.paginas} {d.paginas === 1 ? 'página' : 'páginas'}
                  {d.subido ? ` · ${fecha(d.subido)}` : ''}
                  {d.subido_por ? ` · ${d.subido_por}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(datos.capas.length < (datos.totales?.capas ?? 0) ||
        datos.documentos.length < (datos.totales?.documentos ?? 0)) && (
        <button
          type="button"
          onClick={() => void traerMas()}
          disabled={trayendo}
          className="w-full rounded-lg border border-white/12 py-2 font-mono text-[11px] tracking-[0.14em] uppercase text-[#9FB0B8] transition-colors hover:border-white/25 hover:text-white disabled:opacity-40 cursor-pointer"
        >
          {trayendo ? 'trayendo…' : 'Ver más'}
        </button>
      )}
    </div>
  );
}

/**
 * La voz: encendida (🔊), apagada (🔇), o —mientras habla— «Callar». Siempre visible, también en
 * el teléfono: escondida en un menú, nadie sabía que el doctor podía hablar.
 */
function BotonVoz({
  vozActiva,
  setVozActiva,
  hablando,
  onCallar,
}: {
  vozActiva: boolean;
  setVozActiva: (f: (v: boolean) => boolean) => void;
  hablando: boolean;
  onCallar: () => void;
}) {
  if (hablando) {
    return (
      <button
        type="button"
        onClick={onCallar}
        title="Que se calle ahora"
        className="shrink-0 animate-pulse rounded-lg border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] uppercase cursor-pointer"
        style={{ borderColor: AMBAR, color: AMBAR }}
      >
        ■<span className="hidden sm:inline"> Callar</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setVozActiva((v) => !v)}
      title={vozActiva ? 'Dr Electrum contesta en voz alta. Tocá para silenciarlo.' : 'Dr Electrum está en silencio. Tocá para que conteste en voz alta.'}
      aria-label={vozActiva ? 'Voz encendida: tocá para silenciar' : 'Voz apagada: tocá para que hable'}
      aria-pressed={vozActiva}
      className="shrink-0 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors cursor-pointer"
      style={vozActiva ? { borderColor: AMBAR, color: AMBAR } : { borderColor: 'rgba(255,255,255,.12)', color: '#9FB0B8' }}
    >
      {vozActiva ? '🔊' : '🔇'}
      <span className="hidden sm:inline"> Voz</span>
    </button>
  );
}

function BotonPdf({ pedirInforme, pensando, ficha }: { pedirInforme: () => void; pensando: boolean; ficha: boolean }) {
  return (
    <button
      type="button"
      onClick={pedirInforme}
      disabled={pensando}
      title={ficha ? 'Ficha en PDF de la concesión que estás mirando, con el mapa' : 'Informe de la cartera en PDF, con el mapa como se está viendo'}
      className="shrink-0 rounded-lg border border-white/12 px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] uppercase text-[#9FB0B8] transition-colors hover:border-white/25 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
    >
      PDF
    </button>
  );
}

/**
 * EL ASA DE REPARTIR LA PANTALLA.
 *
 * Un solo elemento para las tres maneras de usarlo, que es lo que hace que no haya que explicarlo:
 *
 *  · **Arrastrar** con ratón o con el dedo: reparto libre, del 12 % al 86 %.
 *  · **Tocar** sin arrastrar: rueda entre los tres repartos —mapa, dividido, lectura—. En un
 *    teléfono nadie arrastra con precisión, y tocar es lo que se intenta primero.
 *  · **Teclado**: con foco, las flechas mueven de cinco en cinco e Inicio/Fin van a los extremos.
 *    Es un `separator` con `aria-valuenow`, que es lo que un lector de pantalla sabe leer.
 *
 * Se distingue tocar de arrastrar por distancia recorrida, no por tiempo: un dedo sobre vidrio
 * siempre se mueve un par de píxeles, y medir por tiempo convertiría cualquier toque lento en un
 * arrastre de cero píxeles que no cambia nada y parece que el botón no responde.
 */
function Asa({
  alto,
  onAlto,
  onArrastrar,
}: {
  alto: number;
  onAlto: (v: number) => void;
  onArrastrar: (v: boolean) => void;
}) {
  const movido = useRef(0);

  const alBajar = useCallback(
    (e: PunteroReact<HTMLDivElement>) => {
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      movido.current = 0;
      onArrastrar(true);

      const mover = (ev: PointerEvent) => {
        movido.current = Math.max(movido.current, Math.abs(ev.clientY - e.clientY));
        // El panel crece hacia ARRIBA: cuanto más alto el puntero, mayor la fracción.
        onAlto(1 - ev.clientY / Math.max(1, window.innerHeight));
      };
      const soltar = () => {
        el.releasePointerCapture?.(e.pointerId);
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
        onArrastrar(false);
        // Menos de cuatro píxeles es un toque, no un arrastre.
        if (movido.current < 4) onAlto(siguienteReparto(alto));
      };
      window.addEventListener('pointermove', mover);
      window.addEventListener('pointerup', soltar);
    },
    [alto, onAlto, onArrastrar]
  );

  const alTeclado = useCallback(
    (e: TeclaReact) => {
      const paso = 0.05;
      if (e.key === 'ArrowUp') onAlto(alto + paso);
      else if (e.key === 'ArrowDown') onAlto(alto - paso);
      else if (e.key === 'Home') onAlto(ALTURAS.lectura);
      else if (e.key === 'End') onAlto(ALTURAS.mapa);
      else if (e.key === 'Enter' || e.key === ' ') onAlto(siguienteReparto(alto));
      else return;
      e.preventDefault();
    },
    [alto, onAlto]
  );

  const donde = repartoDe(alto);
  const comoSeLlama = donde === 'mapa' ? 'mapa grande' : donde === 'lectura' ? 'lectura' : 'dividido';

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Repartir la pantalla entre mapa y conversación — ahora en ${comoSeLlama}`}
      aria-valuenow={Math.round(alto * 100)}
      aria-valuemin={12}
      aria-valuemax={86}
      tabIndex={0}
      onPointerDown={alBajar}
      onKeyDown={alTeclado}
      title={`${comoSeLlama} · arrastrá para repartir, tocá para cambiar`}
      className="group absolute inset-x-0 -top-2 z-30 flex h-4 cursor-ns-resize touch-none items-center justify-center focus:outline-none"
    >
      <span
        className="h-1 w-12 rounded-full bg-white/20 transition-colors group-hover:bg-white/40 group-focus-visible:bg-[#FFAE3B]"
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * UNA LÍNEA DE LA TRAZA, QUE SE PUEDE ABRIR.
 *
 * La traza es lo que separa esto de un chatbot que suena convincente: «consultó el catastro, midió
 * sobre el elipsoide, encontró el traslape» vale más que la respuesta sola. Pero estaba recortada a
 * una línea con puntos suspensivos, y un resumen cortado no es evidencia — justo donde decía cuántas
 * concesiones encontró o qué área midió, la frase se acababa.
 *
 * Ahora se abre. Y al abrirse enseña también cuánto tardó, que es lo que contesta «¿esto lo
 * consultó de verdad o se lo inventó?»: una herramienta que tarda ochenta milisegundos fue a la
 * base, una que tarda cero no hizo nada.
 */
function Rastro({ h }: { h: { herramienta: string; ok: boolean; resumen: string; ms?: number } }) {
  const [abierto, setAbierto] = useState(false);
  const largo = h.resumen.length > 64;
  return (
    <>
      <button
        type="button"
        onClick={() => largo && setAbierto((v) => !v)}
        aria-expanded={largo ? abierto : undefined}
        className={`flex w-full gap-1.5 text-left ${largo ? 'cursor-pointer hover:text-[#9FB0B8]' : 'cursor-default'}`}
      >
        <span style={{ color: h.ok ? AMBAR : '#D9705A' }}>{h.ok ? '·' : '×'}</span>
        <span className={abierto ? 'flex-1 whitespace-pre-wrap break-words' : 'flex-1 truncate'}>
          {h.herramienta} — {h.resumen}
        </span>
        {largo && <span className="shrink-0 opacity-60">{abierto ? '▴' : '▾'}</span>}
      </button>
      {abierto && h.ms != null && (
        <div className="pl-[14px] pt-0.5 opacity-70">
          tardó {h.ms} ms{h.ms < 2 ? ' · tan rápido que salió de algo ya cargado, no de una consulta nueva' : ''}
        </div>
      )}
    </>
  );
}

/**
 * Cuándo entró. Es de las cosas que más se preguntan de un registro —«¿esto es el padrón de junio o
 * el de antes?»— y no se veía por ningún lado.
 */
function fecha(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

/** «12 de 125». Sin esto, una lista truncada parece una lista completa. */
function Cuenta({ hay, de }: { hay: number; de?: number }) {
  if (de == null || de <= hay) return <span className="text-[#6C7F89] normal-case tracking-normal">· {hay}</span>;
  return (
    <span className="text-[#6C7F89] normal-case tracking-normal">
      · {hay} de {de}
    </span>
  );
}

function Buscador({ escrito, setEscrito }: { escrito: string; setEscrito: (v: string) => void }) {
  return (
    <input
      value={escrito}
      onChange={(e) => setEscrito(e.target.value)}
      placeholder="Buscar por nombre en capas y expedientes…"
      aria-label="Buscar en capas y expedientes"
      className="w-full rounded-lg bg-white/[0.06] border border-white/12 px-3 py-2 text-sm text-[#E7EEF2] placeholder:text-[#7D909A] focus:outline-none focus:border-[#FFAE3B]/60"
    />
  );
}

/**
 * Infraestructura tiene dos partes: lo que sabe Dr Electrum (la biblioteca) y la Escuela, donde el
 * equipo revisa lo que contestó la mesa para entrenar a Laya y a Qwen.
 */
function InfraYEscuela() {
  const [parte, setParte] = useState<'conocimiento' | 'escuela'>('conocimiento');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-white/[0.06] px-3 pt-2" role="tablist" aria-label="Infraestructura">
        {(
          [
            ['conocimiento', 'Conocimiento'],
            ['escuela', 'Escuela'],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={parte === k}
            onClick={() => setParte(k)}
            data-tour={k === 'escuela' ? 'escuela' : undefined}
            className="-mb-px border-b-2 px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors cursor-pointer"
            style={parte === k ? { borderColor: AMBAR, color: AMBAR } : { borderColor: 'transparent', color: '#8FA2AC' }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{parte === 'conocimiento' ? <Biblioteca /> : <Escuela />}</div>
    </div>
  );
}
