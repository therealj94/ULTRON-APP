import type * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
export type AvatarId='antonio'|'claudio'|'aura';
export type AvatarController={root:THREE.Group;emotion:string;state:string;intensity:number;reducedMotion:boolean;setEmotion(name:string,intensity?:number):void;setState(name:string):void;playGesture(name:string):void;lookAt(x:number,y:number):void;setSpeech(level:number,viseme?:string):void;reset():void;update(dt:number,time:number,immediate?:boolean):void;dispose():void;};
export type AvatarStage={avatar:AvatarController;renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;controls:OrbitControls;paused:boolean;setPaused(value:boolean):void;resetCamera():void;closeup():void;renderAt(time:number):void;resume():void;screenshot():string;stats():{meshes:number;triangles:number;joints:number;drawCalls:number};dispose():void;audio:{play(input:{url?:string;blob?:Blob;alignment?:unknown}):Promise<void>;stop():void}};
export function mountAvatar(host:HTMLElement,options?:{id?:AvatarId;quality?:'high'|'low';transparent?:boolean;onTap?:(zone:'cabeza'|'cuerpo')=>void}):AvatarStage;
