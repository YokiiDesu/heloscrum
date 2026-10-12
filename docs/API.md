# HeloScrum API v1

The local API is available under `/api/v1`. The browser's existing `/api/*`
routes and the agent MCP bridge remain compatible. All interfaces call the same
ControlPlane, WorkManagement, Collaboration, Git, and scheduler services.

- Live contract: `GET /api/v1/openapi.json`.
- Generate without a running backend: `node scripts/api-schema.mjs` (optional output filename).
- Reusable JavaScript client: `cli/client.mjs` exports `HeloClient` and `CliError`.
- Terminal and script examples: [CLI.md](CLI.md).

## Identity and transport

Use `Authorization: Bearer <credential>`. Local owner credentials live in
`.heloscrum/api-owner.json`, written with `0600` permissions. Only token hashes
are stored in backend state. The owner creates revocable, optionally expiring
grants restricted to registered project IDs and named scopes. Tokens are returned
once on creation; do not log their response body.

`kind: agent` binds calls to an existing agent session. Canonical membership,
task authority, independent verification and assigned-tool checks still apply.
`kind: operator` explicitly delegates human authority within its scopes. Workers
that need human review should receive agent credentials. All grants are checked
again when queued mutations execute. Revocation also terminates event streams.

The backend binds `127.0.0.1` and validates Host/Origin. It retains the existing
single-user local trust boundary. Public hosting, multi-user login, OAuth and
multi-tenant isolation are not included. Remote use should go through a localhost
SSH tunnel or a separately authenticated deployment design. The client refuses
unencrypted non-loopback URLs and does not follow authenticated redirects.
Credential scopes govern API calls, not operating-system access: processes that
can read the owner's files already share the local owner's trust boundary.

## Resources

Every project route contains a stable `prj_…` ID from `GET /projects`. It never
uses the browser's active project implicitly.

| Resource | Capabilities |
| --- | --- |
| `/projects` | List accessible projects; owner registers an existing local Git repo |
| `/projects/{projectId}/agents` | List/create sessions; transcript, message, approval decision, interrupt, resume, archive/restore/trash |
| `/projects/{projectId}/plans` | Drafts, dispatch, task updates, proposals, verification, lifecycle, schedules, sprint/gate actions and portable exports |
| `/projects/{projectId}/resources` | Base64 file upload (20 MiB), repository references; reads require attached-plan membership |
| `/projects/{projectId}/conversations` | Membership-filtered conversations and group creation |
| `/projects/{projectId}/messages` | Recorded direct or group messages; existing delivery queue and duplicate guards |
| `/projects/{projectId}/tools` | Toolbox metadata, grouped MCP tools and assigned tool invocation |
| `/projects/{projectId}/worktrees` | Changed files, exact diffs, reviewed fingerprints, staging, staged-tree commit previews and commits |
| `/projects/{projectId}/calendar` | Same deadlines, sprint windows and reminders as the human calendar |
| `/projects/{projectId}/events` | Durable project invalidations via SSE |
| `/operations` | Caller-visible results; recover by `?requestId=KEY` |
| `/tokens` | Owner-only credential listing, creation and revocation |
| `/me` | Current identity and permissions |

The OpenAPI contract lists individual paths, request schemas and scopes. Tool
invocation requires `tools:invoke`, the agent's assigned toolbox permission,
and the relevant domain scope for built-in operations (including nested
`invoke_tool`). Calling a work tool is not a way to bypass `work:write` or
`work:review`. Human toolbox reads omit executable arguments and unrelated
projects' settings. Profile/tool configuration and remote/PR setup remain web UI
operations in this version.

## Responses and mutation lifecycle

Reads return `{ "apiVersion": "1", "data": ... }`. Paginated lists return
`data.items`, `data.nextCursor`, and `data.total`; use `?cursor=ID&limit=100`.
Conversations use their own `before` cursor (up to 60 messages per read).

Queued mutations require `Content-Type: application/json` and a caller-scoped
`Idempotency-Key` (1–120 characters). They return HTTP 202 with a saved operation
in `data` and its URL in `links.operation`. Poll that URL until `succeeded`,
`failed`, or `uncertain`. HTTP 202 is acceptance, not completion. A plan operation
returns a compact ID/revision/item summary; fetch the plan for its complete board.
Credential creation/revocation is synchronous and is not placed in the job ledger.

Operations serialize within the backend; work mutations also use the existing
shared domain lock. Reusing the same key with the same route, target and input
returns its original result. Different input yields HTTP 409. Completed records
are retained for 30 days; the 2,000-record cap rejects new work instead of evicting
unexpired keys. A crash during a queued/running operation marks its result
uncertain. Unknown adapter/persistence failures are also uncertain. Inspect the
resource/session; do not invent a new key to blindly repeat a side effect.

Plan writes require `expectedRevision`; stale claims, edits and approvals fail.
Provider decisions require the current displayed request fingerprint. Git review
and staging require the current worktree fingerprint; commits require the exact
staged tree and HEAD from the preview. These checks apply regardless of interface.

Errors have a stable `error.code`, readable `error.message`, HTTP `error.status`,
optional validation details, and a request ID. A queued operation can fail after
the HTTP request succeeded; inspect its status and `error` as well.

## Live events and recovery

Subscribe with an authenticated GET to a project's `/events` route. Frames use
`event`, `id` and JSON `data`. Supported events are `ready`, `workspace.changed`,
`resync`, and `access.revoked`. `Last-Event-ID` or `?after=ID` resumes the journal.
The last 2,000 events persist alongside normal state. An older cursor receives
`resync`; re-read your resources. Change events deliberately contain no message
text or other session contents; normal reads enforce membership again.

Saved domain changes publish only after persistence. While a project has stream
subscribers, active provider activity is checked about every 2.5 seconds and
only a changed observation publishes an event. The existing background history
collector supplies saved-session observations. There are no AI calls in polling.
Streams send 15-second heartbeats; clients reconnect with backoff and retain
their cursor. Slow streams are closed and can resume. Browser polling remains
as a fallback and slows to once a minute while its event connection is healthy.

The CLI `events --follow` exposes NDJSON, and the TUI coalesces invalidations,
preserves selections and drafts, and falls back to 30-second reads. Closing a
client has no effect on agent work or scheduled reminders in the backend.

## Verification

`test/api-v1.test.mjs` covers isolation, scopes, revocation, idempotency,
persisted crash recovery, event replay, Git fingerprints and a complete shared
brief → agent progress → human proposal review → independent QA flow.
`test/tui-cli.test.mjs` runs a real PTY through a terminal emulator at wide and
laptop sizes and exercises forms and safe exit. Fixtures use temporary Git
repositories and simulated provider sessions; they do not invoke paid models.
