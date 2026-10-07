/**
 * LOS CHATS CON SUS PESTAÑAS: PULSE2CHAT, WhatsApp, Correos y Veta Wallet, una al lado de la otra. Se cambia deslizando
 * de lado o tocando la pestaña (José, 2-oct: «una opción aparte de PULSE2CHAT, slide y cambia»; y «otra
 * sección de los correos al par de WhatsApp y PULSE2CHAT»).
 *
 * WhatsApp: cada cuenta de AU-RA puede agregar el suyo (server/whatsapp.ts; José, 5-oct: «No aparece agregar
 * whatsapp… ni les aparece whatsapp en donde está todo»). Sin vincular, la pestaña dice «+ WhatsApp» y abre «Agregar
 * mi WhatsApp» (whatsapp/PantallaWhatsapp.tsx); vinculado, la de siempre. Si el servidor no deja (o no tiene
 * WhatsApp), no aparece (logica.ts entradaWA). Correos
 * está para todos (correo/PantallaCorreos.tsx): sin cuentas conectadas explica cómo conectar una. Veta
 * Wallet también (cartera/PantallaCartera.tsx; José, 3-oct): saldos, enviar, recibir y abrir la wallet.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Letra as Text } from '../ui/Letra';
import { useTema } from '../nucleo/tema';
import { tr } from '../i18n';
import { PantallaChats } from '../pulse/PantallaChats';
import { PantallaCorreos } from '../correo/PantallaCorreos';
import { PantallaCartera } from '../cartera/PantallaCartera';
import { PantallaWhatsapp } from './PantallaWhatsapp';
import * as API from './api';
import { leerGuardadoWA } from './guardado';
import { entradaWA, VERDE_WA, type EstadoWA } from './logica';

const REINTENTOS_MS = [3_000, 10_000, 30_000, 60_000];

type Props = {
  onAbrir: (correo: string, nombre: string) => void;
  onAtras?: () => void;
  /** Empezar en WhatsApp (p. ej. «ábreme WhatsApp»). */
  enWhatsapp?: boolean;
};

type Pagina = 'pulse' | 'whatsapp' | 'correos' | 'cartera';

/** Las páginas que tiene esta cuenta, en orden: PULSE2CHAT, WhatsApp (si lo tiene), Correos y Veta Wallet. */
export function paginasDe(conWhatsapp: boolean): Pagina[] {
  return conWhatsapp ? ['pulse', 'whatsapp', 'correos', 'cartera'] : ['pulse', 'correos', 'cartera'];
}

/**
 * Qué se ve: la página pedida si existe (si WhatsApp desaparece estando en él, PULSE2CHAT) y su lugar en el
 * deslizador. Es LA fuente de verdad: la pestaña marcada y la posición del deslizador salen de aquí, de la misma
 * página, siempre (auditoría A1: «abre WhatsApp» con el estado llegando a la vez dejaba la pestaña de WhatsApp
 * marcada y los chats de PULSE2CHAT debajo).
 */
export function vistaPaginas(conWhatsapp: boolean, pedida: Pagina): { paginas: Pagina[]; pagina: Pagina; indice: number } {
  const paginas = paginasDe(conWhatsapp);
  const pagina = paginas.includes(pedida) ? pedida : 'pulse';
  return { paginas, pagina, indice: paginas.indexOf(pagina) };
}

export function ChatsConWhatsapp({ onAbrir, onAtras, enWhatsapp = false }: Props) {
  const p = useTema();
  const { width } = useWindowDimensions();
  const [estado, setEstado] = useState<EstadoWA | null>(null);
  const [pedida, setPedida] = useState<Pagina>(enWhatsapp ? 'whatsapp' : 'pulse');
  const [noLeidosWA, setNoLeidosWA] = useState(0);
  const [noLeidosCorreo, setNoLeidosCorreo] = useState(0);
  const deslizador = useRef<ScrollView>(null);

  // El permiso lo decide el servidor en una respuesta (permitido: false). Un fallo de red NO es un «no»:
  // mientras tanto se ve PULSE2CHAT y se vuelve a preguntar (Codex en #123). Sin red, si este teléfono ya
  // tenía su WhatsApp (lo último guardado, whatsapp/guardado.ts), la pestaña sigue ahí con lo de la última vez.
  useEffect(() => {
    let vivo = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    void leerGuardadoWA().then((g) => {
      if (vivo && g) setEstado((e) => e ?? g.estado);
    });
    const preguntar = (intento: number) => {
      void API.estadoWA()
        .then((e) => vivo && setEstado(e))
        .catch(() => {
          if (vivo) espera = setTimeout(() => preguntar(intento + 1), REINTENTOS_MS[Math.min(intento, REINTENTOS_MS.length - 1)]);
        });
    };
    preguntar(0);
    return () => {
      vivo = false;
      if (espera) clearTimeout(espera);
    };
  }, []);

  // La pantalla de WhatsApp avisa cada estado; aquí solo importa si cambia qué se ve (al vincular: «+ WhatsApp» →
  // «WhatsApp»). Estable, para no reiniciar su sondeo en cada dibujo.
  const alEstado = useCallback((e: EstadoWA) => setEstado((antes) => (entradaWA(antes) === entradaWA(e) ? antes : e)), []);
  const entrada = entradaWA(estado);
  const conWhatsapp = entrada !== 'oculto';
  const { paginas, pagina, indice } = vistaPaginas(conWhatsapp, pedida);

  // «Ábreme WhatsApp»: se pide la página; si WhatsApp todavía no está (su estado no llegó), se verá en cuanto llegue.
  useEffect(() => {
    if (enWhatsapp) setPedida('whatsapp');
  }, [enWhatsapp]);

  // UN solo lugar mueve el deslizador: a la página que se ve. Al tocar una pestaña, con animación; al girar el
  // teléfono, al aparecer WhatsApp o al llegar «ábreme WhatsApp», sin ella. Así la pestaña marcada y lo que hay
  // debajo nunca se separan.
  const animar = useRef(false);
  const irAlIndice = useCallback(() => {
    deslizador.current?.scrollTo({ x: indice * width, animated: animar.current });
    animar.current = false;
  }, [indice, width]);
  useEffect(irAlIndice, [irAlIndice, paginas.length]);

  const ir = (n: Pagina) => {
    if (!paginas.includes(n)) return;
    animar.current = n !== pagina;
    setPedida(n);
  };

  const cambio = <Pestanas p={p} paginas={paginas} pagina={pagina} noLeidosWA={noLeidosWA} noLeidosCorreo={noLeidosCorreo} agregarWA={entrada === 'agregar'} onCambiar={ir} />;
  // Deslizar con el dedo: la página donde se soltó pasa a ser la que se ve (y la pestaña la sigue).
  const alSoltar = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    setPedida(paginas[Math.min(paginas.length - 1, Math.max(0, i))]);
  };

  return (
    <ScrollView
      ref={deslizador}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onMomentumScrollEnd={alSoltar}
      // Cambió el ancho o el número de páginas: el contenido se vuelve a medir y el deslizador vuelve a su página.
      onContentSizeChange={irAlIndice}
      style={{ flex: 1, backgroundColor: p.fondo }}
    >
      <View style={{ width, flex: 1 }}>
        <PantallaChats onAbrir={onAbrir} onAtras={onAtras} cambio={cambio} />
      </View>
      {conWhatsapp ? (
        <View style={{ width, flex: 1 }}>
          <PantallaWhatsapp onAtras={onAtras} cambio={cambio} activa={pagina === 'whatsapp'} estadoInicial={estado} onNoLeidos={setNoLeidosWA} onEstado={alEstado} />
        </View>
      ) : null}
      <View style={{ width, flex: 1 }}>
        <PantallaCorreos onAtras={onAtras} cambio={cambio} activa={pagina === 'correos'} onNoLeidos={setNoLeidosCorreo} />
      </View>
      <View style={{ width, flex: 1 }}>
        <PantallaCartera onAtras={onAtras} cambio={cambio} activa={pagina === 'cartera'} />
      </View>
    </ScrollView>
  );
}

/**
 * Las pestañas: todas con el mismo dorado al elegirlas (auditoría M6: antes WhatsApp se pintaba de verde chillón al
 * lado del dorado). WhatsApp se reconoce por su punto verde junto al nombre y por el verde de su cuenta de sin leer.
 */
function Pestanas({ p, paginas, pagina, noLeidosWA, noLeidosCorreo, agregarWA, onCambiar }: { p: ReturnType<typeof useTema>; paginas: Pagina[]; pagina: Pagina; noLeidosWA: number; noLeidosCorreo: number; agregarWA: boolean; onCambiar: (n: Pagina) => void }) {
  const verde = p.oscuro ? VERDE_WA.oscuro : VERDE_WA.claro;
  const opciones: Record<Pagina, { texto: string; punto?: number; marca?: string; leer?: string; etiqueta?: string }> = {
    pulse: { texto: 'PULSE2CHAT' },
    // Sin vincular todavía: «+ WhatsApp» (se lee «Agregar mi WhatsApp»).
    whatsapp: agregarWA
      ? { texto: '+ WhatsApp', marca: verde, etiqueta: tr('Agregar mi WhatsApp', 'Add my WhatsApp') }
      : { texto: 'WhatsApp', punto: noLeidosWA, marca: verde, leer: tr(`${noLeidosWA} chats sin leer`, `${noLeidosWA} unread chats`) },
    correos: { texto: tr('Correos', 'Email'), punto: noLeidosCorreo, leer: tr(`${noLeidosCorreo} correos sin leer`, `${noLeidosCorreo} unread emails`) },
    cartera: { texto: 'Veta Wallet' },
  };
  return (
    <View style={[st.pista, { backgroundColor: p.superficie }]} accessibilityRole="tablist">
      {paginas.map((n) => {
        const o = opciones[n];
        const activa = pagina === n;
        const globo = o.marca || p.acento;
        const sobreGlobo = o.marca ? (p.oscuro ? p.fondo : '#FFFFFF') : p.sobreAcento;
        return (
          <Pressable
            key={n}
            onPress={() => onCambiar(n)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activa }}
            accessibilityLabel={o.etiqueta || (o.punto ? `${o.texto}, ${o.leer}` : o.texto)}
            style={[st.opcion, activa && { backgroundColor: p.acento }]}
          >
            {/* El punto verde solo sin elegir: elegida, el nombre basta (y así «WhatsApp» y su cuenta caben enteros). */}
            {o.marca && !activa ? <View style={[st.marca, { backgroundColor: o.marca }]} /> : null}
            <Text style={[st.texto, { color: activa ? p.sobreAcento : p.texto2 }, paginas.length > 2 && st.textoChico, paginas.length > 3 && st.textoMini]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {o.texto}
            </Text>
            {o.punto ? (
              <View style={[st.punto, { backgroundColor: activa ? p.sobreAcento : globo }]}>
                <Text style={[st.puntoTxt, { color: activa ? p.acento : sobreGlobo }]} maxFontSizeMultiplier={1.2}>
                  {o.punto > 9 ? '9+' : o.punto}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  pista: { flexDirection: 'row', borderRadius: 999, padding: 4 },
  opcion: { flex: 1, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, paddingHorizontal: 4 },
  texto: { fontSize: 14, fontWeight: '700', letterSpacing: 0.2, flexShrink: 1 },
  textoChico: { fontSize: 13, letterSpacing: 0.1 },
  // Cuatro pestañas en un teléfono angosto: un poco más chicas para que quepan sin cortarse.
  textoMini: { fontSize: 12, letterSpacing: 0 },
  marca: { width: 7, height: 7, borderRadius: 4 },
  punto: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  puntoTxt: { fontSize: 11, fontWeight: '800' },
});
