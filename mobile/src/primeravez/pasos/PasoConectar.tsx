/**
 * (f) Conectar su WhatsApp y su correo, al principio (José, 3-oct: «desde el principio abren conectar
 * WhatsApp y el correo… con instrucciones; si es de Orden Global ya sabes cómo conectarlo, solo que se
 * ponga correo y contraseña»).
 *
 *   · Correo: dirección y contraseña. Al escribir la dirección se dice qué contraseña va (Orden Global: la
 *     de su correo, nada más; Gmail o Yahoo: la «de aplicación»). Outlook/Hotmail y un hosting que el
 *     servidor no conoce se terminan en la hoja completa de correos (código de Microsoft, servidores a
 *     mano). El servidor prueba que puede leer Y mandar antes de guardar; si no, dice por qué.
 *   · WhatsApp: el mismo vincular de la pestaña de WhatsApp (con un código en este teléfono, o con QR). Se
 *     revisa solo cada 4 s y, al quedar vinculado, lo dice con su número.
 *   · Todo se puede saltar: queda en Chats y en Ajustes → Tus correos.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '../../lib/api';
import { tr } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Boton, Campo, Icono, Tarjeta, Texto, vibrar } from '../../ui';
import { HojaCorreos, useCuentasCorreo } from '../../ajustes/Correos';
import * as WA from '../../whatsapp/api';
import { Vincular } from '../../whatsapp/PantallaWhatsapp';
import { telefonoBonito, vistaDe, type EstadoWA } from '../../whatsapp/logica';
import { EncabezadoPaso } from '../piezas';
import { esCorreoOrdenGlobal } from '../flujo';
import type { PropsPaso } from './tipos';

type Detectado = { nombre: string; auth: 'clave' | 'microsoft'; ayuda: string; fuente: string };

export function PasoConectar(_: PropsPaso) {
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso
        etiqueta={tr('Tus mensajes', 'Your messages')}
        titulo={tr('Conecta tu correo y tu WhatsApp', 'Connect your email and WhatsApp')}
        texto={tr(
          'Así leo tus correos y tus chats, te aviso lo importante y te ayudo a contestar. Nunca mando nada sin que me digas que sí. Si prefieres, lo haces después en Chats.',
          'That way I read your email and chats, tell you what matters and help you reply. I never send anything until you say yes. If you prefer, do it later in Chats.'
        )}
      />
      <Aparecer retraso={120}>
        <TarjetaCorreo />
      </Aparecer>
      <Aparecer retraso={200}>
        <TarjetaWhatsapp />
      </Aparecer>
    </View>
  );
}

/* ── correo ───────────────────────────────────────────────────────────────────────────────── */

function TarjetaCorreo() {
  const tema = useTema();
  const { cuentas, refrescar } = useCuentasCorreo(true);
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [det, setDet] = useState<Detectado | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [hoja, setHoja] = useState(false);
  const [otra, setOtra] = useState(false);
  const pedido = useRef(0);

  const og = esCorreoOrdenGlobal(correo);
  const valida = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(correo.trim());

  // Al terminar de escribir la dirección: qué proveedor es y qué contraseña va (Orden Global se sabe aquí).
  const detectar = useCallback(async () => {
    setDet(null);
    if (!valida || esCorreoOrdenGlobal(correo)) return;
    const n = ++pedido.current;
    try {
      const r = await api<{ proveedor: Detectado }>('/api/correo/detectar', { method: 'POST', body: JSON.stringify({ correo: correo.trim() }) }, 15_000);
      if (n === pedido.current) setDet(r.proveedor);
    } catch {
      /* sin pista: el servidor lo vuelve a revisar al conectar */
    }
  }, [correo, valida]);

  const conectar = async () => {
    if (!valida || !clave || ocupado) return;
    setError('');
    setOcupado(true);
    try {
      await api('/api/correo/cuentas', { method: 'POST', body: JSON.stringify({ correo: correo.trim(), clave }) }, 45_000);
      vibrar('exito');
      setCorreo('');
      setClave('');
      setDet(null);
      setOtra(false);
      await refrescar();
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No pude conectarlo. Revisa la contraseña.', 'I couldn’t connect it. Check the password.'));
    } finally {
      setOcupado(false);
    }
  };

  const esMs = det?.auth === 'microsoft';
  const conectadas = cuentas || [];
  const mostrarFormulario = !conectadas.length || otra;

  const pista = og
    ? tr('Correo de Orden Global: solo tu dirección y la contraseña de tu correo. Lo demás ya lo sé.', 'Orden Global email: just your address and your email password. I already know the rest.')
    : esMs
      ? tr('Outlook y Hotmail entran con tu cuenta de Microsoft (un código), no con contraseña.', 'Outlook and Hotmail sign in with your Microsoft account (a code), not a password.')
      : det?.ayuda || tr('Escribe tu dirección y te digo qué contraseña va.', 'Type your address and I’ll tell you which password to use.');

  return (
    <Tarjeta>
      <View style={{ gap: MEDIDA.espacio.m }}>
        <View style={s.cabeza}>
          <View style={[s.icono, { backgroundColor: tema.acentoFondo }]}>
            <Icono nombre="correo" tam={20} color={tema.acentoTexto} />
          </View>
          <View style={{ flex: 1 }}>
            <Texto v="cuerpoFuerte">{tr('Tu correo', 'Your email')}</Texto>
            <Texto v="mini" color="texto3">
              {tr('Orden Global, Gmail, Yahoo, iCloud, Outlook o el de tu empresa', 'Orden Global, Gmail, Yahoo, iCloud, Outlook or your company’s')}
            </Texto>
          </View>
        </View>

        {conectadas.map((c) => (
          <View key={c.id} style={[s.listo, { backgroundColor: tema.exitoFondo }]}>
            <Icono nombre="check" tam={18} color={tema.exito} />
            <Texto v="chica" style={{ flex: 1 }} numberOfLines={1}>
              {c.correo}
            </Texto>
            <Texto v="mini" color="texto3">
              {c.proveedor.nombre}
            </Texto>
          </View>
        ))}

        {mostrarFormulario ? (
          <>
            <Campo
              etiqueta={tr('Tu correo', 'Your email')}
              value={correo}
              onChangeText={(t) => {
                setCorreo(t);
                setError('');
                setDet(null);
              }}
              onBlur={() => void detectar()}
              placeholder="nombre@ordenglobal.org"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
            />
            {!esMs && (
              <Campo
                etiqueta={og ? tr('Contraseña de tu correo', 'Your email password') : tr('Contraseña', 'Password')}
                value={clave}
                onChangeText={(t) => {
                  setClave(t);
                  setError('');
                }}
                clave
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => void conectar()}
              />
            )}
            <Texto v="chica" color={og ? 'acentoTexto' : 'texto2'}>
              {pista}
            </Texto>
            {!!error && (
              <Texto v="chica" color="aviso">
                {error}
              </Texto>
            )}
            {esMs ? (
              <Boton titulo={tr('Entrar con Microsoft', 'Sign in with Microsoft')} icono="enlace" onPress={() => setHoja(true)} />
            ) : (
              <Boton titulo={tr('Conectar correo', 'Connect email')} icono="correo" onPress={() => void conectar()} cargando={ocupado} deshabilitado={!valida || !clave} />
            )}
            {/* Lo que no cabe aquí (código de Microsoft, servidores escritos a mano): la hoja completa. */}
            <Boton titulo={tr('Más opciones', 'More options')} variante="fantasma" tam="chico" onPress={() => setHoja(true)} />
          </>
        ) : (
          <Boton titulo={tr('Conectar otro correo', 'Connect another email')} variante="fantasma" tam="chico" icono="mas" onPress={() => setOtra(true)} />
        )}
      </View>
      <HojaCorreos
        visible={hoja}
        onCerrar={() => {
          setHoja(false);
          void refrescar();
        }}
      />
    </Tarjeta>
  );
}

/* ── WhatsApp ─────────────────────────────────────────────────────────────────────────────── */

function TarjetaWhatsapp() {
  const tema = useTema();
  const [estado, setEstado] = useState<EstadoWA | null>(null);
  const [abierto, setAbierto] = useState(false);
  const vivo = useRef(true);

  const leer = useCallback(async () => {
    try {
      const e = await WA.estadoWA();
      if (vivo.current) setEstado(e);
    } catch {
      /* red: se reintenta en la próxima vuelta */
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    void leer();
    const t = setInterval(() => void leer(), 4000);
    return () => {
      vivo.current = false;
      clearInterval(t);
    };
  }, [leer]);

  const vista = vistaDe(estado);
  const anterior = useRef(vista);
  useEffect(() => {
    if (anterior.current !== 'listo' && vista === 'listo') vibrar('exito');
    anterior.current = vista;
  }, [vista]);

  // Esta cuenta no tiene WhatsApp habilitado: no se ofrece.
  if (vista === 'oculto') return null;

  return (
    <Tarjeta>
      <View style={{ gap: MEDIDA.espacio.m }}>
        <View style={s.cabeza}>
          <View style={[s.icono, { backgroundColor: '#00A88422' }]}>
            <Icono nombre="chat" tam={20} color="#00A884" />
          </View>
          <View style={{ flex: 1 }}>
            <Texto v="cuerpoFuerte">WhatsApp</Texto>
            <Texto v="mini" color="texto3">
              {tr('Como WhatsApp Web: tu teléfono sigue igual', 'Like WhatsApp Web: your phone keeps working the same')}
            </Texto>
          </View>
        </View>

        {vista === 'listo' ? (
          <View style={[s.listo, { backgroundColor: tema.exitoFondo }]}>
            <Icono nombre="check" tam={18} color={tema.exito} />
            <Texto v="chica" style={{ flex: 1 }}>
              {tr('Vinculado', 'Linked')}
              {estado?.numero ? ` · ${telefonoBonito(estado.numero) || estado.numero}` : ''}
            </Texto>
          </View>
        ) : vista === 'revisando' ? (
          <Texto v="chica" color="texto3">
            {tr('Revisando…', 'Checking…')}
          </Texto>
        ) : vista === 'sin_puente' || vista === 'caido' ? (
          <Texto v="chica" color="texto2">
            {tr('WhatsApp no contesta en este momento. Lo vinculas después en Chats → WhatsApp.', 'WhatsApp isn’t answering right now. Link it later in Chats → WhatsApp.')}
          </Texto>
        ) : abierto ? (
          <View style={[s.vincular, { borderColor: tema.borde }]}>
            <Vincular p={tema} estado={estado} onCambio={() => void leer()} />
          </View>
        ) : (
          <>
            <Texto v="chica" color="texto2">
              {tr(
                'Te doy un código de 8 letras y lo escribes en WhatsApp → ⋮ → Dispositivos vinculados → Vincular con el número de teléfono.',
                'I give you an 8-letter code and you type it in WhatsApp → ⋮ → Linked devices → Link with phone number instead.'
              )}
            </Texto>
            <Boton titulo={tr('Vincular WhatsApp', 'Link WhatsApp')} icono="enlace" onPress={() => setAbierto(true)} />
          </>
        )}
      </View>
    </Tarjeta>
  );
}

const s = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icono: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  listo: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  vincular: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden', marginHorizontal: -MEDIDA.espacio.s },
});
