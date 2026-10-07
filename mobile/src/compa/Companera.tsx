/**
 * LA COMPAÑERA: AURA en chiquito, flotando encima de todas las pantallas.
 *
 * Una figurita dibujada con Skia (figura.ts + pintarCompa.ts): el cuerpecito de vidrio con los ojos
 * del avatar elegido (Claudio, su retrato en un círculo). Respira, parpadea, pasea a pasitos por el
 * borde de abajo con su sombrita y se detiene a mirarte cuando le hablas. No tapa la barra de
 * escribir: se aparta del teclado y del «suelo» que fija cada pantalla (canales.sueloCompa).
 *
 * El tacto (gestos.ts) y el ánimo (animo.ts) son máquinas puras; aquí solo se conectan y se ejecutan
 * sus efectos: háptica, risita, brinco, sacudida, globito, palomita ✔ y el doble toque que la
 * silencia de verdad (VozProvider). La boca sigue la voz real (avatar3d/senalVoz: nivel y forma;
 * la de la mesa y la de la conversación fluida) y la cara, la emoción de lo que dice.
 *
 * En una llamada se va (con animación) y vuelve al colgar. La llamada del avatar (LlamadaAvatar) ES su
 * presencia mientras dura: no se duplican. Al colgar, entra CAMINANDO desde el borde de la pantalla
 * (el clip «caminar» del 3D si el modelo lo trae, o la figurita a pasitos) y saluda al llegar.
 *
 * Es también el ALMA de los otros cuerpos de AURA (avatar3d/contrato.ts): publica lo que siente
 * (`estadoAvatar`) y escucha los toques que le cuentan el panel al lado de los chats y la pantalla
 * completa (`toqueAvatar`). Cuando AURA está en uno de esos, esta figurita se aparta (sigue sintiendo).
 * Su propio cuerpo es AvatarVivo: el 3D si hay modelo y el teléfono lo aguanta; si no, la figurita.
 *
 * En la mesa NO se ve: la mesa ya es AURA, grande y de frente (avatar3d/presencia.ts, cuerpoVisible).
 * Al salir de la mesa nace del cuerpo grande y se encoge hasta su lugar; al volver, crece hacia él y
 * se funde. Una sola AURA que cambia de tamaño, nunca dos (ni dos escenas 3D vivas a la vez).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Keyboard, PanResponder, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { playSfx } from '../lib/sfx';
import { senalVoz } from '../avatar3d/senalVoz';
import { miga } from '../lib/reporte';
import { tr } from '../i18n';
import { MEDIDA } from '../nucleo/tema';
import { escuchar, type Pantalla } from '../nucleo/contrato';
import { FOTOS_CLAUDIO, fotosRetrato } from '../avatares/ClaudioRetrato';
import { useVoz } from './VozProvider';
import { ANIMO_INICIAL, expresion, puedeCaminar, reducir, type Animo, type Efecto, type EventoAnimo, type Expresion, type Haptica } from './animo';
import { FIGURAS, VIVO_QUIETO, estiloDe, fotoClaudio, medidas, mezclarFigura, type Figura } from './figura';
import { grabarCompa, grabarVacioCompa } from './pintarCompa';
import { Gestos, type SalidaGesto } from './gestos';
import { destinoPaseo, msPaseo, pegarABorde, reubicar, yCarril, type Marco, type Posicion } from './borde';
import { ecoMesa, interrupcionVoz, mensajeVoz, nivelOido, oidoTelefono, sueloCompa } from './canales';
import { estadoAvatar, estadoDesdeAnimo, gestoDeEvento, mismoEstado, toqueAvatar, type EstadoAvatar } from '../avatar3d/contrato';
import { zona2D } from '../avatar3d/mapeo';
import { ecoVisible, vozSonando } from '../avatar3d/sonando';
import { cuerposAparte, marcoMesa, useModoPresencia } from '../avatar3d/usePresencia';
import { haciaMarco, transicionMesa, type ModoVisible } from '../avatar3d/presencia';
import { AvatarVivo } from '../avatar3d/AvatarVivo';
import { OrbeMini } from '../avatar3d/OrbeMini';
import { CuerpoVideo } from '../avatares/video/CuerpoVideo';
import { hayVideo } from '../avatares/video/clips';

/** Lado de su caja (px). El cuerpo es ~54 % del lado; el resto es aura, sombra y brinco. */
const LADO = 104;
const MARGEN = 4;
const TECHO = 28;
const ANCHO_GLOBO = 230;

const HAPTICA: Record<Haptica, () => Promise<void>> = {
  suave: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  media: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  fuerte: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  exito: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  aviso: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  seleccion: () => Haptics.selectionAsync(),
};

type Globo = { texto: string; prioridad: number; hasta: number; n: number };

export function Companera() {
  const voz = useVoz();
  const { width, height } = useWindowDimensions();
  const reducido = useReducedMotion();
  const avatar = voz.vista.avatar;
  const estilo = useMemo(() => estiloDe(avatar), [avatar]);
  const M = useMemo(() => medidas(LADO), []);

  // ---- el marco: la pantalla, lo que no se tapa abajo y el teclado
  const [suelo, setSuelo] = useState(sueloCompa.ultimo());
  const [teclado, setTeclado] = useState(0);
  useEffect(() => sueloCompa.escuchar(setSuelo), []);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', (e) => setTeclado(e.endCoordinates?.height || 0));
    const b = Keyboard.addListener('keyboardDidHide', () => setTeclado(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  const marco: Marco = useMemo(() => ({ ancho: width, alto: height, lado: LADO, margen: MARGEN, suelo: suelo + teclado, techo: TECHO }), [width, height, suelo, teclado]);
  const marcoRef = useRef(marco);
  marcoRef.current = marco;

  // ---- dónde está
  const pos = useRef<Posicion>({ borde: 'abajo', x: Math.max(MARGEN, width - LADO - 18), y: yCarril(marco) });
  const x = useSharedValue(pos.current.x);
  const y = useSharedValue(pos.current.y);
  const salto = useSharedValue(0);
  const sacude = useSharedValue(0);
  const visible = useSharedValue(1);
  const [oculta, setOculta] = useState(false);
  // AURA está en otro lado (al lado de los chats o a pantalla completa): esta figurita se aparta.
  const [aparte, setAparte] = useState(cuerposAparte.ultimo() > 0);
  const aparteRef = useRef(aparte);
  aparteRef.current = aparte;
  const enOtroLado = useSharedValue(aparte ? 0 : 1);
  useEffect(() => cuerposAparte.escuchar((n) => setAparte(n > 0)), []);
  useEffect(() => {
    enOtroLado.value = withTiming(aparte ? 0 : 1, { duration: 220 });
    if (aparte) caminarRef.current?.detener();
  }, [aparte, enOtroLado]);

  // En la mesa, la mesa es AURA: esta figurita no se ve. Al irse de la mesa sale del cuerpo grande
  // encogiéndose; al volver crece hacia él y se funde (`haciaMesa`: 0 en su lugar, 1 sobre la mesa).
  const modo = useModoPresencia();
  const enMesa = modo === 'mesa';
  const apartada = aparte || enMesa;
  aparteRef.current = apartada;
  const haciaMesa = useSharedValue(enMesa ? 1 : 0);
  const mesaDx = useSharedValue(0);
  const mesaDy = useSharedValue(0);
  const mesaEscala = useSharedValue(1);
  const modoAntes = useRef<ModoVisible>(modo);
  useEffect(() => {
    const antes = modoAntes.current;
    modoAntes.current = modo;
    const t = transicionMesa(antes, modo);
    const marcoM = marcoMesa.ultimo();
    if (!t || !marcoM || reducido) {
      haciaMesa.value = withTiming(enMesa ? 1 : 0, { duration: reducido ? 0 : 200 });
      if (enMesa) caminarRef.current?.detener();
      return;
    }
    const h = haciaMarco({ x: x.value, y: y.value, lado: LADO }, marcoM);
    mesaDx.value = h.dx;
    mesaDy.value = h.dy;
    mesaEscala.value = h.escala;
    if (t === 'crecer') {
      caminarRef.current?.detener();
      haciaMesa.value = withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) });
    } else {
      haciaMesa.value = 1;
      haciaMesa.value = withTiming(0, { duration: 560, easing: Easing.out(Easing.cubic) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  // El marco cambió (teclado, giro, otra pantalla): la misma posición, corregida, con resorte.
  const llevando = useRef(false);
  useEffect(() => {
    if (llevando.current) return;
    // Paseando, la x es la del paso de ahora (y el paso sigue); solo cambia la altura del carril.
    const paseando = !!caminarRef.current;
    const p = reubicar(marco, { ...pos.current, x: paseando ? x.value : pos.current.x });
    const movio = p.x !== pos.current.x || p.y !== pos.current.y;
    pos.current = p;
    if (!movio) return;
    if (!paseando) {
      cancelAnimation(x);
      x.value = withSpring(p.x, MEDIDA.resorte.suave);
    }
    y.value = withSpring(p.y, MEDIDA.resorte.suave);
  }, [marco, x, y]);

  // ---- lo vivo de la figura
  const desde = useSharedValue<Figura>(FIGURAS.tranquila);
  const hacia = useSharedValue<Figura>(FIGURAS.tranquila);
  const mezcla = useSharedValue(1);
  const parpadeo = useSharedValue(1);
  const respira = useSharedValue(0.5);
  const paso = useSharedValue(0);
  const caminando = useSharedValue(0);
  const dir = useSharedValue(1);
  const vozNivel = useSharedValue(0);
  const vozRedonda = useSharedValue(0);
  const vozAncha = useSharedValue(0);
  const oido = useSharedValue(0);
  const dedoX = useSharedValue(0);
  const dedoY = useSharedValue(0);
  const dedo = useSharedValue(0);
  const fase = useSharedValue(0);
  const palomita = useSharedValue(0);
  const latido = useSharedValue(0.5);

  // ---- el ánimo
  const animo = useRef<Animo>(ANIMO_INICIAL);
  const [exp, setExp] = useState<Expresion>('tranquila');
  const [globo, setGlobo] = useState<Globo | null>(null);
  const globoRef = useRef<Globo | null>(null);
  const pantalla = useRef<Pantalla>('mesa');
  /** Lo último que dijo la voz de la mesa (para no repetir el mismo globito con cada aviso de la mesa). */
  const textoMesa = useRef(ecoMesa.ultimo().texto);
  const vozRef = useRef(voz);
  vozRef.current = voz;
  const caminarRef = useRef<{ detener: () => void } | null>(null);
  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- lo que ven los otros cuerpos (el contrato del avatar): se publica solo si cambió
  const gestoRef = useRef<EstadoAvatar['gesto']>(null);
  const dirRef = useRef<-1 | 1>(1);
  const mirarRef = useRef<EstadoAvatar['mirar']>({ x: 0, y: 0, activa: false });
  const [estadoCuerpo, setEstadoCuerpo] = useState<EstadoAvatar>(estadoAvatar.ultimo());
  // Claudio y ANT-ONIO pequeños también van en video (su cara en el círculo); si el video no se puede
  // usar en este teléfono, vuelve su cuerpo de antes (3D o la foto).
  const [sinVideo, setSinVideo] = useState(false);
  const publicar = useCallback(() => {
    const e = estadoDesdeAnimo(animo.current, Date.now(), {
      caminando: !!caminarRef.current,
      dir: dirRef.current,
      mirar: mirarRef.current,
      gesto: gestoRef.current,
      globo: globoRef.current && globoRef.current.hasta > Date.now() ? globoRef.current.texto : '',
    });
    if (mismoEstado(e, estadoAvatar.ultimo())) return;
    estadoAvatar.emitir(e);
    setEstadoCuerpo(e);
  }, []);

  const recalcular = useCallback(() => {
    const ahora = Date.now();
    const a = animo.current;
    setExp(expresion(a, ahora));
    if (!puedeCaminar(a, ahora)) caminarRef.current?.detener();
    publicar();
    // La cara de reacción vence sola: se vuelve a mirar entonces.
    if (recalcTimer.current) clearTimeout(recalcTimer.current);
    if (a.reaccion && a.reaccion.hasta > ahora) recalcTimer.current = setTimeout(() => recalcular(), a.reaccion.hasta - ahora + 20);
  }, [publicar]);

  const ponerGlobo = useCallback((texto: string, ms: number, prioridad: number) => {
    const ahora = Date.now();
    const g = globoRef.current;
    if (g && g.hasta > ahora && g.prioridad > prioridad) return;
    const nuevo = { texto, prioridad, hasta: ahora + ms, n: (g?.n || 0) + 1 };
    globoRef.current = nuevo;
    setGlobo(nuevo);
    publicar();
  }, [publicar]);
  useEffect(() => {
    if (!globo) return;
    const t = setTimeout(() => {
      if (globoRef.current?.n === globo.n) {
        globoRef.current = null;
        setGlobo(null);
        publicar();
      }
    }, Math.max(0, globo.hasta - Date.now()));
    return () => clearTimeout(t);
  }, [globo, publicar]);

  const ejecutar = useCallback(
    (efectos: Efecto[]) => {
      for (const e of efectos) {
        switch (e.tipo) {
          case 'globo':
            ponerGlobo(e.texto, e.ms, e.prioridad);
            break;
          case 'haptica':
            void HAPTICA[e.fuerza]().catch(() => {});
            break;
          case 'sonido':
            playSfx(e.nombre);
            break;
          case 'brinco':
            if (reducido) break;
            salto.value = withSequence(withTiming(-e.alto, { duration: 130, easing: Easing.out(Easing.quad) }), withSpring(0, MEDIDA.resorte.vivo));
            break;
          case 'sacudir':
            if (reducido) break;
            sacude.value = withSequence(
              withTiming(-7, { duration: 45 }),
              withTiming(7, { duration: 70 }),
              withTiming(-6, { duration: 70 }),
              withTiming(5, { duration: 70 }),
              withTiming(-3, { duration: 60 }),
              withTiming(0, { duration: 60 })
            );
            break;
          case 'alternarVoz': {
            const r = vozRef.current.despertarOSilenciar();
            miga(`compañera: doble toque → ${r}`);
            break;
          }
          case 'palomita':
            palomita.value = 0;
            palomita.value = withSequence(withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }), withDelay(1100, withTiming(2, { duration: 420 })), withTiming(0, { duration: 0 }));
            break;
          case 'confirmar':
            vozRef.current.confirmar(e.ok, e.texto);
            break;
          case 'aparecer':
            setOculta(false);
            visible.value = withSpring(1, MEDIDA.resorte.vivo);
            break;
          case 'entrarCaminando':
            entrarCaminandoRef.current();
            break;
          case 'desaparecer':
            caminarRef.current?.detener();
            visible.value = withTiming(0, { duration: 260 }, (fin) => {
              if (fin) scheduleOnRN(setOculta, true);
            });
            break;
        }
      }
    },
    [palomita, ponerGlobo, reducido, sacude, salto, visible]
  );

  const despachar = useCallback(
    (ev: EventoAnimo) => {
      const antes = animo.current;
      const { animo: n, efectos } = reducir(antes, ev, Date.now());
      const cambio = n !== antes;
      animo.current = n;
      // El gesto de cuerpo que acompaña (el 3D lo hace con una animación; la figurita, con el brinco).
      const g = gestoDeEvento(ev, antes, n, efectos);
      if (g) gestoRef.current = { nombre: g, n: (gestoRef.current?.n || 0) + 1 };
      if (efectos.length) ejecutar(efectos);
      if (cambio) recalcular();
      else if (g) publicar();
    },
    [ejecutar, publicar, recalcular]
  );

  // Los toques que llegan de los otros cuerpos (el panel, la pantalla completa), con su zona.
  useEffect(
    () =>
      toqueAvatar.escuchar((t) => {
        if (!t) return;
        despachar(t.gesto === 'toque' ? { tipo: 'toque', zona: t.zona } : { tipo: t.gesto });
      }),
    [despachar]
  );

  // La voz (estado de la sesión), lo que dice, las interrupciones y lo que hace la mesa.
  const v = voz.vista;
  useEffect(() => {
    despachar({ tipo: 'voz', voz: { estado: v.estado, silenciada: v.silenciada, dormida: v.dormida, suspendida: v.suspendida, pensando: v.pensando } });
  }, [despachar, v.estado, v.silenciada, v.dormida, v.suspendida, v.pensando]);
  // La llamada del avatar: mientras suena o se habla, la compañera no está (la llamada es su presencia).
  useEffect(() => {
    despachar({ tipo: 'ciclo', estado: voz.ciclo });
  }, [despachar, voz.ciclo]);
  useEffect(() => {
    const offs = [
      mensajeVoz.escuchar((m) => {
        if (!m || m.rol !== 'ultron') return;
        despachar({ tipo: 'dijo', texto: m.texto, emocion: m.emocion, mostrar: pantalla.current !== 'mesa' });
      }),
      interrupcionVoz.escuchar(() => despachar({ tipo: 'interrupcion' })),
      // La voz de la mesa: su boca se mueve solo con la voz que SUENA, no desde que la mesa decide hablar.
      vozSonando.escuchar((s) => {
        const e = ecoMesa.ultimo();
        despachar({ tipo: 'mesa', ...ecoVisible(e, s), emocion: e.emocion });
      }),
      ecoMesa.escuchar((e) => {
        despachar({ tipo: 'mesa', ...ecoVisible(e, vozSonando.ahora()), emocion: e.emocion });
        // Con la mesa tapada, lo que dice su voz lo dice ella: su globito lo lee (en la mesa ya está la burbuja grande).
        if (e.texto && e.texto !== textoMesa.current) {
          textoMesa.current = e.texto;
          despachar({ tipo: 'dijo', texto: e.texto, emocion: e.emocion, mostrar: pantalla.current !== 'mesa' });
        }
      }),
      oidoTelefono.escuchar((on) => despachar({ tipo: 'oido', escuchando: on })),
      escuchar('llamada', ({ activa }) => despachar({ tipo: 'llamada', activa: !!activa })),
      escuchar('hecho', (h) => despachar({ tipo: 'hecho', ok: h.ok, accion: h.accion, detalle: h.detalle })),
      escuchar('enviado', (e) => despachar({ tipo: 'enviado', para: e.para, nombre: e.nombre })),
      escuchar('accion', (a) => despachar({ tipo: 'accion', accion: a })),
      escuchar('pantalla', (p) => {
        pantalla.current = p.pantalla;
      }),
    ];
    const tic = setInterval(() => despachar({ tipo: 'tic' }), 500);
    return () => {
      for (const f of offs) f();
      clearInterval(tic);
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
    };
  }, [despachar]);

  // ---- la cara: una sola curva de la expresión anterior a la nueva
  useEffect(() => {
    const actual = mezclarFigura(desde.value, hacia.value, mezcla.value);
    desde.value = actual;
    hacia.value = FIGURAS[exp];
    mezcla.value = 0;
    mezcla.value = withTiming(1, { duration: exp === 'uy' || exp === 'enojada' ? 140 : 280, easing: Easing.out(Easing.cubic) });
  }, [exp, desde, hacia, mezcla]);

  // Parpadeo (queda incluso con «menos movimiento»); dormida no parpadea.
  const dormida = exp === 'dormida';
  useEffect(() => {
    if (dormida) return;
    let vivo = true;
    let t: ReturnType<typeof setTimeout>;
    const cerrar = () => withSequence(withTiming(0.08, { duration: 70 }), withTiming(1, { duration: 90 }));
    const programar = () => {
      t = setTimeout(() => {
        if (!vivo) return;
        parpadeo.value = Math.random() < 0.15 ? withSequence(cerrar(), withTiming(1, { duration: 70 }), cerrar()) : cerrar();
        programar();
      }, 2800 + Math.random() * 3200);
    };
    programar();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [dormida, parpadeo]);

  // Respira (dormida más lento y hondo), late el aura, y la fase de los zzz / los puntitos.
  useEffect(() => {
    if (reducido || oculta) {
      cancelAnimation(respira);
      cancelAnimation(latido);
      respira.value = 0.5;
      latido.value = 0.5;
      return;
    }
    respira.value = withRepeat(withTiming(1, { duration: dormida ? 2600 : 1700, easing: Easing.inOut(Easing.sin) }), -1, true);
    latido.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => {
      cancelAnimation(respira);
      cancelAnimation(latido);
    };
  }, [dormida, oculta, reducido, respira, latido]);
  const conFase = (exp === 'dormida' || exp === 'piensa') && !reducido && !oculta;
  useEffect(() => {
    if (!conFase) return;
    fase.value = 0;
    fase.value = withRepeat(withTiming(1, { duration: exp === 'dormida' ? 3000 : 1400, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(fase);
  }, [conFase, exp, fase]);

  // La boca: la de la voz (la de la mesa o la de la conversación) con su forma (senalVoz: los tiempos
  // por letra, el espectro o solo el nivel), sin pasar por React. Abre rápido y cierra suave.
  useEffect(() => {
    const soltar = senalVoz.pedirForma();
    const off = senalVoz.boca.escuchar((b) => {
      vozNivel.value = withTiming(b.nivel, { duration: b.nivel > vozNivel.value ? 30 : 70 });
      vozRedonda.value = withTiming(b.visema === 'O' || b.visema === 'U' ? b.peso : 0, { duration: 50 });
      vozAncha.value = withTiming(b.visema === 'E' || b.visema === 'I' || b.visema === 'SS' ? b.peso : 0, { duration: 50 });
    });
    return () => {
      off();
      soltar();
    };
  }, [vozNivel, vozRedonda, vozAncha]);

  // La voz de la persona: el anillo late y, si le hablan, se detiene y la mira.
  const ultimoOido = useRef(0);
  useEffect(
    () =>
      nivelOido.escuchar((l) => {
        oido.value = withTiming(l, { duration: 80 });
        if (l > 0.14) {
          ultimoOido.current = Date.now();
          caminarRef.current?.detener();
        }
      }),
    [oido]
  );

  // ---- pasear a pasitos por el borde de abajo
  const detenerPaseo = useCallback(() => {
    if (!caminarRef.current) return;
    caminarRef.current = null;
    cancelAnimation(x);
    pos.current = { ...pos.current, x: x.value };
    caminando.value = withTiming(0, { duration: 180 });
    cancelAnimation(paso);
    paso.value = withTiming(0, { duration: 160 });
    publicar();
  }, [caminando, paso, publicar, x]);
  const llego = useCallback(() => {
    if (!caminarRef.current) return;
    caminarRef.current = null;
    pos.current = { ...pos.current, x: x.value };
    caminando.value = withTiming(0, { duration: 220 });
    cancelAnimation(paso);
    paso.value = withTiming(0, { duration: 180 });
    publicar();
  }, [caminando, paso, publicar, x]);
  /*
   * Colgó la llamada del avatar: entra caminando desde el borde más cercano a su lugar (el cuerpo 3D
   * pone su clip «caminar» porque se publica `caminando`; la figurita da pasitos) y saluda al llegar.
   * Con «reducir movimiento», aparece con un fundido corto en su lugar.
   */
  const entrarCaminando = useCallback(() => {
    caminarRef.current?.detener();
    const m = marcoRef.current;
    const lugar = pos.current;
    setOculta(false);
    if (reducido) {
      visible.value = withTiming(1, { duration: 160 });
      return;
    }
    const desdeIzq = lugar.x + LADO / 2 < m.ancho / 2;
    const inicio = desdeIzq ? -LADO : m.ancho;
    cancelAnimation(x);
    x.value = inicio;
    visible.value = 1;
    dirRef.current = desdeIzq ? 1 : -1;
    dir.value = dirRef.current;
    caminarRef.current = { detener: detenerPaseo };
    publicar();
    caminando.value = withTiming(1, { duration: 120 });
    paso.value = 0;
    paso.value = withRepeat(withTiming(1, { duration: 520, easing: Easing.linear }), -1, false);
    const ms = Math.max(900, Math.min(2600, msPaseo(inicio, lugar.x, 150)));
    x.value = withTiming(lugar.x, { duration: ms, easing: Easing.out(Easing.quad) }, (fin) => {
      if (fin) scheduleOnRN(llegoSaludando);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducido, detenerPaseo, publicar]);
  const llegoSaludando = useCallback(() => {
    llego();
    gestoRef.current = { nombre: 'saludar', n: (gestoRef.current?.n || 0) + 1 };
    salto.value = withSequence(withTiming(-12, { duration: 160 }), withSpring(0, MEDIDA.resorte.vivo));
    publicar();
  }, [llego, publicar, salto]);
  const entrarCaminandoRef = useRef(entrarCaminando);
  entrarCaminandoRef.current = entrarCaminando;
  useEffect(() => {
    if (reducido) return;
    let t: ReturnType<typeof setTimeout>;
    const programar = (ms: number) => {
      t = setTimeout(() => {
        const ahora = Date.now();
        const ok =
          !caminarRef.current &&
          !llevando.current &&
          !aparteRef.current &&
          pos.current.borde === 'abajo' &&
          ahora - ultimoOido.current > 3000 &&
          puedeCaminar(animo.current, ahora);
        if (ok) {
          const m = marcoRef.current;
          const destino = destinoPaseo(m, x.value);
          const ms2 = msPaseo(x.value, destino);
          if (ms2 > 300) {
            caminarRef.current = { detener: detenerPaseo };
            dirRef.current = destino > x.value ? 1 : -1;
            publicar();
            dir.value = withTiming(dirRef.current, { duration: 150 });
            caminando.value = withTiming(1, { duration: 200 });
            paso.value = 0;
            paso.value = withRepeat(withTiming(1, { duration: 560, easing: Easing.linear }), -1, false);
            x.value = withTiming(destino, { duration: ms2, easing: Easing.linear }, (fin) => {
              if (fin) scheduleOnRN(llego);
            });
          }
        }
        programar(5000 + Math.random() * 7000);
      }, ms);
    };
    programar(4000);
    return () => {
      clearTimeout(t);
      detenerPaseo();
    };
  }, [caminando, detenerPaseo, dir, llego, paso, publicar, reducido, x]);

  // ---- el tacto
  const gestos = useRef(new Gestos({ radio: LADO * 0.3 })).current;
  const agarre = useRef({ dx: 0, dy: 0 });
  const vencerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alGesto = useCallback(
    (sal: SalidaGesto[]) => {
      for (const g of sal) {
        switch (g.gesto) {
          case 'toque':
            // Dónde la tocaron en su cuerpecito: arriba la cabeza, a los lados la mejilla, abajo la panza.
            despachar({ tipo: 'toque', zona: zona2D(g.x - x.value, g.y - y.value, M.cx, M.cy, M.R) });
            break;
          case 'dobleToque':
          case 'molestar':
          case 'caricia':
            despachar({ tipo: g.gesto });
            break;
          case 'levantar':
          case 'arrastrar':
            detenerPaseo();
            llevando.current = true;
            agarre.current = { dx: g.x - x.value, dy: g.y - y.value };
            cancelAnimation(x);
            cancelAnimation(y);
            if (!animo.current.levantada) despachar({ tipo: 'levantar' });
            break;
          case 'moverArrastre': {
            const m = marcoRef.current;
            const nx = Math.max(0, Math.min(m.ancho - LADO, g.x - agarre.current.dx));
            const ny = Math.max(0, Math.min(m.alto - LADO, g.y - agarre.current.dy));
            x.value = nx;
            y.value = ny;
            break;
          }
          case 'soltar': {
            llevando.current = false;
            const p = pegarABorde(marcoRef.current, x.value, y.value, g.vx || 0, g.vy || 0);
            pos.current = p;
            x.value = withSpring(p.x, MEDIDA.resorte.vivo);
            y.value = withSpring(p.y, MEDIDA.resorte.vivo);
            despachar({ tipo: 'soltar' });
            break;
          }
        }
      }
    },
    [M, despachar, detenerPaseo, x, y]
  );
  const programarVencer = useCallback(() => {
    if (vencerTimer.current) clearTimeout(vencerTimer.current);
    const p = gestos.proximo();
    if (p === null) return;
    vencerTimer.current = setTimeout(() => {
      vencerTimer.current = null;
      alGesto(gestos.vencer(Date.now()));
      programarVencer();
    }, Math.max(0, p - Date.now()) + 5);
  }, [alGesto, gestos]);
  useEffect(
    () => () => {
      if (vencerTimer.current) clearTimeout(vencerTimer.current);
    },
    []
  );

  const mirarDedo = useCallback(
    (px: number, py: number) => {
      const cx = x.value + LADO / 2;
      const cy = y.value + LADO / 2;
      dedoX.value = withSpring(Math.max(-1, Math.min(1, (px - cx) / (LADO * 0.35))), { stiffness: 200, damping: 16 });
      dedoY.value = withSpring(Math.max(-1, Math.min(1, (py - cy) / (LADO * 0.35))), { stiffness: 200, damping: 16 });
      dedo.value = withTiming(1, { duration: 120 });
      mirarRef.current = { x: Math.max(-1, Math.min(1, (px - cx) / (LADO * 0.35))), y: Math.max(-1, Math.min(1, (py - cy) / (LADO * 0.35))), activa: true };
    },
    [dedo, dedoX, dedoY, x, y]
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => !gestos.llevando(),
        onPanResponderGrant: (e) => {
          const { pageX, pageY } = e.nativeEvent;
          // Sin precalentar al tocar: el permiso de la conversación se pide cuando suena la llamada.
          mirarDedo(pageX, pageY);
          alGesto(gestos.bajar(Date.now(), pageX, pageY));
          programarVencer();
        },
        onPanResponderMove: (e) => {
          const { pageX, pageY } = e.nativeEvent;
          if (!gestos.llevando()) mirarDedo(pageX, pageY);
          alGesto(gestos.mover(Date.now(), pageX, pageY));
          programarVencer();
        },
        onPanResponderRelease: (e) => {
          const { pageX, pageY } = e.nativeEvent;
          alGesto(gestos.subir(Date.now(), pageX, pageY));
          dedo.value = withDelay(700, withTiming(0, { duration: 500 }));
          mirarRef.current = { x: 0, y: 0, activa: false };
          programarVencer();
        },
        onPanResponderTerminate: () => {
          alGesto(gestos.cancelar(Date.now()));
          dedo.value = withTiming(0, { duration: 400 });
          programarVencer();
        },
      }),
    [alGesto, dedo, gestos, mirarDedo, programarVencer]
  );

  // ---- el cuadro
  const cuadro = useDerivedValue(() => {
    try {
      const f = mezclarFigura(desde.value, hacia.value, mezcla.value);
      return grabarCompa(
        Skia,
        M,
        f,
        {
          ...VIVO_QUIETO,
          parpadeo: parpadeo.value,
          respira: respira.value,
          paso: paso.value,
          caminando: caminando.value,
          dir: dir.value,
          voz: vozNivel.value,
          redonda: vozRedonda.value,
          ancha: vozAncha.value,
          oido: oido.value,
          dedoX: dedoX.value,
          dedoY: dedoY.value,
          dedo: dedo.value,
          fase: fase.value,
          palomita: palomita.value,
          latido: latido.value,
        },
        estilo
      );
    } catch {
      return grabarVacioCompa(Skia);
    }
  }, [M, estilo]);

  const estiloCaja = useAnimatedStyle(() => {
    const h = haciaMesa.value;
    // Grande sobre la mesa casi no se ve; se hace visible mientras se encoge (y al revés al crecer).
    const opMesa = Math.max(0, Math.min(1, (1 - h) * 2.2));
    return {
      opacity: visible.value * enOtroLado.value * opMesa,
      transform: [
        { translateX: x.value + sacude.value + h * mesaDx.value },
        { translateY: y.value + salto.value + h * mesaDy.value },
        { scale: (0.4 + 0.6 * visible.value) * (0.6 + 0.4 * enOtroLado.value) * (1 + h * (mesaEscala.value - 1)) },
      ],
    };
  });

  // El globito: encima (o debajo si está arriba), sin salirse de la pantalla.
  const altoGlobo = useSharedValue(40);
  const anchoGlobo = Math.min(ANCHO_GLOBO, width - 16);
  const estiloGlobo = useAnimatedStyle(() => {
    const izq = x.value + LADO / 2 - anchoGlobo / 2;
    const bueno = Math.min(Math.max(izq, 8), width - anchoGlobo - 8);
    const abajo = y.value < altoGlobo.value + TECHO + 8;
    return { transform: [{ translateX: bueno - izq }, { translateY: abajo ? LADO - 6 : -altoGlobo.value + 10 }] };
  }, [anchoGlobo, width]);
  const medirGlobo = (e: LayoutChangeEvent) => {
    altoGlobo.value = e.nativeEvent.layout.height;
  };

  // Claudio y ANT-ONIO: su retrato en un círculo (la foto va con la expresión; al hablar, la de boca abierta).
  const lado = M.R * 1.86;
  const fotos = fotosRetrato(avatar) || FOTOS_CLAUDIO;
  const hablaOpac = useAnimatedStyle(() => ({ opacity: vozNivel.value > 0.18 ? 1 : 0 }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[s.caja, estiloCaja]} pointerEvents={oculta || apartada ? 'none' : 'box-none'}>
        {globo ? (
          <Animated.View pointerEvents="none" style={[s.globoFila, { width: anchoGlobo, left: LADO / 2 - anchoGlobo / 2 }, estiloGlobo]} onLayout={medirGlobo}>
            <View style={[s.globo, { borderColor: estilo.main }]}>
              <Text style={s.globoTexto} numberOfLines={3}>
                {globo.texto}
              </Text>
            </View>
          </Animated.View>
        ) : null}
        <View
          style={s.cuerpo}
          {...responder.panHandlers}
          accessible
          accessibilityRole="button"
          accessibilityLabel={tr('AURA, tu compañera', 'AURA, your companion')}
          accessibilityHint={tr('Toca para saludarla; dile «llámame» y te llama; mantén para moverla', 'Tap to say hi; say "call me" and she calls you; hold to move her')}
        >
          {avatar === 'aura' ? (
            // AU-RA: su orbe, como en la mesa (antes el robot 3D o la figurita dorada).
            <View pointerEvents="none" style={[s.retrato, { width: lado, height: lado, borderRadius: lado / 2, left: M.cx - lado / 2, top: M.cy - lado / 2, backgroundColor: 'transparent' }]}>
              <OrbeMini lado={lado} estado={estadoCuerpo} activo={!oculta && !apartada} />
            </View>
          ) : hayVideo(avatar) && !sinVideo ? (
            <View pointerEvents="none" style={[s.retrato, { width: lado, height: lado, borderRadius: lado / 2, left: M.cx - lado / 2, top: M.cy - lado / 2, backgroundColor: estilo.cuerpo }]}>
              <CuerpoVideo
                avatar={avatar}
                camara="retrato"
                estado={estadoCuerpo}
                ancho={lado}
                alto={lado}
                activo={!oculta && !apartada}
                onFallo={() => setSinVideo(true)}
                respaldo={<Image source={fotos[fotoClaudio(exp)]} style={s.foto} resizeMode="cover" />}
              />
            </View>
          ) : (
          <AvatarVivo
            avatar={avatar}
            camara="cuerpo"
            estado={estadoCuerpo}
            ancho={LADO}
            alto={LADO}
            fpsMax={30}
            activo={!oculta && !apartada}
            respaldo={
              <>
                <Canvas style={s.lienzo} pointerEvents="none">
                  <Picture picture={cuadro} />
                </Canvas>
                {estilo.retrato ? (
                  <View pointerEvents="none" style={[s.retrato, { width: lado, height: lado, borderRadius: lado / 2, left: M.cx - lado / 2, top: M.cy - lado / 2, backgroundColor: estilo.cuerpo }]}>
                    <Image source={fotos[fotoClaudio(exp)]} style={s.foto} resizeMode="cover" />
                    {fotoClaudio(exp) === 'base' ? (
                      <Animated.Image source={fotos.habla[1]} style={[s.foto, StyleSheet.absoluteFill, hablaOpac]} resizeMode="cover" />
                    ) : null}
                  </View>
                ) : null}
              </>
            }
          />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  caja: { position: 'absolute', left: 0, top: 0, width: LADO, height: LADO },
  cuerpo: { width: LADO, height: LADO },
  lienzo: { width: LADO, height: LADO },
  retrato: { position: 'absolute', overflow: 'hidden', backgroundColor: '#1F1B18' },
  foto: { width: '100%', height: '100%', transform: [{ scale: 1.5 }, { translateY: 9 }] },
  globoFila: { position: 'absolute', top: 0, alignItems: 'center' },
  globo: {
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: 'rgba(28,29,32,0.94)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  globoTexto: { color: '#ECE8E2', fontSize: 14, lineHeight: 19, textAlign: 'center' },
});
