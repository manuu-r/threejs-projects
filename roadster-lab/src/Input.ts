import { neutralControls, type Controls } from './types.ts';
export type Action='arm'|'hover'|'assist'|'fan'|'camera'|'reset'|'pause'|'gear'|'lookReset';
export class Input {
 private keys=new Set<string>();private down=new Set<string>();private controllerButtons:boolean[]=[];
 active=false;gamepadConnected=false;
 constructor(private onAction:(action:Action)=>void,private onLook:(x:number,y:number)=>void,canvas:HTMLCanvasElement){
  window.addEventListener('keydown',this.keyDown);window.addEventListener('keyup',this.keyUp);window.addEventListener('blur',this.onBlur);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){this.clear();if(this.active)this.onAction('pause');}});
  let dragging=false,lastX=0,lastY=0;
  canvas.addEventListener('pointerdown',e=>{if(!this.active)return;dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(dragging&&this.active){this.onLook(e.clientX-lastX,e.clientY-lastY);lastX=e.clientX;lastY=e.clientY;}});
  canvas.addEventListener('pointerup',()=>{dragging=false;});canvas.addEventListener('pointercancel',()=>{dragging=false;});
 }
 private keyDown=(e:KeyboardEvent)=>{
  if((e.target as HTMLElement).matches('input,textarea,select,[contenteditable="true"]'))return;
  if(e.code==='Escape'||e.code==='KeyP'){if(!e.repeat)this.onAction('pause');return;}
  if(!this.active)return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  this.keys.add(e.code);if(e.repeat)return;
  const actions:Record<string,Action>={KeyF:'arm',KeyH:'hover',KeyL:'assist',KeyB:'fan',KeyC:'camera',KeyR:'reset',KeyG:'gear',KeyV:'lookReset'};
  if(actions[e.code])this.onAction(actions[e.code]!);
 };
 private keyUp=(e:KeyboardEvent)=>{this.keys.delete(e.code);};
 private onBlur=()=>{this.clear();if(this.active)this.onAction('pause');};
 clear=()=>{this.keys.clear();this.down.clear();};
 hold(code:string,on:boolean){if(on)this.down.add(code);else this.down.delete(code);}
 private has(...codes:string[]){return codes.some(c=>this.keys.has(c)||this.down.has(c));}
 sample():Controls{
  if(!this.active)return neutralControls();
  const c:Controls={throttle:this.has('KeyW','ArrowUp')?1:0,brake:this.has('KeyS','ArrowDown')?1:0,
   steer:(this.has('KeyD','ArrowRight')?1:0)-(this.has('KeyA','ArrowLeft')?1:0),boost:this.has('Space'),
   lift:(this.has('KeyE')?1:0)-(this.has('KeyQ')?1:0),yaw:(this.has('KeyX')?1:0)-(this.has('KeyZ')?1:0),
   pitch:(this.has('KeyI')?1:0)-(this.has('KeyK')?1:0),roll:0};
  const pad=Array.from(navigator.getGamepads?.()??[]).find(Boolean);this.gamepadConnected=!!pad;
  if(pad){
   const dead=(x:number)=>Math.abs(x)<.1?0:Math.sign(x)*(Math.abs(x)-.1)/.9;
   const ax=dead(pad.axes[0]??0);if(Math.abs(ax)>Math.abs(c.steer))c.steer=ax;
   c.throttle=Math.max(c.throttle,pad.buttons[7]?.value??0);c.brake=Math.max(c.brake,pad.buttons[6]?.value??0);
   c.yaw=c.yaw||dead(pad.axes[2]??0);c.pitch=c.pitch||-dead(pad.axes[1]??0);
   c.lift=c.lift||((pad.buttons[5]?.pressed?1:0)-(pad.buttons[4]?.pressed?1:0));c.boost=c.boost||!!pad.buttons[0]?.pressed;
   const actionMap:Record<number,Action>={1:'arm',2:'camera',3:'hover',8:'reset',9:'pause',10:'assist'};
   pad.buttons.forEach((b,i)=>{if(b.pressed&&!this.controllerButtons[i]&&actionMap[i])this.onAction(actionMap[i]!);this.controllerButtons[i]=b.pressed;});
  }
  return c;
 }
 dispose(){window.removeEventListener('keydown',this.keyDown);window.removeEventListener('keyup',this.keyUp);window.removeEventListener('blur',this.onBlur);}
}
