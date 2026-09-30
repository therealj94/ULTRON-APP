import * as T from 'three';

// Geometría procedural del kit móvil. Todo en metros, mirando hacia +Z, arriba +Y.
// Las superficies se definen como funciones (u,v)→punto; las normales salen de las derivadas de
// esa función, así no hay costuras de sombreado en los cierres de las rejillas.

export const TAU=Math.PI*2;
export const lerp=(a,b,t)=>a+(b-a)*t;
export const clamp=(x,a=0,b=1)=>x<a?a:x>b?b:x;
export const suave=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export const campana=(x,c,w)=>Math.exp(-(((x-c)/w)**2));
export const gauss2=(x,y,cx,cy,wx,wy)=>Math.exp(-(((x-cx)/wx)**2+((y-cy)/wy)**2));
/** Soporte compacto: 1 en el centro, 0 exacto a partir del radio (para campos de morph sin costuras). */
export const burbuja=(d,r)=>{const t=clamp(1-d/r);return t*t*(3-2*t);};
export const v3=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);

/** Geometría indexada a partir de arreglos planos. */
export function geometria(pos,idx,{uv=null,normal=null,color=null}={}){
 const g=new T.BufferGeometry();
 g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
 if(normal)g.setAttribute('normal',new T.Float32BufferAttribute(normal,3));
 if(uv)g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
 if(color)g.setAttribute('color',new T.Float32BufferAttribute(color,3));
 g.setIndex(idx);if(!normal)g.computeVertexNormals();return g;
}

/**
 * Rejilla paramétrica: f(u,v) con u,v en [0,1] → [x,y,z]. `cerradaU` une u=0 con u=1 (normales
 * continuas); `polos` indica que v=0 y/o v=1 colapsan en un punto (normal por vecinos).
 */
export function rejilla(nu,nv,f,{cerradaU=false,invertir=false,uvEscala=[1,1]}={}){
 const pos=[],nor=[],uv=[],idx=[],e=1e-4,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),p=new T.Vector3(),q=new T.Vector3();
 const F=(u,v,out)=>{if(cerradaU)u=((u%1)+1)%1;const r=f(u,Math.min(1,Math.max(0,v)));return out.set(r[0],r[1],r[2]);};
 for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){
  const u=i/nu,v=j/nv;F(u,v,p);pos.push(p.x,p.y,p.z);uv.push(u*uvEscala[0],v*uvEscala[1]);
  // Derivadas centrales (hacia adentro en los bordes abiertos).
  const u0=cerradaU?u-e:Math.max(0,u-e),u1=cerradaU?u+e:Math.min(1,u+e);
  let v0=Math.max(0,v-e),v1=Math.min(1,v+e);
  F(u1,v,a);F(u0,v,b);a.sub(b);F(u,v1,c);F(u,v0,b);c.sub(b);
  let n=q.crossVectors(a,c);
  if(n.lengthSq()<=1e-8*a.lengthSq()*c.lengthSq()){ // polo (derivada nula relativa): usa un anillo cercano
   const vv=v<.5?Math.min(1,v+.01):Math.max(0,v-.01);n.set(0,0,0);
   for(let k=0;k<8;k++){const uu=k/8;F(uu+e,vv,a);F(uu-e,vv,b);a.sub(b);F(uu,Math.min(1,vv+e),c);F(uu,Math.max(0,vv-e),b);c.sub(b);n.add(new T.Vector3().crossVectors(a,c).normalize());}
  }
  n.normalize();if(invertir)n.negate();nor.push(n.x,n.y,n.z);
 }
 // Caras hacia du×dv (la misma dirección que las normales); `invertir` da vuelta ambas.
 for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const A=j*(nu+1)+i,B=A+nu+1;if(invertir)idx.push(A,B,A+1,B,B+1,A+1);else idx.push(A,A+1,B,B,A+1,B+1);}
 return geometria(pos,idx,{uv,normal:nor});
}

/** Elipsoide (o superelipsoide con exponentes e1 vertical, e2 horizontal) centrado en c. */
export function elipsoide(r,{c=[0,0,0],nu=32,nv=20,e1=1,e2=1,forma=null}={}){
 const sp=(w,m)=>Math.sign(w)*Math.abs(w)**m;
 return rejilla(nu,nv,(u,v)=>{
  const th=u*TAU,ph=(v-.5)*Math.PI;
  let x=r[0]*sp(Math.cos(ph),e1)*sp(Math.sin(th),e2),y=r[1]*sp(Math.sin(ph),e1),z=r[2]*sp(Math.cos(ph),e1)*sp(Math.cos(th),e2);
  if(forma)[x,y,z]=forma(x,y,z,u,v);
  return [x+c[0],y+c[1],z+c[2]];
 },{cerradaU:true});
}

/** Curva suave (Catmull-Rom centrípeta) por puntos [x,y,z]. */
export function curva(puntos,cerrada=false){return new T.CatmullRomCurve3(puntos.map(p=>new T.Vector3(...p)),cerrada,'centripetal');}

/**
 * Barrido de sección elíptica a lo largo de una curva. `radio(t)` → número o [rx,ry] (ry en la
 * dirección del "arriba" local), `perfil(t,a)` multiplica el radio por ángulo (pliegues, mechones).
 * Los extremos se cierran con casquetes redondos si `tapas` es true.
 */
export function barrido(c,radio,{lados=16,pasos=32,tapas=true,perfil=null,arriba=[0,0,1],giro=null}={}){
 const curvaObj=Array.isArray(c)?curva(c):c;
 const marcos=[],up=new T.Vector3(...arriba);
 // Marco de transporte paralelo para que la sección no se retuerza.
 let prevN=null;
 for(let i=0;i<=pasos;i++){
  const t=i/pasos,p=curvaObj.getPointAt(t),tg=curvaObj.getTangentAt(t).normalize();
  let n;
  if(!prevN){n=up.clone().sub(tg.clone().multiplyScalar(up.dot(tg)));if(n.lengthSq()<1e-6)n=new T.Vector3(1,0,0).sub(tg.clone().multiplyScalar(tg.x));n.normalize();}
  else{n=prevN.clone().sub(tg.clone().multiplyScalar(prevN.dot(tg))).normalize();}
  prevN=n;const b=new T.Vector3().crossVectors(tg,n).normalize();
  if(giro){const g=giro(t),cn=Math.cos(g),sn=Math.sin(g);const n2=n.clone().multiplyScalar(cn).addScaledVector(b,sn),b2=b.clone().multiplyScalar(cn).addScaledVector(n,-sn);marcos.push({p,tg,n:n2,b:b2,t});}
  else marcos.push({p,tg,n,b,t});
 }
 const pos=[],idx=[],uv=[];
 const anillo=(m,escala=1,desplaza=0)=>{
  const r=radio(m.t),rx=(Array.isArray(r)?r[0]:r)*escala,ry=(Array.isArray(r)?r[1]:r)*escala;
  for(let k=0;k<=lados;k++){const a=k/lados*TAU,f=perfil?perfil(m.t,a):1;
   const q=m.p.clone().addScaledVector(m.b,Math.cos(a)*rx*f).addScaledVector(m.n,Math.sin(a)*ry*f).addScaledVector(m.tg,desplaza);
   pos.push(q.x,q.y,q.z);uv.push(k/lados,m.t);}
 };
 const anillos=[];
 const tapaAnillos=Math.max(2,Math.min(5,Math.round(lados/4)));
 if(tapas){const m=marcos[0],r0=radio(0),R=Math.max(...[].concat(r0));for(let s=tapaAnillos;s>=1;s--){const a=s/tapaAnillos*Math.PI/2;anillos.push([m,Math.cos(a),-Math.sin(a)*R*.9]);}}
 for(const m of marcos)anillos.push([m,1,0]);
 if(tapas){const m=marcos[marcos.length-1],r1=radio(1),R=Math.max(...[].concat(r1));for(let s=1;s<=tapaAnillos;s++){const a=s/tapaAnillos*Math.PI/2;anillos.push([m,Math.cos(a),Math.sin(a)*R*.9]);}}
 for(const [m,e,d] of anillos)anillo(m,Math.max(e,1e-4),d);
 const n=lados+1;
 for(let j=0;j<anillos.length-1;j++)for(let k=0;k<lados;k++){const A=j*n+k,B=A+n;idx.push(A,B,A+1,B,B+1,A+1);} // hacia afuera
 const g=geometria(pos,idx,{uv});
 // Soldar el cierre de la sección para normales continuas.
 suavizarCostura(g,n);return g;
}

/** Promedia normales de vértices en la misma posición (cierres de rejillas y casquetes). */
export function suavizarCostura(g){
 const p=g.attributes.position,nrm=g.attributes.normal,mapa=new Map();
 const clave=i=>`${Math.round(p.getX(i)*1e5)},${Math.round(p.getY(i)*1e5)},${Math.round(p.getZ(i)*1e5)}`;
 for(let i=0;i<p.count;i++){const k=clave(i);if(!mapa.has(k))mapa.set(k,[]);mapa.get(k).push(i);}
 const v=new T.Vector3();
 for(const lista of mapa.values()){if(lista.length<2)continue;v.set(0,0,0);for(const i of lista)v.add(new T.Vector3(nrm.getX(i),nrm.getY(i),nrm.getZ(i)));if(v.lengthSq()<1e-12)continue;v.normalize();for(const i of lista)nrm.setXYZ(i,v.x,v.y,v.z);}
 return g;
}

/** Desplaza cada vértice con f(p,n)→[dx,dy,dz] y recalcula normales (sin romper el cierre). */
export function deformar(g,f,{normales=true}={}){
 const p=g.attributes.position,n=g.attributes.normal,a=new T.Vector3(),b=new T.Vector3();
 for(let i=0;i<p.count;i++){a.fromBufferAttribute(p,i);b.fromBufferAttribute(n,i);const d=f(a,b,i);if(d)p.setXYZ(i,a.x+d[0],a.y+d[1],a.z+d[2]);}
 if(normales){g.computeVertexNormals();suavizarCostura(g);}return g;
}

/** Aplica una matriz (posición + normales). */
export function transformar(g,{t=[0,0,0],r=[0,0,0],s=[1,1,1]}={}){
 const m=new T.Matrix4().compose(new T.Vector3(...t),new T.Quaternion().setFromEuler(new T.Euler(...r)),new T.Vector3(...(Array.isArray(s)?s:[s,s,s])));
 g.applyMatrix4(m);return g;
}

/** Extrusión con bisel de una forma 2D (logos, marcos de lentes) y soldado de vértices. */
export function extruir(forma,{profundidad=.01,bisel=.003,segBisel=3,curva=24}={}){
 const g=new T.ExtrudeGeometry(forma,{depth:profundidad,bevelEnabled:bisel>0,bevelThickness:bisel,bevelSize:bisel,bevelSegments:segBisel,curveSegments:curva,steps:1});
 g.deleteAttribute('uv');const m=mergeSimple(g);m.computeVertexNormals();return m;
}

/** Soldado de vértices por posición (para geometrías sin UV). */
export function mergeSimple(g){
 const src=g.index?g.toNonIndexed():g,p=src.attributes.position,mapa=new Map(),pos=[],idx=[];
 for(let i=0;i<p.count;i++){const k=`${Math.round(p.getX(i)*1e6)},${Math.round(p.getY(i)*1e6)},${Math.round(p.getZ(i)*1e6)}`;let j=mapa.get(k);if(j===undefined){j=pos.length/3;mapa.set(k,j);pos.push(p.getX(i),p.getY(i),p.getZ(i));}idx.push(j);}
 // Quita triángulos degenerados.
 const limpio=[];for(let i=0;i<idx.length;i+=3){const [a,b,c]=[idx[i],idx[i+1],idx[i+2]];if(a!==b&&b!==c&&a!==c)limpio.push(a,b,c);}
 return geometria(pos,limpio);
}

/** Rectángulo redondeado como THREE.Shape. */
export function rectRedondo(w,h,r,{x=0,y=0}={}){
 const s=new T.Shape(),x0=x-w/2,y0=y-h/2;
 s.moveTo(x0+r,y0);s.lineTo(x0+w-r,y0);s.quadraticCurveTo(x0+w,y0,x0+w,y0+r);s.lineTo(x0+w,y0+h-r);s.quadraticCurveTo(x0+w,y0+h,x0+w-r,y0+h);s.lineTo(x0+r,y0+h);s.quadraticCurveTo(x0,y0+h,x0,y0+h-r);s.lineTo(x0,y0+r);s.quadraticCurveTo(x0,y0,x0+r,y0);return s;
}

/** Número pseudoaleatorio reproducible. */
export function azar(semilla=1){let s=semilla>>>0||1;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
