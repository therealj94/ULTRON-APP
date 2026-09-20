import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { UltronFace } from '../../../mobile/src/components/UltronFace';
import type { FaceState, Mode } from '../../../mobile/src/config';

/** ?face=SPEAKING&mode=GUARDIAN&attention=1 — una sola cara, para fotografiarla. */
function Banco() {
  const p = new URLSearchParams(location.search);
  const face = (p.get('face') || 'IDLE') as FaceState;
  const mode = (p.get('mode') || 'GUARDIAN') as Mode;
  const attention = Number(p.get('attention') || 0);
  const gazeX = Number(p.get('gazeX') || 0);
  const gazeY = Number(p.get('gazeY') || 0);
  const [nivel, setNivel] = useState(0);

  // Boca hablando: nivel de voz simulado y estable, para que la foto no salga en un cero.
  useEffect(() => {
    if (!['SPEAKING', 'SING', 'MUSIC', 'LAUGH'].includes(face)) return;
    const id = setInterval(() => setNivel(0.55 + 0.35 * Math.sin(Date.now() / 140)), 50);
    return () => clearInterval(id);
  }, [face]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <UltronFace face={face} mode={mode} attention={attention} gazeX={gazeX} gazeY={gazeY} speechLevel={nivel} />
    </View>
  );
}

createRoot(document.getElementById('root')!).render(<Banco />);
