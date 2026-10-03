/**
 * LO QUE CONTÓ EN LAS PREGUNTAS, también en «lo que sé de ti» (POST /api/cerebro/conocer,
 * server/cerebro-continuo.ts). El perfil ya lo guarda lib/perfil.ts (con su cola y sus reintentos); esto
 * es la copia como dato para que AURA lo tenga junto a lo que aprende hablando, y la persona lo vea,
 * corrija o borre ahí. Si falla (sin red, un servidor viejo sin la ruta), no pasa nada: el perfil manda.
 *
 * Sin React Native: `enviar` se inyecta en las pruebas.
 */
import { datoConocerDe, preguntaDe, type Borrador, type PasoId } from '../primeravez/flujo';

/**
 * Con su procedencia (AUR11): `origen` (de dónde salió) y `dicho` (cuándo lo contestó; una copia de antes de
 * que la persona lo borrara no vuelve).
 */
type Enviar = (cuerpo: { categoria: string; dato: string; clave: string; origen: 'primeravez'; dicho: number }) => Promise<unknown>;

// lib/api se carga al usarlo (trae el almacenamiento del teléfono): las pruebas en Node inyectan `enviar`.
const enviarPorApi: Enviar = async (cuerpo) => {
  const { api } = require('../lib/api') as typeof import('../lib/api');
  return api('/api/cerebro/conocer', { method: 'POST', body: JSON.stringify(cuerpo) }, 10_000);
};

/** Lo de este paso como dato de «lo que sé de ti» (solo las preguntas y el apodo). Nunca lanza. */
export async function anotarEnConocer(paso: PasoId, b: Borrador, enviar: Enviar = enviarPorApi): Promise<boolean> {
  const q = preguntaDe(paso);
  const d = q ? datoConocerDe(q.campo, b.encuesta[q.campo]) : paso === 'apodo' ? datoConocerDe('apodo', b.apodo) : null;
  if (!d) return false;
  try {
    await enviar({ ...d, origen: 'primeravez', dicho: Date.now() });
    return true;
  } catch {
    return false;
  }
}
