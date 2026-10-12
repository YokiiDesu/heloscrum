// A slash command must lead the message. Absolute paths and slashes inside prose
// keep their ordinary message meaning; unknown /commands never become prompts.
export const isSlashDraft=text=>/^\/(?:[a-z][\w-]*(?=\s|$)|$)/i.test(String(text).trimStart());
export function slashSuggestions(text,commands){const prefix=String(text).trim().split(/\s/)[0].toLowerCase();return commands.filter(c=>c.name.toLowerCase().startsWith(prefix));}
export function resolveSlashCommand(text,report){
  const value=String(text).trim();if(!isSlashDraft(value))return null;
  if(!report?.supported)throw Error('This session has no native slash commands. Use a native interactive provider. Your draft is saved.');
  if(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value))throw Error('Use one line for a native command. Your draft is saved.');
  const command=report.commands.toSorted((a,b)=>b.name.length-a.name.length).find(c=>value===c.name||value.startsWith(c.name+' '))||report.commands.find(c=>c.name.split(' ')[0]===value);
  if(!command)throw Error('Choose a command from this provider’s library, or type custom commands directly in its TUI. Your draft is saved.');
  const args=value.startsWith(command.name)?value.slice(command.name.length).trim():'';
  if(args&&!command.args)throw Error(command.name+' opens a native panel. Use its controls in TUI. Your draft is saved.');
  if(args.length>4000)throw Error('Native command arguments must be 4,000 characters or fewer. Your draft is saved.');
  return {name:command.name,args};
}
