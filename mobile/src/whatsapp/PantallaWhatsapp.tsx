/**
 * SU WHATSAPP EN LA APP: vincular, la lista de chats y cada conversación (server/whatsapp.ts).
 *
 *   · Sin vincular: «con un código» (sirve en este mismo teléfono: WhatsApp → Dispositivos vinculados →
 *     Vincular con el número de teléfono) o «con QR» (para escanearlo desde otro teléfono o la PC).
 *   · Vinculado: la lista como en WhatsApp (José, 2-oct: «todo es como texto plano… no parece WhatsApp»):
 *     cabecera verde, la foto de perfil de cada chat (o sus iniciales, o el icono de grupo), el nombre,
 *     la vista previa con el icono de lo que llegó (foto, nota de voz, documento…), la hora a la derecha
 *     («Ayer», la fecha) y el globo verde de sin leer. Buscar mira también los chats viejos del servidor.
 *   · Cada chat se abre encima (whatsapp/ConversacionWA.tsx).
 *   · Se renueva solo mientras está a la vista (cada 5 s la lista, cada 3 s el chat abierto; la lista,
 *     tapada por un chat, cada 15 s).
 *   · Si el puente no contesta (el servidor dice `vinculado: false` con `error`) NO se pide vincular otra
 *     vez: se dice que no contesta, se sigue viendo lo último que llegó y se reintenta solo. Si de verdad
 *     se desvinculó (desde el teléfono), se limpia la lista y se ofrece vincular.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { idiomaActual, tr, useIdioma } from '../i18n';
import { Icono } from '../pulse/ui/Icono';
import * as API from './api';
import { ConversacionWA } from './ConversacionWA';
import { IconoWA, type NombreIconoWA } from './IconoWA';
import { NuevoChatWA } from './NuevoChatWA';
import { AvatarWA } from './PiezasWA';
import {
  chatDeContacto,
  coincide,
  horaLista,
  huellaChats,
  juntarChats,
  mensajeErrorWA,
  nombreChat,
  paletaWA,
  previaTexto,
  previaWA,
  sondeoListaWA,
  telefonoBonito,
  telefonoValido,
  vistaDe,
  type ChatWA,
  type ContactoWA,
  type EstadoWA,
  type IconoPrevia,
  type PaletaWA,
} from './logica';

export { ConversacionWA } from './ConversacionWA';

type Props = {
  /** El cambio PULSE2CHAT ↔ WhatsApp (va debajo del título). */
  cambio?: ReactNode;
  onAtras?: () => void;
  /** Está a la vista (la página del deslizador): si no, no pregunta nada. */
  activa: boolean;
  /** El estado ya leído por quien la monta (para no preguntarlo dos veces al abrir). */
  estadoInicial?: EstadoWA | null;
  /** Cuántos chats tienen algo sin leer (para el punto de la pestaña). */
  onNoLeidos?: (n: number) => void;
};

const ICONO_PREVIA: Record<IconoPrevia, NombreIconoWA> = {
  foto: 'camara',
  video: 'video',
  audio: 'microfono',
  documento: 'documento',
  sticker: 'sticker',
  ubicacion: 'ubicacion',
  contacto: 'contacto',
  encuesta: 'encuesta',
  eliminado: 'prohibido',
};

export function PantallaWhatsapp({ cambio, onAtras, activa, estadoInicial = null, onNoLeidos }: Props) {
  useIdioma();
  const p = useTema();
  const w = useMemo(() => paletaWA(p.oscuro), [p.oscuro]);
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [estado, setEstado] = useState<EstadoWA | null>(estadoInicial);
  const [chats, setChats] = useState<ChatWA[] | null>(null);
  const [encontrados, setEncontrados] = useState<ChatWA[]>([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<ChatWA | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const huella = useRef('');
  const vista = vistaDe(estado);

  const leer = useCallback(async () => {
    try {
      const e = await API.estadoWA();
      setEstado(e);
      const v = vistaDe(e);
      if (v === 'vincular') {
        // Se desvinculó (desde el teléfono o venció): lo de antes ya no vale.
        huella.current = '';
        setChats((cs) => (cs === null ? cs : null));
        setAbierto(null);
        onNoLeidos?.(0);
      }
      if (v === 'caido') {
        setError(mensajeErrorWA(503, e.error, idiomaActual() === 'en' ? 'en' : 'es'));
        return;
      }
      if (v === 'listo') {
        const cs = await API.chatsWA();
        const h = huellaChats(cs);
        if (h !== huella.current) {
          huella.current = h;
          setChats(cs);
        } else setChats((v) => v ?? cs);
        onNoLeidos?.(cs.filter((c) => c.noLeidos > 0).length);
      }
      setError('');
    } catch (e: any) {
      setError(mensajeErrorWA(Number(e?.status) || 0, e?.message, idiomaActual() === 'en' ? 'en' : 'es'));
    }
  }, [onNoLeidos]);

  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const abiertoRef = useRef(abierto);
  abiertoRef.current = abierto;

  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      await leer();
      if (vivo) reloj = setTimeout(vuelta, sondeoListaWA(vistaRef.current, !!abiertoRef.current));
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [activa, leer]);

  // Buscar también en el servidor: trae chats viejos que no vienen entre los recientes.
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || vista !== 'listo') {
      setEncontrados([]);
      return;
    }
    let vivo = true;
    const espera = setTimeout(() => {
      void API.chatsWA(t)
        .then((cs) => vivo && setEncontrados(cs))
        .catch(() => {});
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [q, vista]);

  const filtrados = useMemo(() => juntarChats(chats || [], encontrados).filter((c) => coincide(c, q)), [chats, encontrados, q]);

  const desvincular = () =>
    Alert.alert(tr('¿Desvincular WhatsApp?', 'Unlink WhatsApp?'), tr('AU-RA deja de ver tus chats y se borra lo que tenía guardado. Tu WhatsApp del teléfono no cambia.', 'AU-RA stops seeing your chats and what it stored is erased. WhatsApp on your phone doesn’t change.'), [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      {
        text: tr('Desvincular', 'Unlink'),
        style: 'destructive',
        onPress: () =>
          void API.desvincularWA()
            .then(() => {
              setChats(null);
              huella.current = '';
              void leer();
            })
            .catch((e: any) => setError(mensajeErrorWA(Number(e?.status) || 0, e?.message, idiomaActual() === 'en' ? 'en' : 'es'))),
      },
    ]);

  const cerrarNuevo = useCallback(() => setNuevo(false), []);
  const elegirContacto = useCallback(
    (k: ContactoWA) => {
      setNuevo(false);
      setAbierto(chatDeContacto(k, chats || []));
    },
    [chats]
  );

  const cerrarChat = useCallback(() => {
    setAbierto(null);
    void leer();
  }, [leer]);

  // El puente no contesta pero ya había chats: se siguen viendo (con el aviso arriba) en vez de una pantalla vacía.
  const conLista = vista === 'listo' || (vista === 'caido' && !!chats?.length);
  const numero = telefonoBonito(estado?.numero) || estado?.numero || '';
  const detalle = vista === 'caido' ? tr('sin conexión con tu WhatsApp', 'not connected to your WhatsApp') : vista === 'listo' ? [numero, estado?.conectado === false ? tr('reconectando…', 'reconnecting…') : ''].filter(Boolean).join(' · ') : tr('Tu WhatsApp personal', 'Your personal WhatsApp');

  return (
    <View style={{ flex: 1, backgroundColor: conLista ? w.fondo : p.fondo }}>
      <View style={[s.cabecera, { backgroundColor: w.cabecera, paddingTop: ins.top + MEDIDA.espacio.s, paddingLeft: ins.left + MEDIDA.espacio.m, paddingRight: ins.right + MEDIDA.espacio.m }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onAtras ? (
            <Pressable onPress={onAtras} accessibilityRole="button" accessibilityLabel={tr('Volver', 'Back')} hitSlop={8} style={s.botonCab}>
              <IconoWA nombre="atras" color={w.sobreCabecera} tam={24} grosor={2.2} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1, marginLeft: onAtras ? MEDIDA.espacio.xs : MEDIDA.espacio.s }}>
            <Text style={[s.titulo, { color: w.sobreCabecera }]} accessibilityRole="header">
              WhatsApp
            </Text>
            {detalle ? (
              <Text style={{ color: w.sobreCabecera2, fontSize: 13, marginTop: 1 }} numberOfLines={1}>
                {detalle}
              </Text>
            ) : null}
          </View>
          {vista === 'listo' ? (
            <Pressable onPress={desvincular} accessibilityRole="button" accessibilityLabel={tr('Más opciones: desvincular WhatsApp', 'More options: unlink WhatsApp')} hitSlop={8} style={s.botonCab}>
              <IconoWA nombre="puntos" color={w.sobreCabecera} tam={22} lleno />
            </Pressable>
          ) : null}
        </View>
        {cambio ? <View style={{ marginTop: MEDIDA.espacio.m }}>{cambio}</View> : null}
      </View>

      {conLista ? (
        <View style={[s.buscador, { backgroundColor: w.buscador }]}>
          <IconoWA nombre="buscar" tam={18} color={w.pista} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={tr('Buscar un chat o un número', 'Search a chat or a number')}
            placeholderTextColor={w.pista}
            autoCorrect={false}
            style={[s.buscadorTxt, { color: w.nombre }]}
            accessibilityLabel={tr('Buscar chats', 'Search chats')}
            returnKeyType="search"
          />
          {q ? (
            <Pressable onPress={() => setQ('')} accessibilityRole="button" accessibilityLabel={tr('Borrar la búsqueda', 'Clear search')} hitSlop={10} style={{ padding: 4 }}>
              <IconoWA nombre="cerrar" tam={16} color={w.pista} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!!error && vista !== 'vincular' && !(vista === 'caido' && !conLista) ? (
        <View style={[s.banda, { backgroundColor: w.avisoFondo }]}>
          <Text style={{ color: w.aviso, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      {vista === 'revisando' ? (
        <ActivityIndicator color={w.globo} style={{ marginTop: 48 }} />
      ) : vista === 'caido' && !conLista ? (
        <Aviso p={p} titulo={tr('Tu WhatsApp no contesta', 'Your WhatsApp isn’t answering')} texto={tr('Sigue vinculado: es la conexión con el servidor. Reintento solo cada pocos segundos; no hace falta vincular otra vez.', 'It’s still linked: it’s the connection to the server. I retry on my own every few seconds; no need to link again.')}>
          <Pressable onPress={() => void leer()} accessibilityRole="button" style={[s.botonGrande, { paddingHorizontal: 32, marginTop: 8 }]}>
            <Text style={s.botonGrandeTxt}>{tr('Reintentar ahora', 'Retry now')}</Text>
          </Pressable>
        </Aviso>
      ) : vista === 'sin_puente' || vista === 'oculto' ? (
        <Aviso p={p} titulo={tr('WhatsApp se está conectando', 'WhatsApp is connecting')} texto={tr('El servidor todavía no tiene tu WhatsApp listo. Vuelve en un rato.', 'The server doesn’t have your WhatsApp ready yet. Come back in a while.')} />
      ) : vista === 'vincular' ? (
        <Vincular p={p} estado={estado} onCambio={leer} />
      ) : chats === null ? (
        <ActivityIndicator color={w.globo} style={{ marginTop: 48 }} />
      ) : !chats.length ? (
        <Aviso p={p} titulo={tr('Trayendo tus chats…', 'Bringing your chats…')} texto={tr('Al vincular, WhatsApp manda tus conversaciones recientes. Tarda unos minutos la primera vez.', 'When you link, WhatsApp sends your recent conversations. It takes a few minutes the first time.')} />
      ) : (
        <FlatList
          data={filtrados}
          keyExtractor={(c) => c.jid}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={14}
          contentContainerStyle={{ paddingBottom: ins.bottom + 96, paddingLeft: ins.left, paddingRight: ins.right }}
          ListEmptyComponent={<Text style={{ color: w.previa, textAlign: 'center', marginTop: 32, fontSize: 15 }}>{tr(`Ningún chat con «${q.trim()}»`, `No chats matching “${q.trim()}”`)}</Text>}
          renderItem={({ item }) => <FilaChat c={item} w={w} idioma={idioma} onAbrir={setAbierto} />}
        />
      )}

      {conLista && chats !== null && !abierto && !nuevo ? (
        <Pressable
          onPress={() => setNuevo(true)}
          accessibilityRole="button"
          accessibilityLabel={tr('Nuevo chat', 'New chat')}
          style={({ pressed }) => [s.nuevo, { bottom: ins.bottom + 20, right: ins.right + 16, backgroundColor: '#00A884', opacity: pressed ? 0.85 : 1 }]}
        >
          <IconoWA nombre="nuevoChat" tam={26} color={p.oscuro ? '#111B21' : '#FFFFFF'} />
        </Pressable>
      ) : null}

      {nuevo ? <NuevoChatWA w={w} idioma={idioma} onElegir={elegirContacto} onCerrar={cerrarNuevo} /> : null}

      {abierto ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: w.chat }]}>
          <ConversacionWA key={abierto.jid} chat={abierto} onAtras={cerrarChat} />
        </View>
      ) : null}
    </View>
  );
}

/* ── una fila de la lista ─────────────────────────────────────────────────────────────────── */

const FilaChat = memo(function FilaChat({ c, w, idioma, onAbrir }: { c: ChatWA; w: PaletaWA; idioma: 'es' | 'en'; onAbrir: (c: ChatWA) => void }) {
  const nombre = nombreChat(c, idioma);
  const sinLeer = c.noLeidos > 0;
  const v = previaWA(c, idioma);
  const cuando = horaLista(c.hora, Date.now(), idioma);
  const etiqueta = [nombre, c.grupo ? tr('grupo', 'group') : '', sinLeer ? tr(`${c.noLeidos} sin leer`, `${c.noLeidos} unread`) : '', previaTexto(c, idioma), cuando].filter(Boolean).join(', ');
  return (
    <Pressable onPress={() => onAbrir(c)} android_ripple={{ color: w.separador }} accessibilityRole="button" accessibilityLabel={etiqueta} style={({ pressed }) => [st.fila, pressed && { backgroundColor: w.buscador }]}>
      <AvatarWA jid={c.jid} nombre={nombre} grupo={!!c.grupo} tam={50} w={w} tiene={c.foto ?? null} />
      <View style={[st.cuerpo, { borderBottomColor: w.separador }]}>
        <View style={st.arriba}>
          <Text style={[st.nombre, { color: w.nombre }]} numberOfLines={1}>
            {nombre}
          </Text>
          <Text style={[st.hora, { color: sinLeer ? w.horaSinLeer : w.hora }, sinLeer && { fontWeight: '600' }]}>{cuando}</Text>
        </View>
        <View style={st.abajo}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
            {v.quien ? (
              <Text style={[st.previa, { color: w.previa, flexShrink: 0, marginRight: 4 }]} numberOfLines={1}>
                {v.quien}:
              </Text>
            ) : null}
            {v.icono ? <IconoWA nombre={ICONO_PREVIA[v.icono]} tam={16} color={w.previa} grosor={2} style={{ marginRight: 3 }} /> : null}
            <Text style={[st.previa, { color: w.previa, flex: 1 }, v.icono === 'eliminado' && { fontStyle: 'italic' }, sinLeer && { color: w.nombre }]} numberOfLines={1}>
              {v.texto}
            </Text>
          </View>
          {sinLeer ? (
            <View style={[st.globo, { backgroundColor: w.globo }]}>
              <Text style={[st.globoTxt, { color: w.sobreGlobo }]} allowFontScaling={false}>
                {c.noLeidos > 999 ? '999+' : c.noLeidos}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

const st = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, minHeight: 72 },
  cuerpo: { flex: 1, marginLeft: 14, paddingRight: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, alignSelf: 'stretch', justifyContent: 'center' },
  arriba: { flexDirection: 'row', alignItems: 'center' },
  nombre: { flex: 1, fontSize: 17, fontWeight: '600', marginRight: 8 },
  hora: { fontSize: 12 },
  abajo: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  previa: { fontSize: 14.5 },
  globo: { minWidth: 21, height: 21, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  globoTxt: { fontSize: 12, fontWeight: '700' },
});

/* ── vincular ─────────────────────────────────────────────────────────────────────────────── */

function Vincular({ p, estado, onCambio }: { p: Paleta; estado: EstadoWA | null; onCambio: () => void }) {
  const s = useMemo(() => estilos(p), [p]);
  const [modo, setModo] = useState<'codigo' | 'qr'>('codigo');
  const [tel, setTel] = useState('');
  const [codigo, setCodigo] = useState('');
  const [qr, setQr] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  // Mientras vincula, el QR se renueva solo (el estado trae el último) y al vincular se cambia de pantalla.
  const qrVivo = estado?.qr || qr;
  const codigoVivo = estado?.codigo || codigo;

  const pedir = async () => {
    setError('');
    setOcupado(true);
    try {
      if (modo === 'codigo') {
        const t = telefonoValido(tel);
        if (!t) throw new Error(tr('Escribe tu número con el código de país, por ejemplo 504 9999 9999.', 'Type your number with the country code, e.g. 504 9999 9999.'));
        const r = await API.vincularWA(t);
        setCodigo(r.codigo || '');
      } else {
        const r = await API.vincularWA();
        setQr(r.qr || '');
      }
      onCambio();
    } catch (e: any) {
      setError(e?.message || tr('WhatsApp no contestó. Prueba otra vez.', 'WhatsApp didn’t answer. Try again.'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <View style={{ padding: MEDIDA.espacio.l, gap: MEDIDA.espacio.m }}>
      <Text style={s.vTitulo}>{tr('Vincula tu WhatsApp', 'Link your WhatsApp')}</Text>
      <Text style={s.detalle}>
        {tr(
          'AU-RA entra como un «dispositivo vinculado», igual que WhatsApp Web: ves tus chats y contestas desde aquí. Tu teléfono sigue funcionando igual.',
          'AU-RA joins as a “linked device”, like WhatsApp Web: you see your chats and reply from here. Your phone keeps working the same.'
        )}
      </Text>
      <View style={s.segmento}>
        {(['codigo', 'qr'] as const).map((m) => (
          <Pressable key={m} onPress={() => setModo(m)} style={[s.segOpcion, modo === m && { backgroundColor: '#00A884' }]} accessibilityRole="button">
            <Text style={[s.segTxt, modo === m && { color: '#FFFFFF' }]}>{m === 'codigo' ? tr('Con un código', 'With a code') : tr('Con QR', 'With QR')}</Text>
          </Pressable>
        ))}
      </View>
      {modo === 'codigo' ? (
        codigoVivo ? (
          <View style={s.tarjeta}>
            <Text style={s.detalle}>{tr('Escribe este código en WhatsApp:', 'Type this code in WhatsApp:')}</Text>
            <Text style={s.codigo} selectable>
              {codigoVivo}
            </Text>
            <Pasos p={p} pasos={[tr('Abre WhatsApp → ⋮ (Más opciones) → Dispositivos vinculados.', 'Open WhatsApp → ⋮ (More options) → Linked devices.'), tr('Toca «Vincular un dispositivo» y luego «Vincular con el número de teléfono».', 'Tap “Link a device”, then “Link with phone number instead”.'), tr('Escribe el código. Aquí cambia solo cuando quede vinculado.', 'Type the code. This screen changes by itself once it’s linked.')]} />
          </View>
        ) : (
          <View style={{ gap: MEDIDA.espacio.s }}>
            <Text style={s.detalle}>{tr('Tu número de WhatsApp, con el código de país:', 'Your WhatsApp number, with the country code:')}</Text>
            <TextInput value={tel} onChangeText={setTel} placeholder="504 9999 9999" placeholderTextColor={p.texto3} keyboardType="phone-pad" style={s.campo} accessibilityLabel={tr('Tu número', 'Your number')} />
          </View>
        )
      ) : qrVivo ? (
        <View style={[s.tarjeta, { alignItems: 'center' }]}>
          <Image source={{ uri: qrVivo }} style={{ width: 240, height: 240, borderRadius: 8, backgroundColor: '#fff' }} accessibilityLabel={tr('Código QR para vincular', 'QR code to link')} />
          <Pasos p={p} pasos={[tr('En el teléfono con tu WhatsApp: ⋮ → Dispositivos vinculados → Vincular un dispositivo.', 'On the phone with your WhatsApp: ⋮ → Linked devices → Link a device.'), tr('Escanea este código (se renueva solo).', 'Scan this code (it refreshes by itself).')]} />
        </View>
      ) : null}
      {!!error && <Text style={{ color: p.aviso, fontSize: 14 }}>{error}</Text>}
      {(modo === 'codigo' && !codigoVivo) || (modo === 'qr' && !qrVivo) ? (
        <Pressable onPress={() => void pedir()} disabled={ocupado} style={[s.botonGrande, ocupado && { opacity: 0.6 }]} accessibilityRole="button">
          {ocupado ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.botonGrandeTxt}>{modo === 'codigo' ? tr('Pedir el código', 'Get the code') : tr('Mostrar el QR', 'Show the QR')}</Text>}
        </Pressable>
      ) : null}
      <Text style={[s.detalle, { fontSize: 12, color: p.texto3 }]}>
        {tr('Es tu WhatsApp personal y solo tu cuenta de AU-RA lo ve. Puedes desvincularlo cuando quieras, desde aquí o desde el teléfono.', 'It’s your personal WhatsApp and only your AU-RA account sees it. Unlink it anytime, from here or from your phone.')}
      </Text>
    </View>
  );
}

function Pasos({ p, pasos }: { p: Paleta; pasos: string[] }) {
  return (
    <View style={{ gap: 6, alignSelf: 'stretch', marginTop: 6 }}>
      {pasos.map((t, i) => (
        <Text key={i} style={{ color: p.texto2, fontSize: 14, lineHeight: 20 }}>
          {i + 1}. {t}
        </Text>
      ))}
    </View>
  );
}

function Aviso({ p, titulo, texto, children }: { p: Paleta; titulo: string; texto: string; children?: ReactNode }) {
  return (
    <View style={{ padding: MEDIDA.espacio.xxl, alignItems: 'center', gap: 8 }}>
      <Icono nombre="burbujas" tam={44} color="#00A884" grosor={1.6} />
      <Text style={{ color: p.texto, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{titulo}</Text>
      <Text style={{ color: p.texto2, fontSize: 15, lineHeight: 21, textAlign: 'center' }}>{texto}</Text>
      {children}
    </View>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    cabecera: { paddingHorizontal: MEDIDA.espacio.m, paddingBottom: MEDIDA.espacio.m },
    botonCab: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    titulo: { fontSize: 22, fontWeight: '700' },
    detalle: { color: p.texto2, fontSize: MEDIDA.letra.chica + 1, marginTop: 2 },
    buscador: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 10, marginBottom: 4, paddingHorizontal: 14, height: 44, borderRadius: 22 },
    buscadorTxt: { flex: 1, fontSize: 16, paddingVertical: 0 },
    banda: { paddingVertical: 8, paddingHorizontal: MEDIDA.espacio.l },
    vTitulo: { color: p.texto, fontSize: 22, fontWeight: '800' },
    segmento: { flexDirection: 'row', backgroundColor: p.superficie, borderRadius: 999, padding: 4 },
    segOpcion: { flex: 1, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    segTxt: { color: p.texto, fontWeight: '700', fontSize: 14 },
    tarjeta: { backgroundColor: p.superficie, borderRadius: 18, padding: MEDIDA.espacio.l, gap: 8 },
    codigo: { color: p.texto, fontSize: 34, fontWeight: '900', letterSpacing: 4, textAlign: 'center', marginVertical: 6 },
    campo: { height: 52, borderRadius: 16, borderWidth: 1, borderColor: p.borde, backgroundColor: p.superficie, color: p.texto, fontSize: 18, paddingHorizontal: 14 },
    botonGrande: { height: 52, borderRadius: 26, backgroundColor: '#00A884', alignItems: 'center', justifyContent: 'center' },
    botonGrandeTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
    nuevo: { position: 'absolute', right: 16, width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  });
}
