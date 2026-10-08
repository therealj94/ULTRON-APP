/**
 * LA VOZ DEL DOCTOR EN EL TELÉFONO: lo que toca lo nativo (la lógica está en colaVoz.ts, que se prueba sin teléfono).
 *
 * Cada frase va, si se puede, por el reproductor EN STREAMING de AU-RA (modules/aura-voz: AudioTrack que empieza a
 * sonar con los primeros 150 ms de PCM, lib/sonidoVivo.ts) desde `/api/electrum/voz/pcm`; la siguiente queda pegada
 * detrás, sin hueco. Si el binario no trae el módulo (una APK anterior con este JS por aire, o iOS), si la guardia
 * contra cierres lo bloqueó (colaVoz.ts `guardiaVozAlAbrir`), o si una frase falla ANTES de sonar (el servidor no
 * tiene la ruta, sin red), ESA frase va por el camino de siempre —`/api/electrum/voz` bajada entera y sonada con
 * expo-av— y no se pierde. Un fallo del módulo o de la ruta (lib/vozNativa.ts `falloDeSesion`) deja el camino de
 * siempre hasta reabrir la app.
 *
 * Los sonidos de expo-av se crean con `Audio.Sound.createAsync`, que pasa por el registro de lib/avRegistro.ts: al
 * recargar por una OTA se sueltan en el hilo principal (sin el cierre del 8-oct).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { AppState, Platform } from 'react-native';
import { moduloVoz } from '../lib/auraVoz';
import { CentralVoz, SonidoVivo, type FalloVoz, type Reproducible } from '../lib/sonidoVivo';
import { cabecerasVoz, falloDeSesion } from '../lib/vozNativa';
import { cabecerasCampo, urlVozPcm, voz } from './api';
import { GUARDIA_VOZ_CAMPO, guardiaVozAlAbrir, guardiaVozCampoValida, type GuardiaVozCampo, type PedidoVoz } from './colaVoz';

const CLAVE_GUARDIA = 'electrum_voz_pcm_guardia_v1';

let central: CentralVoz | null | undefined;
/** Por qué el camino nuevo quedó apagado en esta sesión (null: no falló). */
let falloSesion: string | null = null;
let fallosSeguidos = 0;
/** Hasta leer la guardia, la voz de siempre. */
let decidido = false;
let bloqueada = false;
let guardia: GuardiaVozCampo = {};
/** La marca «arrancando» de este proceso: se escribe una vez antes de la primera frase nativa. */
let marcaP: Promise<boolean> | null = null;
let sanoReloj: ReturnType<typeof setTimeout> | null = null;
let sana = false;
let arranque: Promise<void> | null = null;

function escribir(g: GuardiaVozCampo): Promise<boolean> {
  guardia = g;
  return AsyncStorage.setItem(CLAVE_GUARDIA, JSON.stringify(g)).then(
    () => true,
    () => false
  );
}

function centralVoz(): CentralVoz | null {
  if (central !== undefined) return central;
  try {
    const m = moduloVoz();
    central = m ? new CentralVoz(m) : null;
  } catch {
    central = null;
  }
  return central;
}

/** Una vez por proceso (la pantalla del campo al montar): lo que dejó la vez anterior. */
export function prepararVozCampo(): Promise<void> {
  if (arranque) return arranque;
  arranque = (async () => {
    if (Platform.OS !== 'android' || !centralVoz()) {
      decidido = true;
      return;
    }
    try {
      const crudo = await AsyncStorage.getItem(CLAVE_GUARDIA);
      const r = guardiaVozAlAbrir(guardiaVozCampoValida(crudo ? JSON.parse(crudo) : null), Date.now());
      bloqueada = r.bloqueada;
      if (r.bloqueada) console.warn('[electrum] voz en vivo: la de siempre en esta sesión (la vez anterior se cerró con ella arrancando)');
      await escribir(r.estado);
    } catch {
      /* lo guardado no se pudo leer: lo de fábrica */
    }
    decidido = true;
    try {
      // A segundo plano con calma: no es un cierre con la voz nativa andando. La próxima vuelve a anotar.
      AppState.addEventListener('change', (st) => {
        if (st === 'active' || !marcaP) return;
        if (sanoReloj) clearTimeout(sanoReloj);
        sanoReloj = null;
        sana = false;
        marcaP = null;
        const { arrancando: _fuera, ...resto } = guardia;
        void escribir(resto);
      });
    } catch {
      /* sin AppState: solo al arrancar */
    }
  })();
  return arranque;
}

/** ¿Esta frase va por el reproductor en streaming? */
function usarVivo(): boolean {
  return decidido && !bloqueada && !falloSesion && !!centralVoz();
}

function alFallar(f: FalloVoz) {
  fallosSeguidos += 1;
  console.warn(`[electrum] voz en vivo: una frase no sonó (${f.codigo}${f.status ? ` ${f.status}` : ''}); va por la de siempre`);
  if (!falloSesion && falloDeSesion(f, fallosSeguidos)) {
    falloSesion = `${f.codigo}${f.status ? ` ${f.status}` : ''}`;
    console.warn(`[electrum] voz en vivo: apagada hasta reabrir la app (${falloSesion})`);
  }
}

function alSonar() {
  fallosSeguidos = 0;
  if (sana || sanoReloj) return;
  sanoReloj = setTimeout(() => {
    sanoReloj = null;
    sana = true;
    const { arrancando: _fuera, ...resto } = guardia;
    void escribir(resto);
  }, GUARDIA_VOZ_CAMPO.sanoTrasMs);
}

/** La frase por el camino de siempre: bajada entera (`/api/electrum/voz`) y preparada en expo-av, sin sonar. */
async function porArchivo(p: PedidoVoz): Promise<Reproducible | null> {
  const url = await voz(p.voz || p.texto, p.emocion, p.idioma, { primera: p.primera, personaje: p.personaje });
  if (!url) return null;
  try {
    const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: false, progressUpdateIntervalMillis: 100 });
    return sound as unknown as Reproducible;
  } catch {
    return null;
  }
}

/** El sonido de una frase, sin sonar todavía (lo pide la cola, colaVoz.ts). */
export async function prepararFraseCampo(p: PedidoVoz): Promise<Reproducible | null> {
  const respaldo = () => porArchivo(p);
  if (!usarVivo()) return respaldo();
  const c = centralVoz()!;
  // La primera frase nativa del proceso espera a que «arrancando» quede en el disco (si no se puede, la de siempre).
  if (!marcaP) marcaP = escribir({ ...guardia, arrancando: Date.now() });
  if (!(await marcaP)) return respaldo();
  const s = c.crear({
    url: urlVozPcm(p.voz || p.texto, { idioma: p.idioma, personaje: p.personaje, primera: p.primera, emocion: p.emocion }),
    cabeceras: cabecerasVoz(cabecerasCampo()),
    respaldo,
    alFallar,
    alSonar,
  });
  return s ?? respaldo();
}

/** Cuando `actual` suene por el nativo, la de detrás va pegada (sin hueco), si para entonces sigue valiendo. */
export function encadenarFraseCampo(actual: Reproducible, siguiente: Promise<Reproducible | null>, sigueValiendo: () => boolean) {
  if (!(actual instanceof SonidoVivo)) return;
  actual.cuandoSuene(() => {
    void siguiente.then((s) => {
      if (s instanceof SonidoVivo && sigueValiendo()) s.encadenar();
    });
  });
}

/** Calla el reproductor en streaming ya (vacía su cola: nada encadenado vuelve a sonar). */
export function pararVozNativaCampo() {
  try {
    central?.parar();
  } catch {
    /* */
  }
}

/** Para el registro: por dónde va la voz. */
export function estadoVozCampo(): { vivo: boolean; motivo: string } {
  if (!centralVoz()) return { vivo: false, motivo: 'sin-modulo' };
  if (!decidido) return { vivo: false, motivo: 'sin-decidir' };
  if (bloqueada) return { vivo: false, motivo: 'guardia' };
  if (falloSesion) return { vivo: false, motivo: `fallo ${falloSesion}` };
  return { vivo: true, motivo: 'vivo' };
}
