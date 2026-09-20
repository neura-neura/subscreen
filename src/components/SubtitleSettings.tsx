import type { AppLocale } from '../lib/i18n';
export type SubtitleStyle = {font:string;size:number;color:string;outline:number;bottom:number;delay:number;background:boolean};
export const defaultStyle:SubtitleStyle={font:'Segoe UI',size:24,color:'#ffffff',outline:2,bottom:8,delay:0,background:false};
export function initialSubtitleStyle():SubtitleStyle {try{
 const saved=JSON.parse(localStorage.getItem('subscreen:subtitle-style')??'{}');
 const number=(key:keyof SubtitleStyle,min:number,max:number)=>typeof saved?.[key]==='number'&&Number.isFinite(saved[key])?Math.max(min,Math.min(max,saved[key])):defaultStyle[key] as number;
 return {font:typeof saved?.font==='string'?saved.font:defaultStyle.font,color:typeof saved?.color==='string'&&/^#[0-9a-f]{6}$/i.test(saved.color)?saved.color:defaultStyle.color,size:number('size',12,72),outline:number('outline',0,5),bottom:number('bottom',0,40),delay:number('delay',-3600,3600),background:typeof saved?.background==='boolean'?saved.background:defaultStyle.background};
}catch{return {...defaultStyle};}}
export function SubtitleSettings({value,onChange,locale}:{value:SubtitleStyle;onChange:(s:SubtitleStyle)=>void;locale:AppLocale}) {
 const label=(en:string,es:string,zh:string)=>locale==='es'?es:locale==='zh'?zh:en;
 const change=(patch:Partial<SubtitleStyle>)=>onChange({...value,...patch});
 return <details className="subtitle-settings border-t border-white/10 p-4"><summary className="cursor-pointer text-sm font-medium">{label('Subtitle appearance & sync','Apariencia y sincronización','字幕样式与同步')}</summary><div className="mt-4 grid grid-cols-2 gap-3 text-xs">
 <label>{label('Font','Fuente','字体')}<select value={value.font} onChange={e=>change({font:e.target.value})}>{['Segoe UI','Arial','Noto Sans CJK SC','Microsoft YaHei','SimHei','Georgia','Verdana'].map(font=><option key={font}>{font}</option>)}</select></label>
 <label>{label('Color','Color','颜色')}<input type="color" value={value.color} onChange={e=>change({color:e.target.value})}/></label>
 <label>{label('Size','Tamaño','字号')} {value.size}<input type="range" min="12" max="72" value={value.size} onChange={e=>change({size:Number(e.target.value)})}/></label>
 <label>{label('Outline','Contorno','描边')} {value.outline}<input type="range" min="0" max="5" step="0.5" value={value.outline} onChange={e=>change({outline:Number(e.target.value)})}/></label>
 <label>{label('Bottom margin','Margen inferior','底部边距')} {value.bottom}%<input type="range" min="0" max="40" value={value.bottom} onChange={e=>change({bottom:Number(e.target.value)})}/></label>
 <label>{label('Delay (seconds)','Retardo (segundos)','延迟（秒）')}<input type="number" min="-3600" max="3600" step="0.1" value={value.delay} onChange={e=>change({delay:Math.max(-3600,Math.min(3600,Number(e.target.value)||0))})}/></label>
 <label className="flex items-center gap-2"><input type="checkbox" checked={value.background} onChange={e=>change({background:e.target.checked})}/>{label('Background box','Fondo de texto','文字背景')}</label>
 <button onClick={()=>onChange(defaultStyle)}>{label('Reset','Restablecer','重置')}</button>
 </div></details>;
}
