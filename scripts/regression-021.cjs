const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
try {
const p=browser.contexts()[0].pages()[0];
await p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'tauri://drag-drop',payload:{paths:['C:\\Users\\neura\\repos\\subscreen\\.test-artifacts\\wide-test.mp4'],position:{x:0,y:0}}}));
await p.waitForFunction(()=>document.querySelector('button[aria-label="Play"]')?.disabled===false);
await p.getByRole('button',{name:'Select area',exact:true}).click();
const r=await p.locator('.video-stage').boundingBox();
await p.mouse.move(r.x+8,r.y+r.height*.75);await p.mouse.down();await p.mouse.move(r.x+r.width-8,r.y+r.height-8,{steps:5});await p.mouse.up();
assert.equal(await p.locator('[data-resize]').count(),8);
for(const edge of ['n','s','e','w','nw','ne','sw','se']){
 const h=p.locator(`[data-resize="${edge}"]`);const box=await h.boundingBox();const before=await h.evaluate(e=>e.parentElement.getAttribute('style'));
 const x=box.x+box.width/2,y=box.y+box.height/2;
 await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+(edge.includes('w')?4:edge.includes('e')?-4:0),y+(edge.includes('n')?4:edge.includes('s')?-4:0),{steps:3});await p.mouse.up();
 assert.notEqual(await h.evaluate(e=>e.parentElement.getAttribute('style')),before,edge);
}
await p.getByRole('button',{name:'Done',exact:true}).click();assert.equal(await p.locator('[data-resize]').count(),0);
await p.getByRole('button',{name:'Change area',exact:true}).click();assert.equal(await p.locator('[data-resize]').count(),8);
await p.getByRole('button',{name:'Done',exact:true}).click();
console.log('Eight resize handles, hide/show: PASS');
const start=Date.now();
const result=await p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('analyze_subtitles',{videoPath:'C:\\Users\\neura\\repos\\subscreen\\.test-artifacts\\wide-test.mp4',region:{x:0,y:75,width:100,height:25},language:'auto'}));
console.log(JSON.stringify(result));
assert(result.length>5);assert(result.every(c=>c.text.length<200));
assert(result.length<40,'Background hallucinations must not become subtitles');
assert(result.every(c=>!/[a-z]/i.test(c.text)),'This Chinese dialogue segment has no English captions');
for(const text of ['我现在身上半毛钱没有','而且负债四五百万']) {
 const cue=result.find(c=>c.text===text);assert(cue && cue.endMs-cue.startMs>1000,'Preserve complete interval: '+text);
}
console.log('Full-width bottom 25%, 50-second original video segment: PASS',JSON.stringify(result), 'seconds',(Date.now()-start)/1000);
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
