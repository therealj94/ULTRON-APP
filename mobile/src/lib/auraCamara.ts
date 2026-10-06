/**
 * La cámara en vivo (modules/aura-camara, Android): el puente con el nativo.
 *
 * `camaraVivaDisponible()` es false si este binario no trae el módulo (una APK anterior que recibió este
 * JS por OTA, o iOS): entonces la mesa sigue con la cámara de fotos (components/CamaraVision.tsx). La vista
 * nativa solo se pide si el módulo está: pedirla sin él rompería al dibujar.
 *
 * Recortes en base64 y no por archivo: la WebView del motor de caras (src/caras/MotorCaras.tsx) carga su
 * página con origen https y sin acceso a file://; abrirle `allowFileAccess(FromFileURLs)` para leer un
 * recorte dejaría a esa página leer cualquier archivo de la app. Un recorte de ~290 px son ~15 KB en base64:
 * pasarlo por JS cuesta menos que leerlo del disco.
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';
import type { CajaF } from './camaraNativa';

/**
 * `ts`: hora de CAPTURA del cuadro (pared, ms). `epoca`/`cuadro`/`lado`: de qué enlace de CameraX y qué cuadro salió
 * (APK con el módulo nuevo; una anterior no los manda) — lib/cercoCamara.ts los cerca antes de usarlos (CAM-C).
 */
export type RecorteNativo = { b64?: string; uri?: string; caja?: CajaF; w: number; h: number; ts: number; tam?: number; bytes?: number; epoca?: number; cuadro?: number; lado?: string };
export type FotoNativa = { b64?: string; uri?: string; w: number; h: number; origen?: 'captura' | 'cuadro'; bytes?: number; ts?: number; epoca?: number; cuadro?: number; lado?: string };

type ModuloCamara = {
  disponible(): boolean;
  version(): number;
  recorte(id: number, margen: number | null, lado: number | null, archivo: boolean | null): Promise<RecorteNativo | null>;
  foto(calidad: number | null, alta: boolean | null, archivo: boolean | null): Promise<FotoNativa | null>;
  limpiar(): boolean;
};

export type PropsVistaNativa = ViewProps & {
  lado?: 'frontal' | 'trasera';
  activa?: boolean;
  hz?: number;
  fps?: number;
  ladoCorto?: number;
  minCara?: number;
  onCaras?: (e: { nativeEvent: unknown }) => void;
  onEstado?: (e: { nativeEvent: unknown }) => void;
};

let modulo: ModuloCamara | null | undefined;
let vista: ComponentType<PropsVistaNativa> | null | undefined;

function camara(): ModuloCamara | null {
  if (modulo !== undefined) return modulo;
  try {
    modulo = Platform.OS === 'android' ? requireOptionalNativeModule<ModuloCamara>('AuraCamara') : null;
  } catch {
    modulo = null;
  }
  return modulo;
}

export function camaraVivaDisponible(): boolean {
  try {
    return !!camara()?.disponible();
  } catch {
    return false;
  }
}

/** La vista nativa (CameraX + ML Kit), o null si este binario no la trae. */
export function VistaCamaraNativa(): ComponentType<PropsVistaNativa> | null {
  if (vista !== undefined) return vista;
  try {
    vista = camaraVivaDisponible() ? requireNativeView<PropsVistaNativa>('AuraCamara') : null;
  } catch {
    vista = null;
  }
  return vista;
}

/** Un recorte de la cara `id` del último cuadro (-1: la más grande), en base64. null si ya no está. */
export async function recorteNativo(id: number, opciones?: { margen?: number; lado?: number }): Promise<RecorteNativo | null> {
  const m = camara();
  if (!m) return null;
  try {
    const r = await m.recorte(id, opciones?.margen ?? 0.6, opciones?.lado ?? 288, false);
    return r && typeof r.b64 === 'string' && r.b64.length > 200 ? r : null;
  } catch {
    return null;
  }
}

/** La foto entera en base64 (`alta`: con la cámara de fotos de CameraX, ~1280×960; si no, el último cuadro). */
export async function fotoNativa(calidad: number, alta = true): Promise<FotoNativa | null> {
  const m = camara();
  if (!m) return null;
  try {
    const r = await m.foto(calidad, alta, false);
    return r && typeof r.b64 === 'string' ? r : null;
  } catch {
    return null;
  }
}

export function limpiarCamaraNativa() {
  try {
    camara()?.limpiar();
  } catch {
    /* */
  }
}
