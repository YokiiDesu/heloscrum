# Native setup

Open **Native setup** when creating an agent or from its model/settings button.
Reusable agent profiles can save the same choices for new sessions. These controls
use the installed provider CLI on the HeloScrum backend machine.

| Provider | Native profile | Session mode |
| --- | --- | --- |
| Codex | User `<name>.config.toml` files under `CODEX_HOME` (normally `~/.codex`), passed with `--profile` | Interactive CLI; exact saved-session resume |
| Claude Code | User or project `.claude/agents/*.md`, passed using the frontmatter `name` with `--agent` | Interactive CLI; exact saved-session resume |
| Kiro | V2 JSON or V3 JSON/Markdown under `.kiro/agents` | Interactive V2 or V3; private task profile plus HeloScrum MCP |
| Cursor | Existing native configuration; no named profile selector | Headless or interactive CLI with an exact saved chat ID |
| Model endpoints | Not applicable | HeloScrum-managed tools and context |

Leaving the profile empty preserves the existing launch behavior. Explicit model
and effort selections override native defaults. With a selected native profile,
leave the model empty to inherit its choice. Codex and Claude continue to load
their own user configuration; HeloScrum does not install plugins or bulk-load skill
descriptions. Provider trust, account access, and permission rules still apply.

## Project files and worktrees

Agent worktrees start at the project's committed HEAD. Native setup lists known
configuration files, instructions, skills, hooks, and rules. Select additional
**local, untracked files** to copy when creating the agent. Selecting a project
profile also selects its local profile file; select any companion files it needs.
Tracked configuration comes from Git, including tracked native profiles, rather
than from uncommitted edits in the main checkout.

Copied files retain their relative paths, use private file permissions, and are
excluded from Git through `info/exclude`. Existing worktree files are never
overwritten. Symbolic links, known credential-store filenames, session/history
stores, files over 1 MiB, and selections over 5 MiB are rejected. Detection is
bounded to 256 files and 2,048 entries; larger collections should be managed by
Git or the provider CLI. A settings or MCP file can itself contain credentials or
commands: select it only if the agent should have that configuration.

Recent Claude Code versions share the main checkout's
`.claude/settings.local.json` across worktrees. HeloScrum identifies that file as
shared and does not duplicate it. Check `/status` in Claude's terminal to confirm
what the installed version loaded. Global credential stores are not copied.

File selections are fixed after worktree creation. Edits inside that worktree
stay with the agent. Changing the native profile of an idle agent requires a
reviewed handoff into a fresh session; the old transcript and recovery settings
remain saved. Configuration changes between review and apply invalidate the
preview. Reusable-profile changes apply to new sessions, not existing ones.

## Kiro custom profiles

The selected JSON profile is stored privately under the task's backend data
directory. Its model, prompt, hooks, resources, native MCP servers, tool aliases,
and permission settings are retained. HeloScrum assigns a unique profile name and
description, adds its `heloscrum` MCP connection, and makes `@heloscrum` tools
available without adding permission approvals. Existing native `allowedTools`
rules stay unchanged. Conflicting `heloscrum` MCP names are
rejected. New launches use `heloscrum`; already-running sessions keep their existing
connection until restarted.

Relative `file://` prompt references are resolved from the original user profile
directory, or the project profile directory inside the worktree. Referenced
resources remain references, not snapshots of their contents. Later edits to the
original JSON profile do not silently change a running task's saved profile.

Select **Kiro engine → V3** in Native setup to use the current harness, V3
permissions and hooks, and Markdown profiles. YAML frontmatter and the Markdown
prompt body are preserved in the task's private JSON copy. If a JSON and Markdown
profile have the same filename stem, give them distinct names before selecting.

Existing sessions default to V2. Changing engines requires a fresh reviewed
handoff; V2 UUIDs cannot be resumed as V3 `sess_…` IDs or vice versa. HeloScrum does
not migrate native profiles, hook policies, or global settings automatically.

V3 history uses a read-only ACP connection (`--agent-engine=v3 --auth-method=cli`)
and requires the installed CLI to advertise session listing and export. It never
starts a model turn or loads a second executing session. The reader verifies the
export's session/worktree identity, reads messages, tools and provider-supplied
thinking text, and removes the provider-created temporary ZIP. Thinking appears
in a separate collapsed entry; internal prompts, agent notes and signatures are
not shown.
Compressed and selected uncompressed data are limited to 32 MiB. Unsupported
schemas or ambiguous discovery fail visibly instead of choosing another session.
V3 exports are snapshots; streaming activity remains visible in the native terminal.

## Native terminal and verification

For a running Codex, Claude Code, Kiro, or interactive Cursor session, **Open native terminal** attaches
to the existing provider process in a new tab. It is a real terminal, separate
from the transcript's TUI presentation. Input goes directly to the CLI, without
HeloScrum's queue/steer controls. Closing the tab detaches the terminal client;
explicit exit commands can still end the provider process.

Select **Cursor launch mode → Interactive** to use Cursor's actual CLI rather
than print mode. Install the official CLI and run `cursor-agent login` once.
Herdr owns the persistent PTY; HeloScrum attaches to that same process and saved
chat. There is no concurrent headless writer. Cursor's own workspace trust, MCP
and tool approval prompts remain in force; HeloScrum does not pass `--force`,
`--yolo`, `--approve-mcps`, or `--trust` in interactive mode.

HeloScrum adds observer hooks to the worktree's `.cursor/hooks.json`, preserving
existing hooks. They register the exact chat's native JSONL transcript through
its scoped HeloScrum connection. Only the matching worktree and session path are
accepted. Transcripts must be enabled in Cursor. If unavailable, use the native
terminal; HeloScrum reports that history is waiting instead of fabricating it.
Cursor session changes made through HeloScrum retain reviewed-handoff behavior.
Changing to an unrelated chat with a native CLI command can break that binding;
create or change HeloScrum sessions through the app to keep the history aligned.

Existing Cursor tasks remain headless. Changing launch mode on an idle task uses
a reviewed handoff into a new chat, preserving the previous history. Queue still
waits for native readiness; Steer still uses HeloScrum's next-inbox-check behavior.
Direct terminal input uses the provider's own keyboard semantics.

The setup report distinguishes detected configuration from runtime verification.
It does not prove login, quota, MCP connectivity, plugin loading, or access to
desktop-only features. Use the provider's native status/tool/plugin commands to
inspect the effective session and complete provider approvals. Worktree trust or
organization policy may prevent a detected configuration from loading.

No image generation, desktop app connectors, cloud delegation, or other GUI-only
capability is implied by a CLI connection. Availability depends on what that CLI
and account actually expose.

References checked for this integration:

- [Codex configuration and profiles](https://learn.chatgpt.com/docs/config-file/config-basic)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code settings and worktree behavior](https://code.claude.com/docs/en/settings)
- [Kiro agent configuration and version differences](https://kiro.dev/docs/custom-agents/configuration-reference/)
- [Cursor CLI MCP configuration](https://cursor.com/docs/cli/mcp)

- [Kiro V3 adapter migration and export capabilities](https://kiro.dev/docs/cli/v3/acp-migration/)
- [Cursor interactive CLI parameters](https://cursor.com/docs/cli/reference/parameters)
- [Cursor observer hooks](https://cursor.com/docs/hooks)

## Permission requests

Recognized native prompts show the provider, MCP server, tool, supplied arguments,
and the provider's choices. Delegated operations are named when the argument JSON
includes them. Kiro's follow-up trust menu keeps its displayed session, workspace,
or global scope; opening that menu does not itself grant permission.

Cursor's stacked approvals show its reported request position and total. After a
response, the card reads the next current prompt. When the CLI does not report a
total or arguments, the card says so rather than guessing. Unknown prompt formats
retain the native text and selection controls for manual review.

Polling preserves buttons for an unchanged request. Responses bind to the current
menu and selection, reject changed requests and duplicate submissions, and remain
retryable when sending fails. Sending feedback and errors appear in the request
card. These controls preserve native permission rules; they do not bypass them.


## Toolbox approval settings

Open an agent's **Tools** menu to configure **Shared tool approvals** and
**Provider-native approvals** separately. **Always ask** leaves requests for you;
**Allow all tools** lets HeloScrum answer recognized tool prompts automatically.
Each tool can use that default, **Always ask**, or **Always allow**. Individual
rules override the default. Selecting a bulk button resets that group's individual
rules; **Save toolbox** applies the result to this agent, including future sessions.

Tool access remains separate: allowing approval never enables a disabled shared
tool. Shared `invoke_tool` requests use the named inner tool's rule. If a provider
omits the inner name, HeloScrum keeps the request manual unless every available
shared tool is allowed. Native tools have separate shell, file-read, file-write,
and web rules; other identified native tools appear after their first request.

These controls respond to permission prompts, rather than changing the CLI's
permission configuration. **Always ask** disables HeloScrum's automatic response;
it does not force a prompt for actions the provider already permits. Native deny
rules and sandbox restrictions remain in effect. Model-endpoint sessions expose
their existing workspace-command approval here; their other operations do not
acquire new approval prompts.

Automatic responses use a one-call choice, not a provider's persistent/global
trust option. The saved rule and exact current request are checked again before
sending. Activity records name the automatically allowed tool. Setup dialogs,
questions, trust-scope submenus, and unrecognized formats remain manual. A failed
automatic send stays available for manual retry.

Current recognition covers Codex and interactive Cursor MCP approval menus,
Kiro V3 tool menus, and HeloScrum-managed workspace commands. Other native prompt
formats, including Claude Code prompts, retain manual terminal controls. Provider
CLI updates can change these formats; an unknown format is never auto-approved.

Native permission references:

- [Codex approvals and sandbox boundaries](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Claude Code permission rules](https://code.claude.com/docs/en/permissions)
- [Cursor CLI permission rules](https://cursor.com/docs/cli/reference/permissions)
- [Kiro permissions](https://kiro.dev/docs/permissions/)


## Team templates and recovery contacts

**Settings → Agents** includes three built-in templates: **Scrum Master**,
**Therapist**, and **Orchestrator**. Use a template from Add agent, or duplicate it
to customize its provider, model, instructions and appearance. Adding templates
does not create running sessions or change existing profiles.

The Orchestrator keeps assignments, dependencies, specialist handoffs and
independent review aligned with the approved brief. Select it as the plan's
orchestrator to grant assignment authority; a profile name alone grants none.
The Scrum Master remains a separate facilitator for the selected delivery method.

The optional Therapist is a recovery coach for blockers, contradictory
requirements, repeated failures and context pressure. Assign a running Therapist
under each agent's **Tools → Recovery contact**. Agents report their working state
with `report_state` and ask for help through `request_support`, supplying the goal,
attempts and blocker. The request includes the latest reported reason and next
step. A state tag alone does not start another model call.

The coach uses that evidence to propose a small recovery plan, a success check
and a stopping condition. It replies through the existing message channel, then
waits. It does not take over the implementation, change permissions or budgets,
or assign work. Pending requests are reused, repeat requests are rate-limited,
and coaches cannot chain support requests to other coaches. Private notebooks
remain scoped to their owner; relevant excerpts must be supplied by the requester.

## Native provider command library

The **TUI** tab on a native agent card is the actual provider terminal, not a
terminal-styled transcript. Codex, Claude Code, Kiro V2/V3 and interactive Cursor
share one xterm transport; their own menus, colors, keyboard shortcuts, custom
commands and permission prompts remain native. Expand the card or use Focus for
large menus. Switching to Chat preserves the terminal connection and its draft.
Native launches request truecolor and clear inherited no-color flags inside the
managed terminal; global shell preferences stay unchanged. Already-running CLIs
keep their launch environment until their conversation is resumed in a new pane.
Closing the view detaches it without stopping the agent. Another active terminal
is never silently taken over; close that view and reconnect here.

Type `/` in the **Chat message field** to browse that provider's command library,
then select a command and press Enter to run it. Commands are sent literally to
the CLI and their output opens in the same card's TUI. They are never wrapped as
agent chat messages or placed in the ordinary Queue/Steer queue. Unknown commands
are kept as drafts with a suggestion to use the native TUI, where the installed
provider's plugin and custom commands are available. Paths such as `/src/file.js`
and slashes inside ordinary prose remain ordinary message text.

Use **/ Commands** in the card or terminal toolbar for descriptions, arguments,
provider references and notices on commands that can use model tokens. In TUI,
the keyboard goes directly to the provider. **Queue / Steer** opens HeloScrum's
separate message composer when that delivery behavior is wanted. API-backed and
headless sessions retain a clearly labeled **Transcript** view; they do not gain
native CLI commands.

The library includes Codex, Claude Code, Kiro V2/V3 and interactive Cursor. It is a
curated reference, not runtime discovery of every installed plugin or custom command.
The provider's own command menu remains authoritative for version- and feature-gated
commands. For example, Cursor uses `/summarize`, whereas Codex, Claude and Kiro use
`/compact`. Codex and supported Cursor versions expose `/goal`; the app does not
invent a matching Claude or Kiro command.

The picker requires a live, idle session and an empty native composer. A pending
permission dialog, active work, changed session, or headless runtime cannot receive
an injected command. Delivery means the command was sent, not that its action
completed; inspect the native output. Unconfirmed deliveries are not automatically retried.
Native compaction remains the provider's own behavior, distinct from HeloScrum's
reviewed checkpoint. Commands do not automatically change HeloScrum's task board.
The catalog is not injected into agent startup prompts and does not call a model.

Provider references (reviewed 2026-10-07):

- [Codex CLI commands](https://learn.chatgpt.com/docs/developer-commands#built-in-slash-commands)
- [Claude Code commands](https://code.claude.com/docs/en/commands)
- [Kiro slash commands](https://kiro.dev/docs/reference/slash-commands/)
- [Cursor CLI slash commands](https://cursor.com/docs/cli/reference/slash-commands)

## Useful state signals without routine check-ins

State tags describe a reported work situation. They are not automatic measurements
of an agent's internal reasoning. The useful distinctions are:

| Tag | Evidence | Next action |
| --- | --- | --- |
| Uncertain | A missing fact or conflicting requirement blocks a decision | Resolve the missing fact or ask a targeted question |
| Stuck | Repeated attempts make no progress | Try a different diagnostic |
| Overloaded | Scope or context prevents a reliable next step | Narrow the step and preserve a short handoff |
| Recovering | An agreed remedy is being tested | Check its outcome |
| Focused | A previously reported blocker has been resolved | Resume the assigned work |

New sessions are instructed to skip routine Focused, startup, progress and completion
reports. If support is needed, `request_support` accepts an optional `state` so one
call records it and contacts the assigned Therapist. Identical `report_state` calls
reuse the stored state and return a small receipt; changed evidence is retained.
The UI omits empty “Not reported” badges and does not fabricate a Focused state.

Rendering tags costs no model tokens. Calling `report_state` does add a tool exchange
and may require another model turn; its cost is not just the tag's few characters.
Deduplicating storage cannot refund a call already made. Actual savings require
measured sessions. Existing sessions retain their original startup instructions
until a reviewed restart or an explicit user correction; refreshing the UI does
not rewrite their conversation history.

## Claude Mod activity bridge

New supported Claude sessions load the scoped [activity Mod](claude-activity.md).
It sends reported tool activity and context measurements to Chat over the existing
MCP connection. Run `/heloscrum-status` to check it without a model call. Running
sessions retain their current launch settings until their next native restart.
