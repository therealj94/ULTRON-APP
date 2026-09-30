// Servidor estático mínimo en 127.0.0.1 para las páginas de generación y QA (Chromium no deja
// leer file:// con fetch). Solo sirve archivos de esta carpeta.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const TIPOS={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.glb':'model/gltf-binary','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav'};
function servir(raiz){
 return new Promise(ok=>{
  const srv=http.createServer((req,res)=>{
   const url=decodeURIComponent(new URL(req.url,'http://x').pathname);const ruta=path.join(raiz,url);
   if(!ruta.startsWith(raiz)||!fs.existsSync(ruta)||fs.statSync(ruta).isDirectory()){res.writeHead(404);return res.end();}
   res.writeHead(200,{'content-type':TIPOS[path.extname(ruta)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(ruta).pipe(res);
  });
  srv.listen(0,'127.0.0.1',()=>ok({url:`http://127.0.0.1:${srv.address().port}`,cerrar:()=>srv.close()}));
 });
}
module.exports={servir};
