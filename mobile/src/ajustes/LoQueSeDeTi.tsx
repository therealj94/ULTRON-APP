/**
 * «LO QUE SÉ DE TI»: lo que AURA fue aprendiendo de la persona en las conversaciones (server/cerebro-continuo.ts,
 * lib/conocer-persona.ts; la lógica en compa/cerebro.ts), al lado de «Lo que AURA sabe de ti» (la ruta
 * Perfil, lo que contó en la primera vez). José (2-oct): «debo sentir que sabe, que recuerda, sabe algo
 * que quedó a medias… sabe todo de mí».
 *
 *   · Quedó a medias   lo que AURA prometió, lo que dijiste que harías, preguntas sin resolver, borradores
 *                      sin mandar: «Hecho» o «Descartar».
 *   · Por categoría    familia, trabajo, metas, gustos, salud, rutinas, fechas, personas: cada dato con su
 *                      PROCEDENCIA (AUR11: quién lo dijo o si AURA lo dedujo, de dónde salió, cuándo, y si
 *                      AURA lo usa) y, al tocarlo, «Corregir» y «No usarlo / Usarlo»; y «Olvidar» (se borra
 *                      en el servidor, en todas sus copias; AURA deja de saberlo).
 *   · Lo que aún no sé las preguntas que AURA te irá haciendo, una a la vez.
 *
 * Corregir va al servidor (PATCH /api/cerebro/conocer/:id), que cambia también sus usos activos: la
 * respuesta del perfil que lo repite, los resúmenes de conversaciones que decían lo viejo y el system de la
 * conversación en curso. Limitar lo deja guardado y a la vista, pero AURA no lo usa.
 *
 * Una hoja de toda la app (app/hojas.ts → app/HojasCerebro.tsx).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { api } from '../lib/api';
import { guardarPerfilConRecibo } from '../lib/perfil';
import { campoDeDato, copiaConocer, suprimirCopias, type EstadoSupresion } from '../lib/supresion';
import { idiomaActual, tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Campo, Hoja, Icono, Texto, vibrar } from '../ui';
import { abiertosDe, conDato, conocerDe, etiquetaAbierto, ordenarAbiertos, procedenciaDato, sinDato, type Abierto, type Conocer, type DatoPersona } from '../compa/cerebro';

type Props = { visible: boolean; onCerrar: () => void };

export function HojaConocer({ visible, onCerrar }: Props) {
  const tema = useTema();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [conocer, setConocer] = useState<Conocer | null>(null);
  const [abiertos, setAbiertos] = useState<Abierto[] | null>(null);
  const [error, setError] = useState('');
  /** El dato que pide confirmar «Olvidar». */
  const [olvidando, setOlvidando] = useState<string | null>(null);
  /** El estado de cada «Olvidar» en curso o fallido, por id del dato. */
  const [supresion, setSupresion] = useState<Record<string, EstadoSupresion>>({});
  /** El dato abierto (con «Corregir» y «No usarlo»), y el texto que se está corrigiendo. */
  const [abierto, setAbierto] = useState<string | null>(null);
  const [corrigiendo, setCorrigiendo] = useState<{ id: string; texto: string } | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const leer = useCallback(async () => {
    const [c, a] = await Promise.allSettled([api('/api/cerebro/conocer', { method: 'GET' }, 15_000), api('/api/cerebro/abiertos', { method: 'GET' }, 15_000)]);
    if (c.status === 'fulfilled') setConocer(conocerDe(c.value));
    else setConocer((x) => x ?? { categorias: [], total: 0, faltan: [] });
    if (a.status === 'fulfilled') setAbiertos(ordenarAbiertos(abiertosDe(a.value)));
    else setAbiertos((x) => x ?? []);
    const fallo = c.status === 'rejected' ? c.reason : a.status === 'rejected' ? a.reason : null;
    setError(fallo ? (fallo as any)?.message || tr('No pude leer todo lo que sé de ti.', 'I couldn’t load everything I know about you.') : '');
  }, []);

  useEffect(() => {
    if (!visible) {
      setOlvidando(null);
      setSupresion({});
      setAbierto(null);
      setCorrigiendo(null);
      return;
    }
    void leer();
  }, [visible, leer]);

  /**
   * «Olvidar» (PRIV01): el dato, sus copias con la misma clave común y, si es una respuesta de la primera
   * vez («Vive en Tela» ↔ «Dónde vives»), también esa respuesta del perfil. Mientras tanto queda a la vista
   * como «olvidando…»; solo se quita de la lista con el recibo durable de todas las copias. Sin recibo
   * (red, `durable: false` o ausente) se queda y lo dice: antes se escondía igual.
   */
  const olvidar = async (d: DatoPersona) => {
    setOlvidando(null);
    setError('');
    setSupresion((m) => ({ ...m, [d.id]: 'pendiente' }));
    const campo = campoDeDato(d);
    const clave = d.clave && d.categoria ? { categoria: d.categoria, clave: d.clave } : null;
    const r = await suprimirCopias([
      copiaConocer(api, { ids: [d.id], claves: clave ? [clave] : [] }),
      ...(campo ? [{ nombre: 'perfil', borrar: () => guardarPerfilConRecibo({ encuesta: { [campo]: '' } }) }] : []),
    ]);
    setSupresion((m) => ({ ...m, [d.id]: r.estado }));
    if (r.estado === 'confirmado') {
      vibrar('medio');
      setConocer((c) => (c ? sinDato(c, d.id) : c));
      return;
    }
    vibrar('aviso');
    setError(
      tr(
        'No quedó confirmado que se borró de forma segura, así que lo dejo a la vista. Vuelve a tocar «Olvidar» en un momento.',
        'It wasn’t confirmed as safely erased, so I’m leaving it here. Tap “Forget” again in a moment.'
      )
    );
  };

  /**
   * Corregir o limitar (AUR11): va al servidor, que también cambia los usos activos del dato (el perfil, los
   * resúmenes, el system de la conversación). La vista cambia con lo que conteste; sin recibo durable lo dice.
   */
  const cambiarDato = async (d: DatoPersona, cuerpo: { dato: string } | { alcance: 'general' | 'limitado' }) => {
    setGuardando(d.id);
    setError('');
    try {
      const r = await api<{ dato?: DatoPersona; durable?: boolean }>(`/api/cerebro/conocer/${encodeURIComponent(d.id)}`, { method: 'PATCH', body: JSON.stringify(cuerpo) }, 15_000);
      if (r?.dato) setConocer((c) => (c ? conDato(c, r.dato!) : c));
      setCorrigiendo(null);
      vibrar(r?.durable === true ? 'exito' : 'aviso');
      if (r?.durable !== true) setError(tr('Quedó cambiado, pero el servidor todavía no confirmó que lo guardó de forma segura.', 'It’s changed, but the server hasn’t confirmed it was saved safely yet.'));
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No se pudo guardar.', 'It couldn’t be saved.'));
    } finally {
      setGuardando(null);
    }
  };
  const corregirDato = (d: DatoPersona, texto: string) => void cambiarDato(d, { dato: texto.trim() });
  const limitarDato = (d: DatoPersona) => void cambiarDato(d, { alcance: d.alcance === 'limitado' ? 'general' : 'limitado' });

  const cerrarAbierto = async (a: Abierto, estado: 'hecho' | 'descartado') => {
    setAbiertos((l) => (l || []).filter((x) => x.id !== a.id));
    try {
      await api(`/api/cerebro/abiertos/${encodeURIComponent(a.id)}/cerrar`, { method: 'POST', body: JSON.stringify({ estado }) }, 15_000);
      vibrar(estado === 'hecho' ? 'exito' : 'suave');
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No se pudo guardar.', 'It couldn’t be saved.'));
      void leer();
    }
  };

  const conDatos = (conocer?.categorias || []).filter((k) => k.datos.length);
  const cargando = conocer === null || abiertos === null;

  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      titulo={tr('Lo que AURA aprendió de ti', 'What AURA learned about you')}
      subtitulo={tr('Lo que AURA fue aprendiendo al hablar contigo. Lo que borres aquí, lo olvida.', 'What AURA has learned talking with you. Whatever you erase here, she forgets.')}
    >
      {cargando ? (
        <ActivityIndicator color={tema.acento} style={{ paddingVertical: MEDIDA.espacio.xl }} />
      ) : (
        <View style={{ gap: MEDIDA.espacio.xl }}>
          <View style={{ gap: MEDIDA.espacio.s }}>
            <Texto v="etiqueta" color="texto3">
              {tr('Quedó a medias', 'Left halfway')}
            </Texto>
            {abiertos!.length === 0 ? (
              <Texto v="chica" color="texto2">
                {tr('Nada pendiente. Cuando algo quede a medias en una conversación, AURA lo anota aquí y te lo recuerda.', 'Nothing pending. When something is left halfway in a conversation, AURA notes it here and reminds you.')}
              </Texto>
            ) : (
              abiertos!.map((a) => (
                <View key={a.id} style={[s.tarjeta, { borderColor: a.importante ? tema.acento : tema.borde, backgroundColor: tema.superficie }]}>
                  <Texto v="mini" color={a.importante ? 'acentoTexto' : 'texto3'}>
                    {etiquetaAbierto(a.tipo, idioma)}
                    {a.cuando ? ` · ${a.cuando}` : ''}
                  </Texto>
                  <Texto v="cuerpo">{a.texto}</Texto>
                  <View style={s.botones}>
                    <Boton titulo={tr('Hecho', 'Done')} icono="check" tam="chico" style={{ flex: 1 }} onPress={() => void cerrarAbierto(a, 'hecho')} />
                    <Boton titulo={tr('Descartar', 'Dismiss')} variante="fantasma" tam="chico" style={{ flex: 1 }} onPress={() => void cerrarAbierto(a, 'descartado')} />
                  </View>
                </View>
              ))
            )}
          </View>

          {conDatos.length === 0 ? (
            <Texto v="chica" color="texto2">
              {tr('Todavía no sé mucho de ti. Lo que me cuentes al hablar (tu familia, tu trabajo, lo que te gusta) aparece aquí.', 'I don’t know much about you yet. What you tell me as we talk (your family, your work, what you like) shows up here.')}
            </Texto>
          ) : (
            conDatos.map((k) => (
              <View key={k.id} style={{ gap: MEDIDA.espacio.s }}>
                <Texto v="etiqueta" color="texto3">
                  {k.nombre}
                </Texto>
                <View style={[s.caja, { backgroundColor: tema.superficie, borderColor: tema.borde }]}>
                  {k.datos.map((d, i) => (
                    <View key={d.id} style={[s.dato, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tema.borde }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Pressable
                          onPress={() => setAbierto((x) => (x === d.id ? null : d.id))}
                          accessibilityRole="button"
                          accessibilityLabel={tr(`${d.dato}. ${procedenciaDato(d, idioma)}. Toca para corregirlo o limitarlo.`, `${d.dato}. ${procedenciaDato(d, idioma)}. Tap to fix or limit it.`)}
                          style={{ gap: 2 }}
                        >
                          <Texto v="cuerpo" color={d.alcance === 'limitado' ? 'texto3' : undefined}>
                            {d.dato}
                          </Texto>
                          <Texto v="mini" color={supresion[d.id] === 'error' ? 'aviso' : 'texto3'}>
                            {supresion[d.id] === 'pendiente'
                              ? tr('Olvidando…', 'Forgetting…')
                              : supresion[d.id] === 'error'
                                ? tr('Sin confirmar que se borró', 'Erase not confirmed')
                                : procedenciaDato(d, idioma)}
                          </Texto>
                        </Pressable>
                        {corrigiendo?.id === d.id ? (
                          <View style={{ gap: 6, marginTop: 6 }}>
                            <Campo etiqueta={tr('Corregido', 'Corrected')} value={corrigiendo.texto} onChangeText={(t) => setCorrigiendo({ id: d.id, texto: t.slice(0, 240) })} autoCapitalize="sentences" autoCorrect />
                            <View style={s.botones}>
                              <Boton titulo={tr('Guardar', 'Save')} icono="check" tam="chico" style={{ flex: 1 }} cargando={guardando === d.id} deshabilitado={corrigiendo.texto.trim().length < 4 || corrigiendo.texto.trim() === d.dato} onPress={() => corregirDato(d, corrigiendo.texto)} />
                              <Boton titulo={tr('Cancelar', 'Cancel')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setCorrigiendo(null)} />
                            </View>
                          </View>
                        ) : abierto === d.id && olvidando !== d.id ? (
                          <View style={[s.botones, { marginTop: 6 }]}>
                            <Boton titulo={tr('Corregir', 'Fix')} icono="lapiz" variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setCorrigiendo({ id: d.id, texto: d.dato })} />
                            <Boton
                              titulo={d.alcance === 'limitado' ? tr('Usarlo', 'Use it') : tr('No usarlo', 'Don’t use it')}
                              icono={d.alcance === 'limitado' ? 'ojo' : 'ojoTachado'}
                              variante="fantasma"
                              tam="chico"
                              style={{ flex: 1 }}
                              cargando={guardando === d.id}
                              onPress={() => limitarDato(d)}
                            />
                          </View>
                        ) : null}
                        {olvidando === d.id ? (
                          <View style={[s.botones, { marginTop: 6 }]}>
                            <Boton titulo={tr('Olvidarlo', 'Forget it')} icono="basura" variante="peligro" tam="chico" style={{ flex: 1 }} onPress={() => void olvidar(d)} />
                            <Boton titulo={tr('Cancelar', 'Cancel')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setOlvidando(null)} />
                          </View>
                        ) : null}
                      </View>
                      {supresion[d.id] === 'pendiente' ? (
                        <ActivityIndicator color={tema.texto3} style={s.basura} />
                      ) : olvidando !== d.id ? (
                        <Pressable onPress={() => setOlvidando(d.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr(`Olvidar: ${d.dato}`, `Forget: ${d.dato}`)} style={s.basura}>
                          <Icono nombre="basura" tam={18} color={tema.texto3} />
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}

          {conocer!.faltan.length ? (
            <View style={{ gap: MEDIDA.espacio.s }}>
              <Texto v="etiqueta" color="texto3">
                {tr('Lo que aún no sé', 'What I don’t know yet')}
              </Texto>
              {conocer!.faltan.slice(0, 3).map((h) => (
                <Texto key={h.clave} v="chica" color="texto2">
                  · {h.pregunta}
                </Texto>
              ))}
              <Texto v="mini" color="texto3">
                {tr('Te lo iré preguntando con calma, una cosa a la vez.', 'I’ll ask you calmly, one thing at a time.')}
              </Texto>
            </View>
          ) : null}

          <Texto v="mini" color="texto3">
            {tr(
              '¿Algo está mal? Tócalo para corregirlo (AURA deja de usar lo viejo en todos lados) o para que no lo use; o bórralo con el bote.',
              'Something wrong? Tap it to fix it (AURA stops using the old version everywhere) or so she doesn’t use it; or erase it with the bin.'
            )}
          </Texto>
          {!!error && (
            <Texto v="chica" color="aviso">
              {error}
            </Texto>
          )}
        </View>
      )}
    </Hoja>
  );
}

const s = StyleSheet.create({
  tarjeta: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.m, gap: MEDIDA.espacio.s },
  caja: { borderWidth: 1, borderRadius: MEDIDA.radio.l, overflow: 'hidden' },
  dato: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: MEDIDA.espacio.m, paddingVertical: MEDIDA.espacio.m },
  basura: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  botones: { flexDirection: 'row', gap: MEDIDA.espacio.s },
});
