/**
 * La ruta «Otras formas de entrar»: la entrada con correo y clave (src/screens/LoginScreen.tsx), que
 * al verificar a la persona sigue el mismo camino que Genesis ID (perfil → primera vez o mesa).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LoginScreen } from '../../screens/LoginScreen';
import type { RaizParams } from '../rutas';
import { entrarCon } from '../sesion';

type Props = NativeStackScreenProps<RaizParams, 'OtrasFormas'>;

export function OtrasFormas({ navigation }: Props) {
  return <LoginScreen onAuthenticated={(u) => void entrarCon(u)} onAtras={() => navigation.goBack()} />;
}
