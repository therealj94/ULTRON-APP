import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {crearAura} from './aura.js';
import {crearClaudio} from './claudio.js';
import {convertirAntonio} from './antonio-movil.js';

// Página de generación (la abre tools/generar.cjs en Chromium sin pantalla): arma cada personaje
// con su generador y lo exporta a GLB crudo. tools/movil.mjs lo comprime después (meshopt +
// cuantización) y lo deja en assets/movil/.

const FABRICAS={aura:crearAura,claudio:crearClaudio};

async function exportar(raiz,clips){
 // Los hijos van a la raíz de la escena glTF: las mallas con piel no deben colgar de otro nodo.
 const escena=new T.Scene();escena.name=raiz.name;escena.userData=raiz.userData;
 for(const h of [...raiz.children])escena.add(h);escena.updateMatrixWorld(true);
 const buf=await new GLTFExporter().parseAsync(escena,{binary:true,animations:clips,onlyVisible:false,maxTextureSize:1024});
 for(const h of [...escena.children])raiz.add(h);return buf;
}
function aBase64(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s);}
function deBase64(b64){const s=atob(b64);const b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b.buffer;}

window.GENERAR=async(id,calidad='alta',fuente=null)=>{
 let r;
 if(id==='antonio'){const gltf=await new GLTFLoader().parseAsync(deBase64(fuente),'');r=await convertirAntonio(gltf,{calidad});}
 else r=FABRICAS[id]({calidad});
 const buf=await exportar(r.raiz,r.clips);
 let tri=0;r.raiz.traverse(o=>{if(o.isMesh&&!o.name.startsWith('zona_'))tri+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;});
 return {glb:aBase64(buf),bytes:buf.byteLength,triangulos:Math.round(tri),clips:r.clips.map(c=>c.name),morphs:r.mallas?.cara?Object.keys(r.mallas.cara.morphTargetDictionary||{}).length:0,anclas:r.anclas||null};
};
window.GENERAR_LISTO=true;
