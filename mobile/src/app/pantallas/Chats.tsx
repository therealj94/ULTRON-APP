/**
 * Las rutas del chat PULSE2CHAT: la lista de conversaciones y el hilo con una persona, como
 * pantallas nativas de la pila (deslizar para volver, la compañera AURA sigue encima).
 *
 * Las pantallas son del chat (src/pulse): aquí solo se les dice cómo moverse. Avisan ellas mismas
 * al bus en qué pantalla está la persona y con quién (`emitir('pantalla', {pantalla:'chats', chatAbierto})`)
 * al abrirse; al VOLVER a una de ellas (se cerró Ajustes encima, o el hilo encima de la lista) lo
 * vuelve a avisar esta ruta, que sabe cuándo recupera el foco. Sin eso, AURA creía seguir en Ajustes
 * y no se ponía al lado del chat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PantallaConversacion } from '../../pulse';
import { ChatsConWhatsapp } from '../../whatsapp/ChatsConWhatsapp';
import { emitir, type Eventos } from '../../nucleo/contrato';
import type { RaizParams } from '../rutas';

/** Al recuperar el foco (no al abrirse: eso lo avisa la pantalla), se vuelve a decir dónde está. */
function useAvisarAlVolver(aviso: () => Eventos['pantalla']) {
  const primera = useRef(true);
  const f = useRef(aviso);
  f.current = aviso;
  useFocusEffect(
    useCallback(() => {
      if (primera.current) {
        primera.current = false;
        return;
      }
      emitir('pantalla', f.current());
    }, [])
  );
}

/**
 * «Abre WhatsApp» (app/acciones.ts → rutas.abrirWhatsapp): la ruta trae `whatsapp` con un número nuevo en
 * cada pedido. `enWhatsapp` de los chats cambia de pestaña cuando pasa a true; si ya estaba en true (se
 * pidió antes y la persona volvió a PULSE2CHAT), se baja y se vuelve a subir para que cambie otra vez.
 */
function usePestanaWhatsapp(pedido: number | undefined): boolean {
  const [en, setEn] = useState(!!pedido);
  const primero = useRef(true);
  useEffect(() => {
    if (primero.current) {
      primero.current = false;
      return;
    }
    if (!pedido) return;
    setEn(false);
    const t = setTimeout(() => setEn(true), 0);
    return () => clearTimeout(t);
  }, [pedido]);
  return en;
}

export function Chats({ navigation, route }: NativeStackScreenProps<RaizParams, 'Chats'>) {
  useAvisarAlVolver(() => ({ pantalla: 'chats', chatAbierto: null }));
  const enWhatsapp = usePestanaWhatsapp(route.params?.whatsapp);
  return (
    <ChatsConWhatsapp
      onAbrir={(correo, nombre) => navigation.push('Conversacion', { con: correo, nombre })}
      onAtras={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Mesa'))}
      enWhatsapp={enWhatsapp}
    />
  );
}

export function Conversacion({ route, navigation }: NativeStackScreenProps<RaizParams, 'Conversacion'>) {
  const correo = String(route.params.con || '').toLowerCase();
  useAvisarAlVolver(() => ({ pantalla: 'chats', chatAbierto: { correo, nombre: route.params.nombre || correo.split('@')[0] } }));
  return (
    <PantallaConversacion
      con={route.params.con}
      nombre={route.params.nombre}
      onAtras={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Chats'))}
    />
  );
}
