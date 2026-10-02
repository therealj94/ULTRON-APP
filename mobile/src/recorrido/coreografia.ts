/**
 * LA COREOGRAFÍA: qué hace el avatar que habla, qué suena y qué vibra en cada paso de cada escena.
 *
 * José (2-oct): «que el avatar haga efectos y que muestre bien cada cosa que puede hacer, cinemático».
 * Así que el que habla no solo habla: saca la cámara y tira el flash, saca el teléfono que suena, se le
 * llena la cabeza de ideas, le salen burbujas de chat, sobres que vuelan, un avión de papel que se va
 * con el mensaje, confeti al final. Y en el recordatorio Claudio mismo se achica y vuela a la franja
 * de arriba de los chats: así se ve dónde se queda.
 *
 * Sin React Native: lo prueba Node (pruebas/recorrido.prueba.mjs).
 */
import type { DemoId } from './guion';

export const EFECTOS = ['ondas', 'camara', 'flash', 'escaneo', 'telefono', 'reloj', 'check', 'burbujas', 'lapiz', 'avion', 'sobres', 'engrane', 'lupa', 'globo', 'nube', 'cerebro', 'chispas', 'confeti'] as const;
export type EfectoId = (typeof EFECTOS)[number];

/** Los sonidos del recorrido (assets/sfx, assets/llamada y assets/recorrido). */
export const SONIDOS = ['whoosh', 'tap', 'obturador', 'timbre', 'chispa', 'capitulo', 'teclado', 'lapiz', 'papel'] as const;
export type SonidoId = (typeof SONIDOS)[number];

export type Vibracion = 'suave' | 'medio' | 'fuerte' | 'exito' | 'aviso';

export type Momento = { efecto: EfectoId | null; sonido?: SonidoId; vibra?: Vibracion };

export const COREOGRAFIA: Record<DemoId, Record<string, Momento>> = {
  portada: {
    entra: { efecto: 'chispas' },
    antonio: { efecto: 'chispas', sonido: 'tap' },
    iconos: { efecto: 'confeti', sonido: 'chispa' },
  },
  mesa: {
    barra: { efecto: 'chispas', sonido: 'tap' },
    hablar: { efecto: 'ondas' },
    chat: { efecto: 'burbujas', sonido: 'tap' },
    mas: { efecto: null, sonido: 'tap' },
    hoja: { efecto: 'chispas', sonido: 'whoosh', vibra: 'suave' },
  },
  hablar: {
    mic: { efecto: 'ondas' },
    pregunta: { efecto: 'ondas', sonido: 'teclado' },
    respuesta: { efecto: 'ondas' },
    interrumpe: { efecto: 'burbujas', sonido: 'tap', vibra: 'suave' },
  },
  camara: {
    abre: { efecto: 'camara', sonido: 'whoosh' },
    flash: { efecto: 'flash', sonido: 'obturador', vibra: 'fuerte' },
    analiza: { efecto: 'escaneo' },
    resultado: { efecto: 'chispas', sonido: 'chispa', vibra: 'exito' },
  },
  llamada: {
    suena: { efecto: 'telefono', sonido: 'timbre', vibra: 'aviso' },
    encurso: { efecto: 'ondas', sonido: 'tap', vibra: 'suave' },
    cuelga: { efecto: null, sonido: 'tap' },
  },
  recordatorio: {
    pide: { efecto: 'reloj', sonido: 'teclado' },
    confirma: { efecto: 'check', sonido: 'chispa', vibra: 'exito' },
    achica: { efecto: null, sonido: 'whoosh', vibra: 'suave' },
    suena: { efecto: 'telefono', sonido: 'timbre', vibra: 'aviso' },
  },
  avisos: {
    llega: { efecto: 'telefono', sonido: 'timbre', vibra: 'aviso' },
    responde: { efecto: 'check', sonido: 'chispa', vibra: 'exito' },
    permiso: { efecto: 'engrane', sonido: 'tap' },
  },
  chat: {
    lee: { efecto: 'burbujas' },
    borrador: { efecto: 'lapiz', sonido: 'lapiz' },
    enviado: { efecto: 'avion', sonido: 'whoosh', vibra: 'exito' },
  },
  whatsapp: {
    pestanas: { efecto: 'burbujas', sonido: 'tap' },
    vincular: { efecto: 'lapiz', sonido: 'teclado' },
    codigo: { efecto: 'engrane', sonido: 'teclado' },
    listo: { efecto: 'check', sonido: 'chispa', vibra: 'exito' },
  },
  correo: {
    bandeja: { efecto: 'sobres', sonido: 'papel' },
    lee: { efecto: 'sobres' },
    responde: { efecto: 'avion', sonido: 'whoosh', vibra: 'exito' },
    conectar: { efecto: 'engrane', sonido: 'tap' },
  },
  internet: {
    busca: { efecto: 'lupa', sonido: 'teclado' },
    resultado: { efecto: 'globo', sonido: 'chispa' },
  },
  computadora: {
    abre: { efecto: 'nube', sonido: 'whoosh' },
    cursor: { efecto: 'nube', sonido: 'teclado' },
    listo: { efecto: 'chispas', sonido: 'chispa', vibra: 'exito' },
  },
  memoria: {
    guarda: { efecto: 'cerebro', sonido: 'chispa' },
    recuerda: { efecto: 'cerebro' },
  },
  conocer: {
    sabe: { efecto: 'cerebro', sonido: 'chispa' },
    circulo: { efecto: 'chispas', sonido: 'tap' },
    misiones: { efecto: 'check', sonido: 'chispa' },
  },
  propuestas: {
    tarjeta: { efecto: 'chispas', sonido: 'whoosh' },
    responde: { efecto: 'check', sonido: 'chispa', vibra: 'exito' },
    nivel: { efecto: 'engrane', sonido: 'tap' },
  },
  avatares: {
    ojos: { efecto: 'chispas', sonido: 'tap' },
    aura: { efecto: 'chispas', sonido: 'tap' },
    claudio: { efecto: 'chispas', sonido: 'tap' },
    antonio: { efecto: 'chispas', sonido: 'tap' },
  },
  ajustes: {
    abre: { efecto: 'engrane', sonido: 'whoosh' },
    perfil: { efecto: 'chispas', sonido: 'tap' },
    aura: { efecto: 'cerebro', sonido: 'tap' },
    privacidad: { efecto: 'engrane', sonido: 'tap' },
    pide: { efecto: 'burbujas', sonido: 'chispa' },
  },
  final: {
    fin: { efecto: 'confeti', sonido: 'chispa', vibra: 'exito' },
    opciones: { efecto: 'confeti' },
  },
};

export function momentoDe(escena: DemoId, paso: string): Momento {
  return COREOGRAFIA[escena]?.[paso] ?? { efecto: null };
}

/**
 * ¿Quién está chiquito en la franja de los chats? Claudio, desde que lo dice («yo me hago chiquito y
 * me quedo aquí arriba») hasta que termina el recordatorio; mientras, ANT-ONIO sigue al frente.
 */
export function achicadoEn(escena: DemoId, paso: string): 'claudio' | null {
  return escena === 'recordatorio' && (paso === 'achica' || paso === 'suena') ? 'claudio' : null;
}
