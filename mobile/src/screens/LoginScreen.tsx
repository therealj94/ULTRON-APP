import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { DESK_USERS, type DeskUser, type SessionUser } from '../config';
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

export function LoginScreen({ onAuthenticated }: Props) {
  const [selected, setSelected] = useState<DeskUser>(DESK_USERS[0]);
  const [phase, setPhase] = useState<'pick' | 'clave' | 'quick'>('pick');
  const [clave, setClave] = useState('');
  const [remember, setRemember] = useState(true);
  const [useFingerprint, setUseFingerprint] = useState(true);
  const [fingerprintAvailable, setFingerprintAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logoReady, setLogoReady] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setLogoReady(true), 60);
    void (async () => {
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = hw ? await LocalAuthentication.isEnrolledAsync() : false;
      setFingerprintAvailable(hw && enrolled);

      const fp = await getFingerprintUnlock();
      const creds = await loadCreds();
      if (creds?.correo) {
        const match = DESK_USERS.find((u) => u.correo === creds.correo);
        if (match) {
          setSelected(match);
          setClave(creds.clave || '');
          setSavedName(match.name);
          setRemember(true);
          if (fp?.enabled && hw && enrolled) {
            setPhase('quick');
            setUseFingerprint(true);
          } else {
            setPhase('clave');
          }
        }
      }
    })();
    return () => clearTimeout(t);
  }, []);

  const finish = async (user: SessionUser, persist?: { clave: string }) => {
    await saveSession(user);
    if (remember && persist?.clave) {
      await saveCreds({ correo: user.correo, clave: persist.clave, name: user.name });
      if (useFingerprint && fingerprintAvailable) {
        await setFingerprintUnlock(true, user.correo);
      }
    } else if (!remember) {
      await saveCreds(null);
      await setFingerprintUnlock(false);
    }
    onAuthenticated(user);
  };

  const enterWithFingerprint = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquear ULTRON FP',
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
        DESK_USERS.find((u) => u.correo === creds?.correo) || selected;
      await enterBiometric(user, creds?.clave);
    } catch (e: any) {
      setError(e?.message || 'No se pudo usar la huella');
      setPhase('clave');
    } finally {
      setLoading(false);
    }
  };

  const enterBiometric = async (user: DeskUser, maybeClave?: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await loginBiometric({ name: user.name, role: user.role, correo: user.correo });
      await finish(
        {
          name: data.user?.nombre || user.name,
          role: data.user?.rol || user.role,
          correo: user.correo,
        },
        maybeClave || clave ? { clave: maybeClave || clave } : undefined
      );
    } catch {
      await finish(
        { name: user.name, role: user.role, correo: user.correo },
        maybeClave || clave ? { clave: maybeClave || clave } : undefined
      );
    } finally {
      setLoading(false);
    }
  };

  const enterWithClave = async () => {
    if (!clave.trim()) {
      setError('Escribe tu clave o usa la huella');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await loginClave(selected.correo, clave);
      await finish(
        {
          name: data.miembro?.nombre || selected.name,
          role: data.miembro?.rol || selected.role,
          correo: selected.correo,
        },
        { clave }
      );
    } catch (e: any) {
      // Solo fallback biométrico de escritorio si el servidor está caído / red
      const status = e?.status;
      if (!status || status >= 500) {
        await enterBiometric(selected, clave);
        return;
      }
      setError(e?.message || 'Correo o clave incorrectos');
    } finally {
      setLoading(false);
    }
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
      <View style={styles.card}>
        <Image
          source={require('../../assets/ultron-logo.jpg')}
          style={[styles.logo, { opacity: logoReady ? 1 : 0, transform: [{ scale: logoReady ? 1 : 0.85 }] }]}
        />
        <Text style={styles.title}>ULTRON FP</Text>
        <Text style={styles.sub}>Escritorio nativo · acceso seguro</Text>

        {phase === 'quick' ? (
          <View style={{ gap: 12, width: '100%', alignItems: 'center' }}>
            <Text style={styles.welcome}>Hola, {savedName}</Text>
            <Pressable onPress={() => void enterWithFingerprint()} style={styles.primary} disabled={loading}>
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
            {DESK_USERS.map((u) => (
              <Pressable
                key={u.id}
                onPress={() => {
                  setSelected(u);
                  setPhase('clave');
                }}
                style={styles.userBtn}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{u.name[0]}</Text>
                </View>
                <View>
                  <Text style={styles.userName}>{u.name}</Text>
                  <Text style={styles.userMail}>{u.correo}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={{ gap: 12, width: '100%' }}>
            <Pressable onPress={() => setPhase('pick')}>
              <Text style={styles.back}>← {selected.name}</Text>
            </Pressable>
            <TextInput
              value={clave}
              onChangeText={setClave}
              placeholder="Clave"
              placeholderTextColor="#5A6A7A"
              secureTextEntry
              style={styles.input}
              autoCapitalize="none"
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
            <Pressable onPress={() => void enterWithClave()} style={styles.primary} disabled={loading}>
              {loading ? <ActivityIndicator color="#001018" /> : <Text style={styles.primaryText}>Entrar</Text>}
            </Pressable>
            {fingerprintAvailable && remember && !!clave && (
              <Pressable onPress={() => void enterWithFingerprint()} style={styles.secondary} disabled={loading}>
                <Text style={styles.secondaryText}>Probar huella ahora</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.22)',
    backgroundColor: 'rgba(10,14,20,0.95)',
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 42,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.35)',
  },
  title: { color: '#E8FBFF', fontSize: 26, fontWeight: '800', letterSpacing: 6 },
  sub: { color: '#7A8B9C', fontSize: 12, marginBottom: 12 },
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
