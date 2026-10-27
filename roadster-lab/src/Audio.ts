import type { Telemetry } from './types.ts';
/** Synthesized EV harmonics, airflow and cold-gas hiss. No downloaded audio. */
export class SimAudio {
 private harmonic:OscillatorNode|undefined;private harmonicGain:GainNode|undefined;private windGain:GainNode|undefined;
 private ctx:AudioContext|undefined;private motor:OscillatorNode|undefined;private motorGain:GainNode|undefined;private hissGain:GainNode|undefined;private roadGain:GainNode|undefined;private fanGain:GainNode|undefined;private master:GainNode|undefined;
 enabled=true;volume=.35;
 async start(){
  if(this.ctx){await this.ctx.resume();return;}
  const ctx=new AudioContext();this.ctx=ctx;this.master=ctx.createGain();this.master.gain.value=this.volume;this.master.connect(ctx.destination);
  this.motor=ctx.createOscillator();this.motor.type='sine';this.motorGain=ctx.createGain();this.motorGain.gain.value=0;this.motor.connect(this.motorGain).connect(this.master);this.motor.start();
  this.harmonic=ctx.createOscillator();this.harmonic.type='triangle';this.harmonicGain=ctx.createGain();this.harmonicGain.gain.value=0;const cabin=ctx.createBiquadFilter();cabin.type='lowpass';cabin.frequency.value=1800;this.harmonic.connect(cabin).connect(this.harmonicGain).connect(this.master);this.harmonic.start();
  const n=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),d=n.getChannelData(0);let last=0;
  for(let i=0;i<d.length;i++){const white=Math.random()*2-1;last=(last+.02*white)/1.02;d[i]=last*3+white*.28;}
  const noise=ctx.createBufferSource();noise.buffer=n;noise.loop=true;
  const hiss=ctx.createBiquadFilter();hiss.type='highpass';hiss.frequency.value=1400;this.hissGain=ctx.createGain();this.hissGain.gain.value=0;noise.connect(hiss).connect(this.hissGain).connect(this.master);
  const road=ctx.createBiquadFilter();road.type='lowpass';road.frequency.value=360;this.roadGain=ctx.createGain();this.roadGain.gain.value=0;noise.connect(road).connect(this.roadGain).connect(this.master);
  const wind=ctx.createBiquadFilter();wind.type='bandpass';wind.frequency.value=1200;wind.Q.value=.5;this.windGain=ctx.createGain();this.windGain.gain.value=0;noise.connect(wind).connect(this.windGain).connect(this.master);
  const fan=ctx.createBiquadFilter();fan.type='bandpass';fan.frequency.value=100;fan.Q.value=1.4;this.fanGain=ctx.createGain();this.fanGain.gain.value=0;noise.connect(fan).connect(this.fanGain).connect(this.master);noise.start();
 }
 update(t:Telemetry,paused:boolean){if(!this.ctx||!this.master)return;const now=this.ctx.currentTime,active=this.enabled&&!paused?1:0;
  this.master.gain.setTargetAtTime(this.volume*active,now,.1);this.motor?.frequency.setTargetAtTime(75+t.speed*2.4,now,.08);
  this.motorGain?.gain.setTargetAtTime(Math.min(.065,t.speed*.00025),now,.1);
  this.harmonic?.frequency.setTargetAtTime(170+t.speed*4.1,now,.09);this.harmonicGain?.gain.setTargetAtTime(Math.min(.024,t.speed*.00011)*(1+Math.max(0,t.longitudinalG)*.3),now,.1);
  this.windGain?.gain.setTargetAtTime(Math.min(.20,t.speed*t.speed*.000003),now,.3);
  this.roadGain?.gain.setTargetAtTime(Math.min(.20,t.speed*.0007)+(t.slip>.15?.07:0),now,.1);
  this.hissGain?.gain.setTargetAtTime((t.thrust+t.liftThrust)/55000*.65,now,.04);
  this.fanGain?.gain.setTargetAtTime(t.fan&&!t.flying?.14:0,now,.2);
 }
 chime(success=true){if(!this.ctx||!this.master||!this.enabled)return;const ctx=this.ctx;for(let i=0;i<3;i++){const osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=(success?[523,659,784]:[220,196,165])[i]!;const start=ctx.currentTime+i*.11;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.12,start+.015);gain.gain.exponentialRampToValueAtTime(.001,start+.3);osc.connect(gain).connect(this.master);osc.start(start);osc.stop(start+.31);}}
 async dispose(){await this.ctx?.close();}
}
