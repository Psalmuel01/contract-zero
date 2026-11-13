// Original CONTRACT ZERO assets, MIT. Offline authoring: metres, Y up, barrel +Z.
// No third-party models, textures, or runtime CSG. Run: node scripts/build-visual-kit.mjs
import * as T from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Node Blob support for the exporter; no browser or canvas required.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((v) => { this.result = v; this.onloadend?.() }) }
  readAsDataURL(blob) { blob.arrayBuffer().then((v) => { this.result = `data:${blob.type};base64,${Buffer.from(v).toString('base64')}`; this.onloadend?.() }) }
}
const root = resolve(import.meta.dirname, '../apps/web/public/models/production')
await mkdir(root, { recursive: true })
const palette = {
  alloy: new T.MeshStandardMaterial({ name: 'phosphated alloy', color: '#353b40', metalness: .8, roughness: .36 }),
  polymer: new T.MeshStandardMaterial({ name: 'reinforced polymer', color: '#272b29', metalness: .03, roughness: .72 }),
  edge: new T.MeshStandardMaterial({ name: 'machined steel', color: '#687078', metalness: .85, roughness: .29 }),
  rubber: new T.MeshStandardMaterial({ name: 'rubber', color: '#131717', metalness: 0, roughness: .91 }),
  paint: new T.MeshStandardMaterial({ name: 'powder coat', color: '#79806b', metalness: .28, roughness: .67 }),
  concrete: new T.MeshStandardMaterial({ name: 'cast concrete', color: '#aaa99e', roughness: .96 }),
}
function bevel(w,h,d,r=.005) {
  const s=new T.Shape(), x=-w/2+r, y=-h/2+r
  s.moveTo(x,y);s.lineTo(x+w-2*r,y);s.lineTo(x+w-2*r,y+h-2*r);s.lineTo(x,y+h-2*r);s.closePath()
  const g=new T.ExtrudeGeometry(s,{depth:d-2*r,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelSegments:2,steps:1,curveSegments:1})
  g.translate(0,0,-d/2+r);return g
}
function part(g,x,y,z,rx=0,ry=0,rz=0) {g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(rx,ry,rz)));g.translate(x,y,z);return g.index?g.toNonIndexed():g}
function model(name) {
 const group=new T.Group();group.name=name;const buckets=new Map()
 return {group, add(mat,g,x=0,y=0,z=0,rx=0,ry=0,rz=0) {if(!buckets.has(mat))buckets.set(mat,[]);buckets.get(mat).push(part(g,x,y,z,rx,ry,rz))}, finish(){for(const [mat,parts] of buckets){const mesh=new T.Mesh(mergeGeometries(parts),palette[mat]);mesh.name=mat;group.add(mesh)}return group}}
}
const rifle=model('CZ service carbine')
const box=(m,mat,w,h,d,x,y,z,rx=0,ry=0,rz=0,r=.004)=>m.add(mat,bevel(w,h,d,Math.min(r,w/5,h/5,d/5)),x,y,z,rx,ry,rz)
// Receiver, lower, buffer, adjustable stock: clear functional silhouettes.
box(rifle,'alloy',.065,.072,.24,0,.005,-.045)
box(rifle,'alloy',.059,.048,.17,0,-.047,-.065)
box(rifle,'polymer',.048,.115,.062,0,-.113,-.115,-.24)
box(rifle,'polymer',.046,.10,.21,0,-.012,-.322)
box(rifle,'rubber',.052,.13,.018,0,-.025,-.431)
rifle.add('edge',new T.CylinderGeometry(.016,.016,.16,16),0,.01,-.24,Math.PI/2)
// Handguard with machined recesses: rails leave open gaps rather than a solid slab.
box(rifle,'alloy',.061,.018,.24,0,.038,.16)
box(rifle,'alloy',.055,.014,.24,0,-.033,.16)
for(const side of [-1,1]) {
 box(rifle,'alloy',.009,.038,.24,side*.031,.005,.16)
 for(let i=0;i<7;i++) box(rifle,'rubber',.002,.012,.020,side*.036,.009,.067+i*.030)
}
// Barrel, gas block and open muzzle crown, all with smooth radial normals.
rifle.add('alloy',new T.CylinderGeometry(.009,.009,.36,16),0,.007,.25,Math.PI/2)
box(rifle,'edge',.025,.034,.026,0,.01,.288)
rifle.add('alloy',new T.CylinderGeometry(.016,.016,.035,16,1,true),0,.007,.4225,Math.PI/2)
rifle.add('edge',new T.TorusGeometry(.012,.004,6,16),0,.007,.440)
// Continuous rail and separate teeth, rear aperture/front post remain below eye line.
box(rifle,'alloy',.027,.012,.47,0,.054,.045)
for(let i=0;i<30;i++) box(rifle,'edge',.032,.007,.007,0,.063,-.18+i*.015)
for(const z of [-.145,.265]) {box(rifle,'alloy',.028,.033,.018,0,.080,z);box(rifle,'edge',.007,.025,.009,0,.103,z)}
// Controls, ejection port, pins; small parts share materials/draws.
box(rifle,'rubber',.002,.027,.075,.034,.013,-.015)
box(rifle,'edge',.006,.008,.056,.037,-.003,-.015)
for(const z of [-.11,.025]) rifle.add('edge',new T.CylinderGeometry(.004,.004,.068,10),0,-.041,z,0,0,Math.PI/2)
// Magazine is a named detachable node for the reload animation.
const magazine=model('magazine')
box(magazine,'polymer',.043,.155,.078,0,-.143,.006,.10)
for(let i=0;i<5;i++) box(magazine,'rubber',.045,.006,.080,0,-.09-i*.025,.006,.10)
rifle.group.add(magazine.finish())
const rifleGroup=rifle.finish();rifleGroup.userData={license:'MIT',units:'metres',barrelAxis:'+Z',length:.88,authored:true}

// Unit-envelope modules; instances scale to the existing collision boxes exactly.
const kit=new T.Group();kit.name='CZ modular production kit'
const container=model('container')
box(container,'paint',.97,.96,.97,0,0,0,0,0,0,.007)
for(const x of [-.48,.48])for(const z of [-.48,.48])box(container,'edge',.04,1,.04,x,0,z)
for(const y of [-.48,.48])box(container,'edge',1,.04,1,0,y,0)
for(let i=0;i<17;i++)for(const x of [-.491,.491])box(container,'paint',.018,.90,.025,x,0,-.44+i*.055)
for(const z of [-.49,.49])for(const x of [-.24,.24])box(container,'edge',.018,.88,.018,x,0,z)
kit.add(container.finish())
const barrier=model('barrier')
// True jersey section: sloped sides, broad foot, narrow crown.
const section=new T.Shape();section.moveTo(-.5,-.5);section.lineTo(.5,-.5);section.lineTo(.5,-.33);section.lineTo(.23,.10);section.lineTo(.18,.5);section.lineTo(-.18,.5);section.lineTo(-.23,.10);section.lineTo(-.5,-.33);section.closePath()
const jersey=new T.ExtrudeGeometry(section,{depth:1,bevelEnabled:false,steps:1});jersey.translate(0,0,-.5);barrier.add('concrete',jersey)
kit.add(barrier.finish())
const equipment=model('case')
box(equipment,'paint',.94,.94,.94,0,0,0,0,0,0,.025)
for(const x of [-.47,.47])for(const z of [-.47,.47])box(equipment,'rubber',.06,.98,.06,x,0,z)
for(const y of [-.38,.34])box(equipment,'edge',.96,.018,.96,0,y,0)
for(const x of [-.28,.28])box(equipment,'edge',.09,.13,.025,x,.29,.485)
kit.add(equipment.finish())
const truck=model('truck')
box(truck,'alloy',.84,.08,.92,0,-.27,0)
// Sloped military cab, separate windshield and steel bumper.
const cabShape=new T.Shape();cabShape.moveTo(-.18,-.22);cabShape.lineTo(.23,-.22);cabShape.lineTo(.23,.12);cabShape.lineTo(.12,.34);cabShape.lineTo(-.18,.34);cabShape.closePath()
const cabGeo=new T.ExtrudeGeometry(cabShape,{depth:.86,bevelEnabled:false,steps:1})
// Profile X is vehicle Z, extruded Z is width.
cabGeo.translate(0,0,-.43);cabGeo.rotateY(Math.PI/2)
truck.add('paint',cabGeo,0,0,.24)
box(truck,'rubber',.74,.14,.014,0,.245,.414,.46)
box(truck,'edge',.92,.045,.08,0,-.23,.46)
box(truck,'paint',.88,.035,.56,0,-.18,-.19)
box(truck,'polymer',.86,.46,.56,0,.065,-.19,0,0,0,.035)
for(const z of [-.44,-.21,.02])box(truck,'edge',.87,.018,.025,0,.30,z)
for(const z of [-.36,-.16,.32])for(const x of [-.44,.44]) {
 truck.add('rubber',new T.CylinderGeometry(.13,.13,.11,20).scale(1,1,.36),x,-.36,z,0,0,Math.PI/2)
 truck.add('edge',new T.CylinderGeometry(.064,.064,.115,12).scale(1,1,.36),x,-.36,z,0,0,Math.PI/2)
}
for(const x of [-.30,.30])box(truck,'edge',.10,.045,.018,x,-.08,.483)
kit.add(truck.finish())
const pump=model('pump')
box(pump,'alloy',1,.12,1,0,-.44,0)
box(pump,'paint',.44,.34,.7,.15,-.21,0)
pump.add('edge',new T.CylinderGeometry(.22,.22,.55,20),-.22,-.03,0,Math.PI/2)
for(const z of [-.30,.30])pump.add('alloy',new T.CylinderGeometry(.27,.27,.055,20),-.22,-.03,z,Math.PI/2)
box(pump,'paint',.4,.35,.4,.15,.15,0)
pump.add('edge',new T.CylinderGeometry(.08,.08,.26,12),.15,.37,0)
kit.add(pump.finish())
async function save(name,group) {
 const glb=await new GLTFExporter().parseAsync(group,{binary:true,onlyVisible:true})
 await writeFile(resolve(root,name),Buffer.from(glb))
 let tris=0,meshes=0;group.traverse(o=>{if(o.isMesh){meshes++;tris+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3}})
 return {file:name,bytes:glb.byteLength,triangles:tris,primitives:meshes,license:'MIT',source:'scripts/build-visual-kit.mjs'}
}
const inventory=[await save('service-carbine.glb',rifleGroup),await save('modular-kit.glb',kit)]
await writeFile(resolve(root,'inventory.json'),JSON.stringify(inventory,null,2)+'\n')
console.log(JSON.stringify(inventory,null,2))
