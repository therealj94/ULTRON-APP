/**
 * «MI CÍRCULO»: la gente cercana de la persona (su esposa, sus hijos, sus socios) para que AURA sepa a quién
 * se refiere («recuérdale a mi esposa…») y por dónde escribirle (server/cerebro-continuo.ts, lib/circulo.ts;
 * la lógica en compa/cerebro.ts). José (2-oct): «conecta con mi familia».
 *
 *   · Cada persona: nombre, relación y WhatsApp; tocarla la edita (o la quita).
 *   · Cada mensaje (recordatorios incluidos) queda como borrador hasta tu «sí» a ESE texto. El antiguo interruptor
 *     «recordatorios sin preguntarme» se quitó (permisos exactos, revisión 4-oct): ya no autorizaba nada en el servidor.
 *   · Llamar a otra persona se hace desde el teléfono: AURA no puede llamarle a nadie desde el servidor.
 *
 * Una hoja de toda la app (app/hojas.ts → app/HojasCerebro.tsx). Agregar y editar van dentro de la misma
 * hoja (una hoja encima de otra no se arrastra bien).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { api } from '../lib/api';
import { idiomaActual, tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Campo, Chip, Hoja, Icono, Texto, vibrar } from '../ui';
import {
  RELACIONES,
  borradorDe,
  circuloDe,
  cuerpoPersona,
  nombreRelacion,
  numeroLegible,
  type BorradorPersona,
  type PersonaCirculo,
  type PuedeCirculo,
} from '../compa/cerebro';

type Props = { visible: boolean; onCerrar: () => void };

/** La lista, o el formulario de una persona (nueva, o la que se edita por su id). */
type Modo = { tipo: 'lista' } | { tipo: 'editar'; id: string | null };

export function HojaCirculo({ visible, onCerrar }: Props) {
  const tema = useTema();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [personas, setPersonas] = useState<PersonaCirculo[] | null>(null);
  const [puede, setPuede] = useState<PuedeCirculo | null>(null);
  const [error, setError] = useState('');
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [borrador, setBorrador] = useState<BorradorPersona>(borradorDe());
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState('');
  const [quitando, setQuitando] = useState(false);

  const leer = useCallback(async () => {
    try {
      const r = circuloDe(await api('/api/circulo', { method: 'GET' }, 15_000));
      setPersonas(r.personas);
      setPuede(r.puede);
      setError('');
    } catch (e: any) {
      setPersonas((p) => p ?? []);
      setError(e?.message || tr('No pude leer tu círculo.', 'I couldn’t load your circle.'));
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setModo({ tipo: 'lista' });
      setQuitando(false);
      return;
    }
    void leer();
  }, [visible, leer]);

  const editar = (p: PersonaCirculo | null) => {
    setBorrador(borradorDe(p));
    setErrorForm('');
    setQuitando(false);
    setModo({ tipo: 'editar', id: p?.id || null });
  };

  const guardar = async () => {
    if (modo.tipo !== 'editar') return;
    const v = cuerpoPersona(borrador, modo.id || undefined, idioma);
    if (!v.ok) {
      vibrar('aviso');
      return setErrorForm((v as { error: string }).error);
    }
    setErrorForm('');
    setGuardando(true);
    try {
      await api('/api/circulo', { method: 'POST', body: JSON.stringify(v.cuerpo) }, 15_000);
      vibrar('exito');
      setModo({ tipo: 'lista' });
      void leer();
    } catch (e: any) {
      vibrar('aviso');
      setErrorForm(e?.message || tr('No pude guardarlo.', 'I couldn’t save it.'));
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async () => {
    if (modo.tipo !== 'editar' || !modo.id) return;
    const id = modo.id;
    setGuardando(true);
    try {
      await api(`/api/circulo/${encodeURIComponent(id)}`, { method: 'DELETE' }, 15_000);
      vibrar('medio');
      setPersonas((l) => (l || []).filter((p) => p.id !== id));
      setModo({ tipo: 'lista' });
    } catch (e: any) {
      vibrar('aviso');
      setErrorForm(e?.message || tr('No pude quitarla.', 'I couldn’t remove them.'));
    } finally {
      setGuardando(false);
      setQuitando(false);
    }
  };

  const editando = modo.tipo === 'editar' ? (modo.id ? personas?.find((p) => p.id === modo.id) || null : null) : null;
  const nueva = modo.tipo === 'editar' && !modo.id;

  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      titulo={modo.tipo === 'editar' ? (nueva ? tr('Agregar a alguien', 'Add someone') : editando?.nombre || tr('Editar', 'Edit')) : tr('Mi círculo', 'My circle')}
      subtitulo={
        modo.tipo === 'lista'
          ? tr('Tu gente cercana. Así AURA sabe a quién te refieres («recuérdale a mi esposa…») y por dónde escribirle.', 'Your close people. So AURA knows who you mean (“remind my wife…”) and how to reach them.')
          : undefined
      }
    >
      {modo.tipo === 'editar' ? (
        <View style={{ gap: MEDIDA.espacio.l }}>
          <Campo
            etiqueta={tr('Nombre', 'Name')}
            value={borrador.nombre}
            onChangeText={(t) => setBorrador((b) => ({ ...b, nombre: t.slice(0, 60) }))}
            placeholder={tr('Ej.: Ana María', 'E.g.: Ana María')}
            autoCapitalize="words"
            autoFocus={nueva}
            maxLength={60}
          />
          <View style={{ gap: MEDIDA.espacio.s }}>
            <Texto v="chicaFuerte" color="texto2">
              {tr('¿Quién es para ti?', 'Who are they to you?')}
            </Texto>
            <View style={s.chips}>
              {RELACIONES.map((r) => (
                <Chip key={r} texto={nombreRelacion(r, idioma)} tam="chico" activo={borrador.relacion === r} onPress={() => setBorrador((b) => ({ ...b, relacion: r }))} />
              ))}
            </View>
          </View>
          <Campo
            etiqueta={tr('WhatsApp (opcional)', 'WhatsApp (optional)')}
            value={borrador.whatsapp}
            onChangeText={(t) => setBorrador((b) => ({ ...b, whatsapp: t.slice(0, 24) }))}
            placeholder="+504 9999-0000"
            keyboardType="phone-pad"
            ayuda={tr('Con 8 dígitos se entiende que es de Honduras.', '8 digits is taken as a Honduras number.')}
            maxLength={24}
          />
          {!!errorForm && (
            <Texto v="chica" color="aviso">
              {errorForm}
            </Texto>
          )}
          <Boton titulo={tr('Guardar', 'Save')} icono="check" cargando={guardando && !quitando} deshabilitado={!borrador.nombre.trim()} onPress={() => void guardar()} />
          {!nueva && !quitando ? <Boton titulo={tr('Quitar de mi círculo', 'Remove from my circle')} icono="basura" variante="fantasma" onPress={() => setQuitando(true)} /> : null}
          {quitando ? (
            <View style={{ gap: MEDIDA.espacio.s }}>
              <Texto v="chica" color="texto2">
                {tr(`¿Quitar a ${editando?.nombre || 'esta persona'}? AURA deja de tenerla en tu círculo.`, `Remove ${editando?.nombre || 'this person'}? AURA won’t keep them in your circle.`)}
              </Texto>
              <View style={s.botones}>
                <Boton titulo={tr('Sí, quitar', 'Yes, remove')} variante="peligro" tam="chico" cargando={guardando} style={{ flex: 1 }} onPress={() => void quitar()} />
                <Boton titulo={tr('No', 'No')} variante="secundario" tam="chico" style={{ flex: 1 }} onPress={() => setQuitando(false)} />
              </View>
            </View>
          ) : null}
          <Boton titulo={tr('Volver', 'Back')} variante="secundario" onPress={() => setModo({ tipo: 'lista' })} />
        </View>
      ) : (
        <View style={{ gap: MEDIDA.espacio.l }}>
          {personas === null ? (
            <ActivityIndicator color={tema.acento} style={{ paddingVertical: MEDIDA.espacio.xl }} />
          ) : personas.length === 0 ? (
            <Texto v="chica" color="texto2">
              {tr('Todavía no hay nadie. Agrega a tu gente aquí, o cuéntale a AURA: «mi esposa se llama Ana y su WhatsApp es…».', 'No one yet. Add your people here, or tell AURA: “my wife is Ana and her WhatsApp is…”.')}
            </Texto>
          ) : (
            personas.map((p) => (
              <View key={p.id} style={[s.tarjeta, { borderColor: tema.borde, backgroundColor: tema.superficie }]}>
                <Pressable onPress={() => editar(p)} accessibilityRole="button" accessibilityLabel={tr(`Editar a ${p.nombre}`, `Edit ${p.nombre}`)} style={s.persona}>
                  <View style={[s.inicial, { backgroundColor: tema.acentoFondo }]}>
                    <Texto v="cuerpoFuerte" color="acentoTexto">
                      {(p.nombre.trim()[0] || '?').toUpperCase()}
                    </Texto>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Texto v="cuerpoFuerte">{p.nombre}</Texto>
                    <Texto v="chica" color="texto2">
                      {nombreRelacion(p.relacion, idioma)}
                      {p.canales.whatsapp ? ` · WhatsApp ${numeroLegible(p.canales.whatsapp)}` : p.canales.telefono ? ` · ${numeroLegible(p.canales.telefono)}` : ''}
                    </Texto>
                  </View>
                  <Icono nombre="lapiz" tam={18} color={tema.texto3} />
                </Pressable>
              </View>
            ))
          )}
          {!!error && (
            <Texto v="chica" color="aviso">
              {error}
            </Texto>
          )}
          <Boton titulo={tr('Agregar a alguien', 'Add someone')} icono="mas" variante="secundario" onPress={() => editar(null)} />
          <Texto v="mini" color="texto3">
            {tr(
              'Los mensajes a tu gente, recordatorios incluidos, quedan como borrador hasta tu «sí» a ese texto.',
              'Messages to your people, reminders included, stay as drafts until you say “yes” to that exact text.'
            )}
            {puede && !puede.whatsapp ? tr(' Tu WhatsApp no está conectado en el servidor, así que por ahora no se le pueden mandar.', ' Your WhatsApp isn’t connected on the server, so they can’t be sent for now.') : ''}
          </Texto>
          <Texto v="mini" color="texto3">
            {tr('Para llamar a alguien de tu círculo, llámale desde tu teléfono: AURA no puede hacer llamadas a otras personas.', 'To call someone in your circle, call from your phone: AURA can’t place calls to other people.')}
          </Texto>
        </View>
      )}
    </Hoja>
  );
}

const s = StyleSheet.create({
  tarjeta: { borderWidth: 1, borderRadius: MEDIDA.radio.l, overflow: 'hidden' },
  persona: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: MEDIDA.espacio.m },
  inicial: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  botones: { flexDirection: 'row', gap: MEDIDA.espacio.s },
});
