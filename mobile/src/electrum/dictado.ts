/**
 * DICTADO DE CAMPO — apretar, hablar, soltar.
 *
 * No es el oído continuo de ULTRON. Ahí la máquina escucha todo el rato porque está en una mesa y
 * la conversación es el modo normal; acá el teléfono va en el bolsillo, al sol, con la batería
 * contada, y alrededor hay gente hablando de otra cosa. Un micrófono siempre abierto en el campo es
 * batería que se va y frases ajenas que entran.
 *
 * Así que esto es de un solo tiro: se toca el micrófono, se habla, se suelta y el texto cae en la
 * caja **sin mandarse**. Que no se mande solo es a propósito: el reconocedor confunde nombres de
 * concesión, y en el campo es mejor mirar lo que entendió antes de preguntarlo que discutir con una
 * respuesta a una pregunta que no se hizo.
 *
 * El reconocimiento lo hace el teléfono (Android SpeechRecognizer / iOS SFSpeechRecognizer): el
 * audio **no sube a ningún servidor nuestro**, que en un expediente con nombres de concesionarios
 * no es un detalle menor. Y si el aparato no lo trae, se dice y se sigue escribiendo a mano — no se
 * finge un micrófono que no existe.
 *
 * Los nombres del oficio van en `contextualStrings`: sin eso «Quebrada Seca» sale «quebrada seca»
 * con suerte, e «INHGEOMIN» no sale nunca.
 */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { nativePause } from '../lib/speechNative';

export type Escucha = {
  /** Corta y devuelve lo último que se entendió. Llamarlo dos veces no hace daño. */
  parar: () => void;
};

/** Lo que el reconocedor no acierta si no se le avisa. */
const DEL_OFICIO = [
  'INHGEOMIN',
  'concesión',
  'concesionario',
  'traslape',
  'expediente',
  'hectárea',
  'lindero',
  'mojón',
  'vértice',
  'catastro minero',
  'explotación',
  'exploración',
  'yacimiento',
  'veta',
  'tajo',
  'socavón',
  'relave',
  'Danlí',
  'Choluteca',
  'Tegucigalpa',
  'Honduras',
  'Dr Electrum',
];

let enMarcha = false;

export function dictadoDisponible(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export async function pedirPermisoDictado(): Promise<boolean> {
  try {
    const r = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return !!r.granted;
  } catch {
    return false;
  }
}

/**
 * Empieza a escuchar. `onParcial` va llegando mientras se habla —para que la caja se llene sola y
 * se vea que la máquina oye— y `onFinal` cierra.
 */
export async function escuchar(cb: {
  onParcial?: (texto: string) => void;
  onFinal?: (texto: string) => void;
  onFin?: () => void;
  onError?: (motivo: string) => void;
}): Promise<Escucha | null> {
  if (enMarcha) return null;
  if (!dictadoDisponible()) {
    cb.onError?.('Este teléfono no trae reconocimiento de voz. Escribime.');
    return null;
  }
  if (!(await pedirPermisoDictado())) {
    cb.onError?.('Sin permiso de micrófono no puedo oírte.');
    return null;
  }

  // ULTRON puede tener su oído continuo encendido: dos reconocedores a la vez se pisan y ninguno
  // entiende nada. Se le pide que se calle mientras dure esto, y se le devuelve al terminar.
  nativePause(true);
  enMarcha = true;

  const subs: Array<{ remove: () => void }> = [];
  let ultimo = '';
  let cerrado = false;

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
    nativePause(false);
    cb.onFin?.();
  };

  const M = ExpoSpeechRecognitionModule;
  subs.push(
    M.addListener('result', (e: any) => {
      const texto = String(e?.results?.[0]?.transcript || '').trim();
      if (!texto) return;
      ultimo = texto;
      if (e?.isFinal) cb.onFinal?.(texto);
      else cb.onParcial?.(texto);
    })
  );
  subs.push(
    M.addListener('error', (e: any) => {
      const code = String(e?.error || 'unknown');
      // «no-speech» es soltar el botón sin haber dicho nada: eso no es un fallo que avisar.
      if (code !== 'aborted' && code !== 'no-speech') cb.onError?.(code);
      cerrar();
    })
  );
  subs.push(
    M.addListener('end', () => {
      // Android a veces cierra sin marcar final: lo último que se entendió vale igual.
      if (ultimo) cb.onFinal?.(ultimo);
      cerrar();
    })
  );

  try {
    M.start({
      lang: 'es-HN',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
      requiresOnDeviceRecognition: false,
      addsPunctuation: true,
      contextualStrings: DEL_OFICIO,
    });
  } catch (e: any) {
    cb.onError?.(String(e?.message || e).slice(0, 120));
    cerrar();
    return null;
  }

  return {
    parar: () => {
      if (cerrado) return;
      try {
        M.stop(); // `stop` entrega lo último; `abort` lo tiraría.
      } catch {
        cerrar();
      }
    },
  };
}
