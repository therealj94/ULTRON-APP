/**
 * CamaraVision — los ojos de AU-RA en el teléfono.
 *
 * Motor 'mlkit' (4.3): expo-camera toma fotos PEQUEÑAS (el tamaño más chico con al menos 720 px de lado
 * corto, no la resolución del sensor) y ML Kit busca caras en el propio teléfono. Así sabe DÓNDE estás
 * y los ojos te siguen. Ritmo según haga falta: ~3 fotos/s con alguien delante, 1/s sin nadie, una
 * cada 2,5 s dormida. Cada foto se borra al terminar.
 *
 * El servidor (lo que hay en la mesa, para «Comenta lo que ve») recibe esa MISMA foto chica y solo si
 * hace falta (lib/vistaCamara.ts intervaloServidor): con «Comenta lo que ve» apagado, ninguna; encendido,
 * cada 20 s con alguien delante (60 s sin nadie) y, si la escena no cambia, cada vez menos (hasta 2 y
 * 4 min); nunca dormida. Contesta con una vista estructurada (objetos con caja, texto leído, lugar).
 *
 * `previa`: la vista de la cámara se hace visible (una ventanita arriba) para que la persona apunte lo
 * que quiere que lea o reconozca; el resto del tiempo sigue casi invisible.
 *
 * Motor 'servidor' (respaldo): si ML Kit no está o falla 3 veces seguidas, se vuelve al de antes
 * —una foto cada 12 s (30 s dormida) al servidor—, pero ya con la foto chica.
 *
 * Antes (hasta 4.3) la cámara tomaba la foto a la resolución completa del sensor cada 12 s y la
 * mandaba entera en base64: el teléfono se calentaba, gastaba datos y el servidor pagaba por
 * analizar fotos enormes. Y como el servidor solo dice «hay una persona», los ojos miraban al centro.
 *
 * Batería: la cámara solo trabaja con la app en primer plano (AppState). `grabRef` deja un frame bajo
 * demanda en base64 jpeg (lo usa «qué ves» en DeskScreen).
 *
 * El detector nativo de 4.1.0 (vision-camera + worklets-core) sigue retirado: cerraba la app al
 * entrar a la mesa (ver 0602318). ML Kit aquí es un módulo clásico del puente, sin runtime de
 * worklets, y analiza fotos, no un flujo de cuadros.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import { CameraView } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import FaceDetection from '@react-native-ml-kit/face-detection';
import { verCamara } from '../lib/api';
import { LOCAL_CON_PERSONA_MS, LOCAL_DORMIDA_MS, LOCAL_SIN_PERSONA_MS } from '../lib/camaraModo';
import { etiquetasDeVista, intervaloServidor, mismaEscena, type VistaCamara } from '../lib/vistaCamara';
import { reportarEstado } from '../lib/reporte';
import {
  MaquinaEscena,
  UMBRALES_FOTOS,
  caraDeMlkit,
  elegirTamano,
  escenaApagada,
  escenaDesdeEtiquetas,
  observacionMlkit,
  type CaraMlkit,
  type Escena,
  type MotorVision,
} from '../lib/escena';

/** El motor de vision-camera de 4.1.0 sigue fuera; ML Kit entra por fotos (ver arriba). */
export const DETECCION_NATIVA = false;

/** Ritmo de referencia con la cara dormida; DeskScreen lo usa para juzgar si una escena sigue fresca. */
export const DORMIDO_PERIODO_MS = 12_000;
/** Emisión máxima de onEscena sin eventos. */
const ESCENA_CADA_MS = 500;
/** Respaldo por servidor: foto cada 12 s (30 s si la cara duerme). DeskScreen los usa para la frescura. */
export const SERVIDOR_CADA_MS = 12_000;
export const SERVIDOR_DORMIDO_MS = 30_000;
// El ritmo (fotos por segundo con y sin alguien, subidas al servidor) vive en lib/camaraModo.ts, puro,
// para medirlo en Node. Desde la actualización por aire de la mesa (sobre 4.7.0) la cámara arranca APAGADA: este ritmo solo corre si la piden.
/** Fallos seguidos de ML Kit antes de pasarse al servidor. */
const FALLOS_ML_MAX = 3;
/** Menos base64 que esto no es una foto: es la cámara todavía sin imagen. */
const MINIMO_FOTO = 4_000;

const OPCIONES_ML = {
  performanceMode: 'fast',
  landmarkMode: 'none',
  contourMode: 'none',
  classificationMode: 'all',
  minFaceSize: 0.12,
  trackingEnabled: false,
} as const;

/** Se avisa una vez por arranque para no inundar los logs. */
const avisado = new Set<string>();
function avisarUnaVez(clave: string, texto: string) {
  if (avisado.has(clave)) return;
  avisado.add(clave);
  reportarEstado(texto);
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

function borrar(uri?: string | null) {
  if (uri) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

/** `leer`: más calidad JPEG (texto chico, precios); lo normal basta para describir. */
export type FrameGrabber = (opts?: { calidad?: 'normal' | 'leer' }) => Promise<string | null>;

export type CamaraVisionProps = {
  /** Permiso concedido y visión encendida. Con false se emite una vez `{ motor: 'ninguno' }`. */
  enabled: boolean;
  /** La cara está en SLEEPING: una foto cada 30 s en vez de cada 12 s. */
  dormido?: boolean;
  /** Se rellena con una función que devuelve el frame actual en base64 (jpeg), o null. */
  grabRef?: React.MutableRefObject<FrameGrabber | null>;
  /** Escena interpretada: ≤ 1 cada 500 ms, inmediata cuando trae eventos. */
  onEscena?: (e: Escena) => void;
  /** Mirada suavizada hacia la persona (x,y en -1..1, x ya espejado). `activa` false = no hay cara. */
  onGaze?: (x: number, y: number, activa: boolean) => void;
  /** Etiquetas de la mesa según el nodo de visión (servidor). */
  onObjects?: (labels: string[]) => void;
  /** La vista estructurada del servidor (comentario proactivo en DeskScreen). */
  onVista?: (v: VistaCamara) => void;
  /** «Comenta lo que ve» encendido: sin esto (y con ML Kit) no se sube ninguna foto por su cuenta. */
  observar?: boolean;
  /** La vista de la cámara visible (para apuntar lo que se quiere leer o reconocer). */
  previa?: boolean;
  /** Cambio de motor real en uso. */
  onMotor?: (m: MotorVision) => void;
};

/** JPEG: el bucle (ML Kit + a veces el servidor) con poca; «qué ves» con algo más; leer con más. */
const CALIDAD = { bucle: 0.5, normal: 0.6, leer: 0.85 } as const;

function useAppActiva() {
  const [activa, setActiva] = useState(AppState.currentState === 'active' || AppState.currentState == null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setActiva(s === 'active'));
    return () => sub.remove();
  }, []);
  return activa;
}

// ---------------------------------------------------------------- el motor

type Foto = { uri: string; width: number; height: number };

type MotorProps = {
  activa: boolean;
  dormido: boolean;
  observar: boolean;
  previa: boolean;
  grabRef?: React.MutableRefObject<FrameGrabber | null>;
  /** Caras de una foto (ML Kit). Devuelve cuántas personas cuenta la escena. */
  onCaras: (caras: CaraMlkit[], w: number, h: number) => number;
  /** ML Kit no está o dejó de responder: a partir de aquí solo el servidor. */
  onSinDetector: () => void;
  onVista: (v: VistaCamara) => void;
};

function CamaraMotor({ activa, dormido, observar, previa, grabRef, onCaras, onSinDetector, onVista }: MotorProps) {
  const ref = useRef<CameraView>(null);
  const listaRef = useRef(false);
  const [tamano, setTamano] = useState<string | undefined>(undefined);
  /** Una sola foto a la vez: el bucle y «qué ves» no pueden disparar juntos. */
  const ocupada = useRef(false);
  const mlOk = useRef(true);
  const dormidoRef = useRef(dormido);
  dormidoRef.current = dormido;
  const observarRef = useRef(observar);
  observarRef.current = observar;
  const cb = useRef({ onCaras, onSinDetector, onVista });
  cb.current = { onCaras, onSinDetector, onVista };

  const tomar = useCallback(async (opciones: { base64: boolean; quality: number }): Promise<(Foto & { base64?: string }) | null> => {
    if (!ref.current || !listaRef.current) return null;
    try {
      const f = await ref.current.takePictureAsync({ quality: opciones.quality, base64: opciones.base64, shutterSound: false });
      if (!f?.uri) return null;
      return { uri: f.uri, width: f.width, height: f.height, base64: f.base64 };
    } catch {
      return null;
    }
  }, []);

  /** Espera a que el bucle suelte la cámara (máx. ~2 s) y la toma. */
  const conCamara = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    for (let i = 0; ocupada.current && i < 40; i++) await dormir(50);
    if (ocupada.current) return null;
    ocupada.current = true;
    try {
      return await fn();
    } finally {
      ocupada.current = false;
    }
  }, []);

  // «Qué ves»: una foto con base64 (la chica: basta para describir y leer una etiqueta cercana).
  useEffect(() => {
    if (!grabRef) return;
    grabRef.current = activa
      ? async (o) => {
          const f = await conCamara(() => tomar({ base64: true, quality: o?.calidad === 'leer' ? CALIDAD.leer : CALIDAD.normal }));
          if (!f) return null;
          borrar(f.uri);
          const b64 = f.base64 || null;
          if (!b64 || b64.length < MINIMO_FOTO) {
            if (b64) avisarUnaVez('pobre', `cámara: foto inservible (${b64.length} car. base64), la descarto`);
            return null;
          }
          return b64;
        }
      : null;
    return () => {
      grabRef.current = null;
    };
  }, [activa, conCamara, grabRef, tomar]);

  // El bucle: foto chica → ML Kit (si está) → a veces el servidor → borrar → esperar según haga falta.
  useEffect(() => {
    if (!activa) {
      // La cámara se desmonta: la próxima tiene que volver a avisar que está lista.
      listaRef.current = false;
      return;
    }
    let vivo = true;
    let fallos = 0;
    let ultimoServidor = 0;
    let conPersona = false;
    let personasAntes = -1;
    /** Vistas seguidas iguales: cada una espacia la siguiente subida (intervaloServidor). */
    let sinCambios = 0;
    let vistaAntes: VistaCamara | null = null;
    /** Una subida a la vez: con 35 s de tope y 20 s de ritmo podían ir dos juntas. */
    let subiendo = false;
    const servidor = async (uri: string) => {
      subiendo = true;
      try {
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        borrar(uri);
        if (!b64 || b64.length < MINIMO_FOTO) return;
        avisarUnaVez('buena', `cámara: primera foto al servidor (${b64.length} car. base64)`);
        const r = await verCamara(b64, 'escena');
        if (!vivo || !r?.vista) return;
        sinCambios = mismaEscena(vistaAntes, r.vista) ? sinCambios + 1 : 0;
        vistaAntes = r.vista;
        cb.current.onVista(r.vista);
      } catch {
        borrar(uri);
      } finally {
        subiendo = false;
      }
    };
    void (async () => {
      await dormir(600); // que la superficie tenga imagen
      while (vivo) {
        const t0 = Date.now();
        let espera = LOCAL_SIN_PERSONA_MS;
        const foto = await conCamara(() => tomar({ base64: false, quality: CALIDAD.bucle }));
        if (!vivo) {
          borrar(foto?.uri);
          break;
        }
        if (foto) {
          if (mlOk.current) {
            try {
              const caras = await FaceDetection.detect(foto.uri, OPCIONES_ML);
              fallos = 0;
              const personas = cb.current.onCaras(caras.map(caraDeMlkit), foto.width, foto.height);
              conPersona = personas > 0;
              // Llegó o se fue alguien: la escena cambió, la próxima subida vuelve al ritmo de base.
              if (personasAntes >= 0 && personas !== personasAntes) sinCambios = 0;
              personasAntes = personas;
            } catch (e) {
              fallos += 1;
              if (fallos >= FALLOS_ML_MAX) {
                mlOk.current = false;
                avisarUnaVez('sinml', `cámara: ML Kit no responde (${String((e as Error)?.message || e).slice(0, 80)}), paso al servidor`);
                cb.current.onSinDetector();
              }
            }
          }
          const dormida = dormidoRef.current;
          const cadaServidor = intervaloServidor({ mlkit: mlOk.current, dormida, conPersona, necesitaEscena: observarRef.current, sinCambios });
          if (!subiendo && Date.now() - ultimoServidor >= cadaServidor) {
            ultimoServidor = Date.now();
            void servidor(foto.uri); // lee la foto y la borra él
          } else {
            borrar(foto.uri);
          }
          espera = mlOk.current ? (dormida ? LOCAL_DORMIDA_MS : conPersona ? LOCAL_CON_PERSONA_MS : LOCAL_SIN_PERSONA_MS) : cadaServidor;
        }
        await dormir(espera - (Date.now() - t0));
      }
    })();
    return () => {
      vivo = false;
    };
  }, [activa, conCamara, tomar]);

  const lista = useCallback(async () => {
    listaRef.current = true;
    if (tamano !== undefined || !ref.current) return;
    try {
      const t = elegirTamano(await ref.current.getAvailablePictureSizesAsync());
      setTamano(t ?? '');
    } catch {
      setTamano('');
    }
  }, [tamano]);

  if (!activa) return null;
  // Misma vista con otro estilo: la cámara no se vuelve a montar al mostrarla u ocultarla.
  return (
    <View style={previa ? styles.previa : styles.box} pointerEvents="none">
      <CameraView
        ref={ref}
        style={StyleSheet.absoluteFill}
        facing="front"
        animateShutter={false}
        pictureSize={tamano || undefined}
        onCameraReady={() => void lista()}
      />
    </View>
  );
}

// ---------------------------------------------------------------- componente público

export function CamaraVision({ enabled, dormido = false, grabRef, onEscena, onGaze, onObjects, onVista, onMotor, observar = false, previa = false }: CamaraVisionProps) {
  const cb = useRef({ onEscena, onGaze, onObjects, onVista, onMotor });
  cb.current = { onEscena, onGaze, onObjects, onVista, onMotor };
  const appActiva = useAppActiva();
  const maquina = useRef(new MaquinaEscena(UMBRALES_FOTOS)).current;
  const ultimaEscena = useRef<Escena | null>(null);
  const ultimaEmision = useRef(0);
  const gaze = useRef({ x: 0, y: 0, activa: false });
  const motorAnunciado = useRef<MotorVision | null>(null);
  const dormidoRef = useRef(dormido);
  dormidoRef.current = dormido;
  const activa = enabled && appActiva;

  const anunciarMotor = useCallback((m: MotorVision) => {
    if (motorAnunciado.current === m) return;
    motorAnunciado.current = m;
    cb.current.onMotor?.(m);
  }, []);

  const emitir = useCallback((e: Escena) => {
    ultimaEscena.current = e;
    const now = Date.now();
    if (e.eventos.length || now - ultimaEmision.current >= ESCENA_CADA_MS) {
      ultimaEmision.current = now;
      cb.current.onEscena?.(e);
    }
  }, []);

  // Cámara apagada / sin permiso: una sola escena 'ninguno' y mirada libre.
  useEffect(() => {
    if (enabled) return;
    maquina.reiniciar();
    anunciarMotor('ninguno');
    const e = escenaApagada(Date.now());
    ultimaEscena.current = e;
    cb.current.onEscena?.(e);
    if (gaze.current.activa) {
      gaze.current = { x: 0, y: 0, activa: false };
      cb.current.onGaze?.(0, 0, false);
    }
  }, [enabled, anunciarMotor, maquina]);

  const conDetector = useRef(true);

  // ML Kit: caras de una foto → escena → mirada suavizada hacia la persona.
  const onCaras = useCallback(
    (caras: CaraMlkit[], w: number, h: number) => {
      anunciarMotor('mlkit');
      const ts = Date.now();
      const obs = observacionMlkit(caras, w, h, 'portrait', ts);
      const e = maquina.procesar(obs, { inmediato: dormidoRef.current });
      const g = gaze.current;
      if (e.principal) {
        const a = g.activa ? 0.5 : 1;
        g.x += (e.principal.x - g.x) * a;
        g.y += (e.principal.y - g.y) * a;
        g.activa = true;
        cb.current.onGaze?.(g.x, g.y, true);
      } else if (g.activa && e.personas === 0) {
        g.activa = false;
        cb.current.onGaze?.(g.x, g.y, false);
      }
      emitir(e);
      return e.personas;
    },
    [anunciarMotor, emitir, maquina]
  );

  const onSinDetector = useCallback(() => {
    conDetector.current = false;
  }, []);

  // La vista del nodo de visión: objetos y comentarios siempre; la presencia solo si no hay ML Kit
  // (con ML Kit, quién está delante lo sabe el teléfono, y mejor).
  const onVistaMotor = useCallback(
    (v: VistaCamara) => {
      const labels = etiquetasDeVista(v);
      if (labels.length) cb.current.onObjects?.(labels);
      cb.current.onVista?.(v);
      if (conDetector.current) return;
      anunciarMotor('servidor');
      const e = escenaDesdeEtiquetas(labels, Date.now(), ultimaEscena.current);
      const hay = e.personas > 0;
      if (hay !== gaze.current.activa) {
        gaze.current = { x: 0, y: 0, activa: hay };
        cb.current.onGaze?.(0, 0, hay);
      }
      emitir(e);
    },
    [anunciarMotor, emitir]
  );

  if (!enabled) return null;
  return (
    <CamaraMotor
      activa={activa}
      dormido={dormido}
      observar={observar}
      previa={previa}
      grabRef={grabRef}
      onCaras={onCaras}
      onSinDetector={onSinDetector}
      onVista={onVistaMotor}
    />
  );
}

const styles = StyleSheet.create({
  /**
   * El preview NO puede ser de 1×1 px. Con una superficie así de pequeña, `takePictureAsync` en
   * Android devuelve una imagen rota o de un píxel: el nodo de visión no ve nada y AU-RA acababa
   * diciendo «la cámara me está mostrando un error técnico». Necesita una superficie real; queda
   * casi invisible (2% de opacidad, 96×72 en una esquina) sobre el negro de la mesa.
   */
  box: { position: 'absolute', left: 0, bottom: 0, width: 96, height: 72, opacity: 0.02, overflow: 'hidden' },
  /** Visible para apuntar: arriba a la derecha, como un espejo chico (la vista frontal sale espejada). */
  previa: {
    position: 'absolute',
    right: 12,
    top: 96,
    width: 132,
    height: 176,
    opacity: 1,
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    zIndex: 30,
    elevation: 30,
  },
});
