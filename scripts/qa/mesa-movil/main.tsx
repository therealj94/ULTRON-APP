// Las pantallas del banco de la mesa (una por `?p=`):
//   barra       la mesa de Claudio con la barra de tres botones y los atajos deslizables
//   vivo        igual, con la conversación en vivo abierta (la píldora «En vivo · Terminar»)
//   mas         la hoja «Más» abierta
//   tutorial    el recorrido de primera vez (`&paso=N`)
//   transicion  un cuadro de la transición grande → chiquita al entrar al chat (`&h=0..1`: 1 sobre la
//               mesa, 0 en su lugar), con la misma cuenta de la app (avatar3d/presencia.haciaMarco)
// `&escala=1.6` agranda la letra como el «Tamaño de fuente» de Android.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BarraMesa } from '@movil/src/components/BarraMesa';
import { HojaMas } from '@movil/src/components/HojaMas';
import { AccionesAvatar } from '@movil/src/components/AccionesAvatar';
import { Tutorial } from '@movil/src/tutorial/Tutorial';
import { avatarPorId } from '@movil/src/avatares/catalogo';
import { haciaMarco } from '@movil/src/avatar3d/presencia';
import { T } from '@movil/src/tema';
import fotoPie from '@movil/assets/avatares/claudio-pie/base.webp';
import fotoRetrato from '@movil/assets/avatares/claudio/base.webp';

const q = new URLSearchParams(location.search);
const cual = q.get('p') || 'barra';
const claudio = avatarPorId('claudio');
const tema = claudio.tema;
const nombre = 'Claudio';

function Mesa({ conversando = false, oculta = 0 }: { conversando?: boolean; oculta?: number }) {
  const [alto, setAlto] = useState(154);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: tema.fondo, opacity: 1 - oculta }]}>
      <Image source={{ uri: fotoPie }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={s.hud}>
        <View style={[s.punto, { backgroundColor: conversando ? T.activo : T.activo }]} />
        <Text style={s.hudTexto}>{nombre} · {conversando ? 'escuchando' : 'te escucho'}</Text>
      </View>
      <View style={[s.burbuja, { bottom: alto + 8 }]}>
        <Text style={s.burbujaTexto}>¡Aquí estoy! Cuéntame.</Text>
      </View>
      <BarraMesa
        encima={<AccionesAvatar acciones={claudio.acciones} tema={tema} onAccion={() => {}} />}
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
  const filas = ['Mamá', 'Beto', 'Ana', 'Equipo Orden Global', 'Medardo'];
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

function Pantalla() {
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
        <Tutorial visible nombreAvatar={nombre} tema={tema} onCerrar={() => {}} pasoInicial={Number(q.get('paso') || 0)} />
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
