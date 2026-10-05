/**
 * EL ESTADO Y EL RECIBO DE UNA HERRAMIENTA DEL HARNESS (EXEC03, AUR07). Lo que contesta cada runner (correo,
 * WhatsApp, círculo, triaje, tarea, misión, cartera, computadora…): el texto va al modelo; el estado y el
 * recibo, a la traza, al turno y a la decisión de memorizar. Nunca se deducen de las palabras del texto.
 *
 * Módulo hoja (sin dependencias) para que cualquier runner lo importe sin ciclos; lib/harness.ts lo re-exporta.
 */

/**
 * Cómo terminó una herramienta (EXEC03). `unknown`: pudo haber hecho su efecto (se despachó y no se supo
 * el final); no es éxito ni fallo, y no se repite a ciegas.
 */
export type EstadoHerramienta = 'succeeded' | 'failed' | 'unknown';

/**
 * El recibo de una herramienta (AUR07): lo que se sabe de su efecto, con campos, no con palabras del texto.
 *  · efecto: `ninguno` (solo leyó o no hizo nada), `borrador` (dejó algo que espera el «sí» de la persona),
 *    `guardado` (cambió algo de AURA: una misión, una tarea, su círculo), `confirmado` (el proveedor confirmó un
 *    efecto afuera: un envío) o `posible` (se despachó y no se supo el final).
 *  · proveedor / referencia: quién lo hizo y su id (el SMTP y las direcciones aceptadas, el chat de WhatsApp, el
 *    número de misión, el intento del borrador).
 *  · durable: false si lo guardado no quedó en el almacén durable (solo en este proceso o en su disco).
 *  · incompleto: los datos son parciales (una cuenta de correo no abrió, una fuente del triaje falló): sirven
 *    para contestar, pero no se memorizan como conclusión.
 *  · codigo: por qué no se hizo (`sin-sesion`, `no-disponible`, `falta-dato`, `ambiguo`, `no-encontrado`,
 *    `almacen`, `proveedor`, `no-entiendo`, `turno-ajeno`…).
 */
export type ReciboHerramienta = {
  efecto?: 'ninguno' | 'borrador' | 'guardado' | 'confirmado' | 'posible';
  proveedor?: string;
  referencia?: string;
  durable?: boolean;
  incompleto?: boolean;
  codigo?: string;
  /**
   * AUR13: lo que se sabe de la ENTREGA de un envío (correo, WhatsApp, aviso): `aceptado` (el proveedor lo tomó;
   * no prueba que llegó ni que lo leyeron), `entregado` (solo si el proveedor lo confirma), `fallido` (no salió) o
   * `incierto` (pudo haber salido; se reconcilia, no se repite a ciegas).
   */
  entrega?: 'aceptado' | 'entregado' | 'fallido' | 'incierto';
  /** AUR13: el operationId del registro durable (lib/envios.ts), estable por borrador aprobado. */
  operacion?: string;
  /** AUR13: la operación ya existía (reintento, otra réplica): no se volvió a hacer. */
  repetido?: boolean;
  /**
   * P4 (auditoría del 4-oct, A5): qué cuentas se consultaron de verdad en una lectura de varias fuentes (correo) y,
   * de las que no, por qué (`timeout`, `auth`…) y el paso siguiente (`reintentar`, `reconectar`…). Sin texto crudo
   * del proveedor: así una caída no se confunde con «no hay nada» ni una parcial con el total.
   */
  cuentas?: CuentaConsultada[];
  /**
   * Revisión del 5-oct (MEDIO-2): el resultado trae algo para LEERLE a la persona tal cual (un correo abierto, el trozo
   * siguiente, un chat de WhatsApp). En voz lleva el tope de lectura (lib/cerebro-manos.ts topeTrasPaso, 650: un trozo
   * y su «¿sigo?»); el tope corto cortaba el final del trozo, y sin ningún tope sonaban hasta 2 800 caracteres (MENOR-D).
   */
  lectura?: boolean;
};

/** Lo que se sabe de cada cuenta en una lectura (P4). */
export type CuentaConsultada = { cuenta: string; estado: 'consultada' | 'fallo'; fallo?: string; siguiente?: string };

/** Lo que devuelve una herramienta con su estado: el texto va al modelo; el estado y el recibo, a la traza y al turno. */
export type ResultadoHerramienta = { texto: string; estado: EstadoHerramienta; recibo?: ReciboHerramienta };

/** Corrió y contestó (lo que diga el recibo). */
export const exito = (texto: string, recibo?: ReciboHerramienta): ResultadoHerramienta => ({ texto, estado: 'succeeded', ...(recibo ? { recibo } : {}) });
/** No se hizo, y se sabe que no hubo efecto. */
export const fallo = (texto: string, codigo?: string): ResultadoHerramienta => ({ texto, estado: 'failed', recibo: { efecto: 'ninguno', ...(codigo ? { codigo } : {}) } });
/** Se despachó y no se supo el final: no es éxito ni fallo, y no se repite a ciegas. */
export const incierto = (texto: string, recibo: ReciboHerramienta = {}): ResultadoHerramienta => ({ texto, estado: 'unknown', recibo: { efecto: 'posible', ...recibo } });

/**
 * ¿El resultado de esta herramienta sirve como conclusión para la memoria? Solo un éxito con datos
 * completos (AUR07: datos incompletos no se memorizan como éxito).
 */
export function resultadoMemorizable(r: Pick<ResultadoHerramienta, 'estado' | 'recibo'>): boolean {
  return r.estado === 'succeeded' && !r.recibo?.incompleto;
}
