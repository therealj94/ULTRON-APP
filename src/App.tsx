import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { Mode, FaceState, CapturedPhoto } from './types';
import { FaceCanvas, caraDeEmocion } from './02-cara';
import type { Gesto } from './02-cara/gestos';
import { caraDeTexto } from './02-cara/emocion';
import { DockDrawer, SettingsSheet, nombreModo, Arranque, AccesoModal, UltronVaultModal, VisionOverlay, PhotoCaptureModal, CameraCountdownModal, MenuMas } from './07-pantallas';
import type { Escena } from './02-cara/vision/escena';
import { playSfx } from './03-voz/audio';
import { hablar, cantar, callar, precargar, setVozActiva, type Dicho, type Vecinos } from './03-voz/hablar';
import { cortarFrases } from './03-voz/frases';
import { onLip, desbloquearAudio, audioDesbloqueado } from './03-voz/player';
import { clipDeEmocion, clipDeTexto, saludoDe, saludoHora, siguienteChiste } from './03-voz/banco';
import { useOido } from './03-voz/useOido';
import { ConversacionEnVivo, type EstadoEnVivo } from './03-voz/enVivo';
import { opinarTurno, pedirTurnoStream } from './04-cerebro/turno';
import { detectarIntencion } from './04-cerebro/intenciones';
import { grabFrame, achicarFoto } from './04-cerebro/grabFrame';
import { fijarCuentaMemoria, guardarHecho, olvidarTodo } from './09-estado/memoria';
import { headersMesa } from './10-infra/sesionCliente';
import { cargarPerfil, perfil as perfilActual } from './perfil';
import type { Emocion } from '../lib/emocion';
import { quitarExpresiones } from '../lib/expresiones';
import { Fingerprint, ShieldCheck, Settings2, Mic, MicOff, Keyboard, MoreHorizontal, MessagesSquare, LayoutPanelLeft, AudioLines, PhoneOff } from 'lucide-react';
import { hayWebGL } from './11-sala/webgl';
import { tareaDeHerramientas, type Postura, type Tarea } from './11-sala/tareas';
import type { PedidoTarea } from './11-sala/VistaSala';
import './11-sala/tema.css';
import { enlaceEnLaUrl, quitarEnlaceDeLaUrl, type EnlaceUrl } from './cuentas/Cuentas';
import { useTema } from './01-diseno/useTema';
import { useConversacion, type EntradaAccion } from './13-trabajo/conversacion';
import { accionSensibleDe, resultadoDe } from './13-trabajo/accionSensible';
import { Conversacion } from './13-trabajo/Conversacion';
import { Compositor } from './13-trabajo/Compositor';
import { Inicio, EJEMPLOS_INICIO } from './13-trabajo/Inicio';

/** Conversar: la sala entera. Trabajar: avatar chico y la conversación con sus resultados. */
type ModoMesa = 'conversar' | 'trabajar';

// La sala trae three.js (medio mega): se baja aparte, sin frenar el arranque.
const Sala = lazy(() => import('./11-sala/VistaSala'));

/**
 * Si el trozo de la sala no baja (red cortada, despliegue nuevo) o revienta al montarse, React
 * desmontaría toda la app: pantalla en blanco. Aquí se ataja y se vuelve a la cara 2D.
 */
type PropsSalaSegura = { onFallo: (motivo: string) => void; children: React.ReactNode };
class SalaSegura extends React.Component<PropsSalaSegura, { roto: boolean }> {
  // El proyecto no trae @types/react: se declara a mano lo que usa esta clase.
  declare readonly props: PropsSalaSegura;
  state = { roto: false };
  static getDerivedStateFromError() {
    return { roto: true };
  }
  componentDidCatch(e: unknown) {
    console.error('[sala] falló; vuelvo a la cara 2D:', e);
    this.props.onFallo(String((e as any)?.message || e));
  }
  render() {
    return this.state.roto ? null : this.props.children;
  }
}

/** Lo que se dice cuando el turno no llegó: humano, sin el error técnico (ese va a la consola). */
const fraseSinCerebro = () =>
  typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'Me quedé sin internet. Revisá la conexión y probá de nuevo.'
    : 'No alcancé el cerebro. Probá de nuevo en un momento.';

/** Uno al azar: los clips de un mismo momento («hola», «aquí estoy»…) se turnan. */
const alAzar = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

const lee = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const guarda = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* */
  }
};

export default function App() {
  // ---- Estado de presencia
  const [face, setFace] = useState<FaceState>('IDLE');
  const [emocion, setEmocion] = useState<Emocion>('neutral');
  const [mode, setMode] = useState<Mode>((lee('ultron_modo', 'GUARDIAN') as Mode) || 'GUARDIAN');
  const [funMode, setFunMode] = useState(lee('ultron_fun', '0') === '1');
  const [isBooting, setIsBooting] = useState(true);
  const [estadoArranque, setEstadoArranque] = useState('despertando');
  const [isKioskFrame, setIsKioskFrame] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lipLevel, setLipLevel] = useState(0);
  const [cameraGaze, setCameraGaze] = useState({ x: 0, y: 0, active: false });
  const [isCameraFlashing, setIsCameraFlashing] = useState(false);

  // ---- Hardware
  const [micEnabled, setMicEnabled] = useState(false);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [soundFxEnabled, setSoundFxEnabled] = useState(true);
  const [visionEnabled, setVisionEnabled] = useState(lee('ultron_vision', '0') === '1');
  const [cerebroListo, setCerebroListo] = useState<'frio' | 'calentando' | 'listo'>('frio');
  const cerebroListoRef = useRef(cerebroListo);
  cerebroListoRef.current = cerebroListo;

  // ---- Sesión y memoria corta
  const [usuario, setUsuario] = useState({ name: '', role: 'Junta Directiva · Orden Global', authenticated: false });
  const historialRef = useRef<{ rol: string; texto: string }[]>([]);
  const pendienteGenesis = useRef('');
  const pendienteGesto = useRef<(() => void) | null>(null);

  // ---- El cuerpo: la sala 3D si el aparato puede, la cara 2D si no.
  const [conSala, setConSala] = useState(() => hayWebGL());
  const [postura, setPostura] = useState<Postura>(() => (lee('aura_postura', 'pie') === 'sentada' ? 'sentada' : 'pie'));
  const [entrada, setEntrada] = useState(0);
  const [pedido, setPedido] = useState<PedidoTarea | null>(null);
  const hacerTarea = useCallback((tarea: Tarea, texto?: string) => setPedido({ tarea, texto, n: Date.now() }), []);
  useEffect(() => guarda('aura_postura', postura), [postura]);

  // ---- UI
  const [dockOpen, setDockOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [masOpen, setMasOpen] = useState(false);
  const [modoMesa, setModoMesa] = useState<ModoMesa>(() => (lee('aura_modo_mesa', 'conversar') === 'trabajar' ? 'trabajar' : 'conversar'));
  useEffect(() => guarda('aura_modo_mesa', modoMesa), [modoMesa]);
  const { preferencia: preferenciaTema, setPreferencia: setPreferenciaTema, tema, variables: variablesTema } = useTema();
  /** Lo que el micrófono va oyendo (se enseña al trabajar, donde no hay burbuja). */
  const [oyendo, setOyendo] = useState('');
  const oyendoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inicioOculto, setInicioOculto] = useState(false);
  const escribirBtn = useRef<HTMLButtonElement>(null);
  // La conversación en pantalla, por cuenta (13-trabajo/conversacion.ts).
  const conv = useConversacion(usuario.authenticated ? usuario.name : null);
  /** true mientras se despacha un pedido local: lo que AU-RA conteste ahí también queda escrito. */
  const enComando = useRef(false);
  // Nombre de la plataforma: lo dice el servidor (Genesis Core o Cerebro de Minas), no está escrito aquí.
  const [perfilPlataforma, setPerfilPlataforma] = useState(perfilActual().plataforma);
  useEffect(() => {
    let vivo = true;
    void cargarPerfil().then((p) => vivo && setPerfilPlataforma(p.plataforma));
    return () => {
      vivo = false;
    };
  }, []);
  /** Lo que trae la dirección desde un correo de cuentas; se lee una vez y se borra de la barra. */
  const [enlaceCorreo] = useState<EnlaceUrl>(() => {
    const e = enlaceEnLaUrl();
    if (e) quitarEnlaceDeLaUrl();
    return e;
  });
  const [accesoOpen, setAccesoOpen] = useState(() => !!enlaceCorreo);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [bubble, setBubble] = useState({ texto: '', visible: false });
  /** «¿Te sirvió?» sobre la última respuesta del cerebro: su traza y en qué quedó la pregunta. */
  const [opinion, setOpinion] = useState<{ id: string; estado: 'preguntar' | 'gracias' } | null>(null);
  useEffect(() => {
    if (!opinion) return;
    const t = setTimeout(() => setOpinion(null), opinion.estado === 'gracias' ? 2500 : 25000);
    return () => clearTimeout(t);
  }, [opinion]);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onLip(setLipLevel);
    // El navegador solo deja sonar audio tras un gesto: al primer toque se desbloquean los contextos.
    const desbloquear = () => {
      desbloquearAudio();
      window.removeEventListener('pointerdown', desbloquear);
      window.removeEventListener('keydown', desbloquear);
      // Lo que quedó pendiente de decir antes del primer toque (el saludo) se dice ahora.
      const p = pendienteGesto.current;
      pendienteGesto.current = null;
      if (p) setTimeout(p, 120);
    };
    window.addEventListener('pointerdown', desbloquear);
    window.addEventListener('keydown', desbloquear);
    return () => {
      onLip(null);
      window.removeEventListener('pointerdown', desbloquear);
      window.removeEventListener('keydown', desbloquear);
    };
  }, []);
  useEffect(() => setVozActiva(speakerEnabled), [speakerEnabled]);

  useEffect(() => guarda('ultron_modo', mode), [mode]);
  useEffect(() => guarda('ultron_fun', funMode ? '1' : '0'), [funMode]);
  useEffect(() => guarda('ultron_vision', visionEnabled ? '1' : '0'), [visionEnabled]);

  const showBubble = useCallback((texto: string, ms = 3600) => {
    setBubble({ texto, visible: true });
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble((b) => ({ ...b, visible: false })), ms);
  }, []);

  /** Cambia la cara; con duración vuelve sola a reposo. */
  const cara = useCallback((f: FaceState, ms?: number) => {
    setFace(f);
    if (ms) setTimeout(() => setFace((c) => (c === f ? 'IDLE' : c)), ms);
  }, []);

  // ---- HABLAR: una sola función. Emoción → cara + voz.
  const hablando = useRef<Dicho | null>(null);
  /** La conversación en vivo está abierta (se actualiza en cada render, abajo). */
  const vivoAbiertaRef = useRef(false);
  const decir = useCallback(
    (texto: string, o: { emocion?: Emocion; caraFinal?: FaceState; sinBurbuja?: boolean } & Vecinos = {}) => {
      const t = String(texto || '').trim();
      if (!t) return { fin: Promise.resolve() };
      // Con la conversación en vivo abierta habla el agente: la mesa no le pone otra voz encima.
      if (vivoAbiertaRef.current) return { fin: Promise.resolve() };
      // Respuesta a un pedido de la persona (no un saludo ni una reacción): queda en la conversación,
      // con el texto humano del clip si lo es, nunca su id interno.
      if (enComando.current) {
        const clip = clipDeTexto(t);
        const escrito = clip ? clip.texto || '' : quitarExpresiones(t).trim();
        if (escrito) conv.aura(escrito, 'lista');
      }
      const e = o.emocion || 'neutral';
      if (e !== 'neutral') setEmocion(e);
      const d = hablar(t, { emocion: e, previo: o.previo, siguiente: o.siguiente });
      hablando.current = d;
      const caraHabla: FaceState = d.clip?.cara || (e === 'canto' ? 'SING' : e === 'oracion' ? 'PRAY' : e === 'risa' ? 'LAUGH' : 'SPEAKING');
      d.inicio.then(() => {
        if (hablando.current !== d) return;
        setFace(caraHabla);
        // La burbuja muestra lo que se OYE: si fue un clip del banco, su texto humano, nunca el id interno;
        // si fue la voz, el texto sin sus expresiones ([risa] se oye, no se lee).
        const visible = d.clip?.texto || (d.clip ? '' : quitarExpresiones(t).trim());
        if (!o.sinBurbuja && visible) showBubble(visible, Math.max(3200, Math.min(12000, visible.length * 60)));
      });
      d.fin.then(() => {
        if (hablando.current !== d) return;
        hablando.current = null;
        setFace(o.caraFinal || (e === 'triste' ? 'SAD' : e === 'cansado' ? 'TIRED' : 'IDLE'));
        if (o.caraFinal || e === 'triste' || e === 'cansado') setTimeout(() => setFace((c) => (c === 'IDLE' ? c : 'IDLE')), 2400);
      });
      return d;
    },
    [showBubble, conv.aura]
  );

  // Gancho de QA/demo: con ?qa=1 en la URL, window.__ultron permite fijar cara, emoción, boca y modo
  // desde la consola o desde Playwright (scripts/qa/capturas.mjs). No hace nada en uso normal.
  useEffect(() => {
    if (typeof window === 'undefined' || !/[?&]qa=1/.test(window.location.search)) return;
    (window as any).__ultron = {
      setFace: (f: FaceState) => setFace(f),
      setEmocion: (e: Emocion) => setEmocion(e),
      setLip: (n: number) => setLipLevel(Math.max(0, Math.min(1, Number(n) || 0))),
      setMode: (m: Mode) => setMode(m),
      setFunMode: (v: boolean) => setFunMode(!!v),
      setGaze: (x: number, y: number, active = true) => setCameraGaze({ x, y, active }),
      boot: (v: boolean) => setIsBooting(v),
      decir: (t: string, e?: Emocion) => decir(t, { emocion: e }),
      tarea: (t: Tarea, texto?: string) => hacerTarea(t, texto),
      postura: (p: Postura) => setPostura(p),
    };
    return () => {
      delete (window as any).__ultron;
    };
  }, [decir, hacerTarea]);

  const callarTodo = useCallback(() => {
    callar();
    hablando.current = null;
    colaRef.current = [];
    previoRef.current = '';
    setFace('IDLE');
  }, []);

  // ---- Cola de frases (el turno llega en stream; se habla frase a frase, sin pisarse)
  const colaRef = useRef<Array<{ texto: string; emocion: Emocion }>>([]);
  const colaActiva = useRef(false);
  /** La última frase que la cola mandó a decir en este turno: la voz de la siguiente se enlaza con ella. */
  const previoRef = useRef('');
  const bombear = useCallback(async () => {
    if (colaActiva.current) return;
    colaActiva.current = true;
    while (colaRef.current.length) {
      const item = colaRef.current.shift()!;
      const siguiente = colaRef.current[0];
      const d = decir(item.texto, { emocion: item.emocion, sinBurbuja: false, previo: previoRef.current, siguiente: siguiente?.texto });
      previoRef.current = item.texto;
      // La que sigue se pide mientras esta suena: entre frase y frase no queda el silencio de sintetizar.
      if (siguiente) precargar(siguiente.texto, { emocion: siguiente.emocion, previo: item.texto, siguiente: colaRef.current[1]?.texto });
      await d.fin;
    }
    colaActiva.current = false;
  }, [decir]);

  // ---- Arranque: sesión + salud + ojos que despiertan. Mínimo 1.9 s de wordmark.
  useEffect(() => {
    let vivo = true;
    const t0 = Date.now();
    fetch('/api/ultron/sesion', { headers: headersMesa() })
      .then((r) => r.json())
      .then((d) => {
        if (vivo && d.authenticated && d.user) {
          setUsuario({ name: d.user.nombre || '', role: d.user.rol || 'Junta Directiva · Orden Global', authenticated: true });
          // La memoria larga de este navegador es POR CUENTA (09-estado/memoria.ts).
          fijarCuentaMemoria(d.user.correo);
        }
      })
      .catch(() => {});
    setEstadoArranque('buscando el cerebro');
    Promise.race([fetch('/api/health').then((r) => r.json()).catch(() => null), new Promise((r) => setTimeout(() => r(null), 2500))]).then((h: any) => {
      if (!vivo) return;
      setEstadoArranque(h?.qwen?.vivo ? 'cerebro en línea' : 'sin cerebro · modo local');
      const espera = Math.max(0, 1900 - (Date.now() - t0));
      setTimeout(() => {
        if (!vivo) return;
        setIsBooting(false);
        setEntrada((n) => n + 1);
        playSfx('boot', true);
        setCerebroListo(h?.qwen?.vivo ? 'calentando' : 'frio');
        setMicEnabled(true);
      }, espera);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // Calentar Qwen; al primer «listo», saludo grabado (cero red).
  useEffect(() => {
    if (cerebroListo === 'listo') return;
    let vivo = true;
    // Una sola consulta en vuelo (el servidor puede tardar hasta calentar): sin solapar sondeos.
    let enVuelo = false;
    const sondear = () => {
      if (enVuelo) return;
      enVuelo = true;
      fetch('/api/nodo/listo', { signal: AbortSignal.timeout(50_000) })
        .then((r) => r.json())
        .then((d) => {
          if (!vivo) return;
          if (d?.listo) {
            setCerebroListo('listo');
            if (audioDesbloqueado()) decir(saludoHora().id, { emocion: 'feliz' });
            else {
              pendienteGesto.current = () => decir(saludoHora().id, { emocion: 'feliz' });
              showBubble('Tocame para escucharme.', 6000);
            }
          } else setCerebroListo((s) => (s === 'listo' ? s : 'calentando'));
        })
        .catch(() => vivo && setCerebroListo((s) => (s === 'listo' ? s : 'frio')))
        .finally(() => {
          enVuelo = false;
        });
    };
    if (!isBooting) sondear();
    const id = setInterval(sondear, 4000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [cerebroListo, isBooting, decir]);

  // ---- Presencia: si la cámara deja de verte 45 s, se duerme; al volver, despierta.
  const lastSeen = useRef(0);
  const sawOnce = useRef(false);
  const sleptByAbsence = useRef(false);
  /** Lo último que AU-RA ve por su cámara: viaja al cerebro como hecho en cada turno. */
  const escenaRef = useRef<{ texto: string; ts: number }>({ texto: '', ts: 0 });
  const ultimaInteraccion = useRef(0);
  const dosPersonasDicho = useRef(false);
  const despertar = useCallback(() => {
    setFace('IDLE');
    playSfx('wake', soundFxEnabled);
    decir(Math.random() < 0.5 ? 'aqui' : 'despertar', { emocion: 'feliz' });
  }, [soundFxEnabled, decir]);
  const dormir = useCallback(() => {
    callarTodo();
    setFace('SLEEPING');
    playSfx('sleep', soundFxEnabled);
  }, [soundFxEnabled, callarTodo]);
  useEffect(() => {
    if (cameraGaze.active) {
      sawOnce.current = true;
      lastSeen.current = Date.now();
      if (sleptByAbsence.current && face === 'SLEEPING') {
        sleptByAbsence.current = false;
        despertar();
      }
    }
  }, [cameraGaze.active, face, despertar]);
  useEffect(() => {
    const id = setInterval(() => {
      if (isBooting || dockOpen || settingsOpen || !sawOnce.current) return;
      if (['SPEAKING', 'THINKING', 'LISTENING', 'SING', 'LAUGH', 'PRAY'].includes(face)) return;
      if (!cameraGaze.active && lastSeen.current && Date.now() - lastSeen.current > 45000 && face !== 'SLEEPING') {
        // lastSeen lo actualizan tanto el gaze como la escena: si la cámara ve a alguien, no se duerme.
        sleptByAbsence.current = true;
        setFace('SLEEPING');
      }
    }, 2000);
    return () => clearInterval(id);
  }, [cameraGaze.active, face, isBooting, dockOpen, settingsOpen]);

  /**
   * Lo que AU-RA ve. La descripción se guarda como hecho para el turno; los eventos mueven la cara
   * y, muy de vez en cuando, le hacen decir algo. Nunca interrumpe si está hablando o pensando.
   */
  const alVerEscena = useCallback(
    (e: Escena) => {
      escenaRef.current = { texto: e.descripcion, ts: Date.now() };
      if (e.personas > 0) {
        sawOnce.current = true;
        lastSeen.current = Date.now();
      }
      if (!e.eventos.length) return;
      const ocupado = !!hablando.current || colaRef.current.length > 0 || face === 'THINKING' || face === 'PRAY' || face === 'SING';
      const durmiendo = face === 'SLEEPING';
      for (const ev of e.eventos) {
        if (ev === 'llego') {
          if (durmiendo) {
            sleptByAbsence.current = false;
            despertar();
          } else if (!ocupado && Date.now() - ultimaInteraccion.current > 60000) {
            ultimaInteraccion.current = Date.now();
            decir(alAzar(['hola', 'aqui', 'holadenuevo', 'mealegra']), { emocion: 'feliz' });
          }
        } else if (ev === 'sonrie' && !ocupado && !durmiendo) {
          setEmocion('feliz');
          cara('HAPPY', 2200);
        } else if (ev === 'dos_personas' && !ocupado && !durmiendo && !dosPersonasDicho.current) {
          dosPersonasDicho.current = true;
          setEmocion('curioso');
          cara('CURIOSITY', 2600);
        } else if (ev === 'saluda' && !ocupado && !durmiendo) {
          setEmocion('feliz');
          cara('HAPPY', 1800);
        } else if (ev === 'se_fue') {
          dosPersonasDicho.current = false;
        }
      }
    },
    [face, decir, despertar, cara]
  );

  // ---- CEREBRO: un turno en stream. Emoción antes del texto; frases a la cola de voz.
  const turnoEnCurso = useRef<AbortController | null>(null);
  /**
   * El turno al que la persona le cortó la voz (barge-in). Sigue corriendo (su texto llega a la
   * conversación y al historial, y lo que hizo en el servidor no se repite), pero ya no habla: antes
   * `callarTodo` vaciaba la cola y el siguiente trozo del stream la volvía a llenar. Se despeja solo:
   * el próximo turno trae otro AbortController.
   */
  const turnoCallado = useRef<AbortController | null>(null);
  /** El turno que viene lo dijo en voz alta (el oído), no lo escribió: el servidor le pone los topes de la voz. */
  const habladoRef = useRef(false);
  const pensar = useCallback(
    async (cmd: string, o: { imagen?: string; accionId?: string } = {}) => {
      const hablado = habladoRef.current;
      habladoRef.current = false;
      turnoEnCurso.current?.abort();
      const ac = new AbortController();
      turnoEnCurso.current = ac;
      // El turno en la conversación: su estado va cambiando con lo que manda el servidor.
      const idTurno = conv.aura('', 'pensando');
      let dicho = '';
      const cerrarTurno = (cambio: { texto?: string; estado: 'lista' | 'error' | 'interrumpida'; ms?: number; trazaId?: string }) =>
        conv.actualizar(idTurno, (x: any) => ({ ...cambio, texto: cambio.texto ?? x.texto, tsFin: Date.now() }));
      const resultadoAccion = (respuesta: string, error?: string) => {
        if (!o.accionId) return;
        const r = resultadoDe(respuesta, error);
        conv.actualizar<EntradaAccion>(o.accionId, { estado: r.estado, resultado: r.resumen, tsResultado: Date.now() });
      };
      callarTodo();
      setFace('THINKING');
      setEmocion('pensando');
      playSfx('think', soundFxEnabled);
      const quiereVer = /qu[eé] ves|qu[eé] hay aqu[ií]|imagen|c[aá]mara|le[eé] (esto|la foto|la etiqueta)/i.test(cmd);
      // Una foto ya tomada («¿Qué ves en la foto?») manda esa foto, no un cuadro en vivo.
      const image = o.imagen || (quiereVer && visionEnabled ? grabFrame() : null);
      // Si el 27B tarda, AU-RA piensa en voz alta con un clip (sin red).
      const relleno = setTimeout(() => {
        if (turnoEnCurso.current === ac && turnoCallado.current !== ac && colaRef.current.length === 0 && !hablando.current) decir(alAzar(['mmm', 'mmm2', 'unmomento']), { emocion: 'pensando', sinBurbuja: true });
      }, 1400);
      // Lo que llega es el texto de DECIR (con sus [risa]…): la burbuja se los quita en `decir`.
      let pendiente = '';
      let huboTexto = false;
      let emo: Emocion = 'neutral';
      const soltar = (final = false) => {
        // Frases cerradas ya (src/03-voz/frases.ts): la que terminó en punto sale sin esperar al siguiente trozo.
        const { listas, resto } = cortarFrases(pendiente, final);
        pendiente = resto;
        if (turnoCallado.current === ac) return;
        for (const p of listas) colaRef.current.push({ texto: p, emocion: emo });
        if (colaRef.current.length) void bombear();
      };
      try {
        const data = await pedirTurnoStream(
          {
            message: cmd,
            mode,
            historial: historialRef.current,
            image,
            usuario: usuario.name || undefined,
            // Solo si es reciente: una escena vieja como hecho es peor que ninguna.
            escena: Date.now() - escenaRef.current.ts < 12000 ? escenaRef.current.texto : undefined,
            hablado,
            signal: ac.signal,
          },
          {
            onTools: (tools) => {
              const t = tareaDeHerramientas(tools);
              if (t) hacerTarea(t, cmd);
              conv.actualizar(idTurno, { herramientas: tools, estado: 'usando' } as any);
            },
            onEmocion: (e) => {
              emo = e;
              setEmocion(e);
              const c = caraDeEmocion(e);
              if (c !== 'IDLE') setFace(c);
              const clip = clipDeEmocion(e);
              if (clip && (e === 'risa' || e === 'sorpresa') && turnoCallado.current !== ac) colaRef.current.push({ texto: clip.id, emocion: e });
            },
            onDelta: (t) => {
              clearTimeout(relleno);
              huboTexto = true;
              pendiente += t;
              soltar(false);
              dicho += t;
              conv.actualizar(idTurno, { texto: quitarExpresiones(dicho).trim(), estado: 'respondiendo' } as any);
            },
            onReplace: (t) => {
              if (turnoCallado.current !== ac) {
                colaRef.current = [];
                callar();
              }
              huboTexto = true;
              pendiente = t;
              soltar(true);
              dicho = t;
              conv.actualizar(idTurno, { texto: quitarExpresiones(dicho).trim(), estado: 'respondiendo' } as any);
            },
          }
        );
        clearTimeout(relleno);
        if (turnoEnCurso.current !== ac) {
          cerrarTurno({ estado: 'interrumpida' });
          resultadoAccion('', 'interrumpido');
          return;
        }
        if (data.error === 'sesión requerida') {
          setAccesoOpen(true);
          decir('Eso necesita tu sesión de junta. Entrá y lo hacemos.', { emocion: 'neutral' });
          cerrarTurno({ texto: 'Eso necesita tu sesión de junta. Entrá y lo hacemos.', estado: 'lista' });
          resultadoAccion('', 'sesión requerida');
          return;
        }
        const texto = String(data.reply || '').trim();
        if (!texto) {
          console.warn('[cerebro] turno sin respuesta:', data.error);
          decir(fraseSinCerebro(), { emocion: 'preocupado' });
          cerrarTurno({ texto: fraseSinCerebro(), estado: 'error' });
          resultadoAccion('');
          return;
        }
        cerrarTurno({ texto, estado: 'lista', ms: data.ms, trazaId: data.trazaId });
        resultadoAccion(texto);
        if (data.emocion) emo = data.emocion;
        // Sin stream (el servidor contestó en JSON) no llegó ningún trozo: se dice la respuesta entera.
        if (!huboTexto) pendiente = String(data.voz || texto);
        soltar(true);
        if (data.trazaId) setOpinion({ id: data.trazaId, estado: 'preguntar' });
        historialRef.current = [...historialRef.current, { rol: 'user', texto: cmd }, { rol: 'ultron', texto }].slice(-12);
        if (turnoCallado.current !== ac && pendienteGenesis.current && /orden global|junta|mina|prospera|aucorp|token|concesi/i.test(cmd)) {
          colaRef.current.push({ texto: '¿Lo actualizo en el cerebro Genesis Core?', emocion: 'curioso' });
          void bombear();
        }
      } catch (e: any) {
        clearTimeout(relleno);
        if (e?.name === 'AbortError') {
          cerrarTurno({ estado: 'interrumpida' });
          resultadoAccion('', 'interrumpido');
          return;
        }
        console.error('[cerebro] turno falló:', e);
        decir(fraseSinCerebro(), { emocion: 'preocupado' });
        cerrarTurno({ texto: fraseSinCerebro(), estado: 'error' });
        resultadoAccion('');
      }
    },
    [mode, usuario.name, visionEnabled, soundFxEnabled, decir, bombear, callarTodo, hacerTarea, conv.aura, conv.actualizar]
  );

  /** Si el cerebro todavía no está, lo avisa y devuelve true (el turno no sale). */
  const cerebroNoListo = useCallback(() => {
    if (cerebroListoRef.current === 'listo') return false;
    showBubble(cerebroListoRef.current === 'calentando' ? 'Calentando el 27B… un momento.' : 'Sin cerebro. Reviso el nodo.');
    decir('calentando el motor', { emocion: 'pensando' });
    return true;
  }, [showBubble, decir]);

  // ---- Despachador: gags locales; datos, siempre al cerebro.
  const comando = useCallback(
    (raw: string) => {
      const cmd = raw.trim();
      if (!cmd) return;
      ultimaInteraccion.current = Date.now();
      const it = detectarIntencion(cmd);
      switch (it.tipo) {
        case 'callar':
          callarTodo();
          // «Callate» con un turno en camino: lo que falte por llegar tampoco se dice.
          turnoCallado.current = turnoEnCurso.current;
          return;
        case 'recordar':
          hacerTarea('anotar');
          pendienteGenesis.current = it.hecho;
          // «Anotado» solo con el recibo del servidor (09-estado/memoria.ts).
          void guardarHecho(it.hecho, { usuario: usuario.name }).then((r) =>
            r.remoto === 'ok'
              ? decir('Anotado. Si es de la junta, decime «actualiza el cerebro» y queda en Genesis Core.', { emocion: 'orgullo' })
              : r.remoto === 'sin-sesion'
                ? decir('Para recordarlo necesito que entres con tu cuenta.', { emocion: 'neutral' })
                : decir('No pude guardarlo en el servidor. Probá de nuevo en un momento.', { emocion: 'neutral' })
          );
          return;
        case 'genesis': {
          const hecho = pendienteGenesis.current || historialRef.current.filter((h) => h.rol === 'user').slice(-1)[0]?.texto || '';
          if (!hecho) return void decir('Decime el hecho primero y después «actualiza el cerebro».', { emocion: 'curioso' });
          hacerTarea('anotar');
          pendienteGenesis.current = '';
          void guardarHecho(`[Genesis] ${hecho}`, { usuario: usuario.name, junta: true }).then((r) =>
            r.remoto === 'ok'
              ? decir('Quedó en Genesis Core. La próxima pregunta ya lo usa.', { emocion: 'orgullo' })
              : r.remoto === 'sin-sesion'
                ? decir('Para guardarlo en Genesis Core necesito que entres con tu cuenta.', { emocion: 'neutral' })
                : decir('No pude guardarlo en Genesis Core. Probá de nuevo en un momento.', { emocion: 'neutral' })
          );
          return;
        }
        case 'cantar': {
          callarTodo();
          setEmocion('canto');
          setFace('SING');
          const d = cantar({ pedido: it.pedido });
          hablando.current = d;
          d.inicio.then(() => hablando.current === d && setFace('SING'));
          d.fin.then(() => {
            if (hablando.current !== d) return;
            hablando.current = null;
            setFace('HAPPY');
            setTimeout(() => setFace((c) => (c === 'HAPPY' ? 'IDLE' : c)), 2000);
          });
          return;
        }
        case 'orar': {
          callarTodo();
          setEmocion('oracion');
          setFace('PRAY');
          const d = hablar('oracion', { emocion: 'oracion' });
          hablando.current = d;
          d.inicio.then(() => hablando.current === d && setFace('PRAY'));
          d.fin.then(() => {
            if (hablando.current !== d) return;
            hablando.current = null;
            setEmocion('carino');
            setFace('IDLE');
          });
          return;
        }
        case 'chiste':
          decir(siguienteChiste().id, { emocion: 'risa' });
          return;
        case 'capacidades':
          setSettingsOpen(true);
          decir('puedo', { emocion: 'orgullo' });
          return;
        case 'emocion':
          decir(it.dicho, { emocion: it.emocion as Emocion });
          return;
        case 'modo':
          setMode(it.modo as Mode);
          playSfx(it.modo === 'GOLD' ? 'gold' : 'mode', soundFxEnabled);
          decir(it.dicho, { emocion: 'neutral' });
          return;
        case 'dormir':
          dormir();
          return;
        case 'despertar':
          despertar();
          return;
        case 'foto':
          setCameraOpen(true);
          return;
        default:
          if (cerebroNoListo()) return;
          setFace(caraDeTexto(cmd) === 'LISTENING' ? 'THINKING' : caraDeTexto(cmd));
          void pensar(cmd);
      }
    },
    [usuario.name, soundFxEnabled, decir, pensar, dormir, despertar, callarTodo, cerebroNoListo, hacerTarea]
  );

  /**
   * La puerta de todo lo que pide la persona (voz, Escribir, ejemplos). Queda en la conversación; si
   * sale del sistema (mandar, avisar urgente, llamar) no se despacha: se propone en una tarjeta y
   * espera Confirmar. Lo demás sigue por `comando`, igual que siempre.
   */
  const pedir = useCallback(
    (raw: string, hablado = false) => {
      const cmd = raw.trim();
      if (!cmd) return;
      habladoRef.current = hablado;
      conv.persona(cmd);
      const accion = accionSensibleDe(cmd);
      if (accion) {
        ultimaInteraccion.current = Date.now();
        conv.proponer(accion, cmd);
        // La tarjeta vive en la superficie de trabajo: se pasa ahí para que se vea qué se autoriza.
        setModoMesa('trabajar');
        decir('Antes de hacerlo, revisá la tarjeta: a quién va, qué dice, y confirmá.', { emocion: 'neutral' });
        return;
      }
      enComando.current = true;
      try {
        comando(cmd);
      } finally {
        enComando.current = false;
      }
    },
    [comando, decir, conv.persona, conv.proponer]
  );

  const confirmarAccion = useCallback(
    (id: string) => {
      const e = conv.entradas.find((x): x is EntradaAccion => x.id === id && x.tipo === 'accion');
      if (!e || e.estado !== 'propuesta') return;
      conv.actualizar<EntradaAccion>(id, { estado: 'enviando' });
      playSfx('tap', soundFxEnabled);
      // El taller del servidor hace el envío sin despertar al modelo: no se espera al cerebro.
      void pensar(e.pedido, { accionId: id });
    },
    [conv.entradas, conv.actualizar, pensar, soundFxEnabled]
  );

  const cancelarAccion = useCallback(
    (id: string) => {
      conv.actualizar<EntradaAccion>(id, { estado: 'cancelada', tsResultado: Date.now() });
      decir('Listo, no mando nada.', { emocion: 'neutral' });
    },
    [conv.actualizar, decir]
  );

  /*
   * ---- EN VIVO: la conversación con el agente de ElevenLabs (03-voz/enVivo.ts), como el modo voz de
   * ChatGPT. Mientras está abierta, el oído del navegador y la voz frase a frase se apagan: habla la
   * conversación. Si no abre, queda el micrófono de siempre.
   */
  const [enVivo, setEnVivo] = useState<EstadoEnVivo>('cerrada');
  const vivoRef = useRef<ConversacionEnVivo | null>(null);
  const vivoCbs = useRef({ conv, showBubble, setFace });
  vivoCbs.current = { conv, showBubble, setFace };
  const conversacionEnVivo = () => {
    if (!vivoRef.current) {
      vivoRef.current = new ConversacionEnVivo({
        // El SDK se carga al abrir la primera vez: no pesa en la primera pantalla.
        abrirSesion: async (o) => {
          const { Conversation } = await import('@elevenlabs/client');
          return Conversation.startSession(o as any);
        },
        pedir: async (ruta, cuerpo) => {
          const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headersMesa() }, body: JSON.stringify(cuerpo) });
          return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
        },
        onEstado: (e, detalle) => {
          setEnVivo(e);
          const cb = vivoCbs.current;
          if (e === 'escuchando') cb.setFace('LISTENING');
          else if (e === 'hablando') cb.setFace('SPEAKING');
          else if (e === 'cerrada') cb.setFace('IDLE');
          else if (e === 'error') {
            cb.setFace('IDLE');
            if (detalle) cb.showBubble(detalle, 6000);
          }
        },
        onMensaje: (quien, texto) => {
          const cb = vivoCbs.current.conv;
          if (quien === 'persona') cb.persona(texto);
          else cb.aura(texto, 'lista');
        },
      });
    }
    return vivoRef.current;
  };
  useEffect(() => () => vivoRef.current?.cerrar(), []);
  const alternarEnVivo = () => {
    playSfx('tap', soundFxEnabled);
    const c = conversacionEnVivo();
    if (c.estado() !== 'cerrada' && c.estado() !== 'error') return c.cerrar();
    if (face === 'SLEEPING') despertar();
    // Lo que la mesa estaba diciendo se corta: desde aquí habla la conversación.
    callarTodo();
    // Y lo que falte por llegar del turno en camino tampoco se dice (sigue escribiéndose en el chat).
    turnoCallado.current = turnoEnCurso.current;
    vivoAbiertaRef.current = true;
    void c.abrir({ avatar: 'aura', idioma: 'es' });
  };
  const vivoAbierta = enVivo === 'conectando' || enVivo === 'escuchando' || enVivo === 'hablando';
  vivoAbiertaRef.current = vivoAbierta;

  // ---- OÍDO continuo con barge-in.
  useOido({
    activo: micEnabled && !isBooting && !vivoAbierta,
    onFinal: (t) => {
      setOyendo('');
      pedir(t, true);
    },
    onParcial: (t) => {
      showBubble(t, 2500);
      setOyendo(t);
      if (oyendoTimer.current) clearTimeout(oyendoTimer.current);
      oyendoTimer.current = setTimeout(() => setOyendo(''), 2500);
      setFace((f) => (f === 'SLEEPING' ? f : 'LISTENING'));
    },
    onBargeIn: () => {
      if (hablando.current || colaRef.current.length) {
        callarTodo();
        turnoCallado.current = turnoEnCurso.current;
      }
      setFace('LISTENING');
    },
    onSinPermiso: () => {
      showBubble('Permití el micrófono en el navegador para hablarme.');
      setMicEnabled(false);
    },
    onNoSoportado: () => {
      // Sin reconocimiento de voz (Firefox): apagar el micrófono y abrir el teclado para no quedar trabado.
      setMicEnabled(false);
      setSettingsOpen(false);
      setDockOpen(true);
      showBubble('Este navegador no me oye. Escribime acá abajo, o abrime en Chrome para hablarme.', 10000);
    },
  });

  // ---- Gestos de la cara → reacciones baratas (clips, sin red)
  const gesto = useCallback(
    (g: Gesto) => {
      if (g === 'tapBarbilla') decir(clipDeEmocion('risa')?.id || 'risa1', { emocion: 'risa' });
      else if (g === 'tapFrente') decir(clipDeEmocion('sorpresa')?.id || 'uy2', { emocion: 'curioso' });
      else if (g === 'frotarMejilla') decir(clipDeEmocion('carino')?.id || 'carino', { emocion: 'carino' });
      else if (g === 'dormir') {
        dormir();
        // Se duerme bostezando: el bostezo suena sin mover la cara, que ya está dormida.
        const bostezo = clipDeEmocion('cansado');
        if (bostezo) hablar(bostezo.id);
      }
      else if (g === 'despertar') despertar();
    },
    [decir, dormir, despertar]
  );

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const estadoCerebro = cerebroListo === 'listo' ? 'Lista' : cerebroListo === 'calentando' ? 'Despertando' : 'Sin cerebro';
  const escuchando = face === 'LISTENING';
  const tocarSala = (zona: 'cuerpo' | 'cabeza') => {
    if (face === 'SLEEPING') return despertar();
    gesto(zona === 'cabeza' ? 'tapFrente' : 'tapBarbilla');
  };
  const burbujaTexto = (
    <div id="ultron-speech-bubble" role="status" aria-live="polite" className={`aura-burbuja ${conSala ? '' : 'abajo'} ${bubble.visible && bubble.texto ? 'visible' : ''}`}>
      {bubble.texto}
    </div>
  );
  const hayDialogo = dockOpen || settingsOpen || masOpen || accesoOpen || vaultOpen || photosOpen || cameraOpen;
  const opinar = (v: 1 | -1) => {
    if (!opinion) return;
    void opinarTurno(opinion.id, v);
    setOpinion({ id: opinion.id, estado: 'gracias' });
  };
  const alternarMic = () => {
    if (face === 'SLEEPING') despertar();
    setMicEnabled((v) => !v);
    playSfx('tap', soundFxEnabled);
  };
  const etiquetaMic = micEnabled ? (escuchando ? 'Micrófono abierto: te está escuchando' : 'Micrófono abierto') : 'Micrófono apagado';
  const nombreVisible = usuario.authenticated ? usuario.name : '';
  /** Conversar / Trabajar: un radiogroup con flechas. */
  const MODOS_MESA: Array<{ id: ModoMesa; label: string; Icono: typeof Mic }> = [
    { id: 'conversar', label: 'Conversar', Icono: MessagesSquare },
    { id: 'trabajar', label: 'Trabajar', Icono: LayoutPanelLeft },
  ];
  const moverModo = (i: number) => {
    const j = (i + MODOS_MESA.length) % MODOS_MESA.length;
    setModoMesa(MODOS_MESA[j].id);
    document.getElementById(`aura-modo-${MODOS_MESA[j].id}`)?.focus();
  };
  const puntoEstado = cerebroListo === 'listo' ? 'bg-(--aura-salvia)' : cerebroListo === 'calentando' ? 'bg-(--aura-oro)' : 'bg-(--aura-barro)';

  return (
    <div
      id="ultron-app-root"
      className="aura relative w-screen h-screen supports-[height:100dvh]:h-dvh overflow-hidden flex items-center justify-center select-none"
      style={variablesTema}
      data-tema={tema}
      data-modo={modoMesa}
    >
      <div
        id="ultron-stand-container"
        className={`relative overflow-hidden transition-all duration-300 flex items-center justify-center ${
          isKioskFrame ? 'w-full max-w-[96vw] max-h-[88vh] aspect-[16/10] rounded-[32px] border-[10px] border-(--aura-borde) shadow-[0_24px_60px_var(--aura-sombra)]' : 'w-full h-full'
        }`}
      >
        {/* Todo lo que queda detrás de un diálogo: inert mientras haya uno abierto (ni Tab ni lector). */}
        <div id="aura-contenido" className="absolute inset-0" inert={hayDialogo}>
          <div className={`aura-escenario aura-fondo ${conSala ? '' : 'touch-none sin-seleccion'}`}>
            {conSala ? (
              <SalaSegura onFallo={() => setConSala(false)}>
                <Suspense fallback={null}>
                  <Sala
                    key={tema}
                    estilo={tema === 'claro' ? { paleta: 'piedra' } : undefined}
                    face={face}
                    emocion={emocion}
                    lipLevel={lipLevel}
                    cameraGaze={cameraGaze}
                    postura={postura}
                    pedido={pedido}
                    entrada={entrada}
                    onTocar={tocarSala}
                    onDeslizar={(d) => {
                      if (d === 'arriba') {
                        setDockOpen(true);
                        setSettingsOpen(false);
                      } else {
                        setSettingsOpen(true);
                        setDockOpen(false);
                      }
                    }}
                    onFallo={() => setConSala(false)}
                  >
                    {burbujaTexto}
                  </Sala>
                </Suspense>
              </SalaSegura>
            ) : (
              <>
                <FaceCanvas
                  face={face}
                  emocion={emocion}
                  funMode={funMode}
                  mode={mode}
                  energy={cerebroListo === 'listo' ? 90 : 60}
                  soundFxEnabled={soundFxEnabled}
                  cameraGaze={cameraGaze}
                  isCameraFlashing={isCameraFlashing}
                  lipLevel={lipLevel}
                  showHud={false}
                  onFaceChange={cara}
                  onModeChange={(m) => {
                    setMode(m);
                    playSfx(m === 'GOLD' ? 'gold' : 'mode', soundFxEnabled);
                  }}
                  onSwipeUp={() => {
                    setDockOpen(true);
                    setSettingsOpen(false);
                  }}
                  onSwipeDown={() => {
                    setSettingsOpen(true);
                    setDockOpen(false);
                  }}
                  onTriggerVoice={() => {
                    if (!micEnabled) {
                      setMicEnabled(true);
                      decir('aqui', { emocion: 'feliz' });
                    } else {
                      setFace('LISTENING');
                      showBubble('Te escucho');
                    }
                  }}
                  onSpeak={(t) => decir(t, { emocion: 'travieso' })}
                  onWake={despertar}
                  onSleep={dormir}
                  onGesto={gesto}
                  onCloseOverlays={() => {
                    setDockOpen(false);
                    setSettingsOpen(false);
                  }}
                />
                {burbujaTexto}
              </>
            )}
          </div>

          {/* Barra de arriba: su nombre y cómo está, el modo de la mesa, y lo tuyo */}
          <header className="absolute top-3 left-3 right-3 sm:top-4 sm:left-5 sm:right-5 z-20 flex items-center justify-between gap-1 sm:gap-2 pointer-events-none">
            <div className="flex items-center gap-2 pointer-events-auto shrink-0">
              <div className="h-11 px-2 rounded-full bg-(--aura-fondo) aura-sombra hidden min-[560px]:flex items-center">
                <img src="/marca/logo-aura-oscuro.png" alt="AU-RA by Orden Global" className="h-9 w-auto aura-solo-oscuro" draggable={false} />
                <img src="/marca/logo-aura.png" alt="AU-RA by Orden Global" className="h-9 w-auto aura-solo-claro" draggable={false} />
              </div>
              <img src="/icon-192.png" alt="AU-RA" className="w-11 h-11 shrink-0 rounded-full aura-sombra min-[560px]:hidden" draggable={false} />
              <div className="h-9 px-3 rounded-full bg-(--aura-panel) aura-sombra hidden lg:flex items-center gap-2 text-[14px] font-medium text-(--aura-tinta-2)" title={estadoArranque}>
                <span className={`w-2 h-2 rounded-full ${puntoEstado} ${cerebroListo === 'calentando' ? 'animate-pulse' : ''}`} aria-hidden="true" />
                <span>
                  <span className="sr-only">Estado: </span>
                  {estadoCerebro}
                </span>
              </div>
            </div>

            <div role="radiogroup" aria-label="Modo de la mesa" className="aura-segmento aura-modos aura-sombra pointer-events-auto">
              {MODOS_MESA.map((m, i) => (
                <button
                  key={m.id}
                  id={`aura-modo-${m.id}`}
                  type="button"
                  role="radio"
                  aria-checked={modoMesa === m.id}
                  tabIndex={modoMesa === m.id ? 0 : -1}
                  onClick={() => setModoMesa(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), moverModo(i + 1));
                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), moverModo(i - 1));
                  }}
                >
                  <m.Icono className="w-4 h-4" aria-hidden="true" />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 sm:gap-2 pointer-events-auto shrink-0">
              <button
                type="button"
                onClick={() => setAccesoOpen(true)}
                title={usuario.authenticated ? `Sesión: ${usuario.name}` : 'Entrar a la junta'}
                aria-label={usuario.authenticated ? `Sesión de ${usuario.name}` : 'Entrar a la junta'}
                className={`h-11 min-w-11 px-3 rounded-full aura-sombra flex items-center justify-center gap-2 text-[15px] font-semibold cursor-pointer ${
                  usuario.authenticated ? 'bg-(--aura-salvia-fondo) text-(--aura-salvia-texto)' : 'bg-(--aura-panel) text-(--aura-tinta) hover:bg-(--aura-oro-suave)'
                }`}
              >
                {usuario.authenticated ? <ShieldCheck className="w-5 h-5" aria-hidden="true" /> : <Fingerprint className="w-5 h-5" aria-hidden="true" />}
                <span className="hidden md:inline">{usuario.authenticated ? usuario.name : 'Entrar'}</span>
              </button>
              <button type="button" onClick={() => setSettingsOpen(true)} title="Ajustes" aria-label="Ajustes" className="aura-redondo">
                <Settings2 className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </header>

          {/* Trabajar: el avatar chico a un lado y, en grande, la conversación con sus resultados. */}
          {modoMesa === 'trabajar' && (
            <>
              <aside className="aura-lado flex-col gap-3" aria-label="AU-RA">
                <p className="text-[14px] text-(--aura-tinta-2) flex items-center gap-2 px-2">
                  <span className={`w-2 h-2 rounded-full ${puntoEstado}`} aria-hidden="true" />
                  {estadoCerebro} · {!micEnabled ? 'micrófono apagado' : escuchando ? 'te escucha' : 'micrófono abierto'}
                </p>
                {conv.entradas.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="aura-sobretitulo px-2">Probá pedirle</p>
                    {EJEMPLOS_INICIO.map((e) => (
                      <button key={e.pedido} type="button" className="aura-chip w-full" onClick={() => pedir(e.pedido)}>
                        {e.texto}
                      </button>
                    ))}
                  </div>
                )}
              </aside>
              <main className="aura-trabajo" aria-labelledby="aura-trabajo-titulo">
                <div className="flex items-center gap-2 pl-4 sm:pl-5 pr-2 py-1.5 border-b border-(--aura-borde)">
                  <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-3">
                    <h1 id="aura-trabajo-titulo" className="font-display font-semibold text-[18px] text-(--aura-tinta)">
                      Conversación
                    </h1>
                    <span className="text-[13px] text-(--aura-tinta-2)">Se guarda solo en esta pestaña</span>
                  </div>
                  <button type="button" onClick={() => setMasOpen(true)} aria-label="Más opciones" aria-haspopup="dialog" className="aura-redondo plano">
                    <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
                  </button>
                </div>
                <Conversacion
                  entradas={conv.entradas}
                  onConfirmar={confirmarAccion}
                  onCancelar={cancelarAccion}
                  opinion={opinion}
                  onOpinar={opinar}
                  vacio={<Inicio nombre={nombreVisible} estado={estadoCerebro} onPedir={pedir} />}
                />
                <div className="border-t border-(--aura-borde) px-3 sm:px-4 pt-3 pb-3">
                  <Compositor
                    id="aura-trabajo-campo"
                    oyendo={oyendo}
                    onEnviar={(t) => {
                      playSfx('tap', soundFxEnabled);
                      pedir(t);
                    }}
                    despues={
                      <button type="button" onClick={alternarMic} aria-pressed={micEnabled} aria-label={etiquetaMic} className={`aura-mic chico ${micEnabled ? 'abierto' : ''} ${escuchando ? 'escuchando' : ''}`}>
                        {micEnabled ? <Mic className="w-5 h-5" aria-hidden="true" /> : <MicOff className="w-5 h-5" aria-hidden="true" />}
                      </button>
                    }
                  />
                </div>
              </main>
            </>
          )}

          {/* Conversar: el saludo con ejemplos, y el dock con Escribir, el micrófono al lado y «Más». */}
          {modoMesa === 'conversar' && (
            <div className="aura-dock absolute bottom-[calc(12px+env(safe-area-inset-bottom))] left-3 right-3 z-20 flex flex-col items-center gap-3 pointer-events-none">
              {!isBooting && !conv.entradas.length && !inicioOculto && (
                <div className="pointer-events-auto w-full max-w-xl">
                  <Inicio nombre={nombreVisible} estado={estadoCerebro} onPedir={pedir} flotante onCerrar={() => setInicioOculto(true)} />
                </div>
              )}
              {opinion && (
                <div className="pointer-events-auto flex items-center gap-1 bg-(--aura-panel) aura-sombra rounded-full pl-3 pr-1 py-1 text-[14px] text-(--aura-tinta-2)" role="group" aria-label="¿Te sirvió la respuesta?">
                  {opinion.estado === 'gracias' ? (
                    <span className="px-1 py-2.5">Gracias, lo anoto.</span>
                  ) : (
                    <>
                      <span className="pr-1">¿Te sirvió?</span>
                      {([1, -1] as const).map((v) => (
                        <button key={v} type="button" aria-label={v === 1 ? 'Sí me sirvió' : 'No me sirvió'} onClick={() => opinar(v)} className="w-11 h-11 rounded-full hover:bg-(--aura-oro-suave) cursor-pointer">
                          {v === 1 ? '👍' : '👎'}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
              <div className="pointer-events-auto flex items-center justify-center gap-2 min-[420px]:gap-3">
                <button ref={escribirBtn} type="button" onClick={() => setDockOpen(true)} className="aura-primario" aria-haspopup="dialog" aria-label="Escribir">
                  <Keyboard className="w-5 h-5" aria-hidden="true" />
                  {/* En un teléfono angosto entran los cuatro botones: «Escribir» queda con su ícono. */}
                  <span className="hidden min-[420px]:inline">Escribir</span>
                </button>
                <button type="button" onClick={alternarMic} disabled={vivoAbierta} aria-pressed={micEnabled} aria-label={etiquetaMic} className={`aura-mic ${micEnabled ? 'abierto' : ''} ${escuchando ? 'escuchando' : ''}`}>
                  {micEnabled ? <Mic className="w-7 h-7" aria-hidden="true" /> : <MicOff className="w-7 h-7" aria-hidden="true" />}
                </button>
                <button type="button" onClick={alternarEnVivo} aria-pressed={vivoAbierta} aria-label={vivoAbierta ? 'Colgar la conversación en vivo' : 'Hablar en vivo'} className={`aura-primario ${vivoAbierta ? 'en-vivo' : ''}`}>
                  {vivoAbierta ? <PhoneOff className="w-5 h-5" aria-hidden="true" /> : <AudioLines className="w-5 h-5" aria-hidden="true" />}
                  <span className="whitespace-nowrap">{vivoAbierta ? 'Colgar' : 'En vivo'}</span>
                </button>
                <button type="button" onClick={() => setMasOpen(true)} aria-label="Más opciones" aria-haspopup="dialog" className="aura-redondo !w-12 !h-12">
                  <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <span className="text-[14px] font-medium text-(--aura-tinta-2) bg-(--aura-fondo)/85 px-3 py-0.5 rounded-full" aria-hidden="true">
                {enVivo === 'conectando' ? 'Conectando en vivo…' : enVivo === 'hablando' ? 'En vivo · podés interrumpirla' : enVivo === 'escuchando' ? 'En vivo · te escucho' : !micEnabled ? 'Micrófono apagado' : escuchando ? 'Te escucho…' : 'Micrófono abierto · háblale'}
              </span>
            </div>
          )}

          <VisionOverlay isActive={visionEnabled} stealth onClose={() => setVisionEnabled(false)} onGazeUpdate={setCameraGaze} onEscena={alVerEscena} />
        </div>

        <DockDrawer
          isOpen={dockOpen}
          soundFxEnabled={soundFxEnabled}
          onClose={() => setDockOpen(false)}
          volverA={escribirBtn}
          onSubmitCommand={(c) => {
            setDockOpen(false);
            pedir(c);
          }}
        />

        <MenuMas
          abierto={masOpen}
          onCerrar={() => setMasOpen(false)}
          speakerEnabled={speakerEnabled}
          visionEnabled={visionEnabled}
          isSleeping={face === 'SLEEPING'}
          isKioskFrame={isKioskFrame}
          isFullscreen={isFullscreen}
          onToggleSpeaker={() => {
            setSpeakerEnabled((v) => !v);
            playSfx('tap', soundFxEnabled);
          }}
          onToggleVision={() => {
            setVisionEnabled((v) => !v);
            playSfx('tap', soundFxEnabled);
          }}
          onOpenCamera={() => setCameraOpen(true)}
          onToggleSleep={() => (face === 'SLEEPING' ? despertar() : dormir())}
          onToggleKioskFrame={() => setIsKioskFrame((v) => !v)}
          onToggleFullscreen={toggleFullscreen}
        />

        <SettingsSheet
          isOpen={settingsOpen}
          currentMode={mode}
          currentFace={face}
          soundFxEnabled={soundFxEnabled}
          speakerEnabled={speakerEnabled}
          funMode={funMode}
          usuario={usuario}
          tema={preferenciaTema}
          onTema={setPreferenciaTema}
          postura={conSala ? postura : undefined}
          onPostura={conSala ? setPostura : undefined}
          estadoCerebro={estadoCerebro}
          estadoArranque={estadoArranque}
          hayConversacion={conv.entradas.length > 0}
          onVaciarConversacion={conv.vaciar}
          onClose={() => setSettingsOpen(false)}
          onSelectMode={(m) => {
            setMode(m);
            setSettingsOpen(false);
            decir(`Modo ${nombreModo(m).toLowerCase()}.`, { emocion: 'neutral' });
          }}
          onSelectFace={(f) => {
            setSettingsOpen(false);
            cara(f, f === 'IDLE' ? 0 : 2800);
          }}
          onToggleSoundFx={() => setSoundFxEnabled((v) => !v)}
          onToggleSpeaker={() => setSpeakerEnabled((v) => !v)}
          onToggleFunMode={() => setFunMode((v) => !v)}
          onOpenAcceso={() => setAccesoOpen(true)}
          onOpenVault={() => setVaultOpen(true)}
          onOpenPhotos={() => setPhotosOpen(true)}
          onProbarVoz={() => decir('Hola. Soy AU-RA. Esta es mi voz, y así me río: je je. ¿Seguimos?', { emocion: 'feliz' })}
          onEjemplo={(c) => pedir(c)}
          onOlvidar={() => {
            historialRef.current = [];
            setSettingsOpen(false);
            // «Empezamos de cero» solo si el servidor confirmó que olvidó; si no, se dice qué pasó.
            void olvidarTodo({ usuario: usuario.name }).then((r) =>
              r.remoto === 'ok'
                ? decir('Listo. Empezamos de cero.', { emocion: 'neutral' })
                : r.remoto === 'sin-sesion'
                  ? decir('Borré lo de esta pantalla. Para olvidar lo guardado en tu cuenta tenés que entrar.', { emocion: 'neutral' })
                  : decir('Borré lo de esta pantalla, pero el servidor no confirmó el borrado. Probá de nuevo en un momento.', { emocion: 'neutral' })
            );
          }}
        />

        <AccesoModal
          isOpen={accesoOpen}
          enlace={enlaceCorreo}
          usuario={usuario}
          soundFxEnabled={soundFxEnabled}
          onClose={() => setAccesoOpen(false)}
          onAuthSuccess={(name, role, correo) => {
            setUsuario({ name, role, authenticated: true });
            fijarCuentaMemoria(correo);
            decir(saludoDe(name).id, { emocion: 'feliz' });
          }}
          onLogout={() => {
            setUsuario({ name: '', role: 'Junta Directiva · Orden Global', authenticated: false });
            // La memoria larga de esta cuenta deja de leerse (queda en su cajón para su vuelta).
            fijarCuentaMemoria(null);
            // Tableta compartida: quien entre después no hereda la conversación ni las fotos.
            historialRef.current = [];
            pendienteGenesis.current = '';
            setPhotos([]);
            setOpinion(null);
            decir('hastaluego', { emocion: 'carino' });
          }}
        />

        <UltronVaultModal isOpen={vaultOpen} onClose={() => setVaultOpen(false)} onSpeak={(t) => decir(t, { emocion: 'neutral' })} />

        <PhotoCaptureModal isOpen={photosOpen} onClose={() => setPhotosOpen(false)} photos={photos} onDeletePhoto={(id) => setPhotos((p) => p.filter((x) => x.id !== id))} onTriggerNewPhoto={() => { setPhotosOpen(false); setCameraOpen(true); }} />

        <CameraCountdownModal
          isOpen={cameraOpen}
          onClose={() => setCameraOpen(false)}
          soundFxEnabled={soundFxEnabled}
          onPhotoSaved={(photo) => {
            setIsCameraFlashing(true);
            setTimeout(() => setIsCameraFlashing(false), 450);
            setPhotos((p) => [{ id: photo.id, dataUrl: photo.dataUrl, timestamp: photo.timestamp, mode, caption: photo.caption || 'Foto' }, ...p]);
            decir('Foto guardada.', { emocion: 'feliz' });
          }}
          onAnalyzePhoto={(dataUrl) => {
            setCameraOpen(false);
            if (cerebroNoListo()) return;
            conv.persona('¿Qué ves en esta foto?', { conFoto: true });
            setFace('THINKING');
            // La foto tomada, achicada a JPEG de 640 px (no un cuadro en vivo de la cámara).
            void achicarFoto(dataUrl).then((imagen) => {
              if (!imagen) return void decir('No pude leer la foto. Probá tomarla de nuevo.', { emocion: 'preocupado' });
              void pensar('qué ves en esta foto', { imagen });
            });
          }}
        />

        <Arranque visible={isBooting} estado={estadoArranque} />
      </div>
    </div>
  );
}
