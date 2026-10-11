/**
 * La lista de permisos (la primera vez y Ajustes): cada permiso de `PERMISOS_ANDROID` en su fila,
 * con su ícono, para qué lo usa AURA y el BOTÓN CHECK ✔ que lo pide con el diálogo nativo y se
 * completa al concederlo. Si quedó bloqueado («No volver a preguntar»), la fila ofrece abrir los
 * Ajustes del sistema; al volver a la app se revisa todo otra vez. Arriba, «Permitir todo».
 * Al final, «Alarmas y recordatorios» (Android 12+): no tiene diálogo, su botón abre los Ajustes.
 *
 * La palomita va con `sobreExito` (UX-02, 11-oct): de noche la salvia es clara y la marca blanca daba 2,65:1; ahora es
 * la tinta del tema (≥ 3:1 en los dos temas, prueba en pruebas/mesa). TalkBack lee el nombre del permiso y su estado
 * («Micrófono: permitido», casilla marcada).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Aparecer, Boton, BotonCheck, Icono, Tarjeta, Texto, vibrar } from '../ui';
import {
  INFO_PERMISOS as TODOS_PERMISOS,
  abrirAjustesAlarma,
  abrirAjustesSistema,
  estadoAlarmaExacta,
  estadosPermisos,
  listo,
  pedirPermiso,
  pedirTodos,
  type EstadoAlarma,
  type EstadoPermiso,
  type IdPermiso,
} from './permisos';

/** `solo`: muestra solo esos permisos (la primera vez pide lo que hace falta para el objetivo, AUR11). */
export function ListaPermisos({ conBotonTodo = true, solo }: { conBotonTodo?: boolean; solo?: readonly IdPermiso[] }) {
  const tema = useTema();
  const INFO_PERMISOS = solo ? TODOS_PERMISOS.filter((p) => solo.includes(p.id)) : TODOS_PERMISOS;
  const [estados, setEstados] = useState<Partial<Record<IdPermiso, EstadoPermiso>>>({});
  const [pidiendo, setPidiendo] = useState<IdPermiso | 'todos' | null>(null);
  const [alarma, setAlarma] = useState<EstadoAlarma | null>(null);

  const revisar = useCallback(async () => {
    setEstados(await estadosPermisos());
    setAlarma(await estadoAlarmaExacta());
  }, []);

  useEffect(() => {
    void revisar();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void revisar();
    });
    return () => sub.remove();
  }, [revisar]);

  const todos = INFO_PERMISOS.every((p) => estados[p.id] && listo(estados[p.id] as EstadoPermiso));

  const uno = async (id: IdPermiso) => {
    const e = estados[id];
    if (e === 'bloqueado') return abrirAjustesSistema();
    if (e && listo(e)) return;
    setPidiendo(id);
    const r = await pedirPermiso(id);
    setEstados((x) => ({ ...x, [id]: r }));
    if (r === 'bloqueado') vibrar('aviso');
    setPidiendo(null);
  };

  const permitirTodo = async () => {
    setPidiendo('todos');
    const r = await pedirTodos();
    setEstados(r);
    setPidiendo(null);
  };

  return (
    <View style={{ gap: MEDIDA.espacio.m }}>
      {conBotonTodo && (
        <Boton
          titulo={todos ? tr('Todo listo', 'All set') : tr('Permitir todo', 'Allow all')}
          icono={todos ? 'check' : 'escudo'}
          onPress={() => void permitirTodo()}
          cargando={pidiendo === 'todos'}
          deshabilitado={todos}
        />
      )}
      {INFO_PERMISOS.map((p, i) => {
        const e = estados[p.id];
        const ok = !!e && listo(e);
        return (
          <Aparecer key={p.id} retraso={80 + i * 70}>
            <Tarjeta relleno={MEDIDA.espacio.m} style={ok ? { borderColor: tema.exito } : undefined}>
              <View style={s.fila}>
                <View style={[s.icono, { backgroundColor: ok ? tema.exitoFondo : tema.acentoFondo }]}>
                  <Icono nombre={p.icono} tam={20} color={ok ? tema.exito : tema.acentoTexto} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Texto v="cuerpoFuerte">{p.titulo()}</Texto>
                  <Texto v="chica" color="texto2">
                    {e === 'noAplica' ? tr('Tu Android no lo pide: ya está incluido.', 'Your Android doesn’t ask for it: already included.') : p.porque()}
                  </Texto>
                  {e === 'bloqueado' && (
                    <Boton titulo={tr('Abrir ajustes del teléfono', 'Open phone settings')} icono="ajustes" variante="fantasma" tam="chico" onPress={abrirAjustesSistema} style={{ alignSelf: 'flex-start', marginLeft: -10 }} />
                  )}
                </View>
                <BotonCheck
                  hecho={ok}
                  onPress={() => void uno(p.id)}
                  cargando={pidiendo === p.id}
                  etiqueta={`${p.titulo()}: ${ok ? tr('permitido', 'allowed') : e === 'bloqueado' ? tr('bloqueado, abrir ajustes', 'blocked, open settings') : tr('permitir', 'allow')}`}
                  color={tema.exito}
                  colorMarca={tema.sobreExito}
                />
              </View>
            </Tarjeta>
          </Aparecer>
        );
      })}
      {alarma && alarma !== 'noAplica' && (
        <Aparecer retraso={80 + INFO_PERMISOS.length * 70}>
          <Tarjeta relleno={MEDIDA.espacio.m} style={alarma === 'concedido' ? { borderColor: tema.exito } : undefined}>
            <View style={s.fila}>
              <View style={[s.icono, { backgroundColor: alarma === 'concedido' ? tema.exitoFondo : tema.acentoFondo }]}>
                <Icono nombre="reloj" tam={20} color={alarma === 'concedido' ? tema.exito : tema.acentoTexto} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Texto v="cuerpoFuerte">{tr('Alarmas y recordatorios', 'Alarms & reminders')}</Texto>
                <Texto v="chica" color="texto2">
                  {alarma === 'concedido'
                    ? tr('Tus recordatorios suenan a la hora exacta.', 'Your reminders ring right on time.')
                    : tr('Para que tus recordatorios suenen a la hora exacta. Sin esto pueden llegar unos minutos tarde.', 'So your reminders ring right on time. Without it they may arrive a few minutes late.')}
                </Texto>
              </View>
              <BotonCheck
                hecho={alarma === 'concedido'}
                onPress={() => {
                  if (alarma !== 'concedido') void abrirAjustesAlarma();
                }}
                etiqueta={`${tr('Alarmas y recordatorios', 'Alarms & reminders')}: ${alarma === 'concedido' ? tr('permitido', 'allowed') : tr('permitir, abrir ajustes', 'allow, open settings')}`}
                color={tema.exito}
                colorMarca={tema.sobreExito}
              />
            </View>
          </Tarjeta>
        </Aparecer>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icono: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
