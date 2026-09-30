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
import { trazaActual } from '../cognitivo/traza';
import { autorizar, textoDeDecision } from '../cognitivo/politica';
import { herramientasNativas, instruccionHermes, leerLlamadas, limpiarTexto, pedidosRechazados, validar } from './protocolo';
import { efectoDe, type Contexto, type Herramienta, type Llamada, type Respuesta } from './tipos';

export type Mensaje =
  | { role: 'system' | 'user' | 'assistant'; content: string; tool_calls?: unknown[] }
  | { role: 'tool'; content: string; tool_name?: string; tool_call_id?: string };

/** Lo que el bucle le pide al modelo en cada ronda. */
export type Pensar = (opts: {
  mensajes: Mensaje[];
  /** Las herramientas en formato nativo, por si el servidor las acepta. */
  herramientas: ReturnType<typeof herramientasNativas>;
  /**
   * Milisegundos que le quedan al TURNO, no a esta llamada.
   *
   * Existe porque sin esto el presupuesto era decorativo: el bucle comprobaba el tiempo *antes* de
   * llamar al modelo y después lo dejaba correr con su propio tope de sesenta segundos, así que un
   * turno con presupuesto de cincuenta podía tardar ciento diez. El cliente, que esperaba
   * cuarenta y cinco, ya se había ido — y el servidor seguía trabajando para nadie.
   *
   * Quien implemente `pensar` tiene que acotar su petición con esto.
   */
  msRestante: number;
  /**
   * Se dispara si quien preguntaba se fue (auditoría H09). Quien implemente `pensar` la pasa a su
   * `fetch` para cortar la llamada al modelo en vez de dejarla correr para nadie.
   */
  senal?: AbortSignal;
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
  fin: 'contestó' | 'sin rondas' | 'sin llamadas' | 'sin tiempo' | 'cerebro caído' | 'abandonado';
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
  /**
   * ¿Se fue quien preguntaba? Se consulta entre rondas y antes de cada herramienta.
   *
   * Un turno con tres rondas puede tardar cincuenta segundos, y si el navegador cerró la conexión
   * en el segundo dos, los cuarenta y ocho restantes son nodo gastado para nadie. No corta a mitad
   * de una herramienta que ya está corriendo —eso dejaría trabajo a medias en la base— pero no
   * empieza nada nuevo.
   */
  abandonado?: () => boolean;
  /**
   * La cancelación de verdad (auditoría H09): cuando se dispara, la llamada al modelo en curso se
   * corta y el bucle deja de esperar a la herramienta que esté corriendo. `abandonado` solo evitaba
   * empezar cosas nuevas; lo ya empezado seguía hasta su tope.
   */
  senal?: AbortSignal;
  /** true cuando se sabe que el servidor acepta `tools`; si no, se instruye por prompt. */
  nativo?: boolean;
  /** Se llama en cuanto una herramienta deja algo para la interfaz (el mapa no espera al final). */
  alVivo?: (traza: Traza, ui?: Record<string, unknown>) => void;
}): Promise<Resultado> {
  const p = { ...PRESUPUESTO, ...(opts.presupuesto || {}) };
  const t0 = Date.now();
  const seFue = () => opts.senal?.aborted === true || opts.abandonado?.() === true;
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
  /** Cuántas veces se le devolvió al modelo un pedido que no se pudo usar. */
  let correcciones = 0;
  const redactarFinal = async (): Promise<string | null> => {
    if (!traza.some((t) => t.ok)) return null;
    // Dos intentos: el modelo del nodo, con el protocolo de herramientas en el system, a veces
    // contesta el cierre con OTRO pedido de herramienta, que se limpia y deja el texto vacío. Pasó
    // en producción con el JICA Fase III: había encontrado las conclusiones en la p. 31 y el turno
    // terminó pegando resúmenes crudos. El segundo intento se lo dice sin rodeos.
    for (const [i, cierre] of [CIERRE, CIERRE_ESTRICTO].entries()) {
      // Quien preguntó puede haberse ido mientras corría el primer intento: no se empieza otro.
      if (seFue()) return null;
      // El reintento solo si cabe entero: el adaptador del nodo no baja de 8 s por llamada
      // (MIN_LLAMADA_MS en server/electrum/turno.ts), y el turno no puede pasarse de su tope.
      const restante = p.ms - (Date.now() - t0);
      if (restante < (i === 0 ? 5_000 : MS_REINTENTO_CIERRE)) return null;
      try {
        const s = await opts.pensar({ mensajes: [...mensajes, { role: 'user', content: cierre }], herramientas: [], msRestante: restante, senal: opts.senal });
        const t = limpiarTexto(s.texto || '');
        if (t) return t;
      } catch {
        return null;
      }
    }
    return null;
  };
  /** Huella de cada llamada ya hecha en este turno, con su respuesta. */
  const hechas = new Map<string, Respuesta>();
  let usadas = 0;
  let texto = '';

  for (let ronda = 1; ronda <= p.rondas + 1; ronda++) {
    const restante = p.ms - (Date.now() - t0);
    if (restante <= 0) return { texto: limpiarTexto(texto) || sinTiempo(traza), traza, ui, fin: 'sin tiempo', rondas: ronda - 1 };
    if (seFue()) return { texto: limpiarTexto(texto), traza, ui, fin: 'abandonado', rondas: ronda - 1 };

    /*
     * Si la llamada al modelo se cae o se pasa de tiempo, el turno NO se cae con ella.
     *
     * Antes esto no tenía red: una excepción acá subía hasta la ruta y el usuario recibía «se me
     * cayó el turno», perdiendo de paso todo lo que las herramientas ya habían averiguado en las
     * rondas anteriores. Habiendo catastro consultado y traslapes medidos, tirarlo porque la
     * última vuelta tardó de más es el peor final posible.
     */
    let salida: { texto: string; mensaje?: any };
    try {
      salida = await opts.pensar({ mensajes, herramientas: nativas, msRestante: restante, senal: opts.senal });
    } catch (e: any) {
      if (seFue()) return { texto: limpiarTexto(texto), traza, ui, fin: 'abandonado', rondas: ronda - 1 };
      const corte = /abort|timeout|tiempo/i.test(String(e?.name || '') + String(e?.message || ''));
      return {
        texto: limpiarTexto(texto) || (corte ? sinTiempo(traza) : seCayo(traza, e)),
        traza,
        ui,
        fin: corte ? 'sin tiempo' : 'cerebro caído',
        rondas: ronda - 1,
      };
    }
    texto = salida.texto || '';
    const llamadas = leerLlamadas(salida.mensaje, texto, opts.herramientas);

    if (!llamadas.length) {
      /*
       * Sin llamadas válidas. Si el modelo pidió algo que no se puede usar, o contestó vacío, se le
       * dice por qué y se le deja corregir (hasta dos veces). Antes eso terminaba en silencio.
       */
      const rechazos = pedidosRechazados(salida.mensaje, texto, opts.herramientas);
      if ((rechazos.length || !limpiarTexto(texto)) && ronda <= p.rondas && correcciones < 2) {
        correcciones++;
        trazaActual()?.paso({ herramienta: 'pedido_rechazado', ok: false, ms: 0, resumen: rechazos.join('; ') || 'respuesta vacía', ronda });
        mensajes.push({ role: 'assistant', content: texto || '(sin texto)' });
        mensajes.push({
          role: 'user',
          content: rechazos.length
            ? `(Sistema) No se pudo usar lo que pediste: ${rechazos.join('; ')}. Tus herramientas son: ${[...porNombre.keys()].join(', ')}. Si ninguna sirve para esto, contestá en texto qué podés hacer y qué no.`
            : '(Sistema) Tu respuesta llegó vacía. Contestá en texto a lo que te preguntaron.',
        });
        continue;
      }
      // El modelo ya está contestando. Es la salida normal del bucle.
      return { texto: limpiarTexto(texto), traza, ui, fin: 'contestó', rondas: ronda };
    }

    // Última ronda y sigue pidiendo herramientas: que redacte con lo que ya averiguó.
    if (ronda > p.rondas) {
      return { texto: (await redactarFinal()) || limpiarTexto(texto) || cierreForzado(traza), traza, ui, fin: 'sin rondas', rondas: ronda };
    }

    // El turno del asistente queda en el hilo: el modelo tiene que ver qué pidió.
    mensajes.push({ role: 'assistant', content: texto, tool_calls: salida.mensaje?.tool_calls });

    for (const l of llamadas) {
      if (usadas >= p.llamadas) {
        mensajes.push({ role: 'tool', tool_name: l.nombre, content: 'No quedan llamadas en este turno. Contestá con lo que ya tenés y decí qué te faltó.' });
        break;
      }
      if (Date.now() - t0 >= p.ms) break;
      if (seFue()) break;

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

      const v = validar(h.esquema, l.argumentos);
      if (v.ok === false) {
        // El error vuelve al modelo con el motivo: así corrige en la ronda siguiente.
        resultado = { ok: false, texto: v.error };
      } else {
        /*
         * El motor de reglas decide si corre, FUERA del modelo. Con los argumentos ya validados:
         * si va a revisión, lo que se congela en la cola es exactamente lo que se ejecutaría.
         */
        const efecto = efectoDe(h);
        const dec =
          efecto === 'lectura'
            ? null
            : await autorizar({
                herramienta: h.nombre,
                efecto,
                plataforma: opts.ctx.plataforma,
                args: v.args,
                quien: opts.ctx.quien,
                nivel: opts.ctx.nivel,
                prueba: opts.ctx.prueba ?? null,
                canal: opts.ctx.canal,
                riesgo: opts.ctx.riesgo ?? null,
                destino: h.destino ? h.destino(v.args) : null,
              });
        if (dec && dec.veredicto !== 'permitir') {
          resultado = { ok: false, texto: textoDeDecision({ herramienta: h.nombre }, dec) };
        } else {
          try {
            // Su tope, pero nunca más de lo que le queda al turno (auditoría H08): una herramienta
            // de 20 s lanzada a 45 s de un turno de 50 ya no puede llevarse el turno a 65.
            const queda = Math.max(1_000, p.ms - (Date.now() - t0));
            resultado = await conTope(h.ejecutar(v.args, { ...opts.ctx, senal: opts.senal }), Math.min(h.msMaximo ?? 20_000, queda), h.nombre, opts.senal);
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
      trazaActual()?.paso({ herramienta: l.nombre, ok: resultado.ok, ms, resumen: resultado.texto, args: l.argumentos, ronda });

      mensajes.push({ role: 'tool', tool_name: l.nombre, tool_call_id: l.id, content: resultado.texto });
    }
  }

  return { texto: (await redactarFinal()) || limpiarTexto(texto) || cierreForzado(traza), traza, ui, fin: 'sin rondas', rondas: p.rondas };
}

/**
 * Al acabarse las rondas con herramientas pedidas, antes se pegaban los resúmenes crudos de lo que
 * devolvieron («Geoportal - ICF (http://…): Las metas de GeoNetwork son…») y un «me quedé sin
 * vueltas». Pasó en producción investigando caliza por Telegram. Ahora se le pide al modelo, sin
 * herramientas, que redacte la respuesta con lo que ya tiene; lo crudo queda solo si no hay tiempo.
 */
const CIERRE =
  '(Sistema) Se acabaron las herramientas de este turno. Con lo que ya averiguaste, redactá ahora la respuesta final para quien pregunta, sin pedir más herramientas. Si algo quedó sin averiguar, decilo y ofrecé seguir.';

const CIERRE_ESTRICTO =
  '(Sistema) NO podés pedir herramientas: no hay más. Escribí YA, en texto normal y sin etiquetas, la respuesta final con lo que devolvieron las herramientas de arriba; si algo salió de un documento, con su documento y página. Si faltó algo, decilo en una línea.';
const MS_REINTENTO_CIERRE = 8_000;

/**
 * Una herramienta colgada no puede colgar el turno entero. El reloj se limpia al terminar (antes
 * quedaba vivo hasta su tope aunque la herramienta hubiera contestado), y si quien preguntaba se
 * va, se deja de esperar en el acto (auditoría H09).
 */
export function conTope<T>(promesa: Promise<T>, ms: number, nombre: string, senal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    if (senal?.aborted) return rechazar(new Error(`«${nombre}» cancelada: quien preguntaba se fue`));
    const reloj = setTimeout(() => rechazar(new Error(`«${nombre}» tardó más de ${Math.round(ms / 1000)} segundos`)), ms);
    const cortar = () => rechazar(new Error(`«${nombre}» cancelada: quien preguntaba se fue`));
    senal?.addEventListener('abort', cortar, { once: true });
    promesa.then(resolver, rechazar).finally(() => {
      clearTimeout(reloj);
      senal?.removeEventListener('abort', cortar);
    });
  });
}

function cierreForzado(traza: Traza[]): string {
  const buenas = traza.filter((t) => t.ok);
  if (!buenas.length) return 'Lo intenté por varios lados y no saqué nada en limpio. Decime de otra forma qué necesitás.';
  return `${buenas.map((t) => t.resumen).join(' ')} Me quedé sin vueltas para seguir; si querés que profundice, decímelo.`;
}

/**
 * El cerebro no contestó. Se dice lo que sí se averiguó antes de que se cayera: quien preguntó por
 * un traslape y recibió «no pude» prefiere «medí esto y después se me cayó» a un silencio.
 */
function seCayo(traza: Traza[], e: any): string {
  const buenas = traza.filter((t) => t.ok);
  const porque = String(e?.message || e || '').slice(0, 100);
  return buenas.length
    ? `${buenas.map((t) => t.resumen).join(' ')} Después se me cortó el cerebro${porque ? ` (${porque})` : ''} y no llegué a redactarlo. Volvé a pedírmelo.`
    : `No alcancé mi cerebro${porque ? ` (${porque})` : ''}. No te voy a inventar una respuesta: volvé a preguntarme.`;
}

function sinTiempo(traza: Traza[]): string {
  const buenas = traza.filter((t) => t.ok);
  return buenas.length
    ? `${buenas.map((t) => t.resumen).join(' ')} Me quedé sin tiempo para terminar de armarlo.`
    : 'Se me fue el tiempo buscándolo y no alcancé a traerte nada. Volvé a pedírmelo.';
}
