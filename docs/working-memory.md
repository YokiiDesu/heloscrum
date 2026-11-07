# Working memory and focused continuation

HeloScrum keeps durable records while sending agents a smaller working set. Retrieval,
revision comparison, source checks, and tool discovery run locally. Voyage contextual embeddings
help memory searches find related passages; Jev separately recommends checkpoints. The
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

Notes are bounded to 8,000 characters, four sources, and 120 current entries per agent.
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

`memory_search` looks up exact identifiers/paths/hashes directly and retrieves passages across the
agent's notebook, permitted shared memory, accessible tasks and its archived context.
Results include source identifiers, revisions, offsets, and retrieval instructions.
It also searches durable History: shared memory revisions, the requesting agent's
own transcripts and messages, and currently accessible plan records. It never
searches another agent's private transcript or notebook. History is marked as
historical evidence, so an earlier rule is not mistaken for the current contract.
Use `scope: "history"` and `historyBefore`/`nextHistoryBefore` to search older batches.
The UI exposes this under **Memory → Search → Durable History**.

The requested `limit` controls returned passages, not the semantic candidate pool.
History supplies up to 80 recent candidates plus 40 keyword candidates selected
across the authorized archive range. The latter can recover an older correction
outside the recent batch. Duplicate captures of the same record's unchanged
searchable content collapse before either budget is applied; actual text revisions
remain searchable. Streaming transcript captures use the latest version of each
event. Exact archive sequence/version lookups can still retrieve earlier captures.
No archived records are deleted by search deduplication.

`historyCoverage` reports candidate counts, keyword truncation and whether older
batches remain. `nextHistoryBefore` advances the recent candidate window; older
keyword evidence can recur across windows. This is not exhaustive semantic search
of the entire archive, nor pagination of every ranked passage. Search results carry
the immutable History version, a revision number when present, `occurredAt` and
`capturedAt`. Capture time is not substituted for an unknown event time. Shared
Memory search also returns the note's update time alongside its revision.

`memory_source_read` consumes the exact `source` and `offset` returned by search.
Current notes and plans reject a mismatched revision; historical entries retain
their archived version. `memory_read` without a key returns an index instead of all
note bodies. With a key it returns one bounded text page; `sinceRevision` returns
a small unchanged receipt when possible. Only reuse that receipt when the earlier
content is still in the agent's working context.

Registered external chat contacts can read/search shared project Memory and their
own authorized History. This does not grant shared-memory writes, access to peer
notebooks/transcripts, plan membership, or native local file access.
Archive searches inspect 20 records per batch and return a cursor for older records.
Local search makes no AI call. Add **Voyage AI · embeddings** in **Settings → AI &
Context → Add connection** and save its API key in the masked field. Saving selects
that connection under **Memory search**. The key is stored in the backend's private
credential file, excluded from app state, exports, browser responses and logs.
Embedding connections cannot run agents, summarize text or make Jev decisions.
Select **Keywords only** to disable cloud retrieval. Existing Jev memory-ranking
flags no longer trigger reranking; Jev's checkpoint decisions remain separate.

The default semantic path uses `voyage-context-4`, 512-dimensional float vectors.
It embeds paragraph/line-aware, non-overlapping chunks of up to 950 characters,
with exact UTF-16 offsets and full-source SHA-256. Chunks from the same source are
contextualized together in windows bounded to 20,000 serialized UTF-8 bytes; a large
source can span several windows. This preserves exact text and Unicode, while
avoiding the old keyword-first passage bottleneck. Explicit `scope: "history"`
searches then use Voyage `rerank-3` through the same saved Voyage connection. Other
scopes, including `all`, keep embedding ranking. No probabilistic admission
threshold is applied. Similarity ranks passages; even the first result
may not answer the question. Status, freshness and author confidence remain separate.

History reranking considers up to 16 source versions and 24 passages, with at
most two passages per source. It alternates record kinds and logical records before
spending more space on versions of the same record. Each selected source gets an
initial passage before alternatives. After reranking, each source keeps its best
passage and identical winning text is collapsed across versions before applying
the result count. Exact version retrieval remains available. The serialized request
must fit 24,000 UTF-8 bytes; passage ends are not silently truncated. This remains a
bounded shortlist, not a guarantee of finding every relevant historical record.
IDs, paths and hashes bypass both embedding and reranking calls.

For semantic History retrieval, explicit quoted query fields in retrieval requests
and reports are masked in the ranking representation. Search-tool text echoes are
also masked, so copied questions and retrieved snippets do not rank as independent
evidence. Search reports retain their explanatory text and remain searchable.
Masking preserves offsets; returned passages, source hashes, archived versions,
exact source reads and local keyword searches retain the original text. This is a
bounded syntax-based treatment of retrieval echoes, not a factual classifier.

The extra stage makes at most one request per History search, with a five-second
deadline, a 128 KiB response ceiling and ten attempts per minute per backend. Scores
are cached for 60 seconds in a bounded in-memory cache, keyed by agent/project,
connection revision, query, source versions, hashes and exact ranges. Authorization
is checked again before constructing every shortlist, including cache hits.
`ranking.reranking` reports model, status, shortlist coverage, usage, call count and
cache reuse separately from embedding coverage. `queryEchoesMasked` counts changed
ranking passages; `duplicatePassages` counts identical winning passages collapsed.
`rerankScore` is a relevance score,
not a probability or proof that the passage is accurate or current.

Authorization is applied before collecting text or using cached vectors. The search
service receives only this agent's allowed source text and query. It does not scan
workspace files or upload downloaded attachments automatically. Source tools remain
the way to read exact files and task resources; local availability is not a read receipt.
History retrieval includes non-keyword records in a bounded authorized batch and
an older keyword shortlist; use its continuation cursor for older semantic candidates.
It does not claim to index all history at once.

Document vectors are cached privately per agent/project, source hash, window,
chunking policy, ranking representation hash and model/dimension. Edits use a new cache key; deleted or newly
inaccessible sources are never returned from cache. Completed windows persist across
restart, even when a later window fails. Query vectors use a bounded in-memory cache.
At most 128 source windows are cached per agent, four agent caches remain in memory,
and at most 1,024 chunks are considered in one search. Each search issues at most four
document requests and one query request, with a 15-second embedding inference deadline,
an eight-second request deadline, 28,000-byte request ceiling and 2 MiB response ceiling.
There are at most two active searches and 30 embedding requests per minute per backend.
Explicit History searches use smaller 4,000-byte source windows and alternate record
kinds and logical records while indexing. This gives more sources a chance within
the same four-request budget; it does not make partial indexing complete.

Results report indexed/total chunks, partial coverage, pending indexing, cache reuse,
call counts and provider-reported usage. Search again to continue pending batches;
if the index limit is reached, narrow the scope or page older History. These are
retrieval receipts, not proof of review. Missing usage remains unknown. Each attempted
call records its input hash, byte/chunk counts, model, policy, outcome and measured
usage in the private `context-usage` directory. Vectors are retained in the private
index; credentials and full source prompts are not copied into usage records.
History reranking receipts retain the query, candidate identities/ranges and ranking-text hashes, request
hash, requested/reported models and raw indexed scores. A malformed response keeps
its reported token usage separate from whether its scores passed validation.

Embedding failures fall back to keyword results. Reranking service, timeout, audit,
validation or budget failures retain the existing embedding results and report the
reason; they do not discard otherwise successful retrieval. Calls are not retried
automatically; a service failure applies a 60-second cooldown. Use
`memory_search({query, ranking: "local"})` or **Memory → Search → Local only** to
bypass cloud calls. Search results retain source links and make no board, permission
or completion changes.

The integration follows [Voyage's contextual embedding guide](https://docs.voyageai.com/docs/contextualized-chunk-embeddings)
and [reranking guide](https://docs.voyageai.com/docs/reranker).

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

Long notebook notes remain stored in full. `notebook_write` returns a compact receipt,
`notebook_read` lists bounded previews, and `notebook_read({id,revision,offset})`
returns exact text pages. Briefs carry previews and retrieval references; they do
not automatically insert an 8,000-character note into the prompt.
