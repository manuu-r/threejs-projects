import './styles.css';
import { Simulator } from './Runtime.ts';
import { LESSONS, GATES, type Lesson } from './lessons.ts';
import { variantNames, SIM } from './config.ts';
import { markdown } from './markdown.ts';
import type { Action } from './Input.ts';
import type { LessonId, Telemetry, Variant } from './types.ts';

const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`
 <main class="sim-shell" id="shell">
  <div class="scene-wrap"><canvas id="scene" tabindex="0" aria-label="Prototype driving simulation. Use W and S for pedals, A and D to steer. Open Controls for flight commands."></canvas></div>
  <div class="film-grain" aria-hidden="true"></div>
  <header class="topbar">
   <a class="wordmark" href="./" aria-label="Cockpit home">COCKPIT<span>COCKPIT / 01</span></a>
   <div class="top-status"><i></i><span id="session-status">DESERT PROVING GROUND</span></div>
   <nav aria-label="Simulator navigation"><button data-nav="academy" class="nav-link">Lessons</button><button data-nav="research" class="nav-link">About</button><button data-nav="controls" class="nav-link">Help</button><button data-nav="settings" class="nav-link" aria-label="Open simulator settings">Settings</button></nav>
  </header>
  <section class="welcome" id="welcome" aria-label="Flight academy">
   <div class="welcome-copy"><div class="eyebrow">THE PROTOTYPE / FROM THE DRIVER’S SEAT</div>
    <h1>Step inside.</h1>
    <p class="intro">A low seat. A quiet cabin. A very different kind of acceleration.</p>
    <div class="welcome-keys"><span><kbd>W S</kbd> Drive & brake</span><span><kbd>A D</kbd> Steer</span><span><kbd>Space</kbd> Thrust</span></div>
    <div class="intro-actions"><button class="primary" id="begin">Start driving <span>↗</span></button><button class="text-button" id="demo">Take a cockpit ride <span>↗</span></button></div>
    <p class="input-note">Assisted controls · Drag to look around<br><span>Independent concept simulation · Headphones recommended</span></p>
   </div>
   <div class="curriculum"><div class="curriculum-title"><span>THE FLIGHT PATH</span><span id="completed-count">00 / 07</span></div>
    <div id="lesson-list"></div>
    <button class="free-practice" id="sandbox"><span>∞</span><div>Just drive<small>Simple controls. Your pace.</small></div><span>↗</span></button>
   </div>
   <div class="welcome-bottom"><span>32° 00′ N / 106° 25′ W<br>FICTIONAL CLOSED TEST FACILITY</span><p>Independent educational concept.<br>Original, unbadged vehicle reconstruction.<br>Vehicle behavior is an illustrative simulation.</p><a href="./notes.md" target="_blank" rel="noopener">Read the simulation notes ↗</a></div>
  </section>
  <section class="driving-ui" id="driving-ui" hidden aria-label="Session instruments">
   <aside class="coach" id="coach"><div class="coach-heading"><span id="lesson-number">01 / COCKPIT & CONTROL</span><button id="brief-open" title="Read lesson briefing" aria-label="Read lesson briefing">↗</button></div>
    <h2 id="coach-title">Find your feet.</h2><div class="progress-track"><div id="lesson-progress"></div></div>
    <p id="coach-hint" role="status" aria-live="polite">Accelerate beyond 30 km/h.</p><div class="coach-bottom"><span id="session-clock">00:00</span><button id="reset" class="quiet-button"><kbd>R</kbd> Reset</button></div>
   </aside>
   <aside class="live-instruments"><div class="speed"><span id="speed-value">0</span><small>KM/H</small></div><div class="metric-row"><div><small>ALTITUDE</small><strong><span id="altitude">0.0</span><em>m</em></strong></div><div><small>PRESSURE</small><strong><span id="pressure">300</span><em>bar</em></strong></div></div>
    <div class="reserve-track"><span id="reserve-bar"></span></div><p><span id="reserve-value">91.8</span> kN·s usable impulse</p>
    <div class="micro-telemetry"><span id="g-value">0.00 g</span><span id="contact-value">4 / 4 CONTACT</span></div>
    <canvas id="minimap" width="210" height="150" aria-label="Proving ground position map"></canvas>
   </aside>
   <div class="system-controls" aria-label="Vehicle systems"><label class="variant-select"><span>CONFIGURATION</span><select id="variant" aria-label="Vehicle configuration"><option value="performance">Road</option><option value="thrust">Boost</option><option value="rocket">Flight</option></select></label>
    <button id="gear" data-action="gear"><kbd>G</kbd><span id="gear-label">Drive · D</span></button>
    <button id="arm" data-action="arm"><kbd>F</kbd><span id="arm-label">Gas safed</span><i id="arm-dot"></i></button>
    <button id="hover" data-action="hover"><kbd>H</kbd><span id="hover-label">Engage hover</span></button>
    <button id="assist" data-action="assist"><kbd>L</kbd><span id="assist-label">Assist on</span></button>
    <button id="fan" data-action="fan"><kbd>B</kbd><span id="fan-label">Suction on</span></button>
    <button data-action="camera"><kbd>C</kbd><span id="camera-label">Cockpit</span></button><button id="pause-button" aria-label="Pause session">Ⅱ</button>
   </div>
   <div class="experience-coach"><span id="experience-state">YOU’RE IN THE DRIVER’S SEAT</span><p id="experience-hint" aria-live="polite">Hold W to pull away. S brakes. A and D steer.</p></div>
   <div class="experience-controls" aria-label="Simple cockpit controls">
    <span class="easy-drive-keys"><kbd>W S</kbd> Drive / brake <kbd>A D</kbd> Steer</span>
    <button data-hold="Space" class="easy-thrust" aria-label="Hold for rear thrust"><kbd>Space</kbd> Thrust <small>hold</small></button>
    <button id="easy-hover" data-action="hover"><kbd>H</kbd><span id="easy-hover-label">Lift</span></button>
    <button data-action="camera"><kbd>C</kbd> View</button><button id="easy-pause" aria-label="Pause drive">Ⅱ</button>
   </div>
   <div class="touch-controls" aria-label="Touch driving controls"><div class="touch-steer"><button data-hold="KeyA" aria-label="Steer left">←</button><button data-hold="KeyD" aria-label="Steer right">→</button></div><div class="touch-flight"><button data-hold="KeyZ" aria-label="Yaw left">Z ↶</button><button data-hold="KeyX" aria-label="Yaw right">X ↷</button><button data-hold="KeyQ" aria-label="Lower collective or altitude">Q ↓</button><button data-hold="KeyE" aria-label="Raise collective or altitude">E ↑</button><button data-hold="Space" aria-label="Hold rear thrusters">THRUST</button></div><div class="touch-pedals"><button data-hold="KeyS" aria-label="Hold brake or lean backward">BRAKE</button><button data-hold="KeyW" aria-label="Hold accelerator or lean forward">DRIVE</button></div></div>
   <footer class="drive-footer"><span id="mode-status">GROUND / ROAD</span><span id="drive-tip">W S Pedals <b>·</b> A D Steer <b>·</b> Drag to look <b>·</b> V Recenter</span><span id="physics-status">120 Hz PHYSICS</span></footer>
  </section>
  <div class="loading-screen" id="loading"><span class="loading-mark">01 /</span><p id="loading-message">Preparing the proving ground</p><div><span></span></div><small>LOADING ORIGINAL COCKPIT & PHYSICS</small></div>
  <div class="panel-backdrop" id="panel" hidden><section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><div class="panel-header"><span id="panel-kicker">FLIGHT ACADEMY</span><button id="close-panel" aria-label="Close panel">×</button></div><div id="panel-content"></div></section></div>
  <div class="result-backdrop" id="result" hidden><section class="result-card" role="dialog" aria-modal="true" aria-labelledby="result-title"><div class="eyebrow" id="result-kicker">LESSON COMPLETE</div><h2 id="result-title">A good first flight.</h2><p id="result-copy"></p><div id="result-stats" class="result-stats"></div><canvas id="run-chart" width="840" height="200" aria-label="Speed and pressure during the run"></canvas><div class="chart-key"><span>— Speed</span><span>— Gas pressure</span></div><div class="result-actions"><button class="primary" id="next-lesson">Next lesson ↗</button><button class="secondary" id="retry">Try again</button></div><button id="export" class="text-button">Download flight telemetry (.csv) ↓</button><button id="result-academy" class="text-button">Return to academy</button></section></div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
 </main>`;
const $=<E extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as E;
let game:Simulator;let selected:LessonId='orientation';let hasSession=false;let panelWasRunning=false;let panelName='';let toastTimer=0;let lastHint='';let reportCache='';
let best:Record<string,number>={};try{best=JSON.parse(localStorage.getItem('roadster-lab-progress-v1')??'{}');}catch{/* Private browsing still works without persistence. */}
function renderLessons(){
 $('lesson-list').innerHTML=LESSONS.filter(l=>l.id!=='sandbox').map(l=>`<button class="lesson-row ${selected===l.id?'selected':''}" data-lesson="${l.id}"><span class="lesson-index">${best[l.id]?'✓':l.number}</span><div><strong>${l.subtitle}</strong><small>${l.duration} / ${variantNames[l.variant]}</small></div><span class="lesson-arrow">↗</span></button>`).join('');
 const count=Object.keys(best).filter(k=>k!=='sandbox').length;$('completed-count').textContent=String(count).padStart(2,'0')+' / 07';
 for(const el of document.querySelectorAll<HTMLButtonElement>('[data-lesson]'))el.onclick=()=>{selected=el.dataset.lesson as LessonId;renderLessons();showBrief(selected);};
}
function notice(s:string){$('toast').textContent=s;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>$('toast').classList.remove('visible'),4200);}
function closePanel(resume=true){$('panel').hidden=true;panelName='';if(resume&&panelWasRunning){game.resume();$('shell').classList.add('session-running');}panelWasRunning=false;if(resume&&hasSession&&!$('driving-ui').hidden&&!game.running&&(game.lessons.state.complete||game.lessons.state.failed))$('result').hidden=false;game?.canvas.focus({preventScroll:true});}
function panel(title:string,kicker:string,body:string,name:string){
 if(!$('panel').hidden){/* Retain the state from the original panel entry. */}else panelWasRunning=!!game?.running;
 game?.pause();$('shell').classList.remove('session-running');$('panel-title')?.removeAttribute('id');
 $('panel-kicker').textContent=kicker;$('panel-content').innerHTML=`<h2 id="panel-title">${title}</h2>${body}`;$('panel').hidden=false;panelName=name;$('close-panel').focus();
}
function showBrief(id:LessonId){
 selected=id;$('result').hidden=true;const l=LESSONS.find(l=>l.id===id)!;
 panel(l.title,`${l.number} / ${l.subtitle.toUpperCase()}`,`<p class="panel-lead">${l.description}</p><div class="brief-meta"><span>${variantNames[l.variant]}</span><span>${l.duration}</span><span>${best[id]?`BEST ${best[id]}/100`:'NEW EXERCISE'}</span></div><h3>What you’ll learn</h3><p>${l.theory}</p><h3>Your objectives</h3><ol class="objectives">${l.steps.map(s=>`<li>${s}</li>`).join('')}</ol><h3>Keep these close</h3><div class="key-list">${l.keys.map(([k,v])=>`<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div><button class="primary panel-start" id="start-lesson">Start exercise <span>↗</span></button><p class="small-note">This is an independent teaching model. Control mappings and numerical parameters are assumptions, not real vehicle operating instructions.</p>`,'brief');
 $('start-lesson').onclick=()=>start(id);
}
function enterSession(){
 closePanel(false);$('result').hidden=true;$('welcome').hidden=true;$('driving-ui').hidden=false;$('shell').classList.add('session-running');$('shell').classList.remove('lessons-open');hasSession=true;
}
function start(id:LessonId,variant?:Variant){
 if(!game?.ready){notice('The cockpit is still loading.');return;}
 selected=id;enterSession();$('shell').classList.remove('experience');game.start(id,variant);
 ($('variant')as HTMLSelectElement).value=game.physics.variant;renderLessons();game.canvas.focus({preventScroll:true});
}
function drive(ride=false){
 if(!game?.ready){notice('The cockpit is still loading.');return;}
 selected='sandbox';enterSession();$('shell').classList.add('experience');
 if(ride)game.startDemo(true);else game.startExperience();
 ($('variant')as HTMLSelectElement).value=game.physics.variant;updateHud(game.physics.telemetry());game.canvas.focus({preventScroll:true});
}
function academy(showLessons=true){if(game)game.pause();$('panel').hidden=true;$('result').hidden=true;$('welcome').hidden=false;$('driving-ui').hidden=true;$('shell').classList.remove('session-running');$('shell').classList.toggle('lessons-open',showLessons);renderLessons();}
function pausePanel(){
 if(!$('panel').hidden){closePanel();return;}
 if(!hasSession)return;
 panel('Take a breath.','SESSION PAUSED',`<p class="panel-lead">Your vehicle and gas reserve are held while you’re here.</p><button class="primary panel-start" id="resume">Return to the cockpit ↗</button><div class="pause-actions"><button class="secondary" id="pause-reset">Restart exercise</button><button class="secondary" id="pause-academy">Choose another lesson</button><button class="secondary" id="pause-export">Export current telemetry</button></div><h3>Current session</h3><p>${game.lessons.lesson.subtitle} · ${variantNames[game.physics.variant]} · ${game.physics.elapsed.toFixed(1)} seconds</p>`,'pause');
 panelWasRunning=true;
 $('resume').onclick=()=>{closePanel(false);game.resume();$('shell').classList.add('session-running');};$('pause-reset').onclick=()=>game.experience?drive():start(game.lessons.lesson.id,game.physics.variant);$('pause-academy').onclick=()=>academy();$('pause-export').onclick=exportCsv;
}
function showControls(){
 if(hasSession&&!game.experience){showAdvancedControls();return;}
 panel('A few controls. The whole experience.','DRIVER’S GUIDE',`<p class="panel-lead">Start driving and use the dashboard to see your speed. Steering, braking and thrust respond to the vehicle’s simulated weight and grip.</p>${keys([['W / ↑','Accelerate'],['S / ↓','Brake'],['A D / ← →','Steer'],['Space','Hold for rear thrust on the ground'],['H','Brief assisted lift / land sooner'],['Drag','Look around the cabin'],['C','Change view; drag outside to orbit'],['R','Start fresh with full reserve'],['Esc','Pause']])}<p>For a lift, slow below 20 km/h and press H. Height and balance are assisted, then the car lands automatically. W/S moves forward/back and A/D turns while airborne. Thrust uses a finite gas reserve.</p><button class="secondary panel-start" id="advanced-help">Detailed simulation controls ↗</button><p class="small-note">These are simplified experience controls, not real vehicle operating instructions.</p>`,'controls');
 $('advanced-help').onclick=showAdvancedControls;
}
function showAdvancedControls(){
 panel('Every input. One place.','CONTROL REFERENCE',`<p class="panel-lead">Start with the ground controls. Flight commands are conceptual mappings for this simulator.</p><h3>On the ground</h3>${keys([['W / ↑','Accelerator'],['S / ↓','Service brake'],['A D / ← →','Steering yoke'],['G','Cycle D → N → R while stopped'],['B','Toggle suction downforce']])}<h3>Gas propulsion</h3>${keys([['F','Arm / safe gas system'],['Space','Hold rear thrusters (Boost / Flight)'],['H','Engage hover / command landing (Flight)']])}<p>Rear thrust is inhibited while braking or in reverse. Hover requires an armed flight model, enough reserve, and speed below 20 km/h. Land before disarming.</p><h3>In assisted flight</h3>${keys([['W / S','Lean forward / backward'],['A / D','Lean left / right'],['Z / X','Yaw left / right'],['E / Q','Raise / lower altitude target'],['H','Automatic descent to touchdown']])}<h3>In manual flight</h3>${keys([['L','Toggle stabilization'],['W S / I K','Pitch down / up'],['A / D','Roll left / right'],['Z / X','Yaw left / right'],['E / Q','Increase / decrease collective']])}<p>Neutral collective supplies approximately weight at full gas authority; it does not hold height. Angular momentum persists. Restoring assist captures current height. Control torque and lift both consume gas.</p><h3>Camera & session</h3>${keys([['Drag the view','Look from the seat / orbit in chase view'],['V','Recenter your view'],['C','Cockpit → chase → hood'],['R','Reset position, repair & refill'],['P / Esc','Pause'],['Settings','Quality, FOV, motion, wind & wet surface']])}<h3>Standard gamepad</h3><p>Left stick: steering / roll. Right stick horizontal: yaw. Left stick vertical: manual pitch. RT: accelerator; LT: brake. A: rear thrust; B: arm; X: camera; Y: hover. LB/RB: lower/raise lift. Left stick click: assist. Menu: pause; View: reset. A standard-mapped controller is expected.</p><h3>Touch</h3><p>Use the on-screen pedals, steering buttons and gas controls. Drag an empty part of the windshield to look. A keyboard or gamepad offers finer control for manual flight.</p><p class="small-note">No camera, microphone, location or motion-sensor access is used.</p>`,'controls');
 if(game.experience){const b=document.createElement('button');b.className='secondary panel-start';b.textContent='Choose a lesson with full controls ↗';b.onclick=()=>academy();$('panel-content').append(b);}
}
function keys(items:[string,string][]){return `<div class="key-list">${items.map(([k,v])=>`<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>`;}
async function showResearch(){
 panel('The engineering behind the impulse.','SIMULATION NOTES',`<p class="panel-lead">How the driving model, cold-gas propulsion and flight assistance work.</p><a class="download-link" href="./notes.md" download="Prototype-Simulation-Notes.md">Save the simulation notes ↓</a><div id="research-body" class="research-body"><p>Loading the research report…</p></div>`,'research');
 try{if(!reportCache){const r=await fetch('./notes.md');if(!r.ok)throw new Error('Research document unavailable');reportCache=await r.text();}if(panelName==='research')$('research-body').innerHTML=markdown(reportCache);}catch{if(panelName==='research')$('research-body').innerHTML='<p>The notes could not be loaded. Open the saved project documentation.</p>';}
}
function showSettings(){
 const p=game.physics,c=game.cockpit;
 panel('Set up your session.','SIMULATOR SETTINGS',`<div class="settings-grid"><label>Field of view <output id="fov-output">${c.fov}°</output><input id="fov" type="range" min="55" max="95" value="${c.fov}"></label><label>Camera motion <output id="motion-output">${Math.round(c.motion*100)}%</output><input id="motion" type="range" min="0" max="100" value="${c.motion*100}"></label><label>Audio volume <output id="volume-output">${Math.round(game.audio.volume*100)}%</output><input id="volume" type="range" min="0" max="70" value="${game.audio.volume*100}"></label><label>Crosswind <output id="wind-output">${p.wind.toFixed(0)} m/s</output><input id="wind" type="range" min="-12" max="12" value="${p.wind}"></label><label class="select-setting">Render quality<select id="quality"><option value="high">High · detailed shadows</option><option value="medium" selected>Balanced</option><option value="low">Light · reduced resolution</option></select></label><label class="select-setting">Training speed<select id="time-scale"><option value="1" ${game.timeScale===1?'selected':''}>Real time · 1×</option><option value="0.5" ${game.timeScale===.5?'selected':''}>Practice · ½×</option></select></label><label class="switch-setting">Wet surface <input type="checkbox" id="wet" ${p.wet?'checked':''}><span>Lower grip and a reflective runway</span></label><label class="switch-setting">Sound <input type="checkbox" id="sound" ${game.audio.enabled?'checked':''}><span>EV harmonics, fan, road and gas hiss</span></label><label class="switch-setting">Touch controls <input type="checkbox" id="touch" ${$('shell').classList.contains('force-touch')?'checked':''}><span>Always show the on-screen controls</span></label><label class="switch-setting">Minimal instruments <input type="checkbox" id="minimal" ${$('shell').classList.contains('minimal')?'checked':''}><span>Use the cockpit displays for telemetry</span></label></div><h3>Physics model</h3><p>Rigid body and four raycast suspension wheels; 120 fixed steps per second. Finite gas reservoir, changing mass, adiabatic blowdown, pressure-limited thrust, aerodynamic drag, suction downforce and combined tire-force limits.</p><div class="model-specs"><span>Initial mass<strong>1,800 kg</strong></span><span>Rear thrust<strong>22 kN</strong></span><span>Lift ceiling<strong>33 kN</strong></span><span>Initial gas<strong>180 kg</strong></span><span>Usable impulse<strong>91.8 kN·s</strong></span><span>Cutoff<strong>35 bar</strong></span></div><p class="small-note">All numerical values are educational assumptions. Tire dynamics and gas thermodynamics are simplified. No vehicle test calibration, structural analysis or certification is implied.</p>`,'settings');
 const range=(id:string,cb:(v:number)=>void)=>{$<HTMLInputElement>(id).oninput=e=>cb(Number((e.target as HTMLInputElement).value));};
 range('fov',v=>{c.fov=v;$('fov-output').textContent=v+'°';});range('motion',v=>{c.motion=v/100;$('motion-output').textContent=v+'%';});range('volume',v=>{game.audio.volume=v/100;$('volume-output').textContent=v+'%';});range('wind',v=>{p.wind=v;$('wind-output').textContent=v+' m/s';});
 $<HTMLSelectElement>('quality').onchange=e=>{const v=(e.target as HTMLSelectElement).value;game.renderer.setPixelRatio(Math.min(devicePixelRatio,v==='high'?2:v==='medium'?1.6:1));game.renderer.shadowMap.enabled=v!=='low';};
 $<HTMLSelectElement>('time-scale').onchange=e=>{game.timeScale=Number((e.target as HTMLSelectElement).value);};
 for(const [id,fn] of Object.entries({wet:(v:boolean)=>p.wet=v,sound:(v:boolean)=>game.audio.enabled=v,touch:(v:boolean)=>$('shell').classList.toggle('force-touch',v),minimal:(v:boolean)=>$('shell').classList.toggle('minimal',v)}))$<HTMLInputElement>(id).onchange=e=>fn((e.target as HTMLInputElement).checked);
}
function exportCsv(){if(!game.records.length){notice('Run an exercise to record telemetry first.');return;}const blob=new Blob([game.csv()],{type:'text/csv;charset=utf-8;'});const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=`prototype-${game.lessons.lesson.id}-${new Date().toISOString().slice(0,19).replaceAll(':','-')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
function showOutcome(){
 const s=game.lessons.state,t=game.physics.telemetry();$('shell').classList.remove('session-running');
 if(s.complete){best[game.lessons.lesson.id]=Math.max(best[game.lessons.lesson.id]??0,s.score);try{localStorage.setItem('roadster-lab-progress-v1',JSON.stringify(best));}catch{}renderLessons();}
 $('result-kicker').textContent=s.complete?'LESSON COMPLETE':'DEBRIEF / TRY AGAIN';$('result-title').textContent=s.complete?'A little more pilot.':'Every run teaches you.';
 $('result-copy').textContent=s.complete?`${game.lessons.lesson.subtitle} completed. Smooth inputs and careful reserve management are the foundation of every maneuver.`:s.reason;
 $('result-stats').innerHTML=`<div><strong>${s.complete?s.score:'—'}<small>/100</small></strong><span>CONTROL SCORE</span></div><div><strong>${s.time.toFixed(1)}<small>s</small></strong><span>SESSION TIME</span></div><div><strong>${Math.round(s.peakSpeed)}<small>km/h</small></strong><span>PEAK SPEED</span></div><div><strong>${(SIM.gasMass-t.gas).toFixed(1)}<small>kg</small></strong><span>GAS USED</span></div>`;
 const idx=LESSONS.findIndex(l=>l.id===game.lessons.lesson.id),next=LESSONS[idx+1];$('next-lesson').textContent=s.complete&&next?'Next lesson ↗':'Retry exercise ↗';$('next-lesson').onclick=()=>s.complete&&next?showBrief(next.id):start(game.lessons.lesson.id);
 $('retry').onclick=()=>start(game.lessons.lesson.id);$('result').hidden=false;drawRunChart();$('next-lesson').focus();
}
function drawRunChart(){
 const canvas=$<HTMLCanvasElement>('run-chart'),ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,840,200);ctx.strokeStyle='#334039';ctx.lineWidth=1;
 for(let y=30;y<=170;y+=35){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(840,y);ctx.stroke();}
 const points=game.records;if(points.length<2)return;
 for(const [key,max,color]of [['speed',Math.max(120,...points.map(t=>t.speed)),'#d7e5b1'],['pressure',300,'#94bcc1']] as const){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();points.forEach((t,i)=>{const x=i/(points.length-1)*840,y=180-t[key]/max*155;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();}
}
const mapCtx=$<HTMLCanvasElement>('minimap').getContext('2d')!;
function drawMap(t:Telemetry){const c=mapCtx;c.clearRect(0,0,210,150);c.fillStyle='#111c18cc';c.fillRect(0,0,210,150);c.strokeStyle='#58654c';c.lineWidth=1;c.strokeRect(55,12,100,126);c.setLineDash([3,5]);c.beginPath();c.moveTo(105,12);c.lineTo(105,138);c.stroke();c.setLineDash([]);
 const origin=game.lessons.lesson.spawn.z;for(const [i,g]of GATES.entries()){const y=126-(g.z-origin)/300*105;if(y<10||y>140)continue;c.fillStyle=i<game.lessons.state.gate?'#51614d':'#9bb27e';c.fillRect(105-g.x*2-7,y,14,3);}
 const y=126-(t.z-origin)/300*105;c.save();c.translate(105-t.x*2,Math.max(8,Math.min(142,y)));c.rotate(-t.heading);c.fillStyle='#e2eacb';c.beginPath();c.moveTo(0,-5);c.lineTo(4,5);c.lineTo(-4,5);c.closePath();c.fill();c.restore();c.fillStyle='#aeb9a4';c.font='9px monospace';c.fillText('COURSE / 300 m',10,145);}
function updateHud(t:Telemetry){
 const easy=!!game.experience;$('shell').classList.toggle('experience',easy);
 if(easy){
  $('experience-state').textContent=game.demo?'SIT BACK / COCKPIT RIDE':t.flying?'ASSISTED LIFT':t.thrust>100?'THRUST ACTIVE':'PROTOTYPE / COCKPIT DRIVE';
  $('experience-hint').textContent=game.demo?.caption??game.experience!.hint(game.physics);
  $('easy-hover-label').textContent=t.flying?'Land':'Lift';($('easy-hover') as HTMLButtonElement).disabled=!!game.demo||(!t.flying&&t.reserve<game.physics.body.mass*SIM.gravity*1.5);
  const thrust=document.querySelector<HTMLButtonElement>('.easy-thrust')!;thrust.disabled=!!game.demo||t.flying||t.reserve<10;
 }
 $('session-status').textContent=game.demo?'PHYSICS DEMONSTRATION':game.running?'TRAINING SESSION ACTIVE':hasSession?'SESSION HELD':'DESERT PROVING GROUND';
 if(!hasSession)return;
 const l=game.lessons.lesson,s=game.lessons.state;
 $('speed-value').textContent=String(Math.round(t.speed));$('altitude').textContent=t.altitude.toFixed(1);$('pressure').textContent=t.pressure.toFixed(0);$('reserve-value').textContent=(t.reserve/1000).toFixed(1);$('reserve-bar').style.width=Math.max(0,t.reserve/91781*100)+'%';
 $('g-value').textContent=`${t.longitudinalG.toFixed(2)} g`;$('contact-value').textContent=`${t.contact} / 4 CONTACT`;
 $('lesson-number').textContent=game.demo?'DEMONSTRATION / LIVE PHYSICS':`${l.number} / ${l.subtitle.toUpperCase()}`;$('coach-title').textContent=game.demo?'Watch the forces.':l.title;
 const hint=game.demo?.caption??s.hint;if(hint!==lastHint){$('coach-hint').textContent=hint;lastHint=hint;}
 $('lesson-progress').style.width=`${s.progress*100}%`;const sec=Math.floor(s.time);$('session-clock').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
 $('gear-label').textContent=({D:'Drive · D',R:'Reverse · R',N:'Neutral · N'} as const)[t.gear];
 $('arm-label').textContent=t.armed?'Gas armed':'Gas safed';$('arm').classList.toggle('active',t.armed);$('arm-dot').classList.toggle('on',t.armed);
 $('hover-label').textContent=t.flying?'Command landing':'Engage hover';$('hover').classList.toggle('active',t.flying);($('hover')as HTMLButtonElement).disabled=t.variant!=='rocket';($('assist')as HTMLButtonElement).disabled=!t.flying;
 $('assist-label').textContent=t.assist?'Assist on':'Manual attitude';$('assist').classList.toggle('active',t.flying&&t.assist);$('fan-label').textContent=t.fan?'Suction on':'Suction off';$('fan').classList.toggle('active',t.fan&&!t.flying);
 $('camera-label').textContent=game.cockpit.view[0]!.toUpperCase()+game.cockpit.view.slice(1);
 $('mode-status').textContent=`${t.flying?(t.assist?'ASSISTED FLIGHT':'MANUAL FLIGHT'):'GROUND'} / ${variantNames[t.variant].toUpperCase()}`;
 $('drive-tip').textContent=game.cockpit.view==='chase'?'Drag to orbit · C Camera · V Recenter':t.flying?'W S Pitch · A D Roll · Z X Yaw · E Q Lift · H Land':'W S Pedals · A D Steer · Drag to look · V Recenter';
 $('physics-status').textContent=`120 Hz PHYSICS${game.timeScale<1?' / ½ SPEED':''}${game.input.gamepadConnected?' / GAMEPAD':''}`;
 $('shell').classList.toggle('low-reserve',t.pressure<75&&t.armed);drawMap(t);
}
// Native semantic buttons remain usable without pointer capture or pointer lock.
renderLessons();$('begin').onclick=()=>drive();$('sandbox').onclick=()=>drive();$('brief-open').onclick=()=>showBrief(game.lessons.lesson.id);
$('demo').onclick=()=>drive(true);
$('close-panel').onclick=()=>closePanel();$('panel').onclick=e=>{if(e.target===$('panel'))closePanel();};
$('reset').onclick=()=>{game.reset();$('result').hidden=true;$('shell').classList.add('session-running');};$('pause-button').onclick=()=>{game.pause();pausePanel();};
$('export').onclick=exportCsv;$('result-academy').onclick=()=>academy();
$('easy-pause').onclick=()=>{game.pause();pausePanel();};
for(const el of document.querySelectorAll<HTMLButtonElement>('[data-nav]'))el.onclick=()=>{const id=el.dataset.nav;if(id==='academy')academy();if(id==='research')void showResearch();if(id==='controls')showControls();if(id==='settings')showSettings();};
for(const el of document.querySelectorAll<HTMLButtonElement>('[data-action]'))el.onclick=()=>{game.action(el.dataset.action as Action);game.canvas.focus({preventScroll:true});};
for(const el of document.querySelectorAll<HTMLButtonElement>('[data-hold]')){el.onpointerdown=e=>{e.preventDefault();el.setPointerCapture(e.pointerId);game.input.hold(el.dataset.hold!,true);el.classList.add('held');};const up=()=>{game?.input.hold(el.dataset.hold!,false);el.classList.remove('held');};el.onpointerup=up;el.onpointercancel=up;el.onlostpointercapture=up;}
$<HTMLSelectElement>('variant').onchange=e=>{const variant=(e.target as HTMLSelectElement).value as Variant;start('sandbox',variant);notice(`${variantNames[variant]} selected. Free practice started with a full reservoir.`);};
// Trap focus inside open dialogs and let Escape close them without activating flight inputs.
document.addEventListener('keydown',e=>{
 if(e.code==='Escape'&&!$('panel').hidden){e.preventDefault();e.stopImmediatePropagation();closePanel();return;}
 const container=!$('panel').hidden?$('panel'):!$('result').hidden?$('result'):null;
 if(e.code==='Tab'&&container){const focusable=Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select,input'));const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
},true);
try{
 game=new Simulator($<HTMLCanvasElement>('scene'));if(matchMedia('(prefers-reduced-motion: reduce)').matches)game.cockpit.motion=0;
 game.onTick=updateHud;game.onNotice=notice;game.onPause=()=>{if($('result').hidden)pausePanel();};game.onOutcome=showOutcome;
 await game.load();$('loading').classList.add('loaded');setTimeout(()=>$('loading').hidden=true,700);
 updateHud(game.physics.telemetry());
 if(import.meta.env.DEV){
  void import('./devDiagnostics.ts').then(async diagnostics=>{
   const checks:Record<string,boolean>={academyRows:document.querySelectorAll('[data-lesson]').length===7};
   if(new URLSearchParams(location.search).has('selfcheck')){
    showControls();checks.controlsPanel=!!document.querySelector('.key-list');closePanel(false);
    showSettings();checks.settingsPanel=!!$('fov')&&!!$('wet')&&!!$('quality');closePanel(false);
    await showResearch();checks.researchPanel=($('research-body')?.textContent?.length??0)>4000;closePanel(false);
    showBrief('orientation');checks.lessonBrief=!!$('start-lesson');start('orientation');
    checks.sessionStarts=game.running&&game.input.active&&!$('driving-ui').hidden;
    game.action('gear');checks.neutralSelection=game.physics.gear==='N';game.action('gear');game.action('gear');
    game.action('camera');checks.chaseSelection=game.cockpit.view==='chase';game.action('camera');game.action('camera');
    updateHud(game.physics.telemetry());checks.liveInstruments=$('speed-value').textContent!==''&&$('coach-title').textContent==='Find your feet.';
    game.pause();checks.pauseClearsInput=!game.input.active&&!game.running;
    game.resume();checks.resumeRestoresInput=game.input.active&&game.running;game.pause();
    game.physics.setVariant('rocket');updateHud(game.physics.telemetry());
    checks.rocketControls=!($('hover') as HTMLButtonElement).disabled;
    drive();game.pause();updateHud(game.physics.telemetry());
    checks.oneClickExperience=!!game.experience&&game.physics.armed&&game.physics.assist&&game.physics.variant==='rocket';
    checks.simpleControlRail=getComputedStyle(document.querySelector('.system-controls')!).display==='none'&&getComputedStyle(document.querySelector('.experience-controls')!).display==='flex';
    checks.cockpitFocus=getComputedStyle($('coach')).display==='none'&&getComputedStyle(document.querySelector('.live-instruments')!).display==='none';
    game.reset();game.pause();checks.experienceReset=!!game.experience&&game.physics.armed&&game.physics.gas.mass===SIM.gasMass;
    checks.unbrandedInterface=!/tesla|spacex|roadster/i.test(document.body.innerText);
    updateHud(game.physics.telemetry());game.cockpit.view='cockpit';$('toast').classList.remove('visible');
   }
   await diagnostics.reportStartup(game,checks);
   if(new URLSearchParams(location.search).has('selfcheck')){game.physics.setVariant('performance');academy(false);}
  }).catch(error=>console.warn('Local diagnostics unavailable',error));
 }
}catch(error){if(import.meta.env.DEV)void import('./devDiagnostics.ts').then(d=>d.reportFailure(error));console.error(error);$('loading-message').textContent='The simulator could not start.';$('loading').classList.add('error');const detail=document.createElement('p');detail.className='load-error';detail.textContent=error instanceof Error?error.message:'WebGL is unavailable. Use a browser with hardware graphics enabled.';$('loading').append(detail);}
