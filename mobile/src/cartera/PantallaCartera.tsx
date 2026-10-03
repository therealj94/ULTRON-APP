/**
 * VETA WALLET, AL PAR DE PULSE2CHAT, WHATSAPP Y CORREOS (José, 3-oct: «donde está pulse2chat, whatsapp y
 * correo debe salir veta wallet con todas las funciones completas»; y luego: «mejora el diseño… una
 * billetera completa»).
 *
 *   · La tarjeta: tu saldo total en dólares (con el ojo para ocultarlo), tu dirección, «Genesis ID
 *     verificado» si OrdenScan lo dice, y cuándo se leyó. Deslizar hacia abajo actualiza.
 *   · Cuatro acciones: Enviar (a un contacto de PULSE2CHAT: su dirección sale de su ficha y lo firmas en Veta
 *     Wallet), Recibir (tu código QR y tu dirección para compartir), Movimientos y Abrir Veta Wallet.
 *   · Tu portafolio: cuánto pesa cada moneda (barra y porcentajes) y cada activo con su cantidad, su precio
 *     y su valor. Las que están en cero, plegadas.
 *   · Movimientos recientes (OrdenScan): lo que entró y salió, de quién o a quién, cuándo; cada uno abre su
 *     comprobante en OrdenScan.
 *   · Si hay un envío en camino: en qué va (esperando tu firma, visto en la red, comprobante en el chat).
 *
 * AURA nunca mueve tu dinero: lee la red y el explorador (solo lectura) y abre Veta Wallet con el envío ya
 * llenado; allá se firma con tu contraseña. Solo lee mientras la pestaña está a la vista.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import * as RELEVO from '../pulse/relevo';
import { Boton, Icono, Texto, vibrar, type NombreIcono } from '../ui';
import { ConectarCartera } from './CuerpoCartera';
import { abrirPagar, abrirVetaWallet, useVigia } from './estado';
import { cantidad, dinero, fechaCorta, hora } from './formato';
import { cortar, EXPLORADOR_TX, type Saldo } from './logica';
import { distribucion, EXPLORADOR_DIRECCION, type Movimiento } from './movimientos';
import { codigoQR } from './qr';
import { useMiCartera, type EstadoMiCartera } from './useMiCartera';
import type { EstadoVigia } from './vigia';

type Props = {
  onAtras?: () => void;
  /** Las pestañas (PULSE2CHAT | WhatsApp | Correos | Veta Wallet), debajo del título. */
  cambio?: ReactNode;
  /** Esta pestaña es la que se ve. */
  activa: boolean;
};

type Panel = null | 'enviar' | 'recibir';

const CLAVE_OCULTO = 'aura.cartera.ocultarSaldo';
/** La tarjeta: oscura con oro, igual en tema claro y oscuro (como una tarjeta de verdad). */
const TARJETA = { fondo: ['#16130E', '#2B2215', '#5A4520'] as const, texto: '#F6EBD3', texto2: 'rgba(246,235,211,0.72)', oro: '#E6C77A', velo: 'rgba(230,199,122,0.14)' };

/** El color de cada moneda (la barra, el sello y la leyenda). */
const COLORES: Record<string, string> = {
  ORIGEN: '#D6B56C',
  AUKA: '#F0B429',
  AGKA: '#A9B4C2',
  ONDK: '#5B9BD5',
  MNKA: '#7DB86A',
  IBS: '#A57FD8',
  HARV: '#4FB3A5',
  AUBEX: '#E58F4C',
  ASL: '#D9788E',
  LOVE: '#E8649A',
  REST: '#8C9BE0',
  SOL: '#F2C94C',
  AIT: '#4DB6E2',
  AGRO: '#86B049',
  POLITICAL: '#C08BD9',
  OTRAS: '#8A847C',
};
const colorDe = (sim: string) => COLORES[sim] || '#9C8F7A';
const compartirDireccion = (d: string) =>
  void Share.share({ message: tr(`Mi dirección de Veta Wallet (red Orden Global): ${d}`, `My Veta Wallet address (Orden Global network): ${d}`) }).catch(() => undefined);

export function PantallaCartera({ onAtras, cambio, activa }: Props) {
  const p = useTema();
  const ins = useSafeAreaInsets();
  const vigia = useVigia();
  const w = useMiCartera(activa, { historial: true });
  const [panel, setPanel] = useState<Panel>(null);
  const [oculto, setOculto] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const yMovs = useRef(0);

  useEffect(() => {
    void AsyncStorage.getItem(CLAVE_OCULTO)
      .then((v) => setOculto(v === '1'))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!activa) setPanel(null);
  }, [activa]);

  const alternarOculto = () => {
    vibrar('suave');
    setOculto((o) => {
      void AsyncStorage.setItem(CLAVE_OCULTO, o ? '0' : '1').catch(() => undefined);
      return !o;
    });
  };
  const abrir = (x: Panel) => {
    vibrar('suave');
    setPanel((ahora) => (ahora === x ? null : x));
  };

  const direccion = w.mia?.direccion || null;

  return (
    <View style={{ flex: 1, backgroundColor: p.fondo }}>
      <View style={{ paddingTop: ins.top + MEDIDA.espacio.s, paddingLeft: ins.left + MEDIDA.espacio.m, paddingRight: ins.right + MEDIDA.espacio.m, paddingBottom: MEDIDA.espacio.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onAtras ? (
            <Pressable onPress={onAtras} accessibilityRole="button" accessibilityLabel={tr('Volver', 'Back')} hitSlop={8} style={s.botonCab}>
              <Icono nombre="atras" color={p.texto} tam={24} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1, marginLeft: onAtras ? MEDIDA.espacio.xs : MEDIDA.espacio.s, minWidth: 0 }}>
            <Text style={[s.titulo, { color: p.texto }]} accessibilityRole="header">
              Veta Wallet
            </Text>
            <Text style={{ color: p.texto2, fontSize: 13, marginTop: 1 }} numberOfLines={1}>
              {tr('Tu billetera de Orden Global · solo tú firmas', 'Your Orden Global wallet · only you sign')}
            </Text>
          </View>
          {/* Se actualiza deslizando hacia abajo; mientras lee, aquí gira. */}
          {direccion && w.cargando ? (
            <View style={s.botonCab} accessibilityLabel={tr('Actualizando', 'Refreshing')}>
              <ActivityIndicator color={p.acento} />
            </View>
          ) : null}
        </View>
        {cambio ? <View style={{ marginTop: MEDIDA.espacio.m }}>{cambio}</View> : null}
      </View>

      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingLeft: ins.left + MEDIDA.espacio.l, paddingRight: ins.right + MEDIDA.espacio.l, paddingBottom: ins.bottom + MEDIDA.espacio.xxl, gap: MEDIDA.espacio.l }}
        keyboardShouldPersistTaps="handled"
        refreshControl={direccion ? <RefreshControl refreshing={false} onRefresh={w.actualizar} tintColor={p.acento} colors={[p.acento]} /> : undefined}
      >
        {w.mia === undefined ? (
          <View style={[s.tarjeta, { alignItems: 'center', justifyContent: 'center', backgroundColor: TARJETA.fondo[1] }]}>
            <ActivityIndicator color={TARJETA.oro} />
            <Text style={{ color: TARJETA.texto2, marginTop: 10, textAlign: 'center' }}>
              {RELEVO.quien() ? tr('Conectando tu billetera con tu cuenta de PULSE2CHAT…', 'Connecting your wallet from your PULSE2CHAT account…') : tr('Buscando tu billetera…', 'Looking for your wallet…')}
            </Text>
          </View>
        ) : !w.mia ? (
          <View style={[s.panel, { backgroundColor: p.superficie, borderColor: p.borde }]}>
            <ConectarCartera w={w} />
          </View>
        ) : (
          <>
            <TarjetaSaldo
              total={w.cartera?.total ?? null}
              leido={w.cartera?.leido ?? null}
              direccion={w.mia.direccion}
              verificada={!!w.historial?.verificada}
              monedas={(w.cartera?.saldos || []).filter((x) => (x.cantidad ?? 0) > 0).length}
              oculto={oculto}
              onOjo={alternarOculto}
              onRecibir={() => abrir('recibir')}
            />

            {vigia.fase !== 'libre' && vigia.pago ? <EnvioEnCamino v={vigia} /> : null}

            <View style={s.acciones}>
              <Accion icono="flecha" giro={-90} titulo={tr('Enviar', 'Send')} activa={panel === 'enviar'} onPress={() => abrir('enviar')} />
              <Accion icono="flecha" giro={90} titulo={tr('Recibir', 'Receive')} activa={panel === 'recibir'} onPress={() => abrir('recibir')} />
              <Accion
                icono="reloj"
                titulo={tr('Movimientos', 'Activity')}
                onPress={() => {
                  vibrar('suave');
                  scroll.current?.scrollTo({ y: Math.max(0, yMovs.current - 8), animated: true });
                }}
              />
              <Accion icono="enlace" titulo={tr('Abrir app', 'Open app')} onPress={() => void abrirVetaWallet()} />
            </View>

            {panel === 'enviar' ? <Enviar /> : null}
            {panel === 'recibir' ? <Recibir direccion={w.mia.direccion} /> : null}

            {!!w.error && (
              <View style={[s.aviso, { backgroundColor: p.avisoFondo }]}>
                <Texto v="chica" color="aviso" style={{ flex: 1 }}>
                  {w.error}
                </Texto>
                <Boton titulo={tr('Reintentar', 'Retry')} variante="fantasma" tam="chico" onPress={w.actualizar} />
              </View>
            )}

            {w.cartera ? (
              <Portafolio saldos={w.cartera.saldos} total={w.cartera.total} nombres={w.historial?.nombres || {}} oculto={oculto} />
            ) : !w.error ? (
              <ActivityIndicator color={p.acento} />
            ) : null}

            <View onLayout={(e) => (yMovs.current = e.nativeEvent.layout.y)}>
              <Movimientos lista={w.historial?.movimientos ?? null} error={w.errorHistorial} direccion={w.mia.direccion} oculto={oculto} />
            </View>

            <Gestionar w={w} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

/* ── la tarjeta ───────────────────────────────────────────────────────────────────────────── */

function TarjetaSaldo(p: { total: number | null; leido: number | null; direccion: string; verificada: boolean; monedas: number; oculto: boolean; onOjo: () => void; onRecibir: () => void }) {
  return (
    <LinearGradient colors={TARJETA.fondo} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.tarjeta}>
      {/* Los dos círculos de luz: la marca de agua de la tarjeta. */}
      <View pointerEvents="none" style={[s.circulo, { width: 220, height: 220, top: -90, right: -60 }]} />
      <View pointerEvents="none" style={[s.circulo, { width: 140, height: 140, bottom: -70, right: 40 }]} />

      <View style={s.filaCentro}>
        <View style={[s.logo, { borderColor: TARJETA.oro }]}>
          <Icono nombre="wallet" tam={16} color={TARJETA.oro} />
        </View>
        <Text style={s.marca}>VETA WALLET</Text>
        <View style={{ flex: 1 }} />
        <View style={s.red}>
          <View style={[s.punto, { backgroundColor: '#7DD87D' }]} />
          <Text style={s.redTxt}>{tr('Red Orden Global', 'Orden Global network')}</Text>
        </View>
      </View>

      <View style={{ marginTop: 22 }}>
        <View style={s.filaCentro}>
          <Text style={s.etiqueta}>{tr('Saldo total', 'Total balance')}</Text>
          <Pressable onPress={p.onOjo} hitSlop={10} accessibilityRole="button" accessibilityLabel={p.oculto ? tr('Mostrar saldo', 'Show balance') : tr('Ocultar saldo', 'Hide balance')} style={{ marginLeft: 8 }}>
            <Icono nombre="ojo" tam={18} color={p.oculto ? TARJETA.oro : TARJETA.texto2} />
          </Pressable>
        </View>
        {p.total == null ? (
          <ActivityIndicator color={TARJETA.oro} style={{ alignSelf: 'flex-start', marginVertical: 14 }} />
        ) : (
          <Text style={s.total} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={p.oculto ? tr('Saldo oculto', 'Balance hidden') : `${dinero(p.total)} USD`}>
            {p.oculto ? '••••••' : dinero(p.total)}
          </Text>
        )}
        <Text style={s.sub}>
          {p.monedas === 1 ? tr('1 moneda con saldo', '1 coin with balance') : tr(`${p.monedas} monedas con saldo`, `${p.monedas} coins with balance`)}
          {p.leido ? ` · ${tr('al', 'as of')} ${hora(p.leido)}` : ''}
        </Text>
      </View>

      <View style={[s.filaCentro, { marginTop: 18, gap: 8 }]}>
        <Pressable
          onPress={p.onRecibir}
          onLongPress={() => compartirDireccion(p.direccion)}
          style={s.chipDir}
          accessibilityRole="button"
          accessibilityLabel={tr('Tu dirección. Toca para ver tu QR; mantén para compartir.', 'Your address. Tap for your QR; hold to share.')}
        >
          <Text style={s.chipDirTxt} numberOfLines={1}>
            {cortar(p.direccion)}
          </Text>
          <Icono nombre="enlace" tam={14} color={TARJETA.oro} />
        </Pressable>
        {p.verificada ? (
          <View style={s.verificada} accessibilityLabel={tr('Genesis ID verificado', 'Genesis ID verified')}>
            <Icono nombre="check" tam={13} color="#16130E" />
            <Text style={s.verificadaTxt}>Genesis ID</Text>
          </View>
        ) : null}
      </View>
    </LinearGradient>
  );
}

function Accion({ icono, giro = 0, titulo, activa, onPress }: { icono: NombreIcono; giro?: number; titulo: string; activa?: boolean; onPress: () => void }) {
  const p = useTema();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: activa }} accessibilityLabel={titulo} style={({ pressed }) => [s.accion, { opacity: pressed ? 0.75 : 1 }]}>
      <View style={[s.accionCirculo, { backgroundColor: activa ? p.acento : p.acentoFondo, borderColor: activa ? p.acento : p.borde }]}>
        <View style={{ transform: [{ rotate: `${giro}deg` }] }}>
          <Icono nombre={icono} tam={22} color={activa ? p.sobreAcento : p.acentoTexto} />
        </View>
      </View>
      <Text style={[s.accionTxt, { color: activa ? p.acentoTexto : p.texto2 }]} numberOfLines={1}>
        {titulo}
      </Text>
    </Pressable>
  );
}

/* ── portafolio ───────────────────────────────────────────────────────────────────────────── */

function Portafolio({ saldos, total, nombres, oculto }: { saldos: Saldo[]; total: number; nombres: Record<string, string>; oculto: boolean }) {
  const p = useTema();
  const [verCeros, setVerCeros] = useState(false);
  const partes = useMemo(() => distribucion(saldos), [saldos]);
  const conSaldo = saldos.filter((x) => (x.cantidad ?? 0) > 0).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const enCero = saldos.filter((x) => x.cantidad === 0);
  const sinLeer = saldos.filter((x) => x.cantidad == null);
  return (
    <View style={{ gap: MEDIDA.espacio.m }}>
      <Encabezado titulo={tr('Tu portafolio', 'Your portfolio')} />
      {partes.length ? (
        <View style={[s.panel, { backgroundColor: p.superficie, borderColor: p.borde }]}>
          <View style={s.barra}>
            {partes.map((x) => (
              <View key={x.simbolo} style={{ flex: x.parte, backgroundColor: colorDe(x.simbolo) }} />
            ))}
          </View>
          <View style={s.leyenda}>
            {partes.map((x) => (
              <View key={x.simbolo} style={s.leyendaItem}>
                <View style={[s.punto, { backgroundColor: colorDe(x.simbolo) }]} />
                <Text style={{ color: p.texto2, fontSize: 12.5, fontWeight: '700' }}>
                  {x.simbolo === 'OTRAS' ? tr('Otras', 'Others') : x.simbolo} {Math.round(x.parte * 100)}%
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {conSaldo.length ? (
        <View style={[s.lista, { backgroundColor: p.superficie, borderColor: p.borde }]}>
          {conSaldo.map((x, i) => (
            <FilaActivo key={x.simbolo} s={x} nombre={nombres[x.simbolo]} parte={total > 0 && x.usd != null ? x.usd / total : null} oculto={oculto} primera={i === 0} />
          ))}
        </View>
      ) : (
        <Texto v="chica" color="texto2">
          {tr('Todavía no tienes saldo en esta dirección. Toca «Recibir» para ver tu QR.', 'No balance at this address yet. Tap “Receive” to see your QR.')}
        </Texto>
      )}
      {sinLeer.length ? (
        <Texto v="mini" color="aviso">
          {tr(`No pude leer ${sinLeer.map((x) => x.simbolo).join(', ')} ahora (no es un cero: la red no contestó por esas).`, `I couldn’t read ${sinLeer.map((x) => x.simbolo).join(', ')} right now (not a zero: the network didn’t answer for those).`)}
        </Texto>
      ) : null}
      {enCero.length ? (
        <Pressable onPress={() => setVerCeros((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: verCeros }} style={s.plegable}>
          <Texto v="chica" color="texto3" style={{ flex: 1 }}>
            {enCero.length === 1 ? tr('Otra moneda de la red, en cero', 'One other coin, at zero') : tr(`Otras ${enCero.length} monedas de la red, en cero`, `${enCero.length} other coins, at zero`)}
          </Texto>
          <Texto v="chicaFuerte" color="texto3">
            {verCeros ? '−' : '+'}
          </Texto>
        </Pressable>
      ) : null}
      {verCeros ? (
        <View style={[s.lista, { backgroundColor: p.superficie, borderColor: p.borde }]}>
          {enCero.map((x, i) => (
            <FilaActivo key={x.simbolo} s={x} nombre={nombres[x.simbolo]} parte={null} oculto={oculto} primera={i === 0} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Sello({ simbolo, tam = 40 }: { simbolo: string; tam?: number }) {
  const c = colorDe(simbolo);
  return (
    <View style={{ width: tam, height: tam, borderRadius: tam / 2, backgroundColor: `${c}2E`, borderWidth: 1.5, borderColor: c, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c, fontWeight: '900', fontSize: tam * 0.3 }} maxFontSizeMultiplier={1.1}>
        {simbolo.slice(0, 2)}
      </Text>
    </View>
  );
}

function FilaActivo({ s: x, nombre, parte, oculto, primera }: { s: Saldo; nombre?: string; parte: number | null; oculto: boolean; primera: boolean }) {
  const p = useTema();
  return (
    <View style={[s.fila, !primera && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.borde }]}>
      <Sello simbolo={x.simbolo} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: p.texto, fontWeight: '800', fontSize: 15.5 }} numberOfLines={1}>
          {x.simbolo}
          {nombre ? <Text style={{ color: p.texto3, fontWeight: '600', fontSize: 13 }}>{`  ${nombre}`}</Text> : null}
        </Text>
        <Text style={{ color: p.texto3, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
          {x.cantidad == null ? tr('no se pudo leer', 'couldn’t read') : oculto ? '••••' : `${cantidad(x.cantidad)} ${x.simbolo}`}
          {x.precio == null ? ` · ${tr('sin precio', 'no price')}` : ` · ${dinero(x.precio)} ${tr('c/u', 'each')}`}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: p.texto, fontWeight: '800', fontSize: 15 }}>{oculto ? '••••' : dinero(x.usd)}</Text>
        {parte != null ? <Text style={{ color: p.texto3, fontSize: 12, marginTop: 2 }}>{Math.round(parte * 100)}%</Text> : null}
      </View>
    </View>
  );
}

/* ── movimientos ──────────────────────────────────────────────────────────────────────────── */

function Movimientos({ lista, error, direccion, oculto }: { lista: Movimiento[] | null; error: string; direccion: string; oculto: boolean }) {
  const p = useTema();
  const [todos, setTodos] = useState(false);
  const verTodo = () => void Linking.openURL(`${EXPLORADOR_DIRECCION}${direccion}`).catch(() => undefined);
  const mostrar = (lista || []).slice(0, todos ? 30 : 6);
  return (
    <View style={{ gap: MEDIDA.espacio.m }}>
      <Encabezado titulo={tr('Movimientos recientes', 'Recent activity')} accion={tr('Ver en OrdenScan', 'View on OrdenScan')} onAccion={verTodo} />
      {lista == null ? (
        error ? (
          <Texto v="chica" color="texto2">
            {error} {tr('Tus saldos siguen siendo los de la red.', 'Your balances still come from the network.')}
          </Texto>
        ) : (
          <ActivityIndicator color={p.acento} />
        )
      ) : !lista.length ? (
        <View style={[s.panel, { backgroundColor: p.superficie, borderColor: p.borde, alignItems: 'center' }]}>
          <Icono nombre="reloj" tam={26} color={p.texto3} />
          <Texto v="chica" color="texto2" style={{ textAlign: 'center' }}>
            {tr('Todavía no hay movimientos en esta dirección.', 'No activity at this address yet.')}
          </Texto>
        </View>
      ) : (
        <View style={[s.lista, { backgroundColor: p.superficie, borderColor: p.borde }]}>
          {mostrar.map((m, i) => (
            <FilaMovimiento key={`${m.hash}:${m.simbolo}`} m={m} oculto={oculto} primera={i === 0} />
          ))}
          {lista.length > 6 ? (
            <Pressable onPress={() => setTodos((t) => !t)} accessibilityRole="button" style={[s.verMas, { borderColor: p.borde }]}>
              <Text style={{ color: p.acentoTexto, fontWeight: '800' }}>
                {todos ? tr('Ver menos', 'Show less') : tr(`Ver más (${Math.min(30, lista.length)})`, `Show more (${Math.min(30, lista.length)})`)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function FilaMovimiento({ m, oculto, primera }: { m: Movimiento; oculto: boolean; primera: boolean }) {
  const p = useTema();
  const entra = m.tipo === 'entrada';
  const propio = m.tipo === 'propio';
  const color = entra ? p.exito : propio ? p.texto2 : p.acentoTexto;
  const titulo = entra ? tr('Recibiste', 'Received') : propio ? tr('A ti mismo', 'To yourself') : tr('Enviaste', 'Sent');
  const quien = entra ? tr(`de ${cortar(m.otra)}`, `from ${cortar(m.otra)}`) : propio ? cortar(m.otra) : tr(`a ${cortar(m.otra)}`, `to ${cortar(m.otra)}`);
  const signo = entra ? '+' : propio ? '' : '−';
  return (
    <Pressable
      onPress={() => void Linking.openURL(`${EXPLORADOR_TX}${m.hash}`).catch(() => undefined)}
      accessibilityRole="link"
      accessibilityLabel={`${titulo} ${oculto ? '' : `${cantidad(m.monto)} ${m.simbolo}`} ${quien}. ${tr('Abre el comprobante en OrdenScan.', 'Opens the receipt on OrdenScan.')}`}
      style={({ pressed }) => [s.fila, !primera && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.borde }, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[s.movIcono, { backgroundColor: entra ? p.exitoFondo : p.acentoFondo }]}>
        <View style={{ transform: [{ rotate: entra ? '90deg' : propio ? '0deg' : '-90deg' }] }}>
          <Icono nombre="flecha" tam={18} color={color} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: p.texto, fontWeight: '800', fontSize: 15 }}>{titulo}</Text>
        <Text style={{ color: p.texto3, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
          {quien}
          {m.fecha ? ` · ${fechaCorta(m.fecha)}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color, fontWeight: '800', fontSize: 15 }}>{oculto ? '••••' : `${signo}${cantidad(m.monto)}`}</Text>
        <Text style={{ color: p.texto3, fontSize: 12, marginTop: 2 }}>{m.simbolo}</Text>
      </View>
    </Pressable>
  );
}

/* ── enviar y recibir ─────────────────────────────────────────────────────────────────────── */

/** Enviar: a un contacto de PULSE2CHAT (la dirección sale de su ficha: nunca se escribe a mano). */
function Enviar() {
  const p = useTema();
  const [q, setQ] = useState('');
  // Se rehace cuando PULSE2CHAT conoce a alguien más (las charlas terminan de cargar, o se agrega un contacto).
  const [contactos, setContactos] = useState(() => RELEVO.contactosConocidos());
  useEffect(() => RELEVO.escucharConocidos(() => setContactos(RELEVO.contactosConocidos())), []);
  const lista = useMemo(() => {
    const n = RELEVO.normalizar(q);
    return (n ? contactos.filter((c) => RELEVO.normalizar(`${c.nombre} ${c.correo}`).includes(n)) : contactos).slice(0, 30);
  }, [q, contactos]);
  return (
    <View style={[s.panel, { backgroundColor: p.superficie, borderColor: p.borde }]}>
      <Texto v="cuerpoFuerte">{tr('¿A quién le envías?', 'Who are you sending to?')}</Texto>
      {contactos.length ? (
        <>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={tr('Buscar un contacto', 'Search a contact')}
            placeholderTextColor={p.texto3}
            autoCorrect={false}
            style={[s.buscar, { color: p.texto, borderColor: p.borde, backgroundColor: p.fondo }]}
            accessibilityLabel={tr('Buscar un contacto', 'Search a contact')}
          />
          {lista.map((c) => (
            <Pressable
              key={c.correo}
              onPress={() => {
                vibrar('suave');
                abrirPagar({ correo: c.correo, nombre: c.nombre });
              }}
              accessibilityRole="button"
              accessibilityLabel={tr(`Enviar dinero a ${c.nombre}`, `Send money to ${c.nombre}`)}
              style={({ pressed }) => [s.contacto, { borderColor: p.borde, opacity: pressed ? 0.75 : 1 }]}
            >
              <View style={[s.inicial, { backgroundColor: p.acentoFondo }]}>
                <Text style={{ color: p.acentoTexto, fontWeight: '800' }}>{(c.nombre || c.correo).slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: p.texto, fontWeight: '700' }} numberOfLines={1}>
                  {c.nombre || c.correo}
                </Text>
                <Text style={{ color: p.texto3, fontSize: 12 }} numberOfLines={1}>
                  {c.correo}
                </Text>
              </View>
              <Icono nombre="adelante" tam={18} color={p.texto3} />
            </Pressable>
          ))}
          {!lista.length ? (
            <Texto v="chica" color="texto2">
              {tr('Nadie con ese nombre en tus contactos.', 'Nobody with that name in your contacts.')}
            </Texto>
          ) : null}
        </>
      ) : (
        <Texto v="chica" color="texto2">
          {tr(
            'Todavía no tienes contactos en PULSE2CHAT. Agrega a la persona en la pestaña PULSE2CHAT y aquí aparece: su dirección sale de su ficha.',
            'You have no PULSE2CHAT contacts yet. Add the person in the PULSE2CHAT tab and they show up here: their address comes from their profile.'
          )}
        </Texto>
      )}
      <Texto v="mini" color="texto3">
        {tr('Eliges moneda y monto, y se abre Veta Wallet con el envío listo: lo firmas tú allá. Cuando se ve en la red, el comprobante llega al chat.', 'You pick coin and amount, and Veta Wallet opens with the payment ready: you sign it there. Once it is on the network, the receipt reaches the chat.')}
      </Texto>
    </View>
  );
}

/** Recibir: tu QR y tu dirección completa (pública, como un número de cuenta) para compartirla. */
function Recibir({ direccion }: { direccion: string }) {
  const p = useTema();
  return (
    <View style={[s.panel, { backgroundColor: p.superficie, borderColor: p.borde, alignItems: 'center' }]}>
      <Texto v="cuerpoFuerte">{tr('Recibe en Veta Wallet', 'Receive in Veta Wallet')}</Texto>
      <Texto v="chica" color="texto2" style={{ textAlign: 'center' }}>
        {tr('Que escaneen este código desde su Veta Wallet, o compárteles tu dirección.', 'Have them scan this code from their Veta Wallet, or share your address.')}
      </Texto>
      <VistaQR texto={direccion} lado={216} />
      <Text selectable style={[s.direccion, { color: p.texto, backgroundColor: p.fondo, borderColor: p.borde }]}>
        {direccion}
      </Text>
      <View style={{ flexDirection: 'row', gap: MEDIDA.espacio.s, alignSelf: 'stretch' }}>
        <Boton titulo={tr('Compartir', 'Share')} icono="enlace" tam="chico" style={{ flex: 1 }} onPress={() => compartirDireccion(direccion)} />
        <Boton titulo={tr('Abrir Veta Wallet', 'Open Veta Wallet')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => void abrirVetaWallet()} />
      </View>
      <Texto v="mini" color="texto3" style={{ textAlign: 'center' }}>
        {tr('Mantén presionada la dirección para copiarla. Solo monedas de la red Orden Global. Es pública: con ella te pueden enviar, nunca sacar.', 'Long-press the address to copy it. Orden Global network coins only. It is public: people can send to it, never take from it.')}
      </Texto>
    </View>
  );
}

/** El QR dibujado con vistas (cartera/qr.ts): fondo blanco y 4 módulos de margen, como pide la norma. */
function VistaQR({ texto, lado }: { texto: string; lado: number }) {
  const m = useMemo(() => codigoQR(texto), [texto]);
  const tramos = useMemo(() => {
    // Cada fila, en tramos oscuros seguidos (menos vistas que un cuadrito por módulo).
    const t: { y: number; x: number; largo: number }[] = [];
    if (!m) return t;
    for (let y = 0; y < m.length; y++) {
      let x = 0;
      while (x < m.length) {
        if (!m[y][x]) {
          x++;
          continue;
        }
        const ini = x;
        while (x < m.length && m[y][x]) x++;
        t.push({ y, x: ini, largo: x - ini });
      }
    }
    return t;
  }, [m]);
  if (!m) return null;
  const n = m.length;
  const mod = Math.max(2, Math.floor(lado / (n + 8)));
  const borde = mod * 4;
  return (
    <View style={{ backgroundColor: '#FFFFFF', borderRadius: 14, padding: borde }} accessibilityRole="image" accessibilityLabel={tr('Código QR de tu dirección', 'QR code of your address')}>
      <View style={{ width: mod * n, height: mod * n }}>
        {tramos.map((t, i) => (
          <View key={i} style={{ position: 'absolute', left: t.x * mod, top: t.y * mod, width: t.largo * mod, height: mod, backgroundColor: '#111111' }} />
        ))}
      </View>
    </View>
  );
}

/* ── piezas ───────────────────────────────────────────────────────────────────────────────── */

function Encabezado({ titulo, accion, onAccion }: { titulo: string; accion?: string; onAccion?: () => void }) {
  const p = useTema();
  return (
    <View style={s.filaCentro}>
      <Text style={{ color: p.texto, fontSize: 17, fontWeight: '800', flex: 1 }} accessibilityRole="header">
        {titulo}
      </Text>
      {accion && onAccion ? (
        <Pressable onPress={onAccion} hitSlop={8} accessibilityRole="link">
          <Text style={{ color: p.acentoTexto, fontWeight: '700', fontSize: 13.5 }}>{accion}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Cambiar la dirección, desconectar y cómo funciona (plegado: casi nunca se toca). */
function Gestionar({ w }: { w: EstadoMiCartera }) {
  const p = useTema();
  const [abierto, setAbierto] = useState(false);
  const [editar, setEditar] = useState(false);
  const [quitar, setQuitar] = useState(false);
  return (
    <View style={[s.panel, { backgroundColor: p.superficie, borderColor: p.borde }]}>
      <Pressable onPress={() => setAbierto((a) => !a)} accessibilityRole="button" accessibilityState={{ expanded: abierto }} style={s.filaCentro}>
        <Icono nombre="ajustes" tam={18} color={p.texto2} />
        <Text style={{ color: p.texto, fontWeight: '700', flex: 1, marginLeft: 10 }}>{tr('Ajustes y cómo funciona', 'Settings and how it works')}</Text>
        <Text style={{ color: p.texto3, fontWeight: '800' }}>{abierto ? '−' : '+'}</Text>
      </Pressable>
      {abierto ? (
        editar ? (
          <ConectarCartera w={w} onListo={() => setEditar(false)} onVolver={() => setEditar(false)} />
        ) : (
          <View style={{ gap: MEDIDA.espacio.s }}>
            <Texto v="mini" color="texto3">
              {tr(
                'AURA solo VE tu billetera: los saldos salen de la red de Orden Global y los movimientos de OrdenScan. Para enviar, se abre Veta Wallet con el envío listo y lo firmas tú con tu contraseña. Cada envío lleva la comisión de Veta Wallet: 0,01 USD en ORIGEN. Precio de ORIGEN = 1 gramo de oro ÷ 55; AUKA sigue la onza de oro y AGKA la de plata.',
                'AURA only SEES your wallet: balances come from the Orden Global network and activity from OrdenScan. To send, Veta Wallet opens with the payment ready and you sign it with your password. Each payment carries the Veta Wallet fee: 0.01 USD in ORIGEN. ORIGEN price = 1 gram of gold ÷ 55; AUKA follows the gold ounce and AGKA the silver ounce.'
              )}
            </Texto>
            {w.mia?.fuente === 'chat' ? (
              <Texto v="mini" color="texto3">
                {tr('Tu dirección sale de tu cuenta de PULSE2CHAT.', 'Your address comes from your PULSE2CHAT account.')}
              </Texto>
            ) : null}
            {quitar ? (
              <>
                <Texto v="chica" color="texto2">
                  {tr('¿Desconectar tu billetera? AURA deja de ver tus saldos (tu dinero no se toca).', 'Disconnect your wallet? AURA stops seeing your balances (your money isn’t touched).')}
                </Texto>
                <View style={{ flexDirection: 'row', gap: MEDIDA.espacio.s }}>
                  <Boton titulo={tr('Sí, desconectar', 'Yes, disconnect')} variante="peligro" tam="chico" style={{ flex: 1 }} onPress={() => void w.quitar().then(() => setQuitar(false))} />
                  <Boton titulo={tr('No', 'No')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setQuitar(false)} />
                </View>
              </>
            ) : (
              <View style={{ flexDirection: 'row', gap: MEDIDA.espacio.s }}>
                <Boton titulo={tr('Cambiar dirección', 'Change address')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setEditar(true)} />
                <Boton titulo={tr('Desconectar', 'Disconnect')} variante="fantasma" tam="chico" style={{ flex: 1 }} onPress={() => setQuitar(true)} />
              </View>
            )}
          </View>
        )
      ) : null}
    </View>
  );
}

/** El envío que se está mirando en la red (cartera/vigia.ts): en qué va, en palabras. */
function EnvioEnCamino({ v }: { v: EstadoVigia }) {
  const p = useTema();
  const pago = v.pago!;
  const monto = `${pago.monto} ${pago.moneda}`;
  const textos: Record<string, string> = {
    esperando: tr(`Esperando tu envío de ${monto} a ${pago.nombre}: fírmalo en Veta Wallet.`, `Waiting for your ${monto} payment to ${pago.nombre}: sign it in Veta Wallet.`),
    visto: tr(`Vi tu envío de ${monto} a ${pago.nombre} en la red. Mandando el comprobante al chat…`, `I saw your ${monto} payment to ${pago.nombre} on the network. Sending the receipt to the chat…`),
    publicado: tr(`Enviado: ${monto} a ${pago.nombre}. El comprobante está en su chat.`, `Sent: ${monto} to ${pago.nombre}. The receipt is in their chat.`),
    'sin-comprobante': tr(`Tu envío de ${monto} está en la red, pero no pude dejar el comprobante en el chat.`, `Your ${monto} payment is on the network, but I couldn’t post the receipt in the chat.`),
    vencido: tr(`No vi tu envío de ${monto} a ${pago.nombre} en 15 minutos. Si lo firmaste, revísalo en OrdenScan.`, `I didn’t see your ${monto} payment to ${pago.nombre} in 15 minutes. If you signed it, check OrdenScan.`),
    cancelado: tr(`Dejé de mirar el envío de ${monto} a ${pago.nombre}.`, `I stopped watching the ${monto} payment to ${pago.nombre}.`),
  };
  const hash = v.hash || pago.hash;
  const bien = v.fase === 'publicado';
  const sigue = v.fase === 'esperando' || v.fase === 'visto';
  return (
    <View style={[s.panel, { backgroundColor: bien ? p.exitoFondo : p.superficie, borderColor: bien ? p.exito : p.acento }]} accessibilityLiveRegion="polite">
      <View style={s.filaCentro}>
        {bien ? <Icono nombre="check" tam={18} color={p.exito} /> : sigue ? <ActivityIndicator color={p.acento} /> : <Icono nombre="alerta" tam={18} color={p.aviso} />}
        <Texto v="chicaFuerte" color={bien ? 'exito' : 'acentoTexto'} style={{ marginLeft: 8 }}>
          {bien ? tr('Envío completado', 'Payment completed') : tr('Envío en camino', 'Payment in progress')}
        </Texto>
      </View>
      <Texto v="cuerpo">{textos[v.fase] || ''}</Texto>
      {hash ? <Boton titulo={tr('Ver en OrdenScan', 'View on OrdenScan')} icono="enlace" variante="secundario" tam="chico" onPress={() => void Linking.openURL(`${EXPLORADOR_TX}${hash}`).catch(() => undefined)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  botonCab: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 22, fontWeight: '700' },
  filaCentro: { flexDirection: 'row', alignItems: 'center' },

  tarjeta: { borderRadius: 26, padding: 22, minHeight: 210, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  circulo: { position: 'absolute', borderRadius: 999, backgroundColor: TARJETA.velo },
  logo: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  marca: { color: TARJETA.oro, fontWeight: '900', letterSpacing: 2.4, fontSize: 13 },
  red: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  redTxt: { color: TARJETA.texto2, fontSize: 11.5, fontWeight: '700' },
  punto: { width: 8, height: 8, borderRadius: 4 },
  etiqueta: { color: TARJETA.texto2, fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  total: { color: TARJETA.texto, fontSize: 40, fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },
  sub: { color: TARJETA.texto2, fontSize: 12.5, marginTop: 4 },
  chipDir: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, flexShrink: 1 },
  chipDirTxt: { color: TARJETA.texto, fontSize: 13, fontWeight: '700', letterSpacing: 0.3, flexShrink: 1 },
  verificada: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: TARJETA.oro, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  verificadaTxt: { color: '#16130E', fontSize: 11.5, fontWeight: '900' },

  acciones: { flexDirection: 'row', justifyContent: 'space-between' },
  accion: { flex: 1, alignItems: 'center', gap: 7 },
  accionCirculo: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  accionTxt: { fontSize: 12.5, fontWeight: '800' },

  panel: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.l, gap: MEDIDA.espacio.s },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: MEDIDA.radio.m, paddingLeft: 14, paddingVertical: 6 },
  lista: { borderWidth: 1, borderRadius: MEDIDA.radio.l, paddingHorizontal: MEDIDA.espacio.m, overflow: 'hidden' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  barra: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 },
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plegable: { flexDirection: 'row', alignItems: 'center', paddingVertical: MEDIDA.espacio.xs },
  movIcono: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  verMas: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12, alignItems: 'center' },

  buscar: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  contacto: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  inicial: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  direccion: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, letterSpacing: 0.3, alignSelf: 'stretch', textAlign: 'center' },
});
