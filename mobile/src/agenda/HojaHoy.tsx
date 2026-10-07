/**
 * «HOY»: TU AGENDA DE UN VISTAZO (Más → Hoy). Lo que hay hoy, mañana o esta semana en los calendarios que
 * conectaste (Ajustes → Calendario), con la hora de Honduras que ya manda el servidor (server/calendario.ts). Si un
 * calendario no se pudo leer, lo dice arriba (no es un día vacío). Tocar un evento lo abre en su calendario.
 * Solo leer: los eventos nuevos los propone AURA y se crean con tu «sí».
 */
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { tr, useIdioma } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Hoja, Segmentado, Texto } from '../ui';
import { Tocable } from '../pulse/ui/Tocable';
import { abrirRuta } from '../app/rutas';
import { agendaDe } from './api';
import { avisoAgenda, diasVisibles, marcaProveedor, textoVacio, type AgendaApp } from './logica';

type Cuando = 'hoy' | 'manana' | 'semana';

export function HojaHoy({ visible, onCerrar }: { visible: boolean; onCerrar: () => void }) {
  const idioma = useIdioma() === 'en' ? 'en' : 'es';
  const tema = useTema();
  const [cuando, setCuando] = useState<Cuando>('hoy');
  const [agenda, setAgenda] = useState<AgendaApp | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async (c: Cuando) => {
    setCargando(true);
    setError('');
    try {
      setAgenda(await agendaDe(c));
    } catch (e: any) {
      setAgenda(null);
      setError(e?.message || tr('No pude leer tu calendario ahora mismo.', 'I couldn’t read your calendar right now.'));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void cargar(cuando);
  }, [visible, cuando, cargar]);

  const aviso = avisoAgenda(agenda, idioma);
  const dias = diasVisibles(agenda, cuando);
  const conVarios = !!agenda && agenda.conectados > 1;

  return (
    <Hoja visible={visible} onCerrar={onCerrar} titulo={tr('Hoy', 'Today')} subtitulo={tr('Tu calendario, en hora de Honduras', 'Your calendar, Honduras time')}>
      <View style={{ gap: MEDIDA.espacio.m }}>
        <Segmentado<Cuando>
          opciones={[
            { id: 'hoy', texto: tr('Hoy', 'Today') },
            { id: 'manana', texto: tr('Mañana', 'Tomorrow') },
            { id: 'semana', texto: tr('Semana', 'Week') },
          ]}
          valor={cuando}
          onCambiar={setCuando}
        />
        {!!error && (
          <Texto v="chica" color="aviso">
            {error}
          </Texto>
        )}
        {!!aviso && (
          <Texto v="chica" color={agenda?.conectados ? 'aviso' : 'texto2'}>
            {aviso}
          </Texto>
        )}
        {agenda && !agenda.conectados && <Boton titulo={tr('Ir a Ajustes', 'Go to Settings')} variante="secundario" tam="chico" onPress={() => (onCerrar(), abrirRuta('Ajustes'))} />}
        {cargando && !agenda && (
          <Texto v="chica" color="texto3">
            {tr('Mirando tu calendario…', 'Checking your calendar…')}
          </Texto>
        )}
        {!!agenda?.conectados && !dias.length && !cargando && (
          <Texto v="cuerpo" color="texto2">
            {textoVacio(cuando, idioma)}
          </Texto>
        )}
        {dias.map((d) => (
          <View key={d.fecha} style={{ gap: MEDIDA.espacio.s }}>
            <Texto v="cuerpoFuerte">{d.titulo}</Texto>
            {!d.eventos.length ? (
              <Texto v="chica" color="texto3">
                {textoVacio(cuando === 'manana' ? 'manana' : 'hoy', idioma)}
              </Texto>
            ) : (
              d.eventos.map((e) => (
                <Tocable
                  key={`${e.proveedor}:${e.id}`}
                  onPress={e.enlace ? () => void Linking.openURL(e.enlace!).catch(() => {}) : undefined}
                  etiqueta={`${e.hora}. ${e.titulo}${e.lugar ? `. ${e.lugar}` : ''}`}
                  style={[s.evento, { borderColor: tema.borde, backgroundColor: tema.superficie }]}
                >
                  <Texto v="chica" color="texto2" style={s.hora}>
                    {e.hora}
                  </Texto>
                  <View style={{ flex: 1 }}>
                    <Texto v="cuerpo" numberOfLines={2}>
                      {e.titulo || tr('(sin título)', '(no title)')}
                    </Texto>
                    {(!!e.lugar || conVarios) && (
                      <Texto v="mini" color="texto3" numberOfLines={1}>
                        {[e.lugar, conVarios ? marcaProveedor(e.proveedor) : ''].filter(Boolean).join(' · ')}
                      </Texto>
                    )}
                  </View>
                </Tocable>
              ))
            )}
          </View>
        ))}
      </View>
    </Hoja>
  );
}

const s = StyleSheet.create({
  evento: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: MEDIDA.radio.m, borderWidth: 1 },
  hora: { minWidth: 92 },
});
