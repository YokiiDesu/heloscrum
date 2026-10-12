import {imageReferences} from './image-attachments.mjs';
import {conversationInstruction} from './conversation-style.mjs';
import {providerTimestamp} from './provider-timestamp.mjs';
// Delivery envelopes are for provider routing; UI events expose their recorded
// sender and body separately. Never infer an identity from arbitrary chat text.
export function messageEnvelope(message) {
  const header = message.threadId
    ? `[HeloScrum group message ${message.id} from ${message.fromRole}, agent ${message.from}, thread ${message.threadId}]`
    : `[HeloScrum direct message ${message.id} from ${message.fromRole}, agent ${message.from}]`;
  const context=message.replyQuestion?`In reply to ${message.replyQuestion.fromRole}'s question: ${message.replyQuestion.text}\nUser's answer:\n`:'';
  const body=context+message.text+imageReferences(message.attachments);
  // Shared behavior belongs in the MCP catalog and initial brief. The envelope
  // only carries per-message routing; direct human prompts get normal replies.
  const metadata=message.from==='human'&&!message.threadId?'reply=normal':`kind=${message.kind}; requiresReply=${message.requiresReply}`;
  return `${header.slice(0,-1)}; ${metadata}]\n${body}${message.conversationStyle?'\n'+conversationInstruction(message.conversationStyle):''}\n[/HeloScrum message]`;
}

export const directThreadId = (from, to) => 'dm:' + [from, to].sort().join(':');

export function messageEvents(events, task, messages) {
  const inbox = new Map(messages.filter(m => m.project === task.project && m.to === task.id).map(m => [m.id, m]));
  return events.flatMap(event => {
    if (event.type !== 'message' || event.role !== 'user') return [event];
    // Claude's native paste transport wraps a submitted block, including batches
    // of delivered messages. IDs are opaque tokens (for example, "86ed"), not
    // decimal numbers. Remove only a complete outer pair with matching IDs before
    // splitting deliveries; never strip markup from the recorded bodies.
    const paste=task.kind==='claude'&&!event.communication&&(event.text||'').match(/^\s*<pasted_content id="([A-Za-z0-9_-]+)">\r?\n([\s\S]*)\r?\n<\/pasted_content id="\1">\s*$/);
    const original=paste?paste[2]:event.text||'';
    if(paste&&!original.trim()&&!event.attachments?.length)return [];
    const normalized=paste?{...event,text:original}:event;
    // Cursor wraps each submitted batch in provider-only timestamp/query tags.
    // Unwrap them only when the batch contains a verified recorded delivery;
    // otherwise return the original event, including any literal user markup.
    const wrapper=original.match(/^<timestamp>([^<>\r\n]+)<\/timestamp>\r?\n<user_query>\r?\n([\s\S]*)\r?\n<\/user_query>\s*$/);
    const timestamp=wrapper?providerTimestamp(wrapper[1]):NaN;
    const wrapped=Number.isFinite(timestamp),source=wrapped?wrapper[2]:original,pieces=[];
    const base=wrapped?{...normalized,at:event.at||new Date(timestamp).toISOString()}:normalized;
    let cursor = 0;
    // An envelope must match a recorded delivery exactly before gaining an identity.
    for (const match of source.matchAll(/^\[HeloScrum (?:direct|group) message ([a-f0-9-]{36}) from /gm)) {
      if (match.index < cursor) continue;
      const message = inbox.get(match[1]);
      if (!message) continue;
      const envelope = messageEnvelope(message);
      if (!source.startsWith(envelope, match.index)) continue;
      const before = source.slice(cursor, match.index).trim();
      if (before) pieces.push({...base, id: event.id + ':part:' + cursor, text: before});
      pieces.push({...base, id: event.id + ':dm:' + message.id, text: message.text, attachments:message.attachments, at: message.at,
        communication: {id: message.id, threadId: message.threadId || directThreadId(message.from, message.to),
          kind: message.threadId ? 'group' : 'dm', from: message.from, to: message.to,
          fromRole: message.fromRole, toRole: message.toRole, threadName: message.threadName || '',
          workBrief:message.workBrief,replyTo: message.replyTo, delivery: message.delivery}});
      cursor = match.index + envelope.length;
    }
    if (!pieces.length) return [normalized];
    if (source.slice(cursor).trim()) pieces.push({...base, id: event.id + ':part:' + cursor, text: source.slice(cursor).trim()});
    return pieces;
  });
}

export function chatThreads(messages, groups, contacts, project, states={}) {
  const names = new Map(contacts.map(c => [c.id, c.role]));
  const threads = new Map(groups.filter(g => g.project === project).map(g => [g.id, {
    id: g.id, project, createdAt:g.createdAt||null, kind: 'group', name: g.name, participants: g.participants.map(id => ({id, name: names.get(id) || 'Former agent'})), messages: []
  }]));
  for (const message of messages) {
    if (message.project !== project || message.sessionPrompt && message.delivery === 'cancelled') continue;
    const id = message.threadId || directThreadId(message.from, message.to);
    if (!threads.has(id)) {
      if (message.threadId) continue;
      const participants = [{id: message.from, name: names.get(message.from) || message.fromRole}, {id: message.to, name: names.get(message.to) || message.toRole}].sort((a,b) => a.id.localeCompare(b.id));
      threads.set(id, {id, project, createdAt:message.at, kind: 'dm', name: participants.map(p => p.name).join(' & '), participants, messages: []});
    }
    const thread = threads.get(id), key = message.groupMessageId || message.id;
    // One group message is delivered to several inboxes; show one bubble with
    // its individual delivery receipts, rather than duplicating its contents.
    thread.byId ||= new Map();
    let item = thread.byId.get(key);
    if (!item) {
      item = {id: key, from: message.from, fromRole: message.fromRole, toRole: message.toRole, text: message.text, attachments:message.attachments, workBrief:message.workBrief, at: message.at, replyTo: message.replyTo, humanRequestId:message.humanRequestId,kind:message.kind||'request',requiresReply:message.requiresReply??true, deliveries: []};
      thread.byId.set(key, item); thread.messages.push(item);
    }
    item.deliveries.push({id: message.id, to: message.to, toRole: message.toRole, status: message.delivery, error: message.error});
  }
  return [...threads.values()].map(({byId, ...thread}) => {
    thread.messages.sort((a,b) => a.at.localeCompare(b.at));
    const last = thread.messages.at(-1);
    return {...thread,status:states[thread.id]?.status||'open',statusReason:states[thread.id]?.reason||'', count: thread.messages.length, lastAt: last?.at || '', preview: last?.workBrief?.title || last?.text || '', lastSender: last?.fromRole || ''};
  }).sort((a,b) => b.lastAt.localeCompare(a.lastAt) || a.name.localeCompare(b.name));
}
