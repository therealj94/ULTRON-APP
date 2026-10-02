/**
 * LOS CHATS CON DOS PESTAÑAS: PULSE2CHAT y WhatsApp, una al lado de la otra. Se cambia deslizando de lado
 * o tocando la pestaña (José, 2-oct: «una opción aparte de PULSE2CHAT, slide y cambia»).
 *
 * WhatsApp solo aparece si esta cuenta tiene su WhatsApp (server/whatsapp.ts, WHATSAPP_DUENOS): para
 * cualquier otra persona esto es la lista de PULSE2CHAT de siempre, sin pestañas.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useTema } from '../nucleo/tema';
import { tr } from '../i18n';
import { PantallaChats } from '../pulse/PantallaChats';
import { PantallaWhatsapp } from './PantallaWhatsapp';
import * as API from './api';
import { vistaDe, type EstadoWA } from './logica';

type Props = {
  onAbrir: (correo: string, nombre: string) => void;
  onAtras?: () => void;
  /** Empezar en WhatsApp (p. ej. «ábreme WhatsApp»). */
  enWhatsapp?: boolean;
};

export function ChatsConWhatsapp({ onAbrir, onAtras, enWhatsapp = false }: Props) {
  const p = useTema();
  const { width } = useWindowDimensions();
  const [estado, setEstado] = useState<EstadoWA | null>(null);
  const [pagina, setPagina] = useState<0 | 1>(0);
  const [noLeidos, setNoLeidos] = useState(0);
  const deslizador = useRef<ScrollView>(null);

  useEffect(() => {
    let vivo = true;
    void API.estadoWA()
      .then((e) => vivo && setEstado(e))
      .catch(() => vivo && setEstado({ disponible: false, permitido: false, vinculado: false }));
    return () => {
      vivo = false;
    };
  }, []);

  const conWhatsapp = !!estado && vistaDe(estado) !== 'oculto';

  useEffect(() => {
    if (conWhatsapp && enWhatsapp) ir(1, false);
  }, [conWhatsapp, enWhatsapp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al girar el teléfono cambia el ancho: la página que se veía sigue a la vista.
  useEffect(() => {
    if (conWhatsapp) deslizador.current?.scrollTo({ x: pagina * width, animated: false });
  }, [width]); // eslint-disable-line react-hooks/exhaustive-deps

  function ir(n: 0 | 1, animado = true) {
    setPagina(n);
    deslizador.current?.scrollTo({ x: n * width, animated: animado });
  }

  if (!conWhatsapp) return <PantallaChats onAbrir={onAbrir} onAtras={onAtras} />;

  const cambio = <Pestanas p={p} pagina={pagina} noLeidos={noLeidos} onCambiar={(n) => ir(n)} />;
  const alSoltar = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPagina(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)) === 1 ? 1 : 0);

  return (
    <ScrollView
      ref={deslizador}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onMomentumScrollEnd={alSoltar}
      style={{ flex: 1, backgroundColor: p.fondo }}
    >
      <View style={{ width, flex: 1 }}>
        <PantallaChats onAbrir={onAbrir} onAtras={onAtras} cambio={cambio} />
      </View>
      <View style={{ width, flex: 1 }}>
        <PantallaWhatsapp onAtras={onAtras} cambio={cambio} activa={pagina === 1} estadoInicial={estado} onNoLeidos={setNoLeidos} />
      </View>
    </ScrollView>
  );
}

function Pestanas({ p, pagina, noLeidos, onCambiar }: { p: ReturnType<typeof useTema>; pagina: 0 | 1; noLeidos: number; onCambiar: (n: 0 | 1) => void }) {
  const opciones: Array<{ n: 0 | 1; texto: string; punto?: number }> = [
    { n: 0, texto: 'PULSE2CHAT' },
    { n: 1, texto: 'WhatsApp', punto: noLeidos },
  ];
  return (
    <View style={[st.pista, { backgroundColor: p.superficie }]} accessibilityRole="tablist">
      {opciones.map((o) => {
        const activa = pagina === o.n;
        return (
          <Pressable
            key={o.n}
            onPress={() => onCambiar(o.n)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activa }}
            accessibilityLabel={o.n === 1 && o.punto ? `${o.texto}, ${tr(`${o.punto} chats sin leer`, `${o.punto} unread chats`)}` : o.texto}
            style={[st.opcion, activa && { backgroundColor: o.n === 1 ? '#25D366' : p.acento }]}
          >
            <Text style={[st.texto, { color: activa ? (o.n === 1 ? '#062B16' : p.sobreAcento) : p.texto2 }]}>{o.texto}</Text>
            {o.punto ? (
              <View style={[st.punto, { backgroundColor: activa ? '#062B16' : '#25D366' }]}>
                <Text style={[st.puntoTxt, { color: activa ? '#25D366' : '#062B16' }]}>{o.punto > 9 ? '9+' : o.punto}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  pista: { flexDirection: 'row', borderRadius: 999, padding: 4 },
  opcion: { flex: 1, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  texto: { fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  punto: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  puntoTxt: { fontSize: 11, fontWeight: '900' },
});
