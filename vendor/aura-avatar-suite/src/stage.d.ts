import type * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
export type AvatarId='antonio'|'claudio'|'aura';
/** API compatible con la entrega anterior; acepta también las caras y clips del vocabulario común. */
export type AvatarController={emotion:string;state:string;speech:number;intensity:number;reducedMotion:boolean;setEmotion(name:string,intensity?:number):void;setExpresion(name:string,intensity?:number):void;setState(name:string):void;playGesture(name:string):void;lookAt(x:number,y:number):void;setSpeech(level:number,viseme?:string):void;reset():void;update(dt:number):void;dispose():void;};
export type AvatarStage={avatar:AvatarController;renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;readonly listo:boolean;paused:boolean;setPaused(value:boolean):void;resetCamera():void;closeup():void;renderAt(time:number):void;resume():void;screenshot():string;stats():{meshes:number;triangles:number;drawCalls:number};dispose():void;audio:{play(input:{url?:string;blob?:Blob;alignment?:unknown}):Promise<void>;stop():void}};
export type Zona='cabeza'|'mejilla'|'panza'|'cuerpo';
export function mountAvatar(host:HTMLElement,options?:{id?:AvatarId;quality?:'high'|'low';transparent?:boolean;fondo?:string;bloom?:boolean;onTap?:(zone:Zona)=>void;onListo?:(info:{tCarga:number;triangulos:number})=>void;onFallo?:(motivo:string)=>void}):AvatarStage;
