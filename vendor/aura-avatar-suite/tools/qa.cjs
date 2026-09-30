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


 const page=await browser.newPage({viewport:{width:1300,height:960},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('file://'+process.cwd()+'/AVATARES-AURA-DEMO.html');await page.waitForFunction(()=>window.AVATARS?.ready);
 const results={};
 for(const [id,filename] of [['claudio','CLAUDIO'],['aura','AURA-ORBE']]){
  await page.evaluate(id=>{AVATARS.select(id);AVATARS.stage.renderAt(1);},id);await page.screenshot({path:'qa/'+id+'-desktop.png'});
  await page.evaluate(()=>{AVATARS.stage.closeup();AVATARS.stage.renderAt(1);});await page.locator('.viewer').screenshot({path:'qa/'+id+'-face.png'});
  results[id]=await page.evaluate(()=>{const a=AVATARS.avatar,clips=AVATARS.buildClips();const finite=clips.every(c=>c.tracks.every(t=>[...t.values].every(Number.isFinite)));a.reset();a.setEmotion('triste');a.update(0,1,true);const sad=a.mouth.morphTargetInfluences[4]>.9;a.reset();a.setSpeech(.8,'O');a.update(0,1,true);const speech=a.mouth.morphTargetInfluences[2]>.7;a.setSpeech(0);a.update(0,1,true);const stopped=a.mouth.morphTargetInfluences[2]===0;return {stats:AVATARS.stage.stats(),clips:clips.map(c=>c.name),finite,sad,speech,stopped};});
  const base64=await page.evaluate(async()=>{const buffer=await AVATARS.exportGLB();let s='';for(const byte of new Uint8Array(buffer))s+=String.fromCharCode(byte);return btoa(s);});fs.writeFileSync('assets/'+filename+'.glb',Buffer.from(base64,'base64'));
  results[id].reload=await page.evaluate(async b64=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const gltf=await new AVATARS.GLTFLoader().parseAsync(bytes.buffer,'');const mixer=new AVATARS.THREE.AnimationMixer(gltf.scene);let finite=true;for(const clip of gltf.animations){mixer.stopAllAction();mixer.clipAction(clip).play();mixer.setTime(.8);gltf.scene.traverse(o=>finite&&=[...o.position.toArray(),...o.quaternion.toArray(),...o.scale.toArray()].every(Number.isFinite));}return {clips:gltf.animations.length,finite};},base64);
  for(const [e,g]of [['feliz','saludar'],['curioso','lentes'],['pensando',null],['risa','celebrar'],['carino','corazon'],['triste',null]]){
   await page.evaluate(([e,g])=>{const a=AVATARS.avatar;a.reset();a.intensity=1;a.setEmotion(e);a.time=0;if(g)a.playGesture(g);AVATARS.stage.resetCamera();AVATARS.stage.renderAt(1.1);},[e,g]);await page.locator('.viewer').screenshot({path:'qa/'+id+'-'+e+'.png'});
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{AVATARS.avatar.reset();AVATARS.avatar.setEmotion('feliz',.6);AVATARS.stage.resetCamera();AVATARS.stage.renderAt(1);});await page.screenshot({path:'qa/'+id+'-mobile.png'});
  results[id].mobile=await page.evaluate(()=>({noOverflow:document.documentElement.scrollWidth<=innerWidth,canvasWidth:document.querySelector('canvas').clientWidth}));
  await page.setViewportSize({width:1300,height:960});
  console.log(JSON.stringify({id,...results[id],bytes:fs.statSync('assets/'+filename+'.glb').size}));
 }
 // Exercise real AudioContext playback once on the shared audio controller.
 results.audio=await page.evaluate(async()=>{const n=16000,buffer=new ArrayBuffer(44+n*2),v=new DataView(buffer),text=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};text(0,'RIFF');v.setUint32(4,36+n*2,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,n,true);v.setUint32(28,n*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,n*2,true);for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.sin(i/n*440*Math.PI*2)*11000,true);const s=AVATARS.stage;s.avatar.reset();await s.audio.play({blob:new Blob([buffer],{type:'audio/wav'})});await new Promise(r=>setTimeout(r,300));s.audio.update(.1);s.avatar.update(.1,1,true);const drives=s.avatar.speech>.1&&s.avatar.mouth.morphTargetInfluences[0]>.1;s.audio.stop();return {drives,stops:s.avatar.speech===0};});
 // The mobile embed is the actual offline bundle, not a mocked DOM adapter.
 await page.addInitScript(()=>{window.bridgeMessages=[];window.ReactNativeWebView={postMessage:m=>window.bridgeMessages.push(JSON.parse(m))};});
 await page.goto('file://'+process.cwd()+'/integration/claudio-embed.html');await page.waitForFunction(()=>window.__aura);
 results.bridge=await page.evaluate(()=>{const a=window.__avatarStage.avatar;const ready=window.bridgeMessages.some(m=>m.tipo==='listo'&&m.avatar==='claudio');window.__aura({tipo:'estado',face:'LISTENING',emocion:'curioso'});const state=a.state==='listening'&&a.emotion==='curioso';window.__aura({tipo:'boca',n:.8,visema:'O'});const speech=a.speech===.8;const rejectsNaN=window.__aura({tipo:'boca',n:NaN})===false;window.__aura({tipo:'boca',n:0});const stop=a.speech===0;const noFakeSuccess=window.__aura({tipo:'tarea',tarea:'unknown'})===false;return {ready,state,speech,rejectsNaN,stop,noFakeSuccess};});
 results.errors=errors;fs.writeFileSync('qa/runtime-tests.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify({audio:results.audio,bridge:results.bridge,errors}));
 await browser.close();
 if(errors.length||!results.audio.drives||!results.audio.stops||Object.values(results.bridge).some(v=>v!==true)||['claudio','aura'].some(id=>!results[id].finite||!results[id].speech||!results[id].stopped||!results[id].reload.finite||!results[id].mobile.noOverflow))throw Error('Runtime checks failed');
})().catch(e=>{console.error(e);process.exit(1)});
