/**
 * RESPONDER HABLANDO en las preguntas para conocerle: se toca el micrófono, se dice la respuesta y cae
 * escrita (José, 2-oct: «que le pregunte… ya sea por voz o cuestionario de selección múltiple… o que pueda
 * escribir»). Nada se manda solo: lo dicho llena las opciones que nombró y el campo «Otro», y la persona
 * lo ve antes de seguir.
 *
 * Es el reconocimiento del teléfono (expo-speech-recognition, el mismo módulo nativo que ya usan el oído
 * y el dictado de Dr Electrum: sin dependencias nuevas, entra por OTA). El oído continuo de la mesa se
 * pausa mientras dura (dos reconocedores a la vez se pisan) y se le devuelve al terminar, solo si estaba
 * encendido (ver electrum/dictado.ts: un `abort` sin nada escuchando cerraba el dictado en el acto).
 */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { nativeIsWanted, nativePause } from '../lib/speechNative';
import { tr } from '../i18n';

export type Dictado = { parar: () => void; cancelar: () => void };

let enMarcha = false;

export function dictadoDisponible(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/** Lo que se le dice a la persona si algo falla (null: no hay nada que avisar). */
export function fraseDeError(codigo: string): string | null {
  switch (codigo) {
    case 'aborted':
    case 'no-speech':
      return null;
    case 'speech-timeout':
      return tr('No te oí. Toca el micrófono y habla cerca del teléfono.', 'I didn’t hear you. Tap the mic and speak close to the phone.');
    case 'not-allowed':
    case 'service-not-allowed':
      return tr('Sin permiso de micrófono no puedo oírte. Puedes escribirlo.', 'Without microphone permission I can’t hear you. You can type it.');
    case 'network':
      return tr('El dictado necesita internet. Escríbelo, o prueba cuando vuelva la señal.', 'Dictation needs internet. Type it, or try when you’re back online.');
    case 'audio-capture':
    case 'busy':
      return tr('El micrófono está ocupado. Espera un segundo y vuelve a tocarlo.', 'The mic is busy. Wait a second and tap it again.');
    default:
      return tr('No pude oírte. Vuelve a tocar el micrófono o escríbelo.', 'I couldn’t hear you. Tap the mic again or type it.');
  }
}

/** Empieza a oír. `onParcial` mientras habla (se ve que oye), `onFinal` con lo dicho; `onFin` siempre. */
export async function dictar(
  idioma: 'es' | 'en',
  cb: { onParcial?: (t: string) => void; onFinal?: (t: string) => void; onFin?: () => void; onError?: (frase: string) => void },
  pistas: readonly string[] = []
): Promise<Dictado | null> {
  if (enMarcha) return null;
  enMarcha = true;
  const M = ExpoSpeechRecognitionModule;
  if (!dictadoDisponible()) {
    enMarcha = false;
    cb.onError?.(tr('Este teléfono no trae reconocimiento de voz. Escríbelo.', 'This phone has no speech recognition. Type it.'));
    return null;
  }
  try {
    const r = await M.requestPermissionsAsync();
    if (!r.granted) throw new Error('not-allowed');
  } catch {
    enMarcha = false;
    cb.onError?.(fraseDeError('not-allowed') as string);
    return null;
  }
  const pausado = nativeIsWanted();
  if (pausado) nativePause(true);
  const subs: { remove: () => void }[] = [];
  let ultimo = '';
  let cerrado = false;
  let descartar = false;
  let finalDado = false;
  const final = (t: string) => {
    if (finalDado || descartar || !t) return;
    finalDado = true;
    cb.onFinal?.(t);
  };
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    enMarcha = false;
    for (const s of subs) {
      try {
        s.remove();
      } catch {
        /* */
      }
    }
    if (pausado) nativePause(false);
    cb.onFin?.();
  };
  subs.push(
    M.addListener('result', (e: any) => {
      if (descartar) return;
      const texto = String(e?.results?.[0]?.transcript || '').trim();
      if (!texto) return;
      ultimo = texto;
      if (e?.isFinal) final(texto);
      else cb.onParcial?.(texto);
    })
  );
  subs.push(
    M.addListener('error', (e: any) => {
      const frase = descartar ? null : fraseDeError(String(e?.error || 'unknown'));
      if (frase) cb.onError?.(frase);
      cerrar();
    })
  );
  subs.push(
    M.addListener('end', () => {
      // Android a veces cierra sin marcar final: lo último que se entendió vale igual.
      final(ultimo);
      cerrar();
    })
  );
  try {
    M.start({
      lang: idioma === 'en' ? 'en-US' : 'es-HN',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
      requiresOnDeviceRecognition: false,
      addsPunctuation: true,
      contextualStrings: [...pistas].slice(0, 40),
    });
  } catch {
    cb.onError?.(fraseDeError('unknown') as string);
    cerrar();
    return null;
  }
  return {
    parar: () => {
      if (cerrado) return;
      try {
        M.stop();
      } catch {
        cerrar();
      }
    },
    cancelar: () => {
      if (cerrado) return;
      descartar = true;
      try {
        M.abort();
      } catch {
        cerrar();
      }
    },
  };
}
