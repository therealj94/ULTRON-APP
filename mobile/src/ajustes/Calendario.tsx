/**
 * TU CALENDARIO: conectar Outlook / Microsoft 365 o Google para que AURA lea tu agenda y proponga eventos
 * (server/calendario.ts). Cada proveedor con su estado honesto (agenda/logica.ts): conectado (con la cuenta), hay que
 * volver a conectarlo, sin conectar, o falta configurarlo en el servidor (y entonces no hay botón: no se promete).
 *
 *   · Microsoft: un código para microsoft.com/devicelogin, como el correo (la misma app de Microsoft, con el permiso
 *     del calendario). Te espero aquí y queda conectado al entrar.
 *   · Google: se abre la página de Google en el navegador; al volver se pregunta otra vez al servidor.
 *   · El permiso se guarda cifrado en el servidor; aquí no se queda nada. «Desconectar» lo borra.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { tr, useIdioma } from '../i18n';
import { MEDIDA } from '../nucleo/tema';
import { Boton, Hoja, Texto, vibrar } from '../ui';
import { conectarGoogle, consultarMicrosoft, desconectarCalendario, estadoCalendario, iniciarMicrosoft } from '../agenda/api';
import { accionDe, sondeoMs, textoEstado, type EstadoCalendario, type ProveedorCal } from '../agenda/logica';

/** El estado de los calendarios (para la fila de Ajustes y la hoja). `sinLeer`: el servidor no contestó (no es «sin conectar»). */
export function useEstadoCalendario(abierta: boolean) {
  const [estado, setEstado] = useState<EstadoCalendario | null>(null);
  const [sinLeer, setSinLeer] = useState(false);
  const refrescar = useCallback(async () => {
    try {
      setEstado(await estadoCalendario());
      setSinLeer(false);
    } catch (e: any) {
      // 503 con cuerpo: «no pude leer tus calendarios» (el servidor lo dice); otra cosa: la red.
      setSinLeer(true);
    }
  }, []);
  useEffect(() => {
    void refrescar();
  }, [abierta, refrescar]);
  return { estado, sinLeer, refrescar };
}

export function HojaCalendario({ visible, onCerrar }: { visible: boolean; onCerrar: () => void }) {
  const idioma = useIdioma() === 'en' ? 'en' : 'es';
  const { estado, sinLeer, refrescar } = useEstadoCalendario(visible);
  const [ocupado, setOcupado] = useState<ProveedorCal | null>(null);
  const [error, setError] = useState('');
  const [codigo, setCodigo] = useState<{ codigo: string; url: string } | null>(null);
  const sondeo = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parar = () => {
    if (sondeo.current) clearTimeout(sondeo.current);
    sondeo.current = null;
  };
  useEffect(() => {
    if (!visible) {
      parar();
      setCodigo(null);
      setError('');
    }
    return parar;
  }, [visible]);

  const conMicrosoft = async () => {
    setError('');
    setOcupado('microsoft');
    try {
      const r = await iniciarMicrosoft();
      setCodigo({ codigo: r.codigo, url: r.url });
      let fallos = 0;
      const preguntar = async () => {
        try {
          const s = await consultarMicrosoft();
          if (s.estado === 'listo') {
            vibrar('exito');
            setCodigo(null);
            await refrescar();
            return;
          }
          fallos = 0;
          sondeo.current = setTimeout(preguntar, sondeoMs(r.intervalo));
        } catch (e: any) {
          if ((e?.status === 502 || !e?.status) && ++fallos <= 3) {
            sondeo.current = setTimeout(preguntar, sondeoMs(r.intervalo) + 2000);
            return;
          }
          setCodigo(null);
          setError(e?.message || tr('Microsoft no lo aceptó.', 'Microsoft didn’t accept it.'));
        }
      };
      sondeo.current = setTimeout(preguntar, sondeoMs(r.intervalo));
    } catch (e: any) {
      setError(e?.message || tr('No pude pedir el código a Microsoft.', 'I couldn’t get the code from Microsoft.'));
    } finally {
      setOcupado(null);
    }
  };

  const conGoogle = async () => {
    setError('');
    setOcupado('google');
    try {
      await conectarGoogle();
    } catch (e: any) {
      setError(e?.message || tr('No pude abrir Google.', 'I couldn’t open Google.'));
    } finally {
      // Volviera o no del navegador: lo que diga el servidor es la verdad.
      await refrescar();
      setOcupado(null);
    }
  };

  const desconectar = async (p: ProveedorCal) => {
    setError('');
    setOcupado(p);
    try {
      await desconectarCalendario(p);
      vibrar('medio');
    } catch (e: any) {
      setError(e?.message || tr('No pude desconectarlo.', 'I couldn’t disconnect it.'));
    } finally {
      await refrescar();
      setOcupado(null);
    }
  };

  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      titulo={tr('Calendario', 'Calendar')}
      subtitulo={tr('AURA lee tu agenda y te propone eventos. Nunca crea uno sin que le digas que sí.', 'AURA reads your schedule and suggests events. She never creates one until you say yes.')}
    >
      <View style={{ gap: MEDIDA.espacio.l }}>
        {(sinLeer || (estado && !estado.leidas)) && (
          <Texto v="chica" color="texto2">
            {tr('No pude leer tus calendarios ahora mismo. Si ya conectaste uno, sigue ahí: prueba en un rato antes de volver a conectarlo.', 'I couldn’t read your calendars right now. If you connected one, it’s still there: try again in a bit before connecting it again.')}
          </Texto>
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
            <Boton titulo={tr('Cancelar', 'Cancel')} variante="fantasma" tam="chico" onPress={() => (parar(), setCodigo(null))} />
          </View>
        ) : (
          (estado?.leidas ? estado.proveedores : []).map((p) => {
            const accion = accionDe(p);
            return (
              <View key={p.id} style={s.fila}>
                <View style={{ flex: 1 }}>
                  <Texto v="cuerpo">{p.nombre}</Texto>
                  <Texto v="mini" color={p.reconectar ? 'aviso' : 'texto3'}>
                    {textoEstado(p, idioma)}
                  </Texto>
                </View>
                {accion === 'desconectar' ? (
                  <Boton titulo={tr('Desconectar', 'Disconnect')} variante="fantasma" tam="chico" cargando={ocupado === p.id} onPress={() => void desconectar(p.id)} />
                ) : accion ? (
                  <Boton
                    titulo={accion === 'reconectar' ? tr('Reconectar', 'Reconnect') : tr('Conectar', 'Connect')}
                    tam="chico"
                    cargando={ocupado === p.id}
                    deshabilitado={!!ocupado}
                    onPress={() => void (p.id === 'microsoft' ? conMicrosoft() : conGoogle())}
                  />
                ) : null}
              </View>
            );
          })
        )}
        {!!error && (
          <Texto v="chica" color="aviso">
            {error}
          </Texto>
        )}
      </View>
    </Hoja>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  codigo: { fontSize: 32, letterSpacing: 6 },
});
