import * as T from 'three';

// Short crossed ribbons follow the real surface. Geometry is merged per region;
// this is not a billboard of the character and remains coherent on rotation.
export function addFur(parent,geometry,{name,count=5000,color='#ac572a',length=.027,filter=()=>true,up=false}={}){
 const pos=geometry.attributes.position,nor=geometry.attributes.normal,col=geometry.attributes.color,index=geometry.index;
 const tris=(index?.count||pos.count)/3,areas=[],v0=new T.Vector3(),v1=new T.Vector3(),v2=new T.Vector3();let total=0;
 const at=(tri,k)=>index?index.getX(tri*3+k):tri*3+k;
 for(let i=0;i<tris;i++){v0.fromBufferAttribute(pos,at(i,0));v1.fromBufferAttribute(pos,at(i,1));v2.fromBufferAttribute(pos,at(i,2));total+=v1.sub(v0).cross(v2.sub(v0)).length()/2;areas.push(total);}
 let seed=94631;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const positions=[],normals=[],colors=[],indices=[],baseColor=new T.Color(color);
 for(let f=0;f<count;f++){
  const area=rand()*total;let lo=0,hi=tris-1;while(lo<hi){const mid=(lo+hi)>>1;if(areas[mid]<area)lo=mid+1;else hi=mid;}const ids=[at(lo,0),at(lo,1),at(lo,2)],a=Math.sqrt(rand()),b=rand(),weights=[1-a,a*(1-b),a*b],p=new T.Vector3(),n=new T.Vector3(),c=col?new T.Color(0,0,0):baseColor.clone();
  ids.forEach((id,i)=>{p.addScaledVector(new T.Vector3().fromBufferAttribute(pos,id),weights[i]);n.addScaledVector(new T.Vector3().fromBufferAttribute(nor,id),weights[i]);if(col){c.r+=col.getX(id)*weights[i];c.g+=col.getY(id)*weights[i];c.b+=col.getZ(id)*weights[i];}});
  if(!filter(p))continue;n.normalize();p.addScaledVector(n,.003);
  const flow=new T.Vector3(p.x*.3,up?1:-1,.12);flow.addScaledVector(n,-flow.dot(n)).normalize();
  const dir=n.clone().multiplyScalar(.64).addScaledVector(flow,.62).normalize(),len=length*(.6+rand()*.9),tip=p.clone().addScaledVector(dir,len),mid=p.clone().addScaledVector(dir,len*.52).addScaledVector(n,len*.08);
  const u=new T.Vector3().crossVectors(dir,Math.abs(dir.y)>.9?new T.Vector3(1,0,0):new T.Vector3(0,1,0)).normalize(),v=new T.Vector3().crossVectors(dir,u).normalize();c.multiplyScalar(.83+rand()*.28);
  for(const axis of [u,v]){const first=positions.length/3;for(const[pt,w]of [[p,.0012],[mid,.0007],[tip,.00003]])for(const s of [-1,1]){positions.push(...pt.clone().addScaledVector(axis,s*w).toArray());normals.push(...n.toArray());colors.push(c.r,c.g,c.b);}indices.push(first,first+1,first+2,first+1,first+3,first+2,first+2,first+3,first+4,first+3,first+5,first+4);}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);
 const m=new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1,side:T.DoubleSide,transparent:true,opacity:.52,depthWrite:false,emissive:'#b38764',emissiveIntensity:.20});const mesh=new T.Mesh(g,m);mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=false;parent.add(mesh);return mesh;
}
