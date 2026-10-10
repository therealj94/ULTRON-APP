/**
 * LA BURBUJA DE AURA: lo que sale ENCIMA de cualquier app al mantener el botón lateral (o desde el mosaico de Ajustes
 * rápidos, el atajo del ícono, ASSIST o el botón del manos libres). José, 10-oct, con una foto de ChatGPT como
 * asistente en su S26: la pantalla de atrás se queda, oscurecida; el orbe grande abajo al centro; «escribir» abajo a la
 * izquierda y «cámara» abajo a la derecha; tocar fuera o «atrás» la cierra.
 *
 * Se dibuja en BurbujaActivity (translúcida, plugins/asistente-digital.js) con el mismo motor de JS que la app: App.tsx
 * ve `modo: 'burbuja'` en las props de arranque y monta esto en vez de la app. Por eso todo lo de aquí se ajusta por
 * OTA, y por eso es la MISMA AURA:
 *
 *  · escucha en el acto con el oído de la mesa (lib/speech.ts, prestado: `prestarOido`; si la app está abierta detrás,
 *    su mesa suelta el micrófono mientras la burbuja está abierta — compa/duenoAudio.ts, dueño «burbuja» — y lo vuelve a
 *    tomar al cerrarse);
 *  · pregunta al mismo cerebro, con la misma cuenta y el mismo hilo (burbuja/turnoBurbuja.ts: `turnoStream` y la voz
 *    por frases de la mesa), y le deja a la mesa lo que habló (burbuja/logica.ts `hiloCompartido`);
 *  · dice «Te escucho…» / «Pensando…», enseña la respuesta y la dice; sigue escuchando para la siguiente;
 *  · «Abrir en AURA» abre la app entera en la mesa, escuchando, con lo hablado ya en el hilo (ultronfp://hablar);
 *  · sin sesión: «Entra a AURA primero» y el botón que abre la app; sin permiso del micrófono, cómo darlo; si el
 *    micrófono no abre (otra app lo tiene), lo dice y deja escribir;
 *  · se cierra sola tras 30 s sin nada (suelta el micrófono), y al dejar de verse (el nativo la termina en onStop).
 *
 * La medida: `[entrada] origen=… invocacion→escuchando=…ms` en las migas, desde la pulsación (el `t` del nativo) hasta
 * que el oído escucha de verdad (entrada/hablar.ts `medirHastaEscuchar`).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Image, Linking, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { OrbeMini } from '../avatar3d/OrbeMini';
import { senalVoz } from '../avatar3d/senalVoz';
import { nivelOido } from '../compa/canales';
import { fijarUsuario, usuarioActual } from '../app/sesion';
import { Icono, type NombreIcono } from '../ui/Icono';
import { fijarIdioma, tr, useIdioma } from '../i18n';
import type { SessionUser } from '../config';
import { prepararVoz } from '../lib/guardiaVoz';
import { iniciarReporte, miga } from '../lib/reporte';
import { loadLongMemory, loadSession, loadSettings } from '../lib/storage';
import { escucharNivelVoz, setAvatarVoz, stopSpeaking, vozDeConversacion } from '../lib/tts';
import {
  currentSttEngine,
  destroySpeech,
  enableAlwaysOnMic,
  ensureSpeechPermissions,
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
import { burbujaAbierta, cierreBurbuja, debeCerrarPorSilencio, hiloCompartido, preguntaDeFoto, sinConversacion, textoEstado, type EstadoBurbuja, type MotivoCierre } from './logica';
import { turnoBurbuja } from './turnoBurbuja';
import { registrarTrabajoActivo } from '../lib/barreraOta';

const TEXTO = '#ECE8E2';
const TEXTO_SUAVE = 'rgba(236,232,226,0.72)';
const ACENTO = '#D6B56C';
const BOTON = 'rgba(28,29,32,0.92)';

type Props = { origen: OrigenEntrada; invocadaEn: number | null };

export function RaizBurbuja(props: Props) {
  return (
    <SafeAreaProvider style={{ backgroundColor: 'transparent' }}>
      <Burbuja {...props} />
    </SafeAreaProvider>
  );
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Con la burbuja abierta, la OTA no recarga el JS (lib/ota.ts «al volver»: la burbuja delante cuenta como volver).
registrarTrabajoActivo('burbuja', () => burbujaAbierta.abierta());

/**
 * El aviso «la burbuja está abierta» se suelta cuando la app vuelve a estar DELANTE (la mesa toma el micrófono si le
 * toca). Si la burbuja se cerró sobre otra app, la mesa de atrás no reabre su oído en segundo plano por el rato de
 * gracia de lib/appDelante.ts: espera a que la persona vuelva a AURA.
 */
let esperandoVolver: { remove(): void } | null = null;
function soltarAvisoBurbuja() {
  esperandoVolver?.remove();
  esperandoVolver = null;
  if (AppState.currentState === 'active') {
    burbujaAbierta.fijar(false);
    return;
  }
  esperandoVolver = AppState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    esperandoVolver?.remove();
    esperandoVolver = null;
    burbujaAbierta.fijar(false);
  });
}

function Burbuja({ origen, invocadaEn }: Props) {
  const idioma = useIdioma();
  const en = idioma === 'en';
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [estado, setEstadoUi] = useState<EstadoBurbuja>('arrancando');
  const [parcial, setParcial] = useState('');
  const [pregunta, setPregunta] = useState('');
  const [respuesta, setRespuesta] = useState('');
  const [escrito, setEscrito] = useState('');
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [permisoCamara, pedirPermisoCamara] = useCameraPermissions();
  const lente = useRef<CameraView | null>(null);

  const estadoRef = useRef<EstadoBurbuja>('arrancando');
  const usuario = useRef<SessionUser | null>(null);
  const memoria = useRef<string[]>([]);
  const motor = useRef<SttEngine | null>(null);
  const devolverOido = useRef<(() => void) | null>(null);
  const cancelarTurno = useRef<(() => void) | null>(null);
  const foto = useRef<string | null>(null);
  const cerrada = useRef(false);
  const ultimaActividad = useRef(Date.now());
  const guardia = useRef(new GuardiaInvocacion()).current;
  /** Cada invocación (la primera y las de después con la burbuja abierta) mide la suya; una nueva corta la anterior. */
  const medida = useRef(0);

  const setEstado = useCallback((e: EstadoBurbuja) => {
    estadoRef.current = e;
    setEstadoUi(e);
  }, []);
  const actividad = () => (ultimaActividad.current = Date.now());

  // Antes que nada (antes de que React avise «app activa»): el micrófono es de la burbuja, la mesa de atrás lo suelta.
  useLayoutEffect(() => {
    esperandoVolver?.remove();
    esperandoVolver = null;
    burbujaAbierta.fijar(true);
  }, []);

  /* ── cerrar ───────────────────────────────────────────────────────────────────────────────── */

  const cerrar = useCallback((motivo: MotivoCierre) => {
    if (cerrada.current) return;
    cerrada.current = true;
    const c = cierreBurbuja(motivo);
    medida.current++;
    cancelarTurno.current?.();
    cancelarTurno.current = null;
    void stopSpeaking();
    pauseMicForTts(false);
    // El micrófono se suelta YA. Con la mesa montada detrás se le devuelve su oído (ella lo reabre si le toca); sin
    // mesa, se apaga el oído entero.
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
    miga(`burbuja: cerrada (${motivo})`);
    soltarAvisoBurbuja();
    if (c.terminarActividad) BackHandler.exitApp();
  }, []);

  /* ── el oído ──────────────────────────────────────────────────────────────────────────────── */

  const enviarRef = useRef<(texto: string, escritoAMano?: boolean) => void>(() => undefined);

  /** Escucha (abre el micrófono si hace falta) y mide desde `desde` hasta que el oído escucha de verdad. */
  const escuchar = useCallback(
    async (o: string, desde: number) => {
      const yo = ++medida.current;
      const vigente = () => !cerrada.current && medida.current === yo;
      const ok = await ensureSpeechPermissions();
      if (!vigente()) return;
      if (!ok) {
        setEstado('sin-permiso');
        miga(lineaEntrada(o as OrigenEntrada, desde, null, 'sin permiso del micrófono'));
        return;
      }
      if (!devolverOido.current) {
        // La app estaba abierta detrás: un respiro para que su mesa suelte el micrófono (OidoMesa.aplicar) antes de
        // abrirlo aquí; si no, su muteMic tardío cerraría el de la burbuja.
        const conMesa = hiloCompartido.hayMesa();
        if (conMesa) await espera(150);
        else if (motor.current && motor.current !== currentSttEngine()) await setSttEngine(motor.current);
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
            if (estadoRef.current === 'escuchando') enviarRef.current(t);
          },
          onError: () => {},
        });
        if (conMesa) await reabrirMic();
        else await enableAlwaysOnMic();
      } else if (!oidoEscuchando()) await reabrirMic();
      if (!vigente()) return;
      pauseMicForTts(false);
      setEstado('escuchando');
      actividad();
      const escucho = await medirHastaEscuchar(o as OrigenEntrada, desde, { vigente });
      if (!escucho && vigente() && estadoRef.current === 'escuchando') setEstado('sin-oido');
    },
    [setEstado]
  );

  /* ── arrancar ─────────────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const recibida = Date.now();
    const desde = momentoInvocacion(invocadaEn, recibida);
    guardia.aceptar(desde);
    // La boca de AURA en el orbe (senalVoz): lo conecta el VozProvider de la app; sin la app abierta, nadie. Dos veces el
    // mismo nivel no cambia nada.
    const fueraNivel = escucharNivelVoz((l) => senalVoz.nivel(l));
    void (async () => {
      await iniciarReporte();
      miga(`[entrada] origen=${origen}: burbuja (${recibida - desde} ms hasta React)`);
      const actual = usuarioActual();
      const [ajustes, sesion] = await Promise.all([loadSettings(), actual ? Promise.resolve(actual) : loadSession()]);
      if (cerrada.current) return;
      fijarIdioma(ajustes.idioma);
      setAvatarVoz(ajustes.avatar);
      motor.current = ajustes.sttEngine;
      void prepararVoz();
      if (!sesion) {
        setEstado('sin-sesion');
        miga(lineaEntrada(origen, desde, null, 'sin sesión'));
        return;
      }
      if (!actual) fijarUsuario(sesion);
      usuario.current = sesion;
      void loadLongMemory(sesion)
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

    // Otra invocación con la burbuja abierta (el botón otra vez, el mosaico): llega como enlace.
    const sub = Linking.addEventListener('url', ({ url }) => {
      const e = leerEnlace(url);
      if (!e || e.destino !== 'burbuja' || cerrada.current) return;
      const t = momentoInvocacion(e.invocadaEn, Date.now());
      if (!guardia.aceptar(t)) {
        miga(`[entrada] origen=${e.origen}: segunda invocación en menos de 1,5 s, ignorada`);
        return;
      }
      if (!usuario.current || sinConversacion(estadoRef.current)) return;
      cancelarTurno.current?.();
      cancelarTurno.current = null;
      void stopSpeaking();
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

    // Sin nada durante 30 s: se cierra y suelta el micrófono.
    const reloj = setInterval(() => {
      if (debeCerrarPorSilencio({ estado: estadoRef.current, ultimaActividad: ultimaActividad.current, ahora: Date.now() })) cerrar('silencio');
    }, 2_000);

    return () => {
      fueraNivel();
      sub.remove();
      atras.remove();
      clearInterval(reloj);
      // Se desmonta (el nativo la terminó al dejar de verse): lo mismo que cerrarla, sin volver a terminarla.
      cerrar('fondo');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── preguntar ────────────────────────────────────────────────────────────────────────────── */

  const enviar = useCallback(
    async (texto: string, escritoAMano = false) => {
      const u = usuario.current;
      if (!u || cerrada.current) return;
      const imagen = foto.current;
      const q = imagen ? preguntaDeFoto(texto, en) : texto.trim();
      if (!q) return;
      foto.current = null;
      setFotoUri(null);
      actividad();
      cancelarTurno.current?.();
      setParcial('');
      setPregunta(q);
      setRespuesta('');
      setEstado('pensando');
      // Mientras piensa y habla no se oye (igual que la mesa sin «Interrumpir hablando»).
      pauseMicForTts(true);
      const historial = hiloCompartido.historial(u.correo);
      hiloCompartido.anotar(u.correo, { rol: 'usuario', texto: q });
      const t = turnoBurbuja(
        { message: q, mode: 'GUARDIAN', userName: u.name, correo: u.correo, historial, memoria: memoria.current, ...(imagen ? { image: imagen } : {}), hablado: !escritoAMano },
        {
          alFrase: (f) => f && setRespuesta(f),
          alHablar: (on) => on && !cerrada.current && setEstado('hablando'),
        }
      );
      cancelarTurno.current = t.cancelar;
      const r = await t.promise;
      if (cancelarTurno.current === t.cancelar) cancelarTurno.current = null;
      if (cerrada.current || r.cortado) return;
      actividad();
      if (r.texto) {
        hiloCompartido.anotar(u.correo, { rol: 'ultron', texto: r.texto });
        setRespuesta(r.texto);
      } else if (r.fallo === 'sesion') {
        setRespuesta(tr('Tu sesión terminó. Abre AURA para entrar de nuevo.', 'Your session ended. Open AURA to sign in again.'));
      } else if (r.fallo === 'sin-red') {
        setRespuesta(tr('No tengo conexión ahora.', 'I have no connection right now.'));
      } else {
        setRespuesta(textoEstado('error', en));
      }
      // Sigue la conversación: vuelve a escuchar.
      pauseMicForTts(false);
      setEstado('escuchando');
    },
    [en, setEstado]
  );
  enviarRef.current = (texto, escritoAMano) => void enviar(texto, escritoAMano);

  /* ── escribir, cámara, el orbe y la app ───────────────────────────────────────────────────── */

  const volverAEscuchar = useCallback(async () => {
    actividad();
    if (!usuario.current || cerrada.current) return;
    pauseMicForTts(false);
    setEstado('escuchando');
    if (devolverOido.current && !oidoEscuchando()) void reabrirMic();
  }, [setEstado]);

  const abrirEscribir = () => {
    if (!usuario.current) return;
    actividad();
    cancelarTurno.current?.();
    void stopSpeaking();
    pauseMicForTts(true);
    setParcial('');
    setEstado('escribiendo');
  };

  const mandarEscrito = () => {
    const t = escrito.trim();
    if (!t && !foto.current) return;
    setEscrito('');
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
    cancelarTurno.current?.();
    void stopSpeaking();
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
    if (e === 'hablando' || e === 'pensando') {
      // Como hablarle encima: se calla y escucha.
      cancelarTurno.current?.();
      cancelarTurno.current = null;
      void stopSpeaking();
      void volverAEscuchar();
    } else if (e === 'sin-oido' || e === 'error' || e === 'sin-permiso') {
      if (usuario.current) void escuchar(origen, Date.now());
    }
  };

  const abrirApp = () => {
    // Primero se cierra (suelta el micrófono y deja lo hablado para la mesa); después la app, en la mesa, escuchando.
    // El pedido va también al buzón (mismo motor de JS): si el enlace llega tarde o no llega, la mesa igual lo atiende.
    cerrar('abrir-app');
    if (usuario.current && guardiaHablar.aceptar(Date.now())) buzonHablar.pedir('burbuja', Date.now());
    void Linking.openURL(enlaceHablar('burbuja')).catch(() => undefined);
  };

  const darPermiso = () => {
    actividad();
    void Linking.openSettings().catch(() => undefined);
  };

  /* ── dibujo ───────────────────────────────────────────────────────────────────────────────── */

  const conversacion = !!usuario.current && !sinConversacion(estado) && estado !== 'arrancando';
  const chico = estado === 'escribiendo' || estado === 'camara';
  const lado = Math.round(Math.min(width, height) * (chico ? 0.24 : 0.45));
  // El centro del orbe a ~35 % del alto desde abajo (la foto de José); más arriba si el teclado o la cámara ocupan abajo.
  const abajoOrbe = Math.max(insets.bottom + 120, Math.round(height * (chico ? 0.62 : 0.35) - lado / 2));
  // Con la cámara abierta, el visor ocupa abajo: el orbe se esconde y la línea va encima del visor.
  const altoVisor = Math.min(((width - 48) * 4) / 3, 380);
  const abajoTextos = estado === 'camara' ? insets.bottom + 24 + altoVisor + 14 + 48 + 16 : abajoOrbe + lado + 18;
  const linea = estado === 'escuchando' && fotoUri ? tr('Te escucho… (con la foto)', 'Listening… (with the photo)') : textoEstado(estado, en);

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Tocar fuera: se cierra. La pantalla de atrás ya la oscurece el sistema (el tema de la actividad). */}
      <Pressable style={[StyleSheet.absoluteFill, s.velo]} onPress={() => cerrar('fuera')} accessibilityRole="button" accessibilityLabel={tr('Cerrar', 'Close')} />

      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {/* Lo dicho y la respuesta, encima del orbe. */}
        <View pointerEvents="box-none" style={[s.textos, { bottom: abajoTextos }]}>
          {!!pregunta && (
            <Text style={s.pregunta} numberOfLines={2}>
              {pregunta}
            </Text>
          )}
          {!!respuesta && (
            <Text style={s.respuesta} numberOfLines={7}>
              {respuesta}
            </Text>
          )}
          {!!parcial && estado === 'escuchando' && (
            <Text style={s.parcial} numberOfLines={2}>
              {parcial}
            </Text>
          )}
          {!!linea && <Text style={s.estado}>{linea}</Text>}
          {estado === 'sin-permiso' && <Pildora texto={tr('Dar permiso', 'Allow')} onPress={darPermiso} />}
        </View>

        {/* El orbe: late con la voz de AURA y con la de la persona. Tocarlo mientras habla la calla y escucha. */}
        {estado !== 'camara' && (
        <Pressable
          onPress={tocarOrbe}
          style={{ position: 'absolute', left: (width - lado) / 2, bottom: abajoOrbe, width: lado, height: lado }}
          accessibilityRole="button"
          accessibilityLabel="AURA"
        >
          <OrbeMini lado={lado} estado={{ escuchando: estado === 'escuchando', pensando: estado === 'pensando', silenciado: estado === 'sin-oido' || estado === 'sin-permiso' || estado === 'sin-sesion' || estado === 'ocupada' }} />
        </Pressable>
        )}

        {estado === 'camara' && (
          <View style={[s.camara, { bottom: insets.bottom + 24 }]}>
            <View style={[s.visor, { height: altoVisor }]}>
              <CameraView ref={lente} style={{ flex: 1 }} facing="back" onMountError={() => void volverAEscuchar()} />
            </View>
            <View style={s.fila}>
              <Pildora texto={tr('Cancelar', 'Cancel')} onPress={() => void volverAEscuchar()} />
              <Pildora texto={tr('Tomar foto', 'Take photo')} acento onPress={() => void tomarFoto()} />
            </View>
          </View>
        )}

        {estado === 'escribiendo' && (
          <View style={[s.escribir, { bottom: insets.bottom + 16 }]}>
            <TextInput
              value={escrito}
              onChangeText={(t) => {
                actividad();
                setEscrito(t);
              }}
              autoFocus
              placeholder={fotoUri ? tr('Pregunta sobre la foto…', 'Ask about the photo…') : tr('Escríbele a AURA…', 'Write to AURA…')}
              placeholderTextColor={TEXTO_SUAVE}
              style={s.campo}
              returnKeyType="send"
              onSubmitEditing={mandarEscrito}
              multiline={false}
            />
            <Pressable onPress={mandarEscrito} style={s.enviar} accessibilityRole="button" accessibilityLabel={tr('Enviar', 'Send')}>
              <Icono nombre="flecha" tam={22} color="#1C1D20" />
            </Pressable>
          </View>
        )}

        {!chico && (
          <View pointerEvents="box-none" style={[s.abajo, { bottom: insets.bottom + 28 }]}>
            {conversacion ? <BotonRedondo icono="lapiz" etiqueta={tr('Escribir', 'Write')} onPress={abrirEscribir} /> : <View style={s.hueco} />}
            <View style={s.centro}>
              {fotoUri && conversacion && (
                <Pressable onPress={() => void enviar('')} style={s.miniatura} accessibilityRole="button" accessibilityLabel={tr('Preguntar por la foto', 'Ask about the photo')}>
                  <Image source={{ uri: fotoUri }} style={StyleSheet.absoluteFill} />
                </Pressable>
              )}
              {estado !== 'arrancando' && <Pildora texto={usuario.current ? tr('Abrir en AURA', 'Open in AURA') : tr('Abrir AURA', 'Open AURA')} onPress={abrirApp} />}
            </View>
            {conversacion ? <BotonRedondo icono="camara" etiqueta={tr('Cámara', 'Camera')} onPress={() => void abrirCamara()} /> : <View style={s.hueco} />}
          </View>
        )}
      </View>
    </View>
  );
}

function BotonRedondo({ icono, etiqueta, onPress }: { icono: NombreIcono; etiqueta: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.redondo, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={8}>
      <Icono nombre={icono} tam={26} color={TEXTO} />
    </Pressable>
  );
}

function Pildora({ texto, onPress, acento = false }: { texto: string; onPress: () => void; acento?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.pildora, acento && { backgroundColor: ACENTO }, pressed && { opacity: 0.75 }]} accessibilityRole="button">
      <Text style={[s.pildoraTexto, acento && { color: '#1C1D20' }]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  velo: { backgroundColor: 'rgba(5,7,12,0.18)' },
  textos: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 8 },
  pregunta: { color: TEXTO_SUAVE, fontSize: 15, textAlign: 'center' },
  respuesta: { color: TEXTO, fontSize: 19, lineHeight: 26, textAlign: 'center', fontWeight: '500' },
  parcial: { color: TEXTO, fontSize: 17, textAlign: 'center', opacity: 0.9 },
  estado: { color: TEXTO_SUAVE, fontSize: 15, textAlign: 'center' },
  abajo: { position: 'absolute', left: 28, right: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  centro: { flex: 1, alignItems: 'center', gap: 10 },
  hueco: { width: 60, height: 60 },
  redondo: { width: 60, height: 60, borderRadius: 30, backgroundColor: BOTON, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  pildora: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, backgroundColor: BOTON, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  pildoraTexto: { color: TEXTO, fontSize: 15, fontWeight: '600' },
  miniatura: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: ACENTO },
  escribir: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  campo: { flex: 1, minHeight: 48, borderRadius: 24, paddingHorizontal: 18, color: TEXTO, backgroundColor: BOTON, fontSize: 16 },
  enviar: { width: 48, height: 48, borderRadius: 24, backgroundColor: ACENTO, alignItems: 'center', justifyContent: 'center' },
  camara: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 14 },
  visor: { width: '100%', borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' },
  fila: { flexDirection: 'row', gap: 14 },
});
