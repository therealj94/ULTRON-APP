/**
 * RECONOCER CARAS EN LA MESA (con permiso): une la cámara de la mesa, el motor (MotorCaras) y lo
 * guardado en el servidor (api.ts). La lógica pura (comparar, entender lo que se dice, el «sí» de la
 * persona presentada) vive en caras.ts; aquí solo se conecta.
 *
 *  · Nada corre sin que la persona lo active (Más → Caras, con la explicación de qué se guarda) y sin
 *    la cámara encendida: sin las dos cosas, el motor ni se monta.
 *  · «Conóceme» guarda la cara de la dueña; «te presento a Ana» le pregunta a Ana en voz alta si la
 *    puede recordar y solo un «sí» la guarda; «olvida a Ana», «olvida mi cara», «olvida todas las
 *    caras» borran de verdad; «¿a quién conoces?», «¿quién soy?».
 *  · Con alguien delante, cada tanto (o cuando llega alguien) se mira quién es; a un conocido se le
 *    saluda una vez por sesión, y el cerebro recibe «Reconozco a …» en la escena del turno.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { tr } from '../i18n';
import { loadSettings, saveSettings } from '../lib/storage';
import { miga } from '../lib/reporte';
import type { FrameGrabber } from '../components/CamaraVision';
import { MotorCaras, type ControlMotorCaras } from './MotorCaras';
import {
  MUESTRAS_APRENDER,
  Presentacion,
  caraDelPresentado,
  carasActivas,
  conCarasActivas,
  esConsentimiento,
  frasePresentes,
  identificar,
  masGrande,
  pedidoDeCaras,
  type CaraConocida,
  type Reconocida,
} from './caras';
import { guardarCara, listarCaras, olvidarCara, olvidarTodasLasCaras } from './api';

/** Con alguien delante, cada cuánto se mira quién es (si no llega nadie nuevo). */
const MIRAR_CADA_MS = 20_000;
/** Lo que vale lo reconocido para el cerebro. */
const FRESCO_MS = 45_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

type Opciones = {
  correo: string;
  nombre: string;
  nombreAvatar: string;
  camaraEncendida: boolean;
  mesaVisible: boolean;
  grabFrame: MutableRefObject<FrameGrabber | null>;
  /** Decirlo con la voz de la mesa (y en la burbuja). */
  decir: (texto: string, emocion?: 'feliz' | 'preocupado' | 'curioso' | 'neutral') => Promise<void>;
  /** Enciende la cámara «solo por ahora» (pide el permiso si falta). false si no se pudo. */
  encenderCamara: () => Promise<boolean>;
};

export type ApiCaras = {
  activas: boolean;
  /** Lo que se lee en «Más → Caras». */
  estadoTexto: string;
  /** El motor, para montarlo en la mesa (null cuando no hace falta). */
  motor: ReactNode;
  /** Más → Caras: activar (con la explicación) o ver / borrar / desactivar. */
  abrirOpciones: () => void;
  /** Lo dicho: si era de caras (o la respuesta a «¿te puedo recordar?»), lo atiende y devuelve true. */
  manejar: (dicho: string) => Promise<boolean>;
  /** Para la escena del turno: «Reconozco a …» (vacío si no hay nada fresco). */
  escena: () => string;
  /** La cámara vio a alguien (la escena de la mesa): se mira quién es cuando toca. */
  observar: (personas: number, llego: boolean) => void;
};

export function useCaras(o: Opciones): ApiCaras {
  const [activas, setActivas] = useState(false);
  const [conocidas, setConocidas] = useState<CaraConocida[] | null>(null);
  const [motorListo, setMotorListo] = useState(false);
  const motor = useRef<ControlMotorCaras>(null);
  const presentacion = useRef(new Presentacion()).current;
  const presentes = useRef<{ r: Reconocida[]; desconocidas: number; t: number } | null>(null);
  const saludados = useRef(new Set<string>());
  const mirando = useRef(false);
  const ultimaMirada = useRef(0);
  const op = useRef(o);
  op.current = o;
  const conocidasRef = useRef<CaraConocida[]>([]);
  conocidasRef.current = conocidas || [];

  // ¿Lo activó esta persona? (por correo, en los ajustes del teléfono)
  useEffect(() => {
    void loadSettings().then((s) => setActivas(carasActivas(s.carasActivas, o.correo)));
  }, [o.correo]);

  const refrescar = useCallback(async () => {
    try {
      const l = await listarCaras();
      setConocidas(l);
      conocidasRef.current = l;
      return l;
    } catch (e) {
      miga(`caras: no pude leer las guardadas (${String((e as Error)?.message || e).slice(0, 60)})`);
      return conocidasRef.current;
    }
  }, []);
  useEffect(() => {
    if (activas && conocidas === null) void refrescar();
  }, [activas, conocidas, refrescar]);

  const montarMotor = activas && o.camaraEncendida && o.mesaVisible;
  useEffect(() => {
    if (!montarMotor) {
      setMotorListo(false);
      presentes.current = null;
    }
  }, [montarMotor]);

  /** Fotos de la cámara → caras (vectores). Espera al motor hasta ~20 s (la primera vez baja los modelos). */
  const verCaras = useCallback(async (fotos: number) => {
    const salida: Awaited<ReturnType<ControlMotorCaras['analizar']>>[] = [];
    for (let i = 0; i < 40 && !motor.current?.listo(); i++) await dormir(500);
    if (!motor.current?.listo()) return null;
    for (let i = 0; i < fotos; i++) {
      if (i) await dormir(500);
      const b64 = await op.current.grabFrame.current?.();
      if (!b64) continue;
      salida.push(await motor.current.analizar(b64));
    }
    return salida.filter((x): x is NonNullable<typeof x> => !!x);
  }, []);

  const asegurarCamara = useCallback(async () => {
    if (op.current.camaraEncendida) return true;
    const ok = await op.current.encenderCamara();
    if (!ok) return false;
    await op.current.decir(tr('Enciendo la cámara solo por ahora.', 'Turning the camera on just for now.'));
    await dormir(1500);
    return true;
  }, []);

  const activar = useCallback(
    () =>
      new Promise<boolean>((resolver) => {
        const a = op.current;
        Alert.alert(
          tr('Reconocer caras', 'Recognize faces'),
          tr(
            `Con la cámara encendida, ${a.nombreAvatar} podrá saber que eres tú y reconocer a quien le presentes (esa persona tiene que decir que sí en voz alta).\n\nSe guardan solo números que describen la cara, nunca fotos, y solo en tu cuenta. La foto se analiza en este teléfono y se descarta.\n\nPara borrar: «olvida a Ana», «olvida mi cara», o aquí mismo.`,
            `With the camera on, ${a.nombreAvatar} can tell it’s you and recognize people you introduce (they have to say yes out loud).\n\nOnly numbers describing the face are kept, never photos, and only in your account. The photo is analyzed on this phone and discarded.\n\nTo erase: “forget Ana”, “forget my face”, or right here.`
          ),
          [
            { text: tr('Ahora no', 'Not now'), style: 'cancel', onPress: () => resolver(false) },
            {
              text: tr('Activar', 'Turn on'),
              onPress: () =>
                void (async () => {
                  const s = await loadSettings();
                  await saveSettings({ carasActivas: conCarasActivas(s.carasActivas, a.correo, true) });
                  setActivas(true);
                  miga('caras: activado por la persona');
                  resolver(true);
                })(),
            },
          ]
        );
      }),
    []
  );

  const desactivar = useCallback(async (borrar: boolean) => {
    const s = await loadSettings();
    await saveSettings({ carasActivas: conCarasActivas(s.carasActivas, op.current.correo, false) });
    setActivas(false);
    presentes.current = null;
    presentacion.terminar();
    if (borrar) {
      try {
        await olvidarTodasLasCaras();
        setConocidas([]);
      } catch {
        Alert.alert(tr('Caras', 'Faces'), tr('No pude borrar ahora; inténtalo con conexión.', 'I couldn’t erase them now; try again when online.'));
      }
    }
  }, [presentacion]);

  const confirmarBorrarTodas = useCallback(() => {
    Alert.alert(tr('¿Olvidar todas las caras?', 'Forget all faces?'), tr('Se borran de tu cuenta los números de todas las caras que conozco. No se puede deshacer.', 'The numbers for every face I know are erased from your account. This can’t be undone.'), [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      {
        text: tr('Olvidar todas', 'Forget all'),
        style: 'destructive',
        onPress: () =>
          void olvidarTodasLasCaras()
            .then((n) => {
              setConocidas([]);
              presentes.current = null;
              return op.current.decir(tr(`Listo, olvidé ${n === 1 ? 'la cara' : `las ${n} caras`} que conocía.`, `Done, I forgot ${n === 1 ? 'the face' : `the ${n} faces`} I knew.`));
            })
            .catch(() => op.current.decir(tr('No pude borrarlas ahora. Inténtalo con conexión.', 'I couldn’t erase them now. Try again when online.'), 'preocupado')),
      },
    ]);
  }, []);

  const abrirOpciones = useCallback(() => {
    if (!activas) {
      void activar();
      return;
    }
    const l = conocidasRef.current;
    const quienes = l.length ? l.map((c) => (c.relacion === 'yo' ? tr(`${c.nombre} (tú)`, `${c.nombre} (you)`) : c.nombre)).join(', ') : tr('nadie todavía', 'nobody yet');
    Alert.alert(
      tr('Reconocer caras · activado', 'Recognize faces · on'),
      tr(`Conozco a: ${quienes}.\n\nDi «conóceme» para que aprenda tu cara, o «te presento a …» para presentarme a alguien.`, `I know: ${quienes}.\n\nSay “get to know me” to learn your face, or “meet …” to introduce someone.`),
      [
        { text: tr('Olvidar todas', 'Forget all'), style: 'destructive', onPress: confirmarBorrarTodas },
        { text: tr('Desactivar', 'Turn off'), onPress: () => void desactivar(false) },
        { text: tr('Cerrar', 'Close'), style: 'cancel' },
      ]
    );
  }, [activar, activas, confirmarBorrarTodas, desactivar]);

  const buscarPorNombre = (nombre: string) => {
    const n = sinTildes(nombre);
    return conocidasRef.current.find((c) => sinTildes(c.nombre) === n) || conocidasRef.current.find((c) => sinTildes(c.nombre).includes(n) || n.includes(sinTildes(c.nombre)));
  };

  const guardarPresentado = useCallback(
    async (nombre: string, frase: string) => {
      const a = op.current;
      const vistas = (await verCaras(2)) || [];
      const conocidas0 = conocidasRef.current;
      const caras = vistas.map((c) => caraDelPresentado(c, conocidas0)).filter((c): c is NonNullable<typeof c> => !!c);
      if (!caras.length) {
        presentacion.empezar(nombre);
        await a.decir(tr(`No te veo bien, ${nombre}. Ponte frente a la cámara y dime «sí» otra vez.`, `I can’t see you well, ${nombre}. Stand in front of the camera and say “yes” again.`), 'preocupado');
        return;
      }
      try {
        await guardarCara({ nombre, relacion: 'conocido', vectores: caras.map((c) => c.vector), consentimiento: { como: 'voz', frase } });
        await refrescar();
        saludados.current.add(sinTildes(nombre));
        await a.decir(tr(`¡Mucho gusto, ${nombre}! Ya te recuerdo. Solo guardé números, no fotos.`, `Nice to meet you, ${nombre}! I’ll remember you. I only kept numbers, no photos.`), 'feliz');
      } catch (e) {
        await a.decir(tr(`No pude guardarte ahora, ${nombre}: ${String((e as Error)?.message || 'sin conexión')}`, `I couldn’t save you now, ${nombre}.`), 'preocupado');
      }
    },
    [presentacion, refrescar, verCaras]
  );

  const manejar = useCallback(
    async (dicho: string): Promise<boolean> => {
      const a = op.current;
      // 1) La respuesta a «¿te puedo recordar?»: solo un «sí» guarda.
      const nombrePendiente = presentacion.pendiente();
      if (nombrePendiente) {
        presentacion.terminar();
        const r = esConsentimiento(dicho);
        if (r === 'si') {
          await guardarPresentado(nombrePendiente, dicho);
          return true;
        }
        await a.decir(r === 'no' ? tr(`Entendido, ${nombrePendiente}: no te guardo.`, `Got it, ${nombrePendiente}: I won’t keep you.`) : tr(`Como no escuché un «sí», no guardé a ${nombrePendiente}.`, `I didn’t hear a “yes”, so I didn’t keep ${nombrePendiente}.`));
        return true;
      }
      const p = pedidoDeCaras(dicho);
      if (!p) return false;
      // Borrar y contar se puede siempre; aprender y reconocer, solo con el reconocimiento activado.
      const necesitaActivas = p.tipo === 'conoceme' || p.tipo === 'presentar' || p.tipo === 'quien';
      if (necesitaActivas && !activas) {
        await a.decir(tr('Antes tienes que activar «reconocer caras». Te explico en la pantalla qué guardo.', 'First turn on “recognize faces”. I’ll explain on screen what I keep.'));
        const si = await activar();
        if (!si) return true;
      }
      if (p.tipo !== 'conoceme' && p.tipo !== 'presentar' && p.tipo !== 'quien' && conocidas === null) await refrescar();
      switch (p.tipo) {
        case 'conoceme': {
          if (!(await asegurarCamara())) {
            await a.decir(tr('Necesito la cámara para conocerte.', 'I need the camera to get to know you.'), 'preocupado');
            return true;
          }
          await a.decir(tr('Mírame a la cámara un momento…', 'Look at the camera for a moment…'), 'curioso');
          const vistas = (await verCaras(MUESTRAS_APRENDER)) || [];
          const mias = vistas.map(masGrande).filter((c): c is NonNullable<typeof c> => !!c);
          if (mias.length < 2) {
            await a.decir(tr('No te vi bien. Ponte de frente, con luz, y dime «conóceme» otra vez.', 'I couldn’t see you well. Face the camera with some light and say “get to know me” again.'), 'preocupado');
            return true;
          }
          try {
            await guardarCara({ nombre: a.nombre, relacion: 'yo', vectores: mias.map((c) => c.vector), consentimiento: { como: 'dueño' } });
            await refrescar();
            await a.decir(tr(`Listo, ${a.nombre}: ya conozco tu cara. Guardé números, no fotos; di «olvida mi cara» para borrarla.`, `Done, ${a.nombre}: I know your face now. I kept numbers, not photos; say “forget my face” to erase it.`), 'feliz');
          } catch (e) {
            await a.decir(tr(`No pude guardarla ahora: ${String((e as Error)?.message || 'sin conexión')}`, 'I couldn’t save it now.'), 'preocupado');
          }
          return true;
        }
        case 'presentar': {
          if (!(await asegurarCamara())) {
            await a.decir(tr('Necesito la cámara para conocer a alguien.', 'I need the camera to meet someone.'), 'preocupado');
            return true;
          }
          presentacion.empezar(p.nombre);
          await a.decir(
            tr(
              `Hola, ${p.nombre}. ¿Te puedo recordar? Solo guardo unos números de tu cara, no fotos, y ${a.nombre} puede borrarlos cuando quiera. Dime «sí» o «no».`,
              `Hi, ${p.nombre}. May I remember you? I only keep some numbers from your face, not photos, and ${a.nombre} can erase them anytime. Say “yes” or “no”.`
            ),
            'curioso'
          );
          return true;
        }
        case 'olvidar':
        case 'olvidar_mia': {
          const c = p.tipo === 'olvidar_mia' ? conocidasRef.current.find((x) => x.relacion === 'yo') : buscarPorNombre(p.nombre);
          if (!c) {
            await a.decir(p.tipo === 'olvidar_mia' ? tr('No tengo guardada tu cara.', 'I don’t have your face saved.') : tr(`No conozco a ${p.nombre}.`, `I don’t know ${p.nombre}.`));
            return true;
          }
          try {
            await olvidarCara(c.id);
            await refrescar();
            presentes.current = null;
            await a.decir(p.tipo === 'olvidar_mia' ? tr('Listo, olvidé tu cara.', 'Done, I forgot your face.') : tr(`Listo, olvidé a ${c.nombre}.`, `Done, I forgot ${c.nombre}.`));
          } catch {
            await a.decir(tr('No pude borrarla ahora. Inténtalo con conexión.', 'I couldn’t erase it now. Try again when online.'), 'preocupado');
          }
          return true;
        }
        case 'olvidar_todas':
          confirmarBorrarTodas();
          await a.decir(tr('Para olvidar todas las caras, confírmalo en la pantalla.', 'To forget all faces, confirm on the screen.'));
          return true;
        case 'lista': {
          const l = conocidasRef.current;
          await a.decir(
            l.length
              ? tr(`Conozco a ${l.map((c) => (c.relacion === 'yo' ? `${c.nombre}, que eres tú` : c.nombre)).join(', ')}.`, `I know ${l.map((c) => (c.relacion === 'yo' ? `${c.nombre}, that’s you` : c.nombre)).join(', ')}.`)
              : tr('Todavía no conozco ninguna cara.', 'I don’t know any faces yet.')
          );
          return true;
        }
        case 'quien': {
          if (!a.camaraEncendida) {
            await a.decir(tr('La cámara está apagada. Dime «puedes verme» y te miro.', 'The camera is off. Say “you can see me” and I’ll look.'));
            return true;
          }
          const vistas = (await verCaras(1)) || [];
          const caras = vistas[0] || [];
          if (!caras.length) {
            await a.decir(tr('No veo a nadie frente a la cámara.', 'I don’t see anyone in front of the camera.'));
            return true;
          }
          const r = caras.map((c) => identificar(c.vector, conocidasRef.current)).filter((x): x is Reconocida => !!x);
          presentes.current = { r, desconocidas: caras.length - r.length, t: Date.now() };
          await a.decir(r.length ? `${tr('Veo a', 'I see')} ${r.map((x) => (x.relacion === 'yo' ? tr(`${x.nombre}: eres tú`, `${x.nombre}: that’s you`) : x.nombre)).join(', ')}${caras.length > r.length ? tr(', y a alguien que no conozco', ', and someone I don’t know') : ''}.` : tr('Veo a alguien que no conozco.', 'I see someone I don’t know.'));
          return true;
        }
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activar, activas, asegurarCamara, conocidas, confirmarBorrarTodas, guardarPresentado, presentacion, refrescar, verCaras]
  );

  const observar = useCallback(
    (personas: number, llego: boolean) => {
      if (!montarMotor || !motorListo || personas <= 0 || mirando.current) return;
      const ahora = Date.now();
      if (!llego && ahora - ultimaMirada.current < MIRAR_CADA_MS) return;
      if (!conocidasRef.current.length) return;
      mirando.current = true;
      ultimaMirada.current = ahora;
      void (async () => {
        try {
          const vistas = (await verCaras(1)) || [];
          const caras = vistas[0] || [];
          const r = caras.map((c) => identificar(c.vector, conocidasRef.current)).filter((x): x is Reconocida => !!x);
          presentes.current = { r, desconocidas: caras.length - r.length, t: Date.now() };
          // A un conocido presentado se le saluda una vez por sesión (a la dueña no: ya está hablando).
          const nuevo = r.find((x) => x.relacion === 'conocido' && !saludados.current.has(sinTildes(x.nombre)));
          if (nuevo) {
            saludados.current.add(sinTildes(nuevo.nombre));
            await op.current.decir(tr(`¡Hola, ${nuevo.nombre}!`, `Hi, ${nuevo.nombre}!`), 'feliz');
          }
        } finally {
          mirando.current = false;
        }
      })();
    },
    [montarMotor, motorListo, verCaras]
  );

  const escena = useCallback(() => {
    const p = presentes.current;
    if (!p || Date.now() - p.t > FRESCO_MS) return '';
    return frasePresentes(p.r, p.desconocidas);
  }, []);

  const estadoTexto = !activas ? tr('Apagado', 'Off') : conocidas?.length ? tr(`Conozco a ${conocidas.length}`, `I know ${conocidas.length}`) : tr('Activado', 'On');

  const nodoMotor = useMemo(
    () => (montarMotor ? <MotorCaras ref={motor} onEstado={(e) => setMotorListo(e === 'listo')} /> : null),
    [montarMotor]
  );

  return { activas, estadoTexto, motor: nodoMotor, abrirOpciones, manejar, escena, observar };
}
