/**
 * RECONOCER VOCES EN LA MESA (con permiso): une el audio de cada frase del oído Turbo, lo guardado en el
 * servidor (api.ts) y lo que se dice. La lógica pura (entender lo que se dice, el «sí» de la persona
 * presentada, las frases para aprender, la escena) vive en voces.ts; aquí solo se conecta.
 *
 *  · Nada sale sin que la persona lo active (Más → Voces, con la explicación de qué se guarda).
 *  · «Aprende mi voz»: tres frases de la dueña. «Aprende la voz de Ana» (o «te presento a mi esposa
 *    Ana» si las caras no están activas): AU-RA le pregunta a Ana en voz alta y solo un «sí» empieza a oír
 *    sus frases. «Olvida la voz de Ana», «olvida mi voz», «olvida todas las voces», «¿de quién conoces la
 *    voz?», «¿quién está hablando?».
 *  · Con voces guardadas, cada frase se manda a reconocer en cuanto se CIERRA (antes de que llegue su
 *    texto) y el turno de ESA frase espera su resultado hasta `ESPERA_VOZ_TURNO_MS` (350 ms; casi siempre
 *    ya llegó). Si no, el turno sale sin decir quién habla: nunca con lo de la frase anterior (revisión del
 *    5-oct, M1). Con una consulta en curso, la frase nueva queda en fila (la última), no se tira.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { idiomaActual, tr } from '../i18n';
import { loadSettings, saveSettings } from '../lib/storage';
import { miga } from '../lib/reporte';
import { turboOyenteAudio, turboOyenteCierre } from '../lib/speechTurbo';
import {
  AUDIO_VIGENTE_MS,
  IdentificadorVoz,
  Inscripcion,
  MIN_TROZOS_QUIEN,
  UltimaVoz,
  conVocesActivas,
  esCancelar,
  nombreCon,
  pedidoDeVoces,
  quienHablaDelTurno,
  recortarFrase,
  respuestaSiNo,
  vocesActivas,
  wavDeFrase,
  type PersonaVoz,
  type QuienHablaTurno,
} from './voces';
import { aprenderVoz, listarVoces, olvidarTodasLasVoces, olvidarVoz, quienHabla, type VozGuardada } from './api';
import { abrirHojaBio, escucharCambiosBio, fraseGuardadoPorConfirmar } from '../caras/porConfirmar';

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const mensaje = (e: unknown) => String((e as any)?.data?.error || (e as Error)?.message || tr('sin conexión', 'offline'));

type Opciones = {
  correo: string;
  nombre: string;
  nombreAvatar: string;
  /** ¿Las caras están activas? «Te presento a Ana» es de ellas entonces (para la voz: «aprende la voz de Ana»). */
  carasActivas: boolean;
  /** ¿Oye ahora con Turbo? Los otros oídos no entregan el audio de la frase. */
  oidoTurbo: () => boolean;
  decir: (texto: string, emocion?: 'feliz' | 'preocupado' | 'curioso' | 'neutral') => Promise<void>;
};

export type ApiVoces = {
  activas: boolean;
  /** Lo que se lee en «Más → Voces». */
  estadoTexto: string;
  /** Más → Voces: activar (con la explicación) o ver / borrar / desactivar. */
  abrirOpciones: () => void;
  /** Lo dicho: si era de voces (o una frase para aprender, o el «sí»), lo atiende y devuelve true. */
  manejar: (dicho: string) => Promise<boolean>;
  /**
   * Para el turno de la frase oída en `oidaEn` (0 si se escribió): «Por la voz, habla Ana…» y, si es alguien
   * que no es la dueña, su id para el servidor (`quienHabla`). Espera lo de ESA frase hasta
   * `ESPERA_VOZ_TURNO_MS`; vacío si no hay nada seguro de esa frase.
   */
  /** `caraDuenaEn`: cuándo las caras vieron a la dueña confirmada por votos (0 si no), para la continuidad (revisión 7, G2). */
  paraTurno: (oidaEn: number, o?: { caraDuenaEn?: number }) => Promise<{ frase: string; quienHabla?: QuienHablaTurno }>;
  /** El audio PCM de una frase terminada (trozos de 0,1 s en base64), su texto y su id. */
  alTerminarFrase: (trozos: string[], texto: string, id?: number) => void;
};

export function useVoces(o: Opciones): ApiVoces {
  const [activas, setActivas] = useState(false);
  const [conocidas, setConocidas] = useState<VozGuardada[] | null>(null);
  const inscripcion = useRef(new Inscripcion()).current;
  const ultima = useRef(new UltimaVoz()).current;
  const frase = useRef<{ trozos: string[]; t: number } | null>(null);
  /** Lo último que se supo, solo de una frase más nueva que la anterior sabida (para «¿quién habla?»). */
  const ultimoIdSabido = useRef(0);
  const identificador = useRef<IdentificadorVoz | null>(null);
  if (!identificador.current) {
    identificador.current = new IdentificadorVoz(
      (trozos) =>
        quienHabla(wavDeFrase(trozos)).catch((e) => {
          miga(`voces: no pude reconocer (${String((e as Error)?.message || e).slice(0, 60)})`);
          throw e;
        }),
      (id, persona) => {
        if (persona === undefined || id < ultimoIdSabido.current) return;
        ultimoIdSabido.current = id;
        ultima.poner(persona);
        if (persona) miga(`voces: habló ${persona.relacion === 'yo' ? 'la dueña' : 'un conocido'}`);
      }
    );
  }
  const ident = identificador.current;
  /** Frases sin id del oído (no debería pasar): ids negativos para no chocar con los del oído. */
  const sinId = useRef(0);
  const op = useRef(o);
  op.current = o;
  const conocidasRef = useRef<VozGuardada[]>([]);
  conocidasRef.current = conocidas || [];
  const activasRef = useRef(false);
  activasRef.current = activas;

  useEffect(() => {
    void loadSettings().then((s) => setActivas(vocesActivas(s.vocesActivas, o.correo)));
  }, [o.correo]);

  const refrescar = useCallback(async () => {
    try {
      const l = await listarVoces();
      setConocidas(l);
      conocidasRef.current = l;
      return l;
    } catch (e) {
      miga(`voces: no pude leer las guardadas (${String((e as Error)?.message || e).slice(0, 60)})`);
      return conocidasRef.current;
    }
  }, []);
  useEffect(() => {
    if (activas && conocidas === null) void refrescar();
  }, [activas, conocidas, refrescar]);
  // Tanda F1: confirmó o borró a alguien en la hoja «Por confirmar»: la lista (y sus vectores) al día.
  useEffect(() => escucharCambiosBio((t) => void (t === 'voz' && refrescar())), [refrescar]);

  /**
   * ¿Quién dijo la frase `id`? Se consulta ya (o queda en fila); lo que no se reconoce (aprendiendo una voz,
   * sin voces conocidas, muy corta) queda «sin dato»: su turno no dice quién habla.
   */
  const identificar = useCallback(
    (id: number, recortada: string[]) => {
      // Mientras aprende una voz, la frase es para eso (no se identifica).
      if (inscripcion.pendiente() || !conocidasRef.current.length || recortada.length < MIN_TROZOS_QUIEN) return ident.sinDato(id);
      ident.oir(id, recortada);
    },
    [ident, inscripcion]
  );

  /** La frase se cerró (todavía sin texto): a reconocer ya, así el turno casi nunca espera. */
  const alCerrarFrase = useCallback(
    (id: number, trozos: string[]) => {
      if (!activasRef.current || !trozos.length) return;
      identificar(id, recortarFrase(trozos));
    },
    [identificar]
  );

  const alTerminarFrase = useCallback(
    (trozos: string[], _texto: string, id?: number) => {
      if (!activasRef.current || !trozos.length) return;
      const recortada = recortarFrase(trozos);
      frase.current = { trozos: recortada, t: Date.now() };
      const n = typeof id === 'number' ? id : --sinId.current;
      // Si no se oyó al cerrarse (otra versión del oído, o las voces se activaron en medio), ahora.
      if (!ident.conocida(n)) identificar(n, recortada);
      ident.entregada(n, Date.now());
    },
    [ident, identificar]
  );

  // El oído Turbo le pasa el audio de cada frase (al cerrarse y al entregarse), solo con las voces activadas.
  useEffect(() => {
    if (!activas) return;
    turboOyenteCierre((id, trozos) => alCerrarFrase(id, trozos));
    turboOyenteAudio((trozos, texto, id) => alTerminarFrase(trozos, texto, id));
    return () => {
      turboOyenteCierre(null);
      turboOyenteAudio(null);
    };
  }, [activas, alCerrarFrase, alTerminarFrase]);

  /** El audio de la frase que se acaba de decir (null si este oído no lo da o ya no es de ahora). */
  const tomarFrase = () => {
    const f = frase.current;
    frase.current = null;
    return f && Date.now() - f.t <= AUDIO_VIGENTE_MS ? f.trozos : null;
  };

  const activar = useCallback(
    () =>
      new Promise<boolean>((resolver) => {
        const a = op.current;
        Alert.alert(
          tr('Reconocer voces', 'Recognize voices'),
          tr(
            `${a.nombreAvatar} podrá saber por la voz si eres tú quien habla, o alguien de tu círculo que le presentes (esa persona tiene que decir que sí en voz alta).\n\nDe cada frase se guardan solo números que describen la voz, nunca la grabación, y solo en tu cuenta. El audio se analiza y se descarta. Funciona con el oído Turbo.\n\nPara borrar: «olvida la voz de Ana», «olvida mi voz», o aquí mismo.`,
            `${a.nombreAvatar} will be able to tell by voice whether it’s you speaking, or someone from your circle you introduce (they have to say yes out loud).\n\nOnly numbers describing the voice are kept, never the recording, and only in your account. The audio is analyzed and discarded. Works with the Turbo ear.\n\nTo erase: “forget Ana’s voice”, “forget my voice”, or right here.`
          ),
          [
            { text: tr('Ahora no', 'Not now'), style: 'cancel', onPress: () => resolver(false) },
            {
              text: tr('Activar', 'Turn on'),
              onPress: () =>
                void (async () => {
                  const s = await loadSettings();
                  await saveSettings({ vocesActivas: conVocesActivas(s.vocesActivas, a.correo, true) });
                  activasRef.current = true;
                  setActivas(true);
                  miga('voces: activado por la persona');
                  resolver(true);
                })(),
            },
          ]
        );
      }),
    []
  );

  const desactivar = useCallback(async () => {
    const s = await loadSettings();
    await saveSettings({ vocesActivas: conVocesActivas(s.vocesActivas, op.current.correo, false) });
    activasRef.current = false;
    setActivas(false);
    ultima.olvidar();
    ident.olvidar();
    inscripcion.terminar();
  }, [ident, inscripcion, ultima]);

  const borrarTodas = useCallback(async () => {
    try {
      const n = await olvidarTodasLasVoces();
      setConocidas([]);
      conocidasRef.current = [];
      ultima.olvidar();
      ident.olvidar();
      await op.current.decir(tr(`Listo, olvidé ${n === 1 ? 'la voz' : `las ${n} voces`} que conocía.`, `Done, I forgot ${n === 1 ? 'the voice' : `the ${n} voices`} I knew.`));
    } catch {
      await op.current.decir(tr('No pude borrarlas ahora. Inténtalo con conexión.', 'I couldn’t erase them now. Try again when online.'), 'preocupado');
    }
  }, [ident, ultima]);

  const confirmarBorrarTodas = useCallback(() => {
    Alert.alert(tr('¿Olvidar todas las voces?', 'Forget all voices?'), tr('Se borran de tu cuenta los números de todas las voces que conozco. No se puede deshacer.', 'The numbers for every voice I know are erased from your account. This can’t be undone.'), [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      { text: tr('Olvidar todas', 'Forget all'), style: 'destructive', onPress: () => void borrarTodas() },
    ]);
  }, [borrarTodas]);

  const quienes = (l: VozGuardada[], en = idiomaActual() === 'en') =>
    l.map((c) => (c.relacion === 'yo' ? (en ? `${c.nombre} (you)` : `${c.nombre} (tú)`) : nombreCon(c, en)) + (c.porConfirmar ? (en ? ' — to confirm' : ' — por confirmar') : '')).join('; ');

  const abrirOpciones = useCallback(() => {
    if (!activasRef.current) {
      void activar();
      return;
    }
    // Tanda F1: la hoja de la mesa (caras/HojaConsentimiento.tsx), con la insignia «Por confirmar»; sin mesa, el aviso.
    const sinTurbo = op.current.oidoTurbo() ? '' : tr('Ahora no estás con el oído Turbo: con este oído no puedo oír las voces (Ajustes → Oído).', 'You’re not on the Turbo ear right now: with this ear I can’t hear voices (Settings → Ear).');
    const enHoja = abrirHojaBio({
      tipo: 'voz',
      titulo: tr('Reconocer voces · activado', 'Recognize voices · on'),
      texto: [tr('Di «aprende mi voz» para que aprenda la tuya, o «aprende la voz de …» para presentarme a alguien de tu círculo.', 'Say “learn my voice” to learn yours, or “learn the voice of …” to introduce someone from your circle.'), sinTurbo].filter(Boolean).join('\n\n'),
      mandos: [
        { titulo: tr('Olvidar todas', 'Forget all'), peligro: true, alTocar: confirmarBorrarTodas },
        { titulo: tr('Desactivar', 'Turn off'), alTocar: () => void desactivar() },
      ],
    });
    if (enHoja) return;
    const l = conocidasRef.current;
    Alert.alert(
      tr('Reconocer voces · activado', 'Recognize voices · on'),
      tr(
        `Conozco la voz de: ${l.length ? quienes(l) : 'nadie todavía'}.\n\nDi «aprende mi voz» para que aprenda la tuya, o «aprende la voz de …» para presentarme a alguien de tu círculo.${op.current.oidoTurbo() ? '' : '\n\nAhora no estás con el oído Turbo: con este oído no puedo oír las voces (Ajustes → Oído).'}`,
        `I know the voice of: ${l.length ? quienes(l) : 'nobody yet'}.\n\nSay “learn my voice” to learn yours, or “learn the voice of …” to introduce someone from your circle.${op.current.oidoTurbo() ? '' : '\n\nYou’re not on the Turbo ear right now: with this ear I can’t hear voices (Settings → Ear).'}`
      ),
      [
        { text: tr('Olvidar todas', 'Forget all'), style: 'destructive', onPress: confirmarBorrarTodas },
        { text: tr('Desactivar', 'Turn off'), onPress: () => void desactivar() },
        { text: tr('Cerrar', 'Close'), style: 'cancel' },
      ]
    );
  }, [activar, confirmarBorrarTodas, desactivar]);

  const buscarPorNombre = (nombre: string) => {
    const n = sinTildes(nombre);
    const l = conocidasRef.current.filter((c) => c.relacion === 'conocido');
    return l.find((c) => sinTildes(c.nombre) === n) || l.find((c) => (c.parentesco && sinTildes(c.parentesco) === n) || sinTildes(c.nombre).includes(n) || n.includes(sinTildes(c.nombre)));
  };

  /** Con las frases ya oídas, se manda a aprender (el servidor saca los números y descarta el audio). */
  const guardarInscripcion = useCallback(async () => {
    const a = op.current;
    const p = inscripcion.pendiente();
    inscripcion.terminar();
    if (!p) return;
    try {
      const guardada = await aprenderVoz({
        nombre: p.nombre,
        relacion: p.tipo,
        ...(p.parentesco ? { parentesco: p.parentesco } : {}),
        audios: p.frases.map(wavDeFrase),
        consentimiento: p.tipo === 'yo' ? { como: 'dueño' } : { como: 'voz', frase: p.frase || 'sí' },
      });
      await refrescar();
      await a.decir(
        p.tipo === 'yo'
          ? tr(`Listo, ${a.nombre}: ya conozco tu voz. Guardé números, no la grabación; di «olvida mi voz» para borrarla.`, `Done, ${a.nombre}: I know your voice now. I kept numbers, not the recording; say “forget my voice” to erase it.`)
          : guardada?.porConfirmar
            ? // Tanda F1: un posible menor queda por confirmar en la pantalla de la dueña: todavía no se reconoce.
              fraseGuardadoPorConfirmar(p.nombre, 'voz', a.nombre, idiomaActual() === 'en')
            : tr(`¡Gracias, ${p.nombre}! Ya reconozco tu voz. Solo guardé números, no la grabación.`, `Thank you, ${p.nombre}! I’ll recognize your voice now. I only kept numbers, not the recording.`),
        'feliz'
      );
    } catch (e) {
      const code = (e as any)?.data?.code;
      await a.decir(
        code === 'voces_no_disponible'
          ? tr('El reconocimiento de voz no está disponible ahora mismo en el servidor. Inténtalo más tarde.', 'Voice recognition isn’t available on the server right now. Try again later.')
          : tr(`No pude guardar la voz: ${mensaje(e)}`, `I couldn’t save the voice: ${mensaje(e)}`),
        'preocupado'
      );
    }
  }, [inscripcion, refrescar]);

  const sinTurbo = useCallback(async () => {
    await op.current.decir(tr('Para las voces necesito el oído Turbo: el que tienes ahora no me deja oír el audio. Cámbialo en Ajustes → Oído.', 'For voices I need the Turbo ear: the current one doesn’t give me the audio. Change it in Settings → Ear.'), 'preocupado');
  }, []);

  const manejar = useCallback(
    async (dicho: string): Promise<boolean> => {
      const a = op.current;
      // 1) Aprendiendo una voz: el «sí» de la persona presentada, o una de sus frases.
      const paso = inscripcion.pendiente();
      if (paso) {
        if (paso.fase === 'permiso') {
          const r = respuestaSiNo(dicho);
          frase.current = null;
          if (r === 'si') {
            inscripcion.consentir(dicho);
            await a.decir(tr(`Gracias, ${paso.nombre}. Dime un par de frases, lo que quieras: cómo estuvo tu día, por ejemplo.`, `Thanks, ${paso.nombre}. Say a couple of sentences, anything: how your day went, for example.`), 'feliz');
            return true;
          }
          inscripcion.terminar();
          await a.decir(r === 'no' ? tr(`Entendido, ${paso.nombre}: no guardo tu voz.`, `Got it, ${paso.nombre}: I won’t keep your voice.`) : tr(`Como no escuché un «sí», no guardé la voz de ${paso.nombre}.`, `I didn’t hear a “yes”, so I didn’t keep ${paso.nombre}’s voice.`));
          return true;
        }
        if (esCancelar(dicho)) {
          inscripcion.terminar();
          frase.current = null;
          await a.decir(tr('Va, lo dejo. No guardé nada.', 'Okay, I’ll stop. I didn’t keep anything.'));
          return true;
        }
        const trozos = tomarFrase();
        if (!trozos) {
          inscripcion.terminar();
          await sinTurbo();
          return true;
        }
        const r = inscripcion.agregar(trozos);
        if (r === 'lista') {
          await guardarInscripcion();
          return true;
        }
        const n = inscripcion.pendiente()?.frases.length || 1;
        await a.decir(n === 1 ? tr('Muy bien. Otra frase, por favor.', 'Good. Another sentence, please.') : tr('Una más.', 'One more.'), 'curioso');
        return true;
      }

      const p = pedidoDeVoces(dicho);
      if (!p) return false;
      // «Te presento a Ana» sin decir «voz»: si las caras están activas, es de ellas.
      if (p.tipo === 'presentar' && p.debil && (a.carasActivas || !activasRef.current)) return false;
      const necesitaActivas = p.tipo === 'aprender_mia' || p.tipo === 'presentar' || p.tipo === 'quien';
      if (necesitaActivas && !activasRef.current) {
        await a.decir(tr('Antes tienes que activar «reconocer voces». Te explico en la pantalla qué guardo.', 'First turn on “recognize voices”. I’ll explain on screen what I keep.'));
        if (!(await activar())) return true;
      }
      if ((p.tipo === 'olvidar' || p.tipo === 'olvidar_mia' || p.tipo === 'lista' || p.tipo === 'quien') && conocidas === null) await refrescar();
      switch (p.tipo) {
        case 'aprender_mia': {
          if (!a.oidoTurbo()) {
            await sinTurbo();
            return true;
          }
          inscripcion.empezarMia(a.nombre);
          frase.current = null;
          await a.decir(tr('Va. Dime una frase, la que quieras, con tu voz de siempre.', 'Okay. Say a sentence, anything, in your normal voice.'), 'curioso');
          return true;
        }
        case 'presentar': {
          if (!a.oidoTurbo()) {
            await sinTurbo();
            return true;
          }
          inscripcion.empezarConocido(p.nombre, p.parentesco);
          frase.current = null;
          await a.decir(
            tr(
              `Hola, ${p.nombre}. ¿Puedo recordar tu voz? Solo guardo unos números, no la grabación, y ${a.nombre} puede borrarlos cuando quiera. Di «sí» o «no».`,
              `Hi, ${p.nombre}. May I remember your voice? I only keep some numbers, not the recording, and ${a.nombre} can erase them anytime. Say “yes” or “no”.`
            ),
            'curioso'
          );
          return true;
        }
        case 'olvidar':
        case 'olvidar_mia': {
          const c = p.tipo === 'olvidar_mia' ? conocidasRef.current.find((x) => x.relacion === 'yo') : buscarPorNombre(p.nombre);
          if (!c) {
            await a.decir(p.tipo === 'olvidar_mia' ? tr('No tengo guardada tu voz.', 'I don’t have your voice saved.') : tr(`No conozco la voz de ${p.nombre}.`, `I don’t know ${p.nombre}’s voice.`));
            return true;
          }
          try {
            await olvidarVoz(c.id);
            await refrescar();
            ultima.olvidar();
            ident.olvidar();
            await a.decir(p.tipo === 'olvidar_mia' ? tr('Listo, olvidé tu voz.', 'Done, I forgot your voice.') : tr(`Listo, olvidé la voz de ${c.nombre}.`, `Done, I forgot ${c.nombre}’s voice.`));
          } catch {
            await a.decir(tr('No pude borrarla ahora. Inténtalo con conexión.', 'I couldn’t erase it now. Try again when online.'), 'preocupado');
          }
          return true;
        }
        case 'olvidar_todas':
          confirmarBorrarTodas();
          await a.decir(tr('Para olvidar todas las voces, confírmalo en la pantalla.', 'To forget all voices, confirm on the screen.'));
          return true;
        case 'lista': {
          const l = conocidasRef.current;
          const en = idiomaActual() === 'en';
          await a.decir(
            l.length
              ? tr(`Conozco la voz de ${l.map((c) => (c.relacion === 'yo' ? `${c.nombre}, que eres tú` : nombreCon(c))).join('; ')}.`, `I know the voice of ${l.map((c) => (c.relacion === 'yo' ? `${c.nombre}, that’s you` : nombreCon(c, en))).join('; ')}.`)
              : tr('Todavía no conozco ninguna voz.', 'I don’t know any voices yet.')
          );
          return true;
        }
        case 'quien': {
          if (!a.oidoTurbo()) {
            await sinTurbo();
            return true;
          }
          if (!conocidasRef.current.length) {
            await a.decir(tr('Todavía no conozco ninguna voz. Di «aprende mi voz» para empezar.', 'I don’t know any voices yet. Say “learn my voice” to start.'));
            return true;
          }
          // La pregunta misma es una frase: si se está reconociendo, se espera un momento.
          await ident.esperarUltima(6_000);
          const r = ultima.fresca(15_000);
          if (r === undefined) {
            await a.decir(tr('Dime una frase un poco más larga y te digo quién habla.', 'Say a slightly longer sentence and I’ll tell you who’s speaking.'));
            return true;
          }
          const en = idiomaActual() === 'en';
          await a.decir(
            r
              ? r.relacion === 'yo'
                ? tr(`Por la voz, eres tú, ${r.nombre}.`, `By your voice, it’s you, ${r.nombre}.`)
                : tr(`Por la voz, eres ${nombreCon(r as PersonaVoz)}.`, `By your voice, you’re ${nombreCon(r as PersonaVoz, en)}.`)
              : tr('No reconozco esta voz, o no estoy segura. Prefiero no adivinar.', 'I don’t recognize this voice, or I’m not sure. I’d rather not guess.')
          );
          return true;
        }
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activar, conocidas, confirmarBorrarTodas, guardarInscripcion, ident, inscripcion, refrescar, sinTurbo, ultima]
  );

  const paraTurno = useCallback(
    async (oidaEn: number, o: { caraDuenaEn?: number } = {}): Promise<{ frase: string; quienHabla?: QuienHablaTurno }> => {
      // Sin voces activas o sin conocidas no hay nada que esperar (el turno no se demora ni un milisegundo).
      if (!activasRef.current || !conocidasRef.current.length || !oidaEn) return { frase: '' };
      // Lo de ESA frase; si no se supo (un «sí» corto, la consulta tardó), la precaución de la última voz que no es la
      // dueña (revisión 7.5, M1′): solo frena, nunca da permiso.
      // Con su voz guardada, una frase larga que no es de nadie conocido va como `desconocida` (modo invitado).
      // Revisión 7 (G2): con su voz guardada, lo que no se confirma como suyo va como `incierta` (modo invitado).
      return quienHablaDelTurno(ident, oidaEn, op.current.nombre, idiomaActual() === 'en', conocidasRef.current.some((c) => c.relacion === 'yo'), o);
    },
    [ident]
  );

  const estadoTexto = !activas ? tr('Apagado', 'Off') : conocidas?.length ? tr(`Conozco ${conocidas.length}`, `I know ${conocidas.length}`) : tr('Activado', 'On');

  return { activas, estadoTexto, abrirOpciones, manejar, paraTurno, alTerminarFrase };
}
