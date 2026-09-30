import * as T from 'three';
import {EMOTIONS,GESTURES,STATES,faceTarget} from './avatar.js';

const clamp=T.MathUtils.clamp;
const shellRadius=y=>.86*Math.pow(Math.max(0,1-(y/1.14)**4),.25);
const front=(x,y)=>.83*Math.sqrt(Math.max(.001,shellRadius(y)**2-x*x));
function visorGeometry(w,h,cy,offset){
 const pos=[],uv=[],idx=[],N=112,M=20;
 for(let j=0;j<=M;j++)for(let i=0;i<=N;i++){
  const a=i/N*Math.PI*2,r=j/M,x=w*Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.63*r,y=cy+h*Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**.70*r;
  pos.push(x,y,front(x,y)+offset);uv.push(.5+x/(w*2),.5+(y-cy)/(h*2));
 }
 for(let j=0;j<M;j++)for(let i=0;i<N;i++){const a=j*(N+1)+i,b=a+N+1;idx.push(a,b,a+1,b,b+1,a+1);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
function displayMouth(){
 const shapes=[[.23,.007,.06],[.19,.105,.025],[.255,.13,.06],[.09,.11,0],[.27,.03,.015],[.21,.008,-.075],[.20,.005,.015]];
 const make=([w,h,smile])=>{const pts=[];for(let i=0;i<=80;i++){const a=i/80*Math.PI*2,x=w*Math.cos(a),y=-.16+h*Math.sin(a)+smile*(Math.cos(a)**2-.5);pts.push(new T.Vector3(x,y,front(x,y)+.024));}return new T.TubeGeometry(new T.CatmullRomCurve3(pts),80,.014,8,true);};
 const g=make(shapes[0]);g.morphAttributes.position=[];g.morphAttributes.normal=[];
 for(const shape of shapes.slice(1)){const target=make(shape);g.morphAttributes.position.push(target.attributes.position.clone());g.morphAttributes.normal.push(target.attributes.normal.clone());target.dispose();}return g;
}
export function createAura(){
 const root=new T.Group();root.name='AURA_ORBE';root.userData={version:'1.0.0',identity:'Grafito · Orbe',source:'ULTRON-APP/estilos.ts',rig:'articulated nodes and six mouth morph targets'};
 const rig={},anim=[];
 const joint=(parent,name,p=[0,0,0])=>{const o=new T.Group();o.name=name;o.position.set(...p);parent.add(o);rig[name]=o;anim.push(o);return o;};
 const material=(color,extra={})=>new T.MeshPhysicalMaterial({color,roughness:.4,...extra});
 const ceramic=material('#e9e4d8',{roughness:.34,clearcoat:.38,clearcoatRoughness:.30});
 const graphite=material('#171a20',{roughness:.25,metalness:.22,clearcoat:.5,clearcoatRoughness:.19});
 const edge=material('#4b4a42',{metalness:.72,roughness:.32});
 const gold=material('#c4a471',{metalness:.78,roughness:.32});
 const glow=new T.MeshStandardMaterial({color:'#e4c991',emissive:'#dfb767',emissiveIntensity:.9,roughness:.5});
 const mesh=(p,g,m,n,position=[0,0,0],scale=[1,1,1])=>{const o=new T.Mesh(g,m);o.name=n;o.position.set(...position);o.scale.set(...scale);o.castShadow=true;o.receiveShadow=true;p.add(o);return o;};
 const ball=new T.SphereGeometry(1,40,28);
 const body=joint(root,'body',[0,2.35,0]);
 const head=joint(body,'head');
 const profile=[];for(let i=0;i<=100;i++){const y=-1.14+2.28*i/100;profile.push(new T.Vector2(shellRadius(y),y));}
 const shell=mesh(head,new T.LatheGeometry(profile,112),ceramic,'ceramic_shell');shell.scale.z=.83;
 mesh(head,visorGeometry(.765,.548,.21,.009),edge,'visor_bezel');
 mesh(head,visorGeometry(.746,.525,.21,.015),graphite,'curved_graphite_display');
 const gaze=joint(head,'gaze');
 for(const s of [-1,1]){
  const eye=joint(gaze,'eye_'+s,[s*.276,.33,front(s*.276,.33)+.030]);eye.rotation.y=s*.33;
  mesh(eye,new T.CapsuleGeometry(.067,.13,8,24),glow,'gold_eye_'+s,[0,0,0],[1,1,.26]);
  const brow=joint(head,'brow_'+s,[s*.27,.56,front(s*.27,.56)+.027]);brow.rotation.y=s*.32;
  mesh(brow,new T.CapsuleGeometry(.013,.115,5,20),glow,'gold_brow_'+s,[0,0,0],[1,1,.6]).rotation.z=s*1.35;
 }
 const mouth=mesh(head,displayMouth(),glow,'mouth');mouth.castShadow=false;mouth.receiveShadow=false;mouth.updateMorphTargets();mouth.morphTargetDictionary={open:0,laugh:1,round:2,wide:3,frown:4,closed:5};
 const orbit=joint(body,'orbit',[0,-.58,0]);orbit.rotation.z=-.19;orbit.rotation.x=.19;
 const ring=mesh(orbit,new T.TorusGeometry(1.13,.026,16,144),gold,'champagne_orbit');ring.rotation.x=Math.PI/2;
 const orbitDot=joint(orbit,'orbit_marker');mesh(orbitDot,ball,glow,'status_light',[1.13,0,0],[.047,.027,.047]);
 for(const s of [-1,1]){
  const hand=joint(body,'hand_'+s,[s*1.01,-.23,.07]);hand.rotation.z=-s*.30;
  mesh(hand,ball,ceramic,'floating_fin_'+s,[0,0,0],[.13,.235,.11]);
  mesh(hand,new T.TorusGeometry(.099,.009,10,48),gold,'fin_detail_'+s,[0,-.035,0],[1,.8,1]).rotation.x=Math.PI/2;
 }
 // A quiet rear panel gives the back view a finished manufactured identity.
 mesh(head,ball,graphite,'rear_inset',[0,-.17,-.701],[.105,.185,.013]);
 for(let i=0;i<3;i++)mesh(head,ball,gold,'rear_status_'+i,[0,-.08-i*.08,-.719],[.018,.018,.010]);
 const bases=new Map(anim.map(n=>[n.name,{p:n.position.clone(),q:n.quaternion.clone(),s:n.scale.clone()}]));
 const c={root,rig,anim,bases,mouth,morphMeshes:[mouth],emotion:'neutral',state:'idle',gesture:null,gestureStart:0,time:0,gaze:{x:0,y:0},speech:0,viseme:'sil',intensity:1,reducedMotion:false,pose:{}};
 c.setEmotion=(e,i=1)=>{c.emotion=EMOTIONS.includes(e)?e:'neutral';c.intensity=clamp(Number(i)||0,0,1);};
 c.setState=s=>{c.state=STATES.includes(s)?s:'idle';};
 c.playGesture=g=>{if(GESTURES.includes(g)){c.gesture=g;c.gestureStart=c.time;}};
 c.lookAt=(x,y)=>{c.gaze={x:clamp(x,-1,1),y:clamp(y,-1,1)};};
 c.setSpeech=(n,v='sil')=>{c.speech=clamp(n,0,1);c.viseme=v;};
 c.reset=()=>{c.emotion='neutral';c.state='idle';c.gesture=null;c.speech=0;c.gaze={x:0,y:0};c.pose={};};
 c.update=(dt,t,immediate=false)=>{
  c.time=t;const target=faceTarget(c,t),p=c.pose,move=c.reducedMotion?0:1;
  for(const[k,v]of Object.entries(target)){const base=k==='eye'?1:0,value=c.state==='sleeping'?v:base+(v-base)*c.intensity;p[k]=immediate?value:(p[k]??value)+(value-(p[k]??value))*(1-Math.exp(-Math.min(dt,.1)*9));}
  for(const[n,b]of bases){rig[n].position.copy(b.p);rig[n].quaternion.copy(b.q);rig[n].scale.copy(b.s);}
  body.position.y+=Math.sin(t*1.6)*.055*move;body.rotation.y=Math.sin(t*.55)*.025*move;
  head.rotation.set(p.headX*.65+c.gaze.y*.04,p.headY*.65+c.gaze.x*.10,p.headZ*.7);
  rig.gaze.position.set(c.gaze.x*.07,-c.gaze.y*.065,0);
  let blink=1;const phase=t%4.7;if(phase>4.38&&phase<4.62)blink=1-Math.sin((phase-4.38)/.24*Math.PI)*.95;
  for(const s of [-1,1]){
   rig['eye_'+s].scale.y=Math.max(.035,p.eye*blink*(c.emotion==='travieso'&&s<0?.12:1));
   rig['brow_'+s].position.y+=p.browY*.65;rig['brow_'+s].rotation.z=s*p.browTilt;
   rig['hand_'+s].position.y+=Math.sin(t*1.8+s)*.025*move;rig['hand_'+s].rotation.z+=s*p.upperZ*.25;
  }
  orbit.rotation.y=t*.09*move;rig.orbit_marker.rotation.y=t*.20*move;
  const m=mouth.morphTargetInfluences;m.splice(0,6,p.open,p.smile,p.round,p.wide,p.frown,p.closed);
  if(c.speech>.015){for(let i=0;i<6;i++)m[i]*=1-c.speech*.8;const k=/^[OU]$/.test(c.viseme)?2:/^[EI]$/.test(c.viseme)?3:c.viseme==='MBP'?5:0;m[k]=Math.max(m[k],c.speech);}
  const sum=m.reduce((a,b)=>a+b,0);if(sum>1)for(let i=0;i<6;i++)m[i]/=sum;
  if(c.emotion==='risa')body.position.y+=Math.abs(Math.sin(t*9))*.03*move;
  if(c.gesture){const u=t-c.gestureStart,d=c.gesture==='caminar'?4:3.2,a=Math.min(T.MathUtils.smoothstep(u,0,.4),T.MathUtils.smoothstep(d-u,0,.5));
   if(u>=d)c.gesture=null;else switch(c.gesture){
    case 'saludar':rig.hand_1.position.y+=a*.80;rig.hand_1.rotation.z+=a*(-.6+Math.sin(u*9)*.3);break;
    case 'lentes':head.rotation.x+=.13*a;rig.hand_1.position.set(1.01-.19*a,-.23+.75*a,.07+.40*a);break;
    case 'asentir':head.rotation.x+=Math.sin(u*7)*.14*a;break;
    case 'negar':head.rotation.y+=Math.sin(u*6)*.22*a;break;
    case 'explicar':for(const s of [-1,1]){rig['hand_'+s].position.y+=a*(.28+Math.sin(u*3+s)*.11);rig['hand_'+s].rotation.z+=s*a*.7;}break;
    case 'celebrar':for(const s of [-1,1]){rig['hand_'+s].position.y+=.85*a;rig['hand_'+s].rotation.z+=s*a*.8;}body.position.y+=Math.abs(Math.sin(u*5))*.13*a;orbit.rotation.z+=Math.sin(u*3)*.10*a;break;
    case 'corazon':for(const s of [-1,1]){rig['hand_'+s].position.set(s*(1.01-.78*a),-.23+.09*a,.07+.75*a);rig['hand_'+s].rotation.z=s*.35*a;}break;
    case 'senalar':rig.hand_1.position.x+=.30*a;rig.hand_1.position.y+=.36*a;rig.hand_1.rotation.z-=1.0*a;head.rotation.y+=.2*a;break;
    case 'caminar':body.position.x+=Math.sin(u*2)*.18*a;body.rotation.z+=Math.sin(u*2)*.045*a;break;
   }
  }root.updateMatrixWorld(true);
 };
 c.dispose=()=>{const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.isMesh){gs.add(o.geometry);ms.add(o.material);}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());};
 c.update(0,0,true);return c;
}
