/**
 * LA BURBUJA DE AURA: lo que sale ENCIMA de cualquier app al mantener el botón lateral (o desde el mosaico de Ajustes
 * rápidos, el atajo del ícono, ASSIST o el botón del manos libres). José, 10-oct, con una foto de ChatGPT como
 * asistente en su S26: la pantalla de atrás se queda, oscurecida; el orbe grande abajo al centro; tocar fuera o «atrás»
 * la cierra.
 *
 * Se dibuja en BurbujaActivity (translúcida, plugins/asistente-digital.js) con el mismo motor de JS que la app: App.tsx
 * ve `modo: 'burbuja'` en las props de arranque y monta esto en vez de la app. Por eso todo lo de aquí se ajusta por
 * OTA, y por eso es la MISMA AURA:
 *
 *  · escucha en el acto con el oído de la mesa (lib/speech.ts, prestado: `prestarOido`; si la app está abierta detrás,
 *    su mesa suelta el micrófono mientras la burbuja está abierta — compa/duenoAudio.ts, dueño «burbuja» — y lo vuelve a
 *    tomar al cerrarse, como lo tenía: abierto si lo tenía abierto, silenciado si la persona lo silenció);
 *  · pregunta al mismo cerebro, con la misma cuenta y el mismo hilo (burbuja/turnoBurbuja.ts) y le deja a la mesa lo que
 *    habló (burbuja/logica.ts `hiloCompartido`);
 *  · «Abrir en AURA» abre la app entera en la mesa, escuchando, con lo hablado ya en el hilo (ultronfp://hablar); si el
 *    turno pidió algo que se revisa (acciones, tareas), «Abrir revisión»: la burbuja no mueve la app de atrás sin verse;
 *  · se cierra sola tras 30 s sin nada (suelta el micrófono), y al dejar de verse (el nativo la termina en onStop).
 *  · Con el teléfono bloqueado no sale nada privado: BurbujaActivity no tiene showWhenLocked (Android pide desbloquear
 *    antes de enseñarla).
 *
 * El diseño (José, 10-oct: «mira el círculo de asistente, necesitamos mejorar eso, se vea mejor»; y la revisión F06/§9):
 *  · el orbe de partículas de la mesa ENTERO y centrado en su círculo (burbuja/OrbeBurbuja.tsx), ~46 % del ancho, que
 *    vive con el estado real y con la emoción del turno (orbe/expresiones.ts);
 *  · velo degradado desde abajo (legible sobre cualquier app) y cada texto con su propio fondo: la línea de estado en su
 *    píldora, la transcripción en su tarjeta (lo que dijiste y, con subtítulos, lo que dice AURA);
 *  · controles grandes (56 dp, con su palabra debajo y su etiqueta para el lector de pantalla): escribir, cámara,
 *    micrófono (dice la verdad: encendido solo si captura) y detener (corta la voz y el turno; se mide hasta el silencio);
 *  · estados con palabra corta (burbuja/sesionBurbuja.ts `faseBurbuja`): nada se dice solo con color ni movimiento;
 *  · mientras piensa y habla NO oye (pausa el micrófono; sin hablarle encima por ahora) y lo dice;
 *  · letra grande del sistema, «reducir movimiento» y contraste;
 *  · una segunda pulsación del botón corta el turno y la voz y vuelve a escuchar (un solo oído, una sola voz, un solo
 *    pedido: `SesionBurbuja`), y lo que llegue tarde del turno cortado se tira;
 *  · marcas de tiempo por sesión y por turno (`[traza-burbuja] …` en las migas) para sacar p50/p95.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Image, Keyboard, Linking, PixelRatio, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, Animated } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { OrbeBurbuja, type EstadoOrbeBurbuja } from './OrbeBurbuja';
import { senalVoz } from '../avatar3d/senalVoz';
import { vozSonando } from '../avatar3d/sonando';
import { nivelOido } from '../compa/canales';
import { fijarUsuario, usuarioActual } from '../app/sesion';
import { Icono, type NombreIcono } from '../ui/Icono';
import { fijarIdioma, tr, useIdioma } from '../i18n';
import type { SessionUser } from '../config';
import { prepararVoz } from '../lib/guardiaVoz';
import { iniciarReporte, miga } from '../lib/reporte';
import { loadLongMemory, loadSession, loadSettings } from '../lib/storage';
import { escucharNivelVoz, setAvatarVoz, stopSpeaking, vozDeConversacion } from '../lib/tts';
import { emocionDeTexto } from '../lib/emocion';
import {
  currentSttEngine,
  destroySpeech,
  enableAlwaysOnMic,
  ensureSpeechPermissions,
  isMicPaused,
  muteMic,
  oidoEscuchando,
  oidoSuspendido,
  pauseMicForTts,
  prestarOido,
  reabrirMic,
  setSttEngine,
  type SttEngine,
} from '../lib/speech';
import { buzonHablar, enlaceHablar, GuardiaInvocacion, guardiaHablar, leerEnlace, lineaEntrada, momentoInvocacion, type OrigenEntrada } from '../entrada/enlace';
import { medirHastaEscuchar } from '../entrada/hablar';
import { burbujaAbierta, ControlCierre, debeCerrarPorSilencio, hiloCompartido, preguntaDeFoto, sinConversacion, textoEstado, VueltaDeLaApp, type MotivoCierre } from './logica';
import { faseBurbuja, hayQueDetener, indicadorMic, lineaDetener, margenTeclado, relojMonotono, SesionBurbuja, TrazaBurbuja, type EstadoSesion, type MotivoCorte } from './sesionBurbuja';
import { medidasBurbuja } from './medidas';
import { expresionDeEmocion, nombreExpresion, type ExpresionOrbe } from '../orbe/expresiones';
import { turnoBurbuja } from './turnoBurbuja';
import { registrarTrabajoActivo } from '../lib/barreraOta';

// La paleta de la mesa: azul noche, texto marfil, acento dorado cálido (el núcleo del orbe).
const TEXTO = '#F1EEE8';
const TEXTO_SUAVE = 'rgba(241,238,232,0.78)';
const ACENTO = '#E8C98E';
const TINTA = '#141A2B';
const FONDO_PIEZA = '#0D1222';
const BORDE = 'rgba(170,200,255,0.20)';
const TONO = { activo: '#7FD8B4', trabajo: '#9FC4FF', aviso: '#F2B66D', apagado: 'rgba(241,238,232,0.45)' } as const;
/** Ni la letra más grande del sistema rompe la burbuja: crece hasta aquí. */
const MAX_LETRA = 1.8;
const CLAVE_SUBTITULOS = 'aura.burbuja.subtitulos';

type Props = { origen: OrigenEntrada; invocadaEn: number | null };

/** Sin conversación posible (sin sesión, o AURA en una llamada): solo se ofrece abrir la app. */
function sinSesionOLlamada(e: EstadoSesion): boolean {
  return e !== 'revision' && e !== 'reconectando' && e !== 'cerrada' && sinConversacion(e);
}

export function RaizBurbuja(props: Props) {
  return (
    <SafeAreaProvider style={{ backgroundColor: 'transparent' }}>
      <Burbuja {...props} />
    </SafeAreaProvider>
  );
}

// Con la burbuja abierta, la OTA no recarga el JS (lib/ota.ts «al volver»: la burbuja delante cuenta como volver).
registrarTrabajoActivo('burbuja', () => burbujaAbierta.abierta());

/**
 * El aviso «la burbuja está abierta» se suelta cuando la app vuelve a estar DELANTE DE VERDAD (la mesa toma el micrófono
 * si le toca): después de cerrarse la burbuja, un ciclo fondo → activa (burbuja/logica.ts `VueltaDeLaApp`); o en el acto
 * si la burbuja se desmonta con la app ya delante (`fondo`, revisión del 10-oct: la mesa quedaba en «Micrófono apagado»).
 * Solo la burbuja más nueva lo suelta: si una se termina tarde con otra ya abierta, no le quita el micrófono.
 */
const vuelta = new VueltaDeLaApp();
let esperandoVolver: { remove(): void } | null = null;
let aperturas = 0;
function dejarDeEsperarVuelta() {
  vuelta.cancelar();
  esperandoVolver?.remove();
  esperandoVolver = null;
}
function soltarAvisoBurbuja(motivo: MotivoCierre, apertura: number) {
  if (apertura !== aperturas) return;
  dejarDeEsperarVuelta();
  if (vuelta.empezar(AppState.currentState, motivo)) {
    miga('burbuja: la app ya está delante; la mesa recupera su micrófono');
    burbujaAbierta.fijar(false);
    return;
  }
  esperandoVolver = AppState.addEventListener('change', (s) => {
    if (!vuelta.cambio(s)) return;
    dejarDeEsperarVuelta();
    burbujaAbierta.fijar(false);
  });
}

function Burbuja({ origen, invocadaEn }: Props) {
  const idioma = useIdioma();
  const en = idioma === 'en';
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [estado, setEstadoUi] = useState<EstadoSesion>('arrancando');
  const [parcial, setParcial] = useState('');
  const [pregunta, setPregunta] = useState('');
  const [respuesta, setRespuesta] = useState('');
  const [escrito, setEscrito] = useState('');
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [expresion, setExpresion] = useState<{ nombre: ExpresionOrbe; n: number } | null>(null);
  const [micSilenciado, setMicSilenciado] = useState(false);
  const [capturando, setCapturando] = useState(false);
  const [subtitulos, setSubtitulos] = useState(true);
  const [teclado, setTeclado] = useState(0);
  const [permisoCamara, pedirPermisoCamara] = useCameraPermissions();
  const lente = useRef<CameraView | null>(null);

  const estadoRef = useRef<EstadoSesion>('arrancando');
  const usuario = useRef<SessionUser | null>(null);
  const memoria = useRef<string[]>([]);
  const motor = useRef<SttEngine | null>(null);
  const devolverOido = useRef<(() => void) | null>(null);
  const foto = useRef<string | null>(null);
  const micSilenciadoRef = useRef(false);
  /** Cerrada una vez (y abierta otra vez solo si «Abrir en AURA» no abrió la app). */
  const control = useRef(new ControlCierre()).current;
  /** Un solo turno vivo; lo de un turno cortado se tira. */
  const sesion = useRef(new SesionBurbuja()).current;
  const traza = useRef(new TrazaBurbuja({ invocadaEnPared: invocadaEn, ahoraPared: Date.now() })).current;
  const ultimaActividad = useRef(Date.now());
  const guardia = useRef(new GuardiaInvocacion()).current;
  /** Cada invocación (la primera y las de después con la burbuja abierta) mide la suya; una nueva corta la anterior. */
  const medida = useRef(0);
  const apertura = useRef(0);
  const altoSinTeclado = useRef(height);

  const setEstado = useCallback((e: EstadoSesion) => {
    estadoRef.current = e;
    setEstadoUi(e);
  }, []);
  const actividad = () => (ultimaActividad.current = Date.now());

  // Antes que nada (antes de que React avise «app activa»): el micrófono es de la burbuja, la mesa de atrás lo suelta.
  useLayoutEffect(() => {
    apertura.current = ++aperturas;
    dejarDeEsperarVuelta();
    burbujaAbierta.fijar(true);
  }, []);

  /* ── cortar lo que suena o piensa ─────────────────────────────────────────────────────────── */

  /**
   * Corta el turno vivo y la voz. Con `medir`, cuánto tardó de la orden al silencio efectivo (la voz dejó de sonar):
   * el dueño pide ~150 ms p50 / 300 ms p95 (`[traza-burbuja] … detener→silencio=…`).
   */
  const cortar = useCallback(
    (motivo: MotivoCorte, medir = false) => {
      const t0 = relojMonotono();
      const sonaba = vozSonando.ahora().sonando;
      if (sesion.cortar(motivo)) miga(traza.finTurno(`cortado=${motivo}`));
      const parar = stopSpeaking();
      if (!medir || !sonaba) return;
      void (async () => {
        await parar.catch(() => undefined);
        if (vozSonando.ahora().sonando) {
          await new Promise<void>((ok) => {
            const tope = setTimeout(listo, 2_000);
            const fuera = vozSonando.escuchar((v) => !v.sonando && listo());
            function listo() {
              clearTimeout(tope);
              fuera();
              ok();
            }
          });
        }
        miga(lineaDetener(traza.id, relojMonotono() - t0, motivo));
      })();
    },
    [sesion, traza]
  );

  /* ── cerrar ───────────────────────────────────────────────────────────────────────────────── */

  const cerrar = useCallback((motivo: MotivoCierre) => {
    const c = control.cerrar(motivo);
    if (!c) return;
    medida.current++;
    cortar('cierre');
    pauseMicForTts(false);
    // El micrófono se suelta YA. Con la mesa montada detrás se le devuelve su oído (ella lo reabre si le toca, como lo
    // tenía); sin mesa, se apaga el oído entero.
    const devolver = devolverOido.current;
    devolverOido.current = null;
    if (hiloCompartido.hayMesa()) {
      void muteMic();
      devolver?.();
    } else {
      devolver?.();
      void destroySpeech();
    }
    nivelOido.emitir(0);
    traza.marcar('cierre');
    miga(`burbuja: cerrada (${motivo})`);
    miga(traza.lineaSesion(`motivo=${motivo}`));
    estadoRef.current = 'cerrada';
    setEstadoUi('cerrada');
    soltarAvisoBurbuja(motivo, apertura.current);
    if (c.terminarActividad) BackHandler.exitApp();
  }, []);

  /* ── el oído ──────────────────────────────────────────────────────────────────────────────── */

  const enviarRef = useRef<(texto: string, escritoAMano?: boolean) => void>(() => undefined);

  /** Escucha (abre el micrófono si hace falta) y mide desde `desde` hasta que el oído escucha de verdad. */
  const escuchar = useCallback(
    async (o: string, desde: number) => {
      const yo = ++medida.current;
      const vigente = () => !control.cerrada() && medida.current === yo;
      const ok = await ensureSpeechPermissions();
      if (!vigente()) return;
      if (!ok) {
        setEstado('sin-permiso');
        miga(lineaEntrada(o as OrigenEntrada, desde, null, 'sin permiso del micrófono'));
        return;
      }
      if (!devolverOido.current) {
        // La app estaba abierta detrás: se espera el ACUSE de su mesa (ya soltó el micrófono, o no lo tenía) antes de
        // abrirlo aquí; con tope: una mesa colgada no deja sorda a la burbuja.
        const conMesa = hiloCompartido.hayMesa();
        if (conMesa) {
          if (!(await burbujaAbierta.esperarAcuse())) miga('burbuja: la mesa no acusó a tiempo que soltó el micrófono; se abre igual');
        } else if (motor.current && motor.current !== currentSttEngine()) await setSttEngine(motor.current);
        if (!vigente()) return;
        devolverOido.current = prestarOido({
          onSpeechStart: () => actividad(),
          onPartial: (t) => {
            actividad();
            if (estadoRef.current === 'escuchando') setParcial(t);
          },
          onLevel: (l) => nivelOido.emitir(l),
          onFinal: (t) => {
            actividad();
            setParcial('');
            if (estadoRef.current !== 'escuchando') return;
            traza.marcar('fin-voz');
            traza.marcar('captura-fin');
            enviarRef.current(t);
          },
          onError: () => {},
        });
        if (micSilenciadoRef.current) {
          /* la persona lo silenció en esta burbuja: no se abre */
        } else if (conMesa) await reabrirMic();
        else await enableAlwaysOnMic();
      } else if (!micSilenciadoRef.current && !oidoEscuchando()) await reabrirMic();
      if (!vigente()) return;
      pauseMicForTts(false);
      setEstado('escuchando');
      actividad();
      if (micSilenciadoRef.current) return;
      const escucho = await medirHastaEscuchar(o as OrigenEntrada, desde, { vigente });
      if (escucho) traza.marcar('captura-inicio');
      if (!escucho && vigente() && estadoRef.current === 'escuchando') setEstado('sin-oido');
    },
    [setEstado]
  );

  /* ── arrancar ─────────────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const recibida = Date.now();
    const desde = momentoInvocacion(invocadaEn, recibida);
    guardia.aceptar(desde);
    // La UI lista: el primer cuadro dibujado.
    requestAnimationFrame(() => traza.marcar('ui-lista'));
    // La boca de AURA en el orbe (senalVoz): lo conecta el VozProvider de la app; sin la app abierta, nadie.
    const fueraNivel = escucharNivelVoz((l) => senalVoz.nivel(l));
    void AsyncStorage.getItem(CLAVE_SUBTITULOS)
      .then((v) => v === '0' && setSubtitulos(false))
      .catch(() => undefined);
    void (async () => {
      await iniciarReporte();
      miga(`[entrada] origen=${origen}: burbuja (${recibida - desde} ms hasta React)`);
      const actual = usuarioActual();
      const [ajustes, sesionGuardada] = await Promise.all([loadSettings(), actual ? Promise.resolve(actual) : loadSession()]);
      if (control.cerrada()) return;
      fijarIdioma(ajustes.idioma);
      setAvatarVoz(ajustes.avatar);
      motor.current = ajustes.sttEngine;
      void prepararVoz();
      if (!sesionGuardada) {
        setEstado('sin-sesion');
        miga(lineaEntrada(origen, desde, null, 'sin sesión'));
        return;
      }
      if (!actual) fijarUsuario(sesionGuardada);
      usuario.current = sesionGuardada;
      void loadLongMemory(sesionGuardada)
        .then((m) => (memoria.current = m.map((f) => f.hecho)))
        .catch(() => undefined);
      // Una llamada de PULSE2CHAT o la conversación en vivo tienen el audio: no se les habla encima.
      if (oidoSuspendido() || vozDeConversacion()) {
        setEstado('ocupada');
        miga(lineaEntrada(origen, desde, null, 'AURA en llamada'));
        return;
      }
      await escuchar(origen, desde);
    })();

    // Otra invocación con la burbuja abierta (el botón otra vez, el mosaico): llega como enlace. Corta el turno y la voz
    // y vuelve a escuchar, con el MISMO oído (nunca dos reconocedores, dos voces ni dos pedidos).
    const sub = Linking.addEventListener('url', ({ url }) => {
      const e = leerEnlace(url);
      if (!e || e.destino !== 'burbuja' || control.cerrada()) return;
      const t = momentoInvocacion(e.invocadaEn, Date.now());
      if (!guardia.aceptar(t)) {
        miga(`[entrada] origen=${e.origen}: segunda invocación en menos de 1,5 s, ignorada`);
        return;
      }
      if (!usuario.current || sinSesionOLlamada(estadoRef.current)) return;
      cortar('reinvocacion', true);
      traza.reinvocar(e.invocadaEn, Date.now());
      setRespuesta('');
      setPregunta('');
      void escuchar(e.origen, t);
    });

    // Atrás: se cierra la burbuja (y solo ella; ver BurbujaActivity.invokeDefaultOnBackPressed).
    const atras = BackHandler.addEventListener('hardwareBackPress', () => {
      const e = estadoRef.current;
      if (e === 'escribiendo' || e === 'camara') {
        void volverAEscuchar();
        return true;
      }
      cerrar('atras');
      return true;
    });

    // Sin nada durante 30 s: se cierra y suelta el micrófono. «Esperando revisión» cuenta como un aviso.
    const reloj = setInterval(() => {
      const e = estadoRef.current;
      const comoLogica = e === 'revision' ? 'error' : e === 'reconectando' || e === 'cerrada' ? 'pensando' : e;
      if (debeCerrarPorSilencio({ estado: comoLogica, ultimaActividad: ultimaActividad.current, ahora: Date.now() })) cerrar('silencio');
    }, 2_000);

    // El indicador del micrófono dice lo que pasa DE VERDAD (captura ahora, sin pausa), no lo que se pidió.
    const ojoMic = setInterval(() => {
      const c = !!devolverOido.current && !micSilenciadoRef.current && oidoEscuchando() && !isMicPaused();
      setCapturando((v) => (v === c ? v : c));
    }, 350);

    // El teclado (escribir): con la app de borde a borde la ventana no se encoge; se sube el campo lo que haga falta.
    const kbSi = Keyboard.addListener('keyboardDidShow', (k) => setTeclado(k.endCoordinates.height));
    const kbNo = Keyboard.addListener('keyboardDidHide', () => setTeclado(0));

    return () => {
      fueraNivel();
      sub.remove();
      atras.remove();
      clearInterval(reloj);
      clearInterval(ojoMic);
      kbSi.remove();
      kbNo.remove();
      // Se desmonta (el nativo la terminó al dejar de verse): lo mismo que cerrarla, sin volver a terminarla.
      cerrar('fondo');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!teclado) altoSinTeclado.current = height;
  }, [height, teclado]);

  /* ── preguntar ────────────────────────────────────────────────────────────────────────────── */

  const enviar = useCallback(
    async (texto: string, escritoAMano = false) => {
      const u = usuario.current;
      if (!u || control.cerrada()) return;
      const imagen = foto.current;
      const q = imagen ? preguntaDeFoto(texto, en) : texto.trim();
      if (!q) return;
      foto.current = null;
      setFotoUri(null);
      actividad();
      setParcial('');
      setPregunta(q);
      setRespuesta('');
      setEstado('pensando');
      // Mientras piensa y habla no se oye (sin «hablarle encima» en la burbuja): se dice en la línea de estado.
      pauseMicForTts(true);
      const historial = hiloCompartido.historial(u.correo);
      hiloCompartido.anotar(u.correo, { rol: 'usuario', texto: q });
      traza.nuevoTurno();
      traza.marcar('peticion');
      let cancelarEste: () => void = () => undefined;
      const gen = sesion.empezarTurno(() => cancelarEste());
      const vale = () => sesion.vigente(gen) && !control.cerrada();
      let emocionTurno = false;
      const t = turnoBurbuja(
        { message: q, mode: 'GUARDIAN', userName: u.name, correo: u.correo, historial, memoria: memoria.current, ...(imagen ? { image: imagen } : {}), hablado: !escritoAMano },
        {
          alFrase: (f) => vale() && f && setRespuesta(f),
          alHablar: (on) => {
            if (!vale() || !on) return;
            traza.marcar('primer-audio');
            setEstado('hablando');
          },
          alEmocion: (e) => {
            if (!vale()) return;
            const ex = expresionDeEmocion(e);
            if (ex) {
              emocionTurno = true;
              setExpresion((p) => ({ nombre: ex, n: (p?.n ?? 0) + 1 }));
            }
          },
          alReconectar: () => vale() && estadoRef.current === 'pensando' && setEstado('reconectando'),
          alPrimerContenido: () => vale() && traza.marcar('primer-contenido'),
        }
      );
      cancelarEste = t.cancelar;
      const r = await t.promise;
      // Lo de un turno cortado (una segunda pulsación, «detener», escribir encima) no cuenta.
      if (!vale() || r.cortado) return;
      sesion.terminar(gen);
      miga(traza.finTurno(r.fallo ? `fallo=${r.fallo}` : ''));
      actividad();
      if (r.texto) {
        hiloCompartido.anotar(u.correo, { rol: 'ultron', texto: r.texto });
        setRespuesta(r.texto);
        // Sin emoción del servidor (o neutra): la del texto, si es clara.
        if (!emocionTurno) {
          const ex = expresionDeEmocion(emocionDeTexto(r.texto));
          if (ex) setExpresion((p) => ({ nombre: ex, n: (p?.n ?? 0) + 1 }));
        }
      } else if (r.fallo === 'sesion') {
        setRespuesta(tr('Tu sesión terminó. Abre AURA para entrar de nuevo.', 'Your session ended. Open AURA to sign in again.'));
      } else if (r.fallo === 'sin-red') {
        setRespuesta(tr('No tengo conexión ahora.', 'I have no connection right now.'));
      } else {
        setRespuesta(textoEstado('error', en));
      }
      if (r.revision) {
        // Lo que pidió hacer en la app se revisa en AURA: la burbuja no mueve la app de atrás sin que se vea.
        pauseMicForTts(false);
        setEstado('revision');
        return;
      }
      // Sigue la conversación: vuelve a escuchar.
      pauseMicForTts(false);
      setEstado('escuchando');
      if (devolverOido.current && !micSilenciadoRef.current && !oidoEscuchando()) void reabrirMic();
    },
    [en, setEstado]
  );
  enviarRef.current = (texto, escritoAMano) => void enviar(texto, escritoAMano);

  /* ── los controles ────────────────────────────────────────────────────────────────────────── */

  const volverAEscuchar = useCallback(async () => {
    actividad();
    if (!usuario.current || control.cerrada()) return;
    pauseMicForTts(false);
    setEstado('escuchando');
    if (devolverOido.current && !micSilenciadoRef.current && !oidoEscuchando()) void reabrirMic();
  }, [setEstado]);

  const detener = () => {
    actividad();
    if (!hayQueDetener(estadoRef.current)) return;
    cortar('detener', true);
    void volverAEscuchar();
  };

  const alternarMic = async () => {
    actividad();
    if (!usuario.current) return;
    if (!micSilenciadoRef.current) {
      micSilenciadoRef.current = true;
      setMicSilenciado(true);
      if (devolverOido.current) await muteMic();
      miga('burbuja: micrófono silenciado por la persona');
      return;
    }
    micSilenciadoRef.current = false;
    setMicSilenciado(false);
    miga('burbuja: micrófono activado por la persona');
    if (estadoRef.current === 'escuchando' || estadoRef.current === 'sin-oido' || estadoRef.current === 'revision') void escuchar(origen, Date.now());
  };

  const abrirEscribir = () => {
    if (!usuario.current) return;
    actividad();
    cortar('escribir');
    pauseMicForTts(true);
    setParcial('');
    setEstado('escribiendo');
  };

  const mandarEscrito = () => {
    const t = escrito.trim();
    if (!t && !foto.current) return;
    setEscrito('');
    Keyboard.dismiss();
    void enviar(t, true);
  };

  const abrirCamara = async () => {
    if (!usuario.current) return;
    actividad();
    const p = permisoCamara?.granted ? permisoCamara : await pedirPermisoCamara();
    if (!p?.granted) {
      setRespuesta(tr('Necesito la cámara para ver lo que me enseñas.', 'I need the camera to see what you show me.'));
      return;
    }
    cortar('camara');
    pauseMicForTts(true);
    setEstado('camara');
  };

  const tomarFoto = async () => {
    actividad();
    try {
      // Calidad baja a propósito: sube rápido y al cerebro le basta (la mesa tampoco manda la foto entera).
      const f = await lente.current?.takePictureAsync({ quality: 0.35, base64: true, shutterSound: false });
      if (f?.base64) {
        foto.current = f.base64;
        setFotoUri(f.uri);
      }
    } catch (e) {
      miga(`burbuja: la cámara no tomó la foto (${String((e as Error)?.message || e).slice(0, 60)})`);
      setRespuesta(tr('No pude tomar la foto.', 'I couldn’t take the photo.'));
    }
    void volverAEscuchar();
  };

  const tocarOrbe = () => {
    actividad();
    const e = estadoRef.current;
    if (hayQueDetener(e)) detener();
    else if (e === 'sin-oido' || e === 'error' || e === 'sin-permiso') {
      if (usuario.current) void escuchar(origen, Date.now());
    }
  };

  const alternarSubtitulos = () => {
    actividad();
    setSubtitulos((v) => {
      void AsyncStorage.setItem(CLAVE_SUBTITULOS, v ? '0' : '1').catch(() => undefined);
      return !v;
    });
  };

  const abrirApp = () => {
    // Primero se cierra (suelta el micrófono y deja lo hablado para la mesa); después la app, en la mesa, escuchando.
    // El pedido va también al buzón (mismo motor de JS): si el enlace llega tarde o no llega, la mesa igual lo atiende.
    // Es INTERNO: el único «hablar» que puede quitar el silencio que la persona dejó en la mesa (entrada/enlace.ts).
    cerrar('abrir-app');
    if (usuario.current && guardiaHablar.aceptar(Date.now())) buzonHablar.pedir('burbuja', Date.now(), { interno: true });
    void Linking.openURL(enlaceHablar('burbuja')).catch((e) => {
      // No abrió la app: la burbuja sigue delante. Vuelve a estar abierta para que «atrás» o tocar fuera la cierren.
      if (!control.falloAbrirApp()) return;
      miga(`burbuja: «Abrir en AURA» no abrió la app (${String((e as Error)?.message || e).slice(0, 60)})`);
      buzonHablar.tomar(Date.now());
      dejarDeEsperarVuelta();
      apertura.current = ++aperturas;
      burbujaAbierta.fijar(true);
      burbujaAbierta.acusar();
      actividad();
      setRespuesta(tr('No pude abrir AURA. Toca el orbe para seguir aquí, o cierra.', 'I couldn’t open AURA. Tap the orb to keep going here, or close.'));
      setEstado('error');
    });
  };

  const darPermiso = () => {
    actividad();
    void Linking.openSettings().catch(() => undefined);
  };

  /* ── dibujo ───────────────────────────────────────────────────────────────────────────────── */

  const conversacion = !!usuario.current && !sinSesionOLlamada(estado) && estado !== 'arrancando' && estado !== 'cerrada';
  const modo = estado === 'escribiendo' ? 'escribir' : estado === 'camara' ? 'camara' : 'normal';
  const escala = PixelRatio.getFontScale();
  const kb = estado === 'escribiendo' ? margenTeclado({ alturaTeclado: teclado, altoVentanaSinTeclado: altoSinTeclado.current, altoVentanaAhora: height }) : 0;
  const m = medidasBurbuja({ ancho: width, alto: height, arriba: insets.top, abajo: insets.bottom, modo, escalaTexto: escala, teclado: kb });
  const pausado = estado === 'pensando' || estado === 'hablando' || estado === 'reconectando' || estado === 'escribiendo' || estado === 'camara';
  const fase = faseBurbuja(estado, { en, micSilenciado, capturando });
  const mic = indicadorMic({ silenciadoPorPersona: micSilenciado, capturando, pausado, en });
  const linea = estado === 'escuchando' && fotoUri && !micSilenciado ? tr('Escuchando (con la foto)', 'Listening (with the photo)') : fase.texto;
  const detalle = estado === 'escuchando' && micSilenciado ? fase.detalle : estado === 'escuchando' || !fase.detalle ? '' : fase.detalle;
  const estadoOrbe: EstadoOrbeBurbuja =
    estado === 'escuchando'
      ? micSilenciado
        ? 'reposo'
        : 'escucha'
      : estado === 'pensando' || estado === 'reconectando'
        ? 'piensa'
        : estado === 'hablando'
          ? 'habla'
          : estado === 'error' || estado === 'sin-oido' || estado === 'sin-permiso'
            ? 'aviso'
            : estado === 'sin-sesion' || estado === 'ocupada'
              ? 'apagado'
              : 'reposo';
  const tuyo = estado === 'escuchando' && parcial ? parcial : pregunta;
  const suyo = subtitulos ? respuesta : '';
  const etiquetaOrbe = `AURA. ${linea}${expresion ? `, ${nombreExpresion(expresion.nombre, en)}` : ''}`;
  const revision = estado === 'revision';

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Tocar fuera: se cierra. El velo: un poco en toda la pantalla y más desde abajo, para leer sobre cualquier app. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => cerrar('fuera')} accessibilityRole="button" accessibilityLabel={tr('Cerrar AURA', 'Close AURA')}>
        <View style={[StyleSheet.absoluteFill, s.veloBase]} />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(4,7,16,0)', 'rgba(4,7,16,0.82)', 'rgba(4,7,16,0.94)', 'rgba(4,7,16,0.97)']}
          locations={[0, 0.3, 0.55, 1]}
          style={[s.degradado, { height: Math.round(height * 0.85) }]}
        />
      </Pressable>

      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {/* Lo que dijiste y lo que contesta AURA (con subtítulos), en su tarjeta. */}
        {modo !== 'camara' && (!!tuyo || !!suyo) && m.transcripcion.altoMax >= 48 && (
          <Transcripcion
            key={`${pregunta}|${respuesta ? 1 : 0}`}
            tuyo={tuyo}
            suyo={suyo}
            parcial={estado === 'escuchando' && !!parcial}
            style={{ left: m.lados, right: m.lados, bottom: m.transcripcion.abajo, maxHeight: m.transcripcion.altoMax }}
          />
        )}

        {/* El orbe: el de la mesa, entero y centrado en su círculo. Tocarlo mientras habla o piensa lo detiene. */}
        {m.lado > 0 && (
          <>
            <View pointerEvents="none" style={{ position: 'absolute', left: m.lienzoXY.x, top: m.lienzoXY.y }}>
              <OrbeBurbuja lado={m.lado} lienzo={m.lienzo} radioOrbe={m.radioOrbe} radioDisco={m.radioDisco} estado={estadoOrbe} expresion={expresion} />
            </View>
            <Pressable
              onPress={tocarOrbe}
              style={{ position: 'absolute', left: m.orbe.x, top: m.orbe.y, width: m.lado, height: m.lado, borderRadius: m.lado / 2 }}
              accessibilityRole="button"
              accessibilityLabel={etiquetaOrbe}
              accessibilityHint={hayQueDetener(estado) ? tr('Toca para detener a AURA.', 'Tap to stop AURA.') : estado === 'error' || estado === 'sin-oido' ? tr('Toca para intentarlo otra vez.', 'Tap to try again.') : undefined}
            />
          </>
        )}

        {/* La línea de estado: palabra corta en su píldora (el punto de color acompaña, no informa solo). */}
        <View
          pointerEvents="box-none"
          style={[s.estadoCaja, { bottom: modo === 'camara' ? insets.bottom + 24 + Math.min(((width - 48) * 4) / 3, 380) + 14 + 48 + 16 : m.estado.abajo, height: modo === 'camara' ? undefined : m.estado.alto }]}
        >
          <View style={s.estado} accessibilityLiveRegion="polite" accessible accessibilityLabel={detalle ? `${linea}. ${detalle}` : linea}>
            <View style={[s.punto, { backgroundColor: TONO[fase.tono] }]} />
            <Text style={s.estadoTexto} numberOfLines={1} maxFontSizeMultiplier={MAX_LETRA}>
              {linea}
            </Text>
          </View>
          {!!detalle && (
            <Text style={s.detalle} numberOfLines={2} maxFontSizeMultiplier={MAX_LETRA}>
              {detalle}
            </Text>
          )}
        </View>

        {modo === 'camara' && (
          <View style={[s.camara, { bottom: insets.bottom + 24 }]}>
            <View style={[s.visor, { height: Math.min(((width - 48) * 4) / 3, 380) }]}>
              <CameraView ref={lente} style={{ flex: 1 }} facing="back" onMountError={() => void volverAEscuchar()} />
            </View>
            <View style={s.fila}>
              <Pildora texto={tr('Cancelar', 'Cancel')} onPress={() => void volverAEscuchar()} />
              <Pildora texto={tr('Tomar foto', 'Take photo')} acento onPress={() => void tomarFoto()} />
            </View>
          </View>
        )}

        {modo === 'escribir' && (
          <View style={[s.escribir, { left: m.lados, right: m.lados, bottom: m.campo.abajo }]}>
            <TextInput
              value={escrito}
              onChangeText={(t) => {
                actividad();
                setEscrito(t);
              }}
              autoFocus
              placeholder={fotoUri ? tr('Pregunta sobre la foto…', 'Ask about the photo…') : tr('Escríbele a AURA…', 'Write to AURA…')}
              placeholderTextColor={TEXTO_SUAVE}
              style={[s.campo, { minHeight: m.campo.alto }]}
              returnKeyType="send"
              onSubmitEditing={mandarEscrito}
              multiline={false}
              maxFontSizeMultiplier={MAX_LETRA}
              accessibilityLabel={tr('Escribe tu pregunta', 'Type your question')}
            />
            <Pressable onPress={mandarEscrito} style={s.enviar} accessibilityRole="button" accessibilityLabel={tr('Enviar', 'Send')} hitSlop={6}>
              <Icono nombre="flecha" tam={22} color={TINTA} />
            </Pressable>
          </View>
        )}

        {modo === 'normal' && (
          <>
            {/* Abrir en AURA (o la revisión) y los subtítulos: compactas, de 48 dp. */}
            {estado !== 'arrancando' && (
              <View pointerEvents="box-none" style={[s.filaAbrir, { bottom: m.abrir.abajo, height: m.abrir.alto }]}>
                {estado === 'sin-permiso' && <Pildora acento texto={tr('Dar permiso', 'Allow')} etiqueta={tr('Dar el permiso del micrófono en Ajustes', 'Grant microphone permission in Settings')} onPress={darPermiso} />}
                {conversacion && (
                  <Pildora
                    icono="subtitulos"
                    texto={subtitulos ? tr('Subtítulos: sí', 'Captions: on') : tr('Subtítulos: no', 'Captions: off')}
                    etiqueta={subtitulos ? tr('Subtítulos activados. Toca para ocultar lo que dice AURA.', 'Captions on. Tap to hide what AURA says.') : tr('Subtítulos desactivados. Toca para ver lo que dice AURA.', 'Captions off. Tap to show what AURA says.')}
                    onPress={alternarSubtitulos}
                  />
                )}
                {fotoUri && conversacion && (
                  <Pressable onPress={() => void enviar('')} style={s.miniatura} accessibilityRole="button" accessibilityLabel={tr('Preguntar por la foto', 'Ask about the photo')}>
                    <Image source={{ uri: fotoUri }} style={StyleSheet.absoluteFill} />
                  </Pressable>
                )}
                <Pildora
                  acento={revision}
                  texto={revision ? tr('Abrir revisión', 'Open review') : usuario.current ? tr('Abrir en AURA', 'Open in AURA') : tr('Abrir AURA', 'Open AURA')}
                  etiqueta={revision ? tr('Abrir la revisión en AURA', 'Open the review in AURA') : undefined}
                  onPress={abrirApp}
                />
              </View>
            )}
            {/* Los controles grandes, con su palabra debajo. */}
            {conversacion && (
              <View pointerEvents="box-none" style={[s.controles, { left: m.lados, right: m.lados, bottom: m.controles.abajo }]}>
                <Control icono="lapiz" texto={tr('Escribir', 'Type')} etiqueta={tr('Escribir a AURA', 'Type to AURA')} onPress={abrirEscribir} />
                <Control icono="camara" texto={tr('Cámara', 'Camera')} etiqueta={tr('Enseñarle algo con la cámara', 'Show something with the camera')} onPress={() => void abrirCamara()} />
                <Control
                  icono={mic.abierto ? 'microfono' : 'microfonoNo'}
                  texto={mic.texto}
                  etiqueta={mic.etiqueta}
                  activo={mic.abierto}
                  onPress={() => void alternarMic()}
                />
                <Control
                  icono="detener"
                  texto={tr('Detener', 'Stop')}
                  etiqueta={hayQueDetener(estado) ? tr('Detener a AURA', 'Stop AURA') : tr('Detener: no hay nada que detener', 'Stop: nothing to stop')}
                  apagado={!hayQueDetener(estado)}
                  onPress={detener}
                />
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

/** La transcripción: aparece suave (y con «reducir movimiento», igual: solo opacidad). */
function Transcripcion({ tuyo, suyo, parcial, style }: { tuyo: string; suyo: string; parcial: boolean; style: object }) {
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(op, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [op]);
  return (
    <Animated.View pointerEvents="none" style={[s.tarjeta, style, { opacity: op }]}>
      {!!tuyo && (
        <Text style={[s.tuyo, parcial && s.parcial]} numberOfLines={2} maxFontSizeMultiplier={MAX_LETRA} accessibilityLabel={`${tr('Tú', 'You')}: ${tuyo}`}>
          {tuyo}
        </Text>
      )}
      {!!suyo && (
        <Text style={s.suyo} numberOfLines={5} maxFontSizeMultiplier={MAX_LETRA} accessibilityLabel={`AURA: ${suyo}`}>
          {suyo}
        </Text>
      )}
    </Animated.View>
  );
}

function Control({ icono, texto, etiqueta, onPress, activo = false, apagado = false }: { icono: NombreIcono; texto: string; etiqueta: string; onPress: () => void; activo?: boolean; apagado?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={apagado}
      style={({ pressed }) => [s.control, pressed && { opacity: 0.7 }, apagado && { opacity: 0.42 }]}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityState={{ disabled: apagado, selected: activo }}
      hitSlop={6}
    >
      <View style={[s.redondo, activo && s.redondoActivo]}>
        <Icono nombre={icono} tam={26} color={activo ? TINTA : TEXTO} />
      </View>
      <Text style={s.controlTexto} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {texto}
      </Text>
    </Pressable>
  );
}

function Pildora({ texto, onPress, acento = false, icono, etiqueta }: { texto: string; onPress: () => void; acento?: boolean; icono?: NombreIcono; etiqueta?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.pildora, acento && { backgroundColor: ACENTO, borderColor: ACENTO }, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={etiqueta ?? texto}
    >
      {icono && <Icono nombre={icono} tam={18} color={acento ? TINTA : TEXTO} />}
      <Text style={[s.pildoraTexto, acento && { color: TINTA }]} numberOfLines={1} maxFontSizeMultiplier={1.5}>
        {texto}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  veloBase: { backgroundColor: 'rgba(4,7,16,0.30)' },
  degradado: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  tarjeta: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: 560,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: FONDO_PIEZA,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDE,
    gap: 8,
    overflow: 'hidden',
  },
  tuyo: { color: TEXTO_SUAVE, fontSize: 15, lineHeight: 21 },
  parcial: { fontStyle: 'italic' },
  suyo: { color: TEXTO, fontSize: 18, lineHeight: 25, fontWeight: '500' },
  estadoCaja: { position: 'absolute', left: 16, right: 16, alignItems: 'center', justifyContent: 'flex-start', gap: 6 },
  estado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: FONDO_PIEZA,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDE,
  },
  punto: { width: 8, height: 8, borderRadius: 4 },
  estadoTexto: { color: TEXTO, fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
  detalle: { color: TEXTO_SUAVE, fontSize: 13, lineHeight: 17, textAlign: 'center', paddingHorizontal: 12, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(12,17,32,0.82)', overflow: 'hidden' },
  filaAbrir: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  controles: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-evenly' },
  control: { alignItems: 'center', minWidth: 72, gap: 6 },
  redondo: { width: 56, height: 56, borderRadius: 28, backgroundColor: FONDO_PIEZA, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: BORDE },
  redondoActivo: { backgroundColor: ACENTO, borderColor: ACENTO },
  controlTexto: { color: TEXTO, fontSize: 12.5, fontWeight: '600' },
  pildora: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: FONDO_PIEZA,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDE,
  },
  pildoraTexto: { color: TEXTO, fontSize: 15, fontWeight: '600' },
  miniatura: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: ACENTO },
  escribir: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 10 },
  campo: { flex: 1, borderRadius: 24, paddingHorizontal: 18, color: TEXTO, backgroundColor: FONDO_PIEZA, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDE, fontSize: 16 },
  enviar: { width: 48, height: 48, borderRadius: 24, backgroundColor: ACENTO, alignItems: 'center', justifyContent: 'center' },
  camara: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 14 },
  visor: { width: '100%', borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' },
  fila: { flexDirection: 'row', gap: 14 },
});
