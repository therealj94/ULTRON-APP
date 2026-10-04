/**
 * UNA SESIÓN DE VOZ DE ELEVENLABS, DE PRINCIPIO A FIN (AUR10): lo que antes vivía dentro del efecto de
 * components/ModoConversacion.tsx, sacado aquí sin React ni el SDK adentro (los recibe), para poder probar
 * con dobles que colgar en cualquier fase no deja nada vivo y que lo que llega tarde no revive nada.
 *
 *   abrirSesionVoz(deps) → cerrar()
 *
 *  · pide el permiso; si llega cuando ya se colgó, no abre nada (ni toma el audio);
 *  · abre la sesión del SDK (una conexión, sus pistas y sus oyentes) y el reloj de la boca (33 ms);
 *  · TODO lo que avisa lleva su generación, y después de `cerrar()` nada de esta sesión llega a la UI, al
 *    estado, al audio ni a los niveles: ni un mensaje, ni un «habla», ni una interrupción, ni un
 *    `onConnect` tardío (ese además se cuelga: una sesión que conecta después de colgar no queda abierta);
 *  · `cerrar()` para el reloj, pide el fin al SDK, avisa que el audio se está soltando y al servidor (una
 *    vez). El audio se da por suelto cuando el SDK desconecta (onDisconnect), aunque ya no esté montada:
 *    es lo que espera una llamada de PULSE2CHAT para arrancar el suyo.
 *
 * Con `recursos` (compa/recursos.ts) anota lo suyo (el reloj y la conexión) y lo suelta: las pruebas
 * comprueban que vuelve a cero junto con los contadores del SDK de mentira.
 */
import type { EstadoVoz } from './sesion';
import type { ContadorRecursos } from './recursos';

/** Lo que se le pasa al SDK al abrir (lo poco que se usa de `startSession`). */
export type OpcionesConv = {
  conversationToken: string;
  connectionType: 'webrtc';
  dynamicVariables: Record<string, string>;
  onConnect?: () => void;
  onModeChange?: (m: { mode: string }) => void;
  onMessage?: (m: { message?: string; source?: string }) => void;
  onInterruption?: () => void;
  onAudioAlignment?: (al: any) => void;
  onError?: (mensaje: any) => void;
  onDisconnect?: () => void;
};

/** Lo poco del `useConversation()` del SDK que usa una sesión. */
export type ConvMin = {
  startSession: (o: OpcionesConv) => unknown;
  endSession: () => unknown;
  setVolume: (o: { volume: number }) => void;
  getOutputVolume: () => number;
  getInputVolume: () => number;
  getOutputByteFrequencyData: () => any;
};

export type CallbacksSesionVoz = {
  onEstado: (gen: number, e: EstadoVoz, detalle?: string) => void;
  onMensaje: (gen: number, rol: 'usuario' | 'ultron', texto: string) => void;
  onInterrupcion: (gen: number) => void;
  /** Los niveles, con su generación (4º): lo de una sesión vieja no cuenta (AUR10). */
  onNiveles: (salida: number, entrada: number, cruda?: number, gen?: number) => void;
  onAudio?: (gen: number, que: 'toma' | 'suelta' | 'cerrando') => void;
  onFin?: (gen: number, pase: string) => void;
  onPermiso?: (gen: number) => void;
};

export type DepsSesionVoz = {
  gen: number;
  /** El SDK (el de ahora: la referencia que se actualiza con cada render). */
  conv: () => ConvMin;
  permiso: () => Promise<{ token: string; pase: string; cid?: string }>;
  /** Los callbacks de ahora (cambian con cada render; se leen al avisar). */
  cbs: () => CallbacksSesionVoz;
  silenciada: () => boolean;
  /** Compartidas con el componente (los controles de enviar texto miran `abierta`). */
  abierta: { current: boolean };
  hablando: { current: boolean };
  /** Cuándo llegó lo último que oyó de la persona (para la miga de cuánto tardó en hablar). */
  oidoEn?: { current: number };
  reloj: () => number;
  intervalo: (f: () => void, ms: number) => unknown;
  limpiarIntervalo: (id: unknown) => void;
  /** La boca: abre rápido y cierra suave (avatar3d/sincronia.ts, Envolvente). */
  boca: { seguir: (salida: number, dt: number) => number; cortar: () => void };
  envolventeLibre: (modo: 'speak', gen: number) => (ms: number) => number;
  senal: { quiereForma: () => boolean; espectro: (d: any) => void; alineacion: (al: any) => void };
  miga: (t: string) => void;
  pasoMs: number;
  /** Sin volumen real de la salida más de esto mientras habla, la boca sigue una envolvente de habla. */
  sinVolumenMs?: number;
  recursos?: ContadorRecursos;
};

export function abrirSesionVoz(d: DepsSesionVoz): () => void {
  const { gen } = d;
  let vivo = true;
  let nivel: unknown = null;
  let soltarReloj: (() => void) | null = null;
  let soltarConexion: (() => void) | null = null;
  const avisar = (e: EstadoVoz, detalle?: string) => vivo && d.cbs().onEstado(gen, e, detalle);
  // El audio y el fin se avisan AUNQUE esta generación ya no esté montada: el cierre de verdad
  // (onDisconnect) llega después de desmontarse, y es justo lo que espera una llamada.
  let audio: 'sin' | 'tomado' | 'suelto' = 'sin';
  let pase = '';
  /** El servidor se entera una sola vez, a lo primero: se desconectó o se pidió cerrar. */
  const fin = () => {
    if (pase) d.cbs().onFin?.(gen, pase);
    pase = '';
  };
  const soltarAudio = () => {
    fin();
    if (audio !== 'tomado') return;
    audio = 'suelto';
    d.cbs().onAudio?.(gen, 'suelta');
  };
  const pedirFin = () => {
    try {
      d.conv().endSession();
    } catch {
      /* ya cerrada */
    }
    soltarConexion?.();
    soltarConexion = null;
  };
  const pararReloj = () => {
    if (nivel !== null) d.limpiarIntervalo(nivel);
    nivel = null;
    soltarReloj?.();
    soltarReloj = null;
  };

  void (async () => {
    avisar('conectando');
    try {
      const r = await d.permiso();
      if (!vivo) return;
      d.cbs().onPermiso?.(gen);
      audio = 'tomado';
      pase = r.pase;
      d.cbs().onAudio?.(gen, 'toma');
      soltarConexion = d.recursos?.tomar('conexion', `voz gen ${gen}`) || (() => undefined);
      d.conv().startSession({
        conversationToken: r.token,
        connectionType: 'webrtc',
        dynamicVariables: { pase: r.pase },
        onConnect: () => {
          // Conectó cuando ya se había colgado: no queda abierta al lado (ni micrófono ni minutos).
          if (!vivo) return pedirFin();
          d.abierta.current = true;
          if (d.silenciada()) {
            try {
              d.conv().setVolume({ volume: 0 });
            } catch {
              /* se reintenta con el próximo cambio */
            }
          }
          d.miga(`conversación fluida: conectada (gen ${gen})`);
          avisar('escuchando');
        },
        onModeChange: ({ mode }) => {
          if (!vivo) return;
          // Para diagnosticar una llamada que «no contesta» (1-oct): cuánto tardó en hablar desde que
          // ElevenLabs entregó lo que oyó. Sin esto no se distingue si falló el oído, el cerebro o el audio.
          if (mode === 'speaking' && !d.hablando.current) d.miga(`voz: habla${d.oidoEn?.current ? ` a los ${d.reloj() - d.oidoEn.current} ms de oírte` : ''}`);
          d.hablando.current = mode === 'speaking';
          // Terminó de hablar: la boca se cierra ya, no con la caída.
          if (!d.hablando.current) d.boca.cortar();
          avisar(mode === 'speaking' ? 'hablando' : 'escuchando');
        },
        onMessage: (m) => {
          if (!vivo) return;
          const texto = String(m?.message || '').trim();
          if (texto && m.source === 'user') {
            if (d.oidoEn) d.oidoEn.current = d.reloj();
            d.miga(`voz: te oyó (${texto.split(/\s+/).length} palabras)`);
          }
          if (texto) d.cbs().onMensaje(gen, m.source === 'user' ? 'usuario' : 'ultron', texto);
        },
        onInterruption: () => {
          if (!vivo) return;
          d.miga('voz: la interrumpiste');
          d.boca.cortar();
          d.cbs().onInterrupcion(gen);
        },
        onAudioAlignment: (al) => {
          if (vivo) d.senal.alineacion(al);
        },
        onError: (mensaje) => {
          d.miga(`conversación fluida: error ${String(mensaje).slice(0, 80)}`);
          // Sin haber conectado, el error es que no abrió: el SDK ya soltó el audio antes de avisar.
          if (!d.abierta.current) soltarAudio();
          avisar('error', String(mensaje));
        },
        onDisconnect: () => {
          d.abierta.current = false;
          d.hablando.current = false;
          soltarConexion?.();
          soltarConexion = null;
          soltarAudio();
          avisar('cerrada');
        },
      });
      if (!vivo) return;
      // La boca sigue el volumen real de la voz del avatar (cada cuadro); si el teléfono no lo da, una
      // envolvente de habla mientras el agente habla. El de la persona, para el anillo que late.
      let sinVolumenDesde = 0;
      let envolvente: ((ms: number) => number) | null = null;
      let t0 = 0;
      let antes = d.reloj();
      const sinVolumenMs = d.sinVolumenMs ?? 600;
      soltarReloj = d.recursos?.tomar('timer', `boca gen ${gen}`) || null;
      nivel = d.intervalo(() => {
        if (!vivo) return;
        const c = d.conv();
        let salida = 0;
        let entrada = 0;
        let cruda: number | undefined;
        try {
          salida = Math.min(1, c.getOutputVolume() * 1.6);
          if (!d.silenciada()) {
            cruda = c.getInputVolume();
            entrada = Math.min(1, (cruda || 0) * 2);
          }
        } catch {
          /* sin sesión todavía */
        }
        const ahora = d.reloj();
        if (d.hablando.current && salida < 0.01) {
          if (!sinVolumenDesde) sinVolumenDesde = ahora;
          if (ahora - sinVolumenDesde > sinVolumenMs) {
            if (!envolvente) {
              envolvente = d.envolventeLibre('speak', gen);
              t0 = ahora;
            }
            salida = envolvente(ahora - t0);
          }
        } else {
          sinVolumenDesde = 0;
          if (!d.hablando.current) envolvente = null;
        }
        // El espectro, antes del nivel: el nivel es el que publica la boca nueva.
        if (d.hablando.current && d.senal.quiereForma()) {
          try {
            d.senal.espectro(c.getOutputByteFrequencyData());
          } catch {
            /* sin espectro: la forma sale del volumen */
          }
        }
        // Abre rápido, cierra suave; en silencio, cerrada. (No se espera al «speaking» del SDK para abrir:
        // a veces llega después del primer sonido y se comería la primera sílaba.)
        const dt = ahora - antes;
        antes = ahora;
        if (d.silenciada()) d.boca.cortar();
        const abre = d.silenciada() ? 0 : d.boca.seguir(salida, dt);
        d.cbs().onNiveles(abre, entrada, cruda, gen);
      }, d.pasoMs);
    } catch (e: any) {
      soltarConexion?.();
      soltarConexion = null;
      soltarAudio();
      if (!vivo) return;
      // Con el código HTTP delante: así se le puede decir a la persona POR QUÉ (duenoAudio.motivoFalloVoz).
      const detalle = `${e?.status ? `HTTP ${e.status} · ` : ''}${String(e?.message || e)}`;
      d.miga(`conversación fluida: no abrió (${detalle.slice(0, 80)})`);
      avisar('error', detalle);
    }
  })();

  return () => {
    if (!vivo) return;
    vivo = false;
    pararReloj();
    d.cbs().onNiveles(0, 0, undefined, gen);
    pedirFin();
    d.abierta.current = false;
    // El SDK suelta el audio cuando termina de desconectar (onDisconnect); si nunca avisa, el
    // VozProvider lo da por suelto a los pocos segundos.
    if (audio === 'tomado') d.cbs().onAudio?.(gen, 'cerrando');
    fin();
  };
}
