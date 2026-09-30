// Arma el estudio autónomo (AVATARES-AURA-DEMO.html, con los GLB móviles de calidad alta dentro)
// y las páginas de la WebView (integration/*-embed.html + avatarHtml.ts, con el LOD bajo dentro).
// Todo sin conexión: no hay pedidos externos. Requiere assets/movil/ (node tools/movil.mjs).
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const RAIZ=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');process.chdir(RAIZ);
const IDS=['antonio','claudio','aura'];
const b64=async f=>(await fs.readFile(f)).toString('base64');
const seguro=s=>s.replaceAll('</script','<\\/script');
const opciones={bundle:true,format:'iife',target:'es2020',minify:true,legalComments:'eof',preserveSymlinks:true,logLevel:'warning'};

await build({...opciones,entryPoints:['src/main.js'],outfile:'app.js'});
const glbAlta={};for(const id of IDS)glbAlta[id]=await b64(`assets/movil/${id}.glb`);
const html=await fs.readFile('index.html','utf8'),js=await fs.readFile('app.js','utf8');
await fs.writeFile('AVATARES-AURA-DEMO.html',html.replace('<script src="app.js"></script>',()=>'<script>window.__AVATAR_GLB='+JSON.stringify(glbAlta)+'</script><script>'+seguro(js)+'</script>'));
console.log('Estudio autónomo listo.');

await build({...opciones,entryPoints:['src/embed.js'],outfile:'integration/embed.bundle.js'});
const embed=await fs.readFile('integration/embed.bundle.js','utf8');const mapa={};
for(const id of IDS){
 const glb=await b64(`assets/movil/${id}-bajo.glb`);
 const pagina='<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>html,body,#avatar{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}canvas{display:block;touch-action:none}</style><body data-avatar="'+id+'" data-calidad="baja"><div id="avatar"></div><script>window.__AVATAR_GLB={"'+id+'":"'+glb+'"}</script><script>'+seguro(embed)+'</script></body></html>';
 mapa[id]=pagina;await fs.writeFile(`integration/${id}-embed.html`,pagina);
}
await fs.writeFile('integration/avatarHtml.ts','// Generado por tools/build.mjs. Sin conexión: cada página trae su GLB móvil (LOD bajo).\nexport const AVATAR_HTML = '+JSON.stringify(mapa)+' as const;\n');
console.log('Páginas de WebView listas.');
