import test from 'node:test';
import assert from 'node:assert/strict';
import {resourcePreview,FilePreviewHistory} from '../dist/resource-preview.js';

test('Markdown snapshots retain all source and UTF-16 text decodes correctly',async()=>{
  const source='# Plan\n\n| Work | Owner |\n| --- | --- |\n| Build | A |\n\n- [x] Reviewed\n';
  assert.deepEqual(await resourcePreview(new Blob([source]),'PLAN.md'),{kind:'markdown',text:source});
  assert.deepEqual(await resourcePreview(new Blob([Buffer.from([255,254]),Buffer.from('Hello','utf16le')]),'notes.txt'),{kind:'text',text:'Hello'});
});
test('HTML is shown as text and binary files never become an executable document',async()=>{
  const source='<script>alert(1)</script>';
  assert.deepEqual(await resourcePreview(new Blob([source]),'index.html'),{kind:'text',text:source});
  for(const bytes of [Buffer.from([0,1,2]),Buffer.from([255,255])])assert.equal((await resourcePreview(new Blob([bytes]),'data.txt')).kind,'unavailable');
});
test('Image MIME types come from byte signatures rather than filename or supplied MIME',async()=>{
  const image=await resourcePreview(new Blob([Buffer.from([137,80,78,71,13,10,26,10])],{type:'text/html'}),'image.txt');
  assert.equal(image.kind,'image');assert.equal(image.blob.type,'image/png');
  assert.equal((await resourcePreview(new Blob(['<html>not a picture</html>']),'image.png')).kind,'text');
  assert.equal((await resourcePreview(new Blob(['<svg onload="evil()"></svg>']),'image.svg')).kind,'text');
});
test('Oversized text gives a complete-download fallback rather than silently truncating',async()=>{
  const result=await resourcePreview(new Blob(['a'.repeat(2*1024*1024+1)]),'large.md');
  assert.equal(result.kind,'unavailable');assert.match(result.reason,/complete file/);
});

test('file navigation returns to each visited document with its own mode and scroll position',()=>{
  const history=new FilePreviewHistory();
  assert.equal(history.move(-1),null);assert.equal(history.move(1),null);
  const handoff=history.open({reference:{path:'HANDOFF.md'},view:{source:false,positions:{formatted:{top:680}}}});
  const contract=history.open({reference:{path:'CONTRACT.md'},view:{source:true,positions:{source:{top:120,codeLeft:40}}}});
  assert.equal(history.canForward,false);assert.equal(history.canBack,true);
  assert.equal(history.move(-1),handoff);assert.deepEqual(history.current.view,{source:false,positions:{formatted:{top:680}}});
  assert.equal(history.canBack,false);assert.equal(history.canForward,true);
  assert.equal(history.move(1),contract);assert.equal(history.current.view.source,true);assert.equal(history.current.view.positions.source.codeLeft,40);
});
test('following a new file after Back replaces the forward branch, including a failed file visit',()=>{
  const history=new FilePreviewHistory();history.open({path:'HANDOFF.md'});history.open({path:'CONTRACT.md'});history.move(-1);
  history.open({path:'missing.md'});assert.equal(history.canForward,false);assert.equal(history.move(1),null);
  assert.equal(history.move(-1).path,'HANDOFF.md');assert.equal(history.move(1).path,'missing.md');
  assert.deepEqual(history.entries.map(entry=>entry.path),['HANDOFF.md','missing.md']);
});


test('PDF byte signatures route to the PDF viewer regardless of filename or supplied MIME',async()=>{
  const bytes='%PDF-1.7\n%fixture';
  const result=await resourcePreview(new Blob([bytes],{type:'text/html'}),'misnamed.txt');
  assert.equal(result.kind,'pdf');assert.equal(result.blob.type,'application/pdf');assert.equal(await result.blob.text(),bytes);
  assert.deepEqual(await resourcePreview(new Blob(['<script>unsafe()</script>']),'fake.pdf'),{kind:'text',text:'<script>unsafe()</script>'});
});
test('Word archives require a DOCX extension and ZIP bytes, leaving other binary formats as downloads',async()=>{
  const bytes=Uint8Array.from([80,75,3,4,0,1,2,3]);
  const result=await resourcePreview(new Blob([bytes]),'BRIEF.DOCX');
  assert.equal(result.kind,'docx');assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),bytes);
  assert.equal((await resourcePreview(new Blob([bytes]),'archive.zip')).kind,'unavailable');
  assert.equal((await resourcePreview(new Blob(['not a zip']),'fake.docx')).kind,'text');
});
test('standalone Mermaid preserves exact source for diagram and source views',async()=>{
  const source='flowchart LR\n  A[Draft] --> B[Review]\n';
  for(const name of ['workflow.mmd','workflow.MERMAID'])assert.deepEqual(await resourcePreview(new Blob([source]),name),{kind:'mermaid',text:source});
  assert.equal((await resourcePreview(new Blob([source]),'workflow.txt')).kind,'text');
  assert.equal((await resourcePreview(new Blob(['a'.repeat(2*1024*1024+1)]),'large.mmd')).kind,'unavailable');
});
