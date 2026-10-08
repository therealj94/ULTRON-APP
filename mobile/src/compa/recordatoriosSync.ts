/**
 * EL PEGAMENTO DE LOS RECORDATORIOS DEL SERVIDOR (A-3; la lógica pura en compa/recordatoriosServidor.ts).
 *
 *  · `reconciliarRecordatorios`: lee GET /api/recordatorios, lee las alarmas de notifee de quien está dentro y pone,
 *    quita o sube lo que haga falta. Se llama al arrancar con sesión (push/nativo.ts usePush), al llegar el push de un
 *    recordatorio (también con la app cerrada) y al cambiar algo en la hoja «Recordatorios». Una a la vez; nunca lanza.
 *  · `alCambiarEnHoja` (tanda F1): marcar hecho o borrar en la hoja quita YA la alarma de este teléfono que ya no debe
 *    sonar (la de esa vez), sin esperar a reconciliar (que no quita la de la vez recién entregada).
 *  · `anotarAlarmaServidor` / `alarmaYaPuesta`: qué alarmas del servidor se pusieron en ESTE teléfono (AsyncStorage), para
 *    no enseñar el push de una vez que ya sonó aquí con notifee.
 *
 * Todo JS (notifee y Firebase ya vienen en el APK): llega por OTA.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';
import { miga } from '../lib/reporte';
import { depsRecordatorios } from './recordatoriosNativo';
import { idsDe, listarRecordatorios, programarRecordatorio, quitarAlarmasAlCambiar } from './recordatorios';
import { anotarPuesta, baseServidor, listaDelServidor, planReconciliar, pushYaSonoAqui, type Puestas, type RecordatorioDelServidor } from './recordatoriosServidor';

const CLAVE_PUESTAS = 'aura.recordatorios.puestas.v1';

async function leerPuestas(): Promise<Puestas> {
  try {
    const s = await AsyncStorage.getItem(CLAVE_PUESTAS);
    const v = s ? JSON.parse(s) : {};
    return v && typeof v === 'object' ? (v as Puestas) : {};
  } catch {
    return {};
  }
}

async function guardarPuestas(p: Puestas) {
  await AsyncStorage.setItem(CLAVE_PUESTAS, JSON.stringify(p)).catch(() => undefined);
}

/** Se puso aquí la alarma de esta vez de un recordatorio del servidor. */
export async function anotarAlarmaServidor(rid: string, cuando: number): Promise<void> {
  await guardarPuestas(anotarPuesta(await leerPuestas(), baseServidor(rid, cuando), cuando, Date.now()));
}

/** ¿El push de esta vez es de una alarma que ya estaba puesta aquí? (entonces no se enseña). */
export async function alarmaYaPuesta(rid: string | undefined, cuando: number | undefined): Promise<boolean> {
  if (!rid) return false;
  return pushYaSonoAqui({ rid, cuando }, await leerPuestas());
}

let enCurso: Promise<void> | null = null;
let otraVez = false;

/** Que las alarmas de este teléfono sean las del servidor. Una a la vez (si piden otra mientras, se hace al terminar). */
export function reconciliarRecordatorios(motivo: string): Promise<void> {
  if (enCurso) {
    otraVez = true;
    return enCurso;
  }
  enCurso = (async () => {
    try {
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        otraVez = false;
        const subio = await unaVuelta(motivo);
        if (!subio && !otraVez) break;
      }
    } catch {
      /* nunca tumba nada: la próxima vez */
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

/** Una vuelta. true si subió algo al servidor (hay que mirar otra vez para cambiar la alarma vieja por la suya). */
async function unaVuelta(motivo: string): Promise<boolean> {
  if (!depsRecordatorios.dueno?.()) return false;
  let lista;
  try {
    // De fondo: no pide la huella (lib/permisoHuella.ts); si falla, nada se toca.
    lista = listaDelServidor(await api('/api/recordatorios', { method: 'GET' }, 15_000, true, { deLaPersona: false }));
  } catch (e: any) {
    miga(`recordatorios: no pude leer el servidor (${String(e?.status || e?.message || 'error').slice(0, 30)})`);
    return false;
  }
  const n = depsRecordatorios.notifee();
  if (!n) return false;
  const ahora = Date.now();
  const locales = await listarRecordatorios(depsRecordatorios);
  const plan = planReconciliar(lista, locales, ahora, { adoptar: true });
  if (plan.quitar.length && n.m.cancelTriggerNotifications) await n.m.cancelTriggerNotifications(plan.quitar.flatMap(idsDe)).catch(() => undefined);
  let puestas = await leerPuestas();
  for (const a of plan.poner) {
    const r = await programarRecordatorio({ texto: a.texto, cuando: a.cuando, llamada: a.llamada, rid: a.rid }, depsRecordatorios);
    if (r.ok) puestas = anotarPuesta(puestas, baseServidor(a.rid, a.cuando), a.cuando, ahora);
  }
  await guardarPuestas(puestas);
  let subio = false;
  for (const x of plan.subir) {
    try {
      await api('/api/recordatorios', { method: 'POST', body: JSON.stringify(x) }, 15_000, true, { deLaPersona: false });
      subio = true;
    } catch {
      /* el servidor no lo tomó (lleno, borrado o sin red): la alarma del teléfono sigue */
    }
  }
  if (plan.poner.length || plan.quitar.length || plan.subir.length) miga(`recordatorios (${motivo}): +${plan.poner.length} −${plan.quitar.length} ↑${plan.subir.length}`);
  return subio;
}

/** Tanda F1: marcó hecho o borró uno en la hoja: su alarma de esta vez se quita ya (compa/recordatorios.ts quitarAlarmasAlCambiar). */
export async function alCambiarEnHoja(r: RecordatorioDelServidor, que: 'hecho' | 'borrar'): Promise<void> {
  if (!depsRecordatorios.dueno?.()) return;
  const quitadas = await quitarAlarmasAlCambiar(r, que, depsRecordatorios);
  if (quitadas.length) miga(`recordatorios: ${que} en la hoja, −${quitadas.length} alarma(s) de este teléfono`);
}
