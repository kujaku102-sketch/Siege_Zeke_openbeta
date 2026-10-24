import * as THREE from 'three';
import { BOARD_CAMERA } from './geometry.js';
import { DEFAULT_RENDER_QUALITY, renderResolution, observeDrawing, drawingLimit } from './render-resolution.js';
import { createCardMeshes } from './card-meshes.js';
import { boardPieces } from './board-view.js';

// Decorative geometry only: the board and the card slabs. Public cards, targets and
// action IDs live in the SVG overlay. No engine access and no interactive objects.
export function createBoardScene(canvas, svg, quality = DEFAULT_RENDER_QUALITY) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  const limit = drawingLimit(renderer);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(BOARD_CAMERA.fov, 1600/900, .1, 80);
  camera.position.set(0,BOARD_CAMERA.distance,BOARD_CAMERA.distance);
  camera.lookAt(0,0,0);
  scene.add(new THREE.AmbientLight('#afbdd0',1.4));
  const light = new THREE.DirectionalLight('#d1e3ff',2);
  light.position.set(-6,10,5);scene.add(light);
  const dark=new THREE.MeshLambertMaterial({color:'#151e28',flatShading:true});
  const rim=new THREE.MeshLambertMaterial({color:'#293544',flatShading:true});
  const cyan=new THREE.MeshBasicMaterial({color:'#00ccef'});
  const box=(w,h,d,x,y,z,material)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    mesh.position.set(x,y,z);scene.add(mesh);return mesh;
  };
  box(12.8,.45,11.4,0,-.32,0,dark);
  const floor=new THREE.PlaneGeometry(12.4,10.8,16,18).toNonIndexed();
  floor.rotateX(-Math.PI/2);
  const colors=[];
  for(let i=0;i<floor.attributes.position.count;i+=3){
    const c=new THREE.Color('#23303d').multiplyScalar(.86+(Math.sin(i*91.73)*.5+.5)*.14);
    for(let n=0;n<3;n++)colors.push(c.r,c.g,c.b);
  }
  floor.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  scene.add(new THREE.Mesh(floor,new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true})));
  for(const x of [-6.25,6.25])box(.22,.22,11.2,x,0,0,rim);
  for(const z of [-5.4,0,5.4])box(12.5,.2,.2,0,0,z,rim);
  for(const x of [-6.25,6.25])for(const z of [-5.4,0,5.4]){
    const tower=new THREE.Mesh(new THREE.ConeGeometry(.38,.7,4),rim);
    tower.position.set(x,.28,z);tower.rotation.y=Math.PI/4;scene.add(tower);
    const glow=new THREE.Mesh(new THREE.ConeGeometry(.15,.3,4),cyan);
    glow.position.set(x,.35,z+.14);glow.rotation.y=Math.PI/4;scene.add(glow);
  }
  const cards=createCardMeshes(scene,canvas.ownerDocument);
  function draw(){
    const rect=canvas.getBoundingClientRect(),v=svg.viewBox.baseVal;
    if(!rect.width||!rect.height||!v.width||!v.height)return;
    const size=renderResolution(rect.width,rect.height,quality,globalThis.devicePixelRatio,limit);
    if(canvas.width!==size.width||canvas.height!==size.height) renderer.setSize(size.width,size.height,false);
    cards.follow(svg);
    camera.setViewOffset(1600,900,v.x,v.y,v.width,v.height);
    camera.updateProjectionMatrix();renderer.render(scene,camera);
  }
  const observer=observeDrawing(canvas,draw);
  // Slabs copy the motion of their SVG groups, so the board is redrawn every frame
  // while a card group animates, and for a while after a re-render (flights hide
  // cards by a style rule, not an animation).
  const win=canvas.ownerDocument.defaultView;
  const FOLLOW_MS=3000;
  let frame=0,until=0;
  const moving=()=>svg.getAnimations?.({subtree:true}).some(a=>{
    const node=a.effect?.target;
    return a.playState!=='finished'&&node?.matches?.('[data-card-ref],[data-fx-zone],[data-runtime-zone]');
  });
  const tick=()=>{
    frame=0;
    if(cards.follow(svg))draw();
    if(win.performance.now()<until||moving())frame=win.requestAnimationFrame(tick);
  };
  const watch=()=>{until=win.performance.now()+FOLLOW_MS;if(!frame)frame=win.requestAnimationFrame(tick);};
  cards.onChange(observer.request);
  svg.addEventListener('board-camera-change',observer.request);
  svg.addEventListener('board-motion',watch);
  draw();
  return {draw:observer.request,
    sync(model){cards.sync(boardPieces(model));observer.request();watch();},
    dispose(){
    observer.dispose();win.cancelAnimationFrame(frame);
    svg.removeEventListener('board-camera-change',observer.request);svg.removeEventListener('board-motion',watch);
    cards.dispose();
    const materials=new Set();scene.traverse(o=>{o.geometry?.dispose();if(o.material)materials.add(o.material);});
    for(const m of materials)m.dispose();renderer.dispose();
  }};
}
