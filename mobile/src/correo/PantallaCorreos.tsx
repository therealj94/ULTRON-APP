/**
 * TUS CORREOS EN LOS CHATS: la pestaña al lado de PULSE2CHAT y WhatsApp (whatsapp/ChatsConWhatsapp).
 * José (2-oct): «tengo que tener otra sección de los correos al par de WhatsApp y PULSE2CHAT, poder ver,
 * contestar, etc.».
 *
 *   · La bandeja de todas sus cuentas juntas (o de una, con los chips de arriba), en conversaciones:
 *     el círculo con las iniciales, quién lo manda, el asunto, la fecha («14:05», «Ayer», «lun», «2 oct»),
 *     cuántos hay en la conversación y el punto de sin leer; con varias cuentas, de cuál es.
 *   · Buscar (en el servidor: también el texto y los correos viejos), deslizar hacia abajo o el botón
 *     para refrescar; se refresca sola cada dos minutos mientras está a la vista.
 *   · Tocar uno lo abre entero (correo/LeerCorreo.tsx); «Responder», «Responder a todos» y el botón de
 *     redactar abren correo/RedactarCorreo.tsx. Nada sale sin el «Mandar» del aviso de confirmación.
 *   · Sin cuentas: explica cómo conectar una (Ajustes → Tus correos) y la conecta desde aquí mismo.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { idiomaActual, tr, useIdioma } from '../i18n';
import { HojaCorreos } from '../ajustes/Correos';
import * as API from './api';
import { IconoCorreo } from './IconoCorreo';
import { LeerCorreo } from './LeerCorreo';
import { RedactarCorreo } from './RedactarCorreo';
import {
  armarRespuesta,
  asuntoVisible,
  borradorNuevo,
  coincideHilo,
  colorCorreo,
  cuentaDeRef,
  fechaCorreo,
  hilos,
  inicialesCorreo,
  marcarLeido,
  mensajeErrorCorreo,
  noLeidosTotal,
  remitente,
  vistaCorreos,
  type BandejaCorreo,
  type BorradorCorreo,
  type HiloCorreo,
  type Idioma,
  type MensajeCorreo,
  type ResumenCorreo,
} from './logica';

type Props = {
  /** Las pestañas PULSE2CHAT · WhatsApp · Correos (van debajo del título). */
  cambio?: ReactNode;
  onAtras?: () => void;
  /** Está a la vista (la página del deslizador): si no, no pregunta nada. */
  activa: boolean;
  /** Cuántos correos sin leer hay (para el punto de la pestaña). */
  onNoLeidos?: (n: number) => void;
};

/** Cada cuánto se refresca sola mientras se ve (cada vuelta abre una conexión IMAP por cuenta). */
const REFRESCO_MS = 120_000;

export function PantallaCorreos({ cambio, onAtras, activa, onNoLeidos }: Props) {
  useIdioma();
  const p = useTema();
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const idioma: Idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [bandeja, setBandeja] = useState<BandejaCorreo | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [q, setQ] = useState('');
  const [buscados, setBuscados] = useState<ResumenCorreo[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [cuenta, setCuenta] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [redactar, setRedactar] = useState<BorradorCorreo | null>(null);
  const [conectar, setConectar] = useState(false);
  // La hoja de cuentas se monta la primera vez que se abre (montada pregunta sus cuentas al servidor).
  const [hojaUsada, setHojaUsada] = useState(false);
  useEffect(() => {
    if (conectar) setHojaUsada(true);
  }, [conectar]);
  const [aviso, setAviso] = useState('');
  const ultima = useRef(0);
  const enVuelo = useRef(false);
  const onNoLeidosRef = useRef(onNoLeidos);
  onNoLeidosRef.current = onNoLeidos;

  const refrescar = useCallback(async () => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    setCargando(true);
    try {
      const b = await API.bandejaCorreo({ n: 30 });
      ultima.current = Date.now();
      setBandeja(b);
      setError('');
      onNoLeidosRef.current?.(noLeidosTotal(b.mensajes));
    } catch (e: any) {
      setError(mensajeErrorCorreo(Number(e?.status) || 0, e?.message, idiomaActual() === 'en' ? 'en' : 'es'));
    } finally {
      enVuelo.current = false;
      setCargando(false);
    }
  }, []);

  // A la vista: la primera vez (o si pasó un rato) se trae; después, cada dos minutos mientras no haya
  // un correo abierto o uno a medio escribir.
  const quieto = !abierto && !redactar && !conectar;
  useEffect(() => {
    if (!activa || !quieto) return;
    if (Date.now() - ultima.current > 60_000) void refrescar();
    const reloj = setInterval(() => void refrescar(), REFRESCO_MS);
    return () => clearInterval(reloj);
  }, [activa, quieto, refrescar]);

  // Buscar en el servidor (asunto, quién y el texto, también los viejos), con una pausa al escribir.
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || !bandeja?.cuentas.length) {
      setBuscados(null);
      setBuscando(false);
      return;
    }
    let vivo = true;
    setBuscando(true);
    const espera = setTimeout(() => {
      API.bandejaCorreo({ buscar: t, n: 30, cuenta: cuenta || undefined })
        .then((b) => vivo && setBuscados(b.mensajes))
        .catch(() => vivo && setBuscados(null))
        .finally(() => vivo && setBuscando(false));
    }, 600);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [q, cuenta, bandeja?.cuentas.length]);

  // El aviso de «enviado» se va solo.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 6_000);
    return () => clearTimeout(t);
  }, [aviso]);

  const cuentas = bandeja?.cuentas || [];
  const variasCuentas = cuentas.length > 1;
  const vista = vistaCorreos({ bandeja, error });

  const todos = useMemo(() => {
    const base = (bandeja?.mensajes || []).filter((m) => !cuenta || cuentaDeRef(m.ref) === cuenta);
    if (!buscados) return base;
    const vistos = new Set(base.map((m) => m.ref));
    return [...base, ...buscados.filter((m) => !vistos.has(m.ref) && (!cuenta || cuentaDeRef(m.ref) === cuenta))];
  }, [bandeja, buscados, cuenta]);
  const lista = useMemo(() => {
    const hs = hilos(todos, idioma);
    if (!q.trim()) return hs;
    // Lo que el servidor encontró por el texto también cuenta, aunque el asunto no lo diga.
    const delServidor = new Set((buscados || []).map((m) => m.ref));
    return hs.filter((h) => coincideHilo(h, q) || h.mensajes.some((m) => delServidor.has(m.ref)));
  }, [todos, q, buscados, idioma]);
  const hiloAbierto = useMemo(() => (abierto ? lista.find((h) => h.mensajes.some((m) => m.ref === abierto))?.mensajes || [] : []), [abierto, lista]);
  const sinLeer = noLeidosTotal(bandeja?.mensajes || []);

  const alLeido = useCallback((ref: string) => {
    setBandeja((b) => {
      if (!b) return b;
      const mensajes = marcarLeido(b.mensajes, ref);
      onNoLeidosRef.current?.(noLeidosTotal(mensajes));
      return { ...b, mensajes };
    });
    setBuscados((bs) => (bs ? marcarLeido(bs, ref) : bs));
  }, []);
  const cerrarCorreo = useCallback(() => setAbierto(null), []);
  const responder = useCallback(
    (m: MensajeCorreo, modo: 'responder' | 'todos') => {
      const c = cuentas.find((x) => x.id === m.cuentaId);
      setRedactar(armarRespuesta(m, modo, c?.correo || m.cuenta, idioma));
    },
    [cuentas, idioma]
  );
  const nuevo = () => setRedactar(borradorNuevo(cuenta || cuentas[0]?.id || ''));
  const cerrarRedactar = useCallback(() => setRedactar(null), []);
  const enviado = useCallback((t: string) => {
    setRedactar(null);
    setAviso(t);
  }, []);

  const subtitulo =
    vista === 'lista'
      ? [sinLeer ? tr(`${sinLeer} sin leer`, `${sinLeer} unread`) : tr('Al día', 'All caught up'), variasCuentas ? tr(`${cuentas.length} cuentas`, `${cuentas.length} accounts`) : cuentas[0]?.correo || ''].filter(Boolean).join(' · ')
      : tr('Tus buzones, en un solo lugar', 'Your inboxes, in one place');

  return (
    <View style={{ flex: 1, backgroundColor: p.fondo }}>
      <View style={[s.cabecera, { paddingTop: ins.top + MEDIDA.espacio.s, paddingLeft: ins.left + MEDIDA.espacio.m, paddingRight: ins.right + MEDIDA.espacio.m }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onAtras ? (
            <Pressable onPress={onAtras} accessibilityRole="button" accessibilityLabel={tr('Volver', 'Back')} hitSlop={8} style={s.botonCab}>
              <IconoCorreo nombre="atras" color={p.texto} tam={24} grosor={2.2} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1, marginLeft: onAtras ? MEDIDA.espacio.xs : MEDIDA.espacio.s, minWidth: 0 }}>
            <Text style={[s.titulo, { color: p.texto }]} accessibilityRole="header">
              {tr('Correos', 'Email')}
            </Text>
            <Text style={{ color: p.texto2, fontSize: 13, marginTop: 1 }} numberOfLines={1}>
              {subtitulo}
            </Text>
          </View>
          {vista === 'lista' || vista === 'error' ? (
            <Pressable onPress={() => void refrescar()} disabled={cargando} accessibilityRole="button" accessibilityLabel={tr('Refrescar la bandeja', 'Refresh the inbox')} hitSlop={6} style={s.botonCab}>
              {cargando ? <ActivityIndicator color={p.acento} /> : <IconoCorreo nombre="reintentar" color={p.texto} tam={22} />}
            </Pressable>
          ) : null}
          {vista === 'lista' ? (
            <Pressable onPress={() => setConectar(true)} accessibilityRole="button" accessibilityLabel={tr('Tus cuentas de correo', 'Your email accounts')} hitSlop={6} style={s.botonCab}>
              <IconoCorreo nombre="cuentas" color={p.texto} tam={22} />
            </Pressable>
          ) : null}
        </View>
        {cambio ? <View style={{ marginTop: MEDIDA.espacio.m }}>{cambio}</View> : null}
      </View>

      {vista === 'lista' ? (
        <>
          <View style={[s.buscador, { backgroundColor: p.superficie, marginLeft: ins.left + 12, marginRight: ins.right + 12 }]}>
            <IconoCorreo nombre="buscar" tam={18} color={p.texto3} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={tr('Buscar por nombre, asunto o texto', 'Search by name, subject or text')}
              placeholderTextColor={p.texto3}
              autoCorrect={false}
              returnKeyType="search"
              style={[s.buscadorTxt, { color: p.texto }]}
              accessibilityLabel={tr('Buscar correos', 'Search email')}
            />
            {buscando ? <ActivityIndicator color={p.texto3} size="small" /> : null}
            {q ? (
              <Pressable onPress={() => setQ('')} accessibilityRole="button" accessibilityLabel={tr('Borrar la búsqueda', 'Clear search')} hitSlop={10} style={{ padding: 4 }}>
                <IconoCorreo nombre="cerrar" tam={16} color={p.texto3} />
              </Pressable>
            ) : null}
          </View>
          {variasCuentas ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 + ins.left, paddingVertical: 8 }}>
              {[{ id: '', correo: tr('Todas', 'All') }, ...cuentas].map((c) => {
                const activa = c.id === cuenta;
                return (
                  <Pressable
                    key={c.id || 'todas'}
                    onPress={() => setCuenta(c.id)}
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
            </ScrollView>
          ) : null}
        </>
      ) : null}

      {aviso ? (
        <View style={[s.banda, { backgroundColor: p.exitoFondo }]} accessibilityLiveRegion="polite">
          <Text style={{ color: p.exito, fontSize: 14, fontWeight: '600' }}>{aviso}</Text>
        </View>
      ) : null}
      {error && bandeja ? (
        <View style={[s.banda, { backgroundColor: p.avisoFondo }]}>
          <Text style={{ color: p.aviso, fontSize: 13.5 }}>{error}</Text>
        </View>
      ) : null}
      {bandeja?.errores.length ? (
        <View style={[s.banda, { backgroundColor: p.avisoFondo }]}>
          {bandeja.errores.map((e) => (
            <Text key={e.cuentaId || e.cuenta} style={{ color: p.aviso, fontSize: 13.5, lineHeight: 19 }}>
              {tr(`No pude abrir ${e.cuenta}: ${e.error}`, `I couldn’t open ${e.cuenta}: ${e.error}`)}
            </Text>
          ))}
        </View>
      ) : null}

      {vista === 'cargando' ? (
        <View style={s.centro}>
          <ActivityIndicator color={p.acento} size="large" />
          <Text style={{ color: p.texto3, marginTop: 12, fontSize: 14 }}>{tr('Revisando tus buzones…', 'Checking your inboxes…')}</Text>
        </View>
      ) : vista === 'error' ? (
        <Vacio p={p} icono="alerta" titulo={tr('No pude traer tus correos', 'I couldn’t get your email')} texto={error}>
          <Pressable onPress={() => void refrescar()} accessibilityRole="button" style={[s.pildora, { backgroundColor: p.acento }]}>
            <Text style={{ color: p.sobreAcento, fontWeight: '800', fontSize: 15 }}>{tr('Reintentar', 'Try again')}</Text>
          </Pressable>
        </Vacio>
      ) : vista === 'sin_cuentas' ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingBottom: ins.bottom + 24 }}>
          <Vacio
            p={p}
            icono="sobre"
            titulo={tr('Conecta tu correo', 'Connect your email')}
            texto={tr(
              'Aquí ves tus correos al lado de tus chats: los lees, los contestas y escribes nuevos. Conéctalo en Ajustes → Tus correos, o con el botón de abajo. Sirve Gmail, Outlook, Yahoo, iCloud o el de tu empresa.',
              'See your email next to your chats: read it, reply and write new ones. Connect it in Settings → Your email, or with the button below. Gmail, Outlook, Yahoo, iCloud or your company’s all work.'
            )}
          >
            <Pressable onPress={() => setConectar(true)} accessibilityRole="button" style={[s.pildora, { backgroundColor: p.acento }]}>
              <Text style={{ color: p.sobreAcento, fontWeight: '800', fontSize: 15 }}>{tr('Conectar una cuenta', 'Connect an account')}</Text>
            </Pressable>
            <Text style={{ color: p.texto3, fontSize: 12.5, lineHeight: 18, textAlign: 'center', marginTop: 12 }}>
              {tr('Tu clave se guarda cifrada en el servidor. Nada se manda sin que tú lo confirmes.', 'Your password is stored encrypted on the server. Nothing is sent unless you confirm it.')}
            </Text>
          </Vacio>
        </ScrollView>
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(h) => h.clave}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={14}
          refreshControl={<RefreshControl refreshing={cargando && !!bandeja} onRefresh={() => void refrescar()} colors={[p.acento]} tintColor={p.acento} />}
          contentContainerStyle={{ paddingBottom: ins.bottom + 96, paddingLeft: ins.left, paddingRight: ins.right, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ padding: MEDIDA.espacio.xxl, alignItems: 'center' }}>
              <Text style={{ color: p.texto2, fontSize: 15, textAlign: 'center', lineHeight: 21 }}>
                {q.trim()
                  ? buscando
                    ? tr('Buscando…', 'Searching…')
                    : tr(`Ningún correo con «${q.trim()}»`, `No email matching “${q.trim()}”`)
                  : tr('Tu bandeja está vacía.', 'Your inbox is empty.')}
              </Text>
            </View>
          }
          renderItem={({ item }) => <FilaCorreo h={item} p={p} idioma={idioma} variasCuentas={variasCuentas && !cuenta} onAbrir={setAbierto} />}
        />
      )}

      {vista === 'lista' && !abierto && !redactar ? (
        <Pressable
          onPress={nuevo}
          accessibilityRole="button"
          accessibilityLabel={tr('Redactar un correo nuevo', 'Write a new email')}
          style={({ pressed }) => [s.redactar, { bottom: ins.bottom + 20, right: ins.right + 16, backgroundColor: p.acento, opacity: pressed ? 0.85 : 1 }]}
        >
          <IconoCorreo nombre="lapiz" tam={22} color={p.sobreAcento} />
          <Text style={{ color: p.sobreAcento, fontWeight: '800', fontSize: 15 }}>{tr('Redactar', 'Compose')}</Text>
        </Pressable>
      ) : null}

      {abierto ? <LeerCorreo refCorreo={abierto} hilo={hiloAbierto} variasCuentas={variasCuentas} idioma={idioma} onCerrar={cerrarCorreo} onAbrir={setAbierto} onLeido={alLeido} onResponder={responder} /> : null}
      {redactar ? <RedactarCorreo inicial={redactar} cuentas={cuentas} idioma={idioma} onCerrar={cerrarRedactar} onEnviado={enviado} /> : null}

      {conectar || hojaUsada ? (
        <HojaCorreos
          visible={conectar}
          onCerrar={() => {
            setConectar(false);
            void refrescar();
          }}
        />
      ) : null}
    </View>
  );
}

/* ── una fila de la bandeja ───────────────────────────────────────────────────────────────── */

const FilaCorreo = memo(function FilaCorreo({ h, p, idioma, variasCuentas, onAbrir }: { h: HiloCorreo; p: Paleta; idioma: Idioma; variasCuentas: boolean; onAbrir: (ref: string) => void }) {
  const m = h.ultimo;
  const nombre = remitente(m, idioma);
  const sinLeer = h.noLeidos > 0;
  const quienes = h.participantes.length > 1 ? h.participantes.slice(0, 3).join(', ') : nombre;
  const asunto = asuntoVisible(m.asunto, idioma);
  const cuando = fechaCorreo(m.fecha, Date.now(), idioma);
  const etiqueta = [quienes, h.mensajes.length > 1 ? tr(`${h.mensajes.length} correos`, `${h.mensajes.length} emails`) : '', sinLeer ? tr('sin leer', 'unread') : '', asunto, cuando, variasCuentas ? m.cuenta : ''].filter(Boolean).join(', ');
  return (
    <Pressable onPress={() => onAbrir(m.ref)} android_ripple={{ color: p.borde }} accessibilityRole="button" accessibilityLabel={etiqueta} style={({ pressed }) => [st.fila, pressed && { backgroundColor: p.superficie }]}>
      <View style={[st.circulo, { backgroundColor: colorCorreo(m.deCorreo || nombre) }]}>
        <Text style={st.iniciales} allowFontScaling={false}>
          {inicialesCorreo(nombre) || '@'}
        </Text>
      </View>
      <View style={[st.cuerpo, { borderBottomColor: p.borde }]}>
        <View style={st.linea}>
          <Text style={[st.nombre, { color: p.texto, fontWeight: sinLeer ? '800' : '600' }]} numberOfLines={1}>
            {quienes}
          </Text>
          {h.mensajes.length > 1 ? <Text style={{ color: p.texto3, fontSize: 13, marginLeft: 6 }}>{h.mensajes.length}</Text> : null}
          <Text style={[st.fecha, { color: sinLeer ? p.acentoTexto : p.texto3, fontWeight: sinLeer ? '700' : '400' }]}>{cuando}</Text>
        </View>
        <View style={[st.linea, { marginTop: 3 }]}>
          <Text style={[st.asunto, { color: sinLeer ? p.texto : p.texto2, fontWeight: sinLeer ? '700' : '400' }]} numberOfLines={1}>
            {asunto}
          </Text>
          {sinLeer ? <View style={[st.punto, { backgroundColor: p.acento }]} /> : null}
        </View>
        {variasCuentas ? (
          <Text style={{ color: p.texto3, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
            {m.cuenta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const st = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, minHeight: 76 },
  circulo: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  iniciales: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  cuerpo: { flex: 1, marginLeft: 14, paddingRight: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, alignSelf: 'stretch', justifyContent: 'center', minWidth: 0 },
  linea: { flexDirection: 'row', alignItems: 'center' },
  nombre: { flexShrink: 1, fontSize: 16 },
  fecha: { fontSize: 12.5, marginLeft: 'auto', paddingLeft: 8 },
  asunto: { flex: 1, fontSize: 14.5 },
  punto: { width: 10, height: 10, borderRadius: 5, marginLeft: 8 },
});

function Vacio({ p, icono, titulo, texto, children }: { p: Paleta; icono: 'sobre' | 'alerta'; titulo: string; texto: string; children?: ReactNode }) {
  return (
    <View style={{ padding: MEDIDA.espacio.xxl, alignItems: 'center', gap: 8, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: p.acentoFondo, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
        <IconoCorreo nombre={icono} tam={42} color={p.acentoTexto} grosor={1.7} />
      </View>
      <Text style={{ color: p.texto, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>{titulo}</Text>
      {texto ? <Text style={{ color: p.texto2, fontSize: 15, lineHeight: 22, textAlign: 'center' }}>{texto}</Text> : null}
      {children}
    </View>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    cabecera: { paddingBottom: MEDIDA.espacio.m, backgroundColor: p.fondo },
    botonCab: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    titulo: { fontSize: 22, fontWeight: '700' },
    buscador: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 4, paddingHorizontal: 14, height: 44, borderRadius: 22 },
    buscadorTxt: { flex: 1, fontSize: 16, paddingVertical: 0 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, height: 36, justifyContent: 'center', maxWidth: 260 },
    banda: { paddingVertical: 8, paddingHorizontal: MEDIDA.espacio.l, gap: 4 },
    centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    pildora: { marginTop: 14, height: 50, borderRadius: 25, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
    redactar: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8, height: 54, borderRadius: 18, paddingHorizontal: 20, elevation: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  });
}
