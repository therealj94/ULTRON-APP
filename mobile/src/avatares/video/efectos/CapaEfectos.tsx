/**
 * LA CAPA DE EFECTOS sobre Claudio y ANT-ONIO en video: envuelve su cuerpo (CuerpoVideo, sin tocarlo) y
 * pinta encima, con Skia, lo que piden los toques (toques.ts): la onda de cada toque, el sable de luz y
 * los blasters, con sus sonidos, la vibración y la sacudida de la pantalla.
 *
 *  · No toma el dedo: todo va con pointerEvents="none". Quien la monta le pasa cada toque (`tocar(x, y)`,
 *    por la ref) desde su propio Pressable o desde un observador que no se queda con el toque; los
 *    botones de alrededor siguen igual.
 *  · Cada cuadro se dibuja en el hilo de la interfaz (un worklet graba un SkPicture con el tiempo de la
 *    secuencia, que anima Reanimated): React no se re-renderiza durante la animación. El lienzo solo está
 *    montado mientras hay algo que pintar.
 *  · Una secuencia a la vez, y el descanso entre una y otra, los decide el motor (toques.ts).
 *  · El sable en la mesa vertical sale cuando la mano del video está en su lugar, y mientras tanto el
 *    video se queda con su clip; si no, sale desde el borde (agenda.ts, con `cuerpo`: la ref de CuerpoVideo).
 *  · Los sonidos son los de la app (lib/sfx.ts: respetan el ajuste «sonidos» y las llamadas) y solo con
 *    el avatar tranquilo; la vibración, la de la app (ui/hapticos.ts: respeta el ajuste «Vibración»).
 *    Nada toca el micrófono ni la voz.
 *  · «Reducir movimiento»: el sable quieto, disparos quietos, sin sacudida (escena.ts).
 *  · Si la tapan (activo = false), se desmonta o cambia de tamaño o de lugar (girar el teléfono: el sable
 *    quedaría fuera de la mano), la secuencia se corta, el video deja de sostener su clip y no queda ningún
 *    reloj ni sonido programado (todos van en la agenda).
 *  · Si el dibujo falla en el hilo de la interfaz, los efectos se apagan por el resto de la sesión (el
 *    avatar sigue igual) y queda una miga.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { playSfx } from '../../../lib/sfx';
import { vibrar as vibrarApp } from '../../../ui/hapticos';
import { miga } from '../../../lib/reporte';
import { zonaVideo, type ClipVideo } from '../guion';
import { Agenda, GolpesDeToque, sacarSable, type Cuerpo } from './agenda';
import { ONDA_MS, camaraDe, encuadreDe, eventosDe, planBlasters, planEspada, planOnda, sacudida, type LugarEfectos, type Onda, type PlanBlasters, type PlanEspada, type Vibra } from './escena';
import { grabarEscena, grabarVacio } from './pintar';
import { MotorToques, duracionEfecto, type AvatarVideo, type Contexto, type Efecto, type Reaccion } from './toques';

export type ControlEfectos = {
  /** Un toque en (x, y) de la caja. Devuelve lo que hizo (null: apagada o tapada). */
  tocar: (x: number, y: number) => Reaccion | null;
};

type Props = {
  avatar: AvatarVideo;
  /** La mesa vertical (cuerpo), acostada (retrato) o el círculo de la llamada. */
  lugar: LugarEfectos;
  ancho: number;
  alto: number;
  /** Cómo está el avatar (habla, oye, piensa, duerme, conversación…). «Reducir movimiento» lo mira la capa. */
  contexto: Omit<Contexto, 'reducido'>;
  /** false: tapada (otra pantalla, la llamada encima): nada se pinta y lo que estaba se corta. */
  activo?: boolean;
  /** La app disparó su blaster o su sable (DeskScreen: `attack`): se ve lo mismo, sin sonido propio. */
  ataque?: 'saber' | 'blaster' | null;
  /** Un golpe del video que acompaña a la reacción (pistas.ts, `pedirGolpe`). */
  onGolpe?: (clip: ClipVideo) => void;
  /** Vibrar suave con cada toque (la mesa ya vibra en su onTap; la llamada no). */
  vibrarToques?: boolean;
  /** El cuerpo en video (la ref de CuerpoVideo): dónde está la mano para el sable y quedarse con el clip. */
  cuerpo?: RefObject<Cuerpo | null>;
  children: ReactNode;
};

/** Las ondas que pueden verse a la vez. */
const ONDAS = 3;
/** El lienzo sigue montado esto después de lo último que pintó. */
const QUEDA_MS = 3000;
/** Si el dibujo falló una vez en esta sesión, no se vuelve a intentar. */
let dibujoRoto = false;

const vibrar = (v: Vibra) => vibrarApp(v === 'media' ? 'medio' : 'suave');

export const CapaEfectos = forwardRef<ControlEfectos, Props>(function CapaEfectos({ avatar, lugar, ancho, alto, contexto, activo = true, ataque = null, onGolpe, vibrarToques = false, cuerpo, children }, ref) {
  const reducido = !!useReducedMotion();
  const motor = useMemo(() => new MotorToques({ avatar }), [avatar]);
  const [lienzo, setLienzo] = useState(false);
  const [roto, setRoto] = useState(dibujoRoto);

  // Lo último de cada prop, para los callbacks y relojes (sin rearmarlos en cada render de la mesa).
  const vivo = useRef({ contexto, reducido, activo, onGolpe, vibrarToques, ancho, alto, lugar, avatar, cuerpo });
  vivo.current = { contexto, reducido, activo, onGolpe, vibrarToques, ancho, alto, lugar, avatar, cuerpo };

  const tSec = useSharedValue(-1);
  const plan = useSharedValue<PlanEspada | PlanBlasters | null>(null);
  const ondas = useSharedValue<(Onda | null)[]>([null, null, null]);
  const tOnda0 = useSharedValue(-1);
  const tOnda1 = useSharedValue(-1);
  const tOnda2 = useSharedValue(-1);
  const tOndas = useMemo(() => [tOnda0, tOnda1, tOnda2] as const, [tOnda0, tOnda1, tOnda2]);
  const siguienteOnda = useRef(0);

  const agenda = useMemo(() => new Agenda(), []);
  const despues = useCallback((ms: number, f: () => void) => agenda.despues(ms, f), [agenda]);
  const golpes = useMemo(() => new GolpesDeToque(agenda, (clip) => vivo.current.onGolpe?.(clip)), [agenda]);
  /** Suelta el clip que el video sostiene por el sable (si lo hay). */
  const soltarCuerpo = useRef<() => void>(() => {});
  /** La secuencia cuyos sonidos siguen valiendo (un sable cortado antes ya no suena). */
  const sonando = useRef<object | null>(null);
  /**
   * Hasta cuándo queda el lienzo montado: lo que dura lo pintado y un rato más (QUEDA_MS), para que una
   * seguidilla de toques no lo monte y desmonte en cada uno. Quieto no gasta: el cuadro solo se vuelve a
   * grabar cuando cambia un tiempo.
   */
  const fin = useRef(0);
  const apagarCuando = useCallback(
    (ms: number) => {
      fin.current = Math.max(fin.current, Date.now() + ms + QUEDA_MS);
      despues(ms + QUEDA_MS + 20, () => {
        if (Date.now() < fin.current) return;
        plan.value = null;
        tSec.value = -1;
        setLienzo(false);
      });
    },
    [despues, plan, tSec]
  );

  /** Corta todo: relojes, animaciones, lo pintado. */
  const cortar = useCallback(() => {
    agenda.cortar();
    golpes.olvidar();
    sonando.current = null;
    soltarCuerpo.current();
    soltarCuerpo.current = () => {};
    cancelAnimation(tSec);
    tOndas.forEach((t) => {
      cancelAnimation(t);
      t.value = -1;
    });
    tSec.value = -1;
    plan.value = null;
    ondas.value = [null, null, null];
    fin.current = 0;
    setLienzo(false);
  }, [agenda, golpes, ondas, plan, tOndas, tSec]);

  const hacer = useCallback(
    (r: Reaccion) => {
      const v = vivo.current;
      const W = v.ancho;
      const H = v.alto;
      if (r.x >= 0) {
        const i = siguienteOnda.current++ % ONDAS;
        const lista = ondas.value.slice();
        lista[i] = planOnda(v.avatar, W, H, r.x, r.y, { sutil: r.sutil, reducido: r.reducido, molesto: r.tipo === 'molesto' });
        ondas.value = lista;
        tOndas[i].value = 0;
        tOndas[i].value = withTiming(ONDA_MS, { duration: ONDA_MS, easing: Easing.linear });
        apagarCuando(ONDA_MS);
      }
      // El golpe del video: el de la ráfaga, ya; el de un toque suelto, cuando el dedo se queda quieto.
      golpes.toque(r);
      if (r.tipo === 'toque' && v.vibrarToques) vibrarApp('seleccion');
      if (r.tipo === 'secuencia') {
        const empezar = (p: PlanEspada | PlanBlasters) => {
          const yo = {};
          sonando.current = yo;
          plan.value = p;
          cancelAnimation(tSec);
          tSec.value = 0;
          tSec.value = withTiming(p.dur, { duration: p.dur, easing: Easing.linear });
          for (const e of eventosDe(p, r.sonido))
            despues(e.t, () => {
              if (sonando.current !== yo) return;
              if (e.sfx) playSfx(e.sfx);
              if (e.vibra) vibrar(e.vibra);
            });
          apagarCuando(p.dur);
          motor.mostrar(Date.now(), p.efecto, p.dur);
          setLienzo(true);
        };
        if (r.efecto === 'blasters') empezar(planBlasters(W, H, r.sutil, r.reducido));
        else {
          // Lo de antes se suelta (una secuencia a la vez: lo anterior ya terminó o lo pidió la mesa encima).
          soltarCuerpo.current();
          soltarCuerpo.current = sacarSable(agenda, {
            ahora: Date.now,
            lugar: v.lugar,
            sutil: r.sutil,
            externo: r.externo,
            necesitaMs: duracionEfecto('espada', r.sutil, r.reducido),
            cuerpo: v.cuerpo?.current ?? null,
            // Con el tamaño de ahora (la espera pudo durar un poco).
            arrancar: (a) => empezar(planEspada(vivo.current.avatar, vivo.current.lugar, vivo.current.ancho, vivo.current.alto, r.sutil, r.reducido, a.anclaje)),
            // La mano se va igual: el sable se desvanece ya (CORTE_MS) y lo que faltaba sonar no suena.
            cortar: () => {
              const p = plan.value;
              if (p?.efecto !== 'espada') return;
              sonando.current = null;
              plan.value = { ...p, corte: Math.max(0, tSec.value) };
            },
          });
        }
      }
      setLienzo(true);
    },
    [agenda, apagarCuando, despues, golpes, motor, ondas, plan, tOndas, tSec]
  );

  const tocar = useCallback(
    (x: number, y: number): Reaccion | null => {
      const v = vivo.current;
      if (!v.activo || dibujoRoto || v.ancho <= 0 || v.alto <= 0) return null;
      const zona = zonaVideo(y, encuadreDe(v.avatar, camaraDe(v.lugar), v.ancho, v.alto), v.avatar);
      const r = motor.tocar(Date.now(), { ...v.contexto, reducido: v.reducido }, zona, x, y);
      hacer(r);
      return r;
    },
    [hacer, motor]
  );
  useImperativeHandle(ref, () => ({ tocar }), [tocar]);

  // La app disparó su blaster o su sable: lo mismo en el video (sin apilarse sobre uno en curso).
  useEffect(() => {
    const v = vivo.current;
    if (!ataque || !v.activo || dibujoRoto) return;
    const efecto: Efecto = ataque === 'saber' ? 'espada' : 'blasters';
    const r = motor.ataque(Date.now(), efecto, { ...v.contexto, reducido: v.reducido });
    if (r) hacer(r);
  }, [ataque, hacer, motor]);

  // Tapada: se corta lo que estuviera pasando.
  useEffect(() => {
    if (activo) return;
    motor.cancelar(Date.now());
    cortar();
  }, [activo, cortar, motor]);
  // Otro tamaño u otro lugar (girar el teléfono, otra cámara): lo pintado quedaría corrido; se corta.
  const medida = `${ancho}x${alto}:${lugar}`;
  const medidaAntes = useRef(medida);
  useEffect(() => {
    if (medidaAntes.current === medida) return;
    medidaAntes.current = medida;
    motor.cancelar(Date.now());
    cortar();
  }, [medida, cortar, motor]);
  // Al irse: ningún reloj ni sonido queda programado.
  useEffect(() => () => cortar(), [cortar]);

  const fallo = useSharedValue(false);
  const alFallar = useCallback((motivo: string) => {
    dibujoRoto = true;
    miga(`avatar en video: los efectos se apagan (${motivo.slice(0, 80)})`);
    setRoto(true);
  }, []);
  const circulo = lugar === 'llamada';
  // Las dependencias llevan también los valores compartidos: en el teléfono el plugin de worklets ya los
  // ve, pero en la web (el banco de capturas, sin plugin) es lo que hace que el cuadro se vuelva a grabar.
  const cuadro = useDerivedValue(() => {
    if (fallo.value) return grabarVacio(Skia);
    try {
      return grabarEscena(Skia, ancho, alto, { plan: plan.value, t: tSec.value, ondas: ondas.value, tOndas: [tOnda0.value, tOnda1.value, tOnda2.value], circulo });
    } catch (e) {
      fallo.value = true;
      const motivo = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
      scheduleOnRN(alFallar, `dibujo: ${motivo}`);
      return grabarVacio(Skia);
    }
  }, [ancho, alto, circulo, plan, tSec, ondas, tOnda0, tOnda1, tOnda2, fallo, alFallar]);

  const estiloSacudida = useAnimatedStyle(() => {
    const s = sacudida(plan.value, tSec.value);
    return { transform: [{ translateX: s.x }, { translateY: s.y }, { scale: s.k }] };
  }, [plan, tSec]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, estiloSacudida]} pointerEvents="none">
        {children}
      </Animated.View>
      {lienzo && !roto && activo && ancho > 0 && alto > 0 ? (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Picture picture={cuadro} />
        </Canvas>
      ) : null}
    </View>
  );
});
