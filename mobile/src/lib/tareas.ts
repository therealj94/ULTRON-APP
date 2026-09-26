/**
 * Qué hace AU-RA con el cuerpo según las herramientas que corrió el turno.
 *
 * Copia de `tareaDeHerramientas` de src/11-sala/tareas.ts (Metro no importa fuera de mobile/).
 * tests/sala-movil.test.ts comprueba que las dos dan lo mismo para cada herramienta.
 */
export type Tarea = 'buscar' | 'enviar' | 'anotar' | 'oro' | 'leer' | 'mirar';
export type Postura = 'pie' | 'sentada';

/** Lo que más se ve gana: enviar es lo último que pasa y lo que se pidió; buscar es lo que más tarda. */
const REGLAS: Array<[Tarea, RegExp]> = [
  ['enviar', /^(enviar|telegram|whatsapp|correo|urgente|llamada)$/],
  ['buscar', /^(web|pagina)$/],
  ['leer', /^(pdf-leer|pdf|rag)$/],
  ['anotar', /^(tareas|memoria|recordar)$/],
  ['oro', /^(oro|plata|hnl|metales|fx)$/],
  ['mirar', /^(vision|escena|foto)$/],
];

export function tareaDeHerramientas(tools: readonly string[] | null | undefined): Tarea | null {
  const lista = (tools || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
  for (const [tarea, re] of REGLAS) if (lista.some((t) => re.test(t))) return tarea;
  return null;
}

/** Lo que dice el estado mientras trabaja (la etiqueta de arriba). */
export const TAREA_TEXTO: Record<Tarea, string> = {
  buscar: 'buscando en internet',
  enviar: 'enviando',
  anotar: 'anotando',
  oro: 'mirando el precio',
  leer: 'leyendo el documento',
  mirar: 'mirando',
};
