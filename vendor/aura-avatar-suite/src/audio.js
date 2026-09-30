// Voice-neutral audio bridge. Real playback clocks drive the mouth; no fake spoken voice.
export function visemeForCharacter(char=''){
  const c=char.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(/[mbp]/.test(c))return 'MBP';if(/[ou]/.test(c))return c.toUpperCase();if(/[ei]/.test(c))return c.toUpperCase();if(/[a]/.test(c))return 'A';return /[\s.,!?;:]/.test(c)?'sil':'A';
}
export function visemeAt(alignment,time){
  if(!alignment?.characters)return 'sil';
  const starts=alignment.character_start_times_seconds||[],ends=alignment.character_end_times_seconds||[];
  for(let i=0;i<starts.length;i++)if(time>=starts[i]&&time<ends[i])return visemeForCharacter(alignment.characters[i]);
  return 'sil';
}
export class AntonioAudio {
  constructor(avatar){this.avatar=avatar;this.audio=null;this.context=null;this.analyser=null;this.source=null;this.alignment=null;this.url=null;this.level=0;this.onEnded=null;this.generation=0;}
  async play({url,blob,alignment=null}){
    this.stop();const gen=++this.generation;
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    this.context ||= new AudioCtx();await this.context.resume();if(gen!==this.generation)return;
    this.url=blob?URL.createObjectURL(blob):null;this.audio=new Audio(this.url||url);this.audio.crossOrigin='anonymous';this.alignment=alignment;
    this.source=this.context.createMediaElementSource(this.audio);this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;
    this.samples=new Uint8Array(this.analyser.fftSize);this.source.connect(this.analyser);this.analyser.connect(this.context.destination);
    this.audio.onended=()=>{this.avatar.setSpeech(0);this.avatar.setState('idle');this.onEnded?.();};
    try{await this.audio.play();this.avatar.setState('speaking');}catch(err){this.stop();throw err;}
  }
  update(dt){
    if(!this.analyser||!this.audio)return;
    if(this.audio.paused){this.avatar.setSpeech(0);return;}
    this.analyser.getByteTimeDomainData(this.samples);let sum=0;for(const x of this.samples)sum+=((x-128)/128)**2;
    const raw=Math.min(1,Math.sqrt(sum/this.samples.length)*5.5);const speed=raw>this.level?25:12;this.level+=(raw-this.level)*(1-Math.exp(-dt*speed));
    this.avatar.setSpeech(this.level,this.alignment?visemeAt(this.alignment,this.audio.currentTime):'A');
  }
  stop(){this.generation++;if(this.audio){this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.audio=null;}this.source?.disconnect();this.analyser?.disconnect();this.source=null;this.analyser=null;if(this.url)URL.revokeObjectURL(this.url);this.url=null;this.level=0;this.avatar.setSpeech(0);if(this.avatar.state==='speaking')this.avatar.setState('idle');}
  async dispose(){this.stop();await this.context?.close();this.context=null;}
}
