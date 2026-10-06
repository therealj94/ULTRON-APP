/**
 * APRENDER UNA CARA POR VOZ, CON PERMISO (lo que no es React: se prueba en Node, pruebas/caras/aprender.prueba.mjs).
 *
 * José, 6-oct, con su hija en la mesa: «Me acompaña mi hija» → AU-RA adivinó dos nombres de la memoria familiar; «Reconoce
 * a [ella]» → «no puedo identificar personas por su cara». Las dos cosas eran falsas: el motor de caras del teléfono
 * reconoce a quien está guardado y puede aprender a alguien nuevo. Ahora la mesa lo atiende sola, con el motor:
 *
 *  · «¿Quién está conmigo?», «¿quién es ella?», «¿la reconoces?»: los nombres que el motor confirmó; a quien no conoce lo
 *    dice así («veo a alguien que todavía no conozco») y ofrece aprenderlo: «¿Cómo se llama? Si quieres, aprendo su cara y
 *    la recuerdo». Nunca un nombre que el motor no confirmó (ni de la memoria, ni del hilo).
 *  · «Me acompaña mi hija»: si a la vista hay alguien sin nombre, lo mismo (con «¿cómo se llama tu hija?»); si no, la
 *    frase sigue al cerebro como cualquier charla.
 *  · «Reconoce a Bea»: si Bea está guardada, mira si está; si no, «todavía no conozco la cara de Bea» y la presentación.
 *  · La respuesta de la dueña («Se llama Bea», «Bea», «es mi hija Bea») → la presentación de siempre: «Hola, Bea. ¿Te
 *    puedo recordar?…». SOLO el «sí» de la persona misma, dentro del plazo, la guarda: poses dichas en voz alta, la cara
 *    que NO es la dueña (caraDelPresentado; con dos desconocidos parecidos, ninguna), y al servidor con la frase dicha
 *    como constancia. Un «no», silencio o cualquier otra cosa: nada se guarda.
 *  · Para invitados no: la mesa pasa estos pedidos y la respuesta con el nombre por «¿quién habla?» (privadoLocal.ts)
 *    antes de llegar aquí; el «sí» de la persona presentada no (es justo ella quien lo dice).
 *
 * Revisión del 6-oct:
 *  · Mientras se espera el nombre (45 s) o el «sí», una ORDEN («apaga la cámara», «olvida a Bea», «cállate», «cuelga»,
 *    cualquier comando que la mesa conoce) o una PREGUNTA («¿qué hora es?») va primero: suelta la espera y sigue su camino
 *    (interrumpeEspera). Antes «qué hora es» se tomaba como el nombre «Hora» y «apaga la cámara» no se ejecutaba.
 *  · Con la dueña SIN su cara guardada, una cara sin nombre puede ser la suya: con dos o más no se ofrece aprender (no se
 *    sabe cuál es la nueva); con una, la dueña confirma primero que esa cara es la persona nueva, sin ella en cuadro.
 */
import { tr } from '../i18n';
import { interpretar } from '../lib/intenciones';
import { pedidoDeCamara } from '../lib/camaraModo';
import { pedidoDeVista } from '../lib/vistaEnVivo';
import { pedidoDeVoces } from '../voces/voces';
import {
  MUESTRAS_APRENDER,
  OfertaAprender,
  Presentacion,
  caraDelPresentado,
  esConsentimiento,
  fraseOfertaAprender,
  nombreConMarca,
  nombreDeRespuesta,
  ofertaSinDuena,
  pedidoDeCaras,
  respuestaQuien,
  type CaraConocida,
  type CaraVista,
  type Reconocida,
  type Relacion,
} from './caras';
import type { Consentimiento } from './api';

type Quien = Pick<Reconocida, 'nombre' | 'relacion' | 'parentesco'>;
type Emocion = 'feliz' | 'preocupado' | 'curioso' | 'neutral';

export type IoAprender = {
  decir: (texto: string, emocion?: Emocion) => Promise<void>;
  en: () => boolean;
  /** El nombre de la dueña de la cuenta. */
  nombreDuena: () => string;
  asegurarCamara: () => Promise<boolean>;
  /**
   * Quién está a la vista AHORA según el motor de caras: los nombres que confirmó y cuántas caras sin nombre (con la
   * dueña sin guardar, la suya cuenta entre las sin nombre). Lo seguido por la cámara si es claro; si no, una foto aparte.
   */
  presentes: () => Promise<{ r: Quien[]; sinNombre: number }>;
  conocidas: () => CaraConocida[];
  /** Las tomas de las poses (dichas en voz alta), con la cara que dice `elegir` de cada foto. */
  tomarPoses: (elegir: (caras: CaraVista[]) => CaraVista | null) => Promise<CaraVista[]>;
  /** Al servidor (api.ts guardarCara) y la lista de conocidas al día. */
  guardar: (o: { nombre: string; relacion: Relacion; vectores: number[][]; consentimiento: Consentimiento; parentesco?: string }) => Promise<void>;
  /** Ya se le saludó (al conocerla): que no se le salude otra vez en la sesión. */
  saludado?: (nombre: string) => void;
  /** La dueña dijo su propio nombre y su cara no está guardada: «conóceme». */
  conoceme: () => Promise<void>;
};

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Empieza como pregunta: «qué hora es», «¿cómo estás?», «cuándo…». */
const RE_PREGUNTA = /^(que|quien|quienes|como|cuando|donde|adonde|cual|cuales|cuanto|cuanta|cuantos|cuantas|por que|para que|sabes|puedes|me dices)\b/;

/**
 * ¿La frase es una orden que la mesa conoce o una pregunta? Entonces no es la respuesta a «¿cómo se llama?» ni el «sí»
 * de la presentada: se suelta la espera y la frase sigue su camino (la cámara, olvidar, callar, colgar, la hora…).
 */
export function interrumpeEspera(dicho: string): boolean {
  const t = sinTildes(String(dicho || '')).replace(/[.,;:!¡"«»]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/[¿?]/.test(t) || RE_PREGUNTA.test(t)) return true;
  if (pedidoDeCaras(dicho) || pedidoDeCamara(dicho) || pedidoDeVoces(dicho)) return true;
  if (pedidoDeVista(dicho, { vistaAbierta: false }) || pedidoDeVista(dicho, { vistaAbierta: true })) return true;
  // Lo que la mesa atiende sola (callar, colgar, la hora, dormir, un modo, «mira»…). «Hola» y «gracias» también sueltan
  // la espera (no son un nombre); el resto («cerebro») puede ser la respuesta.
  return interpretar(dicho, { dormido: false, enConocer: false }).tipo !== 'cerebro';
}

/** Un «sí» delante de la respuesta: «sí, se llama Bea», «claro, Bea». */
const conSi = (dicho: string) => /^(si|sip|claro|exacto|eso|asi es|correcto)\b/.test(sinTildes(String(dicho || '').trim()));

export class AprenderPorVoz {
  readonly presentacion: Presentacion;
  readonly oferta: OfertaAprender;
  /** El parentesco dicho al presentar («mi esposa Ana»), hasta su «sí». */
  private parentescoPendiente: string | undefined;

  constructor(private io: IoAprender, reloj: () => number = Date.now) {
    this.presentacion = new Presentacion(reloj);
    this.oferta = new OfertaAprender(reloj);
  }

  /** ¿La cara de la dueña está guardada? Si no, una cara sin nombre a la vista puede ser la suya. */
  private duenaGuardada(): boolean {
    return this.io.conocidas().some((c) => c.relacion === 'yo');
  }

  /**
   * ¿Es la respuesta de la dueña a «¿cómo se llama?»? (la mesa la pasa por «¿quién habla?»: la contesta la dueña). Solo
   * si de verdad trae un nombre (o el «sí» que confirma la cara de la persona nueva): un invitado que diga otra frase corta
   * no recibe «eso es de la dueña».
   */
  esperaNombre(dicho: string): boolean {
    const of = this.oferta.pendiente();
    if (!of) return false;
    const r = nombreDeRespuesta(dicho);
    if (!r || (!nombreConMarca(dicho) && interrumpeEspera(dicho))) return false;
    return r.tipo === 'nombre' || (r.tipo === 'si' && !!of.nombre);
  }

  /**
   * La frase de la mesa (o del cerebro) ofreció aprender una cara con `sinNombre` caras sin nombre a la vista: se espera
   * el nombre. Con la dueña sin guardar: con una cara, se pedirá confirmar que es la persona nueva; con más, nada.
   */
  ofrecida(parentesco?: string, sinNombre = 1) {
    if (this.duenaGuardada()) this.oferta.empezar(parentesco);
    else if (sinNombre === 1) this.oferta.empezar(parentesco, { soloNueva: true });
  }

  /** Borrar u olvidar en medio: nada queda esperando. */
  terminar() {
    this.presentacion.terminar();
    this.oferta.terminar();
    this.parentescoPendiente = undefined;
  }

  private buscar(nombre: string): CaraConocida | undefined {
    const n = sinTildes(nombre);
    const l = this.io.conocidas();
    return l.find((c) => sinTildes(c.nombre) === n) || l.find((c) => sinTildes(c.nombre).includes(n) || n.includes(sinTildes(c.nombre)));
  }

  /**
   * Lo que se contesta a algo que la mesa preguntó: el «sí» de la presentada (solo eso la guarda) y el nombre que se
   * ofreció aprender. true si lo atendió; false si la frase no era eso (la espera se suelta y la frase sigue su camino:
   * una orden o una pregunta, siempre).
   */
  async respuesta(dicho: string): Promise<boolean> {
    const io = this.io;
    const nombrePendiente = this.presentacion.pendiente();
    if (nombrePendiente) {
      const r = esConsentimiento(dicho);
      this.presentacion.terminar();
      const parentesco = this.parentescoPendiente;
      this.parentescoPendiente = undefined;
      // «Apaga la cámara», «olvida a Bea», «¿qué hora es?»: no es su respuesta; nada se guarda y la orden se cumple.
      if (r !== 'si' && interrumpeEspera(dicho)) return false;
      if (r === 'si') {
        await this.guardarPresentada(nombrePendiente, dicho, parentesco);
        return true;
      }
      await io.decir(r === 'no' ? tr(`Entendido, ${nombrePendiente}: no te guardo.`, `Got it, ${nombrePendiente}: I won’t keep you.`) : tr(`Como no escuché un «sí», no guardé a ${nombrePendiente}.`, `I didn’t hear a “yes”, so I didn’t keep ${nombrePendiente}.`));
      return true;
    }
    const of = this.oferta.pendiente();
    if (!of) return false;
    const r = nombreDeRespuesta(dicho);
    // Primero las órdenes y las preguntas (salvo «se llama Bea» / «es Bea», que es la respuesta aunque suene a otra cosa).
    if (!r || (!nombreConMarca(dicho) && interrumpeEspera(dicho))) {
      this.oferta.terminar();
      return false;
    }
    if (r.tipo === 'no') {
      this.oferta.terminar();
      await io.decir(tr('Está bien, no la guardo.', 'Okay, I won’t keep it.'));
      return true;
    }
    if (r.tipo === 'si') {
      // Confirmó que la única cara a la vista es la de la persona nueva (la dueña sin guardar): ahora sí, la presentación.
      if (of.nombre) {
        this.oferta.terminar();
        await this.presentar(of.nombre, of.parentesco);
        return true;
      }
      // Un «sí» sin nombre: se pregunta el nombre (con la dueña sin guardar, sigue haciendo falta confirmar la cara: ante
      // la duda, se pregunta otra vez con el nombre).
      this.oferta.empezar(of.parentesco, of.soloNueva ? { soloNueva: true } : {});
      await io.decir(tr('¿Cómo se llama?', 'What’s their name?'), 'curioso');
      return true;
    }
    this.oferta.terminar();
    const parentesco = r.parentesco || of.parentesco;
    // La dueña dijo su propio nombre: si su cara no está, es «conóceme» (no se la guarda como «conocida» de sí misma).
    if (sinTildes(r.nombre).split(' ')[0] === sinTildes(io.nombreDuena()).split(' ')[0]) {
      if (!this.duenaGuardada()) {
        await io.conoceme();
        return true;
      }
      this.oferta.empezar(of.parentesco);
      await io.decir(tr(`A ti ya te conozco, ${r.nombre}. ¿Cómo se llama la otra persona?`, `I already know you, ${r.nombre}. What’s the other person’s name?`), 'curioso');
      return true;
    }
    const ya = this.buscar(r.nombre);
    if (ya) {
      await io.decir(
        tr(
          `Ya tengo guardada a ${ya.nombre}, pero ahora no la reconocí. Que mire de frente a la cámara, con luz; si sigue sin salir, di «olvida a ${ya.nombre}» y me la presentas otra vez.`,
          `I already have ${ya.nombre} saved, but I didn’t recognize them just now. Have them face the camera in good light; if it still fails, say “forget ${ya.nombre}” and introduce them again.`
        ),
        'preocupado'
      );
      return true;
    }
    // La dueña sin guardar y una sola cara a la vista (puede ser la suya): el nombre solo no basta, falta su «sí» a que esa
    // cara es la de la persona nueva. Con «sí, se llama Bea» ya lo dijo.
    if (of.soloNueva && !conSi(dicho)) {
      this.oferta.empezar(parentesco, { soloNueva: true, nombre: r.nombre });
      await io.decir(ofertaSinDuena(1, { nombre: r.nombre }, io.en()).texto, 'curioso');
      return true;
    }
    await this.presentar(r.nombre, parentesco);
    return true;
  }

  /** «Te presento a Ana» (o el nombre que la dueña acaba de decir): se le pregunta a Ana, en voz alta, si la puedo recordar. */
  async presentar(nombre: string, parentesco?: string, antes = ''): Promise<void> {
    const io = this.io;
    if (!(await io.asegurarCamara())) {
      await io.decir(tr('Necesito la cámara para conocer a alguien.', 'I need the camera to meet someone.'), 'preocupado');
      return;
    }
    this.oferta.terminar();
    this.presentacion.empezar(nombre);
    this.parentescoPendiente = parentesco;
    await io.decir(
      `${antes ? `${antes} ` : ''}${tr(
        `Hola, ${nombre}. ¿Te puedo recordar? Solo guardo unos números de tu cara, no fotos, y ${io.nombreDuena()} puede borrarlos cuando quiera. Dime «sí» o «no».`,
        `Hi, ${nombre}. May I remember you? I only keep some numbers from your face, not photos, and ${io.nombreDuena()} can erase them anytime. Say “yes” or “no”.`
      )}`,
      'curioso'
    );
  }

  /** Después del «sí»: las poses frente a la cámara, la cara que NO es la dueña, y al servidor. */
  private async guardarPresentada(nombre: string, frase: string, parentesco?: string): Promise<void> {
    const io = this.io;
    const duena = this.duenaGuardada();
    // Sin la cara de la dueña guardada no hay cómo apartarla: solo la persona nueva frente a la cámara.
    await io.decir(
      duena
        ? tr(`Gracias, ${nombre}. Te pido unas poses para aprender bien tu cara.`, `Thanks, ${nombre}. A few poses so I learn your face well.`)
        : tr(`Gracias, ${nombre}. Que solo quede tu cara frente a la cámara, y te pido unas poses.`, `Thanks, ${nombre}. Keep only your face in front of the camera; a few poses now.`),
      'feliz'
    );
    const conocidas0 = io.conocidas();
    const caras = await io.tomarPoses((cs) => caraDelPresentado(cs, conocidas0));
    if (!caras.length) {
      this.presentacion.empezar(nombre);
      this.parentescoPendiente = parentesco;
      await io.decir(
        duena
          ? tr(
              `No te veo bien, ${nombre}, o hay otra persona que no conozco junto a ti. Que solo quede tu cara frente a la cámara y dime «sí» otra vez.`,
              `I can’t see you well, ${nombre}, or there’s someone else I don’t know next to you. Have only your face in front of the camera and say “yes” again.`
            )
          : tr(
              `Veo más de una cara, ${nombre}, y a ${io.nombreDuena()} todavía no la conozco: no sé cuál es la tuya. Que solo quede tu cara frente a la cámara y dime «sí» otra vez, o que ${io.nombreDuena()} me diga primero «conóceme».`,
              `I see more than one face, ${nombre}, and I don’t know ${io.nombreDuena()} yet: I can’t tell which is yours. Have only your face in front of the camera and say “yes” again, or have ${io.nombreDuena()} say “get to know me” first.`
            ),
        'preocupado'
      );
      return;
    }
    try {
      await io.guardar({ nombre, relacion: 'conocido', vectores: caras.slice(0, MUESTRAS_APRENDER).map((c) => c.vector), consentimiento: { como: 'voz', frase }, ...(parentesco ? { parentesco } : {}) });
      io.saludado?.(nombre);
      await io.decir(tr(`¡Mucho gusto, ${nombre}! Ya te recuerdo. Solo guardé números, no fotos.`, `Nice to meet you, ${nombre}! I’ll remember you. I only kept numbers, no photos.`), 'feliz');
    } catch (e) {
      await io.decir(tr(`No pude guardarte ahora, ${nombre}: ${String((e as Error)?.message || 'sin conexión')}`, `I couldn’t save you now, ${nombre}.`), 'preocupado');
    }
  }

  /**
   * Ofrecer aprender a quien no conozco (hay `vista.sinNombre` > 0). Con la dueña guardada, la oferta de siempre (o, con el
   * nombre dicho, la presentación); sin ella, ofertaSinDuena: con dos o más caras, nada; con una, que confirme primero.
   */
  private async ofrecerA(vista: { sinNombre: number }, p: { parentesco?: string; nombre?: string }, antes: string): Promise<void> {
    const io = this.io;
    if (this.duenaGuardada()) {
      if (p.nombre) return this.presentar(p.nombre, p.parentesco, antes);
      this.oferta.empezar(p.parentesco);
      return io.decir(fraseOfertaAprender(p.parentesco, io.en()), 'curioso');
    }
    const o = ofertaSinDuena(vista.sinNombre, p, io.en());
    if (o.espera) this.oferta.empezar(p.parentesco, { soloNueva: true, ...(p.nombre ? { nombre: p.nombre } : {}) });
    await io.decir(o.texto, 'curioso');
  }

  /** «¿Quién está conmigo?», «¿quién es ella?»: lo que el motor confirmó, y a quien no conoce, la oferta de aprenderlo. */
  async quien(): Promise<void> {
    const io = this.io;
    const p = await io.presentes();
    if (p.sinNombre > 0 && !this.duenaGuardada()) {
      const o = ofertaSinDuena(p.sinNombre, {}, io.en());
      if (o.espera) this.oferta.empezar(undefined, { soloNueva: true });
      const vistos = p.r.length ? `${respuestaQuien({ r: p.r, sinNombre: 0 }, io.en()).texto} ` : '';
      await io.decir(`${vistos}${o.texto}`, 'curioso');
      return;
    }
    const r = respuestaQuien(p, io.en());
    if (r.ofrecer) this.oferta.empezar();
    await io.decir(r.texto, r.ofrecer ? 'curioso' : 'neutral');
  }

  /** «Reconoce a Bea», «¿reconoces a mi hija?», «aprende su cara». */
  async reconocer(p: { nombre?: string; parentesco?: string }): Promise<void> {
    const io = this.io;
    if (!(await io.asegurarCamara())) {
      await io.decir(tr('Necesito la cámara para reconocer a alguien.', 'I need the camera to recognize someone.'), 'preocupado');
      return;
    }
    const guardada = p.nombre ? this.buscar(p.nombre) : p.parentesco ? io.conocidas().find((c) => c.parentesco === p.parentesco) : undefined;
    const vista = await io.presentes();
    if (guardada) {
      if (vista.r.some((x) => sinTildes(x.nombre) === sinTildes(guardada.nombre))) {
        await io.decir(tr(`Sí, veo a ${guardada.nombre}${guardada.parentesco ? `, tu ${guardada.parentesco}` : ''}.`, `Yes, I see ${guardada.nombre}.`), 'feliz');
      } else if (vista.sinNombre) {
        await io.decir(tr(`Veo a alguien, pero no lo reconozco como ${guardada.nombre}. Que mire de frente a la cámara un momento.`, `I see someone, but I don’t recognize them as ${guardada.nombre}. Have them look straight at the camera for a moment.`), 'curioso');
      } else {
        await io.decir(tr(`Ahora no veo a ${guardada.nombre} frente a la cámara.`, `I don’t see ${guardada.nombre} in front of the camera right now.`));
      }
      return;
    }
    const antes = p.nombre ? tr(`Todavía no conozco la cara de ${p.nombre}.`, `I don’t know ${p.nombre}’s face yet.`) : '';
    // No la conozco todavía y hay alguien sin nombre a la vista: la oferta (con la dueña sin guardar, con cuidado).
    if (vista.sinNombre) return this.ofrecerA(vista, p, antes);
    // Con el nombre dicho y nadie sin nombre a la vista: la presentación (las poses esperan su cara; su «sí» la guarda).
    if (p.nombre) return this.presentar(p.nombre, p.parentesco, antes);
    await io.decir(respuestaQuien(vista, io.en()).texto);
  }

  /**
   * «Me acompaña mi hija»: si a la vista hay alguien sin nombre, la verdad y la oferta (o, con el nombre dicho, la
   * presentación). false: no hay nadie sin nombre a la vista; la frase sigue al cerebro como cualquier charla.
   */
  async acompanante(p: { parentesco?: string; nombre?: string }): Promise<boolean> {
    const vista = await this.io.presentes();
    if (!vista.sinNombre) return false;
    const nuevo = p.nombre && !this.buscar(p.nombre) ? p.nombre : undefined;
    await this.ofrecerA(vista, { parentesco: p.parentesco, ...(nuevo ? { nombre: nuevo } : {}) }, tr('Veo a alguien que todavía no conozco.', 'I see someone I don’t know yet.'));
    return true;
  }
}
