/**
 * Ajustes → La mesa → «Cámara rápida (nueva)»: la cámara en vivo (modules/aura-camara) o la de fotos.
 * Solo se muestra donde existe (Android con la APK que la trae). Encendida por omisión; apagarla vuelve a
 * la cámara de fotos al momento (lib/guardiaCamara.ts avisa a la mesa). Debajo dice si el teléfono o el
 * servidor la tienen apagada, para que nadie la prenda y no vea cambio sin saber por qué.
 */
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { Fila, Interruptor } from '../ui';
import { ajusteCamaraRapida, estadoCamaraNueva, fijarCamaraRapida, prepararCamara } from '../lib/guardiaCamara';

export function FilaCamaraRapida() {
  const [valor, setValor] = useState<boolean | null>(null);
  const [estado, setEstado] = useState(() => estadoCamaraNueva());
  useEffect(() => {
    let vivo = true;
    void prepararCamara().then(() => ajusteCamaraRapida()).then((v) => {
      if (!vivo) return;
      setValor(v);
      setEstado(estadoCamaraNueva());
    });
    return () => {
      vivo = false;
    };
  }, []);
  if (!estado.disponible || valor === null) return null;
  const detalle = !estado.remota
    ? tr('Apagada por ahora desde el servidor: se usa la cámara de siempre.', 'Turned off for now from the server: the usual camera is used.')
    : estado.bloqueada
      ? tr('Apagada un rato en este teléfono: la app se cerró con ella. Se usa la cámara de siempre y vuelve a probarse sola.', 'Off for a while on this phone: the app closed while using it. The usual camera is used and it will retry on its own.')
      : estado.fallo
        ? tr('No anduvo en esta sesión: se usa la de siempre hasta reabrir la app.', 'It didn’t work this session: the usual camera is used until you reopen the app.')
        : tr('Ve y reconoce en tiempo real. Si notas algo raro, apágala y vuelve la de siempre.', 'Sees and recognizes in real time. If something looks off, turn it off to go back to the usual one.');
  return (
    <Fila
      titulo={tr('Cámara rápida (nueva)', 'Fast camera (new)')}
      detalle={detalle}
      icono="camara"
      derecha={
        <Interruptor
          valor={valor}
          onCambiar={(v) => {
            if (v === valor) return;
            setValor(v);
            void fijarCamaraRapida(v).then(() => setEstado(estadoCamaraNueva()));
          }}
          etiqueta={tr('Cámara rápida (nueva)', 'Fast camera (new)')}
        />
      }
    />
  );
}
