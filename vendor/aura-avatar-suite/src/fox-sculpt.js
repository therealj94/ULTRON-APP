import * as T from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {faceGeometry as baseFace,oralGeometry as baseOral,lipEdgeGeometry as baseLip,sweep} from './sculpt.js';

// A continuous protruding muzzle. Apply the same deformation to every mouth
// endpoint, including the cavity and lips; no floating facial sticker.
const protrusion=(x,y)=>.23*Math.exp(-((x/.43)**4+((y+.26)/.25)**4));
function muzzle(g,colored=false){
  const attrs=[g.attributes.position,...(g.morphAttributes.position||[])];
  for(const a of attrs)for(let i=0;i<a.count;i++)a.setZ(i,a.getZ(i)+protrusion(a.getX(i),a.getY(i)));
  g.computeVertexNormals();g.morphAttributes.normal=[];
  for(const a of attrs.slice(1)){const tmp=new T.BufferGeometry();tmp.setAttribute('position',a);tmp.setIndex(g.index);tmp.computeVertexNormals();g.morphAttributes.normal.push(tmp.attributes.normal.clone());tmp.dispose();}
  if(colored){const a=g.attributes.position,colors=[];const orange=new T.Color('#ad5226'),cream=new T.Color('#dec3a2');
    for(let i=0;i<a.count;i++){const x=a.getX(i),y=a.getY(i);const edge=-.065+.14*Math.pow(Math.abs(x)/.785,1.3);const blend=T.MathUtils.smoothstep(edge-y,-.04,.045);const c=orange.clone().lerp(cream,blend);colors.push(c.r,c.g,c.b);}
    g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  }return g;
}
export const faceGeometry=()=>muzzle(baseFace(),true);
export const oralGeometry=kind=>muzzle(baseOral(kind));
export const lipEdgeGeometry=()=>muzzle(baseLip());
export function earGeometry(inner=false){
 const s=new T.Shape(),k=inner?.73:1;
 s.moveTo(-.28*k,-.11*k);s.quadraticCurveTo(-.30*k,.10*k,-.12*k,.56*k);s.quadraticCurveTo(-.065*k,.74*k,0,.79*k);s.quadraticCurveTo(.10*k,.66*k,.22*k,.28*k);s.quadraticCurveTo(.35*k,-.015*k,.22*k,-.14*k);s.quadraticCurveTo(0,-.21*k,-.28*k,-.11*k);
 return mergeVertices(new T.ExtrudeGeometry(s,{depth:inner?.018:.13,bevelEnabled:true,bevelThickness:inner?.025:.055,bevelSize:inner?.022:.045,bevelSegments:5,curveSegments:28,steps:1}));
}
export function tailGeometry(){
 const g=sweep([[0,0,0],[-.20,-.12,-.30],[-.65,-.22,-.42],[-1.10,-.01,-.37],[-1.29,.45,-.19],[-1.13,.92,-.04],[-.84,1.18,-.07]],[.16,.27,.34,.37,.33,.25,.002],{sides:36,steps:100,depth:.91,fold:.006,roundEnd:true});
 const a=g.attributes.position,colors=[],orange=new T.Color('#a95126'),cream=new T.Color('#f1dcc0');
 for(let i=0;i<a.count;i++){const y=a.getY(i),x=a.getX(i),t=T.MathUtils.smoothstep(y,.59+.04*Math.sin(x*39),.72);const c=orange.clone().lerp(cream,t);colors.push(c.r,c.g,c.b);}g.setAttribute('color',new T.Float32BufferAttribute(colors,3));return g;
}
