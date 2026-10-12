import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {activityTestReport,activityModel,activityChange,activityCard} from '../dist/activity-card.js';

test('visual test results parse actual nested Node TAP without counting parent suites twice',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hs-mod-tap-'));
  try{
    const file=path.join(root,'cases.mjs');
    await writeFile(file,`import {test,describe} from 'node:test';import assert from 'node:assert/strict';describe('activity renderer',()=>{test('reads a real file name',()=>assert.equal('README.md'.split('.').pop(),'md'));test.skip('optional integration',()=>{});test('intentional failure',()=>assert.equal(1,2,'difference should remain visible'));});`);
    const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
    let output;try{output=execFileSync(process.execPath,['--test','--test-reporter=tap',file],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:childEnv});}catch(error){output=error.stdout;}
    const report=activityTestReport(output);
    assert.equal(report.total,3);assert.equal(report.passed,1);assert.equal(report.failed,1);assert.equal(report.skipped,1);
    assert.equal(report.cases.length,3);assert.equal(report.partial,false);assert(!report.cases.some(c=>c.name==='activity renderer'));
    const failed=report.cases.find(c=>c.status==='failed');assert.match(failed.error,/difference should remain visible/);
    assert(Number.isFinite(failed.durationMs));
    const html=activityCard({kind:'tool',id:'tap',name:'Bash',input:JSON.stringify({command:'node --test cases.mjs'}),output,status:'failed'});
    assert.match(html,/Some checks need attention/);assert(html.indexOf('intentional failure')<html.indexOf('reads a real file name'));
    assert.match(html,/data-event="tap:details"/);assert(!html.includes('<details open'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('partial, duplicated and unsupported test output never invents a passing suite',()=>{
  const footer='# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n';
  assert.equal(activityTestReport('All tests passed!'),null);
  assert.equal(activityTestReport(footer+footer),null);
  assert.equal(activityTestReport(footer.replace('# pass 1','# pass 2')),null);
  assert.equal(activityTestReport(footer).partial,true);
  const mismatch=activityTestReport('ok 1 - one\nok 2 - two\n'+footer);assert.deepEqual(mismatch.cases,[]);
  assert.equal(activityModel({name:'Bash',input:'{"command":"node --test","description":"Check code"}',status:'completed',output:'exit 0'}).tests,null);
  assert(!activityCard({kind:'tool',name:'Bash',input:'{"command":"node --test"}',status:'completed',output:'exit 0'}).includes('All checks passed'));
});

test('edit previews retain changed lines and label proposed, failed and replace-all edits honestly',()=>{
  const input={file_path:'/project/src/report.js',old_string:'header\nold\nfooter\n',new_string:'header\nnew\nanother\nfooter\n',replace_all:true};
  const change=activityChange(input);assert.equal(change.removed,1);assert.equal(change.added,2);assert.equal(change.replaceAll,true);
  assert.deepEqual(change.rows.map(r=>r.kind),['context','remove','add','add','context']);
  const event={kind:'tool',id:'edit',name:'Edit',input:JSON.stringify(input),status:'failed'};
  assert.match(activityCard(event),/did not report success/);assert(!activityCard(event).includes('Change applied'));
  assert.match(activityCard({...event,status:'running'}),/Proposed change/);
  assert.match(activityCard({...event,status:'completed'}),/Change applied/);
  assert.match(activityCard(event),/one match/);
  const write=activityChange({content:'one\ntwo\n'});assert.equal(write.count,2);assert.equal(write.mode,'write');assert.equal(write.added,undefined);
});

test('tool input, filenames, test names and file content remain escaped in rich cards',()=>{
  const attack='<img src=x onerror=alert(1)>',event={kind:'tool',id:'" onclick="bad',name:'Write',status:'completed',input:JSON.stringify({file_path:attack,content:attack}),output:'<script>alert(1)</script>'};
  const html=activityCard(event);assert(!html.includes('<img'));assert(!html.includes('<script>'));assert(!html.includes(' onclick="bad'));assert.match(html,/&lt;img/);
  assert.doesNotThrow(()=>activityCard({...event,input:'{"file_path": [truncated'}));
});

test('missing context stays unknown and a reported zero remains a legitimate reading',()=>{
  const unknown=activityCard({kind:'context',context:{window:1000000}});assert.match(unknown,/Waiting for usage/);assert(!unknown.includes('0% available'));
  const zero=activityCard({kind:'context',context:{window:200000,tokens:0,percent:0}});assert.match(zero,/100%/);assert.match(zero,/Room to keep working/);
  const high=activityCard({kind:'context',context:{window:200000,tokens:180000,percent:90}});assert.match(high,/nearly full/);assert.match(high,/10%/);
});
