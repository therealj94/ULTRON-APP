/**
 * Ajustes → La mesa → «Sonidos mientras trabaja» (José, 6-oct): tecleo al escribir o buscar, papel al leer, clics en su
 * computadora y un murmullo suave al pensar, bajito, en la mesa y en la llamada (compa/sonidosTrabajo.ts). Encendido por
 * omisión. Debajo dice por qué no suenan si los efectos de sonido están apagados o si el servidor los apagó
 * (AURA_AMBIENTE=0), para que nadie lo prenda y no oiga nada sin saber por qué. Cambiarlo avisa al momento
 * (lib/ambienteAjuste.ts): el sonido que suena se va.
 */
import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { Fila, Interruptor } from '../ui';
import { estadoAmbiente, fijarAmbiente, leerAmbiente, suscribirAmbiente } from '../lib/ambienteAjuste';

export function FilaSonidosTrabajo({ efectos }: { efectos: boolean }) {
  const [estado, setEstado] = useState(() => estadoAmbiente());
  const [leido, setLeido] = useState(false);
  useEffect(() => {
    let vivo = true;
    void leerAmbiente().then(() => {
      if (!vivo) return;
      setEstado(estadoAmbiente());
      setLeido(true);
    });
    const quitar = suscribirAmbiente(() => vivo && setEstado(estadoAmbiente()));
    return () => {
      vivo = false;
      quitar();
    };
  }, []);
  // Los efectos se cambian en la fila de al lado: se vuelve a mirar cuando cambian.
  useEffect(() => setEstado(estadoAmbiente()), [efectos]);
  if (!leido) return null;
  const detalle =
    estado.motivo === 'apagados_por_el_servidor'
      ? tr('Apagados por ahora desde el servidor.', 'Turned off for now from the server.')
      : estado.motivo === 'sin_efectos'
        ? tr('Necesitan los efectos de sonido encendidos.', 'Needs sound effects on.')
        : tr('Mientras busca, escribe o piensa se oye bajito: teclado, hojas, clics o un murmullo. Se calla en cuanto habla o hablas.', 'While it searches, writes or thinks you hear it softly: typing, pages, clicks or a hum. It stops as soon as it or you speak.');
  return (
    <Fila
      titulo={tr('Sonidos mientras trabaja', 'Sounds while working')}
      detalle={detalle}
      icono="musica"
      derecha={
        <Interruptor
          valor={estado.valor}
          onCambiar={(v) => {
            if (v === estado.valor) return;
            void fijarAmbiente(v);
          }}
          etiqueta={tr('Sonidos mientras trabaja', 'Sounds while working')}
        />
      }
    />
  );
}
