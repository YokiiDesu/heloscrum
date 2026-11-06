const $=id=>document.getElementById(id),names={keyword:'Current keyword search',semantic:'Contextual embeddings',hybrid:'Combined ranking'};
let token='',current=null,shownReport=null,timer=null;
async function api(route,body){const r=await fetch('/api/'+route,body?{method:'POST',headers:{'Content-Type':'application/json','X-Trial-Token':token},body:JSON.stringify(body)}:{});const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed');return result;}
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function showResult(result){
  const host=$('results');host.replaceChildren();
  for(const arm of ['keyword','semantic','hybrid']){
    const column=element('div');column.append(element('h3',names[arm]));
    if(!result[arm].length)column.append(element('p','No keyword match.','empty'));
    for(const item of result[arm]){const card=element('article',undefined,'result');card.append(element('strong',item.path),element('div',`Characters ${item.offset}–${item.end} · SHA ${item.sha256.slice(0,12)}`,'meta'),element('p',item.text));
      if(item.semanticPassage&&item.semanticPassage.offset!==item.offset){const details=element('details');details.append(element('summary','Additional semantic passage'),element('div',`Characters ${item.semanticPassage.offset}–${item.semanticPassage.end}`,'meta'),element('p',item.semanticPassage.text));card.append(details);}
      if(item.similarity!==undefined)card.append(element('div','Similarity '+item.similarity.toFixed(3)+' · not a probability','meta'));column.append(card);
    }host.append(column);
  }
}
function render(state){
  token=state.token;current=state;
  $('scope').textContent=`${state.corpus.documents.length} documents · ${state.corpus.bytes.toLocaleString()} UTF-8 bytes · ${state.corpus.queries} fixed queries · ${state.policy.model}`;
  $('limits').textContent=`At most ${state.policy.maxCalls} requests and ${state.policy.maxInputBytes.toLocaleString()} source/query bytes per run. No automatic retries. Full-document embeddings are reused for additional questions. Snapshot ${state.corpus.sha256}.`;
  const manifest=$('manifest');manifest.replaceChildren();for(const d of state.corpus.documents)manifest.append(element('p',`${d.path} · ${d.chunks} chunks`),element('code',d.sha256));
  $('status').textContent=state.progress+(state.error?'\n'+state.error:'');$('run').disabled=state.busy;$('forget').disabled=state.busy||!state.hasKey;$('download').hidden=!state.report;
  $('resume').hidden=!state.canResume;$('resume').disabled=Date.now()<state.retryAt;if(state.retryAt>Date.now())$('status').textContent+='\nContinue after '+new Date(state.retryAt).toLocaleTimeString()+'.';
  $('search-button').disabled=state.busy||!state.hasKey;
  if(state.report){
    $('summary').hidden=false;$('explore').hidden=false;
    const r=state.report,s=r.summary;$('measurement').textContent=`${s.answerable} answerable queries and ${s.unanswerable} unanswerable diagnostics. Exact-evidence scoring checks the labeled passage text, not just a matching document.`;
    $('metrics').replaceChildren();for(const arm of ['keyword','semantic','hybrid']){const v=s[arm],row=element('tr');for(const text of [names[arm],`${v.documentTop1}/${s.answerable}`,`${v.documentTop3}/${s.answerable}`,`${v.evidenceTop3}/${v.evidenceCases}`,v.exposedBytes.toLocaleString()])row.append(element('td',text));$('metrics').append(row);}
    const u=state.usage||r.usage;$('usage').textContent=`${u.calls.length} API calls · ${u.knownTokens.toLocaleString()} reported input tokens${u.unknownUsageCalls?' · '+u.unknownUsageCalls+' calls with unknown usage':''} · first comparison ${(r.elapsedMs/1000).toFixed(1)}s. Indexing is included; warm local keyword search needs no API call.`;
    if(shownReport!==r.at){shownReport=r.at;$('cases').replaceChildren();r.cases.forEach((c,i)=>{const option=element('option',c.query+(c.expected.kind==='unanswerable'?' — no answer in corpus':''));option.value=i;$('cases').append(option);});showResult(r.cases[0]);}
  }
  clearTimeout(timer);if(state.busy||state.retryAt>Date.now())timer=setTimeout(refresh,1000);
}
async function refresh(){try{render(await api('state'));}catch(e){$('status').textContent=e.message;}}
$('connect').addEventListener('submit',async e=>{e.preventDefault();const apiKey=$('key').value;$('key').value='';$('run').disabled=true;try{await api('run',{apiKey});await refresh();}catch(error){$('status').textContent=error.message;$('run').disabled=false;}});
$('forget').addEventListener('click',async()=>{try{await api('forget',{});await refresh();}catch(e){$('status').textContent=e.message;}});
$('resume').addEventListener('click',async()=>{try{await api('resume',{});await refresh();}catch(e){$('status').textContent=e.message;}});
$('cases').addEventListener('change',()=>showResult(current.report.cases[Number($('cases').value)]));
$('search').addEventListener('submit',async e=>{e.preventDefault();$('search-button').disabled=true;$('search-status').textContent='Comparing…';try{const {result}=await api('search',{query:$('query').value});showResult(result);$('search-status').textContent=`Completed in ${result.totalMs} ms${result.queryCacheHit?' · reused query embedding':''}.`;await refresh();}catch(error){$('search-status').textContent=error.message;$('search-button').disabled=!current.hasKey;}});
refresh();
