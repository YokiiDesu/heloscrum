function sameOrigin(value, origin) {
  try {return new URL(value).origin === origin && ['http:', 'https:'].includes(new URL(value).protocol);} catch {return false;}
}
function externalLink(value) {
  try {const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;} catch {return null;}
}
function hasActiveWork(state) {
  if (!state || !Array.isArray(state.tasks)) return true; // Unknown state must not silently stop work.
  return state.tasks.some(task => task.pane || ['starting', 'working', 'awaiting-setup'].includes(task.phase));
}
module.exports = {sameOrigin, externalLink, hasActiveWork};
