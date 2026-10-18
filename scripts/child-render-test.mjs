import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome'});
try {
  for(const platform of ['public','xhs/app']) {
    const page=await browser.newPage({viewport:{width:1080,height:780}});
    await page.setContent('<div id="childTapHint"></div><div id="samples" style="display:flex;flex-wrap:wrap"></div>');
    await page.addScriptTag({content:fs.readFileSync(platform+'/js/child-games-core.js','utf8')});
    let source=fs.readFileSync(platform+'/js/child-training.js','utf8');
    if(platform==='public')source=source.replace(/^import .*;\r?\n/gm,'').replace('export class ','class ')+'\nwindow.TestController=ChildTrainingController;';
    else source+='\nwindow.TestController=window.ChildToolTraining.ChildTrainingController;';
    await page.addScriptTag({content:source});
    const counts=await page.evaluate(()=>{
      const core=window.ChildGamesCore, proto=window.TestController.prototype, result=[];
      const methods=['drawContrastStars','drawOrientationForest','drawCrowdingC','drawVernier','drawFusionRings','drawAnaglyphSearch','drawMotionRadar','drawContourTrail','drawShapeWorkshop','drawMemoryCards','drawFireflyChase','drawStereoOrbs'];
      core.GAME_ORDER.forEach((id,i)=>[1,16,30].forEach(level=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=480;const ctx=canvas.getContext('2d');
        const p=Object.assign(Object.create(proto),{context:ctx,canvas,trial:core.createTrial(id,level),gameId:id,hitRegions:[],glassesSettings:{redLensEye:'left'},state:'awaiting-response',animateTrial:fn=>fn(600)});
        ctx.fillStyle='#eef2f7';ctx.fillRect(0,0,480,480);p[methods[i]]();
        const pixels=ctx.getImageData(0,0,480,480).data;let changed=0;for(let j=0;j<pixels.length;j+=4)if(pixels[j]!==238||pixels[j+1]!==242||pixels[j+2]!==247)changed++;
        result.push({id,level,changed});
        if(id==='crowding-c'||id==='contour-trail'){const box=document.createElement('div');box.style.width='350px';box.textContent=core.GAMES[id].name+' '+level+'级';canvas.style.width=canvas.style.height='350px';box.appendChild(canvas);document.querySelector('#samples').appendChild(box);}
      }));return result;
    });
    assert.equal(counts.length,36);assert.ok(counts.every(x=>x.changed>0));
    fs.mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/child-difficulty-'+(platform==='public'?'web':'xhs')+'.png',fullPage:true});
    console.log('PASS',platform,'12 games at levels 1, 16, 30');await page.close();
  }
}finally{await browser.close();}
