// Uso: node windows/scripts/render-avatares.cjs windows/src/Aura.Windows/AvatarAssets (con playwright y pngjs; Chromium de /opt/pw-browsers o PLAYWRIGHT).
// Hojas de animación de los avatares 3D de AU-RA para el notch de Windows (6×4 fotogramas de 192 px).
const {chromium}=require('playwright');const fs=require('fs');const {PNG}=require('pngjs');
const OUT=process.argv[2];const S=384,F=192,N=24;
const CAM={aura:{cam:[.55,2.75,5.0],tgt:[0,2.45,0]},claudio:{cam:[.9,3.75,5.4],tgt:[-.05,3.62,0]},antonio:{cam:[1.0,3.7,5.6],tgt:[0,3.55,0]}};
const CLIPS=[['idle','idle','neutral',0,'sil'],['listening','listening','curioso',0,'sil'],['thinking','thinking','pensando',0,'sil'],['happy','success','feliz',0,'sil'],
 ['worried','idle','preocupado',0,'sil'],['speak0','speaking','neutral',.12,'MBP'],['speak1','speaking','neutral',.5,'E'],['speak2','speaking','neutral',1,'A']];
(async()=>{
 const b=await chromium.launch({...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const p=await b.newPage({viewport:{width:S,height:S},deviceScaleFactor:1});p.on('pageerror',e=>console.log('ERR',e.message));
 for(const id of Object.keys(CAM)){
  await p.goto('file://'+require('path').resolve(__dirname,'../../vendor/aura-avatar-suite/integration')+'/'+id+'-embed.html');
  await p.waitForFunction(()=>window.__avatarStage,null,{timeout:90000});
  fs.mkdirSync(OUT+'/'+id,{recursive:true});
  for(const [name,state,emo,speech,vis] of CLIPS){
   const atlas=new PNG({width:F*6,height:F*4});
   for(let i=0;i<N;i++){
    await p.evaluate(({c,state,emo,speech,vis,t,i})=>{const s=window.__avatarStage,a=s.avatar;s.renderer.shadowMap.enabled=false;
     s.camera.position.set(...c.cam);s.controls.target.set(...c.tgt);s.controls.update();a.setState(state);a.setEmotion(emo,.85);
     const lvl=speech?Math.max(0,Math.min(1,speech*(0.75+0.25*Math.sin(i*1.7)))):0;a.setSpeech(lvl,vis);s.renderAt(t);},{c:CAM[id],state,emo,speech,vis,t:i/8,i});
    const buf=await p.screenshot({omitBackground:true});const img=PNG.sync.read(buf);
    // reducir 384→192 promediando 2×2 (premultiplicado por alfa para bordes limpios)
    const ox=(i%6)*F,oy=Math.floor(i/6)*F;
    for(let y=0;y<F;y++)for(let x=0;x<F;x++){let r=0,g=0,bb=0,al=0;
     for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]]){const k=((y*2+dy)*S+(x*2+dx))*4;const A=img.data[k+3];r+=img.data[k]*A;g+=img.data[k+1]*A;bb+=img.data[k+2]*A;al+=A;}
     const o=((oy+y)*F*6+(ox+x))*4;atlas.data[o]=al?Math.round(r/al):0;atlas.data[o+1]=al?Math.round(g/al):0;atlas.data[o+2]=al?Math.round(bb/al):0;atlas.data[o+3]=Math.round(al/4);}
   }
   fs.writeFileSync(OUT+'/'+id+'/'+name+'.png',PNG.sync.write(atlas,{colorType:6}));console.log(id,name);
  }
 }
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
