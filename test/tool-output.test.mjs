import test from 'node:test';
import assert from 'node:assert/strict';
import {toolOutputHTML} from '../dist/message-content.js';

const render=output=>toolOutputHTML({id:'result',output:typeof output==='string'?output:JSON.stringify(output)});
test('flat source pages keep code literal and expose range and hash without JSON escaping',()=>{
  const text='<script>never execute</script>\nconst path = "C:\\code";\n',meta={format:'heloscrum-source-page',name:'source.js',sha256:'a'.repeat(64),offset:0,endOffset:text.length,totalCharacters:text.length,nextOffset:null},raw=JSON.stringify(meta)+'\n\n'+text;
  const body=render(raw).split('<details')[0];assert.match(body,/source\.js/);assert.match(body,/SHA-256/);assert.match(body,/&lt;script&gt;/);assert.doesNotMatch(body,/<script>|\\n|Partial source/);assert.equal(render({content:[{type:'text',text:raw}]}).split('<details')[0],body);
});
test('context pages show readable inbox messages with range and exact raw output retained',()=>{
  const message={fromRole:'You',toRole:'Gemini developer',text:'First instruction.\n\nSecond instruction.',at:'2026-11-06T04:32:58Z'};
  const text=JSON.stringify({messages:[message]}),value={reference:'ref',source:'read_inbox',text,offset:0,nextOffset:null,totalCharacters:text.length};
  const html=render(value),body=html.split('<details')[0];
  assert.match(body,/You → Gemini developer/);assert.match(body,/First instruction\.<br><br>Second instruction\./);assert.match(body,/Characters 0–/);assert.doesNotMatch(body,/\\n|Partial saved result/);
  assert.match(html,/Raw output/);assert.match(html,/&quot;reference&quot;:&quot;ref&quot;/);
  assert.equal(render({content:[{type:'text',text:JSON.stringify(value)}]}).split('<details')[0],body);
});
test('mid-record pages decode only supplied text and clearly label incomplete messages',()=>{
  const full=JSON.stringify({messages:[{text:'Earlier instructions.\n\nKeep tests unchanged.',fromRole:'You'},{text:'Continue implementation.\n\nVerify the fix.',fromRole:'Reviewer'}]});
  const start=full.indexOf('Keep tests'),end=full.indexOf('the fix')+3,text=full.slice(start,end);
  const html=render({reference:'ref',source:'read_inbox',text,offset:start,nextOffset:end,totalCharacters:full.length}),body=html.split('<details')[0];
  assert.match(body,/Partial saved result/);assert.match(body,/Partial message/);assert.match(body,/Keep tests unchanged\./);assert.match(body,/Continue implementation\.<br><br>Verify the/);
  assert.doesNotMatch(body,/Earlier instructions|the fix|Reviewer|\\n/);
});
test('structured output remains inert and file paths retain literal backslashes',()=>{
  const text=JSON.stringify({messages:[{fromRole:'<img src=x>',text:'<script>alert(1)</script>\nC:\\new\\test.rs'}]});
  const html=render({reference:'<bad>',source:'read_inbox',text,offset:0,nextOffset:null,totalCharacters:text.length});
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);assert(html.includes('C:\\new\\test.rs'));
  assert.equal(render('not JSON <img>'),'<pre>not JSON &lt;img&gt;</pre>');
  assert.equal(render('{"count":2}'),'<pre>{\n  &quot;count&quot;: 2\n}</pre>');
});
test('unparseable and multiple-block results remain available without dropping data',()=>{
  const broken='{"messages":[{"text":"truncated\\';
  const html=render({reference:'ref',source:'read_inbox',text:broken,offset:0,nextOffset:34,totalCharacters:100});
  assert.match(html,/truncated/);assert.match(html,/Raw output/);
  const multiple=render({content:[{type:'text',text:'one'},{type:'image',data:'two'}]});
  assert.match(multiple,/one/);assert.match(multiple,/two/);
});
