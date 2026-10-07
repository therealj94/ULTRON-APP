/**
 * «LO QUE AURA SABE DE TI» (la ruta Perfil): todo lo que la persona contó, a la vista y en sus manos.
 *
 *   De Genesis ID      el nombre y el cumpleaños que compartió su wallet (con su ✔)
 *   Lo que me contaste dónde vive, comida, música, familia, trabajo, gustos y «algo más»
 *
 * Cada respuesta se abre en una hoja inferior con los mismos chips de la primera vez y el campo
 * libre; se guarda o se borra ahí mismo. Abajo, «Borrar todo lo que te conté». AURA lo lee de tu
 * perfil en cada conversación: lo que se borra aquí, ella deja de saberlo.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { de, tr, useIdioma } from '../i18n';
import { api } from '../lib/api';
import { cumpleLegible, guardarPerfil, guardarPerfilConRecibo, usePerfil } from '../lib/perfil';
import { claveComunDeCampo, copiaConocer, reciboDurable, suprimirCopias, type EstadoSupresion } from '../lib/supresion';
import type { Encuesta } from '../nucleo/contrato';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Aparecer, Boton, Campo, Chip, Fila, Grupo, Hoja, Palomita, PantallaConCabecera, Texto, vibrar } from '../ui';
import { PREGUNTAS, armarRespuesta, datoConocerDe, separarRespuesta, type Pregunta } from '../primeravez/flujo';
import type { RaizParams } from '../app/rutas';

type Props = NativeStackScreenProps<RaizParams, 'Perfil'>;

type Editando = { campo: Pregunta['campo'] | 'otros' } | null;

const ETIQUETAS: Record<Pregunta['campo'], { es: string; en: string }> = {
  vive: { es: 'Dónde vives', en: 'Where you live' },
  comida: { es: 'Comida favorita', en: 'Favorite food' },
  musica: { es: 'Música', en: 'Music' },
  familia: { es: 'Tu familia', en: 'Your family' },
  trabajo: { es: 'A qué te dedicas', en: 'What you do' },
  gustos: { es: 'Lo que te gusta', en: 'What you enjoy' },
  ayuda: { es: 'Lo que quieres que AURA haga por ti', en: 'What you want AURA to do for you' },
};

/** La hoja para editar una respuesta: chips (varios) + texto libre. */
function EditorRespuesta({
  pregunta,
  valor,
  onGuardar,
  onBorrar,
  borrando,
  errorBorrar,
}: {
  pregunta: Pregunta | null;
  valor: string;
  onGuardar: (v: string) => void;
  onBorrar: () => void;
  /** El borrado va en camino (esperando el recibo de cada copia). */
  borrando: boolean;
  errorBorrar: string | null;
}) {
  const idioma = useIdioma();
  const inicial = pregunta ? separarRespuesta(valor, pregunta.sugerencias, idioma) : { chips: [], texto: valor };
  const [chips, setChips] = useState<string[]>(inicial.chips);
  const [texto, setTexto] = useState(inicial.texto);
  const resp = armarRespuesta(chips, texto);
  return (
    <View style={{ gap: MEDIDA.espacio.l }}>
      {pregunta && (
        <View style={s.chips}>
          {pregunta.sugerencias.map((sug) => {
            const t = de(sug);
            const activo = chips.includes(t);
            return <Chip key={sug.es} texto={t} activo={activo} tam="chico" onPress={() => setChips((c) => (activo ? c.filter((x) => x !== t) : [...c, t]))} />;
          })}
        </View>
      )}
      <Campo
        etiqueta={pregunta ? tr('Con tus palabras', 'In your own words') : tr('Lo que quieras que sepa', 'Anything you want her to know')}
        value={texto}
        onChangeText={(t) => setTexto(t.slice(0, 280))}
        placeholder={pregunta ? de(pregunta.ejemplo) : tr('Ej.: soy alérgico al maní', 'E.g.: I’m allergic to peanuts')}
        autoCapitalize="sentences"
        autoCorrect
        multiline={!pregunta}
        style={!pregunta ? { minHeight: 80, textAlignVertical: 'top' } : undefined}
      />
      <Boton titulo={tr('Guardar', 'Save')} onPress={() => onGuardar(resp)} deshabilitado={!resp || borrando} />
      {(!!valor || !!errorBorrar) && (
        <Boton
          titulo={errorBorrar ? tr('Volver a intentar el borrado', 'Try erasing again') : tr('Borrar esta respuesta', 'Erase this answer')}
          icono="basura"
          variante="fantasma"
          onPress={onBorrar}
          cargando={borrando}
          textoCargando={tr('Borrando…', 'Erasing…')}
        />
      )}
      {!!errorBorrar && (
        <Texto v="chica" color="aviso">
          {errorBorrar}
        </Texto>
      )}
    </View>
  );
}

export function LoQueSabe({ navigation }: Props) {
  const idioma = useIdioma();
  const tema = useTema();
  const perfil = usePerfil();
  const [editando, setEditando] = useState<Editando>(null);
  const [borrarTodo, setBorrarTodo] = useState(false);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);
  /** La supresión en curso (una respuesta o todo): pendiente hasta tener el recibo de cada copia. */
  const [suprimiendo, setSuprimiendo] = useState<EstadoSupresion | null>(null);
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const enc = perfil?.encuesta || {};
  const pregunta = editando && editando.campo !== 'otros' ? PREGUNTAS.find((p) => p.campo === editando.campo) || null : null;

  const abrirEditor = (campo: Pregunta['campo'] | 'otros') => {
    setErrorCampo(null);
    setSuprimiendo(null);
    setEditando({ campo });
  };

  const guardarCampo = (campo: keyof Encuesta, v: string) => {
    guardarPerfil({ encuesta: { [campo]: v } });
    // Corregir también corrige su copia en «lo que sé de ti» (misma clave común: se reemplaza, no se repite), y
    // el servidor corrige sus usos activos: los resúmenes que decían lo viejo y el system congelado (AUR11).
    const d = campo !== 'otros' ? datoConocerDe(campo, v) : null;
    if (d) void api('/api/cerebro/conocer', { method: 'POST', body: JSON.stringify({ ...d, origen: 'ajustes', dicho: Date.now() }) }, 10_000).catch(() => undefined);
    vibrar('exito');
    setEditando(null);
  };

  /**
   * «Borrar esta respuesta»: el perfil Y su copia en «lo que sé de ti» (PRIV01). La hoja se cierra solo
   * con el recibo durable de las dos; si no, dice qué pasó y deja reintentar.
   */
  const borrarCampo = async (campo: keyof Encuesta) => {
    setSuprimiendo('pendiente');
    setErrorCampo(null);
    const clave = claveComunDeCampo(campo);
    const r = await suprimirCopias([
      { nombre: 'perfil', borrar: () => guardarPerfilConRecibo({ encuesta: { [campo]: '' } }) },
      ...(clave ? [copiaConocer(api, { claves: [clave] })] : []),
    ]);
    setSuprimiendo(r.estado);
    if (r.estado === 'confirmado') {
      vibrar('suave');
      setEditando(null);
      return;
    }
    vibrar('aviso');
    setErrorCampo(
      tr(
        'Ya no está en este teléfono, pero el servidor todavía no confirmó que lo borró de forma segura. Lo sigo intentando; vuelve a tocar para comprobarlo.',
        'It’s gone from this phone, but the server hasn’t confirmed it was safely erased yet. I’ll keep trying; tap again to check.'
      )
    );
  };

  return (
    <PantallaConCabecera
      titulo={tr('Lo que le contaste a AURA', 'What you told AURA')}
      subtitulo={tr('Lo que le contaste. Lo usa para ayudarte; tú lo cambias o lo borras cuando quieras.', 'What you told her. She uses it to help you; change or erase it anytime.')}
      onAtras={() => navigation.goBack()}
    >
      <View style={{ gap: MEDIDA.espacio.xl }}>
        {(!!perfil?.nombreGenesis || !!perfil?.cumple) && (
          <Aparecer>
            <Grupo titulo={tr('De Genesis ID', 'From Genesis ID')} pie={tr('Lo compartió tu wallet con tu permiso.', 'Shared by your wallet with your permission.')}>
              {!!perfil?.nombreGenesis && <Fila titulo={perfil.nombreGenesis} detalle={tr('Tu nombre', 'Your name')} icono="persona" derecha={<Palomita hecho tam={24} color={tema.exito} colorMarca="#FFFFFF" />} />}
              {!!perfil?.cumple && <Fila titulo={cumpleLegible(perfil.cumple, idioma)} detalle={tr('Tu cumpleaños', 'Your birthday')} icono="pastel" derecha={<Palomita hecho tam={24} color={tema.exito} colorMarca="#FFFFFF" />} />}
            </Grupo>
          </Aparecer>
        )}

        <Aparecer retraso={60}>
          <Grupo titulo={tr('Lo que me contaste', 'What you told me')}>
            {PREGUNTAS.map((p) => (
              <Fila key={p.campo} titulo={tr(ETIQUETAS[p.campo].es, ETIQUETAS[p.campo].en)} detalle={enc[p.campo] || tr('Sin responder · toca para contarme', 'Not answered · tap to tell me')} icono={p.icono} onPress={() => abrirEditor(p.campo)} />
            ))}
            <Fila titulo={tr('Algo más', 'Anything else')} detalle={enc.otros || tr('Lo que quieras que AURA sepa', 'Whatever you want AURA to know')} icono="chispas" onPress={() => abrirEditor('otros')} />
          </Grupo>
        </Aparecer>

        {/* Siempre a mano: aunque la encuesta esté vacía, AURA puede haber aprendido cosas conversando. */}
        <Aparecer retraso={120}>
          <Boton titulo={tr('Borrar todo lo que te conté', 'Erase everything I told you')} icono="basura" variante="peligro" onPress={() => setBorrarTodo(true)} />
        </Aparecer>
      </View>

      <Hoja
        visible={!!editando}
        onCerrar={() => setEditando(null)}
        titulo={pregunta ? de(pregunta.titulo) : tr('Algo más que quieras que sepa', 'Anything else she should know')}
        subtitulo={pregunta ? de(pregunta.nota) : undefined}
      >
        {!!editando && (
          <EditorRespuesta
            key={editando.campo}
            pregunta={pregunta}
            valor={enc[editando.campo] || ''}
            onGuardar={(v) => guardarCampo(editando.campo, v)}
            onBorrar={() => void borrarCampo(editando.campo)}
            borrando={suprimiendo === 'pendiente'}
            errorBorrar={errorCampo}
          />
        )}
      </Hoja>

      <Hoja
        visible={borrarTodo}
        onCerrar={() => setBorrarTodo(false)}
        titulo={tr('¿Borrar todo lo que le contaste?', 'Erase everything you told her?')}
        subtitulo={tr('AURA deja de saber dónde vives, tus gustos y tu familia. Tu apodo y tu cumpleaños se quedan.', 'AURA will forget where you live, what you like and your family. Your nickname and birthday stay.')}
      >
        <View style={{ gap: MEDIDA.espacio.m }}>
          <Texto v="chica" color="texto3">
            {tr('No se puede deshacer.', 'This can’t be undone.')}
          </Texto>
          {!!errorBorrar && (
            <Texto v="chica" color="aviso">
              {errorBorrar}
            </Texto>
          )}
          <Boton
            titulo={tr('Borrar todo', 'Erase all')}
            icono="basura"
            variante="peligro"
            cargando={suprimiendo === 'pendiente'}
            textoCargando={tr('Borrando…', 'Erasing…')}
            onPress={async () => {
              // Todo de verdad: lo que AURA aprendió conversando (que también entra en lo que sabe de ti) y la
              // encuesta entera, también «ayuda» (auditoría de Codex del 3-oct, PRI 001). Primero lo del
              // servidor: si no quedó guardado de verdad (durable), no se cierra ni se vacía la encuesta, así el
              // botón sigue aquí para volver a intentarlo (Codex en #137).
              setSuprimiendo('pendiente');
              setErrorBorrar(null);
              let r: unknown = null;
              try {
                r = await api<{ durable?: boolean }>('/api/cerebro/conocer', { method: 'DELETE' }, 15_000);
              } catch {
                r = null;
              }
              // Solo `durable: true` es recibo: un servidor que no lo dice tampoco confirma (PRIV01).
              if (!reciboDurable(r)) {
                setSuprimiendo('error');
                setErrorBorrar(tr('No alcancé a borrar de forma segura lo que aprendí conversando. No cerré nada: vuelve a intentarlo en un momento.', 'I couldn’t safely erase what I learned from our chats. Nothing was closed: try again in a moment.'));
                return;
              }
              // Y la encuesta, ESPERANDO su recibo (antes el PUT salía y la hoja se cerraba sin saber si quedó).
              const enPerfil = await guardarPerfilConRecibo({ encuesta: { vive: '', comida: '', musica: '', familia: '', trabajo: '', gustos: '', ayuda: '', otros: '' } });
              if (!enPerfil) {
                setSuprimiendo('error');
                setErrorBorrar(
                  tr(
                    'Lo que aprendí conversando ya está borrado. Tus respuestas ya no están en este teléfono, pero el servidor todavía no confirmó que las borró: lo sigo intentando; vuelve a tocar «Borrar todo» para comprobarlo.',
                    'What I learned from our chats is erased. Your answers are gone from this phone, but the server hasn’t confirmed erasing them yet: I’ll keep trying; tap “Erase all” again to check.'
                  )
                );
                return;
              }
              setSuprimiendo('confirmado');
              vibrar('medio');
              setErrorBorrar(null);
              setBorrarTodo(false);
            }}
          />
          <Boton titulo={tr('Cancelar', 'Cancel')} variante="secundario" onPress={() => setBorrarTodo(false)} />
        </View>
      </Hoja>
    </PantallaConCabecera>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
