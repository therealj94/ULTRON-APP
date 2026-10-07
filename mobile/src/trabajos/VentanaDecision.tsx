/**
 * LA VENTANA DE DECISIÓN DE LA MESA (José, 5-oct: «que me salga el pop up y me pregunte, y sea tocar Sí o No o Editar, y
 * pueda decirlo hablado, pero que aparezca»).
 *
 *   ┌─────────────────────────────────────────┐
 *   │ WhatsApp · 1 de 3                        │
 *   │ ¿Envío este WhatsApp a Ana (+504…)?      │
 *   │ Para  Ana (+50499991111)                 │
 *   │ ┌─────────────────────────────────────┐ │
 *   │ │ Llego a las 5.                       │ │
 *   │ └─────────────────────────────────────┘ │
 *   │ También puedes decirlo: «sí», «no»…     │
 *   │ [          Sí, mándalo               ]  │
 *   │ [          Editar                    ]  │
 *   │ [          No                        ]  │
 *   │               Luego                      │
 *   └─────────────────────────────────────────┘
 *
 * Los botones van UNO DEBAJO DEL OTRO y a todo el ancho, la acción de la decisión primero (auditoría visual del
 * 7-oct, C2): tres en fila partían «Sí, mándalo» en «Sí, mánda…», justo el botón que envía en tu nombre. Así ningún
 * texto se corta, en vertical ni acostado, y cada botón mide 54 dp (≥ 48). Acostado y con poco alto, la hoja va en
 * dos columnas: lo que se va a enviar a la izquierda y los botones apilados a la derecha (si no, los botones se
 * comían todo el alto y el mensaje no se veía).
 *
 * Es la hoja inferior de la app (ui/Hoja: encima de todo, con el teclado bien puesto y «atrás»). Cerrarla es «Luego».
 * «Sí» es la opción con efecto: no está preseleccionada, no tiene el estilo de principal y no se arma hasta ARMADO_MS
 * después de aparecer la decisión (lib/trabajos.ts). La lógica, en lib/decisionesMesa.ts y useVentanaDecision.ts.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Hoja, Texto } from '../ui';
import { ARMADO_MS } from '../lib/trabajos';
import { MAX_EDITAR } from '../lib/decisionesMesa';
import type { VentanaDecisionEstado } from './useVentanaDecision';

type Props = { v: VentanaDecisionEstado; nombreAvatar: string };

export function VentanaDecision({ v, nombreAvatar }: Props) {
  const tema = useTema();
  const { width, height } = useWindowDimensions();
  // Acostado en un teléfono (poco alto): el mensaje y los botones lado a lado.
  const dosColumnas = width > height && height < 560;
  const d = v.datos;
  // La opción con efecto se arma ARMADO_MS después de que aparece ESTA decisión (no se toca sin querer).
  const [armada, setArmada] = useState(false);
  const clave = v.item?.clave ?? '';
  useEffect(() => {
    setArmada(false);
    if (!clave) return;
    const r = setTimeout(() => setArmada(true), Math.max(0, v.armadaDesde + ARMADO_MS + 30 - Date.now()));
    return () => clearTimeout(r);
  }, [clave, v.armadaDesde]);

  if (!v.item || !d) return <Hoja visible={false} onCerrar={() => undefined}>{null}</Hoja>;
  const editando = !!v.edicion && v.edicion.clave === clave;
  const titulo = [d.etiqueta, v.posicion].filter(Boolean).join(' · ');

  const pie = editando ? (
    <View style={s.botones}>
      <Boton
        titulo={tr('Guardar y revisar', 'Save and review')}
        variante="secundario"
        style={s.boton}
        cargando={v.ocupado === 'guardar'}
        deshabilitado={!v.puedeGuardar || !!v.ocupado}
        etiqueta={tr('Guardar el texto nuevo. No se envía: te lo vuelvo a mostrar para tu sí.', 'Save the new text. Nothing is sent: I will show it again for your yes.')}
        onPress={() => void v.guardar()}
      />
      <Boton titulo={tr('Cancelar', 'Cancel')} variante="secundario" style={s.boton} deshabilitado={!!v.ocupado} onPress={() => v.setEdicion(null)} />
    </View>
  ) : (
    <View style={{ gap: MEDIDA.espacio.s }}>
      <View style={s.botones}>
        {/* La acción de la decisión (la que tiene efecto) primero; las demás debajo, en su orden. */}
        {[...v.botones.filter((b) => b.conEfecto), ...v.botones.filter((b) => !b.conEfecto)].map((b) => (
          <Boton
            key={b.id}
            titulo={b.etiqueta}
            // Ninguno es «principal»: el Sí (con efecto) en contorno, igual de grande que los demás.
            variante={b.conEfecto ? 'contorno' : 'secundario'}
            style={s.boton}
            cargando={v.ocupado === b.id}
            deshabilitado={!!v.ocupado || (b.conEfecto && !armada)}
            etiqueta={b.efecto ? `${b.etiqueta}. ${b.efecto}` : b.etiqueta}
            onPress={() => void v.responder(b)}
          />
        ))}
      </View>
      {v.conLuego ? <Boton titulo={tr('Luego', 'Later')} variante="fantasma" style={s.luego} deshabilitado={!!v.ocupado} etiqueta={tr('Luego: no hace nada; te lo vuelvo a preguntar en unos minutos.', 'Later: does nothing; I will ask again in a few minutes.')} onPress={v.despues} /> : null}
    </View>
  );

  const cuerpo = (
      <View style={s.cuerpo} accessibilityLiveRegion="polite">
        {d.para ? <Fila k={tr('Para', 'To')} v={d.para} /> : null}
        {d.desde ? <Fila k={tr('Desde', 'From')} v={d.desde} /> : null}
        {editando && v.edicion!.asunto !== undefined ? (
          <View style={s.campo}>
            <Texto v="chicaFuerte" color="texto2">
              {tr('Asunto', 'Subject')}
            </Texto>
            <TextInput
              value={v.edicion!.asunto}
              onChangeText={(asunto) => v.setEdicion((e) => (e ? { ...e, asunto } : e))}
              style={[s.entrada, { color: tema.texto, borderColor: tema.acento, backgroundColor: tema.superficie }]}
              maxLength={200}
              accessibilityLabel={tr('Asunto del correo', 'Email subject')}
            />
          </View>
        ) : d.asunto ? (
          <Fila k={tr('Asunto', 'Subject')} v={d.asunto} />
        ) : null}
        {editando ? (
          <View style={s.campo}>
            <Texto v="chicaFuerte" color="texto2">
              {tr('Texto (lo que se va a enviar)', 'Text (what will be sent)')}
            </Texto>
            <TextInput
              value={v.edicion!.texto}
              onChangeText={(texto) => v.setEdicion((e) => (e ? { ...e, texto } : e))}
              multiline
              autoFocus
              textAlignVertical="top"
              maxLength={MAX_EDITAR}
              style={[s.entrada, s.multilinea, { color: tema.texto, borderColor: tema.acento, backgroundColor: tema.superficie }]}
              accessibilityLabel={tr('Texto del mensaje', 'Message text')}
            />
            <Texto v="mini" color="texto3">
              {tr('No se envía al guardar: te lo vuelvo a mostrar para tu «sí».', 'Saving sends nothing: I will show it again for your «yes».')}
            </Texto>
          </View>
        ) : d.texto ? (
          <View style={[s.texto, { borderColor: tema.borde, backgroundColor: tema.superficie }]}>
            <Texto v="cuerpo" selectable>
              {d.texto}
            </Texto>
          </View>
        ) : null}
        {d.extra.map((x, i) => (
          <Texto key={i} v="chica" selectable>
            {x}
          </Texto>
        ))}
        {d.nota ? (
          <Texto v="chica" color={d.vencida ? 'aviso' : 'texto3'}>
            {d.nota}
          </Texto>
        ) : null}
        {v.aviso ? (
          <Texto v="chica" color="aviso" accessibilityRole="alert">
            {v.aviso}
          </Texto>
        ) : null}
        {!editando && !d.vencida ? (
          <Texto v="mini" color="texto3">
            {tr(`También puedes decírselo a ${nombreAvatar}: «sí», «no» o «cámbialo a…».`, `You can also tell ${nombreAvatar}: «yes», «no» or «change it to…».`)}
          </Texto>
        ) : null}
      </View>
  );

  return (
    <Hoja visible={v.abierta} onCerrar={v.despues} titulo={titulo} subtitulo={d.pregunta} pie={dosColumnas ? undefined : pie}>
      {dosColumnas ? (
        <View style={s.columnas}>
          <View style={s.columnaCuerpo}>{cuerpo}</View>
          <View style={s.columnaBotones}>{pie}</View>
        </View>
      ) : (
        cuerpo
      )}
    </Hoja>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <Texto v="cuerpo" selectable>
      <Texto v="cuerpoFuerte">{k}: </Texto>
      {v}
    </Texto>
  );
}

const s = StyleSheet.create({
  cuerpo: { gap: MEDIDA.espacio.s, paddingBottom: MEDIDA.espacio.s },
  texto: { borderWidth: 1, borderRadius: MEDIDA.radio.m, padding: MEDIDA.espacio.m },
  campo: { gap: 6 },
  entrada: { borderWidth: 1.5, borderRadius: MEDIDA.radio.m, paddingHorizontal: MEDIDA.espacio.m, paddingVertical: 10, fontSize: 16 },
  multilinea: { minHeight: 120, maxHeight: 260 },
  // Uno debajo del otro, a todo el ancho: ninguna etiqueta se corta (C2).
  botones: { flexDirection: 'column', alignItems: 'stretch', gap: MEDIDA.espacio.s },
  // Grandes y del mismo tamaño (un dedo cómodo: 54 de alto en el Boton normal).
  boton: { alignSelf: 'stretch' },
  // «Luego»: 44 de alto + 6 de margen de toque por lado (Boton fantasma) = más de 48.
  luego: { alignSelf: 'center', minWidth: 160 },
  columnas: { flexDirection: 'row', gap: MEDIDA.espacio.m, alignItems: 'flex-start' },
  columnaCuerpo: { flex: 1, minWidth: 0 },
  columnaBotones: { width: '46%' },
});
