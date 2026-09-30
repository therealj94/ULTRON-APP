// Chromium sin pantalla con WebGL por software (SwiftShader), el mismo motor de la WebView de Android.
// Usa el Chromium de Playwright si está instalado (PLAYWRIGHT_BROWSERS_PATH); si no, el de
// @sparticuz/chromium, descomprimido una vez en /tmp. Los números de FPS que salen de aquí son
// una referencia RELATIVA entre modelos: SwiftShader dibuja en la CPU, no es un teléfono.
const fs=require('node:fs');
const path=require('node:path');
let playwright;try{playwright=require('playwright');}catch{playwright=require('playwright-core');}
const {chromium}=playwright;

const ARGS=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--autoplay-policy=no-user-gesture-required'];

function chromeDePlaywright(){
 const base=process.env.PLAYWRIGHT_BROWSERS_PATH||path.join(require('node:os').homedir(),'.cache/ms-playwright');
 if(!fs.existsSync(base))return null;
 for(const d of fs.readdirSync(base).sort().reverse()){
  for(const f of ['chrome-linux/chrome','chrome-linux/headless_shell']){
   const p=path.join(base,d,f);if(d.startsWith('chromium')&&fs.existsSync(p))return p;
  }
 }
 return null;
}

async function abrirNavegador(){
 const propio=chromeDePlaywright();
 if(propio)return chromium.launch({executablePath:propio,headless:true,args:ARGS});
 // Respaldo: el binario empaquetado de @sparticuz/chromium (el que usaba el QA original).
 const z=require('node:zlib'),runtime='/tmp/antonio-qa-runtime';fs.mkdirSync(runtime,{recursive:true});
 const sp=require('@sparticuz/chromium');const bin=path.dirname(require.resolve('@sparticuz/chromium/package.json'))+'/bin';
 if(!fs.existsSync(runtime+'/chromium'))fs.writeFileSync(runtime+'/chromium',z.brotliDecompressSync(fs.readFileSync(bin+'/chromium.br')));
 fs.chmodSync(runtime+'/chromium',0o755);
 if(!fs.existsSync(runtime+'/libGLESv2.so')){fs.writeFileSync(runtime+'/swiftshader.tar',z.brotliDecompressSync(fs.readFileSync(bin+'/swiftshader.tar.br')));require('node:child_process').execFileSync('tar',['--no-same-owner','-xf',runtime+'/swiftshader.tar','-C',runtime]);}
 return chromium.launch({executablePath:runtime+'/chromium',headless:true,args:[...sp.args,...ARGS],env:{...process.env,LD_LIBRARY_PATH:runtime}});
}

module.exports={abrirNavegador};
