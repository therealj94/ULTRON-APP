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
 *  · la llamada de un recordatorio («llámame a las 5 para recordarme…»): la pantalla «AURA te llama»
 *    (LlamadaAura.tsx) y, al contestar, abrir la conversación para que ella lo diga (`decirRecordatorio`);
 *  · el audio: cuándo la conversación suelta de verdad el audio del teléfono (audioVoz.ts), avisado en
 *    el bus (`voz`) para que una llamada no arranque el suyo mientras AURA todavía se cierra;
 *  · el puente de acciones se detiene con la app detrás y se reanuda al volver (sin SSE en segundo
 *    plano); al cerrar cada conversación se le avisa al servidor (POST /api/voz/agente/cerrar);
 *  · la boca de AURA como señal para cualquier cuerpo (avatar3d/senalVoz.ts): el nivel de la voz
 *    (la de la mesa y la de la conversación) entra ahí, y una interrupción la cierra;
 *  · junto a la compañera, AURA a pantalla completa cuando la persona lo pide (avatar3d/EscenarioAura).
 *
 * La mesa (DeskScreen) lo consume con `useVoz()`. Si una pantalla se monta sin el proveedor,
 * `useVozOpcional()` devuelve null y ella misma se envuelve (ver DeskScreen).
 */
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { API_BASE } from '../config';
import { api } from '../lib/api';
import { loadMesaToken } from '../lib/storage';
import { miga } from '../lib/reporte';
import { emocionDeTexto } from '../lib/emocion';
import { escucharNivelVoz, nivelExterno, speak, stopSpeaking, suspenderVoz, vozSuspendida } from '../lib/tts';
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
import { ContextoApp, PuenteAcciones, decirLectura, decirRecordatorio, type XhrMin } from './acciones';
import { escucharPorDecir, listarRecordatorios, tomarPorDecir } from './recordatorios';
import { depsRecordatorios } from './recordatoriosNativo';
import { LlamadaAura } from './LlamadaAura';
import { AudioVoz } from './audioVoz';
import { cabecerasAparato } from '../lib/aparato';
import { escucharCuenta } from '../pulse/relevo';
import { contactosParaAura } from './contactos';
import { ecoMesa, interrupcionVoz, mensajeVoz, nativoAtiende, nivelOido } from './canales';
import { CicloLlamada, avisoMinutos, diaHonduras, type Decision, type EfectoCiclo, type EstadoCiclo } from './llamadaCiclo';
import { loadSettings, loadVozHoy, saveSettings, saveVozHoy } from '../lib/storage';
import { avatarPorId } from '../avatares/catalogo';
import { de } from '../i18n';
import { senalVoz } from '../avatar3d/senalVoz';

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
  /** MODO LLAMADA (compa/llamadaCiclo.ts): encendido (Ajustes; por omisión, sí). */
  modoLlamada: boolean;
  /** El ciclo: apagado, espera, conectando, en llamada, silenciado, colgando. */
  ciclo: EstadoCiclo;
  /** Lo que el oído del teléfono transcribió en ESPERA: despertar la llamada, ignorarlo o que lo conteste la mesa. */
  enEspera: (texto: string, ctx: { mesaVisible: boolean; ruido: number | null }) => Decision;
  /** Abrir la llamada con lo dicho en espera (lo que no era una orden rápida) como primer mensaje. */
  despertar: (texto?: string | null) => void;
  /** Minutos de llamada de hoy en este teléfono (ms). */
  usadoHoyMs: number;
  /** El nombre con que se la llama (la palabra de activación del avatar). */
  nombreLlamada: string;
  /** ¿Se puede llamar ahora? (con minutos y sin esperar tras un fallo). Si no, atiende el oído del teléfono. */
  llamadaLista: boolean;
  /** Encender o apagar el modo llamada (se guarda). */
  fijarModoLlamada: (on: boolean) => void;
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

  /*
   * EL CICLO DE LA LLAMADA (compa/llamadaCiclo.ts): cuándo la sesión de ElevenLabs se abre (la palabra
   * de activación en espera, tocar Hablar), cuándo cuelga (silencio sin turnos, una despedida, la app
   * detrás) y el doble toque. El ciclo decide; aquí se ejecutan sus efectos sobre el ControlSesion.
   */
  const cic = useRef<CicloLlamada | null>(null);
  if (!cic.current) {
    cic.current = new CicloLlamada({
      nombre: () => de(avatarPorId(control.vista().avatar).nombre),
      idioma: () => control.vista().idioma,
    });
  }
  const ciclo = cic.current;
  const estadoCiclo = useSyncExternalStore(
    useCallback((f: () => void) => ciclo.suscribir(f), [ciclo]),
    () => ciclo.estado(),
    () => ciclo.estado()
  );
  const [modoLlamada, setModoLlamada] = useState(true);
  const modoRef = useRef(true);
  modoRef.current = modoLlamada;
  /** Minutos de llamada de hoy (lo guardado del día + lo de este ciclo). */
  const [usadoHoyMs, setUsadoHoyMs] = useState(0);
  const [llamadaLista, setLlamadaLista] = useState(true);
  const baseHoy = useRef({ dia: '', ms: 0, ciclo0: 0 });
  const nAtiende = useRef(0);
  const ejecutar = useCallback(
    (efectos: EfectoCiclo[]) => {
      for (const ef of efectos) {
        switch (ef.tipo) {
          case 'abrir':
            control.iniciar();
            break;
          case 'cerrar':
            miga(`llamada: cuelga (${ef.motivo})`);
            control.terminar();
            break;
          case 'silenciar':
            control.silenciar(ef.valor);
            break;
          case 'dormir':
            control.dormir();
            break;
          case 'despertarOido':
            // Fuera del silenciado sin sesión: la sesión «dormida» suelta el audio y el oído del teléfono vuelve.
            control.terminar();
            break;
          case 'primerMensaje':
            // Lo dicho en espera, como primer mensaje: no se pierde la primera frase.
            if (controles.current?.enviarTexto(ef.texto)) mensajeVoz.emitir({ rol: 'usuario', texto: ef.texto, emocion: 'neutral', en: Date.now() });
            else nativoAtiende.emitir({ texto: ef.texto, motivo: 'no se pudo enviar a la llamada', n: ++nAtiende.current });
            break;
          case 'despedida':
            // Breve y con la voz de la mesa: no gasta un turno de la llamada (ya colgada).
            if (!vozSuspendida() && !ecoMesa.ultimo().hablando) void speak(ef.texto, { onAudioStart: () => pauseMicForTts(true), onEnd: () => pauseMicForTts(false) });
            break;
          case 'avisoTope':
            miga(`llamada: quedan ${Math.round(ef.restanteMs / 1000)} s de voz hoy`);
            controles.current?.avisar(avisoMinutos(ef.restanteMs, control.vista().idioma));
            break;
          case 'alNativo':
            miga(`llamada: atiende el oído del teléfono (${ef.motivo.slice(0, 60)})`);
            nativoAtiende.emitir({ texto: ef.texto, motivo: ef.motivo, n: ++nAtiende.current });
            break;
        }
      }
    },
    [control]
  );
  // El modo llamada (Ajustes) y los minutos de hoy.
  useEffect(() => {
    let vivo = true;
    const dia = diaHonduras();
    void loadSettings().then((s) => {
      if (!vivo) return;
      const on = s.vozLlamada !== false;
      setModoLlamada(on);
      ejecutar(ciclo.fijarActivo(on));
    });
    void loadVozHoy(dia).then((ms) => {
      if (!vivo) return;
      baseHoy.current = { dia, ms, ciclo0: ciclo.usadoMs() };
      setUsadoHoyMs(ms);
    });
    return () => {
      vivo = false;
    };
  }, [ciclo, ejecutar]);
  // Lo que pasa en la sesión, contado al ciclo: conectó, habla, falló, se cerró.
  useEffect(() => {
    let antes = control.vista();
    return control.suscribir((v) => {
      const a = antes;
      antes = v;
      if (!modoRef.current) return;
      const ef: EfectoCiclo[] = [];
      if (v.montada && v.estado === 'conectando' && (!a.montada || a.gen !== v.gen)) ef.push(...ciclo.sesionAbriendo());
      if (v.montada && (v.estado === 'escuchando' || v.estado === 'hablando') && a.estado === 'conectando') ef.push(...ciclo.conectado());
      if (v.estado === 'hablando' && a.estado !== 'hablando') ef.push(...ciclo.agente(true));
      if (a.estado === 'hablando' && v.estado !== 'hablando') ef.push(...ciclo.agente(false));
      if (!v.montada && v.estado === 'error' && (a.montada || a.estado !== 'error')) ef.push(...ciclo.fallo(v.detalle));
      else if (a.montada && !v.montada) ef.push(...ciclo.cerrada());
      ejecutar(ef);
    });
  }, [control, ciclo, ejecutar]);
  // El reloj del ciclo (colgar por silencio, cerrar la sesión silenciada, el aviso de minutos) y los minutos de hoy.
  useEffect(() => {
    const t = setInterval(() => {
      if (!modoRef.current) return;
      ejecutar(ciclo.tic());
      setLlamadaLista(ciclo.llamadaDisponible());
      const b = baseHoy.current;
      const dia = diaHonduras();
      if (b.dia && b.dia !== dia) baseHoy.current = { dia, ms: 0, ciclo0: ciclo.usadoMs() };
      const hoy = baseHoy.current.ms + (ciclo.usadoMs() - baseHoy.current.ciclo0);
      setUsadoHoyMs((x) => (Math.abs(x - hoy) >= 1000 ? hoy : x));
    }, 1_000);
    const g = setInterval(() => {
      const b = baseHoy.current;
      if (b.dia) void saveVozHoy({ dia: b.dia, ms: b.ms + (ciclo.usadoMs() - b.ciclo0) });
    }, 15_000);
    return () => {
      clearInterval(t);
      clearInterval(g);
    };
  }, [ciclo, ejecutar]);
  // En espera, el permiso de la próxima llamada ya listo (despertar = solo conectar).
  useEffect(() => {
    if (estadoCiclo === 'espera') precalentar();
  }, [estadoCiclo, precalentar]);

  // La boca de AURA para cualquier cuerpo: el mismo nivel que mueve la cara de la mesa.
  useEffect(() => escucharNivelVoz((l) => senalVoz.nivel(l)), []);

  // El idioma elegido manda en la voz (el avatar lo fija la mesa o el perfil).
  useEffect(() => {
    control.perfil(control.vista().avatar, idioma);
  }, [control, idioma]);

  // El reloj del silencio largo, segundo plano, perfil, silencio y llamadas.
  const puenteRef = useRef<PuenteAcciones | null>(null);
  useEffect(() => {
    const tic = setInterval(() => control.tic(), 10_000);
    // El vigilante de la conversación: «Conectando…» sin tope o abierta sin que le llegue la voz no
    // pueden quedarse con el micrófono (nadie más escucharía). Fallan y el oído del teléfono vuelve.
    const vigia = setInterval(() => {
      const r = control.revisar();
      if (r !== 'nada') miga(`voz: ${r === 'sorda' ? 'abierta pero sin audio del micrófono' : 'no conectó a tiempo'}; el audio vuelve al oído del teléfono`);
    }, 1_000);
    // El ciclo de la llamada: con la app delante y sesión, en espera; detrás, apagado (cuelga).
    const encenderCiclo = () =>
      void hayToken().then((ok) => {
        if (ok && AppState.currentState === 'active') ejecutar(ciclo.encender());
      });
    encenderCiclo();
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        precalentar();
        puenteRef.current?.arrancar();
        encenderCiclo();
      } else if (st === 'background') {
        miga('voz: segundo plano, la conversación se cierra');
        ejecutar(ciclo.apagar());
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
      if (modoRef.current) {
        // En modo llamada, «cállate» / «ya puedes hablar» es el mismo interruptor que el doble toque.
        const e = ciclo.estado();
        const quiereSilencio = !!a.valor;
        const cambia = quiereSilencio ? e === 'en_llamada' || e === 'espera' : e === 'silenciado';
        if (cambia) ejecutar(ciclo.dobleToque());
        emitir('hecho', { accion: a, ok: cambia, ...(cambia ? {} : { detalle: quiereSilencio ? 'Ya estaba en silencio.' : 'Ya estaba escuchando.' }) });
        return;
      }
      const r = control.aplicarSilencio(a.valor);
      emitir('hecho', { accion: a, ok: r.ok, ...(r.detalle ? { detalle: r.detalle } : {}) });
    });
    // Lo que el teléfono lee de un chat («¿qué me dijo Beto?») o encontró al buscar: con la voz de AURA.
    // Contestó la llamada de un recordatorio: AURA se lo dice con su voz (y la charla sigue). Lo que
    // quedó guardado antes de montarse la voz (la app se abrió por el toque) se dice ahora.
    const decirElRecordatorio = () => {
      const l = tomarPorDecir();
      if (!l) return;
      void decirRecordatorio(l.texto, {
        vista: () => control.vista(),
        despertar: () => control.silenciar(false),
        enviarTexto: (t) => !!controles.current?.enviarTexto(t),
        hablarMesa: (t) => speak(t, { privado: true, onAudioStart: () => pauseMicForTts(true), onEnd: () => pauseMicForTts(false) }),
        enLlamada: () => control.vista().suspendida,
        finDeLlamada: () =>
          new Promise<void>((listo) => {
            const off = escuchar('llamada', (e) => {
              if (e.activa) return;
              off();
              // La conversación se reabre sola al colgar: un respiro para que no se crucen.
              setTimeout(listo, 1500);
            });
          }),
      }).then((como) => miga(`recordatorio contestado: ${como}`));
    };
    const offRecordatorio = escucharPorDecir(decirElRecordatorio);
    decirElRecordatorio();
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
      clearInterval(vigia);
      app.remove();
      offPerfil();
      offAccion();
      offLectura();
      offRecordatorio();
      offLlamada();
    };
  }, [control, precalentar, ciclo, ejecutar]);

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
      recordatorios: () => listarRecordatorios(depsRecordatorios),
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
  // Un solo dueño del audio (compa/duenoAudio.ts): al abrirse la conversación en vivo, venga de donde
  // venga (la mesa, la compañera, el panel), la voz de la mesa se calla. Nunca dos voces a la vez.
  useEffect(() => {
    if (vista.montada) void stopSpeaking();
  }, [vista.montada, vista.gen]);
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
      if (rol === 'usuario') {
        control.oyoFrase();
        if (modoRef.current) ejecutar(ciclo.turnoUsuario(limpio));
      }
      mensajeVoz.emitir({ rol, texto: limpio, emocion: rol === 'ultron' ? emocionDeTexto(texto) : 'neutral', en: Date.now() });
    },
    [control, ciclo, ejecutar]
  );
  const alInterrupcion = useCallback(
    (gen: number) => {
      if (gen !== control.vista().gen) return;
      interrupcionVoz.emitir(interrupcionVoz.ultimo() + 1);
      senalVoz.cortar();
    },
    [control]
  );
  const alNiveles = useCallback(
    (salida: number, entrada: number) => {
      nivelExterno(salida);
      nivelOido.emitir(entrada);
      control.entrada(entrada);
    },
    [control]
  );
  const alAudio = useCallback((gen: number, que: 'toma' | 'suelta' | 'cerrando') => {
    if (que === 'toma') audioVoz.tomar(gen);
    else if (que === 'suelta') audioVoz.soltar(gen);
    else audioVoz.cerrando(gen);
  }, []);
  const alFin = useCallback((_gen: number, pase: string) => avisarCierre(pase), []);
  const permiso = useCallback(async () => {
    const v = control.vista();
    const p = await precalentador.tomar(v.avatar, v.idioma, v.intento > 0);
    // Los minutos que le quedan hoy (miembros): el ciclo avisa antes de agotarlos.
    ciclo.fijarTope(typeof p.restanteMs === 'number' ? p.restanteMs : null);
    return p;
  }, [control, precalentador, ciclo]);

  const nombreLlamada = de(avatarPorId(vista.avatar).nombre);
  const valor = useMemo<ApiVoz>(
    () => ({
      vista,
      // En modo llamada, abrir/colgar/silenciar pasan por el ciclo (un solo lugar decide); sin él, como antes.
      iniciar: () => {
        if (!modoLlamada) return control.iniciar();
        if (control.vista().suspendida) return false;
        ejecutar(ciclo.despertar(null));
        return true;
      },
      terminar: () => (modoLlamada ? ejecutar(ciclo.colgar()) : control.terminar()),
      alternar: () => (modoLlamada ? ejecutar(ciclo.tocarHablar()) : control.alternar()),
      silenciar: (v) => {
        if (!modoLlamada) return control.silenciar(v);
        const e = ciclo.estado();
        if (v ? e === 'en_llamada' || e === 'espera' : e === 'silenciado') ejecutar(ciclo.dobleToque());
        else if (!v && e !== 'en_llamada' && e !== 'conectando') ejecutar(ciclo.despertar(null));
      },
      despertarOSilenciar: () => {
        if (!modoLlamada) return control.despertarOSilenciar();
        const antes = ciclo.estado();
        ejecutar(ciclo.dobleToque());
        const ahora = ciclo.estado();
        return ahora === antes ? 'nada' : ahora === 'silenciado' ? 'duerme' : 'despierta';
      },
      modoLlamada,
      ciclo: estadoCiclo,
      enEspera: (texto, ctx) => (modoLlamada ? ciclo.frase(texto, ctx) : { tipo: 'nativo' }),
      despertar: (texto) => ejecutar(ciclo.despertar(texto ?? null)),
      usadoHoyMs,
      nombreLlamada,
      llamadaLista,
      fijarModoLlamada: (on) => {
        setModoLlamada(on);
        void saveSettings({ vozLlamada: on });
        ejecutar(ciclo.fijarActivo(on));
        if (on && AppState.currentState === 'active') ejecutar(ciclo.encender());
      },
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
    [vista, control, precalentar, modoLlamada, estadoCiclo, ciclo, ejecutar, usadoHoyMs, nombreLlamada, llamadaLista]
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
      <LlamadaAura />
    </VozCtx.Provider>
  );
}

/*
 * La compañera se carga con require dentro de un try (como CaraSegura): Skia y Reanimated son
 * módulos nativos; si en algún teléfono fallan, AURA se queda sin su figurita pero la app y la voz
 * siguen. Un error al dibujar la apaga sin tumbar lo demás. AURA a pantalla completa va en el mismo
 * límite (usa la misma figurita).
 */
let moduloCompa: typeof import('./Companera') | null = null;
let moduloEscenario: typeof import('../avatar3d/EscenarioAura') | null = null;
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      moduloEscenario = require('../avatar3d/EscenarioAura') as typeof import('../avatar3d/EscenarioAura');
    } catch (e) {
      falloCompa = true;
      miga(`compañera: no cargó (${String(e instanceof Error ? e.message : e).slice(0, 80)})`);
    }
  }
  if (!moduloCompa) return null;
  const C = moduloCompa.Companera;
  const E = moduloEscenario?.EscenarioAura;
  return (
    <LimiteCompa>
      <C />
      {E ? <E /> : null}
    </LimiteCompa>
  );
}
