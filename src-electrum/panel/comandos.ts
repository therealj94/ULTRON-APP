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
  | { accion: 'ubicacion' }
  | { accion: 'mover'; dir: 'arriba' | 'abajo' | 'izquierda' | 'derecha' }
  | { accion: 'rotar'; dir: 1 | -1 }
  | { accion: 'norte' }
  | { accion: 'inclinar' }
  | { accion: 'cenital' }
  | { accion: 'orbitar' }
  | { accion: 'fondo'; cual: 'satelite' | 'calles' }
  | { accion: 'pais' }
  | { accion: 'ficha'; que: 'pdf' | 'geologico' | 'timelapse' | 'analizar' }
  | { accion: 'dialogo' }
  /** Abrir o cerrar la mesa técnica (los tres discuten cada pregunta). */
  | { accion: 'mesa'; abrir: boolean }
  /** Explorar sin voces, o que vuelvan a hablar. */
  | { accion: 'silencio'; activar: boolean }
  /** Dejar que le hablen encima (se calla y escucha), o no. */
  | { accion: 'interrumpir'; activar: boolean };

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
  if (/^(modo silencio|silencio total|sin voz|sin voces|silencialos|silencia(los)?( a todos)?|apaga (las )?voces|quita (las )?voces|mute)$/.test(t)) return { accion: 'silencio', activar: true };
  if (/^((activa|enciende|prende|pon|vuelve)( las| la)? (voz|voces)|con voz|que hablen( otra vez)?|hablen( otra vez)?|quita el silencio)$/.test(t)) return { accion: 'silencio', activar: false };
  if (/^(abre|abrir|activa|convoca|llama|junta|arma|reune)( a)?( la)? mesa( tecnica| de trabajo| de discusion)?$|^(mesa tecnica|que venga el equipo|llama al equipo|junta al equipo)$/.test(t)) return { accion: 'mesa', abrir: true };
  if (/^(cierra|cerrar|termina|terminar|disuelve|levanta)( la)? mesa( tecnica| de trabajo| de discusion)?$|^(se acabo la mesa|gracias equipo)$/.test(t)) return { accion: 'mesa', abrir: false };
  if (/^(no me interrumpas|no te dejes interrumpir|termina (siempre )?lo que dices|no te calles cuando hable)$/.test(t)) return { accion: 'interrumpir', activar: false };
  if (/^(dejame interrumpir(te)?|puedo interrumpir(te)?|interrumpible|callate cuando (yo )?hable)$/.test(t)) return { accion: 'interrumpir', activar: true };

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

  if (/^(explicamelo|explicalo|dimelo|cuentamelo|hazlo|ponlo|dilo)( como| en)?( una)? (conversacion|dialogo|podcast|charla|platica)( con tatiana)?$/.test(t)) return { accion: 'dialogo' };
  // Girar antes que mover: «gira a la derecha» no es «a la derecha».
  if (/^(gira|girar|gíralo|giralo|rota|rotar|rotalo|voltea|da vuelta|dale vuelta)( el mapa| la vista)?( un poco| mas)?( hacia| para| a)? (la )?izquierda$/.test(t) || /^(gira|rota)( el mapa)? (en contra del reloj|antihorario)$/.test(t)) return { accion: 'rotar', dir: -1 };
  if (/^(gira|girar|giralo|rota|rotar|rotalo|voltea|da vuelta|dale vuelta)( el mapa| la vista)?( un poco| mas)?(( hacia| para| a)? (la )?derecha)?$/.test(t) || /^(gira|rota)( el mapa)? (como el reloj|en sentido horario|horario)$/.test(t)) return { accion: 'rotar', dir: 1 };
  if (/^((pon|deja)( el)? norte (arriba|hacia arriba)|norte arriba|endereza(lo)?( el mapa| la vista)?|quita (el giro|la rotacion)|orienta(lo)? al norte)$/.test(t)) return { accion: 'norte' };
  if (/^(inclina(lo)?( el mapa| la camara| mas)?|ponlo de lado|vista (en )?perspectiva|dale angulo|mas inclinado)$/.test(t)) return { accion: 'inclinar' };
  if (/^(vista (de arriba|cenital|en planta|aerea)|ponlo plano|mira(lo)? desde arriba|quita la inclinacion|aplanalo)$/.test(t)) return { accion: 'cenital' };
  if (/^(orbita|(dale )?la vuelta( completa)?|vuelta completa|gira alrededor|da una vuelta( de 360)?|gira 360( grados)?|sobrevuela en circulo)$/.test(t)) return { accion: 'orbitar' };
  const mover = t.match(/^(muevete |mueve el mapa |mueve |corre el mapa |desplazate |ve |anda |llevame |corre |desliza el mapa )?(mas |un poco |un poco mas )?(hacia el |hacia la |hacia |para el |para la |para |al |a la |a el |a )?(arriba|norte|abajo|sur|izquierda|oeste|derecha|este)$/);
  if (mover) {
    const d = mover[4];
    return { accion: 'mover', dir: d === 'norte' || d === 'arriba' ? 'arriba' : d === 'sur' || d === 'abajo' ? 'abajo' : d === 'oeste' || d === 'izquierda' ? 'izquierda' : 'derecha' };
  }
  if (/^(sube|subelo|sube el mapa)$/.test(t)) return { accion: 'mover', dir: 'arriba' };
  if (/^(baja|bajalo|baja el mapa)$/.test(t)) return { accion: 'mover', dir: 'abajo' };
  if (/^((pon|cambia a|vista|fondo|modo)( el| de| a)? ?(satelite|satelital)|satelite)$/.test(t)) return { accion: 'fondo', cual: 'satelite' };
  if (/^((pon|cambia a|vista|fondo|modo|mapa)( el| de| a)? ?calles|calles)$/.test(t)) return { accion: 'fondo', cual: 'calles' };
  if (/^((muestrame|ensename|ver|ve a)( todo)? (el pais|honduras)( entera| completa| completo)?|vista general|todo honduras|honduras (entera|completa)|todo el pais)$/.test(t)) return { accion: 'pais' };
  if (/^((hazme|saca|genera|dame|bajame|arma)( la)? ficha( en)? pdf( de esta| de esta concesion)?|ficha pdf|(el )?pdf de esta( concesion)?)$/.test(t)) return { accion: 'ficha', que: 'pdf' };
  if (/^((hazme|haz|dibuja|saca|genera|dame)( el| los)? mapas? geologicos?( de esta( concesion)?)?|mapa geologico( de esta( concesion)?)?)$/.test(t)) return { accion: 'ficha', que: 'geologico' };
  if (/^((pon|ponme|abre|muestrame|reproduce)( el)? time ?lapse( satelital)?( de esta( concesion)?)?|time ?lapse( satelital)?)$/.test(t)) return { accion: 'ficha', que: 'timelapse' };
  if (/^(analiza(la)?( esta( concesion)?| la concesion)?|haz el analisis( de esta)?|analizar)$/.test(t)) return { accion: 'ficha', que: 'analizar' };

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

/**
 * Las etiquetas del modelo «comando» de Laya (scripts/nodo-t4/laya/modelos/comando) → la orden.
 * `ninguna` (o una etiqueta que no se conoce) es null: la frase va al cerebro como pregunta.
 */
export function comandoDeLaya(id: string | null | undefined): Comando | null {
  switch (id) {
    case 'siguiente': return { accion: 'siguiente' };
    case 'detener': return { accion: 'detener' };
    case 'callar': return { accion: 'callar' };
    case 'cerrar': return { accion: 'cerrar' };
    case 'zoom_mas': return { accion: 'zoom', dir: 1 };
    case 'zoom_menos': return { accion: 'zoom', dir: -1 };
    case 'mover_arriba': return { accion: 'mover', dir: 'arriba' };
    case 'mover_abajo': return { accion: 'mover', dir: 'abajo' };
    case 'mover_izquierda': return { accion: 'mover', dir: 'izquierda' };
    case 'mover_derecha': return { accion: 'mover', dir: 'derecha' };
    case 'rotar_izquierda': return { accion: 'rotar', dir: -1 };
    case 'rotar_derecha': return { accion: 'rotar', dir: 1 };
    case 'norte_arriba': return { accion: 'norte' };
    case 'inclinar': return { accion: 'inclinar' };
    case 'vista_cenital': return { accion: 'cenital' };
    case 'orbitar': return { accion: 'orbitar' };
    case 'relieve_3d': return { accion: 'tresD', activar: true };
    case 'quitar_3d': return { accion: 'tresD', activar: false };
    case 'mas_mapa': return { accion: 'reparto', alto: 'mapa' };
    case 'mas_chat': return { accion: 'reparto', alto: 'chat' };
    case 'mitad': return { accion: 'reparto', alto: 'mitad' };
    case 'pantalla_completa': return { accion: 'pantalla', entrar: true };
    case 'salir_pantalla': return { accion: 'pantalla', entrar: false };
    case 'abrir_tablero': return { accion: 'abrir', que: 'tablero' };
    case 'abrir_capas': return { accion: 'abrir', que: 'capas' };
    case 'abrir_expedientes': return { accion: 'abrir', que: 'expedientes' };
    case 'abrir_infra': return { accion: 'abrir', que: 'infraestructura' };
    case 'abrir_consulta': return { accion: 'abrir', que: 'consulta' };
    case 'abrir_recorrido': return { accion: 'abrir', que: 'recorrido' };
    case 'fondo_satelite': return { accion: 'fondo', cual: 'satelite' };
    case 'fondo_calles': return { accion: 'fondo', cual: 'calles' };
    case 'mi_ubicacion': return { accion: 'ubicacion' };
    case 'ver_pais': return { accion: 'pais' };
    case 'ficha_pdf': return { accion: 'ficha', que: 'pdf' };
    case 'mapa_geologico': return { accion: 'ficha', que: 'geologico' };
    case 'timelapse': return { accion: 'ficha', que: 'timelapse' };
    case 'analizar': return { accion: 'ficha', que: 'analizar' };
    case 'manos_on': return { accion: 'manos', activar: true };
    case 'manos_off': return { accion: 'manos', activar: false };
    default: return null;
  }
}

/** Lo que se muestra al ejecutar una orden, para que se vea que se entendió. */
export function nombreDeComando(c: Comando): string {
  switch (c.accion) {
    case 'siguiente': return 'Siguiente';
    case 'detener': return 'Recorrido detenido';
    case 'callar': return 'En silencio';
    case 'cerrar': return 'Cerrando';
    case 'zoom': return c.dir > 0 ? 'Acercando' : 'Alejando';
    case 'mover': return { arriba: 'Moviendo al norte', abajo: 'Moviendo al sur', izquierda: 'Moviendo al oeste', derecha: 'Moviendo al este' }[c.dir];
    case 'rotar': return c.dir > 0 ? 'Girando a la derecha' : 'Girando a la izquierda';
    case 'norte': return 'Norte arriba';
    case 'inclinar': return 'Inclinando la vista';
    case 'cenital': return 'Vista desde arriba';
    case 'orbitar': return 'Vuelta completa';
    case 'tresD': return c.activar ? 'Relieve 3D' : 'Sin 3D';
    case 'reparto': return c.alto === 'mapa' ? 'Más mapa' : c.alto === 'chat' ? 'Más chat' : 'Mitad y mitad';
    case 'pantalla': return c.entrar ? 'Pantalla completa' : 'Ventana normal';
    case 'abrir': return `Abriendo ${c.que}`;
    case 'fondo': return c.cual === 'satelite' ? 'Fondo satelital' : 'Fondo de calles';
    case 'pais': return 'Todo el país';
    case 'ficha': return { pdf: 'Ficha en PDF', geologico: 'Mapa geológico', timelapse: 'Timelapse satelital', analizar: 'Analizando' }[c.que];
    case 'manos': return c.activar ? 'Air touch activado' : 'Air touch apagado';
    case 'ubicacion': return 'Su ubicación';
    case 'dialogo': return 'Como conversación';
    case 'mesa': return c.abrir ? 'Mesa técnica abierta' : 'Mesa técnica cerrada';
    case 'silencio': return c.activar ? 'Modo silencio' : 'Voces encendidas';
    case 'interrumpir': return c.activar ? 'Puede interrumpir hablando' : 'Termina lo que dice';
  }
}
