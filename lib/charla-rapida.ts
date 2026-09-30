/**
 * LA CHARLA DE SIEMPRE, AL INSTANTE: «hola», «¿cómo estás?», «gracias», «adiós» dichos en voz alta.
 *
 * José (30-sep, APK 5.1): «conversación como "¿cómo estás?" demasiado lenta; no se siente fluida».
 * Un saludo no necesita memoria, clasificador ni modelo: antes pasaba por preparar el turno entero y
 * por el modelo chico (apagado por omisión, MODELO_CHICO_MODO), y entonces por el 27B de la T4. Aquí,
 * si la frase es SOLO charla por su forma (esCharlaTrivial: todas sus palabras son de saludo, gracias
 * o despedida), contesta un banco corto por avatar e idioma, con su forma de ser, sin repetirse.
 *
 * Lo que no es solo charla («hola, ¿qué hora es?», «gracias, mándalo») no entra: lo contesta el cerebro.
 * «ok», «listo», «dale» tampoco: pueden ser el «sí» de algo pendiente.
 */
import { esCharlaTrivial } from './cognitivo/modelos';
import type { AvatarVoz, Idioma } from '../server/eleven';

export type TipoCharla = 'como_estas' | 'saludo' | 'gracias' | 'adios';

const plano = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Lo mismo que esCharlaTrivial, en inglés (la app también habla inglés). */
const EN = new Set(
  'hi hello hey there good morning afternoon evening night how are you doing is it going things thanks thank you so much very bye goodbye see later soon take care aura au ra'.split(' ')
);
function charlaEnIngles(texto: string): boolean {
  const p = plano(texto).replace(/'s\b/g, ' is');
  const w = p.split(' ').filter(Boolean);
  return w.length > 0 && w.length <= 8 && w.every((x) => EN.has(x));
}

/** Qué clase de charla es (o null si no es SOLO charla). */
export function tipoCharla(texto: string): TipoCharla | null {
  if (!esCharlaTrivial(texto) && !charlaEnIngles(texto)) return null;
  const p = plano(texto);
  if (/\b(como estas|como esta|como te va|como vas|que tal|how are you|how is it going|how are things|how you doing)\b/.test(p.replace(/'s\b/g, ' is'))) return 'como_estas';
  if (/\b(gracias|agradezco|thanks|thank you)\b/.test(p)) return 'gracias';
  if (/\b(adios|chao|chau|bye|goodbye|hasta luego|hasta manana|hasta pronto|nos vemos|see you|take care)\b/.test(p)) return 'adios';
  if (/\b(hola|holi|buenas|buenos|buen dia|hey|saludos|hi|hello|good morning|good afternoon|good evening)\b/.test(p)) return 'saludo';
  return null;
}

type Banco = Record<TipoCharla, { es: string[]; en: string[] }>;

// {n}: el nombre de la persona (si se sabe); sin nombre la frase se queda bien igual.
const BANCOS: Record<AvatarVoz, Banco> = {
  aura: {
    como_estas: {
      es: ['¡Muy bien, gracias por preguntar! ¿Y tú, cómo vas?', '¡Aquí contenta de oírte{n}! ¿Tú cómo estás?', 'Bien, bien. ¿Y tú qué tal tu día?'],
      en: ["I'm great, thanks for asking! How about you?", 'Happy to hear you{n}! How are you doing?', "Doing well. How's your day going?"],
    },
    saludo: {
      es: ['¡Hola{n}! ¿En qué te ayudo?', '¡Qué gusto oírte{n}! Dime.', '¡Hola{n}! Aquí estoy.'],
      en: ['Hi{n}! How can I help?', 'So good to hear you{n}! Go ahead.', "Hello{n}! I'm here."],
    },
    gracias: { es: ['¡Con mucho gusto!', 'Para eso estoy.', '¡De nada{n}!'], en: ['My pleasure!', "That's what I'm here for.", "You're welcome{n}!"] },
    adios: { es: ['¡Cuídate mucho{n}! Aquí estaré.', '¡Hasta luego{n}!', 'Nos hablamos pronto.'], en: ['Take care{n}! I’ll be here.', 'See you later{n}!', 'Talk soon.'] },
  },
  ojos: {
    como_estas: { es: ['Todo en orden, gracias. ¿Y tú?', 'Bien y atento. ¿Cómo estás tú?'], en: ['All in order, thanks. And you?', 'Well and alert. How are you?'] },
    saludo: { es: ['Hola{n}. Te escucho.', 'Buen día{n}. Dime.'], en: ["Hello{n}. I'm listening.", 'Good to hear you{n}. Go ahead.'] },
    gracias: { es: ['Con gusto.', 'Siempre.'], en: ['Glad to help.', 'Always.'] },
    adios: { es: ['Hasta luego{n}. Sigo de guardia.', 'Cuídate{n}.'], en: ['Until later{n}. Still on watch.', 'Take care{n}.'] },
  },
  claudio: {
    como_estas: {
      es: ['¡De maravilla, con la cola en alto! ¿Y tú qué tal?', 'Bien, curioseando como siempre. ¿Tú cómo vas?'],
      en: ['Fantastic, tail up high! How about you?', 'Good, curious as ever. How are you?'],
    },
    saludo: { es: ['¡Hola{n}! ¿Qué tramamos hoy?', '¡Hey{n}! Aquí tu zorro favorito.'], en: ['Hi{n}! What are we up to today?', 'Hey{n}! Your favorite fox here.'] },
    gracias: { es: ['¡Un placer, como siempre!', 'Para servirte, sin cobrar comisión.'], en: ['A pleasure, as always!', 'At your service, no fee.'] },
    adios: { es: ['¡Nos vemos{n}! No me extrañes mucho.', '¡Hasta luego{n}!'], en: ["See you{n}! Don't miss me too much.", 'Later{n}!'] },
  },
  antonio: {
    como_estas: { es: ['¡Con los cuatro brazos listos! ¿Y tú cómo vas?', '¡Muy bien y con energía! ¿Tú qué tal?'], en: ['All four arms ready! How about you?', 'Great and full of energy! How are you?'] },
    saludo: { es: ['¡Hola{n}! ¿Qué resolvemos?', '¡Aquí ANT-ONIO{n}! Dime.'], en: ['Hi{n}! What are we solving?', 'ANT-ONIO here{n}! Go ahead.'] },
    gracias: { es: ['¡A la orden!', '¡Con gusto, para eso son los brazos!'], en: ['Anytime!', "Happy to, that's what the arms are for!"] },
    adios: { es: ['¡Hasta luego{n}! Aquí sigo.', '¡Nos vemos{n}!'], en: ["See you{n}! I'll be around.", 'Bye{n}!'] },
  },
};

const EMOCION: Record<TipoCharla, 'feliz' | 'carino'> = { como_estas: 'feliz', saludo: 'feliz', gracias: 'carino', adios: 'carino' };
const ultimas = new Map<string, number>();

/** La respuesta al instante, o null si no es solo charla. `azar` para las pruebas. */
export function respuestaCharla(
  texto: string,
  o: { avatar?: AvatarVoz; idioma?: Idioma; nombre?: string | null; azar?: () => number } = {}
): { texto: string; emocion: 'feliz' | 'carino'; tipo: TipoCharla } | null {
  const tipo = tipoCharla(texto);
  if (!tipo) return null;
  const avatar: AvatarVoz = o.avatar && BANCOS[o.avatar] ? o.avatar : 'aura';
  const idioma: Idioma = o.idioma === 'en' ? 'en' : 'es';
  const l = BANCOS[avatar][tipo][idioma];
  const clave = `${avatar}|${idioma}|${tipo}`;
  const antes = ultimas.get(clave);
  let i = Math.floor((o.azar || Math.random)() * l.length) % l.length;
  if (l.length > 1 && i === antes) i = (i + 1) % l.length;
  ultimas.set(clave, i);
  const nombre = String(o.nombre || '').trim();
  const conNombre = nombre && nombre.length <= 20 ? `, ${nombre}` : '';
  return { texto: l[i].replace('{n}', conNombre), emocion: EMOCION[tipo], tipo };
}
