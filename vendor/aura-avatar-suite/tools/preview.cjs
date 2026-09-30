const fs=require('node:fs');
let playwright;try{playwright=require('playwright');}catch{playwright=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');}
const {chromium}=playwright;
const runtime='/tmp/antonio-qa-runtime';
(async()=>{
 const z=require('zlib');fs.mkdirSync(runtime,{recursive:true});
 if(!fs.existsSync(runtime+'/chromium')||fs.statSync(runtime+'/chromium').size<190000000)fs.writeFileSync(runtime+'/chromium',z.brotliDecompressSync(fs.readFileSync('node_modules/@sparticuz/chromium/bin/chromium.br')));
 fs.chmodSync(runtime+'/chromium',0o755);
 if(!fs.existsSync(runtime+'/libGLESv2.so')){fs.writeFileSync(runtime+'/swiftshader.tar',z.brotliDecompressSync(fs.readFileSync('node_modules/@sparticuz/chromium/bin/swiftshader.tar.br')));require('child_process').execFileSync('tar',['--no-same-owner','-xf',runtime+'/swiftshader.tar','-C',runtime]);}
 const browser=await chromium.launch({executablePath:runtime+'/chromium',headless:true,args:[...require('@sparticuz/chromium').args,'--enable-unsafe-swiftshader'],env:{...process.env,LD_LIBRARY_PATH:runtime}});


 const page=await browser.newPage({viewport:{width:720,height:900},deviceScaleFactor:1});page.on('pageerror',e=>{throw e});
 await page.goto('file://'+process.cwd()+'/AVATARES-AURA-DEMO.html');await page.waitForFunction(()=>window.AVATARS?.ready);
 await page.addStyleTag({content:'header,aside,.view-buttons,.hint{display:none!important}main{display:block!important}.heading{position:absolute!important;left:32px!important;top:24px!important;padding:0!important}.viewer,#stage{height:900px!important;min-height:0!important}'});
 fs.mkdirSync('qa/frames',{recursive:true});
 for(let i=0;i<144;i++){
  const id=i<72?'claudio':'aura',j=i%72,t=j/12,g=j<36?'saludar':'explicar',e=j<36?'feliz':'risa';
  await page.evaluate(({id,j,t,g,e})=>{if(AVATARS.id!==id)AVATARS.select(id);const s=AVATARS.stage,a=s.avatar;s.renderer.setPixelRatio(1);s.renderer.shadowMap.enabled=false;a.reset();a.intensity=.8;a.setEmotion(id==='aura'&&j>=36?'carino':e);a.time=j<36?0:3;a.playGesture(g);s.resetCamera();s.camera.position.set(id==='aura'?2.2:2.8,id==='aura'?2.85:2.9,id==='aura'?7.6:9.9);s.controls.target.set(id==='claudio'?-.13:0,id==='aura'?2.25:2.38,0);s.renderAt(t);document.querySelector('#subtitle').textContent=j<36?'Te saluda y sigue la mirada':'Se expresa y te acompaña';}, {id,j,t,g,e});
  await page.locator('.viewer').screenshot({path:'qa/frames/'+String(i).padStart(4,'0')+'.png'});
  if(i%36===0)console.log('Preview',id,'frame',i);
 }
 // Final mobile layout after the corrected heading placement.
 const mobile=page;await mobile.setViewportSize({width:390,height:844});await mobile.goto('file://'+process.cwd()+'/AVATARES-AURA-DEMO.html');await mobile.waitForFunction(()=>window.AVATARS?.ready);
 const checks={};for(const id of ['claudio','aura']){await mobile.evaluate(id=>{AVATARS.select(id);AVATARS.stage.renderAt(1);},id);await mobile.screenshot({path:'qa/'+id+'-mobile.png'});checks[id]=await mobile.evaluate(()=>{const h=document.querySelector('.heading').getBoundingClientRect(),c=document.querySelector('#stage').getBoundingClientRect();return {noOverflow:document.documentElement.scrollWidth<=innerWidth,titleAboveCanvas:h.bottom<=c.top+1};});}
 fs.writeFileSync('qa/mobile-layout.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
