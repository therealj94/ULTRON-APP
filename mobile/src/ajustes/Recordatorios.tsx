/**
 * SUS RECORDATORIOS (auditoría del 7-oct, A-3): la lista que antes no había. Los guarda el servidor (lib/
 * recordatorios-servidor.ts, con su repetición) y el teléfono pone la alarma de cada próxima vez (compa/
 * recordatoriosSync.ts). La lógica de cada fila vive en compa/recordatoriosServidor.ts (probada en node).
 *
 *   · Cada recordatorio: lo que hay que recordar, la PRÓXIMA vez («Mañana 7:00 a. m.»), cada cuánto se repite («todos los
 *     días») y si AURA llama.
 *   · Deslizar a la izquierda (o «Borrar») lo borra; «Hecho» lo marca hecho (uno de una vez sale de la lista; uno que se
 *     repite salta a la vez siguiente, salvo que acabe de sonar). La alarma de esa vez se quita del teléfono en el acto.
 *   · Se crean hablando: «recuérdame cada lunes a las 8 la junta».
 *
 * Una hoja de toda la app (app/hojas.ts → app/HojasCerebro.tsx): se abre desde «Más» y con «¿qué recordatorios tengo?».
 * Lo que se toca se ve al instante y va al servidor por detrás; si falla, se dice y se vuelve a leer. Después de cada
 * cambio, las alarmas del teléfono se ponen al día.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { api } from '../lib/api';
import { idiomaActual, tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Hoja, Texto, vibrar } from '../ui';
import { Tocable } from '../pulse/ui/Tocable';
import { lineaDeRecordatorio, listaDelServidor, sinRecordatorio, type RecordatorioDelServidor } from '../compa/recordatoriosServidor';
import { alCambiarEnHoja, reconciliarRecordatorios } from '../compa/recordatoriosSync';

type Props = { visible: boolean; onCerrar: () => void };

export function HojaRecordatorios({ visible, onCerrar }: Props) {
  const tema = useTema();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [lista, setLista] = useState<RecordatorioDelServidor[] | null>(null);
  const [error, setError] = useState('');

  const leer = useCallback(async () => {
    try {
      const r = await api('/api/recordatorios', { method: 'GET' }, 15_000);
      setLista(listaDelServidor(r).recordatorios);
      setError('');
    } catch (e: any) {
      setLista((l) => l ?? []);
      setError(e?.message || tr('No pude leer tus recordatorios.', 'I couldn’t load your reminders.'));
    }
  }, []);

  useEffect(() => {
    if (visible) void leer();
  }, [visible, leer]);

  /** Un cambio: se ve ya, va al servidor y las alarmas del teléfono se ponen al día. Si falla, se dice y se relee. */
  const cambiar = async (r: RecordatorioDelServidor, que: 'borrar' | 'hecho') => {
    if (que === 'borrar' || r.repetir.tipo === 'nunca') setLista((l) => sinRecordatorio(l || [], r.id));
    // Tanda F1: la alarma de esta vez se quita YA de este teléfono (antes, uno de una vez marcado hecho entre el push del
    // servidor y la alarma sonaba igual). Si el servidor no lo toma, reconciliar la vuelve a poner si sigue en pie.
    const alarmas = alCambiarEnHoja(r, que).catch(() => undefined);
    try {
      if (que === 'borrar') await api(`/api/recordatorios/${encodeURIComponent(r.id)}`, { method: 'DELETE' }, 15_000);
      else await api(`/api/recordatorios/${encodeURIComponent(r.id)}/hecho`, { method: 'POST', body: '{}' }, 15_000);
      vibrar(que === 'hecho' ? 'exito' : 'medio');
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No se pudo guardar.', 'It couldn’t be saved.'));
    }
    void leer();
    await alarmas;
    void reconciliarRecordatorios('hoja');
  };

  const ahora = Date.now();

  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      titulo={tr('Recordatorios', 'Reminders')}
      subtitulo={tr(
        'Los que AURA te recuerda, también los que se repiten. Desliza uno a la izquierda para borrarlo. Para crear uno, díselo: «recuérdame cada lunes a las 8 la junta».',
        'What AURA reminds you of, including repeating ones. Swipe one left to delete it. To add one, just say: “remind me every Monday at 8 about the meeting”.'
      )}
    >
      <View style={{ gap: MEDIDA.espacio.m }}>
        {lista === null ? (
          <ActivityIndicator color={tema.acento} style={{ paddingVertical: MEDIDA.espacio.xl }} />
        ) : lista.length === 0 ? (
          <Texto v="chica" color="texto2">
            {tr('No tienes recordatorios. Pídeselo a AURA: «recuérdame mañana a las 7 la pastilla».', 'You have no reminders. Ask AURA: “remind me tomorrow at 7 to take my pill”.')}
          </Texto>
        ) : (
          lista.map((r) => (
            <ReanimatedSwipeable
              key={r.id}
              friction={2}
              rightThreshold={60}
              overshootRight={false}
              onSwipeableOpen={() => void cambiar(r, 'borrar')}
              renderRightActions={() => (
                <View style={[s.borrarFondo, { backgroundColor: tema.aviso }]}>
                  <Texto v="chicaFuerte" style={{ color: '#fff' }}>
                    {tr('Borrar', 'Delete')}
                  </Texto>
                </View>
              )}
            >
              <View style={[s.tarjeta, { borderColor: r.sonado ? tema.borde : tema.acento, backgroundColor: tema.superficie }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Texto v="cuerpoFuerte">{r.texto}</Texto>
                  <Texto v="mini" color={r.sonado ? 'texto3' : 'acentoTexto'}>
                    {lineaDeRecordatorio(r, ahora, idioma)}
                  </Texto>
                </View>
                <View style={s.botones}>
                  <Tocable onPress={() => void cambiar(r, 'hecho')} vibrar etiqueta={tr(`Marcar hecho: ${r.texto}`, `Mark done: ${r.texto}`)} style={[s.chip, { borderColor: tema.acento }]}>
                    <Texto v="chicaFuerte" color="acentoTexto">
                      {tr('Hecho', 'Done')}
                    </Texto>
                  </Tocable>
                  <Tocable onPress={() => void cambiar(r, 'borrar')} vibrar etiqueta={tr(`Borrar: ${r.texto}`, `Delete: ${r.texto}`)} style={[s.chip, { borderColor: tema.borde }]}>
                    <Texto v="chica" color="texto2">
                      {tr('Borrar', 'Delete')}
                    </Texto>
                  </Tocable>
                </View>
              </View>
            </ReanimatedSwipeable>
          ))
        )}
        {!!error && (
          <Texto v="chica" color="aviso">
            {error}
          </Texto>
        )}
        <Boton titulo={tr('Actualizar', 'Refresh')} icono="cambiar" variante="secundario" tam="chico" onPress={() => void leer()} />
      </View>
    </Hoja>
  );
}

const s = StyleSheet.create({
  tarjeta: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.m },
  botones: { gap: 6, alignItems: 'stretch' },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  borrarFondo: { flex: 1, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: MEDIDA.espacio.l, borderRadius: MEDIDA.radio.l },
});
