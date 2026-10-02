/**
 * (f) La encuesta cálida: una pregunta por tarjeta (a qué te dedicas, dónde vives, familia, gustos,
 * comida, música y qué quieres que AURA haga por ti). Tres formas de contestar, como pidió José (2-oct):
 *   · opciones de un toque (chips; se pueden elegir varias);
 *   · «Otro (escribir)»: el campo para lo que no esté en las opciones;
 *   · «Responder hablando»: el dictado del teléfono (bienvenida/ResponderHablando.tsx); lo dicho marca las
 *     opciones que nombró y lo demás cae en el campo (flujo.ts chipsDeDictado).
 * Todo junto queda como una frase en el perfil («Baleadas, Pupusas. Y la sopa de mi abuela»). «Saltar»
 * (arriba) la deja en blanco. La usan la primera vez y las preguntas que se retoman en la mesa.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { de, tr, useIdioma } from '../../i18n';
import type { Encuesta } from '../../nucleo/contrato';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Campo, Chip, Icono, Texto } from '../../ui';
import { ResponderHablando } from '../../bienvenida/ResponderHablando';
import { PREGUNTAS, armarRespuesta, chipsDeDictado, separarRespuesta, type Pregunta } from '../flujo';
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
  // Lo dicho se suma a lo elegido (no lo borra): «y también la pizza» agrega la pizza.
  const alDictar = (dicho: string) => {
    const r = chipsDeDictado(dicho, pregunta.sugerencias, idioma === 'en' ? 'en' : 'es');
    if (r.chips.length) setChips((cs) => [...cs, ...r.chips.filter((c) => !cs.includes(c))]);
    if (r.texto) setTexto((t) => (t ? `${t} ${r.texto}` : r.texto).slice(0, 200));
  };

  return (
    <View style={{ gap: MEDIDA.espacio.xl }}>
      <Aparecer desde="escala">
        <View style={[s.icono, { backgroundColor: tema.acentoFondo, borderColor: tema.acento }]}>
          <Icono nombre={pregunta.icono} tam={30} color={tema.acentoTexto} />
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
          etiqueta={tr('Otro (escribir)', 'Other (type it)')}
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
      <Aparecer retraso={260}>
        <ResponderHablando onDicho={alDictar} pistas={pregunta.sugerencias.map((x) => de(x))} />
      </Aparecer>
    </View>
  );
}

const s = StyleSheet.create({
  icono: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
