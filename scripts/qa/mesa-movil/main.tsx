// Las pantallas del banco de la mesa (una por `?p=`):
//   barra       la mesa de Claudio con la barra de tres botones y los atajos deslizables
//   vivo        igual, con la conversación en vivo abierta (la píldora «En vivo · Terminar»)
//   mas         la hoja «Más» abierta
//   tutorial    el recorrido «Qué puedo hacer» (recorrido/Recorrido, el de la app; `&paso=N` es la escena), con
//               un narrador callado y las fotos de Claudio y ANT-ONIO de anfitriones
// Acostado (ancho > alto), la mesa lleva el riel de la derecha en vez de la barra de abajo (BarraMesa `riel`).
//   transicion  un cuadro de la transición grande → chiquita al entrar al chat (`&h=0..1`: 1 sobre la
//               mesa, 0 en su lugar), con la misma cuenta de la app (avatar3d/presencia.haciaMarco)
//   llamada     LA LLAMADA DEL AVATAR (compa/LlamadaAvatar, el componente real): `&e=` sonando,
//               conectando, en_llamada, silenciado, colgada, perdida; `&a=` aura/claudio/antonio/ojos;
//               `&rec=1` un recordatorio; `&min=1` minimizada sobre los chats
//   compania    un cuadro de la compañera entrando caminando al colgar (`&t=0..1`), con la cuenta de
//               la app (compa/borde: su lugar en el borde de abajo; entra desde el borde más cercano)
// `&escala=1.6` agranda la letra como el «Tamaño de fuente» de Android.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BarraMesa } from '@movil/src/components/BarraMesa';
import { EscribeleMesa } from '@movil/src/components/EscribeleMesa';
import { HojaMas } from '@movil/src/components/HojaMas';
import { AccionesAvatar } from '@movil/src/components/AccionesAvatar';
// El tutorial viejo (src/tutorial/Tutorial) ya no existe: el recorrido de la app es recorrido/Recorrido.
import { Recorrido, type Narrador } from '@movil/src/recorrido/Recorrido';
import { avatarPorId } from '@movil/src/avatares/catalogo';
import { haciaMarco } from '@movil/src/avatar3d/presencia';
import { T } from '@movil/src/tema';
import { LlamadaAvatar } from '@movil/src/compa/LlamadaAvatar';
import { yCarril } from '@movil/src/compa/borde';
import type { AvatarId } from '@movil/src/avatares/catalogo';
import type { EstadoCiclo } from '@movil/src/compa/llamadaCiclo';
import fotoPie from '@movil/assets/avatares/claudio-pie/base.webp';
import fotoRetrato from '@movil/assets/avatares/claudio/base.webp';
import fotoAntonio from '@movil/assets/avatares/antonio/base.webp';

const q = new URLSearchParams(location.search);
const cual = q.get('p') || 'barra';
const claudio = avatarPorId('claudio');
const tema = claudio.tema;
const nombre = 'Claudio';

function Mesa({ conversando = false, oculta = 0 }: { conversando?: boolean; oculta?: number }) {
  const [alto, setAlto] = useState(154);
  const [borrador, setBorrador] = useState('');
  const { width, height } = useWindowDimensions();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: tema.fondo, opacity: 1 - oculta }]}>
      <Image source={{ uri: fotoPie }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={s.hud}>
        <View style={[s.punto, { backgroundColor: conversando ? T.activo : T.activo }]} />
        <Text style={s.hudTexto}>{nombre} · Escuchando</Text>
      </View>
      <View style={[s.burbuja, { bottom: alto + 8 }]}>
        <Text style={s.burbujaTexto}>¡Aquí estoy! Cuéntame.</Text>
      </View>
      <BarraMesa
        encima={<AccionesAvatar acciones={claudio.acciones} tema={tema} onAccion={() => {}} />}
        escribir={<EscribeleMesa nombreAvatar={nombre} tema={tema} valor={borrador} onCambiar={setBorrador} onEnviar={() => setBorrador('')} />}
        riel={width > height}
        onAlto={setAlto}
        tema={tema}
        nombreAvatar={nombre}
        micApagado={false}
        oyendo
        conversando={conversando}
        conectando={false}
        onHablar={() => {}}
        onChat={() => {}}
        onMas={() => {}}
        onTerminar={() => {}}
      />
    </View>
  );
}

/** La pantalla de los chats, como la dibuja la app (lista), para el fondo de la transición. */
function Chats({ corrida }: { corrida: number }) {
  const { width } = useWindowDimensions();
  const filas = ['Mamá', 'Beto', 'Ana', 'Equipo Orden Global', 'Ramiro'];
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1C1D20', transform: [{ translateX: corrida * width }] }]}>
      <View style={s.cabeza}>
        <Text style={s.cabezaTexto}>Chats</Text>
      </View>
      {filas.map((f) => (
        <View key={f} style={s.fila}>
          <View style={s.inicial}>
            <Text style={s.inicialTexto}>{f[0]}</Text>
          </View>
          <View>
            <Text style={s.filaNombre}>{f}</Text>
            <Text style={s.filaUltimo}>Toca para abrir la conversación</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Un cuadro de la transición: la mesa se va (los chats entran deslizándose, como en Android) y la
 * compañera nace del cuerpo grande y se encoge hasta su lugar en el borde de abajo.
 */
function Transicion({ h }: { h: number }) {
  const { width, height } = useWindowDimensions();
  const LADO = 104;
  const caja = { x: width - LADO - 18, y: height - 88 - LADO - 8, lado: LADO };
  const t = haciaMarco(caja, { x: 0, y: 0, ancho: width, alto: height });
  const op = Math.max(0, Math.min(1, (1 - h) * 2.2));
  const lado = LADO * 0.54 * 1.86 * 0.5;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Mesa />
      <Chats corrida={h} />
      <View
        style={{
          position: 'absolute',
          left: caja.x,
          top: caja.y,
          width: LADO,
          height: LADO,
          opacity: op,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ translateX: h * t.dx }, { translateY: h * t.dy }, { scale: 1 + h * (t.escala - 1) }],
        }}
      >
        <View style={{ width: lado * 2, height: lado * 2, borderRadius: lado, overflow: 'hidden', borderWidth: 2.5, borderColor: tema.acento, backgroundColor: '#1F1B18' }}>
          <Image source={{ uri: fotoRetrato }} style={{ width: '100%', height: '100%', transform: [{ scale: 1.5 }, { translateY: 9 }] }} resizeMode="cover" />
        </View>
      </View>
      <View style={s.leyenda}>
        <Text style={s.leyendaTexto}>{`h = ${h.toFixed(2)} · escala ${(1 + h * (t.escala - 1)).toFixed(2)}× · opacidad ${op.toFixed(2)}`}</Text>
      </View>
    </View>
  );
}

/** La llamada del avatar con el componente de la app, en un estado fijo (el reloj quieto a las 3:07). */
function Llamada() {
  const e = (q.get('e') || 'sonando') as EstadoCiclo;
  const a = (q.get('a') || 'claudio') as AvatarId;
  const min = q.get('min') === '1';
  const ahora = 1_000_000;
  const origen = q.get('rec') === '1' ? { tipo: 'recordatorio' as const, texto: 'Llamar a Beto', base: 'aura-rec-x', paso: 'l1' as const, cuando: ahora } : { tipo: 'llamame' as const };
  const conectada = e === 'en_llamada' || e === 'silenciado' || e === 'colgada';
  return (
    <View style={StyleSheet.absoluteFill}>
      {min ? <Chats corrida={0} /> : <Mesa />}
      <LlamadaAvatar
        v={{ estado: e, origen, motivo: e === 'colgada' ? 'persona' : null, conectadaEn: conectada ? ahora - 187_000 : 0, minimizada: min, altavoz: true, avatar: a, idioma: 'es' }}
        onContestar={() => {}}
        onRechazar={() => {}}
        onColgar={() => {}}
        onSilenciar={() => {}}
        onAltavoz={() => {}}
        onMinimizar={() => {}}
        ahora={() => ahora}
      />
    </View>
  );
}

/**
 * Un cuadro de la compañera entrando caminando al colgar: desde el borde más cercano hasta su lugar
 * en el borde de abajo (compa/Companera, entrarCaminando), con el pasito de la figurita.
 */
function Compania({ t }: { t: number }) {
  const { width, height } = useWindowDimensions();
  const LADO = 104;
  const marco = { ancho: width, alto: height, lado: LADO, margen: 4, suelo: 88, techo: 28 };
  const lugarX = Math.max(4, width - LADO - 18);
  const inicio = width; // su lugar está a la derecha: entra por la derecha
  const suave = 1 - (1 - t) * (1 - t); // Easing.out(quad), como en la app
  const x = inicio + (lugarX - inicio) * suave;
  const brinco = t < 1 ? -Math.abs(Math.sin(t * Math.PI * 7)) * 5 : 0;
  const lado = LADO * 0.54 * 1.86 * 0.5;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Chats corrida={0} />
      <View style={{ position: 'absolute', left: x, top: yCarril(marco) + brinco, width: LADO, height: LADO, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: lado * 2, height: lado * 2, borderRadius: lado, overflow: 'hidden', borderWidth: 2.5, borderColor: tema.acento, backgroundColor: '#1F1B18' }}>
          <Image source={{ uri: fotoRetrato }} style={{ width: '100%', height: '100%', transform: [{ scale: 1.5 }, { translateY: 9 }, { scaleX: -1 }] }} resizeMode="cover" />
        </View>
        {t >= 1 ? (
          <View style={{ position: 'absolute', top: -34, backgroundColor: 'rgba(28,29,32,0.94)', borderColor: tema.acento, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ color: '#ECE8E2', fontSize: 13 }}>¡Aquí sigo!</Text>
          </View>
        ) : null}
      </View>
      <View style={s.leyenda}>
        <Text style={s.leyendaTexto}>{`colgó → la compañera entra caminando · t = ${t.toFixed(2)}${t >= 1 ? ' · saluda' : ''}`}</Text>
      </View>
    </View>
  );
}

/** Sin voz en el navegador: cada línea «suena» al instante y termina sola (el recorrido sigue su guion). */
const NARRADOR_CALLADO: Narrador = {
  hablar: async (_t, _q, _e, alSonar) => {
    alSonar();
    return true;
  },
  preparar: () => {},
  callar: () => {},
};

function Pantalla() {
  if (cual === 'llamada') return <Llamada />;
  if (cual === 'compania') return <Compania t={Number(q.get('t') ?? 0.5)} />;
  if (cual === 'vivo') return <Mesa conversando />;
  if (cual === 'mas')
    return (
      <>
        <Mesa />
        <HojaMas visible onCerrar={() => {}} onOpcion={() => {}} nombreAvatar={nombre} conversando={false} estadoCamara="Apagada" camaraEncendida={false} estadoCaras="Apagado" trabajando={false} />
      </>
    );
  if (cual === 'tutorial')
    return (
      <>
        <Mesa />
        <Recorrido
          visible
          nombre="José"
          idioma="es"
          narrador={NARRADOR_CALLADO}
          cuerpo={(quien) => <Image source={{ uri: quien === 'antonio' ? fotoAntonio : fotoRetrato }} style={StyleSheet.absoluteFill} resizeMode="contain" />}
          onCerrar={() => {}}
          onProbar={() => {}}
          inicio={{ e: Number(q.get('paso') || 0) }}
          retrasoMs={0}
        />
      </>
    );
  if (cual === 'transicion') return <Transicion h={Number(q.get('h') ?? 0.5)} />;
  return <Mesa />;
}

const s = StyleSheet.create({
  hud: { position: 'absolute', top: 36, left: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.panel, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  hudTexto: { color: T.texto2, fontSize: 13, fontWeight: '600' },
  burbuja: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  burbujaTexto: { backgroundColor: T.panel, color: T.texto, fontSize: 16, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, overflow: 'hidden' },
  cabeza: { paddingTop: 40, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#2C2E32' },
  cabezaTexto: { color: '#ECE8E2', fontSize: 26, fontWeight: '800' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  inicial: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#34363A', alignItems: 'center', justifyContent: 'center' },
  inicialTexto: { color: '#E0C27F', fontSize: 18, fontWeight: '800' },
  filaNombre: { color: '#ECE8E2', fontSize: 16, fontWeight: '700' },
  filaUltimo: { color: '#A8A197', fontSize: 13 },
  leyenda: { position: 'absolute', top: 4, left: 0, right: 0, alignItems: 'center' },
  leyendaTexto: { color: '#fff', fontSize: 11, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6 },
});

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', position: 'relative' }}>
    <Pantalla />
  </div>
);
