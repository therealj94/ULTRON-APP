/**
 * LO QUE SE ESCRIBE EN LA MESA ATRAVIESA LA ACTUALIZACIÓN POR AIRE (auditoría del 3-oct, UI01).
 *
 * El mismo trato que los borradores del chat (pulse/borradores.ts): con algo recién escrito la OTA no
 * recarga; si quedó olvidado y la OTA recarga igual, justo antes se guarda en el llavero con la cuenta
 * dueña y al volver se devuelve SOLO a esa cuenta (otra lo descarta sin verlo). Lo puro (armar y abrir el
 * alijo) es el de pulse/borradoresRecarga.ts, ya probado.
 */
import { useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { antesDeRecargar, registrarTrabajoActivo } from './barreraOta';
import { correoCuenta } from './cuenta';
import { armarAlijo, restaurarAlijo } from '../pulse/borradoresRecarga';

const CAJON = 'aura.mesa.borrador.recarga';
const CLAVE = 'mesa';

export function useBorradorMesa(draft: string, setDraft: (f: (d: string) => string) => void) {
  const actual = useRef({ texto: draft, en: Date.now() });
  if (draft !== actual.current.texto) actual.current = { texto: draft, en: Date.now() };

  useEffect(() => {
    const alijo = () => armarAlijo(correoCuenta(), { [CLAVE]: { texto: actual.current.texto, deVoz: false, en: actual.current.en } }, Date.now());
    // Recién tocado frena la recarga; olvidado deja de frenarla (barreraOta). Lo que no cabe frena siempre.
    const quitarTrabajo = registrarTrabajoActivo('borrador-mesa', () => {
      if (!actual.current.texto.trim()) return false;
      return alijo().cabe ? actual.current.en : true;
    });
    const quitarAntes = antesDeRecargar('borrador-mesa', async () => {
      const { json } = alijo();
      if (json) await SecureStore.setItemAsync(CAJON, json);
      else await SecureStore.deleteItemAsync(CAJON).catch(() => {});
    });
    let vivo = true;
    void (async () => {
      const json = await SecureStore.getItemAsync(CAJON).catch(() => null);
      const r = restaurarAlijo(json, correoCuenta(), Date.now());
      if (r.accion === 'nada' || r.accion === 'esperar') return;
      await SecureStore.deleteItemAsync(CAJON).catch(() => {});
      const texto = r.accion === 'restaurar' ? r.borradores?.[CLAVE]?.texto : '';
      // Lo escrito después de volver gana: solo se rellena si la caja está vacía.
      if (vivo && texto) setDraft((d) => (d.trim() ? d : texto));
    })();
    return () => {
      vivo = false;
      quitarTrabajo();
      quitarAntes();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
