/**
 * «ENVIAR DINERO» desde una conversación de PULSE2CHAT (o por voz: «mándale 5 ORIGEN a Ana»).
 *
 *   1. Eliges moneda y cantidad. La dirección de quien recibe sale de SU FICHA en PULSE2CHAT: si no la tiene
 *      a la vista se dice, y no hay dónde escribirla a mano (ahí es donde la gente pierde el dinero).
 *   2. El resumen: a quién, a qué dirección, cuánto y desde qué cartera.
 *   3. «Confirmar y abrir Veta Wallet»: se abre la wallet con el envío ya llenado y ALLÁ se firma con tu
 *      contraseña. AU-RA no mueve dinero ni ve tu contraseña.
 *   4. Al volver, el vigía (cartera/vigia.ts) mira la cadena hasta ver el envío (tope de 15 min, se puede
 *      cancelar) y entonces deja el comprobante en el hilo, que sale como tarjeta de pago verificado.
 *
 * Un pago a la vez: si hay uno en curso, la hoja muestra cómo va ese.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Campo, Chip, Hoja, Icono, Texto, vibrar } from '../ui';
import { direccionDe, miCartera, type MiCartera } from './conexion';
import { abrirCartera, abrirEnvioEnWallet, useVigia, vigia } from './estado';
import { COMISION_USD, cortar, EXPLORADOR_TX, MONEDAS, montoValido, simbolo, type Envio } from './logica';
import { leerSaldos, type Cartera } from './red';
import { TOPE_VIGIA_MS } from './vigia';

type Props = { visible: boolean; onCerrar: () => void; correo: string; nombre: string; monto?: string; moneda?: string; deVoz?: boolean };

/** Las que la wallet publica primero (las demás, con «Más monedas»). */
const PRINCIPALES = ['ORIGEN', 'AUKA', 'AGKA', 'ONDK', 'HARV', 'IBS'];

export function HojaPagar({ visible, onCerrar, correo, nombre, monto: montoInicial, moneda: monedaInicial, deVoz }: Props) {
  const tema = useTema();
  const v = useVigia();
  const [suya, setSuya] = useState<string | null | undefined>(undefined);
  const [mia, setMia] = useState<MiCartera | null | undefined>(undefined);
  const [saldos, setSaldos] = useState<Cartera | null>(null);
  const [moneda, setMoneda] = useState('ORIGEN');
  const [texto, setTexto] = useState('');
  const [masMonedas, setMasMonedas] = useState(false);
  const [paso, setPaso] = useState<'elegir' | 'resumen'>('elegir');
  const [error, setError] = useState('');
  const [abriendo, setAbriendo] = useState(false);
  const [ahora, setAhora] = useState(Date.now());

  // Un pago en curso (o recién terminado) manda: la hoja cuenta cómo va ese.
  const enCurso = v.fase !== 'libre' && v.pago ? v : null;

  useEffect(() => {
    if (!visible) return;
    setPaso('elegir');
    setError('');
    setSuya(undefined);
    setMia(undefined);
    setSaldos(null);
    setMoneda(simbolo(monedaInicial) || 'ORIGEN');
    setTexto(montoValido(montoInicial) || '');
    setMasMonedas(!PRINCIPALES.includes(simbolo(monedaInicial) || 'ORIGEN'));
    let vivo = true;
    void direccionDe(correo).then((d) => vivo && setSuya(d));
    void miCartera().then((c) => {
      if (!vivo) return;
      setMia(c);
      if (c) void leerSaldos(c.direccion).then((x) => vivo && setSaldos(x), () => undefined);
    });
    return () => {
      vivo = false;
    };
  }, [visible, correo, montoInicial, monedaInicial]);

  // El reloj del tope mientras se espera.
  useEffect(() => {
    if (!visible || v.fase !== 'esperando') return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [visible, v.fase]);

  const monto = montoValido(texto);
  const tengo = saldos?.saldos.find((x) => x.simbolo === moneda)?.cantidad ?? null;
  const pasaDelSaldo = monto != null && tengo != null && Number(monto) > tengo;
  const monedas = useMemo(() => (masMonedas ? MONEDAS : PRINCIPALES), [masMonedas]);

  const cerrar = () => {
    // Lo que terminó se suelta al cerrar; lo que sigue mirando la cadena sigue aunque la hoja se cierre.
    if (enCurso && !vigia.ocupado()) vigia.olvidar();
    onCerrar();
  };

  const revisar = () => {
    if (!monto) {
      vibrar('aviso');
      return setError(tr('Escribe una cantidad mayor que cero (por ejemplo 5 o 2.5).', 'Enter an amount above zero (e.g. 5 or 2.5).'));
    }
    setError('');
    setPaso('resumen');
  };

  const confirmar = async () => {
    if (!suya || !mia || !monto) return;
    setAbriendo(true);
    setError('');
    try {
      const p = await vigia.preparar({ correo, nombre, direccion: suya, mia: mia.direccion, monto, moneda });
      const envio: Envio = { direccion: p.direccion, monto: p.monto, simbolo: p.moneda };
      await abrirEnvioEnWallet(envio);
      vibrar('medio');
      vigia.empezar(p);
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No pude abrir Veta Wallet.', 'I couldn’t open Veta Wallet.'));
    } finally {
      setAbriendo(false);
    }
  };

  const verEnOrdenScan = (h?: string) => h && void Linking.openURL(EXPLORADOR_TX + h).catch(() => undefined);

  /* ── el pago en curso ── */
  if (enCurso && enCurso.pago) {
    const p = enCurso.pago;
    const queda = Math.max(0, p.hasta - ahora);
    const min = Math.floor(queda / 60_000);
    const seg = Math.floor((queda % 60_000) / 1000);
    const envio: Envio = { direccion: p.direccion, monto: p.monto, simbolo: p.moneda };
    return (
      <Hoja visible={visible} onCerrar={cerrar} titulo={tr(`Envío a ${p.nombre}`, `Payment to ${p.nombre}`)}>
        <View style={{ gap: MEDIDA.espacio.l }}>
          <Resumen tema={tema} nombre={p.nombre} direccion={p.direccion} monto={p.monto} moneda={p.moneda} />
          {enCurso.fase === 'esperando' ? (
            <>
              <View style={s.fila}>
                <ActivityIndicator color={tema.acento} />
                <Texto v="chica" color="texto2" style={{ flex: 1 }}>
                  {tr(
                    'Firma el envío en Veta Wallet con tu contraseña. Estoy mirando la cadena: en cuanto pase, dejo el comprobante en el chat.',
                    'Sign the payment in Veta Wallet with your password. I’m watching the chain: as soon as it goes through, I’ll post the receipt in the chat.',
                  )}
                </Texto>
              </View>
              <Texto v="mini" color="texto3">
                {tr(`Sigo mirando ${min}:${String(seg).padStart(2, '0')} más. Puedes cerrar esta hoja: sigo aunque no la veas.`, `Watching for ${min}:${String(seg).padStart(2, '0')} more. You can close this sheet: I keep going.`)}
              </Texto>
              <Boton
                titulo={tr('¿No se abrió el envío llenado? Ábrelo en la web', 'Didn’t open filled in? Open it on the web')}
                icono="enlace"
                variante="secundario"
                tam="chico"
                onPress={() => void abrirEnvioEnWallet(envio, { web: true })}
              />
              <Boton titulo={tr('Dejar de esperar', 'Stop waiting')} variante="fantasma" onPress={() => vigia.cancelar()} />
            </>
          ) : enCurso.fase === 'visto' ? (
            <View style={s.fila}>
              <ActivityIndicator color={tema.exito} />
              <Texto v="chica" color="texto2" style={{ flex: 1 }}>
                {tr('Vi tu envío en la cadena. Dejando el comprobante en el chat…', 'I saw your payment on the chain. Posting the receipt in the chat…')}
              </Texto>
            </View>
          ) : enCurso.fase === 'publicado' ? (
            <>
              <View style={[s.aviso, { backgroundColor: tema.exitoFondo }]}>
                <Icono nombre="check" tam={22} color={tema.exito} />
                <Texto v="cuerpoFuerte" style={{ flex: 1 }}>
                  {tr(`Enviaste ${p.monto} ${p.moneda} a ${p.nombre}. El comprobante quedó en su chat.`, `You sent ${p.monto} ${p.moneda} to ${p.nombre}. The receipt is in their chat.`)}
                </Texto>
              </View>
              <Boton titulo={tr('Ver en OrdenScan', 'View on OrdenScan')} icono="enlace" variante="secundario" tam="chico" onPress={() => verEnOrdenScan(enCurso.hash)} />
              <Boton titulo={tr('Listo', 'Done')} icono="check" onPress={cerrar} />
            </>
          ) : enCurso.fase === 'sin-comprobante' ? (
            <>
              <Texto v="chica" color="aviso">
                {tr(
                  `Vi el envío en la cadena (${(enCurso.hash || '').slice(0, 12)}…), pero el chat no aceptó el comprobante. El dinero ya llegó; solo falta la tarjeta en el chat.`,
                  `I saw the payment on the chain (${(enCurso.hash || '').slice(0, 12)}…), but the chat rejected the receipt. The money arrived; only the chat card is missing.`,
                )}
              </Texto>
              <Boton titulo={tr('Reintentar el comprobante', 'Retry the receipt')} icono="flecha" onPress={() => vigia.reintentarPublicar()} />
              <Boton titulo={tr('Ver en OrdenScan', 'View on OrdenScan')} icono="enlace" variante="secundario" tam="chico" onPress={() => verEnOrdenScan(enCurso.hash)} />
              <Boton titulo={tr('Cerrar', 'Close')} variante="fantasma" onPress={cerrar} />
            </>
          ) : enCurso.fase === 'vencido' ? (
            <>
              <Texto v="chica" color="texto2">
                {tr(
                  `No vi el envío en ${Math.round(TOPE_VIGIA_MS / 60_000)} minutos. Si no lo firmaste en Veta Wallet, no se movió nada.`,
                  `I didn’t see the payment in ${Math.round(TOPE_VIGIA_MS / 60_000)} minutes. If you didn’t sign it in Veta Wallet, nothing moved.`,
                )}
              </Texto>
              <Boton titulo={tr('Seguir mirando', 'Keep watching')} icono="flecha" onPress={() => vigia.seguir()} />
              <Boton titulo={tr('Cerrar', 'Close')} variante="fantasma" onPress={cerrar} />
            </>
          ) : (
            <>
              <Texto v="chica" color="texto2">
                {tr(
                  'Dejé de esperar. Si lo firmas igual en Veta Wallet, el dinero se mueve, pero el comprobante no aparecerá solo en el chat.',
                  'I stopped waiting. If you sign it anyway in Veta Wallet, the money moves, but the receipt won’t appear in the chat by itself.',
                )}
              </Texto>
              <Boton titulo={tr('Cerrar', 'Close')} variante="fantasma" onPress={cerrar} />
            </>
          )}
        </View>
      </Hoja>
    );
  }

  /* ── elegir y revisar ── */
  return (
    <Hoja
      visible={visible}
      onCerrar={cerrar}
      titulo={tr(`Enviar dinero a ${nombre}`, `Send money to ${nombre}`)}
      subtitulo={tr('Se firma en Veta Wallet con tu contraseña. AURA no mueve tu dinero.', 'You sign it in Veta Wallet with your password. AURA never moves your money.')}
    >
      {suya === undefined || mia === undefined ? (
        <View style={{ alignItems: 'center', gap: MEDIDA.espacio.s, paddingVertical: MEDIDA.espacio.xl }}>
          <ActivityIndicator color={tema.acento} />
          <Texto v="chica" color="texto2">
            {tr('Buscando su dirección de Veta Wallet…', 'Looking up their Veta Wallet address…')}
          </Texto>
        </View>
      ) : !suya ? (
        <View style={{ gap: MEDIDA.espacio.l }}>
          <View style={[s.aviso, { backgroundColor: tema.avisoFondo }]}>
            <Icono nombre="alerta" tam={20} color={tema.aviso} />
            <Texto v="chica" style={{ flex: 1 }}>
              {tr(
                `${nombre} todavía no tiene su dirección de Veta Wallet a la vista en PULSE2CHAT. Pídele que entre una vez a Veta Wallet con su cuenta. Por seguridad, la dirección no se escribe a mano.`,
                `${nombre} has no Veta Wallet address visible in PULSE2CHAT yet. Ask them to sign in to Veta Wallet once. For safety, the address can’t be typed by hand.`,
              )}
            </Texto>
          </View>
          <Boton titulo={tr('Entendido', 'Got it')} variante="secundario" onPress={cerrar} />
        </View>
      ) : !mia ? (
        <View style={{ gap: MEDIDA.espacio.l }}>
          <Texto v="chica" color="texto2">
            {tr(
              'Primero conecta tu cartera: con tu dirección (pública) reconozco el envío en la cadena y dejo el comprobante en el chat.',
              'Connect your wallet first: with your (public) address I can spot the payment on the chain and post the receipt.',
            )}
          </Texto>
          <Boton titulo={tr('Conectar mi cartera', 'Connect my wallet')} icono="wallet" onPress={() => abrirCartera()} />
        </View>
      ) : paso === 'elegir' ? (
        <View style={{ gap: MEDIDA.espacio.l }}>
          {deVoz ? (
            <Texto v="mini" color="acentoTexto">
              {tr('AURA lo preparó por ti · revísalo y confírmalo', 'AURA prepared this for you · review and confirm')}
            </Texto>
          ) : null}
          <View style={{ gap: MEDIDA.espacio.s }}>
            <Texto v="chicaFuerte" color="texto2">
              {tr('Moneda', 'Coin')}
            </Texto>
            <View style={s.chips}>
              {monedas.map((m) => (
                <Chip key={m} texto={m} tam="chico" activo={moneda === m} onPress={() => setMoneda(m)} />
              ))}
              {!masMonedas ? <Chip texto={tr('Más monedas', 'More coins')} tam="chico" onPress={() => setMasMonedas(true)} /> : null}
            </View>
          </View>
          <Campo
            etiqueta={tr('Cantidad', 'Amount')}
            value={texto}
            onChangeText={(t) => {
              setTexto(t.slice(0, 40));
              setError('');
            }}
            placeholder="0.00"
            keyboardType="decimal-pad"
            grande
            error={error || undefined}
            ayuda={
              tengo != null
                ? tr(`Tienes ${tengo.toLocaleString()} ${moneda}.`, `You have ${tengo.toLocaleString()} ${moneda}.`) +
                  (pasaDelSaldo ? tr(' Es más de lo que tienes: Veta Wallet no lo dejará pasar.', ' That’s more than you have: Veta Wallet won’t let it through.') : '')
                : undefined
            }
          />
          <Texto v="mini" color="texto3">
            {tr(`A su Veta Wallet ${cortar(suya)} (de su ficha en PULSE2CHAT).`, `To their Veta Wallet ${cortar(suya)} (from their PULSE2CHAT profile).`)}
          </Texto>
          <Boton titulo={tr('Revisar envío', 'Review payment')} icono="adelante" deshabilitado={!texto.trim()} onPress={revisar} />
        </View>
      ) : (
        <View style={{ gap: MEDIDA.espacio.l }}>
          <Resumen tema={tema} nombre={nombre} direccion={suya} monto={monto || ''} moneda={moneda} desde={mia.direccion} />
          <Texto v="chica" color="texto2">
            {tr(
              'AURA no mueve tu dinero: abre Veta Wallet con el envío ya llenado y tú lo confirmas allá con tu contraseña. Cuando la cadena lo confirme, dejo el comprobante en este chat.',
              'AURA never moves your money: it opens Veta Wallet with the payment filled in and you confirm it there with your password. Once the chain confirms it, I post the receipt in this chat.',
            )}
          </Texto>
          {!!error && (
            <Texto v="chica" color="aviso">
              {error}
            </Texto>
          )}
          <Boton titulo={tr('Confirmar y abrir Veta Wallet', 'Confirm and open Veta Wallet')} icono="enlace" cargando={abriendo} onPress={() => void confirmar()} />
          <Boton titulo={tr('Corregir', 'Edit')} variante="secundario" onPress={() => setPaso('elegir')} />
        </View>
      )}
    </Hoja>
  );
}

function Resumen({ tema, nombre, direccion, monto, moneda, desde }: { tema: ReturnType<typeof useTema>; nombre: string; direccion: string; monto: string; moneda: string; desde?: string }) {
  return (
    <View style={[s.resumen, { borderColor: tema.borde, backgroundColor: tema.superficie }]}>
      <Texto v="etiqueta" color="acentoTexto">
        {tr('Vas a enviar', 'You’re sending')}
      </Texto>
      <Texto v="titulo">
        {monto} {moneda}
      </Texto>
      <Texto v="cuerpoFuerte">{tr(`a ${nombre}`, `to ${nombre}`)}</Texto>
      <Texto v="mini" color="texto3" selectable>
        {tr('Su Veta Wallet (de su ficha en PULSE2CHAT):', 'Their Veta Wallet (from their PULSE2CHAT profile):')} {direccion}
      </Texto>
      {desde ? (
        <Texto v="mini" color="texto3" selectable>
          {tr('Desde tu cartera:', 'From your wallet:')} {cortar(desde)}
        </Texto>
      ) : null}
      <Texto v="mini" color="texto3">
        {tr(
          `Comisión de Veta Wallet: ${COMISION_USD.toFixed(2)} USD por envío (se cobra en ORIGEN), más el gas de la red.`,
          `Veta Wallet fee: ${COMISION_USD.toFixed(2)} USD per payment (charged in ORIGEN), plus network gas.`
        )}
      </Texto>
    </View>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: MEDIDA.espacio.m },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  aviso: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: MEDIDA.radio.m, padding: MEDIDA.espacio.m },
  resumen: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.l, gap: 4 },
});
