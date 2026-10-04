/**
 * EL COMPROBANTE DE UN PAGO EN EL HILO (mensaje de tipo «pago» que publica el relevo con `/pago`, después
 * de comprobar el hash contra la cadena): la cantidad, la nota y «Ver en OrdenScan».
 *
 * No pide que se confíe en nadie: la tarjeta vuelve a mirar la transacción en la cadena (solo lectura,
 * red.ts `verificarComprobante`) y dice «Verificado en la cadena» solo si pasó y es ESE envío (a la
 * dirección de quien recibe, esa cantidad, esa moneda). La dirección de quien recibe sale de su ficha (o
 * de tu cartera, si el pago es para ti); si no se sabe, dice que lo comprobó PULSE2CHAT.
 */
import { memo, useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import type { Mensaje } from '../pulse/relevo';
import { hora } from '../pulse/ui/formato';
import { Icono, Texto } from '../ui';
import { carteraConocida, direccionDe, miCartera } from './conexion';
import { esHash, EXPLORADOR_TX, montoValido, simbolo, type Veredicto } from './logica';
import { verificarComprobante } from './red';

type Estado = 'comprobando' | Veredicto | 'sin-red' | 'sin-direccion';

/** Lo ya comprobado, por hash: el hilo se redibuja seguido y la cadena no cambia de opinión. */
const comprobados = new Map<string, Estado>();

async function comprobar(m: Mensaje, yo: string): Promise<Estado> {
  const hash = String(m.hash || '').toLowerCase();
  const monto = montoValido(m.monto);
  const moneda = simbolo(m.moneda || 'ORIGEN');
  if (!esHash(hash) || !monto || !moneda) return 'no-coincide';
  const previo = comprobados.get(hash);
  if (previo && previo !== 'pendiente' && previo !== 'sin-red') return previo;
  const paraMi = !!yo && m.para === yo;
  const para = paraMi ? carteraConocida()?.direccion || (await miCartera().catch(() => null))?.direccion || null : await direccionDe(m.para);
  if (!para) return 'sin-direccion';
  try {
    const v = await verificarComprobante(hash, { para, monto, simbolo: moneda });
    comprobados.set(hash, v);
    return v;
  } catch {
    return 'sin-red';
  }
}

function TarjetaPagoBase({ m, mio, yo, anchoMax }: { m: Mensaje; mio: boolean; yo: string; anchoMax: number }) {
  const tema = useTema();
  const hash = esHash(m.hash) ? String(m.hash) : '';
  const [estado, setEstado] = useState<Estado>(() => comprobados.get(hash.toLowerCase()) || 'comprobando');

  useEffect(() => {
    let vivo = true;
    void comprobar(m, yo).then((e) => vivo && setEstado(e));
    return () => {
      vivo = false;
    };
  }, [m.hash, m.monto, m.moneda, m.para, yo]); // eslint-disable-line react-hooks/exhaustive-deps

  const bien = estado === 'ok';
  const mal = estado === 'fallo' || estado === 'no-coincide';
  const linea =
    estado === 'ok'
      ? tr('Verificado en la cadena de Orden Global', 'Verified on the Orden Global chain')
      : estado === 'fallo'
        ? tr('La cadena rechazó esta transacción', 'The chain rejected this transaction')
        : estado === 'no-coincide'
          ? tr('Este comprobante no coincide con la cadena', 'This receipt doesn’t match the chain')
          : estado === 'pendiente'
            ? tr('Esperando que la cadena la confirme', 'Waiting for the chain to confirm it')
            : estado === 'comprobando'
              ? tr('Comprobando en la cadena…', 'Checking on the chain…')
              : tr('Comprobado por PULSE2CHAT', 'Checked by PULSE2CHAT');

  return (
    <View style={{ alignItems: mio ? 'flex-end' : 'flex-start', marginTop: MEDIDA.espacio.s }}>
      <View
        style={{
          width: Math.min(280, anchoMax),
          borderRadius: MEDIDA.radio.l - 2,
          borderWidth: 1,
          borderColor: bien ? tema.exito : mal ? tema.aviso : tema.borde,
          backgroundColor: tema.superficie,
          padding: MEDIDA.espacio.m,
          gap: 4,
        }}
        accessible
        accessibilityLabel={`${mio ? tr('Enviaste', 'You sent') : tr('Recibiste', 'You received')} ${m.monto || '?'} ${m.moneda || 'ORIGEN'}. ${linea}`}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icono nombre="wallet" tam={15} color={tema.acentoTexto} />
          <Texto v="etiqueta" color="acentoTexto" style={{ flex: 1 }}>
            {mio ? tr('Enviaste', 'You sent') : tr('Recibiste', 'You received')}
          </Texto>
          <Texto v="mini" color="texto3">
            {hora(m.cuando)}
          </Texto>
        </View>
        <Texto v="titulo">
          {m.monto || '?'} {m.moneda || 'ORIGEN'}
        </Texto>
        {m.texto ? (
          <Texto v="chica" color="texto2">
            {m.texto}
          </Texto>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {bien ? <Icono nombre="check" tam={14} color={tema.exito} /> : mal ? <Icono nombre="alerta" tam={14} color={tema.aviso} /> : null}
          <Texto v="mini" color={bien ? 'exito' : mal ? 'aviso' : 'texto3'} style={{ flex: 1 }}>
            {linea}
          </Texto>
        </View>
        {hash ? (
          <Pressable onPress={() => void Linking.openURL(EXPLORADOR_TX + hash).catch(() => undefined)} accessibilityRole="link" hitSlop={8}>
            <Texto v="chicaFuerte" color="acentoTexto">
              {tr('Ver en OrdenScan', 'View on OrdenScan')} ›
            </Texto>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export const TarjetaPago = memo(TarjetaPagoBase);
