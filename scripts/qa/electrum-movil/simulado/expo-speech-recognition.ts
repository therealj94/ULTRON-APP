// Doble de expo-speech-recognition que se porta como el módulo nativo de Android, leído de su
// fuente (android/.../ExpoSpeechRecognitionModule.kt y ExpoSpeechService.kt, v3.1):
//
//  · `abort()` manda SIEMPRE un `error` «aborted» y, después, un `end` — aunque no hubiera nada
//    escuchando. Esto es lo que hacía que el dictado de Dr Electrum se cerrara solo.
//  · `start()` manda `start`, resultados parciales, uno final y `end`.
//  · `stop()` entrega lo último y manda `end`.
//
// Los eventos llegan a JS después, no en la misma llamada, igual que en el teléfono. Lo que se
// «dice» sale de `?dictado=` (por omisión, una pregunta de campo).
type Oyente = (e: any) => void;
const oyentes = new Map<string, Set<Oyente>>();
const emitir = (ev: string, datos?: unknown, ms = 0) =>
  setTimeout(() => {
    for (const f of [...(oyentes.get(ev) || [])]) f(datos);
  }, ms);

const frase = new URLSearchParams(globalThis.location?.search || '').get('dictado') || '¿qué dice el catastro de Quebrada Seca?';
let sesion = 0;
let activo = false;

export const ExpoSpeechRecognitionModule: any = {
  isRecognitionAvailable: () => true,
  requestPermissionsAsync: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
  getPermissionsAsync: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
  addListener(ev: string, f: Oyente) {
    if (!oyentes.has(ev)) oyentes.set(ev, new Set());
    oyentes.get(ev)!.add(f);
    return { remove: () => oyentes.get(ev)?.delete(f) };
  },
  start() {
    const mia = (sesion += 1);
    activo = true;
    const vivo = () => activo && mia === sesion;
    setTimeout(() => vivo() && emitir('start'), 60);
    const palabras = frase.split(' ');
    const mitad = palabras.slice(0, Math.ceil(palabras.length / 2)).join(' ');
    setTimeout(() => vivo() && emitir('result', { isFinal: false, results: [{ transcript: mitad, confidence: 0.6 }] }), 500);
    setTimeout(() => vivo() && emitir('result', { isFinal: false, results: [{ transcript: frase, confidence: 0.8 }] }), 1100);
    setTimeout(() => {
      if (!vivo()) return;
      emitir('result', { isFinal: true, results: [{ transcript: frase, confidence: 0.9 }] });
      activo = false;
      emitir('end', null, 20);
    }, 2600);
  },
  stop() {
    if (!activo) return;
    activo = false;
    emitir('result', { isFinal: true, results: [{ transcript: frase, confidence: 0.9 }] }, 10);
    emitir('end', null, 30);
  },
  abort() {
    activo = false;
    sesion += 1;
    emitir('error', { error: 'aborted', message: 'Speech recognition aborted.', code: -1 }, 5);
    emitir('end', null, 15);
  },
};
export type ExpoSpeechRecognitionErrorCode = string;
export function useSpeechRecognitionEvent() {}
