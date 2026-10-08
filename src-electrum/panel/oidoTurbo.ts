/**
 * EL OÍDO DE DR ELECTRUM, IGUAL QUE EL DE AU-RA.
 *
 * Primero el oído Turbo (src/03-voz/oidoTurbo.ts: el micrófono a 16 kHz EN VIVO a Scribe v2 Realtime Turbo
 * con un token de un solo uso de /api/electrum/turbo/permiso, que trae las pistas del oficio: «concesión»,
 * «Olancho», «g/t»…). Lo que ya hace ese motor (mobile/src/lib/turboMotor.ts):
 *  · guarda los 0,6 s de antes de la voz: no se come la primera sílaba («acércate», no «cércate»);
 *  · el umbral sigue el ruido del lugar (una oficina no es un cerro con viento);
 *  · parciales mientras se habla y la frase entera ~50 ms después de callar;
 *  · si el en vivo falla, la frase no se pierde: va entera en WAV a /api/electrum/oir.
 * Y lo que se le suma aquí:
 *  · tres fallos seguidos del en vivo (sin token, sin WebSocket) o un micrófono que no abre a 16 kHz: se
 *    pasa al oído de siempre (oido.ts, una frase en WAV por vez) durante 5 minutos, y después se vuelve a
 *    probar el en vivo;
 *  · lo que el transcriptor inventa («Subtítulos realizados por…») no llega a la mesa (interrumpir.ts);
 *  · HABLARLE ENCIMA como a AU-RA: mientras suena la voz, lo que se oye se mira por su texto. Su eco o un
 *    «ajá» no la cortan (la voz baja un momento y vuelve); un «espera», una orden o dos palabras suyas, sí.
 *
 * Misma cara que `crearOido`: `iniciar`, `reanudar`, `detener`, `nivel`, `estado` (BotonOido y los modos
 * «siempre» y «tocar» siguen igual).
 */
import { crearOidoTurboWeb, turboWebPosible } from '../../src/03-voz/oidoTurbo';
import type { WsTurbo } from '../../mobile/src/lib/turboMotor';
import { detectarIdioma } from '../../lib/idioma-detectar';
import { headersElectrum } from '../acceso';
import { fijarIdioma } from './idioma';
import { crearOido, type EstadoOido, type Opciones as OpcionesWav } from './oido';
import { decidirEncima, dudaEncima, filtrarAlucinacion, veredictoEncima, VigiaTurbo } from './interrumpir';

export type OpcionesOido = {
  /** Cada frase oída, ya en texto y limpia, en el orden en que se dijo. */
  alTexto: (texto: string) => void;
  alEstado: (e: EstadoOido) => void;
  /** ¿Suena AHORA una voz de la mesa? (audio de verdad: para separar su eco por la energía). */
  suena: () => boolean;
  /** ¿La mesa está hablando? (sonando, o en pausa mientras se confirma si la interrumpieron). */
  hablando: () => boolean;
  /** Lo que la voz dice ahora y lo de hace un momento: su eco. */
  dichos: () => string[];
  /** Cuánto suena ahora la voz de la mesa (0..1; −1 sin medidor). */
  nivelSalida?: () => number;
  /** ¿Se le puede hablar encima? (el botón «Interrumpir»). */
  interrumpible?: () => boolean;
  /** Puede ser la persona: pausar la voz (oído en WAV, que tarda) o bajarla (en vivo, que decide en décimas). */
  alDudar: (como: 'pausa' | 'bajar') => void;
  /** Era su eco o un «ajá»: que la voz siga. */
  alSeguir: () => void;
  /** Es la persona: la voz se calla (quien llama anota lo que alcanzó a oír). Después llega su frase. */
  alInterrumpir: () => void;
  /** ¿Es una orden de pantalla? («siguiente», «acércate»): una sola palabra encima basta para cortar. */
  esOrden?: (texto: string) => boolean;
};

/** Cuánto se queda con el oído de siempre antes de volver a probar el en vivo. */
export const PAUSA_TURBO_MS = 5 * 60_000;
/** Bajó la voz por algo que oyó encima y no llega texto: pasado esto, la voz vuelve. */
const DUDA_MS = 2_500;

/** El WebSocket del en vivo, avisando si abrió o falló antes de abrir. */
function wsVigilado(url: string, vigia: VigiaTurbo): WsTurbo {
  const ws = new WebSocket(url);
  let abrio = false;
  let contado = false;
  const falla = () => {
    if (abrio || contado) return;
    contado = true;
    vigia.fallo();
  };
  const envoltura: WsTurbo = {
    get readyState() {
      return ws.readyState;
    },
    send: (d) => ws.send(d),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
  ws.onopen = () => {
    abrio = true;
    vigia.exito();
    envoltura.onopen?.();
  };
  ws.onmessage = (e) => envoltura.onmessage?.(e);
  ws.onerror = (e) => {
    falla();
    envoltura.onerror?.(e);
  };
  ws.onclose = (e) => {
    falla();
    envoltura.onclose?.(e);
  };
  return envoltura;
}

async function permisoElectrum(vigia: VigiaTurbo): Promise<{ url: string } | null> {
  try {
    const r = await fetch('/api/electrum/turbo/permiso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headersElectrum() },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    const j: any = r.ok ? await r.json().catch(() => null) : null;
    if (typeof j?.url === 'string' && j.url.startsWith('wss://')) return { url: j.url };
  } catch {
    /* sin red: cuenta como fallo */
  }
  vigia.fallo();
  return null;
}

/** El respaldo del en vivo: la frase entera en WAV al oído del servidor. `confirmar`: cifras o dinero, con Scribe v2. */
async function oirWav(wav: string, confirmar: boolean): Promise<string> {
  const r = await fetch('/api/electrum/oir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headersElectrum() },
    body: JSON.stringify({ audio: `data:audio/wav;base64,${wav}`, mime: 'audio/wav', ...(confirmar ? { confirmar: true } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j: any = await r.json().catch(() => ({}));
  if (j?.texto) fijarIdioma(j.idioma);
  return String(j?.texto || '').trim();
}

export function crearOidoElectrum(op: OpcionesOido) {
  let estado: EstadoOido = 'apagado';
  const poner = (e: EstadoOido) => {
    if (e === estado) return;
    estado = e;
    op.alEstado(e);
  };
  let querido = false;
  let via: 'turbo' | 'wav' | null = null;
  /** Hasta cuándo no se prueba el en vivo (falló seguido o el micrófono no abre a 16 kHz). */
  let sinTurboHasta = 0;
  let reintento: ReturnType<typeof setTimeout> | null = null;

  /* --- el oído de siempre (una frase en WAV por vez), con la confirmación por texto --- */
  const wav = crearOido({
    alTexto: (t, encima) => {
      let texto = filtrarAlucinacion(t);
      if (encima) texto = decidirEncima(texto, op, null);
      if (texto) op.alTexto(texto);
    },
    alEstado: (e) => via === 'wav' && poner(e),
    hablandoAhora: op.suena,
    nivelSalida: op.nivelSalida,
    interrumpible: op.interrumpible,
    alDudar: () => op.alDudar('pausa'),
    alDescartar: () => op.alSeguir(),
  } satisfies OpcionesWav);

  /* --- el oído en vivo --- */
  let motor: ReturnType<typeof crearOidoTurboWeb> | null = null;
  let nivelTurbo = 0;
  const vigia = new VigiaTurbo(() => pasarAWav());

  function conTurbo() {
    // Por frase: ¿empezó (o pasó a estar) encima de la voz? ¿Ya se confirmó que era la persona? ¿Se bajó la voz?
    let encima = false;
    let cortada: string[] | null = null;
    let dudo = false;
    let reloj: ReturnType<typeof setTimeout> | null = null;
    const soltarDuda = () => {
      if (reloj) clearTimeout(reloj);
      reloj = null;
      if (dudo && !cortada) op.alSeguir();
      dudo = false;
    };
    const dudar = () => {
      if (!dudo) op.alDudar('bajar');
      dudo = true;
      if (reloj) clearTimeout(reloj);
      reloj = setTimeout(soltarDuda, DUDA_MS);
    };
    const m = crearOidoTurboWeb(
      {
        onSpeechStart: () => {
          soltarDuda();
          encima = op.hablando();
          cortada = null;
          poner('oyendo');
        },
        onPartial: (t) => {
          if (!t || cortada) return;
          if (!encima && op.hablando()) encima = true;
          if (!encima || !(op.interrumpible?.() ?? true)) return;
          const d = op.dichos();
          if (veredictoEncima(t, d, op.esOrden) === 'real') {
            // Es la persona: la voz se calla ya, sin esperar a que termine la frase.
            if (reloj) clearTimeout(reloj);
            reloj = null;
            dudo = false;
            cortada = d;
            op.alInterrumpir();
          } else if (dudaEncima(t, d)) dudar();
        },
        onFinal: (t) => {
          const eco = cortada;
          const fueEncima = encima || op.hablando();
          if (reloj) clearTimeout(reloj);
          reloj = null;
          const habiaDuda = dudo;
          dudo = false;
          encima = false;
          cortada = null;
          poner('escuchando');
          let texto = filtrarAlucinacion(t);
          if (fueEncima && (op.interrumpible?.() ?? true)) texto = texto ? decidirEncima(texto, op, eco) : '';
          else if (fueEncima) texto = '';
          // Ni la persona ni nada que decir: si se había bajado la voz, vuelve.
          if (!texto && habiaDuda && !eco) op.alSeguir();
          if (!texto) return;
          fijarIdioma(detectarIdioma(texto));
          op.alTexto(texto);
        },
        onLevel: (n) => {
          nivelTurbo = n;
        },
        onListeningChange: (on) => {
          if (via === 'turbo') poner(on ? 'escuchando' : 'pidiendo');
        },
        alSinPermiso: () => poner('sin-permiso'),
        // El micrófono no abre a 16 kHz (o no abre): el oído de siempre, que abre a la tasa del navegador.
        onUnavailable: () => pasarAWav(),
      },
      {
        permiso: () => permisoElectrum(vigia),
        transcribirWav: oirWav,
        crearWs: (url) => wsVigilado(url, vigia),
      }
    );
    // «Te escucho…» mientras hay una frase abierta; al cerrarse (con texto o sin él, si era ruido) vuelve a escuchar.
    // Si la frase se cierra sin texto, la duda se suelta sola por el reloj (DUDA_MS).
    m.setOyenteTrozo((i) => {
      if (via === 'turbo' && estado !== 'sin-permiso') poner(i.enVoz ? 'oyendo' : 'escuchando');
    });
    return m;
  }

  function usarTurbo() {
    via = 'turbo';
    wav.detener();
    motor = conTurbo();
    poner('pidiendo');
    motor.activar();
  }

  function usarWav() {
    via = 'wav';
    poner('pidiendo');
    void wav.iniciar().then((ok) => {
      if (!ok && via === 'wav') poner(wav.estado());
    });
  }

  function pasarAWav() {
    if (via !== 'turbo') return;
    sinTurboHasta = Date.now() + PAUSA_TURBO_MS;
    motor?.destruir();
    motor = null;
    nivelTurbo = 0;
    if (estado === 'sin-permiso') {
      via = null;
      return;
    }
    usarWav();
    // Pasado el rato, se vuelve a probar el en vivo (si sigue encendido y nadie le está hablando).
    if (reintento) clearTimeout(reintento);
    reintento = setTimeout(function probar() {
      reintento = null;
      if (!querido || via !== 'wav') return;
      if (wav.estado() === 'oyendo' || wav.estado() === 'pasando') {
        reintento = setTimeout(probar, 5_000);
        return;
      }
      usarTurbo();
    }, PAUSA_TURBO_MS);
  }

  return {
    /** Pide el micrófono (el navegador pregunta la primera vez) y empieza a escuchar. */
    async iniciar(): Promise<boolean> {
      querido = true;
      if (via === 'turbo' && motor) {
        // Sin permiso la vez anterior: se vuelve a pedir con el toque.
        if (estado === 'sin-permiso' || estado === 'apagado') motor.activar();
        return true;
      }
      if (via === 'wav') return wav.iniciar();
      if (turboWebPosible() && Date.now() >= sinTurboHasta) {
        usarTurbo();
        return true;
      }
      usarWav();
      return true;
    },
    /** Un toque de la persona: el navegador deja arrancar el audio que estaba en pausa. */
    reanudar() {
      wav.reanudar();
      // El en vivo abrió sin un toque y el navegador dejó su audio en pausa (no llegan trozos): se reabre dentro del toque.
      if (via === 'turbo' && motor && estado !== 'sin-permiso' && !motor.vivo()) motor.reiniciar();
    },
    detener() {
      querido = false;
      if (reintento) clearTimeout(reintento);
      reintento = null;
      motor?.destruir();
      motor = null;
      wav.detener();
      via = null;
      nivelTurbo = 0;
      estado = 'apagado';
      op.alEstado('apagado');
    },
    /** 0..1 aproximado, para el medidor del botón. */
    nivel: () => (via === 'turbo' ? nivelTurbo : wav.nivel()),
    estado: () => estado,
    /** Por dónde oye ahora (para las pruebas y el diagnóstico). */
    via: () => via,
  };
}
