/**
 * Ajustes → La mesa → «Voz en vivo (nueva)»: la voz que suena a medida que llega (modules/aura-voz) o la de siempre
 * (cada frase bajada entera). Solo se muestra donde existe (Android con la APK que la trae). Encendida por omisión;
 * apagarla vuelve a la de siempre desde la frase siguiente (lib/guardiaVoz.ts). Debajo dice si el teléfono o el
 * servidor la tienen apagada, para que nadie la prenda y no note cambio sin saber por qué.
 */
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { Fila, Interruptor } from '../ui';
import { ajusteVozEnVivo, estadoVozNueva, fijarVozEnVivo, prepararVoz, suscribirVoz } from '../lib/guardiaVoz';

export function FilaVozEnVivo() {
  const [valor, setValor] = useState<boolean | null>(null);
  const [estado, setEstado] = useState(() => estadoVozNueva());
  useEffect(() => {
    let vivo = true;
    void prepararVoz()
      .then(() => ajusteVozEnVivo())
      .then((v) => {
        if (!vivo) return;
        setValor(v);
        setEstado(estadoVozNueva());
      });
    const quitar = suscribirVoz(() => vivo && setEstado(estadoVozNueva()));
    return () => {
      vivo = false;
      quitar();
    };
  }, []);
  if (!estado.disponible || valor === null) return null;
  const detalle = !estado.remota
    ? tr('Apagada por ahora desde el servidor: se usa la voz de siempre.', 'Turned off for now from the server: the usual voice is used.')
    : estado.bloqueada
      ? tr('Apagada unos días en este teléfono: la app se cerró con ella. Se usa la voz de siempre.', 'Off for a few days on this phone: the app closed while using it. The usual voice is used.')
      : estado.fallo
        ? tr('No anduvo en esta sesión: se usa la de siempre hasta reabrir la app.', 'It didn’t work this session: the usual voice is used until you reopen the app.')
        : tr('Empieza a hablar sin esperar la frase entera. Si notas algo raro, apágala y vuelve la de siempre.', 'Starts speaking without waiting for the whole sentence. If something sounds off, turn it off to go back to the usual one.');
  return (
    <Fila
      titulo={tr('Voz en vivo (nueva)', 'Live voice (new)')}
      detalle={detalle}
      icono="volumen"
      derecha={
        <Interruptor
          valor={valor}
          onCambiar={(v) => {
            if (v === valor) return;
            setValor(v);
            void fijarVozEnVivo(v).then(() => setEstado(estadoVozNueva()));
          }}
          etiqueta={tr('Voz en vivo (nueva)', 'Live voice (new)')}
        />
      }
    />
  );
}
