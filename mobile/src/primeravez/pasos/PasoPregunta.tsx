/**
 * (f) La encuesta cálida: una pregunta por tarjeta (dónde vives, comida, música, familia, trabajo,
 * gustos). Chips para responder de un toque —se pueden elegir varios— y un campo para lo que no
 * esté en los chips. Todo junto queda como una frase en el perfil («Baleadas, Pupusas. Y la sopa de
 * mi abuela»). «Saltar» (arriba) la deja en blanco.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { de, tr, useIdioma } from '../../i18n';
import type { Encuesta } from '../../nucleo/contrato';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Campo, Chip, Icono, Texto } from '../../ui';
import { PREGUNTAS, armarRespuesta, separarRespuesta, type Pregunta } from '../flujo';
import type { PropsPaso } from './tipos';

export function PasoPregunta({ pregunta, borrador, cambiar, avanzar }: PropsPaso & { pregunta: Pregunta }) {
  const idioma = useIdioma();
  const tema = useTema();
  const inicial = useMemo(() => separarRespuesta(borrador.encuesta[pregunta.campo], pregunta.sugerencias, idioma), [pregunta.campo]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chips, setChips] = useState<string[]>(inicial.chips);
  const [texto, setTexto] = useState(inicial.texto);

  useEffect(() => {
    const r = armarRespuesta(chips, texto);
    if ((borrador.encuesta[pregunta.campo] || '') === r) return;
    const e: Encuesta = { ...borrador.encuesta };
    if (r) e[pregunta.campo] = r;
    else delete e[pregunta.campo];
    cambiar({ encuesta: e });
    // Solo cuando cambia la respuesta de esta pregunta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chips, texto]);

  const n = PREGUNTAS.findIndex((p) => p.campo === pregunta.campo) + 1;
  const alternar = (c: string) => setChips((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <Aparecer desde="escala">
        <View style={[s.icono, { backgroundColor: tema.acentoFondo, borderColor: tema.acento }]}>
          <Icono nombre={pregunta.icono} tam={30} color={tema.acentoTexto} grosor={1.8} />
        </View>
      </Aparecer>
      <View style={{ gap: 8 }}>
        <Aparecer>
          <Texto v="etiqueta" color="acentoTexto">
            {tr(`Cuéntame de ti · ${n} de ${PREGUNTAS.length}`, `Tell me about you · ${n} of ${PREGUNTAS.length}`)}
          </Texto>
        </Aparecer>
        <Aparecer retraso={40}>
          <Texto v="heroe" accessibilityRole="header">
            {de(pregunta.titulo)}
          </Texto>
        </Aparecer>
        <Aparecer retraso={90}>
          <Texto v="cuerpo" color="texto2">
            {de(pregunta.nota)}
          </Texto>
        </Aparecer>
      </View>
      <Aparecer retraso={150}>
        <View style={s.chips}>
          {pregunta.sugerencias.map((sug) => {
            const t = de(sug);
            return <Chip key={sug.es} texto={t} activo={chips.includes(t)} onPress={() => alternar(t)} />;
          })}
        </View>
      </Aparecer>
      <Aparecer retraso={210}>
        <Campo
          etiqueta={tr('O escríbelo con tus palabras', 'Or put it in your own words')}
          value={texto}
          onChangeText={(t) => setTexto(t.slice(0, 200))}
          placeholder={de(pregunta.ejemplo)}
          autoCapitalize="sentences"
          autoCorrect
          returnKeyType="next"
          onSubmitEditing={avanzar}
          maxLength={200}
        />
      </Aparecer>
    </View>
  );
}

const s = StyleSheet.create({
  icono: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
