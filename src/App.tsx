import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useMpv } from './lib/mpv';
import { SubtitleSettings, initialSubtitleStyle } from './components/SubtitleSettings';
import {AiSetup,recommendedModel} from './components/AiSetup';
import {AppUpdate} from './components/AppUpdate';
import {openUrl} from '@tauri-apps/plugin-opener';
import {useCueHistory,moveCueToSlot} from './lib/cueHistory';
import {
  Check,
  ArrowUp,
  ArrowDown,
  Undo2,
  Redo2,
  Clipboard,
  ChevronLeft,
  Clock3,
  Download,
  FileText,
  Film,
  FolderOpen,
  Grip,
  ImageDown,
  LoaderCircle,
  Languages,
  Monitor,
  Moon,
  MousePointer2,
  Pause,
  Play,
  Plus,
  ScanLine,
  Terminal,
  Sun,
  Trash2,
  Upload,
  Video,
  WandSparkles,
  X,
} from 'lucide-react';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Progress } from './components/ui/progress';
import { decodeSubtitle, activeCue, formatTime, parseEditableTime, parseSubtitleText, toSrt, type SubtitleCue } from './lib/subtitles';
import { appLocaleOptions, translate, type AppLocale, type TranslationKey } from './lib/i18n';
import { basename, stripExtension } from './lib/utils';

type CropRegion = { x: number; y: number; width: number; height: number };
type AnalyzeResult = { startMs: number; endMs: number; text: string };
type Notice = { kind: 'success' | 'error' | 'info'; text: string } | null;
type LogEntry = { timeMs: number; level: string; message: string; videoTimeMs?:number; videoPath?:string };
type AnalysisProgress = { percent: number; stage: string; processed: number; total: number };
type ThemePreference = 'system' | 'light' | 'dark';

const videoExtensions = new Set(['mp4', 'mkv', 'avi', 'mov', 'm4v', 'webm', 'ts', 'm2ts', 'wmv', 'flv']);
const subtitleExtensions = new Set(['srt', 'vtt', 'ass', 'ssa', 'zip']);

function extension(path: string) {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

function isVideo(path: string) {
  return videoExtensions.has(extension(path));
}

function isSubtitle(path: string) {
  return subtitleExtensions.has(extension(path));
}

function percent(value: number) {
  return `${Math.max(0, Math.min(100, value))}%`;
}

function cueId(cue: AnalyzeResult, index: number) {
  return `cue-${cue.startMs}-${index}-${crypto.randomUUID()}`;
}

function initialThemePreference(): ThemePreference {
  const saved = window.localStorage.getItem('subscreen:theme');
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

function initialAppLocale(): AppLocale {
  const saved = window.localStorage.getItem('subscreen:locale');
  return saved === 'es' || saved === 'zh' || saved === 'en' ? saved : 'en';
}

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const resizeOrigin = useRef<{edge:string;region:CropRegion;point:{x:number;y:number}} | null>(null);

  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoRatio, setVideoRatio] = useState(16 / 9);
  const [durationMs, setDurationMs] = useState(0);
  const {cues,setCues,editCues,undo,redo,canUndo,canRedo}=useCueHistory();
  const [region, setRegion] = useState<CropRegion | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBurning, setIsBurning] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState('Waiting for analysis');
  const [logs, setLogs] = useState<LogEntry[]>([{ timeMs: Date.now(), level: 'info', message: 'Subscreen is ready. FFmpeg and OCR events will appear here.' }]);
  const [notice, setNotice] = useState<Notice>(null);
  const [modelReady, setModelReady] = useState(false);
  const [installingModel, setInstallingModel] = useState(false);
  const [updating,setUpdating]=useState(false);
  const [model,setModel]=useState(()=>localStorage.getItem('subscreen:ocr-model')||recommendedModel);
  const [subtitleStyle, setSubtitleStyle] = useState(initialSubtitleStyle);
  const [embeddedTracks, setEmbeddedTracks] = useState<{index:number;codec_name:string;tags?:{language?:string;title?:string}}[]>([]);
  const busy = isAnalyzing || isBurning || installingModel || updating;
  const busyRef = useRef(busy); busyRef.current = busy;
  const videoPathRef = useRef(videoPath); videoPathRef.current = videoPath;
  const label = (en: string, es: string, zh: string) => appLocale === 'es' ? es : appLocale === 'zh' ? zh : en;
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialThemePreference);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [appLocale, setAppLocale] = useState<AppLocale>(initialAppLocale);

  const [cueNumber,setCueNumber]=useState('');
  const currentCue = activeCue(cues, currentMs - subtitleStyle.delay * 1000);
  const t = (key: TranslationKey, values?: Record<string, string | number>) => translate(appLocale, key, values);

  const player = useMpv(videoPath, stageRef, setCurrentMs, setDurationMs, setVideoRatio, (text) => { setNotice({kind:'error',text}); addLog('error',text); });
  useEffect(()=>{
    const handle=(event:KeyboardEvent)=>{
      if(busy||event.altKey||!(event.ctrlKey||event.metaKey))return;
      const target=event.target as HTMLElement|null;
      if(target?.closest('input,select,[contenteditable="true"]'))return;
      if(event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}
      else if(event.key.toLowerCase()==='y'){event.preventDefault();redo();}
    };window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);
  },[busy,undo,redo]);
  useEffect(()=>{
    const keydown=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement | null;
      if(!videoPath || !player.ready || event.altKey || event.ctrlKey || event.metaKey || target?.closest('input,textarea,select,[contenteditable="true"],[role="slider"]'))return;
      if(event.code==='Space') {if(target?.closest('button'))return;event.preventDefault();if(!event.repeat)player.toggle();return;}
      if(event.key!=='ArrowLeft' && event.key!=='ArrowRight')return;
      event.preventDefault();
      const starts=cues.map(cue=>cue.startMs+subtitleStyle.delay*1000).sort((a,b)=>a-b);
      const active=activeCue(cues,currentMs-subtitleStyle.delay*1000);
      const previousFrom=active?active.startMs+subtitleStyle.delay*1000:currentMs;
      const next=event.key==='ArrowRight'?starts.find(time=>time>currentMs+1):starts.filter(time=>time<previousFrom-1).at(-1);
      if(next!==undefined)player.seek(next);
    };
    window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);
  },[videoPath,player,currentMs,cues,subtitleStyle.delay]);
  const framePlayer=useRef(player);framePlayer.current=player;
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined,held:string|null=null,generation=0;
    const stop=()=>{held=null;generation++;clearTimeout(timer);};
    const down=(event:KeyboardEvent)=>{
      if(!event.ctrlKey||event.altKey||event.metaKey||!['ArrowLeft','ArrowRight'].includes(event.key)||!framePlayer.current.ready||(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]'))return;
      event.preventDefault();if(event.repeat||held===event.key)return;stop();held=event.key;const token=generation,direction=event.key==='ArrowLeft'?-1:1;
      const tick=async(first=false)=>{const start=performance.now();try{await framePlayer.current.step(direction);const fps=await framePlayer.current.fps();if(token===generation&&held)timer=setTimeout(()=>void tick(),first?300:Math.max(0,1000/fps-(performance.now()-start)));}catch{stop();}};void tick(true);
    };
    const up=(event:KeyboardEvent)=>{if(event.key===held||event.key==='Control')stop();};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',stop);
    return()=>{stop();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',stop);};
  },[videoPath]);
  useEffect(() => {
    let disposed = false; setEmbeddedTracks([]);
    if(videoPath) void invoke<typeof embeddedTracks>('subtitle_tracks',{videoPath}).then(tracks=>{if(!disposed)setEmbeddedTracks(tracks);}).catch(error=>{if(!disposed)addLog('error',String(error));});
    return ()=>{disposed=true;};
  },[videoPath]);
  async function importTrack(index:number) {
    if(!videoPath || busy) return;
    try { const text=await invoke<string>('extract_subtitle_track',{videoPath,index}); const parsed=parseSubtitleText(text); if(!parsed.length) throw new Error(t('invalidCues')); setCues(parsed); }
    catch(error){setNotice({kind:'error',text:String(error)});}
  }
  useEffect(() => { localStorage.setItem('subscreen:subtitle-style', JSON.stringify(subtitleStyle)); }, [subtitleStyle]);
  function changeStyle(value: typeof subtitleStyle) {localStorage.setItem('subscreen:subtitle-style',JSON.stringify(value));setSubtitleStyle(value);}
  function changeModel(value:string){localStorage.setItem('subscreen:ocr-model',value);setModelReady(false);setModel(value);}
  function saveUpdateSession(){localStorage.setItem('subscreen:update-session',JSON.stringify({videoPath,cues,region,currentMs}));localStorage.setItem('subscreen:subtitle-style',JSON.stringify(subtitleStyle));}
  const resumeTime=useRef<number|null>(null);
  useEffect(()=>{try{const raw=localStorage.getItem('subscreen:update-session');if(!raw)return;const session=JSON.parse(raw);if(typeof session.videoPath==='string'&&Array.isArray(session.cues)){setVideoPath(session.videoPath);setCues(session.cues);setRegion(session.region);resumeTime.current=Number(session.currentMs)||0;}localStorage.removeItem('subscreen:update-session');}catch{localStorage.removeItem('subscreen:update-session');}},[]);
  useEffect(()=>{if(player.ready&&durationMs>0&&resumeTime.current!==null){player.seek(resumeTime.current);resumeTime.current=null;}},[player.ready,durationMs]);
  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const resolved = themePreference === 'system' ? systemTheme : themePreference;
    document.documentElement.dataset.theme = resolved;
    window.localStorage.setItem('subscreen:theme', themePreference);
  }, [systemTheme, themePreference]);

  useEffect(() => {
    document.documentElement.lang = appLocale === 'zh' ? 'zh-Hans' : appLocale;
    window.localStorage.setItem('subscreen:locale', appLocale);
  }, [appLocale]);


  useEffect(() => {
    const unlistenLog = listen<LogEntry>('app-log', (event) => {
      setLogs((current) => [...current, event.payload].slice(-500));
    });
    const unlistenPartial = listen<AnalyzeResult[]>('analysis-partial', event => setCues(event.payload.map((cue,index)=>({...cue,id:'partial-'+index}))));
    const unlistenProgress = listen<AnalysisProgress>('analysis-progress', (event) => {
      setAnalysisProgress(event.payload.percent);
      setAnalysisStage(event.payload.stage);
    });
    return () => {
      void unlistenPartial.then(unlisten=>unlisten());
      void unlistenLog.then((unlisten) => unlisten());
      void unlistenProgress.then((unlisten) => unlisten());
    };
  }, []);

  function addLog(level: string, message: string) {
    setLogs((current) => [...current, { timeMs: Date.now(), level, message }].slice(-500));
  }


  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop' || busyRef.current) return;
      const video = event.payload.paths.find(isVideo);
      const subtitle = event.payload.paths.find(isSubtitle);
      if (video) loadVideo(video);
      if (subtitle) void loadSubtitle(subtitle);
      if (!video && !subtitle && event.payload.paths.length) {
        setNotice({ kind: 'error', text: t('dragDropError') });
      }
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  function loadVideo(path: string) {
    if (busyRef.current) return;
    if (videoPathRef.current === path) return;
    setVideoPath(path);
    setCues([]);
    setRegion(null);
    setCurrentMs(0);
    setDurationMs(0);
    setCropMode(false);
    addLog('info', `${t('loadedVideo')}: ${basename(path)}.`);
    setNotice({ kind: 'info', text: t('videoLoadedNotice') });
  }

  async function chooseVideo() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Videos', extensions: [...videoExtensions] }],
    });
    if (selected && !Array.isArray(selected)) loadVideo(selected);
  }

  async function loadSubtitle(path: string) {
    try {
      const bytes = await invoke<number[]>('read_subtitle_file', { path });
      const text = await decodeSubtitle(new Uint8Array(bytes), path);
      const parsed = parseSubtitleText(text);
      if (!parsed.length) throw new Error(t('invalidCues'));
      setCues(parsed.map((cue, index) => ({ ...cue, id: `import-${Date.now()}-${index}` })));
      addLog('success', t('imported', { count: parsed.length, name: basename(path) }));
      setNotice({ kind: 'success', text: t('imported', { count: parsed.length, name: basename(path) }) });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function chooseSubtitle() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Subtítulos', extensions: ['srt', 'vtt', 'ass', 'ssa', 'zip'] }],
    });
    if (selected && !Array.isArray(selected)) await loadSubtitle(selected);
  }

  function relativePointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    };
  }

  function beginDrawing(event: React.PointerEvent<HTMLDivElement>) {
    if (!cropMode) return;
    const point = relativePointer(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = point;
    setIsDrawing(true);
    setRegion({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function beginResize(event: React.PointerEvent<HTMLDivElement>,edge:string) {
    if(!region) return;
    event.stopPropagation();event.preventDefault();
    const point=relativePointer(event);if(!point)return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeOrigin.current={edge,region:{...region},point};
  }

  function updateDrawing(event: React.PointerEvent<HTMLDivElement>) {
    if(resizeOrigin.current){
      const point=relativePointer(event);if(!point)return;
      const {edge,region:r,point:origin}=resizeOrigin.current;
      const dx=point.x-origin.x,dy=point.y-origin.y;
      let left=r.x,right=r.x+r.width,top=r.y,bottom=r.y+r.height;
      if(edge.includes('w'))left=Math.max(0,Math.min(right-2,left+dx));
      if(edge.includes('e'))right=Math.min(100,Math.max(left+2,right+dx));
      if(edge.includes('n'))top=Math.max(0,Math.min(bottom-2,top+dy));
      if(edge.includes('s'))bottom=Math.min(100,Math.max(top+2,bottom+dy));
      setRegion({x:left,y:top,width:right-left,height:bottom-top});return;
    }
    if (!isDrawing || !dragOrigin.current) return;
    const point = relativePointer(event);
    if (!point) return;
    const origin = dragOrigin.current;
    setRegion({
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
    });
  }

  function finishDrawing() {
    if(resizeOrigin.current){resizeOrigin.current=null;return;}
    if (!isDrawing) return;
    setIsDrawing(false);
    dragOrigin.current = null;
    setRegion((last) => {
      if (!last || last.width < 2 || last.height < 2) {
        setNotice({ kind: 'error', text: t('areaTooSmall') });
        return null;
      }
      setNotice({ kind: 'success', text: t('areaReady') });
      return last;
    });
  }

  async function analyze() {
    if (!videoPath || !region || busy) return;
    player.pause();
    setCropMode(false);
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisStage(t('analyzing'));
    addLog('info', t('analysisRequested'));
    setNotice({ kind: 'info', text: t('analyzingFrames') });
    try {
      const result = await invoke<AnalyzeResult[]>('analyze_subtitles', { videoPath, region, language: 'auto',model });
      setCues(result.map((cue, index) => ({ ...cue, id: cueId(cue, index) })));
      setAnalysisProgress(100);
      setNotice({
        kind: result.length ? 'success' : 'error',
        text: result.length ? t('analysisDone', { count: result.length }) : t('noText'),
      });
    } catch (error) {
      addLog('error', error instanceof Error ? error.message : String(error));
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function stampCue(id:string,edge:'startMs'|'endMs'){
    if(busy||!player.ready)return;
    try{const time=await player.position();const cue=cues.find(c=>c.id===id);if(!cue)return;
      if(edge==='startMs'?time>=cue.endMs:time<=cue.startMs){setNotice({kind:'error',text:label('Start must precede end. Adjust the other boundary first.','El inicio debe ser anterior al final. Ajusta primero el otro límite.','开始时间必须早于结束时间。请先调整另一边界。')});return;}
      updateCue(id,{[edge]:time});
    }catch(e){setNotice({kind:'error',text:String(e)});}
  }
  function jumpToCue(){const n=Number(cueNumber);if(!Number.isInteger(n)||n<1||n>cues.length)return;const cue=cues[n-1];player.pause();seekTo(cue.startMs);const row=document.querySelector<HTMLElement>(`[data-cue-id="${cue.id}"]`);row?.scrollIntoView({block:'center'});row?.querySelector('textarea')?.focus({preventScroll:true});}
  function seekTo(timeMs: number) { player.seek(timeMs + subtitleStyle.delay * 1000); }

  function updateCue(id: string, patch: Partial<SubtitleCue>) {
    if(busy)return;
    editCues((current) => current.map((cue) => cue.id === id ? { ...cue, ...patch } : cue),Object.hasOwn(patch,'text')?'text:'+id:undefined);
  }

  function removeCue(id: string) {
    if(busy)return;
    editCues((current) => current.filter((cue) => cue.id !== id));
  }

  function addCue() {
    if(busy)return;
    const startMs = Math.max(0,Math.round(currentMs-subtitleStyle.delay*1000));
    const limit=durationMs-subtitleStyle.delay*1000;
    const endMs = Math.max(startMs+1,Math.min(limit>startMs?limit:startMs+2000,startMs+2000));
    const cue={ id: crypto.randomUUID(), startMs, endMs, text: '' };
    editCues(current=>{const next=[...current];const index=next.findIndex(item=>item.startMs>startMs);next.splice(index<0?next.length:index,0,cue);return next;});
    requestAnimationFrame(()=>{document.querySelector<HTMLTextAreaElement>(`[data-cue-id="${cue.id}"] textarea`)?.focus();});
  }
  function moveCue(id:string,direction:number){if(busy)return;editCues(current=>moveCueToSlot(current,id,direction));}

  function shiftedCues() { return cues.map(cue => ({...cue,startMs:Math.max(0,cue.startMs + subtitleStyle.delay*1000),endMs:Math.max(0,cue.endMs + subtitleStyle.delay*1000)})).filter(cue=>cue.endMs>cue.startMs); }

  async function exportSrt() {
    if (!cues.length) return;
    const suggestedName = `${stripExtension(basename(videoPath ?? 'subtitulos'))}.srt`;
    const outputPath = await save({ defaultPath: suggestedName, filters: [{ name: 'SRT', extensions: ['srt'] }] });
    if (!outputPath) return;
    try {
      await invoke('write_srt', { outputPath, content: toSrt(shiftedCues()) });
      setNotice({ kind: 'success', text: t('saved', { name: basename(outputPath) }) });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function burnSubtitles() {
    if (!videoPath || !cues.length) return;
    const suggestedName = `${stripExtension(basename(videoPath))}_subtitled.mp4`;
    const outputPath = await save({ defaultPath: suggestedName, filters: [{ name: 'Video MP4', extensions: ['mp4'] }] });
    if (!outputPath) return;
    setIsBurning(true); setAnalysisProgress(0); setAnalysisStage(t('burning'));
    addLog('info', t('embedVideo'));
    setNotice({ kind: 'info', text: t('burning') });
    try {
      await invoke('burn_subtitles', { videoPath, outputPath, srtContent: toSrt(shiftedCues()), style: subtitleStyle });
      setNotice({ kind: 'success', text: t('exportedVideo', { name: basename(outputPath) }) });
    } catch (error) {
      addLog('error', error instanceof Error ? error.message : String(error));
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsBurning(false);
    }
  }

  async function copyLogs() {
    const content = logs.map((entry) => `[${new Date(entry.timeMs).toLocaleTimeString()}] ${entry.level.toUpperCase()}  ${entry.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(content);
      setNotice({ kind: 'success', text: t('logsCopied') });
    } catch {
      setNotice({ kind: 'error', text: t('logsCopyError') });
    }
  }

  const sortedCues = cues;

  if (!videoPath) {
    return (
      <main className="min-h-screen bg-black px-6 py-8 text-zinc-100 selection:bg-white/30">
        <header className="mx-auto flex max-w-6xl items-center justify-between">
          <Brand />
          <div className="flex items-center gap-3"><AppUpdate locale={appLocale} busy={busy} onBusy={setUpdating} beforeInstall={saveUpdateSession}/><LanguageControl value={appLocale} onChange={setAppLocale} /><ThemeControl value={themePreference} onChange={setThemePreference} locale={appLocale} /><Badge variant="muted">DESKTOP · TAURI</Badge></div>
        </header>
        <section className="mx-auto flex min-h-[calc(100vh-150px)] max-w-4xl items-center justify-center">
          <Card className="upload-card w-full overflow-hidden border-white/15 bg-gradient-to-b from-zinc-900 to-black">
            <CardContent className="p-2">
              <button onClick={() => void chooseVideo()} className="upload-dropzone group flex min-h-[390px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-white/25 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,.09),transparent_54%)] px-7 text-center transition hover:border-white/60 hover:bg-white/[.07]" type="button">
                <img src="/app-icon.png" width="96" height="96" alt="Subscreen" className="mb-6 h-24 w-24"/>
                <p className="text-xl font-semibold tracking-tight">{t('dropTitle')}</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">{t('dropDescription')}</p>
                <span className="mt-7 inline-flex items-center gap-2 rounded-md bg-white/[.07] px-3.5 py-2 text-sm font-medium text-zinc-200 transition group-hover:bg-white/[.12]"><FolderOpen size={15} /> {t('chooseFile')}</span>
                <span className="mt-5 text-[11px] font-medium uppercase tracking-[.18em] text-zinc-600">{t('formats')}</span>
              </button>
            </CardContent>
          </Card>
        </section>
        <div className="mx-auto mb-6 max-w-xl"><AiSetup model={model} onModel={changeModel} onReady={setModelReady} onBusy={value=>{setInstallingModel(value);if(value){setAnalysisProgress(0);setAnalysisStage("Preparing Ollama…");}}} busy={busy} progress={analysisProgress} stage={analysisStage} locale={appLocale}/></div>
        <p className="mx-auto max-w-4xl text-center text-xs text-zinc-600">{t('basedOn')}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-zinc-100 selection:bg-white/30">
      <header className="sticky top-0 z-30 border-b border-white/[.10] bg-black/90 px-5 py-3.5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1580px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Button disabled={busy} onClick={() => setVideoPath(null)} variant="ghost" size="icon" className="shrink-0" title={t('back')}><ChevronLeft size={19} /></Button>
            <span className="h-6 w-px bg-white/[.09]" />
            <Brand compact />
            <span className="hidden h-6 w-px bg-white/[.09] sm:block" />
            <div className="hidden min-w-0 sm:block"><p className="truncate text-sm font-medium text-zinc-300">{basename(videoPath)}</p><p className="text-[10px] uppercase tracking-[.14em] text-zinc-600">{t('loadedVideo')}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <AppUpdate locale={appLocale} busy={busy} onBusy={setUpdating} beforeInstall={saveUpdateSession}/>
            <LanguageControl value={appLocale} onChange={setAppLocale} />
            <ThemeControl value={themePreference} onChange={setThemePreference} locale={appLocale} />
            <Button onClick={() => void chooseSubtitle()} disabled={busy} variant="secondary" size="sm" className="hidden sm:inline-flex"><FileText size={14} /> {t('importSrt')}</Button>
            <Button onClick={() => void exportSrt()} disabled={!cues.length} variant="outline" size="sm"><Download size={14} /> <span className="hidden sm:inline">{t('exportSrt')}</span></Button>
            <Button onClick={() => void burnSubtitles()} disabled={!cues.length || busy} size="sm">{isBurning ? <LoaderCircle className="animate-spin" size={14} /> : <ImageDown size={14} />} <span className="hidden sm:inline">{t('burnVideo')}</span></Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1580px] gap-5 px-5 py-5 xl:grid-cols-[270px_minmax(0,1fr)_390px]">
        <aside className="space-y-4 xl:sticky xl:top-[84px] xl:h-fit">
          <Card>
            <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle>{t('workflow')}</CardTitle><Badge>{region ? '02 / 02' : '01 / 02'}</Badge></div><CardDescription>{t('workflowDescription')}</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              <WorkflowStep complete label={t('videoLoaded')} detail={basename(videoPath)} icon={<Video size={15} />} />
              <WorkflowStep complete={Boolean(region)} active={!region} label={t('subtitleArea')} detail={region ? t('areaSelected') : t('areaPending')} icon={<MousePointer2 size={15} />} />
              <WorkflowStep complete={Boolean(cues.length)} label={t('reviewExport')} detail={cues.length ? t('cuesReady', { count: cues.length }) : t('noCues')} icon={<FileText size={15} />} />
            </CardContent>
          </Card>
          <AiSetup model={model} onModel={changeModel} onReady={setModelReady} onBusy={value=>{setInstallingModel(value);if(value){setAnalysisProgress(0);setAnalysisStage("Preparing Ollama…");}}} busy={busy} progress={analysisProgress} stage={analysisStage} locale={appLocale}/>
          <Card className="hidden xl:block"><CardHeader className="pb-3"><CardTitle>{t('howItWorks')}</CardTitle></CardHeader><CardContent><ol className="space-y-3 text-xs leading-5 text-zinc-400"><li className="flex gap-3"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] text-white">1</span>{t('howOne')}</li><li className="flex gap-3"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] text-white">2</span>{t('howTwo')}</li><li className="flex gap-3"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] text-white">3</span>{t('howThree')}</li></ol></CardContent></Card>
        </aside>

        <section className="min-w-0 space-y-4">
          <Card className="player-card overflow-hidden">
            <div ref={stageRef} className={`video-stage relative overflow-hidden ${cropMode ? 'cursor-crosshair' : ''}`} style={{ aspectRatio: videoRatio, containerType: 'inline-size' }}>
              {!player.ready && <div className="absolute inset-0 grid place-items-center bg-black text-white"><LoaderCircle className="animate-spin" /></div>}
              {currentCue && !cropMode && <div className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-[5%]" style={{bottom:subtitleStyle.bottom+'%'}}><p className="subtitle-preview whitespace-pre-line text-center" style={{fontFamily:subtitleStyle.font,fontSize:(subtitleStyle.size/2.88/videoRatio)+'cqw',color:subtitleStyle.color,WebkitTextStroke:subtitleStyle.outline/1.44/videoRatio+'cqw black',paintOrder:'stroke fill',lineHeight:1.2,background:subtitleStyle.background?'rgba(0,0,0,.6)':'transparent',padding:'0 .2em'}}>{currentCue.text}</p></div>}
              {region && cropMode && <div className="absolute z-50 border-4 border-dashed border-amber-400 bg-amber-400/10 shadow-[0_0_0_2px_rgba(0,0,0,.9),0_0_0_999px_rgba(0,0,0,.34),0_0_18px_rgba(251,191,36,.95)]" style={{ left: percent(region.x), top: percent(region.y), width: percent(region.width), height: percent(region.height) }}><span className="absolute -top-8 left-0 whitespace-nowrap rounded-md border border-amber-200 bg-amber-400 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-black shadow-md">{t('ocrArea')}</span>{['n','s','e','w','nw','ne','sw','se'].map(edge=><div key={edge} data-resize={edge} role="slider" aria-label={label('Resize area ','Redimensionar área ','调整区域 ')+edge} aria-valuenow={Math.round(edge==='n'||edge==='s'?region.height:region.width)} tabIndex={0} className={'crop-handle crop-handle-'+edge} onPointerDown={e=>beginResize(e,edge)} onPointerMove={updateDrawing} onPointerUp={finishDrawing} onPointerCancel={finishDrawing} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const rect=stageRef.current!.getBoundingClientRect();const point={x:region.x,y:region.y};resizeOrigin.current={edge,region,point};updateDrawing({clientX:rect.left+(point.x+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0))*rect.width/100,clientY:rect.top+(point.y+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0))*rect.height/100} as React.PointerEvent<HTMLDivElement>);resizeOrigin.current=null;}}/> )}</div>}
              {cropMode && <div className="absolute inset-0 z-40" onPointerDown={beginDrawing} onPointerMove={updateDrawing} onPointerUp={finishDrawing} onPointerCancel={finishDrawing}><div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="video-overlay-text rounded-full px-5 py-2 text-sm font-semibold shadow-2xl"><Grip className="mr-2 inline" size={15} /> {region ? label('Drag edges or corners · Done to hide','Arrastra bordes o esquinas · Listo para ocultar','拖动边缘或角落 · 完成后隐藏') : t('selectHint')}</span></div></div>}
            </div>
            <div className="player-controls flex flex-wrap items-center gap-3 p-3"><Button size="icon" variant="ghost" disabled={!player.ready} onClick={player.toggle} aria-label={player.paused ? 'Play' : 'Pause'}>{player.paused ? <Play size={16}/> : <Pause size={16}/>}</Button><Button size="icon" variant="ghost" disabled={!player.ready} title={label('Previous frame (Ctrl+Left)','Fotograma anterior (Ctrl+Izquierda)','上一帧 (Ctrl+Left)')} onClick={()=>void player.step(-1).catch(e=>setNotice({kind:'error',text:String(e)}))}>|◀</Button><Button size="icon" variant="ghost" disabled={!player.ready} title={label('Next frame (Ctrl+Right)','Fotograma siguiente (Ctrl+Derecha)','下一帧 (Ctrl+Right)')} onClick={()=>void player.step(1).catch(e=>setNotice({kind:'error',text:String(e)}))}>▶|</Button><span className="text-xs tabular-nums">{formatTime(currentMs).split(',')[0]}</span><input className="min-w-24 flex-1" aria-label="Seek" type="range" min="0" max={durationMs || 1} step="100" value={Math.min(currentMs,durationMs)} onChange={e=>player.seek(Number(e.target.value))}/><span className="text-xs tabular-nums">{formatTime(durationMs).split(',')[0]}</span><input aria-label="Volume" className="w-20" type="range" min="0" max="100" defaultValue="100" onChange={e=>player.volume(Number(e.target.value))}/><select aria-label="Playback speed" defaultValue="1" onChange={e=>player.speed(Number(e.target.value))}>{[0.5,0.75,1,1.25,1.5,2].map(rate=><option key={rate} value={rate}>{rate}×</option>)}</select><Badge variant="muted">mpv</Badge></div>
            {embeddedTracks.length > 0 && <label className="block p-3 text-xs">{label("Embedded subtitles", "Subtítulos internos", "内嵌字幕")}<select className="ml-3 max-w-full bg-transparent" disabled={busy} value="" onChange={e=>void importTrack(Number(e.target.value))}><option value="">{label("Import track to editor", "Importar pista al editor", "导入字幕轨道")}</option>{embeddedTracks.map(track=><option key={track.index} value={track.index}>{track.tags?.title || track.tags?.language || "Track "+track.index} · {track.codec_name}</option>)}</select></label>}
            <SubtitleSettings value={subtitleStyle} onChange={changeStyle} locale={appLocale}/>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[.07] py-3.5">
              <div className="flex items-center gap-3"><Button disabled={busy || !player.ready} onClick={() => {player.pause();setCropMode(!cropMode);}} variant={cropMode ? 'default' : 'secondary'} size="sm"><MousePointer2 size={14} /> {cropMode ? label('Done','Listo','完成') : region ? t('changeArea') : t('selectArea')}</Button>{region && <span className="text-xs text-zinc-400">{t('areaSize', { width: Math.round(region.width), height: Math.round(region.height) })}</span>}</div>
              <Button onClick={() => void analyze()} disabled={!region || busy || !modelReady} size="sm">{isAnalyzing ? <LoaderCircle className="animate-spin" size={15} /> : <ScanLine size={15} />} {isAnalyzing ? t('analyzing') : t('analyze')}</Button>
            </CardContent>
            {busy && <div role="status" aria-live="polite" className="border-t border-white/[.07] px-5 py-3"><div className="mb-1.5 flex justify-between text-[11px] text-zinc-400"><span>{analysisStage}</span><span>{Math.round(analysisProgress)}%</span></div><Progress value={analysisProgress} /><Button variant="ghost" size="sm" onClick={()=>void invoke('cancel_processing')}>{label('Cancel','Cancelar','取消')}</Button></div>}
          </Card>

          {notice && <div className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${notice.kind === 'error' ? 'border-white/20 bg-white/[.08] text-white' : notice.kind === 'success' ? 'border-white/20 bg-white/[.08] text-white' : 'border-white/20 bg-white/[.05] text-zinc-100'}`}><span className="shrink-0">{notice.kind === 'success' ? <Check size={16} /> : notice.kind === 'error' ? <X size={16} /> : <WandSparkles size={16} />}</span><span className="flex-1">{notice.text}</span><button onClick={() => setNotice(null)} className="text-current/60 hover:text-current"><X size={15} /></button></div>}

          <LogPanel logs={logs} onCopy={() => void copyLogs()} locale={appLocale} videoPath={videoPath} onSeek={time=>{player.pause();player.seek(time);stageRef.current?.scrollIntoView({block:"center"});}} />

          <Card className="xl:hidden"><CardHeader className="pb-3"><CardTitle>{t('actions')}</CardTitle></CardHeader><CardContent className="flex gap-2"><Button onClick={() => void chooseSubtitle()} disabled={busy} variant="secondary" size="sm"><FileText size={14} /> {t('import')}</Button><Button onClick={() => void exportSrt()} disabled={!cues.length} variant="outline" size="sm"><Download size={14} /> SRT</Button></CardContent></Card>
        </section>

        <section className="min-w-0 xl:sticky xl:top-[84px] xl:h-[calc(100vh-105px)]">
          <Card className="flex h-full min-h-[530px] flex-col overflow-hidden">
            <CardHeader className="flex-row items-center justify-between border-b border-white/[.07] pb-4"><div><CardTitle className="flex items-center gap-2"><FileText className="text-white" size={16} /> {t('editor')}</CardTitle><CardDescription className="mt-1">{cues.length ? t('previewActive', { count: cues.length }) : t('cuesWillAppear')}</CardDescription></div><div className="flex items-center gap-1"><Button onClick={undo} disabled={busy||!canUndo} variant="ghost" size="icon" title={label('Undo (Ctrl+Z)','Deshacer (Ctrl+Z)','撤销 (Ctrl+Z)')}><Undo2 size={16}/></Button><Button onClick={redo} disabled={busy||!canRedo} variant="ghost" size="icon" title={label('Redo (Ctrl+Y)','Rehacer (Ctrl+Y)','重做 (Ctrl+Y)')}><Redo2 size={16}/></Button><Button onClick={addCue} disabled={!videoPath||busy} variant="ghost" size="icon" title={t('addSubtitle')}><Plus size={18} /></Button></div></CardHeader>
            <form className="flex items-center gap-2 border-b border-white/10 p-3" onSubmit={e=>{e.preventDefault();jumpToCue();}}><label className="text-xs">{label('Go to cue','Ir al cue','跳转字幕')} <input aria-label={label('Cue number','Número de cue','字幕序号')} type="number" min="1" max={cues.length||1} step="1" required value={cueNumber} onChange={e=>setCueNumber(e.target.value)} className="ml-2 w-20 rounded bg-white/10 p-2"/></label><Button type="submit" size="sm" variant="secondary" disabled={!cues.length||!player.ready}>{label('Go','Ir','跳转')}</Button></form>
            {cues.length ? <div className="min-h-0 flex-1 overflow-y-auto p-3 pr-2"><div className="space-y-2">{sortedCues.map((cue, index) => <CueEditor key={cue.id} cue={cue} number={index + 1} active={currentCue?.id === cue.id} locale={appLocale} onMoveUp={index>0?()=>moveCue(cue.id,-1):undefined} onMoveDown={index<cues.length-1?()=>moveCue(cue.id,1):undefined} onStampStart={()=>void stampCue(cue.id,'startMs')} onStampEnd={()=>void stampCue(cue.id,'endMs')} onSeek={() => seekTo(cue.startMs)} onDelete={() => removeCue(cue.id)} onText={(text) => updateCue(cue.id, { text })} onStart={(value) => { const time = parseEditableTime(value); if (time !== null && time < cue.endMs) updateCue(cue.id, { startMs: time }); }} onEnd={(value) => { const time = parseEditableTime(value); if (time !== null && time > cue.startMs) updateCue(cue.id, { endMs: time }); }} />)}</div></div> : <EmptyEditor onImport={() => void chooseSubtitle()} onAdd={addCue} locale={appLocale} />}
            <div className="border-t border-white/[.07] bg-white/[.02] p-3"><Button onClick={() => void exportSrt()} disabled={!cues.length} className="w-full"><Download size={15} /> {t('exportFile')}</Button><Button onClick={() => void burnSubtitles()} disabled={!cues.length || busy} variant="ghost" className="mt-1 w-full text-zinc-400 hover:text-white">{isBurning ? <LoaderCircle className="animate-spin" size={15} /> : <Film size={15} />} {t('embedVideo')}</Button></div>
          </Card>
        </section>
      </div>
    </main>
  );
}

function LanguageControl({ value, onChange }: { value: AppLocale; onChange: (value: AppLocale) => void }) {
  return <label className="flex h-8 items-center gap-1 rounded-md border border-white/[.12] bg-white/[.04] px-2 text-zinc-300"><Languages size={13} /><select value={value} onChange={(event) => onChange(event.target.value as AppLocale)} className="max-w-20 bg-transparent text-[11px] font-medium outline-none">{appLocaleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function ThemeControl({ value, onChange, locale }: { value: ThemePreference; onChange: (value: ThemePreference) => void; locale: AppLocale }) {
  const Icon = value === 'dark' ? Moon : value === 'light' ? Sun : Monitor;
  return <label className="flex h-8 items-center gap-1.5 rounded-md border border-white/[.12] bg-white/[.04] px-2 text-zinc-300"><Icon size={13} /><select value={value} onChange={(event) => onChange(event.target.value as ThemePreference)} className="max-w-20 bg-transparent text-[11px] font-medium outline-none"><option value="system">{translate(locale, 'themeSystem')}</option><option value="light">{translate(locale, 'themeLight')}</option><option value="dark">{translate(locale, 'themeDark')}</option></select></label>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-2.5"><img src="/app-icon.png" width="36" height="36" alt="" className="h-9 w-9 shrink-0"/><div><p className="text-[15px] font-bold tracking-tight text-white">Subscreen</p><p className="text-[10px] text-zinc-400">made by <a href="https://github.com/neura-neura/subscreen" className="underline underline-offset-2 hover:text-white" onClick={event=>{event.preventDefault();void openUrl("https://github.com/neura-neura/subscreen");}}>neura-neura</a></p>{!compact && <p className="text-[10px] font-medium uppercase tracking-[.16em] text-zinc-500">Subtitle extraction studio</p>}</div></div>;
}

function LogPanel({ logs, onCopy, locale, videoPath, onSeek }: { logs: LogEntry[]; onCopy: () => void; locale: AppLocale; videoPath:string|null; onSeek:(time:number)=>void }) {
  const t = (key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values);
  return <Card className="overflow-hidden"><CardHeader className="flex-row items-center justify-between border-b border-white/[.07] py-3"><div className="flex items-center gap-2"><Terminal size={16} /><CardTitle>{t('logs')}</CardTitle><Badge variant="muted">{t('events', { count: logs.length })}</Badge></div><Button onClick={onCopy} variant="ghost" size="sm"><Clipboard size={14} /> {t('copy')}</Button></CardHeader><CardContent className="max-h-52 overflow-y-auto bg-black p-0 font-mono text-[11px] leading-5">{logs.map((entry, index) => {
    const legacy=entry.level==='warning'?entry.message.match(/(?:at|en)\s+(\d+(?:\.\d+)?)s/):null;
    const time=entry.videoTimeMs??(legacy?Number(legacy[1])*1000:undefined);
    const canSeek=time!==undefined&&(!entry.videoPath||entry.videoPath===videoPath);
    const content=<><span className="tabular-nums text-zinc-500">{new Date(entry.timeMs).toLocaleTimeString()}</span><span className="uppercase text-zinc-400">{entry.level}</span><span className={entry.level==='error'?'text-red-300':entry.level==='warning'?'text-amber-200':'text-zinc-300'}>{entry.message}{canSeek&&<span className="ml-2 underline">↗ {formatTime(time!)}</span>}</span></>;
    const classes="grid w-full grid-cols-[74px_70px_1fr] gap-2 border-b border-white/[.04] px-3 py-2 text-left text-zinc-400";
    return canSeek?<button key={index} className={classes+' hover:bg-white/10 focus-visible:outline focus-visible:outline-2'} onClick={()=>onSeek(time!)} title={locale==='es'?'Ir a este instante del video':locale==='zh'?'跳转到视频时间':'Jump to this video timestamp'}>{content}</button>:<div key={index} className={classes}>{content}</div>;
  })}</CardContent></Card>;
}

function WorkflowStep({ complete, active, label, detail, icon }: { complete: boolean; active?: boolean; label: string; detail: string; icon: React.ReactNode }) {
  return <div className={`flex items-center gap-3 rounded-lg p-2.5 ${active ? 'bg-white/[.08] ring-1 ring-white/15' : ''}`}><span className={`grid h-8 w-8 place-items-center rounded-md ${complete ? 'bg-white/15 text-white' : active ? 'bg-white/15 text-white' : 'bg-white/[.05] text-zinc-500'}`}>{complete ? <Check size={15} /> : icon}</span><div className="min-w-0"><p className={`text-xs font-medium ${active ? 'text-white' : 'text-zinc-300'}`}>{label}</p><p className="truncate text-[10px] text-zinc-500">{detail}</p></div></div>;
}

function CueEditor({ cue, number, active, locale, onSeek, onDelete, onText, onStart, onEnd, onMoveUp,onMoveDown,onStampStart,onStampEnd }: { cue: SubtitleCue; number: number; active: boolean; locale: AppLocale; onSeek: () => void; onDelete: () => void; onText: (text: string) => void; onStart: (value: string) => void; onEnd: (value: string) => void; onStampStart:()=>void;onStampEnd:()=>void;onMoveUp?:()=>void;onMoveDown?:()=>void }) {
  const t = (key: TranslationKey) => translate(locale, key);
  return <article data-cue-id={cue.id} className={`group rounded-lg border p-3 transition ${active ? 'border-white/45 bg-white/[.08]' : 'border-white/[.07] bg-black/30 hover:border-white/[.14]'}`}><div className="mb-2 flex items-center justify-between gap-2"><button onClick={onSeek} className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 transition hover:text-white"><span className="grid h-4 w-4 place-items-center rounded bg-white/[.06] text-[9px]">{number}</span> {t('goToCue')} <Play size={10} /></button><div className="flex items-center gap-1"><button onClick={onMoveUp} disabled={!onMoveUp} className="rounded p-1 text-zinc-400 hover:bg-white/10 disabled:opacity-30" title={locale==='es'?'Mover arriba (intercambiar tiempos)':locale==='zh'?'上移（交换时间）':'Move up (swap timings)'}><ArrowUp size={14}/></button><button onClick={onMoveDown} disabled={!onMoveDown} className="rounded p-1 text-zinc-400 hover:bg-white/10 disabled:opacity-30" title={locale==='es'?'Mover abajo (intercambiar tiempos)':locale==='zh'?'下移（交换时间）':'Move down (swap timings)'}><ArrowDown size={14}/></button><button onClick={onDelete} className="rounded p-1 text-zinc-400 hover:bg-white/10" title={t('deleteCue')}><Trash2 size={14} /></button></div></div><textarea value={cue.text} onChange={(event) => onText(event.target.value)} rows={2} className="w-full resize-y border-0 bg-transparent p-0 text-sm leading-5 text-zinc-100 outline-none placeholder:text-zinc-600 focus:ring-0" aria-label={`${t('editor')} ${number}`} /><div className="mt-2 grid grid-cols-2 gap-2"><TimeInput label="IN" value={formatTime(cue.startMs)} onCommit={onStart} onStamp={onStampStart} stampTitle={tStamp(locale,'IN')} /><TimeInput label="OUT" value={formatTime(cue.endMs)} onCommit={onEnd} onStamp={onStampEnd} stampTitle={tStamp(locale,'OUT')} /></div></article>;
}

function tStamp(locale:AppLocale,edge:string){return locale==='es'?`Fijar ${edge} al tiempo actual`:locale==='zh'?`将 ${edge} 设为当前时间`:`Set ${edge} to current time`;}
function TimeInput({ label, value, onCommit,onStamp,stampTitle }: { label: string; value: string; onCommit: (value: string) => void;onStamp:()=>void;stampTitle:string }) {
  return <div className="flex min-w-0 items-center gap-1 rounded-md bg-white/[.04] px-2 py-1"><label className="flex min-w-0 flex-1 items-center gap-1.5"><span className="text-[9px] font-semibold tracking-wider text-zinc-500">{label}</span><input key={value} defaultValue={value} onBlur={(event) => onCommit(event.target.value)} className="w-full min-w-0 bg-transparent text-[11px] tabular-nums text-zinc-300 outline-none" /></label><button type="button" title={stampTitle} aria-label={stampTitle} onClick={onStamp} className="rounded p-1.5 hover:bg-white/10 focus-visible:outline"><Clock3 size={14}/></button></div>;
}

function EmptyEditor({ onImport, onAdd, locale }: { onImport: () => void; onAdd: () => void; locale: AppLocale }) {
  const t = (key: TranslationKey) => translate(locale, key);
  return <div className="flex flex-1 flex-col items-center justify-center px-8 text-center"><span className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-white/[.08] bg-white/[.04] text-zinc-500"><Clock3 size={22} /></span><p className="text-sm font-medium text-zinc-300">{t('noSubtitles')}</p><p className="mt-1 max-w-[250px] text-xs leading-5 text-zinc-500">{t('noSubtitlesDescription')}</p><div className="mt-5 flex gap-2"><Button onClick={onImport} variant="secondary" size="sm"><Upload size={14} /> {t('import')}</Button><Button onClick={onAdd} variant="ghost" size="sm"><Plus size={14} /> {t('createManually')}</Button></div></div>;
}
