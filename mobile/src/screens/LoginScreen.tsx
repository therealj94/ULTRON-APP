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
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { UltronFace } from '../components/UltronFace';
import type { FaceState } from '../config';
import {
  DESK_USERS,
  findDeskUserByEmail,
  normalizeDeskEmail,
  type DeskUser,
  type SessionUser,
} from '../config';
import { loginBiometric, loginClave } from '../lib/api';
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
  const [remember, setRemember] = useState(true);
  const [useFingerprint, setUseFingerprint] = useState(true);
  const [fingerprintAvailable, setFingerprintAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logoReady, setLogoReady] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [focus, setFocus] = useState<'none' | 'mail' | 'clave'>('none');
  const { width } = useWindowDimensions();
  const eye = Math.min(64, Math.round(width * 0.15));
  const faceState: FaceState = loading ? 'THINKING' : error ? 'CONCERNED' : phase === 'quick' ? 'HAPPY' : focus === 'clave' ? 'WINK' : 'IDLE';

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
    void (async () => {
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = hw ? await LocalAuthentication.isEnrolledAsync() : false;
      setFingerprintAvailable(hw && enrolled);

      const fp = await getFingerprintUnlock();
      const creds = await loadCreds();
      if (creds?.correo) {
        const correo = normalizeDeskEmail(creds.correo);
        const match = findDeskUserByEmail(correo);
        if (match) {
          setSelected(match);
          setClave(creds.clave || '');
          setSavedName(match.name);
          setRemember(true);
          if (creds.correo !== match.correo && creds.clave) {
            await saveCreds({ ...creds, correo: match.correo, name: match.name });
          }
          if (fp?.enabled && hw && enrolled) {
            setPhase('quick');
            setUseFingerprint(true);
          } else {
            setPhase('clave');
          }
        } else {
          setSelected(OTRO_TEMPLATE);
          setCustomCorreo(correo);
          setClave(creds.clave || '');
          setSavedName(creds.name || correo);
          setPhase('clave');
        }
      }
    })();
    return () => clearTimeout(t);
  }, []);

  const finish = async (user: SessionUser, persist?: { clave: string }) => {
    const correo = normalizeDeskEmail(user.correo);
    const session = { ...user, correo };
    await saveSession(session);
    if (remember && persist?.clave) {
      await saveCreds({ correo, clave: persist.clave, name: session.name });
      if (useFingerprint && fingerprintAvailable) {
        await setFingerprintUnlock(true, correo);
      }
    } else if (!remember) {
      await saveCreds(null);
      await setFingerprintUnlock(false);
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
      const creds = await loadCreds();
      const known = !!creds && normalizeDeskEmail(creds.correo) === normalizeDeskEmail(user.correo);
      if (!status || status >= 500 || known) {
        // sin servidor, o miembro ya validado antes en este teléfono → escritorio local
        await finish({ name: user.name, role: user.role, correo: user.correo }, persist);
        return;
      }
      setError(status === 401 || status === 403 ? 'La huella y el acceso directo solo abren si ya entraste con clave en este teléfono.' : e?.message || 'No pude abrir el escritorio.');
    } finally {
      setLoading(false);
    }
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
      <LinearGradient
        colors={['rgba(0,229,255,0.16)', 'transparent', '#000']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.75 }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        bounces
      >
        <View pointerEvents="none" style={{ opacity: logoReady ? 1 : 0 }}>
          <UltronFace face={faceState} size={eye} stageHeight={eye * 2.3} gazeX={0} gazeY={focus === 'none' ? 0 : 0.6} />
        </View>
        <Text style={styles.title}>AU-RA FP</Text>
        <Text style={styles.sub}>Junta Directiva · Orden Global</Text>
        <View style={styles.card}>

          {phase === 'quick' ? (
            <View style={{ gap: 12, width: '100%', alignItems: 'center' }}>
              <Text style={styles.welcome}>Hola, {savedName}</Text>
              <Pressable
                onPress={() => void enterWithFingerprint()}
                style={styles.primary}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#001018" />
                ) : (
                  <Text style={styles.primaryText}>Entrar con huella</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setPhase('clave')} style={styles.secondary}>
                <Text style={styles.secondaryText}>Usar clave</Text>
              </Pressable>
              <Pressable onPress={() => setPhase('pick')}>
                <Text style={styles.link}>Cambiar usuario</Text>
              </Pressable>
            </View>
          ) : phase === 'pick' ? (
            <View style={{ gap: 10, width: '100%' }}>
              <Text style={styles.hint}>¿Quién está en la mesa?</Text>
              {DESK_USERS.map((u) => (
                <Pressable key={u.id} onPress={() => pickUser(u)} style={styles.userBtn}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{u.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>{u.name}</Text>
                    <Text style={styles.userMail}>{u.correo}</Text>
                  </View>
                </Pressable>
              ))}
              <Pressable onPress={() => pickUser(OTRO_TEMPLATE)} style={styles.userBtn}>
                <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                  <Text style={[styles.avatarText, { color: '#8B9AAB' }]}>+</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>Otro miembro</Text>
                  <Text style={styles.userMail}>Escribir correo @ordenglobal.org</Text>
                </View>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 12, width: '100%' }}>
              <Pressable onPress={() => setPhase('pick')}>
                <Text style={styles.back}>← {activeUser.name || selected.name}</Text>
              </Pressable>
              {selected.id === 'otro' && (
                <TextInput
                  value={customCorreo}
                  onChangeText={setCustomCorreo}
                  placeholder="correo@ordenglobal.org"
                  placeholderTextColor="#5A6A7A"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.input}
                  onFocus={() => setFocus('mail')}
                  onBlur={() => setFocus('none')}
                />
              )}
              {selected.id !== 'otro' && (
                <Text style={styles.userMailCenter}>{activeUser.correo}</Text>
              )}
              <TextInput
                value={clave}
                onChangeText={setClave}
                placeholder="Clave de ultron.ordenglobal.link"
                placeholderTextColor="#5A6A7A"
                secureTextEntry
                style={styles.input}
                autoCapitalize="none"
                onFocus={() => setFocus('clave')}
                onBlur={() => setFocus('none')}
                onSubmitEditing={() => void enterWithClave()}
              />
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Guardar contraseña</Text>
                <Switch
                  value={remember}
                  onValueChange={setRemember}
                  trackColor={{ true: '#00E5FF' }}
                />
              </View>
              {fingerprintAvailable && (
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Desbloqueo con huella</Text>
                  <Switch
                    value={useFingerprint}
                    onValueChange={setUseFingerprint}
                    trackColor={{ true: '#00E5FF' }}
                  />
                </View>
              )}
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                onPress={() => void enterWithClave()}
                style={styles.primary}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#001018" />
                ) : (
                  <Text style={styles.primaryText}>Entrar</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => void enterBiometric(activeUser, clave || undefined)}
                style={styles.secondary}
                disabled={loading}
              >
                <Text style={styles.secondaryText}>Entrar solo al escritorio</Text>
              </Pressable>
              {fingerprintAvailable && remember && !!clave && (
                <Pressable
                  onPress={() => void enterWithFingerprint()}
                  style={styles.secondary}
                  disabled={loading}
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
  root: { flex: 1, backgroundColor: '#000' },
  scroll: { flex: 1, width: '100%' },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.22)',
    backgroundColor: 'rgba(10,14,20,0.95)',
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  title: { color: '#E8FBFF', fontSize: 24, fontWeight: '800', letterSpacing: 8, marginTop: -6 },
  sub: { color: '#7A8B9C', fontSize: 12, marginBottom: 14, letterSpacing: 1 },
  hint: { color: '#5A6A7A', fontSize: 11, marginBottom: 2 },
  welcome: { color: '#E8FBFF', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  userBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(0,229,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#00E5FF', fontWeight: '700', fontSize: 16 },
  userName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  userMail: { color: '#8B9AAB', fontSize: 11 },
  userMailCenter: { color: '#8B9AAB', fontSize: 12, textAlign: 'center' },
  back: { color: '#00E5FF', fontSize: 14, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#E8FBFF',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { color: '#C8D4DE', fontSize: 13 },
  error: { color: '#FF7A8A', fontSize: 12 },
  primary: {
    backgroundColor: '#00E5FF',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    width: '100%',
  },
  primaryText: { color: '#001018', fontWeight: '800', letterSpacing: 1 },
  secondary: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    width: '100%',
  },
  secondaryText: { color: '#C8D4DE', fontSize: 13 },
  link: { color: '#5A6A7A', fontSize: 12, textDecorationLine: 'underline' },
});
