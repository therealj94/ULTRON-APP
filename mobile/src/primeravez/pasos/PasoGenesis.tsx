/**
 * (a) «Genesis ID compartió contigo»: el nombre y el cumpleaños que dio Genesis, cada uno con su
 * palomita ✔ que se dibuja en orden. Si el cumpleaños no vino, se pregunta (opcional); si no vino
 * nada, la pantalla es solo la pregunta del cumpleaños.
 */
import { StyleSheet, View } from 'react-native';
import { tr } from '../../i18n';
import { cumpleLegible } from '../../lib/perfil';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Icono, Palomita, Tarjeta, Texto, type NombreIcono } from '../../ui';
import { armarCumple, leerCumple, queCompartioGenesis } from '../flujo';
import { EncabezadoPaso, SelectorCumple } from '../piezas';
import type { PropsPaso } from './tipos';

function Dato({ icono, etiqueta, valor, retraso }: { icono: NombreIcono; etiqueta: string; valor: string; retraso: number }) {
  const tema = useTema();
  return (
    <Aparecer retraso={retraso}>
      <View style={s.dato}>
        <View style={[s.icono, { backgroundColor: tema.acentoFondo }]}>
          <Icono nombre={icono} tam={18} color={tema.acentoTexto} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Texto v="chica" color="texto3">
            {etiqueta}
          </Texto>
          <Texto v="subtitulo" numberOfLines={2}>
            {valor}
          </Texto>
        </View>
        <Palomita hecho animarAlMontar={retraso + 280} tam={30} color={tema.exito} colorMarca="#FFFFFF" />
      </View>
    </Aparecer>
  );
}

export function PasoGenesis({ perfil, borrador, cambiar }: PropsPaso) {
  const g = queCompartioGenesis(perfil);
  const hubo = !!(g.nombre || g.cumple);
  const c = leerCumple(borrador.cumple);
  const selector = (
    <SelectorCumple
      mes={c?.mes ?? null}
      dia={c?.dia ?? null}
      onCambiar={(mes, dia) => cambiar({ cumple: mes && dia ? armarCumple(mes, dia) : undefined })}
    />
  );
  if (!hubo) {
    return (
      <View style={{ gap: MEDIDA.espacio.xl }}>
        <EncabezadoPaso
          etiqueta={tr('Para empezar', 'To begin')}
          titulo={tr('¿Cuándo es tu cumpleaños?', 'When is your birthday?')}
          texto={tr('Es opcional. AURA te felicita ese día; el año no hace falta.', 'It’s optional. AURA will wish you a happy birthday; no year needed.')}
        />
        <Aparecer retraso={150}>{selector}</Aparecer>
        {!!borrador.cumple && (
          <Texto v="cuerpoFuerte" color="acentoTexto" centro>
            🎂 {cumpleLegible(borrador.cumple)}
          </Texto>
        )}
      </View>
    );
  }
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso
        etiqueta="Genesis ID"
        titulo={tr('Genesis ID compartió contigo', 'Genesis ID shared with you')}
        texto={tr('Con tu permiso, tu wallet le contó a AURA lo básico. Nada más.', 'With your permission, your wallet told AURA the basics. Nothing else.')}
      />
      <Tarjeta relleno={MEDIDA.espacio.l}>
        <View style={{ gap: MEDIDA.espacio.l }}>
          {!!g.nombre && <Dato icono="persona" etiqueta={tr('Tu nombre', 'Your name')} valor={g.nombre} retraso={120} />}
          {!!g.cumple && <Dato icono="pastel" etiqueta={tr('Tu cumpleaños', 'Your birthday')} valor={cumpleLegible(g.cumple)} retraso={320} />}
        </View>
      </Tarjeta>
      {g.preguntarCumple && (
        <Aparecer retraso={420} style={{ gap: MEDIDA.espacio.m }}>
          <Texto v="subtitulo">{tr('¿Y tu cumpleaños? (opcional)', 'And your birthday? (optional)')}</Texto>
          {selector}
        </Aparecer>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  dato: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icono: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
