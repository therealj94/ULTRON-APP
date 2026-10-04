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
 *  · Los sonidos son los de la app (lib/sfx.ts: respetan el ajuste «sonidos» y las llamadas) y solo con
 *    el avatar tranquilo; la vibración, con expo-haptics. Nada toca el micrófono ni la voz.
 *  · «Reducir movimiento»: el sable quieto, disparos quietos, sin sacudida (escena.ts).
 *  · Si la tapan (activo = false) o se desmonta, la secuencia se corta y no queda ningún reloj ni sonido
 *    programado.
 *  · Si el dibujo falla en el hilo de la interfaz, los efectos se apagan por el resto de la sesión (el
 *    avatar sigue igual) y queda una miga.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { playSfx } from '../../../lib/sfx';
import { miga } from '../../../lib/reporte';
import { zonaVideo, type ClipVideo } from '../guion';
import { ONDA_MS, camaraDe, encuadreDe, eventosDe, planBlasters, planEspada, planOnda, sacudida, type LugarEfectos, type Onda, type PlanBlasters, type PlanEspada, type Vibra } from './escena';
import { grabarEscena, grabarVacio } from './pintar';
import { MotorToques, type AvatarVideo, type Contexto, type Efecto, type Reaccion } from './toques';

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
  children: ReactNode;
};

/** Las ondas que pueden verse a la vez. */
const ONDAS = 3;
/** El lienzo sigue montado esto después de lo último que pintó. */
const QUEDA_MS = 3000;
/** Si el dibujo falló una vez en esta sesión, no se vuelve a intentar. */
let dibujoRoto = false;

const vibrar = (v: Vibra) => void Haptics.impactAsync(v === 'media' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export const CapaEfectos = forwardRef<ControlEfectos, Props>(function CapaEfectos({ avatar, lugar, ancho, alto, contexto, activo = true, ataque = null, onGolpe, vibrarToques = false, children }, ref) {
  const reducido = !!useReducedMotion();
  const motor = useMemo(() => new MotorToques({ avatar }), [avatar]);
  const [lienzo, setLienzo] = useState(false);
  const [roto, setRoto] = useState(dibujoRoto);

  // Lo último de cada prop, para los callbacks y relojes (sin rearmarlos en cada render de la mesa).
  const vivo = useRef({ contexto, reducido, activo, onGolpe, vibrarToques, ancho, alto, lugar, avatar });
  vivo.current = { contexto, reducido, activo, onGolpe, vibrarToques, ancho, alto, lugar, avatar };

  const tSec = useSharedValue(-1);
  const plan = useSharedValue<PlanEspada | PlanBlasters | null>(null);
  const ondas = useSharedValue<(Onda | null)[]>([null, null, null]);
  const tOnda0 = useSharedValue(-1);
  const tOnda1 = useSharedValue(-1);
  const tOnda2 = useSharedValue(-1);
  const tOndas = useMemo(() => [tOnda0, tOnda1, tOnda2] as const, [tOnda0, tOnda1, tOnda2]);
  const siguienteOnda = useRef(0);

  const relojes = useRef(new Set<ReturnType<typeof setTimeout>>());
  const despues = useCallback((ms: number, f: () => void) => {
    const r = setTimeout(() => {
      relojes.current.delete(r);
      f();
    }, ms);
    relojes.current.add(r);
  }, []);
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
    relojes.current.forEach(clearTimeout);
    relojes.current.clear();
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
  }, [ondas, plan, tOndas, tSec]);

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
      if (r.golpe) v.onGolpe?.(r.golpe);
      if (r.tipo === 'toque' && v.vibrarToques) void Haptics.selectionAsync().catch(() => {});
      if (r.tipo === 'secuencia') {
        const p = r.efecto === 'espada' ? planEspada(v.avatar, v.lugar, W, H, r.sutil, r.reducido) : planBlasters(W, H, r.sutil, r.reducido);
        plan.value = p;
        cancelAnimation(tSec);
        tSec.value = 0;
        tSec.value = withTiming(p.dur, { duration: p.dur, easing: Easing.linear });
        for (const e of eventosDe(p, r.sonido))
          despues(e.t, () => {
            if (e.sfx) playSfx(e.sfx);
            if (e.vibra) vibrar(e.vibra);
          });
        apagarCuando(p.dur);
      }
      setLienzo(true);
    },
    [apagarCuando, despues, ondas, plan, tOndas, tSec]
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
