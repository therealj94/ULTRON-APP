/**
 * LA VENTANA DE BIENVENIDA DE LA MESA (José, 2-oct: «cuando es primera vez, ponerlo en una ventana para
 * que lo hagan… y que le pregunte toda la información que ocupe»).
 *
 *  · La oferta: «¡Bienvenido, José!», qué enseña el recorrido (todo, señalando dónde tocar) y tres botones:
 *    «Empezar el recorrido», «Contarte de mí» (las preguntas que faltan) y «Después». Sale sola la primera
 *    vez (y una vez más cuando el recorrido crece: tutorial/pasos.ts VERSION_RECORRIDO); «Después» se
 *    respeta (vuelve, como mucho, MAX_POSPONER veces). Siempre está en Más → «Qué puedo hacer».
 *  · Las preguntas: las que quedaron sin contestar (flujo.ts pasosPendientes), una por pantalla, con
 *    opciones, «Otro (escribir)» y «Responder hablando». Cada «Siguiente» guarda en el perfil y en «lo que
 *    sé de ti»; cerrar a la mitad no pierde lo contestado y se retoma después. «Mejor te lo cuento
 *    hablando» pasa a la entrevista por voz de la mesa.
 *
 * La abre cualquiera con bienvenida/estado.ts (abrirBienvenida, abrirPreguntas): la mesa, el menú «Más» o
 * una fila de Ajustes. Se dibuja en la mesa, que es la base de la sesión: como Modal, se ve encima de la
 * pantalla que esté.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tr, useIdioma } from '../i18n';
import { guardarPerfil, usePerfil } from '../lib/perfil';
import { loadSettings, saveSettings } from '../lib/storage';
import { MEDIDA, useTema } from '../nucleo/tema';
import { BarraProgreso, Boton, BotonRedondo, Icono, Texto, vibrar, type NombreIcono } from '../ui';
import { conRecorridoPospuesto } from '../tutorial/pasos';
import { PREGUNTAS, borradorDesde, cambiosDelPaso, pasosPendientes, preguntaDe, type Borrador, type PasoId } from '../primeravez/flujo';
import { PasoPregunta } from '../primeravez/pasos/PasoPregunta';
import { PasoIniciativa } from '../primeravez/pasos/PasoIniciativa';
import { anotarEnConocer } from './conocer';
import { bienvenidaAhora, cerrarBienvenida, abrirPreguntas, suscribirBienvenida } from './estado';

type Props = {
  correo: string;
  nombre: string;
  /** «Empezar el recorrido»: la mesa lo abre (RecorridoApp). */
  onRecorrido: () => void;
  /** «Mejor te lo cuento hablando»: la entrevista por voz de la mesa. */
  onHablando?: () => void;
  /** Las preguntas están a la vista (la mesa suelta el oído: el dictado lo necesita). */
  onTapa?: (tapa: boolean) => void;
};

/** Lo que enseña el recorrido, para que se sepa a qué se dice que sí (tutorial: guion.ts). */
const TEMAS: { icono: NombreIcono; es: string; en: string }[] = [
  { icono: 'microfono', es: 'Hablarme y que te llame', en: 'Talk and calls' },
  { icono: 'chat', es: 'Chats, WhatsApp y correos', en: 'Chats, WhatsApp, email' },
  { icono: 'camara', es: 'La cámara', en: 'The camera' },
  { icono: 'reloj', es: 'Recordatorios y avisos', en: 'Reminders, notifications' },
  { icono: 'estrella', es: 'Misiones y propuestas', en: 'Missions, suggestions' },
  { icono: 'corazon', es: 'Lo que sé de ti y tu círculo', en: 'What I know, your circle' },
  { icono: 'ajustes', es: 'Ajustes y dónde está todo', en: 'Settings, where things are' },
];

export function VentanaBienvenida({ correo, nombre, onRecorrido, onHablando, onTapa }: Props) {
  useIdioma();
  const e = useSyncExternalStore(suscribirBienvenida, bienvenidaAhora, bienvenidaAhora);
  useEffect(() => {
    onTapa?.(e.abierta === 'preguntas');
  }, [e.abierta, onTapa]);
  return (
    <>
      <Oferta visible={e.abierta === 'oferta'} primera={e.motivo === 'primera'} correo={correo} nombre={nombre} onRecorrido={onRecorrido} />
      {e.abierta === 'preguntas' ? <Preguntas nombre={nombre} onHablando={onHablando} /> : null}
    </>
  );
}

function primerNombre(n: string) {
  return String(n || '').trim().split(/\s+/)[0] || '';
}

function Oferta({ visible, primera, correo, nombre, onRecorrido }: { visible: boolean; primera: boolean; correo: string; nombre: string; onRecorrido: () => void }) {
  const tema = useTema();
  const perfil = usePerfil();
  const faltan = useMemo(() => pasosPendientes(perfil).length, [perfil]);
  const quien = primerNombre(perfil?.apodo || nombre);
  const despues = () => {
    vibrar('seleccion');
    cerrarBienvenida();
    // La primera vez, «Después» se cuenta: vuelve a salir sola la próxima vez (con tope).
    if (primera) void loadSettings().then((s) => saveSettings(conRecorridoPospuesto(s, correo))).catch(() => {});
  };
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={despues}>
      <View style={[s.velo, { backgroundColor: 'rgba(0,0,0,0.62)' }]}>
        <View style={[s.tarjeta, { backgroundColor: tema.fondo, borderColor: tema.borde }]} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={{ gap: MEDIDA.espacio.l }} showsVerticalScrollIndicator={false}>
            <View style={[s.sello, { backgroundColor: tema.acentoFondo, borderColor: tema.acento }]}>
              <Icono nombre="chispas" tam={28} color={tema.acentoTexto} />
            </View>
            <View style={{ gap: 6 }}>
              <Texto v="etiqueta" color="acentoTexto" centro>
                {primera ? tr('Primera vez', 'First time') : tr('Qué puedo hacer', 'What I can do')}
              </Texto>
              <Texto v="titulo" centro accessibilityRole="header">
                {quien ? tr(`¡Bienvenido, ${quien}!`, `Welcome, ${quien}!`) : tr('¡Bienvenido!', 'Welcome!')}
              </Texto>
              <Texto v="cuerpo" color="texto2" centro>
                {tr(
                  'Te enseño todo lo que puedo hacer, paso a paso y señalando dónde tocar. Son unos minutos: lo pausas, lo saltas o lo repites cuando quieras desde Más → «Qué puedo hacer».',
                  'I’ll show you everything I can do, step by step, pointing at where to tap. It takes a few minutes: pause, skip or replay it anytime from More → “What I can do”.'
                )}
              </Texto>
            </View>
            <View style={s.temas}>
              {TEMAS.map((t) => (
                <View key={t.es} style={[s.tema, { borderColor: tema.borde, backgroundColor: tema.superficie }]}>
                  <Icono nombre={t.icono} tam={16} color={tema.acentoTexto} />
                  <Texto v="chica" color="texto2">
                    {tr(t.es, t.en)}
                  </Texto>
                </View>
              ))}
            </View>
            <View style={{ gap: 10 }}>
              <Boton
                titulo={tr('Empezar el recorrido', 'Start the tour')}
                icono="chispas"
                onPress={() => {
                  cerrarBienvenida();
                  onRecorrido();
                }}
              />
              <Boton
                titulo={faltan ? tr(`Contarte de mí (${faltan} ${faltan === 1 ? 'pregunta' : 'preguntas'})`, `Tell you about me (${faltan} ${faltan === 1 ? 'question' : 'questions'})`) : tr('Revisar lo que te conté', 'Review what I told you')}
                variante="secundario"
                icono="persona"
                onPress={() => abrirPreguntas()}
              />
              <Boton titulo={tr('Después', 'Later')} variante="fantasma" onPress={despues} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Preguntas({ nombre, onHablando }: { nombre: string; onHablando?: () => void }) {
  const tema = useTema();
  const ins = useSafeAreaInsets();
  const perfil = usePerfil();
  // La lista se fija al abrir: contestar una no la saca de debajo de los pies.
  const [pasos] = useState<PasoId[]>(() => {
    const f = pasosPendientes(perfil);
    return f.length ? f : [...PREGUNTAS.map((q) => `encuesta:${q.campo}` as const), 'iniciativa'];
  });
  const [i, setI] = useState(0);
  const [b, setB] = useState<Borrador>(() => borradorDesde(perfil, nombre));
  const paso = pasos[Math.min(i, pasos.length - 1)];
  const ultimo = i >= pasos.length - 1;
  const cambiar = (c: Partial<Borrador>) => setB((x) => ({ ...x, ...c }));

  const seguir = (guardar: boolean) => {
    if (guardar) {
      const c = cambiosDelPaso(paso, b);
      if (c) guardarPerfil(c);
      void anotarEnConocer(paso, b);
    }
    vibrar('seleccion');
    if (ultimo) {
      if (guardar) vibrar('exito');
      cerrarBienvenida();
      return;
    }
    setI((n) => n + 1);
  };
  const q = preguntaDe(paso);
  const props = { perfil, borrador: b, cambiar, avanzar: () => seguir(true), horizontal: false };
  return (
    <Modal visible transparent={false} animationType="slide" statusBarTranslucent onRequestClose={() => cerrarBienvenida()}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: tema.fondo }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[s.barra, { paddingTop: ins.top + 8 }]}>
          <BotonRedondo icono="cerrar" onPress={() => cerrarBienvenida()} etiqueta={tr('Cerrar: lo contestado queda guardado', 'Close: your answers are saved')} />
          <View style={{ flex: 1 }}>
            <BarraProgreso valor={(i + 1) / pasos.length} alto={5} />
          </View>
          <Boton titulo={tr('Saltar', 'Skip')} variante="fantasma" tam="chico" onPress={() => seguir(false)} />
        </View>
        <ScrollView contentContainerStyle={[s.cuerpo, { paddingBottom: MEDIDA.espacio.xxl }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View key={paso} style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
            {q ? <PasoPregunta {...props} pregunta={q} /> : <PasoIniciativa {...props} />}
          </View>
          {onHablando ? (
            <Pressable
              onPress={() => {
                cerrarBienvenida();
                onHablando();
              }}
              accessibilityRole="button"
              style={s.hablando}
            >
              <Texto v="chica" color="acentoTexto" centro>
                {tr('Mejor te lo cuento hablando: que AURA me pregunte en voz alta', 'I’d rather tell you out loud: let AURA ask me')}
              </Texto>
            </Pressable>
          ) : null}
        </ScrollView>
        <View style={[s.pie, { paddingBottom: ins.bottom + MEDIDA.espacio.m }]}>
          <Boton titulo={ultimo ? tr('Listo', 'Done') : tr('Siguiente', 'Next')} iconoDerecha={ultimo ? undefined : 'flecha'} icono={ultimo ? 'check' : undefined} onPress={() => seguir(true)} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  velo: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: MEDIDA.espacio.l },
  tarjeta: { width: '100%', maxWidth: 480, maxHeight: '92%', borderRadius: MEDIDA.radio.l, borderWidth: 1, padding: MEDIDA.espacio.xl },
  sello: { alignSelf: 'center', width: 60, height: 60, borderRadius: 30, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  temas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  tema: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  barra: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: MEDIDA.espacio.l, paddingBottom: 8 },
  cuerpo: { paddingHorizontal: MEDIDA.espacio.xl, paddingTop: MEDIDA.espacio.l, gap: MEDIDA.espacio.xl },
  hablando: { paddingVertical: 12, minHeight: 48, justifyContent: 'center' },
  pie: { paddingHorizontal: MEDIDA.espacio.xl, paddingTop: MEDIDA.espacio.s },
});
