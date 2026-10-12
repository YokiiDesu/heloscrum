import test from 'node:test';
import assert from 'node:assert/strict';
import {plainText,cellWidth,wrapText,transcriptRows,screenFrame,inlineSpans,framePatch,scrollStep,TUI_COLORS,TUI_LIGHT_COLORS,tuiForeground} from '../dist/tui-model.js';

const events=[
 {id:'u',type:'message',role:'user',text:'Check `expiresAt === now`.'},
 {id:'a',type:'message',role:'assistant',text:'## Verification\n\nFreeze the clock.\n```ts\nconst expired = session.expiresAt <= now;\n```',agentState:{state:'focused'}},
 {id:'c',type:'tool',name:'Run tests',input:'npm test -- session',output:'Passed boundary case',status:'completed'},
 {id:'m',type:'tool',name:'chat_qa',input:'Please review the boundary case.',output:'Message queued',status:'running'}
];

test('TUI renders the canonical Chat events, with optional tool details and no event mutation',()=>{
 const copy=structuredClone(events),expanded=new Set(['c']);const rows=transcriptRows(events,80,expanded),text=rows.map(r=>r.text).join('\n');
 assert.match(text,/Check expiresAt === now/);assert.match(text,/const expired = session.expiresAt <= now/);assert.match(text,/↳ focused/);assert.match(text,/npm test -- session/);assert.match(text,/Passed boundary case/);assert.match(text,/chat_qa Please review the boundary case/);assert(!text.includes('Message queued'));
 assert.deepEqual(events,copy);assert.equal(rows.filter(r=>r.toolHeader).length,2);
});

test('fixed-size TUI frames redraw progress without appending messages or heartbeat text',()=>{
 const input={cols:52,rows:12,task:{role:'QA',status:'working'},events,expanded:new Set(['c'])};
 const first=screenFrame(input),same=screenFrame(input),done=screenFrame({...input,task:{role:'QA',status:'done'}});
 assert.equal(first.ansi,same.ansi);assert.equal(first.lines.length,12);assert(first.lines.every(line=>cellWidth(line)<=52));assert.match(first.lines.at(-1),/chat_qa.*esc to interrupt/);assert(!done.lines.join('\n').includes('esc to interrupt'));assert.deepEqual(first.history,done.history);assert(!first.ansi.includes('\n'));assert(!first.ansi.includes('heartbeat'));
});

test('CLI-style turns use user bands, colored response bullets, Markdown, and compact tool activity',()=>{
 const events=[{id:'u',type:'message',role:'user',text:'Take a look around'},{id:'a',type:'message',role:'assistant',text:'I will **review** `package.json` and [the guide](https://example.com/guide).'},
  {id:'r',type:'tool',name:'Read',input:'{"file_path":"/workspace/project/package.json"}',output:'file contents',status:'completed'}];
 const rows=transcriptRows(events,90),user=rows.find(r=>r.eventId==='u'&&r.text),answer=rows.find(r=>r.eventId==='a'&&r.text),tool=rows.find(r=>r.toolHeader);
 assert.equal(user.background,'user');assert(!user.text.includes('You'));assert.equal(answer.spans[0].text,'● ');assert.equal(answer.spans[0].tone,'purple');assert(answer.spans.some(s=>s.text==='review'&&s.bold));assert(answer.spans.some(s=>s.text==='package.json'&&s.tone==='blue'));
 assert.equal(tool.spans[0].tone,'green');assert.match(tool.text,/Read \/workspace\/project\/package.json/);assert(!rows.some(r=>r.text.includes('file contents')));
 const all=inlineSpans('Use `npm test` and **check** [docs](https://example.com).').map(s=>s.text).join('');assert.equal(all,'Use npm test and check docs (https://example.com).');
 const frame=screenFrame({cols:90,rows:15,events});assert(frame.ansi.includes('\x1b[48;2;35;37;38m'));assert(!frame.lines.join('\n').includes('FOLLOW'));assert(!frame.lines.join('\n').includes('Credits:'));
});

test('history scrolling, follow mode and resizing retain the complete underlying conversation',()=>{
 const long=[{id:'long',type:'message',role:'assistant',text:Array.from({length:80},(_,i)=>'Line '+i).join('\n')}];
 const top=screenFrame({cols:45,rows:10,events:long,follow:false,top:0}),bottom=screenFrame({cols:45,rows:10,events:long,follow:true});assert.equal(top.top,0);assert(bottom.top>0);assert.match(top.lines.join('\n'),/Line 0/);assert.match(bottom.lines.join('\n'),/Line 79/);
 const resized=screenFrame({cols:28,rows:6,events:long,follow:false,top:12});assert.equal(resized.top,12);assert(resized.lines.every(line=>cellWidth(line)<=28));assert.equal(resized.history.length,top.history.length);
});

test('small TUI screens retain message content without drawing beyond the viewport',()=>{
 const events=[{id:'last',type:'message',role:'assistant',text:'Latest reply'}];
 for(const rows of [1,2,3,4,5]){
  const frame=screenFrame({cols:30,rows,events});
  assert.equal(frame.lines.length,rows);assert.match(frame.lines.join('\n'),/Latest reply/);
  assert(!frame.ansi.includes(`\x1b[${rows+1};1H`));
 }
});

test('transcript content cannot emit terminal controls and Unicode wraps by display cells',()=>{
 const text='safe\x1b[2J\x1b]52;c;c2VjcmV0\x07\x1b[31mtext\x1b[0m';assert.equal(plainText(text),'safetext');assert(!plainText(text).includes('\x1b'));
 const unicode='QA 👩‍💻 verifies 漢字 and e\u0301.';assert(wrapText(unicode,8).every(line=>cellWidth(line)<=8));assert.equal(wrapText(unicode,8).join(''),unicode);
 const frame=screenFrame({cols:20,rows:6,events:[{id:'x',type:'message',role:'user',text}],follow:true});assert(!frame.ansi.includes(']52;'));assert(frame.lines.every(line=>cellWidth(line)<=20));
});

test('live tools and Working indicators animate without changing the canonical history',()=>{
 const input={cols:64,rows:12,events,task:{status:'working'}};
 const first=screenFrame({...input,motion:{enabled:true,tick:0}}),next=screenFrame({...input,motion:{enabled:true,tick:4}});
 assert.notEqual(first.ansi,next.ansi);assert.deepEqual(first.history,next.history);
 assert.equal(first.lines.length,next.lines.length);assert(!next.ansi.includes('\n'));
 assert.notEqual(first.status.text,next.status.text);
 const completedIndex=first.lines.findIndex(line=>line.includes('Run tests'));
 assert.equal(first.painted[completedIndex],next.painted[completedIndex]);
 const working=screenFrame({...input,events:[],motion:{enabled:true,tick:0}});
 assert.match(working.status.text,/Working\./);
 for(const status of ['done','blocked','idle','offline']){
  const a=screenFrame({...input,task:{status},motion:{enabled:true,tick:0}}),b=screenFrame({...input,task:{status},motion:{enabled:true,tick:4}});
  assert.equal(a.ansi,b.ansi,`${status} must not look like active execution`);
 }
 const still=screenFrame({...input,motion:{enabled:false,tick:0}}),later=screenFrame({...input,motion:{enabled:false,tick:9}});
 assert.equal(still.ansi,later.ansi);
});

test('only the current response marker animates; updated content never flashes backgrounds',()=>{
 const conversation=[...events,{id:'new-user',type:'message',role:'user',text:'Next task'},{id:'reply',type:'message',role:'assistant',text:'Starting the next task.'}];
 const input={cols:70,rows:20,events:conversation,task:{status:'working'}};
 const first=screenFrame({...input,motion:{enabled:true,tick:0}}),next=screenFrame({...input,motion:{enabled:true,tick:4}});
 const oldTool=first.lines.findIndex(line=>line.includes('chat_qa'));
 assert.equal(first.painted[oldTool],next.painted[oldTool]);
 const reply=first.lines.findIndex(line=>line.includes('Starting the next'));
 assert.notEqual(first.painted[reply],next.painted[reply]);
 const settled=screenFrame({...input,task:{status:'done'},motion:{enabled:true,tick:0}});
 const arrival=screenFrame({...input,task:{status:'done'},motion:{enabled:true,tick:0,fresh:new Map([['reply',1]])}});
 assert.equal(arrival.painted[reply],settled.painted[reply]);assert.deepEqual(arrival.lines,settled.lines);
});

test('solid rails connect adjacent commands, preserve detail rails and stop at turn boundaries',()=>{
 const conversation=[{id:'a',type:'message',role:'assistant',text:'Checking the files.',turnId:'one'},
  {id:'one',type:'tool',name:'Read',input:'/a/very/long/path/to/the/first/file',output:'First\nSecond',status:'completed',turnId:'one'},
  {id:'two',type:'tool',name:'Bash',input:'npm test',status:'running',turnId:'one'},
  {id:'three',type:'tool',name:'Read',input:'new task',turnId:'two'},
  {id:'u',type:'message',role:'user',text:'Thanks'}];
 const rows=transcriptRows(conversation,24,new Set(['one']));
 assert(rows.some(row=>row.eventId==='a'&&row.text==='│'));
 assert(rows.some(row=>row.eventId==='one'&&row.text==='│'));
 assert(rows.filter(row=>row.eventId==='one'&&row.kind==='tool-detail').every(row=>row.text.startsWith('│')));
 assert.equal(rows.filter(row=>row.toolHeader).length,3,'wrapped headers remain a single keyboard target');
 assert(!rows.some(row=>row.eventId==='two'&&row.kind==='connector'));
 assert(rows.some(row=>row.kind==='divider'&&row.text==='─'.repeat(24)));
 assert(rows.every(row=>cellWidth(row.text)<=24));
});

test('animation patches repaint only changed rows and keep terminal dimensions fixed',()=>{
 const input={cols:50,rows:12,events,task:{status:'working'}};
 const first=screenFrame({...input,motion:{enabled:true,tick:0}}),next=screenFrame({...input,motion:{enabled:true,tick:4}});
 assert.equal(framePatch(first,first),'');const patch=framePatch(next,first);
 assert(patch.length<next.ansi.length/2);assert(!patch.includes('Check `expiresAt'));
 assert(!patch.includes('\n'));assert(!patch.includes('\x1b[13;1H'));
});

test('fractional scrolling uses overscan without losing the last row or moving history',()=>{
 const events=[{id:'a',type:'message',role:'assistant',text:Array.from({length:40},(_,i)=>`Line ${i}`).join('\n')}];
 const input={cols:40,rows:12,visibleRows:10,footer:false,events,follow:false};
 const a=screenFrame({...input,position:3.1}),b=screenFrame({...input,position:3.9}),last=screenFrame({...input,position:999});
 assert.equal(a.ansi,b.ansi,'sub-row movement is composited, not repainted');assert.equal(a.top,3);assert.equal(a.bodyRows,10);assert.equal(a.maxTop,30);
 assert.equal(last.top,30);assert.match(last.lines[9],/Line 39/);assert.equal(last.lines[10].trim(),'');
});

test('smooth scrolling is refresh-rate independent, reversible, and honors reduced motion',()=>{
 const advance=hz=>{let top=0;for(let i=0;i<hz/5;i++)top=scrollStep(top,30,1000/hz);return top;};
 assert(Math.abs(advance(60)-advance(120))<1e-9);assert(advance(60)>29&&advance(60)<30);
 const next=scrollStep(20,0,8);assert(next<20&&next>0);
 assert.equal(scrollStep(0,30,16,true),30);assert.equal(scrollStep(29.999,30,16),30);
});


test('interrupt hint occupies the same cells throughout the ellipsis cycle',()=>{
 const offsets=new Set();
 for(let tick=0;tick<40;tick++){
  const frame=screenFrame({cols:80,rows:8,events:[],task:{status:'working'},motion:{enabled:true,tick}});
  offsets.add(frame.status.text.indexOf('(esc to interrupt)'));
 }
 assert.equal(offsets.size,1);
});

test('DM bodies render Markdown inside compact rails without routing IDs or user bands',()=>{
 const event={id:'dm',type:'message',role:'user',text:'## Results\n**Verified** `npm test`\n```js\nconst ok = true;\n```',communication:{kind:'dm',fromRole:'QA',toRole:'Reviewer'}};
 for(const width of [24,80]){
  const rows=transcriptRows([event],width),text=rows.map(r=>r.text).join('\n');
  assert.match(text,/QA messaged Reviewer/);assert.match(text,/Verified npm test/);assert(!text.includes('**'));assert(!text.includes('```'));
  assert(rows.some(r=>r.kind==='code'));assert(rows.some(r=>r.spans.some(s=>s.text.includes('Verified')&&s.bold)));
  assert(!rows.some(r=>r.background==='user'));assert(rows.every(r=>cellWidth(r.text)<=width));
 }
 const user=transcriptRows([{id:'user',type:'message',role:'user',text:'Please **check** `src/main.js`.'}],80);
 assert(user[0].spans.some(s=>s.text==='check'&&s.bold));assert(!user[0].text.includes('`'));
});

test('operational-state lines retain their original background during every animation tick',()=>{
 const events=[{id:'state',type:'state',report:{state:'focused',reason:'One verification left',nextStep:'Run tests'}},{id:'answer',type:'message',role:'assistant',text:'Checking',agentState:{state:'focused'}}];
 const base={cols:70,rows:12,events,task:{status:'working'}};
 const a=screenFrame({...base,motion:{enabled:true,tick:0,fresh:new Map([['state',1],['answer',1]])}}),b=screenFrame({...base,motion:{enabled:true,tick:4}});
 for(const index of a.history.flatMap((r,i)=>r.kind==='state'?[i]:[]))assert.equal(a.painted[index],b.painted[index]);
});


test('theme changes repaint cached history and preserve text, diff cues and readable accents',()=>{
 const events=[{id:'edit',type:'tool',name:'File changes',status:'completed',input:'example.js',output:'@@ -1 +1 @@\n-old\n+new'}];
 const preparedHistory=transcriptRows(events,60,new Set(['edit']));
 const input={cols:60,rows:16,preparedHistory,loaded:true};
 const dark=screenFrame(input),light=screenFrame({...input,colors:TUI_LIGHT_COLORS}),restored=screenFrame(input);
 assert.deepEqual(light.lines,dark.lines);assert.deepEqual(restored.painted,dark.painted);
 assert.notDeepEqual(light.painted,dark.painted);assert(framePatch(light,dark));
 const rgb=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16)).join(';');
 for(const key of ['background','diffAddBackground','diffRemoveBackground'])assert(light.ansi.includes('\x1b[48;2;'+rgb(TUI_LIGHT_COLORS[key])+'m'));
 assert.equal(tuiForeground({tone:'error'},TUI_LIGHT_COLORS),TUI_LIGHT_COLORS.error);
 assert.equal(tuiForeground({color:'#a0ffe0'},TUI_COLORS),'#a0ffe0');
 assert.notEqual(tuiForeground({color:'#a0ffe0'},TUI_LIGHT_COLORS),'#a0ffe0','Pastel identity and motion accents darken on a light surface');
});
