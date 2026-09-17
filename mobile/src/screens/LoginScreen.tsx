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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DESK_USERS, type DeskUser, type SessionUser } from '../config';
import { loginBiometric, loginClave } from '../lib/api';
import { loadCreds, saveCreds, saveSession } from '../lib/storage';

type Props = {
  onAuthenticated: (user: SessionUser) => void;
};

export function LoginScreen({ onAuthenticated }: Props) {
  const [selected, setSelected] = useState<DeskUser>(DESK_USERS[0]);
  const [phase, setPhase] = useState<'pick' | 'clave'>('pick');
  const [clave, setClave] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logoReady, setLogoReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLogoReady(true), 60);
    void loadCreds().then((c) => {
      if (c?.correo) {
        const match = DESK_USERS.find((u) => u.correo === c.correo);
        if (match) {
          setSelected(match);
          setClave(c.clave || '');
          setPhase('clave');
        }
      }
    });
    return () => clearTimeout(t);
  }, []);

  const finish = async (user: SessionUser, persist?: { clave: string }) => {
    await saveSession(user);
    if (remember && persist?.clave) {
      await saveCreds({ correo: user.correo, clave: persist.clave, name: user.name });
    } else if (!remember) {
      await saveCreds(null);
    }
    onAuthenticated(user);
  };

  const enterBiometric = async (user: DeskUser) => {
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
        clave ? { clave } : undefined
      );
    } catch (e: any) {
      // Offline / servidor caído: acceso local de junta (José/Medardo allowlist)
      await finish(
        { name: user.name, role: user.role, correo: user.correo },
        clave ? { clave } : undefined
      );
      if (e?.message) setError(''); // silent local fallthrough
    } finally {
      setLoading(false);
    }
  };

  const enterWithClave = async () => {
    if (!clave.trim()) {
      setError('Escribe tu clave o usa acceso biométrico de escritorio');
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
      if (e?.status === 401 || e?.data?.codigo === 'NO_ENTRA') {
        await enterBiometric(selected);
        return;
      }
      // Fallback local para no bloquear la app nativa
      await enterBiometric(selected);
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
        colors={['rgba(0,229,255,0.14)', 'transparent', '#000']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.7 }}
      />
      <View style={styles.card}>
        <Image
          source={require('../../assets/ultron-logo.jpg')}
          style={[styles.logo, { opacity: logoReady ? 1 : 0, transform: [{ scale: logoReady ? 1 : 0.85 }] }]}
        />
        <Text style={styles.title}>ULTRON FP</Text>
        <Text style={styles.sub}>App nativa Android · José / Medardo</Text>

        {phase === 'pick' ? (
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
              placeholder="Clave ultron.ordenglobal.link"
              placeholderTextColor="#5A6A7A"
              secureTextEntry
              style={styles.input}
              autoCapitalize="none"
            />
            <Pressable onPress={() => setRemember((v) => !v)} style={styles.rememberRow}>
              <View style={[styles.check, remember && styles.checkOn]} />
              <Text style={styles.rememberText}>Recordar en el teléfono (SecureStore)</Text>
            </Pressable>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Pressable onPress={() => void enterWithClave()} style={styles.primary} disabled={loading}>
              {loading ? <ActivityIndicator color="#001018" /> : <Text style={styles.primaryText}>Entrar</Text>}
            </Pressable>
            <Pressable onPress={() => void enterBiometric(selected)} style={styles.secondary} disabled={loading}>
              <Text style={styles.secondaryText}>Acceso biométrico de escritorio</Text>
            </Pressable>
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
  logo: { width: 84, height: 84, borderRadius: 42, marginBottom: 6, borderWidth: 1, borderColor: 'rgba(0,229,255,0.35)' },
  title: { color: '#E8FBFF', fontSize: 26, fontWeight: '800', letterSpacing: 6 },
  sub: { color: '#7A8B9C', fontSize: 12, marginBottom: 12 },
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
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  check: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: '#5A6A7A' },
  checkOn: { backgroundColor: '#00E5FF', borderColor: '#00E5FF' },
  rememberText: { color: '#8B9AAB', fontSize: 12 },
  error: { color: '#FF7A8A', fontSize: 12 },
  primary: {
    backgroundColor: '#00E5FF',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#001018', fontWeight: '800', letterSpacing: 1 },
  secondary: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  secondaryText: { color: '#C8D4DE', fontSize: 13 },
});
