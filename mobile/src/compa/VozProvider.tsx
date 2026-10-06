/**
 * LA VOZ DE AURA, PARA TODA LA APP: la conversación fluida vive aquí y no en la mesa.
 *
 * Se monta una vez, encima de las pantallas (App.tsx). Así AURA sigue oyendo y hablando cuando la
 * persona se va a los chats o a los ajustes, y la compañera (que se dibuja aquí mismo, encima de
 * todo) refleja lo que pasa. Reúne:
 *
 *  · la sesión de ElevenLabs (components/ModoConversacion, montada con `key={gen}`) y su control
 *    (sesion.ts): abrir, cerrar, silenciar de verdad, reintentar, generaciones (M4);
 *  · el permiso precalentado (permiso.ts) mientras suena la llamada: al contestar, solo falta conectar;
 *  · segundo plano: la sesión se cierra (M5); al volver se precalienta otra vez;
 *  · llamadas (llamada.ts): AURA se apaga del todo y vuelve como estaba al colgar;
 *  · el puente de acciones y el contexto (acciones.ts): lo que AURA decide hacer llega por SSE y se
 *    emite en el bus; el teléfono le cuenta al cerebro dónde está la persona y a quién puede escribir;
 *  · `silencio` (del bus, con lo que de verdad pasó) y `perfil` (avatar e idioma);
 *  · `lectura` (del bus): lo que el teléfono leyó de un chat o encontró al buscar, dicho con la voz de
 *    AURA sin pasar por el cerebro (acciones.ts, `decirLectura`);
 *  · LA LLAMADA DEL AVATAR (llamadaCiclo.ts + LlamadaAvatar.tsx): «llámame» o un recordatorio / timer
 *    hacen sonar la pantalla «te está llamando» (timbre y vibración, timbre.ts); al contestar se abre la
 *    conversación con el motivo como primer mensaje y dura hasta que la persona cuelga; se minimiza a una
 *    píldora para usar la app (entrar a los chats la minimiza sola) y no hay sesión fuera de ella;
 *  · el audio: cuándo la conversación suelta de verdad el audio del teléfono (audioVoz.ts), avisado en
 *    el bus (`voz`) para que una llamada no arranque el suyo mientras AURA todavía se cierra;
 *  · el SONIDO DE FONDO de una tarea lenta en la conversación (ambiente.ts): tecleo, papel o lápiz
 *    mientras AURA busca, lee o calcula; lo manda el servidor por el canal de acciones y se para al
 *    contestar, al hablar la persona, al colgar o silenciar y con la app detrás;
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
import { AppState, Platform } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import { API_BASE } from '../config';
import { api } from '../lib/api';
import { loadMesaToken } from '../lib/storage';
import { miga, reportarEstado } from '../lib/reporte';
import { emocionDeTexto } from '../lib/emocion';
import { callarPorConversacion, escucharNivelVoz, nivelExterno, speak, stopSpeaking, suspenderVoz, vozSuspendida } from '../lib/tts';
import { pauseMicForTts, suspenderOido } from '../lib/speech';
import { suspenderSfx } from '../lib/sfx';
import { ambienteActivo, leerAmbiente, suscribirAmbiente } from '../lib/ambienteAjuste';
import { quitarExpresiones } from '../lib/expresiones';
import { idiomaActual, tr, useIdioma } from '../i18n';
import { avatarActual } from '../avatares/actual';
import type { AvatarId } from '../avatares/catalogo';
import { emitir, escuchar, RUTA_CONTEXTO, RUTA_PERFIL, type Contexto } from '../nucleo/contrato';
import { ModoConversacion, type ControlesSesion } from '../components/ModoConversacion';
import { ControlSesion, PERMISO_MAX_MS, type EstadoVoz, type VistaSesion } from './sesion';
import { Precalentador } from './permiso';
import { coordinarLlamadas } from './llamada';
import { ContextoApp, PuenteAcciones, decirLectura, type XhrMin } from './acciones';
import { AmbienteConversacion } from './ambiente';
import { reproductorAmbiente } from './ambienteSonido';
import { escucharPorDecir, escucharSonando, listarRecordatorios, llamadaSonando, tomarPorDecir, type LlamadaRecordatorio } from './recordatorios';
import { callarAvisoQueSuena, contestadaEnPantalla, depsRecordatorios, perdidaEnPantalla, rechazar as rechazarRecordatorio } from './recordatoriosNativo';
import { ALTO_PILDORA, LlamadaAvatar, type VistaLlamada } from './LlamadaAvatar';
import { callarTimbre, sonarTimbre } from './timbre';
import { AudioVoz } from './audioVoz';
import { vincularConReintentos, type VinculoMotor } from './vinculoMotor';
import { cabecerasAparato } from '../lib/aparato';
import { registrarTrabajoActivo } from '../lib/barreraOta';
import { escucharCuenta } from '../pulse/relevo';
import { contactosParaAura } from './contactos';
import { ecoMesa, interrupcionVoz, mensajeVoz, nivelOido } from './canales';
import { CicloLlamada, MENSAJE_SIGUES, avisoMinutos, diaHonduras, llamadaActiva, mandarAlAgente, seguirVozMesa, type EfectoCiclo, type EstadoCiclo, type OrigenLlamada } from './llamadaCiclo';
import { aplicarAccionControl, puertosTelefono } from './controles';
import { loadVozHoy, saveVozHoy } from '../lib/storage';
import { avatarPorId } from '../avatares/catalogo';
import { de } from '../i18n';
import { senalVoz } from '../avatar3d/senalVoz';
import { pedirGolpe } from '../avatares/video/pistas';

export type ApiVoz = {
  vista: VistaSesion;
  /** La llamada del avatar (compa/llamadaCiclo.ts), para pintarla y decidir quién oye. */
  llamada: Omit<VistaLlamada, 'avatar' | 'idioma'>;
  /** «Llámame»: que el avatar llame ya (suena la pantalla entrante). false: no se pudo (otra llamada, sin minutos). */
  llamame: () => boolean;
  contestar: () => void;
  rechazar: () => void;
  colgar: () => void;
  /** Minimizar la llamada (píldora) o agrandarla. */
  minimizar: (si: boolean) => void;
  /** Compatibilidad (el botón «en vivo» del panel): que el avatar llame. */
  iniciar: () => boolean;
  /** Colgar la llamada. */
  terminar: () => void;
  /** En llamada, cuelga; sonando, rechaza; si no, abre la conversación al instante. */
  alternar: () => void;
  /** En llamada: micrófono y voz apagados (true) o de vuelta (false). Fuera de una llamada no hace nada. */
  silenciar: (valor: boolean) => void;
  /** El doble toque: en llamada, silenciar / volver a escuchar. */
  despertarOSilenciar: () => 'despierta' | 'duerme' | 'nada';
  /** Dejar el permiso listo. Solo al sonar la llamada (el timbre lo llama solo): no al entrar ni al tocar. */
  precalentar: () => void;
  /** El avatar de la mesa cambió: la voz se reabre con él. */
  fijarAvatar: (id: AvatarId) => void;
  /** Un texto escrito hacia la llamada abierta. false: no hay llamada. */
  enviarTexto: (texto: string) => boolean;
  /** Un dato para el agente sin que cuente como turno. */
  avisarAgente: (texto: string) => boolean;
  /** La persona está escribiendo: que no la interrumpa. */
  actividad: () => void;
  /** «¡Listo!» / «no pude» en voz alta: al agente si hay llamada; si no, con la voz de la mesa. */
  confirmar: (ok: boolean, texto: string) => void;
  /** El estado de la llamada del avatar. */
  ciclo: EstadoCiclo;
  /** Minutos de llamada de hoy en este teléfono (ms). */
  usadoHoyMs: number;
  /** El nombre del avatar que llama. */
  nombreLlamada: string;
  /** ¿Hay minutos para una llamada ahora? */
  llamadaLista: boolean;
};

const VozCtx = createContext<ApiVoz | null>(null);


/** Lo que la app tiene que seguir detrás para colgar la llamada (un diálogo del sistema dura menos). */
export const SEGUNDO_PLANO_MS = 3_000;
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

/** El plazo de la petición es el de la fase «permiso» del control (sesion.ts): los dos dicen lo mismo. */
const pedirPermiso = (avatar: AvatarId, idioma: 'es' | 'en') =>
  api<{ token: string; pase: string; cid?: string; motor?: string; primerMensaje?: string }>('/api/voz/agente', { method: 'POST', body: JSON.stringify({ avatar, idioma }) }, PERMISO_MAX_MS);

/**
 * Va a hablar (abrió la app o volvió a ella): el cerebro deja leído su contexto y el primer turno no espera 4–8 s.
 * El servidor decide si hace falta (con un turno reciente no hace nada; una vez por minuto como mucho). Desde el
 * 2-oct el precalentado ya no se pierde: antes las sondas de otros servicios le borraban el espacio a la persona y
 * cada vuelta a la app costaba ~8 s de GPU para nada; por eso se había quitado de aquí.
 */
const precalentarCerebro = () => void api('/api/cerebro/calentar', { method: 'POST', body: '{}' }, 8_000).catch(() => undefined);

/** Se cerró una conversación: el servidor suelta lo suyo (opcional, sin esperar; si falla, vence solo). */
const avisarCierre = (pase: string) =>
  void api('/api/voz/agente/cerrar', { method: 'POST', body: JSON.stringify({ pase }) }, 8_000).catch(() => undefined);

/**
 * Motor nuevo de la llamada (prototipo de Speech Engine): la conversación de ElevenLabs se ata al pase, por si
 * ElevenLabs no reenvía `X-Pase`. Solo pasa si el permiso trajo `motor: 'speech-engine'`. Lo que contesta se lee
 * con honestidad (compa/vinculoMotor.ts): un «no» del servidor con su código termina la llamada (sesionVoz);
 * un 404 sin cuerpo de un proxy, un 5xx o sin red es pasajero y se reintenta.
 */
const vincularMotor = (pase: string, conversacion: string): Promise<VinculoMotor> =>
  vincularConReintentos(async () => {
    try {
      return { status: 200, json: await api('/api/voz/motor/vincular', { method: 'POST', body: JSON.stringify({ pase, conversacion }) }, 8_000) };
    } catch (e: any) {
      return { status: Number(e?.status) || 0, json: e?.data ?? null };
    }
  });

/** Una sola para toda la app: la llamada escucha su aviso en el bus (`voz`). */
const audioVoz = new AudioVoz((libre) => emitir('voz', { libre }));
/** Para la mesa: espera a que la conversación suelte el audio del teléfono (como mucho `topeMs`, 4 s). */
export const esperarAudioLibre = (topeMs?: number) => audioVoz.esperarLibre(topeMs);

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
  /** Los reintentos de mensajes de la llamada en curso: se cancelan al colgar (AUR10). */
  const reintentos = useRef<Array<() => void>>([]);
  // El sonido de fondo de las tareas lentas: solo con la conversación abierta, sin silencio, la app
  // delante y los sonidos de la app activados.
  const amb = useRef<AmbienteConversacion | null>(null);
  if (!amb.current)
    amb.current = new AmbienteConversacion({
      reproductor: reproductorAmbiente,
      puede: () => {
        const v = control.vista();
        // ambienteActivo: los efectos de la app, «Sonidos mientras trabaja» y el servidor (AURA_AMBIENTE; lib/ambienteAjuste.ts).
        return v.montada && !v.silenciada && !v.suspendida && (v.estado === 'escuchando' || v.estado === 'hablando') && AppState.currentState === 'active' && ambienteActivo();
      },
      miga,
    });
  const ambiente = amb.current;

  const precalentar = useCallback(() => {
    const v = control.vista();
    if (v.suspendida) return;
    void hayToken().then((ok) => {
      if (ok) void precalentador.precalentar(v.avatar, v.idioma);
    });
  }, [control, precalentador]);

  /*
   * LA LLAMADA DEL AVATAR (compa/llamadaCiclo.ts): «llámame» o un recordatorio la hacen sonar; al
   * contestar se abre la sesión de ElevenLabs y dura hasta que la persona cuelga (o nadie habla y no
   * contesta el «¿sigues ahí?»). Fuera de la llamada no hay sesión ni escucha para despertar: la mesa
   * tiene su oído de siempre. El ciclo decide; aquí se ejecutan sus efectos.
   */
  const cic = useRef<CicloLlamada | null>(null);
  if (!cic.current) cic.current = new CicloLlamada({ idioma: () => control.vista().idioma });
  const ciclo = cic.current;
  // La conversación con AURA o su llamada, vivas: la OTA no recarga encima (lib/barreraOta.ts).
  useEffect(() => registrarTrabajoActivo('conversacion-aura', () => control.vista().montada || llamadaActiva(ciclo.estado())), [control, ciclo]);
  const estadoCiclo = useSyncExternalStore(
    useCallback((f: () => void) => ciclo.suscribir(f), [ciclo]),
    () => ciclo.estado(),
    () => ciclo.estado()
  );
  const [minimizada, setMinimizada] = useState(false);
  const [altavoz, setAltavoz] = useState(true);
  /** Minutos de llamada de hoy (lo guardado del día + lo de este ciclo). */
  const [usadoHoyMs, setUsadoHoyMs] = useState(0);
  const [llamadaLista, setLlamadaLista] = useState(true);
  const baseHoy = useRef({ dia: '', ms: 0, ciclo0: 0 });
  /** Lo que dice la mesa cuando la llamada no está (sin minutos, no conectó): con su voz, breve. */
  const decirConLaMesa = useCallback((texto: string) => {
    if (vozSuspendida()) return;
    void speak(texto, { privado: true, onAudioStart: () => pauseMicForTts(true), onEnd: () => pauseMicForTts(false) });
  }, []);
  const recordatorioDe = (o: OrigenLlamada): LlamadaRecordatorio | null =>
    o.tipo === 'recordatorio' ? { base: o.base, texto: o.texto, cuando: o.cuando, paso: o.paso, dueno: o.dueno } : null;
  const ejecutar = useCallback(
    (efectos: EfectoCiclo[]) => {
      for (const ef of efectos) {
        switch (ef.tipo) {
          case 'timbre':
            if (ef.on) {
              // Suena: la mesa se calla, el permiso de la sesión se deja listo (contestar = solo conectar).
              void stopSpeaking();
              setMinimizada(false);
              void sonarTimbre();
              precalentarRef.current();
              miga('llamada del avatar: suena');
            } else callarTimbre();
            break;
          case 'abrir':
            setMinimizada(false);
            setAltavoz(true);
            control.iniciar();
            break;
          case 'cerrar':
            // Con el registro de toda la llamada: si se cortó sola, en el servidor se ve por qué.
            reportarEstado(`llamada del avatar: cuelga (${ef.motivo})`);
            // Lo que esperaba reintentarse en esta llamada ya no sale (AUR10: cero timers de la llamada al colgar).
            for (const cancelar of reintentos.current.splice(0)) cancelar();
            control.terminar();
            // Y otra vez a los 5 s: si el oído de la mesa no volvió a tomar el micrófono, se ve en el
            // servidor (1-oct: «el micrófono dejó de escuchar» después de una llamada que falló).
            setTimeout(() => reportarEstado('5 s después de colgar'), 5_000);
            break;
          case 'silenciar':
            control.silenciar(ef.valor);
            break;
          case 'primerMensaje':
          case 'decirEnLlamada':
          case 'sigues': {
            const texto = ef.tipo === 'sigues' ? MENSAJE_SIGUES : ef.texto;
            // Recién conectada, el control puede tardar un instante: se reintenta una vez, y SOLO en esta
            // misma sesión (AUR10: si en medio se colgó y se abrió otra, el texto viejo no entra en la nueva).
            const gen = control.vista().gen;
            const cancelar = mandarAlAgente(texto, {
              enviar: (t) => !!controles.current?.enviarTexto(t),
              vigente: () => control.vista().gen === gen && control.vista().montada,
              esperar: (f, ms) => {
                const t = setTimeout(f, ms);
                return () => clearTimeout(t);
              },
              alFallar: (t) => {
                miga(`llamada del avatar: no se pudo mandar ${t.slice(0, 20)}`);
                const rec = /^\[\[recordatorio\]\]\s*(.+)$/.exec(t);
                if (rec) decirConLaMesa(tr(`Te llamo para recordarte: ${rec[1]}`, `I'm calling to remind you: ${rec[1]}`));
              },
            });
            reintentos.current.push(cancelar);
            if (reintentos.current.length > 8) reintentos.current.shift();
            break;
          }
          case 'avisoTope':
            miga(`llamada del avatar: quedan ${Math.round(ef.restanteMs / 1000)} s de voz hoy`);
            controles.current?.avisar(avisoMinutos(ef.restanteMs, control.vista().idioma));
            break;
          case 'contestada': {
            const l = recordatorioDe(ef.origen);
            if (l) void contestadaEnPantalla(l);
            miga(`llamada del avatar: contestada (${ef.origen.tipo})`);
            break;
          }
          case 'rechazada': {
            const l = recordatorioDe(ef.origen);
            if (l) void rechazarRecordatorio(l);
            miga(`llamada del avatar: rechazada (${ef.origen.tipo})`);
            break;
          }
          case 'perdida':
            if (ef.origen.tipo === 'recordatorio') perdidaEnPantalla();
            miga(`llamada del avatar: perdida (${ef.origen.tipo})`);
            break;
          case 'alNativo':
            miga(`llamada del avatar: la dice la mesa (${ef.motivo.slice(0, 60)})`);
            if (ef.texto) decirConLaMesa(tr(`Te llamo para recordarte: ${ef.texto}`, `I'm calling to remind you: ${ef.texto}`));
            else if (ef.motivo === 'tope') decirConLaMesa(tr('Hoy ya no te quedan minutos de llamada. Sigo escuchándote por aquí.', 'You have no call minutes left today. I’m still listening here.'));
            // Si no conectó, el porqué lo dice la mesa (DeskScreen: motivoFalloVoz), una sola vez.
            break;
        }
      }
    },
    [control, decirConLaMesa]
  );
  // Los minutos de hoy.
  useEffect(() => {
    let vivo = true;
    const dia = diaHonduras();
    void loadVozHoy(dia).then((ms) => {
      if (!vivo) return;
      baseHoy.current = { dia, ms, ciclo0: ciclo.usadoMs() };
      setUsadoHoyMs(ms);
    });
    return () => {
      vivo = false;
    };
  }, [ciclo]);
  // Lo que pasa en la sesión, contado al ciclo: conectó, habla, falló, se cerró.
  useEffect(() => {
    let antes = control.vista();
    return control.suscribir((v) => {
      const a = antes;
      antes = v;
      const ef: EfectoCiclo[] = [];
      if (v.montada && v.estado === 'conectando' && (!a.montada || a.gen !== v.gen)) ef.push(...ciclo.sesionAbriendo());
      if (v.montada && (v.estado === 'escuchando' || v.estado === 'hablando') && a.estado === 'conectando') ef.push(...ciclo.conectado());
      if (v.estado === 'hablando' && a.estado !== 'hablando') ef.push(...ciclo.agente(true));
      if (a.estado === 'hablando' && v.estado !== 'hablando') ef.push(...ciclo.agente(false));
      if (!v.montada && v.estado === 'error' && (a.montada || a.estado !== 'error')) ef.push(...ciclo.fallo(v.detalle));
      else if (a.montada && !v.montada) ef.push(...ciclo.cerrada(v.suspendida ? 'otra_llamada' : a.silenciada ? 'silencio' : 'cortada'));
      ejecutar(ef);
    });
  }, [control, ciclo, ejecutar]);
  // El reloj del ciclo (no contestó, «¿sigues ahí?», colgar por silencio, minutos) y los minutos de hoy.
  useEffect(() => {
    const t = setInterval(() => {
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
  // Fuera de la llamada, la píldora no tiene sentido: la próxima empieza grande.
  useEffect(() => {
    if (estadoCiclo === 'reposo') setMinimizada(false);
    if (estadoCiclo === 'reposo' || estadoCiclo === 'colgada' || estadoCiclo === 'perdida' || estadoCiclo === 'rechazada') callarTimbre();
  }, [estadoCiclo]);
  const precalentarRef = useRef(precalentar);
  precalentarRef.current = precalentar;

  /** «Llámame» (la mesa, la hoja «Más», el atajo, la orden del servidor): suena la llamada del avatar. */
  /** «Hablar» de la mesa: la conversación se abre ya, sin sonar (ciclo.hablarYa). */
  const hablarYa = useCallback((): boolean => {
    if (control.vista().suspendida) {
      miga('hablar: hay otra llamada, no se abre');
      return false;
    }
    // La mesa se calla: desde aquí habla la conversación.
    void stopSpeaking();
    const ef = ciclo.hablarYa();
    ejecutar(ef);
    miga('hablar: conversación al instante');
    return ef.some((e) => e.tipo === 'abrir');
  }, [control, ciclo, ejecutar]);
  // «Llámame» dicho en la mesa también abre al instante: suena solo lo que tiene hora (un recordatorio).
  const llamame = hablarYa;
  const llamameRef = useRef(llamame);
  llamameRef.current = llamame;

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
      if (r === 'sin-muestras') {
        miga('voz: el micrófono dejó de mandar audio a media llamada; reconecto');
        reportarEstado('voz: micrófono congelado en la llamada (reconecta)');
      } else if (r !== 'nada') miga(`voz: ${r === 'sorda' ? 'abierta pero sin audio del micrófono' : 'no conectó a tiempo'}; el audio vuelve al oído del teléfono`);
    }, 1_000);
    /*
     * Segundo plano de verdad, no un parpadeo. En Android, cualquier ventana del sistema por encima (el
     * diálogo de un permiso, aunque ya esté dado y se cierre solo) pausa la app, y React Native lo da como
     * `background` durante unos milisegundos. 1-oct: poner un recordatorio pide el permiso de avisos y eso
     * colgaba la llamada justo cuando AURA decía «Listo, te llamo a las 7:45». Se cuelga solo si sigue
     * detrás pasado SEGUNDO_PLANO_MS.
     */
    let detras: ReturnType<typeof setTimeout> | null = null;
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        if (detras) {
          clearTimeout(detras);
          detras = null;
          miga('voz: volvió del segundo plano a tiempo; la llamada sigue');
          return;
        }
        precalentarCerebro();
        puenteRef.current?.arrancar();
      } else if (st === 'background' && !detras) {
        detras = setTimeout(() => {
          detras = null;
          if (AppState.currentState === 'active') return;
          miga('voz: segundo plano, la llamada del avatar se cuelga');
          ejecutar(ciclo.apagar());
          control.segundoPlano();
          // Sin SSE en segundo plano (batería, datos): al volver se reconecta con Last-Event-ID.
          puenteRef.current?.parar();
        }, SEGUNDO_PLANO_MS);
      }
    });
    const offPerfil = escuchar('perfil', (p) => {
      control.perfil(p.avatar, p.idioma);
    });
    const offAccion = escuchar('accion', (a) => {
      // «Llámame» que resolvió el servidor (el camino rápido o el cerebro): la conversación se abre ya.
      if (a.tipo === 'llamame') {
        const ok = llamameRef.current();
        emitir('hecho', { accion: a, ok, ...(ok ? {} : { detalle: tr('Ahora no puedo llamarte: hay otra llamada.', "I can't call you right now: there's another call.") }) });
        return;
      }
      // AUR10: los controles separados, cada uno con su efecto (compa/controles.ts). Detener el audio no
      // silencia el micrófono ni cancela la tarea; colgar no toca la tarea; cancelar la tarea no cuelga.
      if (a.tipo === 'detener_audio' || a.tipo === 'colgar' || a.tipo === 'tarea') {
        const enLlamada = () => llamadaActiva(ciclo.estado()) || control.vista().montada;
        const puertos = puertosTelefono({
          pararVozMesa: () => stopSpeaking(),
          cerrarBoca: () => senalVoz.cortar(),
          soltarPausaMicrofono: () => pauseMicForTts(false),
          enLlamada,
          // P2: lo que la conversación está diciendo se calla también (sin colgar); sin sesión montada no suena nada de ella.
          callarLlamada: () => controles.current?.callarSalida() ?? { ok: true },
          colgar: () => {
            const e = ciclo.estado();
            const ef = e === 'sonando' ? ciclo.rechazar() : ciclo.colgar();
            if (!ef.length) return { ok: false, detalle: tr('No hay ninguna llamada que colgar.', 'There is no call to hang up.') };
            ejecutar(ef);
            return { ok: true };
          },
          api: (ruta, init, ms) => api(ruta, init, ms),
        });
        void aplicarAccionControl(a, puertos).then((r) => {
          miga(`voz: control ${a.tipo}${a.tipo === 'tarea' ? `/${a.que}` : ''} → ${r.ok ? 'hecho' : `no (${String(r.detalle || '').slice(0, 60)})`}`);
          emitir('hecho', { accion: a, ok: r.ok, ...(r.detalle ? { detalle: r.detalle } : {}) });
        });
        return;
      }
      if (a.tipo !== 'silencio') return;
      // En la llamada, «cállate» / «ya puedes hablar» es el mismo interruptor que el doble toque.
      const e = ciclo.estado();
      if (e === 'en_llamada' || e === 'silenciado') {
        const cambia = a.valor ? e === 'en_llamada' : e === 'silenciado';
        if (cambia) ejecutar(ciclo.dobleToque());
        emitir('hecho', { accion: a, ok: cambia, ...(cambia ? {} : { detalle: a.valor ? 'Ya estaba en silencio.' : 'Ya estaba escuchando.' }) });
        return;
      }
      const r = control.aplicarSilencio(a.valor);
      emitir('hecho', { accion: a, ok: r.ok, ...(r.detalle ? { detalle: r.detalle } : {}) });
    });
    // Entrar a los chats (o a cualquier otra pantalla) con la llamada viva la hace pequeña: sigue oyendo.
    const offPantalla = escuchar('pantalla', (p) => {
      if (p.pantalla !== 'mesa' && llamadaActiva(ciclo.estado()) && ciclo.estado() !== 'sonando') setMinimizada(true);
    });
    // Un recordatorio que llama: suena en la app (notifee lo avisó con la app delante o la abrió). Solo
    // el de quien está dentro (recordatoriosNativo ya filtra por dueño).
    const origenDe = (l: LlamadaRecordatorio): OrigenLlamada => ({ tipo: 'recordatorio', texto: l.texto, base: l.base, paso: l.paso, cuando: l.cuando, dueno: l.dueno });
    const alSonar = () => {
      const l = llamadaSonando();
      if (!l) return;
      ejecutar(ciclo.llamar(origenDe(l)));
      // Con la app delante suena la pantalla del avatar: el aviso de notifee se calla (un solo timbre).
      if (ciclo.estado() === 'sonando' && AppState.currentState === 'active') void callarAvisoQueSuena(l);
    };
    const offSonando = escucharSonando(alSonar);
    alSonar();
    // Contestó desde el aviso (la app estaba cerrada o detrás): la llamada se abre directo. Lo que quedó
    // guardado antes de montarse la voz (la app se abrió por el toque) se atiende ahora.
    const alContestarAviso = () => {
      const l = tomarPorDecir();
      if (!l) return;
      const o = ciclo.origen();
      if (!(ciclo.estado() === 'sonando' && o?.tipo === 'recordatorio' && o.base === l.base)) ejecutar(ciclo.llamar(origenDe(l)));
      ejecutar(ciclo.contestar());
    };
    const offRecordatorio = escucharPorDecir(alContestarAviso);
    alContestarAviso();
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
      if (detras) clearTimeout(detras);
      app.remove();
      offPerfil();
      offAccion();
      offLectura();
      offRecordatorio();
      offSonando();
      offPantalla();
      offLlamada();
    };
  }, [control, ciclo, ejecutar]);

  /*
   * El permiso de la conversación (y con él el cerebro del nodo, server.ts calentarCerebro) se
   * precalienta SOLO cuando suena la llamada del avatar (el efecto `timbre`): toda conversación empieza
   * sonando, y la persona tarda más en contestar que el permiso en llegar. Antes también al montarse,
   * al volver a la app, al cambiar de avatar o idioma y al tocar a la compañera: ~8 s de GPU sin llamada.
   */

  // El puente de acciones y el contexto: viven mientras viva la app (sin sesión, esperan).
  const contexto = useRef<ContextoApp | null>(null);
  useEffect(() => {
    const puente = new PuenteAcciones({
      base: API_BASE,
      token: async () => (await loadMesaToken().catch(() => '')) || null,
      xhr: () => new XMLHttpRequest() as unknown as XhrMin,
      alAccion: (a) => emitir('accion', a),
      // El sonido de fondo de la conversación (event: ambiente): se pone o se quita aquí mismo.
      alAmbiente: (a) => {
        emitir('ambiente', a);
        ambiente.alEvento(a);
      },
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
  }, [precalentador, ambiente]);
  // El sonido de fondo se va si la conversación se cierra, se silencia, llega una llamada o la app se va
  // atrás (y al desmontarse la voz).
  useEffect(() => {
    if (!(vista.montada && !vista.silenciada && !vista.suspendida && (vista.estado === 'escuchando' || vista.estado === 'hablando'))) ambiente.parar('conversación');
  }, [ambiente, vista.montada, vista.silenciada, vista.suspendida, vista.estado]);
  // Mientras la voz del avatar suena, el sonido de trabajo calla debajo; vuelve al callar si la tarea sigue.
  useEffect(() => {
    ambiente.alHablar(vista.montada && vista.estado === 'hablando');
  }, [ambiente, vista.montada, vista.estado]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (e) => {
      if (e !== 'active') ambiente.parar('detrás');
    });
    // Los sonidos de trabajo apagados (Ajustes o el servidor, lib/ambienteAjuste.ts): el que suena se va al momento.
    void leerAmbiente();
    const quitar = suscribirAmbiente(() => !ambienteActivo() && ambiente.parar('apagados'));
    return () => {
      sub.remove();
      quitar();
      ambiente.parar('fin');
    };
  }, [ambiente]);
  // Un solo dueño del audio (compa/duenoAudio.ts): al abrirse la conversación en vivo, venga de donde
  // venga (la mesa, la compañera, el panel), la voz de la mesa se calla. Nunca dos voces a la vez.
  useEffect(() => {
    if (vista.montada) void stopSpeaking();
  }, [vista.montada, vista.gen]);
  // Y mientras dure no vuelve a sonar: ni el resto de un turno que venía en camino ni un saludo, una
  // reacción o algo pedido desde el menú (lib/tts.ts, callarPorConversacion). Al colgar, o al fallar,
  // la mesa vuelve a tener voz antes de decir por qué no conectó.
  useEffect(() => {
    const off = seguirVozMesa(ciclo, control, callarPorConversacion);
    return () => {
      off();
      callarPorConversacion(false);
    };
  }, [ciclo, control]);
  const conversando = vista.montada && (vista.estado === 'escuchando' || vista.estado === 'hablando');
  useEffect(() => {
    contexto.current?.fijarConversando(conversando);
  }, [conversando]);

  // Lo que avisa la sesión montada (lo de una generación vieja lo descarta el control).
  const alEstado = useCallback((gen: number, e: EstadoVoz, detalle?: string) => control.alEstado(gen, e, detalle), [control]);
  const alMensaje = useCallback(
    (gen: number, rol: 'usuario' | 'ultron', texto: string) => {
      // A4: de otra generación, o de una sesión que ya terminó (desmontada), no cuenta.
      if (gen !== control.vista().gen || !control.vista().montada) return;
      const limpio = quitarExpresiones(texto).trim();
      if (!limpio) return;
      if (rol === 'usuario') {
        control.oyoFrase();
        ejecutar(ciclo.turnoUsuario(limpio));
        ambiente.parar('persona');
      } else {
        // Contestó: ya no piensa (aunque el «speaking» no llegue, p. ej. silenciada).
        control.respondio();
        ambiente.alHablaAvatar(texto);
      }
      mensajeVoz.emitir({ rol, texto: limpio, emocion: rol === 'ultron' ? emocionDeTexto(texto) : 'neutral', en: Date.now() });
    },
    [control, ciclo, ejecutar, ambiente]
  );
  const alInterrupcion = useCallback(
    (gen: number) => {
      if (gen !== control.vista().gen || !control.vista().montada) return;
      interrupcionVoz.emitir(interrupcionVoz.ultimo() + 1);
      senalVoz.cortar();
    },
    [control]
  );
  const alNiveles = useCallback(
    (salida: number, entrada: number, cruda?: number, gen?: number) => {
      // AUR10: lo de una sesión vieja (su reloj que todavía late) no mueve la boca, el anillo ni la vigilancia.
      if (gen !== undefined && gen !== control.vista().gen) return;
      // Terminada, solo cuenta el «a cero» (cierra la boca y apaga el anillo); nada más mueve la boca.
      if (gen !== undefined && !control.vista().montada && (salida > 0 || entrada > 0)) return;
      nivelExterno(salida);
      nivelOido.emitir(entrada);
      control.entrada(entrada, cruda, gen);
    },
    [control]
  );
  const alAudio = useCallback((gen: number, que: 'toma' | 'suelta' | 'cerrando') => {
    if (que === 'toma') audioVoz.tomar(gen);
    else if (que === 'suelta') audioVoz.soltar(gen);
    else audioVoz.cerrando(gen);
  }, []);
  const alFin = useCallback((_gen: number, pase: string) => avisarCierre(pase), []);
  const alVincular = useCallback((_gen: number, pase: string, conversacion: string) => vincularMotor(pase, conversacion), []);
  const alPermiso = useCallback((gen: number) => control.permisoListo(gen), [control]);
  const permiso = useCallback(async () => {
    const v = control.vista();
    const p = await precalentador.tomar(v.avatar, v.idioma, v.intento > 0);
    // Los minutos que le quedan hoy (miembros): el ciclo avisa antes de agotarlos. Un permiso que vuelve
    // cuando su sesión ya no es la vigente no fija nada (AUR10: lo tardío no toca la llamada de ahora).
    if (control.vista().gen === v.gen) ciclo.fijarTope(typeof p.restanteMs === 'number' ? p.restanteMs : null);
    return p;
  }, [control, precalentador, ciclo]);

  const nombreLlamada = de(avatarPorId(vista.avatar).nombre);
  /** Altavoz o auricular (audífonos si hay), como en una llamada de PULSE2CHAT (pulse/llamada.ts). */
  const cambiarAltavoz = useCallback(async (on: boolean) => {
    setAltavoz(on);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AudioSession } = require('@livekit/react-native') as typeof import('@livekit/react-native');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { salidaSinAltavoz } = require('../pulse/llamada') as typeof import('../pulse/llamada');
      if (Platform.OS === 'ios') await AudioSession.selectAudioOutput(on ? 'force_speaker' : 'default');
      else await AudioSession.selectAudioOutput(on ? 'speaker' : await salidaSinAltavoz());
    } catch (e) {
      miga(`llamada del avatar: no pude cambiar la salida (${String(e instanceof Error ? e.message : e).slice(0, 60)})`);
    }
  }, []);
  // Al conectar, por el altavoz (el avatar se mira de frente); el botón lo pasa al auricular.
  useEffect(() => {
    if (estadoCiclo === 'en_llamada' && ciclo.conectadaEn() && Date.now() - ciclo.conectadaEn() < 1500) void cambiarAltavoz(true);
  }, [estadoCiclo, ciclo, cambiarAltavoz]);
  const valor = useMemo<ApiVoz>(() => {
    const enLlamada = () => ciclo.estado() === 'en_llamada' || ciclo.estado() === 'silenciado';
    const colgar = () => ejecutar(ciclo.colgar());
    return {
      vista,
      llamada: { estado: estadoCiclo, origen: ciclo.origen(), motivo: ciclo.motivo(), conectadaEn: ciclo.conectadaEn(), minimizada, altavoz },
      llamame,
      contestar: () => ejecutar(ciclo.contestar()),
      rechazar: () => ejecutar(ciclo.rechazar()),
      colgar,
      minimizar: (si) => setMinimizada(si && llamadaActiva(ciclo.estado())),
      iniciar: llamame,
      terminar: colgar,
      // «Hablar»: abre la conversación al instante (sin timbre). En llamada, cuelga; sonando, rechaza.
      alternar: () => (llamadaActiva(ciclo.estado()) ? (ciclo.estado() === 'sonando' ? ejecutar(ciclo.rechazar()) : colgar()) : void hablarYa()),
      silenciar: (v) => {
        const e = ciclo.estado();
        if (v ? e === 'en_llamada' : e === 'silenciado') ejecutar(ciclo.dobleToque());
      },
      despertarOSilenciar: () => {
        if (!enLlamada()) return 'nada';
        ejecutar(ciclo.dobleToque());
        return ciclo.estado() === 'silenciado' ? 'duerme' : 'despierta';
      },
      ciclo: estadoCiclo,
      usadoHoyMs,
      nombreLlamada,
      llamadaLista,
      precalentar,
      fijarAvatar: (id) => {
        control.perfil(id, control.vista().idioma);
      },
      enviarTexto: (t) => !!controles.current?.enviarTexto(t),
      avisarAgente: (t) => !!controles.current?.avisar(t),
      actividad: () => controles.current?.actividad(),
      confirmar: (ok, texto) => {
        if (controles.current?.avisar(`[app] ${ok ? 'Hecho' : 'No se pudo'}: ${texto}`)) return;
        // Sin llamada: con la voz de la mesa, solo si nadie está hablando y no suena nada.
        const v = control.vista();
        if (v.suspendida || v.silenciada || v.dormida || vozSuspendida() || ecoMesa.ultimo().hablando || llamadaActiva(ciclo.estado())) return;
        void speak(texto, { onAudioStart: () => pauseMicForTts(true), onEnd: () => pauseMicForTts(false) });
      },
    };
  }, [vista, control, precalentar, estadoCiclo, ciclo, ejecutar, usadoHoyMs, nombreLlamada, llamadaLista, minimizada, altavoz, llamame, hablarYa]);

  // Llamada minimizada: la app baja lo que ocupa la píldora (las pantallas leen el borde de arriba
  // con useSafeAreaInsets). Fuera de un SafeAreaProvider se usan los bordes de la ventana.
  const bordesApp = useContext(SafeAreaInsetsContext);
  const bordesConPildora = useMemo(() => {
    const b = bordesApp || initialWindowMetrics?.insets || { top: 0, bottom: 0, left: 0, right: 0 };
    return minimizada ? { ...b, top: b.top + ALTO_PILDORA } : b;
  }, [bordesApp, minimizada]);

  // Colgó la llamada del avatar: mientras se ve «Llamada terminada», Claudio y ANT-ONIO en video se despiden.
  useEffect(() => {
    if (estadoCiclo === 'colgada') pedirGolpe('despide');
  }, [estadoCiclo]);

  return (
    <VozCtx.Provider value={valor}>
      <SafeAreaInsetsContext.Provider value={bordesConPildora}>{children}</SafeAreaInsetsContext.Provider>
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
          onPermiso={alPermiso}
          onVincular={alVincular}
          controles={controles}
        />
      ) : null}
      {conCompanera ? <CompaneraSegura /> : null}
      <LlamadaAvatar
        v={{ ...valor.llamada, avatar: vista.avatar, idioma: vista.idioma }}
        onContestar={valor.contestar}
        onRechazar={valor.rechazar}
        onColgar={valor.colgar}
        onSilenciar={() => ejecutar(ciclo.dobleToque())}
        onAltavoz={() => void cambiarAltavoz(!altavoz)}
        onMinimizar={valor.minimizar}
        nivelVoz={escucharNivelVoz}
        cuerpo3D={cuerpo3DLlamada(vista.avatar)}
      />
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

/*
 * La cara 3D de la llamada (avatar3d/CuerpoLlamada), cargada como la compañera: si el módulo nativo no
 * está o el 3D revienta al dibujar, la llamada sigue con la foto o los anillos (su respaldo 2D).
 */
let moduloCuerpoLlamada: typeof import('../avatar3d/CuerpoLlamada') | null | undefined;
class LimiteCuerpo extends Component<{ children: ReactNode; respaldo: ReactNode }, { roto: boolean }> {
  state = { roto: false };
  static getDerivedStateFromError() {
    return { roto: true };
  }
  componentDidCatch(e: unknown) {
    miga(`llamada del avatar: el 3D se apagó (${String(e instanceof Error ? e.message : e).slice(0, 80)})`);
  }
  render() {
    return this.state.roto ? this.props.respaldo : this.props.children;
  }
}
function cuerpo3DLlamada(avatar: AvatarId): ((lado: number, respaldo: ReactNode) => ReactNode) | undefined {
  // AU-RA: su orbe (el MiniAvatar de la llamada ya lo es, y late con su voz); nada de robot 3D encima.
  if (avatar === 'aura') return undefined;
  if (moduloCuerpoLlamada === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      moduloCuerpoLlamada = require('../avatar3d/CuerpoLlamada') as typeof import('../avatar3d/CuerpoLlamada');
    } catch (e) {
      moduloCuerpoLlamada = null;
      miga(`llamada del avatar: sin 3D (${String(e instanceof Error ? e.message : e).slice(0, 80)})`);
    }
  }
  const C = moduloCuerpoLlamada?.CuerpoLlamada;
  if (!C) return undefined;
  return (lado, respaldo) => (
    <LimiteCuerpo respaldo={respaldo}>
      <C avatar={avatar} lado={lado} respaldo={respaldo} />
    </LimiteCuerpo>
  );
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
