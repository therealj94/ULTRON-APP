/**
 * SU COMPUTADORA, EN VIVO EN TODA LA APP (José, 2-oct: «abrió la página y se quedó ahí… que tenga manos y
 * las use hasta terminar, que me acompañe y diga "estoy trabajando"»).
 *
 * Se monta una vez en la raíz (AppAura, dentro de la voz) y dibuja encima de cualquier pantalla:
 *  · la vista en vivo de su computadora (ajustes/Computadora.tsx, HojaComputadoraVivo) y sus correos
 *    (ajustes/Correos.tsx): «abre tu computadora» / «abre mis correos» dichos en Ajustes, en los chats o en
 *    la mesa las abren igual (app/hojas.ts);
 *  · lo que su computadora le cuenta por el canal de acciones (server/computadora.ts → `computadora`):
 *    al empezar una tarea la vista se abre sola y suena el tecleo bajito; los avances («Ya entré a
 *    bch.hn.», «Estoy leyendo la página.») y el resultado los dice AURA con su voz (el bus `lectura`: en
 *    la conversación tal cual, con el boleto; sin ella, con la voz de la mesa), sin hablarle encima a
 *    nadie (compa/computadora.ts, CompaneroPc).
 * Mientras trabaja se pregunta despacio por su estado: si un aviso se perdió, el tecleo no se queda sonando.
 *
 * Al lado, las hojas de lo que AURA lleva de ti (app/HojasCerebro.tsx): misiones, lo que sabe de ti y tu círculo.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { api } from '../lib/api';
import { miga } from '../lib/reporte';
import { sfxActivos } from '../lib/sfx';
import { usePerfil } from '../lib/perfil';
import { de } from '../i18n';
import { avatarPorId } from '../avatares/catalogo';
import { emitir, escuchar } from '../nucleo/contrato';
import { useVozOpcional } from '../compa/VozProvider';
import { ecoMesa, mensajeVoz, nivelOido } from '../compa/canales';
import { CompaneroPc, esAccionPc, trabajando, type EstadoPc } from '../compa/computadora';
import { tecleoPc } from '../compa/computadoraSonido';
import { HojaComputadoraVivo } from '../ajustes/Computadora';
import { HojaCorreos } from '../ajustes/Correos';
import { abrirHoja, anunciarAnfitrion, cerrarHoja, hojasAhora, suscribirHojas } from './hojas';
import { HojasCerebro } from './HojasCerebro';

/** La voz de la persona por encima de esto es que está hablando (el anillo que late). */
const NIVEL_HABLA = 0.15;
/** Mientras trabaja, cada cuánto se pregunta por su estado (por si un aviso se perdió). */
const SONDEO_MS = 8_000;

export function ComputadoraEnVivo() {
  const perfil = usePerfil();
  const nombreAvatar = de(avatarPorId(perfil?.avatar ?? 'aura').nombre);
  const voz = useVozOpcional();
  const vozRef = useRef(voz);
  vozRef.current = voz;
  const hojas = useSyncExternalStore(suscribirHojas, hojasAhora, hojasAhora);

  // Lo que deja sonar el tecleo: lo quiere la computadora, los sonidos están activos (y no hay llamada de
  // PULSE2CHAT), la app delante y la conversación no tiene puesto ya su propio sonido de fondo.
  const quiere = useRef(false);
  const ambienteConv = useRef(false);
  const ajustarSonido = useRef(() => {});
  ajustarSonido.current = () => {
    const puede = quiere.current && sfxActivos() && AppState.currentState === 'active' && !ambienteConv.current && !vozRef.current?.vista.suspendida;
    if (puede) void tecleoPc.poner();
    else tecleoPc.quitar();
  };

  const comp = useRef<CompaneroPc | null>(null);
  if (!comp.current)
    comp.current = new CompaneroPc({
      abrirVista: (id) => abrirHoja('computadora', { tareaId: id }),
      // En una llamada de PULSE2CHAT no se le abre nada encima.
      puedeAbrir: () => !vozRef.current?.vista.suspendida,
      decir: (texto, boleto) => emitir('lectura', { texto, ...(boleto ? { boleto } : {}) }),
      sonido: (on) => {
        quiere.current = on;
        ajustarSonido.current();
      },
      ocupado: () => {
        const m = ecoMesa.ultimo();
        return m.hablando || m.pensando || vozRef.current?.vista.estado === 'hablando' || nivelOido.ultimo() > NIVEL_HABLA;
      },
      miga,
    });
  const companero = comp.current;
  const estadoComp = useSyncExternalStore(
    (f) => companero.suscribir(f),
    () => `${companero.tareaId}|${companero.trabajando}|${companero.ultimaFrase}`,
    () => ''
  );
  void estadoComp;

  // La raíz dibuja las hojas: la mesa y Ajustes ya no dibujan la suya (HojaComputadora solo la abre).
  useEffect(() => anunciarAnfitrion(), []);

  // Los avisos de su computadora; la persona hablando; el sonido de la conversación; la app detrás.
  useEffect(() => {
    const offAccion = escuchar('accion', (a) => {
      if (esAccionPc(a)) companero.alAccion(a);
    });
    const offAmbiente = escuchar('ambiente', (a) => {
      ambienteConv.current = !!a.on;
      ajustarSonido.current();
    });
    const offMensaje = mensajeVoz.escuchar((m) => {
      // Lo que manda el propio teléfono a la conversación (`[[lectura:…]]`, la voz de estos avisos) no es la persona.
      if (m?.rol === 'usuario' && !/^\s*\[\[/.test(m.texto)) companero.personaHablo();
    });
    const offNivel = nivelOido.escuchar((l) => {
      if (l > NIVEL_HABLA) companero.personaHablo();
    });
    // La mesa se puso a pensar: la persona acaba de decirle algo.
    const offMesa = ecoMesa.escuchar((m) => {
      if (m.pensando) companero.personaHablo();
    });
    const offLlamada = escuchar('llamada', () => setTimeout(() => ajustarSonido.current(), 0));
    const app = AppState.addEventListener('change', () => ajustarSonido.current());
    return () => {
      offAccion();
      offAmbiente();
      offMensaje();
      offNivel();
      offMesa();
      offLlamada();
      app.remove();
      companero.parar();
      tecleoPc.quitar();
    };
  }, [companero]);

  // Mientras trabaja: su estado, despacio (por si el «termina» se perdió con la app detrás o sin red).
  const sigueTrabajando = companero.trabajando;
  useEffect(() => {
    if (!sigueTrabajando) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      // Con la vista abierta, ella ya pregunta (cada 2,5 s): no se suma otra consulta al mismo límite.
      if (hojasAhora().abierta !== 'computadora') {
        try {
          const s = await api<EstadoPc>('/api/computadora', { method: 'GET' }, 12_000);
          if (vivo && s.actual) companero.alEstado(s.actual.id, trabajando(s.actual.estado));
        } catch {
          /* la próxima vuelta */
        }
      }
      if (vivo && companero.trabajando) reloj = setTimeout(vuelta, SONDEO_MS);
    };
    reloj = setTimeout(vuelta, SONDEO_MS);
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [sigueTrabajando, companero]);

  return (
    <>
      <HojaComputadoraVivo
        visible={hojas.abierta === 'computadora'}
        onCerrar={() => {
          cerrarHoja();
          companero.vistaCerrada();
        }}
        nombreAvatar={nombreAvatar}
        tareaId={companero.tareaId || hojas.tareaId}
        frase={companero.ultimaFrase}
        alEstado={(id, ahora) => companero.alEstado(id, ahora)}
      />
      <HojaCorreos visible={hojas.abierta === 'correos'} onCerrar={cerrarHoja} />
      {/* Sus misiones, lo que sabe de ti y tu círculo (app/HojasCerebro.tsx), también desde cualquier pantalla. */}
      <HojasCerebro />
    </>
  );
}
