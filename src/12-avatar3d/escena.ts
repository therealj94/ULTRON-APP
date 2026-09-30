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
  nombreVisema,
  pesosObjetivo,
  zonaDeNodo,
  zonaPorPosicion,
  type HuesoClave,
  type Mapeo,
  type MapeoParcial,
} from '../../mobile/src/avatar3d/mapeo';
import { BOCA_CERRADA, ESTADO_INICIAL, type AlaEscena, type Boca, type Camara, type DeLaEscena, type EstadoAvatar, type ZonaToque } from '../../mobile/src/avatar3d/tipos';

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

if (renderer) {
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  // Luz de estudio suave: cielo y suelo, una principal cálida y un contraluz que la despega del fondo.
  escena.add(new THREE.HemisphereLight(0xfff7ee, 0x3a3530, 0.7));
  const principal = new THREE.DirectionalLight(0xfff1e0, 1.6);
  principal.position.set(1.2, 2.4, 2.6);
  escena.add(principal);
  const contra = new THREE.DirectionalLight(0xd6b56c, 0.9);
  contra.position.set(-2, 2.2, -2.2);
  escena.add(contra);
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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
const acciones = new Map<string, THREE.AnimationAction>();
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
  tieneBocaMorph = morphs.has('jawOpen') || morphs.has(nombreVisema('aa'));
  mezclador = new THREE.AnimationMixer(modelo);
  for (const c of g.animations) acciones.set(c.name, mezclador.clipAction(c));
  clips = g.animations.map((c) => c.name);
  mezclador.addEventListener('finished', (e: any) => terminoGesto(e.action as THREE.AnimationAction));
  mezclador.update(0);
  modelo.updateMatrixWorld(true);
  caja = new THREE.Box3().setFromObject(modelo);
  ajustarTamano();
  actualizarBase(true);
  renderer.render(escena, camara);
  const faltan = [
    ...(clipBase(ESTADO_INICIAL, mapeo, clips) ? [] : ['animación idle']),
    ...(morphs.has(nombreVisema('aa')) ? [] : ['visemas']),
    ...(morphs.has('eyeBlinkLeft') ? [] : ['parpadeo']),
    ...(huesos.cabeza ? [] : ['hueso head']),
  ];
  alTelefono({ tipo: 'listo', info: { morphs: morphs.size, clips, huesos: Object.keys(huesos).length, triangulos: Math.round(triangulos), faltan } });
  medirDesde = performance.now();
  cuadrosMedidos = 0;
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
  if (c === 'retrato') {
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
  const nueva = n ? acciones.get(n) : undefined;
  const vieja = baseActual ? acciones.get(baseActual) : undefined;
  baseActual = n;
  if (nueva) {
    nueva.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
    if (!inmediato && !gestoActual) nueva.fadeIn(0.35);
    if (gestoActual) nueva.setEffectiveWeight(0);
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
  for (const [nombre, lista] of morphs) {
    const deBoca = nombre.startsWith('viseme_') || nombre === 'jawOpen' || nombre.startsWith('mouth');
    const esParpado = mapeo.parpadeo.includes(nombre);
    const antes = pesos.get(nombre) || 0;
    const objetivo = meta[nombre] || 0;
    const ahora = esParpado ? objetivo : suave(antes, objetivo, deBoca ? 18 : 8, dt);
    if (Math.abs(ahora - antes) < 1e-4 && antes === objetivo) continue;
    pesos.set(nombre, ahora);
    for (const { mesh, i } of lista) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[i] = ahora;
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
    alTelefono({ tipo: 'rendimiento', fps: Math.round(fps), dpr, lento: false });
    return;
  }
  if (dpr > 1) {
    // Primero se baja la resolución (lo más caro en un teléfono modesto son los píxeles).
    dpr = Math.max(1, Math.round((dpr - 0.5) * 2) / 2);
    ajustarTamano();
    medirDesde = t;
    cuadrosMedidos = 0;
    return;
  }
  medido = true;
  alTelefono({ tipo: 'rendimiento', fps: Math.round(fps), dpr, lento: true });
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
  const cabeza = huesos.cabeza ? huesos.cabeza.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, caja.max.y - alto * 0.1, 0);
  const radio = alto * 0.07;
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
      mapeo = combinarMapeo(MAPEO_BASE, (m.mapeo || null) as MapeoParcial | null);
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
  camara: camara.position.toArray().map((n) => Math.round(n * 100) / 100),
});

if (renderer && !caida) alTelefono({ tipo: 'lista' });
