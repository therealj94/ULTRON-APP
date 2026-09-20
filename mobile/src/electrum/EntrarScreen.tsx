/**
 * Entrar a Dr Electrum. Dos caminos, los mismos que en la web:
 *
 *  · el correo de la junta, que emite la sesión de siempre;
 *  · una llave de demostración, para enseñárselo a alguien sin crearle cuenta.
 *
 * Quien entra con llave entra con nivel de CONSULTA y la pantalla se lo dice antes, no después de
 * que intente cargar algo y reciba un error. Decir de antemano lo que no se va a poder hacer es
 * parte de no hacer perder el tiempo a nadie.
 */
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { UltronFace } from '../components/UltronFace';
import { ACENTO } from '../variante';
import { entrar, guardarLlave, guardarSesion, salud } from './api';

type Modo = 'correo' | 'llave';

export function EntrarScreen({ onDentro }: { onDentro: () => void }) {
  const [modo, setModo] = useState<Modo>('correo');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [llave, setLlave] = useState('');
  const [yendo, setYendo] = useState(false);
  const [fallo, setFallo] = useState('');

  async function intentar() {
    if (yendo) return;
    setYendo(true);
    setFallo('');
    try {
      if (modo === 'correo') {
        const token = await entrar(correo.trim(), clave);
        await guardarSesion(token);
      } else {
        await guardarLlave(llave.trim());
      }
      // No basta con guardar la credencial: hay que comprobar que ESTA plataforma la acepta. Estar
      // en la junta no es estar en Dr Electrum, y descubrirlo en la primera pregunta es peor.
      await salud();
      onDentro();
    } catch (e: any) {
      if (modo === 'llave') await guardarLlave(null);
      else await guardarSesion(null);
      setFallo(
        String(e?.message || e).includes('privado')
          ? 'Esa credencial es buena pero no tiene acceso a Dr Electrum. Pedile a José que te agregue al padrón.'
          : String(e?.message || e).slice(0, 140)
      );
    } finally {
      setYendo(false);
    }
  }

  const listo = modo === 'correo' ? correo.includes('@') && clave.length > 2 : llave.trim().length > 3;

  return (
    <KeyboardAvoidingView style={s.raiz} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.cara}>
        <UltronFace face="IDLE" acento={ACENTO} size={76} stageHeight={200} />
      </View>
      <Text style={s.marca}>DR ELECTRUM FP</Text>
      <Text style={s.lema}>ESTACIÓN DE TRABAJO MINERA</Text>

      <View style={s.pestanas}>
        {(['correo', 'llave'] as Modo[]).map((m) => (
          <Pressable key={m} onPress={() => { setModo(m); setFallo(''); }} style={[s.pestana, modo === m && s.pestanaOn]}>
            <Text style={[s.pestanaTexto, modo === m && { color: '#000' }]}>{m === 'correo' ? 'CON MI CORREO' : 'CON LLAVE'}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.campos}>
        {modo === 'correo' ? (
          <>
            <TextInput
              value={correo}
              onChangeText={setCorreo}
              placeholder="tu@ordenglobal.org"
              placeholderTextColor="#5E7078"
              autoCapitalize="none"
              keyboardType="email-address"
              style={s.campo}
            />
            <TextInput value={clave} onChangeText={setClave} placeholder="clave" placeholderTextColor="#5E7078" secureTextEntry style={s.campo} />
          </>
        ) : (
          <>
            <TextInput
              value={llave}
              onChangeText={setLlave}
              placeholder="llave de la demostración"
              placeholderTextColor="#5E7078"
              autoCapitalize="none"
              style={s.campo}
            />
            <Text style={s.aviso}>Con llave entrás de consulta: podés preguntarlo todo, pero no cargarle nada al cerebro.</Text>
          </>
        )}

        {!!fallo && <Text style={s.fallo}>{fallo}</Text>}

        <Pressable onPress={() => void intentar()} disabled={!listo || yendo} style={[s.boton, (!listo || yendo) && { opacity: 0.35 }]}>
          {yendo ? <ActivityIndicator color="#000" /> : <Text style={s.botonTexto}>ENTRAR</Text>}
        </Pressable>
      </View>

      <Text style={s.pie}>Demostración. No sustituye a una Persona Calificada ni a un informe firmado.</Text>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6 },
  cara: { height: 200, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  marca: { color: ACENTO, fontSize: 20, fontWeight: '700', letterSpacing: 5 },
  lema: { color: 'rgba(255,174,59,0.5)', fontSize: 9, letterSpacing: 2.4, fontWeight: '600', marginTop: 4, marginBottom: 22 },
  pestanas: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  pestana: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  pestanaOn: { backgroundColor: ACENTO, borderColor: ACENTO },
  pestanaTexto: { color: '#9FB0B8', fontSize: 10, letterSpacing: 1.4, fontWeight: '700' },
  campos: { width: '100%', maxWidth: 380, gap: 10 },
  campo: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#E7EEF2', fontSize: 15 },
  aviso: { color: '#8FA3B0', fontSize: 12, lineHeight: 18 },
  fallo: { color: '#D9705A', fontSize: 13, lineHeight: 19 },
  boton: { backgroundColor: ACENTO, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  botonTexto: { color: '#000', fontWeight: '700', fontSize: 14, letterSpacing: 2 },
  pie: { position: 'absolute', bottom: 22, color: '#3A4A5A', fontSize: 10, textAlign: 'center', paddingHorizontal: 30 },
});
