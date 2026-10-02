/**
 * SU WHATSAPP EN LA APP: vincular, la lista de chats y cada conversación (server/whatsapp.ts).
 *
 *   · Sin vincular: «con un código» (sirve en este mismo teléfono: WhatsApp → Dispositivos vinculados →
 *     Vincular con el número de teléfono) o «con QR» (para escanearlo desde otro teléfono o la PC).
 *   · Vinculado: los chats como en WhatsApp (sin leer arriba en negrita, grupos, buscar) y cada chat con
 *     sus burbujas, fotos (la miniatura; tocarla abre la foto entera), notas de voz y documentos
 *     nombrados, y la caja para escribir. Lo que escribe y manda sale directo (es su «sí»).
 *   · Se renueva solo mientras está a la vista (cada 5 s la lista, cada 3 s el chat abierto).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, BackHandler, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { idiomaActual, tr, useIdioma } from '../i18n';
import { Avatar } from '../pulse/ui/Avatar';
import { BotonEnviar } from '../pulse/ui/BotonEnviar';
import { Icono } from '../pulse/ui/Icono';
import { Tocable } from '../pulse/ui/Tocable';
import { cuandoLista, etiquetaDia, hora } from '../pulse/ui/formato';
import * as API from './api';
import { registrarAtras } from './atras';
import { etiquetaMedia, filasWA, juntar, nombreChat, previa, sondeoWA, telefonoValido, textoBurbuja, vistaDe, type ChatWA, type EstadoWA, type FilaWA, type MensajeWA } from './logica';

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

export function PantallaWhatsapp({ cambio, onAtras, activa, estadoInicial = null, onNoLeidos }: Props) {
  useIdioma();
  const p = useTema();
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [estado, setEstado] = useState<EstadoWA | null>(estadoInicial);
  const [chats, setChats] = useState<ChatWA[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<ChatWA | null>(null);
  const vista = vistaDe(estado);

  const leer = useCallback(async () => {
    try {
      const e = await API.estadoWA();
      setEstado(e);
      if (vistaDe(e) === 'listo') {
        const cs = await API.chatsWA();
        setChats(cs);
        onNoLeidos?.(cs.filter((c) => c.noLeidos > 0).length);
      }
      setError('');
    } catch (e: any) {
      setError(e?.message || tr('No pude abrir tu WhatsApp.', 'I couldn’t open your WhatsApp.'));
    }
  }, [onNoLeidos]);

  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      await leer();
      if (vivo) reloj = setTimeout(vuelta, sondeoWA(vistaRef.current, !!abiertoRef.current));
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [activa, leer]);
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const abiertoRef = useRef(abierto);
  abiertoRef.current = abierto;

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (chats || []).filter((c) => !t || nombreChat(c).toLowerCase().includes(t) || c.ultimo.toLowerCase().includes(t));
  }, [chats, q]);

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
              void leer();
            })
            .catch((e: any) => setError(e?.message || '')),
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: p.fondo }}>
      <View style={[s.cabecera, { paddingTop: ins.top + MEDIDA.espacio.s }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onAtras ? (
            <Tocable onPress={onAtras} etiqueta={tr('Volver', 'Back')} hitSlop={8} style={s.botonCab}>
              <Icono nombre="atras" color={p.texto} tam={24} grosor={2} />
            </Tocable>
          ) : null}
          <View style={{ flex: 1, marginLeft: onAtras ? MEDIDA.espacio.xs : MEDIDA.espacio.s }}>
            <Text style={s.titulo}>WhatsApp</Text>
            <Text style={[s.detalle, { marginTop: 2 }]} numberOfLines={1}>
              {vista === 'listo' ? `${estado?.numero || ''}${estado?.conectado === false ? ` · ${tr('reconectando…', 'reconnecting…')}` : ''}` : tr('Tu WhatsApp personal', 'Your personal WhatsApp')}
            </Text>
          </View>
          {vista === 'listo' ? (
            <Tocable onPress={desvincular} etiqueta={tr('Desvincular WhatsApp', 'Unlink WhatsApp')} hitSlop={8} style={s.botonCab}>
              <Icono nombre="puntos" color={p.texto2} tam={22} grosor={2} />
            </Tocable>
          ) : null}
        </View>
        {cambio ? <View style={{ marginTop: MEDIDA.espacio.m }}>{cambio}</View> : null}
        {vista === 'listo' ? (
          <View style={s.buscador}>
            <Icono nombre="buscar" tam={18} color={p.texto3} grosor={2} />
            <TextInput value={q} onChangeText={setQ} placeholder={tr('Buscar chats', 'Search chats')} placeholderTextColor={p.texto3} autoCorrect={false} style={s.buscadorTxt} accessibilityLabel={tr('Buscar', 'Search')} />
          </View>
        ) : null}
      </View>

      {!!error && vista !== 'vincular' ? (
        <View style={s.banda}>
          <Text style={s.bandaTxt}>{error}</Text>
        </View>
      ) : null}

      {vista === 'revisando' ? (
        <ActivityIndicator color={p.acento} style={{ marginTop: 48 }} />
      ) : vista === 'sin_puente' || vista === 'oculto' ? (
        <Aviso p={p} titulo={tr('WhatsApp se está conectando', 'WhatsApp is connecting')} texto={tr('El servidor todavía no tiene tu WhatsApp listo. Vuelve en un rato.', 'The server doesn’t have your WhatsApp ready yet. Come back in a while.')} />
      ) : vista === 'vincular' ? (
        <Vincular p={p} estado={estado} onCambio={leer} />
      ) : chats === null ? (
        <ActivityIndicator color={p.acento} style={{ marginTop: 48 }} />
      ) : !chats.length ? (
        <Aviso p={p} titulo={tr('Trayendo tus chats…', 'Bringing your chats…')} texto={tr('Al vincular, WhatsApp manda tus conversaciones recientes. Tarda unos minutos la primera vez.', 'When you link, WhatsApp sends your recent conversations. It takes a few minutes the first time.')} />
      ) : (
        <FlatList
          data={filtrados}
          keyExtractor={(c) => c.jid}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: ins.bottom + 24 }}
          renderItem={({ item: c }) => {
            const sinLeer = c.noLeidos > 0;
            return (
              <Tocable onPress={() => setAbierto(c)} hundir={0.985} ripple={p.acentoFondo} etiqueta={nombreChat(c)} style={s.fila}>
                <Avatar nombre={nombreChat(c)} anillo={sinLeer} />
                <View style={s.filaCuerpo}>
                  <View style={s.filaArriba}>
                    <Text style={[s.nombre, { flex: 1 }, sinLeer && { fontWeight: '800' }]} numberOfLines={1}>
                      {nombreChat(c)}
                      {c.grupo ? <Text style={s.grupo}>  {tr('grupo', 'group')}</Text> : null}
                    </Text>
                    <Text style={[s.hora, sinLeer && { color: p.acentoTexto, fontWeight: '700' }]}>{cuandoLista(c.hora)}</Text>
                  </View>
                  <View style={s.filaAbajo}>
                    <Text style={[s.detalle, { flex: 1 }, sinLeer && { color: p.texto }]} numberOfLines={1}>
                      {previa(c, idioma)}
                    </Text>
                    {sinLeer ? (
                      <View style={s.globo}>
                        <Text style={s.globoTxt}>{c.noLeidos > 99 ? '99+' : c.noLeidos}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Tocable>
            );
          }}
        />
      )}

      {abierto ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: p.fondo }]}>
          <ConversacionWA
            chat={abierto}
            onAtras={() => {
              setAbierto(null);
              void leer();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

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
          <Pressable key={m} onPress={() => setModo(m)} style={[s.segOpcion, modo === m && { backgroundColor: p.acento }]} accessibilityRole="button">
            <Text style={[s.segTxt, modo === m && { color: p.sobreAcento }]}>{m === 'codigo' ? tr('Con un código', 'With a code') : tr('Con QR', 'With QR')}</Text>
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
          {ocupado ? <ActivityIndicator color={p.sobreAcento} /> : <Text style={s.botonGrandeTxt}>{modo === 'codigo' ? tr('Pedir el código', 'Get the code') : tr('Mostrar el QR', 'Show the QR')}</Text>}
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

function Aviso({ p, titulo, texto }: { p: Paleta; titulo: string; texto: string }) {
  return (
    <View style={{ padding: MEDIDA.espacio.xxl, alignItems: 'center', gap: 8 }}>
      <Icono nombre="burbujas" tam={44} color={p.acentoTexto} grosor={1.6} />
      <Text style={{ color: p.texto, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{titulo}</Text>
      <Text style={{ color: p.texto2, fontSize: 15, lineHeight: 21, textAlign: 'center' }}>{texto}</Text>
    </View>
  );
}

/* ── la conversación ──────────────────────────────────────────────────────────────────────── */

export function ConversacionWA({ chat, onAtras }: { chat: ChatWA; onAtras: () => void }) {
  const p = useTema();
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [mensajes, setMensajes] = useState<MensajeWA[] | null>(null);
  const [locales, setLocales] = useState<MensajeWA[]>([]);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [foto, setFoto] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const lista = useRef<FlatList<FilaWA>>(null);
  const ultimoAjeno = useRef('');

  // «Atrás» cierra el chat (en el Modal de los chats y en la pila de pantallas).
  useEffect(() => {
    const quitar = registrarAtras(() => (foto ? (setFoto(null), true) : (onAtras(), true)));
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (foto ? (setFoto(null), true) : (onAtras(), true)));
    return () => {
      quitar();
      sub.remove();
    };
  }, [onAtras, foto]);

  useEffect(() => {
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      try {
        const r = await API.mensajesWA(chat.jid);
        if (!vivo) return;
        setMensajes(r.mensajes);
        setError('');
        // Llegó algo nuevo de la otra persona estando a la vista: queda leído (también en su teléfono).
        const ajeno = [...r.mensajes].reverse().find((m) => !m.mio);
        if (ajeno && ajeno.id !== ultimoAjeno.current) {
          ultimoAjeno.current = ajeno.id;
          void API.leidoWA(chat.jid).catch(() => {});
        }
      } catch (e: any) {
        if (vivo) setError(e?.message || tr('No pude traer los mensajes.', 'I couldn’t get the messages.'));
      }
      if (vivo) reloj = setTimeout(vuelta, sondeoWA('listo', true));
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [chat.jid]);

  const todos = useMemo(() => juntar(mensajes || [], locales), [mensajes, locales]);
  const filas = useMemo(() => filasWA(todos, chat.grupo), [todos, chat.grupo]);

  const enviar = async (contenido = texto) => {
    const t = contenido.trim();
    if (!t) return;
    setTexto('');
    const local: MensajeWA = { id: `local-${Date.now()}`, chat: chat.jid, de: '', nombreDe: '', mio: true, hora: Date.now(), tipo: 'texto', texto: t, enviando: true };
    setLocales((l) => [...l.filter((x) => x.texto !== t || !x.fallo), local]);
    try {
      const m = await API.enviarWA(chat.jid, t);
      setLocales((l) => l.filter((x) => x.id !== local.id));
      setMensajes((ms) => (ms && !ms.some((x) => x.id === m.id) ? [...ms, m] : ms));
    } catch (e: any) {
      setLocales((l) => l.map((x) => (x.id === local.id ? { ...x, enviando: false, fallo: e?.message || tr('No salió', 'Not sent') } : x)));
    }
  };

  const verFoto = async (m: MensajeWA) => {
    if (!m.conMedia || m.tipo !== 'imagen') return;
    setFoto(await API.fuenteMedia(m.chat, m.id));
  };

  const anchoMax = Math.min(width * 0.78, 520);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[s.cabeceraChat, { paddingTop: ins.top + MEDIDA.espacio.xs }]}>
        <Tocable onPress={onAtras} etiqueta={tr('Volver', 'Back')} hitSlop={8} style={s.botonCab}>
          <Icono nombre="atras" color={p.texto} tam={24} grosor={2} />
        </Tocable>
        <Avatar nombre={nombreChat(chat)} tam={38} />
        <View style={{ flex: 1, marginLeft: MEDIDA.espacio.s }}>
          <Text style={s.nombre} numberOfLines={1}>
            {nombreChat(chat)}
          </Text>
          <Text style={[s.detalle, { marginTop: 0 }]} numberOfLines={1}>
            {chat.grupo ? tr('Grupo de WhatsApp', 'WhatsApp group') : 'WhatsApp'}
          </Text>
        </View>
      </View>
      {!!error && (
        <View style={s.banda}>
          <Text style={s.bandaTxt}>{error}</Text>
        </View>
      )}
      {mensajes === null ? (
        <ActivityIndicator color={p.acento} style={{ marginTop: 48, flex: 1 }} />
      ) : (
        <FlatList
          ref={lista}
          data={filas}
          keyExtractor={(f) => f.clave}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: MEDIDA.espacio.m, paddingVertical: MEDIDA.espacio.m }}
          onContentSizeChange={() => lista.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: f }) =>
            f.tipo === 'dia' ? (
              <View style={s.dia}>
                <Text style={s.diaTxt}>{etiquetaDia(f.ms)}</Text>
              </View>
            ) : (
              <BurbujaWA f={f} p={p} anchoMax={anchoMax} idioma={idioma} onFoto={verFoto} onReintentar={(t) => void enviar(t)} />
            )
          }
        />
      )}
      <View style={[s.redactor, { paddingBottom: ins.bottom + MEDIDA.espacio.s }]}>
        <TextInput
          value={texto}
          onChangeText={setTexto}
          placeholder={tr('Mensaje', 'Message')}
          placeholderTextColor={p.texto3}
          multiline
          maxLength={4000}
          style={s.caja}
          accessibilityLabel={tr('Escribe un mensaje de WhatsApp', 'Type a WhatsApp message')}
        />
        <BotonEnviar activo={!!texto.trim()} onEnviar={() => void enviar()} />
      </View>
      <Modal visible={!!foto} transparent animationType="fade" onRequestClose={() => setFoto(null)}>
        <Pressable style={s.visor} onPress={() => setFoto(null)} accessibilityRole="button" accessibilityLabel={tr('Cerrar la foto', 'Close the photo')}>
          {foto ? <Image source={foto} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function BurbujaWA({ f, p, anchoMax, idioma, onFoto, onReintentar }: { f: Extract<FilaWA, { tipo: 'msg' }>; p: Paleta; anchoMax: number; idioma: 'es' | 'en'; onFoto: (m: MensajeWA) => void; onReintentar: (t: string) => void }) {
  const s = useMemo(() => estilos(p), [p]);
  const m = f.m;
  const etiqueta = m.eliminado ? null : etiquetaMedia(m, idioma);
  const cuerpo = textoBurbuja(m);
  return (
    <View style={{ alignItems: m.mio ? 'flex-end' : 'flex-start', marginTop: f.pegadaArriba ? 2 : MEDIDA.espacio.s }}>
      <View style={[s.burbuja, { maxWidth: anchoMax, backgroundColor: m.mio ? p.burbujaMia : p.burbujaOtro }, m.fallo && { borderWidth: 1, borderColor: p.aviso }]}>
        {f.conNombre ? <Text style={s.burbujaNombre}>{m.nombreDe || tr('Alguien', 'Someone')}</Text> : null}
        {m.miniatura && !m.eliminado ? (
          <Pressable onPress={() => onFoto(m)} accessibilityRole="imagebutton" accessibilityLabel={tr('Ver la foto', 'See the photo')}>
            <Image source={{ uri: `data:image/jpeg;base64,${m.miniatura}` }} style={{ width: Math.min(anchoMax - 20, 260), height: Math.min(anchoMax - 20, 260) * 0.75, borderRadius: 10, marginBottom: 4 }} resizeMode="cover" />
          </Pressable>
        ) : null}
        {m.eliminado ? <Text style={[s.burbujaTxt, { fontStyle: 'italic', color: m.mio ? p.textoMia : p.texto3 }]}>🚫 {tr('Mensaje eliminado', 'Message deleted')}</Text> : null}
        {etiqueta ? <Text style={[s.burbujaTxt, { color: m.mio ? p.textoMia : p.textoOtro, fontWeight: '600' }]}>{etiqueta}</Text> : null}
        {cuerpo ? (
          <Text style={[s.burbujaTxt, { color: m.mio ? p.textoMia : p.textoOtro }]} selectable>
            {cuerpo}
          </Text>
        ) : null}
        <Text style={[s.burbujaHora, { color: m.mio ? p.textoMia : p.texto3 }]}>
          {m.editado ? `${tr('editado', 'edited')} · ` : ''}
          {m.enviando ? tr('enviando…', 'sending…') : hora(m.hora)}
        </Text>
      </View>
      {m.fallo ? (
        <Pressable onPress={() => onReintentar(m.texto)} accessibilityRole="button">
          <Text style={{ color: p.aviso, fontSize: 12, marginTop: 2 }}>
            {m.fallo} · {tr('tocar para reintentar', 'tap to retry')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    cabecera: { paddingHorizontal: MEDIDA.espacio.l, paddingBottom: MEDIDA.espacio.s, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.borde },
    cabeceraChat: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: MEDIDA.espacio.s, paddingBottom: MEDIDA.espacio.s, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.borde },
    botonCab: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    titulo: { color: p.texto, fontSize: MEDIDA.letra.titulo, fontWeight: '800' },
    detalle: { color: p.texto2, fontSize: MEDIDA.letra.chica + 1, marginTop: 2 },
    buscador: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: MEDIDA.espacio.m, paddingHorizontal: 14, height: 44, borderRadius: 22, backgroundColor: p.superficie },
    buscadorTxt: { flex: 1, color: p.texto, fontSize: MEDIDA.letra.cuerpo },
    banda: { backgroundColor: p.avisoFondo, paddingVertical: 8, paddingHorizontal: MEDIDA.espacio.l },
    bandaTxt: { color: p.aviso, fontSize: 13 },
    fila: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: MEDIDA.espacio.l, paddingVertical: 10 },
    filaCuerpo: { flex: 1, marginLeft: MEDIDA.espacio.m },
    filaArriba: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    filaAbajo: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    nombre: { color: p.texto, fontSize: MEDIDA.letra.cuerpo + 1, fontWeight: '600' },
    grupo: { color: p.texto3, fontSize: 12, fontWeight: '600' },
    hora: { color: p.texto3, fontSize: 12 },
    globo: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: p.acento, alignItems: 'center', justifyContent: 'center' },
    globoTxt: { color: p.sobreAcento, fontSize: 12, fontWeight: '800' },
    vTitulo: { color: p.texto, fontSize: 22, fontWeight: '800' },
    segmento: { flexDirection: 'row', backgroundColor: p.superficie, borderRadius: 999, padding: 4 },
    segOpcion: { flex: 1, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    segTxt: { color: p.texto, fontWeight: '700', fontSize: 14 },
    tarjeta: { backgroundColor: p.superficie, borderRadius: 18, padding: MEDIDA.espacio.l, gap: 8 },
    codigo: { color: p.texto, fontSize: 34, fontWeight: '900', letterSpacing: 4, textAlign: 'center', marginVertical: 6 },
    campo: { height: 52, borderRadius: 16, borderWidth: 1, borderColor: p.borde, backgroundColor: p.superficie, color: p.texto, fontSize: 18, paddingHorizontal: 14 },
    botonGrande: { height: 52, borderRadius: 26, backgroundColor: p.acento, alignItems: 'center', justifyContent: 'center' },
    botonGrandeTxt: { color: p.sobreAcento, fontWeight: '800', fontSize: 16 },
    dia: { alignSelf: 'center', backgroundColor: p.superficie, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginVertical: MEDIDA.espacio.s },
    diaTxt: { color: p.texto2, fontSize: 12, fontWeight: '700' },
    burbuja: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
    burbujaNombre: { color: p.acentoTexto, fontSize: 12.5, fontWeight: '800', marginBottom: 2 },
    burbujaTxt: { fontSize: MEDIDA.letra.cuerpo, lineHeight: 21 },
    burbujaHora: { fontSize: 11, alignSelf: 'flex-end', marginTop: 2, opacity: 0.8 },
    redactor: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: MEDIDA.espacio.m, paddingTop: MEDIDA.espacio.s, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.borde },
    caja: { flex: 1, minHeight: 46, maxHeight: 140, borderRadius: 23, backgroundColor: p.superficie, color: p.texto, fontSize: MEDIDA.letra.cuerpo, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
    visor: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  });
}
