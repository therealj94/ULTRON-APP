// Doble de expo-av: el reproductor existe y no suena. Anota en `window.__sonidos` lo que se crea y
// se descarga, para que el banco de pruebas pueda contar sonidos vivos (fugas) al final.
const w = globalThis as any;
w.__sonidos = w.__sonidos || { creados: 0, descargados: 0 };

export const Audio = {
  setAudioModeAsync: async () => {},
  Sound: {
    createAsync: async () => {
      w.__sonidos.creados += 1;
      let descargado = false;
      return {
        sound: {
          unloadAsync: async () => {
            if (!descargado) w.__sonidos.descargados += 1;
            descargado = true;
          },
          stopAsync: async () => {},
          setOnPlaybackStatusUpdate: () => {},
        },
      };
    },
  },
};
export type AVPlaybackStatus = { isLoaded: boolean; didJustFinish?: boolean };
