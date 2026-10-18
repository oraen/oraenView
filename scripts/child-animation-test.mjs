import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

for (const file of ['public/js/child-training.js','xhs/app/js/child-training.js','mini/miniprogram/pages/child-training/index.js']) {
  let source=fs.readFileSync(file,'utf8');
  const mini=file.startsWith('mini');
  const sandbox={window:{ChildGamesCore:{}},require:()=>({}),Page:p=>sandbox.definition=p,performance:{now:()=>0},console};
  if (!mini) {
    source=source.replace(/^import .*;\r?\n/gm,'').replace('export class ','class ');
    const name=source.match(/class (\w+)/)[1];
    source+='\nthis.definition='+(file.startsWith('xhs')?'window.ChildToolTraining.'+name:name)+'.prototype;';
  }
  vm.runInNewContext(source,sandbox);
  test(file+': fireflies keep moving throughout the response period',()=>{
    let draw;const times=[];
    const ctx={fillRect(){}};
    sandbox.document={querySelector:()=>({textContent:'',classList:{toggle(){}}})};
    const p={context:ctx,trial:{trackingCueMs:300,trackingDurationMs:1200},animateTrial:fn=>{draw=fn;},fireflyPositions:t=>{times.push(t);return [];},setData(){}};
    sandbox.definition.drawFireflyChase.call(p);
    draw(900);draw(1500);draw(6500);draw(60000);
    assert.deepEqual(times,[.9,1.5,6.5,60]);
    assert.equal(p.trackingHint,'现在点中它');
  });
  test(file+': tracking clicks stay blocked after cue, until prompt',()=>{
    let answers=0;
    const p=Object.assign({},sandbox.definition,{gameId:'firefly-chase',state:'awaiting-response',awaiting:true,trial:{responseType:'target',trackingCueMs:300,trackingDurationMs:1200},animationElapsed:301,displayWidth:480,displayHeight:480,canvas:{getBoundingClientRect:()=>({left:0,top:0,width:480,height:480})},hitRegions:[{index:0,x:240,y:240,radius:20}],answer:()=>answers++,handleAnswer:()=>answers++});
    const click=()=>sandbox.definition[mini?'tapCanvas':'answerCanvas'].call(p,{clientX:240,clientY:240,detail:{x:240,y:240}});
    click();assert.equal(answers,0);p.animationElapsed=1499;click();assert.equal(answers,0);p.animationElapsed=1500;click();assert.equal(answers,1);
  });
  test(file+': animation excludes pause time and stops stale frames',()=>{
    const callbacks=[];const frame=fn=>callbacks.push(fn);sandbox.requestAnimationFrame=frame;
    const p={runToken:1,trial:{id:'a'},animationElapsed:0,state:'awaiting-response',awaiting:true,data:{paused:false},canvas:{requestAnimationFrame:frame}};
    let draws=0;sandbox.definition.animateTrial.call(p,()=>draws++);
    const tick=n=>callbacks.shift()(n);
    tick(0);tick(40);assert.equal(p.animationElapsed,40);
    p.state='paused';p.awaiting=false;p.data.paused=true;tick(80);tick(5000);assert.equal(p.animationElapsed,40);
    p.state='awaiting-response';p.awaiting=true;p.data.paused=false;tick(5040);tick(5080);assert.equal(p.animationElapsed,80);
    const before=draws;p.trial={id:'b'};tick(5120);assert.equal(draws,before);assert.equal(callbacks.length,0);
  });
}
