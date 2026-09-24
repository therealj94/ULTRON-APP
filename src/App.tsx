import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Mode, FaceState, CapturedPhoto } from './types';
import { FaceCanvas, caraDeEmocion } from './02-cara';
import type { Gesto } from './02-cara/gestos';
import { caraDeTexto } from './02-cara/emocion';
import { DockDrawer, SettingsSheet, Arranque, AccesoModal, UltronVaultModal, VisionOverlay, PhotoCaptureModal, CameraCountdownModal } from './07-pantallas';
import type { Escena } from './02-cara/vision/escena';
import { playSfx } from './03-voz/audio';
import { hablar, cantar, callar, setVozActiva, type Dicho } from './03-voz/hablar';
import { onLip, desbloquearAudio, audioDesbloqueado } from './03-voz/player';
import { clipDeEmocion, saludoHora, siguienteChiste } from './03-voz/banco';
import { useOido } from './03-voz/useOido';
import { pedirTurnoStream } from './04-cerebro/turno';
import { detectarIntencion } from './04-cerebro/intenciones';
import { grabFrame } from './04-cerebro/grabFrame';
import { guardarHecho, olvidarTodo } from './09-estado/memoria';
import { headersMesa } from './10-infra/sesionCliente';
import { cargarPerfil, perfil as perfilActual } from './perfil';
import type { Emocion } from '../lib/emocion';
import { Maximize2, Minimize2, SlidersHorizontal, Fingerprint, Camera, ShieldCheck, Settings2 } from 'lucide-react';

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

  // ---- UI
  const [dockOpen, setDockOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Nombre de la plataforma: lo dice el servidor (Genesis Core o Cerebro de Minas), no está escrito aquí.
  const [perfilPlataforma, setPerfilPlataforma] = useState(perfilActual().plataforma);
  useEffect(() => {
    let vivo = true;
    void cargarPerfil().then((p) => vivo && setPerfilPlataforma(p.plataforma));
    return () => {
      vivo = false;
    };
  }, []);
  const [accesoOpen, setAccesoOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [bubble, setBubble] = useState({ texto: '', visible: false });
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
  const decir = useCallback(
    (texto: string, o: { emocion?: Emocion; caraFinal?: FaceState; sinBurbuja?: boolean } = {}) => {
      const t = String(texto || '').trim();
      if (!t) return { fin: Promise.resolve() };
      const e = o.emocion || 'neutral';
      if (e !== 'neutral') setEmocion(e);
      const d = hablar(t, { emocion: e });
      hablando.current = d;
      const caraHabla: FaceState = d.clip?.cara || (e === 'canto' ? 'SING' : e === 'oracion' ? 'PRAY' : e === 'risa' ? 'LAUGH' : 'SPEAKING');
      d.inicio.then(() => {
        if (hablando.current !== d) return;
        setFace(caraHabla);
        // La burbuja muestra lo que se OYE: si fue un clip del banco, su texto humano, nunca el id interno.
        const visible = d.clip?.texto || (d.clip ? '' : t);
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
    [showBubble]
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
    };
    return () => {
      delete (window as any).__ultron;
    };
  }, [decir]);

  const callarTodo = useCallback(() => {
    callar();
    hablando.current = null;
    colaRef.current = [];
    setFace('IDLE');
  }, []);

  // ---- Cola de frases (el turno llega en stream; se habla frase a frase, sin pisarse)
  const colaRef = useRef<Array<{ texto: string; emocion: Emocion }>>([]);
  const colaActiva = useRef(false);
  const bombear = useCallback(async () => {
    if (colaActiva.current) return;
    colaActiva.current = true;
    while (colaRef.current.length) {
      const item = colaRef.current.shift()!;
      const d = decir(item.texto, { emocion: item.emocion, sinBurbuja: false });
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
        if (vivo && d.authenticated && d.user) setUsuario({ name: d.user.nombre || '', role: d.user.rol || 'Junta Directiva · Orden Global', authenticated: true });
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
    const sondear = () =>
      fetch('/api/nodo/listo')
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
        .catch(() => vivo && setCerebroListo((s) => (s === 'listo' ? s : 'frio')));
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
            decir(Math.random() < 0.5 ? 'hola' : 'aqui', { emocion: 'feliz' });
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
  const pensar = useCallback(
    async (cmd: string) => {
      turnoEnCurso.current?.abort();
      const ac = new AbortController();
      turnoEnCurso.current = ac;
      callarTodo();
      setFace('THINKING');
      setEmocion('pensando');
      playSfx('think', soundFxEnabled);
      const quiereVer = /qu[eé] ves|qu[eé] hay aqu[ií]|imagen|c[aá]mara|le[eé] (esto|la foto|la etiqueta)/i.test(cmd);
      const image = quiereVer && visionEnabled ? grabFrame() : null;
      // Si el 27B tarda, AU-RA piensa en voz alta con un clip (sin red).
      const relleno = setTimeout(() => {
        if (turnoEnCurso.current === ac && colaRef.current.length === 0 && !hablando.current) decir(Math.random() < 0.5 ? 'mmm' : 'mmm2', { emocion: 'pensando', sinBurbuja: true });
      }, 1400);
      let pendiente = '';
      let emo: Emocion = 'neutral';
      const soltar = (final = false) => {
        const partes = pendiente.split(/(?<=[.!?…])\s+/);
        const listas = final ? partes : partes.slice(0, -1);
        pendiente = final ? '' : partes[partes.length - 1] || '';
        for (const p of listas) if (p.trim()) colaRef.current.push({ texto: p.trim(), emocion: emo });
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
            signal: ac.signal,
          },
          {
            onEmocion: (e) => {
              emo = e;
              setEmocion(e);
              const c = caraDeEmocion(e);
              if (c !== 'IDLE') setFace(c);
              const clip = clipDeEmocion(e);
              if (clip && (e === 'risa' || e === 'sorpresa')) colaRef.current.push({ texto: clip.id, emocion: e });
            },
            onDelta: (t) => {
              clearTimeout(relleno);
              pendiente += t;
              soltar(false);
            },
            onReplace: (t) => {
              colaRef.current = [];
              callar();
              pendiente = t;
              soltar(true);
            },
          }
        );
        clearTimeout(relleno);
        if (turnoEnCurso.current !== ac) return;
        if (data.error === 'sesión requerida') {
          setAccesoOpen(true);
          decir('Eso necesita tu sesión de junta. Entrá y lo hacemos.', { emocion: 'neutral' });
          return;
        }
        const texto = String(data.reply || '').trim();
        if (!texto) {
          decir(`No alcancé el cerebro. ${String(data.error || '').slice(0, 80)}`.trim(), { emocion: 'preocupado' });
          return;
        }
        if (data.emocion) emo = data.emocion;
        soltar(true);
        historialRef.current = [...historialRef.current, { rol: 'user', texto: cmd }, { rol: 'ultron', texto }].slice(-12);
        if (pendienteGenesis.current && /orden global|junta|mina|prospera|aucorp|token|concesi/i.test(cmd)) {
          colaRef.current.push({ texto: '¿Lo actualizo en el cerebro Genesis Core?', emocion: 'curioso' });
          void bombear();
        }
      } catch (e: any) {
        clearTimeout(relleno);
        if (e?.name === 'AbortError') return;
        decir(`Sin cerebro ahora mismo. ${String(e?.message || e).slice(0, 80)}`, { emocion: 'preocupado' });
      }
    },
    [mode, usuario.name, visionEnabled, soundFxEnabled, decir, bombear, callarTodo]
  );

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
          return;
        case 'recordar':
          guardarHecho(it.hecho, { usuario: usuario.name });
          pendienteGenesis.current = it.hecho;
          decir('Anotado. Si es de la junta, decime «actualiza el cerebro» y queda en Genesis Core.', { emocion: 'orgullo' });
          return;
        case 'genesis': {
          const hecho = pendienteGenesis.current || historialRef.current.filter((h) => h.rol === 'user').slice(-1)[0]?.texto || '';
          if (!hecho) return void decir('Decime el hecho primero y después «actualiza el cerebro».', { emocion: 'curioso' });
          guardarHecho(`[Genesis] ${hecho}`, { usuario: usuario.name, junta: true });
          pendienteGenesis.current = '';
          decir('Quedó en Genesis Core. La próxima pregunta ya lo usa.', { emocion: 'orgullo' });
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
          if (cerebroListoRef.current !== 'listo') {
            showBubble(cerebroListoRef.current === 'calentando' ? 'Calentando el 27B… un momento.' : 'Sin cerebro. Reviso el nodo.');
            decir('calentando el motor', { emocion: 'pensando' });
            return;
          }
          setFace(caraDeTexto(cmd) === 'LISTENING' ? 'THINKING' : caraDeTexto(cmd));
          void pensar(cmd);
      }
    },
    [usuario.name, soundFxEnabled, decir, pensar, dormir, despertar, callarTodo, showBubble]
  );

  // ---- OÍDO continuo con barge-in.
  useOido({
    activo: micEnabled && !isBooting,
    onFinal: (t) => comando(t),
    onParcial: (t) => {
      showBubble(t, 2500);
      setFace((f) => (f === 'SLEEPING' ? f : 'LISTENING'));
    },
    onBargeIn: () => {
      if (hablando.current || colaRef.current.length) callarTodo();
      setFace('LISTENING');
    },
    onSinPermiso: () => {
      showBubble('Permití el micrófono en el navegador para hablarme.');
      setMicEnabled(false);
    },
    onNoSoportado: () => showBubble('Este navegador no oye voz. Usá Chrome o escribí abajo.'),
  });

  // ---- Gestos de la cara → reacciones baratas (clips, sin red)
  const gesto = useCallback(
    (g: Gesto) => {
      if (g === 'tapBarbilla') decir(Math.random() < 0.5 ? 'risa1' : 'risa2', { emocion: 'risa' });
      else if (g === 'tapFrente') decir('uy2', { emocion: 'curioso' });
      else if (g === 'frotarMejilla') decir('carino', { emocion: 'carino' });
      else if (g === 'dormir') dormir();
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

  const chipEstado = cerebroListo === 'listo' ? 'LISTO' : cerebroListo === 'calentando' ? 'CALIENTA' : 'FRÍO';

  return (
    <div id="ultron-app-root" className="relative w-screen h-screen overflow-hidden bg-black flex items-center justify-center select-none">
      <div
        id="ultron-stand-container"
        className={`relative overflow-hidden transition-all duration-300 flex items-center justify-center ${
          isKioskFrame
            ? 'w-full max-w-[96vw] max-h-[88vh] aspect-[16/10] rounded-[28px] border-[10px] border-[#15191e] shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_20px_rgba(5,225,255,0.15)] ring-1 ring-white/10'
            : 'w-full h-full'
        }`}
      >
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

        {/* Barra superior mínima */}
        <div className="absolute top-4 left-5 right-5 z-20 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 border border-[#05E1FF]/30 backdrop-blur-md shadow-[0_0_15px_rgba(5,225,255,0.15)] pointer-events-auto">
            <span className={`w-2 h-2 rounded-full ${cerebroListo === 'listo' ? 'bg-[#05E1FF] animate-pulse' : cerebroListo === 'calentando' ? 'bg-amber-400 animate-pulse' : 'bg-red-500'}`} />
            <span className="font-display font-bold tracking-[0.2em] text-xs" style={{ color: 'var(--acento, #05E1FF)' }}>
              {perfilPlataforma}
            </span>
            <span className="font-mono text-[9px] tracking-[0.2em] text-[#6B8A90] hidden sm:inline">· {chipEstado}</span>
          </div>
          <div className="flex items-center gap-2 pointer-events-auto">
            {face === 'LISTENING' && (
              <div className="font-display font-bold tracking-[0.25em] text-[#05E1FF] text-[10px] hidden md:block px-2.5 py-1 rounded-full bg-[#05E1FF]/10 border border-[#05E1FF]/30 animate-pulse">ESCUCHANDO</div>
            )}
            <button
              type="button"
              onClick={() => setAccesoOpen(true)}
              title={usuario.authenticated ? `Sesión: ${usuario.name}` : 'Entrar a la junta'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer ${
                usuario.authenticated ? 'bg-[#00FF88]/15 border border-[#00FF88]/50 text-[#00FF88]' : 'bg-black/60 border border-[#05E1FF]/40 text-[#05E1FF] hover:bg-[#05E1FF]/15'
              }`}
            >
              {usuario.authenticated ? <ShieldCheck className="w-3.5 h-3.5" /> : <Fingerprint className="w-3.5 h-3.5" />}
              <span className="font-bold">{usuario.authenticated ? usuario.name.toUpperCase() : 'ACCESO'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setVisionEnabled((v) => !v);
                playSfx('tap', soundFxEnabled);
              }}
              title={visionEnabled ? 'Cámara siguiéndote' : 'Activar cámara'}
              className={`p-2 rounded-full border transition-all cursor-pointer ${visionEnabled ? 'border-[#05E1FF] bg-[#05E1FF]/20 text-[#05E1FF]' : 'border-[#8FA3B0]/30 bg-black/60 text-[#8FA3B0] hover:text-[#05E1FF]'}`}
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => setSettingsOpen((v) => !v)} title="Ajustes y qué puede hacer" className="p-2 rounded-full border border-[#05E1FF]/40 bg-black/60 text-[#05E1FF] hover:bg-[#05E1FF]/15 cursor-pointer">
              <Settings2 className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => setDockOpen((v) => !v)} title="Panel" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#05E1FF]/40 bg-[#05E1FF]/10 text-[#05E1FF] hover:bg-[#05E1FF]/25 text-xs font-display font-bold tracking-wider cursor-pointer">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">PANEL</span>
            </button>
            <button type="button" onClick={toggleFullscreen} title="Pantalla completa" className="p-2 rounded-full text-[#8FA3B0] hover:text-[#05E1FF] bg-black/40 border border-white/10 cursor-pointer">
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Burbuja */}
        <div
          id="ultron-speech-bubble"
          className={`absolute left-1/2 bottom-[15%] -translate-x-1/2 z-20 max-w-[85vw] sm:max-w-xl text-center px-4 py-2 rounded-2xl border border-[#05E1FF]/30 bg-black/75 backdrop-blur-sm text-sm font-mono text-[#dff8ff] transition-all duration-300 pointer-events-none shadow-[0_0_20px_rgba(5,225,255,0.2)] ${
            bubble.visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          }`}
        >
          {bubble.texto}
        </div>

        <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 z-10 opacity-40 hover:opacity-100 cursor-pointer ${dockOpen || settingsOpen ? 'hidden' : 'block'}`} onClick={() => setDockOpen(true)} title="Deslizá hacia arriba">
          <div className="w-10 h-1 rounded-full bg-[#05E1FF]/50" />
        </div>

        <VisionOverlay isActive={visionEnabled} stealth onClose={() => setVisionEnabled(false)} onGazeUpdate={setCameraGaze} onEscena={alVerEscena} />

        <DockDrawer
          isOpen={dockOpen}
          micEnabled={micEnabled}
          speakerEnabled={speakerEnabled}
          visionEnabled={visionEnabled}
          isSleeping={face === 'SLEEPING'}
          isKioskFrame={isKioskFrame}
          soundFxEnabled={soundFxEnabled}
          onToggleMic={() => {
            setMicEnabled((v) => !v);
            playSfx('tap', soundFxEnabled);
          }}
          onToggleSpeaker={() => {
            setSpeakerEnabled((v) => !v);
            playSfx('tap', soundFxEnabled);
          }}
          onToggleVision={() => setVisionEnabled((v) => !v)}
          onToggleSleep={() => (face === 'SLEEPING' ? despertar() : dormir())}
          onToggleKioskFrame={() => setIsKioskFrame((v) => !v)}
          onOpenCamera={() => {
            setDockOpen(false);
            setCameraOpen(true);
          }}
          onSubmitCommand={(c) => {
            setDockOpen(false);
            comando(c);
          }}
        />

        <SettingsSheet
          isOpen={settingsOpen}
          currentMode={mode}
          currentFace={face}
          soundFxEnabled={soundFxEnabled}
          speakerEnabled={speakerEnabled}
          funMode={funMode}
          usuario={usuario}
          onClose={() => setSettingsOpen(false)}
          onSelectMode={(m) => {
            setMode(m);
            setSettingsOpen(false);
            decir(`Modo ${m.toLowerCase()}.`, { emocion: 'neutral' });
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
          onEjemplo={(c) => comando(c)}
          onOlvidar={() => {
            historialRef.current = [];
            olvidarTodo({ usuario: usuario.name });
            setSettingsOpen(false);
            decir('Listo. Empezamos de cero.', { emocion: 'neutral' });
          }}
        />

        <AccesoModal
          isOpen={accesoOpen}
          usuario={usuario}
          soundFxEnabled={soundFxEnabled}
          onClose={() => setAccesoOpen(false)}
          onAuthSuccess={(name, role) => {
            setUsuario({ name, role, authenticated: true });
            decir(`Bienvenido, ${name}. Ya estoy contigo.`, { emocion: 'feliz' });
          }}
          onLogout={() => {
            setUsuario({ name: '', role: 'Junta Directiva · Orden Global', authenticated: false });
            decir('Sesión cerrada.', { emocion: 'neutral' });
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
            void pensar('qué ves en esta foto');
            void dataUrl;
          }}
        />

        <Arranque visible={isBooting} estado={estadoArranque} />
      </div>
    </div>
  );
}
