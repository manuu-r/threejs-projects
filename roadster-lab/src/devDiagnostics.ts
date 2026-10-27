import * as T from 'three';
import type { Simulator } from './Runtime.ts';
const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
/** The app reports only its own scene and generated UI state to its localhost
 * dev server. It neither observes nor controls the user's computer/browser UI. */
export async function reportStartup(game:Simulator,checks:Record<string,boolean>={}){
 for(let i=0;i<4;i++)await nextFrame();
 const r=game.renderer,gl=r.getContext(),canvas=r.domElement;
 const report={checkedAt:new Date().toISOString(),status:'rendered',...checks,
  canvasWidth:canvas.width,canvasHeight:canvas.height,cssWidth:canvas.clientWidth,cssHeight:canvas.clientHeight,
  calls:r.info.render.calls,triangles:r.info.render.triangles,programs:r.info.programs?.length??0,
  glError:gl.getError(),contextLost:gl.isContextLost(),carMeshes:0,variant:game.physics.variant,
  lesson:game.lessons.lesson.id,physicsStepsPerSecond:120,
  simpleCockpit:game.cockpit.simple,extraDisplayHidden:game.cockpit.simple?game.cockpit.car.getObjectByName('Secondary_Display')?.visible===false:null,
  errors:[] as string[]};
 game.cockpit.car.traverse(o=>{if(o.type==='Mesh')report.carMeshes++;});
 // Export the app's own 3D canvas at a useful comparison aspect ratio,
 // without changing the browser viewport or capturing desktop/UI content.
 const size=r.getSize(new T.Vector2()),ratio=r.getPixelRatio(),aspect=game.camera.aspect;
 r.setPixelRatio(1);r.setSize(1600,900,false);game.camera.aspect=1600/900;game.camera.updateProjectionMatrix();
 r.render(game.scene,game.camera);const image=canvas.toDataURL('image/png');
 const view=game.cockpit.view,fov=game.camera.fov;const views:Record<string,string>={display:game.cockpit.center.canvas.toDataURL('image/png')};
 game.cockpit.view='chase';game.cockpit.update(game.physics,game.physics.telemetry(),0,true);
 for(const [name,x,y,z] of [['front',-4,1.65,5.6],['rear',3.7,1.6,-5.5]] as const){
  game.camera.fov=40;game.camera.position.set(x,y,z).applyQuaternion(game.cockpit.car.quaternion).add(game.cockpit.car.position);
  game.camera.lookAt(new T.Vector3(0,.06,0).applyQuaternion(game.cockpit.car.quaternion).add(game.cockpit.car.position));game.camera.updateProjectionMatrix();
  r.render(game.scene,game.camera);views[name]=canvas.toDataURL('image/png');
 }
 game.cockpit.view=view;game.camera.fov=fov;game.cockpit.update(game.physics,game.physics.telemetry(),0,true);
 r.setPixelRatio(ratio);r.setSize(size.x,size.y,false);game.camera.aspect=aspect;game.camera.updateProjectionMatrix();
 r.render(game.scene,game.camera);
 const exportedReport={...report,captureWidth:1600,captureHeight:900,capture:'application 3D canvas only; viewport retained'};
 await fetch('/__lab_diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report:exportedReport,image,views})});
}
export function reportFailure(error:unknown){
 void fetch('/__lab_diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report:{checkedAt:new Date().toISOString(),status:'error',message:error instanceof Error?error.message:String(error)}})}).catch(()=>{});
}
