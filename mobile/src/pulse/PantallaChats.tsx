/**
 * LA LISTA DE CHATS de PULSE2CHAT (5.0): conversaciones, solicitudes, el círculo y buscar gente.
 *
 * Es la MISMA cuenta que la app Orden Global y la web: mismos contactos, mismas conversaciones, el
 * mismo cifrado de punta a punta. Cada fila dice lo que hay que saber de un vistazo: la cara con su
 * anillo si hay mensajes sin leer, el punto salvia si está en línea, lo último que se dijo (o
 * «escribiendo…», o el borrador que dejó AURA), la hora y cuántos sin leer.
 *
 * Desacoplada de la navegación: quien la monta decide qué pasa al abrir un chat (`onAbrir`) y al
 * volver (`onAtras`). Los datos salen de `chats.ts` (un almacén compartido con el hilo y la voz); esta
 * pantalla no pide nada por su cuenta.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { fuente } from '../ui/tipografia';
import { Letra as Text } from '../ui/Letra';
import Animated, { cancelAnimation, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { emitir } from '../nucleo/contrato';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { AuraAlLado, BotonAuraAlLado } from '../avatar3d/DockAura';
import { tr, useIdioma } from '../i18n';
import * as RELEVO from './relevo';
import * as CHATS from './chats';
import { useBorradores } from './borradores';
import { guardarLista, leerListaGuardada } from './listaGuardada';
import { esDeLoGuardado } from './listaSinRed';
import { usePulseSiHay } from './PulseProvider';
import { Avatar } from './ui/Avatar';
import { BotonChat } from './ui/BotonChat';
import { Icono } from './ui/Icono';
import { Tocable } from './ui/Tocable';
import { cuandoLista, recortar, resumen } from './ui/formato';

export type PropsPantallaChats = {
  /** Abrir la conversación con alguien. */
  onAbrir: (correo: string, nombre: string) => void;
  /** Volver (si no se pasa, no hay botón de volver). */
  onAtras?: () => void;
  /** Debajo del título: el cambio PULSE2CHAT ↔ WhatsApp (whatsapp/ChatsConWhatsapp), si lo hay. */
  cambio?: ReactNode;
};

export function PantallaChats({ onAbrir, onAtras, cambio }: PropsPantallaChats) {
  useIdioma();
  const pulse = usePulseSiHay();
  const cuenta = pulse ? pulse.cuenta : RELEVO.quien();
  useEffect(() => {
    emitir('pantalla', { pantalla: 'chats', chatAbierto: null });
  }, []);
  return cuenta ? <Lista yo={cuenta.correo} onAbrir={onAbrir} onAtras={onAtras} cambio={cambio} /> : <SinCuenta onAtras={onAtras} cambio={cambio} />;
}

/* ── sin cuenta del chat en este teléfono ─────────────────────────────────────────────────── */

function SinCuenta({ onAtras, cambio }: { onAtras?: () => void; cambio?: ReactNode }) {
  const p = useTema();
  const pulse = usePulseSiHay();
  const ins = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: p.fondo,
        paddingTop: ins.top,
        paddingBottom: ins.bottom,
      }}
    >
      {onAtras ? (
        <Tocable
          onPress={onAtras}
          etiqueta={tr('Volver', 'Back')}
          caja={{ margin: MEDIDA.espacio.s, alignSelf: 'flex-start' }}
          style={{
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icono nombre="atras" color={p.texto} tam={24} grosor={2} />
        </Tocable>
      ) : null}
      {cambio ? <View style={{ paddingHorizontal: MEDIDA.espacio.l, marginTop: onAtras ? 0 : MEDIDA.espacio.m }}>{cambio}</View> : null}
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: MEDIDA.espacio.xxl,
        }}
      >
        <View
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            backgroundColor: p.acentoFondo,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: MEDIDA.espacio.xl,
          }}
        >
          <Icono nombre="burbujas" tam={44} color={p.acentoTexto} grosor={1.6} />
        </View>
        <Text
          style={{
            color: p.acentoTexto,
            fontSize: MEDIDA.letra.chica,
            fontWeight: '800',
            letterSpacing: 2,
          }}
        >
          PULSE2CHAT
        </Text>
        <Text
          style={{
            color: p.texto,
            fontSize: MEDIDA.letra.titulo,
            fontWeight: '700',
            marginTop: MEDIDA.espacio.s,
          }}
        >
          {tr('Tu chat de Orden Global, aquí', 'Your Orden Global chat, here')}
        </Text>
        <Text
          style={{
            color: p.texto2,
            fontSize: MEDIDA.letra.cuerpo,
            lineHeight: 22,
            marginTop: MEDIDA.espacio.m,
          }}
        >
          {tr(
            'Los mismos contactos y conversaciones que en la app Orden Global, cifrados de punta a punta. Se conecta con tu Genesis ID: tu wallet te pide permiso y vuelves aquí.',
            'The same contacts and conversations as in the Orden Global app, end-to-end encrypted. It connects with your Genesis ID: your wallet asks for permission and you come back here.',
          )}
        </Text>
        {pulse?.error ? (
          <Text
            style={{
              color: p.aviso,
              fontSize: MEDIDA.letra.chica + 1,
              marginTop: MEDIDA.espacio.m,
            }}
          >
            {pulse.error}
          </Text>
        ) : null}
        {pulse ? (
          <BotonChat
            titulo={tr('Conectar con Genesis ID', 'Connect with Genesis ID')}
            icono="escudo"
            onPress={() => void pulse.conectar()}
            cargando={pulse.conectando}
            caja={{ marginTop: MEDIDA.espacio.xl }}
          />
        ) : null}
      </View>
    </View>
  );
}

/* ── la lista ─────────────────────────────────────────────────────────────────────────────── */

type Item =
  | { tipo: 'titulo'; clave: string; texto: string }
  | { tipo: 'solicitud'; clave: string; persona: RELEVO.Persona }
  | { tipo: 'charla'; clave: string; c: RELEVO.Conversacion }
  | { tipo: 'amigo'; clave: string; persona: RELEVO.Persona }
  | { tipo: 'remoto'; clave: string; persona: RELEVO.Persona };

function Lista({ yo, onAbrir, onAtras, cambio }: { yo: string; onAbrir: (correo: string, nombre: string) => void; onAtras?: () => void; cambio?: ReactNode }) {
  const p = useTema();
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const lista = CHATS.useLista();
  // Acostado, el botón flotante tapaba «Aceptar» y las horas (auditoría A8): «Agregar a alguien» va en la cabecera.
  const { width: anchoV, height: altoV } = useWindowDimensions();
  const acostado = anchoV > altoV;
  const escriben = CHATS.useEscribiendo();
  const borradores = useBorradores();
  const [q, setQ] = useState('');
  const [remotos, setRemotos] = useState<RELEVO.Persona[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [hoja, setHoja] = useState(false);
  const [respondiendo, setRespondiendo] = useState<Record<string, boolean>>({});
  const [lazos, setLazos] = useState<Record<string, string>>({});
  /** Lo que se ve es lo último guardado en el teléfono (sin red): las filas sin vista previa y el aviso arriba. */
  const [deGuardado, setDeGuardado] = useState(false);

  // Sin red al abrir: lo de la última vez (pulse/listaGuardada.ts) en vez de «Agrega a alguien» (A3). Lo de
  // verdad, cuando llega, lo reemplaza (CHATS.sembrarLista no pisa una lista traída del relevo).
  useEffect(() => {
    let vivo = true;
    void leerListaGuardada(yo).then((g) => {
      if (vivo && g && CHATS.sembrarLista(g.conversaciones)) setDeGuardado(true);
    });
    return () => {
      vivo = false;
    };
  }, [yo]);
  // Cada lista que trae el relevo se guarda (sin texto) y deja de ser «lo guardado».
  useEffect(() => {
    if (lista.error || !lista.conversaciones || lista.conversaciones.some((c) => esDeLoGuardado(c.ultimo))) return;
    setDeGuardado(false);
    guardarLista(yo, lista.conversaciones);
  }, [lista, yo]);
  // Solo para redibujar las horas relativas («Ayer») al pasar la medianoche con la lista abierta.
  const [, setTic] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTic((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const qn = RELEVO.normalizar(q);
  const coincide = useCallback(
    (x: { nombre: string; correo: string; gid?: string }) =>
      !qn || RELEVO.normalizar(x.nombre).includes(qn) || x.correo.includes(qn) || (x.gid || '').toLowerCase().includes(qn),
    [qn],
  );

  // Gente fuera del círculo, en el relevo: solo con dos letras o más y sin martillar al teclear.
  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) {
      setRemotos(null);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    let vivo = true;
    const t = setTimeout(() => {
      RELEVO.buscar(texto)
        .then((r) => vivo && setRemotos(r))
        .catch(() => vivo && setRemotos([]))
        .finally(() => vivo && setBuscando(false));
    }, 350);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const conv = lista.conversaciones || [];
    const circ = lista.circulo;
    const out: Item[] = [];
    const recibidas = (circ?.recibidas || []).filter(coincide);
    if (recibidas.length) {
      out.push({
        tipo: 'titulo',
        clave: 't-sol',
        texto: tr('Solicitudes', 'Requests'),
      });
      for (const x of recibidas) out.push({ tipo: 'solicitud', clave: 's-' + x.correo, persona: x });
    }
    const charlas = conv.filter(coincide);
    if (charlas.length && (recibidas.length || qn))
      out.push({
        tipo: 'titulo',
        clave: 't-conv',
        texto: tr('Conversaciones', 'Chats'),
      });
    for (const c of charlas) out.push({ tipo: 'charla', clave: 'c-' + c.correo, c });
    const conCharla = new Set(conv.map((c) => c.correo));
    const amigos = (circ?.amigos || []).filter((a) => !conCharla.has(a.correo) && coincide(a));
    if (amigos.length) {
      out.push({
        tipo: 'titulo',
        clave: 't-circ',
        texto: tr('Tu círculo', 'Your circle'),
      });
      for (const a of amigos) out.push({ tipo: 'amigo', clave: 'a-' + a.correo, persona: a });
    }
    if (remotos) {
      const conocidos = new Set([...conCharla, ...(circ?.amigos || []).map((a) => a.correo), ...(circ?.recibidas || []).map((a) => a.correo)]);
      const nuevos = remotos.filter((r) => !conocidos.has(r.correo));
      if (nuevos.length) {
        out.push({
          tipo: 'titulo',
          clave: 't-rem',
          texto: tr('Personas en PULSE2CHAT', 'People on PULSE2CHAT'),
        });
        for (const r of nuevos) out.push({ tipo: 'remoto', clave: 'r-' + r.correo, persona: r });
      }
    }
    return out;
  }, [lista, remotos, coincide, qn]);

  const responder = async (de: string, aceptar: boolean) => {
    setRespondiendo((r) => ({ ...r, [de]: true }));
    await CHATS.responder(de, aceptar);
    setRespondiendo((r) => ({ ...r, [de]: false }));
  };
  const agregar = async (x: RELEVO.Persona) => {
    setLazos((l) => ({ ...l, [x.correo]: 'enviando' }));
    const r = await CHATS.agregar(x.correo);
    setLazos((l) => ({ ...l, [x.correo]: r }));
  };

  const cargando = lista.conversaciones === null;
  const sinRed = lista.error === 'sin-red';
  const vacio = !cargando && !items.length && !qn;

  const render = ({ item }: { item: Item }) => {
    if (item.tipo === 'titulo') return <Text style={s.seccion}>{item.texto}</Text>;
    if (item.tipo === 'solicitud') {
      const x = item.persona;
      return (
        <Animated.View entering={FadeIn.duration(MEDIDA.duracion.normal)} style={s.tarjeta}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar nombre={x.nombre} foto={x.foto} tam={48} anillo />
            <View style={{ flex: 1, marginLeft: MEDIDA.espacio.m }}>
              <Text style={s.nombre} numberOfLines={1}>
                {x.nombre}
              </Text>
              <Text style={s.detalle} numberOfLines={2}>
                {x.nota ? '«' + recortar(x.nota, 120) + '»' : tr('Quiere agregarte a su círculo', 'Wants to add you to their circle')}
              </Text>
            </View>
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              marginTop: MEDIDA.espacio.m,
              gap: MEDIDA.espacio.s,
            }}
          >
            <BotonChat
              chico
              variante="contorno"
              titulo={tr('Rechazar', 'Decline')}
              onPress={() => void responder(x.correo, false)}
              deshabilitado={respondiendo[x.correo]}
            />
            <BotonChat chico titulo={tr('Aceptar', 'Accept')} onPress={() => void responder(x.correo, true)} cargando={respondiendo[x.correo]} />
          </View>
        </Animated.View>
      );
    }
    if (item.tipo === 'charla') {
      const c = item.c;
      const escribe = CHATS.estaEscribiendo(escriben, c.correo);
      const borrador = borradores[c.correo];
      const sinLeer = c.sinLeer > 0;
      return (
        <Tocable onPress={() => onAbrir(c.correo, c.nombre)} hundir={0.985} ripple={p.acentoFondo} etiqueta={c.nombre} style={s.fila}>
          <Avatar nombre={c.nombre} foto={c.foto} anillo={sinLeer} enLinea={c.enLinea} />
          <View style={s.filaCuerpo}>
            <View style={s.filaArriba}>
              <Text style={[s.nombre, { flex: 1 }, sinLeer && { fontWeight: '800' }]} numberOfLines={1}>
                {c.nombre}
              </Text>
              <Text style={[s.hora, sinLeer && { color: p.acentoTexto, fontWeight: '700' }]}>{cuandoLista(c.ultimo?.cuando || 0)}</Text>
            </View>
            <View style={s.filaAbajo}>
              {escribe ? (
                <Text style={[s.detalle, { color: p.acentoTexto, fontStyle: 'italic', flex: 1 }]} numberOfLines={1}>
                  {tr('escribiendo…', 'typing…')}
                </Text>
              ) : borrador?.texto ? (
                <Text style={[s.detalle, { flex: 1 }]} numberOfLines={1}>
                  <Text style={{ color: p.aviso, fontWeight: '700' }}>{tr('Borrador: ', 'Draft: ')}</Text>
                  {recortar(borrador.texto, 80)}
                </Text>
              ) : (
                <Text style={[s.detalle, { flex: 1 }, sinLeer && { color: p.texto }]} numberOfLines={1}>
                  {(!esDeLoGuardado(c.ultimo) && resumen(c.ultimo, yo)) || detalleSinTexto(c.sinLeer, c.ultimo)}
                </Text>
              )}
              {sinLeer ? (
                <View style={s.insignia}>
                  <Text style={s.insigniaTxt}>{c.sinLeer > 99 ? '99+' : c.sinLeer}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </Tocable>
      );
    }
    const x = item.persona;
    const lazo = item.tipo === 'amigo' ? 'amigos' : lazos[x.correo] || x.lazo || 'no';
    return (
      <Tocable
        onPress={lazo === 'amigos' ? () => onAbrir(x.correo, x.nombre) : undefined}
        hundir={0.985}
        ripple={p.acentoFondo}
        etiqueta={x.nombre}
        style={s.fila}
      >
        <Avatar nombre={x.nombre} foto={x.foto} enLinea={x.enLinea} />
        <View style={s.filaCuerpo}>
          <Text style={s.nombre} numberOfLines={1}>
            {x.nombre}
          </Text>
          <Text style={s.detalle} numberOfLines={1}>
            {lazo === 'amigos' ? tr('Toca para escribirle', 'Tap to write') : x.gid || x.correo}
          </Text>
        </View>
        {lazo === 'amigos' ? null : lazo === 'enviada' ? (
          <Text style={[s.detalle, { color: p.texto3 }]}>{tr('Pendiente', 'Pending')}</Text>
        ) : lazo === 'recibida' ? (
          <BotonChat chico titulo={tr('Aceptar', 'Accept')} onPress={() => void responder(x.correo, true)} cargando={respondiendo[x.correo]} />
        ) : lazo === 'no' || lazo === 'enviando' ? (
          <BotonChat chico titulo={tr('Agregar', 'Add')} icono="mas" onPress={() => void agregar(x)} cargando={lazo === 'enviando'} />
        ) : (
          <Text style={[s.detalle, { color: p.aviso }]}>{textoLazo(lazo)}</Text>
        )}
      </Tocable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.fondo }}>
      <View style={[s.cabecera, { paddingTop: ins.top + MEDIDA.espacio.s }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onAtras ? (
            <Tocable onPress={onAtras} etiqueta={tr('Volver', 'Back')} hitSlop={8} style={s.botonCab}>
              <Icono nombre="atras" color={p.texto} tam={24} grosor={2} />
            </Tocable>
          ) : null}
          <View
            style={{
              flex: 1,
              marginLeft: onAtras ? MEDIDA.espacio.xs : MEDIDA.espacio.s,
            }}
          >
            <Text style={s.titulo}>{tr('Chats', 'Chats')}</Text>
            {/* Arriba de las pestañas no va el aviso del cifrado: WhatsApp y Correos no lo tienen (A2). Ese aviso va
                dentro de PULSE2CHAT, debajo del buscador. */}
            <Text style={[s.detalle, { marginTop: 2, color: p.texto3 }]} numberOfLines={1}>
              {tr('Tus conversaciones en un solo lugar', 'All your conversations in one place')}
            </Text>
          </View>
          {acostado ? (
            <Tocable onPress={() => setHoja(true)} etiqueta={tr('Agregar a alguien', 'Add someone')} hitSlop={8} style={s.botonCab}>
              <Icono nombre="personaMas" color={p.texto} tam={22} grosor={2} />
            </Tocable>
          ) : null}
          <BotonAuraAlLado color={p.texto2} colorActivo={p.acentoTexto} />
        </View>
        {cambio ? <View style={{ marginTop: MEDIDA.espacio.m }}>{cambio}</View> : null}
        <View style={s.buscador}>
          <Icono nombre="buscar" tam={18} color={p.texto3} grosor={2} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={tr('Buscar personas y chats', 'Search people and chats')}
            placeholderTextColor={p.texto3}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[s.buscadorTxt, fuente('regular')]}
            accessibilityLabel={tr('Buscar', 'Search')}
          />
          {buscando ? <ActivityIndicator size="small" color={p.acento} /> : null}
          {q && !buscando ? (
            <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel={tr('Borrar la búsqueda', 'Clear search')}>
              <Icono nombre="cerrar" tam={16} color={p.texto3} grosor={2.2} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <AuraAlLado pantalla="chats" chat={null}>
      {sinRed ? (
        <View style={s.banda} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Icono nombre="alerta" tam={15} color={p.aviso} grosor={2} />
          <Text style={[s.bandaTxt, { flex: 1 }]}>
            {deGuardado || (lista.conversaciones?.length ?? 0) > 0
              ? tr('Sin conexión. Te muestro lo último guardado; reintento solo.', 'Offline. Showing what was last saved; retrying on my own.')
              : tr('Sin conexión con el chat. Reintentando…', 'No connection to the chat. Retrying…')}
          </Text>
        </View>
      ) : (
        // El candado solo donde es verdad: PULSE2CHAT (no WhatsApp ni los correos).
        <View style={s.cifrado}>
          <Icono nombre="candado" tam={12} color={p.exito} grosor={2.2} />
          <Text style={[s.detalle, { marginLeft: 6, marginTop: 0, color: p.texto3, fontSize: MEDIDA.letra.chica }]} numberOfLines={1}>
            {tr('PULSE2CHAT va cifrado de punta a punta', 'PULSE2CHAT is end-to-end encrypted')}
          </Text>
        </View>
      )}
      {cargando ? (
        <Esqueleto p={p} />
      ) : vacio && sinRed ? (
        <SinRed p={p} />
      ) : vacio ? (
        <Vacio p={p} onAgregar={() => setHoja(true)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.clave}
          renderItem={render}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: ins.bottom + 96 }}
          ListEmptyComponent={
            qn && !buscando ? (
              <Text
                style={[
                  s.detalle,
                  {
                    textAlign: 'center',
                    marginTop: MEDIDA.espacio.xxl,
                    paddingHorizontal: MEDIDA.espacio.xl,
                  },
                ]}
              >
                {tr('Nadie con ese nombre. Prueba con su correo o su Genesis ID.', 'No one by that name. Try their email or Genesis ID.')}
              </Text>
            ) : null
          }
        />
      )}
      </AuraAlLado>
      {vacio || acostado ? null : (
        <Tocable
          onPress={() => setHoja(true)}
          vibrar
          etiqueta={tr('Agregar a alguien', 'Add someone')}
          caja={[s.flotante, { bottom: ins.bottom + MEDIDA.espacio.xl }]}
          style={s.flotanteBoton}
        >
          <Icono nombre="personaMas" tam={26} color={p.sobreAcento} grosor={2} />
        </Tocable>
      )}
      {hoja ? <HojaAgregar yo={yo} onCerrar={() => setHoja(false)} onAbrir={onAbrir} /> : null}
    </View>
  );
}

/** La segunda línea de una fila sin vista previa: lo nuevo, o (sin red) que la vista previa llega al volver. */
function detalleSinTexto(sinLeer: number, ultimo: RELEVO.Mensaje | null): string {
  if (sinLeer > 1) return tr(`${sinLeer} mensajes nuevos`, `${sinLeer} new messages`);
  if (sinLeer === 1) return tr('Mensaje nuevo', 'New message');
  if (esDeLoGuardado(ultimo)) return tr('Sin conexión: la vista previa llega al volver', 'Offline: preview when back online');
  return tr('Empiecen a hablar', 'Start talking');
}

function textoLazo(l: string): string {
  if (l === 'no-esta') return tr('No está en el chat', 'Not on the chat');
  if (l === 'demasiadas') return tr('Demasiadas solicitudes', 'Too many requests');
  if (l === 'no-se-puede') return tr('No se puede', 'Not possible');
  if (l === 'sin-red') return tr('Sin conexión', 'No connection');
  return '';
}

/* ── cargando y vacío ─────────────────────────────────────────────────────────────────────── */

function Esqueleto({ p }: { p: Paleta }) {
  const brillo = useSharedValue(0.5);
  useEffect(() => {
    brillo.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1);
    return () => cancelAnimation(brillo);
  }, [brillo]);
  const st = useAnimatedStyle(() => ({ opacity: brillo.value }), [brillo]);
  return (
    <Animated.View style={[{ paddingTop: MEDIDA.espacio.s }, st]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: MEDIDA.espacio.l,
            paddingVertical: MEDIDA.espacio.m,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: p.superficie2,
            }}
          />
          <View style={{ flex: 1, marginLeft: MEDIDA.espacio.m }}>
            <View
              style={{
                width: `${45 + ((i * 17) % 30)}%`,
                height: 13,
                borderRadius: 7,
                backgroundColor: p.superficie2,
              }}
            />
            <View
              style={{
                width: `${60 + ((i * 23) % 30)}%`,
                height: 11,
                borderRadius: 6,
                backgroundColor: p.superficie2,
                marginTop: 9,
                opacity: 0.7,
              }}
            />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

/** Sin red y sin nada guardado: se dice tal cual, con «Reintentar» (nunca «Agrega a alguien»: puede tener muchos). */
function SinRed({ p }: { p: Paleta }) {
  const [probando, setProbando] = useState(false);
  return (
    <Animated.View entering={FadeIn.duration(MEDIDA.duracion.lenta)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: MEDIDA.espacio.xxl, paddingBottom: 80 }}>
      <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: p.avisoFondo, alignItems: 'center', justifyContent: 'center' }}>
        <Icono nombre="alerta" tam={44} color={p.aviso} grosor={1.6} />
      </View>
      <Text style={{ color: p.texto, fontSize: MEDIDA.letra.grande + 3, fontWeight: '700', marginTop: MEDIDA.espacio.xl, textAlign: 'center' }}>{tr('Sin conexión', 'No connection')}</Text>
      <Text style={{ color: p.texto2, fontSize: MEDIDA.letra.cuerpo, lineHeight: 22, marginTop: MEDIDA.espacio.s, textAlign: 'center' }}>
        {tr('No pude traer tus conversaciones. Aparecen aquí en cuanto vuelva el internet; reintento solo.', 'I couldn’t bring your chats. They show up here as soon as the internet is back; I retry on my own.')}
      </Text>
      <BotonChat
        titulo={tr('Reintentar ahora', 'Retry now')}
        variante="contorno"
        cargando={probando}
        onPress={() => {
          setProbando(true);
          void CHATS.refrescarLista().finally(() => setProbando(false));
        }}
        caja={{ marginTop: MEDIDA.espacio.xl }}
      />
    </Animated.View>
  );
}

function Vacio({ p, onAgregar }: { p: Paleta; onAgregar: () => void }) {
  return (
    <Animated.View
      entering={FadeIn.duration(MEDIDA.duracion.lenta)}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: MEDIDA.espacio.xxl,
        paddingBottom: 80,
      }}
    >
      <View
        style={{
          width: 132,
          height: 132,
          borderRadius: 66,
          backgroundColor: p.acentoFondo,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 92,
            height: 92,
            borderRadius: 46,
            backgroundColor: p.fondo,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.9,
          }}
        >
          <Icono nombre="burbujas" tam={50} color={p.acentoTexto} grosor={1.5} />
        </View>
      </View>
      <Text
        style={{
          color: p.texto,
          fontSize: MEDIDA.letra.grande + 3,
          fontWeight: '700',
          marginTop: MEDIDA.espacio.xl,
          textAlign: 'center',
        }}
      >
        {tr('Tus conversaciones aparecerán aquí', 'Your chats will show up here')}
      </Text>
      <Text
        style={{
          color: p.texto2,
          fontSize: MEDIDA.letra.cuerpo,
          lineHeight: 22,
          marginTop: MEDIDA.espacio.s,
          textAlign: 'center',
        }}
      >
        {tr(
          'Agrega a alguien con su correo o su Genesis ID. Todo lo que se escriban va cifrado de punta a punta.',
          'Add someone with their email or Genesis ID. Everything you write to each other is end-to-end encrypted.',
        )}
      </Text>
      <BotonChat titulo={tr('Agregar a alguien', 'Add someone')} icono="personaMas" onPress={onAgregar} caja={{ marginTop: MEDIDA.espacio.xl }} />
    </Animated.View>
  );
}

/* ── agregar por correo o código ──────────────────────────────────────────────────────────── */

type Resultado = { estado: string; correo?: string; nombre?: string } | null;

function HojaAgregar({ yo, onCerrar, onAbrir }: { yo: string; onCerrar: () => void; onAbrir: (correo: string, nombre: string) => void }) {
  const p = useTema();
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [res, setRes] = useState<Resultado>(null);
  const subir = useSharedValue(480);
  const velo = useSharedValue(0);
  const cerrando = useRef(false);
  useEffect(() => {
    subir.value = withSpring(0, MEDIDA.resorte.suave);
    velo.value = withTiming(1, { duration: MEDIDA.duracion.normal });
  }, [subir, velo]);
  const hojaSt = useAnimatedStyle(() => ({ transform: [{ translateY: subir.value }] }), [subir]);
  const veloSt = useAnimatedStyle(() => ({ opacity: velo.value }), [velo]);
  const cerrar = () => {
    if (cerrando.current) return;
    cerrando.current = true;
    subir.value = withTiming(480, { duration: MEDIDA.duracion.rapida });
    velo.value = withTiming(0, { duration: MEDIDA.duracion.rapida });
    setTimeout(onCerrar, MEDIDA.duracion.rapida);
  };

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setRes(null);
    try {
      let correo = t.toLowerCase();
      let nombre = '';
      if (!correo.includes('@')) {
        // Un código (Genesis ID): se busca a quién es.
        const r = await RELEVO.buscar(t).catch(() => null);
        if (r === null) return setRes({ estado: 'sin-red' });
        const x = r.find((y) => (y.gid || '').toUpperCase() === t.toUpperCase()) || (r.length === 1 ? r[0] : null);
        if (!x) return setRes({ estado: 'no-esta' });
        correo = x.correo;
        nombre = x.nombre;
      }
      if (correo === yo) return setRes({ estado: 'eres-tu' });
      const estado = await CHATS.agregar(correo);
      setRes({ estado, correo, nombre: nombre || correo.split('@')[0] });
    } finally {
      setEnviando(false);
    }
  };

  const mensaje = !res
    ? ''
    : res.estado === 'enviada'
      ? tr(`Solicitud enviada a ${res.nombre}. Podrán escribirse en cuanto te acepte.`, `Request sent to ${res.nombre}. You can chat once they accept.`)
      : res.estado === 'amigos'
        ? tr(`${res.nombre} ya está en tu círculo.`, `${res.nombre} is already in your circle.`)
        : res.estado === 'no-esta'
          ? tr('No encontramos a nadie con ese correo o código en PULSE2CHAT.', 'We couldn’t find anyone with that email or code on PULSE2CHAT.')
          : res.estado === 'eres-tu'
            ? tr('Ese eres tú.', 'That’s you.')
            : res.estado === 'demasiadas'
              ? tr('Tienes demasiadas solicitudes abiertas. Espera a que te contesten.', 'You have too many open requests. Wait for replies.')
              : res.estado === 'no-se-puede'
                ? tr('No se puede agregar a esa persona.', 'You can’t add that person.')
                : tr('Sin conexión. Vuelve a intentar.', 'No connection. Try again.');
  const bien = res?.estado === 'enviada' || res?.estado === 'amigos';

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: p.velo }, veloSt]}>
        <Pressable style={{ flex: 1 }} onPress={cerrar} accessibilityLabel={tr('Cerrar', 'Close')} />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Animated.View style={[s.hoja, { paddingBottom: ins.bottom + MEDIDA.espacio.xl }, hojaSt]}>
          <View style={s.asa} />
          <Text style={[s.titulo, { fontSize: MEDIDA.letra.grande + 3 }]}>{tr('Agregar a alguien', 'Add someone')}</Text>
          <Text style={[s.detalle, { marginTop: MEDIDA.espacio.xs }]}>
            {tr('Con su correo o su Genesis ID (GEN-…).', 'With their email or Genesis ID (GEN-…).')}
          </Text>
          <TextInput
            value={texto}
            onChangeText={(v) => {
              setTexto(v);
              setRes(null);
            }}
            placeholder={tr('correo@ejemplo.com o GEN-XXXX-XXXX-X', 'email@example.com or GEN-XXXX-XXXX-X')}
            placeholderTextColor={p.texto3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoFocus
            returnKeyType="send"
            onSubmitEditing={() => void enviar()}
            style={[s.campo, fuente('regular')]}
          />
          {mensaje ? (
            <Text
              style={{
                color: bien ? p.exito : p.aviso,
                fontSize: MEDIDA.letra.chica + 1,
                marginTop: MEDIDA.espacio.s,
                lineHeight: 19,
              }}
            >
              {mensaje}
            </Text>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              gap: MEDIDA.espacio.s,
              marginTop: MEDIDA.espacio.l,
            }}
          >
            {res?.estado === 'amigos' && res.correo ? (
              <BotonChat
                titulo={tr('Escribirle', 'Write')}
                icono="burbujas"
                onPress={() => {
                  onCerrar();
                  onAbrir(res.correo as string, res.nombre || '');
                }}
                caja={{ flex: 1 }}
              />
            ) : res?.estado === 'enviada' ? (
              <BotonChat titulo={tr('Listo', 'Done')} icono="palomita" onPress={cerrar} caja={{ flex: 1 }} />
            ) : (
              <BotonChat
                titulo={tr('Enviar solicitud', 'Send request')}
                onPress={() => void enviar()}
                cargando={enviando}
                deshabilitado={!texto.trim()}
                caja={{ flex: 1 }}
              />
            )}
          </View>
          <Text style={[s.detalle, { marginTop: MEDIDA.espacio.l, textAlign: 'center' }]}>
            {tr('Para que te agreguen, comparte tu correo: ', 'To be added, share your email: ')}
            <Text style={{ color: p.texto, fontWeight: '600' }} selectable>
              {yo}
            </Text>
          </Text>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ── estilos (con la paleta vigente) ──────────────────────────────────────────────────────── */

function estilos(p: Paleta) {
  return StyleSheet.create({
    cabecera: {
      paddingHorizontal: MEDIDA.espacio.s,
      paddingBottom: MEDIDA.espacio.m,
      backgroundColor: p.fondo,
    },
    botonCab: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titulo: {
      color: p.texto,
      fontSize: MEDIDA.letra.enorme - 4,
      fontWeight: '800',
      letterSpacing: -0.5,
    },
    buscador: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: MEDIDA.espacio.s,
      marginTop: MEDIDA.espacio.m,
      marginHorizontal: MEDIDA.espacio.s,
      paddingHorizontal: MEDIDA.espacio.m,
      height: 42,
      borderRadius: MEDIDA.radio.m,
      backgroundColor: p.superficie2,
    },
    buscadorTxt: {
      flex: 1,
      color: p.texto,
      fontSize: MEDIDA.letra.cuerpo,
      paddingVertical: 0,
    },
    banda: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: MEDIDA.espacio.s,
      backgroundColor: p.avisoFondo,
      paddingVertical: MEDIDA.espacio.s,
      paddingHorizontal: MEDIDA.espacio.l,
    },
    cifrado: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: MEDIDA.espacio.l,
      paddingTop: MEDIDA.espacio.xs,
      paddingBottom: MEDIDA.espacio.xs,
    },
    bandaTxt: {
      color: p.aviso,
      fontSize: MEDIDA.letra.chica + 1,
      fontWeight: '600',
    },
    seccion: {
      color: p.texto3,
      fontSize: MEDIDA.letra.chica,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      paddingHorizontal: MEDIDA.espacio.l,
      marginTop: MEDIDA.espacio.l,
      marginBottom: MEDIDA.espacio.xs,
    },
    fila: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: MEDIDA.espacio.l,
      paddingVertical: MEDIDA.espacio.m - 2,
    },
    filaCuerpo: {
      flex: 1,
      marginLeft: MEDIDA.espacio.m,
      minHeight: 52,
      justifyContent: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.borde,
      paddingBottom: 2,
    },
    filaArriba: { flexDirection: 'row', alignItems: 'center' },
    filaAbajo: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
    nombre: {
      color: p.texto,
      fontSize: MEDIDA.letra.grande - 1,
      fontWeight: '600',
    },
    hora: {
      color: p.texto3,
      fontSize: MEDIDA.letra.chica,
      marginLeft: MEDIDA.espacio.s,
    },
    detalle: {
      color: p.texto2,
      fontSize: MEDIDA.letra.cuerpo - 1,
      marginTop: 2,
    },
    insignia: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 6,
      backgroundColor: p.acento,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: MEDIDA.espacio.s,
    },
    insigniaTxt: {
      color: p.sobreAcento,
      fontSize: MEDIDA.letra.chica,
      fontWeight: '800',
    },
    tarjeta: {
      marginHorizontal: MEDIDA.espacio.l,
      marginVertical: MEDIDA.espacio.xs,
      padding: MEDIDA.espacio.m,
      borderRadius: MEDIDA.radio.m,
      backgroundColor: p.superficie,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.borde,
    },
    flotante: {
      position: 'absolute',
      right: MEDIDA.espacio.xl,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
      borderRadius: 30,
    },
    flotanteBoton: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: p.acento,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hoja: {
      backgroundColor: p.superficie,
      borderTopLeftRadius: MEDIDA.radio.xl,
      borderTopRightRadius: MEDIDA.radio.xl,
      paddingHorizontal: MEDIDA.espacio.xl,
      paddingTop: MEDIDA.espacio.m,
    },
    asa: {
      alignSelf: 'center',
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: p.borde,
      marginBottom: MEDIDA.espacio.l,
    },
    campo: {
      marginTop: MEDIDA.espacio.l,
      height: 50,
      borderRadius: MEDIDA.radio.m,
      paddingHorizontal: MEDIDA.espacio.l,
      backgroundColor: p.superficie2,
      color: p.texto,
      fontSize: MEDIDA.letra.cuerpo + 1,
      borderWidth: 1,
      borderColor: p.borde,
    },
  });
}
