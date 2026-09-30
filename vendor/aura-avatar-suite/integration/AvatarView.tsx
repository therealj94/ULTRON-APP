import React,{useEffect,useRef} from 'react';
import {mountAvatar} from '../src/stage.js';
import {applyAvatarMessage} from '../src/protocol.js';
export type AvatarId='antonio'|'claudio'|'aura';
export type AvatarViewProps={id:AvatarId;face:string;emocion:string;lipLevel:number;viseme?:string;cameraGaze:{x:number;y:number;active:boolean};pedido?:{tarea:string;n:number}|null;entrada?:number;onFallo:(reason:string)=>void;onTocar?:(zone:'cabeza'|'cuerpo')=>void};
/** DOM renderer. Mount in a sized container; preserve the existing room as a separate view. */
export function AvatarView(props:AvatarViewProps){
 const host=useRef<HTMLDivElement>(null),stage=useRef<ReturnType<typeof mountAvatar>|null>(null),latest=useRef(props);latest.current=props;
 useEffect(()=>{if(!host.current)return;let lost:((e:Event)=>void)|null=null,canvas:HTMLCanvasElement|undefined;
  try{const s=mountAvatar(host.current,{id:props.id,transparent:true,onTap:(z:'cabeza'|'cuerpo')=>latest.current.onTocar?.(z)});stage.current=s;canvas=s.renderer.domElement;lost=e=>{e.preventDefault();latest.current.onFallo('WebGL context lost');};canvas?.addEventListener('webglcontextlost',lost);}
  catch(e){latest.current.onFallo(String(e));}
  return()=>{if(lost)canvas?.removeEventListener('webglcontextlost',lost);stage.current?.dispose();stage.current=null;};
 },[props.id]);
 useEffect(()=>{if(stage.current)applyAvatarMessage(stage.current.avatar,{tipo:'estado',face:props.face,emocion:props.emocion});},[props.id,props.face,props.emocion]);
 useEffect(()=>{if(stage.current)applyAvatarMessage(stage.current.avatar,{tipo:'boca',n:props.lipLevel,visema:props.viseme});},[props.id,props.lipLevel,props.viseme]);
 useEffect(()=>{const g=props.cameraGaze;if(stage.current)applyAvatarMessage(stage.current.avatar,{tipo:'mirar',x:g.x,y:g.y,activa:g.active});},[props.id,props.cameraGaze]);
 useEffect(()=>{if(stage.current&&props.pedido)applyAvatarMessage(stage.current.avatar,{tipo:'tarea',tarea:props.pedido.tarea});},[props.id,props.pedido?.n]);
 useEffect(()=>{if(props.entrada)stage.current?.avatar.playGesture('saludar');},[props.id,props.entrada]);
 return <div ref={host} style={{position:'absolute',inset:0}}/>;
}
