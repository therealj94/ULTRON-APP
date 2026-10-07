import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {faceGeometry,rearHeadGeometry,oralGeometry,lipEdgeGeometry,lidGeometry,irisGeometry,irisTexture,detailTextures,sweep,jacketGeometry,shoeGeometry,browGeometry} from './sculpt.js';

export const EMOTIONS = ['neutral','feliz','risa','sorpresa','curioso','pensando','preocupado','triste','molesto','cansado','carino','orgullo','travieso','canto','oracion','escepticismo','alarma','firme','seco'];
export const GESTURES = ['saludar','lentes','asentir','negar','explicar','celebrar','corazon','senalar','caminar'];
export const STATES = ['idle','listening','thinking','speaking','working','reading','success','needs_user','offline','sleeping'];
const clamp = THREE.MathUtils.clamp;
const smooth = x => x*x*(3-2*x);
let serial = 0;

function surface(color, roughness=.5, extras={}) { return new THREE.MeshPhysicalMaterial({color,roughness,...extras}); }
function mesh(parent, geometry, material, name, pos=[0,0,0], scale=[1,1,1]) {
  const m=new THREE.Mesh(geometry,material); m.name=name || `part_${++serial}`;
  m.position.set(...pos); m.scale.set(...scale); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
}
const sphereGeometry=new THREE.SphereGeometry(1,28,20);
function oval(p,mat,name,pos,scale){return mesh(p,sphereGeometry,mat,name,pos,scale);}
function group(parent,name,pos=[0,0,0]){const g=new THREE.Group();g.name=name;g.position.set(...pos);parent.add(g);return g;}
function tube(p,pts,r,mat,name,segments=24){return mesh(p,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(v=>new THREE.Vector3(...v))),segments,r,8,false),mat,name);}
function roundedRect(w,h,r) {
  const s=new THREE.Shape(); const x=-w/2,y=-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
}
function labelTexture(){
  const c=document.createElement('canvas');c.width=256;c.height=128;const ctx=c.getContext('2d');
  ctx.clearRect(0,0,256,128);ctx.fillStyle='#e8fcff';ctx.font='600 47px Arial';ctx.textAlign='center';ctx.fillText('AURA',128,68);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
export function createAntonio({quality='high'}={}){
  const root=new THREE.Group();root.name='ANT_ONIO';
  root.userData={author:'Orden Global',version:'2.0.0',rig:'articulated node hierarchy with facial morph targets',reference:'ANT-ONIO approved glasses design'};
  const rig={},anim=[];
  const joint=(p,n,pos)=>{const g=group(p,n,pos);rig[n]=g;anim.push(g);return g;};
  const skinMaps=detailTextures('skin'),clothMaps=detailTextures('cloth');
  const skin=surface('#ad512b',.83,{...skinMaps,normalScale:new THREE.Vector2(.35,.35),clearcoat:.06,clearcoatRoughness:.5});
  const faceMat=skin.clone();faceMat.vertexColors=true;
  const darkSkin=surface('#8d401f',.69,{...skinMaps,normalScale:new THREE.Vector2(.28,.28)});
  const lipMat=surface('#ae522e',.72,{...skinMaps,normalScale:new THREE.Vector2(.12,.12)});
  const cloth=surface('#181a1d',.97,{...clothMaps,normalScale:new THREE.Vector2(.30,.30),sheen:.35,sheenColor:new THREE.Color('#454347'),sheenRoughness:.9});
  const pants=cloth.clone();pants.color.set('#141518');
  const cuff=cloth.clone();cuff.color.set('#232426');
  const cyan=surface('#009cca',.54);const black=surface('#090d13',.38,{clearcoat:.14,clearcoatRoughness:.26,envMapIntensity:.2,specularIntensity:.6});
  const shoeLeather=surface('#14161a',.57,{...clothMaps,normalScale:new THREE.Vector2(.08,.08),clearcoat:.15});const laceMat=surface('#52545b',.89);
  const rubber=surface('#121518',.88);const midsole=surface('#b6bbbf',.89);
  const white=surface('#fff6e5',.28,{clearcoat:.35});
  const browMat=surface('#422317',.96,{...skinMaps,normalScale:new THREE.Vector2(.7,.7)});
  const morphMeshes=[];const addMorph=(m)=>{m.updateMorphTargets();morphMeshes.push(m);return m;};
  const body=joint(root,'body',[0,0,0]);
  const torso=joint(body,'torso',[0,2.22,0]);
  mesh(torso,jacketGeometry(),cloth,'tailored_jacket');
  const waistband=mesh(torso,new THREE.CylinderGeometry(.317,.317,.095,64,3),cuff,'ribbed_waist',[0,-.58,0]);waistband.scale.z=.7;
  const abdomen=joint(torso,'abdomen',[0,-.42,-.42]);abdomen.rotation.x=-.28;
  const ag=new THREE.SphereGeometry(1,64,48);const ap=ag.attributes.position;
  for(let i=0;i<ap.count;i++){const x=ap.getX(i),y=ap.getY(i),z=ap.getZ(i);const grooves=1-.035*Math.exp(-Math.pow((z+.35)/.027,2))-.027*Math.exp(-Math.pow((z-.18)/.024,2))-.032*Math.exp(-Math.pow((z-.65)/.027,2));ap.setXYZ(i,x*.51*grooves,y*.57*grooves,z*.76);}
  ag.computeVertexNormals();mesh(abdomen,ag,darkSkin,'sculpted_segmented_abdomen',[0,-.17,-.27]);
  tube(torso,[[0,-.54,.234],[0,-.23,.249],[0,.12,.282],[0,.36,.321],[0,.48,.307],[0,.56,.249]],.009,cyan,'zipper_tape',48);
  const zipGeos=[];for(let i=0;i<35;i++){const y=-.53+i*.03,z=y<.12?.236+(y+.53)*.066:y<.36?.279+(y-.12)*.175:.321-(y-.36)*.12;const g=new THREE.BoxGeometry(.021,.010,.012);g.translate(0,y,z);zipGeos.push(g);}mesh(torso,mergeGeometries(zipGeos),cyan,'zipper_teeth');zipGeos.forEach(g=>g.dispose());
  const pull=mesh(torso,new THREE.TorusGeometry(.015,.004,6,12),cyan,'zip_pull',[0,.47,.32]);pull.scale.y=1.8;
  for(const side of [-1,1]){
    // Open stand collar with a fabric face and a narrow blue binding.
    mesh(torso,sweep([[side*.035,.52,.244],[side*.13,.64,.181],[side*.201,.69,.035],[side*.14,.69,-.14]],[.02,.035,.038,.025],{depth:1.8,steps:40}),cloth,`collar_${side}`);
    tube(torso,[[side*.028,.51,.261],[side*.11,.65,.217],[side*.20,.714,.06],[side*.14,.718,-.13]],.007,cyan,`collar_binding_${side}`,36);
    tube(torso,[[side*.25,.566,.157],[side*.39,.40,.141],[side*.435,.24,.085]],.005,cyan,`shoulder_piping_${side}`,32);
    tube(torso,[[side*.20,-.31,.207],[side*.30,-.15,.171]],.012,cuff,`pocket_welt_${side}`);
    tube(torso,[[side*.12,-.515,.222],[side*.25,-.49,.17],[side*.316,-.47,.10]],.0025,black,`hem_stitch_${side}`);
  }
  const tag=mesh(torso,new THREE.PlaneGeometry(.18,.075),new THREE.MeshStandardMaterial({map:labelTexture(),transparent:true,roughness:.95}),'AURA_embroidery',[.225,.25,.285]);tag.rotation.y=.36;
  oval(torso,skin,'neck',[0,.72,0],[.155,.23,.155]);
  const head=joint(torso,'head',[0,1.27,.05]);head.scale.y=.92;
  mesh(head,rearHeadGeometry(),skin,'cranium');
  addMorph(mesh(head,faceGeometry(),faceMat,'continuous_face'));
  const mouth=addMorph(mesh(head,oralGeometry('cavity'),new THREE.MeshStandardMaterial({color:'#2d0b0a',roughness:1,side:THREE.DoubleSide}),'mouth'));
  addMorph(mesh(head,lipEdgeGeometry(),lipMat,'lip_contour'));
  mouth.morphTargetDictionary={open:0,laugh:1,round:2,wide:3,frown:4,closed:5};
  const teeth=joint(head,'teeth',[0,-.309,.497]);
  // Curved upper dental plate sits inside the true mouth opening.
  const tg=new THREE.SphereGeometry(1,48,24);mesh(teeth,tg,white,'upper_dental_plate',[0,0,0],[.205,.034,.048]);
  const tongue=joint(head,'tongue',[0,-.427,.487]);oval(tongue,surface('#b75756',.69),'tongue_surface',[0,0,0],[.125,.025,.027]);
  const eyelids=[];
  const irisMat=new THREE.MeshPhysicalMaterial({map:irisTexture(),roughness:.64,clearcoat:0,envMapIntensity:.12,specularIntensity:.06});
  const eyeWhite=surface('#f5ebd9',.44,{clearcoat:.12,clearcoatRoughness:.20});
  for(const side of [-1,1]){
    const eye=joint(head,`eye_${side}`,[side*.293,.16,.54]);eye.scale.set(.94,.86,1);
    oval(eye,eyeWhite,`sclera_${side}`,[0,0,0],[.244,.259,.20]);
    const gaze=joint(eye,`gaze_${side}`,[0,0,0]);
    mesh(gaze,irisGeometry(),irisMat,`detailed_amber_iris_${side}`);
    // Two restrained catchlights stay clear through the prescription lenses.
    const highlight=new THREE.MeshBasicMaterial({color:'#fff7e6'});
    oval(gaze,highlight,`cornea_glint_${side}`,[-.040,.062,.201],[.019,.026,.006]);
    oval(gaze,highlight,`cornea_glint_small_${side}`,[.033,-.044,.204],[.006,.008,.003]);
    for(const lower of [false,true]){
      const socket=group(eye,`${lower?'lower':'upper'}_lid_socket_${side}`);socket.scale.set(.249,.265,.227);
      const pivot=joint(socket,`${lower?'lower':'upper'}_lid_pivot_${side}`,[0,0,0]);
      const geo=new THREE.SphereGeometry(1,64,28,0,Math.PI*2,lower?Math.PI/2:0,Math.PI/2);
      const lid=mesh(pivot,geo,skin,`${lower?'lower':'upper'}_eyelid_${side}`);
      eyelids.push({mesh:lid,pivot,side,lower});
    }
    const crease=joint(eye,`closed_eye_crease_${side}`,[0,0,0]);
    const creasePoints=[];for(let i=0;i<=24;i++){const x=-.229+i/24*.458,y=.052*(1-(x/.229)**2),z=.227*Math.sqrt(Math.max(0,1-(x/.249)**2-(y/.265)**2))+.004;creasePoints.push([x,y,z]);}
    tube(crease,creasePoints,.0065,browMat,`closed_eye_line_${side}`,40);
    const brow=joint(head,`brow_${side}`,[side*.31,.472,.435]);mesh(brow,browGeometry(side),browMat,`tapered_brow_${side}`);
    // Small nostril indent cues are recessed into the integrated nose.
    const nostril=oval(head,darkSkin,`nostril_${side}`,[side*.054,-.083,.657],[.018,.007,.006]);nostril.rotation.z=side*.3;
  }
  const glasses=joint(head,'glasses',[0,.16,.777]);
  for(const side of [-1,1]){
    const shape=roundedRect(.584,.47,.096),hole=roundedRect(.528,.407,.074);shape.holes.push(new THREE.Path(hole.getPoints(40).reverse()));
    const frame=mesh(glasses,new THREE.ExtrudeGeometry(shape,{depth:.021,bevelEnabled:true,bevelSegments:4,steps:1,bevelSize:.008,bevelThickness:.008,curveSegments:16}),black,`acetate_frame_${side}`,[side*.307,0,0]);frame.rotation.y=-side*.11;frame.rotation.z=-side*.015;
    const lens=mesh(glasses,new THREE.ShapeGeometry(roundedRect(.526,.405,.074),24),new THREE.MeshPhysicalMaterial({color:'#ecf6ff',transparent:true,opacity:.022,roughness:.45,depthWrite:false,side:THREE.DoubleSide}),`clear_lens_${side}`,[side*.307,0,.026]);lens.rotation.y=-side*.11;lens.castShadow=false;lens.receiveShadow=false;
    tube(glasses,[[side*.614,.075,-.019],[side*.727,.08,-.18],[side*.715,.028,-.50],[side*.66,-.022,-.61]],.020,black,`temple_${side}`,32);
    const mark=mesh(glasses,new THREE.BoxGeometry(.030,.026,.008),cyan,`temple_mark_${side}`,[side*.605,.092,.018]);mark.rotation.y=-side*.11;
  }
  tube(glasses,[[-.040,.064,.022],[0,.078,.034],[.040,.064,.022]],.019,black,'glasses_bridge');
  // Swept organic quiff with tapered lobes, replacing straight cones.
  for(let i=0;i<4;i++){
    const x=-.16+i*.094,y=.59+Math.sin(i/3*Math.PI)*.03;
    mesh(head,sweep([[x,y,.02],[x+.01,y+.11,.07],[x+.047,y+.23,.047],[x+.079,y+.32-i*.018,-.023]],[.09,.08,.049,.0003],{depth:.64,steps:40,sides:24}),skin,`sculpted_quiff_${i}`);
  }
  for(const side of [-1,1]){
    const antenna=joint(head,`antenna_${side}`,[side*.375,.556,-.055]);
    mesh(antenna,sweep([[0,0,0],[side*.072,.23,-.035],[side*.16,.49,-.044],[side*.238,.666,-.023]],[.04,.034,.029,.032],{sides:20,steps:42}),skin,`antenna_stem_${side}`);
    oval(antenna,skin,`antenna_elbow_${side}`,[side*.238,.666,-.023],[.037,.037,.037]);
    const tip=joint(antenna,`antenna_tip_${side}`,[side*.238,.666,-.023]);
    mesh(tip,sweep([[0,0,0],[side*.14,-.035,.019],[side*.27,-.11,.04],[side*.37,-.22,.055],[side*.385,-.283,.065]],[.032,.041,.062,.078,.001],{sides:24,steps:48,depth:.85,roundEnd:true}),skin,`antenna_club_${side}`);
    for(let i=0;i<3;i++){const y=.13+i*.14;const band=mesh(antenna,new THREE.TorusGeometry(.035-i*.002,.003,6,24),darkSkin,`antenna_growth_ring_${side}_${i}`,[side*y*.32,y,-.03]);band.rotation.x=Math.PI/2;band.rotation.y=-side*.27;}
  }
  function hand(parent,name,scale){
    const h=joint(parent,name,[0,-.425,0]);h.scale.setScalar(scale);
    const pg=new THREE.SphereGeometry(1,36,28);const pp=pg.attributes.position;for(let i=0;i<pp.count;i++){const x=pp.getX(i),y=pp.getY(i),z=pp.getZ(i);pp.setXYZ(i,x*(.135+.015*(1-y)),y*.183,z*.078*(1-.13*x));}pg.computeVertexNormals();mesh(h,pg,skin,name+'_palm',[0,-.115,.024]);
    for(let f=0;f<3;f++){
      const finger=joint(h,name+'_finger_'+f,[(f-1)*.088,-.239+(f===1?-.012:.003),.023]);
      const len=f===1?.222:.190,dx=(f-1)*.017;
      mesh(finger,sweep([[0,.022,0],[dx*.25,-len*.35,.005],[dx*.75,-len*.78,.028],[dx,-len,.044]],[.046,.045,.037,.001],{sides:18,steps:28,roundEnd:true}),skin,name+'_digit_'+f);
      for(let k=0;k<2;k++)tube(finger,[[-.023,-len*(.38+k*.24),.043],[0,-len*(.40+k*.24),.049],[.023,-len*(.38+k*.24),.043]],.0016,darkSkin,name+'_crease_'+f+'_'+k,8);
    }
    const thumb=joint(h,name+'_thumb',[.108,-.06,.044]);mesh(thumb,sweep([[0,.014,0],[.070,-.042,.013],[.108,-.104,.034],[.105,-.161,.057]],[.060,.056,.043,.001],{sides:20,steps:30,roundEnd:true}),skin,name+'_thumb_mesh');
    return h;
  }
  for(const side of [-1,1])for(let level=0;level<2;level++){
    const n=level?'lower':'upper',len=level?.34:.45,radius=level?.119:.156;
    const arm=joint(torso,`${n}_arm_${side}`,[side*(level?.36:.435),level?-.14:.40,level?-.046:0]);
    mesh(arm,sweep([[0,.088,0],[side*.024,-.04,0],[side*.009,-len*.58,.005],[0,-len-.025,0]],[.015,radius,radius*.94,radius*.86],{steps:42,sides:32,depth:.99,fold:.005}),cloth,`${n}_sculpted_sleeve_${side}`);
    const fore=joint(arm,`${n}_fore_${side}`,[0,-len,0]);
    mesh(fore,sweep([[0,.06,0],[0,-.08,.006],[0,-.26,.004],[0,-.385,0]],[radius*.88,radius*.90,.106,.095],{steps:42,sides:32,fold:.004}),cloth,`${n}_folded_forearm_${side}`);
    const cuffMesh=mesh(fore,new THREE.CylinderGeometry(.100,.098,.075,40,4),cuff,`${n}_ribbed_cuff_${side}`,[0,-.365,0]);
    mesh(fore,new THREE.TorusGeometry(.098,.009,8,40),cyan,`${n}_cuff_binding_${side}`,[0,-.407,0]).rotation.x=Math.PI/2;
    const h=hand(fore,`${n}_hand_${side}`,level?.64:.83);if(side<0)h.rotation.y=Math.PI;
  }
  for(const side of [-1,1]){
    const leg=joint(body,`leg_${side}`,[side*.185,1.61,0]);
    mesh(leg,sweep([[0,.072,0],[side*.008,-.12,.007],[side*.015,-.40,.003],[side*.026,-.66,0]],[.154,.180,.152,.128],{sides:36,steps:48,depth:.94,fold:.005}),pants,`tailored_thigh_${side}`);
    const knee=joint(leg,`knee_${side}`,[side*.025,-.62,0]);
    mesh(knee,sweep([[0,.06,0],[0,-.08,-.008],[0,-.31,-.015],[0,-.545,0]],[.132,.132,.114,.115],{sides:32,steps:42,depth:.99,fold:.004}),pants,`tailored_calf_${side}`);
    const cuffMesh=mesh(knee,new THREE.CylinderGeometry(.12,.122,.07,40,4),cuff,`ankle_ribbing_${side}`,[0,-.51,0]);
    const foot=joint(knee,`foot_${side}`,[0,-.66,.09]);
    mesh(foot,shoeGeometry('outsole'),rubber,`outsole_${side}`);
    mesh(foot,shoeGeometry('midsole'),midsole,`midsole_${side}`);
    mesh(foot,shoeGeometry('upper'),shoeLeather,`sculpted_sneaker_${side}`);
    tube(foot,[[-.182,.022,-.13],[-.198,.022,.10],[-.13,.023,.327],[0,.023,.388],[.13,.023,.327],[.198,.022,.10],[.182,.022,-.13]],.012,cyan,`sole_binding_${side}`,64);
    mesh(foot,sweep([[0,.27,-.126],[0,.256,-.051],[0,.197,.115]],[.075,.083,.071],{depth:.17,sides:20,steps:28}),cuff,`sneaker_tongue_${side}`);
    const lacePoint=(x,t)=>{const q=Math.cos(t*Math.PI/2),w=.193*q,co=Math.min(.999,Math.pow(Math.abs(x)/w,1/.8)),si=Math.sqrt(1-co*co);return [x,.065+t*.263+.016*si*(1-t)+.010,.047-t*.112+.315*q*Math.pow(si,.88)+.008];};
    for(let i=0;i<5;i++){
      const t=.38+i*.08,points=[lacePoint(-.075,t),lacePoint(0,t),lacePoint(.075,t)];
      tube(foot,points,.007,laceMat,`cross_lace_${side}_${i}`,16);
      for(const d of [-1,1]){const p=lacePoint(d*.083,t);oval(foot,rubber,`eyelet_${side}_${i}_${d}`,p,[.010,.009,.009]);}
    }
    tube(foot,[[-.13,.095,.27],[-.169,.15,.11],[-.139,.214,-.09]],.0035,black,`shoe_stitch_${side}`,32);
  }
  root.traverse(o=>{if(o.isMesh&&(/sclera|eyelid|iris|glint|acetate_frame|temple|bridge|lip_contour|nostril/.test(o.name)))o.castShadow=false;});
  head.traverse(o=>{if(o.isMesh){o.receiveShadow=false;o.castShadow=false;}});
  const tangentGeometries=new Set();root.traverse(o=>{if(o.isMesh&&o.material.normalMap&&o.geometry.index)tangentGeometries.add(o.geometry);});
  for(const g of tangentGeometries){
    g.computeTangents();const a=g.attributes.tangent,n=g.attributes.normal;
    for(let i=0;i<a.count;i++){
      const v=new THREE.Vector3(a.getX(i),a.getY(i),a.getZ(i));
      if(v.lengthSq()<1e-10){const normal=new THREE.Vector3(n.getX(i),n.getY(i),n.getZ(i));v.crossVectors(normal,Math.abs(normal.y)>.9?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0));}
      v.normalize();a.setXYZW(i,v.x,v.y,v.z,a.getW(i)<0?-1:1);
    }
  }
  if(quality==='low')root.traverse(o=>{if(o.isMesh){o.material.normalMap=null;o.material.clearcoat=0;}});
  const parents=[];root.traverse(o=>{if(o.isGroup)parents.push(o);});
  for(const parent of parents){
    const buckets=new Map();for(const m of [...parent.children])if(m.isMesh&&!m.geometry.morphAttributes.position&&!m.material.transparent){const key=m.material.uuid+'_'+m.castShadow+'_'+m.receiveShadow+'_'+!!m.geometry.index+'_'+Object.keys(m.geometry.attributes).sort().join(',');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(m);}
    for(const list of buckets.values())if(list.length>1){
      const copies=list.map(m=>{m.updateMatrix();return m.geometry.clone().applyMatrix4(m.matrix);});
      const g=mergeGeometries(copies);copies.forEach(g=>g.dispose());if(!g)continue;
      const combined=new THREE.Mesh(g,list[0].material);combined.name=list[0].name+'_details';combined.castShadow=list[0].castShadow;combined.receiveShadow=list[0].receiveShadow;list.forEach(m=>parent.remove(m));parent.add(combined);
    }
  }
  const checked=new Set();root.traverse(o=>{if(!o.isMesh||checked.has(o.geometry))return;const g=o.geometry;checked.add(g);
    for(const attr of [g.attributes.normal,...(g.morphAttributes.normal||[])].filter(Boolean))for(let i=0;i<attr.count;i++){const v=new THREE.Vector3(attr.getX(i),attr.getY(i),attr.getZ(i));if(v.lengthSq()<1e-12)v.set(0,0,1);v.normalize();attr.setXYZ(i,v.x,v.y,v.z);}
    const t=g.attributes.tangent,n=g.attributes.normal;if(t)for(let i=0;i<t.count;i++){const v=new THREE.Vector3(t.getX(i),t.getY(i),t.getZ(i));if(v.lengthSq()<1e-12){const normal=new THREE.Vector3(n.getX(i),n.getY(i),n.getZ(i));v.crossVectors(normal,Math.abs(normal.y)>.9?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0));}if(v.lengthSq()<1e-12)v.set(1,0,0);v.normalize();t.setXYZW(i,v.x,v.y,v.z,t.getW(i)<0?-1:1);}
  });
  root.updateMatrixWorld(true);
  const bases=new Map();for(const n of anim)bases.set(n.name,{p:n.position.clone(),q:n.quaternion.clone(),s:n.scale.clone()});
  const controller={root,rig,anim,bases,mouth,morphMeshes,eyelids,emotion:'neutral',state:'idle',gesture:null,gestureStart:0,time:0,gaze:{x:0,y:0},speech:0,viseme:'sil',intensity:1,reducedMotion:false,pose:{},target:{},paused:false};
  controller.setEmotion=(name,intensity=1)=>{controller.emotion=EMOTIONS.includes(name)?name:'neutral';controller.intensity=clamp(Number(intensity)||0,0,1);};
  controller.setState=name=>{controller.state=STATES.includes(name)?name:'idle';};
  controller.playGesture=name=>{if(GESTURES.includes(name)){controller.gesture=name;controller.gestureStart=controller.time;}};
  controller.lookAt=(x,y)=>{controller.gaze={x:clamp(x,-1,1),y:clamp(y,-1,1)};};
  controller.setSpeech=(level,viseme='sil')=>{controller.speech=clamp(level,0,1);controller.viseme=viseme;};
  controller.reset=()=>{controller.emotion='neutral';controller.state='idle';controller.gesture=null;controller.speech=0;controller.gaze={x:0,y:0};controller.pose={};};
  controller.update=(dt,t,immediate=false)=>animate(controller,dt,t,immediate);
  controller.dispose=()=>{const geos=new Set(),mats=new Set(),tex=new Set();root.traverse(o=>{if(o.geometry)geos.add(o.geometry);for(const m of [o.material].flat().filter(Boolean)){mats.add(m);for(const v of Object.values(m))if(v?.isTexture)tex.add(v);}});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());tex.forEach(t=>t.dispose());};
  controller.update(0,0,true);return controller;
}

export function faceTarget(c,t){
  let e=c.emotion;
  if(c.state==='thinking')e='pensando';if(c.state==='needs_user')e='preocupado';if(c.state==='success')e='orgullo';
  const p={smile:0,open:0,round:0,wide:0,frown:0,closed:0,eye:.97,browY:0,browTilt:0,headZ:0,headX:0,headY:0,ant:0,bodyY:0,upperZ:.20,upperX:0,foreX:-.15,foreZ:0,lowerZ:.4,lowerX:0,lowerForeX:-1.3,teeth:.001,tongue:.001};
  switch(e){
    case 'feliz':p.smile=.6;p.eye=.88;p.browY=.03;p.teeth=1;break;
    case 'risa':p.smile=1;p.eye=.07;p.headX=-.08;p.ant=-.15;p.teeth=1;p.tongue=1;break;
    case 'sorpresa':p.round=1;p.eye=1.09;p.browY=.085;p.ant=-.36;p.upperZ=.52;p.teeth=.001;break;
    case 'curioso':p.headZ=.14;p.browTilt=.17;p.ant=.15;break;
    case 'pensando':p.headZ=-.09;p.headY=.12;p.eye=.9;p.browTilt=-.15;p.closed=.7;p.ant=.16;break;
    case 'preocupado':p.frown=.75;p.browTilt=.2;p.browY=.045;p.headX=.07;p.ant=.18;break;
    case 'triste':p.frown=1;p.eye=.79;p.browTilt=.3;p.headX=.17;p.ant=.42;break;
    case 'molesto':p.frown=.5;p.eye=.68;p.browTilt=-.30;p.browY=-.035;p.headX=-.05;break;
    case 'cansado':p.eye=.40;p.headZ=.07;p.headX=.12;p.ant=.34;break;
    case 'carino':p.smile=.20;p.eye=.82;p.headZ=.09;p.browTilt=.14;p.ant=.08;break;
    case 'orgullo':p.smile=.45;p.headX=-.09;p.browY=.035;p.upperZ=.32;p.foreX=-.55;p.ant=-.1;p.teeth=.8;break;
    case 'travieso':p.smile=.3;p.browTilt=.23;p.headZ=-.1;p.ant=-.14;p.teeth=.6;break;
    case 'canto':p.open=.5;p.smile=.22;p.eye=.86;p.upperZ=.45;p.teeth=.7;p.tongue=.5;break;
    case 'oracion':p.eye=.035;p.closed=1;p.headX=.18;p.ant=.22;break;
    case 'escepticismo':p.eye=.85;p.browTilt=-.28;p.headZ=-.14;p.closed=.8;break;
    case 'alarma':p.round=.6;p.eye=1.12;p.browY=.1;p.ant=-.45;p.upperZ=.48;break;
    case 'firme':p.eye=.86;p.browTilt=-.12;p.closed=1;p.headX=-.03;break;
    case 'seco':p.closed=1;p.eye=.95;break;
  }
  if(c.state==='listening'){p.headZ=.10;p.headX=.04;p.ant=-.18;p.eye=1.04;}
  if(c.state==='sleeping'){p.eye=.025;p.headX=.18;p.headZ=.14;p.ant=.38;p.closed=1;}
  if(c.state==='reading'){p.headX=.13;p.headY=Math.sin(t*.9)*.09;p.eye=.87;}
  if(c.state==='working'){p.foreX=-.85;p.lowerForeX=-1.2;p.headX=.08;}
  return p;
}

function animate(c,dt,t,immediate){
  c.time=t;const r=c.rig,p=c.pose,target=faceTarget(c,t),I=c.intensity;
  for(const [k,v]of Object.entries(target)){const base=['eye'].includes(k)?1:0;const value=c.state==='sleeping'?v:base+(v-base)*I;p[k]=immediate?value:(p[k]??value)+ (value-(p[k]??value))*(1-Math.exp(-Math.min(dt,.1)*9));}
  for(const [name,b]of c.bases){r[name].position.copy(b.p);r[name].quaternion.copy(b.q);r[name].scale.copy(b.s);}
  const move=c.reducedMotion?0:1;
  const breath=Math.sin(t*1.75)*.011*move;
  r.torso.position.y+=breath;r.torso.rotation.z=Math.sin(t*.72)*.008*move;
  r.head.rotation.set(p.headX+c.gaze.y*.085,p.headY+c.gaze.x*.20,p.headZ+Math.sin(t*.8)*.014*move);
  let blink=1;const phase=t%4.7;if(phase>4.38&&phase<4.62)blink=1-Math.sin((phase-4.38)/.24*Math.PI)*.97;
  if(c.state==='sleeping'||c.emotion==='oracion')blink=1;
  for(const s of [-1,1]){
    const rawOpening=Math.min(1,Math.max(0,p.eye*blink*(c.emotion==='travieso'&&s<0?.08:1)));const opening=rawOpening<.1?0:rawOpening;
    for(const lid of c.eyelids.filter(l=>l.side===s))lid.pivot.rotation.x=(lid.lower?1:-1)*1.47*opening;
    r['closed_eye_crease_'+s].scale.setScalar(opening<.12?Math.max(.0001,1-opening/.12):.0001);

    r['gaze_'+s].rotation.y=c.gaze.x*.16;r['gaze_'+s].rotation.x=c.gaze.y*.12;
    r['brow_'+s].position.y+=p.browY;r['brow_'+s].rotation.z=p.browTilt*s;
    r['antenna_'+s].rotation.z=s*(p.ant+Math.sin(t*1.4+s)*.025*move);r['antenna_'+s].rotation.x=Math.sin(t*1.3+s)*.024*move;
    r['antenna_tip_'+s].rotation.z=s*Math.sin(t*1.7+s)*.034*move;
    r['upper_arm_'+s].rotation.z=s*p.upperZ;r['upper_arm_'+s].rotation.x=p.upperX;
    r['upper_fore_'+s].rotation.x=p.foreX;r['upper_fore_'+s].rotation.z=s*p.foreZ;
    r['lower_arm_'+s].rotation.z=s*p.lowerZ;r['lower_arm_'+s].rotation.x=p.lowerX;
    r['lower_fore_'+s].rotation.x=p.lowerForeX;r['lower_fore_'+s].rotation.z=-s*.15;
  }
  for(const s of [-1,1])armIK(c,s,[s*.38,-.51,.24],[s*.23,-.67,.31],1,'lower');
  if(c.emotion==='pensando'||c.state==='thinking'){
    armIK(c,1,[.24,.73,.60],[.04,.92,.66],1);
  }
  if(c.emotion==='oracion'||c.emotion==='carino'){
    for(const s of [-1,1]){r['upper_arm_'+s].rotation.set(-.5,0,s*.42);r['upper_fore_'+s].rotation.set(-1.75,0,-s*.8);r['upper_hand_'+s].rotation.z=s*.2;}
  }
  if(c.emotion==='risa'){r.torso.position.y+=Math.abs(Math.sin(t*11))*.026*move;r.head.rotation.z+=Math.sin(t*10)*.025*move;}
  if(c.emotion==='canto'){r.torso.rotation.z+=Math.sin(t*3)*.055*move;}
  if(c.state==='working')for(const s of [-1,1])r['lower_fore_'+s].rotation.x+=Math.sin(t*7+s)*.16*move;
  const speech=c.speech;const m=c.mouth.morphTargetInfluences;m.fill(0);
  m[0]=p.open;m[1]=p.smile;m[2]=p.round;m[3]=p.wide;m[4]=p.frown;m[5]=p.closed;
  if(speech>.015){
    for(let i=0;i<m.length;i++)m[i]*=(1-speech*.8);
    const v=c.viseme;if(v==='O'||v==='U')m[2]=Math.max(m[2],speech);else if(v==='E'||v==='I')m[3]=Math.max(m[3],speech);else if(v==='MBP')m[5]=1;else m[0]=Math.max(m[0],speech);
  }
  // Keep total blend weights <=1. Individual endpoint shapes remain convex combinations.
  const sum=m.reduce((a,b)=>a+b,0);if(sum>1)for(let i=0;i<m.length;i++)m[i]/=sum;
  for(const faceMesh of c.morphMeshes)if(faceMesh!==c.mouth)faceMesh.morphTargetInfluences.set ? faceMesh.morphTargetInfluences.set(m):m.forEach((w,i)=>faceMesh.morphTargetInfluences[i]=w);
  const mouthOpen=m[0]+m[1]+m[2]+m[3]*.4;
  r.teeth.position.y+=m[1]*.023+m[0]*.016;r.teeth.position.z-=m[2]*.02;
  r.teeth.scale.y=Math.max(.001,Math.min(1,mouthOpen*2)*(1-m[2]));r.teeth.scale.x=Math.max(.0001,(1-m[2]*.6)*Math.min(1,mouthOpen*5));r.teeth.scale.z=Math.max(.0001,Math.min(1,mouthOpen*5));
  r.tongue.scale.y=Math.max(.001,(mouthOpen-.4)*1.5);r.tongue.scale.x=Math.max(.0001,(1-m[2]*.65)*Math.max(0,mouthOpen-.4)*1.8);r.tongue.scale.z=Math.max(.0001,(mouthOpen-.4)*1.8);
  if(c.gesture){const u=t-c.gestureStart;const duration=c.gesture==='caminar'?4:3.2;if(u>=duration)c.gesture=null;else gesture(c,c.gesture,u,duration);}
  c.root.updateMatrixWorld(true);
}

// Two-link inverse kinematics keeps the hand at a real contact point on the glasses/chin.
function armIK(c,s,wrist,fingertip,blend,level='upper'){
  const r=c.rig,upper=r[level+'_arm_'+s],fore=r[level+'_fore_'+s],hand=r[level+'_hand_'+s];
  const origin=upper.position.clone(),target=new THREE.Vector3(...wrist),direction=target.clone().sub(origin),d=Math.min(direction.length(),.874);direction.normalize();
  const L1=level==='lower'?.34:.45,L2=.425,x=(L1*L1-L2*L2+d*d)/(2*d),h=Math.sqrt(Math.max(0,L1*L1-x*x));
  const bend=new THREE.Vector3(s,0,0).addScaledVector(direction,-direction.x*s).normalize();
  const elbow=origin.clone().addScaledVector(direction,x).addScaledVector(bend,h),axis=new THREE.Vector3(0,-1,0);
  const uq=new THREE.Quaternion().setFromUnitVectors(axis,elbow.clone().sub(origin).normalize());
  const fqWorld=new THREE.Quaternion().setFromUnitVectors(axis,target.clone().sub(elbow).normalize());
  const fq=uq.clone().invert().multiply(fqWorld);
  const hqWorld=new THREE.Quaternion().setFromUnitVectors(axis,new THREE.Vector3(...fingertip).sub(target).normalize());
  const hq=fqWorld.clone().invert().multiply(hqWorld);
  upper.quaternion.slerp(uq,blend);fore.quaternion.slerp(fq,blend);hand.quaternion.slerp(hq,blend);
}

function gesture(c,name,t,duration){
  const r=c.rig,a=Math.min(smooth(clamp(t/.42,0,1)),smooth(clamp((duration-t)/.52,0,1)));
  const set=(n,k,v)=>r[n].rotation[k]=THREE.MathUtils.lerp(r[n].rotation[k],v,a);
  const fist=(s)=>{for(let f=0;f<3;f++)set(`upper_hand_${s}_finger_${f}`,'x',-1.6);};
  switch(name){
    case 'saludar':set('upper_arm_-1','z',-1.8);set('upper_arm_-1','x',-.25);set('upper_fore_-1','z',-.55-Math.sin(t*9)*.22);set('upper_fore_-1','x',-.3);set('upper_hand_-1','y',Math.PI);set('head','z',-.09);break;
    case 'lentes':armIK(c,1,[.66,1.12,.49],[.64,1.36,.81],a);for(let f=1;f<3;f++)set(`upper_hand_1_finger_${f}`,'x',-1.7);r.glasses.position.y+=a*.022;set('head','z',-.04);break;
    case 'asentir':r.head.rotation.x+=Math.sin(t*7)*.14*a;break;
    case 'negar':r.head.rotation.y+=Math.sin(t*6)*.22*a;break;
    case 'explicar':for(const s of [-1,1]){set('upper_arm_'+s,'z',s*(.66+Math.sin(t*3+s)*.12));set('upper_arm_'+s,'x',-.4);set('upper_fore_'+s,'x',-.95);set('upper_hand_'+s,'z',s*.25);}break;
    case 'celebrar':for(const s of [-1,1]){set('upper_arm_'+s,'z',s*2.3);set('upper_fore_'+s,'z',s*.35);fist(s);}r.body.position.y+=Math.abs(Math.sin(t*5))*.11*a;r.head.rotation.x-=.1*a;break;
    case 'corazon':for(const s of [-1,1]){set('upper_arm_'+s,'x',-.65);set('upper_arm_'+s,'z',s*.7);set('upper_fore_'+s,'x',-1.7);set('upper_fore_'+s,'z',-s*1);set('upper_hand_'+s,'z',s*.65);}break;
    case 'senalar':set('upper_arm_1','z',1.2);set('upper_fore_1','z',.3);for(let f=1;f<3;f++)set(`upper_hand_1_finger_${f}`,'x',-1.7);set('head','y',.25);break;
    case 'caminar':for(const s of [-1,1]){const z=Math.sin(t*6)*s;set('leg_'+s,'x',z*.46);set('knee_'+s,'x',Math.max(0,-z)*.65);set('upper_arm_'+s,'x',-z*.25);set('lower_arm_'+s,'x',z*.12);}r.body.position.y+=Math.abs(Math.sin(t*6))*.043*a;break;
  }
}

export function buildClips(c,{fps=24}={}){
  const clips=[];const saved={emotion:c.emotion,state:c.state,gesture:c.gesture,gaze:{...c.gaze},speech:c.speech,intensity:c.intensity,reducedMotion:c.reducedMotion};
  const defs=[...EMOTIONS.map(e=>({name:e,emotion:e,duration:4.7})),{name:'escuchando',state:'listening',duration:4.7},{name:'dormido',state:'sleeping',duration:4.7},...GESTURES.map(g=>({name:g,gesture:g,duration:g==='caminar'?4:3.2}))];
  for(const d of defs){
    c.reset();c.intensity=1;c.reducedMotion=false;c.emotion=d.emotion||'neutral';c.state=d.state||'idle';c.gesture=d.gesture||null;c.gestureStart=0;
    const times=[],data=c.anim.map(()=>({p:[],q:[],s:[]})),weights=[];const n=Math.ceil(d.duration*fps);
    for(let f=0;f<=n;f++){
      const t=f/n*d.duration;times.push(t);c.update(1/fps,t,true);
      c.anim.forEach((o,i)=>{o.position.toArray(data[i].p,data[i].p.length);o.quaternion.toArray(data[i].q,data[i].q.length);o.scale.toArray(data[i].s,data[i].s.length);});weights.push(...c.mouth.morphTargetInfluences);
    }
    const tracks=[];
    c.anim.forEach((o,i)=>{for(const [key,prop,size,T]of [['p','position',3,THREE.VectorKeyframeTrack],['q','quaternion',4,THREE.QuaternionKeyframeTrack],['s','scale',3,THREE.VectorKeyframeTrack]]){
      const values=data[i][key];let varying=false;for(let k=size;k<values.length;k++)if(Math.abs(values[k]-values[k%size])>1e-5){varying=true;break;}
      // Constant tracks deliberately retained: every clip carries its complete pose for crossfades.
      tracks.push(new T(o.name+'.'+prop,varying?times:[0,d.duration],varying?values:[...values.slice(0,size),...values.slice(0,size)]));
    }});
    for(const m of c.morphMeshes)tracks.push(new THREE.NumberKeyframeTrack(m.name+'.morphTargetInfluences',times,weights));

    clips.push(new THREE.AnimationClip(d.name,d.duration,tracks));
  }
  Object.assign(c,saved);c.pose={};c.update(0,0,true);return clips;
}
