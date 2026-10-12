// Shared by the server and browser. Codex capabilities come from model/list.
// Claude's CLI advertises levels globally; model support is documented at
// https://code.claude.com/docs/en/model-config#adjust-effort-level.
export function effortOptions(provider,model){
  if(!provider)return [];
  if(provider.id==='codex'){
    const entry=model?provider.models.find(m=>m.id===model):null;
    return entry?.supportedReasoningEfforts||[];
  }
  if(provider.id!=='claude'||!provider.effortLevels)return [];
  const id=(model||'default').replace(/\[(?:1m|fast)\]$/,'');
  let levels=[];
  if(['default','opus','sonnet','fable'].includes(id)||/^claude-(?:opus|sonnet|fable)-5(?:[.-]\d+)?(?:-\d{8})?$/.test(id)||/^claude-opus-4[.-][78](?:-\d{8})?$/.test(id))levels=['low','medium','high','xhigh','max'];
  else if(/^claude-(?:opus|sonnet)-4[.-]6(?:-\d{8})?$/.test(id))levels=['low','medium','high','max'];
  return levels.filter(level=>provider.effortLevels.includes(level)).map(reasoningEffort=>({reasoningEffort,description:''}));
}
export const effortName=value=>value?({xhigh:'Extra high'}[value]||value[0].toUpperCase()+value.slice(1)):'Inherit provider settings';
export function effortHint(provider,model,effort){
  const options=effortOptions(provider,model),selected=options.find(o=>o.reasoningEffort===effort);
  if(provider?.id==='codex'&&!model)return 'Choose a model to set effort explicitly. Inherit leaves your configured or saved model and effort in effect.';
  if(!options.length)return 'Effort controls are unavailable for this model or local provider catalog. Provider settings remain in effect.';
  const description=selected?.description?selected.description+'. ':'';
  return description+(provider.id==='claude'?'Applies to this session. Alias overrides and provider policies can limit the effective level; check the last observed response.':'Applies to this session. Inherit leaves the choice to the provider, including saved session settings; the catalog default may differ. Ultra, when offered, includes automatic task delegation.');
}

export function cliEffortLevels(help){
  const description=help.match(/--effort\b([\s\S]*?)(?=\n\s*(?:-{1,2}\w|[A-Z]\w+:)|$)/)?.[1]||'';
  return [...new Set(description.match(/\b(low|medium|high|xhigh|max)\b/g)||[])];
}
