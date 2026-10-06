/**
 * LA VISTA DEL TURNO SIN TRABAR LA VOZ (José, 6-oct, Samsung SM-S942B con la 5.5.0: «la cámara toma como una foto de
 * primera y se traba, queda pensando y hasta tocar la pantalla se cierra; tarda en saber qué hay en la cámara»).
 *
 * Lo que pasaba: «¿qué ves?» sacaba una foto, abría «Lo que vi» con ESA foto quieta y un «mirando…», y esperaba al
 * servidor (/api/vision/analyze, hasta 35 s) ANTES de mandar el turno. El ojo del servidor fallaba siempre (503), así
 * que la foto se quedaba congelada hasta que se tocaba la tarjeta (que se cierra al tocarla) o llegaba el «no me entra
 * la imagen»; y cada frase dicha mientras tanto esperaba en la cola. La traza del turno lo midió: `esc 28828` (el turno
 * se armó 28,8 s después de la frase).
 *
 * Ahora el turno NUNCA espera a la visión más de `VISTA_TURNO.esperaMs` (1,5 s):
 *
 *  · si la subida continua de la cámara (components/CamaraVivo.tsx → `vistaFresca`) ya vio la escena hace poco, de
 *    la misma cámara y con la misma gente, «¿qué ves?» la usa AL INSTANTE (sin foto ni servidor);
 *  · si no, una foto (como mucho `fotoMs`) y el servidor la mira; si contesta dentro de `esperaMs`, el turno lleva lo
 *    visto como texto (la foto no viaja dos veces);
 *  · si no contesta a tiempo, el turno sale YA con la foto (el servidor la mira dentro del turno mientras suena el
 *    relleno, lib/presupuesto.ts PRESUPUESTO_VISION_TURNO_MS) y lo que vuelva del primer pedido se aplica DESPUÉS
 *    (`tarde`): «Lo que vi» se completa y queda como vista fresca para la próxima pregunta.
 *
 * Puro (sin React Native): lo prueban tests/vista-turno.test.ts y pruebas/mesa/mesa.prueba.mjs.
 */
import { alCambiarCuenta } from './generacionCuenta';
import { resumenVista, type FocoVision, type VistaCamara } from './vistaCamara';

export const VISTA_TURNO = {
  /** Lo más que el turno espera a lo que diga el servidor, con la foto ya en la mano. */
  esperaMs: 1500,
  /** Lo más que se espera la foto (la cámara ya prendida: CameraX tarda 0,2-1 s). */
  fotoMs: 1500,
  /** Una vista de la subida continua vale para «¿qué ves?» si tiene menos que esto (y es de la misma cámara). */
  frescaMs: 20_000,
};

/** Lo que devolvió el servidor de una foto (mobile/src/lib/api.ts verCamara). */
export type RespuestaDeVista = { vista: VistaCamara | null; visto: string; etiquetas: string[]; estructurada: boolean };

export type VistaGuardada = {
  vista: VistaCamara;
  /** El hecho para el cerebro (el `summary` del servidor, o el resumen local si no vino). */
  visto: string;
  /** Hora de CAPTURA de la foto. */
  ts: number;
  lado: string;
  /** Cuántas personas veía ML Kit al sacarla: si cambió, la escena ya es otra. */
  personas: number;
  /** La foto (base64) para «Lo que vi», si se guardó. */
  foto?: string;
};

/** La última vista buena de la cámara (una sola, en memoria: nada en disco). */
export class VistaFresca {
  private ultima: VistaGuardada | null = null;

  guardar(v: VistaGuardada) {
    if (!v.vista || !(v.ts > 0)) return;
    if (this.ultima && this.ultima.ts > v.ts) return;
    this.ultima = { ...v, visto: v.visto || resumenVista(v.vista) };
  }

  /** Otra cámara, cámara apagada o salir de la mesa: lo visto ya no vale. */
  invalidar() {
    this.ultima = null;
  }

  /** La vista si sigue valiendo AHORA para esta cámara (y con la misma gente, si se sabe). */
  fresca(o: { ahora: number; lado: string; personas?: number; maxMs?: number }): VistaGuardada | null {
    const v = this.ultima;
    if (!v || v.lado !== o.lado) return null;
    const edad = o.ahora - v.ts;
    if (edad < -2000 || edad > (o.maxMs ?? VISTA_TURNO.frescaMs)) return null;
    if (typeof o.personas === 'number' && o.personas !== v.personas) return null;
    return v;
  }

  /** La última, sin mirar la edad (para «la última vista válida reciente» con un tope que decide quien pregunta). */
  ultimaVista(): VistaGuardada | null {
    return this.ultima;
  }
}

/** La de la app (una sola; la llenan CamaraVivo y CamaraVision, la lee la mesa). */
export const vistaFresca = new VistaFresca();
// La foto y lo visto son de quien estaba dentro: al salir o entrar otra persona no se le contesta «¿qué ves?» con la
// escena (y la foto) de la anterior (revisión del 6-oct). La mesa, además, la suelta al desmontarse (DeskScreen).
alCambiarCuenta(() => vistaFresca.invalidar());

/** Lo que había al sacar la foto (la cámara y la gente): con eso se guarda lo que el servidor diga después. */
export type AlSacar = { lado: string; personas: number };

export type IoVistaTurno = {
  ahora: () => number;
  /** La foto en base64 (o null). */
  foto: () => Promise<string | null>;
  /** La cámara y la gente de ESTE momento: se mira al pedir la foto (ver `alSacar`). */
  escena?: () => AlSacar;
  ver: (b64: string, foco: FocoVision) => Promise<RespuestaDeVista | null>;
};

export type VistaTurno =
  /** La de la subida continua: al instante. */
  | { tipo: 'fresca'; visto: string; vista: VistaCamara; foto?: string; edadMs: number }
  /** El servidor contestó dentro de la espera. `alSacar`: la cámara y la gente de cuando se sacó la foto. */
  | { tipo: 'vista'; visto: string; vista: VistaCamara; foto: string; esperaMs: number; alSacar: AlSacar }
  /** El servidor contestó a tiempo pero sin el modo estructurado (servidor anterior): la foto va en el turno. */
  | { tipo: 'foto'; foto: string; esperaMs: number; tarde: Promise<RespuestaDeVista | null>; motivo: 'tarde' | 'sin_vista'; alSacar: AlSacar }
  /** No hubo foto a tiempo. */
  | { tipo: 'sin_foto'; esperaMs: number };

const TARDE = Symbol('tarde');
function conTope<T>(p: Promise<T>, ms: number): Promise<T | typeof TARDE> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const corte = new Promise<typeof TARDE>((r) => {
    t = setTimeout(() => r(TARDE), Math.max(0, ms));
  });
  return Promise.race([p, corte]).finally(() => {
    if (t) clearTimeout(t);
  });
}

/**
 * Lo que lleva el turno de «¿qué ves?» / «léeme esto». Nunca tarda más que `fotoMs + esperaMs` (sin fresca).
 * `fresca`: la del foco «escena» se usa tal cual; leer, precio o «qué es esto» piden una foto nueva (lo que se
 * acerca a la cámara no estaba en la de hace un rato).
 */
export async function vistaParaTurno(
  io: IoVistaTurno,
  foco: FocoVision,
  o: { lado: string; personas?: number; guardadas?: VistaFresca; esperaMs?: number; fotoMs?: number }
): Promise<VistaTurno> {
  const t0 = io.ahora();
  const guardadas = o.guardadas ?? vistaFresca;
  if (foco === 'escena') {
    const f = guardadas.fresca({ ahora: t0, lado: o.lado, personas: o.personas });
    if (f) return { tipo: 'fresca', visto: f.visto, vista: f.vista, foto: f.foto, edadMs: Math.max(0, t0 - f.ts) };
  }
  // La cámara y la gente AL SACAR la foto: lo que el servidor diga (quizá segundos después, con `tarde`) se guarda con
  // esto, no con lo del momento de la respuesta (revisión del 6-oct: si entretanto se cambió de cámara o llegó
  // alguien, la vista fresca quedaba con el lado o la gente equivocados).
  const alSacar: AlSacar = io.escena ? io.escena() : { lado: o.lado, personas: o.personas ?? 0 };
  const foto = await conTope(
    io.foto().catch(() => null),
    o.fotoMs ?? VISTA_TURNO.fotoMs
  );
  if (foto === TARDE || !foto) return { tipo: 'sin_foto', esperaMs: io.ahora() - t0 };
  // El pedido sale ya; si tarda, sigue solo y lo que vuelva se aplica después (`tarde`).
  const pedido = io.ver(foto, foco).catch(() => null);
  const r = await conTope(pedido, o.esperaMs ?? VISTA_TURNO.esperaMs);
  const espera = io.ahora() - t0;
  if (r !== TARDE && r?.vista && r.estructurada && r.visto) return { tipo: 'vista', visto: r.visto, vista: r.vista, foto, esperaMs: espera, alSacar };
  return { tipo: 'foto', foto, esperaMs: espera, tarde: pedido, motivo: r === TARDE ? 'tarde' : 'sin_vista', alSacar };
}
