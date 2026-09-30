/**
 * LA VOZ DE AURA, PARA TODA LA APP: la conversación fluida vive aquí y no en la mesa.
 *
 * Se monta una vez, encima de las pantallas (App.tsx). Así AURA sigue oyendo y hablando cuando la
 * persona se va a los chats o a los ajustes, y la compañera (que se dibuja aquí mismo, encima de
 * todo) refleja lo que pasa. Reúne:
 *
 *  · la sesión de ElevenLabs (components/ModoConversacion, montada con `key={gen}`) y su control
 *    (sesion.ts): abrir, cerrar, silenciar de verdad, reintentar, generaciones (M4);
 *  · el permiso precalentado (permiso.ts): cuando la persona quiere hablar, solo falta conectar;
 *  · segundo plano: la sesión se cierra (M5); al volver se precalienta otra vez;
 *  · llamadas (llamada.ts): AURA se apaga del todo y vuelve como estaba al colgar;
 *  · el puente de acciones y el contexto (acciones.ts): lo que AURA decide hacer llega por SSE y se
 *    emite en el bus; el teléfono le cuenta al cerebro dónde está la persona y a quién puede escribir;
 *  · `silencio` (del bus, con lo que de verdad pasó) y `perfil` (avatar e idioma);
 *  · `lectura` (del bus): lo que el teléfono leyó de un chat o encontró al buscar, dicho con la voz de
 *    AURA sin pasar por el cerebro (acciones.ts, `decirLectura`);
 *  · el audio: cuándo la conversación suelta de verdad el audio del teléfono (audioVoz.ts), avisado en
 *    el bus (`voz`) para que una llamada no arranque el suyo mientras AURA todavía se cierra;
 *  · el puente de acciones se detiene con la app detrás y se reanuda al volver (sin SSE en segundo
 *    plano); al cerrar cada conversación se le avisa al servidor (POST /api/voz/agente/cerrar).
 *
 * La mesa (DeskScreen) lo consume con `useVoz()`. Si una pantalla se monta sin el proveedor,
 * `useVozOpcional()` devuelve null y ella misma se envuelve (ver DeskScreen).
 */
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { API_BASE } from '../config';
import { api } from '../lib/api';
import { loadMesaToken } from '../lib/storage';
import { miga } from '../lib/reporte';
import { emocionDeTexto } from '../lib/emocion';
import { nivelExterno, speak, suspenderVoz, vozSuspendida } from '../lib/tts';
import { pauseMicForTts, suspenderOido } from '../lib/speech';
import { suspenderSfx } from '../lib/sfx';
import { quitarExpresiones } from '../lib/expresiones';
import { idiomaActual, useIdioma } from '../i18n';
import { avatarActual } from '../avatares/actual';
import type { AvatarId } from '../avatares/catalogo';
import { emitir, escuchar, RUTA_CONTEXTO, RUTA_PERFIL, type Contexto } from '../nucleo/contrato';
import { ModoConversacion, type ControlesSesion } from '../components/ModoConversacion';
import { ControlSesion, type EstadoVoz, type VistaSesion } from './sesion';
import { Precalentador } from './permiso';
import { coordinarLlamadas } from './llamada';
import { ContextoApp, PuenteAcciones, decirLectura, type XhrMin } from './acciones';
import { AudioVoz } from './audioVoz';
import { cabecerasAparato } from '../lib/aparato';
import { escucharCuenta } from '../pulse/relevo';
import { contactosParaAura } from './contactos';
import { ecoMesa, interrupcionVoz, mensajeVoz, nivelOido } from './canales';

export type ApiVoz = {
  vista: VistaSesion;
  /** Abrir la conversación (o despertarla si estaba silenciada). false: hay una llamada. */
  iniciar: () => boolean;
  terminar: () => void;
  alternar: () => void;
  /** Micrófono y voz apagados (true) o de vuelta (false; sin sesión, la abre). */
  silenciar: (valor: boolean) => void;
  /** El doble toque a la compañera. */
  despertarOSilenciar: () => 'despierta' | 'duerme' | 'nada';
  /** Dejar el permiso listo (al entrar, al tocar a la compañera, al rozar «Conversar»). */
  precalentar: () => void;
  /** El avatar de la mesa cambió: la voz se reabre con él. */
  fijarAvatar: (id: AvatarId) => void;
  /** Un texto escrito hacia la conversación abierta. false: no hay conversación. */
  enviarTexto: (texto: string) => boolean;
  /** Un dato para el agente sin que cuente como turno. */
  avisarAgente: (texto: string) => boolean;
  /** La persona está escribiendo: que no la interrumpa. */
  actividad: () => void;
  /** «¡Listo!» / «no pude» en voz alta: al agente si hay conversación; si no, con la voz de la mesa. */
  confirmar: (ok: boolean, texto: string) => void;
};

const VozCtx = createContext<ApiVoz | null>(null);

export function useVoz(): ApiVoz {
  const v = useContext(VozCtx);
  if (!v) throw new Error('useVoz fuera de VozProvider');
  return v;
}

export function useVozOpcional(): ApiVoz | null {
  return useContext(VozCtx);
}

/** ¿La conversación ocupa el micrófono? (abierta o dormida por silencio largo: la mesa no debe oír). */
export function vozOcupaMicrofono(v: VistaSesion): boolean {
  return v.montada || v.dormida;
}

const pedirPermiso = (avatar: AvatarId, idioma: 'es' | 'en') =>
  api<{ token: string; pase: string; cid?: string }>('/api/voz/agente', { method: 'POST', body: JSON.stringify({ avatar, idioma }) }, 15_000);

/** Se cerró una conversación: el servidor suelta lo suyo (opcional, sin esperar; si falla, vence solo). */
const avisarCierre = (pase: string) =>
  void api('/api/voz/agente/cerrar', { method: 'POST', body: JSON.stringify({ pase }) }, 8_000).catch(() => undefined);

/** Una sola para toda la app: la llamada escucha su aviso en el bus (`voz`). */
const audioVoz = new AudioVoz((libre) => emitir('voz', { libre }));

async function hayToken(): Promise<boolean> {
  return !!(await loadMesaToken().catch(() => ''));
}

type Props = {
  children: ReactNode;
  /** Dibujar la compañera encima de todo (por omisión, sí). */
  conCompanera?: boolean;
};

export function VozProvider({ children, conCompanera = true }: Props) {
  const idioma = useIdioma();
  const ctl = useRef<ControlSesion | null>(null);
  if (!ctl.current) ctl.current = new ControlSesion(avatarActual(), idiomaActual());
  const control = ctl.current;
  const vista = useSyncExternalStore(
    useCallback((f: () => void) => control.suscribir(f), [control]),
    () => control.vista(),
    () => control.vista()
  );
  const pre = useRef<Precalentador | null>(null);
  if (!pre.current) pre.current = new Precalentador(pedirPermiso);
  const precalentador = pre.current;
  const controles = useRef<ControlesSesion | null>(null);

  const precalentar = useCallback(() => {
    const v = control.vista();
    if (v.suspendida) return;
    void hayToken().then((ok) => {
      if (ok) void precalentador.precalentar(v.avatar, v.idioma);
    });
  }, [control, precalentador]);

  // El idioma elegido manda en la voz (el avatar lo fija la mesa o el perfil).
  useEffect(() => {
    control.perfil(control.vista().avatar, idioma);
  }, [control, idioma]);

  // El reloj del silencio largo, segundo plano, perfil, silencio y llamadas.
  const puenteRef = useRef<PuenteAcciones | null>(null);
  useEffect(() => {
    const tic = setInterval(() => control.tic(), 10_000);
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        precalentar();
        puenteRef.current?.arrancar();
      } else if (st === 'background') {
        miga('voz: segundo plano, la conversación se cierra');
        control.segundoPlano();
        // Sin SSE en segundo plano (batería, datos): al volver se reconecta con Last-Event-ID.
        puenteRef.current?.parar();
      }
    });
    const offPerfil = escuchar('perfil', (p) => {
      control.perfil(p.avatar, p.idioma);
      precalentar();
    });
    const offAccion = escuchar('accion', (a) => {
      if (a.tipo !== 'silencio') return;
      const r = control.aplicarSilencio(a.valor);
      emitir('hecho', { accion: a, ok: r.ok, ...(r.detalle ? { detalle: r.detalle } : {}) });
    });
    // Lo que el teléfono lee de un chat («¿qué me dijo Beto?») o encontró al buscar: con la voz de AURA.
    const offLectura = escuchar('lectura', (l) => {
      void decirLectura(l, {
        vista: () => control.vista(),
        enviarTexto: (t) => !!controles.current?.enviarTexto(t),
        hablarMesa: (t) => speak(t, { privado: true, onAudioStart: () => pauseMicForTts(true), onEnd: () => pauseMicForTts(false) }),
        mesaHablando: () => ecoMesa.ultimo().hablando,
        vozSuspendida,
      }).then((como) => miga(`lectura: ${como}`));
    });
    const offLlamada = coordinarLlamadas({
      escuchar: (tipo, f) => escuchar(tipo, f),
      sesion: control,
      // Si la llamada termina con la app detrás, la conversación no se reabre en segundo plano.
      enPrimerPlano: () => AppState.currentState === 'active',
      suspenderVoz,
      suspenderOido,
      suspenderSfx,
      miga,
    });
    return () => {
      clearInterval(tic);
      app.remove();
      offPerfil();
      offAccion();
      offLectura();
      offLlamada();
    };
  }, [control, precalentar]);

  // Precalentar al montarse (entrar a la app con sesión) y al cambiar de avatar o idioma.
  useEffect(() => {
    precalentar();
  }, [precalentar, vista.avatar, vista.idioma]);

  // El puente de acciones y el contexto: viven mientras viva la app (sin sesión, esperan).
  const contexto = useRef<ContextoApp | null>(null);
  useEffect(() => {
    const puente = new PuenteAcciones({
      base: API_BASE,
      token: async () => (await loadMesaToken().catch(() => '')) || null,
      xhr: () => new XMLHttpRequest() as unknown as XhrMin,
      alAccion: (a) => emitir('accion', a),
      // api() renueva la sesión sola si el servidor dice 401.
      renovar: () => api(RUTA_PERFIL, undefined, 10_000).then(() => undefined),
      // Qué teléfono escucha: el servidor le empuja las acciones al aparato que habló.
      cabeceras: () => cabecerasAparato(),
      miga,
    });
    puenteRef.current = puente;
    const ctx = new ContextoApp({
      enviar: async (c: Contexto) => {
        if (!(await hayToken())) return null;
        return api(RUTA_CONTEXTO, { method: 'POST', body: JSON.stringify(c) }, 10_000);
      },
      contactos: contactosParaAura,
      escuchar: (tipo, f) => escuchar(tipo, f as never),
    });
    contexto.current = ctx;
    if (AppState.currentState !== 'background') puente.arrancar();
    ctx.arrancar();
    // Entrar o salir del chat cambia el id del aparato (el del relevo o el propio): el SSE se rehace
    // con la cabecera nueva y el permiso de voz precalentado (pedido con la vieja) se tira.
    const offCuenta = escucharCuenta(() => {
      precalentador.olvidar();
      if (AppState.currentState === 'background') return;
      puente.parar();
      puente.arrancar();
    });
    return () => {
      offCuenta();
      puente.parar();
      if (puenteRef.current === puente) puenteRef.current = null;
      ctx.parar();
      contexto.current = null;
    };
  }, [precalentador]);
  const conversando = vista.montada && (vista.estado === 'escuchando' || vista.estado === 'hablando');
  useEffect(() => {
    contexto.current?.fijarConversando(conversando);
  }, [conversando]);

  // Lo que avisa la sesión montada (lo de una generación vieja lo descarta el control).
  const alEstado = useCallback((gen: number, e: EstadoVoz, detalle?: string) => control.alEstado(gen, e, detalle), [control]);
  const alMensaje = useCallback(
    (gen: number, rol: 'usuario' | 'ultron', texto: string) => {
      if (gen !== control.vista().gen) return;
      const limpio = quitarExpresiones(texto).trim();
      if (!limpio) return;
      mensajeVoz.emitir({ rol, texto: limpio, emocion: rol === 'ultron' ? emocionDeTexto(texto) : 'neutral', en: Date.now() });
    },
    [control]
  );
  const alInterrupcion = useCallback(
    (gen: number) => {
      if (gen === control.vista().gen) interrupcionVoz.emitir(interrupcionVoz.ultimo() + 1);
    },
    [control]
  );
  const alNiveles = useCallback((salida: number, entrada: number) => {
    nivelExterno(salida);
    nivelOido.emitir(entrada);
  }, []);
  const alAudio = useCallback((gen: number, que: 'toma' | 'suelta' | 'cerrando') => {
    if (que === 'toma') audioVoz.tomar(gen);
    else if (que === 'suelta') audioVoz.soltar(gen);
    else audioVoz.cerrando(gen);
  }, []);
  const alFin = useCallback((_gen: number, pase: string) => avisarCierre(pase), []);
  const permiso = useCallback(() => {
    const v = control.vista();
    return precalentador.tomar(v.avatar, v.idioma, v.intento > 0);
  }, [control, precalentador]);

  const valor = useMemo<ApiVoz>(
    () => ({
      vista,
      iniciar: () => control.iniciar(),
      terminar: () => control.terminar(),
      alternar: () => control.alternar(),
      silenciar: (v) => control.silenciar(v),
      despertarOSilenciar: () => control.despertarOSilenciar(),
      precalentar,
      fijarAvatar: (id) => {
        control.perfil(id, control.vista().idioma);
      },
      enviarTexto: (t) => !!controles.current?.enviarTexto(t),
      avisarAgente: (t) => !!controles.current?.avisar(t),
      actividad: () => controles.current?.actividad(),
      confirmar: (ok, texto) => {
        if (controles.current?.avisar(`[app] ${ok ? 'Hecho' : 'No se pudo'}: ${texto}`)) return;
        // Sin conversación: con la voz de la mesa, solo si nadie está hablando y no hay llamada.
        const v = control.vista();
        if (v.suspendida || v.silenciada || v.dormida || vozSuspendida() || ecoMesa.ultimo().hablando) return;
        void speak(texto, { onAudioStart: () => pauseMicForTts(true), onEnd: () => pauseMicForTts(false) });
      },
    }),
    [vista, control, precalentar]
  );

  return (
    <VozCtx.Provider value={valor}>
      {children}
      {vista.montada ? (
        <ModoConversacion
          key={vista.gen}
          gen={vista.gen}
          silenciada={vista.silenciada}
          permiso={permiso}
          onEstado={alEstado}
          onMensaje={alMensaje}
          onInterrupcion={alInterrupcion}
          onNiveles={alNiveles}
          onAudio={alAudio}
          onFin={alFin}
          controles={controles}
        />
      ) : null}
      {conCompanera ? <CompaneraSegura /> : null}
    </VozCtx.Provider>
  );
}

/*
 * La compañera se carga con require dentro de un try (como CaraSegura): Skia y Reanimated son
 * módulos nativos; si en algún teléfono fallan, AURA se queda sin su figurita pero la app y la voz
 * siguen. Un error al dibujar la apaga sin tumbar lo demás.
 */
let moduloCompa: typeof import('./Companera') | null = null;
let falloCompa = false;

class LimiteCompa extends Component<{ children: ReactNode }, { roto: boolean }> {
  state = { roto: false };
  static getDerivedStateFromError() {
    return { roto: true };
  }
  componentDidCatch(e: unknown) {
    miga(`compañera: se apagó (${String(e instanceof Error ? e.message : e).slice(0, 80)})`);
  }
  render() {
    return this.state.roto ? null : this.props.children;
  }
}

function CompaneraSegura() {
  if (!moduloCompa && !falloCompa) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      moduloCompa = require('./Companera') as typeof import('./Companera');
    } catch (e) {
      falloCompa = true;
      miga(`compañera: no cargó (${String(e instanceof Error ? e.message : e).slice(0, 80)})`);
    }
  }
  if (!moduloCompa) return null;
  const C = moduloCompa.Companera;
  return (
    <LimiteCompa>
      <C />
    </LimiteCompa>
  );
}
