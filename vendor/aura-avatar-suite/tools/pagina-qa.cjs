// Abre la página de QA (src/qa-pagina.js empaquetada) en Chromium sin pantalla, servida en
// 127.0.0.1. La usan capturas.cjs, video.cjs, vista.cjs y qa.cjs.
const fs=require('node:fs');
const path=require('node:path');
const {build}=require('esbuild');
const {abrirNavegador}=require('./navegador.cjs');
const {servir}=require('./servidor.cjs');
const RAIZ=path.join(__dirname,'..');

async function abrirQA(){
 const tmp=path.join(RAIZ,'.tmp');fs.mkdirSync(tmp,{recursive:true});
 await build({entryPoints:[path.join(RAIZ,'src/qa-pagina.js')],bundle:true,outfile:path.join(tmp,'qa.bundle.js'),format:'iife',target:'es2020',logLevel:'warning',preserveSymlinks:true});
 fs.writeFileSync(path.join(tmp,'qa.html'),'<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}</style><body><script src="qa.bundle.js"></script></body>');
 const srv=await servir(RAIZ);const browser=await abrirNavegador();
 const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
 const errores=[];page.on('pageerror',e=>errores.push(e.message));page.on('console',m=>{if(m.type()==='error')errores.push(m.text());});
 await page.goto(srv.url+'/.tmp/qa.html');await page.waitForFunction(()=>window.QA_LISTO,null,{timeout:60000});
 const guardar=(dataUrl,archivo)=>{fs.mkdirSync(path.dirname(archivo),{recursive:true});fs.writeFileSync(archivo,Buffer.from(dataUrl.split(',')[1],'base64'));};
 return {page,browser,srv,errores,guardar,url:srv.url,cerrar:async()=>{await browser.close();srv.cerrar();}};
}
module.exports={abrirQA,RAIZ};
