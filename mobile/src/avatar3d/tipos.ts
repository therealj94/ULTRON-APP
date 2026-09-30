/**
 * LAS PALABRAS DEL AVATAR, sin nada más: qué cara pone, qué forma hace la boca, dónde la tocaron,
 * qué gesto hace y cómo se presenta. Las comparten el teléfono (la compañera 2D, el avatar 3D, las
 * pruebas en Node) y la escena 3D que corre dentro de la WebView (src/12-avatar3d, empaquetada con
 * esbuild).
 *
 * Por eso este archivo NO importa nada: la escena se empaqueta sin React Native y sin el resto de la
 * app, y lo que se importe aquí terminaría dentro de la página.
 */

/**
 * Las caras. Son las mismas de la compañera (compa/animo.ts, `Expresion`) más «tímida», la de
 * cuando le tocan la mejilla. contrato.ts comprueba al compilar que no se desincronizan.
 */
export const EXPRESIONES_AVATAR = [
  'tranquila',
  'contenta',
  'encantada',
  'enojada',
  'dormida',
  'escucha',
  'piensa',
  'sorprendida',
  'triste',
  'uy',
  'levantada',
  'timida',
] as const;
export type ExpresionAvatar = (typeof EXPRESIONES_AVATAR)[number];

/**
 * Los visemas: las 15 formas de boca del estándar de Oculus (OVR LipSync), los que traen casi
 * todos los modelos humanoides como blendshapes `viseme_*`. En español de Honduras no hay «th»
 * (z y c suenan como s), pero se deja para que el modelo sea el mismo en cualquier idioma.
 */
export const VISEMAS = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'] as const;
export type Visema = (typeof VISEMAS)[number];

/** Dónde la tocaron. «mano» y «cuerpo» se tratan como un toque cualquiera. */
export const ZONAS = ['cabeza', 'mejilla', 'panza', 'mano', 'cuerpo'] as const;
export type ZonaToque = (typeof ZONAS)[number];

/** Lo que quiso hacer el dedo (los mismos nombres que compa/gestos.ts). */
export type GestoDedo = 'toque' | 'dobleToque' | 'molestar' | 'caricia';

/** Los gestos de una sola vez (una animación que se hace y vuelve a la de fondo). */
export const GESTOS_AVATAR = ['saludar', 'senalar', 'toque_cabeza', 'toque_mejilla', 'toque_panza', 'enojo', 'gusto', 'entrar', 'salir', 'despertar'] as const;
export type GestoAvatar = (typeof GESTOS_AVATAR)[number];

/** La animación de fondo, la que se repite mientras dura el estado. */
export const BASES_AVATAR = ['idle', 'caminar', 'escuchar', 'hablar', 'pensar', 'dormir', 'levantada'] as const;
export type BaseAvatar = (typeof BASES_AVATAR)[number];

/** Cómo se encuadra: la cara y los hombros, o de cuerpo entero. */
export type Camara = 'retrato' | 'cuerpo';

/**
 * Cómo está AURA en la pantalla:
 *  · paseo    → la compañera chiquita que camina por el borde (la de siempre);
 *  · lado     → acoplada al lado de los chats (franja arriba en vertical, panel en horizontal);
 *  · completa → a pantalla completa, de frente, para hablar con ella como en la mesa.
 */
export const MODOS_PRESENCIA = ['paseo', 'lado', 'completa'] as const;
export type ModoPresencia = (typeof MODOS_PRESENCIA)[number];

/** La boca en este instante: cuánto abre (0..1) y qué forma hace (con cuánta confianza). */
export type Boca = { nivel: number; visema: Visema; peso: number };

export const BOCA_CERRADA: Boca = { nivel: 0, visema: 'sil', peso: 0 };

/**
 * Lo que un cuerpo de AURA tiene que mostrar, sea el que sea (la figurita 2D, el modelo 3D). Cambia
 * pocas veces por segundo; la boca va aparte (senalVoz.ts), que cambia 20 veces por segundo.
 */
export type EstadoAvatar = {
  expresion: ExpresionAvatar;
  /** Suena su voz (la boca sigue a `Boca`). */
  hablando: boolean;
  /** La conversación está abierta y la oye. */
  escuchando: boolean;
  /** En silencio (doble toque o «cállate»): dormida, micrófono apagado. */
  silenciado: boolean;
  /** Esperando al cerebro o conectando. */
  pensando: boolean;
  /** Paseando por el borde (solo en modo paseo). */
  caminando: boolean;
  /** Hacia dónde camina o mira el cuerpo: -1 izquierda, 1 derecha. */
  dir: -1 | 1;
  /** Adónde mira (-1..1 en cada eje; y positivo = abajo). `activa` false: mira al frente. */
  mirar: { x: number; y: number; activa: boolean };
  /** El gesto pedido; `n` distinto = pedido nuevo aunque el gesto se repita. */
  gesto: { nombre: GestoAvatar; n: number } | null;
  /** Lo último que dijo en su globito (vacío si nada). */
  globo: string;
};

export const ESTADO_INICIAL: EstadoAvatar = {
  expresion: 'tranquila',
  hablando: false,
  escuchando: false,
  silenciado: false,
  pensando: false,
  caminando: false,
  dir: 1,
  mirar: { x: 0, y: 0, activa: false },
  gesto: null,
  globo: '',
};

/** Un toque en el cuerpo: qué gesto y en qué zona. */
export type ToqueAvatar = { gesto: GestoDedo; zona: ZonaToque };

/* ── el protocolo con la escena 3D (WebView) ─────────────────────────────────────────────── */

/** Lo que el teléfono le manda a la escena con `window.__avatar(mensaje)`. */
export type AlaEscena =
  | { tipo: 'config'; camara: Camara; fpsMax: number; dprMax: number; mapeo: unknown; reducido: boolean }
  /** El modelo en pedazos de base64 (una WebView no puede leer los archivos de la APK). */
  | { tipo: 'trozo'; i: number; total: number; b64: string }
  | { tipo: 'fin'; bytes: number }
  | { tipo: 'estado'; estado: EstadoAvatar }
  | { tipo: 'boca'; nivel: number; visema: Visema; peso: number }
  | { tipo: 'camara'; camara: Camara }
  /** ¿Qué zona hay en (x, y)? Coordenadas 0..1 dentro de la vista. */
  | { tipo: 'zona'; id: number; x: number; y: number }
  | { tipo: 'pausa'; valor: boolean };

/** Lo que la escena contesta con `ReactNativeWebView.postMessage`. */
export type DeLaEscena =
  /** La página arrancó (con WebGL): ya se le puede mandar el modelo. */
  | { tipo: 'lista' }
  /** El modelo cargó y ya se dibujó el primer cuadro. */
  | { tipo: 'listo'; info: InfoModelo }
  | { tipo: 'zona'; id: number; zona: ZonaToque | null }
  /** Cuántos cuadros por segundo logra el teléfono (se mide al arrancar). */
  | { tipo: 'rendimiento'; fps: number; dpr: number; lento: boolean }
  | { tipo: 'fallo'; motivo: string };

/** Lo que la escena encontró en el modelo (para el diagnóstico y las pruebas). */
export type InfoModelo = { morphs: number; clips: string[]; huesos: number; triangulos: number; faltan: string[] };
