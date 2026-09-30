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
import { loadSession, loadSettings } from '../../lib/storage';
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
import { reiniciarA } from '../rutas';
import { bienvenidaVista, entrarCon, fijarUsuario, soltarSesionCaida, type Compartido } from '../sesion';

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
      return tr('Despertando al Guardián, a AU-RA y a Claudio', 'Waking up the Guardian, AU-RA and Claudio');
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
    // El nativo se quita cuando la intro ya está pintada (negro sobre negro: no se nota el paso).
    void SplashScreen.hideAsync().catch(() => {});
    // La app arranca siempre en vertical (aunque el teléfono esté acostado); la mesa la suelta después
    // de la bienvenida.
    void orientar('vertical');

    const [ajustes, sesion] = await Promise.all([loadSettings(), loadSession(), conTope(cargarFuentes(), 2_500), cargarHapticos()]);
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
    const [salud, estadoSesion] = await Promise.all([
      conTope(healthCheck(), sesion ? 2_500 : 4_000),
      sesion ? conTope(comprobarSesion(sesion.correo), 4_000) : Promise.resolve(null),
    ]);
    if (!salud) setAviso(tr('Sin conexión con el servidor: entras en modo local', 'No connection to the server: you’re entering local mode'));
    marcar('servidor');
    const caida = !!sesion && estadoSesion === 'caida';
    if (caida) await soltarSesionCaida();

    // ¿Volvía de la wallet cuando Android cerró la app?
    let vuelta: ResultadoGenesis | null = null;
    if (!sesion) vuelta = await conTope(retomarSiVolvio(), 20_000);
    const vista = sesion ? true : await bienvenidaVista();

    if (caida) {
      const m = tr('Tu sesión terminó. Vuelve a entrar con tu Genesis ID.', 'Your session ended. Sign in again with your Genesis ID.');
      destino.current = () => reiniciarA('Entrar', { desdeIntro: true, aviso: m });
    } else if (sesion) destino.current = () => reiniciarA(completado ? 'Mesa' : 'PrimeraVez', { desdeIntro: true });
    else if (vuelta && vuelta.ok) {
      const g = vuelta as ResultadoGenesis & { genesis?: Compartido };
      const u: SessionUser = { name: vuelta.miembro.nombre, role: vuelta.miembro.rol, correo: vuelta.miembro.correo };
      destino.current = () => void entrarCon(u, g.genesis || null);
    } else if (vuelta && !vuelta.ok && vuelta.codigo !== 'CANCELADO') {
      const m = vuelta.codigo === 'PENDIENTE' ? tr('Tu acceso está en revisión.', 'Your access is under review.') : vuelta.mensaje;
      const codigo = vuelta.codigo;
      destino.current = () => reiniciarA('Entrar', { desdeIntro: true, aviso: m, codigo });
    } else destino.current = () => reiniciarA(vista ? 'Entrar' : 'Bienvenida', { desdeIntro: true });

    // La apertura se ve entera (más corta con sesión); con red lenta, lo que tarde la carga.
    const minimo = sesion ? 1_150 : 2_300;
    const falta = minimo - (Date.now() - inicio);
    if (falta > 0) await espera(falta);
    if (!salud) await espera(700);
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
