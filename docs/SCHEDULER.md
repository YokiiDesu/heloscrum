# Calendar and reminder worker

HeloScrum stores dates with work plans, their items, and planned sprint windows.
`work_schedule` and the Tasks calendar project those same records. There is no
separate calendar database or model-driven clock loop.

## Controls and defaults

| Setting | Default | Scope |
| --- | --- | --- |
| Timezone | Saved local IANA zone | Project |
| Deadline alert | 1,440 minutes before due | Project / plan |
| Overdue alert | One per deadline occurrence | Project / plan |
| Recurring progress checks | Off; 15 minutes minimum when enabled | Project / plan |
| Agent recipient | None; optionally owners or coordinator | Project / plan |
| Reminder cooldown | 60 minutes between a plan's notices | Project / plan |
| Quiet hours | 22:00–08:00 in project zone | Project / plan |
| Resume inactive agents | Off | Project, user only |

A plan override contains the complete set of reminder rules. Returning to
“Use project settings” restores inheritance. Task dates and sprint windows use
their plan's rules. The coordinator is the assigned Process/Scrum Master, falling
back to the orchestrator. Owners means current owners of unfinished tasks, not
every project agent. Missing or unavailable recipients leave a saved user alert.

An all-day deadline ends at the end of its local day. Local clock times use the
project zone; explicit UTC/offset timestamps represent exact instants. The
Temporal polyfill handles daylight-saving transitions: nonexistent local times
are rejected, repeated times use the earlier occurrence unless an explicit offset
is supplied, and all-day deadlines account for 23- and 25-hour days. Changing a
project zone reinterprets local dates, so the UI explains this before saving.

## Persistence and execution

`lib/scheduler.mjs` implements `WorkScheduler`. `server.mjs` starts it once, ticks
it every 30 seconds, requests a tick after saved work changes, and stops/awaits it
on shutdown. Concurrent tick requests share one pending operation. Scans share
`WorkManagement.serial` with task mutations and queued delivery. There are no
LLM calls during scans.

The authoritative saved backend state contains:

- `projects[].scheduleSettings`, with a revision and settings audit history;
- `workPlans[].schedule`, `items[].schedule`, and `flow.sprints[].schedule`;
- `scheduler.jobs`, `scheduler.notices`, and last successful scan time;
- the existing plan outbox and collaboration message receipts.

This state is persisted by `ControlPlane.save`: DuckDB when enabled, with the
existing private `state.json` mirror. Scheduler notifications and new outbox
entries are committed together. A failed scan restores the prior work/scheduler
references without replacing unrelated session state.

Occurrence IDs derive from the plan, entity, schedule/rules version, rule, and
due time. Progress edits do not create a new schedule version. Startup catches
up from saved state; each recurrence retains only the latest missed candidate
plus the next one, rather than enumerating every missed interval. Due-soon alerts
that are already past the deadline are skipped in favor of the overdue alert.
Due work is grouped into one saved notice per plan per scan, subject to quiet
hours and cooldown. Completed/cancelled tasks and completed/archived plans stop
producing reminders. An open sprint can still need its sponsor's closing review.

## Agent delivery and recovery

Optional check-ins use the existing persisted message queue with a stable request
ID and scheduler metadata. A busy agent waits for its normal idle, interactive
session. The check-in tells the agent to read current work through MCP; it does
not treat the original reminder text as current task truth.

The queue rechecks task state, schedule, eligibility and quiet hours before
provider dispatch, including after the pre-dispatch save. Stale queued work is
cancelled. Changing dates, owner/recipient settings, or task state cannot turn an
old reminder into permission to act on new work.

Confirmed failures before queuing are shown in Reminders, retry automatically
with backoff from 30 seconds to 15 minutes, and have a safe “Retry queue” action.
A successful queue write followed by a lost response reuses the same envelope.
An unconfirmed provider submission remains **uncertain**, including after a
restart. HeloScrum never blindly resends it; inspect the agent session first.

With the explicit project option enabled, the worker can request resumption of
an existing saved provider session through `ProjectLibrary.resume`, which verifies
its exact saved transcript/session. It does not create an agent or replay the
original task prompt. The resume attempt is persisted first and not retried
automatically if its outcome is unclear. Sessions without saved history require
manual setup. Reminders show resume failures or uncertain launch status.

The human Reminders view shows the latest 100 alerts with mark-read controls;
earlier receipts remain in plan delivery history. Toast IDs are retained in local
browser storage to avoid repeating an alert on reload. Browsing another project
uses that project's notifications and timezone. Agents only see submitted plans
in which they are current participants; private drafts remain private.

## Authority and runtime boundaries

`work_update_schedule` changes/proposes plan dates. `work_update_task` accepts a
`schedule` for task dates. Both use current `expectedRevision` and the normal
review/baseline rules; schedule proposals retain the previous dates to reject
stale approvals. The human sets planned sprint windows when starting a sprint.
Agent reminder settings and inactive-session permission are not writable through
MCP. Scheduled messages do not approve completion, releases, deadline changes,
assignment changes or sprint closure.

No operating-system service is installed. The backend must be running. Closing
the browser is fine; sleeping or shutting down the host pauses execution. An
always-on deployment is needed for execution while the user's computer is off.
Toasts are in-app, with no OS push, email, external calendar sync, or automatic
sprint closure.

## Verification

`test/scheduler.test.mjs` covers calendar/DST boundaries, private MCP reads,
revision and proposal policy, sprint boundaries, quiet hours, cooldown, downtime
coalescing, restart deduplication, stale queued work, busy recipients, delivery
uncertainty, persistence failure, safe retry, explicit session-resume consent,
DuckDB reload, and worker lifecycle. The ordinary collaboration and task tests
remain part of `npm test`. Browser verification uses an isolated project and
fake offline agent identities so it does not start live agent work.
