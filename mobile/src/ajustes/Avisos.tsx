/**
 * TUS AVISOS: cuándo y por dónde AURA te avisa lo que propone por su cuenta (lib/avisos.ts, AUR12).
 *
 * Zona horaria (la de este teléfono con un toque), horas quietas, canal (solo en la app o también con la app
 * cerrada), «menos avisos», qué significa «Luego», avisar lo que vence aunque ya hubo un aviso ese día,
 * posponer hasta una fecha, las clases que no quieres y el apagado. Apagar alcanza lo pendiente: lo que ya
 * estaba por salir de esa clase se cancela en el servidor. La lógica vive en compa/avisos.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '../lib/api';
import { tr, useIdioma } from '../i18n';
import { MEDIDA } from '../nucleo/tema';
import { Boton, Chip, Grupo, Fila, Hoja, Interruptor, Segmentado, Texto, vibrar } from '../ui';
import {
  alternar,
  canalesPara,
  CLASES_AVISO,
  cuerpoPosponer,
  etiquetaClaseAviso,
  etiquetaLuego,
  idQuietas,
  prefsDeServidor,
  QUIETAS_RAPIDAS,
  zonaDelTelefono,
  type LuegoPref,
  type PreferenciasAvisos,
} from '../compa/avisos';

export function HojaAvisos({ visible, onCerrar }: { visible: boolean; onCerrar: () => void }) {
  const idioma = useIdioma();
  const [prefs, setPrefs] = useState<PreferenciasAvisos | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const leer = useCallback(async () => {
    try {
      const r = await api('/api/avisos/preferencias', { method: 'GET' }, 10_000);
      const p = prefsDeServidor(r);
      if (!p) throw new Error('mal');
      setPrefs(p);
      setError('');
    } catch {
      // No se pudo leer: NO es «todo apagado» ni «lo de por omisión»; se dice.
      setError(tr('No pude leer tus avisos. Prueba en un momento.', 'I couldn’t read your notification settings. Try again in a moment.'));
    }
  }, []);

  useEffect(() => {
    if (visible) void leer();
  }, [visible, leer]);

  const cambiar = async (ruta: string, cuerpo: Record<string, unknown>) => {
    setOcupado(true);
    try {
      await api(ruta, { method: 'POST', body: JSON.stringify(cuerpo) }, 15_000);
      vibrar('suave');
      await leer();
    } catch (e: any) {
      setError(String(e?.message || tr('No pude guardar el cambio.', 'I couldn’t save the change.')).slice(0, 160));
    } finally {
      setOcupado(false);
    }
  };
  const guardar = (c: Record<string, unknown>) => void cambiar('/api/avisos/preferencias', c);

  const zonaTel = zonaDelTelefono();
  const p = prefs;

  return (
    <Hoja visible={visible} onCerrar={onCerrar} titulo={tr('Tus avisos', 'Your notifications')} subtitulo={tr('Como mucho uno al día si no es urgente, y nada si no hay novedad.', 'At most one a day unless urgent, and nothing if there’s nothing new.')}>
      {error ? (
        <Texto v="chica" color="aviso">
          {error}
        </Texto>
      ) : null}
      {!p ? null : (
        <View style={s.col}>
          <Grupo titulo={tr('Avisos fuera de la app', 'Notifications outside the app')} pie={p.apagado ? tr('Apagados: lo que estaba por salir se canceló. Lo verás al abrir la app.', 'Off: anything pending was cancelled. You’ll see it when you open the app.') : undefined}>
            <Fila titulo={tr('Avisarme', 'Notify me')} derecha={<Interruptor valor={!p.apagado} onCambiar={(v) => guardar({ apagado: !v })} etiqueta={tr('Avisarme', 'Notify me')} />} />
            <Fila
              titulo={tr('También con la app cerrada', 'Also when the app is closed')}
              detalle={tr('Si no, solo dentro de la app', 'Otherwise only inside the app')}
              derecha={<Interruptor valor={p.canales.includes('push')} onCambiar={(v) => guardar({ canales: canalesPara(v) })} etiqueta={tr('Con la app cerrada', 'App closed')} />}
            />
            <Fila titulo={tr('Menos avisos', 'Fewer notifications')} detalle={tr('Uno cada tres días como mucho', 'At most one every three days')} derecha={<Interruptor valor={p.cadaDias > 1} onCambiar={(v) => guardar({ menosAvisos: v })} etiqueta={tr('Menos avisos', 'Fewer')} />} />
            <Fila
              titulo={tr('Lo que vence, aunque ya hubo uno hoy', 'Deadlines, even if I already got one today')}
              detalle={tr('Solo seguimientos con fecha cercana', 'Only follow-ups with a close date')}
              derecha={<Interruptor valor={p.urgentes.includes('seguimiento')} onCambiar={(v) => guardar({ urgentes: v ? [...new Set([...p.urgentes, 'seguimiento'])] : p.urgentes.filter((c) => c !== 'seguimiento') })} etiqueta={tr('Urgentes', 'Urgent')} />}
            />
          </Grupo>

          <Grupo titulo={tr('Horario', 'Schedule')} pie={tr(`Tu zona: ${p.zona}. Cambiarla no mueve las fechas que ya pusiste.`, `Your time zone: ${p.zona}. Changing it doesn’t move dates you already set.`)}>
            <View style={s.segmento}>
              <Segmentado<string>
                opciones={QUIETAS_RAPIDAS.map((q) => ({ id: q.id, texto: `${q.desde}–${q.hasta}` }))}
                valor={idQuietas(p.quietas)}
                onCambiar={(id) => {
                  const q = QUIETAS_RAPIDAS.find((x) => x.id === id);
                  if (q) guardar({ quietas: { desde: q.desde, hasta: q.hasta } });
                }}
              />
            </View>
            {zonaTel && zonaTel !== p.zona ? <Fila titulo={tr(`Usar la zona de este teléfono (${zonaTel})`, `Use this phone’s time zone (${zonaTel})`)} icono="reloj" onPress={() => guardar({ zona: zonaTel })} /> : null}
          </Grupo>

          <Grupo titulo={tr('Cuando digo «Luego»', 'When I say “Later”')}>
            <View style={s.segmento}>
              <Segmentado<LuegoPref> opciones={(['2h', 'tarde', 'manana'] as LuegoPref[]).map((l) => ({ id: l, texto: etiquetaLuego(l, idioma) }))} valor={p.luego} onCambiar={(l) => guardar({ luego: l })} />
            </View>
          </Grupo>

          <Grupo titulo={tr('No quiero avisos de…', 'I don’t want notifications about…')} pie={p.temasSilenciados.length ? tr(`${p.temasSilenciados.length} tema(s) silenciado(s).`, `${p.temasSilenciados.length} muted topic(s).`) : undefined}>
            <View style={s.chips}>
              {CLASES_AVISO.map((c) => (
                <Chip key={c} tam="chico" texto={etiquetaClaseAviso(c, idioma)} activo={p.clasesApagadas.includes(c)} onPress={() => guardar({ clasesApagadas: alternar(p.clasesApagadas, c) })} />
              ))}
            </View>
            {p.temasSilenciados.length ? <Fila titulo={tr('Volver a escuchar todos los temas', 'Unmute all topics')} icono="campana" onPress={() => guardar({ temasSilenciados: [] })} /> : null}
          </Grupo>

          <Grupo titulo={tr('Posponer', 'Snooze')} pie={p.pospuestoHasta ? tr(`Pospuestos hasta ${new Date(p.pospuestoHasta).toLocaleString('es-HN')}.`, `Snoozed until ${new Date(p.pospuestoHasta).toLocaleString('en-US')}.`) : undefined}>
            <View style={s.botones}>
              <Boton tam="chico" variante="secundario" titulo={tr('Hasta mañana', 'Until tomorrow')} deshabilitado={ocupado} onPress={() => void cambiar('/api/avisos/posponer', cuerpoPosponer(1, p))} />
              <Boton tam="chico" variante="secundario" titulo={tr('Tres días', 'Three days')} deshabilitado={ocupado} onPress={() => void cambiar('/api/avisos/posponer', cuerpoPosponer(3, p))} />
              {p.pospuestoHasta ? <Boton tam="chico" variante="fantasma" titulo={tr('Quitar', 'Clear')} deshabilitado={ocupado} onPress={() => void cambiar('/api/avisos/posponer', { quitar: true })} /> : null}
            </View>
          </Grupo>
        </View>
      )}
    </Hoja>
  );
}

const s = StyleSheet.create({
  col: { gap: MEDIDA.espacio.l },
  segmento: { paddingHorizontal: MEDIDA.espacio.m, paddingVertical: MEDIDA.espacio.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: MEDIDA.espacio.s, padding: MEDIDA.espacio.m },
  botones: { flexDirection: 'row', flexWrap: 'wrap', gap: MEDIDA.espacio.s, padding: MEDIDA.espacio.m },
});
