/**
 * VETA WALLET, AL PAR DE PULSE2CHAT, WHATSAPP Y CORREOS (José, 3-oct: «donde está pulse2chat, whatsapp y
 * correo debe salir veta wallet con todas las funciones completas»).
 *
 *   · Arriba, si hay un envío en camino: en qué va (esperando tu firma, visto en la red, comprobante en el
 *     chat) y «Ver en OrdenScan».
 *   · Tres acciones grandes: Enviar (a un contacto de PULSE2CHAT: su dirección sale de su ficha y lo firmas
 *     en Veta Wallet), Recibir (tu dirección completa para compartirla) y Abrir Veta Wallet.
 *   · Debajo, tus saldos (CuerpoCartera: el mismo de la hoja «Cartera»): total, monedas, actualizar,
 *     conectar o cambiar la dirección.
 *
 * AURA nunca mueve tu dinero: lee la red (solo lectura) y abre Veta Wallet con el envío ya llenado; allá
 * se firma con tu contraseña. Solo lee la red mientras la pestaña está a la vista.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import * as RELEVO from '../pulse/relevo';
import { Boton, Icono, Texto, vibrar, type NombreIcono } from '../ui';
import { CuerpoCartera } from './CuerpoCartera';
import { abrirPagar, abrirVetaWallet, useVigia } from './estado';
import { EXPLORADOR_TX } from './logica';
import type { EstadoVigia } from './vigia';

type Props = {
  onAtras?: () => void;
  /** Las pestañas (PULSE2CHAT | WhatsApp | Correos | Veta Wallet), debajo del título. */
  cambio?: ReactNode;
  /** Esta pestaña es la que se ve. */
  activa: boolean;
};

type Panel = null | 'enviar' | 'recibir';

export function PantallaCartera({ onAtras, cambio, activa }: Props) {
  const p = useTema();
  const ins = useSafeAreaInsets();
  const vigia = useVigia();
  const [panel, setPanel] = useState<Panel>(null);
  const [direccion, setDireccion] = useState<string | null>(null);

  const abrir = (x: Panel) => {
    vibrar('suave');
    setPanel((ahora) => (ahora === x ? null : x));
  };

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
              {tr('Tu cartera de Orden Global · solo tú firmas', 'Your Orden Global wallet · only you sign')}
            </Text>
          </View>
        </View>
        {cambio ? <View style={{ marginTop: MEDIDA.espacio.m }}>{cambio}</View> : null}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: ins.left + MEDIDA.espacio.l, paddingBottom: ins.bottom + MEDIDA.espacio.xxl, gap: MEDIDA.espacio.l }} keyboardShouldPersistTaps="handled">
        {vigia.fase !== 'libre' && vigia.pago ? <EnvioEnCamino v={vigia} /> : null}

        <View style={s.acciones}>
          <Accion icono="flecha" titulo={tr('Enviar', 'Send')} activa={panel === 'enviar'} onPress={() => abrir('enviar')} />
          <Accion icono="descargar" titulo={tr('Recibir', 'Receive')} activa={panel === 'recibir'} onPress={() => abrir('recibir')} />
          <Accion icono="enlace" titulo={tr('Abrir app', 'Open app')} onPress={() => void abrirVetaWallet()} />
        </View>

        {panel === 'enviar' ? <Enviar /> : null}
        {panel === 'recibir' ? <Recibir direccion={direccion} /> : null}

        <CuerpoCartera activo={activa} onDireccion={setDireccion} />
      </ScrollView>
    </View>
  );
}

function Accion({ icono, titulo, activa, onPress }: { icono: NombreIcono; titulo: string; activa?: boolean; onPress: () => void }) {
  const p = useTema();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: activa }}
      accessibilityLabel={titulo}
      style={({ pressed }) => [s.accion, { backgroundColor: activa ? p.acento : p.superficie, borderColor: activa ? p.acento : p.borde, opacity: pressed ? 0.8 : 1 }]}
    >
      <Icono nombre={icono} tam={24} color={activa ? p.sobreAcento : p.acento} />
      <Text style={[s.accionTxt, { color: activa ? p.sobreAcento : p.texto }]} numberOfLines={1}>
        {titulo}
      </Text>
    </Pressable>
  );
}

/** Enviar: a un contacto de PULSE2CHAT (la dirección sale de su ficha: nunca se escribe a mano). */
function Enviar() {
  const p = useTema();
  const [q, setQ] = useState('');
  const contactos = useMemo(() => RELEVO.contactosConocidos(), []);
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

/** Recibir: tu dirección completa (pública, como un número de cuenta) para compartirla. */
function Recibir({ direccion }: { direccion: string | null }) {
  const p = useTema();
  return (
    <View style={[s.panel, { backgroundColor: p.superficie, borderColor: p.borde }]}>
      <Texto v="cuerpoFuerte">{tr('Tu dirección para recibir', 'Your address to receive')}</Texto>
      {direccion ? (
        <>
          <Text selectable style={[s.direccion, { color: p.texto, backgroundColor: p.fondo, borderColor: p.borde }]}>
            {direccion}
          </Text>
          <View style={{ flexDirection: 'row', gap: MEDIDA.espacio.s }}>
            <Boton
              titulo={tr('Compartir', 'Share')}
              icono="enlace"
              tam="chico"
              style={{ flex: 1 }}
              onPress={() => void Share.share({ message: tr(`Mi dirección de Veta Wallet (red Orden Global): ${direccion}`, `My Veta Wallet address (Orden Global network): ${direccion}`) }).catch(() => undefined)}
            />
            <Boton titulo={tr('Abrir Veta Wallet', 'Open Veta Wallet')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => void abrirVetaWallet()} />
          </View>
          <Texto v="mini" color="texto3">
            {tr('Mantén presionada la dirección para copiarla. Es pública: con ella te pueden enviar, nunca sacar.', 'Long-press the address to copy it. It is public: people can send to it, never take from it.')}
          </Texto>
        </>
      ) : (
        <Texto v="chica" color="texto2">
          {tr('Conecta tu cartera abajo y aquí sale tu dirección completa.', 'Connect your wallet below and your full address shows here.')}
        </Texto>
      )}
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
  return (
    <View style={[s.panel, { backgroundColor: bien ? p.acentoFondo : p.superficie, borderColor: bien ? p.acento : p.borde }]} accessibilityLiveRegion="polite">
      <Texto v="chicaFuerte" color={bien ? 'acentoTexto' : 'texto2'}>
        {tr('Envío en camino', 'Payment in progress')}
      </Texto>
      <Texto v="cuerpo">{textos[v.fase] || ''}</Texto>
      {hash ? <Boton titulo={tr('Ver en OrdenScan', 'View on OrdenScan')} icono="enlace" variante="secundario" tam="chico" onPress={() => void Linking.openURL(`${EXPLORADOR_TX}${hash}`).catch(() => undefined)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  botonCab: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 22, fontWeight: '700' },
  acciones: { flexDirection: 'row', gap: MEDIDA.espacio.s },
  accion: { flex: 1, minHeight: 78, borderRadius: MEDIDA.radio.l, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6 },
  accionTxt: { fontSize: 14, fontWeight: '800' },
  panel: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.l, gap: MEDIDA.espacio.s },
  buscar: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  contacto: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  inicial: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  direccion: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: undefined, letterSpacing: 0.3 },
});
