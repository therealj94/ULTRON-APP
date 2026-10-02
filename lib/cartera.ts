/**
 * LA HERRAMIENTA `cartera` DE AURA: «¿cuánto tengo en mi wallet?», «¿cuánto ORIGEN tengo?».
 *
 * SOLO LECTURA. Lee los saldos de la cadena de Orden Global (RPC público) con la dirección PÚBLICA que la
 * persona conectó en la app (perfil → `cartera`, lib/perfil-persona.ts). Aquí no hay llaves, contraseñas ni
 * firmas: AURA nunca mueve dinero. Mandar se hace en la app (la hoja «Enviar dinero», que abre Veta Wallet
 * llenada para que la persona firme con su contraseña).
 *
 * La lógica es la misma de la app (mobile/src/cartera/logica.ts y red.ts, sin React Native): un solo sitio
 * para los tokens, los precios y cómo se dice.
 */
import { leerPerfil } from './perfil-persona';
import { decirSaldos, simbolo } from '../mobile/src/cartera/logica';
import { leerSaldos, type Pedidor } from '../mobile/src/cartera/red';

/** Sin dirección no se adivina: se le dice cómo conectarla. */
export const SIN_CARTERA =
  'HARNESS cartera: todavía no conozco su Veta Wallet. Dile que la conecte en la app (menú de la mesa → Cartera): con PULSE2CHAT conectado se conecta sola; si no, pega su dirección (Veta Wallet → Recibir → Copiar dirección). Nunca le pidas su contraseña.';

/**
 * Corre `PEDIR_HERRAMIENTA: cartera [token]`. `dueno` es el correo verificado del turno (sin sesión no hay de
 * quién sea la cartera). Nunca lanza: lo que pasa vuelve como HECHO para el modelo.
 */
export async function correrCartera(dueno: string, arg: string, o: { pedir?: Pedidor; idioma?: 'es' | 'en' } = {}): Promise<string> {
  if (!dueno) return 'HARNESS cartera: solo con sesión. Pídele que entre con su cuenta.';
  const perfil = await leerPerfil(dueno).catch(() => null);
  const direccion = perfil?.cartera;
  if (!direccion) return SIN_CARTERA;
  const pedido = String(arg || '')
    .trim()
    .split(/\s+/)[0];
  const solo = pedido && !/^(todo|todos|saldos?|wallet|cartera)$/i.test(pedido) ? simbolo(pedido) || pedido : null;
  try {
    const c = await leerSaldos(direccion, { pedir: o.pedir });
    const dicho = decirSaldos(c.saldos, solo, o.idioma || perfil?.idioma || 'es');
    const precio = c.conPrecio ? 'Valor con el oro de hoy: el precio de ORIGEN es 1 gramo de oro ÷ 55, en dólares.' : 'Sin precio del oro ahora: di las cantidades sin dólares.';
    return `HARNESS cartera (Veta Wallet ${direccion.slice(0, 8)}…${direccion.slice(-6)}, leída de la cadena de Orden Global, solo lectura): ${dicho} ${precio} Dilo con naturalidad; si quiere ver el detalle, ofrécele abrir su Cartera en la app. Para mandar dinero se prepara en la app y se firma en Veta Wallet: tú nunca mueves dinero. Cada envío lleva la comisión de Veta Wallet, 0,01 dólares (cobrada en ORIGEN), más el gas de la red.`;
  } catch (e: any) {
    return `HARNESS cartera: la red de Orden Global no contestó (${String(e?.message || e).slice(0, 120)}). No inventes saldos: dile que lo intentas en un momento o que lo vea en su Cartera de la app.`;
  }
}
