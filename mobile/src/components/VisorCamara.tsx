/**
 * «Lo que vi»: la foto que AU-RA acaba de mirar, con lo que reconoció.
 *
 * Sale cuando se le pregunta «¿qué ves?», «léeme esto», «¿cuánto dice el precio?» o «¿qué es esto?».
 * Muestra la MISMA foto que analizó el servidor (no la vista en vivo): así los recuadros caen donde el
 * modelo los puso, sin adivinar el recorte ni el espejo de la vista previa. La foto va sin espejar para
 * que el texto se lea al derecho.
 *
 * Recuadros solo si el servidor dijo que sus cajas son fiables (lib/vistaCamara.ts marcasDeVista); si no,
 * la lista de lo reconocido. Nada de recuadros inventados.
 *
 * Privacidad: la foto vive solo en la memoria de esta tarjeta (un data URI en el estado de la mesa) y se
 * suelta al cerrarla; no se guarda en el teléfono ni en el servidor.
 */
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { tr } from '../i18n';
import { cajaEnFoto, lineasDeVista, marcasDeVista, type FocoVision, type VistaCamara } from '../lib/vistaCamara';

export type EstadoVisor = {
  /** La foto analizada, base64 jpeg (sin el prefijo data:). */
  foto: string;
  vista: VistaCamara | null;
  foco: FocoVision;
  /** Todavía analizando. */
  mirando: boolean;
};

const TITULO: Record<FocoVision, [string, string]> = {
  escena: ['Lo que veo', 'What I see'],
  leer: ['Lo que leo', 'What I read'],
  precio: ['El precio', 'The price'],
  que_es: ['Lo que me muestras', 'What you show me'],
};

export function VisorCamara({ estado, onCerrar }: { estado: EstadoVisor; onCerrar: () => void }) {
  const { width: anchoPantalla, height: altoPantalla } = useWindowDimensions();
  const [medida, setMedida] = useState<{ w: number; h: number } | null>(null);
  const ancho = Math.min(320, anchoPantalla * 0.82);
  // El marco toma la proporción de la foto (cuando se conoce) sin pasar del 42% del alto de la pantalla.
  const altoMax = altoPantalla * 0.42;
  const proporcion = medida ? medida.h / medida.w : 4 / 3;
  const alto = Math.min(altoMax, ancho * proporcion);
  const marco = { w: ancho, h: alto };
  const marcas = medida ? marcasDeVista(estado.vista) : [];
  const lineas = lineasDeVista(estado.vista, estado.foco);
  const [es, en] = TITULO[estado.foco];

  return (
    <Pressable style={styles.capa} onPress={onCerrar} accessibilityRole="button" accessibilityLabel={tr('Cerrar lo que vi', 'Close what I saw')}>
      <View style={[styles.tarjeta, { width: ancho }]}>
        <Text style={styles.titulo}>{tr(es, en)}</Text>
        <View style={{ width: marco.w, height: marco.h }}>
          <Image
            source={{ uri: `data:image/jpeg;base64,${estado.foto}` }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
            onLoad={(e) => {
              const s = e.nativeEvent?.source;
              if (s?.width && s?.height) setMedida({ w: s.width, h: s.height });
            }}
          />
          {medida
            ? marcas.map((m, i) => {
                const r = cajaEnFoto(m.caja, medida, marco);
                if (!r) return null;
                return (
                  <View key={`${m.etiqueta}-${i}`} pointerEvents="none" style={[styles.caja, m.tipo === 'texto' && styles.cajaTexto, { left: r.left, top: r.top, width: r.width, height: r.height }]}>
                    <Text numberOfLines={1} style={[styles.etiqueta, m.tipo === 'texto' && styles.etiquetaTexto]}>
                      {m.etiqueta}
                    </Text>
                  </View>
                );
              })
            : null}
          {estado.mirando ? (
            <View style={styles.mirando} pointerEvents="none">
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </View>
        {lineas.length ? (
          <View style={styles.lista}>
            {lineas.map((l, i) => (
              <Text key={i} style={styles.linea} numberOfLines={estado.foco === 'leer' ? 4 : 2}>
                {l}
              </Text>
            ))}
          </View>
        ) : null}
        <Text style={styles.nota}>{tr('No guardo esta foto. Toca para cerrar.', 'I don’t keep this photo. Tap to close.')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  capa: { position: 'absolute', left: 0, right: 0, top: 84, alignItems: 'center', zIndex: 40, elevation: 40 },
  tarjeta: { backgroundColor: 'rgba(12,14,20,0.92)', borderRadius: 16, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  titulo: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  caja: { position: 'absolute', borderWidth: 2, borderColor: '#4ade80', borderRadius: 6 },
  cajaTexto: { borderColor: '#facc15' },
  etiqueta: { position: 'absolute', left: -2, top: -18, maxWidth: 140, backgroundColor: '#4ade80', color: '#062b12', fontSize: 11, fontWeight: '700', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' },
  etiquetaTexto: { backgroundColor: '#facc15', color: '#2b2306' },
  mirando: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  lista: { marginTop: 8, gap: 3 },
  linea: { color: '#e5e7eb', fontSize: 13 },
  nota: { color: 'rgba(229,231,235,0.6)', fontSize: 11, marginTop: 6 },
});
