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
 * `vista` («Lo que veo», José 5-oct: «ver lo que mira y que salga el cuadro de lo que reconoce»): la vista
 * de la cámara se hace GRANDE (en el lugar del avatar) con un recuadro en cada cara (su nombre votado o
 * «Persona», y «mirando» si mira la pantalla), los objetos con caja del servidor y una línea de estado.
 * La misma vista sirve para apuntar lo que se quiere leer («léeme esto»). El marco toma la proporción de
 * la foto, así lo que se ve es lo que analiza ML Kit (lib/vistaEnVivo.ts hace las cuentas, con el espejo
 * de la frontal). Cerrada, la cámara sigue casi invisible.
 *
 * `lado`: frontal o trasera. Cambiar vuelve a montar la cámara (`key`), pide otra vez el tamaño de foto
 * (cada cámara tiene los suyos) y espera su `onCameraReady`. Con la trasera los ojos del avatar no siguen
 * caras (no son quien mira la pantalla) y la escena lo dice.
 *
 * Reconocer caras (`caras`): la MISMA foto del bucle, con las cajas de ML Kit, va al motor de caras
 * cuando lo pide (useCaras) — no se toma una segunda foto. Se lee del disco una sola vez, aunque también
 * vaya al servidor.
 *
 * Motor 'servidor' (respaldo): si ML Kit no está o falla 3 veces seguidas, se vuelve al de antes
 * —una foto cada 12 s (30 s dormida) al servidor—, pero ya con la foto chica. Esa misma foto también va
 * al motor de caras (`onFotoRespaldo`, sin cajas: el motor las busca) para seguir reconociendo sin ML Kit;
 * con ML Kit la foto va por `onCaras` y nunca por las dos vías.
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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { CameraView } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import FaceDetection from '@react-native-ml-kit/face-detection';
import { verCamara } from '../lib/api';
import { LOCAL_CON_PERSONA_MS, LOCAL_DORMIDA_MS, LOCAL_SIN_PERSONA_MS } from '../lib/camaraModo';
import { etiquetasDeVista, intervaloServidor, mismaEscena, type VistaCamara } from '../lib/vistaCamara';
import { reportarEstado } from '../lib/reporte';
import { idiomaActual, tr } from '../i18n';
import { T } from '../tema';
import { cajaEnPantalla, cajaNormal, etiquetaCara, lineaEstado, marcasEnVivo, marcoParaFoto, type Lado } from '../lib/vistaEnVivo';
import type { Seguidor } from '../caras/seguimiento';
import type { FotoCaras } from '../caras/useCaras';
import {
  MIN_CARA_MLKIT,
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
/** Lo más que se espera una foto (ver `tomar`). */
const FOTO_MAX_MS = 5_000;
/** Menos base64 que esto no es una foto: es la cámara todavía sin imagen. */
const MINIMO_FOTO = 4_000;

const OPCIONES_ML = {
  performanceMode: 'fast',
  landmarkMode: 'none',
  contourMode: 'none',
  classificationMode: 'all',
  // Antes 0.12: perdía a quien se echaba atrás (~1,8 m en vertical). Ver lib/escena.ts MIN_CARA_MLKIT.
  minFaceSize: MIN_CARA_MLKIT,
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
  /** «Lo que veo»: la vista de la cámara visible y grande, con lo reconocido encima (también para apuntar). */
  vista?: boolean;
  /** Dónde cabe la vista abierta (px de la pantalla): el lugar del avatar, fuera del chat y la barra. */
  marcoVista?: { left: number; top: number; width: number; height: number };
  /** La cámara en uso. */
  lado?: Lado;
  onVoltear?: () => void;
  onCerrarVista?: () => void;
  /** Las caras seguidas entre fotos con su nombre votado (useCaras): se actualiza aquí, foto a foto. */
  seguidor?: Seguidor;
  /**
   * Reconocer caras con la foto del bucle (useCaras): si la quiere y qué hacer con ella. Con ML Kit, con sus
   * cajas (`quiereFoto`/`recibirFoto`); sin ML Kit (respaldo del servidor), la foto entera
   * (`quiereFotoRespaldo`/`recibirFotoRespaldo`). Cada foto va por UNA sola vía.
   */
  caras?: {
    reconoce: boolean;
    quiereFoto: (ts: number) => boolean;
    recibirFoto: (f: FotoCaras) => void;
    quiereFotoRespaldo?: (ts: number) => boolean;
    recibirFotoRespaldo?: (f: { b64: string; ts: number }) => void;
  };
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
  lado: Lado;
  /** La vista abierta: dónde va (ya con la proporción de la foto) y lo que se dibuja encima. */
  vista: { left: number; top: number; width: number; height: number } | null;
  capa?: ReactNode;
  grabRef?: React.MutableRefObject<FrameGrabber | null>;
  /**
   * Caras de una foto (ML Kit). Devuelve cuántas personas cuenta la escena y, si el motor de caras quiere
   * ESTA foto, a quién dársela (se le pasa en base64; la foto se borra igual).
   */
  onCaras: (caras: CaraMlkit[], w: number, h: number) => { personas: number; pedir?: (b64: string) => void };
  /** ML Kit no está o dejó de responder: a partir de aquí solo el servidor. */
  onSinDetector: () => void;
  /**
   * Sin ML Kit (respaldo del servidor): si el motor de caras quiere ESTA foto entera (sin cajas), a quién
   * dársela. Con ML Kit no se llama (las caras van por `onCaras`).
   */
  onFotoRespaldo: (ts: number) => ((b64: string) => void) | undefined;
  onVista: (v: VistaCamara) => void;
};

function CamaraMotor({ activa, dormido, observar, lado, vista, capa, grabRef, onCaras, onSinDetector, onFotoRespaldo, onVista }: MotorProps) {
  const ref = useRef<CameraView>(null);
  const listaRef = useRef(false);
  /** El tamaño de foto de CADA cámara (la frontal y la trasera ofrecen tamaños distintos). '' = el de fábrica. */
  const [tamanos, setTamanos] = useState<Partial<Record<Lado, string>>>({});
  const tamano = tamanos[lado];
  // Otra cámara: se vuelve a montar (key) y hasta su onCameraReady no se toman fotos.
  const ladoAntes = useRef(lado);
  if (ladoAntes.current !== lado) {
    ladoAntes.current = lado;
    listaRef.current = false;
  }
  const ladoRef = useRef(lado);
  ladoRef.current = lado;
  /** Una sola foto a la vez: el bucle y «qué ves» no pueden disparar juntos. */
  const ocupada = useRef(false);
  const mlOk = useRef(true);
  const dormidoRef = useRef(dormido);
  dormidoRef.current = dormido;
  const observarRef = useRef(observar);
  observarRef.current = observar;
  const cb = useRef({ onCaras, onSinDetector, onFotoRespaldo, onVista });
  cb.current = { onCaras, onSinDetector, onFotoRespaldo, onVista };

  const tomar = useCallback(async (opciones: { base64: boolean; quality: number }): Promise<(Foto & { base64?: string }) | null> => {
    if (!ref.current || !listaRef.current) return null;
    try {
      // Con tope: si la cámara se desmonta a media foto (al cambiar de cámara) la promesa podría no volver
      // nunca y dejar `ocupada` tomada para siempre.
      const pedida = ref.current.takePictureAsync({ quality: opciones.quality, base64: opciones.base64, shutterSound: false });
      const f = await Promise.race([pedida, dormir(FOTO_MAX_MS).then(() => null)]);
      if (!f) {
        void pedida.then((tarde) => borrar(tarde?.uri)).catch(() => {});
        return null;
      }
      if (!f.uri) return null;
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
    const servidor = async (b64: string) => {
      subiendo = true;
      try {
        if (!b64 || b64.length < MINIMO_FOTO) return;
        avisarUnaVez('buena', `cámara: primera foto al servidor (${b64.length} car. base64)`);
        const r = await verCamara(b64, 'escena');
        if (!vivo || !r?.vista) return;
        sinCambios = mismaEscena(vistaAntes, r.vista) ? sinCambios + 1 : 0;
        vistaAntes = r.vista;
        cb.current.onVista(r.vista);
      } catch {
        /* sin vista esta vez */
      } finally {
        subiendo = false;
      }
    };
    void (async () => {
      await dormir(600); // que la superficie tenga imagen
      while (vivo) {
        const t0 = Date.now();
        let espera = LOCAL_SIN_PERSONA_MS;
        const ladoFoto = ladoRef.current;
        const foto = await conCamara(() => tomar({ base64: false, quality: CALIDAD.bucle }));
        if (!vivo) {
          borrar(foto?.uri);
          break;
        }
        // Una foto de la cámara anterior (se cambió mientras la tomaba) no vale para la de ahora.
        if (foto && ladoFoto !== ladoRef.current) {
          borrar(foto.uri);
          await dormir(200);
          continue;
        }
        if (foto) {
          let pedir: ((b64: string) => void) | undefined;
          if (mlOk.current) {
            try {
              const caras = await FaceDetection.detect(foto.uri, OPCIONES_ML);
              fallos = 0;
              const r = cb.current.onCaras(caras.map(caraDeMlkit), foto.width, foto.height);
              const personas = r.personas;
              pedir = r.pedir;
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
          } else pedir = cb.current.onFotoRespaldo(Date.now());
          const dormida = dormidoRef.current;
          const cadaServidor = intervaloServidor({ mlkit: mlOk.current, dormida, conPersona, necesitaEscena: observarRef.current, sinCambios });
          const subir = !subiendo && Date.now() - ultimoServidor >= cadaServidor;
          if (subir) ultimoServidor = Date.now();
          // La foto se lee UNA vez (si el servidor o el motor de caras la quieren) y se borra siempre.
          let b64: string | null = null;
          if (subir || pedir) b64 = await FileSystem.readAsStringAsync(foto.uri, { encoding: FileSystem.EncodingType.Base64 }).catch(() => null);
          borrar(foto.uri);
          if (b64 && b64.length >= MINIMO_FOTO) {
            if (pedir) pedir(b64);
            if (subir) void servidor(b64);
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
    const de = lado;
    try {
      const t = elegirTamano(await ref.current.getAvailablePictureSizesAsync());
      setTamanos((x) => ({ ...x, [de]: t ?? '' }));
    } catch {
      setTamanos((x) => ({ ...x, [de]: '' }));
    }
  }, [lado, tamano]);

  if (!activa) return null;
  // Misma vista con otro estilo: la cámara no se vuelve a montar al mostrarla u ocultarla (solo al cambiar
  // de cámara, por la key). Abierta, solo los botones de la capa reciben toques.
  return (
    <View style={vista ? [styles.vista, vista] : styles.box} pointerEvents={vista ? 'box-none' : 'none'}>
      <CameraView
        key={lado}
        ref={ref}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        facing={lado === 'trasera' ? 'back' : 'front'}
        animateShutter={false}
        pictureSize={tamano || undefined}
        onCameraReady={() => void lista()}
      />
      {vista ? capa : null}
    </View>
  );
}

// ---------------------------------------------------------------- componente público

/** Mientras la vista está abierta, se redibuja al menos así de seguido (los recuadros viejos se van). */
const VISTA_TIC_MS = 500;

export function CamaraVision({
  enabled,
  dormido = false,
  grabRef,
  onEscena,
  onGaze,
  onObjects,
  onVista,
  onMotor,
  observar = false,
  vista = false,
  marcoVista,
  lado = 'frontal',
  onVoltear,
  onCerrarVista,
  seguidor,
  caras,
}: CamaraVisionProps) {
  const cb = useRef({ onEscena, onGaze, onObjects, onVista, onMotor, caras });
  cb.current = { onEscena, onGaze, onObjects, onVista, onMotor, caras };
  const appActiva = useAppActiva();
  const maquina = useRef(new MaquinaEscena(UMBRALES_FOTOS)).current;
  const ultimaEscena = useRef<Escena | null>(null);
  const ultimaEmision = useRef(0);
  const gaze = useRef({ x: 0, y: 0, activa: false });
  const motorAnunciado = useRef<MotorVision | null>(null);
  const dormidoRef = useRef(dormido);
  dormidoRef.current = dormido;
  const ladoRef = useRef(lado);
  ladoRef.current = lado;
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const activa = enabled && appActiva;
  /** Lo último que se dibuja en la vista: tamaño de la foto y la vista del servidor (objetos con caja). */
  const foto = useRef<{ w: number; h: number } | null>(null);
  const vistaServidor = useRef<{ v: VistaCamara; ts: number } | null>(null);
  const [, setTic] = useState(0);

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

  const soltarMirada = useCallback(() => {
    if (!gaze.current.activa) return;
    gaze.current = { x: 0, y: 0, activa: false };
    cb.current.onGaze?.(0, 0, false);
  }, []);

  // Cámara apagada / sin permiso: una sola escena 'ninguno' y mirada libre.
  useEffect(() => {
    if (enabled) return;
    maquina.reiniciar();
    seguidor?.reiniciar();
    vistaServidor.current = null;
    anunciarMotor('ninguno');
    const e = escenaApagada(Date.now());
    ultimaEscena.current = e;
    cb.current.onEscena?.(e);
    soltarMirada();
  }, [enabled, anunciarMotor, maquina, seguidor, soltarMirada]);

  // Otra cámara: lo visto con la anterior no vale (ni la escena, ni las caras, ni los objetos).
  const ladoVisto = useRef(lado);
  useEffect(() => {
    if (ladoVisto.current === lado) return;
    ladoVisto.current = lado;
    maquina.reiniciar();
    seguidor?.reiniciar();
    foto.current = null;
    vistaServidor.current = null;
    soltarMirada();
  }, [lado, maquina, seguidor, soltarMirada]);

  // Con la vista abierta se redibuja seguido: los recuadros de hace más de 1,5 s se van aunque no llegue foto.
  useEffect(() => {
    if (!vista || !activa) return;
    const t = setInterval(() => setTic((n) => n + 1), VISTA_TIC_MS);
    return () => clearInterval(t);
  }, [vista, activa]);

  const conDetector = useRef(true);

  // ML Kit: caras de una foto → escena → mirada suavizada hacia la persona (solo con la frontal), las
  // pistas de cada cara y, si el motor de caras quiere esta foto, a quién dársela.
  const onCaras = useCallback(
    (lista: CaraMlkit[], w: number, h: number) => {
      anunciarMotor('mlkit');
      const ts = Date.now();
      const trasera = ladoRef.current === 'trasera';
      foto.current = { w, h };
      const obs = observacionMlkit(lista, w, h, 'portrait', ts, undefined, { trasera });
      const e = maquina.procesar(obs, { inmediato: dormidoRef.current });
      const g = gaze.current;
      if (e.principal && !trasera) {
        const a = g.activa ? 0.5 : 1;
        g.x += (e.principal.x - g.x) * a;
        g.y += (e.principal.y - g.y) * a;
        g.activa = true;
        cb.current.onGaze?.(g.x, g.y, true);
      } else if (g.activa && (e.personas === 0 || trasera)) {
        g.activa = false;
        cb.current.onGaze?.(g.x, g.y, false);
      }
      emitir(e);
      let pedir: ((b64: string) => void) | undefined;
      if (seguidor) {
        const cajas = lista.map((c) => cajaNormal(c.bounds, w, h)).filter((c): c is NonNullable<typeof c> => !!c);
        const pistas = seguidor.actualizar(cajas, ts);
        const c = cb.current.caras;
        if (c && pistas.length && c.quiereFoto(ts)) {
          // Las 4 caras más grandes (el motor no analiza más por foto).
          const elegidas = pistas.map((p) => ({ pista: p.id, caja: p.caja })).sort((a, b) => b.caja.h - a.caja.h).slice(0, 4);
          pedir = (b64) => cb.current.caras?.recibirFoto({ b64, cajas: elegidas, ts });
        }
      }
      if (vistaRef.current) setTic((n) => n + 1);
      return { personas: e.personas, pedir };
    },
    [anunciarMotor, emitir, maquina, seguidor]
  );

  const onSinDetector = useCallback(() => {
    conDetector.current = false;
  }, []);

  // Sin ML Kit: la foto del respaldo también va al motor de caras (si la quiere), para seguir reconociendo.
  const onFotoRespaldo = useCallback((ts: number) => {
    if (!cb.current.caras?.quiereFotoRespaldo?.(ts)) return undefined;
    return (b64: string) => cb.current.caras?.recibirFotoRespaldo?.({ b64, ts });
  }, []);

  // La vista del nodo de visión: objetos y comentarios siempre; la presencia solo si no hay ML Kit
  // (con ML Kit, quién está delante lo sabe el teléfono, y mejor).
  const onVistaMotor = useCallback(
    (v: VistaCamara) => {
      vistaServidor.current = { v, ts: Date.now() };
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

  // «Lo que veo»: el marco con la proporción de la foto, lo más grande que quepa, centrado arriba.
  let marco: { left: number; top: number; width: number; height: number } | null = null;
  let capa: ReactNode = null;
  if (vista && marcoVista && marcoVista.width > 40 && marcoVista.height > 40) {
    const m = marcoParaFoto(foto.current, { w: marcoVista.width, h: marcoVista.height });
    marco = { left: marcoVista.left + (marcoVista.width - m.w) / 2, top: marcoVista.top, width: m.w, height: m.h };
    const ahora = Date.now();
    const en = idiomaActual() === 'en';
    const visibles = seguidor?.visibles(ahora) || [];
    const mirando = !!ultimaEscena.current?.principal?.mirando;
    const marcas = marcasEnVivo({ pistas: visibles, mirando, lado, vista: vistaServidor.current, ahora, en });
    const dims = foto.current || { w: m.w, h: m.h };
    const estado = lineaEstado({
      lado,
      personas: conDetector.current ? visibles.length : ultimaEscena.current?.personas || 0,
      mirando,
      nombres: visibles.filter((p) => p.identidad).map((p) => etiquetaCara(p.identidad, lado, en)),
      reconociendo: !!caras?.reconoce && visibles.some((p) => !p.identidad),
      sinDetector: !conDetector.current,
      en,
    });
    capa = (
      <>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {marcas.map((mk) => {
            const r = cajaEnPantalla(mk.caja, dims, m, lado === 'frontal');
            if (!r) return null;
            const cara = mk.tipo === 'cara';
            return (
              <View key={mk.clave} style={[styles.caja, cara ? (mk.conocida ? styles.cajaConocida : styles.cajaCara) : styles.cajaObjeto, r]}>
                <Text numberOfLines={1} style={[styles.etiqueta, r.top < 24 && styles.etiquetaDentro, cara ? (mk.conocida ? styles.etiquetaConocida : styles.etiquetaCara) : styles.etiquetaObjeto]}>
                  {mk.etiqueta}
                  {mk.detalle ? ` · ${mk.detalle}` : ''}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={styles.botones} pointerEvents="box-none">
          {onVoltear ? (
            <Pressable onPress={onVoltear} hitSlop={8} style={styles.boton} accessibilityRole="button" accessibilityLabel={tr('Cambiar de cámara', 'Switch camera')}>
              <Text style={styles.botonTexto}>{lado === 'frontal' ? tr('Trasera', 'Back') : tr('Frontal', 'Front')}</Text>
            </Pressable>
          ) : null}
          {onCerrarVista ? (
            <Pressable onPress={onCerrarVista} hitSlop={8} style={styles.boton} accessibilityRole="button" accessibilityLabel={tr('Cerrar lo que veo', 'Close what I see')}>
              <Text style={styles.botonTexto}>{tr('Cerrar', 'Close')}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.estado} pointerEvents="none">
          <Text numberOfLines={2} style={styles.estadoTexto}>
            {estado}
          </Text>
        </View>
      </>
    );
  }

  return (
    <CamaraMotor
      activa={activa}
      dormido={dormido}
      observar={observar}
      lado={lado}
      vista={marco}
      capa={capa}
      grabRef={grabRef}
      onCaras={onCaras}
      onSinDetector={onSinDetector}
      onFotoRespaldo={onFotoRespaldo}
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
  /** «Lo que veo»: grande, en el lugar del avatar (el tamaño y el lugar los pone `marcoVista`). */
  vista: {
    position: 'absolute',
    opacity: 1,
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    backgroundColor: '#000',
    zIndex: 40,
    elevation: 40,
  },
  caja: { position: 'absolute', borderWidth: 2, borderRadius: 6 },
  // Caras: blanco si no se sabe quién es, dorado (el acento de AU-RA) si se la reconoce. Objetos: salvia, a trazos.
  cajaCara: { borderColor: 'rgba(255,255,255,0.9)' },
  cajaConocida: { borderColor: T.principal },
  cajaObjeto: { borderColor: T.activo, borderStyle: 'dashed', borderRadius: 3 },
  etiqueta: { position: 'absolute', left: -2, top: -22, maxWidth: 220, fontSize: 12.5, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  /** Una caja pegada al borde de arriba lleva el nombre por dentro (por fuera no se vería). */
  etiquetaDentro: { top: 2, left: 2 },
  etiquetaCara: { color: '#111', backgroundColor: 'rgba(255,255,255,0.9)' },
  etiquetaConocida: { color: T.sobrePrincipal, backgroundColor: T.principal },
  etiquetaObjeto: { color: '#111', backgroundColor: T.activo, fontWeight: '700' },
  botones: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 8 },
  boton: { backgroundColor: 'rgba(18,19,22,0.82)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  botonTexto: { color: '#F2EEE8', fontSize: 13, fontWeight: '800' },
  estado: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(18,19,22,0.72)' },
  estadoTexto: { color: '#F2EEE8', fontSize: 13.5, fontWeight: '700', textAlign: 'center' },
});
