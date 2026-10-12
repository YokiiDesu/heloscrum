# Set Up HeloScrum With Your AI

Give a terminal-capable coding agent the prompt in the README, or the website's
**Copy Setup Prompt**. This guide is the shared setup reference for that agent.
It is not a separate installer or a provider-specific plugin.

## Establish the Environment

Read the current README, [Installation by OS](INSTALLATION.md), and
[Desktop guide](DESKTOP.md) from this checkout. Detect the operating system,
architecture, and shell before choosing commands. Explain the platform's actual
support level: macOS desktop alpha, experimental Linux/WSL, or native Windows
contributor checks. Don't turn a passing server test into a desktop-support claim.

Locate an existing checkout first. Otherwise clone the public repository over
HTTPS; no GitHub token is needed to download HeloScrum. The user's own private
projects use their configured Git credentials. Don't ask for a token in chat.

Check Git, Node/npm, Herdr and the chosen provider without printing saved
credentials. Ask which provider to configure if their existing setup doesn't
make it clear. Preserve existing projects, `.heloscrum` state, and provider logins.

## Install and Verify

On macOS or Linux, inspect and run `bash scripts/setup-desktop.sh`. Let the user
see its progress and answer its choices. If the agent can't operate an interactive
terminal, explain the documented noninteractive flags before using them; `--yes`
accepts core installation defaults and never authorizes provider login or turns.
Keep sign-in and provider permission choices with the user.

Use the platform-specific prerequisites in INSTALLATION.md. Report a failed
command and its actionable error; fix that cause before retrying. Avoid deleting
workspace data, resetting repositories, disabling the sandbox, or exposing the
local server as a shortcut around setup problems.

Run Doctor for the chosen provider with the Node/runtime selected by setup.
Then verify that the app opens, its local server responds, and the required
engine is available. CLI detection alone doesn't establish authentication. If
the user needs to sign in, hand over that provider's normal login flow.

## Teach the First Workflow

Walk through these in the running app, using the Tour when helpful:

1. **Projects:** choose a local folder; explain Git initialization and isolated
   worktrees before adding an agent.
2. **Agents:** choose a provider, model and role. A Builder implements; a distinct
   Reviewer checks the submitted result. Creating either starts a provider turn.
3. **Tasks:** describe the result and success criteria, add an attachment, assign
   the owner and QA lead, and review the brief before starting.
4. **Conversations:** use DMs or New Group, share attachments, and open the shared
   viewer. Native sessions can also connect through the
   [existing-agent guide](https://yokiidesu.github.io/heloscrum/blog/connect-your-existing-agents.html).
5. **Review:** inspect the exact commit, checks and reviewer evidence. Task
   acceptance, committing, pushing and deployment are separate actions.

Offer a small disposable first task from [Getting Started](GETTING_STARTED.md).
Start it when the user wants to run agents, since it uses their provider account.
Explain permission prompts as they appear; don't select blanket approval on the
user's behalf. Show how to stop, resume and return to the saved project.

Finish with the launch command or launcher, locations of the workspace and logs,
what you actually checked, and any remaining input needed. Distinguish install,
server, UI and authenticated-workflow checks. Keep secrets out of that report.
