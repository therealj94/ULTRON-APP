/**
 * Catálogo de capacidades — la única lista de "qué puede hacer AU-RA".
 * La sirve GET /api/capacidades y la pintan Ajustes (web) y el menú (APK).
 * Cada tarjeta corresponde a algo que de verdad ejecuta el servidor o la app.
 * `vivo` sale de la salud real; nunca se marca vivo lo que no respondió.
 */

import { EMOCIONES, EMOCION_INFO, type Emocion } from './emocion';
import { perfilActivo, type Herramienta, type PerfilCerebro } from './perfiles';

export type GrupoCapacidad = 'herramientas' | 'voz' | 'personalidad' | 'gestos' | 'canales' | 'memoria';

export type Capacidad = {
  id: string;
  grupo: GrupoCapacidad;
  titulo: string;
  detalle: string;
  /** Frases de ejemplo que la disparan (voz o texto). */
  ejemplos: string[];
  /** true = responde ahora; false = falta clave o nodo caído; null = no se mide. */
  vivo: boolean | null;
  falta?: string;
  /** Solo web / solo APK / ambas. */
  donde: 'web' | 'apk' | 'ambas';
  /**
   * Herramienta del perfil que esta tarjeta necesita. Si el perfil no la tiene, la tarjeta no se
   * muestra: el catálogo promete lo que la plataforma hace de verdad, y el Cerebro de Minas no
   * redespliega nada ni canta.
   */
  requiere?: Herramienta;
};

export type EstadoNodos = {
  /** El Qwen del nodo propio (el último respaldo del cerebro; Windows lo usa directo). */
  qwen: boolean;
  ojo: boolean;
  /** Voicebox configurado y contestando (el respaldo de la voz, en el servidor propio de AU-RA). */
  voz: boolean;
  memoriaS3: boolean;
  telegram: boolean;
  telegramIn: boolean;
  ejecutor: boolean;
  vision: boolean;
  oido: boolean;
  /*
   * Auditoría del 7-oct (A-1): lo que de verdad piensa y habla, y las manos que faltaban. Opcionales: sin ellos, el
   * catálogo no afirma nada de eso (lo da por no medido).
   */
  /** El cerebro de Bedrock (lib/cerebro-rapido.ts estadoCerebroRapido). */
  cerebro?: { activo: boolean; apagado?: boolean; pausado?: boolean; modelo: string; respaldo?: string | null; degradados?: string[] };
  /** ElevenLabs contesta con la llave del servidor (server/eleven.ts saludEleven): la voz de verdad. */
  eleven?: boolean;
  whatsapp?: { configurado: boolean; vivo: boolean };
  /** El correo de cada cuenta se puede conectar en este servidor (la llave de cifrado). Cada buzón no se mide aquí. */
  correo?: boolean;
  computadora?: { configurada: boolean; vivo: boolean };
  /** Crear Word, Excel, PowerPoint y PDF (server/documentos.ts). */
  documentos?: boolean;
  /** Quien pregunta tiene encendido hablarle encima para interrumpirla (Ajustes, en prueba). Por omisión, no. */
  interrumpir?: boolean;
};

/** El nombre legible de un modelo de Bedrock («zai.glm-5» → «GLM-5 (Z.ai)»); uno que no se conoce, tal cual. */
export function nombreDeModelo(id: string | null | undefined): string {
  const m = String(id || '').trim();
  const conocidos: Record<string, string> = {
    'zai.glm-5': 'GLM-5 (Z.ai)',
    'moonshotai.kimi-k2.5': 'Kimi K2.5 (Moonshot)',
    'deepseek.v3-2': 'DeepSeek 3.2',
  };
  return conocidos[m] || m || 'sin modelo';
}

/** La tarjeta del cerebro, con lo que de verdad contesta ahora. */
function tarjetaCerebro(n: EstadoNodos): Capacidad {
  const c = n.cerebro;
  const advertencia = 'Puede equivocarse: para cifras y noticias usa las herramientas con fuente, y lo importante conviene comprobarlo.';
  if (!c) {
    return { id: 'chat', grupo: 'herramientas', titulo: 'Conversar y razonar', detalle: `Piensa antes de hablar y recuerda el hilo. ${advertencia}`, ejemplos: ['¿qué opinas de abrir sociedad en Próspera?', 'resúmeme lo de ayer'], vivo: null, donde: 'ambas' };
  }
  const respaldo = c.respaldo ? `, con ${nombreDeModelo(c.respaldo)} de respaldo` : '';
  const ahora = c.activo
    ? c.degradados?.length
      ? ` Ahora ${c.degradados.map(nombreDeModelo).join(' y ')} va lento: contesta primero el otro.`
      : ''
    : c.pausado
      ? ` Ahora Bedrock está en pausa por fallos seguidos: contesta el Qwen 27B del nodo propio${n.qwen ? '' : ', que tampoco responde'}.`
      : ` En este servidor no se usa Bedrock: contesta el Qwen 27B del nodo propio${n.qwen ? '' : ', que no responde'}.`;
  const vivo = c.activo || n.qwen;
  return {
    id: 'chat',
    grupo: 'herramientas',
    titulo: 'Conversar y razonar',
    detalle: `Cerebro ${nombreDeModelo(c.modelo)} en Amazon Bedrock${respaldo}; si no contestan, el Qwen 27B del nodo propio (más lento y sin manos).${ahora} Piensa antes de hablar y recuerda el hilo. ${advertencia}`,
    ejemplos: ['¿qué opinas de abrir sociedad en Próspera?', 'resúmeme lo de ayer'],
    vivo,
    falta: vivo ? undefined : 'ni Bedrock ni el nodo Qwen responden',
    donde: 'ambas',
  };
}

/** Las manos que hacen cosas por la persona, con su salud real (la que no se puede medir aquí, null). */
function tarjetasDeManos(n: EstadoNodos): Capacidad[] {
  const out: Capacidad[] = [];
  if (n.whatsapp) {
    const w = n.whatsapp;
    out.push({
      id: 'whatsapp',
      grupo: 'canales',
      titulo: 'Tu WhatsApp',
      detalle: 'Lee tus chats, busca y te deja el mensaje listo; nada sale sin tu «sí» al texto exacto, y no dice que salió sin el recibo. Por ahora solo texto: ni notas de voz, ni fotos, ni archivos.',
      ejemplos: ['¿qué me dijo Ana por WhatsApp?', 'mándale a Beto que llego tarde'],
      vivo: w.configurado && w.vivo,
      falta: !w.configurado ? 'WhatsApp no está conectado en este servidor' : w.vivo ? undefined : 'el puente de WhatsApp no contesta',
      donde: 'ambas',
    });
  }
  if (n.correo !== undefined) {
    out.push({
      id: 'correo',
      grupo: 'canales',
      titulo: 'Tu correo',
      detalle: 'Revisa, lee y busca en tu correo (con clave de aplicación o Microsoft). Responde o escribe dejando un borrador que sale solo con tu «sí». Los adjuntos los ve por su nombre; todavía no los lee.',
      ejemplos: ['revisa mi correo', 'léeme el último de Ana'],
      // Cada buzón es de cada cuenta: aquí solo se sabe si este servidor puede conectarlos.
      vivo: n.correo ? null : false,
      falta: n.correo ? undefined : 'falta la llave de cifrado del correo (CORREO_CLAVE_CIFRADO)',
      donde: 'ambas',
    });
  }
  if (n.computadora) {
    const c = n.computadora;
    out.push({
      id: 'computadora',
      grupo: 'herramientas',
      titulo: 'Mi computadora',
      detalle: 'Una computadora en la nube (Firefox, LibreOffice) con la que AU-RA entra a páginas, compara y llena formularios; la ves en vivo en tu teléfono. Nunca paga ni pone contraseñas. Es una sola para todas las cuentas: si está ocupada, espera su turno.',
      ejemplos: ['usa tu computadora para comparar vuelos a Miami'],
      vivo: c.configurada && c.vivo,
      falta: !c.configurada ? 'COMPUTADORA_URL + COMPUTADORA_CLAVE' : c.vivo ? undefined : 'la computadora no contesta',
      donde: 'ambas',
    });
  }
  out.push({
    id: 'recordatorios',
    grupo: 'herramientas',
    titulo: 'Recordatorios y «AU-RA te llama»',
    detalle: 'Pone recordatorios, timers y alarmas a una hora; a esa hora tu teléfono suena como una llamada de AU-RA. Viven en ese teléfono, no en el servidor: si cambias de teléfono o desinstalas la app, se pierden.',
    ejemplos: ['recuérdame a las 5 llamar al banco', 'llámame en diez minutos'],
    vivo: null,
    donde: 'apk',
  });
  if (n.documentos !== undefined) {
    out.push({
      id: 'documentos',
      grupo: 'herramientas',
      titulo: 'Documentos de Word, Excel, PowerPoint y PDF',
      detalle: 'Los arma en tu cuenta con lo que le pidas y te deja el enlace para bajarlos; el servidor revisa que abran bien antes de decir que están listos. Con sesión.',
      ejemplos: ['hazme un informe en Word de la reunión', 'arma un presupuesto en Excel'],
      vivo: n.documentos,
      falta: n.documentos ? undefined : 'solo con sesión',
      donde: 'ambas',
    });
  }
  return out;
}

export const MODOS = [
  { id: 'GUARDIAN', etiqueta: 'Guardián', tono: 'firme, protege a la junta' },
  { id: 'EXPLORER', etiqueta: 'Explorador', tono: 'curioso, pregunta más' },
  { id: 'GOLD', etiqueta: 'Oro', tono: 'cálido, habla de metal y bóveda' },
  { id: 'MINING', etiqueta: 'Minería', tono: 'seco, operativo' },
  { id: 'ANALYTICAL', etiqueta: 'Analítico', tono: 'preciso, cifras y fuentes' },
  { id: 'STRATEGIC', etiqueta: 'Estratégico', tono: 'bajo, piensa a largo' },
  { id: 'CREATIVE', etiqueta: 'Creativo', tono: 'juguetón, propone' },
] as const;

/**
 * La voz de AU-RA (server/voz.ts hablar): ElevenLabs primero, una voz por avatar en español y en inglés; Voicebox (Kokoro,
 * en el servidor propio) de respaldo. Auditoría del 7-oct (A-1): aquí decía que la voz era solo Voicebox.
 */
export const VOZ_OFICIAL = {
  id: 'ultron',
  nombre: 'AU-RA',
  motor: 'ElevenLabs, una voz por avatar en español e inglés (respaldo: Voicebox · Kokoro, en el servidor propio de AU-RA)',
  timbre: 'cálida y cercana; Claudio, el Guardián y ANT-ONIO con la suya',
  respaldo: 'Voicebox (Kokoro) en el servidor propio; si ninguno contesta, AU-RA calla y el texto queda en pantalla',
  expresividad: ['pausa de pensar', 'muletillas', 'canciones grabadas'],
};

export const CANCIONES = [
  // Versiones de AU-RA: cantadas con la voz de Dora en el estudio (scripts/estudio), no las grabaciones de sus autores.
  { id: 'jesus', titulo: 'Quiero conocer a Jesús', artista: 'Generación 12 (versión de AU-RA)', pedir: 'canta quiero conocer a Jesús' },
  { id: 'waymaker', titulo: 'Way Maker', artista: 'Sinach (versión de AU-RA)', pedir: 'canta way maker' },
  // Propias de AU-RA, letra y música del estudio.
  { id: 'bienvenida', titulo: 'Bienvenidos a AU-RA', artista: 'AU-RA', pedir: 'canta la de bienvenida' },
  { id: 'felizdia', titulo: 'Feliz día', artista: 'AU-RA', pedir: 'cantame feliz día' },
  { id: 'bendicion', titulo: 'Bendición', artista: 'AU-RA', pedir: 'canta una bendición' },
  { id: 'cuna', titulo: 'Duerme, duerme (canción de cuna)', artista: 'AU-RA', pedir: 'cantame una canción de cuna' },
  { id: 'bohemian', titulo: 'Bohemian Rhapsody', artista: 'Queen', pedir: 'canta 1' },
  { id: 'ligera', titulo: 'De música ligera', artista: 'Soda Stereo', pedir: 'canta 2' },
  { id: 'bittersweet', titulo: 'Bitter Sweet Symphony', artista: 'The Verve', pedir: 'canta 3' },
  { id: 'runaway', titulo: 'Runaway', artista: 'Kanye West', pedir: 'canta 4' },
  { id: 'bruno', titulo: 'Die With A Smile', artista: 'Bruno Mars', pedir: 'canta 5' },
] as const;

export const GESTOS_TACTILES = [
  { id: 'ojo', zona: 'Tocar un ojo', hace: 'guiño y sonrisa' },
  { id: 'frente', zona: 'Tocar la frente', hace: 'levanta las cejas, curioso' },
  { id: 'mejilla', zona: 'Acariciar la mejilla', hace: 'ronronea y entrecierra los ojos' },
  { id: 'barbilla', zona: 'Tocar la barbilla', hace: 'cosquillas, se ríe' },
  { id: 'repetido', zona: 'Toques seguidos', hace: 'primero juega, luego se molesta en broma' },
  { id: 'largo', zona: 'Mantener pulsado', hace: 'se duerme o despierta' },
  { id: 'arrastrar', zona: 'Arrastrar el dedo', hace: 'los ojos siguen el dedo' },
  { id: 'camara', zona: 'Cámara frontal activa', hace: 'los ojos te siguen; se duerme si te vas' },
] as const;

/**
 * `perfil`: el cerebro de quien pregunta (server/nivel.ts + perfilPara). A un miembro de la comunidad
 * no se le prometen el Telegram de la junta ni el taller: su perfil no los tiene.
 */
export function catalogoCapacidades(n: EstadoNodos, perfil: PerfilCerebro = perfilActivo()): Capacidad[] {
  const her: Capacidad[] = [
    tarjetaCerebro(n),
    {
      id: 'oro',
      grupo: 'herramientas',
      titulo: 'Precio del oro y la plata',
      detalle: 'Spot XAU y XAG en dólares por onza, con fuente y hora.',
      ejemplos: ['precio del oro hoy', '¿cómo está la plata?'],
      vivo: null,
      donde: 'ambas',
    },
    {
      id: 'hnl',
      grupo: 'herramientas',
      titulo: 'Lempira a dólar',
      detalle: 'Tipo de cambio USD/HNL del día.',
      ejemplos: ['lempira a dólar', '¿a cuánto está el dólar?'],
      vivo: null,
      donde: 'ambas',
    },
    {
      id: 'web',
      grupo: 'herramientas',
      titulo: 'Buscar en internet',
      detalle: 'Busca, abre la fuente y cita de dónde salió. Si no encuentra, lo dice.',
      ejemplos: ['busca noticias de Honduras hoy', 'investiga qué es Hyperledger Besu'],
      vivo: null,
      donde: 'ambas',
    },
    {
      id: 'pagina',
      grupo: 'herramientas',
      titulo: 'Abrir páginas con Playwright',
      detalle: 'Nodo ojo en AWS abre la página real, lee el texto y toma captura.',
      ejemplos: ['abre https://www.bch.hn y dime el tipo de cambio', 'captura de ordenglobal.org'],
      vivo: n.ojo,
      falta: n.ojo ? undefined : 'nodo ojo no responde',
      donde: 'ambas',
    },
    {
      id: 'vision',
      grupo: 'herramientas',
      titulo: 'Ver por la cámara',
      detalle: 'Mira el frame actual o una foto y describe lo que hay, con números y texto.',
      ejemplos: ['¿qué ves?', 'lee esta etiqueta'],
      vivo: n.vision,
      falta: n.vision ? undefined : 'ojo o Gemini sin clave',
      donde: 'ambas',
    },
    {
      id: 'pdf',
      grupo: 'herramientas',
      titulo: 'Leer y generar PDF',
      detalle: 'Lee PDFs subidos (texto e imágenes) y genera PDFs cortos.',
      ejemplos: ['lee este PDF', 'haz un PDF con el resumen'],
      vivo: true,
      donde: 'ambas',
    },
    {
      id: 'sistema',
      requiere: 'taller',
      grupo: 'herramientas',
      titulo: 'Estado de los nodos',
      detalle: 'Sondea el cerebro, el ojo, la voz y la memoria. Avisa por Telegram si algo cae.',
      ejemplos: ['¿cómo está el sistema?', 'estado de los nodos'],
      vivo: true,
      donde: 'ambas',
    },
    {
      id: 'ejecutor',
      requiere: 'taller',
      grupo: 'herramientas',
      titulo: 'Ejecutar Python',
      detalle: 'Corre código en sandbox. Solo José y Medardo con sesión.',
      ejemplos: ['ejecuta este código', 'corre el script'],
      vivo: n.ejecutor,
      falta: n.ejecutor ? undefined : 'ejecutor apagado o sin sandbox',
      donde: 'ambas',
    },
    {
      id: 'tareas',
      grupo: 'herramientas',
      titulo: 'Pendientes de la junta',
      detalle: 'Anota y lista pendientes.',
      ejemplos: ['anota que mañana hay junta', '¿qué pendientes tengo?'],
      vivo: true,
      donde: 'ambas',
    },
    ...tarjetasDeManos(n),
  ];
  // La voz: ElevenLabs, y si no contesta, Voicebox (sin `eleven` medido, la de siempre: Voicebox).
  const vozViva = !!n.eleven || n.voz;
  const vozAhora = n.eleven === undefined ? '' : n.eleven ? ' Ahora habla con ElevenLabs.' : n.voz ? ' ElevenLabs no contesta: ahora habla con el respaldo (Voicebox).' : '';

  const voz: Capacidad[] = [
    {
      id: 'voz',
      grupo: 'voz',
      titulo: `Voz ${VOZ_OFICIAL.nombre} · ${VOZ_OFICIAL.timbre}`,
      detalle: `${VOZ_OFICIAL.motor}. Hace pausas de pensar y dice sus muletillas; los clips y las canciones están grabados.${vozAhora}`,
      ejemplos: ['dime algo con cariño', 'cuéntame un chiste'],
      vivo: vozViva,
      falta: vozViva ? undefined : 'ni ElevenLabs (ELEVENLABS_API_KEY) ni Voicebox (VOICEBOX_URL + VOICEBOX_CLAVE) contestan',
      donde: 'ambas',
    },
    {
      id: 'oido',
      grupo: 'voz',
      titulo: 'Oír y transcribir',
      // «Podés interrumpirla hablando» solo si quien pregunta lo tiene encendido: viene apagado (en prueba, por el eco).
      detalle: `Escucha continua.${n.interrumpir ? ' Puedes interrumpirla hablando.' : ' Para que se calle, dile «calla»; hablarle encima para interrumpirla se enciende en Ajustes (en prueba).'} En la web y en el teléfono tu voz va en vivo a ElevenLabs (Scribe v2 Realtime Turbo) mientras hablas; lo de dinero se vuelve a oír con Scribe v2 antes de actuar. Si el navegador no deja abrir el micrófono así, transcribe el reconocimiento de voz del navegador (en Chrome y Edge, un servicio de Google o Microsoft). Las notas de voz de Telegram las transcribe Scribe en el servidor de AU-RA.`,
      ejemplos: ['(habla cuando la luz esté cian)'],
      vivo: n.oido,
      falta: n.oido ? undefined : 'VOICEBOX_URL + VOICEBOX_CLAVE o GEMINI_API_KEY',
      donde: 'ambas',
    },
    {
      id: 'canto',
      requiere: 'canto',
      grupo: 'voz',
      titulo: 'Cantar',
      detalle: `Canta las canciones grabadas con su voz: ${CANCIONES.map((c) => c.titulo).join(', ')}. Una letra nueva la dice, no la canta.`,
      ejemplos: CANCIONES.slice(0, 3).map((c) => c.pedir),
      vivo: true,
      donde: 'ambas',
    },
    {
      id: 'oracion',
      requiere: 'canto',
      grupo: 'voz',
      titulo: 'Orar por el día',
      detalle: 'Una oración a Jesús por la junta, por Orden Global y por Honduras. Cierra los ojos y ora en voz baja, unos tres minutos.',
      ejemplos: ['ora por el día', 'haz una oración', 'bendice nuestro día'],
      vivo: true,
      donde: 'ambas',
    },
    {
      id: 'chistes',
      grupo: 'voz',
      titulo: 'Chistes y discurso',
      detalle: 'Cinco chistes grabados, quién es y qué puede hacer.',
      ejemplos: ['cuéntame un chiste', '¿quién eres?', '¿qué puedes hacer?'],
      vivo: true,
      donde: 'ambas',
    },
  ];

  const personalidad: Capacidad[] = [
    {
      id: 'emociones',
      grupo: 'personalidad',
      titulo: 'Catorce emociones',
      detalle: EMOCIONES.map((e: Emocion) => EMOCION_INFO[e].etiqueta).join(' · '),
      ejemplos: ['dime algo que te sorprenda', 'ponte serio'],
      vivo: null,
      donde: 'ambas',
    },
    ...MODOS.map(
      (m): Capacidad => ({
        id: `modo-${m.id.toLowerCase()}`,
        grupo: 'personalidad',
        titulo: `Modo ${m.etiqueta}`,
        detalle: m.tono,
        ejemplos: [`modo ${m.etiqueta.toLowerCase()}`],
        vivo: null,
        donde: 'ambas',
      })
    ),
  ];

  const gestos: Capacidad[] = GESTOS_TACTILES.map(
    (g): Capacidad => ({
      id: `gesto-${g.id}`,
      grupo: 'gestos',
      titulo: g.zona,
      detalle: g.hace,
      ejemplos: [],
      vivo: null,
      donde: 'ambas',
    })
  );

  const canales: Capacidad[] = [
    {
      id: 'telegram',
      requiere: 'telegram',
      grupo: 'canales',
      titulo: 'Telegram de la junta',
      detalle: 'Responde en privado a José, Medardo, Carlos y Mayra. Manda fotos, PDF y notas de voz. Avisa urgencias.',
      ejemplos: ['manda esto por Telegram', '/audio en Telegram'],
      vivo: n.telegram && n.telegramIn,
      falta: n.telegram && n.telegramIn ? undefined : 'TELEGRAM_BOT_TOKEN, CHAT_ID o WEBHOOK_SECRET',
      donde: 'ambas',
    },
    {
      id: 'redeploy',
      requiere: 'taller',
      grupo: 'canales',
      titulo: 'Redesplegar la mesa en Render',
      detalle: 'Solo mando (José, Medardo) con sesión.',
      ejemplos: ['redespliega la mesa'],
      vivo: null,
      donde: 'ambas',
    },
  ];

  const memoria: Capacidad[] = [
    {
      id: 'memoria',
      requiere: 'memoria',
      grupo: 'memoria',
      titulo: 'Memoria por miembro',
      detalle:
        perfil.id === 'genesis-miembro'
          ? 'Tu hilo y lo que le pidas recordar se guardan asociados a tu cuenta, en S3 cuando está configurado. Los turnos de otras cuentas no los reciben.'
          : 'Guarda hechos y el hilo de cada persona en S3, separados por cuenta: los turnos de Carlos no reciben lo de José.',
      ejemplos: ['recuerda que la villa va al setenta por ciento', '¿qué sabes de mí?'],
      vivo: n.memoriaS3,
      falta: n.memoriaS3 ? undefined : 'ULTRON_MEMORIA_BUCKET + AWS_*: se pierde al redesplegar',
      donde: 'ambas',
    },
    {
      id: 'cerebro',
      grupo: 'memoria',
      titulo: `Cerebro ${perfil.cerebro}`,
      detalle: perfil.proposito,
      ejemplos:
        perfil.id === 'minas'
          ? ['¿qué es un pórfido?', 'diferencia entre recurso y reserva']
          : perfil.id === 'genesis-miembro'
            ? ['¿qué es ORIGEN?', '¿para qué sirve Veta Wallet?']
            : ['¿qué es ORIGEN?', 'actualiza el cerebro'],
      vivo: true,
      donde: 'ambas',
    },
  ];

  // Solo las herramientas propias de esta plataforma: el catálogo no promete lo que no hay.
  const minas: Capacidad[] = [
    {
      id: 'calculos-mina',
      grupo: 'herramientas',
      titulo: 'Cálculos de minería',
      detalle:
        'Onzas contenidas, recuperables y su valor; ley de corte; relación de descapote; dilución; conversiones entre g/t, ppm, porcentaje y onzas por tonelada corta. Las cuentas las hace la plataforma con la fórmula a la vista, no el modelo de cabeza.',
      ejemplos: ['250.000 toneladas a 3,4 g/t, ¿cuántas onzas?', 'ley de corte con 25 dólares por tonelada y 90% de recuperación', 'strip ratio de 3 millones de estéril y 1 millón de mineral'],
      vivo: true,
      donde: 'ambas',
      requiere: 'calculos-mina',
    },
    {
      id: 'concesiones',
      grupo: 'herramientas',
      titulo: 'Fichas de concesiones y permisos',
      detalle: 'Padrón consultable por voz: expediente, titular, área, tipo, estado ambiental, obligaciones y vencimientos. Avisa de lo que vence pronto y de lo que se contradice. Datos de demostración.',
      ejemplos: ['¿cómo va Cerro Partido?', '¿qué concesiones vencen pronto?', '¿qué concesiones hay?'],
      vivo: true,
      donde: 'ambas',
      requiere: 'concesiones',
    },
  ];

  const tiene = new Set(perfil.herramientas);
  return [...her, ...minas, ...voz, ...personalidad, ...gestos, ...canales, ...memoria].filter((c) => !c.requiere || tiene.has(c.requiere));
}

export const GRUPOS: Record<GrupoCapacidad, string> = {
  herramientas: 'Herramientas',
  voz: 'Voz y oído',
  personalidad: 'Personalidad',
  gestos: 'Gestos y tacto',
  canales: 'Canales',
  memoria: 'Memoria',
};
