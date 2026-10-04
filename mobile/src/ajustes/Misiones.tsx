/**
 * SUS MISIONES: las metas que AURA acompaña hasta cumplirlas (server/iniciativa.ts; la lógica en
 * compa/cerebro.ts). José (2-oct): «que quiera cumplir misiones, que se quiera involucrar».
 *
 *   · Cada misión abierta: su número («la misión 2», como la nombra AURA), el título, el objetivo, para
 *     cuándo (en terracota si ya se pasó), cuántos pasos lleva y cada paso con su ✔ (tocarlo lo marca
 *     hecho; lo hecho no se desmarca). Abajo, «Cumplida» y «Descartar».
 *   · «Nueva misión»: título, objetivo, pasos (uno por renglón) y fecha, escritos a mano.
 *
 * Una hoja de toda la app (app/hojas.ts → app/HojasCerebro.tsx): se abre desde el menú de la mesa, desde
 * Ajustes o con «abrir». Lo que se toca se ve al instante y viaja al servidor por detrás; si falla, se
 * dice y se vuelve a leer.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { api } from '../lib/api';
import { idiomaActual, tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, BotonCheck, Campo, Hoja, Texto, vibrar } from '../ui';
import {
  abierta,
  avanceMision,
  conPasoHecho,
  cuerpoCerrarMision,
  cuerpoNuevaMision,
  cuerpoPasoHecho,
  misionesDe,
  venceEnPalabras,
  type BorradorMision,
  type Mision,
} from '../compa/cerebro';

type Props = { visible: boolean; onCerrar: () => void };

const VACIA: BorradorMision = { titulo: '', objetivo: '', pasos: '', vence: '' };

export function HojaMisiones({ visible, onCerrar }: Props) {
  const tema = useTema();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [misiones, setMisiones] = useState<Mision[] | null>(null);
  const [error, setError] = useState('');
  const [creando, setCreando] = useState(false);
  const [borrador, setBorrador] = useState<BorradorMision>(VACIA);
  const [guardando, setGuardando] = useState(false);
  const [errorNueva, setErrorNueva] = useState('');
  /** La misión que pide confirmar «Descartar» (un toque suelto no tira una meta). */
  const [descartando, setDescartando] = useState<string | null>(null);

  const leer = useCallback(async () => {
    try {
      const r = await api('/api/misiones', { method: 'GET' }, 15_000);
      setMisiones(misionesDe(r).filter(abierta));
      setError('');
    } catch (e: any) {
      setMisiones((m) => m ?? []);
      setError(e?.message || tr('No pude leer tus misiones.', 'I couldn’t load your missions.'));
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setCreando(false);
      setDescartando(null);
      setErrorNueva('');
      return;
    }
    void leer();
  }, [visible, leer]);

  const mandar = async (cuerpo: Record<string, unknown>) => {
    try {
      await api('/api/misiones', { method: 'POST', body: JSON.stringify(cuerpo) }, 15_000);
      return true;
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No se pudo guardar.', 'It couldn’t be saved.'));
      void leer();
      return false;
    }
  };

  const marcarPaso = (m: Mision, i: number) => {
    const cuerpo = cuerpoPasoHecho(m, i);
    if (!cuerpo) return;
    setMisiones((l) => (l || []).map((x) => (x.id === m.id ? conPasoHecho(x, i, Date.now()) : x)));
    void mandar(cuerpo);
  };

  const cerrarMision = async (m: Mision, como: 'hecha' | 'descartada') => {
    setDescartando(null);
    setMisiones((l) => (l || []).filter((x) => x.id !== m.id));
    if (await mandar(cuerpoCerrarMision(m.id, como))) {
      vibrar(como === 'hecha' ? 'exito' : 'medio');
      void leer(); // los números de las que quedan cambian
    }
  };

  const crear = async () => {
    const v = cuerpoNuevaMision(borrador, Date.now(), idioma);
    if (!v.ok) {
      vibrar('aviso');
      return setErrorNueva((v as { error: string }).error);
    }
    setErrorNueva('');
    setGuardando(true);
    try {
      await api('/api/misiones', { method: 'POST', body: JSON.stringify(v.cuerpo) }, 15_000);
      vibrar('exito');
      setBorrador(VACIA);
      setCreando(false);
      void leer();
    } catch (e: any) {
      vibrar('aviso');
      setErrorNueva(e?.message || tr('No pude crearla.', 'I couldn’t create it.'));
    } finally {
      setGuardando(false);
    }
  };

  const ahora = Date.now();

  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      titulo={creando ? tr('Nueva misión', 'New mission') : tr('Misiones', 'Missions')}
      subtitulo={
        creando
          ? tr('Lo que quieres lograr. AURA te acompaña paso a paso y te pregunta cómo vas.', 'What you want to achieve. AURA walks it with you step by step and checks in.')
          : tr('Las metas que AURA te ayuda a cumplir. También se las puedes contar: «quiero vender el carro antes de diciembre».', 'The goals AURA helps you reach. You can also just tell her: “I want to sell the car before December”.')
      }
    >
      {creando ? (
        <View style={{ gap: MEDIDA.espacio.l }}>
          <Campo
            etiqueta={tr('¿Qué quieres lograr?', 'What do you want to achieve?')}
            value={borrador.titulo}
            onChangeText={(t) => setBorrador((b) => ({ ...b, titulo: t.slice(0, 80) }))}
            placeholder={tr('Ej.: Vender el carro', 'E.g.: Sell the car')}
            autoCapitalize="sentences"
            autoFocus
            maxLength={80}
          />
          <Campo
            etiqueta={tr('Para qué (opcional)', 'Why (optional)')}
            value={borrador.objetivo}
            onChangeText={(t) => setBorrador((b) => ({ ...b, objetivo: t.slice(0, 300) }))}
            placeholder={tr('Ej.: Juntar para la camioneta nueva', 'E.g.: Save up for the new truck')}
            autoCapitalize="sentences"
            multiline
            maxLength={300}
          />
          <Campo
            etiqueta={tr('Pasos (uno por renglón, opcional)', 'Steps (one per line, optional)')}
            value={borrador.pasos}
            onChangeText={(t) => setBorrador((b) => ({ ...b, pasos: t.slice(0, 1500) }))}
            placeholder={tr('Tomar fotos\nPoner precio\nPublicarlo', 'Take photos\nSet a price\nList it')}
            autoCapitalize="sentences"
            multiline
            style={{ minHeight: 96, textAlignVertical: 'top' }}
          />
          <Campo
            etiqueta={tr('Para cuándo (opcional)', 'By when (optional)')}
            value={borrador.vence}
            onChangeText={(t) => setBorrador((b) => ({ ...b, vence: t.slice(0, 10) }))}
            placeholder={tr('DD/MM o AAAA-MM-DD', 'DD/MM or YYYY-MM-DD')}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          {!!errorNueva && (
            <Texto v="chica" color="aviso">
              {errorNueva}
            </Texto>
          )}
          <Boton titulo={tr('Crear misión', 'Create mission')} icono="check" cargando={guardando} deshabilitado={borrador.titulo.trim().length < 3} onPress={() => void crear()} />
          <Boton titulo={tr('Cancelar', 'Cancel')} variante="secundario" onPress={() => setCreando(false)} />
        </View>
      ) : (
        <View style={{ gap: MEDIDA.espacio.l }}>
          {misiones === null ? (
            <ActivityIndicator color={tema.acento} style={{ paddingVertical: MEDIDA.espacio.xl }} />
          ) : misiones.length === 0 ? (
            <Texto v="chica" color="texto2">
              {tr('No tienes misiones abiertas. Crea una aquí, o cuéntale a AURA algo que quieras lograr y ella te propone cómo.', 'You have no open missions. Create one here, or tell AURA something you want to achieve and she’ll suggest how.')}
            </Texto>
          ) : (
            misiones.map((m) => {
              const av = avanceMision(m, idioma);
              const v = venceEnPalabras(m.vence, ahora, idioma);
              return (
                <View key={m.id} style={[s.tarjeta, { borderColor: m.estado === 'pausada' ? tema.borde : tema.acento, backgroundColor: tema.superficie }]}>
                  <View style={s.cabeza}>
                    {m.numero ? (
                      <View style={[s.numero, { backgroundColor: tema.acentoFondo }]}>
                        <Texto v="chicaFuerte" color="acentoTexto">
                          {m.numero}
                        </Texto>
                      </View>
                    ) : null}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Texto v="cuerpoFuerte">{m.titulo}</Texto>
                      {m.objetivo && m.objetivo !== m.titulo ? (
                        <Texto v="chica" color="texto2">
                          {m.objetivo}
                        </Texto>
                      ) : null}
                    </View>
                  </View>
                  <View style={s.fila}>
                    <Texto v="mini" color="texto3">
                      {av.texto}
                      {m.estado === 'pausada' ? tr(' · en pausa', ' · paused') : ''}
                    </Texto>
                    {v ? (
                      <Texto v="mini" color={v.tarde ? 'aviso' : v.pronto ? 'acentoTexto' : 'texto3'}>
                        {v.texto}
                      </Texto>
                    ) : null}
                  </View>
                  {av.total ? (
                    <View style={[s.barra, { backgroundColor: tema.fondo2 }]}>
                      <View style={[s.relleno, { width: `${Math.round(av.fraccion * 100)}%`, backgroundColor: tema.acento }]} />
                    </View>
                  ) : null}
                  {m.pasos.map((p, i) => (
                    <View key={`${i}-${p.texto}`} style={s.paso}>
                      <BotonCheck
                        hecho={p.hecho}
                        tam={26}
                        deshabilitado={p.hecho}
                        onPress={() => marcarPaso(m, i)}
                        etiqueta={p.hecho ? tr(`Hecho: ${p.texto}`, `Done: ${p.texto}`) : tr(`Marcar hecho: ${p.texto}`, `Mark done: ${p.texto}`)}
                      />
                      <Texto v="chica" color={p.hecho ? 'texto3' : 'texto'} style={[{ flex: 1 }, p.hecho && s.tachado]}>
                        {p.texto}
                      </Texto>
                    </View>
                  ))}
                  {descartando === m.id ? (
                    <View style={{ gap: MEDIDA.espacio.s }}>
                      <Texto v="chica" color="texto2">
                        {tr('¿Descartarla? AURA deja de seguirla.', 'Discard it? AURA will stop following it.')}
                      </Texto>
                      <View style={s.botones}>
                        <Boton titulo={tr('Sí, descartar', 'Yes, discard')} variante="peligro" tam="chico" style={{ flex: 1 }} onPress={() => void cerrarMision(m, 'descartada')} />
                        <Boton titulo={tr('No', 'No')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setDescartando(null)} />
                      </View>
                    </View>
                  ) : (
                    <View style={s.botones}>
                      <Boton titulo={tr('Cumplida', 'Done')} icono="check" tam="chico" style={{ flex: 1 }} onPress={() => void cerrarMision(m, 'hecha')} />
                      <Boton titulo={tr('Descartar', 'Discard')} variante="fantasma" tam="chico" style={{ flex: 1 }} onPress={() => setDescartando(m.id)} />
                    </View>
                  )}
                </View>
              );
            })
          )}
          {!!error && (
            <Texto v="chica" color="aviso">
              {error}
            </Texto>
          )}
          <Boton
            titulo={tr('Nueva misión', 'New mission')}
            icono="mas"
            variante="secundario"
            onPress={() => {
              setErrorNueva('');
              setCreando(true);
            }}
          />
        </View>
      )}
    </Hoja>
  );
}

const s = StyleSheet.create({
  tarjeta: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.m, gap: MEDIDA.espacio.s },
  cabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  numero: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  fila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  barra: { height: 4, borderRadius: 2, overflow: 'hidden' },
  relleno: { height: 4, borderRadius: 2 },
  paso: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  tachado: { textDecorationLine: 'line-through' },
  botones: { flexDirection: 'row', gap: MEDIDA.espacio.s, marginTop: 2 },
});
