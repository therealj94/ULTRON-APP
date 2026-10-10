/**
 * Trabajos (Fase 2): tus objetivos abiertos y tus tareas, con su estado y lo que cada uno espera. Tocar un objetivo
 * abre su hoja: qué pasó (lo nuevo desde que esta PC lo vio, marcado), el siguiente paso, los criterios de cierre y,
 * si espera tu decisión, sus opciones como botones. Decidir manda la revisión que estás viendo (revisionVista): si
 * otro aparato se adelantó, AURA trae el estado de ahora y lo dice («Cambió desde otro aparato»).
 *
 * Todo pasa por AURA (C#, NotchWindow.Objetivos.cs) con la sesión de AU-RA: la página no sale a la red.
 */
import { h, boton, botonIcono, avisar, vacio } from '../ui';
import { pedir, al } from '../puente';
import { T } from '../estado';

export type Opcion = { id: string; etiqueta: string; consecuencia: string };
export type Objetivo = {
  id: string; titulo: string; meta: string; proyecto?: string; estado: string; estadoTexto: string; espera: string;
  pausado: boolean; terminal: boolean; revision: number; siguientePaso: string; actualizado: number; nuevo: boolean;
  decision: { id: string; pregunta: string; opciones: Opcion[] } | null;
  criterios: { texto: string; cumplido: boolean }[];
  documentos: { nombre: string; version: number }[];
  eventos: { revision: number; t: number; texto: string }[];
};
export type Tarea = {
  id: string; titulo: string; estado: string; estadoTexto: string; espera: string; terminal: boolean; actualizado: string;
  progreso: { hechos: number; total: number; unidad: string } | null; objetivo: string | null;
};
type Lista = { objetivos: Objetivo[]; tareas: Tarea[]; aviso?: string | null; abrir?: string | null };
type Resultado = { ok: boolean; repetida?: boolean; sinCambio?: boolean; conflicto: { codigo: string; mensaje: string; detalle: string } | null; objetivo: Objetivo | null };

const hora = (ms: number) => (ms > 0 ? new Date(ms).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** El sello del estado: oro si espera algo tuyo, cardenillo si avanza, ceniza si terminó o está en pausa. */
function sello(estado: string, texto: string, terminal: boolean, pausado = false) {
  const tono = terminal || pausado ? 'quieto' : /decision|approval/.test(estado) ? 'tuyo' : /fallido|failed|blocked|incierto/.test(estado) ? 'mal' : 'vivo';
  return h('span', { class: `tr-sello ${tono}` }, texto);
}

export function vistaTrabajos(): HTMLElement {
  const lista = h('div', { class: 'tr-lista', 'aria-busy': 'true' }, h('span', { class: 'cargando' }));
  const hoja = h('aside', { class: 'tr-hoja', hidden: true, 'aria-label': T('Hoja del objetivo', 'Goal sheet') });
  const vista = h('div', { class: 'vista vista-trabajos' },
    h('div', { class: 'cabeza' },
      h('div', null, h('h1', null, T('Trabajos', 'Work')),
        h('p', null, T('Tus objetivos y tareas: cómo van y qué espera cada uno. Lo que AURA hace por ti sigue aunque cierres esta ventana.', 'Your goals and tasks: how they are going and what each is waiting on.'))),
      h('div', { class: 'acciones' }, botonIcono('actualizar', T('Actualizar', 'Refresh'), () => void cargar()))),
    h('div', { class: 'tr-cuerpo' }, lista, hoja));

  let abierto: string | null = null;
  let ultimo: Lista | null = null;
  let cargando = false;

  /** `conHoja`: también vuelve a leer la hoja abierta (no después de decidir: ahí la hoja ya llegó con su aviso). */
  async function cargar(conHoja = true) {
    if (cargando) return;
    cargando = true;
    try {
      const l = await pedir<Lista>('trabajos.lista', null, 40_000);
      ultimo = l;
      pintarLista(l);
      const abrir = l.abrir || (conHoja ? abierto : null);
      if (abrir) void abrirHoja(abrir, !!l.abrir);
    } catch (e: any) {
      lista.removeAttribute('aria-busy');
      vacio(lista).appendChild(h('p', { class: 'tenue' }, e?.message || T('No pude leer tus trabajos.', 'I couldn’t read your work.')));
    } finally { cargando = false; }
  }

  function pintarLista(l: Lista) {
    lista.removeAttribute('aria-busy');
    const hijos: Node[] = [];
    if (l.aviso) hijos.push(h('p', { class: 'nota tr-aviso' }, l.aviso));
    const abiertos = l.objetivos.filter((o) => !o.terminal);
    const cerrados = l.objetivos.filter((o) => o.terminal).slice(0, 8);
    hijos.push(h('h2', { class: 'rotulo' }, T('Objetivos', 'Goals')));
    if (!abiertos.length) hijos.push(h('p', { class: 'tenue' }, T('No tienes objetivos abiertos. Pídele a AURA uno («ayúdame a cerrar la venta con Maple») y aparece aquí.', 'No open goals. Ask AURA for one and it shows up here.')));
    for (const o of abiertos) hijos.push(filaObjetivo(o));
    const tareas = l.tareas.filter((t) => !t.terminal);
    hijos.push(h('h2', { class: 'rotulo', style: 'margin-top:28px' }, T('Tareas en marcha', 'Running tasks')));
    if (!tareas.length) hijos.push(h('p', { class: 'tenue' }, T('Ninguna tarea en marcha.', 'No running tasks.')));
    for (const t of tareas) hijos.push(filaTarea(t));
    const hechas = l.tareas.filter((t) => t.terminal).slice(0, 10);
    if (cerrados.length || hechas.length) {
      hijos.push(h('h2', { class: 'rotulo', style: 'margin-top:28px' }, T('Terminados hace poco', 'Recently finished')));
      for (const o of cerrados) hijos.push(filaObjetivo(o));
      for (const t of hechas) hijos.push(filaTarea(t));
    }
    vacio(lista).append(...hijos);
  }

  function filaObjetivo(o: Objetivo) {
    return h('button', { class: 'tr-fila' + (o.id === abierto ? ' activa' : '') + (o.nuevo ? ' nueva' : ''), type: 'button', 'data-id': o.id, on: { click: () => void abrirHoja(o.id, true) } },
      h('div', { class: 'tr-fila-cab' },
        h('strong', null, o.titulo || T('Objetivo', 'Goal')),
        o.nuevo ? h('span', { class: 'tr-nuevo', title: T('Cambió desde la última vez que lo viste en esta PC', 'Changed since you last saw it on this PC') }, T('Nuevo', 'New')) : null,
        sello(o.estado, o.estadoTexto, o.terminal, o.pausado)),
      o.espera ? h('small', null, h('span', { class: 'tr-espera' }, T('Espera: ', 'Waiting on: ')), o.espera) : null);
  }

  function filaTarea(t: Tarea) {
    const prog = t.progreso && t.progreso.total > 0 ? ` · ${Math.round(t.progreso.hechos)}/${Math.round(t.progreso.total)} ${t.progreso.unidad}` : '';
    return h('div', { class: 'tr-fila tarea' },
      h('div', { class: 'tr-fila-cab' }, h('strong', null, t.titulo || T('Tarea', 'Task')), sello(t.estado, t.estadoTexto + prog, t.terminal)),
      t.espera ? h('small', null, h('span', { class: 'tr-espera' }, T('Espera: ', 'Waiting on: ')), t.espera) : null,
      t.objetivo ? h('small', { class: 'tenue' }, T('De «', 'Part of “') + t.objetivo + T('»', '”')) : null);
  }

  /** La hoja de un objetivo. `marcarVisto`: la pidió la persona (la PC anota que la vio). */
  async function abrirHoja(id: string, marcarVisto: boolean) {
    abierto = id;
    lista.querySelectorAll('.tr-fila').forEach((f) => f.classList.toggle('activa', (f as HTMLElement).dataset.id === id));
    hoja.hidden = false;
    if (marcarVisto || !hoja.firstChild) hoja.replaceChildren(h('span', { class: 'cargando' }));
    try {
      const r = await pedir<{ objetivo: Objetivo; nuevos: string[] }>('objetivos.abrir', { id }, 30_000);
      if (abierto !== id) return;
      pintarHoja(r.objetivo, r.nuevos);
      // Ya visto en esta PC: la marca «Nuevo» de la lista se quita.
      const fila = lista.querySelector(`.tr-fila[data-id="${CSS.escape(id)}"]`);
      fila?.classList.remove('nueva'); fila?.querySelector('.tr-nuevo')?.remove();
    } catch (e: any) {
      if (abierto === id) hoja.replaceChildren(h('p', { class: 'tenue' }, e?.message || T('No pude abrir ese objetivo.', 'I couldn’t open that goal.')));
    }
  }

  function pintarHoja(o: Objetivo, nuevos: string[] = [], conflicto?: string) {
    const nuevosSet = new Set(nuevos);
    const cuerpo: Node[] = [
      h('div', { class: 'tr-hoja-cab' },
        h('div', null, h('h2', null, o.titulo), o.meta ? h('p', { class: 'tenue' }, o.meta) : null),
        botonIcono('cerrar', T('Cerrar la hoja', 'Close sheet'), () => { abierto = null; hoja.hidden = true; lista.querySelectorAll('.tr-fila.activa').forEach((f) => f.classList.remove('activa')); })),
      h('div', { class: 'fila', style: 'flex-wrap:wrap' }, sello(o.estado, o.estadoTexto, o.terminal, o.pausado), h('span', { class: 'mono tenue' }, T('revisión ', 'revision ') + o.revision), h('time', { class: 'tenue' }, hora(o.actualizado))),
    ];
    if (conflicto) cuerpo.push(h('p', { class: 'tr-conflicto', role: 'alert' }, conflicto));
    if (o.decision) cuerpo.push(bloqueDecision(o));
    if (!o.terminal && o.espera && !o.decision) cuerpo.push(h('p', null, h('span', { class: 'tr-espera' }, T('Espera: ', 'Waiting on: ')), o.espera));
    if (o.siguientePaso && !o.terminal) cuerpo.push(h('p', { class: 'nota' }, T('Siguiente paso: ', 'Next step: ') + o.siguientePaso));
    if (o.eventos.length) {
      cuerpo.push(h('h3', { class: 'rotulo' }, T('Qué pasó', 'What happened')));
      cuerpo.push(h('ol', { class: 'tr-eventos' }, ...o.eventos.map((e) =>
        h('li', { class: nuevosSet.has(e.texto) ? 'nuevo' : '' }, h('time', null, hora(e.t)), h('span', null, e.texto)))));
    }
    if (o.criterios.length) {
      cuerpo.push(h('h3', { class: 'rotulo' }, T('Para darlo por cerrado', 'Done when')));
      cuerpo.push(h('ul', { class: 'tr-criterios' }, ...o.criterios.map((c) => h('li', { class: c.cumplido ? 'cumplido' : '' }, c.texto))));
    }
    if (o.documentos.length) cuerpo.push(h('p', { class: 'nota' }, T('Documentos: ', 'Documents: ') + o.documentos.map((d) => `${d.nombre} (v${d.version})`).join(' · ')));
    if (!o.terminal) {
      cuerpo.push(h('div', { class: 'fila tr-controles' },
        o.pausado
          ? boton(T('Reanudar', 'Resume'), () => void control(o, 'reanudar'), { icono: 'play' })
          : boton(T('Pausar', 'Pause'), () => void control(o, 'pausar'), { icono: 'pausa', titulo: T('AURA no arranca nada nuevo de este objetivo hasta que lo reanudes', 'AURA starts nothing new until you resume') }),
        boton(T('Cancelar objetivo', 'Cancel goal'), () => { if (confirm(T('¿Cancelar este objetivo? Lo que ya se hizo queda anotado.', 'Cancel this goal?'))) void control(o, 'cancelar'); }, { tipo: 'peligro' })));
    }
    hoja.replaceChildren(...cuerpo);
  }

  function bloqueDecision(o: Objetivo) {
    const d = o.decision!;
    const botones = d.opciones.map((op, i) => boton(op.etiqueta, (ev) => void decidir(o, op, ev.currentTarget as HTMLButtonElement), { tipo: i === 0 ? 'acento' : 'suave', titulo: op.consecuencia }));
    return h('section', { class: 'tr-decision', 'aria-label': T('Decisión pendiente', 'Pending decision') },
      h('h3', { class: 'rotulo' }, T('Te toca decidir', 'Your call')),
      h('p', null, d.pregunta),
      h('div', { class: 'tr-opciones' }, ...d.opciones.map((op, i) => h('div', { class: 'tr-opcion' }, botones[i], op.consecuencia ? h('small', { class: 'tenue' }, op.consecuencia) : null))));
  }

  function aplicar(r: Resultado, okTexto: string) {
    if (r.objetivo) pintarHoja(r.objetivo, [], r.conflicto ? `${r.conflicto.mensaje}. ${r.conflicto.detalle || T('Mira cómo quedó antes de decidir.', 'See how it is now before deciding.')}` : undefined);
    if (r.conflicto) avisar(r.conflicto.mensaje, 'info', 6000);
    else avisar(r.sinCambio ? T('Ya estaba así.', 'It was already like that.') : okTexto, 'ok');
    if (ultimo) void cargar(false);
  }

  async function decidir(o: Objetivo, op: Opcion, b: HTMLButtonElement) {
    hoja.querySelectorAll<HTMLButtonElement>('.tr-decision button').forEach((x) => (x.disabled = true));
    b.classList.add('cargando-btn');
    try {
      const r = await pedir<Resultado>('objetivos.decidir', { id: o.id, decisionId: o.decision!.id, opcion: op.id, revisionVista: o.revision }, 30_000);
      aplicar(r, T('Listo: ', 'Done: ') + op.etiqueta);
    } catch (e: any) {
      avisar(e?.message || T('No pude mandar tu decisión.', 'I couldn’t send your decision.'), 'mal', 7000);
      hoja.querySelectorAll<HTMLButtonElement>('.tr-decision button').forEach((x) => (x.disabled = false));
    }
  }

  async function control(o: Objetivo, accion: 'pausar' | 'reanudar' | 'cancelar') {
    try {
      const r = await pedir<Resultado>('objetivos.control', { id: o.id, accion, revisionVista: o.revision }, 30_000);
      aplicar(r, accion === 'pausar' ? T('En pausa.', 'Paused.') : accion === 'reanudar' ? T('Reanudado.', 'Resumed.') : T('Cancelado.', 'Cancelled.'));
    } catch (e: any) { avisar(e?.message || T('No se pudo.', 'It failed.'), 'mal', 7000); }
  }

  // El notch pide abrir una hoja («Continuar» → Ver).
  al<{ id: string }>('objetivo.abrir', (d) => { if (d?.id) void abrirHoja(String(d.id), true); });
  void cargar();
  // A la vista, se refresca cada 30 s (lo que AURA hace por detrás va cambiando el estado).
  setInterval(() => { if (vista.isConnected && !document.hidden) void cargar(); }, 30_000);
  return vista;
}
