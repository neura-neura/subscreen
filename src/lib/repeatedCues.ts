import type {SubtitleCue} from './subtitles';
export type RepeatedGroup={first:number;last:number;ids:string[]};
const comparable=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\s]+/gu,'');
export function repeatedGroups(cues:SubtitleCue[],maxGapMs=250):RepeatedGroup[]{
 const groups:RepeatedGroup[]=[];
 for(let first=0;first<cues.length;){
  const key=comparable(cues[first].text);let last=first;
  while(key&&last+1<cues.length){const a=cues[last],b=cues[last+1];if(comparable(b.text)!==key||b.startMs<a.startMs||b.endMs<a.endMs||b.startMs-a.endMs>maxGapMs)break;last++;}
  if(last>first)groups.push({first,last,ids:cues.slice(first,last+1).map(c=>c.id)});
  first=last+1;
 }return groups;
}
export function mergeRepeatedGroup(cues:SubtitleCue[],ids:string[],maxGapMs=250):SubtitleCue[]{
 const group=repeatedGroups(cues,maxGapMs).find(g=>g.ids.length===ids.length&&g.ids.every((id,i)=>id===ids[i]));
 if(!group)return cues;
 const merged={...cues[group.first],endMs:cues[group.last].endMs};
 return [...cues.slice(0,group.first),merged,...cues.slice(group.last+1)];
}
