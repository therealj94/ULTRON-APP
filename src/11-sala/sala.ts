/**
 * LA SALA — AU-RA con cuerpo entero, en su casa.
 *
 * Lo que la mesa le dice (estado del turno, emoción, boca, herramienta en curso) se convierte en lo
 * que hace con el cuerpo: camina, se sienta en su sillón, abre la computadora, lanza un avión de
 * papel, anota, levanta la tarjeta del oro, lee. Nada de esto decide qué se dice: eso es del cerebro.
 *
 * El cuerpo está hecho con formas simples mientras se modela el definitivo. Cuando llegue el GLB, se
 * cambia `construirAura` y el resto —lugares, tareas, poses— se queda como está.
 *
 * Contrato: `crearSala(host)` pinta en `host` y devuelve el control. Si el aparato no tiene WebGL,
 * lanza, y quien la usa cae a la cara 2D (src/02-cara).
 */
import * as THREE from 'three';
import type { FaceState } from '../types';
import type { Emocion } from '../../lib/emocion';
import { animoDe, HABLA, poseDe, type Pose, type Postura, type Tarea } from './tareas';
import { COLORES, CUERPOS, estiloDe, type Estilo } from './estilos';

export type ZonaToque = 'cuerpo' | 'cabeza';
export type OpcionesSala = {
  reducido?: boolean;
  postura?: Postura;
  onTocar?: (zona: ZonaToque) => void;
  onDeslizar?: (dir: 'arriba' | 'abajo') => void;
  /** Paleta y forma (estilos.ts); sin esto, el aspecto de siempre. */
  estilo?: Partial<Estilo>;
};
export type SalaControl = {
  estado: (face: FaceState, emocion: Emocion) => void;
  boca: (nivel: number) => void;
  mirar: (x: number, y: number, activa: boolean) => void;
  tarea: (t: Tarea, texto?: string) => void;
  postura: (p: Postura) => void;
  entrar: () => void;
  destruir: () => void;
};

type Lugar = 'centro' | 'sillon' | 'escritorio';
type Accion = {
  listo?: boolean;
  t?: number;
  inicio?: (a: Accion) => void;
  update: (dt: number, a: Accion) => boolean;
  fin?: (a: Accion) => void;
  [k: string]: unknown;
};
type Gesto =
  | null
  | 'saludo'
  | 'teclear'
  | 'mirar-pantalla'
  | 'preparar'
  | 'lanzar'
  | 'escribir'
  | 'sostener-libreta'
  | 'levantar'
  | 'sostener-doc'
  | 'mirar';

const BASE_Y = 0.12;
const ESC = 1.22;
const SILLON = { x: 2.0, z: -0.35, asiento: 0.52 };
const PUF = { x: -1.75, z: 0.25, asiento: 0.38 };
const ANG_ESCRITORIO = -1.45;
const VENTANA = new THREE.Vector3(-0.55, 2.3, -2.58);

export function hayWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function crearSala(host: HTMLElement, op: OpcionesSala = {}): SalaControl {
  if (!hayWebGL()) throw new Error('sin WebGL');
  const reducido = !!op.reducido;
  const estilo = estiloDe(op.estilo);
  const C = COLORES[estilo.paleta];
  const F = CUERPOS[estilo.forma];
  const { R, ALTO } = F;
  /** Las alturas de la cara y los brazos se midieron en el frijol (alto 1,25): se escalan con ella. */
  const fy = ALTO / 1.25;
  host.style.background = C.fondoCss;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const lienzoGL = renderer.domElement;
  lienzoGL.style.display = 'block';
  lienzoGL.style.width = '100%';
  lienzoGL.style.height = '100%';
  lienzoGL.style.touchAction = 'none';
  lienzoGL.setAttribute('aria-hidden', 'true');
  host.prepend(lienzoGL);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  const std = (hex: string, rough = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0, ...extra });
  const basica = (hex: string, extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color: hex, ...extra });
  const sombra = <T extends THREE.Object3D>(m: T): T => {
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const en = <T extends THREE.Object3D>(m: T, x: number, y: number, z: number): T => {
    m.position.set(x, y, z);
    return m;
  };

  scene.add(new THREE.HemisphereLight(C.cieloLuz, C.sueloLuz, C.luzHemi));
  const sol = new THREE.DirectionalLight(C.sol, C.luzSol);
  sol.position.set(-3.2, 5.5, 3.2);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  Object.assign(sol.shadow.camera, { left: -5, right: 5, top: 5, bottom: -3 });
  sol.shadow.bias = -0.0005;
  scene.add(sol);

  const texturas: THREE.Texture[] = [];
  function lienzo(w: number, h: number, dibujar: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    dibujar(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    texturas.push(t);
    return { t, g, dibujar: () => { dibujar(g, w, h); t.needsUpdate = true; } };
  }
  function redondo(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ------------------------------------------------------------------ la sala */
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), std(C.piso, 0.95));
  piso.rotation.x = -Math.PI / 2;
  piso.receiveShadow = true;
  scene.add(piso);
  scene.add(en(new THREE.Mesh(new THREE.PlaneGeometry(24, 9), std(C.pared, 1)), 0, 4.5, -2.6));
  scene.add(en(new THREE.Mesh(new THREE.BoxGeometry(24, 0.18, 0.06), std(C.zocalo, 0.9)), 0, 0.09, -2.56));

  const ventanaTex = lienzo(512, 704, (g, w, h) => {
    const arco = () => {
      g.beginPath();
      g.moveTo(40, h - 20);
      g.lineTo(40, w / 2);
      g.arc(w / 2, w / 2, w / 2 - 40, Math.PI, 0);
      g.lineTo(w - 40, h - 20);
      g.closePath();
    };
    g.save();
    arco();
    g.clip();
    const cielo = g.createLinearGradient(0, 0, 0, h);
    cielo.addColorStop(0, C.ventanaCielo[0]);
    cielo.addColorStop(0.6, C.ventanaCielo[1]);
    cielo.addColorStop(1, C.ventanaCielo[2]);
    g.fillStyle = cielo;
    g.fillRect(0, 0, w, h);
    const brillo = g.createRadialGradient(w * 0.35, h * 0.45, 10, w * 0.35, h * 0.45, 190);
    brillo.addColorStop(0, `rgba(${C.ventanaSol},0.95)`);
    brillo.addColorStop(1, `rgba(${C.ventanaSol},0)`);
    g.fillStyle = brillo;
    g.fillRect(0, 0, w, h);
    g.fillStyle = C.ventanaColinas;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.arc(60 + i * 70, h * 0.78, 55 + (i % 3) * 14, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.lineWidth = 22;
    g.strokeStyle = C.ventanaMarco;
    arco();
    g.stroke();
  });
  scene.add(en(new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.34), new THREE.MeshBasicMaterial({ map: ventanaTex.t, transparent: true })), VENTANA.x, VENTANA.y, VENTANA.z));

  const luz = lienzo(256, 256, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w / 2);
    r.addColorStop(0, `rgba(${C.luzPiso},0.55)`);
    r.addColorStop(1, `rgba(${C.luzPiso},0)`);
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
  const luzPiso = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.2), new THREE.MeshBasicMaterial({ map: luz.t, transparent: true, depthWrite: false }));
  luzPiso.rotation.set(-Math.PI / 2, 0, 0.5);
  scene.add(en(luzPiso, 0, 0.004, -0.6));

  const alfombra = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), std(C.alfombra, 1));
  alfombra.rotation.x = -Math.PI / 2;
  alfombra.receiveShadow = true;
  scene.add(en(alfombra, 0.2, 0.006, 0.5));

  scene.add(en(new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), std(C.cuadro, 1)), 1.1, 2.55, -2.585));
  const jarron = sombra(new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), std(C.jarron, 0.6)));
  jarron.scale.set(1, 1.35, 1);
  scene.add(en(jarron, 1.1, 2.3, -2.5));

  const planta = new THREE.Group();
  planta.add(sombra(en(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.23, 0.55, 32), std(C.maceta, 0.85)), 0, 0.275, 0)));
  const tonosHoja = C.hojas;
  for (let i = 0; i < 9; i++) {
    const hoja = sombra(new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12), std(tonosHoja[i % 3], 0.9)));
    hoja.scale.set(0.16, 0.5, 0.05);
    const a = (i / 9) * Math.PI * 2;
    hoja.position.set(Math.cos(a) * 0.14, 0.95 + (i % 3) * 0.08, Math.sin(a) * 0.14);
    hoja.rotation.set(Math.sin(a) * 0.55, -a, Math.cos(a) * 0.55);
    planta.add(hoja);
  }
  scene.add(en(planta, -3.2, 0, -1.9));

  // el sillón huevo
  const sillon = new THREE.Group();
  const mostaza = std(C.sillon, 0.97);
  const mostazaClara = std(C.sillonClaro, 0.97);
  const concha = sombra(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 48, 32, Math.PI / 2 + 0.66, Math.PI * 2 - 1.32, 0, Math.PI * 0.72),
      new THREE.MeshStandardMaterial({ color: C.sillon, roughness: 0.97, side: THREE.DoubleSide })
    )
  );
  concha.scale.set(1, 0.9, 0.95);
  concha.position.y = 0.95;
  const cojinAtras = sombra(new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 16), mostazaClara));
  cojinAtras.scale.set(1, 0.9, 0.55);
  sillon.add(
    concha,
    sombra(en(new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.68, 0.2, 48), mostazaClara), 0, 0.42, 0)),
    en(cojinAtras, 0, 0.86, -0.5),
    sombra(en(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.36, 32), mostaza), 0, 0.2, 0)),
    sombra(en(new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.62, 0.05, 48), std(C.sillonBase, 0.35, { metalness: 0.4 })), 0, 0.025, 0))
  );
  scene.add(en(sillon, SILLON.x, 0, SILLON.z));

  // escritorio, puf y computadora
  const adelante = new THREE.Vector3(Math.sin(ANG_ESCRITORIO), 0, Math.cos(ANG_ESCRITORIO));
  const puf = new THREE.Group();
  puf.add(sombra(en(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 40), std(C.puf, 0.95)), 0, 0.15, 0)));
  const tapaPuf = sombra(new THREE.Mesh(new THREE.SphereGeometry(0.34, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), std(C.pufTapa, 0.95)));
  tapaPuf.scale.y = 0.24;
  puf.add(en(tapaPuf, 0, 0.3, 0));
  scene.add(en(puf, PUF.x, 0, PUF.z));

  const centroEscritorio = new THREE.Vector3(PUF.x, 0, PUF.z).addScaledVector(adelante, 0.78);
  const escritorio = new THREE.Group();
  escritorio.add(
    sombra(en(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 48), std(C.mesa, 0.7)), 0, 0.8, 0)),
    sombra(en(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.78, 16), std(C.mesaPata, 0.7)), 0, 0.39, 0)),
    sombra(en(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.04, 32), std(C.mesaPata, 0.7)), 0, 0.02, 0))
  );
  escritorio.position.copy(centroEscritorio);
  scene.add(escritorio);

  let consulta = '';
  let pantallaFase = -1;
  const pantalla = lienzo(512, 320, (g, w, h) => {
    g.fillStyle = '#FFFDF8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#F1E6D6';
    g.fillRect(0, 0, w, 40);
    ['#E28E6A', '#E2A83E', '#8FAF93'].forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(22 + i * 20, 20, 6, 0, Math.PI * 2);
      g.fill();
    });
    if (pantallaFase < 0) return;
    g.fillStyle = '#FFFFFF';
    redondo(g, 40, 64, w - 80, 48, 24);
    g.fill();
    g.strokeStyle = '#E2A83E';
    g.lineWidth = 3;
    redondo(g, 40, 64, w - 80, 48, 24);
    g.stroke();
    g.fillStyle = '#3A322C';
    g.font = "500 22px 'Figtree', system-ui, sans-serif";
    g.textBaseline = 'middle';
    const txt = consulta.length > 32 ? consulta.slice(0, 31) + '…' : consulta;
    g.fillText(txt, 64, 89);
    if (pantallaFase >= 1) {
      for (let i = 0; i < 3; i++) {
        const y = 138 + i * 58;
        g.fillStyle = '#A8701A';
        redondo(g, 40, y, 220 - i * 30, 14, 7);
        g.fill();
        g.fillStyle = '#E6DACB';
        redondo(g, 40, y + 22, w - 120, 10, 5);
        g.fill();
        redondo(g, 40, y + 38, w - 180 + i * 20, 10, 5);
        g.fill();
      }
    }
  });
  const plata = std('#D5CFC6', 0.45, { metalness: 0.2 });
  const laptop = new THREE.Group();
  laptop.add(sombra(en(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.022, 0.32), plata), 0, 0.011, 0)));
  const bisagra = new THREE.Group();
  bisagra.position.set(0, 0.022, -0.16);
  const matPantalla = new THREE.MeshBasicMaterial({ map: pantalla.t });
  bisagra.add(sombra(en(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.014), plata), 0, 0.15, 0)), en(new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), matPantalla), 0, 0.15, 0.0085));
  laptop.add(bisagra);
  laptop.position.copy(centroEscritorio).setY(0.825);
  laptop.rotation.y = Math.atan2(-adelante.x, -adelante.z);
  scene.add(laptop);
  let tapaAbierta = 0;
  let tapaObj = 0;

  /* ------------------------------------------------------------------ AU-RA */
  const radio = (y: number) => {
    const t = Math.min(1, Math.max(0, y / ALTO));
    return R * Math.pow(1 - Math.pow(Math.abs(2 * t - 1), 2.4), 1 / 2.4) * (1 - F.afina * t);
  };
  const enSuperficie = (x: number, y: number, dentro = 0) => {
    const r = radio(y);
    return new THREE.Vector3(x, y, Math.sqrt(Math.max(0, r * r - x * x)) - dentro);
  };
  const perfil: THREE.Vector2[] = [];
  for (let i = 0; i <= 40; i++) {
    const y = (i / 40) * ALTO;
    perfil.push(new THREE.Vector2(radio(y), y));
  }

  const aura = new THREE.Group();
  const cuerpo = new THREE.Group();
  cuerpo.position.y = BASE_Y + F.flota;
  aura.add(cuerpo);
  const matPiel = std(C.piel, 0.5);
  const piel = sombra(new THREE.Mesh(new THREE.LatheGeometry(perfil, 64), matPiel));
  cuerpo.add(piel);

  const OJO_Y = 0.84 * fy;
  const BOCA_Y = F.ojosLuz ? OJO_Y - 0.12 : 0.71 * fy;
  // Con ojos de luz la cara es un visor oscuro y los ojos brillan dentro; si no, van pintados.
  const LUZ = '#F7EBD0';
  const ojoFuera = F.ojosLuz ? -0.014 : 0.02;
  if (F.ojosLuz) {
    // Un trozo del mismo torno, apenas por fuera de la piel: la pantalla sigue la curva de la cabeza.
    // Lo que dibuja la textura (una píldora oscura con reflejo) es lo único que se ve de ella.
    const y0 = BOCA_Y - 0.09;
    const y1 = OJO_Y + 0.11;
    const tramo: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const y = y0 + ((y1 - y0) * i) / 16;
      tramo.push(new THREE.Vector2(radio(y) + 0.006, y));
    }
    const visorTex = lienzo(512, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const fondo = g.createLinearGradient(0, 0, 0, h);
      fondo.addColorStop(0, C.ojos);
      fondo.addColorStop(1, '#3A3835');
      g.fillStyle = fondo;
      redondo(g, 24, 16, w - 48, h - 32, (h - 32) / 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.08)';
      redondo(g, 70, 26, w - 140, 34, 17);
      g.fill();
    });
    const visor = new THREE.Mesh(
      new THREE.LatheGeometry(tramo, 32, -0.62, 1.24),
      new THREE.MeshStandardMaterial({ map: visorTex.t, transparent: true, alphaTest: 0.05, roughness: 0.3 })
    );
    cuerpo.add(visor);
  }
  const tinta = F.ojosLuz ? basica(LUZ) : std(C.ojos, 0.3);
  const ojo = (x: number) => {
    const g = new THREE.Group();
    g.position.copy(enSuperficie(x, OJO_Y, ojoFuera));
    const globo = new THREE.Mesh(new THREE.SphereGeometry(F.ojo, 24, 16), tinta);
    globo.scale.set(1, F.ojoAlto, 0.7);
    g.add(globo);
    if (F.brillo) g.add(en(new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), basica('#FFFFFF')), 0.024, 0.028, 0.047));
    cuerpo.add(g);
    return g;
  };
  const ojoI = ojo(-F.ojoSep);
  const ojoD = ojo(F.ojoSep);
  const mejillas = [-0.29, 0.29].map((x) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), basica(C.mejilla, { transparent: true, opacity: 0.5 }));
    const p = enSuperficie(x * (R / 0.56), 0.74 * fy, -0.004);
    m.position.copy(p);
    m.lookAt(p.clone().add(new THREE.Vector3(p.x, 0, p.z)));
    m.visible = F.mejillas;
    cuerpo.add(m);
    return m;
  });

  const matBoca = F.ojosLuz ? basica(LUZ) : std(C.boca, 0.5);
  const bocaSonrisa = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 24, Math.PI), matBoca);
  bocaSonrisa.rotation.z = Math.PI;
  const bocaTriste = en(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 24, Math.PI), matBoca), 0, -0.03, 0);
  const bocaAbierta = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 12), matBoca);
  const bocaO = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.013, 8, 20), matBoca);
  const bocaLinea = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.07, 4, 8), matBoca);
  bocaLinea.rotation.z = Math.PI / 2;
  const boca = new THREE.Group();
  boca.position.copy(enSuperficie(0, BOCA_Y, F.ojosLuz ? -0.012 : -0.005));
  boca.scale.setScalar(F.boca);
  boca.add(bocaSonrisa, bocaTriste, bocaAbierta, bocaO, bocaLinea);
  cuerpo.add(boca);

  const verde = std(C.bufanda, 0.95);
  const bufanda = sombra(new THREE.Mesh(new THREE.TorusGeometry(radio(0.52 * fy) + 0.005, 0.07, 14, 56), verde));
  bufanda.rotation.x = Math.PI / 2;
  bufanda.position.y = 0.52 * fy;
  bufanda.visible = F.bufanda;
  cuerpo.add(bufanda);
  const colaBufanda = new THREE.Group();
  colaBufanda.position.set(0.2, 0.47 * fy, radio(0.47 * fy) - 0.02);
  colaBufanda.visible = F.bufanda;
  for (let i = 0; i < 2; i++) {
    const tira = sombra(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.26, 0.04), i ? std(C.bufanda2, 0.95) : verde));
    tira.position.set(i * 0.05, -0.12 - i * 0.04, 0.02 + i * 0.01);
    tira.rotation.z = 0.12 + i * 0.1;
    colaBufanda.add(tira);
  }
  cuerpo.add(colaBufanda);

  const brazo = (lado: number) => {
    const pivote = new THREE.Group();
    pivote.position.set(lado * (R - 0.06), 0.56 * fy, 0);
    const m = sombra(new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), matPiel));
    m.scale.set(0.11 * F.brazos, 0.2 * F.brazos, 0.11 * F.brazos);
    m.position.set(lado * 0.04, -0.16, 0);
    pivote.add(m);
    cuerpo.add(pivote);
    return pivote;
  };
  const brazoI = brazo(-1);
  const brazoD = brazo(1);
  const pieI = sombra(new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), matPiel));
  const pieD = sombra(new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), matPiel));
  for (const p of [pieI, pieD]) {
    p.scale.set(F.pies, 0.55 * F.pies, 1.3 * F.pies);
    p.visible = F.pies > 0;
  }
  aura.add(pieI, pieD);

  const anilloEje = new THREE.Group();
  anilloEje.position.y = BASE_Y + F.flota + 0.5 * fy;
  anilloEje.rotation.set(0.32, 0, -0.16);
  const anilloGiro = new THREE.Group();
  const matAnillo = basica(C.anillo, { transparent: true });
  const matHalo = basica(C.halo, { transparent: true, opacity: C.haloOp, blending: THREE.AdditiveBlending, depthWrite: false });
  const anillo = new THREE.Mesh(new THREE.TorusGeometry(0.86, F.anilloGrosor, 12, 160), matAnillo);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.05, 12, 160), matHalo);
  anillo.rotation.x = halo.rotation.x = Math.PI / 2;
  anilloGiro.add(anillo, halo);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    anilloGiro.add(en(new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), basica(C.anilloPuntos)), Math.cos(a) * 0.86, 0, Math.sin(a) * 0.86));
  }
  anilloEje.add(anilloGiro);
  aura.add(anilloEje);
  aura.scale.setScalar(ESC);
  scene.add(aura);

  /* ------------------------------------------------------------------ lo que sostiene */
  function hoja(w: number, h: number, t: THREE.Texture, canto: string) {
    const g = new THREE.Group();
    const borde = en(new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, h + 0.01, 0.008), std(canto, 0.8)), 0, 0, -0.006);
    g.add(borde, new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide })));
    g.visible = false;
    cuerpo.add(g);
    return g;
  }
  let renglones = 0;
  const libretaTex = lienzo(256, 320, (g) => {
    g.fillStyle = '#FFFBF1';
    g.fillRect(0, 0, 256, 320);
    g.fillStyle = C.anillo;
    g.fillRect(0, 0, 256, 26);
    g.strokeStyle = '#EADFCB';
    g.lineWidth = 2;
    for (let y = 70; y < 320; y += 38) {
      g.beginPath();
      g.moveTo(20, y);
      g.lineTo(236, y);
      g.stroke();
    }
    g.strokeStyle = '#3A322C';
    g.lineWidth = 5;
    g.lineCap = 'round';
    for (let i = 0; i < renglones; i++) {
      const y = 62 + i * 38;
      const largo = [170, 196, 120, 150, 90][i % 5];
      g.beginPath();
      g.moveTo(26, y);
      for (let x = 26; x < 26 + largo; x += 14) g.quadraticCurveTo(x + 4, y - 9, x + 7, y - 2);
      g.stroke();
    }
  });
  const libreta = hoja(0.24, 0.3, libretaTex.t, C.anillo);
  libreta.position.set(-0.08, 0.36 * fy, R + 0.08);
  libreta.rotation.x = -0.55;
  const lapiz = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 10), std('#E28E6A', 0.6));
  lapiz.visible = false;
  cuerpo.add(lapiz);

  const oroTex = lienzo(420, 280, (g, w, h) => {
    g.fillStyle = '#FFFDF6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#A8701A';
    g.font = "600 34px 'Fredoka', 'Figtree', system-ui, sans-serif";
    g.fillText('Oro', 28, 52);
    g.fillStyle = '#8B7E72';
    g.font = "500 18px 'Figtree', system-ui, sans-serif";
    g.fillText('precio de referencia', 28, 82);
    const pts = [200, 214, 196, 222, 230, 218, 246, 240, 258];
    g.beginPath();
    pts.forEach((v, i) => {
      const x = 28 + i * 45;
      const y = h - (v - 150);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.lineWidth = 7;
    g.strokeStyle = '#E2A83E';
    g.lineJoin = 'round';
    g.stroke();
    g.lineTo(28 + 8 * 45, h);
    g.lineTo(28, h);
    g.closePath();
    g.fillStyle = 'rgba(226,168,62,0.18)';
    g.fill();
  });
  const tarjetaOro = hoja(0.5, 0.33, oroTex.t, '#F3DDB0');
  tarjetaOro.position.set(0, 1.48 * fy, 0.28);
  tarjetaOro.rotation.x = 0.08;

  const docTex = lienzo(300, 390, (g, w, h) => {
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3A322C';
    redondo(g, 26, 30, 150, 16, 8);
    g.fill();
    g.fillStyle = '#D9CDBD';
    for (let y = 72; y < h - 30; y += 26) {
      redondo(g, 26, y, w - 52 - ((y * 7) % 60), 10, 5);
      g.fill();
    }
    g.fillStyle = '#E28E6A';
    redondo(g, w - 82, 26, 56, 26, 8);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.font = "600 16px 'Figtree', system-ui, sans-serif";
    g.fillText('PDF', w - 70, 45);
  });
  const documento = hoja(0.3, 0.39, docTex.t, '#EFE6D8');
  documento.position.set(0, 0.46 * fy, R + 0.1);
  documento.rotation.x = -0.35;

  const geoAvion = new THREE.BufferGeometry();
  geoAvion.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0.22, -0.13, 0, -0.1, 0, 0.012, -0.06, 0, 0, 0.22, 0, 0.012, -0.06, 0.13, 0, -0.1, 0, 0, 0.22, 0, 0.012, -0.06, 0, -0.06, -0.08], 3)
  );
  geoAvion.computeVertexNormals();
  const matAvion = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.7, side: THREE.DoubleSide, transparent: true });
  const avion = new THREE.Mesh(geoAvion, matAvion);
  avion.castShadow = true;
  avion.visible = false;
  avion.scale.setScalar(1.6);
  cuerpo.add(avion);
  const objetos = [libreta, lapiz, tarjetaOro, documento, avion];

  // Las fuentes de las tarjetas llegan tarde; se repintan al llegar.
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    (document as any).fonts.ready.then(() => {
      oroTex.dibujar();
      docTex.dibujar();
      pantalla.dibujar();
    });
  }

  /* ------------------------------------------------------------------ partículas */
  type Particula = { obj: THREE.Sprite | THREE.Mesh; vel: THREE.Vector3; vida: number; max: number; gira?: number; gravedad?: number };
  const particulas: Particula[] = [];
  const texTextos = new Map<string, THREE.Texture>();
  const texTexto = (txt: string, color: string) => {
    const k = txt + color;
    if (!texTextos.has(k)) {
      texTextos.set(
        k,
        lienzo(128, 128, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          g.font = "600 92px 'Fredoka', 'Figtree', system-ui, sans-serif";
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = color;
          g.fillText(txt, w / 2, h / 2 + 4);
        }).t
      );
    }
    return texTextos.get(k)!;
  };
  function soltarTexto(txt: string, color: string, desde: THREE.Vector3, vel: THREE.Vector3, vida = 2.2, tam = 0.28) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texTexto(txt, color), transparent: true, depthWrite: false }));
    s.scale.setScalar(tam);
    s.position.copy(desde);
    scene.add(s);
    particulas.push({ obj: s, vel, vida, max: vida, gira: (Math.random() - 0.5) * 1.2 });
  }

  /* ------------------------------------------------------------------ estado */
  const LUGAR: Record<Lugar, { x: number; z: number; ang: number; sx?: number; sz?: number; sy?: number }> = {
    centro: { x: 0, z: 0.55, ang: 0 },
    sillon: { x: SILLON.x, z: SILLON.z + 1.05, ang: 0, sx: SILLON.x, sz: SILLON.z + 0.12, sy: SILLON.asiento - BASE_Y * ESC },
    escritorio: { x: PUF.x - adelante.x * 0.75, z: PUF.z - adelante.z * 0.75 + 0.2, ang: ANG_ESCRITORIO, sx: PUF.x, sz: PUF.z, sy: PUF.asiento - BASE_Y * ESC },
  };
  const st = {
    x: -4.8, y: 0, z: 0.55, rotY: Math.PI / 2, rotObj: Math.PI / 2,
    fase: 0, caminando: false,
    lugar: 'fuera' as Lugar | 'suelo' | 'fuera',
    sentado: false, dormido: false, reloj: 0,
    gesto: null as Gesto, leer: 0,
    proxParpadeo: 2, parpadeo: 0, proxZeta: 0, proxNota: 0,
    mirarX: 0, mirarY: 0, apreton: 0,
    postura: (op.postura || 'pie') as Postura,
    finTareaEn: 0, volverEn: 0,
  };
  let face: FaceState = 'IDLE';
  let emocion: Emocion = 'neutral';
  let lip = 0;
  let lipTs = 0;
  const camara = { x: 0, y: 0, activa: false };
  const puntero = new THREE.Vector2();
  let tareaActiva: { t: Tarea; fase: 'trabajando' | 'contando'; lista: boolean; desde: number } | null = null;
  const P: Pose = { ...poseDe('neutral', 0) };

  const cola: Accion[] = [];
  const hacer = (...a: Accion[]) => cola.push(...a);
  const vaciar = () => {
    for (const a of cola) if (a.listo && a.fin) a.fin(a);
    cola.length = 0;
    st.caminando = false;
  };
  const avanzar = (dt: number) => {
    const a = cola[0];
    if (!a) return;
    if (!a.listo) {
      a.listo = true;
      a.t = 0;
      a.inicio?.(a);
    }
    a.t = (a.t || 0) + dt;
    if (a.update(dt, a)) {
      cola.shift();
      a.fin?.(a);
    }
  };
  const hecho = (fn: () => void): Accion => ({ update: () => (fn(), true) });
  const esperar = (s: number): Accion => ({ update: (_dt, a) => (a.t || 0) >= s });
  const caminarA = (x: number, z: number): Accion => ({
    update(dt) {
      if (reducido) {
        st.x = x;
        st.z = z;
        st.caminando = false;
        return true;
      }
      const dx = x - st.x;
      const dz = z - st.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.03) {
        st.x = x;
        st.z = z;
        st.caminando = false;
        return true;
      }
      st.rotObj = Math.atan2(dx, dz);
      const paso = Math.min(d, 1.2 * dt);
      st.x += (dx / d) * paso;
      st.z += (dz / d) * paso;
      st.caminando = true;
      return false;
    },
  });
  const girar = (ang: number): Accion => ({
    update() {
      st.rotObj = ang;
      if (reducido) st.rotY = ang;
      return Math.abs(Math.atan2(Math.sin(st.rotY - ang), Math.cos(st.rotY - ang))) < 0.05;
    },
  });
  const salto = (hx: number, hy: number, hz: number, alFin?: () => void): Accion => ({
    inicio(a) {
      a.d = { x: st.x, y: st.y, z: st.z };
    },
    update(_dt, a) {
      const d = a.d as { x: number; y: number; z: number };
      const k = reducido ? 1 : Math.min(1, (a.t || 0) / 0.7);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      st.x = d.x + (hx - d.x) * e;
      st.z = d.z + (hz - d.z) * e;
      st.y = d.y + (hy - d.y) * e + Math.sin(Math.PI * k) * 0.35;
      return k >= 1;
    },
    fin: () => alFin?.(),
  });

  const base = (): Lugar => (st.postura === 'sentada' ? 'sillon' : 'centro');
  function irA(dest: Lugar): Accion[] {
    if (st.lugar === dest) return [girar(LUGAR[dest].ang)];
    const pasos: Accion[] = [];
    if (st.lugar === 'sillon' || st.lugar === 'escritorio') {
      const L = LUGAR[st.lugar];
      if (st.lugar === 'escritorio') pasos.push(hecho(() => { tapaObj = 0; }));
      pasos.push(
        salto(L.x, 0, L.z, () => {
          st.sentado = false;
          st.lugar = 'suelo';
        })
      );
    }
    const D = LUGAR[dest];
    pasos.push(caminarA(D.x, D.z), girar(D.ang));
    if (D.sy !== undefined) {
      pasos.push(
        salto(D.sx!, D.sy, D.sz!, () => {
          st.sentado = true;
          st.lugar = dest;
        })
      );
    } else pasos.push(hecho(() => { st.lugar = dest; }));
    return pasos;
  }
  const cabeza = (alto: number) => new THREE.Vector3(st.x, st.y + (BASE_Y + alto) * ESC, st.z);

  /* ------------------------------------------------------------------ tareas */
  function guardarObjetos() {
    for (const o of objetos) o.visible = false;
    tapaObj = 0;
    st.gesto = null;
    st.leer = 0;
  }
  function terminarTarea() {
    tareaActiva = null;
    st.finTareaEn = 0;
    guardarObjetos();
    pantallaFase = -1;
    pantalla.dibujar();
  }
  function lanzarAvion(): Accion {
    return {
      inicio(a) {
        st.gesto = 'lanzar';
        avion.updateMatrixWorld(true);
        const desde = new THREE.Vector3();
        avion.getWorldPosition(desde);
        avion.visible = false;
        const vuelo = new THREE.Mesh(geoAvion, matAvion.clone());
        vuelo.scale.setScalar(ESC * 1.6);
        vuelo.position.copy(desde);
        scene.add(vuelo);
        Object.assign(a, { desde, vuelo, medio: new THREE.Vector3(0.6, 2.6, -0.2), hasta: VENTANA.clone().setZ(-2.4) });
      },
      update(_dt, a) {
        const t = a.t || 0;
        if (t > 0.25 && st.gesto === 'lanzar') st.gesto = null;
        const desde = a.desde as THREE.Vector3;
        const medio = a.medio as THREE.Vector3;
        const hasta = a.hasta as THREE.Vector3;
        const vuelo = a.vuelo as THREE.Mesh;
        const k = Math.min(1, t / 1.8);
        const q = 1 - k;
        const p = new THREE.Vector3().addScaledVector(desde, q * q).addScaledVector(medio, 2 * q * k).addScaledVector(hasta, k * k);
        const d = new THREE.Vector3().addScaledVector(medio.clone().sub(desde), 2 * q).addScaledVector(hasta.clone().sub(medio), 2 * k);
        vuelo.position.copy(p);
        vuelo.lookAt(p.clone().add(d));
        vuelo.rotateZ(Math.sin(t * 8) * 0.3);
        vuelo.scale.setScalar(ESC * 1.6 * (1 - k * 0.6));
        (vuelo.material as THREE.MeshStandardMaterial).opacity = k > 0.85 ? (1 - k) / 0.15 : 1;
        return k >= 1;
      },
      fin(a) {
        const vuelo = a.vuelo as THREE.Mesh | undefined;
        if (vuelo) {
          scene.remove(vuelo);
          (vuelo.material as THREE.Material).dispose();
        }
      },
    };
  }
  /** Lo que cambia en el gesto cuando la respuesta ya se está diciendo. */
  function gestoContando(t: Tarea) {
    switch (t) {
      case 'buscar':
        pantallaFase = 1;
        pantalla.dibujar();
        st.gesto = 'mirar-pantalla';
        hacer(esperar(0.7), hecho(() => { st.gesto = null; }), girar(ANG_ESCRITORIO + 0.9));
        break;
      case 'enviar':
        hacer(lanzarAvion());
        break;
      case 'anotar':
        lapiz.visible = false;
        st.gesto = 'sostener-libreta';
        break;
      case 'mirar':
        st.gesto = null;
        break;
      default:
        break;
    }
  }
  function empezarGesto(t: Tarea) {
    if (!tareaActiva || tareaActiva.t !== t) return;
    tareaActiva.lista = true;
    switch (t) {
      case 'buscar':
        tapaObj = 1;
        pantallaFase = 0;
        pantalla.dibujar();
        st.gesto = 'teclear';
        break;
      case 'enviar':
        avion.visible = true;
        st.gesto = 'preparar';
        break;
      case 'anotar':
        renglones = 0;
        libretaTex.dibujar();
        libreta.visible = true;
        lapiz.visible = true;
        st.gesto = 'escribir';
        break;
      case 'oro':
        tarjetaOro.visible = true;
        st.gesto = 'levantar';
        break;
      case 'leer':
        documento.visible = true;
        st.gesto = 'sostener-doc';
        break;
      case 'mirar':
        st.gesto = 'mirar';
        break;
    }
    if (tareaActiva.fase === 'contando') gestoContando(t);
  }
  function tarea(t: Tarea, texto = '') {
    if (st.dormido) st.dormido = false;
    vaciar();
    guardarObjetos();
    tareaActiva = { t, fase: 'trabajando', lista: false, desde: st.reloj };
    st.finTareaEn = 0;
    st.volverEn = 0;
    consulta = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'buscando…';
    const dest: Lugar = t === 'buscar' ? 'escritorio' : st.lugar === 'sillon' ? 'sillon' : base();
    hacer(...irA(dest), hecho(() => empezarGesto(t)));
  }

  /* ------------------------------------------------------------------ lo que dice la mesa */
  function alHablar() {
    st.finTareaEn = 0;
    st.volverEn = 0;
    const ta = tareaActiva;
    if (!ta || ta.fase === 'contando') return;
    ta.fase = 'contando';
    if (ta.lista) gestoContando(ta.t);
  }
  function alCallar() {
    if (tareaActiva) st.finTareaEn = st.reloj + 1.6;
    st.volverEn = st.reloj + 7;
  }
  function estado(f: FaceState, e: Emocion) {
    const antes = face;
    face = f;
    emocion = e;
    if (f === 'SLEEPING' && antes !== 'SLEEPING') {
      vaciar();
      terminarTarea();
      hacer(...irA('sillon'), hecho(() => { st.dormido = true; }));
      return;
    }
    if (antes === 'SLEEPING' && f !== 'SLEEPING') {
      st.dormido = false;
      st.volverEn = st.reloj + 2.5;
    }
    const habla = HABLA.has(f);
    const hablaba = HABLA.has(antes);
    if (habla && !hablaba) alHablar();
    if (!habla && hablaba) alCallar();
    if (f === 'LISTENING' || f === 'THINKING') st.volverEn = 0;
  }
  function entrar() {
    vaciar();
    terminarTarea();
    st.sentado = false;
    st.dormido = false;
    st.y = 0;
    if (reducido) {
      const B = base();
      Object.assign(st, { x: LUGAR.centro.x, z: LUGAR.centro.z, rotY: 0, rotObj: 0, lugar: 'centro' });
      if (B === 'sillon') hacer(...irA('sillon'));
      return;
    }
    Object.assign(st, { x: -4.8, z: 0.55, rotY: Math.PI / 2, rotObj: Math.PI / 2, lugar: 'fuera' });
    hacer(
      esperar(0.3),
      caminarA(0, 0.55),
      girar(0),
      hecho(() => {
        st.lugar = 'centro';
        st.gesto = 'saludo';
      }),
      esperar(1.8),
      hecho(() => {
        if (st.gesto === 'saludo') st.gesto = null;
        if (base() === 'sillon' && !tareaActiva) hacer(...irA('sillon'));
      })
    );
  }
  function postura(p: Postura) {
    st.postura = p;
    const ocupada = cola.length > 0 || !!tareaActiva || HABLA.has(face) || face === 'THINKING' || st.dormido;
    if (!ocupada && st.lugar !== base() && st.lugar !== 'fuera') hacer(...irA(base()));
  }

  /* ------------------------------------------------------------------ tocar y deslizar */
  const ray = new THREE.Raycaster();
  const aNdc = (e: PointerEvent) => {
    const r = lienzoGL.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  let toque: { x: number; y: number; t: number } | null = null;
  const alMover = (e: PointerEvent) => puntero.copy(aNdc(e));
  const alSalir = () => puntero.set(0, 0);
  const alBajar = (e: PointerEvent) => {
    toque = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const alSoltar = (e: PointerEvent) => {
    if (!toque) return;
    const dy = e.clientY - toque.y;
    const dx = e.clientX - toque.x;
    const rapido = performance.now() - toque.t < 700;
    toque = null;
    if (rapido && Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.3) {
      op.onDeslizar?.(dy < 0 ? 'arriba' : 'abajo');
      return;
    }
    if (Math.hypot(dx, dy) > 14) return;
    ray.setFromCamera(aNdc(e), camera);
    const golpe = ray.intersectObjects([piel, brazoI.children[0], brazoD.children[0]], false)[0];
    if (!golpe) return;
    const local = cuerpo.worldToLocal(golpe.point.clone());
    st.apreton = 0.3;
    op.onTocar?.(local.y > 0.95 * fy ? 'cabeza' : 'cuerpo');
  };
  lienzoGL.addEventListener('pointermove', alMover);
  lienzoGL.addEventListener('pointerleave', alSalir);
  lienzoGL.addEventListener('pointerdown', alBajar);
  lienzoGL.addEventListener('pointerup', alSoltar);

  /* ------------------------------------------------------------------ cámara y tamaño */
  let angosto = false;
  // Pantalla baja y ancha (un teléfono en horizontal): la sala entera cabe de sobra a lo ancho y
  // ella quedaba chiquita; la cámara se acerca y la acompaña un poco al moverse.
  let bajo = false;
  const mira = new THREE.Vector3(0.15, 1.0, 0);
  const medir = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    angosto = camera.aspect < 1.1;
    bajo = !angosto && h < 520 && camera.aspect > 1.6;
    camera.fov = angosto ? 46 : bajo ? 34 : 38;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(medir);
  ro.observe(host);
  medir();

  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const angLerp = (a: number, b: number, k: number) => {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * k;
  };
  const v3 = new THREE.Vector3();
  let anclaX = -1;
  let anclaY = -1;

  /* ------------------------------------------------------------------ cada cuadro */
  let raf = 0;
  let antes = performance.now();
  function cuadro(ahora: number) {
    raf = requestAnimationFrame(cuadro);
    const dt = Math.min(0.05, (ahora - antes) / 1000);
    antes = ahora;
    st.reloj += dt;
    const t = st.reloj;
    avanzar(dt);

    const habla = HABLA.has(face);
    if (tareaActiva && st.finTareaEn && t > st.finTareaEn && !habla) terminarTarea();
    if (tareaActiva && tareaActiva.fase === 'trabajando' && t - tareaActiva.desde > 30) terminarTarea();
    if (st.volverEn && t > st.volverEn && !cola.length && !tareaActiva && !habla && face !== 'THINKING' && face !== 'LISTENING' && !st.dormido) {
      st.volverEn = 0;
      if (st.lugar !== base() && st.lugar !== 'fuera') hacer(...irA(base()));
    }

    // ánimo: mientras camina hacia el sillón a dormir, se le cierran los ojos de a poco, no de golpe
    let animo = animoDe(face, emocion);
    if (animo === 'dormido' && !st.dormido) animo = 'cansado';
    const o = poseDe(animo, t);
    if (tareaActiva && animo === 'pensando') {
      // trabajando con las manos: nada de mano a la barbilla ni puntos encima
      o.bDx = POSE_REPOSO.bDx;
      o.bDz = POSE_REPOSO.bDz;
      o.puntos = false;
    }
    if (habla && o.boca !== 'triste') o.boca = 'abierta';
    if (st.sentado && !st.caminando) {
      o.bIz = Math.min(o.bIz, -0.55);
      o.bDz = Math.max(o.bDz, 0.55);
      o.brinco = false;
    }
    switch (st.gesto) {
      case 'saludo': o.bDz = 2.5 + Math.sin(t * 14) * 0.35; o.bDx = -0.2; break;
      case 'teclear': o.bIx = -1.25 + Math.sin(t * 24) * 0.12; o.bDx = -1.25 - Math.sin(t * 24) * 0.12; o.bIz = -0.12; o.bDz = 0.12; o.inclX = 0.12; o.ojoMY = -0.02; break;
      case 'mirar-pantalla': o.bIx = -1.1; o.bDx = -1.1; o.bIz = -0.12; o.bDz = 0.12; o.inclX = 0.1; o.ojoMY = -0.015; o.ojoS = 1.12; break;
      case 'preparar': o.bDx = 0.35; o.bDz = 2.2; o.inclZ = 0.12; o.inclX = -0.05; break;
      case 'lanzar': o.bDx = -2.3; o.bDz = 0.4; o.inclX = 0.12; break;
      case 'escribir': o.bIx = -1.2; o.bIz = 0.05; o.bDx = -1.05 + Math.sin(t * 18) * 0.08; o.bDz = -0.25 + Math.sin(t * 9) * 0.08; o.inclX = 0.1; o.ojoMY = -0.03; break;
      case 'sostener-libreta': o.bIx = -1.2; o.bIz = 0.05; break;
      case 'levantar': o.bIx = -2.3; o.bDx = -2.3; o.bIz = 0.1; o.bDz = -0.1; o.inclX = -0.06; break;
      case 'sostener-doc': o.bIx = -1.25; o.bDx = -1.25; o.bIz = 0.02; o.bDz = -0.02; o.inclX = 0.1; break;
      case 'mirar': o.inclX = -0.1; o.ojoS = 1.2; break;
      default: break;
    }
    if (habla && !st.gesto && !st.sentado && !st.caminando && animo !== 'canto' && animo !== 'oracion') {
      // explica con la mano mientras habla, de pie
      const s = Math.max(0, Math.sin(t * 3.2));
      o.bDz = Math.max(o.bDz, 0.55 + s * 0.6);
      o.bDx = Math.min(o.bDx, -0.5 - s * 0.35);
    }
    if (st.caminando) {
      o.bIx = Math.sin(st.fase) * 0.55;
      o.bDx = -Math.sin(st.fase) * 0.55;
      o.bIz = -0.25;
      o.bDz = 0.25;
      o.brinco = false;
    }
    if (st.gesto === 'sostener-doc' && tareaActiva?.fase === 'trabajando') st.leer = -(((t * 0.9) % 1) * 1.6) + 0.4;
    if (st.gesto === 'teclear' || st.gesto === 'mirar-pantalla') st.leer = Math.sin(t * 6) * 0.6;
    if (!st.gesto) st.leer = 0;

    const k = 1 - Math.pow(0.001, dt);
    P.ojoY = lerp(P.ojoY, o.ojoY, k);
    P.ojoS = lerp(P.ojoS, o.ojoS, k);
    P.ojoMY = lerp(P.ojoMY, o.ojoMY, k);
    P.guino = lerp(P.guino, o.guino, k);
    P.inclX = lerp(P.inclX, o.inclX, k);
    P.inclZ = lerp(P.inclZ, o.inclZ, k);
    P.escY = lerp(P.escY, o.escY, k);
    P.anilloV = lerp(P.anilloV, o.anilloV, k);
    P.anilloOp = lerp(P.anilloOp, o.anilloOp, k);
    P.bIz = lerp(P.bIz, o.bIz, k);
    P.bIx = lerp(P.bIx, o.bIx, k);
    P.bDz = lerp(P.bDz, o.bDz, k);
    P.bDx = lerp(P.bDx, o.bDx, k);
    P.mej = lerp(P.mej, o.mej, k);

    if (t > st.proxParpadeo) {
      st.parpadeo = 0.14;
      st.proxParpadeo = t + 2.2 + Math.random() * 3;
    }
    const cierre = st.parpadeo > 0 ? 0.1 : 1;
    st.parpadeo = Math.max(0, st.parpadeo - dt);
    st.apreton = Math.max(0, st.apreton - dt);

    const libre = !st.caminando && !st.dormido && !st.gesto && !st.sentado && Math.abs(st.rotObj) < 0.01;
    const objetivo = camara.activa ? camara : { x: puntero.x, y: puntero.y };
    st.mirarX = lerp(st.mirarX, !st.dormido && !st.caminando ? objetivo.x : 0, k * 0.6);
    st.mirarY = lerp(st.mirarY, !st.dormido && !st.caminando ? objetivo.y : 0, k * 0.6);

    st.rotY = angLerp(st.rotY, st.rotObj + (libre ? st.mirarX * 0.35 : 0), 1 - Math.pow(0.0005, dt));
    if (st.caminando) st.fase += dt * 9.5;
    const brinco = o.brinco && !reducido && !st.caminando && !st.gesto && !habla ? Math.abs(Math.sin(t * 7)) * 0.08 : 0;
    const bote = st.caminando && F.pies > 0 ? Math.abs(Math.sin(st.fase)) * 0.05 : 0; // sin pies no hay pasos: se desliza
    aura.position.set(st.x, st.y + brinco + bote, st.z);
    aura.rotation.y = st.rotY;

    const aprieta = st.apreton > 0 ? 1 - Math.sin((st.apreton / 0.3) * Math.PI) * 0.06 : 1;
    const resp = (1 + Math.sin(t * 2.2) * 0.015) * P.escY * aprieta;
    cuerpo.scale.set(1 / Math.sqrt(resp), resp, 1 / Math.sqrt(resp));
    if (F.flota) cuerpo.position.y = BASE_Y + F.flota + (reducido ? 0 : Math.sin(t * 1.6) * 0.025);
    cuerpo.rotation.x = P.inclX - (libre ? st.mirarY * 0.08 : 0);
    cuerpo.rotation.z = P.inclZ + (st.caminando ? Math.sin(st.fase) * 0.06 : 0);
    brazoI.rotation.set(P.bIx, 0, P.bIz);
    brazoD.rotation.set(P.bDx, 0, P.bDz);

    const mx = st.mirarX * 0.02 + st.leer * 0.03;
    // Los ojos de luz son altos: medio cerrados todavía parecen abiertos, así que cierran más.
    const cierraLuz = F.ojosLuz ? Math.min(1, P.ojoY * cierre * 1.25) : 1;
    ojoI.scale.set(P.ojoS, P.ojoS * P.ojoY * cierre * P.guino * cierraLuz, P.ojoS);
    ojoD.scale.set(P.ojoS, P.ojoS * P.ojoY * cierre * cierraLuz, P.ojoS);
    ojoI.position.copy(enSuperficie(-F.ojoSep + mx, OJO_Y + P.ojoMY + st.mirarY * 0.015, ojoFuera));
    ojoD.position.copy(enSuperficie(F.ojoSep + mx, OJO_Y + P.ojoMY + st.mirarY * 0.015, ojoFuera));
    if (F.mejillas) for (const m of mejillas) (m.material as THREE.MeshBasicMaterial).opacity = P.mej;

    bocaSonrisa.visible = o.boca === 'sonrisa';
    bocaTriste.visible = o.boca === 'triste';
    bocaAbierta.visible = o.boca === 'abierta';
    bocaO.visible = o.boca === 'o';
    bocaLinea.visible = o.boca === 'linea';
    if (bocaAbierta.visible) {
      // la boca sigue el audio de verdad; si nadie manda nivel (el teléfono a veces no), se mueve sola
      const conAudio = performance.now() - lipTs < 350;
      const amp = habla
        ? conAudio
          ? 0.25 + lip * 1.1
          : 0.35 + Math.abs(Math.sin(t * 17) * Math.sin(t * 5.3)) * 0.9
        : animo === 'canto'
          ? 0.7 + Math.sin(t * 6) * 0.3
          : 0.9;
      bocaAbierta.scale.set(1, 0.7 * Math.min(1.3, amp), 0.35);
    }

    if (lapiz.visible) {
      brazoD.updateMatrix();
      lapiz.position.copy(new THREE.Vector3(0.04, -0.33, 0.02).applyMatrix4(brazoD.matrix));
      lapiz.rotation.set(-0.9, 0, -0.5);
    }
    if (avion.visible) {
      brazoD.updateMatrix();
      avion.position.copy(new THREE.Vector3(0.04, -0.36, 0.06).applyMatrix4(brazoD.matrix));
      avion.rotation.set(-0.3, 0.3, 0);
    }
    if (st.gesto === 'escribir') {
      const n = Math.min(5, Math.floor((t - (tareaActiva?.desde || t)) / 0.5));
      if (n !== renglones) {
        renglones = n;
        libretaTex.dibujar();
      }
    }

    const pieZ = st.sentado ? 0.36 : 0.05;
    const pieY = st.sentado ? 0.02 : 0.07;
    for (const [p, lado, desfase] of [[pieI, -1, 0], [pieD, 1, Math.PI]] as const) {
      const s = Math.sin(st.fase + desfase);
      p.position.set(lado * 0.2, pieY + (st.caminando ? Math.max(0, s) * 0.1 : 0) + (st.sentado ? Math.sin(t * 2 + desfase) * 0.02 : 0), pieZ + (st.caminando ? s * 0.13 : 0));
    }

    anilloGiro.rotation.y += dt * P.anilloV;
    matAnillo.opacity = P.anilloOp;
    matHalo.opacity = C.haloOp * P.anilloOp * (0.8 + Math.sin(t * 2) * 0.2);

    tapaAbierta = lerp(tapaAbierta, tapaObj, 1 - Math.pow(0.01, dt));
    bisagra.rotation.x = -Math.PI / 2 + tapaAbierta * (Math.PI / 2 - 0.3);
    matPantalla.color.setScalar(0.25 + tapaAbierta * 0.75);

    if (o.zetas && st.dormido && t > st.proxZeta) {
      soltarTexto('z', C.texto, cabeza(1.3).add(new THREE.Vector3(0.3, 0, 0)), new THREE.Vector3(0.15, 0.35, 0), 2.6, 0.26);
      st.proxZeta = t + 1.1;
    }
    if (o.notas && t > st.proxNota) {
      soltarTexto(Math.random() < 0.5 ? '♪' : '♫', C.anillo, cabeza(1.2).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, 0.2)), new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.5, 0), 2, 0.3);
      st.proxNota = t + 0.45;
    }
    if (o.puntos && !st.gesto && t > st.proxNota) {
      soltarTexto('…', C.texto, cabeza(1.35).add(new THREE.Vector3(0.35, 0, 0)), new THREE.Vector3(0.05, 0.12, 0), 1.2, 0.32);
      st.proxNota = t + 1.2;
    }
    for (let i = particulas.length - 1; i >= 0; i--) {
      const q = particulas[i];
      q.vida -= dt;
      if (q.gravedad) q.vel.y -= q.gravedad * dt;
      q.obj.position.addScaledVector(q.vel, dt);
      const mat = q.obj.material as THREE.SpriteMaterial;
      mat.opacity = Math.min(1, Math.max(0, q.vida / q.max) * 1.6);
      if (q.gira) mat.rotation += q.gira * dt;
      if (q.vida <= 0) {
        scene.remove(q.obj);
        mat.dispose();
        particulas.splice(i, 1);
      }
    }

    const objX = angosto ? Math.max(-1.7, Math.min(SILLON.x, st.x)) : bajo ? Math.max(-0.8, Math.min(1.0, st.x * 0.5)) : 0.15;
    mira.x = lerp(mira.x, objX, 1 - Math.pow(0.02, dt));
    mira.y = bajo ? 0.9 : 1.0;
    camera.position.set(mira.x, angosto ? 1.9 : bajo ? 1.5 : 1.7, angosto ? 7.4 : bajo ? 5.3 : 6.6);
    camera.lookAt(mira);

    // dónde está su cabeza en pantalla, para que la burbuja le salga de ahí
    v3.copy(cabeza(ALTO + 0.25)).project(camera);
    const w = host.clientWidth;
    const h = host.clientHeight;
    const ax = Math.round(((v3.x + 1) / 2) * w);
    const ay = Math.round(((1 - v3.y) / 2) * h);
    if (Math.abs(ax - anclaX) > 1 || Math.abs(ay - anclaY) > 1) {
      anclaX = ax;
      anclaY = ay;
      host.style.setProperty('--aura-x', `${ax}px`);
      host.style.setProperty('--aura-y', `${ay}px`);
    }

    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(cuadro);

  return {
    estado,
    boca(n) {
      lip = Math.max(0, Math.min(1, Number(n) || 0));
      lipTs = performance.now();
    },
    mirar(x, y, activa) {
      camara.x = Math.max(-1, Math.min(1, x));
      camara.y = Math.max(-1, Math.min(1, y));
      camara.activa = !!activa;
    },
    tarea,
    postura,
    entrar,
    destruir() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      lienzoGL.removeEventListener('pointermove', alMover);
      lienzoGL.removeEventListener('pointerleave', alSalir);
      lienzoGL.removeEventListener('pointerdown', alBajar);
      lienzoGL.removeEventListener('pointerup', alSoltar);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) mat.dispose();
      });
      for (const tx of texturas) tx.dispose();
      renderer.dispose();
      lienzoGL.remove();
    },
  };
}

const POSE_REPOSO = poseDe('neutral', 0);
