/**
 * LA COREOGRAFÍA: lo que pasa con cada paso del guion además de la animación del escritorio.
 *
 *  · efecto: lo que le sale al anfitrión que habla (teclas que flotan, notas, un sol, un teléfono que
 *    timbra…): el avatar HACE lo que cuenta (José: «que el avatar haga efectos y que muestre bien cada
 *    cosa que puede hacer, cinemático todo»);
 *  · sonido: el efecto que suena (sonidos.ts);
 *  · golpe: un acercamiento de cámara al lugar del escritorio donde pasa lo importante;
 *  · vuela: el anfitrión se hace chiquito y vuela al notch (y se queda ahí hasta `vuelve`).
 *
 * Sin DOM: lo prueba Node (test/recorrido.test.mjs: cada paso del guion tiene su momento).
 */
import type { Anfitrion, DemoId } from './guion';

export const EFECTOS = ['chispas', 'ventanas', 'ondas', 'teclas', 'microfono', 'lapiz', 'sol', 'luna', 'campana', 'notas', 'sobres', 'calendario', 'reloj', 'telefono', 'avion', 'monedas', 'escudo', 'confeti'] as const;
export type EfectoId = (typeof EFECTOS)[number];

export const SONIDOS = ['whoosh', 'tap', 'timbre', 'chispa', 'capitulo', 'teclado', 'papel'] as const;
export type SonidoId = (typeof SONIDOS)[number];

/** Dónde se acerca la cámara: el notch (arriba al centro), la ventana del centro o la barra de tareas. */
export type Golpe = 'notch' | 'ventana' | 'barra';

export type Momento = { efecto?: EfectoId; sonido?: SonidoId; golpe?: Golpe; vuela?: Anfitrion; vuelve?: boolean };

export const COREOGRAFIA: Record<DemoId, Record<string, Momento>> = {
  portada: {
    entra: { efecto: 'chispas', sonido: 'whoosh' },
    escritorio: { efecto: 'ventanas', sonido: 'whoosh', golpe: 'notch' },
  },
  notch: {
    reposo: { sonido: 'whoosh', golpe: 'notch', vuela: 'claudio' },
    escucha: { efecto: 'ondas', golpe: 'notch' },
    habla: { efecto: 'chispas' },
    aparta: { efecto: 'ventanas', sonido: 'whoosh', vuelve: true },
  },
  voz: {
    atajo: { efecto: 'teclas', sonido: 'tap', golpe: 'ventana' },
    oye: { efecto: 'ondas', sonido: 'chispa', golpe: 'notch' },
    interrumpe: { efecto: 'microfono' },
  },
  escribir: {
    bloc: { efecto: 'ventanas', sonido: 'whoosh' },
    escribe: { efecto: 'lapiz', golpe: 'ventana' },
    largo: { sonido: 'chispa', golpe: 'notch' },
    listo: { efecto: 'escudo', golpe: 'ventana' },
  },
  control: {
    izquierda: { efecto: 'ventanas', sonido: 'whoosh' },
    brillo: { efecto: 'sol', sonido: 'chispa' },
    oscuro: { efecto: 'luna', sonido: 'whoosh' },
    atajos: { efecto: 'teclas', sonido: 'tap' },
  },
  avisos: {
    llegan: { efecto: 'campana', sonido: 'chispa', golpe: 'notch' },
    lee: { efecto: 'ondas' },
    silencia: { efecto: 'escudo', sonido: 'tap' },
  },
  musica: {
    suena: { efecto: 'notas', golpe: 'notch' },
    pide: { efecto: 'notas', sonido: 'chispa' },
  },
  dia: {
    correo: { efecto: 'sobres', sonido: 'papel', golpe: 'notch' },
    agenda: { efecto: 'calendario', sonido: 'chispa' },
    recordatorio: { efecto: 'reloj', sonido: 'chispa', golpe: 'notch' },
  },
  pulse: {
    llama: { efecto: 'telefono', sonido: 'timbre', golpe: 'notch' },
    contesta: { efecto: 'ondas', sonido: 'tap' },
    mensaje: { efecto: 'avion', sonido: 'whoosh' },
  },
  centro: {
    abre: { efecto: 'ventanas', sonido: 'whoosh', golpe: 'ventana' },
    secciones: { efecto: 'chispas' },
    cartera: { efecto: 'monedas', sonido: 'chispa' },
  },
  privacidad: {
    mic: { efecto: 'microfono', sonido: 'tap', golpe: 'notch' },
    pausa: { efecto: 'teclas', sonido: 'tap' },
    candado: { efecto: 'escudo', sonido: 'chispa' },
  },
  final: {
    fin: { efecto: 'confeti', sonido: 'chispa' },
    opciones: { efecto: 'chispas', sonido: 'whoosh', vuela: 'claudio' },
  },
};

export function momentoDe(escena: DemoId, paso: string): Momento {
  return COREOGRAFIA[escena]?.[paso] ?? {};
}

/**
 * Quién está en el notch con la escena en el paso `paso` (null: nadie). Se cuenta desde el principio de
 * la escena: el último `vuela` sin un `vuelve` después. Al saltar a mitad de escena (atrás, ir), el
 * anfitrión aparece donde le toca.
 */
export function enNotch(escena: DemoId, pasos: readonly string[], paso: string): Anfitrion | null {
  let quien: Anfitrion | null = null;
  for (const p of pasos) {
    const m = momentoDe(escena, p);
    if (m.vuela) quien = m.vuela;
    if (m.vuelve) quien = null;
    if (p === paso) break;
  }
  return quien;
}
