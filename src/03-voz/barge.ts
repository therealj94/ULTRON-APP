import { cancelSpeech } from './speech';
import { stopCurrentVoice } from './elevenlabs';
import { fadeStopVoice } from './player';

/** Corta la voz del asistente cuando el jefe habla. Fade 160ms, no corte seco. */
export function bargeIn() {
  cancelSpeech();
  stopCurrentVoice();
  fadeStopVoice(160);
}
