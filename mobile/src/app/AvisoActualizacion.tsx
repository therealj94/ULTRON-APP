/**
 * La pastilla de la actualización por aire, arriba al centro y chiquita:
 *
 *   «Actualización lista · Reiniciar»  hay una OTA descargada; tocar recarga ya, salvo que haya algo
 *                                      en curso (lib/barreraOta.ts): entonces se dice qué, un momento.
 *                                      Si nadie la toca, se aplica sola en un momento seguro (lib/ota.ts).
 *   «Instala la APK nueva»             la APK publicada trae otro nativo: lo nuevo ya no llega por aire.
 */
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { tr, useIdioma } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Texto } from '../ui';
import { URL_APK, aplicarAhora, useApkNueva } from '../lib/ota';

/** El primer motivo, dicho como persona. */
function porQueNo(motivos: string[]): string {
  const m = motivos[0] || '';
  if (m.startsWith('llamada')) return tr('hay una llamada en curso', 'a call is in progress');
  if (m === 'voz' || m === 'conversacion-aura') return tr('estás hablando con AURA', 'you’re talking to AURA');
  if (m === 'aura-habla') return tr('AURA está hablando', 'AURA is speaking');
  if (m === 'borrador-chat') return tr('tienes un borrador sin enviar', 'you have an unsent draft');
  if (m === 'teclado') return tr('estás escribiendo', 'you’re typing');
  if (m === 'recordatorio-sonando') return tr('suena un recordatorio', 'a reminder is ringing');
  return tr('hay algo en curso', 'something is in progress');
}

export function AvisoActualizacion() {
  useIdioma();
  const tema = useTema();
  const bordes = useSafeAreaInsets();
  const { isUpdatePending } = Updates.useUpdates();
  const apkNueva = useApkNueva();
  const [ahoraNo, setAhoraNo] = useState('');

  useEffect(() => {
    if (!ahoraNo) return;
    const t = setTimeout(() => setAhoraNo(''), 4_000);
    return () => clearTimeout(t);
  }, [ahoraNo]);

  if (__DEV__ || !Updates.isEnabled || (!isUpdatePending && !apkNueva)) return null;

  // Con OTA lista, primero esa: lo que trae llega sin instalar nada.
  const texto = ahoraNo
    ? tr(`Ahora no: ${ahoraNo}. Se reinicia sola al terminar.`, `Not now: ${ahoraNo}. It will restart on its own afterwards.`)
    : isUpdatePending
      ? tr('Actualización lista · Reiniciar', 'Update ready · Restart')
      : tr('Instala la APK nueva', 'Install the new APK');
  const tocar = () => {
    if (!isUpdatePending) return void Linking.openURL(URL_APK).catch(() => {});
    const motivos = aplicarAhora();
    if (motivos.length) setAhoraNo(porQueNo(motivos));
  };

  return (
    <View pointerEvents="box-none" style={[s.capa, { top: bordes.top + MEDIDA.espacio.s }]}>
      <Pressable
        onPress={tocar}
        accessibilityRole="button"
        accessibilityLabel={texto}
        hitSlop={6}
        style={[s.pastilla, { backgroundColor: tema.superficie, borderColor: isUpdatePending ? tema.acento : tema.aviso }]}
      >
        <Texto v="chica" color={isUpdatePending ? 'acentoTexto' : 'aviso'} numberOfLines={2} centro>
          {texto}
        </Texto>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  capa: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pastilla: { maxWidth: 420, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, opacity: 0.94 },
});
