/**
 * ESCRIBIR UN CORREO: responder, responder a todos o uno nuevo. Desde (si tiene varias cuentas), Para,
 * Copia, Asunto, el texto y, en una respuesta, el original citado debajo (se puede quitar).
 *
 * NADA SALE SIN PREGUNTAR: «Enviar» abre un aviso con desde dónde, a quién, con copia a quién, el asunto
 * y el comienzo del texto; solo su «Mandar» llama al servidor (con `confirmado: true`). Salir con algo
 * escrito pregunta antes de tirarlo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Letra as Text } from '../ui/Letra';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { tr } from '../i18n';
import { vibrar } from '../ui/hapticos';
import { registrarAtras } from '../whatsapp/atras';
import * as API from './api';
import { IconoCorreo } from './IconoCorreo';
import { avisoConfirmacion, avisoEnviado, leerDestinos, mensajeErrorCorreo, problemaBorrador, textoFinal, type BorradorCorreo, type CuentaCorreo, type Idioma } from './logica';

type Props = {
  inicial: BorradorCorreo;
  cuentas: CuentaCorreo[];
  idioma: Idioma;
  onCerrar: () => void;
  /** Salió: lo que se le dice a la persona («Enviado a …»). */
  onEnviado: (aviso: string) => void;
};

export function RedactarCorreo({ inicial, cuentas, idioma, onCerrar, onEnviado }: Props) {
  const p = useTema();
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const [b, setB] = useState<BorradorCorreo>(() => ({ ...inicial, cuentaId: inicial.cuentaId || cuentas[0]?.id || '' }));
  const [conCc, setConCc] = useState(!!inicial.cc);
  const [conCita, setConCita] = useState(!!inicial.cita);
  const [verCita, setVerCita] = useState(false);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cuerpo = useRef<TextInput>(null);

  const cuenta = cuentas.find((c) => c.id === b.cuentaId) || null;
  const escrito = b.texto.trim() !== inicial.texto.trim() || b.para !== inicial.para || b.asunto !== inicial.asunto || b.cc !== inicial.cc;
  const titulo = b.modo === 'responder' ? tr('Responder', 'Reply') : b.modo === 'todos' ? tr('Responder a todos', 'Reply all') : tr('Correo nuevo', 'New email');
  const cambiar = (c: Partial<BorradorCorreo>) => {
    setError('');
    setB((x) => ({ ...x, ...c }));
  };

  /** Salir: si escribió algo, pregunta antes de tirarlo. */
  const salir = () => {
    if (enviando) return;
    if (!escrito) return onCerrar();
    Alert.alert(tr('¿Descartar el correo?', 'Discard the email?'), tr('Lo que escribiste se pierde. No se mandó nada.', 'What you wrote is lost. Nothing was sent.'), [
      { text: tr('Seguir escribiendo', 'Keep writing'), style: 'cancel' },
      { text: tr('Descartar', 'Discard'), style: 'destructive', onPress: onCerrar },
    ]);
  };
  const salirRef = useRef(salir);
  salirRef.current = salir;

  useEffect(() => {
    const atras = () => (salirRef.current(), true);
    const quitar = registrarAtras(atras);
    const sub = BackHandler.addEventListener('hardwareBackPress', atras);
    return () => {
      quitar();
      sub.remove();
    };
  }, []);

  // En una respuesta ya se sabe a quién: el cursor va directo al texto.
  useEffect(() => {
    if (inicial.modo === 'nuevo') return;
    const t = setTimeout(() => cuerpo.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [inicial.modo]);

  const mandar = async () => {
    setEnviando(true);
    setError('');
    try {
      const para = leerDestinos(b.para).ok;
      const r = await API.mandarCorreoConfirmado({
        cuentaId: b.cuentaId,
        para,
        cc: leerDestinos(conCc ? b.cc : '').ok.filter((x) => !para.includes(x)),
        asunto: b.asunto.trim(),
        texto: textoFinal(b, conCita),
        enRespuestaA: b.enRespuestaA,
        referencias: b.referencias,
      });
      vibrar('exito');
      onEnviado(avisoEnviado(r, idioma));
    } catch (e: any) {
      vibrar('aviso');
      setError(mensajeErrorCorreo(Number(e?.status) || 0, e?.message, idioma));
      setEnviando(false);
    }
  };

  /** «Enviar»: si falta algo, lo dice; si no, pregunta con todo a la vista. Solo «Mandar» lo manda. */
  const enviar = () => {
    if (enviando) return;
    const falta = problemaBorrador({ ...b, cc: conCc ? b.cc : '' }, idioma);
    if (falta) {
      vibrar('aviso');
      return setError(falta);
    }
    const aviso = avisoConfirmacion({ ...b, cc: conCc ? b.cc : '' }, cuenta?.correo || '', idioma);
    Alert.alert(aviso.titulo, aviso.cuerpo, [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      { text: tr('Mandar', 'Send'), onPress: () => void mandar() },
    ]);
  };

  return (
    <KeyboardAvoidingView style={[StyleSheet.absoluteFill, { backgroundColor: p.fondo }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[s.barra, { paddingTop: ins.top + 4, paddingLeft: ins.left + 4, paddingRight: ins.right + 8, borderBottomColor: p.borde }]}>
        <Pressable onPress={salir} accessibilityRole="button" accessibilityLabel={tr('Cerrar sin mandar', 'Close without sending')} style={s.boton} hitSlop={4}>
          <IconoCorreo nombre="cerrar" tam={22} color={p.texto} grosor={2.2} />
        </Pressable>
        <Text style={[s.titulo, { color: p.texto }]} numberOfLines={1} accessibilityRole="header">
          {titulo}
        </Text>
        <Pressable
          onPress={enviar}
          disabled={enviando}
          accessibilityRole="button"
          accessibilityLabel={tr('Enviar (te pregunto antes de mandarlo)', 'Send (I’ll ask before sending)')}
          style={({ pressed }) => [s.enviar, { backgroundColor: p.acento, opacity: enviando ? 0.6 : pressed ? 0.85 : 1 }]}
        >
          {enviando ? <ActivityIndicator color={p.sobreAcento} /> : <IconoCorreo nombre="enviar" tam={20} color={p.sobreAcento} style={{ marginLeft: 2 }} />}
          <Text style={{ color: p.sobreAcento, fontWeight: '800', fontSize: 15 }}>{enviando ? tr('Mandando…', 'Sending…') : tr('Enviar', 'Send')}</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={[s.banda, { backgroundColor: p.avisoFondo }]} accessibilityLiveRegion="polite">
          <Text style={{ color: p.aviso, fontSize: 14 }}>{error}</Text>
        </View>
      ) : null}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: ins.bottom + 32, paddingLeft: ins.left, paddingRight: ins.right }}>
        <View style={s.columna}>
          {cuentas.length > 1 ? (
            <View style={[s.campoFila, { borderBottomColor: p.borde, alignItems: 'flex-start', paddingVertical: 10 }]}>
              <Text style={[s.etiqueta, { color: p.texto3, marginTop: 9 }]}>{tr('Desde', 'From')}</Text>
              <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {cuentas.map((c) => {
                  const activa = c.id === b.cuentaId;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => cambiar({ cuentaId: c.id })}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activa }}
                      style={[s.chip, { borderColor: activa ? p.acento : p.borde, backgroundColor: activa ? p.acentoFondo : 'transparent' }]}
                    >
                      <Text style={{ color: activa ? p.acentoTexto : p.texto2, fontSize: 13.5, fontWeight: '600' }} numberOfLines={1}>
                        {c.correo}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : cuenta ? (
            <View style={[s.campoFila, { borderBottomColor: p.borde }]}>
              <Text style={[s.etiqueta, { color: p.texto3 }]}>{tr('Desde', 'From')}</Text>
              <Text style={{ color: p.texto2, fontSize: 15, flex: 1 }} numberOfLines={1}>
                {cuenta.correo}
              </Text>
            </View>
          ) : null}

          <View style={[s.campoFila, { borderBottomColor: p.borde }]}>
            <Text style={[s.etiqueta, { color: p.texto3 }]}>{tr('Para', 'To')}</Text>
            <TextInput
              value={b.para}
              onChangeText={(t) => cambiar({ para: t })}
              placeholder={tr('nombre@correo.com', 'name@email.com')}
              placeholderTextColor={p.texto3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoFocus={inicial.modo === 'nuevo'}
              multiline
              style={[s.entrada, { color: p.texto }]}
              accessibilityLabel={tr('Para (separa varias direcciones con comas)', 'To (separate several addresses with commas)')}
            />
            {!conCc ? (
              <Pressable onPress={() => setConCc(true)} accessibilityRole="button" accessibilityLabel={tr('Añadir copia', 'Add Cc')} style={s.mini} hitSlop={6}>
                <Text style={{ color: p.acentoTexto, fontWeight: '700', fontSize: 14 }}>{tr('Copia', 'Cc')}</Text>
              </Pressable>
            ) : null}
          </View>

          {conCc ? (
            <View style={[s.campoFila, { borderBottomColor: p.borde }]}>
              <Text style={[s.etiqueta, { color: p.texto3 }]}>{tr('Copia', 'Cc')}</Text>
              <TextInput
                value={b.cc}
                onChangeText={(t) => cambiar({ cc: t })}
                placeholder={tr('con copia a…', 'copy to…')}
                placeholderTextColor={p.texto3}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                multiline
                style={[s.entrada, { color: p.texto }]}
                accessibilityLabel={tr('Con copia a', 'Cc')}
              />
            </View>
          ) : null}

          <View style={[s.campoFila, { borderBottomColor: p.borde }]}>
            <Text style={[s.etiqueta, { color: p.texto3 }]}>{tr('Asunto', 'Subject')}</Text>
            <TextInput value={b.asunto} onChangeText={(t) => cambiar({ asunto: t.replace(/[\r\n]+/g, ' ') })} placeholderTextColor={p.texto3} maxLength={300} style={[s.entrada, { color: p.texto }]} accessibilityLabel={tr('Asunto', 'Subject')} />
          </View>

          <TextInput
            ref={cuerpo}
            value={b.texto}
            onChangeText={(t) => cambiar({ texto: t })}
            placeholder={tr('Escribe tu correo', 'Write your email')}
            placeholderTextColor={p.texto3}
            multiline
            textAlignVertical="top"
            maxLength={50_000}
            style={[s.cuerpo, { color: p.texto }]}
            accessibilityLabel={tr('El texto del correo', 'The email text')}
          />

          {b.cita ? (
            <View style={[s.cita, { borderColor: p.borde, backgroundColor: p.superficie }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: p.texto, fontSize: 14, fontWeight: '600', flex: 1 }}>{tr('Incluir el correo original', 'Include the original email')}</Text>
                <Switch value={conCita} onValueChange={setConCita} accessibilityLabel={tr('Incluir el correo original', 'Include the original email')} trackColor={{ true: p.acento, false: p.borde }} />
              </View>
              {conCita ? (
                <>
                  <Text style={{ color: p.texto3, fontSize: 13, lineHeight: 19, marginTop: 8 }} numberOfLines={verCita ? undefined : 6}>
                    {b.cita}
                  </Text>
                  <Pressable onPress={() => setVerCita((v) => !v)} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 8 }} hitSlop={6}>
                    <Text style={{ color: p.acentoTexto, fontSize: 13, fontWeight: '700' }}>{verCita ? tr('Ver menos', 'Show less') : tr('Ver todo', 'Show all')}</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}

          <Text style={{ color: p.texto3, fontSize: 12, lineHeight: 17, marginTop: 14 }}>{tr('Antes de mandarlo te enseño a quién va y te pregunto. Sin tu «Mandar», no sale nada.', 'Before sending I show you who it goes to and ask. Without your “Send”, nothing goes out.')}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    barra: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
    boton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
    titulo: { flex: 1, fontSize: 18, fontWeight: '700', marginLeft: 4 },
    enviar: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: 22, paddingHorizontal: 18 },
    banda: { paddingVertical: 10, paddingHorizontal: MEDIDA.espacio.l },
    columna: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: MEDIDA.espacio.l },
    campoFila: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
    etiqueta: { width: 64, fontSize: 14.5 },
    entrada: { flex: 1, fontSize: 15.5, paddingVertical: 10, maxHeight: 120 },
    mini: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', maxWidth: '100%' },
    cuerpo: { fontSize: 16, lineHeight: 23, minHeight: 200, paddingTop: 16, paddingBottom: 12 },
    cita: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginTop: 6 },
  });
}
