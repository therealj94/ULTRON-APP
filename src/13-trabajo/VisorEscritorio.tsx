/**
 * EL VISOR DE SU COMPUTADORA EN LA WEB/PWA (auditoría del 4-oct, U1 / paquete P3).
 *
 * El mismo visor dedicado de la app Expo (mobile/src/app/VisorComputadora.tsx), adaptado al navegador: una pantalla
 * propia encima de todo (un diálogo a toda la ventana, NO el fullscreen de toda la app ni un iframe), que se abre
 * desde la tarea («Abrir el escritorio» en el panel de tareas) y se cierra para volver al chat sin tocar la tarea.
 * Reutiliza la lógica tal cual: mobile/src/app/visor.ts (abierto/cerrado, la sesión de cada tarea, su lote de
 * teclado y su campo) y mobile/src/lib/entradaRemota.ts (coordenadas, épocas, ACK, frescura y el lote de A3).
 *
 *  · Arriba: volver al chat, el modo («AURA controla», «Solicitando control», «Tú controlas», «Sin conexión»), la
 *    edad de la imagen y los mandos: tomar/devolver el control, pausar/seguir, cancelar (pregunta antes) y la
 *    entrada segura.
 *  · En medio, el escritorio: con el control, clic, doble clic, clic derecho, arrastrar y la rueda para bajar/subir;
 *    con el escritorio enfocado, las teclas especiales y las combinaciones permitidas van a la computadora (lo
 *    demás que se teclea salta al campo de escribir, para que el texto salga compuesto, con su IME).
 *  · Abajo, con el control: el campo (se manda el texto final como un lote que espera cada ACK y la imagen de después
 *    antes del Enter), teclas, Ctrl/Shift/Alt y bajar/subir con botones.
 *  · Solo con el contrato de entradas (capacidad `entrada`): un servicio de antes se ve, pero no se toca desde aquí.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { headersMesa } from '../10-infra/sesionCliente';
import { registrarTrabajoActivo, avisarTrabajoLibre } from '../10-infra/trabajoActivo';
import { enfocables, saltoDeTab } from '../07-pantallas/foco';
import { abrirVisor, cerrarVisor, sesionDe, soltarImagen, soltarOyente, suscribirVisor, tecladoDe, visorAhora } from '../../mobile/src/app/visor';
import { respuestaPc, trabajando, type EstadoPc, type TareaPc } from '../../mobile/src/compa/computadora';
import {
  FRAME_VIEJO_MS,
  aLogico,
  avisoDeLote,
  comboPermitido,
  confirmarEscritura,
  descartarEscritura,
  edadFrame,
  intervaloCaptura,
  modoDeControl,
  recuperarEscritura,
  resolverEscritura,
  seguirEscritura,
  transformacion,
  vistaAjustada,
  type AckEntrada,
  type EntradaRemota,
  type FrameMeta,
  type Mod,
  type ModoControl,
  type Tam,
  type TipoEntrada,
} from '../../mobile/src/lib/entradaRemota';
import { crearPedirPc, pasosRueda, tareaDelEscritorio, teclaDeEvento } from './escritorio';

const pedir = crearPedirPc(headersMesa);
const SIN_CONEXION_MS = 6000;
const NEGRO = '#05070a';
const VELO = 'rgba(8,10,14,0.86)';
const BLANCO = '#f4f6f8';
const GRIS = '#a9b1bb';
const AMBAR = '#f2b134';
const VERDE = '#4cc38a';
const ROJO = '#ef6b5b';
const AZUL = '#5aa9ff';

/** Abre el visor de la tarea de la computadora que corresponde a esta tarea durable. Devuelve un aviso si no se pudo. */
export async function abrirEscritorio(entornoId: string | null | undefined): Promise<string | null> {
  try {
    const id = await tareaDelEscritorio(entornoId, pedir);
    if (!id) return 'Tu computadora no tiene una tarea abierta ahora.';
    abrirVisor(id);
    return null;
  } catch (e: any) {
    return e?.status ? String(e.message || 'No pude abrir el escritorio.') : 'Tu computadora no contestó. Prueba otra vez en un momento.';
  }
}

/** ¿Está abierto el visor? (App.tsx vuelve inert lo de detrás mientras lo esté.) */
export function useVisorEscritorioAbierto(): boolean {
  const v = useSyncExternalStore(suscribirVisor, visorAhora, visorAhora);
  return v.abierto && !!v.tareaId;
}

export function VisorEscritorio() {
  const visor = useSyncExternalStore(suscribirVisor, visorAhora, visorAhora);
  if (!visor.abierto || !visor.tareaId) return null;
  return <Visor tareaId={visor.tareaId} />;
}

type Imagen = { b64: string; meta: FrameMeta; recibidoEn: number };

const TECLAS: { tecla: string; etiqueta: string; nombre: string }[] = [
  { tecla: 'escape', etiqueta: 'Esc', nombre: 'Escape' },
  { tecla: 'tab', etiqueta: 'Tab', nombre: 'Tabulador' },
  { tecla: 'backspace', etiqueta: '⌫', nombre: 'Borrar' },
  { tecla: 'delete', etiqueta: 'Supr', nombre: 'Suprimir' },
  { tecla: 'left', etiqueta: '←', nombre: 'Flecha izquierda' },
  { tecla: 'up', etiqueta: '↑', nombre: 'Flecha arriba' },
  { tecla: 'down', etiqueta: '↓', nombre: 'Flecha abajo' },
  { tecla: 'right', etiqueta: '→', nombre: 'Flecha derecha' },
  { tecla: 'enter', etiqueta: '⏎', nombre: 'Enter' },
];

function Visor({ tareaId }: { tareaId: string }) {
  const [tarea, setTarea] = useState<TareaPc | null>(null);
  const [caps, setCaps] = useState<string[]>([]);
  const [imagen, setImagen] = useState<Imagen | null>(null);
  const [caja, setCaja] = useState<Tam>({ ancho: 1, alto: 1 });
  const [ahora, setAhora] = useState(Date.now());
  const [ultimoOk, setUltimoOk] = useState(Date.now());
  const [pidiendo, setPidiendo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [texto, setTexto] = useState('');
  const [, setVersion] = useState(0);
  const repintar = useCallback(() => setVersion((n) => n + 1), []);
  const dialogo = useRef<HTMLDivElement>(null);
  const lienzo = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const volver = useRef<HTMLButtonElement>(null);

  const enviar = useCallback((e: EntradaRemota) => pedir<{ ack: AckEntrada }>(`/api/computadora/tareas/${encodeURIComponent(tareaId)}/entrada`, { method: 'POST', body: JSON.stringify(e) }).then((r) => r.ack), [tareaId]);
  const sesion = useMemo(() => sesionDe(tareaId, enviar, repintar), [tareaId, enviar, repintar]);
  useEffect(() => () => soltarOyente(tareaId, repintar), [tareaId, repintar]);
  const leerPantallaRef = useRef<() => Promise<Imagen | null>>(async () => null);
  const pedirImagen = useCallback(() => void leerPantallaRef.current(), []);
  const { lote, buffer } = useMemo(() => tecladoDe(tareaId, pedirImagen), [tareaId, sesion, pedirImagen]);
  useEffect(() => () => soltarImagen(tareaId, pedirImagen), [tareaId, pedirImagen]);
  useEffect(() => setTexto(buffer.texto), [buffer]);

  const conEntrada = caps.includes('entrada');
  const conSeguro = caps.includes('seguro');
  const conControl = caps.includes('control');
  const estado = tarea?.estado ?? null;
  const viva = trabajando(estado);
  const conectado = ahora - ultimoOk < SIN_CONEXION_MS;
  const modo: ModoControl = modoDeControl({ estado, conectado, pidiendo });
  const tengo = modo === 'tu' && conEntrada && sesion.epoca != null;
  const seguro = !!tarea?.seguro;
  const frame: Tam = imagen ? { ancho: imagen.meta.ancho, alto: imagen.meta.alto } : { ancho: 1280, alto: 800 };
  const T = transformacion(caja, frame, vistaAjustada(frame));
  const edad = imagen ? edadFrame(imagen.meta, imagen.recibidoEn, ahora) : null;
  const vieja = edad != null && edad > FRAME_VIEJO_MS;

  const avisar = useCallback((t: string) => {
    setAviso(t);
    if (t) setTimeout(() => setAviso((x) => (x === t ? '' : x)), 4000);
  }, []);
  const conexionOk = useCallback(() => {
    setUltimoOk(Date.now());
    void sesion.alReconectar();
  }, [sesion]);
  const conexionMal = useCallback((e: any) => {
    if (!e?.status) sesion.alDesconectar();
  }, [sesion]);

  // Con el control (o algo escrito sin terminar) la PWA no se recarga a mitad (10-infra/trabajoActivo.ts).
  useEffect(() => registrarTrabajoActivo('computadora', () => sesion.epoca != null || lote.abierto()), [sesion, lote]);
  useEffect(() => avisarTrabajoLibre(), [tengo]);

  useEffect(() => {
    const r = setInterval(() => setAhora(Date.now()), 500);
    return () => clearInterval(r);
  }, []);

  // El tamaño de la caja del escritorio: la transformación se recalcula (una sola capa de coordenadas).
  useEffect(() => {
    const el = lienzo.current;
    if (!el) return;
    const medir = () => setCaja({ ancho: Math.max(1, el.clientWidth), alto: Math.max(1, el.clientHeight) });
    medir();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    window.addEventListener('resize', medir);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', medir);
    };
  }, []);

  // Lo que sabe su servicio.
  useEffect(() => {
    let vivo = true;
    const leer = () =>
      pedir<EstadoPc>('/api/computadora')
        .then((s) => vivo && setCaps((s.capacidades as string[] | undefined) ?? []))
        .catch(() => undefined);
    void leer();
    const r = setInterval(leer, 30_000);
    return () => {
      vivo = false;
      clearInterval(r);
    };
  }, []);

  // La tarea cada 2,5 s: estado, pregunta, época del control y entrada segura.
  const leerTarea = useCallback(async () => {
    const epocaAlPedir = sesion.epoca;
    try {
      const r = await pedir<{ tarea: TareaPc }>(`/api/computadora/tareas/${encodeURIComponent(tareaId)}?idioma=es`);
      setTarea(r.tarea);
      conexionOk();
      // Otro dispositivo tomó el control (o ya no es de nadie): esta queda cercada y lo escrito que faltaba, en pausa.
      if (sesion.epoca != null && sesion.epoca === epocaAlPedir && (r.tarea.estado !== 'control' || (typeof r.tarea.epoca === 'number' && r.tarea.epoca > sesion.epoca))) {
        sesion.sinControl();
        lote.pausar('sin_control');
        if (r.tarea.estado === 'control') avisar('Otro dispositivo tomó el control.');
      }
      if (r.tarea.estado === 'control') setPidiendo(false);
    } catch (e) {
      conexionMal(e);
    }
  }, [tareaId, sesion, lote, conexionOk, conexionMal, avisar]);
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

  // La pantalla: con el control ~0,7 s (nunca dos a la vez; la pedida en medio sale al volver la anterior).
  const pidiendoPantalla = useRef(false);
  const otraPantalla = useRef(false);
  const ultimaDuracion = useRef(0);
  const leerPantalla = useCallback(async (): Promise<Imagen | null> => {
    if (pidiendoPantalla.current) {
      otraPantalla.current = true;
      return null;
    }
    pidiendoPantalla.current = true;
    const desde = Date.now();
    try {
      const r = await pedir<{ imagen: string; frame: FrameMeta | null }>(`/api/computadora/tareas/${encodeURIComponent(tareaId)}/pantalla?ancho=1280`);
      const recibidoEn = Date.now();
      // Sin frame (servicio de antes) no hay con qué fiarse para lo riesgoso: se enseña, pero la sesión no la toma.
      const meta: FrameMeta = r.frame ?? { seq: 0, ts: recibidoEn, ancho: 1280, alto: 800, viewportRevision: 0, epoca: null, privado: false, edadMs: FRAME_VIEJO_MS + 1 };
      const img = { b64: r.imagen, meta, recibidoEn };
      setImagen(img);
      if (r.frame) sesion.alFrame(meta, recibidoEn);
      conexionOk();
      ultimaDuracion.current = recibidoEn - desde;
      return img;
    } catch (e) {
      conexionMal(e);
      return null;
    } finally {
      pidiendoPantalla.current = false;
      if (otraPantalla.current) {
        otraPantalla.current = false;
        void leerPantallaRef.current();
      }
    }
  }, [tareaId, sesion, conexionOk, conexionMal]);
  leerPantallaRef.current = leerPantalla;
  const modoRef = useRef(modo);
  modoRef.current = modo;
  const puedeVer = conControl && viva && estado !== 'en_cola';
  useEffect(() => {
    if (!puedeVer) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      if (document.visibilityState !== 'hidden') await leerPantallaRef.current();
      if (vivo) reloj = setTimeout(vuelta, intervaloCaptura(modoRef.current, ultimaDuracion.current));
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [puedeVer]);

  // La pestaña se va atrás: se sueltan los modificadores, lo escrito que faltaba se pausa; al volver, release_all e imagen.
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === 'hidden') {
        sesion.alDesconectar();
        lote.pausar('desconectado');
      } else {
        void sesion.alReconectar();
        void leerPantallaRef.current();
      }
    };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [sesion, lote]);

  /* -------------------------------------------------------------- mandos */

  const sobreTarea = async (que: string, ruta: string, cuerpo: Record<string, unknown> = {}) => {
    if (ocupado && que !== 'parar') return null;
    setOcupado(que);
    try {
      return await pedir<any>(`/api/computadora/tareas/${encodeURIComponent(tareaId)}/${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) });
    } catch (e: any) {
      avisar(e?.message || 'La computadora no contestó.');
      return null;
    } finally {
      setOcupado(null);
      void leerTarea();
    }
  };

  const tomar = async () => {
    setPidiendo(true);
    const r = await sobreTarea('tomar', 'control', { tomar: true, clientId: sesion.clientId, ...(typeof tarea?.epoca === 'number' ? { expectedControlEpoch: tarea.epoca } : {}) });
    if (!r) return setPidiendo(false);
    if (conEntrada && Number.isInteger(r.epoca)) sesion.alControl(r.epoca);
    if (r.fase === 'draining') avisar('Está terminando lo que ya había empezado; en un momento es tuya.');
    void leerPantalla();
    requestAnimationFrame(() => lienzo.current?.focus({ preventScroll: true }));
  };

  const devolver = async () => {
    if (seguro) return avisar('Primero termina la entrada segura.');
    lote.pausar('sin_control');
    if (sesion.epoca != null) await sesion.entrada('release_all', {});
    const r = await sobreTarea('devolver', 'control', { tomar: false, clientId: sesion.clientId });
    if (r) sesion.sinControl();
  };

  const cancelar = () => {
    if (window.confirm('¿Cancelar la tarea? Se detiene lo que hace tu computadora. Lo que ya hizo queda hecho.')) void sobreTarea('parar', 'parar');
  };

  const activarSeguro = async () => {
    const r = await sobreTarea('seguro', 'seguro', { activar: true, clientId: sesion.clientId });
    if (r?.seguro) avisar('Entrada segura: AURA no ve ni toca nada hasta que termines.');
  };

  const terminarSeguro = async () => {
    for (let intento = 0; intento < 2; intento++) {
      const img = await leerPantalla();
      const seq = img?.meta.seq ?? imagen?.meta.seq;
      try {
        await pedir(`/api/computadora/tareas/${encodeURIComponent(tareaId)}/seguro`, { method: 'POST', body: JSON.stringify({ activar: false, clientId: sesion.clientId, frameSeq: seq }) });
        sesion.pedirResync();
        void leerTarea();
        return;
      } catch (e: any) {
        if (e?.data?.code !== 'frame_viejo') return avisar(e?.message || '');
      }
    }
    avisar('Mira la pantalla de ahora y vuelve a intentarlo.');
  };

  // Lo escrito en entrada segura no sobrevive a terminarla: se tira, nunca pasa a un campo visible.
  useEffect(() => {
    if (!seguro && lote.privado && lote.abierto()) {
      descartarEscritura(buffer, lote);
      setTexto('');
    }
  }, [seguro, lote, buffer]);

  const cerrar = () => {
    // Volver al chat: la tarea sigue y el control sigue siendo suyo; nada queda pulsado; lo escrito que faltaba se pausa.
    lote.pausar('cerrado');
    sesion.mods.soltarTodo();
    if (tengo) void sesion.entrada('release_all', {});
    cerrarVisor();
  };

  /* -------------------------------------------------------------- entradas */

  const entrada = async (tipo: TipoEntrada, payload: Record<string, unknown>) => {
    if (!tengo) return;
    if (lote.ocupado()) return avisar('Espera a que termine de escribir.');
    const r = await sesion.entrada(tipo, payload);
    if (r.ok) return void leerPantalla();
    if (r.motivo === 'viejo' || r.motivo === 'resync' || r.motivo === 'tras_entrada' || r.motivo === 'sin_frame') {
      avisar('Espera la imagen de ahora para tocar.');
      void leerPantalla();
    } else if (r.incierta) avisar('No sé si llegó: mira la pantalla antes de repetirlo.');
    else if (r.motivo !== 'desconectado') avisar(r.error || r.motivo);
  };

  const scrollPendiente = useRef({ n: 0, x: 0, y: 0, enVuelo: false });
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

  /** Un punto del ratón en píxel lógico del escritorio (null fuera de la imagen). */
  const punto = (e: { clientX: number; clientY: number }) => {
    const r = lienzo.current?.getBoundingClientRect();
    return r ? aLogico(T, frame, e.clientX - r.left, e.clientY - r.top) : null;
  };
  const presion = useRef<{ x: number; y: number; px: number; py: number; boton: number } | null>(null);
  const clicPendiente = useRef<{ x: number; y: number; t: number; reloj: ReturnType<typeof setTimeout> } | null>(null);
  const alBajar = (e: React.PointerEvent) => {
    lienzo.current?.focus({ preventScroll: true });
    const p = punto(e);
    presion.current = p ? { x: p.x, y: p.y, px: e.clientX, py: e.clientY, boton: e.button } : null;
  };
  const alSubir = (e: React.PointerEvent) => {
    const ini = presion.current;
    presion.current = null;
    if (!ini || !tengo) {
      if (!tengo && viva && ini) avisar('Toma el control para tocar la pantalla.');
      return;
    }
    if (ini.boton !== 0) return;
    const fin = punto(e);
    if (fin && Math.hypot(e.clientX - ini.px, e.clientY - ini.py) > 10) return void entrada('pointer', { accion: 'arrastre', x: ini.x, y: ini.y, x2: fin.x, y2: fin.y });
    // Un clic espera un poco por si es doble (como el toque del teléfono).
    const prev = clicPendiente.current;
    if (prev && Date.now() - prev.t < 300 && Math.hypot(prev.x - ini.x, prev.y - ini.y) < 24) {
      clearTimeout(prev.reloj);
      clicPendiente.current = null;
      return void entrada('pointer', { accion: 'doble', x: prev.x, y: prev.y });
    }
    const mods = sesion.mods.activos().filter((m) => m !== 'alt');
    clicPendiente.current = {
      x: ini.x,
      y: ini.y,
      t: Date.now(),
      reloj: setTimeout(() => {
        clicPendiente.current = null;
        if (mods.length) sesion.mods.consumir();
        void entrada('pointer', { accion: 'click', x: ini.x, y: ini.y, ...(mods.length ? { mods } : {}) });
      }, 260),
    };
  };
  const alDerecho = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = punto(e);
    if (p && tengo) void entrada('pointer', { accion: 'derecho', x: p.x, y: p.y });
  };
  // La rueda: se escucha sin `passive` para que la página de detrás no se mueva.
  const ruedaRef = useRef<(e: WheelEvent) => void>(() => undefined);
  ruedaRef.current = (e: WheelEvent) => {
    e.preventDefault();
    if (!tengo) return;
    const p = punto(e);
    const n = pasosRueda(e.deltaY, e.deltaMode);
    if (p && n) empujarScroll(n, p.x, p.y);
  };
  useEffect(() => {
    const el = lienzo.current;
    if (!el) return;
    const f = (e: WheelEvent) => ruedaRef.current(e);
    el.addEventListener('wheel', f, { passive: false });
    return () => el.removeEventListener('wheel', f);
  }, []);

  /** Con el escritorio enfocado: las teclas especiales van a la computadora; el texto salta al campo (sale compuesto). */
  const alTeclaEscritorio = (e: React.KeyboardEvent) => {
    if (!tengo) return;
    const t = teclaDeEvento({ key: e.key, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, isComposing: (e.nativeEvent as KeyboardEvent).isComposing });
    if (t) {
      e.preventDefault();
      e.stopPropagation();
      void entrada('key', { tecla: t.tecla, mods: t.mods });
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && buffer.enviando == null) campo.current?.focus();
  };

  const tecla = (t: string) => {
    const mods = sesion.mods.consumir();
    if (!comboPermitido(mods, t)) return avisar('Esa combinación no está permitida.');
    void entrada('key', { tecla: t, mods });
    repintar();
  };
  const alternarMod = (m: Mod) => {
    sesion.mods.alternar(m);
    repintar();
  };
  const alEscribir = (t: string) => {
    if (buffer.enviando != null) return;
    const combo = buffer.cambiar(t, sesion.mods.activos());
    if (combo) {
      sesion.mods.consumir();
      void entrada(combo.type, combo.payload);
    }
    setTexto(buffer.texto);
  };
  const confirmarTexto = async (conEnter: boolean) => {
    if (!tengo) return;
    const r = await confirmarEscritura(buffer, lote, conEnter, { privado: seguro });
    setTexto(buffer.texto);
    if (r.ok === false && (r as Extract<typeof r, { ok: false }>).motivo === 'ocupado') avisar('Espera a que termine lo anterior.');
    repintar();
  };
  const seguirTexto = async () => {
    await seguirEscritura(buffer, lote);
    setTexto(buffer.texto);
  };

  // El foco: entra al abrir; Tab da la vuelta dentro (sobre el escritorio, Tab es de la computadora); Escape fuera del
  // escritorio vuelve al chat.
  useEffect(() => {
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const r = requestAnimationFrame(() => volver.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(r);
      if (antes?.isConnected) requestAnimationFrame(() => antes.focus({ preventScroll: true }));
    };
  }, []);
  const alTeclaDialogo = (e: React.KeyboardEvent) => {
    if (lienzo.current?.contains(e.target as Node)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrar();
      return;
    }
    if (e.key !== 'Tab' || !dialogo.current) return;
    const lista = enfocables(dialogo.current);
    const activo = document.activeElement instanceof HTMLElement && dialogo.current.contains(document.activeElement) ? document.activeElement : null;
    const destino = saltoDeTab(lista, activo, e.shiftKey);
    if (destino) {
      e.preventDefault();
      destino.focus();
    }
  };

  /* -------------------------------------------------------------- pintar */

  const etiquetaModo =
    modo === 'tu'
      ? !tengo
        ? 'Tú controlas desde otra pantalla'
        : seguro
          ? 'Tú controlas · entrada segura'
          : 'Tú controlas'
      : modo === 'pidiendo'
        ? 'Solicitando control…'
        : modo === 'sin_conexion'
          ? 'Sin conexión'
          : viva
            ? 'AURA controla'
            : 'Tarea terminada';
  const colorModo = modo === 'tu' ? VERDE : modo === 'pidiendo' ? AMBAR : modo === 'sin_conexion' ? ROJO : AZUL;
  const textoEdad = edad == null ? '—' : edad < 1000 ? 'ahora' : `${(edad / 1000).toFixed(1).replace('.', ',')} s`;
  const pregunta = estado === 'confirmar' ? tarea?.pregunta || null : null;
  const mods = sesion.mods.activos();
  const avisoLote = lote.abierto() && !lote.ocupado() ? avisoDeLote(lote) : null;
  const boton = 'min-h-[36px] px-3 rounded-[10px] border text-[14px] cursor-pointer disabled:opacity-50';
  const estiloBoton = { borderColor: '#3a4450', color: BLANCO, background: 'rgba(255,255,255,0.06)' };
  const estiloFuerte = { borderColor: '#2b6cb0', color: BLANCO, background: '#2b6cb0' };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: NEGRO }}>
      <div ref={dialogo} role="dialog" aria-modal="true" aria-labelledby="aura-escritorio-titulo" id="aura-escritorio" className="flex flex-col h-full w-full" onKeyDown={alTeclaDialogo}>
        <div className="flex flex-col gap-1 px-3 pt-2 pb-2" style={{ background: VELO }} role="toolbar" aria-label="Mandos del escritorio">
          <div className="flex flex-wrap items-center gap-2">
            <button ref={volver} type="button" className={boton} style={estiloBoton} onClick={cerrar} aria-label="Volver al chat (la tarea sigue)">
              ‹ Volver al chat
            </button>
            <h2 id="aura-escritorio-titulo" className="sr-only">
              El escritorio de tu computadora
            </h2>
            <span className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[13px]" style={{ borderColor: colorModo, color: BLANCO }} role="status" aria-live="polite" data-modo={modo}>
              <span className="w-2 h-2 rounded-full" style={{ background: colorModo }} aria-hidden="true" />
              {etiquetaModo}
            </span>
            <span className="text-[13px]" style={{ color: vieja ? AMBAR : GRIS }} aria-label={`Imagen de hace ${textoEdad}`}>
              {conectado ? '●' : '○'} {textoEdad}
            </span>
            <span className="text-[13px] truncate flex-1 min-w-0" style={{ color: GRIS }}>
              Linux · Firefox · {tarea?.instruccion || ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {viva && conControl && conEntrada && modo !== 'tu' ? (
              <button type="button" className={boton} style={estiloFuerte} disabled={ocupado === 'tomar'} onClick={() => void tomar()}>
                {ocupado === 'tomar' ? '…' : 'Tomar el control'}
              </button>
            ) : null}
            {viva && conEntrada && modo === 'tu' && !tengo ? (
              <button type="button" className={boton} style={estiloFuerte} disabled={ocupado === 'tomar'} onClick={() => void tomar()}>
                Recuperar el control
              </button>
            ) : null}
            {viva && tengo ? (
              <button type="button" className={boton} style={estiloFuerte} disabled={seguro || ocupado === 'devolver'} onClick={() => void devolver()} aria-label="Devolver el control a AURA">
                Devolver el control
              </button>
            ) : null}
            {viva && caps.includes('pausar') && (estado === 'trabajando' || estado === 'en_cola') ? (
              <button type="button" className={boton} style={estiloBoton} onClick={() => void sobreTarea('pausar', 'pausar')}>
                Pausar
              </button>
            ) : null}
            {viva && caps.includes('pausar') && estado === 'pausada' ? (
              <button type="button" className={boton} style={estiloBoton} onClick={() => void sobreTarea('seguir', 'reanudar')}>
                Seguir
              </button>
            ) : null}
            {viva ? (
              <button type="button" className={boton} style={{ ...estiloBoton, borderColor: ROJO, color: ROJO }} onClick={cancelar} aria-label="Cancelar la tarea">
                Cancelar tarea
              </button>
            ) : null}
            {tengo && conSeguro ? (
              seguro ? (
                <button type="button" className={boton} style={estiloFuerte} onClick={() => void terminarSeguro()}>
                  🔓 Terminar entrada segura
                </button>
              ) : (
                <button type="button" className={boton} style={estiloBoton} onClick={() => void activarSeguro()} aria-label="Entrada segura para contraseñas: AURA no ve ni toca nada">
                  🔒 Entrada segura
                </button>
              )
            ) : null}
          </div>
          {!!aviso && (
            <p className="text-[13px]" style={{ color: AMBAR }} role="status">
              {aviso}
            </p>
          )}
          {!conEntrada && caps.length > 0 ? (
            <p className="text-[13px]" style={{ color: AMBAR }}>
              Desde la web, tomar el control llega cuando se actualice el servicio de tu computadora.
            </p>
          ) : null}
          {vieja && viva ? (
            <p className="text-[13px]" style={{ color: AMBAR }}>
              La imagen es de hace {textoEdad}: puede no ser la de ahora. Los clics esperan la imagen nueva.
            </p>
          ) : null}
          {seguro ? (
            <p className="text-[13px]" style={{ color: VERDE }}>
              Entrada segura: AURA no ve esta pantalla ni toca nada, y nada de esto se guarda. Escribe tu contraseña y toca «Terminar».
            </p>
          ) : null}
        </div>

        <div
          ref={lienzo}
          className="relative flex-1 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-(--aura-oro) select-none"
          style={{ background: NEGRO, touchAction: 'none', cursor: tengo ? 'crosshair' : 'default' }}
          tabIndex={0}
          role="application"
          aria-roledescription="escritorio remoto"
          aria-label={tengo ? 'El escritorio de tu computadora: haz clic para tocar; las teclas especiales van a la computadora' : 'Lo que ve tu computadora'}
          data-escritorio=""
          onPointerDown={alBajar}
          onPointerUp={alSubir}
          onPointerCancel={() => (presion.current = null)}
          onContextMenu={alDerecho}
          onKeyDown={alTeclaEscritorio}
        >
          {imagen ? (
            <img
              src={`data:image/jpeg;base64,${imagen.b64}`}
              alt=""
              draggable={false}
              className="absolute pointer-events-none"
              style={{ left: T.tx, top: T.ty, width: frame.ancho * T.s, height: frame.alto * T.s }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[15px]" style={{ color: GRIS }}>
              {!conControl && caps.length ? 'Esto llega cuando se actualice el servicio de tu computadora.' : viva || !estado ? 'Abriendo el escritorio…' : 'La tarea terminó.'}
            </div>
          )}
          {!viva && estado ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: 'rgba(0,0,0,0.55)' }}>
              <p className="font-semibold text-[16px]" style={{ color: BLANCO }}>
                La tarea terminó.
              </p>
              <button type="button" className={boton} style={estiloFuerte} onClick={cerrar}>
                Volver al chat
              </button>
            </div>
          ) : null}
        </div>

        {pregunta ? (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ background: '#1d2a3a' }}>
            <p className="flex-1 text-[14px]" style={{ color: BLANCO }}>
              {pregunta}
            </p>
            <button type="button" className={boton} style={estiloFuerte} onClick={() => void sobreTarea('si', 'confirmar', respuestaPc(true, null, tarea))}>
              Sí, hazlo
            </button>
            <button type="button" className={boton} style={estiloBoton} onClick={() => void sobreTarea('no', 'confirmar', respuestaPc(false, null, tarea))}>
              No
            </button>
          </div>
        ) : null}

        {tengo ? (
          <div className="flex flex-col gap-2 px-3 pt-2 pb-3" style={{ background: VELO }}>
            {lote.ocupado() ? (
              <p className="text-[13px]" style={{ color: GRIS }} role="status">
                {lote.estado() === 'esperando_imagen' ? 'Escribiendo… espera la imagen de ahora antes del Enter' : 'Escribiendo…'}
              </p>
            ) : avisoLote ? (
              <div className="flex flex-wrap items-center gap-2" role="status">
                <p className="w-full text-[13px]" style={{ color: AMBAR }}>
                  {avisoLote[0]}
                </p>
                {lote.incierto ? (
                  <>
                    <button type="button" className={boton} style={estiloBoton} onClick={() => (resolverEscritura(buffer, lote, true), setTexto(buffer.texto))}>
                      Sí llegó
                    </button>
                    <button type="button" className={boton} style={estiloBoton} onClick={() => (resolverEscritura(buffer, lote, false), setTexto(buffer.texto))}>
                      No llegó
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className={boton} style={estiloFuerte} onClick={() => void seguirTexto()}>
                      Seguir escribiendo
                    </button>
                    <button type="button" className={boton} style={estiloBoton} onClick={() => (recuperarEscritura(buffer, lote), setTexto(buffer.texto))}>
                      Editar
                    </button>
                  </>
                )}
                <button type="button" className={boton} style={{ ...estiloBoton, borderColor: ROJO, color: ROJO }} onClick={() => (descartarEscritura(buffer, lote), setTexto(''))}>
                  Descartar
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <label htmlFor="aura-escritorio-campo" className="sr-only">
                {seguro ? 'Contraseña para la computadora' : 'Escribir en la computadora'}
              </label>
              <input
                ref={campo}
                id="aura-escritorio-campo"
                type={seguro ? 'password' : 'text'}
                value={texto}
                readOnly={buffer.enviando != null}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={2000}
                enterKeyHint="send"
                placeholder={seguro ? 'Contraseña (no se guarda)' : 'Escribe aquí; se manda con ➤ o Enter'}
                className="flex-1 min-h-[40px] rounded-[10px] border px-3 text-[15px] outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', borderColor: '#3a4450', color: BLANCO }}
                onChange={(e) => alEscribir(e.target.value)}
                onKeyDown={(e) => {
                  // Enter confirma (con Enter allá); mientras el IME compone, Enter es del IME.
                  if (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing) {
                    e.preventDefault();
                    void confirmarTexto(true);
                  }
                }}
              />
              <button type="button" className={boton} style={estiloFuerte} onClick={() => void confirmarTexto(false)} disabled={!texto || buffer.enviando != null} aria-label="Mandar el texto (sin Enter)">
                ➤
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['ctrl', 'shift', 'alt'] as Mod[]).map((m) => (
                <button key={m} type="button" className={boton} style={mods.includes(m) ? { ...estiloBoton, background: AMBAR, color: NEGRO } : estiloBoton} aria-pressed={mods.includes(m)} onClick={() => alternarMod(m)}>
                  {m === 'ctrl' ? 'Ctrl' : m === 'shift' ? 'Shift' : 'Alt'}
                </button>
              ))}
              {TECLAS.map((k) => (
                <button key={k.tecla} type="button" className={boton} style={estiloBoton} aria-label={k.nombre} onClick={() => tecla(k.tecla)}>
                  {k.etiqueta}
                </button>
              ))}
              <button type="button" className={boton} style={estiloBoton} aria-label="Subir la página" onClick={() => empujarScroll(-3, frame.ancho / 2, frame.alto / 2)}>
                ⇞
              </button>
              <button type="button" className={boton} style={estiloBoton} aria-label="Bajar la página" onClick={() => empujarScroll(3, frame.ancho / 2, frame.alto / 2)}>
                ⇟
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
