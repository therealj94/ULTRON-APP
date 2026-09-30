import {MORPHS,RECETA_VISEMAS,VISEMAS,nombreVisema} from './nombres.js';

/**
 * Campo de morph completo a partir de uno que sabe las formas ARKit (y «rubor»): los visemas se
 * arman con la receta común (nombres.js) más los retoques del personaje. Como cada forma es un
 * desplazamiento lineal por vértice, la suma es exacta.
 */
export function campoCompleto(campoArkit,{retoques={},reemplazar=null,campoNormalArkit=null}={}){
 const receta={};for(const v of VISEMAS)receta[nombreVisema(v)]=reemplazar&&reemplazar[v]?{...reemplazar[v]}:{...RECETA_VISEMAS[v],...(retoques[v]||{})};
 return {
  nombres:MORPHS,
  campo(nombre,info){
   const r=receta[nombre];
   if(!r)return campoArkit(nombre,info);
   let x=0,y=0,z=0,hay=false;
   for(const [k,w] of Object.entries(r)){if(!w)continue;const d=campoArkit(k,info);if(d){x+=d[0]*w;y+=d[1]*w;z+=d[2]*w;hay=true;}}
   return hay?[x,y,z]:null;
  },
  // Normales opcionales (mismas mezclas): solo si el personaje las da.
  campoNormal:campoNormalArkit?(nombre,info)=>{
   const r=receta[nombre];if(!r)return campoNormalArkit(nombre,info);
   let x=0,y=0,z=0,hay=false;for(const [k,w] of Object.entries(r)){if(!w)continue;const d=campoNormalArkit(k,info);if(d){x+=d[0]*w;y+=d[1]*w;z+=d[2]*w;hay=true;}}
   return hay?[x,y,z]:null;
  }:null
 };
}
