# Durable project history

HeloScrum uses `@duckdb/node-api` 1.5.5-r.4. A single local server owns `.heloscrum/history/archive.duckdb`; agents communicate through that server rather than opening the database. The database schema is versioned (currently 1). Unknown versions fail startup instead of silently modifying them.

On first startup, valid existing `state.json` is imported. `.heloscrum/state.pre-duckdb.json` preserves the pre-migration state without overwriting an existing backup. Afterwards DuckDB is authoritative; `state.json` is a compatibility/recovery mirror. Message fan-out, current shared memory, its new revision, and operational state are committed together before acknowledging a write. Database errors are surfaced. Unconfirmed external delivery remains **uncertain** and is not automatically replayed.

## Saved records

- Task identity, role, worktree, branch, provider and exact provider session IDs.
- Full available normalized visible conversations and tool calls/results, collected every 30 seconds and before model/provider changes. UI history pages do not limit stored history.
- Agent DMs and groups, members, reply/request IDs, typed messages, per-recipient delivery state, and open/closed conversation state.
- Questions addressed to the user, suggested options, pending/answered/cancelled status, linked human replies and notifications.
- Shared memory revisions and their author/session links when known.
- Observed Git commits and worktree heads, with observed provenance rather than inferred agent authorship. Commits made through HeloScrum additionally record the reviewed commit action.
- Uncommitted regular-file snapshots with SHA-256. Limits: 1 MiB/file and 8 MiB/task per capture; symlinks and omitted/deleted files have explicit omission records.

Historical message/session associations are recovered only from exact recorded delivery envelopes or successful tool receipts. Missing source links remain unknown. Changes to an event produce another version; unchanged captures are deduplicated, including historical state pills. The event time and capture time are separate.

Normalized histories retain thinking activity and any provider-supplied display text or public summaries. Thinking entries with readable text start collapsed and can be expanded in History. Entries without it distinguish missing text, missing summaries and provider redaction. Codex thinking entries use only their own recorded status, never an interrupted parent turn. Encrypted reasoning, redacted text, signatures, internal prompts and unsupported provider record types are omitted. They are version-sensitive: Codex local rollouts are limited to 64 MiB and Claude transcripts to 32 MiB. Reader failures appear in History. A provider may not yet have persisted its latest output when capture occurs. Retention is currently indefinite; automatic compaction/pruning is not implemented.

## Browse, export and restore

Open **Agent grid → History** for sessions, paginated conversations, memory revisions, commits and file snapshot metadata. **Capture now** runs read-only collection without starting agent turns. **Export** produces project-scoped JSON, including message history, session links and artifact bytes. It excludes runtime credential/configuration objects, but conversations and tool output may themselves contain private data.

To validate/restore an export into a **new archive file**, from the HeloScrum repository:

```sh
node scripts/restore-history.mjs /absolute/path/heloscrum-history.json /absolute/path/restored.duckdb
```

The command rejects an existing destination and validates record hashes/project boundaries. It restores historical records only; it does not recreate credentials, worktrees, provider processes, or schedule old messages. Do not replace a running server's database file. Export/restore regression tests compare exact record versions and exercise integrity failure rollback.

For a complete local application backup, stop HeloScrum cleanly, then copy `.heloscrum/` and the relevant Git repositories/worktrees. Keep any DuckDB WAL together with its database after an unclean stop. The live database and WAL use owner-only file permissions. They are not encrypted by the app, and a second copy on the same disk is not an off-device backup.

## Validation

Tests cover atomic rollback, concurrent stale-revision rejection, state migration, stale/corrupt JSON mirror recovery, full-history pagination, duplicate captures, A → B → A changes, export/restore, scoped session reads, and acknowledged writes surviving a SIGKILL without a clean checkpoint. The process-crash test does not claim to simulate loss of power or a disk failure.

This is an initial DuckDB implementation for the local team workload, not a throughput benchmark or a multi-server database design. Keep one server per HeloScrum data directory.
