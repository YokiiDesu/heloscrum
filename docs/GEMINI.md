# Gemini CLI

Install [Gemini CLI](https://geminicli.com/docs/get-started/installation/) and
run `gemini` in a terminal to finish authentication. HeloScrum uses that CLI's
account and environment. It does not collect or copy your Gemini credentials.

Restart HeloScrum after installing the CLI, then choose **Create a task → Agent →
Gemini CLI**. Leave **Model** at **Provider default**, choose a model from the
installed CLI's catalog, or enter an exact model ID supported by your account.
Model discovery can time out independently of task creation; an empty catalog
does not prevent using the provider default or an exact ID. Explicit reasoning
effort is unavailable; Gemini controls its own reasoning settings.

If `gemini` is not on HeloScrum's PATH, set `HELOSCRUM_GEMINI_BIN` to the full
executable path before starting HeloScrum. `npm run doctor -- --provider gemini`
checks executable availability without making an AI request. Gemini sessions do
not require Herdr.

The adapter uses [ACP v1](https://geminicli.com/docs/cli/acp-mode/) over stdio.
Use a current CLI with `--acp`, `session/new`, and `session/load` support. The
implementation was checked against installed Gemini CLI 0.67.0. Unsupported
protocols and missing resume capabilities produce an error; HeloScrum never
silently substitutes a new conversation for a saved one.

## Sessions and approvals

- Replies, displayable thinking, tool activity, and edit details appear in
  **Chat / Block**. A terminal is not attached to these sessions.
- Gemini requests tool permissions through HeloScrum's approval card. The
  request's exact option IDs and current fingerprint are checked before sending
  a response. Saved HeloScrum toolbox rules can answer identified tool requests.
  Gemini's native policies still apply. New sessions start in Default unless
  you select Plan in Native setup. Other advertised modes require an explicit
  selection in Gemini controls; their permission descriptions come from Gemini.
- **Interrupt** cancels the turn and any pending approval. An unresponsive CLI
  is terminated; the next prompt loads the same saved session. Completed actions
  remain in the transcript and must be reviewed before retrying.
- **Projects → Resume** and model changes load the exact saved Gemini session
  without resending the original task. HeloScrum retains its transcript across
  restarts; deleting Gemini's own session files prevents provider resume.
- Image attachments are sent as ACP image blocks when the CLI advertises image
  support. Other uploaded files remain accessible through the HeloScrum tools.
- Reported usage, context occupancy, and the prompt result are retained in the
  private managed-session record. Missing usage is not estimated or invented.

## Project tools and configuration

HeloScrum supplies its task-scoped MCP bridge directly in the ACP session request.
The bridge uses the same project, work-management, notebook, attachment, and
communication permissions as the other adapters. Credentials remain in the
private HeloScrum connection file, outside the agent worktree.

Gemini must trust the agent’s working folder to start MCP servers. If the card
shows **Toolbox disconnected**, open `gemini` in the task’s worktree and review
its folder-trust prompt and MCP configuration, then resume/restart that session.
HeloScrum does not silently mark folders trusted or override restricted-mode
environment settings. Chat can work while MCP is disabled by Gemini.

Gemini loads its own user and project configuration. Committed `GEMINI.md`,
`.gemini/settings.json`, skills, commands, hooks, and policy files arrive with the
Git worktree. **Native setup → Project configuration** lets you select supported
untracked files to copy at creation. HeloScrum leaves original files unchanged
and does not rewrite `.gemini/settings.json` to install its bridge.

Full-screen terminal commands and audio attachments are not part of this adapter.
Finish login and terminal-only setup in `gemini`, then use **Retry start** for a
task whose initial prompt has not been submitted.

## Gemini controls

Open **Gemini controls** on the agent card. Mode changes and commands require an
idle connected session. Refresh the controls after a turn to see new plans and
usage. The card also shows the latest context occupancy and reported token total.

- **Plan → board draft:** choose **Native setup → Gemini launch mode → Plan** when
  creating the agent, or apply Plan in the running session's mode selector. Ask
  Gemini for a plan. Review the captured response, edit its title and text, write
  one board task per line, and select an initial owner. **Save board draft** opens
  an assigned, review-policy draft; every task starts To do regardless of Gemini's
  claimed progress. Assignments, acceptance criteria and dependencies can be
  refined on the board before **Review & start**. Switch executing Gemini agents
  to Default before starting. Importing never starts agents or sends assignments.
  Reimporting the same source opens its existing draft. Changed source/session
  fingerprints require reviewing the latest plan. Plan mode may write Gemini's
  own plan file; ordinary workspace edits remain subject to its native policy.
- **Edit review:** structured file edits show complete Before / After panes with
  line numbers and final-newline information. Highlighting marks the replacement
  region between the common prefix and suffix. Native request details and exact
  permission choices remain available. Denied or failed edits are not presented
  as applied changes; tool status stays visible in Chat / Block.
- **Usage:** context occupancy is separate from summed response usage. Input,
  output, cached input and thinking counts are displayed only when measured;
  absent fields stay unknown. Totals may include repeated input context and are
  not an account balance or cost estimate. Raw results remain in the private
  managed-session record.
- **Native commands:** only commands advertised by the connected ACP session are
  offered, both here and when typing `/` in the composer. Optional arguments are
  passed literally. Results appear in Chat / Block. Commands such as `/memory`
  and `/extensions` may accept subcommands; availability belongs to the installed
  CLI. Terminal-only commands are not silently sent as model requests. Session
  identity and catalog changes invalidate stale command submissions.

The adapter explicitly applies Plan through `session/set_mode` before the first
prompt because Gemini CLI 0.67 can ignore the process launch flag in ACP sessions.
For resume, it waits for startup command discovery and drains the saved-history
burst before accepting new output. A stalled resume fails without creating a
replacement session.
