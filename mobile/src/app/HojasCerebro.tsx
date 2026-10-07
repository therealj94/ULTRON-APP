/**
 * LAS HOJAS DE LO QUE AURA LLEVA DE TI, EN TODA LA APP: sus misiones (ajustes/Misiones.tsx), lo que sabe de
 * ti con lo que quedó a medias (ajustes/LoQueSeDeTi.tsx) y tu círculo (ajustes/Circulo.tsx).
 *
 * Como la computadora y los correos (app/ComputadoraEnVivo.tsx, que la monta), se dibujan una sola vez en la
 * raíz y se abren con app/hojas.ts desde cualquier pantalla: el menú de la mesa, Ajustes o «abrir».
 *
 * `HojaCerebro` es la de la mesa y Ajustes (como ajustes/Computadora.tsx HojaComputadora): abre la de toda
 * la app y suelta la suya; sin la raíz que las dibuja (una pantalla suelta), dibuja la propia.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { HojaCirculo } from '../ajustes/Circulo';
import { HojaConocer } from '../ajustes/LoQueSeDeTi';
import { HojaMisiones } from '../ajustes/Misiones';
import { HojaHoy } from '../agenda/HojaHoy';
import { HojaRecordatorios } from '../ajustes/Recordatorios';
import type { PantallaCerebro } from '../compa/cerebro';
import { abrirHoja, cerrarHoja, hayAnfitrion, hojasAhora, suscribirHojas } from './hojas';

export function HojasCerebro() {
  const hojas = useSyncExternalStore(suscribirHojas, hojasAhora, hojasAhora);
  return (
    <>
      <HojaMisiones visible={hojas.abierta === 'misiones'} onCerrar={cerrarHoja} />
      <HojaConocer visible={hojas.abierta === 'conocer'} onCerrar={cerrarHoja} />
      <HojaCirculo visible={hojas.abierta === 'circulo'} onCerrar={cerrarHoja} />
      <HojaHoy visible={hojas.abierta === 'agenda'} onCerrar={cerrarHoja} />
      <HojaRecordatorios visible={hojas.abierta === 'recordatorios'} onCerrar={cerrarHoja} />
    </>
  );
}

type PropsHoja = { cual: PantallaCerebro | null; onCerrar: () => void };

export function HojaCerebro({ cual, onCerrar }: PropsHoja) {
  const global = hayAnfitrion();
  useEffect(() => {
    if (!cual || !global) return;
    abrirHoja(cual);
    onCerrar();
  }, [cual, global]); // eslint-disable-line react-hooks/exhaustive-deps
  if (global) return null;
  return (
    <>
      <HojaMisiones visible={cual === 'misiones'} onCerrar={onCerrar} />
      <HojaConocer visible={cual === 'conocer'} onCerrar={onCerrar} />
      <HojaCirculo visible={cual === 'circulo'} onCerrar={onCerrar} />
      <HojaHoy visible={cual === 'agenda'} onCerrar={onCerrar} />
      <HojaRecordatorios visible={cual === 'recordatorios'} onCerrar={onCerrar} />
    </>
  );
}
