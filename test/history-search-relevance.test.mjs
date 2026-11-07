import test from 'node:test';
import assert from 'node:assert/strict';
import {historyRankingText,historyText,historySourceOrder} from '../lib/memory-retrieval.mjs';
import {HistoryReranking,historyRerankPool} from '../lib/history-reranking.mjs';

test('ranking masks explicit retrieval queries without rewriting sources or losing offsets',()=>{
  const question='Why did the 雪 simulation report "unstable" 🦋?';
  const cases=[
    'memory_search with query '+JSON.stringify(question)+'. Search failed; measurements still matter.',
    'History search query `'+question+'` returned three request messages.',
    'retrieval query “'+question+'” returned no source.',
    'memory_search\n'+JSON.stringify({query:question,scope:'history'}),
    'send_message\n'+JSON.stringify({text:'Run memory_search with query '+JSON.stringify(question)+'. Report the result.'}),
  ];
  for(const text of cases){
    const row={kind:'message',body:{text}},before=structuredClone(row),ranked=historyRankingText(row);
    assert.equal(ranked.length,text.length);assert(!ranked.includes('simulation'));assert(!ranked.includes('unstable'));assert.deepEqual(row,before);
    assert.equal(historyText(row),text);assert.equal(ranked.indexOf('Report the result.'),text.indexOf('Report the result.'));
  }
  const prose='The SQL query "select measured_value" found a later peak. No cause established.';
  assert.equal(historyRankingText({kind:'message',body:{text:prose}}),prose);
  const report='History search failed. Later measured peaks disproved the earlier explanation.';
  assert.equal(historyRankingText({kind:'message',body:{text:report}}),report);
});

test('search tool echoes are masked while receipts and ordinary tool output remain searchable',()=>{
  const row={kind:'transcript',body:{event:{name:'mcp__heloscrum__memory_search',input:JSON.stringify({query:'find the noisy question',scope:'history'}),output:JSON.stringify({matches:[{text:'copied answer 雪',source:{entryId:'42'}}],ranking:{status:'embedded',calls:2}})}}};
  const original=historyText(row),ranked=historyRankingText(row);
  assert.equal(ranked.length,original.length);assert(!ranked.includes('copied answer'));assert(!ranked.includes('noisy question'));assert(ranked.includes('embedded'));assert(ranked.includes('42'));
  const ordinary=structuredClone(row);ordinary.body.event.name='compile';ordinary.body.event.input='';ordinary.body.event.output=JSON.stringify({text:'Compiler failed in memory_search: query "x"'});
  assert(historyRankingText(ordinary).includes('Compiler failed'));
});

test('source selection gives other records and kinds space before repeated versions and windows',()=>{
  const rows=[...Array.from({length:30},(_,i)=>({source:{kind:'history',recordKind:'work-plan',recordId:'plan',version:i},offset:0,end:10,text:'plan '+i,similarity:1})),...Array.from({length:20},(_,i)=>({source:{kind:'history',recordKind:'transcript',recordId:'trace-'+i},offset:0,end:10,text:'trace '+i,similarity:.8})),{source:{kind:'history',recordKind:'message',recordId:'correction'},offset:0,end:10,text:'evidence',similarity:.4}];
  const ordered=historySourceOrder(rows);
  assert.deepEqual(ordered.slice(0,3).map(r=>r.source.recordKind),['work-plan','transcript','message']);
  const pool=historyRerankPool('Why was it revised?',rows).pool;
  assert(pool.some(r=>r.source.recordId==='correction'));assert(pool.some(r=>r.source.recordKind==='work-plan'));assert(pool.some(r=>r.source.recordKind==='transcript'));
});

test('identical winning passages from different versions cannot occupy the result cutoff',async()=>{
  const row=(id,version,text,score)=>({source:{kind:'history',recordKind:'work-plan',recordId:id,version},offset:0,end:text.length,text,similarity:score});
  const rows=[row('plan',1,'Earlier hypothesis',.95),row('plan',2,'Earlier hypothesis',.94),row('plan',3,'Earlier hypothesis',.93),row('other',1,'Independent finding',.9),row('correction',1,'Measured correction',.8)];
  const plane={ai:{rerank:async(_id,_q,docs)=>({scores:docs.map(t=>t==='Earlier hypothesis'?.95:t==='Independent finding'?.9:.8),usage:{total_tokens:10}})},context:{measuredCall:async(_t,_k,_c,fn)=>fn()}};
  const result=await new HistoryReranking(plane).rank({id:'agent',project:'project'},{id:'voyage',revision:1},'What changed?',rows,{matches:rows.slice(0,3),more:true},3);
  assert.deepEqual(result.matches.map(r=>r.text),['Earlier hypothesis','Independent finding','Measured correction']);assert.equal(result.reranking.duplicatePassages,2);
  assert.equal(result.matches[0].source.version,1);
});
