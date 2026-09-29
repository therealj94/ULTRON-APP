import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Switch,
  ScrollView,
  Image,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { T, SOMBRA } from '../tema';
import { Boton } from '../ui/Boton';
import { Campo } from '../ui/Campo';
import { MiniAvatar } from '../avatares/MiniAvatar';
import { AVATARES } from '../avatares/catalogo';
import { SelectorIdioma } from '../ui/SelectorIdioma';
import { de, tr, useIdioma } from '../i18n';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  DESK_USERS,
  findDeskUserByEmail,
  normalizeDeskEmail,
  type DeskUser,
  type SessionUser,
} from '../config';
import { loginBiometric, loginClave, olvideClave, pedirCuenta } from '../lib/api';
import { miga } from '../lib/reporte';
import {
  getFingerprintUnlock,
  loadCreds,
  saveCreds,
  saveSession,
  setFingerprintUnlock,
} from '../lib/storage';

type Props = {
  onAuthenticated: (user: SessionUser) => void;
};

type Fase = 'pick' | 'clave' | 'quick' | 'crear' | 'olvide';

const OTRO_TEMPLATE: DeskUser = {
  id: 'otro',
  name: 'Otro miembro',
  correo: '',
  role: 'Junta Directiva · Orden Global',
};

export function LoginScreen({ onAuthenticated }: Props) {
  // El idioma se elige aquí (arriba a la derecha): toda la pantalla se redibuja al cambiarlo.
  useIdioma();
  const [selected, setSelected] = useState<DeskUser>(DESK_USERS[0]);
  const [customCorreo, setCustomCorreo] = useState('');
  const [phase, setPhase] = useState<Fase>('pick');
  // Crear cuenta y olvidé la clave: sus propios campos y su respuesta del servidor.
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCorreo, setNuevoCorreo] = useState('');
  const [nuevoMotivo, setNuevoMotivo] = useState('');
  const [correoOlvido, setCorreoOlvido] = useState('');
  const [listo, setListo] = useState('');
  const { width, height } = useWindowDimensions();
  const horizontal = width > height;
  // Cada cambio de paso entra deslizándose, como una pantalla nativa (no aparece de golpe).
  const entrada = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    entrada.setValue(0);
    Animated.timing(entrada, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [phase, entrada]);
  // Atrás de Android: vuelve al paso anterior en vez de cerrar la app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase === 'crear' || phase === 'olvide' || phase === 'clave') {
        setError('');
        setListo('');
        setPhase(phase === 'clave' ? 'pick' : 'clave');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [phase]);
  const [clave, setClave] = useState('');
  /** Hay una clave guardada en este teléfono (no se muestra; la usan la huella y la renovación). */
  const [claveGuardada, setClaveGuardada] = useState(false);
  const [remember, setRemember] = useState(true);
  const [useFingerprint, setUseFingerprint] = useState(true);
  const [fingerprintAvailable, setFingerprintAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logoReady, setLogoReady] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);

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
    const t = setTimeout(() => setLogoReady(true), 60);
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
          setPhase('clave');
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
      clearTimeout(t);
    };
  }, []);

  const finish = async (user: SessionUser, persist?: { clave: string }) => {
    const correo = normalizeDeskEmail(user.correo);
    const session = { ...user, correo };
    try {
      await saveSession(session);
      if (remember && persist?.clave) {
        await saveCreds({ correo, clave: persist.clave, name: session.name });
      } else if (!remember) {
        await saveCreds(null);
      }
      // Huella: se enciende solo con la clave guardada (la usa para entrar); apagar el interruptor, o no
      // guardar la contraseña, la apaga de verdad (antes se quedaba activa y seguía pidiendo la huella).
      if (!remember || (fingerprintAvailable && !useFingerprint)) {
        await setFingerprintUnlock(false);
      } else if (persist?.clave && useFingerprint && fingerprintAvailable) {
        await setFingerprintUnlock(true, correo);
      }
    } catch (e) {
      // Ya se verificó quién es: si el teléfono no deja guardar, entra igual (la próxima vez pedirá la clave).
      miga(`entrada: no se pudo guardar (${e instanceof Error ? e.message : String(e)})`);
    }
    onAuthenticated(session);
  };

  const enterWithFingerprint = async () => {
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
      setLoading(false);
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
    try {
      const data = await loginBiometric({ name: user.name, role: user.role, correo: normalizeDeskEmail(user.correo) }, 8_000);
      await finish({ name: data.user?.nombre || user.name, role: data.user?.rol || user.role, correo: user.correo }, persist);
    } catch (e: any) {
      const status = e?.status;
      if (!status || status >= 500) {
        // Sin servidor: escritorio local (quien llega aquí ya confirmó que es el dueño del teléfono).
        await finish({ name: user.name, role: user.role, correo: user.correo }, persist);
        return;
      }
      // El servidor dijo que no: con la clave guardada se intenta entrar de verdad; sin ella, no se pasa.
      // (Antes bastaba con que el correo se hubiera usado alguna vez en este teléfono.)
      if ((status === 401 || status === 403) && persist?.clave) {
        try {
          const data = await loginClave(normalizeDeskEmail(user.correo), persist.clave);
          await finish({ name: data.miembro?.nombre || user.name, role: data.miembro?.rol || user.role, correo: user.correo }, persist);
          return;
        } catch {
          /* la clave guardada ya no sirve: se pide escribirla */
        }
      }
      setError(status === 401 || status === 403 ? tr('Tu sesión no se pudo renovar. Escribe tu clave para entrar.', 'Your session couldn’t be renewed. Type your password to sign in.') : tr('No pude abrir el escritorio. Intenta en un momento.', 'Couldn’t open the desk. Try again in a moment.'));
      setPhase('clave');
    } finally {
      setLoading(false);
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
    try {
      const data = await loginClave(normalizeDeskEmail(user.correo), clave);
      await finish(
        {
          name: data.miembro?.nombre || user.name,
          role: data.miembro?.rol || user.role,
          correo: user.correo,
        },
        { clave }
      );
    } catch (e: any) {
      const status = e?.status;
      if (!status || status >= 500) {
        // Servidor sin respuesta: solo dejo pasar si la clave coincide con la última validada en este teléfono.
        const creds = await loadCreds();
        if (creds && normalizeDeskEmail(creds.correo) === normalizeDeskEmail(user.correo) && creds.clave === clave) {
          await finish({ name: creds.name || user.name, role: user.role, correo: user.correo }, { clave });
          return;
        }
        setError(tr('El servidor no responde y no tengo tu clave verificada en este teléfono. Intenta en un momento.', 'The server isn’t answering and your password isn’t verified on this phone. Try again in a moment.'));
        return;
      }
      setError(status === 401 || status === 403 ? tr('Correo o clave incorrectos.', 'Wrong email or password.') : e?.message || tr('No pude verificar la clave.', 'Couldn’t verify the password.'));
    } finally {
      setLoading(false);
    }
  };

  const pickUser = (u: DeskUser) => {
    setSelected(u);
    setError('');
    if (u.id === 'otro') setCustomCorreo('');
    setPhase('clave');
  };

  const irA = (f: Fase) => {
    setError('');
    setListo('');
    void Haptics.selectionAsync().catch(() => {});
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
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      setError(!e?.status ? tr('Sin conexión con el servidor. Intenta en un momento.', 'No connection to the server. Try again in a moment.') : e?.message || tr('No pude enviar la solicitud.', 'Couldn’t send the request.'));
    } finally {
      setLoading(false);
    }
  };


  const titulo =
    phase === 'crear' ? tr('Pedir acceso', 'Request access') : phase === 'olvide' ? tr('Recuperar clave', 'Recover password') : phase === 'quick' ? `${tr('Hola', 'Hi')}, ${savedName}` : phase === 'pick' ? tr('¿Quién entra?', 'Who’s signing in?') : tr('Entrar', 'Sign in');
  const subtitulo =
    phase === 'crear'
      ? tr('AU-RA es privada: tu solicitud la revisa la administración de Orden Global.', 'AU-RA is private: Orden Global’s administration reviews your request.')
      : phase === 'olvide'
        ? tr('Te mandamos un enlace para poner una clave nueva. Vale 30 minutos.', 'We’ll send you a link to set a new password. It’s valid for 30 minutes.')
        : phase === 'quick'
          ? tr('Tu huella abre la mesa.', 'Your fingerprint opens the desk.')
          : phase === 'pick'
            ? tr('Elige tu cuenta de la junta.', 'Choose your board account.')
            : activeUser.correo || tr('Tu correo de Orden Global', 'Your Orden Global email');

  const marca = (
    <View style={[styles.marca, horizontal && styles.marcaHorizontal]}>
      <Image
        source={require('../../assets/marca/logo-aura.png')}
        resizeMode="contain"
        accessibilityLabel="AU-RA by Orden Global"
        style={[horizontal ? styles.logoGrande : styles.logo, { opacity: logoReady ? 1 : 0 }]}
      />
      {horizontal && (
        <>
          <Text style={styles.lemaGrande}>{tr('Tu mesa de trabajo con voz, ojos y memoria.', 'Your workspace with a voice, eyes and memory.')}</Text>
          <View style={styles.trio} accessibilityLabel={AVATARES.map((a) => de(a.nombre)).join(', ')}>
            {AVATARES.map((a) => (
              <View key={a.id} style={[styles.trioFoto, { borderColor: a.tema.acento }]}>
                <MiniAvatar id={a.id} lado={76} />
              </View>
            ))}
          </View>
          <Text style={styles.trioTexto}>{AVATARES.map((a) => de(a.nombre)).join(' · ')}</Text>
          <Text style={styles.trioNota}>{tr('Eliges con quién hablar al entrar.', 'You pick who to talk to after signing in.')}</Text>
          <View style={{ marginTop: 14 }}>
            <SelectorIdioma />
          </View>
        </>
      )}
    </View>
  );

  const tarjeta = (
    <Animated.View
      style={[
        styles.card,
        horizontal && styles.cardCompacta,
        { opacity: entrada, transform: [{ translateX: entrada.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] },
      ]}
    >
      <Text style={[styles.titulo, horizontal && { fontSize: 20 }]}>{titulo}</Text>
      <Text style={[styles.subtitulo, horizontal && { marginBottom: 8 }]} numberOfLines={2}>{subtitulo}</Text>

      {phase === 'quick' ? (
        <View style={styles.bloque}>
          <Boton titulo={tr('Entrar con huella', 'Sign in with fingerprint')} onPress={() => void enterWithFingerprint()} cargando={loading} />
          <Boton titulo={tr('Usar clave', 'Use password')} variante="contorno" onPress={() => irA('clave')} />
          <Boton titulo={tr('Cambiar de cuenta', 'Switch account')} variante="texto" onPress={() => irA('pick')} />
        </View>
      ) : phase === 'pick' ? (
        <View style={styles.bloque}>
          {DESK_USERS.map((u) => (
            <Pressable
              key={u.id}
              onPress={() => pickUser(u)}
              android_ripple={{ color: 'rgba(214,181,108,0.14)' }}
              style={({ pressed }) => [styles.userBtn, horizontal && styles.userBtnCompacto, pressed && styles.userBtnPress]}
              accessibilityRole="button"
              accessibilityLabel={`${u.name}, ${u.correo}`}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{u.name[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{u.name}</Text>
                <Text style={styles.userMail}>{u.correo}</Text>
              </View>
              <Text style={styles.flecha}>›</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => pickUser(OTRO_TEMPLATE)}
            android_ripple={{ color: 'rgba(214,181,108,0.14)' }}
            style={({ pressed }) => [styles.userBtn, horizontal && styles.userBtnCompacto, pressed && styles.userBtnPress]}
            accessibilityRole="button"
            accessibilityLabel={tr('Otra cuenta: escribir correo', 'Another account: type email')}
          >
            <View style={[styles.avatar, { backgroundColor: T.fondo2 }]}>
              <Text style={[styles.avatarText, { color: T.texto2 }]}>+</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{tr('Otra cuenta', 'Another account')}</Text>
              <Text style={styles.userMail}>{tr('Entrar con otro correo', 'Sign in with another email')}</Text>
            </View>
            <Text style={styles.flecha}>›</Text>
          </Pressable>
          <View style={styles.filaEnlaces}>
            <Boton titulo={tr('Crear cuenta', 'Create account')} variante="texto" onPress={() => irA('crear')} />
            <Boton titulo={tr('Olvidé mi clave', 'Forgot my password')} variante="texto" onPress={() => irA('olvide')} />
          </View>
        </View>
      ) : phase === 'crear' ? (
        <View style={styles.bloque}>
          {listo ? (
            <>
              <Text style={styles.listo}>{listo}</Text>
              <Boton titulo={tr('Volver a entrar', 'Back to sign in')} onPress={() => irA('pick')} />
            </>
          ) : (
            <>
              <Campo etiqueta={tr('Nombre completo', 'Full name')} value={nuevoNombre} onChangeText={setNuevoNombre} autoCapitalize="words" autoComplete="name" textContentType="name" />
              <Campo etiqueta={tr('Correo', 'Email')} value={nuevoCorreo} onChangeText={setNuevoCorreo} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
              <Campo etiqueta={tr('¿Para qué necesitas el acceso?', 'Why do you need access?')} value={nuevoMotivo} onChangeText={setNuevoMotivo} autoCapitalize="sentences" multiline style={{ minHeight: 64, textAlignVertical: 'top' }} />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Boton titulo={tr('Enviar solicitud', 'Send request')} onPress={() => void enviarSolicitud()} cargando={loading} />
              <Boton titulo={tr('Ya tengo cuenta', 'I already have an account')} variante="texto" onPress={() => irA('pick')} />
            </>
          )}
        </View>
      ) : phase === 'olvide' ? (
        <View style={styles.bloque}>
          {listo ? (
            <>
              <Text style={styles.listo}>{listo}</Text>
              <Boton titulo={tr('Volver a entrar', 'Back to sign in')} onPress={() => irA('clave')} />
            </>
          ) : (
            <>
              <Campo
                etiqueta={tr('Correo de tu cuenta', 'Your account email')}
                value={correoOlvido}
                onChangeText={setCorreoOlvido}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                onSubmitEditing={() => void enviarOlvido()}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Boton titulo={tr('Enviarme el enlace', 'Send me the link')} onPress={() => void enviarOlvido()} cargando={loading} />
              <Boton titulo={tr('Volver', 'Back')} variante="texto" onPress={() => irA('clave')} />
            </>
          )}
        </View>
      ) : (
        <View style={styles.bloque}>
          <Pressable onPress={() => irA('pick')} style={styles.cuentaChip} accessibilityRole="button" accessibilityLabel={`${tr('Cambiar de cuenta', 'Switch account')} (${activeUser.name || selected.name})`}>
            <View style={styles.avatarChico}>
              <Text style={styles.avatarChicoText}>{(activeUser.name || selected.name || '?')[0]}</Text>
            </View>
            <Text style={styles.cuentaNombre}>{activeUser.name || selected.name}</Text>
            <Text style={styles.cuentaCambiar}>{tr('Cambiar', 'Switch')}</Text>
          </Pressable>
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
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{tr('Guardar la clave en este teléfono', 'Save the password on this phone')}</Text>
            <Switch value={remember} onValueChange={setRemember} accessibilityLabel={tr('Guardar la clave', 'Save the password')} trackColor={{ true: T.activo, false: T.borde }} thumbColor={T.texto} />
          </View>
          {fingerprintAvailable && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{tr('Entrar con huella la próxima vez', 'Use fingerprint next time')}</Text>
              <Switch value={useFingerprint} onValueChange={setUseFingerprint} accessibilityLabel={tr('Entrar con huella', 'Sign in with fingerprint')} trackColor={{ true: T.activo, false: T.borde }} thumbColor={T.texto} />
            </View>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Boton titulo={tr('Entrar', 'Sign in')} onPress={() => void enterWithClave()} cargando={loading} />
          <Boton titulo={tr('Entrar solo al escritorio', 'Open the desk only')} variante="secundario" onPress={() => void entrarEscritorio()} deshabilitado={loading} />
          {fingerprintAvailable && remember && useFingerprint && claveGuardada && (
            <Boton titulo={tr('Usar mi huella', 'Use my fingerprint')} variante="contorno" onPress={() => void enterWithFingerprint()} deshabilitado={loading} />
          )}
          <View style={styles.filaEnlaces}>
            <Boton titulo={tr('Olvidé mi clave', 'Forgot my password')} variante="texto" onPress={() => irA('olvide')} />
            <Boton titulo={tr('Crear cuenta', 'Create account')} variante="texto" onPress={() => irA('crear')} />
          </View>
        </View>
      )}
    </Animated.View>
  );

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View pointerEvents="none" style={styles.brillo} />
      {/* En vertical el idioma va arriba a la derecha; acostado, debajo de los avatares. */}
      {!horizontal && (
        <View style={styles.idioma}>
          <SelectorIdioma />
        </View>
      )}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, horizontal && styles.scrollHorizontal]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {marca}
        <View style={[styles.columnaTarjeta, horizontal && { flex: 1, maxWidth: 460 }]}>{tarjeta}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.fondo },
  brillo: { position: 'absolute', top: -180, right: -140, width: 420, height: 420, borderRadius: 420, backgroundColor: 'rgba(214,181,108,0.035)' },
  scroll: { flex: 1, width: '100%' },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 64, paddingBottom: 28, paddingHorizontal: 18, gap: 18 },
  scrollHorizontal: { flexDirection: 'row', gap: 40, paddingHorizontal: 40, paddingTop: 12, paddingBottom: 12 },
  marca: { alignItems: 'center' },
  marcaHorizontal: { flex: 1, maxWidth: 420, alignItems: 'flex-start' },
  logo: { width: 260, height: 98 },
  logoGrande: { width: 320, height: 120, marginLeft: -12 },
  lemaGrande: { color: T.texto2, fontSize: 18, lineHeight: 26, marginTop: 6, maxWidth: 340 },
  trio: { flexDirection: 'row', gap: 12, marginTop: 22 },
  trioFoto: { width: 76, height: 76, borderRadius: 22, backgroundColor: T.panel, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: T.borde },
  trioTexto: { color: T.texto2, fontSize: 13, marginTop: 8, letterSpacing: 0.5, fontWeight: '600' },
  trioNota: { color: T.texto3, fontSize: 12, marginTop: 2 },
  idioma: { position: 'absolute', top: 14, right: 16, zIndex: 5 },
  columnaTarjeta: { width: '100%', maxWidth: 460, alignItems: 'center' },
  cardCompacta: { padding: 16, gap: 2 },
  card: { width: '100%', borderRadius: 28, backgroundColor: T.panel, padding: 22, gap: 6, borderWidth: 1, borderColor: T.borde, ...SOMBRA },
  titulo: { color: T.texto, fontSize: 24, fontWeight: '800' },
  subtitulo: { color: T.texto2, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  bloque: { gap: 12, width: '100%' },
  userBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: T.fondo, borderWidth: 1, borderColor: T.borde, overflow: 'hidden' },
  userBtnCompacto: { paddingVertical: 8 },
  userBtnPress: { borderColor: T.principal, transform: [{ scale: 0.985 }] },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.principalFondo, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: T.principalTexto, fontWeight: '800', fontSize: 18 },
  userName: { color: T.texto, fontSize: 16, fontWeight: '700' },
  userMail: { color: T.texto3, fontSize: 12, marginTop: 1 },
  flecha: { color: T.texto3, fontSize: 26, marginLeft: 4 },
  filaEnlaces: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  cuentaChip: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', backgroundColor: T.fondo, borderRadius: 999, paddingVertical: 6, paddingLeft: 6, paddingRight: 14, borderWidth: 1, borderColor: T.borde, minHeight: 44 },
  avatarChico: { width: 30, height: 30, borderRadius: 15, backgroundColor: T.principalFondo, alignItems: 'center', justifyContent: 'center' },
  avatarChicoText: { color: T.principalTexto, fontWeight: '800', fontSize: 14 },
  cuentaNombre: { color: T.texto, fontSize: 15, fontWeight: '700' },
  cuentaCambiar: { color: T.principalTexto, fontSize: 13, fontWeight: '600', marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { color: T.texto, fontSize: 14, flex: 1 },
  error: { color: T.avisoTexto, fontSize: 13 },
  listo: { color: T.activoTexto, fontSize: 15, lineHeight: 22, backgroundColor: T.activoFondo, borderRadius: 16, padding: 14 },
});
