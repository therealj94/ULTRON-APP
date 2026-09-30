'use strict';
const $=id=>document.getElementById(id),host=payload=>chrome.webview.postMessage(payload);
let config,pc,stream,channel,offer,started=false,ended=false,timeout;
const status=text=>{$('status').textContent=text;};
function message(who,text){const e=document.createElement('div');e.textContent=who+': '+text;$('messages').append(e);$('messages').scrollTop=$('messages').scrollHeight;}
function setChannel(c){channel=c;c.onopen=()=>{$('send').disabled=false;};c.onclose=()=>{$('send').disabled=true;};c.onmessage=e=>{if(typeof e.data==='string'&&e.data.length<=4000)message('La otra persona',e.data);};}
function stop(){ended=true;clearTimeout(timeout);stream?.getTracks().forEach(t=>t.stop());pc?.close();$('send').disabled=true;status('Llamada finalizada.');}
function waitIce(peer){return new Promise(resolve=>{if(peer.iceGatheringState==='complete')return resolve();const done=()=>{clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',changed);resolve();};const changed=()=>{if(peer.iceGatheringState==='complete')done();};const timer=setTimeout(done,10000);peer.addEventListener('icegatheringstatechange',changed);});}
async function answer(){if(!offer||!started||ended)return;await pc.setRemoteDescription(offer);offer=null;await pc.setLocalDescription(await pc.createAnswer());await waitIce(pc);if(!ended)host({kind:'signal',payload:pc.localDescription.toJSON()});}
async function start(video){
 if(!config||started||ended)return;started=true;$('audio').disabled=$('video').disabled=true;
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:video?{width:{ideal:1280},height:{ideal:720}}:false});
  if(ended){stream.getTracks().forEach(t=>t.stop());return;}
  $('local').srcObject=stream;pc=new RTCPeerConnection({iceServers:config.iceServers||[]});
  stream.getTracks().forEach(t=>pc.addTrack(t,stream));
  pc.ontrack=e=>{$('remote').srcObject=e.streams[0];$('placeholder').hidden=e.streams[0].getVideoTracks().length>0;};
  pc.ondatachannel=e=>setChannel(e.channel);
  pc.onconnectionstatechange=()=>{status(pc.connectionState==='connected'?'Conectados':`Conexión: ${pc.connectionState}`);if(pc.connectionState==='connected')clearTimeout(timeout);};
  $('mic').disabled=false;$('camera').disabled=!video;status('Conectando con la otra persona…');
  timeout=setTimeout(()=>{if(pc.connectionState!=='connected')status('No se pudo conectar. Revisa la red o la configuración TURN del servicio.');},35000);
  if(config.initiator){setChannel(pc.createDataChannel('aura-chat'));await pc.setLocalDescription(await pc.createOffer());await waitIce(pc);if(!ended)host({kind:'signal',payload:pc.localDescription.toJSON()});}else await answer();
 }catch(e){stop();status('No se pudo iniciar: '+e.message);}
}
chrome.webview.addEventListener('message',async e=>{const m=e.data;try{if(m.kind==='config'){config=m;status('Elige audio o video para empezar.');}else if(m.kind==='signal'){if(m.payload.type==='offer'){offer=m.payload;await answer();}else if(pc&&!ended)await pc.setRemoteDescription(m.payload);}else if(m.kind==='stop')stop();}catch(e){status('Error de conexión: '+e.message);}});
$('audio').onclick=()=>start(false);$('video').onclick=()=>start(true);
$('mic').onclick=()=>{const track=stream?.getAudioTracks()[0];if(track){track.enabled=!track.enabled;$('mic').textContent=track.enabled?'Silenciar':'Activar micrófono';}};
$('camera').onclick=()=>{const track=stream?.getVideoTracks()[0];if(track){track.enabled=!track.enabled;$('camera').textContent=track.enabled?'Apagar cámara':'Activar cámara';}};
$('play').onclick=()=>{$('remote').play().catch(()=>status('El audio remoto aún no está disponible.'));};
$('hangup').onclick=()=>{stop();host({kind:'hangup'});};window.addEventListener('unload',stop);
$('form').onsubmit=e=>{e.preventDefault();const text=$('text').value.trim();if(text&&channel?.readyState==='open'){channel.send(text);message('Tú',text);$('text').value='';}};
// CI-only transport test: two real RTCPeerConnections, synthetic tracks, no camera or microphone.
window.rtcSelfTest=async()=>{
 const a=new RTCPeerConnection(),b=new RTCPeerConnection();const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;canvas.getContext('2d').fillRect(0,0,160,90);
 const video=canvas.captureStream(5),audio=new AudioContext(),source=audio.createOscillator(),dest=audio.createMediaStreamDestination();source.connect(dest);source.start();
 const tracks=[...video.getTracks(),...dest.stream.getTracks()];let kinds=new Set(),received=false;
 let timer;const completion=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('RTC test timeout')),15000);b.ontrack=e=>kinds.add(e.track.kind);b.ondatachannel=e=>{e.channel.onmessage=m=>{if(m.data==='ping')e.channel.send('pong');};};const c=a.createDataChannel('test');c.onopen=()=>c.send('ping');c.onmessage=e=>{if(e.data==='pong'){received=true;resolve();}};});
 try{for(const track of tracks)a.addTrack(track,new MediaStream(tracks));await a.setLocalDescription(await a.createOffer());await waitIce(a);await b.setRemoteDescription(a.localDescription);await b.setLocalDescription(await b.createAnswer());await waitIce(b);await a.setRemoteDescription(b.localDescription);await completion;if(!received||!kinds.has('audio')||!kinds.has('video'))throw Error('RTC tracks or channel missing');host({kind:'testResult',ok:true,audio:true,video:true,dataChannel:true});}
 catch(e){host({kind:'testResult',ok:false,error:e.message});}
 finally{clearTimeout(timer);a.close();b.close();tracks.forEach(t=>t.stop());source.stop();audio.close();}
};
