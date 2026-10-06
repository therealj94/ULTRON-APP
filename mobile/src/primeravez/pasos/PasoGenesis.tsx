/**
 * (a) «Genesis ID compartió contigo»: el nombre y el cumpleaños que dio Genesis, cada uno con su
 * palomita ✔ que se dibuja en orden. Si el cumpleaños no vino, se pregunta (opcional); si no vino
 * nada, la pantalla es solo la pregunta del cumpleaños.
 *
 * La selección a medias (el mes sin el día) vive AQUÍ, no en el borrador: el borrador solo guarda fechas
 * completas. Antes el selector leía su mes de `borrador.cumple`, y como un mes solo no es fecha, el toque
 * se perdía: el mes no quedaba marcado y los días seguían apagados (José, 5-oct, en un Samsung: «no
 * podemos seleccionar las fechas de cumple»). Ahora el borrador recibe la fecha cuando está completa
 * (flujo.ts cumpleTrasCambio) y «Siguiente» sigue con fecha o sin ella.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { tr } from '../../i18n';
import { cumpleLegible } from '../../lib/perfil';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Icono, Palomita, Tarjeta, Texto, type NombreIcono } from '../../ui';
import { cumpleDeSeleccion, cumpleTrasCambio, queCompartioGenesis, seleccionDeCumple, type SeleccionCumple } from '../flujo';
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
  const [sel, setSel] = useState<SeleccionCumple>(() => seleccionDeCumple(borrador.cumple));
  // Si la fecha llega de fuera ya con el paso abierto (el perfil del servidor), se enseña elegida.
  useEffect(() => {
    if (borrador.cumple && borrador.cumple !== cumpleDeSeleccion(sel)) setSel(seleccionDeCumple(borrador.cumple));
    // Solo cuando cambia la fecha del borrador: la selección a medias es de la persona.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borrador.cumple]);
  const selector = (
    <SelectorCumple
      mes={sel.mes}
      dia={sel.dia}
      onCambiar={(mes, dia) => {
        const n = { mes, dia };
        setSel(n);
        const cumple = cumpleTrasCambio(borrador.cumple, n);
        if (cumple !== borrador.cumple) cambiar({ cumple });
      }}
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
