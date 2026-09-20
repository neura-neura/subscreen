const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const root='C:\\Users\\neura\\repos\\subscreen\\.test-artifacts\\';
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
 try {
 const p=browser.contexts()[0].pages()[0];
 await p.evaluate(()=>{localStorage.setItem('subscreen:locale','en');localStorage.removeItem('subscreen:subtitle-style');});
 await p.reload();
 await p.waitForFunction(()=>window.__TAURI_INTERNALS__);
 await p.evaluate(async()=>{window.logs=[];await window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'app-log',target:{kind:'Any'},handler:window.__TAURI_INTERNALS__.transformCallback(e=>window.logs.push(e.payload))});});
 for(const [file,expected] of [['brief/name.mp4','晓伟'],['brief/question.mp4','怎么说'],['brief/short.mp4','你好，世界！今天是美好的一天。']]){
  const start=Date.now();
  const cues=await p.evaluate(videoPath=>window.__TAURI_INTERNALS__.invoke('analyze_subtitles',{videoPath,region:{x:0,y:75,width:100,height:25},language:'auto'}),root+file);
  console.log(file,JSON.stringify(cues),'seconds',(Date.now()-start)/1000);
  assert(cues.some(c=>c.text===expected),expected);
  assert(cues.every(c=>!c.text.startsWith('图示为')));
  if(file.includes('short')){assert.equal(cues.length,1);assert.equal(cues[0].startMs,292);assert.equal(cues[0].endMs,417);}
  if(file.includes('name'))assert.equal(cues.at(-1).endMs,5000);
 }
 console.log('LOGS',await p.evaluate(()=>window.logs));
 await p.evaluate(path=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'tauri://drag-drop',payload:{paths:[path],position:{x:0,y:0}}}),root+'subtitle-test.mp4');
 await p.waitForFunction(()=>document.querySelector('button[aria-label="Play"]')?.disabled===false);
 await p.waitForFunction(async()=>await window.__TAURI_INTERNALS__.invoke('plugin:libmpv|get_property',{name:'duration',format:'double',windowLabel:'main'})>8);
 await p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'analysis-partial',payload:[{startMs:500,endMs:1000,text:'One'},{startMs:2000,endMs:3000,text:'Two'},{startMs:4000,endMs:5000,text:'Three'}]}));
 await p.locator('textarea').first().waitFor();
 await p.evaluate(()=>document.activeElement?.blur());
 const pos=()=>p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:libmpv|get_property',{name:'time-pos',format:'double',windowLabel:'main'}));
 await p.keyboard.press('ArrowRight');await p.waitForTimeout(150);assert(Math.abs(await pos()-.5)<.05);
 await p.keyboard.press('ArrowRight');await p.waitForTimeout(150);assert(Math.abs(await pos()-2)<.05);
 await p.keyboard.press('ArrowLeft');await p.waitForTimeout(150);assert(Math.abs(await pos()-.5)<.05);
 await p.keyboard.press('Space');await p.getByRole('button',{name:'Pause',exact:true}).waitFor();
 await p.keyboard.press('Space');await p.getByRole('button',{name:'Play',exact:true}).waitFor();
 await p.locator('textarea').first().focus();const before=await pos();await p.keyboard.press('ArrowRight');assert(Math.abs(await pos()-before)<.05);
 console.log('Keyboard navigation, playback, editor focus: PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
