/**
 * El oído Turbo con lo de verdad: el micrófono crudo (modules/aura-mic), el WebSocket de React Native y
 * el servidor de AU-RA (token de un solo uso y /api/stt). La lógica está en turboMotor.ts.
 */
import { abrirMicCrudo, micCrudoDisponible, micEcoActivo } from './auraMic';
import { pedirPermisoTurbo, transcribirWav } from './api';
import { MotorTurbo, type CallbacksTurbo, type InfoTrozo, type WsTurbo } from './turboMotor';

const motor = new MotorTurbo({
  abrirMic: abrirMicCrudo,
  ecoActivo: micEcoActivo,
  permiso: pedirPermisoTurbo,
  transcribirWav: (wav, confirmar) => transcribirWav(wav, confirmar),
  crearWs: (url) => new WebSocket(url) as unknown as WsTurbo,
});

/** ¿Este binario trae el micrófono crudo? (una APK anterior con este JS por OTA, no). */
export const turboDisponible = micCrudoDisponible;

export const turboCallbacks = (cb: CallbacksTurbo) => motor.setCallbacks(cb);
export const turboActivar = () => motor.activar();
export const turboSilenciar = () => motor.silenciar();
export const turboPausar = (p: boolean) => motor.pausar(p);
export const turboReiniciar = () => motor.reiniciar();
export const turboDestruir = () => motor.destruir();
export const turboQuiere = () => motor.quiereOir();
export const turboPausado = () => motor.estaPausado();
export const turboEscuchando = () => motor.escuchando();
export const turboVivo = () => motor.vivo();
export const turboOirEncima = (on: boolean) => motor.setOirEncima(on);
/** Las muletillas (lib/asentir.ts): el cancelador de eco en el micrófono de escucha, el tramo a ignorar y cada trozo. */
export const turboEcoAlEscuchar = (on: boolean) => motor.setEcoAlEscuchar(on);
export const turboIgnorarTramo = (ms: number) => motor.ignorarTramo(ms);
/** Suena un sonido de trabajo de la mesa (compa/trabajoMesa.ts): el umbral de voz sube mientras tanto. */
export const turboFondoPropio = (on: boolean) => motor.setFondoPropio(on);
export const turboConCancelador = () => motor.escuchaConCancelador();
export const turboOyenteTrozo = (fn: ((i: InfoTrozo) => void) | null) => motor.setOyenteTrozo(fn);
export const turboTomarTurno = () => motor.tomarTurno();
export const turboOyendoEncima = () => motor.oyendoEncima();
/** El audio PCM de cada frase entregada (trozos de 0,1 s en base64), justo antes de su texto, con su id: las voces. */
export const turboOyenteAudio = (fn: ((trozos: string[], texto: string, id?: number) => void) | null) => motor.setOyenteAudio(fn);
/** El audio de cada frase al cerrarse (antes del texto), con su id: las voces empiezan a reconocer ahí. */
export const turboOyenteCierre = (fn: ((id: number, trozos: string[]) => void) | null) => motor.setOyenteCierre(fn);
