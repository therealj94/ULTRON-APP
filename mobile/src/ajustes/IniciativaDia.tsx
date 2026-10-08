/**
 * INICIATIVA: AURA te busca por su cuenta (tanda F2; server/iniciativa-dia.ts). El interruptor general, el resumen de la
 * mañana y su hora, los avisos a tiempo, «llámame en lugar de avisar» y las horas quietas. Todo vive en el servidor por
 * cuenta; aquí solo se enseña y se cambia. La lógica vive en compa/iniciativaDia.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '../lib/api';
import { tr, useIdioma } from '../i18n';
import { MEDIDA } from '../nucleo/tema';
import { Boton, Fila, Grupo, Hoja, Interruptor, Segmentado, Texto, vibrar } from '../ui';
import { avisoDesdeManana, horaBonita, horasResumenCon, idQuietasDia, QUIETAS_DIA, resumenEstado, vistaDeServidor, type VistaDia } from '../compa/iniciativaDia';

export function HojaIniciativaDia({ visible, onCerrar }: { visible: boolean; onCerrar: () => void }) {
  const idioma = useIdioma();
  const en = idioma === 'en';
  const [v, setV] = useState<VistaDia | null>(null);
  const [error, setError] = useState('');
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const leer = useCallback(async () => {
    try {
      const r = vistaDeServidor(await api('/api/iniciativa/dia', { method: 'GET' }, 10_000));
      if (!r) throw new Error('mal');
      setV(r);
      setError('');
    } catch {
      // No se pudo leer: NO es «apagada»; se dice.
      setError(tr('No pude leer tu iniciativa. Prueba en un momento.', 'I couldn’t read your initiative settings. Try again in a moment.'));
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setNota('');
      void leer();
    }
  }, [visible, leer]);

  const enviar = async (ruta: string, cuerpo: Record<string, unknown>) => {
    setOcupado(true);
    try {
      const r = vistaDeServidor(await api(ruta, { method: 'POST', body: JSON.stringify(cuerpo) }, 15_000));
      if (!r) throw new Error(tr('No pude guardar el cambio.', 'I couldn’t save the change.'));
      vibrar('suave');
      setV(r);
      setNota(avisoDesdeManana(r, en ? 'en' : 'es'));
      setError('');
    } catch (e: any) {
      setError(String(e?.message || tr('No pude guardar el cambio.', 'I couldn’t save the change.')).slice(0, 160));
    } finally {
      setOcupado(false);
    }
  };
  const guardar = (c: Record<string, unknown>) => void enviar('/api/iniciativa/dia', c);
  const p = v?.preferencias;

  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      titulo={tr('Iniciativa', 'Initiative')}
      subtitulo={tr('AURA te busca durante el día solo si vale la pena. Siempre propone; nunca hace nada sin tu «sí».', 'AURA reaches out during the day only when it’s worth it. She always suggests; never acts without your yes.')}
    >
      {error ? (
        <Texto v="chica" color="aviso">
          {error}
        </Texto>
      ) : null}
      {nota ? <Texto v="chica">{nota}</Texto> : null}
      {!v || !p ? null : (
        <View style={s.col}>
          <Grupo titulo={tr('AURA por su cuenta', 'AURA on her own')} pie={resumenEstado(v, en ? 'en' : 'es')}>
            <Fila titulo={tr('Iniciativa', 'Initiative')} derecha={<Interruptor valor={p.activa} onCambiar={(x) => guardar({ activa: x })} etiqueta={tr('Iniciativa', 'Initiative')} />} />
            {p.activa ? (
              <Fila
                titulo={v.hoyNo ? tr('Hoy en pausa', 'Paused today') : tr('No me molestes hoy', 'Don’t disturb me today')}
                detalle={v.hoyNo ? tr('Toca para volver a recibir avisos hoy', 'Tap to get nudges again today') : tr('Ni resumen ni avisos hasta mañana', 'No summary or nudges until tomorrow')}
                icono="campana"
                onPress={() => void enviar('/api/iniciativa/dia/hoy-no', v.hoyNo ? { quitar: true } : {})}
              />
            ) : null}
          </Grupo>

          {p.activa ? (
            <>
              <Grupo titulo={tr('Resumen de la mañana', 'Morning summary')} pie={tr('Tu agenda, recordatorios, mensajes importantes, lo que quedó a medias y tus misiones. Si no hay nada, no te escribe.', 'Your schedule, reminders, important messages, unfinished things and your missions. If there’s nothing, she won’t write.')}>
                <Fila titulo={tr('Mandarme el resumen', 'Send me the summary')} derecha={<Interruptor valor={p.resumen} onCambiar={(x) => guardar({ resumen: x })} etiqueta={tr('Resumen', 'Summary')} />} />
                {p.resumen ? (
                  <>
                    <View style={s.segmento}>
                      <Segmentado<string> opciones={horasResumenCon(p.horaResumen).map((h) => ({ id: h, texto: horaBonita(h) }))} valor={p.horaResumen} onCambiar={(h) => !ocupado && guardar({ horaResumen: h })} />
                    </View>
                    <Fila
                      titulo={tr('Llámame en lugar de avisar', 'Call me instead of notifying')}
                      detalle={tr('Fuera de tus horas quietas', 'Outside your quiet hours')}
                      derecha={<Interruptor valor={p.llamarResumen} onCambiar={(x) => guardar({ llamarResumen: x })} etiqueta={tr('Llamada del resumen', 'Summary call')} />}
                    />
                  </>
                ) : null}
              </Grupo>

              <Grupo
                titulo={tr('Avisos a tiempo', 'Timely nudges')}
                pie={tr(
                  `Un evento en 15 minutos, algo que espera tu «sí» hace más de 2 horas o algo que AURA quedó en avisarte. Como mucho ${v.topes.empujonesDia} al día y nunca dos en menos de ${v.topes.espacioMin} minutos.`,
                  `An event in 15 minutes, something waiting for your yes for over 2 hours, or something AURA said she’d tell you. At most ${v.topes.empujonesDia} a day and never two within ${v.topes.espacioMin} minutes.`
                )}
              >
                <Fila titulo={tr('Avisarme a tiempo', 'Nudge me in time')} derecha={<Interruptor valor={p.empujones} onCambiar={(x) => guardar({ empujones: x })} etiqueta={tr('Avisos a tiempo', 'Nudges')} />} />
                <Fila
                  titulo={tr('Llámame si un VIP escribe algo urgente', 'Call me if a VIP writes something urgent')}
                  detalle={tr('Fuera de tus horas quietas; si no, aviso normal', 'Outside your quiet hours; otherwise a normal notification')}
                  derecha={<Interruptor valor={p.llamarVip} onCambiar={(x) => guardar({ llamarVip: x })} etiqueta={tr('Llamada por VIP', 'VIP call')} />}
                />
              </Grupo>

              <Grupo titulo={tr('Horas quietas', 'Quiet hours')} pie={tr(`En ${p.zona}. En esas horas no hay avisos ni llamadas.`, `In ${p.zona}. No nudges or calls during them.`)}>
                <View style={s.segmento}>
                  <Segmentado<string>
                    opciones={QUIETAS_DIA.map((q) => ({ id: q.id, texto: `${q.desde}–${q.hasta}` }))}
                    valor={idQuietasDia(p.quietas)}
                    onCambiar={(id) => {
                      const q = QUIETAS_DIA.find((x) => x.id === id);
                      if (q && !ocupado) guardar({ quietas: { desde: q.desde, hasta: q.hasta } });
                    }}
                  />
                </View>
              </Grupo>
            </>
          ) : (
            <Boton titulo={tr('Encender', 'Turn on')} deshabilitado={ocupado} onPress={() => guardar({ activa: true })} />
          )}

          <Texto v="chica" color="texto2">
            {tr('También por voz: «no me molestes hoy», «mándame el resumen a las 7», «ya no me llames».', 'Also by voice (in Spanish): «no me molestes hoy», «mándame el resumen a las 7», «ya no me llames».')}
          </Texto>
        </View>
      )}
    </Hoja>
  );
}

const s = StyleSheet.create({
  col: { gap: MEDIDA.espacio.l },
  segmento: { paddingHorizontal: MEDIDA.espacio.m, paddingVertical: MEDIDA.espacio.s },
});
