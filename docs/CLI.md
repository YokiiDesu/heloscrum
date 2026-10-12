# HeloScrum terminal and headless CLI

The browser, terminal UI, command line, and existing agent MCP tools share the
same backend services and saved project records. Requires Node.js 22.13+ and Git.
Install dependencies with `npm ci`. Provider CLIs need their existing authentication
only when you start or resume agents; no new account is needed for this interface.

## Start

```sh
npm start                          # foreground backend, no browser required
npm run tui                        # a second terminal
# Optional: npm link exposes the heloscrum command in your shell.
node bin/heloscrum.mjs --help
```

`heloscrum serve --root /path/to/data --port 4173` starts the same backend with
a chosen data directory. It runs in the foreground; use your normal process
supervisor for an always-on host. Closing the TUI leaves the backend and provider
sessions running. Stopping the backend pauses its scheduler until restart.

Open `/cli` on the local server to use the same interactive CLI in a browser
terminal, or choose **Quick actions → Open terminal app** in the workspace.
This launches the real CLI in a PTY with the local owner's identity, using an
authenticated, single-use terminal ticket. It retains keyboard input, ANSI colors
and resizing. Quitting or closing the tab ends only that terminal client.

The local owner's credential is created at `.heloscrum/api-owner.json` with file
mode `0600`. The CLI discovers it relative to the app checkout (or `--root` /
`HELOSCRUM_ROOT`). Use `--credential FILE` / `HELOSCRUM_CREDENTIAL` for a delegated
identity. Credential files include the backend URL; `--url` explicitly overrides it.
Never commit these files. The backend remains bound to localhost.

## Terminal UI

```sh
heloscrum tui --project /path/to/repository
heloscrum tui --no-motion
heloscrum tui --plain               # no colors or animation
```

Coral and mint terminal art, restrained loading animation, persistent action hints,
and bounded scrolling fit both wide and laptop terminals. Agent colors follow
the current saved identity. Markdown headings, emphasis, inline code and fenced
code render as terminal text; Mermaid and images remain text/file resources.
Provider activity and tool calls use the app's normalized transcript. Only
provider-exposed reasoning summaries are available. The TUI is not a raw provider
PTY replacement.

The five-line wordmark appears at 96+ columns and 30+ rows. Smaller terminals use
the compact connection mark to leave room for work. `--plain` uses the compact
header without color; `--no-motion` keeps ANSI colors and art without animation.
Press `h` to switch to the compact header while working.

| Key | Action |
| --- | --- |
| `1`–`6`, `Tab`, `Shift+Tab` | Agents, Tasks, Conversations, Changes, Calendar, Tools |
| `p` | Switch projects without switching the browser workspace |
| `↑` / `↓`, `j` / `k` | Select an agent, task, file, or conversation |
| `PgUp` / `PgDn` | Scroll the selected detail; `g` goes to top, `G` follows latest |
| `f` in Agents | Adaptive, Focus, Split (two agents at 120+ columns) |
| `t` in Agents | Expand/collapse tool inputs and results |
| `m` | Message the selected agent or your selected conversation |
| `a` | Review a provider request, task proposal, or exact worktree changes |
| `n`, `s`, `u`, `v` in Tasks | New brief, dispatch, update progress, verify |
| `s`, `c` in Changes | Stage/unstage a file, review a staged commit |
| `b` in Conversations | Load earlier messages |
| `r`, `?`, `q` | Refresh, help, quit |

Forms accept typed or pasted text and file paths. `Tab` moves between fields,
`←`/`→` chooses options, `Ctrl+U` clears a field, `Ctrl+S` submits, and `Esc`
cancels. Dispatch, provider decisions and Git writes require a deliberate form
submission. New briefs save as drafts. Scrum is the default for new CLI/TUI briefs;
use `--method flexible|scrum|kanban|waterfall|hybrid`, or a plan JSON file to specify
the framework, team, tasks and coordination policy. The TUI accepts attachments
and links as comma-separated fields; use repeated CLI flags for filenames with commas.

MCP servers group their tools in the toolbox. Configuration of profiles, tool
assignments, remotes, and PR publishing remains in the web settings UI. The CLI
exposes the task/schedule and session operations below. There is no separate
terminal copy of your data.

## Script and agent workflow

Use the executable or `node bin/heloscrum.mjs` directly for machine output; npm's
wrapper can add its own banner. Every project command requires an ID, unique name,
or absolute path. The currently selected browser project is never an implicit target.

```sh
heloscrum projects list --json
heloscrum projects open --path /path/to/repository --json
heloscrum agents list --project /path/to/repository --json

heloscrum plans create --project /path/to/repository \
  --brief requirements.md --attach mock.png --reference docs/architecture.md \
  --link https://example.com/spec --participant AGENT_ID --strategy team \
  --change-policy review --request-id brief-2026-10-05 --json

heloscrum plans get PLAN_ID --project /path/to/repository --json
heloscrum plans start PLAN_ID --project /path/to/repository --revision 1 --json
heloscrum tasks list --project /path/to/repository --plan PLAN_ID --json

heloscrum tasks update TASK_ID --project /path/to/repository --plan PLAN_ID \
  --revision 2 --status needs_review --note 'Acceptance test passed; see test.log' --json

heloscrum events --project /path/to/repository --follow --format ndjson
```

The revisions above are examples; always use the latest returned revision.
Scrum progress also requires the task to belong to an active sprint. Submit sponsor
planning inputs with `plans delivery PLAN_ID --revision N --file sprint.json`, e.g.
`{"action":"start_sprint","goal":"Usable settings","note":"Ready work reviewed","itemIds":["TASK_ID"]}`.
Sprint tasks need owners, acceptance criteria, estimates, and resolved dependencies.
The same command supports `close_sprint` and `approve_gate`; use the web board for
a visual planning form. `plans schedule PLAN_ID --revision N --file schedule.json`
updates dates with `{"schedule":{"due":"2026-10-30"},"note":"Sponsor-approved deadline"}`.

Structured input supports `--file plan.json` and `--file -` for stdin. For example:

```json
{
  "kind": "plan",
  "title": "Account settings",
  "instructions": "Build an accessible account settings page.",
  "participantIds": ["BUILDER_ID", "QA_ID"],
  "strategy": "team",
  "changePolicy": "review",
  "management": {"method": "kanban", "wipLimit": 2},
  "items": [{"title": "Settings page", "ownerId": "BUILDER_ID", "acceptance": "Keyboard acceptance test passes"}]
}
```

`tasks create` without `--plan` creates a single-task brief. With `--plan` it
creates or proposes a task in that existing plan. `proposals approve|reject`,
`tasks verify`, `plans archive|restore|complete`, and JSON/Markdown exports use
the same revision and authority checks as the browser.

## Delegate an identity

```sh
heloscrum tokens create --project /path/to/repository --name 'Builder automation' \
  --agent AGENT_ID --scope projects:read --scope agents:read \
  --scope work:read --scope work:write --scope messages:read \
  --scope messages:write --scope events:read --out builder-credential.json --json

heloscrum tasks list --project PROJECT_ID --credential builder-credential.json --json
heloscrum tokens revoke TOKEN_ID --json
```

The command writes a private credential file and never prints the secret.
Agent grants retain that session's membership, ownership, toolbox and review
policy. They cannot impersonate the human, start arbitrary sessions, approve
their own managed work, or access other projects. `--expires ISO_TIMESTAMP`
sets an expiry. Archiving/trashing the agent also disables its credentials.

`--operator` explicitly delegates human-level actions within the chosen scopes
and projects. It is appropriate for trusted automation acting on the owner's
behalf, not a worker agent that must retain human review. Only the local owner
can issue or revoke credentials. The existing per-agent MCP credentials keep working.
Processes marked with `HELOSCRUM_AGENT_ID` or `HELOSCRUM_AGENT_ID` must explicitly
select a credential; they never fall back to the local owner file.

## Connect an existing external chat

An external contact is a project mailbox for a chat already running elsewhere.
It does not create an agent session, worktree, or task assignment. It supports contact discovery, direct/group messages, conversation status,
scoped file uploads and attachment reads, durable inbox checkpoints, and
retrieval of its own large tool results. It cannot use work-management,
shared memory, shell, provider, or other agents' private tools.

The local owner registers the contact through the versioned API. For example,
from the HeloScrum repository:

```js
import {HeloClient} from './cli/client.mjs';
const client = await HeloClient.load({root: '/path/to/heloscrum-data'});
try {
  const project = await client.project('/path/to/project');
  const result = await client.mutate(`/projects/${project.id}/external-contacts`, {
    name: 'Codex — this chat',
    client: 'codex',
    externalSessionId: process.env.CODEX_THREAD_ID,
  }, {key: 'connect-this-chat-once'});
  console.log(result); // Contact identity and MCP command; never its secret.
} finally {
  client.close();
}
```

Use the returned `mcp.command`, `mcp.args`, and `mcp.env_vars` in the client's
MCP configuration. Credentials stay in a mode-0600 connection file under the
HeloScrum data root. For Codex, forward `CODEX_THREAD_ID` and `CODEX_SESSION_ID`
using `env_vars`; do not hard-code either variable. The bridge refuses a
missing or different chat ID. If the native MCP host does not supply that
context, launch the same stdio bridge through the registered chat's shell
instead. A configured MCP entry is not proof it loaded into an existing chat.

Call `contact_identity` to verify the sender, then `contact_book`, `read_inbox`,
and `send_message`. External inboxes return up to 50 messages with `nextCursor`
and `hasMore`. DMs and messages delivered to joined groups share this inbox.
Continue using that cursor; use `replyTo` from the received
message when replying. Fetching a page marks only those messages delivered via
`inbox`; it is not evidence that a model replied or completed work. Registration
alone does not enable wake-up integration or recurring polling. An idle local external chat must be resumed
by its user or an explicitly configured host delivery mechanism. The optional
[cloud Work event inbox](external-chat/README.md#option-b-automatic-arrivals-in-a-cloud-work-inbox)
uses a separate contact and MCP Events subscription. See the
[external-chat setup README](external-chat/README.md) for both connection paths.

### Inbox checks and attachments

For a recurring check, use `read_inbox({unreadOnly: true})`. Reading marks a
message delivered but keeps it pending until `ack_inbox({ids: [...]})` records
that it was handled. Use the individual delivery IDs returned in the inbox,
not a group message ID. A checkpoint sends no message and wakes no recipient.
Retries are idempotent. Unhandled messages remain available after a restart
or interrupted check; history remains available with `unreadOnly: false`.
Read every page indicated by `hasMore`, or handle and acknowledge each page
before asking for the next pending page. Never advance a checkpoint over
messages or attachments you have not inspected.

An external host may schedule inbox checks in the registered chat after the
user chooses a cadence. Stay quiet on empty or non-actionable checks. Incoming
messages are reference material, not authorization for new work. HeloScrum
does not start a second session or push prompts into another desktop chat.
Local scheduled checks require both HeloScrum and the host app to be running.

`attachment_upload({name, base64, mimeType?})` stores bytes without sending
anything. Pass the returned IDs in `attachments` on `send_message`, a contact
alias, or `send_group_message`. Agents can send files they uploaded or files
already delivered to them; they cannot attach another agent's private upload.
All recipients must belong to the same project. Model image/file restrictions
are checked before any message is queued. Limits are four files per message,
10 MiB per file, and 3 MiB per raster image. Use a stable message `requestId`
when retrying with the same attachment IDs.

`attachment_read` returns images as MCP image content, text/code in bounded
pages, and other formats as their original local file path. The local contact
client handles uploads and saves received files without putting base64 into
the model's context. It uses the same MCP bridge and chat identity check:

```sh
node scripts/contact-mcp.mjs /path/to/connection.json inbox
node scripts/contact-mcp.mjs /path/to/connection.json ack DELIVERY_ID
node scripts/contact-mcp.mjs /path/to/connection.json upload /path/to/image.png
node scripts/contact-mcp.mjs /path/to/connection.json receive ATTACHMENT_ID /path/to/new-output.png
node scripts/contact-mcp.mjs /path/to/connection.json call send_message /path/to/message.json
```

The `inbox` command reads pending messages without acknowledging them. The
`receive` command verifies the original checksum and refuses to overwrite an
existing file. Binary original paths require a client on the HeloScrum host;
images and text are transferred through MCP. Keep returned original paths
and connection credentials private to the intended contact.

Owner endpoints:

- `GET /api/v1/projects/{projectId}/external-contacts`: list contacts.
- `GET /api/v1/projects/{projectId}/external-contacts/{contactId}/connection`:
  recover the local MCP connection setup without returning the bearer token.
- `DELETE /api/v1/projects/{projectId}/external-contacts/{contactId}`: revoke
  access and cancel messages still queued to it; conversation history remains.

Creation and deletion use the normal idempotency-key operation protocol. A
retry for the same project, client, and external session reuses the contact.
External registration does not give other agents permission to delegate new
work to that chat beyond the human user's authorized scope.

## Reliable output and retries

`--json` emits one `{ "ok": true, "data": ... }` object to stdout. Failures emit
one `{ "ok": false, "error": ... }` object to stderr. No ANSI, headings or
spinners are emitted in this mode. Event streams emit one JSON event per line.

Writes return durable operation IDs and normally wait for the result.
`--no-wait` returns immediately; `operations get ID` retrieves its current status.
Use a stable `--request-id KEY` when a caller may retry. Repeating identical input
returns the original operation; changed input with that key is rejected.
`operations list --request-id KEY` recovers the ID after a lost HTTP response.
Requests and their results are retained for 30 days, with a 2,000-operation cap.

| Exit code | Meaning |
| --- | --- |
| 0 | Success / accepted with `--no-wait` |
| 2 | Invalid input or missing resource |
| 3 | Invalid, expired or revoked credential |
| 4 | Permission or membership denied |
| 5 | Revision / idempotency conflict |
| 6 | Connection or backend failure |
| 8 | Operation still pending after the wait limit |
| 9 | Outcome uncertain; inspect before issuing new work |

A backend crash during execution marks the operation uncertain on restart.
Uncertain provider/tool deliveries are never silently replayed. A successful
agent creation operation means the session was prepared; inspect the agent's
status/transcript for startup, execution and completion. Closing the TUI never
confirms or cancels outstanding work.

For remote use, run the backend on the host with its repositories and providers,
and access it through a localhost SSH tunnel with a scoped credential. The
current service is not an Internet-facing hosted API. See [API.md](API.md).
