import * as T from 'three';

// All surfaces are actual polygon geometry. No view-dependent character billboard.
const TAU=Math.PI*2;
export const mouthShapes=[
 [.25,.003,.006,.075], [.25,.055,.16,.075], [.29,.065,.19,.11],
 [.095,.105,.145,0], [.285,.028,.065,.055], [.215,.012,.036,-.085], [.25,.002,.003,.06]
];
const gauss=(x,y,cx,cy,wx,wy)=>Math.exp(-(((x-cx)/wx)**2+((y-cy)/wy)**2));
export function frontZ(x,y){
 const dome=.54*Math.sqrt(Math.max(0,1-(x/.785)**2-(y/.663)**2));
 const cheek=.057*(gauss(x,y,.43,-.19,.25,.23)+gauss(x,y,-.43,-.19,.25,.23));
 const chin=.045*gauss(x,y,0,-.41,.36,.19);
 const nose=.10*gauss(x,y,0,-.055,.102,.14)+.034*(gauss(x,y,.075,-.07,.06,.055)+gauss(x,y,-.075,-.07,.06,.055));
 return dome+cheek+chin+nose;
}
function mouthPoint(theta,shape){
 const [w,up,down,smile]=shape,x=Math.cos(theta)*w,s=Math.sin(theta),y=-.315+(s>=0?up:down)*s+smile*(Math.cos(theta)**2-.40);
 return [x,y,frontZ(x,y)+.007];
}
function geom(pos,uv,idx,colors){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));if(colors)g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();return g;}
function quads(n,m,reverse=false){const idx=[];for(let j=0;j<m;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+n+1;idx.push(...(reverse?[a,a+1,b,b,a+1,b+1]:[a,b,a+1,b,b+1,a+1]));}return idx;}
function morphs(g,make){
 g.morphAttributes.position=[];g.morphAttributes.normal=[];
 for(const s of mouthShapes.slice(1)){const a=new T.Float32BufferAttribute(make(s).pos,3),tmp=new T.BufferGeometry();tmp.setAttribute('position',a);tmp.setIndex(g.index);tmp.computeVertexNormals();g.morphAttributes.position.push(a);g.morphAttributes.normal.push(tmp.attributes.normal.clone());tmp.dispose();}
 return g;
}
// A continuous annular facial surface runs from the lips to the silhouette.
// The mouth is a real opening in the mesh, not a flat decal on an intact sphere.
export function faceGeometry(){
 const N=160,M=46;
 const make=shape=>{const pos=[],uv=[],col=[];for(let j=0;j<=M;j++)for(let i=0;i<=N;i++){
  const a=i/N*TAU,r=j/M,p=mouthPoint(a,shape),bx=.785*Math.cos(a),by=.663*Math.sin(a),x=T.MathUtils.lerp(p[0],bx,r),y=T.MathUtils.lerp(p[1],by,r);
  const z=frontZ(x,y)+.009*(1-r)*Math.exp(-r*13);
  pos.push(x,y,z);uv.push(.5+x/1.57,.5+y/1.326);
  const blush=.28*(gauss(x,y,.46,-.2,.22,.16)+gauss(x,y,-.46,-.2,.22,.16));
  const muzzle=.08*gauss(x,y,0,-.28,.42,.23);const eye=.13*(gauss(x,y,.3,.17,.26,.27)+gauss(x,y,-.3,.17,.26,.27));
  const lip=.11*Math.exp(-r*45);col.push(1,Math.min(1,1-blush*.54+muzzle-eye*.32-lip),Math.min(1,1-blush*.63+muzzle*.72-eye*.3-lip*.9));
 }return {pos,uv,col};};const d=make(mouthShapes[0]);const g=geom(d.pos,d.uv,quads(N,M),d.col);morphs(g,make);return g;
}
export function rearHeadGeometry(){
 const g=new T.SphereGeometry(1,80,56,0,Math.PI);g.scale(.785,.663,.54);g.rotateY(Math.PI);return g;
}
export function oralGeometry(kind){
 const N=96,M=kind==='cavity'?6:4;
 const make=shape=>{const pos=[],uv=[];for(let j=0;j<=M;j++)for(let i=0;i<=N;i++){
  const a=i/N*TAU,r=j/M,p=mouthPoint(a,shape);
  if(kind==='cavity'){pos.push(p[0]*(1-r),T.MathUtils.lerp(p[1],-.35,r),T.MathUtils.lerp(p[2]-.009,.30,r));}
  else {const d=.008*r;const x=p[0]+Math.cos(a)*d,y=p[1]+Math.sin(a)*d;pos.push(x,y,frontZ(x,y)+.012+Math.sin(r*Math.PI)*.007);}
  uv.push(i/N,j/M);
 }return {pos,uv};};const d=make(mouthShapes[0]);return morphs(geom(d.pos,d.uv,quads(N,M,kind==='cavity')),make);
}
export function lipEdgeGeometry(){return oralGeometry('lip');}

// Conforming hemispherical eyelids leave the eyeball spherical while blinking.
export function lidGeometry(lower=false){
 const N=64,M=14,positions=[],uv=[];
 // Each lid's open and shut endpoints share topology. UVs stay fixed.
 const make=closure=>{const pos=[];for(let j=0;j<=M;j++)for(let i=0;i<=N;i++){
  const a=i/N*Math.PI,xx=Math.cos(a),arc=Math.sin(a),t=j/M;
  const openEdge=(lower?-.93:.86)*arc;
  const closedEdge=.035*arc;
  const edge=T.MathUtils.lerp(openEdge,closedEdge,closure),outer=(lower?-1:1)*arc;
  const yy=T.MathUtils.lerp(edge,outer,t);
  const zz=Math.sqrt(Math.max(0,1-xx*xx-yy*yy));
  pos.push(xx*.247,yy*.262,zz*.203+.008);
 }return pos;};positions.push(...make(0));for(let j=0;j<=M;j++)for(let i=0;i<=N;i++)uv.push(i/N,j/M);
 const g=geom(positions,uv,quads(N,M,lower));const attr=new T.Float32BufferAttribute(make(1),3),tmp=new T.BufferGeometry();tmp.setAttribute('position',attr);tmp.setIndex(g.index);tmp.computeVertexNormals();g.morphAttributes.position=[attr];g.morphAttributes.normal=[tmp.attributes.normal.clone()];tmp.dispose();return g;
}
export function irisGeometry(){
 const g=new T.SphereGeometry(1,64,32,0,TAU,0,Math.PI/2);g.rotateX(Math.PI/2); // replaced with a shallow convex disk below
 const pos=[],uv=[],N=96,M=12;
 for(let j=0;j<=M;j++)for(let i=0;i<=N;i++){
 const r=j/M,a=i/N*TAU;const x=Math.cos(a)*r*.136,y=Math.sin(a)*r*.151;pos.push(x,y,.2*Math.sqrt(Math.max(0,1-(x/.244)**2-(y/.259)**2))+.003);uv.push(.5+Math.cos(a)*r*.5,.5+Math.sin(a)*r*.5);}
 g.dispose();return geom(pos,uv,quads(N,M));
}
export function irisTexture(){
 const size=512,c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d'),im=x.createImageData(size,size);
 for(let y=0;y<size;y++)for(let a=0;a<size;a++){
 const dx=(a-size/2)/(size/2),dy=(y-size/2)/(size/2),r=Math.hypot(dx,dy),theta=Math.atan2(dy,dx),idx=(y*size+a)*4;
 const fiber=(Math.sin(theta*127+Math.sin(r*28)*1.8)+Math.sin(theta*233-r*11)+Math.cos(theta*391+r*37))*.12;
 const corona=Math.exp(-(((r-.40)/.07)**2));const border=Math.min(1,Math.max(0,(1-r)/.09));
 let red=(112+fiber*120+corona*57+(1-r)*44)*border,green=(59+fiber*90+corona*40+(1-r)*20)*border,blue=(19+fiber*30+corona*13)*border;
 if(r<.43){red=5;green=4;blue=3;}
 im.data.set([red,green,blue,255],idx);
 }x.putImageData(im,0,0);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
let rngState=9712;function random(){rngState=(1664525*rngState+1013904223)>>>0;return rngState/4294967296;}
export function detailTextures(kind){
 const S=512,c=document.createElement('canvas'),r=document.createElement('canvas'),n=document.createElement('canvas');c.width=c.height=r.width=r.height=n.width=n.height=S;
 const cx=c.getContext('2d'),rx=r.getContext('2d'),nx=n.getContext('2d'),ci=cx.createImageData(S,S),ri=rx.createImageData(S,S),ni=nx.createImageData(S,S);const height=new Float32Array(S*S);
 for(let y=0;y<S;y++)for(let x=0;x<S;x++){
 const noise=random(),fine=random();let h;
 if(kind==='skin')h=(noise*.7+fine*.3)*.32 + .07*Math.sin(x*.073+Math.sin(y*.049)*3);
 else h=.16*Math.sin(x*Math.PI/2)+.16*Math.sin(y*Math.PI/2)+.09*Math.sin((x+y)*Math.PI/4)+noise*.15;
 height[y*S+x]=h;
 const i=(y*S+x)*4,v=kind==='skin'?238+noise*17:194+noise*40+Math.sin((x+y)*Math.PI/4)*10;
 ci.data.set([v,v,v,255],i);const rough=kind==='skin'?147+fine*50:206+fine*35;ri.data.set([rough,rough,rough,255],i);
 }
 for(let y=0;y<S;y++)for(let x=0;x<S;x++){
 const dx=height[y*S+(x+1)%S]-height[y*S+(x+S-1)%S],dy=height[((y+1)%S)*S+x]-height[((y+S-1)%S)*S+x],v=new T.Vector3(-dx,-dy,1).normalize();ni.data.set([(v.x*.5+.5)*255,(v.y*.5+.5)*255,(v.z*.5+.5)*255,255],(y*S+x)*4);
 }cx.putImageData(ci,0,0);rx.putImageData(ri,0,0);nx.putImageData(ni,0,0);
 const maps=[c,r,n].map(can=>{const t=new T.CanvasTexture(can);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(kind==='skin'?1:3,kind==='skin'?1:3);return t;});maps[0].colorSpace=T.SRGBColorSpace;return {map:maps[0],roughnessMap:maps[1],normalMap:maps[2]};
}
// Smooth swept surface; width and depth taper independently along a spline.
export function sweep(points,radii,{sides=24,steps=48,depth=1,fold=0,roundEnd=false}={}){
 const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),frames=curve.computeFrenetFrames(steps,false),pos=[],uv=[];
 for(let j=0;j<=steps;j++){
  const t=j/steps,p=curve.getPointAt(t),f=t*(radii.length-1),k=Math.min(radii.length-2,Math.floor(f)),u=f-k,rad=roundEnd&&k===radii.length-2&&radii[k+1]<.005 ? radii[k]*Math.sqrt(Math.max(.000001,1-u*u)) : T.MathUtils.lerp(radii[k],radii[k+1],u*u*(3-2*u));
  for(let i=0;i<=sides;i++){const a=i/sides*TAU,wave=fold*(Math.sin(t*24+a*2)*.5+Math.sin(t*39-a*3)*.22)*Math.sin(Math.PI*t)**2,rr=Math.max(.0002,rad+wave);
   const v=p.clone().addScaledVector(frames.normals[j],Math.cos(a)*rr).addScaledVector(frames.binormals[j],Math.sin(a)*rr*depth);pos.push(...v.toArray());uv.push(i/sides,t);
  }
 }return geom(pos,uv,quads(sides,steps,true));
}
export function jacketGeometry(){
 const profile=new T.CatmullRomCurve3([[.30,-.61,0],[.355,-.50,0],[.353,-.23,0],[.397,.12,0],[.457,.36,0],[.427,.48,0],[.255,.62,0],[.18,.67,0]].map(p=>new T.Vector3(...p)));
 const N=96,M=60,pos=[],uv=[];
 for(let j=0;j<=M;j++)for(let i=0;i<=N;i++){
 const t=j/M,p=profile.getPoint(t),a=i/N*TAU,fold=(.008*Math.sin(p.y*29+a*3)+.005*Math.sin(p.y*53-a*6))*Math.sin(t*Math.PI)**2;
 let x=(p.x+fold)*Math.cos(a),z=(p.x*.67+fold)*Math.sin(a);
 // Soft diagonal drape at the lower sides, not an angular cylinder.
 z+=.008*Math.cos(a*7+p.y*19)*Math.sin(t*Math.PI);pos.push(x,p.y,z);uv.push(i/N,t);
 }return geom(pos,uv,quads(N,M));
}
export function shoeGeometry(layer){
 const N=64,M=22,pos=[],uv=[];
 const isSole=layer!=='upper';
 for(let j=0;j<=M;j++)for(let i=0;i<=N;i++){
 const t=j/M,a=i/N*TAU;
 let width,len,y,zshift;
 if(isSole){width=.204*(.97+.03*Math.sin(t*Math.PI));len=.337;y=(layer==='outsole'?-.026:.014)+t*(layer==='outsole'?.045:.052);zshift=.047;}
 else{const shrink=Math.cos(t*Math.PI/2);width=.193*shrink;len=.315*shrink;y=.065+t*.263;zshift=.047-t*.112;}
 const co=Math.cos(a),si=Math.sin(a),toeFactor=si>0?1: .79;
 const x=width*Math.sign(co)*Math.abs(co)**.8*toeFactor,z=zshift+len*Math.sign(si)*Math.abs(si)**.88;
 pos.push(x,y+(isSole? .008*si: .016*si*(1-t)),z);uv.push(i/N,t);
 }return geom(pos,uv,quads(N,M));
}
export function browGeometry(side){return sweep([[-.226,-.03,-.053],[-.145,.024,-.005],[-.03,.05,.018],[.12,.025,.002],[.205,-.005,-.044]],[.005,.037,.044,.031,.003],{sides:16,steps:40,depth:.62});}
