/**
 * LA HOJA «POR CONFIRMAR» DE LAS CARAS Y LAS VOCES (tanda F1; lo puro en caras/porConfirmar.ts).
 *
 * Vive UNA vez en la mesa (screens/DeskScreen.tsx, una línea) y hace tres cosas:
 *   · «Más → Caras» / «Más → Voces» (useCaras / useVoces abrirOpciones → abrirHojaBio): la lista de quién conoce, con la
 *     insignia «Por confirmar» en quien espera la confirmación de la dueña (un posible menor), y los mandos de siempre
 *     («Olvidar todas», «Desactivar»).
 *   · Tocar a alguien por confirmar abre su hoja de confirmar: a quién se guardó, quién la presentó, cuándo y «Es menor de
 *     edad». «Sí, guardar» → POST /api/caras|voces/:id/confirmar; «Borrar» → el DELETE de siempre. Hasta entonces el
 *     servidor no la usa para reconocer ni la nombra (lib/biometria-consentimiento.ts reconocible).
 *   · Al abrir la mesa, si hay un posible menor por confirmar al que todavía no se le avisó a esta cuenta, un aviso suave,
 *     UNA vez (lo avisado queda en el teléfono): «Revisar» lleva a su hoja; «Ahora no» lo deja en «Más».
 *
 * Probada montada en node: pruebas/consentimiento.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { idiomaActual } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Hoja, Texto, vibrar } from '../ui';
import { confirmarCara, listarCaras, olvidarCara } from './api';
import { confirmarVoz, listarVoces, olvidarVoz } from '../voces/api';
import {
  avisarCambioBio,
  CLAVE_AVISADOS,
  conAvisados,
  detalleConfirmar,
  escucharHojaBio,
  filasBio,
  insignia,
  porAvisar,
  subtituloFila,
  textoAviso,
  type Avisados,
  type FilaBio,
  type PedidoHoja,
  type TipoBio,
} from './porConfirmar';

type Vista = { modo: 'lista'; pedido: PedidoHoja } | { modo: 'confirmar'; fila: FilaBio; pedido?: PedidoHoja; cola?: FilaBio[] } | { modo: 'aviso'; filas: FilaBio[] };

async function leerAvisados(): Promise<Avisados> {
  try {
    const s = await AsyncStorage.getItem(CLAVE_AVISADOS);
    const v = s ? JSON.parse(s) : {};
    return v && typeof v === 'object' ? (v as Avisados) : {};
  } catch {
    return {};
  }
}

async function guardarAvisados(a: Avisados): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_AVISADOS, JSON.stringify(a));
  } catch {
    /* sin disco: a lo sumo se avisa otra vez */
  }
}

async function leerFilas(tipo: TipoBio): Promise<FilaBio[]> {
  return filasBio(tipo, tipo === 'cara' ? await listarCaras() : await listarVoces());
}

const mismo = (a: FilaBio, b: FilaBio) => a.tipo === b.tipo && a.id === b.id;

export function ConsentimientoBiometria({ correo }: { correo: string }) {
  const tema = useTema();
  const en = idiomaActual() === 'en';
  const [vista, setVista] = useState<Vista | null>(null);
  const [filas, setFilas] = useState<FilaBio[] | null>(null);
  const [ocupado, setOcupado] = useState<'si' | 'borrar' | null>(null);
  const [error, setError] = useState('');
  const montada = useRef(true);
  useEffect(
    () => () => {
      montada.current = false;
    },
    []
  );

  // «Más → Caras / Voces»: la lista con sus insignias.
  useEffect(
    () =>
      escucharHojaBio((pedido) => {
        setError('');
        setFilas(null);
        setVista({ modo: 'lista', pedido });
        void leerFilas(pedido.tipo).then(
          (fs) => {
            if (!montada.current) return;
            setFilas(fs);
            const directa = pedido.id ? fs.find((f) => f.id === pedido.id && f.porConfirmar) : undefined;
            if (directa) setVista({ modo: 'confirmar', fila: directa, pedido });
          },
          (e: unknown) => {
            if (!montada.current) return;
            setFilas([]);
            setError(String((e as Error)?.message || (en ? 'I couldn’t load them.' : 'No pude leerlas.')));
          }
        );
      }),
    [en]
  );

  // Al abrir la mesa: el aviso suave, una vez por persona y cuenta.
  useEffect(() => {
    if (!correo) return;
    let cancelado = false;
    void (async () => {
      const [caras, voces] = await Promise.all([leerFilas('cara').catch(() => [] as FilaBio[]), leerFilas('voz').catch(() => [] as FilaBio[])]);
      const avisados = await leerAvisados();
      const toca = porAvisar([...caras, ...voces], avisados, correo);
      if (cancelado || !toca.length) return;
      await guardarAvisados(conAvisados(avisados, correo, toca));
      if (!cancelado && montada.current) setVista((v) => v ?? { modo: 'aviso', filas: toca });
    })();
    return () => {
      cancelado = true;
    };
  }, [correo]);

  const cerrar = useCallback(() => {
    if (ocupado) return;
    setVista(null);
    setError('');
  }, [ocupado]);

  /** «Sí, guardar» o «Borrar»: al servidor; la lista y useCaras / useVoces al día. */
  const decidir = async (fila: FilaBio, que: 'si' | 'borrar', v: Extract<Vista, { modo: 'confirmar' }>) => {
    setOcupado(que);
    setError('');
    try {
      if (que === 'si') await (fila.tipo === 'cara' ? confirmarCara(fila.id) : confirmarVoz(fila.id));
      else await (fila.tipo === 'cara' ? olvidarCara(fila.id) : olvidarVoz(fila.id));
      vibrar(que === 'si' ? 'exito' : 'medio');
      setFilas((fs) => (fs ? (que === 'si' ? fs.map((f) => (mismo(f, fila) ? { ...f, porConfirmar: false } : f)) : fs.filter((f) => !mismo(f, fila))) : fs));
      avisarCambioBio(fila.tipo);
      const siguiente = (v.cola || []).filter((f) => !mismo(f, fila));
      if (siguiente.length) setVista({ modo: 'confirmar', fila: siguiente[0], cola: siguiente });
      else if (v.pedido) setVista({ modo: 'lista', pedido: v.pedido });
      else setVista(null);
    } catch (e) {
      vibrar('aviso');
      setError(String((e as Error)?.message || (en ? 'It couldn’t be saved.' : 'No se pudo guardar.')));
    } finally {
      if (montada.current) setOcupado(null);
    }
  };

  if (!vista) return <Hoja visible={false} onCerrar={cerrar} children={null} />;

  if (vista.modo === 'aviso') {
    const t = textoAviso(vista.filas, en);
    return (
      <Hoja visible onCerrar={cerrar} titulo={t.titulo} subtitulo={t.texto}>
        <View style={s.botones}>
          <Boton titulo={en ? 'Review' : 'Revisar'} onPress={() => setVista({ modo: 'confirmar', fila: vista.filas[0], cola: vista.filas })} />
          <Boton titulo={en ? 'Not now' : 'Ahora no'} variante="fantasma" onPress={cerrar} />
        </View>
      </Hoja>
    );
  }

  if (vista.modo === 'confirmar') {
    const d = detalleConfirmar(vista.fila, en);
    return (
      <Hoja visible onCerrar={cerrar} titulo={d.titulo}>
        <View style={{ gap: MEDIDA.espacio.s }}>
          {d.lineas.map((l) => (
            <Texto key={l} v={/menor|minor/i.test(l) ? 'cuerpoFuerte' : 'cuerpo'} color={/menor|minor/i.test(l) ? 'acentoTexto' : 'texto'}>
              {l}
            </Texto>
          ))}
          <Texto v="chica" color="texto2">
            {d.nota}
          </Texto>
          {!!error && (
            <Texto v="chica" color="aviso">
              {error}
            </Texto>
          )}
          <View style={s.botones}>
            <Boton titulo={en ? 'Yes, save' : 'Sí, guardar'} cargando={ocupado === 'si'} deshabilitado={!!ocupado} onPress={() => void decidir(vista.fila, 'si', vista)} />
            <Boton titulo={en ? 'Delete' : 'Borrar'} variante="peligro" cargando={ocupado === 'borrar'} deshabilitado={!!ocupado} onPress={() => void decidir(vista.fila, 'borrar', vista)} />
            {vista.pedido ? <Boton titulo={en ? 'Back' : 'Volver'} variante="fantasma" deshabilitado={!!ocupado} onPress={() => setVista({ modo: 'lista', pedido: vista.pedido! })} /> : null}
          </View>
        </View>
      </Hoja>
    );
  }

  const { pedido } = vista;
  const vacio = pedido.tipo === 'cara' ? (en ? 'I don’t know any face yet.' : 'Todavía no conozco ninguna cara.') : en ? 'I don’t know any voice yet.' : 'Todavía no conozco ninguna voz.';
  return (
    <Hoja visible onCerrar={cerrar} titulo={pedido.titulo} subtitulo={pedido.texto}>
      <View style={{ gap: MEDIDA.espacio.s }}>
        {filas === null ? (
          <Texto v="chica" color="texto2">
            {en ? 'Loading…' : 'Cargando…'}
          </Texto>
        ) : filas.length === 0 && !error ? (
          <Texto v="chica" color="texto2">
            {vacio}
          </Texto>
        ) : (
          filas.map((f) => {
            const marca = insignia(f, en);
            const sub = subtituloFila(f, en);
            return (
              <Pressable
                key={`${f.tipo}:${f.id}`}
                onPress={f.porConfirmar ? () => setVista({ modo: 'confirmar', fila: f, pedido }) : undefined}
                disabled={!f.porConfirmar}
                accessibilityRole={f.porConfirmar ? 'button' : 'text'}
                accessibilityLabel={[f.nombre, sub, marca].filter(Boolean).join(', ')}
                style={[s.fila, { borderColor: f.porConfirmar ? tema.acento : tema.borde, backgroundColor: tema.superficie }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Texto v="cuerpoFuerte">{f.nombre}</Texto>
                  {!!sub && (
                    <Texto v="mini" color="texto2">
                      {sub}
                    </Texto>
                  )}
                </View>
                {!!marca && (
                  <View style={[s.insignia, { borderColor: tema.acento, backgroundColor: tema.acentoFondo }]}>
                    <Texto v="chicaFuerte" color="acentoTexto">
                      {marca}
                    </Texto>
                  </View>
                )}
              </Pressable>
            );
          })
        )}
        {!!error && (
          <Texto v="chica" color="aviso">
            {error}
          </Texto>
        )}
        {pedido.mandos?.length ? (
          <View style={s.botones}>
            {pedido.mandos.map((m) => (
              <Boton
                key={m.titulo}
                titulo={m.titulo}
                variante={m.peligro ? 'peligro' : 'secundario'}
                tam="chico"
                onPress={() => {
                  setVista(null);
                  m.alTocar();
                }}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Hoja>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.m },
  insignia: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  botones: { gap: MEDIDA.espacio.s, marginTop: MEDIDA.espacio.m },
});
