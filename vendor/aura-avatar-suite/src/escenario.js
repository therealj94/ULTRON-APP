import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {Controlador} from './controlador.js';

// Escenario premium para los GLB móviles: tono ACES (o AgX), entorno PMREM suave, luz principal
// cálida + relleno frío + contraluces (oro y frío), sombra de contacto suave y un brillo (bloom)
// que solo toca lo que emite luz (ojos de AU-RA, luces de la órbita). El bloom es propio y
// respeta la transparencia: el personaje se puede poner encima de la interfaz (tema oscuro
// #1C1D20 / claro #F7F3EC). En calidad baja no hay bloom ni MSAA de render target.

const VS='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const BRILLO=`uniform sampler2D t;uniform float umbral;varying vec2 vUv;
void main(){vec4 c=texture2D(t,vUv);float l=max(max(c.r,c.g),c.b);float croma=(l-min(min(c.r,c.g),c.b))/max(l,1e-4);
// Solo lo que brilla con color (ojos dorados, luces): los reflejos blancos del barniz no florecen.
float k=smoothstep(umbral,umbral*1.5,l)*smoothstep(.35,.7,croma);gl_FragColor=vec4(c.rgb*k,1.);}`;
const DESENFOQUE=`uniform sampler2D t;uniform vec2 dir;varying vec2 vUv;
void main(){vec3 s=texture2D(t,vUv).rgb*.227;
s+=(texture2D(t,vUv+dir*1.385).rgb+texture2D(t,vUv-dir*1.385).rgb)*.316;
s+=(texture2D(t,vUv+dir*3.231).rgb+texture2D(t,vUv-dir*3.231).rgb)*.070;gl_FragColor=vec4(s,1.);}`;
const COMPONER=`uniform sampler2D escena;uniform sampler2D b1;uniform sampler2D b2;uniform float fuerza;uniform float expo;uniform int modo;varying vec2 vUv;
vec3 aces(vec3 c){c*=expo/.6;const mat3 I=mat3(vec3(.59719,.07600,.02840),vec3(.35458,.90834,.13383),vec3(.04823,.01566,.83777));const mat3 O=mat3(vec3(1.60475,-.10208,-.00327),vec3(-.53108,1.10813,-.07276),vec3(-.07367,-.00605,1.07602));c=I*c;vec3 a=c*(c+.0245786)-.000090537;vec3 b=c*(.983729*c+.4329510)+.238081;return clamp(O*(a/b),0.,1.);}
vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
void main(){vec4 e=texture2D(escena,vUv);vec3 bl=(texture2D(b1,vUv).rgb*.6+texture2D(b2,vUv).rgb*1.6)*fuerza;
vec3 col=e.rgb+bl;float a=clamp(e.a+max(max(bl.r,bl.g),bl.b)*.9,0.,1.);
vec3 m=aces(col);gl_FragColor=vec4(srgb(m),a);}`;

function sombraBlob(){
 const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
 const g=x.createRadialGradient(128,128,2,128,128,126);g.addColorStop(0,'rgba(0,0,0,.62)');g.addColorStop(.35,'rgba(0,0,0,.34)');g.addColorStop(.7,'rgba(0,0,0,.09)');g.addColorStop(1,'rgba(0,0,0,0)');
 x.fillStyle=g;x.fillRect(0,0,256,256);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}

export function crearEscenario(lienzo,{transparente=true,fondo='#1c1d20',calidad='alta',bloom=true,tono='aces',sombra=true,dpr=null,luz='estudio'}={}){
 const comoApp=luz==='app'; // réplica exacta de la luz de src/12-avatar3d/escena.ts
 const alta=calidad!=='baja',conBloom=alta&&bloom;
 const renderer=new T.WebGLRenderer({canvas:lienzo,antialias:!conBloom,alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(dpr||Math.min(window.devicePixelRatio||1,alta?2:1.5));
 renderer.info.autoReset=false;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=tono==='agx'?T.AgXToneMapping:T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
 const escena=new T.Scene();const camara=new T.PerspectiveCamera(28,1,.02,60);
 // Entorno RoomEnvironment más difuso que el de la app (sigma 0,12): reflejos suaves, sin franjas duras.
 const pmrem=new T.PMREMGenerator(renderer);const sala=new RoomEnvironment();const entorno=pmrem.fromScene(sala,comoApp?.04:.12);escena.environment=entorno.texture;escena.environmentIntensity=.55;sala.dispose();pmrem.dispose();
 escena.add(comoApp?new T.HemisphereLight(0xfff7ee,0x3a3530,.7):new T.HemisphereLight('#fff7ee','#8c7a68',.62));
 // Rebote cálido desde abajo y adelante (como un piso claro de estudio): levanta las partes que miran al suelo.
 if(!comoApp){const rebote=new T.DirectionalLight('#ffe6cf',.5);rebote.position.set(.4,-1.2,2.2);rebote.target.position.set(0,1.1,0);escena.add(rebote,rebote.target);}
 const principal=new T.DirectionalLight('#fff1e0',comoApp?1.6:2.0);principal.position.set(1.2,2.4,2.6);
 const relleno=new T.DirectionalLight('#c3d2ff',comoApp?0:.5);relleno.position.set(-2.4,1.6,1.8);
 const contraOro=new T.DirectionalLight(comoApp?'#d6b56c':'#e2bf73',comoApp?.9:1.25);contraOro.position.set(-2,2.2,-2.2);
 const contraFrio=new T.DirectionalLight('#b7c8ff',comoApp?0:.55);contraFrio.position.set(2.2,2,-2.2);
 for(const l of [principal,relleno,contraOro,contraFrio]){l.target.position.set(0,1.1,0);escena.add(l,l.target);}
 const blob=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:sombraBlob(),transparent:true,depthWrite:false,toneMapped:false}));blob.rotation.x=-Math.PI/2;blob.renderOrder=-1;blob.visible=sombra;escena.add(blob);
 const fondoColor=new T.Color(fondo);
 const aplicarFondo=()=>renderer.setClearColor(fondoColor,transparente?0:1);aplicarFondo();

 // Bloom propio (escena HDR → brillo → 2 niveles de desenfoque → composición con tono y alfa).
 let rt=null,ra=null,rb=null,rc=null,rd=null;const quad=new T.Mesh(new T.PlaneGeometry(2,2));const qEsc=new T.Scene();qEsc.add(quad);const qCam=new T.OrthographicCamera(-1,1,1,-1,0,1);
 const mBrillo=new T.ShaderMaterial({vertexShader:VS,fragmentShader:BRILLO,uniforms:{t:{value:null},umbral:{value:1.05}},depthTest:false});
 const mBlur=new T.ShaderMaterial({vertexShader:VS,fragmentShader:DESENFOQUE,uniforms:{t:{value:null},dir:{value:new T.Vector2()}},depthTest:false});
 const mComp=new T.ShaderMaterial({vertexShader:VS,fragmentShader:COMPONER,uniforms:{escena:{value:null},b1:{value:null},b2:{value:null},fuerza:{value:.32},expo:{value:1},modo:{value:0}},depthTest:false,transparent:false,blending:T.NoBlending});
 function objetivos(w,h){
  for(const r of [rt,ra,rb,rc,rd])r?.dispose();
  const op={type:T.HalfFloatType,colorSpace:T.LinearSRGBColorSpace};
  rt=new T.WebGLRenderTarget(w,h,{...op,samples:4});ra=new T.WebGLRenderTarget(w>>1,h>>1,op);rb=new T.WebGLRenderTarget(w>>1,h>>1,op);rc=new T.WebGLRenderTarget(w>>2,h>>2,op);rd=new T.WebGLRenderTarget(w>>2,h>>2,op);
 }
 const pasar=(mat,destino)=>{quad.material=mat;renderer.setRenderTarget(destino);renderer.render(qEsc,qCam);};
 const negro=new T.MeshBasicMaterial({color:0x000000});const guardados=new Map();
 const emite=m=>m&&m.emissiveMap&&m.emissiveIntensity>0;
 function cambiarMateriales(activar){
  if(activar){blob.visible=false;modelo?.traverse(o=>{if(!o.isMesh||!o.visible)return;guardados.set(o,o.material);o.material=Array.isArray(o.material)?o.material.map(m=>emite(m)?m:negro):(emite(o.material)?o.material:negro);});}
  else{for(const [o,m] of guardados)o.material=m;guardados.clear();blob.visible=sombra;}
 }

 let ancho=1,alto=1,ctrl=null,modelo=null,caja=new T.Box3();
 function tamano(w,h){ancho=Math.max(1,w|0);alto=Math.max(1,h|0);renderer.setSize(ancho,alto,false);camara.aspect=ancho/alto;camara.updateProjectionMatrix();if(conBloom){const px=renderer.getPixelRatio();objetivos(Math.round(ancho*px),Math.round(alto*px));}}
 function dibujar(){
  renderer.info.reset(); // cuenta todas las pasadas del cuadro (escena + bloom)
  if(!conBloom){renderer.setRenderTarget(null);renderer.render(escena,camara);return;}
  const tm=renderer.toneMapping;renderer.toneMapping=T.NoToneMapping;
  renderer.setRenderTarget(rt);renderer.setClearColor(0x000000,0);renderer.clear();renderer.render(escena,camara);
  // Fuente del bloom: SOLO lo emisivo (ojos, luces); lo demás se dibuja negro para que tape.
  cambiarMateriales(true);renderer.setRenderTarget(ra);renderer.setClearColor(0x000000,0);renderer.clear();renderer.render(escena,camara);cambiarMateriales(false);
  mBlur.uniforms.t.value=ra.texture;mBlur.uniforms.dir.value.set(1/ra.width,0);pasar(mBlur,rb);mBlur.uniforms.t.value=rb.texture;mBlur.uniforms.dir.value.set(0,1/ra.height);pasar(mBlur,ra);
  mBlur.uniforms.t.value=ra.texture;mBlur.uniforms.dir.value.set(1/rc.width,0);pasar(mBlur,rc);mBlur.uniforms.t.value=rc.texture;mBlur.uniforms.dir.value.set(0,1/rc.height);pasar(mBlur,rd);
  mComp.uniforms.escena.value=rt.texture;mComp.uniforms.b1.value=ra.texture;mComp.uniforms.b2.value=rd.texture;mComp.uniforms.expo.value=renderer.toneMappingExposure;
  renderer.toneMapping=tm;aplicarFondo();
  if(!transparente){renderer.setRenderTarget(null);renderer.setClearColor(fondoColor,1);renderer.clear();mComp.transparent=true;mComp.blending=T.NormalBlending;mComp.premultipliedAlpha=true;}
  else{mComp.transparent=false;mComp.blending=T.NoBlending;}
  quad.material=mComp;renderer.setRenderTarget(null);renderer.autoClear=transparente;renderer.render(qEsc,qCam);renderer.autoClear=true;
 }
 async function cargar(buffer){
  if(modelo){escena.remove(modelo);ctrl?.dispose();}
  const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
  const t0=performance.now();const gltf=await loader.parseAsync(buffer,'');const tCarga=performance.now()-t0;
  modelo=gltf.scene;escena.add(modelo);ctrl=new Controlador(gltf);ctrl.fijar(0);
  caja.setFromObject(modelo,true);
  const huella=Math.max(caja.max.x-caja.min.x,caja.max.z-caja.min.z);blob.scale.set(huella*1.25,huella*1.0,1);blob.position.set((caja.min.x+caja.max.x)/2,.002,(caja.min.z+caja.max.z)/2);
  // Si flota lejos del suelo, la sombra se abre y se aclara.
  const altura=caja.min.y;blob.material.opacity=altura>.4?.45:1;if(altura>.4)blob.scale.multiplyScalar(1.4);
  encuadrar('cuerpo');return {ctrl,gltf,tCarga};
 }
 /** Encuadre: 'cuerpo' | 'retrato' | {objetivo:[x,y,z], distancia, angulo (grados, 0 = frente), alto}. */
 function encuadrar(e){
  if(!modelo)return;
  let obj,dist,ang=0,alt=0;
  if(e==='cuerpo'||e==='retrato'){
   const nodo=modelo.getObjectByName(e==='retrato'?'camara_retrato':'camara_cuerpo');
   if(nodo){const w=new T.Vector3();nodo.getWorldPosition(w);obj=[w.x,w.y,0];dist=w.z;}
   else{const c=caja.getCenter(new T.Vector3());obj=[c.x,c.y,c.z];dist=(caja.max.y-caja.min.y)*1.1/2/Math.tan(T.MathUtils.degToRad(14));}
   // En pantallas angostas, que el ancho también quepa.
   if(e==='cuerpo'&&camara.aspect<.62)dist*=Math.min(1.35,.62/camara.aspect*.92);
  }else{obj=e.objetivo;dist=e.distancia;ang=e.angulo||0;alt=e.alto||0;}
  const r=T.MathUtils.degToRad(ang);camara.position.set(obj[0]+Math.sin(r)*dist,obj[1]+alt,obj[2]+Math.cos(r)*dist);camara.lookAt(obj[0],obj[1],obj[2]);
  camara.near=Math.max(.01,dist/60);camara.far=dist*8+4;camara.updateProjectionMatrix();
 }
 function stats(){let tri=0,mallas=0;modelo?.traverse(o=>{if(o.isMesh&&o.visible){mallas++;tri+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;}});return {triangulos:Math.round(tri),mallas,llamadas:renderer.info.render.calls};}
 function setFondo(c,trans=transparente){fondoColor.set(c);transparente=trans;aplicarFondo();}
 function dispose(){ctrl?.dispose();for(const r of [rt,ra,rb,rc,rd])r?.dispose();entorno.dispose();renderer.dispose();}
 return {renderer,escena,camara,cargar,encuadrar,dibujar,tamano,stats,setFondo,dispose,get ctrl(){return ctrl;},get modelo(){return modelo;},luces:{principal,relleno,contraOro,contraFrio},blob,get caja(){return caja;},conBloom};
}
