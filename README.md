# HeloScrum

<img src="dist/brand/heloscrum-icon.svg" alt="HeloScrum logo" width="128" height="128">

A local workspace for a team of coding agents. Project briefs and task plans connect
persistent agent sessions, Git worktrees, code review, direct messages, and shared tools.

## Release

HeloScrum is an independent, open-source project under Apache-2.0. This is a
source-based release, with the desktop workflow validated locally on
macOS. Automated checks pass on macOS, Linux, and Windows; native Linux/WSL
agent workflows remain experimental, and native Windows desktop support is not
ready. Context management is experimental.

**Known limitation:** after a forced restart, pending Claude activity reports
can delay queued prompts. Saved-state recovery has passed, but prompt-delivery
recovery still needs a complete retest. See the [workaround and retest](docs/claude-activity.md#known-restart-issue-october-12-2026)
and [release status](docs/RELEASE_STATUS.md).

[Website](https://yokiidesu.github.io/heloscrum/) · [Get started](docs/GETTING_STARTED.md) · [Contribute](CONTRIBUTING.md) ·
[Security](SECURITY.md) · [License](LICENSE) · [Website development](docs/WEBSITE.md) ·
[Release status](docs/RELEASE_STATUS.md)

## Run

### Choose Your Platform

| Platform | Prerequisites | Setup |
| --- | --- | --- |
| **macOS · Apple Silicon or Intel** | Git 2.28+ (Apple Command Line Tools), Terminal, internet access | Desktop app. Run the Bash installer below. It offers the missing runtime and provider tools. |
| **Linux · ARM64 or x64** | Git 2.28+, Bash, curl, tar, a SHA-256 tool; X11/Wayland and GTK/NSS/GBM/XSS/ALSA for Electron | Experimental desktop. Use the same installer; it detects Linux and offers distro packages with your approval. |
| **Windows · WSL 2** | WSL 2 with Ubuntu; WSLg for the desktop window | Experimental Linux route. Run the same installer **inside Ubuntu**, with the checkout in your Linux home directory. This is not native Windows validation. |
| **Native Windows** | Node.js 22.13+, npm, Git 2.28+ for Windows; a native build toolchain if prebuilt modules are unavailable | Contributor/testing use only. There is no supported native Windows desktop installer yet. See the platform guide for the remaining terminal limitation. |

The installer **automatically detects the OS and CPU architecture**. There are
no separate macOS and Linux scripts. It uses compatible installed Node.js or offers
a verified private Node 24 runtime, installs required **Herdr**, and installs
Electron. Provider sign-in stays in your provider's own login flow. Docker, Jev,
and a summary model are optional.

See [Installation by OS](docs/INSTALLATION.md) for commands, prerequisites,
Windows/WSL instructions, and troubleshooting.

### Desktop Setup

Clone the source and run the installer in Terminal (macOS/Linux) or Ubuntu (WSL):

```sh
git clone https://github.com/YokiiDesu/heloscrum.git
cd heloscrum
bash scripts/setup-desktop.sh
```

The interactive installer shows progress and questions, offers provider tools,
and creates a launcher. See [Desktop setup](docs/DESKTOP.md) for options and
lifecycle details. The existing browser launch below remains available.

### Set Up With Your AI

Copy this into a coding agent that can access your terminal. The website's
[setup page](https://yokiidesu.github.io/heloscrum/getting-started.html) also has a **Copy Setup Prompt** button.

```text
Help me install and learn HeloScrum: https://github.com/YokiiDesu/heloscrum.
Read README.md, docs/INSTALLATION.md, and docs/AI_SETUP.md from that repository
or my existing checkout first. Detect my OS, architecture, and shell, explain
its current support status, and check the prerequisites. Use the documented
installer for my platform and preserve my existing projects and configuration.
Leave provider sign-in and permission choices to me. Verify local startup,
then guide me through opening a project, connecting agents, assigning a small
task, sharing attachments, and reviewing the result. Explain what was actually
verified and anything that still needs my input.
```

The repository is public. Your agent can use it or an existing local checkout.
[AI setup guide](docs/AI_SETUP.md).

### Browser Setup

Install Node.js 22.13+, Git 2.28+, and your chosen provider CLI. Codex, Claude Code, and
Kiro CLI also require **Herdr 0.9.0**; see the complete
[installation and first-task walkthrough](docs/GETTING_STARTED.md).

```sh
git clone https://github.com/YokiiDesu/heloscrum.git
cd heloscrum
npm ci
npm run doctor -- --provider codex
npm start
```

Doctor makes no AI calls. Select your installed provider in place of `codex`.
Docker, Jev, and a summary model are optional. Keep the backend on localhost.


Open http://127.0.0.1:4173. Node.js 22.13+ and Git 2.28+ are required. HeloScrum binds to
loopback and runs on your machine. Install and authenticate Codex, Claude
Code, Kiro CLI, or Cursor CLI, or configure a local/AWS model connection under
**Project settings → AI & context**. Agent turns use the selected account or model
server. Multiple Ollama, llama.cpp, LM Studio, Bedrock, and compatible SageMaker
connections are supported. See [AI connections and context management](docs/AI_CONNECTIONS.md)
for setup, Jev decisions, summary models, and reviewed session checkpoints.
The [local LLM walkthrough](https://yokiidesu.github.io/heloscrum/blog/local-llms.html)
includes our llama.cpp and Muse Glimmer settings, measured build times, and the
original playable red-ball example. Saved model connections show **Connected**
when their catalog is reachable; manage them in **AI & Context**.

The **Refresh** control in the header updates the workspace in place, keeping open
drafts and selections. HeloScrum also catches up when you return to the tab and
reconnects after a local server restart, renewing its session token automatically.
If the server is unavailable, a persistent banner shows the last successful sync
and **Reconnect now**; background retries slow down instead of repeating error
toasts. Start `npm start` again if the local server has stopped.

Read requests time out after 20 seconds. Writes and uploads have a longer deadline
and are never automatically replayed after a lost response: check the result after
reconnecting before submitting again. Draft preservation applies to in-place
refresh, not a browser reload. Toasts confirm saves, review decisions, plan state
changes, downloads starting, and recovery; they can be dismissed and pause while
hovered or focused.

## Terminal, CLI and API

Run `npm run tui` in another terminal for the HeloScrum dashboard: adaptive agent
views, live transcripts and tools, task briefs/reviews, conversations, Git changes,
and the shared calendar. `npm run cli -- --help` lists headless commands. For
machine output, use `node bin/heloscrum.mjs projects list --json` directly.

The versioned API at `/api/v1` provides scoped, revocable credentials, explicit
project targeting, revision checks, durable operations and resumable events.
OpenAPI is available at `/api/v1/openapi.json`. All clients share the existing
data and permission rules. See the [CLI/TUI guide](docs/CLI.md) and
[API contract and recovery guide](docs/API.md).

## Projects and saved sessions

Click the project name, or press **Cmd/Ctrl+Shift+P**, to open the project library.
Search projects or session titles, pin projects, and return directly to an agent's
conversation and branch. Switching projects preserves in-tab drafts and reading
state. Projects opened without any agents are remembered too.

Sessions have **Active**, **Archived**, and **Trash** views. Archive and Trash are
reversible: task records, provider history, branches, worktrees, and files are kept.
HeloScrum delivery pauses for archived or trashed sessions. Busy agents must finish
or be interrupted first. Restore brings a session back to Agents; **Resume saved
session** starts an offline provider using its verified session ID without sending
the original task again. Trash does not permanently erase files or free disk space.

Open an existing local Git folder or clone HTTPS/SSH repositories into a new local
folder. Private repositories use the system Git credentials or SSH agent. Under
**Repository & PRs**, add/select remotes and choose GitHub, GitHub Enterprise,
GitLab, self-hosted GitLab, or a generic Git host. Existing remotes are preserved.
Request lists use authenticated `gh` or `glab`; host links remain available if the
CLI is missing. **Publish branch** requires a review of the exact commit and remote,
uses a normal non-forced push, and excludes uncommitted edits. **Prepare PR/MR**
checks that the remote has that commit, then opens the host's creation form for
the final title, description, target branch, and submission.

## Give agents work

Open **Tasks → New task or plan**, or **Assign task** beside the selected agent.
A brief can contain instructions, a complete Markdown plan, links, file attachments
(including images), and paths relative to the project's repository. Any combination
is supported, including an attached brief without additional instructions. Leave
the name blank to derive it from the instructions, plan, or attached filename.

Choose existing agent sessions in the project, then choose how to divide the work:

- **Direct assignment:** assign every starting task yourself.
- **Orchestrator leads:** select a lead from the team to create and assign tasks.
- **Team plans together:** agents coordinate in a shared group and claim work.

Choose **Ask for my review** or **Let agents manage tasks** before submission.
Review mode holds new tasks and changes to scope, ownership, or dependencies as
proposals. Progress-only updates appear immediately. The task board provides
approval/rejection with feedback. Autonomous changes take effect immediately;
both modes record the author, changes, and progress evidence. An orchestrator
remains the only agent allowed to delegate in an orchestrated plan.

**Save draft** does not notify an agent. **Review & start** shows the recipients
and policy before **Start work** queues the brief. Each plan with multiple agents
gets a linked group chat; one-agent work uses a direct message. Existing sessions
keep their models, tools, and worktrees. Offline sessions must be resumed through
Projects. Delivery receipts are distinct from reported task progress.

The board supports tasks, subtasks, dependencies, owners, blockers, review status,
completion, archives, and restoration. Agents use the always-available `work_list`,
`work_get`, `work_create_task`, `work_update_task`, and `work_read_resource` MCP
tools. Membership and project boundaries are checked on every call; revisions
prevent competing claims and stale approval changes. Agents cannot expand their
selected team or start additional provider sessions through these tools.

Full `work_brief` reads include **SMART** guidance: Specific, Measurable,
Actionable, Relevant and Time-bound. Agents use existing project examples to
define the expected outcome, choose evidence that demonstrates it, identify
executable steps and connect them to the parent goal. Agreed deadlines and
review times remain distinct from estimates; absent deadlines are not invented.
See the [SMART assignment guidance](docs/Software%20Development%20Project%20Management%20Operating%20Guide%20for%20Autonomous%20Agent%20Teams.md#21-smart-assignments).
This guidance uses the existing brief fields and review policy. It does not add
automatic approvals or repeat instructions in ordinary messages.

Choose a **Project management style** in the brief form. New forms default to
Scrum; existing briefs retain their original workflow. Both single tasks and
multi-task plans support:

- **Predictive · Waterfall:** six sequential phases, scope/schedule/risk baselines,
  and sponsor-approved gates with evidence. Agent changes after the first gate
  require review even when ordinary task management is autonomous.
- **Adaptive · Scrum:** a product goal, fixed story-point capacity, ready backlog
  items, and sprints. In **Delivery → Plan a sprint**, select tasks with an owner,
  acceptance criteria, and an estimate of 1–8 points. Scope and estimates freeze
  during the sprint. Close with a review and a retrospective improvement;
  unfinished work returns to the backlog and earns zero points.
- **Adaptive · Kanban:** continuous pull with a shared WIP cap. In-progress,
  blocked, and review tasks all consume capacity.
- **Hybrid:** Waterfall gates outside, Scrum sprints inside Design,
  Implementation, and Testing.

Set the Product Owner, Process/Scrum Master, QA lead, and Definition of Done in
the form. Unassigned coordination roles remain with the sponsor. The management
settings, protocol, and current delivery state appear in agent reads and exported
briefs. **Delivery** retains gates, sprint results, and improvements; **Activity**
records the decisions. The sponsor starts/closes sprints and approves gates.
The team sync description is guidance; automatic check-ins are configured
separately under Dates & reminders. Gate approval does not deploy software. Mid-sprint scope swaps, automatic planning poker,
role-specific PO acceptance, and process analytics are not automated.

Managed tasks go to **Needs Review** with evidence. A distinct teammate (the QA
lead or a delegated reviewer, if a QA lead is assigned) or the sponsor verifies
against the Definition of Done through **Verify** / `work_verify_task`. Owners
and prior contributors cannot self-approve. In **Delivery → Manage reviewers**,
the sponsor can delegate or revoke reviews for selected teammates on an active
plan. Delegation preserves the QA lead, records a revision and audit entry, and
appears in each reviewer’s focused brief. A coordinator can manage the review
queue and verify others’ work; their own contributions still need another reviewer.
Recorded verification is a human/agent attestation; HeloScrum does not run the
underlying tests or scans on behalf of the reviewer.

**Settings → Agents** includes a global **Scrum Master** template. Use it in a
project or choose **Duplicate & customize** to change its instructions, provider,
model, scope, icon, and color. Duplicates have independent identities and do not
alter the default template or its existing sessions. Assign a started session to
the Process/Scrum Master role in a brief. It facilitates refinement, syncs,
blockers, review, and improvement; it is separate from an assignment orchestrator.
These workflows follow the supplied [operating guide](docs/Software%20Development%20Project%20Management%20Operating%20Guide%20for%20Autonomous%20Agent%20Teams.md).

Briefs are materialized as versioned JSON and Markdown in `.heloscrum/work/` and
can also be downloaded from **Brief & resources**. Attachments and repository
references are immutable snapshots in `.heloscrum/work-resources/` (20 MiB per
file, 30 files and 100 MiB per brief). Links are references, not fetched on save.
Agents can read attachment text and supported small images through the MCP tool;
other formats include their local file path. Brief exports contain resource
metadata and paths; copy the attachments too when moving work to another machine.

File links open in an in-app viewer with Back/Forward history. Markdown and Word
(`.docx`) have formatted reading views; PDF has page navigation, zoom, and selectable
page text; `.txt` and other text files show their source. Mermaid diagrams render
from `.mmd` / `.mermaid` files and fenced Markdown blocks, with source available.
Saved brief resources use the same preview formats. Word previews preserve document
structure rather than exact page layout; download the original for editing or
layout-sensitive review. Previewing does not upload documents to another service.

DuckDB records plan versions and attachment metadata. Archiving preserves files
and history and cancels queued brief messages, but does not interrupt an agent
turn already running. Restoring a plan does not resend cancelled messages.

### Calendar and saved reminders

**Tasks → Calendar** shows plan dates, task deadlines, milestones and sprint
windows in the project’s time zone. Open an entry to edit the task or its plan.
Add dates while creating a brief, through **Dates & reminders** on a plan, or in
**Task details**. Planned sprint windows are set when starting a sprint in Delivery;
the end date prompts a review, never automatically closes the sprint.

**Settings → Schedule & reminders** controls project defaults. Plans can inherit
those defaults or override reminder rules. Deadline alerts are on by default;
agent check-ins and resuming inactive sessions are off. Quiet hours default to
10 PM–8 AM, with a one-hour minimum gap between a plan’s reminders. Use the owner
or coordinator option to queue a check-in alongside an alert; choose a recurrence
if you also want periodic progress checks.

**Tasks → Reminders** keeps saved alerts and delivery status, including safe queue
retries and uncertain deliveries that need inspection. A new alert also appears
as a toast and in Activity. Completed or archived work stops generating alerts.
Changing dates invalidates pending reminders. After downtime, outdated alerts are
skipped and missed checks are combined.

The worker runs every 30 seconds inside the backend, and after startup or schedule
changes. It uses no AI to check the clock. Keep the backend running for reminders
to continue while the browser is closed; computer sleep or shutdown pauses it.
There are no OS/email notifications or external calendar integrations.

Agents use `work_schedule` for the same calendar, `work_update_schedule` for plan
dates, and `work_update_task` for task dates. Existing revision checks, review
policy, ownership, Waterfall baselines, independent QA and sprint boundaries
still apply. Only the user can change reminder rules or permit inactive sessions
to resume. See [scheduler behavior and recovery](docs/SCHEDULER.md).

## Work with a team

Use **Add agent** to create a session with a role, capability summary, instructions,
and a branch. HeloScrum
creates a worktree from the project's committed HEAD, registers the role in the
Contact book, and starts a persistent agent with the shared MCP toolbox configured
for that session. Several agents can start and work concurrently.

**Agents** keeps the original four-agent **Grid**, plus **Focus** (one agent),
**Split** (two selected agents), and **Overview** (compact summaries). Laptop-sized
windows start in Focus unless you have saved another layout. The agent switcher,
selected task, and branch stay connected across Agents, Conversations, and Changes.
Agents awaiting input or setup are labeled **Needs Review**. Each card has:

- **Appearance:** click the agent icon or open its settings to choose one of 40
  [Lucide](https://lucide.dev/guide/static) icons and 16 colors. Appearance saves
  independently of provider/model changes and is retained across restarts.
  The default is a bot icon with an automatically assigned, stable color.

- **Chat themes:** **Bubble** preserves the original presentation; **Block** uses
  distinct user, agent, reported activity, read/edit/command, and result blocks.
  Both render sanitized Markdown, inline/fenced code with copy controls, and
  locally rendered Mermaid diagrams. Block shows expandable tool inputs/results,
  diff coloring, observed durations when available, and latest-turn tool progress.
  Thinking appears as a collapsed activity entry in both chat themes and TUI.
  Expand it to read provider-supplied thinking text or public reasoning summaries;
  collapse it to keep only the activity indicator. Encrypted/redacted content is
  never displayed. Entries distinguish no recorded text, no recorded summary,
  and text withheld by the provider. A whole turn being interrupted does not
  label earlier thinking entries as cancelled; their own status is used when
  available, otherwise they are shown as recorded activity.
- **TUI:** HeloScrum's keyboard-driven, text-based rendering of that same history,
  with messages, code, state reports, expandable tool calls, and progress.
  Switching views preserves the conversation, draft, and expanded tool details;
  it does not start another model session or attach a provider terminal.
- A message composer, interrupt control, branch, changes, and toolbox discovery
  status. Provider setup and permission requests appear inside the agent card in both Chat and TUI.

Both views share one buffer and poll persisted history, so they can lag the
running agent; this is not per-token streaming. Codex history uses a read-only
app-server client and the session ID reported by Herdr. When Herdr omits that ID,
HeloScrum looks for a single CLI session created for the task's exact worktree,
validates its directory, and remembers the ID. Ambiguous matches are rejected.
Claude's SessionStart hook registers its transcript
path and session ID. The readers validate the session's worktree/path before
returning messages. If session identification is unavailable, the card shows the
history error with session setup available in Agents or Task details. Claude JSONL normalization is version-sensitive. Codex
history includes the latest 30 turns/250 events; Claude currently reads transcripts
up to 32 MiB and returns the latest 250 events. The independent DuckDB collector retains full available normalized history beyond these live-view limits; see [durable history](docs/HISTORY.md).

**Conversations** contains the existing project-spanning agent DMs, groups, replies,
filters, delivery receipts, and questions. It stays mounted across navigation so
reading position and drafts remain intact. Contacts, Toolbox, Memory, History,
Activity, project switching, and quick actions remain in the shared shell.
Click a project banner to collapse or expand its conversations. **Hide** appears
on hover or keyboard focus (always visible on touch); hidden projects are grouped
below a divider with a count. Clicking a hidden project restores and expands it.
These visibility preferences persist in this browser.

**Changes** combines file selection and diffs with file/hunk stage and unstage,
reviewed commits, and clean fast-forward merging. Project working copies without
an agent are selectable here too. **Mark reviewed** saves an exact content/index/HEAD
fingerprint in local durable state; later edits invalidate it, and stale marks are
rejected. This action does not stage, commit, merge, or approve an agent tool.
The UI calls a Git hunk a **section**: one contiguous group of changed lines in
one file. **Stage section** stages only that group; **Stage file** stages all of
that file's current changes. Confirmations identify the file and scope.
Review marks support up to 500 changed files, with untracked content limited to
32 MiB per file and 64 MiB total. If a whole-workspace fingerprint is unavailable,
individual file diffs and staging remain available.
**Open handoff** opens the selected agent's latest recorded result conversation;
it is unavailable until a result exists.

**Task details** preserves the brief, branch/worktree, provider/model controls,
recent activity, and task-associated Docker services. Services retain attachment,
CPU/memory metrics, logs, start/stop/restart, and connection health. An agent task
can run without an attached container.

Keyboard in Changes: J/K selects files, S stages/unstages, Cmd/Ctrl+K opens quick
actions. Main tabs support arrow keys and Home/End. Enter sends a chat message;
Shift+Enter adds a newline. Theme/layout changes preserve drafts, tool disclosures,
reading position, and provider sessions. Reduced-motion preferences are respected.

Agent icon and color preferences follow the stable HeloScrum agent ID across
roster cards, Bubble and Block messages, delivered DMs, group chats and replies,
contacts, attributed memory, Changes, and saved provider-session history. Changing
appearance updates already loaded views and older conversations without rewriting
message content or archive records. Archived and trashed agents remain resolvable;
provider changes and resumptions retain the same identity. Appearance revisions
prevent older responses from undoing a newer choice. Agents with matching role
names remain separate, and unattributed legacy records are never guessed by name.

## Connect an existing chat through MCP

For a walkthrough, read the [website connection guide](website/blog/connect-your-existing-agents.html), also available from the in-app tour.

An existing Codex chat can join a project as an **external contact** without
starting another agent session or worktree. HeloScrum agents can send it DMs,
include it in new group chats, and exchange authorized images and files.

Choose a local connection, an optional cloud inbox, or both:

| Connection | Incoming messages | Available actions |
| --- | --- | --- |
| Local Codex contact | Read on demand or with a user-configured heartbeat | Authorized messages, group conversations, file uploads and attachment reads |
| HeloScrum event inbox | MCP Events wakes a separate subscribed cloud Work chat | Inbox/group/attachment reads and handled-message checkpoints |

The cloud option uses a dedicated contact, owner-private OAuth gateway and local
outbound relay. Its current plugin does not expose message sending or task-board
changes. Group membership belongs to each contact separately. Keep HeloScrum and
the relevant host/relay running; connecting MCP alone does not wake a local chat.

Start with the [external-chat setup README](docs/external-chat/README.md) for
registration, MCP configuration, quiet inbox checks, files, cloud subscriptions
and troubleshooting. The [MCP Events deployment notes](docs/mcp-events.md) record
the private gateway design and the recorded live DM delivery test.

## Direct communication and hotloading

Every role has a unique `chat_<role>_<id>` tool whose description contains its
capabilities. All agents in a project share one HeloScrum backend, while each agent
has its own credential and mailbox identity. A sender cannot impersonate another
agent or message a different project's contacts through this endpoint.

Built-in tools:

| Tool | Purpose |
| --- | --- |
| `contact_book` | Current roles, capability summaries, and exact chat tool names |
| `send_message` / individual `chat_*` tools | Direct messages with sender, recipient, reply ID, and delivery receipt |
| `create_group` / `list_groups` / `read_group` | Create and inspect named group chats with membership checks |
| `send_group_message` / `set_chat_status` | Send typed messages, close completed chats, reopen with a reason |
| `ask_user` | Ask the project owner a question in a group, with notifications, answer choices and a linked reply |
| `read_inbox` | Messages arriving while the agent works |
| `toolbox` / `invoke_tool` | Discover and invoke the current catalog, including recently added tools |
| `report_state` / `request_support` | Report operational state and ask an assigned coach for a recovery plan |
| `memory_read` / `memory_write` | Shared project notes with revision checks to prevent lost updates |

Agents can create groups themselves with `create_group`; you do not have to create them. **Chat Threads → New group** creates a named group; its composer can message all members as you. Requests/results can wake idle agents. Acknowledgements (`kind=ack`) stay in inboxes without waking agents or requiring replies. Closed chats cancel queued messages and reject further sends until explicitly reopened.

Messages are persisted immediately in DuckDB. Automatic delivery waits until the recipient's
session is ready and idle/done. Working or blocked agents are not interrupted;
they can call `read_inbox`. A receipt means queued/delivered input, not that a
model has read, answered, or completed the request. Ambiguous delivery failures are
marked uncertain and are not blindly retried. Callers can provide `requestId` to
avoid duplicate sends.

Open **Settings** in the top bar, **Projects → Settings**, or an agent's
**Manage availability** / toolbox menu to manage project resources. The Agents
tab creates reusable profiles from scratch or from an existing agent. Profiles
can belong to one project or be Global; **Use in this project** opens task creation
with their provider, instructions, and appearance. Each task starts a separate
session and worktree. Changing a profile's scope does not move existing sessions
or conversations. Color and icon edits propagate to every linked session,
including archived sessions and past messages.

**Tools & MCPs** separates availability (one project or all projects) from
assignment (all agents in scope or selected sessions/profiles). Selecting a
profile includes its current and future sessions where that profile is available.
Explicit assignments enable those tools in selected agents' toolboxes; agents'
individual toolbox checkboxes can narrow access further. Scope changes and
disabling a connection are checked on every call, including `invoke_tool`.
Already-running calls may finish; future calls use the new policy. Global tools
do not grant access to another project's chats, contacts, or shared memory.

Connect an MCP server by **Streamable HTTP** endpoint or a local **stdio command**.
Save & connect discovers its tools, shown under a collapsible server banner in
settings, the project Toolbox, and assigned agents' tool menus. Remote tool names
are namespaced to prevent collisions; the UI retains their original names and
source. The AWS Knowledge preset fills its public endpoint for review before
connecting. HTTP API-key / Authorization headers and local environment variables
are supported; browser OAuth sign-in and legacy HTTP+SSE are not yet supported.
Local commands run with your permissions. Only the safe stdio environment plus
explicit variables is inherited; credentials should go in headers/environment,
not URLs or command arguments.

MCP credentials are stored separately in `.heloscrum/mcp-secrets.json` with mode
`0600`, excluded from state and history exports. They are not encrypted at rest;
use your OS account's file protection. The MCP client uses separate connections
per project for HTTP; local stdio calls use the agent's worktree and a connection
for that worktree (catalog discovery uses the project folder). It uses
20-second discovery requests, 55-second tool calls, a 500-tool /
1 MiB catalog limit, and a 2 MiB result limit. Existing cached catalogs restore
on restart; **Refresh tools** rediscovers them. Disabling an MCP retains its
configuration for later use. These controls cover HeloScrum-served tools, not a
provider's separately configured native tools or operating-system permissions.

Register an executable in **Toolbox → Manage tools & MCPs** with a name, description, fixed arguments,
and object JSON Schema. It receives JSON on stdin and returns stdout/stderr. The
backend validates arguments and launches without a shell, with a 60-second timeout
and 1 MiB output cap. Registration makes the executable available; it does not run
it. For example, `refresh_aws_creds` must point to an actual credential refresh
program you choose, rather than a simulated success action.

The stdio MCP bridge advertises `tools.listChanged` and emits
`notifications/tools/list_changed` on registry changes. A Contact notification
("QA has been added as a contact") differs from a Tool notification. **Toolbox
synced** means that runtime has requested the current tool catalog; registration
alone never sets it. Clients that do not refresh dynamically can still discover
and invoke new tools through the stable `toolbox` / `invoke_tool` tools.

Model traffic continues through each provider's runtime. The common endpoint is
for collaboration, tools, and memory; using one model URL is not required for
cross-agent communication. Browser automation tools and provider-specific prompt
cache controls are not bundled yet. Existing provider-native tools/cache behavior
remain available, and the executable registry can expose installed tools.

### Questions for you

A member can call `ask_user` with `threadId`, `question`, optional `options` (up to five), and a stable `requestId`. The question appears in the group and **Activity**, with an in-app toast linking directly to it. Choose a suggested answer or type your own. The answer is recorded as **You**, linked to the original request, and queued once for every member. It is a communication response, not a provider permission grant.

Requests survive server/browser restarts in DuckDB. Retrying the same request ID does not duplicate notifications or messages. Agents receive a pending receipt immediately and should continue independent work or finish their turn; they should not poll for an answer. Each agent can have up to three pending questions. Closing the group cancels unanswered questions and queued deliveries. Toasts appear while HeloScrum is open; background OS notifications are not implemented.

## Agent state and recovery contacts

Use **Add agent → Recovery coach (Therapist)** to create a coach, then choose that
contact in each teammate's **Tools** menu. It is a real teammate with its own
provider session and mailbox. The role template asks for a short recovery plan,
one concrete next check, and a stopping condition. It does not claim to diagnose
feelings or automatically solve the original task.

New agents are instructed to call `report_state` before each response. State pills
show Focused, Uncertain, Overloaded, Stuck, or Recovering, with the reported reason
and next step. Context percentage, compaction count, and repeated failures are
optional self-reported metrics; unknown values remain unknown. A response's pill
comes from its preceding successful state call, never from the latest status
retroactively applied to old messages. Missing reports display **Not reported**.
This is a runtime instruction, not an enforced interception of every provider
response. There is no autonomous loop detector or context-reset mechanism yet.

`request_support` sends the assigned coach a bounded brief containing the goal,
blocker, attempted fixes, and reported state. Calls reuse an outstanding request;
after a reply, new requests have a cooldown. Coaches reply through the existing
contact/mailbox tools and cannot chain `request_support` calls to other coaches.
The sender is told to yield or do independent work rather than poll repeatedly.
Normal idle-session delivery and uncertain-delivery handling still apply.

## Per-agent tool access

The **Tools** button at the top right of every occupied card expands a scoped
catalog. It shares one row with the model picker, Chat/TUI, and Expand, with an allowed-tool count badge.
Choose all current/future tools, or an explicit selection. New tools are
not automatically granted to agents using a selection. Memory read/write access
is independently selectable. Coordination tools and project contacts remain
available so agents can discover teammates, report state, and obtain help.

The backend filters `tools/list` and rechecks every invocation, including nested
`invoke_tool` calls; a stale client catalog cannot bypass a revoked permission.
Changes publish the normal MCP list-change notification and update the discovery
indicator after that agent reloads its catalog. Concurrent access edits reject a
stale policy revision rather than silently overwrite another edit.

The recovery role starts with only memory and coordination access in HeloScrum.
These permissions govern HeloScrum's tools. Provider-native shell, browser, and
other tools retain the provider's own settings; this feature is not an OS sandbox.
Already-running tool processes are not terminated by a permission change.

## TUI interaction

The TUI renders the same normalized events as Chat into a fixed screen. Progress
updates repaint in place, and unchanged polling results produce no output. No
heartbeat messages are appended to the conversation. The terminal-style layout uses shaded user turns, purple response bullets, blue
code and paths, and compact tool activity. Markdown headings and emphasis render
as terminal text styling; tool inputs and results remain expandable. The footer
keeps the runtime, branch, and message prompt visible. Unknown usage metrics are
not invented.

Live responses pulse, running tools use rotating indicators, and new output gets
a brief highlight. Solid rails connect consecutive tool calls within a turn.
Animations repaint only changed rows and stop for completed work. Scrolling uses
fractional pixels at the display's animation-frame rate, with a pinned status line
and smooth follow mode. Reading older history suspends follow until **Latest** or
End. The system's reduced-motion preference disables these effects, and hidden
TUI views stop their animation clocks.

Use arrow keys/J/K or the mouse wheel to scroll, Page Up/Down to move a page,
Home/End to jump to the beginning/latest, and Tab/Shift+Tab to select tool calls.
Enter expands the selected tool's input and result. Press I to focus the shared
message composer; Enter sends and Shift+Enter inserts a newline. **Expand TUI**
provides more space and **Restore grid** returns to four cards.

The grid uses xterm as a local renderer without a PTY or WebSocket attachment.
The backend's separate native-terminal adapter remains covered by its own tests.

## Provider contracts

### Changing an agent's model or provider

Click the provider/model label beneath an agent's name in the grid, or the same
control in its workspace. New-task creation also accepts a model. Codex choices
come from the installed CLI's `model/list` catalog. Claude choices use its model
aliases, with an exact-ID option for other models supported by the account.
Kiro CLI choices come from `kiro-cli chat --list-models --format json`.

Changes require an idle session. The review screen offers an explicit interrupt
action for busy agents; incoming or in-flight messages cannot race a switch.

- **Same provider:** gracefully exit the old CLI, then resume its exact saved
  session ID with a session-local `--model` override. No original task prompt is
  replayed. Existing saved history and compaction summaries are handled by the
  provider's resume mechanism. Smaller context windows may require compaction.
- **Different provider:** save the currently displayed normalized history, then
  start a fresh provider session in the same worktree. The user reviews and can
  edit a bounded handoff before it is submitted. Excerpts can omit older content;
  this does not transfer provider-internal context or reasoning. Previous displayed
  messages remain above a session boundary in both Chat and TUI. Original native
  transcript files remain untouched; the UI reader's per-session limits still apply.
- **Preserved:** task identity, role, branch, uncommitted edits, service ownership,
  contacts, shared memory, and scoped HeloScrum tool access. Native session-only
  approvals and caches may need to be established again. Old operational metrics
  are cleared until the replacement reports fresh values.

Snapshots are stored under `.heloscrum/agents/<task-id>/sessions/`. If a replacement
cannot start and no agent remains attached, model settings offers **Resume saved
session** to recover the original provider session without replaying its task.
The replacement is never launched until the original process has exited.

### Kiro CLI

Install and sign in to Kiro CLI, then choose **Kiro CLI** in **Add agent** or an
existing agent's provider settings. HeloScrum launches the v2 engine with its TUI
and reads that exact session's saved messages and tool calls into Chat and TUI.
Kiro's model catalog does not expose model-specific effort capabilities, so its
effort setting is inherited.

Each task gets a uniquely named `.kiro/agents/heloscrum-<task-id>.json` in its
worktree. It connects to the same scoped HeloScrum MCP toolbox, contacts, inbox,
and shared memory used by the other providers. Only that generated file is added
to Git's local excludes; existing agent profiles and default settings are preserved.
Tool approvals remain with Kiro. No `--trust-all-tools` or preapproved tool list
is injected.

History uses the v2 files under `~/.kiro/sessions/cli/`, validating the session ID
and worktree before display. New sessions are discovered only in their own
worktree and creation window; ambiguous matches are rejected. Model changes
resume with `--resume-id`, never the directory's most recent conversation.
The reader limits metadata to 8 MiB and transcript files to 32 MiB. Legacy v1
and experimental v3 histories are not supported.

References: [Kiro custom agents](https://kiro.dev/docs/cli/custom-agents/),
[session management](https://kiro.dev/docs/cli/chat/session-management/), and
[CLI commands](https://kiro.dev/docs/cli/reference/cli-commands/).

Provider references: [Codex app server session and model behavior](https://learn.chatgpt.com/docs/app-server),
[Claude model configuration](https://code.claude.com/docs/en/model-config),
[Claude CLI resume flags](https://code.claude.com/docs/en/cli-reference).

Implementation references:

- [MCP TypeScript SDK client](https://ts.sdk.modelcontextprotocol.io/client)
  for remote Streamable HTTP and local stdio connections.
- [AWS Knowledge MCP](https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server)
  for the public documentation endpoint preset.
- [OpenAI Codex app-server](https://developers.openai.com/codex/app-server/) for
  initialization and read-only thread history.
- [OpenAI Codex MCP configuration](https://developers.openai.com/codex/mcp/) for
  session-scoped MCP setup.
- [Claude Code MCP](https://code.claude.com/docs/en/mcp) for tool discovery and
  list-change notifications.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks) for SessionStart
  session IDs, worktree paths, and transcript paths.
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
  for tool catalogs, calls, and list-change notifications.

Validated locally with Herdr 0.9.0, Codex 0.153.4, and Claude Code CLI flags from
2.1.236. Kiro CLI 2.27.1 was checked with a real Herdr startup and graceful exit, MCP catalog
discovery, and an existing v2 session read. Codex protocol initialization was checked
against the installed binary.
Full authenticated model turns and provider-client hotloading have not been run
as part of the automated suite; the live hotloading test uses two MCP test clients.

## Engines and reused code

- **Herdr:** headless persistent workspaces, state, prompts, output, and terminal
  attachment through its CLI protocol.
- **lazygit:** adapted MIT patch parser behind native hunk review.
- **lazydocker:** adapted MIT time-windowed resource history behind task services.
- **Git and Docker:** native worktree, staging, commit, merge, container inventory,
  metrics, logs, and lifecycle commands.

The lazygit and lazydocker binaries are not required. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for source revisions and notices.
HeloScrum discovers `herdr`, `docker`, `codex`, `claude`, and `kiro-cli` in `.heloscrum/bin`, then
PATH. Overrides: `HELOSCRUM_HERDR_BIN`, `HELOSCRUM_DOCKER_BIN`, `HELOSCRUM_CODEX_BIN`,
`HELOSCRUM_CLAUDE_BIN`, `HELOSCRUM_KIRO_BIN`. Other machines need their own binaries and Docker engine.

## Local state

Task records, prompts, messages, shared memory, tool definitions, credentials,
worktrees, and runtime configuration live in ignored `.heloscrum/`. State and agent
connection files are written with private file permissions. Browser API calls use
a per-process token and matching local host/origin. MCP calls use per-agent
credentials; registered executables run with your local permissions. Git worktrees
separate file changes but are not security sandboxes.

Sessions persist across browser/server closure. Stop the dedicated engine and its
agents explicitly when finished:

```sh
HERDR_CONFIG_PATH="$PWD/.heloscrum/herdr/config.toml" herdr --session heloscrum server stop
```

Current limits include line staging, interactive rebase, conflict resolution,
undo/reflog controls, Compose provisioning, image/volume cleanup, token budgets,
and remote execution.

## Validation

For a hands-on walkthrough with copy-and-paste agent prompts, see
[Getting Started](docs/GETTING_STARTED.md#4-give-a-small-task-to-a-builder-and-reviewer).

```sh
npm run check
npm test
```

The suite tests real temporary Git worktrees and hunk operations, stale review
rejection, commits and merges, API boundaries, Docker normalization, resource
expiry, concurrent dispatch, failure recovery, provider message normalization,
shared-memory revisions, direct message delivery, schema-validated executable
tools, and live two-client MCP discovery. Tests do not launch paid model turns.
The TUI tests cover event parity, tool expansion, scrolling, fixed-screen progress,
Unicode wrapping, and hostile terminal escape sequences. UI verification uses
shared-history fixtures to check Chat/TUI switching, drafts, sending, keyboard
navigation, resizing, and zero native-terminal connections. Scoped access controls
and hostile Markdown sanitization are also checked.

If a task shows **Agent did not start**, use **Retry start** in the grid or task
workspace. A refused launch reuses the task, branch, contact, credentials, and
original prompt. HeloScrum waits briefly for shell initialization and replaces an
idle Kiro-wrapped shell when necessary. Managed shells set
`PROCESS_LAUNCHED_BY_Q=1` to avoid nesting Kiro's terminal inside Herdr; your global
shell configuration is unchanged. Ambiguous launch timeouts or prompt delivery
are not automatically retried, because the provider may already be running.

Provider trust/setup prompts keep the initial task queued until the session is
ready. Answer them directly in the agent grid. Codex tool prompts expose **Allow once**,
**Allow for this session**, **Always allow**, and **Cancel**. Other provider menus
show their current output with selection and confirmation controls in the same card.
Each response is checked against the displayed request before submission. Chat and TUI also
recover Claude history if its startup hook was missed: the reader checks only the
launched session ID in that worktree's transcript directory and validates ownership
before attaching it.


### Agent conversations

The grid presents recorded agent DMs as named message bubbles. Its TUI presents the same body with Markdown, a sender/recipient heading, and compact borders. Routing IDs and reply instructions remain in the provider's original input; HeloScrum formats a message only when it matches a recorded delivery. Operational-state lines retain a steady background, and the interrupt hint keeps its position while the progress dots animate.

**Chat Threads**, beside Contacts, browses conversations across saved projects. Project banners group the list, and the selected chat shows its project beside the title. DMs are grouped by the two agents, and group chats show one message with its recipient delivery states. Search by agent, chat or project; filter DMs/groups, project, activity date and open/closed status. Sort newest/oldest or project A–Z/Z–A; entries animate into position and honor reduced motion. Dates precede times using Today, Yesterday or a calendar date in your timezone. Load earlier messages without losing your reading position. Threads survive local server restarts and provider changes; each stays associated with its original project. Browsing or replying in another project does not switch the active workspace, and agent tools retain their project and membership boundaries.

Agents can use `send_message` with `to: "agent-id"` for a DM, or `to: ["agent-id-1", "agent-id-2"]`, `name`, and `message` to start a group. The receipt includes `threadId`; group replies use that `threadId` and optionally `replyTo`. Group membership is fixed at creation and limited to contacts in the same project. Messages queue until each recipient can accept them. If a runtime still has the old tool schema cached, `invoke_tool` with name `send_message` accepts the current input shape. You can create groups and send messages as yourself from the thread browser. It never impersonates an agent.

The Contact book includes **Refresh tools** per agent and **Refresh all contacts**. These request MCP tool-list discovery without sending a chat prompt or restarting agents. Only the runtime's subsequent list acknowledgment marks a contact **Tools up to date**; a heartbeat alone does not. Requests persist until the runtime reconnects, and refreshing one contact does not invalidate the others.

In Chat, a floating **Scroll to bottom** control appears while reading earlier messages. Shared memory has an expand/restore control for longer notes. The tool registration form starts with indented JSON and provides **Format JSON**, preserving the entered text when it cannot be parsed.

## Durable History

Open **History** for saved provider sessions, conversations, shared memory revisions, commit references and file snapshots. Capture and export are available there; [storage and restore details](docs/HISTORY.md) explain the limits.

Use [Platform Testing](docs/PLATFORM_TESTING.md) to verify a disposable builder/reviewer task and restart recovery.

### Model and effort transparency

Choose **Reasoning effort** when creating a task or in an agent’s model settings. Codex options come from its local model catalog; Claude options depend on the installed CLI and model. **Inherit provider settings** leaves the effort override unset. Levels are provider-specific and are not a cost or quality equivalence across providers. Codex Ultra includes automatic task delegation where its catalog offers it.

Model settings show both the requested model/effort and the last observed exact model ID/effort from the saved provider session. An alias such as `opus` is not an exact version pin; select **Exact model ID…** to pin a version supported by your account. Missing observations stay marked as unreported. Provider policies or alias overrides may change the effective level. Observed metadata is retained with archived transcript events and task records.

Effort-only changes use the existing review/apply flow and resume the same provider session without replaying the task. Overrides are session-local (`model_reasoning_effort` for Codex, `--effort` for Claude); HeloScrum does not edit global provider preferences. Cross-provider changes still require a reviewed context handoff.

### Queued directions and steering

Agent-card messages default to **Queue**. HeloScrum saves them before delivery, displays pending messages beside the composer in Chat and TUI, and sends them when the provider is ready. **Edit** cancels an unsent message and restores its text to the composer; sending the edited draft creates a new queued message. A delivery already claimed by the backend cannot be edited. Unknown delivery outcomes remain visible and are never automatically repeated.

**Steer** makes the direction available through HeloScrum's `read_inbox` tool while the agent works. It does not interrupt an active command or guarantee a particular provider's thought boundary. If the agent does not check its inbox, the message waits until it is free. After sending, the composer returns to the default queue mode.

The versioned agent-message API accepts `mode: "queue"` (default) or `"steer"` and an optional `requestId`. Operators can cancel unsent directions with `POST /api/v1/projects/{projectId}/agents/{agentId}/messages/{messageId}/cancel`. Cancellation and delivery are serialized so edits cannot race into a duplicate send.

## Claude activity and Jev memory ranking

The website introduces the optional [Claude visual Mod](website/add-ons.html).
Eight [role packs](docs/claude-role-packs.md) add read-only workspaces for
Orchestration, Scrum Master, UI/UX, Game Design, QA / Independent Reviewer,
Data Architect, DevSecOps, and Knowledge Manager. Open **Role packs** in a
Claude agent's footer: **Off** is the default, **Manual** needs no Jev connection,
and **Jev Auto** selects every matching installed pack from current duties, with manual pins
and bounded, recorded inference. Packs do not grant review or execution rights.

Claude Code sessions can show visual test results, file-change previews, animated
activity, and a context gauge through a local Mod. The `/heloscrum` command opens
a native panel with Activity, Changes, Context, and Roles tabs plus an optional status
strip. See [Claude visual Mods](docs/claude-activity.md) for setup, version support
and limits. Existing sessions pick it up on their next
native restart/resume.

Enable **Rank memory search with Jev** in model/context settings to rank bounded,
authorized passages by relevance. Exact references stay first, local-only search is
available per query, and failures fall back to local results. See
[Working memory](docs/working-memory.md) for privacy, measured usage and evaluation limits.

## Team Conversation Style

Project settings → Conversation offers Concise, Conversational (default), and Expressive. The setting applies to new sessions and the next delivered message without rewriting history or starting extra model turns. See [conversation style](docs/CONVERSATION_STYLE.md).
