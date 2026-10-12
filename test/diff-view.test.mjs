import test from 'node:test';
import assert from 'node:assert/strict';
import {diffLines,diffHTML,fileStatus,changedFileHTML} from '../dist/diff-view.js';
import {transcriptRows,screenFrame,TUI_COLORS} from '../dist/tui-model.js';
import {parseStatus} from '../lib/adapters.mjs';

test('shared diff rendering handles complete additions, removals, and unified patches',()=>{
  for(const [marker,kind] of [['+','add'],['-','remove']]){
    const source=[marker+'import http from "node:http";',marker,marker+'<script>unsafe()</script>'].join('\n');
    assert.deepEqual(diffLines(source,{diff:true}).map(l=>l.kind),[kind,kind,kind]);
    const html=diffHTML(source,{diff:true});
    assert(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
    assert.equal((html.match(new RegExp('diff-'+kind,'g'))||[]).length,3);
  }
  const source='diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1,2 +1,2 @@\n-old\n+new\n context\n';
  assert.deepEqual(diffLines(source).map(l=>l.kind),['meta','meta','meta','hunk','remove','add','context','context']);
  assert.deepEqual(diffLines(source).map(l=>l.text).join('\n'),source);
  assert.deepEqual(diffLines('+++ literal file content\n+--- not a header',{contentOnly:true}).map(l=>l.kind),['add','add']);
});

test('provider requests highlight numbered previews and bounded patches without changing their text',()=>{
  const source='Write src/app.js\n  added 2 lines, removed 1 line\n  6  unchanged\n  7- old\n  7+ new\n  8+ added\nAllow once?\n- An ordinary bullet\n2026-10-06';
  const lines=diffLines(source);
  assert.deepEqual(lines.map(l=>l.kind),['context','context','context','remove','add','add','context','context','context']);
  assert.equal(lines.map(l=>l.text).join('\n'),source);
  const patch='  @@ -1 +1 @@\n  -before\n  +after\n- A permission option';
  assert.deepEqual(diffLines(patch).map(l=>l.kind),['hunk','remove','add','context']);
  const apply='*** Begin Patch\n*** Add File: new.txt\n+hello\n*** End Patch\n- More prose';
  assert.deepEqual(diffLines(apply).map(l=>l.kind),['meta','meta','add','meta','context']);
});

test('Git tabs distinguish tracked, untracked, staged, renamed, deleted and conflicted files',()=>{
  const files=parseStatus('?? new.js\0A  added.js\0 M edited.js\0 D deleted.js\0D  removed.js\0R  renamed.js\0original.js\0C  copied.js\0source.js\0 T type.js\0UU conflict.js\0AM new-edited.js\0MD edited-deleted.js\0');
  assert.deepEqual(files.map(f=>fileStatus(f).code),['A','A','M','D','D','R','C','T','U','A','D']);
  assert.match(fileStatus(files[5]).title,/original.js → renamed.js/);
  assert.match(fileStatus(files[9]).title,/Staged: added · Unstaged: modified/);
  const deleted=changedFileHTML(files[3],'deleted.js');
  assert.match(deleted,/file-deleted/);assert.match(deleted,/aria-label="Deleted">D/);assert.match(deleted,/aria-pressed="true"/);
  const hostile=changedFileHTML({path:'<img onerror="bad">',status:'??'},null);
  assert(!hostile.includes('<img'));assert.match(hostile,/&lt;img/);
});

test('TUI applies diff colors to every wrapped row while keeping rails and safe terminal text',()=>{
  const event={id:'edit',type:'tool',name:'File changes',status:'completed',input:'test/engine.mjs',output:'@@ -1 +1 @@\n-old line with a long explanation\n+new line with a long explanation\x1b[2J'};
  const rows=transcriptRows([event],24,new Set(['edit']));
  for(const [background,tone] of [['diffAddBackground','diffAdd'],['diffRemoveBackground','diffRemove']]){
    const colored=rows.filter(r=>r.background===background);assert(colored.length>=2,'wrapped lines retain their color');
    assert(colored.every(r=>r.text.startsWith('│ ')&&r.spans.some(s=>s.tone===tone)));
  }
  const frame=screenFrame({cols:24,rows:24,events:[event],expanded:new Set(['edit'])});
  const rgb=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(';');
  assert(frame.ansi.includes('\x1b[48;2;'+rgb(TUI_COLORS.diffAddBackground)+'m'));
  assert(frame.ansi.includes('\x1b[48;2;'+rgb(TUI_COLORS.diffRemoveBackground)+'m'));
  assert(!frame.ansi.includes('\x1b[2J'));assert(rows.every(r=>!r.text.includes('\x1b')));
});
