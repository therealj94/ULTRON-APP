/**
 * UNA BURBUJA DEL HILO: el texto, la foto en grande, la hora y las palomitas, y cada marca con la
 * verdad de su sobre —«sin cifrar» si viajó en claro, «firma sin verificar» si el sobre abrió pero la
 * firma no es de las llaves publicadas de quien escribió, «cifrado para otro de tus aparatos» si este
 * teléfono no tenía sobre—.
 *
 * La última del grupo lleva COLA (el truco de siempre: una gota del color de la burbuja y encima una
 * máscara del color del fondo que la curva). La hora va DENTRO del renglón final, como en las apps de
 * mensajería buenas: un hueco invisible al final del texto le guarda el sitio.
 */
import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { Letra as Text } from '../../ui/Letra';
import { MEDIDA, useTema, type Paleta } from '../../nucleo/tema';
import { tr } from '../../i18n';
import * as RELEVO from '../relevo';
import { hora, type Fila } from './formato';
import { TarjetaPago } from '../../cartera/TarjetaPago';

type FilaMsg = Extract<Fila, { tipo: 'msg' }>;

type Props = {
  fila: FilaMsg;
  anchoMax: number;
  onReintentar?: (id: string) => void;
  onDescartar?: (id: string) => void;
  onVerFoto?: (uri: string) => void;
};

/** Las palomitas: reloj mientras viaja, una cuando el relevo la tiene, dos cuando la otra persona la vio. */
function Palomitas({ pendiente, leido, color }: { pendiente?: boolean; leido: boolean; color: string }) {
  if (pendiente) {
    return (
      <View
        style={{
          width: 11,
          height: 11,
          borderRadius: 5.5,
          borderWidth: 1.3,
          borderColor: color,
          marginLeft: 4,
          opacity: 0.8,
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: 3.6,
            top: 1.4,
            width: 1.3,
            height: 3.6,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 3.6,
            top: 4.2,
            width: 3,
            height: 1.3,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }
  return (
    <Text
      style={{
        color,
        fontSize: 12,
        fontWeight: leido ? '800' : '600',
        marginLeft: 4,
        letterSpacing: leido ? -4.5 : 0,
        paddingRight: leido ? 4.5 : 0,
        opacity: leido ? 1 : 0.75,
      }}
      allowFontScaling={false}
      accessibilityLabel={leido ? tr('Leído', 'Read') : tr('Enviado', 'Sent')}
    >
      {leido ? '✓✓' : '✓'}
    </Text>
  );
}

function FotoMensaje({ m, ancho, onVer, p }: { m: RELEVO.Mensaje; ancho: number; onVer?: (uri: string) => void; p: Paleta }) {
  const [uri, setUri] = useState<string | null | undefined>(undefined);
  const [prop, setProp] = useState(1);
  useEffect(() => {
    let vivo = true;
    if (!m.archivo) {
      setUri(null);
      return;
    }
    void RELEVO.archivoAbierto(m.archivo, m.llaveArchivo, m.ivArchivo).then((u) => {
      if (!vivo) return;
      setUri(u);
      if (u)
        Image.getSize(
          u,
          (w, h) => vivo && w > 0 && h > 0 && setProp(Math.min(1.4, Math.max(0.6, h / w))),
          () => undefined,
        );
    });
    return () => {
      vivo = false;
    };
  }, [m.archivo, m.llaveArchivo, m.ivArchivo]);
  const alto = Math.round(ancho * prop);
  if (uri === undefined) {
    return (
      <View
        style={{
          width: ancho,
          height: ancho * 0.75,
          borderRadius: MEDIDA.radio.m - 4,
          backgroundColor: p.superficie2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={p.acento} />
      </View>
    );
  }
  if (!uri) {
    return (
      <View
        style={{
          width: ancho,
          height: 90,
          borderRadius: MEDIDA.radio.m - 4,
          backgroundColor: p.superficie2,
          alignItems: 'center',
          justifyContent: 'center',
          padding: MEDIDA.espacio.m,
        }}
      >
        <Text
          style={{
            color: p.texto3,
            fontSize: MEDIDA.letra.chica,
            textAlign: 'center',
          }}
        >
          {tr('No se pudo abrir la foto', 'Couldn’t open the photo')}
        </Text>
      </View>
    );
  }
  return (
    <Pressable onPress={() => onVer?.(uri)} accessibilityRole="imagebutton" accessibilityLabel={tr('Ver foto', 'View photo')}>
      <Image
        source={{ uri }}
        style={{
          width: ancho,
          height: alto,
          borderRadius: MEDIDA.radio.m - 4,
          backgroundColor: p.superficie2,
        }}
        resizeMode="cover"
      />
    </Pressable>
  );
}

function BurbujaBase({ fila, anchoMax, onReintentar, onDescartar, onVerFoto }: Props) {
  const p = useTema();
  const { m, mio, primera, ultima, leido } = fila;
  // El comprobante de un pago (cartera/): su tarjeta, que vuelve a mirar la cadena. Yo soy quien lo mandó o lo recibió.
  if (m.tipo === 'pago' && !m.borrado) return <TarjetaPago m={m} mio={mio} yo={mio ? m.de : m.para} anchoMax={anchoMax} />;
  const fondo = mio ? p.burbujaMia : p.burbujaOtro;
  const letra = mio ? p.textoMia : p.textoOtro;
  const tenue = mio ? p.textoMia : p.texto3;
  const esFoto = m.tipo === 'imagen' && !m.borrado && !m.cerrado;
  const marca = m.borrado
    ? ''
    : m.e2e === false
      ? tr('sin cifrar', 'unencrypted')
      : m.e2e && m.verificado === false && !m.cerrado
        ? '⚠ ' + tr('firma sin verificar', 'unverified signature')
        : '';
  const h = hora(m.cuando);
  const meta = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {!!marca && (
        <Text
          style={{
            color: mio ? tenue : p.aviso,
            fontSize: 11,
            opacity: mio ? 0.8 : 1,
            marginRight: 4,
          }}
        >
          {marca}
        </Text>
      )}
      <Text style={{ color: tenue, fontSize: 11, opacity: mio ? 0.75 : 1 }} allowFontScaling={false}>
        {h}
      </Text>
      {mio && !m.fallido ? <Palomitas pendiente={m.pendiente} leido={leido} color={letra} /> : null}
    </View>
  );
  // El hueco invisible que le guarda el sitio a la hora al final del último renglón.
  // Se mide a ojo lo que ocupa la hora (y la marca y las palomitas) en espacios «eme» del texto (16 px).
  const anchoMeta = h.length * 5.6 + (marca ? marca.length * 5.6 + 4 : 0) + (mio ? 18 : 0) + 2;
  const hueco = '\u2003'.repeat(Math.ceil(anchoMeta / 16));
  const radio = MEDIDA.radio.l - 4;
  const r = { tl: radio, tr: radio, bl: radio, br: radio };
  // Pegadas al mismo lado: la esquina de ese lado se achica, como un solo bloque.
  if (mio) {
    if (!primera) r.tr = 6;
    if (!ultima) r.br = 6;
    else r.br = 4;
  } else {
    if (!primera) r.tl = 6;
    if (!ultima) r.bl = 6;
    else r.bl = 4;
  }
  const anchoFoto = Math.min(260, anchoMax - 8);

  const cuerpo = m.borrado ? (
    <Text
      style={{
        color: tenue,
        fontStyle: 'italic',
        fontSize: MEDIDA.letra.cuerpo - 1,
        opacity: 0.85,
      }}
    >
      {tr('Mensaje borrado', 'Message deleted')}
      <Text style={{ color: 'transparent' }}>{hueco}</Text>
    </Text>
  ) : m.cerrado ? (
    <Text
      style={{
        color: tenue,
        fontStyle: 'italic',
        fontSize: MEDIDA.letra.cuerpo - 1,
        opacity: 0.9,
      }}
    >
      {'🔒 ' + tr('Cifrado para otro de tus aparatos', 'Encrypted for another of your devices')}
      <Text style={{ color: 'transparent' }}>{hueco}</Text>
    </Text>
  ) : (
    <>
      {esFoto ? <FotoMensaje m={m} ancho={anchoFoto} onVer={onVerFoto} p={p} /> : null}
      {m.texto ? (
        <Text
          selectable
          style={{
            color: letra,
            fontSize: MEDIDA.letra.cuerpo + 1,
            lineHeight: 22,
            marginTop: esFoto ? 6 : 0,
            paddingHorizontal: esFoto ? 4 : 0,
          }}
        >
          {m.texto}
          <Text style={{ color: 'transparent' }}>{hueco}</Text>
        </Text>
      ) : !esFoto ? (
        <Text style={{ color: letra }}>{hueco}</Text>
      ) : null}
    </>
  );

  return (
    <View
      style={{
        alignItems: mio ? 'flex-end' : 'flex-start',
        marginTop: primera ? MEDIDA.espacio.s : 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {mio && m.fallido ? (
          <Pressable
            onPress={() => onReintentar?.(m.id)}
            onLongPress={() => onDescartar?.(m.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={tr('Reintentar el envío', 'Retry sending')}
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: p.aviso,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: MEDIDA.espacio.s,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>!</Text>
          </Pressable>
        ) : null}
        <View
          style={{
            maxWidth: anchoMax,
            backgroundColor: fondo,
            borderTopLeftRadius: r.tl,
            borderTopRightRadius: r.tr,
            borderBottomLeftRadius: r.bl,
            borderBottomRightRadius: r.br,
            paddingHorizontal: esFoto ? 4 : 12,
            paddingTop: esFoto ? 4 : 7,
            paddingBottom: esFoto ? (m.texto ? 7 : 4) : 7,
            opacity: m.pendiente ? 0.92 : 1,
          }}
        >
          {ultima ? (
            mio ? (
              <>
                <View
                  style={{
                    position: 'absolute',
                    backgroundColor: fondo,
                    width: 20,
                    height: 25,
                    bottom: 0,
                    right: -10,
                    borderBottomLeftRadius: 25,
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    backgroundColor: p.fondo,
                    width: 20,
                    height: 35,
                    bottom: -6,
                    right: -20,
                    borderBottomLeftRadius: 18,
                  }}
                />
              </>
            ) : (
              <>
                <View
                  style={{
                    position: 'absolute',
                    backgroundColor: fondo,
                    width: 20,
                    height: 25,
                    bottom: 0,
                    left: -10,
                    borderBottomRightRadius: 25,
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    backgroundColor: p.fondo,
                    width: 20,
                    height: 35,
                    bottom: -6,
                    left: -20,
                    borderBottomRightRadius: 18,
                  }}
                />
              </>
            )
          ) : null}
          {cuerpo}
          <View
            style={
              esFoto && !m.texto
                ? {
                    position: 'absolute',
                    right: 10,
                    bottom: 9,
                    backgroundColor: 'rgba(0,0,0,0.42)',
                    borderRadius: 10,
                    paddingHorizontal: 7,
                    paddingVertical: 2,
                  }
                : { position: 'absolute', right: 10, bottom: 5 }
            }
          >
            {esFoto && !m.texto ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 11 }}>{h}</Text>
                {mio && !m.fallido ? <Palomitas pendiente={m.pendiente} leido={leido} color="#fff" /> : null}
              </View>
            ) : (
              meta
            )}
          </View>
        </View>
      </View>
      {mio && m.fallido ? (
        // Un mensaje que no salió lo dice y trae sus botones (auditoría A10): «Reintentar» a la vista, y «Quitar».
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: MEDIDA.espacio.s, marginTop: MEDIDA.espacio.xs, marginRight: 4 }} accessibilityLiveRegion="polite">
          <Text style={{ color: p.aviso, fontSize: MEDIDA.letra.chica, fontWeight: '600' }}>{tr('No se envió', 'Not sent')}</Text>
          <Pressable
            onPress={() => onReintentar?.(m.id)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={tr('Reintentar el envío', 'Retry sending')}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: MEDIDA.espacio.m, borderRadius: MEDIDA.radio.redondo, backgroundColor: p.avisoFondo, borderWidth: 1, borderColor: p.aviso, opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ color: p.aviso, fontSize: MEDIDA.letra.chica, fontWeight: '700' }}>↻ {tr('Reintentar', 'Retry')}</Text>
          </Pressable>
          <Pressable onPress={() => onDescartar?.(m.id)} hitSlop={6} accessibilityRole="button" accessibilityLabel={tr('Quitar el mensaje que no salió', 'Remove the unsent message')} style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 }}>
            <Text style={{ color: p.texto3, fontSize: MEDIDA.letra.chica, fontWeight: '600' }}>{tr('Quitar', 'Remove')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Una burbuja no se vuelve a pintar si su mensaje y su lugar en el grupo no cambiaron. */
export const Burbuja = memo(
  BurbujaBase,
  (a, b) =>
    a.fila.m === b.fila.m &&
    a.fila.primera === b.fila.primera &&
    a.fila.ultima === b.fila.ultima &&
    a.fila.leido === b.fila.leido &&
    a.anchoMax === b.anchoMax &&
    a.onReintentar === b.onReintentar &&
    a.onVerFoto === b.onVerFoto,
);
