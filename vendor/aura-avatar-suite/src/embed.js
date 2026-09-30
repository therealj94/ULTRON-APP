import {mountAvatar} from './stage.js';
import {applyAvatarMessage} from './protocol.js';
// Página de la WebView (integration/*-embed.html): el GLB móvil va empaquetado en la página.
// «listo» sale cuando el modelo cargó y dibujó; antes de eso los mensajes quedan en cola.
const send=m=>window.ReactNativeWebView?.postMessage(JSON.stringify(m));
try{
 const id=document.body.dataset.avatar;
 const stage=mountAvatar(document.getElementById('avatar'),{id,quality:document.body.dataset.calidad==='alta'?'high':'low',transparent:true,
  onTap:zona=>send({tipo:'tocar',zona}),onListo:info=>send({tipo:'listo',avatar:id,capacidades:{posturas:['pie'],mobiliario:false},info}),onFallo:motivo=>send({tipo:'fallo',motivo})});
 window.__aura=m=>applyAvatarMessage(stage.avatar,m);
 window.__avatarStage=stage;
 stage.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();send({tipo:'fallo',motivo:'WebGL context lost'});});
 window.addEventListener('pagehide',()=>stage.dispose(),{once:true});
}catch(e){send({tipo:'fallo',motivo:String(e?.message||e)});}
