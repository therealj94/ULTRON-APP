/**
 * LOS MAPAS GEOLÓGICOS NO DEPENDEN DE QUE EL MODELO SE ACUERDE DE DIBUJARLOS.
 *
 * Visto en producción (28-09): José tocó «Mapas geológicos» en la ficha de La Escalera y el doctor
 * contestó «Ahí tenés los tres, José» SIN llamar a `mapa_geologico`: no había ningún mapa. Con
 * Medardo, el mismo botón sí los dibujó. Es lo mismo que pasaba con el mapa (mapa-garantia.ts): el
 * modelo imita una respuesta que ya vio. Pedírselo en el prompt no alcanza; esto lo hace imposible:
 *
 *  · Si se pidieron mapas geológicos y en el turno no salió ninguno, se dibujan aquí con la misma
 *    herramienta, para la concesión que nombra el pedido.
 *  · Si no se pueden dibujar, la respuesta no puede quedar diciendo que ya están: se dice qué pasó.
 */
import type { Contexto, Herramienta, ResultadoHerramienta } from '../../lib/agente/tipos';
import { validar } from '../../lib/agente/protocolo';

/** Se pidieron mapas geológicos: «mapa(s) geológico(s)», litológico, estructural, geotectónico, de fallas. */
export const PIDE_MAPAS_GEO = /\bmapas?\s+(geol[oó]gic|litol[oó]gic|estructural|geotect[oó]nic|tect[oó]nic|de\s+fallas)|\b(litol[oó]gico|geotect[oó]nico)\b/i;
/** La respuesta dice que ya los enseñó. */
export const DICE_MAPAS_GEO = /(ah[ií] (ten[eé]s|tiene|est[aá]n|van)|est[aá]n en (la )?pantalla|ya (te )?(los )?(tenés|est[aá]n|quedaron)|te (los )?dej[eé]|listos para ver|los (ves|mir[aá]s)|dibuj[eé])/i;

/** Qué mapas pidió: uno en particular o los tres. */
export function tipoPedido(mensaje: string): 'litologico' | 'estructural' | 'geotectonico' | 'todos' {
  const m = String(mensaje || '').toLowerCase();
  const pide = {
    litologico: /litol[oó]gic/.test(m),
    estructural: /estructural|de fallas/.test(m),
    geotectonico: /tect[oó]nic/.test(m),
  };
  const cuantos = Object.values(pide).filter(Boolean).length;
  if (/\b(los )?tres\b|todos/.test(m) || cuantos !== 1) return 'todos';
  return pide.litologico ? 'litologico' : pide.estructural ? 'estructural' : 'geotectonico';
}

/** La concesión del pedido: «(id 228)» es lo que escribe la ficha; si no, el nombre tras «concesión». */
export function zonaDelPedido(mensaje: string): { concesion_id?: number; nombre?: string } | null {
  const id = /\bid\s*(\d{1,7})\b/i.exec(mensaje);
  if (id) return { concesion_id: Number(id[1]) };
  const nombre = /\bconcesi[oó]n\s+(?:de\s+)?[«"“]?([^«»"“”(),.;:?!]{2,60})/i.exec(mensaje);
  if (nombre) return { nombre: nombre[1].trim() };
  return null;
}

export async function garantizarMapasGeo(o: {
  mensaje: string;
  texto: string;
  /** Las herramientas que corrieron en el turno, con si salieron bien. */
  corrieron: Array<{ herramienta: string; ok: boolean }>;
  herramienta: Herramienta | undefined;
  ctx: Contexto;
}): Promise<{ texto: string; ui?: Record<string, unknown>; nota?: string }> {
  if (!PIDE_MAPAS_GEO.test(o.mensaje)) return { texto: o.texto };
  if (o.corrieron.some((c) => c.herramienta === 'mapa_geologico' && c.ok)) return { texto: o.texto };
  const zona = zonaDelPedido(o.mensaje);
  const decia = DICE_MAPAS_GEO.test(o.texto);
  const corregir = (motivo: string) =>
    decia
      ? `No te los pude dibujar esta vez: ${motivo} Lo que te dije antes de que estaban en pantalla no era cierto; perdoná.`
      : `${o.texto}\n\n(No llegué a dibujar los mapas: ${motivo})`;

  if (!zona || !o.herramienta) {
    const motivo = !o.herramienta ? 'la herramienta de mapas geológicos no está disponible aquí.' : 'no sé de qué concesión: decime su nombre o su expediente.';
    return { texto: corregir(motivo), nota: `pidió mapas geológicos y no se dibujaron: ${motivo}` };
  }
  const v = validar(o.herramienta.esquema, { tipo: tipoPedido(o.mensaje), ...zona });
  if (v.ok === false) return { texto: corregir(v.error), nota: `argumentos inválidos: ${v.error}` };
  let r: ResultadoHerramienta;
  try {
    r = await o.herramienta.ejecutar(v.args, o.ctx);
  } catch (e: any) {
    const motivo = `falló el dibujo (${String(e?.message || e).slice(0, 120)}).`;
    return { texto: corregir(motivo), nota: motivo };
  }
  if (!r.ok || !r.ui) return { texto: corregir(r.texto), nota: `mapa_geologico: ${r.texto}` };
  // Salieron: si el modelo ya dijo que estaban, ahora es verdad; si no, se avisa que están.
  const texto = decia ? o.texto : `${o.texto}\n\n${r.texto.split(' Si hace falta')[0]}`;
  return { texto, ui: r.ui as Record<string, unknown>, nota: `el modelo no los dibujó; se dibujaron aquí: ${r.texto.split(';')[0]}` };
}
