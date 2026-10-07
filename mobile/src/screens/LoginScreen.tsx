/**
 * «OTRAS FORMAS DE ENTRAR»: el correo y la clave de AU-RA, la huella y el modo local de la mesa.
 *
 * La puerta principal es Genesis ID (src/app/pantallas/Entrar.tsx). Esto queda para la junta —las
 * cuentas que entran con su clave o con la huella— y para abrir la mesa sin
 * servidor. Toda la lógica de antes sigue igual (clave guardada que no se muestra, huella solo con la
 * clave guardada, modo local si el servidor no contesta, crear cuenta y recuperar la clave); cambia
 * cómo se ve: la cabecera grande que colapsa, las cuentas en una lista del sistema y los campos, los
 * botones y los colores del sistema de diseño (claro u oscuro, según el tema).
 *
 * Fases: pick (elegir cuenta) → clave | quick (huella) | crear | olvide. El «atrás» de la cabecera y
 * el de Android vuelven a la fase anterior; desde la primera, a la entrada con Genesis ID.
 *
 * Cada «Entrar» es un intento (lib/intentoEntrada.ts, auditoría del 3-oct AUTH03): el token, la sesión y
 * la clave recordada solo se guardan si sigue siendo el último. «Atrás», cambiar de fase o salir de la
 * pantalla lo vencen: una respuesta que llega después no guarda nada, no dice nada y no entra.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { de, tr, useIdioma } from '../i18n';
import { DESK_USERS, findDeskUserByEmail, normalizeDeskEmail, type DeskUser, type SessionUser } from '../config';
import { loginBiometric, loginClave, olvideClave, pedirCuenta } from '../lib/api';
import { cancelarIntento, confirmarIntento, empezarIntento, esVencida, intentoVigente, type Intento } from '../lib/intentoEntrada';
import { miga } from '../lib/reporte';
import { getFingerprintUnlock, loadCreds, saveCreds, setFingerprintUnlock } from '../lib/storage';
import { AVATARES } from '../avatares/catalogo';
import { MiniAvatar } from '../avatares/MiniAvatar';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Aparecer, Boton, Campo, Fila, Grupo, Icono, Interruptor, PantallaConCabecera, Texto, vibrar } from '../ui';

type Props = {
  /** `intento`: el de esta entrada; quien la termina (app/sesion.ts entrarCon) lo vuelve a mirar. */
  onAuthenticated: (user: SessionUser, intento: Intento) => void;
  /** Volver a la entrada con Genesis ID (desde la primera fase). */
  onAtras?: () => void;
};

type Fase = 'pick' | 'clave' | 'quick' | 'crear' | 'olvide';

const OTRO_TEMPLATE: DeskUser = {
  id: 'otro',
  name: 'Otro miembro',
  correo: '',
  role: 'Junta Directiva · Orden Global',
};

/** La inicial en su círculo dorado (las cuentas de la junta en la lista). */
function Inicial({ letra }: { letra: string }) {
  const tema = useTema();
  return (
    <View style={[est.inicial, { backgroundColor: tema.acentoFondo }]}>
      <Texto v="cuerpoFuerte" color="acentoTexto">
        {letra}
      </Texto>
    </View>
  );
}

export function LoginScreen({ onAuthenticated, onAtras }: Props) {
  // El idioma se elige en la entrada: toda la pantalla se redibuja al cambiarlo.
  useIdioma();
  const tema = useTema();
  // Sin cuentas fijas en la app (config.ts): se empieza por «Otra cuenta», con el correo escrito o el recordado.
  const [selected, setSelected] = useState<DeskUser>(DESK_USERS[0] ?? OTRO_TEMPLATE);
  const [customCorreo, setCustomCorreo] = useState('');
  const [phase, setPhase] = useState<Fase>('pick');
  // Crear cuenta y olvidé la clave: sus propios campos y su respuesta del servidor.
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCorreo, setNuevoCorreo] = useState('');
  const [nuevoMotivo, setNuevoMotivo] = useState('');
  const [correoOlvido, setCorreoOlvido] = useState('');
  const [listo, setListo] = useState('');
  const [clave, setClave] = useState('');
  /** Hay una clave guardada en este teléfono (no se muestra; la usan la huella y la renovación). */
  const [claveGuardada, setClaveGuardada] = useState(false);
  const [remember, setRemember] = useState(true);
  const [useFingerprint, setUseFingerprint] = useState(true);
  const [fingerprintAvailable, setFingerprintAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedName, setSavedName] = useState<string | null>(null);
  /** La entrada en curso de esta pantalla (la última que tocó «Entrar»). */
  const intentoRef = useRef<Intento | null>(null);
  const nuevoIntento = () => {
    cancelarIntento(intentoRef.current);
    intentoRef.current = empezarIntento();
    return intentoRef.current;
  };
  /** «Atrás», otra fase o salir de la pantalla: la entrada en curso ya no guarda ni entra. */
  const abandonarIntento = () => {
    if (!intentoRef.current) return;
    cancelarIntento(intentoRef.current);
    intentoRef.current = null;
    setLoading(false);
  };
  // Salir de la pantalla (desmontarla) también la vence.
  useEffect(() => () => cancelarIntento(intentoRef.current), []);
  /** ¿Lo que acaba de volver es de la entrada de ahora? Si no, la pantalla no lo muestra. */
  const deAhora = (i: Intento) => intentoRef.current === i && intentoVigente(i);

  /** La fase anterior (la que abre «atrás»); null = salir de esta pantalla. */
  const faseAnterior = (f: Fase): Fase | null => (f === 'pick' ? null : f === 'clave' || f === 'quick' ? 'pick' : 'clave');
  const volver = () => {
    const a = faseAnterior(phase);
    abandonarIntento();
    setError('');
    setListo('');
    if (a) setPhase(a);
    else onAtras?.();
  };
  // Atrás de Android: vuelve al paso anterior en vez de salir.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!faseAnterior(phase)) return false;
      volver();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const activeUser: DeskUser = useMemo(() => {
    if (selected.id !== 'otro') return selected;
    const correo = normalizeDeskEmail(customCorreo);
    const known = findDeskUserByEmail(correo);
    if (known) return known;
    const local = correo.split('@')[0] || 'Miembro';
    return {
      id: 'otro',
      name: local.charAt(0).toUpperCase() + local.slice(1),
      correo,
      role: 'Junta Directiva · Orden Global',
    };
  }, [selected, customCorreo]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      // Un sensor que no responde no puede dejar la entrada colgada: sin huella, se entra con clave.
      let hw = false;
      let enrolled = false;
      try {
        hw = await LocalAuthentication.hasHardwareAsync();
        enrolled = hw ? await LocalAuthentication.isEnrolledAsync() : false;
      } catch {
        hw = false;
        enrolled = false;
      }
      if (!vivo) return;
      setFingerprintAvailable(hw && enrolled);

      try {
        const fp = await getFingerprintUnlock();
        const creds = await loadCreds();
        if (!vivo || !creds?.correo) return;
        const correo = normalizeDeskEmail(creds.correo);
        // La huella quedó activada para ESTE correo (o por una versión que no lo anotaba).
        const huellaActiva = !!fp?.enabled && (!fp.correo || normalizeDeskEmail(fp.correo) === correo);
        // El interruptor muestra lo que quedó guardado: si se apagó, sigue apagado.
        setUseFingerprint(huellaActiva);
        const match = findDeskUserByEmail(correo);
        if (match) {
          setSelected(match);
          // La clave guardada NO se escribe en el campo: con ella a la vista, cualquiera con el teléfono
          // tocaba «Usar clave» y entraba. Se sigue usando por detrás (huella, renovar la sesión).
          setClaveGuardada(!!creds.clave);
          setSavedName(match.name);
          setRemember(true);
          if (creds.correo !== match.correo && creds.clave) {
            await saveCreds({ ...creds, correo: match.correo, name: match.name });
          }
          if (!vivo) return;
          setPhase(huellaActiva && hw && enrolled ? 'quick' : 'clave');
        } else {
          setSelected(OTRO_TEMPLATE);
          setCustomCorreo(correo);
          setClaveGuardada(!!creds.clave);
          setSavedName(creds.name || correo);
          setRemember(true);
          // La cuenta recordada en este teléfono abre con la huella igual que las de la lista de antes.
          setPhase(huellaActiva && hw && enrolled && !!creds.clave ? 'quick' : 'clave');
        }
      } catch {
        // Lo guardado no se pudo leer o actualizar: se entra con la clave escrita (el aviso sale en esa fase;
        // «←» deja elegir otro usuario).
        if (!vivo) return;
        setPhase('clave');
        setError(tr('No pude leer tus datos guardados. Escribe tu clave para entrar.', 'Couldn’t read your saved data. Type your password to sign in.'));
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * Guarda lo de esta entrada y avisa que entró, como UN paso del intento: si ya no es el último (otra
   * entrada empezó, o «atrás»), no guarda nada más, suelta lo que alcanzó a guardar y no entra.
   */
  const finish = async (user: SessionUser, persist: { clave: string } | undefined, intento: Intento) => {
    const correo = normalizeDeskEmail(user.correo);
    const session = { ...user, correo };
    const guardado = await confirmarIntento(intento, async (e) => {
      try {
        await e.sesion(session);
        if (!e.sigue()) return false;
        if (remember && persist?.clave) {
          await saveCreds({ correo, clave: persist.clave, name: session.name });
        } else if (!remember) {
          await saveCreds(null);
        }
        if (!e.sigue()) return false;
        // Huella: se enciende solo con la clave guardada (la usa para entrar); apagar el interruptor, o no
        // guardar la contraseña, la apaga de verdad (antes se quedaba activa y seguía pidiendo la huella).
        if (!remember || (fingerprintAvailable && !useFingerprint)) {
          await setFingerprintUnlock(false);
        } else if (persist?.clave && useFingerprint && fingerprintAvailable) {
          await setFingerprintUnlock(true, correo);
        }
      } catch (err) {
        // Ya se verificó quién es: si el teléfono no deja guardar, entra igual (la próxima vez pedirá la clave).
        miga(`entrada: no se pudo guardar (${err instanceof Error ? err.message : String(err)})`);
      }
      return e.sigue();
    });
    if (!guardado || !intentoVigente(intento)) return;
    onAuthenticated(session, intento);
  };

  const enterWithFingerprint = async () => {
    const previo = intentoRef.current;
    setLoading(true);
    setError('');
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: tr('Desbloquear AU-RA FP', 'Unlock AU-RA FP'),
        cancelLabel: tr('Usar clave', 'Use password'),
        disableDeviceFallback: false,
        biometricsSecurityLevel: 'weak',
      });
      if (!result.success) {
        setError(tr('Huella cancelada. Usa tu clave.', 'Fingerprint cancelled. Use your password.'));
        setPhase('clave');
        return;
      }
      const creds = await loadCreds();
      const user =
        findDeskUserByEmail(creds?.correo || '') ||
        (activeUser.correo ? activeUser : selected);
      await enterBiometric(user, creds?.clave);
    } catch (e: any) {
      setError(e?.message || tr('No se pudo usar la huella', 'Couldn’t use the fingerprint'));
      setPhase('clave');
    } finally {
      // enterBiometric deja `loading` como corresponde a su intento; aquí solo si no llegó a empezar otro.
      if (intentoRef.current === previo) setLoading(false);
    }
  };

  /**
   * «Entrar solo al escritorio»: pide sesión al servidor si responde; si no hay red (o el servidor cae)
   * entra igual en modo local — gestos, banco de voz y memoria de la mesa funcionan sin cerebro, y la app
   * renueva la sesión sola con las credenciales guardadas en cuanto el servidor vuelve.
   */
  const enterBiometric = async (user: DeskUser, maybeClave?: string) => {
    if (!user.correo) {
      setError(tr('Escribe el correo del miembro', 'Type the member’s email'));
      return;
    }
    setLoading(true);
    setError('');
    const persist = maybeClave || clave ? { clave: maybeClave || clave } : undefined;
    const intento = nuevoIntento();
    try {
      const data = await loginBiometric({ name: user.name, role: user.role, correo: normalizeDeskEmail(user.correo) }, 8_000, intento);
      await finish({ name: data.user?.nombre || user.name, role: data.user?.rol || user.role, correo: user.correo }, persist, intento);
    } catch (e: any) {
      // Una entrada vieja (otra empezó, o «atrás»): ni modo local, ni aviso.
      if (esVencida(e) || !deAhora(intento)) return;
      const status = e?.status;
      if (!status || status >= 500) {
        // Sin servidor: escritorio local (quien llega aquí ya confirmó que es el dueño del teléfono).
        await finish({ name: user.name, role: user.role, correo: user.correo }, persist, intento);
        return;
      }
      // El servidor dijo que no: con la clave guardada se intenta entrar de verdad; sin ella, no se pasa.
      // (Antes bastaba con que el correo se hubiera usado alguna vez en este teléfono.)
      if ((status === 401 || status === 403) && persist?.clave) {
        try {
          const data = await loginClave(normalizeDeskEmail(user.correo), persist.clave, intento);
          await finish({ name: data.miembro?.nombre || user.name, role: data.miembro?.rol || user.role, correo: user.correo }, persist, intento);
          return;
        } catch {
          /* la clave guardada ya no sirve: se pide escribirla */
        }
        if (!deAhora(intento)) return;
      }
      setError(status === 401 || status === 403 ? tr('Tu sesión no se pudo renovar. Escribe tu clave para entrar.', 'Your session couldn’t be renewed. Type your password to sign in.') : tr('No pude abrir el escritorio. Intenta en un momento.', 'Couldn’t open the desk. Try again in a moment.'));
      setPhase('clave');
    } finally {
      if (intentoRef.current === intento) setLoading(false);
    }
  };

  /**
   * «Entrar solo al escritorio» abre la mesa sin escribir la clave, así que primero se confirma que quien
   * lo toca es el dueño del teléfono (huella, cara o PIN del sistema). Un teléfono sin ningún bloqueo no
   * tiene con qué confirmar: ahí pasa, como pasaría cualquiera que lo desbloquee.
   */
  const entrarEscritorio = async () => {
    setError('');
    try {
      const nivel = await LocalAuthentication.getEnrolledLevelAsync();
      if (nivel !== LocalAuthentication.SecurityLevel.NONE) {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: tr('Confirma que eres tú', 'Confirm it’s you'), disableDeviceFallback: false });
        if (!r.success) {
          setError(tr('Necesito confirmar que eres tú para abrir la mesa.', 'I need to confirm it’s you to open the desk.'));
          return;
        }
      }
    } catch {
      setError(tr('No pude confirmar que eres tú. Escribe tu clave.', 'Couldn’t confirm it’s you. Type your password.'));
      return;
    }
    const creds = await loadCreds();
    const guardada = creds && normalizeDeskEmail(creds.correo) === normalizeDeskEmail(activeUser.correo) ? creds.clave : undefined;
    await enterBiometric(activeUser, clave || guardada || undefined);
  };

  const enterWithClave = async () => {
    const user = activeUser;
    if (!user.correo) {
      setError(tr('Escribe el correo Orden Global', 'Type your Orden Global email'));
      return;
    }
    if (!clave.trim()) {
      setError(tr('Escribe tu clave, o usa «Entrar solo al escritorio».', 'Type your password, or use “Open the desk only”.'));
      return;
    }
    setLoading(true);
    setError('');
    const intento = nuevoIntento();
    try {
      const data = await loginClave(normalizeDeskEmail(user.correo), clave, intento);
      await finish(
        {
          name: data.miembro?.nombre || user.name,
          role: data.miembro?.rol || user.role,
          correo: user.correo,
        },
        { clave },
        intento
      );
    } catch (e: any) {
      // Una entrada vieja (otra empezó, o «atrás»): ni modo local, ni aviso.
      if (esVencida(e) || !deAhora(intento)) return;
      const status = e?.status;
      if (!status || status >= 500) {
        // Servidor sin respuesta: solo dejo pasar si la clave coincide con la última validada en este teléfono.
        const creds = await loadCreds();
        if (!deAhora(intento)) return;
        if (creds && normalizeDeskEmail(creds.correo) === normalizeDeskEmail(user.correo) && creds.clave === clave) {
          await finish({ name: creds.name || user.name, role: user.role, correo: user.correo }, { clave }, intento);
          return;
        }
        setError(tr('El servidor no responde y no tengo tu clave verificada en este teléfono. Intenta en un momento.', 'The server isn’t answering and your password isn’t verified on this phone. Try again in a moment.'));
        return;
      }
      setError(status === 401 || status === 403 ? tr('Correo o clave incorrectos.', 'Wrong email or password.') : e?.message || tr('No pude verificar la clave.', 'Couldn’t verify the password.'));
    } finally {
      if (intentoRef.current === intento) setLoading(false);
    }
  };

  const pickUser = (u: DeskUser) => {
    abandonarIntento();
    setSelected(u);
    setError('');
    if (u.id === 'otro') setCustomCorreo('');
    setPhase('clave');
  };

  const irA = (f: Fase) => {
    abandonarIntento();
    setError('');
    setListo('');
    vibrar('seleccion');
    if (f === 'olvide' && !correoOlvido) setCorreoOlvido(activeUser.correo || '');
    setPhase(f);
  };

  const enviarOlvido = async () => {
    const correo = normalizeDeskEmail(correoOlvido);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return setError(tr('Escribe un correo válido.', 'Type a valid email.'));
    setLoading(true);
    setError('');
    try {
      setListo(await olvideClave(correo));
      vibrar('exito');
    } catch (e: any) {
      setError(!e?.status ? tr('Sin conexión con el servidor. Intenta en un momento.', 'No connection to the server. Try again in a moment.') : e?.message || tr('No pude enviar el enlace.', 'Couldn’t send the link.'));
    } finally {
      setLoading(false);
    }
  };

  const enviarSolicitud = async () => {
    if (nuevoNombre.trim().length < 3) return setError(tr('Escribe tu nombre completo.', 'Type your full name.'));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nuevoCorreo.trim())) return setError(tr('Escribe un correo válido.', 'Type a valid email.'));
    if (nuevoMotivo.trim().length < 5) return setError(tr('Cuéntanos en una línea para qué necesitas el acceso.', 'Tell us in one line why you need access.'));
    setLoading(true);
    setError('');
    try {
      setListo(await pedirCuenta(nuevoNombre, nuevoCorreo, nuevoMotivo));
      vibrar('exito');
    } catch (e: any) {
      setError(!e?.status ? tr('Sin conexión con el servidor. Intenta en un momento.', 'No connection to the server. Try again in a moment.') : e?.message || tr('No pude enviar la solicitud.', 'Couldn’t send the request.'));
    } finally {
      setLoading(false);
    }
  };


  const titulo =
    phase === 'crear'
      ? tr('Pedir acceso', 'Request access')
      : phase === 'olvide'
        ? tr('Recuperar clave', 'Recover password')
        : phase === 'quick'
          ? `${tr('Hola', 'Hi')}, ${savedName}`
          : phase === 'pick'
            ? tr('Otras formas de entrar', 'Other ways in')
            : tr('Entrar con clave', 'Sign in with password');
  const subtitulo =
    phase === 'crear'
      ? tr('AU-RA es privada: tu solicitud la revisa la administración de Orden Global.', 'AU-RA is private: Orden Global’s administration reviews your request.')
      : phase === 'olvide'
        ? tr('Te mandamos un enlace para poner una clave nueva. Vale 30 minutos.', 'We’ll send you a link to set a new password. It’s valid for 30 minutes.')
        : phase === 'quick'
          ? tr('Tu huella abre la mesa.', 'Your fingerprint opens the desk.')
          : phase === 'pick'
            ? tr('Con tu cuenta de AU-RA: correo y clave, o tu huella.', 'With your AU-RA account: email and password, or your fingerprint.')
            : activeUser.correo || tr('Tu correo de Orden Global', 'Your Orden Global email');

  const errorVisible = !!error && (
    <Aparecer desde="escala">
      <View style={[est.error, { backgroundColor: tema.avisoFondo }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Icono nombre="alerta" tam={17} color={tema.aviso} />
        <Texto v="chica" color="aviso" style={{ flex: 1 }}>
          {error}
        </Texto>
      </View>
    </Aparecer>
  );

  const hecho = (texto: string, volverA: Fase) => (
    <Aparecer desde="escala" style={{ gap: MEDIDA.espacio.l }}>
      <View style={[est.listo, { backgroundColor: tema.exitoFondo }]}>
        <Icono nombre="check" tam={20} color={tema.exito} />
        <Texto v="cuerpo" color="texto" style={{ flex: 1 }}>
          {texto}
        </Texto>
      </View>
      <Boton titulo={tr('Volver a entrar', 'Back to sign in')} onPress={() => irA(volverA)} />
    </Aparecer>
  );

  let contenido;
  if (phase === 'quick') {
    contenido = (
      <View style={est.bloque}>
        <Boton titulo={tr('Entrar con huella', 'Sign in with fingerprint')} icono="huella" onPress={() => void enterWithFingerprint()} cargando={loading} />
        <Boton titulo={tr('Usar clave', 'Use password')} variante="secundario" onPress={() => irA('clave')} />
        <Boton titulo={tr('Cambiar de cuenta', 'Switch account')} variante="fantasma" onPress={() => irA('pick')} />
        {errorVisible}
      </View>
    );
  } else if (phase === 'pick') {
    contenido = (
      <View style={est.bloque}>
        <Grupo titulo={tr('Cuentas de la junta', 'Board accounts')}>
          {DESK_USERS.map((u) => (
            <Fila key={u.id} titulo={u.name} detalle={u.correo} derecha={<Inicial letra={u.name[0]} />} onPress={() => pickUser(u)} />
          ))}
          <Fila titulo={tr('Otra cuenta', 'Another account')} detalle={tr('Entrar con otro correo', 'Sign in with another email')} icono="correo" onPress={() => pickUser(OTRO_TEMPLATE)} />
        </Grupo>
        <Grupo>
          <Fila titulo={tr('Pedir acceso', 'Request access')} detalle={tr('AU-RA es privada: lo aprueba Orden Global', 'AU-RA is private: Orden Global approves it')} icono="mas" onPress={() => irA('crear')} />
          <Fila titulo={tr('Olvidé mi clave', 'Forgot my password')} icono="llave" onPress={() => irA('olvide')} />
        </Grupo>
        {errorVisible}
        <View style={est.trio} accessibilityLabel={AVATARES.map((a) => de(a.nombre)).join(', ')}>
          {AVATARES.map((a) => (
            <View key={a.id} style={[est.trioFoto, { borderColor: tema.borde }]}>
              <MiniAvatar id={a.id} lado={52} />
            </View>
          ))}
        </View>
        <Texto v="chica" color="texto3" centro>
          {tr('Guardián, AU-RA y Claudio te esperan adentro.', 'Guardian, AU-RA and Claudio are waiting inside.')}
        </Texto>
      </View>
    );
  } else if (phase === 'crear') {
    contenido = listo ? (
      hecho(listo, 'pick')
    ) : (
      <View style={est.bloque}>
        <Campo etiqueta={tr('Nombre completo', 'Full name')} value={nuevoNombre} onChangeText={setNuevoNombre} autoCapitalize="words" autoComplete="name" textContentType="name" />
        <Campo etiqueta={tr('Correo', 'Email')} value={nuevoCorreo} onChangeText={setNuevoCorreo} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
        <Campo etiqueta={tr('¿Para qué necesitas el acceso?', 'Why do you need access?')} value={nuevoMotivo} onChangeText={setNuevoMotivo} autoCapitalize="sentences" multiline style={{ minHeight: 72, textAlignVertical: 'top' }} />
        {errorVisible}
        <Boton titulo={tr('Enviar solicitud', 'Send request')} onPress={() => void enviarSolicitud()} cargando={loading} />
        <Boton titulo={tr('Ya tengo cuenta', 'I already have an account')} variante="fantasma" onPress={() => irA('pick')} />
      </View>
    );
  } else if (phase === 'olvide') {
    contenido = listo ? (
      hecho(listo, 'clave')
    ) : (
      <View style={est.bloque}>
        <Campo
          etiqueta={tr('Correo de tu cuenta', 'Your account email')}
          value={correoOlvido}
          onChangeText={setCorreoOlvido}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          onSubmitEditing={() => void enviarOlvido()}
        />
        {errorVisible}
        <Boton titulo={tr('Enviarme el enlace', 'Send me the link')} icono="correo" onPress={() => void enviarOlvido()} cargando={loading} />
      </View>
    );
  } else {
    contenido = (
      <View style={est.bloque}>
        <Grupo>
          <Fila
            titulo={activeUser.name || selected.name}
            detalle={selected.id === 'otro' ? tr('Otra cuenta', 'Another account') : activeUser.correo}
            derecha={<Inicial letra={(activeUser.name || selected.name || '?')[0]} />}
            valor={tr('Cambiar', 'Switch')}
            onPress={() => irA('pick')}
          />
        </Grupo>
        {selected.id === 'otro' && (
          <Campo etiqueta={tr('Correo', 'Email')} value={customCorreo} onChangeText={setCustomCorreo} placeholder="correo@ordenglobal.org" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
        )}
        <Campo
          etiqueta={tr('Clave', 'Password')}
          clave
          value={clave}
          onChangeText={setClave}
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={() => void enterWithClave()}
          returnKeyType="go"
        />
        <Grupo>
          <Fila titulo={tr('Guardar la clave en este teléfono', 'Save the password on this phone')} icono="candado" derecha={<Interruptor valor={remember} onCambiar={setRemember} etiqueta={tr('Guardar la clave', 'Save the password')} />} />
          {fingerprintAvailable && (
            <Fila titulo={tr('Entrar con huella la próxima vez', 'Use fingerprint next time')} icono="huella" derecha={<Interruptor valor={useFingerprint} onCambiar={setUseFingerprint} etiqueta={tr('Entrar con huella', 'Sign in with fingerprint')} />} />
          )}
        </Grupo>
        {errorVisible}
        <Boton titulo={tr('Entrar', 'Sign in')} onPress={() => void enterWithClave()} cargando={loading} />
        <Boton titulo={tr('Entrar solo al escritorio', 'Open the desk only')} variante="secundario" onPress={() => void entrarEscritorio()} deshabilitado={loading} />
        {fingerprintAvailable && remember && useFingerprint && claveGuardada && (
          <Boton titulo={tr('Usar mi huella', 'Use my fingerprint')} icono="huella" variante="secundario" onPress={() => void enterWithFingerprint()} deshabilitado={loading} />
        )}
        <View style={est.enlaces}>
          <Boton titulo={tr('Olvidé mi clave', 'Forgot my password')} variante="fantasma" tam="chico" onPress={() => irA('olvide')} />
          <Boton titulo={tr('Pedir acceso', 'Request access')} variante="fantasma" tam="chico" onPress={() => irA('crear')} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: tema.fondo }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <PantallaConCabecera titulo={titulo} subtitulo={subtitulo} onAtras={volver}>
        <Aparecer clave={phase} desde="derecha" distancia={24} style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}>
          {contenido}
        </Aparecer>
      </PantallaConCabecera>
    </KeyboardAvoidingView>
  );
}

const est = StyleSheet.create({
  bloque: { gap: MEDIDA.espacio.l, width: '100%' },
  inicial: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  error: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: MEDIDA.radio.m, alignItems: 'center' },
  listo: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: MEDIDA.radio.m, alignItems: 'flex-start' },
  enlaces: { flexDirection: 'row', justifyContent: 'space-between' },
  trio: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginTop: MEDIDA.espacio.s },
  trioFoto: { width: 52, height: 52, borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
});
