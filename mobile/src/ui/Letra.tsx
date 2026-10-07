/**
 * EL `Text` DE LA APP para las pantallas que se escribieron con `Text` y `fontWeight` sueltos (los chats,
 * WhatsApp y los correos): mismo uso que `Text` de React Native, pero con la letra de AU-RA (Manrope, en su
 * peso) en vez de Roboto (auditoría M5: los chats se veían con otra letra que el resto de la app).
 *
 * Cada `fontWeight` se vuelve su familia (`fuente()`, ui/tipografia.ts): en Android, ponerle `fontWeight` a una
 * familia con peso propio la engorda a mano. Un texto sin peso va en Manrope normal; uno dentro de otro texto
 * hereda el del de afuera (no se le fuerza el normal). Quien pida su propia familia (p. ej. monoespaciada) la
 * conserva. Sin las fuentes cargadas, el peso del sistema: se ve bien jerarquizado, nunca en blanco.
 *
 *   import { Letra as Text } from '../ui/Letra';
 */
import { createContext, forwardRef, useContext } from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { fuente, useFuentes, type Peso } from './tipografia';

const Dentro = createContext(false);

/** El peso de la escala para un `fontWeight` de React Native. */
export function pesoDe(w: TextStyle['fontWeight'] | undefined): Peso {
  const n = w === 'bold' ? 700 : w === 'normal' || w == null ? 400 : Number(w) || 400;
  if (n >= 800) return 'extra';
  if (n >= 700) return 'negrita';
  if (n >= 600) return 'semi';
  if (n >= 500) return 'medio';
  return 'regular';
}

export const Letra = forwardRef<Text, TextProps>(function Letra({ style, ...rest }, ref) {
  useFuentes();
  const dentro = useContext(Dentro);
  const plano = (StyleSheet.flatten(style) || {}) as TextStyle;
  const { fontWeight, fontFamily, ...resto } = plano;
  // Su propia familia: se respeta tal cual. Dentro de otro texto y sin peso: hereda. Si no, Manrope en su peso.
  const letra: TextStyle = fontFamily ? { fontFamily, fontWeight } : dentro && fontWeight == null ? {} : fuente(pesoDe(fontWeight));
  return (
    <Dentro.Provider value>
      <Text ref={ref} {...rest} style={[resto, letra]} />
    </Dentro.Provider>
  );
});
