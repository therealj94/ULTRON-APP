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
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaceState } from '../../src/types';
import type { Emocion } from '../../lib/emocion';
import { capturaDelMapa } from '../mapa/Mapa';
import { sinMovimiento } from '../movimiento';
import { headersElectrum, SIN_PUERTA } from '../acceso';

type Props = {
  abierto: boolean;
  vista: 'chat' | 'expedientes';
  onFace: (f: FaceState) => void;
  onEmocion: (e: Emocion) => void;
  onUi: (datos: Array<Record<string, unknown>>) => void;
  onTrabajo: () => void;
  onVista: (v: 'chat' | 'expedientes') => void;
};

type Turno = {
  de: 'persona' | 'electrum';
  texto: string;
  panel?: string;
  traza?: Array<{ herramienta: string; ok: boolean; resumen: string }>;
  /** Si el turno produjo un informe, queda a mano para bajarlo. */
  informe?: { nombre: string; url: string; bytes: number; compartido?: boolean };
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
};

const AMBAR = '#FFAE3B';

/**
 * Que el Doctor se escuche.
 *
 * Un solo elemento de audio, reusado: crear uno por respuesta deja al navegador con una pila de
 * reproductores y, si alguien pregunta dos veces seguidas, las dos voces se pisan. Al pedir una
 * nueva se corta la anterior, que es lo que hace una persona cuando la interrumpen.
 */
let sonando: HTMLAudioElement | null = null;

/*
 * Cada petición de voz nace con un número. Silenciar sube el número y con eso invalida todo lo que
 * venía en camino.
 *
 * Silenciar solo cambiaba un booleano: no paraba lo que ya sonaba, y una petición lanzada un
 * segundo antes llegaba después y se reproducía igual. Quien silencia en una reunión lo hace
 * porque quiere silencio AHORA, no a partir del siguiente turno.
 */
let generacionVoz = 0;

/** Corta lo que suena e invalida lo que viene. Se puede llamar siempre, incluso sin nada sonando. */
export function callar() {
  generacionVoz++;
  if (sonando) {
    try {
      sonando.pause();
      sonando.currentTime = 0;
    } catch {
      /* el navegador ya lo había soltado */
    }
    sonando = null;
  }
}

/**
 * Hablarle. El navegador graba en webm/opus, que es lo que da `MediaRecorder` en Chrome y Firefox;
 * Safari da mp4. Se manda el mime tal cual en vez de suponerlo: el transcriptor lo necesita para
 * saber qué está abriendo, y adivinarlo mal devuelve una transcripción vacía sin decir por qué.
 */
async function grabar(alTexto: (t: string) => void, alEstado: (s: 'grabando' | 'oyendo' | '') => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const trozos: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && trozos.push(e.data);
  rec.onstop = async () => {
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
      const j = await r.json().catch(() => ({}));
      if (j.texto) alTexto(j.texto);
    } finally {
      alEstado('');
    }
  };
  rec.start();
  alEstado('grabando');
  return () => rec.state !== 'inactive' && rec.stop();
}

async function decirEnVoz(texto: string, emocion: string | undefined, headers: Record<string, string>) {
  const mia = ++generacionVoz;
  try {
    sonando?.pause();
    const r = await fetch('/api/electrum/voz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ texto: texto.slice(0, 1200), emocion }),
    });
    if (!r.ok) return;
    const blob = await r.blob();
    // Si silenciaron mientras esto venía, no suena: ni se crea el reproductor.
    if (mia !== generacionVoz) return;
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    sonando = a;
    a.onended = () => URL.revokeObjectURL(url);
    if (mia !== generacionVoz) {
      URL.revokeObjectURL(url);
      return;
    }
    await a.play().catch(() => URL.revokeObjectURL(url));
  } catch {
    /* sin voz se sigue leyendo; no es motivo para romper el turno */
  }
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

export function Panel({ abierto, vista, onFace, onEmocion, onUi, onTrabajo, onVista }: Props) {
  const [turnos, setTurnos] = useState<Turno[]>(hiloGuardado);
  /*
   * `preguntar` no puede depender de `turnos` —se reharía en cada mensaje y con él todo lo que
   * cuelga— pero necesita el hilo del momento para mandarlo. Una ref siempre tiene el de ahora.
   */
  const turnosRef = useRef<Turno[]>(turnos);
  turnosRef.current = turnos;
  /** El turno en vuelo, para poder pararlo desde el botón o al irse de la pantalla. */
  const abortoRef = useRef<AbortController | null>(null);

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
  // Arranca apagada: un navegador no deja sonar nada hasta que alguien toca algo, y una demo que
  // empieza hablando sola en una sala de reunión es peor que una que espera a que se lo pidan.
  const [vozActiva, setVozActiva] = useState(false);
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

  const mirarPosicion = useCallback(() => {
    const el = hilo.current;
    if (!el) return;
    // 40 px de margen: nadie deja el desplazamiento clavado al píxel.
    alFinal.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (alFinal.current) setHayNuevo(false);
  }, []);

  const bajarDeltodo = useCallback(() => {
    const el = hilo.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: sinMovimiento() ? 'auto' : 'smooth' });
    alFinal.current = true;
    setHayNuevo(false);
  }, []);

  useEffect(() => {
    if (alFinal.current) bajarDeltodo();
    else if (turnos.length) setHayNuevo(true);
  }, [turnos, pensando, bajarDeltodo]);

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

  const preguntar = useCallback(
    async (pregunta: string) => {
      const q = pregunta.trim();
      if (!q || pensando) return;
      setTexto('');
      setTurnos((t) => [...t, { de: 'persona', texto: q }]);
      setEnVivo({ panel: '', traza: [] });
      setPensando(true);
      onFace('THINKING');
      onTrabajo();

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

        while (!terminado) {
          const { done, value } = await lector.read();
          if (done) break;
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
                else if (evento === 'herramienta') setEnVivo((v) => ({ ...v, traza: [...v.traza, d] }));
                else if (evento === 'ui') onUi([d]); // el mapa se mueve YA, no al final
                else if (evento === 'error') {
                  cerrado = true;
                  avisar(d.error, q);
                  onFace('CONCERNED');
                  terminado = true;
                } else if (evento === 'fin') {
                  cerrado = true;
                  onFace('SPEAKING');
                  if (d.emocion) onEmocion(d.emocion);
                  if (vozActivaRef.current && d.texto) void decirEnVoz(d.texto, d.emocion, headersElectrum());
                  setTurnos((t) => [...t, { de: 'electrum', texto: d.texto || 'No pude contestar.', panel: d.panel, traza: d.traza }]);
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
        setTimeout(() => onFace('IDLE'), 1200);
      }
    },
    [pensando, onFace, onEmocion, onUi, onTrabajo, avisar]
  );

  /** Abrir un informe a la junta. Solo puede hacerlo quien lo pidió; el servidor lo comprueba. */
  const compartir = useCallback(
    async (indice: number, informe: { url: string }) => {
      try {
        const r = await fetch(`${informe.url}/compartir`, { method: 'POST', headers: headersElectrum() });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}) as any);
          avisar(j?.error || `No pude compartirlo: el servidor contestó ${r.status}.`);
          return;
        }
        setTurnos((t) =>
          t.map((x, j) => (j === indice && x.informe ? { ...x, informe: { ...x.informe, compartido: true } } : x))
        );
      } catch {
        avisar('No alcancé el servidor para compartir el informe.');
      }
    },
    [avisar]
  );

  /** Borra el hilo de las dos puntas. Si el servidor no contesta, al menos la pantalla queda limpia. */
  const olvidar = useCallback(() => {
    setTurnos([]);
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
  const pedirInforme = useCallback(async () => {
    if (pensando) return;
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
        body: JSON.stringify({ tipo: 'cartera', mapa: 'imagen' in foto ? foto.imagen : null }),
      });
      const j = await r.json();
      if (!r.ok) {
        setTurnos((t) => [...t, { de: 'electrum', texto: j.error || 'No pude armar el informe.' }]);
      } else {
        // Si el mapa no entró, se dice EN la misma respuesta. Un informe sin mapa y sin explicación
        // parece roto; uno que dice por qué es un informe honesto.
        const texto = 'falta' in foto ? `${j.dicho}\n\nVa sin mapa: ${foto.falta}` : j.dicho;
        setTurnos((t) => [...t, { de: 'electrum', texto, informe: { nombre: j.nombre, url: j.url, bytes: j.bytes } }]);
      }
    } catch {
      setTurnos((t) => [...t, { de: 'electrum', texto: 'No alcancé el servidor para armar el informe.' }]);
    } finally {
      setPensando(false);
      setTimeout(() => onFace('IDLE'), 900);
    }
  }, [pensando, onFace, onTrabajo]);

  /*
    La conversación comparte la pantalla con el mapa —42 % abajo— porque las dos cosas se miran a la
    vez: preguntás y el mapa se mueve. Los expedientes no: ahí se viene a meter archivos y a leer el
    índice, y el mapa no pinta nada. En 42 % de una pantalla vertical la zona de subida quedaba
    reducida a una franja donde no cabe ni la lista de lo que se está subiendo. Esa pestaña toma
    toda la altura.
  */
  const completo = vista === 'expedientes';

  return (
    <aside
      className={`absolute z-20 flex flex-col border-white/10 bg-[#0A0C0E]/92 backdrop-blur-xl inset-x-0 bottom-0 border-t ${
        completo ? 'top-[52px]' : 'h-[42%]'
      }`}
      style={{ transition: 'transform .4s ease', transform: abierto ? 'none' : 'translateY(100%)' }}
    >
      {/* La cabecera: siempre visible, nunca fuera de pantalla, y dice por dónde se sube. */}
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-2 border-b border-white/[0.07] shrink-0">
        {(['chat', 'expedientes'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onVista(v)}
            className="px-3 py-1.5 rounded-lg font-mono text-[11px] tracking-[0.14em] uppercase transition-colors cursor-pointer"
            style={
              vista === v
                ? { background: 'rgba(255,174,59,0.14)', color: AMBAR }
                : { color: '#8FA3B0' }
            }
          >
            {v === 'chat' ? 'Consulta' : 'Expedientes'}
          </button>
        ))}
        {/*
         * Borrar la conversación. Hace falta desde que el hilo sobrevive a recargar: quien acaba de
         * consultar el expediente de un concesionario tiene que poder dejar la pantalla limpia antes
         * de que se siente otro. Borra las dos copias, la de la pantalla y la del servidor.
         */}
        {vista === 'chat' && turnos.length > 0 && (
          <button
            type="button"
            onClick={olvidar}
            disabled={pensando}
            className="ml-auto px-2.5 py-1.5 rounded-lg font-mono text-[11px] tracking-[0.14em] uppercase text-[#8FA3B0] hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
                  className={`inline-block max-w-[92%] rounded-xl px-3 py-2 text-sm leading-relaxed text-left ${
                    t.de === 'persona' ? 'bg-white/10 text-[#E7EEF2]' : 'bg-white/[0.045] text-[#DDE7EC]'
                  }`}
                >
                  {t.texto}
                </div>
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
                {t.informe && (
                  <button
                    type="button"
                    onClick={() => void bajarInforme(t.informe!).then((m) => m && avisar(m))}
                    className="mt-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-white/[0.06] cursor-pointer"
                    style={{ borderColor: 'rgba(255,174,59,.35)' }}
                  >
                    <span className="font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: AMBAR }}>
                      PDF
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-[#E7EEF2]">{t.informe.nombre}</span>
                      <span className="block font-mono text-[10px] text-[#6C7F89]">
                        {Math.round(t.informe.bytes / 1024)} KB · se guarda media hora · {t.informe.compartido ? 'lo ve la junta' : 'solo vos'}
                      </span>
                    </span>
                  </button>
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
                    Compartir con la junta
                  </button>
                )}
                {t.traza?.length ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {t.traza.map((h, j) => (
                      <li key={j} className="font-mono text-[10px] text-[#6C7F89] flex gap-1.5">
                        <span style={{ color: h.ok ? AMBAR : '#D9705A' }}>{h.ok ? '·' : '×'}</span>
                        <span className="truncate">
                          {h.herramienta} — {h.resumen}
                        </span>
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
              className="flex-1 min-w-0 bg-white/[0.06] border border-white/12 rounded-lg px-3 py-2 text-sm text-[#E7EEF2] placeholder:text-[#5E7078] focus:outline-none focus:border-[#FFAE3B]/60"
            />
            <button
              type="button"
              onClick={async () => {
                if (pararGrabacion.current) {
                  pararGrabacion.current();
                  pararGrabacion.current = null;
                  return;
                }
                try {
                  pararGrabacion.current = await grabar((t) => void preguntar(t), setOyendo);
                } catch {
                  setOyendo('');
                  setTurnos((t) => [...t, { de: 'electrum', texto: 'No me dejaron usar el micrófono. Revisá el permiso del navegador.' }]);
                }
              }}
              disabled={pensando || oyendo === 'oyendo'}
              title={oyendo === 'grabando' ? 'Parar y mandarme lo que dijiste' : 'Hablarme'}
              className="shrink-0 rounded-lg border px-2.5 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={
                oyendo === 'grabando'
                  ? { borderColor: '#D9705A', color: '#D9705A' }
                  : { borderColor: 'rgba(255,255,255,.12)', color: '#9FB0B8' }
              }
            >
              {oyendo === 'grabando' ? 'Parar' : oyendo === 'oyendo' ? '…' : 'Decir'}
            </button>
            <button
              type="button"
              onClick={() =>
                setVozActiva((v) => {
                  // Al silenciar se corta lo que suena y se invalida lo que viene; no basta el booleano.
                  if (v) callar();
                  return !v;
                })
              }
              title={vozActiva ? 'Silenciar a Dr Electrum' : 'Que Dr Electrum hable'}
              aria-pressed={vozActiva}
              className="shrink-0 rounded-lg border px-2.5 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors cursor-pointer"
              style={
                vozActiva
                  ? { borderColor: AMBAR, color: AMBAR }
                  : { borderColor: 'rgba(255,255,255,.12)', color: '#9FB0B8' }
              }
            >
              Voz
            </button>
            <button
              type="button"
              onClick={pedirInforme}
              disabled={pensando}
              title="Informe de la cartera en PDF, con el mapa como se está viendo"
              className="shrink-0 rounded-lg border border-white/12 px-2.5 font-mono text-[10px] tracking-[0.12em] uppercase text-[#9FB0B8] transition-colors hover:border-white/25 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              PDF
            </button>
            <button
              type="submit"
              disabled={pensando || !texto.trim()}
              className="px-3.5 rounded-lg text-black text-[12px] font-semibold disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              style={{ background: AMBAR }}
            >
              Ir
            </button>
          </form>
        </>
      ) : (
        <Expedientes />
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
function Cargador({ alCargar, nivel }: { alCargar: () => void; nivel: string | null | undefined }) {
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
          const j = await r.json().catch(() => ({}));
          if (!r.ok) marcar(id, 'falló', j.error || `Error ${r.status}`);
          else {
            marcar(id, 'ok', j.dicho);
            alCargar();
          }
        } catch {
          marcar(id, 'falló', 'No alcancé el servidor.');
        }
      }
    } finally {
      ocupado.current = false;
    }
  }, [alCargar, marcar]);

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
    ['Cerebro', !!s.cerebro?.vivo, s.cerebro?.vivo ? String(s.cerebro.modelo).split('/').pop() : s.cerebro?.configurado ? 'no responde' : 'sin configurar'],
    ['Voz', !!s.voz?.llave, s.voz?.llave ? 'ElevenLabs' : 'sin llave'],
    ['Catastro', !!s.catastro?.viva, s.catastro?.viva ? `${s.catastro.concesiones} concesiones` : s.catastro?.motivo || 'fuera de línea'],
    ['Telegram', !!s.bot, s.bot ? 'escuchando' : 'apagado'],
  ];

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

function Expedientes() {
  const [datos, setDatos] = useState<Indice | null>(null);
  const [fallo, setFallo] = useState<'' | 'puerta' | 'base'>('');
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
    fetch(`/api/electrum/expedientes?limite=${PAGINA}${q}`, { headers: headersElectrum() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: Indice) => {
        setDatos(j);
        setNivel(j.nivel ?? null);
      })
      .catch((e) => setFallo(e === 401 ? 'puerta' : 'base'));
  }, [vuelta, busca]);

  const recargar = useCallback(() => setVuelta((v) => v + 1), []);

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
    return (
      <div className="p-4 text-sm text-[#8FA3B0] leading-relaxed">
        No alcancé el catastro. Si todavía no está conectado, es normal: falta <code className="font-mono text-xs">ELECTRUM_DB_URL</code>.
      </div>
    );
  }
  if (!datos) return <div className="p-4 font-mono text-[11px] text-[#6C7F89]">cargando…</div>;

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
        <Cargador alCargar={recargar} nivel={nivel} />
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
      <Cargador alCargar={recargar} nivel={nivel} />
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
      className="w-full rounded-lg bg-white/[0.06] border border-white/12 px-3 py-2 text-sm text-[#E7EEF2] placeholder:text-[#5E7078] focus:outline-none focus:border-[#FFAE3B]/60"
    />
  );
}
