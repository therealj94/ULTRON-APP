/**
 * LO PERSONAL DEL TURNO, COMO VISTA AUTORIZADA (P1/A1, auditoría del 4-oct).
 *
 * El turno de texto y el de voz (server.ts prepararTurno) arman aquí lo que saben de la persona: su perfil,
 * lo que AURA aprendió de ella y lo que hablaron antes. Todo pasa por la vista autorizada: lo que la persona
 * marcó «No usarlo» (alcance `limitado` en lib/conocer-persona.ts) no entra por NINGUNA copia —ni su respuesta
 * del perfil (perfilDeUso), ni el bloque de lo que sabe, ni el eco en los resúmenes de antes o en lo que quedó
 * a medias—. La ficha editable (GET /api/perfil, GET /api/cerebro/conocer) no pasa por aquí: limitar no es
 * borrar, y reactivarlo («general») lo devuelve en el turno siguiente.
 *
 * Sale del estado durable del dato (al leer el perfil se lee «lo que sé de ti» de disco/S3) y, sin esperar
 * (la voz), de la caché: si lo limitado todavía no está en caché, no se arriesga nada (fallo cerrado).
 */
import { bloqueAbiertos } from '../lib/abiertos';
import { bloqueConocer, datosLimitadosEnCache, firmaConocer, terminosReservados, textoAutorizado } from '../lib/conocer-persona';
import { bloqueEpisodios } from '../lib/episodios';
import { lineaPerfil, perfilDeUso, type Perfil, type PerfilDeUso } from '../lib/perfil-persona';

export type BloquesPersonales = { bloquePerfil: string; conocer: string; conocerFirma?: string; bloqueCerebro: string };

/**
 * `dueno`: de quién es la memoria del turno (el correo de la app o el de la junta). `perfil`: el que dio
 * leerPerfil / perfilEnCache (ya autorizado); se vuelve a pasar por la vista con lo limitado en caché, por si
 * llegó de otro lado (el apodo del turno lo copia). `consulta`: lo que dijo ahora (para los resúmenes que vienen
 * al caso). Pura respecto a la red: solo caché.
 */
export function bloquesPersonales(o: { dueno: string; perfil: Perfil | PerfilDeUso | null; compacto: boolean; nombre?: string; consulta: string; conPregunta?: boolean }): BloquesPersonales {
  const dueno = o.dueno;
  const limitados = dueno ? datosLimitadosEnCache(dueno) : [];
  // null (lo limitado aún no está en caché): perfilDeUso falla cerrado, sin la encuesta ni el cumpleaños.
  const perfil = perfilDeUso(o.perfil, limitados);
  const terminos = limitados ? terminosReservados(limitados) : null;
  const cerebro = dueno ? [bloqueAbiertos(dueno, o.compacto), bloqueEpisodios(dueno, o.consulta, o.compacto)].filter(Boolean).join('\n\n') : '';
  return {
    bloquePerfil: lineaPerfil(perfil),
    conocer: dueno ? bloqueConocer(dueno, o.compacto, { nombre: o.nombre, conPregunta: o.conPregunta }) : '',
    conocerFirma: dueno ? firmaConocer(dueno) : undefined,
    // Los resúmenes de antes y lo que quedó a medias, sin las palabras de lo limitado; sin saber qué está
    // limitado, no entran (como bloqueEpisodios sin las marcas de supresión).
    bloqueCerebro: cerebro ? textoAutorizado(cerebro, terminos) : '',
  };
}
