const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').resolve('.test-artifacts');
const mode=process.argv[2]||'before';
(async()=>{const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');try{
 const p=browser.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));assert(p);
 const invoke=(cmd,args={})=>p.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
 if(mode==='before'){
  if(!fs.existsSync(root+'/prefs-030.json'))fs.writeFileSync(root+'/prefs-030.json',JSON.stringify(await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])))));
  await p.evaluate(()=>{localStorage.setItem('subscreen:locale','en');localStorage.setItem('subscreen:ocr-model','glm-ocr:latest');});await p.reload();
  const ai=p.getByTestId('ai-setup');await ai.getByText('Ollama connected · model ready',{exact:true}).waitFor();
  assert.equal(await ai.getByLabel('OCR model',{exact:true}).inputValue(),'glm-ocr:latest');
  const status=await invoke('ai_status',{model:'glm-ocr:latest'});assert(status.installed&&status.running&&status.ready);
  await invoke('setup_ollama');
  await ai.getByLabel('OCR model',{exact:true}).selectOption('qwen2.5:3b-instruct-q4_K_M');
  await ai.getByRole('alert').filter({hasText:'does not support image input'}).waitFor();
  assert.equal((await invoke('ai_status',{model:'qwen2.5:3b-instruct-q4_K_M'})).ready,false);
  await ai.getByLabel('OCR model',{exact:true}).selectOption('glm-ocr:subscreen-test');
  await ai.getByText('Ollama connected · model ready',{exact:true}).waitFor();
  assert.equal(await p.evaluate(()=>localStorage.getItem('subscreen:ocr-model')),'glm-ocr:subscreen-test');
  const cues=await invoke('analyze_subtitles',{videoPath:root+'\\brief\\short.mp4',region:{x:0,y:75,width:100,height:25},language:'auto',model:'glm-ocr:subscreen-test'});
  assert.equal(cues[0].text,'你好，世界！今天是美好的一天。');assert.equal(cues[0].startMs,292);assert.equal(cues[0].endMs,417);
  await invoke('plugin:event|emit',{event:'tauri://drag-drop',payload:{paths:[root+'\\subtitle-test.mp4'],position:{x:0,y:0}}});
  await p.waitForFunction(async()=>{try{return await window.__TAURI_INTERNALS__.invoke('plugin:libmpv|get_property',{name:'duration',format:'double',windowLabel:'main'})>8;}catch{return false;}});
  await p.locator('.subtitle-settings summary').click();
  await p.locator('.subtitle-settings select').selectOption('Georgia');
  await p.getByLabel('Color',{exact:true}).fill('#12abef');
  for(const [index,value] of [[0,38],[1,3],[2,14]]){const input=p.locator('.subtitle-settings input[type="range"]').nth(index);await input.evaluate((el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(v));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);}
  await p.getByLabel('Delay (seconds)').fill('0.7');await p.getByLabel('Background box').check();
  const style=await p.evaluate(()=>JSON.parse(localStorage.getItem('subscreen:subtitle-style')));assert.deepEqual(style,{font:'Georgia',size:38,color:'#12abef',outline:3,bottom:14,delay:.7,background:true});
  await invoke('plugin:event|emit',{event:'app-log',payload:{timeMs:Date.now(),level:'warning',message:'OCR test warning at 3.250s',videoTimeMs:3250,videoPath:root+'\\subtitle-test.mp4'}});
  await p.getByRole('button').filter({hasText:'OCR test warning'}).click();
  await p.waitForTimeout(200);const pos=await invoke('plugin:libmpv|get_property',{name:'time-pos',format:'double',windowLabel:'main'});assert(Math.abs(pos-3.25)<.05,String(pos));
  assert.equal(await invoke('plugin:libmpv|get_property',{name:'pause',format:'flag',windowLabel:'main'}),true);
  await p.evaluate(()=>localStorage.setItem('subscreen:update-session',JSON.stringify({videoPath:'C:\\Users\\neura\\repos\\subscreen\\.test-artifacts\\subtitle-test.mp4',cues:[{id:'saved',startMs:1000,endMs:2000,text:'Saved work'}],region:{x:0,y:75,width:100,height:25},currentMs:3250})));
  console.log('Installed/running detection, idempotent setup, vision validation, custom model OCR, style controls, warning seek: PASS');
 }else{
  await p.waitForFunction(()=>document.querySelector('textarea')?.value==='Saved work');
  assert.equal(await p.getByLabel('OCR model',{exact:true}).inputValue(),'glm-ocr:subscreen-test');
  const style=await p.evaluate(()=>JSON.parse(localStorage.getItem('subscreen:subtitle-style')));assert.equal(style.font,'Georgia');assert.equal(style.delay,.7);assert.equal(style.background,true);
  const pos=await invoke('plugin:libmpv|get_property',{name:'time-pos',format:'double',windowLabel:'main'});assert(Math.abs(pos-3.25)<.05,String(pos));
  await p.getByTestId('app-update').locator('summary').click();await p.getByRole('button',{name:'Check for updates',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('[data-testid="app-update"] [role="alert"]')||document.querySelector('[data-testid="app-update"] [role="status"]')?.textContent?.includes('up to date'),{},{timeout:40000});
  console.log('Real restart restores styles, model and update session: PASS');
  const original=JSON.parse(fs.readFileSync(root+'/prefs-030.json','utf8'));await p.evaluate(original=>{localStorage.clear();for(const [k,v] of Object.entries(original))localStorage.setItem(k,v);},original);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
