# Claude visual Mods

HeloScrum can load the local `plugins/heloscrum-activity` Mod into newly launched
Claude Code sessions. It reports tool starts/results and context measurements over
the session's existing authenticated MCP connection. Chat's Bubble and Block views,
as well as saved History, render the same cards.

## Starting and checking

1. Use a current Claude Code CLI. The bridge was tested with **2.1.286**, which has
   the Mod APIs behind `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. HeloScrum supplies that
   flag only in its launch settings. Current public documentation lists 2.1.287+.
2. Start a Claude agent through HeloScrum. Existing native processes keep their
   launch configuration; resume/restart an idle session through Agent settings to
   load the Mod. Do not interrupt active work just to add telemetry.
3. Open the agent's Chat view for visual cards: named test results and outcome bars,
   before/after file changes, contextual tool summaries, and a context gauge.
   **Command & details** opens the underlying input, output and timing. **View more
   results** expands the remaining named tests. These controls also work in History.
4. In an interactive Claude terminal, run `/heloscrum` to open the native panel.
   Its **Activity**, **Changes**, and **Context** tabs use the same observed events.
   The optional **Roles** tab shows the enabled role workspaces and their guides.
   **Pin status strip** keeps a compact strip above the prompt; **Unpin** removes it.
   Close the panel with its Close button or Escape. The base activity panel and strip do not add
   model requests. Opt-in Jev Auto role selection makes the bounded calls described
   in the [role-pack guide](claude-role-packs.md). The native panel keeps the most recent 24 tool calls in memory;
   the web cards use persisted history.
5. `/heloscrum-status` remains a small diagnostic command for delivery and context
   measurement. In noninteractive `claude -p`, `/heloscrum` explains that a visual
   surface is required instead of trying to open a pane.

Complete Node TAP summaries drive the test counts; named cases come from available
TAP output, with failed cases first. Nested suites are not counted as extra tests.
Partial excerpts are labelled. A successful shell exit without a complete test
summary never becomes an all-tests-passed card. Other test formats remain available
in Details.

`Edit` cards show the supplied old and new lines, and label a change as proposed or
failed until the tool reports success. Replace-all counts describe one match. A
`Write` card shows written content without inventing a prior version. These are
per-call previews, not a claim about the final repository diff.

The context gauge uses only reported measurements. Unknown usage stays unknown,
including before the first model request. Color and icon/text labels convey results
in both appearance modes; animation respects reduced-motion preferences.

No global plugin installation or edits to `~/.claude/settings.json` are needed.
The launch settings allow only `mcp__heloscrum__activity_report` for automatic
telemetry delivery. Native tool permissions and HeloScrum's identity checks remain
in force. This older CLI build required the explicit narrow grant even though the
current Mod API documentation describes plugin MCP calls as granted by the plugin.

## Scope and failure behavior

- The bridge observes the main Claude loop. Other providers keep their existing
  transcript readers; subagent telemetry is not merged into the parent identity.
- Native transcript tool IDs and Mod reports are merged into one card. Native
  output remains available, including when a final Mod report was missed.
- Cards are **reported execution evidence**, not independent verification or task
  acceptance. Context occupancy is not a billing total. Unknown counts stay unknown.
- Reports do not send messages, wake teammates, change task state, override a tool,
  alter its result, or add instructions to the model prompt.
- A bounded background queue sends up to 16 reports per tick. Disconnection leaves
  Claude's tools running normally; the bridge retries delivery, never tool execution.
  The in-memory queue holds 128 reports and can lose older telemetry during a long
  outage or process exit. The original Claude transcript remains the fallback.
- Up to 256 activity entries per agent/session are persisted in
  `.heloscrum/agents/<agent-id>/activity/<session-id>.json` with private file permissions.
  History captures observed entries through its existing collector. A stopped collector
  cannot recover entries that rotated out before it read them.
- Inputs and output excerpts are limited to 12,000 characters. These contain the same
  kind of potentially sensitive information as native tool logs; do not publish the
  runtime directory. The bridge uses the agent's connection and accepts only its
  current session ID. It has no owner credential.

Set `HELOSCRUM_CLAUDE_ACTIVITY=0` before starting HeloScrum to disable the bridge for
new sessions. Explicit `disableAllHooks` or `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=0`
in the user's/project's Claude settings also disables it. Unsupported CLI versions
continue with normal transcript reading. Use `claude plugin validate plugins/heloscrum-activity` from the checkout to
check the package. `/heloscrum-status` is available only when the Mod has loaded;
a disabled or incompatible session will not register that command.

## Verification

### Known Restart Issue (October 12, 2026)

During an authenticated two-provider test, forcing a HeloScrum backend restart
left two native `activity_report` calls pending. Herdr continued to report
background MCP work, so the next queued prompt waited until those calls timed
out. Later reports succeeded, and the project, messages, attachments and native
session identities were preserved. This does not establish prompt delivery
immediately after every restart; the cause and reliable recovery remain open.

To reproduce and verify a fix, start a Claude session with this Mod, wait for
activity delivery, restart only the HeloScrum backend, and queue a small prompt
once the native composer is idle. Record the native background-task state,
delivery latency and any permission request. The prompt must reach the idle
session without a stale activity report blocking it, and it must run only once.
Keep real native permission prompts intact.

`HELOSCRUM_CLAUDE_ACTIVITY=0` prevents this Mod from loading in newly started
sessions; it does not cancel reports already pending in an existing process.
Normal transcript reading remains available without the Mod. This is an opt-out
for further testing, not a verified recovery command for a stuck session.

The implementation has regression checks for rich TAP results, nested suites, file
change previews, native panel tabs/pinning/close, session isolation, idempotent and
out-of-order reports, complete test summaries, HTML escaping, unknown measurements,
and disconnected transport without repeated native work. A native CLI smoke check
ran a real Bash test through a second test Mod and delivered its 1-pass/1-skip TAP
result over the actual HeloScrum MCP bridge. No model generation was needed for
that successful check. Browser verification uses an isolated HeloScrum workspace;
its context-meter fixture is synthetic and is not evidence of a live model's usage.
The revised live demo runs the actual HeloScrum activity, history and presentation
regression suites via Claude's Bash tool, and edits a temporary `MOD-DEMO.md` via
its Read/Edit tools. Earlier arithmetic fixtures are only transport examples.

Run `node --test test/activity-events.test.mjs test/activity-history.test.mjs
test/activity-presentation.test.mjs` from the repository for the integration checks.
Run `claude plugin test` from `plugins/heloscrum-activity` for native render-tree and
control tests (on 2.1.286, set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).

References: [Claude Mods](https://code.claude.com/docs/en/plugins/mods/overview),
[Mod API](https://code.claude.com/docs/en/plugins/mods/api),
[Mod events](https://code.claude.com/docs/en/plugins/mods/events).

## Optional role packs

The [website add-on page](../website/add-ons.html) introduces this visual Mod.
See [Claude role packs](claude-role-packs.md) for the eight installed workspaces,
Off / Manual / Jev Auto selection, native Roles tab, and source-backed evidence.
Role selection defaults to Off and does not require Jev in Manual mode. The base
activity Mod still works independently. No pack grants new task permissions.
