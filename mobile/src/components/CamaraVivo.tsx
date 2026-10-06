/**
 * CamaraVivo — los ojos de AU-RA EN VIVO (Android, modules/aura-camara).
 *
 * Mismas props que CamaraVision (la cámara de fotos) para que la mesa elija una u otra sin cambiar nada
 * (components/CamaraMesa.tsx). La diferencia:
 *
 *  · La vista nativa (CameraX + ML Kit en flujo con seguimiento) manda eventos chicos hasta 15 por segundo
 *    mientras algo cambia (un latido cada 0,5 s si no): recuadros en tiempo real y un `id` estable por
 *    persona (trackingId). Nada de fotos en disco ni ML Kit sobre archivos en el hilo de JS.
 *  · La escena es la de siempre (lib/escena.ts MaquinaEscena) con el adaptador del flujo
 *    (lib/camaraNativa.ts observacionNativa, UMBRALES_VIVO); la mirada del avatar, igual que antes.
 *  · Reconocer: la identidad se queda pegada a la pista (seguimiento.ts, por trackingId) y se mira UNA vez
 *    por persona nueva, con un recorte de ~290 px de ese mismo cuadro → el motor de caras de siempre
 *    (useCaras.recibirFoto). Un segundo recorte enseguida confirma (2 de 3 votos) y después solo un repaso
 *    cada 12 s (5 s si ganó por poco). Cuándo, en caras/pistaNativa.ts.
 *  · «Qué ves» (`grabRef`) y las subidas al servidor (`observar`, mismo ritmo que antes: vistaCamara.ts
 *    intervaloServidor) usan `foto()` del nativo: la cámara de fotos de CameraX (~1280×960), sin
 *    takePictureAsync.
 *  · Red de seguridad: antes de montar la vista nativa se anota «montando» en el disco y se espera a que
 *    quede escrito (lib/guardiaCamara.ts); con el primer cuadro sano y 10 s más se borra. Si el nativo
 *    avisa un error o no llega ningún cuadro en 8 s, `onFallo` y la mesa vuelve a la cámara de fotos. Si la
 *    marca NO se pudo escribir, tampoco se monta: `onFallo` (CAM-D).
 *  · Origen y tiempo (master §25.5, lib/cercoCamara.ts): cada evento, recorte y foto lleva la hora de CAPTURA y
 *    la época/lado de la cámara que lo produjo; se cerca antes de aplicarlo (CAM-C, CAM-E). La subida de escena
 *    respeta la voz (`ocupada`, CAM-B) y sus objetos se dibujan solo sobre esa foto (CAM-G; lib/subidaEscena.ts).
 *  · La mirada va cruda a la mesa en cada evento: la alisa lib/miradaAvatar.ts en el cuadro del cuerpo (CAM-A).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import type { CamaraVisionProps, FrameGrabber } from './CamaraVision';
import { verCamara, type RespuestaVista } from '../lib/api';
import { MIN_CARA_MLKIT, MaquinaEscena, escenaApagada, type Escena, type MotorVision } from '../lib/escena';
import { GUARDIA, UMBRALES_VIVO, eventoValido, observacionNativa, rectDeCara, ritmoNativo, tamEquivalente, type ConfigCamaraRemota, type EventoCaras } from '../lib/camaraNativa';
import { CercoCamara, ORIGEN, type VistaFechada } from '../lib/cercoCamara';
import { SubidaEscena } from '../lib/subidaEscena';
import { VistaCamaraNativa, fotoNativa, recorteNativo } from '../lib/auraCamara';
import { camaraMontando, camaraSana, camaraSoltada } from '../lib/guardiaCamara';
import { etiquetasDeVista, type VistaCamara } from '../lib/vistaCamara';
import { cajaEnPantalla, etiquetaCara, lineaEstado, marcasEnVivo, marcoParaFoto } from '../lib/vistaEnVivo';
import { anotarVotos, elegirPistaParaReconocer, podarIntentos, type IntentoPista } from '../caras/pistaNativa';
import { miga, reportarEstado } from '../lib/reporte';
import { vistaFresca } from '../lib/vistaTurno';
import { idiomaActual, tr } from '../i18n';
import { T } from '../tema';

/** Emisión máxima de onEscena sin eventos (igual que la cámara de fotos). */
const ESCENA_CADA_MS = 500;
/** Sin ningún evento del nativo en este tiempo (el latido es de ≤1 s), la cámara nueva no anda. */
const SIN_CUADROS_MS = 8000;
const FOTO_MAX_MS = 5000;
const MINIMO_FOTO = 4000;
/** Con la vista abierta, se redibuja al menos así (los recuadros viejos se van aunque no llegue nada). */
const VISTA_TIC_MS = 500;
/** Mientras se reconoce, cada cuánto se mira si toca otro recorte (además de con cada evento). */
const RECONOCER_TIC_MS = 200;
/** Una cara a la vista sin nombre todavía así de tiempo: una miga con el porqué (useCaras.diagnosticoPista). */
const SIN_NOMBRE_AVISO_MS = 30_000;
const CALIDAD = { normal: 0.6, leer: 0.85, servidor: 0.5 } as const;

type CarasVivo = NonNullable<CamaraVisionProps['caras']> & { ocupado?: () => boolean; mesaOcupada?: () => boolean; diagnosticoPista?: (pista: number) => string };

export type CamaraVivoProps = Omit<CamaraVisionProps, 'caras'> & {
  caras?: CarasVivo;
  /** Lo que dijo el servidor (ritmo, tamaño del análisis). */
  remota?: ConfigCamaraRemota;
  /** La cámara nueva no anda (error del nativo, sin cuadros): la mesa vuelve a la de fotos. */
  onFallo?: (motivo: string) => void;
};

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const conTope = <V,>(p: Promise<V>, ms: number) => Promise.race([p, dormir(ms).then(() => null)]);

function useAppActiva() {
  const [activa, setActiva] = useState(AppState.currentState === 'active' || AppState.currentState == null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setActiva(s === 'active'));
    return () => sub.remove();
  }, []);
  return activa;
}

export function CamaraVivo({
  enabled,
  dormido = false,
  grabRef,
  onEscena,
  onGaze,
  onObjects,
  onVista,
  onMotor,
  observar = false,
  vista = false,
  marcoVista,
  lado = 'frontal',
  onVoltear,
  onCerrarVista,
  seguidor,
  caras,
  ocupada,
  movida,
  remota,
  onFallo,
}: CamaraVivoProps) {
  const cb = useRef({ onEscena, onGaze, onObjects, onVista, onMotor, caras, onFallo, seguidor, ocupada, movida });
  cb.current = { onEscena, onGaze, onObjects, onVista, onMotor, caras, onFallo, seguidor, ocupada, movida };
  const Vista = VistaCamaraNativa();
  const appActiva = useAppActiva();
  const activa = enabled && appActiva && !!Vista;
  const [montable, setMontable] = useState(false);
  const maquina = useRef(new MaquinaEscena(UMBRALES_VIVO)).current;
  const ultimaEscena = useRef<Escena | null>(null);
  const ultimaEmision = useRef(0);
  const gaze = useRef({ x: 0, y: 0, activa: false });
  const motorAnunciado = useRef<MotorVision | null>(null);
  const evento = useRef<EventoCaras | null>(null);
  const ultimoEvento = useRef(0);
  const sanoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentos = useRef(new Map<number, IntentoPista>()).current;
  const pidiendo = useRef(false);
  const ultimoPedido = useRef(0);
  const nombreMedido = useRef(false);
  /** Pistas de las que ya se dejó la miga de «sin nombre». */
  const sinNombreAvisado = useRef(new Set<number>()).current;
  const vistaServidor = useRef<VistaFechada<VistaCamara> | null>(null);
  /** La última respuesta del servidor (su `visto` es el hecho para el cerebro de esa vista). */
  const respuestaServidor = useRef<RespuestaVista | null>(null);
  /** Cuándo vio ML Kit que la escena cambió (llegó o se fue alguien, otra cantidad de personas): la subida en vivo. */
  const cambioEn = useRef(0);
  /** CAM-C/E: de qué cámara y época es cada cosa. Cambiar de lado sube la época al momento (también aquí, al dibujar). */
  const cerco = useRef(new CercoCamara(lado)).current;
  cerco.poner(lado);
  /** Eventos del nativo descartados seguidos por viejos (el reloj del nativo no cuadra): una miga, sin caer. */
  const viejos = useRef(0);
  const dormidoRef = useRef(dormido);
  dormidoRef.current = dormido;
  const observarRef = useRef(observar);
  observarRef.current = observar;
  const ladoRef = useRef(lado);
  ladoRef.current = lado;
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const [, setTic] = useState(0);
  const ritmo = ritmoNativo(remota || { activa: true }, dormido);
  const ladoCortoRef = useRef(ritmo.ladoCorto);
  ladoCortoRef.current = ritmo.ladoCorto;

  const anunciarMotor = useCallback((m: MotorVision) => {
    if (motorAnunciado.current === m) return;
    motorAnunciado.current = m;
    cb.current.onMotor?.(m);
  }, []);

  const emitir = useCallback((e: Escena) => {
    // Otra cantidad de gente, o alguien que llega o se va: la vista del servidor ya no es de esta escena.
    if (e.personas !== (ultimaEscena.current?.personas ?? -1) || e.eventos.some((x) => x === 'llego' || x === 'se_fue')) cambioEn.current = Date.now();
    ultimaEscena.current = e;
    const now = Date.now();
    if (e.eventos.length || now - ultimaEmision.current >= ESCENA_CADA_MS) {
      ultimaEmision.current = now;
      cb.current.onEscena?.(e);
    }
  }, []);

  const soltarMirada = useCallback(() => {
    if (!gaze.current.activa) return;
    gaze.current = { x: 0, y: 0, activa: false };
    cb.current.onGaze?.(0, 0, false);
  }, []);

  const fallar = useCallback((motivo: string) => {
    miga(`cámara nueva: ${motivo}`);
    cb.current.onFallo?.(motivo);
  }, []);

  // Cámara apagada / sin permiso: una sola escena 'ninguno' y mirada libre.
  useEffect(() => {
    if (enabled) return;
    cerco.invalidar();
    maquina.reiniciar();
    seguidor?.reiniciar();
    vistaServidor.current = null;
    vistaFresca.invalidar();
    evento.current = null;
    anunciarMotor('ninguno');
    const e = escenaApagada(Date.now());
    ultimaEscena.current = e;
    cb.current.onEscena?.(e);
    soltarMirada();
  }, [enabled, anunciarMotor, cerco, maquina, seguidor, soltarMirada]);

  // Otra cámara: lo visto con la anterior no vale.
  const ladoVisto = useRef(lado);
  useEffect(() => {
    if (ladoVisto.current === lado) return;
    ladoVisto.current = lado;
    maquina.reiniciar();
    seguidor?.reiniciar();
    intentos.clear();
    evento.current = null;
    vistaServidor.current = null;
    vistaFresca.invalidar();
    soltarMirada();
  }, [lado, intentos, maquina, seguidor, soltarMirada]);

  // La guardia: «montando» escrito en el disco ANTES de montar la vista nativa; al soltarla con calma, se borra.
  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    // Cada vez que se monta, el «sano» se vuelve a medir desde el primer cuadro de ESTA vez.
    evento.current = null;
    cerco.montada();
    void camaraMontando().then((ok) => {
      if (!vivo) return;
      // CAM-D: sin la marca en el disco, un cierre al montar no se detectaría: no se monta, a la de fotos.
      if (!ok) return fallar('sin-disco: no pude anotar la guardia antes de montar');
      ultimoEvento.current = Date.now();
      setMontable(true);
    });
    return () => {
      vivo = false;
      cerco.invalidar();
      setMontable(false);
      if (sanoTimer.current) clearTimeout(sanoTimer.current);
      sanoTimer.current = null;
      camaraSoltada();
    };
  }, [activa, cerco, fallar]);

  // Sin cuadros en 8 s (el latido del nativo es de ≤1 s): no anda, a la cámara de fotos.
  useEffect(() => {
    if (!activa || !montable) return;
    const t = setInterval(() => {
      if (Date.now() - ultimoEvento.current > SIN_CUADROS_MS) fallar(evento.current ? 'dejó de mandar cuadros' : 'sin cuadros al abrir');
    }, 2000);
    return () => clearInterval(t);
  }, [activa, montable, fallar]);

  // Con la vista abierta se redibuja seguido: los recuadros de hace más de 1,5 s se van.
  useEffect(() => {
    if (!vista || !activa) return;
    const t = setInterval(() => setTic((n) => n + 1), VISTA_TIC_MS);
    return () => clearInterval(t);
  }, [vista, activa]);

  /** ¿Toca mirar quién es alguien? Un recorte de ESE cuadro al motor de caras (de a uno). */
  const intentarReconocer = useCallback(async () => {
    const c = cb.current.caras;
    const s = cb.current.seguidor;
    const e = evento.current;
    if (!c?.reconoce || !s || !e || pidiendo.current) return;
    const ahora = Date.now();
    // Sin `ocupado` (useCaras de antes): no pedir otro antes de ~0,8 s.
    const ocupado = c.ocupado ? c.ocupado() : ahora - ultimoPedido.current < 800;
    const vis = s.visibles(ahora);
    podarIntentos(intentos, vis);
    anotarVotos(intentos, vis);
    const p = elegirPistaParaReconocer(vis, intentos, ahora, { ocupado, reconoce: true, vistaAbierta: vistaRef.current, alto: (x) => x.caja.h * e.ih });
    if (!p) return;
    // Mientras la mesa piensa o habla, solo se reconoce a quien llega: los repasos de quien ya tiene nombre esperan
    // (la misma pausa que la cámara por fotos, useCaras.quiereFoto).
    if (p.identidad && c.mesaOcupada?.()) return;
    // Sin trackingId solo se puede pedir «la más grande», y eso solo vale si hay una sola cara.
    if (p.ext === undefined && vis.length > 1) return;
    pidiendo.current = true;
    const i = intentos.get(p.id);
    intentos.set(p.id, { ...i, ultimo: ahora, n: (i?.n ?? 0) + 1 });
    const sello = cerco.sello();
    try {
      const r = await recorteNativo(p.ext ?? -1);
      if (!r?.b64 || !r.caja) return;
      // CAM-C: un recorte de otra cámara/época, o de un cuadro demasiado viejo, no se reconoce.
      if (cerco.admitirResultado(r, sello, Date.now(), ORIGEN.recorteMaxMs) !== 'ok') return;
      ultimoPedido.current = Date.now();
      // La hora del CUADRO (no la de llegada) y una cerca que useCaras mira al volver del motor.
      cb.current.caras?.recibirFoto({ b64: r.b64, cajas: [{ pista: p.id, caja: r.caja, tam: tamEquivalente(r.tam ?? p.caja.h, ladoCortoRef.current) }], ts: r.ts > 0 ? r.ts : e.ts, vigente: () => cerco.vigente(sello) });
    } finally {
      pidiendo.current = false;
    }
  }, [cerco, intentos]);

  useEffect(() => {
    if (!activa || !montable || !caras?.reconoce) return;
    const t = setInterval(() => void intentarReconocer(), RECONOCER_TIC_MS);
    return () => clearInterval(t);
  }, [activa, montable, caras?.reconoce, intentarReconocer]);

  // Un evento del nativo: escena, mirada, pistas, quizá un recorte para reconocer, y redibujar si se ve.
  const onCarasNativo = useCallback(
    (ev: { nativeEvent: unknown }) => {
      const e = eventoValido(ev?.nativeEvent);
      if (!e) return;
      // Un evento de la cámara anterior (se cambió y el nativo aún no rearmó) no vale.
      if (e.lado !== ladoRef.current) return;
      const ahora = Date.now();
      // La cámara anda (aunque el evento se descarte por viejo: la salud no depende de la frescura).
      ultimoEvento.current = ahora;
      // CAM-C: época vieja del nativo, cuadro fuera de orden o captura vieja → no se aplica.
      const adm = cerco.admitirEvento(e, ahora);
      if (adm !== 'ok') {
        if (adm === 'viejo' || adm === 'futuro') {
          viejos.current += 1;
          if (viejos.current === 30) miga(`cámara nueva: 30 eventos seguidos descartados (${adm}, ${Math.round(ahora - e.ts)} ms)`);
        }
        return;
      }
      viejos.current = 0;
      const primero = !evento.current;
      evento.current = e;
      anunciarMotor('mlkit');
      if (primero && !sanoTimer.current) {
        sanoTimer.current = setTimeout(() => {
          sanoTimer.current = null;
          camaraSana(evento.current?.fps);
        }, GUARDIA.sanoTrasMs);
      }
      const trasera = e.lado === 'trasera';
      const esc = maquina.procesar(observacionNativa(e, { trasera }), { inmediato: dormidoRef.current });
      const g = gaze.current;
      if (esc.principal && !trasera) {
        // CAM-A: cruda, en cada evento; la alisa con deltaTime quien dibuja (lib/miradaAvatar.ts).
        g.x = esc.principal.x;
        g.y = esc.principal.y;
        g.activa = true;
        cb.current.onGaze?.(g.x, g.y, true);
      } else if (g.activa && (esc.personas === 0 || trasera)) {
        g.activa = false;
        cb.current.onGaze?.(g.x, g.y, false);
      }
      emitir(esc);
      const s = cb.current.seguidor;
      if (s) {
        s.actualizar(
          e.caras.map((c) => c.foto),
          e.ts,
          e.caras.map((c) => c.id)
        );
        // Lo que tardó en salir el primer nombre (medido en el teléfono, una vez por sesión) y, si tardó, por qué.
        const diag = cb.current.caras?.diagnosticoPista;
        if (!nombreMedido.current) {
          const p = s.visibles(e.ts).find((x) => x.identidad);
          if (p) {
            nombreMedido.current = true;
            const tardo = p.identidad!.desde - p.nacio;
            reportarEstado(`cámara nueva: primer nombre ${tardo} ms después de ver la cara (ML Kit ${e.ms} ms, ${e.fps} cuadros/s)${tardo > 10_000 && diag ? ` · ${diag(p.id)}` : ''}`);
          }
        }
        // Una cara que lleva rato sin nombre (con alguien guardado): la toma o el parecido, en una miga por pista.
        if (cb.current.caras?.reconoce && diag) {
          for (const p of s.visibles(e.ts)) {
            if (p.identidad || sinNombreAvisado.has(p.id) || e.ts - p.nacio < SIN_NOMBRE_AVISO_MS) continue;
            sinNombreAvisado.add(p.id);
            miga(`cámara nueva: ${Math.round((e.ts - p.nacio) / 1000)} s sin nombre · ${diag(p.id)}`);
          }
        }
        if (cb.current.caras?.reconoce) void intentarReconocer();
      }
      if (vistaRef.current) setTic((n) => n + 1);
    },
    [anunciarMotor, cerco, emitir, intentarReconocer, maquina]
  );

  const onEstadoNativo = useCallback(
    (ev: { nativeEvent: unknown }) => {
      const m = (ev?.nativeEvent || {}) as { tipo?: string; codigo?: string; motivo?: string; ms?: number; hilo?: string };
      if (m.tipo === 'lista') miga(`cámara nueva: abierta (${ladoRef.current})`);
      else if (m.tipo === 'lento') {
        // El vigía del nativo (AuraCamaraView): el hilo principal de Android no atendió en `ms`. Con ≥ 5 s Android
        // muestra «no responde» y un toque la cierra: se manda ya, por si después no hay otra oportunidad.
        const ms = Math.round(Number(m.ms) || 0);
        const linea = `cámara nueva: hilo ${m.hilo || 'principal'} de Android trabado ${ms} ms`;
        if (ms >= 4000) reportarEstado(linea);
        else miga(linea);
      }
      else if (m.tipo === 'error') {
        const codigo = String(m.codigo || '');
        // Los del estado de la cámara (otra app la usa…) los reintenta CameraX solo; si no vuelve, lo ve el «sin cuadros».
        if (codigo.startsWith('estado-')) miga(`cámara nueva: ${String(m.motivo || codigo).slice(0, 80)}`);
        else fallar(`${codigo}: ${String(m.motivo || '').slice(0, 100)}`);
      }
    },
    [fallar]
  );

  // «Qué ves»: la foto de la cámara de fotos de CameraX (o el último cuadro), en base64.
  useEffect(() => {
    if (!grabRef) return;
    const g: FrameGrabber | null =
      activa && montable
        ? async (o) => {
            const f = await conTope(fotoNativa(o?.calidad === 'leer' ? CALIDAD.leer : CALIDAD.normal, true), FOTO_MAX_MS);
            const b64 = f?.b64 || null;
            return b64 && b64.length >= MINIMO_FOTO ? b64 : null;
          }
        : null;
    grabRef.current = g;
    return () => {
      if (grabRef.current === g) grabRef.current = null;
    };
  }, [activa, montable, grabRef]);

  // Lo que hay en la mesa (servidor): el mismo ritmo que la cámara de fotos con ML Kit, con la voz primero (CAM-B) y
  // cercado por cámara (CAM-E): cambiar de lado reinicia la subida y lo que vuelva de la anterior no se aplica.
  useEffect(() => {
    if (!activa || !montable) return;
    const subida = new SubidaEscena(
      {
        ahora: Date.now,
        foto: () => conTope(fotoNativa(CALIDAD.servidor, true), FOTO_MAX_MS),
        ver: async (b64) => {
          const r = await verCamara(b64, 'escena');
          respuestaServidor.current = r;
          return r?.vista ?? null;
        },
        estado: () => ({
          dormida: dormidoRef.current,
          personas: ultimaEscena.current?.personas ?? 0,
          necesitaEscena: observarRef.current,
          ocupada: !!(cb.current.ocupada?.() || cb.current.caras?.mesaOcupada?.()),
          // Moverse el teléfono también cambia lo que se ve (CAM-G).
          cambioEn: Math.max(cambioEn.current, cb.current.movida?.() ?? 0),
        }),
        aplicar: (vs) => {
          vistaServidor.current = vs;
          // La vista fresca de «¿qué ves?» (lib/vistaTurno.ts): con su hecho para el cerebro y su foto para «Lo que vi».
          const r = respuestaServidor.current;
          vistaFresca.guardar({ vista: vs.v, visto: r?.vista === vs.v && r.estructurada ? r.visto : '', ts: vs.ts, lado: vs.lado, personas: ultimaEscena.current?.personas ?? 0, foto: vs.foto });
          const labels = etiquetasDeVista(vs.v);
          if (labels.length) cb.current.onObjects?.(labels);
          cb.current.onVista?.(vs.v);
        },
        descartada: (m) => miga(`cámara nueva: escena descartada (${m})`),
      },
      cerco
    );
    const t = setInterval(() => void subida.tic(), 1000);
    return () => {
      subida.detener();
      clearInterval(t);
    };
  }, [activa, montable, lado, cerco]);

  if (!enabled || !Vista) return null;

  // «Lo que veo»: el marco con la proporción del cuadro, lo más grande que quepa, centrado arriba.
  const e = evento.current;
  const dims = e ? { w: e.iw, h: e.ih } : null;
  let marco: { left: number; top: number; width: number; height: number } | null = null;
  let capa: ReactNode = null;
  if (vista && marcoVista && marcoVista.width > 40 && marcoVista.height > 40) {
    const m = marcoParaFoto(dims, { w: marcoVista.width, h: marcoVista.height });
    marco = { left: marcoVista.left + (marcoVista.width - m.w) / 2, top: marcoVista.top, width: m.w, height: m.h };
    const ahora = Date.now();
    const en = idiomaActual() === 'en';
    const visibles = seguidor?.visibles(ahora) || [];
    const mirando = !!ultimaEscena.current?.principal?.mirando;
    const marcas = marcasEnVivo({ pistas: visibles, mirando, lado, vista: vistaServidor.current, ahora, en, epoca: cerco.epocaActual, movidaEn: movida?.() });
    const porPista = new Map(visibles.map((p) => [`c${p.id}`, p]));
    const estado = lineaEstado({
      lado,
      personas: visibles.length,
      mirando,
      nombres: visibles.filter((p) => p.identidad).map((p) => etiquetaCara(p.identidad, lado, en)),
      reconociendo: !!caras?.reconoce && visibles.some((p) => !p.identidad),
      en,
    });
    capa = (
      <>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {marcas.map((mk) => {
            const cara = mk.tipo === 'cara';
            let r: { left: number; top: number; width: number; height: number } | null = null;
            if (cara && e) {
              // La caja que ya calculó el nativo para esta vista (giro y espejo resueltos), si es de este cuadro.
              const p = porPista.get(mk.clave);
              const nativa = p?.ext !== undefined ? e.caras.find((c) => c.id === p.ext) : undefined;
              r = rectDeCara({ caja: nativa?.caja, foto: mk.caja }, e, m);
            } else if (dims) r = cajaEnPantalla(mk.caja, dims, m, lado === 'frontal');
            if (!r) return null;
            return (
              <View key={mk.clave} style={[styles.caja, cara ? (mk.conocida ? styles.cajaConocida : styles.cajaCara) : styles.cajaObjeto, r]}>
                <Text numberOfLines={1} style={[styles.etiqueta, r.top < 24 && styles.etiquetaDentro, cara ? (mk.conocida ? styles.etiquetaConocida : styles.etiquetaCara) : styles.etiquetaObjeto]}>
                  {mk.etiqueta}
                  {mk.detalle ? ` · ${mk.detalle}` : ''}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={styles.botones} pointerEvents="box-none">
          {onVoltear ? (
            <Pressable onPress={onVoltear} hitSlop={8} style={styles.boton} accessibilityRole="button" accessibilityLabel={tr('Cambiar de cámara', 'Switch camera')}>
              <Text style={styles.botonTexto}>{lado === 'frontal' ? tr('Trasera', 'Back') : tr('Frontal', 'Front')}</Text>
            </Pressable>
          ) : null}
          {onCerrarVista ? (
            <Pressable onPress={onCerrarVista} hitSlop={8} style={styles.boton} accessibilityRole="button" accessibilityLabel={tr('Cerrar lo que veo', 'Close what I see')}>
              <Text style={styles.botonTexto}>{tr('Cerrar', 'Close')}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.estado} pointerEvents="none">
          <Text numberOfLines={2} style={styles.estadoTexto}>
            {estado}
          </Text>
        </View>
      </>
    );
  }

  if (!activa || !montable) return null;
  // La misma vista nativa con otro estilo: no se vuelve a montar al mostrarla u ocultarla (cambiar de cámara
  // tampoco: el nativo rearma con la prop `lado`).
  return (
    <View style={marco ? [styles.vista, marco] : styles.box} pointerEvents={marco ? 'box-none' : 'none'}>
      <Vista
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        lado={lado}
        activa
        hz={ritmo.hz}
        fps={ritmo.fps}
        ladoCorto={ritmo.ladoCorto}
        minCara={MIN_CARA_MLKIT}
        onCaras={onCarasNativo}
        onEstado={onEstadoNativo}
      />
      {marco ? capa : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Casi invisible en una esquina (como la cámara de fotos): la vista previa necesita una superficie real. */
  box: { position: 'absolute', left: 0, bottom: 0, width: 96, height: 72, opacity: 0.02, overflow: 'hidden' },
  vista: {
    position: 'absolute',
    opacity: 1,
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    backgroundColor: '#000',
    zIndex: 40,
    elevation: 40,
  },
  caja: { position: 'absolute', borderWidth: 2, borderRadius: 6 },
  cajaCara: { borderColor: 'rgba(255,255,255,0.9)' },
  cajaConocida: { borderColor: T.principal },
  cajaObjeto: { borderColor: T.activo, borderStyle: 'dashed', borderRadius: 3 },
  etiqueta: { position: 'absolute', left: -2, top: -22, maxWidth: 220, fontSize: 12.5, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  etiquetaDentro: { top: 2, left: 2 },
  etiquetaCara: { color: '#111', backgroundColor: 'rgba(255,255,255,0.9)' },
  etiquetaConocida: { color: T.sobrePrincipal, backgroundColor: T.principal },
  etiquetaObjeto: { color: '#111', backgroundColor: T.activo, fontWeight: '700' },
  botones: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 8 },
  boton: { backgroundColor: 'rgba(18,19,22,0.82)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  botonTexto: { color: '#F2EEE8', fontSize: 13, fontWeight: '800' },
  estado: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(18,19,22,0.72)' },
  estadoTexto: { color: '#F2EEE8', fontSize: 13.5, fontWeight: '700', textAlign: 'center' },
});
