/**
 * Las rutas del chat PULSE2CHAT: la lista de conversaciones y el hilo con una persona, como
 * pantallas nativas de la pila (deslizar para volver, la compañera AURA sigue encima).
 *
 * Las pantallas son del chat (src/pulse): aquí solo se les dice cómo moverse. Avisan ellas mismas
 * al bus en qué pantalla está la persona y con quién (`emitir('pantalla', {pantalla:'chats', chatAbierto})`).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PantallaChats, PantallaConversacion } from '../../pulse';
import type { RaizParams } from '../rutas';

export function Chats({ navigation }: NativeStackScreenProps<RaizParams, 'Chats'>) {
  return (
    <PantallaChats
      onAbrir={(correo, nombre) => navigation.push('Conversacion', { con: correo, nombre })}
      onAtras={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Mesa'))}
    />
  );
}

export function Conversacion({ route, navigation }: NativeStackScreenProps<RaizParams, 'Conversacion'>) {
  return (
    <PantallaConversacion
      con={route.params.con}
      nombre={route.params.nombre}
      onAtras={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Chats'))}
    />
  );
}
