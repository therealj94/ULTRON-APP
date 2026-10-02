/**
 * El recorrido dentro de la app: Recorrido.tsx con lo que solo existe en el teléfono.
 *
 *  · la voz: cada anfitrión con la suya de ElevenLabs (tts.ts, `voz`), y la frase que sigue se prepara
 *    mientras suena la de ahora (prepararHabla), para que la conversación no tenga huecos;
 *  · el cuerpo: Claudio y ANT-ONIO en su video (avatares/video/CuerpoVideo), los dos vivos a la vez: el
 *    que habla con su clip de hablar y sus gestos, el otro escuchándolo. Debajo, sus fotos de siempre
 *    (ClaudioRetrato) mientras arranca el video o si el teléfono no puede con él;
 *  · los efectos: los sonidos del recorrido (sonidos.ts) y la vibración de la app (ui/hapticos).
 */
import { useEffect, useMemo } from 'react';
import { Recorrido, type Narrador, type PropsAnfitrion } from './Recorrido';
import type { Anfitrion, PruebaId } from './guion';
import { prepararHabla, speak, stopSpeaking } from '../lib/tts';
import type { Emocion } from '../lib/emocion';
import { CuerpoVideo } from '../avatares/video/CuerpoVideo';
import { ClaudioRetrato, FOTOS_ANTONIO, FOTOS_CLAUDIO } from '../avatares/ClaudioRetrato';
import { ESTADO_INICIAL, type EstadoAvatar, type ExpresionAvatar } from '../avatar3d/tipos';
import type { FaceState } from '../caraTipos';
import { prepararSonidos, sonar, soltarSonidos } from './sonidos';
import { vibrar } from '../ui/hapticos';

const efectosApp = { sonar, vibrar };

const narradorApp: Narrador = {
  async hablar(texto, quien, emocion, alSonar) {
    return speak(texto, { voz: quien, emocion: emocion as Emocion, onAudioStart: alSonar });
  },
  preparar(texto, quien, emocion) {
    void prepararHabla(texto, { voz: quien, emocion: emocion as Emocion });
  },
  callar() {
    void stopSpeaking();
  },
};

function estadoDe(p: PropsAnfitrion): EstadoAvatar {
  const expresion: ExpresionAvatar = p.cara === 'encantada' ? 'encantada' : p.cara === 'sorprendida' ? 'sorprendida' : p.cara === 'piensa' ? 'piensa' : 'tranquila';
  return { ...ESTADO_INICIAL, expresion, hablando: p.hablando, escuchando: !p.alFrente, gesto: p.gesto };
}

function caraDe(p: PropsAnfitrion): FaceState {
  if (p.hablando) return 'SPEAKING';
  if (p.cara === 'encantada') return 'LAUGH';
  if (p.cara === 'sorprendida') return 'SURPRISED';
  if (p.cara === 'piensa') return 'THINKING';
  return p.alFrente ? 'IDLE' : 'LISTENING';
}

function Cuerpo({ quien, p }: { quien: Anfitrion; p: PropsAnfitrion }) {
  // El estado solo cambia cuando cambia algo de verdad (el guion del video lo compara).
  const estado = useMemo(() => estadoDe(p), [p.hablando, p.alFrente, p.cara, p.gesto?.n, p.gesto?.nombre]); // eslint-disable-line react-hooks/exhaustive-deps
  const respaldo = <ClaudioRetrato face={caraDe(p)} fotos={quien === 'claudio' ? FOTOS_CLAUDIO : FOTOS_ANTONIO} nombre={quien === 'claudio' ? 'Claudio' : 'ANT-ONIO'} />;
  return <CuerpoVideo avatar={quien} camara="retrato" estado={estado} ancho={p.ancho} alto={p.alto} respaldo={respaldo} saludar={false} />;
}

export function RecorridoApp({ visible, nombre, idioma, onCerrar, onProbar }: { visible: boolean; nombre: string; idioma: 'es' | 'en'; onCerrar: () => void; onProbar: (id: PruebaId) => void }) {
  useEffect(() => {
    if (!visible) return;
    void prepararSonidos();
    return () => void soltarSonidos();
  }, [visible]);
  return (
    <Recorrido
      visible={visible}
      nombre={nombre}
      idioma={idioma}
      narrador={narradorApp}
      cuerpo={(quien, p) => <Cuerpo quien={quien} p={p} />}
      onCerrar={onCerrar}
      onProbar={onProbar}
      efectos={efectosApp}
    />
  );
}
