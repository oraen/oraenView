import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome'});
try {
  const page=await browser.newPage();
  await page.addInitScript(()=>{
    const Native=window.AudioContext;
    window.playedBuffers=[];
    window.AudioContext=class extends Native {
      createBufferSource(){
        const source=super.createBufferSource(),start=source.start.bind(source);
        source.start=function(){window.playedBuffers.push({duration:source.buffer.duration,frames:source.buffer.length});return start();};
        return source;
      }
    };
  });
  await page.goto(new URL('../app/index.html',import.meta.url).href);
  await page.evaluate(()=>window.ToolFeedbackSound.play(true));
  await page.waitForFunction(()=>window.playedBuffers.length===1);
  await page.evaluate(()=>window.ToolFeedbackSound.play(false));
  await page.waitForFunction(()=>window.playedBuffers.length===2);
  const buffers=await page.evaluate(()=>window.playedBuffers);
  assert.ok(buffers.every(b=>b.duration>0&&b.duration<2));assert.notEqual(buffers[0].frames,buffers[1].frames);
  console.log('PASS both embedded sounds decode and start locally');
}finally{await browser.close();}
