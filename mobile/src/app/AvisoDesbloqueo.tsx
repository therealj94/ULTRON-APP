/**
 * «Toca para desbloquear»: la sesión venció y la clave para renovarla está detrás de la huella, pero no se pudo pedir
 * (la intro no pregunta, lo de fondo tampoco, y tras cancelar hay 10 minutos de pausa: lib/permisoHuella.ts). Antes la
 * persona quedaba en la mesa con un token muerto, AU-RA muda, sin saber por qué. Ahora, una pastilla arriba en
 * cualquier pantalla de la sesión: al tocarla, la huella se pide YA (aunque estuviera en pausa) y la sesión se renueva.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tr, useIdioma } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Texto } from '../ui';
import { desbloquearSesion } from '../lib/api';
import { desbloqueoPendiente, escucharDesbloqueo } from '../lib/permisoHuella';
import { miga } from '../lib/reporte';

export function AvisoDesbloqueo() {
  useIdioma();
  const tema = useTema();
  const bordes = useSafeAreaInsets();
  const [pendiente, setPendiente] = useState(desbloqueoPendiente());
  const [estado, setEstado] = useState<'listo' | 'pidiendo' | 'fallo'>('listo');

  useEffect(() => {
    setPendiente(desbloqueoPendiente());
    return escucharDesbloqueo((p) => {
      setPendiente(p);
      if (!p) setEstado('listo');
    });
  }, []);

  if (!pendiente) return null;

  const texto =
    estado === 'pidiendo'
      ? tr('Pon tu huella…', 'Use your fingerprint…')
      : estado === 'fallo'
        ? tr('No se pudo. Toca para intentarlo de nuevo, o sal y entra con tu clave.', 'Didn’t work. Tap to try again, or sign out and use your password.')
        : tr('Tu sesión necesita tu huella · Toca para desbloquear', 'Your session needs your fingerprint · Tap to unlock');
  const tocar = async () => {
    if (estado === 'pidiendo') return;
    setEstado('pidiendo');
    miga('desbloqueo: la persona tocó «Toca para desbloquear»');
    const ok = await desbloquearSesion();
    setEstado(ok ? 'listo' : 'fallo');
  };

  return (
    <View pointerEvents="box-none" style={[s.capa, { top: bordes.top + MEDIDA.espacio.s + 40 }]}>
      <Pressable
        onPress={() => void tocar()}
        accessibilityRole="button"
        accessibilityLabel={texto}
        hitSlop={6}
        testID="toca-para-desbloquear"
        style={[s.pastilla, { backgroundColor: tema.superficie, borderColor: tema.aviso }]}
      >
        <Texto v="chica" color="aviso" numberOfLines={2} centro>
          {texto}
        </Texto>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  capa: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pastilla: { maxWidth: 420, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, opacity: 0.96 },
});
