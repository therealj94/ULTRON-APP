/**
 * «NUEVO CHAT»: los contactos guardados en su teléfono (GET /api/whatsapp/contactos), con buscador, como
 * el botón verde de WhatsApp. Tocar uno abre la conversación (si ya hay chat con él, ese mismo); escribir
 * un número que no está en sus contactos ofrece escribirle igual.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tr } from '../i18n';
import * as API from './api';
import { registrarAtras } from './atras';
import { IconoWA } from './IconoWA';
import { AvatarWA } from './PiezasWA';
import { mensajeErrorWA, nombreChat, soloDigitos, telefonoBonito, telefonoValido, type ContactoWA, type PaletaWA } from './logica';

type Props = { w: PaletaWA; idioma: 'es' | 'en'; onElegir: (k: ContactoWA) => void; onCerrar: () => void };

export function NuevoChatWA({ w, idioma, onElegir, onCerrar }: Props) {
  const ins = useSafeAreaInsets();
  const [todos, setTodos] = useState<ContactoWA[] | null>(null);
  const [encontrados, setEncontrados] = useState<ContactoWA[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const atras = () => (onCerrar(), true);
    const quitar = registrarAtras(atras);
    const sub = BackHandler.addEventListener('hardwareBackPress', atras);
    return () => {
      quitar();
      sub.remove();
    };
  }, [onCerrar]);

  useEffect(() => {
    let vivo = true;
    API.contactosWA('', 500)
      .then((cs) => vivo && setTodos(cs))
      .catch((e: any) => {
        if (!vivo) return;
        setTodos([]);
        setError(mensajeErrorWA(Number(e?.status) || 0, e?.message || tr('No pude traer tus contactos.', 'I couldn’t get your contacts.'), idioma));
      });
    return () => {
      vivo = false;
    };
  }, []);

  // El servidor busca también por número escrito con espacios, guiones o «+».
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return setEncontrados([]);
    let vivo = true;
    const espera = setTimeout(() => {
      API.contactosWA(t, 100)
        .then((cs) => vivo && setEncontrados(cs))
        .catch(() => {});
    }, 350);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [q]);

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    const dq = t.replace(/\D/g, '');
    const base = todos || [];
    const locales = !t ? base : base.filter((k) => (k.nombre || '').toLowerCase().includes(t) || (dq.length >= 3 && soloDigitos(k.numero).includes(dq)));
    const vistos = new Set(locales.map((k) => k.jid));
    return [...locales, ...encontrados.filter((k) => !vistos.has(k.jid))];
  }, [todos, encontrados, q]);

  // Un número que no está en sus contactos: se le puede escribir igual.
  const numeroSuelto = (telefonoValido(q) || '').length >= 10 ? telefonoValido(q) : null;
  const suelto: ContactoWA | null = numeroSuelto && !lista.some((k) => soloDigitos(k.numero) === numeroSuelto) ? { jid: `${numeroSuelto}@s.whatsapp.net`, nombre: '', numero: `+${numeroSuelto}` } : null;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: w.fondo }]}>
      <View style={[s.cabecera, { backgroundColor: w.cabecera, paddingTop: ins.top + 4 }]}>
        <Pressable onPress={onCerrar} accessibilityRole="button" accessibilityLabel={tr('Volver a los chats', 'Back to chats')} style={s.boton} hitSlop={4}>
          <IconoWA nombre="atras" tam={24} color={w.sobreCabecera} grosor={2.2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[s.titulo, { color: w.sobreCabecera }]} accessibilityRole="header">
            {tr('Nuevo chat', 'New chat')}
          </Text>
          {todos ? <Text style={{ color: w.sobreCabecera2, fontSize: 13 }}>{tr(`${todos.length} contactos`, `${todos.length} contacts`)}</Text> : null}
        </View>
      </View>
      <View style={[s.buscador, { backgroundColor: w.buscador }]}>
        <IconoWA nombre="buscar" tam={18} color={w.pista} />
        <TextInput
          value={q}
          onChangeText={setQ}
          autoFocus
          placeholder={tr('Buscar un nombre o un número', 'Search a name or a number')}
          placeholderTextColor={w.pista}
          autoCorrect={false}
          style={[s.buscadorTxt, { color: w.nombre }]}
          accessibilityLabel={tr('Buscar contactos', 'Search contacts')}
        />
      </View>
      {!!error && (
        <View style={{ backgroundColor: w.avisoFondo, paddingVertical: 8, paddingHorizontal: 16 }}>
          <Text style={{ color: w.aviso, fontSize: 13 }}>{error}</Text>
        </View>
      )}
      {todos === null ? (
        <ActivityIndicator color={w.globo} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(k) => k.jid}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={16}
          contentContainerStyle={{ paddingBottom: ins.bottom + 24 }}
          ListHeaderComponent={
            suelto ? (
              <Fila k={suelto} w={w} idioma={idioma} titulo={tr(`Escribir a ${telefonoBonito(numeroSuelto)}`, `Message ${telefonoBonito(numeroSuelto)}`)} onPress={() => onElegir(suelto)} />
            ) : (
              <Text style={[s.seccion, { color: w.horaSinLeer }]}>{tr('Contactos en WhatsApp', 'Contacts on WhatsApp')}</Text>
            )
          }
          ListEmptyComponent={
            suelto ? null : (
              <Text style={{ color: w.previa, textAlign: 'center', marginTop: 32, fontSize: 15, paddingHorizontal: 24 }}>
                {q.trim() ? tr(`Nadie con «${q.trim()}». Escribe el número con el código de país para escribirle igual.`, `No one matching “${q.trim()}”. Type the number with the country code to message it anyway.`) : tr('Tu teléfono todavía no mandó tus contactos.', 'Your phone hasn’t sent your contacts yet.')}
              </Text>
            )
          }
          renderItem={({ item }) => <Fila k={item} w={w} idioma={idioma} onPress={() => onElegir(item)} />}
        />
      )}
    </View>
  );
}

function Fila({ k, w, idioma, titulo, onPress }: { k: ContactoWA; w: PaletaWA; idioma: 'es' | 'en'; titulo?: string; onPress: () => void }) {
  const nombre = titulo || nombreChat({ jid: k.jid, nombre: k.nombre, numero: k.numero, grupo: false }, idioma);
  const numero = telefonoBonito(k.numero);
  const debajo = !titulo && numero && numero !== nombre ? numero : '';
  return (
    <Pressable onPress={onPress} android_ripple={{ color: w.separador }} accessibilityRole="button" accessibilityLabel={debajo ? `${nombre}, ${debajo}` : nombre} style={({ pressed }) => [s.fila, pressed && { backgroundColor: w.buscador }]}>
      {titulo ? (
        <View style={[s.circulo, { backgroundColor: '#00A884' }]}>
          <IconoWA nombre="nuevoChat" tam={24} color="#FFFFFF" />
        </View>
      ) : (
        <AvatarWA jid={k.jid} nombre={nombre} grupo={false} tam={46} w={w} />
      )}
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={{ color: w.nombre, fontSize: 16.5, fontWeight: '500' }} numberOfLines={1}>
          {nombre}
        </Text>
        {debajo ? (
          <Text style={{ color: w.previa, fontSize: 14, marginTop: 1 }} numberOfLines={1}>
            {debajo}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  cabecera: { flexDirection: 'row', alignItems: 'center', paddingRight: 12, paddingBottom: 10, minHeight: 56 },
  boton: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 19, fontWeight: '600' },
  buscador: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 10, marginBottom: 4, paddingHorizontal: 14, height: 44, borderRadius: 22 },
  buscadorTxt: { flex: 1, fontSize: 16, paddingVertical: 0 },
  seccion: { fontSize: 14, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  fila: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 64, paddingVertical: 8 },
  circulo: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
