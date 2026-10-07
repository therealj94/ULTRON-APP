/**
 * SU WHATSAPP EN LA APP: vincular, la lista de chats y cada conversación (server/whatsapp.ts). Cada cuenta de
 * AU-RA, el suyo (José, 5-oct: «No aparece agregar whatsapp…»).
 *
 *   · Sin vincular: «Agregar mi WhatsApp»: primero acepta qué se guarda y el riesgo (la tarjeta de consentimiento);
 *     luego «con un código» (sirve en este mismo teléfono: WhatsApp → Dispositivos vinculados → Vincular un
 *     dispositivo → Vincular con número de teléfono) o, de segunda opción, «con QR» (desde otro teléfono o la PC).
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
import { ActivityIndicator, Alert, Clipboard, FlatList, Image, Pressable, Share, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Letra as Text } from '../ui/Letra';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { idiomaActual, tr, useIdioma } from '../i18n';
import { Icono } from '../pulse/ui/Icono';
import * as API from './api';
import { ConversacionWA } from './ConversacionWA';
import { IconoWA, type NombreIconoWA } from './IconoWA';
import { NuevoChatWA } from './NuevoChatWA';
import { guardarWA, leerGuardadoWA } from './guardado';
import { fuente } from '../ui/tipografia';
import { AvatarWA } from './PiezasWA';
import {
  chatDeContacto,
  codigoLegibleWA,
  coincide,
  errorVincularWA,
  horaLista,
  huellaChats,
  juntarChats,
  mensajeErrorWA,
  nombreChat,
  paletaWA,
  pasosCodigoWA,
  pasoVincularWA,
  previaTexto,
  previaWA,
  sondeoListaWA,
  telefonoBonito,
  telefonoValido,
  textoConsentimientoWA,
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
  /** Cada estado nuevo (al vincular, la pestaña «+ WhatsApp» pasa a «WhatsApp»). */
  onEstado?: (e: EstadoWA) => void;
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

export function PantallaWhatsapp({ cambio, onAtras, activa, estadoInicial = null, onNoLeidos, onEstado }: Props) {
  useIdioma();
  const p = useTema();
  const w = useMemo(() => paletaWA(p), [p]);
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  // Acostado, el botón flotante taparía la hora y el globo de sin leer: «Nuevo chat» va en la cabecera.
  const { width: anchoV, height: altoV } = useWindowDimensions();
  const acostado = anchoV > altoV;
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [estado, setEstado] = useState<EstadoWA | null>(estadoInicial);
  const [chats, setChats] = useState<ChatWA[] | null>(null);
  const [encontrados, setEncontrados] = useState<ChatWA[]>([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<ChatWA | null>(null);
  const [nuevo, setNuevo] = useState(false);
  /** Lo que se ve es lo último guardado en el teléfono (sin red): se dice arriba, sin esconder la lista. */
  const [deGuardado, setDeGuardado] = useState(false);
  const huella = useRef('');
  const vista = vistaDe(estado);

  // Sin red al abrir: lo de la última vez (whatsapp/guardado.ts) en vez de un círculo que gira sin fin (A3).
  // Solo si todavía no llegó nada del servidor: lo de verdad siempre gana.
  useEffect(() => {
    let vivo = true;
    void leerGuardadoWA().then((g) => {
      if (!vivo || !g || huella.current) return;
      setEstado((e) => e ?? g.estado);
      setChats((cs) => cs ?? g.chats);
      setDeGuardado(true);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const leer = useCallback(async () => {
    try {
      const e = await API.estadoWA();
      setEstado(e);
      onEstado?.(e);
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
          guardarWA(e, cs);
        } else setChats((v) => v ?? cs);
        setDeGuardado(false);
        onNoLeidos?.(cs.filter((c) => c.noLeidos > 0).length);
      }
      setError('');
    } catch (e: any) {
      setError(mensajeErrorWA(Number(e?.status) || 0, e?.message, idiomaActual() === 'en' ? 'en' : 'es'));
    }
  }, [onNoLeidos, onEstado]);

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
  // «Agrega tu WhatsApp» solo cuando de verdad falta vincularlo: sin red no se sabe, y no se le dice que no lo tiene (A3).
  const detalle =
    vista === 'caido'
      ? tr('sin conexión con tu WhatsApp', 'not connected to your WhatsApp')
      : vista === 'listo'
        ? [numero, estado?.conectado === false ? tr('reconectando…', 'reconnecting…') : ''].filter(Boolean).join(' · ')
        : vista === 'vincular'
          ? tr('Agrega tu WhatsApp personal', 'Add your personal WhatsApp')
          : error
            ? tr('sin conexión', 'offline')
            : '';
  const aviso = error && deGuardado ? `${error} ${tr('Te muestro lo último guardado.', 'Showing what was last saved.')}` : error;

  return (
    <View style={{ flex: 1, backgroundColor: conLista ? w.fondo : p.fondo }}>
      <View style={[s.cabecera, { backgroundColor: w.cabecera, paddingTop: ins.top + MEDIDA.espacio.s, paddingLeft: ins.left + MEDIDA.espacio.s, paddingRight: ins.right + MEDIDA.espacio.s }]}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: w.verde }} />
              <Text style={{ color: w.sobreCabecera2, fontSize: MEDIDA.letra.cuerpo - 1 }} numberOfLines={1}>
                {detalle || tr('Tu WhatsApp personal', 'Your personal WhatsApp')}
              </Text>
            </View>
          </View>
          {conLista && chats !== null && acostado ? (
            <Pressable onPress={() => setNuevo(true)} accessibilityRole="button" accessibilityLabel={tr('Nuevo chat', 'New chat')} hitSlop={8} style={s.botonCab}>
              <IconoWA nombre="nuevoChat" color={w.sobreCabecera} tam={24} />
            </Pressable>
          ) : null}
          {vista === 'listo' ? (
            <Pressable onPress={desvincular} accessibilityRole="button" accessibilityLabel={tr('Desvincular WhatsApp de AU-RA', 'Unlink WhatsApp from AU-RA')} hitSlop={8} style={s.botonCab}>
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
            style={[s.buscadorTxt, fuente('regular'), { color: w.nombre }]}
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
        <View style={[s.banda, { backgroundColor: w.avisoFondo }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={{ color: w.aviso, fontSize: MEDIDA.letra.chica + 1, fontWeight: '600' }}>{aviso}</Text>
        </View>
      ) : null}

      {vista === 'revisando' && error ? (
        // Sin red y sin nada guardado: se dice, con un botón para probar ya (antes, un círculo que giraba sin fin).
        <Aviso p={p} titulo={tr('Sin conexión', 'No connection')} texto={tr('Cuando vuelva el internet aparecen tus chats de WhatsApp. Reintento solo cada pocos segundos.', 'Your WhatsApp chats will show up when the internet is back. I retry on my own every few seconds.')}>
          <Pressable onPress={() => void leer()} accessibilityRole="button" style={[s.botonGrande, { paddingHorizontal: 32, marginTop: 8 }]}>
            <Text style={s.botonGrandeTxt}>{tr('Reintentar ahora', 'Retry now')}</Text>
          </Pressable>
        </Aviso>
      ) : vista === 'revisando' ? (
        <ActivityIndicator color={p.acento} style={{ marginTop: 48 }} />
      ) : vista === 'caido' && !conLista ? (
        <Aviso p={p} titulo={tr('Tu WhatsApp no contesta', 'Your WhatsApp isn’t answering')} texto={tr('Es la conexión del servidor con WhatsApp. Si ya lo tenías vinculado, sigue vinculado: no hace falta vincular otra vez. Reintento solo cada pocos segundos.', 'It’s the server’s connection to WhatsApp. If you had it linked, it’s still linked: no need to link again. I retry on my own every few seconds.')}>
          <Pressable onPress={() => void leer()} accessibilityRole="button" style={[s.botonGrande, { paddingHorizontal: 32, marginTop: 8 }]}>
            <Text style={s.botonGrandeTxt}>{tr('Reintentar ahora', 'Retry now')}</Text>
          </Pressable>
        </Aviso>
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
          initialNumToRender={14}
          contentContainerStyle={{ paddingBottom: ins.bottom + 96, paddingLeft: ins.left, paddingRight: ins.right }}
          ListEmptyComponent={<Text style={{ color: w.previa, textAlign: 'center', marginTop: 32, fontSize: 15 }}>{tr(`Ningún chat con «${q.trim()}»`, `No chats matching “${q.trim()}”`)}</Text>}
          renderItem={({ item }) => <FilaChat c={item} w={w} idioma={idioma} onAbrir={setAbierto} />}
        />
      )}

      {conLista && chats !== null && !abierto && !nuevo && !acostado ? (
        <Pressable
          onPress={() => setNuevo(true)}
          accessibilityRole="button"
          accessibilityLabel={tr('Nuevo chat', 'New chat')}
          style={({ pressed }) => [s.nuevo, { bottom: ins.bottom + MEDIDA.espacio.xl, right: ins.right + MEDIDA.espacio.xl, backgroundColor: p.acento, opacity: pressed ? 0.85 : 1 }]}
        >
          <IconoWA nombre="nuevoChat" tam={26} color={p.sobreAcento} />
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
  // Las mismas medidas de letra que la lista de PULSE2CHAT (MEDIDA.letra): una sola app, no dos.
  nombre: { flex: 1, fontSize: MEDIDA.letra.grande - 1, fontWeight: '600', marginRight: 8 },
  hora: { fontSize: MEDIDA.letra.chica },
  abajo: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  previa: { fontSize: MEDIDA.letra.cuerpo - 1 },
  globo: { minWidth: 21, height: 21, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  globoTxt: { fontSize: MEDIDA.letra.chica, fontWeight: '800' },
});

/* ── vincular ─────────────────────────────────────────────────────────────────────────────── */

/**
 * «Agregar mi WhatsApp» (cada cuenta de AU-RA, el suyo; José, 5-oct). Primero la tarjeta de consentimiento (qué se
 * guarda y dónde, que se borra al desvincular y el riesgo de una conexión no oficial) con «Acepto y vincular». Luego,
 * en el MISMO teléfono, el código de 8 letras: grande, con «Copiar» y los pasos en WhatsApp. El QR queda de segunda
 * opción (para vincular desde otro teléfono o la PC). Si el servidor ya no tiene lugar (CUPO_LLENO), se dice tal cual.
 */
export function Vincular({ p, estado, onCambio }: { p: Paleta; estado: EstadoWA | null; onCambio: () => void }) {
  const s = useMemo(() => estilos(p), [p]);
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [aceptado, setAceptado] = useState(false);
  const [modo, setModo] = useState<'codigo' | 'qr'>('codigo');
  const [tel, setTel] = useState('');
  const [codigo, setCodigo] = useState('');
  const [qr, setQr] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [cupoLleno, setCupoLleno] = useState(false);
  const [copiado, setCopiado] = useState(false);
  // Mientras vincula, el QR se renueva solo (el estado trae el último) y al vincular se cambia de pantalla.
  const qrVivo = estado?.qr || qr;
  const codigoVivo = estado?.codigo || codigo;
  const paso = pasoVincularWA(estado, aceptado);

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
      const r = errorVincularWA(e, idioma);
      setCupoLleno(r.cupoLleno);
      setError(r.texto);
    } finally {
      setOcupado(false);
    }
  };

  const copiar = async () => {
    const c = codigoLegibleWA(codigoVivo);
    try {
      Clipboard.setString(c);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin portapapeles: se comparte (y el código también se puede seleccionar a mano).
      void Share.share({ message: c }).catch(() => {});
    }
  };

  if (paso === 'consentimiento') {
    return (
      <View style={{ padding: MEDIDA.espacio.l, gap: MEDIDA.espacio.m }}>
        <Text style={s.vTitulo} accessibilityRole="header">
          {tr('Agregar mi WhatsApp', 'Add my WhatsApp')}
        </Text>
        <Text style={s.detalle}>
          {tr(
            'AU-RA entra como un «dispositivo vinculado», igual que WhatsApp Web: ves tus chats y contestas desde aquí, y AU-RA te los puede leer y ayudarte a contestar (nada sale sin tu «sí»). Tu teléfono sigue funcionando igual.',
            'AU-RA joins as a “linked device”, like WhatsApp Web: you see your chats and reply from here, and AU-RA can read them to you and help you reply (nothing is sent without your “yes”). Your phone keeps working the same.'
          )}
        </Text>
        <View style={s.tarjeta} accessible accessibilityLabel={textoConsentimientoWA(idioma)}>
          <Text style={{ color: p.texto, fontSize: 15, lineHeight: 22 }}>{textoConsentimientoWA(idioma)}</Text>
        </View>
        <Pressable onPress={() => setAceptado(true)} style={s.botonGrande} accessibilityRole="button" accessibilityLabel={tr('Acepto y vincular', 'I agree, link it')}>
          <Text style={s.botonGrandeTxt}>{tr('Acepto y vincular', 'I agree, link it')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ padding: MEDIDA.espacio.l, gap: MEDIDA.espacio.m }}>
      <Text style={s.vTitulo} accessibilityRole="header">
        {tr('Agregar mi WhatsApp', 'Add my WhatsApp')}
      </Text>
      {modo === 'codigo' ? (
        codigoVivo ? (
          <View style={s.tarjeta}>
            <Text style={s.detalle}>{tr('Escribe este código en WhatsApp:', 'Type this code in WhatsApp:')}</Text>
            <Text style={s.codigo} selectable accessibilityLabel={codigoLegibleWA(codigoVivo).split('').join(' ')}>
              {codigoLegibleWA(codigoVivo)}
            </Text>
            <Pressable onPress={() => void copiar()} style={[s.botonGrande, { height: 44 }]} accessibilityRole="button" accessibilityLabel={tr('Copiar el código', 'Copy the code')}>
              <Text style={s.botonGrandeTxt}>{copiado ? tr('¡Copiado!', 'Copied!') : tr('Copiar el código', 'Copy the code')}</Text>
            </Pressable>
            <Pasos p={p} pasos={pasosCodigoWA(idioma)} />
          </View>
        ) : (
          <View style={{ gap: MEDIDA.espacio.s }}>
            <Text style={s.detalle}>{tr('Tu número de WhatsApp, con el código de país (te doy un código de 8 letras para escribir en WhatsApp, en este mismo teléfono):', 'Your WhatsApp number, with the country code (I’ll give you an 8-letter code to type in WhatsApp, on this same phone):')}</Text>
            <TextInput value={tel} onChangeText={setTel} placeholder="504 9999 9999" placeholderTextColor={p.texto3} keyboardType="phone-pad" style={s.campo} accessibilityLabel={tr('Tu número', 'Your number')} />
          </View>
        )
      ) : qrVivo ? (
        <View style={[s.tarjeta, { alignItems: 'center' }]}>
          <Image source={{ uri: qrVivo }} style={{ width: 240, height: 240, borderRadius: 8, backgroundColor: '#fff' }} accessibilityLabel={tr('Código QR para vincular', 'QR code to link')} />
          <Pasos p={p} pasos={[tr('En el teléfono con tu WhatsApp: ⋮ → Dispositivos vinculados → Vincular un dispositivo.', 'On the phone with your WhatsApp: ⋮ → Linked devices → Link a device.'), tr('Escanea este código (se renueva solo).', 'Scan this code (it refreshes by itself).')]} />
        </View>
      ) : (
        <Text style={s.detalle}>{tr('El QR sirve si vinculas desde otro teléfono o desde la PC: lo escaneas con el teléfono que tiene tu WhatsApp.', 'The QR works if you link from another phone or a PC: scan it with the phone that has your WhatsApp.')}</Text>
      )}
      {!!error && (
        <Text style={{ color: p.aviso, fontSize: 14, lineHeight: 20 }} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      {!cupoLleno && ((modo === 'codigo' && !codigoVivo) || (modo === 'qr' && !qrVivo)) ? (
        <Pressable onPress={() => void pedir()} disabled={ocupado} style={[s.botonGrande, ocupado && { opacity: 0.6 }]} accessibilityRole="button">
          {ocupado ? <ActivityIndicator color={p.sobreAcento} /> : <Text style={s.botonGrandeTxt}>{modo === 'codigo' ? tr('Pedir el código', 'Get the code') : tr('Mostrar el QR', 'Show the QR')}</Text>}
        </Pressable>
      ) : null}
      {!cupoLleno ? (
        <Pressable
          onPress={() => {
            setError('');
            setModo(modo === 'codigo' ? 'qr' : 'codigo');
          }}
          accessibilityRole="button"
          hitSlop={8}
          style={{ alignSelf: 'center', paddingVertical: 6 }}
        >
          <Text style={{ color: p.acentoTexto, fontWeight: '700', fontSize: 14 }}>{modo === 'codigo' ? tr('Mejor con QR (desde otro teléfono o la PC)', 'Use a QR instead (from another phone or a PC)') : tr('Volver al código (en este teléfono)', 'Back to the code (on this phone)')}</Text>
        </Pressable>
      ) : null}
      <Text style={[s.detalle, { fontSize: 12, color: p.texto3 }]}>
        {tr('Es tu WhatsApp personal y solo tu cuenta de AU-RA lo ve. Puedes desvincularlo cuando quieras, desde Ajustes, desde aquí o desde el teléfono: se borra todo.', 'It’s your personal WhatsApp and only your AU-RA account sees it. Unlink it anytime, from Settings, from here or from your phone: everything is erased.')}
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
      <Icono nombre="burbujas" tam={44} color={p.acentoTexto} grosor={1.6} />
      <Text style={{ color: p.texto, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{titulo}</Text>
      <Text style={{ color: p.texto2, fontSize: 15, lineHeight: 21, textAlign: 'center' }}>{texto}</Text>
      {children}
    </View>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    // La misma cabecera que PULSE2CHAT (pulse/PantallaChats.tsx): título grande, subtítulo y las pestañas debajo.
    cabecera: { paddingHorizontal: MEDIDA.espacio.s, paddingBottom: MEDIDA.espacio.m },
    botonCab: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    titulo: { fontSize: MEDIDA.letra.enorme - 4, fontWeight: '800', letterSpacing: -0.5 },
    detalle: { color: p.texto2, fontSize: MEDIDA.letra.chica + 1, marginTop: 2 },
    buscador: { flexDirection: 'row', alignItems: 'center', gap: MEDIDA.espacio.s, marginHorizontal: MEDIDA.espacio.l, marginTop: 0, marginBottom: MEDIDA.espacio.s, paddingHorizontal: MEDIDA.espacio.m, height: 42, borderRadius: MEDIDA.radio.m },
    buscadorTxt: { flex: 1, fontSize: MEDIDA.letra.cuerpo, paddingVertical: 0 },
    banda: { paddingVertical: 8, paddingHorizontal: MEDIDA.espacio.l },
    vTitulo: { color: p.texto, fontSize: 22, fontWeight: '800' },
    segmento: { flexDirection: 'row', backgroundColor: p.superficie, borderRadius: 999, padding: 4 },
    segOpcion: { flex: 1, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    segTxt: { color: p.texto, fontWeight: '700', fontSize: 14 },
    tarjeta: { backgroundColor: p.superficie, borderRadius: 18, padding: MEDIDA.espacio.l, gap: 8 },
    codigo: { color: p.texto, fontSize: 34, fontWeight: '900', letterSpacing: 4, textAlign: 'center', marginVertical: 6 },
    campo: { height: 52, borderRadius: MEDIDA.radio.m, borderWidth: 1, borderColor: p.borde, backgroundColor: p.superficie, color: p.texto, fontSize: 18, paddingHorizontal: 14 },
    botonGrande: { height: 52, borderRadius: 26, backgroundColor: p.acento, alignItems: 'center', justifyContent: 'center' },
    botonGrandeTxt: { color: p.sobreAcento, fontWeight: '700', fontSize: 16 },
    // El mismo botón flotante que PULSE2CHAT: redondo, dorado.
    nuevo: { position: 'absolute', width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  });
}
