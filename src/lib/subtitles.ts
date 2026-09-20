export async function decodeSubtitle(bytes: Uint8Array, path: string): Promise<string> {
  if (/\.zip$/i.test(path)) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const entry = Object.values(zip.files).find(file => !file.dir && /\.(srt|vtt|ass|ssa)$/i.test(file.name));
    if (!entry) throw new Error('ZIP contains no supported subtitles.');
    bytes = await entry.async('uint8array');
    if(bytes.length > 32*1024*1024) throw new Error('Subtitle exceeds 32 MB.');
  }
  if(bytes[0]===255 && bytes[1]===254) return new TextDecoder('utf-16le').decode(bytes);
  if(bytes[0]===254 && bytes[1]===255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { const { detect } = await import('jschardet'); const sample=Array.from(bytes.subarray(0,24000),byte=>String.fromCharCode(byte)).join(''); return new TextDecoder(detect(sample).encoding || 'windows-1252').decode(bytes); }
}

export type SubtitleCue = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
};

function parseTime(value: string) {
  if (!/^\d{1,3}:\d{2}(?::\d{2})?[,.]\d{1,3}$/.test(value.trim())) return null;
  const normalized = value.trim().replace(',', '.');
  const [clock, millis = '0'] = normalized.split('.');
  const pieces = clock.split(':').map(Number);
  while (pieces.length < 3) pieces.unshift(0);
  if (pieces.some(Number.isNaN)) return null;
  const [hours, minutes, seconds] = pieces;
  return ((hours * 60 * 60 + minutes * 60 + seconds) * 1000) + Number(millis.padEnd(3, '0').slice(0, 3));
}

export function formatTime(ms: number) {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const millis = clamped % 1_000;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':') + `,${String(millis).padStart(3, '0')}`;
}

export function parseEditableTime(value: string) {
  return parseTime(value);
}

export function parseSubtitleText(source: string): SubtitleCue[] {
  if (/^\s*Dialogue\s*:/im.test(source)) return parseAss(source);
  const cleaned = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^WEBVTT[^\n]*\n*/i, '').trim();
  if (!cleaned) return [];

  return cleaned
    .split(/\n{2,}/)
    .map((block, index) => {
      const lines = block.split('\n').map((line) => line.trimEnd());
      const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
      if (timeLineIndex < 0) return null;
      const [rawStart, rawEnd] = lines[timeLineIndex].split(/\s+-->\s+/);
      if (!rawStart || !rawEnd) return null;
      const startMs = parseTime(rawStart);
      const endMs = parseTime(rawEnd.split(/\s+/)[0]);
      const text = lines.slice(timeLineIndex + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (startMs === null || endMs === null || endMs <= startMs || !text) return null;
      return { id: `import-${index}-${startMs}`, startMs, endMs, text };
    })
    .filter((cue): cue is SubtitleCue => cue !== null);
}

export function toSrt(cues: SubtitleCue[]) {
  return cues
    .slice()
    .map((cue, index) => `${index + 1}\n${formatTime(cue.startMs)} --> ${formatTime(cue.endMs)}\n${cue.text.trim()}`)
    .join('\n\n') + (cues.length ? '\n' : '');
}

export function activeCue(cues: SubtitleCue[], timeMs: number) {
  return cues.find((cue) => timeMs >= cue.startMs && timeMs < cue.endMs) ?? null;
}

function parseAss(source: string): SubtitleCue[] {
  let events = false;
  let fields = ['layer','start','end','style','name','marginl','marginr','marginv','effect','text'];
  const cues: SubtitleCue[] = [];
  for (const line of source.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) { events = /^\s*\[Events\]/i.test(line); continue; }
    if (!events) continue;
    if (/^\s*Format:/i.test(line)) { fields = line.replace(/^\s*Format:\s*/i,'').toLowerCase().split(',').map(s=>s.trim()); continue; }
    if (!/^\s*Dialogue:/i.test(line)) continue;
    const parts = line.replace(/^\s*Dialogue:\s*/i,'').split(',');
    const textIndex = fields.indexOf('text');
    if(textIndex<0) continue;
    const startMs = parseTime(parts[fields.indexOf('start')] ?? '');
    const endMs = parseTime(parts[fields.indexOf('end')] ?? '');
    const text = parts.slice(textIndex).join(',').replace(/\{[^}]*\}/g,'').replace(/\\[Nn]/g,'\n').replace(/\\h/g,' ').trim();
    if(startMs!==null && endMs!==null && endMs>startMs && text) cues.push({id:`ass-${cues.length}`,startMs,endMs,text});
  }
  return cues;
}
