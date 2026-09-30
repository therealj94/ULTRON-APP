/**
 * Dónde se recuerda que este teléfono no aguantó el 3D (AsyncStorage, por huella del modelo), para
 * no volver a intentarlo cada vez que se abre un chat. La decisión está en capacidad.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { miga } from '../lib/reporte';
import { anotarFallo, puede3D, type RegistroCapacidad } from './capacidad';

const CLAVE = 'aura.avatar3d.capacidad.v1';

let registro: RegistroCapacidad | null = null;
let cargando: Promise<void> | null = null;
/** Lo que falló en esta sesión no se vuelve a intentar aunque el disco no se haya podido escribir. */
const falloEnSesion = new Set<string>();

function cargar(): Promise<void> {
  if (!cargando) {
    cargando = AsyncStorage.getItem(CLAVE)
      .then((t) => {
        const r = JSON.parse(t || 'null');
        registro = r && typeof r === 'object' && !Array.isArray(r) ? (r as RegistroCapacidad) : {};
      })
      .catch(() => {
        registro = {};
      });
  }
  return cargando;
}

/** ¿Se intenta el 3D con este modelo en este teléfono? */
export async function puedeProbar3D(huella: string): Promise<boolean> {
  if (falloEnSesion.has(huella)) return false;
  await cargar();
  return puede3D(registro, huella, Date.now());
}

/** El 3D falló con este modelo: se anota (y se cuenta en el diagnóstico de campo). */
export function recordarFallo3D(huella: string, motivo: string) {
  if (falloEnSesion.has(huella)) return;
  falloEnSesion.add(huella);
  miga(`avatar 3D: vuelve a 2D (${String(motivo).slice(0, 80)})`);
  registro = anotarFallo(registro, huella, motivo, Date.now());
  void AsyncStorage.setItem(CLAVE, JSON.stringify(registro)).catch(() => {});
}
