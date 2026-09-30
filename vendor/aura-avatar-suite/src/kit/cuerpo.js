import * as T from 'three';
import {MeshBVH} from 'three-mesh-bvh';

// Constructor de personajes móviles: esqueleto con nombres VRM, piezas con piel (skin) suave o
// rígida, colores por vértice (lineales), oclusión ambiental horneada, y UNA malla de cara con
// todos los morph targets. El resultado es lo que pide mobile/docs/avatar-3d-especificacion.md:
// pocas primitivas, blendshapes solo en la cabeza y huesos con rotación identidad en reposo (los
// clips giran alrededor de ejes del mundo, igual en los tres personajes).

const colorLineal=c=>{const k=new T.Color(c);return [k.r,k.g,k.b];}; // THREE.Color convierte sRGB → lineal
export const rgb=colorLineal;
export const mezclaColor=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

export class Esqueleto{
 /** def: [{n, p (padre), x: [x,y,z] posición en el mundo}] en orden padre→hijo. */
 constructor(def){
  this.huesos=new Map();this.mundo=new Map();this.lista=[];
  for(const d of def){
   const b=new T.Bone();b.name=d.n;const w=new T.Vector3(...d.x);this.mundo.set(d.n,w);
   if(d.p){const padre=this.huesos.get(d.p);if(!padre)throw Error('Hueso sin padre: '+d.n);b.position.copy(w).sub(this.mundo.get(d.p));padre.add(b);}
   else b.position.copy(w);
   this.huesos.set(d.n,b);this.lista.push(b);
  }
  this.raiz=this.lista[0];
 }
 pos(n){const v=this.mundo.get(n);if(!v)throw Error('No existe el hueso '+n);return v.clone();}
 tiene(n){return this.huesos.has(n);}
}

/** Pesos suaves a lo largo de un segmento: mezcla de hueso a con b alrededor de la articulación. */
export function pesosArticulacion(a,b,pA,pB,{ancho=.35}={}){
 const A=new T.Vector3(...pA),B=new T.Vector3(...pB),AB=B.clone().sub(A),L2=AB.lengthSq();
 return p=>{const t=new T.Vector3(p.x,p.y,p.z).sub(A).dot(AB)/L2;const w=Math.min(1,Math.max(0,(t-(1-ancho/2))/ancho));const s=w*w*(3-2*w);return [[a,1-s],[b,s]];};
}

export class Constructor{
 constructor(esqueleto,materiales){this.esq=esqueleto;this.mat=materiales;this.piezas=[];}
 /**
  * Agrega una pieza ya ubicada en la pose de reposo (coordenadas del mundo).
  *  hueso: nombre (piel rígida) · pesos: p→[[hueso,peso],…] (piel suave)
  *  color: '#hex' | [r,g,b] lineal | (p,n)→[r,g,b] lineal · cara: true va a la malla con morphs
  *  etiqueta: texto que ven los campos de morph · ao: recibe oclusión · ocluye: proyecta oclusión
  */
 agregar(geo,{material,hueso=null,pesos=null,color='#ffffff',cara=false,etiqueta='',ao=true,ocluye=true,uvEscala=1,datos=null}={}){
  if(!this.mat[material])throw Error('Material desconocido: '+material);
  if(!hueso&&!pesos)throw Error('La pieza necesita hueso o pesos');
  if(hueso&&!this.esq.tiene(hueso))throw Error('No existe el hueso '+hueso);
  const g=geo.index?geo:geo;if(!g.attributes.normal)g.computeVertexNormals();
  if(datos&&datos.length!==g.attributes.position.count)throw Error('datos por vértice desalineados');
  this.piezas.push({g,material,hueso,pesos,color,cara,etiqueta,ao,ocluye,uvEscala:Array.isArray(uvEscala)?uvEscala:[uvEscala,uvEscala],datos});return this;
 }

 /** Une piezas en arreglos por conjunto (cuerpo/cara) y material. */
 _juntar(){
  const conjuntos={cuerpo:new Map(),cara:new Map()};
  for(const pz of this.piezas){
   const c=conjuntos[pz.cara?'cara':'cuerpo'];if(!c.has(pz.material))c.set(pz.material,[]);c.get(pz.material).push(pz);
  }
  const salida={};
  for(const [nombre,mapa] of Object.entries(conjuntos)){
   const pos=[],nor=[],uv=[],col=[],si=[],sw=[],idx=[],etq=[],grupos=[],aoRec=[],oclu=[],dat=[];
   for(const [material,lista] of mapa){
    const inicio=idx.length;
    for(const pz of lista){
     const g=pz.g,p=g.attributes.position,n=g.attributes.normal,u=g.attributes.uv,base=pos.length/3,v=new T.Vector3(),w=new T.Vector3();
     const fijo=typeof pz.color==='function'?null:(Array.isArray(pz.color)?pz.color:colorLineal(pz.color));
     for(let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i);w.fromBufferAttribute(n,i);
      pos.push(v.x,v.y,v.z);nor.push(w.x,w.y,w.z);
      if(u)uv.push(u.getX(i)*pz.uvEscala[0],u.getY(i)*pz.uvEscala[1]);else uv.push(0,0);
      const c=fijo||pz.color(v,w,i);col.push(c[0],c[1],c[2]);
      let pw=pz.hueso?[[pz.hueso,1]]:pz.pesos(v,w,i);
      pw=pw.filter(x=>x[1]>1e-4).sort((a,b)=>b[1]-a[1]).slice(0,4);let s=pw.reduce((a,x)=>a+x[1],0)||1;
      const ix=[0,0,0,0],wx=[0,0,0,0];pw.forEach(([h,peso],k)=>{if(!this.esq.tiene(h))throw Error('No existe el hueso '+h);ix[k]=this.esq.lista.indexOf(this.esq.huesos.get(h));wx[k]=peso/s;});
      si.push(...ix);sw.push(...wx);etq.push(pz.etiqueta);aoRec.push(pz.ao);oclu.push(pz.ocluye);dat.push(pz.datos?pz.datos[i]:null);
     }
     const ind=g.index?g.index.array:[...Array(p.count).keys()];for(const k of ind)idx.push(base+k);
    }
    grupos.push({material,inicio,cuenta:idx.length-inicio});
   }
   salida[nombre]={pos,nor,uv,col,si,sw,idx,etq,grupos,aoRec,oclu,dat};
  }
  return salida;
 }

 /** Oclusión ambiental por vértice con rayos contra todo el personaje (horneada en el color). */
 static hornearAO(conjs,{rayos=24,distancia=.09,fuerza=.75,semilla=7}={}){
  // Geometría de oclusores (todo lo que ocluye, de ambos conjuntos).
  const pos=[],idx=[];
  for(const c of Object.values(conjs)){const base=pos.length/3;for(let i=0;i<c.pos.length/3;i++)pos.push(c.pos[i*3],c.pos[i*3+1],c.pos[i*3+2]);for(let t=0;t<c.idx.length;t+=3){const a=c.idx[t],b=c.idx[t+1],d=c.idx[t+2];if(c.oclu[a]&&c.oclu[b]&&c.oclu[d])idx.push(base+a,base+b,base+d);}}
  if(!idx.length)return;
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);
  const bvh=new MeshBVH(g);const ray=new T.Ray(),o=new T.Vector3(),n=new T.Vector3(),d=new T.Vector3(),t1=new T.Vector3(),t2=new T.Vector3();
  let s=semilla;const rnd=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  // Direcciones fijas (hemisferio coseno) para que el resultado sea reproducible.
  const dirs=[];for(let k=0;k<rayos;k++){const u=(k+.5)/rayos,a=k*2.39996323,r=Math.sqrt(u);dirs.push([r*Math.cos(a),r*Math.sin(a),Math.sqrt(1-u)]);}
  for(const c of Object.values(conjs)){
   for(let i=0;i<c.pos.length/3;i++){
    if(!c.aoRec[i])continue;
    n.set(c.nor[i*3],c.nor[i*3+1],c.nor[i*3+2]).normalize();o.set(c.pos[i*3],c.pos[i*3+1],c.pos[i*3+2]).addScaledVector(n,.0015);
    t1.set(Math.abs(n.x)>.9?0:1,Math.abs(n.x)>.9?1:0,0).cross(n).normalize();t2.crossVectors(n,t1);
    const giro=rnd()*TAU;let tapado=0;
    for(const [x,y,z] of dirs){const cg=Math.cos(giro),sg=Math.sin(giro),xx=x*cg-y*sg,yy=x*sg+y*cg;d.copy(t1).multiplyScalar(xx).addScaledVector(t2,yy).addScaledVector(n,z).normalize();ray.set(o,d);const hit=bvh.raycastFirst(ray,T.DoubleSide);if(hit&&hit.distance<distancia)tapado+=1-hit.distance/distancia*.6;}
    const ao=1-fuerza*Math.min(1,tapado/rayos);
    c.col[i*3]*=ao;c.col[i*3+1]*=ao;c.col[i*3+2]*=ao;
   }
  }
 }

 /**
  * Arma las mallas finales. `morphs`: {nombres:[…], campo(nombre, info)→[dx,dy,dz]|null} donde
  * info = {p, n, etiqueta, i}. Devuelve {raiz, cuerpo, cara, esqueleto}.
  */
 construir({nombre='AVATAR',morphs=null,ao=null}={}){
  const conjs=this._juntar();
  if(ao)Constructor.hornearAO(conjs,ao);
  const raiz=new T.Group();raiz.name=nombre;raiz.add(this.esq.raiz);raiz.updateMatrixWorld(true);
  const skeleton=new T.Skeleton(this.esq.lista);
  const mallas={};
  for(const [clave,c] of Object.entries(conjs)){
   if(!c.idx.length)continue;
   const g=new T.BufferGeometry();
   g.setAttribute('position',new T.Float32BufferAttribute(c.pos,3));g.setAttribute('normal',new T.Float32BufferAttribute(c.nor,3));
   g.setAttribute('uv',new T.Float32BufferAttribute(c.uv,2));g.setAttribute('color',new T.Float32BufferAttribute(c.col,3));
   g.setAttribute('skinIndex',new T.Uint16BufferAttribute(c.si,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(c.sw,4));
   g.setIndex(c.idx);for(const gr of c.grupos)g.addGroup(gr.inicio,gr.cuenta,c.grupos.indexOf(gr));
   const mats=c.grupos.map(gr=>this.mat[gr.material]);
   if(clave==='cara'&&morphs){
    g.morphAttributes.position=[];g.morphTargetsRelative=true;
    const p=new T.Vector3(),n=new T.Vector3();
    for(const nm of morphs.nombres){
     const d=new Float32Array(c.pos.length);
     for(let i=0;i<c.pos.length/3;i++){p.set(c.pos[i*3],c.pos[i*3+1],c.pos[i*3+2]);n.set(c.nor[i*3],c.nor[i*3+1],c.nor[i*3+2]);const r=morphs.campo(nm,{p,n,etiqueta:c.etq[i],dato:c.dat[i],i});if(r){d[i*3]=r[0];d[i*3+1]=r[1];d[i*3+2]=r[2];}}
     const a=new T.Float32BufferAttribute(d,3);a.name=nm;g.morphAttributes.position.push(a);
     if(morphs.campoNormal){const dn=new Float32Array(c.pos.length);for(let i=0;i<c.pos.length/3;i++){const r=morphs.campoNormal(nm,{etiqueta:c.etq[i],dato:c.dat[i],i});if(r){dn[i*3]=r[0];dn[i*3+1]=r[1];dn[i*3+2]=r[2];}}(g.morphAttributes.normal??=[]).push(new T.Float32BufferAttribute(dn,3));}
    }
   }
   if(mats.some(x=>x.normalMap))tangentes(g);
   const m=new T.SkinnedMesh(g,mats.length===1?mats[0]:mats);m.name=clave;m.frustumCulled=false;
   if(clave==='cara'&&morphs)m.updateMorphTargets();
   raiz.add(m);m.bind(skeleton,new T.Matrix4());mallas[clave]=m;
   // Las etiquetas por vértice quedan fuera de userData (el exportador lo escribiría en el JSON).
   ETIQUETAS.set(m,c.etq);
  }
  return {raiz,esqueleto:skeleton,...mallas};
 }
}

const TAU=Math.PI*2;
/** Etiquetas por vértice de cada malla construida (depuración), fuera del GLB. */
export const ETIQUETAS=new WeakMap();

/** Tangentes para los mapas normales (el validador pide espacio tangente explícito); sanea los degenerados. */
function tangentes(g){
 g.computeTangents();const t=g.attributes.tangent,n=g.attributes.normal,v=new T.Vector3(),w=new T.Vector3();
 for(let i=0;i<t.count;i++){
  v.set(t.getX(i),t.getY(i),t.getZ(i));w.set(n.getX(i),n.getY(i),n.getZ(i));
  if(!(v.lengthSq()>1e-12)||!Number.isFinite(v.x)){v.crossVectors(w,Math.abs(w.y)>.9?new T.Vector3(1,0,0):new T.Vector3(0,1,0));}
  v.addScaledVector(w,-v.dot(w));if(v.lengthSq()<1e-12)v.set(1,0,0);v.normalize();
  t.setXYZW(i,v.x,v.y,v.z,t.getW(i)<0?-1:1);
 }
}

/** Zona tocable (≤200 triángulos), hija del hueso, invisible para la app (la esconde por nombre). */
export function zona(esq,nombre,hueso,centro,radios,material){
 const g=new T.SphereGeometry(1,10,7);g.scale(...radios);
 const w=esq.pos(hueso);g.translate(centro[0]-w.x,centro[1]-w.y,centro[2]-w.z);
 g.deleteAttribute('uv');g.deleteAttribute('normal');
 const m=new T.Mesh(g,material);m.name=nombre;esq.huesos.get(hueso).add(m);return m;
}

/** Cámara de encuadre sugerida: mira por su −Z hacia el personaje. */
export function camaraNodo(raiz,nombre,objetivo,distancia,yfov=28){
 const c=new T.PerspectiveCamera(yfov,.75,.05,50);c.name=nombre;c.position.set(objetivo[0],objetivo[1],objetivo[2]+distancia);raiz.add(c);return c;
}
