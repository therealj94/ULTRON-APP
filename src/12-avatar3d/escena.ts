/**
 * EL CUERPO 3D DE AURA, dentro de la WebView del teléfono (mobile/src/avatar3d/Avatar3D.tsx).
 *
 * Se empaqueta con three.js en UNA página (scripts/avatar3d-movil.mjs → mobile/src/avatar3d/escenaHtml.ts),
 * igual que la sala: va dentro de la APK, aparece sin red y no depende del servidor.
 *
 * El teléfono le habla con `window.__avatar(mensaje)` (injectJavaScript) y ella contesta con
 * `ReactNativeWebView.postMessage`. El protocolo está en mobile/src/avatar3d/tipos.ts (AlaEscena,
 * DeLaEscena):
 *
 *   entra: config (cámara, tope de cuadros, mapeo) · trozo/fin (el .glb en base64: una WebView no lee
 *          los archivos de la APK) · estado · boca (20 Hz) · camara · zona (¿qué hay en x, y?) · pausa
 *   sale:  lista (arrancó con WebGL) · listo (modelo cargado, primer cuadro) · zona · rendimiento · fallo
 *
 * Qué hace cada cuadro: la animación de fondo según el estado (con fundido), el gesto pedido encima,
 * la mirada con la cabeza y los ojos, los blendshapes de la cara (expresión + visema, suavizados), el
 * parpadeo solo, y la mandíbula por hueso si el modelo no trae blendshapes de boca. Fondo transparente.
 *
 * Dos clases de modelo (mapeo.ts, `rig`):
 *  · «humanoide» (la especificación): la cara son pesos ARKit y los gestos, clips del esqueleto;
 *  · «nodos» (AU-RA, Claudio y ANT-ONIO de Codex): la cara de cada emoción viene horneada en su clip.
 *    Cada clip se parte en dos capas al cargar: la CARA (lo que cuelga de la cabeza y los morph
 *    targets) y el CUERPO (lo demás, cabeza incluida). El fondo toca las dos; un gesto solo el cuerpo,
 *    así la cara de la emoción sigue mientras saluda o asiente. La boca de la voz va encima de la del
 *    clip (la suelta hasta un 80 % mientras habla, como el controlador de Codex).
 *
 * La calidad (tipos.ts, Calidad) baja sola si no da los cuadros: resolución, luego barniz y brillo,
 * luego materiales simples; si ni así, avisa `lento` y el teléfono vuelve al 2D.
 *
 * Si algo sale mal (sin WebGL, el modelo no carga, se pierde el contexto, no da los cuadros), avisa
 * `fallo` o `rendimiento {lento}` y el teléfono vuelve a la figurita 2D sin que la persona lo note.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  MAPEO_BASE,
  buscarNombre,
  clipBase,
  clipGesto,
  combinarMapeo,
  pesosObjetivo,
  zonaDeNodo,
  zonaPorPosicion,
  type HuesoClave,
  type Mapeo,
  type MapeoParcial,
} from '../../mobile/src/avatar3d/mapeo';
import { BOCA_CERRADA, CALIDADES, ESTADO_INICIAL, type AlaEscena, type Boca, type Calidad, type Camara, type DeLaEscena, type EstadoAvatar, type ZonaToque } from '../../mobile/src/avatar3d/tipos';

const w = window as any;
/** Lo que se contestó, también en la página (las pruebas con un navegador sin teléfono lo leen aquí). */
const salida: DeLaEscena[] = (w.__avatarSalida = []);

function alTelefono(m: DeLaEscena) {
  salida.push(m);
  try {
    w.ReactNativeWebView?.postMessage(JSON.stringify(m));
  } catch {
    /* fuera del teléfono no hay a quién avisar */
  }
}

let caida = false;
function fallar(motivo: string) {
  if (caida) return;
  caida = true;
  alTelefono({ tipo: 'fallo', motivo: String(motivo || 'falló la escena').slice(0, 200) });
}

w.addEventListener('error', (e: ErrorEvent) => fallar(`error: ${e?.message || e}`));
w.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => fallar(`promesa: ${String(e?.reason?.message || e?.reason || '')}`));

/* ── la configuración (llega antes que el modelo) ────────────────────────────────────────── */

let camaraPedida: Camara = 'retrato';
let fpsMax = 60;
let dprMax = 2;
let reducido = false;
let mapeo: Mapeo = MAPEO_BASE;
let estado: EstadoAvatar = ESTADO_INICIAL;
let boca: Boca = BOCA_CERRADA;
let pausada = false;
let calidad: Calidad = 'alta';

/* ── el lienzo ───────────────────────────────────────────────────────────────────────────── */

let renderer: THREE.WebGLRenderer | null = null;
const lienzo = document.createElement('canvas');
lienzo.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
document.body.appendChild(lienzo);
try {
  const gl = lienzo.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('la WebView no tiene WebGL 2');
  renderer = new THREE.WebGLRenderer({ canvas: lienzo, context: gl, alpha: true, antialias: true, premultipliedAlpha: true });
} catch (e: any) {
  fallar(`sin WebGL: ${String(e?.message || e)}`);
}
lienzo.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  fallar('se perdió el contexto WebGL');
});

const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
let dpr = 1;
let cielo: THREE.HemisphereLight | null = null;
let entorno: THREE.Texture | null = null;

if (renderer) {
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  // Luz de estudio suave: cielo y suelo, una principal cálida y un contraluz que la despega del fondo.
  cielo = new THREE.HemisphereLight(0xfff7ee, 0x3a3530, 0.7);
  escena.add(cielo);
  const principal = new THREE.DirectionalLight(0xfff1e0, 1.6);
  principal.position.set(1.2, 2.4, 2.6);
  escena.add(principal);
  const contra = new THREE.DirectionalLight(0xd6b56c, 0.9);
  contra.position.set(-2, 2.2, -2.2);
  escena.add(contra);
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    entorno = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    escena.environment = entorno;
    escena.environmentIntensity = 0.55;
    pmrem.dispose();
  } catch {
    /* sin entorno, las luces bastan */
  }
}

function ajustarTamano() {
  if (!renderer) return;
  const W = Math.max(1, w.innerWidth || lienzo.clientWidth || 1);
  const H = Math.max(1, w.innerHeight || lienzo.clientHeight || 1);
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  camara.aspect = W / H;
  camara.updateProjectionMatrix();
  encuadrar(camaraPedida);
}
w.addEventListener('resize', ajustarTamano);

/* ── el modelo ───────────────────────────────────────────────────────────────────────────── */

type Morph = { mesh: THREE.Mesh; i: number };
let modelo: THREE.Object3D | null = null;
const morphs = new Map<string, Morph[]>();
const pesos = new Map<string, number>();
const colisionadores: THREE.Object3D[] = [];
const cuerpo: THREE.Mesh[] = [];
const huesos: Partial<Record<HuesoClave, THREE.Object3D>> = {};
const reposo = new Map<THREE.Object3D, THREE.Quaternion>();
let mezclador: THREE.AnimationMixer | null = null;
/** Los clips por nombre (en un rig «nodos», solo su capa de cuerpo). */
const acciones = new Map<string, THREE.AnimationAction>();
/** Rig «nodos»: la capa de cara de cada clip (la cabeza por dentro y los morph targets). */
const accionesCara = new Map<string, THREE.AnimationAction>();
/** Mallas cuyos morph targets mueve algún clip: la boca de la voz va encima de lo que pone el clip. */
const morphsDeClip = new Set<THREE.Mesh>();
/** La cabeza con geometría (rig «nodos»): su centro en coordenadas de la cabeza y su radio. */
let cabezaCentro: THREE.Vector3 | null = null;
let cabezaRadio = 0;
let clips: string[] = [];
let caja = new THREE.Box3();
let tieneBocaMorph = false;

const trozos: Uint8Array[] = [];

function base64ABytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function cargar(bytes: number) {
  const total = trozos.reduce((s, t) => s + t.length, 0);
  if (bytes && total !== bytes) return fallar(`el modelo llegó incompleto (${total} de ${bytes} bytes)`);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const t of trozos) {
    buf.set(t, o);
    o += t.length;
  }
  trozos.length = 0;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    loader.parse(buf.buffer, '', (g) => preparar(g), (e: any) => fallar(`el modelo no cargó: ${String(e?.message || e)}`));
  } catch (e: any) {
    fallar(`el modelo no cargó: ${String(e?.message || e)}`);
  }
}

function preparar(g: GLTF) {
  if (caida || !renderer) return;
  modelo = g.scene;
  escena.add(modelo);
  const nombres: string[] = [];
  let triangulos = 0;
  modelo.traverse((o) => {
    if (o.name) nombres.push(o.name);
    if (zonaDeNodo(o.name, mapeo)) {
      colisionadores.push(o);
      o.visible = false;
      return;
    }
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    cuerpo.push(m);
    const geo = m.geometry as THREE.BufferGeometry;
    triangulos += (geo.index ? geo.index.count : geo.attributes.position?.count || 0) / 3;
    const dic = m.morphTargetDictionary;
    if (dic && m.morphTargetInfluences) {
      for (const [k, i] of Object.entries(dic)) {
        const l = morphs.get(k) || [];
        l.push({ mesh: m, i });
        morphs.set(k, l);
      }
    }
  });
  // Un colisionador puede ser un vacío con mallas adentro: esas tampoco se dibujan.
  for (const c of colisionadores) c.traverse((o) => (o.visible = false));
  for (const k of Object.keys(mapeo.huesos) as HuesoClave[]) {
    const n = buscarNombre(mapeo.huesos[k], nombres);
    const obj = n ? modelo.getObjectByName(n) : undefined;
    if (obj) {
      huesos[k] = obj;
      reposo.set(obj, obj.quaternion.clone());
    }
  }
  tieneBocaMorph = morphs.has('jawOpen') || Object.keys(mapeo.visemas.aa || {}).some((n) => morphs.has(n));
  medirCabeza();
  mezclador = new THREE.AnimationMixer(modelo);
  prepararClips(g.animations);
  clips = g.animations.map((c) => c.name);
  guardarMateriales();
  mezclador.addEventListener('finished', (e: any) => terminoGesto(e.action as THREE.AnimationAction));
  mezclador.update(0);
  modelo.updateMatrixWorld(true);
  caja = new THREE.Box3().setFromObject(modelo);
  aplicarCalidad(calidad);
  actualizarBase(true);
  renderer.render(escena, camara);
  const faltan = [
    ...(clipBase(ESTADO_INICIAL, mapeo, clips) ? [] : ['animación idle']),
    ...(tieneBocaMorph ? [] : ['visemas']),
    ...(!mapeo.parpadeo.length || morphs.has(mapeo.parpadeo[0]) ? [] : ['parpadeo']),
    ...(huesos.cabeza ? [] : ['hueso head']),
  ];
  alTelefono({ tipo: 'listo', info: { morphs: morphs.size, clips, huesos: Object.keys(huesos).length, triangulos: Math.round(triangulos), faltan } });
  medirDesde = performance.now();
  cuadrosMedidos = 0;
}

/** La cabeza de un rig «nodos» tiene geometría adentro: su caja da el centro y el tamaño de verdad. */
function medirCabeza() {
  cabezaCentro = null;
  cabezaRadio = 0;
  const h = huesos.cabeza;
  if (!h || mapeo.rig !== 'nodos') return;
  modelo?.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(h);
  if (b.isEmpty()) return;
  const t = b.getSize(new THREE.Vector3());
  cabezaRadio = Math.max(t.x, t.y) / 2;
  cabezaCentro = h.worldToLocal(b.getCenter(new THREE.Vector3()));
}

/** Dónde está la cabeza ahora (el centro de su geometría si se midió; si no, el hueso). */
function centroCabeza(out: THREE.Vector3): THREE.Vector3 | null {
  const h = huesos.cabeza;
  if (!h) return null;
  if (cabezaCentro) return h.localToWorld(out.copy(cabezaCentro));
  return h.getWorldPosition(out);
}

/**
 * Los clips, listos para el mezclador. En un rig «nodos» cada uno se parte en dos capas (cara y
 * cuerpo) para que un gesto no le borre la cara a la emoción.
 */
function prepararClips(lista: THREE.AnimationClip[]) {
  if (!mezclador || !modelo) return;
  const cara = new Set<string>();
  if (mapeo.rig === 'nodos' && huesos.cabeza) huesos.cabeza.traverse((o) => void (o !== huesos.cabeza && o.name && cara.add(o.name)));
  for (const c of lista) {
    for (const t of c.tracks) {
      const p = THREE.PropertyBinding.parseTrackName(t.name);
      if (p.propertyName !== 'morphTargetInfluences') continue;
      modelo.getObjectByName(p.nodeName)?.traverse((m) => void ((m as THREE.Mesh).isMesh && morphsDeClip.add(m as THREE.Mesh)));
    }
    if (!cara.size) {
      acciones.set(c.name, mezclador.clipAction(c));
      continue;
    }
    const deCara: THREE.KeyframeTrack[] = [];
    const deCuerpo: THREE.KeyframeTrack[] = [];
    for (const t of c.tracks) {
      const p = THREE.PropertyBinding.parseTrackName(t.name);
      (cara.has(p.nodeName) || p.propertyName === 'morphTargetInfluences' ? deCara : deCuerpo).push(t);
    }
    acciones.set(c.name, mezclador.clipAction(new THREE.AnimationClip(c.name, c.duration, deCuerpo)));
    if (deCara.length) accionesCara.set(c.name, mezclador.clipAction(new THREE.AnimationClip(`${c.name}·cara`, c.duration, deCara)));
  }
}

/* ── la calidad ──────────────────────────────────────────────────────────────────────────── */

const TECHO_DPR: Record<Calidad, number> = { alta: 3, media: 1.5, baja: 1 };
const materialesOriginales = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
const materialesHechos: THREE.Material[] = [];

function guardarMateriales() {
  for (const m of cuerpo) materialesOriginales.set(m, m.material);
}

/** El mismo material con menos gasto: «media» sin barniz ni brillo; «baja», uno estándar sin relieve. */
function rebajar(o: THREE.Material, c: Calidad): THREE.Material {
  const f = o as THREE.MeshPhysicalMaterial;
  if (c === 'alta' || !(f as unknown as THREE.MeshStandardMaterial).isMeshStandardMaterial) return o;
  if (c === 'media') {
    if (!f.isMeshPhysicalMaterial) return o;
    const m = f.clone();
    m.clearcoat = 0;
    m.sheen = 0;
    m.specularIntensity = 1;
    m.specularColor.set(0xffffff);
    materialesHechos.push(m);
    return m;
  }
  const m = new THREE.MeshStandardMaterial({
    name: f.name,
    color: f.color,
    map: f.map,
    emissive: f.emissive,
    emissiveMap: f.emissiveMap,
    emissiveIntensity: f.emissiveIntensity,
    roughness: f.roughness,
    metalness: f.metalness,
    transparent: f.transparent,
    opacity: f.opacity,
    alphaTest: f.alphaTest,
    side: f.side,
    vertexColors: f.vertexColors,
    depthWrite: f.depthWrite,
  });
  materialesHechos.push(m);
  return m;
}

/** Pone la escena en ese nivel (resolución, materiales, reflejos del entorno). */
function aplicarCalidad(c: Calidad) {
  calidad = c;
  dpr = Math.max(1, Math.min(dprMax, w.devicePixelRatio || 1, TECHO_DPR[c]));
  const viejos = materialesHechos.splice(0);
  for (const [m, o] of materialesOriginales) m.material = Array.isArray(o) ? o.map((x) => rebajar(x, c)) : rebajar(o, c);
  for (const v of viejos) v.dispose();
  escena.environment = c === 'baja' ? null : entorno;
  // Sin reflejos del entorno, el cielo alumbra un poco más para que no se apague.
  if (cielo) cielo.intensity = c === 'baja' ? 1.15 : 0.7;
  ajustarTamano();
}

/* ── la cámara ───────────────────────────────────────────────────────────────────────────── */

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

function encuadrar(c: Camara) {
  if (!modelo) return;
  // Un nodo de cámara en el modelo manda (quien hizo el modelo sabe dónde se ve mejor).
  const nodo = modelo.getObjectByName(c === 'retrato' ? mapeo.camaras.retrato : mapeo.camaras.cuerpo);
  if (nodo) {
    nodo.updateWorldMatrix(true, false);
    nodo.getWorldPosition(camara.position);
    nodo.getWorldQuaternion(camara.quaternion);
    if ((nodo as THREE.PerspectiveCamera).isPerspectiveCamera) camara.fov = (nodo as THREE.PerspectiveCamera).fov;
    camara.updateProjectionMatrix();
    return;
  }
  // Si no, con la caja del cuerpo y la cabeza. El modelo mira hacia +Z (convención de glTF).
  const alto = Math.max(0.01, caja.max.y - caja.min.y);
  const centro = caja.getCenter(v1);
  const tanMedio = Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));
  let objetivo: THREE.Vector3;
  let cuadro: number;
  if (c === 'retrato' && cabezaCentro) {
    // Rig «nodos»: la cabeza entera y un poco de hombros (sus cabezas son grandes, no de persona).
    // Si la cabeza es casi todo el cuerpo (AU-RA, un orbe), el retrato es el cuerpo entero.
    const cabeza = centroCabeza(v2)!;
    cuadro = Math.min(Math.max(cabezaRadio * 3.1, alto * 0.3), alto * 1.12);
    const medio = cuadro / 2;
    // Que no corte las orejas ni las antenas, y que no baje más allá de los pies.
    const y = cuadro >= alto ? centro.y : Math.max(caja.min.y + medio, Math.max(cabeza.y - cabezaRadio * 0.35, caja.max.y + alto * 0.02 - medio));
    objetivo = new THREE.Vector3(cabeza.x, y, cabeza.z);
  } else if (c === 'retrato') {
    const cabeza = huesos.cabeza ? huesos.cabeza.getWorldPosition(v2) : v2.set(centro.x, caja.max.y - alto * 0.1, centro.z);
    objetivo = new THREE.Vector3(cabeza.x, cabeza.y - alto * 0.04, cabeza.z);
    cuadro = alto * 0.34;
  } else {
    objetivo = centro.clone();
    const ancho = caja.max.x - caja.min.x;
    cuadro = Math.max(alto * 1.08, (ancho * 1.15) / Math.max(0.3, camara.aspect));
  }
  const d = cuadro / 2 / tanMedio;
  camara.position.set(objetivo.x, objetivo.y, objetivo.z + d);
  camara.near = Math.max(0.01, d / 100);
  camara.far = d * 10 + alto * 4;
  camara.lookAt(objetivo);
  camara.updateProjectionMatrix();
}

/* ── animaciones ─────────────────────────────────────────────────────────────────────────── */

let baseActual: string | null = null;
let gestoActual: THREE.AnimationAction | null = null;
let gestoN = -1;

function actualizarBase(inmediato = false) {
  const n = clipBase(estado, mapeo, clips);
  if (n === baseActual) return;
  const viejo = baseActual;
  baseActual = n;
  // El cuerpo espera al gesto que esté sonando; la cara (rig «nodos») cambia ya.
  cruzar(acciones, viejo, n, inmediato, !!gestoActual);
  cruzar(accionesCara, viejo, n, inmediato, false);
}

function cruzar(mapa: Map<string, THREE.AnimationAction>, viejo: string | null, nuevo: string | null, inmediato: boolean, callada: boolean) {
  const nueva = nuevo ? mapa.get(nuevo) : undefined;
  const vieja = viejo ? mapa.get(viejo) : undefined;
  if (nueva) {
    nueva.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
    if (!inmediato && !callada) nueva.fadeIn(0.35);
    if (callada) nueva.setEffectiveWeight(0);
  }
  if (vieja && vieja !== nueva) vieja.fadeOut(inmediato ? 0 : 0.35);
}

function hacerGesto() {
  const g = estado.gesto;
  if (!g || g.n === gestoN) return;
  gestoN = g.n;
  const n = clipGesto(g.nombre, mapeo, clips);
  const a = n ? acciones.get(n) : undefined;
  if (!a || a === gestoActual) return;
  gestoActual?.fadeOut(0.15);
  a.reset().setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true;
  a.fadeIn(0.2).play();
  gestoActual = a;
  const base = baseActual ? acciones.get(baseActual) : undefined;
  base?.fadeOut(0.2);
}

function terminoGesto(a: THREE.AnimationAction) {
  if (a !== gestoActual) return;
  gestoActual = null;
  a.fadeOut(0.3);
  const base = baseActual ? acciones.get(baseActual) : undefined;
  if (base) base.reset().setEffectiveWeight(1).fadeIn(0.3).play();
}

/* ── cada cuadro ─────────────────────────────────────────────────────────────────────────── */

let mirX = 0;
let mirY = 0;
let giro = 0;
let parpadeo = 0;
let proximoParpadeo = 1.5;
let tiempo = 0;
let habla = 0;
/** Qué tan rápido va la boca a su forma (1/s): abriendo y cerrando. */
const BOCA_ABRE = 40;
const BOCA_CIERRA = 45;
/** Las formas que usan los visemas del mapeo (se mueven rápido, como la boca). */
let formasDeBoca = new Set<string>();
const eu = new THREE.Euler();
const qu = new THREE.Quaternion();

function suave(actual: number, meta: number, rapidez: number, dt: number) {
  return actual + (meta - actual) * (1 - Math.exp(-rapidez * dt));
}

function girar(hueso: THREE.Object3D | undefined, x: number, y: number) {
  if (!hueso) return;
  eu.set(x, y, 0, 'YXZ');
  qu.setFromEuler(eu);
  hueso.quaternion.multiply(qu);
}

function actualizar(dt: number) {
  tiempo += dt;
  // Los huesos que la escena mueve vuelven a su pose de reposo; la animación pisa los que anima.
  for (const [h, q] of reposo) h.quaternion.copy(q);
  actualizarBase();
  hacerGesto();
  mezclador?.update(dt);

  // Mirar: la cabeza y el cuello siguen la mirada; los ojos llegan más lejos.
  const mx = estado.mirar.activa ? Math.max(-1, Math.min(1, estado.mirar.x)) : 0;
  const my = estado.mirar.activa ? Math.max(-1, Math.min(1, estado.mirar.y)) : 0;
  mirX = suave(mirX, mx, 5, dt);
  mirY = suave(mirY, my, 5, dt);
  girar(huesos.cuello, mirY * 0.12, mirX * 0.2);
  girar(huesos.cabeza, mirY * 0.18, mirX * 0.32);
  girar(huesos.ojoIzq, mirY * 0.2, mirX * 0.35);
  girar(huesos.ojoDer, mirY * 0.2, mirX * 0.35);
  // Sin animación de reposo, respira sola (un vaivén apenas visible del pecho).
  if (!baseActual && !reducido) girar(huesos.pecho, Math.sin(tiempo * 1.7) * 0.015, Math.sin(tiempo * 0.45) * 0.02);

  // Paseando, el cuerpo gira hacia donde va.
  if (modelo) {
    giro = suave(giro, estado.caminando ? estado.dir * 0.9 : 0, 6, dt);
    modelo.rotation.y = giro;
  }

  // El parpadeo: cada 2,5–6 s, 140 ms. Dormida o en silencio, los ojos quedan cerrados (lo pone la expresión).
  proximoParpadeo -= dt;
  if (proximoParpadeo <= 0) {
    parpadeo = 1;
    proximoParpadeo = 2.5 + Math.random() * 3.5;
  }
  parpadeo = Math.max(0, parpadeo - dt / 0.14);
  const cierre = Math.sin(Math.PI * Math.min(1, 1 - parpadeo)) * (parpadeo > 0 ? 1 : 0);

  // La cara: expresión + visema, suavizados (la boca rápida, lo demás más lento).
  const meta = pesosObjetivo(estado, boca, mapeo, (n) => morphs.has(n));
  if (!estado.silenciado && estado.expresion !== 'dormida') for (const n of mapeo.parpadeo) if (morphs.has(n)) meta[n] = Math.max(meta[n] || 0, cierre);
  // Donde un clip pone la boca (rig «nodos»), la voz la suelta hasta un 80 % y pone la suya encima.
  const conClip = !!(baseActual || gestoActual);
  habla = suave(habla, estado.silenciado ? 0 : Math.min(1, boca.nivel * 1.35), 18, dt);
  const suelta = 1 - 0.8 * habla;
  for (const [nombre, lista] of morphs) {
    const deBoca = nombre.startsWith('viseme_') || nombre === 'jawOpen' || nombre.startsWith('mouth') || formasDeBoca.has(nombre);
    const esParpado = mapeo.parpadeo.includes(nombre);
    const antes = pesos.get(nombre) || 0;
    const objetivo = meta[nombre] || 0;
    // La boca sigue a la voz casi en el acto (abre en ~25 ms, cierra en ~22: al cortar la voz se
    // cierra antes de 100 ms); la cara, más despacio. pruebas/sincronia.prueba.mjs mide con estos números.
    const ahora = esParpado ? objetivo : suave(antes, objetivo, deBoca ? (objetivo < antes ? BOCA_CIERRA : BOCA_ABRE) : 8, dt);
    const quieto = Math.abs(ahora - antes) < 1e-4 && antes === objetivo;
    if (!quieto) pesos.set(nombre, ahora);
    for (const { mesh, i } of lista) {
      const inf = mesh.morphTargetInfluences;
      if (!inf) continue;
      if (conClip && morphsDeClip.has(mesh)) inf[i] = inf[i] * suelta + ahora;
      else if (!quieto) inf[i] = ahora;
    }
  }
  // Como en el controlador de Codex: la suma de las formas no pasa de 1 (cada una sigue siendo convexa).
  if (conClip)
    for (const mesh of morphsDeClip) {
      const inf = mesh.morphTargetInfluences;
      if (!inf) continue;
      let suma = 0;
      for (const v of inf) suma += v;
      if (suma > 1) for (let k = 0; k < inf.length; k++) inf[k] /= suma;
    }
  // Sin blendshapes de boca: la mandíbula por hueso.
  if (!tieneBocaMorph && huesos.mandibula) girar(huesos.mandibula, Math.min(1, boca.nivel * 1.3) * 0.28, 0);
}

/* ── el bucle y la medición del rendimiento ──────────────────────────────────────────────── */

let ultimoCuadro = 0;
let medirDesde = 0;
let cuadrosMedidos = 0;
let medido = false;
const VENTANA_MS = 3000;

function medir(t: number) {
  if (medido || !medirDesde || pausada) return;
  cuadrosMedidos++;
  const pasado = t - medirDesde;
  if (pasado < VENTANA_MS) return;
  const fps = (cuadrosMedidos * 1000) / pasado;
  const objetivo = Math.min(fpsMax, 60);
  const minimo = Math.min(24, objetivo * 0.75);
  if (fps >= minimo) {
    medido = true;
    alTelefono({ tipo: 'rendimiento', fps: Math.round(fps), dpr, lento: false, calidad });
    return;
  }
  // Un escalón más barato: primero los píxeles (lo más caro en un teléfono modesto), después los
  // materiales. Cada escalón se vuelve a medir.
  const siguiente = CALIDADES[CALIDADES.indexOf(calidad) + 1];
  if (siguiente) {
    aplicarCalidad(siguiente);
    medirDesde = t;
    cuadrosMedidos = 0;
    return;
  }
  medido = true;
  alTelefono({ tipo: 'rendimiento', fps: Math.round(fps), dpr, lento: true, calidad });
}

function bucle(t: number) {
  requestAnimationFrame(bucle);
  if (!renderer || !modelo || caida || pausada) return;
  if (t - ultimoCuadro < 1000 / fpsMax - 2) return;
  const dt = Math.min(0.1, ultimoCuadro ? (t - ultimoCuadro) / 1000 : 1 / 60);
  ultimoCuadro = t;
  try {
    actualizar(dt);
    renderer.render(escena, camara);
  } catch (e: any) {
    fallar(`al dibujar: ${String(e?.message || e)}`);
    return;
  }
  medir(t);
}
requestAnimationFrame(bucle);

document.addEventListener('visibilitychange', () => {
  // Detrás, sin cuadros (y la medición se reanuda al volver, para no contar el tiempo escondida).
  if (document.hidden) medirDesde = 0;
  else if (!medido && modelo) {
    medirDesde = performance.now();
    cuadrosMedidos = 0;
  }
});

/* ── los toques ──────────────────────────────────────────────────────────────────────────── */

const rayo = new THREE.Raycaster();

function zonaEn(x: number, y: number): ZonaToque | null {
  if (!modelo) return null;
  modelo.updateMatrixWorld(true);
  rayo.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), camara);
  if (colisionadores.length) {
    const i = rayo.intersectObjects(colisionadores, true)[0];
    if (i) {
      for (let o: THREE.Object3D | null = i.object; o; o = o.parent) {
        const z = zonaDeNodo(o.name, mapeo);
        if (z) return z;
      }
    }
  }
  const golpe = rayo.intersectObjects(cuerpo, false)[0];
  if (!golpe) return null;
  const alto = Math.max(0.01, caja.max.y - caja.min.y);
  const cabeza = centroCabeza(new THREE.Vector3()) || new THREE.Vector3(0, caja.max.y - alto * 0.1, 0);
  const radio = cabezaRadio || alto * 0.07;
  return zonaPorPosicion({ dx: (golpe.point.x - cabeza.x) / radio, dy: -(golpe.point.y - cabeza.y) / radio, alto: (golpe.point.y - caja.min.y) / alto });
}

/* ── el puente con el teléfono ───────────────────────────────────────────────────────────── */

w.__avatar = (m: AlaEscena) => {
  if (!m || typeof m !== 'object' || caida) return;
  switch (m.tipo) {
    case 'config':
      camaraPedida = m.camara === 'cuerpo' ? 'cuerpo' : 'retrato';
      fpsMax = Math.max(15, Math.min(60, Number(m.fpsMax) || 60));
      dprMax = Math.max(1, Math.min(3, Number(m.dprMax) || 2));
      dpr = Math.min(dprMax, w.devicePixelRatio || 1);
      reducido = !!m.reducido;
      calidad = CALIDADES.includes(m.calidad as Calidad) ? (m.calidad as Calidad) : 'alta';
      dpr = Math.max(1, Math.min(dpr, TECHO_DPR[calidad]));
      mapeo = combinarMapeo(MAPEO_BASE, (m.mapeo || null) as MapeoParcial | null);
      formasDeBoca = new Set(Object.values(mapeo.visemas).flatMap((p) => Object.keys(p)));
      ajustarTamano();
      return;
    case 'trozo':
      try {
        trozos[m.i] = base64ABytes(m.b64);
      } catch {
        fallar('un pedazo del modelo llegó roto');
      }
      return;
    case 'fin':
      cargar(Number(m.bytes) || 0);
      return;
    case 'estado':
      if (m.estado && typeof m.estado === 'object') estado = { ...ESTADO_INICIAL, ...m.estado };
      return;
    case 'boca':
      boca = { nivel: Number(m.nivel) || 0, visema: m.visema || 'sil', peso: Number(m.peso) || 0 };
      return;
    case 'camara':
      camaraPedida = m.camara === 'cuerpo' ? 'cuerpo' : 'retrato';
      encuadrar(camaraPedida);
      return;
    case 'zona':
      alTelefono({ tipo: 'zona', id: m.id, zona: zonaEn(Number(m.x) || 0, Number(m.y) || 0) });
      return;
    case 'pausa':
      pausada = !!m.valor;
      if (!pausada) ultimoCuadro = 0;
      return;
  }
};

/** Para las pruebas con navegador (mobile/pruebas/avatar3d/navegador.mjs): qué está haciendo ahora. */
w.__avatarDepurar = () => ({
  pesos: Object.fromEntries(pesos),
  base: baseActual,
  gesto: gestoActual ? gestoActual.getClip().name : null,
  dpr,
  calidad,
  rig: mapeo.rig,
  camara: camara.position.toArray().map((n) => Math.round(n * 100) / 100),
});

/**
 * Solo para las pruebas con navegador (WebGL por software da 1–5 cuadros por segundo): fija la
 * calidad sin medir y avanza el tiempo a pasos de 1/30 s, con un solo dibujo al final.
 */
w.__avatarPrueba = {
  calidad(c: Calidad) {
    medido = true;
    if (CALIDADES.includes(c)) aplicarCalidad(c);
  },
  avanzar(segundos: number) {
    if (!renderer || !modelo || caida) return;
    medido = true;
    for (let t = 0; t < segundos; t += 1 / 30) actualizar(1 / 30);
    renderer.render(escena, camara);
  },
};

if (renderer && !caida) alTelefono({ tipo: 'lista' });
