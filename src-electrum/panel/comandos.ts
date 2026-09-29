/**
 * LOS COMANDOS DE VOZ: lo que se dice para manejar la pantalla sin tocarla.
 *
 * «Siguiente», «acércate», «más mapa», «cierra la ventana», «pantalla completa»… Se reconocen en el
 * navegador, sin pasar por el cerebro: tienen que responder YA, y no cuestan nada.
 *
 * Solo cuentan frases cortas (hasta seis palabras). «¿Qué concesiones siguientes vencen?» es una
 * pregunta, no la orden «siguiente»: por eso un comando tiene que ser casi toda la frase.
 */

export type Comando =
  | { accion: 'siguiente' }
  | { accion: 'detener' }
  | { accion: 'callar' }
  | { accion: 'cerrar' }
  | { accion: 'zoom'; dir: 1 | -1 }
  | { accion: 'reparto'; alto: 'mapa' | 'mitad' | 'chat' }
  | { accion: 'pantalla'; entrar: boolean }
  | { accion: 'abrir'; que: 'tablero' | 'capas' | 'expedientes' | 'infraestructura' | 'consulta' | 'recorrido' }
  | { accion: 'tresD'; activar: boolean }
  | { accion: 'manos'; activar: boolean }
  | { accion: 'ubicacion' };

/** Minúsculas, sin tildes ni signos, espacios simples. */
export function normalizarDicho(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:«»"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lo que se dice por cortesía y no cambia la orden: «doctor, por favor, acércate». */
const CORTESIA = /^(oye |doctor |dr |electrum |doctor electrum |por favor |porfa |a ver |bueno |ok |okay |dale )+|( por favor| porfa| gracias| ahi| ya)+$/g;

export function comandoDe(texto: string): Comando | null {
  let t = normalizarDicho(texto);
  // Dos pasadas: «doctor, por favor, …» lleva dos cortesías seguidas.
  t = t.replace(CORTESIA, '').replace(CORTESIA, '').trim();
  if (!t || t.split(' ').length > 6) return null;

  if (/^(siguiente|sigue|sigamos|continua|continuar|continuemos|adelante|pasa|pasale|otro capitulo|el siguiente)( capitulo)?$/.test(t)) return { accion: 'siguiente' };
  if (/^(detente|deten|detener|para|pare|parale|stop|termina|terminar|salir)( el recorrido| la presentacion)?$/.test(t) || /^(para|termina|deten) (el )?(recorrido|tour|presentacion)$/.test(t)) return { accion: 'detener' };
  if (/^(callate|calla|silencio|basta|shh+|ya no hables|deja de hablar)$/.test(t)) return { accion: 'callar' };

  if (/^(sal|salir|salte|quita|quitar)( de)?( la)? pantalla completa$/.test(t)) return { accion: 'pantalla', entrar: false };
  if (/^(pon |poner |abre |activa )?(la )?pantalla completa$/.test(t)) return { accion: 'pantalla', entrar: true };

  if (/^(cierra|cerrar|cierrala|cierralo|quita|quitala|quitalo|oculta|esconde)( la| el| esa| ese| esta| este)?( ventana| ficha| tarjeta| imagen| visor| foto| mapa geologico| pdf| timelapse| tablero)?$/.test(t)) return { accion: 'cerrar' };

  if (/^(abre|abrir|muestra|muestrame|ensename|ver|quiero ver|ve a|ir a|vamos a)( el| la| las| los)? (tablero|capas|expedientes|infraestructura|consulta|chat|recorrido|tour)$/.test(t)) {
    const que = t.match(/(tablero|capas|expedientes|infraestructura|consulta|chat|recorrido|tour)$/)![1];
    return { accion: 'abrir', que: que === 'chat' ? 'consulta' : que === 'tour' ? 'recorrido' : (que as 'tablero' | 'capas' | 'expedientes' | 'infraestructura' | 'consulta' | 'recorrido') };
  }

  if (/^((dame |pon |quiero )?mas mapa|agranda( el)? mapa|(abre|abri) mas( el)? mapa|mapa grande|el mapa mas grande|solo( el)? mapa)$/.test(t)) return { accion: 'reparto', alto: 'mapa' };
  if (/^((dame |pon |quiero )?mas (chat|conversacion)|agranda( el)? chat|chat grande|solo( el)? chat)$/.test(t)) return { accion: 'reparto', alto: 'chat' };
  if (/^(mitad( y mitad)?|mitad mitad|pantalla dividida|divide( la pantalla)?|parte( la pantalla)?)$/.test(t)) return { accion: 'reparto', alto: 'mitad' };

  if (/^(acercate|acercalo|acerca|acercar|zoom|zoom in|haz zoom|mas cerca|agranda|ampliar|amplia|amplialo|entra|mas zoom)( mas)?( al mapa| el mapa)?$/.test(t)) return { accion: 'zoom', dir: 1 };
  if (/^(alejate|alejalo|aleja|alejar|zoom out|menos zoom|mas lejos|achica|reduce|sal un poco|abre la vista)( mas)?( el mapa)?$/.test(t)) return { accion: 'zoom', dir: -1 };

  if (/^(pon|poner|activa|activar|muestra|ver)( el| en)? (3d|tres d|tercera dimension|relieve)$/.test(t)) return { accion: 'tresD', activar: true };
  if (/^(quita|quitar|apaga|apagar|sin)( el)? (3d|tres d|relieve)$/.test(t)) return { accion: 'tresD', activar: false };

  if (/^(activa|activar|enciende|prende|pon|usar|usa)( el| las| los)? (air touch|manos|gestos|control con las manos)$/.test(t)) return { accion: 'manos', activar: true };
  if (/^(desactiva|desactivar|apaga|apagar|quita|quitar)( el| las| los)? (air touch|manos|gestos|camara)$/.test(t)) return { accion: 'manos', activar: false };

  if (/^(donde estoy|mi ubicacion|muestrame donde estoy|llevame a donde estoy|ve a mi ubicacion|aqui donde estoy)$/.test(t)) return { accion: 'ubicacion' };
  return null;
}

/** Respuestas negativas a «¿tiene alguna pregunta?». */
export function esNegativa(texto: string): boolean {
  const t = normalizarDicho(texto);
  return /^(no|nop|nada|ninguna|ninguno|no gracias|no por ahora|asi esta bien|esta bien|todo claro|todo bien|gracias|muchas gracias|listo|ya|termina|terminar|no tengo|no tengo preguntas|ninguna pregunta)( gracias| doctor| por ahora)*$/.test(t);
}

/** «Sí» a secas: la pregunta viene después. */
export function esAfirmativa(texto: string): boolean {
  return /^(si|claro|dale|ok|okay|por supuesto|si tengo|si tengo una|tengo una pregunta|una pregunta|si doctor)( una pregunta)?$/.test(normalizarDicho(texto));
}

/** ¿Pide otro recorrido? Devuelve cuál. */
export function recorridoPedido(texto: string): 'completo' | 'geologico' | 'legal' | 'herramientas' | null {
  const t = normalizarDicho(texto);
  if (!/(recorrido|tour|muestrame|ensename|ver|seguir|sigamos|continuar|otro|quiero)/.test(t) && t.split(' ').length > 3) return null;
  if (/herramienta/.test(t)) return 'herramientas';
  if (/legal/.test(t)) return 'legal';
  if (/geolog/.test(t)) return 'geologico';
  if (/completo|todo/.test(t)) return 'completo';
  return null;
}
