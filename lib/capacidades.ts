/**
 * Catálogo de capacidades — la única lista de "qué puede hacer AU-RA".
 * La sirve GET /api/capacidades y la pintan Ajustes (web) y el menú (APK).
 * Cada tarjeta corresponde a algo que de verdad ejecuta el servidor o la app.
 * `vivo` sale de la salud real; nunca se marca vivo lo que no respondió.
 */

import { EMOCIONES, EMOCION_INFO, type Emocion } from './emocion';
import { perfilActivo, type Herramienta } from './perfiles';

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
  qwen: boolean;
  ojo: boolean;
  /** Voicebox configurado y contestando (voz y oído en el servidor propio de AU-RA). */
  voz: boolean;
  memoriaS3: boolean;
  telegram: boolean;
  telegramIn: boolean;
  ejecutor: boolean;
  vision: boolean;
  oido: boolean;
};

export const MODOS = [
  { id: 'GUARDIAN', etiqueta: 'Guardián', tono: 'firme, protege a la junta' },
  { id: 'EXPLORER', etiqueta: 'Explorador', tono: 'curioso, pregunta más' },
  { id: 'GOLD', etiqueta: 'Oro', tono: 'cálido, habla de metal y bóveda' },
  { id: 'MINING', etiqueta: 'Minería', tono: 'seco, operativo' },
  { id: 'ANALYTICAL', etiqueta: 'Analítico', tono: 'preciso, cifras y fuentes' },
  { id: 'STRATEGIC', etiqueta: 'Estratégico', tono: 'bajo, piensa a largo' },
  { id: 'CREATIVE', etiqueta: 'Creativo', tono: 'juguetón, propone' },
] as const;

export const VOZ_OFICIAL = {
  id: 'ultron',
  nombre: 'AU-RA',
  motor: 'Voicebox · Kokoro, en el servidor propio de AU-RA',
  timbre: 'Dora · español, cálida, cercana',
  respaldo: 'ninguno: si Voicebox no contesta, AU-RA calla y el texto queda en pantalla',
  expresividad: ['pausa de pensar', 'muletillas', 'canciones grabadas'],
};

export const CANCIONES = [
  { id: 'jesus', titulo: 'Quiero conocer a Jesús', artista: 'Generación 12', pedir: 'canta quiero conocer a Jesús' },
  { id: 'waymaker', titulo: 'Way Maker', artista: 'Sinach', pedir: 'canta way maker' },
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

export function catalogoCapacidades(n: EstadoNodos): Capacidad[] {
  const her: Capacidad[] = [
    {
      id: 'chat',
      grupo: 'herramientas',
      titulo: 'Conversar y razonar',
      detalle: 'Cerebro Qwen 3.8 27B en nodo propio. Piensa antes de hablar, recuerda el hilo y no inventa.',
      ejemplos: ['¿qué opinás de abrir sociedad en Próspera?', 'resumime lo de ayer'],
      vivo: n.qwen,
      falta: n.qwen ? undefined : 'nodo Qwen no responde',
      donde: 'ambas',
    },
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
      ejemplos: ['abrí https://www.bch.hn y decime el tipo de cambio', 'captura de ordenglobal.org'],
      vivo: n.ojo,
      falta: n.ojo ? undefined : 'nodo ojo no responde',
      donde: 'ambas',
    },
    {
      id: 'vision',
      grupo: 'herramientas',
      titulo: 'Ver por la cámara',
      detalle: 'Mira el frame actual o una foto y describe lo que hay, con números y texto.',
      ejemplos: ['¿qué ves?', 'leé esta etiqueta'],
      vivo: n.vision,
      falta: n.vision ? undefined : 'ojo o Gemini sin clave',
      donde: 'ambas',
    },
    {
      id: 'pdf',
      grupo: 'herramientas',
      titulo: 'Leer y generar PDF',
      detalle: 'Lee PDFs subidos (texto e imágenes) y genera PDFs cortos.',
      ejemplos: ['leé este PDF', 'hacé un PDF con el resumen'],
      vivo: true,
      donde: 'ambas',
    },
    {
      id: 'sistema',
      requiere: 'taller',
      grupo: 'herramientas',
      titulo: 'Estado de los nodos',
      detalle: 'Sondea Qwen, ojo, voz y memoria. Avisa por Telegram si algo cae.',
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
      ejemplos: ['ejecuta este código', 'corré el script'],
      vivo: n.ejecutor,
      falta: n.ejecutor ? undefined : 'ejecutor apagado o sin sandbox',
      donde: 'ambas',
    },
    {
      id: 'tareas',
      grupo: 'herramientas',
      titulo: 'Pendientes de la junta',
      detalle: 'Anota y lista pendientes.',
      ejemplos: ['anotá que mañana hay junta', '¿qué pendientes tengo?'],
      vivo: true,
      donde: 'ambas',
    },
  ];

  const voz: Capacidad[] = [
    {
      id: 'voz',
      grupo: 'voz',
      titulo: `Voz ${VOZ_OFICIAL.nombre} · ${VOZ_OFICIAL.timbre}`,
      detalle: `${VOZ_OFICIAL.motor}. Hace pausas de pensar y dice sus muletillas; los clips y las canciones están grabados.`,
      ejemplos: ['decime algo con cariño', 'contame un chiste'],
      vivo: n.voz,
      falta: n.voz ? undefined : 'VOICEBOX_URL + VOICEBOX_CLAVE',
      donde: 'ambas',
    },
    {
      id: 'oido',
      grupo: 'voz',
      titulo: 'Oír y transcribir',
      detalle: 'Escucha continua; podés interrumpirlo hablando. Notas de voz por Telegram también. Transcribe con Whisper en el servidor propio de AU-RA (Voicebox); Gemini de reserva.',
      ejemplos: ['(hablá cuando la luz esté cian)'],
      vivo: n.oido,
      falta: n.oido ? undefined : 'VOICEBOX_URL + VOICEBOX_CLAVE o GEMINI_API_KEY',
      donde: 'ambas',
    },
    {
      id: 'canto',
      requiere: 'canto',
      grupo: 'voz',
      titulo: 'Cantar',
      detalle: `Canta a capela las canciones grabadas: ${CANCIONES.map((c) => c.titulo).join(', ')}. Una letra nueva la dice, no la canta.`,
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
      ejemplos: ['orá por el día', 'hacé una oración', 'bendice nuestro día'],
      vivo: true,
      donde: 'ambas',
    },
    {
      id: 'chistes',
      grupo: 'voz',
      titulo: 'Chistes y discurso',
      detalle: 'Cinco chistes grabados, quién es y qué puede hacer.',
      ejemplos: ['contame un chiste', '¿quién sos?', '¿qué podés hacer?'],
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
      ejemplos: ['decime algo que te sorprenda', 'ponete serio'],
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
      ejemplos: ['mandá esto por telegram', '/audio en Telegram'],
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
      ejemplos: ['redesplegá la mesa'],
      vivo: null,
      donde: 'ambas',
    },
  ];

  const memoria: Capacidad[] = [
    {
      id: 'memoria',
      grupo: 'memoria',
      titulo: 'Memoria por miembro',
      detalle: 'Guarda hechos y el hilo de cada persona en S3. Lo de José no lo ve Carlos.',
      ejemplos: ['recordá que la villa va al setenta por ciento', '¿qué sabés de mí?'],
      vivo: n.memoriaS3,
      falta: n.memoriaS3 ? undefined : 'ULTRON_MEMORIA_BUCKET + AWS_*: se pierde al redesplegar',
      donde: 'ambas',
    },
    {
      id: 'cerebro',
      grupo: 'memoria',
      titulo: `Cerebro ${perfilActivo().cerebro}`,
      detalle: perfilActivo().proposito,
      ejemplos: perfilActivo().id === 'minas' ? ['¿qué es un pórfido?', 'diferencia entre recurso y reserva'] : ['¿qué es ORIGEN?', 'actualiza el cerebro'],
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

  const tiene = new Set(perfilActivo().herramientas);
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
