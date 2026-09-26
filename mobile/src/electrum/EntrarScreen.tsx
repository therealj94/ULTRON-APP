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
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { UltronFace } from '../components/UltronFace';
import { ACENTO } from '../variante';
import { entrar, guardarLlave, guardarSesion, porQueNoAbre, probarPuerta } from './api';
import { fraseDeError } from './frases';

// Los textos de ayuda que se escriben en las cajas: el gris de antes (#5E7078) daba 4:1 sobre
// negro, por debajo de lo legible. Este da 5:1.
const PISTA = '#6C7F89';

type Modo = 'correo' | 'llave';

export function EntrarScreen({ onDentro }: { onDentro: () => void }) {
  const [modo, setModo] = useState<Modo>('correo');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [llave, setLlave] = useState('');
  const [yendo, setYendo] = useState(false);
  const [fallo, setFallo] = useState('');
  // La app gira con el teléfono: en horizontal, cara y formulario lado a lado; en vertical, uno
  // encima del otro, porque dos columnas en 360 px dejan cajas de 150 px donde no cabe un correo.
  const { width, height } = useWindowDimensions();
  const apaisado = width > height;

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
      const p = await probarPuerta();
      if (p.estado === 'abierta') {
        onDentro();
        return;
      }
      /*
       * La credencial solo se borra si el servidor dijo que no vale. Si el problema fue la señal,
       * borrarla obligaría a volver a escribirla cuando vuelva la cobertura, por un fallo que no
       * tuvo nada que ver con ella.
       */
      if (p.estado === 'sin-permiso') {
        if (modo === 'llave') await guardarLlave(null);
        else await guardarSesion(null);
      }
      // El código (502, 503…) al registro; a la pantalla, qué pasó y qué hacer.
      console.warn('[electrum] puerta:', JSON.stringify(p));
      setFallo(porQueNoAbre(p));
    } catch (e: any) {
      console.warn('[electrum] entrar:', e?.name, e?.status ?? '', e?.message || e);
      setFallo(fraseDeError(e, 'entrar'));
    } finally {
      setYendo(false);
    }
  }

  const listo = modo === 'correo' ? correo.includes('@') && clave.length > 2 : llave.trim().length > 3;

  return (
    <KeyboardAvoidingView style={[s.raiz, !apaisado && s.raizVertical]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Dos columnas: quién te recibe a un lado, lo que tenés que hacer al otro. Apilado en
          horizontal, el teclado al abrirse tapaba el formulario entero. En vertical sí se apila:
          ahí sobra alto y falta ancho. */}
      <View style={apaisado ? s.presentacion : s.presentacionVertical}>
        <View style={[s.cara, !apaisado && { height: 130 }]}>
          <UltronFace face="IDLE" acento={ACENTO} size={apaisado ? 70 : 54} stageHeight={apaisado ? 170 : 120} />
        </View>
        <Text style={s.marca}>DR ELECTRUM FP</Text>
        <Text style={s.lema}>ESTACIÓN DE TRABAJO MINERA</Text>
      </View>

      <View style={apaisado ? s.formulario : s.formularioVertical}>
      <View style={s.pestanas} accessibilityRole="tablist">
        {(['correo', 'llave'] as Modo[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => { setModo(m); setFallo(''); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: modo === m }}
            accessibilityLabel={m === 'correo' ? 'Entrar con mi correo' : 'Entrar con llave de demostración'}
            style={[s.pestana, modo === m && s.pestanaOn]}
          >
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
              placeholderTextColor={PISTA}
              accessibilityLabel="Correo"
              autoCapitalize="none"
              keyboardType="email-address"
              style={s.campo}
            />
            <TextInput value={clave} onChangeText={setClave} placeholder="clave" placeholderTextColor={PISTA} accessibilityLabel="Clave" secureTextEntry style={s.campo} />
          </>
        ) : (
          <>
            <TextInput
              value={llave}
              onChangeText={setLlave}
              placeholder="llave de la demostración"
              placeholderTextColor={PISTA}
              accessibilityLabel="Llave de la demostración"
              autoCapitalize="none"
              style={s.campo}
            />
            <Text style={s.aviso}>Con llave entrás de consulta: podés preguntarlo todo, pero no cargarle nada al cerebro.</Text>
          </>
        )}

        {!!fallo && (
          <Text style={s.fallo} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {fallo}
          </Text>
        )}

        <Pressable
          onPress={() => void intentar()}
          disabled={!listo || yendo}
          accessibilityRole="button"
          accessibilityLabel="Entrar"
          accessibilityState={{ disabled: !listo || yendo, busy: yendo }}
          style={[s.boton, (!listo || yendo) && { opacity: 0.35 }]}
        >
          {yendo ? <ActivityIndicator color="#000" /> : <Text style={s.botonTexto}>ENTRAR</Text>}
        </Pressable>
      </View>
      </View>

      <Text style={s.pie}>Demostración. No sustituye a una Persona Calificada ni a un informe firmado.</Text>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, flexDirection: 'row', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 18, gap: 28 },
  // En vertical: una columna, y abajo sitio para el aviso legal, que va fijo al pie.
  raizVertical: { flexDirection: 'column', paddingHorizontal: 20, paddingBottom: 56, gap: 18 },
  presentacion: { flex: 1, alignItems: 'center' },
  // Alternativas, no añadidos: sin `flex` para que midan su contenido (un `flex: 0` encima del
  // `flex: 1` colapsaba la cara a alto cero en react-native-web).
  presentacionVertical: { alignSelf: 'stretch', alignItems: 'center' },
  formulario: { flex: 1, maxWidth: 400 },
  formularioVertical: { width: '100%', maxWidth: 400 },
  // `alignSelf: 'stretch'`: la columna centra a sus hijos, así que sin esto la caja se encogía al
  // ancho de los dos ojos y `overflow: hidden` les cortaba el brillo por los costados.
  cara: { alignSelf: 'stretch', height: 170, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  marca: { color: ACENTO, fontSize: 19, fontWeight: '700', letterSpacing: 4.5 },
  lema: { color: 'rgba(255,174,59,0.5)', fontSize: 9, letterSpacing: 2.4, fontWeight: '600', marginTop: 4 },
  pestanas: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  // 44 de alto: lo mínimo que se acierta con el pulgar sin mirar.
  pestana: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  pestanaOn: { backgroundColor: ACENTO, borderColor: ACENTO },
  pestanaTexto: { color: '#9FB0B8', fontSize: 12, letterSpacing: 1.4, fontWeight: '700' },
  campos: { width: '100%', gap: 9 },
  campo: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#E7EEF2', fontSize: 15 },
  aviso: { color: '#8FA3B0', fontSize: 12, lineHeight: 18 },
  fallo: { color: '#D9705A', fontSize: 13, lineHeight: 19 },
  boton: { backgroundColor: ACENTO, borderRadius: 12, paddingVertical: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  botonTexto: { color: '#000', fontWeight: '700', fontSize: 14, letterSpacing: 2 },
  // El aviso legal se tiene que poder leer: #3A4A5A a 10 pt daba 2,3:1 sobre negro. #8FA3B0 da 8:1.
  pie: { position: 'absolute', bottom: 8, left: 0, right: 0, color: '#8FA3B0', fontSize: 12, lineHeight: 16, textAlign: 'center', paddingHorizontal: 30 },
});
