export {
  MaquinaEscena,
  describirEscena,
  ladoDesdeUltron,
  espejarX,
  normalizarY,
  cabezaDesde,
  UMBRALES,
  type Escena,
  type Principal,
  type EventoEscena,
  type Observacion,
  type MotorVision as TipoMotorVision,
  type Cabeza,
} from './escena';
export { MotorVision, type Mirada, type EstadoMotor, type OpcionesMotor } from './motor';
export {
  MEDIAPIPE_VERSION,
  MEDIAPIPE_WASM_URL_DEFAULT,
  FACE_LANDMARKER_MODEL_URL_DEFAULT,
  MEDIAPIPE_TIMEOUT_MS,
  // Funciones (no constantes): devuelven la URL que realmente se usará en el próximo arranque,
  // respetando window.__ULTRON_VISION aunque se ponga después de cargar el módulo.
  urlWasm,
  urlModelo,
  anguloEsperado,
  combinarAngulo,
} from './mediapipe';
export { analizarCuadro, MemoriaMovimiento, tieneEnergia, UMBRALES_OPTICO, type EstadisticasCuadro } from './optico';
