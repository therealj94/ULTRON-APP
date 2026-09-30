/**
 * El texto de la app: variante de la escala + color del tema. Toda letra nueva pasa por aquí, así
 * la jerarquía es la misma en todas las pantallas y cambia de tema y de fuente sin tocar nada.
 *
 *   <Texto v="heroe">Hola, José</Texto>
 *   <Texto v="cuerpo" color="texto2">Lo que AURA sabe de ti</Texto>
 */
import { Text, type TextProps } from 'react-native';
import { useTema, type Paleta } from '../nucleo/tema';
import { estiloLetra, useFuentes, type Variante } from './tipografia';

type ColorTema = Exclude<keyof Paleta, 'oscuro'>;

type Props = TextProps & {
  v?: Variante;
  /** Un color del tema («texto2», «acentoTexto»…) o uno literal. */
  color?: ColorTema | (string & {});
  centro?: boolean;
};

export function Texto({ v = 'cuerpo', color = 'texto', centro, style, ...rest }: Props) {
  const tema = useTema();
  useFuentes();
  const c = (tema as Record<string, unknown>)[color];
  return (
    <Text
      maxFontSizeMultiplier={1.35}
      {...rest}
      style={[estiloLetra(v), { color: typeof c === 'string' ? c : color }, centro && { textAlign: 'center' }, style]}
    />
  );
}
