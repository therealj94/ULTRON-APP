/**
 * EL VISOR DE SU COMPUTADORA, A PANTALLA COMPLETA (AUR09 del documento maestro del 3-oct: «la computadora debe poder
 * abrirse completamente y usarse directamente»).
 *
 * Una pantalla propia (un Modal a pantalla completa, NO el fullscreen de toda la app) que se abre desde la tarea
 * (la hoja de su computadora, «Pantalla completa») y se cierra para volver al chat sin tocar la tarea; reabrirla
 * encuentra la misma sesión (app/visor.ts: el control, la secuencia, el zoom). AURA nunca la abre sola.
 *
 *  · Arriba, una barra discreta y fija: volver, el modo («AURA controla», «Solicitando control», «Tú controlas»,
 *    «Sin conexión»), el entorno, la conexión y la edad de la imagen, la tarea, y los mandos: tomar/devolver,
 *    pausar/seguir, cancelar, ajustar/zoom y la entrada segura.
 *  · En medio, el escritorio con UNA capa de coordenadas (lib/entradaRemota.ts): pellizcar acerca, dos dedos mueven
 *    la vista; con el control, tocar es clic, doble toque doble clic, el toque largo clic derecho, mantener y mover
 *    arrastra y mover baja la página (nunca un clic). Rotar o abrir el teclado no desalinea nada.
 *  · Abajo, con el control: el campo para escribir (el teclado del teléfono con su IME; se manda el texto final),
 *    Enter, Tab, Esc, flechas, Borrar/Supr, Ctrl/Shift/Alt para las combinaciones permitidas y bajar/subir con
 *    botones (la ruta sin gestos precisos). En entrada segura, el campo es de contraseña y AURA no ve ni toca nada.
 *  · Con el servicio de antes (sin `entrada`), el visor usa la acción de antes (clic en [0, 1000], escribir, teclas).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, AppState, Image, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, StyleSheet, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { tr, idiomaActual } from '../i18n';
import { Texto, vibrar } from '../ui';
import { respuestaPc, trabajando, type EstadoPc, type TareaPc } from '../compa/computadora';
import {
  AcumuladorScroll,
  BufferTeclado,
  FRAME_VIEJO_MS,
  Gestos,
  aLogico,
  aNormalizado,
  alternarZoom,
  comboPermitido,
  desplazar,
  edadFrame,
  intervaloCaptura,
  limitarVista,
  modoDeControl,
  transformacion,
  vistaAjustada,
  zoomEn,
  type AckEntrada,
  type EntradaRemota,
  type FrameMeta,
  type Gesto,
  type Mod,
  type ModoControl,
  type Punto,
  type Tam,
  type TipoEntrada,
  type VistaZoom,
} from '../lib/entradaRemota';
import { cerrarVisor, guardarVista, seguirEnVisor, sesionDe, soltarOyente, suscribirVisor, visorAhora, vistaGuardada } from './visor';

const NEGRO = '#05070a';
const VELO = 'rgba(8,10,14,0.78)';
const BLANCO = '#f4f6f8';
const GRIS = '#a9b1bb';
const AMBAR = '#f2b134';
const VERDE = '#4cc38a';
const ROJO = '#ef6b5b';
const AZUL = '#5aa9ff';
/** Sin respuesta en este rato (ni pantalla ni tarea): «Sin conexión». */
const SIN_CONEXION_MS = 6000;

/** Las teclas de abajo (las del texto van por el campo). */
const TECLAS: { tecla: string; etiqueta: string; lector: [string, string] }[] = [
  { tecla: 'escape', etiqueta: 'Esc', lector: ['Escape', 'Escape'] },
  { tecla: 'tab', etiqueta: 'Tab', lector: ['Tabulador', 'Tab'] },
  { tecla: 'backspace', etiqueta: '⌫', lector: ['Borrar', 'Backspace'] },
  { tecla: 'delete', etiqueta: 'Supr', lector: ['Suprimir', 'Delete'] },
  { tecla: 'left', etiqueta: '←', lector: ['Flecha izquierda', 'Left arrow'] },
  { tecla: 'up', etiqueta: '↑', lector: ['Flecha arriba', 'Up arrow'] },
  { tecla: 'down', etiqueta: '↓', lector: ['Flecha abajo', 'Down arrow'] },
  { tecla: 'right', etiqueta: '→', lector: ['Flecha derecha', 'Right arrow'] },
  { tecla: 'enter', etiqueta: '⏎', lector: ['Enter', 'Enter'] },
];
/** Las teclas que entiende el servicio de antes (agente.py sin `entrada`: TECLAS_PERSONA). */
const TECLAS_DE_ANTES = new Set(['enter', 'tab', 'escape', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'pageup', 'pagedown', 'home', 'end', 'space', 'ctrl+l', 'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+f', 'alt+left', 'alt+right', 'f5']);

type Imagen = { b64: string; meta: FrameMeta; recibidoEn: number };

export function VisorComputadora({ tareaSeguida = null }: { tareaSeguida?: string | null }) {
  const visor = useSyncExternalStore(suscribirVisor, visorAhora, visorAhora);
  if (!visor.abierto || !visor.tareaId) return null;
  return <Visor tareaId={visor.tareaId} tareaSeguida={tareaSeguida} />;
}

function Visor({ tareaId, tareaSeguida }: { tareaId: string; tareaSeguida: string | null }) {
  const ins = useSafeAreaInsets();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [tarea, setTarea] = useState<TareaPc | null>(null);
  const [caps, setCaps] = useState<string[]>([]);
  const [imagen, setImagen] = useState<Imagen | null>(null);
  const [caja, setCaja] = useState<Tam>({ ancho: 1, alto: 1 });
  const [vista, setVista] = useState<VistaZoom | null>(() => vistaGuardada(tareaId));
  const [ahora, setAhora] = useState(Date.now());
  const [ultimoOk, setUltimoOk] = useState(Date.now());
  const [pidiendo, setPidiendo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [texto, setTexto] = useState('');
  const [enVuelo, setEnVuelo] = useState(0);
  const [, setVersion] = useState(0);
  const repintar = useCallback(() => setVersion((n) => n + 1), []);

  const conEntrada = caps.includes('entrada');
  const conSeguro = caps.includes('seguro');
  const conControl = caps.includes('control');
  const enviar = useCallback(
    (e: EntradaRemota) =>
      api<{ ack: AckEntrada }>(`/api/computadora/tareas/${encodeURIComponent(tareaId)}/entrada`, { method: 'POST', body: JSON.stringify(e) }, 12_000).then((r) => r.ack),
    [tareaId]
  );
  const sesion = useMemo(() => sesionDe(tareaId, enviar, repintar), [tareaId, enviar, repintar]);
  useEffect(() => () => soltarOyente(tareaId, repintar), [tareaId, repintar]);
  const buffer = useRef(new BufferTeclado()).current;
  const gestos = useRef(new Gestos()).current;
  const scroll = useRef(new AcumuladorScroll(40)).current;
  const scrollPendiente = useRef<{ n: number; x: number; y: number; enVuelo: boolean }>({ n: 0, x: 0, y: 0, enVuelo: false });
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origen = useRef<View>(null);
  const offset = useRef<Punto>({ x: 0, y: 0 });

  const estado = tarea?.estado ?? null;
  const viva = trabajando(estado);
  const conectado = ahora - ultimoOk < SIN_CONEXION_MS;
  const modo: ModoControl = modoDeControl({ estado, conectado, pidiendo });
  const tengo = modo === 'tu' && (!conEntrada || sesion.epoca != null);
  const seguro = !!tarea?.seguro;
  const frame: Tam = imagen ? { ancho: imagen.meta.ancho, alto: imagen.meta.alto } : { ancho: 1280, alto: 800 };
  const v = limitarVista(caja, frame, vista ?? vistaAjustada(frame));
  const T = transformacion(caja, frame, v);
  const edad = imagen ? edadFrame(imagen.meta, imagen.recibidoEn, ahora) : null;
  const vieja = edad != null && edad > FRAME_VIEJO_MS;
  const bloqueo = tengo && conEntrada ? sesion.bloqueo() : null;

  const avisar = useCallback((t: string) => {
    setAviso(t);
    if (t) setTimeout(() => setAviso((x) => (x === t ? '' : x)), 3500);
  }, []);
  const conexionOk = useCallback(() => {
    setUltimoOk(Date.now());
    void sesion.alReconectar();
  }, [sesion]);
  const conexionMal = useCallback(
    (e: any) => {
      // Sin código: no llegó (red). Se sueltan los modificadores y se pide imagen nueva; al volver, release_all.
      if (!e?.status) sesion.alDesconectar();
    },
    [sesion]
  );

  // La vista (zoom y centro) se guarda con la sesión: al reabrir, el mismo encuadre.
  useEffect(() => {
    if (vista) guardarVista(tareaId, vista);
  }, [tareaId, vista]);

  // El reloj de la edad de la imagen y de la conexión.
  useEffect(() => {
    const r = setInterval(() => setAhora(Date.now()), 500);
    return () => clearInterval(r);
  }, []);

  // Android de pantalla completa a veces no achica la ventana del Modal con el teclado (como en ui/Hoja.tsx): lo que
  // mide el teclado se suma abajo. La caja del escritorio se achica (onLayout) y la transformación se recalcula.
  const [teclado, setTeclado] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const a = Keyboard.addListener('keyboardDidShow', (e) => setTeclado(e.endCoordinates?.height || 0));
    const b = Keyboard.addListener('keyboardDidHide', () => setTeclado(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  // Lo que sabe su servicio.
  useEffect(() => {
    let vivo = true;
    const leer = () =>
      api<EstadoPc>('/api/computadora', { method: 'GET' }, 12_000)
        .then((s) => vivo && setCaps((s.capacidades as string[] | undefined) ?? []))
        .catch(() => undefined);
    void leer();
    const r = setInterval(leer, 30_000);
    return () => {
      vivo = false;
      clearInterval(r);
    };
  }, []);

  // La tarea, cada 2,5 s: su estado, la pregunta, la época del control y si está en entrada segura.
  const leerTarea = useCallback(async () => {
    // La época con que salió la lectura: si mientras iba se tomó el control aquí, lo que traiga es de antes y no cerca nada.
    const epocaAlPedir = sesion.epoca;
    try {
      const r = await api<{ tarea: TareaPc }>(`/api/computadora/tareas/${encodeURIComponent(tareaId)}?idioma=${idioma}`, { method: 'GET' }, 12_000);
      setTarea(r.tarea);
      conexionOk();
      // Otro dispositivo (u otra sesión) tomó el control, o ya no es de nadie: esta queda cercada.
      if (sesion.epoca != null && sesion.epoca === epocaAlPedir && (r.tarea.estado !== 'control' || (typeof r.tarea.epoca === 'number' && r.tarea.epoca > sesion.epoca))) {
        sesion.sinControl();
        if (r.tarea.estado === 'control') avisar(tr('Otro dispositivo tomó el control.', 'Another device took control.'));
      }
      if (r.tarea.estado === 'control') setPidiendo(false);
    } catch (e) {
      conexionMal(e);
    }
  }, [tareaId, idioma, sesion, conexionOk, conexionMal, avisar]);
  useEffect(() => {
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      await leerTarea();
      if (vivo) reloj = setTimeout(vuelta, 2500);
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [leerTarea]);

  // La pantalla de ahora: con el control ~0,7 s (nunca dos a la vez), con AURA cada 2 s. Más nítida con zoom.
  const pidiendoPantalla = useRef(false);
  const contador = useRef(0);
  const ultimaDuracion = useRef(0);
  const leerPantalla = useCallback(async (): Promise<Imagen | null> => {
    if (pidiendoPantalla.current) return null;
    pidiendoPantalla.current = true;
    const desde = Date.now();
    try {
      const ancho = v.zoom > 1.5 ? 1280 : 960;
      const r = await api<{ imagen: string; frame: FrameMeta | null }>(`/api/computadora/tareas/${encodeURIComponent(tareaId)}/pantalla?ancho=${ancho}`, { method: 'GET' }, 12_000);
      const recibidoEn = Date.now();
      // El servicio de antes no dice su frame: se toma como recién llegado, del tamaño del escritorio de siempre.
      const meta: FrameMeta = r.frame ?? { seq: ++contador.current, ts: recibidoEn, ancho: 1280, alto: 800, viewportRevision: 0, epoca: null, privado: false, edadMs: 0 };
      const img = { b64: r.imagen, meta, recibidoEn };
      setImagen(img);
      sesion.alFrame(meta, recibidoEn);
      conexionOk();
      ultimaDuracion.current = recibidoEn - desde;
      return img;
    } catch (e) {
      conexionMal(e);
      return null;
    } finally {
      pidiendoPantalla.current = false;
    }
  }, [tareaId, v.zoom, sesion, conexionOk, conexionMal]);
  const leerPantallaRef = useRef(leerPantalla);
  leerPantallaRef.current = leerPantalla;
  const modoRef = useRef(modo);
  modoRef.current = modo;
  const puedeVer = conControl && viva && estado !== 'en_cola';
  useEffect(() => {
    if (!puedeVer) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      if (AppState.currentState === 'active') await leerPantallaRef.current();
      if (vivo) reloj = setTimeout(vuelta, intervaloCaptura(modoRef.current, ultimaDuracion.current));
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [puedeVer]);

  // La app se va atrás (blur): se sueltan los modificadores y, al volver, release_all e imagen nueva.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') sesion.alDesconectar();
      else {
        void sesion.alReconectar();
        void leerPantallaRef.current();
      }
    });
    return () => sub.remove();
  }, [sesion]);

  // Si la misión siguió con otra tarea y esta terminó, el visor la sigue (sin abrirse ni cerrarse solo).
  useEffect(() => {
    if (!viva && estado && tareaSeguida && tareaSeguida !== tareaId) seguirEnVisor(tareaSeguida);
  }, [viva, estado, tareaSeguida, tareaId]);

  /* -------------------------------------------------------------- mandos */

  const sobreTarea = async (que: string, ruta: string, cuerpo: Record<string, unknown> = {}) => {
    if (ocupado && que !== 'parar') return null;
    setOcupado(que);
    try {
      const r = await api<any>(`/api/computadora/tareas/${encodeURIComponent(tareaId)}/${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }, 15_000);
      vibrar('medio');
      return r;
    } catch (e: any) {
      vibrar('aviso');
      avisar(e?.message || tr('La computadora no contestó.', 'The computer didn’t answer.'));
      return null;
    } finally {
      setOcupado(null);
      void leerTarea();
    }
  };

  const tomar = async () => {
    setPidiendo(true);
    const r = await sobreTarea('tomar', 'control', { tomar: true, clientId: sesion.clientId, ...(typeof tarea?.epoca === 'number' ? { expectedControlEpoch: tarea.epoca } : {}) });
    if (!r) {
      setPidiendo(false);
      return;
    }
    if (conEntrada && Number.isInteger(r.epoca)) sesion.alControl(r.epoca);
    if (r.fase === 'draining') avisar(tr('Está terminando lo que ya había empezado; en un momento es tuya.', 'It is finishing what it had started; in a moment it is yours.'));
    void leerPantalla();
  };

  const devolver = async () => {
    if (seguro) return avisar(tr('Primero termina la entrada segura.', 'First finish secure input.'));
    if (conEntrada && sesion.epoca != null) await sesion.entrada('release_all', {});
    const r = await sobreTarea('devolver', 'control', { tomar: false, clientId: sesion.clientId });
    if (r) sesion.sinControl();
  };

  const cancelar = () => {
    Alert.alert(tr('¿Cancelar la tarea?', 'Cancel the task?'), tr('Se detiene lo que hace tu computadora. Lo que ya hizo queda hecho.', 'What your computer is doing stops. What it already did stays done.'), [
      { text: tr('No', 'No'), style: 'cancel' },
      { text: tr('Sí, cancelar', 'Yes, cancel'), style: 'destructive', onPress: () => void sobreTarea('parar', 'parar') },
    ]);
  };

  const activarSeguro = async () => {
    const r = await sobreTarea('seguro', 'seguro', { activar: true, clientId: sesion.clientId });
    if (r?.seguro) avisar(tr('Entrada segura: AURA no ve ni toca nada hasta que termines.', 'Secure input: AURA neither sees nor touches anything until you finish.'));
  };

  /** Salir de la entrada segura: con una imagen pedida AHORA (después de lo último que escribiste). */
  const terminarSeguro = async () => {
    for (let intento = 0; intento < 2; intento++) {
      const img = await leerPantalla();
      const seq = img?.meta.seq ?? imagen?.meta.seq;
      try {
        await api(`/api/computadora/tareas/${encodeURIComponent(tareaId)}/seguro`, { method: 'POST', body: JSON.stringify({ activar: false, clientId: sesion.clientId, frameSeq: seq }) }, 12_000);
        sesion.pedirResync();
        void leerTarea();
        return;
      } catch (e: any) {
        if (e?.data?.code !== 'frame_viejo') return avisar(e?.message || '');
      }
    }
    avisar(tr('Mira la pantalla de ahora y vuelve a intentarlo.', 'Look at the current screen and try again.'));
  };

  /* -------------------------------------------------------------- entradas */

  /** Una entrada: por el contrato (con su ACK) o, con el servicio de antes, por la acción de antes. */
  const entrada = async (tipo: TipoEntrada, payload: Record<string, unknown>) => {
    if (!tengo) return;
    if (!conEntrada) return entradaDeAntes(tipo, payload);
    setEnVuelo((n) => n + 1);
    const r = await sesion.entrada(tipo, payload);
    setEnVuelo((n) => n - 1);
    if (r.ok) {
      vibrar('suave');
      void leerPantalla(); // la imagen de después, sin esperar la vuelta
      return;
    }
    if (r.motivo === 'viejo' || r.motivo === 'resync' || r.motivo === 'tras_entrada' || r.motivo === 'sin_frame') {
      avisar(tr('Espera la imagen de ahora para tocar.', 'Wait for the current image before tapping.'));
      void leerPantalla();
    } else if (r.motivo !== 'desconectado') avisar(r.error || r.motivo);
  };

  const entradaDeAntes = async (tipo: TipoEntrada, p: Record<string, any>) => {
    let cuerpo: Record<string, unknown> | null = null;
    if (tipo === 'pointer' && p.accion === 'click') cuerpo = { tipo: 'click', ...aNormalizado({ x: p.x, y: p.y }, frame) };
    else if (tipo === 'text_commit') cuerpo = { tipo: 'escribir', texto: p.texto };
    else if (tipo === 'scroll') cuerpo = { tipo: 'scroll', direccion: p.dy < 0 ? 'up' : 'down' };
    else if (tipo === 'key') {
      const combo = [...(p.mods as string[]), p.tecla].join('+');
      if (TECLAS_DE_ANTES.has(combo)) cuerpo = { tipo: 'tecla', teclas: combo };
    }
    if (!cuerpo) return avisar(tr('Eso llega cuando se actualice el servicio de su computadora.', 'That arrives once its computer service is updated.'));
    try {
      await api(`/api/computadora/tareas/${encodeURIComponent(tareaId)}/accion`, { method: 'POST', body: JSON.stringify(cuerpo) }, 20_000);
      vibrar('suave');
      void leerPantalla();
    } catch (e: any) {
      avisar(e?.message || '');
    }
  };

  /** El scroll se junta mientras uno va en camino (no se encolan cien). */
  const empujarScroll = (n: number, x: number, y: number) => {
    const sp = scrollPendiente.current;
    sp.n += n;
    sp.x = x;
    sp.y = y;
    if (sp.enVuelo || !sp.n) return;
    const paso = Math.max(-10, Math.min(10, sp.n));
    sp.n -= paso;
    sp.enVuelo = true;
    void entrada('scroll', { x: Math.round(sp.x), y: Math.round(sp.y), dy: paso }).finally(() => {
      sp.enVuelo = false;
      if (sp.n) empujarScroll(0, sp.x, sp.y);
    });
  };

  const alGesto = (g: Gesto) => {
    if (g.tipo === 'zoom') return setVista((x) => zoomEn(caja, frame, x ?? vistaAjustada(frame), g.factor, g.foco));
    if (g.tipo === 'pan') return setVista((x) => desplazar(caja, frame, x ?? vistaAjustada(frame), g.dx, g.dy));
    if (!tengo) {
      // Sin el control: mover pasea la vista (con zoom) y el doble toque acerca o ajusta; tocar no hace nada.
      if (g.tipo === 'scroll') return setVista((x) => desplazar(caja, frame, x ?? vistaAjustada(frame), g.dx, g.dy));
      if (g.tipo === 'doble') return setVista((x) => alternarZoom(caja, frame, x ?? vistaAjustada(frame), { x: g.x, y: g.y }));
      if (g.tipo === 'toque' && viva) avisar(tr('Toma el control para tocar la pantalla.', 'Take control to touch the screen.'));
      return;
    }
    if (g.tipo === 'scroll') {
      const p = aLogico(T, frame, g.x, g.y);
      if (!p) return;
      const n = scroll.sumar(g.dy / T.s);
      if (n) empujarScroll(n, p.x, p.y);
      return;
    }
    if (g.tipo === 'arrastre') {
      const a = aLogico(T, frame, g.x, g.y);
      const b = aLogico(T, frame, Math.max(T.tx, Math.min(T.tx + frame.ancho * T.s - 1, g.x2)), Math.max(T.ty, Math.min(T.ty + frame.alto * T.s - 1, g.y2)));
      if (a && b) void entrada('pointer', { accion: 'arrastre', x: a.x, y: a.y, x2: b.x, y2: b.y });
      return;
    }
    const p = aLogico(T, frame, g.x, g.y);
    if (!p) return;
    const accion = g.tipo === 'toque' ? 'click' : g.tipo;
    const mods = sesion.mods.activos().filter((m) => m !== 'alt');
    if (accion === 'click' && mods.length) sesion.mods.consumir();
    void entrada('pointer', { accion, x: p.x, y: p.y, ...(accion === 'click' && mods.length ? { mods } : {}) });
  };
  const alGestoRef = useRef(alGesto);
  alGestoRef.current = alGesto;

  const programarTick = () => {
    if (tickRef.current) clearTimeout(tickRef.current);
    tickRef.current = setTimeout(() => gestos.tick().forEach((g) => alGestoRef.current(g)), 280);
  };
  const toques = (e: GestureResponderEvent): Punto[] =>
    (e.nativeEvent.touches?.length ? e.nativeEvent.touches : [e.nativeEvent]).map((t) => ({ x: t.pageX - offset.current.x, y: t.pageY - offset.current.y }));
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => gestos.inicio(toques(e)).forEach((g) => alGestoRef.current(g)),
        onPanResponderStart: (e) => gestos.inicio(toques(e)).forEach((g) => alGestoRef.current(g)),
        onPanResponderMove: (e) => gestos.mover(toques(e)).forEach((g) => alGestoRef.current(g)),
        onPanResponderEnd: (e) => {
          const quedan = (e.nativeEvent.touches ?? []).map((t) => ({ x: t.pageX - offset.current.x, y: t.pageY - offset.current.y }));
          gestos.fin(quedan).forEach((g) => alGestoRef.current(g));
          if (!quedan.length) {
            scroll.reiniciar();
            programarTick();
          }
        },
        onPanResponderTerminate: () => gestos.cancelar(),
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const alLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCaja({ ancho: Math.max(1, width), alto: Math.max(1, height) });
    origen.current?.measureInWindow((x, y) => {
      offset.current = { x, y };
    });
  };

  const tecla = (t: string) => {
    const mods = sesion.mods.consumir();
    if (!comboPermitido(mods, t)) return avisar(tr('Esa combinación no está permitida.', 'That combination isn’t allowed.'));
    void entrada('key', { tecla: t, mods });
    repintar();
  };
  const alternarMod = (m: Mod) => {
    sesion.mods.alternar(m);
    repintar();
  };
  const alEscribir = (t: string) => {
    const combo = buffer.cambiar(t, sesion.mods.activos());
    if (combo) {
      sesion.mods.consumir();
      void entrada(combo.type, combo.payload);
    }
    setTexto(buffer.texto);
  };
  const confirmarTexto = async (conEnter: boolean) => {
    const eventos = buffer.confirmar(conEnter);
    setTexto('');
    for (const ev of eventos) await entrada(ev.type, ev.payload);
  };

  const cerrar = () => {
    // Volver al chat: la tarea sigue y el control sigue siendo suyo; nada queda pulsado.
    sesion.mods.soltarTodo();
    if (tengo && conEntrada) void sesion.entrada('release_all', {});
    cerrarVisor();
  };

  /* -------------------------------------------------------------- pintar */

  const etiquetaModo =
    modo === 'tu'
      ? !tengo
        ? tr('Tú controlas desde otra pantalla', 'You control from another screen')
        : seguro
          ? tr('Tú controlas · entrada segura', 'You control · secure input')
          : tr('Tú controlas', 'You control')
      : modo === 'pidiendo'
        ? tr('Solicitando control…', 'Requesting control…')
        : modo === 'sin_conexion'
          ? tr('Sin conexión', 'Offline')
          : viva
            ? tr('AURA controla', 'AURA controls')
            : tr('Tarea terminada', 'Task finished');
  const colorModo = modo === 'tu' ? VERDE : modo === 'pidiendo' ? AMBAR : modo === 'sin_conexion' ? ROJO : AZUL;
  const textoEdad = edad == null ? '—' : edad < 1000 ? tr('ahora', 'now') : `${(edad / 1000).toFixed(1).replace('.', idioma === 'es' ? ',' : '.')} s`;
  const pregunta = estado === 'confirmar' ? tarea?.pregunta || null : null;
  const mods = sesion.mods.activos();

  return (
    <Modal visible animationType="fade" statusBarTranslucent navigationBarTranslucent supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right', 'portrait-upside-down']} onRequestClose={cerrar}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: NEGRO }}>
        {/* La barra: discreta y siempre a la vista. */}
        <View style={[s.barra, { paddingTop: ins.top + 4, paddingLeft: ins.left + 8, paddingRight: ins.right + 8 }]} accessibilityRole="toolbar">
          <View style={s.fila}>
            <Boton etiqueta="‹" lector={tr('Volver al chat (la tarea sigue)', 'Back to chat (the task continues)')} onPress={cerrar} />
            <View style={[s.chip, { borderColor: colorModo }]} accessibilityLabel={etiquetaModo} accessibilityLiveRegion="polite">
              <View style={[s.punto, { backgroundColor: colorModo }]} />
              <Texto v="mini" style={{ color: BLANCO }} numberOfLines={1}>
                {etiquetaModo}
              </Texto>
            </View>
            <Texto v="mini" style={{ color: vieja ? AMBAR : GRIS }} accessibilityLabel={tr(`Imagen de hace ${textoEdad}`, `Image from ${textoEdad} ago`)}>
              {conectado ? '●' : '○'} {textoEdad}
              {enVuelo ? ' ·…' : ''}
            </Texto>
            <Texto v="mini" style={{ color: GRIS, flex: 1 }} numberOfLines={1}>
              {tr('Linux · Firefox', 'Linux · Firefox')} · {tarea?.instruccion || ''}
            </Texto>
          </View>
          <View style={s.fila}>
            {viva && conControl && modo !== 'tu' ? <Boton etiqueta={tr('Tomar el control', 'Take control')} lector={tr('Tomar el control', 'Take control')} onPress={() => void tomar()} cargando={ocupado === 'tomar'} fuerte /> : null}
            {viva && modo === 'tu' && !tengo ? <Boton etiqueta={tr('Recuperar el control', 'Get control back')} lector={tr('Recuperar el control en este teléfono', 'Get control back on this phone')} onPress={() => void tomar()} cargando={ocupado === 'tomar'} fuerte /> : null}
            {viva && tengo ? <Boton etiqueta={tr('Devolver', 'Give back')} lector={tr('Devolver el control a AURA', 'Give control back to AURA')} onPress={() => void devolver()} cargando={ocupado === 'devolver'} deshabilitado={seguro} fuerte /> : null}
            {viva && caps.includes('pausar') && (estado === 'trabajando' || estado === 'en_cola') ? <Boton etiqueta={tr('Pausar', 'Pause')} lector={tr('Pausar la tarea', 'Pause the task')} onPress={() => void sobreTarea('pausar', 'pausar')} cargando={ocupado === 'pausar'} /> : null}
            {viva && caps.includes('pausar') && estado === 'pausada' ? <Boton etiqueta={tr('Seguir', 'Resume')} lector={tr('Seguir con la tarea', 'Resume the task')} onPress={() => void sobreTarea('seguir', 'reanudar')} cargando={ocupado === 'seguir'} /> : null}
            {viva ? <Boton etiqueta={tr('Cancelar', 'Cancel')} lector={tr('Cancelar la tarea', 'Cancel the task')} onPress={cancelar} peligro /> : null}
            <Boton etiqueta={v.zoom > 1.01 ? tr('Ajustar', 'Fit') : tr('Zoom', 'Zoom')} lector={v.zoom > 1.01 ? tr('Ajustar a la pantalla', 'Fit to screen') : tr('Acercar', 'Zoom in')} onPress={() => setVista(alternarZoom(caja, frame, v))} />
            {tengo && conSeguro ? (
              seguro ? (
                <Boton etiqueta={tr('🔓 Terminar', '🔓 Finish')} lector={tr('Terminar la entrada segura', 'Finish secure input')} onPress={() => void terminarSeguro()} fuerte />
              ) : (
                <Boton etiqueta={tr('🔒 Segura', '🔒 Secure')} lector={tr('Entrada segura para contraseñas: AURA no ve ni toca nada', 'Secure input for passwords: AURA neither sees nor touches anything')} onPress={() => void activarSeguro()} cargando={ocupado === 'seguro'} />
              )
            ) : null}
          </View>
          {!!aviso && (
            <Texto v="mini" style={{ color: AMBAR }} accessibilityLiveRegion="polite">
              {aviso}
            </Texto>
          )}
          {vieja && viva ? (
            <Texto v="mini" style={{ color: AMBAR }}>
              {tr(`La imagen es de hace ${textoEdad}: puede no ser la de ahora.`, `The image is ${textoEdad} old: it may not be current.`)}
              {bloqueo ? tr(' Los clics esperan la imagen nueva.', ' Clicks wait for the new image.') : ''}
            </Texto>
          ) : null}
          {seguro ? (
            <Texto v="mini" style={{ color: VERDE }}>
              {tr('Entrada segura: AURA no ve esta pantalla ni toca nada, y nada de esto se guarda. Escribe tu contraseña y toca «Terminar».', 'Secure input: AURA doesn’t see this screen or touch anything, and nothing here is saved. Type your password and tap “Finish”.')}
            </Texto>
          ) : null}
        </View>

        {/* El escritorio. */}
        <View ref={origen} style={s.lienzo} onLayout={alLayout} {...responder.panHandlers}>
          {imagen ? (
            <Image
              source={{ uri: `data:image/jpeg;base64,${imagen.b64}` }}
              fadeDuration={0}
              resizeMode="stretch"
              style={{ position: 'absolute', left: T.tx, top: T.ty, width: frame.ancho * T.s, height: frame.alto * T.s }}
              accessibilityLabel={tengo ? tr('El escritorio de tu computadora: toca para hacer clic', 'Your computer’s desktop: tap to click') : tr('Lo que ve tu computadora', 'What your computer sees')}
            />
          ) : (
            <View style={s.centro}>
              <Texto v="chica" style={{ color: GRIS }}>
                {!conControl ? tr('Esto llega cuando se actualice el servicio de su computadora.', 'This arrives once its computer service is updated.') : viva ? tr('Abriendo el escritorio…', 'Opening the desktop…') : tr('La tarea terminó.', 'The task finished.')}
              </Texto>
            </View>
          )}
          {!viva && estado ? (
            <View style={[s.centro, StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} pointerEvents="box-none">
              <Texto v="chicaFuerte" style={{ color: BLANCO }}>
                {tr('La tarea terminó.', 'The task finished.')}
              </Texto>
              <Boton etiqueta={tr('Volver al chat', 'Back to chat')} lector={tr('Volver al chat', 'Back to chat')} onPress={cerrar} fuerte />
            </View>
          ) : null}
        </View>

        {/* Su sí antes de algo sensible, aquí mismo (sin abrir nada encima). */}
        {pregunta ? (
          <View style={[s.pregunta, { paddingLeft: ins.left + 12, paddingRight: ins.right + 12 }]}>
            <Texto v="chica" style={{ color: BLANCO, flex: 1 }}>
              {pregunta}
            </Texto>
            <Boton etiqueta={tr('Sí, hazlo', 'Yes, do it')} lector={tr('Sí, hazlo', 'Yes, do it')} onPress={() => void sobreTarea('si', 'confirmar', respuestaPc(true, null, tarea))} fuerte />
            <Boton etiqueta={tr('No', 'No')} lector={tr('No', 'No')} onPress={() => void sobreTarea('no', 'confirmar', respuestaPc(false, null, tarea))} />
          </View>
        ) : null}

        {/* El teclado, con el control. */}
        {tengo ? (
          <View style={[s.teclado, { paddingBottom: (teclado ? 6 : ins.bottom + 6) + teclado, paddingLeft: ins.left + 8, paddingRight: ins.right + 8 }]}>
            <View style={s.fila}>
              <TextInput
                value={texto}
                onChangeText={alEscribir}
                onSubmitEditing={() => void confirmarTexto(true)}
                blurOnSubmit={false}
                returnKeyType="send"
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                secureTextEntry={seguro}
                maxLength={2000}
                placeholder={seguro ? tr('Contraseña (no se guarda)', 'Password (not saved)') : tr('Escribe aquí; se manda al tocar ➤ o Enter', 'Type here; sent with ➤ or Enter')}
                placeholderTextColor={GRIS}
                style={s.campo}
                accessibilityLabel={seguro ? tr('Contraseña para la computadora', 'Password for the computer') : tr('Escribir en la computadora', 'Type on the computer')}
              />
              <Boton etiqueta="➤" lector={tr('Mandar el texto (sin Enter)', 'Send the text (no Enter)')} onPress={() => void confirmarTexto(false)} deshabilitado={!texto} fuerte />
            </View>
            <View style={s.fila}>
              {(['ctrl', 'shift', 'alt'] as Mod[]).map((m) => (
                <Boton key={m} etiqueta={m === 'ctrl' ? 'Ctrl' : m === 'shift' ? 'Shift' : 'Alt'} lector={`${m} ${mods.includes(m) ? tr('armado', 'armed') : ''}`} onPress={() => alternarMod(m)} activo={mods.includes(m)} />
              ))}
              {TECLAS.map((k) => (
                <Boton key={k.tecla} etiqueta={k.etiqueta} lector={tr(k.lector[0], k.lector[1])} onPress={() => tecla(k.tecla)} />
              ))}
              <Boton etiqueta="⇞" lector={tr('Subir la página', 'Scroll up')} onPress={() => empujarScroll(-3, frame.ancho / 2, frame.alto / 2)} />
              <Boton etiqueta="⇟" lector={tr('Bajar la página', 'Scroll down')} onPress={() => empujarScroll(3, frame.ancho / 2, frame.alto / 2)} />
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Un botón chico de la barra (con su etiqueta para el lector de pantalla). */
function Boton({ etiqueta, lector, onPress, cargando, deshabilitado, fuerte, peligro, activo }: { etiqueta: string; lector: string; onPress: () => void; cargando?: boolean; deshabilitado?: boolean; fuerte?: boolean; peligro?: boolean; activo?: boolean }) {
  const off = !!deshabilitado || !!cargando;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={lector}
      accessibilityState={{ disabled: off, selected: !!activo }}
      hitSlop={6}
      style={({ pressed }) => [
        s.boton,
        fuerte && { backgroundColor: '#2b6cb0' },
        peligro && { borderColor: ROJO },
        activo && { backgroundColor: AMBAR },
        (pressed || off) && { opacity: 0.55 },
      ]}
    >
      <Texto v="mini" style={{ color: activo ? NEGRO : peligro ? ROJO : BLANCO }}>
        {cargando ? '…' : etiqueta}
      </Texto>
    </Pressable>
  );
}

const s = StyleSheet.create({
  barra: { backgroundColor: VELO, paddingBottom: 6, gap: 4, zIndex: 2 },
  fila: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  punto: { width: 7, height: 7, borderRadius: 4 },
  lienzo: { flex: 1, overflow: 'hidden', backgroundColor: NEGRO },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  pregunta: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1d2a3a', paddingVertical: 8 },
  teclado: { backgroundColor: VELO, paddingTop: 6, gap: 6 },
  campo: { flex: 1, minHeight: 38, color: BLANCO, borderWidth: 1, borderColor: '#3a4450', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  boton: { minHeight: 32, minWidth: 34, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, borderColor: '#3a4450', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
});
