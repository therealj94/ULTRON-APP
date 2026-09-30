import {mountAvatar} from './stage.js';
import {applyAvatarMessage} from './protocol.js';
const send=m=>window.ReactNativeWebView?.postMessage(JSON.stringify(m));
try{
 const id=document.body.dataset.avatar;
 const stage=mountAvatar(document.getElementById('avatar'),{id,transparent:true,onTap:zona=>send({tipo:'tocar',zona})});
 window.__aura=m=>applyAvatarMessage(stage.avatar,m);
 window.__avatarStage=stage;
 stage.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();send({tipo:'fallo',motivo:'WebGL context lost'});});
 window.addEventListener('pagehide',()=>stage.dispose(),{once:true});
 send({tipo:'listo',avatar:id,capacidades:{posturas:['pie'],mobiliario:false}});
}catch(e){send({tipo:'fallo',motivo:String(e?.message||e)});}
