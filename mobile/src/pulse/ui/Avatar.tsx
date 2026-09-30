/**
 * La cara de un contacto: su foto de perfil (la del relevo, que es pública) o sus iniciales sobre el
 * dorado suave del tema, con ANILLO cuando hay algo que mirar (mensajes sin leer) y el punto salvia
 * cuando está en línea.
 */
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useTema } from '../../nucleo/tema';
import * as RELEVO from '../relevo';
import { iniciales } from './formato';

type Props = {
  nombre: string;
  foto?: string;
  tam?: number;
  /** Anillo dorado alrededor (mensajes sin leer, solicitud nueva). */
  anillo?: boolean;
  enLinea?: boolean;
};

export function Avatar({ nombre, foto, tam = 52, anillo, enLinea }: Props) {
  const p = useTema();
  const [rota, setRota] = useState(false);
  const url = foto && /^[0-9a-f]{32}$/.test(foto) && !rota ? RELEVO.urlArchivo(foto) : '';
  const hueco = anillo ? 3 : 0;
  const cara = tam - hueco * 2 - (anillo ? 4 : 0);
  const punto = Math.max(10, Math.round(tam * 0.26));
  return (
    <View
      style={{
        width: tam,
        height: tam,
        borderRadius: tam / 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: anillo ? 2 : 0,
        borderColor: p.acento,
      }}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          onError={() => setRota(true)}
          style={{
            width: cara,
            height: cara,
            borderRadius: cara / 2,
            backgroundColor: p.superficie2,
          }}
        />
      ) : (
        <View
          style={{
            width: cara,
            height: cara,
            borderRadius: cara / 2,
            backgroundColor: p.acentoFondo,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: p.acentoTexto,
              fontSize: Math.round(cara * 0.38),
              fontWeight: '700',
              letterSpacing: 0.5,
            }}
            allowFontScaling={false}
          >
            {iniciales(nombre)}
          </Text>
        </View>
      )}
      {enLinea ? (
        <View
          style={{
            position: 'absolute',
            right: anillo ? 0 : -1,
            bottom: anillo ? 0 : -1,
            width: punto,
            height: punto,
            borderRadius: punto / 2,
            backgroundColor: p.exito,
            borderWidth: 2,
            borderColor: p.fondo,
          }}
        />
      ) : null}
    </View>
  );
}
