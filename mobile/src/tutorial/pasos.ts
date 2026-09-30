/**
 * EL RECORRIDO DE PRIMERA VEZ: qué puede hacer el avatar, en pasos cortos.
 *
 * Solo capacidades que EXISTEN en el código (cada paso dice de dónde sale, para que nadie agregue una
 * promesa que la app no cumple). Se muestra una vez por persona al llegar a la mesa, se puede saltar,
 * marcar «no volver a mostrar» y abrir otra vez desde «Más → Qué puedo hacer».
 *
 * Sin React Native: se prueba en Node.
 */
import { tr } from '../i18n';
import type { NombreIcono } from '../pulse/ui/Icono';

export type PasoTutorial = {
  id: string;
  icono: NombreIcono;
  titulo: string;
  texto: string;
  /** Un ejemplo para decirle, entre comillas. */
  ejemplo?: string;
  /** De dónde sale la capacidad (para revisar; no se muestra). */
  fuente: string;
};

export function pasosTutorial(avatar: string): PasoTutorial[] {
  return [
    {
      id: 'hablar',
      icono: 'microfono',
      titulo: tr('Háblale', 'Talk to me'),
      texto: tr(
        `Toca «Hablar» y dile lo que quieras. Si ${avatar} está hablando y quieres que pare, dile «cállate» o háblale encima en la conversación en vivo: se calla y te escucha.`,
        `Tap “Talk” and say anything. If ${avatar} is talking and you want it to stop, say “be quiet” or talk over it in a live conversation: it stops and listens.`
      ),
      ejemplo: tr('«¿Qué tengo que hacer hoy?»', '“What do I have to do today?”'),
      fuente: 'screens/DeskScreen (oído siempre abierto, intención callar) · components/ModoConversacion (onInterruption)',
    },
    {
      id: 'envivo',
      icono: 'llamar',
      titulo: tr('Conversación en vivo', 'Live conversation'),
      texto: tr(
        `En «Más → Conversar en vivo» hablas de corrido con ${avatar}, como en una llamada: sin tocar nada entre frase y frase.`,
        `In “More → Live conversation” you talk with ${avatar} hands-free, like a call: no tapping between sentences.`
      ),
      fuente: 'compa/VozProvider + components/ModoConversacion (ElevenLabs Agents) · server/voz-agente',
    },
    {
      id: 'chat',
      icono: 'burbujas',
      titulo: tr('Chat y llamadas con tu gente', 'Chat and calls with your people'),
      texto: tr(
        '«Chat» abre PULSE2CHAT: mensajes con tus contactos y llamadas de voz y video. También se lo puedes pedir: te pregunta antes de llamar.',
        '“Chat” opens PULSE2CHAT: messages with your contacts and voice and video calls. You can also ask me: I check with you before calling.'
      ),
      ejemplo: tr('«Llama a Mamá»', '“Call Mom”'),
      fuente: 'pulse/* (chat y llamada.ts) · lib/manos-app.ts (llamar, solo tras el «sí»)',
    },
    {
      id: 'manos',
      icono: 'enviar',
      titulo: tr('Lee y escribe por ti', 'Reads and writes for you'),
      texto: tr(
        'Te lee lo último que te escribieron, busca en tus chats y deja escrito un mensaje: te lo lee y lo envía solo si dices «sí».',
        'It reads your latest messages, searches your chats and drafts a message: it reads it back and sends it only if you say “yes”.'
      ),
      ejemplo: tr('«¿Qué me dijo Beto?» · «Escríbele a Mamá que llego tarde»', '“What did Beto say?” · “Text Mom I’ll be late”'),
      fuente: 'lib/acciones-app.ts (redactar, enviar) · lib/manos-app.ts (leer, buscar)',
    },
    {
      id: 'recordatorios',
      icono: 'reloj',
      titulo: tr('Recordatorios, y te llama', 'Reminders, and it calls you'),
      texto: tr(
        `Pídele que te recuerde algo a una hora. Si le dices «llámame», a esa hora ${avatar} te llama a pantalla completa y te lo dice con su voz.`,
        `Ask for a reminder at a time. If you say “call me”, at that time ${avatar} calls you full screen and tells you out loud.`
      ),
      ejemplo: tr('«Llámame a las 5 para recordarme el banco»', '“Call me at 5 to remind me about the bank”'),
      fuente: 'compa/recordatorios.ts · compa/LlamadaAura.tsx · contrato (recordatorio con llamada)',
    },
    {
      id: 'internet',
      icono: 'buscar',
      titulo: tr('Busca en internet', 'Searches the web'),
      texto: tr('Pregúntale algo de hoy y lo busca en internet y te lo resume.', 'Ask about something current and it searches the web and sums it up.'),
      ejemplo: tr('«Busca cómo está el precio del oro hoy»', '“Search today’s gold price”'),
      fuente: 'src/06-manos/web.ts (búsqueda y lectura web del servidor)',
    },
    {
      id: 'camara',
      icono: 'camara',
      titulo: tr('La cámara, solo si quieres', 'The camera, only if you want'),
      texto: tr(
        'Empieza apagada. Dile «puedes verme» o tócala en «Más»: eliges solo ahora o siempre. Con tu permiso puede reconocer tu cara y la de quien le presentes (guarda números, no fotos).',
        'It starts off. Say “you can see me” or tap it in “More”: choose just now or always. With your permission it can recognize your face and people you introduce (it keeps numbers, not photos).'
      ),
      ejemplo: tr('«Te presento a Ana»', '“Meet Ana”'),
      fuente: 'lib/camaraModo.ts · src/caras (reconocimiento con consentimiento)',
    },
    {
      id: 'avatar',
      icono: 'cambiar',
      titulo: tr('Cambia de avatar', 'Switch avatar'),
      texto: tr('En «Más → Avatar» eliges con quién hablar, o díselo.', 'In “More → Avatar” pick who to talk to, or just say it.'),
      ejemplo: tr('«Cambia a Claudio»', '“Switch to Claudio”'),
      fuente: 'avatares/SelectorAvatar · lib/acciones-app.ts (avatar)',
    },
  ];
}

/* ── ¿ya lo vio? (por persona, en los ajustes del teléfono) ──────────────────────────────── */

const correoNormal = (c: string) => String(c || '').trim().toLowerCase();

/** Se muestra solo si esta persona no marcó «no volver a mostrar» ni lo terminó antes. */
export function tocaTutorial(vistos: Record<string, boolean> | undefined, correo: string): boolean {
  const c = correoNormal(correo);
  return !!c && !vistos?.[c];
}

export function conTutorialVisto(vistos: Record<string, boolean> | undefined, correo: string): Record<string, boolean> {
  const c = correoNormal(correo);
  return c ? { ...(vistos || {}), [c]: true } : { ...(vistos || {}) };
}
