import * as T from 'three';

// Texturas pintadas en canvas (≤1024 px, se exportan como WebP con EXT_texture_webp). Son pocas y
// chicas: el color va casi todo por vértice; las texturas dan el detalle fino (ojos, tela, pelo).

function lienzo(w,h=w){const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')];}
function textura(c,{srgb=true,repetir=false}={}){
 const t=new T.CanvasTexture(c);if(srgb)t.colorSpace=T.SRGBColorSpace;t.userData.mimeType='image/webp';
 if(repetir){t.wrapS=t.wrapT=T.RepeatWrapping;}t.anisotropy=4;t.needsUpdate=true;return t;
}

/**
 * Atlas de 512×512 para lo que brilla en la cara (ojos, pupilas, destellos, líneas, boca, rubor).
 * Devuelve {tex, uv(region, u, v)} donde u,v en [0,1] dentro de la región.
 */
export function atlasBrillo({oro='#f2bd55',oroHondo='#c07a16',pupila='#3b2208',rubor='#f29a86',fondo='#15171c'}={}){
 const [c,x]=lienzo(512);x.fillStyle=fondo;x.fillRect(0,0,512,512);
 const R={iris:[0,0,256,256],pupila:[256,0,128,128],destello:[384,0,128,128],linea:[256,128,128,64],relleno:[384,128,128,64],rubor:[256,192,128,128],lengua:[384,192,128,128],luz:[0,256,256,256]};
 // Iris: núcleo cálido, anillo más hondo y borde oscuro fino (lee a 104 px).
 {const [a,b,w]=R.iris;const g=x.createRadialGradient(a+w*.45,b+w*.4,w*.02,a+w/2,b+w/2,w*.5);
  g.addColorStop(0,'#ffe7a8');g.addColorStop(.3,oro);g.addColorStop(.72,oroHondo);g.addColorStop(.9,'#8a520f');g.addColorStop(1,'#5a3508');x.fillStyle=g;x.fillRect(a,b,w,w);
  // Estrías radiales muy suaves.
  x.save();x.globalAlpha=.10;x.strokeStyle='#fff6d8';x.lineWidth=2;for(let i=0;i<48;i++){const an=i/48*Math.PI*2;x.beginPath();x.moveTo(a+w/2+Math.cos(an)*w*.14,b+w/2+Math.sin(an)*w*.14);x.lineTo(a+w/2+Math.cos(an)*w*.42,b+w/2+Math.sin(an)*w*.42);x.stroke();}x.restore();}
 {const [a,b,w]=R.pupila;const g=x.createRadialGradient(a+w/2,b+w/2,1,a+w/2,b+w/2,w*.5);g.addColorStop(0,'#1a0d02');g.addColorStop(.7,pupila);g.addColorStop(.92,'#8a5a16');g.addColorStop(1,'#c8912f');x.fillStyle=g;x.fillRect(a,b,w,w);}
 {const [a,b,w]=R.destello;x.fillStyle='#ffffff';x.fillRect(a,b,w,w);}
 {const [a,b,w,h]=R.linea;const g=x.createLinearGradient(a,b,a,b+h);g.addColorStop(0,'#fff0c2');g.addColorStop(1,oro);x.fillStyle=g;x.fillRect(a,b,w,h);}
 {const [a,b,w,h]=R.relleno;const g=x.createLinearGradient(a,b,a,b+h);g.addColorStop(0,'#2a1806');g.addColorStop(1,'#5a3a12');x.fillStyle=g;x.fillRect(a,b,w,h);}
 {const [a,b,w]=R.rubor;const g=x.createRadialGradient(a+w/2,b+w/2,1,a+w/2,b+w/2,w*.5);g.addColorStop(0,rubor);g.addColorStop(.55,'#b86a5c');g.addColorStop(1,fondo);x.fillStyle=g;x.fillRect(a,b,w,w);}
 {const [a,b,w]=R.lengua;const g=x.createRadialGradient(a+w/2,b+w*.4,1,a+w/2,b+w/2,w*.5);g.addColorStop(0,'#ffb3a3');g.addColorStop(1,'#d9776a');x.fillStyle=g;x.fillRect(a,b,w,w);}
 {const [a,b,w]=R.luz;const g=x.createRadialGradient(a+w/2,b+w/2,1,a+w/2,b+w/2,w*.5);g.addColorStop(0,'#fff1c9');g.addColorStop(.5,oro);g.addColorStop(1,'#8a6420');x.fillStyle=g;x.fillRect(a,b,w,w);}
 const tex=textura(c);
 const uv=(region,u,v)=>{const [a,b,w,h=w]=R[region];const px=a+.5+Math.min(1,Math.max(0,u))*(w-1),py=b+.5+Math.min(1,Math.max(0,v))*(h-1);return [px/512,1-py/512];};
 return {tex,uv};
}

/** Mapa normal que se repite, a partir de una función de altura h(x,y) en [0,1)². */
function normalDesdeAltura(n,h,fuerza){
 const alt=new Float32Array(n*n);for(let j=0;j<n;j++)for(let i=0;i<n;i++)alt[j*n+i]=h(i/n,j/n);
 const [c,x]=lienzo(n);const img=x.createImageData(n,n);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const dx=(alt[j*n+(i+1)%n]-alt[j*n+(i-1+n)%n])*fuerza,dy=(alt[((j+1)%n)*n+i]-alt[((j-1+n)%n)*n+i])*fuerza;
  const l=Math.hypot(dx,dy,1),k=(j*n+i)*4;img.data[k]=(-dx/l*.5+.5)*255;img.data[k+1]=(dy/l*.5+.5)*255;img.data[k+2]=(1/l*.5+.5)*255;img.data[k+3]=255;
 }
 x.putImageData(img,0,0);return textura(c,{srgb:false,repetir:true});
}
const fr=x=>x-Math.floor(x);
function ruido(x,y,f,sem){ // ruido de valor periódico (período 1)
 const X=x*f,Y=y*f,i=Math.floor(X),j=Math.floor(Y),u=X-i,v=Y-j,h=(a,b)=>fr(Math.sin(((a%f+f)%f)*127.1+((b%f+f)%f)*311.7+sem*17.3)*43758.5453);
 const s=t=>t*t*(3-2*t);return (h(i,j)*(1-s(u))+h(i+1,j)*s(u))*(1-s(v))+(h(i,j+1)*(1-s(u))+h(i+1,j+1)*s(u))*s(v);
}

/** Cerámica: piel de naranja apenas perceptible (se nota en el brillo, no en la silueta). */
export const normalCeramica=()=>normalDesdeAltura(256,(x,y)=>ruido(x,y,24,1)*.6+ruido(x,y,48,2)*.4,.9);
/** Punto de tejido (sudadera): hileras de puntos en V. */
export const normalTejido=()=>normalDesdeAltura(256,(x,y)=>{const f=32,u=fr(x*f),v=fr(y*f*1.4);const ve=Math.abs(u-.5)*2;const punto=Math.sin(Math.PI*v+ve*1.8);return .5+.5*punto*(1-ve*.4)+ruido(x,y,64,3)*.15;},2.2);
/** Pelo: mechones finos alineados (el eje v de las UV sigue la dirección del pelo). */
export const normalPelo=()=>normalDesdeAltura(256,(x,y)=>{let s=0;for(let k=0;k<3;k++){const f=24*(k+1);s+=ruido(x*1,y*.12,f,5+k)*(1/(k+1));}return s*.6+ruido(x,y,16,9)*.2;},3.2);
/** Tela plana de pantalón: sarga diagonal suave. */
export const normalSarga=()=>normalDesdeAltura(256,(x,y)=>.5+.5*Math.sin((x+y)*Math.PI*2*40)+ruido(x,y,32,4)*.2,1.4);
