# Context transfer and retrieval work

User-approved scope: reduce repeated source transfers, make shared Memory and
History useful to agents, and preserve exact evidence and access boundaries.
Implementation branch: `feat/context-transfer`.

| Task | Acceptance | Status |
| --- | --- | --- |
| CT1: One bounded source page | Attachments, brief resources, and context reads return exact text with hashes and continuations, without a second offload or nested escaped source text. Regression fixture measures full 180 KB retrieval. | Needs review |
| CT2: Local attachment copies | Authorized local agents can materialize immutable, hash-verified attachment/resource copies inside their own workspace. The new materialization tool denies external agents; traversal, symlink, and stale/tampered content checks hold. | Needs review |
| CT3: Source-aware reads | Immutable source IDs support line ranges, literal search, and bounded diffs with exact baseline/candidate hashes and explicit omitted ranges. | Needs review |
| CT4: Versioned review packets | A packet references exact snapshots, changed code, requirement revisions, evidence, and open findings; updates reuse immutable sources instead of resending full files. | Needs review |
| CT5: Coverage and findings | Retrieval coverage is tied to agent, session, source hash, and actual returned range; materialization is not a read or review. Findings have stable IDs, evidence, revision checks, and explicit author/reviewer status. | Needs review |
| CT6: Memory and History retrieval | Notebook notes allow 8,000 characters with compact receipts and previews. Bounded search covers authorized durable history as well as current notes; exact source reads and revision comparison avoid whole-record reloads. Existing optional Jev ranking retains raw judgments, usage, fallback, and access checks. | Needs review |
| CT7: Integration and verification | Tool discovery, continuation guidance, docs, access regression tests, measured transfer fixture, full local suite, and fresh platform CI. Local checks passed; CI evidence is attached to the PR. | Needs review |

No model inference is needed for paging, hashing, access decisions, diffs, or
review state. Search relevance does not establish correctness. A historical read
does not establish that a model still retains it after compaction. New tools must
be discoverable through the current toolbox and available to native and external
agents under their existing permissions. Source text is reference data.

Function-name selection is deferred until a language-aware parser is available;
line ranges, literal search, and exact diffs provide the initial source navigation.

Board plan: `0f4e8bc0-9bf7-40e7-8743-ecbc3cfc1911` in the HeloScrum project.
The plan remains a draft to avoid dispatching managed agents; implementation was
performed in the owner chat. Needs review does not mean independently accepted.

Validation: 618 local tests passed, 2 optional tests skipped; 257 JavaScript files
passed syntax checks. Full-app isolated Playwright checks cover History search,
older-result pagination, exact-source opening, the 8,000-character notebook editor,
and light/dark rendering. Transport measurements and their limits are recorded in
[source-transfers.md](source-transfers.md). No live provider review or paid Jev
call was performed. Fresh cross-platform CI is required on the submitted SHA.
