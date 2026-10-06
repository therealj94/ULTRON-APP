/**
 * AJUSTES, como los del sistema: la cabecera grande que colapsa al desplazar, listas agrupadas con
 * su ícono en un cuadrito, interruptores nativos y hojas inferiores para editar sin cambiar de
 * pantalla.
 *
 *   Tu perfil     apodo, avatar (con su vista viva), cumpleaños
 *   Apariencia    Oscuro · Claro · Sistema (cambia al instante)
 *   Idioma        Español · English (la interfaz, la voz y las respuestas)
 *   AURA          «Lo que AURA sabe de ti» (la ruta Perfil), «Lo que sé de ti» (lo que aprendió y lo que quedó
 *                 a medias), «Mi círculo», sus misiones (app/HojasCerebro.tsx), tus correos (ajustes/Correos.tsx),
 *                 su WhatsApp («Agregar mi WhatsApp» o, ya vinculado, «Desvincular WhatsApp»; José, 5-oct) y la
 *                 vibración
 *   Voz y oído    la voz del avatar y cómo convierte tu voz en texto (el teléfono o la nube); «Interrumpir hablando»
 *                 y «Muletillas al escuchar» (el «mjm» mientras hablas largo, ajustes/Muletillas.tsx)
 *   La mesa       «comenta lo que ve», los efectos de sonido y, con AU-RA, su cara (el orbe o los anillos)
 *   Memoria       cuántos hechos guarda de ti y «Olvidar» (pregunta antes; borra aquí y en el servidor)
 *                 (José, 2-oct: estaban al final del menú de la mesa, en una columna angosta y cortada;
 *                 usan las mismas acciones de la mesa, que las publica en app/mesaAjustes.ts)
 *   Iniciativa    cuánto te propone AURA por su cuenta: alta · media · baja · apagada (server/iniciativa.ts)
 *   Computadora   quién maneja su computadora en la nube: gratis (modelo propio) o Claude (de pago)
 *   Privacidad    los permisos del teléfono, con su ✔
 *   Cerrar sesión (con confirmación) y la versión
 *
 * Todo se guarda en el perfil (lib/perfil.ts): se aplica al momento y viaja al servidor por detrás.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { APP_VERSION } from '../config';
import { versionInstalada } from '../lib/ota';
import { de, tr, useIdioma, type Idioma } from '../i18n';
import { cumpleLegible, estadoPerfil, guardarPerfil, perfilSincronizado, usePerfil } from '../lib/perfil';
import { setAvatarVoz } from '../lib/tts';
import type { MotorComputadora, NivelIniciativa, Tema } from '../nucleo/contrato';
import { MEDIDA } from '../nucleo/tema';
import { AVATARES, avatarPorId, type AvatarId } from '../avatares/catalogo';
import { MiniAvatar } from '../avatares/MiniAvatar';
import { Aparecer, Boton, Campo, Chip, Fila, Grupo, Hoja, Interruptor, PantallaConCabecera, Segmentado, Tarjeta, Texto, elegirIdioma, fijarHapticos, useHapticos, vibrar } from '../ui';
import { fuenteDisplay } from '../ui/tipografia';
import { SIN_CUMPLE, cumpleDeSeleccion, seleccionDeCumple, type SeleccionCumple } from '../primeravez/flujo';
import { ListaPermisos } from '../primeravez/ListaPermisos';
import { HojaCorreos, useCuentasCorreo } from './Correos';
import { HojaComputadora } from './Computadora';
import { HojaAvisos } from './Avisos';
import { HojaCerebro } from '../app/HojasCerebro';
import type { PantallaCerebro } from '../compa/cerebro';
import { INFO_PERMISOS, abrirAjustesAlarma, estadoAlarmaExacta, estadosPermisos, listo, type EstadoAlarma } from '../primeravez/permisos';
import { SelectorCumple, VistaAvatar } from '../primeravez/piezas';
import type { RaizParams } from '../app/rutas';
import { salirDeLaSesion, useUsuario } from '../app/sesion';
import { mesaAjustes, suscribirMesa } from '../app/mesaAjustes';
import { abrirRuta, abrirWhatsapp } from '../app/rutas';
import * as WA from '../whatsapp/api';
import { entradaWA, telefonoBonito, type EstadoWA } from '../whatsapp/logica';
import { abrirBienvenida } from '../bienvenida/estado';
import { abrirCartera } from '../cartera/estado';
import type { SttEngine } from '../lib/storage';
import { FilaCamaraRapida } from './CamaraRapida';
import { FilaVozEnVivo } from './VozEnVivo';
import { FilaMuletillas } from './Muletillas';

/** Lo que corre: la OTA (o el JS de la APK), cuándo se publicó y la huella nativa. */
function lineaOta(idioma: Idioma): string {
  const v = versionInstalada();
  if (!v.runtime) return tr('Sin actualizaciones por aire', 'No over-the-air updates');
  const cuando = v.creada ? v.creada.toLocaleString(idioma === 'en' ? 'en-US' : 'es-HN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const que = v.ota ? `OTA ${v.ota}` : tr('JS de la APK', 'APK’s JS');
  return [que, cuando, `runtime ${v.runtime}`].filter(Boolean).join(' · ');
}

type Props = NativeStackScreenProps<RaizParams, 'Ajustes'>;
type HojaAbierta = 'apodo' | 'avatar' | 'cumple' | 'permisos' | 'salir' | 'correos' | 'computadora' | 'avisos' | 'whatsapp-desvincular' | PantallaCerebro | null;

/** Lo que se lee debajo de «Iniciativa de AURA», según el nivel elegido. */
function pieIniciativa(n: NivelIniciativa): string {
  if (n === 'alta') return tr('Te propone cosas cada dos horas (hasta 6 al día). Nunca de noche.', 'She suggests things every two hours (up to 6 a day). Never at night.');
  if (n === 'baja') return tr('Una propuesta al día, como mucho.', 'At most one suggestion a day.');
  if (n === 'apagada') return tr('No te propone nada por su cuenta: solo contesta lo que le pidas.', 'She won’t suggest anything on her own: she only answers what you ask.');
  return tr('Te propone cosas cada cuatro horas (hasta 3 al día). Nunca de noche; si le dices que no, espera más.', 'She suggests things every four hours (up to 3 a day). Never at night; if you say no, she waits longer.');
}

export function Ajustes({ navigation }: Props) {
  const idioma = useIdioma();
  const perfil = usePerfil();
  const usuario = useUsuario();
  const hapticos = useHapticos();
  const [hoja, setHoja] = useState<HojaAbierta>(null);
  const [apodo, setApodo] = useState(perfil?.apodo || '');
  // La selección a medias (el mes sin el día) del selector del cumpleaños; se guarda solo completa.
  const [cumple, setCumple] = useState<SeleccionCumple>(SIN_CUMPLE);
  const [permisosOk, setPermisosOk] = useState<number | null>(null);
  const [alarma, setAlarma] = useState<EstadoAlarma | null>(null);
  const { cuentas: correos } = useCuentasCorreo(hoja === 'correos');
  // Su WhatsApp (cada cuenta el suyo): «Agregar mi WhatsApp» si puede y no lo tiene; «Desvincular» si ya lo tiene.
  const [wa, setWa] = useState<EstadoWA | null>(null);
  const [errorWa, setErrorWa] = useState('');
  const [desvinculando, setDesvinculando] = useState(false);
  const entradaWa = entradaWA(wa);
  // Lo de la mesa (voz, oído, comentarios, efectos, memoria, su cara): la mesa está montada debajo.
  const mesa = useSyncExternalStore(suscribirMesa, mesaAjustes, mesaAjustes);

  useEffect(() => {
    if (hoja !== null) return;
    let vivo = true;
    // Un fallo de red no es un «no»: se queda lo último que se supo.
    void WA.estadoWA()
      .then((e) => vivo && setWa(e))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [hoja]);

  const desvincularWa = async () => {
    setErrorWa('');
    setDesvinculando(true);
    try {
      await WA.desvincularWA();
      vibrar('exito');
      setHoja(null);
      setWa((e) => (e ? { ...e, vinculado: false, conectado: false, numero: undefined, nombre: undefined, error: undefined } : e));
    } catch (e: any) {
      setErrorWa(e?.message || tr('No se pudo desvincular. Prueba otra vez.', 'Couldn’t unlink. Try again.'));
    } finally {
      setDesvinculando(false);
    }
  };

  useEffect(() => {
    if (hoja !== null) return;
    // Al cerrar la hoja de permisos (o al abrir Ajustes), cuántos están concedidos.
    void estadosPermisos().then((e) => setPermisosOk(INFO_PERMISOS.filter((p) => listo(e[p.id])).length));
    void estadoAlarmaExacta().then(setAlarma);
  }, [hoja]);

  // «Alarmas y recordatorios» se cambia en los Ajustes del sistema: al volver a la app se mira otra vez.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void estadoAlarmaExacta().then(setAlarma);
    });
    return () => sub.remove();
  }, []);

  const abrir = (h: HojaAbierta) => {
    if (h === 'apodo') setApodo(perfil?.apodo || '');
    if (h === 'cumple') setCumple(seleccionDeCumple(perfil?.cumple));
    setHoja(h);
  };

  const avatar = avatarPorId(perfil?.avatar ?? 'aura');
  const elegirAvatar = (id: AvatarId) => {
    vibrar('medio');
    setAvatarVoz(id);
    guardarPerfil({ avatar: id });
  };

  return (
    <PantallaConCabecera titulo={tr('Ajustes', 'Settings')} onAtras={() => navigation.goBack()}>
      <View style={{ gap: MEDIDA.espacio.xl }}>
        <Aparecer>
          <Tarjeta onPress={() => abrir('apodo')} etiqueta={tr('Editar tu apodo', 'Edit your nickname')}>
            <View style={s.perfil}>
              <View style={[s.foto, { borderColor: avatar.tema.acento }]}>
                <MiniAvatar id={avatar.id} lado={64} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Texto v="titulo" numberOfLines={1}>
                  {perfil?.apodo || usuario?.name || ''}
                </Texto>
                <Texto v="chica" color="texto3" numberOfLines={1}>
                  {perfil?.nombreGenesis || usuario?.correo || ''}
                </Texto>
                <Texto v="mini" color="acentoTexto">
                  {tr('Toca para cambiar cómo te dice AURA', 'Tap to change what AURA calls you')}
                </Texto>
              </View>
            </View>
          </Tarjeta>
        </Aparecer>

        <Aparecer retraso={40}>
          <Grupo titulo={tr('Tu perfil', 'Your profile')}>
            <Fila titulo={tr('Apodo', 'Nickname')} icono="persona" valor={perfil?.apodo || '—'} onPress={() => abrir('apodo')} />
            <Fila titulo={tr('Avatar', 'Avatar')} icono="cara" valor={de(avatar.nombre)} onPress={() => abrir('avatar')} />
            <Fila titulo={tr('Cumpleaños', 'Birthday')} icono="pastel" valor={cumpleLegible(perfil?.cumple, idioma) || tr('Sin decir', 'Not set')} onPress={() => abrir('cumple')} />
          </Grupo>
        </Aparecer>

        <Aparecer retraso={80}>
          <Grupo titulo={tr('Apariencia', 'Appearance')} pie={tr('La mesa de los avatares siempre se ve de noche.', 'The avatars’ desk always looks like night.')}>
            <View style={s.segmento}>
              <Segmentado<Tema>
                opciones={[
                  { id: 'oscuro', texto: tr('Oscuro', 'Dark'), icono: 'luna' },
                  { id: 'claro', texto: tr('Claro', 'Light'), icono: 'sol' },
                  { id: 'sistema', texto: tr('Sistema', 'System'), icono: 'telefono' },
                ]}
                valor={perfil?.tema ?? 'sistema'}
                onCambiar={(t) => guardarPerfil({ tema: t })}
              />
            </View>
          </Grupo>
        </Aparecer>

        <Aparecer retraso={120}>
          <Grupo titulo={tr('Idioma', 'Language')} pie={tr('Cambia la app, la voz de los avatares y sus respuestas.', 'Changes the app, the avatars’ voice and their answers.')}>
            <View style={s.segmento}>
              <Segmentado<Idioma>
                opciones={[
                  { id: 'es', texto: 'Español' },
                  { id: 'en', texto: 'English' },
                ]}
                valor={idioma}
                onCambiar={(i) => void elegirIdioma(i)}
              />
            </View>
          </Grupo>
        </Aparecer>

        <Aparecer retraso={160}>
          <Grupo titulo="AURA">
            <Fila titulo={tr('Lo que AURA sabe de ti', 'What AURA knows about you')} detalle={tr('Lo que le contaste: verlo, cambiarlo o borrarlo', 'What you told her: see, change or erase it')} icono="corazon" onPress={() => navigation.navigate('Perfil')} />
            <Fila titulo={tr('Lo que sé de ti', 'What I know about you')} detalle={tr('Lo que aprendió al hablar contigo y lo que quedó a medias', 'What she learned talking with you and what was left halfway')} icono="chispas" onPress={() => abrir('conocer')} />
            <Fila titulo={tr('Mi círculo', 'My circle')} detalle={tr('Tu gente cercana y qué puede hacer AURA por ellos', 'Your close people and what AURA can do for them')} icono="familia" onPress={() => abrir('circulo')} />
            <Fila titulo={tr('Misiones', 'Missions')} detalle={tr('Las metas que AURA te ayuda a cumplir', 'The goals AURA helps you reach')} icono="estrella" onPress={() => abrir('misiones')} />
            <Fila
              titulo={tr('Tus correos', 'Your email')}
              detalle={tr('Para que AURA los revise y te ayude a contestar', 'So AURA can check them and help you reply')}
              icono="correo"
              valor={correos === null ? '' : String(correos.length)}
              onPress={() => abrir('correos')}
            />
            {entradaWa === 'agregar' ? (
              <Fila titulo={tr('Agregar mi WhatsApp', 'Add my WhatsApp')} detalle={tr('Para verlo y contestarlo aquí, aparte de PULSE2CHAT, y que AURA te ayude', 'To see and answer it here, apart from PULSE2CHAT, with AURA’s help')} icono="chat" onPress={abrirWhatsapp} />
            ) : entradaWa === 'whatsapp' ? (
              <>
                <Fila titulo="WhatsApp" detalle={tr('Tus chats, en Chats → WhatsApp', 'Your chats, in Chats → WhatsApp')} icono="chat" valor={telefonoBonito(wa?.numero) || wa?.numero || ''} onPress={abrirWhatsapp} />
                {wa?.vinculado ? <Fila titulo={tr('Desvincular WhatsApp', 'Unlink WhatsApp')} icono="basura" destructiva chevron={false} onPress={() => (setErrorWa(''), abrir('whatsapp-desvincular'))} /> : null}
              </>
            ) : null}
            <Fila titulo={tr('Veta Wallet', 'Veta Wallet')} detalle={tr('Tus saldos (solo lectura); pagas desde un chat y firmas en Veta Wallet', 'Your balances (read-only); pay from a chat and sign in Veta Wallet')} icono="wallet" onPress={abrirCartera} />
            <Fila
              titulo={tr('Repetir el recorrido', 'Replay the tour')}
              detalle={tr('Claudio y ANT-ONIO te enseñan todo otra vez, y las preguntas para conocerte', 'Claudio and ANT-ONIO show you everything again, plus the get-to-know-you questions')}
              icono="ayudaCirculo"
              onPress={() => {
                // La ventana la dibuja la mesa: primero se vuelve a ella y luego se abre.
                abrirRuta('Mesa');
                setTimeout(() => abrirBienvenida('menu'), 350);
              }}
            />
            <Fila titulo={tr('Vibración', 'Vibration')} detalle={tr('Al tocar botones y al completar algo', 'When tapping buttons and completing things')} icono="tocar" derecha={<Interruptor valor={hapticos} onCambiar={(v) => void fijarHapticos(v)} etiqueta={tr('Vibración', 'Vibration')} />} />
          </Grupo>
        </Aparecer>

        {mesa ? (
          <Aparecer retraso={165}>
            <SeccionesMesa mesa={mesa} />
          </Aparecer>
        ) : null}

        <Aparecer retraso={170}>
          <Grupo titulo={tr('Iniciativa de AURA', 'AURA’s initiative')} pie={pieIniciativa(perfil?.iniciativa ?? 'media')}>
            <View style={s.segmento}>
              <Segmentado<NivelIniciativa>
                opciones={[
                  { id: 'alta', texto: tr('Alta', 'High') },
                  { id: 'media', texto: tr('Media', 'Medium') },
                  { id: 'baja', texto: tr('Baja', 'Low') },
                  { id: 'apagada', texto: tr('Apagada', 'Off') },
                ]}
                valor={perfil?.iniciativa ?? 'media'}
                onCambiar={(n) => guardarPerfil({ iniciativa: n })}
              />
            </View>
            <Fila titulo={tr('Tus avisos', 'Your notifications')} detalle={tr('Horario, canal, cuántos y de qué', 'Schedule, channel, how many and about what')} icono="campana" onPress={() => abrir('avisos')} />
          </Grupo>
        </Aparecer>

        <Aparecer retraso={180}>
          <Grupo
            titulo={tr('Su computadora', 'Their computer')}
            pie={tr(
              'Los avatares tienen su propia computadora en la nube para hacer cosas en páginas por ti. Gratis la maneja nuestro modelo; Claude es más hábil y tiene costo. Nunca pagan ni ponen contraseñas.',
              'The avatars have their own cloud computer to do things on websites for you. Free uses our own model; Claude is more capable and costs money. They never pay or enter passwords.'
            )}
          >
            <View style={s.segmento}>
              <Segmentado<MotorComputadora>
                opciones={[
                  { id: 'gratis', texto: tr('Gratis', 'Free') },
                  { id: 'pago', texto: 'Claude' },
                ]}
                valor={perfil?.motorComputadora ?? 'gratis'}
                onCambiar={(m) => guardarPerfil({ motorComputadora: m })}
              />
            </View>
            <Fila
              titulo={tr('Ver lo que hace', 'See what it does')}
              detalle={tr('Paso a paso, y encargarle algo', 'Step by step, and give it a task')}
              icono="enlace"
              onPress={() => abrir('computadora')}
            />
          </Grupo>
        </Aparecer>

        <Aparecer retraso={200}>
          <Grupo titulo={tr('Privacidad', 'Privacy')}>
            <Fila
              titulo={tr('Permisos del teléfono', 'Phone permissions')}
              icono="escudo"
              valor={permisosOk === null ? '' : tr(`${permisosOk} de ${INFO_PERMISOS.length}`, `${permisosOk} of ${INFO_PERMISOS.length}`)}
              onPress={() => abrir('permisos')}
            />
            {alarma && alarma !== 'noAplica' ? (
              <Fila
                titulo={tr('Alarmas y recordatorios', 'Alarms & reminders')}
                detalle={tr('Para que tus recordatorios suenen a la hora exacta', 'So your reminders ring right on time')}
                icono="reloj"
                valor={alarma === 'concedido' ? tr('Permitido', 'Allowed') : tr('Apagado', 'Off')}
                onPress={() => void abrirAjustesAlarma()}
              />
            ) : null}
          </Grupo>
        </Aparecer>

        <Aparecer retraso={240}>
          <Grupo>
            <Fila titulo={tr('Cerrar sesión', 'Sign out')} icono="salir" destructiva chevron={false} onPress={() => abrir('salir')} />
          </Grupo>
        </Aparecer>

        <View style={s.pie}>
          <Texto v="chica" color="texto3">
            PULSE 2CHAT × AURA · v{APP_VERSION}
          </Texto>
          <Texto v="mini" color="texto3">
            {lineaOta(idioma)}
          </Texto>
          <Texto v="mini" color="texto3" style={[fuenteDisplay(), { fontSize: 13, letterSpacing: 2 }]}>
            powered by ORDEN GLOBAL
          </Texto>
          {/* Guardado de verdad solo con recibo durable del servidor; «recibido» no es lo mismo. */}
          <Texto v="mini" color={perfilSincronizado() ? 'exito' : 'texto3'}>
            {perfilSincronizado()
              ? tr('Tu perfil está guardado en tu cuenta', 'Your profile is saved to your account')
              : estadoPerfil().estado === 'recibido'
                ? tr('Tu perfil llegó al servidor, pero aún no quedó guardado del todo: lo reintento solo', 'Your profile reached the server but isn’t fully saved yet: retrying on my own')
                : tr('Tu perfil se guarda en tu cuenta al haber conexión', 'Your profile syncs to your account when online')}
          </Texto>
        </View>
      </View>

      <Hoja visible={hoja === 'apodo'} onCerrar={() => setHoja(null)} titulo={tr('¿Cómo quieres que te diga?', 'What should I call you?')}>
        <View style={{ gap: MEDIDA.espacio.l }}>
          <Campo etiqueta={tr('Tu apodo', 'Your nickname')} grande value={apodo} onChangeText={(t) => setApodo(t.slice(0, 40))} autoCapitalize="words" autoFocus maxLength={40} />
          <Boton
            titulo={tr('Guardar', 'Save')}
            onPress={() => {
              if (!apodo.trim()) return vibrar('aviso');
              guardarPerfil({ apodo: apodo.trim() });
              vibrar('exito');
              setHoja(null);
            }}
            deshabilitado={!apodo.trim()}
          />
        </View>
      </Hoja>

      <Hoja visible={hoja === 'avatar'} onCerrar={() => setHoja(null)} titulo={tr('Tu avatar', 'Your avatar')} subtitulo={de(avatar.oficio)}>
        <View style={{ gap: MEDIDA.espacio.l, alignItems: 'center' }}>
          <Aparecer clave={avatar.id} desde="escala">
            <VistaAvatar id={avatar.id} tam={170} />
          </Aparecer>
          <View style={s.chips}>
            {AVATARES.map((a) => (
              <Chip key={a.id} texto={de(a.nombre)} activo={a.id === avatar.id} onPress={() => elegirAvatar(a.id)} />
            ))}
          </View>
        </View>
      </Hoja>

      <Hoja visible={hoja === 'cumple'} onCerrar={() => setHoja(null)} titulo={tr('Tu cumpleaños', 'Your birthday')} subtitulo={tr('Solo mes y día: AURA te felicita.', 'Just month and day: AURA will celebrate.')}>
        <View style={{ gap: MEDIDA.espacio.l }}>
          <SelectorCumple mes={cumple.mes} dia={cumple.dia} onCambiar={(mes, dia) => setCumple({ mes, dia })} />
          <Boton
            titulo={tr('Guardar', 'Save')}
            deshabilitado={!cumpleDeSeleccion(cumple)}
            onPress={() => {
              const c = cumpleDeSeleccion(cumple);
              if (!c) return;
              guardarPerfil({ cumple: c });
              vibrar('exito');
              setHoja(null);
            }}
          />
          {!!perfil?.cumple && (
            <Boton
              titulo={tr('Prefiero no decirlo', 'I’d rather not say')}
              variante="fantasma"
              onPress={() => {
                guardarPerfil({ cumple: '' });
                setHoja(null);
              }}
            />
          )}
        </View>
      </Hoja>

      <HojaCorreos visible={hoja === 'correos'} onCerrar={() => setHoja(null)} />
      <HojaAvisos visible={hoja === 'avisos'} onCerrar={() => setHoja(null)} />
      <HojaComputadora visible={hoja === 'computadora'} onCerrar={() => setHoja(null)} nombreAvatar={de(avatar.nombre)} />
      <HojaCerebro cual={hoja === 'misiones' || hoja === 'conocer' || hoja === 'circulo' ? hoja : null} onCerrar={() => setHoja(null)} />

      <Hoja visible={hoja === 'permisos'} onCerrar={() => setHoja(null)} titulo={tr('Permisos', 'Permissions')} subtitulo={tr('Toca un permiso para darlo. Si lo bloqueaste, te llevo a los ajustes del teléfono.', 'Tap one to allow it. If you blocked it, I’ll take you to your phone settings.')}>
        <ListaPermisos />
      </Hoja>

      <Hoja
        visible={hoja === 'whatsapp-desvincular'}
        onCerrar={() => setHoja(null)}
        titulo={tr('¿Desvincular WhatsApp?', 'Unlink WhatsApp?')}
        subtitulo={tr('AU-RA deja de ver tus chats y se borra todo lo que tenía guardado de tu WhatsApp. Tu WhatsApp del teléfono no cambia.', 'AU-RA stops seeing your chats and everything it stored from your WhatsApp is erased. WhatsApp on your phone doesn’t change.')}
      >
        <View style={{ gap: MEDIDA.espacio.m }}>
          {errorWa ? (
            <Texto v="chica" color="aviso">
              {errorWa}
            </Texto>
          ) : null}
          <Boton titulo={tr('Desvincular y borrar', 'Unlink and erase')} icono="basura" variante="peligro" cargando={desvinculando} onPress={() => void desvincularWa()} />
          <Boton titulo={tr('Cancelar', 'Cancel')} variante="secundario" onPress={() => setHoja(null)} />
        </View>
      </Hoja>

      <Hoja visible={hoja === 'salir'} onCerrar={() => setHoja(null)} titulo={tr('¿Cerrar sesión?', 'Sign out?')} subtitulo={tr('Tu perfil y lo que AURA sabe de ti se quedan en tu cuenta. El chat se desconecta de este teléfono.', 'Your profile and what AURA knows stay in your account. The chat disconnects from this phone.')}>
        <View style={{ gap: MEDIDA.espacio.m }}>
          <Boton
            titulo={tr('Cerrar sesión', 'Sign out')}
            icono="salir"
            variante="peligro"
            onPress={() => {
              setHoja(null);
              vibrar('medio');
              salirDeLaSesion();
            }}
          />
          <Boton titulo={tr('Cancelar', 'Cancel')} variante="secundario" onPress={() => setHoja(null)} />
        </View>
      </Hoja>
    </PantallaConCabecera>
  );
}

/**
 * Voz y oído, la mesa y la memoria (antes al final del menú de la mesa). Cada cambio llama a lo mismo que
 * llamaba el menú: se guarda, se aplica en la mesa al instante y, si toca, el avatar lo dice.
 */
function SeccionesMesa({ mesa }: { mesa: NonNullable<ReturnType<typeof mesaAjustes>> }) {
  const { datos, acciones } = mesa;
  const av = avatarPorId(datos.avatar);
  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <Grupo
        titulo={tr('Voz y oído', 'Voice and hearing')}
        pie={
          datos.sttEngine === 'turbo'
            ? tr('Turbo: tu voz va en vivo a Scribe v2 Realtime Turbo mientras hablas; lo de dinero se confirma antes de actuar.', 'Turbo: your voice streams live to Scribe v2 Realtime Turbo as you speak; money requests are double-checked first.')
            : datos.sttEngine === 'native'
              ? tr('Teléfono: el reconocimiento de Google, en vivo y sin gastar datos del servidor.', 'Phone: Google’s recognition, live, without using the server.')
              : tr('Nube: tu voz se graba y se transcribe en el servidor al terminar la frase.', 'Cloud: your voice is recorded and transcribed on the server when you finish.')
        }
      >
        <Fila titulo={tr('Voz', 'Voice')} detalle={`${de(av.voz)}. ${tr('Todo se dice en vivo con su voz.', 'Everything is spoken live in its voice.')}`} icono="volumen" />
        <View style={s.segmento}>
          <Texto v="chica" color="texto2" style={s.etiquetaSegmento}>
            {tr('Oído: cómo convierte tu voz en texto', 'Hearing: how your voice becomes text')}
          </Texto>
          <Segmentado<SttEngine>
            opciones={[
              { id: 'turbo', texto: 'Turbo', icono: 'chispas' },
              { id: 'native', texto: tr('Teléfono', 'Phone'), icono: 'telefono' },
              { id: 'cloud', texto: tr('Nube', 'Cloud'), icono: 'globo' },
            ]}
            valor={datos.sttEngine}
            onCambiar={(e) => e !== datos.sttEngine && acciones.fijarOido(e)}
          />
        </View>
        <Fila
          titulo={tr('Interrumpir hablando', 'Interrupt by talking')}
          detalle={
            datos.sttEngine === 'turbo'
              ? tr('En prueba: háblale encima y se calla para escucharte. Si se corta sola o tarda en oírte, apágalo.', 'Experimental: talk over it and it stops to listen. If it cuts itself off or hears you late, turn it off.')
              : tr('Funciona con el oído Turbo.', 'Works with Turbo hearing.')
          }
          icono="microfono"
          derecha={<Interruptor valor={datos.interrumpir} onCambiar={(v) => v !== datos.interrumpir && acciones.alternarInterrumpir()} etiqueta={tr('Interrumpir hablando', 'Interrupt by talking')} />}
        />
        {/* El «mjm» mientras hablas (lib/asentir.ts): solo donde puede existir. */}
        <FilaMuletillas motor={datos.sttEngine} />
      </Grupo>

      <Grupo titulo={tr(`La mesa · ${de(av.nombre)}`, `The desk · ${de(av.nombre)}`)}>
        <Fila
          titulo={tr('Comenta lo que ve', 'Comments on what it sees')}
          detalle={tr('Observaciones espontáneas de la cámara', 'Spontaneous camera remarks')}
          icono="ojo"
          derecha={<Interruptor valor={datos.proactive} onCambiar={(v) => v !== datos.proactive && acciones.alternarComentarios()} etiqueta={tr('Comenta lo que ve', 'Comments on what it sees')} />}
        />
        {/* La cámara en vivo (modules/aura-camara): solo donde existe. */}
        <FilaCamaraRapida />
        {/* La voz en streaming (modules/aura-voz): solo donde existe. */}
        <FilaVozEnVivo />
        <Fila
          titulo={tr('Efectos de sonido', 'Sound effects')}
          detalle={tr('Toques, los sonidos del orbe de AURA, blaster, sable', 'Taps, AURA’s orb sounds, blaster, saber')}
          icono="musica"
          derecha={<Interruptor valor={datos.sfx} onCambiar={(v) => v !== datos.sfx && acciones.alternarEfectos()} etiqueta={tr('Efectos de sonido', 'Sound effects')} />}
        />
        {datos.avatar === 'aura' ? (
          <View style={s.segmento}>
            <Texto v="chica" color="texto2" style={s.etiquetaSegmento}>
              {tr('Su cara', 'Her face')}
            </Texto>
            <Segmentado<'orbe' | 'anillos'>
              opciones={[
                { id: 'orbe', texto: tr('Orbe', 'Orb') },
                { id: 'anillos', texto: tr('Anillos', 'Rings') },
              ]}
              valor={datos.cara}
              onCambiar={acciones.fijarCara}
            />
          </View>
        ) : null}
      </Grupo>

      <Grupo
        titulo={tr('Memoria', 'Memory')}
        pie={tr('Lo que le pides recordar («recuerda que…»). Olvidar lo borra en este teléfono y en el servidor, y no se puede deshacer.', 'What you ask it to remember (“remember that…”). Forget erases it on this phone and on the server, and can’t be undone.')}
      >
        <Fila
          titulo={tr('Memoria de largo plazo', 'Long-term memory')}
          icono="libro"
          valor={datos.memoria ? tr(`${datos.memoria} ${datos.memoria === 1 ? 'hecho' : 'hechos'}`, `${datos.memoria} fact${datos.memoria === 1 ? '' : 's'}`) : tr('Nada guardado', 'Nothing saved')}
        />
        <Fila titulo={tr('Olvidar lo que recuerda de ti', 'Forget what it remembers about you')} icono="basura" destructiva chevron={false} onPress={acciones.olvidar} />
      </Grupo>
    </View>
  );
}

const s = StyleSheet.create({
  perfil: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  foto: { width: 64, height: 64, borderRadius: 32, overflow: 'hidden', borderWidth: 2 },
  segmento: { padding: 10 },
  etiquetaSegmento: { marginLeft: 4, marginBottom: 8 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  pie: { alignItems: 'center', gap: 4, paddingTop: MEDIDA.espacio.s },
});
