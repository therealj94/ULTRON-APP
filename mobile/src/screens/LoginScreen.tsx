import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
  ScrollView,
  Image,
} from 'react-native';
import { T, SOMBRA } from '../tema';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  DESK_USERS,
  findDeskUserByEmail,
  normalizeDeskEmail,
  type DeskUser,
  type SessionUser,
} from '../config';
import { loginBiometric, loginClave } from '../lib/api';
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

const OTRO_TEMPLATE: DeskUser = {
  id: 'otro',
  name: 'Otro miembro',
  correo: '',
  role: 'Junta Directiva · Orden Global',
};

export function LoginScreen({ onAuthenticated }: Props) {
  const [selected, setSelected] = useState<DeskUser>(DESK_USERS[0]);
  const [customCorreo, setCustomCorreo] = useState('');
  const [phase, setPhase] = useState<'pick' | 'clave' | 'quick'>('pick');
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
        setError('No pude leer tus datos guardados. Escribe tu clave para entrar.');
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
        promptMessage: 'Desbloquear AU-RA FP',
        cancelLabel: 'Usar clave',
        disableDeviceFallback: false,
        biometricsSecurityLevel: 'weak',
      });
      if (!result.success) {
        setError('Huella cancelada. Usa tu clave.');
        setPhase('clave');
        return;
      }
      const creds = await loadCreds();
      const user =
        findDeskUserByEmail(creds?.correo || '') ||
        (activeUser.correo ? activeUser : selected);
      await enterBiometric(user, creds?.clave);
    } catch (e: any) {
      setError(e?.message || 'No se pudo usar la huella');
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
      setError('Escribe el correo del miembro');
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
      setError(status === 401 || status === 403 ? 'Tu sesión no se pudo renovar. Escribe tu clave para entrar.' : 'No pude abrir el escritorio. Intenta en un momento.');
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
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirma que eres tú', disableDeviceFallback: false });
        if (!r.success) {
          setError('Necesito confirmar que eres tú para abrir la mesa.');
          return;
        }
      }
    } catch {
      setError('No pude confirmar que eres tú. Escribe tu clave.');
      return;
    }
    const creds = await loadCreds();
    const guardada = creds && normalizeDeskEmail(creds.correo) === normalizeDeskEmail(activeUser.correo) ? creds.clave : undefined;
    await enterBiometric(activeUser, clave || guardada || undefined);
  };

  const enterWithClave = async () => {
    const user = activeUser;
    if (!user.correo) {
      setError('Escribe el correo Orden Global');
      return;
    }
    if (!clave.trim()) {
      setError('Escribe tu clave, o usa «Entrar solo al escritorio».');
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
        setError('El servidor no responde y no tengo tu clave verificada en este teléfono. Intenta en un momento.');
        return;
      }
      setError(status === 401 || status === 403 ? 'Correo o clave incorrectos.' : e?.message || 'No pude verificar la clave.');
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

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        bounces
      >
        <Image
          source={require('../../assets/marca/logo-aura.png')}
          resizeMode="contain"
          accessibilityLabel="AU-RA by Orden Global"
          style={[styles.logo, { opacity: logoReady ? 1 : 0 }]}
        />
        <Text style={styles.sub}>Junta Directiva · Orden Global</Text>
        <View style={styles.card}>

          {phase === 'quick' ? (
            <View style={{ gap: 12, width: '100%', alignItems: 'center' }}>
              <Text style={styles.welcome}>Hola, {savedName}</Text>
              <Pressable
                onPress={() => void enterWithFingerprint()}
                style={styles.primary}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Entrar con huella"
                accessibilityState={{ busy: loading, disabled: loading }}
              >
                {loading ? (
                  <ActivityIndicator color={T.sobrePrincipal} />
                ) : (
                  <Text style={styles.primaryText}>Entrar con huella</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setPhase('clave')} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>Usar clave</Text>
              </Pressable>
              <Pressable onPress={() => setPhase('pick')} style={styles.linkBtn} accessibilityRole="button">
                <Text style={styles.link}>Cambiar usuario</Text>
              </Pressable>
            </View>
          ) : phase === 'pick' ? (
            <View style={{ gap: 10, width: '100%' }}>
              <Text style={styles.hint}>¿Quién está en la mesa?</Text>
              {DESK_USERS.map((u) => (
                <Pressable key={u.id} onPress={() => pickUser(u)} style={styles.userBtn} accessibilityRole="button" accessibilityLabel={`${u.name}, ${u.correo}`}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{u.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>{u.name}</Text>
                    <Text style={styles.userMail}>{u.correo}</Text>
                  </View>
                </Pressable>
              ))}
              <Pressable onPress={() => pickUser(OTRO_TEMPLATE)} style={styles.userBtn} accessibilityRole="button" accessibilityLabel="Otro miembro: escribir correo">
                <View style={[styles.avatar, { backgroundColor: T.fondo2 }]}>
                  <Text style={[styles.avatarText, { color: T.texto2 }]}>+</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>Otro miembro</Text>
                  <Text style={styles.userMail}>Escribir correo @ordenglobal.org</Text>
                </View>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 12, width: '100%' }}>
              <Pressable
                onPress={() => setPhase('pick')}
                style={styles.linkBtn}
                accessibilityRole="button"
                accessibilityLabel={`Cambiar usuario (ahora: ${activeUser.name || selected.name})`}
              >
                <Text style={styles.back}>← {activeUser.name || selected.name}</Text>
              </Pressable>
              {selected.id === 'otro' && (
                <TextInput
                  value={customCorreo}
                  onChangeText={setCustomCorreo}
                  placeholder="correo@ordenglobal.org"
                  placeholderTextColor={T.texto3}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.input}
                />
              )}
              {selected.id !== 'otro' && (
                <Text style={styles.userMailCenter}>{activeUser.correo}</Text>
              )}
              <TextInput
                value={clave}
                onChangeText={setClave}
                placeholder="Clave de ultron.ordenglobal.link"
                placeholderTextColor={T.texto3}
                secureTextEntry
                style={styles.input}
                autoCapitalize="none"
                onSubmitEditing={() => void enterWithClave()}
              />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Guardar contraseña</Text>
                <Switch
                  value={remember}
                  onValueChange={setRemember}
                  accessibilityLabel="Guardar contraseña"
                  trackColor={{ true: T.activo, false: T.borde }}
                  thumbColor={T.panel}
                />
              </View>
              {fingerprintAvailable && (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Desbloqueo con huella</Text>
                  <Switch
                    value={useFingerprint}
                    onValueChange={setUseFingerprint}
                    accessibilityLabel="Desbloqueo con huella"
                    trackColor={{ true: T.activo, false: T.borde }}
                  thumbColor={T.panel}
                  />
                </View>
              )}
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                onPress={() => void enterWithClave()}
                style={styles.primary}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Entrar"
                accessibilityState={{ busy: loading, disabled: loading }}
              >
                {loading ? (
                  <ActivityIndicator color={T.sobrePrincipal} />
                ) : (
                  <Text style={styles.primaryText}>Entrar</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => void entrarEscritorio()}
                style={styles.secondary}
                disabled={loading}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>Entrar solo al escritorio</Text>
              </Pressable>
              {fingerprintAvailable && remember && useFingerprint && claveGuardada && (
                <Pressable
                  onPress={() => void enterWithFingerprint()}
                  style={styles.secondary}
                  disabled={loading}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Probar huella ahora</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.fondo },
  scroll: { flex: 1, width: '100%' },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  logo: { width: 300, height: 113 },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 28,
    backgroundColor: T.panel,
    padding: 22,
    alignItems: 'center',
    gap: 10,
    ...SOMBRA,
  },
  sub: { color: T.texto2, fontSize: 14, marginTop: 2, marginBottom: 16 },
  hint: { color: T.texto2, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  welcome: { color: T.texto, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  userBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: T.fondo,
    borderWidth: 1,
    borderColor: T.borde,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: T.principalFondo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: T.principalTexto, fontWeight: '700', fontSize: 17 },
  userName: { color: T.texto, fontSize: 16, fontWeight: '700' },
  userMail: { color: T.texto3, fontSize: 12 },
  userMailCenter: { color: T.texto2, fontSize: 13, textAlign: 'center' },
  back: { color: T.principalTexto, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: T.borde,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: T.texto,
    backgroundColor: T.fondo,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: T.texto, fontSize: 14 },
  error: { color: T.avisoTexto, fontSize: 13 },
  primary: {
    backgroundColor: T.principal,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
  },
  primaryText: { color: T.sobrePrincipal, fontWeight: '700', fontSize: 16 },
  secondary: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: T.activoFondo,
    width: '100%',
  },
  secondaryText: { color: T.activoTexto, fontSize: 14, fontWeight: '600' },
  link: { color: T.texto3, fontSize: 13, textDecorationLine: 'underline' },
  // Enlaces de solo texto: el área de toque llega a 44 px aunque la letra sea chica.
  linkBtn: { minHeight: 44, justifyContent: 'center' },
});
