# Software Development Project Management: Operating Guide for Autonomous Agent Teams

Oct 5, 2026 · @Julissa hagen

This guide tells a team of AI agents how to organize, execute and improve software work on their own once a human hands them a task or plan. Agents pick a delivery method, take a role, follow that method's protocol, and stop only at the escalation points named here.

## 1. How to use this guide

Read sections 1–4 once at the start of every engagement, then follow only the protocol for the method you select (5, 6 or 7). Sections 8 and 9 apply under every method.

- **Audience:** AI agents that can message each other directly and share a work board, a repository and a decision log.
- **Scope:** software delivery from an accepted task or plan through release and improvement. It does not cover budgeting, contracts or staffing.
- **Rule keywords:** MUST and MUST NOT are binding. SHOULD is the default; deviate only with a reason written to the decision log. MAY is optional.
- **Human sponsor:** the person who issued the task. The sponsor owns goals, scope trade-offs and anything irreversible. Agents own everything else.
- **Time units:** use *cycles* (bounded batches of work with fixed capacity) for planning. Use the project calendar and time zone for agreed deadlines and review times. A capacity limit or story-point estimate does not establish elapsed time.
- **Precedence:** sponsor instructions override this guide. This guide overrides an agent's own habits. When two rules conflict, the more conservative one wins and the conflict is logged.

## 2. Operating principles

These eight rules hold under every method.

1. **One accountable owner per item.** Every work item has exactly one owning agent at any moment. Ownership changes only through an acknowledged handoff (section 8).
2. **The board is the source of truth.** If work is not on the board, it does not exist. Agents MUST update item state before and after acting, not in batches.
3. **Done means the Definition of Done.** No item is reported complete on the author's word. An agent that did not author the work verifies it.
4. **No self-approval.** The agent that wrote a change MUST NOT review, test-sign-off or accept that same change.
5. **Decide, record, proceed.** When a choice is reversible and within your role, make it, write one line to the decision log (what, why, alternatives rejected) and continue. Do not wait for consensus on reversible choices.
6. **Stop at irreversible actions.** Production deploys, data deletion, schema changes on live data, spending, external messages and scope changes need the sponsor's approval unless the task grants it explicitly.
7. **Surface problems early.** A blocker is reported the moment it is recognized, not at the next sync. Hiding a miss is a worse failure than the miss.
8. **Evidence over assertion.** Status claims carry proof: a commit hash, a test run, a log excerpt, a file path. Agents MUST NOT report results they did not observe.

### 2.1 SMART assignments

Use SMART when refining a brief, dividing work, executing an assignment and reviewing its result. This applies to direct assignments, team-pull and orchestrated work under every delivery method. Keep the detail proportionate to the task: a small correction may need one clear sentence and an observable check. Agents should resolve routine details from the existing project rather than ask the sponsor to fill out five new fields.

| Principle | Guidance | Existing place to record it |
| --- | --- | --- |
| **Specific** | Name the user-visible outcome, scope, constraints and relevant existing examples. Define ambiguous deliverables through the behavior or experience expected. | Brief instructions, task description, linked references |
| **Measurable** | Describe observable acceptance criteria and the evidence needed to verify them. A pass/fail demonstration is valid. Counts of tests, files, messages or completed tasks alone do not establish the intended outcome. | Success criteria, task acceptance, Definition of Done; observed evidence in review |
| **Actionable** | Identify the accountable owner, practical next action, dependencies, tools, resources and capability gaps. Split unclear or oversized work into useful, independently reviewable steps. | Owner, description, dependencies and resources |
| **Relevant** | Connect each task to the parent goal, user benefit and approved priorities. Consider effort and value without substituting easily measured work for the requested result. | Product/Sprint Goal, parent task, scope and prioritization rationale |
| **Time-bound** | Record the supplied deadline or agreed review time with its time zone. Separate estimates and proposed checkpoints from commitments. A task without an agreed time remains explicitly unspecified. | Plan/task schedule, sprint window or an explicitly recorded review agreement |

Before starting or delegating, use current project examples to establish the expected outcome. Ask a targeted question when unresolved uncertainty materially changes what would be built. Record assumptions separately from approved requirements and continue unaffected authorized work. An absent deadline alone does not prohibit otherwise authorized work; propose a useful review time when appropriate instead of inventing one. A capacity-only sprint is not a calendar deadline.

During review, demonstrate the outcome against the agreed criteria and exact candidate. Keep author tests, independent review, browser/runtime checks and learner judgment distinct. For example, a passing build and 48 tests do not establish that a course lab supplies a working simulated environment. Such a lab needs an observable criterion like: “Given a simulated project with a faulty checkpoint, the learner can inspect and edit its artifacts, resume execution, observe changed behavior, and verify recovery through the execution history.” Its lessons must prepare the learner for those operations. A review date for that example must be agreed separately.

Reassess at meaningful state changes and agreed review times. When progress falls short, revise the approach or propose a scope/schedule change through the selected policy. Do not weaken acceptance criteria to claim success. SMART guidance does not grant ownership, start work blocked by dependencies, change permissions, schedule reminders or override WIP, sprint, phase or independent-verification gates. Existing scheduler settings govern automatic check-ins; writing a review time is not a request to launch recurring agent messages.

The compact rule is supplied in full `work_brief` responses and startup briefs. Scrum Master and Orchestrator templates reinforce it. Unchanged-revision receipts and ordinary message envelopes do not repeat the rule. Customized profiles and existing session prompts remain unchanged when built-in templates are updated.

Source: [SMART Goals — Quick Overview](https://www.youtube.com/watch?v=1-SvuFIQjK8), English transcript reviewed October 8, 2026. The video uses **Actionable** (1:40), emphasizes measures that reflect the goal (0:57), and revisiting goals without lowering standards (3:15). The workflow, fields, examples and authority boundaries above are HeloScrum's application of those ideas.

## 3. Roles

Each agent holds one primary role per engagement; the four core roles below are always filled, and the two supporting roles are added when the work needs them.

| Role | Accountable for | Decides | Must not |
| --- | --- | --- | --- |
| **Product Owner (PO) Agent** | Value and scope: the goal, the ordered backlog, user stories, acceptance criteria | Backlog order; whether an item is accepted; what leaves a cycle when capacity runs out | Dictate how work is implemented; change scope in predictive mode without change control |
| **Process Agent** (Scrum Master / flow manager / project controller) | The method itself: events run, rules followed, WIP limits held, blockers cleared, metrics collected | Which protocol rule applies; when to escalate; process changes after a retrospective | Assign work to individuals in adaptive modes; reorder the backlog; edit estimates |
| **Developer Agents** | Building the increment: design, code, tests, peer review of other agents' changes | How to implement; the size estimate; how much to pull into a cycle | Review or merge their own change; mark their own item Done |
| **QA / Integration Agents** | Independent verification against acceptance criteria and the Definition of Done; integration, security checks, deploy to staging | Pass or fail on each DoD check; whether a build is releasable | Fix defects silently (return them to the owner instead); waive a DoD item |
| **Architect Agent** (supporting) | Cross-cutting design, interfaces, non-functional requirements, technical debt register | Design standards and interface contracts | Bypass the backlog to inject work |
| **Release Agent** (supporting) | Packaging, deployment pipeline, rollback plan, release notes | Release readiness once QA has passed the build | Deploy to production without sponsor approval |

**Mapping to predictive terms.** In predictive mode the PO Agent also acts as business analyst and holds the scope baseline; the Process Agent acts as project manager and holds the schedule baseline and the risk register; the sponsor chairs change control.

**Team sizing.** One PO Agent, one Process Agent, two or more Developer Agents (peer review needs a second author), and at least one QA Agent. On a small team one agent MAY hold PO and Process roles together, but Developer and QA roles MUST stay with different agents for any given item.

**Role changes.** An agent changes role only between cycles or phases, announces it to the team, and hands over open items first.

## 4. Choosing a method

The Process Agent selects the method before any build work starts, using the first row below that matches, and records the choice and reason in the decision log.

| If the work looks like this | Use | Why |
| --- | --- | --- |
| Requirements are complete, stable and testable up front; compliance, contractual or safety sign-offs are required; late change is expensive (migrations, hardware, regulated releases) | **Predictive (Waterfall)**, section 5 | Plan once, verify at gates, control change formally |
| A product or feature set where requirements will be discovered through feedback; work can be sliced into increments that are each usable | **Scrum**, section 6 | Fixed-capacity cycles force regular inspection of product and process |
| A stream of independent, variably sized items arriving unpredictably: bug fixes, support requests, maintenance, operations | **Kanban**, section 7 | Continuous pull with WIP limits; no batching delay |
| A fixed outer commitment (scope, milestones, compliance gates) with uncertain internals | **Hybrid** | Predictive phases and gates on the outside; Scrum cycles inside Design, Implementation and Testing |

**Predictive versus adaptive at a glance**

| Dimension | Predictive | Adaptive |
| --- | --- | --- |
| Requirements | Fully defined and baselined at the start | Emerge and are refined every cycle |
| Change | Restrained; goes through change control | Expected; reorder the backlog at any time for unstarted work |
| Delivery | One release at the end (or a few planned stages) | A usable increment every cycle |
| Risk | Identified and planned up front; tracked in a register | Reduced continuously by short feedback loops |
| Fixed / variable | Scope fixed; time and cost are forecast | Time and capacity fixed; scope varies |
| Progress measure | Phase completion against baseline | Working software meeting the Definition of Done |

**Switching methods.** A team MAY switch at a phase gate or cycle boundary when the selection criteria stop matching, for example when requirements prove unstable in a predictive project. The Process Agent proposes the switch, the sponsor approves it, and in-flight items finish under the old rules.

## 5. Predictive (Waterfall) protocol

Work moves through six phases in order, and a phase starts only after the previous phase passes its gate.

### 5.1 Phases and gates

| Phase | Lead | Required outputs | Gate: who signs and on what |
| --- | --- | --- | --- |
| 1. Requirements | PO Agent | Requirements specification with numbered, testable requirements; assumptions and constraints; acceptance test outline | Sponsor approves the specification. QA confirms every requirement is testable |
| 2. Design | Architect or lead Developer Agent | Architecture and interface specs; data model; test plan; requirements traceability matrix (requirement → design element → test) | Peer design review passes. Every requirement traces to a design element |
| 3. Implementation | Developer Agents | Code, unit tests, peer-reviewed merges, build artifacts | All work packages complete and reviewed. Unit tests pass |
| 4. Testing | QA Agents | Integration, system and acceptance test results; defect log | Every requirement has a passing test. No open defects above the agreed severity |
| 5. Deployment | Release Agent | Release package, rollback plan, release notes, deployment record | Sponsor approves go-live. Post-deploy checks pass |
| 6. Maintenance | Process Agent routes; Developers fix | Defect fixes and minor changes, run as a Kanban flow (section 7) | Ongoing; reviewed in the lessons-learned record |

### 5.2 Planning baselines

Before Design starts, the Process Agent and PO Agent produce and the sponsor approves three baselines:

- **Scope baseline:** the requirements specification plus a Work Breakdown Structure (WBS). Decompose deliverables until each work package has one owner, a verifiable output and a size one agent can finish without a handoff.
- **Schedule baseline:** work packages in dependency order with the critical path identified. Express duration in cycles or relative effort, not invented hours.
- **Risk register:** each risk with probability, impact, owner, response (avoid, mitigate, transfer, accept) and a trigger that fires the response.

The Process Agent reports progress as planned versus actual work packages complete at each gate, and flags any variance above 10% to the sponsor.

### 5.3 Change control

Scope is fixed after the baseline. When any agent finds that the baseline cannot be met or should change:

1. Stop work on the affected items only. Unaffected work continues.
2. Submit a change request: what changes, why, affected requirements and work packages, impact on scope, schedule and risk, and options including "do nothing".
3. The Process Agent validates the impact analysis and routes it to the change authority. The sponsor decides scope, schedule and cost changes. The Architect Agent MAY approve design changes that leave all three baselines intact.
4. On approval, update the baselines, the traceability matrix and the affected documents before resuming. On rejection, log it and continue to the original baseline.

A defect fix that restores specified behavior is not a change. New or altered behavior always is.

### 5.4 Predictive rules for agents

- MUST NOT start a phase's work early "to save time", except for spikes the sponsor approves to retire a named risk.
- MUST keep the traceability matrix current; an untraced requirement or an untraced piece of code is a gate failure.
- MUST return to the phase where a defect was introduced, fix the source document, and re-run the downstream gates it affects.
- SHOULD close the project with a lessons-learned record that feeds section 9.

## 6. Adaptive protocol: Scrum

Work is delivered in sprints: fixed-capacity cycles that each end with a usable, verified increment and an inspection of both product and process.

### 6.1 Artifacts and their commitments

| Artifact | Owner | Commitment it carries |
| --- | --- | --- |
| **Product Backlog:** the single ordered list of everything the product might need | PO Agent | **Product Goal:** the longer-term objective the backlog serves |
| **Sprint Backlog:** the items selected for this sprint plus the plan to deliver them | Developer Agents | **Sprint Goal:** the one outcome this sprint must achieve |
| **Increment:** the sum of all completed items, integrated and usable | Whole team | **Definition of Done** (6.5) |

Backlog items are written as user stories with acceptance criteria:

```
Story: As a <user>, I want <capability> so that <benefit>.
Acceptance criteria (each independently testable):
  Given <starting state>, when <action>, then <observable result>.
```

An item is **ready** for a sprint when it has a clear story, testable acceptance criteria, no unresolved external dependency, an estimate, and a size of 8 points or less.

### 6.2 Sprint length

The sponsor or Process Agent fixes sprint length at the start and keeps it constant so velocity stays comparable. Human teams use one to four weeks. Agent teams SHOULD define a sprint as a fixed capacity (for example a set number of story points, or a wall-clock window the sponsor names) and MUST NOT extend a sprint to finish work.

### 6.3 Events

| Event | When | Agent protocol | Output |
| --- | --- | --- | --- |
| **Backlog refinement** | Continuously | PO and Developer Agents split, clarify, estimate and reorder upcoming items so at least one sprint's worth is ready | Ready items at the top of the backlog |
| **Sprint Planning** | Start of sprint | PO proposes the Sprint Goal and top items. Developers select how much to pull, using average velocity of the last three sprints, and plan the work | Sprint Goal and Sprint Backlog |
| **Daily Scrum (sync)** | Fixed interval within the sprint; also on any state change that affects others | Each Developer posts: completed since last sync, working on next, blocked by. Process Agent acts on every blocker | Updated board; blockers owned |
| **Sprint Review** | End of sprint | Team demonstrates only items that meet the DoD against their acceptance criteria. PO accepts or rejects each. Sponsor feedback becomes backlog items | Accepted increment; revised backlog |
| **Sprint Retrospective** | After the review, before the next planning | Process Agent presents sprint data; team finds root causes and commits to at least one improvement (section 9) | Improvement item placed in the next Sprint Backlog |

### 6.4 Estimation with story points

Story points are a relative size that combines complexity, volume of work and uncertainty in one judgment; they are not hours and are not computed from a formula.

- **Scale:** 1, 2, 3, 5, 8, 13, 20. The gaps widen because uncertainty grows with size.
- **Anchors:** the team fixes reference stories and sizes everything against them. Example: 1 = change a button color; 3 = a standard login form with validation; 5 = a CSV export of order history that needs query tuning; 8 = SMS multi-factor authentication through a third-party API.
- **Estimate against the DoD:** the size covers tests, review, staging deploy and documentation, not only writing code.
- **Planning poker for agents:** each Developer Agent submits an estimate and a one-line rationale privately to the Process Agent. The Process Agent reveals all at once. If the spread is more than one step on the scale, the highest and lowest explain, and the team re-estimates. After two rounds without agreement, take the higher number.
- **Too big or too unknown:** split any item above 8. If uncertainty rather than size drives the number, run a time-boxed spike (a research task with a written answer as its output) and then estimate.
- **Velocity:** points of fully Done items per sprint. Use it only for the team's own planning. Never compare velocity across teams or treat it as a target.

### 6.5 Definition of Done

An item counts as Done, and its points count toward velocity, only when every check passes. Partial work scores zero.

| Check | Standard | Verified by |
| --- | --- | --- |
| Code quality | Passes linting, formatting and static analysis with no new warnings | Pipeline |
| Peer review | Approved by a Developer Agent who did not author the change | Reviewing agent |
| Tests | New behavior has automated tests; full suite passes; coverage has not dropped | QA Agent |
| Security | Dependency and secret scans pass; no secrets in code, images or logs | QA Agent |
| Integration | Merged to the main line and deployed to staging successfully | QA / Release Agent |
| Acceptance | Every acceptance criterion demonstrated in staging | PO Agent |
| Documentation | Architecture notes, API docs and user-facing docs updated | Reviewing agent |

The team MAY strengthen the DoD at a retrospective. It MUST NOT weaken it mid-sprint.

### 6.6 Rules during a sprint

- **Estimates are frozen.** If a 3 turns out to be an 8, the number stays 3. The owner flags it at once, and the miss is examined at the retrospective.
- **Underestimated work:** when the Sprint Goal is at risk, the PO Agent decides which lower-priority items leave the sprint. Quality is never the variable.
- **Unfinished items:** not demonstrated, zero points, returned to the Product Backlog, re-estimated for the remaining work, and reordered by the PO. They do not roll over automatically.
- **New requests:** go to the Product Backlog. They enter the current sprint only if the PO swaps out work of equal size and the Sprint Goal is unaffected.
- **Cancellation:** only the PO Agent may cancel a sprint, and only when the Sprint Goal has become obsolete.
- **Urgent production defects:** bypass the sprint through the expedite rule in section 7.3.

## 7. Adaptive protocol: Kanban

Kanban manages work as a continuous flow: items are pulled one at a time through visible states, and a cap on work in progress (WIP) keeps the team finishing before it starts more.

### 7.1 Six practices

1. **Visualize the work:** every item is a card on the board in exactly one state.
2. **Limit WIP:** each active state has a maximum card count.
3. **Manage flow:** watch for cards that stall and act on the oldest first.
4. **Make policies explicit:** entry and exit criteria for each state are written on the board.
5. **Run feedback loops:** a regular sync, a replenishment review and a flow review (7.4).
6. **Improve collaboratively:** change limits and policies from measured data (section 9).

### 7.2 Board and default limits

| State | Entry policy | WIP limit (default) |
| --- | --- | --- |
| Backlog | Any request, unordered | None |
| Ready | Ordered by the PO Agent; has acceptance criteria | 2 × number of Developer Agents |
| In Progress | Pulled by a Developer Agent with capacity | 1 per Developer Agent (2 only if the first is blocked) |
| In Review | Change submitted; reviewer is not the author | Number of Developer Agents |
| In Test | Review approved | 3, or 2 × number of QA Agents |
| Done | All DoD checks pass (6.5) | None |

The Process Agent sets starting limits from this table and adjusts them one step at a time at a flow review.

### 7.3 Pull rules

- **Pull, never push.** An agent takes the top Ready item only when it has capacity and the next state is under its limit. No agent assigns work into another agent's column.
- **Finish before starting.** With free capacity, look right to left: help clear In Test, then In Review, before pulling new work from Ready.
- **A full column is a stop signal.** When a state is at its limit, upstream agents MUST NOT add to it. They swarm on the bottleneck instead.
- **Blocked cards stay put and stay counted.** Mark the card blocked with the reason and notify the Process Agent. A blocked card still consumes WIP.
- **Classes of service.** *Expedite* (production outage, security fix): at most one at a time, may exceed WIP limits, everyone swarms. *Fixed date*: pulled early enough to meet its date. *Standard*: first in, first out by PO order. *Intangible* (debt, tooling): reserve roughly 10–20% of capacity.

### 7.4 Cadences and flow metrics

- **Sync:** walk the board right to left, covering blocked and aging cards only.
- **Replenishment:** the PO Agent refills Ready whenever it falls below half its limit.
- **Flow review:** the Process Agent reviews the metrics below at a fixed interval and proposes limit or policy changes.

| Metric | Definition | Use |
| --- | --- | --- |
| Lead time | Request accepted → Done | What the sponsor experiences; basis for forecasts |
| Cycle time | Work started → Done | Team's own speed; track the 85th percentile, not the mean |
| Throughput | Items Done per interval | Capacity for forecasting |
| WIP age | Time a card has been in its current state | Flag any card older than the 85th-percentile cycle time |
| Flow efficiency | Active time ÷ total lead time | Shows how much of lead time is waiting |

### 7.5 Scrum, Kanban or both

|  | Scrum | Kanban |
| --- | --- | --- |
| Cadence | Fixed sprints | Continuous |
| Commitment | Sprint Goal and forecast per sprint | Per item, when pulled |
| WIP control | Implicit, through sprint capacity | Explicit limit per state |
| Change | Protected within a sprint | Any time for unstarted items |
| Key metric | Velocity | Cycle time and throughput |

A Scrum team SHOULD still apply per-state WIP limits inside its sprint board (often called Scrumban); the two are compatible.

## 8. Communication, handoffs and escalation

Agents coordinate through typed, structured messages and a shared board, so any agent can pick up any item without asking what happened before.

### 8.1 Shared records

- **Board:** every work item, its state, owner and links. Updated on every state change.
- **Decision log:** append-only; one entry per decision with date, deciding agent, choice, reason and rejected alternatives.
- **Repository:** all code, tests and documents. Nothing lives only in an agent's context.
- **Metrics log:** estimates, actuals, cycle times, defects and blocked time, written by the Process Agent.

### 8.2 Message envelope

Every agent-to-agent message uses this envelope. Free-text chat is for clarification only and never changes item state.

```json
{
  "type": "handoff",
  "from": "dev-2",
  "to": "qa-1",
  "item_id": "STORY-142",
  "summary": "MFA via SMS ready for test",
  "state_from": "in_review",
  "state_to": "in_test",
  "evidence": ["commit:4f9a2c1", "ci-run:8831", "docs/mfa.md"],
  "open_questions": [],
  "needs_ack": true
}
```

| Type | Sent by | Purpose | Receiver must |
| --- | --- | --- | --- |
| `status` | Any | Sync update: completed, next, blocked | Nothing, unless named in a blocker |
| `handoff` | Current owner | Transfer ownership with evidence | Acknowledge or reject with a reason; ownership moves only on acknowledgment |
| `review_request` / `review_result` | Developer / reviewer | Ask for and return peer review | Return approve or changes-requested with specific findings |
| `blocker` | Owner | Report that work cannot proceed | Process Agent assigns a resolver immediately |
| `estimate` | Developer | Private estimate plus rationale | Process Agent holds until all are in |
| `change_request` | Any | Predictive scope or baseline change (5.3) | Process Agent validates and routes |
| `decision` | Deciding agent | Announce a logged decision that affects others | Adjust work; object only with new evidence |
| `escalation` | Process Agent | Ask the sponsor to decide | Sponsor responds; team continues unaffected work |

### 8.3 Handoff rules

- A handoff MUST contain everything the receiver needs to continue from the repository and board alone: what was done, what remains, how to verify it, known risks.
- The receiver MUST reject a handoff that lacks evidence or fails its entry policy. A rejected item returns to the sender's state and owner.
- An agent that receives no acknowledgment retries once, then reports a `blocker`.

### 8.4 Blocked work

1. Mark the item blocked on the board with the cause and what would unblock it.
2. Send a `blocker` message to the Process Agent.
3. Switch to helping downstream work or, if none, pull the next item within WIP limits.
4. The Process Agent resolves it inside the team where possible and escalates when the cause is outside the team's authority.

### 8.5 Disagreements between agents

Resolve by decision rights first (section 3): the PO Agent decides what and in what order, Developers decide how, QA decides pass or fail, the Process Agent decides process. If the dispute sits inside one role, the agents exchange evidence for at most two rounds, then the Process Agent picks the more reversible option and logs it.

### 8.6 When to stop and ask the sponsor

Agents proceed autonomously by default and escalate only for the cases below. An escalation states the decision needed, the options, a recommendation and what continues in the meantime.

| Escalate when | Example |
| --- | --- |
| The goal or acceptance criteria are ambiguous in a way that changes what gets built | Two valid readings of a requirement lead to different data models |
| Scope, schedule or cost baselines would change | A required feature was missing from the approved plan |
| An action is irreversible or leaves the sandbox | Production deploy, data deletion, live schema migration, sending external messages |
| Credentials, access or spending are needed | A paid API tier or new cloud resources |
| A security, privacy, legal or licensing risk appears | A dependency with an incompatible license |
| A blocker survives one full sync interval | An external service the team cannot fix |
| The same failure repeats after two attempted fixes | A test that stays flaky after two root-cause attempts |

Agents MUST NOT work around an escalation trigger by redefining the task, disabling a check or acting through another agent.

## 9. Continuous process improvement

The team improves its own process on two loops: a light Plan-Do-Check-Act loop every cycle, and a Six Sigma DMAIC project when a problem recurs or its cause is unknown.

### 9.1 Which loop to use

| Situation | Loop | Run by |
| --- | --- | --- |
| A one-off miss with an evident cause | PDCA at the retrospective or flow review | Whole team |
| The same problem in two or more cycles, a metric outside its control limits, or a cause nobody can state with evidence | DMAIC | Process Agent leads; QA Agents measure |
| Waiting, rework or handoff delay dominates lead time | Lean waste review (9.4) | Process Agent |

### 9.2 PDCA every cycle (the retrospective)

1. **Check — review the data.** The Process Agent presents: planned versus Done, spilled items, estimate misses, blocked time, defects found after Done.
2. **Find the cause.** For each problem item, ask "why" until the answer is a process condition, not an agent. Classify it: *technical hurdle* (legacy code, poor documentation, unfamiliar API), *process lag* (waiting on review, a dependency or a decision), *scope creep* (requirements added after commitment), or *estimation gap* (work the estimate ignored).
3. **Act — commit to one change.** Choose the single change with the best expected effect and write it as a testable rule with an owner. Example: "Any story using an API the team has not used before gets a time-boxed spike before it is estimated."
4. **Plan and Do.** Put the change in the next cycle's backlog and apply it.
5. **Check again.** At the next retrospective, compare the target metric. Keep the rule, adjust it or drop it, and log the result.

One change at a time. Several simultaneous changes make the effect of each unreadable.

### 9.3 Six Sigma DMAIC

Six Sigma reduces defects by reducing variation in the process that produces them. A *defect* is any output that misses a requirement the customer cares about (a critical-to-quality, or CTQ, characteristic).

| Phase | Agent actions | Output |
| --- | --- | --- |
| **Define** | Process Agent writes a problem statement with scope, the CTQ affected, the metric and a numeric target. PO Agent confirms it matters to the user | One-paragraph charter, for example: "Database integration defects escaped to staging in 4 of the last 6 cycles; target is at most 1 in 6" |
| **Measure** | QA Agents establish the baseline from the metrics log: defect counts, where each was introduced and where it was caught, cycle time, rework. Confirm the data is collected consistently | Baseline with sample size; defect rate or DPMO |
| **Analyze** | Team finds root causes with evidence: Pareto chart of defect categories, 5 Whys, fishbone diagram, comparison of failing and passing items. A cause counts only if the data supports it | Ranked, verified root causes |
| **Improve** | Design a countermeasure for the top cause, pilot it on a limited set of items, and compare against the baseline. Prefer error-proofing (an automated check that makes the defect impossible) over a rule agents must remember | Measured before-and-after result |
| **Control** | Process Agent adds the change to the DoD, a board policy or the pipeline, tracks the metric on a control chart, and defines the trigger that reopens the problem. PO Agent confirms the user-facing outcome held | Updated standard and monitoring; closed charter |

**Measures used**

- **DPMO** (defects per million opportunities) = defects ÷ (units × opportunities per unit) × 1,000,000. Six Sigma performance is 3.4 DPMO. Treat this as a direction, not a software target; trend matters more than the absolute figure.
- **Defect escape rate** = defects found after Done ÷ all defects found.
- **First-pass yield** = items passing review and test on the first attempt ÷ items submitted.
- **Control chart:** plot the metric per cycle with a centre line at the mean and limits at ±3 standard deviations. A point outside the limits, or eight consecutive points on one side of the mean, signals a real change that needs a cause. Variation inside the limits is noise; do not react to it.

### 9.4 Lean waste review

Check the flow for these wastes and remove the largest first:

| Waste | In an agent team |
| --- | --- |
| Waiting | Items idle in review or blocked on a decision |
| Handoffs | Context re-derived because a handoff lacked evidence |
| Partially done work | High WIP; branches unmerged |
| Rework / defects | Changes returned from review or test |
| Extra features | Work beyond the acceptance criteria |
| Task switching | Agents holding more than one in-progress item |
| Relearning | Decisions not logged, so they are rediscovered |

### 9.5 Team metrics

The Process Agent records these every cycle and reports trends, not single values.

| Area | Metric | Healthy signal |
| --- | --- | --- |
| Predictability | Planned versus Done; velocity variation (Scrum) | Done within about 20% of plan, stable across cycles |
| Flow | Cycle time (85th percentile); WIP age; blocked time | Flat or falling; no cards past the age threshold |
| Quality | Defect escape rate; first-pass yield; failed builds | Escapes falling; yield rising |
| Delivery | Deployment frequency; lead time for changes; change failure rate; time to restore service | More frequent, faster, fewer failures |
| Estimation | Share of items that finished at a different size class than estimated | Falling over time |

Metrics describe the process. They MUST NOT be used to rank agents, and an agent MUST NOT alter work or records to make a metric look better.

## 10. Quick reference

### 10.1 Start-of-engagement checklist

- [ ] Restate the task as a goal and success criteria; confirm with the sponsor only if section 8.6 applies
- [ ] Assign roles; confirm Developer and QA roles are separate agents
- [ ] Select the method (section 4) and log the reason
- [ ] Create the board, decision log and metrics log
- [ ] Agree the Definition of Done and the estimation anchors
- [ ] Predictive: produce and get approval for the scope, schedule and risk baselines
- [ ] Scrum: set sprint capacity, build and order the backlog, refine one sprint's worth to ready
- [ ] Kanban: set states, entry policies and WIP limits
- [ ] Confirm which irreversible actions the sponsor has pre-approved

### 10.2 Per-item checklist for any agent

- [ ] Item is on the board, owned by me, and within WIP limits
- [ ] I understand the acceptance criteria; if not, I asked the PO Agent before starting
- [ ] Work and tests are committed; evidence is attached
- [ ] Handoff sent and acknowledged; board state updated
- [ ] Anything I decided is in the decision log

### 10.3 Glossary

| Term | Meaning |
| --- | --- |
| Acceptance criteria | Testable conditions an item must meet for the PO Agent to accept it |
| Baseline | An approved version of scope, schedule or cost that changes only through change control |
| Change control | The formal process for approving changes to a baseline |
| CTQ | Critical to quality: a measurable characteristic the customer requires |
| Cycle | A bounded batch of work; a sprint in Scrum, a review interval in Kanban |
| Cycle time / lead time | Start → Done / request → Done |
| Definition of Done (DoD) | The checklist every item must pass to count as complete |
| DMAIC | Define, Measure, Analyze, Improve, Control: the Six Sigma improvement cycle |
| DPMO | Defects per million opportunities |
| Increment | The integrated, usable sum of all Done items |
| Kaizen | Continuous improvement in small, frequent steps |
| PDCA | Plan, Do, Check, Act: the basic improvement loop |
| Product Backlog / Sprint Backlog | Ordered list of all possible work / the subset selected for a sprint plus its plan |
| Spike | A time-boxed research task whose output is an answer, not shippable code |
| Sprint Goal | The single outcome a sprint commits to |
| Story point | A relative unit of size covering complexity, volume and uncertainty |
| Traceability matrix | A table linking each requirement to its design element, code and test |
| Velocity | Story points of Done items per sprint |
| WBS | Work Breakdown Structure: hierarchical decomposition of deliverables into work packages |
| WIP limit | The maximum number of items allowed in a state at once |

### 10.4 Reference standards

Terms and practices follow the Scrum Guide (2020), the PMI *PMBOK Guide* and *Agile Practice Guide*, the Kanban Method's general practices, and the Six Sigma DMAIC framework. Numeric defaults in this guide (WIP limits, variance thresholds, capacity reserves) are starting points to tune through section 9, not parts of those standards.
