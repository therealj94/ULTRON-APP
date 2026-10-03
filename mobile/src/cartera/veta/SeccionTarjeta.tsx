/**
 * TU TARJETA VISA, DENTRO DE LA PESTAÑA VETA WALLET (José, 3-oct: «agregamos en Veta Wallet la tarjeta débito,
 * todo incluido dentro, igual como la tenemos nosotros; gira la tarjeta, poner clave para verla… huella o
 * Face ID»).
 *
 * Todo sale del backend de Veta Wallet con TU cuenta (veta/sesion.ts), lo mismo que su app:
 *   · Sin cuenta conectada: la tarjeta en negro y «Conecta tu Veta Wallet» (correo + contraseña, con el ojito,
 *     y «Usar la huella la próxima vez»). Con la huella ya activa: «Entrar con huella».
 *   · Con tarjeta: la tarjeta que gira, su estado (ACTIVA / CONGELADA), el saldo en ORIGEN y Recargar, y:
 *       - Congelar / descongelar (POST /cards/freeze; si el servidor falla, vuelve atrás y lo dice).
 *       - Ver número, vencimiento y CVV (POST /cards/pan, con contraseña o huella): se muestran en la
 *         tarjeta 45 s y se ocultan solos; nunca se guardan.
 *       - Ver el PIN, o crearlo si todavía no tiene (POST/PUT /cards/pin).
 *       - Límites de gasto y movimientos (comercio, fecha, ORIGEN y su referencia en dólares).
 *       - Recargar con ORIGEN de tu saldo (POST /cards/fund + /cards/fund/status hasta que se acredita).
 *   · Sin tarjeta todavía (404): se pide en Veta Wallet (exige Genesis ID aprobado, teléfono y el pago de la
 *     emisión, que allá se firma).
 *   · Reemitir, cancelar, 3D Secure, teléfono de códigos y disputas: en Veta Wallet (un toque la abre).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { tr, idiomaActual } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Boton, Campo, Hoja, Icono, Interruptor, Texto, vibrar, type NombreIcono } from '../../ui';
import { useUsuario } from '../../app/sesion';
import { abrirVetaWallet } from '../estado';
import { cantidad, dinero, fechaCorta } from '../formato';
import { PedirClave } from './PedirClave';
import { TarjetaVisa, type ManejoTarjeta } from './TarjetaVisa';
import { activarDesbloqueo, capacidadBiometrica, desactivarDesbloqueo, desbloqueoActivo, desbloquearClave, nombreBiometria } from './desbloqueo';
import {
  cargarSesion,
  conectada,
  correoConectado,
  entrar,
  ErrorVeta,
  escucharSesion,
  estaCongelada,
  salir,
  sinTarjeta,
  tarjeta as api,
  type DatosTarjeta,
  type MovTarjeta,
  type Recarga,
  type Tarjeta,
} from './sesion';

/** Segundos que número, CVV y PIN quedan a la vista (los mismos que Veta Wallet). */
const OCULTAR_TRAS = 45;
const CONSULTA_RECARGA_MS = 6_000;
const ESPERA_RECARGA_MS = 10 * 60_000;

type Fase = 'iniciando' | 'sinSesion' | 'cargando' | 'lista' | 'sinTarjeta' | 'error';
type Pedido = null | 'datos' | 'pin' | 'crearPin' | 'recargar';

const mensajeDe = (e: unknown) =>
  e instanceof ErrorVeta
    ? e.tipo === 'red'
      ? tr('Sin conexión con Veta Wallet. Revisa tu internet.', 'No connection to Veta Wallet. Check your internet.')
      : e.tipo === 'tiempo'
        ? tr('Veta Wallet tardó demasiado. Intenta otra vez.', 'Veta Wallet took too long. Try again.')
        : e.tipo === 'sesion'
          ? tr('Tu sesión de Veta Wallet venció. Vuelve a entrar.', 'Your Veta Wallet session expired. Sign in again.')
          : e.tipo === 'servidor'
            ? tr('El servidor de Veta Wallet tiene un problema ahora. Intenta en un momento.', 'Veta Wallet’s server has a problem right now. Try in a moment.')
            : e.message
    : tr('Algo falló. Intenta otra vez.', 'Something failed. Try again.');

export function SeccionTarjeta({ activa }: { activa: boolean }) {
  const tema = useTema();
  const [fase, setFase] = useState<Fase>('iniciando');
  const [card, setCard] = useState<Tarjeta | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [datos, setDatos] = useState<DatosTarjeta | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [sinPin, setSinPin] = useState(false);
  const [pinNuevo, setPinNuevo] = useState<string | null>(null);
  const [eligiendoPin, setEligiendoPin] = useState(false);
  const [pedido, setPedido] = useState<Pedido>(null);
  const [congelando, setCongelando] = useState(false);
  const [movs, setMovs] = useState<MovTarjeta[] | null>(null);
  const [recargando, setRecargando] = useState(false);
  const [monto, setMonto] = useState('');
  const [recarga, setRecarga] = useState<Recarga | null>(null);
  const [quedan, setQuedan] = useState(0);
  const giro = useRef<ManejoTarjeta>(null);
  const desdeRecarga = useRef(0);
  /**
   * La generación de lo sensible (auditoría VETA01): ocultar la pestaña, mandar la app al fondo, cerrar sesión,
   * cancelar la ficha u «Ocultar ya» la suben. Una respuesta de número/CVV/PIN que llega después es de otra
   * generación y se tira: nunca vuelve a poner datos a la vista.
   */
  const gen = useRef(0);
  /** La de la sesión: un `cargar` que vuelve después de cerrar sesión no pinta la tarjeta. */
  const genSesion = useRef(0);
  const activaRef = useRef(activa);
  activaRef.current = activa;

  const taparTodo = useCallback(() => {
    gen.current++;
    setDatos(null);
    setPin(null);
    setPedido(null);
    setPinNuevo(null);
    setEligiendoPin(false);
    giro.current?.girar(false);
  }, []);

  const cargar = useCallback(async (silencioso = false) => {
    const gs = genSesion.current;
    await cargarSesion();
    if (!conectada()) {
      setFase('sinSesion');
      return;
    }
    if (!silencioso) setFase('cargando');
    try {
      const c = await api.mia();
      if (gs !== genSesion.current || !conectada()) return; // cerró sesión mientras tanto
      setCard(c);
      setFase('lista');
      setError('');
      api
        .movimientos()
        .then((m) => gs === genSesion.current && setMovs(m))
        .catch(() => gs === genSesion.current && setMovs([]));
      // Una recarga que quedó a medias (en esta app o en Veta Wallet) se sigue.
      api
        .estadoRecarga()
        .then((r) => {
          if (gs !== genSesion.current) return;
          if (r?.status === 'pending' || r?.status === 'debited') {
            setRecarga(r);
            desdeRecarga.current = Date.now();
          }
        })
        .catch(() => undefined);
    } catch (e) {
      if (gs !== genSesion.current) return;
      if (sinTarjeta(e)) return setFase('sinTarjeta');
      if (e instanceof ErrorVeta && e.tipo === 'sesion') return setFase('sinSesion');
      setError(mensajeDe(e));
      setFase('error');
    }
  }, []);

  useEffect(() => {
    if (activa) void cargar(fase === 'lista');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa]);
  // Cerrar sesión (aquí o porque venció): todo lo de esa cuenta se borra de la pantalla.
  useEffect(
    () =>
      escucharSesion(() => {
        if (conectada()) return;
        genSesion.current++;
        taparTodo();
        setCard(null);
        setMovs(null);
        setRecarga(null);
        setFase('sinSesion');
      }),
    [taparTodo]
  );
  // La app al fondo (o la pantalla bloqueada): lo sensible se tapa y lo que estaba en vuelo ya no vale.
  // Solo 'background': en iPhone el diálogo de Face ID pone la app en 'inactive', y eso no debe cortar la
  // autorización que se está pidiendo.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') taparTodo();
    });
    return () => sub.remove();
  }, [taparTodo]);

  // Los datos sensibles se ocultan solos (y la tarjeta vuelve al frente).
  useEffect(() => {
    if (!datos && !pin) return;
    setQuedan(OCULTAR_TRAS);
    const tic = setInterval(() => setQuedan((q) => Math.max(0, q - 1)), 1000);
    const fin = setTimeout(() => {
      gen.current++;
      setDatos(null);
      setPin(null);
      giro.current?.girar(false);
    }, OCULTAR_TRAS * 1000);
    return () => {
      clearInterval(tic);
      clearTimeout(fin);
    };
  }, [datos, pin]);
  // Al salir de la pestaña, nada sensible queda en memoria.
  useEffect(() => {
    if (!activa) taparTodo();
  }, [activa, taparTodo]);

  // Una recarga en camino: se consulta hasta que se acredita, falla o pasan 10 minutos.
  useEffect(() => {
    if (!activa || !recarga || (recarga.status !== 'pending' && recarga.status !== 'debited')) return;
    const t = setInterval(async () => {
      if (Date.now() - desdeRecarga.current > ESPERA_RECARGA_MS) {
        setRecarga(null);
        setAviso(tr('La red está tardando más de lo normal. Revisa tu tarjeta en unos minutos.', 'The network is slower than usual. Check your card in a few minutes.'));
        return;
      }
      try {
        const r = await api.estadoRecarga();
        setRecarga(r);
        if (r?.status === 'funded') {
          vibrar('exito');
          setAviso(tr('¡Recarga acreditada!', 'Top-up credited!'));
          void cargar(true);
        } else if (r?.status === 'failed') setAviso(r.error || tr('La recarga no se completó.', 'The top-up didn’t complete.'));
      } catch {
        /* se reintenta en la próxima vuelta */
      }
    }, CONSULTA_RECARGA_MS);
    return () => clearInterval(t);
  }, [activa, recarga, cargar]);

  const congelar = async (v: boolean) => {
    if (!card || congelando) return;
    const previo = card.status;
    setCongelando(true);
    setCard({ ...card, status: v ? 'FROZEN' : 'ACTIVE' });
    try {
      const r = await api.congelar(v);
      setCard((c) => (c ? { ...c, status: r?.status || (v ? 'FROZEN' : 'ACTIVE') } : c));
      setAviso(v ? tr('Tarjeta congelada: nadie puede usarla hasta que la actives.', 'Card frozen: nobody can use it until you turn it back on.') : tr('Tarjeta activa otra vez.', 'Card active again.'));
    } catch (e) {
      setCard((c) => (c ? { ...c, status: previo } : c));
      setAviso(tr(`No se pudo cambiar: ${mensajeDe(e)}`, `Couldn’t change it: ${mensajeDe(e)}`));
    } finally {
      setCongelando(false);
    }
  };

  /**
   * Una recarga cuyo resultado no se sabe (409: ya hay una; o se cortó la red después de mandarla): se pregunta
   * el estado real y se sigue esa. Nunca se vuelve a mandar a ciegas (auditoría VETA02).
   */
  const reconciliarRecarga = async (porQue: 'ya-habia' | 'incierta') => {
    const gs = genSesion.current;
    // El formulario se cierra ya: con el resultado en duda, un segundo «Recargar» podría cobrar dos veces.
    setRecargando(false);
    setMonto('');
    try {
      const r = await api.estadoRecarga();
      if (gs !== genSesion.current) return; // cerró sesión mientras tanto
      // El servidor solo deja UNA recarga abierta por persona: si hay una en camino, es la que hay que seguir
      // (la de recién o una empezada en Veta Wallet). No se dice «la tuya salió»: no se sabe cuál es.
      if (r?.status === 'pending' || r?.status === 'debited') {
        setRecarga(r);
        desdeRecarga.current = Date.now();
        setAviso(tr('Hay una recarga en camino: la sigo aquí hasta que se acredite (no mandé otra).', 'There’s a top-up on its way: I’m following it here until it’s credited (I didn’t send another).'));
        return;
      }
      // «funded» es la ÚLTIMA recarga, que puede ser una de antes: se refresca el saldo, sin cantar victoria.
      if (r?.status === 'funded') void cargar(true);
    } catch {
      /* abajo se dice que no se pudo confirmar */
    }
    if (gs !== genSesion.current) return;
    setAviso(
      porQue === 'ya-habia'
        ? tr('Veta Wallet dice que ya hay una recarga, pero no pude ver en qué va. Revisa en unos minutos (no mandé otra).', 'Veta Wallet says there’s already a top-up, but I couldn’t see its status. Check in a few minutes (I didn’t send another).')
        : tr('No pude confirmar si la recarga salió. No la repito para no cobrarte dos veces: revisa tu saldo en unos minutos.', 'I couldn’t confirm whether the top-up went out. I won’t repeat it so you aren’t charged twice: check your balance in a few minutes.')
    );
  };

  /** Lo que se pidió con la contraseña (o la huella). 401 = contraseña incorrecta: la ficha sigue abierta. */
  const autorizar = async (clave: string): Promise<{ ok: boolean; msg?: string }> => {
    const que = pedido;
    const g = gen.current;
    // ¿Sigue valiendo mostrar lo que llegue? (misma generación y la pestaña a la vista)
    const vale = () => g === gen.current && activaRef.current;
    try {
      if (que === 'datos') {
        const d = await api.datos(clave);
        if (!vale()) return { ok: true };
        if (d?.pan) {
          setDatos(d);
          giro.current?.girar(true); // al reverso: el CVV es lo que se viene a buscar
        } else if (d?.panUrl) setAviso(tr('Tu banco emisor pide abrir el número en su página segura: ábrelo en Veta Wallet.', 'Your issuer asks to open the number on its secure page: open it in Veta Wallet.'));
      } else if (que === 'pin') {
        const d = await api.pin(clave);
        if (!vale()) return { ok: true };
        if (d?.pin) setPin(d.pin);
        else setAviso(tr('El emisor pide ver el PIN en su página segura: ábrelo en Veta Wallet.', 'The issuer asks to view the PIN on its secure page: open it in Veta Wallet.'));
      } else if (que === 'crearPin' && pinNuevo) {
        await api.crearPin(pinNuevo, clave);
        if (!vale()) {
          setPinNuevo(null);
          setSinPin(false);
          return { ok: true };
        }
        setPin(pinNuevo);
        setPinNuevo(null);
        setSinPin(false);
        setAviso(tr('PIN guardado.', 'PIN saved.'));
      } else if (que === 'recargar') {
        const r = await api.recargar(monto, clave);
        setRecarga(r);
        setRecargando(false);
        setMonto('');
        desdeRecarga.current = Date.now();
        if (r?.status === 'funded') {
          setAviso(tr('¡Recarga acreditada!', 'Top-up credited!'));
          void cargar(true);
        }
      }
      setPedido(null);
      return { ok: true };
    } catch (e) {
      if (e instanceof ErrorVeta && e.tipo === 'clave') return { ok: false, msg: tr('Contraseña incorrecta', 'Wrong password') };
      if (e instanceof ErrorVeta && e.status === 409) {
        if (que === 'pin') {
          setSinPin(true);
          setAviso(tr('Tu tarjeta todavía no tiene un PIN. Puedes crearlo ahora.', 'Your card doesn’t have a PIN yet. You can create it now.'));
        } else if (que === 'recargar') void reconciliarRecarga('ya-habia');
        else setAviso(tr('El emisor no puede mostrar los datos de esta tarjeta ahora mismo.', 'The issuer can’t show this card’s details right now.'));
      } else if (que === 'recargar' && e instanceof ErrorVeta && (e.tipo === 'tiempo' || e.tipo === 'red' || e.tipo === 'servidor')) {
        // Se mandó y no hubo respuesta clara: pudo salir. Se mira el estado; no se repite.
        void reconciliarRecarga('incierta');
      } else if (e instanceof ErrorVeta && e.status === 400 && que === 'crearPin') {
        setEligiendoPin(true);
        setAviso(e.message || tr('El emisor no aceptó ese PIN: elige otro.', 'The issuer didn’t accept that PIN: pick another.'));
      } else setAviso(mensajeDe(e));
      setPedido(null);
      return { ok: true };
    }
  };

  const titulos: Record<Exclude<Pedido, null>, string> = {
    datos: tr('Ver el número de tu tarjeta', 'View your card number'),
    pin: tr('Ver el PIN de tu tarjeta', 'View your card PIN'),
    crearPin: tr('Guardar tu PIN nuevo', 'Save your new PIN'),
    recargar: tr(`Recargar ${monto} ORIGEN`, `Top up ${monto} ORIGEN`),
  };

  const congelada = estaCongelada(card?.status);
  const enCamino = recarga && (recarga.status === 'pending' || recarga.status === 'debited');

  return (
    <View style={{ gap: MEDIDA.espacio.m }}>
      <View style={s.filaCentro}>
        <Text style={{ color: tema.texto, fontSize: 17, fontWeight: '800', flex: 1 }} accessibilityRole="header">
          {tr('Tu tarjeta Visa', 'Your Visa card')}
        </Text>
        {fase === 'lista' ? (
          <Pressable onPress={() => void cargar(true)} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: tema.acentoTexto, fontWeight: '700', fontSize: 13.5 }}>{tr('Actualizar', 'Refresh')}</Text>
          </Pressable>
        ) : null}
      </View>

      {fase === 'iniciando' || fase === 'cargando' ? (
        <>
          <TarjetaVisa cargando />
          <View style={[s.filaCentro, { justifyContent: 'center', gap: 8 }]}>
            <ActivityIndicator color={tema.acento} />
            <Texto v="chica" color="texto2">
              {tr('Preguntando al emisor por tu tarjeta…', 'Asking the issuer about your card…')}
            </Texto>
          </View>
        </>
      ) : fase === 'sinSesion' ? (
        <Conectar onListo={() => void cargar()} />
      ) : fase === 'sinTarjeta' ? (
        <>
          <TarjetaVisa />
          <View style={[s.panel, { backgroundColor: tema.superficie, borderColor: tema.borde }]}>
            <Texto v="cuerpoFuerte">{tr('Todavía no tienes tu tarjeta Visa', 'You don’t have your Visa card yet')}</Texto>
            <Texto v="chica" color="texto2">
              {tr(
                'Se pide en Veta Wallet: necesita tu Genesis ID aprobado, tu teléfono y el pago de la emisión en ORIGEN, que allá firmas. Cuando la tengas, aparece aquí sola.',
                'You request it in Veta Wallet: it needs your approved Genesis ID, your phone and the issuance payment in ORIGEN, which you sign there. Once you have it, it shows up here.'
              )}
            </Texto>
            <Boton titulo={tr('Pedirla en Veta Wallet', 'Request it in Veta Wallet')} icono="wallet" onPress={() => void abrirVetaWallet()} />
            <Boton titulo={tr('Ya la pedí: revisar', 'I requested it: check')} variante="fantasma" tam="chico" onPress={() => void cargar()} />
          </View>
          <SalirVeta onSalir={() => setFase('sinSesion')} />
        </>
      ) : fase === 'error' ? (
        <View style={[s.panel, { backgroundColor: tema.avisoFondo, borderColor: tema.aviso }]}>
          <Texto v="chica" color="aviso">
            {error}
          </Texto>
          <Boton titulo={tr('Reintentar', 'Retry')} variante="secundario" tam="chico" onPress={() => void cargar()} />
        </View>
      ) : card ? (
        <>
          <TarjetaVisa ref={giro} last4={card.last4} titular={card.cardHolderName} congelada={congelada} datos={datos} />
          <View style={[s.filaCentro, { justifyContent: 'space-between' }]}>
            <View style={[s.estado, { backgroundColor: congelada ? 'rgba(240,119,107,0.13)' : 'rgba(62,217,160,0.13)' }]}>
              <Icono nombre={congelada ? 'candado' : 'check'} tam={13} color={congelada ? '#F0776B' : '#3ED9A0'} />
              <Text style={{ color: congelada ? '#F0776B' : '#3ED9A0', fontWeight: '800', fontSize: 12, letterSpacing: 1 }}>{congelada ? tr('CONGELADA', 'FROZEN') : tr('ACTIVA', 'ACTIVE')}</Text>
            </View>
            <Text style={{ color: tema.texto3, fontSize: 12 }}>{tr('Toca la tarjeta para girarla', 'Tap the card to flip it')}</Text>
          </View>

          {datos || pin ? (
            <View style={[s.panel, { backgroundColor: tema.acentoFondo, borderColor: tema.acento }]}>
              {datos?.pan ? <DatoVisible k={tr('Número', 'Number')} v={datos.pan.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim()} /> : null}
              {datos?.expiry ? <DatoVisible k={tr('Vence', 'Expires')} v={datos.expiry} /> : null}
              {datos?.cvv ? <DatoVisible k="CVV" v={datos.cvv} /> : null}
              {pin ? <DatoVisible k="PIN" v={pin} /> : null}
              <Texto v="mini" color="texto2">
                {tr(`Mantén presionado para copiar. Se ocultan solos en ${quedan} s y no se guardan en el teléfono.`, `Hold to copy. They hide by themselves in ${quedan} s and aren’t stored on the phone.`)}
              </Texto>
              <Boton
                titulo={tr('Ocultar ya', 'Hide now')}
                variante="fantasma"
                tam="chico"
                icono="ojoTachado"
                onPress={() => {
                  gen.current++;
                  setDatos(null);
                  setPin(null);
                  giro.current?.girar(false);
                }}
              />
            </View>
          ) : null}

          {!!aviso && (
            <Pressable onPress={() => setAviso('')} style={[s.panel, { backgroundColor: tema.superficie, borderColor: tema.borde, paddingVertical: MEDIDA.espacio.m }]}>
              <Texto v="chica" color="texto2">
                {aviso}
              </Texto>
            </Pressable>
          )}

          {/* El saldo de la tarjeta: siempre en ORIGEN (regla del backend), con Recargar. */}
          <View style={[s.panel, { backgroundColor: tema.superficie, borderColor: tema.borde }]}>
            <Text style={{ color: tema.texto3, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }}>{tr('SALDO DISPONIBLE', 'AVAILABLE BALANCE')}</Text>
            <Text style={{ color: tema.texto, fontSize: 26, fontWeight: '800' }}>{card.availableOrigen != null ? `${cantidad(card.availableOrigen)} ORIGEN` : '—'}</Text>
            {card.availableOrigen == null ? (
              <Texto v="mini" color="texto3">
                {tr('No pude leer el saldo ahora. Toca Actualizar.', 'I couldn’t read the balance now. Tap Refresh.')}
              </Texto>
            ) : null}
            {enCamino ? (
              <View style={[s.filaCentro, { gap: 8 }]}>
                <ActivityIndicator color={tema.acento} />
                <Texto v="chica" color="acentoTexto" style={{ flex: 1 }}>
                  {recarga?.status === 'debited' ? tr('Pago confirmado: acreditando en tu tarjeta…', 'Payment confirmed: crediting your card…') : tr('Recarga en camino: confirmando tu pago…', 'Top-up on its way: confirming your payment…')}
                </Texto>
              </View>
            ) : recargando ? (
              <View style={{ gap: MEDIDA.espacio.s }}>
                <Campo etiqueta={tr('¿Cuánto ORIGEN?', 'How much ORIGEN?')} value={monto} onChangeText={(t) => setMonto(t.replace(',', '.').replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="10" />
                <Texto v="mini" color="texto3">
                  {tr('Pagas ORIGEN de tu saldo y la tarjeta recibe el equivalente. Se autoriza con tu contraseña o huella.', 'You pay ORIGEN from your balance and the card receives the equivalent. Authorized with your password or fingerprint.')}
                </Texto>
                <View style={{ flexDirection: 'row', gap: MEDIDA.espacio.s }}>
                  <Boton titulo={tr('Cancelar', 'Cancel')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setRecargando(false)} />
                  <Boton titulo={tr('Recargar', 'Top up')} tam="chico" icono="huella" style={{ flex: 1 }} deshabilitado={!(Number(monto) > 0)} onPress={() => setPedido('recargar')} />
                </View>
              </View>
            ) : (
              <Boton titulo={tr('Recargar', 'Top up')} icono="flecha" deshabilitado={congelada} onPress={() => setRecargando(true)} />
            )}
          </View>

          <View style={[s.lista, { backgroundColor: tema.superficie, borderColor: tema.borde }]}>
            <Opcion icono="candado" titulo={tr('Congelar tarjeta', 'Freeze card')} detalle={tr('Bloqueo temporal instantáneo', 'Instant temporary block')}>
              {congelando ? <ActivityIndicator color={tema.acento} /> : <Interruptor valor={congelada} onCambiar={(v) => void congelar(v)} etiqueta={tr('Congelar tarjeta', 'Freeze card')} />}
            </Opcion>
            <Opcion icono="ojo" titulo={tr('Ver número completo', 'View full number')} detalle={tr('Número, vencimiento y CVV · con contraseña o huella', 'Number, expiry and CVV · with password or fingerprint')} onPress={() => setPedido('datos')} />
            <Opcion
              icono="llave"
              titulo={sinPin ? tr('Crear PIN', 'Create PIN') : tr('Ver PIN', 'View PIN')}
              detalle={sinPin ? tr('Tu tarjeta aún no tiene uno', 'Your card doesn’t have one yet') : tr('Con contraseña o huella', 'With password or fingerprint')}
              onPress={() => (sinPin ? setEligiendoPin(true) : setPedido('pin'))}
            />
            {pin && !sinPin ? <Opcion icono="lapiz" titulo={tr('Cambiar PIN', 'Change PIN')} detalle={tr('Elige uno nuevo de 4 a 12 dígitos', 'Pick a new one, 4 to 12 digits')} onPress={() => setEligiendoPin(true)} /> : null}
            <Opcion icono="ajustes" titulo={tr('Más opciones en Veta Wallet', 'More options in Veta Wallet')} detalle={tr('Límites, reemitir, 3D Secure, disputas', 'Limits, reissue, 3D Secure, disputes')} onPress={() => void abrirVetaWallet()} />
          </View>

          {card.dailyLimit != null || card.monthlyLimit != null ? (
            <View style={[s.panel, { backgroundColor: tema.superficie, borderColor: tema.borde }]}>
              <Texto v="cuerpoFuerte">{tr('Límites de gasto', 'Spending limits')}</Texto>
              {card.dailyLimit != null ? <DatoFila k={tr('Diario', 'Daily')} v={`${cantidad(card.dailyLimit)} ORIGEN`} /> : null}
              {card.weeklyLimit != null ? <DatoFila k={tr('Semanal', 'Weekly')} v={`${cantidad(card.weeklyLimit)} ORIGEN`} /> : null}
              {card.monthlyLimit != null ? <DatoFila k={tr('Mensual', 'Monthly')} v={`${cantidad(card.monthlyLimit)} ORIGEN`} /> : null}
            </View>
          ) : null}

          <Text style={{ color: tema.texto, fontSize: 15.5, fontWeight: '800' }}>{tr('Consumos de la tarjeta', 'Card purchases')}</Text>
          {movs == null ? (
            <ActivityIndicator color={tema.acento} />
          ) : !movs.length ? (
            <Texto v="chica" color="texto2">
              {tr('Los consumos de tu tarjeta aparecerán aquí.', 'Your card purchases will show up here.')}
            </Texto>
          ) : (
            <View style={[s.lista, { backgroundColor: tema.superficie, borderColor: tema.borde }]}>
              {movs.slice(0, 12).map((m, i) => (
                <View key={m.id || i} style={[s.fila, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: tema.borde }]}>
                  <View style={[s.icono, { backgroundColor: tema.acentoFondo }]}>
                    <Icono nombre="wallet" tam={17} color={tema.acentoTexto} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: tema.texto, fontWeight: '700' }} numberOfLines={1}>
                      {m.merchant || '—'}
                    </Text>
                    <Text style={{ color: tema.texto3, fontSize: 12.5 }}>
                      {m.date ? fechaCorta(new Date(m.date).getTime()) : ''}
                      {m.status ? ` · ${m.status}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: tema.texto, fontWeight: '800' }}>{m.origenAmount != null ? `${cantidad(m.origenAmount)} ORIGEN` : '—'}</Text>
                    {m.amount != null ? <Text style={{ color: tema.texto3, fontSize: 12 }}>{dinero(m.amount)} USD</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          )}

          <SalirVeta onSalir={() => setFase('sinSesion')} />
        </>
      ) : null}

      <PedirClave
        visible={!!pedido}
        titulo={pedido ? titulos[pedido] : ''}
        subtitulo={pedido === 'recargar' ? tr('Autoriza el pago con tu contraseña de Veta Wallet.', 'Authorize the payment with your Veta Wallet password.') : tr('Pedimos tu contraseña cada vez que se muestran datos sensibles. No se guardan en el teléfono.', 'We ask for your password every time sensitive data is shown. It isn’t stored on the phone.')}
        accion={pedido === 'recargar' ? tr('Recargar', 'Top up') : pedido === 'crearPin' ? tr('Guardar PIN', 'Save PIN') : tr('Mostrar', 'Show')}
        onCancelar={() => {
          gen.current++;
          setPedido(null);
          setPinNuevo(null);
        }}
        onAutorizar={autorizar}
      />
      <ElegirPin
        visible={eligiendoPin}
        onCancelar={() => setEligiendoPin(false)}
        onListo={(p) => {
          setPinNuevo(p);
          setEligiendoPin(false);
          setPedido('crearPin');
        }}
      />
    </View>
  );
}

/* ── conectar la cuenta de Veta Wallet ────────────────────────────────────────────────────── */

function Conectar({ onListo }: { onListo: () => void }) {
  const tema = useTema();
  const usuario = useUsuario();
  const [correo, setCorreo] = useState(() => correoConectado() || usuario?.correo || '');
  const [clave, setClave] = useState('');
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState('');
  const [bio, setBio] = useState<{ disponible: boolean; tipo: 'face' | 'huella' | 'iris' }>({ disponible: false, tipo: 'huella' });
  const [conHuella, setConHuella] = useState(false);
  const [usarBio, setUsarBio] = useState(true);
  const nombre = nombreBiometria(bio.tipo, idiomaActual() !== 'en');

  useEffect(() => {
    void Promise.all([capacidadBiometrica(), desbloqueoActivo()]).then(([c, a]) => {
      setBio(c);
      setConHuella(c.disponible && a && !!correoConectado());
    });
  }, []);

  const conectar = async (c: string, deBio = false) => {
    if (!correo.trim() || !c) return;
    setYendo(true);
    setError('');
    try {
      await entrar(correo, c);
      vibrar('exito');
      if (!deBio && usarBio && bio.disponible) await activarDesbloqueo(c);
      setClave('');
      onListo();
    } catch (e) {
      vibrar('aviso');
      const credenciales = e instanceof ErrorVeta && (e.status === 401 || e.status === 403 || e.status === 400 || e.status === 404);
      setError(credenciales ? tr('Correo o contraseña incorrectos.', 'Wrong email or password.') : mensajeDe(e));
      if (deBio) setConHuella(false);
    } finally {
      setYendo(false);
    }
  };

  const entrarConHuella = async () => {
    const c = await desbloquearClave(tr('Entrar a tu Veta Wallet', 'Sign in to your Veta Wallet'));
    if (c) await conectar(c, true);
  };

  return (
    <>
      <TarjetaVisa />
      <View style={[s.panel, { backgroundColor: tema.superficie, borderColor: tema.borde }]}>
        <Texto v="cuerpoFuerte">{tr('Conecta tu Veta Wallet', 'Connect your Veta Wallet')}</Texto>
        <Texto v="chica" color="texto2">
          {tr('Con tu cuenta de Veta Wallet ves aquí tu tarjeta Visa: la giras, la congelas, ves sus datos y la recargas. Es la misma cuenta que usas en la app de Veta Wallet.', 'With your Veta Wallet account you see your Visa card here: flip it, freeze it, view its details and top it up. It’s the same account you use in the Veta Wallet app.')}
        </Texto>
        {conHuella ? (
          <>
            <Boton titulo={tr(`Entrar con ${nombre}`, `Sign in with ${nombre}`)} icono="huella" cargando={yendo} onPress={() => void entrarConHuella()} />
            <Boton titulo={tr('Usar mi contraseña', 'Use my password')} variante="fantasma" tam="chico" onPress={() => setConHuella(false)} />
          </>
        ) : (
          <>
            <Campo etiqueta={tr('Correo de Veta Wallet', 'Veta Wallet email')} value={correo} onChangeText={setCorreo} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
            <Campo
              etiqueta={tr('Contraseña', 'Password')}
              value={clave}
              onChangeText={(t) => {
                setClave(t);
                if (error) setError('');
              }}
              clave
              autoComplete="current-password"
              textContentType="password"
              error={error || undefined}
              onSubmitEditing={() => void conectar(clave)}
              returnKeyType="go"
            />
            {bio.disponible ? (
              <Pressable onPress={() => setUsarBio((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: usarBio }} style={[s.filaCentro, { gap: 12 }]}>
                <View style={[s.casilla, { borderColor: usarBio ? tema.acento : tema.borde, backgroundColor: usarBio ? tema.acento : 'transparent' }]}>
                  {usarBio ? <Icono nombre="check" tam={14} color={tema.sobreAcento} /> : null}
                </View>
                <Texto v="chica" style={{ flex: 1 }}>
                  {tr(`Entrar y autorizar con ${nombre} la próxima vez`, `Sign in and authorize with ${nombre} next time`)}
                </Texto>
              </Pressable>
            ) : null}
            <Boton titulo={tr('Entrar a Veta Wallet', 'Sign in to Veta Wallet')} icono="candado" cargando={yendo} deshabilitado={!correo.trim() || !clave} onPress={() => void conectar(clave)} />
          </>
        )}
        <Texto v="mini" color="texto3">
          {tr('La sesión queda en el llavero seguro del teléfono. AURA nunca ve tu contraseña: con la huella activa, solo el teléfono la libera cuando tú lo autorizas.', 'The session stays in the phone’s secure keychain. AURA never sees your password: with the fingerprint on, only the phone releases it when you authorize.')}
        </Texto>
      </View>
    </>
  );
}

function SalirVeta({ onSalir }: { onSalir: () => void }) {
  const [seguro, setSeguro] = useState(false);
  const correo = correoConectado();
  return seguro ? (
    <View style={{ flexDirection: 'row', gap: MEDIDA.espacio.s }}>
      <Boton
        titulo={tr('Sí, cerrar sesión', 'Yes, sign out')}
        variante="peligro"
        tam="chico"
        style={{ flex: 1 }}
        onPress={() =>
          void Promise.all([salir(), desactivarDesbloqueo()]).then(() => {
            setSeguro(false);
            onSalir();
          })
        }
      />
      <Boton titulo={tr('No', 'No')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setSeguro(false)} />
    </View>
  ) : (
    <Boton titulo={correo ? tr(`Cerrar sesión de Veta Wallet (${correo})`, `Sign out of Veta Wallet (${correo})`) : tr('Cerrar sesión de Veta Wallet', 'Sign out of Veta Wallet')} variante="fantasma" tam="chico" onPress={() => setSeguro(true)} />
  );
}

/* ── piezas ───────────────────────────────────────────────────────────────────────────────── */

function Opcion({ icono, titulo, detalle, onPress, children }: { icono: NombreIcono; titulo: string; detalle?: string; onPress?: () => void; children?: ReactNode }) {
  const tema = useTema();
  const dentro = (
    <>
      <View style={[s.icono, { backgroundColor: tema.acentoFondo }]}>
        <Icono nombre={icono} tam={18} color={tema.acentoTexto} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: tema.texto, fontWeight: '700', fontSize: 15 }}>{titulo}</Text>
        {detalle ? <Text style={{ color: tema.texto3, fontSize: 12.5, marginTop: 2 }}>{detalle}</Text> : null}
      </View>
      {children ?? (onPress ? <Icono nombre="adelante" tam={18} color={tema.texto3} /> : null)}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={titulo} style={({ pressed }) => [s.fila, s.separada, { borderColor: tema.borde, opacity: pressed ? 0.7 : 1 }]}>
      {dentro}
    </Pressable>
  ) : (
    <View style={[s.fila, s.separada, { borderColor: tema.borde }]}>{dentro}</View>
  );
}

function DatoVisible({ k, v }: { k: string; v: string }) {
  const tema = useTema();
  return (
    <View style={[s.filaCentro, { justifyContent: 'space-between' }]}>
      <Text style={{ color: tema.texto2, fontWeight: '700' }}>{k}</Text>
      <Text selectable style={{ color: tema.texto, fontWeight: '800', fontSize: 17, letterSpacing: 1.5 }}>
        {v}
      </Text>
    </View>
  );
}

function DatoFila({ k, v }: { k: string; v: string }) {
  const tema = useTema();
  return (
    <View style={[s.filaCentro, { justifyContent: 'space-between' }]}>
      <Text style={{ color: tema.texto2 }}>{k}</Text>
      <Text style={{ color: tema.texto, fontWeight: '700' }}>{v}</Text>
    </View>
  );
}

/** Elegir el PIN (4 a 12 dígitos, dos veces). Después se autoriza con la contraseña o la huella. */
function ElegirPin({ visible, onCancelar, onListo }: { visible: boolean; onCancelar: () => void; onListo: (pin: string) => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  useEffect(() => {
    if (!visible) {
      setA('');
      setB('');
    }
  }, [visible]);
  const valido = /^\d{4,12}$/.test(a);
  const iguales = a === b;
  return (
    <Hoja visible={visible} onCerrar={onCancelar} titulo={tr('Elige tu PIN', 'Choose your PIN')} subtitulo={tr('De 4 a 12 dígitos. Lo usas en cajeros y terminales.', '4 to 12 digits. You use it at ATMs and terminals.')}>
      <View style={{ gap: MEDIDA.espacio.m }}>
        <Campo etiqueta={tr('PIN nuevo', 'New PIN')} value={a} onChangeText={(t) => setA(t.replace(/\D/g, '').slice(0, 12))} keyboardType="number-pad" clave />
        <Campo
          etiqueta={tr('Repítelo', 'Repeat it')}
          value={b}
          onChangeText={(t) => setB(t.replace(/\D/g, '').slice(0, 12))}
          keyboardType="number-pad"
          clave
          error={b.length >= 4 && !iguales ? tr('No coinciden.', 'They don’t match.') : undefined}
        />
        <Boton titulo={tr('Seguir', 'Continue')} icono="flecha" deshabilitado={!valido || !iguales} onPress={() => onListo(a)} />
      </View>
    </Hoja>
  );
}

const s = StyleSheet.create({
  filaCentro: { flexDirection: 'row', alignItems: 'center' },
  panel: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.l, gap: MEDIDA.espacio.s },
  lista: { borderWidth: 1, borderRadius: MEDIDA.radio.l, paddingHorizontal: MEDIDA.espacio.m, overflow: 'hidden' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  separada: { borderBottomWidth: StyleSheet.hairlineWidth },
  icono: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  estado: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  casilla: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
