import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from './ui/card';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Progress} from './ui/progress';
import type {AppLocale} from '../lib/i18n';
export const recommendedModel='glm-ocr:latest';
type Status={installed:boolean;running:boolean;ready:boolean;present?:boolean;models:{name:string;size:number}[];error?:string};
export function AiSetup({model,onModel,onReady,onBusy,busy,progress,stage,locale}:{model:string;onModel:(model:string)=>void;onReady:(ready:boolean)=>void;onBusy:(busy:boolean)=>void;busy:boolean;progress:number;stage:string;locale:AppLocale}){
 const [status,setStatus]=useState<Status>();const [custom,setCustom]=useState(model);const [working,setWorking]=useState(false);const [checking,setChecking]=useState(false);const [error,setError]=useState('');
 const request=useRef(0);const l=(en:string,es:string,zh:string)=>locale==='es'?es:locale==='zh'?zh:en;
 const callbacks=useRef({onReady,onBusy});callbacks.current={onReady,onBusy};
 async function refresh(){const id=++request.current;setChecking(true);setError('');callbacks.current.onReady(false);try{const result=await invoke<Status>('ai_status',{model});if(id!==request.current)return;setStatus(result);callbacks.current.onReady(result.ready);setError(result.error??'');}catch(e){if(id===request.current){setStatus(undefined);setError(String(e));}}finally{if(id===request.current)setChecking(false);}}
 useEffect(()=>{setCustom(model);void refresh();return()=>{request.current++;};},[model]);
 async function setup(command:'install_ocr_model'|'setup_ollama'){setWorking(true);callbacks.current.onBusy(true);setError('');try{await invoke(command,{model});await refresh();}catch(e){setError(String(e));}finally{setWorking(false);callbacks.current.onBusy(false);}}
 const names=[...new Set([recommendedModel,model,...(status?.models.map(m=>m.name)??[])])];
 return <Card data-testid="ai-setup"><CardHeader><CardTitle>{l('AI · Ollama','IA · Ollama','AI · Ollama')}</CardTitle><CardDescription>{l('GLM-OCR is recommended: lightweight, local, and tested on your GPU.','GLM-OCR recomendado: ligero, local y probado en tu GPU.','推荐 GLM-OCR：轻量、本地运行，已在你的 GPU 上测试。')}</CardDescription></CardHeader><CardContent className="space-y-3">
 <label className="block space-y-1 text-xs"><span>{l('OCR model','Modelo OCR','OCR 模型')}</span><select aria-label="OCR model" className="w-full rounded border border-white/20 bg-zinc-900 p-2 text-zinc-100" value={model} disabled={busy||checking} onChange={e=>onModel(e.target.value)}>{names.map(name=><option key={name} value={name}>{name}{name===recommendedModel?l(' · recommended',' · recomendado',' · 推荐'):''}</option>)}</select></label>
 <details><summary className="cursor-pointer text-xs">{l('Use another model','Usar otro modelo','使用其他模型')}</summary><div className="mt-2 space-y-2"><label className="block text-xs">{l('Ollama model name','Nombre del modelo Ollama','Ollama 模型名称')}<Input aria-label="Custom OCR model" value={custom} disabled={busy} onChange={e=>setCustom(e.target.value)} placeholder="qwen3-vl:2b"/></label><Button size="sm" variant="secondary" disabled={busy||!custom.trim()} onClick={()=>{const value=custom.trim();onModel(value.split('/').at(-1)?.includes(':')?value:value+':latest');}}>{l('Select model','Seleccionar modelo','选择模型')}</Button><p className="text-xs text-zinc-400">{l('Requires image input. Larger models may be slower and use more VRAM.','Debe aceptar imágenes. Los modelos grandes pueden ser más lentos y consumir más VRAM.','需要支持图像输入。更大模型可能更慢并占用更多显存。')}</p></div></details>
 <p role="status" className="text-xs">{checking?l('Checking…','Comprobando…','检查中…'):status?.ready?l('Ollama connected · model ready','Ollama conectado · modelo listo','Ollama 已连接 · 模型就绪'):status?.running?l('Ollama connected · model not ready','Ollama conectado · modelo no disponible','Ollama 已连接 · 模型未就绪'):status?.installed?l('Ollama installed · stopped','Ollama instalado · detenido','Ollama 已安装 · 未启动'):l('Ollama is not installed','Ollama no está instalado','尚未安装 Ollama')}</p>
 {working&&<div role="status"><Progress value={progress}/><p className="mt-2 break-words text-xs">{stage} · {Math.round(progress)}%</p></div>}
 {error&&<p role="alert" className="break-words text-xs text-red-300">{error}</p>}
 <div className="flex flex-wrap gap-2">{!status?.ready&&<Button size="sm" disabled={busy||checking} onClick={()=>void setup('install_ocr_model')}>{status?.running?l('Download model','Descargar modelo','下载模型'):l('Set up automatically','Configurar automáticamente','自动配置')}</Button>}{!status?.running&&status?.installed&&<Button size="sm" variant="secondary" disabled={busy||checking} onClick={()=>void setup('setup_ollama')}>{l('Start Ollama','Iniciar Ollama','启动 Ollama')}</Button>}<Button size="sm" variant="ghost" disabled={busy||checking} onClick={()=>void refresh()}>{l('Refresh','Comprobar','刷新')}</Button></div>
 </CardContent></Card>;
}
