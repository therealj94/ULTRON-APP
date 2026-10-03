/**
 * (c) EL MINIRESULTADO: la primera petición, armada con el objetivo y la restricción (flujo.ts
 * peticionInicial), a la vista y comprobable antes de configurar nada más. El botón de abajo («Usar mi
 * petición ahora») termina la primera vez y la deja escrita en la mesa, para revisarla y mandarla; aquí,
 * «Personalizar primero» sigue con el apodo, el avatar y lo demás (y al final la petición sigue ahí).
 * También dice cómo corregir lo que AURA sepa, ver lo que hace y detenerlo.
 */
import { View } from 'react-native';
import { tr, useIdioma } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Boton, Icono, Tarjeta, Texto } from '../../ui';
import { EncabezadoPaso } from '../piezas';
import { objetivoDe, peticionInicial } from '../flujo';
import type { PropsPaso } from './tipos';

export function PasoListo({ borrador, avanzar }: PropsPaso) {
  const idioma = useIdioma();
  const tema = useTema();
  const peticion = peticionInicial(borrador, idioma === 'en' ? 'en' : 'es');
  const o = objetivoDe(borrador);
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso
        etiqueta={tr('Listo para empezar', 'Ready to start')}
        titulo={tr('Tu primera petición', 'Your first request')}
        texto={tr('Al entrar a la mesa queda escrita: la revisas y la mandas. Nada se compra ni se manda a nadie sin tu «sí».', 'When you reach the desk it’s already typed: review it and send it. Nothing is bought or sent to anyone without your “yes”.')}
      />
      <Aparecer retraso={140}>
        <Tarjeta relleno={MEDIDA.espacio.l} style={{ borderColor: tema.acento }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <Icono nombre={o?.icono || 'chispas'} tam={22} color={tema.acentoTexto} />
            <Texto v="cuerpo" style={{ flex: 1 }} accessibilityLabel={tr(`Tu petición: ${peticion}`, `Your request: ${peticion}`)}>
              {peticion}
            </Texto>
          </View>
        </Tarjeta>
      </Aparecer>
      {!!o?.conexion && (
        <Aparecer retraso={180}>
          <Texto v="chica" color="texto2">
            {tr('Si no conectaste la cuenta, pega en la mesa solo el texto que quieras usar.', 'If you didn’t connect the account, paste just the text you want to use at the desk.')}
          </Texto>
        </Aparecer>
      )}
      <Aparecer retraso={220}>
        <Texto v="chica" color="texto3">
          {tr(
            'Lo que me cuentes lo ves, corriges o borras en Ajustes → Lo que AURA sabe de ti. Lo que estoy haciendo se ve en la mesa, y lo detienes cuando quieras.',
            'Whatever you tell me, you can see, fix or erase in Settings → What AURA knows about you. What I’m doing shows at the desk, and you can stop it anytime.'
          )}
        </Texto>
      </Aparecer>
      <Aparecer retraso={260}>
        <Boton titulo={tr('Personalizar primero', 'Personalize first')} variante="fantasma" iconoDerecha="flecha" onPress={avanzar} />
      </Aparecer>
    </View>
  );
}
