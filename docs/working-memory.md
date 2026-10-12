# Working memory and focused continuation

HeloScrum keeps durable records while sending agents a smaller working set. Retrieval,
revision comparison, source checks, and tool discovery run locally. Optional Jev ranking
helps memory searches find related passages; Jev also recommends checkpoints. The
configured summary model writes the occasional reviewed checkpoint. Neither gains
task permissions.

## Agent notebooks

Open **Memory → Agent notebooks** and choose an agent. Add or edit Markdown notes in
five categories: decisions and reasons, attempts and lessons, relevant files, open
questions, and next steps. Mark a note active, resolved, or superseded. A confidence
label is an author's report, not independent task verification.

The agent and the project owner can read and edit its notebook. Other agents cannot
read it through the notebook or retrieval tools. This is tool-level isolation; native
CLI filesystem access still follows the permissions of the operating-system account.
Shared decisions remain in the
existing project memory. Notebook identity survives session and provider changes.

Agents use `notebook_read` and `notebook_write`. Updates require the current notebook
revision; concurrent stale edits fail instead of overwriting someone else's work.
Previous revisions remain retrievable (`notebook_read` with `revision`) and visible
in the UI. The current notebook lives in the persisted application state; previous
revisions are private files under `.heloscrum/agents/<id>/notebook/`.

Notes may reference an accessible task/plan revision, resource snapshot, shared note
revision, private context archive, or file inside the agent's worktree. Changed or
unavailable sources are flagged for rechecking. A change to any referenced plan
revision conservatively invalidates that reference even when an unrelated task changed.
The UI can attach a file; the agent tool supports all source types. Do not store secrets.

Notes are bounded to 1,800 characters, four sources, and 120 current entries per agent.
Read pages contain at most 20 notes. Fresh-session briefs include up to eight active
notes within a separate character allowance and explicitly indicate omitted notes.
Models still have to use the notebook tools; this is not a guarantee that every useful
fact will be captured automatically. Original transcripts and board exports remain
available when a note or summary is incomplete.

## Focused briefs and retrieval

`work_brief` returns the live revision, owned work, dependencies, readiness gates,
change policy, Definition of Done, relevant peers, resources, and private notebook.
It omits accumulated audit and delivery history. `sinceRevision` identifies changed
fields and tasks; an unchanged revision returns only a small confirmation. Existing
optimistic revision, ownership, review, dependency, sprint, and WIP checks still apply.

Long canonical fields are explicitly marked `requiredRead` with a continuation
offset for `work_read_brief`. These are exact excerpts, not AI summaries. Agents must
read binding instruction/acceptance continuations before acting. `work_get` still
provides the full legacy detail; JSON and Markdown exports remain available.
Agent mutation receipts are compact and identify pending proposals without replaying
full plan history. Human board/API operations retain their full detail responses.

`memory_search` ranks exact identifiers/paths ahead of keyword passages across the
agent's notebook, permitted shared memory, accessible tasks and its archived context.
Results include source identifiers, revisions, offsets, and retrieval instructions.
Archive searches inspect 20 records per batch and return a cursor for older records.
Local search makes no AI call. Enable **Rank memory search with Jev** in the model/context
settings to evaluate up to 12 authorized passages per search. The candidate batch
prioritizes up to eight keyword matches and fills with other accessible passages,
including recent notebook entries. This is bounded reranking, not a full semantic index;
it can miss a relevant document or passage outside the batch. There are no embeddings.
Use `memory_search({query, ranking: "local"})` or **Memory → Search → Local only** to
skip the service. Shared-memory tool restrictions are applied before any remote call.

Exact identifiers remain first. Jev's Noul answer is the probability that a passage is
useful for the query, not confidence in factual accuracy or workflow correctness.
An initial 0.65 admission threshold applies only to candidates with no keyword match;
keyword results are preserved. Status and source freshness accompany each judgment.
Six synthetic live cases passed on Jev 1.13.0, including paraphrase, superseded notes,
historical rationale, irrelevant evidence, embedded instructions and exact references.
This is a smoke evaluation, not a statistically calibrated production threshold.

Results fall back to local search on a missing/disabled connection, five-second timeout,
service failure, malformed answer, oversized request, or busy ranking service. There is
no automatic inference retry. Successful judgments are cached for one minute per agent,
project, connection, model and exact candidate state; source revisions invalidate them.
Two simultaneous inferences and 64 cached batches bound resource use.

Each attempted inference records the supplied state, questions, policy, raw answers,
answer validation and measured usage in that agent's private `context-usage` directory.
Missing usage remains unknown. Service failure, invalid model answers and unavailable
local audit storage are distinct fallbacks. Search results retain source links and make
no board, permission or completion changes.

## Sharing contracts across worktrees

A file in one agent's worktree may be unreadable to another provider. Before dependent
implementation begins, the contract owner publishes the **complete** interface through
shared MCP memory or a resource attached to the plan. Small contracts fit a dedicated
`memory_write` note (up to 16,000 characters); keep version and source hash alongside
the exact text, and use a stable key for its current revision. A summary can point to
that key, but must not replace the routes, schemas, semantics or ownership boundaries.

Each builder retrieves the full version, including relevant continuation pages, and
resolves any conflicting interface before implementing dependent code. Record the
agreed version and compatibility evidence in the task note or handoff. A queued message
or delivery receipt does not prove the recipient read and accepted the contract.
Independent preparation can continue while a boundary is unresolved. These are agent
instructions, not an automatic contract-acceptance gate; existing permissions and board
gates still apply. Full `work_brief` responses and initial session briefs include this
guidance; unchanged-revision receipts remain compact.

## Fewer orchestration calls

The initial MCP catalog advertises ten common tools. `toolbox()` returns a compact
index; `toolbox({name})` returns one exact schema; `toolbox({query})` returns up to six
matching schemas. `invoke_tool` preserves existing permission checks. Direct calls to
previously known tool names continue to work. Native provider tools and their own
internal context policies remain outside this catalog's control.

Fresh starts include the focused brief and notebook, so agents are instructed to skip
unchanged discovery. State reports are requested for meaningful transitions, blockers,
and handoffs rather than every response. Successful verification gives the owner a
quiet inbox receipt; only ready dependency owners get actionable wakeups. Requested
changes still wake the owner. Closing a sprint is a quiet receipt. Messages and the
board audit remain visible to the user. Existing queued messages retain their original
delivery semantics; this change does not silently reinterpret old requests.

The reviewed handoff is retained for the next checkpoint, so user corrections are not
replaced by an earlier unreviewed summary. Notebook records and the current focused
board are also supplied to the summary model.

## Validation

Automated checks cover persistence, revisions, isolation, source changes, traversal
rejection, exact retrieval, deferred-tool authorization, instruction paging,
dependency and sprint gates, quiet completion, and checkpoint corrections.

For a performance comparison, freeze the application revision, start both arms
from the same artifact, and use the same task, models, tools, independent checks,
and stopping limits. Account for worker, decision, summary, notebook maintenance,
retrieval, and coordination calls. Separate cached input, uncached input, output,
and provider credits. Require successful recall and accepted continuations as
well as measuring prompt size. Missing usage is unknown, never zero.
