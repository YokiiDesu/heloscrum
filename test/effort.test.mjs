import test from 'node:test';
import assert from 'node:assert/strict';
import {effortOptions,cliEffortLevels} from '../lib/effort.mjs';
test('effort options follow provider and model capabilities, not a universal scale',()=>{
 const codex={id:'codex',models:[{id:'sol',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'ultra'}]}]},claude={id:'claude',effortLevels:['low','medium','high','xhigh','max']};
 const levels=(p,m)=>effortOptions(p,m).map(o=>o.reasoningEffort);
 assert.deepEqual(levels(codex,''),[]);assert.deepEqual(levels(codex,'sol'),['low','ultra']);assert.deepEqual(levels(codex,'unknown'),[]);
 assert.deepEqual(levels(claude,'claude-opus-5'),['low','medium','high','xhigh','max']);
 assert.deepEqual(levels(claude,'claude-sonnet-4-6'),['low','medium','high','max']);
 assert.deepEqual(levels(claude,'haiku'),[]);assert.deepEqual(levels(claude,'private-model'),[]);
 assert.deepEqual(levels({...claude,effortLevels:null},'opus'),[]);
});

test('Claude effort discovery reads only the installed CLI effort option',()=>{
 assert.deepEqual(cliEffortLevels('--model <model> High capability models\n  --effort <level> Session effort (low, medium, high, max)\n  --other <value> xhigh is not an effort here'),['low','medium','high','max']);
 assert.deepEqual(cliEffortLevels('--effort <level> Session effort\n    (low, medium, high, xhigh, max)\n  --model <id> Model'),['low','medium','high','xhigh','max']);
 assert.deepEqual(cliEffortLevels('--model <id> high'),[]);
});
