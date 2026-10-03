/**
 * EL CUERPO DE LA CARTERA (lo comparten la hoja «Cartera» y la pestaña Veta Wallet de los chats).
 *
 * «CARTERA»: tus saldos de Veta Wallet, leídos de la red de Orden Global. Solo lectura: AURA nunca mueve tu
 * dinero (para enviar o recibir se abre Veta Wallet, y allá se firma con tu contraseña).
 *
 *   · Arriba, el valor aproximado en dólares (si hay precio) y tu dirección, cortada.
 *   · Tus monedas con saldo (cantidad, precio de cada una y valor); las que están en cero, plegadas.
 *   · Actualizar y «Abrir Veta Wallet».
 *   · Sin dirección: se conecta sola con tu cuenta de PULSE2CHAT (cartera/conexion.ts); si tu ficha todavía no
 *     la muestra, los 2 pasos para pegarla (como el Centro de AURA para Windows).
 *
 * Los precios son los de AURA para Windows (Cartera.cs): ORIGEN = oro por gramo ÷ 55, AUKA la onza de oro,
 * AGKA la de plata, y los fijos de la wallet para los demás. Sin precio real se dice «sin precio».
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { localeActual, tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import * as RELEVO from '../pulse/relevo';
import { Boton, Campo, Texto, vibrar } from '../ui';
import { conectarAMano, desconectar, miCartera, type MiCartera } from './conexion';
import { abrirVetaWallet } from './estado';
import { cortar, type Saldo } from './logica';
import { leerSaldos, type Cartera } from './red';

type Props = {
  /** A la vista (la hoja abierta, o la pestaña elegida): solo así se lee la red. */
  activo: boolean;
  /** Tu dirección cuando se conoce (o null si se desconectó): la pestaña la usa para «Recibir». */
  onDireccion?: (d: string | null) => void;
};

const dinero = (n: number | null) => {
  if (n == null) return '—';
  try {
    return n.toLocaleString(localeActual(), { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 });
  } catch {
    return `US$ ${n.toFixed(2)}`;
  }
};
const cantidad = (n: number) => {
  try {
    return n.toLocaleString(localeActual(), { maximumFractionDigits: n < 1 ? 6 : 4 });
  } catch {
    return String(n);
  }
};
const hora = (ms: number) => {
  try {
    return new Date(ms).toLocaleTimeString(localeActual(), { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

export function CuerpoCartera({ activo, onDireccion }: Props) {
  const tema = useTema();
  const [mia, setMia] = useState<MiCartera | null | undefined>(undefined);
  const [cartera, setCartera] = useState<Cartera | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [editar, setEditar] = useState(false);
  const [pegada, setPegada] = useState('');
  const [errorForm, setErrorForm] = useState('');
  const [verCeros, setVerCeros] = useState(false);
  const [quitar, setQuitar] = useState(false);

  const leer = useCallback(async (d: string, forzar: boolean) => {
    setCargando(true);
    try {
      setCartera(await leerSaldos(d, { forzar }));
      setError('');
    } catch (e: any) {
      setError(e?.message || tr('No pude leer tu cartera ahora.', 'I couldn’t read your wallet right now.'));
    } finally {
      setCargando(false);
    }
  }, []);

  const conectar = useCallback(
    async (revisar: boolean) => {
      const c = await miCartera({ revisar }).catch(() => null);
      setMia(c);
      onDireccion?.(c?.direccion || null);
      if (c) void leer(c.direccion, revisar);
    },
    [leer],
  );

  useEffect(() => {
    if (!activo) {
      setEditar(false);
      setQuitar(false);
      setErrorForm('');
      return;
    }
    void conectar(true);
  }, [activo, conectar]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    try {
      const c = await conectarAMano(pegada);
      vibrar('exito');
      setMia(c);
      onDireccion?.(c.direccion);
      setEditar(false);
      setPegada('');
      setErrorForm('');
      void leer(c.direccion, true);
    } catch (e: any) {
      vibrar('aviso');
      setErrorForm(e?.message || tr('Esa no es una dirección.', 'That’s not an address.'));
    }
  };

  const conSaldo = (cartera?.saldos || []).filter((s) => (s.cantidad ?? 0) > 0);
  const enCero = (cartera?.saldos || []).filter((s) => s.cantidad === 0);
  const sinLeer = (cartera?.saldos || []).filter((s) => s.cantidad == null);
  const chat = !!RELEVO.quien();

  const formulario = (
    <View style={{ gap: MEDIDA.espacio.m }}>
      <Texto v="cuerpoFuerte">{tr('Conecta tu cartera en 2 pasos', 'Connect your wallet in 2 steps')}</Texto>
      <Paso n="01">
        {chat
          ? tr(
              'Tu cuenta de PULSE2CHAT todavía no muestra tu dirección: abre Veta Wallet y entra una vez con tu cuenta (es la misma contraseña). Después toca «Buscar otra vez».',
              'Your PULSE2CHAT account doesn’t show your address yet: open Veta Wallet and sign in once (same password). Then tap “Look again”.',
            )
          : tr(
              'Conecta PULSE2CHAT (en Chats) y tu cartera aparece sola: el chat y Veta Wallet son la misma cuenta. O abre Veta Wallet y sigue con el paso 2.',
              'Connect PULSE2CHAT (in Chats) and your wallet appears by itself: the chat and Veta Wallet are the same account. Or open Veta Wallet and go to step 2.',
            )}
      </Paso>
      <Paso n="02">{tr('En Veta Wallet ve a Recibir → Copiar dirección, y pégala aquí abajo.', 'In Veta Wallet go to Receive → Copy address, and paste it below.')}</Paso>
      <Campo
        etiqueta={tr('Tu dirección de Veta Wallet', 'Your Veta Wallet address')}
        value={pegada}
        onChangeText={(t) => setPegada(t.slice(0, 200))}
        placeholder="0x…"
        autoCapitalize="none"
        autoCorrect={false}
        error={errorForm || undefined}
      />
      <Texto v="mini" color="texto3">
        {tr(
          'La dirección es pública (como un número de cuenta para recibir): con ella AURA solo puede VER saldos, nunca mover dinero. Nunca te pediré tu contraseña.',
          'The address is public (like an account number to receive): with it AURA can only SEE balances, never move money. I’ll never ask for your password.',
        )}
      </Texto>
      <Boton titulo={tr('Guardar', 'Save')} icono="check" deshabilitado={!pegada.trim()} onPress={() => void guardar()} />
      <View style={s.fila}>
        <Boton titulo={tr('Abrir Veta Wallet', 'Open Veta Wallet')} icono="enlace" variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => void abrirVetaWallet()} />
        {chat ? <Boton titulo={tr('Buscar otra vez', 'Look again')} icono="wallet" variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => void conectar(true)} /> : null}
      </View>
      {mia && editar ? <Boton titulo={tr('Volver', 'Back')} variante="fantasma" onPress={() => setEditar(false)} /> : null}
    </View>
  );

  return (
    <>
      {mia === undefined ? (
        <View style={{ alignItems: 'center', gap: MEDIDA.espacio.s, paddingVertical: MEDIDA.espacio.xl }}>
          <ActivityIndicator color={tema.acento} />
          <Texto v="chica" color="texto2">
            {chat ? tr('Conectando tu cartera con tu cuenta de PULSE2CHAT…', 'Connecting your wallet from your PULSE2CHAT account…') : tr('Buscando tu cartera…', 'Looking for your wallet…')}
          </Texto>
        </View>
      ) : !mia || editar ? (
        formulario
      ) : (
        <View style={{ gap: MEDIDA.espacio.l }}>
          <View style={[s.total, { backgroundColor: tema.acentoFondo, borderColor: tema.borde }]}>
            <Texto v="etiqueta" color="acentoTexto">
              {tr('Valor total aproximado', 'Approximate total value')}
            </Texto>
            {cartera ? (
              <Texto v="heroe" accessibilityLabel={`${dinero(cartera.total)} USD`}>
                {dinero(cartera.total)}
              </Texto>
            ) : (
              <ActivityIndicator color={tema.acento} style={{ alignSelf: 'flex-start', marginVertical: MEDIDA.espacio.s }} />
            )}
            <Texto v="mini" color="texto2" selectable>
              {cortar(mia.direccion)}
              {cartera ? ` · ${tr('actualizado', 'updated')} ${hora(cartera.leido)}` : ''}
              {mia.fuente === 'chat' ? ` · ${tr('de tu cuenta de PULSE2CHAT', 'from your PULSE2CHAT account')}` : ''}
            </Texto>
          </View>

          {!!error && (
            <Texto v="chica" color="aviso">
              {error}
            </Texto>
          )}

          {cartera ? (
            <View style={{ gap: MEDIDA.espacio.s }}>
              <Texto v="chicaFuerte" color="texto2">
                {tr('Tus monedas', 'Your coins')}
              </Texto>
              {conSaldo.length ? (
                conSaldo.map((x) => <FilaSaldo key={x.simbolo} s={x} />)
              ) : (
                <Texto v="chica" color="texto2">
                  {tr('Todavía no tienes saldo en esta dirección.', 'No balance at this address yet.')}
                </Texto>
              )}
              {sinLeer.length ? (
                <Texto v="mini" color="aviso">
                  {tr(`No pude leer ${sinLeer.map((x) => x.simbolo).join(', ')} ahora (no es un cero: la red no contestó por esas).`, `I couldn’t read ${sinLeer.map((x) => x.simbolo).join(', ')} right now (not a zero: the network didn’t answer for those).`)}
                </Texto>
              ) : null}
              {enCero.length ? (
                <Pressable onPress={() => setVerCeros((v) => !v)} accessibilityRole="button" style={s.plegable}>
                  <Texto v="chica" color="texto3" style={{ flex: 1 }}>
                    {enCero.length === 1 ? tr('Otra moneda de la red, en cero', 'One other coin, at zero') : tr(`Otras ${enCero.length} monedas de la red, en cero`, `${enCero.length} other coins, at zero`)}
                  </Texto>
                  <Texto v="chicaFuerte" color="texto3">
                    {verCeros ? '−' : '+'}
                  </Texto>
                </Pressable>
              ) : null}
              {verCeros ? enCero.map((x) => <FilaSaldo key={x.simbolo} s={x} />) : null}
            </View>
          ) : null}

          <View style={s.fila}>
            <Boton titulo={tr('Actualizar', 'Refresh')} icono="flecha" variante="secundario" tam="chico" cargando={cargando} style={{ flex: 1 }} onPress={() => void leer(mia.direccion, true)} />
            <Boton titulo={tr('Abrir Veta Wallet', 'Open Veta Wallet')} icono="enlace" tam="chico" style={{ flex: 1 }} onPress={() => void abrirVetaWallet()} />
          </View>
          <Texto v="mini" color="texto3">
            {tr(
              'Para enviar dinero a alguien, ábrelo en su chat → «Enviar dinero»: la dirección sale de su ficha y lo firmas en Veta Wallet con tu contraseña. Precio de ORIGEN = 1 gramo de oro ÷ 55, en dólares; AUKA sigue la onza de oro y AGKA la de plata. Cada envío lleva la comisión de Veta Wallet: 0,01 USD, cobrada en ORIGEN.',
              'To send money to someone, open their chat → “Send money”: the address comes from their profile and you sign it in Veta Wallet with your password. ORIGEN price = 1 gram of gold ÷ 55, in dollars; AUKA follows the gold ounce and AGKA the silver ounce. Each payment carries the Veta Wallet fee: 0.01 USD, charged in ORIGEN.',
            )}
          </Texto>
          {quitar ? (
            <View style={{ gap: MEDIDA.espacio.s }}>
              <Texto v="chica" color="texto2">
                {tr('¿Desconectar tu cartera? AURA deja de ver tus saldos (tu dinero no se toca).', 'Disconnect your wallet? AURA stops seeing your balances (your money isn’t touched).')}
              </Texto>
              <View style={s.fila}>
                <Boton
                  titulo={tr('Sí, desconectar', 'Yes, disconnect')}
                  variante="peligro"
                  tam="chico"
                  style={{ flex: 1 }}
                  onPress={() => {
                    void desconectar().then(() => {
                      setMia(null);
                      onDireccion?.(null);
                      setCartera(null);
                      setQuitar(false);
                    });
                  }}
                />
                <Boton titulo={tr('No', 'No')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setQuitar(false)} />
              </View>
            </View>
          ) : (
            <View style={s.fila}>
              <Boton titulo={tr('Cambiar dirección', 'Change address')} variante="fantasma" tam="chico" style={{ flex: 1 }} onPress={() => setEditar(true)} />
              <Boton titulo={tr('Desconectar', 'Disconnect')} variante="fantasma" tam="chico" style={{ flex: 1 }} onPress={() => setQuitar(true)} />
            </View>
          )}
        </View>
      )}
    </>
  );
}

function Paso({ n, children }: { n: string; children: string }) {
  return (
    <View style={s.paso}>
      <Texto v="chicaFuerte" color="acentoTexto" style={{ width: 26 }}>
        {n}
      </Texto>
      <Texto v="chica" color="texto2" style={{ flex: 1 }}>
        {children}
      </Texto>
    </View>
  );
}

function FilaSaldo({ s: x }: { s: Saldo }) {
  const tema = useTema();
  return (
    <View style={[s.saldo, { borderColor: tema.borde, backgroundColor: tema.superficie }]}>
      <View style={[s.sello, { backgroundColor: tema.acentoFondo }]}>
        <Texto v="mini" color="acentoTexto" numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {x.simbolo.slice(0, 6)}
        </Texto>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Texto v="cuerpoFuerte">{x.cantidad == null ? tr('no se pudo leer', 'couldn’t read') : `${cantidad(x.cantidad)} ${x.simbolo}`}</Texto>
        <Texto v="mini" color="texto3">
          {x.precio == null ? tr('sin precio', 'no price') : `${dinero(x.precio)} ${tr('c/u', 'each')}`}
        </Texto>
      </View>
      <Texto v="cuerpoFuerte" color="texto2">
        {dinero(x.usd)}
      </Texto>
    </View>
  );
}

const s = StyleSheet.create({
  total: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.l, gap: 6 },
  fila: { flexDirection: 'row', gap: MEDIDA.espacio.s },
  paso: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  saldo: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: MEDIDA.radio.m, padding: MEDIDA.espacio.m },
  sello: { minWidth: 54, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  plegable: { flexDirection: 'row', alignItems: 'center', paddingVertical: MEDIDA.espacio.s },
});
