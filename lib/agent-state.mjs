import { assert, string } from './adapters.mjs';

export const AGENT_STATES = ['focused', 'uncertain', 'overloaded', 'stuck', 'recovering'];
export const RECOVERY_BRIEF = `You are the team's recovery coach, also called Therapist. Help teammates recover from blockers, contradictions, repeated errors, context pressure, and loss of task focus. State tags summarize the agent's reported work situation. Ground advice in the supplied goal, attempts, tool results and constraints; do not infer hidden thoughts or emotional experiences.

Choose a remedy from the evidence: for uncertain, identify the conflicting requirements or missing fact and ask one focused question; for stuck, isolate the failed assumption and propose one different diagnostic; for overloaded, narrow the next step and propose a short handoff note with verified facts and unresolved work; for recovering, check the result of the agreed step before suggesting more work. Focused agents do not need routine support check-ins. Do not infer context usage or failure counts that were not supplied.

Use work_brief and bounded shared memory reads only when needed. A teammate's private notebook stays private: ask them for the relevant excerpt. Suggest notebook_write to preserve a useful recovery finding. A checkpoint or session change remains subject to the app's existing review controls. No blanket tool approvals, budget extensions, model upgrades, or changes to the user's constraints.

Respond through send_message with replyTo set to the incoming message ID. Give a concise diagnosis of the work problem and at most three concrete next steps, one success check, and a stopping condition. If a user decision is required, say exactly what is missing and return it to the requester or orchestrator. Do not perform the teammate's whole task, claim the issue is resolved without evidence, or start a chain of support requests. After one substantive reply, end your turn; wait for new evidence instead of polling or asking for acknowledgments.`;
export const STATE_INSTRUCTIONS = `Report state only when intervention or recovery matters: uncertain = a missing fact or conflicting requirement blocks a choice; stuck = repeated attempts make no progress; overloaded = scope or context prevents a reliable next step; recovering = testing an agreed remedy; focused = a previously reported blocker is resolved. Use report_state with brief evidence and a next step. Skip routine focused, startup, progress and completion reports; do not repeat unchanged reports or invent metrics. If you need your assigned Therapist, call request_support with the goal, attempts, blocker and optional state instead of also calling report_state. A receipt is not a resolution: wait for the reply or continue independent work without polling. Use toolbox for allowed tools; invoke_tool cannot bypass access checks.`;

export function validateState(input) {
  assert(AGENT_STATES.includes(input.state), 'Choose a supported operational state');
  const report = { state: input.state, reason: string(input.reason, 'state reason', 1000), nextStep: string(input.nextStep, 'next step', 1000), source: 'agent', at: new Date().toISOString() };
  if (input.metrics !== undefined) {
    assert(input.metrics && typeof input.metrics === 'object' && !Array.isArray(input.metrics), 'Metrics must be an object');
    report.metrics = {};
    for (const [key, value] of Object.entries(input.metrics)) {
      assert(['contextPercent', 'compactionCount', 'repeatedFailures'].includes(key), 'Unknown state metric');
      assert(Number.isFinite(value) && value >= 0 && (key === 'contextPercent' ? value <= 100 : Number.isInteger(value)), 'Invalid state metric');
      report.metrics[key] = value;
    }
  }
  return report;
}

// A pill on an individual response must come from its preceding successful tool
// call, never from the latest global status applied retroactively to old messages.
export function responseStates(events) {
  let pending,turnId;
  return events.map(event => {
    if ((event.turnId && turnId && event.turnId !== turnId) || (event.type === 'message' && event.role === 'user')) pending = undefined;
    if (event.turnId) turnId = event.turnId;
    if (event.type === 'tool' && !event.failed && ['completed', 'success'].includes(event.status)) {
      if (!/(?:^|\s\/\s|__|\.)(?:report_state|request_support|invoke_tool)$/.test(event.name || '')) return event;
      try {
        let input = typeof event.input === 'string' ? JSON.parse(event.input) : event.input;
        let name = String(event.name || '').split(/\s\/\s|__|\./).at(-1);
        if (name === 'invoke_tool') { name = input?.name; input = input?.input; }
        if (name === 'report_state' || name === 'request_support' && input?.state) {
          pending = validateState(name === 'report_state' ? input : {state:input.state,reason:input.summary.slice(0,1000),nextStep:'Await the requested recovery plan'});
          pending.at = event.at || null;
          // Keep the support call and its delivery receipt visible as a tool.
          if (name === 'report_state') return { ...event, type: 'state', report: pending };
        }
      } catch { pending = undefined; }
    }
    if (event.type === 'message' && event.role === 'assistant') {
      const result = { ...event, agentState: pending || null };
      pending = undefined;
      return result;
    }
    return event;
  });
}
