/**
 * TUS CORREOS: conectar los buzones que AURA puede revisar y contestar (server/correo.ts).
 *
 *   · Escribes tu dirección: el servidor reconoce el proveedor (Gmail, Yahoo, iCloud, el de tu empresa…)
 *     y te dice qué clave usar (casi siempre una «contraseña de aplicación»).
 *   · Outlook, Hotmail y Microsoft 365 no aceptan contraseñas: te da un código para microsoft.com/devicelogin.
 *   · Antes de guardar, el servidor prueba que puede leer Y mandar; si no, dice por qué.
 *   · La clave se guarda cifrada en el servidor; aquí no se queda.
 *   · Servidores a mano: vienen ESCRITOS con lo que el servidor adivinó (mail.<dominio>, 993 y 465),
 *     no en gris de ejemplo. Antes la casilla parecía llena pero estaba vacía y «Conectar» no se
 *     activaba; y el error quedaba fuera de la hoja (José, 2-oct, ordenglobal.org).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { api } from '../lib/api';
import { tr } from '../i18n';
import { MEDIDA } from '../nucleo/tema';
import { Boton, Campo, Hoja, Texto, vibrar } from '../ui';

type Cuenta = { id: string; correo: string; proveedor: { nombre: string; auth: 'clave' | 'microsoft' } };
type Proveedor = { nombre: string; auth: 'clave' | 'microsoft'; ayuda: string; fuente: string; imap: { host: string }; smtp: { host: string } };

/** Las cuentas conectadas (para el número en la fila de Ajustes). */
export function useCuentasCorreo(abierta: boolean) {
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [microsoft, setMicrosoft] = useState(false);
  const refrescar = useCallback(async () => {
    try {
      const r = await api<{ cuentas: Cuenta[]; microsoft: boolean }>('/api/correo/cuentas', { method: 'GET' }, 10_000);
      setCuentas(r.cuentas);
      setMicrosoft(!!r.microsoft);
    } catch {
      setCuentas((c) => c ?? []);
    }
  }, []);
  useEffect(() => {
    void refrescar();
  }, [abierta, refrescar]);
  return { cuentas, microsoft, refrescar };
}

export function HojaCorreos({ visible, onCerrar }: { visible: boolean; onCerrar: () => void }) {
  const { cuentas, microsoft, refrescar } = useCuentasCorreo(visible);
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [prov, setProv] = useState<Proveedor | null>(null);
  const [manual, setManual] = useState(false);
  const [imapHost, setImapHost] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  // Vacíos = los de siempre (993 IMAP y 465 SMTP, ambos con TLS); 143/587 = STARTTLS.
  const [imapPuerto, setImapPuerto] = useState('');
  const [smtpPuerto, setSmtpPuerto] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [codigo, setCodigo] = useState<{ codigo: string; url: string } | null>(null);
  const sondeo = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reiniciar = () => {
    setCorreo('');
    setClave('');
    setProv(null);
    setManual(false);
    setImapHost('');
    setSmtpHost('');
    setImapPuerto('');
    setSmtpPuerto('');
    setError('');
    setCodigo(null);
    if (sondeo.current) clearTimeout(sondeo.current);
  };
  useEffect(() => {
    if (!visible) reiniciar();
    return () => {
      if (sondeo.current) clearTimeout(sondeo.current);
    };
  }, [visible]);

  const detectar = async () => {
    setError('');
    setOcupado(true);
    try {
      const r = await api<{ proveedor: Proveedor }>('/api/correo/detectar', { method: 'POST', body: JSON.stringify({ correo: correo.trim() }) }, 15_000);
      setProv(r.proveedor);
    } catch (e: any) {
      setError(e?.message || tr('No pude revisar esa dirección.', 'I couldn’t check that address.'));
    } finally {
      setOcupado(false);
    }
  };

  const conectar = async () => {
    setError('');
    setOcupado(true);
    try {
      await api(
        '/api/correo/cuentas',
        { method: 'POST', body: JSON.stringify({ correo: correo.trim(), clave, ...(manual ? { imapHost: imapHost.trim(), smtpHost: smtpHost.trim(), ...(puertoOk(imapPuerto) ? { imapPuerto: Number(imapPuerto) } : {}), ...(puertoOk(smtpPuerto) ? { smtpPuerto: Number(smtpPuerto) } : {}) } : {}) }) },
        45_000
      );
      vibrar('exito');
      reiniciar();
      await refrescar();
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No pude conectarlo.', 'I couldn’t connect it.'));
      // Un hosting que la base no conoce: ofrecer escribir los servidores a mano (ya escritos).
      if (prov?.fuente === 'adivinado') aMano();
    } finally {
      setOcupado(false);
    }
  };

  const conMicrosoft = async () => {
    setError('');
    setOcupado(true);
    try {
      const r = await api<{ codigo: string; url: string; intervalo: number }>('/api/correo/microsoft/iniciar', { method: 'POST', body: JSON.stringify({ correo: correo.trim() }) }, 20_000);
      setCodigo({ codigo: r.codigo, url: r.url });
      let fallos = 0;
      const preguntar = async () => {
        try {
          const s = await api<{ estado: string }>('/api/correo/microsoft/consultar', { method: 'POST', body: '{}' }, 30_000);
          if (s.estado === 'listo') {
            vibrar('exito');
            reiniciar();
            await refrescar();
            return;
          }
          fallos = 0;
          sondeo.current = setTimeout(preguntar, Math.max(3, r.intervalo) * 1000);
        } catch (e: any) {
          // Microsoft tardó (502) o se fue la red: el código sigue vivo, se vuelve a preguntar unas veces.
          if ((e?.status === 502 || !e?.status) && ++fallos <= 3) {
            sondeo.current = setTimeout(preguntar, Math.max(5, r.intervalo) * 1000);
            return;
          }
          setCodigo(null);
          setError(e?.message || tr('Microsoft no lo aceptó.', 'Microsoft didn’t accept it.'));
        }
      };
      sondeo.current = setTimeout(preguntar, Math.max(3, r.intervalo) * 1000);
    } catch (e: any) {
      setError(e?.message || tr('No pude pedir el código a Microsoft.', 'I couldn’t get the code from Microsoft.'));
    } finally {
      setOcupado(false);
    }
  };

  const quitar = async (id: string) => {
    try {
      await api(`/api/correo/cuentas/${encodeURIComponent(id)}`, { method: 'DELETE' }, 10_000);
      vibrar('medio');
      await refrescar();
    } catch (e: any) {
      setError(e?.message || '');
    }
  };

  const esMs = prov?.auth === 'microsoft';

  /** Escribir los servidores a mano, empezando con los que adivinó el servidor (se pueden cambiar). */
  const aMano = (p: Proveedor | null = prov) => {
    setManual(true);
    if (!p) return;
    setImapHost((h) => h || p.imap.host);
    setSmtpHost((h) => h || p.smtp.host);
    setImapPuerto((x) => x || '993');
    setSmtpPuerto((x) => x || '465');
  };

  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      titulo={tr('Tus correos', 'Your email')}
      subtitulo={tr('AURA los revisa y te ayuda a contestar. Nunca manda nada sin que le digas que sí.', 'AURA checks them and helps you reply. She never sends anything until you say yes.')}
    >
      <View style={{ gap: MEDIDA.espacio.l }}>
        {!!cuentas?.length && (
          <View style={{ gap: MEDIDA.espacio.s }}>
            {cuentas.map((c) => (
              <View key={c.id} style={s.fila}>
                <View style={{ flex: 1 }}>
                  <Texto v="cuerpo" numberOfLines={1}>
                    {c.correo}
                  </Texto>
                  <Texto v="mini" color="texto3">
                    {c.proveedor.nombre}
                  </Texto>
                </View>
                <Boton titulo={tr('Quitar', 'Remove')} variante="fantasma" tam="chico" onPress={() => void quitar(c.id)} />
              </View>
            ))}
          </View>
        )}

        {codigo ? (
          <View style={{ gap: MEDIDA.espacio.m, alignItems: 'center' }}>
            <Texto v="chica" color="texto2">
              {tr('Abre la página de Microsoft y escribe este código:', 'Open Microsoft’s page and type this code:')}
            </Texto>
            <Texto v="titulo" style={s.codigo} selectable>
              {codigo.codigo}
            </Texto>
            <Boton titulo={tr('Abrir microsoft.com/devicelogin', 'Open microsoft.com/devicelogin')} icono="enlace" onPress={() => void Linking.openURL(codigo.url)} />
            <Texto v="mini" color="texto3">
              {tr('Te espero aquí: en cuanto entres, queda conectado.', 'I’ll wait here: once you sign in, it’s connected.')}
            </Texto>
          </View>
        ) : (
          <View style={{ gap: MEDIDA.espacio.m }}>
            <Campo
              etiqueta={tr('Tu dirección de correo', 'Your email address')}
              value={correo}
              onChangeText={(t) => {
                setCorreo(t);
                setProv(null);
                setError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onSubmitEditing={() => void detectar()}
            />
            {!prov ? (
              <Boton titulo={tr('Continuar', 'Continue')} cargando={ocupado} deshabilitado={!/@.+\./.test(correo)} onPress={() => void detectar()} />
            ) : (
              <>
                <Texto v="chica" color="texto2">
                  {prov.nombre} · {prov.ayuda}
                </Texto>
                {esMs ? (
                  microsoft ? (
                    <Boton titulo={tr('Entrar con Microsoft', 'Sign in with Microsoft')} cargando={ocupado} onPress={() => void conMicrosoft()} />
                  ) : (
                    <Texto v="chica" color="aviso">
                      {tr('Outlook con Microsoft no está activado en este servidor. Mientras tanto, conéctalo con «Otro» y una contraseña de aplicación de Outlook.', 'Outlook with Microsoft isn’t enabled on this server. Meanwhile, connect it with “Other” and an Outlook app password.')}
                    </Texto>
                  )
                ) : (
                  <>
                    <Campo etiqueta={tr('Clave (o contraseña de aplicación)', 'Password (or app password)')} clave value={clave} onChangeText={setClave} autoCapitalize="none" autoCorrect={false} />
                    {manual && (
                      <>
                        <Texto v="mini" color="texto3">
                          {tr(
                            `Ya puse lo de casi todo hosting (cPanel): ${prov.imap.host}, puertos 993 y 465, y como usuario tu correo completo. Cámbialo solo si quien administra tu dominio te dio otros datos.`,
                            `I filled in what most hosting uses (cPanel): ${prov.imap.host}, ports 993 and 465, and your full address as the user. Change it only if whoever runs your domain gave you other details.`
                          )}
                        </Texto>
                        <Campo etiqueta={tr('Servidor de entrada (IMAP)', 'Incoming server (IMAP)')} value={imapHost} onChangeText={setImapHost} autoCapitalize="none" placeholder={prov.imap.host} />
                        <Campo etiqueta={tr('Puerto de entrada', 'Incoming port')} value={imapPuerto} onChangeText={(t) => setImapPuerto(t.replace(/\D/g, '').slice(0, 5))} keyboardType="number-pad" placeholder="993" />
                        <Campo etiqueta={tr('Servidor de salida (SMTP)', 'Outgoing server (SMTP)')} value={smtpHost} onChangeText={setSmtpHost} autoCapitalize="none" placeholder={prov.smtp.host} />
                        <Campo etiqueta={tr('Puerto de salida', 'Outgoing port')} value={smtpPuerto} onChangeText={(t) => setSmtpPuerto(t.replace(/\D/g, '').slice(0, 5))} keyboardType="number-pad" placeholder="465" />
                      </>
                    )}
                    {!!error && (
                      <Texto v="chica" color="aviso">
                        {error}
                      </Texto>
                    )}
                    <Boton
                      titulo={tr('Conectar', 'Connect')}
                      cargando={ocupado}
                      textoCargando={tr('Probando…', 'Testing…')}
                      deshabilitado={!clave || (manual && (!imapHost.trim() || !smtpHost.trim()))}
                      onPress={() => void conectar()}
                    />
                    {!manual && prov.fuente === 'adivinado' && (
                      <Boton titulo={tr('Ver o cambiar los servidores', 'See or change the servers')} variante="fantasma" tam="chico" onPress={() => aMano()} />
                    )}
                  </>
                )}
              </>
            )}
          </View>
        )}
        {!!error && (codigo || !prov || esMs) && (
          <Texto v="chica" color="aviso">
            {error}
          </Texto>
        )}
      </View>
    </Hoja>
  );
}

const puertoOk = (p: string) => /^\d{1,5}$/.test(p) && Number(p) > 0 && Number(p) < 65536;

const s = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codigo: { fontSize: 32, letterSpacing: 6 },
});
