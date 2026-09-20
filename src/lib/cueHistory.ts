import {useReducer} from 'react';
import type {SubtitleCue} from './subtitles';
type Change=SubtitleCue[]|((cues:SubtitleCue[])=>SubtitleCue[]);
export type CueHistory={past:SubtitleCue[][];present:SubtitleCue[];future:SubtitleCue[][];group?:string;at?:number};
export type CueAction={type:'reset'|'edit';change:Change;group?:string;at?:number}|{type:'undo'}|{type:'redo'};
export const initialHistory:CueHistory={past:[],present:[],future:[]};
export function cueHistoryReducer(state:CueHistory,action:CueAction):CueHistory{
 if(action.type==='undo'){if(!state.past.length)return state;return {past:state.past.slice(0,-1),present:state.past.at(-1)!,future:[state.present,...state.future]};}
 if(action.type==='redo'){if(!state.future.length)return state;return {past:[...state.past,state.present].slice(-100),present:state.future[0],future:state.future.slice(1)};}
 const present=typeof action.change==='function'?action.change(state.present):action.change;
 if(action.type==='reset')return {...initialHistory,present};
 if(JSON.stringify(present)===JSON.stringify(state.present))return state;
 const grouped=action.group&&action.group===state.group&&(action.at??0)-(state.at??0)<800;
 return {past:grouped?state.past:[...state.past,state.present].slice(-100),present,future:[],group:action.group,at:action.at};
}
export function useCueHistory(){
 const [state,dispatch]=useReducer(cueHistoryReducer,initialHistory);
 return {cues:state.present,setCues:(change:Change)=>dispatch({type:'reset',change}),editCues:(change:Change,group?:string)=>dispatch({type:'edit',change,group,at:Date.now()}),undo:()=>dispatch({type:'undo'}),redo:()=>dispatch({type:'redo'}),canUndo:state.past.length>0,canRedo:state.future.length>0};
}

export function moveCueToSlot(cues:SubtitleCue[],id:string,direction:number):SubtitleCue[]{
 const index=cues.findIndex(cue=>cue.id===id),next=index+direction;
 if(index<0||next<0||next>=cues.length||next===index)return cues;
 const source=cues[index],neighbor=cues[next],result=[...cues];
 result[next]={...source,startMs:neighbor.startMs,endMs:neighbor.endMs};
 result[index]={...neighbor,startMs:source.startMs,endMs:source.endMs};
 return result;
}
