/**
 * LA AU-RA CHIQUITA, IGUAL QUE LA GRANDE (José, 11-oct: «cuando se hace pequeño aura en chat se vea igual cuando es
 * avatar»). En el acople al lado de los chats, en la pantalla completa y en la que camina, AU-RA era la foto del orbe con
 * respiración (OrbeMini): otro color, sin sus expresiones, sin su remolino al pensar. Ahora es el MISMO orbe de partículas
 * de la mesa (src/14-orbe/orbe.html), con el componente que ya lo hace chiquito y probado en la burbuja del botón lateral
 * (burbuja/OrbeBurbuja: encuadre «centro», la foto debajo como primer cuadro):
 *
 *  · el mismo estado que la mesa: habla con su voz (late con ella), escucha con tu voz, piensa (remolino), dormida en
 *    silencio (avatar3d/orbeVivo.ts `estadoOrbeChico`);
 *  · la misma emoción y el mismo color: la cara del alma pasa por la misma tabla que usa la mesa
 *    (orbe/expresiones.ts `expresionDeAvatar` → `mensajeExpresion`), y vuelve sola a lo neutro;
 *  · «reducir movimiento»: DECIDIDO igual que la mesa, a propósito: se le dice al orbe (menos giro, sin golpes) y la foto
 *    queda quieta, pero el orbe chico sigue vivo (no se cambia por la foto). Es la misma AU-RA a cualquier tamaño, y la
 *    mesa con «reducir movimiento» tampoco deja de moverse del todo;
 *  · la batería: un orbe de este tamaño no necesita los cuadros de la pantalla: va con tope de 30 por segundo, y de 15
 *    dormida (orbe/opciones.ts `fpsMax`); la burbuja del botón lateral sigue sin tope;
 *  · no recibe toques: los toma quien la contiene (el acople con `useTacto`, la que camina con su arrastre).
 *
 * Nunca dos escenas WebGL vivas: solo monta la WebView con el turno del orbe vivo (orbeVivo.ts), que la mesa suelta al
 * pausar su orbe cuando no se ve y vuelve a tomar al verse. Con la burbuja del botón lateral abierta (burbuja/logica.ts
 * `burbujaAbierta`) ni lo pide: la burbuja es translúcida, la app sigue «activa» detrás y el orbe vivo es el de ella. Sin
 * turno, tapada o si la WebView no arranca, queda la foto de siempre con el velo de la emoción.
 */
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { View } from 'react-native';
import { OrbeBurbuja } from '../burbuja/OrbeBurbuja';
import { burbujaAbierta } from '../burbuja/logica';
import { expresionDeAvatar, type ExpresionOrbe } from '../orbe/expresiones';
import { anotarCaidaChico, chicoPuedeIntentar, estadoOrbeChico, geometriaOrbeChico, orbeVivo, soltarOrbeVivo, tomarOrbeVivo } from './orbeVivo';
import type { EstadoAvatar } from './tipos';

type Props = {
  /** El cuadro donde va (el disco se centra en él). */
  lado: number;
  estado?: Pick<EstadoAvatar, 'hablando' | 'pensando' | 'escuchando' | 'silenciado' | 'expresion'>;
  /** Pausado (tapado, apartado, en segundo plano): ni WebView ni animaciones, y suelta el turno. */
  activo?: boolean;
  /** Con halo por fuera del cuadro (la que camina: nada la recorta); sin él, todo cabe en el cuadro. */
  halo?: boolean;
};

/** El tope de cuadros del orbe chico (despierto / dormido): ver la cabecera. */
export const FPS_CHICA = 30;
export const FPS_CHICA_DORMIDA = 15;

let serieId = 0;
let serieEmocion = 0;

/** ¿Le toca el turno del orbe vivo? Lo pide mientras lo quiere y lo suelta al dejar de quererlo o al desmontarse. */
function useTurnoOrbe(quiere: boolean): boolean {
  const [id] = useState(() => `chica-${++serieId}`);
  const [mio, setMio] = useState(false);
  useEffect(() => {
    if (!quiere) {
      setMio(false);
      return;
    }
    const intentar = () => setMio(tomarOrbeVivo(id));
    intentar();
    // La mesa lo toma a la fuerza al volver a verse: aquí vuelve la foto en el acto. Si queda libre, se pide otra vez.
    const fuera = orbeVivo.escuchar((d) => (d === id ? setMio(true) : d === null ? intentar() : setMio(false)));
    return () => {
      fuera();
      soltarOrbeVivo(id);
    };
  }, [quiere, id]);
  return quiere && mio;
}

function OrbeAuraChicaBase({ lado, estado, activo = true, halo = false }: Props) {
  const [caida, setCaida] = useState(() => !chicoPuedeIntentar());
  // La burbuja abierta tiene el orbe vivo (su actividad translúcida va encima de esta): aquí, la foto.
  const burbuja = useSyncExternalStore(burbujaAbierta.suscribir, burbujaAbierta.abierta, burbujaAbierta.abierta);
  const vivo = useTurnoOrbe(activo && !caida && !burbuja);
  const estadoOrbe = estadoOrbeChico(estado);
  // Dormida: silenciada (el orbe en «apagado») o con la cara de dormida.
  const dormida = estadoOrbe === 'apagado' || estado?.expresion === 'dormida';
  const g = useMemo(() => geometriaOrbeChico(lado, halo), [lado, halo]);
  const nombre = expresionDeAvatar(estado?.expresion);
  // Cada emoción nueva vuelve a sonar en el orbe (`n` distinto), como la de cada turno en la mesa.
  const expresion = useMemo<{ nombre: ExpresionOrbe; n: number } | null>(() => (nombre ? { nombre, n: ++serieEmocion } : null), [nombre]);
  const alCaer = useCallback(() => {
    anotarCaidaChico();
    setCaida(true);
  }, []);

  // El halo sale por fuera del cuadro (centrado sobre él); sin halo, el lienzo es el cuadro.
  const fuera = (g.lienzo - Math.max(24, Math.round(lado))) / 2;
  return (
    <OrbeBurbujaPosicion fuera={halo ? fuera : 0} lienzo={g.lienzo}>
      <OrbeBurbuja
        lado={g.disco}
        lienzo={g.lienzo}
        radioOrbe={g.radioOrbe}
        radioDisco={g.radioDisco}
        estado={estadoOrbe}
        expresion={expresion}
        vivo={vivo}
        activo={activo}
        origen="AU-RA chiquita"
        alCaer={alCaer}
        fpsMax={dormida ? FPS_CHICA_DORMIDA : FPS_CHICA}
      />
    </OrbeBurbujaPosicion>
  );
}

/** Con halo, el lienzo se corre hacia arriba y a la izquierda para quedar centrado sobre el cuadro. */
function OrbeBurbujaPosicion({ fuera, lienzo, children }: { fuera: number; lienzo: number; children: ReactNode }) {
  if (!fuera) return <>{children}</>;
  return (
    <View pointerEvents="none" style={{ width: lienzo - fuera * 2, height: lienzo - fuera * 2 }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: -fuera, top: -fuera, width: lienzo, height: lienzo }}>
        {children}
      </View>
    </View>
  );
}

export const OrbeAuraChica = memo(OrbeAuraChicaBase);
