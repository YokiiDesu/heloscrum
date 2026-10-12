export const agentColors=[
  ['violet','Violet','#bd9dec'],['amber','Amber','#efb267'],['mint','Mint','#80d2bc'],['rose','Rose','#e7a3c6'],
  ['sky','Sky','#8ec5f5'],['coral','Coral','#f39e94'],['lime','Lime','#becf80'],['indigo','Indigo','#a4acf4'],
  ['teal','Teal','#66c8ca'],['peach','Peach','#ffc2a0'],['orchid','Orchid','#d59ee8'],['gold','Gold','#e7cc77'],
  ['sage','Sage','#a8c6aa'],['ice','Ice','#a3dce8'],['slate','Slate','#aabccc'],['berry','Berry','#f095b7']
].map(([id,name,hex])=>({id,name,hex}));
export const agentIcons=['bot','sparkles','code-xml','terminal','shield-check','bug','flask-conical','palette','pen-tool','compass','rocket','lightbulb','brain','search','file-code','git-branch','database','globe','layers','puzzle','wrench','zap','heart','star','leaf','flame','moon','sun','mountain','bird','cat','dog','rabbit','fish','turtle','paw-print','crown','gem','music','camera'];
function savedAppearance(task={}){
  const hash=[...(task.id||'')].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
  return {color:agentColors.some(c=>c.id===task.appearance?.color)?task.appearance.color:agentColors[hash%agentColors.length].id,icon:agentIcons.includes(task.appearance?.icon)?task.appearance.icon:'bot'};
}
// Provider sessions and messages keep the stable task ID. Appearance is a live
// presentation preference, never copied into historical messages or matched by name.
export class AgentIdentityDirectory {
  constructor(){this.entries=new Map();this.revision=0;}
  update(agents=[]){
    let changed=false;
    for(const agent of agents){
      if(!agent.id||agent.id==='human')continue;
      const current=this.entries.get(agent.id),revision=agent.appearanceRevision||0;
      if(current&&revision<current.appearanceRevision)continue;
      const next={id:agent.id,role:agent.role||agent.title||agent.name,appearance:savedAppearance(agent),appearanceRevision:revision};
      if(JSON.stringify(current)!==JSON.stringify(next)){this.entries.set(agent.id,next);changed=true;}
    }
    if(changed)this.revision++;return changed;
  }
  resolve(source={}){const agent=typeof source==='string'?{id:source}:source||{};return {...agent,...this.entries.get(agent.id)};}
}
export const agentIdentityRecords=tasks=>tasks.map(t=>({id:t.id,project:t.project,role:t.role||t.title,appearance:savedAppearance(t),appearanceRevision:t.appearanceRevision||0}));
export const agentIdentities=new AgentIdentityDirectory();
export const identityFor=source=>agentIdentities.resolve(source);
export const appearanceFor=source=>savedAppearance(identityFor(source));
export const agentColor=source=>agentColors.find(c=>c.id===appearanceFor(source).color).hex;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function agentAttributes(source){const agent=identityFor(source);return agent.id&&agent.id!=='human'?`data-agent-identity="${esc(agent.id)}" style="${appearanceStyle(agent)}"`:'';}
export function agentAvatar(source,size=18){const agent=identityFor(source);return `<span class="identity-avatar ${agent.id==='human'?'human-avatar':''}" ${agentAttributes(agent)} aria-hidden="true">${agent.id==='human'?libraryIcon('user-round',size):`<span data-agent-icon="${esc(agent.id||'')}" data-icon-size="${size}">${libraryIcon(appearanceFor(agent).icon,size)}</span>`}</span>`;}
export function agentLabel(source,name){const agent=identityFor(source);return `<span class="agent-label ${agent.id==='human'?'human-label':''}" ${agentAttributes(agent)}>${agentAvatar(agent,15)}<span>${esc(name??agent.role??agent.name??'Former agent')}</span></span>`;}
export function refreshAgentAppearances(root){
  for(const node of root.querySelectorAll('[data-agent-identity]')){
    const color=themeColor(agentColor(node.dataset.agentIdentity));
    node.style.setProperty('--agent-color',color);node.style.setProperty('--agent-surface',`color-mix(in srgb, ${color} 13%, light-dark(#fff,#151b20))`);node.style.setProperty('--agent-border',`color-mix(in srgb, ${color} 52%, light-dark(#b8c8d0,#25313a))`);
  }
  for(const node of root.querySelectorAll('[data-agent-icon]')){const html=libraryIcon(appearanceFor(node.dataset.agentIcon).icon,Number(node.dataset.iconSize)||18);if(node.innerHTML!==html)node.innerHTML=html;}
}
export const iconLabel=name=>name.split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
export const controlIcons=['network','workflow','panels-top-left','gamepad-2','lock-keyhole','book-open','circle-dashed','history','refresh-cw','sliders-horizontal','check','notebook-pen','maximize-2','minimize-2','calendar','bell','flag','clock','chevron-left','chevron-down','chevron-right','eye-off','folder','archive','trash-2','rotate-ccw','git-pull-request','external-link','plus','pin','settings-2','plug','clipboard-list','circle','loader','circle-alert','eye','circle-check','circle-x','file-pen-line','play','list-tree','route','paperclip','users','list-checks','send','corner-down-right','pencil','download','link','arrow-up-right','x','upload','image','file-up','file','user-round'];
export function libraryIcon(name,size=18){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/agent-icons.svg#${agentIcons.includes(name)||controlIcons.includes(name)?name:'bot'}"></use></svg>`;}
const themeColor=color=>`light-dark(oklch(from ${color} clamp(0.17, calc(1.11 - l), 0.99) c h), ${color})`;
export function appearanceStyle(task){const color=themeColor(agentColor(task));return `--agent-color:${color};--agent-surface:color-mix(in srgb, ${color} 13%, light-dark(#fff,#151b20));--agent-border:color-mix(in srgb, ${color} 52%, light-dark(#b8c8d0,#25313a))`;}
