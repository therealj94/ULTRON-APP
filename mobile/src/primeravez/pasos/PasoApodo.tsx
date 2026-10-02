/**
 * (b) «¿Cómo quieres que te diga?»: el campo grande con el nombre ya puesto (el primero de Genesis),
 * y sugerencias de un toque. Debajo, cómo te va a saludar AURA, en vivo mientras escribes. También se
 * puede decir («dime Chepe»): lo dicho cae en el campo (flujo.ts apodoDeDictado). AURA lo recuerda: va al
 * perfil (`apodo`) y a «lo que sé de ti».
 */
import { View } from 'react-native';
import { tr } from '../../i18n';
import { primerNombre } from '../../lib/perfil';
import { MEDIDA } from '../../nucleo/tema';
import { Aparecer, Campo, Chip, Tarjeta, Texto } from '../../ui';
import { EncabezadoPaso } from '../piezas';
import { apodoDeDictado } from '../flujo';
import { ResponderHablando } from '../../bienvenida/ResponderHablando';
import type { PropsPaso } from './tipos';

export function PasoApodo({ perfil, borrador, cambiar, avanzar }: PropsPaso) {
  const nombre = primerNombre(perfil?.nombreGenesis) || perfil?.apodo || '';
  const sugerencias = [...new Set([nombre, tr('Jefe', 'Boss'), tr('Amigo', 'Buddy'), 'Don', 'Doña'].filter(Boolean))];
  const apodo = borrador.apodo.trim();
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <EncabezadoPaso etiqueta={tr('Tu nombre', 'Your name')} titulo={tr('¿Cómo quieres que te diga?', 'What should I call you?')} texto={tr('Así te va a llamar AURA. Lo cambias cuando quieras.', 'That’s what AURA will call you. Change it anytime.')} />
      <Aparecer retraso={140}>
        <Campo
          etiqueta={tr('Tu apodo', 'Your nickname')}
          grande
          value={borrador.apodo}
          onChangeText={(t) => cambiar({ apodo: t.slice(0, 40) })}
          placeholder={nombre || tr('Tu nombre', 'Your name')}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => apodo && avanzar()}
          maxLength={40}
        />
      </Aparecer>
      <Aparecer retraso={200}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {sugerencias.map((x) => (
            <Chip key={x} texto={x} activo={apodo === x} onPress={() => cambiar({ apodo: x })} tam="chico" />
          ))}
        </View>
      </Aparecer>
      <Aparecer retraso={240}>
        <ResponderHablando
          pistas={sugerencias}
          onDicho={(t) => {
            const a = apodoDeDictado(t);
            if (a) cambiar({ apodo: a });
          }}
        />
      </Aparecer>
      {!!apodo && (
        <Aparecer retraso={60} desde="escala">
          <Tarjeta relleno={MEDIDA.espacio.l}>
            <Texto v="chica" color="texto3">
              {tr('AURA te saludará así', 'AURA will greet you like this')}
            </Texto>
            <Texto v="subtitulo" color="acentoTexto" style={{ marginTop: 4 }}>
              {tr(`«¡Hola, ${apodo}! ¿Qué hacemos hoy?»`, `“Hi, ${apodo}! What are we doing today?”`)}
            </Texto>
          </Tarjeta>
        </Aparecer>
      )}
    </View>
  );
}
