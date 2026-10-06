/**
 * Las muletillas en la mesa de voz (screens/DeskScreen.tsx): arma la orquesta (lib/muletillas.ts) con el oído de
 * verdad (lib/speech.ts), los clips con la voz del avatar (lib/muletillasAudio.ts) y el estado de la mesa, y la
 * enciende o apaga según el ajuste, el servidor y el teléfono (lib/muletillasAjuste.ts). Las reglas: lib/asentir.ts.
 * El arnés mobile/pruebas/muletillas arma la misma orquesta (`orquestaDeLaMesa`) con lo nativo simulado.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { AvatarId } from '../avatares/catalogo';
import { micEcoActivo } from './auraMic';
import { OrquestaMuletillas } from './muletillas';
import { callarMuletilla, duracionMuletilla, prepararMuletillas, sonarMuletilla } from './muletillasAudio';
import { REFRESCO_REMOTO_MS, estadoMuletillas, leerMuletillas, refrescarMuletillasRemota, suscribirMuletillas } from './muletillasAjuste';
import { currentSttEngine, ignorarTramoOido, isMicPaused, setEcoAlEscuchar, setMuletillas } from './speech';
import { miga } from './reporte';

export type MesaMuletillas = {
  avatar: AvatarId | null;
  idioma: 'es' | 'en';
  /** AU-RA habla o va a hablar (la mesa: speakingRef). */
  hablando: () => boolean;
  /** La mesa no está para muletillas (silenciada, en llamada o conversación, pensando un turno, tapada). */
  ocupada: () => boolean;
};

/** La orquesta con lo de verdad: el oído Turbo (el tramo, el cancelador de eco) y los clips por el canal de efectos. */
export function orquestaDeLaMesa(mesa: () => MesaMuletillas, encendidas: () => boolean): OrquestaMuletillas {
  return new OrquestaMuletillas({
    activo: encendidas,
    ecoCancelado: () => currentSttEngine() === 'turbo' && micEcoActivo(),
    auraHablando: () => mesa().hablando() || isMicPaused(),
    silencioso: () => mesa().ocupada(),
    idioma: () => mesa().idioma,
    duracion: duracionMuletilla,
    sonar: sonarMuletilla,
    callar: callarMuletilla,
    ignorarTramo: ignorarTramoOido,
    miga,
  });
}

/** Lo que pasa cuando cambia el ajuste, el servidor o el teléfono: el micrófono y los clips siguen a «encendidas». */
export function aplicarMuletillas(avatar: AvatarId | null, idioma: 'es' | 'en', antes: boolean): boolean {
  const e = estadoMuletillas();
  if (e.encendidas !== antes) miga(`muletillas: ${e.encendidas ? 'encendidas' : `apagadas (${e.motivo})`}`);
  setEcoAlEscuchar(e.encendidas);
  if (e.encendidas && avatar) void prepararMuletillas(avatar, idioma);
  return e.encendidas;
}

export function useMuletillasMesa(m: MesaMuletillas) {
  const mesa = useRef(m);
  mesa.current = m;
  const encendidas = useRef(false);
  const orquesta = useRef<OrquestaMuletillas | null>(null);
  if (!orquesta.current) orquesta.current = orquestaDeLaMesa(() => mesa.current, () => encendidas.current);

  // El oído la conoce mientras la mesa esté montada.
  useEffect(() => {
    setMuletillas(orquesta.current);
    return () => {
      setMuletillas(null);
      setEcoAlEscuchar(false);
    };
  }, []);

  // Encendidas o no: el ajuste, el servidor y el teléfono. El micrófono de escucha lleva el cancelador solo si sí.
  const { avatar, idioma } = m;
  useEffect(() => {
    let vivo = true;
    const aplicar = () => {
      if (vivo) encendidas.current = aplicarMuletillas(avatar, idioma, encendidas.current);
    };
    void leerMuletillas().then(aplicar);
    void refrescarMuletillasRemota(true);
    const quitar = suscribirMuletillas(aplicar);
    const tic = setInterval(() => AppState.currentState === 'active' && void refrescarMuletillasRemota(), REFRESCO_REMOTO_MS);
    return () => {
      vivo = false;
      quitar();
      clearInterval(tic);
    };
  }, [avatar, idioma]);
}
