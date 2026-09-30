import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createAvatar,CHARACTERS} from './characters.js';
import {AntonioAudio} from './audio.js';

export function mountAvatar(host,{id='antonio',quality='high',transparent=false,onTap=()=>{}}={}){
  const spec=CHARACTERS[id];if(!spec)throw new TypeError('Avatar desconocido');
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:transparent,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,quality==='high'?1.6:1));renderer.shadowMap.enabled=quality==='high';renderer.shadowMap.type=THREE.VSMShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.setClearColor('#15171b',transparent?0:1);host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(34,1,.1,50);camera.position.set(...spec.camera);
  const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();const env=pmrem.fromScene(room,.07);scene.environment=env.texture;scene.environmentIntensity=.55;room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#e1eaff','#6b4536',1.05));
  const key=new THREE.DirectionalLight('#fff1db',2.45);key.position.set(-3,5.5,6);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-3;key.shadow.camera.right=3;key.shadow.camera.top=6;key.shadow.camera.bottom=-3;key.shadow.normalBias=.003;key.shadow.bias=-.00003;key.shadow.radius=4;key.shadow.blurSamples=12;scene.add(key);
  const rim=new THREE.DirectionalLight('#eac4a1',2.8);rim.position.set(3,4,-3);scene.add(rim);
  const fill=new THREE.DirectionalLight('#9acbff',.65);fill.position.set(3,2,5);scene.add(fill);
  const avatar=createAvatar(id,{quality});scene.add(avatar.root);const audio=new AntonioAudio(avatar);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(200,80),new THREE.ShadowMaterial({color:'#000000',opacity:.25}));floor.rotation.x=-Math.PI/2;floor.position.y=.296;floor.receiveShadow=true;if(!transparent)scene.add(floor);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.1,.009,8,96),new THREE.MeshBasicMaterial({color:'#1d899c',transparent:true,opacity:.35}));ring.rotation.x=Math.PI/2;ring.position.y=.16;// The hero is grounded by a soft shadow, without a decorative pedestal.
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;const ctx=shadowCanvas.getContext('2d'),gradient=ctx.createRadialGradient(64,64,4,64,64,62);gradient.addColorStop(0,'rgba(0,0,0,.65)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(2.5,2),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.set(0,.298,0);if(!transparent)scene.add(shadow);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(...spec.target);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=3.4;controls.maxDistance=13;controls.maxPolarAngle=Math.PI*.56;controls.enablePan=false;
  const clock=new THREE.Clock();let time=0,frame,paused=false,disposed=false,hidden=false,manualTime=null;const pointer={x:0,y:0};let down=null;
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(manualTime!==null)renderer.render(scene,camera);};const observer=new ResizeObserver(resize);observer.observe(host);resize();
  const move=e=>{const rect=renderer.domElement.getBoundingClientRect();pointer.x=(e.clientX-rect.left)/rect.width*2-1;pointer.y=(e.clientY-rect.top)/rect.height*2-1;if(!down)avatar.lookAt(pointer.x,pointer.y);};
  const leave=()=>{avatar.lookAt(0,0);};const start=e=>{down={x:e.clientX,y:e.clientY};};
  const end=e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<7){const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-((e.clientY-rect.top)/rect.height*2-1)),camera);const hit=ray.intersectObject(avatar.root,true)[0];if(hit){avatar.playGesture('saludar');onTap(hit.point.y>(id==='aura'?2.65:3.05)?'cabeza':'cuerpo');}}down=null;};
  renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerleave',leave);renderer.domElement.addEventListener('pointerdown',start);renderer.domElement.addEventListener('pointerup',end);
  const vis=()=>{hidden=document.hidden;clock.getDelta();};document.addEventListener('visibilitychange',vis);
  const motionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');avatar.reducedMotion=motionQuery.matches;const motion=e=>{avatar.reducedMotion=e.matches;};motionQuery.addEventListener('change',motion);
  const render=()=>{if(disposed)return;frame=requestAnimationFrame(render);const dt=Math.min(clock.getDelta(),.05);if(hidden||manualTime!==null)return;if(!paused){time+=dt;audio.update(dt);avatar.update(dt,time);}controls.update();renderer.render(scene,camera);};render();
  return {avatar,audio,renderer,scene,camera,controls,
    setPaused(value){paused=value;if(value)audio.audio?.pause();},
    get paused(){return paused;},
    resetCamera(){camera.position.set(...spec.camera);controls.target.set(...spec.target);controls.update();},
    closeup(){camera.position.set(...spec.closeCamera);controls.target.set(...spec.closeTarget);controls.update();},
    renderAt(t){manualTime=t;avatar.update(1/24,t,true);controls.update();renderer.render(scene,camera);},
    resume(){manualTime=null;},
    screenshot(){renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');},
    stats(){let meshes=0,triangles=0;avatar.root.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});return {meshes,triangles,joints:avatar.anim.length,drawCalls:renderer.info.render.calls};},
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',vis);motionQuery.removeEventListener('change',motion);for(const [e,f]of [['pointermove',move],['pointerleave',leave],['pointerdown',start],['pointerup',end]])renderer.domElement.removeEventListener(e,f);controls.dispose();audio.dispose();avatar.dispose();floor.geometry.dispose();floor.material.dispose();ring.geometry.dispose();ring.material.dispose();shadow.geometry.dispose();shadow.material.map.dispose();shadow.material.dispose();env.dispose();renderer.dispose();renderer.domElement.remove();}
  };
}
