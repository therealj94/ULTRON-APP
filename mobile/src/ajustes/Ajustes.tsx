/**
 * AJUSTES, como los del sistema: la cabecera grande que colapsa al desplazar, listas agrupadas con
 * su ícono en un cuadrito, interruptores nativos y hojas inferiores para editar sin cambiar de
 * pantalla.
 *
 *   Tu perfil     apodo, avatar (con su vista viva), cumpleaños
 *   Apariencia    Oscuro · Claro · Sistema (cambia al instante)
 *   Idioma        Español · English (la interfaz, la voz y las respuestas)
 *   AURA          «Lo que AURA sabe de ti» (la ruta Perfil), tus correos (ajustes/Correos.tsx) y la vibración
 *   Computadora   quién maneja su computadora en la nube: gratis (modelo propio) o Claude (de pago)
 *   Privacidad    los permisos del teléfono, con su ✔
 *   Cerrar sesión (con confirmación) y la versión
 *
 * Todo se guarda en el perfil (lib/perfil.ts): se aplica al momento y viaja al servidor por detrás.
 */
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { APP_VERSION } from '../config';
import { versionInstalada } from '../lib/ota';
import { de, tr, useIdioma, type Idioma } from '../i18n';
import { cumpleLegible, estadoPerfil, guardarPerfil, perfilSincronizado, usePerfil } from '../lib/perfil';
import { setAvatarVoz } from '../lib/tts';
import type { MotorComputadora, Tema } from '../nucleo/contrato';
import { MEDIDA } from '../nucleo/tema';
import { AVATARES, avatarPorId, type AvatarId } from '../avatares/catalogo';
import { MiniAvatar } from '../avatares/MiniAvatar';
import { Aparecer, Boton, Campo, Chip, Fila, Grupo, Hoja, Interruptor, PantallaConCabecera, Segmentado, Tarjeta, Texto, elegirIdioma, fijarHapticos, useHapticos, vibrar } from '../ui';
import { fuenteDisplay } from '../ui/tipografia';
import { armarCumple, leerCumple } from '../primeravez/flujo';
import { ListaPermisos } from '../primeravez/ListaPermisos';
import { HojaCorreos, useCuentasCorreo } from './Correos';
import { HojaComputadora } from './Computadora';
import { INFO_PERMISOS, abrirAjustesAlarma, estadoAlarmaExacta, estadosPermisos, listo, type EstadoAlarma } from '../primeravez/permisos';
import { SelectorCumple, VistaAvatar } from '../primeravez/piezas';
import type { RaizParams } from '../app/rutas';
import { salirDeLaSesion, useUsuario } from '../app/sesion';

/** Lo que corre: la OTA (o el JS de la APK), cuándo se publicó y la huella nativa. */
function lineaOta(idioma: Idioma): string {
  const v = versionInstalada();
  if (!v.runtime) return tr('Sin actualizaciones por aire', 'No over-the-air updates');
  const cuando = v.creada ? v.creada.toLocaleString(idioma === 'en' ? 'en-US' : 'es-HN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const que = v.ota ? `OTA ${v.ota}` : tr('JS de la APK', 'APK’s JS');
  return [que, cuando, `runtime ${v.runtime}`].filter(Boolean).join(' · ');
}

type Props = NativeStackScreenProps<RaizParams, 'Ajustes'>;
type HojaAbierta = 'apodo' | 'avatar' | 'cumple' | 'permisos' | 'salir' | 'correos' | 'computadora' | null;

export function Ajustes({ navigation }: Props) {
  const idioma = useIdioma();
  const perfil = usePerfil();
  const usuario = useUsuario();
  const hapticos = useHapticos();
  const [hoja, setHoja] = useState<HojaAbierta>(null);
  const [apodo, setApodo] = useState(perfil?.apodo || '');
  const [cumple, setCumple] = useState<{ mes: number | null; dia: number | null }>({ mes: null, dia: null });
  const [permisosOk, setPermisosOk] = useState<number | null>(null);
  const [alarma, setAlarma] = useState<EstadoAlarma | null>(null);
  const { cuentas: correos } = useCuentasCorreo(hoja === 'correos');

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
    if (h === 'cumple') {
      const c = leerCumple(perfil?.cumple);
      setCumple({ mes: c?.mes ?? null, dia: c?.dia ?? null });
    }
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
            <Fila
              titulo={tr('Tus correos', 'Your email')}
              detalle={tr('Para que AURA los revise y te ayude a contestar', 'So AURA can check them and help you reply')}
              icono="correo"
              valor={correos === null ? '' : String(correos.length)}
              onPress={() => abrir('correos')}
            />
            <Fila titulo={tr('Vibración', 'Vibration')} detalle={tr('Al tocar botones y al completar algo', 'When tapping buttons and completing things')} icono="tocar" derecha={<Interruptor valor={hapticos} onCambiar={(v) => void fijarHapticos(v)} etiqueta={tr('Vibración', 'Vibration')} />} />
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
            deshabilitado={!cumple.mes || !cumple.dia}
            onPress={() => {
              const c = cumple.mes && cumple.dia ? armarCumple(cumple.mes, cumple.dia) : undefined;
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
      <HojaComputadora visible={hoja === 'computadora'} onCerrar={() => setHoja(null)} nombreAvatar={de(avatar.nombre)} />

      <Hoja visible={hoja === 'permisos'} onCerrar={() => setHoja(null)} titulo={tr('Permisos', 'Permissions')} subtitulo={tr('Toca un permiso para darlo. Si lo bloqueaste, te llevo a los ajustes del teléfono.', 'Tap one to allow it. If you blocked it, I’ll take you to your phone settings.')}>
        <ListaPermisos />
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

const s = StyleSheet.create({
  perfil: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  foto: { width: 64, height: 64, borderRadius: 32, overflow: 'hidden', borderWidth: 2 },
  segmento: { padding: 10 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  pie: { alignItems: 'center', gap: 4, paddingTop: MEDIDA.espacio.s },
});
