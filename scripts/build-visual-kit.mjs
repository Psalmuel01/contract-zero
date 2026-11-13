// Original CONTRACT ZERO assets, MIT. Offline authoring: metres, Y up, barrel +Z.
// No third-party models, textures, or runtime CSG. Run: node scripts/build-visual-kit.mjs
import * as T from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
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
  alloy: new T.MeshStandardMaterial({ name: 'phosphated alloy', color: '#2a2d30', metalness: .55, roughness: .5 }),
  polymer: new T.MeshStandardMaterial({ name: 'reinforced polymer', color: '#5e5848', metalness: .02, roughness: .78 }),
  edge: new T.MeshStandardMaterial({ name: 'machined steel', color: '#4f555b', metalness: .8, roughness: .34 }),
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
 return {group, add(mat,g,x=0,y=0,z=0,rx=0,ry=0,rz=0) {if(!buckets.has(mat))buckets.set(mat,[]);buckets.get(mat).push(part(g,x,y,z,rx,ry,rz))}, finish(){for(const [mat,parts] of buckets){const merged=mergeGeometries(parts);merged.deleteAttribute('uv');const mesh=new T.Mesh(mergeVertices(merged,1e-5),palette[mat]);mesh.name=mat;group.add(mesh)}return group}}
}
// ── Service carbine ─────────────────────────────────────────────────────────
// Built the way the real thing reads: side PROFILES (receiver, grip, stock, magazine)
// extruded to their width with chamfered edges that catch light, and turned parts
// (barrel, gas block, muzzle device, buffer tube) lathed from their radius profile.
// Bore axis at y=0.02; z runs butt (-0.44) to muzzle (+0.45). A generic carbine, no
// manufacturer's design or markings.
const rifle=model('CZ service carbine')
const box=(m,mat,w,h,d,x,y,z,rx=0,ry=0,rz=0,r=.004)=>m.add(mat,bevel(w,h,d,Math.min(r,w/5,h/5,d/5)),x,y,z,rx,ry,rz)
// A side profile in (z, y), extruded across x by `w`, centred on x. Bevel = chamfer size.
function profile(pts,w,bevel=.0025,curves=[]) {
 const s=new T.Shape();s.moveTo(pts[0][0],pts[0][1])
 for(let i=1;i<pts.length;i++){const c=curves[i];if(c)s.quadraticCurveTo(c[0],c[1],pts[i][0],pts[i][1]);else s.lineTo(pts[i][0],pts[i][1])}
 s.closePath()
 const g=new T.ExtrudeGeometry(s,{depth:w-2*bevel,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:6,steps:1})
 g.translate(0,0,-(w-2*bevel)/2);g.rotateY(-Math.PI/2);return g
}
// A turned part along z from radius profile [[z, r], ...].
function turned(pts,seg=20) {
 const g=new T.LatheGeometry(pts.map(([z,r])=>new T.Vector2(r,z)),seg)
 g.rotateX(Math.PI/2);return g
}
const BORE=.02
// Upper receiver: flat top, ejection-port side, forward assist hump at the rear right.
rifle.add('alloy',profile([[-.17,.0],[.07,.0],[.07,.046],[-.15,.046],[-.17,.036]],.054,.003))
box(rifle,'edge',.003,.02,.058,.028,.022,-.035)            // ejection port cover
rifle.add('edge',new T.CylinderGeometry(.007,.008,.03,14),.03,.03,-.12,0,0,Math.PI/2.3) // forward assist
box(rifle,'alloy',.04,.012,.03,0,.04,-.165)                 // charging handle latch
// Lower receiver with its magwell flare and the trigger guard.
rifle.add('alloy',profile([[-.17,.0],[.065,.0],[.065,-.012],[.045,-.022],[.042,-.072],[-.045,-.072],[-.05,-.03],[-.105,-.03],[-.12,-.045],[-.17,-.03]],.05,.003))
rifle.add('alloy',profile([[-.045,-.045],[-.035,-.045],[-.03,-.072],[-.095,-.07],[-.105,-.045],[-.095,-.045],[-.093,-.062],[-.04,-.064]],.014,.0015))
box(rifle,'edge',.004,.026,.006,0,-.052,-.065,.35)          // trigger
rifle.add('edge',new T.CylinderGeometry(.0035,.0035,.056,10),0,-.012,-.14,0,0,Math.PI/2) // pins
rifle.add('edge',new T.CylinderGeometry(.0035,.0035,.056,10),0,-.012,.045,0,0,Math.PI/2)
box(rifle,'edge',.004,.012,.018,.027,-.018,-.115)            // selector
box(rifle,'edge',.004,.02,.014,-.027,-.03,.0)               // bolt release
// Pistol grip: raked back, finger swell at the front, rounded heel.
rifle.add('polymer',profile([[-.075,-.03],[-.11,-.03],[-.15,-.13],[-.13,-.15],[-.112,-.148],[-.083,-.06]],.032,.004,[null,null,[-.135,-.08],[-.152,-.152],null,[-.088,-.11]]))
for(let i=0;i<4;i++) box(rifle,'rubber',.034,.003,.012,0,-.06-i*.022,-.118-i*.007,-.42)
// Handguard: a rounded free-float tube with slots, top rail continuous with the receiver.
{const s=new T.Shape(),w=.025,h=.026,r=.011
 s.moveTo(-w+r,-h);s.lineTo(w-r,-h);s.quadraticCurveTo(w,-h,w,-h+r);s.lineTo(w,h-r);s.quadraticCurveTo(w,h,w-r,h);s.lineTo(-w+r,h);s.quadraticCurveTo(-w,h,-w,h-r);s.lineTo(-w,-h+r);s.quadraticCurveTo(-w,-h,-w+r,-h)
 const g=new T.ExtrudeGeometry(s,{depth:.3,bevelEnabled:true,bevelThickness:.003,bevelSize:.003,bevelSegments:2,curveSegments:4,steps:1})
 rifle.add('alloy',g,0,BORE+.002,.072)}
for(const side of [-1,1]) for(let i=0;i<5;i++) box(rifle,'rubber',.002,.007,.032,side*.0285,BORE-.002,.105+i*.05,0,0,0,.002)
for(let i=0;i<5;i++) box(rifle,'rubber',.03,.002,.032,0,BORE-.0285,.105+i*.05,0,0,0,.002)
box(rifle,'alloy',.022,.01,.53,0,.05,.1,0,0,0,.0015)          // top rail
for(let i=0;i<34;i++) box(rifle,'edge',.024,.004,.006,0,.057,-.155+i*.0155,0,0,0,.001)
// Barrel, gas block and a slotted muzzle device, all turned.
rifle.add('alloy',turned([[.36,0],[.36,.0105],[.37,.009],[.43,.0085],[.43,0]]),0,BORE,0)
rifle.add('edge',turned([[.4,0],[.4,.012],[.402,.0135],[.446,.0135],[.449,.011],[.449,0]],16),0,BORE,0)
for(let i=0;i<3;i++) box(rifle,'rubber',.029,.0035,.007,0,BORE+.006,.411+i*.011,0,0,0,.001)
// Iron sights folded low on the rail, so they never sit in the sight picture.
box(rifle,'alloy',.024,.012,.03,0,.066,-.13,0,0,0,.002)
box(rifle,'alloy',.022,.012,.028,0,.066,.33,0,0,0,.002)
// Buffer tube, collapsible stock (cheek riser, sling slot, rubber butt pad). A named node:
// shouldered, the stock is under the cheek and out of sight, so the viewmodel hides it.
const stock=model('stock')
stock.add('alloy',turned([[-.36,0],[-.36,.015],[-.17,.015],[-.165,.017],[-.16,0]]),0,.016,0)
box(stock,'alloy',.03,.01,.012,0,.004,-.172)                   // castle nut / end plate
stock.add('polymer',profile([[-.25,.034],[-.42,.04],[-.43,.03],[-.43,-.075],[-.405,-.085],[-.35,-.02],[-.27,-.008],[-.25,.0]],.042,.005,[null,null,null,null,null,[-.37,-.07],null,null]))
box(stock,'rubber',.046,.122,.016,0,-.019,-.437,0,0,0,.004)
box(stock,'rubber',.044,.008,.05,0,.04,-.33,0,0,0,.002)
rifle.group.add(stock.finish())
// Magazine, a separate node for the reload: slightly curved, ribbed, with a base plate.
const magazine=model('magazine')
magazine.add('polymer',profile([[-.04,-.065],[.036,-.065],[.042,-.15],[.058,-.235],[-.012,-.245],[-.026,-.155]],.026,.003,[null,null,[.039,-.11],[.05,-.2],null,[-.022,-.2]]))
for(let i=0;i<4;i++) magazine.add('rubber',profile([[-.024-i*.002,-.09-i*.035],[.04+i*.004,-.09-i*.035],[.041+i*.004,-.094-i*.035],[-.025-i*.002,-.094-i*.035]],.028,.0008))
magazine.add('rubber',profile([[-.016,-.238],[.062,-.229],[.064,-.243],[-.014,-.252]],.03,.0025))
rifle.group.add(magazine.finish())
const rifleGroup=rifle.finish();rifleGroup.userData={license:'MIT',units:'metres',barrelAxis:'+Z',length:.895,authored:true}

// Unit-envelope modules; instances scale to the existing collision boxes exactly.
const kit=new T.Group();kit.name='CZ modular production kit'
const container=model('container')
box(container,'paint',.97,.96,.97,0,0,0,0,0,0,.007)
for(const x of [-.48,.48])for(const z of [-.48,.48])box(container,'edge',.04,1,.04,x,0,z)
for(const y of [-.48,.48])box(container,'edge',1,.04,1,0,y,0)
// Ribs are plain boxes: bevels on 34 of them cost 1,500 triangles nobody sees at range.
for(let i=0;i<15;i++)for(const x of [-.491,.491])container.add('paint',new T.BoxGeometry(.018,.90,.03),x,0,-.43+i*.0614)
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
 const modules={};for(const c of group.children){let t=0;c.traverse(o=>{if(o.isMesh)t+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3});modules[c.name]=t}
 return {file:name,bytes:glb.byteLength,triangles:tris,primitives:meshes,...(name.includes('kit')?{modules}:{}),license:'MIT',source:'scripts/build-visual-kit.mjs'}
}
const inventory=[await save('service-carbine.glb',rifleGroup),await save('modular-kit.glb',kit)]
await writeFile(resolve(root,'inventory.json'),JSON.stringify(inventory,null,2)+'\n')
console.log(JSON.stringify(inventory,null,2))
