/**
 * RECONOCER CARAS EN LA MESA (con permiso): une la cámara de la mesa, el motor (MotorCaras) y lo
 * guardado en el servidor (api.ts). La lógica pura (comparar, entender lo que se dice, el «sí» de la
 * persona presentada, elegir muestras, aprender con el uso) vive en caras.ts; seguir las caras entre
 * fotos y votar quién es, en seguimiento.ts. Aquí solo se conecta.
 *
 *  · Nada corre sin que la persona lo active (Más → Caras, con la explicación de qué se guarda) y sin
 *    la cámara encendida: sin las dos cosas, el motor ni se monta.
 *  · «Conóceme» guarda la cara de la dueña con 5 muestras de poses dichas en voz alta (de frente, un poco
 *    a cada lado…); «te presento a mi esposa Ana» le pregunta a Ana en voz alta si la puede recordar y
 *    solo un «sí» la guarda (con el parentesco); «olvida a Ana», «olvida mi cara», «olvida todas las
 *    caras» borran de verdad; «¿a quién conoces?», «¿quién soy?».
 *  · Reconocer (José, 5-oct: «le costó reconocer»): el bucle de la cámara ofrece SU foto (no se toma otra)
 *    con las cajas de ML Kit; el motor analiza un recorte agrandado de cada cara y cada resultado es un
 *    voto para esa cara (`Seguidor`). El nombre sale con 2 de 3 votos. Ritmo: enseguida al llegar alguien,
 *    ~2,5 s con la vista «Lo que veo» abierta o con alguien sin nombre, ~8 s si no (antes, cada 20 s).
 *    Sin ML Kit (respaldo del servidor), la foto de cada subida va entera al motor (`recibirFotoRespaldo`).
 *    El nombre sale enseguida con UN reconocimiento muy seguro (seguimiento.ts RAPIDO; José, 6-oct: «tarda en
 *    reconocer»). Mientras la mesa piensa o habla (vista cerrada) no se reconoce, salvo a quien llega: así la voz no se
 *    queda atrás (lib/camaraModo.ts ritmoFotos).
 *  · Aprende con el uso: con un reconocimiento muy seguro y ya confirmado por 2 votos, a veces suma esa toma a la
 *    persona (servidor, con tope y quitando la más redundante): se adapta a la luz y a los lentes.
 *  · A un conocido se le saluda una vez por sesión, y el cerebro recibe «Reconozco a Ana (tu esposa)».
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { tr } from '../i18n';
import { loadSettings, saveSettings } from '../lib/storage';
import { miga } from '../lib/reporte';
import { estadisticaCamara } from '../lib/estadisticaCamara';
import type { FrameGrabber } from '../components/CamaraVision';
import type { Lado } from '../lib/vistaEnVivo';
import { MotorCaras, type ControlMotorCaras } from './MotorCaras';
import {
  MUESTRAS_APRENDER,
  POSES,
  Presentacion,
  caraDelPresentado,
  carasActivas,
  conCarasActivas,
  debeAprender,
  elegirMuestras,
  esConsentimiento,
  frasePresentes,
  identificar,
  masGrande,
  pedidoDeCaras,
  sumarMuestras,
  type CaraConocida,
  type CaraVista,
  type Reconocida,
} from './caras';
import { CONFIRMAR, Seguidor, VistoRespaldo, tocaReconocer, tocaReconocerRespaldo, type CajaN } from './seguimiento';
import { guardarCara, listarCaras, olvidarCara, olvidarTodasLasCaras, sumarMuestrasCara } from './api';

/** Lo que vale lo reconocido para el cerebro (visto hace menos que esto). */
const FRESCO_MS = 10_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

type Opciones = {
  correo: string;
  nombre: string;
  nombreAvatar: string;
  camaraEncendida: boolean;
  mesaVisible: boolean;
  grabFrame: MutableRefObject<FrameGrabber | null>;
  /** La cámara en uso (con la trasera, la escena lo dice). */
  lado: Lado;
  /** «Lo que veo» abierto: se mira quién es más seguido. */
  vistaAbierta: boolean;
  /** Decirlo con la voz de la mesa (y en la burbuja). */
  decir: (texto: string, emocion?: 'feliz' | 'preocupado' | 'curioso' | 'neutral') => Promise<void>;
  /** Enciende la cámara «solo por ahora» (pide el permiso si falta). false si no se pudo. */
  encenderCamara: () => Promise<boolean>;
  /** La mesa piensa o habla: con la vista cerrada no se reconoce (salvo a quien llega). */
  ocupada?: () => boolean;
};

/** La foto del bucle de la cámara (base64) con las caras que ML Kit vio en ELLA, por pista. */
export type FotoCaras = { b64: string; cajas: { pista: number; caja: CajaN }[]; ts: number };

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
  /** Las caras de la cámara entre fotos, con su nombre votado (lo actualiza CamaraVision, lo dibuja «Lo que veo»). */
  seguidor: Seguidor;
  /** Reconocer está andando (activado, motor listo y alguien guardado): sin esto, nadie tiene nombre. */
  reconoce: boolean;
  /** ¿Quiere la foto de este ciclo del bucle? (ya con las pistas de esa foto en `seguidor`). */
  quiereFoto: (ts: number) => boolean;
  /** La foto del bucle para reconocer: se analiza y se suelta. */
  recibirFoto: (f: FotoCaras) => void;
  /** Sin ML Kit (respaldo del servidor): ¿quiere la foto entera para reconocer? (cada RESPALDO.cadaMs) */
  quiereFotoRespaldo: (ts: number) => boolean;
  /** La foto del respaldo, sin cajas: el motor busca las caras; lo que sale va a la escena un rato. */
  recibirFotoRespaldo: (f: { b64: string; ts: number }) => void;
};

export function useCaras(o: Opciones): ApiCaras {
  const [activas, setActivas] = useState(false);
  const [conocidas, setConocidas] = useState<CaraConocida[] | null>(null);
  const [motorListo, setMotorListo] = useState(false);
  const motor = useRef<ControlMotorCaras>(null);
  const presentacion = useRef(new Presentacion()).current;
  /** El parentesco dicho al presentar («mi esposa Ana»), hasta su «sí». */
  const parentescoPendiente = useRef<string | undefined>(undefined);
  const seguidor = useRef(new Seguidor()).current;
  /** Sin ML Kit no hay pistas: lo que vio la última foto del respaldo (revisión del 5-oct, M3). */
  const respaldo = useRef(new VistoRespaldo()).current;
  const saludados = useRef(new Set<string>());
  const analizando = useRef(false);
  const ultimaMirada = useRef(0);
  /** Aprender con el uso: cuándo se sumó la última muestra a cada persona y cuántas en esta sesión. */
  const aprendido = useRef(new Map<string, { t: number; n: number }>());
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
      seguidor.olvidar();
      respaldo.olvidar();
    }
  }, [montarMotor, respaldo, seguidor]);
  const reconoce = montarMotor && motorListo && !!conocidas?.length;
  const reconoceRef = useRef(reconoce);
  reconoceRef.current = reconoce;

  /** Espera al motor hasta ~20 s (la primera vez baja los modelos). */
  const esperarMotor = useCallback(async () => {
    for (let i = 0; i < 40 && !motor.current?.listo(); i++) await dormir(500);
    return !!motor.current?.listo();
  }, []);

  /** Fotos de la cámara → caras (vectores), con una foto aparte (grabFrame, con el candado de la cámara). */
  const verCaras = useCallback(async (fotos: number) => {
    const salida: CaraVista[][] = [];
    if (!(await esperarMotor())) return null;
    for (let i = 0; i < fotos; i++) {
      if (i) await dormir(500);
      const b64 = await op.current.grabFrame.current?.();
      if (!b64) continue;
      const r = await motor.current!.analizar(b64);
      if (r) salida.push(r);
    }
    return salida;
  }, [esperarMotor]);

  /**
   * Las tomas para aprender una cara: una pose a la vez, dicha en voz alta, y dos fotos por pose. De
   * cada foto, la cara que dice `elegir` (la de la dueña, o la de quien presenta).
   */
  const tomarPoses = useCallback(
    async (elegir: (caras: CaraVista[]) => CaraVista | null) => {
      if (!(await esperarMotor())) return [];
      const tomas: CaraVista[] = [];
      for (const pose of POSES) {
        await op.current.decir(tr(pose.es, pose.en), 'curioso');
        await dormir(400);
        for (let k = 0; k < 2; k++) {
          if (k) await dormir(350);
          const b64 = await op.current.grabFrame.current?.();
          if (!b64) continue;
          const caras = await motor.current?.analizar(b64);
          const c = caras && elegir(caras);
          if (c) tomas.push(c);
        }
      }
      return elegirMuestras(tomas, MUESTRAS_APRENDER);
    },
    [esperarMotor]
  );

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
    seguidor.olvidar();
    respaldo.olvidar();
    presentacion.terminar();
    if (borrar) {
      try {
        await olvidarTodasLasCaras();
        setConocidas([]);
      } catch {
        Alert.alert(tr('Caras', 'Faces'), tr('No pude borrar ahora; inténtalo con conexión.', 'I couldn’t erase them now; try again when online.'));
      }
    }
  }, [presentacion, seguidor]);

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
              seguidor.olvidar();
              respaldo.olvidar();
              return op.current.decir(tr(`Listo, olvidé ${n === 1 ? 'la cara' : `las ${n} caras`} que conocía.`, `Done, I forgot ${n === 1 ? 'the face' : `the ${n} faces`} I knew.`));
            })
            .catch(() => op.current.decir(tr('No pude borrarlas ahora. Inténtalo con conexión.', 'I couldn’t erase them now. Try again when online.'), 'preocupado')),
      },
    ]);
  }, [seguidor]);

  const abrirOpciones = useCallback(() => {
    if (!activas) {
      void activar();
      return;
    }
    const l = conocidasRef.current;
    const quienes = l.length ? l.map((c) => (c.relacion === 'yo' ? tr(`${c.nombre} (tú)`, `${c.nombre} (you)`) : c.parentesco ? `${c.nombre} (${c.parentesco})` : c.nombre)).join(', ') : tr('nadie todavía', 'nobody yet');
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
    async (nombre: string, frase: string, parentesco?: string) => {
      const a = op.current;
      await a.decir(tr(`Gracias, ${nombre}. Te pido unas poses para aprender bien tu cara.`, `Thanks, ${nombre}. A few poses so I learn your face well.`), 'feliz');
      const conocidas0 = conocidasRef.current;
      const caras = await tomarPoses((cs) => caraDelPresentado(cs, conocidas0));
      if (!caras.length) {
        presentacion.empezar(nombre);
        parentescoPendiente.current = parentesco;
        await a.decir(tr(`No te veo bien, ${nombre}. Ponte frente a la cámara y dime «sí» otra vez.`, `I can’t see you well, ${nombre}. Stand in front of the camera and say “yes” again.`), 'preocupado');
        return;
      }
      try {
        await guardarCara({ nombre, relacion: 'conocido', vectores: caras.map((c) => c.vector), consentimiento: { como: 'voz', frase }, ...(parentesco ? { parentesco } : {}) });
        await refrescar();
        saludados.current.add(sinTildes(nombre));
        await a.decir(tr(`¡Mucho gusto, ${nombre}! Ya te recuerdo. Solo guardé números, no fotos.`, `Nice to meet you, ${nombre}! I’ll remember you. I only kept numbers, no photos.`), 'feliz');
      } catch (e) {
        await a.decir(tr(`No pude guardarte ahora, ${nombre}: ${String((e as Error)?.message || 'sin conexión')}`, `I couldn’t save you now, ${nombre}.`), 'preocupado');
      }
    },
    [presentacion, refrescar, tomarPoses]
  );

  const manejar = useCallback(
    async (dicho: string): Promise<boolean> => {
      const a = op.current;
      // 1) La respuesta a «¿te puedo recordar?»: solo un «sí» guarda.
      const nombrePendiente = presentacion.pendiente();
      if (nombrePendiente) {
        presentacion.terminar();
        const parentesco = parentescoPendiente.current;
        parentescoPendiente.current = undefined;
        const r = esConsentimiento(dicho);
        if (r === 'si') {
          await guardarPresentado(nombrePendiente, dicho, parentesco);
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
          await a.decir(tr('Te voy a pedir unas poses para aprender bien tu cara. Mira a la cámara.', 'I’ll ask for a few poses to learn your face well. Look at the camera.'), 'curioso');
          const mias = await tomarPoses(masGrande);
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
          parentescoPendiente.current = p.parentesco;
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
            seguidor.olvidar(c.id);
            respaldo.olvidar(c.id);
            aprendido.current.delete(c.id);
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
              ? tr(`Conozco a ${l.map((c) => (c.relacion === 'yo' ? `${c.nombre}, que eres tú` : c.parentesco ? `${c.nombre}, tu ${c.parentesco}` : c.nombre)).join(', ')}.`, `I know ${l.map((c) => (c.relacion === 'yo' ? `${c.nombre}, that’s you` : c.parentesco ? `${c.nombre}, your ${c.parentesco}` : c.nombre)).join(', ')}.`)
              : tr('Todavía no conozco ninguna cara.', 'I don’t know any faces yet.')
          );
          return true;
        }
        case 'quien': {
          if (!a.camaraEncendida) {
            await a.decir(tr('La cámara está apagada. Dime «puedes verme» y te miro.', 'The camera is off. Say “you can see me” and I’ll look.'));
            return true;
          }
          // Lo ya confirmado por votos (fresco) basta; si no hay, una foto aparte.
          const ya = seguidor.presentes(Date.now(), 3000);
          let r: Pick<Reconocida, 'nombre' | 'relacion'>[] = ya.r;
          let total = ya.r.length + ya.desconocidas;
          if (!ya.r.length) {
            const caras = ((await verCaras(1)) || [])[0] || [];
            r = caras.map((c) => identificar(c.vector, conocidasRef.current)).filter((x): x is Reconocida => !!x);
            total = caras.length;
          }
          if (!total) {
            await a.decir(tr('No veo a nadie frente a la cámara.', 'I don’t see anyone in front of the camera.'));
            return true;
          }
          await a.decir(r.length ? `${tr('Veo a', 'I see')} ${r.map((x) => (x.relacion === 'yo' ? tr(`${x.nombre}: eres tú`, `${x.nombre}: that’s you`) : x.nombre)).join(', ')}${total > r.length ? tr(', y a alguien que no conozco', ', and someone I don’t know') : ''}.` : tr('Veo a alguien que no conozco.', 'I see someone I don’t know.'));
          return true;
        }
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activar, activas, asegurarCamara, conocidas, confirmarBorrarTodas, guardarPresentado, presentacion, refrescar, seguidor, tomarPoses, verCaras]
  );

  const quiereFoto = useCallback(
    (ts: number) => {
      if (!reconoceRef.current || analizando.current || !motor.current?.listo() || !seguidor.visibles(ts).length) return false;
      const o = {
        ahora: ts,
        ultima: ultimaMirada.current,
        nueva: seguidor.hayNueva(),
        porConfirmar: seguidor.porConfirmar(ts),
        vistaAbierta: op.current.vistaAbierta,
        sinIdentificar: seguidor.sinIdentificar(ts),
        ocupado: analizando.current,
      };
      if (tocaReconocer({ ...o, mesaOcupada: !!op.current.ocupada?.() })) return true;
      // Le tocaba, pero la mesa pensaba o hablaba: queda en el resumen de la cámara («pausa»).
      if (tocaReconocer(o)) estadisticaCamara.saltada();
      return false;
    },
    [seguidor]
  );

  /** Aprender con el uso (ver caras.ts debeAprender): suma la toma a la persona, sin molestar si falla. */
  const aprender = useCallback(async (r: Reconocida, vector: number[]) => {
    const a = aprendido.current.get(r.id) || { t: 0, n: 0 };
    aprendido.current.set(r.id, { t: Date.now(), n: a.n + 1 });
    try {
      const muestras = await sumarMuestrasCara(r.id, [vector]);
      const nuevas = conocidasRef.current.map((c) => (c.id === r.id ? { ...c, vectores: sumarMuestras(c.vectores, [vector]) } : c));
      conocidasRef.current = nuevas;
      setConocidas(nuevas);
      miga(`caras: aprendí otra toma de ${r.relacion === 'yo' ? 'la dueña' : 'un conocido'} (d ${r.distancia}, ${muestras} muestras)`);
    } catch (e) {
      miga(`caras: no pude sumar la muestra (${String((e as Error)?.message || e).slice(0, 60)})`);
    }
  }, []);

  const recibirFoto = useCallback(
    (f: FotoCaras) => {
      if (analizando.current || !motor.current?.listo() || !f.cajas.length) return;
      analizando.current = true;
      ultimaMirada.current = f.ts;
      seguidor.tomarNueva();
      void (async () => {
        try {
          const caras = await motor.current?.analizar(f.b64, f.cajas.map((c) => c.caja));
          if (!caras) return;
          for (const c of caras) {
            const de = typeof c.indice === 'number' ? f.cajas[c.indice] : null;
            if (!de) continue;
            const r = identificar(c.vector, conocidasRef.current);
            const v = seguidor.votar(de.pista, r, f.ts);
            // A un conocido presentado se le saluda una vez por sesión (a la dueña no: ya está hablando).
            if (v.confirmo && v.identidad?.relacion === 'conocido' && !saludados.current.has(sinTildes(v.identidad.nombre))) {
              saludados.current.add(sinTildes(v.identidad.nombre));
              void op.current.decir(tr(`¡Hola, ${v.identidad.nombre}!`, `Hi, ${v.identidad.nombre}!`), 'feliz');
            }
            const a = r ? aprendido.current.get(r.id) : undefined;
            // Aprender pide la identidad confirmada por 2 votos: el nombre rápido de un solo voto no basta para guardar.
            const confirmada = v.identidad?.id === r?.id && v.aFavor >= CONFIRMAR;
            if (r && debeAprender(r, { confirmada, tam: de.caja.h, ahora: Date.now(), ultima: a?.t, enSesion: a?.n || 0 })) void aprender(r, c.vector);
          }
        } finally {
          analizando.current = false;
        }
      })();
    },
    [aprender, seguidor]
  );

  /**
   * Sin ML Kit (respaldo del servidor): la foto entera de cada subida (12 s; 30 s dormida), sin cajas. El
   * motor busca las caras; sin votos (no hay pistas), cada toma vale por sí sola para la escena un rato
   * (RESPALDO.frescoMs). Antes, sin ML Kit no se reconocía a nadie de forma continua.
   */
  const quiereFotoRespaldo = useCallback(
    (ts: number) => tocaReconocerRespaldo({ ahora: ts, ultima: ultimaMirada.current, ocupado: analizando.current || !motor.current?.listo(), reconoce: reconoceRef.current }),
    []
  );
  const recibirFotoRespaldo = useCallback(
    (f: { b64: string; ts: number }) => {
      if (analizando.current || !motor.current?.listo()) return;
      analizando.current = true;
      ultimaMirada.current = f.ts;
      void (async () => {
        try {
          const caras = await motor.current?.analizar(f.b64);
          if (!caras) return;
          const r = caras.map((c) => identificar(c.vector, conocidasRef.current)).filter((x): x is Reconocida => !!x);
          respaldo.poner(r, caras.length - r.length, Date.now());
          // Al conocido presentado se le saluda una vez por sesión (a la dueña no: ya está hablando).
          const nuevo = r.find((x) => x.relacion === 'conocido' && !saludados.current.has(sinTildes(x.nombre)));
          if (nuevo) {
            saludados.current.add(sinTildes(nuevo.nombre));
            void op.current.decir(tr(`¡Hola, ${nuevo.nombre}!`, `Hi, ${nuevo.nombre}!`), 'feliz');
          }
        } catch (e) {
          miga(`caras: el respaldo no pudo reconocer (${String((e as Error)?.message || e).slice(0, 60)})`);
        } finally {
          analizando.current = false;
        }
      })();
    },
    [respaldo]
  );

  const escena = useCallback(() => {
    if (!reconoceRef.current) return '';
    const ahora = Date.now();
    const p = seguidor.presentes(ahora, FRESCO_MS);
    // Con ML Kit, lo votado; sin él (no hay pistas), lo que vio la última foto del respaldo.
    const q = p.r.length || p.desconocidas ? p : respaldo.presentes(ahora);
    return frasePresentes(q.r, q.desconocidas, false, op.current.lado === 'trasera');
  }, [respaldo, seguidor]);

  const estadoTexto = !activas ? tr('Apagado', 'Off') : conocidas?.length ? tr(`Conozco a ${conocidas.length}`, `I know ${conocidas.length}`) : tr('Activado', 'On');

  const nodoMotor = useMemo(
    () => (montarMotor ? <MotorCaras ref={motor} onEstado={(e) => setMotorListo(e === 'listo')} /> : null),
    [montarMotor]
  );

  return { activas, estadoTexto, motor: nodoMotor, abrirOpciones, manejar, escena, seguidor, reconoce, quiereFoto, recibirFoto, quiereFotoRespaldo, recibirFotoRespaldo };
}
