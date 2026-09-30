/**
 * PULSE2CHAT en una ventana (Modal): la lista de chats y la conversación de la 5.0, una encima de
 * otra, para quien todavía no las tiene en su navegación (la mesa de los avatares lo abre así).
 *
 * Es solo el envoltorio: todo lo que se ve es `PantallaChats` y `PantallaConversacion`. La
 * conversación entra deslizándose desde la derecha, «atrás» (el botón, el gesto del sistema o AURA
 * diciendo «vete atrás») vuelve a la lista, y desde la lista cierra la ventana.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { emitir, escuchar } from '../nucleo/contrato';
import { useTema } from '../nucleo/tema';
import * as RELEVO from './relevo';
import { PantallaChats } from './PantallaChats';
import { PantallaConversacion } from './PantallaConversacion';

type Vista = { tipo: 'lista' } | { tipo: 'hilo'; con: string; nombre?: string };

export function PulseChat({ visible, conInicial, onCerrar }: { visible: boolean; conInicial?: string; onCerrar: () => void }) {
  const p = useTema();
  const [vista, setVista] = useState<Vista>({ tipo: 'lista' });

  useEffect(() => {
    if (visible && conInicial) {
      const c = RELEVO.resolverContacto(conInicial);
      setVista({ tipo: 'hilo', con: c?.correo || conInicial, nombre: c?.nombre });
    }
    if (!visible) setVista({ tipo: 'lista' });
  }, [visible, conInicial]);

  const atras = () => (vista.tipo === 'hilo' ? setVista({ tipo: 'lista' }) : onCerrar());
  const atrasRef = useRef(atras);
  atrasRef.current = atras;

  // «Vete atrás» de AURA con la ventana abierta: la ventana es lo que se ve, así que retrocede ella.
  useEffect(() => {
    if (!visible) return;
    return escuchar('accion', (a) => {
      if (a.tipo !== 'atras') return;
      atrasRef.current();
      emitir('hecho', { accion: a, ok: true });
    });
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={atras} statusBarTranslucent navigationBarTranslucent>
      {/* Un modal es otra ventana: lleva su propio proveedor de márgenes seguros. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View style={{ flex: 1, backgroundColor: p.fondo }}>
          <PantallaChats onAbrir={(con, nombre) => setVista({ tipo: 'hilo', con, nombre })} onAtras={onCerrar} />
          {vista.tipo === 'hilo' ? (
            <Animated.View entering={SlideInRight.duration(260)} exiting={SlideOutRight.duration(220)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.fondo }}>
              <PantallaConversacion key={vista.con} con={vista.con} nombre={vista.nombre} onAtras={() => setVista({ tipo: 'lista' })} />
            </Animated.View>
          ) : null}
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
