/**
 * EL EQUIPO COMENTA LO QUE SE ACABA DE VER.
 *
 * Tocar «Timelapse satelital», subir un expediente o sacar un perfil del terreno no puede quedar en
 * silencio: el que sabe de eso lo mira y dice algo, otro de la mesa le agrega su parte, y al final
 * le preguntan a la persona si quiere profundizar en algo concreto. Es lo que hace un equipo de
 * verdad frente a una pantalla.
 *
 *  · Quién habla depende de QUÉ se vio: el satélite y el terreno son de la Ing. Tatiana (vegetación,
 *    obra, agua); un mapa geológico, del doctor; un documento, del doctor y Tatiana; la planta, de
 *    Don Chema.
 *  · Los números salen SOLO del contexto que manda la pantalla (lo que se vio); el oficio lo ponen
 *    ellos. Sin cerebro disponible, un comentario corto armado con el mismo contexto: nunca nada.
 */
import { fetchNodo, NODO_MODELO, NODO_SECRETO, NODO_URL } from '../../lib/nodo';
import { leerGuion, type Linea } from './dialogo';
import { OFICIOS, type Experto } from './personajes';

export type Tema = 'timelapse' | 'documento' | 'perfil' | 'geologico' | 'foto' | 'ficha' | 'filtro' | 'lugar' | 'general';

export const TEMAS: Tema[] = ['timelapse', 'documento', 'perfil', 'geologico', 'foto', 'ficha', 'filtro', 'lugar', 'general'];

/** Quién comenta cada cosa, en orden. */
export const QUIENES: Record<Tema, Experto[]> = {
  timelapse: ['tatiana', 'electrum'],
  documento: ['electrum', 'tatiana'],
  perfil: ['tatiana', 'chema'],
  geologico: ['electrum', 'chema'],
  foto: ['electrum', 'chema'],
  ficha: ['electrum', 'tatiana'],
  filtro: ['electrum', 'chema'],
  lugar: ['electrum', 'tatiana'],
  general: ['electrum', 'tatiana'],
};

const QUE_ES: Record<Tema, string> = {
  timelapse: 'el timelapse satelital (Sentinel-2) de una concesión: cómo cambió el terreno año con año',
  documento: 'un documento que se acaba de subir y leer',
  perfil: 'un perfil topográfico que se acaba de trazar en el mapa',
  geologico: 'un mapa geológico que se acaba de dibujar',
  foto: 'una foto que se acaba de analizar',
  ficha: 'la ficha de una concesión que se acaba de abrir',
  filtro: 'las concesiones que quedaron marcadas en el mapa por mineral',
  lugar: 'un lugar de Honduras al que se acaba de ir en el mapa',
  general: 'lo que se acaba de mostrar en pantalla',
};

export function instruccion(tema: Tema, quienes: Experto[]): string {
  return [
    `Sos la mesa de trabajo de ELECTRUM mirando ${QUE_ES[tema]}. Hablan, en español de Honduras:`,
    ...quienes.map((q) => `· ${OFICIOS[q].nombre} (${OFICIOS[q].titulo}); habla ${OFICIOS[q].estilo}.`),
    `Reglas: de 2 a 4 líneas cortas (una o dos frases), empezando ${OFICIOS[quienes[0]].nombre}; cada uno dice lo que ve desde SU oficio y el otro le contesta o le agrega; las cifras SOLO del contexto (si no hay cifras, no las inventes); la ÚLTIMA línea le pregunta a la persona si quiere profundizar en algo concreto (nombrado). Sin listas ni markdown.`,
    'Podés marcar cómo se dice una línea con UNA etiqueta de voz en inglés al principio: [curious], [thoughtful], [warmly], [serious], [surprised], [concerned].',
    'Contestá SOLO un JSON: {"lineas":[{"quien":"tatiana","texto":"..."}]}, con quien = electrum | tatiana | chema.',
  ].join('\n');
}

/** Sin cerebro: un comentario honesto con lo que dice el contexto, y la pregunta. */
export function comentarioDeRespaldo(tema: Tema, contexto: string, quienes: Experto[]): Linea[] {
  const frase = String(contexto || '')
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]/)?.[0]
    ?.trim();
  const primero = quienes[0];
  const segundo = quienes[1] || 'electrum';
  const pregunta: Record<Tema, string> = {
    timelapse: '¿Quiere que revisemos los años en que más cambió la cobertura?',
    documento: '¿Quiere que le saquemos las obligaciones y los plazos que trae?',
    perfil: '¿Quiere que veamos por dónde conviene el acceso con esas pendientes?',
    geologico: '¿Quiere que le expliquemos qué roca favorece la mineralización ahí?',
    foto: '¿Quiere que lo comparemos con la geología de la zona?',
    ficha: '¿Quiere que la analicemos completa, con riesgos y recomendación?',
    filtro: '¿Quiere que veamos cuáles de esas tienen mejor prospectividad?',
    lugar: '¿Quiere ver qué concesiones hay alrededor?',
    general: '¿En qué quiere que profundicemos?',
  };
  const lineas: Linea[] = [];
  if (frase) lineas.push({ quien: primero, texto: `[thoughtful] ${frase}` });
  lineas.push({ quien: segundo, texto: `[curious] ${pregunta[tema]}` });
  return lineas;
}

/** El comentario de la mesa: primero el cerebro; si no está o tarda, el de respaldo. */
export async function comentarMesa(tema: Tema, contexto: string): Promise<{ lineas: Linea[]; origen: 'cerebro' | 'respaldo' }> {
  const quienes = QUIENES[tema] || QUIENES.general;
  const base = String(contexto || '').slice(0, 3000);
  if (NODO_URL) {
    try {
      const r = await fetchNodo(`${NODO_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': NODO_SECRETO },
        body: JSON.stringify({
          model: NODO_MODELO,
          stream: false,
          messages: [
            { role: 'system', content: instruccion(tema, quienes) },
            { role: 'user', content: `Contexto de lo que se ve:\n${base || '(sin datos)'}` },
          ],
          options: { temperature: 0.6 },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) {
        const j: any = await r.json().catch(() => ({}));
        const lineas = leerGuion(String(j?.message?.content || '')).filter((l) => l.quien !== 'narrador').slice(0, 5);
        if (lineas.length >= 1) return { lineas, origen: 'cerebro' };
      }
    } catch {
      /* sin cerebro: respaldo */
    }
  }
  return { lineas: comentarioDeRespaldo(tema, base, quienes), origen: 'respaldo' };
}
