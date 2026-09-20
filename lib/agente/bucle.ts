/**
 * EL BUCLE — pensar, llamar, ver el resultado, volver a pensar, contestar.
 *
 * Tres cosas que diferencian un agente que sirve de uno que da vueltas:
 *
 *  1. **Presupuesto.** Rondas, llamadas y tiempo, todos con tope. Un agente sin límite se queda
 *     reintentando la misma herramienta hasta que alguien lo mata, y la factura la paga el usuario
 *     esperando frente a una pantalla quieta.
 *  2. **El error vuelve al modelo.** Si una herramienta falla o le faltan argumentos, el modelo
 *     recibe el motivo y corrige. Un fallo mudo se convierte siempre en una respuesta inventada.
 *  3. **Nada de repetir.** La misma llamada con los mismos argumentos no se ejecuta dos veces en un
 *     turno: se le devuelve el resultado que ya se tenía y se le dice que ya la hizo.
 *
 * El bucle no sabe hablar con ningún modelo: recibe una función `pensar`. Así se prueba entero sin
 * red, que es la única forma de saber que el presupuesto y los reintentos hacen lo que dicen.
 */
import { herramientasNativas, instruccionHermes, leerLlamadas, limpiarTexto, validar } from './protocolo';
import { ctxEscribe, type Contexto, type Herramienta, type Llamada, type Respuesta } from './tipos';

export type Mensaje =
  | { role: 'system' | 'user' | 'assistant'; content: string; tool_calls?: unknown[] }
  | { role: 'tool'; content: string; tool_name?: string; tool_call_id?: string };

/** Lo que el bucle le pide al modelo en cada ronda. */
export type Pensar = (opts: {
  mensajes: Mensaje[];
  /** Las herramientas en formato nativo, por si el servidor las acepta. */
  herramientas: ReturnType<typeof herramientasNativas>;
}) => Promise<{ texto: string; mensaje?: any }>;

export type Presupuesto = {
  /** Cuántas veces puede volver a pensar después de usar herramientas. */
  rondas: number;
  /** Tope total de llamadas en el turno. */
  llamadas: number;
  /** Tiempo de pared para todo el bucle. */
  ms: number;
};

export const PRESUPUESTO: Presupuesto = { rondas: 4, llamadas: 10, ms: 45_000 };

export type Traza = {
  ronda: number;
  llamada: Llamada;
  ok: boolean;
  ms: number;
  resumen: string;
};

export type Resultado = {
  /** La respuesta final, ya sin etiquetas de herramienta. */
  texto: string;
  /** Qué herramientas se usaron, en orden. Para el panel y para auditar. */
  traza: Traza[];
  /** Datos para la interfaz que dejaron las herramientas (mapa, tablas, archivos). */
  ui: Record<string, unknown>[];
  /** Por qué terminó. */
  fin: 'contestó' | 'sin rondas' | 'sin llamadas' | 'sin tiempo';
  rondas: number;
};

const resumir = (s: string, n = 120) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Corre el turno completo.
 *
 * `mensajes` entra con el system y el user ya puestos. Si el servidor no acepta `tools`, se le
 * añade al system la instrucción en formato Hermes, que es el que el modelo ya sabe emitir.
 */
export async function correrAgente(opts: {
  mensajes: Mensaje[];
  herramientas: Herramienta[];
  ctx: Contexto;
  pensar: Pensar;
  presupuesto?: Partial<Presupuesto>;
  /** true cuando se sabe que el servidor acepta `tools`; si no, se instruye por prompt. */
  nativo?: boolean;
  /** Se llama en cuanto una herramienta deja algo para la interfaz (el mapa no espera al final). */
  alVivo?: (traza: Traza, ui?: Record<string, unknown>) => void;
}): Promise<Resultado> {
  const p = { ...PRESUPUESTO, ...(opts.presupuesto || {}) };
  const t0 = Date.now();
  const porNombre = new Map(opts.herramientas.map((h) => [h.nombre, h]));
  const nativas = herramientasNativas(opts.herramientas);

  const mensajes: Mensaje[] = [...opts.mensajes];
  if (!opts.nativo && opts.herramientas.length) {
    const i = mensajes.findIndex((m) => m.role === 'system');
    const instruccion = instruccionHermes(opts.herramientas);
    if (i >= 0) mensajes[i] = { ...mensajes[i], content: `${(mensajes[i] as any).content}\n\n${instruccion}` } as Mensaje;
    else mensajes.unshift({ role: 'system', content: instruccion });
  }

  const traza: Traza[] = [];
  const ui: Record<string, unknown>[] = [];
  /** Huella de cada llamada ya hecha en este turno, con su respuesta. */
  const hechas = new Map<string, Respuesta>();
  let usadas = 0;
  let texto = '';

  for (let ronda = 1; ronda <= p.rondas + 1; ronda++) {
    const restante = p.ms - (Date.now() - t0);
    if (restante <= 0) return { texto: limpiarTexto(texto) || sinTiempo(traza), traza, ui, fin: 'sin tiempo', rondas: ronda - 1 };

    const salida = await opts.pensar({ mensajes, herramientas: nativas });
    texto = salida.texto || '';
    const llamadas = leerLlamadas(salida.mensaje, texto, opts.herramientas);

    // Sin llamadas: el modelo ya está contestando. Es la salida normal del bucle.
    if (!llamadas.length) return { texto: limpiarTexto(texto), traza, ui, fin: 'contestó', rondas: ronda };

    // Última ronda: no se ejecuta nada más, se le pide que cierre con lo que tiene.
    if (ronda > p.rondas) {
      return { texto: limpiarTexto(texto) || cierreForzado(traza), traza, ui, fin: 'sin rondas', rondas: ronda };
    }

    // El turno del asistente queda en el hilo: el modelo tiene que ver qué pidió.
    mensajes.push({ role: 'assistant', content: texto, tool_calls: salida.mensaje?.tool_calls });

    for (const l of llamadas) {
      if (usadas >= p.llamadas) {
        mensajes.push({ role: 'tool', tool_name: l.nombre, content: 'No quedan llamadas en este turno. Contestá con lo que ya tenés y decí qué te faltó.' });
        break;
      }
      if (Date.now() - t0 >= p.ms) break;

      const huella = `${l.nombre}:${JSON.stringify(l.argumentos)}`;
      const previa = hechas.get(huella);
      if (previa) {
        // Repetir la misma llamada es el bucle infinito más común. Se le devuelve lo de antes.
        mensajes.push({ role: 'tool', tool_name: l.nombre, content: `Esa llamada ya la hiciste en este turno y dio: ${previa.resultado.texto}` });
        continue;
      }

      const h = porNombre.get(l.nombre)!;
      const inicio = Date.now();
      let resultado;

      if (h.escribe && !ctxEscribe(opts.ctx)) {
        resultado = { ok: false, texto: `«${h.nombre}» cambia cosas y quien pregunta tiene acceso de consulta. No la ejecuté. Decilo claro y ofrecé la alternativa de solo lectura.` };
      } else {
        const v = validar(h.esquema, l.argumentos);
        if (v.ok === false) {
          // El error vuelve al modelo con el motivo: así corrige en la ronda siguiente.
          resultado = { ok: false, texto: v.error };
        } else {
          try {
            resultado = await conTope(h.ejecutar(v.args, opts.ctx), h.msMaximo ?? 20_000, h.nombre);
          } catch (e: any) {
            resultado = { ok: false, texto: `«${h.nombre}» falló: ${String(e?.message || e).slice(0, 180)}` };
          }
        }
      }

      const ms = Date.now() - inicio;
      usadas++;
      const t: Traza = { ronda, llamada: l, ok: resultado.ok, ms, resumen: resumir(resultado.texto) };
      traza.push(t);
      hechas.set(huella, { llamada: l, resultado, ms });
      if (resultado.ui) {
        ui.push({ herramienta: l.nombre, ...resultado.ui });
      }
      opts.alVivo?.(t, resultado.ui);

      mensajes.push({ role: 'tool', tool_name: l.nombre, tool_call_id: l.id, content: resultado.texto });
    }
  }

  return { texto: limpiarTexto(texto) || cierreForzado(traza), traza, ui, fin: 'sin rondas', rondas: p.rondas };
}

/** Una herramienta colgada no puede colgar el turno entero. */
function conTope<T>(promesa: Promise<T>, ms: number, nombre: string): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<T>((_, rechazar) => setTimeout(() => rechazar(new Error(`«${nombre}» tardó más de ${Math.round(ms / 1000)} segundos`)), ms)),
  ]);
}

function cierreForzado(traza: Traza[]): string {
  const buenas = traza.filter((t) => t.ok);
  if (!buenas.length) return 'Lo intenté por varios lados y no saqué nada en limpio. Decime de otra forma qué necesitás.';
  return `${buenas.map((t) => t.resumen).join(' ')} Me quedé sin vueltas para seguir; si querés que profundice, decímelo.`;
}

function sinTiempo(traza: Traza[]): string {
  const buenas = traza.filter((t) => t.ok);
  return buenas.length
    ? `${buenas.map((t) => t.resumen).join(' ')} Me quedé sin tiempo para terminar de armarlo.`
    : 'Se me fue el tiempo buscándolo y no alcancé a traerte nada. Volvé a pedírmelo.';
}
