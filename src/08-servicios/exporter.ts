// Generates the autonomous, zero-dependency standalone HTML simulator for ULTRON FP

export function downloadStandaloneSimulator(): void {
  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
<title>ULTRON FP · Simulador Kiosk Stand</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Rajdhani:wght@600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body,#app{width:100%;height:100%;background:#000;overflow:hidden;font-family:"IBM Plex Mono",monospace;color:#05E1FF;touch-action:none;user-select:none;-webkit-user-select:none}
canvas{position:absolute;inset:0;width:100%;height:100%}
.boot{position:absolute;inset:0;z-index:50;display:grid;place-items:center;background:#000;transition:opacity .8s}
.boot.gone{opacity:0;pointer-events:none}
.boot b{display:block;font-family:Rajdhani,sans-serif;letter-spacing:.46em;font-size:22px;margin-top:8px;text-align:center}
.tag{position:absolute;left:50%;bottom:10%;transform:translateX(-50%);z-index:6;font-family:Rajdhani,sans-serif;letter-spacing:.38em;font-size:18px;opacity:.85;pointer-events:none}
.bubble{position:absolute;left:50%;bottom:18%;transform:translateX(-50%);z-index:7;max-width:70vw;text-align:center;font-size:13px;color:#dff8ff;opacity:0;transition:opacity .3s;pointer-events:none;text-shadow:0 0 16px rgba(5,225,255,.35);background:rgba(0,0,0,0.6);padding:6px 14px;border-radius:20px;border:1px solid rgba(5,225,255,0.2)}
.bubble.on{opacity:1}
.listen{position:absolute;left:50%;top:11%;transform:translateX(-50%);z-index:7;letter-spacing:.4em;font-size:11px;opacity:0;transition:opacity .25s;pointer-events:none;font-weight:700}
.listen.on{opacity:.9}
.dock,.sheet{position:absolute;left:0;right:0;z-index:20;transition:transform .38s cubic-bezier(.2,.8,.2,1)}
.dock{bottom:0;transform:translateY(115%);padding:14px 14px 16px;background:linear-gradient(to top,#000,transparent)}
.dock.open{transform:none}
.sheet{top:0;transform:translateY(-115%);padding:16px 14px 18px;background:linear-gradient(to bottom,#000 88%,transparent);max-height:62%;overflow:auto}
.sheet.open{transform:none}
.fabs{display:flex;justify-content:center;gap:10px;margin-bottom:8px}
.fab{width:44px;height:44px;border-radius:50%;border:1px solid rgba(5,225,255,.3);background:rgba(0,0,0,.6);color:#05E1FF;cursor:pointer;font-size:16px}
.fab.on{border-color:#05E1FF;background:rgba(5,225,255,0.2);box-shadow:0 0 10px rgba(5,225,255,0.4)}
.row{display:flex;gap:8px;max-width:600px;margin:0 auto}
.row input{flex:1;background:#05080c;border:1px solid rgba(5,225,255,.28);color:#05E1FF;font:12px "IBM Plex Mono",monospace;padding:10px;border-radius:4px;outline:none}
.row button{border:0;background:#05E1FF;color:#001418;font-family:Rajdhani,sans-serif;letter-spacing:.14em;font-weight:700;padding:0 14px;border-radius:4px;cursor:pointer}
.modes{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:8px 0}
.modes button{border:1px solid rgba(5,225,255,.22);background:rgba(0,0,0,0.4);color:#05E1FF;font:11px "IBM Plex Mono",monospace;letter-spacing:.08em;padding:9px 3px;border-radius:4px;cursor:pointer}
.modes button.on{border-color:#05E1FF;background:rgba(5,225,255,.18);font-weight:700}
.emos{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.emos button{border:1px solid rgba(5,225,255,.2);background:transparent;color:#8FA3B0;font:10px "IBM Plex Mono",monospace;padding:6px 8px;border-radius:4px;cursor:pointer}
h2{font-family:Rajdhani,sans-serif;letter-spacing:.3em;font-size:15px}
.hint{color:#8FA3B0;font-size:11px;line-height:1.45;margin-top:6px}
.perm{position:absolute;inset:0;z-index:40;display:none;place-items:center;background:rgba(0,0,0,.84)}
.perm.open{display:grid}
.box{width:min(420px,88vw);border:1px solid rgba(5,225,255,.36);background:#05080c;padding:20px;border-radius:8px}
.acts{display:flex;gap:8px;margin-top:14px}
.acts button{flex:1;padding:11px;border:0;font-family:Rajdhani,sans-serif;letter-spacing:.16em;font-weight:700;border-radius:4px;cursor:pointer}
.no{background:transparent;border:1px solid #FF3B3B!important;color:#FF3B3B}
.yes{background:#05E1FF;color:#001418}
</style>
</head>
<body>
<div id="app">
  <div class="boot" id="boot">
    <div>
      <svg width="72" height="56" viewBox="0 0 68 52" fill="none">
        <path d="M6 36C6 14 62 14 62 36" stroke="#05E1FF" stroke-width="2.5"/>
        <circle cx="34" cy="34" r="11" stroke="#05E1FF" stroke-width="2"/>
        <circle cx="34" cy="34" r="3" fill="#05E1FF"/>
      </svg>
      <b>ULTRON FP</b>
      <p style="text-align:center;font-size:11px;color:#8FA3B0;margin-top:4px">INICIANDO VISOR DE JUNTA DIRECTIVA...</p>
    </div>
  </div>
  <canvas id="c"></canvas>
  <div class="listen" id="listen">LISTENING · RECEPTANDO VOZ</div>
  <div class="bubble" id="bubble"></div>
  <div class="tag" id="tag">GUARDIAN</div>
  <div class="dock" id="dock">
    <div class="fabs">
      <button class="fab on" id="mic" title="Micrófono">REC</button>
      <button class="fab on" id="spk" title="Voz / Síntesis">VOL</button>
      <button class="fab" id="cam" title="Visión">CAM</button>
      <button class="fab" id="slp" title="Reposo / Despertar">SLP</button>
    </div>
    <form class="row" id="form"><input id="cmd" placeholder="whatsapp · correo · clima · modo gold" autocomplete="off"/><button>ENVIAR</button></form>
  </div>
  <div class="sheet" id="sheet">
    <h2>AJUSTES DE SISTEMA · ULTRON FP</h2>
    <div class="modes" id="modes"></div>
    <div class="emos" id="emos"></div>
    <p class="hint">Elige un modo y el panel se cierra automáticamente para contemplar la cara. Desliza hacia arriba para ver herramientas.</p>
  </div>
  <div class="perm" id="perm">
    <div class="box">
      <div class="hint" style="letter-spacing:.22em;color:#05E1FF">PERMISO DE JUNTA</div>
      <h2 id="pt" style="margin:4px 0 6px">WhatsApp</h2>
      <p class="hint" id="pd">La orden sale del dispositivo.</p>
      <div class="acts"><button class="no" id="pno">DENEGAR</button><button class="yes" id="pyes">CONCEDER</button></div>
    </div>
  </div>
</div>
<script>
(()=>{
const cv=document.getElementById("c"), x=cv.getContext("2d");
const MODES=["MINING","GOLD","CREATIVE","ANALYTICAL","STRATEGIC","GUARDIAN","EXPLORER"];
const EMOS=["IDLE","LISTENING","THINKING","SPEAKING","HAPPY","CONCERNED","ANGRY","SLEEPING"];
const S={
  face:"IDLE", prev:"IDLE", mix:1, mode:"GUARDIAN",
  t:0, poke:0, lp:0, li:0, en:80, mic:true, spk:true, boot:true,
  perm:{wa:false,em:false}, pend:null
};
const A={
  blink:1, blinkL:1, blinkR:1, blinking:false, phase:0, next:1.8, double:false, wink:0,
  lx:0, ly:0, tx:0, ty:0, saccadeIn:0,
  dilate:.34, dilateT:.34,
  brow:0, browT:0,
  breath:1, bounce:0, squashX:1, squashY:1,
  shake:0, tilt:0,
  mouth:0, mouthT:0, smile:0, smileT:0,
  pulse:0, think:0, sleepZ:0
};
function resize(){const d=Math.min(devicePixelRatio||1,2);cv.width=innerWidth*d;cv.height=innerHeight*d;}
addEventListener("resize",resize);resize();
const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;

function targetsFor(face){
  switch(face){
    case "LISTENING": return {dilate:.42,brow:.15,mouth:.08,smile:0,bounce:.02};
    case "THINKING":  return {dilate:.28,brow:.35,mouth:.04,smile:0,bounce:0};
    case "SPEAKING":  return {dilate:.38,brow:.1,mouth:.55,smile:.15,bounce:.04};
    case "HAPPY":     return {dilate:.36,brow:-.2,mouth:.2,smile:1,bounce:.12};
    case "CONCERNED": return {dilate:.3,brow:.45,mouth:.1,smile:-.55,bounce:0};
    case "ANGRY":     return {dilate:.22,brow:.8,mouth:.12,smile:-.85,bounce:0};
    case "SLEEPING":  return {dilate:.2,brow:.1,mouth:0,smile:0,bounce:0};
    default:          return {dilate:.34,brow:0,mouth:.06,smile:.12,bounce:0};
  }
}

function setFace(n,ms){
  if(n!==S.face){ S.prev=S.face; S.face=n; S.mix=0; }
  const tg=targetsFor(n);
  A.dilateT=tg.dilate; A.browT=tg.brow; A.mouthT=tg.mouth; A.smileT=tg.smile;
  document.getElementById("listen").classList.toggle("on", n==="LISTENING");
  if(n==="ANGRY") A.shake=1.15;
  if(n==="CONCERNED") A.shake=.45;
  if(n==="HAPPY") A.bounce=.2;
  if(ms){clearTimeout(setFace._t);setFace._t=setTimeout(()=>{if(S.face===n)setFace("IDLE");},ms);}
}

function say(t){
  const b=document.getElementById("bubble"); b.textContent=t; b.classList.add("on");
  clearTimeout(say._t); say._t=setTimeout(()=>b.classList.remove("on"),2800);
  if(S.spk&&speechSynthesis){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang="es-ES";u.rate=.95;u.pitch=.72;speechSynthesis.speak(u);}
}
function col(){
  if(S.face==="ANGRY") return "#FF3B3B";
  if(S.face==="CONCERNED") return "#FFB648";
  if(S.mode==="GOLD") return "#F5C542";
  return "#05E1FF";
}

function scheduleBlink(kind){
  A.blinking=true; A.phase=0; A.wink=0; A.double=false;
  if(kind==="double") A.double=true;
  if(kind==="wink") A.wink=Math.random()<.5?-1:1;
  A.next = S.face==="SLEEPING"? 999 : (S.face==="ANGRY"? 1.1+Math.random() : 2.2+Math.random()*3.4);
}

function idleBeats(dt){
  if(S.face!=="IDLE") return;
  if(Math.random()<dt*.22){
    const roll=Math.random();
    if(roll<.45){ A.tx=(Math.random()-.5)*.7; A.ty=(Math.random()-.5)*.28; A.saccadeIn=.12; }
    else if(roll<.62) scheduleBlink("double");
    else if(roll<.72) scheduleBlink("wink");
    else if(roll<.84){ A.smileT=.35; setTimeout(()=>A.smileT=.12,700); }
    else { A.tx=0; A.ty=0; }
  }
}

function stepAnim(dt){
  S.t+=dt; S.li+=dt; S.en=Math.max(8,S.en-dt*.25); S.mix=Math.min(1,S.mix+dt*3.2);
  if(S.li>1) S.poke=0;
  if(S.li>26 && S.face==="IDLE" && S.en<36) goSleep();

  A.next-=dt;
  if(!A.blinking && A.next<=0 && S.face!=="SLEEPING") scheduleBlink(Math.random()<.18?"double":"single");
  if(A.blinking){
    A.phase+=dt/(A.double?0.28:0.15);
    const p=A.phase;
    let k;
    if(A.double){
      if(p<0.35) k=1-(p/0.35);
      else if(p<0.5) k=(p-0.35)/0.15;
      else if(p<0.85) k=1-((p-0.5)/0.35);
      else k=(p-0.85)/0.15;
    } else {
      k = p<.45 ? 1-(p/.45) : (p-.45)/.55;
    }
    k=clamp(k,0,1);
    const close=ease(1-k);
    const openAmt=S.face==="SLEEPING"?0.06: (0.06+0.94*(1-close));
    if(A.wink<0){ A.blinkL=openAmt; A.blinkR=S.face==="SLEEPING"?0.06:1; }
    else if(A.wink>0){ A.blinkR=openAmt; A.blinkL=S.face==="SLEEPING"?0.06:1; }
    else { A.blinkL=A.blinkR=openAmt; }
    A.blink=Math.min(A.blinkL,A.blinkR);
    if(A.phase>=1){ A.blinking=false; A.blinkL=A.blinkR=S.face==="SLEEPING"?0.06:1; A.blink=A.blinkL; }
  } else if(S.face==="SLEEPING"){
    A.blinkL=A.blinkR=A.blink=0.06+0.02*Math.sin(S.t*1.2);
  }

  idleBeats(dt);
  const follow=A.saccadeIn>0?0.22:0.08;
  if(A.saccadeIn>0) A.saccadeIn-=dt;
  A.lx=lerp(A.lx,A.tx,1-Math.pow(follow,dt*60/16));
  A.ly=lerp(A.ly,A.ty,1-Math.pow(follow,dt*60/16));

  A.dilate=lerp(A.dilate,A.dilateT,1-Math.pow(.08,dt));
  A.brow=lerp(A.brow,A.browT,1-Math.pow(.06,dt));
  A.smile=lerp(A.smile,A.smileT,1-Math.pow(.07,dt));
  const talk = S.face==="SPEAKING" ? 0.25+0.75*Math.abs(Math.sin(S.t*11)+0.35*Math.sin(S.t*19)) : A.mouthT;
  A.mouth=lerp(A.mouth,talk, S.face==="SPEAKING"?1-Math.pow(.02,dt):1-Math.pow(.08,dt));

  A.breath = 0.972 + 0.028*Math.sin(S.t*(S.face==="SLEEPING"?Math.PI*0.55:Math.PI));
  A.bounce = lerp(A.bounce, targetsFor(S.face).bounce + (S.face==="HAPPY"?0.05*Math.sin(S.t*6):0), 1-Math.pow(.1,dt));
  A.squashY = A.breath * (1+A.bounce*0.15);
  A.squashX = 1/Math.sqrt(A.squashY);
  A.shake *= Math.pow(.12,dt);
  if(S.face==="ANGRY") A.shake=Math.max(A.shake,.25+.15*Math.sin(S.t*28));
  A.tilt = lerp(A.tilt, S.face==="THINKING"?0.12*Math.sin(S.t*0.7): S.face==="HAPPY"?-0.04:0, 1-Math.pow(.08,dt));
  A.pulse = S.face==="LISTENING" ? (A.pulse+dt)%1.6 : Math.max(0,A.pulse-dt);
  A.think = S.face==="THINKING" ? A.think+dt : Math.max(0,A.think-dt);
  A.sleepZ = S.face==="SLEEPING" ? A.sleepZ+dt : 0;
}

function draw(dt){
  stepAnim(dt);
  const w=cv.width,h=cv.height; x.clearRect(0,0,w,h);
  const C=col();
  const cx=w/2 + A.shake*(Math.random()-.5)*14;
  const cy=h*.44 - A.bounce*Math.min(w,h)*0.02 + A.shake*(Math.random()-.5)*8;
  const R=Math.min(w,h)*.155;
  const g=x.createRadialGradient(cx,cy,R*.3,cx,cy,R*3.5);
  g.addColorStop(0,C+"16"); g.addColorStop(1,"#0000");
  x.fillStyle=g; x.fillRect(0,0,w,h);

  x.save();
  x.translate(cx,cy);
  x.rotate(A.tilt);
  x.scale(A.squashX, A.squashY);
  x.translate(-cx,-cy);

  if(S.face==="LISTENING") drawListenRings(cx,cy,R,C);
  if(S.face==="THINKING") drawThinkDots(cx,cy,R,C);
  sparkles(cx,cy,R,C);
  drawMode(cx,cy,R,C);
  if(S.face==="SLEEPING") drawZ(cx,cy,R,C);
  x.restore();
}

function drawListenRings(cx,cy,R,C){
  for(let i=0;i<3;i++){
    const p=(A.pulse+i/3)%1;
    x.save(); x.strokeStyle=C; x.globalAlpha=(1-p)*.28; x.lineWidth=R*.03; x.shadowColor=C; x.shadowBlur=12;
    x.beginPath(); x.ellipse(cx,cy,R*(1.8+p*1.6),R*(1.05+p*.9),0,0,Math.PI*2); x.stroke();
    x.restore();
  }
}
function drawThinkDots(cx,cy,R,C){
  x.save(); x.fillStyle=C; x.shadowColor=C; x.shadowBlur=10;
  for(let i=0;i<3;i++){
    const a=A.think*2.2+i*2.1;
    x.globalAlpha=.35+.65*(.5+.5*Math.sin(a));
    x.beginPath(); x.arc(cx-R*.35+i*R*.35, cy-R*2.05, 3.4+1.6*Math.sin(a),0,Math.PI*2); x.fill();
  }
  x.restore();
}
function drawZ(cx,cy,R,C){
  x.save(); x.fillStyle=C; x.font=\`\${Math.round(R*.28)}px Rajdhani\`; x.globalAlpha=.45;
  const z=A.sleepZ;
  x.fillText("z", cx+R*1.5, cy-R*(1.1+ (z%2)*0.25));
  x.globalAlpha=.3; x.fillText("z", cx+R*1.85, cy-R*(1.45+(z%2.4)*0.2));
  x.restore();
}

function stroke(C,w,blur){x.strokeStyle=C;x.fillStyle=C;x.lineWidth=w;x.lineCap="round";x.lineJoin="round";x.shadowColor=C;x.shadowBlur=blur||14;}
function ring(a,b,rx,ry){x.beginPath();x.ellipse(a,b,rx,Math.max(1.2,ry),0,0,Math.PI*2);x.stroke();}

function livingEye(ex,ey,R,C,opt={}){
  const side=opt.side||1;
  const open = side<0?A.blinkL:A.blinkR;
  const angry=S.face==="ANGRY", happy=S.face==="HAPPY"||opt.smile||A.smile>.75;
  const listen=S.face==="LISTENING"?1.06+0.02*Math.sin(S.t*6):1;
  const rx=R*listen, ry=R*open*(angry?.68:1);
  x.save(); x.translate(ex,ey);
  if(S.face==="THINKING") x.rotate(side*0.15*Math.sin(S.t*1.4));
  if(happy){
    stroke(C,R*.07,16);
    x.beginPath(); x.ellipse(0,R*.1,rx*.9,R*.36,0,Math.PI*1.12,Math.PI*1.88); x.stroke();
    x.restore(); return;
  }
  const halo=x.createRadialGradient(0,0,rx*.2,0,0,rx*1.3);
  halo.addColorStop(0,C+"40"); halo.addColorStop(1,"#0000");
  x.fillStyle=halo; x.beginPath(); x.ellipse(0,0,rx*1.2,Math.max(ry*1.2,2),0,0,Math.PI*2); x.fill();
  stroke(C,R*.055,18); ring(0,0,rx,ry);
  if(open>.18 && !opt.hollow){
    const ix=A.lx*rx*.28, iy=A.ly*ry*.28, ir=rx*.56;
    x.save(); x.beginPath(); x.ellipse(0,0,rx*.9,Math.max(ry*.9,1),0,0,Math.PI*2); x.clip();
    const ig=x.createRadialGradient(ix,iy,ir*.12,ix,iy,ir);
    ig.addColorStop(0,C); ig.addColorStop(.5,C+"bb"); ig.addColorStop(1, opt.iris||"#032830");
    x.fillStyle=ig; x.beginPath(); x.arc(ix,iy,ir,0,Math.PI*2); x.fill();
    x.fillStyle="#000"; x.beginPath(); x.arc(ix,iy,ir*A.dilate*A.breath,0,Math.PI*2); x.fill();
    x.fillStyle="#fff"; x.globalAlpha=.85; x.beginPath(); x.arc(ix-ir*.28,iy-ir*.3,ir*.15,0,Math.PI*2); x.fill();
    x.restore();
  }
  if(opt.glyph) opt.glyph(R,C);
  stroke(C,R*(.05+.03*Math.abs(A.brow)),10);
  const by=-ry*(1.15+A.brow*.25);
  x.beginPath();
  if(side<0){ x.moveTo(-rx, by-A.brow*R*.15); x.lineTo(rx*.55, by+A.brow*R*.2); }
  else { x.moveTo(rx, by-A.brow*R*.15); x.lineTo(-rx*.55, by+A.brow*R*.2); }
  if(Math.abs(A.brow)>.08 || angry) x.stroke();
  x.restore();
}

function mouth(cx,cy,R,C,kind){
  stroke(C,R*.05,12);
  const w=R*1.05, y=cy;
  const sm=A.smile, op=A.mouth;
  x.beginPath();
  if(S.face==="SPEAKING" || op>.35){
    x.moveTo(cx-w,y);
    for(let i=0;i<=22;i++){
      const X=cx-w+2*w*i/22;
      const env=Math.sin(Math.PI*i/22);
      x.lineTo(X,y+env*R*(.12+op*.28)*Math.sin(S.t*13+i*.5));
    }
  } else if(sm>.4 || kind==="smile"){
    x.moveTo(cx-w,y); x.quadraticCurveTo(cx,y+R*(.2+sm*.35),cx+w,y);
  } else if(sm<-.4 || kind==="frown"){
    x.moveTo(cx-w*.8,y+R*.14); x.quadraticCurveTo(cx,y-R*(.12-sm*.12),cx+w*.8,y+R*.14);
  } else if(kind==="wave"){
    x.moveTo(cx-w,y); for(let i=0;i<=14;i++) x.lineTo(cx-w+2*w*i/14,y+Math.sin(i+S.t*2)*R*.07);
  } else {
    x.moveTo(cx-w*.7,y+sm*R*.08); x.quadraticCurveTo(cx,y+R*.1+sm*R*.12,cx+w*.7,y+sm*R*.08);
  }
  x.stroke();
}

function sparkles(cx,cy,R,C){
  x.save(); x.shadowBlur=0; x.strokeStyle=C;
  const n=S.mode==="GOLD"||S.mode==="CREATIVE"||S.mode==="EXPLORER"?7:3;
  for(let i=0;i<n;i++){
    const a=S.t*.6+i*1.1, r=R*(1.6+i*.18);
    const px=cx+Math.cos(a)*r*1.4, py=cy-R*1.3+Math.sin(a*.8)*r*.35;
    x.globalAlpha=.25+.35*Math.abs(Math.sin(S.t*2+i));
    x.beginPath(); x.moveTo(px-4,py);x.lineTo(px+4,py);x.moveTo(px,py-4);x.lineTo(px,py+4);x.stroke();
  }
  x.restore();
}

function drawMode(cx,cy,R,C){
  const d=R*1.28, ey=cy, m=S.mode;
  if(m==="MINING"){
    x.save(); x.translate(cx-R*1.35,cy-R*1.45); x.rotate(S.t*.5);
    stroke(C,R*.04,10); ring(0,0,R*.22,R*.22);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;x.beginPath();x.moveTo(Math.cos(a)*R*.22,Math.sin(a)*R*.22);x.lineTo(Math.cos(a)*R*.34,Math.sin(a)*R*.34);x.stroke();}
    x.restore();
    livingEye(cx-d,ey,R,C,{side:-1});
    livingEye(cx+d,ey,R,C,{side:1,glyph(R){stroke(C,R*.05,8);x.beginPath();x.moveTo(R*.08,R*.28);x.lineTo(-R*.14,-R*.38);x.stroke();x.beginPath();x.arc(-R*.2,-R*.44,R*.2,-.2,Math.PI+.3);x.stroke();}});
    mouth(cx,cy+R*1.42,R,C,"flat");
  } else if(m==="GOLD"){
    stroke("#F5C542",R*.05,16);
    x.beginPath(); x.moveTo(cx-R*.5,cy-R*1.55); x.lineTo(cx-R*.28,cy-R*1.82); x.lineTo(cx+R*.28,cy-R*1.82); x.lineTo(cx+R*.5,cy-R*1.55); x.closePath(); x.stroke();
    livingEye(cx-d,ey,R,"#F5C542",{side:-1,iris:"#3a2a08"});
    livingEye(cx+d,ey,R,"#F5C542",{side:1,iris:"#3a2a08"});
    mouth(cx,cy+R*1.42,R,"#F5C542","smile");
  } else if(m==="CREATIVE"){
    stroke(C,R*.045,12);
    x.beginPath(); x.arc(cx,cy-R*1.62,R*.2,0,Math.PI*2); x.stroke();
    x.beginPath(); x.moveTo(cx-R*.08,cy-R*1.42); x.lineTo(cx+R*.08,cy-R*1.42); x.stroke();
    livingEye(cx-d,ey,R,C,{side:-1,glyph(R){stroke(C,R*.04,6);x.beginPath();x.moveTo(0,-R*.2);x.lineTo(0,R*.2);x.moveTo(-R*.2,0);x.lineTo(R*.2,0);x.stroke();}});
    livingEye(cx+d,ey,R,C,{side:1,glyph(R){stroke(C,R*.045,6);x.beginPath();x.moveTo(-R*.06,R*.28);x.lineTo(R*.04,-R*.26);x.lineTo(R*.16,-R*.1);x.stroke();}});
    mouth(cx,cy+R*1.42,R,C,"wave");
    ["#05E1FF","#FFB648","#ff6b9a"].forEach((k,i)=>{x.fillStyle=k;x.shadowBlur=0;x.globalAlpha=.6;x.beginPath();x.arc(cx+R*(.9+i*.22),cy-R*(1.15-i*.12),3.2,0,Math.PI*2);x.fill();});
  } else if(m==="ANALYTICAL"){
    stroke(C,R*.04,10);
    x.beginPath(); x.moveTo(cx-R*.7,cy-R*1.42); x.lineTo(cx-R*.22,cy-R*1.72); x.lineTo(cx,cy-R*1.4); x.lineTo(cx+R*.22,cy-R*1.72); x.lineTo(cx+R*.7,cy-R*1.42); x.stroke();
    livingEye(cx-d,ey,R,C,{side:-1});
    livingEye(cx+d,ey,R,C,{side:1,glyph(R){stroke(C,R*.05,8);x.beginPath();x.arc(R*.06,R*.04,R*.2,0,Math.PI*2);x.stroke();x.beginPath();x.moveTo(R*.2,R*.18);x.lineTo(R*.42,R*.42);x.stroke();}});
    mouth(cx,cy+R*1.42,R,C,"flat");
  } else if(m==="STRATEGIC"){
    stroke(C,R*.04,10);
    x.beginPath(); x.moveTo(cx-R*.4,cy-R*1.38); x.lineTo(cx-R*.16,cy-R*1.68); x.lineTo(cx,cy-R*1.38); x.lineTo(cx+R*.16,cy-R*1.68); x.lineTo(cx+R*.4,cy-R*1.38); x.stroke();
    livingEye(cx-d,ey,R,C,{side:-1,hollow:S.face==="IDLE",glyph(R){x.font=\`\${Math.round(R*.55)}px serif\`;x.textAlign="center";x.textBaseline="middle";x.shadowBlur=0;x.fillStyle=C;stroke(C,R*.05,6);x.beginPath();x.arc(0,0,R*.2,0,Math.PI*2);x.moveTo(-R*.3,0);x.lineTo(R*.3,0);x.moveTo(0,-R*.3);x.lineTo(0,R*.3);x.stroke();}});
    livingEye(cx+d,ey,R,C,{side:1,hollow:S.face==="IDLE",glyph(R){x.font=\`\${Math.round(R*.55)}px serif\`;x.textAlign="center";x.textBaseline="middle";x.shadowBlur=0;x.fillStyle=C;stroke(C,R*.05,6);x.beginPath();x.arc(0,0,R*.2,0,Math.PI*2);x.moveTo(-R*.3,0);x.lineTo(R*.3,0);x.moveTo(0,-R*.3);x.lineTo(0,R*.3);x.stroke();}});
    mouth(cx,cy+R*1.42,R,C,"flat");
  } else if(m==="GUARDIAN"){
    stroke(C,R*.04,10);
    x.beginPath(); x.moveTo(cx-R*.36,cy-R*1.36); x.lineTo(cx-R*.12,cy-R*1.64); x.lineTo(cx,cy-R*1.36); x.lineTo(cx+R*.12,cy-R*1.64); x.lineTo(cx+R*.36,cy-R*1.36); x.stroke();
    function shield(px,side){livingEye(px,ey,R,C,{side,hollow:true,glyph(R){stroke(C,R*.05,8);x.beginPath();x.moveTo(0,-R*.28);x.lineTo(R*.22,-R*.08);x.lineTo(R*.16,R*.26);x.lineTo(0,R*.34);x.lineTo(-R*.16,R*.26);x.lineTo(-R*.22,-R*.08);x.closePath();x.stroke();}});}
    shield(cx-d,-1); shield(cx+d,1);
    function lock(px,py){x.strokeRect(px-5,py,10,8);x.beginPath();x.arc(px,py,4,Math.PI,0);x.stroke();}
    stroke(C,R*.03,6); lock(cx+R*1.75,cy-R*.85); lock(cx-R*1.85,cy+R*.2); lock(cx+R*1.65,cy+R*.4);
    mouth(cx,cy+R*1.42,R,C,"flat");
  } else {
    x.save(); x.translate(cx+R*1.2,cy-R*1.48); x.rotate(-.45);
    stroke(C,R*.04,8); x.beginPath(); x.moveTo(-R*.48,0); x.lineTo(R*.32,0); x.stroke(); x.beginPath(); x.arc(R*.42,0,R*.1,0,Math.PI*2); x.stroke();
    x.restore();
    livingEye(cx-d,ey,R,C,{side:-1,glyph(R){stroke(C,R*.04,6);x.beginPath();x.moveTo(0,-R*.2);x.lineTo(0,R*.2);x.moveTo(-R*.2,0);x.lineTo(R*.2,0);x.stroke();}});
    livingEye(cx+d,ey,R,C,{side:1,glyph(R){stroke(C,R*.035,6);for(let i=0;i<8;i++){const a=i*Math.PI/4+S.t*.25;x.beginPath();x.moveTo(Math.cos(a)*R*.08,Math.sin(a)*R*.08);x.lineTo(Math.cos(a)*R*.26,Math.sin(a)*R*.26);x.stroke();}}});
    mouth(cx,cy+R*1.42,R,C,"frown");
  }
}

function interact(){S.li=0;S.en=Math.min(100,S.en+8);}
function poke(){
  if(S.face==="SLEEPING"){wake();return;}
  interact();
  const now=performance.now(); S.poke=(now-S.lp<800)?S.poke+1:1; S.lp=now;
  if(S.poke===1) scheduleBlink("single");
  else if(S.poke===2) listen();
  else if(S.poke===3){setFace("CONCERNED",1400);say("No golpees el visor.");}
  else {setFace("ANGRY",2400);say("Basta.");}
}
function goSleep(){setFace("SLEEPING");say("Reposo.");S.en=18;}
function wake(){interact();setFace("IDLE");S.en=80;scheduleBlink("double");say("De vuelta.");}
function listen(){
  if(!S.mic||S.face==="SLEEPING")return;
  interact(); setFace("LISTENING"); say("Te escucho.");
  setTimeout(()=>{if(S.face==="LISTENING")setFace("THINKING");},1200);
  setTimeout(()=>{if(S.face==="THINKING"){setFace("SPEAKING");say("Anotado.");}},2500);
  setTimeout(()=>{if(S.face==="SPEAKING")setFace("IDLE");},4500);
}
function setMode(m){
  S.mode=m; document.getElementById("tag").textContent=m;
  document.querySelectorAll("#modes button").forEach(b=>b.classList.toggle("on",b.textContent===m));
  sheet.classList.remove("open");
  if(m==="GOLD") setFace("HAPPY",1200);
  if(m==="EXPLORER") setFace("CONCERNED",900);
}

const dock=document.getElementById("dock"), sheet=document.getElementById("sheet");
let dn=0,dx=0,dy=0,mv=0,pts=0;
cv.addEventListener("pointerdown",e=>{pts++;cv.setPointerCapture(e.pointerId);dn=performance.now();dx=e.clientX;dy=e.clientY;mv=0;if(pts>=2){A.shake=1.1;setFace("CONCERNED",1100);}});
cv.addEventListener("pointermove",e=>{A.tx=(e.clientX/innerWidth-.5)*1.15;A.ty=(e.clientY/innerHeight-.5)*.65;if(dn)mv+=Math.hypot(e.clientX-dx,e.clientY-dy);});
cv.addEventListener("pointerup",e=>{
  pts=Math.max(0,pts-1);
  const hold=performance.now()-dn,sx=e.clientX-dx,sy=e.clientY-dy;dn=0;
  if(dock.classList.contains("open")||sheet.classList.contains("open")){if(mv<22){dock.classList.remove("open");sheet.classList.remove("open");return;}}
  if(mv>80 && Math.abs(sy)>Math.abs(sx) && sy<0){dock.classList.add("open");sheet.classList.remove("open");return;}
  if(mv>80 && Math.abs(sy)>Math.abs(sx) && sy>0){sheet.classList.add("open");dock.classList.remove("open");return;}
  if(mv>80 && Math.abs(sx)>Math.abs(sy)){const i=MODES.indexOf(S.mode);setMode(MODES[(i+(sx>0?1:-1)+7)%7]);return;}
  if(hold>700){S.face==="SLEEPING"?wake():goSleep();return;}
  poke();
});
document.getElementById("mic").onclick=()=>{S.mic=!S.mic;if(S.mic)listen();};
document.getElementById("spk").onclick=()=>{S.spk=!S.spk;};
document.getElementById("cam").onclick=()=>say("Tracking.");
document.getElementById("slp").onclick=()=>{dock.classList.remove("open");S.face==="SLEEPING"?wake():goSleep();};
MODES.forEach(m=>{const b=document.createElement("button");b.textContent=m;if(m===S.mode)b.classList.add("on");b.onclick=()=>setMode(m);document.getElementById("modes").appendChild(b);});
EMOS.forEach(e=>{const b=document.createElement("button");b.textContent=e;b.onclick=()=>{sheet.classList.remove("open");setFace(e,e==="IDLE"?0:2400);};document.getElementById("emos").appendChild(b);});
function ask(title,desc,key){S.pend=key;document.getElementById("pt").textContent=title;document.getElementById("pd").textContent=desc;document.getElementById("perm").classList.add("open");setFace("LISTENING");}
document.getElementById("pno").onclick=()=>{document.getElementById("perm").classList.remove("open");setFace("CONCERNED",1600);say("Sin permiso no salgo.");S.pend=null;};
document.getElementById("pyes").onclick=()=>{document.getElementById("perm").classList.remove("open");if(S.pend)S.perm[S.pend]=true;setFace("SPEAKING",2000);say("Autorizado.");S.pend=null;};
document.getElementById("form").onsubmit=e=>{
  e.preventDefault(); const q=document.getElementById("cmd").value.trim().toLowerCase(); document.getElementById("cmd").value=""; if(!q)return;
  dock.classList.remove("open"); interact();
  if(/whats|wsp/.test(q)) S.perm.wa?(setFace("SPEAKING",2000),say("WhatsApp listo.")):ask("WhatsApp","Despacho a la junta.","wa");
  else if(/correo|mail|email/.test(q)) S.perm.em?(setFace("SPEAKING",2000),say("Correo listo.")):ask("Correo","Borrador institucional.","em");
  else if(/clima/.test(q)){setFace("SPEAKING",2000);say("27 grados. Cielo estable.");}
  else {const m=MODES.find(z=>q.includes(z.toLowerCase())); if(m) setMode(m); else listen();}
};

let last=performance.now();
function loop(n){const dt=Math.min(.05,(n-last)/1000);last=n;if(!S.boot)draw(dt);requestAnimationFrame(loop);}
requestAnimationFrame(loop);
setTimeout(()=>{document.getElementById("boot").classList.add("gone");S.boot=false;say("Junta en linea.");scheduleBlink("double");},1500);
})();
<\/script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ULTRON_FP_Simulador.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
