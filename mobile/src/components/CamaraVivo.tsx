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
 *    avisa un error o no llega ningún cuadro en 8 s, `onFallo` y la mesa vuelve a la cámara de fotos.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import type { CamaraVisionProps, FrameGrabber } from './CamaraVision';
import { verCamara } from '../lib/api';
import { MIN_CARA_MLKIT, MaquinaEscena, escenaApagada, type Escena, type MotorVision } from '../lib/escena';
import { GUARDIA, UMBRALES_VIVO, eventoValido, observacionNativa, rectDeCara, ritmoNativo, tamEquivalente, type ConfigCamaraRemota, type EventoCaras } from '../lib/camaraNativa';
import { VistaCamaraNativa, fotoNativa, recorteNativo } from '../lib/auraCamara';
import { camaraMontando, camaraSana, camaraSoltada } from '../lib/guardiaCamara';
import { etiquetasDeVista, intervaloServidor, mismaEscena, type VistaCamara } from '../lib/vistaCamara';
import { cajaEnPantalla, etiquetaCara, lineaEstado, marcasEnVivo, marcoParaFoto } from '../lib/vistaEnVivo';
import { elegirPistaParaReconocer, podarIntentos, type IntentoPista } from '../caras/pistaNativa';
import { miga, reportarEstado } from '../lib/reporte';
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
const CALIDAD = { normal: 0.6, leer: 0.85, servidor: 0.5 } as const;

type CarasVivo = NonNullable<CamaraVisionProps['caras']> & { ocupado?: () => boolean; mesaOcupada?: () => boolean };

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
  remota,
  onFallo,
}: CamaraVivoProps) {
  const cb = useRef({ onEscena, onGaze, onObjects, onVista, onMotor, caras, onFallo, seguidor });
  cb.current = { onEscena, onGaze, onObjects, onVista, onMotor, caras, onFallo, seguidor };
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
  const vistaServidor = useRef<{ v: VistaCamara; ts: number } | null>(null);
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
    maquina.reiniciar();
    seguidor?.reiniciar();
    vistaServidor.current = null;
    evento.current = null;
    anunciarMotor('ninguno');
    const e = escenaApagada(Date.now());
    ultimaEscena.current = e;
    cb.current.onEscena?.(e);
    soltarMirada();
  }, [enabled, anunciarMotor, maquina, seguidor, soltarMirada]);

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
    soltarMirada();
  }, [lado, intentos, maquina, seguidor, soltarMirada]);

  // La guardia: «montando» escrito en el disco ANTES de montar la vista nativa; al soltarla con calma, se borra.
  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    // Cada vez que se monta, el «sano» se vuelve a medir desde el primer cuadro de ESTA vez.
    evento.current = null;
    void camaraMontando().then(() => {
      if (vivo) {
        ultimoEvento.current = Date.now();
        setMontable(true);
      }
    });
    return () => {
      vivo = false;
      setMontable(false);
      if (sanoTimer.current) clearTimeout(sanoTimer.current);
      sanoTimer.current = null;
      camaraSoltada();
    };
  }, [activa]);

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
    const p = elegirPistaParaReconocer(vis, intentos, ahora, { ocupado, reconoce: true, vistaAbierta: vistaRef.current, alto: (x) => x.caja.h * e.ih });
    if (!p) return;
    // Mientras la mesa piensa o habla, solo se reconoce a quien llega: los repasos de quien ya tiene nombre esperan
    // (la misma pausa que la cámara por fotos, useCaras.quiereFoto).
    if (p.identidad && c.mesaOcupada?.()) return;
    // Sin trackingId solo se puede pedir «la más grande», y eso solo vale si hay una sola cara.
    if (p.ext === undefined && vis.length > 1) return;
    pidiendo.current = true;
    const i = intentos.get(p.id);
    intentos.set(p.id, { ultimo: ahora, n: (i?.n ?? 0) + 1 });
    try {
      const r = await recorteNativo(p.ext ?? -1);
      if (!r?.b64 || !r.caja) return;
      ultimoPedido.current = Date.now();
      cb.current.caras?.recibirFoto({ b64: r.b64, cajas: [{ pista: p.id, caja: r.caja, tam: tamEquivalente(r.tam ?? p.caja.h, ladoCortoRef.current) }], ts: Date.now() });
    } finally {
      pidiendo.current = false;
    }
  }, [intentos]);

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
      ultimoEvento.current = Date.now();
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
        // Con el flujo (hasta 15 por segundo) se alisa más que con fotos.
        const a = g.activa ? 0.35 : 1;
        g.x += (esc.principal.x - g.x) * a;
        g.y += (esc.principal.y - g.y) * a;
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
        // Lo que tardó en salir el primer nombre (medido en el teléfono, una vez por sesión).
        if (!nombreMedido.current) {
          const p = s.visibles(e.ts).find((x) => x.identidad);
          if (p) {
            nombreMedido.current = true;
            reportarEstado(`cámara nueva: primer nombre ${p.identidad!.desde - p.nacio} ms después de ver la cara (ML Kit ${e.ms} ms, ${e.fps} cuadros/s)`);
          }
        }
        if (cb.current.caras?.reconoce) void intentarReconocer();
      }
      if (vistaRef.current) setTic((n) => n + 1);
    },
    [anunciarMotor, emitir, intentarReconocer, maquina]
  );

  const onEstadoNativo = useCallback(
    (ev: { nativeEvent: unknown }) => {
      const m = (ev?.nativeEvent || {}) as { tipo?: string; codigo?: string; motivo?: string };
      if (m.tipo === 'lista') miga(`cámara nueva: abierta (${ladoRef.current})`);
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

  // Lo que hay en la mesa (servidor): el mismo ritmo que la cámara de fotos con ML Kit.
  useEffect(() => {
    if (!activa || !montable) return;
    let vivo = true;
    let ultimo = 0;
    let sinCambios = 0;
    let personasAntes = -1;
    let vistaAntes: VistaCamara | null = null;
    let subiendo = false;
    const t = setInterval(() => {
      if (!vivo || subiendo) return;
      const personas = ultimaEscena.current?.personas ?? 0;
      if (personasAntes >= 0 && personas !== personasAntes) sinCambios = 0;
      personasAntes = personas;
      const cada = intervaloServidor({ mlkit: true, dormida: dormidoRef.current, conPersona: personas > 0, necesitaEscena: observarRef.current, sinCambios });
      if (!(Date.now() - ultimo >= cada)) return;
      ultimo = Date.now();
      subiendo = true;
      void (async () => {
        try {
          const f = await conTope(fotoNativa(CALIDAD.servidor, true), FOTO_MAX_MS);
          if (!vivo || !f?.b64 || f.b64.length < MINIMO_FOTO) return;
          const r = await verCamara(f.b64, 'escena');
          if (!vivo || !r?.vista) return;
          sinCambios = mismaEscena(vistaAntes, r.vista) ? sinCambios + 1 : 0;
          vistaAntes = r.vista;
          vistaServidor.current = { v: r.vista, ts: Date.now() };
          const labels = etiquetasDeVista(r.vista);
          if (labels.length) cb.current.onObjects?.(labels);
          cb.current.onVista?.(r.vista);
        } catch {
          /* sin vista esta vez */
        } finally {
          subiendo = false;
        }
      })();
    }, 1000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [activa, montable]);

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
    const marcas = marcasEnVivo({ pistas: visibles, mirando, lado, vista: vistaServidor.current, ahora, en });
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
