import type { LessonId, Telemetry, Variant } from './types.ts';
export interface Lesson {id:LessonId;number:string;title:string;subtitle:string;variant:Variant;duration:string;description:string;theory:string;steps:string[];keys:[string,string][];spawn:{x:number;z:number};}
export const LESSONS:Lesson[]=[
 {id:'orientation',number:'01',title:'Find your feet.',subtitle:'Cockpit & control',variant:'performance',duration:'2 MIN',description:'Get comfortable in a very different driving seat. Build speed gently, then bring the car to a deliberate stop.',theory:'The yoke commands the front tire steering angle. Motor torque accelerates the car through the tires; suspension and downforce determine how much grip is available. Start with small, smooth inputs.',steps:['Accelerate beyond 30 km/h.','Release the accelerator and brake to a stop.'],keys:[['W / ↑','Accelerate'],['S / ↓','Brake'],['A D / ← →','Steer'],['R','Reset lesson']],spawn:{x:0,z:-500}},
 {id:'braking',number:'02',title:'Own the stopping distance.',subtitle:'Precision braking',variant:'performance',duration:'3 MIN',description:'Build to 100 km/h, then ease the accelerator to hold near that speed. Begin braking at the amber line and finish inside the marked stopping box.',theory:'Stopping distance grows with the square of speed: d ≈ v² / (2a). Use the fan to add tire load even at low speed. Turning while braking shares the tire force budget, so stay straight.',steps:['Reach at least 100 km/h before the amber line.','Hold near 100 km/h; brake as you cross the amber line at 140 m.','Stop inside the box, 145–225 m from the start.'],keys:[['W','Accelerate'],['S','Brake'],['B','Toggle suction fan']],spawn:{x:0,z:-500}},
 {id:'slalom',number:'03',title:'Look through the corner.',subtitle:'Grip & weight transfer',variant:'performance',duration:'3 MIN',description:'Thread five gates with gentle steering. Aim through the center and control your speed before each direction change.',theory:'Steering becomes more sensitive as speed rises. Cornering acceleration is v²/r. The tires cannot provide maximum braking and maximum turning together; ease the accelerator before loading the front axle.',steps:['Pass all five green gates in order.','Keep contact with the ground and avoid the barriers.'],keys:[['W / S','Manage speed'],['A / D','Steer'],['B','Compare fan on/off']],spawn:{x:0,z:-500}},
 {id:'impulse',number:'04',title:'A second kind of acceleration.',subtitle:'Cold-gas impulse',variant:'thrust',duration:'2 MIN',description:'Arm the rear thrusters, deliver a short burst, then stop. Feel the extra acceleration and watch pressure fall.',theory:'Rear thrusters push against expelled gas rather than against the road. Their force adds to tire traction. Impulse is force × time; every burst spends a finite reserve. These are compressed-gas plumes, not flames.',steps:['Arm the gas system with F.','Deliver at least 12 kN·s with Space.','Release thrust and brake to a stop.'],keys:[['F','Arm / safe'],['Space','Hold rear thrust'],['S','Brake']],spawn:{x:0,z:-500}},
 {id:'hover',number:'05',title:'Trade grip for gravity.',subtitle:'Assisted vertical flight',variant:'rocket',duration:'3 MIN',description:'Arm, engage hover, stabilize above the pad, then command a landing. You have only a few seconds of useful gas.',theory:'Hover needs upward thrust equal to weight. Unlike aerodynamic downforce, it costs propellant continuously. The teaching autopilot uses altitude and attitude feedback. Do not wait for an empty reservoir to descend.',steps:['Arm with F, then engage hover with H.','Hold 1.5–3.5 m altitude for 1 second.','Press H again to descend; land gently.'],keys:[['F → H','Arm, then hover'],['E / Q','Raise / lower target'],['H','Command landing']],spawn:{x:0,z:-500}},
 {id:'translation',number:'06',title:'Move without wheels.',subtitle:'Flight translation',variant:'rocket',duration:'3 MIN',description:'Lift off, use a brief forward command to lean into motion, then recover and land. Keep corrections small.',theory:'A tilted thrust vector has vertical and horizontal components. The altitude controller must increase total thrust to keep height while you lean. Momentum persists when you release an input; opposite lean is needed to slow down.',steps:['Arm and engage hover.','Travel 1.5 m forward while airborne.','Command a landing with H.'],keys:[['W / S','Lean forward / back'],['A / D','Lean left / right'],['Z / X','Yaw left / right'],['H','Land']],spawn:{x:0,z:-500}},
 {id:'manual',number:'07',title:'Feel every axis.',subtitle:'Manual attitude control',variant:'rocket',duration:'4 MIN',description:'Lift off with assistance, switch to manual, apply a small yaw pulse and restore assistance before landing.',theory:'A force through the center of mass translates the car. A force at a lever arm also creates torque, τ = r × F. Without stabilization, angular momentum persists. Manual collective starts around weight; it does not hold altitude.',steps:['Take off with F, then H.','Switch assist off with L and apply a yaw pulse.','Restore assist with L; press H to land.'],keys:[['L','Toggle stabilization'],['W S / I K','Pitch'],['A / D','Roll'],['Z / X','Yaw'],['E / Q','Collective']],spawn:{x:0,z:-500}},
 {id:'sandbox',number:'∞',title:'Make it your proving ground.',subtitle:'Free practice',variant:'rocket',duration:'OPEN',description:'Experiment with every configuration, the full runway, crosswind, wet conditions, camera views, and telemetry. Your reservoir is still finite.',theory:'Combine what you learned. Try a short rear-thrust launch, controlled braking, a low hover with yaw, or a tiny manual attitude pulse. Reset replenishes gas and repairs the car. View the engineering notes to understand every assumption.',steps:['Explore the course and systems at your own pace.'],keys:[['C','Change camera'],['F / Space','Arm / rear burst'],['H / L','Hover / assist'],['R','Reset & refill']],spawn:{x:0,z:-500}}
];
export const GATES=[{x:-4,z:-450},{x:5,z:-405},{x:-5,z:-360},{x:5,z:-315},{x:0,z:-270}];
export interface LessonState {stage:number;progress:number;hint:string;complete:boolean;failed:boolean;reason:string;score:number;gate:number;peakSpeed:number;impulse:number;hoverTime:number;time:number;}
export class LessonEngine {
  lesson:Lesson;state:LessonState;private lastZ=-500;private manualHeading=0;private armedSeen=false;private usedManual=false;private restored=false;private brakeSeen=false;
  constructor(id:LessonId='orientation'){this.lesson=LESSONS.find(l=>l.id===id)!;this.state=this.fresh();}
  private fresh():LessonState{return {stage:0,progress:0,hint:this.lesson.steps[0]!,complete:false,failed:false,reason:'',score:0,gate:0,peakSpeed:0,impulse:0,hoverTime:0,time:0};}
  reset(id:LessonId=this.lesson.id){this.lesson=LESSONS.find(l=>l.id===id)!;this.state=this.fresh();this.lastZ=this.lesson.spawn.z;this.manualHeading=0;this.armedSeen=false;this.usedManual=false;this.restored=false;this.brakeSeen=false;}
  update(t:Telemetry,dt:number,braking=false):void {
    const s=this.state,id=this.lesson.id;if(s.complete||s.failed)return;
    s.time+=dt;s.peakSpeed=Math.max(s.peakSpeed,t.speed);s.impulse+=t.thrust*dt;
    if(id==='sandbox'){s.hint=t.flying?'Spend gas deliberately. Press H to land.':'Open practice. Choose a maneuver and watch its telemetry.';return;}
    if(t.damage>50){s.failed=true;s.reason='The car sustained a hard impact. Reset and use smaller inputs.';return;}
    if(Math.abs(t.x)>20.3){s.failed=true;s.reason='You left the training lane. Reset and look farther ahead.';return;}
    if(s.time>160){s.failed=true;s.reason='Session time exceeded. Reset to try again.';return;}
    switch(id){
      case'orientation':if(s.stage===0&&t.speed>=30)s.stage=1;if(s.stage===1&&t.speed<1&&braking)this.finish(t);break;
      case'braking':{
        const d=t.z-this.lesson.spawn.z;
        if(s.stage===0&&s.peakSpeed>=100)s.stage=1;
        if(s.stage===1&&d>=140&&braking){s.stage=2;this.brakeSeen=true;}
        if(d>225&&t.speed>1){s.failed=true;s.reason='You passed the stopping box. Hold near 100 km/h before the line, then brake firmly.';}
        else if(s.stage===2&&t.speed<1&&d>=145&&d<=225&&this.brakeSeen)this.finish(t);
        else if(s.stage===2&&t.speed<1&&d<145){s.failed=true;s.reason='You stopped before the box. Carry a little more speed to the line.';}
        break;
      }
      case'slalom':{
        const g=GATES[s.gate];
        if(g&&this.lastZ<g.z&&t.z>=g.z){
          if(Math.abs(t.x-g.x)<=3.0){s.gate++;s.progress=s.gate/GATES.length;}
          else{s.failed=true;s.reason=`Gate ${s.gate+1} missed. Aim between its two green posts.`;}
        }
        s.hint=`Pass gate ${Math.min(s.gate+1,5)} of 5. Stay near 40–60 km/h and look ahead.`;
        if(s.gate===GATES.length)this.finish(t);break;
      }
      case'impulse':if(t.armed&&s.stage===0)s.stage=1;if(s.stage===1&&s.impulse>=12000)s.stage=2;if(s.stage===2&&t.speed<1&&t.thrust===0&&braking)this.finish(t);break;
      case'hover':
        if(t.flying)s.stage=Math.max(s.stage,1);
        if(s.stage===1&&t.altitude>1.5&&t.altitude<3.5&&Math.abs(t.verticalSpeed)<1)s.hoverTime+=dt;
        if(s.hoverTime>=1)s.stage=2;
        if(s.stage===2&&!t.flying&&t.contact>=3&&t.altitude<.2&&t.speed<5)this.finish(t);
        break;
      case'translation':
        if(t.flying){s.stage=Math.max(s.stage,1);this.armedSeen=true;}
        if(s.stage===1&&t.altitude>.7&&t.z-this.lesson.spawn.z>=1.5)s.stage=2;
        if(s.stage===2&&!t.flying&&t.contact>=3&&t.speed<7)this.finish(t);break;
      case'manual':
        if(t.flying&&s.stage===0){s.stage=1;this.manualHeading=t.heading;}
        if(s.stage===1&&!t.assist){this.usedManual=true;if(Math.abs(t.heading-this.manualHeading)>.04)s.stage=2;}
        if(s.stage===2&&this.usedManual&&t.assist)this.restored=true;
        if(s.stage===2&&this.restored&&!t.flying&&t.contact>=3&&t.speed<7)this.finish(t);break;
    }
    if(s.complete)return;
    if(t.flying&&t.pressure<40&&!s.complete){s.failed=true;s.reason='The useful gas reserve is exhausted. Use a shorter maneuver and command landing sooner.';}
    if(id!=='slalom'){s.progress=s.complete?1:s.stage/this.lesson.steps.length;s.hint=this.lesson.steps[Math.min(s.stage,this.lesson.steps.length-1)]!;}
    this.lastZ=t.z;
  }
  private finish(t:Telemetry){const s=this.state;s.complete=true;s.progress=1;s.hint='Lesson complete. Review your run or continue to the next lesson.';s.score=Math.round(Math.max(30,100-t.damage*.65-Math.max(0,s.time-40)*.15));}
}
