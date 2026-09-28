// Native backend and margin mapping follow Noir Player (MIT; see bundled NOIR-LICENSE).
import { useEffect, useRef, useState, type RefObject } from 'react';
import { command, getProperty, init, observeProperties, listenEvents, setProperty, setVideoMarginRatio, type MpvObservableProperty } from 'tauri-plugin-libmpv-api';

const properties = [['pause','flag'],['time-pos','double','none'],['duration','double','none'],['video-params/w','int64','none'],['video-params/h','int64','none']] as const satisfies readonly MpvObservableProperty[];
let initialized: Promise<unknown> | undefined;
let queue = Promise.resolve();
export function useMpv(path: string | null, stage: RefObject<HTMLDivElement | null>, onTime: (ms:number)=>void, onDuration:(ms:number)=>void, onRatio:(ratio:number)=>void, onError:(message:string)=>void) {
  const [ready,setReady]=useState(false);
  const [paused,setPaused]=useState(true);
  const callbacks=useRef({onTime,onDuration,onRatio,onError}); callbacks.current={onTime,onDuration,onRatio,onError};
  useEffect(()=>{
    let disposed=false; const cleanups:(()=>void)[]=[];
    setReady(false);
    queue=queue.catch(()=>{}).then(async()=>{
      if(disposed) return;
      if(!path) { if(initialized) await command('stop'); return; }
      initialized ??= init({initialOptions:{vo:'gpu-next',hwdec:'auto-safe','keep-open':'yes','force-window':'yes',pause:true,'sub-visibility':false,'osd-level':0},observedProperties:properties}).catch(e=>{initialized=undefined;throw e;});
      await initialized;
      if(disposed) return;
      let width=0,height=0;
      const unsubscribe=await observeProperties(properties,event=>{
        if(disposed) return;
        if(event.name==='pause') setPaused(Boolean(event.data));
        if(event.name==='time-pos') callbacks.current.onTime(Number(event.data ?? 0)*1000);
        if(event.name==='duration') callbacks.current.onDuration(Number(event.data ?? 0)*1000);
        if(event.name==='video-params/w') width=Number(event.data);
        if(event.name==='video-params/h') height=Number(event.data);
        if(width>0 && height>0) callbacks.current.onRatio(width/height);
      });
      if(disposed) {unsubscribe();return;} cleanups.push(unsubscribe);
      const unlisten=await listenEvents(event=>{if(disposed)return;if(event.event==='file-loaded')setReady(true);if(event.event==='end-file' && event.reason==='error'){setReady(false);callbacks.current.onError(`mpv: playback failed (${event.error})`);}});
      if(disposed){unlisten();return;} cleanups.push(unlisten);
      await setProperty('pause',true);
      await command('loadfile',[path,'replace']);
    }).catch(error=>{if(!disposed) callbacks.current.onError(String(error));});
    return ()=>{disposed=true;cleanups.forEach(fn=>fn());};
  },[path]);

  useEffect(()=>{
    if(!path || !ready || !stage.current) return;
    document.documentElement.classList.add('mpv-active');
    const backdrop=document.createElement('div'); backdrop.className='mpv-backdrop'; document.body.prepend(backdrop);
    let raf=0;
    const update=()=>{
      const rect=stage.current?.getBoundingClientRect(); if(!rect) return;
      const w=window.innerWidth,h=window.innerHeight;
      backdrop.style.clipPath=`polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.bottom}px, ${rect.right}px ${rect.bottom}px, ${rect.right}px ${rect.top}px, ${rect.left}px ${rect.top}px)`;
      void setVideoMarginRatio({left:Math.max(0,rect.left/w),right:Math.max(0,1-rect.right/w),top:Math.max(0,rect.top/h),bottom:Math.max(0,1-rect.bottom/h)}).catch(e=>callbacks.current.onError(String(e)));
    };
    const schedule=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(update);};
    const observer=new ResizeObserver(schedule);observer.observe(stage.current);window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true); schedule();
    return ()=>{observer.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);cancelAnimationFrame(raf);backdrop.remove();document.documentElement.classList.remove('mpv-active');};
  },[path,ready,stage]);
  const run=(promise:Promise<unknown>)=>{void promise.catch(e=>callbacks.current.onError(String(e)));};
  const step=async(direction:number)=>{await setProperty('pause',true);await command(direction<0?'frame-back-step':'frame-step');};
  return {ready,paused,step,position:async()=>Math.round(Number(await getProperty('time-pos','double'))*1000),fps:async()=>Number(await getProperty('estimated-vf-fps','double'))||24,toggle:()=>run(setProperty('pause',!paused)),pause:()=>run(setProperty('pause',true)),seek:(ms:number)=>run(command('seek',[Math.max(0,ms/1000),'absolute','exact'])),volume:(value:number)=>run(setProperty('volume',value)),speed:(value:number)=>run(setProperty('speed',value))};
}
