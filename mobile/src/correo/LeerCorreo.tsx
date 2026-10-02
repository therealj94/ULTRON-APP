/**
 * UN CORREO ABIERTO, completo y bien presentado: el asunto grande, quién lo manda (con su círculo), a
 * quién y con copia a quién, la fecha entera, el texto (lo citado de abajo se esconde detrás de
 * «Mostrar lo citado»), los adjuntos con su tipo y su tamaño, los demás de la misma conversación, y
 * abajo «Responder» y «Responder a todos».
 *
 * Abrirlo lo deja leído en el buzón (como cualquier programa de correo). «Atrás» lo cierra a él, no la
 * ventana de los chats (whatsapp/atras.ts, el mismo registro que usa WhatsApp).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { tr } from '../i18n';
import { registrarAtras } from '../whatsapp/atras';
import * as API from './api';
import { IconoCorreo } from './IconoCorreo';
import {
  asuntoVisible,
  claseAdjunto,
  colorCorreo,
  fechaCorreo,
  fechaLarga,
  inicialesCorreo,
  mensajeErrorCorreo,
  remitente,
  separarCitas,
  tamanoArchivo,
  type ClaseAdjunto,
  type Idioma,
  type MensajeCorreo,
  type ResumenCorreo,
} from './logica';

type Props = {
  refCorreo: string;
  /** Los de la misma conversación (del más nuevo al más viejo), para saltar entre ellos. */
  hilo: ResumenCorreo[];
  variasCuentas: boolean;
  idioma: Idioma;
  onCerrar: () => void;
  onAbrir: (ref: string) => void;
  onLeido: (ref: string) => void;
  onResponder: (m: MensajeCorreo, modo: 'responder' | 'todos') => void;
};

const COLOR_ADJUNTO: Record<ClaseAdjunto, string> = {
  pdf: '#E5252A',
  imagen: '#7B3FE4',
  hoja: '#1E8E3E',
  documento: '#2F6FDB',
  presentacion: '#E37400',
  comprimido: '#6D6D6D',
  audio: '#C2185B',
  video: '#00897B',
  otro: '#5E6A75',
};

export function LeerCorreo({ refCorreo, hilo, variasCuentas, idioma, onCerrar, onAbrir, onLeido, onResponder }: Props) {
  const p = useTema();
  const s = useMemo(() => estilos(p), [p]);
  const ins = useSafeAreaInsets();
  const [m, setM] = useState<MensajeCorreo | null>(null);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);
  const [verCitado, setVerCitado] = useState(false);
  const [verDetalles, setVerDetalles] = useState(false);

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
    setM(null);
    setError('');
    setVerCitado(false);
    API.abrirCorreo(refCorreo)
      .then((x) => {
        if (!vivo) return;
        setM(x);
        onLeido(refCorreo);
      })
      .catch((e: any) => vivo && setError(mensajeErrorCorreo(Number(e?.status) || 0, e?.message, idioma)));
    return () => {
      vivo = false;
    };
  }, [refCorreo, intento]); // eslint-disable-line react-hooks/exhaustive-deps

  const partes = useMemo(() => separarCitas(m?.texto || ''), [m?.texto]);
  const otros = hilo.filter((x) => x.ref !== refCorreo);
  const nombre = m ? remitente(m, idioma) : '';
  const conTodos = !!m && [...m.paraCorreos, ...m.ccCorreos].filter((x) => x && x.toLowerCase() !== m.cuenta.toLowerCase() && x.toLowerCase() !== (m.responderA || m.deCorreo).toLowerCase()).length > 0;
  const responder = useCallback((modo: 'responder' | 'todos') => m && onResponder(m, modo), [m, onResponder]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: p.fondo }]}>
      <View style={[s.barra, { paddingTop: ins.top + 4, paddingLeft: ins.left + 4, paddingRight: ins.right + 4, borderBottomColor: p.borde }]}>
        <Pressable onPress={onCerrar} accessibilityRole="button" accessibilityLabel={tr('Volver a la bandeja', 'Back to the inbox')} style={s.boton} hitSlop={4}>
          <IconoCorreo nombre="atras" tam={24} color={p.texto} grosor={2.2} />
        </Pressable>
        <Text style={[s.barraTitulo, { color: p.texto2 }]} numberOfLines={1}>
          {m ? m.cuenta : tr('Correo', 'Email')}
        </Text>
        {m ? (
          <>
            <Pressable onPress={() => responder('responder')} accessibilityRole="button" accessibilityLabel={tr('Responder', 'Reply')} style={s.boton} hitSlop={2}>
              <IconoCorreo nombre="responder" tam={23} color={p.texto} />
            </Pressable>
            {conTodos ? (
              <Pressable onPress={() => responder('todos')} accessibilityRole="button" accessibilityLabel={tr('Responder a todos', 'Reply all')} style={s.boton} hitSlop={2}>
                <IconoCorreo nombre="responderTodos" tam={23} color={p.texto} />
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>

      {!m && !error ? (
        <View style={s.centro}>
          <ActivityIndicator color={p.acento} size="large" />
          <Text style={{ color: p.texto3, marginTop: 12, fontSize: 14 }}>{tr('Abriendo el correo…', 'Opening the email…')}</Text>
        </View>
      ) : !m ? (
        <View style={[s.centro, { paddingHorizontal: MEDIDA.espacio.xxl }]}>
          <IconoCorreo nombre="alerta" tam={40} color={p.aviso} />
          <Text style={[s.vacioTitulo, { color: p.texto }]}>{tr('No pude abrir este correo', 'I couldn’t open this email')}</Text>
          <Text style={[s.vacioTexto, { color: p.texto2 }]}>{error}</Text>
          <Pressable onPress={() => setIntento((n) => n + 1)} accessibilityRole="button" style={[s.pildora, { backgroundColor: p.acento }]}>
            <Text style={{ color: p.sobreAcento, fontWeight: '700', fontSize: 15 }}>{tr('Reintentar', 'Try again')}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingBottom: 24, paddingLeft: ins.left, paddingRight: ins.right }} keyboardShouldPersistTaps="handled">
            <View style={s.columna}>
              <Text style={[s.asunto, { color: p.texto }]} selectable accessibilityRole="header">
                {asuntoVisible(m.asunto, idioma)}
              </Text>
              {variasCuentas ? (
                <View style={[s.etiquetaCuenta, { backgroundColor: p.acentoFondo }]}>
                  <Text style={{ color: p.acentoTexto, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                    {tr(`En ${m.cuenta}`, `In ${m.cuenta}`)}
                  </Text>
                </View>
              ) : null}

              <Pressable onPress={() => setVerDetalles((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: verDetalles }} accessibilityLabel={tr(`De ${nombre}. Ver los detalles`, `From ${nombre}. See details`)} style={s.remitente}>
                <View style={[s.circulo, { backgroundColor: colorCorreo(m.deCorreo || nombre) }]}>
                  <Text style={s.iniciales} allowFontScaling={false}>
                    {inicialesCorreo(nombre) || '@'}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[s.nombre, { color: p.texto }]} numberOfLines={1}>
                      {nombre}
                    </Text>
                    <Text style={{ color: p.texto3, fontSize: 13, marginLeft: 8 }}>{fechaCorreo(m.fecha, Date.now(), idioma)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <Text style={{ color: p.texto2, fontSize: 13.5, flexShrink: 1 }} numberOfLines={1}>
                      {verDetalles ? m.deCorreo : tr(`para ${m.para || m.cuenta}`, `to ${m.para || m.cuenta}`)}
                    </Text>
                    <IconoCorreo nombre={verDetalles ? 'arriba' : 'abajo'} tam={16} color={p.texto3} style={{ marginLeft: 4 }} />
                  </View>
                </View>
              </Pressable>

              {verDetalles ? (
                <View style={[s.detalles, { backgroundColor: p.superficie, borderColor: p.borde }]}>
                  <Detalle p={p} etiqueta={tr('De', 'From')} valor={`${nombre}${m.deCorreo ? ` <${m.deCorreo}>` : ''}`} />
                  {m.responderA && m.responderA.toLowerCase() !== m.deCorreo.toLowerCase() ? <Detalle p={p} etiqueta={tr('Responder a', 'Reply to')} valor={m.responderA} /> : null}
                  <Detalle p={p} etiqueta={tr('Para', 'To')} valor={m.para || m.cuenta} />
                  {m.cc ? <Detalle p={p} etiqueta={tr('Copia', 'Cc')} valor={m.cc} /> : null}
                  <Detalle p={p} etiqueta={tr('Fecha', 'Date')} valor={fechaLarga(m.fecha, idioma)} />
                </View>
              ) : null}

              <Text style={[s.cuerpo, { color: p.texto }]} selectable dataDetectorType="all">
                {partes.cuerpo || tr('(Este correo no trae texto.)', '(This email has no text.)')}
              </Text>

              {partes.citado ? (
                <View style={{ marginTop: 14 }}>
                  <Pressable onPress={() => setVerCitado((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: verCitado }} style={[s.botonCitado, { borderColor: p.borde }]}>
                    <Text style={{ color: p.texto2, fontSize: 13, fontWeight: '600' }}>{verCitado ? tr('Ocultar lo citado', 'Hide quoted text') : tr('Mostrar lo citado', 'Show quoted text')}</Text>
                  </Pressable>
                  {verCitado ? (
                    <Text style={[s.citado, { color: p.texto2, borderLeftColor: p.borde }]} selectable>
                      {partes.citado}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {m.adjuntos.length ? (
                <View style={{ marginTop: 22, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <IconoCorreo nombre="clip" tam={18} color={p.texto2} />
                    <Text style={[s.seccion, { color: p.texto2 }]}>{tr(`${m.adjuntos.length} ${m.adjuntos.length === 1 ? 'adjunto' : 'adjuntos'}`, `${m.adjuntos.length} attachment${m.adjuntos.length === 1 ? '' : 's'}`)}</Text>
                  </View>
                  {m.adjuntos.map((a, i) => {
                    const { clase, ext } = claseAdjunto(a);
                    return (
                      <View key={`${a.nombre}-${i}`} style={[s.adjunto, { backgroundColor: p.superficie, borderColor: p.borde }]} accessible accessibilityLabel={`${a.nombre}, ${tamanoArchivo(a.bytes, idioma)}`}>
                        <View style={[s.adjIcono, { backgroundColor: COLOR_ADJUNTO[clase] }]}>
                          <Text style={s.adjExt} allowFontScaling={false} numberOfLines={1}>
                            {ext || '•'}
                          </Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                          <Text style={{ color: p.texto, fontSize: 14.5, fontWeight: '600' }} numberOfLines={2}>
                            {a.nombre}
                          </Text>
                          <Text style={{ color: p.texto3, fontSize: 12.5, marginTop: 2 }}>{tamanoArchivo(a.bytes, idioma)}</Text>
                        </View>
                      </View>
                    );
                  })}
                  <Text style={{ color: p.texto3, fontSize: 12, lineHeight: 17 }}>{tr('Los adjuntos se abren en tu programa de correo (Gmail, Outlook…); aquí ves cuáles trae.', 'Attachments open in your email app (Gmail, Outlook…); here you see what it carries.')}</Text>
                </View>
              ) : null}

              {otros.length ? (
                <View style={{ marginTop: 24 }}>
                  <Text style={[s.seccion, { color: p.texto2, marginBottom: 6 }]}>{tr(`En esta conversación (${hilo.length})`, `In this conversation (${hilo.length})`)}</Text>
                  {otros.map((o) => (
                    <Pressable key={o.ref} onPress={() => onAbrir(o.ref)} accessibilityRole="button" style={({ pressed }) => [s.otro, { borderColor: p.borde }, pressed && { backgroundColor: p.superficie }]}>
                      <Text style={{ color: p.texto, fontSize: 14.5, fontWeight: o.noLeido ? '700' : '500', flex: 1 }} numberOfLines={1}>
                        {remitente(o, idioma)}
                      </Text>
                      <Text style={{ color: p.texto3, fontSize: 12.5 }}>{fechaCorreo(o.fecha, Date.now(), idioma)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          </ScrollView>

          <View style={[s.acciones, { paddingBottom: ins.bottom + 10, paddingLeft: ins.left + 16, paddingRight: ins.right + 16, borderTopColor: p.borde, backgroundColor: p.fondo }]}>
            <Pressable onPress={() => responder('responder')} accessibilityRole="button" style={({ pressed }) => [s.accion, { borderColor: p.borde, opacity: pressed ? 0.75 : 1 }]}>
              <IconoCorreo nombre="responder" tam={20} color={p.texto} />
              <Text style={[s.accionTxt, { color: p.texto }]}>{tr('Responder', 'Reply')}</Text>
            </Pressable>
            {conTodos ? (
              <Pressable onPress={() => responder('todos')} accessibilityRole="button" style={({ pressed }) => [s.accion, { borderColor: p.borde, opacity: pressed ? 0.75 : 1 }]}>
                <IconoCorreo nombre="responderTodos" tam={20} color={p.texto} />
                <Text style={[s.accionTxt, { color: p.texto }]}>{tr('A todos', 'Reply all')}</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

function Detalle({ p, etiqueta, valor }: { p: Paleta; etiqueta: string; valor: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 3 }}>
      <Text style={{ color: p.texto3, fontSize: 13, width: 92 }}>{etiqueta}</Text>
      <Text style={{ color: p.texto, fontSize: 13, flex: 1 }} selectable>
        {valor}
      </Text>
    </View>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    barra: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
    barraTitulo: { flex: 1, fontSize: 14, marginLeft: 4 },
    boton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
    centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
    vacioTitulo: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 10 },
    vacioTexto: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
    pildora: { marginTop: 14, height: 48, borderRadius: 24, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
    /** En horizontal o en tableta, una columna legible al centro. */
    columna: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: MEDIDA.espacio.l, paddingTop: MEDIDA.espacio.l },
    asunto: { fontSize: 22, lineHeight: 29, fontWeight: '700' },
    etiquetaCuenta: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8, maxWidth: '100%' },
    remitente: { flexDirection: 'row', alignItems: 'center', marginTop: 18, minHeight: 48 },
    circulo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    iniciales: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
    nombre: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
    detalles: { marginTop: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
    cuerpo: { fontSize: 16, lineHeight: 24, marginTop: 20 },
    botonCitado: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
    citado: { fontSize: 14, lineHeight: 20, marginTop: 10, paddingLeft: 12, borderLeftWidth: 3 },
    seccion: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
    adjunto: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 10, minHeight: 60 },
    adjIcono: { width: 40, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
    adjExt: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
    otro: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
    acciones: { flexDirection: 'row', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
    accion: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 24, borderWidth: 1 },
    accionTxt: { fontSize: 15, fontWeight: '700' },
  });
}
