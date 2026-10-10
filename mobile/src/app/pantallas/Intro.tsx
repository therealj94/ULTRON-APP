/**
 * La ruta Intro: la apertura (src/screens/Arranque.tsx) mientras se carga de verdad lo que hace
 * falta, y la decisión de a dónde ir.
 *
 *   1. letra, vibración, idioma y avatar de la última vez (los ajustes del teléfono);
 *   2. la sesión guardada y su perfil (de la caché: el tema ya queda puesto antes de salir);
 *   3. las fotos de los avatares y los sonidos;
 *   4. el servidor (con tope: sin red se entra igual y se avisa);
 *   5. si Android cerró la app mientras la persona estaba en su wallet, se termina esa entrada.
 *
 * Con sesión: perfil completado → la mesa; sin completar → la primera vez. Sin sesión: la bienvenida
 * la primera vez en este teléfono, después directo a Entrar. Nunca se queda esperando algo que no
 * contesta: cada paso tiene su tope.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Asset } from 'expo-asset';
import * as SplashScreen from 'expo-splash-screen';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { APP_VERSION, type SessionUser } from '../../config';
import { comprobarSesion, healthCheck } from '../../lib/api';
import { retomarSiVolvio, type ResultadoGenesis } from '../../lib/genesis';
import { cargarPerfil } from '../../lib/perfil';
import { iniciarReporte, miga } from '../../lib/reporte';
import { preloadSfx } from '../../lib/sfx';
import { loadCreds, loadSession, loadSettings } from '../../lib/storage';
import { generacionCuenta, sigueVigente } from '../../lib/cuenta';
import { setAvatarVoz } from '../../lib/tts';
import { orientar } from '../../lib/orientacion';
import { fijarIdioma, tr, useIdioma } from '../../i18n';
import { FOTOS_CLAUDIO } from '../../avatares/ClaudioRetrato';
import { FOTOS_CLAUDIO_PIE } from '../../avatares/ClaudioDePie';
import { Arranque } from '../../screens/Arranque';
import { cargarHapticos } from '../../ui/hapticos';
import { FUENTES_ICONOS } from '../../ui/Icono';
import { cargarFuentes } from '../../ui/tipografia';
import type { RaizParams } from '../rutas';
import { reiniciarA, reiniciarAClave } from '../rutas';
import { bienvenidaVista, entrarCon, fijarUsuario, soltarSesionCaida, type Compartido } from '../sesion';
import { buzonHablar } from '../../entrada/enlace';

type Props = NativeStackScreenProps<RaizParams, 'Intro'>;

type Paso = 'ajustes' | 'sesion' | 'avatares' | 'voces' | 'servidor';
const PASOS: Paso[] = ['ajustes', 'sesion', 'avatares', 'voces', 'servidor'];

function textoPaso(p: Paso | undefined): string {
  switch (p) {
    case 'ajustes':
      return tr('Preparando todo', 'Getting everything ready');
    case 'sesion':
      return tr('Abriendo tu sesión', 'Opening your session');
    case 'avatares':
      return tr('Despertando a tus avatares', 'Waking up your avatars');
    case 'voces':
      return tr('Afinando las voces', 'Tuning the voices');
    case 'servidor':
      return tr('Conectando con el servidor', 'Connecting to the server');
    default:
      return tr('Listo', 'Ready');
  }
}

/** Una promesa con tope: el arranque nunca se queda esperando algo que no contesta. */
function conTope<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Las fotos de los avatares se decodifican durante la carga: al entrar ya están, sin parpadeo. */
async function precargarAvatares() {
  const fotos = [
    ...Object.values(FOTOS_CLAUDIO).flatMap((v) => (Array.isArray(v) ? v : [v])),
    ...Object.values(FOTOS_CLAUDIO_PIE),
    require('../../../assets/marca/logo-aura.png'),
    ...FUENTES_ICONOS,
  ].filter((m): m is number => typeof m === 'number');
  await Asset.loadAsync(fotos);
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ¿Hay en este teléfono una clave guardada de `correo` (detrás de la huella, o la que dejó la 5.6.0)? */
async function hayClaveGuardada(correo: string): Promise<boolean> {
  const c = await loadCreds().catch(() => null);
  return !!c && (!!c.conHuella || !!c.legado) && c.correo.trim().toLowerCase() === correo.trim().toLowerCase();
}

/**
 * La sesión terminó y nadie la pudo renovar. Con clave guardada de esa persona, a «Otras formas de entrar» (la clave o la
 * huella; Genesis ID queda detrás con «atrás»); sin ella, a Genesis ID.
 */
function irAEntrarTrasCaida(conClave: boolean) {
  if (conClave) {
    reiniciarAClave(tr('Tu sesión terminó. Entra con tu clave o con tu huella.', 'Your session ended. Sign in with your password or your fingerprint.'));
    return;
  }
  reiniciarA('Entrar', { desdeIntro: true, aviso: tr('Tu sesión terminó. Vuelve a entrar con tu Genesis ID.', 'Your session ended. Sign in again with your Genesis ID.') });
}

export function Intro(_: Props) {
  useIdioma();
  const [hechos, setHechos] = useState<Paso[]>([]);
  const [aviso, setAviso] = useState('');
  const [rapido, setRapido] = useState(false);
  const [salir, setSalir] = useState(false);
  const destino = useRef<(() => void) | null>(null);
  const marcar = (p: Paso) => setHechos((h) => (h.includes(p) ? h : [...h, p]));

  const arrancar = useCallback(async () => {
    const inicio = Date.now();
    await iniciarReporte();
    // La app arranca siempre en vertical (aunque el teléfono esté acostado); la mesa la suelta después
    // de la bienvenida. Primero el bloqueo y después se quita el nativo: así nunca asoma la intro
    // acostada (con tope, por si algún teléfono no contesta el bloqueo).
    await conTope(orientar('vertical'), 1_200);
    // El nativo se quita cuando la intro ya está pintada (negro sobre negro: no se nota el paso).
    void SplashScreen.hideAsync().catch(() => {});

    const [ajustes, sesion] = await Promise.all([loadSettings(), loadSession(), conTope(cargarFuentes(), 2_500), cargarHapticos()]);
    // La clave que dejó la 5.6.0 en claro ya NO se borra al abrir (revisión de #157, bloqueante 1): sigue renovando la
    // sesión sin preguntar y pasa detrás de la huella la primera vez que se entra con ella (lib/credsSeguras.ts).
    fijarIdioma(ajustes.idioma);
    setAvatarVoz(ajustes.avatar);
    setRapido(!!sesion);
    marcar('ajustes');

    // Con sesión, el perfil de la caché (tema, idioma y avatar ya aplicados); el servidor, por detrás.
    let completado = false;
    if (sesion) {
      fijarUsuario(sesion);
      const p = await conTope(cargarPerfil(sesion.correo, { nombre: sesion.name, esperarServidor: false }), 3_000);
      completado = !!p?.completado;
    }
    marcar('sesion');
    miga(sesion ? `sesión guardada (perfil ${completado ? 'completo' : 'por completar'})` : 'sin sesión');

    await conTope(precargarAvatares(), sesion ? 2_500 : 5_000);
    marcar('avatares');
    await conTope(preloadSfx(), 2_500);
    marcar('voces');
    // Sin servidor se entra igual (la mesa tiene modo local); solo se avisa.
    // Con sesión, de paso se pregunta si el servidor todavía la reconoce: un token vencido (el de
    // Genesis dura 14 días y no se renueva solo) dejaba a la persona «dentro» con todo roto.
    // «Hay servidor» = contestó cualquiera de las dos: la salud, o la sesión (viva o vencida, pero
    // contestada). Antes solo contaba la salud, que con la caché fría tardaba ~4,5 s contra un tope de
    // 2,5 s: salía «modo local» con el servidor vivo (1-oct, Samsung de José).
    // La comprobación NO pide la huella (la clave de antes sí renueva sola): si hace falta, «bloqueada» y la app enseña
    // «Toca para desbloquear» (components/AvisoDesbloqueo.tsx); el primer turno también la pide.
    const tServidor = Date.now();
    const comprobando = sesion ? comprobarSesion(sesion.correo) : null;
    const [saludResp, estadoSesion] = await Promise.all([conTope(healthCheck(), 4_000), comprobando ? conTope(comprobando, 4_000) : Promise.resolve(null)]);
    const salud = !!saludResp || (estadoSesion !== null && estadoSesion !== 'sin_red');
    miga(`servidor: ${salud ? 'contesta' : 'sin respuesta'} en ${Date.now() - tServidor} ms (salud ${saludResp ? 'sí' : 'no'}, sesión ${estadoSesion ?? '—'})`);
    if (!salud) setAviso(tr('Sin conexión con el servidor: entras en modo local', 'No connection to the server: you’re entering local mode'));
    marcar('servidor');
    const caida = !!sesion && estadoSesion === 'caida';
    if (caida) await soltarSesionCaida();
    // ¿Hay clave guardada de esta persona (detrás de la huella, o la de antes)? Entonces la salida es la clave o la
    // huella, no solo Genesis ID.
    const conClave = caida && sesion ? await conTope(hayClaveGuardada(sesion.correo), 1_500) : false;
    // El tope de 4 s pasó sin saber si la sesión sigue viva: se entra (sin red se entra igual), pero si después resulta
    // que venció, la persona se entera. «bloqueada» ya deja el aviso «Toca para desbloquear» puesto; «caida» (nadie
    // puede renovarla) la lleva a entrar otra vez, con su clave si la tiene.
    if (sesion && comprobando && estadoSesion === null) {
      const gen = generacionCuenta();
      void comprobando.then(async (tarde) => {
        if (tarde !== 'caida' || !sigueVigente(gen)) return;
        miga('sesión vencida (contestó después del tope de la intro): a la entrada');
        const clave = await hayClaveGuardada(sesion.correo).catch(() => false);
        if (!sigueVigente(gen)) return;
        await soltarSesionCaida();
        irAEntrarTrasCaida(clave);
      });
    }

    // ¿Volvía de la wallet cuando Android cerró la app?
    let vuelta: ResultadoGenesis | null = null;
    if (!sesion) vuelta = await conTope(retomarSiVolvio(), 20_000);
    const vista = sesion ? true : await bienvenidaVista();

    if (caida) {
      destino.current = () => irAEntrarTrasCaida(!!conClave);
    } else if (sesion) destino.current = () => reiniciarA(completado ? 'Mesa' : 'PrimeraVez', { desdeIntro: true });
    else if (vuelta && vuelta.ok) {
      const g = vuelta as ResultadoGenesis & { genesis?: Compartido };
      const u: SessionUser = { name: vuelta.miembro.nombre, role: vuelta.miembro.rol, correo: vuelta.miembro.correo };
      const intento = vuelta.intento;
      destino.current = () => void entrarCon(u, g.genesis || null, intento);
    } else if (vuelta && !vuelta.ok && vuelta.codigo !== 'CANCELADO') {
      const m = vuelta.codigo === 'PENDIENTE' ? tr('Tu acceso está en revisión.', 'Your access is under review.') : vuelta.mensaje;
      const codigo = vuelta.codigo;
      destino.current = () => reiniciarA('Entrar', { desdeIntro: true, aviso: m, codigo });
    } else destino.current = () => reiniciarA(vista ? 'Entrar' : 'Bienvenida', { desdeIntro: true });

    // La apertura se ve entera (más corta con sesión); con red lenta, lo que tarde la carga. Si la abrieron para HABLAR
    // (`ultronfp://hablar`, el «Abrir en AURA» de la burbuja) y hay sesión, sin espera: a la mesa en cuanto cargó, que
    // la persona ya está hablando (entrada/hablar.ts). Sin sesión, la entrada de siempre.
    const paraHablar = !!sesion && !caida && !!buzonHablar.pendiente(Date.now());
    if (paraHablar) miga('intro: la abrieron para hablar; sin la espera mínima');
    const minimo = paraHablar ? 0 : sesion ? 1_150 : 2_300;
    const falta = minimo - (Date.now() - inicio);
    if (falta > 0) await espera(falta);
    if (!salud && !paraHablar) await espera(700);
    setSalir(true);
  }, []);

  useEffect(() => {
    void arrancar();
  }, [arrancar]);

  const actual = PASOS.find((p) => !hechos.includes(p));
  return (
    <Arranque
      progreso={hechos.length / PASOS.length}
      texto={textoPaso(actual)}
      aviso={aviso}
      version={APP_VERSION}
      rapido={rapido}
      salir={salir}
      onFin={() => destino.current?.()}
    />
  );
}
