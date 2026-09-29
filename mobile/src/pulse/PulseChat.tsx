/**
 * PULSE2CHAT dentro de AU-RA: conversaciones, gente (círculo y búsqueda) y el hilo con alguien.
 *
 * Es la MISMA cuenta que la app Orden Global y la web: mismos contactos, mismas conversaciones, el
 * mismo cifrado de punta a punta. AU-RA es un aparato más de la persona, con su propia llave; lo que
 * llegó antes de que este teléfono la publicara no se puede abrir aquí, y se dice así («cifrado para
 * otro de tus aparatos») en vez de enseñar un renglón vacío.
 *
 * Cada marca dice la verdad del mensaje: 🔒 cifrado, «sin cifrar» si viajó en claro (la otra persona
 * no tenía ningún aparato publicado), «firma sin verificar» si el sobre abrió pero la firma no
 * corresponde a las llaves publicadas de quien escribió.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import * as RELEVO from './relevo';
import * as LLAMADA from './llamada';
import { usePulse } from './PulseProvider';
import { Boton } from '../ui/Boton';
import { T } from '../tema';
import { tr } from '../i18n';

type Vista = { tipo: 'lista' } | { tipo: 'hilo'; con: string; nombre: string };
type Persona = { correo: string; nombre?: string; gid?: string; foto?: string; lazo?: string; enLinea?: boolean; nota?: string };

const nombreDe = (p: { nombre?: string; correo: string }) => p.nombre || p.correo.split('@')[0];

export function PulseChat({ visible, conInicial, onCerrar }: { visible: boolean; conInicial?: string; onCerrar: () => void }) {
  const { cuenta, conectar, conectando, error } = usePulse();
  const [vista, setVista] = useState<Vista>({ tipo: 'lista' });

  useEffect(() => {
    if (visible && conInicial) setVista({ tipo: 'hilo', con: conInicial, nombre: conInicial.split('@')[0] });
    if (!visible) setVista({ tipo: 'lista' });
  }, [visible, conInicial]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (vista.tipo === 'hilo' ? setVista({ tipo: 'lista' }) : onCerrar())}>
      {/* Un modal es otra ventana: lleva su propio proveedor de márgenes seguros. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView style={s.fondo} edges={['top', 'bottom', 'left', 'right']}>
        {!cuenta ? (
          <View style={s.centro}>
            <Text style={s.marca}>PULSE2CHAT</Text>
            <Text style={s.titulo}>{tr('Tu chat de Orden Global, aquí', 'Your Orden Global chat, here')}</Text>
            <Text style={s.parrafo}>
              {tr(
                'Los mismos contactos y conversaciones que en la app Orden Global, cifrados de punta a punta. Se conecta con tu Genesis ID: tu wallet te pide permiso y vuelves aquí.',
                'The same contacts and conversations as in the Orden Global app, end-to-end encrypted. It connects with your Genesis ID: your wallet asks for permission and you come back here.'
              )}
            </Text>
            {!!error && <Text style={s.error}>{error}</Text>}
            <Boton titulo={tr('Conectar con Genesis ID', 'Connect with Genesis ID')} onPress={() => void conectar()} cargando={conectando} style={{ alignSelf: 'stretch', marginTop: 18 }} />
            <Boton titulo={tr('Volver', 'Back')} variante="texto" onPress={onCerrar} />
          </View>
        ) : vista.tipo === 'lista' ? (
          <Lista onCerrar={onCerrar} onAbrir={(p) => setVista({ tipo: 'hilo', con: p.correo, nombre: nombreDe(p) })} />
        ) : (
          <Hilo con={vista.con} nombre={vista.nombre} onVolver={() => setVista({ tipo: 'lista' })} />
        )}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

/* ── la lista: conversaciones y gente ─────────────────────────────────────────────────────── */

function Lista({ onCerrar, onAbrir }: { onCerrar: () => void; onAbrir: (p: Persona) => void }) {
  const { cuenta, salir } = usePulse();
  const [pestana, setPestana] = useState<'hilos' | 'gente'>('hilos');
  const [hilos, setHilos] = useState<any[] | null>(null);
  const [circulo, setCirculo] = useState<{ amigos: Persona[]; recibidas: Persona[]; enviadas: Persona[] } | null>(null);
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<Persona[] | null>(null);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [h, c] = await Promise.all([RELEVO.conversaciones(), RELEVO.circulo()]);
      setHilos(h.filter((x: any) => !x.esGrupo));
      setCirculo({ amigos: (c.amigos || []) as Persona[], recibidas: (c.recibidas || []) as Persona[], enviadas: (c.enviadas || []) as Persona[] });
      setAviso('');
    } catch (e: any) {
      setAviso(e?.code === 401 ? tr('Tu chat se desconectó. Vuelve a conectarlo.', 'Your chat disconnected. Connect it again.') : tr('Sin conexión con el chat.', 'No connection to the chat.'));
      if (e?.code === 401) void salir();
    }
  }, [salir]);

  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 15_000);
    return () => clearInterval(t);
  }, [cargar]);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) {
      setResultados(null);
      return;
    }
    const t = setTimeout(() => {
      RELEVO.buscar(texto)
        .then((r) => setResultados(((r.gente || r.resultados || []) as Persona[]).filter((p) => p.correo !== cuenta?.correo)))
        .catch(() => setResultados([]));
    }, 350);
    return () => clearTimeout(t);
  }, [q, cuenta]);

  const responder = async (de: string, aceptar: boolean) => {
    await RELEVO.responderAmistad(de, aceptar).catch(() => null);
    void cargar();
  };
  const agregar = async (p: Persona) => {
    try {
      await RELEVO.pedirAmistad(p.correo);
      setResultados((r) => (r || []).map((x) => (x.correo === p.correo ? { ...x, lazo: 'enviada' } : x)));
    } catch (e: any) {
      setAviso(e?.message || tr('No se pudo enviar la solicitud.', 'Couldn’t send the request.'));
    }
  };

  const pendientes = circulo?.recibidas.length || 0;
  return (
    <View style={{ flex: 1 }}>
      <View style={s.cabecera}>
        <Pressable onPress={onCerrar} accessibilityRole="button" accessibilityLabel={tr('Cerrar el chat', 'Close chat')} style={s.cabBoton}>
          <Text style={s.cabIcono}>✕</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.marca}>PULSE2CHAT</Text>
          <Text style={s.subCab} numberOfLines={1}>{cuenta?.correo}</Text>
        </View>
      </View>
      <View style={s.pestanas}>
        {(['hilos', 'gente'] as const).map((p) => (
          <Pressable key={p} onPress={() => setPestana(p)} style={[s.pestana, pestana === p && s.pestanaSel]} accessibilityRole="tab" accessibilityState={{ selected: pestana === p }}>
            <Text style={[s.pestanaTxt, pestana === p && s.pestanaTxtSel]}>
              {p === 'hilos' ? tr('Conversaciones', 'Chats') : tr('Gente', 'People')}
              {p === 'gente' && pendientes ? `  •${pendientes}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      {!!aviso && <Text style={s.error}>{aviso}</Text>}

      {pestana === 'hilos' ? (
        hilos === null ? (
          <ActivityIndicator color={T.principal} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={hilos}
            keyExtractor={(h) => h.correo}
            ListEmptyComponent={<Text style={s.vacio}>{tr('Todavía no hay conversaciones. Busca a alguien en «Gente».', 'No chats yet. Find someone in “People”.')}</Text>}
            renderItem={({ item: h }) => (
              <Fila
                persona={h}
                detalle={h.ultimo ? (h.ultimo.cif ? '🔒 ' + tr('Mensaje cifrado', 'Encrypted message') : h.ultimo.tipo === 'imagen' ? '📷 ' + tr('Foto', 'Photo') : String(h.ultimo.texto || '')) : ''}
                cuenta={h.sinLeer}
                onPress={() => onAbrir(h)}
              />
            )}
          />
        )
      ) : (
        <FlatList
          data={resultados ?? circulo?.amigos ?? []}
          keyExtractor={(p) => p.correo}
          ListHeaderComponent={
            <View>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder={tr('Buscar por nombre, correo o Genesis ID', 'Search by name, email or Genesis ID')}
                placeholderTextColor={T.texto3}
                autoCapitalize="none"
                style={s.buscador}
              />
              {!resultados && !!circulo?.recibidas.length && (
                <View>
                  <Text style={s.seccion}>{tr('Te quieren agregar', 'Want to add you')}</Text>
                  {circulo.recibidas.map((p) => (
                    <View key={p.correo} style={s.fila}>
                      <Inicial persona={p} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.filaNombre}>{nombreDe(p)}</Text>
                        {!!p.nota && <Text style={s.filaDetalle} numberOfLines={2}>{p.nota}</Text>}
                      </View>
                      <Pressable onPress={() => void responder(p.correo, true)} style={[s.chip, { backgroundColor: T.activo }]}>
                        <Text style={s.chipTxt}>{tr('Aceptar', 'Accept')}</Text>
                      </Pressable>
                      <Pressable onPress={() => void responder(p.correo, false)} style={s.chip}>
                        <Text style={[s.chipTxt, { color: T.texto2 }]}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              <Text style={s.seccion}>{resultados ? tr('Resultados', 'Results') : tr('Tu círculo', 'Your circle')}</Text>
            </View>
          }
          ListEmptyComponent={<Text style={s.vacio}>{resultados ? tr('Nadie con ese nombre.', 'No one by that name.') : tr('Todavía no agregaste a nadie.', 'You haven’t added anyone yet.')}</Text>}
          renderItem={({ item: p }) => {
            const lazo = p.lazo || 'amigos';
            return (
              <Fila
                persona={p}
                detalle={p.gid || ''}
                onPress={lazo === 'amigos' ? () => onAbrir(p) : undefined}
                derecha={
                  lazo === 'no' ? (
                    <Pressable onPress={() => void agregar(p)} style={[s.chip, { backgroundColor: T.principal }]}>
                      <Text style={[s.chipTxt, { color: T.sobrePrincipal }]}>{tr('Agregar', 'Add')}</Text>
                    </Pressable>
                  ) : lazo === 'enviada' ? (
                    <Text style={s.filaDetalle}>{tr('Pendiente', 'Pending')}</Text>
                  ) : lazo === 'recibida' ? (
                    <Pressable onPress={() => void responder(p.correo, true)} style={[s.chip, { backgroundColor: T.activo }]}>
                      <Text style={s.chipTxt}>{tr('Aceptar', 'Accept')}</Text>
                    </Pressable>
                  ) : null
                }
              />
            );
          }}
        />
      )}
    </View>
  );
}

function Inicial({ persona }: { persona: Persona }) {
  const foto = persona.foto && /^[0-9a-f]{32}$/.test(persona.foto) ? RELEVO.urlArchivo(persona.foto) : '';
  return foto ? (
    <Image source={{ uri: foto }} style={s.inicial} />
  ) : (
    <View style={s.inicial}>
      <Text style={s.inicialTxt}>{nombreDe(persona)[0]?.toUpperCase() || '?'}</Text>
    </View>
  );
}

function Fila({ persona, detalle, cuenta, onPress, derecha }: { persona: Persona; detalle?: string; cuenta?: number; onPress?: () => void; derecha?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} android_ripple={{ color: 'rgba(214,181,108,0.12)' }} style={s.fila}>
      <View>
        <Inicial persona={persona} />
        {persona.enLinea && <View style={s.enLinea} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.filaNombre} numberOfLines={1}>{nombreDe(persona)}</Text>
        {!!detalle && <Text style={s.filaDetalle} numberOfLines={1}>{detalle}</Text>}
      </View>
      {!!cuenta && (
        <View style={s.contador}>
          <Text style={s.contadorTxt}>{cuenta}</Text>
        </View>
      )}
      {derecha}
    </Pressable>
  );
}

/* ── el hilo con alguien ──────────────────────────────────────────────────────────────────── */

function Hilo({ con, nombre, onVolver }: { con: string; nombre: string; onVolver: () => void }) {
  const { cuenta, escribiendo, llamada } = usePulse();
  const [msgs, setMsgs] = useState<RELEVO.Mensaje[] | null>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [codigo, setCodigo] = useState<string | null>(null);
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    try {
      const b = await RELEVO.bandeja(con);
      if (!vivo.current) return;
      setMsgs(b.mensajes);
    } catch (e: any) {
      if (vivo.current && msgs === null) setMsgs([]);
      if (e?.code === 403) setAviso(tr('Hace falta que te acepte para escribirle.', 'They need to accept you before you can write.'));
    }
  }, [con, msgs]);

  useEffect(() => {
    vivo.current = true;
    void cargar();
    void RELEVO.leido(con);
    const t = setInterval(() => void cargar(), 4000);
    return () => {
      vivo.current = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [con]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setAviso('');
    try {
      const r = await RELEVO.enviar(con, t);
      setTexto('');
      if (!r.e2e) setAviso(tr('Salió sin cifrar: esa persona todavía no abrió el chat en ningún aparato.', 'Sent unencrypted: they haven’t opened the chat on any device yet.'));
      await cargar();
    } catch (e: any) {
      setAviso(
        e?.code === 403
          ? tr('Hace falta que te acepte para escribirle.', 'They need to accept you before you can write.')
          : tr('No se envió. Revisa la conexión y vuelve a intentar.', 'Not sent. Check your connection and try again.')
      );
    } finally {
      setEnviando(false);
    }
  };

  const llamar = async (video: boolean) => {
    try {
      await LLAMADA.llamar(con, video);
    } catch {
      /* la pantalla de llamada ya dice qué pasó */
    }
  };

  const verCodigo = async () => {
    const c = await RELEVO.codigoCon(con).catch(() => null);
    setCodigo(c || tr('Todavía no se puede: a alguno de los dos le falta publicar su llave.', 'Not yet: one of you hasn’t published a key.'));
  };

  const escribe = (escribiendo[con] || 0) > Date.now();
  const invertidos = useMemo(() => (msgs ? [...msgs].reverse() : []), [msgs]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.cabecera}>
        <Pressable onPress={onVolver} accessibilityRole="button" accessibilityLabel={tr('Volver', 'Back')} style={s.cabBoton}>
          <Text style={s.cabIcono}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hiloNombre} numberOfLines={1}>{nombre}</Text>
          <Text style={s.subCab}>{escribe ? tr('escribiendo…', 'typing…') : '🔒 ' + tr('cifrado de punta a punta', 'end-to-end encrypted')}</Text>
        </View>
        <Pressable onPress={() => void verCodigo()} style={s.cabBoton} accessibilityLabel={tr('Código de seguridad', 'Security code')}>
          <Text style={s.cabIcono}>🔐</Text>
        </Pressable>
        <Pressable onPress={() => void llamar(false)} disabled={llamada.estado !== 'libre'} style={s.cabBoton} accessibilityLabel={tr('Llamar', 'Call')}>
          <Text style={s.cabIcono}>📞</Text>
        </Pressable>
        <Pressable onPress={() => void llamar(true)} disabled={llamada.estado !== 'libre'} style={s.cabBoton} accessibilityLabel={tr('Videollamada', 'Video call')}>
          <Text style={s.cabIcono}>🎥</Text>
        </Pressable>
      </View>
      {!!codigo && (
        <Pressable onPress={() => setCodigo(null)} style={s.codigo}>
          <Text style={s.codigoTitulo}>{tr('Código de seguridad', 'Security code')}</Text>
          <Text style={s.codigoTxt}>{codigo}</Text>
          <Text style={s.filaDetalle}>{tr('Si coincide con el del otro teléfono, no hay nadie en medio. Toca para cerrar.', 'If it matches the other phone’s, no one is in between. Tap to close.')}</Text>
        </Pressable>
      )}
      {msgs === null ? (
        <ActivityIndicator color={T.principal} style={{ marginTop: 40, flex: 1 }} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          inverted
          data={invertidos}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={[s.vacio, { transform: [{ scaleY: -1 }] }]}>{tr('Escribe el primer mensaje.', 'Write the first message.')}</Text>}
          renderItem={({ item: m }) => <Burbuja m={m} mio={m.de === cuenta?.correo} />}
        />
      )}
      {!!aviso && <Text style={s.error}>{aviso}</Text>}
      <View style={s.componer}>
        <TextInput
          value={texto}
          onChangeText={(v) => {
            setTexto(v);
            if (v) RELEVO.escribiendo(con);
          }}
          placeholder={tr('Mensaje', 'Message')}
          placeholderTextColor={T.texto3}
          multiline
          style={s.entrada}
        />
        <Pressable onPress={() => void enviar()} disabled={!texto.trim() || enviando} style={[s.enviar, (!texto.trim() || enviando) && { opacity: 0.4 }]} accessibilityLabel={tr('Enviar', 'Send')}>
          {enviando ? <ActivityIndicator color={T.sobrePrincipal} /> : <Text style={s.enviarTxt}>➤</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Burbuja({ m, mio }: { m: RELEVO.Mensaje; mio: boolean }) {
  const [foto, setFoto] = useState<string | null>(null);
  useEffect(() => {
    if (m.tipo === 'imagen' && m.archivo) void RELEVO.archivoAbierto(m.archivo, m.llaveArchivo, m.ivArchivo).then(setFoto);
  }, [m.tipo, m.archivo, m.llaveArchivo, m.ivArchivo]);
  const hora = new Date(Number(m.cuando) || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={[s.burbuja, mio ? s.burbujaMia : s.burbujaSuya]}>
      {m.borrado ? (
        <Text style={s.burbujaMarca}>{tr('Mensaje borrado', 'Message deleted')}</Text>
      ) : m.cerrado ? (
        <Text style={s.burbujaMarca}>🔒 {tr('Cifrado para otro de tus aparatos', 'Encrypted for another of your devices')}</Text>
      ) : (
        <>
          {m.tipo === 'imagen' && (foto ? <Image source={{ uri: foto }} style={s.foto} resizeMode="cover" /> : <Text style={s.burbujaMarca}>📷 {tr('Foto', 'Photo')}</Text>)}
          {!!m.texto && <Text style={[s.burbujaTxt, mio && { color: T.sobrePrincipal }]}>{m.texto}</Text>}
        </>
      )}
      <Text style={[s.burbujaHora, mio && { color: 'rgba(35,37,40,0.7)' }]}>
        {hora}
        {m.e2e === false && !m.borrado ? ' · ' + tr('sin cifrar', 'unencrypted') : ''}
        {m.e2e && m.verificado === false && !m.cerrado ? ' · ⚠ ' + tr('firma sin verificar', 'unverified signature') : ''}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: T.fondo },
  centro: { flex: 1, justifyContent: 'center', padding: 28 },
  marca: { color: T.principalTexto, fontSize: 13, fontWeight: '800', letterSpacing: 2 },
  titulo: { color: T.texto, fontSize: 24, fontWeight: '700', marginTop: 8 },
  parrafo: { color: T.texto2, fontSize: 15, lineHeight: 22, marginTop: 10 },
  error: { color: T.avisoTexto, fontSize: 13, paddingHorizontal: 16, paddingVertical: 6 },
  cabecera: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.borde, gap: 4 },
  cabBoton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cabIcono: { color: T.texto, fontSize: 22 },
  subCab: { color: T.texto3, fontSize: 12, marginTop: 2 },
  hiloNombre: { color: T.texto, fontSize: 18, fontWeight: '700' },
  pestanas: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  pestana: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: T.fondo2 },
  pestanaSel: { backgroundColor: T.principalFondo, borderWidth: 1, borderColor: T.principal },
  pestanaTxt: { color: T.texto2, fontSize: 14, fontWeight: '600' },
  pestanaTxtSel: { color: T.principalTexto },
  vacio: { color: T.texto3, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  buscador: { margin: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: T.fondo2, color: T.texto, fontSize: 15 },
  seccion: { color: T.texto3, fontSize: 12, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 16, marginTop: 10, marginBottom: 4, textTransform: 'uppercase' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  inicial: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.panel, alignItems: 'center', justifyContent: 'center' },
  inicialTxt: { color: T.principalTexto, fontSize: 18, fontWeight: '700' },
  enLinea: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: T.activo, borderWidth: 2, borderColor: T.fondo },
  filaNombre: { color: T.texto, fontSize: 16, fontWeight: '600' },
  filaDetalle: { color: T.texto3, fontSize: 13, marginTop: 2 },
  contador: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: T.principal, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  contadorTxt: { color: T.sobrePrincipal, fontSize: 12, fontWeight: '800' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: T.panel, marginLeft: 6 },
  chipTxt: { color: T.fondo, fontWeight: '700', fontSize: 13 },
  codigo: { margin: 12, padding: 14, borderRadius: 14, backgroundColor: T.panel },
  codigoTitulo: { color: T.principalTexto, fontWeight: '700', marginBottom: 6 },
  codigoTxt: { color: T.texto, fontSize: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 1, marginBottom: 6 },
  burbuja: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 3 },
  burbujaMia: { alignSelf: 'flex-end', backgroundColor: T.principal, borderBottomRightRadius: 4 },
  burbujaSuya: { alignSelf: 'flex-start', backgroundColor: T.panel, borderBottomLeftRadius: 4 },
  burbujaTxt: { color: T.texto, fontSize: 15, lineHeight: 21 },
  burbujaMarca: { color: T.texto2, fontSize: 13, fontStyle: 'italic' },
  burbujaHora: { color: T.texto3, fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
  foto: { width: 220, height: 220, borderRadius: 12, marginBottom: 4 },
  componer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.borde },
  entrada: { flex: 1, maxHeight: 120, minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: T.fondo2, color: T.texto, fontSize: 15 },
  enviar: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.principal, alignItems: 'center', justifyContent: 'center' },
  enviarTxt: { color: T.sobrePrincipal, fontSize: 18, fontWeight: '800' },
});
