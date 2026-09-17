/**
 * Memoria de personas + hechos — en RAM con snapshot opcional.
 * Se inyecta en el system prompt junto al Cerebro de Orden Global.
 */

export type PersonFact = {
  key: string;
  value: string;
  at: string;
  source?: string;
};

export type PersonMemory = {
  id: string;
  nombre: string;
  rol?: string;
  correo?: string;
  hechos: PersonFact[];
  conversationIds: string[];
  lastSeen: string;
};

const people = new Map<string, PersonMemory>();

function idFrom(nombre: string, correo?: string): string {
  const base = (correo || nombre).toLowerCase().trim();
  return base.replace(/[^a-z0-9@._-]+/g, '-');
}

export function upsertPerson(input: {
  nombre: string;
  rol?: string;
  correo?: string;
  conversationId?: string;
  hecho?: { key: string; value: string; source?: string };
}): PersonMemory {
  const id = idFrom(input.nombre, input.correo);
  const now = new Date().toISOString();
  const prev = people.get(id);
  const next: PersonMemory = prev || {
    id,
    nombre: input.nombre,
    rol: input.rol,
    correo: input.correo,
    hechos: [],
    conversationIds: [],
    lastSeen: now,
  };
  next.nombre = input.nombre || next.nombre;
  if (input.rol) next.rol = input.rol;
  if (input.correo) next.correo = input.correo;
  next.lastSeen = now;
  if (input.conversationId && !next.conversationIds.includes(input.conversationId)) {
    next.conversationIds.push(input.conversationId);
    next.conversationIds = next.conversationIds.slice(-20);
  }
  if (input.hecho?.key && input.hecho.value) {
    next.hechos = [
      ...next.hechos.filter((h) => h.key !== input.hecho!.key),
      { ...input.hecho, at: now },
    ].slice(-40);
  }
  people.set(id, next);
  return next;
}

export function getPerson(nombreOrCorreo: string): PersonMemory | null {
  const id = idFrom(nombreOrCorreo, nombreOrCorreo.includes('@') ? nombreOrCorreo : undefined);
  return people.get(id) || [...people.values()].find((p) => p.nombre.toLowerCase() === nombreOrCorreo.toLowerCase()) || null;
}

export function listPeople(): PersonMemory[] {
  return [...people.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/** Extrae menciones simples de nombre/rol/dato desde el texto del usuario. */
export function extractPersonHints(text: string): Array<{ key: string; value: string }> {
  const hints: Array<{ key: string; value: string }> = [];
  const soy = text.match(/\b(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñ]+)/i);
  if (soy) hints.push({ key: 'nombre_declarado', value: soy[1] });
  const rol = text.match(/\b(?:soy|actuó como|actuo como)\s+(el\s+)?(director|ceo|cto|junta|ingeniero|medico|médico)[\w\s]{0,40}/i);
  if (rol) hints.push({ key: 'rol_declarado', value: rol[0] });
  const fecha = text.match(/\b(?:nací|naci|cumpleaños|cumple)\s+(?:el\s+)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (fecha) hints.push({ key: 'fecha_personal', value: fecha[1] });
  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (email) hints.push({ key: 'correo', value: email[0] });
  return hints;
}

/** Bloque de contexto para system prompt + vínculo con Cerebro. */
export function memoryPromptBlock(opts: {
  currentUser?: { nombre?: string; rol?: string; correo?: string } | null;
  conversationId?: string;
}): string {
  const lines: string[] = [];
  if (opts.currentUser?.nombre) {
    const p = upsertPerson({
      nombre: opts.currentUser.nombre,
      rol: opts.currentUser.rol,
      correo: opts.currentUser.correo,
      conversationId: opts.conversationId,
    });
    lines.push(`Usuario activo: ${p.nombre}${p.rol ? ` · ${p.rol}` : ''}${p.correo ? ` · ${p.correo}` : ''}.`);
    if (p.hechos.length) {
      lines.push(
        'Hechos recordados: ' +
          p.hechos
            .slice(-8)
            .map((h) => `${h.key}=${h.value}`)
            .join('; ')
      );
    }
    // Puente con Cerebro de Orden Global
    if (/junta|director|orden global/i.test(p.rol || '')) {
      lines.push(
        'Este usuario pertenece a la junta: puedes usar doctrinas del Cerebro de Orden Global (tool query_global_order_brain) cuando pregunte por gobernanza, geopolítica o estatutos.'
      );
    }
  }
  const others = listPeople()
    .filter((p) => p.nombre !== opts.currentUser?.nombre)
    .slice(0, 5);
  if (others.length) {
    lines.push(
      'Otras personas en memoria: ' +
        others.map((p) => `${p.nombre}${p.rol ? ` (${p.rol})` : ''}`).join(', ')
    );
  }
  return lines.length ? `MEMORIA DE PERSONAS:\n${lines.join('\n')}` : '';
}
