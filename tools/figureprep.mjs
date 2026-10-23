/** A figure for the shelf, out of a Mixamo download.
 *
 *     node tools/figureprep.mjs ~/Downloads/Running.fbx ../lucid-assets/figures/runner.glb
 *
 * Takes a character downloaded from Mixamo with an animation ("with skin",
 * FBX), keeps its geometry, its joints and its motion exactly, and replaces
 * its textures with the look of the game's figure: a translucent ivory body,
 * a luminous web of filaments drawn as thin tubes over a simplified copy of
 * the surface, and a few ribbons of wisp peeling off the back. Two clips
 * come out: the run as downloaded, and a copy with the horizontal travel of
 * the hips removed, which is the one the game plays -- on the spot, at a
 * rate set by how fast the walk is actually going. That pace is measured
 * here and written into the file's extras, and into a .json beside it with
 * the rest of the provenance: the source file and its hash, the counts, and
 * what was not done.
 *
 * The result is not committed anywhere near the code. It goes on the asset
 * shelf (lucid-assets/figures/<name>.glb; see machine/assets.py and
 * THIRD-PARTY.md for whose the character is), and a card names it by its
 * file name. Runs on this repository's own three.js: no Blender, no download.
 * The mesh work here is dense on purpose -- it is a build step, run once per
 * character, and read about as often as a Makefile.
 */
import * as T from '../app/node_modules/three/build/three.module.js';
import {FBXLoader} from '../app/node_modules/three/examples/jsm/loaders/FBXLoader.js';
import {GLTFExporter} from '../app/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import {mergeVertices} from '../app/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import {MeshoptSimplifier} from '../app/node_modules/three/examples/jsm/libs/meshopt_simplifier.module.js';
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const [source, out, ...more] = process.argv.slice(2);
if (!source || !out || !out.endsWith('.glb')) {
  console.error('usage: node tools/figureprep.mjs <Mixamo .fbx, downloaded with skin> <assets>/figures/<name>.glb [Name=clip.fbx[:flat] ...]');
  console.error('  the clips: more Mixamo downloads of the same character, without skin, each named for');
  console.error('  what the game plays it as -- Idle, Walk, Run, Jump, Leap, Dash. The first file\'s own');
  console.error('  animation is Run unless a Run= is given.');
  process.exit(1);
}
class Reader{readAsArrayBuffer(b){b.arrayBuffer().then(r=>{this.result=r;this.onloadend?.();});}readAsDataURL(b){b.arrayBuffer().then(r=>{this.result=`data:${b.type};base64,${Buffer.from(r).toString('base64')}`;this.onloadend?.();});}}
globalThis.FileReader=Reader;globalThis.window={URL};
const urls=[];window.URL={createObjectURL(b){const url=URL.createObjectURL(b);urls.push(url);return url;}};
const oldLoad=T.TextureLoader.prototype.load;T.TextureLoader.prototype.load=function(){return new T.Texture();};
const input=readFileSync(source);const fbx=new FBXLoader().parse(input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength),'');T.TextureLoader.prototype.load=oldLoad;urls.forEach(u=>URL.revokeObjectURL(u));
const root=new T.Group();root.name='Lucid_Mixamo_Player';root.add(fbx);fbx.scale.setScalar(.01);root.updateMatrixWorld(true);
const meshes=[];fbx.traverse(o=>{if(o.isMesh)meshes.push(o);});if(!meshes.length)throw Error('Source has no mesh: download With Skin.');
const active=fbx.animations.filter(a=>a.duration>0&&a.tracks.length);if(!active.length)throw Error('Source has no animation.');
/* Every clip is put on the spot: the linear travel of the hips over the clip
   is taken out, and how fast it was is kept as the clip's pace, so the game
   can scale the clip by the speed the walk is actually going. The original
   is exported too, under _RootMotion, for anybody who wants it. */
/* `flat` keeps the hips at their first height as well: a clip that is a
   jump in its own right, used for a move the game keeps on the ground -- the
   dash is a flying knee held level through the burst. */
function inPlaceOf(clip,name,flat=false){const run=clip.clone();run.name=name+'_RootMotion';const inPlace=run.clone();inPlace.name=name;
 const rootTrack=inPlace.tracks.find(t=>/Hips\.position$/.test(t.name));let travel=[0,0,0];if(rootTrack){const values=rootTrack.values;travel=[values[values.length-3]-values[0],0,values[values.length-1]-values[2]];const t0=rootTrack.times[0],t1=rootTrack.times.at(-1);for(let i=0;i<rootTrack.times.length;i++){const t=(rootTrack.times[i]-t0)/(t1-t0);values[i*3]-=travel[0]*t;values[i*3+2]-=travel[2]*t;if(flat)values[i*3+1]=values[1];}}
 return {inPlace,run,pace:Math.hypot(travel[0],travel[2])*.01/run.duration};}
const clips=[];const paces={};const sources={};
function keep(name,clip,file,bytes,flat=false){const got=inPlaceOf(clip,name,flat);clips.push(got.inPlace,got.run);paces[name]=got.pace;sources[name]={file,sha256:createHash('sha256').update(bytes).digest('hex'),seconds:clip.duration};}
/* The first file's own animation is the run, unless a clip named Run is
   handed in; the rest are read the same way and matched by bone name, which
   is what every Mixamo download of one character shares. */
const named=Object.fromEntries(more.map(a=>{const [n,f]=a.split('=');if(!n||!f)throw Error('a clip is Name=path.fbx[:flat]: '+a);return [n,f];}));
if(!named.Run)keep('Run',active[0],source,input);
for(const [name,spec] of Object.entries(named)){const flat=spec.endsWith(':flat');const file=flat?spec.slice(0,-5):spec;const bytes=readFileSync(file);const other=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');const clip=other.animations.find(a=>a.duration>0&&a.tracks.length);if(!clip)throw Error(file+' has no animation');keep(name,clip,file,bytes,flat);}
const run=clips.find(c=>c.name==='Run_RootMotion');const travel=[paces.Run*100*run.duration,0,0];
let boneCount=0;fbx.traverse(o=>{if(o.isBone)boneCount++;});
for(const mesh of meshes){mesh.name='Body'+(meshes.length>1?'_'+mesh.name:'');mesh.normalizeSkinWeights();mesh.frustumCulled=false;mesh.material=new T.MeshStandardMaterial({name:'Neutral_Clay',color:0xa5acaa,roughness:.75,metalness:0});}
root.userData={sourceFile:'Running.fbx',sourceSha256:createHash('sha256').update(input).digest('hex'),sourceGeometry:'Downloaded Mixamo character; original body vertices and skin retained',unitConversion:'FBX centimetres to glTF metres through a 0.01 parent scale',forward:'+Z',animation:'Original running clip and an in-place copy with linear horizontal root travel removed'};
const exporter=new GLTFExporter();async function glb(){root.updateMatrixWorld(true);const data=await exporter.parseAsync(root,{binary:true,animations:clips,trs:true});writeFileSync(out,Buffer.from(data));console.log('wrote',out,data.byteLength,'bytes');}
await MeshoptSimplifier.ready;
let seed=919;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const layers=[];
function skinLayer(parent,name,g,mat,sourceMesh){const m=new T.SkinnedMesh(g,mat);m.name=name;m.position.copy(sourceMesh.position);m.quaternion.copy(sourceMesh.quaternion);m.scale.copy(sourceMesh.scale);m.bindMode=sourceMesh.bindMode;m.skeleton=sourceMesh.skeleton;m.bindMatrix.copy(sourceMesh.bindMatrix);m.bindMatrixInverse.copy(sourceMesh.bindMatrixInverse);m.frustumCulled=false;parent.add(m);layers.push(m);return m;}
for(const body of meshes){
 body.material=new T.MeshStandardMaterial({name:'Spirit_Translucent_Ivory',color:0xa7b5a4,emissive:0x33392f,emissiveIntensity:.1,roughness:.85,metalness:0,transparent:true,opacity:.42,depthWrite:false,side:T.FrontSide});
 const original=body.geometry, p=original.attributes.position, skinIndex=original.attributes.skinIndex, skinWeight=original.attributes.skinWeight;
 const src=new Map();const key=(x,y,z)=>[x,y,z].map(x=>Math.round(x*10000)).join(',');for(let i=0;i<p.count;i++)src.set(key(p.getX(i),p.getY(i),p.getZ(i)),i);
 let wg=new T.BufferGeometry();wg.setAttribute('position',p.clone());if(original.index)wg.setIndex(original.index.clone());wg=mergeVertices(wg,1e-5);const [ix]=MeshoptSimplifier.simplify(new Uint32Array(wg.index.array),wg.attributes.position.array,3,2200*3,.005);wg.setIndex(new T.BufferAttribute(ix,1));wg.computeVertexNormals();
 const wp=wg.attributes.position,wn=wg.attributes.normal, ps=[],ns=[],inds=[],colors=[],js=[],ws=[],edges=new Set();
 function sourceAt(i){return src.get(key(wp.getX(i),wp.getY(i),wp.getZ(i)));}
 function appendSkin(id){for(let j=0;j<4;j++){js.push(skinIndex.array[id*4+j]);ws.push(skinWeight.array[id*4+j]);}}
 for(let i=0;i<ix.length;i+=3)for(let j=0;j<3;j++){
  const a=ix[i+j],b=ix[i+(j+1)%3],ek=Math.min(a,b)+','+Math.max(a,b);if(edges.has(ek))continue;edges.add(ek);
  const A=new T.Vector3().fromBufferAttribute(wp,a).addScaledVector(new T.Vector3().fromBufferAttribute(wn,a),.045);const B=new T.Vector3().fromBufferAttribute(wp,b).addScaledVector(new T.Vector3().fromBufferAttribute(wn,b),.045);
  const axis=B.clone().sub(A).normalize(),u=new T.Vector3().crossVectors(axis,Math.abs(axis.y)<.9?new T.Vector3(0,1,0):new T.Vector3(1,0,0)).normalize(),w=new T.Vector3().crossVectors(axis,u).normalize(),base=ps.length/3,r=.065+rand()*.03,brightness=.4+rand()*.6;
  for(const [P,id] of [[A,sourceAt(a)],[B,sourceAt(b)]]){if(id===undefined)throw Error('Missing original skin weights');for(let s=0;s<3;s++){const n=u.clone().multiplyScalar(Math.cos(s*Math.PI*2/3)).addScaledVector(w,Math.sin(s*Math.PI*2/3));ps.push(...P.clone().addScaledVector(n,r).toArray());ns.push(...n.toArray());colors.push(brightness,brightness*.97,brightness*.88);appendSkin(id);}}
  for(let s=0;s<3;s++){const t=(s+1)%3;inds.push(base+s,base+t,base+3+s,base+t,base+3+t,base+3+s);}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(ps,3));g.setAttribute('normal',new T.Float32BufferAttribute(ns,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('skinIndex',new T.Uint16BufferAttribute(js,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(ws,4));g.setIndex(inds);
 skinLayer(body.parent,'Filaments',g,new T.MeshStandardMaterial({name:'Spirit_Filaments',color:0xf0f3e0,emissive:0xcdd8c9,emissiveIntensity:.85,vertexColors:true,roughness:.65}),body);
 // Sparse, tapering streamers, attached using the actual mesh's existing weights.
 const rP=[],rC=[],rI=[],rJ=[],rW=[];const candidates=[];for(let i=0;i<p.count;i++){if(p.getY(i)>65&&p.getY(i)<165&&p.getZ(i)<-3&&Math.abs(p.getX(i))<23)candidates.push(i);}
 for(let k=0;k<32&&candidates.length;k++){
  const id=candidates[Math.floor(rand()*candidates.length)],start=new T.Vector3().fromBufferAttribute(p,id),len=20+rand()*43,phase=rand()*Math.PI*2,width=1+rand()*1.6,base=rP.length/3;
  for(let i=0;i<=24;i++){const t=i/24,center=start.clone().add(new T.Vector3(-t*len*.3+Math.sin(t*10+phase)*2,t*len*.2+Math.sin(t*11+phase)*3,-t*len)),across=new T.Vector3(Math.cos(t*5+phase),Math.sin(t*7+phase),.2).normalize();
   for(const s of [-1,0,1]){rP.push(...center.clone().addScaledVector(across,s*width*Math.sin(t*Math.PI)).toArray());rC.push(.72,.8,.72,s===0?.17*Math.sin(t*Math.PI)*(1-t):0);for(let j=0;j<4;j++){rJ.push(skinIndex.array[id*4+j]);rW.push(skinWeight.array[id*4+j]);}}
   if(i<24){const b=base+i*3;rI.push(b,b+1,b+3,b+1,b+4,b+3,b+1,b+2,b+4,b+2,b+5,b+4);}
  }
 }
 const rg=new T.BufferGeometry();rg.setAttribute('position',new T.Float32BufferAttribute(rP,3));rg.setAttribute('color',new T.Float32BufferAttribute(rC,4));rg.setAttribute('skinIndex',new T.Uint16BufferAttribute(rJ,4));rg.setAttribute('skinWeight',new T.Float32BufferAttribute(rW,4));rg.setIndex(rI);rg.computeVertexNormals();for(let i=0;i<rg.attributes.normal.count;i++){const n=rg.attributes.normal;if(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))<.5)n.setXYZ(i,0,0,1);}
 skinLayer(body.parent,'Wisps',rg,new T.MeshBasicMaterial({name:'Spirit_Wisps',vertexColors:true,transparent:true,opacity:.7,depthWrite:false,side:T.DoubleSide}),body);
}
// The pace each clip covers ground at, for the game to scale it by the walk's speed.
root.userData.pace=paces.Run;root.userData.paces=paces;root.userData.clips=Object.keys(paces);
await glb();
const stats={source,sourceSha256:root.userData.sourceSha256,sourceBytes:input.length,heightMetres:new T.Box3().setFromObject(meshes[0]).getSize(new T.Vector3()).y,boneNodes:boneCount,skinJoints:meshes[0].skeleton.bones.length,duration:run.duration,paces,clips:sources,rootSpeedMetresPerSecond:paces.Run,layers:[...meshes,...layers].map(m=>({name:m.name,vertices:m.geometry.attributes.position.count,triangles:(m.geometry.index?.count??m.geometry.attributes.position.count)/3})),animations:clips.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),limitations:['FBXLoader retains the four strongest weights per vertex; those weights are normalized.','Original body mesh is not replaced, remeshed, or simplified. Only the separate filament layer is simplified.','Source textures are replaced by spirit/clay materials.','Wisps are skinned ribbons, not volumetric smoke or persistent world-space trails.']};writeFileSync(out.replace(/\.glb$/,'.json'),JSON.stringify(stats,null,2)+'\n');console.log(JSON.stringify(stats,null,2));
