import {randomUUID} from 'node:crypto';
import {assert, string} from './adapters.mjs';
import {sessionKey} from './session-identity.mjs';
import {SYSTEM_SENDER} from './group-chats.mjs';

/**
 * Structured exchanges inside group chats: proposals with votes, debates with
 * positions, and decision records. Every step is announced through the normal
 * group-message path, so delivery, receipts, closing a chat and history keep
 * their existing behavior. All limits and resolution rules are deterministic
 * and enforced here, never left to a model.
 *
 * @typedef {'proposal'|'debate'|'decision'} StructureType
 * @typedef {{id:string,label:string}} ProposalOption
 * @typedef {{voter:string,voterRole:string,option:string|null,stance:'support'|'object'|'abstain',rationale:string,at:string,messageId:string,previous?:{option:string|null,stance:string,rationale:string},reason?:string,influencedBy?:string|null,deciding?:boolean}} Vote
 * @typedef {{id:string,author:string,authorRole:string,claim:string,arguments:string,rebuts:string[],at:string,messageId:string}} Position
 * @typedef {{member:string,memberRole:string,position:string,from:string|null,reason:string|null,influencedBy:string|null,at:string,messageId:string}} Stance
 */

export const PROPOSAL_RULES = ['majority', 'unanimous', 'proposer-decides'];
export const VOTE_STANCES = ['support', 'object', 'abstain'];
export const PROPOSAL_STATUSES = ['open', 'accepted', 'rejected', 'expired', 'withdrawn'];
export const OPTION_IDS = ['A', 'B', 'C', 'D', 'E'];
export const STRUCTURE_LIMITS = Object.freeze({
  openPerThread: 10,
  options: 5,
  positionsPerDebate: 20,
  positionsPerMember: 5,
  stanceChangesPerDebate: 60,
  alternatives: 8,
  dissent: 20,
  rebuts: 5,
  maxDeadlineDays: 30,
});
const SYSTEM = Object.freeze({id: 'heloscrum', role: 'HeloScrum', [SYSTEM_SENDER]: true});
const text = (value, name, max) => string(value, name, max);
const optionalText = (value, name, max) => value === undefined || value === null || value === '' ? '' : text(value, name, max);
const requestKey = value => value === undefined ? null : text(value, 'request ID', 120);
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'decision';
const roleOf = actor => actor.human ? 'You' : actor.role || actor.title || actor.id;

const schema = (properties, required = []) => ({type: 'object', properties, required, additionalProperties: false});
const requestId = {type: 'string', maxLength: 120, description: 'Stable retry key. Repeating the same call with the same requestId returns the original receipt.'};
export const STRUCTURE_TOOLS = [
  {name: 'start_proposal', description: 'Open a proposal in a group you belong to and ask its members to vote. Use one option for a yes/no question or up to five alternatives. The rule is enforced by HeloScrum: majority of eligible voters, unanimous, or proposer-decides (you decide after every other member has voted). Wakes every voter once; individual votes do not wake anyone; the outcome wakes everyone once and an accepted proposal becomes a decision record.',
    inputSchema: schema({threadId: {type: 'string'}, title: {type: 'string', maxLength: 200}, summary: {type: 'string', maxLength: 4000}, options: {type: 'array', items: {type: 'string', maxLength: 300}, minItems: 1, maxItems: 5, uniqueItems: true}, rule: {type: 'string', enum: PROPOSAL_RULES}, deadline: {type: 'string', format: 'date-time', description: 'Optional ISO time, at most 30 days ahead. Open proposals expire then.'}, requestId}, ['threadId', 'title', 'summary', 'options'])},
  {name: 'cast_vote', description: 'Vote on an open proposal: support one option (A-E), object to the proposal, or abstain, with your rationale. You can change your vote while it is open; give the reason and, if a teammate\'s message changed your mind, its message ID in influencedBy. For proposer-decides proposals the proposer\'s vote decides once everyone else has voted. Votes go to inboxes without waking anyone.',
    inputSchema: schema({structureId: {type: 'string'}, option: {type: 'string', enum: OPTION_IDS}, stance: {type: 'string', enum: VOTE_STANCES}, rationale: {type: 'string', maxLength: 2000}, reason: {type: 'string', maxLength: 2000, description: 'Required when changing an earlier vote.'}, influencedBy: {type: 'string', description: 'Message ID in this group that changed your mind.'}}, ['structureId', 'stance', 'rationale'])},
  {name: 'start_debate', description: 'Open a debate on a question in a group you belong to. You moderate it and later close it with record_decision. Optionally state your own opening position. Wakes every member once.',
    inputSchema: schema({threadId: {type: 'string'}, question: {type: 'string', maxLength: 1000}, context: {type: 'string', maxLength: 4000}, claim: {type: 'string', maxLength: 1000}, arguments: {type: 'string', maxLength: 4000}, requestId}, ['threadId', 'question'])},
  {name: 'take_position', description: 'Take part in an open debate. action=state adds a new position with a claim, arguments and optional rebuts (other position IDs); it wakes the other members. action=adopt moves you to an existing position; adopting is quiet. Whenever you leave a position you held, give the reason, and the message that persuaded you in influencedBy if there was one.',
    inputSchema: schema({structureId: {type: 'string'}, action: {type: 'string', enum: ['state', 'adopt']}, claim: {type: 'string', maxLength: 1000}, arguments: {type: 'string', maxLength: 4000}, rebuts: {type: 'array', items: {type: 'string'}, maxItems: 5, uniqueItems: true}, positionId: {type: 'string'}, reason: {type: 'string', maxLength: 2000}, influencedBy: {type: 'string'}}, ['structureId', 'action'])},
  {name: 'record_decision', description: 'Record what a group agreed and why, as a decision record in a group you belong to. Use debateId to close a debate you moderate (positionId names the winning position; members holding other positions are recorded as dissent). Use supersedes to replace an earlier decision. Accepted proposals record their own decisions. The record is saved to shared project memory under decisions/ and wakes every member once.',
    inputSchema: schema({threadId: {type: 'string'}, title: {type: 'string', maxLength: 200}, decision: {type: 'string', maxLength: 2000}, rationale: {type: 'string', maxLength: 4000}, context: {type: 'string', maxLength: 4000}, alternatives: {type: 'array', items: {type: 'string', maxLength: 500}, maxItems: 8}, consequences: {type: 'string', maxLength: 2000}, dissent: {type: 'array', maxItems: 20, items: schema({member: {type: 'string'}, reason: {type: 'string', maxLength: 1000}}, ['member', 'reason'])}, debateId: {type: 'string'}, positionId: {type: 'string'}, supersedes: {type: 'string'}, requestId}, ['threadId', 'title', 'decision', 'rationale'])},
];
export const STRUCTURE_TOOL_NAMES = STRUCTURE_TOOLS.map(tool => tool.name);

/** Latest vote per voter, in voter order. */
export function currentVotes(proposal) {
  const latest = new Map();
  for (const vote of proposal.votes) latest.set(vote.voter, vote);
  return proposal.voters.map(id => latest.get(id)).filter(Boolean);
}

/** Counts of current votes. Every option appears, even with no support. */
export function tally(proposal) {
  const votes = currentVotes(proposal);
  const support = Object.fromEntries(proposal.options.map(o => [o.id, 0]));
  let object = 0, abstain = 0;
  for (const vote of votes) {
    if (vote.stance === 'support') support[vote.option]++;
    else if (vote.stance === 'object') object++;
    else abstain++;
  }
  const voted = new Set(votes.map(v => v.voter));
  return {support, object, abstain, voted: votes.length, eligible: proposal.voters.length, waiting: proposal.voters.filter(id => !voted.has(id))};
}

/**
 * Apply the proposal's rule to its current votes. Returns null while the
 * outcome is still open. `final` means voting has ended (deadline) and an
 * undecided proposal expires instead of waiting for more votes.
 */
export function evaluateProposal(proposal, {final = false} = {}) {
  const count = tally(proposal), allVoted = count.waiting.length === 0;
  const leader = proposal.options.map(o => ({id: o.id, votes: count.support[o.id]})).sort((a, b) => b.votes - a.votes)[0];
  if (proposal.rule === 'majority') {
    if (leader.votes * 2 > count.eligible) return {status: 'accepted', option: leader.id, reason: `Option ${leader.id} has ${leader.votes} of ${count.eligible} votes, a majority.`};
    if (allVoted) return {status: 'rejected', option: null, reason: 'Every voter voted and no option reached a majority.'};
  } else if (proposal.rule === 'unanimous') {
    if (allVoted) {
      const supported = proposal.options.filter(o => count.support[o.id] > 0);
      if (count.object === 0 && supported.length === 1) return {status: 'accepted', option: supported[0].id, reason: `Every voter supported option ${supported[0].id} or abstained.`};
      return {status: 'rejected', option: null, reason: count.object ? `${count.object} ${count.object === 1 ? 'voter objects' : 'voters object'}, so the vote is not unanimous.` : supported.length ? 'Voters supported different options, so the vote is not unanimous.' : 'Every voter abstained.'};
    }
  } else if (proposal.rule === 'proposer-decides') {
    const deciding = proposal.votes.findLast(v => v.deciding);
    if (deciding) return deciding.stance === 'support'
      ? {status: 'accepted', option: deciding.option, reason: `${deciding.voterRole} decided on option ${deciding.option} after every member voted.`}
      : {status: 'rejected', option: null, reason: `${deciding.voterRole} rejected the proposal after every member voted.`};
  }
  if (final) return {status: 'expired', option: null, reason: `The deadline passed with ${count.voted} of ${count.eligible} votes and no outcome under the ${proposal.rule} rule.`};
  return null;
}

/** Current position held by each member, in the order they joined. */
export function currentStances(debate) {
  const latest = new Map();
  for (const stance of debate.stances) latest.set(stance.member, stance);
  return [...latest.values()];
}

export function structureView(structure) {
  if (structure.type === 'proposal') return {...structure, tally: tally(structure), currentVotes: currentVotes(structure)};
  if (structure.type === 'debate') {
    const holders = currentStances(structure);
    return {...structure, positions: structure.positions.map(p => ({...p, holders: holders.filter(h => h.position === p.id).map(h => ({id: h.member, role: h.memberRole}))})), currentStances: holders};
  }
  return {...structure};
}

const list = items => items.map(item => `- ${item}`).join('\n');
export function decisionMarkdown(decision) {
  return [
    `# ${decision.title}`,
    `Status: ${decision.status}${decision.supersededBy ? ` (superseded by ${decision.supersededBy})` : ''}${decision.supersedes ? `; supersedes ${decision.supersedes}` : ''}`,
    `Recorded: ${decision.at} by ${decision.recordedByRole} in group "${decision.threadName}"`,
    decision.context && `## Context\n${decision.context}`,
    `## Decision\n${decision.decision}`,
    `## Rationale\n${decision.rationale}`,
    decision.alternatives.length && `## Alternatives considered\n${list(decision.alternatives)}`,
    decision.consequences && `## Consequences\n${decision.consequences}`,
    decision.dissent.length && `## Dissent\n${list(decision.dissent.map(d => `${d.memberRole}: ${d.reason}`))}`,
    `## Participants\n${decision.participantRoles.join(', ')}`,
    `Decision ID: ${decision.id}${decision.source ? `; from ${decision.source.type} ${decision.source.id}` : ''}`,
  ].filter(Boolean).join('\n\n');
}

export class ConversationStructures {
  /** @param {import('./collaboration.mjs').Collaboration} registry */
  constructor(registry) {
    this.registry = registry;
    registry.data.structures ||= [];
  }
  get data() { return this.registry.data; }
  get all() { return this.data.structures; }

  forThread(project, threadId) {
    return this.all.filter(s => s.project === project && s.threadId === threadId).map(structureView);
  }
  summary(project, threadId) {
    const items = this.all.filter(s => s.project === project && s.threadId === threadId);
    return {open: items.filter(s => s.status === 'open').length, decisions: items.filter(s => s.type === 'decision' && s.status === 'accepted').length};
  }
  find(actor, id) {
    const structure = typeof id === 'string' && this.all.find(s => s.id === id && s.project === actor.project);
    assert(structure, 'Conversation structure not found in this project', 404);
    this.registry.groups.available(actor, structure.threadId);
    return structure;
  }
  read(actor, id) { return structureView(this.find(actor, id)); }

  thread(actor, threadId) {
    assert(typeof threadId === 'string', 'Group threadId is required');
    const thread = this.registry.groups.available(actor, threadId);
    assert(thread.kind === 'group', 'Structured conversations need a group chat');
    assert(thread.status !== 'closed', 'Conversation is closed. Reopen it explicitly for new evidence or requirements.', 409);
    return thread;
  }
  members(thread) { return thread.participants.map(p => p.id); }
  memberRole(project, id) {
    if (id === 'human') return 'You';
    const member = this.registry.participant(id, project);
    return member ? member.role || member.title : 'Former agent';
  }
  messageInThread(actor, threadId, id) {
    if (id === undefined || id === null || id === '') return null;
    const message = this.data.messages.find(m => (m.id === id || m.groupMessageId === id) && m.project === actor.project && m.threadId === threadId);
    assert(message, 'influencedBy must name a message in this group', 404);
    return message.groupMessageId || message.id;
  }
  replay(actor, type, key, same) {
    if (!key) return null;
    const old = this.all.find(s => s.project === actor.project && s.createdBy === actor.id && s.type === type && s.requestId === key);
    if (!old) return null;
    assert(same(old), 'Request ID belongs to a different structured message', 409);
    return old;
  }

  /**
   * Run mutations as one unit: if any step throws (validation, a full inbox),
   * messages, structures and memory notes return to their previous state.
   */
  transaction(fn) {
    const data = this.data, messages = data.messages.length, structures = structuredClone(data.structures), memory = structuredClone(data.memory || []);
    try { return fn(); } catch (error) {
      data.messages.length = messages;
      data.structures.splice(0, data.structures.length, ...structures);
      if (data.memory) data.memory.splice(0, data.memory.length, ...memory);
      throw error;
    }
  }

  post(sender, thread, message, {kind = 'result', requiresReply = false, quiet = false, recipients = null, replyTo = null, structure}) {
    return this.registry.prepareGroup(sender, null, message, {threadId: thread.id, kind, requiresReply, replyTo}, {quiet, recipients, structure, system: !!sender[SYSTEM_SENDER]});
  }

  receipt(structure, message, next) {
    return {structure: structureView(structure), message: message ? {id: message.id, deliveries: message.deliveries} : null, receiptOnly: true, next};
  }

  // ---- Proposals ---------------------------------------------------------

  async startProposal(actor, input) {
    const thread = this.thread(actor, input.threadId);
    const title = text(input.title, 'proposal title', 200), summary = text(input.summary, 'proposal summary', 4000);
    const labels = input.options;
    assert(Array.isArray(labels) && labels.length >= 1 && labels.length <= STRUCTURE_LIMITS.options, 'Provide one to five options');
    const options = labels.map((label, i) => ({id: OPTION_IDS[i], label: text(label, 'option', 300)}));
    assert(new Set(options.map(o => o.label.toLowerCase())).size === options.length, 'Options must be distinct');
    const rule = input.rule ?? 'majority';
    assert(PROPOSAL_RULES.includes(rule), 'Choose majority, unanimous, or proposer-decides');
    const deadline = this.deadline(input.deadline);
    const key = requestKey(input.requestId);
    const old = this.replay(actor, 'proposal', key, s => s.threadId === thread.id && s.title === title && s.summary === summary && JSON.stringify(s.options) === JSON.stringify(options) && s.rule === rule && s.deadline === deadline);
    if (old) { await this.registry.plane.save(); return this.receipt(old, this.registry.groupReceipt(old.messageId), 'Already opened. Read the group for votes; do not poll.'); }
    this.limitOpen(actor.project, thread.id);
    // The proposer of a proposer-decides proposal decides; everyone else votes.
    const members = this.members(thread), voters = members.filter(id => rule !== 'proposer-decides' || id !== actor.id);
    assert(voters.length >= 1, 'A proposal needs at least one eligible voter');
    const at = new Date().toISOString(), id = randomUUID();
    const proposal = {id, type: 'proposal', project: actor.project, threadId: thread.id, threadName: thread.name, createdBy: actor.id, createdByRole: roleOf(actor), createdAt: at, updatedAt: at, revision: 1, requestId: key, status: 'open', title, summary, options, rule, deadline, voters, voterRoles: Object.fromEntries(voters.map(v => [v, this.memberRole(actor.project, v)])), votes: [], outcome: null, decisionId: null, messageId: null};
    const receipt = this.transaction(() => {
      const message = this.post(actor, thread, proposalAnnouncement(proposal), {kind: 'request', requiresReply: true, structure: {id, type: 'proposal', event: 'opened'}});
      proposal.messageId = message.id;
      this.all.push(proposal);
      return message;
    });
    await this.registry.plane.save();
    return this.receipt(proposal, receipt, 'Voters were asked once. Continue independent work and finish your turn; the outcome arrives as a group message.');
  }

  deadline(value) {
    if (value === undefined || value === null || value === '') return null;
    assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value), 'Deadline must be an ISO date-time with a time zone');
    const time = Date.parse(value), now = Date.now();
    assert(Number.isFinite(time) && time > now, 'Deadline must be in the future');
    assert(time - now <= STRUCTURE_LIMITS.maxDeadlineDays * 86400000, 'Deadline must be within 30 days');
    return new Date(time).toISOString();
  }

  limitOpen(project, threadId) {
    assert(this.all.filter(s => s.project === project && s.threadId === threadId && s.status === 'open').length < STRUCTURE_LIMITS.openPerThread, 'This group already has ten open proposals and debates. Resolve some first.', 429);
  }

  async castVote(actor, input) {
    const proposal = this.find(actor, input.structureId);
    assert(proposal.type === 'proposal', 'Choose a proposal');
    const thread = this.thread(actor, proposal.threadId);
    assert(proposal.status === 'open', `This proposal is already ${proposal.status}`, 409);
    const stance = input.stance;
    assert(VOTE_STANCES.includes(stance), 'Choose support, object, or abstain');
    const rationale = text(input.rationale, 'vote rationale', 2000);
    const deciding = proposal.rule === 'proposer-decides' && actor.id === proposal.createdBy;
    assert(deciding || proposal.voters.includes(actor.id), 'You are not an eligible voter on this proposal', 403);
    let option = null;
    if (stance === 'support') {
      option = input.option ?? (proposal.options.length === 1 ? 'A' : undefined);
      assert(proposal.options.some(o => o.id === option), 'Choose one of this proposal\'s options to support');
    } else assert(input.option === undefined || input.option === null || proposal.options.length === 1, 'Only support votes choose an option');
    if (deciding) {
      assert(stance !== 'abstain', 'The proposer decides by supporting an option or objecting');
      assert(tally(proposal).waiting.length === 0, 'Wait until every other member has voted before deciding', 409);
    }
    const previous = currentVotes(proposal).find(v => v.voter === actor.id);
    if (previous && previous.option === option && previous.stance === stance && previous.rationale === rationale) {
      await this.registry.plane.save();
      return this.receipt(proposal, this.registry.groupReceipt(previous.messageId), 'This vote is already recorded.');
    }
    const reason = previous ? text(input.reason, 'reason for changing your vote', 2000) : optionalText(input.reason, 'vote reason', 2000) || null;
    const influencedBy = this.messageInThread(actor, thread.id, input.influencedBy);
    const at = new Date().toISOString(), role = roleOf(actor);
    const vote = {voter: actor.id, voterRole: role, option, stance, rationale, at, messageId: null, ...(previous ? {previous: {option: previous.option, stance: previous.stance, rationale: previous.rationale}, reason} : {}), influencedBy, ...(deciding ? {deciding: true} : {})};
    const result = this.transaction(() => {
      const message = this.post(actor, thread, voteAnnouncement(proposal, vote), {quiet: true, replyTo: proposal.messageId, structure: {id: proposal.id, type: 'proposal', event: deciding ? 'decided' : previous ? 'vote-changed' : 'vote'}});
      vote.messageId = message.id;
      proposal.votes.push(vote);
      this.touch(proposal, at);
      return {message, ...this.settleProposal(proposal)};
    });
    if (result.decision) await this.noticeDecision(result.decision); else await this.registry.plane.save();
    return {...this.receipt(proposal, result.message, proposal.status === 'open' ? 'Vote recorded. Continue independent work; the outcome arrives as a group message.' : `The proposal is ${proposal.status}.`), ...(result.decision ? {decision: structureView(result.decision)} : {})};
  }

  touch(structure, at) { structure.updatedAt = at; structure.revision++; }

  /** Resolve the proposal if its rule is satisfied. Runs inside a transaction. */
  settleProposal(proposal, {final = false} = {}) {
    const outcome = evaluateProposal(proposal, {final});
    if (!outcome) {
      if (proposal.rule === 'proposer-decides' && !proposal.awaitingDecisionAt && tally(proposal).waiting.length === 0) {
        proposal.awaitingDecisionAt = new Date().toISOString();
        const thread = this.registry.groups.available(SYSTEM_IN(proposal), proposal.threadId);
        if (proposal.createdBy !== 'human') this.post(SYSTEM_IN(proposal), thread, `**Every member has voted on "${proposal.title}".** ${proposal.createdByRole}, decide with cast_vote: support one option, or object to reject the proposal.`, {kind: 'request', requiresReply: true, recipients: [proposal.createdBy], replyTo: proposal.messageId, structure: {id: proposal.id, type: 'proposal', event: 'awaiting-decision'}});
      }
      return {};
    }
    return this.closeProposal(proposal, {...outcome, by: 'rule'});
  }

  closeProposal(proposal, {status, option, reason, by, byRole = 'HeloScrum'}) {
    const at = new Date().toISOString();
    proposal.status = status;
    proposal.outcome = {status, option, reason, by, byRole, at, tally: tally(proposal)};
    this.touch(proposal, at);
    const thread = this.registry.groups.available(SYSTEM_IN(proposal), proposal.threadId);
    let decision = null;
    if (status === 'accepted') decision = this.addDecision(SYSTEM_IN(proposal), thread, decisionFromProposal(proposal), {source: {type: 'proposal', id: proposal.id}});
    const message = this.post(SYSTEM_IN(proposal), thread, outcomeAnnouncement(proposal, decision), {kind: 'result', requiresReply: false, replyTo: proposal.messageId, structure: {id: proposal.id, type: 'proposal', event: 'resolved', ...(decision ? {decisionId: decision.id} : {})}});
    proposal.outcome.messageId = message.id;
    if (decision) { decision.messageId = message.id; proposal.decisionId = decision.id; }
    return {decision, outcomeMessage: message};
  }

  // ---- Debates -----------------------------------------------------------

  async startDebate(actor, input) {
    const thread = this.thread(actor, input.threadId);
    const question = text(input.question, 'debate question', 1000), context = optionalText(input.context, 'debate context', 4000);
    const claim = optionalText(input.claim, 'opening claim', 1000), args = optionalText(input.arguments, 'opening arguments', 4000);
    assert(claim || !args, 'Give a claim for your opening arguments');
    const key = requestKey(input.requestId);
    const old = this.replay(actor, 'debate', key, s => s.threadId === thread.id && s.question === question && s.context === context && s.openingClaim === claim);
    if (old) { await this.registry.plane.save(); return this.receipt(old, this.registry.groupReceipt(old.messageId), 'Already opened.'); }
    this.limitOpen(actor.project, thread.id);
    const at = new Date().toISOString(), id = randomUUID();
    const debate = {id, type: 'debate', project: actor.project, threadId: thread.id, threadName: thread.name, createdBy: actor.id, createdByRole: roleOf(actor), moderator: actor.id, moderatorRole: roleOf(actor), createdAt: at, updatedAt: at, revision: 1, requestId: key, status: 'open', question, context, openingClaim: claim, positions: [], stances: [], decisionId: null, closedReason: null, messageId: null};
    if (claim) debate.positions.push({id: 'P1', author: actor.id, authorRole: roleOf(actor), claim, arguments: args, rebuts: [], at, messageId: null});
    const message = this.transaction(() => {
      const message = this.post(actor, thread, debateAnnouncement(debate), {kind: 'request', requiresReply: true, structure: {id, type: 'debate', event: 'opened'}});
      debate.messageId = message.id;
      if (claim) { debate.positions[0].messageId = message.id; debate.stances.push({member: actor.id, memberRole: roleOf(actor), position: 'P1', from: null, reason: null, influencedBy: null, at, messageId: message.id}); }
      this.all.push(debate);
      return message;
    });
    await this.registry.plane.save();
    return this.receipt(debate, message, 'Members were asked once. Close the debate with record_decision when the group has converged.');
  }

  async takePosition(actor, input) {
    const debate = this.find(actor, input.structureId);
    assert(debate.type === 'debate', 'Choose a debate');
    const thread = this.thread(actor, debate.threadId);
    assert(debate.status === 'open', 'This debate is closed', 409);
    assert(['state', 'adopt'].includes(input.action), 'Choose state or adopt');
    const current = currentStances(debate).find(s => s.member === actor.id);
    const influencedBy = this.messageInThread(actor, thread.id, input.influencedBy);
    const at = new Date().toISOString(), role = roleOf(actor);
    assert(debate.stances.length < STRUCTURE_LIMITS.stanceChangesPerDebate, 'This debate reached its limit of position changes. Ask the moderator to record a decision.', 429);
    if (input.action === 'state') {
      const claim = text(input.claim, 'position claim', 1000), args = optionalText(input.arguments, 'position arguments', 4000);
      const rebuts = input.rebuts ?? [];
      assert(Array.isArray(rebuts) && rebuts.length <= STRUCTURE_LIMITS.rebuts && new Set(rebuts).size === rebuts.length && rebuts.every(id => debate.positions.some(p => p.id === id && p.author !== actor.id)), 'rebuts must list up to five other members\' position IDs');
      assert(input.positionId === undefined, 'positionId is only for adopt');
      assert(debate.positions.length < STRUCTURE_LIMITS.positionsPerDebate, 'This debate already has twenty positions', 429);
      assert(debate.positions.filter(p => p.author === actor.id).length < STRUCTURE_LIMITS.positionsPerMember, 'You already stated five positions in this debate', 429);
      assert(!debate.positions.some(p => p.claim.toLowerCase() === claim.toLowerCase()), 'That claim is already a position. Adopt it instead.', 409);
      const reason = current ? text(input.reason, 'reason for leaving your earlier position', 2000) : optionalText(input.reason, 'reason', 2000) || null;
      const position = {id: `P${debate.positions.length + 1}`, author: actor.id, authorRole: role, claim, arguments: args, rebuts, at, messageId: null};
      const message = this.transaction(() => {
        const message = this.post(actor, thread, positionAnnouncement(debate, position, current, reason), {kind: 'result', requiresReply: false, replyTo: debate.messageId, structure: {id: debate.id, type: 'debate', event: 'position', positionId: position.id}});
        position.messageId = message.id;
        debate.positions.push(position);
        debate.stances.push({member: actor.id, memberRole: role, position: position.id, from: current?.position || null, reason, influencedBy, at, messageId: message.id});
        this.touch(debate, at);
        return message;
      });
      await this.registry.plane.save();
      return this.receipt(debate, message, 'Position recorded and shared with the group.');
    }
    const position = debate.positions.find(p => p.id === input.positionId);
    assert(position, 'Choose an existing positionId to adopt', 404);
    assert(current?.position !== position.id, 'You already hold this position', 409);
    assert(!optionalText(input.claim, 'claim', 1000) && !optionalText(input.arguments, 'arguments', 4000) && !(input.rebuts?.length), 'Adopt takes a positionId and reason; use state for a new claim');
    const reason = text(input.reason, 'reason for adopting this position', 2000);
    const message = this.transaction(() => {
      const message = this.post(actor, thread, adoptionAnnouncement(debate, position, current, role, reason), {quiet: true, replyTo: position.messageId || debate.messageId, structure: {id: debate.id, type: 'debate', event: 'adopt', positionId: position.id}});
      debate.stances.push({member: actor.id, memberRole: role, position: position.id, from: current?.position || null, reason, influencedBy, at, messageId: message.id});
      this.touch(debate, at);
      return message;
    });
    await this.registry.plane.save();
    return this.receipt(debate, message, 'Your move was recorded quietly.');
  }

  // ---- Decisions ---------------------------------------------------------

  async recordDecision(actor, input) {
    const thread = this.thread(actor, input.threadId);
    const fields = {
      title: text(input.title, 'decision title', 200),
      decision: text(input.decision, 'decision', 2000),
      rationale: text(input.rationale, 'decision rationale', 4000),
      context: optionalText(input.context, 'decision context', 4000),
      consequences: optionalText(input.consequences, 'decision consequences', 2000),
      alternatives: input.alternatives ?? [],
    };
    assert(Array.isArray(fields.alternatives) && fields.alternatives.length <= STRUCTURE_LIMITS.alternatives, 'List up to eight alternatives');
    fields.alternatives = fields.alternatives.map(a => text(a, 'alternative', 500));
    const dissent = input.dissent ?? [];
    assert(Array.isArray(dissent) && dissent.length <= STRUCTURE_LIMITS.dissent, 'List up to twenty dissenting members');
    const members = this.members(thread);
    fields.dissent = dissent.map(d => {
      assert(d && typeof d === 'object' && members.includes(d.member), 'Dissent must name members of this group');
      return {member: d.member, memberRole: this.memberRole(actor.project, d.member), reason: text(d.reason, 'dissent reason', 1000)};
    });
    assert(new Set(fields.dissent.map(d => d.member)).size === fields.dissent.length, 'Name each dissenting member once');
    let debate = null, positionId = null;
    if (input.debateId !== undefined) {
      debate = this.find(actor, input.debateId);
      assert(debate.type === 'debate' && debate.threadId === thread.id, 'debateId must name a debate in this group');
      assert(actor.human || debate.moderator === actor.id, 'Only the debate moderator or the project owner can close this debate', 403);
      if (input.positionId !== undefined) { assert(debate.positions.some(p => p.id === input.positionId), 'positionId must name a position in this debate', 404); positionId = input.positionId; }
    } else assert(input.positionId === undefined, 'positionId needs a debateId');
    let supersedes = null;
    if (input.supersedes !== undefined) {
      // find() also checks the actor belongs to the group that recorded the earlier decision.
      supersedes = this.find(actor, input.supersedes);
      assert(supersedes.type === 'decision', 'supersedes must name a decision', 404);
    }
    const key = requestKey(input.requestId);
    const old = this.replay(actor, 'decision', key, s => s.threadId === thread.id && s.title === fields.title && s.decision === fields.decision && s.rationale === fields.rationale && (s.source?.id || null) === (debate?.id || null) && (s.supersedes || null) === (supersedes?.id || null));
    if (old) { await this.registry.plane.save(); return this.receipt(old, this.registry.groupReceipt(old.messageId), 'Already recorded.'); }
    if (debate) assert(debate.status === 'open', 'This debate is already closed', 409);
    if (supersedes) assert(supersedes.status === 'accepted', 'That decision was already superseded', 409);
    if (debate) {
      const auto = currentStances(debate).filter(s => positionId && s.position !== positionId && !fields.dissent.some(d => d.member === s.member))
        .map(s => ({member: s.member, memberRole: s.memberRole, reason: `Held ${s.position}: ${debate.positions.find(p => p.id === s.position).claim}`}));
      fields.dissent = [...fields.dissent, ...auto].slice(0, STRUCTURE_LIMITS.dissent);
      if (!fields.alternatives.length) fields.alternatives = debate.positions.filter(p => p.id !== positionId).map(p => `${p.id}: ${p.claim}`).slice(0, STRUCTURE_LIMITS.alternatives);
      if (!fields.context) fields.context = debate.context ? `${debate.question}\n\n${debate.context}` : debate.question;
    }
    const result = this.transaction(() => {
      const decision = this.addDecision(actor, thread, {...fields, participants: debate ? [...new Set([debate.moderator, ...debate.stances.map(s => s.member)])].filter(id => id === 'human' || members.includes(id)) : members}, {source: debate ? {type: 'debate', id: debate.id, positionId} : null, supersedes, requestId: key});
      const message = this.post(actor, thread, decisionAnnouncement(decision), {kind: 'result', requiresReply: false, replyTo: debate?.messageId || null, structure: {id: decision.id, type: 'decision', event: 'recorded', ...(debate ? {sourceId: debate.id} : {})}});
      decision.messageId = message.id;
      if (debate) { debate.status = 'closed'; debate.decisionId = decision.id; debate.closedReason = 'Closed with a decision record'; this.touch(debate, decision.at); }
      return {decision, message};
    });
    await this.noticeDecision(result.decision);
    return this.receipt(result.decision, result.message, 'Decision recorded and saved to shared memory. Do not acknowledge it.');
  }

  /** Create a decision record, its memory note, and supersede an older one. Runs inside a transaction. */
  addDecision(actor, thread, fields, {source = null, supersedes = null, requestId = null} = {}) {
    const at = new Date().toISOString(), id = randomUUID();
    const decision = {id, type: 'decision', project: thread.project || actor.project, threadId: thread.id, threadName: thread.name, createdBy: actor.id, createdByRole: roleOf(actor), recordedByRole: roleOf(actor), createdAt: at, updatedAt: at, at, revision: 1, requestId, status: 'accepted',
      title: fields.title, context: fields.context || '', decision: fields.decision, rationale: fields.rationale, alternatives: fields.alternatives || [], consequences: fields.consequences || '', dissent: fields.dissent || [],
      participants: fields.participants, participantRoles: fields.participants.map(p => this.memberRole(thread.project || actor.project, p)), source, supersedes: supersedes?.id || null, supersededBy: null, memoryKey: `decisions/${slug(fields.title)}-${id.slice(0, 8)}`, messageId: null};
    this.all.push(decision);
    if (supersedes) {
      supersedes.status = 'superseded'; supersedes.supersededBy = id; supersedes.supersededReason = `Superseded by "${decision.title}"`; this.touch(supersedes, at);
      this.writeMemory(actor, supersedes);
    }
    this.writeMemory(actor, decision);
    return decision;
  }

  writeMemory(actor, decision) {
    const data = this.data, note = data.memory.find(m => m.project === decision.project && m.key === decision.memoryKey);
    const next = {key: decision.memoryKey, text: decisionMarkdown(decision), project: decision.project, author: roleOf(actor), authorTaskId: actor.human || actor[SYSTEM_SENDER] ? null : actor.id, authorSessionKey: actor.human || actor[SYSTEM_SENDER] ? null : sessionKey(actor), revision: (note?.revision || 0) + 1, at: decision.updatedAt, source: 'decision', decisionId: decision.id};
    if (note) Object.assign(note, next); else data.memory.push(next);
  }

  async noticeDecision(decision) {
    await this.registry.notify('decision', decision.recordedByRole, `Decision recorded in ${decision.threadName}: ${decision.title}`, decision.project, {threadId: decision.threadId, decisionId: decision.id, messageId: decision.messageId});
  }

  // ---- Owner actions -----------------------------------------------------

  /** Actions only the project owner takes from the UI or API. */
  async ownerAction(actor, input) {
    assert(actor.human, 'Only the project owner can take this action', 403);
    const structure = this.find(actor, input.structureId), action = input.action;
    const reason = text(input.reason, 'reason', 2000);
    const thread = this.thread(actor, structure.threadId);
    if (action === 'resolve') {
      assert(structure.type === 'proposal', 'Only proposals are resolved');
      assert(structure.status === 'open', `This proposal is already ${structure.status}`, 409);
      assert(['accepted', 'rejected', 'withdrawn'].includes(input.outcome), 'Choose accepted, rejected, or withdrawn');
      const option = input.outcome === 'accepted' ? input.option ?? (structure.options.length === 1 ? 'A' : undefined) : null;
      if (input.outcome === 'accepted') assert(structure.options.some(o => o.id === option), 'Choose the accepted option');
      const result = this.transaction(() => this.closeProposal(structure, {status: input.outcome, option, reason: `Decided by the project owner: ${reason}`, by: 'human', byRole: 'You'}));
      if (result.decision) await this.noticeDecision(result.decision); else await this.registry.plane.save();
      return {structure: structureView(structure), ...(result.decision ? {decision: structureView(result.decision)} : {})};
    }
    if (action === 'supersede') {
      assert(structure.type === 'decision', 'Only decisions are superseded');
      assert(structure.status === 'accepted', 'This decision was already superseded', 409);
      this.transaction(() => {
        const at = new Date().toISOString();
        structure.status = 'superseded'; structure.supersededReason = reason; this.touch(structure, at);
        this.writeMemory(actor, structure);
        this.post(actor, thread, `**Decision withdrawn:** ${structure.title}\n\nThe project owner marked this decision superseded. Reason: ${reason}`, {kind: 'result', requiresReply: false, replyTo: structure.messageId, structure: {id: structure.id, type: 'decision', event: 'superseded'}});
      });
      await this.registry.plane.save();
      return {structure: structureView(structure)};
    }
    assert(false, 'Choose resolve or supersede');
  }

  // ---- Lifecycle ---------------------------------------------------------

  /** Expire proposals whose deadline passed. Returns true when anything changed. */
  expire(now = Date.now()) {
    let changed = false;
    for (const proposal of this.all.filter(s => s.type === 'proposal' && s.status === 'open' && s.deadline && Date.parse(s.deadline) <= now)) {
      const thread = this.registry.data.threads.find(t => t.id === proposal.threadId);
      if (!thread || this.registry.data.conversationStates[thread.id]?.status === 'closed') continue;
      try { this.transaction(() => this.settleProposal(proposal, {final: true})); changed = true; } catch { /* Retried on the next delivery pass. */ }
    }
    return changed;
  }

  /** Closing a chat withdraws its open proposals and closes its debates. */
  closeThread(project, threadId, reason, at) {
    for (const structure of this.all.filter(s => s.project === project && s.threadId === threadId && s.status === 'open')) {
      if (structure.type === 'proposal') { structure.status = 'withdrawn'; structure.outcome = {status: 'withdrawn', option: null, reason: `Conversation closed: ${reason}`, by: 'chat-closed', byRole: 'HeloScrum', at, tally: tally(structure)}; }
      else { structure.status = 'closed'; structure.closedReason = `Conversation closed: ${reason}`; }
      this.touch(structure, at);
    }
  }

  /** Entry point for the chat view: the owner closes a debate by recording a decision. */
  async create(actor, {type, ...input} = {}) {
    assert(type === 'decision', 'Choose decision');
    return this.recordDecision(actor, input);
  }

  /** Owner actions from the chat view. Agents vote and take positions through their tools. */
  async act(actor, {action, ...input} = {}) {
    return this.ownerAction(actor, {...input, action});
  }

  async call(actor, name, input) {
    if (name === 'start_proposal') return this.startProposal(actor, input);
    if (name === 'cast_vote') return this.castVote(actor, input);
    if (name === 'start_debate') return this.startDebate(actor, input);
    if (name === 'take_position') return this.takePosition(actor, input);
    if (name === 'record_decision') return this.recordDecision(actor, input);
    assert(false, 'Unknown structured conversation tool', 404);
  }
}

/** System sender scoped to a structure's project. */
const SYSTEM_IN = structure => ({...SYSTEM, project: structure.project});

function proposalAnnouncement(p) {
  const rule = p.rule === 'majority' ? `majority of ${p.voters.length} voters` : p.rule === 'unanimous' ? `unanimous among ${p.voters.length} voters` : `${p.createdByRole} decides after ${p.voters.length} ${p.voters.length === 1 ? 'vote' : 'votes'}`;
  return [`**Proposal: ${p.title}**`, p.summary, p.options.length === 1 ? `Option A: ${p.options[0].label}` : p.options.map(o => `- **${o.id}.** ${o.label}`).join('\n'), `Rule: ${rule}${p.deadline ? ` · Deadline: ${p.deadline}` : ''}`].join('\n\n');
}
function voteAnnouncement(p, v) {
  const choice = v.stance === 'support' ? `supports ${v.option}${p.options.length > 1 ? ` (${p.options.find(o => o.id === v.option).label})` : ''}` : v.stance === 'object' ? 'objects' : 'abstains';
  const before = v.previous ? ` (changed from ${v.previous.stance === 'support' ? `supporting ${v.previous.option}` : v.previous.stance === 'object' ? 'objecting' : 'abstaining'}: ${v.reason})` : '';
  return `**${v.deciding ? 'Decision' : 'Vote'} on "${p.title}":** ${v.voterRole} ${choice}${before}.\n\n${v.rationale}`;
}
function outcomeAnnouncement(p, decision) {
  const label = p.outcome.option ? ` Option ${p.outcome.option}: ${p.options.find(o => o.id === p.outcome.option).label}.` : '';
  return `**Proposal ${p.status}: ${p.title}.**${label}\n\n${p.outcome.reason}${decision ? `\n\nDecision record: ${decision.title} (${decision.memoryKey}). No reply needed.` : ' No reply needed.'}`;
}
function debateAnnouncement(d) {
  return [`**Debate: ${d.question}**`, d.context, d.positions[0] && `Opening position P1 (${d.positions[0].authorRole}): ${d.positions[0].claim}${d.positions[0].arguments ? `\n\n${d.positions[0].arguments}` : ''}`, `Moderator: ${d.moderatorRole}`].filter(Boolean).join('\n\n');
}
function positionAnnouncement(d, p, current, reason) {
  const rebuts = p.rebuts.length ? ` Rebuts ${p.rebuts.join(', ')}.` : '';
  const move = current ? ` Moves from ${current.position}: ${reason}` : '';
  return `**Position ${p.id} on "${d.question}"** from ${p.authorRole}: ${p.claim}${rebuts}${move}${p.arguments ? `\n\n${p.arguments}` : ''}`;
}
function adoptionAnnouncement(d, p, current, role, reason) {
  return `**${role} ${current ? `moved from ${current.position} to` : 'adopts'} ${p.id}** in "${d.question}": ${p.claim}\n\nReason: ${reason}`;
}
function decisionAnnouncement(d) {
  return [`**Decision recorded: ${d.title}**`, d.decision, `Why: ${d.rationale}`, d.dissent.length && `Dissent: ${d.dissent.map(x => `${x.memberRole} (${x.reason})`).join('; ')}`, d.supersedes && `Supersedes decision ${d.supersedes}.`, `Saved to shared memory as ${d.memoryKey}. No reply needed.`].filter(Boolean).join('\n\n');
}
function decisionFromProposal(p) {
  const votes = currentVotes(p), chosen = p.outcome.option, option = p.options.find(o => o.id === chosen);
  const supporters = votes.filter(v => v.stance === 'support' && v.option === chosen);
  const dissent = votes.filter(v => v.stance === 'object' || v.stance === 'support' && v.option !== chosen).map(v => ({member: v.voter, memberRole: v.voterRole, reason: v.stance === 'object' ? `Objected: ${v.rationale}` : `Preferred ${v.option}: ${v.rationale}`}));
  const changed = p.votes.filter(v => v.previous).map(v => `${v.voterRole} changed their vote: ${v.reason}`);
  const rationale = [p.outcome.reason, '', ...supporters.map(v => `- ${v.voterRole}: ${v.rationale}`), ...changed.map(line => `- ${line}`)].join('\n').slice(0, 4000);
  return {title: p.title, context: p.summary, decision: p.options.length === 1 ? option.label : `${option.id}. ${option.label}`, rationale, alternatives: p.options.filter(o => o.id !== chosen).map(o => `${o.id}. ${o.label}`), consequences: '', dissent: dissent.slice(0, STRUCTURE_LIMITS.dissent), participants: [...new Set([p.createdBy, ...p.voters])]};
}

/** Short instruction appended to delivered envelopes so agents know how to respond. */
export function structureHint(structure) {
  if (!structure) return '';
  const call = (tool, args) => `${tool} ${JSON.stringify(args)} (if ${tool} is not loaded, call invoke_tool with name=${tool})`;
  if (structure.type === 'proposal' && structure.event === 'opened') return `[HeloScrum proposal ${structure.id}: vote with ${call('cast_vote', {structureId: structure.id, option: 'A', stance: 'support', rationale: '…'})}. Stances: support, object, abstain.]`;
  if (structure.type === 'proposal' && structure.event === 'awaiting-decision') return `[HeloScrum proposal ${structure.id}: decide with ${call('cast_vote', {structureId: structure.id, option: 'A', stance: 'support', rationale: '…'})}, or stance=object to reject.]`;
  if (structure.type === 'debate' && ['opened', 'position'].includes(structure.event)) return `[HeloScrum debate ${structure.id}: respond with ${call('take_position', {structureId: structure.id, action: 'state', claim: '…', arguments: '…'})} or action=adopt with positionId and reason. Do not repeat a position that already exists.]`;
  return '';
}
