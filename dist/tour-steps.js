// Copy is deliberately separate from positioning and application actions.
export const TOUR_VERSION = 1;
export const TOUR_KEY = 'heloscrum.guided-tour';
// Verified live on October 12, 2026. Keep the project prefix and omit the trailing slash.
// Bundled /help/ pages remain available for offline reading.
export const publishedWebsiteBase = 'https://yokiidesu.github.io/heloscrum';
export const agentConnectionGuide = {href:`${publishedWebsiteBase||'/help'}/blog/connect-your-existing-agents.html`,label:'Connect an existing session · Setup guide'};
export const tourSteps = [
  {id:'projects',chapter:'Your Workspace',title:'Start With A Project',target:'[data-action="project"]',color:'mint',body:["This is the project you're working in. Open this menu to choose another folder or return to a saved session.","Keep each project in its own folder so its agents, conversations, and task list stay together."],tip:"You can use an existing Git project or start with a fresh workspace."},
  {id:'agents',chapter:'Your Team',title:'Give Your First Agent A Job',tab:'agents',target:'.workspace-view-controls [data-pack="new"]',color:'peach',body:["Add agent lets you choose a provider, a model, and a role. Use a provider you've installed and signed in to on this computer.","For a small project, start with one builder and one independent reviewer. Add more agents to the team when there's a clear job for them."],tip:"Each provider still uses its own account, permissions, and billing."},
  {id:'roles',chapter:'Your Team',title:'Choose Roles That Fit The Work',target:'[data-action="project-settings"]',color:'lilac',body:["Open Settings → Agents to see the built-in roles and saved agent profiles. A profile gives an agent a useful starting point; you can change its instructions.","An Orchestrator helps divide up work. A Scrum Master keeps tasks and reviews moving. A reviewer checks work someone else built."],tip:"Give reviewers clear success criteria and something they can actually run or inspect."},
  {id:'layouts',chapter:'Your Team',title:'Make Room For The Conversation',tab:'agents',target:'.layout-switch',color:'mint',body:["Grid shows several agents at once. Focus gives one conversation more space. Split puts two side by side, and Overview shows a quick update from each agent.","Switch views whenever you need to. The conversations stay with their agents."],tip:"Focus is a good place to start if a busy grid feels like too much."},
  {id:'chat',chapter:'Your Team',title:'Talk To Your Agents',tab:'agents',target:'.slot-chat,.empty-slot,#panel-agents',color:'peach',body:["Once you've added an agent, its card is where you send instructions and read replies. You can follow along as it uses tools and asks questions.","Be specific about the result you want. ‘Make the sign-in form work on phones, and show me how you tested it’ gives an agent much more to work with than ‘fix the page’."],tip:"Your agent cards will appear here. This tour doesn't start a conversation for you."},
  {id:'permissions',chapter:'Your Team',title:'Take A Moment With Approval Requests',tab:'agents',target:'.provider-request,.empty-slot,#panel-agents',color:'lilac',body:["If a provider needs permission, the request appears in the agent's chat. Read the command or question before responding.","Choose a one-time approval when that's all you intend. A ‘don't ask again’ option can cover future matching commands, so check its scope."],tip:"Approving a command lets that action run. You'll still review the finished task separately."},
  {id:'tasks',chapter:'Give Them Work',title:'Put The Plan In One Place',tab:'tasks',target:'#tab-tasks',color:'mint',body:["Tasks holds your briefs, assignments, and progress. Use a task for a focused request, or a plan when there are several pieces to coordinate.","A shared brief keeps the team working from the same instructions instead of piecing them together from different chats."],tip:"You can come back here while agents work to see what's moving and what's waiting."},
  {id:'brief',chapter:'Give Them Work',title:'Tell The Team What Done Looks Like',tab:'tasks',target:'[data-work="new"]',fallback:'#tab-tasks',color:'peach',body:["New task or plan gives you room for the request, success criteria, and supporting files. Pick the agents who should work on it.","Say what must work, what needs checking, and anything the team should leave alone. Screenshots, reference files, and a launch command can save a lot of back-and-forth."],tip:"Save draft keeps it private. Review & start is where you check the brief before sending it to the team."},
  {id:'progress',chapter:'Give Them Work',title:'Keep An Eye On Handoffs',tab:'tasks',target:'.work-layout',fallback:'#tab-tasks',color:'lilac',body:["The task list tells you who's working on each piece. Blocked means something needs resolving before that work can move on. Needs Review means it's ready for someone to check.","When an agent hands off work, look for the result, how to run it, and what was tested. Ask for anything that's missing."],tip:"A delivered message only tells you it reached the agent. The task's status tells you about the work."},
  {id:'review',chapter:'Give Them Work',title:'Review The Result Before Calling It Done',tab:'tasks',target:'#review-attention',color:'peach',body:["Needs Review brings together work and requests that need attention. Open the relevant task or agent to see what it's waiting for.","For managed tasks, Verify lets an authorized reviewer record the outcome. Have someone who didn't build the change check it against the brief, and send it back if it needs fixes."],tip:"For an app, try the actual user flow as well as reading the test results."},
  {id:'conversations',chapter:'Stay In The Loop',title:'Bring The Right Agents Into The Chat',tab:'conversations',target:'[data-thread-action="new"]',fallback:'#tab-conversations',color:'mint',body:["Conversations holds direct messages and group chats. Choose New Group to pick the agents you want in a chat, or open an existing group to write to the team and attach files.","Already working in a native agent session? Connect that session as an external contact so it can join DMs and groups while keeping its own history. The guide below covers local Codex sessions and our optional ChatGPT Work MCP inbox."],link:agentConnectionGuide,tip:"Create or open a group during this step to see tips for attaching and previewing files. Your draft stays unsent until you choose Send to group."},
  {id:'contacts',chapter:'Stay In The Loop',title:"See Who's Connected",target:'[data-pack="contacts"]',color:'lilac',body:["Contacts lists the agents and other connections your workspace knows about. Check here when someone can't reach the rest of the team.","Adding a contact and sending it a message are separate actions. Make sure you're choosing the intended recipient."],tip:"Keep names and roles clear, especially when two agents use the same provider."},
  {id:'memory',chapter:'Stay In The Loop',title:"Save The Decisions You'll Need Again",target:'[data-pack="memory"]',color:'mint',body:["Memory gives the team a shared place for project context. Use it for things like the agreed API, where important files live, and decisions that would be painful to explain again.","Keep entries specific and update them when the project changes. Include a source or file path when it helps someone check the details."],tip:"A short, current note is usually more useful than a long conversation pasted in whole."},
  {id:'tools',chapter:'Stay In The Loop',title:'Give Agents The Tools They Need',target:'[data-pack="toolbox"]',color:'peach',body:["Toolbox shows the shared tools available in the workspace. Settings → Tools & MCPs is where you configure tool connections.","Choose tools that suit the job and check their access. A tool that reads a file and one that publishes a site need different levels of trust."],tip:"‘Toolbox synced’ on an agent card means its tool information is up to date."},
  {id:'changes',chapter:'Check The Work',title:'Look At What Actually Changed',tab:'changes',target:'#tab-changes',color:'lilac',body:["Changes shows the files in the selected working copy and lets you inspect their diffs. Choose the right agent or working copy before reviewing.","Check that the edits match the request. Run the relevant checks and try the result before you decide to keep or publish it."],tip:"A task marked done doesn't, by itself, mean its changes have been committed or pushed."},
  {id:'history',chapter:'Check The Work',title:'Pick Up The Thread Later',target:'[data-pack="history"]',color:'mint',body:["History helps you find earlier conversations and work. It's useful when you're returning to a project or checking how a decision was reached.","Use Activity for recent workspace events and requests that may need your attention."],tip:"If an update seems stuck, Refresh checks the workspace again and keeps open drafts."},
  {id:'settings',chapter:'Make It Yours',title:'Set Things Up The Way You Work',target:'[data-action="project-settings"]',color:'peach',body:["Settings covers appearance and sound, conversation style, agent profiles, tools, AI and context, and reminders.","The Claude visual add-on and role packs can make supported Claude sessions easier to follow. Choose the packs that fit the agent's job; the provider still handles its own permissions."],tip:"You can change these later. You don't need to configure everything before your first task."},
  {id:'finish',chapter:"You're Ready",title:'Start With Something Small',target:'[data-tour-start]',color:'lilac',body:["Pick a project, add a builder and a reviewer, and give them one clear task. Watch the first handoff so you can adjust the brief or roles as needed.","That's the tour. Use this Tour button whenever you want a refresher, or jump straight to a topic from the list below."],tip:"The tour never submits work for you. You decide when your team is ready to start."},
];

// More specific surfaces come first. These tips observe the real UI; they
// never open a menu, change a setting, submit a form, or start a provider.
const hint=(title,target,body,tip,link)=>({title,target,body:[body],tip,link});
export const tourContexts = [
  {id:'project-local',when:'[data-library-form="local"]',title:'Open A Local Project',steps:[
    hint('Choose The Folder You Want To Work In','[data-library-form="local"] [name="path"]',"Enter the full path to your project folder. HeloScrum will keep this project's sessions and work together.","Open project switches workspaces. Filling in the path alone doesn't change anything."),
    hint('Open It When You’re Ready','[data-library-form="local"] button[type="submit"]',"Check the path, then choose Open project. Use Back if you just wanted to look at this form.","The tour will stay with you whichever you choose."),
  ]},
  {id:'project-clone',when:'[data-library-form="clone"]',title:'Clone A Repository',steps:[
    hint('Start With The Repository Address','[data-library-form="clone"] [name="remote"]',"Paste the repository's clone URL. Private repositories need Git authentication on this computer.","This is the source repository, not the folder where you want to put it."),
    hint('Give It A New Home','[data-library-form="clone"] [name="destination"]',"Choose a new local folder for the checkout. Clone & open downloads the repository and switches to that project.","Nothing is downloaded until you submit the form."),
  ]},
  {id:'project-connect',when:'[data-library-form="connect"]',title:'Connect A Remote',steps:[
    hint('Choose Where This Repository Connects','[data-library-form="connect"]',"A remote is the Git address this project can fetch from or push to. Check that it belongs to the intended repository.","Connecting a remote and publishing your changes are separate actions."),
  ]},
  {id:'project-repository',when:'.project-library-dialog [data-library="tab-repository"][aria-pressed="true"]',title:'Repository & PRs',steps:[
    hint('Check The Repository Before Publishing','.library-main',"This view shows the selected project's repository information. Review the branch and remote before you prepare a push or pull request.","The tour won't publish anything for you."),
  ]},
  {id:'projects',when:'.project-library-dialog[open]',title:'Projects And Sessions',steps:[
    hint('Find Your Project','[aria-label="Find a project or session"]',"Search your saved projects and sessions here. Selecting a project lets you inspect it before opening it.","Choose a folder or session normally. The tips will follow you."),
    hint('Bring In An Existing Project','[data-library="local"]',"Open local folder uses a project that's already on this computer. Clone repository downloads one from a Git remote into a new folder.","Click either button to see its setup tips."),
    hint('Return To A Saved Session','.library-main',"Sessions belong to the project selected on the left. Use the Active, Archived, and Trash filters to find an earlier session.","Use Close Projects below when you're ready to move on to the next tour step."),
  ]},
  {id:'new-agent',when:'#task-form',title:'Add An Agent',steps:[
    hint('Give This Agent A Clear Job','#task-form #title',"Name the task, add an agent role, and describe the result you want. Include how you'd like the agent to check its work.","For a small project, a builder and an independent reviewer are a good starting team."),
    hint('Use A Provider You’ve Connected','#task-form #kind',"Choose the native CLI or model connection this agent should use. Unavailable providers need to be installed or connected first.","Native providers keep using their own account and permission controls."),
    hint('Choose A Model And Effort Level','#task-form #new-model,#task-form #new-effort',"Use the provider default, pick a listed model, or enter an exact supported model ID. Reasoning effort is available where the provider supports it.","These choices can affect speed and usage. The tour doesn't start a model request."),
    hint('Give The Work Its Own Branch','#task-form #branch',"Choose a new branch name. The agent starts from this project's committed HEAD in an isolated Git worktree.","Create & start launches the agent. Cancel leaves without starting it."),
  ]},
  {id:'profile-editor',when:'#pack-project-resource [name="instructions"]',title:'Agent Profile',steps:[
    hint('Save Instructions You’ll Reuse','#pack-project-resource [name="instructions"]',"Describe the role's responsibilities, working habits, and how it should hand work over. A profile is a starting point for future sessions.","Saving a profile doesn't launch an agent."),
    hint('Choose This Profile’s Provider','#pack-project-resource [name="kind"],#pack-project-resource [name="connectionId"]',"Choose a provider and, where needed, a saved AI connection. Native CLI account uses the provider you've signed in to locally.","Keep the model ID consistent with the provider you choose."),
    hint('Decide Where It’s Available','#pack-project-resource [name="scope"]',"Keep the profile in one project, or make it available across your projects. Give it a recognizable name, color, and icon.","Shared instructions and provider defaults apply to new sessions."),
  ]},
  {id:'mcp-editor',when:'#pack-project-resource [name="transport"]',title:'Connect An MCP Server',steps:[
    hint('Choose How The Tool Server Runs','#pack-project-resource [name="transport"]',"Remote HTTP connects to a server URL. Local stdio starts a command on this computer. Use the connection details supplied by the tool's developer.","This adds tools to HeloScrum agents. Connecting an existing outside chat uses the separate external-contact setup.",agentConnectionGuide),
    hint('Enter The Connection Details','#pack-project-resource [name="url"],#pack-project-resource [name="command"]',"Enter the endpoint or command, then any required credentials. Use the credential fields for secrets rather than putting them into command arguments.","Save & connect makes a real connection; a local command runs with your local permissions."),
    hint('Choose Who Can Use These Tools','#pack-project-resource [name="assignment"],#pack-project-resource [name="scope"]',"Limit the connection to the projects and agents that need it. Only selected agents lets you assign access more narrowly.","You can review the discovered tools in Toolbox afterwards."),
  ]},
  ...[
    ['appearance','Appearance & Sound','Make This Workspace Comfortable',"Pick a light or dark theme, and choose whether the app makes sounds. These preferences save as you change them.","You can try the controls while the tour stays open."],
    ['conversation','Conversation Style','Choose How Your Agents Talk',"Concise keeps updates brief. Conversational makes them more natural. Expressive allows more personality. Choose what feels right for your team.","This applies to new sessions and subsequent delivered messages. It doesn't rewrite older chats."],
    ['agents','Agent Profiles','Give Each Role A Useful Starting Point',"Browse the built-in roles or create your own profile. Open a profile to review its responsibilities before using it for a new agent.","A profile describes the job. Task review authority is set separately in your plan."],
    ['tools','Tools & MCPs','Connect Tools For The Work At Hand',"Connect an MCP server or register a local executable, then choose which agents can use it. Open a connection form for the next set of tips.","Settings here control tools inside HeloScrum. The external-session guide covers joining from another chat."],
    ['ai','AI & Context','Manage Your Model Connections',"Review the saved connections and context options available to your project. Read the access and usage details before enabling an optional service.","The tour doesn't enable a connection or make a model request."],
    ['schedule','Schedule & Reminders','Choose When Work Should Run',"Use schedules for recurring work and reminders. Check the timing, recipients, and whether an action starts an agent before saving it.","Your local workspace needs to be running for scheduled work to run."],
  ].map(([id,title,heading,body,tip])=>({id:'settings-'+id,when:`.project-settings-tabs [data-project-setting="${id}"][aria-pressed="true"]`,title,steps:[hint(heading,id==='agents'?'[data-project-setting="new-agent"]':id==='tools'?'[data-project-setting="new-mcp"]':`.project-settings-tabs [data-project-setting="${id}"]`,body,tip,id==='tools'?agentConnectionGuide:undefined)]})),
  {id:'settings',when:'.project-settings-dialog[open]',title:'Project Settings',steps:[hint('Explore Your Settings','.project-settings-tabs',"These tabs cover Appearance & Sound, Conversation, Agents, Tools & MCPs, AI & Context, and Schedule & Reminders. Choose any tab to see what you can change there.","You don't have to set everything up now. The tips follow the tab you choose, and Next moves on when you're ready.")]},
  {id:'work-brief',when:'#pack-work-brief',title:'Task Or Plan',steps:[
    hint('Choose The Shape Of The Work','#pack-work-brief [name="kind"]',"Use a task for one focused piece of work. Use a plan when several pieces need coordinating.","You can fill in this brief while the tour stays open."),
    hint('Explain What You Want Built','#pack-work-brief [name="instructions"],#pack-work-brief [name="title"]',"Give the work a clear name, then describe the result, constraints, and anything the team should leave alone.","Reference files and a launch command help agents get started."),
    hint('Describe What A Good Result Looks Like','#pack-work-brief [name="acceptance"]',"List the things a reviewer should check. For an app, include the actual user flows and any important failure cases.","‘The checkout works with the keyboard’ is more useful than ‘make it polished’."),
    hint('Add Files To Your Brief','#pack-work-brief .work-file-drop',"Click Attach Files to choose files, paste a file into this form, or drop files onto this area. You can add screenshots, documents, code, and other reference material.","A brief can hold up to 30 files: 20 MiB per file and 100 MiB in total. Review the attached list and remove anything you don't want to share."),
    hint('Include Repository Files And Links','#pack-work-brief [name="repoPath"],#pack-work-brief [name="links"],#pack-work-brief [data-work="add-reference"]',"For a file already in this project, enter its path and choose Attach snapshot. You can also add web addresses in Resource links, one per line.","A snapshot saves the file as it is now. It won't change if someone edits the original later. Adding context doesn't start the team."),
    hint('Check The Team Before Starting','#pack-work-brief .work-agent-picker,#pack-work-brief',"Pick the agents for the work and check the review settings. Save draft keeps the brief private; Review & start lets you check it before sending it.","The tour never submits this brief."),
  ]},
  {id:'new-group',when:'.group-create:not([hidden])',title:'New Group',steps:[
    hint('Name The Conversation','.group-create [name="name"]',"Use a name that makes the purpose clear, such as ‘Website launch review’.","Creating a group doesn't start agent turns."),
    hint('Include The Agents Who Need To Be Here','.group-create fieldset',"Choose at least two agents. A registered external contact can join too, so your existing native session can take part alongside HeloScrum agents.","Membership is chosen when the group is created. Connect an outside session first if you want to include it.",agentConnectionGuide),
  ]},
  {id:'chat-filters',when:'.chat-filter-panel:not([hidden])',title:'Find A Conversation',steps:[hint('Narrow Down Your Chats','.chat-filter-panel',"Filter by project, activity date, or status. Sorting changes the order of the results; it doesn't move or delete messages.","Clear filters brings the full list back.")]},
  {id:'contacts',when:'#pack-drawer:not([hidden]) .contact-refresh-intro',title:'Contact Book',steps:[
    hint('Check Who’s Available','.contact-refresh-intro',"This lists workspace agents and registered external contacts. An external contact keeps its own session and reads messages from its inbox.","Local inbox delivery doesn't wake an idle outside chat. The optional ChatGPT Work event connection can notify a subscribed cloud chat.",agentConnectionGuide),
  ]},
  {id:'toolbox',when:'#pack-drawer:not([hidden]) [data-pack="add-tool"]',title:'Shared Toolbox',steps:[hint('See Which Tools Your Team Can Use','#pack-drawer [data-pack="add-tool"]',"Browse the available tools, or open Manage tools & MCPs to configure connections and access.","A tool being listed doesn't mean an agent has used it.")]},
  {id:'memory-note',when:'#pack-drawer:not([hidden]) [data-memory-form="note"]',title:'Working Note',steps:[
    hint('Write Down The Decision And Why It Matters','[data-memory-form="note"] [name="text"]',"Keep the note focused on what another agent will need later. Include the reason for a decision and a file or source that helps someone check it.","Save note adds it to the notebook. The tour won't save it for you."),
    hint('Label What You Actually Know','[data-memory-form="note"] [name="confidence"],[data-memory-form="note"] [name="category"]',"Choose a category and distinguish an assumption from something reported or checked by the author.","A verified note doesn't approve a task or replace independent review."),
  ]},
  {id:'memory-search',when:'#pack-drawer:not([hidden]) [data-memory-form="search"]',title:'Search Memory',steps:[
    hint('Find The Context You Need','[data-memory-form="search"] [name="query"]',"Search for a decision, task, file, or earlier approach. Choose the agent and scope so you're searching the relevant accessible sources.","You can fill in the query without running a search."),
    hint('Choose How Results Are Ranked','[data-memory-form="search"] [name="ranking"],[data-memory-form="search"] [name="scope"]',"Local only searches without an AI call. Use configured ranking follows the project's current search configuration.","A relevant result still needs to be checked against its source."),
  ]},
  {id:'memory',when:'#pack-drawer:not([hidden]) .memory-tabs',title:'Project Memory',steps:[
    hint('Keep Useful Context Within Reach','.memory-tabs',"Agent notebooks hold working notes. Shared decisions hold agreements for the project. Search helps you find earlier context.","Open a notebook or Search to see the tools available there."),
  ]},
  {id:'history',when:'#pack-drawer:not([hidden]) .history-tabs',title:'Project History',steps:[
    hint('Choose The Kind Of Record You Need','.history-tabs',"Browse captured sessions, memory revisions, commits, and files. Select a record to inspect its content and source.","These are saved records; viewing one doesn't restart the agent."),
    hint('Capture Or Export When You Need To','[data-history="capture"],[data-history="export"]',"Capture now records currently available history. Export creates a copy you can keep or inspect outside the app.","The tour won't trigger a capture or download."),
  ]},
  {id:'drawer',when:'#pack-drawer:not([hidden])',title:'Workspace Details',steps:[hint('Explore This View','#pack-drawer',"You can read, search, and use this view without leaving the tour. Close it when you're ready to return to the main walkthrough.","Your place in the tour is saved.")]},
  {id:'conversation-files',mainStep:'conversations',inline:true,when:'.threads-drawer.thread-selected .group-composer:not([hidden]) .attachment-composer',title:'Conversation Files',steps:[
    hint('Share Files With The Group','.group-composer .attach-image',"Choose Attach files, paste a file into the message box, or drop files there. You can attach up to four files to a message: 10 MiB each, or 3 MiB each for images.","Wait for the files to finish attaching. They stay in your draft until you choose Send to group; you can remove a file before sending."),
    hint('Open The Files In A Conversation','.thread-messages [data-message-image],.attachment-drafts [data-message-image],.thread-messages',"Click an attachment to open the same file viewer used for task and plan resources. This works for files sent by you or by an agent.","The viewer can render supported documents, images, and code. Download original gives you the saved file, including formats that can't be previewed."),
  ]},
];

export function readTourProgress(value) {
  try {
    const saved=JSON.parse(value);
    if(saved?.version!==TOUR_VERSION||!['paused','complete','dismissed'].includes(saved.status))return null;
    const index=tourSteps.findIndex(step=>step.id===saved.step);
    return {status:saved.status,index:Math.max(0,index)};
  } catch {return null;}
}

export function tourHighlightBounds(bounds,clip) {
  // Full-size panels can meet all four clipping edges. Keep their outline
  // inside those edges instead of clipping the entire border away.
  const inset=3,padding=5;
  if(bounds.right<=clip.left||bounds.left>=clip.right||bounds.bottom<=clip.top||bounds.top>=clip.bottom)return null;
  const left=Math.max(bounds.left-padding,clip.left+inset),top=Math.max(bounds.top-padding,clip.top+inset);
  const right=Math.min(bounds.right+padding,clip.right-inset),bottom=Math.min(bounds.bottom+padding,clip.bottom-inset);
  return right-left>=4&&bottom-top>=4?{left,top,width:right-left,height:bottom-top}:null;
}

export function tourPosition(anchor,size,viewport,obstacles=[],previous=null) {
  const margin=16,gap=18,width=Math.min(size.width,viewport.width-margin*2),height=Math.min(size.height,viewport.height-margin*2);
  const clamp=(n,min,max)=>Math.max(min,Math.min(n,Math.max(min,max)));
  if(!anchor)return {left:clamp(previous?.left??viewport.width-width-margin,margin,viewport.width-width-margin),top:clamp(previous?.top??viewport.height-height-margin,margin,viewport.height-height-margin),side:previous?.side||'none'};
  const candidates=[
    {side:'bottom',left:anchor.left+(anchor.width-width)/2,top:anchor.bottom+gap},
    {side:'top',left:anchor.left+(anchor.width-width)/2,top:anchor.top-height-gap},
    {side:'right',left:anchor.right+gap,top:anchor.top+(anchor.height-height)/2},
    {side:'left',left:anchor.left-width-gap,top:anchor.top+(anchor.height-height)/2},
    ...(obstacles.length?[{side:'corner',left:margin,top:margin},{side:'corner',left:viewport.width-width-margin,top:margin},{side:'corner',left:margin,top:viewport.height-height-margin},{side:'corner',left:viewport.width-width-margin,top:viewport.height-height-margin}]:[]),
    ...obstacles.filter(rect=>rect.weight>1).flatMap(rect=>[margin,viewport.width-width-margin].map(left=>({side:'clear-close',left,top:rect.bottom+gap}))),
  ].map(place=>({...place,left:clamp(place.left,margin,viewport.width-width-margin),top:clamp(place.top,margin,viewport.height-height-margin)}));
  const overlap=(p,rect)=>Math.max(0,Math.min(p.left+width,rect.right)-Math.max(p.left,rect.left))*Math.max(0,Math.min(p.top+height,rect.bottom)-Math.max(p.top,rect.top));
  // Broad panels can fill most of a dialog. Keeping its controls reachable
  // matters more than avoiding every pixel of that panel's highlight.
  const anchorArea=(anchor.right-anchor.left)*(anchor.bottom-anchor.top);
  const cost=p=>overlap(p,anchor)/Math.max(1,Math.min(width*height,anchorArea))*(anchorArea<width*height/2?1200:10)+obstacles.reduce((sum,rect)=>sum+overlap(p,rect)/Math.max(1,(rect.right-rect.left)*(rect.bottom-rect.top))*100*(rect.weight||1),0);
  candidates.sort((a,b)=>cost(a)-cost(b));
  // Follow the same side as the target moves. Small changes in overlap while
  // scrolling shouldn't send the card back and forth across the screen.
  if(previous){
    const sameSide=candidates.filter(place=>place.side===previous.side).sort((a,b)=>Math.hypot(a.left-previous.left,a.top-previous.top)-Math.hypot(b.left-previous.left,b.top-previous.top))[0];
    if(sameSide&&cost(sameSide)<=cost(candidates[0])+35)return sameSide;
  }
  return candidates[0];
}
