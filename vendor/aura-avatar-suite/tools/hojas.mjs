// Hoja comparativa por personaje: cada encuadre de qa/antes junto a su gemelo de qa/despues
// (capturas 390×844), en parejas «antes | después». Salida: qa/comparacion/<id>.jpg
// Uso: node tools/hojas.mjs [antonio claudio aura]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const RAIZ=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const NOMBRES={antonio:'ANT-ONIO',claudio:'Claudio',aura:'AU-RA'};
const NOTAS={antonio:'Diseño aprobado: solo optimización técnica (mismo aspecto)',claudio:'Misma identidad, pelaje y ropa rehechos',aura:'Rediseño completo «Grafito · Orbe»'};
const ENCUADRES=[['frente','Frente'],['tres-cuartos','3/4'],['perfil','Perfil'],['cara','Cara'],
 ['emocion-feliz','Feliz'],['emocion-risa','Risa'],['emocion-triste','Triste'],['emocion-pensando','Pensando'],
 ['emocion-curioso','Curioso'],['emocion-enojado','Enojado'],['emocion-sorprendido','Sorprendido']];
const W=234,H=507,GAP=10,PAR=2*W+GAP,COLS=4,MARGEN=28,CAB=92,ROT=40;
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const texto=(ancho,alto,partes)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">${partes}</svg>`);

async function hoja(id){
 const filas=Math.ceil(ENCUADRES.length/COLS);
 const ancho=MARGEN*2+COLS*PAR+(COLS-1)*MARGEN,alto=CAB+filas*(ROT+H+MARGEN)+MARGEN;
 const capas=[];let svg=`<text x="${MARGEN}" y="46" font-family="DejaVu Sans" font-weight="bold" font-size="34" fill="#f4efe6">${esc(NOMBRES[id])} · antes | después</text>`
  +`<text x="${MARGEN}" y="76" font-family="DejaVu Sans" font-size="18" fill="#b9b2a6">${esc(NOTAS[id])} · 390×844 · izquierda: entrega anterior, derecha: diseño final</text>`;
 for(const [i,[clave,rotulo]] of ENCUADRES.entries()){
  const x=MARGEN+(i%COLS)*(PAR+MARGEN),y=CAB+Math.floor(i/COLS)*(ROT+H+MARGEN);
  svg+=`<text x="${x}" y="${y+26}" font-family="DejaVu Sans" font-weight="bold" font-size="19" fill="#f2bd55">${esc(rotulo)}</text>`
   +`<text x="${x+W-4}" y="${y+26}" text-anchor="end" font-family="DejaVu Sans" font-size="14" fill="#8d877d">antes</text>`
   +`<text x="${x+PAR-4}" y="${y+26}" text-anchor="end" font-family="DejaVu Sans" font-size="14" fill="#8d877d">después</text>`;
  for(const [k,carpeta] of ['antes','despues'].entries()){
   const f=path.join(RAIZ,'qa',carpeta,`${id}-${clave}-390x844.jpg`);
   if(!fs.existsSync(f)){console.warn('falta',path.relative(RAIZ,f));continue;}
   capas.push({input:await sharp(f).resize(W,H,{fit:'cover'}).toBuffer(),left:x+k*(W+GAP),top:y+ROT});
  }
 }
 capas.push({input:texto(ancho,alto,svg),left:0,top:0});
 const salida=path.join(RAIZ,'qa/comparacion',id+'.jpg');
 await sharp({create:{width:ancho,height:alto,channels:3,background:'#16171a'}}).composite(capas).jpeg({quality:84,mozjpeg:true}).toFile(salida);
 console.log('hoja',path.relative(RAIZ,salida),(fs.statSync(salida).size/1024|0)+' KB');
}

fs.mkdirSync(path.join(RAIZ,'qa/comparacion'),{recursive:true});
const ids=process.argv.slice(2).length?process.argv.slice(2):['antonio','claudio','aura'];
for(const id of ids)await hoja(id);
